/* ========================================================
 * asset-holdings.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-holdings.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-ledger.js、./asset-core.js、./asset-keys.js
 * 【上游定位】asset-holdings.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-ledger.js';
import __assetDep1 from './asset-core.js';
import __assetDep2 from './asset-keys.js';

const __REQ = {
    './asset-ledger.js': () => __assetDep0,
    './asset-core.js': () => __assetDep1,
    './asset-keys.js': () => __assetDep2,
};

export default (function () {
  const module = { exports: {} };
  const window = undefined;
  const require = function (p) {
    const f = __REQ[p];
    if (typeof f !== 'function') throw new Error('[asset-engine] unmapped require: ' + p);
    return f();
  };

(function(){
/* src/modules/asset/asset-holdings.js */
'use strict';

// ============================================================================
// 资产模块 · 持仓 / 买卖 / 盈亏（批次 G3）
// ----------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md`
//   §3.8 `:243-255`（三方对账：持仓市值 = 数量 × 现价 **==** 持仓条目声明的市值；对不上**不静默修正**）
//   §3.9 `:257-260`（条目减到 0 **保留**；条目变负数**允许**，不许静默夹 0）
//   §3.11.5 `:385-391`（金额三种口径 ⇒ `book` = 买入成本，**要算盈亏**）
//   §5.5 `:663-680`（**裁判能动市场、不能动你的账**；账只有三个合法写者）
//   §5.8 `:701-705`（退市 / 停牌：持仓仍在，市值按最后价或明说估不出来）
//   §8.2 `:878-880`（行情停用后的持仓降级：**保留**、显示**最后已知价**、**绝不清零市值**）
//   §9 `:888-896`（写回门：三个合法写者收敛成一个账务事务层；任何改钱都要记流水含事由）
//   §15.8 `:1391-1428`（流量三档 `balance` / `cashflow` / `reserve` 与"转移留痕"）
//   §11 第 7 条 `:1109`（关闭 ≠ 删数据）、第 15 条 `:1123`（一笔转出必须成对）、
//   第 16 条 `:1126`（衰减只重估、不产生流水；与摧毁的流水条数形状不同）
// 计划：`docs/superpowers/plans/2026-09-17-asset-module.md:902-905`。
//
// ★★ 本批只做**操作层 + 计算层**（用户裁定 A）：行情页不给下单入口 ⇒ **本层一个字都不上屏**，
//    面板（`asset.script.js`）**一个字都没动**。本层出的是"要落盘的那一份"（`ledger` / `entries`）
//    与"读得懂的一份"（`rows`）；落盘仍归 `asset-store.js` 的唯一写门。
//
// ★★ 三条骨架口径：
//   ① **持仓 = 条目上的一个顶层键 `holding = { symbol, qty, cost }`**，不是行情状态里的新表：
//      §3.8 要的是"持仓条目声明的市值"，而 §5.2 `:632-639` 的行情状态形状里**没有** `holdings`
//      这类键。数量与成本是**账**（三个合法写者），现价是**市场**（裁判能动）—— 两者混进
//      同一个键，就把 §5.5 `:678` 那条铁律的边界抹掉了。
//   ①·★ **`holding.cost` 的量纲 = 累计买入成本（合计）**（面板轮复审收尾在这里钉一句契约）：
//      买入时 `cost += 成交额`（`buyHolding`）、卖出时按 `qty/qtyOld` **比例结转**（`sellHolding`）
//      ⇒ 它**从来不是每股成本**，而且 `pnl = 市值合计 − cost`、`worth ± 成交额` 那一族口径
//      **全都依赖它是合计**。要每股成本是**显示侧**的事（`asset.script.js` 的
//      `mktPerShareCost`，那里的注释与本条成对）—— 本层**不**提供每股那一格，
//      免得同一件事有两个量纲在飞。
//   ② **市值落既有的 `stock.worth`**：由行情结算**重算**（本层的 `revalueHoldings`）；
//      `qty × 现价` 是**算出来的对照量**（§3.8 的等式左边），不是第二个真值。
//   ③ **成本与估值分离**：`cost` 是买入那一刻的账面（历史，**只由买/卖改**），`stock.worth` 是
//      当下的估值（**只由行情结算改**）。两者谁都不许去改对方 —— 这正是本批要钉的那件事。
//
// ★ 回值形状（契约，测试逐字钉住）：每个函数**只做一件事**，坏入参**绝不抛**，一律回
//   `{ error: '代码' }`（照 G2 的 `isObj` / `isNum` 一族手动判）。
//
// ⚠️ 本文件自己踩得到两条扫描面（新文件自动落进去，没有例外）：
//   · `test/asset-terms.test.js` ③（反硬编码）：面板结构词的字面量只许留在 `asset-terms.js`；
//   · `test/asset-panel.test.js` E2（剥注释后）：`src/modules/asset/` 下每个源文件都不许出现
//     那四个内部状态词。⇒ 本文件连注释里都避开这两组词，**代码里的串一律是 ASCII**
//     （错码 / `kind` / `direction` / 词键名），一个中文句子都不在这里造。
// ============================================================================

// ---- 依赖口：同族更前面那两层（真机走 `window.parent` 的全局，Node 走 require）----
// ⚠️ **惰性取**（每次调用时解析）：真机上是 bundle 拼接，调用发生时全局一定已经挂好；
//    而"没挂好"这件事本层要能**挡下**，不能静默按一份缺省往下算。
//    ⚠️ 两条路取的是**同一件事**，不是第二份判断（与 market / store 同一形状）。
function resolveLedger() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-ledger.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_LEDGER__) || null;
}
function resolveCore() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-core.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_CORE__) || null;
}
// 键写入原语（`asset-keys.js`）：`prices` 的键就是**标的代码**（用户可在覆盖层里改名 / 增删）
// ⇒ 本层读它时拼的每一张表都算"用户可控字符串当键"，写入一律走那一份原语。
function resolveKeys() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-keys.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_KEYS__) || null;
}
// 取不到共享原语时**不退回裸赋值**（那正是这一族缺陷的形状）⇒ 自带一份等价的兜底，
// 两条路写的是同一件事：只特判 `__proto__`（造自有可枚举格），其余照常（同 market 那一处）。
function setKey(o, k, v) {
  const K = resolveKeys();
  if (K && typeof K.setKey === 'function') return K.setKey(o, k, v);
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  else o[k] = v;
  return o;
}

