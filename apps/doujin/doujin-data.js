/* ========================================================
 * doujin-data.js — [v3.44.0] 同人商店 · 纯函数内核
 * --------------------------------------------------------
 * 缝合自 Perigee OS 的两件：
 *   · js/melonbooks.js —— メロンブックス（同人ショップシミュレーター）
 *     1837 行 / 56 方法
 *   · js/mercari.js —— メルカリ（フリマ二手市场）
 *     906 行 / 57 方法
 * 两件合计 2743 行 / 113 方法（块文件 nuo_sources/nuo3/live/blk_melon.txt）。
 *
 * ── 为什么两件合一件（源自己写明的）──────────────────
 *   源 melonbooks.js 的定数注释逐字写着「goods（グッズ）は旧データ表示用に
 *   残す。新規生成では使わない — **周边は将来の Mercari モジュールへ**」：
 *   商店与二手市场在源里本就是一条流水线（商店出货 → 周边 → 市场转手）。
 *   拆成两件会把「同一件周边的两次身价」劈开 —— 一手价在甲件、二手均价在
 *   乙件，而两处用的角色热度算法是同一套。本件合成一件，两个面（商店 / 市场）
 *   共享同一份台账与同一个价格引擎。
 *
 * ── 立场差 ───────────────────────────────────────────
 *   源是**店员而且是收银的那个人**：自己起 AI 会话生成新刊与市场行情、自己
 *   把出售按钮接进钱包余额与交易流水（LinePay）、自己按剧情节点推进售罄与
 *   价格波动、自己直读宿主界面元素（getElementById 二十余处）。
 *   本件是**柜台**：只把商品 / 社团 / 即卖会 / 二手在售收拾成一份**账**，
 *   产**可复制的要求文本**（requestText），把价算准、把不合法行逐条报出来。
 *
 * ── 四块不缝（逐条写进文件头与条目）──────────────────
 *   ① 不连钱包（源 purchase() 直接扣 LinePay 余额并写交易流水）；
 *   ② 不落库不落外部备份（源 Utils.saveData / IndexedDB / GitHub 备份）；
 *   ③ 不出图（源 _buildCoverPrompt + dispatchGenerate 逐件出封面）；
 *   ④ 不读宿主界面元素（源满篇 document.getElementById 直读宿主 td/div）。
 *
 * ── 四条偏离（源静默失效的地方，本件一律升为读数）────
 *   ① **价格解析不许把「没数字」读成 0**：源是「把非数字字符全剥掉、
 *      再 parseInt、再 || 0」三步 ——「¥500」与「面议」同得 0，于是购物车
 *      里两件不同商品都能算出 0 元合计。本件三态回报
 *      （ok / no_digits / over_limit）并逐条报出是第几行。
 *   ② **商品行不许静默跳过**：源在 _generateProducts 里找到社团就收下、
 *      找不到就「直接 return 跳过这一条」—— 整个商品被丢掉，
 *      只留一句「一致に失敗しました」。本件逐条报 why。
 *   ③ **价格档不许只丢一句「波动了」**：源 refreshMarket 只在
 *      新旧价差比例超过 0.08 时改价且不留旧值语义。
 *      本件把重定价逐条报出来（旧价 / 新价 / 幅度）。
 *   ④ **盲盒与普通周边不许同形**：源 _avgPriceFor 在盲盒时按单款角色热度、
 *      普通周边取 charNames 最高热度，两者都返回一个数，界面看不出差别。
 *      本件把「按款」与「按系列」标出来（variantChar 是否在）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（三态回报）；
 *   · 题面读不出来 **不许**读成「一件商品都没有」（四态面分开判）；
 *   · 价格没数字 **不许**读成 0；
 *   · 上限余量取不出来 **不许**画成 0（null 与 0 不同形）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）。
 *
 * ── 实现纪律 ─────────────────────────────────────────
 *   · 本件**不许出现正则字面量**（本仓剥注释器是字符状态机、不解析正则）、
 *     **不许出现反斜杠**、也不许出现反引号；
 *   · 一切字符切分走 indexOf / slice / split 的字串形态。
 * ======================================================== */
