/* ========================================================
 * asset-settlement.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-settlement.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-terms.js、./asset-ledger.js
 * 【上游定位】asset-settlement.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-terms.js';
import __assetDep1 from './asset-ledger.js';

const __REQ = {
    './asset-terms.js': () => __assetDep0,
    './asset-ledger.js': () => __assetDep1,
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
/* src/modules/asset/asset-settlement.js */
'use strict';

// ============================================================================
// 资产模块 · 周期账计划（批次 E1）—— **纯函数**
// ----------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md`
//   · §15.4（结算的触发）：到点出提示；**跳周期怎么算 —— 起点按到点周期算，不按"现在"算**
//     （「跳三个月就要补三次结算，而不是只结一次」）；
//   · §15.9（★ 结算周期 vs 视角）：**结算周期由每条 `flows` 自己声明，不统一**；
//     用户设的那个"周期"是**视角**（看的粒度），**不是结算粒度**。
//
// ★★ 本文件做**两件互不相干的事**，中间那条界线是本批（E3）最要紧的一句话：
//    ① `planSettlement`（E1）—— **结算周期**："哪些周期账到点了"。它**不落账**：账本唯一的
//       写者是 `asset-ledger.js` 的 `appendFlow`（四道闸：actor / 事由 / 去处 / 日期）。
//       所以 `due` 里每一项都是一份**能原样喂给 `appendFlow` 的描述**，而不是一笔已经写好的账。
//    ② `aggregateFlows`（E3）—— **视角**："已经记下的账怎么看"（聚合与对比的粒度）。
//       它**只读**流水，**一个字节都不写**，也**从不调用** ① —— 视角切一次，账本一动不动
//       （混成一件就会出现"切到周视角 ⇒ 月例变成每周发一次"，见 §15.9 开头那张表）。
//    调用方落账**成功后**要显式调一次 `projectNow()`（D2 留的前置接线）——
//    那是调用方的事，本层一个字都不碰投影。
//
// ★★ 本层是**纯函数**（与 core / project 同一档纪律）：
//    零 DOM、零存储、零全局写入、零随机、**零 `Date.now()`** ——
//    "今天是哪天"只能由调用方交上来（`opts.today`）。日期算术走 `Date.UTC`，
//    那是**确定性的日历换算**（不读系统时钟、不受本机时区影响），不是"读时钟"。
//
// ⚠️ **本文件里不许出现面板结构词的字面量**：`test/asset-terms.test.js` 的 ③ 会扫
//    资产模块的每一个源文件（新文件也在扫描面里），而 E1 的 `reason` 是**给用户看的短句**，
//    所以它一律从 `asset-terms.js` 的取词口拿（三档各给，见那里的 `settle*` 一族）。
// ============================================================================

// ---- 认词口：唯一取词口是 asset-terms.js（与 core / project 同一形状，不另抄一份）----
function resolveTerms() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-terms.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_TERMS__) || null;
}
const TERMS = resolveTerms();

// ---- 求和口（E3 补）：**唯一一份在账本层**（`sumFlows` / `flowSigned` / `flowKind`）----
// E3 的视角分桶要按三档求和，而"入为正、出为负、转移不带钱"这条口径**只有账本层那一份**
// （`flowSigned` 的第二道闸也在那儿）。所以这里把它取过来**用**，绝不在这儿写第二份符号口径。
// ⚠️ 本文件因此多了一个依赖（从前只依赖词表）。构建清单里账本层排在它**之前**
//   （`sources`：terms → **ledger** → core → project → settlement），真机上全局一定已经挂上。
function resolveLedger() {
  if (typeof module !== 'undefined' && module.exports) {
    try { return require('./asset-ledger.js'); } catch (e) { /* 真机上没有 require 这条路 */ }
  }
  const w = (typeof window !== 'undefined') ? (window.parent || window) : null;
  return (w && w.__LA_ASSET_LEDGER__) || null;
}
const LEDGER = resolveLedger();

// 与 core 同一套小工具口径（**只读，不导出** —— 这些通用小工具的所在地是账本层，
// 本层不新造第二个家乡）。写成局部函数而不是 require 账本层，是为了让本文件依赖尽量少；
// ⚠️ E3 起例外只有**一个**：`sumFlows`（求和唯一口径，见上面的 `resolveLedger`）——
//    那一条是"同一个数只能有一个来路"，不是"省一个 require"能换的。
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function str(v) { return v == null ? '' : String(v); }
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  return NaN;
}
// 取词口（**档位由调用方给**，认不出的档位回落现代档 —— 与 `uiTerms` / `termsOf` 同一口径）。
// ⚠️ 这里**必须**把 era 传进去：本层的 `reason` 是**要落进账本、也会显示给人看**的一句话，
//    "月 / 旬 / 候"这些量词三档不同 —— 写死 `uiTerms('modern')` 就等于换皮失效
//    （`test/asset-settlement.test.js` 的 ⑦ 就是钉这一条的：三档下 reason 必须各不相同）。
// 词表整个取不到时回空串：本层不是渲染层，宁可不说话，也不在这里写死一句中文。
function tw(key, era) {
  if (!TERMS || typeof TERMS.uiTerms !== 'function') return '';
  try { return str(TERMS.uiTerms(era)[key]); } catch (e) { return ''; }
}
// 档位：认不出的（含没给）→ 现代档，与 `normalizeEra` 同一口径
function eraOf(v) {
  const s = str(v);
  return (TERMS && TERMS.ERAS && TERMS.ERAS.indexOf(s) >= 0) ? s : 'modern';
}

// ---------------------------------------------------------------------------
// 周期：**取值以 `flows[].period` 实际用的那几档为准**
// ---------------------------------------------------------------------------
// 三处既有口径是**同一套** key（本层照抄，不自造第四套枚举）：
//   · 词表 `periodDay`…`periodYear`（asset-terms.js:74 / 157 / 210，三档各一份量词）；
//   · 投影（asset-project.js:562 的 `PERIOD_TERMS`）；
//   · 面板（asset.script.js:822 的 `PERIOD_TERM`）。
// 这里只多一样东西：**每一档换算成多少个"月"或多少天** —— 那是结算才需要的，
// 别处没有，也不该有。天数按月/季/年之外的档算（day / week）；月 / 季 / 年走**日历月**，
// 好让"月结"落在**每个月的同一个日号**上，而不是每 30 天的漂移一次。
const PERIOD_WORDS = ['day', 'week', 'month', 'quarter', 'year'];
const PERIOD_TERM_KEYS = {
  day: 'periodDay', week: 'periodWeek', month: 'periodMonth', quarter: 'periodQuarter', year: 'periodYear',
};
const PERIOD_INCREMENTS = {
  day: { days: 1 }, week: { days: 7 }, month: { months: 1 }, quarter: { months: 3 }, year: { months: 12 },
};
// 单条 flow **认不出的 period** 时用哪一档？
// 照既有口径：`asset-project.js` / `asset.script.js` 都是"认不出的周期一律按**月**说"
// （词表那一行注释也写着「认不出的周期一律按月说（第一版的结算周期就是月）」）。
// 所以这里的兜底不是自创：它是**与另外两处同一句话**。
const DEFAULT_PERIOD = 'month';
// 认一条 flow 自己的 period：**只认 PERIOD_WORDS 里那五档**（认不出 = 这一条没说）
function periodOfFlow(f) {
  const p = isObj(f) ? str(f.period) : '';
  return PERIOD_WORDS.indexOf(p) >= 0 ? p : '';
}
// ★★ **入参 `period` 到底干什么**（brief §2.2 的 Ruling，这里写死，往后谁也不许翻案）：
//    它**只是兜底/默认值** —— 某一条 flow 自己没说 period 时才用它。
//    **单条 `flows[].period` 永远优先**。理由就是 §15.9 那句明文：
//    「结算周期由每条 flows 自己声明，不统一」。
//    混成一件就会出现「**切到周视角 ⇒ 月例变成每周发一次**」这种错 ——
//    所以"视角"（用户在设置里挑的那个粒度）**只能**通过这条兜底路径影响
//    **没有声明周期的** flow；凡声明过周期的那一条，视角**动不了它**。
//    （视角本身是 E3 的事，本层不实现分桶，也不实现切换。）
function periodForFlow(f, fallback) {
  return periodOfFlow(f) || (PERIOD_WORDS.indexOf(fallback) >= 0 ? fallback : DEFAULT_PERIOD);
}

