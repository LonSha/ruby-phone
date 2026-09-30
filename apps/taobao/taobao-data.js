/* ========================================================
 * taobao-data.js — [v3.29.0] 桃宝 App 纯函数内核
 *
 * 缝合自 EPhone·xintuk（`runtime/scripts/taobao/{001,002,003,004}.js`，
 * 打包载荷 154272 字节 / 132666 字符 / 88 个函数）。
 *
 * 路线图把本件写成「淘宝仿真（拼团 / 购物车 / 结算 / 地址）」，**实测不是**
 * （复算见 TODO.md）：全篇「拼团」0 次、「地址」0 次。源的真身是**四合一超级模块**
 * —— 抓娃娃机 + 桃宝购物 + 外卖（eleme）+ 物流。本件取其中**三块**（购物 / 物流 / 娃娃机）。
 *
 * 【缝什么 —— 源里三块真价值】
 *   · **物流时间线 9 步模板**（源 `logisticsTimelineTemplate`）：每一步 = 一句文案 + 一个
 *     **相对毫秒延迟**（2 秒 / 10 秒 / 5 分 / 20 分 / 2 时 / 8 时 / 20 时 / 24 时 / 28 时），
 *     由累计延迟算出「这一步应当发生的时刻」，再拿**现在**去比 —— 这是本件最值钱的东西，
 *     别的 App 都没有。文案里三个占位符 `{city}` / `{next_city}` / `{user_city}` 由下单时
 *     抽定的三个城市填（源从 9 个城市里不重复地抽三个）。
 *   · **四段订单状态机**：`已下单` → `已付款，等待发货` → `已发货，运输中` → `已签收`。
 *     关键是**状态由时间推演决定**，而不是由定时器改（见下「不缝②」）。
 *   · **娃娃机档位表**（源 `REWARD_TIERS`）：五档加权（零钱 40 / 红包 30 / 巨款 15 / 扣除 10 /
 *     神秘 5），权重抽取的写法逐字复刻（乘总权重再逐档减）。
 *
 * 【不缝什么 —— 源里五处「本仓不能有」】
 *   ① **商品与评价都不生成**：源商品桶装的是「等模型填」的位置（`handleGenerateProductsAI`、
 *      `handleAddFromLink`、`generateAndDrawImage`），`generateProductReviews` 还直连
 *      `/v1/chat/completions` 造买家秀。本仓模型调用一律走宿主生成侧，App 不自己发请求、
 *      也不替用户编商品与评价。**故本件商品由用户登记**（或从世界书 / 剧情里搬）。
 *   ② **不做实时物流定时器**：源给每一个「未来步骤」挂一个 `setTimeout`，还要在回调里回头查
 *      `document.getElementById('logistics-screen').classList.contains('active')` 才算数
 *      —— 页面不在就永远补不上，回来时时间线缺格。本仓不转常驻定时器（同 block 那件的口径）：
 *      改**惰性补推** —— 每次取数时用 `now` 一次性算出「到此刻为止应当发生到第几步」，
 *      纯函数、可复算、与页面在不在无关。
 *   ③ **不写 Dexie**：源落 `db.taobaoCart` / `db.taobaoProducts` / `db.taobaoOrders` /
 *      `db.clawMachineDolls` / `db.globalSettings`。本仓零数据库铁律 —— 落 PhoneStorage，
 *      键前缀 `taobao_`，本件保持纯函数。
 *   ④ **不碰钱包**：源 `updateUserBalanceAndLogTransaction` 直改 `state.globalSettings.userBalance`，
 *      `updateCharacterPhoneBankBalance` 直改 `chat.characterPhoneData.bank`。本仓用户钱包的
 *      仲裁源是**微信零钱**（catbox / honey 都在那条线上扣）—— 本件若也去动它，同一笔钱就有了
 *      两个记账者，那是本仓最贵的「不报错、只错数据」。**故娃娃机抓到的战利品只登记面值，
 *      不入任何账**：要不要记进钱包由用户自己决定，界面文案也写明这一点。
 *   ⑤ **不内置外链素材**：源有 12 个外链（`i.postimg.cc` 娃娃图 6 张 + 外卖图 3 张 +
 *      `laddy-lulu.github.io` 的 message.mp3）。本仓新增模块零外部请求 —— 一条都不收。
 *
 * 【与源的偏离（逐条写明）】
 *   1. **钱的单位是「分」的整数**（与 piggy / shop 同口径）。源用浮点算总价。
 *   2. **时间倍率可调**（源固定 1×）：9 步累计 82.42 小时 ≈ 3.4 天。1× 下要开着一整天；
 *      本件给 `speedFactor`（1 / 60 / 600 / 3600），调到 3600× 时 82 秒就能看到签收。
 *      倍率只影响「时刻怎么算」，**不让已发生的步骤倒退**（只前进，见 `applyLogistics`）。
 *   3. **订单是快照不是引用**（同 shop）：源订单存 `productId` 引用，商品改名改价后历史跟着变。
 *   4. **状态只前进不后退**：倍率调小后重算的结果若排在当前状态之前，一律不采纳
 *      ——「货已经发了」是既成事实，改个读数参数不该把它收回去。
 *
 * 本文件只引 num-gate，无副作用、不碰 DOM、不碰 window、不碰网络、不读聊天历史。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（同 focus / piggy / punchcard 纪律）。 */