'use strict';

/* ---------- 题面：来源说明（唯一出处，视图与条目都读它） ---------- */
export const DJ_SOURCE_NOTE = 'Perigee OS · メロンブックス（同人商店）+ メルカリ（二手市场）';
export const DJ_SOURCE_FILES = Object.freeze([
    'melonbooks.js', 'mercari.js'
]);

/* ---------- 真源表 · 商品五型（源的 _PRODUCT_TYPES / _PRODUCT_TYPES_JA 逐条对齐） ---------- */
/** 源把商品类型做成「显示值表」与「AI 用日文表」两份、且两处键相同。
 *  本件合成一份：key 是稳定键，label 是显示名，ja 是进 AI 的日文（源的铁律
 *  「会进 LLM 的不翻」）—— 三个格子各自独立，避免「改显示名顺手改了 prompt」。 */
export const DJ_PRODUCT_TYPES = Object.freeze([
    Object.freeze({ key: 'novel', label: '小说', ja: '小説' }),
    Object.freeze({ key: 'manga', label: '漫画', ja: '漫画' }),
    Object.freeze({ key: 'goods', label: '周边', ja: 'グッズ' }),
    Object.freeze({ key: 'music', label: '音乐 CD', ja: '音楽CD' }),
    Object.freeze({ key: 'anthology', label: '选集', ja: 'アンソロジー' })
]);
/** 源 _GENERATABLE_TYPES —— 新规生成**不含** goods（周边走二手市场那一面）。 */
export const DJ_GENERATABLE_TYPES = Object.freeze(['novel', 'manga', 'music', 'anthology']);
/** 源 goods 类型标着「旧データ表示用に残す」：既存记录照显，新生成不再产。 */
export const DJ_LEGACY_TYPES = Object.freeze(['goods']);

/* ---------- 真源表 · 即卖会四型与四档期 ---------- */
export const DJ_EVENT_TYPES = Object.freeze([
    Object.freeze({ key: 'comike', label: '同人志即卖会', ja: 'コミックマーケット' }),
    Object.freeze({ key: 'only', label: 'ONLY 展', ja: 'オンリーイベント' }),
    Object.freeze({ key: 'online', label: '线上即卖', ja: 'オンライン即売会' }),
    Object.freeze({ key: 'other', label: '其他', ja: 'その他' })
]);
/** 源的档期顺序（_EVENT_PHASE_ORDER 逐条对齐：告知 → 临近 → 举办中 → 结束）。 */
export const DJ_EVENT_PHASES = Object.freeze([
    Object.freeze({ key: 'announced', label: '告知' }),
    Object.freeze({ key: 'preopen', label: '临近' }),
    Object.freeze({ key: 'open', label: '举办中' }),
    Object.freeze({ key: 'closed', label: '结束' })
]);

/* ---------- 真源表 · 商品五态（_STATUS_LABELS 逐条对齐） ---------- */
/** 源把状态做成 label 表 + color 表 + 顺序（cycleStatus 逐档推进）。
 *  本件把三者合成一行，顺序即 cycleStatus 的推进序。 */
export const DJ_STATUSES = Object.freeze([
    Object.freeze({ key: 'upcoming', label: '告知', color: '#6c757d' }),
    Object.freeze({ key: 'preorder', label: '预约中', color: '#0d6efd' }),
    Object.freeze({ key: 'on_sale', label: '在售', color: '#198754' }),
    Object.freeze({ key: 'mail_order', label: '通贩开始', color: '#e8530e' }),
    Object.freeze({ key: 'sold_out', label: '完售', color: '#dc3545' })
]);

/* ---------- 真源表 · 二手品相四档（源 _CONDITIONS 逐条对齐） ---------- */
/** ★ 源把品相**以日文原文当存储键**（'新品、未使用' 等），显示时才映射。
 *  本件沿用它：key 就是源的那串日文 —— 因为它是**存储契约**，
 *  改了键旧台账就读不回来。label 另给中文显示名。 */
