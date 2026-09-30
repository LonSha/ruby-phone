/* ========================================================
 * shop-data.js — [v3.27.0] 商城 App 纯函数内核
 *
 * 缝合自 EPhone·xINOVO（`src_xinovo/js/modules/shop.js`，1068 行 / 38254 字符）。
 * 源里真正的结构是四层：**商品目录**（按分类分桶）→ **购物车**（`[{item, quantity}]`）
 * → **下单/自提口令** → **提取核销**。
 *
 * 【缝什么、不缝什么 —— 源里三处「本仓不能有」】
 *   ① **商品靠模型生成**：源的商品桶（recommend / guess / character_choice）是**空的**，
 *      装的是「等模型填」的位置 —— 由角色接口按分类 prompt 现生成商品、价格、文案。
 *      本仓的模型调用一律走宿主生成侧，App 不自己发请求。**故本件只做「目录 + 购物车 + 本地订单账」**：
 *      商品由用户登记（或从世界书/剧情里搬），本件不生成任何商品。
 *   ② **自提口令从聊天历史里正则抓**：源 `handlePickupConfirm` 遍历 `chat.history`，
 *      用 `\[.*?为.*?下单了：自提口令:\s*(.*?)\|.*?\|(.*?)\]` 从**正文**里抠口令与商品清单。
 *      本仓正文的归属在聊天层，App 读正文＝在别人的账本上写第二套账；而且这个正则一旦与
 *      正文格式漂移就静默判「没找到」——「不报错、只错结果」。**故口令改由本 App 自己签发**，
 *      商品清单取自本 App 自己的订单（不再猜正文）。
 *   ③ **落 Dexie**：源 `saveShopSettings` 直写 `dexieDB.characters.update(...)`。
 *      本仓零数据库铁律 —— 落 PhoneStorage（键前缀 `shop_`），本件保持纯函数。
 *
 * 【从源里取的三块真价值】
 *   · **分类是可扩展的、且分类带「它想卖什么」的说明**（源 `customCategories: [{id,name,prompt}]`）：
 *     分类不是死枚举，用户能加自己的（并且要**防 id 撞车**：源明确拦了 5 个默认 id）。
 *   · **购物车是「条目 + 数量」的二元组**（源 `cart: [{item, quantity}]`）：
 *     不是「一单一商品」，同一个东西可以加两份 —— 结算要按数量算。
 *   · **自提口令是一次下单的唯一凭据**（源 `isPickedUp` 标记 + 口令比对忽略大小写与空格）：
 *     口令要**忽略大小写和空格**才比对得上（源逐字写的 `toLowerCase()` 比较）。
 *
 * 【与源的偏离（逐条写明）】
 *   1. **钱的单位是「分」的整数**（与 piggy 同口径）。源用浮点数字直接算总价，
 *      `0.1 + 0.2` 类误差会让「购物车合计」与「订单合计」差一分。本件一律整数分进、整数分出。
 *   2. **数量与单价都有上限**（源无上限）：随会话存档走，无界会顶到 chatMetadata。
 *   3. **下单是「快照」而不是引用**：源订单里存的是对商品对象的引用（`{item, quantity}`），
 *      商品改名/改价后**历史订单会跟着变**（看起来是「我明明买的是 12 块」）。
 *      本件下单时把 name/price 拷进订单，商品后来怎么改都不动历史。
 *
 * 本文件只引 num-gate，无副作用、不碰 DOM、不碰 window、不碰网络、不读聊天历史。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（同 focus / piggy / punchcard 纪律）。 */
export const SHOP_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 源里那五个默认分类（`renderShopTabs` 的 tabs 与 `addCategory` 的 defaultIds 逐字同源）。 */
export const SHOP_PRESET_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'recommend', name: '推荐' }),
    Object.freeze({ id: 'food', name: '食堂' }),
    Object.freeze({ id: 'general', name: '百货' }),
    Object.freeze({ id: 'guess', name: '猜你喜欢' }),
    Object.freeze({ id: 'character_choice', name: 'Ta 想买' }),
]);

export const SHOP_LIMITS = Object.freeze({
    maxProducts: 200,
    maxCustomCategories: 20,
    maxQty: 99,
    maxPriceCents: 100000000,   // 100 万元
    maxNameLen: 40,
    maxNoteLen: 60,
    maxOrders: 100,
    maxInjectOrders: 5,
});

export const DEFAULT_SHOP_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectOrders: 5,
    /** 源 default 8（`getShopSettings` 的 `{customCategories: [], itemCount: 8}`）。 */
    pageSize: 8,
    maxOrders: 100,
});

export function defaultShopSettings() {
    return Object.freeze({ ...DEFAULT_SHOP_SETTINGS });
}

