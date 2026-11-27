/* ========================================================
 * shop-view.js — [v4.168.0]「照现实重写」· 商城 App 视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 归因卡 + 读数 + 分类页签 + 商品 + 登记 + 分类管理 + 购物车
 *   + 下单 + 核销 + 订单 + 设置，全挤在一列；事件按 id / 类名逐元素绑。
 * 现实里的商城是四块：**店**（逛什么、登记什么）→ **车**（买什么）→ **单**（取没取）
 *   → **设置**（分类与口径）。
 *
 * 两处「不糊弄」照旧，一字未改：
 *   · 删商品 / 删分类 / 清目录 / 删订单一律两步确认（本仓不弹宿主 confirm）；
 *   · 车里有「已不在目录里」的条目时，把它**明着算出来**（`已失效 N 项`），不静默吞掉。
 *
 * 接线纪律（与心境 / 周期数学 / 幸运转盘 / 纪念日 / 小红书 / 天气 / 打卡 / 存钱罐同一套）：
 *   事件只在根容器上挂一次：click / input / change 各一个，靠 data-act 与 dataset 分派；
 *   读不到 DOM 不抛；钱一律整数分，显示过 formatCents，不自己拼小数。
 * ======================================================== */
'use strict';
import { SHOP_REASONS, SHOP_LIMITS, formatCents } from './shop-data.js';