export const TAOBAO_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 两个面：逛街（目录 → 车 → 订单 → 物流）/ 娃娃机。源也是一体的（娃娃机从桃宝主界面进）。 */
export const TAOBAO_FACES = Object.freeze(['mall', 'claw']);

/**
 * 四段订单状态机。**值逐字取自源**（`已下单` 见 `handleCheckout` 的 `status: "已下单"`；
 * `已付款，等待发货` 见 `createOrdersFromCart` / `handleBuyProduct` 的 10 秒回调；
 * `已发货，运输中` 见订单列表渲染；`已签收` 见物流末步）。
 * 键是英文（进存储的键要稳，改文案不该动数据）。
 */
export const ORDER_STATUS = Object.freeze({
    placed: '已下单',
    paid: '已付款，等待发货',
    shipped: '已发货，运输中',
    received: '已签收',
});

/** 状态推进顺序（`applyLogistics` 的「只前进不后退」按这个表比大小）。 */
export const ORDER_STATUS_ORDER = Object.freeze(['placed', 'paid', 'shipped', 'received']);

const STATUS_RANK = Object.freeze({ placed: 0, paid: 1, shipped: 2, received: 3 });

/**
 * 物流时间线模板（源 `logisticsTimelineTemplate` 逐字）。
 * `delayMs` 是**相对上一档**的延迟（源就是 `cumulativeDelay += stepInfo.delay` 那样累加）。
 */
export const LOGISTICS_TEMPLATE = Object.freeze([
    Object.freeze({ text: '您的订单已提交', delayMs: 1000 * 2 }),
    Object.freeze({ text: '付款成功，等待商家打包', delayMs: 1000 * 10 }),
    Object.freeze({ text: '【{city}仓库】已打包，等待快递揽收', delayMs: 1000 * 60 * 5 }),
    Object.freeze({ text: '【{city}快递】已揽收', delayMs: 1000 * 60 * 20 }),
    Object.freeze({ text: '快件已到达【{city}分拨中心】', delayMs: 1000 * 60 * 60 * 2 }),
    Object.freeze({ text: '【{city}分拨中心】已发出，下一站【{next_city}】', delayMs: 1000 * 60 * 60 * 8 }),
    Object.freeze({ text: '快件已到达【{user_city}转运中心】', delayMs: 1000 * 60 * 60 * 20 }),
    Object.freeze({
        text: '快件正在派送中，派送员：兔兔快递员，电话：123-4567-8910，请保持电话畅通',
        delayMs: 1000 * 60 * 60 * 24,
    }),
    Object.freeze({
        text: '您的快件已签收，感谢您在桃宝购物，期待再次为您服务！',
        delayMs: 1000 * 60 * 60 * 28,
    }),
]);

