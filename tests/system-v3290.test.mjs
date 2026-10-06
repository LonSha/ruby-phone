// tests/system-v3290.test.mjs — 桃宝（购物 / 订单 / **物流时间线推演** / 娃娃机）[v3.29.0]
//
//   本版接的是素材缝合路线图 **第 2 层第一批第一件**：
//     桃宝 —— 源 EPhone·xintuk `runtime/scripts/taobao/{001,002,003,004}.js`
//     （打包载荷 154272 字节 / 132666 字符 / 88 个函数）。
//
//   ★ 起手复算推翻了路线图的写法（复算见 TODO.md / 每次起手必须重新量）：
//     路线图把本件写成「淘宝仿真（**拼团** / 购物车 / 结算 / **地址**）」，
//     实测全篇「拼团」0 次、「地址」0 次。源的真身是**四合一超级模块**
//     —— 抓娃娃机 + 桃宝购物 + 外卖（eleme）+ 物流。本件取其中**三块**。
//
//   缝合**不是搬运**。本件有一份「源有本仓不能有」的清单，本套件守的就是「它们没被搬进来」：
//     · 源**商品与评价都靠模型生成**（`handleGenerateProductsAI` / `handleAddFromLink` /
//       `generateProductReviews` 直连 `/v1/chat/completions`）——本仓模型调用走宿主生成侧，
//       App 不自己发请求、也不替用户编商品与评价。故本件商品**由用户登记**。F5 守这条。
//     · 源**物流是实时定时器**（每个未来步骤挂 `setTimeout`，回调里还要回头查
//       `document.getElementById('logistics-screen').classList.contains('active')` 才算数
//       —— 页面不在就永远补不上、回来时间线缺格）。本件一个定时器都不转，改**惰性补推**：
//       每次取数用 `now` 一次性算出「到此刻为止应当走到第几步」，纯函数、可复算。
//     · 源**落 Dexie**（`db.taobaoCart` / `taobaoProducts` / `taobaoOrders` / `clawMachineDolls`
//       / `globalSettings`）——本仓零数据库铁律，落 PhoneStorage、键走 `^taobao_`。
//     · 源**直改用户钱包与角色银行卡**（`updateUserBalanceAndLogTransaction` 改
//       `state.globalSettings.userBalance`；`updateCharacterPhoneBankBalance` 改
//       `chat.characterPhoneData.bank`）——本仓用户钱包的仲裁源是**微信零钱**，
//       本件若也去动它，同一笔钱就有两个记账者。故**娃娃机战利品只登记面值，不入任何账**。
//     · 源有 **12 条外链素材**（`i.postimg.cc` 娃娃图 6 张 + 外卖图 3 张 +
//       `laddy-lulu.github.io` 的 `message.mp3`）——本仓新增模块零外部请求，一条都不收。
//
//   四条**偏离**（偏离不是遗漏，逐条与文件头同源）：
//     ① 钱一律整数「分」（源用浮点算总价 ⇒ `0.1+0.2` 类误差会让两处合计差一分）；
//     ② 时间倍率可调（源固定 1×，全流程 82.42 小时）：1× 便是源尺度，3600× 约 82 秒见签收；
//     ③ 订单是**快照**不是引用（源存 `productId`，商品改名改价后历史跟着变）；
//     ④ 状态**只前进不后退**（倍率调小后重算若排在当前之前一律不采纳 —— 「货已经发了」是既成事实）。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 钱与商品：整数分不出浮点误差 / **未定价标记必须粘住**（存储往返后不许静默变「已定价 ¥0.00」）/
//       非法价如实标未定价而不拒收 / 上限截断不拒收 / 自动 id 不许撞；
//     B 购物车：同件加两次是**累加不是两行** / 加超上限夹住并如实报 / 数量 0 即摘 /
//       **失效条目单独计数不静默吞**（钱不计、数照计、读数要显形）；
//     C 订单与物流：**订单是快照**（改名改价后历史不动）/ 空车与缺失件都不下单且如实说明 /
//       物流 9 步**延迟逐档 + 累计时刻**、三占位符填空、三城市互不相同 / 状态四段边界 /
//       **惰性补推只前进不后退**、同段不重复计入；
//     D 娃娃机：**加权抽取逐档减的边界**（`r` 恰在档界上归下一档）/ 五档权重与面值逐字 /
//       记录前插 + 上限丢**最旧** / 战利品条目形状里**没有任何入账字段**；
//     E 投影与注入：归因先判可读 / 空投影不编数 / **最快的一步取全单最靠前的那个** /
//       注入只给事实、无在途则空串（不产生空块）；
//     F 接线：四处注册齐备（槽位名驼峰）/ **视图调用面必须闭合在 App 上**（v3250 记过的
//       「视图调了 App 上不存在的方法」静默断裂）/ 样式源与 phone.css 逐字同源且类名有落点 /
//       前缀全仓唯一 / 四件套齐备 + data 层纯函数 + 五块禁区一条都没进来；
//     G 键归属：五条新键在门禁账本里且 scope=chat；
//     H 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红（十一条）；
//     I 判据工具自证：剥注释器两向、替换必须保真、锚点必须在场；
//     V 版本锚（下限形）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/taobao/<file>.js` + `<tmp>/config/num-gate.js`），否则 `../../config/num-gate.js`
//   会解析到 `/config/num-gate.js`（差两级，首跑即 ERR_MODULE_NOT_FOUND）；
//   判据函数仍只吃**数据对象**，不吃模块内部实现。
//
//   取段纪律（v3.28.0 交棒）：本版接的样式段是**当前末段**，故取段取到文件尾 ——
//   但判据里必须先**自证「本段之后没有别的段头」**：下版往后接段时这条会**主动报红**，
//   提醒把取法改回「按下一个段头截断」（宁可当场红，不可静默假绿）。
//
//   批次纪律（本版特有）：第二批全部做完前**只跑单套件**（`node --test tests/system-v3290.test.mjs`），
//   不跑全链 `check-file.mjs` —— 避免中途的噪声红掩盖真实回归。故本版条目里
//   没有「全链收尾读数」，只有「验证边界（诚实登记）」，全链读数留到第二批成套后那一版补。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    TAOBAO_REASONS, TAOBAO_FACES, ORDER_STATUS, ORDER_STATUS_ORDER, LOGISTICS_TEMPLATE,
    LOGISTICS_CITIES, REWARD_TIERS, TAOBAO_LIMITS, DEFAULT_TAOBAO_SETTINGS,
    defaultTaobaoSettings, normalizeTaobaoSettings, yuanToCents, formatCents,
    normalizeProduct, normalizeProducts, addToCart, setQty, removeFromCart, clearCart, cartTotal,
    pickCities, placeOrder, logisticsSteps, statusKeyOfDoneCount, statusTextOf, statusRankOf,
    applyLogistics, rollTier, recordGrab, readTaobaoFace, projectTaobao, taobaoPromptBlock,
} from '../apps/taobao/taobao-data.js';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_REL = 'apps/taobao/taobao-data.js';
const APP_REL = 'apps/taobao/taobao-app.js';
const VIEW_REL = 'apps/taobao/taobao-view.js';
const CSS_REL = 'apps/taobao/taobao.css';
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
const YEN = '\u00a5';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** 物流 9 步累计（源 82.42 小时）。 */
const SPAN_MS = LOGISTICS_TEMPLATE.reduce((a, s) => a + s.delayMs, 0);

/** 剥注释（字符状态机，与 v3200 / v3201 / v3250 / v3260 / v3270 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`setTimeout`、`Dexie`、`userBalance`、
 *    `postimg`、`/v1/chat/completions`…）是**说明**不是**消费**。
 *    判据必须自己实现一遍：不许用被审对象自己的实现来审它自己。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

/** 一条最简订单（判据夹具）。 */
const mkOrder = (over) => ({
    id: 'o1', rows: [], totalCents: 0, createdAt: 1000000,
    shipFrom: '\u4e1c\u839e', transitCity: '\u6b66\u6c49', userCity: '\u6210\u90fd',
    status: 'placed', receivedAt: 0, ...(over || {}),
});
const mkCities = () => ({ shipFrom: '\u4e1c\u839e', transitCity: '\u6b66\u6c49', userCity: '\u6210\u90fd' });

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A1 钱一律整数分 + 未定价标记粘住 + 非法价如实标而不拒收 ── */
function moneyProblems(api) {
    const bad = [];
    const L = api.TAOBAO_LIMITS;
    /* 元 → 分：四舍五入到整数分（源用浮点，本件收成整数）。 */
    if (api.yuanToCents(12.3) !== 1230) bad.push('yuan-12.3:' + api.yuanToCents(12.3));
    if (api.yuanToCents('0.05') !== 5) bad.push('yuan-str:' + api.yuanToCents('0.05'));
    if (api.yuanToCents(0) !== 0) bad.push('yuan-zero');
    if (api.yuanToCents(-1) !== null) bad.push('yuan-neg');
    for (const v of ['', null, undefined, 'x', NaN, Infinity]) {
        if (api.yuanToCents(v) !== null) bad.push('yuan-none:' + String(v));
    }
    /* 分 → 显示串：两位小数、负值带号、非法给空串（不糊一个 ¥0.00 出来）。 */
    if (api.formatCents(1230) !== YEN + '12.30') bad.push('fmt-1230:' + api.formatCents(1230));
    if (api.formatCents(0) !== YEN + '0.00') bad.push('fmt-0:' + api.formatCents(0));
    if (api.formatCents(5) !== YEN + '0.05') bad.push('fmt-5:' + api.formatCents(5));
    if (api.formatCents(-2000) !== '-' + YEN + '20.00') bad.push('fmt-neg:' + api.formatCents(-2000));
    for (const v of [null, 'x', NaN]) {
        if (api.formatCents(v) !== '') bad.push('fmt-none:' + String(v));
    }
    /* ★ 整数分：0.1 元 × 3 件必须**恰好** 30 分（浮点会给出 30.000000000000004）。 */
    const p1 = api.normalizeProduct({ name: 'x', priceCents: api.yuanToCents(0.1) }, 0);
    if (p1.priceCents !== 10) bad.push('fp-price:' + p1.priceCents);
    const t1 = api.cartTotal([{ productId: p1.id, qty: 3 }], [p1]);
    if (t1.cents !== 30) bad.push('fp-total:' + t1.cents);
    /* ★ 未定价：数据层把「未定价」写成 priceCents: 0，而 0 是**合法读数**（标价 0 元）——
     *   一次存储往返后标记会静默消失。显式标了 unPriced 的必须粘住。 */
    const u1 = api.normalizeProduct({ name: 'a', priceCents: 0, unPriced: true }, 1);
    if (u1.unPriced !== true || u1.priceCents !== 0) bad.push('unpriced-stick');
    const u1b = api.normalizeProduct({ name: 'a', priceCents: u1.priceCents, unPriced: u1.unPriced }, 1);
    if (u1b.unPriced !== true) bad.push('unpriced-roundtrip');
    /* 没给价 / 给了非法价 ⇒ 未定价，但**不拒收**（源里商品价格本来就可能空着）。 */
    const u2 = api.normalizeProduct({ name: 'b' }, 2);
    if (!u2 || u2.unPriced !== true) bad.push('unpriced-missing');
    const u3 = api.normalizeProduct({ name: 'c', priceCents: -5 }, 3);
    if (!u3 || u3.unPriced !== true) bad.push('unpriced-neg');
    const u4 = api.normalizeProduct({ name: 'd', priceCents: L.maxPriceCents + 1 }, 4);
    if (!u4 || u4.unPriced !== true) bad.push('unpriced-over:' + (u4 && u4.unPriced));
    /* 0 是合法价（合法且有价 ⇒ 不是未定价）——「未定价」的权威是标记，不是数值。 */
    const z = api.normalizeProduct({ name: 'e', priceCents: 0 }, 5);
    if (z.unPriced !== false || z.priceCents !== 0) bad.push('zero-price-legal:' + JSON.stringify(z));
    /* 上限常量：本件的钱不许出现浮点口径。 */
    if (L.maxPriceCents !== 100000000) bad.push('max-price:' + L.maxPriceCents);
    if (L.maxQty !== 99) bad.push('max-qty:' + L.maxQty);
    return bad;
}

