/* ========================================================
 * asset-ledger.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-ledger.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-keys.js
 * 【上游定位】asset-ledger.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-keys.js';

const __REQ = {
    './asset-keys.js': () => __assetDep0,
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
/* src/modules/asset/asset-ledger.js */
'use strict';

// ============================================================================
// 资产模块 · 账本层（流量三档 / 求和 / 账务事务层）
// ----------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md` §3.11.2（flows 按周期进账）、§9（写回门）、
//       §15.8（转移留痕：无金钱往来时 amount = 0，但**必须留痕**）。
//
// **为什么单独一层**（`scripts/build-artifact.js` 的 sources 里本文件排在
// `asset-core.js` **之前**）：core 的 `normalizeItem` 要用本层的 `normalizeFlowList` ——
// **core 依赖本层**；反过来本层一个字都不依赖 core（依赖在前，是这份 bundle 的排布规矩，
// 也是"改 core 之前先拆出账本层"那条 Ruling 的形状）。所以本层只管"账本 / 流量"这一摊，
// 不碰实体模型的分类模板 / state / stock。
//
// 本层同时是几个**通用小工具**（isObj / arr / str / num / flatten / cloneList）的所在地，
// core 从这里取它们（它在上）。这些都导出在 api 上：浏览器里 core 只能从
// `window.parent.__LA_ASSET_LEDGER__` 拿到本层 —— bundle 里每个源文件各自一个作用域，
// 没有别的通道（与 terms / core 各自的挂载同一个形状）。
//
// 这里面全是**纯函数**：收一份数据 → 回一份新的，入参一个字都不改（B3 的针脚盯着这条）。
// 不碰存储、不碰 DOM；本文件里不出现任何面板结构词的字面量（`asset-terms.test.js` 会扫）。
// ============================================================================

// ---------------------------------------------------------------------------
// 键写入原语（`asset-keys.js`）：**排在资产块最前面**（本层之前）
// ---------------------------------------------------------------------------
// 本层是 asset 族最底下那一层：`flatten` 的产物遍布全族，账本的 `actors` 桶也在这里拼。
// 两处的键都可以是**用户可控字符串**（actor 键 = 人名）⇒ 写入一律走那一份原语。
// ⚠️ **取不到时退成一份形状完全相同的内联实现**（本层不许在顶层抛：几十个模块拼在同一个
//    脚本里，顶层一抛后面的一起死）。两条路写的是同一件事，不是第二份判断。
const KEYS = (function resolveKeys() {
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-keys.js');
  } catch (e) { /* 浏览器/裁剪产物里没有 require —— 落到下面 */ }
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_KEYS__) return rt.__LA_ASSET_KEYS__;
  }
  return null;
})();
const setKey = (KEYS && typeof KEYS.setKey === 'function') ? KEYS.setKey
  : function (o, k, v) {
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
    else o[k] = v;
    return o;
  };

// ---------------------------------------------------------------------------
// 小工具（全部不修改入参）
// ---------------------------------------------------------------------------
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function str(v) { return v == null ? '' : String(v); }
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  return NaN;
}

// 深拷贝（只认 JSON 那几样；环引用不进来，账本本来就是 JSON 存的）
// ⚠️ **键是任意 JSON 键 ⇒ `__proto__` 要特判**：`out['__proto__'] = …` 在裸 `{}` 上是**改原型**
//    而不是加一格 ⇒ 实测输入 own keys `["__proto__","toString","普通"]` 得到输出
//    `["toString","普通"]`，而且**输出的原型被写成了 `{a:1}`**（比"丢一格"更脏）。
//    ⚠️ **这里不能用 `Object.create(null)`**（与 core 的 `seen` 不同）：本层是 asset 族最底下
//    那一层、`flatten` 的产物遍布全族，而且大量针脚拿 `deepStrictEqual`（本仓测试用的是
//    `node:assert/strict`，`deepEqual` 就是它）把产物与**手写的普通对象字面量**逐字对拍 ——
//    换 null 原型会让原型不同 ⇒ **实测 27 条假红**。所以只特判 `__proto__`（造一个**自有可枚举**
//    格，其余照常赋值），`Object.prototype` 一位不动。
//    ★ 这条特判**不再在本层写第二份**：走共享原语 `setKey`（`asset-keys.js`），
//      本文件只留"用哪一份原语"这一个判断（别的层同样如此）。
function flatten(v) {
  if (Array.isArray(v)) return v.map(flatten);
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v)) setKey(out, k, flatten(v[k]));
    return out;
  }
  return v;
}
function cloneList(v, perItem) {
  return arr(v).map(x => (perItem ? perItem(x) : flatten(x)));
}

