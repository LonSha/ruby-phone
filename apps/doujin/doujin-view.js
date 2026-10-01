/* ========================================================
 * doujin-view.js — [v3.44.0] 同人商店 · 视图层
 * 照抄 pvdesk / musicdesk 规格：_buildHTML() 拼串 → innerHTML
 * → _bindEvents()。只在 render / refresh 里读 App 现算值，**不缓存投影**。
 *
 * 六条视图纪律（逐条对着源的静默失效）：
 *  ① **四态逐格分开画**：「还没建过店头」与「建了但读不懂」与「读不出来」不同形
 *     —— 源把读不出来的那一份画成「什么都没有」，用户以为店里本来就空。
 *  ② **价格三态分开画**：取到数 / 没有数字（画横线）/ 超上限（标红）
 *     —— 源把「面议」与「0 元」画成同一个样。
 *  ③ **逐行拒收画红边行**：写出是第几行、因为什么 —— 源只回一句「一致に失敗」。
 *  ④ **涨价幅度逐条列**：旧价 / 新价 / 幅度 —— 源静默改价。
 *  ⑤ **上限画余量条**：取不出来画横线且不着色 —— 「真的用到 0」与「读不出来」不同形。
 *  ⑥ **合计不可信要标出来**：车里有读不出的行时，合计旁边挂一句「不可信」。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号、双引号与单引号一律走**拼装形**
 * （不写实体字面量：落盘传输链会把实体字面量解码成真字符，转义函数静默失效）。
 * ======================================================== */
'use strict';
/* ★ 这里只取**键面**真源（四态色调与几项上限）。清单不在这里：
 *   逐件、逐条、逐行的行由 App 的各类 Rows() 现算给出 —— 视图不持第二份
 *   清单，否则真源表增删一项，视图会静默少画一行（本仓 J7 形态）。 */
import {
    DJ_GAUGE_KEYS, DJ_TITLE_MAX, DJ_LISTING_MAX, DJ_CART_MAX, DJ_LEDGER_MAX, DJ_QTY_MAX,
    DJ_SHELF_MAX, DJ_SHELF_STORE_MAX
} from './doujin-data.js';

/** 转义要 replace 的几个字符 —— 用**拼装形**，不写实体字面量。 */
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const DASH = '--';

const TABS = [
    { key: 'shop', label: '店头' },
    { key: 'market', label: '市场' },
    { key: 'cart', label: '收银台' },
    { key: 'shelf', label: '台账' }
];

/** 四态色调（**键面取真源**，不写标识符形 —— 本仓 J7 形态）。
 * ★ 四项必须**逐行各自写出自己的色**：四项挤在一行时，改错一项
 *   既看不出来、也没法单独守（判据只能数「四种字符都在场」，观测不到「哪一项错了」）。 */
const FACE_TONE = Object.freeze({
    ok: 'ok',
    empty: 'warn',
    malformed: 'err',
    absent: 'off'
});