// ---------------------------------------------------------------------------
// 日期算术（**只认 `YYYY-MM-DD`**；确定性的日历换算，不读时钟）
// ---------------------------------------------------------------------------
// 本模块的日期口径是**裸日期串**（`medical-core.todayIso()` / `addDaysIso` 同族，
// 面板 `asset.script.js:117` 也是 `.toISOString().slice(0,10)` 那一族）。
// 这里不需要时间也不需要时区，所以只用 `Date.UTC` 做日历进位 —— 不用本地时区构造，
// 免得"同一天"在别的时区里变成前一天（那是编一个日子，正是本任务要防的事）。
function parseIsoDate(v) {
  const s = str(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 反查一遍：`2026-02-30` 这种"格式对、日子不存在"的串也要被挡下
  // （`Date` 会把它悄悄滚成 3 月 2 日 —— 那就等于给一笔账编了个日子）
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y: y, mo: mo, d: d };
}
function isoOf(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const mm = String(dt.getUTCMonth() + 1); const dd = String(dt.getUTCDate());
  return String(dt.getUTCFullYear()) + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
}
// ★ **到点日 = 起点 + 整数个周期，永远从同一个锚点算**（§15.4：
//   「起点按到点周期算，不按"现在"算」）。这里有两处刻意的选择，都写清楚：
//   ① **从锚点算，不从上一期算**：逐期累加会漂（`2026-01-31` 一路 +1 个月累加成
//      2/28 → 3/28 → 4/28，第三个到点日就与"月结"没关系了）；从锚点算，**在同一次调用里**
//      就永远回到同一个月日号（3 月那一期又是 31 号）。
//      ⚠️ **只在单次调用内成立**：跨次调用时"锚点是谁"由调用方决定 —— 若它把锚点推成
//      `max(due.at)`（2 月那期 = 2/28），下一次结算的锚点就变成 28 号，日号照样漂。
//      跨调用的口子在返回值 `sources[].nextLastAt`（见 `planSettlement` 的长注释）。
//   ② **日号溢出夹到当月最后一天**（`2026-01-31` + 1 个月 = `2026-02-28`，闰年是 `02-29`）：
//      这是唯一不编日子又不丢期的落法 —— 若改成"滚到下个月 1 号"，两个月的账会在同一天落两笔。
//   本函数**不做规划**（不判到点没到点），只回答"从 anchor 起第 n 个到点日是哪天"，
//   所以它既能算首期，也能算第 13 期。
function shiftDate(anchor, inc, n) {
  if (!anchor) return '';
  const k = Number(n) || 0;
  if (inc.months) {
    const total = (anchor.mo - 1) + inc.months * k;
    const y = anchor.y + Math.floor(total / 12);
    const mo = ((total % 12) + 12) % 12 + 1;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();   // 当月最后一天
    return isoOf(y, mo, Math.min(anchor.d, last));
  }
  return isoOf(anchor.y, anchor.mo, anchor.d + inc.days * k);
}
// 绝对日偏移（**只做日历进位**，不读时钟）：把一个已经解析过的日期往后挪 `days` 天。
function shiftDaysAbs(anchor, days) { return isoOf(anchor.y, anchor.mo, anchor.d + days); }
function daysBetween(anchor, other) {
  return Math.round((Date.UTC(other.y, other.mo - 1, other.d) - Date.UTC(anchor.y, anchor.mo - 1, anchor.d)) / 86400000);
}

// ---------------------------------------------------------------------------
// 一笔 due：**能原样喂给 `appendFlow`**
// ---------------------------------------------------------------------------
// 与 `appendFlow` 的入参形状逐格对应（它读的正是这几格）：
//   actorKey / reason / at / direction / amount / kind / entryId / to
// 外加几个**只给调用方看**的格子（不是给 `appendFlow` 的，它不读也不介意）：
//   flowKey / flowIndex / flowIdentity / period。
//
// ★ **`at` 永远由到点日给，绝不"没给就编一个"**：`appendFlow` 的第三道闸是"日期必填"
//   （`LA_ASSET_DATE_REQUIRED`），而这里每一笔都带着**那一期的到点日** —— 所以
//   "flow 上原来没写 at" 不留任何悬念：到点日就是它的发生日。
//   ★★ **这一格与 flow 上那个 `f.at` 是两件事**（E2 裁定，见 `planSettlement` 的长注释）：
//      `f.at` 是"这条规则自己记的发生日"，本层**一个字都不读它**；
//      这里给的 `at` 是**到点日**（anchor + 整数个周期算出来的）。两者可以不一样，
//      而且**不一样是正常的**（锚 01-31 的那一条，2 月那一期的到点日是 02-28）。
//      把 `f.at` 当锚点用，日号当场从 31 漂到 28 —— 一个数只能有一个来路。
// ★ **`reason` 是自动生成的、有意义的短句**（`appendFlow` 的第一道闸就是它）：
//   `settleReason` + 该条的周期量词，两者都从词表取（三档各一份）。
//   不把金额写进去（金额跟着 flow 走，写两遍迟早不一致）。
// ★ **`kind` / `direction` / `amount` 原样带过来**，但都过一遍归一化的**读法**：
//   `amount` 认不出的（NaN）落 0、`direction` 认不出的落 `in`、`kind` 认不出的落 `cashflow`
//   —— 与 `asset-ledger.js` 的 `normalizeFlow` **同一套缺省**（那里的注释写死了这三个缺省）。
//   本层不做第二份"归一化"（那是账本层的活），只是把**会挡闸的值**提前说清：
//   一条 `amount: 'abc'` 的 flow 在计划里就是 0，落账后也是 0，两处同一句话。
const KIND_WORDS = ['balance', 'cashflow', 'reserve'];
const DIRECTION_WORDS = ['in', 'out', 'transfer'];