export const DJ_CONDITIONS = Object.freeze([
    Object.freeze({ key: '新品、未使用', label: '全新未使用' }),
    Object.freeze({ key: '未使用に近い', label: '接近未使用' }),
    Object.freeze({ key: '目立った傷や汚れなし', label: '无明显损伤' }),
    Object.freeze({ key: 'やや傷や汚れあり', label: '略有损伤' })
]);

/* ---------- 真源表 · 稀有度三档与倍率（源 _RARITY_MULT 逐条对齐） ---------- */
/** ★ 偏离 ④：源以中文当键（'通常'/'限定'/'特典'），本件另给英文 key，
 *  但 mult 数字**逐条照抄源**（1.0 / 2.5 / 4.0），且保留 sourceKey —— 
 *  这样「旧台账里的中文键」仍能读回来（sourceKey 就是那串中文）。 */
export const DJ_RARITIES = Object.freeze([
    Object.freeze({ key: 'normal', sourceKey: '通常', label: '通常', mult: 1.0 }),
    Object.freeze({ key: 'limited', sourceKey: '限定', label: '限定', mult: 2.5 }),
    Object.freeze({ key: 'bonus', sourceKey: '特典', label: '特典', mult: 4.0 })
]);

/* ---------- 真源表 · 三类卖家（源 _listingPrice 的三个分支逐条对齐） ---------- */
export const DJ_SELLER_TYPES = Object.freeze([
    Object.freeze({ key: 'normal', label: '普通卖家' }),
    Object.freeze({ key: 'scalper', label: '黄牛' }),
    Object.freeze({ key: 'counterfeit', label: '赝品' })
]);
/** 源的定价系数表（**逐条照抄**，本件不自己发明数字）。
 *  scalper: 2.0 + rand*3.0 ／ counterfeit: 0.7 + rand*0.4
 *  normal: 15% 概率急售 0.5 + rand*0.2，否则 0.8 + rand*0.5
 *  ★ 这是「源的事实」：本件把它列成表，让「为什么黄牛这么贵」可对。 */
export const DJ_PRICE_RULES = Object.freeze([
    Object.freeze({ key: 'scalper', lo: 2.0, hi: 5.0, note: '2.0 + rand*3.0' }),
    Object.freeze({ key: 'counterfeit', lo: 0.7, hi: 1.1, note: '0.7 + rand*0.4' }),
    Object.freeze({ key: 'normal', lo: 0.8, hi: 1.3, note: '0.8 + rand*0.5' }),
    Object.freeze({ key: 'normal_urgent', lo: 0.5, hi: 0.7, note: '急售 15%：0.5 + rand*0.2' })
]);

/* ---------- 读数与拒收因（真源，界面文案表读它） ---------- */
/** 价格解析三态。源只有「一个数」这一种回报，故「没数字」与「0 元」同形。 */
export const DJ_PRICE_WHYS = Object.freeze(['ok', 'no_digits', 'over_limit']);
/** 商品行拒收因。源是「找不到社团就直接 return」一条静默跳过。 */
export const DJ_ROW_WHYS = Object.freeze(['ok', 'no_title', 'no_price', 'over_limit']);
/** 上限键（余量读数用；取不出来画横线，不画 0）。 */
export const DJ_GAUGE_KEYS = Object.freeze(['shelf', 'ledger', 'cart', 'titles']);
/** ★ 售出状态只有**一个**真源词：DJ_STATUSES 里的 sold_out（照抄源的四档期表）。
 *  本件第一版在统计侧写的是另一个词 —— 而词表里根本没有那个键，
 *  于是「标已售出」点下去界面变了、统计里却仍算作「在售」。
 *  两套词各说各话时不报错、不崩溃，只错结果，故这里收成一条判据。 */
export const DJ_SOLD_KEYS = Object.freeze(['sold_out']);
export function isSold(status) {
    return DJ_SOLD_KEYS.indexOf(cleanText(status)) >= 0;
}

/* ---------- 上限与常量 ---------- */
export const DJ_TITLE_MAX = 60;
/** 商品件数上限（店头面余量条用）。 */
export const DJ_SHELF_MAX = 40;
/** 存档份数上限（台账面「存档 N 份 / 上限」用）。
 *  ★ 与 DJ_SHELF_MAX 分开：源把「商品件数」与「存档份数」两件事挤在一个数上，
 *    本件分成两个常量 —— 同一个常量担两种语义时，改一处会静默改另一处。 */