/* ── A2 商品规范化：坏输入如实拒 / 截断不拒收 / 自动 id 不许撞 ── */
function productProblems(api) {
    const bad = [];
    const L = api.TAOBAO_LIMITS;
    /* 名字空 ⇒ null（如实拒，不是造一条名字为空的商品）。 */
    if (api.normalizeProduct({ name: '   ' }, 0) !== null) bad.push('blank-name-null');
    if (api.normalizeProduct(null, 0) !== null) bad.push('null-null');
    if (api.normalizeProduct({ name: '' }, 0) !== null) bad.push('empty-name-null');
    /* ★ 截断不拒收：超长名字/备注按上限截，商品照样进目录。 */
    const long = api.normalizeProduct({ name: 'x'.repeat(200), note: 'y'.repeat(200) }, 7);
    if (!long) bad.push('long-null');
    else {
        if (long.name.length !== L.maxNameLen) bad.push('trunc-name:' + long.name.length);
        if (long.note.length !== L.maxNoteLen) bad.push('trunc-note:' + long.note.length);
    }
    /* ★ 上限截断不拒收：超出目录上限的**如实截断**（不是抛、不是静默丢一半形状）。 */
    const many = [];
    for (let i = 0; i < L.maxProducts + 5; i += 1) many.push({ name: 'p' + i });
    const list = api.normalizeProducts(many);
    if (list.length !== L.maxProducts) bad.push('cap:' + list.length);
    /* 自动 id 不许撞（按序 + 名字长度拼的 id 也要唯一）。 */
    const ids = new Set(list.map((x) => x.id));
    if (ids.size !== list.length) bad.push('id-unique:' + ids.size + '/' + list.length);
    /* 保留显式 id；非数组 → 空表。 */
    const kept = api.normalizeProduct({ id: 'mine', name: 'k' }, 0);
    if (kept.id !== 'mine') bad.push('keep-id:' + kept.id);
    if (api.normalizeProducts(null).length !== 0) bad.push('nonarray');
    if (api.normalizeProducts([null, { name: 'ok' }, 'x']).length !== 1) bad.push('skip-bad');
    return bad;
}

/* ── B1 购物车：同件累加、夹上限、数量 0 即摘 ── */
function cartProblems(api) {
    const bad = [];
    const L = api.TAOBAO_LIMITS;
    /* 同件加两次是**累加**，不是两行。 */
    let r = api.addToCart([], 'pa', 1);
    if (r.added !== 1 || r.cart.length !== 1 || r.cart[0].qty !== 1) bad.push('add1:' + JSON.stringify(r));
    r = api.addToCart(r.cart, 'pa', 2);
    if (r.cart.length !== 1 || r.cart[0].qty !== 3) bad.push('merge:' + JSON.stringify(r.cart));
    /* 到上限正好不报 clamped；再加一次才报 —— 别把「刚好装满」错报成「夹住了」。 */
    const atMax = api.addToCart([], 'pa', L.maxQty);
    if (atMax.clamped !== false || atMax.cart[0].qty !== L.maxQty) bad.push('at-max:' + JSON.stringify(atMax));
    const over = api.addToCart(atMax.cart, 'pa', 1);
    if (over.clamped !== true || over.cart[0].qty !== L.maxQty) bad.push('over-max:' + JSON.stringify(over.cart));
    /* 数量 0 / 负数 / 非数 ⇒ 摘掉（不是留一行 0）。 */
    for (const q of [0, -3, 'x', null]) {
        if (api.setQty(r.cart, 'pa', q).cart.length !== 0) bad.push('setqty-zero:' + String(q));
    }
    const five = api.setQty(r.cart, 'pa', 5);
    if (five.cart.length !== 1 || five.cart[0].qty !== 5) bad.push('setqty5');
    /* 空 productId 不加；摘不存在的原样。 */
    if (api.addToCart([], '', 1).added !== 0 || api.addToCart([], '   ', 1).cart.length !== 0) bad.push('blank-id');
    if (api.removeFromCart(r.cart, 'nope').cart.length !== 1) bad.push('remove-missing');
    if (api.removeFromCart(r.cart, 'pa').cart.length !== 0) bad.push('remove-hit');
    if (api.clearCart().cart.length !== 0) bad.push('clear');
    /* 坏条目（缺 id / 数量非法）在归一化时被清掉，不留下 0 数量的鬼行。 */
    const dirty = [{ productId: 'pa', qty: 0 }, { qty: 2 }, { productId: '', qty: 1 }, null];
    if (api.setQty(dirty, 'pb', 1).cart.length !== 1) bad.push('dirty:' + JSON.stringify(api.setQty(dirty, 'pb', 1).cart));
    return bad;
}

/* ── B2 合计：失效条目单独计数不静默吞 ── */
function cartTotalProblems(api) {
    const bad = [];
    const products = api.normalizeProducts([
        { id: 'pa', name: 'a', priceCents: 1000 },
        { id: 'pb', name: 'b', priceCents: 250 },
    ]);
    const t = api.cartTotal([{ productId: 'pa', qty: 2 }, { productId: 'pb', qty: 4 }], products);
    if (t.cents !== 3000) bad.push('total:' + t.cents);
    if (t.count !== 6) bad.push('count:' + t.count);
    if (t.rows !== 2 || t.missing !== 0) bad.push('shape:' + JSON.stringify(t));
    /* ★ 失效条目：**钱不计、数照计、读数显形** —— 静默剔除会让用户看着车里的东西自己消失。 */
    const d = api.cartTotal([{ productId: 'pa', qty: 1 }, { productId: 'ghost', qty: 3 }], products);
    if (d.missing !== 1) bad.push('missing:' + d.missing);
    if (d.cents !== 1000) bad.push('missing-money:' + d.cents);
    if (d.count !== 4) bad.push('missing-count:' + d.count);
    if (d.rows !== 2) bad.push('missing-rows:' + d.rows);
    /* 未定价商品在车里按 0 元计但**不算失效**。 */
    const up = api.normalizeProducts([{ id: 'pu', name: 'u' }]);
    const t2 = api.cartTotal([{ productId: 'pu', qty: 2 }], up);
    if (t2.cents !== 0 || t2.count !== 2 || t2.missing !== 0) bad.push('unpriced-cart:' + JSON.stringify(t2));
    /* 空车 / 非数组 ⇒ 全 0。 */
    const e = api.cartTotal([], products);
    if (e.cents !== 0 || e.count !== 0 || e.rows !== 0 || e.missing !== 0) bad.push('empty:' + JSON.stringify(e));
    return bad;
}

/* ── C1 订单是快照；空车与缺失件都不下单 ── */
function orderProblems(api) {
    const bad = [];
    const L = api.TAOBAO_LIMITS;
    const products = api.normalizeProducts([
        { id: 'pa', name: '\u676f\u5b50', priceCents: 3000 },
        { id: 'pb', name: '\u52fa', priceCents: 500 },
    ]);
    const r = api.placeOrder([], [{ productId: 'pa', qty: 2 }, { productId: 'pb', qty: 1 }], products, mkCities(), 1000000);
    if (!r.order) { bad.push('order-null'); return bad; }
    const o = r.order;
    if (o.totalCents !== 6500) bad.push('total:' + o.totalCents);
    if (o.status !== 'placed') bad.push('status:' + o.status);
    if (o.createdAt !== 1000000) bad.push('created:' + o.createdAt);
    if (o.receivedAt !== 0) bad.push('received-at:' + o.receivedAt);
    if (o.shipFrom !== '\u4e1c\u839e' || o.transitCity !== '\u6b66\u6c49' || o.userCity !== '\u6210\u90fd') bad.push('cities');
    if (o.rows.length !== 2 || o.rows[0].name !== '\u676f\u5b50' || o.rows[0].qty !== 2) bad.push('rows:' + JSON.stringify(o.rows));
    /* ★ 快照：目录里的名字与价格改了，已下的订单**一个字都不动**（源存引用，历史跟着变）。 */
    api.normalizeProducts([{ id: 'pa', name: '\u9a6c\u514b\u676f', priceCents: 9999 }]);
    if (o.rows[0].name !== '\u676f\u5b50' || o.rows[0].priceCents !== 3000) bad.push('snapshot:' + JSON.stringify(o.rows[0]));
    /* 空车 / 缺失件 ⇒ 不下单，且**如实说明**（不静默跳过那一行照下单）。 */
    const e = api.placeOrder([], [], products, mkCities(), 1000000);
    if (e.order !== null || !e.error) bad.push('empty-cart:' + JSON.stringify(e));
    const m = api.placeOrder([], [{ productId: 'ghost', qty: 1 }], products, mkCities(), 1000000);
    if (m.order !== null || !m.error) bad.push('missing-cart:' + JSON.stringify(m));
    /* 订单**前插**（最新在上，源同）。 */
    const r2 = api.placeOrder(r.orders, [{ productId: 'pb', qty: 1 }], products, mkCities(), 2000000);
    if (r2.orders.length !== 2 || r2.orders[0].id !== r2.order.id) bad.push('prepend');
    /* 订单数上限：如实截断（丢最旧）。 */
    let many = r.orders;
    for (let i = 0; i < L.maxOrders + 3; i += 1) {
        const x = api.placeOrder(many, [{ productId: 'pb', qty: 1 }], products, mkCities(), 3000000 + i);
        if (!x.order) { bad.push('cap-order-null:' + i); break; }
        many = x.orders;
    }
    if (many.length !== L.maxOrders) bad.push('order-cap:' + many.length);
    /* 城市三元组缺席 ⇒ 如实回落（不写 undefined 进订单）。 */
    const n = api.placeOrder([], [{ productId: 'pb', qty: 1 }], products, null, 1000000);
    if (!n.order || n.order.shipFrom !== '\u60a8\u7684\u57ce\u5e02' || n.order.userCity !== '\u60a8\u7684\u57ce\u5e02') {
        bad.push('city-fallback:' + JSON.stringify(n.order && [n.order.shipFrom, n.order.userCity]));
    }
    return bad;
}