/** 城市表（源 `renderLogisticsView` 里的 `cities` 9 城逐字）。 */
export const LOGISTICS_CITIES = Object.freeze([
    '东莞', '广州', '长沙', '武汉', '郑州', '北京', '上海', '成都', '西安',
]);

/** 物流里第几步起算「已发货」（第 4 步「已揽收」= 下标 3）。 */
const SHIPPED_AT_STEP = 4;
/** 物流里第几步起算「已付款」（第 2 步「付款成功」= 下标 1）。 */
const PAID_AT_STEP = 2;

/**
 * 娃娃机档位表（源 `REWARD_TIERS` 逐字，value 由元换成分）。
 * 源的 `value` 直接加到用户余额上；本件**只登记面值**（见文件头不缝④）。
 */
export const REWARD_TIERS = Object.freeze([
    Object.freeze({ type: 'coin_small', valueCents: 1000, label: '零钱', weight: 40 }),
    Object.freeze({ type: 'coin_mid', valueCents: 5000, label: '红包', weight: 30 }),
    Object.freeze({ type: 'coin_big', valueCents: 10000, label: '巨款', weight: 15 }),
    Object.freeze({ type: 'bad_luck', valueCents: -2000, label: '扣除', weight: 10 }),
    Object.freeze({ type: 'mystery', valueCents: 0, label: '神秘', weight: 5 }),
]);

export const TAOBAO_LIMITS = Object.freeze({
    maxProducts: 200,
    maxQty: 99,
    maxPriceCents: 100000000,   // 100 万元
    maxNameLen: 40,
    maxNoteLen: 60,
    maxOrders: 100,
    maxGrabs: 50,
    maxInjectOrders: 3,
    maxSpeedFactor: 86400,
});

export const DEFAULT_TAOBAO_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectOrders: 3,
    /** 1× = 源的时间尺度（全流程 82.42 小时）；想看签收就往上调。 */
    speedFactor: 60,
    maxGrabs: 50,
});

export function defaultTaobaoSettings() {
    return Object.freeze({ ...DEFAULT_TAOBAO_SETTINGS });
}

function boundedInt(v, fallback, min, max) {
    const n = numOrNull(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeTaobaoSettings(raw) {
    const d = DEFAULT_TAOBAO_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectOrders: boundedInt(o.maxInjectOrders, d.maxInjectOrders, 0, 20),
        /* 倍率夹到 [1, maxSpeedFactor]；非数回落默认（不是 1 —— 默认是 60）。 */
        speedFactor: boundedInt(o.speedFactor, d.speedFactor, 1, TAOBAO_LIMITS.maxSpeedFactor),
        maxGrabs: boundedInt(o.maxGrabs, d.maxGrabs, 5, 200),
    });
}

/** 金额：元 → 分（整数）。非法输入返回 null（不猜 0）。 */
export function yuanToCents(v) {
    const n = numOrNull(v);
    if (n === null || n < 0) return null;
    return Math.round(n * 100);
}

/** 金额：分 → 显示串 `¥12.30`。非整数分返回 `''`（不糊一个 0 出来）。 */
export function formatCents(cents) {
    const n = numOrNull(cents);
    if (n === null) return '';
    const c = Math.round(n);
    const neg = c < 0;
    const a = Math.abs(c);
    return (neg ? '-' : '') + '\u00a5' + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
}

/* ---------- 商品目录（与 shop 同形，但两件各持一本账） ---------- */