// ---- 小工具（与账本层 / core 同一套口径；本文件不导出它们）----
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function str(v) { return v == null ? '' : String(v); }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
// 数认什么：**与账本层的 `num` 同一把尺子**（JSON 里存成字符串的数照旧认，`'abc'` / `''` /
// `null` / `true` / 数组一律认不出）。本层**不写第二份数值口径**。
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  return NaN;
}
// 深拷贝（只认普通对象 / 数组；键可以是任意 JSON 键 ⇒ 逐格走 `setKey`）
function clonePlain(v) {
  if (Array.isArray(v)) return v.map(clonePlain);
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v)) setKey(o, k, clonePlain(v[k]));
    return o;
  }
  return v;
}

// ============================================================================
// ① 口径常量
// ============================================================================
// **行情停用的唯一判据**（实测：全仓没有第二处"行情开关"）：
//   `store.readConfig().enabledCategories`（`asset-store.js:96-103` 的三格白名单之一）
//   里**含不含 `invest`** —— 面板自己那句原文是「股票、基金、理财、债权 —— 启用后才会打开
//   行情与逐日结算」（`asset.script.js:606`）。§11 第 1 条要求启用项**单一来源**，所以本层
//   **只消费**调用方从那个读口拿来的那一格，**不自己再判一次**（不读 onboarded / 不读键在不在）。
const MARKET_CATEGORY = 'invest';

// §3.8 那条等式的对账容差：**相对** 1e-6（浮点乘法同序，但末位仍会有砂子；纯相等会把
// 正常数据报成分歧）。⚠️ 它只决定**报不报**，本层**从不拿它去改任何一个数**（§3.8 `:255`）。
const RECON_TOL = 1e-6;
function reconTol(a, b) { return RECON_TOL * Math.max(1, Math.abs(a), Math.abs(b)); }

// 成交额：**只有这一处算它**（买入与卖出共用）。调用方给的是 `qty` 与**成交价** `price`，
// 成交额一律由本函数乘出来 —— 让调用方另给一个 `amount` 就是两份口径，迟早分叉。
function tradeAmount(qty, price) { return qty * price; }

// 这一笔买卖之后的新持仓格：认得出的三格按这一笔改写，**上一格里其余的键原样带上**
// （同 `normalizeItem` 那条"认得出的三格之外的键原样带上"的透传口径）。
// ⚠️ 不许直接铺一个新字面量：那会把别处往这一格里加的格子**在买卖这一步**吃掉
//    —— 又一次"读一遍丢数据"，而且它逃得过归一化那条往返针脚（第一遍就没了）。
function nextHoldingCell(prev, symbol, qty, cost) {
  const out = {};
  if (isObj(prev)) {
    for (const k of Object.keys(prev)) {
      if (k === 'symbol' || k === 'qty' || k === 'cost') continue;
      setKey(out, k, clonePlain(prev[k]));
    }
  }
  setKey(out, 'symbol', symbol);
  setKey(out, 'qty', qty);
  setKey(out, 'cost', cost);
  return out;
}

// 这一笔买卖做完之后的 §3.8 对账读数（**报，不改**）：把**成交价**当作这一条当下的现价，
// 与"数量 × 现价"比一比。不等于"这一笔做错了"，而是"这一条本来就在账面价与市价之间有缺口"
// （或者成交价与账面价不同）—— **报出来**，闭合它的唯一正当路子是显式的 `revalueHoldings`。
function tradeGap(entryKey, entry, tradePrice) {
  const e = isObj(entry) ? entry : {};
  const cell = isObj(e.holding) ? e.holding : {};
  const qty = num(cell.qty);
  const declared = declaredWorthOf(e);
  if (!isNum(qty) || !isNum(declared) || !isNum(tradePrice)) return null;
  const computed = qty * tradePrice;
  const gap = declared - computed;
  if (Math.abs(gap) <= reconTol(computed, declared)) return null;
  return { entryKey: entryKey, code: 'reconcile', computed: computed, declared: declared, gap: gap };
}

// 一个条目的**指认键**（本层自己的一份口径，全仓原先没有这个概念）：
// `id` 优先，没有 `id` 才用 `label`（老条目 / 手写夹具里常有只给了名字的）。
// ⚠️ 拿它当**索引**用（`rows` / `problems` 里那一格），也当 `findEntry` 的匹配面。
function entryKeyOf(entry, index) {
  const e = isObj(entry) ? entry : {};
  const id = str(e.id).trim();
  if (id) return id;
  const label = str(e.label).trim();
  if (label) return label;
  return '#' + String(index);
}

// 条目声明的市值（§2.2 / §3.8 右边那一项）：**只认 `stock.worth`**（认不出回 NaN）。
// ⚠️ 不回落 `state` 里那个计价字段：那是 `normalizeItem` 那一趟的事（`itemWorth`），
//    入口层再算一遍就是第二份口径。
function declaredWorthOf(entry) {
  const e = isObj(entry) ? entry : {};
  const stock = isObj(e.stock) ? e.stock : {};
  if (!hasOwn(stock, 'worth')) return NaN;
  return num(stock.worth);
}