// ---------------------------------------------------------------------------
// 周期规则的**源**与它的**锚点**（★ 复查修的那条 Important；★ E2 收窄了身份键）
// ---------------------------------------------------------------------------
// **源 = 谁 + 挂在哪儿**：`actors[k]`（actorKey）与 `actors[k].entries[j]`（条目）两级。
//
// ★★ **E2 收窄：水位只有一种粒度 —— 逐规则（`flowIdentity`）**（brief §2.4.1）。
//    从前的 `sourceState` 收两种键（`flowIdentity` / `sourceKey`）与两种值（裸日期串 /
//    `{anchor, through}`），四处组合里**两处是退化的**，实测都是坑：
//      · 值 = 裸日期串 `'2026-02-28'` ⇒ anchor 与 through **同时**被它顶掉 ⇒ 锚点被结算日
//        吃掉（网格从 02-28 起 ⇒ 下一期落 `03-28`，正是那条棘轮）。它不是一个"更省事的写法"，
//        它是**把两条独立的线压成一条**（锚点管日号、through 管结到哪儿了），压了必漂。
//      · 键 = `sourceKey`（`shen|shop`）⇒ 一个数喂一源里**所有**规则。单周期源上看着能用，
//        混周期（同一条目上日结 + 月结）就必然"一个落后一个超前"（日结重复 / 月结跳期）——
//        而"能不能混"是**用户数据**说了算，不是调用方说了算。
//    所以：**键只认 `flowIdentity`，值只认 `{ anchor, through }`**，两处退化写法一起删掉
//    （删掉比留一个"别用"的注释安全：退化写法留在代码里，迟早有人觉得它更省事）。
//    `sourceState` 里给了别的键 / 别的值 ⇒ **当作没给**，逐规则回落入参 `lastAt`
//    （旧调用方的口径一个字不变 —— 那些键从前也只会撞上一半规则，落回来反而更稳）。
//
// ★★ **同键 / 缺 `id` 的条目从前会被静默去重**（E1 Minor，E2 修）。
//    旧口径下 `sourceKey = actorKey|entryId`：同一个人名下**两条都没有 `id`** 的条目
//    两边都是 `shen|` ⇒ 第二条被 `if (seen[key]) continue` 丢掉 ⇒ **它的周期规则从不结算**
//    （E1 复审实测：两条都缺 id ⇒ `due=0`；补成 `e1/e2` ⇒ `due=2`）。这是"用户没给 id
//    就静默丢账"，与"编一个日子"同族。**E2 的修法不是改键**（键改成带下标只把"静默"变成
//    "换个静默"），而是：① 去重照旧（同一个键的第一条说了算 —— 键是调用方回灌水位用的，
//    一条源只能有一个水位）；② **把被丢掉的源报进回值** `droppedSources`，调用方能看见
//    "这份账本里有同名条目，第二条的规则没被结算"。**报出来**才叫不静默。
function sourceKeyOf(actorKey, entryId) { return str(actorKey) + '|' + str(entryId); }
// 一条 flow 的身份：**源 + 该源内的数组下标**。同一个源里下标唯一，两个源之间靠 sourceKey 分开。
function flowKeyOf(actorKey, entryId, i) { return sourceKeyOf(actorKey, entryId) + '|' + Number(i); }
// 这一格网格上**第一条**严格晚于 `after` 的边界（`anchor` 是网格起点，**不动**）。
// 这就是"这一条规则下一条待结的锚点"：日号跟着**规则**走（`01-31` 的下一条是 `02-28`，
// 再下一条回到 `03-31`），而不是跟着"上次结到哪天"走（那条就是棘轮）。
function nextGridAt(anchorText, afterText, inc) {
  const anchor = parseIsoDate(anchorText);
  const after = parseIsoDate(afterText);
  if (!anchor || !after) return '';
  const months = (after.y - anchor.y) * 12 + (after.mo - anchor.mo);
  const ceiling = inc.months
    ? Math.floor(months / inc.months) + 2
    : Math.floor(daysBetween(anchor, after) / inc.days) + 2;
  for (let k = 1; k <= ceiling; k++) {
    const at = inc.months ? shiftDate(anchor, inc, k) : shiftDaysAbs(anchor, inc.days * k);
    if (!at) return '';
    if (at > afterText) return at;
  }
  return '';
}

// 锚点：**从 `anchor` 起、严格晚于 `through` 的到点日，直到 `today` 为止**（窗口 `(through, today]` 里的整期）。
// 这就是"这一期该补哪几笔"。两处刻意的选择（都写在 planSettlement 的长注释里）：
//   · `anchor` 是**网格起点**（规则自己那条线），**不跟着结算往前挪** ⇒ 日号跟着规则走；
//   · `through` 是"已经结到哪天" ⇒ 已结的期不再重发（不然日结会重复、月结会跳期）。
// ⚠️ 期数**不许当上限用**：跳 13 个月就要补 **13** 次（brief §2.2 点名：不许合并成一笔 ——
//    月供合并成一笔巨款、且每月的方向/金额可能不同）。这里**没有"最多补 N 期"**这种东西，
//    上界只是"网格上不可能有更多期"的估算，落日期时再逐条筛。
function dueDatesAfter(anchorText, throughText, todayText, inc) {
  const anchor = parseIsoDate(anchorText);
  const today = parseIsoDate(todayText);
  if (!anchor || !today) return [];
  const months = (today.y - anchor.y) * 12 + (today.mo - anchor.mo);
  const ceiling = inc.months
    ? Math.floor(months / inc.months) + 2
    : Math.floor(daysBetween(anchor, today) / inc.days) + 2;
  const out = [];
  for (let k = 1; k <= ceiling; k++) {
    const at = inc.months ? shiftDate(anchor, inc, k) : shiftDaysAbs(anchor, inc.days * k);
    if (!at) break;
    if (at > todayText) break;                       // 越过"今天" ⇒ 后面的也越过，停
    if (at > throughText) out.push(at);               // 窗口 (through, today] 里的整期
  }
  return out;
}

function buildDue(actorKey, entryId, f, i, at, period, era) {
  const pn = num(f.amount);
  const dir = str(f.direction);
  const kind = str(f.kind);
  const to = str(f.to).trim();
  const perWord = tw(PERIOD_TERM_KEYS[period], era);
  const due = {
    actorKey: actorKey,
    // 一笔周期账的事由：**自动生成**（懂这一档话的人能看懂的一句话）
    reason: tw('settleReason', era) + (perWord ? '（' + perWord + '）' : ''),
    at: at,                                        // ★ 这一期的**到点日**，不是 today
    direction: DIRECTION_WORDS.indexOf(dir) >= 0 ? dir : 'in',
    amount: Number.isFinite(pn) ? pn : 0,
    kind: KIND_WORDS.indexOf(kind) >= 0 ? kind : 'cashflow',
    // 哪一条 flow：数组下标（确定性、幂等 —— 同一份账本同一期永远同一个 key）
    flowIndex: i,
    flowKey: str(f.key).trim(),                    // flow 自己写的 key（没有就是空串）
    flowIdentity: flowKeyOf(actorKey, entryId, i),
    period: period,
  };
  if (entryId) due.entryId = entryId;              // 挂在条目上的吞吐 → 带上是哪一条
  if (due.direction === 'transfer' && to) due.to = to;   // 转移必须给出去处（第二道闸）
  return due;
}