/* ── C2 物流模板：延迟逐档、累计时刻、占位符填空、三城市互不相同 ── */
function logisticsTemplateProblems(api) {
    const bad = [];
    const tpl = api.LOGISTICS_TEMPLATE;
    if (tpl.length !== 9) bad.push('len:' + tpl.length);
    /* ★ 逐档延迟（源 `logisticsTimelineTemplate` 逐字）：2s / 10s / 5min / 20min / 2h / 8h / 20h / 24h / 28h。 */
    const want = [2000, 10000, 5 * MIN, 20 * MIN, 2 * HOUR, 8 * HOUR, 20 * HOUR, 24 * HOUR, 28 * HOUR];
    tpl.forEach((s, i) => { if (s.delayMs !== want[i]) bad.push('delay' + i + ':' + s.delayMs); });
    /* 累计 ≈ 82.42 小时（源时间尺度，偏离②以它作 1× 基准）。 */
    if (Math.abs((SPAN_MS / HOUR) - 82.42) > 0.01) bad.push('span:' + (SPAN_MS / HOUR));
    /* 三个占位符各只在它该在的那几步里。 */
    if (!tpl[2].text.includes('{city}')) bad.push('ph-city');
    if (!tpl[5].text.includes('{next_city}')) bad.push('ph-next');
    if (!tpl[6].text.includes('{user_city}')) bad.push('ph-user');
    /* 占位符总数 = 6：第 3/4/5 步各一个 `{city}`、第 6 步两个（`{city}` + `{next_city}`）、
     *   第 7 步一个 `{user_city}` —— 逐个数清楚，别用「感觉是 4 个」。 */
    const phCount = tpl.map((s) => (s.text.match(/\{[a-z_]+\}/g) || []).length).reduce((a, b) => a + b, 0);
    if (phCount !== 6) bad.push('ph-count:' + phCount);
    /* 城市表 9 城逐字。 */
    if (api.LOGISTICS_CITIES.length !== 9) bad.push('city-len:' + api.LOGISTICS_CITIES.length);
    if (api.LOGISTICS_CITIES[0] !== '\u4e1c\u839e' || api.LOGISTICS_CITIES[8] !== '\u897f\u5b89') bad.push('city-face:' + api.LOGISTICS_CITIES.join());
    /* ★ 抽三城**互不相同**（源 `cities.filter(c => c !== startCity)` 的两级筛选同义）。 */
    const c = api.pickCities(() => 0);
    if (c.shipFrom !== '\u4e1c\u839e' || c.transitCity !== '\u5e7f\u5dde' || c.userCity !== '\u957f\u6c99') {
        bad.push('pick-cities:' + JSON.stringify(c));
    }
    if (c.shipFrom === c.transitCity || c.shipFrom === c.userCity || c.transitCity === c.userCity) {
        bad.push('cities-distinct:' + JSON.stringify(c));
    }
    /* 靠后的随机数也**不许**撞出重复城市（源的两级筛选是它成立的唯一原因）。 */
    for (const v of [0.5, 0.99, 0.999]) {
        const x = api.pickCities(() => v);
        if (x.shipFrom === x.transitCity || x.shipFrom === x.userCity || x.transitCity === x.userCity) {
            bad.push('cities-distinct-' + v + ':' + JSON.stringify(x));
        }
    }
    /* 非函数随机源 ⇒ 走 Math.random，仍必须是三城不重复。 */
    const d = api.pickCities('x');
    if (d.shipFrom === d.transitCity || d.transitCity === d.userCity) bad.push('cities-badrand:' + JSON.stringify(d));
    return bad;
}

/* ── C3 物流推演：累计时刻、done 是前缀、倍率只改时刻 ── */
function logisticsStepProblems(api) {
    const bad = [];
    const o = mkOrder();
    const T0 = o.createdAt;
    const s0 = api.logisticsSteps(o, T0, 1);
    /* 刚下单：一步都没到点，但视图**至少显示第一步**（源手动补显第一条，同义）。 */
    if (s0.doneCount !== 0) bad.push('fresh-done:' + s0.doneCount);
    if (s0.shownCount !== 1) bad.push('fresh-shown:' + s0.shownCount);
    if (s0.statusKey !== 'placed') bad.push('fresh-status:' + s0.statusKey);
    /* ★ `next` 是**步骤对象**（index / text / at / done），「还要多久」在返回值的顶层
     *   `remainingMs` —— 别把两处口径混成一个（本轮判据自己拄错形状的坑）。 */
    if (!s0.next || s0.next.index !== 0) bad.push('fresh-next:' + JSON.stringify(s0.next));
    if (s0.remainingMs !== 2000) bad.push('fresh-remaining:' + s0.remainingMs);
    if (s0.progress !== 0) bad.push('fresh-progress:' + s0.progress);
    if (s0.steps[0].text !== '\u60a8\u7684\u8ba2\u5355\u5df2\u63d0\u4ea4') bad.push('t0:' + s0.steps[0].text);
    /* ★ 占位符填空（三个城市各就各位）。 */
    if (!s0.steps[2].text.includes('\u4e1c\u839e\u4ed3\u5e93')) bad.push('fill-city:' + s0.steps[2].text);
    if (!s0.steps[5].text.includes('\u4e0b\u4e00\u7ad9\u3010\u6b66\u6c49\u3011')) bad.push('fill-next:' + s0.steps[5].text);
    if (!s0.steps[6].text.includes('\u6210\u90fd\u8f6c\u8fd0\u4e2d\u5fc3')) bad.push('fill-user:' + s0.steps[6].text);
    if (s0.steps.map((x) => x.text).join().includes('{')) bad.push('ph-left:' + s0.steps.map((x) => x.text).join('|'));
    /* ★ 时刻是**累计**（源 `cumulativeDelay += step.delay`），不是各自相对当下。 */
    if (s0.steps[0].at !== T0 + 2000) bad.push('at0:' + s0.steps[0].at);
    if (s0.steps[1].at !== T0 + 12000) bad.push('at1:' + s0.steps[1].at);
    if (s0.steps[8].at !== T0 + SPAN_MS) bad.push('at8:' + s0.steps[8].at);
    /* done 是**前缀**（时间递增 ⇒ 不可能中间断一格后面又到点）。 */
    const mid = api.logisticsSteps(o, T0 + 12000, 1);
    if (mid.doneCount !== 2) bad.push('mid-done:' + mid.doneCount);
    if (mid.steps.map((x) => x.done).join() !== 'true,true,false,false,false,false,false,false,false') {
        bad.push('prefix:' + mid.steps.map((x) => x.done).join());
    }
    if (mid.shownCount !== 2) bad.push('mid-shown:' + mid.shownCount);
    if (Math.abs(mid.progress - (2 / 9)) > 1e-9) bad.push('mid-progress:' + mid.progress);
    /* 走完：9 步、无下一步、进度 1。 */
    const last = api.logisticsSteps(o, T0 + SPAN_MS, 1);
    if (last.doneCount !== 9 || last.statusKey !== 'received' || last.next !== null) bad.push('last:' + JSON.stringify([last.doneCount, last.statusKey, last.next]));
    if (Math.abs(last.progress - 1) > 1e-9) bad.push('last-progress:' + last.progress);
    if (last.remainingMs !== 0) bad.push('last-remaining:' + last.remainingMs);
    /* ★ 倍率只改「时刻怎么算」：3600× 下 82.42 秒走完全程（1× 要 82.42 小时）。 */
    const fastEnd = T0 + Math.round(SPAN_MS / 3600);
    if (api.logisticsSteps(o, fastEnd, 3600).doneCount !== 9) bad.push('fast-last:' + api.logisticsSteps(o, fastEnd, 3600).doneCount);
    if (api.logisticsSteps(o, fastEnd - 1, 3600).doneCount >= 9) bad.push('fast-boundary');
    /* 同一时刻的两种倍率差着「整整一段时间线」：3600× 已经走完（82420ms），
     *   而 1× 下 82420ms 只走完前两步（step0 要 2s、step1 要 12s，到 step2 得等 312s）。 */
    if (api.logisticsSteps(o, fastEnd, 1).doneCount !== 2) bad.push('slow-early:' + api.logisticsSteps(o, fastEnd, 1).doneCount);
    /* 倍率非法（0 / 负 / 非数）⇒ 按 1× 处理，不炸、不变成「立刻签收」。 */
    for (const sf of [0, -5, 'x', null]) {
        const s = api.logisticsSteps(o, T0 + 2000, sf);
        if (s.doneCount !== 1) bad.push('sf-bad-' + String(sf) + ':' + s.doneCount);
    }
    /* 倍率**夹到上限**：给一个远超上限的倍率，行为必须与给上限本身逐字相同
     *   （不许靠「倍率大到无穷」把 9 步在 0 秒里挤完）。 */
    const huge = api.logisticsSteps(o, T0 + 1, api.TAOBAO_LIMITS.maxSpeedFactor * 1000);
    const capped = api.logisticsSteps(o, T0 + 1, api.TAOBAO_LIMITS.maxSpeedFactor);
    if (huge.doneCount !== capped.doneCount) bad.push('sf-huge:' + huge.doneCount + '/' + capped.doneCount);
    /* 坏订单（null / 缺 createdAt）不炸：以 now 起算。 */
    const nn = api.logisticsSteps(null, T0, 1);
    if (nn.steps.length !== 9 || nn.doneCount !== 0) bad.push('null-order:' + nn.doneCount);
    return bad;
}