// ============================================================================
// ★ 负债 / 透支判定格 `holding.overdrawn`（G3 修复轮 · 复审 Important-3 / G3-D2）
// ============================================================================
// 规格：`§3.9 :260`（设计文档）——「条目变负数：**允许**，但面板与投影都**必须显式标**
//       「负债 / 透支」」，与 `§3.8 :255`（不静默修正）同族：负数**不许夹 0**（本层一个字都不夹，
//       见 `buyHolding` 的注释），但**必须带格**。在此之前本层能给出的唯一信号是 `reconcile`
//       —— 它说的是"数量 × 现价 ≠ 声明市值"，那是**另一件事**（一条正常对上的持仓也可能变负）。
//
// ★ 为什么由**本层**写、而不是面板自己判 `declared < 0`（控制者裁定）：
//   `§11 第 1 条 :1092`（单一来源）—— 面板自判就是**第二份口径**（面板、投影、将来的结算
//   各判一次，迟早分叉）。`ownerLost` / `defaultedFields` 已经是同一形状的"引擎判定格"先例：
//   引擎判一次、写进条目形状，读侧只**消费**。
// ★ 为什么判据要**同时看两个格**：`qty < 0`（数量透支）**或** 声明市值 `stock.worth < 0`
//   （账面倒挂，实测就是"没先重估就卖光"那条路：`worth = -132000`）。
//   ⇒ 它跨 `holding.qty` 与 `stock.worth` 两个格，所以判不了在 `core.normalizeHoldingCell`
//   （那一处只看得到 `holding` 这一格）；本函数是**唯一写者**，三条写路都调它。
//
// ★ 三条纪律（逐条照 `ownerLost`：`asset-core.js:668-676` 与 `auditOwnership:1400/1412/1431`）：
//   ① **只认字面量 `true`**（认不出的一律当没标）：白名单那一侧的尺子在
//      `asset-core.js` 的 `normalizeHoldingCell` 里，本处只负责**写下** `true`；
//   ② **回正 ⇒ 摘掉那一格**（`delete`，**不是写 `false`**）：与 `auditOwnership` 摘过期
//      `ownerLost` 同一条理由 —— 写 `false` 会让"读一遍再读一遍逐字相同"当场不成立
//      （白名单不铺 `false` ⇒ 产物里是 `{}`，与原文的 `{overdrawn:false}` 不 deepEqual）；
//   ③ **没有这一格时连键都不写**：回正这条路走 `delete`，从不落 `false` / `undefined`。
//
// ⚠️ **判据算不出来时保持原判定**（`worth` 认不出、数量认不出 ⇒ 不动那一格）：
//    "算不出来"不等于"正常了" —— 与铁律 6（不可估值就明说、不编数字）同一把尺子。
//    但**数量为负**这一条永远判得出来（它是本格自己的数），所以即使没有市值也照样能置位。
function markOverdrawn(cell, declared) {
  if (!isObj(cell)) return cell;                  // 没有持仓格就没有可标的格子（不改一个字）
  const qty = num(cell.qty);
  const worth = num(declared);
  const overdrawn = (isNum(qty) && qty < 0) || (isNum(worth) && worth < 0);
  if (overdrawn) setKey(cell, 'overdrawn', true);
  else if (hasOwn(cell, 'overdrawn')) delete cell.overdrawn;   // ② 回正 ⇒ 摘掉，不写 false
  return cell;
}

// 读侧：这一条现在算不算"负债 / 透支"（**唯一判定口**）。
// ⚠️ 面板 / 投影要标那一档时**读它**（或读条目上那一格），别自己再写一份 `declared < 0`。
// 回 `true` 只有两种来源：条目上带着那一格（引擎已经判过），或**当下**这两个数里有一个是负的
// （重估还没跑过的那一刻 —— 判定口不能比格本身更窄，否则"没跑重估"就看不见负数）。
function isOverdrawn(entry) {
  const e = isObj(entry) ? entry : {};
  const cell = isObj(e.holding) ? e.holding : {};
  if (cell.overdrawn === true) return true;
  const qty = num(cell.qty);
  const worth = declaredWorthOf(e);
  return (isNum(qty) && qty < 0) || (isNum(worth) && worth < 0);
}

// `opts` 里的"行情开没开"：**只认那两个入口**（启用项那一格，或调用方明说的布尔）。
// 判据没给 ⇒ `null` = **不断言**（既不报"此价不再更新"，也不报"这是现价"）。
function marketOnOf(opts) {
  const o = isObj(opts) ? opts : {};
  if (Array.isArray(o.enabledCategories)) return o.enabledCategories.map(str).indexOf(MARKET_CATEGORY) >= 0;
  if (typeof o.marketOn === 'boolean') return o.marketOn;
  return null;
}