const FACE_META = {
    [SHOP_REASONS.ready]: { icon: '\u2705', label: '目录里有商品', tone: 'ok' },
    [SHOP_REASONS.empty]: { icon: '\u{1f6d2}', label: '这个会话还没上架任何东西', tone: 'warn' },
    [SHOP_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const STATUS_LABEL = { pending: '待取', picked: '已取', canceled: '已取消' };

const TABS = [
    { key: 'store', label: '店' },
    { key: 'cart', label: '车' },
    { key: 'orders', label: '单' },
    { key: 'settings', label: '设置' },
];
/* [v4.215.0 · 照现实] 底栏真源别名：SHP_FACES 与 TABS 同一引用。 */
export const SHP_FACES = TABS;

const DASH = String.fromCharCode(45, 45);

export class ShopView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this.tab = 'store';
        /** 当前看的分类（'' = 全部；纯视图态） */
        this._cat = '';
        /** 登记商品的草稿（纯视图态） */
        this._draft = { name: '', priceYuan: '', category: 'general', note: '' };
        /** 分类草稿 */
        this._catDraft = { id: '', name: '' };
        /** 核销口令输入 */
        this._codeInput = '';
        /** 两步确认：`p:<id>` / `c:<id>` / `o:<id>` / `clear-p` */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
        this._boundRoot = null;
        this._hClick = null;
        this._hInput = null;
        this._hChange = null;
    }

    /* ---------- 1. 挂载与重绘 ---------- */

    /* [v4.215.0 · 照现实] v4 分层样式走 link 幂等注入投递。 */
    _loadV4CSS() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('shp-v4-css')) return;
        const link = document.createElement('link');
        link.id = 'shp-v4-css'; link.rel = 'stylesheet';
        link.href = new URL('./shop.v4.css', import.meta.url).href;
        document.head.appendChild(link);
    }

    render() {
        this._loadV4CSS();
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'shp-root';
        container.appendChild(this._root);
        this.refresh();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    /* ---------- 2. 取数（读不到就按空画，不抛） ---------- */

    _proj() {
        try {
            const p = this.app.projection();
            if (p && typeof p === 'object') return p;
        } catch (_e) { /* 归因条上会如实说明 */ }
        return {
            productCount: 0, unPricedCount: 0, categoryCount: 0, customCategoryCount: 0, byCat: {},
            cartCents: 0, cartCount: 0, cartRows: 0, cartMissing: 0,
            orderCount: 0, pendingOrders: [], pickedCount: 0, hasAny: false,
        };
    }

    _list(fn) {
        try {
            const v = this.app[fn]();
            if (Array.isArray(v)) return v;
        } catch (_e) { /* 同上 */ }
        return [];
    }

    _limits() {
        try {
            const l = this.app.limits();
            if (l && typeof l === 'object') return l;
        } catch (_e) { /* 回落到常量表 */ }
        return SHOP_LIMITS;
    }

    _catName(cats, id) {
        const hit = cats.find((c) => c.id === String(id));
        return hit ? hit.name : String(id || '');
    }

    /* ---------- 3. 四页 ---------- */

    _storeHTML(proj, cats, products, cart) {
        const limits = this._limits();
        const parts = ['<section class="shp-page" data-page="store">'];

        /* 分类页签（横向滚动的一排） */
        parts.push('<div class="shp-tabs">');
        parts.push('<button class="shp-tab' + (this._cat === '' ? ' is-on' : '') + '" data-act="cat" data-cat="">全部</button>');
        for (const c of cats) {
            const n = (proj.byCat && proj.byCat[c.id]) || 0;
            parts.push('<button class="shp-tab' + (this._cat === c.id ? ' is-on' : '') + '" data-act="cat" data-cat="'
                + this._esc(c.id) + '">' + this._esc(c.name) + '<span class="shp-tab-n">' + this._esc(String(n)) + '</span></button>');
        }
        parts.push('</div>');

        const shown = products.filter((p) => !this._cat || p.category === this._cat);
        parts.push('<div class="shp-list">');
        parts.push('<h3 class="shp-list-title">商品（' + this._esc(String(shown.length))
            + (this._cat ? (' / 共 ' + this._esc(String(products.length))) : '') + '）</h3>');
        if (!products.length) {
            parts.push('<div class="shp-empty">还没有商品。下面登记一件 —— 本 App 不替你生成商品，也不替你去问模型。</div>');
        } else if (!shown.length) {
            parts.push('<div class="shp-empty">这个分类下还没有东西。</div>');
        } else {
            for (const p of shown) {
                const inCart = cart.find((x) => x.productId === p.id);
                const armed = this._pendingConfirm === ('p:' + p.id);
                parts.push('<div class="shp-item" data-id="' + this._esc(p.id) + '">');
                parts.push('<div class="shp-item-main">');
                parts.push('<span class="shp-item-name">' + this._esc(p.name) + '</span>');
                parts.push('<span class="shp-item-cat">' + this._esc(this._catName(cats, p.category)) + '</span>');
                parts.push('<span class="shp-item-price">' + (p.unPriced ? '未定价' : this._esc(formatCents(p.priceCents))) + '</span>');
                if (inCart) parts.push('<span class="shp-item-incart">车里 ' + this._esc(String(inCart.qty)) + '</span>');
                parts.push('</div>');
                if (p.note) parts.push('<div class="shp-item-note">' + this._esc(p.note) + '</div>');
                parts.push('<div class="shp-item-actions">');
                parts.push('<button class="shp-mini" data-act="add-cart" data-id="' + this._esc(p.id) + '">加入购物车</button>');
                parts.push('<button class="shp-mini' + (armed ? ' shp-mini-armed' : '') + '" data-act="del-product" data-id="'
                    + this._esc(p.id) + '">' + (armed ? '确认删' : '删') + '</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        const d = this._draft;
        parts.push('<div class="shp-create">');
        parts.push('<h3 class="shp-list-title">登记一件商品</h3>');
        parts.push('<input class="shp-input" type="text" maxlength="' + String(limits.maxNameLen) + '" data-in="name"'
            + ' placeholder="叫什么" value="' + this._esc(d.name) + '">');
        parts.push('<div class="shp-create-row">');
        parts.push('<input class="shp-input shp-input-price" type="text" inputmode="decimal" data-in="priceYuan"'
            + ' placeholder="价格（元，可留空）" value="' + this._esc(d.priceYuan) + '">');
        parts.push('<select class="shp-input shp-input-cat" data-act="draft-cat">');
        for (const c of cats) {
            parts.push('<option value="' + this._esc(c.id) + '"' + (d.category === c.id ? ' selected' : '') + '>'
                + this._esc(c.name) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<input class="shp-input" type="text" maxlength="' + String(limits.maxNoteLen) + '" data-in="note"'
            + ' placeholder="一句备注（可留空）" value="' + this._esc(d.note) + '">');
        const clearArmed = this._pendingConfirm === 'clear-p';
        parts.push('<div class="shp-actions">');
        parts.push('<button class="shp-btn shp-btn-primary" data-act="add-product">登记</button>');
        parts.push('<button class="shp-mini shp-mini-armed" data-act="clear-products">'
            + (clearArmed ? '确认清空' : '清空目录') + '</button>');
        parts.push('</div>');
        parts.push('<div class="shp-hint">价格留空 = <strong>未定价</strong>（源里商品价格本来就可能是空的，'
            + '生成侧给不出价也得能挂出来），不计入合计。钱的单位一律是<strong>分</strong>的整数，'
            + '不会有 0.1 + 0.2 那种误差。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _cartHTML(proj, products, cart) {
        const limits = this._limits();
        const parts = ['<section class="shp-page" data-page="cart">'];
        parts.push('<div class="shp-cart">');
        parts.push('<h3 class="shp-list-title">购物车（' + this._esc(String(proj.cartCount)) + ' 件）</h3>');
        if (!cart.length) {
            parts.push('<div class="shp-empty">车是空的。去「店」加两件。</div>');
        } else {
            const byId = new Map(products.map((p) => [p.id, p]));
            for (const row of cart) {
                const p = byId.get(row.productId);
                parts.push('<div class="shp-cart-row' + (p ? '' : ' is-dead') + '">');
                parts.push('<span class="shp-cart-name">' + (p ? this._esc(p.name) : '\u26a0\ufe0f 已不在目录里') + '</span>');
                parts.push('<input class="shp-input shp-cart-qty" type="number" min="0" max="' + String(limits.maxQty)
                    + '" data-act="qty" data-id="' + this._esc(row.productId) + '" value="' + this._esc(String(row.qty)) + '">');
                parts.push('<span class="shp-cart-price">' + (p ? this._esc(formatCents(p.priceCents * row.qty)) : DASH) + '</span>');
                parts.push('<button class="shp-mini" data-act="cart-del" data-id="' + this._esc(row.productId) + '">摘</button>');
                parts.push('</div>');
            }
            parts.push('<div class="shp-cart-total">合计 <strong>' + this._esc(formatCents(proj.cartCents)) + '</strong>');
            if (proj.cartMissing) {
                parts.push('<span class="shp-warn-text">（有 ' + this._esc(String(proj.cartMissing))
                    + ' 项已失效，不计入）</span>');
            }
            parts.push('</div>');
        }
        parts.push('<div class="shp-actions">');
        parts.push('<button class="shp-btn shp-btn-primary" data-act="checkout"' + (cart.length ? '' : ' disabled') + '>下单</button>');
        parts.push('<button class="shp-mini" data-act="cart-clear"' + (cart.length ? '' : ' disabled') + '>清空车</button>');
        parts.push('</div>');
        parts.push('<div class="shp-hint">下单是<strong>快照</strong>：之后商品改名改价，已下的单一个字都不会跟着变。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _ordersHTML(orders) {
        const parts = ['<section class="shp-page" data-page="orders">'];
        parts.push('<div class="shp-orders">');
        parts.push('<h3 class="shp-list-title">取货（自提口令）</h3>');
        parts.push('<div class="shp-create-row">');
        parts.push('<input class="shp-input shp-input-code" type="text" maxlength="12" data-in="code"'
            + ' placeholder="自提口令（大小写、空格都无所谓）" value="' + this._esc(this._codeInput) + '">');
        parts.push('<button class="shp-mini" data-act="pickup">核销</button>');
        parts.push('</div>');
        parts.push('<h3 class="shp-list-title">订单（' + this._esc(String(orders.length)) + '）</h3>');
        if (!orders.length) {
            parts.push('<div class="shp-empty">还没有订单。</div>');
        } else {
            for (const o of orders) {
                const armed = this._pendingConfirm === ('o:' + o.id);
                parts.push('<div class="shp-order is-' + this._esc(o.status || 'pending') + '">');
                parts.push('<div class="shp-order-head">');
                parts.push('<span class="shp-order-code">' + this._esc(o.code) + '</span>');
                parts.push('<span class="shp-order-status">' + this._esc(STATUS_LABEL[o.status] || o.status) + '</span>');
                parts.push('<span class="shp-order-total">' + this._esc(formatCents(o.totalCents)) + '</span>');
                parts.push('</div>');
                parts.push('<div class="shp-order-rows">');
                for (const r of (Array.isArray(o.rows) ? o.rows : [])) {
                    parts.push('<span class="shp-order-row">' + this._esc(r.name) + '\u00d7' + this._esc(String(r.qty)) + '</span>');
                }
                parts.push('</div>');
                parts.push('<div class="shp-order-actions">');
                if (o.status === 'pending') {
                    parts.push('<button class="shp-mini" data-act="cancel-order" data-id="' + this._esc(o.id) + '">取消</button>');
                }
                parts.push('<button class="shp-mini' + (armed ? ' shp-mini-armed' : '') + '" data-act="del-order" data-id="'
                    + this._esc(o.id) + '">' + (armed ? '确认删' : '删') + '</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('<div class="shp-hint">口令是本 App <strong>签发</strong>的，不是从聊天正文里正则抠出来的：'
            + '正文换个写法就静默判「没找到」——不报错、只错结果。这里对不上就直说对不上。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _settingsHTML(proj, cats) {
        const settings = this.app.settings || {};
        const limits = this._limits();
        const parts = ['<section class="shp-page" data-page="settings">'];

        parts.push('<div class="shp-cats">');
        parts.push('<h3 class="shp-list-title">分类（' + this._esc(String(cats.length)) + '）</h3>');
        parts.push('<div class="shp-cat-list">');
        for (const c of cats) {
            const armed = this._pendingConfirm === ('c:' + c.id);
            parts.push('<div class="shp-cat' + (c.preset ? ' is-preset' : '') + '">');
            parts.push('<span class="shp-cat-name">' + this._esc(c.name) + '</span>');
            parts.push('<span class="shp-cat-id">' + this._esc(c.id) + '</span>');
            if (c.preset) {
                parts.push('<span class="shp-cat-tag">内置</span>');
            } else {
                parts.push('<button class="shp-mini' + (armed ? ' shp-mini-armed' : '') + '" data-act="del-cat" data-id="'
                    + this._esc(c.id) + '">' + (armed ? '确认删' : '删') + '</button>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="shp-create-row">');
        parts.push('<input class="shp-input shp-input-cid" type="text" maxlength="24" data-in="cid"'
            + ' placeholder="id（英文）" value="' + this._esc(this._catDraft.id) + '">');
        parts.push('<input class="shp-input" type="text" maxlength="' + String(limits.maxNameLen) + '" data-in="cname"'
            + ' placeholder="显示名" value="' + this._esc(this._catDraft.name) + '">');
        parts.push('<button class="shp-mini" data-act="add-cat">加</button>');
        parts.push('</div>');
        parts.push('<div class="shp-hint">内置那五个（推荐 / 食堂 / 百货 / 猜你喜欢 / Ta 想买）用的是<strong>源的 id</strong>，'
            + '不能占 —— 撞车会让同一个桶出现两条不同说法，界面上看不出来。删一个自定义分类，'
            + '它下面的商品<strong>不会跟着删</strong>，会落到「百货」。</div>');
        parts.push('</div>');

        parts.push('<div class="shp-settings">');
        parts.push('<h3 class="shp-list-title">设置</h3>');
        parts.push('<label class="shp-toggle"><span>把「待取自提」交给生成侧</span>'
            + '<input type="checkbox" data-act="inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="shp-field"><span>注入时带几单</span>'
            + '<input type="number" data-act="max-inject" min="0" max="20" value="'
            + this._esc(String(settings.maxInjectOrders)) + '"></label>');
        parts.push('<label class="shp-field"><span>每页显示</span>'
            + '<input type="number" data-act="page-size" min="1" max="50" value="'
            + this._esc(String(settings.pageSize)) + '"></label>');
        parts.push('<label class="shp-field"><span>最多留几单</span>'
            + '<input type="number" data-act="max-orders" min="10" max="500" value="'
            + this._esc(String(settings.maxOrders)) + '"></label>');
        parts.push('<div class="shp-hint">目录、车、订单都随会话走：换角色后那是另一个角色的另一个店。'
            + '本 App 只记你自己登记的东西：不替你生成商品，不碰聊天记录。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 4. 总装 ---------- */

    _buildHTML() {
        const app = this.app;
        let face = SHOP_REASONS.empty;
        try {
            if (typeof app.faceReason === 'function') face = app.faceReason();
        } catch (_e) { face = SHOP_REASONS.storage_absent; }
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = this._proj();
        const cats = this._list('categoriesList');
        const products = this._list('productsList');
        const cart = this._list('cartList');
        const orders = this._list('ordersList');

        const page = this.tab === 'cart' ? this._cartHTML(proj, products, cart)
            : (this.tab === 'orders' ? this._ordersHTML(orders)
                : (this.tab === 'settings' ? this._settingsHTML(proj, cats)
                    : this._storeHTML(proj, cats, products, cart)));

        const head = '<div class="shp-header"><h2>\u{1f6d2} 商城</h2>'
            + '<span class="shp-head-meta">' + this._esc(String(proj.productCount)) + ' 件 · 车 '
            + this._esc(formatCents(proj.cartCents)) + ' · 待取 ' + this._esc(String(proj.pendingOrders ? proj.pendingOrders.length : 0))
            + '</span></div>'
            + '<div class="shp-face shp-face-' + meta.tone + '">'
            + '<span class="shp-face-icon">' + meta.icon + '</span>'
            + '<span class="shp-face-label">' + this._esc(meta.label) + '</span></div>'
            + (this._flash ? '<div class="shp-flash">' + this._esc(this._flash) + '</div>' : '');

        const tabs = ['<nav class="shp-navbar" role="navigation" aria-label="主导航">']
            .concat(SHP_FACES.map((t) => '<button class="shp-nav' + (this.tab === t.key ? ' is-on' : '')
                + '" data-act="tab" data-tab="' + t.key + '" data-shp-face="' + t.key + '"' + (this.tab === t.key ? ' aria-current="page"' : '') + '>' + t.label + '</button>'))
            .concat(['</nav>'])
            .join('');
        return head + page + tabs;
    }

    /* ---------- 5. 事件（根容器各挂一次） ---------- */

    _bindEvents() {
        if (!this._root) return;
        if (this._boundRoot !== this._root) {
            this._hClick = (ev) => this._onClick(ev);
            this._hInput = (ev) => this._onInput(ev);
            this._hChange = (ev) => this._onChange(ev);
            this._root.addEventListener('click', this._hClick);
            this._root.addEventListener('input', this._hInput);
            this._root.addEventListener('change', this._hChange);
            this._boundRoot = this._root;
        }
    }

    /** 取元素：读不到就返回 null（宿主 DOM 不全会抛）。 */
    q(sel) {
        try { return this._root && this._root.querySelector ? this._root.querySelector(sel) : null; }
        catch (_e) { return null; }
    }

    _el(ev) { return (ev && ev.target) || null; }

    _attr(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    /** 读一条记录的 id：优先 dataset（事件回读的标准路径），再退到属性读。 */
    _id(el) {
        try {
            if (el && el.dataset && el.dataset.id) return String(el.dataset.id);
        } catch (_e) { /* 往下退 */ }
        return this._attr(el, 'data-id') || '';
    }

    /** 换页后把新一页滚回顶部：内容区是外层滚动容器，rewrite innerHTML 不会自己复位。 */
    _scrollTop() {
        const page = this.q('.shp-page');
        if (!page) return;
        try {
            if (typeof page.scrollIntoView === 'function') page.scrollIntoView({ block: 'start' });
        } catch (_e) { /* 宿主不认参数就作罢，不抛 */ }
    }

    /** 核销失败时把光标放回口令框：不然用户得自己再点一次。 */
    _focusCode() {
        const box = this.q('.shp-input-code');
        if (!box || typeof box.focus !== 'function') return;
        try {
            box.focus();
            if (typeof box.select === 'function') box.select();
        } catch (_e) { /* 同上 */ }
    }

    _hit(target) {
        return (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
    }

    _onInput(ev) {
        const el = this._el(ev);
        const field = this._attr(el, 'data-in');
        if (!field) return;
        if (field === 'code') { this._codeInput = el.value; return; }
        if (field === 'cid') { this._catDraft.id = el.value; return; }
        if (field === 'cname') { this._catDraft.name = el.value; return; }
        if (field in this._draft) this._draft[field] = el.value;
    }

    _onChange(ev) {
        const el = this._el(ev);
        const hit = this._hit(el);
        const act = this._attr(hit, 'data-act');
        if (!act) return;

        if (act === 'qty') { this.app.cartSet(this._id(hit), el.value); this.refresh(); return; }
        if (act === 'draft-cat') { this._draft.category = el.value || 'general'; return; }
        if (act === 'inject') {
            this.app.settings = Object.assign({}, this.app.settings, { injectToPrompt: !!(el && el.checked) });
            if (typeof this.app.saveSettings === 'function') this.app.saveSettings();
            return;
        }
        if (act === 'max-inject') { this.app.patchSettings({ maxInjectOrders: el.value }); return; }
        if (act === 'page-size') { this.app.patchSettings({ pageSize: el.value }); return; }
        if (act === 'max-orders') { this.app.patchSettings({ maxOrders: el.value }); return; }
    }

    _onClick(ev) {
        const target = this._el(ev);
        const hit = this._hit(target);
        const act = this._attr(hit, 'data-act');
        if (!act) return;

        if (act === 'tab') {
            const key = this._attr(hit, 'data-tab') || 'store';
            if (!TABS.some((t) => t.key === key)) return;
            const on = this.q('.shp-nav.is-on');
            if (on && this._attr(on, 'data-tab') === key) return;
            this.tab = key;
            this._pendingConfirm = '';
            this.refresh();
            this._scrollTop();
            return;
        }
        if (act === 'cat') {
            this._cat = this._attr(hit, 'data-cat') || '';
            this.refresh();
            return;
        }
        if (act === 'add-cart') {
            const r = this.app.cartAdd(this._id(hit), 1);
            if (!r.ok) this._flash = r.error || '加不进去';
            else if (r.clamped) this._flash = '数量到上限了（' + String(SHOP_LIMITS.maxQty) + '）';
            else this._flash = '';
            this.refresh();
            return;
        }
        if (act === 'del-product') {
            const id = this._id(hit);
            if (this._pendingConfirm !== ('p:' + id)) { this._pendingConfirm = 'p:' + id; this.refresh(); return; }
            this._pendingConfirm = '';
            this.app.removeProduct(id);
            this._flash = '删掉一件商品';
            this.refresh();
            return;
        }
        if (act === 'add-product') {
            const r = this.app.addProduct({
                name: this._draft.name,
                priceYuan: this._draft.priceYuan,
                category: this._draft.category,
                note: this._draft.note,
            });
            if (!r.ok) { this._flash = r.error || '登记失败'; this.refresh(); return; }
            this._flash = r.unPriced ? '登记好了（没填价，标成未定价）' : '登记好了';
            this._draft = { name: '', priceYuan: '', category: this._draft.category, note: '' };
            this.refresh();
            return;
        }
        if (act === 'clear-products') {
            if (this._pendingConfirm !== 'clear-p') { this._pendingConfirm = 'clear-p'; this.refresh(); return; }
            this._pendingConfirm = '';
            const n = this.app.clearProducts();
            this._flash = n ? ('清掉了 ' + String(n) + ' 件') : '本来就是空的';
            this.refresh();
            return;
        }
        if (act === 'cart-del') { this.app.cartRemove(this._id(hit)); this.refresh(); return; }
        if (act === 'cart-clear') { this.app.cartClear(); this.refresh(); return; }
        if (act === 'checkout') {
            const r = this.app.doCheckout();
            if (!r.ok) { this._flash = r.error || '下不了单'; this.refresh(); return; }
            this._codeInput = r.code;
            this._flash = '下单了 · 口令 ' + String(r.code) + '（' + formatCents(r.totalCents) + '）';
            this.refresh();
            return;
        }
        if (act === 'pickup') {
            const r = this.app.doPickup(this._codeInput);
            this._flash = r.ok ? '核销成功' : (r.error || '核销失败');
            if (r.ok) this._codeInput = '';
            this.refresh();
            if (!r.ok) this._focusCode();
            return;
        }
        if (act === 'cancel-order') { this.app.doCancel(this._id(hit)); this.refresh(); return; }
        if (act === 'del-order') {
            const id = this._id(hit);
            if (this._pendingConfirm !== ('o:' + id)) { this._pendingConfirm = 'o:' + id; this.refresh(); return; }
            this._pendingConfirm = '';
            this.app.doRemoveOrder(id);
            this._flash = '删掉一单';
            this.refresh();
            return;
        }
        if (act === 'add-cat') {
            const r = this.app.addCategory({ id: this._catDraft.id, name: this._catDraft.name });
            if (!r.ok) { this._flash = r.error || '加不了'; this.refresh(); return; }
            this._flash = '分类加好了';
            this._catDraft = { id: '', name: '' };
            this.refresh();
            return;
        }
        if (act === 'del-cat') {
            const id = this._id(hit);
            if (this._pendingConfirm !== ('c:' + id)) { this._pendingConfirm = 'c:' + id; this.refresh(); return; }
            this._pendingConfirm = '';
            const r = this.app.removeCategory(id);
            this._flash = (r && r.movedToGeneral)
                ? ('分类删了，' + String(r.movedToGeneral) + ' 件商品落到「百货」') : '分类删了';
            if (this._cat === id) this._cat = '';
            this.refresh();
        }
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}

export default ShopView;