/** 视图层：四页签（店头 / 市场 / 收银台 / 台账）。 */
export class DoujinView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._shopInput = '';
        this._listingInput = '';
        this._priceInput = '';
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'djn-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.className = 'djn-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _q(sel) { return this._root ? this._root.querySelector(sel) : null; }
    /** 转义（与号与三个引号走拼装形 —— 见文件头纪律）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split(LT).join(AMP + 'lt;')
            .split(GT).join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(SQ).join(AMP + '#39;');
    }
    _tone(t) { return t ? ('djn-tone-' + this._esc(t)) : 'djn-tone-none'; }
    _nl() { return NL; }

    /* ---------- 通用小块 ---------- */
    _sec(title, note) {
        const parts = [];
        parts.push('<div class="djn-sec">');
        parts.push('<div class="djn-sec-title">' + this._esc(title) + '</div>');
        if (note) parts.push('<div class="djn-sec-note">' + this._esc(note) + '</div>');
        return parts.join('');
    }
    _metricBlock(rows) {
        const parts = ['<div class="djn-metrics">'];
        for (let i = 0; i < rows.length; i++) {
            parts.push('<div class="djn-metric"><span class="djn-metric-k">' + this._esc(rows[i].k)
                + '</span><span class="djn-metric-v">' + this._esc(rows[i].v) + '</span></div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    _fieldInput(kind, label, value, placeholder) {
        const parts = [];
        parts.push('<div class="djn-field">');
        parts.push('<label class="djn-field-label">' + this._esc(label) + '</label>');
        parts.push('<textarea class="djn-area" data-in="' + this._esc(kind) + '" placeholder="'
            + this._esc(placeholder || '') + '">' + this._esc(value) + '</textarea>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 余量条 ---------- */
    _gaugeBlock() {
        const rows = this.app.gaugeRows();
        const parts = ['<div class="djn-sec">'];
        parts.push('<div class="djn-sec-title">四项上限</div>');
        parts.push('<div class="djn-gauge">');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            parts.push('<div class="djn-gauge-row">');
            parts.push('<span class="djn-gauge-label">' + this._esc(r.label) + '</span>');
            parts.push('<span class="djn-gauge-track">');
            /* ★ 取不出来**不着色**：画横线且条子留空（与「真的用到 0」不同形）。 */
            if (!r.blank) {
                parts.push('<span class="djn-gauge-fill' + (r.tone === 'err' ? ' err' : (r.tone === 'warn' ? ' warn' : ''))
                    + '" style="width:' + String(r.pct) + '%"></span>');
            }
            parts.push('</span>');
            parts.push('<span class="djn-gauge-num' + (r.blank ? ' blank' : '') + '">' + this._esc(r.text) + '</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="djn-sec-note">取不出来画横线、条子留空 —— 与「真的用到 0」不同形。</div>');
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 店头面 ---------- */
    _shopPanel() {
        const app = this.app;
        const parts = [];
        parts.push(this._sec('贴回一件商品', '一段 JSON 里取数组；逐行核过再落 —— 读不出来的行会被逐行报出来，不并成一句'));
        parts.push(this._fieldInput('shop', '商品 JSON（贴回）', this._shopInput,
            '例：[ { "title": "…", "type": "novel", "price": "¥800", "status": "on_sale" } ]'));
        parts.push('<div class="djn-btns">');
        parts.push('<button class="djn-btn djn-btn-main" data-act="ingest_shop">收下商品</button>');
        parts.push('<button class="djn-btn djn-btn-quiet" data-act="clear_shop_input">清空输入</button>');
        parts.push('</div>');
        parts.push('</div>');

        parts.push(this._sec('店头读数'));
        parts.push(this._metricBlock(app.shopMetrics()));
        parts.push('</div>');

        /* 商品卡 */
        const rows = app.productRows();
        parts.push(this._sec('商品 ' + String(rows.length) + ' 件（上限 ' + String(DJ_SHOP_MAX_VIEW()) + ' 件）',
            '逐件核过再落 —— 读不出来的行会进下面的拒收表，不并成一句'));
        if (!rows.length) {
            parts.push('<div class="djn-empty">一件商品都没有 —— 贴回一段 JSON 试试。</div>');
        } else {
            parts.push('<div class="djn-grid">');
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                parts.push('<div class="djn-card">');
                parts.push('<div class="djn-card-body">');
                parts.push('<div class="djn-card-title">' + this._esc(r.title) + '</div>');
                parts.push('<div class="djn-card-sub">' + this._esc(r.typeLabel) + ' · '
                    + '<span class="djn-status" style="color:' + this._esc(r.statusColor) + '">'
                    + '<span class="djn-status-dot"></span>' + this._esc(r.statusLabel) + '</span>'
                    + (r.isLegacy ? ' · <span class="djn-dim">旧数据（新生成不再产）</span>' : '') + '</div>');
                parts.push('<div class="djn-card-tags">');
                parts.push('<span class="djn-tag' + (r.inCart ? ' djn-tag-new' : '') + '">'
                    + (r.inCart ? '已在收银台' : '未入车') + '</span>');
                parts.push('</div>');
                parts.push('</div>');
                parts.push('<span class="djn-price">¥' + this._esc(r.priceText) + '</span>');
                parts.push('<button class="djn-btn djn-btn-quiet" data-act="add_cart" data-id="'
                    + this._esc(r.id) + '">入车</button>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');

        /* 拒收行 */
        const bad = app.rejectedRows();
        if (bad.length) {
            parts.push(this._sec('拒收 ' + String(bad.length) + ' 行', '源是一条静默跳过；本件逐行报第几行、因为什么'));
            for (let i = 0; i < bad.length; i++) {
                parts.push('<div class="djn-bad-row"><span class="djn-row-idx">第 ' + String(bad[i].index + 1)
                    + ' 行</span><span class="djn-row-title">' + this._esc(bad[i].title) + '</span>'
                    + '<span class="djn-err-text">' + this._esc(app.rowWhyTextOf(bad[i].why)) + '</span></div>');
            }
            parts.push('</div>');
        }

        /* 即卖会 */
        const evs = app.eventRows();
        parts.push(this._sec('即卖会 ' + String(evs.length) + ' 场', '源四档期：告知 → 临近 → 举办中 → 结束'));
        if (!evs.length) {
            parts.push('<div class="djn-empty">没有即卖会。</div>');
        } else {
            for (let i = 0; i < evs.length; i++) {
                parts.push('<div class="djn-row"><span class="djn-row-idx">' + String(i + 1) + '</span>'
                    + '<span class="djn-row-title">' + this._esc(evs[i].name) + '</span>'
                    + '<span class="djn-row-num">' + this._esc(evs[i].typeLabel) + ' · ' + this._esc(evs[i].phaseLabel)
                    + ' · ' + this._esc(evs[i].date) + ' · 社团 ' + String(evs[i].circles) + '</span></div>');
            }
        }
        parts.push('</div>');

        /* 规则表 */
        parts.push(this._sec('定价规则（源的四条，逐条照抄）', '让「为什么黄牛这么贵」可对'));
        const rules = app.ruleRows();
        for (let i = 0; i < rules.length; i++) {
            parts.push('<div class="djn-row"><span class="djn-row-title">' + this._esc(rules[i].label) + '</span>'
                + '<span class="djn-row-num">' + this._esc(rules[i].val) + '</span></div>');
            parts.push('<div class="djn-sec-note" style="padding-left:6px;">' + this._esc(rules[i].note) + '</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 市场面 ---------- */
    _marketPanel() {
        const app = this.app;
        const parts = [];
        parts.push(this._sec('贴回一批二手在售', '可带 rarity / blindBox / variantChar / condition / seller / heatOwn'));
        parts.push(this._fieldInput('listing', '在售 JSON（贴回）', this._listingInput,
            '例：[ { "title": "…", "price": "¥3,200", "rarity": "限定", "seller": "scalper" } ]'));
        parts.push('<div class="djn-btns">');
        parts.push('<button class="djn-btn djn-btn-main" data-act="ingest_listing">收下在售</button>');
        parts.push('<button class="djn-btn djn-btn-quiet" data-act="clear_listing_input">清空输入</button>');
        parts.push('</div>');
        parts.push('</div>');

        parts.push(this._sec('市场读数'));
        parts.push(this._metricBlock(app.marketStats()));
        parts.push('</div>');

        /* 价格引擎（选中一件时三档） */
        parts.push(this._sec('价格引擎（定価 / 相场 / 这一件）', '源只画后两档；本件把稀有度倍率与角色热度一并摊开'));
        parts.push('<div class="djn-engine">');
        const eng = app.engineRows();
        for (let i = 0; i < eng.length; i++) {
            parts.push('<div class="djn-engine-row"><span class="djn-engine-label">' + this._esc(eng[i].label)
                + '</span><span class="djn-engine-val">' + this._esc(eng[i].val) + '</span></div>');
        }
        parts.push('</div>');
        parts.push('<div class="djn-btns">');
        parts.push('<input class="djn-input" data-in="focus" type="text" value="' + this._esc(app.focusOf())
            + '" placeholder="选中一件（填在售序号或 id）" style="flex:1 1 160px;">');
        parts.push('<button class="djn-btn djn-btn-quiet" data-act="set_focus">选中</button>');
        parts.push('</div>');
        parts.push('</div>');

        /* 在售列表 */
        const rows = app.listingRows();
        parts.push(this._sec('在售 ' + String(rows.length) + ' 条'));
        if (!rows.length) {
            parts.push('<div class="djn-empty">没有在售 —— 贴回一批试试。</div>');
        } else {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const cls = r.flagged ? ' djn-listing-fake' : (r.sellerLabel === '黄牛' ? ' djn-listing-scalper' : ' djn-listing-normal');
                parts.push('<div class="djn-listing' + cls + (r.sold ? ' djn-listing-sold' : '') + '">');
                parts.push('<div class="djn-listing-top">');
                parts.push('<span class="djn-row-idx">' + String(i + 1) + '</span>');
                parts.push('<span class="djn-row-title">' + this._esc(r.title) + '</span>');
                parts.push('<span class="djn-price' + (r.flagged ? ' djn-price-bad' : '') + '">' + this._esc(r.priceText) + '</span>');
                parts.push('</div>');
                parts.push('<div class="djn-listing-meta">');
                parts.push('<span>定価 ' + this._esc(r.baseText) + '</span>');
                parts.push('<span>相场 ' + this._esc(r.avgText) + '</span>');
                parts.push('<span class="' + (r.ratioHot ? 'djn-ratio-hot' : (r.ratioCold ? 'djn-ratio-cold' : '')) + '">'
                    + this._esc(r.ratioText) + '</span>');
                parts.push('<span>热度 ' + this._esc(r.heatText) + '</span>');
                parts.push('<span>' + this._esc(r.conditionLabel) + '</span>');
                parts.push('<span>' + this._esc(r.sellerLabel) + '</span>');
                parts.push('<span>' + this._esc(r.statusLabel) + '</span>');
                if (r.variantChar) parts.push('<span>单款 ' + this._esc(r.variantChar) + '</span>');
                if (r.byVariant) parts.push('<span>按单款口径</span>');
                if (r.sold) parts.push('<span class="djn-err-text">已售出</span>');
                if (r.flagged) parts.push('<span class="djn-err-text">疑似赝品</span>');
                if (r.bundleQty) parts.push('<span>打包 ' + String(r.bundleQty) + ' 件</span>');
                parts.push('</div>');
                parts.push('<div class="djn-listing-seller">卖家：' + this._esc(r.seller) + '</div>');
                parts.push('<div class="djn-btns">');
                parts.push('<button class="djn-btn djn-btn-quiet" data-act="fav" data-id="' + this._esc(r.id) + '">'
                    + (r.fav ? '取消收藏' : '收藏') + '</button>');
                parts.push('<button class="djn-btn djn-btn-quiet" data-act="mark_sold" data-id="' + this._esc(r.id) + '">标已售出</button>');
                parts.push('<button class="djn-btn djn-btn-danger" data-act="remove_listing" data-id="' + this._esc(r.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* 改价 */
        parts.push(this._sec('改价（幅度超阈值才算「明显变动」）', '源静默改价；本件把旧价 / 新价 / 幅度逐条报出来'));
        parts.push('<div class="djn-btns">');
        parts.push('<input class="djn-input" data-in="price_id" type="text" value="" placeholder="在售 id" style="flex:1 1 110px;">');
        parts.push('<input class="djn-input" data-in="price_new" type="text" value="" placeholder="新价（例 ¥3,200）" style="flex:1 1 130px;">');
        parts.push('<button class="djn-btn" data-act="set_price">改价</button>');
        parts.push('</div>');
        const reps = app.repriceRows();
        if (reps.length) {
            for (let i = 0; i < reps.length; i++) {
                parts.push('<div class="djn-row"><span class="djn-row-title">' + this._esc(reps[i].title) + '</span>'
                    + '<span class="djn-row-num">' + String(reps[i].from === null ? DASH : reps[i].from) + ' → '
                    + String(reps[i].to === null ? DASH : reps[i].to) + '（'
                    + (reps[i].ratio * 100).toFixed(1) + '%）</span></div>');
            }
        } else {
            parts.push('<div class="djn-empty">还没有明显变动。</div>');
        }
        parts.push('</div>');

        /* 费率表 */
        parts.push(this._sec('市场流动费率（源逐条照抄）'));
        const rates = app.ratesRows();
        for (let i = 0; i < rates.length; i++) {
            parts.push('<div class="djn-row"><span class="djn-row-title">' + this._esc(rates[i].label) + '</span>'
                + '<span class="djn-row-num">' + this._esc(rates[i].val) + '</span></div>');
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 收银台面 ---------- */
    _cartPanel() {
        const app = this.app;
        const info = app.cartInfo();
        const parts = [];
        parts.push(this._sec('收银台 ' + String(info.rows) + ' 行', '上限 ' + String(info.max) + ' 行；本件只结账、不动钱包（源直扣余额并写交易流水）'));
        if (!info.rows) {
            parts.push('<div class="djn-empty">车是空的。</div>');
        } else {
            const rows = app.cartRows();
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (r.bad) {
                    parts.push('<div class="djn-bad-row"><span class="djn-row-idx">第 ' + String(i + 1) + ' 行</span>'
                        + '<span class="djn-row-title">' + this._esc(r.title) + '</span>'
                        + '<span class="djn-err-text">' + this._esc(r.priceWhy) + '</span>'
                        + '<button class="djn-btn djn-btn-quiet" data-act="cart_remove" data-id="' + this._esc(r.productId) + '">移除</button></div>');
                } else {
                    parts.push('<div class="djn-cart-row"><span class="djn-row-idx">' + String(i + 1) + '</span>'
                        + '<span class="djn-row-title">' + this._esc(r.title) + '</span>'
                        + '<span class="djn-row-num">× ' + this._esc(r.qty) + '</span>'
                        + '<span class="djn-price">' + this._esc(r.priceText) + '</span>'
                        + '<button class="djn-btn djn-btn-quiet" data-act="cart_remove" data-id="' + this._esc(r.productId) + '">移除</button></div>');
                }
            }
        }
        parts.push('<div class="djn-cart-total"><span>合计' + (info.ok ? '' : '（<span class="djn-err-text">不可信</span>）') + '</span>'
            + '<span class="djn-price">' + this._esc(info.totalText) + '</span></div>');
        if (!info.ok) {
            const bad = app.cartBadRows();
            parts.push('<div class="djn-sec-note">有 ' + String(bad.length) + ' 行读不出价（源会把它们当 0 元算进合计）：</div>');
            for (let i = 0; i < bad.length; i++) {
                parts.push('<div class="djn-bad-row"><span class="djn-row-idx">第 ' + String(bad[i].index + 1) + ' 行</span>'
                    + '<span class="djn-row-title">' + this._esc(bad[i].title) + '</span>'
                    + '<span class="djn-err-text">' + this._esc(app.priceWhyTextOf(bad[i].why)) + '</span></div>');
            }
        }
        parts.push('<div class="djn-btns">');
        parts.push('<button class="djn-btn djn-btn-main" data-act="settle">结账</button>');
        parts.push('<button class="djn-btn djn-btn-quiet" data-act="clear_cart">清空车</button>');
        parts.push('</div>');
        parts.push('</div>');

        const orders = app.orderRows();
        parts.push(this._sec('已结 ' + String(orders.length) + ' 笔'));
        if (!orders.length) {
            parts.push('<div class="djn-empty">还没结过账。</div>');
        } else {
            for (let i = 0; i < orders.length; i++) {
                parts.push('<div class="djn-row"><span class="djn-row-idx">' + String(i + 1) + '</span>'
                    + '<span class="djn-row-title">' + String(orders[i].n) + ' 件</span>'
                    + '<span class="djn-row-num">' + this._esc(orders[i].totalText) + '</span></div>');
            }
        }
        parts.push('</div>');
        return parts.join('');
    }

    /* ---------- 台账面 ---------- */
    _shelfPanel() {
        const app = this.app;
        const parts = [];
        parts.push(this._sec('可复制的要求文本', '本件产出的唯一交付物：一段可复制的台面与在售清单'));
        parts.push('<pre class="djn-pre">' + this._esc(app.requestText()) + '</pre>');
        parts.push('<div class="djn-btns">');
        parts.push('<button class="djn-btn djn-btn-main" data-act="save_shelf">存进台账</button>');
        parts.push('<button class="djn-btn djn-btn-quiet" data-act="clear_draft">清空草稿</button>');
        parts.push('</div>');
        parts.push('<div class="djn-copy-note">草稿为空时上面画的是现算文本；写进草稿后以草稿为准。</div>');
        parts.push('</div>');

        const sh = app.shelfRows();
        parts.push(this._sec('存档 ' + String(sh.length) + ' 份（上限 ' + String(DJ_SHELF_MAX_VIEW()) + ' 份）'));
        if (!sh.length) {
            parts.push('<div class="djn-empty">还没存过。</div>');
        } else {
            for (let i = 0; i < sh.length; i++) {
                parts.push('<div class="djn-row"><span class="djn-row-idx">' + String(i + 1) + '</span>'
                    + '<span class="djn-row-title">' + String(sh[i].products) + ' 件 · ' + String(sh[i].chars) + ' 字</span>'
                    + '<button class="djn-btn djn-btn-quiet" data-act="shelf_remove" data-id="' + String(sh[i].index) + '">删</button></div>');
            }
        }
        parts.push('</div>');

        /* 动作台账 */
        const info = app.ledgerInfo();
        const led = app.ledgerRows();
        parts.push(this._sec('动作记录 ' + String(info.kept) + ' 条', '上限 ' + String(info.max)
            + ' 条；已挤掉 ' + String(info.dropped) + ' 条（源静默 shift，不报数）'));
        if (!led.length) {
            parts.push('<div class="djn-empty">还没动作。</div>');
        } else {
            for (let i = 0; i < led.length; i++) {
                parts.push('<div class="djn-ledger-row"><span class="djn-ledger-kind">' + this._esc(led[i].kind) + '</span>'
                    + '<span class="djn-ledger-note' + (led[i].ok ? '' : ' djn-err-text') + '">'
                    + this._esc((led[i].ok ? '成' : '未成') + (led[i].why ? (' · ' + led[i].why) : ''))
                    + (led[i].note ? (' · ' + led[i].note) : '') + '</span></div>');
            }
        }
        parts.push('<div class="djn-btns">');
        parts.push('<button class="djn-btn djn-btn-quiet" data-act="clear_ledger">清空动作记录</button>');
        parts.push('<button class="djn-btn djn-btn-danger" data-act="clear_shop">清空店头与车</button>');
        parts.push('</div>');
        parts.push('<div class="djn-copy-note">「清空店头与车」不顺手清动作记录 —— 源把四类挤在一处，清一次在售列表会把流水一起清掉。</div>');
        parts.push('</div>');

        /* 来源 */
        parts.push(this._sec('来源'));
        parts.push('<div class="djn-metric"><span class="djn-metric-k">源</span><span class="djn-metric-v">'
            + this._esc(app.sourceNoteOf()) + '</span></div>');
        const fs = app.sourceFilesOf();
        parts.push('<div class="djn-metric"><span class="djn-metric-k">源文件</span><span class="djn-metric-v">'
            + this._esc(fs.join(' / ')) + '</span></div>');
        parts.push('</div>');
        return parts.join('');
    }
    _buildHTML() {
        const app = this.app;
        const parts = [];
        parts.push('<div class="djn-head"><h2>同人商店 · 柜台</h2>'
            + '<span class="djn-head-sub">把商品与二手在售收拾成一份可复制的账'
            + ' —— 本件不出图、不联网、不落库、不连钱包、不读宿主界面</span></div>');
        parts.push('<div class="djn-face ' + this._tone(app.faceOf()) + '">');
        parts.push('<span class="djn-face-line">' + this._esc(app.faceTextOf()) + '</span>');
        parts.push('<span class="djn-face-why">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        parts.push(this._gaugeBlock());
        /* ★ 超限**单独一块**画：面四态讲的是「这份账读不读得出来」，
         *   超限是「读得出来但超了」—— 并进面里会把人引去查 JSON。 */
        const over = this.app.overRows();
        if (over.length) {
            parts.push('<div class="djn-over">');
            parts.push('<div class="djn-over-title">超限 ' + String(over.length) + ' 项（读得出来，只是超了）</div>');
            for (let i = 0; i < over.length; i++) {
                parts.push('<div class="djn-over-row"><span class="djn-over-label">' + this._esc(over[i].label)
                    + '</span><span class="djn-err-text">' + this._esc(String(over[i].value) + ' / ' + String(over[i].max))
                    + '</span></div>');
            }
            parts.push('</div>');
        }
        if (this._flash) parts.push('<div class="djn-flash">' + this._esc(this._flash) + '</div>');

        const cur = app.tab();
        parts.push('<div class="djn-tabs">');
        for (let i = 0; i < TABS.length; i++) {
            const t = TABS[i];
            parts.push('<button class="djn-tab' + (t.key === cur ? ' on' : '') + '" data-tab="' + this._esc(t.key) + '">'
                + this._esc(t.label) + '<span class="djn-tab-n">' + this._esc(String(this._tabCount(t.key))) + '</span></button>');
        }
        parts.push('</div>');

        if (cur === 'shop') parts.push(this._shopPanel());
        else if (cur === 'market') parts.push(this._marketPanel());
        else if (cur === 'cart') parts.push(this._cartPanel());
        else parts.push(this._shelfPanel());
        return parts.join('');
    }
    _tabCount(key) {
        const app = this.app;
        if (key === 'shop') return app.productRows().length;
        if (key === 'market') return app.listingRows().length;
        if (key === 'cart') return app.cartInfo().rows;
        return app.shelfRows().length;
    }

    /* ---------- 事件 ---------- */
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        const inputs = root.querySelectorAll('textarea[data-in], input[data-in]');
        for (let i = 0; i < inputs.length; i++) {
            const el = inputs[i];
            el.addEventListener('input', () => {
                const k = el.getAttribute('data-in');
                if (k === 'shop') this._shopInput = el.value;
                else if (k === 'listing') this._listingInput = el.value;
                else if (k === 'focus') this._focusInput = el.value;
                else if (k === 'price_id') this._priceId = el.value;
                else if (k === 'price_new') this._priceNew = el.value;
            });
        }
        const tabs = root.querySelectorAll('[data-tab]');
        for (let i = 0; i < tabs.length; i++) {
            const t = tabs[i];
            t.addEventListener('click', () => {
                this.app.setTab(t.getAttribute('data-tab'));
                this.refresh();
            });
        }
        const btns = root.querySelectorAll('[data-act]');
        for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            b.addEventListener('click', () => this._onAct(b.getAttribute('data-act'), b.getAttribute('data-id')));
        }
    }
    _onAct(act, id) {
        const app = this.app;
        if (act === 'ingest_shop') {
            const r = app.ingestShopText(this._shopInput || '');
            this._flash = r.ok ? ('收下 ' + String(r.added) + ' 件' + (r.rejected.length ? ('，拒收 ' + String(r.rejected.length) + ' 行') : ''))
                : ('没收下：' + app.rowWhyTextOf(r.why) + (r.saw ? ('（开头是「' + r.saw + '」）') : ''));
            if (r.ok) this._shopInput = '';
            this.refresh();
            return;
        }
        if (act === 'clear_shop_input') { this._shopInput = ''; this._flash = '输入已清空'; this.refresh(); return; }
        if (act === 'add_cart') {
            const r = app.addToCart(id || '');
            this._flash = r.ok ? ('已入车（' + String(r.rows) + ' 行）') : ('没入车：' + this._whyText(r.why));
            this.refresh();
            return;
        }
        if (act === 'ingest_listing') {
            const r = app.ingestListingText(this._listingInput || '');
            this._flash = r.ok ? ('收下 ' + String(r.added) + ' 条在售' + (r.rejected.length ? ('，拒收 ' + String(r.rejected.length) + ' 行') : ''))
                : ('没收下：' + this._whyText(r.why));
            if (r.ok) this._listingInput = '';
            this.refresh();
            return;
        }
        if (act === 'clear_listing_input') { this._listingInput = ''; this._flash = '输入已清空'; this.refresh(); return; }
        if (act === 'set_focus') {
            const r = app.setFocus(this._focusInput || '');
            this._flash = r.ok ? ('选中「' + r.focus + '」') : '没选中';
            this.refresh();
            return;
        }
        if (act === 'fav') {
            const r = app.toggleFav(id);
            this._flash = r.ok ? (r.fav ? '已收藏' : '已取消收藏') : '没成就';
            this.refresh();
            return;
        }
        if (act === 'mark_sold') {
            const r = app.setField(id, 'status', 'sold_out');
            this._flash = r.ok ? '已标完售' : ('没标成：' + this._whyText(r.why));
            this.refresh();
            return;
        }
        if (act === 'remove_listing') {
            const r = app.removeListing(id);
            this._flash = '删掉 ' + String(r.removed) + ' 条';
            this.refresh();
            return;
        }
        if (act === 'set_price') {
            const r = app.setPrice(this._priceId || '', this._priceNew || '');
            this._flash = r.ok ? ('改价 ' + String(r.from === null ? DASH : r.from) + ' → ' + String(r.to)
                + (r.changed ? ('（明显变动 ' + (r.ratio * 100).toFixed(1) + '%）') : '（幅度不到阈值）'))
                : ('没改：' + this._whyText(r.why));
            this.refresh();
            return;
        }
        if (act === 'cart_remove') {
            const r = app.removeFromCart(id);
            this._flash = '移除 ' + String(r.removed) + ' 行';
            this.refresh();
            return;
        }
        if (act === 'settle') {
            const r = app.settle();
            this._flash = r.ok ? ('结账完成：' + String(r.n) + ' 件 · ¥' + String(r.total))
                : ('没结：' + this._whyText(r.why) + (r.bad ? ('（' + String(r.bad) + ' 行读不出价）') : ''));
            this.refresh();
            return;
        }
        if (act === 'clear_cart') {
            const r = app.clearCart();
            this._flash = '清掉 ' + String(r.cleared) + ' 行';
            this.refresh();
            return;
        }
        if (act === 'save_shelf') {
            const r = app.saveToShelf();
            this._flash = r.ok ? ('已存 ' + String(r.kept) + ' 份') : ('没存：' + this._whyText(r.why));
            this.refresh();
            return;
        }
        if (act === 'clear_draft') { const r = app.clearDraft(); this._flash = r.ok ? '草稿已清' : '没成'; this.refresh(); return; }
        if (act === 'shelf_remove') {
            const r = app.removeFromShelf(Number(id));
            this._flash = r.ok ? ('剩下 ' + String(r.kept) + ' 份') : ('没删：' + this._whyText(r.why));
            this.refresh();
            return;
        }
        if (act === 'clear_ledger') { app.clearLedger(); this._flash = '动作记录已清'; this.refresh(); return; }
        if (act === 'clear_shop') { app.clearShop(); this._flash = '店头与车已清（动作记录留着）'; this.refresh(); return; }
    }
    _whyText(w) {
        const k = String(w || '');
        if (k === 'already') return '这一件已经在车里';
        if (k === 'over_limit') return '超上限';
        if (k === 'empty') return '文案是空的';
        if (k === 'no_bracket') return '一段文本里没有括号';
        if (k === 'bad_json') return '括号里那段不是合法 JSON';
        if (k === 'not_found') return '没找到这一件';
        if (k === 'bad_rows') return '车里有读不出价的行';
        if (k === 'shelf_full') return '台账满了';
        if (k === 'out_of_range') return '超出允许范围';
        return this.app.priceWhyTextOf(k);
    }
}
/** 台账上限（视图上的一句文案；真源在数据层，这里只读一次）。
 *  ★ 取真源常量，不写数字字面量：写死时改数据层不改这里会静默不同步。 */
function DJ_SHELF_MAX_VIEW() { return DJ_SHELF_STORE_MAX; }
/** 商品件数上限（同上）。 */
function DJ_SHOP_MAX_VIEW() { return DJ_SHELF_MAX; }