// ============================================================================
// ② 读侧：持仓逐条读数（市值 / 盈亏 / 对账 / 停用降级）—— **纯读，什么都不改**
// ============================================================================
// 一行 = 一条**带 `holding` 键**的条目。没有这一格的条目**一条都不进 `rows`**（它不是持仓条目，
// 本层没有它的读数可说）—— 而**带这一格却认不出的**（坏形状）照旧出行：`§7 第 10 条` 要的是
// "算不出盈亏时回 `null` 而不是 0"，那件事必须**看得见**。
//
// ⚠️ 三件"绝不"：**绝不回落 0**、**绝不用成本顶价**、**绝不编数**（铁律 6 / §3.9）：
//    算不出来的一律是 `null` + 一个 `why`。
function holdingRows(entries, opts) {
  const o = isObj(opts) ? opts : {};
  const list = arr(entries);
  const prices = isObj(o.prices) ? o.prices : null;
  const marketOn = marketOnOf(o);
  const rows = [];
  const problems = [];
  if (o.prices == null) problems.push({ entryKey: '', code: 'no-prices', why: '没有拿到价格表' });
  else if (!prices) problems.push({ entryKey: '', code: 'prices-shape', why: '价格表的形状认不出' });
  if (marketOn === null) {
    problems.push({ entryKey: '', code: 'enabled-unknown', why: '没拿到启用项这一格' });
  }
  const stale = marketOn === true ? false : (marketOn === false ? true : null);
  const notice = stale === true ? 'marketOff' : '';   // ★ 出的是**词键**（那一档的话由取词口给）
  for (let index = 0; index < list.length; index++) {
    const entry = list[index];
    if (!isObj(entry)) continue;
    if (!hasOwn(entry, 'holding')) continue;
    const cell = isObj(entry.holding) ? entry.holding : null;
    const symbol = (cell && typeof cell.symbol === 'string') ? cell.symbol.trim() : '';
    const qty = cell ? num(cell.qty) : NaN;
    const cost = cell ? num(cell.cost) : NaN;
    const qtyOk = isNum(qty) && qty >= 0;
    const costOk = isNum(cost) && cost >= 0;
    const declared = declaredWorthOf(entry);
    const entryKey = entryKeyOf(entry, index);
    // 现价：**只从行情状态那一份记录里取**（§5.2 `:635` 的形状 `{lastDate, price, prevPrice}`）。
    // 行情停用时照样读它 —— 那就是 §8.2 要的"显示**最后已知价**"（读数不动、只标 stale）。
    let price = NaN;
    let priceDate = '';
    let priceWhy = '';
    if (!symbol) priceWhy = 'no-symbol';
    else if (!prices) priceWhy = 'no-prices';
    else if (!hasOwn(prices, symbol)) priceWhy = 'no-price';
    else {
      const rec = prices[symbol];
      if (!isObj(rec)) priceWhy = 'bad-record';
      else if (!(isNum(rec.price) && rec.price > 0)) priceWhy = 'bad-price';
      else { price = rec.price; priceDate = str(rec.lastDate).trim(); }
    }
    const marketValue = (qtyOk && isNum(price)) ? qty * price : NaN;
    const pnl = (isNum(marketValue) && costOk) ? marketValue - cost : NaN;
    let why = '';
    if (!symbol) why = 'no-symbol';
    else if (!qtyOk) why = 'no-qty';
    else if (!costOk) why = 'no-cost';
    else if (!isNum(price)) why = priceWhy || 'no-price';
    // §3.8 的对账：**左边算得出来、右边也写了数**才比。不等 ⇒ **报**（`{entryKey, computed,
    // declared, gap}` 逐字就是 brief 要的那一格），**绝不改任何一个数**。
    let gap = NaN;
    if (isNum(marketValue) && isNum(declared)) {
      gap = declared - marketValue;
      if (Math.abs(gap) > reconTol(marketValue, declared)) {
        problems.push({ entryKey: entryKey, code: 'reconcile', computed: marketValue, declared: declared, gap: gap });
      }
    } else if (isNum(marketValue) && symbol && qtyOk && !isNum(declared)) {
      // 左边算得出来、右边那一格**根本没有数**：这是 §3.8 那条等式缺了一半（报出来，不补）
      problems.push({ entryKey: entryKey, code: 'declared-missing', computed: marketValue });
    }
    rows.push({
      entryKey: entryKey,
      index: index,
      symbol: symbol,
      qty: qtyOk ? qty : null,
      cost: costOk ? cost : null,
      declared: isNum(declared) ? declared : null,
      price: isNum(price) ? price : null,
      priceDate: priceDate,
      marketValue: isNum(marketValue) ? marketValue : null,
      pnl: isNum(pnl) ? pnl : null,
      gap: isNum(gap) ? gap : null,
      stale: stale,          // true = 行情停用（此价不再更新）/ false = 行情在跑 / null = 判据没给
      notice: notice,        // 词键（''= 没有话说）
      why: why,              // '' = 盈亏算得出来；其余 = 算不出来的原因码
    });
  }
  return { rows: rows, problems: problems, marketOn: marketOn };
}

// 合计：**只并算得出来的那些行**，并且**只要一行都算不出来就回 `null`**（不回 0 —— 那会把
// "估不出来"印成"值 0"，正是本模块最不该有的东西）。
function sumRows(rows) {
  const t = {
    count: rows.length,
    marketValue: null, cost: null, pnl: null,
    pricedCount: 0, unpricedCount: 0, staleCount: 0,
  };
  for (const r of rows) {
    if (r.marketValue != null) { t.marketValue = (t.marketValue == null ? 0 : t.marketValue) + r.marketValue; }
    if (r.cost != null) { t.cost = (t.cost == null ? 0 : t.cost) + r.cost; }
    if (r.pnl != null) { t.pnl = (t.pnl == null ? 0 : t.pnl) + r.pnl; }
    if (r.pnl == null) t.unpricedCount += 1; else t.pricedCount += 1;
    if (r.stale === true) t.staleCount += 1;
  }
  return t;
}

// 读口（纯读）：市值 / 盈亏 / 对账 / 停用标记。**零存储 / 零 DOM / 零时钟**。
function valueHoldings(entries, opts) {
  const r = holdingRows(entries, opts);
  return { rows: r.rows, totals: sumRows(r.rows), problems: r.problems, marketOn: r.marketOn };
}

// ============================================================================
// ③ 行情结算那一半：**重估只写 `stock.worth`、不产生流水**
// ============================================================================
// §11 第 16 条（`:1126`）与"衰减只重估、不产生流水"是同一族纪律；§5.5 把"行情结算"列为
// 账的三个合法写者之一，且它对账的**唯一**影响方式就是"持仓市值重算"（可解释、可回滚）。
// ⇒ 本函数的回值**没有 `flows` 这一格**（形状上就产不出流水），只回"要落盘的那一份" `entries`。
//
// 三条尺子：
//   · **行情停用 ⇒ 一个数都不写**（§8.2：保留最后已知价，绝不清零市值）——
//     这一趟的 `skipped` 会说得出为什么，`rows` 里逐条带 `stale: true`；
//   · **估值算不出来的条目原样不动**（不回 0、不拿成本顶价）—— 连判定格也一个字不动
//     （"算不出来"不是"正常了"）；
//   · 已经对上的（差值在容差内）**不写**（免得每读一次都改一次盘）。
// ★ 附带的一件：真的写了数的那一条上，顺带重判 `holding.overdrawn`（§3.9 `:260`）——
//   重估**不许**把负数抹平（那是静默修正），但必须让"这个数是负的"**带格**。
function revalueHoldings(entries, opts) {
  const r = holdingRows(entries, opts);
  const out = clonePlain(arr(entries));
  const changed = [];
  const marketOff = r.marketOn === false;
  if (!marketOff) {
    for (const row of r.rows) {
      if (row.marketValue == null) continue;
      const target = out[row.index];
      if (!isObj(target)) continue;
      const needWrite = row.declared == null
        || Math.abs(row.gap) > reconTol(row.marketValue, row.declared);
      if (!needWrite) continue;
      if (!isObj(target.stock)) target.stock = {};
      setKey(target.stock, 'worth', row.marketValue);
      changed.push(row.entryKey);
      // §3.9 `:260` 的判定格：重估把声明市值改了这一格 ⇒ 一并重判（可能置位、也可能摘掉）。
      // ⚠️ **只在真的写了数的那一条上判**（`marketValue == null` 的条目上面已经 `continue`）——
      //    "估不出来"不是"正常了"，那种条目一个字都不许动（含这一格）。
      markOverdrawn(target.holding, declaredWorthOf(target));
    }
  }
  return {
    entries: out,
    rows: r.rows,
    changed: changed,
    problems: r.problems,
    marketOn: r.marketOn,
    skipped: marketOff ? 'market-off' : '',
  };
}