export const DJ_SHELF_STORE_MAX = 40;
/** 一份存档的最大字数（源在存档时不设限，长文本会整份塞进存储）。 */
export const DJ_SHELF_TEXT_MAX = 40000;
export const DJ_LEDGER_MAX = 60;
export const DJ_CART_MAX = 30;
export const DJ_QTY_MAX = 99;
export const DJ_PRICE_MAX = 9999999;
export const DJ_LISTING_MAX = 200;
/** 源 refreshMarket 的三个概率（逐条照抄）。 */
export const DJ_MARKET_RATES = Object.freeze({
    newListing: 0.55,     // 每件在售周边「有新卖家挂出」的概率
    newListingMax: 2,     // 一次最多挂几件
    sold: 0.12,           // 在售出品「被买走」的概率
    reprice: 0.3,         // 在售出品「重新定价」的概率
    repriceThreshold: 0.08 // 幅度超过这个比例才算「明显变动」
});

/* ========================================================
 *  一、字串与取数
 * ======================================================== */
/** 只认字符串；其余如实 ''（本仓最贵的形态是「不是字符串就当空」。 */
export function cleanText(v) {
    return (typeof v === 'string') ? v : '';
}
/** 字数：按码位算（不按 UTF-16 单元），避免表情与生僻字被算成两格。 */
export function charCount(s) {
    return Array.from(cleanText(s)).length;
}
/** 只认数字与非空数字串；其余如实 null（**「没给」不被读成 0**）。 */
export function numOrNull(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const t = v.split(' ').join('').split('　').join('');
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/* ========================================================
 *  二、价格解析（偏离 ①：三态，不许把「没数字」读成 0）
 * ======================================================== */
/** 从一串价格文本里取整数。
 *  ★ 源是「把非数字字符全剥掉 → parseInt → 再 || 0」：
 *    于是「¥1,200」「1200」「面议」三种输入里
 *    前两种得 1200、「面议」得 0，而 0 是被当成**合法价格**收下的。
 *  本件逐字符扫（不用正则），三态回报：
 *    · ok         —— 取到正整数；
 *    · no_digits  —— 一个数字都没有（「面议」「未定」「---」）；
 *    · over_limit —— 取到了但超上限（防手打一串零）。
 *  @returns {{ok:boolean, why:string, value:number|null, digits:string}}
 */
export function priceOf(v) {
    /* ★ 数字型也必须认：动作口收下时把「¥800」解成 800 再落库，
     *   投影面随后要按**同一条口径**再核一遍。这里若只认字符串，
     *   收下来的行会在投影面被全部判成「读不出价」——
     *   表现是「收下了却一件都没进店头」，不报错、不崩溃、只错结果。 */
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return { ok: false, why: DJ_PRICE_WHYS[1], value: null, digits: '' };
        if (v < 0) return { ok: false, why: DJ_PRICE_WHYS[1], value: null, digits: '' };
        if (v > DJ_PRICE_MAX) return { ok: false, why: DJ_PRICE_WHYS[2], value: null, digits: String(v) };
        return { ok: true, why: DJ_PRICE_WHYS[0], value: v, digits: String(v) };
    }
    const s = cleanText(v);
    let digits = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.slice(i, i + 1);
        if (c >= '0' && c <= '9') digits += c;
    }
    if (!digits) return { ok: false, why: DJ_PRICE_WHYS[1], value: null, digits: '' };
    const n = Number(digits);
    if (!Number.isFinite(n)) return { ok: false, why: DJ_PRICE_WHYS[1], value: null, digits };
    if (n > DJ_PRICE_MAX) return { ok: false, why: DJ_PRICE_WHYS[2], value: null, digits };
    return { ok: true, why: DJ_PRICE_WHYS[0], value: n, digits };
}
/** 金额写法（千分位；本件自己拼，不依赖宿主 toLocaleString）。 */
export function moneyText(n) {
    const v = numOrNull(n);
    if (v === null) return '--';
    const neg = v < 0;
    let s = String(Math.abs(Math.round(v)));
    let out = '';
    let k = 0;
    for (let i = s.length - 1; i >= 0; i--) {
        out = s.slice(i, i + 1) + out;
        k += 1;
        if (k % 3 === 0 && i > 0) out = ',' + out;
    }
    return (neg ? '-' : '') + out;
}

