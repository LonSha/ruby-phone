/* ========================================================
 * taobao-app.js — [v3.29.0] 桃宝 App 控制器
 * 照抄 shop / piggy / focus 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xintuk（`runtime/scripts/taobao/`，四片 154272 字节 / 88 个函数）。
 * 源是**四合一超级模块**（抓娃娃机 + 桃宝购物 + 外卖 + 物流），本件取三块，
 * 逐条取舍写在 taobao-data.js 的文件头（五处不缝 + 四条偏离），这里只记**接线上的两件事**：
 *
 *  【① 物流不做定时器，改「惰性补推」】
 *   源给每个未来步骤挂 `setTimeout`，回调里还要回查页面是否 active —— 页面不在就永不补上。
 *   本件**一个定时器都不转**：`probe()` 每次取数时用 `Date.now()` 把每张订单的 status
 *   一次性推到「此刻应有的那一段」（纯函数、可复算、与页面在不在无关）。
 *   界面给一个「推演到此刻」按钮做显式补推 —— 关掉再开也会自动补（因为 probe 每次都推）。
 *
 *  【② 战利品不落账，只登记面值】
 *   源把娃娃机抓到的钱直接加进用户余额。本仓用户钱包的仲裁源是微信零钱，
 *   本件若也去加，同一笔钱就有两个记账者。故只记「抓到过什么、面值多少」。
 * ======================================================== */
'use strict';
import {
    TAOBAO_REASONS, TAOBAO_LIMITS, TAOBAO_FACES, ORDER_STATUS, ORDER_STATUS_ORDER, LOGISTICS_TEMPLATE,
    defaultTaobaoSettings, normalizeTaobaoSettings, yuanToCents,
    normalizeProducts, normalizeProduct, addToCart, setQty, removeFromCart, clearCart, cartTotal,
    pickCities, placeOrder, logisticsSteps, statusTextOf, applyLogistics,
    rollTier, recordGrab, readTaobaoFace, projectTaobao, taobaoPromptBlock,
} from './taobao-data.js';
import { TaobaoView } from './taobao-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^taobao_/`，否则跨会话串味 */
const SETTINGS_KEY = 'taobao_settings';
const PRODUCTS_KEY = 'taobao_products';
const CART_KEY = 'taobao_cart';
const ORDERS_KEY = 'taobao_orders';
const GRABS_KEY = 'taobao_grabs';