/* ── C4 四段状态机：步数映射边界 + 文案回退 ── */
function statusProblems(api) {
    const bad = [];
    if (api.ORDER_STATUS_ORDER.join() !== 'placed,paid,shipped,received') bad.push('order:' + api.ORDER_STATUS_ORDER.join());
    const S = api.ORDER_STATUS;
    if (S.placed !== '\u5df2\u4e0b\u5355') bad.push('s0:' + S.placed);
    if (S.paid !== '\u5df2\u4ed8\u6b3e\uff0c\u7b49\u5f85\u53d1\u8d27') bad.push('s1:' + S.paid);
    if (S.shipped !== '\u5df2\u53d1\u8d27\uff0c\u8fd0\u8f93\u4e2d') bad.push('s2:' + S.shipped);
    if (S.received !== '\u5df2\u7b7e\u6536') bad.push('s3:' + S.received);
    /* ★ 边界：0/1 → placed；2/3 → paid；4..8 → shipped；9 → received。 */
    const cases = [[0, 'placed'], [1, 'placed'], [2, 'paid'], [3, 'paid'], [4, 'shipped'], [5, 'shipped'], [8, 'shipped'], [9, 'received']];
    for (const [n, want] of cases) {
        const got = api.statusKeyOfDoneCount(n);
        if (got !== want) bad.push('map' + n + ':' + got);
    }
    /* 越界不炸：负数 → 起点；超 9 → 终点；非数 → 起点。 */
    if (api.statusKeyOfDoneCount(-5) !== 'placed') bad.push('neg:' + api.statusKeyOfDoneCount(-5));
    if (api.statusKeyOfDoneCount(999) !== 'received') bad.push('over:' + api.statusKeyOfDoneCount(999));
    if (api.statusKeyOfDoneCount('x') !== 'placed') bad.push('nan:' + api.statusKeyOfDoneCount('x'));
    /* 文案回退：未知键吐**起点文案**，不吐 undefined。 */
    if (api.statusTextOf('zzz') !== S.placed) bad.push('text-fallback:' + api.statusTextOf('zzz'));
    if (api.statusTextOf(null) !== S.placed) bad.push('text-null:' + api.statusTextOf(null));
    if (api.statusTextOf('received') !== S.received) bad.push('text-received');
    /* 排位：只前进不后退按它比大小。 */
    if (!(api.statusRankOf('placed') < api.statusRankOf('paid')
        && api.statusRankOf('paid') < api.statusRankOf('shipped')
        && api.statusRankOf('shipped') < api.statusRankOf('received'))) bad.push('rank-order');
    if (api.statusRankOf('zzz') !== 0) bad.push('rank-fallback:' + api.statusRankOf('zzz'));
    /* 对应关系：状态推进必须与物流步数同一口径（4 步起算「已发货」= 第 4 步「已揽收」）。 */
    if (api.statusKeyOfDoneCount(4) !== 'shipped') bad.push('ship-at-4');
    if (api.statusKeyOfDoneCount(2) !== 'paid') bad.push('paid-at-2');
    return bad;
}

/* ── C5 惰性补推：只前进不后退、同段不重复、receivedAt 记在跨到那一刻 ── */
function applyLogisticsProblems(api) {
    const bad = [];
    const base = mkOrder();
    const T0 = base.createdAt;
    /* 1× 尺度：到 12 秒 → 第 2 步到点 → 已付款。 */
    const a = api.applyLogistics([base], T0 + 12000, 1);
    if (a.orders[0].status !== 'paid') bad.push('paid:' + a.orders[0].status);
    if (a.changed !== 1) bad.push('changed:' + a.changed);
    if (a.justReceived !== 0) bad.push('jr:' + a.justReceived);
    /* 走完 → received，receivedAt 记**此刻**（不是 createdAt）。 */
    const full = api.applyLogistics([base], T0 + SPAN_MS, 1);
    if (full.orders[0].status !== 'received') bad.push('recv:' + full.orders[0].status);
    if (full.orders[0].receivedAt !== T0 + SPAN_MS) bad.push('recv-at:' + full.orders[0].receivedAt);
    if (full.justReceived !== 1) bad.push('jr1:' + full.justReceived);
    /* ★ 只前进不后退：已经是「已发货」的单，遇到一个「推演结果更早」的时刻（倍率调小 / 时点回退）
     *   一律**不采纳** —— 货已经发了是既成事实，改个读数参数不该把它收回去。 */
    const shipped = mkOrder({ status: 'shipped' });
    const back = api.applyLogistics([shipped], T0 + 3000, 1);
    if (back.orders[0].status !== 'shipped') bad.push('no-back:' + back.orders[0].status);
    if (back.changed !== 0) bad.push('no-back-changed:' + back.changed);
    /* 同段不重复计入 changed（幂等：连推两次第二次必须为 0）。 */
    const same = api.applyLogistics([mkOrder({ status: 'paid' })], T0 + 12000, 1);
    if (same.changed !== 0) bad.push('idempotent:' + same.changed);
    /* 已签收：不再改，receivedAt 保持。 */
    const recv = mkOrder({ status: 'received', receivedAt: 500000 });
    const r2 = api.applyLogistics([recv], T0 + SPAN_MS + 1000, 1);
    if (r2.changed !== 0 || r2.orders[0].receivedAt !== 500000) bad.push('recv-keep:' + r2.orders[0].receivedAt);
    /* ★ 倍率能**加快**：同一时刻用 3600× 推，状态必须比 1× 更靠后（否则倍率是个摆设）。 */
    const slow = api.applyLogistics([base], T0 + 60000, 1);
    const quick = api.applyLogistics([base], T0 + 60000, 3600);
    if (api.statusRankOf(quick.orders[0].status) <= api.statusRankOf(slow.orders[0].status)) {
        bad.push('speed-noop:' + slow.orders[0].status + '->' + quick.orders[0].status);
    }
    /* 坏元素原样留下（不炸、不编状态）。 */
    const weird = api.applyLogistics([null, base], T0 + 12000, 1);
    if (weird.orders[0] !== null) bad.push('null-keep');
    if (api.applyLogistics(null, 0, 1).orders.length !== 0) bad.push('nonarray');
    /* 非数 now ⇒ 取当下（不炸）。 */
    const t = api.applyLogistics([base], null, 1);
    if (typeof t.orders[0].status !== 'string') bad.push('now-fallback');
    return bad;
}

/* ── D1 娃娃机加权抽取：逐档减的边界 ── */
function clawProblems(api) {
    const bad = [];
    const tiers = api.REWARD_TIERS;
    if (tiers.length !== 5) bad.push('len:' + tiers.length);
    /* 五档逐字（源 `REWARD_TIERS`，value 由元换成分）。 */
    const want = [
        ['coin_small', 1000, '\u96f6\u94b1', 40],
        ['coin_mid', 5000, '\u7ea2\u5305', 30],
        ['coin_big', 10000, '\u5de8\u6b3e', 15],
        ['bad_luck', -2000, '\u6263\u9664', 10],
        ['mystery', 0, '\u795e\u79d8', 5],
    ];
    tiers.forEach((t, i) => {
        const w = want[i];
        if (t.type !== w[0] || t.valueCents !== w[1] || t.label !== w[2] || t.weight !== w[3]) {
            bad.push('tier' + i + ':' + JSON.stringify(t));
        }
    });
    if (tiers.reduce((s, t) => s + t.weight, 0) !== 100) bad.push('weight-sum');
    /* ★ 加权抽取的写法是「乘总权重再**逐档减**」——档界上的归属必须逐档核对：
     *   `r` 落在第 k 档的左闭右开区间 [cum_{k-1}, cum_k) 里。 */
    const probes = [
        [0, 'coin_small'], [0.3999, 'coin_small'],
        [0.40, 'coin_mid'], [0.6999, 'coin_mid'],
        [0.70, 'coin_big'], [0.8499, 'coin_big'],
        [0.85, 'bad_luck'], [0.9499, 'bad_luck'],
        [0.95, 'mystery'], [0.999999, 'mystery'],
    ];
    for (const [r, wantType] of probes) {
        const got = api.rollTier(() => r).type;
        if (got !== wantType) bad.push('roll' + r + ':' + got);
    }
    /* 非法随机数兜底 → 第一档（不炸、不返回 undefined）。 */
    if (api.rollTier(() => NaN).type !== 'coin_small') bad.push('nan');
    /* 非函数随机源 ⇒ 走 Math.random，返回值仍必须是表里的一员（同一对象）。 */
    if (!tiers.includes(api.rollTier('x'))) bad.push('nonfn');
    /* ★ 加权是真的：抽 2000 次，最低档必须真被抽到过、最高档不能被抽成「几乎全部」。 */
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const hist = { coin_small: 0, coin_mid: 0, coin_big: 0, bad_luck: 0, mystery: 0 };
    for (let i = 0; i < 2000; i += 1) hist[api.rollTier(rnd).type] += 1;
    if (hist.mystery === 0) bad.push('hist-mystery-zero');
    if (hist.coin_big === 0) bad.push('hist-big-zero');
    if (hist.coin_small < hist.coin_big) bad.push('hist-order:' + JSON.stringify(hist));
    const sum = Object.values(hist).reduce((a, b) => a + b, 0);
    if (sum !== 2000) bad.push('hist-sum:' + sum);
    return bad;
}

/* ── D2 抓取记录：前插、上限丢最旧、条目形状里没有入账字段 ── */
function grabProblems(api) {
    const bad = [];
    const T0 = api.REWARD_TIERS;
    const r = api.recordGrab([], T0[0], '\u5154', 1000, 5);
    if (r.grabs.length !== 1 || r.capped !== false) bad.push('one:' + JSON.stringify(r));
    /* ★ 战利品条目**只登记面值**：键面里不许出现任何「入账」口径的字段（余额 / 账本 / 扣款）。
     *   本仓用户钱包的仲裁源是微信零钱 —— 这里再记一笔就有两个记账者。 */
    const keys = Object.keys(r.entry).sort().join();
    if (keys !== 'at,doll,id,label,type,valueCents') bad.push('entry-shape:' + keys);
    if (r.entry.valueCents !== 1000 || r.entry.label !== '\u96f6\u94b1' || r.entry.at !== 1000) bad.push('entry:' + JSON.stringify(r.entry));
    /* 前插（最新在上）。 */
    const r2 = api.recordGrab(r.grabs, T0[1], '\u718a', 2000, 5);
    if (r2.grabs.length !== 2 || r2.grabs[0].at !== 2000 || r2.grabs[1].at !== 1000) bad.push('prepend:' + JSON.stringify(r2.grabs));
    /* ★ 上限：第 (cap+1) 次开始丢**最旧**的那条，并如实报 capped。 */
    let g = [];
    for (let i = 0; i < 6; i += 1) {
        const x = api.recordGrab(g, T0[0], '', 3000 + i, 5);
        if (i < 5 && x.capped) bad.push('early-cap:' + i);
        if (i === 5 && !x.capped) bad.push('late-cap-missing');
        g = x.grabs;
    }
    if (g.length !== 5) bad.push('cap-len:' + g.length);
    if (g[0].at !== 3005) bad.push('cap-newest:' + g[0].at);
    if (g[g.length - 1].at !== 3001) bad.push('cap-drop-oldest:' + g[g.length - 1].at);
    /* 上限**钳到 [5, 200]**：给个 1 也不许真的只留 1 条（下限是设计的一部分，
     *   不是「用户给多少就是多少」——一个 1 会让娃娃机只剩最后一下，界面看着像坏了）。 */
    let small = [];
    for (let i = 0; i < 6; i += 1) small = api.recordGrab(small, T0[0], '', 100 + i, 1).grabs;
    if (small.length !== 5) bad.push('cap-clamp:' + small.length);
    /* 给个 999 也不许超过 200。 */
    let big = [];
    for (let i = 0; i < 3; i += 1) big = api.recordGrab(big, T0[0], '', 200 + i, 999).grabs;
    if (big.length !== 3) bad.push('cap-clamp-hi:' + big.length);
    /* 坏档位 ⇒ 回落第一档（不炸、entry.type 不许是空串）。 */
    const w = api.recordGrab([], null, 'x', 5, 5);
    if (w.entry.type !== T0[0].type) bad.push('tier-fallback:' + w.entry.type);
    /* 非数时间 ⇒ 取当下。 */
    const t = api.recordGrab([], T0[0], '', null, 5);
    if (!(t.entry.at > 0)) bad.push('now-fallback');
    /* 玩具名超长按上限截断，不拒收。 */
    const long = api.recordGrab([], T0[0], '\u5a03'.repeat(200), 5, 5);
    if (long.entry.doll.length !== api.TAOBAO_LIMITS.maxNameLen) bad.push('doll-trunc:' + long.entry.doll.length);
    return bad;
}