/* ========================================================
 *  三、价格引擎（源四条规则逐条对齐，本件只加读数）
 * ======================================================== */
/** 源的 _roundPrice：万以上按千、千以上按百、其余按十 —— 逐条照抄。 */
export function roundPrice(n) {
    const v = Math.max(0, numOrNull(n) === null ? 0 : numOrNull(n));
    if (v >= 10000) return Math.round(v / 1000) * 1000;
    if (v >= 1000) return Math.round(v / 100) * 100;
    return Math.round(v / 10) * 10;
}
/** 稀有度倍率。认英文 key，也认源的中文键（sourceKey）。
 *  两样都不认 ⇒ 1.0（与源同：源那张倍率表查不到就是 1.0）。 */
export function rarityMult(key) {
    const k = cleanText(key);
    for (let i = 0; i < DJ_RARITIES.length; i++) {
        const r = DJ_RARITIES[i];
        if (r.key === k || r.sourceKey === k) return r.mult;
    }
    return 1.0;
}
/** 角色热度系数（源 _characterHeat，0.7–4.0）。
 *  ★ 源从三处取料：在售周边归属数 / 剧情节点文本命中数（按位置加权）/
 *    情报条目命中数；权重 1.0 / 0.6 / 0.3，最后 0.7 + raw*0.3 再夹进
 *    [0.7, 4.0]。本件**逐条对齐**，并把三个分量一并回报 —— 源只返回一个数，
 *    于是「为什么这件被炒到 4 倍」在界面上不可对。
 *  @param {{goodsOwn:number, plotHits:Array<{index:number}>, plotCount:number, infoHits:number}} input
 */
export function characterHeat(input) {
    const src = input || {};
    const goodsOwn = numOrNull(src.goodsOwn) === null ? 0 : Math.max(0, numOrNull(src.goodsOwn));
    const plotCount = numOrNull(src.plotCount) === null ? 0 : Math.max(0, numOrNull(src.plotCount));
    const infoHits = numOrNull(src.infoHits) === null ? 0 : Math.max(0, numOrNull(src.infoHits));
    const hits = Array.isArray(src.plotHits) ? src.plotHits : [];
    let plotScore = 0;
    for (let i = 0; i < hits.length; i++) {
        const idx = numOrNull(hits[i] && hits[i].index);
        const pos = (idx === null) ? 0 : Math.max(0, idx);
        plotScore += 1 + (plotCount ? pos / plotCount : 0);
    }
    const raw = goodsOwn * 1.0 + plotScore * 0.6 + infoHits * 0.3;
    const before = 0.7 + raw * 0.3;
    const heat = Math.max(0.7, Math.min(4.0, before));
    let clamped = '';
    if (before > 4.0) clamped = 'high';
    else if (before < 0.7) clamped = 'low';
    return {
        heat, raw, plotScore, goodsOwn, infoHits, plotCount,
        clamped,
        /** 热度档（界面用）：源没有这一层，本件把「被夹住了」标出来。 */
        band: heat >= 3.0 ? 'hot' : (heat <= 1.0 ? 'cold' : 'normal')
    };
}
/** 单款二手均价（源 _avgPriceFor 逐条对齐）。
 *  ★ 偏离 ④：盲盒按**单款角色热度**、普通周边取 charNames **最高**热度 ——
 *    源两路都只返回一个数；本件把生效的那一路标出来（byVariant）。 */