// 拼一张新的 `actors` 表：**抄一遍旧的**（一格都不许少）再放这一位的桶。
// ⚠️ **不能写成 `Object.assign({}, actors, { [actorKey]: bucket })`**：那两种写法都在
//    计算键上走 `[[Set]]` ⇒ `actorKey === '__proto__'` 时**不是加一格而是改写原型**
//    （实测：输入 own keys `["__proto__","shen"]` 得到输出 `["shen"]`、原型被写成了
//    那一位的桶 ⇒ 整张表在自有键上塌掉，**写盘即毁账**）。
// ⚠️★ **连 `Object.assign({}, actors)` 这一步也不能要**（我第一版就是这么写的，当场被自己的
//    针脚逮住）：`Object.assign` 对源上每一个 own 键都走一次 `[[Set]]` ⇒ 源里那个
//    自有 `__proto__` 键**在拷贝这一步就把原型的归属改掉了**。
//    ★ **G2AB 收口轮更正（复审 §2.3(3) 实测，此前那句读数复现不了）**：这里从前写着
//    "（读数：own keys 已经是 `["shen","__proto__"]`，看着"对了"，可原型已经被写成那一位的桶）"
//    —— **复现不了**：实测 `readLedger().actors` 的 own keys 是 `["__proto__","shen"]`、
//    原型是 `null`；而 `Object.assign({}, actors)` 之后 **own keys = `["shen"]`**
//    （那一格**丢了**，不是"看着对了"）、原型被写成 `{"entries":[{"id":"i9"}],"flows":[]}`。
//    ⇒ 结论（原型确实被改写）不变，**丢掉的那半句归因是错的**：它是"丢一格 + 改原型"两件事，
//    不是"own keys 还全在、只是原型不对"。
//    ⇒ 唯一的正确写法与 `flatten` 一样：**逐个 `setKey` 抄**（`setKey` 对 `__proto__` 走
//    `Object.defineProperty`，造的是自有可枚举格，原型的归属一位不动）。
function withActor(actors, actorKey, bucketValue) {
  const out = copyKeys(actors);
  setKey(out, actorKey, bucketValue);
  return out;
}
// ⚠️ **G2AB 收口轮更正（复审 §3.7 抽测）**：B 轮 brief §1 把"产物被 `deepStrictEqual` 对拍
//    ⇒ 一律走 `setKey` 式"写成了通用规则 —— **规则保守、可以继续用**，但**实测依据只覆盖
//    `flatten` 那一处**。逐处实测：`withActor` 的 `out` 换 null 原型 ⇒ **1 条红**
//    （49/48/1，规则在这一处成立）；`asset.script.js` 的 `copyActorTable` 的 `out` 换
//    null 原型 ⇒ **0 条红**（137/137/0，规则在那一处**不必要**）。
//    ⇒ 再引用那份"27 条假红"时，必须写明**那只是 `flatten` 那一处的读数**。

// **逐格 `setKey` 的浅拷贝 + 覆盖几格** —— 本层与面板层拼"新的一份"时**唯一**该用的写法。
// ⚠️★ **不许退回 `Object.assign({}, src, extra)`**：危险的不是计算键，而是**源自己的自有
//    `__proto__` 键** —— `Object.assign` 对**源**上每一个 own 键走一次 `[[Set]]`（写**靶子**），
//    靶子的继承 setter 当场被触发 ⇒ 那一格**在拷贝这一步就没了**、原型被改写成那一格的值
//    （实测：源 own keys `["__proto__","lin"]` ⇒ `Object.assign({}, src)` own keys `["lin"]`、
//    proto `{…}`）。B 轮第一版就是只换掉最后那句赋值、把源丢给 `Object.assign`，结果不够。
//    来源可以是**存档透传**来的对象（`readLedger()` / `readExtract()` 原样透传自有 `__proto__`）。
//    修法只能是这一条：**逐格 `setKey` 拷进新桶**，再 `setKey` 盖上 `extra` 那几格。
function copyKeys(src, extra) {
  const from = isObj(src) ? src : {};
  const out = {};
  for (const k of Object.keys(from)) setKey(out, k, from[k]);
  if (isObj(extra)) for (const k of Object.keys(extra)) setKey(out, k, extra[k]);
  return out;
}