function boundedInt(v, fallback, min, max) {
    const n = numOrNull(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeShopSettings(raw) {
    const d = DEFAULT_SHOP_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectOrders: boundedInt(o.maxInjectOrders, d.maxInjectOrders, 0, 20),
        pageSize: boundedInt(o.pageSize, d.pageSize, 1, 50),
        maxOrders: boundedInt(o.maxOrders, d.maxOrders, 10, 500),
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
    if (n === null || n < 0) return '';
    const c = Math.round(n);
    return '\u00a5' + Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');
}

/** 一条商品。name 为空即无效。price 非法（负数 / 非数）按 0 计但**照实标 unPriced**。 */
export function normalizeProduct(raw, seq) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const name = String(o.name || '').trim().slice(0, SHOP_LIMITS.maxNameLen);
    if (!name) return null;
    const n = boundedInt(seq, 0, 0, 100000);
    const cents = numOrNull(o.priceCents);
    const priced = cents !== null && cents >= 0 && cents <= SHOP_LIMITS.maxPriceCents;
    /* [v3.27.0] 已存的 unPriced 标记必须**粘住**：数据层把「未定价」写成 priceCents: 0，
     *   而 0 是一个合法读数（numOrNull(0) === 0）—— 于是同一条商品在**一次存储往返**
     *   （读盘 -> normalizeProducts -> projectShop）之后会被重新判成「已定价 ¥0.00」，
     *   「未定价」标记静默消失：界面不再显示「未定价」、统计行也不再报件数。
     *   显式标了 unPriced 的条目一律按未定价处理（0 元与「没定价」是两码事）。 */
    const unPriced = o.unPriced === true || !priced;
    const cat = String(o.category || '').trim() || 'general';
    return {
        id: (typeof o.id === 'string' && o.id) ? o.id : ('sp_' + n + '_' + name.length),
        name,
        category: cat,
        priceCents: (priced && !unPriced) ? Math.round(cents) : 0,
        unPriced,
        note: String(o.note || '').trim().slice(0, SHOP_LIMITS.maxNoteLen),
    };
}

export function normalizeProducts(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    list.forEach((x, i) => {
        const p = normalizeProduct(x, i);
        if (p) out.push(p);
    });
    return out.slice(0, SHOP_LIMITS.maxProducts);
}

/**
 * 自定义分类规范化。**默认 id 一律拒收**（源 `addCategory` 明确拦 5 个默认 id）
 * —— 撞车会让「推荐」这个桶出现两条不同说明，界面上看不出来。
 */
export function normalizeCategories(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const presetIds = SHOP_PRESET_CATEGORIES.map((c) => c.id);
    const seen = new Set(presetIds);
    const out = [];
    let rejected = 0;
    for (const x of list) {
        const o = (x && typeof x === 'object') ? x : {};
        const id = String(o.id || '').trim();
        const name = String(o.name || '').trim().slice(0, SHOP_LIMITS.maxNameLen);
        if (!id || !name || seen.has(id)) { rejected += 1; continue; }
        seen.add(id);
        out.push({ id, name, note: String(o.note || o.prompt || '').trim().slice(0, SHOP_LIMITS.maxNoteLen) });
        if (out.length >= SHOP_LIMITS.maxCustomCategories) break;
    }
    return { categories: out, rejected };
}

/** 全部可选分类 = 5 个默认 + 自定义（同名不同 id 允许，id 唯一由上面保证）。 */
export function allCategories(custom) {
    const c = normalizeCategories(custom).categories;
    return SHOP_PRESET_CATEGORIES.map((x) => ({ ...x, preset: true }))
        .concat(c.map((x) => ({ ...x, preset: false })));
}

export function categoryLabel(custom, id) {
    const all = allCategories(custom);
    const hit = all.find((c) => c.id === String(id));
    return hit ? hit.name : String(id || '');
}

/* ---------- 购物车（源 `cart: [{item, quantity}]` 同义） ---------- */

function normCart(cart) {
    return (Array.isArray(cart) ? cart : [])
        .map((x) => {
            const o = (x && typeof x === 'object') ? x : {};
            const id = String(o.productId || '').trim();
            if (!id) return null;
            const q = boundedInt(o.qty, 0, 0, SHOP_LIMITS.maxQty);
            if (q <= 0) return null;
            return { productId: id, qty: q };
        })
        .filter(Boolean);
}

/** 加进购物车（同 id 累加，超上限**如实截到上限**并回报 clamped）。 */
export function addToCart(cart, productId, qty) {
    const id = String(productId || '').trim();
    if (!id) return { cart: normCart(cart), added: 0, clamped: false };
    const add = boundedInt(qty, 1, 1, SHOP_LIMITS.maxQty);
    const list = normCart(cart);
    const i = list.findIndex((x) => x.productId === id);
    let clamped = false;
    if (i >= 0) {
        const want = list[i].qty + add;
        const capped = Math.min(SHOP_LIMITS.maxQty, want);
        clamped = capped !== want;
        list[i] = { productId: id, qty: capped };
    } else {
        list.push({ productId: id, qty: Math.min(SHOP_LIMITS.maxQty, add) });
    }
    return { cart: list, added: add, clamped };
}

/** 直接设数量（0 = 移出）。 */
export function setQty(cart, productId, qty) {
    const id = String(productId || '').trim();
    const q = boundedInt(qty, 0, 0, SHOP_LIMITS.maxQty);
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

/** 购物车合计（分，整数）。商品已不在目录里的条目按 0 计并**单独计数**（不静默吞）。 */
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

/* ---------- 订单（自提口令由本 App 签发） ---------- */

/** 六位口令（大写字母 + 数字，去掉易混的 I/O/0/1）。 */
export function makePickupCode(rand) {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = (typeof rand === 'function') ? rand : Math.random;
    let out = '';
    for (let i = 0; i < 6; i += 1) {
        let v = r();
        if (!Number.isFinite(v)) v = 0;
        const idx = Math.min(ALPHABET.length - 1, Math.max(0, Math.floor(v * ALPHABET.length)));
        out += ALPHABET[idx];
    }
    return out;
}

/**
 * 下单：把购物车**快照**成订单（见文件头偏离第 3 条）。
 * 返回 `{ orders, order, error? }`。空车 / 有缺失商品 ⇒ 不下单并如实说明。
 */
export function checkout(orders, cart, products, now, rand) {
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
    const order = {
        id: 'so_' + nowMs + '_' + rows.length,
        code: makePickupCode(rand),
        createdAt: nowMs,
        rows,
        totalCents: total,
        status: 'pending',
        pickedAt: 0,
    };
    return { orders: [order, ...base].slice(0, SHOP_LIMITS.maxOrders), order, error: '' };
}

/** 核销（口令比对**忽略大小写与空格** —— 源的口令语义）。返回 `{orders, ok, orderId?}`。 */
export function pickup(orders, code, now) {
    const want = String(code || '').replace(/\s+/g, '').toUpperCase();
    const base = Array.isArray(orders) ? orders.slice() : [];
    if (!want) return { orders: base, ok: false, orderId: '', error: '请输入口令' };
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    let hit = -1;
    for (let i = 0; i < base.length; i += 1) {
        const o = base[i] || {};
        if (o.status === 'pending' && String(o.code || '').toUpperCase() === want) { hit = i; break; }
    }
    if (hit < 0) return { orders: base, ok: false, orderId: '', error: '没有对得上的待取订单' };
    base[hit] = { ...base[hit], status: 'picked', pickedAt: nowMs };
    return { orders: base, ok: true, orderId: base[hit].id, error: '' };
}

export function cancelOrder(orders, orderId) {
    const id = String(orderId || '');
    let changed = 0;
    const next = (Array.isArray(orders) ? orders : []).map((o) => {
        if (!o || o.id !== id || o.status !== 'pending') return o;
        changed += 1;
        return { ...o, status: 'canceled' };
    });
    return { orders: next, changed };
}

export function removeOrder(orders, orderId) {
    const id = String(orderId || '');
    const base = Array.isArray(orders) ? orders : [];
    const kept = base.filter((o) => !o || o.id !== id);
    return { orders: kept, removed: base.length - kept.length };
}

/* ---------- 投影 / 归因 / 注入 ---------- */

/** 归因：先判能不能读，再判读到了什么。**空目录**才算 empty（有车没货也算还没开张）。 */
export function readShopFace(probe) {
    if (!probe || probe.storageOk === false) return SHOP_REASONS.storage_absent;
    if (probe.hasProducts !== true) return SHOP_REASONS.empty;
    return SHOP_REASONS.ready;
}

/** 投影（读数）。读不到就如实给 0 / 空数组，**不编数**。 */
export function projectShop(products, customCategories, cart, orders) {
    const list = normalizeProducts(products);
    const cats = normalizeCategories(customCategories).categories;
    const ords = Array.isArray(orders) ? orders : [];
    const t = cartTotal(cart, list);
    const byCat = {};
    for (const p of list) {
        byCat[p.category] = (byCat[p.category] || 0) + 1;
    }
    return {
        productCount: list.length,
        unPricedCount: list.filter((p) => p.unPriced).length,
        categoryCount: allCategories(cats).length,
        customCategoryCount: cats.length,
        byCat,
        cartCents: t.cents,
        cartCount: t.count,
        cartRows: t.rows,
        cartMissing: t.missing,
        orderCount: ords.length,
        pendingOrders: ords.filter((o) => o && o.status === 'pending'),
        pickedCount: ords.filter((o) => o && o.status === 'picked').length,
        hasAny: list.length > 0 || ords.length > 0,
    };
}

/**
 * 生成侧注入块。只给**事实**（挂着几单待取、总额多少），不给角色台词、不生成商品。
 * 没有待取订单 ⇒ 返回**空串**（不产生空块，与 place / punchcard 同契约）。
 */
export function shopPromptBlock(proj, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj) return '';
    const pend = Array.isArray(proj.pendingOrders) ? proj.pendingOrders : [];
    const max = (typeof settings.maxInjectOrders === 'number') ? settings.maxInjectOrders : 5;
    if (max <= 0 || !pend.length) return '';
    const rows = pend.slice(0, max).map((o) => {
        const names = (Array.isArray(o.rows) ? o.rows : []).map((r) => r.name + '\u00d7' + r.qty).join('、');
        return '\u00b7 ' + formatCents(o.totalCents) + ' ' + names + '（口令 ' + String(o.code || '') + '）';
    });
    if (!rows.length) return '';
    return '【系统·商城】待取自提 ' + pend.length + ' 单\n' + rows.join('\n');
}