/** 一条商品。name 为空即无效。价格非法按 0 计但**照实标 unPriced**（源 price 可空）。 */
export function normalizeProduct(raw, seq) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const name = String(o.name || '').trim().slice(0, TAOBAO_LIMITS.maxNameLen);
    if (!name) return null;
    const n = boundedInt(seq, 0, 0, 100000);
    const cents = numOrNull(o.priceCents);
    const priced = cents !== null && cents >= 0 && cents <= TAOBAO_LIMITS.maxPriceCents;
    /* 已存的 unPriced 标记必须**粘住**（同 shop 记过的形态）：数据层把「未定价」写成
     *   priceCents: 0，而 0 是合法读数 —— 一次存储往返后会被重新判成「已定价 ¥0.00」，
     *   标记静默消失。显式标了 unPriced 的一律按未定价处理。 */
    const unPriced = o.unPriced === true || !priced;
    return {
        id: (typeof o.id === 'string' && o.id) ? o.id : ('tp_' + n + '_' + name.length),
        name,
        priceCents: (priced && !unPriced) ? Math.round(cents) : 0,
        unPriced,
        note: String(o.note || '').trim().slice(0, TAOBAO_LIMITS.maxNoteLen),
    };
}

export function normalizeProducts(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    list.forEach((x, i) => {
        const p = normalizeProduct(x, i);
        if (p) out.push(p);
    });
    return out.slice(0, TAOBAO_LIMITS.maxProducts);
}

/* ---------- 购物车（源 `db.taobaoCart` 的 `{productId, quantity}` 同义） ---------- */

function normCart(cart) {
    return (Array.isArray(cart) ? cart : [])
        .map((x) => {
            const o = (x && typeof x === 'object') ? x : {};
            const id = String(o.productId || '').trim();
            if (!id) return null;
            const q = boundedInt(o.qty, 0, 0, TAOBAO_LIMITS.maxQty);
            if (q <= 0) return null;
            return { productId: id, qty: q };
        })
        .filter(Boolean);
}

export function addToCart(cart, productId, qty) {
    const id = String(productId || '').trim();
    if (!id) return { cart: normCart(cart), added: 0, clamped: false };
    const add = boundedInt(qty, 1, 1, TAOBAO_LIMITS.maxQty);
    const list = normCart(cart);
    const i = list.findIndex((x) => x.productId === id);
    let clamped = false;
    if (i >= 0) {
        const want = list[i].qty + add;
        const capped = Math.min(TAOBAO_LIMITS.maxQty, want);
        clamped = capped !== want;
        list[i] = { productId: id, qty: capped };
    } else {
        list.push({ productId: id, qty: Math.min(TAOBAO_LIMITS.maxQty, add) });
    }
    return { cart: list, added: add, clamped };
}

export function setQty(cart, productId, qty) {
    const id = String(productId || '').trim();
    const q = boundedInt(qty, 0, 0, TAOBAO_LIMITS.maxQty);
    const list = normCart(cart).filter((x) => x.productId !== id);
    if (q > 0) list.push({ productId: id, qty: q });
    return { cart: list };
}

export function removeFromCart(cart, productId) {
    return { cart: normCart(cart).filter((x) => x.productId !== String(productId || '')) };
}

export function clearCart() {
    return { cart: [] };
}

/** 车合计（分，整数）。已不在目录里的条目按 0 计并**单独计数**（不静默吞）。 */
export function cartTotal(cart, products) {
    const list = normCart(cart);
    const byId = new Map(normalizeProducts(products).map((p) => [p.id, p]));
    let cents = 0;
    let count = 0;
    let missing = 0;
    for (const row of list) {
        const p = byId.get(row.productId);
        count += row.qty;
        if (!p) { missing += 1; continue; }
        cents += p.priceCents * row.qty;
    }
    return { cents, count, missing, rows: list.length };
}

/* ---------- 下单（物流三元组在此定，之后不变） ---------- */

/**
 * 三个城市：发货地 / 中转地 / 收货地，**互不相同**（源 `cities.filter(c => c !== startCity)`
 * 的两级筛选逐字同义）。抽不满时如实回落「您的城市」（源也是这个兜底）。
 */