// 一条流量进哪一档（决策 46）：balance 动存量净值 / cashflow 现金收支 / reserve 只在储备池里进出。
// **缺省 cashflow** —— 老数据没有这一列，而"利息、供养、月租"这类绝大多数条目本来就是现金收支。
// 认不出的档一律回落（绝不留一个系统不认识的档）。
const KINDS = ['balance', 'cashflow', 'reserve'];
const DEFAULT_KIND = 'cashflow';

// 方向的**唯一合法三档**（§15.8）：in 入 / out 出 / **transfer 转移**。
// 从前这里（`normalizeFlow` 里）只认 in / out 两档，这正是 C1 修复轮逮到的那条往返缺陷的根：
// `appendFlow` 明明写下了 `transfer`，一过归一化就被折成 `in`（产物与账本不一致 ——
// 谁把产物写回账本，谁才永久丢掉第三档）。所以档位清单放在这里，`normalizeFlow` 按它认档，
// **三档一个都不许少**。
const DIRECTIONS = ['in', 'out', 'transfer'];

// ---------------------------------------------------------------------------
// 一条流量：形状（amount / direction / kind）与符号
// ---------------------------------------------------------------------------
// 一条流量的归一化：**kind 必填**（决策 46），缺省 cashflow；direction 按 `DIRECTIONS` 认档：
// **`out` → `out`；`transfer` → `transfer`；其余（含认不出的）→ `in`** ——
// 这一条与从前那条"绝不静默记成出"是同一口径，只是第三档现在**在归一化层也存在**了。
// 分类上的默认（side / 默认 kind）留给 `sumNetWorth` 那一步合并 —— 因为实例能不能
// 覆盖要看**模板原件**说没说过话，而不是看归一化之后的默认值。
function normalizeFlow(raw) {
  const f = isObj(raw) ? flatten(raw) : {};
  const amount = num(f.amount);
  f.amount = Number.isFinite(amount) ? amount : 0;
  const dir = str(f.direction);
  f.direction = DIRECTIONS.indexOf(dir) >= 0 ? dir : 'in';
  f.kind = KINDS.indexOf(str(f.kind)) >= 0 ? str(f.kind) : DEFAULT_KIND;
  return f;
}
function normalizeFlowList(list) { return cloneList(list, normalizeFlow); }

// 一条流量进哪一档、正负号（**入为正、出为负、转移不带钱**）。方向看实例，实例没说才用字段默认。
function flowKind(f) { return KINDS.indexOf(str(isObj(f) && f.kind)) >= 0 ? str(f.kind) : DEFAULT_KIND; }
function flowSigned(f) {
  if (!isObj(f)) return 0;
  const n = num(f.amount);
  if (!Number.isFinite(n)) return 0;
  // ★ **转移一律 0**（第二道闸）：§15.8 说转移不是金钱往来 —— 转移金额归零的第一道闸在
  //   `appendFlow`（唯一的写者），这一道防的是**绕过它直接构造**的流量：一条夹带 5000 的
  //   transfer 在"凡不是 out 就算正"的口径下会被算成"给出去的人反而进账"。
  //   两道闸同一个口径，谁也不许只留一道。
  if (str(f.direction) === 'transfer') return 0;
  return str(f.direction) === 'out' ? -Math.abs(n) : Math.abs(n);
}

// 流量三档各求各的（决策 46）。入为正、出为负；金额取绝对值后按方向定号
// （用户把出项写成负数时，方向说了算，不许双重取负）。
// ★ **撤回的流水不进求和**（§9 :895「`voided` 置位而非删除」）：置了位却不跳过，撤回就只是
//   换了个字、数**照旧错**。判据与 `appendFlow` 那一侧同一把尺子（`isVoided`，字面量 true）。
//   ⚠️ `flowSigned` **不动**：它是"**单笔**的符号"（正/负/转移不带钱），"算不算数"是**求和**
//      这一层的事。两件事混进一个函数，将来谁想单独读一笔的符号都会被撤回口径污染。
function sumFlows(flows) {
  const out = { balance: 0, cashflow: 0, reserve: 0 };
  for (const f of arr(flows)) { if (isVoided(f)) continue; out[flowKind(f)] += flowSigned(f); }
  return out;
}