export function avgPriceFor(input) {
    const src = input || {};
    const basePrice = numOrNull(src.price) === null ? 0 : Math.max(0, numOrNull(src.price));
    const mult = rarityMult(src.rarity);
    const byVariant = (src.blindBox === true) && !!cleanText(src.variantChar);
    let heatValue = 1.0;
    let heatDetail = null;
    if (byVariant) {
        heatDetail = characterHeat(src.variantHeat || {});
        heatValue = heatDetail.heat;
    } else {
        const list = Array.isArray(src.charHeats) ? src.charHeats : [];
        if (list.length) {
            let best = 1.0;
            let bestDetail = null;
            for (let i = 0; i < list.length; i++) {
                const d = characterHeat(list[i]);
                if (d.heat > best) { best = d.heat; bestDetail = d; }
            }
            heatValue = best;
            heatDetail = bestDetail;
        }
    }
    return {
        avg: roundPrice(basePrice * mult * heatValue),
        basePrice, mult, heat: heatValue, byVariant,
        rarityKey: cleanText(src.rarity),
        heatDetail
    };
}
/** 出品个体价（源 _listingPrice 逐条对齐）。
 *  ★ roll 由调用方给（源用 Math.random）—— 本件把随机数**提到参数位**，
 *    这样「同一个 roll 必得同一个价」是可判的（判定套件要用）。 */
export function listingPrice(avgPrice, sellerType, roll) {
    const avg = numOrNull(avgPrice) === null ? 0 : Math.max(0, numOrNull(avgPrice));
    const r = numOrNull(roll) === null ? 0 : Math.max(0, Math.min(0.9999, numOrNull(roll)));
    const type = cleanText(sellerType) || 'normal';
    let f;
    if (type === 'scalper') f = 2.0 + r * 3.0;
    else if (type === 'counterfeit') f = 0.7 + r * 0.4;
    else f = (r < 0.15) ? (0.5 + r * 0.2) : (0.8 + r * 0.5);
    const urgent = (type === 'normal' && r < 0.15);
    return {
        price: roundPrice(avg * f),
        factor: f, sellerType: type, urgent,
        /** 相对均价的倍率读数（源没有：界面上一件贵不贵全靠位数看）。 */
        ratio: avg > 0 ? roundPrice(avg * f) / avg : 0
    };
}
/** 售罄比例（源 _genVariantListings 的四步逐条对齐）。 */
export function soldRatioOf(input) {
    const src = input || {};
    const afterIndex = numOrNull(src.afterIndex);
    const plotCount = numOrNull(src.plotCount) === null ? 0 : Math.max(0, numOrNull(src.plotCount));
    const heatNorm = numOrNull(src.heatNorm) === null ? 0 : Math.max(0, Math.min(1, numOrNull(src.heatNorm)));
    const rel = (afterIndex === null) ? -1 : afterIndex;
    const ageRatio = rel >= 0 ? Math.min(1, (plotCount - 1 - rel) / 6) : 0;
    const ratio = Math.min(0.6, ageRatio * (0.3 + heatNorm * 0.4));
    return {
        ratio, ageRatio, heatNorm, afterIndex: rel,
        /** 「这件周边有没有绑剧情节点」—— 源没绑时直接当 0 龄，不留痕。 */
        hasAnchor: rel >= 0
    };
}
/** 一型周边的出品规划（源 _genVariantListings 的基数 / 加成 / 概率逐条对齐）。 */
export function variantPlan(input) {
    const src = input || {};
    const goods = src.goods || {};
    const title = cleanText(goods.title) || '无题';
    const isBlind = goods.blindBox === true;
    const variantChar = cleanText(src.variantChar);
    const rMult = rarityMult(goods.rarity);
    const rarityBonus = (rMult === 4.0) ? 3 : (rMult === 2.5 ? 2 : 0);
    const heat = numOrNull(src.heat) === null ? 1.0 : numOrNull(src.heat);
    const heatBonus = Math.round((heat - 1) * 2);
    const baseRoll = numOrNull(src.baseRoll) === null ? 0 : numOrNull(src.baseRoll);
    const base = isBlind
        ? 1 + Math.floor(baseRoll * 3)
        : 3 + Math.floor(baseRoll * 3);
    const count = Math.max(1, base + rarityBonus + heatBonus);
    const heatNorm = Math.min(1, (heat - 0.7) / 3.3);
    const scalperP = 0.05 + rarityBonus * 0.08 + heatNorm * 0.15;
    const fakeP = 0.02 + rarityBonus * 0.04 + heatNorm * 0.06;
    /* まとめ売り：盲盒**冷门**角色偶尔被打包甩卖（源条件逐条对齐）。 */
    const bundleChance = (isBlind && !!variantChar && heat <= 1.0) ? 0.5 : 0;
    return {
        title, count, base, rarityBonus, heatBonus, heat,
        scalperP, fakeP, heatNorm, bundleChance,
        /** ★ 源这里没上报：概率是「几个人里出一个」的语义，
         *  本件把 1/p 也报出来（界面写「约每 20 件有 1 件赝品」比写 0.05 好懂）。 */
        scalperEvery: scalperP > 0 ? Math.round(1 / scalperP) : 0,
        fakeEvery: fakeP > 0 ? Math.round(1 / fakeP) : 0,
        capped: count > DJ_LISTING_MAX
    };
}
/** 一次市场价格波动的读数（源 refreshMarket 第三步 / 第四步逐条对齐）。 */
export function repriceOf(priceOld, priceNew, threshold) {
    const a = numOrNull(priceOld);
    const b = numOrNull(priceNew);
    const th = numOrNull(threshold) === null ? DJ_MARKET_RATES.repriceThreshold : numOrNull(threshold);
    if (a === null || b === null || a <= 0) {
        return { changed: false, why: 'unreadable', delta: 0, ratio: 0 };
    }
    const ratio = Math.abs(b - a) / a;
    const changed = ratio > th;
    return { changed, why: changed ? '' : 'below_threshold', delta: b - a, ratio };
}