/* ── E1 归因与投影：三态先判可读、空投影不编数、最快的一步取全单最早 ── */
function projectProblems(api) {
    const bad = [];
    const R = api.TAOBAO_REASONS;
    const settings = api.defaultTaobaoSettings();
    if (settings.injectToPrompt !== true) bad.push('default-inject');
    if (settings.speedFactor !== 60) bad.push('default-speed:' + settings.speedFactor);
    if (settings.maxInjectOrders !== 3) bad.push('default-max:' + settings.maxInjectOrders);
    if (api.TAOBAO_FACES.join() !== 'mall,claw') bad.push('faces:' + api.TAOBAO_FACES.join());
    /* 归因三态：**先判能不能读**（读不到就说读不到，不许说「空的」）。 */
    if (api.readTaobaoFace(null) !== R.storage_absent) bad.push('face-null');
    if (api.readTaobaoFace({ storageOk: false, hasAny: true }) !== R.storage_absent) bad.push('face-storage');
    if (api.readTaobaoFace({ storageOk: true, hasAny: false }) !== R.empty) bad.push('face-empty');
    if (api.readTaobaoFace({ storageOk: true, hasAny: true }) !== R.ready) bad.push('face-ready');
    if (R.storage_absent !== 'storage-absent') bad.push('reason-hyphen:' + R.storage_absent);
    /* 空投影：读数全 0、hasAny=false（不编数）。 */
    const empty = api.projectTaobao([], [], [], [], 1000, settings);
    if (empty.hasAny !== false) bad.push('proj-empty-hasAny');
    if (empty.productCount !== 0 || empty.orderCount !== 0 || empty.grabCount !== 0) bad.push('proj-empty-counts');
    if (empty.cartCents !== 0 || empty.cartCount !== 0 || empty.cartMissing !== 0) bad.push('proj-empty-cart');
    if (empty.pendingCount !== 0 || empty.inTransitCount !== 0) bad.push('proj-empty-pending');
    if (empty.nextEvent !== null) bad.push('proj-empty-next');
    if (empty.grabNetCents !== 0) bad.push('proj-empty-grab');
    if (empty.statusCounts.placed !== 0 || empty.statusCounts.received !== 0) bad.push('proj-empty-status');
    if (api.taobaoPromptBlock(empty, settings) !== '') bad.push('inject-empty');
    /* ★ 涉及「下一步在什么时候」的夹具一律显式钉住 1× —— 默认倍率是 60，用它会让
     *   「10 秒后应该走到第几步」这类断言跟着默认值漂移（本轮判据自己踩的坑）。 */
    const S1 = { ...settings, speedFactor: 1 };
    /* 有账：两张单、车两件、抓过一次。 */
    const products = api.normalizeProducts([{ id: 'pa', name: '\u676f', priceCents: 3000 }]);
    const o1 = api.placeOrder([], [{ productId: 'pa', qty: 1 }], products, mkCities(), 1000000).order;
    const o2 = api.placeOrder([], [{ productId: 'pa', qty: 1 }], products, mkCities(), 1050000).order;
    const orders = [o2, o1];
    const p = api.projectTaobao(products, [{ productId: 'pa', qty: 2 }], orders, [{ valueCents: 1000 }], 1060000, S1);
    if (p.productCount !== 1 || p.orderCount !== 2) bad.push('cnt:' + JSON.stringify([p.productCount, p.orderCount]));
    if (p.statusCounts.placed !== 2) bad.push('status:' + JSON.stringify(p.statusCounts));
    if (p.pendingCount !== 2 || p.inTransitCount !== 0) bad.push('pending:' + JSON.stringify([p.pendingCount, p.inTransitCount]));
    if (p.cartCents !== 6000 || p.cartCount !== 2 || p.cartRows !== 1) bad.push('cart:' + JSON.stringify([p.cartCents, p.cartCount]));
    if (p.grabCount !== 1 || p.grabNetCents !== 1000) bad.push('grab:' + JSON.stringify([p.grabCount, p.grabNetCents]));
    if (p.unPricedCount !== 0) bad.push('unpriced:' + p.unPricedCount);
    if (p.hasAny !== true) bad.push('hasAny');
    /* ★ 最快的一步 = 全单里 `next.at` 最小的那个：o2（1050000 起算）的第 1 步在 1062000，
     *   o1（1000000 起算）的下一步在 1312000 ⇒ 必须取 o2 那条。 */
    if (!p.nextEvent) bad.push('next-null');
    else {
        if (p.nextEvent.orderId !== o2.id) bad.push('next-pick:' + p.nextEvent.orderId);
        if (p.nextEvent.text !== '\u4ed8\u6b3e\u6210\u529f\uff0c\u7b49\u5f85\u5546\u5bb6\u6253\u5305') bad.push('next-text:' + p.nextEvent.text);
        if (p.nextEvent.remainingMs !== 2000) bad.push('next-when:' + p.nextEvent.remainingMs);
    }
    /* ★ 投影是**纯读数**：不许改被读的对象（o1/o2 仍在 placed）。 */
    if (o1.status !== 'placed' || o2.status !== 'placed') bad.push('proj-mutates');
    /* 已签收的单不计入「最快的一步」与在途计数。 */
    const done = api.projectTaobao([], [], [mkOrder({ id: 'd1', status: 'received', createdAt: 1060000 - SPAN_MS })], [], 1060000, settings);
    if (done.pendingCount !== 0 || done.nextEvent !== null) bad.push('recv-excluded:' + JSON.stringify([done.pendingCount, done.nextEvent]));
    if (done.inTransitCount !== 0) bad.push('recv-in-transit');
    /* 在途单（shipped）单独计数。 */
    const ship = api.projectTaobao([], [], [mkOrder({ id: 's1', status: 'shipped' })], [], 1000000 + 12000, settings);
    if (ship.inTransitCount !== 1 || ship.pendingCount !== 1) bad.push('in-transit:' + JSON.stringify([ship.inTransitCount, ship.pendingCount]));
    /* 未定价商品计入 unPricedCount（读数要显形）。 */
    const up = api.projectTaobao(api.normalizeProducts([{ id: 'pu', name: 'u' }]), [], [], [], 1000, settings);
    if (up.unPricedCount !== 1) bad.push('unpriced-count:' + up.unPricedCount);
    /* 设置钳制。 */
    const ns = api.normalizeTaobaoSettings({ maxInjectOrders: 99, speedFactor: 0, maxGrabs: 1000, injectToPrompt: false });
    if (ns.maxInjectOrders !== 20) bad.push('clamp-max:' + ns.maxInjectOrders);
    if (ns.speedFactor !== 1) bad.push('clamp-speed:' + ns.speedFactor);
    if (ns.maxGrabs !== 200) bad.push('clamp-grabs:' + ns.maxGrabs);
    if (ns.injectToPrompt !== false) bad.push('clamp-inject');
    if (api.normalizeTaobaoSettings(null).speedFactor !== 60) bad.push('clamp-null:' + api.normalizeTaobaoSettings(null).speedFactor);
    if (api.TAOBAO_LIMITS.maxSpeedFactor !== 86400) bad.push('max-speed-const');
    return bad;
}

/* ── E2 注入：只给事实、无在途则空串、开关与条数门 ── */
function injectProblems(api) {
    const bad = [];
    const settings = api.defaultTaobaoSettings();
    const products = api.normalizeProducts([{ id: 'pa', name: '\u676f', priceCents: 3000 }]);
    const o1 = api.placeOrder([], [{ productId: 'pa', qty: 1 }], products, mkCities(), 1000000).order;
    const p = api.projectTaobao(products, [], [o1], [], 1000000 + 2000, settings);
    const txt = api.taobaoPromptBlock(p, settings);
    if (!txt.startsWith('\u3010\u7cfb\u7edf\u00b7\u6843\u5b9d\u3011')) bad.push('head:' + txt.slice(0, 20));
    /* 只给事实：最快的一步 + 待付款计数 —— 不许出现「要不要买」「快下单」这类替角色出主意的话。 */
    if (!txt.includes('\u6700\u5feb\u7684\u4e00\u6b65\uff1a')) bad.push('row-next:' + txt);
    if (!txt.includes('\u5f85\u4ed8\u6b3e 1 \u5355')) bad.push('row-placed:' + txt);
    for (const banned of ['\u4e70\u5427', '\u4e0b\u5355\u5427', '\u5efa\u8bae', '\u4f60\u5e94\u8be5', '\u5feb\u4e0b\u5355']) {
        if (txt.includes(banned)) bad.push('advice:' + banned);
    }
    /* 条数门：maxInjectOrders=1 ⇒ 头 + 一行。 */
    const one = api.taobaoPromptBlock(p, { ...settings, maxInjectOrders: 1 });
    if (one.split('\n').length !== 2) bad.push('max1:' + JSON.stringify(one));
    /* 开关 / 0 条 / 空投影 / 空 proj ⇒ 空串（**不产生空块**）。 */
    if (api.taobaoPromptBlock(p, { ...settings, injectToPrompt: false }) !== '') bad.push('off');
    if (api.taobaoPromptBlock(p, { ...settings, maxInjectOrders: 0 }) !== '') bad.push('max0');
    if (api.taobaoPromptBlock(null, settings) !== '') bad.push('null-proj');
    const emptyProj = api.projectTaobao([], [], [], [], 1000, settings);
    if (api.taobaoPromptBlock(emptyProj, settings) !== '') bad.push('empty-proj');
    /* 只有已签收的单 ⇒ 无在途 ⇒ 空串（不产「0 单在路上」这种废话）。 */
    const recvProj = api.projectTaobao([], [], [mkOrder({ id: 'r', status: 'received', createdAt: 0 })], [], 1e9, settings);
    if (api.taobaoPromptBlock(recvProj, settings) !== '') bad.push('only-recv:' + api.taobaoPromptBlock(recvProj, settings));
    /* 待发货也有话说。 */
    const paid = api.projectTaobao([], [], [mkOrder({ status: 'paid' })], [], 1000000 + 12000, settings);
    const t2 = api.taobaoPromptBlock(paid, settings);
    if (!t2.includes('\u5f85\u53d1\u8d27 1 \u5355')) bad.push('row-paid:' + t2);
    return bad;
}