// ---------------------------------------------------------------------------
// 撤回（§9 :895 / Ruling C 的"出口 A"）：**置位，不删任何东西**
// ---------------------------------------------------------------------------
// 唯一判据：`voided === true`（**字面量** true）。与 `ownerLost` / `hidden` / `sum`
// 同一把尺子（core :135 / :165 那几个也是 `=== true`）：**认不得的一律当没标**。
// 两条推论（都是接口契约，不是实现细节）：
//   · 传不传 `voided`，正常记账那条路产出的流水**逐字不变**（老调用方零迁移、零行为变化）；
//   · `voided: 'yes'` / `1` 这种认不出的值 = **当没标** ⇒ 走正常记账那条路（`raw` 里
//     根本不会出现 `voided` 这一格，所以产出的流水与从前逐字相同）。
function isVoided(f) { return isObj(f) && f.voided === true; }

// ★★ **撤回的指认口径**（唯一一份；面板的整批撤回与测试都按它说话）：
//   复合键 = `(actorKey, at, entryId?)` —— `at` 必给，`entryId` 给了才参与比对。
//   为什么是这个形状：`appendFlow` **没有流水级稳定 id**，而 `entryId` 是"**动的是哪一条
//   资产**"（C3 复查定的口径，`asset.script.js` 的 `commitOperation`），**不是"哪一笔流水"**。
//   ⇒ 匹配到 0 笔回 `LA_ASSET_VOID_TARGET_NOT_FOUND`；**匹配到 >1 笔回
//     `LA_ASSET_VOID_TARGET_AMBIGUOUS` —— 宁可回绝，也不许撤错一笔。**
// ★ 整批撤回（§9 原话："一批 12 笔打完勾，事后发现读错"）撤的是**一批**，不逐笔指认：
//   请求里多给一份**批次身份集合** `voidEntries`（`[{ index, at, entryId? }]` —— 这一批真的
//   **落了哪几笔**，由 `appendFlow` 交回来的那一笔自己报）⇒ 集合里每一笔都必须**当场指认得着
//   且仍是现役**，否则整批回绝（**宁可回绝，也不许撤错一笔**）。
//   ⚠️ **身份的承力面是 `index`**（这一笔在 `actors[actorKey].flows` 里的**落位**），
//      `at` / `entryId` 是**校验位**。理由（F4 复核 Important-1 现场核出来的）：
//     `appendFlow` 至今**没有流水级稳定 id**，而 `entryId` 是"动的是哪一条**资产**"，
//     **提取这条路上常常整批都是空的**（面板的提取项目没有 `id` ⇒ `:3107` 那一格根本不写）
//     ⇒ "按 `entryId` 指认"在真实路径上会退化成"按 `(at, 空)` 指认" = 同一天全部撞在一起，
//     指认不出来。而 `flows` 是**只增不删**（撤回也是置位）⇒ **落位是稳定的**，
//     批次当初写的是哪几笔，事后就还是那几笔。
//   ⚠️ **不是"按笔数推断"**：早先那一版只收一个**批次笔数** `voidCount`，拿它跟当下匹配到的
//     笔数逐字对 —— 同一天同一个人先后确认两批时，那个累积值恰好与账本当下对上，于是
//     **想撤 2 笔却把 4 笔全撤了、账净额归零**（F4 复核 Important-1）。
//   ⇒ **`voidCount` 已删**（见下面 `voidFlow` 里"为什么删"那一段）：笔数只能**校验**，
//     不能**指认**。没给 `voidEntries` 就是**单笔**指认（>1 照旧回绝）。
// ★ 撤回**也要给事由**（§9 :892：任何一处改钱都必须记流水含 reason）—— 事由那道闸在下面
//   与正常记账**共用**（同一个错码 `LA_ASSET_REASON_REQUIRED`），不另开第二套规矩。
// ★ **留痕、可再查看**（§9 :896 的二阶风险）：置位时把撤回那一刻的**时间与事由**记在
//   `voidedAt` / `voidedReason` 上 —— 痕迹是**加上去的**，不是把原来的事由抹掉。
//   撤回时间取调用方给的 `today`（"今天撤的"），没给才回落目标那一笔的 `at`。
// ★ 已经是撤回态的再撤一次 = **原样回它**（既不报错、也不把第一次的留痕冲掉）：
//   ⚠️ 这**只覆盖单笔指认那一条路**（`voidEntries` 没给、复合键唯一命中一笔）。整批那一趟
//   命中的是**集合**：集合里已有撤回过的笔 ⇒ 现役笔数少于集合条数 ⇒ 回
//   `LA_ASSET_VOID_TARGET_AMBIGUOUS`（**不是**"原样回"）。这是有意的：整批重试能撤到的是
//   另一批，回绝才不会误撤。注释从前在这里承诺"再撤一次原样回"而不分路，与实现不符
//   （F4 复核 Minor-2），按实测改掉。
function voidFlow(ledger, actorKey, at, entryId, reason, voidAt, voidEntries) {
  const next = flatten(isObj(ledger) ? ledger : {});
  const actors = isObj(next.actors) ? next.actors : {};
  const bucket = isObj(actors[actorKey]) ? actors[actorKey] : {};
  const flows = arr(bucket.flows);
  // ---- 整批那一趟：**按批次自己报的身份集合指认**（不是按笔数推断）----
  // 集合里每一笔 = `{ index, at, entryId? }`（`appendFlow` 交回来的那一笔自己报的形状）。
  // **逐一指认，缺一不可**：`index` 必须落在账本里、那一格的 `at` 要对得上、报了 `entryId`
  // 就必须逐字相符、而且那一格**还得是现役**。任何一条不成立 ⇒ 整批回绝。
  // 这一条替代了从前的 `voidCount`（笔数）判据 —— 笔数只能校验，不能指认。
  if (voidEntries != null) {
    const list = arr(voidEntries).filter(isObj);
    if (!list.length) return { error: 'LA_ASSET_VOID_TARGET_NOT_FOUND' };
    const allV = flows.slice();
    let lastV = null;
    for (const e of list) {
      const i = num(e.index);
      if (!Number.isInteger(i) || i < 0 || i >= flows.length) return { error: 'LA_ASSET_VOID_TARGET_NOT_FOUND' };
      if (!isObj(allV[i])) return { error: 'LA_ASSET_VOID_TARGET_NOT_FOUND' };
      if (str(allV[i].at) !== str(e.at)) return { error: 'LA_ASSET_VOID_TARGET_NOT_FOUND' };
      const wantId = str(e.entryId);
      if (wantId && str(allV[i].entryId) !== wantId) return { error: 'LA_ASSET_VOID_TARGET_NOT_FOUND' };
      if (isVoided(allV[i])) return { error: 'LA_ASSET_VOID_TARGET_AMBIGUOUS' };   // 已经撤过 ⇒ 回绝，不重复撤
      // ⚠️ **不许 `Object.assign({}, allV[i], {…})`**：那一笔来自**存档透传**（`readLedger()`
      //    / `flatten` 原样带出自有 `__proto__`），而 `Object.assign` 在**源**上走 `[[Set]]`
      //    ⇒ 那一格在拷贝这一步就没了、原型被写成那一笔（实测整批 `voidEntries` 后
      //    proto = `{"evil":8}`）。走 `copyKeys`：逐格 `setKey` 拷进新桶，再盖撤回留痕那三格。
      allV[i] = copyKeys(allV[i], { voided: true, voidedAt: voidAt, voidedReason: reason });
      lastV = allV[i];
    }
    next.actors = withActor(next.actors, actorKey, copyKeys(bucket, { flows: allV }));
    return { ledger: next, flow: flatten(lastV) };
  }
  const hit = [];
  for (let k = 0; k < flows.length; k++) {
    const f = flows[k];
    if (!isObj(f) || str(f.at) !== at) continue;
    if (entryId && str(f.entryId) !== entryId) continue;
    hit.push(k);
  }
  if (!hit.length) return { error: 'LA_ASSET_VOID_TARGET_NOT_FOUND' };
  const live = hit.filter(k => !isVoided(flows[k]));
  // 单笔：>1 一律回绝
  if (hit.length > 1) return { error: 'LA_ASSET_VOID_TARGET_AMBIGUOUS' };
  if (!live.length) return { ledger: next, flow: flatten(flows[hit[0]]) };   // 已撤过 ⇒ 原样回
  const all = flows.slice();
  let last = null;
  for (const k of live) {
    // 痕迹是**加**上去的：原字段（含原有的 `at` / `reason`）一个都不动
    // ⚠️ 同 K2 那一条：源可能来自**存档透传**、自带自有 `__proto__` ⇒ 必须逐格 `setKey`
    //    （实测撤回后那一笔 own keys 里没有 `__proto__`、proto = `{"evil":9}`）。
    all[k] = copyKeys(flows[k], { voided: true, voidedAt: voidAt, voidedReason: reason });
    last = all[k];
  }
  next.actors = withActor(next.actors, actorKey, copyKeys(bucket, { flows: all }));
  return { ledger: next, flow: flatten(last) };
}

