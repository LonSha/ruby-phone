/* ========================================================
 * asset-market.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-market.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-library.js、../../util/calendar-grid.js、./asset-keys.js
 * 【上游定位】asset-market.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-library.js';
import __assetDep1 from './calendar-grid.js';
import __assetDep2 from './asset-keys.js';

const __REQ = {
    './asset-library.js': () => __assetDep0,
    '../../util/calendar-grid.js': () => __assetDep1,
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
/* src/modules/asset/asset-market.js */
'use strict';

// ============================================================================
// 资产模块 · 行情确定性游走 + 一天一次守卫（批次 G2 · 设计文档 §5.2 / §5.3）
// ----------------------------------------------------------------------------
// 接口（计划 `docs/superpowers/plans/2026-09-17-asset-module.md:898`）：
//     `advanceMarket(state, { today, base })` —— **纯函数**：入参 `state` 一个字都不改，
//     要落盘的那一份在回值的 `state` 里（写盘归 `asset-store.js` 的唯一写门）。
//
// ★★ 三条硬不变量（本任务的成败只在这三条）：
//   ① **同一个 `(标的代码, 日期)` 什么时候算都是同一个数**：日游走因子的种子**只由
//      `代码|日期` 拼出来**，不依赖调用时机、不依赖已经算过多少天、**更不依赖上一次的价格**
//      （§10.3 那张"逐日 N 次 / 直接跳到 dN"的对照就是拿这个当契约）。
//   ② **补推 N 天 == 逐天推进 N 次**：两条路走的是**同一串日因子、同一个日序**，而且
//      **每一步乘法都在同一个位置**（本层没有任何"按整段合并"的算式）⇒ 最终 `state` 逐字相同。
//   ③ **`today` 拿不到 ⇒ 不推进、不写 `lastAt: ""`**（§5.3 `:651` 点名的那个坑，
//      `medical-store.js:351-358` 的注释记着它）。⚠️ 与那边**刻意不同**：那边是**显示**口径
//      （拿不到剧情日期就按系统日期显示"今天是哪天"），本层要**动价格**。
//      **动账不许编日子** ⇒ 拿不到就**拒绝推进**，**绝不读系统时钟**兜底
//      （源码里一个 `Date.now` / 无参 `new Date()` 都没有；测试里把时钟堵死照样算得对）。
//
// ★★★ §11.3 第 1 句的**口径裁定**（控制者 2026-09-19 裁；G2 修复轮落成针脚 —— 原文照抄）：
//   **§11.3 第 1 句的落地形态** = `dayFactor(代码, 日期, 波动档)` **是这三个入参的纯函数** ——
//   同一个 `(代码, 日期)` 在**任何时候、任何调用顺序、任何累计状态下算出的因子逐位相同**；
//   **价格不是 `(代码, 日期)` 的纯函数**，它是"该标的**记录价**沿日序累乘"的结果
//   （锚点口径：§3.7 尾表 / §11.13 / §8.1）。**"两个不同起点 ⇒ 同一天价格相同"这句话对本模块不成立**
//   （它要求编造历史）。§11.3 的第 2 句（补推 == 逐天）不受影响，仍由 ② 钉住。
//   ⇒ 设计文档在这一点上自相矛盾：§5.3 `:645` 的公式与 §11.3 `:1094` 第 1 句读得成"绝对纪元锚点"，
//     而 §11.13 `:1109` / §3.7 尾表 `:241` / §8.1 读得成"每只标的自己的记录价锚点"；
//     **两者在同一个实现里不可能同时为真**（首次开启若按字面实现，`today='2026-11-15'` 就必须
//     `walkedDays=99`，而 §11.13 要求 0）⇒ 以更具体、更晚定案的那一侧为准。
//     ⚠️ 钉它的针脚在 `test/asset-market.test.js` 的「§11.3 第 1 句 · 因子」那一条（规范黄金值 +
//     与调用历史无关 + 与标的表组成无关）。
//
// 本层自定的口径（选与不选的理由写在报告，代码旁各留一句）：
//   · **锚点是每只标的自己那条记录价**（§3.7 尾表 / §11.13：`prices` 为空 ⇒ **只起算不补算**；
//     有历史、停过一段 ⇒ **按日历补推**那段，§8.1）。所以价格**不是"日期的纯函数"**，
//     而是"从那只标的的记录价出发，把 `(lastDate, today]` 里**每一天**的因子按日序乘一遍"。
//     ⇒ 不变量 ② 由构造保证（两条路同一串因子、同一顺序）；"两个不同的**起点**只要落在
//     同一条游走路径上就同结果"这件事由 ② 的对拍针脚钉住。
//   · **不四舍五入**：取整是**显示口径**（面板 / 金额格式化那一层的事）。逐日取整会把
//     0.005/日 的砂子累进价格（对 7.2 元一档的标的是真实的漂移 = 给价格编数），
//     而且会让"同一窗口、不同起始价 ⇒ 价格**逐位**成比例"这条最强的 ① 针脚当场失效。
//   · **§5.4 大盘系数 / §5.7 正文覆盖：H1（0.7.65）起本版做了**（从前那一段注释写着"本版不做"
//     —— 那说的是 G2 那一版）。现在的形状见本文件下半的 ★★★ H1 那两块：
//     ① **绝对重放锚点** `prices[code].anchor = { d, p }`（起算日 / 起算价，**永不被改写**）；
//     ② 重放公式 `price = anchor.p × Π(日因子 × 大盘系数 × 覆盖)` + `replayMarket` 全量重算。
//     ⇒ 「撤掉那条系数记录 ⇒ 价格回原」是**重放**的结果，不是"再乘一次逆系数"的近似。
//     ⚠️ 本层现在**读** `marketMood` / `marketOver` / `notes` 三格了（从前只原样带过）；
//        写它们仍然只走本层的四个时间轴写者（`setMoodRecord` / `removeMoodRecord` /
//        `setOverride` / `removeOverride` / `addNote`），**不碰价格**。
//   · 依赖只有两层，都在构建清单里更靠前：`src/util/calendar-grid.js`（裸日期的唯一工具层：
//     校验过的 `parseKey` / 加一天 `addDays` / 天数差 `dayDiff` —— 本层不再写第三份日历算术）
//     与 `asset-library.js`（波动档的幅度倍数 `VOLS[].mult`，那一层 `:56` 写的就是"G2 直接乘"）。
//     两层都取不到 ⇒ **拒绝推进**（不当成"没波动"硬算）。
//
// ⚠️ 本文件里不许出现面板结构词的字面量（`test/asset-terms.test.js` ③ 会扫这个目录的每个源文件），
//    也不许出现「重试 / 未就绪 / 不一致 / 失败」（`test/asset-panel.test.js` 的 E2 扫描面含新文件）。
// ============================================================================

// ---- 依赖口：同族的更前面那一层（真机走 `window.parent` 的全局，Node 走 require）----
// ⚠️ **惰性取**（每次调用时解析）：真机上是 bundle 拼接，调用发生时全局一定已经挂好；
//    而"没挂好"这件事本层要能**拒绝**，不能静默按一份缺省算（那会给出没波动 / 少了一档的价格）。
function resolveLibrary() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-library.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_LIBRARY__) || null;
}
function resolveGrid() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('../../util/calendar-grid.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_CALENDAR_GRID__) || null;
}
// 键写入原语（批次 G2 第 2 轮提成共享原语）：本文件从前自带一份 `setKey`，
// 现在资产块里**只有 `asset-keys.js` 那一份**（它在 `sources` 里排在本文件之前）。
// ⚠️ **惰性取、取不到就拒绝**：静默按"没有这份原语"往下走会让键写入退回裸赋值 ——
//    那正是这一族缺陷的形状。所以取不到时本层要能挡下（见 `advanceMarket` 的两道依赖闸）。
function resolveKeys() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-keys.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_KEYS__) || null;
}