// ============================================================================
// ④ 买卖：两条成对流水 + 账面动作（唯一的写者 = 本层）
// ============================================================================
// ★ 一次买/卖 = **两条流水**，各挂在自己的条目上（`entryId` 指的是"动的是哪一条资产"）：
//     现金条目：`{ direction: 'out', kind: 'cashflow', amount }`（卖的时候是 `in`）
//     持仓条目：`{ direction: 'in',  kind: 'balance',  amount }`（卖的时候是 `out`）
//   两条 `amount` / `at` / `reason` **逐字相同** ⇒ 成对（§11 第 15 条要的那次"显式转出"由
//   这个**成对的第二条**给出）。
//   ⚠️ **现金侧不能写 `transfer`**：`asset-ledger.js:171` 是 `flowSigned(transfer) === 0`
//      ⇒ 用 `transfer` 记现金，现金**根本不会减少**，计划 `:904` 的"现金减"当场不成立。
//      `transfer` 留给 §15.8① （`:1393-1403`）那种**净额为零**的归属转移。
//   ⚠️ ★★ **G3-D1 已修（"去处"格）**：从前这里写着"`to` 那一格在 `out` 上**存不住**"，
//      依据是 `appendFlow` 只在 `isTransfer` 那一支写 `to`。**账本层现已放宽成 `if (to)`**
//      （闸 `:334` 一位不动，转移仍必须有去处）⇒ 本层**改回来**：给每一次买卖的
//      **`out` 那一条**带上 `to = 对面那条条目的 id`（"这笔钱去了持仓" / "这笔持仓换成了现金"）。
//      ⚠️ **`in` 那一条照旧不写 `to`**：方向本身已经说明它是流入，§11 第 15 条只要求
//      "**转出的那一笔**"有去处 —— 两条里恰有一条 `out`，配对的**方向**因此不再靠猜：
//        买入：现金 `out`(`entryId`=现金, `to`=持仓) ↔ 持仓 `in`(`entryId`=持仓)
//        卖出：持仓 `out`(`entryId`=持仓, `to`=现金) ↔ 现金 `in`(`entryId`=现金)
//      ⚠️★ **强度上限（实测，别夸大）**：`to` 补的是"**到哪儿去**"这一格本身（铁律 10 那句
//      话在账本层真的存得住）。它**不**把"同一对条目上连买三笔"分开 —— 那三条 `out` 的
//      (`entryId`,`to`) **本来就相同**（pair 一样）⇒ 那三笔在流水层仍不可逐笔指认
//      （要逐笔指认得等**流水级稳定 id**，账本层至今没有）。见 `test/asset-holdings.test.js` ⑱。
//      ⚠️★ **`to` 的所指（G3-D1 复审 I1 的口径）**：本层写的是**配对条目的 `entryId`** ——
//      **不是**"给人读的名字"。账本层的契约是"`to` = 这笔 `out` 的**对手方**、自由文本、
//      **不许当引用解析**"（`asset-ledger.js` 的 `appendFlow` 那段 ★★★）；升级那一类写者的
//      对手方是**显示名**。⇒ 两类写者的 `to` 都合法，**所指不同是设计**（"改名即断链"那条坑）；
//      消费者不许把它当引用 —— 要指认一律走 `entryId`（买卖要指认配对，就走配对那条流水的）。
//      ⚠️ **只加这一格**：两条流水的 `amount` / `at` / `reason` / `kind` / `direction`
//      与成交额算法**一个字都没动**。
// ★ 账面动作：
//     买入：现金 `stock.worth -= 成交额`；持仓 `holding.qty += n`、`holding.cost += 成交额`、
//           `stock.worth += 成交额`
//     卖出：现金 `stock.worth += 成交额`；持仓 `holding.qty -= n`、`holding.cost -= 结转成本`、
//           `stock.worth -= 成交额`
//   ⚠️ **现金允许变负**（§3.9 `:259-260`：允许为负、必须显式标负债 / 透支，**不许静默修正**）
//      —— 本层一个字都不夹。
//   ⚠️ **为什么 `stock.worth` 走"加/减这一次的成交额"、而不是"数量 × 现价"重写一遍**：
//      两者在"这一条本来就按这个价对过账"时**逐字相等**（`worth == qty × price`），而
//      **不等**的时候只可能是"这一条本来就有一条对账缺口"。重写一遍 = 顺手把那条缺口
//      **静默抹掉**，正是 §3.8 `:255` 点名不许做的事（缺口要照旧留给对账去报）。

// 把一条条目过一遍归一化白名单（`holding` 进 `out`、坏格子按各自的尺子丢、深拷贝）。
// ⚠️ 这一步**不能省**：少了它，产物就是"当场有效、读一遍就失效"的那一类（本模块栽过四次）。
// ⚠️ `orphanFields` 要**把条目自己那一份当底**交进去（`normalizeItem` 的 opts 契约）：否则
//    产物里那个"不丢字段"的兜底袋就要靠 `state` 里还留着那几个键才捡得回来。
function normalizeEntry(C, entry) {
  const e = isObj(entry) ? entry : {};
  const tpl = isObj(e.template) ? e.template : {};
  const opts = { orphanFields: isObj(e.orphanFields) ? e.orphanFields : {} };
  return C.normalizeItem(e, tpl, opts);
}