/* ══════════════════════ F ── 接线（四处注册 + 调用面 + 样式 + 前缀 + 四件套） ══════════════════════ */
const APP_ID = 'taobao';
const APP_CLS = 'TaobaoApp';
const CSS_PFX = '.tbo-';
const KEY_PFX = 'taobao';

test('F1 四处注册齐备：APPS / 懒加载分支 / REBIND 表 / 会话键前缀（槽位名是驼峰）', () => {
    const idx = read('index.js');
    const apps = read('config/apps.js');
    const storage = read('config/storage.js');
    const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(tbl.length > 0, 'index.js 必须有 ST_PHONE_REBIND_APP_KEYS 表');
    assert.ok(apps.includes("id: '" + APP_ID + "'"), 'config/apps.js 必须登记 id: ' + APP_ID);
    assert.equal(apps.split("id: '" + APP_ID + "'").length - 1, 1, 'APPS 里同 id 只许登记一次');
    assert.ok(idx.includes("appId === '" + APP_ID + "'"), 'index.js 必须有懒加载分支 ' + APP_ID);
    assert.ok(idx.includes("import('./apps/" + APP_ID + "/" + APP_ID + "-app.js')"), '分支必须指向真实路径 apps/' + APP_ID);
    assert.ok(idx.includes('new module.' + APP_CLS + '('), APP_CLS + ' 必须被构造');
    /* ★ 槽位名是**驼峰**（window.VirtualPhone.taobaoApp），不是 `<前缀>App`（前缀全小写）。
     *   REBIND 表与三处清理按的就是这个**槽位**，名字对不上时换会话不会重绑，而门禁不报错。 */
    const slot = 'taobaoApp';
    assert.ok(idx.includes('window.VirtualPhone.' + slot + ' = new module.' + APP_CLS + '('),
        'index.js 必须把 ' + APP_CLS + ' 留在 window.VirtualPhone.' + slot);
    assert.ok(tbl.includes("'" + slot + "'"), 'REBIND 表必须含 ' + slot + ' 槽位');
    assert.ok(storage.includes('/^' + KEY_PFX + '_/'), '会话隔离表必须有 /^' + KEY_PFX + '_/');
    /* 条目注释里必须写明「哪些不缝」——那几行的存在本身是这一件的定位凭据。 */
    assert.ok(apps.includes('五处不缝'), 'config/apps.js 的桃宝条目必须写明不缝清单');
    assert.ok(apps.includes('[v3.29.0]'), '条目必须带本版标记');
});

test('F2 视图调用面必须闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* 本仓记过的形态（v3250 修正过两处）：视图 `this.app.xxx()` 而 App 上根本没有 xxx，
     * 界面在**用户真的点到那个按钮时**才炸，平时完全看不出来。这里做成静态契约检查。 */
    const FIELDS = new Set(['settings', 'face', 'storage', 'shell', 'limits', 'proj', 'projection',
        'view', '_view', 'app', 'state', 'products', 'orders', 'cart', 'grabs']);
    const appSrc = read(APP_REL);
    const methods = new Set();
    for (const m of appSrc.matchAll(/^[ \t]+(?:get |set )?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) methods.add(m[1]);
    const viewSrc = read(VIEW_REL);
    const called = new Set();
    for (const m of viewSrc.matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
    const missing = [...called].filter((n) => !methods.has(n) && !FIELDS.has(n));
    assert.deepEqual(missing, [], VIEW_REL + ' 调了 App 上不存在的东西：' + missing.join(' , '));
    assert.ok(methods.size >= 15, APP_REL + ' 的方法面异常小（' + methods.size + '）');
    assert.ok(called.size >= 8, VIEW_REL + ' 的调用面异常小（' + called.size + '）');
    /* 视图不许自己写一份状态中文（两边各写一份 = 改文案时只改一处，静默不一致）。 */
    const view = stripComments(viewSrc);
    for (const s of ['\u5df2\u4e0b\u5355', '\u5df2\u4ed8\u6b3e', '\u5df2\u53d1\u8d27', '\u5df2\u7b7e\u6536']) {
        assert.equal(view.includes(s), false, '视图不得自写状态中文（应走数据层 statusTextOf）：' + s);
    }
    assert.ok(viewSrc.includes('statusTextOf'), '视图的状态文案必须来自数据层');
    assert.ok(viewSrc.includes('[TAOBAO_REASONS.'), '视图文案表的键必须由归因常量计算');
});

test('F3 样式源与 phone.css 逐字同源，且视图产出的每个类名都有落点', () => {
    const phone = read('phone.css');
    const HDR = '/* ---------- [v3.29.0] \u6843\u5b9d App\uff08' + CSS_PFX + '*\uff09 ---------- */';
    const at = phone.indexOf(HDR);
    assert.ok(at >= 0, 'phone.css 必须带本版段头：' + HDR);
    const rest = phone.slice(at);
    /* ★ [v3.30.0 接泒已执行] 本段不再是末段—— v3.30.0 往后接了「恋爱空间」段，
     *   故按 v3.28.0 当时立的交棒口径：**按下一个段头截断**，不取文件尾。
     *   下版若再往后接段，本取法依然正确（不会以「同源失败」假红）。 */
    const nxt = rest.indexOf('/* ---------- [', 1);
    const seg = nxt >= 0 ? rest.slice(0, nxt) : rest;
    const norm = (x) => x.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
    assert.equal(norm(seg), norm(read(CSS_REL)), 'phone.css 的本版段必须与 ' + CSS_REL + ' 逐字同源');
    assert.ok(seg.split(CSS_PFX).length - 1 >= 5, '本段必须真的带样式');
    /* 每个产出的类名都要有**样式落点**：自己有条规则 / 是 JS 选择器锚点。 */
    const view = read(VIEW_REL);
    const js = view + read(APP_REL);
    const css = read(CSS_REL);
    const bare = CSS_PFX.slice(1);
    const cssNames = new Set(css.match(new RegExp('[.]' + bare + '[a-z0-9-]+', 'g')) || []);
    const anchors = new Set();
    /* ★ 本仓的取值助手是 `const q = (sel) => this._root.querySelector(sel);`，视图一律写
     *   `q('.tbo-claw')` —— 只认「querySelector( 紧跟选择器」会把全部 q(...) 锚点漏掉。 */
    for (const m of js.matchAll(/(?:querySelector(?:All)?|\bq)\s*\(\s*['"]([^'"]*)['"]/g)) {
        for (const tok of m[1].match(/\.[A-Za-z0-9_-]+/g) || []) anchors.add(tok.slice(1));
    }
    for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
    const produced = new Set();
    for (const m of view.matchAll(/class=["']([^"']+)/g)) {
        for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare) && !tok.endsWith('-')) produced.add(tok);
    }
    for (const m of view.matchAll(/className\s*=\s*'([^']+)'/g)) {
        for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare)) produced.add(tok);
    }
    const missing = [...produced].filter((x) => !cssNames.has('.' + x) && !anchors.has(x));
    assert.deepEqual(missing, [], VIEW_REL + ' 这些类名既无样式规则也不是锚点：' + missing.join(' , '));
    assert.ok(produced.size >= 20, VIEW_REL + ' 产出的类名异常少（' + produced.size + '）');
    assert.ok(anchors.size >= 3, VIEW_REL + ' 的选择器锚点异常少（' + anchors.size + '）');
    /* 段里的类名必须都在本 App 前缀下（防「顺手借了别人的类名」）。 */
    const foreign = [...cssNames].filter((x) => !x.startsWith(CSS_PFX));
    assert.deepEqual(foreign, [], CSS_REL + ' 出现非本前缀的类名：' + foreign.join(' , '));
});

test('F4 前缀全仓唯一：.tbo- 只出现在本 App 目录与 phone.css', () => {
    const walk = (dir, out) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            /* ★ 判据文件自己也满篇写着 `.tbo-` ——扫描面必须排除 tests/，否则这条检查测的是它自己的字符串。 */
            if (e.name === '.git' || e.name === 'node_modules') continue;
            /* 只排除「判据文件自己」（它满篇写着 `.tbo-`）：不能整目录排除 tests/，
             *   否则别的测试里真出现越界引用就永远查不出来了。 */
            if (path.resolve(dir, e.name) === path.resolve(fileURLToPath(import.meta.url))) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, out);
            else if (/\.(js|css|mjs|json|html)$/.test(e.name)) out.push(full);
        }
        return out;
    };
    const files = walk(ROOT, []);
    assert.ok(files.length > 200, '扫描面异常小（' + files.length + '）');
    const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes(CSS_PFX));
    assert.ok(users.length > 0, CSS_PFX + ' 必须在仓里被用到');
    for (const f of users) {
        assert.ok(f.includes('/apps/' + APP_ID + '/') || f.endsWith('phone.css'),
            CSS_PFX + ' 只应出现在 apps/' + APP_ID + '/ 与 phone.css，实测还有：' + f.replace(ROOT, ''));
    }
});