// ---- 小工具（与 core / settlement 同一套口径；不导出）----
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return v == null ? '' : String(v); }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
// 用户数据当键的 map：**赋值要防原型穿透**（G1 复审 N1/N2 的同一类：
// `m['__proto__'] = x` 是**改原型**而不是加一格，`Object.keys` 会当场少 1）。
// ⇒ 这一份写入原语**已经提成共享的 `asset-keys.js`**（本文件从前自带一份，现在只留那一份）。
//    `Object.create(null)` 也防穿透，但它换掉原型 ⇒ 只给"无原型依赖"的位置用
//    （那些位置**当场直接写 `Object.create(null)`**；G2AB 收口轮删掉了从前那个 null 原型 helper）。
function setKey(o, k, v) {
  const K = resolveKeys();
  if (K && typeof K.setKey === 'function') return K.setKey(o, k, v);
  // 取不到共享原语时**不许退回裸赋值**（那正是这一族缺陷的形状）⇒ 本文件自带一份等价的兜底，
  // 两条路写的是同一件事：只特判 `__proto__`（造自有可枚举格），其余照常。
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  else o[k] = v;
  return o;
}
// 深拷贝（只认普通对象 / 数组：state 是聊天变量里那份 JSON 形状）。
// 目的是**纯函数**：回值里没有任何一格与入参共用引用（改结果 ≠ 改入参）。
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
// ① 确定性游走因子 —— 种子**只由 `代码|日期` 拼出来**
// ----------------------------------------------------------------------------
// PRNG 选型：FNV-1a 32 位字符串哈希 + mulberry32（与本仓 medical-core / delivery-core
// **同一族写法**，但**本文件自带一份**，理由两条：
//   · 行情价格的字节级结果**不许跟着另一个模块的 PRNG 实现走** —— 那边改一次哈希常数或
//     取整方式，全部历史价格会当场变成另一串数（"逐分逐厘可复现"是 §5.3 的承诺）；
//   · 真机加载顺序会让跨模块依赖变成隐式契约（asset 与 medical 不是一个族，谁先谁后
//     今天是清单说了算，明天改一行清单这条依赖就断了，而它是**静默**断的）。
//   ⇒ 复用"同一套算法"，不复用"另一个模块的那个函数"。
// ============================================================================
function hashSeed(text) {
  let h = 0x811c9dc5;                       // FNV-1a offset basis
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);           // FNV prime（Math.imul 保证 32 位回绕）
  }
  return h >>> 0;
}
function mulberry32(a) {
  let x = a >>> 0;
  return function () {
    x = (x + 0x6D2B79F5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 同种子 ⇒ 同序列（导出：后续批次（裁判 / 面板）要对"同一个 (代码,日期) 该是什么"说话时，
// 必须走**这一份**，别处不许再写一个 PRNG —— 那会让两处各算一份"同一件事"。）
function seededRng(seed) { return mulberry32(hashSeed(seed)); }

// 中波一档（`MID`）的**日幅度上限**：±2%。四档的实际幅度 = 这个数 × `VOLS[vol].mult`
// （低波 0.6 / 中波 1.0 / 高波 1.8 / 极高 3.0，唯一一份在 asset-library.js）。
const DAY_AMP = 0.02;
const VOL_OF_DEFAULT = 'MID';

// ============================================================================
// ★ I1（0.7.64）· **每日收盘序列**（`prices[code].closes`）
// ----------------------------------------------------------------------------
// 为什么要加（现场侦察结论，见 `task-I1-report.md` §1）：行情状态每只标的只存
// `{ lastDate, price, prevPrice }`（下一行就是它的三格）——**没有窗口内每天的价**。
// 而 §5.9 的行情投影要两样东西：**趋势综述**（窗口内涨没涨）与**近 N 日波动最大者**
// （相对排名，N = 7，用户 2026-09-20 拍定）——两者都只能在"窗口内每天一个价"上算。
// 设计文档 **§12 第 7 条**（`:1140`）已预授权：「走势图…前置是**价格历史**。
// 第一版**只保留每日收盘序列**（够画折线）」⇒ 本层落地形态就是它。
//
// 形状：`closes: [{ d: 'YYYY-MM-DD', p: <价> }, …]`，**按日序递增**（不看日期也能当队列用）。
//   · `d` 与 `p` 都只由**同一个 `advanceMarket` 日序**产生 —— 日因子是 `(代码, 日期)` 的纯函数，
//     所以序列与"逐天推进"那一条路**逐字相同**（不变量 ② 扩到序列，针脚在
//     `test/asset-market.test.js` 的「② 对拍 · closes」那一条）。
//   · **cap = 30 天**：够 N+1 = 8 也够以后画折线（§12 第 7 条），超上限**丢最旧**
//     （`slice(-CAP)`：留最近的那一段，趋势看的就是最近）。
//   · **降级读**（`closesOf`）：老聊天里那三格没有这一格 ⇒ 回**空数组**，
//     **不抛、不要求迁移、不补造历史**（照 `asset-store.js` / `asset-ledger.js` 那一族的纪律）。
//     空数组之后第一次推进时才用"记录点 `{d: lastDate, p: price}`"把序列**起头**
//     （那是记录里**本来就写着**的那一天，不是编出来的日子）。
//   · 序列**只增不改**：写入侧每一格都来自当天的乘法结果，读侧一个字节都不修。
// ============================================================================
const CLOSES_CAP = 30;

// 读数：`prices[code]` 那一格里的收盘序列（**降级读**）。
//   · 不是对象 / 没有 `closes` / `closes` 不是数组 ⇒ 空数组（老聊天那一档）；
//   · 逐条只认 `{ d: 非空字符串, p: 有限正数 }`，坏条目**丢掉**（不修、不猜、不补一个 p）；
//   · 回的是**新数组**（调用方改它不会动到入参那一份）。
// ⚠️ 写侧与本函数是"同一份形状"的**唯一出处**：投影层要读序列时也只许走这一份
//    （`asset-project.js` 从 `__LA_ASSET_MARKET__` 取它，不另写第二份读法）。
function closesOf(rec) {
  if (!isObj(rec)) return [];
  const list = rec.closes;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    if (!isObj(it)) continue;
    const d = str(it.d).trim();
    const p = it.p;
    if (!d || !isNum(p) || p <= 0) continue;
    out.push({ d: d, p: p });
  }
  return out;
}

// ============================================================================
// ★★★ H1（0.7.65）· §5.4 大盘情绪系数 + **绝对重放锚点**（本任务最重的一块）
// ----------------------------------------------------------------------------
// 设计文档 §5.4（`:654-661`）三条承诺：
//   ① 正文一句话 = **一条记录**（不写 N 条）⇒ `marketMood` 是**按日**的一张表，一项一天；
//   ② **可解释** ⇒ 每条带 `reason`（正文那半句）/ `floor`（哪一层）；
//   ③ **可回滚：撤掉那条系数记录，全部价格回原**。
//
// ★★ ③ 为什么**只能**靠"把系数当成重放的输入"来做（不能"乘一次逆系数"）：
//   "在现值上再乘一次逆系数"是近似 —— 浮点乘除的舍入不可逆（`(p·k)/k !== p` 在
//   一般情形下逐位不等），而且它**不满足"回原"的字面承诺**：撤掉记录之后的价格必须
//   与"那条记录**从未存在过**"的价格**逐位相同**。唯一的做法是让价格成为
//   （锚点 / 日因子 / 系数 / 覆盖）的**纯函数**，撤记录之后**从头重放**。
//
// ★★★ **不变量（写死在这里；`test/asset-market.test.js` 的「H1 重放」那几条钉着它）**：
//
//     price(code, d) = anchor.p                              当 d == anchor.d
//                    = anchor.p
//                    × Π_{t = anchor.d + 1 … d}  stepFactor(code, t)
//
//     stepFactor(code, t) = dayFactor(code, t, 波动档)
//                         × (1 + mood(t))          ← 大盘系数；没有那一天的记录 ⇒ ×1
//                         → 若 (code, t) 有正文覆盖 ⇒ 那一天的价按覆盖取
//
//   ★ **锚点** `anchor = { d, p }` = **起算日与起算价**（`p` 是基准价）。
//     ⚠️ **起算日那一天的价** = `startPriceOf(anchor.p, …, overMap)`：那一天若有覆盖就取覆盖
//     （锚点日自己不在上面那个乘积里 ⇒ 不这样处理的话，"今天首次起算 + 今天给了价"会静默失效）。
//     `startPriceOf` 是**两条路共用的纯函数** ⇒ 这一条不影响"重放 == 逐天"。
//
//   其中 `anchor = { d, p }` 是这只标的的**绝对重放锚点**：**起算日与起算价**。
//   `mood(t)` = `marketMood` 里 `date === t` 的那条记录的 `factor`（同一天有多条 ⇒
//   **后写的说了算**，见 `moodsOf`）。
//
//   ⇒ **推论 1（可回滚）**：撤掉（或改掉）某一天的系数记录之后重放，得到的价就是
//     "那条记录从未存在过"的价 —— 逐位相同，不是"接近"。
//   ⇒ **推论 2（路径无关）**：一次性重放 == 逐天推进（两条路走的是**同一个 `stepPrice`**，
//     浮点乘法在**同一个位置、同一个次序**发生 ⇒ 逐位相同）。
//   ⇒ **推论 3（锚点不许被改写）**：`advanceMarket` 只往前乘、**绝不重写 `anchor`**；
//     锚点一旦立下就是价格序列的地基。**记录价 / 现值都是它的派生**。
//
// ★ 锚点在哪一步建立 / 老聊天怎么降级：
//   · **首次开启（从没见过这只标的）**：锚点 = `{ d: today, p: 基准价 }` —— 与 §3.7 尾表 /
//     §11.13「只起算、不补算」同一条：**不把过去的日子补走**（那是编造历史）。
//   · **老聊天（记录里只有 `{ lastDate, price, prevPrice }`、没有 `anchor`）**：
//     **就地立锚** = `{ d: 记录里写着的那一天, p: 记录里写着的那个价 }`（`anchorOf` 回 null
//     ⇒ 调用方用 `degradedAnchorOf(rec)` 取这一份）。
//     ⚠️ **明说**：`lastDate` **之前**的历史**无法追溯** —— 系统从没记过那些天的日因子输入，
//     重放只能**从 `lastDate` 起**。**不许假装能追溯**：本层不补造更早的日子、不反推基准价。
//   · **补推的起点**：同上 —— 锚点日就是起点日的那个记录点（首次那一天的 `today`）。
//
// ★ 重放的成本（brief §2 点名要回答的）：
//   `dayFactor` 是 `(代码, 日期, 波动档)` 的纯函数 ⇒ 从锚点重算是 **O(天数) 次乘法**。
//   · **热路径（每次推进）**：`advanceMarket` 走**增量** —— 只乘 `(记录日, today]` 那几天
//     ⇒ 与"从锚点全量重算"逐位相同（推论 2）但**只做新增那几天的乘法**。
//   · **冷路径（系数/覆盖被改）**：`replayMarket` 从锚点全量重算 —— 它**只在时间轴被改写时**
//     被调用（用户撤记录 / 裁判改系数，属**偶发**），**不是每天都跑**。
//   ⇒ 因此本层**不需要缓存**：热路径本来就是 O(新增天数)，冷路径是偶发的一次 O(跨度) 乘法。
//     （真机上手改一次系数 = 一次几百次乘法的循环，量级同一次面板重绘。）
// ============================================================================

// §12.5 行情注记的清理策略（**用户 2026-09-20 拍定：只留最近 K 条，K = 30**）。
// ⚠️ **写入侧在 H1 就带这个 cap**（本轮的裁判会给已有标的挂注记）；
//    读侧（面板的行情注记段）照旧把表里有的全列出来 —— cap 是**写入**口径，不是读口径。
const NOTES_CAP = 30;

function normDay(v) { return str(v).trim(); }

// 读：绝对重放锚点（**降级读**）。认不出 ⇒ `null`（调用方按"就地立锚"处理，见文件头）。
function anchorOf(rec) {
  if (!isObj(rec)) return null;
  const a = rec.anchor;
  if (!isObj(a)) return null;
  const d = normDay(a.d);
  const p = a.p;
  if (!d) return null;
  if (!isNum(p) || p <= 0) return null;
  return { d: d, p: p };
}
// 老聊天（没有锚点）的**就地立锚**：用记录里**本来就写着**的那一天与那个价。
// ⚠️ 记录价 / 记录日认不出 ⇒ `null`（调用方按"这一条走不动"报 `problems`，绝不编锚点）。
function degradedAnchorOf(rec) {
  if (!isObj(rec)) return null;
  const d = normDay(rec.lastDate);
  const p = rec.price;
  if (!d) return null;
  if (!isNum(p) || p <= 0) return null;
  return { d: d, p: p };
}

// 读：大盘系数那张表（§5.4 ①「正文一句话 = 一条记录」）。
//   · 坏形状 / 缺 ⇒ **空表**（老聊天照旧推，只是没有系数）；
//   · 每一项只认 `{ date: 非空串, factor: 有限数且 > −1 }`（`factor <= −1` 会把价乘成 0 或负数
//     —— 那不是"跌"那是"归零"，一律**丢掉**，不修不猜）；
//   · **同一天多条 ⇒ 后写的说了算**（`setMoodRecord` 本来就是就地替换；手改数据才可能出现重复）；
//   · 回的是**新数组**（调用方改它不动入参）。
function moodsOf(state) {
  const s = isObj(state) ? state : {};
  const list = Array.isArray(s.marketMood) ? s.marketMood : [];
  const out = [];
  const at = Object.create(null);
  for (const it of list) {
    if (!isObj(it)) continue;
    const d = normDay(it.date);
    const f = it.factor;
    if (!d) continue;
    if (!isNum(f) || f <= -1) continue;
    const rec = { date: d, factor: f, reason: str(it.reason) };
    if (it.floor !== undefined && it.floor !== null) rec.floor = it.floor;
    if (at[d] !== undefined) { out[at[d]] = rec; continue; }
    at[d] = out.length;
    out.push(rec);
  }
  return out;
}
// `date -> factor`（重放用；`Object.create(null)` 防 `日期` 当键时的原型穿透）
function moodMapOf(state) {
  const m = Object.create(null);
  for (const r of moodsOf(state)) m[r.date] = r.factor;
  return m;
}

// 读：正文覆盖 / 裁判的价格动作（§5.7 的最小落地）。
//   形状 `marketOver: [{ date, 代码, kind, value }]`：
//     · `kind === 'price'`  ⇒ 那一天这只标的的价**直接取 `value`**（绝对价）；
//     · `kind === 'change'` ⇒ 那一天在算出来的价上**再乘 `(1 + value)`**（相对涨跌幅）。
//   ⚠️ 覆盖是**确定性的输入**（§5.7 原话"覆盖本身就是确定性输入的一部分"）⇒ 它进同一条
//   重放公式，因此"撤掉一条覆盖"与"撤掉一条系数"是同一件事的形状。
//   ⚠️ **不做"相对 → 绝对"的换算**：v1 只存"模型说了什么"，换算会让重放依赖换算那一刻的状态。
function overMapOf(state) {
  const s = isObj(state) ? state : {};
  const list = Array.isArray(s.marketOver) ? s.marketOver : [];
  const m = Object.create(null);
  for (const it of list) {
    if (!isObj(it)) continue;
    const d = normDay(it.date);
    const c = str(it.code).trim();
    const kind = str(it.kind) === 'change' ? 'change' : 'price';
    const v = it.value;
    if (!d || !c) continue;
    if (!isNum(v)) continue;
    if (kind === 'price' ? v <= 0 : v <= -1) continue;   // 绝对价要正；相对跌幅不许把价乘成 0
    m[c + '|' + d] = { kind: kind, value: v };           // 同一天同代码多条 ⇒ 后写的说了算
  }
  return m;
}

// 读：行情注记（§5.6）。降级读同上面几条（坏条目丢掉、回新数组）。
function notesOf(state) {
  const s = isObj(state) ? state : {};
  const list = Array.isArray(s.notes) ? s.notes : [];
  const out = [];
  for (const it of list) {
    if (!isObj(it)) continue;
    const text = str(it.text).trim();
    if (!text) continue;
    const row = { date: normDay(it.date), text: text, linkedSymbol: str(it.linkedSymbol).trim() };
    if (it.floor !== undefined && it.floor !== null) row.floor = it.floor;
    out.push(row);
  }
  return out;
}

// ★★ **唯一一步乘法**（两条路共用 ⇒ 浮点舍入位逐位相同；见文件头「推论 2」）。
//   次序写死：日因子 → 大盘系数 → 覆盖（覆盖**压在最上面**：绝对价直接替换、相对幅度再乘一次）。
function stepPrice(p, code, date, vol, moodMap, overMap) {
  let v = p * dayFactor(code, date, vol);
  const mf = moodMap[date];
  if (isNum(mf)) v = v * (1 + mf);
  const ov = overMap[str(code) + '|' + str(date)];
  if (ov) v = (ov.kind === 'change') ? (v * (1 + ov.value)) : ov.value;
  return v;
}

// ★★ **起算那一天的价**（锚点价那一步的**唯一**算法）。
//   为什么需要它（H1 真机复现出来的一个真缺口）：`stepPrice` 的乘积是 `(锚点日, d]` ——
//   锚点日**自己**不在乘积里 ⇒ 若"某只标的**今天**才首次起算"，而裁判/正文**今天**给了它一个价，
//   那条覆盖就会**一个字都不生效**（模型说改了，盘上没变）。修法：把锚点日那一天的覆盖
//   也算成**起算价的一部分**（覆盖 > 游走，§5.7 的优先级）—— 于是锚点价是"那一天实际生效的值"。
//   ⚠️ 它必须是**纯函数**（只吃 `anchor.p` / 代码 / 锚点日 / 覆盖表）：两条路都走它 ⇒ "重放 == 逐天"照旧。
function startPriceOf(anchorPrice, code, date, overMap) {
  const ov = overMap[str(code) + '|' + str(date)];
  if (!ov) return anchorPrice;
  return ov.kind === 'change' ? anchorPrice * (1 + ov.value) : ov.value;
}

// 波动档 ⇒ 幅度倍数（认不出的档 ⇒ 中波：不把乱码放大成 3 倍波动）
function volMultOf(volId) {
  const L = resolveLibrary();
  const V = L && L.VOLS;
  const v = (V && isObj(V)) ? V[str(volId)] : null;
  return (v && isNum(v.mult) && v.mult > 0) ? v.mult : 1;
}

// 一天一只标的的**游走因子**：`seededRng('代码|日期')` 的第一抽线性映射到
// `[1 - 幅度, 1 + 幅度)`。★ 函数签名**只有 (代码, 日期, 波动档)** —— 没有位置放价格：
// "依赖上一次的累计状态"这件事在形状上就写不进来（§10.3 那条隐含前提）。
function dayFactor(code, date, volId) {
  const amp = DAY_AMP * volMultOf(volId || VOL_OF_DEFAULT);
  const u = seededRng(str(code) + '|' + str(date))();
  return 1 + (u * 2 - 1) * amp;
}

// ============================================================================
// ② 状态读写口径（§5.2 的形状：prices / advance 是这一层的两格，其余原样带过）
// ============================================================================
// 只认两格、其余**一个都不碰**（`base` / `marketMood` / `notes` / 将来加的格子都原样带过）：
// 本层是"行情推进"，不是"行情状态的重建者"—— 重建就会把别的批次写的格子悄悄抹掉。
function readState(state) {
  const s = isObj(state) ? state : {};
  return {
    src: s,
    // 坏形状（数组 / 字符串 / 缺）⇒ 当"没有记录"（下面按"没有历史"起算），并记一条 problem
    prices: isObj(s.prices) ? s.prices : null,
    advance: isObj(s.advance) ? s.advance : null,
  };
}

// 入参 `base`（G1 `resolveLibrary` 的产物，或一张裸表）⇒ `[{ code, basePrice, vol }]`
// 认三种形状：`{ entries:[...] }`（resolveLibrary 的产物）/ `{ byCode:{...} }` / 裸数组。
// ⚠️ **认不出就回 `null`**（= 调用方没给表），回 `[]` 是"给了表但表是空的"——两者要分得开：
// 前者拒绝推进，后者也算拒绝（没有标的可推），但报告的形状不同。
function symbolListOf(base) {
  let list = null;
  if (Array.isArray(base)) list = base;
  else if (isObj(base)) {
    if (Array.isArray(base.entries)) list = base.entries;
    else if (isObj(base.byCode)) list = Object.keys(base.byCode).map(k => base.byCode[k]);
  }
  if (!list) return null;
  const out = [];
  for (const e of list) {
    if (!isObj(e)) continue;
    const code = str(e.code).trim();
    if (!code) continue;                     // 没有代码 = 没有身份，跳过（不造一条无名标的）
    out.push({ code: code, basePrice: e.basePrice, vol: e.vol });
  }
  return out;
}

// ============================================================================
// ③ 推进
// ============================================================================
// 回值键集（**契约，测试逐字钉住**）：
//   `state`      —— 要落盘的新 state（**新对象、深拷贝**；拒绝那一档与原 state 逐字相同）
//   `skipped`    —— 这次**没有推进**
//   `code`       —— 机器可读原因码（`ok` / `no-today` / `bad-today` / `same-day` / `no-base`
//                   / `backwards` / `no-calendar` / `no-library`）
//   `reason`     —— 给人看的一句短句（`ok` 时是空串；**不走词表**：这是**诊断**，不是面板文案）
//   `today`      —— **原样**带回调用方给的剧情日期（空就是空 —— 绝不替它编一个）
//   `dateSource` —— `'caller'`（调用方给的）/ `''`（没给）。
//                   ★ **永远没有 `'system'`**：本层不读系统时钟（三级兜底属接线，本版不做）
//   `walkedDays` —— 本次真正走掉的日历天数（逐标的取最大；全部只起算时 = 0，§11.13 的判据）
//   `symbols`    —— 逐只读数：`{ code, from, to, price, prevPrice, days, started }`
//   `orphans`    —— `prices` 里有、本次标的定义里没有的代码（**原样留着**，不静默删用户数据）
//   `problems`   —— 走不动的那些：`{ code, why }`（`why` = no-base-price / bad-record /
//                   bad-price / bad-date / backwards / prices-shape）—— **报出来**，不静默
const CODES = {
  OK: 'ok',
  NO_TODAY: 'no-today',
  BAD_TODAY: 'bad-today',
  SAME_DAY: 'same-day',
  NO_BASE: 'no-base',
  BACKWARDS: 'backwards',
  NO_CALENDAR: 'no-calendar',
  NO_LIBRARY: 'no-library',
};
// 诊断短句（**不是**面板文案：面板该说什么由它自己那层按档取词决定）。
// ⚠️ 逐句都避开 asset-terms.js 的三档结构词（`test/asset-terms.test.js` ③ 的扫描面）
//    与 E2 的四个内部状态词（`test/asset-panel.test.js` 的扫描面）。
const REASONS = {
  'no-today': '剧情日期没给，行情不推进',
  'bad-today': '剧情日期不是有效的日历日，行情不推进',
  'same-day': '这一天的行情已经推过了',
  'no-base': '没有拿到标的定义，行情不推进',
  'backwards': '剧情日期早于行情记录的日期，行情不倒退',
  'no-calendar': '日历层没加载，行情不推进',
  'no-library': '波动档没加载，行情不推进',
};

// 拒绝那一档的回值：`state` **逐字带过**（深拷贝 ⇒ 内容一个字不差、也不与入参共用引用）。
// 每一种拒绝都走这一句，好让"拒绝 = 什么都不写"这件事只有一处实现。
function refuse(state, code) {
  return {
    state: clonePlain(state),
    skipped: true,
    code: code,
    reason: REASONS[code] || '',
    today: '',
    dateSource: '',
    walkedDays: 0,
    symbols: [],
    orphans: [],
    problems: [],
  };
}

function advanceMarket(state, opts) {
  const o = isObj(opts) ? opts : {};
  const today = str(o.today).trim();          // 前后空白照旧容忍（用户手抄时常见的尾巴）
  // ★★ 不变量 ③ 的**第一句**：显式判空 —— 不是 `today && …`（那个写法空串会直接跳过检查，
  //    然后每层调用都推进一次、还把标记写成 `lastAt: ""`：`medical-store.js:351-358` 的坑）。
  //    ⚠️ 这里**不做系统日期兜底**（那是显示口径的写法）：拿不到就拒绝，什么都不写。
  if (!today) return refuse(state, CODES.NO_TODAY);
  const GRID = resolveGrid();
  const LIB = resolveLibrary();
  const r = refuse(state, CODES.OK);
  r.today = today;
  // `dateSource` 说的是**这个日期从哪儿来**（不是"这次推没推"）：调用方给了就是 caller。
  // ★ 本层没有 `'system'` 这一档 —— 系统时钟一次都不读（三级兜底属接线，本版不做）。
  r.dateSource = 'caller';
  // 依赖没加载 ⇒ 拒绝（**不当成"没波动"硬算**：那会给出少了一档的价，且是静默的）
  if (!GRID || typeof GRID.parseKey !== 'function' || typeof GRID.addDays !== 'function' || typeof GRID.dayDiff !== 'function') {
    r.code = CODES.NO_CALENDAR; r.reason = REASONS[CODES.NO_CALENDAR]; return r;
  }
  if (!LIB || !isObj(LIB.VOLS)) {
    r.code = CODES.NO_LIBRARY; r.reason = REASONS[CODES.NO_LIBRARY]; return r;
  }
  // 日期本身不合法（形状不对 / 不存在的那一天，如 `2026-02-30`）⇒ 拒绝。
  // ★ 这一句必须在**写落任何一格之前**：`Date` 会把 `2026-02-30` 悄悄滚成 `03-02`，
  //   那就等于**给价格编了一个日子**（`calendar-grid.parseKey` 的反查挡的就是这件事）。
  if (!GRID.parseKey(today)) { r.code = CODES.BAD_TODAY; r.reason = REASONS[CODES.BAD_TODAY]; return r; }

  const s = readState(state);
  // 标的表：**入参 base 优先，其次 state.base**（调用方每次给的是权威那一份）
  const symbols = symbolListOf(o.base) || symbolListOf(s.src.base) || [];
  if (!symbols.length) { r.code = CODES.NO_BASE; r.reason = REASONS[CODES.NO_BASE]; return r; }

  const mark = str(s.advance ? s.advance.lastAt : '').trim();
  // 标记本身认不出的（旧版本写坏的形状，如 `2026-2-4`）：**当"没有标记"**并报出来 ——
  // 一个坏字符串不该把行情永久卡死（下面照常推进，并把标记改写成今天这一份）。
  const markOk = mark !== '' && !!GRID.parseKey(mark);
  if (mark && !markOk) r.problems.push({ code: '', why: 'mark-shape' });
  // 一天一次：**同一天连调两次，第二次什么都不做**（价格逐字不变 + 回值说明原因）
  if (markOk && mark === today) { r.code = CODES.SAME_DAY; r.reason = REASONS[CODES.SAME_DAY]; return r; }
  // 时间倒流（剧情日期早于已经推到的日子）：**不倒退**，也不动标记
  if (markOk && mark > today) { r.code = CODES.BACKWARDS; r.reason = REASONS[CODES.BACKWARDS]; return r; }

  // ---- 真正推进：在**深拷贝**上改（入参一个字不动，回值不与入参共用任何引用）----
  const next = clonePlain(s.src);
  const prices = s.prices ? clonePlain(s.prices) : {};
  const oldPrices = s.prices;
  if (!s.prices) r.problems.push({ code: '', why: 'prices-shape' });   // 坏形状：当空表重建，但报出来
  next.prices = prices;
  // ★★ H1：重放输入的三张表**在循环外读一次**（本层从前一个字都不读它们 —— 现在读了）：
  //    · `moodMap` 大盘系数（§5.4：按日一条，乘到**每只标的**上）；
  //    · 覆盖表（§5.7：正文/裁判在**那一天**给这只标的的绝对价，压在最上面）。
  //    ⚠️ 它们只在**热路径**里当乘法因子；**改它们必须走 `replayMarket`**
  //      （增量只从"记录价"往前乘，改不到已经算过的那几天）—— 这是本层唯一的分岔纪律。
  const moodMap = moodMapOf(s.src);
  const overMap = overMapOf(s.src);
  const seen = new Set();
  let maxDays = 0;
  for (const sym of symbols) {
    const code = sym.code;
    // 表里同代码出现两次 ⇒ **第一条说了算**（与 asset-library 的"基础表自身重复只留第一条"同口径）
    if (seen.has(code)) continue;
    seen.add(code);
    const rec = (oldPrices && hasOwn(oldPrices, code)) ? oldPrices[code] : undefined;
    if (rec == null) {
      // ★ **只起算、不补算**（§3.7 尾表 / §11.13）：从没见过的标的**从今天起算**，
      //   价格就是基准价（**不把过去的日子补走** —— 那是编造历史）。补推天数 = 0。
      const bp = sym.basePrice;
      if (!isNum(bp) || bp <= 0) { r.problems.push({ code: code, why: 'no-base-price' }); continue; }
      // ★★ **起算那一天的价**：锚点日自己不在 `stepPrice` 的乘积里 ⇒ 那一天若有覆盖，
      //    必须在这里生效（否则"今天首次起算 + 今天给了价"那条动作会**静默失效**）。
      const bp0 = startPriceOf(bp, code, today, overMap);
      // ★★★ H1：**锚点在这里建立**（首次开启）—— 起算日 = 今天、起算价 = 那一天实际生效的价。
      //   锚点**不会被改写**（文件头「推论 3」）：价格 = 锚点价 × Π(锚点日之后的因子)。
      setKey(prices, code, { lastDate: today, price: bp0, prevPrice: bp0, closes: [{ d: today, p: bp0 }], anchor: { d: today, p: bp } });
      r.symbols.push({ code: code, from: '', to: today, price: bp0, prevPrice: bp0, days: 0, started: true });
      continue;
    }
    if (!isObj(rec)) { r.problems.push({ code: code, why: 'bad-record' }); continue; }
    const p0 = rec.price;
    const last = str(rec.lastDate).trim();
    // 记录价认不出 / 记录日认不出 ⇒ **不动它**（不拿基准价顶掉用户的历史价 —— 那是静默毁数据）
    if (!isNum(p0) || p0 <= 0) { r.problems.push({ code: code, why: 'bad-price' }); continue; }
    if (!GRID.parseKey(last)) { r.problems.push({ code: code, why: 'bad-date' }); continue; }
    const n = GRID.dayDiff(last, today);
    if (!isNum(n)) { r.problems.push({ code: code, why: 'bad-date' }); continue; }
    if (n <= 0) {
      // 这只标的已经推到了今天（或记录日在今天之后）：**不倒着走**，原样留着
      if (n < 0) r.problems.push({ code: code, why: 'backwards' });
      r.symbols.push({
        code: code, from: last, to: last, price: p0,
        prevPrice: isNum(rec.prevPrice) ? rec.prevPrice : p0, days: 0, started: false,
      });
      continue;
    }
    // ★★ 不变量 ② 的本体：**从记录日起，一天一天地乘**。跳天**不丢**（§5.3：起点按到点日算），
    //    也**不合并**成"一次乘到位"—— 每一步都在同一个位置做同一次乘法，所以
    //    "一次补推 N 天"与"N 次逐天推进"逐位相同（浮点乘法同序 ⇒ 同结果）。
    // ★ I1（0.7.64）：同一条循环里**顺手把每日收盘压进序列**。两条路在这里做的事**逐字相同**
    //    （同一天、同一次乘、同一个位置 push）⇒ 不变量 ② 扩到 `closes` 之后仍然成立。
    //    ⚠️ 序列的**起头**只补"记录里本来就写着的那一天"（`{d: last, p: p0}`），
    //    不补造更早的日子（§11.13：首次开启只起算不补算）。
    let p = p0;
    let prev = p0;
    let series = closesOf(rec);
    if (!series.length || series[series.length - 1].d !== last) series.push({ d: last, p: p0 });
    for (let k = 1; k <= n; k++) {
      const d = GRID.addDays(last, k);
      prev = p;
      // ★★ H1：这一步**只走 `stepPrice`**（日因子 × 大盘系数 × 正文覆盖）。
      //    与 `replayMarket` 走的是**同一个函数、同一个次序** ⇒ 「一次性重放 == 逐天推进」
      //    逐位成立（文件头「推论 2」）。**别在这里手写乘法** —— 那会让两条路分家。
      p = stepPrice(p, code, d, sym.vol, moodMap, overMap);
      series.push({ d: d, p: p });
    }
    if (series.length > CLOSES_CAP) series = series.slice(series.length - CLOSES_CAP);
    // ★★★ H1：锚点**原样带着**（有就用记录里那一份，没有就**就地立锚**）；
    //   写盘这一句**永远不改锚点**（文件头「推论 3」）。
    const anchor = anchorOf(rec) || { d: last, p: p0 };
    setKey(prices, code, { lastDate: today, price: p, prevPrice: prev, closes: series, anchor: anchor });
    if (n > maxDays) maxDays = n;
    r.symbols.push({ code: code, from: last, to: today, price: p, prevPrice: prev, days: n, started: false });
  }
  // 标记：**只有真推进了才写**（上面的每一条拒绝路径都在写它之前 return 了）。
  // 这就是"绝不写 `lastAt: ""`"的结构保证 —— 空 `today` 根本走不到这一行。
  next.advance = s.advance ? clonePlain(s.advance) : {};
  next.advance.lastAt = today;
  // 已经不在本次标的定义里的（用户删了 / 换了一份表）：**原样留着**并报出来
  if (oldPrices) for (const k of Object.keys(oldPrices)) if (!seen.has(k)) r.orphans.push(k);

  r.state = next;
  r.skipped = false;
  r.code = CODES.OK;
  r.reason = '';
  r.walkedDays = maxDays;
  return r;
}

// ============================================================================
// ★★★ H1（0.7.65）· 重放：从锚点把价格**重算一遍**
//   （§5.4 ③「撤掉那条系数记录，全部价格回原」的唯一实现路）
// ============================================================================
// 回值形状与 `advanceMarket` **逐键相同**（同一套 `CODES` / `REASONS` / `problems` 词），
// 差别只有一条：价格**从锚点重算**，而不是"从记录价往前乘"。
//
// ★ 什么时候该走它：**重放输入（大盘系数 / 覆盖）被改写之后**。
//   · 增量（`advanceMarket`）只从"记录价"往前乘 ⇒ 它**改不到已经算过的那几天**；
//   · 重放从锚点全量重算 ⇒ 改哪一天都对。
//   ⇒ 这是本层唯一的分岔纪律：**改时间轴 ⇒ 必须重放**。
//   ⚠️ 它**不做"一天一次"的守卫**（那是 `advanceMarket` 的事）：重放是"重算"，不是"推进"
//      —— 同一个 `today` 连着重放是**正常用法**（撤一条记录之后立刻重放）。
//   ⚠️ 它**不倒退日期标记**：`advance.lastAt` 只在 `today` 不早于它时才写下。
//
// ★ 序列那一段的两种起法（**为的是"重放 == 推进"逐字成立**）：
//   · 记录**有锚点** ⇒ 序列从锚点那一点重建（权威是锚点，序列是它的派生量）；
//   · 记录**没锚点**（老聊天，就地立锚）⇒ 序列沿用记录里已有的那一段当**前缀**
//     （那些天重放不出来 —— 见文件头"历史无法追溯"）再把锚点那一点接上。
//   ⇒ 这一条与 `advanceMarket` 里序列的起法**逐字相同**，所以两条路的 `closes` 也逐字相同。
function replayMarket(state, opts) {
  const o = isObj(opts) ? opts : {};
  const today = str(o.today).trim();
  if (!today) return refuse(state, CODES.NO_TODAY);
  const GRID = resolveGrid();
  const LIB = resolveLibrary();
  const r = refuse(state, CODES.OK);
  r.today = today;
  r.dateSource = 'caller';
  if (!GRID || typeof GRID.parseKey !== 'function' || typeof GRID.addDays !== 'function' || typeof GRID.dayDiff !== 'function') {
    r.code = CODES.NO_CALENDAR; r.reason = REASONS[CODES.NO_CALENDAR]; return r;
  }
  if (!LIB || !isObj(LIB.VOLS)) {
    r.code = CODES.NO_LIBRARY; r.reason = REASONS[CODES.NO_LIBRARY]; return r;
  }
  if (!GRID.parseKey(today)) { r.code = CODES.BAD_TODAY; r.reason = REASONS[CODES.BAD_TODAY]; return r; }

  const s = readState(state);
  const symbols = symbolListOf(o.base) || symbolListOf(s.src.base) || [];
  if (!symbols.length) { r.code = CODES.NO_BASE; r.reason = REASONS[CODES.NO_BASE]; return r; }

  const moodMap = moodMapOf(s.src);
  const overMap = overMapOf(s.src);

  const next = clonePlain(s.src);
  const prices = s.prices ? clonePlain(s.prices) : {};
  const oldPrices = s.prices;
  if (!s.prices) r.problems.push({ code: '', why: 'prices-shape' });
  next.prices = prices;
  const seen = new Set();
  let maxDays = 0;
  for (const sym of symbols) {
    const code = sym.code;
    if (seen.has(code)) continue;
    seen.add(code);
    const rec = (oldPrices && hasOwn(oldPrices, code)) ? oldPrices[code] : undefined;
    if (rec == null) {
      const bp = sym.basePrice;
      if (!isNum(bp) || bp <= 0) { r.problems.push({ code: code, why: 'no-base-price' }); continue; }
      const bp0 = startPriceOf(bp, code, today, overMap);
      setKey(prices, code, { lastDate: today, price: bp0, prevPrice: bp0, closes: [{ d: today, p: bp0 }], anchor: { d: today, p: bp } });
      r.symbols.push({ code: code, from: '', to: today, price: bp0, prevPrice: bp0, days: 0, started: true });
      continue;
    }
    if (!isObj(rec)) { r.problems.push({ code: code, why: 'bad-record' }); continue; }
    const last = str(rec.lastDate).trim();
    if (!GRID.parseKey(last)) { r.problems.push({ code: code, why: 'bad-date' }); continue; }
    const had = anchorOf(rec);
    // ★ 锚点：有就照用；**没有就就地立**（老聊天）—— 立在"记录里写着的那一天 / 那个价"上。
    const anchor = had || degradedAnchorOf(rec);
    if (!anchor) { r.problems.push({ code: code, why: 'bad-price' }); continue; }
    const n = GRID.dayDiff(anchor.d, today);
    if (!isNum(n)) { r.problems.push({ code: code, why: 'bad-date' }); continue; }
    if (n < 0) {
      // 锚点在今天之后：这只标的不倒着算（照实报出来，原样留着）
      r.problems.push({ code: code, why: 'backwards' });
      r.symbols.push({
        code: code, from: last, to: last, price: rec.price,
        prevPrice: isNum(rec.prevPrice) ? rec.prevPrice : rec.price, days: 0, started: false,
      });
      continue;
    }
    // ★★ 起算点那一天的值 = `startPriceOf(锚点价, 代码, 锚点日, 覆盖)` ——
    //    锚点日自己不在 `stepPrice` 的乘积里，所以那一天的覆盖**必须**在这一步生效
    //    （否则"今天首次起算 + 今天给了价"那条动作会静默失效）。
    const pStart = startPriceOf(anchor.p, code, anchor.d, overMap);
    let series = had ? [{ d: anchor.d, p: pStart }] : closesOf(rec);
    if (!series.length || series[series.length - 1].d !== anchor.d) series.push({ d: anchor.d, p: pStart });
    let p = pStart;
    for (let k = 1; k <= n; k++) {
      const d = GRID.addDays(anchor.d, k);
      p = stepPrice(p, code, d, sym.vol, moodMap, overMap);
      series.push({ d: d, p: p });
    }
    const prev = series.length > 1 ? series[series.length - 2].p : pStart;
    if (series.length > CLOSES_CAP) series = series.slice(series.length - CLOSES_CAP);
    setKey(prices, code, { lastDate: today, price: p, prevPrice: prev, closes: series, anchor: anchor });
    if (n > maxDays) maxDays = n;
    r.symbols.push({ code: code, from: last, to: today, price: p, prevPrice: prev, days: n, started: false });
  }
  const mark = str(s.advance ? s.advance.lastAt : '').trim();
  const markOk = mark !== '' && !!GRID.parseKey(mark);
  next.advance = s.advance ? clonePlain(s.advance) : {};
  if (!markOk || mark <= today) next.advance.lastAt = today;   // ★ 绝不把日期标记往回拨
  if (oldPrices) for (const k of Object.keys(oldPrices)) if (!seen.has(k)) r.orphans.push(k);

  r.state = next;
  r.skipped = false;
  r.code = CODES.OK;
  r.reason = '';
  r.walkedDays = maxDays;
  return r;
}

// ============================================================================
// ★★★ H1（0.7.65）· 时间轴的四个写者（**只改时间轴，一个价格都不改**）
// ----------------------------------------------------------------------------
// 它们全是**纯函数**：入参一个字不动，回一份新的行情状态，且**不重算价格** ——
// 改完由调用方走 `replayMarket` 把价格带到今天（那一步才是"回原"发生的地方）。
// 这样分两步的理由：价格是**派生量**，"改输入"与"重算派生量"是两件事，
// 混在一个函数里会让"到底哪一步动了价"说不清。
// ============================================================================
function setMoodRecord(state, item) {
  const s = isObj(state) ? state : {};
  const next = clonePlain(s);
  const d = normDay(item && item.date);
  const f = item && item.factor;
  if (!d || !isNum(f) || f <= -1) return next;     // 认不出 ⇒ **原样回**（写者不许猜一个系数出来）
  const list = moodsOf(s);
  const rec = { date: d, factor: f, reason: str(item.reason) };
  if (item.floor !== undefined && item.floor !== null) rec.floor = item.floor;
  let hit = -1;
  for (let i = 0; i < list.length; i++) if (list[i].date === d) hit = i;
  if (hit >= 0) list[hit] = rec; else list.push(rec);
  // 按日序排（重放不依赖顺序，但存盘按日序读起来才是"时间轴"）
  list.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
  next.marketMood = list;
  return next;
}
// ★ 「撤掉那条系数记录」= 这一个函数。撤完**必须重放**，价格才会回到"那条记录从未存在过"的值。
//   ⚠️ 撤空之后**把那一格删掉**（不是留一个空数组）："一条都没有"与"没有这一格"在读口上等价
//      （`moodsOf` 两种都回空表），但**只有删掉才做得到"整份 state 逐字回原"**那一条读数
//      （`test/asset-market.test.js` 的 H1 ④ 拿它跟"从未设过"的参照组 deepStrictEqual）。
function removeMoodRecord(state, date) {
  const s = isObj(state) ? state : {};
  const d = normDay(date);
  const next = clonePlain(s);
  const kept = moodsOf(s).filter(x => x.date !== d);
  if (kept.length) next.marketMood = kept; else delete next.marketMood;
  return next;
}
function setOverride(state, item) {
  const s = isObj(state) ? state : {};
  const next = clonePlain(s);
  const d = normDay(item && item.date);
  const c = str(item && item.code).trim();
  const kind = str(item && item.kind) === 'change' ? 'change' : 'price';
  const v = item && item.value;
  if (!d || !c || !isNum(v)) return next;
  if (kind === 'price' ? v <= 0 : v <= -1) return next;
  const list = overMapOf(s);
  // 用 map 重建：同一天同代码**只留一条**（后写的说了算），顺序按日期稳定
  const key = c + '|' + d;
  const kept = [];
  for (const k of Object.keys(list)) if (k !== key) {
    const parts = k.split('|');
    kept.push({ date: parts[1], code: parts[0], kind: list[k].kind, value: list[k].value });
  }
  kept.push({ date: d, code: c, kind: kind, value: v });
  kept.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
  next.marketOver = kept;
  return next;
}
function removeOverride(state, code, date) {
  const s = isObj(state) ? state : {};
  const key = str(code).trim() + '|' + normDay(date);
  const next = clonePlain(s);
  const list = overMapOf(s);
  const kept = [];
  for (const k of Object.keys(list)) if (k !== key) {
    const parts = k.split('|');
    kept.push({ date: parts[1], code: parts[0], kind: list[k].kind, value: list[k].value });
  }
  kept.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
  // 撤空 ⇒ 删格（同 `removeMoodRecord`：只有删掉才做得到"整份 state 逐字回原"）
  if (kept.length) next.marketOver = kept; else delete next.marketOver;
  return next;
}
// ★ §12.5（用户 2026-09-20 拍定 K = 30）：**写入侧就带 cap** —— 超上限丢最旧。
//   （H2 只做"一键提升为标的" + 别名机制；cap 在 H1 就生效。）
function addNote(state, item) {
  const s = isObj(state) ? state : {};
  const next = clonePlain(s);
  const text = str(item && item.text).trim();
  if (!text) return next;
  const list = notesOf(s);
  const row = { date: normDay(item.date), text: text, linkedSymbol: str(item.linkedSymbol).trim() };
  if (item.floor !== undefined && item.floor !== null) row.floor = item.floor;
  list.push(row);
  next.notes = list.length > NOTES_CAP ? list.slice(list.length - NOTES_CAP) : list;
  return next;
}

// ============================================================================
// ★★★ H1（0.7.65）· §5.5 行情裁判的**封闭动作集**
// ----------------------------------------------------------------------------
// 铁律（§5.5 `:678`）：**裁判能动市场，不能动你的账。**
// 用户的账只有三个合法写者：**面板手改 / 提取（用户确认后）/ 行情结算（机械计算）**。
//
//   ✅ 允许（**全部**在这一层）              ❌ 不许（认出来就退回，记进 `rejected`）
//   ─────────────────────────────────────  ────────────────────────────────────────
//   · 改**已有标的**的价格 / 涨跌幅           · **新造标的**（只能走"注记 → 用户一键提升"）
//     （落成 `marketOver` 上的一条时间轴记录）  · 改用户的持仓数量 / 成本 / 现金
//   · 改**大盘情绪系数**（`marketMood`）      · 直接给用户加一笔收益或亏损（= 动流水）
//   · 给**已有标的**挂行情注记（cap 30）
//
// ★ 结构保证（**不是靠自觉**）：本函数的签名里**没有账本** —— 收行情状态、回行情状态。
//   "只碰行情状态"因此是**形状上的事实**；`test/asset-market.test.js` 的越权五条是**验证**它，
//   不是它成立的原因。要"动账"得先把这个函数的返回值接进 `writeLedger` —— 那一步不在本层。
//
// ★ AI 管理是**显式开启**（§5.5 `:680`）：开启即用户明示接受"结果依赖模型判定、不再逐字可复现"。
//   本层**不认识开关**：开与不开由调用方（面板 / 楼层钩子）判 —— 本层只在被调用时干活，
//   所以"关着 ⇒ 一次模型调用都不发"是**调用侧的结构**（`asset.script.js` 的 `marketSettle`）。
// ============================================================================
const JUDGE_ALLOWED = ['prices', 'mood', 'notes'];
// 认得出名字的越权键（只为把 `rejected` 说清楚；不上面板、不进词表）
const JUDGE_OUT_OF_SCOPE = [
  'holdings', 'holding', 'qty', 'quantity', 'cost', 'cash', 'money', 'balance',
  'flow', 'flows', 'ledger', 'entries', 'entry', 'pnl', 'profit', 'gain', 'loss', 'worth',
  'symbols', 'symbol', 'newSymbol', 'addSymbol', 'removeSymbol', 'base', 'library',
];

// 从模型那段文本里取出那个 JSON（**宽容取段、严格校验**）：
//   · 前后有废话 / 代码围栏都行；取**第一个 `{` 到最后一个 `}`**；
//   · 取不到 / 解不开 / 不是对象 ⇒ `ok: false`（调用方**什么都不写**，绝不"猜一个动作"）。
function parseMarketJudge(text) {
  const s = str(text);
  if (!s.trim()) return { ok: false, why: 'empty', verdict: null };
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, why: 'not-json', verdict: null };
  let obj = null;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { return { ok: false, why: 'not-json', verdict: null }; }
  if (!isObj(obj)) return { ok: false, why: 'not-json', verdict: null };
  return { ok: true, why: '', verdict: obj };
}

// 应用一份裁判判定：**只回行情状态**。
//   `opts = { today, base }`（`base` = 标的表的三层合并结果 / 裸表 —— 用它判"这是不是已有标的"）
//   回值：`{ state, applied, rejected, refused, needReplay }`
//     · `applied`  —— 真的进了时间轴的（给人看的短语，**不是面板文案**）
//     · `rejected` —— 被退回的（`why` = out-of-scope / unknown-symbol / bad-shape / no-today）
//     · `refused`  —— **整批**退回（出现越权顶层键时置真，`applied` 空）
//     · `needReplay` —— 时间轴被动过 ⇒ 调用方**必须**走 `replayMarket` 把价格带到今天
function applyMarketJudge(state, verdict, opts) {
  const o = isObj(opts) ? opts : {};
  const today = normDay(o.today);
  const out = {
    state: clonePlain(isObj(state) ? state : {}),
    applied: [], rejected: [], refused: false, needReplay: false,
  };
  if (!isObj(verdict)) return out;
  // ---- ① 封闭动作集：顶层出现认不出的键 ⇒ **整批退回** ----
  //   为什么是"整批"而不是"只丢那一格"：一个会吐 `holdings` / `newSymbol` 的模型，
  //   它同一次里的 `prices` 也不该被相信（半应用会给出"我管住了它"的错觉）。
  for (const k of Object.keys(verdict)) {
    if (JUDGE_ALLOWED.indexOf(k) < 0) {
      out.rejected.push({ why: 'out-of-scope', key: k, scope: JUDGE_OUT_OF_SCOPE.indexOf(k) >= 0 ? 'account' : 'unknown' });
      out.refused = true;
    }
  }
  if (out.refused) return out;

  // ---- ② 已有标的的白名单（"不许新造标的"就是这一道闸）----
  const codes = Object.create(null);
  for (const sym of (symbolListOf(o.base) || [])) codes[sym.code] = true;
  const known = code => codes[code] === true;

  let next = out.state;
  if (verdict.mood !== undefined && verdict.mood !== null) {
    const m = isObj(verdict.mood) ? verdict.mood : null;
    const f = m && m.factor;
    if (!today) { out.rejected.push({ why: 'no-today', key: 'mood' }); }
    else if (!m || !isNum(f) || f <= -1) { out.rejected.push({ why: 'bad-shape', key: 'mood' }); }
    else {
      next = setMoodRecord(next, { date: today, factor: f, reason: m.reason, floor: o.floor });
      out.applied.push('mood');
      out.needReplay = true;
    }
  }
  if (Array.isArray(verdict.prices)) {
    for (const raw of verdict.prices) {
      if (!isObj(raw)) { out.rejected.push({ why: 'bad-shape', key: 'prices' }); continue; }
      const code = str(raw.code).trim();
      // ★ 越权②：正文里提到的新企业**不许在这里变成标的**（只能走注记 → 用户一键提升）
      if (!code || !known(code)) { out.rejected.push({ why: 'unknown-symbol', key: 'prices', code: code }); continue; }
      if (!today) { out.rejected.push({ why: 'no-today', key: 'prices', code: code }); continue; }
      const hasPrice = raw.price !== undefined && raw.price !== null;
      const hasChange = raw.change !== undefined && raw.change !== null;
      if (hasPrice === hasChange) { out.rejected.push({ why: 'bad-shape', key: 'prices', code: code }); continue; }
      const kind = hasPrice ? 'price' : 'change';
      const value = hasPrice ? raw.price : raw.change;
      if (!isNum(value) || (kind === 'price' ? value <= 0 : value <= -1)) {
        out.rejected.push({ why: 'bad-shape', key: 'prices', code: code }); continue;
      }
      next = setOverride(next, { date: today, code: code, kind: kind, value: value });
      out.applied.push('price:' + code);
      out.needReplay = true;
    }
  }
  if (Array.isArray(verdict.notes)) {
    for (const raw of verdict.notes) {
      if (!isObj(raw)) { out.rejected.push({ why: 'bad-shape', key: 'notes' }); continue; }
      const text = str(raw.text).trim();
      if (!text) { out.rejected.push({ why: 'bad-shape', key: 'notes' }); continue; }
      const link = str(raw.linkedSymbol).trim();
      // 挂到"已有标的"上才算数；挂到一个不存在的代码 ⇒ 退回那一条（但不影响别的注记）
      if (link && !known(link)) { out.rejected.push({ why: 'unknown-symbol', key: 'notes', code: link }); continue; }
      // ★★★ H2（0.7.66）· §5.6 别名机制的"下次自动"那一半：
      //   模型这一条**没给** `linkedSymbol` 时，按**别名/名称精确匹配**自动对一次 ——
      //   判据在 `asset-library.js` 的 `autoLinkSymbol`（**唯一命中才算**：同名两处回 null，
      //   "宁可失联也不挂错"）。⇒ 用户答过"记进别名"之后，**下一次**同样的话就自动挂上了；
      //   没记过 / 对不出（0 或 ≥2 命中）⇒ **照旧留空**（= 那条注记停在「未匹配」）。
      //   ⚠️ 这一段**不造标的**：它只会在**已有的**标的里挑一条（`known` 之外的代码它给不出来 ——
      //      `autoLinkSymbol` 的候选就是这张表本身）。
      let auto = '';
      if (!link) {
        const L = resolveLibrary();
        const hit = (L && typeof L.autoLinkSymbol === 'function') ? L.autoLinkSymbol(o.base, text) : null;
        if (hit && known(str(hit.code).trim())) auto = str(hit.code).trim();
      }
      next = addNote(next, { date: today, text: text, linkedSymbol: link || auto, floor: o.floor });
      out.applied.push('note');
    }
  }
  out.state = next;
  return out;
}

// 裁判的提示词（**给模型读的**，不是面板文案；所以这里的中文不走词表 —— 与其余模块的
// 提示词同一条口径）。⚠️ 它**必须在封闭动作集之内**说话：明确"只判列出的标的 / 不许动用户的钱"。
//   省钱的形状（§5.5 `:665`「每层一次裁判调用（耗 API）」）：**一次调用判全部标的**，
//   不按标的逐只发请求。
function marketJudgePrompt(o) {
  const opts = isObj(o) ? o : {};
  const syms = Array.isArray(opts.symbols) ? opts.symbols : [];
  const lines = syms.map(s => '· ' + str(s.code) + ' ' + (str(s.name) || str(s.code))).join('\n');
  return '你是「市况裁判」，只做判断、不写剧情。读完本轮正文，判断这一层对**已有标的**的市场影响。\n\n'
    + '【本轮剧情日】' + str(opts.today) + '\n'
    + '【本轮正文】\n' + (str(opts.floorText) || '（无）') + '\n\n'
    + '【已有标的（只判这些）】\n' + (lines || '（无）') + '\n\n'
    + '【输出】只回一段 JSON：'
    + '{"prices":[{"code":"#600519","change":0.03}],"mood":{"factor":-0.03,"reason":"一句话"},"notes":[{"text":"一句话","linkedSymbol":"#600519"}]}\n'
    + '规则：\n'
    + '· prices 只许用上面列出的 code；正文里提到的不在其中，就写进 notes（linkedSymbol 留空），由用户自己去建。\n'
    + '· 不许动用户的钱：数量、成本、现金、盈亏一律不写。\n'
    + '· change 是相对变动（0.03 = 涨三个点）；也可以给 price（当天的绝对值），二者给一个即可。\n'
    + '· mood 是整个盘面的情绪，一层最多一条。\n'
    + '· 正文里没有依据的，一律不列。';
}

// ============================================================================
// 对外接口
// ============================================================================
// 挂载点与 terms / library / ledger / core / … 同一族：真机上本文件在 `asset-library` **之后**
// 执行（`scripts/build-artifact.js` 的 `sources` 里的位置才是权威），调用方从
// `window.parent.__LA_ASSET_MARKET__` 取。
const api = {
  DAY_AMP,
  // ★ I1（0.7.64）：每日收盘序列的上限与**唯一读口**。
  //   `CLOSES_CAP` 进产物是为了让取证与后续批次（走势图 / 枢纽）能引用同一个数，
  //   不许在别处再写一个 30；`closesOf` 是"这一格长什么样"的唯一出处
  //   （投影层读序列也只能走它 —— 见 `asset-project.js` 的 `marketApi`）。
  CLOSES_CAP,
  closesOf,
  // 确定性件：后续批次（面板走势 / 裁判解释 / H1 只读诊断）要对"同一个 (代码, 日期) 的
  // 日因子是多少"说话时，只能走这一份 —— 别处再写一个 PRNG 就是两份口径。
  hashSeed, seededRng, volMultOf, dayFactor,
  advanceMarket,
  // ★★ H1（0.7.65）· §5.4 大盘系数 + 绝对重放锚点 + §5.5 裁判的封闭动作集
  //   `NOTES_CAP` / `anchorOf` / `degradedAnchorOf` / `moodsOf` / `overMapOf` / `notesOf`
  //   —— "这几格长什么样"的唯一读口（别处再写一份就是两份口径）。
  //   `replayMarket` —— 从锚点重算（改时间轴之后**必须**走它）。
  //   `removeMoodRecord` —— ★ 「撤掉那条系数记录」（配 `replayMarket` 就是"价格回原"）。
  //   `applyMarketJudge` / `parseMarketJudge` / `marketJudgePrompt` —— 裁判那一族。
  NOTES_CAP,
  anchorOf, degradedAnchorOf,
  moodsOf, moodMapOf, overMapOf, notesOf,
  startPriceOf,
  replayMarket,
  setMoodRecord, removeMoodRecord,
  setOverride, removeOverride,
  addNote,
  parseMarketJudge, applyMarketJudge, marketJudgePrompt,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  rt.__LA_ASSET_MARKET__ = api;
}

})();

  return module.exports;
})();