// 在桶里按**指认键**找一条：0 条 = 找不到；>1 条 = 分不清（**宁可回绝，也不许动错一条**，
// 与 `voidFlow` 的 `LA_ASSET_VOID_TARGET_AMBIGUOUS` 同一条纪律）。
function findEntry(entries, key) {
  const list = arr(entries);
  const hit = [];
  for (let i = 0; i < list.length; i++) {
    if (!isObj(list[i])) continue;
    if (entryKeyOf(list[i], i) === key) hit.push(i);
  }
  if (!hit.length) return { error: 'LA_ASSET_ENTRY_NOT_FOUND' };
  if (hit.length > 1) return { error: 'LA_ASSET_ENTRY_AMBIGUOUS' };
  return { index: hit[0] };
}

// 买 / 卖共用的前半段：账本与两个条目（**归一化的副本**，改它们不会碰到入参那一份）。
function openBooks(input, C) {
  const i = isObj(input) ? input : {};
  const led = i.ledger;
  if (!isObj(led)) return { error: 'LA_ASSET_LEDGER_REQUIRED' };
  const actorKey = str(i.actorKey).trim();
  if (!actorKey) return { error: 'LA_ASSET_ACTOR_REQUIRED' };
  const actors = isObj(led.actors) ? led.actors : null;
  const bucket = (actors && isObj(actors[actorKey])) ? actors[actorKey] : null;
  if (!bucket) return { error: 'LA_ASSET_ACTOR_ABSENT' };
  const entries = arr(bucket.entries);
  const cashKey = str(i.cashEntryKey).trim();
  const holdKey = str(i.holdingEntryKey).trim();
  if (!cashKey) return { error: 'LA_ASSET_CASH_ENTRY_REQUIRED' };
  if (!holdKey) return { error: 'LA_ASSET_HOLDING_ENTRY_REQUIRED' };
  if (cashKey === holdKey) return { error: 'LA_ASSET_ENTRY_SAME' };
  const cashAt = findEntry(entries, cashKey);
  if (cashAt.error) return { error: cashAt.error };
  const holdAt = findEntry(entries, holdKey);
  if (holdAt.error) return { error: holdAt.error };
  const qty = num(i.qty);
  const price = num(i.price);
  if (!(isNum(qty) && qty > 0)) return { error: 'LA_ASSET_QTY_REQUIRED' };
  if (!(isNum(price) && price > 0)) return { error: 'LA_ASSET_PRICE_REQUIRED' };
  const at = str(i.at).trim();
  if (!at) return { error: 'LA_ASSET_DATE_REQUIRED' };
  const reason = str(i.reason).trim();
  if (!reason) return { error: 'LA_ASSET_REASON_REQUIRED' };
  const cashEntry = normalizeEntry(C, entries[cashAt.index]);
  const holdEntry = normalizeEntry(C, entries[holdAt.index]);
  const cashWorth = declaredWorthOf(cashEntry);
  // 没有可读余额的现金条目：这一笔算不出"现金减/加"。**回绝，不把它当成 0**
  // （补出来的默认值不是价 —— 与 `itemWorth` 那条"估不出来"同一把尺子）。
  if (!isNum(cashWorth)) return { error: 'LA_ASSET_CASH_SHAPE' };
  return {
    i: i, actorKey: actorKey, entries: entries, bucket: bucket,
    cashAt: cashAt, holdAt: holdAt, cashKey: cashKey, holdKey: holdKey,
    qty: qty, price: price, amount: tradeAmount(qty, price),
    at: at, reason: reason,
    cashEntry: cashEntry, holdEntry: holdEntry, cashWorth: cashWorth,
    // `entryId` 用**归一化后的 id**（没有 id 的老条目才回落调用方给的指认键）——
    // 流水里的指认要跟着账本走，不能跟着调用方那一次的说法走。
    cashId: str(cashEntry.id).trim() || cashKey,
    holdId: str(holdEntry.id).trim() || holdKey,
  };
}

// 把两个条目写回账本、再走账本层的唯一写者记两条流水（顺序：**先现金、后持仓** ⇒ 两条相邻）。
function closeBooks(L, b, cashFlowIn, holdFlowIn) {
  const led = b.i.ledger;
  const base = L.flatten(led);                       // 深拷贝（入参一个字不动）
  const nextEntries = arr(b.entries).slice();
  nextEntries[b.cashAt.index] = b.nextCash;
  nextEntries[b.holdAt.index] = b.nextHold;
  setKey(base.actors, b.actorKey, L.copyKeys(b.bucket, { entries: nextEntries }));
  const step1 = L.appendFlow(base, cashFlowIn);
  if (step1.error) return { error: step1.error };
  const step2 = L.appendFlow(step1.ledger, holdFlowIn);
  if (step2.error) return { error: step2.error };
  return { ledger: step2.ledger, flows: [step1.flow, step2.flow] };
}