// ---------------------------------------------------------------------------
// 计划：`planSettlement(ledger, { today, lastAt, period, era, sourceState })`
// ---------------------------------------------------------------------------
// 返回 `{ due, skipped, reason, today, period, era, sources, flowWatermarks, droppedSources }`
// （**只有这九格**，没有 `lastAt` —— 见下）。
//   · `due`：该补的每一期（形状见 `buildDue`），**每一项都能原样喂给 `appendFlow`**；
//   · `skipped`：这次没有该记的账（**四种原因分得开**，见 `reason`）；
//   · `reason`：`skipped` 为真时的那一句真话（三档各一份，从词表取）；有账要记时留空串；
//   · `today`：**原样**带回调用方给的剧情日期（空就是空 —— 绝不替它编一个）；
//   · `period`：这次用的**兜底档**（入参给什么报什么，没给报缺省 `month`）——
//     它是"视角/默认值"，**不是**任何一条 flow 的结算粒度（那个由 flow 自己说，见 `periodForFlow`）；
//   · `era`：这次用的三档档位（没给 = `modern`）；
//   · `flowWatermarks`：**要存回去的那一格**（逐规则两水位，见下）；
//   · `sources`：源级汇总 —— ★ **E2 起降级为只读诊断**（见下）；
//   · `droppedSources`：★ **E2 新增**，被去重丢掉的源（同名 / 缺 id 的条目），只读诊断。
//
// ★★ **只把 `entries[j].flows` 当周期规则 —— 不扫 `actors[k].flows`**（§3.11.2）：
//    设计里**没有"actor 级规则"这一概念**：统现实体模型（§3.11.2）的 `flows` 挂在**实例**上；
//    而 `actors[k].flows` 是**账**（流水）—— `appendFlow` 是它唯一的写者，面板把它印成「最近两笔」。
//    把账当规则扫，"读-算-写回同一处"就会自乘：合规账本（条目上 1 条月结）逐次结算会落成
//    1→3→7→15 笔（**每一轮把上一轮落的账再当规则结一遍**），用户手动记的一笔一次性支出
//    也会在一个月后被当月结周期账再发一次。所以这里**一条 actor 级 flows 都不读**。
//    （`test/asset-settlement.test.js` 有一条"跑两轮"的自反针脚钉这件事。）
//
// ★★ **`today` 为空 ⇒ 不推进、不产 `due`**（brief §2.1，本任务最重要的一条）：
//    拿不到剧情日期时**宁可不结**。三条都不许：
//      ① 用系统日期兜底当"今天" —— **那是给一笔账编一个日子**（铁律 6 的近亲）；
//      ② 推进 `lastAt` —— 推进了就**再也补不回来**（下次调用会以为这段已经结过了）；
//      ③ 返回一份"看起来正常"的 `due`。
//    ⚠️ **与 `medical-store.js:348` 的"系统日期兜底"的区别**（brief 点名要写进注释）：
//       那边 `advanceConditions` 的兜底是它那一层的**总览显示**口径（拿不到剧情日期就按
//       系统日期显示"今天是哪天"，不落任何账）；**本层要动账**。
//       **结算要动账，动账不许编日子** —— 所以同一条"今天"在那边可以兜底，在这里不行。
//    "不推进 `lastAt`"在实现上就是：**返回值里根本没有 `lastAt` 这一格**。
//    我没有"写盘"这个动作，唯一能"写"的东西就是返回值；不给新的 `lastAt`，
//    调用方就只能原样保留它自己那份 —— 这是本层唯一能把这条纪律钉死的形状。
//    所以本函数的返回值键集是**定死的九格**，谁往里加 `lastAt` 就把这条纪律破掉了
//    （`test/asset-settlement.test.js` ① 逐字断言键集）。
//
// ★★ **单一水位不够用 —— 每条规则各存一对水位（这条是复查补的）**：
//    "上次结到哪天"只有一个数时，两种推法都撞墙（都实测过）：
//      · 推到 `max(due.at)` ⇒ **月结锚点被结算日吃掉**：`01-31 → 02-28 → 03-28 → 04-28`
//        棘轮；日结与月结共存时（今天 3/15、锚点 3/15）下一期是 4/15，**`3/31` 整期丢失**、
//        月结从此落在 15 号；
//      · 推到月结那一笔 ⇒ **日结重复 15 笔**（日结那一支的窗口重新把整段吞一遍）。
//    再推一步：**连"每源一个水位"也不够** —— 同一个条目上完全可以既有日结又有月结，
//    一个数要么落后（日结重复）要么超前（月结跳期）。所以水位的粒度是**每一条规则（flow）**，
//    每条规则存**两个日期**（都是真实的日期，一个都不编）：
//      · `anchor`：这条规则的**网格起点** —— 它决定"日号"（月结锚在 `01-31`，每一期都是 31 号）。
//        ★ 它**定下来就不动**（回值里原样抄回去），**绝不跟着结算往前挪** ——
//        把锚点挪成"上一期落的那一天"（`02-28`）就正是那条棘轮（`03-28`、`04-28`…）。
//      · `through`：这条规则**已经结到哪天**（窗口的另一头，一轮一轮往前走）。
//    `dueDatesAfter(anchor, through, today)` 取窗口 `(through, today]` 里的整期 ⇒ 两头都钉住：
//    日号跟着规则（**不漂**），已结的期（`through` 以内）**不再重发**。
//
// ★★★ **`flowWatermarks[]` 是调用方唯一要存的那一格**（E2 收窄，brief §2.4.1）。
//    逐规则一项：`{ flowIdentity, sourceKey, actorKey, entryId, flowIndex, flowKey, period,
//    anchor, through, nextAt, advance }`。
//
//    ★ **`sourceState` 的接口：一种粒度、一种写法** ——
//      `sourceState = { [flowIdentity]: { anchor, through } }`，**键只认 `flowIdentity`**
//      （`shen|shop|0`），**值只认 `{ anchor, through }` 对象**（两格都是可选日期串，
//      缺哪一格就哪一格回落 `lastAt`）。
//      · 不认识的键（如 `sourceKey` `shen|shop`）⇒ **当作没给**（退化写法已删，见文件上部）；
//      · 值不是对象（裸日期串）⇒ **当作没给**（它会把锚点与 through 压成一条线 ⇒ 棘轮）；
//      · 什么都没有 ⇒ 逐规则回落入参 `lastAt`（**旧调用方的口径一个字都不变**）。
//
//    ★ **`advance` 是"这份水位能不能存回去"那一格（E2 新增，修 E1 Minor）**：
//      `skipped` / 基线不合法那两档里，水位只是**照实回报**（`anchor` 与 `through` 都是
//      **这次用的那份入参** —— `through` **不前进**），`advance: false` ⇒ **调用方别存**。
//      为什么要有这一格：从前这两档照报"算出来的 `through`"，而调用方"存回去"就把那一段
//      悄悄标成已结了（实测：`today=3/31, lastAt=3/31` + `through=2/28` ⇒ `due=0`
//      但 `through` 前进到 `3/31`）。正常出计划那一档 `advance: true`（那就照旧存
//      `{ anchor, through }`）。`nextAt`（给人看的"下一条待结"）在停档里照旧算得出来。
//
//    ★ **`sources[]` / `nextLastAt` 降级为只读诊断**（E2 收窄）：它**不是**用来喂 `anchor` 的
//      那一格（要存的是上面 `flowWatermarks`）。而且 `sources[].period` 从前取 `flows[0]`
//      的周期 —— 对**混周期源是误导**（同一个条目上既有日结又有月结时，它只报头一条，
//      调用方会以为这一源只有那一个周期）。现在改成 `periods`（**去重后的那一组**，
//      按 `PERIOD_WORDS` 的固定顺序排，确定性）并把 `period` 保留为头一个（兼容只读它的人）。
//      还多一格 `entryIndex`（这条源在 `bucket.entries` 里的下标）—— 它让诊断能与
//      `droppedSources[].keptEntryIndex` 对上（"留下的是哪一条、丢的是哪一条"）。
//      `nextLastAt` = 这一源里**最早**的那条规则的 `through`（取最早才不漏期）；
//      这一源一条规则都没有时报它这次用的 `through`（**不报空串** —— 空串会让"存回去"丢掉水位）。
//
//    **调用方契约（三条，写死在这里；对应 `test/asset-settlement.test.js` 的 E2 针脚）**：
//      ① **`lastAt` 仍然必填**。它是**逐规则水位的兜底**：某一条规则在 `sourceState` 里
//         没有自己的那一格时，`anchor`/`through` 都回落它。所以 `lastAt: ''` 时本层
//         **什么都不算**（`settleNoBaseline`），哪怕 `sourceState` 里水位齐全 ——
//         这是**有意的**：真独立于 `lastAt` 就得让"没有水位的新规则"有一个落点，
//         而那个落点只能靠编（本层不许编日期）。`sourceState` **不能替代** `lastAt`。
//      ② **`skipped` 档（含基线不合法那档）的水位别存**：看 `flowWatermarks[].advance`，
//         假就别存。这两档里**什么都没发生**（`due` 空、`through` 也没往前挪）。
//      ③ **第一次调用给的 `lastAt` 会永久钉住锚点** ⇒ 必须在**任何有损水位出现之前**
//         就启用 `sourceState`。理由：锚点是"第一条规则第一次被看见时的 `lastAt`"，
//         从那一刻起再也不动（那是它防棘轮的机制）。若起点本身已经是**被夹取过**的日期
//         （`2026-02-28` 而不是 `2026-01-31`），那个 `28` 号就被**烤进**锚点，
//         此后每一期都落在 28 号 —— 原日号再也回不来。所以：**先给 sourceState，再谈结算**。
//
//    ⚠️ 水位是**规划**用的，不是"已经落账"的宣告：调用方只在**真落完账**之后才许把它存回去
//       （本层只算不写，`appendFlow` 是唯一写者）。
//    ⚠️ `sources` / `droppedSources` 是**只读诊断**：成员**不随 due 变**（同一份账本永远是
//       同一批源），所以 `sources` 同时是"这份账本有哪些周期规则"的清单；
//       `droppedSources` 是"哪些条目因为同键被丢掉了"的清单。**两格都不许拿去喂 `anchor`。**
//
// ★★ **`flows[].at` 的语义（E2 裁定，写死在这里，谁也不许再分叉）**：
//    `flows[].at`（如果写了）是**那一条账自己说的"它发生在哪天"** —— 它是**已落账流水的
//    发生日**，只在"账"那一层有意义（投影 `asset-project.js:580-581` 把它当发生日印出来
//    是对的）。它**不是规则的一部分**：周期规则的到点日**只能**由 `anchor` + 周期算
//    （§15.4「起点按到点周期算，不按"现在"算」）。所以本层**一个字都不读 `f.at`**。
//    两处可以不一致，而且**不一致是正常的**：规则锚在 `01-31`、而 2 月那一期的到点日
//    是 `02-28`（夹到月末）—— 有人照着到点日手记一笔 `at: '2026-02-28'`，
//    若把 `f.at` 当锚点，日号当场从 31 漂到 28（那条棘轮）。一个数只能有一个来路：
//    **发生日看 `at`，到点日看 anchor**。
//
// 判据顺序（与 `appendFlow` 的错码顺序同一条思路：先说最靠前那件事）：
//   ① `today` 空 ⇒ 不结（`settleNoToday`），**水位也一格都不报**（没什么可存的）
//   ② `lastAt` 空 / `today` 格式不合法 ⇒ 算不了（分别是 `settleNoBaseline` / `settleNoToday`）
//   ③ `lastAt === today` ⇒ 同日重复，`skipped: true`（`settleAlready`）—— 但 `sources` 照报
//      （同日重复时"下一条锚点"仍然是可算的，调用方拿它才推得动），水位带 `advance: false`
//   ④ 否则：逐 actor、逐**条目**、逐 flow、逐到点期，出 `due`（并按源汇总水位）
function planSettlement(ledger, opts) {
  const o = isObj(opts) ? opts : {};
  const today = str(o.today).trim();
  const lastAt = str(o.lastAt).trim();
  const fallback = str(o.period);
  const era = eraOf(o.era);          // 三档用语：调用方给档位（没给 = 现代档）
  const L = isObj(ledger) ? ledger : {};
  // ★★ 水位：**一种粒度、一种写法**（E2 收窄）——
  //    键只认 `flowIdentity`（`shen|shop|0`）、值只认 `{ anchor, through }`。
  //    别的键（含旧的 `sourceKey` 粒度）与别的值（裸日期串）一律**当作没给**，回落 `lastAt`。
  //    为什么删掉那两种退化写法而不是留着并注释一句"别用"：它们不是"更省事的等价写法"，
  //    是**把两条独立的线压成一条**（裸串把 anchor 与 through 顶成同一个值 ⇒ 棘轮）
  //    或**一个数喂多条规则**（sourceKey ⇒ 混周期必错）。留着迟早有人图省事用上。
  const perFlow = isObj(o.sourceState) ? o.sourceState : null;
  const result = (due, skipped, reason) => ({
    due: due, skipped: skipped, reason: reason, today: today,
    period: periodForFlow(null, fallback), era: era,
    sources: [], flowWatermarks: [], droppedSources: [],
  });

  // ① 拿不到剧情日期：**一笔都不结**，也**不给新的水位**（见上面的长注释）
  if (!today) return result([], true, tw('settleNoToday', era));
  // ② 起点（`lastAt`）拿不到 —— 没有锚点就算不出"到点日"。**不许拿系统日期顶**（同上）。
  //    ★ E2 把这条**写死并加针脚**（brief §2.4.2 的第三条 Minor）：它是**逐规则水位的兜底**，
  //      所以 `sourceState` 里水位再齐也**替代不了**它 —— 见上面契约 ①。
  if (!lastAt) return result([], true, tw('settleNoBaseline', era));
  if (!parseIsoDate(today)) return result([], true, tw('settleNoToday', era));
  // ③ 同日重复调用：已经结过了，别让调用方以为"该推进时间戳"
  const repeated = (lastAt === today);
  // ④ 起点格式不合法（反查过的不存在日期 / 别的形状）⇒ 算不了，理由同上。
  //    ⚠️ 但仍然把 `sources` 报出来：**每条源自己的水位**可能合法（`sourceState` 里那份），
  //       不能因为"全局那一个不合法"就假装这份账本没有周期规则。
  const badBaseline = !parseIsoDate(lastAt);
  // 这两档里**什么都没发生** ⇒ 水位只照实回报、**一格都不许存回去**（`advance: false`）。
  const stalled = repeated || badBaseline;

  // 逐 actor、逐**条目**收源。**只收条目级**（`entries[j].flows`）——
  // `actors[k].flows` 是**账**（`appendFlow` 唯一的写入处），当规则扫会自乘（见上）。
  //   · `entryId` 带上（`appendFlow` 的"动的是哪一条"）；
  //   · 同一 actor 下的**每一条条目各是一个源**；缺 `id` 的条目也不算"没有源"
  //     （`sourceKey` 里带 actorKey，所以不同 actor 不会撞键）。
  //   · ★ 同键（同名 / 都缺 id）的第二条会被去重 —— 键是调用方回灌水位用的，一条源一个水位。
  //     但**被丢掉的源报进 `droppedSources`**（E2 修 E1 Minor：静默去重连"发生过"都看不出来）。
  const actors = isObj(L.actors) ? L.actors : {};
  const seen = {};
  const sources = [];
  const dropped = [];
  for (const actorKey of Object.keys(actors)) {
    if (!str(actorKey).trim()) continue;            // 空键 = 凭空造一个人（`appendFlow` 第四道闸挡它）
    const bucket = isObj(actors[actorKey]) ? actors[actorKey] : {};
    let j = -1;
    for (const e of arr(bucket.entries)) {
      j += 1;
      if (!isObj(e)) continue;
      const entryId = str(e.id).trim();
      const key = sourceKeyOf(actorKey, entryId);
      if (seen[key]) {
        // 第二条（及以后）同键条目：**不结算**（第一个说了算），但把"它存在"报出去
        dropped.push({
          sourceKey: key, actorKey: actorKey, entryId: entryId, entryIndex: j,
          keptEntryIndex: seen[key].entryIndex, flows: arr(e.flows).length,
        });
        continue;
      }
      const src = { sourceKey: key, actorKey: actorKey, entryId: entryId, entryIndex: j, flows: e.flows };
      seen[key] = src;
      sources.push(src);
    }
  }
  // 水位：**逐规则**（`flowIdentity`）优先，值只认 `{ anchor, through }`；
  // 没给 / 给了认不出的形状 ⇒ 两条都回落入参 `lastAt`（旧口径，一个字不变）。
  const stateOf = flowIdentity => {
    const picked = perFlow ? perFlow[flowIdentity] : null;
    const obj = isObj(picked) ? picked : null;      // 裸日期串等退化写法 ⇒ 当作没给（见文件上部）
    if (!obj) return { anchor: lastAt, through: lastAt };
    const rawAnchor = str(obj.anchor).trim();
    const rawThrough = str(obj.through).trim();
    return {
      anchor: (rawAnchor && parseIsoDate(rawAnchor)) ? rawAnchor : lastAt,
      through: (rawThrough && parseIsoDate(rawThrough)) ? rawThrough : lastAt,
    };
  };
  const due = [];
  const flowWatermarks = [];
  const sourceMarks = [];
  for (const src of sources) {
    const flows = arr(src.flows);
    let earliest = '';                             // 这一源里**最早**的那个 through（源级汇总）
    const periods = [];                            // 这一源里出现过的周期（**去重、定序**）
    flows.forEach(function (f, i) {
      if (!isObj(f)) return;                       // 不是对象的那一格：既不算规则，也不占水位
      const period = periodForFlow(f, fallback);
      const inc = PERIOD_INCREMENTS[period];
      const identity = flowKeyOf(src.actorKey, src.entryId, i);
      const st = stateOf(identity);
      const dates = dueDatesAfter(st.anchor, st.through, today, inc);
      if (!repeated && !badBaseline) {
        for (const d of dates) due.push(buildDue(src.actorKey, src.entryId, f, i, d, period, era));
      }
      const settled = dates.length > 0;
      // ⚠️ **停档（`repeated` / `badBaseline`）里 `dates` 是照算的**（`sources` 的"下一条锚点"
      //    要照常给人看），但这一档**什么都没结** ⇒ 回值里要存的那一格必须报**入参那份**
      //    （E2 修 E1 Minor：从前照报 `dates` 的最后一期 ⇒ 调用方"存回去"就把今天那期
      //     悄悄标成已结）。给人看的 `nextAt` 照旧用算出来的 `through` 推 —— 那是"下一步该结哪儿"。
      const through = settled ? dates[dates.length - 1] : st.through;
      const storedThrough = stalled ? st.through : through;
      // 这条规则**下一条待结的锚点**（给人看的 `nextAt`）：网格上严格晚于**已结到的那一天**
      // 的第一条边界。⚠️ 这里喂的是 `storedThrough`（**停档里 = 入参那份**）：停档什么都没结，
      // 下一条待结的当然还是"入参那份之后的第一个边界"（拿算出来的那一期去推，会多跳一期 ——
      // `through=2/28` 时 nextAt 该是 3/31；错用 3/31 去推就得到 4/30，正好跳过待结的那一期）。
      // ⚠️ 但**回值里要存回去的 `anchor` 是 `st.anchor` 本身（网格起点，始终不动）** ——
      //    一旦把锚点挪成"这一期落的那一天"，日号就开始漂（`01-31 → 02-28 → 03-28` 那条棘轮）。
      //    锚点与 `through` 是**两条独立的线**：锚点管"日号"，`through` 管"结到哪儿了"。
      const nextAt = nextGridAt(st.anchor, storedThrough, inc);
      // ★★ **源级汇总也走 `storedThrough`（修复轮 1/5 · Minor-2）**：从前这一句用的是
      //    算出来的 `through` ⇒ 停档里 `flowWatermarks[].through` 不前进（上面修好了），
      //    而 `sources[].nextLastAt` **照旧前进** —— 而**老契约里 `nextLastAt` 正是
      //    "下一轮该喂回的下界"**，"只读诊断"这个新身份挡不住误用（调用方照老契约读它，
      //    就会把"今天那一期"当成已结喂回去）。两处**必须同源**：一个数的两个出口不一致，
      //    迟早有人读错那一个。
      if (!earliest || storedThrough < earliest) earliest = storedThrough;
      if (periods.indexOf(period) < 0) periods.push(period);
      flowWatermarks.push({
        flowIdentity: identity,
        sourceKey: src.sourceKey, actorKey: src.actorKey, entryId: src.entryId,
        flowIndex: i, flowKey: str(f.key).trim(), period: period,
        anchor: st.anchor,               // ★ 网格起点：**原样抄回**，下一次继续用它（日号靠它不漂）
        through: storedThrough,          // 已经结到哪天（**停档里 = 入参那份**，没前进）
        nextAt: nextAt,                  // 下一条待结的网格边界（给人看；喂回去的是上面那一对）
        // ★ **advance：这份水位能不能存回去**（E2 新增）。`skipped` / 基线不合法那两档里
        //   什么都没发生 ⇒ 假；调用方"存回去"就把这一段悄悄标成已结（E1 Minor 实测的形态）。
        advance: !stalled,
      });
    });
    // 源级汇总（**只读诊断**，别拿去当 anchor）：`nextLastAt` = 这一源里**最早**的那条规则的
    // `storedThrough`（取最早才不漏期；**停档里 = 入参那份**，与 `flowWatermarks[].through` 同源 ——
    // 见上面 `earliest` 那一句的注释）；这一源没有规则时报它这次用的 through —— **不是空串**
    // （空串会让调用方"存回去"时把水位丢掉）。
    // `periods` = 这一源里出现过的周期（去重、按 `PERIOD_WORDS` 的固定顺序排）——
    // 从前这格是 `periodForFlow(flows[0], fallback)`（只报头一条），混周期源上是**误导**。
    periods.sort((a, b) => PERIOD_WORDS.indexOf(a) - PERIOD_WORDS.indexOf(b));
    sourceMarks.push({
      sourceKey: src.sourceKey, actorKey: src.actorKey, entryId: src.entryId,
      entryIndex: src.entryIndex,
      period: periods[0] || periodForFlow(null, fallback),
      periods: periods,
      nextLastAt: earliest || lastAt,
    });
  }
  // `flowWatermarks` = 逐规则的两条水位（**要存的就是它**）；`sources` = 源级汇总（只读诊断）。
  const out = sourceMarks;

  const pack = (dueList, skipped, reason) => ({
    due: dueList, skipped: skipped, reason: reason, today: today,
    period: periodForFlow(null, fallback), era: era,
    sources: out, flowWatermarks: flowWatermarks, droppedSources: dropped,
  });
  if (repeated) return pack([], true, tw('settleAlready', era));
  if (badBaseline) return pack([], true, tw('settleNoBaseline', era));
  return pack(due, due.length === 0, due.length === 0 ? tw('settleNothing', era) : '');
}

