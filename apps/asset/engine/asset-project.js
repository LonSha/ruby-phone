/* ========================================================
 * asset-project.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-project.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-terms.js、./asset-core.js、./asset-market.js、./asset-library.js
 * 【上游定位】asset-project.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-terms.js';
import __assetDep1 from './asset-core.js';
import __assetDep2 from './asset-market.js';
import __assetDep3 from './asset-library.js';

const __REQ = {
    './asset-terms.js': () => __assetDep0,
    './asset-core.js': () => __assetDep1,
    './asset-market.js': () => __assetDep2,
    './asset-library.js': () => __assetDep3,
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
/* src/modules/asset/asset-project.js */
'use strict';

// ============================================================================
// 资产模块 · 投影正文渲染（批次 D1）—— 公开层 / 私密层，**同一个渲染器**
// ----------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md` §4（:579-614）
//   §4.1 两条条目 · §4.2 三级闸门 · §4.3 公开层 / 私密层 · §4.4 不写占位
//
// 这一层**只把账本变成文本**：零 DOM、零存储、零全局写入、零随机、零 `Date.now()`。
// 时间与"收谁"都由调用方传进来（幂等的代价，也正是幂等的保证）。世界书写回在 D2。
//
// ★★ 两条层用的是**同一个**渲染器（`renderAssetText` 收 `layer`），不是两套函数：
//    §4.2 第 ③ 条要求"字段开关只有一个渲染器读它两次"（投影文本一次、查看态一次）。
//    两层若各写一套，第一次改口径就会分叉成两张皮。
//
// ★★ 公开层**绝不许出现精确数字**（§4.3）。这是**安全性质**，不是排版偏好：
//    按角色名 selective 注入真实身家，模型会不自然地精确、或干脆说漏嘴。
//    判据见 `asset-project.test.js` 第 1 条：扫**阿拉伯数字** `[0-9]` ——
//    量级词只用汉字数字（「千万级」），所以扫 `[0-9]` 既不误伤量级词、
//    又必然抓住任何精确金额（「1842000」/「1,842,000」/「3200」）。
//    本文件里**一个阿拉伯数字都不许出现在正文里**（除了 `env.gates.hidden` 里的用户
//    字段名 —— 那是用户自己写的，不换皮也不清洗，例外清单见报告）。
//
// ★ 投影只吃**归一化产物**（`core.normalizeItem` 那一族）：`buildAssetEntries` 在入口
//   就把账本桶逐条过归一化，`renderAssetText` 只认归一化条目的形状（`stock.worth` /
//   `flows[]` 已经是 `normalizeFlow` 的产物）。**绝不**去读账本原件绕开归一化 ——
//   C1 的 `rawFlows`、C3 的 `flowSignedText` 都是这个反模式，已被诊断并修掉两次。
// ============================================================================

// ---- 认词口：唯一取词口是 asset-terms.js（与 core / 面板同一份，别在这儿抄一份）----
function resolveTerms() {
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-terms.js');
  } catch (e) { /* 浏览器 / 裁剪产物里没有 require —— 落到下面 */ }
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_TERMS__) return rt.__LA_ASSET_TERMS__;
  }
  return null;
}
const TERMS = resolveTerms();

// ---- core（`normalizeItem` / `sumNetWorth` / `sumFlows` 这一族）----
// ⚠️ 取法同 core 取 ledger：**不在 IIFE 顶层抓**（真机上它先执行，这里也是），
//    每次用的时候再问一次 —— 面板/测试可以在挂载之前先 require 本文件。
function coreApi() {
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_CORE__) return rt.__LA_ASSET_CORE__;
  }
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-core.js');
  } catch (e) { /* 裁剪产物 —— 落到 null */ }
  return null;
}

// ---- 行情那一层（`asset-market.js`：每日收盘序列 + 日因子）----
// ⚠️ 取法同 core：**不在 IIFE 顶层抓**，每次用的时候再问一次（真机是 bundle 拼接，
//    调用发生时全局一定已经挂好；而"没挂好"这件事本层要能**不投**，见 `marketText`）。
function marketApi() {
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_MARKET__) return rt.__LA_ASSET_MARKET__;
  }
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-market.js');
  } catch (e) { /* 裁剪产物 —— 落到 null */ }
  return null;
}
// ---- 标的表那一层（`asset-library.js`：三层合并后的 `symbolByCode`）----
// 取名字**只走它**（和面板 `marketNameOf` 同一把尺子）；取不到 ⇒ 那一格用代称（见 `marketText`），
// **绝不**回落印代码（`#600519` 带阿拉伯数字，会把公开层那条安全判据撞红）。
function libraryApi() {
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_LIBRARY__) return rt.__LA_ASSET_LIBRARY__;
  }
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-library.js');
  } catch (e) { /* 裁剪产物 —— 落到 null */ }
  return null;
}

