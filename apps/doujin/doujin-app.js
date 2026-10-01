/* ========================================================
 * doujin-app.js — [v3.44.0] 同人商店 · 落盘与接线
 *
 * 数据层：doujin-data.js（纯函数内核）  视图层：doujin-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：价格三态 / 稀有度倍率 / 角色热度 / 二手均价 /
 *      出品个体价 / 售罄比例 / 行合法性 / 合计 / 上限余量 —— 都不碰存储；
 *   ③ 落盘（PhoneStorage）：四条会话键，全走 /^doujin_/ 前缀。
 *
 * ── 四条会话键 ──────────────────────────────────────────
 *   · doujin_shop   —— 店头（社团 + 商品原文 + 即卖会 + 店名）；
 *   · doujin_market —— 市场（二手在售台账 + 收藏）；
 *   · doujin_cart   —— 收银台（待结行 + 已结历史）；
 *   · doujin_ledger —— 动作台账（每一次收下 / 改价 / 结账的回执）；
 *   ★ 为什么四条分开：源把「在售商品」「二手出品」「购物车」「动作流水」
 *     四类全塞进一个 AppState.data 大对象里 —— 换角色后四类一起串味，
 *     而清购物车顺手把在售台账也清了。本件四类各自一条键。
 *
 * ── 不缝的那一块（源的整套能力，本件一律不接）──────────
 *   ① 源 purchase() 直接扣钱包余额并写交易流水（LinePay）—— 本件只结账不动钱；
 *   ② 源 Utils.saveData / IndexedDB / GitHub 备份 —— 本件只走 PhoneStorage；
 *   ③ 源 _buildCoverPrompt + dispatchGenerate 逐件出封面 —— 本件零出图；
 *   ④ 源满篇 document.getElementById 直读宿主元素 —— 本件只读自己的根。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 店头读不出来 **不许**读成「一件商品都没有」（四态面分开判）；
 *   · 价格没数字 **不许**读成 0（三态，逐行报是第几行）；
 *   · 商品行不合法 **不许**并成一句「有 N 行失败」（逐行报 why）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）；
 *   · 上限余量取不出来 **不许**画成 0（四格 null 与 0 不同形）；
 *   · 换会话后旧店头与旧车 **不许**留着（onChatChanged 四格全量重取）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量与反斜杠：一切字符切分走 indexOf / slice / split。
 * ======================================================== */
'use strict';
import {
    DJ_PRODUCT_TYPES, DJ_GENERATABLE_TYPES, DJ_LEGACY_TYPES, DJ_EVENT_TYPES,
    DJ_EVENT_PHASES, DJ_STATUSES, DJ_CONDITIONS, DJ_RARITIES, DJ_SELLER_TYPES,
    DJ_PRICE_RULES, DJ_PRICE_WHYS, DJ_ROW_WHYS, DJ_MARKET_RATES,
    DJ_TITLE_MAX, DJ_SHELF_MAX, DJ_SHELF_STORE_MAX, DJ_SHELF_TEXT_MAX, DJ_LEDGER_MAX, DJ_CART_MAX, DJ_QTY_MAX,
    DJ_LISTING_MAX, DJ_GAUGE_KEYS, DJ_SOURCE_NOTE, DJ_SOURCE_FILES, isSold,
    cleanText, charCount, numOrNull, priceOf, moneyText, roundPrice,
    rarityMult, characterHeat, avgPriceFor, listingPrice, soldRatioOf,
    variantPlan, repriceOf, classifyProducts, cartTotal, ledgerTrim,
    listingStats, gaugesOf, gaugeText
} from './doujin-data.js';
import { DoujinView } from './doujin-view.js';

export const DJ_SHOP_KEY = 'doujin_shop';
export const DJ_MARKET_KEY = 'doujin_market';
export const DJ_CART_KEY = 'doujin_cart';
export const DJ_LEDGER_KEY = 'doujin_ledger';

/* 店头四态（与数据层读数表一一对应；**键面取真源**，不写标识符形）。 */
const FACE_OK = 'ok';
const FACE_EMPTY = 'empty';
const FACE_MALFORMED = 'malformed';
const FACE_ABSENT = 'absent';
const FACE_TEXT = Object.freeze({
    [FACE_OK]: '店头已就绪',
    [FACE_EMPTY]: '店头是空的',
    [FACE_MALFORMED]: '店头读不懂',
    [FACE_ABSENT]: '还没建过店头'
});
const FACE_TONE = Object.freeze({
    [FACE_OK]: 'ok',
    [FACE_EMPTY]: 'warn',
    [FACE_MALFORMED]: 'err',
    [FACE_ABSENT]: 'off'
});
const DASH_UNIT = '--';
/** 价格三态文案（取真源值当键，不写标识符形）。 */
const PRICE_WHY_TEXT = Object.freeze({
    [DJ_PRICE_WHYS[0]]: '取到数',
    [DJ_PRICE_WHYS[1]]: '一个数字都没有',
    [DJ_PRICE_WHYS[2]]: '超出上限'
});
/** 行拒收因文案。 */
const ROW_WHY_TEXT = Object.freeze({
    [DJ_ROW_WHYS[0]]: '收下',
    [DJ_ROW_WHYS[1]]: '没有标题',
    [DJ_ROW_WHYS[2]]: '价格读不出来',
    [DJ_ROW_WHYS[3]]: '超上限'
});

function toStr(v) { return (typeof v === 'string') ? v : ''; }
function dash() { return DASH_UNIT; }
/** 读数取值：取不出来就画横线（**不画 0**）。 */
function meterText(v) {
    const n = numOrNull(v);
    return n === null ? dash() : String(n);
}
/** 找真源表里的一项（键面查，不写死标识符）。 */
function pickIn(table, key) {
    const k = toStr(key);
    for (let i = 0; i < table.length; i++) {
        if (table[i].key === k || table[i].sourceKey === k) return table[i];
    }
    return null;
}

