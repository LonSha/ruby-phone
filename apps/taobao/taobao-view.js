/* ========================================================
 * RubyPhone — SillyTavern 虚拟智能手机 UI
 * 作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
/* ============================================================
 * apps/taobao/taobao-view.js — 桃宝视图层（v4.163.0 照现实重写）
 * ------------------------------------------------------------
 * 上一版的形态：**一页到底** —— 归因卡 + 目录 + 购物车 + 订单 + 娃娃机 + 设置
 * 全堆在同一条滚动里，`_bindEvents()` 每绘一次就各挂一遍监听。它在「把功能都
 * 摆出来」这件事上没错，但现实里的桃宝不是一页：是**首页（搜索 + 金刚区 +
 * 商品流）→ 商品详情 → 购物车 → 订单（状态页签）→ 物流详情 → 我的**，靠底部
 * 页签在几个大面之间跳。
 *
 * 【三条落地纪律（与本仓门禁一一对应，不是风格偏好）】
 *   ① **事件委托**：整页重绘不能把监听丢了，也不能每绘一次多挂一份。监听只挂
 *      在容器上（`_syncBinding` 按容器身份去重），页面内一切交互走
 *      `[data-act]` + `closest()`；
 *   ② **不弹宿主对话框**：`alert/confirm/prompt` 会卡住 SillyTavern 的消息流。
 *      提示一律自绘 `.tbo-toast`；删除这类不可逆动作走**两步确认**（按钮就地
 *      变「确认删除」，再点一次才真做）；
 *   ③ **宿主读不到也不许抛**：单测夹具的 querySelector 返回 null、
 *      getBoundingClientRect 不存在。所有 DOM 读取都走 `_q()` + 空判断。
 *
 * 【刻意不做的事（逐条写清，免得下一个人以为是漏了）】
 *   · 不做「立即付款」按钮：本仓用户钱包的仲裁源是微信零钱，桃宝没有钱包
 *     仲裁权，故订单状态**只由时间推演**，界面上写明这一点，不画一个点了也
 *     不发生什么的假按钮；
 *   · 不做「猜你喜欢」：首页商品流就是**用户登记过的目录**按销量/价格排序，
 *     不生成商品、不编评价（源里的 `generateProductReviews` 一条都没收）；
 *   · 娃娃机战利品只显示面值、写明「不入账」；
 *   · 不自己算时间：物流读数全部来自数据层的纯函数推演（`logisticsOf`）。
 * ============================================================ */
'use strict';
import {
    TAOBAO_REASONS, REWARD_TIERS,
    formatCents, statusTextOf, searchProducts, sortProducts, cartCheckedTotals,
} from './taobao-data.js';

/** 归因三态的界面文案（键取数据层的**值**）。 */
const FACE_META = {
    [TAOBAO_REASONS.ready]: { icon: '✅', label: '桃宝开着', tone: 'ok' },
    [TAOBAO_REASONS.empty]: { icon: '🛒', label: '这个会话还没上架任何东西', tone: 'warn' },
    [TAOBAO_REASONS.storage_absent]: { icon: '⚠️', label: '存储不可用（读数拿不到）', tone: 'err' },
};

/** 底部页签 —— 照官方淘宝 10.69.16 的五格：首页 / 逛逛 / 消息 / 购物车 / 我的。
 *  【与官方对齐的三处改动】
 *   ① 官方底栏是**五格**，且**订单不在底栏** —— 订单挂在「我的」下面（我的 → 全部订单）。
 *      旧实现把「订单」抬成底栏一格，等于把二级页当成一级页，跳转层级与官方不同；
 *   ② 「逛逛」是淘宝的内容流一级入口，本仓无实现：照官方位置与文案列出，
 *      标 is-disabled + aria-disabled + 降到 .38，点了给一句真话；
 *   ③ 「消息」同理（本仓站内信没有落地），也照官方列出并标禁用。
 *  真正可用的三格（首页 / 购物车 / 我的）保持原有实现与事件，一行行为不改。 */
const TABS = [
    { key: 'home', label: '首页', icon: 'fa-solid fa-house' },
    { key: 'guang', label: '逛逛', icon: 'fa-solid fa-compass', disabled: true },
    { key: 'msg', label: '消息', icon: 'fa-solid fa-comment-dots', disabled: true },
    { key: 'cart', label: '购物车', icon: 'fa-solid fa-cart-shopping' },
    { key: 'mine', label: '我的', icon: 'fa-solid fa-user' },
];
/* [v4.215.0 · 照现实] 底栏真源别名：TBO_FACES 与 TABS 同一引用，不另写格表。 */
export const TBO_FACES = TABS;

/** 订单页的状态页签（键就是数据层 `ORDER_STATUS` 的键）。 */
const ORDER_TABS = [
    { key: 'all', label: '全部' },
    { key: 'placed', label: '待付款' },
    { key: 'paid', label: '待发货' },
    { key: 'shipped', label: '待收货' },
    /* 状态文案不在视图里另写一份：取数据层 statusTextOf。 */
    { key: 'received', label: statusTextOf('received') },
];

/** 排序键 → 文案。数据层只认键，文案留在视图（换文案不动数据）。 */
const SORTS = [
    { key: 'default', label: '综合' },
    { key: 'sales', label: '销量' },
    { key: 'priceUp', label: '价格↑' },
    { key: 'priceDown', label: '价格↓' },
];

const STATUS_TONE = { placed: 'gray', paid: 'blue', shipped: 'orange', received: 'green' };