// ---------------------------------------------------------------------------
// 视角（E3）：把**已经落账**的流水按视角粒度聚合（§15.9）
// ---------------------------------------------------------------------------
// ★★ **视角不是结算周期**（§15.9 开头那张表，逐字）：
//      · **结算周期** = 何时把该记的账记上（记账的节拍）——由**每条 flow 自己声明**，不统一；
//      · **视角**     = 怎么看**已经记下的**账（聚合与对比的粒度）——用户随时切。
//    混成一件就会出现"切到周视角 ⇒ 月例变成每周发一次"。所以本函数**只读**已落账的流水：
//    零写入、零计划、**一个字都不碰 `planSettlement`**，也绝不给任何一条 flow 编日期
//    （日期认不出来的那一条**不进任何一格**，绝不拿别的日子顶它）。
//
// ★ 承 §15.9 要求④「稀疏粒度明说，**不许摊平**」：一条月结的流水在 `grain:'day'` 下
//   **只落在它自己那一天那一格**，其余格是 `hasRecord:false`（面板上写"本期无记录"），
//   **绝不 `/30`**。摊平 = 编造数据（与"不可估值就明说、不编数字"是同一条立场）。
//
// ★★ **`0` 与"无记录"必须可区分**（本仓为这一类栽过多次：补出来的 `0` 被当真价、
//    "估不出来"被印成"净资产：0"）。每一格因此带两格：
//      · `hasRecord:true, count:n(>0), cashflow:0` ⇒ **有记录、净额恰好是 0**（照旧是 0）；
//      · `hasRecord:false, count:0,       cashflow:0` ⇒ **这一段本来就没有记录**。
//    两者都在返回值里，**谁都不许把后者写成 0**（面板那一侧也各说各的话）。
//
// ★ 网格（边界从哪儿算）：
//    · `day` / `month` / `quarter` / `year` 走**日历**边界（月/季/年的第一天到最后一天）——
//      §15.9 要求③的期初/期末与"这个月比上个月差一半"说的都是日历期；
//    · `week` 按**剧情日历的 7 天**（§15.9 末条）：以 `anchorDate` 为界的 7 天块，
//      **不引入 ISO 周**（ISO 周会与剧情日冲突）。
//    ⚠️ 相邻两格**互不重叠**：前一段的 `bucketEnd` 之后一天就是后一段的 `bucketStart`
//      ⇒ **边界那天只算一次**（E2 复审逮到过"两段端点重合 ⇒ 同一笔账被两段各数一遍"，
//      同一个坑在这里也钉死）。
//
// ★ **不完整周期**：`partial = bucketEnd > today`（`today` **由调用方给** —— 本层不读时钟，
//   与 `planSettlement` 同一条纪律）。一格 `partial:true` 就是 §15.9 要求②说的"还没走完，
//   面板上要标「截至今日」"。
//
// ★ 返回**连续的一整串**（中间一格都不跳）：空期也照样在返回值里（`hasRecord:false`）。
//   理由不是"图好看"—— 跳格会让"上一段"落到更早的一格上，那是把"没有可比"说成"比过了"。
//
// ⚠️ **纯函数**：入参 `flows` / `opts` 一个字都不改（下面只读它们），不碰存储、不碰 DOM、
//    不读时钟、不写全局。返回的每一格都是**新对象**。
// ⚠️ 入参形状以**账本里那份流水**为准：`at`（`YYYY-MM-DD`）/ `amount` / `direction` / `kind`
//    —— `kind` 与符号一律交给账本层的 `sumFlows`，本层不认第二遍。
function lastDayOfMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }
// 某一天**落在哪一格**（含两端）：day / month / quarter / year 走日历边界；
// week 走"以锚点为界的 7 天块"（`anchor` 必须是 `parseIsoDate` 的产物）。
function spanOfGrain(anchor, grain, p) {
  const y = p.y; const mo = p.mo; const d = p.d;
  if (grain === 'day') return [isoOf(y, mo, d), isoOf(y, mo, d)];
  if (grain === 'month') return [isoOf(y, mo, 1), isoOf(y, mo, lastDayOfMonth(y, mo))];
  if (grain === 'quarter') {
    const qm = Math.floor((mo - 1) / 3) * 3 + 1;                 // 1 / 4 / 7 / 10
    return [isoOf(y, qm, 1), isoOf(y, qm + 2, lastDayOfMonth(y, qm + 2))];
  }
  if (grain === 'year') return [isoOf(y, 1, 1), isoOf(y, 12, 31)];
  // week：第 k 块 = `(anchor + 7(k-1) 天, anchor + 7k 天]`（`k = ceil(天数差 / 7)`）。
  // 日号跟着**锚点**走 —— 锚点是自己那一块的末日（所以"本周"= 以今天收尾的那 7 天）。
  const k = Math.ceil(daysBetween(anchor, p) / 7);
  return [shiftDaysAbs(anchor, 7 * (k - 1) + 1), shiftDaysAbs(anchor, 7 * k)];
}
function aggregateFlows(flows, opts) {
  const o = isObj(opts) ? opts : {};
  // 粒度：只认 `PERIOD_WORDS` 里那五档（**与结算周期同一套词**，不自造第四套枚举），
  // 认不出的（含没给）落 `DEFAULT_PERIOD` = 月 —— §15.9 末条"第一版默认月"。
  const grain = PERIOD_WORDS.indexOf(str(o.grain)) >= 0 ? str(o.grain) : DEFAULT_PERIOD;
  // 锚点：网格的起点（week 那一档靠它定界）。没有锚点就没有网格 ——
  // 宁可不聚合，也不自己编一个起点（"不编日子"）。
  const anchor = parseIsoDate(o.anchorDate);
  if (!anchor) return [];
  // "今天"：**调用方给的**（不读时钟）。给不出 ⇒ 谁也不许判"这一段走完了"（partial 全假）。
  const todayText = parseIsoDate(o.today) ? str(o.today).trim() : '';
  const items = [];
  for (const f of arr(flows)) {
    if (!isObj(f)) continue;
    const at = str(f.at).trim();
    if (!parseIsoDate(at)) continue;                 // 日期认不出 ⇒ 这一条哪一格都不进
    items.push({ at: at, f: f });
  }
  // 确定性：先按日期排（同一天保持原序 —— `Array#sort` 在 V8 里是稳定的）
  items.sort((a, b) => (a.at < b.at ? -1 : (a.at > b.at ? 1 : 0)));
  if (!items.length && !todayText) return [];
  const firstAt = items.length ? items[0].at : todayText;
  const lastAt = items.length ? items[items.length - 1].at : todayText;
  // 覆盖范围：从**最早一条流水**那一格，到 max(最晚一条流水, 今天) 那一格
  const endAt = (todayText && todayText > lastAt) ? todayText : lastAt;
  const lastEnd = spanOfGrain(anchor, grain, parseIsoDate(endAt))[1];
  const buckets = [];
  let span = spanOfGrain(anchor, grain, parseIsoDate(firstAt));
  let i = 0;
  // `guard` 只是防呆（网格推不动时不许转死）；正常路径一格一格走到 `lastEnd` 就收。
  for (let guard = 0; guard < 400000 && span[1] <= lastEnd; guard++) {
    const inBucket = [];
    while (i < items.length && items[i].at <= span[1]) {
      if (items[i].at >= span[0]) inBucket.push(items[i].f);
      i++;
    }
    // ★ 求和**只有一处**：账本层的 `sumFlows`（它内部走 `flowKind` / `flowSigned`）。
    //   取不到就整段降级 —— 本层绝不自己写一份"入为正、出为负"。
    const sums = (LEDGER && typeof LEDGER.sumFlows === 'function') ? LEDGER.sumFlows(inBucket) : null;
    if (!isObj(sums)) return [];
    const v = k => { const n = num(sums[k]); return Number.isFinite(n) ? n : 0; };
    const balance = v('balance'); const cashflow = v('cashflow'); const reserve = v('reserve');
    buckets.push({
      bucketStart: span[0], bucketEnd: span[1],
      balance: balance, cashflow: cashflow, reserve: reserve,
      net: balance + cashflow + reserve,
      count: inBucket.length,
      hasRecord: inBucket.length > 0,                // ★ "有记录"与"净额为 0"是两件事
      partial: !!(todayText && span[1] > todayText), // ★ 这一段还没走完
    });
    if (span[1] === lastEnd) break;
    span = spanOfGrain(anchor, grain, parseIsoDate(shiftDaysAbs(parseIsoDate(span[1]), 1)));
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------
// 挂载点与 terms / ledger / core / project 同一族：真机上本文件在 `project` **之后**、`store` 之前
// 执行（`scripts/build-artifact.js` 的 `sources` 里的位置才是权威；本层只依赖词表，位置本就自由）。
// 调用方（结算动作 / 面板 / E2 总览 / E3 视角）从 `__LA_ASSET_SETTLEMENT__` 取。
const api = {
  PERIOD_WORDS, PERIOD_TERM_KEYS, DEFAULT_PERIOD,
  // ★ **E2 补进来的一格**：E1 当初只导出了 `PERIOD_TERMS` 那一族，**没导出增量表** ——
  //   而"某一条 flow 的周期是多少天/多少月"**只有这一份**（`PERIOD_INCREMENTS`）。
  //   总览要在"这一段"这个窗口上算净额（E2），就必须拿到它 —— 否则调用方只能自己写一份
  //   `{ month: 1 }`，那正是"同一个东西两种说法"（E1 的注释已经预告过：E2/E3 要对
  //   "某一期的到点日"说话时**必须**用这里同一份日历口径）。
  //   ⚠️ 是**导出**不是复制：本文件里那张表仍是唯一的一份，别处都不许再写一遍。
  PERIOD_INCREMENTS,
  planSettlement,
  // 两个底层件也交出去：E2/E3 要对"某一期的到点日"说话（总览的周期区间、视角的分桶边界），
  // 那时**必须**用这里同一份日历口径 —— 谁也不许在别处再写一份"加一个月是多少天"。
  parseIsoDate, shiftDate,
  // 也交出去：E2/E3 要把 `flowWatermarks` 的 `{ anchor, through }` 存下来再喂回 `sourceState`，
  // 攒这份 state 的键必须和本层**同一份算法**（别在调用方再拼一次字符串）。
  // ⚠️ **键只认 `flowKeyOf` 那一份**（E2 收窄：一种粒度一种写法）——
  //    `sourceKeyOf` 只留给"条目/源"那一层报数与对账（`sources[]` 的诊断），**别拿它当水位键**。
  sourceKeyOf, flowKeyOf, dueDatesAfter, nextGridAt,
  // ★ **E3 补进来的一格**：视角（§15.9）——把**已经落账**的流水按视角粒度聚合成一串格子。
  //   它**只聚合、不产生新账**：本层里 `planSettlement` 那一半（结算周期）与它
  //   **没有任何调用关系**（视角切一次，账本一个字节都不动）。
  //   面板只从这一格取"这一段从哪天到哪天、三档各多少、有没有记录、走完没有"。
  aggregateFlows,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  rt.__LA_ASSET_SETTLEMENT__ = api;
}

})();

  return module.exports;
})();