export function pickCities(rand) {
    const r = (typeof rand === 'function') ? rand : Math.random;
    const pick = (pool) => {
        if (!pool.length) return '';
        let v = r();
        if (!Number.isFinite(v)) v = 0;
        const i = Math.min(pool.length - 1, Math.max(0, Math.floor(v * pool.length)));
        return pool[i];
    };
    const all = LOGISTICS_CITIES.slice();
    const shipFrom = pick(all) || '您的城市';
    const rest1 = all.filter((c) => c !== shipFrom);
    const transitCity = rest1.length ? pick(rest1) : '';
    const rest2 = rest1.filter((c) => c !== transitCity);
    const userCity = (rest2.length ? pick(rest2) : '') || '您的城市';
    return { shipFrom, transitCity, userCity };
}

/**
 * 下单：把购物车**快照**成订单（见文件头偏离③），并把物流三元组钉进订单。
 * 返回 `{ orders, order, error? }`。空车 / 有缺失商品 ⇒ 不下单并如实说明。
 */
export function placeOrder(orders, cart, products, cities, now) {
    const base = Array.isArray(orders) ? orders.slice() : [];
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const byId = new Map(normalizeProducts(products).map((p) => [p.id, p]));
    const list = normCart(cart);
    if (!list.length) return { orders: base, order: null, error: '购物车是空的' };
    const rows = [];
    let total = 0;
    for (const row of list) {
        const p = byId.get(row.productId);
        if (!p) return { orders: base, order: null, error: '车里有商品已不在目录里，先清掉它' };
        rows.push({ productId: p.id, name: p.name, priceCents: p.priceCents, qty: row.qty });
        total += p.priceCents * row.qty;
    }
    const c = (cities && typeof cities === 'object') ? cities : {};
    const order = {
        id: 'to_' + nowMs + '_' + base.length,
        rows,
        totalCents: total,
        createdAt: nowMs,
        shipFrom: String(c.shipFrom || '您的城市'),
        transitCity: String(c.transitCity || ''),
        userCity: String(c.userCity || '您的城市'),
        status: 'placed',
        receivedAt: 0,
    };
    return { orders: [order, ...base].slice(0, TAOBAO_LIMITS.maxOrders), order, error: '' };
}

/* ---------- 物流推演（本件的核心） ---------- */

function fillTemplate(text, order) {
    return String(text)
        .replace(/\{city\}/g, order.shipFrom)
        .replace('{next_city}', order.transitCity)
        .replace('{user_city}', order.userCity);
}

/**
 * 到此刻为止，这一单走到了第几步。纯函数：只吃 `(order, now, speedFactor)`，不读时钟、
 * 不转定时器（见文件头不缝②）。
 *
 * 返回：
 *   `steps`       全 9 步，每步带 `text`（占位符已填）/ `at`（绝对毫秒）/ `done`
 *   `doneCount`   已经到点的步数（时间递增 ⇒ 必然是前缀）
 *   `shownCount`  视图该显示几步 —— `max(1, doneCount)`。源在「一步都没到点」时
 *                 手动补显第一条（`if (timelineContainer.children.length === 0)`），同义。
 *   `statusKey`   由 doneCount 推出的四段状态
 *   `next`        下一步（没有则 null）
 *   `remainingMs` 距下一步还有多久（没有下一步则 0）
 *   `progress`    9 步的完成比（0–1，给进度条用）
 */
