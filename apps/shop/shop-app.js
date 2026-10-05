/* ========================================================
 * shop-app.js — [v3.27.0] 商城 App 控制器
 * 照抄 focus / piggy / punchcard / avatarframe 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xINOVO（`src_xinovo/js/modules/shop.js` 1068 行 / 38254 字符）。
 * 源那三处本仓不能有（见 shop-data 文件头）：商品靠角色接口现生成、自提口令从聊天正文正则抓、
 * 设置直写 Dexie。本件只做**本会话的账**：商品目录 → 购物车 → 下单签发口令 → 核销。
 * 零数据库、零网络、零碰聊天历史。
 *
 * 【口令为什么改由本 App 签发】源从正文里抠口令，正文一旦换格式就静默判「没找到」——
 *   不报错、只错结果。本件把口令当成**本 App 自己签发的凭据**：签发、比对、核销全在本件闭环，
 *   对不上就是「没有对得上的待取订单」，不猜。
 * ======================================================== */
'use strict';
import {
    SHOP_REASONS, SHOP_PRESET_CATEGORIES, SHOP_LIMITS,
    defaultShopSettings, normalizeShopSettings, yuanToCents,
    normalizeProducts, normalizeProduct, normalizeCategories, allCategories,
    addToCart, setQty, removeFromCart, clearCart, cartTotal,
    checkout, pickup, cancelOrder, removeOrder,
    readShopFace, projectShop, shopPromptBlock,
} from './shop-data.js';
import { ShopView } from './shop-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^shop_/`，否则跨会话串味 */
const SETTINGS_KEY = 'shop_settings';
const PRODUCTS_KEY = 'shop_products';
const CATEGORIES_KEY = 'shop_categories';
const CART_KEY = 'shop_cart';
const ORDERS_KEY = 'shop_orders';