// ---------------------------------------------------------------------------
// 账务事务层（§9 写回门 / 铁律 10）：手动记一笔
// ---------------------------------------------------------------------------
// 三个合法写者（面板手改 / 提取确认后 / 行情结算）收敛到这一条路上。这一节只管**记账这一笔
// 的形状与四道闸**，落盘仍在 store 那一个门里（这里不碰存储、不碰 DOM）。
//
// 出口形状只有两种，**没有第三种**：
//   · 收下 → `{ ledger: next, flow }`（next 是新的账本，入参那份一个字都不改）
//   · 挡下 → `{ error: '代码' }`（**绝不半写入** —— 账面动了而流水没落，正是"说不出来历"的那一笔）
//
// 四道闸（顺序就是说话的顺序 —— 事由是 §9 点名的一等字段，它先说话）：
//   ① **事由必填**（§1 第 2 条 / §9：「事由是这个模块的一等字段，不是备注」）——
//      空串、全空白、根本没给，一律挡下；
//   ② **转移必须给出去处**（铁律 10：一笔变动必须能说出"从哪儿来、到哪儿去"）——
//      `direction: 'transfer'` 而没有 `to` 的那一笔不许静默记账（§15.8 的转移留痕）；
//   ③ **日期必填**（§9：手动增减是「时间 / 方向 / 金额 / 分类条目 / 事由」）——
//      `at` 空着时可以用调用方给的 `today` 顶上（面板与提取两条路各自知道"今天"是哪天），
//      两个都空就挡下：一条不知道"何时"的流水说不出这笔是什么时候发生的事，
//      而**这里绝不能默认成"今天"**—— 那是凭空给一笔账编了个日子（铁律：不编数字）；
//   ④ **没有 actorKey 就没有"谁的账"**：一笔变动 = 谁 + 何时 + 多少 + 什么资产 + 为什么，
//      "谁"缺了就只能写进一个空键（`actors['']`）—— 那是凭空造一个人，同样挡下。
//      （brief 只点名了事由与去处两道；日期与"谁"这两道是同一个形状的口子，
//        代码里明写出来免得被当成漏项。）
//
// ★ **纯函数**：入参账本一个字都不改（下面用 `flatten` 先深拷贝再改副本），B3 的针脚盯着这条。
// ★ **归一化只有一处**：金额认什么、方向与 kind 的档位缺省是什么，全交给 `normalizeFlow` ——
//   本函数不写第二份口径（两处各写一份迟早不一致），也**不再**自己折一次方向：
//   `normalizeFlow` 现在按 `DIRECTIONS` 认三档，`transfer` 原样过（C1 修复轮之前它只认两档，
//   这里曾有一段"先折成 in、归一化之后再写回来"的规避 —— 归一化层修好之后那段就删了）。
//   ⚠️ **转移的金额在这一层就归零**（§15.8「无金钱往来时 amount = 0，但必须留痕」）：
//   这是第一道闸（唯一的写者，闸门只能在这里：调用方给多少都不作数，转移就是没有金额）。
//   第二道闸在 `flowSigned`（转移一律 0）：它防的是绕过本函数直接构造的流量。
//   面板那一半只负责"不邀请用户填数"（收起金额格），规矩本身不在面板上写第二份。
function appendFlow(ledger, input) {
  const i = isObj(input) ? input : {};
  const actorKey = str(i.actorKey).trim();
  const reason = str(i.reason).trim();
  const to = str(i.to).trim();
  const asked = str(i.direction).trim();
  const isTransfer = asked === 'transfer';
  // 何时：调用方给的日子优先；没给就用它交上来的"今天"（两条路各说各的，口径在这一层合）
  const at = str(i.at).trim() || str(i.today).trim();

  if (!actorKey) return { error: 'LA_ASSET_ACTOR_REQUIRED' };
  if (!reason) return { error: 'LA_ASSET_REASON_REQUIRED' };                     // ① 事由必填
  if (isTransfer && !to) return { error: 'LA_ASSET_TRANSFER_TARGET_REQUIRED' };  // ② 成对性
  // ③ 日期：**排在事由之后**。事由必填是 §9 点名的一等字段（先于别的毛病说话），
  //    而这条闸是补的 —— 排在它前面会把既有调用方收到的错码换掉（B3 那几条针脚钉着
  //    "没给事由 → LA_ASSET_REASON_REQUIRED"）。错码顺序也是接口的一部分。
  if (!at) return { error: 'LA_ASSET_DATE_REQUIRED' };

  // ---- 撤回形态（§9 :895 / Ruling C）：**只在字面量 `true` 时算数** ----
  // 事由（闸①）与日期（闸③）已经先说过话（错码顺序也是接口的一部分）；到这儿只剩指认。
  // ⚠️ 这一段**不在正常记账那条路上**：`voided` 不是字面量 `true` 时整段跳过，
  //    下面的 `raw` 一个字都不多、不少 ⇒ 不传 `voided` 的调用方**逐字不变**。
  if (i.voided === true) {
    // `voidEntries` 与 `voided` 同一把尺子：**认不出的当没给**（那就退化成单笔指认）。
    // ⚠️ `voidCount`（批次笔数）**在 F4 复核里删掉了**：笔数只能当**校验**，不能当**指认** ——
    //    同一天同一个人的第二批确认会把第一批也带进同一个 `(actorKey, at)` 里，累积的笔数
    //    与账本当下逐字对上 ⇒ "撤 2 笔"变成"撤 4 笔"。指认一律走 `voidEntries` 那一份身份集合。
    const ve = Array.isArray(i.voidEntries) ? i.voidEntries : null;
    return voidFlow(ledger, actorKey, at, str(i.entryId).trim(), reason,
      str(i.today).trim() || at, ve);
  }

  const raw = {
    at,
    // 方向原样交给 normalizeFlow 认档（三档：out → out、transfer → transfer、其余 → in）——
    // 认不出的回落 in：绝不静默记成"出"，也绝不静默丢掉一笔转移
    direction: asked,
    // 转移没有金额（§15.8）：这里归零，绝不让它带着一个数进求和
    amount: isTransfer ? 0 : i.amount,
    kind: i.kind,
    reason,
  };
  // "从哪儿来、到哪儿去"的两格：动的是哪一条（entryId）、转给了谁（to）。没有就不留空壳键。
  // ★★ **G3-D1 放宽（账本层"去处"格）**：这一格从前只在 `isTransfer` 那一支写下来 ⇒
  //    `out` / `in` 上给了 `to` 会被**静默丢掉**（G3 复审实测 `hasOwn(to) === false`），
  //    后果是"这笔钱到哪儿去了"在账本层**无处承载**（铁律 10 / §11 第 15 条），
  //    `out`/`in` 的成对性只能靠读侧"同额 / 同日 / 同事由"隐式配对 ——
  //    **同额同日同事由的多笔配对歧义不可解**。
  //    ⇒ 改成 `if (to)`：**谁给了就存谁**（与 `entryId` 那一格同一个形状）。
  //    ⚠️ **两条纪律一个字都不许松**：
  //      ① **闸在上一句 `:334`**（`isTransfer && !to` ⇒ 回绝）—— 转移仍然**必须有去处**，
  //         本次只放宽"写下来"这一句，闸一位不动；
  //      ② **"没有就不留空壳键"照旧成立**：`to` 为空（空串 / 全空白 / 没给）⇒ **键都不写**，
  //         不落 `undefined`、不落空串 ⇒ 不传 `to` 的既有调用方（提取、行情结算、面板手改）
  //         产物**逐字不变**。这一条是本次放宽的**回归针脚**，不是注释。
  //    ⚠️ 归一化那一道**不需要跟着改**（G3-D1 §A.4 判过）：`normalizeFlow` 只对
  //       `amount` / `direction` / `kind` 三格重写口径，其余格子是 `flatten(raw)` 深拷贝
  //       **原样带过**（它不是白名单式归一化）⇒ `to` 过得了归一化、读得回来。
  // ★★★ **`to` 是什么 —— 账本层契约（G3-D1 复审 I1，控制者裁定 (c)）**：
  //    `to` = **这笔 `out` 的对手方** —— **自由文本、给人读**；**不许当引用用**
  //    （不许拿它按 id 查条目、也不许拿它当主键）。**要机器指认一律走 `entryId`**；
  //    买卖那种成对的，对手方就是**配对那条流水的 `entryId`**（写入侧见 `asset-holdings.js`，
  //    那里的 `to` 恰好写的就是配对条目的 id —— "恰好是 id"不等于"`to` 就是引合格"）。
  //    ⚠️ **为什么不由本层把 `to` 统一成"条目 id"**（复审给过这条路，控制者已否）：
  //      对手方**按 flow 的语义本来就各不相同** —— 转交（§15.8①）的落点是**人**
  //      （设计文档自己的例子：`{"action":"transfer","from":"沈青梧","to":"林晚"}`）、
  //      买卖的落点是**条目 id**、升级（`asset-core.js` 的 `assetLanding(it)`）的落点是**显示名**。
  //      硬统一成 id 会把 §15.8 的转交涉事改错；统一成"显示名"则是**改名即断链**
  //      （K1 那条真债的同型坑：`roleKey` 也是人名）⇒ 本层只保证"**谁给了就存谁**"（下一句），
  //      `to` 的所指由**写者那一类的语义**定，本层不替它挑一种。
  //    ⚠️ **面板批次的边界（写给下一个消费者）**：面板**可以印** `to`（它本来就是给人看的字），
  //      **不许解析**它；买卖要指认就走**配对那条流水的 `entryId`**。将来若真需要对"升级那种
  //      没有配对的 `out`"做机器指认 —— 那是**加一个带类型的格子**（规格变更），
  //      **不是悄悄解释 `to`**。
  if (str(i.entryId).trim()) raw.entryId = str(i.entryId).trim();
  if (to) raw.to = to;
  const flow = normalizeFlow(raw);

  const next = flatten(isObj(ledger) ? ledger : {});
  if (!isObj(next.actors)) next.actors = {};
  const bucket = isObj(next.actors[actorKey]) ? next.actors[actorKey] : {};
  // 账本里还没有这个人时**建桶**（否则第一笔永远记不上）；已有的 entries / flows 一律带回来
  // ★ 走 `setKey`：`actorKey` 就是人名（用户可控字符串）。裸赋值在 `__proto__` 上**不是加一格
  //   而是改写原型** ⇒ 实测输入 own keys `["shen"]` 得到输出 `["shen"]`、这一笔落在原型上，
  //   `Object.keys` 看不到它、**写盘即丢**（这位角色的第一笔账永远记不上）。
  // ⚠️★ **G2AB 收口轮追加（§10 发现 1）**：这里**原来**是 `Object.assign({}, bucket, {…})` ——
  //    危险同样是**源**（`bucket`）自带自有 `__proto__`：实测手搓一条
  //    `{actors:{shen:{entries:[],flows:[],__proto__:{evilX:1}}}}` 走本函数 ⇒ 产物桶
  //    own keys `["entries","flows"]`、**proto 被写成 `{"evilX":1}`**（那一格在拷贝步被吞）。
  //    ⇒ 改走 `copyKeys`（逐格 `setKey` 拷进新桶、再盖 `entries` / `flows` 两格）。
  //    ★★ **可达性（这一句很重要，别把它当活跃缺陷误判优先级）**：本函数在**当前**的
  //    `appendFlow` 四个调用点上**都不可达** —— `asset.script.js:919` / `:1372` / `:3570` / `:3624`
  //    （★ G2AB-fix3：原写 `:1366` / `:3561` / `:3615` 是**过期行号**，复审实测 + 我现场
  //      `git grep -n "appendFlow(" -- src` 复核为 `919 / 1372 / 3570 / 3624`；实质结论不变）
  //    传进来的账本**一律**是 `store.readLedger()` 的产物，而 `normalizeLedger`
  //    （`asset-store.js:73-76`）**重建**每一个桶、自有键恒只有 `entries` / `flows` ⇒
  //    生产路径上 `bucket` 不可能带自有 `__proto__`。修它是为了让这条**机制**不再存在
  //    （代价为零），不是因为真机上打得到。⇒ 谁要是把读口改成"原样透传"，这条会变成真的。
  setKey(next.actors, actorKey, copyKeys(bucket, {
    entries: arr(bucket.entries),
    flows: arr(bucket.flows).concat([flow]),
  }));
  return { ledger: next, flow };
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------
// core（它在上）从这里取：三档常量 / 几个通用小工具 / 流量那一摊。
// 挂载点与 terms / core 同一族：真机上本文件先执行，core 惰性取不到 require 就走它。
const api = {
  KINDS, DEFAULT_KIND,
  isObj, arr, str, num, flatten, cloneList, copyKeys,
  normalizeFlow, normalizeFlowList, flowKind, flowSigned, sumFlows, appendFlow,
  // 撤回那一族：`isVoided` 是**唯一**那条判据（面板显示"这一笔还算不算"时也读它 ——
  // 面板自己写一遍 `f.voided === true` 就是第二份口径）。
  isVoided,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  rt.__LA_ASSET_LEDGER__ = api;
}

})();

  return module.exports;
})();