// 买入：`(ledger, actorKey, cashEntryKey, holdingEntryKey, qty, price, at, reason[, symbol])`
//   → `{ ledger, entry, cashEntry, flows, trade, problems }` / `{ error }`
// ⚠️ **持仓条目必须已经存在**：§7.4 #6 把"新增一条资产"与"改已有余额"定成**两个显式动作**，
//    所以本函数**不建条目**（建条目是 `createEntry` 那一趟）。条目第一次买入时它身上还没有
//    `holding` 这一格，那就**从这一笔起算**（数量 = n、成本 = 成交额）。
function buyHolding(input) {
  const L = resolveLedger();
  const C = resolveCore();
  if (!L || typeof L.appendFlow !== 'function' || typeof L.flatten !== 'function' || typeof L.copyKeys !== 'function') {
    return { error: 'LA_ASSET_LEDGER_REQUIRED' };
  }
  if (!C || typeof C.normalizeItem !== 'function') return { error: 'LA_ASSET_CORE_REQUIRED' };
  const b = openBooks(input, C);
  if (b.error) return { error: b.error };
  const prev = isObj(b.holdEntry.holding) ? b.holdEntry.holding : null;
  let symbol = str(b.i.symbol).trim();
  const problems = [];
  if (prev) {
    const cellSymbol = (typeof prev.symbol === 'string') ? prev.symbol.trim() : '';
    // 认不出标的的持仓格：数量与成本算不出来 ⇒ **回绝**（不静默按"没有持仓"重起算）
    if (!cellSymbol) return { error: 'LA_ASSET_HOLDING_SHAPE' };
    if (symbol && symbol !== cellSymbol) return { error: 'LA_ASSET_SYMBOL_MISMATCH' };
    symbol = cellSymbol;
  }
  if (!symbol) return { error: 'LA_ASSET_SYMBOL_REQUIRED' };
  const qtyOld = prev ? num(prev.qty) : 0;
  const costOld = prev ? num(prev.cost) : 0;
  if (prev && !(isNum(qtyOld) && qtyOld >= 0)) return { error: 'LA_ASSET_HOLDING_SHAPE' };
  if (prev && !(isNum(costOld) && costOld >= 0)) return { error: 'LA_ASSET_HOLDING_SHAPE' };
  const declared = declaredWorthOf(b.holdEntry);
  // 这一条本来有持仓、却没有声明的市值 ⇒ §3.8 的右边缺一半：**报出来**（就在下面的 problems 里）
  if (prev && !isNum(declared)) problems.push({ entryKey: entryKeyOf(b.holdEntry, b.holdAt.index), code: 'declared-missing' });

  // ---- 持仓条目：数量 += n、成本 += 成交额、市值 += 成交额（见本节开头那条 ⚠️）----
  // ⚠️ `openBooks` 交过来的两条**已经是归一化的副本**（不与入参共用引用）⇒ 就地改它们，
  //    改完再过一遍归一化白名单（`holding` 那一格必须过 `normalizeItem` 才算落成）。
  //    ★ **这一趟不是"双跑"，而且删不得**（G3 复审 G3-7 建议"要么删、要么加一句注释"⇒ 照办注释）：
  //      复审说它"冗余"的那一半是**对的** —— `closeBooks`（`:441` `L.flatten(led)`）与
  //      `asset-core.js:401` 的 `flatten` **还会再归一化一次**，所以它不改**落盘产物**。
  //      但本函数的**回值** `{ entry, cashEntry }` 直接交的是这两份：删掉这一趟，
  //      `r.entry` / `r.cashEntry` 就会退回"当场有效、写进账本读一遍就变"的形状
  //      （本模块栽过四次的那个类）。**归一化在这里的职责不是"修账"，是"回值形状"** ——
  //      回值是要给调用方看/继续用的那一份，形状必须与落盘那一份同形。
  b.nextHold = b.holdEntry;
  setKey(b.nextHold, 'holding', nextHoldingCell(prev, symbol, qtyOld + b.qty, costOld + b.amount));
  if (!isObj(b.nextHold.stock)) b.nextHold.stock = {};
  setKey(b.nextHold.stock, 'worth', isNum(declared) ? declared + b.amount : b.amount);
  b.nextHold = normalizeEntry(C, b.nextHold);
  // §3.9 `:260` 的判定格（负债 / 透支）：这一笔之后账面若是负的（含"从负的买回来"）⇒ 置位 /
  // 摘掉。⚠️ 判在**归一化之后**、判据读的是**落成的那两个数**（`holding.qty` 与
  // `stock.worth`），写完**再过一遍白名单**（`normalizeEntry` 幂等，且它按 ⑤ 原样带上
  // `overdrawn`）—— 两趟归一化是**故意的**：第一趟把数落成、第二趟把判定格落成。
  markOverdrawn(b.nextHold.holding, declaredWorthOf(b.nextHold));
  b.nextHold = normalizeEntry(C, b.nextHold);
  // ---- 现金条目：余额 -= 成交额（**允许为负，不夹**）----
  b.nextCash = b.cashEntry;
  if (!isObj(b.nextCash.stock)) b.nextCash.stock = {};
  setKey(b.nextCash.stock, 'worth', b.cashWorth - b.amount);
  const gapAfter = tradeGap(entryKeyOf(b.nextHold, b.holdAt.index), b.nextHold, b.price);
  if (gapAfter) problems.push(gapAfter);

  // 现金侧那条 `out` 带**去处**（`to` = 持仓条目 id，"这笔钱去了持仓"）；持仓侧的 `in` 不带
  // （方向已说明流入，§11 第 15 条只要求转出的那一笔有去处）⇒ **成对的两条里恰有一条带 `to`**。
  // ⚠️ 这里的"唯一"只说**条数**（不是两条都带）—— 它**不**说"同一对条目上的多笔能逐笔分开"
  //    （那些 `to` 恒同，见本节开头那条 ★★ 的强度上限）。见本节开头那条 ★★。
  const closed = closeBooks(L, b,
    { actorKey: b.actorKey, direction: 'out', kind: 'cashflow', amount: b.amount, at: b.at, reason: b.reason, entryId: b.cashId, to: b.holdId },
    { actorKey: b.actorKey, direction: 'in', kind: 'balance', amount: b.amount, at: b.at, reason: b.reason, entryId: b.holdId });
  if (closed.error) return { error: closed.error };
  return {
    ledger: closed.ledger,
    entry: b.nextHold,
    cashEntry: b.nextCash,
    flows: closed.flows,
    trade: { symbol: symbol, qty: b.qty, price: b.price, amount: b.amount },
    problems: problems,
  };
}