export function logisticsSteps(order, now, speedFactor) {
    const o = (order && typeof order === 'object') ? order : {};
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const created = numOrNull(o.createdAt);
    const start = created === null ? nowMs : Math.round(created);
    const sf0 = numOrNull(speedFactor);
    const sf = (sf0 === null || sf0 <= 0) ? 1 : Math.min(TAOBAO_LIMITS.maxSpeedFactor, sf0);

    let acc = 0;
    const steps = LOGISTICS_TEMPLATE.map((tpl, i) => {
        acc += tpl.delayMs;
        const at = start + Math.round(acc / sf);
        return { index: i, text: fillTemplate(tpl.text, o), at, done: nowMs >= at };
    });
    let doneCount = 0;
    for (const s of steps) { if (s.done) doneCount += 1; else break; }

    const nextStep = steps[doneCount] || null;
    const remainingMs = nextStep ? Math.max(0, nextStep.at - nowMs) : 0;
    return {
        steps,
        doneCount,
        shownCount: Math.max(1, doneCount),
        statusKey: statusKeyOfDoneCount(doneCount),
        next: nextStep,
        remainingMs,
        progress: doneCount / steps.length,
    };
}

/** 步数 → 四段状态。四段是源的原文案，本件只是把「第几步」映射上去。 */
export function statusKeyOfDoneCount(doneCount) {
    const n = boundedInt(doneCount, 0, 0, LOGISTICS_TEMPLATE.length);
    if (n >= LOGISTICS_TEMPLATE.length) return 'received';
    if (n >= SHIPPED_AT_STEP) return 'shipped';
    if (n >= PAID_AT_STEP) return 'paid';
    return 'placed';
}

export function statusTextOf(key) {
    const k = String(key || '');
    return ORDER_STATUS[k] || ORDER_STATUS.placed;
}

export function statusRankOf(key) {
    const r = STATUS_RANK[String(key || '')];
    return (typeof r === 'number') ? r : 0;
}

/**
 * 惰性补推：把每张订单的 status 推到「此刻应有的那一段」。
 * **只前进不后退** —— 倍率调小后重算若排在当前之前，一律不采纳（货已发出是既成事实）。
 * 返回 `{ orders, changed, justReceived }`（`justReceived` 是本次刚跨到「已签收」的笔数）。
 */
export function applyLogistics(orders, now, speedFactor) {
    const base = Array.isArray(orders) ? orders.slice() : [];
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    let changed = 0;
    let justReceived = 0;
    const next = base.map((o) => {
        if (!o || typeof o !== 'object') return o;
        const key = statusKeyOfDoneCount(logisticsSteps(o, nowMs, speedFactor).doneCount);
        if (statusRankOf(key) <= statusRankOf(o.status)) return o;
        changed += 1;
        if (key === 'received') justReceived += 1;
        return { ...o, status: key, receivedAt: (key === 'received') ? nowMs : (numOrNull(o.receivedAt) || 0) };
    });
    return { orders: next, changed, justReceived };
}

/* ---------- 娃娃机 ---------- */

/** 加权抽一档（源 `getRandomRewardTier` 的写法逐字：乘总权重再逐档减）。 */
export function rollTier(rand) {
    const r = (typeof rand === 'function') ? rand : Math.random;
    const total = REWARD_TIERS.reduce((sum, it) => sum + it.weight, 0);
    let v = r();
    if (!Number.isFinite(v)) v = 0;
    let randomNum = Math.abs(v) * total;
    for (const tier of REWARD_TIERS) {
        if (randomNum < tier.weight) return tier;
        randomNum -= tier.weight;
    }
    return REWARD_TIERS[0];
}

/**
 * 记一次抓取。战利品**只登记面值**，不入任何账（见文件头不缝④）。
 * 返回 `{ grabs, entry, capped }`（capped = 因到上限而丢掉最旧的那条）。
 */
export function recordGrab(grabs, tier, doll, now, maxGrabs) {
    const base = Array.isArray(grabs) ? grabs.slice() : [];
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const tt = (tier && typeof tier === 'object') ? tier : REWARD_TIERS[0];
    const cap = boundedInt(maxGrabs, 50, 5, 200);
    const entry = {
        id: 'tg_' + nowMs + '_' + base.length,
        type: String(tt.type || ''),
        label: String(tt.label || ''),
        valueCents: numOrNull(tt.valueCents) || 0,
        doll: String(doll || '').trim().slice(0, TAOBAO_LIMITS.maxNameLen),
        at: nowMs,
    };
    const all = [entry, ...base];
    const capped = all.length > cap;
    return { grabs: all.slice(0, cap), entry, capped };
}