/* ========================================================
 *  四、行合法性（偏离 ②：商品行不许静默跳过）
 * ======================================================== */
/** 逐行核一遍商品：标题 / 价格 / 状态 / 上限。
 *  ★ 源在 _generateProducts 里「找不到社团就把整条商品丢掉」，
 *    只在最后回一句「サークル名の一致に失敗し、商品を生成できませんでした」，
 *    既不说是哪一条、也不说丢了几条。本件把每一行**逐条**回报。
 *  @returns {{rows:Array, rejected:Array<{index:number, title:string, why:string}>, ok:number}}
 */
export function classifyProducts(list) {
    const arr = Array.isArray(list) ? list : [];
    const rows = [];
    const rejected = [];
    for (let i = 0; i < arr.length; i++) {
        const p = arr[i] || {};
        const title = cleanText(p.title);
        const why = [];
        if (!title) why.push(DJ_ROW_WHYS[1]);
        else if (charCount(title) > DJ_TITLE_MAX) why.push(DJ_ROW_WHYS[3]);
        const pr = priceOf(p.price);
        if (!pr.ok) why.push(pr.why === DJ_PRICE_WHYS[2] ? DJ_ROW_WHYS[3] : DJ_ROW_WHYS[2]);
        if (why.length) {
            rejected.push({ index: i, title: title || '(无题)', why: why.join('+') });
        } else {
            rows.push({
                /* ★ 行 id 按**行号**稳定派生：用户在界面上看到的是「第几行」，
                 *   收银台入车发的也是行号。两套标号若各说各话（一套行号、一套自造 id），
                 *   表现是「按序号点入车没反应」，不报错也不崩溃。
                 *   有外部 id 时优先用外部 id（那才是跨会话稳定的那一套）。 */
                index: i, id: cleanText(p.id) || ('row' + String(i)),
                title, price: pr.value,
                /* ★ priceText 要存**文本形态**：收银台那一格拿它重核价（cartTotal 走
                 *   priceOf 按字符串核）。若这里存的是「原样字段」（动作口收下时写的是
                 *   数字 800），收银台会把每一行都判成「读不出价」——
                 *   表现是「车里的合计永远是 0 且不可信」，不报错、不崩溃、只错结果。 */
                priceText: cleanText(p.price) || (typeof p.price === 'number' ? String(p.price) : ''),
                type: cleanText(p.type) || 'novel', status: cleanText(p.status) || 'on_sale',
                qty: numOrNull(p.qty) === null ? 1 : Math.max(1, Math.min(DJ_QTY_MAX, numOrNull(p.qty)))
            });
        }
    }
    return { rows, rejected, ok: rows.length };
}