export class ShopApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultShopSettings() };
        this.products = [];
        this.categories = [];
        this.cart = [];
        this.orders = [];
        this.face = SHOP_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
        this._seq = 0;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }

    _writeJSON(key, v) {
        try {
            if (!this.storage) return false;
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            this.products = normalizeProducts(this._readJSON(PRODUCTS_KEY));
            this.categories = normalizeCategories(this._readJSON(CATEGORIES_KEY)).categories;
            /* 车只做**形状**归一：已不在目录里的条目仍然留在车上，
             * 让 cartTotal.missing / 视图层把它显出来（静默剔除＝用户看着车里的东西自己消失了）。 */
            this.cart = normalizeCartShape(this._readJSON(CART_KEY));
            const rawOrders = this._readJSON(ORDERS_KEY);
            this.orders = Array.isArray(rawOrders) ? rawOrders : [];
        } catch (_e) {
            storageOk = false;
            this.products = [];
            this.categories = [];
            this.cart = [];
            this.orders = [];
        }
        this.face = readShopFace({ storageOk, hasProducts: this.products.length > 0 });
        this._proj = storageOk ? projectShop(this.products, this.categories, this.cart, this.orders) : null;
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return SHOP_LIMITS; }
    presetCategories() { return SHOP_PRESET_CATEGORIES.slice(); }
    categoriesList() { return allCategories(this.categories); }
    productsList() { return Array.isArray(this.products) ? this.products.slice() : []; }
    cartList() { return Array.isArray(this.cart) ? this.cart.slice() : []; }
    ordersList() { return Array.isArray(this.orders) ? this.orders.slice() : []; }
    cartTotals() { return cartTotal(this.cart, this.products); }

    /* ---------- 商品目录 ---------- */

    /**
     * 登记一件商品。价格从「元」进（视图层给的字符串也认），非法价**不拒收**而是标 unPriced
     * —— 源里商品价格本来就是可空的（生成侧给不出价也得挂出来）。
     * 返回 `{ok, id?, unPriced?, error?}`。
     */
    addProduct(input) {
        const o = (input && typeof input === 'object') ? input : {};
        const name = String(o.name || '').trim();
        if (!name) return { ok: false, error: '得有个名字' };
        if (this.products.length >= SHOP_LIMITS.maxProducts) {
            return { ok: false, error: '目录满了（' + SHOP_LIMITS.maxProducts + ' 件）' };
        }
        this._seq += 1;
        const hasCents = (o.priceCents !== null && o.priceCents !== undefined && o.priceCents !== '');
        const hasYuan = (o.priceYuan !== null && o.priceYuan !== undefined && o.priceYuan !== '');
        const cents = hasCents ? yuanToCents(o.priceCents) : (hasYuan ? yuanToCents(o.priceYuan) : null);
        const p = normalizeProduct({
            name,
            category: o.category,
            priceCents: cents,
            note: o.note,
        }, this.products.length + this._seq * 1000);
        if (!p) return { ok: false, error: '名字是空的' };
        if (this.products.some((x) => x.id === p.id)) p.id = p.id + '_' + this._seq;
        this.products = this.products.concat([p]);
        this._writeJSON(PRODUCTS_KEY, this.products);
        this.probe();
        return { ok: true, id: p.id, unPriced: p.unPriced };
    }

    removeProduct(id) {
        const want = String(id || '');
        const kept = this.products.filter((p) => p.id !== want);
        const removed = this.products.length - kept.length;
        if (!removed) return 0;
        this.products = kept;
        this._writeJSON(PRODUCTS_KEY, this.products);
        /* 车里的同一件也要摘 —— 否则它会以「已不在目录里」的形态留在车上（cartTotal.missing） */
        const c = removeFromCart(this.cart, want);
        this.cart = c.cart;
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return removed;
    }

    clearProducts() {
        const n = this.products.length;
        if (!n) return 0;
        this.products = [];
        this.cart = clearCart().cart;
        this._writeJSON(PRODUCTS_KEY, this.products);
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return n;
    }

    /* ---------- 分类 ---------- */

    /** 加自定义分类。默认 id 一律拒收（数据层保证），如实回报。返回 `{ok, error?}`。 */
    addCategory(input) {
        const o = (input && typeof input === 'object') ? input : {};
        const id = String(o.id || '').trim();
        const name = String(o.name || '').trim();
        if (!id || !name) return { ok: false, error: '分类要有 id 和名字' };
        if (SHOP_PRESET_CATEGORIES.some((c) => c.id === id)) {
            return { ok: false, error: '「' + id + '」是内置分类的 id，换个' };
        }
        if (this.categories.some((c) => c.id === id)) return { ok: false, error: '已经有一个同 id 的分类' };
        const r = normalizeCategories(this.categories.concat([{ id, name, note: o.note }]));
        if (!r.categories.length || r.categories.length === this.categories.length) {
            return { ok: false, error: '没收进去（检查 id / 名字是否为空，或已到上限）' };
        }
        this.categories = r.categories;
        this._writeJSON(CATEGORIES_KEY, this.categories);
        this.probe();
        return { ok: true };
    }

    /** 删分类：分类下的商品**不跟着删**，改落 general（删个分类不该顺手清商品）。 */
    removeCategory(id) {
        const want = String(id || '');
        const kept = this.categories.filter((c) => c.id !== want);
        const removed = this.categories.length - kept.length;
        if (!removed) return { ok: false, removed: 0, movedToGeneral: 0 };
        this.categories = kept;
        this._writeJSON(CATEGORIES_KEY, this.categories);
        let moved = 0;
        this.products = this.products.map((p) => {
            if (p.category !== want) return p;
            moved += 1;
            return { ...p, category: 'general' };
        });
        if (moved) this._writeJSON(PRODUCTS_KEY, this.products);
        this.probe();
        return { ok: true, removed, movedToGeneral: moved };
    }

    /* ---------- 购物车 ---------- */

    cartAdd(productId, qty) {
        if (!this.products.some((p) => p.id === String(productId || ''))) return { ok: false, error: '目录里没有这件' };
        const r = addToCart(this.cart, productId, qty);
        this.cart = r.cart;
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return { ok: true, clamped: r.clamped };
    }

    cartSet(productId, qty) {
        const r = setQty(this.cart, productId, qty);
        this.cart = r.cart;
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return { ok: true };
    }

    cartRemove(productId) {
        const r = removeFromCart(this.cart, productId);
        this.cart = r.cart;
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return { ok: true };
    }

    cartClear() {
        this.cart = clearCart().cart;
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
    }

    /* ---------- 下单 / 核销 ---------- */

    /** 下单。返回 `{ok, code?, totalCents?, error?}` —— 口令是**本 App 签发**的（文件头那条）。 */
    doCheckout() {
        const r = checkout(this.orders, this.cart, this.products, Date.now());
        if (!r.order) return { ok: false, error: r.error || '下不了单' };
        this.orders = r.orders;
        this.cart = clearCart().cart;
        this._writeJSON(ORDERS_KEY, this.orders);
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return { ok: true, code: r.order.code, totalCents: r.order.totalCents };
    }

    doPickup(code) {
        const r = pickup(this.orders, code, Date.now());
        if (!r.ok) return { ok: false, error: r.error || '核销失败' };
        this.orders = r.orders;
        this._writeJSON(ORDERS_KEY, this.orders);
        this.probe();
        return { ok: true, orderId: r.orderId };
    }

    doCancel(orderId) {
        const r = cancelOrder(this.orders, orderId);
        if (!r.changed) return { ok: false };
        this.orders = r.orders;
        this._writeJSON(ORDERS_KEY, this.orders);
        this.probe();
        return { ok: true };
    }

    doRemoveOrder(orderId) {
        const r = removeOrder(this.orders, orderId);
        if (!r.removed) return { ok: false };
        this.orders = r.orders;
        this._writeJSON(ORDERS_KEY, this.orders);
        this.probe();
        return { ok: true };
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入「挂着几单待取」这一事实（见数据层 shopPromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || projectShop(this.products, this.categories, this.cart, this.orders);
        return shopPromptBlock(proj, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到商城';
        if (!p.hasAny) return '还没有商品';
        const n = p.pendingOrders.length;
        return p.productCount + ' 件商品 · ' + (n ? (n + ' 单待取') : '没有待取');
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const ctx = this._win().SillyTavern && this._win().SillyTavern.getContext ? this._win().SillyTavern.getContext() : null;
            const es = ctx ? ctx.eventSource : null;
            const et = ctx ? ctx.event_types : null;
            if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const blk = this.promptBlock();
                    if (blk) payload.prompt.push({ role: 'system', content: blk });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hookBound = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /* ---------- 设置 ---------- */

    _loadSettings() {
        try {
            this.settings = normalizeShopSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultShopSettings() }; }
    }

    saveSettings() {
        this._writeJSON(SETTINGS_KEY, this.settings);
    }

    patchSettings(patch) {
        this.settings = normalizeShopSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：目录、车、订单都是「本会话的账」，故全部重取。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new ShopView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}

/** 车的条目形状规范化（只回形状，不剔条目 —— 剔除口径在 cartTotal.missing / 视图层）。 */
function normalizeCartShape(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((x) => {
            const o = (x && typeof x === 'object') ? x : {};
            const productId = String(o.productId || '').trim();
            if (!productId) return null;
            const n = Number(o.qty);
            if (!Number.isFinite(n) || n <= 0) return null;
            return { productId, qty: Math.min(SHOP_LIMITS.maxQty, Math.round(n)) };
        })
        .filter(Boolean);
}