test('F5 四件套齐备、data 层纯函数，且源里五块禁区一条都没进来', () => {
    for (const f of ['-data.js', '-app.js', '-view.js', '.css']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'apps', APP_ID, APP_ID + f)), 'apps/' + APP_ID + '/' + APP_ID + f + ' 必须存在');
    }
    const data = read(DATA_REL);
    const code = stripComments(data);
    /* ① 纯函数：不碰 DOM / window / 网络 / 聊天层 / 数据库 / 定时器。 */
    for (const banned of ['document', 'window', 'localStorage', 'sessionStorage',
        'fetch(', 'XMLHttpRequest', 'indexedDB', 'Dexie', 'openDB', 'geolocation',
        'getChatMessages', 'setChatMessages', 'chatMetadata', 'setTimeout', 'setInterval']) {
        assert.equal(code.includes(banned), false, APP_ID + ' 的 data 层**代码**里不得出现：' + banned);
    }
    /* ② 不碰钱包（本仓用户钱包的仲裁源是微信零钱）。 */
    for (const banned of ['userBalance', 'userWalletTransactions', 'characterPhoneData',
        'characterPhoneBank', '.bank']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得碰钱包字段：' + banned);
    }
    /* ③ 零外部素材（源 12 条外链一条都不收）。 */
    for (const banned of ['http://', 'https://', 'postimg', 'laddy-lulu', '.mp3', '.png', '.jpg']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得内置外链素材：' + banned);
    }
    /* ④ 不自己调模型（源靠 /v1/chat/completions 造商品与评价）。 */
    for (const banned of ['chat/completions', 'generateProductReviews', 'generateProductImages', 'handleGenerateProductsAI']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得自己造商品/评价：' + banned);
    }
    assert.ok(data.includes("from '../../config/num-gate.js'"), DATA_REL + ' 应走共享取数门');
    /* App 层同样不转定时器、不碰钱包、不发请求（它只做取数 → 纯函数 → 视图 → 落盘）。 */
    const appCode = stripComments(read(APP_REL));
    for (const banned of ['setTimeout', 'setInterval', 'userBalance', 'characterPhoneData',
        'fetch(', 'XMLHttpRequest', 'https://', 'indexedDB', 'Dexie']) {
        assert.equal(appCode.includes(banned), false, APP_REL + ' 不得出现：' + banned);
    }
    /* 视图：不直接读存储（一切数据变动都回调到 App 上）。 */
    const viewCode = stripComments(read(VIEW_REL));
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'setTimeout']) {
        assert.equal(viewCode.includes(banned), false, VIEW_REL + ' 不得出现：' + banned);
    }
    /* 样式前缀。 */
    assert.ok(read(CSS_REL).includes(CSS_PFX), CSS_REL + ' 必须用 ' + CSS_PFX + ' 前缀');
    /* 归因连字符形在数据层定义（视图文案表的键取的是它的**值**）。 */
    assert.ok(data.includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ══════════════════════ G ── 键归属 ══════════════════════ */
test('G1 五条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const src = read(APP_REL);
    const hits = [...src.matchAll(new RegExp("'(" + KEY_PFX + "_[a-z_]+)'", 'g'))].map((m) => m[1]);
    const uniq = [...new Set(hits)];
    assert.equal(uniq.length, 5, '本件五条键，实测 ' + uniq.join(','));
    assert.deepEqual(uniq.slice().sort(),
        ['taobao_cart', 'taobao_grabs', 'taobao_orders', 'taobao_products', 'taobao_settings'],
        '键名必须与设计一致：' + uniq.join(','));
    for (const key of uniq) {
        assert.equal(audit.split("key: '" + key + "'").length - 1, 1, '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次');
        assert.ok(new RegExp("\\{ key: '" + key + "', scope: 'chat'").test(audit), '键 ' + key + ' 必须是会话隔离（scope: chat）');
    }
    /* 会话隔离表必须真的覆盖到（前缀落在 storage.js 的模式表里）。 */
    assert.ok(read('config/storage.js').includes('/^' + KEY_PFX + '_/'), '会话隔离表必须覆盖 ^' + KEY_PFX + '_');
    /* 换会话钩子必须在（重绑表把本件算进去了，否则换角色后串味）。 */
    assert.ok(/\n\s*onChatChanged\s*\(/.test(src), '必须有换会话钩子（重绑表按它工作）');
});

/* ══════════════════════ H ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════════════════ */
/** 破坏表集中在一处：I2 会拿它做「锚点在场性 + 替换保真」的批量自证。 */
const DAMAGE = {
    /* 金额串改成美元号 ⇒ 「分 → ¥ 串」必须转红。 */
    d1: [DATA_REL,
        "    return (neg ? '-' : '') + '\\u00a5' + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');",
        "    return (neg ? '-' : '') + '$' + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');"],
    /* 未定价标记不再粘住 ⇒ 「存储往返后标记不丢」必须转红。 */
    d2: [DATA_REL,
        '    const unPriced = o.unPriced === true || !priced;',
        '    const unPriced = !priced;'],
    /* 失效条目不计数 ⇒ 「车里缺件要显形」必须转红。 */
    d3: [DATA_REL,
        '        if (!p) { missing += 1; continue; }',
        '        if (!p) { continue; }'],
    /* 缺件照下单（静默跳过那一行）⇒ 「缺件不下单」必须转红。 */
    d4: [DATA_REL,
        "        if (!p) return { orders: base, order: null, error: '\u8f66\u91cc\u6709\u5546\u54c1\u5df2\u4e0d\u5728\u76ee\u5f55\u91cc\uff0c\u5148\u6e05\u6389\u5b83' };",
        '        if (!p) continue;'],
    /* 状态允许后退 ⇒ 「只前进不后退」必须转红。 */
    d5: [DATA_REL,
        '        if (statusRankOf(key) <= statusRankOf(o.status)) return o;',
        '        if (statusRankOf(key) >= statusRankOf(o.status)) return o;'],
    /* 「已发货」提前到第 2 步 ⇒ 四段边界必须转红。 */
    d6: [DATA_REL,
        "    if (n >= SHIPPED_AT_STEP) return 'shipped';",
        "    if (n >= PAID_AT_STEP) return 'shipped';"],
    /* 归因不再先判「读不到」⇒ 三态必须先判可读这条必须转红。 */
    /* 归因不再先判「读不到」⇒ 三态必须先判可读这条必须转红。
     * ★ 两行必须一起改：只把首判改成 `if (false)` 会让 `readTaobaoFace(null)`
     *   直接抛 TypeError（报错 ≠ 转红）。正确的破坏是把「 null 也能吞」
     *   作为行为： null 走到第二行得到 `empty`。 */
    d7: [DATA_REL,
        '    if (!probe || probe.storageOk === false) return TAOBAO_REASONS.storage_absent;\n    if (probe.hasAny !== true) return TAOBAO_REASONS.empty;',
        '    if (probe && probe.storageOk === false) return TAOBAO_REASONS.storage_absent;\n    if (!probe || probe.hasAny !== true) return TAOBAO_REASONS.empty;'],
    /* 加权抽取改成闭区间 ⇒ 档界归属必须转红（0.40 会落回第一档）。 */
    d8: [DATA_REL,
        '        if (randomNum < tier.weight) return tier;',
        '        if (randomNum <= tier.weight) return tier;'],
    /* 空投影也产块 ⇒ 「无在途不产生空块」必须转红。 */
    d9: [DATA_REL,
        "    if (!rows.length) return '';",
        '    if (false) return \'\';'],
    /* 三城市允许重复 ⇒ 「三城互不相同」必须转红。 */
    d10: [DATA_REL,
        '    const rest1 = all.filter((c) => c !== shipFrom);',
        '    const rest1 = all;'],
    /* 目录上限不再截断 ⇒ 「超上限如实截断」必须转红。 */
    d11: [DATA_REL,
        '    return out.slice(0, TAOBAO_LIMITS.maxProducts);',
        '    return out;'],
};

/** num-gate 的**等价桩**（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v === 'number') return Number.isFinite(v) ? v : null;\n"
    + "    if (typeof v !== 'string') return null;\n"
    + "    if (!v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

/**
 * 造一份破坏副本并加载。
 * ★ 副本按**真目录结构**建：data 层写的是 `../../config/num-gate.js`，
 *   若把副本摊在 <tmp> 根下，那条相对路径会解析成 `/config/num-gate.js`（差两级，
 *   首跑即 ERR_MODULE_NOT_FOUND —— 与破坏本身无关的假红）。
 */
function loadDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v329_'));
    const target = path.join(dir, 'apps', path.basename(path.dirname(rel)), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    const gateDir = path.join(dir, 'config');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(target).href);
}

/** 判据函数吃的那一组符号（真实现 / 破坏副本通用）。 */
const apiOf = (m) => ({
    TAOBAO_REASONS: m.TAOBAO_REASONS, TAOBAO_FACES: m.TAOBAO_FACES, TAOBAO_LIMITS: m.TAOBAO_LIMITS,
    ORDER_STATUS: m.ORDER_STATUS, ORDER_STATUS_ORDER: m.ORDER_STATUS_ORDER,
    LOGISTICS_TEMPLATE: m.LOGISTICS_TEMPLATE, LOGISTICS_CITIES: m.LOGISTICS_CITIES,
    REWARD_TIERS: m.REWARD_TIERS, DEFAULT_TAOBAO_SETTINGS: m.DEFAULT_TAOBAO_SETTINGS,
    defaultTaobaoSettings: m.defaultTaobaoSettings, normalizeTaobaoSettings: m.normalizeTaobaoSettings,
    yuanToCents: m.yuanToCents, formatCents: m.formatCents, normalizeProduct: m.normalizeProduct,
    normalizeProducts: m.normalizeProducts, addToCart: m.addToCart, setQty: m.setQty,
    removeFromCart: m.removeFromCart, clearCart: m.clearCart, cartTotal: m.cartTotal,
    pickCities: m.pickCities, placeOrder: m.placeOrder, logisticsSteps: m.logisticsSteps,
    statusKeyOfDoneCount: m.statusKeyOfDoneCount, statusTextOf: m.statusTextOf, statusRankOf: m.statusRankOf,
    applyLogistics: m.applyLogistics, rollTier: m.rollTier, recordGrab: m.recordGrab,
    readTaobaoFace: m.readTaobaoFace, projectTaobao: m.projectTaobao, taobaoPromptBlock: m.taobaoPromptBlock,
});
const REAL = apiOf({ TAOBAO_REASONS, TAOBAO_FACES, TAOBAO_LIMITS, ORDER_STATUS, ORDER_STATUS_ORDER, LOGISTICS_TEMPLATE, LOGISTICS_CITIES, REWARD_TIERS, DEFAULT_TAOBAO_SETTINGS, defaultTaobaoSettings, normalizeTaobaoSettings, yuanToCents, formatCents, normalizeProduct, normalizeProducts, addToCart, setQty, removeFromCart, clearCart, cartTotal, pickCities, placeOrder, logisticsSteps, statusKeyOfDoneCount, statusTextOf, statusRankOf, applyLogistics, rollTier, recordGrab, readTaobaoFace, projectTaobao, taobaoPromptBlock });

test('H1 破坏「分 → ¥ 串」⇒ A1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d1;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = moneyProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('fmt-1230') || x.startsWith('fmt-neg')), '金额串变形后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(moneyProblems(REAL), [], '对照：真实现必须是 ¥ 串');
});

test('H2 破坏「未定价标记粘住」⇒ A1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d2;
    const mod = await loadDamagedCopy(rel, from, to);
    /* 先自证：破坏后确实把标记丢了（否则这条负控制测的是空气）。 */
    const p = mod.normalizeProduct({ name: 'a', priceCents: 0, unPriced: true }, 1);
    assert.equal(p.unPriced, false, '对照：破坏后标记必须丢');
    const bad = moneyProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('unpriced')), '标记丢失后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(moneyProblems(REAL), [], '对照：真实现必须粘住未定价标记');
});