/* ========================================================
 *  五、购物车与台账
 * ======================================================== */
/** 合计（源 purchase() 的 reduce 逐条对齐，但**逐行回报**）。
 *  ★ 源把每行「parseInt 结果再 || 0」加进合计 —— 一行读不出来就少算一笔，
 *    而用户看到的是「合计 ¥X」加一句「購入完了」。本件把读不出来的行
 *    连同它的序号一起报出来，并给出「合计是否可信」这个总读数。
 *  @returns {{ok:boolean, total:number, count:number, bad:Array<{index:number, title:string, why:string}>}}
 */
export function cartTotal(rows) {
    const arr = Array.isArray(rows) ? rows : [];
    let total = 0;
    let count = 0;
    const bad = [];
    for (let i = 0; i < arr.length; i++) {
        const r = arr[i] || {};
        const pr = priceOf(r.priceText);
        const qty = numOrNull(r.qty);
        if (!pr.ok) { bad.push({ index: i, title: cleanText(r.title) || '(无题)', why: pr.why }); continue; }
        if (qty === null || qty < 1) { bad.push({ index: i, title: cleanText(r.title) || '(无题)', why: 'no_qty' }); continue; }
        total += pr.value * Math.min(DJ_QTY_MAX, qty);
        count += 1;
    }
    return { ok: bad.length === 0, total, count, bad };
}
/** 台账裁边：源静默 shift，本件报「被挤掉几条」。
 *  @returns {{keep:Array, dropped:number, over:number}}
 */
export function ledgerTrim(list, max) {
    const arr = Array.isArray(list) ? list.slice() : [];
    const cap = numOrNull(max) === null ? DJ_LEDGER_MAX : Math.max(1, numOrNull(max));
    let dropped = 0;
    while (arr.length > cap) { arr.shift(); dropped += 1; }
    return { keep: arr, dropped, over: Math.max(0, arr.length + dropped - cap) };
}
/** 在售 / 售罄 / 赝品 / 黄牛 四读数（源界面没有这一格，全靠翻列表数）。 */
export function listingStats(list) {
    const arr = Array.isArray(list) ? list : [];
    let onSale = 0, sold = 0, fake = 0, scalper = 0, bundle = 0;
    for (let i = 0; i < arr.length; i++) {
        const l = arr[i] || {};
        if (isSold(l.status)) sold += 1; else onSale += 1;
        if (l.flaggedFake === true) fake += 1;
        if (cleanText(l.sellerType) === 'scalper') scalper += 1;
        const q = numOrNull(l.bundleQty);
        if (q !== null && q > 1) bundle += 1;
    }
    return { onSale, sold, fake, scalper, bundle, total: arr.length };
}

/* ========================================================
 *  六、上限余量（取不出来画横线，**不画 0**）
 * ======================================================== */
/** 上限余量四格。value 为 null 表示「取不出来」—— 与真的 0 不同形。 */
export function gaugesOf(input) {
    const src = input || {};
    const pick = (v) => (numOrNull(v) === null ? null : Math.max(0, numOrNull(v)));
    const shelf = pick(src.shelf);
    const cart = pick(src.cart);
    const kind = pick(src.ledger);
    const titles = pick(src.titles);
    return [
        { key: 'shelf', value: shelf, max: DJ_SHELF_MAX, label: '台账条数', over: shelf !== null && shelf > DJ_SHELF_MAX },
        { key: 'ledger', value: kind, max: DJ_LEDGER_MAX, label: '动作记录', over: kind !== null && kind > DJ_LEDGER_MAX },
        { key: 'cart', value: cart, max: DJ_CART_MAX, label: '收银台行数', over: cart !== null && cart > DJ_CART_MAX },
        { key: 'titles', value: titles, max: DJ_LISTING_MAX, label: '在售条数', over: titles !== null && titles > DJ_LISTING_MAX }
    ];
}
/** 一行读数的文本形（取不出来画「--」，**不画 0**）。 */
export function gaugeText(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '--';
    return String(cell.value) + ' / ' + String(cell.max);
}