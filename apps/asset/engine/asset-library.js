/* ========================================================
 * asset-library.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-library.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】无（纯函数层）
 * 【上游定位】asset-library.js
 * ======================================================== */
'use strict';

const __REQ = {};

export default (function () {
  const module = { exports: {} };
  const window = undefined;
  const require = function (p) {
    const f = __REQ[p];
    if (typeof f !== 'function') throw new Error('[asset-engine] unmapped require: ' + p);
    return f();
  };

(function(){
/* src/modules/asset/asset-library.js */
'use strict';

// ============================================================================
// 资产模块 · 内置标的表 + 两层覆盖（批次 G1 · 设计文档 §5.1）
// ----------------------------------------------------------------------------
// 规格 §5.1 原文的形状：基础表每条 `代码 / 名称 / 别名[] / 抽象层 / 基准价 / 波动档`。
//
// 三层结构（§5.1，**读取与合并都在这一层**；写盘不归本文件 —— "另存为"那个动作属于后续批次）：
//   ① 代码内置基础表                  ← 本文件的 `BASE_LIBRARY`
//   ② `la.asset.market.override.v1`       （全局覆盖，localStorage，跨聊天）
//   ③ `__la_asset_market_override_v1`     （**本聊天分支覆盖，优先**，聊天变量）
//
// ⚠️ 两个覆盖键**形状完全不同**：一个是 `la.asset.*` 全局键（走 localStorage，
//    与 `settings.script.js` 的 `la.asset.config.v1` 同一族），一个是 `__la_asset_*`
//    聊天变量（走 `asset-store.js` 那个唯一读写门）。本文件**把两个键名各导出一次**，
//    两个宿主（`localStorage` / `store`）由调用方注入 —— 本文件既不碰 DOM 也不碰存储。
//
// ★★ 为什么这一层是**纯数据 + 纯函数**（零存储、零 DOM、零时钟）：
//    三层合并的口径只能有一份。合并写进面板 / 写进 store，就会在"面板那一份"与
//    "投影那一份"之间漂移（本仓反复点名的"两处各算一份"）。所以：
//      · 数据：`BASE_LIBRARY`（源码常量，用户改的是**覆盖层**，不是这一份）；
//      · 读：`readGlobalOverride(host)` / `readChatOverride(host)`（宿主注入，纯 Node 可测）；
//      · 合并：`resolveLibrary(...)`（入参进、结果出，逐字可复现）。
//
// ★★ 抽象层是**分类**不是文案（§3.12 ③ / 设计文档 `:547`）：
//    `稳健 / 成长 / 投机 / 冷门` 是**数据分层**（像 `itemType` 一样），面板与投影**直接显示**。
//    所以这四个词**不进 `asset-terms.js` 的用语表**、**不走三档取词**（三档同词，
//    "某档想换说法"由标的表自己去取 `sectorWords(era)` 的另一层，不在那张表里）。
//    `test/asset-library.test.js` 的 ③ 把这件事钉成机器可查的判据。
//
// 换皮边界（§3.12 ④）：`代码` 是**稳定 key** —— 改名不换、升降档不换；
//    换的只有屏幕上与投影给模型看的字（面板标题 / 表头 / 类目名）。
// ============================================================================

// ---- 两个覆盖层的键名（各导出一次，调用方照宿主注入）----
// ② 全局键：照 `settings.script.js` 的 `la.asset.config.v1` 同一族（localStorage）。
const KEY_MARKET_OVERRIDE_GLOBAL = 'la.asset.market.override.v1';
// ③ 本聊天键：照 §3.4 的存储键表 —— `__la_asset_*` 前缀、`_v1` 收尾，
//    与 `asset-store.js` 的 `KEY_MARKET`（`__la_asset_market_v1`）同一族。
//    ⚠️ 它是**覆盖**（patch），不是行情状态（`__la_asset_market_v1` 存的是逐日现价）——
//    两者分键的理由与 D2 拆投影键同一条：一份状态一个门，形状不同就不并键。
const KEY_MARKET_OVERRIDE_CHAT = '__la_asset_market_override_v1';

// ---- 抽象层（§5.1 原文四个：稳健 / 成长 / 投机 / 冷门）----
// ⚠️ **这是分类 id 表，不是词表**：值就是那四个词本身（面板与投影直接显示它们），
//    刻意**没有** per-era 的三档说法 —— 三档同词正是 §3.12 ③ 要的
//    （"现代档显示「沪深300」，仙侠档同一只显示「坊市稳货」"换的是**名称**，不是这一层）。
const TIERS = ['稳健', '成长', '投机', '冷门'];

// ---- 波动档（G2 的游走按它取幅度；本任务只把它作为数据放好）----
// ⚠️ 规格只点名了"波动档"三个字（§5.1），**没给档数**。这一层自定四档并写清理由：
//    · 四档与抽象层四档**不是一回事**（同一抽象层里可以有不同波动：冷门也可能忽然放量），
//      所以单开一份 id，不拿抽象层当波动档；
//    · 三个字母的 id 是**英文**：它要被 G2 拿去 `seededRng('标的id|日期')` 映射幅度，
//      写成中文就得在那一层再翻一次，且与 `asset-terms.js` 的三档扫描面纠缠（那是**分类**，见上）。
//    · `mult` 是**幅度倍数**（相对 1.0 这一档），G2 直接乘 —— 它**不是**用户可见文案。
const VOLS = {
  LO: { id: 'LO', label: '低波', mult: 0.6 },
  MID: { id: 'MID', label: '中波', mult: 1.0 },
  HI: { id: 'HI', label: '高波', mult: 1.8 },
  XHI: { id: 'XHI', label: '极高波', mult: 3.0 },
};
const VOL_IDS = ['LO', 'MID', 'HI', 'XHI'];

// ---- ① 代码内置基础表 ----
// ★★ **这是"起始集"，不是"全集"**：用户可增删（§5.1 末条："用户改名 / 增删后，可另存为
//    仅本聊天分支生效或全局生效"）—— 增删落在**覆盖层**，本文件这一份一个字都不动。
//    **挑法（不是编数据）**：按抽象层四档**各给三只**，每档里放一只"这一档最典型的"，
//    另两只覆盖不同的现实对应物（股票 / 指数 / 债券 / 商品 / 收藏品），
//    让"抽象层而不是现代板块名"这条口径**每一档都有东西可显示**；
//    代码与价位照现实里最常见的量级给（不是行情快照，是**基准价**，G2 的游走从它出发）。
//    中文名照 `asset-terms.js` 的三档口径：**现代一档一件，仙侠档同一只另取说法**——
//    下面 `name` 是**现代档显示名**（"代码内置的起点"），仙侠/古代档的说法由标的表自己
//    在后续批次取（§3.12 ③ 末条：那一层不在用语表里，本任务也不做）。
//    ⚠️ `代码` 是稳定 key（§3.12 ④）：`#600519` 就是 `#600519`，改名不换、升降档不换。
const BASE_LIBRARY = [
  // ---- 稳健 ----
  { code: '#000300', name: '沪深300指数', aliases: ['沪深300', '大盘蓝筹', '沪深三百'], tier: '稳健', basePrice: 3850, vol: 'LO' },
  { code: '#600519', name: '贵州茅台', aliases: ['茅台', '飞天茅台'], tier: '稳健', basePrice: 1680, vol: 'MID' },
  { code: '#019547', name: '国债ETF', aliases: ['国债', '国债指数', '无风险利率'], tier: '稳健', basePrice: 118, vol: 'LO' },

  // ---- 成长 ----
  { code: '#300750', name: '宁德时代', aliases: ['宁德', '电池龙头'], tier: '成长', basePrice: 210, vol: 'HI' },
  { code: '#002415', name: '海康威视', aliases: ['海康', '安防龙头'], tier: '成长', basePrice: 32, vol: 'MID' },
  { code: '#000001', name: '平安银行', aliases: ['平安', '平安银行股票'], tier: '成长', basePrice: 11.5, vol: 'MID' },

  // ---- 投机 ----
  { code: '#BTCUSD', name: '比特币', aliases: ['BTC', '大饼', '比特'], tier: '投机', basePrice: 68000, vol: 'XHI' },
  { code: '#002594', name: '比亚迪', aliases: ['BYD', '比亚迪股份'], tier: '投机', basePrice: 245, vol: 'HI' },
  { code: '#603259', name: '药明康德', aliases: ['药明', 'CRO龙头'], tier: '投机', basePrice: 52, vol: 'HI' },

  // ---- 冷门 ----
  { code: '#GOLD', name: '黄金', aliases: ['金价', '伦敦金', '黄金现货'], tier: '冷门', basePrice: 545, vol: 'MID' },
  { code: '#SILVER', name: '白银', aliases: ['银价', '白银现货'], tier: '冷门', basePrice: 7.2, vol: 'HI' },
  { code: '#CRUDE', name: '原油', aliases: ['油价', '布伦特原油', 'WTI'], tier: '冷门', basePrice: 78, vol: 'XHI' },
];

// ---- 小工具（与本仓既有写法同一套）----
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return v == null ? '' : String(v); }
// 一份可以进合并结果的**非空**字符串：空串与空白一律当"没这一格"（免得面板印出空白名字）
function nonEmptyStr(v) { return v == null ? '' : String(v).trim(); }
// 有限数（价格与幅度必须是数；`null` / `'abc'` / `NaN` 都不算）
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
// 一份别名表：逐项转字符串、去空白、丢掉空的、**去重**（同一个别名写两遍不产生两条）
function normAliases(v) {
  const out = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const s = nonEmptyStr(raw);
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}
function tierOk(v) { return TIERS.indexOf(nonEmptyStr(v)) >= 0; }
function volOk(v) { return VOL_IDS.indexOf(nonEmptyStr(v)) >= 0; }

// 覆盖里那一格**在不在**（`undefined` = 没表态 ⇒ 不覆盖；`null` = 明确表态成"清空"）
function declared(o, key) { return Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined; }

// 一份覆盖 entry 的 `code`（覆盖表是**按键存**的；entry 里带了 `code` 就以它为准）。
// 返回空串 = 这一条认不出代码，整条丢掉（宁可少一条，也不造一条没有身份的标的）。
function entryCode(codeKey, entry) {
  const own = isObj(entry) ? nonEmptyStr(entry.code) : '';
  const key = nonEmptyStr(codeKey);
  // 两个都在、又不一样：**以 entry 自己的 `code` 为准**（那是数据自己的身份 ——
  // 键只是索引；把键当身份会在"改 map 键"这件本该无害的操作上悄悄改掉标的的身份）。
  return own || key;
}

// 一条覆盖 entry 要不要**删掉**这一只（显式标记；见文件末"删条目靠显式标记"那条注释）
function isRemoveEntry(entry) { return isObj(entry) && entry.remove === true; }

// 把一条覆盖 entry 归一成"只有明确表态的那几格"的补丁。
// ⚠️ 不是对象 / 认不出代码 ⇒ 回 `null`（调用方整条丢掉、并记进 `dropped` 判据）。
function normalizePatch(codeKey, entry) {
  if (!isObj(entry)) return null;
  const code = entryCode(codeKey, entry);
  if (!code) return null;
  const patch = { code };
  if (declared(entry, 'name')) patch.name = nonEmptyStr(entry.name);
  if (declared(entry, 'aliases')) patch.aliases = normAliases(entry.aliases);
  if (declared(entry, 'tier')) {
    const t = nonEmptyStr(entry.tier);
    if (tierOk(t)) patch.tier = t;      // 认不出的层**整格丢掉**（不覆盖成乱码）
  }
  if (declared(entry, 'basePrice')) {
    const p = entry.basePrice;
    if (isNum(p) && p > 0) patch.basePrice = p;
  }
  if (declared(entry, 'vol')) {
    const v = nonEmptyStr(entry.vol);
    if (volOk(v)) patch.vol = v;
  }
  return patch;
}

// 一层覆盖（对象 / 数组两种来源形状）⇒ `{ patches: [...], dropped: [...] }`
// 认的形状（**宽容读**：覆盖层是"用户手改过的东西"，坏一格不该毁掉整层）：
//   · `{ symbols: { '代码': {...} } }`  ← 本层定的主形状（按键存 ⇒ 天然不会同代码两条）
//   · `{ '代码': {...} }`                ← 裸 map（宽容：用户手写一份就长这样）
//   · `[ {...}, {...} ]`                 ← 数组（照 §5.1 的"表"字面；同代码**后者覆盖前者**）
//   · 认不出的形状 ⇒ 空 patches + dropped 里记一条（**不抛**，调用方回落到下一层）
function normalizeOverrideLayer(raw) {
  const patches = [];
  const dropped = [];
  const push = (codeKey, entry) => {
    const p = normalizePatch(codeKey, entry);
    if (!p) dropped.push({ code: nonEmptyStr(codeKey) || (isObj(entry) ? nonEmptyStr(entry.code) : '') });
    else patches.push(p);
  };
  if (Array.isArray(raw)) {
    for (const entry of raw) push('', entry);
  } else if (isObj(raw)) {
    const bag = isObj(raw.symbols) ? raw.symbols : raw;
    // ⚠️ 裸 map 那一支要把**这一层的自留格**排掉（`symbols` 形状下它们不会进 `bag`；
    //    裸 map 形状下 `version` 会被当成"一只叫 version 的标的"）。**只排 `version` 这一格**：
    //    排得越多，"用户手写的一份覆盖"能被认出来的面就越窄（宽容读那一半的要求）。
    for (const key of Object.keys(bag)) {
      if (!isObj(raw.symbols) && key === 'version') continue;
      push(key, bag[key]);
    }
  } else if (raw != null) {
    dropped.push({ code: '' });
  }
  return { patches, dropped };
}

// 一层覆盖 ⇒ 按键索引的补丁表（**同代码只留一条**：后出现的那条覆盖前一条）
function patchIndex(patches) {
  const out = new Map();
  for (const p of patches) out.set(p.code, p);   // 同代码再看一次 = 覆盖（不是并成两条）
  return out;
}

// ---- 合并的**唯一出口**：三层逐字段合并 ----
// 口径（本层自定，理由见报告 §2）：
//   · **逐字段合并，不是整条替换**。理由：两层覆盖的键名形状不同（全局 vs 本聊天），
//     用户的心智是"我把名字改一下，价格还照旧的" —— 整条替换会让"只改名称"的那一层
//     把另一层改过的**价格一起抹掉**（用户没碰价格，价格却变了）。逐字段合并里，
//     没表态的格子（`undefined`）一律不动，谁表态谁说了算。
//   · 优先级：基础表 < 全局覆盖 < 本聊天覆盖；**逐格**取最高那一层的表态。
//   · `name` 允许表态成空串（「这一只我不想让它显示名字」）—— 空串照落，不再回落基础表；
//     基础表自己的名字必须是非空（数据自检在测试里）。
//   · `basePrice` 只认正的有限数；`tier` / `vol` 只认 `TIERS` / `VOL_IDS` 里的 id：
//     覆盖里这几格认不出 ⇒ **整格丢掉**（回落基础表那一个有效值），不把乱码写进结果。
//   · `aliases` 按**整格替换**（不是并集）：把旧别名删掉是这个动作的正当用法（并集做不到）。
//   · **删条目靠显式标记**（`{ code, remove: true }`），不靠"名字空 / 价格 0"：
//     后两者都是**合法的数据**（空名与 0 价真的可能就是用户的输入），拿它们当删除标记
//     会把用户的正当数据当成指令执行掉。删除同样遵守优先级：本聊天删了，全局删不掉它。
//   · **结果里 `code` 只有一个**：同代码的两次覆盖合成一条（按键索引 ⇒ 结构上就产生不出两条）。
//   · 纯函数：不改任何入参（逐条新建对象），同入参两次调用结果 `deepStrictEqual` 逐字相同。
function resolveLibrary(opts) {
  const o = isObj(opts) ? opts : {};
  const base = Array.isArray(o.base) ? o.base : BASE_LIBRARY;
  const global = normalizeOverrideLayer(o.globalOverride);
  const chat = normalizeOverrideLayer(o.chatOverride);
  const gIdx = patchIndex(global.patches);
  const cIdx = patchIndex(chat.patches);

  const entries = [];
  const seen = new Set();
  // ★ 键是**用户数据**（标的代码）⇒ 必须用 `Object.create(null)`：
  //    裸 `{}` 上写 `sourceOf['__proto__'] = …` 是**改原型**而不是加一格（`Object.keys` 会少 1），
  //    而读 `sourceOf['toString']` 会拿到**原型的函数**当"这一条来自哪一层"（G1 复审 N1/N2 同一类，见 byCode 那句）。
  const sourceOf = Object.create(null);
  const dropped = global.dropped.concat(chat.dropped);

  // 一层里的一张补丁是不是"删这一只"（用**原始 entry** 判，不是归一后的补丁：
  // `remove` 是指令不是数据，归一那一步刻意不留它）
  const isRemoved = (layerRaw, code) => {
    const rawEntry = patchSource(layerRaw, code);
    return rawEntry != null && isRemoveEntry(rawEntry);
  };
  // 覆盖层对某代码的**最终归属**（本聊天优先于全局）—— 删除也一样按这个优先级生效
  const layerOfCode = (code) => (isRemoved(o.chatOverride, code) ? 'chat'
    : (cIdx.has(code) ? 'chat' : (isRemoved(o.globalOverride, code) ? 'global' : (gIdx.has(code) ? 'global' : ''))));

  // ① 基础表起手（只收认得出代码的条目 —— 没有代码就没有身份，那是"一条空白行"）
  for (const raw of base) {
    if (!isObj(raw)) { dropped.push({ code: '' }); continue; }
    const code = nonEmptyStr(raw.code);
    if (!code) { dropped.push({ code: '' }); continue; }
    if (seen.has(code)) { dropped.push({ code }); continue; }      // 基础表自身重复 ⇒ 只留第一条
    seen.add(code);
    const owner = layerOfCode(code);
    if (owner && isRemoved(owner === 'chat' ? o.chatOverride : o.globalOverride, code)) continue;  // 删 ⇒ 不出现
    entries.push(buildEntry(raw, gIdx.get(code), cIdx.get(code)));
    sourceOf[code] = owner || 'base';
  }

  // ② 覆盖层里**基础表没有的**代码 ⇒ 新增一只（用户"增"标的走的就是这条路）
  // ⚠️ 只遍历"归属那一层"的键（本聊天优先）—— 遍历两层会在同代码上把新增那条算两遍。
  for (const code of cIdx.keys()) addNew(code, cIdx.get(code), gIdx.get(code));
  for (const code of gIdx.keys()) if (!cIdx.has(code)) addNew(code, undefined, gIdx.get(code));

  function addNew(code, c, g) {
    if (seen.has(code)) return;
    const active = c || g;
    const owner = layerOfCode(code);
    if (owner && isRemoved(owner === 'chat' ? o.chatOverride : o.globalOverride, code)) { seen.add(code); return; }
    // 新增一条必须有名字（没名字的新增 = 屏幕上一条空白行）—— 缺了就丢进 dropped
    const name = active ? nonEmptyStr(active.name) : '';
    if (!name) { seen.add(code); dropped.push({ code }); return; }
    seen.add(code);
    entries.push(buildEntry({ code }, g, c));
    sourceOf[code] = owner || 'global';
  }

  // ★★ **键是用户数据 ⇒ 索引表不能有原型**（G1 复审 N1/N2，真实边界破口）：
  //    裸 `{}` 的后果有两条，都实测过：
  //      ① `symbolByCode(r, 'toString')` 拿到 `Object.prototype.toString`（一个函数当"一只标的"）；
  //      ② 有人把 `__proto__` 当代码查/写时，`byCode['__proto__'] = e` 是**改原型**，
  //         `Object.keys(byCode).length` 当场比 `entries.length` 少 1。
  //    `Object.create(null)` 一行堵死这**两类**：查不到就是 `undefined`（`symbolByCode` 回 `null`），
  //    写进去就是一格**自有**属性。测试里 `toString` / `__proto__` 两条针脚钉着这件事。
  const byCode = Object.create(null);
  for (const e of entries) byCode[e.code] = e;
  return {
    entries, byCode, sourceOf, dropped,
    counts: { base: base.length, global: global.patches.length, chat: chat.patches.length, total: entries.length },
  };
}

// 取某一层里某代码的**原始** entry（判断删除标记要用原始形状，不能用归一后的补丁 ——
// 归一后的补丁里没有 `remove` 这一格：它是**指令**，不是数据）
function patchSource(layerRaw, code) {
  if (Array.isArray(layerRaw)) {
    for (const entry of layerRaw) {
      if (isObj(entry) && entryCode('', entry) === code) return entry;
    }
    return null;
  }
  if (!isObj(layerRaw)) return null;
  const bag = isObj(layerRaw.symbols) ? layerRaw.symbols : layerRaw;
  if (isObj(bag) && isObj(bag[code])) return bag[code];      // 键就是身份（常见情形，先认）
  if (isObj(bag)) {
    // 键不是那一个、`entry.code` 才是（entry 自己带 code）—— 照样认得出这一条
    for (const key of Object.keys(bag)) {
      if (isObj(bag[key]) && entryCode(key, bag[key]) === code) return bag[key];
    }
  }
  return null;
}

// 逐字段合并一条：基础表那一条 + 全局补丁 + 本聊天补丁 ⇒ 一条完整 entry
function buildEntry(baseEntry, g, c) {
  const code = nonEmptyStr(baseEntry.code);
  const pick = (field) => {
    if (c && declared(c, field)) return c[field];
    if (g && declared(g, field)) return g[field];
    return baseEntry[field];
  };
  return {
    code,
    name: str(pick('name')),
    aliases: normAliases(pick('aliases')),
    tier: tierOk(pick('tier')) ? nonEmptyStr(pick('tier')) : '',
    basePrice: isNum(pick('basePrice')) ? pick('basePrice') : 0,
    vol: volOk(pick('vol')) ? nonEmptyStr(pick('vol')) : '',
  };
}

// 这一条最终是哪一层说了算 —— 在 `resolveLibrary` 里按"本聊天 > 全局 > 基础表"算，
// 结果落进 `sourceOf`（§5.2 的 `base` 要"含来源"；本层只给读数，不写盘）。

// ============================================================================
// 读那两层覆盖（**宿主注入** —— 与本文件其余部分一样纯：不碰全局、不碰 DOM）
// ----------------------------------------------------------------------------
// 形状照 `asset-store.js` 的注入方式：`readChatOverride(store)` 收一个**带 `readMarketOverride()` 的
// store**（`asset-store.js` 的家族），`readGlobalOverride(host)` 收一个**带 `localStorage` 的宿主**。
// ★ 二者都**不抛**：读不到 / 坏 JSON / 不是对象 ⇒ 回 `null`（= 这一层没表态），调用方回落下一层。
// ★ 本文件**不代 store 定义键**：`KEY_MARKET_OVERRIDE_CHAT` 是导出的常量，
//   `asset-store.js` 接这一格时读它（谁也别再抄一份字面量）。
// ============================================================================

// ② 全局覆盖：localStorage 里那个键 ⇒ 对象（读不到 / 坏 JSON ⇒ null）
function readGlobalOverride(host) {
  try {
    const ls = host && host.localStorage;
    if (!ls || typeof ls.getItem !== 'function') return null;
    const raw = ls.getItem(KEY_MARKET_OVERRIDE_GLOBAL);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isObj(parsed) || Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

// ③ 本聊天覆盖：store 的唯一出口 ⇒ 对象（键缺失 / 不是对象 ⇒ null）
// ⚠️ store 那一侧**故意不归一化**（同 D2 投影键的裁定）：闸门与形状判据只有一份，就在本文件。
function readChatOverride(store) {
  try {
    if (!store || typeof store.readMarketOverride !== 'function') return null;
    const v = store.readMarketOverride();
    return isObj(v) || Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}

// 一把读全（面板 / 结算那一侧的**唯一入口**）：给两个宿主，回三层合并结果。
// 任一宿主缺失 ⇒ 那一层当"没表态"（不抛）。
function readLibraryFromHosts(opts) {
  const o = isObj(opts) ? opts : {};
  return resolveLibrary({
    base: o.base,
    globalOverride: readGlobalOverride(o.globalHost),
    chatOverride: readChatOverride(o.chatStore),
  });
}

// ---- 查询口（面板 / 投影 / G2 都从这里取，不各自遍历）----
// 按代码查一只（认不出 ⇒ null）。`code` 前后空白照旧容忍（用户手抄时常见的尾巴）。
function symbolByCode(resolved, code) {
  const c = nonEmptyStr(code);
  if (!c || !isObj(resolved) || !isObj(resolved.byCode)) return null;
  return resolved.byCode[c] || null;
}

// 按别名 / 名称找（§5.6 末：**对不上别名时不自动匹配** —— 那是提取层的事；
// 本层只提供"对不对得上"的那一问，回 `null` 就是"对不上"）。
// ⚠️ 精确匹配（不是包含匹配）：提取层要的是"这一句里写的是不是这一只"，
//    包含匹配会让「茅台」把「茅台镇」也认成同一只 —— 那一层的口径不归本任务定，
//    所以这里只给**精确**那一半，宁可不认。
function symbolByAlias(resolved, text) {
  const s = nonEmptyStr(text);
  if (!s || !isObj(resolved) || !Array.isArray(resolved.entries)) return null;
  for (const e of resolved.entries) {
    if (e.name === s) return e;
    if (e.aliases.indexOf(s) >= 0) return e;
  }
  return null;
}

// ★★ H2（0.7.66）· §5.6 别名机制的**最后那一句**：*「提取对不上别名时**不自动匹配**
//    （同名两处不猜，宁可失联也不挂错）」*。
//
// 为什么不是 `symbolByAlias`：那一条是"找到第一个就回"（G1 落的，**面板查名字**用的读口），
//   它在"同名两处"时会**当场猜一个**。而 §5.6 点名不许猜的正是这条自动路径 ⇒ 另起一个函数，
//   判据写在**这一处**（别处再写一份就是两份口径）。
//
// 三条口径（缺一条就等于猜）：
//   ① **精确**：`name === 文本` 或 `aliases` 里有一个**逐字相等**的 —— 不是包含匹配
//      （`茅台镇` 不许被认成 `茅台`：那是"宁可失联"那一侧的例子）；
//   ② **唯一**：命中 **≥ 2** 条 ⇒ `null`（**同名两处不猜**）；
//   ③ 命中 0 条 / 文本空 / 表读不出 ⇒ `null`。
//   ⚠️ **它只回答"对不对得上"**，**不写任何东西**：写别名是用户答"是"之后的事
//      （`asset.script.js` 的挂接动作），本层是纯函数、零存储。
//
// 认三种入参形状（照 `symbolListOf` 的宽容读）：`{ entries: [...] }`（`resolveLibrary` 的结果）/
//   裸数组 / 任何 `entries` 是数组的对象。
function autoLinkSymbol(resolved, text) {
  const s = nonEmptyStr(text);
  if (!s) return null;
  let list = null;
  if (Array.isArray(resolved)) list = resolved;
  else if (isObj(resolved) && Array.isArray(resolved.entries)) list = resolved.entries;
  if (!list) return null;
  const hits = [];
  for (const e of list) {
    if (!isObj(e)) continue;
    if (!nonEmptyStr(e.code)) continue;                 // 没有身份的那一条不算"对得上"
    if (nonEmptyStr(e.name) === s || normAliases(e.aliases).indexOf(s) >= 0) hits.push(e);
  }
  return hits.length === 1 ? hits[0] : null;
}

// 把一条别名**并进**一份别名表（挂接之后答"是"那一支用它）：
//   · 已有同一条 ⇒ **原样回**（不产生重复条目）；
//   · 回的是**新数组**（纯函数；调用方拿它去写覆盖层）。
function withAlias(aliases, text) {
  const list = normAliases(aliases);
  const s = nonEmptyStr(text);
  if (!s || list.indexOf(s) >= 0) return list;
  list.push(s);
  return list;
}

// 按抽象层筛（面板"按档看标的"，G2 的"逐档统计"）。层 id 认不出 ⇒ 空数组（不是全部 ——
// 回全部会让"看稳健那一档"看到满屏，那是判据与意图不符）。
function symbolsByTier(resolved, tier) {
  const t = nonEmptyStr(tier);
  if (!tierOk(t) || !isObj(resolved) || !Array.isArray(resolved.entries)) return [];
  return resolved.entries.filter(e => e.tier === t);
}

const api = {
  KEY_MARKET_OVERRIDE_GLOBAL, KEY_MARKET_OVERRIDE_CHAT,
  TIERS, VOLS, VOL_IDS, BASE_LIBRARY,
  resolveLibrary, readGlobalOverride, readChatOverride, readLibraryFromHosts,
  symbolByCode, symbolByAlias, symbolsByTier,
  // ★★ H2（0.7.66）：§5.6 别名机制的"不许猜"那一支（唯一命中才算对得上）+ 别名并表。
  autoLinkSymbol, withAlias,
  // 归一化的内部件也导出：面板的"另存为"（后续批次）要靠它们把用户输入收成覆盖层，
  // 那一层不许自己再写一份（否则"什么算合法覆盖"就会有两份口径）。
  normalizeOverrideLayer,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') (window.parent || window).__LA_ASSET_LIBRARY__ = api;

})();

  return module.exports;
})();