test('H3 破坏「失效条目单独计数」⇒ B2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d3;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = cartTotalProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('missing')), '失效条目不计数后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(cartTotalProblems(REAL), [], '对照：真实现必须把失效条目算出来');
});

test('H4 破坏「缺件不下单」⇒ C1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d4;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = orderProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('missing-cart')), '缺件也下单后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(orderProblems(REAL), [], '对照：真实现必须拒收缺件订单');
});

test('H5 破坏「只前进不后退」⇒ C5 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d5;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = applyLogisticsProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('no-back') || x.startsWith('idempotent')), '状态后退后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(applyLogisticsProblems(REAL), [], '对照：真实现必须只前进');
});

test('H6 破坏「四段状态边界」⇒ C4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d6;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = statusProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('map') || x.startsWith('paid-at')), '边界错位后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(statusProblems(REAL), [], '对照：真实现边界必须正确');
});

test('H7 破坏「归因先判可读」⇒ E1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d7;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = projectProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('face-')), '读不到也报「空」后必须转红，实测：' + bad.join(' , '));
    assert.deepEqual(projectProblems(REAL), [], '对照：真实现必须先判可读');
});

test('H8 破坏「加权抽取是左闭右开」⇒ D1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d8;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = clawProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('roll')), '档界归属错位后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(clawProblems(REAL), [], '对照：真实现档界必须正确');
});

test('H9 破坏「无在途不产生空块」⇒ E2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d9;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = injectProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('inject') || x.startsWith('empty') || x.startsWith('only-recv') || x.startsWith('max0') || x === 'off'),
        '空投影也产块后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(injectProblems(REAL), [], '对照：真实现无在途就该是空串');
});

test('H10 破坏「三城互不相同」⇒ C2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d10;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = logisticsTemplateProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('cities-distinct') || x.startsWith('pick-cities')), '城市可重复后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(logisticsTemplateProblems(REAL), [], '对照：真实现三城必须互不相同');
});

test('H11 破坏「目录上限截断」⇒ A2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d11;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = productProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('cap')), '不截断后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(productProblems(REAL), [], '对照：真实现必须截到上限');
});

/* ══════════════════════ I ── 判据工具自证 ══════════════════════ */
test('I1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：F5 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，那些断言只会**更绿** —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「假绿」族（对原文件断言 / 破坏写死成常量 / 判据自我指涉之外：工具被削成空闸）。
     *   故必须两向自证。 */
    const raw = '// 注释里写 setTimeout 与 postimg\n'
        + 'const a = "setTimeout";\n'
        + '/* 块注释 Dexie / userBalance */\n'
        + 'const b = 1;\n'
        + "const c = 'x//not-a-comment';";
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"setTimeout"'), '字符串字面量必须留住（剥器不得把字符串里的同形文本一起吃掉）');
    assert.ok(stripped.includes("'x//not-a-comment'"), '字符串里的 // 不是注释起头（剥器不得在字符串内切换状态）');
    assert.equal(stripped.includes('注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.ok(stripped.includes('const b = 1;'), '普通代码必须原样留下');
    /* 模板串与转义引号也是状态机必须正确处理的两种输入。 */
    assert.equal(stripComments('const t = `a${"//"}b`; // 真注释').includes('真注释'), false, '模板串后的注释必须剥掉');
    assert.ok(stripComments("const s = 'a\\'//b';").includes("a\\'//b"), '转义引号不得让状态机提前收尾');
    /* 本件三层剥注释后都必须真的变短（否则 F5 的「不出现」是空闸）。 */
    for (const rel of [DATA_REL, APP_REL, VIEW_REL]) {
        assert.ok(read(rel).length > stripComments(read(rel)).length, rel + ' 剥注释后必须真的变短');
    }
    /* ★ 而且：未剥注释时**必须**真的出现那几个词（正说明它们只是「提及」）。 */
    for (const w of ['setTimeout', 'Dexie', 'userBalance', 'postimg']) {
        assert.ok(read(DATA_REL).includes(w), '文件头应当写明源里的 ' + w + '（它是「说明」，不是「消费」）');
    }
});

test('I2 破坏表自证：锚点必须在场（恰 1 次）、不落在注释里、替换必须保真', () => {
    /* ★ 负控制自身最隐蔽的失效形态是**锚点漂移**——产品改动让锚点失配，
     *   split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿。故「在场性」必须与「保真」一起被自证。 */
    assert.ok(Object.keys(DAMAGE).length >= 10, '破坏表异常小（' + Object.keys(DAMAGE).length + '）');
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
        assert.ok(out.includes(to), name + ' 替换后新串必须在场');
        assert.notEqual(from, to, name + ' 的 from/to 不得相同（那样不是破坏）');
        /* 锚点必须落在**代码**里 —— 落在注释里的锚点破坏不了任何行为。 */
        const at = src.indexOf(from);
        const before = src.slice(0, at);
        const opens = (before.match(/\/\*/g) || []).length;
        const closes = (before.match(/\*\//g) || []).length;
        assert.equal(opens, closes, name + ' 的锚点不得落在块注释里');
        const lineStart = src.lastIndexOf('\n', at) + 1;
        const lineEnd = src.indexOf('\n', at);
        const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
        assert.ok(!line.startsWith('//') && !line.startsWith('*'), name + ' 的锚点不得落在注释行里：' + line.slice(0, 60));
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace：替换串里一旦出现 `$`，
     *   `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形、负控制失去判别力。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
    /* 副本的结构自证：`../../config/num-gate.js` 必须真能解析到桩（否则会出 ERR_MODULE_NOT_FOUND 假红）。 */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v329_selfcheck_'));
    fs.mkdirSync(path.join(tmp, 'apps', 'x'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'num-gate.js'), NUM_GATE_STUB);
    fs.writeFileSync(path.join(tmp, 'apps', 'x', 'm.mjs'),
        "import { numOrNull } from '../../config/num-gate.js';\nexport const v = [numOrNull(0), numOrNull(''), numOrNull('3')];\n");
    return import(pathToFileURL(path.join(tmp, 'apps', 'x', 'm.mjs')).href).then((m) => {
        assert.deepEqual(m.v, [0, null, 3], 'num-gate 桩必须与真件同口径（0 是合法读数、空串是没给）');
    });
});

/* ══════════════════════ 内核判据挂测 ══════════════════════ */
test('A1 钱一律整数分：分 → ¥ 串 / 元 → 分 / 未定价标记粘住 / 非法价如实标而不拒收', () => {
    const bad = moneyProblems(REAL);
    assert.deepEqual(bad, [], '钱的口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(yuanToCents(0.1), 10, '一角就是十分（浮点口径不许漏进来）');
});

test('A2 商品规范化：坏输入如实拒 / 截断不拒收 / 自动 id 不许撞', () => {
    const bad = productProblems(REAL);
    assert.deepEqual(bad, [], '商品口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B1 购物车：同件累加、刚好装满不报夹、数量 0 即摘', () => {
    const bad = cartProblems(REAL);
    assert.deepEqual(bad, [], '购物车口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B2 合计：失效条目单独计数不静默吞（钱不计、数照计、读数显形）', () => {
    const bad = cartTotalProblems(REAL);
    assert.deepEqual(bad, [], '合计口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('C1 订单是快照不是引用；空车与缺件都不下单且如实说明', () => {
    const bad = orderProblems(REAL);
    assert.deepEqual(bad, [], '下单口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(TAOBAO_LIMITS.maxOrders, 100);
});

test('C2 物流模板：延迟逐档、累计 82.42 小时、占位符各就各位、三城互不相同', () => {
    const bad = logisticsTemplateProblems(REAL);
    assert.deepEqual(bad, [], '物流模板必须与源逐字，实测问题：' + bad.join(' , '));
    assert.equal(LOGISTICS_TEMPLATE.length, 9, '源就是 9 步');
});

test('C3 物流推演：累计时刻、done 是前缀、倍率只改时刻不改事实', () => {
    const bad = logisticsStepProblems(REAL);
    assert.deepEqual(bad, [], '推演口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.ok(read(DATA_REL).includes('logisticsTimelineTemplate'), '模板来源（源函数名）必须在文件头写明');
});

test('C4 四段状态机：边界逐档核对、越界不炸、文案回退到起点', () => {
    const bad = statusProblems(REAL);
    assert.deepEqual(bad, [], '状态口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('C5 惰性补推：只前进不后退、同段不重复计入、receivedAt 记在跨到那一刻', () => {
    const bad = applyLogisticsProblems(REAL);
    assert.deepEqual(bad, [], '补推口径必须与设计一致，实测问题：' + bad.join(' , '));
    /* ★ 不许有常驻定时器 —— 源挂 `setTimeout` 并回查页面 active，正是本件要绕开的形态。 */
    assert.equal(stripComments(read(APP_REL)).includes('setTimeout'), false, '本件一个定时器都不许转');
});

test('D1 娃娃机加权抽取：五档逐字、档界左闭右开、分布真是加权的', () => {
    const bad = clawProblems(REAL);
    assert.deepEqual(bad, [], '抽取口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(REWARD_TIERS.reduce((s, t) => s + t.weight, 0), 100, '权重表就是 100');
});

test('D2 抓取记录：前插、上限丢最旧、条目形状里没有任何入账字段', () => {
    const bad = grabProblems(REAL);
    assert.deepEqual(bad, [], '抓取口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('E1 归因与投影：三态先判可读、空投影不编数、最快的一步取全单最早', () => {
    const bad = projectProblems(REAL);
    assert.deepEqual(bad, [], '投影口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('E2 注入只给事实：无在途则空串（不产生空块），不给角色出主意', () => {
    const bad = injectProblems(REAL);
    assert.deepEqual(bad, [], '注入口径必须与设计一致，实测问题：' + bad.join(' , '));
});

/* ══════════════════════ V ── 版本锚 ══════════════════════ */
test('V1 版本锚（下限形）+ 四源同源 + update-log 条目', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 29),
        '本套件成立于 RubyPhone 3.29.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* 本版条目必须在场且非空（审计门会查这一条，这里先钉住）。 */
    /* ★ 本套件守的是**自己那一版**（v3.29.0 桃宝），不是「当版」—— 抬版后 latest 会换成新件。
     *   此前这里读 `log.versions[man.version]`，一抬版即报红（v3.30.0 抬版当场踩到）。 */
    const SELF = '3.29.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6, '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['桃宝', '物流', '娃娃机', '购物车']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* 本版按批次纪律**不跑全链**：条目里必须如实登记这一点（不许写一份不存在的全链读数）。 */
    assert.ok(joined.includes('单套件') || joined.includes('不跑全链'), '本版条目必须如实登记批次纪律（只跑单套件）');
});