// 卖出：同族一起做（加权平均结转成本，卖光时 `cost` 归零；条目**保留**）
//   → `{ ledger, entry, cashEntry, flows, trade, realized, problems }` / `{ error }`
// ⚠️ **结转成本按加权平均** `costOut = cost × (n / qty)`；**不许写 `cost -= 成交额`**
//    （那会把"卖赚了"记成成本下降，盈亏口径当场分叉）。卖光时 `costOut = 整数份成本`、
//    `cost` 归零（§3.9 `:259`：条目保留、不自动删）。
// ⚠️ 卖超（`n > 持有的数量`）**回绝**：本模块没有做空那一档，静默记成负持仓是把账记坏。
function sellHolding(input) {
  const L = resolveLedger();
  const C = resolveCore();
  if (!L || typeof L.appendFlow !== 'function' || typeof L.flatten !== 'function' || typeof L.copyKeys !== 'function') {
    return { error: 'LA_ASSET_LEDGER_REQUIRED' };
  }
  if (!C || typeof C.normalizeItem !== 'function') return { error: 'LA_ASSET_CORE_REQUIRED' };
  const b = openBooks(input, C);
  if (b.error) return { error: b.error };
  const prev = isObj(b.holdEntry.holding) ? b.holdEntry.holding : null;
  if (!prev) return { error: 'LA_ASSET_HOLDING_EMPTY' };
  const cellSymbol = (typeof prev.symbol === 'string') ? prev.symbol.trim() : '';
  if (!cellSymbol) return { error: 'LA_ASSET_HOLDING_SHAPE' };
  let symbol = str(b.i.symbol).trim();
  if (symbol && symbol !== cellSymbol) return { error: 'LA_ASSET_SYMBOL_MISMATCH' };
  symbol = cellSymbol;
  const qtyOld = num(prev.qty);
  const costOld = num(prev.cost);
  if (!(isNum(qtyOld) && qtyOld >= 0)) return { error: 'LA_ASSET_HOLDING_SHAPE' };
  if (!(isNum(costOld) && costOld >= 0)) return { error: 'LA_ASSET_HOLDING_SHAPE' };
  if (b.qty > qtyOld) return { error: 'LA_ASSET_SELL_EXCEEDS_HOLDING' };
  const declared = declaredWorthOf(b.holdEntry);
  // 卖一笔**没有声明市值**的持仓：现金加了钱、而账面那一边减不掉 ⇒ 总数会凭空多出来一块。
  // **回绝**（不是"顺手把市值当成交额"）：这一档的账算不平，宁可让调用方先把这一条估上。
  if (!isNum(declared)) return { error: 'LA_ASSET_HOLDING_SHAPE' };

  const soldOut = b.qty >= qtyOld;
  const costOut = soldOut ? costOld : costOld * (b.qty / qtyOld);
  const realized = b.amount - costOut;

  b.nextHold = b.holdEntry;
  setKey(b.nextHold, 'holding', nextHoldingCell(prev, symbol, qtyOld - b.qty, soldOut ? 0 : costOld - costOut));
  if (!isObj(b.nextHold.stock)) b.nextHold.stock = {};
  setKey(b.nextHold.stock, 'worth', declared - b.amount);
  b.nextHold = normalizeEntry(C, b.nextHold);
  // ★ **这一条正是 `-132000` 那一档的来源**（没先重估就卖光 ⇒ 账面倒挂）：判定格在这一路置位 ——
  //   "负数带格、不再是**无标记的负数**"。⚠️ 本层照旧**一个字都不夹**（不把它夹回 0），
  //   也**不动卖出流程**（复审 §3.3 已判"卖出保留并报出"通过 ⇒ 不许加"卖出前自动重估"）。
  markOverdrawn(b.nextHold.holding, declaredWorthOf(b.nextHold));
  b.nextHold = normalizeEntry(C, b.nextHold);
  b.nextCash = b.cashEntry;
  if (!isObj(b.nextCash.stock)) b.nextCash.stock = {};
  setKey(b.nextCash.stock, 'worth', b.cashWorth + b.amount);
  const problems = [];
  const gapAfter = tradeGap(entryKeyOf(b.nextHold, b.holdAt.index), b.nextHold, b.price);
  if (gapAfter) problems.push(gapAfter);

  // 这里**转出的是持仓那一条 `out`** ⇒ `to` 挂在它身上（= 现金条目 id，"这一笔持仓换成了现金"），
  // 现金侧那条 `in` 不带。与买入同一把尺子：**两条里恰有一条 `out` 带 `to`** ⇒ 配对的方向不再靠猜
  // （"唯一"指**条数**；同一对条目上多笔的 `to` 恒同 ⇒ 不提供逐笔身份，见本节开头那条 ★★）。
  const closed = closeBooks(L, b,
    { actorKey: b.actorKey, direction: 'in', kind: 'cashflow', amount: b.amount, at: b.at, reason: b.reason, entryId: b.cashId },
    { actorKey: b.actorKey, direction: 'out', kind: 'balance', amount: b.amount, at: b.at, reason: b.reason, entryId: b.holdId, to: b.cashId });
  if (closed.error) return { error: closed.error };
  return {
    ledger: closed.ledger,
    entry: b.nextHold,
    cashEntry: b.nextCash,
    flows: closed.flows,
    trade: { symbol: symbol, qty: b.qty, price: b.price, amount: b.amount, costOut: costOut, realized: realized },
    realized: realized,
    problems: problems,
  };
}

// ============================================================================
// 对外接口
// ============================================================================
// 挂载点与 terms / library / market / ledger / core 同一族：真机上本文件在 `asset-core.js`
// **之后**、`asset.script.js` 之前执行（`scripts/build-artifact.js` 的 `sources` 里的位置才是权威），
// 调用方从 `window.parent.__LA_ASSET_HOLDINGS__` 取。
const api = {
  // 行情停用判据那一格（`enabledCategories` 里的那个 id）—— 调用方要判"行情开没开"时**读它**，
  // 别处不许再写第二个字面量（§11 第 1 条：启用项单一来源）。
  MARKET_CATEGORY,
  buyHolding,
  sellHolding,
  valueHoldings,
  revalueHoldings,
  // 负债 / 透支的**唯一判定口**（§3.9 `:260`）：面板与投影要标那一档时读它，
  // 别自己再写一份 `declared < 0`（§11 第 1 条：单一来源）。条目上那一格
  // （`holding.overdrawn`）是引擎落下来的判定，本口把它与"还没跑过重估的那一刻"一起答了。
  isOverdrawn,
  // 指认键（`rows` / `problems` 里那一格用的就是它）：面板要"从一行跳到那一条"时读同一份。
  entryKeyOf,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  rt.__LA_ASSET_HOLDINGS__ = api;
}

})();

  return module.exports;
})();