export class TaobaoApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultTaobaoSettings() };
        this.products = [];
        this.cart = [];
        this.orders = [];
        this.grabs = [];
        this.face = TAOBAO_REASONS.storage_absent;
        this._proj = null;
        this._lastPushed = 0;
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
            this.storage.set(key, JSON.stringify(v));
            return true;
        } catch (_e) { return false; }
    }

    /* ---------- 取数 ---------- */

    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 取数末尾做一次**惰性补推**：这一步就是本件替代定时器的地方（见文件头①）。
     */
    probe() {
        let storageOk = !!this.storage;
        try {
            this.products = normalizeProducts(this._readJSON(PRODUCTS_KEY));
            /* 车只做形状归一：已不在目录里的条目仍留车上，让 cartMissing 显形（静默剔除＝
             *   用户看着车里的东西自己消失了）。 */
            this.cart = normalizeCartShape(this._readJSON(CART_KEY));
            const rawOrders = this._readJSON(ORDERS_KEY);
            this.orders = (Array.isArray(rawOrders) ? rawOrders : []).filter((o) => o && typeof o === 'object');
            const rawGrabs = this._readJSON(GRABS_KEY);
            this.grabs = (Array.isArray(rawGrabs) ? rawGrabs : []).filter((g) => g && typeof g === 'object');
        } catch (_e) {
            storageOk = false;
            this.products = [];
            this.cart = [];
            this.orders = [];
            this.grabs = [];
        }
        this._lastPushed = 0;
        if (storageOk && this.orders.length) {
            const r = applyLogistics(this.orders, Date.now(), this.settings.speedFactor);
            if (r.changed > 0) {
                this.orders = r.orders;
                this._lastPushed = r.changed;
                this._writeJSON(ORDERS_KEY, this.orders);
            }
        }
        this.face = readTaobaoFace({
            storageOk,
            hasAny: (this.products.length > 0 || this.orders.length > 0 || this.grabs.length > 0),
        });
        this._proj = storageOk
            ? projectTaobao(this.products, this.cart, this.orders, this.grabs, Date.now(), this.settings)
            : null;
    }

    faceReason() { return this.face; }
    /* ★ 两个面（逛街 / 娃娃机）由数据层给**顺序**，视图按它决定画哪几段：
     *   数据层若去掉一个面，界面跟着少一段 —— 这就是「真消费」而不是装饰性出口。 */
    faces() { return TAOBAO_FACES.slice(); }
    /* ★ 订单状态机的**推进顺序**同样只在数据层写一份（视图不再自带一份同形数组）。 */
    statusOrder() { return ORDER_STATUS_ORDER.slice(); }
    projection() { return this._proj; }
    limits() { return TAOBAO_LIMITS; }
    statusLabels() { return ORDER_STATUS; }
    lastPushed() { return this._lastPushed; }
    productsList() { return Array.isArray(this.products) ? this.products.slice() : []; }
    cartList() { return Array.isArray(this.cart) ? this.cart.slice() : []; }
    ordersList() { return Array.isArray(this.orders) ? this.orders.slice() : []; }
    grabsList() { return Array.isArray(this.grabs) ? this.grabs.slice() : []; }
    cartTotals() { return cartTotal(this.cart, this.products); }

    /** 某一单的物流推演（视图的物流面板用；纯函数，不缓存）。 */
    logisticsOf(orderId) {
        const id = String(orderId || '');
        const o = this.orders.find((x) => x && x.id === id);
        if (!o) return null;
        const st = logisticsSteps(o, Date.now(), this.settings.speedFactor);
        return { order: o, ...st, statusText: statusTextOf(o.status) };
    }

    /** 模板步数（视图画「模板长什么样」用）。 */
    templateSteps() { return LOGISTICS_TEMPLATE.slice(); }

    /* ---------- 商品目录 ---------- */

    /**
     * 登记一件商品。价格从「元」进，非法价**不拒收**而是标 unPriced
     * —— 源里商品价格本来就是可空的。返回 `{ok, id?, unPriced?, error?}`。
     */
    addProduct(input) {
        const o = (input && typeof input === 'object') ? input : {};
        const name = String(o.name || '').trim();
        if (!name) return { ok: false, error: '得有个名字' };
        if (this.products.length >= TAOBAO_LIMITS.maxProducts) {
            return { ok: false, error: '目录满了（' + TAOBAO_LIMITS.maxProducts + ' 件）' };
        }
        this._seq += 1;
        const hasCents = (o.priceCents !== null && o.priceCents !== undefined && o.priceCents !== '');
        const hasYuan = (o.priceYuan !== null && o.priceYuan !== undefined && o.priceYuan !== '');
        const cents = hasCents ? yuanToCents(o.priceCents) : (hasYuan ? yuanToCents(o.priceYuan) : null);
        const p = normalizeProduct({ name, priceCents: cents, note: o.note }, this.products.length + this._seq * 1000);
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
        /* 车里的同一件也要摘 —— 否则它会以「已不在目录里」的形态留在车上。 */
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

    /* ---------- 下单 / 推演 ---------- */

    /** 下单：抽三个城市、把车快照成订单。返回 `{ok, orderId?, error?}`。 */
    doOrder() {
        const cities = pickCities(Math.random);
        const r = placeOrder(this.orders, this.cart, this.products, cities, Date.now());
        if (!r.order) return { ok: false, error: r.error || '下不了单' };
        this.orders = r.orders;
        this.cart = clearCart().cart;
        this._writeJSON(ORDERS_KEY, this.orders);
        this._writeJSON(CART_KEY, this.cart);
        this.probe();
        return { ok: true, orderId: r.order.id };
    }

    /** 显式推演一次（等价于 probe 里那次，但会把「刚推进了几单」回报出来）。 */
    doPush() {
        const r = applyLogistics(this.orders, Date.now(), this.settings.speedFactor);
        if (r.changed > 0) {
            this.orders = r.orders;
            this._writeJSON(ORDERS_KEY, this.orders);
        }
        const n = r.changed;
        this.probe();
        return { ok: true, changed: n, justReceived: r.justReceived };
    }

    removeOrder(orderId) {
        const id = String(orderId || '');
        const kept = this.orders.filter((o) => !o || o.id !== id);
        const removed = this.orders.length - kept.length;
        if (!removed) return { ok: false };
        this.orders = kept;
        this._writeJSON(ORDERS_KEY, this.orders);
        this.probe();
        return { ok: true };
    }

    /* ---------- 娃娃机 ---------- */

    /** 抓一次。战利品只登记面值（见文件头②）。返回 `{ok, entry, capped}`。 */
    doGrab(doll) {
        const tier = rollTier(Math.random);
        const r = recordGrab(this.grabs, tier, doll, Date.now(), this.settings.maxGrabs);
        this.grabs = r.grabs;
        this._writeJSON(GRABS_KEY, this.grabs);
        this.probe();
        return { ok: true, entry: r.entry, capped: r.capped };
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入「有几单在路上、最近那单走到哪一步」这一事实。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || projectTaobao(this.products, this.cart, this.orders, this.grabs, Date.now(), this.settings);
        return taobaoPromptBlock(proj, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到桃宝';
        if (!p.hasAny) return '还没有东西';
        const bits = [];
        if (p.pendingCount) bits.push(p.pendingCount + ' 单在路上');
        if (p.productCount) bits.push(p.productCount + ' 件商品');
        if (p.grabCount) bits.push('抓过 ' + p.grabCount + ' 次');
        return bits.join(' · ') || '还没有东西';
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
            this.settings = normalizeTaobaoSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultTaobaoSettings() }; }
    }

    saveSettings() {
        this._writeJSON(SETTINGS_KEY, this.settings);
    }

    patchSettings(patch) {
        this.settings = normalizeTaobaoSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：目录、车、订单、战利品都是「本会话的账」，故全部重取。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new TaobaoView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}

/** 车的条目形状规范化（只回形状，不剔条目 —— 剔除口径在 cartMissing / 视图层）。 */
function normalizeCartShape(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((x) => {
            const o = (x && typeof x === 'object') ? x : {};
            const productId = String(o.productId || '').trim();
            if (!productId) return null;
            const n = Number(o.qty);
            if (!Number.isFinite(n) || n <= 0) return null;
            return { productId, qty: Math.min(TAOBAO_LIMITS.maxQty, Math.round(n)) };
        })
        .filter(Boolean);
}