/* ---------- 投影 / 归因 / 注入 ---------- */

export function readTaobaoFace(probe) {
    if (!probe || probe.storageOk === false) return TAOBAO_REASONS.storage_absent;
    if (probe.hasAny !== true) return TAOBAO_REASONS.empty;
    return TAOBAO_REASONS.ready;
}

/**
 * 投影（读数）。读不到就如实给 0 / 空数组，**不编数**。
 * `nextEvent` 是「九单里最快会发生的那一步」（给界面挂个「下一站」提示）。
 */
export function projectTaobao(products, cart, orders, grabs, now, settings) {
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const s = normalizeTaobaoSettings(settings);
    const list = normalizeProducts(products);
    const ords = (Array.isArray(orders) ? orders : []).filter((o) => o && typeof o === 'object');
    const gs = Array.isArray(grabs) ? grabs : [];
    const ct = cartTotal(cart, list);

    const statusCounts = { placed: 0, paid: 0, shipped: 0, received: 0 };
    let inTransit = 0;
    let pending = 0;
    let nextEvent = null;
    for (const o of ords) {
        const key = o.status || 'placed';
        if (Object.prototype.hasOwnProperty.call(statusCounts, key)) statusCounts[key] += 1;
        if (key !== 'received') pending += 1;
        if (key === 'shipped') inTransit += 1;
        if (key === 'received') continue;
        const st = logisticsSteps(o, nowMs, s.speedFactor);
        if (st.next && (!nextEvent || st.next.at < nextEvent.at)) {
            nextEvent = { orderId: o.id, text: st.next.text, at: st.next.at, remainingMs: st.remainingMs };
        }
    }
    let grabNetCents = 0;
    for (const g of gs) grabNetCents += (numOrNull(g && g.valueCents) || 0);
    return {
        productCount: list.length,
        unPricedCount: list.filter((p) => p.unPriced).length,
        cartCents: ct.cents,
        cartCount: ct.count,
        cartRows: ct.rows,
        cartMissing: ct.missing,
        orderCount: ords.length,
        statusCounts,
        pendingCount: pending,
        inTransitCount: inTransit,
        nextEvent,
        grabCount: gs.length,
        grabNetCents,
        hasAny: list.length > 0 || ords.length > 0 || gs.length > 0,
    };
}

/**
 * 生成侧注入块。只给**事实**（有几单在路上、最近那单走到哪一步），
 * 不给角色台词、不生成商品、不替用户决定买不买。
 * 没有在途订单 ⇒ 返回**空串**（不产生空块，与 place / shop / punchcard 同契约）。
 */
export function taobaoPromptBlock(proj, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj) return '';
    const max = (typeof settings.maxInjectOrders === 'number') ? settings.maxInjectOrders : 3;
    if (max <= 0) return '';
    const rows = [];
    if (proj.nextEvent) {
        rows.push('\u00b7 最快的一步：' + proj.nextEvent.text);
    }
    if (proj.inTransitCount > 0) {
        rows.push('\u00b7 在途 ' + proj.inTransitCount + ' 单');
    }
    if (proj.statusCounts && proj.statusCounts.placed > 0) {
        rows.push('\u00b7 待付款 ' + proj.statusCounts.placed + ' 单');
    }
    if (proj.statusCounts && proj.statusCounts.paid > 0) {
        rows.push('\u00b7 待发货 ' + proj.statusCounts.paid + ' 单');
    }
    if (!rows.length) return '';
    /* ★ 头行与正文之间必须有换行（本轮判据抓到的自犯缺陷：漏了 `\n` 会让头行与第一条粘连成
     *   「【系统·桃宝】· 最快的一步：…」，而本仓其余十一个 App 的头行全是 `'【系统·X】\n'`）。 */
    return '【系统·桃宝】\n' + rows.slice(0, max).join('\n');
}