export class TaobaoView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this.container = null;
        /** 页面栈只存页面名：返回键弹一层，弹空即回桌面。 */
        this.page = 'home';
        this.stack = [];
        this.tabKey = 'home';
        this.kw = '';
        this.sortKey = 'default';
        this.detailId = '';
        this.orderTab = 'all';
        this.logiId = '';
        this.checked = new Set();
        this.draft = { name: '', priceYuan: '', note: '' };
        this.flash = '';
        this.grabLog = '';
        this._pending = '';
        this._boundEl = null;
        this._hClick = null;
        this._hKey = null;
    }

    /* [v4.215.0 · 照现实] taobao v4 分层样式走 link 幂等注入投递。 */
    _loadV4CSS() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('tbo-v4-css')) return;
        const link = document.createElement('link');
        link.id = 'tbo-v4-css';
        link.rel = 'stylesheet';
        link.href = new URL('./taobao.v4.css', import.meta.url).href;
        document.head.appendChild(link);
    }

    /* ================= 1. 生命周期 ================= */
    render() {
        this._loadV4CSS();
        const c = (this.shell && typeof this.shell.getContentContainer === 'function')
            ? this.shell.getContentContainer()
            : null;
        if (!c) return;
        this.container = c;
        this._syncBinding(c);
        this._paint();
    }

    /** 数据变了就地重画，页面状态保留。 */
    refresh() {
        if (!this.container) return;
        this._paint();
    }

    _syncBinding(c) {
        if (this._boundEl === c) return;
        const old = this._boundEl;
        if (old && this._hClick && typeof old.removeEventListener === 'function') {
            try {
                old.removeEventListener('click', this._hClick);
                if (this._hKey) old.removeEventListener('keydown', this._hKey);
            } catch (_e) { /* 老容器已经死了：忽略 */ }
        }
        this._hClick = (ev) => this._handleClick(ev);
        this._hKey = (ev) => this._handleKey(ev);
        if (typeof c.addEventListener === 'function') {
            c.addEventListener('click', this._hClick);
            c.addEventListener('keydown', this._hKey);
        }
        this._boundEl = c;
    }

    /* ================= 2. 小工具 ================= */

    _q(sel) {
        const c = this.container;
        if (!c || typeof c.querySelector !== 'function') return null;
        try { return c.querySelector(sel); } catch (_e) { return null; }
    }

    _attr(el, name) {
        if (!el || !el.getAttribute) return '';
        try {
            const v = el.getAttribute('data-' + name);
            return v == null ? '' : String(v);
        } catch (_e) { return ''; }
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&#34;')
            .replace(/'/g, '&#39;');
    }

    /** 时长人话：秒 / 分 / 小时 / 天。 */
    _dur(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '不到 1 秒';
        const s = Math.round(n / 1000);
        if (s < 60) return s + ' 秒';
        const m = Math.round(s / 60);
        if (m < 60) return m + ' 分钟';
        const h = Math.floor(m / 60);
        const rm = m % 60;
        if (h < 24) return rm ? (h + ' 小时 ' + rm + ' 分') : (h + ' 小时');
        const d = Math.floor(h / 24);
        const rh = h % 24;
        return rh ? (d + ' 天 ' + rh + ' 小时') : (d + ' 天');
    }

    /** 同一件商品的色块取色是稳定的（重绘不换色）。 */
    _tone(id) {
        const s = String(id || '');
        let h = 0;
        for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 997;
        return String(h % 6);
    }

    /* ================= 3. 页面栈 ================= */

    _nav(page, extra) {
        const e = extra || {};
        this.stack.push(this.page);
        this.page = page;
        if (page === 'detail') this.detailId = String(e.id || this.detailId || '');
        if (page === 'logi') this.logiId = String(e.id || this.logiId || '');
        this.flash = '';
        this._pending = '';
        this._paint();
    }

    _tabTo(page) {
        this.page = page;
        this.tabKey = page;
        this.stack = [];
        this.flash = '';
        this._pending = '';
        this._paint();
    }

    _back() {
        if (this.stack.length) {
            this.page = this.stack.pop();
            this._pending = '';
            this._paint();
            return;
        }
        /* 栈空 ⇒ 回桌面（与现实里「返回键退出 App」一致）；宿主没这能力就留在原地。 */
        try {
            if (this.shell && typeof this.shell.goHome === 'function') { this.shell.goHome(); return; }
        } catch (_e) { /* 宿主没有 goHome：忽略 */ }
        this.page = 'home';
        this.tabKey = 'home';
        this._paint();
    }

    _toast(msg) {
        this.flash = String(msg || '');
        this._paint();
    }

    /* ================= 4. 骨架 ================= */

    _paint() {
        if (!this.container) return;
        /* 重绘是整段换 innerHTML：滚动位置必须自己接住，否则点一下「加购」页面就弹回顶部。
         * 这两处用**字面**选择器：读的就是写死的那一个容器，不是动态缓存的类名。 */
        let keepTop = 0;
        try {
            const prev = this.container.querySelector('.tbo-page');
            if (prev) keepTop = prev.scrollTop || 0;
        } catch (_e) { keepTop = 0; }
        const html = '<div class="tbo-app">' + this._pageHTML() + this._tabbarHTML() + this._toastHTML() + '</div>';
        try { this.container.innerHTML = html; } catch (_e) { /* 夹具里 innerHTML 可能是只读桩 */ }
        if (keepTop > 0) {
            try {
                const next = this.container.querySelector('.tbo-page');
                if (next) next.scrollTop = keepTop;
            } catch (_e) { /* 夹具里没有 scrollTop：忽略 */ }
        }
    }
    /** 搜索框回车也会整页重绘（结果要变）—— 重绘完把焦点还回去，不让人重新点一次输入框。 */
    _focusSearch() {
        try {
            const el = this.container.querySelector('.tbo-search-input');
            if (el && typeof el.focus === 'function') el.focus();
        } catch (_e) { /* 夹具里没有 focus：忽略 */ }
    }

    _toastHTML() {
        if (!this.flash) return '';
        return '<div class="tbo-toast" role="status">' + this._esc(this.flash) + '</div>';
    }

    _tabbarHTML() {
        const proj = this.app.projection() || {};
        const badge = { cart: proj.cartCount || 0, orders: proj.pendingCount || 0 };
        const parts = ['<nav class="tbo-tabbar" role="navigation" aria-label="桃宝主导航">'];
        for (const t of TBO_FACES) {
            const on = this.tabKey === t.key;
            const n = badge[t.key] || 0;
            /* [v4.204.0 · 照现实] 禁用格：照官方位置与文案列出，但必须**看得出不能点**
             *   （opacity .38 + aria-disabled），点了给一句真话。
             *   不静默不是礼貌问题：静默无反应会被当成「按钮坏了」，排查成本比一句话高得多。 */
            if (t.disabled) {
                parts.push('<button class="tbo-tab is-disabled" data-act="soon" data-what="' + this._esc(t.label) + '"'
                    + ' data-tbo-face="' + t.key + '" aria-disabled="true" aria-label="' + this._esc(t.label) + '（本机未实现）">');
                parts.push('<i class="' + t.icon + '" aria-hidden="true"></i>');
                parts.push('<span class="tbo-tab-label">' + this._esc(t.label) + '</span>');
                parts.push('</button>');
                continue;
            }
            parts.push('<button class="tbo-tab" data-act="tab" data-tab="' + this._esc(t.key) + '"'
                + ' data-tbo-face="' + t.key + '"' + (on ? ' aria-current="page"' : '') + ' aria-label="' + this._esc(t.label) + '">');
            parts.push('<i class="' + t.icon + '" aria-hidden="true"></i>');
            parts.push('<span class="tbo-tab-label">' + this._esc(t.label) + '</span>');
            if (n > 0) parts.push('<i class="tbo-tab-badge">' + (n > 99 ? '99+' : n) + '</i>');
            parts.push('</button>');
        }
        parts.push('</nav>');
        return parts.join('\n');
    }

    _pageHTML() {
        switch (this.page) {
            case 'detail': return this._detailHTML();
            case 'cart': return this._cartHTML();
            case 'orders': return this._ordersHTML();
            case 'logi': return this._logiHTML();
            case 'mine': return this._mineHTML();
            default: return this._homeHTML();
        }
    }

    /** 顶部栏（标题 + 可选返回键）。所有页共用，免得每页各写一套。 */
    _topbar(title, withBack, mid) {
        const parts = ['<header class="tbo-top">'];
        if (withBack) {
            parts.push('<button class="tbo-top-btn" data-act="back" aria-label="返回">'
                + '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>');
        }
        parts.push('<h1 class="tbo-title">' + this._esc(title) + '</h1>');
        parts.push('<span class="tbo-top-mid">' + (mid || '') + '</span>');
        parts.push('</header>');
        return parts.join('\n');
    }

    /** 归因条：读不到存储 / 会话说空 就直说，不画空商品流糊过去。 */
    _faceHTML() {
        const face = this.app.faceReason();
        const meta = FACE_META[face] || { icon: '❓', label: '未识别的状态：' + String(face), tone: 'warn' };
        return '<div class="tbo-face tbo-face-' + meta.tone + '">'
            + '<span class="tbo-face-icon">' + meta.icon + '</span>'
            + '<span class="tbo-face-label">' + this._esc(meta.label) + '</span></div>';
    }

    /* ================= 5. 首页 ================= */

    _homeHTML() {
        const app = this.app;
        const proj = app.projection() || { productCount: 0, cartCents: 0, cartCount: 0, pendingCount: 0, nextEvent: null };
        const products = app.productsList();
        const list = sortProducts(searchProducts(products, this.kw), this.sortKey);
        const cart = app.cartList();
        const parts = [];

        parts.push('<div class="tbo-page tbo-page-home">');
        parts.push(this._topbar('桃宝'));

        /* 搜索框：真实输入；回车或点清空才算一次操作（每敲一个字就重绘会把光标顶掉）。 */
        parts.push('<div class="tbo-search">');
        parts.push('<i class="fa-solid fa-magnifying-glass tbo-search-icon" aria-hidden="true"></i>');
        parts.push('<input class="tbo-input tbo-search-input" id="tbo-q" type="search" value="' + this._esc(this.kw) + '"'
            + ' placeholder="搜本店的商品（名字 / 备注）" aria-label="搜索商品">');
        if (this.kw) {
            parts.push('<button class="tbo-search-clear" data-act="search-clear" aria-label="清空搜索">'
                + '<i class="fa-solid fa-xmark" aria-hidden="true"></i></button>');
        }
        parts.push('</div>');

        parts.push(this._faceHTML());

        /* 读数条：目录 / 车里 / 在途（都是真读数，不是装饰）。 */
        parts.push('<div class="tbo-stats">');
        parts.push('<div class="tbo-stat"><b>' + proj.productCount + '</b><span>在售</span></div>');
        parts.push('<div class="tbo-stat"><b>' + formatCents(proj.cartCents || 0) + '</b><span>车里</span></div>');
        parts.push('<div class="tbo-stat"><b>' + (proj.pendingCount || 0) + '</b><span>在途</span></div>');
        parts.push('</div>');

        if (proj.nextEvent) {
            parts.push('<div class="tbo-next"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i>'
                + '<span class="tbo-next-text">' + this._esc(proj.nextEvent.text) + '</span>'
                + '<span class="tbo-next-when">还要 ' + this._dur(proj.nextEvent.remainingMs) + '</span></div>');
        }

        /* 金刚区：首页就有这些格子（现实里也是从首页进的）。 */
        parts.push('<div class="tbo-grid">');
        parts.push('<button class="tbo-grid-item" data-act="tab" data-tab="cart" aria-label="购物车">'
            + '<i class="fa-solid fa-cart-shopping" aria-hidden="true"></i><span>购物车</span></button>');
        parts.push('<button class="tbo-grid-item" data-act="tab" data-tab="orders" aria-label="全部订单">'
            + '<i class="fa-solid fa-receipt" aria-hidden="true"></i><span>订单</span></button>');
        parts.push('<button class="tbo-grid-item" data-act="tab" data-tab="mine" aria-label="娃娃机">'
            + '<i class="fa-solid fa-staff-snake" aria-hidden="true"></i><span>娃娃机</span></button>');
        parts.push('<button class="tbo-grid-item" data-act="shelf" aria-label="上架商品">'
            + '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>上架</span></button>');
        parts.push('</div>');

        parts.push('<div class="tbo-sorts">');
        for (const s of SORTS) {
            const on = this.sortKey === s.key;
            parts.push('<button class="tbo-sort" data-act="sort" data-sort="' + s.key + '"'
                + (on ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + this._esc(s.label) + '</button>');
        }
        parts.push('<span class="tbo-sort-hint">' + (this.kw ? ('「' + this._esc(this.kw) + '」命中 ' + list.length) : ('共 ' + list.length + ' 件')) + '</span>');
        parts.push('</div>');

        if (!list.length) {
            parts.push('<div class="tbo-empty">'
                + (this.kw
                    ? '没有匹配的商品。搜的是**本店目录**，不替你从外面编货。'
                    : '还没有商品。「上架」可以登记一件 —— 本 App 不替你生成商品，也不替你去问模型。')
                + '</div>');
        } else {
            parts.push('<div class="tbo-flow">');
            for (const p of list) {
                const inCart = cart.find((x) => x.productId === p.id);
                parts.push('<article class="tbo-card" data-act="open-p" data-id="' + this._esc(p.id) + '" role="button" tabindex="0">');
                parts.push('<div class="tbo-card-cover tbo-cover-' + this._tone(p.id) + '">'
                    + '<span class="tbo-card-glyph">' + this._esc((p.name || '?').slice(0, 1)) + '</span></div>');
                parts.push('<h3 class="tbo-card-name">' + this._esc(p.name) + '</h3>');
                parts.push('<div class="tbo-card-meta">');
                parts.push('<span class="tbo-price">' + (p.unPriced ? '未定价' : formatCents(p.priceCents)) + '</span>');
                if (inCart) parts.push('<span class="tbo-card-incart">车里 ' + inCart.qty + '</span>');
                parts.push('</div>');
                if (p.note) parts.push('<p class="tbo-card-note">' + this._esc(p.note) + '</p>');
                parts.push('</article>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ================= 6. 商品详情 ================= */

    _detailHTML() {
        const p = (this.app.productsList() || []).find((x) => x.id === this.detailId);
        const parts = ['<div class="tbo-page tbo-page-detail">'];
        if (!p) {
            parts.push(this._topbar('商品', true));
            parts.push('<div class="tbo-empty">这件商品已经不在了（可能刚被下架）。</div>');
            parts.push('</div>');
            return parts.join('\n');
        }
        parts.push(this._topbar('商品详情', true));
        parts.push('<div class="tbo-hero tbo-cover-' + this._tone(p.id) + '">'
            + '<span class="tbo-hero-glyph">' + this._esc((p.name || '?').slice(0, 1)) + '</span></div>');
        parts.push('<div class="tbo-detail-body">');
        parts.push('<div class="tbo-detail-price">' + (p.unPriced ? '未定价' : formatCents(p.priceCents))
            + (p.unPriced ? '<span class="tbo-detail-hint">价格留空 = 未定价，不计入合计</span>' : '') + '</div>');
        parts.push('<h2 class="tbo-detail-name">' + this._esc(p.name) + '</h2>');
        if (p.note) parts.push('<p class="tbo-detail-note">' + this._esc(p.note) + '</p>');
        /* 规格区：商品是用户手工登记的，没有 SKU 树 —— 如实写清口径，而不是画一组假规格。 */
        parts.push('<dl class="tbo-spec">');
        parts.push('<div class="tbo-spec-row"><dt>发货地</dt><dd>下单时从 9 个城市里抽（互不相同）</dd></div>');
        parts.push('<div class="tbo-spec-row"><dt>物流</dt><dd>9 步模板，状态由时间推演，不是定时器</dd></div>');
        parts.push('<div class="tbo-spec-row"><dt>计价</dt><dd>一律整数「分」，不会有 0.1+0.2 那种误差</dd></div>');
        parts.push('</dl>');
        parts.push('</div>');
        parts.push('<div class="tbo-detail-bar">');
        parts.push('<button class="tbo-bar-btn" data-act="tab" data-tab="cart" aria-label="去购物车">'
            + '<i class="fa-solid fa-cart-shopping" aria-hidden="true"></i><span>购物车</span></button>');
        parts.push('<button class="tbo-btn tbo-btn-ghost" data-act="add-cart" data-id="' + this._esc(p.id) + '">加入购物车</button>');
        parts.push('<button class="tbo-btn tbo-btn-primary" data-act="buy-now" data-id="' + this._esc(p.id) + '">立即下单</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ================= 7. 购物车 ================= */

    _cartHTML() {
        const cart = this.app.cartList() || [];
        const products = this.app.productsList() || [];
        const byId = new Map(products.map((p) => [p.id, p]));
        /* 默认全选（现实里进购物车时商品是勾着的，用户再逐项取消）。 */
        if (!this.checked.size) for (const r of cart) this.checked.add(r.productId);
        const sel = cartCheckedTotals(cart, Array.from(this.checked), products);
        const parts = ['<div class="tbo-page tbo-page-cart">'];
        parts.push(this._topbar('购物车', false, cart.length ? (cart.length + ' 项') : ''));

        if (!cart.length) {
            parts.push('<div class="tbo-empty">车是空的。去首页挑一件。</div>');
            parts.push('</div>');
            return parts.join('\n');
        }

        parts.push('<div class="tbo-cart-list">');
        for (const row of cart) {
            const p = byId.get(row.productId);
            const on = this.checked.has(row.productId);
            parts.push('<div class="tbo-cart-row">');
            parts.push('<button class="tbo-check" data-act="cart-check" data-id="' + this._esc(row.productId) + '"'
                + (on ? ' aria-pressed="true"' : ' aria-pressed="false"')
                + ' aria-label="' + (on ? '取消选择' : '选择') + '">'
                + (on ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : '')
                + '</button>');
            parts.push('<div class="tbo-cart-thumb tbo-cover-' + this._tone(row.productId) + '">'
                + '<span>' + this._esc(p ? (p.name || '?').slice(0, 1) : '⚠') + '</span></div>');
            parts.push('<div class="tbo-cart-main">');
            parts.push('<div class="tbo-cart-name">' + (p ? this._esc(p.name) : '⚠️ 已不在目录里') + '</div>');
            parts.push('<div class="tbo-cart-sub">'
                + (p ? (p.unPriced ? '未定价' : formatCents(p.priceCents)) : '这件商品被下架了，先摘掉')
                + '</div>');
            parts.push('<div class="tbo-qty">');
            parts.push('<button class="tbo-qty-btn" data-act="qty" data-id="' + this._esc(row.productId) + '" data-step="-1" aria-label="减一件">−</button>');
            parts.push('<span class="tbo-qty-num">' + row.qty + '</span>');
            parts.push('<button class="tbo-qty-btn" data-act="qty" data-id="' + this._esc(row.productId) + '" data-step="1" aria-label="加一件">+</button>');
            parts.push('</div>');
            parts.push('</div>');
            parts.push('<button class="tbo-cart-del" data-act="cart-del" data-id="' + this._esc(row.productId) + '" aria-label="摘掉">'
                + '<i class="fa-solid fa-xmark" aria-hidden="true"></i></button>');
            parts.push('</div>');
        }
        parts.push('</div>');

        if (sel.missing > 0) {
            parts.push('<div class="tbo-warn">有 ' + sel.missing + ' 项已不在目录里，不计入合计 —— 下单会被拒（先摘掉它们）。</div>');
        }

        parts.push('<div class="tbo-settle">');
        parts.push('<div class="tbo-settle-left">');
        parts.push('<span class="tbo-settle-label">合计</span>');
        parts.push('<span class="tbo-settle-total">' + formatCents(sel.cents) + '</span>');
        parts.push('<span class="tbo-settle-count">已选 ' + sel.count + ' 件</span>');
        parts.push('</div>');
        parts.push('<button class="tbo-btn tbo-btn-primary tbo-settle-btn" data-act="checkout"'
            + (sel.count > 0 && sel.missing === 0 ? '' : ' disabled') + '>结算（' + sel.count + '）</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ================= 8. 订单 ================= */

    _ordersHTML() {
        const all = this.app.ordersList() || [];
        const rows = this.orderTab === 'all' ? all : all.filter((o) => (o.status || 'placed') === this.orderTab);
        const counts = { all: all.length };
        for (const t of ORDER_TABS) {
            if (t.key !== 'all') counts[t.key] = all.filter((o) => (o.status || 'placed') === t.key).length;
        }

        const parts = ['<div class="tbo-page tbo-page-orders">'];
        parts.push(this._topbar('我的订单'));
        parts.push('<div class="tbo-otabs">');
        for (const t of ORDER_TABS) {
            const on = this.orderTab === t.key;
            parts.push('<button class="tbo-otab" data-act="order-tab" data-tab="' + t.key + '"'
                + (on ? ' aria-selected="true"' : ' aria-selected="false"') + '>'
                + this._esc(t.label)
                + (counts[t.key] ? '<i class="tbo-otab-n">' + counts[t.key] + '</i>' : '') + '</button>');
        }
        parts.push('</div>');

        if (!rows.length) {
            parts.push('<div class="tbo-empty">' + (this.orderTab === 'all' ? '还没有订单。' : '这个状态下没有订单。') + '</div>');
            parts.push('</div>');
            return parts.join('\n');
        }

        parts.push('<div class="tbo-order-list">');
        for (const o of rows) {
            const key = o.status || 'placed';
            parts.push('<div class="tbo-order">');
            parts.push('<div class="tbo-order-head">');
            parts.push('<span class="tbo-order-status tbo-status-' + (STATUS_TONE[key] || 'gray') + '">'
                + this._esc(statusTextOf(key)) + '</span>');
            parts.push('<span class="tbo-order-total">' + formatCents(o.totalCents) + '</span>');
            parts.push('</div>');
            parts.push('<div class="tbo-order-route">' + this._esc(o.shipFrom || '') + ' → '
                + this._esc(o.transitCity || '—') + ' → ' + this._esc(o.userCity || '') + '</div>');
            parts.push('<div class="tbo-order-rows">');
            for (const r of (Array.isArray(o.rows) ? o.rows : [])) {
                parts.push('<span class="tbo-order-row">' + this._esc(r.name) + ' ×' + r.qty + '</span>');
            }
            parts.push('</div>');
            parts.push('<div class="tbo-order-actions">');
            parts.push('<button class="tbo-mini" data-act="open-logi" data-id="' + this._esc(o.id) + '">看物流</button>');
            const needDel = this._pending === 'del:' + o.id;
            parts.push('<button class="tbo-mini" data-act="order-del" data-id="' + this._esc(o.id) + '">'
                + (needDel ? '确认删除' : '删') + '</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="tbo-hint">订单状态**由时间推演**，不是定时器改的：每次取数都按「现在」重算一遍，'
            + '关掉再开自己就补上了。付款那一步同样是推演的结果。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ================= 9. 物流详情 ================= */

    _logiHTML() {
        const info = this.app.logisticsOf(this.logiId);
        const parts = ['<div class="tbo-page tbo-page-logi">'];
        parts.push(this._topbar('物流详情', true));
        if (!info) {
            parts.push('<div class="tbo-empty">这一单找不到了。</div>');
            parts.push('</div>');
            return parts.join('\n');
        }
        parts.push('<div class="tbo-logi-head">');
        parts.push('<span class="tbo-logi-status">' + this._esc(info.statusText) + '</span>');
        parts.push('<span class="tbo-logi-progress">' + info.doneCount + ' / ' + info.steps.length + ' 步</span>');
        parts.push('</div>');
        const pct = Math.round((info.doneCount / info.steps.length) * 100);
        parts.push('<div class="tbo-progress" role="progressbar" aria-valuenow="' + pct
            + '" aria-valuemin="0" aria-valuemax="100"><i class="tbo-progress-bar" style="width:' + pct + '%"></i></div>');

        parts.push('<ol class="tbo-timeline">');
        const show = info.steps.slice(0, Math.max(1, info.shownCount));
        /* 最新在上（与源 `prepend` 同序）。 */
        for (const s of show.slice().reverse()) {
            parts.push('<li class="tbo-step">');
            parts.push('<i class="tbo-step-dot" aria-hidden="true"></i>');
            parts.push('<span class="tbo-step-text">' + this._esc(s.text) + '</span>');
            parts.push('</li>');
        }
        parts.push('</ol>');

        if (info.next) {
            parts.push('<div class="tbo-logi-next">下一步：' + this._esc(info.next.text)
                + '<span class="tbo-next-when">还要 ' + this._dur(info.remainingMs) + '</span></div>');
        } else {
            parts.push('<div class="tbo-logi-next">9 步走完了，这一单到了。</div>');
        }
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-ghost" data-act="push">推演到此刻</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /* ================= 10. 我的 ================= */

    _mineHTML() {
        const proj = this.app.projection() || { productCount: 0, orderCount: 0, grabCount: 0 };
        const grabs = this.app.grabsList() || [];
        const settings = this.app.settings || {};
        const limits = this.app.limits() || {};
        const parts = ['<div class="tbo-page tbo-page-mine">'];
        parts.push(this._topbar('我的'));

        parts.push('<div class="tbo-me">');
        parts.push('<div class="tbo-me-avatar" aria-hidden="true"><i class="fa-solid fa-user"></i></div>');
        parts.push('<div class="tbo-me-meta"><b>本会话的店</b>'
            + '<span>目录 / 车 / 订单 / 抓取都随会话走 —— 换角色就是另一个角色的另一个店</span></div>');
        parts.push('</div>');

        parts.push('<div class="tbo-me-stats">');
        parts.push('<div class="tbo-me-stat"><b>' + proj.productCount + '</b><span>在售</span></div>');
        parts.push('<div class="tbo-me-stat"><b>' + proj.orderCount + '</b><span>订单</span></div>');
        parts.push('<div class="tbo-me-stat"><b>' + proj.grabCount + '</b><span>抓取</span></div>');
        parts.push('</div>');

        /* ---- 我的订单（官方层级：订单挂在「我的」下面，**不在底栏**）----
         * [v4.204.0 · 照现实] 旧实现把「订单」抬成底栏一格。官方淘宝 10.69.16 的底栏是
         *   首页/逛逛/消息/购物车/我的，订单是「我的」里面的二级页（全部订单 + 各状态）。
         *   这里补一级入口，保证把订单从底栏摘掉之后**仍然点得到**（不能只摘不迁）。
         *   徽标沿用底栏原来的在途数，读数不变。 */
        parts.push('<section class="tbo-sec">');
        parts.push('<h2 class="tbo-sec-title">我的订单</h2>');
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-ghost" data-act="tab" data-tab="orders" aria-label="全部订单">'
            + '全部订单' + (proj.pendingCount > 0 ? ('（' + proj.pendingCount + ' 在途）') : '') + '</button>');
        parts.push('</div>');
        parts.push('</section>');
        /* ---- 娃娃机 ---- */
        parts.push('<section class="tbo-sec">');
        parts.push('<h2 class="tbo-sec-title">娃娃机</h2>');
        parts.push('<div class="tbo-claw-pool">');
        for (const t of REWARD_TIERS) {
            parts.push('<span class="tbo-claw-chip">' + this._esc(t.label) + ' ' + t.weight + '%</span>');
        }
        parts.push('</div>');
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-primary" data-act="grab">夹一次</button>');
        parts.push('</div>');
        if (this.grabLog) parts.push('<div class="tbo-flash">' + this._esc(this.grabLog) + '</div>');
        if (grabs.length) {
            parts.push('<div class="tbo-grabs">');
            for (const g of grabs.slice(0, 6)) {
                parts.push('<div class="tbo-grab"><span class="tbo-grab-label">' + this._esc(g.label || g.type)
                    + '</span><span class="tbo-grab-value">' + formatCents(g.valueCents) + '</span></div>');
            }
            parts.push('</div>');
        }
        parts.push('<div class="tbo-hint">战利品**只登记面值，不入任何账**：本仓用户钱包的仲裁源是微信零钱，'
            + '这里再记一笔，同一笔钱就有两个记账者了。</div>');
        parts.push('</section>');

        /* ---- 上架商品 ---- */
        parts.push('<section class="tbo-sec">');
        parts.push('<h2 class="tbo-sec-title">上架一件商品</h2>');
        parts.push('<input class="tbo-input tbo-name-input" id="tbo-p-name" type="text" maxlength="' + (limits.maxNameLen || 40)
            + '" placeholder="叫什么" value="' + this._esc(this.draft.name) + '" aria-label="商品名">');
        parts.push('<div class="tbo-row2">');
        parts.push('<input class="tbo-input tbo-price-input" id="tbo-p-price" type="text" inputmode="decimal"'
            + ' placeholder="价格（元，可留空）" value="' + this._esc(this.draft.priceYuan) + '" aria-label="价格">');
        parts.push('<input class="tbo-input tbo-note-input" id="tbo-p-note" type="text" maxlength="' + (limits.maxNoteLen || 60)
            + '" placeholder="一句备注（可留空）" value="' + this._esc(this.draft.note) + '" aria-label="备注">');
        parts.push('</div>');
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-primary" data-act="add-product">上架</button>');
        parts.push('<button class="tbo-mini" data-act="clear-products">'
            + (this._pending === 'clear-products' ? '确认清空目录' : '清空目录') + '</button>');
        parts.push('</div>');
        parts.push('<div class="tbo-hint">价格留空 = **未定价**（源里商品价格本来就可能空着），不计入合计。'
            + '钱的单位一律是**分**的整数。</div>');
        parts.push('</section>');

        /* ---- 设置 ---- */
        parts.push('<section class="tbo-sec">');
        parts.push('<h2 class="tbo-sec-title">设置</h2>');
        parts.push('<label class="tbo-toggle"><span>把「在途订单」交给生成侧</span>'
            + '<input type="checkbox" data-act="set-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="tbo-field"><span>注入时带几条</span>'
            + '<input type="number" data-act="set-max-inject" min="0" max="20" value="' + (settings.maxInjectOrders || 0) + '"></label>');
        parts.push('<label class="tbo-field"><span>物流时间倍率</span>'
            + '<input type="number" data-act="set-speed" min="1" max="' + (limits.maxSpeedFactor || 86400) + '" value="'
            + settings.speedFactor + '"></label>');
        parts.push('<label class="tbo-field"><span>最多留几次抓取</span>'
            + '<input type="number" data-act="set-max-grabs" min="5" max="200" value="' + settings.maxGrabs + '"></label>');
        parts.push('<div class="tbo-hint">倍率 1× 就是源的时间尺度（全流程约 82.4 小时）；'
            + '调到 3600× 时 82 秒就能看到签收。**倍率只改「时刻怎么算」，不会让已经发出的货退回去。**</div>');
        parts.push('</section>');

        parts.push('</div>');
        return parts.join('\n');
    }

    /* ================= 11. 事件 ================= */

    _handleKey(ev) {
        if (!ev || !ev.target || !ev.target.id) return;
        if (ev.target.id !== 'tbo-q') return;
        if (ev.key !== 'Enter' && ev.keyCode !== 13) return;
        try { this.kw = String(ev.target.value || '').trim(); } catch (_e) { this.kw = ''; }
        this._paint();
    }

    _handleClick(ev) {
        const t = ev && ev.target;
        if (!t || typeof t.closest !== 'function') return;
        const el = t.closest('[data-act]');
        if (!el) return;
        const act = this._attr(el, 'act');
        const id = this._attr(el, 'id');
        switch (act) {
            case 'tab': this._tabTo(this._attr(el, 'tab') || 'home'); return;
            /* [v4.204.0 · 照现实] 官方底栏里本仓未实现的那两格（逛逛 / 消息）：
             *   点了要给一句真话，不能静默 —— 静默在用户眼里就是「按钮坏了」。
             *   提示走自绘 .tbo-toast（本仓纪律②：不弹宿主 alert，会卡住消息流）。 */
            case 'soon': {
                const what = this._attr(el, 'what') || '该入口';
                this.flash = '「' + what + '」本机未实现。';
                this._paint();
                return;
            }
            case 'back': this._back(); return;
            case 'open-p': this._nav('detail', { id }); return;
            case 'open-logi': this._nav('logi', { id }); return;
            case 'shelf': this._tabTo('mine'); return;
            case 'sort': this.sortKey = this._attr(el, 'sort') || 'default'; this._paint(); return;
            case 'search-clear': this.kw = ''; this._paint(); return;
            case 'add-cart': this._doAddCart(id, 1); return;
            case 'buy-now': this._doBuyNow(id); return;
            case 'cart-check': this._doCheck(id); return;
            case 'qty': this._doQty(id, Number(this._attr(el, 'step'))); return;
            case 'cart-del': this._doCartDel(id); return;
            case 'checkout': this._doCheckout(); return;
            case 'order-tab': this.orderTab = this._attr(el, 'tab') || 'all'; this._paint(); return;
            case 'order-del': this._doOrderDel(id); return;
            case 'push': this._doPush(); return;
            case 'grab': this._doGrab(); return;
            case 'add-product': this._doAddProduct(); return;
            case 'clear-products': this._doClearProducts(); return;
            case 'set-inject': this._doSetInject(el); return;
            case 'set-max-inject': this._doPatch(el, 'maxInjectOrders'); return;
            case 'set-speed': this._doPatch(el, 'speedFactor'); return;
            case 'set-max-grabs': this._doPatch(el, 'maxGrabs'); return;
            default: return;
        }
    }

    /** 输入控件的值；夹具里读不到就返回 null（调用方回落草稿，不把 undefined 当空串）。 */
    _val(sel) {
        const el = this._q(sel);
        if (!el) return null;
        try { return el.value == null ? '' : String(el.value); } catch (_e) { return null; }
    }

    _doAddCart(id, qty) {
        const r = this.app.cartAdd(id, qty);
        if (!r.ok) { this._toast(r.error || '加不进去'); return; }
        this.checked.add(id);
        this._toast(r.clamped ? '数量到上限了（99）' : '已加入购物车');
    }

    _doBuyNow(id) {
        const r0 = this.app.cartAdd(id, 1);
        if (!r0.ok) { this._toast(r0.error || '加不进去'); return; }
        const r = this.app.doOrder();
        if (!r.ok) { this._toast(r.error || '下不了单'); return; }
        this.orderTab = 'all';
        this._tabTo('orders');
        this._toast('下单了，物流从「已提交」开始');
    }

    _doCheck(id) {
        if (!id) return;
        if (this.checked.has(id)) this.checked.delete(id); else this.checked.add(id);
        this._paint();
    }

    _doQty(id, step) {
        const row = (this.app.cartList() || []).find((x) => x.productId === id);
        if (!row) { this._toast('这件已经不在车里了'); return; }
        const n = Number(step);
        this.app.cartSet(id, row.qty + (Number.isFinite(n) ? n : 0));
        this._paint();
        /* 点「+」要能连点：重绘会把焦点丢掉，这里把焦点还给同一行的数量按钮。 */
        try {
            const btn = this.container.querySelector('.tbo-qty-btn');
            if (btn && typeof btn.focus === 'function') btn.focus();
        } catch (_e) { /* 夹具里没有 focus：忽略 */ }
    }

    _doCartDel(id) {
        this.app.cartRemove(id);
        this.checked.delete(id);
        this._paint();
    }

    _doCheckout() {
        const r = this.app.doOrder();
        if (!r.ok) { this._toast(r.error || '下不了单'); return; }
        this.checked.clear();
        this.orderTab = 'all';
        this._tabTo('orders');
        this._toast('下单了，物流从「已提交」开始');
    }

    _doOrderDel(id) {
        if (this._pending !== 'del:' + id) {
            this._pending = 'del:' + id;
            this._paint();
            return;
        }
        this._pending = '';
        this.app.removeOrder(id);
        this._toast('删掉了这一单');
    }

    _doPush() {
        const r = this.app.doPush();
        this._toast(r.changed ? ('推进了 ' + r.changed + ' 单') : '还没有哪一单到时候');
    }

    _doGrab() {
        const r = this.app.doGrab('');
        const e = r.entry || {};
        this.grabLog = e.label ? ('夹到「' + e.label + '」' + formatCents(e.valueCents)) : '这次空了';
        this._paint();
    }

    _doAddProduct() {
        const name = this._val('.tbo-name-input');
        const priceYuan = this._val('.tbo-price-input');
        const note = this._val('.tbo-note-input');
        const input = {
            name: name === null ? this.draft.name : name,
            priceYuan: priceYuan === null ? this.draft.priceYuan : priceYuan,
            note: note === null ? this.draft.note : note,
        };
        const r = this.app.addProduct(input);
        if (!r.ok) { this._toast(r.error || '上架失败'); return; }
        this.draft = { name: '', priceYuan: '', note: '' };
        this._toast(r.unPriced ? '上架好了（没填价，标成未定价）' : '上架好了');
    }

    _doClearProducts() {
        if (this._pending !== 'clear-products') {
            this._pending = 'clear-products';
            this._paint();
            return;
        }
        this._pending = '';
        const n = this.app.clearProducts();
        this.checked.clear();
        this._toast(n ? ('清掉了 ' + n + ' 件') : '本来就是空的');
    }

    _doSetInject(el) {
        let on = false;
        try { on = !!el.checked; } catch (_e) { on = !(this.app.settings || {}).injectToPrompt; }
        this.app.settings = { ...(this.app.settings || {}), injectToPrompt: on };
        this.app.saveSettings();
        this._toast(on ? '在途订单会交给生成侧' : '不再注入在途订单');
    }

    _doPatch(el, key) {
        let v = null;
        try { v = el.value; } catch (_e) { v = null; }
        if (v === null || v === undefined || v === '') { this._toast('这个值不能空着'); return; }
        this.app.patchSettings({ [key]: v });
        this._toast('设置已保存');
    }
}

/* （无尾部导出：本视图只用数据层的常量与纯函数 —— 多余的出口会被死导出门报。） */