export class DoujinApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'shop';
        /* 店头 */
        this._shopName = 'メロンブックス';
        this._circles = [];
        this._productsRaw = [];
        this._events = [];
        /* 存档（与店头同一条键 —— 源把「存档」与「店头」挤在同一个大对象） */
        this._shelf = [];
        /* 市场 */
        this._listings = [];
        this._favorites = [];
        this._flagged = [];
        /* 收银台 */
        this._cart = [];
        this._orders = [];
        /* 台账 */
        this._ledger = [];
        this._dropped = 0;
        /* 版面 */
        this._focus = '';
        this._draft = '';
        this._now = 0;
        this._face = FACE_ABSENT;
        this._malformed = false;
        /* 投影（_recompute 产出；动作口改完内存字段必须紧跟一次） */
        this._catalog = { rows: [], rejected: [], ok: 0 };
        this._cartCalc = { ok: true, total: 0, count: 0, bad: [] };
        this._stats = { onSale: 0, sold: 0, fake: 0, scalper: 0, bundle: 0, total: 0 };
        this._gauges = [];
        this._engines = [];
        this._reprices = [];
        this._over = [];
        this._cartRows = [];
    }

    /* ---------- storage 三态（本仓纪律：抛异常不等于「没记过」） ---------- */
    _storageUsable() {
        if (!this.storage) return { ok: false, why: 'no_storage' };
        if (typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, why: 'no_api' };
        }
        return { ok: true, why: '' };
    }
    _savedOk(wrote) {
        return { saved: wrote === true, storage: this._storageUsable().ok };
    }
    /** 读一格。三种回报：ok / absent（这一格压根没写过）/ malformed（写了但读不懂）。
     *  ★ 抛异常**不是**「没记过」：本仓最贵的形态是「读不出来 ⇒ 画成空」。 */
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        let v = null;
        try { v = this.storage.get(key, null); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }
    _writeJSON(key, value) {
        const gate = this._storageUsable();
        if (!gate.ok) return false;
        if (typeof this.storage.set !== 'function') return false;
        try {
            this.storage.set(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }
    /** 解析一格 JSON。三种回报，**不把读不懂读成空**。 */
    _parse(key) {
        const r = this._readRaw(key);
        if (!r.ok) return { face: FACE_ABSENT, why: r.why, obj: null };
        if (r.why === 'absent') return { face: FACE_EMPTY, why: '', obj: null };
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            return { face: FACE_MALFORMED, why: 'json', obj: null };
        }
        if (!obj || typeof obj !== 'object') return { face: FACE_MALFORMED, why: 'shape', obj: null };
        return { face: FACE_OK, why: '', obj };
    }

    /* ---------- 装载（单一装载路径：首次渲染与换会话都走这里） ---------- */
    _loadShop() {
        const st = this._parse(DJ_SHOP_KEY);
        /* ★ 存档也在店头这条键里（源把「存档」与「店头」挤在同一个大对象）。
         *   取不出来 / 还没写过时**必须一起清掉**，否则换会话后旧存档原样留着 ——
         *   表现是「新角色点开台账，里面是上一个角色的存档」，不报不崩。 */
        this._shelf = [];
        if (st.face === FACE_ABSENT) return { face: FACE_ABSENT, why: st.why };
        if (st.face === FACE_EMPTY) return { face: FACE_EMPTY, why: '' };
        if (st.face === FACE_MALFORMED) return { face: FACE_MALFORMED, why: st.why };
        const o = st.obj;
        this._shopName = toStr(o.shopName) || 'メロンブックス';
        this._circles = Array.isArray(o.circles) ? o.circles : [];
        this._productsRaw = Array.isArray(o.products) ? o.products : [];
        this._events = Array.isArray(o.events) ? o.events : [];
        this._shelf = Array.isArray(o.shelf) ? o.shelf : [];
        if (!this._circles.length && !this._productsRaw.length && !this._events.length && !this._shelf.length) {
            return { face: FACE_EMPTY, why: '' };
        }
        return { face: FACE_OK, why: '' };
    }
    _loadMarket() {
        const st = this._parse(DJ_MARKET_KEY);
        if (st.face !== FACE_OK) { this._listings = []; this._favorites = []; this._flagged = []; return; }
        this._listings = Array.isArray(st.obj.listings) ? st.obj.listings : [];
        this._favorites = Array.isArray(st.obj.favorites) ? st.obj.favorites : [];
        this._flagged = Array.isArray(st.obj.flagged) ? st.obj.flagged : [];
    }
    _loadCart() {
        const st = this._parse(DJ_CART_KEY);
        if (st.face !== FACE_OK) { this._cart = []; this._orders = []; return; }
        this._cart = Array.isArray(st.obj.cart) ? st.obj.cart : [];
        this._orders = Array.isArray(st.obj.orders) ? st.obj.orders : [];
    }
    _loadLedger() {
        const st = this._parse(DJ_LEDGER_KEY);
        if (st.face !== FACE_OK) { this._ledger = []; this._dropped = 0; return; }
        this._ledger = Array.isArray(st.obj.ledger) ? st.obj.ledger : [];
        const dp = numOrNull(st.obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? dp : 0;
    }
    _persistShop() {
        return this._writeJSON(DJ_SHOP_KEY, {
            shopName: this._shopName, circles: this._circles,
            products: this._productsRaw, events: this._events,
            shelf: this._shelf || []
        });
    }
    _persistMarket() {
        return this._writeJSON(DJ_MARKET_KEY, {
            listings: this._listings, favorites: this._favorites, flagged: this._flagged
        });
    }
    _persistCart() {
        return this._writeJSON(DJ_CART_KEY, { cart: this._cart, orders: this._orders });
    }
    _persistLedger() {
        return this._writeJSON(DJ_LEDGER_KEY, { ledger: this._ledger, dropped: this._dropped });
    }
    /** 换会话用的整页清（**只清内存**，storage 由 probe 重读覆盖）。 */
    _clearToDefaults() {
        this._shopName = 'メロンブックス';
        this._circles = [];
        this._productsRaw = [];
        this._events = [];
        this._shelf = [];
        this._listings = [];
        this._favorites = [];
        this._flagged = [];
        this._cart = [];
        this._orders = [];
        this._ledger = [];
        this._dropped = 0;
        this._focus = '';
        this._draft = '';
        this._catalog = { rows: [], rejected: [], ok: 0 };
        this._cartCalc = { ok: true, total: 0, count: 0, bad: [] };
        this._stats = { onSale: 0, sold: 0, fake: 0, scalper: 0, bundle: 0, total: 0 };
        this._gauges = [];
        this._engines = [];
        this._reprices = [];
    }

    /* ---------- 取数：一处装配（不持跨轮副本） ---------- */
    probe() {
        const st = this._loadShop();
        this._face = st.face;
        this._malformed = (st.face === FACE_MALFORMED);
        this._loadMarket();
        this._loadCart();
        this._loadLedger();
        this._recompute();
        return {
            face: this._face, faceText: FACE_TEXT[this._face],
            products: this._catalog.rows.length, rejected: this._catalog.rejected.length,
            listings: this._stats.total, cart: this._cart.length, ledger: this._ledger.length
        };
    }
    /** 重算全部投影（**不重读 storage**）。
     *  ★ 必须单独成口：动作口（收下 / 改价 / 加车 / 结账 / 各 set*）改的是
     *    **内存字段**，投影得跟着变。只在 probe 里算一次的话，动作之后视图
     *    读到的还是上一轮投影 —— 表现是「收下了却什么都没变」，不报错、不崩溃、只错结果。 */
    _recompute() {
        this._catalog = classifyProducts(this._productsRaw);
        /* 收银台按**现算价**核（不信任行里存的旧价）：源在这里也会重取。 */
        const cartRows = [];
        for (let i = 0; i < this._cart.length; i++) {
            const c = this._cart[i] || {};
            const pid = toStr(c.productId);
            let title = toStr(c.title);
            let priceText = toStr(c.priceText);
            if (pid) {
                for (let k = 0; k < this._catalog.rows.length; k++) {
                    const p = this._catalog.rows[k];
                    if (toStr(p.id) === pid) { title = p.title; priceText = p.priceText; break; }
                }
                /* ★ 拒收行也要能对上：车里的行按**行号**存（row0 形态），
                 *   而拒收行只有 index —— 前两版这里写的是取「p.id」（拒收行上根本没有
                 *   这个字段），于是「车里有读不出价的行」这一格永远是空标题。 */
                if (!title) {
                    for (let k = 0; k < this._catalog.rejected.length; k++) {
                        const rj = this._catalog.rejected[k];
                        if (('row' + String(rj.index)) === pid) { title = rj.title; break; }
                    }
                }
            }
            cartRows.push({ index: i, productId: pid, title, priceText, qty: numOrNull(c.qty) });
        }
        this._cartCalc = cartTotal(cartRows);
        this._cartRows = cartRows;
        this._stats = listingStats(this._listings);
        /* 价格引擎：逐条在售算出「定価 / 相场 / 这一件」三档（源只画后两档）。 */
        const engines = [];
        /* ★ 重定价读数必须**每轮重算**：本件第一版只在构造里清一次，
         *   于是动作口每调一次 _recompute 就往上堆一轮 —— 界面上的「明显变动」
         *   会越列越长且带重复，不报错、不崩溃、只错结果。 */
        this._reprices = [];
        for (let i = 0; i < this._listings.length; i++) {
            const l = this._listings[i] || {};
            const pt = toStr(l.priceText);
            const base = priceOf(pt);
            const heat = characterHeat({ goodsOwn: numOrNull(l.heatOwn), plotCount: numOrNull(l.plotCount) });
            const avg = avgPriceFor({
                price: base.ok ? base.value : 0,
                rarity: toStr(l.rarity),
                blindBox: l.blindBox === true,
                variantChar: toStr(l.variantChar),
                variantHeat: { goodsOwn: numOrNull(l.heatOwn) || 0, plotCount: numOrNull(l.plotCount) || 0 }
            });
            const listPrice = numOrNull(l.price);
            const ratio = avg.avg > 0 && listPrice !== null ? (listPrice / avg.avg) : 0;
            const rp = repriceOf(numOrNull(l.prevPrice), listPrice, DJ_MARKET_RATES.repriceThreshold);
            engines.push({
                index: i, id: toStr(l.id), title: toStr(l.title),
                basePrice: base.ok ? base.value : null, baseWhy: base.why,
                avg: avg.avg, mult: avg.mult, heat: avg.heat, byVariant: avg.byVariant,
                listPrice, ratio, sellerType: toStr(l.sellerType) || 'normal',
                condition: toStr(l.condition), status: toStr(l.status) || 'on_sale',
                variantChar: toStr(l.variantChar), bundleQty: numOrNull(l.bundleQty),
                flagged: l.flaggedFake === true, seller: toStr(l.sellerName),
                reprice: rp, heatBand: heat.band
            });
            if (rp.changed) {
                this._reprices.push({ index: i, title: toStr(l.title), from: numOrNull(l.prevPrice), to: listPrice, ratio: rp.ratio });
            }
        }
        this._engines = engines;
        this._gauges = gaugesOf({
            shelf: this._productsRaw.length, ledger: this._ledger.length,
            cart: this._cart.length, titles: this._engines.length
        });
        /* ★ 超限**单列**，不并进「读不懂」那一面：面四态讲的是「这份账读不读得出来」，
         *   而超限是「读得出来但超了」—— 两件事挤成一面时，用户看到的
         *   「店头读不懂」会把人引去查 JSON，而真因只是件数太多（源没有这一格）。 */
        const over = [];
        for (let i = 0; i < this._gauges.length; i++) {
            const g = this._gauges[i];
            if (g.over) over.push({ key: g.key, label: g.label, value: g.value, max: g.max });
        }
        this._over = over;
        this._now = Date.now();
    }

    /* ---------- 视图取数口 ---------- */
    faceOf() { return this._face; }
    faceTextOf() { return FACE_TEXT[this._face] || FACE_TEXT[FACE_ABSENT]; }
    toneOf() { return FACE_TONE[this._face] || 'off'; }
    shopNameOf() { return this._shopName; }
    sourceNoteOf() { return DJ_SOURCE_NOTE; }
    sourceFilesOf() { return DJ_SOURCE_FILES.slice(); }
    summaryLine() {
        const c = this._catalog;
        const s = this._stats;
        const parts = [];
        parts.push('商品 ' + String(c.rows.length) + ' 件');
        if (c.rejected.length) parts.push('拒收 ' + String(c.rejected.length) + ' 行');
        parts.push('在售 ' + String(s.onSale) + ' / 售罄 ' + String(s.sold));
        parts.push('收银台 ' + String(this._cart.length) + ' 行' + (this._cartCalc.ok ? '' : '（有读不出的行）'));
        return parts.join(' · ');
    }
    /** 店头明细读数。 */
    shopMetrics() {
        let novel = 0, manga = 0, music = 0, anthology = 0, goods = 0, r18 = 0;
        for (let i = 0; i < this._catalog.rows.length; i++) {
            const t = this._catalog.rows[i].type;
            if (t === 'novel') novel += 1;
            else if (t === 'manga') manga += 1;
            else if (t === 'music') music += 1;
            else if (t === 'anthology') anthology += 1;
            else if (t === 'goods') goods += 1;
        }
        for (let i = 0; i < this._productsRaw.length; i++) {
            if (toStr(this._productsRaw[i] && this._productsRaw[i].rating) === 'R18') r18 += 1;
        }
        return [
            { k: '社团', v: String(this._circles.length) },
            { k: '即卖会', v: String(this._events.length) },
            { k: '小说', v: String(novel) },
            { k: '漫画', v: String(manga) },
            { k: '音乐 CD', v: String(music) },
            { k: '选集', v: String(anthology) },
            { k: '周边（旧数据）', v: String(goods) },
            { k: 'R18 标记', v: String(r18) }
        ];
    }
    /** 商品行（逐件，带价格三态）。 */
    productRows() {
        const out = [];
        for (let i = 0; i < this._catalog.rows.length; i++) {
            const r = this._catalog.rows[i];
            const t = pickIn(DJ_PRODUCT_TYPES, r.type);
            const st = pickIn(DJ_STATUSES, r.status);
            out.push({
                index: r.index, id: r.id, title: r.title,
                typeLabel: t ? t.label : r.type,
                statusLabel: st ? st.label : r.status,
                statusColor: st ? st.color : '#198754',
                priceText: moneyText(r.price), price: r.price,
                isLegacy: DJ_LEGACY_TYPES.indexOf(r.type) >= 0,
                inCart: this._inCart(r.id)
            });
        }
        return out;
    }
    rejectedRows() { return this._catalog.rejected.slice(); }
    /** 即卖会行（源四档期 + 五态）。 */
    eventRows() {
        const out = [];
        for (let i = 0; i < this._events.length; i++) {
            const e = this._events[i] || {};
            const t = pickIn(DJ_EVENT_TYPES, toStr(e.type));
            const p = pickIn(DJ_EVENT_PHASES, toStr(e.phase) || 'announced');
            out.push({
                index: i, name: toStr(e.name) || '(无名)',
                typeLabel: t ? t.label : toStr(e.type),
                phaseLabel: p ? p.label : toStr(e.phase),
                date: toStr(e.date) || dash(),
                venue: toStr(e.venue) || dash(),
                circles: Array.isArray(e.circleIds) ? e.circleIds.length : 0
            });
        }
        return out;
    }
    /** 在售行（含价格引擎读数：「这一件」相对「相场」的倍率）。 */
    listingRows() {
        const out = [];
        for (let i = 0; i < this._engines.length; i++) {
            const e = this._engines[i];
            const con = pickIn(DJ_CONDITIONS, e.condition);
            const sel = pickIn(DJ_SELLER_TYPES, e.sellerType);
            out.push({
                index: e.index, title: e.title || '(无题)',
                priceText: e.listPrice === null ? dash() : ('¥' + moneyText(e.listPrice)),
                avgText: '¥' + moneyText(e.avg),
                baseText: e.basePrice === null ? dash() : ('¥' + moneyText(e.basePrice)),
                baseWhy: PRICE_WHY_TEXT[e.baseWhy] || e.baseWhy,
                ratioText: e.ratio > 0 ? (e.ratio.toFixed(2) + ' 倍') : dash(),
                ratioHot: e.ratio >= 1.8, ratioCold: e.ratio > 0 && e.ratio <= 0.7,
                conditionLabel: con ? con.label : (e.condition || dash()),
                sellerLabel: sel ? sel.label : e.sellerType,
                seller: e.seller || dash(),
                statusLabel: isSold(e.status) ? '已售出' : '在售',
                sold: isSold(e.status),
                flagged: e.flagged,
                variantChar: e.variantChar,
                bundleQty: e.bundleQty,
                heatText: e.heat.toFixed(2),
                heatBand: e.heatBand,
                byVariant: e.byVariant,
                fav: this._favorites.indexOf(toStr((this._listings[e.index] || {}).id)) >= 0,
                id: toStr((this._listings[e.index] || {}).id)
            });
        }
        return out;
    }
    repriceRows() { return this._reprices.slice(); }
    marketStats() {
        const s = this._stats;
        return [
            { k: '在售', v: String(s.onSale) },
            { k: '已售出', v: String(s.sold) },
            { k: '赝品被识破', v: String(s.fake) },
            { k: '黄牛出品', v: String(s.scalper) },
            { k: '打包甩卖', v: String(s.bundle) },
            { k: '合计', v: String(s.total) },
            { k: '收藏', v: String(this._favorites.length) }
        ];
    }
    /** 收银台行。 */
    cartRows() {
        const out = [];
        for (let i = 0; i < (this._cartRows || []).length; i++) {
            const r = this._cartRows[i];
            const pr = priceOf(r.priceText);
            out.push({
                index: i, title: r.title || '(无题)',
                priceText: pr.ok ? ('¥' + moneyText(pr.value)) : dash(),
                priceWhy: PRICE_WHY_TEXT[pr.why] || pr.why,
                bad: !pr.ok,
                qty: r.qty === null ? dash() : String(r.qty),
                productId: r.productId
            });
        }
        return out;
    }
    cartBadRows() { return this._cartCalc.bad.slice(); }
    cartInfo() {
        return {
            ok: this._cartCalc.ok, total: this._cartCalc.total,
            totalText: '¥' + moneyText(this._cartCalc.total),
            count: this._cartCalc.count, bad: this._cartCalc.bad.length,
            rows: this._cart.length, orders: this._orders.length,
            max: DJ_CART_MAX
        };
    }
    orderRows() {
        const out = [];
        const rev = this._orders.slice().reverse();
        for (let i = 0; i < rev.length; i++) {
            const o = rev[i] || {};
            const t = numOrNull(o.total);
            out.push({
                index: i, n: Array.isArray(o.productIds) ? o.productIds.length : 0,
                totalText: t === null ? dash() : ('¥' + moneyText(t)),
                at: numOrNull(o.at)
            });
        }
        return out;
    }
    /** 四项上限余量。 */
    gaugeRows() {
        const out = [];
        for (let i = 0; i < this._gauges.length; i++) {
            const g = this._gauges[i];
            const pct = (g.value === null) ? null : Math.min(100, Math.round((g.value / g.max) * 100));
            out.push({
                key: g.key, label: g.label, text: gaugeText(g),
                blank: g.value === null, over: g.over === true,
                tone: g.over ? 'err' : (g.value !== null && pct >= 80 ? 'warn' : 'ok'),
                pct: pct === null ? 0 : pct
            });
        }
        return out;
    }
    gaugeInfo() {
        const g = gaugesOf({
            shelf: this._productsRaw.length, ledger: this._ledger.length,
            cart: this._cart.length, titles: this._engines.length
        });
        return g.map((x) => ({ key: x.key, value: x.value, max: x.max }));
    }
    /** 超限项（**单列**，不并进「读不懂」那一面）。 */
    overRows() { return this._over.slice(); }
    /** 台账。 */
    ledgerRows() {
        const out = [];
        const rev = this._ledger.slice().reverse();
        for (let i = 0; i < rev.length; i++) {
            const r = rev[i] || {};
            out.push({ index: i, kind: toStr(r.kind), ok: r.ok === true, why: toStr(r.why), note: this._noteOf(r.detail) });
        }
        return out;
    }
    ledgerInfo() { return { kept: this._ledger.length, dropped: this._dropped, max: DJ_LEDGER_MAX }; }
    _noteOf(d) {
        const o = d || {};
        const parts = [];
        if (numOrNull(o.n) !== null) parts.push(String(numOrNull(o.n)) + ' 条');
        if (numOrNull(o.bad) !== null && numOrNull(o.bad) > 0) parts.push('读不出 ' + String(o.bad) + ' 行');
        if (numOrNull(o.total) !== null) parts.push('合计 ¥' + moneyText(o.total));
        if (toStr(o.title)) parts.push(toStr(o.title));
        if (toStr(o.why)) parts.push(toStr(o.why));
        return parts.join(' · ');
    }
    /** 价格引擎行（选中某件在售时给三档）。 */
    engineRows() {
        const out = [];
        const f = this._engines.filter((e) => e.id === this._focus || String(e.index) === this._focus);
        const list = f.length ? f : this._engines.slice(0, 1);
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            out.push({ label: '定価', val: e.basePrice === null ? dash() : ('¥' + moneyText(e.basePrice)) });
            out.push({ label: '相场（均价）', val: '¥' + moneyText(e.avg) });
            out.push({ label: '这一件', val: e.listPrice === null ? dash() : ('¥' + moneyText(e.listPrice)) });
            out.push({ label: '稀有度倍率', val: e.mult.toFixed(2) + ' 倍' });
            out.push({ label: '角色热度', val: e.heat.toFixed(2) + '（' + (e.heatBand === 'hot' ? '热' : (e.heatBand === 'cold' ? '冷' : '普通')) + '）' });
            out.push({ label: '计算口径', val: e.byVariant ? '按单款角色（盲盒）' : '按系列最高热度' });
            out.push({ label: '相对相场', val: e.ratio > 0 ? (e.ratio.toFixed(2) + ' 倍') : dash() });
        }
        return out;
    }
    focusOf() { return this._focus; }
    setFocus(v) {
        this._focus = toStr(v);
        this._recompute();
        return { ok: true, focus: this._focus };
    }
    /** 规则表（源的四条定价规则；界面展示「为什么黄牛这么贵」）。 */
    ruleRows() {
        const out = [];
        for (let i = 0; i < DJ_PRICE_RULES.length; i++) {
            const r = DJ_PRICE_RULES[i];
            out.push({ label: r.key, val: r.lo.toFixed(1) + ' – ' + r.hi.toFixed(1) + ' 倍', note: r.note });
        }
        return out;
    }
    ratesRows() {
        const r = DJ_MARKET_RATES;
        return [
            { label: '新品上架', val: String(Math.round(r.newListing * 100)) + '%／件' },
            { label: '单次最多', val: String(r.newListingMax) + ' 件' },
            { label: '被买走', val: String(Math.round(r.sold * 100)) + '%' },
            { label: '重新定价', val: String(Math.round(r.reprice * 100)) + '%' },
            { label: '明显变动阈值', val: String(r.repriceThreshold) }
        ];
    }
    /** 下拉候选（**键面取真源**：真源表增删一项，这里跟着变）。 */
    catalogs() {
        return {
            types: DJ_PRODUCT_TYPES.map((t) => ({ key: t.key, label: t.label })),
            statuses: DJ_STATUSES.map((t) => ({ key: t.key, label: t.label })),
            conditions: DJ_CONDITIONS.map((t) => ({ key: t.key, label: t.label })),
            rarities: DJ_RARITIES.map((t) => ({ key: t.key, label: t.label })),
            sellers: DJ_SELLER_TYPES.map((t) => ({ key: t.key, label: t.label })),
            generatable: DJ_GENERATABLE_TYPES.slice()
        };
    }
    priceWhyTextOf(w) { return PRICE_WHY_TEXT[w] || toStr(w); }
    rowWhyTextOf(w) { return ROW_WHY_TEXT[w] || toStr(w); }

    /* ---------- 动作口：收下（贴回的 JSON） ---------- */
    /** 收下商品。★ 逐行核一遍再落：源是「找到社团就收、找不到就丢」，
     *  本件把丢掉的**逐行**报出来（第几行、什么原因）。 */
    ingestShopText(text) {
        const raw = toStr(text);
        const box = this._extractList(raw);
        if (!box.ok) {
            this._receipt('ingest_shop', false, box.why, {});
            return Object.assign(this._savedOk(false), { ok: false, why: box.why, saw: box.saw });
        }
        let landed = 0;
        const before = this._productsRaw.length;
        for (let i = 0; i < box.items.length; i++) {
            const p = box.items[i] || {};
            const title = toStr(p.title);
            const pr = priceOf(p.price);
            /* ★ 坏行也要**落进台账**（原样留着），不在这里丢：
             *   本件的立场是「逐行拒收要落账」—— 源是把整件商品静默跳过后再也找不回。
             *   裁定权归 classifyProducts 一处（那是投影面的唯一口径），
             *   这里只把行收进来。若在这里直接丢，投影面永远看不到拒收行 ——
             *   表现是「界面上那两行凭空消失」，用户连「为什么没收」都查不到。 */
            this._productsRaw.push({
                /* ★ 不写 id：行 id 由数据层按**行号**稳定派生（见 classifyProducts）。
                 *   写死 id 的话，「行号」与「id」两套标号会各说各话 —— 用户按序号点入车，
                 *   而车按 id 找件，对不上时表现为「点了没反应」，不报错也不崩溃。 */
                title,
                type: this._generatableOf(toStr(p.type)),
                status: toStr(p.status) || DJ_STATUSES[2].key,
                price: pr.ok ? pr.value : null,
                /* ★ priceText 存**原样文本**（收下时看到的那个价）：投影面
                 *   （classifyProducts → cartTotal）拿它按字符串重核价 —— 本仓
                 *   「车里的行按现算价核，不信任行里存的旧价」。存成数字形态的话，
                 *   收银台会把每一行都判成「读不出价」，合计永远是 0 且不可信。 */
                priceText: toStr(p.price) || (pr.ok ? String(pr.value) : ''),
                qty: 1,
                circle: toStr(p.circle)
            });
        }
        this._recompute();
        const wrote = this._persistShop();
        /* ★ added 是「**这一次新收进来的合法件数**」（不是台账总件数）：
         *   契约上 total 才是总量。若把总件数当 added 报，第二次收下时
         *   界面会报「新收 4 件」而实际只多了 2 件 —— 不报错、只错数。 */
        const added = this._catalog.rows.length - before;
        /* 逐行裁定**取自投影面**（与用户看到的那一份逐字同源）。 */
        const bad = this._catalog.rejected.map((r) => ({ index: r.index, title: r.title, why: r.why }));
        landed = box.items.length;
        this._receipt('ingest_shop', true, '', { n: added, bad: bad.length });
        return Object.assign(this._savedOk(wrote), {
            ok: added > 0 || this._catalog.rows.length > 0,
            added, landed, rejected: bad, total: this._productsRaw.length
        });
    }
    /** 收下二手在售（含稀有度 / 盲盒 / 品相 / 卖家类型）。 */
    ingestListingText(text) {
        const raw = toStr(text);
        const box = this._extractList(raw);
        if (!box.ok) {
            this._receipt('ingest_listing', false, box.why, {});
            return Object.assign(this._savedOk(false), { ok: false, why: box.why, saw: box.saw });
        }
        let added = 0;
        const bad = [];
        for (let i = 0; i < box.items.length; i++) {
            const p = box.items[i] || {};
            const title = toStr(p.title);
            const pr = priceOf(p.price);
            if (!title) { bad.push({ index: i, why: DJ_ROW_WHYS[1] }); continue; }
            if (!pr.ok) { bad.push({ index: i, why: pr.why === DJ_PRICE_WHYS[2] ? DJ_ROW_WHYS[3] : DJ_ROW_WHYS[2] }); continue; }
            const rar = pickIn(DJ_RARITIES, toStr(p.rarity));
            const con = pickIn(DJ_CONDITIONS, toStr(p.condition));
            const sel = pickIn(DJ_SELLER_TYPES, toStr(p.seller));
            this._listings.push({
                id: 'dl' + String(this._listings.length + 1) + '_' + String(Date.now()),
                title,
                priceText: toStr(p.price),
                price: pr.value,
                prevPrice: null,
                rarity: rar ? rar.key : DJ_RARITIES[0].key,
                condition: con ? con.key : DJ_CONDITIONS[0].key,
                sellerType: sel ? sel.key : DJ_SELLER_TYPES[0].key,
                status: toStr(p.status) || 'on_sale',
                blindBox: p.blindBox === true,
                variantChar: toStr(p.variantChar),
                bundleQty: numOrNull(p.bundleQty),
                sellerName: toStr(p.sellerName),
                heatOwn: numOrNull(p.heatOwn),
                plotCount: numOrNull(p.plotCount),
                flaggedFake: p.fake === true
            });
            added += 1;
        }
        this._recompute();
        const wrote = this._persistMarket();
        this._receipt('ingest_listing', true, '', { n: added, bad: bad.length });
        return Object.assign(this._savedOk(wrote), {
            ok: added > 0, added, rejected: bad, total: this._listings.length
        });
    }
    _generatableOf(t) {
        for (let i = 0; i < DJ_GENERATABLE_TYPES.length; i++) {
            if (DJ_GENERATABLE_TYPES[i] === t) return t;
        }
        return DJ_GENERATABLE_TYPES[0];
    }
    /** 从一段文本里取数组/对象：**不用正则**（按括号配对扫）。
     *  三种回报：ok / no_bracket（一个括号都没有）/ bad_json（取到了但解不开）。 */
    _extractList(text) {
        const s = toStr(text);
        if (!s.trim()) return { ok: false, why: 'empty', saw: '' };
        const open1 = s.indexOf('[');
        const close1 = s.lastIndexOf(']');
        if (open1 >= 0 && close1 > open1) {
            const slice = s.slice(open1, close1 + 1);
            try {
                const arr = JSON.parse(slice);
                if (Array.isArray(arr)) return { ok: true, why: '', items: arr, saw: '' };
                return { ok: false, why: 'bad_json', saw: slice.slice(0, 20) };
            } catch (e) {
                return { ok: false, why: 'bad_json', saw: slice.slice(0, 20) };
            }
        }
        const open2 = s.indexOf('{');
        const close2 = s.lastIndexOf('}');
        if (open2 >= 0 && close2 > open2) {
            const slice = s.slice(open2, close2 + 1);
            try {
                const obj = JSON.parse(slice);
                if (obj && typeof obj === 'object') return { ok: true, why: '', items: [obj], saw: '' };
                return { ok: false, why: 'bad_json', saw: slice.slice(0, 20) };
            } catch (e) {
                return { ok: false, why: 'bad_json', saw: slice.slice(0, 20) };
            }
        }
        /* ★ 有括号但配不上对，是「取到了但解不开」，**不是**「一个括号都没有」：
         *   两件事挤成一个键时，用户拿到「没有括号」会去重贴一遍文本 ——
         *   而真因是括号写残了（源在这里也是静默归零）。 */
        if (s.indexOf('[') >= 0 || s.indexOf(']') >= 0 || s.indexOf('{') >= 0 || s.indexOf('}') >= 0) {
            return { ok: false, why: 'bad_json', saw: s.slice(0, 20) };
        }
        return { ok: false, why: 'no_bracket', saw: s.slice(0, 20) };
    }

    /* ---------- 动作口：改价 / 改属性 ---------- */
    setPrice(id, text) {
        const key = toStr(id);
        for (let i = 0; i < this._listings.length; i++) {
            if (toStr(this._listings[i].id) !== key) continue;
            const old = numOrNull(this._listings[i].price);
            const pr = priceOf(text);
            if (!pr.ok) {
                this._receipt('set_price', false, pr.why, {});
                return Object.assign(this._savedOk(false), { ok: false, why: pr.why, saw: toStr(text).slice(0, 20) });
            }
            this._listings[i].prevPrice = old;
            this._listings[i].priceText = toStr(text);
            this._listings[i].price = pr.value;
            this._recompute();
            const wrote = this._persistMarket();
            const rp = repriceOf(old, pr.value, DJ_MARKET_RATES.repriceThreshold);
            this._receipt('set_price', true, '', { n: 1, title: toStr(this._listings[i].title) });
            return Object.assign(this._savedOk(wrote), {
                ok: true, from: old, to: pr.value, changed: rp.changed, ratio: rp.ratio
            });
        }
        this._receipt('set_price', false, 'not_found', {});
        return Object.assign(this._savedOk(false), { ok: false, why: 'not_found' });
    }
    setField(id, field, value) {
        const key = toStr(id);
        const f = toStr(field);
        const tables = { rarity: DJ_RARITIES, condition: DJ_CONDITIONS, sellerType: DJ_SELLER_TYPES, status: null };
        for (let i = 0; i < this._listings.length; i++) {
            if (toStr(this._listings[i].id) !== key) continue;
            if (f === 'status') {
                let hit = null;
                for (let k = 0; k < DJ_STATUSES.length; k++) if (DJ_STATUSES[k].key === toStr(value)) hit = DJ_STATUSES[k];
                if (!hit) {
                    this._receipt('set_field', false, 'unknown', {});
                    return Object.assign(this._savedOk(false), { ok: false, why: 'unknown', saw: toStr(value) });
                }
                this._listings[i].status = hit.key;
            } else {
                const table = tables[f];
                if (!table) {
                    this._receipt('set_field', false, 'no_field', {});
                    return Object.assign(this._savedOk(false), { ok: false, why: 'no_field', saw: f });
                }
                const hit = pickIn(table, toStr(value));
                if (!hit) {
                    this._receipt('set_field', false, 'unknown', {});
                    return Object.assign(this._savedOk(false), { ok: false, why: 'unknown', saw: toStr(value) });
                }
                this._listings[i][f] = hit.key;
            }
            this._recompute();
            const wrote = this._persistMarket();
            this._receipt('set_field', true, '', { title: toStr(this._listings[i].title) });
            return Object.assign(this._savedOk(wrote), { ok: true, field: f, value: toStr(value) });
        }
        this._receipt('set_field', false, 'not_found', {});
        return Object.assign(this._savedOk(false), { ok: false, why: 'not_found' });
    }
    toggleFav(id) {
        const key = toStr(id);
        const at = this._favorites.indexOf(key);
        if (at >= 0) this._favorites.splice(at, 1); else this._favorites.push(key);
        this._recompute();
        const wrote = this._persistMarket();
        this._receipt('fav', true, '', { n: this._favorites.length });
        return Object.assign(this._savedOk(wrote), { ok: true, fav: at < 0, n: this._favorites.length });
    }
    removeListing(id) {
        const key = toStr(id);
        const keep = [];
        let removed = 0;
        for (let i = 0; i < this._listings.length; i++) {
            if (toStr(this._listings[i].id) === key) { removed += 1; continue; }
            keep.push(this._listings[i]);
        }
        this._listings = keep;
        this._recompute();
        const wrote = this._persistMarket();
        this._receipt('remove_listing', true, '', { n: removed });
        return Object.assign(this._savedOk(wrote), { ok: true, removed });
    }

    /* ---------- 动作口：收银台 ---------- */
    _inCart(id) {
        const key = toStr(id);
        for (let i = 0; i < this._cart.length; i++) {
            if (toStr(this._cart[i].productId) === key) return true;
        }
        return false;
    }
    addToCart(id) {
        const key = toStr(id);
        if (!key) {
            this._receipt('cart_add', false, 'no_id', {});
            return Object.assign(this._savedOk(false), { ok: false, why: 'no_id' });
        }
        if (this._inCart(key)) {
            this._receipt('cart_add', false, 'already', {});
            return Object.assign(this._savedOk(false), { ok: false, why: 'already' });
        }
        if (this._cart.length >= DJ_CART_MAX) {
            /* ★ 上满**不许**静默不收：报出上限与当前行数（源只弹一句 toast）。 */
            this._receipt('cart_add', false, 'over_limit', { n: this._cart.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'over_limit', max: DJ_CART_MAX, rows: this._cart.length });
        }
        this._cart.push({ productId: key, qty: 1 });
        this._recompute();
        const wrote = this._persistCart();
        this._receipt('cart_add', true, '', { n: this._cart.length });
        return Object.assign(this._savedOk(wrote), { ok: true, rows: this._cart.length });
    }
    setQty(id, qty) {
        const key = toStr(id);
        const n = numOrNull(qty);
        for (let i = 0; i < this._cart.length; i++) {
            if (toStr(this._cart[i].productId) !== key) continue;
            if (n === null || n < 1 || n > DJ_QTY_MAX) {
                this._receipt('cart_qty', false, 'out_of_range', {});
                return Object.assign(this._savedOk(false), { ok: false, why: 'out_of_range', min: 1, max: DJ_QTY_MAX, saw: toStr(qty) });
            }
            this._cart[i].qty = n;
            this._recompute();
            const wrote = this._persistCart();
            this._receipt('cart_qty', true, '', { n });
            return Object.assign(this._savedOk(wrote), { ok: true, qty: n });
        }
        this._receipt('cart_qty', false, 'not_found', {});
        return Object.assign(this._savedOk(false), { ok: false, why: 'not_found' });
    }
    removeFromCart(id) {
        const key = toStr(id);
        const keep = [];
        let removed = 0;
        for (let i = 0; i < this._cart.length; i++) {
            if (toStr(this._cart[i].productId) === key) { removed += 1; continue; }
            keep.push(this._cart[i]);
        }
        this._cart = keep;
        this._recompute();
        const wrote = this._persistCart();
        this._receipt('cart_remove', true, '', { n: removed });
        return Object.assign(this._savedOk(wrote), { ok: true, removed });
    }
    clearCart() {
        const n = this._cart.length;
        this._cart = [];
        this._recompute();
        const wrote = this._persistCart();
        this._receipt('cart_clear', true, '', { n });
        return Object.assign(this._savedOk(wrote), { ok: true, cleared: n });
    }
    /** 结账。★ 只动**本件的车与历史**：源在 purchase() 里直接扣钱包余额、
     *  写交易流水（LinePay）—— 本件一律不碰（四块不缝第一条）。
     *  ★ 合计不可信时**不许**照样结：先把读不出的行原样报出来。 */
    settle() {
        if (!this._cart.length) {
            this._receipt('settle', false, 'empty', {});
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty' });
        }
        if (!this._cartCalc.ok) {
            this._receipt('settle', false, 'bad_rows', { bad: this._cartCalc.bad.length });
            return Object.assign(this._savedOk(false), {
                ok: false, why: 'bad_rows', bad: this._cartCalc.bad.length,
                rows: this._cartCalc.bad.slice()
            });
        }
        const ids = this._cart.map((c) => toStr(c.productId));
        this._orders.push({ productIds: ids, total: this._cartCalc.total, at: Date.now() });
        const total = this._cartCalc.total;
        const n = this._cart.length;
        this._cart = [];
        this._recompute();
        const wrote = this._persistCart();
        this._receipt('settle', true, '', { n, total });
        return Object.assign(this._savedOk(wrote), { ok: true, n, total });
    }

    /* ---------- 动作口：台账 / 清空 ---------- */
    /** 记一笔。★ 挤掉旧记录要**计数报出来**（源静默 shift）。 */
    _receipt(kind, ok, why, detail) {
        this._ledger.push({ at: Date.now(), kind, ok: ok === true, why: toStr(why), detail: detail || {} });
        const tr = ledgerTrim(this._ledger, DJ_LEDGER_MAX);
        this._ledger = tr.keep;
        this._dropped += tr.dropped;
        this._persistLedger();
    }
    clearLedger() {
        this._ledger = [];
        this._dropped = 0;
        const wrote = this._persistLedger();
        return Object.assign(this._savedOk(wrote), { ok: true, dropped: 0 });
    }
    /** 清店头与车。★ **不顺手清台账**：按钮字面只说「店头与车」
     *  —— 而源把四类挤在一处，清一次在售列表会把动作流水一起清掉。 */
    clearShop() {
        this._shopName = 'メロンブックス';
        this._circles = [];
        this._productsRaw = [];
        this._events = [];
        this._shelf = [];
        this._listings = [];
        this._favorites = [];
        this._cart = [];
        this._face = FACE_EMPTY;
        this._malformed = false;
        this._focus = '';
        this._draft = '';
        this._recompute();
        /* ★ 四条键各自落（键不同，不会互相覆盖）：店头 / 市场 / 车各写一条。
         *   动作台账**不写** —— 这一步只清「店头与车」，动作记录得留着
         *   （源把四类挤在一处，清一次在售列表会把流水一起清掉）。 */
        const wrote = this._persistShop();
        this._persistMarket();
        this._persistCart();
        this._receipt('clear_shop', true, '', {});
        return Object.assign(this._savedOk(wrote), { ok: true });
    }

    /* ---------- 成文（可复制的要求文本） ---------- */
    composeText() {
        const lines = [];
        lines.push('【同人商店 · 台面】' + this._shopName);
        lines.push('—— 商品 ' + String(this._catalog.rows.length) + ' 件（拒收 ' + String(this._catalog.rejected.length) + ' 行）');
        for (let i = 0; i < this._catalog.rows.length; i++) {
            const r = this._catalog.rows[i];
            lines.push(String(i + 1) + '. ' + r.title + ' · ' + (pickIn(DJ_PRODUCT_TYPES, r.type) || {}).label + ' · ¥' + moneyText(r.price));
        }
        lines.push('');
        lines.push('【二手市场 · 在售 ' + String(this._stats.onSale) + ' 件】');
        for (let i = 0; i < this._engines.length; i++) {
            const e = this._engines[i];
            if (isSold(e.status)) continue;
            lines.push(String(i + 1) + '. ' + (e.title || '无题') + ' · ¥' + moneyText(e.listPrice)
                + ' · 相场 ¥' + moneyText(e.avg) + ' · ' + (e.ratio > 0 ? (e.ratio.toFixed(2) + ' 倍') : '--')
                + (e.flagged ? ' · 疑似赝品' : ''));
        }
        lines.push('');
        lines.push('【收银台】' + (this._cartCalc.ok ? ('合计 ¥' + moneyText(this._cartCalc.total)) : ('有 ' + String(this._cartCalc.bad.length) + ' 行读不出来')));
        lines.push('');
        lines.push('【四项上限】');
        const g = this.gaugeRows();
        for (let i = 0; i < g.length; i++) lines.push('- ' + g[i].label + '：' + g[i].text);
        return lines.join(String.fromCharCode(10));
    }
    requestText() {
        if (!this._draft) return this.composeText();
        return this._draft;
    }
    draftOf() { return this._draft; }
    setDraft(text) {
        this._draft = toStr(text);
        this._recompute();
        return { ok: true, chars: charCount(this._draft) };
    }
    clearDraft() {
        this._draft = '';
        this._recompute();
        return { ok: true, chars: 0 };
    }
    saveToShelf() {
        const text = this.requestText();
        if (!text) {
            this._receipt('save_shelf', false, 'empty', {});
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty' });
        }
        if (charCount(text) > DJ_SHELF_TEXT_MAX) {
            this._receipt('save_shelf', false, 'over_limit', {});
            return Object.assign(this._savedOk(false), { ok: false, why: 'over_limit', chars: charCount(text) });
        }
        if (!Array.isArray(this._shelf)) this._shelf = [];
        if (this._shelf.length >= DJ_SHELF_STORE_MAX) {
            this._receipt('save_shelf', false, 'shelf_full', { n: this._shelf.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'shelf_full', max: DJ_SHELF_STORE_MAX });
        }
        this._shelf.push({ at: Date.now(), chars: charCount(text), products: this._catalog.rows.length, text });
        this._recompute();
        /* ★ 存档与店头同一条键，故写盘走 _persistShop() —— 两者必须一起落，
         *   分开落时后写的那次会把先写的那次覆盖掉（同一键、整份覆盖）。 */
        const wrote = this._persistShop();
        this._receipt('save_shelf', true, '', { n: this._catalog.rows.length });
        return Object.assign(this._savedOk(wrote), { ok: true, kept: this._shelf.length });
    }
    shelfRows() {
        const out = [];
        const s = Array.isArray(this._shelf) ? this._shelf : [];
        const rev = s.slice().reverse();
        for (let i = 0; i < rev.length; i++) {
            out.push({ index: i, chars: rev[i].chars, products: rev[i].products, at: rev[i].at });
        }
        return out;
    }
    removeFromShelf(index) {
        const n = numOrNull(index);
        const s = Array.isArray(this._shelf) ? this._shelf : [];
        if (n === null || n < 0 || n >= s.length) {
            this._receipt('shelf_remove', false, 'out_of_range', {});
            return Object.assign(this._savedOk(false), { ok: false, why: 'out_of_range' });
        }
        s.splice(s.length - 1 - n, 1);
        this._recompute();
        const wrote = this._persistShop();
        this._receipt('shelf_remove', true, '', { n: 1 });
        return Object.assign(this._savedOk(wrote), { ok: true, kept: s.length });
    }

    /* ---------- 页签 ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = toStr(t);
        const ok = ['shop', 'market', 'cart', 'shelf'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'shop';
        return this._tab;
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：店头 / 市场 / 车 / 台账 全是「这段关系的账」，故全部重取。
     *  ★ 四格的装载由 probe **一处**承担（单一装载路径）。 */
    onChatChanged() {
        this._clearToDefaults();
        this._tab = 'shop';
        this._focus = '';
        this._now = 0;
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, face: this._face };
    }
    render() {
        this.probe();
        if (!this._view) this._view = new DoujinView(this, this.shell, this.storage);
        this._view.render();
    }
}