/* ========================================================
 * shop-view.js — [v3.27.0] 商城 App 视图
 * 归因卡 + 商品目录（登记/删）+ 分类 + 购物车 + 下单口令 + 订单列表 + 设置
 *
 * 与 focus-view / piggy-view / punchcard-view 同纪律：归因文案表的键取 SHOP_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 两处「不糊弄」：
 *   · 删商品 / 删分类 / 清目录一律**两步确认**（本仓不弹宿主 confirm）；
 *   · 车里有「已不在目录里」的条目时，把它**明着算出来**（`已失效 N 项`），不静默吞掉。
 * ======================================================== */
'use strict';
import { SHOP_REASONS, SHOP_LIMITS, formatCents } from './shop-data.js';

const FACE_META = {
    [SHOP_REASONS.ready]: { icon: '\u2705', label: '目录里有商品', tone: 'ok' },
    [SHOP_REASONS.empty]: { icon: '\u{1f6d2}', label: '这个会话还没上架任何东西', tone: 'warn' },
    [SHOP_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const STATUS_LABEL = { pending: '待取', picked: '已取', canceled: '已取消' };

export class ShopView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 登记商品的草稿（纯视图态，不落盘） */
        this._draft = { name: '', priceYuan: '', category: 'general', note: '' };
        /** 分类草稿 */
        this._catDraft = { id: '', name: '' };
        /** 核销口令输入 */
        this._codeInput = '';
        /** 当前看的分类页签（'' = 全部） */
        this._tab = '';
        /** 两步确认 */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'shp-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || {
            productCount: 0, unPricedCount: 0, categoryCount: 5, customCategoryCount: 0, byCat: {},
            cartCents: 0, cartCount: 0, cartRows: 0, cartMissing: 0,
            orderCount: 0, pendingOrders: [], pickedCount: 0, hasAny: false,
        };
        const settings = app.settings;
        const limits = app.limits();
        const cats = app.categoriesList();
        const products = app.productsList();
        const cart = app.cartList();
        const orders = app.ordersList();
        const parts = [];

        parts.push('<div class="shp-header"><h2>\u{1f6d2} 商城</h2></div>');

        parts.push('<div class="shp-face shp-face-' + meta.tone + '">');
        parts.push('<span class="shp-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="shp-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) {
            parts.push('<div class="shp-flash">' + this._esc(this._flash) + '</div>');
        }

        /* ---------- 读数 ---------- */
        parts.push('<div class="shp-stats">');
        parts.push('<div class="shp-stat-row"><span>目录</span><span>' + proj.productCount + ' / ' + limits.maxProducts + ' 件</span></div>');
        if (proj.unPricedCount) {
            parts.push('<div class="shp-stat-row shp-warn"><span>没定价</span><span>' + proj.unPricedCount + ' 件</span></div>');
        }
        parts.push('<div class="shp-stat-row"><span>分类</span><span>' + proj.categoryCount
            + '（自定义 ' + proj.customCategoryCount + '）</span></div>');
        parts.push('<div class="shp-stat-row"><span>购物车</span><span>' + formatCents(proj.cartCents)
            + ' · ' + proj.cartCount + ' 件' + (proj.cartMissing ? (' · <em>已失效 ' + proj.cartMissing + ' 项</em>') : '') + '</span></div>');
        parts.push('<div class="shp-stat-row"><span>订单</span><span>' + proj.orderCount
            + ' 单（待取 ' + proj.pendingOrders.length + ' / 已取 ' + proj.pickedCount + '）</span></div>');
        parts.push('</div>');

        /* ---------- 分类页签 ---------- */
        parts.push('<div class="shp-tabs">');
        parts.push('<button class="shp-tab' + (this._tab === '' ? ' is-on' : '') + '" data-cat="">全部</button>');
        for (const c of cats) {
            const n = proj.byCat[c.id] || 0;
            parts.push('<button class="shp-tab' + (this._tab === c.id ? ' is-on' : '') + '" data-cat="' + this._esc(c.id) + '">'
                + this._esc(c.name) + '<span class="shp-tab-n">' + n + '</span></button>');
        }
        parts.push('</div>');

        /* ---------- 商品目录 ---------- */
        const shown = products.filter((p) => !this._tab || p.category === this._tab);
        parts.push('<div class="shp-list">');
        parts.push('<h3 class="shp-list-title">商品（' + shown.length + (this._tab ? (' / 共 ' + products.length) : '') + '）</h3>');
        if (!products.length) {
            parts.push('<div class="shp-empty">还没有商品。下面登记一件 —— 本 App 不替你生成商品，也不替你去问模型。</div>');
        } else if (!shown.length) {
            parts.push('<div class="shp-empty">这个分类下还没有东西。</div>');
        } else {
            for (const p of shown) {
                const inCart = cart.find((x) => x.productId === p.id);
                parts.push('<div class="shp-item" data-id="' + this._esc(p.id) + '">');
                parts.push('<div class="shp-item-main">');
                parts.push('<span class="shp-item-name">' + this._esc(p.name) + '</span>');
                parts.push('<span class="shp-item-cat">' + this._esc(this._catName(cats, p.category)) + '</span>');
                parts.push('<span class="shp-item-price">' + (p.unPriced ? '未定价' : formatCents(p.priceCents)) + '</span>');
                if (inCart) parts.push('<span class="shp-item-incart">车里 ' + inCart.qty + '</span>');
                parts.push('</div>');
                if (p.note) parts.push('<div class="shp-item-note">' + this._esc(p.note) + '</div>');
                parts.push('<div class="shp-item-actions">');
                parts.push('<button class="shp-mini shp-add-cart" data-id="' + this._esc(p.id) + '">加入购物车</button>');
                parts.push('<button class="shp-mini shp-item-del" data-id="' + this._esc(p.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 登记商品 ---------- */
        parts.push('<div class="shp-create">');
        parts.push('<h3 class="shp-list-title">登记一件商品</h3>');
        parts.push('<input class="shp-input" id="shp-p-name" type="text" maxlength="' + limits.maxNameLen
            + '" placeholder="叫什么" value="' + this._esc(this._draft.name) + '">');
        parts.push('<div class="shp-create-row">');
        parts.push('<input class="shp-input shp-input-price" id="shp-p-price" type="text" inputmode="decimal" placeholder="价格（元，可留空）" value="' + this._esc(this._draft.priceYuan) + '">');
        parts.push('<select class="shp-input shp-input-cat" id="shp-p-cat">');
        for (const c of cats) {
            parts.push('<option value="' + this._esc(c.id) + '"' + (this._draft.category === c.id ? ' selected' : '') + '>'
                + this._esc(c.name) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<input class="shp-input" id="shp-p-note" type="text" maxlength="' + limits.maxNoteLen
            + '" placeholder="一句备注（可留空）" value="' + this._esc(this._draft.note) + '">');
        parts.push('<div class="shp-actions">');
        parts.push('<button class="shp-btn shp-btn-primary" id="shp-p-add">登记</button>');
        parts.push('<button class="shp-mini shp-mini-armed" id="shp-clear-products">清空目录</button>');
        parts.push('</div>');
        parts.push('<div class="shp-hint">价格留空 = **未定价**（源里商品价格本来就可能是空的，生成侧给不出价也得能挂出来），'
            + '不计入合计。钱的单位一律是**分**的整数，不会有 0.1+0.2 那种误差。</div>');
        parts.push('</div>');

        /* ---------- 分类 ---------- */
        parts.push('<div class="shp-cats">');
        parts.push('<h3 class="shp-list-title">分类</h3>');
        parts.push('<div class="shp-cat-list">');
        for (const c of cats) {
            parts.push('<div class="shp-cat' + (c.preset ? ' is-preset' : '') + '">');
            parts.push('<span class="shp-cat-name">' + this._esc(c.name) + '</span>');
            parts.push('<span class="shp-cat-id">' + this._esc(c.id) + '</span>');
            if (c.preset) {
                parts.push('<span class="shp-cat-tag">内置</span>');
            } else {
                parts.push('<button class="shp-mini shp-cat-del" data-id="' + this._esc(c.id) + '">删</button>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="shp-create-row">');
        parts.push('<input class="shp-input shp-input-cid" id="shp-c-id" type="text" maxlength="24" placeholder="id（英文）" value="' + this._esc(this._catDraft.id) + '">');
        parts.push('<input class="shp-input" id="shp-c-name" type="text" maxlength="' + limits.maxNameLen + '" placeholder="显示名" value="' + this._esc(this._catDraft.name) + '">');
        parts.push('<button class="shp-mini" id="shp-c-add">加</button>');
        parts.push('</div>');
        parts.push('<div class="shp-hint">内置那五个（推荐 / 食堂 / 百货 / 猜你喜欢 / Ta 想买）用的是**源的 id**，'
            + '不能占 —— 撞车会让同一个桶出现两条不同说明，界面上看不出来。删一个自定义分类，'
            + '它下面的商品**不会跟着删**，会落到「百货」。</div>');
        parts.push('</div>');

        /* ---------- 购物车 ---------- */
        parts.push('<div class="shp-cart">');
        parts.push('<h3 class="shp-list-title">购物车</h3>');
        if (!cart.length) {
            parts.push('<div class="shp-empty">车是空的。</div>');
        } else {
            const byId = new Map(products.map((p) => [p.id, p]));
            for (const row of cart) {
                const p = byId.get(row.productId);
                parts.push('<div class="shp-cart-row' + (p ? '' : ' is-dead') + '">');
                parts.push('<span class="shp-cart-name">' + (p ? this._esc(p.name) : '\u26a0\ufe0f 已不在目录里') + '</span>');
                parts.push('<input class="shp-input shp-cart-qty" type="number" min="0" max="' + limits.maxQty
                    + '" value="' + row.qty + '" data-id="' + this._esc(row.productId) + '">');
                parts.push('<span class="shp-cart-price">' + (p ? formatCents(p.priceCents * row.qty) : '\u2014') + '</span>');
                parts.push('<button class="shp-mini shp-cart-del" data-id="' + this._esc(row.productId) + '">摘</button>');
                parts.push('</div>');
            }
            parts.push('<div class="shp-cart-total">合计 <strong>' + formatCents(proj.cartCents) + '</strong>');
            if (proj.cartMissing) parts.push('<span class="shp-warn-text">（有 ' + proj.cartMissing + ' 项已失效，不计入）</span>');
            parts.push('</div>');
        }
        parts.push('<div class="shp-actions">');
        parts.push('<button class="shp-btn shp-btn-primary" id="shp-checkout"' + (cart.length ? '' : ' disabled') + '>下单</button>');
        parts.push('<button class="shp-mini" id="shp-cart-clear"' + (cart.length ? '' : ' disabled') + '>清空车</button>');
        parts.push('</div>');
        parts.push('</div>');

        /* ---------- 订单 + 核销 ---------- */
        parts.push('<div class="shp-orders">');
        parts.push('<h3 class="shp-list-title">订单（' + orders.length + '）</h3>');
        parts.push('<div class="shp-create-row">');
        parts.push('<input class="shp-input" id="shp-code" type="text" maxlength="12" placeholder="自提口令（大小写、空格都无所谓）" value="' + this._esc(this._codeInput) + '">');
        parts.push('<button class="shp-mini" id="shp-pickup">核销</button>');
        parts.push('</div>');
        if (!orders.length) {
            parts.push('<div class="shp-empty">还没有订单。</div>');
        } else {
            for (const o of orders) {
                parts.push('<div class="shp-order is-' + this._esc(o.status || 'pending') + '">');
                parts.push('<div class="shp-order-head">');
                parts.push('<span class="shp-order-code">' + this._esc(o.code) + '</span>');
                parts.push('<span class="shp-order-status">' + this._esc(STATUS_LABEL[o.status] || o.status) + '</span>');
                parts.push('<span class="shp-order-total">' + formatCents(o.totalCents) + '</span>');
                parts.push('</div>');
                parts.push('<div class="shp-order-rows">');
                for (const r of (Array.isArray(o.rows) ? o.rows : [])) {
                    parts.push('<span class="shp-order-row">' + this._esc(r.name) + '\u00d7' + r.qty + '</span>');
                }
                parts.push('</div>');
                parts.push('<div class="shp-order-actions">');
                if (o.status === 'pending') parts.push('<button class="shp-mini shp-order-cancel" data-id="' + this._esc(o.id) + '">取消</button>');
                parts.push('<button class="shp-mini shp-order-del" data-id="' + this._esc(o.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('<div class="shp-hint">口令是**本 App 签发的**：源是从聊天正文里拿正则抠口令，'
            + '正文换个写法就静默判「没找到」——不报错、只错结果。这里对不上就直说对不上。</div>');
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="shp-settings">');
        parts.push('<h3 class="shp-list-title">设置</h3>');
        parts.push('<label class="shp-toggle"><span>把「待取自提」交给生成侧</span>'
            + '<input type="checkbox" id="shp-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="shp-field"><span>注入时带几单</span>'
            + '<input type="number" id="shp-max-inject" min="0" max="20" value="' + settings.maxInjectOrders + '"></label>');
        parts.push('<label class="shp-field"><span>每页显示</span>'
            + '<input type="number" id="shp-page-size" min="1" max="50" value="' + settings.pageSize + '"></label>');
        parts.push('<label class="shp-field"><span>最多留几单</span>'
            + '<input type="number" id="shp-max-orders" min="10" max="500" value="' + settings.maxOrders + '"></label>');
        parts.push('<div class="shp-hint">目录、车、订单都随会话走：换角色后那是另一个角色的另一个店。'
            + '本 App 只记你自己登记的东西：不替你生成商品，不碰聊天记录。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _catName(cats, id) {
        const hit = cats.find((c) => c.id === String(id));
        return hit ? hit.name : String(id || '');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        /* 分类页签 */
        for (const b of this._root.querySelectorAll('.shp-tab')) {
            b.addEventListener('click', () => { this._tab = b.dataset.cat || ''; this.refresh(); });
        }

        /* 加入购物车 */
        for (const b of this._root.querySelectorAll('.shp-add-cart')) {
            b.addEventListener('click', () => {
                const r = app.cartAdd(b.dataset.id, 1);
                if (!r.ok) { this._flash = r.error || '加不进去'; }
                else if (r.clamped) { this._flash = '数量到上限了（' + SHOP_LIMITS.maxQty + '）'; }
                else { this._flash = ''; }
                this.refresh();
            });
        }

        /* 删商品（两步确认） */
        for (const b of this._root.querySelectorAll('.shp-item-del')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                if (this._needConfirm('shp-p:' + id, b)) return;
                app.removeProduct(id);
                this.refresh();
            });
        }

        /* 登记商品 */
        const pName = q('#shp-p-name');
        if (pName) pName.addEventListener('input', () => { this._draft.name = pName.value; });
        const pPrice = q('#shp-p-price');
        if (pPrice) pPrice.addEventListener('input', () => { this._draft.priceYuan = pPrice.value; });
        const pCat = q('#shp-p-cat');
        if (pCat) pCat.addEventListener('change', () => { this._draft.category = pCat.value; });
        const pNote = q('#shp-p-note');
        if (pNote) pNote.addEventListener('input', () => { this._draft.note = pNote.value; });
        const pAdd = q('#shp-p-add');
        if (pAdd) pAdd.addEventListener('click', () => {
            const r = app.addProduct({
                name: this._draft.name,
                priceYuan: this._draft.priceYuan,
                category: this._draft.category,
                note: this._draft.note,
            });
            if (!r.ok) { this._flash = r.error || '登记失败'; this.refresh(); return; }
            this._flash = r.unPriced ? '登记好了（没填价，标成未定价）' : '登记好了';
            this._draft = { name: '', priceYuan: '', category: this._draft.category, note: '' };
            this.refresh();
        });

        const clearP = q('#shp-clear-products');
        if (clearP) clearP.addEventListener('click', () => {
            if (this._needConfirm('shp-clear-p', clearP)) return;
            const n = app.clearProducts();
            this._flash = n ? ('清掉了 ' + n + ' 件') : '本来就是空的';
            this.refresh();
        });

        /* 分类 */
        const cId = q('#shp-c-id');
        if (cId) cId.addEventListener('input', () => { this._catDraft.id = cId.value; });
        const cName = q('#shp-c-name');
        if (cName) cName.addEventListener('input', () => { this._catDraft.name = cName.value; });
        const cAdd = q('#shp-c-add');
        if (cAdd) cAdd.addEventListener('click', () => {
            const r = app.addCategory({ id: this._catDraft.id, name: this._catDraft.name });
            if (!r.ok) { this._flash = r.error || '加不了'; this.refresh(); return; }
            this._flash = '分类加好了';
            this._catDraft = { id: '', name: '' };
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('.shp-cat-del')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                if (this._needConfirm('shp-c:' + id, b)) return;
                const r = app.removeCategory(id);
                this._flash = r.movedToGeneral
                    ? ('分类删了，' + r.movedToGeneral + ' 件商品落到「百货」')
                    : '分类删了';
                if (this._tab === id) this._tab = '';
                this.refresh();
            });
        }

        /* 购物车 */
        for (const el of this._root.querySelectorAll('.shp-cart-qty')) {
            el.addEventListener('change', () => {
                app.cartSet(el.dataset.id, el.value);
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('.shp-cart-del')) {
            b.addEventListener('click', () => {
                app.cartRemove(b.dataset.id);
                this.refresh();
            });
        }
        const cartClear = q('#shp-cart-clear');
        if (cartClear) cartClear.addEventListener('click', () => { app.cartClear(); this.refresh(); });
        const checkout = q('#shp-checkout');
        if (checkout) checkout.addEventListener('click', () => {
            const r = app.doCheckout();
            if (!r.ok) { this._flash = r.error || '下不了单'; this.refresh(); return; }
            this._codeInput = r.code;
            this._flash = '下单了 · 口令 ' + r.code + '（' + formatCents(r.totalCents) + '）';
            this.refresh();
        });

        /* 核销 / 订单 */
        const code = q('#shp-code');
        if (code) code.addEventListener('input', () => { this._codeInput = code.value; });
        const pickup = q('#shp-pickup');
        if (pickup) pickup.addEventListener('click', () => {
            const r = app.doPickup(this._codeInput);
            this._flash = r.ok ? '核销成功' : (r.error || '核销失败');
            if (r.ok) this._codeInput = '';
            this.refresh();
        });
        for (const b of this._root.querySelectorAll('.shp-order-cancel')) {
            b.addEventListener('click', () => {
                app.doCancel(b.dataset.id);
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('.shp-order-del')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                if (this._needConfirm('shp-o:' + id, b)) return;
                app.doRemoveOrder(id);
                this.refresh();
            });
        }

        /* 设置 */
        const inject = q('#shp-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxInject = q('#shp-max-inject');
        if (maxInject) maxInject.addEventListener('change', (e) => app.patchSettings({ maxInjectOrders: e.target.value }));
        const pageSize = q('#shp-page-size');
        if (pageSize) pageSize.addEventListener('change', (e) => app.patchSettings({ pageSize: e.target.value }));
        const maxOrders = q('#shp-max-orders');
        if (maxOrders) maxOrders.addEventListener('change', (e) => app.patchSettings({ maxOrders: e.target.value }));
    }

    /** 两步确认（删商品/分类/订单不可逆，而本仓不弹宿主 confirm）。 */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('shp-mini-armed'); }
        return true;
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}