// ---------------------------------------------------------------------------
// 小工具（全部不修改入参）
// ---------------------------------------------------------------------------
// 与账本层同形状的三个（core 也是从账本层借的）。这里**不 require 账本层**：
// project 只需要这三个判据，而多一条 `require` 就多一条 bundle 顺序约束。
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return v == null ? '' : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// 取词：词表取不到就回 `''`（**绝不编一个中文词**：编出来的词不会随档位换皮，
// 也就成了"面板切了档、投影没变"那种毛病的第二个来源）。真机上取不到 = bundle 拼错，
// `test/asset-panel.test.js` 的 A1b 契约测试盯着这件事。
function tw(T, key) {
  if (!T) return '';
  const v = T[key];
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// 量级词（§4.3「千万级」）：**只用汉字数字**，按绝对值分十一档
// ---------------------------------------------------------------------------
// 分档规则（**本任务自定裁定**，报告里写清）：每一档 = 一个整数数量级的一整段，
// 词取**那一档自己的**中文说法（不是下一个数量级）。
//   |v| < 1e3  → 不给量级（不加"级"）。「几两银子」这种盘子说"千级"是抬举它；
//                真正的小由**种类**与「欠的那一侧有没有」那一行说出来（§4.4：不说也不编）。
//   1e3   ≤ |v| < 1e4   → scaleThousand        → 「千级」
//   1e4   ≤ |v| < 1e5   → scaleWan             → 「万级」
//   1e5   ≤ |v| < 1e6   → scaleTenWan          → 「十万级」
//   1e6   ≤ |v| < 1e7   → scaleHundredWan      → 「百万级」
//   1e7   ≤ |v| < 1e8   → scaleThousandWan     → 「千万级」   ← §4.3 举例的那一档
//   1e8   ≤ |v| < 1e9   → scaleYi              → 「亿级」
//   1e9   ≤ |v| < 1e10  → scaleTenYi           → 「十亿级」
//   1e10  ≤ |v| < 1e11  → scaleHundredYi       → 「百亿级」
//   1e11  ≤ |v| < 1e12  → scaleThousandYi      → 「千亿级」
//   1e12  ≤ |v| < 1e13  → scaleTenThousandYi   → 「万亿级」   ← 顶档
//   |v| ≥ 1e13         → 不给量级（顶档之上不再细说：说"万亿级"已经足够模糊，
//                        再往上就够不着一个词了 —— **宁可不说，也不编一个词**）。
// ★ 1,842,000 ⇒ 「百万级」：它确实在 [1e6, 1e7) 里。§4.3 那个例子写的是「千万级」
//   （1,842,000 ≈ 1.84×10⁶），比本表低一档 —— 那张表里的例子是**随口举的**，本任务
//   自定的分档以"每一档都在自己的数量级里"为准：宁可低半档，也不把 184 万说成"千万"。
//   **这条裁定写进报告，交复审。**
// ⚠️ 词全部来自 `asset-terms.js`，本文件**不写任何量级词字面量**；档位 ↔ key 的映射是
//    `SCALE_TIERS` 这一张表（它只认 key，不认中文）。
// ⚠️ 汉字数字是刻意的：公开层的判据是"扫阿拉伯数字 `[0-9]`"（见文件头）。
//    写成「10万级」那一格就会被自己那条判据抓住 —— 判据与词表当场打架。
//    拼装是 `parts.map(...).join('')`：每一档的词由词表里的**词头**拼出来
//    （「十」+「万」= 十万），所以词表里没有「十万」这个整词，只有那两个词头。
const SCALE_TIERS = [
  { min: 1e12, parts: ['scaleTenThousandYi'] },
  { min: 1e11, parts: ['scaleThousandYi', 'scaleYi'] },
  { min: 1e10, parts: ['scaleHundredYi', 'scaleYi'] },
  { min: 1e9, parts: ['scaleTenYi', 'scaleYi'] },
  { min: 1e8, parts: ['scaleYi'] },
  { min: 1e7, parts: ['scaleThousandWan', 'scaleWan'] },
  { min: 1e6, parts: ['scaleHundredWan', 'scaleWan'] },
  { min: 1e5, parts: ['scaleTenWan', 'scaleWan'] },
  { min: 1e4, parts: ['scaleWan'] },
  { min: 1e3, parts: ['scaleThousand'] },
];
// 「级」是**句式后缀**，不是词表里的词：它形容的是"量级"这件事本身，三档中文相同
// （同 `instUnpriced` / `unvalued` 那一族解析性短句的理由）。
const SCALE_SUFFIX = '级';

// 一个金额的**量级词**（不含"级"；缺省 / 估不出来 / 小于千 → `''`，调用方据此整段省略）。
// 全函数：任何输入都不抛，`NaN` 回 `''`（"估不出来"不许被说成任何一档）。
// ⚠️ 回的是**裸词**（「千万」），不是带后缀的（「千万级」）—— 后缀由调用方加。
//    从前这里连后缀一起回，调用方再加一次就成了「万级级」：同一个句子拼两遍，
//    多一处拼接就多一个这种口子。**拼装只有一处**（`scaleText`）。
function scaleOf(amount, T) {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '';
  const v = Math.abs(n);
  // 顶档之上：**不给量级**（见上面那张表的最后一行）。少这一句，循环会一路落到
  // 「万亿级」那一档，把一个 10^15 的盘子说成"万亿"——那是**低报**，比不说更坏
  // （"这人不算有钱"与"这人的钱说不清"是两件事，§4.4 选后者）。
  if (v >= 1e13) return '';
  for (const tier of SCALE_TIERS) {
    if (v < tier.min) continue;
    const word = tier.parts.map(k => tw(T, k)).join('');
    // 词表缺一个 key（bundle 拼错 / 裁剪产物）⇒ 宁可不说，也不印一个半截的量级词
    if (tier.parts.some(k => !tw(T, k))) return '';
    return word;
  }
  return '';
}
// 量级 + 「级」：**唯一**的拼装口（见 `scaleOf` 的注释）。
function scaleText(amount, T) {
  const w = scaleOf(amount, T);
  return w ? w + SCALE_SUFFIX : '';
}

// ---------------------------------------------------------------------------
// 条目的形状（归一化产物）与几个判据
// ---------------------------------------------------------------------------
// 归一化条目的三块（§3.11.2）在投影里的用法**各不一样**，这一层一句都不许混：
//   · `cat`        → 类目名（走词表 `categoryWords`，换档只换这一个词）；
//   · `stock`      → 这一条的**值**（私有层印数，公开层只印量级）；
//   · `flows`      → 按周期的吞吐（私有层逐条印，公开层**一个字都不提**）；
//   · `state`      → 描述字段。私有层在**闸门放行**的前提下逐格印（成本 / 数量都在这儿），
//                    公开层一个字都不印 —— 数量与单价同时说出来就能反推精确值（§2.1.1 第 3 条）。
function itemsOf(raw) {
  if (Array.isArray(raw)) return raw.filter(isObj);
  return isObj(raw) ? [raw] : [];
}
function sideOf(item) {
  const it = isObj(item) ? item : {};
  if (it.side === 'asset' || it.side === 'liability' || it.side === 'none') return it.side;
  const tpl = isObj(it.template) ? it.template : {};
  if (tpl.side === 'asset' || tpl.side === 'liability' || tpl.side === 'none') return tpl.side;
  // 老模板只写 kind（§3.11.3）：认它一档，其余一律按资产侧（与 core 的 `entrySide` 同口径）
  if (tpl.kind === 'asset' || tpl.kind === 'liability' || tpl.kind === 'none') return tpl.kind;
  return 'asset';
}
function catOf(item) { return str(isObj(item) ? item.cat : '').trim(); }
function labelOf(item) {
  const it = isObj(item) ? item : {};
  return str(it.label).trim() || str(it.id).trim();
}
// 类目显示名：**只问 core 的取词口**（它内部走 `categoryWords(era)`）。拿不到就回落 cat id
// —— id 是稳定 ASCII 字面量（liquid / estate / …），落进公开层也不会带阿拉伯数字。
function catNameOf(env, id) {
  const core = env.core;
  if (core && typeof core.categoryDisplayName === 'function') return str(core.categoryDisplayName(id, env.era));
  const words = env.words;
  return (words && typeof words[id] === 'string' && words[id]) ? words[id] : str(id);
}

// ---------------------------------------------------------------------------
// 闸门（§4.2 第 ③ 条：逐字段「投影可见性」）
// ---------------------------------------------------------------------------
// 形状（**本任务自定裁定**，报告里写清）：
//   `gates = { byCat: { <类目 id>: [<字段 key>...] }, hidden: [<字段 key>...] }`
// 两格的分工（D2 补了 `byCat`，`hidden` 是 D1 的旧形状，**保留且仍然生效**）：
//   · `byCat`  —— D2 的**规范形状**，面板写的就是它。**按类目限定**：字段 key 是**同类目
//     模板内**的名字（`liquid` 的「户名」与 `estate` 的「名目」互不相干），而同一个名字
//     （「估值」）在 `estate` 与 `business` 里都存在 —— 一份**全局**的 key 清单必然让
//     "关掉不动产的估值"顺带把经营的估值也关掉（用户点了一个格子、两个格子变了）。
//     ★ 这就是 §4.2③ 说的"同类条目全表生效"：**全表**指的是同一类目模板下的每一条，
//     不是"跨类目的同名格子"。面板那一侧的说明词也就是照这一条写的。
//   · `hidden` —— D1 的形状：**不分类目**的 key 清单（旧调用方与既有测试用它）。
//     它在两类里**同时**生效，这是它当初的语义，不改（改了就是静默改变既有行为）。
// 关了 = 这一格的**标签与值都不写**（§4.4：不写占位，不写「（隐藏）」）。
// ⚠️ 闸门**只作用于私有层**：公开层本就一格 state 都不印（那是 §4.3 的层，不是开关）。
//    写死这条，是为了不让"关一格字段"变成"公开层也跟着变"——两层各有各的判据来源。
// ⚠️ 闸门**只管"给模型看什么 / 屏幕上看见什么"**，一处都不写盘（§4.2①：底层数据保留）。
function hiddenByCatOf(gates) {
  const src = isObj(gates) && isObj(gates.byCat) ? gates.byCat : {};
  const out = Object.create(null);
  for (const cat of Object.keys(src)) {
    const keys = arr(src[cat]).map(x => str(x).trim()).filter(Boolean);
    if (keys.length) out[str(cat).trim()] = keys;
  }
  return out;
}
function hiddenOf(gates) {
  return arr(isObj(gates) ? gates.hidden : null).map(x => str(x).trim()).filter(Boolean);
}
// 这一格**在某一条条目上**算不算被关了：按**那一条的类目**查 `byCat`，再查不分类目的 `hidden`。
// 判据只有这一处 —— `itemLines` 的 state 循环、存量那一行、汇总这三处全走它（§4.2③：
// "字段开关有且只有一个渲染器读它两次"，其中的"读"在本文件里就是这一个函数）。
function isHidden(env, key, cat) {
  const k = str(key).trim();
  if (!k) return false;
  if (arr(env.hiddenByCat[str(cat).trim()]).indexOf(k) >= 0) return true;
  return env.hidden.indexOf(k) >= 0;
}
// ★★ 「字段开关现在关没关这一格」的**读口**（修复轮 1/5 · Important-3 的修法 ②）。
//    面板不必、也不许自己拿 `hiddenByCat` 算显隐 —— 它连归一的形状都不用认识，
//    只把盘上那一格黑名单（`readProjection()` 的回话）交给这一个函数。
//    ⚠️ 为什么这一档**不进 `envOf` / `isHidden`**：本文件有两处、吃**两种**入参形状 ——
//       · 渲染入口（`renderAssetText` / `buildAssetEntries`）吃的是**闸门原文**
//         `gates = { byCat }`，走 `envOf` 归一（这是既有契约，D1 的 `hidden` 旧形状也在这儿）；
//       · 面板吃的是 **store 里那一格** `p = { enabled, off, hiddenByCat }`（它读的就是这一格，
//         见 `readProjection`）。让面板先把它翻译成 `byCat` 再问一次，就是多一处可以分叉的转换。
//    所以这一处**按两个形状都认**（`byCat` 与 `hiddenByCat` 各取一支，`hidden` 也照认）：
//    它是**读**，不是第二套判据 —— 闸门的语义（关了 = 标签与值都不写、按类目、旧的
//    `hidden` 不分类目）仍然只有 `hiddenOf` / `hiddenByCatOf` / `isHidden` 那一份。
//    ⚠️ 面板那一侧**一个 `hidden` 的谓词都没有了**：它只调这一个函数
//    （`test/asset-panel.test.js` 的 D2 ⑥ 扫源码对着这件事钉着，含**两步写法**）。
function isFieldHidden(projection, cat, key) {
  const p = isObj(projection) ? projection : {};
  const k = str(key).trim();
  if (!k) return false;
  const c = str(cat).trim();
  const byCat = isObj(p.byCat) ? p.byCat : (isObj(p.hiddenByCat) ? p.hiddenByCat : null);
  if (byCat && arr(byCat[c]).map(x => str(x).trim()).indexOf(k) >= 0) return true;
  return arr(p.hidden).map(x => str(x).trim()).indexOf(k) >= 0;
}

// ---------------------------------------------------------------------------
// 公开层（§4.3）：有哪些资产（类目名）+ 模糊量级 + 欠的那一侧有无
// ---------------------------------------------------------------------------
// 一行**一条**：`· <类目名>：<量级>`；量级说不出来时**只写类目名**（§4.4：宁可不说也不编）；
// 连类目名都取不到（词表没挂上）⇒ 这一行整个不出 —— 一个光秃秃的 `·` 就是占位。
// ★★ **同类多项 ⇒ 多行**（修复轮 1/5·Important-3）：§4.1（设计文档 :586）写的是
//    「按分类分行；**同类多项就是条目里的多项**」。从前的实现按类目去重、把同类多条并成
//    一行（三条不动产 ⇒ 一行），静默把"她有几处房产"这件事合并掉了 —— 而 §4.3 自己的
//    例子就带数量（「名下**有一套**住房」）。
//    一条一行**不加数量词**也能让模型数得出"几处"，且不碰"公开层不带精确数字"那条安全性质
//    （量级词恒是汉字数字，条数由行数说，不由数字说）。
// ⚠️ 每一行的量级仍是**该类目的存量合计**：行数说"有几项"，量级说"这一类大概什么盘子"。
//    逐条各印自己的量级会让"三处房产"变成三行看起来像三个人的盘子（而条目名不许进公开层，
//    行与行之间就没有任何可分辨的标识）——合并的是**量级**，不是**条数**。
// ⚠️ **本条目的名字（`label`）不进公开层**：那是资产名（「临湖别墅」），它不影响"有哪些
//    资产"这件事，却把用户自己写的任意文本（可能含数字）带进那份"不许有阿拉伯数字"的正文里。
//    这是把那条安全性质做**稳**的一半（另一半见文件头：量级词只用汉字数字）。
function publicLines(env, items) {
  const lines = [];
  // 先按类目求出"这一类合计多少"（只为量级用），再逐条出行 —— 两趟，一类的量级只算一次
  // （`sumNetWorth` 是 O(n) 的，逐行各算一遍就是 O(n²)，且同一类会算出同一个数）。
  const byCat = Object.create(null);
  for (const it of items) {
    const cat = catOf(it);
    if (!cat) continue;
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(it);
  }
  const scaleOfCat = Object.create(null);
  for (const cat of Object.keys(byCat)) {
    const sum = sumWorth(env, byCat[cat]);
    scaleOfCat[cat] = scaleText(sum ? sum.assets : NaN, env.terms);
  }
  // ★★ **量级只挂每类第一条**（修复轮 2/5·Minor）：量级说的是**这一类合计**的盘子，
  //    它是**整类**的信息 —— 印在每一行上就是同一个量级被复述 N 遍。
  //    给出的仍然是 N 行（行数说"有几项"），但"万级"只出现一次，模型不会把
  //    行数 × 量级叠乘成"N 倍万级"（100 条 × 5000 ⇒ 曾可被读成千万级 —— 那是**虚高**，
  //    与裁定一「宁可低半档也不虚高」直接冲突）。
  //    ⚠️ 行**照旧每项一行**：合并的是量级的**复述**，不是条数（裁定见 Important-3）。
  const scaledCat = Object.create(null);
  for (const it of items) {
    const cat = catOf(it);
    if (!cat) continue;
    const name = catNameOf(env, cat);
    if (!name) continue;
    const first = !scaledCat[cat];
    const scale = first ? scaleOfCat[cat] : '';
    if (first) scaledCat[cat] = true;
    lines.push(scale ? ('· ' + name + '：' + scale) : ('· ' + name));
  }
  // 欠的那一侧有没有（"手头紧不紧"那半句）：走词表的 `debtTotal` 那一格 + `debtYes` / `debtNo`。
  // 判据是 `sumNetWorth` 的**归属口径**（与面板同一份），不是拿类目 id 硬认「debt」。
  const debt = debtOf(env, items);
  if (debt.has) {
    const label = tw(env.terms, 'debtTotal');
    const word = debt.scale ? (debt.scale + SCALE_SUFFIX) : tw(env.terms, 'debtYes');
    if (label && word) lines.push('· ' + label + '：' + word);
  } else if (tw(env.terms, 'debtTotal') && tw(env.terms, 'debtNo')) {
    lines.push('· ' + tw(env.terms, 'debtTotal') + '：' + tw(env.terms, 'debtNo'));
  }
  return lines;
}

// 求和只认 core 的那一份口径；core 取不到时**什么都求不出来**（不是回 0 ——
// 回 0 等于替用户说他没钱，那是编数字）。
function sumWorth(env, items) {
  const core = env.core;
  if (!core || typeof core.sumNetWorth !== 'function') return null;
  const out = core.sumNetWorth(items);
  return isObj(out) ? out : null;
}
// 欠的那一侧：`{ has, scale }`。`has` 说的是"账上有没有欠"（§4.3 表格里的那一格），
// `scale` 是那笔欠的模糊量级（说不出来就是 `''`，由调用方退成"有"）。
function debtOf(env, items) {
  const core = env.core;
  const debtItems = items.filter(it => sideOf(it) === 'liability');
  if (!debtItems.length) return { has: false, scale: '' };
  const sum = sumWorth(env, debtItems);
  const n = sum ? sum.liabilities : NaN;
  return { has: true, scale: scaleOf(n, env.terms) };
}

// ---------------------------------------------------------------------------
// 私密层（§4.3）：精确金额、成本、盈亏、欠款明细、流水 —— "给账本主人自己看"的那一份
// ---------------------------------------------------------------------------
function privateLines(env, items) {
  const lines = [];
  const T = env.terms;
  // ★★ **闸门先过一遍再求和**（修复轮 1/5·裁定级 §5.1）：计价格子被关掉的条目，
  //    它那一格金额**一律不进汇总**。从前汇总读的是未过闸门的 `items`，于是
  //    `hidden:['存银']` 把存量那一行关掉了、三行汇总照旧印精确金额 —— "同一个渲染器
  //    读它两次"当场分叉（用户最可能关的一格恰恰是计价那一格）。
  //    ⚠️ 这里**剔除整条**而不是"留个位置印 0"：印 0 就是编数字（铁律 6，同 Important-2）。
  //    判据与 `itemLines` 同一处（`pricedKeyOf` + `isHidden`），不另立第二套。
  //    ★★ **但"整条剔出求和"自己就会走到 0**（修复轮 2/5·Important，本轮修的就是它）：
  //       闸门把计价字段**全关掉**时 `visible` 是空的 ⇒ `sumNetWorth([])` 回
  //       `{assets:0, liabilities:0, noValueCount:0, noneCount:0}` ⇒ 下面那个
  //       `valueless` 判据**不成立** ⇒ 照字面印「净资产：0 两 / 总资产：0 两 / 负债：0 两」。
  //       那与本条第一句（不许编 0）**当场打架**：剔条是为了"这笔钱不进汇总"，
  //       不是为了"把没有估算结果说成 0"。所以 `gatedAway` 必须与
  //       `noValueCount` / `noneCount` **同一档**进判据（见下）。
  const visible = items.filter(it => !pricedHidden(env, it));
  // 有条目、但全被闸门挡在汇总之外 ⇒ 汇总**没有可估的条目**（与"没填金额"是同一件事：
  // 都没有可估的值）。少了这半边，`sumNetWorth([])` 那个 0 就会被当成"真的估出来是 0"。
  const gatedAway = visible.length < items.length;
  const sum = sumWorth(env, visible);
  if (sum) {
    // 三行都用 `名字：数字 单位` 的同一形状（与下面每一条资产的存量那一行读起来一致）
    const unit = unitText(env, items);
    // ★★ **估不出来就明说，不编 0**（铁律 6 / 设计文档 :78）：一条正常归一化、但还没填金额的
    //    资产会让 `sumNetWorth` 回 `{assets:0, liabilities:0, noValueCount:1}` —— 照字面印
    //    就是「净资产：0 两」，而**同一段文本的下一行**正写着「存量：暂无可估的值 1」，
    //    自相矛盾。`side:'none'`（在册不计价）同理。
    //    所以两侧都是 0 而又有"算不出值的条目"时，**金额那半句换成词表里现成的那句**
    //    （`instValueNone`：暂无可估的值 / 暂无估得出的值 / 暂无可算之值）—— 标签照印，
    //    这样"净资产是多少"这个问题仍有一句回答，而回答不是数字。
    //    ★★ **"全被闸门关掉"是同一档的第三个来源**（`gatedAway`，修复轮 2/5）：
    //    与"没填金额"在汇总这一层是**同一件事** —— 都没有任何一个可估的值，
    //    所以答同一句话（`instValueNone`），这正是不虚高的那一半。
    //    ⚠️ **二选一的另一条路（不印那三行）为什么不选**：那会让"关了一格字段"顺带把
    //    "这个人净资产这个问题的答案"整块抹掉，而答案本来是**有**的（就是"估不出来"）；
    //    且与本条已有的 Important-2 修法分叉成两套口径 —— 本模块反复栽在"同一件事两个答案"上。
    //    所以走"词表现成的那句"，一条判据三个来源（noValueCount / noneCount / gatedAway）。
    //    ⚠️ 只在**两侧都 0** 时替换：只要还有一处估得出值，那一处照旧印精确数字
    //    （"另有无法估值 N 项"那句是面板的读数，不是本层要印的金额行）。
    const valueless = sum.assets === 0 && sum.liabilities === 0
      && (sum.noValueCount > 0 || sum.noneCount > 0 || gatedAway);
    const word = valueless ? tw(T, 'instValueNone') : '';
    const amountLine = (label, n) => {
      const body = valueless ? word : amountText(n);
      // 词表缺 key（bundle 拼错）时**不印半个空壳**（`名字：` 后面什么都没有就是占位，§4.4）
      if (!label || !body) return null;
      return label + '：' + body + (!valueless && unit ? ' ' + unit : '');
    };
    for (const [label, n] of [[tw(T, 'netWorth'), sum.net], [tw(T, 'totalAssets'), sum.assets], [tw(T, 'debtTotal'), sum.liabilities]]) {
      const line = amountLine(label, n);
      if (line) lines.push(line);
    }
  }
  for (const it of items) lines.push(...itemLines(env, it));

  const flows = [];
  for (const it of items) for (const f of arr(it.flows)) flows.push(f);
  if (flows.length) {
    const s = sumFlowsOf(env, flows);
    if (s) {
      lines.push('· ' + tw(T, 'kindBalance') + '：' + amountText(s.balance)
        + '；' + tw(T, 'kindCashflow') + '：' + amountText(s.cashflow)
        + '；' + tw(T, 'kindReserve') + '：' + amountText(s.reserve));
    }
    for (const f of flows) lines.push('  ' + flowText(env, items, f));
  }
  return lines;
}

// 一条资产：类目 / 值 / 存量 / state（闸门放行的那些格）。
function itemLines(env, item) {
  const lines = [];
  const T = env.terms;
  const label = labelOf(item);
  const cat = catOf(item);
  // 类目名与条目名是**两件事**：前者换皮（取词口），后者是用户写的资产名（不换皮、原样印）。
  // 分隔符与公开层的 `· <名>：<值>` 同一形状，两处读起来是一份东西（幂等也更好断言）。
  const head = [label, cat ? catNameOf(env, cat) : ''].filter(Boolean).join('：');
  if (head) lines.push('· ' + head);
  const worth = stockWorthOf(item);
  const stockHead = tw(T, 'detailStock');
  // ★★ **计价格子也过闸门**（修复轮 1/5·裁定级 §5.1）：这一格是用户最可能关的一格
  //    （"这笔钱别给模型看"），而从前 `itemLines` 只把计价格子从 `state` 循环里跳过、
  //    存量那一行**无条件**读 `stock.worth` ⇒ `hidden:['存银']` 关了个寂寞：行照印、
  //    金额照旧。那与"关了 = 标签与值都不写"（§4.4）直接矛盾，也正是 §4.2③
  //    "同一个渲染器读它两次"要防的分叉。
  //    关掉就**整行不出**（与其它字段同一档：不写占位、不写「（隐藏）」——
  //    §4.4 说得很直白：占位比不写更糟）。汇总那一处同一判据（见 `privateLines`）。
  if (stockHead && !pricedHidden(env, item)) {
    const parts = [];
    parts.push(worth === null ? tw(T, 'instValueNone') : amountText(worth));
    const unit = stockUnitOf(env, item);
    if (unit && worth !== null) parts.push(unit);
    const qty = quantityOf(env, item);
    if (qty !== '') parts.push(qty);
    const body = parts.filter(Boolean).join(' ');
    if (body) lines.push(stockHead + '：' + body);   // 空壳 `存量：` 是占位，不出
  }
  // state：**逐格**印（闸门关掉的整格不写，§4.4）。两类格子不印：
  //   ① 计价格子 —— 它的值已经在存量那一行印过了（再印一遍是同一笔钱说两次）；
  //   ② **迁移补出来的默认值**（`defaultedFields`）—— 那不是用户写的东西，印出来就是占位
  //      （§4.4 的反面：「户名：」这种空壳会让模型以为账上真有个没填的名字）。
  const tpl = isObj(item.template) ? item.template : {};
  const fields = arr(tpl.fields).filter(isObj);
  const pricedKeys = fields.filter(f => f.sum === true).map(f => str(f.key).trim());
  const injected = arr(item.defaultedFields).map(k => str(k).trim());
  const state = isObj(item.state) ? item.state : {};
  for (const key of Object.keys(state)) {
    if (!key || pricedKeys.indexOf(key) >= 0) continue;
    if (injected.indexOf(key) >= 0) continue;             // 补出来的默认值不是用户写的
    if (isHidden(env, key, catOf(item))) continue;        // §4.4：整格省略
    const field = fields.filter(f => str(f.key).trim() === key)[0];
    const name = (field && str(field.label).trim()) || key;   // 用户起的字段名不换皮
    lines.push('  ' + name + '：' + stateText(state[key]));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 计价格子：**一个判据两处用**（`itemLines` 的存量行、`privateLines` 的汇总）。
// ---------------------------------------------------------------------------
// 闸门是按 **`state` 字段名**给的（`hidden: ['存银']` 就是模板里那个计价字段的 key），
// 所以"这一条的金额能不能关"要按**那一格字段名**认，而不是按金额落在哪儿认：
//   ① 模板里标了 `sum: true`、且 `state` 上**真有这一格**的字段（第一条胜）⇒ 回那个 key，
//      `hidden` 里写它就能关。★ 这是闸门**唯一**能生效的一档。
//      （判据与 `itemLines` 里跳过 state 的 `pricedKeys` 同一处 —— 那一段说的正是
//       "计价格子不在这里印，值在存量那一行"，本判据就是那一行过闸门的钥匙。）
//   ② 没有这样的格子（金额直接写在 `stock.worth` / `stock.amount` / `item.worth` 上：
//      条目自带的存量值，没有对应的 state 字段）⇒ 回 `'worth'` —— **没有可关的字段名**，
//      闸门管不着它。这一档不能回 `''`，否则与"回空 = 没得关"分不开。
//   ⚠️ 顺序**不许**反过来按"金额落在哪儿"排（① 之前先看 `stock.worth`）：`normalizeItem`
//      那一趟的活正是把 ① 的值落成 `stock.worth`，所以正常路径上 `stock.worth` 恒在 ——
//      先看它就永远回 `'worth'`，闸门**当场形同虚设**（修复轮里先踩到、又被测试抓住的坑）。
//   ⚠️ 计价字段取**第一条**（`find`），与 core `itemWorth` 同一把尺子。
const WORTH_KEY = 'worth';
function pricedKeyOf(item) {
  const tpl = isObj(item.template) ? item.template : {};
  const state = isObj(item.state) ? item.state : {};
  const f = arr(tpl.fields).filter(isObj)
    .filter(x => x.sum === true)
    .filter(x => str(x.key).trim() && has(state, str(x.key).trim()))[0];
  if (f) return str(f.key).trim();
  const stock = isObj(item.stock) ? item.stock : {};
  if (has(stock, 'worth') || has(stock, 'amount') || has(item, 'worth')) return WORTH_KEY;
  return '';
}
// 这一条的**金额**被闸门关掉了吗（关了就整条不进汇总、存量那一行也不出）。
function pricedHidden(env, item) {
  const key = pricedKeyOf(item);
  if (!key || key === WORTH_KEY) return false;   // 没有可关的格子 / 存量那一格没有字段名
  return isHidden(env, key, catOf(item));
}
// 这一条**有没有一个真的能关的金额格子**（`pricedKeyOf` 的第一档）—— 有才回那个 key。
// ★ D2 并入的欠账（D1 复审观察）：`pricedKeyOf` 对"模板里没有任何 `sum` 字段、金额只落
//   `stock.worth`"的条目**恒回 `'worth'`**，而 `pricedHidden` 对 `'worth'` **恒 false**
//   —— 于是面板上给这种条目开一个"金额"开关是**静默空转**：用户关掉它，投影与面板
//   一个字节都不变（点了没反应，正是铁律 9 禁止的那一档）。
//   所以面板要问的是**这一个问题**（"有没有可关的格子"），而不是 `pricedKeyOf` 的产地。
//   ⚠️ 判据与 `pricedKeyOf` 的第一档**同一处**（`sum: true` 且 state 上真有那一格）；
//      没有就把 `'worth'` 那一档挡在面板之外 —— 闸门对它是死的，就不该摆那个键。
function pricedGateKey(item) {
  const key = pricedKeyOf(item);
  return (!key || key === WORTH_KEY) ? '' : key;
}
// 存量值：只认 core 的 `entryWorth`（`stock.worth` 优先、其次模板的计价格子）。
// 归一化过的条目**已经**把价落在 `stock.worth` 上，所以正常路径就是读它。
// 取不到 core 或算不出来 → `null`（"估不出来就明说"，绝不回 0）。
function stockWorthOf(item) {
  const stock = isObj(item.stock) ? item.stock : {};
  if (has(stock, 'worth')) {
    const n = Number(stock.worth);
    return Number.isFinite(n) ? n : null;
  }
  if (has(stock, 'amount')) {
    const n = Number(stock.amount);
    return Number.isFinite(n) ? n : null;
  }
  const core = coreApi();
  if (core && typeof core.entryWorth === 'function') {
    try {
      const n = core.entryWorth(item, isObj(item.template) ? item.template : undefined);
      return Number.isFinite(n) ? n : null;
    } catch (e) { return null; }
  }
  return null;
}
// 单位：先是模板里计价格子的 `unit`（core 已经把它带到 `stock.unit`），
// 再退到这一档的 `worthUnit`（元 / 两 / 灵石）。
function stockUnitOf(env, item) {
  const stock = isObj(item.stock) ? item.stock : {};
  const own = str(stock.unit).trim();
  if (own) return own;
  return tw(env.terms, 'worthUnit');
}
function unitText(env, items) {
  for (const it of items) {
    const u = stockUnitOf(env, it);
    if (u) return u;
  }
  return tw(env.terms, 'worthUnit');
}
// 数量：模板里标了 `agg: 'count'` 的那个字段（§3.11 决策 47）。**可以进私有层**，
// 但**绝不进公开层**（数量 + 单价能反推出精确值，§2.1.1 第 3 条）。
function quantityOf(env, item) {
  const tpl = isObj(item.template) ? item.template : {};
  const fields = arr(tpl.fields).filter(isObj);
  const state = isObj(item.state) ? item.state : {};
  for (const f of fields) {
    const key = str(f.key).trim();
    if (!key || f.agg !== 'count') continue;
    if (isHidden(env, key, catOf(item))) continue;
    if (!has(state, key)) continue;
    const n = Number(state[key]);
    if (Number.isFinite(n)) return amountText(n) + (str(f.unit).trim() ? str(f.unit).trim() : '');
  }
  return '';
}

function sumFlowsOf(env, flows) {
  const core = env.core;
  if (!core || typeof core.sumFlows !== 'function') return null;
  const out = core.sumFlows(flows);
  return isObj(out) ? out : null;
}
// 一条流水：`+3200 月息 收入 月 2026-02-04`。符号只认 core 的 `flowSigned`
// （入为正、出为负、转移归零）—— 那是**唯一**一份符号口径（C1 的 `flowSignedText`
// 就是在这儿分叉出去的）。
// 方向词与周期词同样**走词表**（`entryIn` / `entryOut` / `entryTransfer` 与
// `periodDay`…`periodYear`，与记账表单和详情页同一套 key，不另起一套）。
const PERIOD_TERMS = { day: 'periodDay', week: 'periodWeek', month: 'periodMonth', quarter: 'periodQuarter', year: 'periodYear' };
function flowText(env, items, flow) {
  const core = env.core;
  const T = env.terms;
  const f = isObj(flow) ? flow : {};
  const n = (core && typeof core.flowSigned === 'function') ? Number(core.flowSigned(f)) : 0;
  const parts = [amountText(Number.isFinite(n) ? n : f.amount)];
  const label = str(f.label || f.key).trim();
  if (label) parts.push(label);
  const reason = str(f.reason).trim();
  if (reason) parts.push(reason);
  const unit = str(f.unit).trim() || unitText(env, items);
  if (unit) parts.push(unit);
  const dir = str(f.direction);
  const dirWord = dir === 'out' ? tw(T, 'entryOut') : (dir === 'transfer' ? tw(T, 'entryTransfer') : tw(T, 'entryIn'));
  if (dirWord) parts.push(dirWord);
  const per = tw(T, PERIOD_TERMS[str(f.period)] || 'periodMonth');
  if (per) parts.push(per);
  const at = str(f.at).trim();
  if (at) parts.push(at);
  return parts.filter(Boolean).join(' ');
}
// 数字文本：私有层的精确值（公开层不许走到这里 —— 它一个字都不印 state / stock）。
// 每条流水自带单位时不另印：`f.unit` 有就跟着走。
function amountText(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return String(num);
}
function stateText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return ''; }
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// 渲染器（两条层共用的**同一个**函数）
// ---------------------------------------------------------------------------
// `renderAssetText(actor, { era, layer, gates })`
//   · actor：归一化条目（`core.normalizeItem` 的产物）或它的数组；
//   · layer：`'public'`（缺省）| `'private'`；
//   · 幂等：不读时钟、不读随机、不写任何外层状态 —— 同一份数据渲染两次逐字相同。
function renderAssetText(actor, opts) {
  const o = isObj(opts) ? opts : {};
  const env = makeEnv(o);
  const items = itemsOf(actor);
  if (!items.length) return '';
  const layer = str(o.layer).trim() === 'private' ? 'private' : 'public';
  const lines = layer === 'private' ? privateLines(env, items) : publicLines(env, items);
  return lines.filter(x => x !== '').join('\n');
}

function makeEnv(o) {
  const P = TERMS || null;
  return envOf(o.era, coreApi(), o.gates, P);
}
// 一份渲染环境：**那一档的合并词表**（`termsOf(era)`）、那一档的类目名（`categoryWords(era)`）、
// core 与闸门。★ 取出来的必须是**那一档的那一份**，不是词表模块本身：
//    `netWorth` / `detailStock` 这些 key 在 `ERA_UI[era]` 里，模块对象上**没有**
//    （`termsOf` / `uiTerms` / `categoryWords` 都是模块上的**函数**）。取错一层，
//    `tw` 恒回空串：正文只剩标点，静默、不抛、单测也不会红 —— D1 的第一版就栽在这儿，
//    所以测试里那条"类目名与量级词必须真的出现"的断言是必需的（不是保险）。
// ⚠️ 入参收的是**闸门原文**（不是算好的 `hidden` 数组）：两格（`byCat` / `hidden`）的解析
//    只在这一处发生，调用方给错形状也不会各自解释一遍。
function envOf(era, core, gates, P) {
  const terms = P && typeof P.termsOf === 'function' ? P.termsOf(era) : null;
  return {
    era,
    terms,
    words: P && typeof P.categoryWords === 'function' ? P.categoryWords(era) : null,
    core,
    hidden: hiddenOf(gates),
    hiddenByCat: hiddenByCatOf(gates),
  };
}

// ---------------------------------------------------------------------------
// 两条条目（§4.1）
// ---------------------------------------------------------------------------
// 返回的条目对象**照本仓既有的世界书投影写法**（`family-core.js:399-409` 的
// `withEntryText` / `medical.script.js:5694-5697` 的 `additions`）：
//   `{ name, comment, enabled, content, strategy: { type, keys } }`
//   · 总览条 = `strategy: { type: 'constant', keys: [] }`；
//   · 角色条 = `strategy: { type: 'selective', keys: [<角色名>] }`。
// ⚠️ 只出这五格：`position` / `recursion` / `order` 是**每个模块自己定的**注入位
//    （family 用 191~194、medical 一个字都不写），本任务不替 D2 定这个数。
//
// 一处条目**现在**归谁：只问 core 的 `ownerOf`（C6 的唯一判定口，含 `ownerLost` 算桶主
// 那三条裁定），core 取不到 / 回空 ⇒ 回落桶键。与面板 `asset.script.js:171-178` 的
// `ownerOfItem` **同一档**（那一处是给"面板正在看的那一份"用的，形状一样、理由一样）：
//   · 由 core 说了算 —— 本层也不自己写一份"有 ownerKey 就用、没有就回落桶"的规则；
//   · `ownerOf` 回空串（条目 `ownerKey` 是空字符串且桶键也空）⇒ 谁都不挂，不编一个空名字。
function ownerOfItem(core, entry, bucketKey) {
  const k = str(bucketKey).trim();
  if (core && typeof core.ownerOf === 'function') {
    const hit = str(core.ownerOf(entry, k)).trim();
    if (hit) return hit;
  }
  return k;
}

// `buildAssetEntries(ledger, { era, names, enabled, gates })`
//   · `ledger`  = 账本（`{ actors: { <键>: { entries, flows } } }`）；
//   · `names`   = `{ <键>: <显示名> }`。显示名由**调用方**给（面板从角色表取，
//                 取不到回落到键 —— `asset.script.js` 的 `ownerNameOf` 就是这一把尺子）；
//                 本层不认识角色表，**绝不编名字**，`names` 里没有就用键本身；
//   · `enabled` = 开了投影的角色键或显示名的数组。**给空数组就是"一个人都不收"**。
//                 ★★ **键缺失 = fail-closed：一个人都不收**（修复轮 1/5·Minor-7 裁定）。
//                 从前缺省是"不过滤（全收）"，方向与 §4.1「总览条**默认关**」相反 ——
//                 漏传一个参数最多该是"没投出去"，不该是"把所有人身家投出去"。
//                 （与家系投影 `family-core.js:572-576` 的 fail-open 反向，是本任务
//                  Controller 的明确裁定；D1 尚未上线，不存在既有调用方。）
//   · `gates`   = 逐字段闸门（见 `hiddenOf`）。
// ⚠️ 总开关（§4.2 ① 撤下全部投影条）**不在这里**：它是"调不调用本函数"，
//    由 D2 的写回那一层判（本层是纯函数，不该读设置）。
function buildAssetEntries(ledger, opts) {
  const o = isObj(opts) ? opts : {};
  const core = coreApi();
  const T = TERMS || null;
  const era = o.era;
  // ⚠️ core 取不到 ⇒ **什么都不返回**（不抛、也不退回读账本原件）：投影只吃归一化产物，
  //    归一化这一层没挂上就没有"产物"可言。**静默失效比读原件好**（读原件正是那条反模式）。
  if (!core || typeof core.normalizeItem !== 'function' || !T) return [];
  const actors = isObj(ledger) && isObj(ledger.actors) ? ledger.actors : {};
  const names = isObj(o.names) ? o.names : {};
  // fail-closed（见上）：`enabled` 不是数组（含键缺失 / `undefined` / 传了个字符串）⇒ 空数组。
  const enabled = Array.isArray(o.enabled) ? o.enabled.map(x => str(x).trim()).filter(Boolean) : [];

  // ★★ **按 `core.ownerOf` 分账，不按账本桶**（修复轮 1/5·Critical）：
  //    C6 立下的**唯一取数口**是"扫**所有**桶、按 `ownerOf(条目, 桶键)` 挂到它**现在的主人**
  //    名下"（`asset.script.js:196-224` 的 `distribution()`），因为**转移不搬条目** ——
  //    C4 的写侧只改 `ownerKey`，条目照旧躺在原主那个桶的 `entries[]` 里。
  //    投影从前按桶取数 ⇒ 转移之后模型看到的还是"东西在原主名下"、新主那一条**一个字都没有**
  //    —— 面板与投影两张皮（§4.2③ 明禁），也正是铁律 10（从哪儿来、到哪儿去）的反面。
  //    ⚠️ `ownerOf` 缺位（旧 core / 裁剪产物）时回落**桶键**（与面板 `ownerOfItem` 同一档）：
  //       "没有判据"时最不坏的一档就是 C6 之前的行为（条目归它落着的那个桶）。
  // 模板取法**与面板同一把尺子**（修复轮 1/5·Important-4，对照 `asset.script.js:1398-1407`
  // 的 `tplOf(it.cat) || it.template`）：**先查内置分类**，查不到才用条目内嵌的那一份。
  // 从前只认条目**内嵌**的模板 ⇒ 一条 `{cat:'debt', stock:{worth:500000}}`（无内嵌模板）
  // 会被当成资产侧、把"欠 50 万"投成"有 50 万"（虚高，且静默）。
  const tplOf = cat => (arr(core.BUILTIN_CATEGORIES)).filter(c => isObj(c) && str(c.id) === str(cat))[0] || null;
  const owned = Object.create(null);
  for (const bucketKey of Object.keys(actors)) {
    const bucket = isObj(actors[bucketKey]) ? actors[bucketKey] : {};
    for (const e of arr(bucket.entries).filter(isObj)) {
      const owner = ownerOfItem(core, e, bucketKey);
      if (!owner) continue;                    // 桶键本身空（脏账本）⇒ 谁都不挂，不编一个空名字的行
      if (!owned[owner]) owned[owner] = [];
      owned[owner].push(core.normalizeItem(e, tplOf(e.cat) || e.template, {}));
    }
  }

  const rows = [];
  for (const key of Object.keys(owned)) {
    const items = owned[key];
    if (!items.length) continue;               // 名下没有条目 ⇒ 不投影（空条目只会让模型好奇）
    const name = str(names[key]).trim() || key;
    rows.push({ key, name, owned: items });
  }
  const picked = rows.filter(r => enabled.indexOf(r.key) >= 0 || enabled.indexOf(r.name) >= 0);
  const env = envOf(era, core, o.gates, T);
  const entries = [];
  if (picked.length) {
    const overview = [];
    for (const r of picked) {
      const sum = sumWorth(env, r.owned);
      // 一行一个人，**全部模糊量级**（§4.1）。量级说不出来时**不写那一格**（§4.4：不写占位），
      // 净额为负（欠的那一侧压过资产侧）时说的是"欠债"那一档的量级 —— 净额的正负本身
      // 就是一句公开信息，藏起来反而会印出一个"背着债的人资产万级"的错觉。
      let line = '· ' + r.name;
      if (sum && sum.net < 0) {
        // 净额为负：不能只印一个量级（"十万级"会被读成"他很有钱"）。说清是哪一侧 + 隔开，
        // 免得「那一侧的词 + 量级」六个字糊成一坨（那一行没有第二个标点可用）。
        const s = scaleText(sum.liabilities, env.terms);
        if (s) line += '：' + tw(env.terms, 'debtTotal') + '：' + s;
      } else {
        const s = scaleText(sum ? sum.net : NaN, env.terms);
        if (s) line += '：' + s;
      }
      overview.push(line);
    }
    entries.push({
      name: OVERVIEW_NAME,
      comment: OVERVIEW_NAME,
      enabled: true,
      content: overview.join('\n'),
      strategy: { type: 'constant', keys: [] },
    });
  }
  for (const r of picked) {
    const content = publicLines(env, r.owned).filter(x => x !== '').join('\n');
    if (!content) continue;                          // §4.4：没有可说的一行就不摆一个空条目
    entries.push({
      name: ACTOR_PREFIX + r.name,
      comment: ACTOR_PREFIX + r.name,
      enabled: true,
      content,
      strategy: { type: 'selective', keys: [r.name] },
    });
  }
  return entries;
}

// 条目名（§4.1）。前缀里出现汉字「资产」是**通用词**（`asset-terms.test.js` 的反硬编码
// 扫描清单里没有它 —— 那份清单管的是面板结构词），且**必须是稳定的**：世界书条目按名字
// 认领与覆盖（`medical.script.js` 的 `keeps` 就是这么过滤的），换个档位也跟着换名字
// 会让旧条目变成孤儿。
const OVERVIEW_NAME = 'LA-资产总览';
const ACTOR_PREFIX = 'LA-资产·';
// ★ 第三个稳定名字（I1 · §5.9 的行情投影）。**为什么不是「LA-金融市场」**（brief 的建议值）：
//   条目名是**源码里的字符串字面量**，而 `金融市场` 正是新词键 `mktHead` 的现代档取值 ——
//   `asset-terms.test.js` ③ 的反硬编码扫描面把新键的值全收进去了（本轮加的），
//   写进条目名 ⇒ 当场红（实测）。所以名字取「行情」这个**通用词**（同 OVERVIEW_NAME 里
//   「资产」的地位：通用词不在扫描清单里），档位不换名字（换了旧条目就成孤儿）。
//   ⚠️ 名字**必须稳定**：删 / 覆盖那一侧全靠 `isOwnEntry` 按名字认领（见下）。
const MARKET_NAME = 'LA-行情';

// ===========================================================================
// ★★ I1（0.7.64）· **行情投影**（§5.9）—— 世界书里那一条常驻的市场背景
// ---------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md` §5.9（`:707-722`）+ 决策 23（`:37`）+ §12 第 4/7 条。
// 文本形状（逐字照 §5.9，三档取词之后的样子）：
//
//     [金融市场]
//     · 近况：{趋势综述} —— {主角持有部分的总市值量级 + 涨跌方向}
//     · 近期波动：{上次最大波动标的} {涨跌幅度}（{持有/未持有}）
//
// ★★ 与资产条目的 `selective` **刻意相反**：市场是**全局背景**，这一条是 `constant`
//    （常驻、keys 空、**不靠角色名命中**）。别把它"统一"成角色那一族 —— 那正是 §5.9 要的相反。
//
// ★ 本层同样**零存储 / 零 DOM / 零时钟 / 零随机**：`ledger` + `market` + `library` + `today`
//   全由调用方传进来（与 `renderAssetText` 同一条纪律），所以同一份数据渲染两次逐字相同。
//
// ★★ 三条安全 / 省 token 的性质（各有针脚，见 `test/asset-project.test.js` 的 I1 一节）：
//   ① **正文里不许出现阿拉伯数字**（公开层那条安全判据扫 `[0-9]`，`asset-project.test.js` ①）：
//      幅度**用词不用数字**（「大幅上涨」而不是「+3.2%」），量级走 `scaleText`（汉字数字）；
//      ⇒ 因此**绝不**回落印标的代码（`#600519` 带数字）。
//   ② **无关标的不点全名**（§5.9 细节 1）：只有**主角持有**的那一只才印真名，
//      其余一律印词表里的代称。省 token，也贴合"你不关心的事不该占上下文"。
//   ③ **只在"和主角有关"时写得具体**：主角那一侧算不出总市值（没有持仓 / 没有价）
//      ⇒ 「—— …」那半句**整段不写**（§4.4：不写占位，更不编一个 0）。
//
// ⚠️ 两处**本任务自定裁定**（照现场为准，报告 §3 逐条写清）：
//   · 「波动最大者」= **窗口内单日涨跌幅绝对值最大**的那一对 `(标的, 那一天)`
//     —— 决策 23 的原话是"上次大涨或大跌的那只"，落成"某一天的那一次涨跌"最贴字面；
//     排名用**相对**口径（§5.9 细节 2 / 决策 25：不用绝对百分比阈值去决定"投不投"），
//     阈值只用来把幅度**说成哪个词**（`MARKET_BIG_MOVE`，可配，默认 3%）。
//   · 窗口 = 每只标的**自己最后 N+1 个收盘点**（N = 7，用户 2026-09-20 拍定）；
//     `today` 给了就先用 ISO 串比较滤掉晚于它的点（**不引日历层**：本层不解析日期）。
// ===========================================================================
const MARKET_WINDOW_DAYS = 7;           // 「近 N 日」的 N（用户已拍定 = 7）
const MARKET_BIG_MOVE = 0.03;           // 幅度词「大 / 小」的分界（可配；排名口径才是默认）
const MARKET_TREND_FLAT = 0.005;        // 趋势综述判「走平」的带宽（可配；免得噪声被说成方向）

// 一只标的在窗口里的收盘点（`{ d, p }`，日序递增）。
//   · **降级读**：`asset-market.js` 的 `closesOf` 是"这一格长什么样"的**唯一出处**
//     （老聊天那三格没有序列 ⇒ 空数组）。取不到行情那一层 ⇒ 空数组（= 本层不投这一条）：
//     宁可**不投**，也不在投影层另写一份"序列怎么读"（那就是第二份口径）。
//   · `today` 非空 ⇒ 只留 `d <= today` 的点（ISO 串比较；行情推进本来就不写未来日）。
function marketCloses(rec, today) {
  const M = marketApi();
  if (!M || typeof M.closesOf !== 'function') return [];
  const list = M.closesOf(rec);
  const t = str(today).trim();
  if (!t) return list;
  return list.filter(x => x.d <= t);
}
// 窗口：最后 `N + 1` 个点（算 N 天的日涨跌要 N+1 个点）。
function marketWindow(rec, today, windowDays) {
  const pts = marketCloses(rec, today);
  const n = Number(windowDays) > 0 ? Math.floor(Number(windowDays)) : MARKET_WINDOW_DAYS;
  if (pts.length < 2) return [];
  return pts.slice(-(n + 1));
}
// 主角那一侧：`{ 代码: 合计数量 }`（**只认主角名下**的持仓条目 —— §5.9 细节 1 的"和主角有关"）。
//   · 归属**只问 core 的 `ownerOf`**（与面板 `distribution()` / `buildAssetEntries` 同一口径）；
//   · `holding` 认不出 / 数量不是正数 ⇒ **跳过那一条**（不编数、也不当 0）；
//   · `Object.create(null)` 防原型穿透（用户数据当键，见 `asset-keys.js` 那一族）。
function marketHeldBy(ledger, protagonist) {
  const out = Object.create(null);
  const who = str(protagonist).trim();
  if (!who) return out;
  const core = coreApi();
  const actors = isObj(ledger) && isObj(ledger.actors) ? ledger.actors : {};
  for (const bucketKey of Object.keys(actors)) {
    const bucket = isObj(actors[bucketKey]) ? actors[bucketKey] : {};
    for (const e of arr(bucket.entries).filter(isObj)) {
      if (ownerOfItem(core, e, bucketKey) !== who) continue;
      const h = isObj(e.holding) ? e.holding : null;
      const code = h ? str(h.symbol).trim() : '';
      const qty = h ? Number(h.qty) : NaN;
      if (!code || !Number.isFinite(qty) || qty <= 0) continue;
      out[code] = (out[code] || 0) + qty;
    }
  }
  return out;
}
// 标的显示名：**只走标的表的三层合并结果**（`asset-library` 的 `symbolByCode`）。
// 查不到 ⇒ 空串（调用方用词表里的代称 —— **绝不**印代码：代码带阿拉伯数字）。
function marketSymbolName(library, code) {
  const lib = libraryApi();
  if (!lib || typeof lib.symbolByCode !== 'function') return '';
  try {
    const e = lib.symbolByCode(library, code);
    return e && typeof e.name === 'string' ? e.name.trim() : '';
  } catch (err) { return ''; }
}

// ★ **唯一的行情正文渲染口**（纯函数）。回**整条条目的 content**（含头部那一行）；
//   没有任何可说的一行 ⇒ 回 `''`（§4.4：不摆一个空条目）。
//   `marketText(ledger, { era, market, library, today, protagonist, windowDays, gates })`
function marketText(ledger, opts) {
  const o = isObj(opts) ? opts : {};
  const T = envOf(o.era, coreApi(), o.gates, TERMS).terms;
  if (!T) return '';
  const head = tw(T, 'mktHead');
  const recent = tw(T, 'mktRecent');
  const moveLabel = tw(T, 'mktMove');
  if (!head || !recent || !moveLabel) return '';          // 词表缺位 ⇒ 不投（绝不编一个中文词）
  const market = isObj(o.market) ? o.market : null;
  const prices = market && isObj(market.prices) ? market.prices : null;
  if (!prices) return '';

  // ① 每只标的的窗口与窗口涨跌幅。**代码排序**（不是对象键序）：同一份数据两次渲染逐字相同。
  const series = [];
  for (const code of Object.keys(prices).sort()) {
    const win = marketWindow(prices[code], o.today, o.windowDays);
    if (win.length < 2) continue;
    const first = win[0].p, last = win[win.length - 1].p;
    const ret = (last - first) / first;
    if (!Number.isFinite(ret)) continue;                   // 起点价为 0 那一档（脏数据）⇒ 跳过
    series.push({ code: code, win: win, ret: ret });
  }
  if (!series.length) return '';

  // ② 趋势综述：全部标的窗口涨跌幅的**均值**（三档取词，阈值可配）。
  const avg = series.reduce((a, s) => a + s.ret, 0) / series.length;
  const trendKey = avg > MARKET_TREND_FLAT ? 'mktTrendUp' : (avg < -MARKET_TREND_FLAT ? 'mktTrendDown' : 'mktTrendFlat');

  // ③ 上次最大波动的那一只：窗口内**逐个交易日**算涨跌幅，取绝对值最大者。
  //    ⚠️ 平手时**第一只**说了算（代码升序 + 日序升序，严格大于才换手）⇒ 确定性。
  let mover = null;
  for (const s of series) {
    for (let i = 1; i < s.win.length; i++) {
      const prev = s.win[i - 1].p, cur = s.win[i].p;
      const ch = (cur - prev) / prev;
      if (!Number.isFinite(ch)) continue;
      if (!mover || Math.abs(ch) > Math.abs(mover.ch)) mover = { code: s.code, ch: ch };
    }
  }
  if (!mover) return '';

  // ④ 主角那一侧：持仓的**总市值量级 + 涨跌方向**（算不出来 ⇒ 这半句整段不写）。
  const held = marketHeldBy(ledger, o.protagonist);
  let total = 0, weight = 0, weighted = 0;
  for (const s of series) {
    const qty = held[s.code];
    if (!qty) continue;
    const v = qty * s.win[s.win.length - 1].p;
    if (!Number.isFinite(v) || v <= 0) continue;
    total += v;
    if (Number.isFinite(s.ret)) { weighted += v * s.ret; weight += v; }
  }
  const scale = total > 0 ? scaleText(total, T) : '';
  let dirWord = '';
  if (scale && weight > 0) {
    const d = weighted / weight;
    dirWord = d > MARKET_TREND_FLAT ? tw(T, 'mktDirUp') : (d < -MARKET_TREND_FLAT ? tw(T, 'mktDirDown') : tw(T, 'mktDirFlat'));
  }

  // ⑤ 波动那一条：**持有才点全名**，否则用词表里的代称（§5.9 细节 1）。
  const heldMover = !!held[mover.code];
  const realName = heldMover ? marketSymbolName(o.library, mover.code) : '';
  const moverName = heldMover ? (realName || tw(T, 'mktAnonymous')) : tw(T, 'mktAnonymous');
  const big = Math.abs(mover.ch) >= MARKET_BIG_MOVE;
  const moveKey = mover.ch >= 0 ? (big ? 'mktRiseBig' : 'mktRiseSmall') : (big ? 'mktFallBig' : 'mktFallSmall');
  const moveWord = tw(T, moveKey);
  const heldWord = tw(T, heldMover ? 'mktHeld' : 'mktNotHeld');
  if (!moverName || !moveWord || !heldWord) return '';

  const lines = ['[' + head + ']'];
  lines.push('· ' + recent + '：' + tw(T, trendKey) + (scale && dirWord ? ' —— ' + scale + dirWord : ''));
  lines.push('· ' + moveLabel + '：' + moverName + ' ' + moveWord + '（' + heldWord + '）');
  return lines.join('\n');
}

// ===========================================================================
// 投影落库（批次 D2）：整写回 + **读空守卫**
// ---------------------------------------------------------------------------
// 范式**照抄** `src/modules/family/family.script.js:320-334`（本仓踩过的坑，不是可选项）：
//   ① 先**读**当前条目；读不到 / 读回空数组 ⇒ **一个字节都不写**，回一句"尚未就绪，已延后重试"，
//      并排一次重试 —— **绝不**把用户的世界书覆盖成"只剩 Daka2 条目"（一次性、不可逆）；
//   ② 整写回 = 读全量 → 剔掉**自己**的旧条目（按名字认领）→ 追加本次的条目 → 一次写清；
//   ③ 总开关关掉时 walked 的 `entries` 是**空数组**，走的是同一条路（剔掉自己的、留下别人的）
//      —— 删除路径**同样**先读、同样守卫（不然"关掉总开关"就成了清空世界书的那把刀）；
//   ④ 只认**名字**来认领自己的条目：`LA-资产总览` 精确、其余按 `LA-资产·` 前缀。
//      `medical.script.js` 的 `keeps` 就是这么过滤的（§4「只动自己 `LA-` 前缀的条目」）。
//
// ⚠️ 本层**不读设置、不读时钟、不写账本**：闸门状态与账本由调用方给（`isOwnEntry` 也不读），
//    这样 "读空守卫" 与 "整写回" 两件事能被单独钉住（`test/asset-project-writeback.test.js`）。
// ⚠️ 本层也**不 setTimeout**：重试由调用方（面板 / 后续的自动推进）排 —— 一个纯的
//    "投影一次"函数凭空起定时器，就等于把"渲染"变成"有副作用"（并让测试依赖真实时间）。
//    这与 family 的形状**刻意有一处不同**（它在里面 setTimeout）：那一处是它的运行环境
//    （面板按钮之外没有别的调度者）；本模块的调度者在面板与批次 E/F 的推进里，
//    把"何时再试"留给它们，判据仍然只有一份（见 `PROJECTION_RETRY_INTERVAL_MS`）。
const PROJECTION_RETRY_INTERVAL_MS = 800;   // 与 family / map 的 800ms 同档（同一族缺陷、同一族节拍）
const PROJECTION_MAX_RETRIES = 10;          // 与 family `MAX_LINEAGE_PROJECTION_RETRIES` 同档

// 认领"这一条是我的"：入口是**名字**（不是 uid —— uid 是宿主那一侧的东西，
// 换一本书、换一次读法就会变；名字是本模块自己定的、稳定的，见 `OVERVIEW_NAME`）。
// ★★ I1（0.7.64）：**新加的第三个名字必须同时进这里** —— `isOwnEntry` 决定"哪些条目是本模块的"，
//    删 / 覆盖那一侧全靠它（`projectAssetWorldbook` 的 `keeps` 就是 `!isOwnEntry`）。
//    漏了它 ⇒ **关掉开关之后那一条会永远留在用户的世界书里**（而且删除路径有"读空就整写回"
//    的守卫，症状会很不明显：别的条目撤干净了、就它一个留在那儿）。
//    `test/asset-project-writeback.test.js` 的 I1 一节有"关掉 ⇒ 条目被摘掉"的针脚。
function isOwnEntry(entry) {
  const name = str(isObj(entry) ? entry.name : '').trim();
  const comment = str(isObj(entry) ? entry.comment : '').trim();
  return name === OVERVIEW_NAME || name === MARKET_NAME || name.indexOf(ACTOR_PREFIX) === 0
    || comment === OVERVIEW_NAME || comment === MARKET_NAME || comment.indexOf(ACTOR_PREFIX) === 0;
}

// 本次要投出去的世界书条目（总开关关 ⇒ 空数组）。
//   `projection` = `{ enabled, off, gates }`（形状见 `asset.script.js` 的 `readProjection`）：
//     · `enabled !== true` ⇒ **一个条目都不投**（§4.2①：撤下全部投影条，底层数据保留）；
//     · `off` = **不投影**的角色键或显示名（§4.2②：不投影、也不进总览）；
//     · `participants` = 账本里"参与并投影"的角色（键与显示名都要给 —— `enabled` 那一格
//       两种写法都认，见 `buildAssetEntries`）。
// ★ `enabled` 必须**显式**给（`buildAssetEntries` 的缺省是 fail-closed：谁都不收）。
//   所以这里**先算名单**：账本里有桶的 ∪ 名下有资产的（与面板 `distribution().keys` 同一档），
//   再减掉 `off` —— 少了"先算"这一步，投影会静默地一个人都不收（那正是 fail-closed 的设计意图：
//   漏参数最多是"没投出去"，不该是"把所有人身家投出去"）。
function projectionEntries(ledger, opts) {
  const o = isObj(opts) ? opts : {};
  const p = isObj(o.projection) ? o.projection : {};
  if (p.enabled !== true) return [];               // §4.2① 总开关
  const core = coreApi();
  const names = isObj(o.names) ? o.names : {};
  const actors = isObj(ledger) && isObj(ledger.actors) ? ledger.actors : {};
  const off = arr(p.off).map(x => str(x).trim()).filter(Boolean);
  const participants = [];
  const seen = Object.create(null);
  const push = k => { const s = str(k).trim(); if (s && !seen[s]) { seen[s] = true; participants.push(s); } };
  // ① 账本里已有的桶（与面板 `distribution()` 的 ① 同一口径：有一条流水/一条条目就算一个人）
  for (const k of Object.keys(actors)) push(k);
  // ② 名下有资产的人（转移过去的新主可能**一个桶都没有** —— 漏了这半边，转出去的东西
  //    在新主那一条里一个字都没有；与面板 `distribution()` 的 ② 同一口径）
  for (const bucketKey of Object.keys(actors)) {
    const bucket = isObj(actors[bucketKey]) ? actors[bucketKey] : {};
    for (const e of arr(bucket.entries).filter(isObj)) push(ownerOfItem(core, e, bucketKey));
  }
  // ★ `enabled` 收的是**键或显示名**，而要减掉的 `off` 也用同一种写法给 —— 两边同形，
  //   免得"关了张三"因为一处用键、一处用名字而关了个寂寞（§4.2③ 那张皮的两处之一）。
  const enabled = participants.filter(k => off.indexOf(k) < 0 && off.indexOf(str(names[k]).trim() || k) < 0);
  const entries = buildAssetEntries(ledger, { era: o.era, names, enabled, gates: p.gates });
  // ★ I1（0.7.64）· **行情那一条**（§5.9）：与上面两条**并列的第三种**条目，
  //   同样是"总开关开着才有"，另加它自己那一格勾选（`projection.market`，默认关 ——
  //   键缺失 = 关，与 `readProjection` 的既有一致口径相同）。
  //   ⚠️ 顺序：市场是**全局背景**，摆在**最前面**（条目注入顺序不归本层定，
  //      本层只决定数组顺序；`position` / `order` 是接线层的事，同 §4.1 的注释）。
  //   ⚠️ 内容为空（没有序列 / 没有可说的一行）⇒ **一个条目都不摆**（§4.4 不写占位）。
  if (p.market === true) {
    const content = marketText(ledger, {
      era: o.era, gates: p.gates, market: o.market, library: o.library,
      today: o.today, protagonist: o.protagonist, windowDays: o.windowDays,
    });
    if (content) {
      entries.unshift({
        name: MARKET_NAME,
        comment: MARKET_NAME,
        enabled: true,
        content: content,
        strategy: { type: 'constant', keys: [] },
      });
    }
  }
  return entries;
}

// 「读空」的判据 —— **本任务自定裁定**（报告里写清）：
//   · `findCurrent()` 回空（null / ''  / 非字符串）            ⇒ 读空（连"投到哪儿"都还不知道）；
//   · `getEntries()` **抛错**                                  ⇒ 读空（读不到 ≠ 书里没有）；
//   · `getEntries()` 回的**不是数组**（含 `null` / `undefined`）⇒ 读空；
//   · `getEntries()` 回**空数组**（`length === 0`）             ⇒ 读空。
// ★ 为什么空数组也算读空（而不是"这本书真的是空的、那就照写"）：角色卡世界书里恒有
//   角色卡自己那些条目（世界书是**角色卡**的，不是 Daka2 的）。回空数组只有两种可能 ——
//   世界书/聊天还没加载完，或读接口降级成空。两种情况下整写回都会**不可逆地**把用户的书
//   覆盖成"只剩 Daka2 条目"，而它换不来任何东西（Daka2 的条目下一趟照投）。
//   代价与收益不对称 ⇒ **不写**（与 family `family.script.js:323` 逐字同一条判据）。
function readIsEmpty(current) {
  return !Array.isArray(current) || current.length === 0;
}

// 投影一次（**唯一的投影落库口**）。回 `{ ok, deferred, reason, projected, message }`：
//   · `ok: true`                     —— 真的写过了（`projected` 是本次投出去的条目数）；
//   · `ok: false, deferred: true`    —— 读空守卫拦下，**一个字节都没写**，`message` 是那句"尚未就绪"；
//   · `ok: false, deferred: false`   —— 依赖不齐 / 写盘被拒（都是"用户无从下手"的毛病，
//                                       面板只把它们留在控制台，§7.5）。
// ⚠️ **删条路径与投条路径是同一条路**：`entries` 空的时候 `keeps` 就是"剔掉自己的全部"，
//    写出去等于把 Daka2 的条目撤下（§4.2① 的总开关正是这么撤的）。守卫对两者一视同仁。
async function projectAssetWorldbook(opts) {
  const o = isObj(opts) ? opts : {};
  const wb = o.worldbook;
  const ledger = o.ledger;
  // 「尚未就绪」那一句走**这一档的词表**（`envOf` 与渲染器同一个取词口）。
  // ⚠️ 从前这里写的是 `tw(TERMS, ...)` —— `TERMS` 是**词表模块**（函数都在模块上），
  //    不是**那一档的那一份**，`tw` 在它上面恒回空串：守卫照旧拦住写入（安全的半边在），
  //    但"尚未就绪"那句话**静默变成空串**（面板上就只剩一个没话说的延迟）。这正是
  //    `envOf` 注释里 D1 栽过的同一个坑（取错一层），所以判据一律走 `envOf`。
  const message = () => tw(envOf(o.era, null, null, TERMS).terms, 'projNotReady');
  if (!wb || typeof wb.findCurrent !== 'function' || typeof wb.getEntries !== 'function'
    || typeof wb.replaceEntries !== 'function') {
    return { ok: false, deferred: false, projected: 0, message: '' };
  }
  let target = null;
  try { target = wb.findCurrent(); } catch (e) { target = null; }
  if (!target) return { ok: false, deferred: true, projected: 0, message: message() };
  let current = null;
  try { current = await wb.getEntries(target); } catch (e) { current = null; }
  if (readIsEmpty(current)) {
    return { ok: false, deferred: true, projected: 0, message: message() };
  }
  const entries = projectionEntries(ledger, o);
  const keeps = current.filter(e => !isOwnEntry(e));
  try {
    await wb.replaceEntries(target, keeps.concat(entries), 'debounced');
  } catch (e) {
    return { ok: false, deferred: false, projected: 0, message: str(e && e.message) };
  }
  return { ok: true, deferred: false, projected: entries.length, message: '' };
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------
const api = {
  renderAssetText, buildAssetEntries, scaleOf, scaleText,
  projectionEntries, projectAssetWorldbook, isOwnEntry, readIsEmpty, pricedGateKey,
  // ★ I1（0.7.64）· 行情投影那一支：渲染口 + 那三个可核的常量（面板 / 测试 / 后续批次共用一份）。
  marketText, marketHeldBy, marketCloses, marketWindow, marketSymbolName,
  MARKET_NAME, MARKET_WINDOW_DAYS, MARKET_BIG_MOVE, MARKET_TREND_FLAT,
  // ★ 面板读"这一格关没关"的唯一入口（见 `isFieldHidden`）：面板**不许**自己拿
  //    `hiddenByCat` 算显隐，所以这个函数必须是**导出**的（不是本文件内部的小工具）。
  isFieldHidden,
  OVERVIEW_NAME, ACTOR_PREFIX, PROJECTION_RETRY_INTERVAL_MS, PROJECTION_MAX_RETRIES,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  rt.__LA_ASSET_PROJECT__ = api;
}

})();

  return module.exports;
})();
