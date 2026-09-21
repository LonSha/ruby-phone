/* ========================================================
 * asset-core.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-core.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-terms.js、./asset-keys.js、./asset-ledger.js
 * 【上游定位】asset-core.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-terms.js';
import __assetDep1 from './asset-keys.js';
import __assetDep2 from './asset-ledger.js';

const __REQ = {
    './asset-terms.js': () => __assetDep0,
    './asset-keys.js': () => __assetDep1,
    './asset-ledger.js': () => __assetDep2,
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
/* src/modules/asset/asset-core.js */
'use strict';

// ============================================================================
// 资产模块 · 统一实体模型的核心（纯函数，批次 B1 + B2；B3 加账务事务层）
// ----------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md` §3.11。这一节是全模块最底层的一节，本文件只放
// **不碰存储、不碰 DOM 的纯函数**：收一份数据 → 回一份新的，调用方那份一个字都不改。
// （B3 的测试会拿"输入逐字未变"来卡这条，所以这里的每个函数都不许原地改。）
//
// 四条纪律（照 §3.11 的三块表 + 决策 46/47）：
//
//   ① **三块必须分开**（§3.11.2）：`state` 只描述、**不进任何和**；`stock` 一次性进账；
//      `flows` 周期性进账。把 `state` 里看着像数的东西混进求和，正是这一节点名的错。
//   ② **`side` 三档**（§3.11.5）：asset / liability / none。`none` = 在册不计价 ——
//      既不许并进资产侧，也不许当成 0 静默吞掉；它要**单独计数**，否则面板上
//      "这个人算不算钱"这件事就消失了。分类给的是默认值，实例可以覆盖。
//   ③ **`kind` 三档、必填**（决策 46）：balance 动存量净值 / cashflow 现金收支 /
//      reserve 只在储备池里进出。**缺省 cashflow** —— 老数据没有这一列，
//      而"利息、供养、月租"这类绝大多数条目本来就是现金收支。不分档的话
//      "存量净值变了多少"与"净现金流是多少"两个数写不出来，总览上只剩一个含糊的数。
//   ④ **估不出来就明说**（§3.11 立场）：没有金额、金额算不出来、明说不计价的，
//      一律进"无法估值"的计数，**绝不还原成 0** —— 那是在编数字。**补出来的默认值
//      也不是价**：模板给一个新建字段补的 `0` 是"还不知道"，只有用户真写进去的 `0`
//      才是一个价。这笔账记在条目形状里（`defaultedFields`，跟着条目落盘），
//      用户真写值的那一刻由 `markSupplied` 摘掉。
//
// 计价与聚合是两件事：计价看字段上的 `sum: true`，聚合看 `agg`（决策 47）。
//
// 迁移（§3.11.10）走"惰性迁移（读旧写新）"：`migrateItem` 每次读都补默认值 + 挪异名，
// **幂等**（跑两次逐字相同，否则每次读取都会改数据）。**删字段不许毁数据**：
// 模板里没有的字段由 `normalizeItem` 点进 `orphanFields` 交出去（面板折进"已停用字段"），
// 不是删除、也不是静默丢。**归一化是白名单式的**，所以"新增一个键"这件事有它自己的纪律：
// 凡动作层 / 模板往物件上写下的那一格（`transfer` 第三档、`operations[]`、字段的 `upgrade`
// 与 `visibility`…），都必须同时进对应的保留清单，否则就是"读一遍丢数据"（本模块已踩过四次）。
//
// 显示词（五类的现代/古代/仙侠说法）只从 `asset-terms.js` 这一张词表取，id 是固定的
// ASCII 字面量；本文件里不出现任何面板结构词的字面量（`asset-terms.test.js` 会扫）。
// ============================================================================

// ---- 认词口：唯一取词口是 asset-terms.js（单一来源，别在本文件抄一份）----
// 真机上两个文件都在 bundle 里，且清单里 terms 排在 core 之前；这里仍然给一层回落，
// 好让本文件能在**没有词表**的环境（纯函数单测/裁剪产物）里独立跑。
function resolveTerms() {
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-terms.js');
  } catch (e) { /* 浏览器/裁剪产物里没有 require —— 落到下面 */ }
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_TERMS__) return rt.__LA_ASSET_TERMS__;
  }
  return null;
}
const TERMS = resolveTerms();

// ---- 键写入原语（`asset-keys.js`）：**排在资产块最前面**（本文件之前）----
// 取法与 terms / ledger 同一形状，但**这里用的就是那一份**（不再写第二份判断）：
// 用户可控字符串当键时走 `setKey`；要 null 原型的靶子**当场直接写 `Object.create(null)`**
//（G2AB 收口轮删掉了从前那个 null 原型 helper：全仓 0 个调用点、0 条针脚）。
// ⚠️ **不许在顶层抛**（几十个模块拼在同一个脚本里）：取不到时退成一份**形状完全相同**的
//    内联实现 —— 两条路写的是同一件事，取到之后不存在第二份判断（见 G2 第 2 轮报告 §4）。
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

// ---- 账本层（`asset-ledger.js`）：**排在 core 之前**，装的是"流量 / 求和 / 记账"那一摊 ----
// 取法与 terms 同一形状（Node require / 浏览器 `window.parent` 上的全局）。
// 本文件**要用**它：`normalizeItem` 的 flows 就走它的 `normalizeFlowList`；
// 三档常量与几个通用小工具也都在它那儿（它是下层，只留那一份 —— 两处各写一份迟早不一致）。
// ⚠️ 账本层取不到 = 这份 bundle 拼错了顺序（真机上不会：清单里它排在 core 之前，
//    `test/asset-panel.test.js` 的 A1b 契约测试还盯着"每个资产源文件都在清单里"）。
//    真遇上时**不许在顶层抛** —— 几十个模块拼在同一个脚本里，顶层一抛后面的一起死；
//    这里退成一份空层，这一摊在调用时才缺位。
function resolveLedger() {
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-ledger.js');
  } catch (e) { /* 浏览器/裁剪产物里没有 require —— 落到下面 */ }
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_LEDGER__) return rt.__LA_ASSET_LEDGER__;
  }
  return null;
}
const LEDGER = resolveLedger() || {};
// 借下来的这几样**在本文件里不再定义一遍**（口径只有账本层那一份）：
// 小工具 isObj / arr / str / num / flatten / cloneList，三档常量 KINDS / DEFAULT_KIND，
// 以及流量那一摊 normalizeFlow / normalizeFlowList / flowSigned / sumFlows / appendFlow。
const {
  KINDS, DEFAULT_KIND,
  isObj, arr, str, num, flatten, cloneList,
  normalizeFlow, normalizeFlowList, flowSigned, sumFlows, appendFlow,
} = LEDGER;

// 五类的稳定 id（§3.1 / 词表的五个 key）。**字面量，不是拿中文匹配出来的**：
// 换个档位只有显示词会变，这五个 id 永不变，存档里的 cat 才不会因为换档位而对不上。
const CATEGORY_IDS = ['liquid', 'estate', 'business', 'invest', 'debt'];

// side / agg / mode 的合法档位（认不出的档一律回落，绝不留一个系统不认识的档）。
// `kind` 三档（KINDS）在账本层 —— 字段与流量共用同一份。
const SIDES = ['asset', 'liability', 'none'];
const AGGS = ['sum', 'count', 'none'];
const MODES = ['instance', 'stock'];
const DEFAULT_SIDE = 'asset';
const DEFAULT_MODE = 'instance';
// DEFAULT_KIND 也在账本层（与 KINDS 同住），本文件开头已借下来。

// ---------------------------------------------------------------------------
// 小工具（全部不修改入参）
// ---------------------------------------------------------------------------
// 通用的那几个（isObj / arr / str / num / flatten / cloneList）在**账本层**
// （`asset-ledger.js`，本文件开头借下来了）：它是下层，只留那一份。
// 这里只剩本层自己用得到的三个。
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function strList(v) {
  const seen = Object.create(null);
  const out = [];
  for (const x of arr(v)) {
    const s = str(x);
    if (!s || seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

// 认不出的档位回落（与 asset-terms 的 normalizeEra 同一口径）
function normEnum(v, allow, fallback) { return allow.indexOf(str(v)) >= 0 ? str(v) : fallback; }

// ---------------------------------------------------------------------------
// 字段：口径（决策 47）与默认值
// ---------------------------------------------------------------------------
// **口径是口径，类型是类型，两件事各问各的**（§3.11.9）：系统只认识这三个词，
// 「只/条/头/匹」这类单位是自由字面，系统不判它、也不靠它算数。
function fieldAgg(field) {
  if (!isObj(field)) return 'none';
  return AGGS.indexOf(field.agg) >= 0 ? field.agg : 'none';
}

// **计价是另一件事，不是聚合**（本模块复盘抓出来的层级错误，两边都要点明）：
// `agg`（决策 47）说的是「这个 state 字段**怎么聚合**」—— 头数 `sum`、在册口数 `count`、
// 品阶 `none`；**计价**说的是「这个字段的值**就是这一条的价**」，是独立属性 `sum: true`。
// 拿 `agg === 'sum'` 当计价标记会出一件荒唐事：一类里声明了 `头数 (agg:'sum')` 之后，
// 条目就会**按头数定价**（3 头 = 3 两）。
// 只认字面量 `true`（与 `hidden` 同一口径），认不出的一律当成"没标"。
function fieldSum(field) {
  return isObj(field) && field.sum === true;
}

const DEFAULT_BY_TYPE = { text: '', number: 0, money: 0, percent: 0, bool: false };

// 新字段补什么默认值：用户写了 `def` 就听用户的（`def: 0` 也要认，不许当成"没给"），
// 否则按类型回落。**只对 state 字段用** —— 存量字段的值来自实例本身，不该被凭空填。
function fieldDefault(field) {
  const f = isObj(field) ? field : {};
  // 显式的 `def` 优先（`def: 0` / `def: ''` 都要认，不许被当成"没给"）；
  // 显式写成 `undefined` 等于没给 —— 补出来的默认值**必须是个真值**，
  // 否则它会被原样塞进 state，存盘时又被 JSON 丢掉（读了又变，幂等就破了）。
  if (has(f, 'def') && f.def !== undefined) return flatten(f.def);
  if (f.type === 'enum') return arr(f.options).length ? flatten(f.options[0]) : '';
  const byType = DEFAULT_BY_TYPE[f.type];
  return byType === undefined ? '' : byType;
}

function normalizeField(field) {
  const f = isObj(field) ? field : {};
  const key = str(f.key).trim();
  if (!key) return null;                       // 画不出来的行（没有字段名）直接丢
  const out = {
    key,
    type: str(f.type) || 'text',
    def: fieldDefault(f),                      // 一律显式给出来，消费方不必自己再推一次
    agg: fieldAgg(f),
    sum: fieldSum(f),                          // ★ 计价属性：与聚合口径分开（见 fieldSum 的注释）
    unit: str(f.unit),
    display: arr(f.display).map(str),
    hidden: f.hidden === true,
  };
  if (Array.isArray(f.options)) out.options = flatten(f.options);
  // ★ **`label`（§15.5:1344 / §3.11.9:473 的字段例子都带它）**：字段的**显示名** ——
  //   白名单式归一化的第三次同类缺陷（`transfer` → `operations` → `upgrade`+`label`）。
  //   这条不是"顺手多留一格"：**面板自己就在读 `f.label`**（`asset.script.js:737` 的
  //   「升哪一处」下拉、`:1007` 的吞吐行），而它拿到的模板是 `normalizeItem` 的产物 ⇒
  //   从前真机上 `label` 恒 `undefined`，用户给字段起的名字**永远看不到**，屏幕上只剩 `tier`
  //   这种 key（与"用户起的名字不换皮"直接冲突）。有才留，没有不留空壳键（同 `direction`）。
  if (f.label !== undefined) out.label = str(f.label);
  if (f.direction !== undefined) out.direction = str(f.direction);
  if (f.note !== undefined) out.note = str(f.note);
  if (f.kind !== undefined) out.kind = normEnum(f.kind, KINDS, DEFAULT_KIND);
  // ★ **`visibility`（§15.5 的字段上就有这一格）**：同上，从前它也不在保留清单里 ——
  //   同一类"读一遍丢数据"（与 C1 的 `transfer` 折成 `in`、C2 的 `operations` 丢档同一族）。
  //   系统**不理解**这一档的语义（那是给 AI 与显示层看的分寸：public / private 那一类），
  //   只负责**不弄丢**它。没有就别留空壳键。
  if (f.visibility !== undefined) out.visibility = str(f.visibility);
  // ★ **`upgrade`（§15.5 纵向升级轨）**：**照 `spec` 的写法当不透明数据收着** ——
  //   系统不理解它的语义（`cost` / `needs` / `effect` 全是给 AI 读的），只负责**不弄丢**它。
  //   这一格是本任务 §2.4 点名要修的那处缺陷：`normalizeField` 从前不保留它，
  //   而 `normalizeCategory` 只收 `normalizeField` 的产物 ⇒ **分类模板一过归一化，
  //   整条升级轨就没了**（§15.5 整节的形状都挂在这个键上）。
  //   `flatten` 逐层深拷：产物改动不会回头改到调用方那份模板（与 `options` 同一把尺子）。
  //   空对象（`upgrade: {}`）不留 —— 否则"有没有升级轨"在数据上分不出来（见 `upgradableOf`）。
  if (isObj(f.upgrade)) {
    const up = flatten(f.upgrade);
    if (Object.keys(up).length) out.upgrade = up;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 分类模板（§3.11.3 的形状 + §3.11.4 的模式 + §3.11.5 的归属默认值）
// ---------------------------------------------------------------------------
function normalizeCategory(raw) {
  const c = isObj(raw) ? raw : {};
  const id = str(c.id).trim();
  const fields = [];
  // ⚠️ **必须是 `Object.create(null)`**（本文件 `:104` / `:359` 同一个写法）：`seen` 的键是
  //    用户填的**字段 key**，取 `{}` 时 `seen['toString']` 会命中原型上那个函数（恒真）⇒
  //    **假去重 ⇒ 字段静默丢失**（实测：`fields:[{key:'toString'}]` 归一化后字段数 **0**）。
  const seen = Object.create(null);
  for (const f of arr(c.fields)) {
    const nf = normalizeField(f);
    if (!nf || seen[nf.key]) continue;         // 同名字段只留第一条（重名会让面板画两行）
    seen[nf.key] = true;
    fields.push(nf);
  }
  const version = Number(c.schemaVersion);
  return {
    id,
    name: str(c.name) || id,                   // 用户起的名字不换皮；没起名就拿 id 顶着
    kind: normEnum(c.kind, SIDES, DEFAULT_SIDE),
    side: normEnum(c.side, SIDES, DEFAULT_SIDE),   // 分类只给**默认值**，实例可覆盖
    mode: normEnum(c.mode, MODES, DEFAULT_MODE),
    fields,
    spec: str(c.spec),                         // 给 AI 读的规格文本；系统不理解里面的词
    actions: arr(c.actions).map(str).filter(Boolean),
    schemaVersion: Number.isFinite(version) && version >= 1 ? Math.floor(version) : 1,
    // 旧名 → 新名的映射表（§3.11.10 的"异名按旧名映射"）。有就给，没有不留空壳。
    ...(isObj(c.renames) ? { renames: flatten(c.renames) } : {}),
  };
}

// 内置五类：id / 形状固定，**显示词只从词表取**（换档位只换显示词，不换 id）。
// 字段清单照 `docs/预览-资产模块.html` 屏⑧⑨ 的夹具：每类**恰好一个标了计价的金额字段**
// （`sum: true`，那就是这一条的存量值）、一个只数不聚合的字段（`agg:'count'`）、若干描述字段。
// ⚠️ 计价字段**不**声明 `agg`：聚合与计价是两件事，一个字段同时声明会在"按成员聚一聚"时撞名。
// 单位随档位由显示层决定，这里只给一个字面。
function builtinFields() {
  // 只计数、不聚合的字段（决策 47 的 count 档）
  const count = (key) => ({ key, type: 'number', def: 1, agg: 'count' });
  const text = (key) => ({ key, type: 'text', def: '' });
  // ★ 计价字段：模板里标了计价的那一个 —— `stock.worth` 的唯一来源
  const priced = (key) => ({ key, type: 'money', def: 0, unit: '两', sum: true });
  return {
    liquid: [
      text('户名'),
      priced('存银'),
      text('往来'),
      count('户数'),
      { key: '保管', type: 'enum', def: '自持', options: ['自持', '寄放'], agg: 'none' },
    ],
    estate: [
      text('名目'),
      priced('估值'),
      text('处置'),
      count('间数'),
      { key: '契据', type: 'enum', def: '在', options: ['在', '押', '失'], agg: 'none' },
      { key: '来路', type: 'text', def: '' },
    ],
    business: [
      text('铺号'),
      priced('估值'),
      text('经营'),
      count('人数'),
      { key: '份数', type: 'number', def: 1, agg: 'none' },
      { key: '分成', type: 'percent', def: 0, agg: 'none' },
    ],
    invest: [
      text('名目'),
      priced('本息'),
      count('份数'),
      { key: '本钱', type: 'money', def: 0, unit: '两', agg: 'none' },
      { key: '时价', type: 'money', def: 0, unit: '两', agg: 'none' },
      { key: '到期', type: 'text', def: '' },
    ],
    debt: [
      text('债主'),
      priced('余欠'),
      count('债主数'),
      { key: '期数', type: 'number', def: 0, agg: 'none' },
      { key: '每期', type: 'money', def: 0, unit: '两', agg: 'none' },
      { key: '到期', type: 'text', def: '' },
    ],
  };
}

// 内置五类的默认归属 / 模式 / 动作 / 规格（规格是给 AI 读的自由文本，第一版先留空骨架）
const BUILTIN_META = {
  liquid: { side: 'asset', mode: 'instance', actions: ['deposit', 'withdraw'] },
  estate: { side: 'asset', mode: 'instance', actions: ['buy', 'sell', 'lease'] },
  business: { side: 'asset', mode: 'instance', actions: ['buy', 'sell', 'invest'] },
  invest: { side: 'asset', mode: 'instance', actions: ['buy', 'sell'] },
  debt: { side: 'liability', mode: 'instance', actions: ['borrow', 'repay'] },
};

function buildBuiltinCategories() {
  const fields = builtinFields();
  return CATEGORY_IDS.map(id => {
    const meta = BUILTIN_META[id];
    const cat = normalizeCategory({
      id,
      name: categoryDisplayName(id),
      kind: meta.side,
      side: meta.side,
      mode: meta.mode,
      fields: fields[id],
      spec: '',
      actions: meta.actions,
      schemaVersion: 1,
    });
    // 内置类才有的一格：显示词随档位取（换档位只换这一个词，id / 字段 / 归属都不动）。
    // 用户自建分类没有这一格 —— 它的名字是用户自己起的，不换皮。
    cat.displayName = categoryDisplayName(id);
    return cat;
  });
}

// 内置分类的显示词：**只从词表取**（三档各一份），取不到就回落 id —— 绝不自己编一个词，
// 也绝不拿中文去反推 id（id 是字面量，词是显示层的事）。
function categoryDisplayName(id, era) {
  const key = str(id).trim();
  const words = TERMS && typeof TERMS.categoryWords === 'function' ? TERMS.categoryWords(era) : null;
  if (words && typeof words[key] === 'string' && words[key]) return words[key];
  return key;
}

// 每次取都是**新的对象**：调用方拿它去渲染、去改，改不到这份常量，也清不空这个数组。
function builtinCategories() {
  return cloneList(buildBuiltinCategories());
}

// ---------------------------------------------------------------------------
// 实例归一化：三块分开（§3.11.2）
// ---------------------------------------------------------------------------
// 迁移（§3.11.10）：补默认值 + 挪异名，**只碰 state**。
//   · 幂等：跑两次逐字相同 —— 所以这里既不删字段也不搬走模板外的字段；
//   · 模板外的字段由 `normalizeItem` 点进孤儿袋（那一步也幂等，孤儿袋每次都重算）。
// 参数 `opts.renames` 是「旧名 → 新名」；模板自带 `renames` 时以 opts 为准。
//
// ★ **补出来的默认值与用户填的值是两件事**（本轮整改的 Critical）：`def: 0` 补进 state 的
// 那个 0 是"还不知道"，不是"值 0"。所以迁移要认得出**哪几个 key 是它自己补的**传递给
// `itemWorth` —— 否则下游只看 state 上有个 0，就会把"估不出来"当成一个价报出去，正是
// 设计里点名的「不可估值就明说，不编数字」要防的那件事。
//
// ★★ 第二轮：这笔账要**记在条目形状上、跟着它落盘**（`defaultedFields`）。上一轮把判据挂在
// 一趟调用内的非枚举口令上，本进程内两个方向都对，但**走不出存盘**：一份刚建的条目
// `JSON.stringify` 之后那个口令就没了（`asset-store.js` 的 `normalizeLedger` 是原样透传，
// `readLedger()` 交回来的条目上 `state` 里躺着迁移补的 0、却没有任何标记），重读一遍
// 那个 0 就与用户手写的 0 分不开了 —— "估不出来"被翻成一个价。
// **条目级的逃生口是 `orphanFields` 已经证明走得通的那一条**（存储那层保留整个条目对象），
// 所以这里走同一形状：一个可枚举的数组，是**引擎元数据、不是用户字段**（面板不画它）。
// ⚠️ 只记"补出来的"这件事，**不记值**：值永远只看 `state`。用户真写进去一个 0 时由调用方
// 用 `markSupplied` 把这个 key 摘掉，那一刻起它才是一个价。
// **"没有这笔账"与"这笔账是空的"是两件事**，判据就是这一格在不在：
//   · 有条目形状里这一格（哪怕是 `[]`）→ 这份东西过了归一化那条流水线，`state` 上的键
//     只要不在账上，就是**用户/存档真给过的**（所以这是个价）；
//   · **完全没有这一格**（老存档 / 手写夹具 / 从没走过流水线的裸条目）→ 它没机会交代
//     `state` 上的值是哪来的，"迁移补的 0"与"用户写的 0"分不开 → **算不出来**
//     （不可估值就明说，绝不赌它是一个价）。已落账的值走 `stock.worth`，不受影响。
// 所以 `markSupplied` 摘标记**不是删掉这一格**，而是把它清成 `[]`（"过了流水线，
// 一个 key 都不是补的"）—— 删掉反而会让用户刚填的 0 退回"分不开"。
function defaultedKeysOf(item) {
  const it = isObj(item) ? item : {};
  const out = [];
  const seen = Object.create(null);
  for (const v of [it.defaultedFields, it.injectedDefaults]) {   // 旧的非枚举集合也认（同趟调用里可能还挂着）
    for (const s of strList(v)) {
      if (seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
  }
  return out;
}
function hasDefaultedMarker(item) {
  const it = isObj(item) ? item : {};
  return has(it, 'defaultedFields') || it.injectedDefaults instanceof Set;
}

function migrateItemWithInjected(raw, template, opts) {
  const item = isObj(raw) ? flatten(raw) : {};
  const tpl = isObj(template) ? template : {};
  const o = isObj(opts) ? opts : {};
  const fields = arr(tpl.fields).filter(isObj);
  const renames = isObj(o.renames) ? o.renames : (isObj(tpl.renames) ? tpl.renames : {});

  const state = isObj(item.state) ? item.state : {};
  // 哪些 key 是**用户/存档真给过的**：静默补进去的默认值不算。
  // ⚠️ 只看"这个键在不在 state 上"是不够的：**上一趟补出来的键也在 state 上**，
  //    所以还要把条目带来的 `defaultedFields` 那笔账先认下来（下面 merge 进 injected）。
  const supplied = new Set(Object.keys(state));

  // ① 挪异名（先把 key 列出来再动，免得边遍历边改）
  for (const oldKey of Object.keys(renames)) {
    if (!has(state, oldKey)) continue;
    const newKey = str(renames[oldKey]);
    if (!newKey || newKey === oldKey) continue;
    // ★ 新名可以是**任意 JSON 键**（`renames` 是调用方给的映射）⇒ 走共享原语：
    //   裸赋值在 `__proto__` 上是改原型（老键照样被下面那句 `delete` 删掉 ⇒ 值静默丢一格）。
    //   ⚠️ 这里**不用 `Object.create(null)`**：`state` 是产物的一部分、要与手写普通对象字面量
    //   `deepStrictEqual` 对拍（与 `createEntry` 那处同一条依据）。
    if (!has(state, newKey)) setKey(state, newKey, state[oldKey]);   // 新名已经有值就不覆盖（已迁移过）
    supplied.add(newKey);                       // 老存档里真有这个值，只是名字旧
    delete state[oldKey];
  }

  // ② 补默认值（已有的值一个都不覆盖）
  // ★ 起点是**条目自己带来的标记**（剩下的键不许翻案），再并上这一趟补出来的：
  //   摘标记只有一个出口 —— `markSupplied`（用户真写进去值的那一刻）。
  const injected = new Set(defaultedKeysOf(item));
  for (const f of fields) {
    const key = str(f.key).trim();
    if (!key || has(state, key)) continue;
    // ★ 字段 key 是**用户可写的**（模板里那一格）⇒ 走共享原语：裸赋值在 `__proto__` 上
    //   是改原型而不是加一格 —— `def` 是字符串时那一格**静默不进 state**，`def` 是对象时
    //   **产物的原型被改写**。⚠️ 同样不用 `Object.create(null)`（这一格是产物的一部分）。
    setKey(state, key, fieldDefault(f));
    if (!supplied.has(key)) injected.add(key);  // ★ 记下"这个 key 是我补的"
  }

  item.state = state;
  if (!isObj(item.stock)) item.stock = {};
  if (!Array.isArray(item.flows)) item.flows = [];
  if (!Array.isArray(item.relations)) item.relations = [];
  // ★ 这一格**只在本条本来就有、或这一趟真补了东西时**才写上（见 `defaultedKeysOf`）：
  //   从没走过流水线的裸条目保持"没有这笔账"的形状 —— 那一格本身就是"过没过流水线"的判据。
  if (hasDefaultedMarker(item) || injected.size) item.defaultedFields = Array.from(injected);
  return { item, injected: injected };
}

function migrateItem(raw, template, opts) {
  // 两个入口给的是**同一个对象**（`migrateItemWithInjected` 已经把标记写进去了），
  // 所以内部那条 `m.injected` 与条目上的那一格永远说的是同一件事。
  return migrateItemWithInjected(raw, template, opts).item;
}

// "我把哪几个 key 补成了默认值"读回来（**唯一读口**：`itemWorth` 从这里拿）。
// 返回 `null` 表示**这一格整个不在**（从没走过流水线的裸条目）→ 见 `defaultedKeysOf` 的注释。
function injectedOf(item) {
  if (!isObj(item) || !hasDefaultedMarker(item)) return null;
  return new Set(defaultedKeysOf(item));
}

// ★ **逃生口**：用户真往这个 key 里写了一个值（包括 0），调用方在保存前叫一声，
// 从此它就是一个价 —— 不叫的话，"迁移补的 0"与"用户写的 0"永远分不开（同一个 0）。
// 那条铁律是"**不可估值就明说，不编数字**"，不是"永远不许给 0"：用户明说值 0 时必须按 0 计价。
// ⚠️ 摘标记是把它清出这一格，**不是删掉这一格**：这一格在 = "过了流水线、这笔账算得清"，
//    删掉它会让用户刚填的 0 退回"分不开"（见 `defaultedKeysOf`）。
// ⚠️ **原地改**：收的就是那份要存下去的条目（面板的行内编辑路径：读到 → 改 → 存）。
//    要让一条**已落盘**的旧条目从此有个价，那一趟编辑必须先把 `state` 上的值写上、
//    再叫这一声再存 —— 只写值不摘标记，重读时它还是"补出来的"。
function markSupplied(item, key) {
  const it = isObj(item) ? item : null;
  if (!it) return item;                         // 空条目原样回（别炸，也别造一个）
  const k = str(key);
  if (!k) return it;
  // 自己持有一份新数组（别摘到别人的数组上——`deepEqual` 之外还有共享引用的坑）
  it.defaultedFields = defaultedKeysOf(it).filter(x => x !== k);
  // 旧的非枚举口令（如果这趟里还挂着）跟着一起摘，免得两个读口说法不一致
  if (it.injectedDefaults instanceof Set) it.injectedDefaults.delete(k);
  return it;
}

// 一条流量的归一化与符号（`normalizeFlow` / `normalizeFlowList` / `flowKind` / `flowSigned`）
// 在**账本层**（`asset-ledger.js`）：本文件开头就把它借下来了，`normalizeItem` 用它归一化 flows。
// 这里不重写第二份口径 —— 金额认什么、方向与 kind 缺省是什么，只有那一处说了算。

// 存量：这条值多少（求和只认它）。
// 顺序就是"谁说的算"：① **实例的 stock.worth 优先** —— 它是已经落到账上的那个数
// （面板手填 / 行情结算 / 提取入库都写这里），也是唯一被求和消费的数；
// ② 实例没有存量值时，才看模板声明的**计价字段**（`sum: true`）在 state 上的值
// （面板的行内编辑先落在 state，还没回写 stock 的那一刻）。
// 两条都没有、或者值算不出来 → **NaN = 估不出来**。这里绝不给 0 ——
// 0 与"估不出来"是两件事，混了就是在编数字（求和那一步会把 NaN 归进无法估值）。
// ⚠️ 顺序反过来就出过事：迁移会给新建的金额字段补默认值 0，若 state 优先，
//    一个老存档里 stock.worth=300、state 上刚补出来的 0 就会把 300 盖成 0 ——
//    **补默认值不许悄悄改掉已有的钱**。
// ⚠️ 第二个坑（本轮整改的 Critical）：补出来的默认值本身**不是**一个价。`injected` 是
//    "这几个 key 是补出来的"那笔账（第二轮的形态：条目上可枚举的 `defaultedFields`，
//    跟着条目落盘）；补出来的 0 走"估不出来"，用户手写的 0 才按 0 计价。
//    摘这笔账只有一个出口：`markSupplied`。
// ⚠️ 第三件事（第二轮补的）：**这笔账整个不在**的条目（`injected === null`：从没走过
//    归一化那条流水线的裸条目）不许走 ② 这条路 —— 它 `state` 上的值是迁移补的还是用户
//    写的，从这个形状上**分不开**，赌它是价就是在编数字。已落账的值仍在 ①（`stock.worth`）。
//    要走 ② 只有两种情形：这一趟就是归一化（那一步的目的正是把 state 定成 stock，见
//    `normalizeItem`），或者条目身上就是有这笔账（`defaultedFields`，落盘也认得）。
function itemWorth(item, template, injected) {
  const it = isObj(item) ? item : {};
  const state = isObj(it.state) ? it.state : {};
  const fields = arr(isObj(template) && template.fields);
  const own = isObj(it.stock) ? it.stock : {};
  // ① 已经落账的存量值
  if (has(own, 'worth') && Number.isFinite(num(own.worth))) return { worth: num(own.worth), key: 'worth' };
  if (has(own, 'amount') && Number.isFinite(num(own.amount))) return { worth: num(own.amount), key: 'amount' };
  // ② 模板声明的**计价**字段（面板行内编辑的那一格）
  const pricedField = injected === null ? null : fields.filter(isObj).find(f => {
    const key = str(f.key).trim();
    return fieldSum(f) && key && has(state, key);
  });
  if (pricedField) {
    const key = str(pricedField.key).trim();
    // ★ 补出来的默认值不是价：模板有这个字段 ≠ 用户给过这个值
    if (injected.has(key)) return { worth: NaN, key };
    const n = num(state[key]);
    return { worth: Number.isFinite(n) ? n : NaN, key };
  }
  // ③ 存量字段在，但值本身算不出来（脏值）→ 估不出来
  if (has(own, 'worth')) return { worth: num(own.worth), key: 'worth' };
  return { worth: NaN, key: 'worth' };
}

// 持仓格的**形状口**（唯一一处；批次 G3）。
// ---------------------------------------------------------------------------
// 规格：§3.8（持仓市值 = 数量 × 现价 **==** 持仓条目声明的市值）、§3.11.5（金额三种口径，
// 其中 `book` = 买入成本）、§8.2（行情停用后持仓**保留**、显示最后已知价）。
//
// 为什么它是条目上的一个**顶层键**（而不是塞进 `state`）：`state` 在本模块是**描述性字段**
// （面板逐格印给人看），**从不参与求和**；数量与成本要参与算术。而且塞进 `state` 会被下面
// 那条"模板外字段 ⇒ `orphanFields`"的路当成孤儿字段吃掉 —— 下一次归一化就从活字段变成留档值。
//
// ⚠️ **归一化白名单是这一格最容易死的地方**：`normalizeItem` 的产物 `out` 是**逐个键枚举**
//    拼出来的，不认识的顶层键直接丢；而 `orphanFields` **只兜 `state` 里的键、兜不住顶层键**。
//    ⇒ 加了 `holding` 却不进 `out`，就是"当场有效、读一遍就失效"（本模块栽过四次的那个类）。
//
// 三条尺子（缺一条即不通过）：
//   ① **认不出标的的整格丢掉**：`symbol` 是这一格的身份（标的代码 = 稳定 key，§3.12④）⇒
//      只认"非空字符串"，**不拿 `str()` 去把 0 / false / 123 拼成一个看着像代码的东西**
//      （与 `createEntryId` 同一把尺子：身份类字段不编）。没有标的的持仓算不出任何东西。
//   ② `qty` / `cost` 只认「**有限数且 >= 0**」，认不出的**丢掉那一格**（不是整格）。
//      数认什么由账本层的 `num` 说了算 —— 本函数**不写第二份数值口径**（`'100'` 这种
//      JSON 里存成字符串的数照旧认，与 flow 的 `amount` 是同一把尺子）。
//   ③ **深拷贝**：照 `relations` / `operations` 的 `cloneList` 口径（它逐项走 `flatten`，
//      注释见 `normalizeItem` 里 `relations` 那一句），别把调用方的对象引用直接挂进去。
//      ⚠️ **这一条的性质由上游提供，不由本函数提供**（G3 复审 §3.4① 实测）：`normalizeItem`
//      的入口 `migrateItemWithInjected` 第一行就是 `flatten(raw)`（本文件 `:401`），
//      `raw.holding` 到这里时**已经是一份深拷**（实测：产物 `holding` 与调用方那一份
//      `notEqual`，改产物嵌套格不污染夹具）。⇒ 下面 `flatten(raw[key])` 是**第二道保险**，
//      当前**不可观测**（去掉它全绿，实测）。**保留它的理由**：本函数是导出白名单的一环、
//      可以被别处单独调用（`cloneList` 那族口径也这么写），且"不共用引用"是一条真契约 ——
//      删掉它就把这条契约从代码里删掉，只留在注释里。**归属写在这里，别让读者以为深拷是本函数给的。**
//   ④ 认得出的格之外的键**原样带上**（同 `stock` 的透传口径）：别处往这一格里加的格子，
//      不该在归一化这一步被吃掉（吃掉 = 又一次"读一遍丢数据"）。
//   ⑤ **`overdrawn`（负债 / 透支）判定格**（G3 修复轮 · 复审 Important-3 / G3-D2）：
//      `§3.9 :260` 要求「条目变负数：**允许**，但面板与投影都**必须显式标**「负债 / 透支」」。
//      ⚠️ **本函数只负责"不把这一格吃掉"，不负责判它** —— 判据要同时看 `stock.worth` 与
//         `holding.qty`（跨两个格），本函数只看 `holding` 这一格，判不了。
//         唯一写者是 `asset-holdings.js` 的 `markOverdrawn`（三条写路：买 / 卖 / 重估）。
//      ⚠️ **只认字面量 `true`**（与 `ownerLost` / `hidden` / `sum` 同一把尺子）：认不出的一律当
//         没标 —— "透支"是一个**已经发生的判定**，不许由存档里一个真值字符串凭空立起来。
//      ⚠️ 没有这一格时**连键都不写**（照 `ownerLost` 的条件铺开：`undefined` 是一个自有键，
//         会让"读一遍再读一遍逐字相同"与"入参逐字不变"当场红）。
function normalizeHoldingCell(raw) {
  if (!isObj(raw)) return null;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim() : '';
  if (!symbol) return null;                       // ① 没有标的 ⇒ 整格丢掉
  const out = { symbol };
  for (const key of Object.keys(raw)) {
    // 这四格在下面按各自的尺子认（`overdrawn` 照 ⑤）
    if (key === 'symbol' || key === 'qty' || key === 'cost' || key === 'overdrawn') continue;
    setKey(out, key, flatten(raw[key]));          // ④ 其余键原样带上（深拷贝）
  }
  for (const key of ['qty', 'cost']) {            // ② 认不出的**丢掉那一格**（不是整格）
    const n = num(raw[key]);
    if (Number.isFinite(n) && n >= 0) setKey(out, key, n);
  }
  // ⑤ 只认字面量 `true`；其余（含 `false` / `'true'` / `1`）一律**当没标** ⇒ 不写键
  if (raw.overdrawn === true) setKey(out, 'overdrawn', true);
  return out;
}

// 实例归一化：保 id / cat / 显示名 / 归属人 / 容器与关系；state 补默认值、模板外的点进孤儿袋；
// stock 从模板声明的金额字段取值；flows 逐条归一化 kind 与符号。
// ⚠️ **孤儿字段只读**（§3.11.10 铁律）：删字段不许毁数据，但也不许再当成活字段去求和。
//
// 两个**跟着实例走的归属口径**要原样带出来（§3.11.5 的"可下沉到实例"），否则归一化一次
// 就把它抹掉了 —— 那会让"读两次结果相同"不成立（面板每读一次都在改数据，正是要防的事）：
//   · `side`：这一条的归属（asset / liability / none）。认不出的档**不带出来**（宁可回落分类默认）。
//   · `template`：这一条挂的分类模板引用。带上它，`sumNetWorth(账本条目)` 就能直接算，
//     不必调用方在旁边再配一份模板 —— 否则每个消费方都要自己拼，必漏。
function normalizeItem(raw, template, opts) {
  const o = isObj(opts) ? opts : {};
  // ★ 一律走**归一化后的**模板：字段的 `def` / `agg` / `sum` / 单位都在那一步补齐，消费方
  // 手里那份 raw 模板可能一个属性都没写。归一化对已归一化的模板是幂等的。
  const tpl = normalizeCategory(isObj(template) ? template : {});
  const migrated = migrateItemWithInjected(raw, tpl, o);
  const base = migrated.item;
  const fields = tpl.fields;
  // 孤儿袋：先把调用方交进来的那份当底（面板恢复"已停用字段"时要把值带回来），
  // 再用本条 state 上的模板外字段覆盖 —— 活的值得压过留档的旧值。
  // 归一化的产物里，孤儿**只活在这个袋子里**（state 上不再留），所以合并而不是丢掉。
  const orphanFields = isObj(o.orphanFields) ? flatten(o.orphanFields) : {};
  for (const [key, value] of Object.entries(isObj(base.state) ? base.state : {})) {
    if (fields.some(f => str(f.key).trim() === key)) continue;
    // ⚠️ **走 `setKey`，不许裸赋值**：`key` 是**用户可控**的（模板里曾有 `__proto__` 字段、
    //    用户填了值、之后把该字段从模板里删掉 ⇒ 那一格就落到这里）。裸赋值在 `__proto__` 上
    //    不是加一格而是**改写原型**：own keys 当场少一格、值静默落到原型上
    //    （实测 `createEntry({state: JSON.parse('{"__proto__":"用户打的值"}'), template:{fields:[]}})`
    //    ⇒ `orphanFields` own keys `["普通"]`、proto `{"evil":1}` —— 丢的正是**"不丢字段"的那个兜底袋**）。
    setKey(orphanFields, key, value);
    if (typeof o.onOrphan === 'function') o.onOrphan(key, flatten(value));
  }

  const rawStock = isObj(base.stock) ? base.stock : {};
  // ★ 第三个参数传**恒非 null 的 Set**：这一趟就是归一化那条流水线，它的活正是把 state 上
  // 用户填过的计价字段定成 `stock.worth`（`injectedOf(null)` 那条"分不开就不算价"的守卫
  // 只管**已经落盘的裸条目**，不管这一趟 —— 见 `itemWorth` 的注释）。
  const worth = itemWorth(base, tpl, new Set(migrated.injected));
  const stock = {};
  // ⚠️ **走 `setKey`，不许裸赋值**：`rawStock` 是**存档里的任意 JSON 键**（`stock` 整袋透传），
  //    键可以是 `__proto__`。裸赋值在 `__proto__` 上是**改写原型**：实测
  //    `normalizeItem({stock: JSON.parse('{"__proto__":{"evil":2},"worth":100,"unit":"两"}')})`
  //    ⇒ own keys `["unit","worth"]`（少一格）、proto `{"evil":2}` —— 读一遍再写一遍，
  //    那一格与它的值一起永久丢。与同函数上面的 `orphanFields` 同一把尺子。
  for (const key of Object.keys(rawStock)) if (key !== 'worth') setKey(stock, key, rawStock[key]);
  // 估不出来就**不写 worth**（NaN 也必须显式写出来，JSON 存不下它 —— 存下去会变成 null，
  // 下次读回来就成了"有值但值为 null"，反而更糊涂）。求和那一步据此归进无法估值。
  if (Number.isFinite(worth.worth)) stock.worth = worth.worth;
  if (stock.unit === undefined) {
    const unitField = fields.filter(isObj).find(f => fieldSum(f) && str(f.unit));
    if (unitField) stock.unit = str(unitField.unit);
  }

  // 持仓格：认不出的**整个丢掉**（`null` ⇒ 下面条件铺开时连键都不写）。尺子全在
  // `normalizeHoldingCell` 那一处，本处只负责"要不要铺这一格"。
  const holdingCell = normalizeHoldingCell(base.holding);

  const out = {
    id: str(base.id),
    cat: str(base.cat),
    label: str(base.label),
    ownerKey: str(base.ownerKey),
    state: isObj(base.state) ? base.state : {},
    stock,
    flows: normalizeFlowList(base.flows),
    // ★ 容器与继承（§3.11.2 的实体形状、§3.11.6 的容器原语）：读一遍再写一遍不许把它们
    // 丢掉 —— `state` 有 orphanFields 兜底，这两格原先**没有**任何兜底，往返即毁数据。
    members: arr(base.members).map(str),
    extends: arr(base.extends).map(str),
    // ⚠️ `cloneList` 看着像浅拷贝，其实**是深拷贝**：账本层 `cloneList(v, perItem)` 的缺省
    //    逐项就是 `flatten`（逐层新建对象与数组，只认 JSON 那几样）。所以 C4 往 `relations`
    //    里写对象时**不必**再自己拷一层；要留意的只有反面：`flatten` 认不出的东西
    //    （Set / Map / undefined / 函数）会被它按"值"原样带过去，别往里塞这些。
    relations: cloneList(base.relations),
    // ★ **动作层（§15.2）写在实例上的那一格**（`operations[]`：这处资产挂着哪门经营）。
    //   与 members / extends / relations 同一族：都是"别的批次/调用方往条目上挂的东西"，
    //   归一化读一遍再写一遍**不许把它丢掉**。少了它，"挂经营 / 摘经营 / 换模式"写下的
    //   那一格一过归一化就没了 —— 那是"读一遍丢数据"，与 `transfer` 被折成 `in` 同一类缺陷
    //   （产物与账本不一致：谁把产物写回账本，谁才永久丢掉这一格）。
    //   深拷贝同样由 `cloneList` 的缺省给到（见上面 `relations` 那一句），挂不到调用方的数组上。
    operations: cloneList(base.operations),
    // ★ **持仓格**（批次 G3 · §3.8 三方对账 / §3.11.5 的 `book` 口径 / §8.2 停用后降级）：
    //   `{ symbol, qty, cost }` —— 数量与成本是**账**（只有三个合法写者），现价是**市场**
    //   （裁判能动）；市值不在这里，仍落既有的 `stock.worth`（那就是 §3.8 说的
    //   "持仓条目声明的市值"），由行情结算重算。
    //   与 `members` / `extends` / `relations` / `operations` **同一族**：都是"别的批次/调用方
    //   往条目上挂的东西"，归一化读一遍再写一遍**不许把它丢掉** —— 唯一写者是持仓那一层
    //   （`asset-holdings.js` 的买入/卖出），**不是 `createEntry`**（见它的函数头第三条）。
    //   ⚠️ **没有这一格时连键都不写**（`undefined` 是一个自有键：与"没有它的条目"
    //      `deepStrictEqual` **不相等**）⇒ 走条件铺开，不走 `x ? x : undefined`（同下面 `ownerLost`）。
    //   ⚠️ 这一格**里面还有一枚引擎判定格** `overdrawn`（负债 / 透支，G3 修复轮 · §3.9 `:260`）：
    //      尺子与"要不要铺这一格"全在 `normalizeHoldingCell` 那一处，本处不重复判一次。
    ...(holdingCell ? { holding: holdingCell } : {}),
    // ★ **归属自检写下的那一格**（任务 C4，§15.8①）：`ownerKey` 指向的角色**已经不在角色表里**，
    //   而且连"上一个真实存在的主"都找不回来（`auditOwnership` 回 `fixed:'lost'`）时，
    //   这一格被置真，面板据此在那一行印「归属已失」（三档词，见 `asset-terms.js`）。
    //   与 members / extends / relations / operations **同一族**：都是"动作层往条目上挂的东西"，
    //   归一化读一遍再写一遍**不许把它丢掉** —— 少了它，自检修过一次，下一次读取就又变回
    //   "只是指向了一个不认识的人"，面板上那一句"归属已失"再也不会出现（读数丢档）。
    //   ⚠️ **只认字面量 `true`**（与 `hidden` / `sum` 同一把尺子）：认不出的一律当没标 ——
    //      "归属已失"是一个**已经发生的判定**，不许由存档里的一个真值字符串凭空立起来。
    //   ⚠️ 没有这一格时值就是 `undefined`（与 `operations` / `relations` 的"空数组"不同：
    //      那两格有**形状**要固定，这一格是一个**判定结果**，没有形状可言）。写 `false` 会出
    //      一件麻烦事：`auditOwnership` 摘掉这一格（`delete`）之后那份与"归一化产物里的 false"
    //      就再也 deepEqual 不相等，"读一遍再读一遍逐字相同"当场不成立。
    //   ⚠️ 没有这一格时**连键都不写**（`undefined` 是一个自有键：与 `{}` 不 deepEqual，
    //      "纯函数：入参逐字不变"那条针脚会立刻红）。所以走条件铺开，不走 `x ? x : undefined`。
    ...(base.ownerLost === true ? { ownerLost: true } : {}),
    orphanFields,
    // ★ 引擎元数据（**不是用户字段**，面板不画它）：哪几个 state 键是**补出来的默认值**。
    // 与 `orphanFields` 同一个道理住在条目形状里 —— 存储那层原样透传条目对象，所以它能
    // 落盘、能被 `readLedger()` 带回来。少了这一格，"补出来的 0"落盘重读就变成一个价。
    // ★ 归一化的产物**一定写上这一格**（哪怕 `[]`）：它就是"这份东西过没过流水线"的判据
    //   （见 `defaultedKeysOf`）—— 缺了它，一条老存档的 `state` 就无从归属。
    // ⚠️ 这一格是**引擎保留名**（与 `orphanFields` 同级）：它不在 `state` 里、面板也不许往里写。
    defaultedFields: Array.from(migrated.injected),
  };
  // 实例自己声明的归属：认得出的档才带出来（认不出的留给分类默认值去兜，别在这儿编）
  const ownSide = normEnum(base.side, SIDES, '');
  if (ownSide) out.side = ownSide;
  // 挂着的分类模板引用：带上**归一化后的**那一份，求和就能直接吃账本条目。
  // ⚠️ 条目内嵌模板只是**权宜**：`asset-store.js` 的 `normalizeLedger` 是白名单，账本级的
  //    "分类注册表"会被它丢掉，所以模板暂时只能跟着条目走。真实来源仍是分类注册表 ——
  //    等存储那层放宽之后，这里应当只留 `cat` 引用（`entryTemplate` 已经写成"活的优先、
  //    内嵌的垫底"，正是为那一天留的缝）。**本批不动 `asset-store.js`。**
  if (isObj(template)) out.template = tpl;
  return out;
}

// ---------------------------------------------------------------------------
// 新建一条资产（批次 F6 · §7.4 #6 的"新增"那一个显式动作）
// ---------------------------------------------------------------------------
// §7.4 #6 只给了一句：「**新增一条资产 vs 修改已有余额，必须是两个显式动作**」——
// 也就是说这一路**必须有一次用户显式点的"建"**，不许由"记一笔"顺带把条目变出来。
// 这两格就是那一次"建"在 core 这一层的样子。**它们不是"建条目"的全部**：
//   · **id 由调用方（面板）生成**，这里只做形状；
//   · **state 由调用方按模板逐格收集**，这里只归位。
//
// ⚠️ 为什么 id 生成**不在这里**（这是本节最要紧的一条，别顺手搬进来）：
//   ① **core 是不读时钟的纯函数层** —— `normalizeItem` 一次 `Date` 都不碰（有针脚钉着）。
//      `Date.now()` 一进来，core 的"同一个入参永远同一个产物"当场不成立（同一份账本
//      在两台机器上会数出不同的 id）；本仓的 id 先例（`event-core.js:107` /
//      `map-core.js:235,256` / `food.script.js:227`）**全部**是
//      `String(x.id || '前缀_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7))`
//      —— **由调用方生成、core 只透传**。这里照那条口径走，只是把"调用方"定成面板。
//   ② **空 id 会静默撞车**（本轮实测的阻塞①）：`normalizeItem({cat:'liquid'})` 回 `id = ""`，
//      而两条空 id 条目 `["",""]` **相等** ⇒ 用户建第二条同类资产时，第一条会被当成同一条
//      （按 id 去重 / 指认的逻辑立刻认错人）。所以"没给 id"这件事**不在这里悄悄兜**：
//      形状口如实回空串，由面板去补一个不撞的 id。
//
// `createEntryId(raw)`：id 的**形状口**（唯一一处）。认得的是"一个非空字符串"，其余
//   一律回空串 —— **不生成、不读时钟、不编**。`str()` 那种"把 0 / false / {} 变成非空文本"
//   的收法在这里是错的：那会让 `false` 变成一个合法的条目 id（同 `ownerOf` 那一族的裁定）。
function createEntryId(raw) {
  return (typeof raw === 'string') ? raw.trim() : '';
}

// `createEntry({ id, cat, label, ownerKey, state, template })` —— **纯函数**，回一个**条目**。
//   · **内部一律走 `normalizeItem`**（不自己拼条目对象）：产出的条目与账本里既有的那些
//     **逐字同形**（含 `template` 内嵌、`orphanFields` / `defaultedFields` / `stock` / `flows`
//     这几格的形状与顺序）。少走那一步就会造出"当场有效、读一遍就失效"的死数据
//     —— 本模块已经栽过四次的那个类。
//   · `stock` / `flows` / `orphanFields` / `defaultedFields` / `operations` / `members` /
//     `extends` / `relations` **入参里一概不收**：它们是 `normalizeItem` 的产物或别的批次
//     往条目上挂的东西（动作层、容器原语、升级轨、归属自检），**建条目这一趟不该由调用方
//     顺手塞**。谁要给，谁在条目建出来之后按各自的规矩写（各自有唯一写者）。
//   · **用户填过的 state 键要摘掉"补出来的"那笔账**（`markSupplied`）：模板里有 `def: 0`
//     的字段被用户真填了一个 0，不摘标记的话 `itemWorth` 会把它当"补出来的默认值"报成
//     估不出来 —— 那是"用户明说值 0 却当了没值"（`markSupplied` 的注释里那一族）。
//     ⚠️ 只对**调用方真给过的键**摘：`state` 里没给的键照旧是补出来的默认值（走 `def`）。
//   · `template`：可给可不给。给了就按"活的模板"走（`normalizeItem` 第二格），条目照旧
//     内嵌一份归一化后的模板；不给就是"这一条自带不了模板"，`cat` 仍原样留着。
//     面板会把内置分类模板交进来 —— 与既有条目（`assetRows` 的 `builtinTemplateOf`）同一份口径。
function createEntry(input) {
  const src = isObj(input) ? input : {};
  // ⚠️ **`__proto__` 要特判**：键是用户填的字段 key，裸 `{}` 上写 `state['__proto__']` 是
  //    **改原型**而不是加一格 ⇒ 实测 `keys=[]`、建出来的条目静默丢掉那个字段。
  //    ⚠️ **这里不用 `Object.create(null)`**（`seen` 那两处可以用）：这一格会一路走到
  //    `normalizeItem` 并成为产物 `item.state`，而针脚拿 `deepStrictEqual` 把条目与
  //    **手写的普通对象字面量**逐字对拍（本仓测试是 `node:assert/strict`，`deepEqual` 就是它）。
  //    ★ **G2AB 收口轮更正（复审 §3.7 实测，此前那半句归因是错的）**：这里从前写着
  //    "换 null 原型……**实测假红**" —— 那句**在这一处不成立**。实测（13 份口径、逐档）：
  //    **只把 `createEntry` 的 `state` 换成 null 原型 ⇒ 0 条红**（453 / 464 / 471 三个套件
  //    全是 `453/453/0`、`464/464/0`、`471/471/0`）；**那 27 条假红 100% 来自
  //    `asset-ledger.js` 的 `flatten`**（它那条读数是 `453 / 426 / 27`，红条随套件增长：
  //    464 → 30、471 → 34）。⇒ 那句读数**是 `flatten` 那处的**，不是这里的依据。
  //    这里仍然走 `setKey` 的理由是**保守一致**（`setKey` 式在两族都安全），不是"这一处会假红"。
  //    ★ 这条判断**不再在本文件里写第二份**：走共享原语 `setKey`（`asset-keys.js`）。
  const state = {};
  // 只收**非空**的值：`undefined` / 空串是"这一格用户没填"，不是"用户填了一个空值"
  // （本仓既有口径：没有就不留空壳键 —— `label` / `visibility` / `upgrade` 那几族都如此）。
  // ⚠️ `0` / `false` 照收：那是用户**明说的一个值**（与空串分辨得开，见 `fieldDefault` 那一族）。
  for (const [key, value] of Object.entries(isObj(src.state) ? src.state : {})) {
    const k = str(key).trim();
    if (!k || value === undefined || value === '') continue;
    setKey(state, k, flatten(value));
  }
  const raw = {
    id: createEntryId(src.id),
    cat: str(src.cat).trim(),
    label: str(src.label).trim(),
    ownerKey: str(src.ownerKey).trim(),
    state,
  };
  const tpl = isObj(src.template) ? src.template : null;
  const item = normalizeItem(raw, tpl || {}, { orphanFields: {} });
  // 用户真给过的键 ⇒ 从"补出来的"那笔账里摘掉（见函数头第三条）
  for (const key of Object.keys(state)) markSupplied(item, key);
  return item;
}

// ---------------------------------------------------------------------------
// 求和：存量净值（side 三路）与流量（kind 三档）
// ---------------------------------------------------------------------------
// 归属按 §3.11.5 的"可下沉"来判：**实例说了算**；实例没说，才看分类模板有没有声明 side
// （声明过就用它），都没有 → 资产侧。认不出的档 → 资产侧（方向仍可见，
// 但绝不静默变成 0 —— 值照算，无法估值的计数照记）。
//
// ★ 模板的**解析顺序**（本轮整改）：**活的 / 显式传进来的那份压过条目内嵌的那份**。
// 反过来出过事：一条欠账照自然写法归一化之后，内嵌的旧模板把显式传进来的那份翻掉，
// 于是 500 的欠账被算成 +500 的资产。内嵌模板只是"条目自带、方便直接算"的权宜
// （见 `normalizeItem` 末尾的注释），它不该有比调用方明写的那份更高的权威。
//
// ⚠️ 这里**不**做 `normalizeCategory`：归一化会给缺省项填上 `side: 'asset'`，
//    于是"老模板只写了 `kind`"这条回落路（§3.11.3：旧模板只写 kind）会被那个默认值
//    挡死 —— `entrySide` 先看到归一化补出来的 `side`，永远轮不到 `kind`。
//    所以只取**原件上真写了的**那两格，认不出的档留空交给回落。
function entryTemplate(entry, template) {
  const e = isObj(entry) ? entry : {};
  let src = template;
  if ((src === undefined || src === null) && isObj(e.template)) src = e.template;
  const t = isObj(src) ? src : {};
  const out = {};
  if (SIDES.indexOf(str(t.side)) >= 0) out.side = str(t.side);
  if (SIDES.indexOf(str(t.kind)) >= 0) out.kind = str(t.kind);
  out.fields = arr(t.fields).filter(isObj);
  return out;
}
function entrySide(entry, template) {
  const e = isObj(entry) ? entry : {};
  if (SIDES.indexOf(str(e.side)) >= 0) return str(e.side);
  const tpl = entryTemplate(entry, template);
  if (SIDES.indexOf(str(tpl.side)) >= 0) return str(tpl.side);
  if (SIDES.indexOf(str(tpl.kind)) >= 0) return str(tpl.kind);
  return DEFAULT_SIDE;
}
// 一条流水的金额：归一化过的那条实例已经把值落在 stock.worth 上；模板声明的计价字段
// 是**怎么算出**这个值的口径，不再回头去 state 里重新取一遍（两处取就会两处不一致）。
// 没有 worth / amount → 估不出来（NaN），不许回落到 0。
function entryWorth(entry, template) {
  const e = isObj(entry) ? entry : {};
  const stock = isObj(e.stock) ? e.stock : {};
  if (has(stock, 'worth')) return num(stock.worth);
  if (has(stock, 'amount')) return num(stock.amount);
  if (has(e, 'worth')) return num(e.worth);
  // 归一化过的条目身上带着那笔账（`defaultedFields`，落盘也认得）：补出来的默认值不是价，
  // 要一直传到这儿
  return itemWorth(e, entryTemplate(e, template), injectedOf(e)).worth;
}

// 存量净值三路：资产侧 / 欠的那侧 / 在册不计价。**"无法估值"单独计数**，不并进任何一侧。
// ★ 两个计数必须分开（本轮整改）：面板要同时说得出「在册不计价 N 项」与「另有无法估值 N 项」，
// 而这两句说的是两件事 —— 前者是用户明说不计价（`side: none`），后者是数据缺失（没有金额 /
// 金额算不出来）。合并成一个数就再也分不开了。
// `unpricedCount` 保留为两者之和：brief 点名的 ABI 不动，老的消费方照旧能读。
function sumNetWorth(entries, template) {
  let assets = 0;
  let liabilities = 0;
  let noneCount = 0;
  let noValueCount = 0;
  for (const entry of arr(entries)) {
    const side = entrySide(entry, template);
    if (side === 'none') { noneCount += 1; continue; }
    const worth = entryWorth(entry, template);
    if (!Number.isFinite(worth)) { noValueCount += 1; continue; }
    if (side === 'liability') liabilities += worth;
    else assets += worth;
  }
  return {
    assets,
    liabilities,
    net: assets - liabilities,
    unpricedCount: noneCount + noValueCount,   // 两者之和（brief 的 ABI 不动）
    noneCount,                                 // 在册不计价
    noValueCount,                              // 另有无法估值
  };
}

// 流量三档各求各的（决策 46）在**账本层**（`sumFlows`）：入为正、出为负、转移不带钱。
// 本文件也导出它（对外接口一个字都没变），但实现只有那一处。

// ---------------------------------------------------------------------------
// 账务事务层（§9 写回门 / 铁律 10）：手动记一笔 —— 在**账本层**
// ---------------------------------------------------------------------------
// `appendFlow` 连同它那四道闸（事由 / 去处 / 日期 / 谁）与"转移金额归零"的唯一写者规矩，
// 整体住在 `asset-ledger.js`（本文件开头借下来，也照旧从本文件导出 —— 对外接口一个字没变）。
// 上游（面板 / 提取 / 结算）仍从 core 取它，不必知道它住在哪一层。
// 它的口径不许在这里重写第二份：金额认什么、方向与 kind 缺省是什么，只有那一处说了算。

// ---------------------------------------------------------------------------
// 动作层（§15.2 ② 部署）：挂经营 / 摘经营 / 换模式
// ---------------------------------------------------------------------------
// **经营是资产上的一个可转换状态，不是另一类东西**（§3.11.7 的三层：资产主体 / 经营 / 经营位）。
// 所以这一层只动实例上的 `operations[]`，**不动**资产主体那一层的任何一格。
//
// 三个函数都是**纯函数**：入参 `item` 一个字都不改，回 `{ item, flows }`：
//   · `item`  = 新的实例对象（`operations` 更新过的那一份）；
//   · `flows` = **流水描述数组**（0 条或 1~2 条），**调用方**把它交给账本层的 `appendFlow` 落账。
// 动作层**不自己写账本**：`appendFlow` 是唯一的写者，四道闸（事由 / 去处 / 日期 / 谁）
// 与"转移金额归零"都在它那儿。这一层只负责"产生一笔该记的账"，不负责"记账"。
//
// ---- `operations[]` 的形状（§15.2 只说"结构用数组，将来加不用迁移"，字段由本层定） ----
//
//   { id, templateId, label, from, reason, status, to? }
//
//   · `id`         稳定 id，形如 `op_<n>`；n 取这条实例**已用过的最大号 + 1**
//                  （同一实例内不重号；非数字 id 不参与比较，老数据照样能接着往下发号）
//   · `templateId` 经营模板的 id（**模板跨分类复用**：出租可挂住宅、铺面、法器，§15.2）
//   · `label`      显示名，取模板的 `name`（**用户写的名字不换皮**；模板没起名就拿 id 顶）
//   · `from`       起于（调用方给的 `at`）
//   · `reason`     事由（一等字段，不是备注；也是这一趟流水的 `reason`）
//   · `status`     `'active'`（在跑）| `'stopped'`（已停）
//   · `to`         停于（**只停掉的那一条有**；在跑的那一条不许留一个空的 to）
//
// ★ **停掉的那一条不许删**（留历史，§15.2「旧模式停、新模式起」/ §3.11.7「同一处资产的四种命运」）：
//   摘经营与换模式都只把 `status` 改成 `'stopped'` 并补 `to`，数组里那一条永远留着。
//   删了它就再也说得出"这处资产曾经挂过什么" —— 那正是"不追溯、不重算"要保住的东西。
//
// ---- 流水（留痕）----
// 摘 / 换都要留一条流水（§15.2「各留一条流水」；§15.8「无金钱往来时 amount = 0，
// 但**必须留痕**」）。形状就是 §15.8 那一档：方向 `transfer`、金额 0、`kind: 'reserve'`
// （"只在储备池里进出"那一档，对三个和都中性）。`transfer` 在归一化层认三档之后
// （`asset-ledger.js` 的 `DIRECTIONS`）不会再被折成 `in`；两道归零闸都在账本层。
//
// 三处**自定裁定**（brief 把这几条留给本任务定，理由写在这里，测试逐条钉住）：
//   ① **挂经营也留痕**（一条 0 元 `transfer`）：§15.8 说的是"留痕"，不是"只有摘换才留"；
//      挂上经营同样是这处资产的一次状态变更，少这一条，账簿上就看不出这门营生是哪天起的。
//   ② 留痕的 `to`（"到哪儿去"，`appendFlow` 第二道闸要它）：**变更后的落点** ——
//      挂 / 换落在**新经营**上（`label`）；摘**落在资产本身**上（`item.label || item.id`）。
//      摘掉之后没有对手方，唯一说得出的落点就是这处资产。
//      两头都叫不出名字时**退回另一个**（条目没名就用经营名，模板没名就用资产名）：
//      一笔说不出去处的账 `appendFlow` 本来就会挡下，而"你去把资产名补上"不是用户在这个键上能做的事。
//   ③ 事由缺省时用**数据**顶（模板名 / `旧 → 新`），不在这里编面板词：换皮的字只从
//      `asset-terms.js` 取，core 里不出现任何面板结构词的字面量（`asset-terms.test.js` 会扫）。
//      调用方给了 `reason` 就用调用方的（面板那一侧知道该说什么）。
//
// ---- 边界（三个函数都是**全函数**：任何输入都不抛，也没有 error 出口）----
//   · 摘一个**没有在跑的经营**的实例 → 实例逐字不变、**0 条流水**（没有可留的痕，也不编一笔）；
//     已经停过的那一条**不重停、不重写 `to`**（连摘两次不会把停的那天改成今天）。
//   · 换一个**没有在跑的经营**的实例 → 就是"起一门新的"（1 条流水），仍然不抛。
//   · 挂**第二门**经营：本层只往数组后面追加（结构本来就是数组，将来加不用迁移），
//     "一处资产默认只有一个经营"由**面板**守（有在跑的经营时不给「挂经营…」那个键）。
//   · `at` 缺不在乎这一层：流水落不落得下去由 `appendFlow` 的第三道闸（日期必填）说了算。
const OP_STATUS = ['active', 'stopped'];
// 「摘了」在数据上只有一种写法：`status === 'stopped'`。其余（含老数据没写这一格）一律当在跑 ——
// 认不出的档不许静默变成"没有经营"（那会让面板把一处明明在经营的资产画成闲置）。
function opStatus(op) { return normEnum(isObj(op) ? op.status : '', OP_STATUS, 'active'); }
function opStopped(op) { return opStatus(op) === 'stopped'; }
// 这一条实例上的经营清单：**逐条深拷贝**（`flatten`），入参那一份连数组引用都不动。
// 不是对象的那几项原样带过去 —— 归一化/动作层都不负责清洗脏数据，丢了才是"读一遍丢数据"。
function opList(item) { return arr(isObj(item) && item.operations).map(flatten); }
// 稳定 id：已用过的最大号 + 1。只认 `op_<数字>`，别的形状（老数据/手写 id）不参与发号，
// 所以它永远发不出一个已经用过的号，也永远不会因为一条怪 id 就抛。
function nextOperationId(ops) {
  let max = 0;
  for (const op of arr(ops)) {
    const m = /^op_(\d+)$/.exec(str(isObj(op) ? op.id : ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'op_' + (max + 1);
}
// 一条留痕流水（§15.8 的样板那一档）：0 元、transfer、reserve。`to` 是"到哪儿去"，
// 没有它 `appendFlow` 的第二道闸会把这一笔挡下（见上面裁定 ②）。
//
// ★ **`to` 的口径（C2 修复轮 2 统一，写死在这里，三个动作都按它）**：
//   **`to` 一律 = 这处资产本身**（`item.label`）—— "一笔变动到哪儿去"的稳定读法：
//   落点是**这处资产**，"换成了哪门经营"是**事由**的一部分，归 `reason`。
//   三个动作共用同一个解析口 `assetLanding(it, op)`，谁都不许自己挑主格
//   （从前挂 / 换的 `to` 是经营名、摘的 `to` 是资产名 —— 同一个键两种所指，正是复查点名的缺陷）。
//   ⚠️ **`to` 恒非空**：空 `to` 会被 `appendFlow` 的第二道闸挡下 ⇒ 动作**静默失败**，
//   而"去把资产名补上"不是用户在那个键上能做的事。所以三档兜底、最后一档一定非空：
//     ① `item.label`（资产名，主格）→ ② `item.id`（还是这处资产，只是没起名）
//     → ③ 这一门经营的名字 / 通用词 `'这一门'`（`opName` 自己就恒非空）。
//   实际形状：真机上条目总有 id，所以第 ③ 档只在**测试造的无名条目**上走得到；
//   它存在的意义就是"这一层**永远发不出一笔空落点的账**"。
//   经营名（模板名 / 经营 label）另外还归 `reason` 与 `opId`：`reason` 是给人读的
//   "这笔账为什么记"，`opId` 是给机器追的"动的是哪一条经营"。
//
// ★ **`opId`**：动的是哪一条经营（`operations[].id`）。两个 0 元留痕靠它区分"停的是哪一条"——
//   光看 `reason`（旧 label → 新 label）在同一实例上两条经营**同名**时分不开，而 `op.id`
//   在实例内不重号（见 `nextOperationId`）。只放这一格稳定 id，**不**把整条经营塞进流水
//   （流水是"一笔账"，不是经营的副本）。
function traceFlow(reason, to, opId) {
  const f = { direction: 'transfer', amount: 0, kind: 'reserve', reason: str(reason), to: str(to) };
  if (str(opId).trim()) f.opId = str(opId).trim();
  return f;
}
// 一个经营记录从模板上取的那两格（显示名不换皮：模板叫什么就叫什么，没起名拿 id 顶）
function opFields(template) {
  const t = isObj(template) ? template : {};
  const id = str(t.id).trim();
  return { templateId: id, label: str(t.name).trim() || id };
}
// 一笔留痕"到哪儿去"（统一口径见上面 `to` 的口径）：**三档兜底、最后一档恒非空**。
function opLanding(main, backup, last) {
  return str(main).trim() || str(backup).trim() || str(last).trim();
}

// ---- 停 / 起的事由：写**短语**，不把经营名当句子（C2 复查·Important-1）----
// 从前摘经营的事由就是 `op.label`（一个数据名，例如某一门经营的显示名），它在账本里念出来是
// 「<日期> · <那个名字> · 转移」—— 三个字段平列，读不出"这一门不做了"。
// 换模式时更糟：**给了显式 reason 时**，停与起两条留痕的 `reason` 逐字相同（都是那一句），
// 账本里/「最近两笔」里那两行一模一样 —— 用户看不出哪条是停、哪条是起（§15.2 要"各留一条"，
// 各留一条的意义就在于**说得清哪条是哪条**）。
// 所以停/起各给一个短语：**经营名（label；连它都没有就退回 templateId）嵌在短语里**，
// 这样"停的是哪一个"「起的是哪一个」从流水本身就读得出来（不必去对照 `operations[]`）。
// ⚠️ 这里**不取面板词**：core 里没有三档表（词是显示层的东西），拼出来的只是一句**数据描述**；
//    它是不是好听是面板/投影的事，"说不说得清"是这一层的事。
function opName(op) {
  const o = isObj(op) ? op : {};
  return str(o.label).trim() || str(o.templateId).trim() || '这一门';
}
// ★ **三个动作解析 `to` 的同一个口**（C2 修复轮 2：`to` 一律 = 这处资产）。
// 参数：`it` 这处资产、`op` 这一笔留痕动的那一门经营（只当兜底用）。
// 三档兜底见上面 `to` 的口径；第三档取 `opName(op)`、而它自己恒非空（最后一格是 `'这一门'`），
// 所以**这里永远回一个非空串** —— 这是"动作不许静默失败"的最后一道保险。
function assetLanding(it, op) {
  return opLanding(str(it.label), str(it.id), opName(op));
}
// 停：《停<经营名>》。经营名嵌在短语里，所以"停的是哪一个"从流水本身就读得出来。
// ⚠️ 用户显式给的事由**不许被这个短语顶掉**（那是 §9 的一等字段，是数据）：显式事由进 `operations[].reason`，
//    并且**挂在短语里的括号中**一起留痕 —— 「停<旧经营名>（<用户事由>）」。两件事都保住：
//    "停的是哪一个"读得出来（复查·Important-1 的核心诉状），用户的字也一个字没丢。
//    从前那版是"显式事由 = 整条 reason"，于是停与起两条**逐字相同**；只丢短语则"停的是哪一个"又读不出来。
function stopReasonPhrase(op, explicit) {
  const phrase = '停' + opName(op);
  const why = str(explicit).trim();
  return why ? phrase + '（' + why + '）' : phrase;
}
// 起：《起<新经营名>》。**只在换模式那一条上缺省用它**：挂经营的事由缺省仍是**模板名本身**
// （那是 C2 原契约钉着的形状，`test/asset-core.test.js` 拿 `reason === '出租'` 钉住它，
// 本轮是修复轮、不许改既有断言迁就实现）。两者不矛盾的读法：**挂**落的事由是"这门叫什么"，
// **换**落的事由是"换成了哪一门"（旧停新起成对，才需要两个动词把两条分开）。
function startReasonPhrase(label, templateId) {
  return '起' + (str(label).trim() || str(templateId).trim() || '新的一门');
}

// 挂经营：给这处资产添一门经营（`operations` 追加一条 `active`）。回 1 条 0 元留痕（裁定 ①）。
// 留痕：`to` = **这处资产**（`assetLanding`，与摘 / 换同一口径）、`opId` = 刚挂上那一条的 id。
// 事由缺省仍是**模板名本身**（原契约：`reason === '出租'`）—— 挂经营没有"停/起"成对的第二条，
// 不需要用动词把两条分开；改成短语反而会改掉 C2 已钉住的形状（见 `startReasonPhrase` 的注释）。
function attachOperation(item, opTemplate, opts) {
  const it = isObj(item) ? flatten(item) : {};
  const o = isObj(opts) ? opts : {};
  const f = opFields(opTemplate);
  const ops = opList(it);
  const reason = str(o.reason).trim() || f.label;
  const next = {
    id: nextOperationId(ops),
    templateId: f.templateId,
    label: f.label,
    from: str(o.at).trim(),
    reason,
    status: 'active',
  };
  ops.push(next);
  it.operations = ops;
  // ★ `to` 与摘 / 换**同一个口**（`assetLanding`）：**这处资产**是主格，经营名只当兜底。
  //   与摘 / 换一字不差的同一把尺子 —— 三个动作的 `to` 不许再有第二种所指。
  return { item: it, flows: [traceFlow(reason, assetLanding(it, next), next.id)] };
}

// 摘经营：**只把在跑的那几条置停**（不删、不动资产主体那一层）。回 0~N 条 0 元留痕
// （默认"一处资产只有一个经营"，所以正常就是 1 条）。
// ★ 关停 ≠ 卖掉（§15.2 的警告）：卖掉是**资产层**动作（进账 + 条目消失），本层一个字都不碰 ——
//   实例的 id / cat / label / state / stock / flows 全部逐字带回，测试拿这几格钉着这条差别。
function detachOperation(item, opts) {
  const it = isObj(item) ? flatten(item) : {};
  const o = isObj(opts) ? opts : {};
  const at = str(o.at).trim();
  const ops = opList(it);
  const flows = [];
  // 落点：摘掉之后没有对手方，唯一说得出的"到哪儿去"就是**这处资产本身**（`assetLanding`）；
  // 连资产名与 id 都没有的条目才退回那门经营的名字 —— 但**必定非空**（第二道闸那条底线）。
  for (const op of ops) {
    if (!isObj(op) || opStopped(op)) continue;
    op.status = 'stopped';
    op.to = at;
    // 事由：给了显式事由就**把它挂在短语里**（用户的字一个字不丢，同时读得出停的是哪一门）；
    // 没给就只留短语「停<经营名>」—— 从前这里直接落那一门经营的显示名（数据名），
    // 在账本里念出来是「<日期> · <那个名字> · 转移」，读不出"这一门不做了"（复查·Important-1）。
    flows.push(traceFlow(stopReasonPhrase(op, str(o.reason).trim()),
      assetLanding(it, op), op.id));
  }
  it.operations = ops;
  return { item: it, flows };
}

// 换模式：**旧停新起**（每一条在跑的旧经营停一条、新经营起一条），各留一条流水（§15.2）。
// 旧的那几条不删（留历史）；`flows` 正常是 2 条（旧停 + 新起），实例上一条经营都没在跑时是 1 条。
// ★ **两条留痕必须各说各的**（C2 复查·Important-1）：§15.2 要"旧模式停、新模式起，**各**留一条"，
//   各留一条的意义就在**读得出哪条是停、哪条是起**。从前这里给了显式 `reason` 时两条逐字相同
//   （都是那一句），没给时两条也只差前半句；账本与「最近两笔」里那两行看起来一模一样。
//   现在：**停的那条说"停<旧经营名>"、起的那条说"起<新经营名>"**（两者都带 `opId` —— 旧条 id / 新条 id），
//   所以"哪一条停的"在账本里可追（复查·Minor-1）。
// ⚠️ 用户显式给的事由**不丢**：它进那一条 `operations[].reason`（一等字段，§9），
//   并**挂在停那条留痕的短语括号里**（见 `stopReasonPhrase`）—— 只丢短语会让"停的是哪一个"又读不出来，
//   只留事由则两条又变回逐字相同，用户看到的还是两行一样的账。
function switchOperation(item, nextTemplate, opts) {
  const it = isObj(item) ? flatten(item) : {};
  const o = isObj(opts) ? opts : {};
  const at = str(o.at).trim();
  const f = opFields(nextTemplate);
  const ops = opList(it);
  const explicit = str(o.reason).trim();
  const stopped = [];
  for (const op of ops) {
    if (!isObj(op) || opStopped(op)) continue;
    op.status = 'stopped';
    op.to = at;
    stopped.push(op);
  }
  // 事由的缺省是**数据**（`旧 → 新`，只有模板名与一个箭头），不是面板词（裁定 ③）
  const joint = stopped.length
    ? opName(stopped[0]) + ' → ' + (f.label || str(it.id).trim())
    : (f.label || str(it.id).trim());
  const reason = explicit || joint;
  const started = {
    id: nextOperationId(ops),
    templateId: f.templateId,
    label: f.label,
    from: at,
    reason,
    status: 'active',
  };
  ops.push(started);
  it.operations = ops;
  // 留痕：旧的那几条各停一条（事由说得出"停的是哪一个"），新起的那一条自己一条（说"起的是哪一个"）。
  // 落点都是**这处资产**（统一口径：`to` = 在哪一处资产上留的痕，不是经营名）；
  // 连资产名与 id 都没有的条目才退回经营名，且必定非空（`assetLanding`）。
  const flows = stopped.map(op => traceFlow(stopReasonPhrase(op, explicit),
    assetLanding(it, op), op.id));
  flows.push(traceFlow(startReasonPhrase(f.label, f.templateId), assetLanding(it, started), started.id));
  return { item: it, flows };
}

// ---------------------------------------------------------------------------
// 纵向升级（§15.5，任务 C3）：在一处资产上**再投入**
// ---------------------------------------------------------------------------
// `upgradeField(item, template, fieldKey, { to, cost, at, reason, note })` → `{ item, flows, error? }`
//
// ★ **§15.2 说"不新增机制"**：横向扩张（再加一处资产 / 再加一个经营位）走的是
//   「记一笔」与 C2 的 `attachOperation`（"加位"就是往 `operations[]` 追加一条，本文件
//   一个字都没为它加）。本函数只管**纵向那一根**：提升某个 `state` 字段。
//
// 三条硬语义（brief §2.2，逐条对应 §15.5）：
//   ① **`cost` 强制**：「没有成本的升级不是升级，是白送」。字段上没有 `upgrade` 轨 /
//      轨上没有 `cost` / `cost.money` 不是正数 ⇒ 一律 `LA_ASSET_COST_REQUIRED`，
//      **不产流水、不改 state**（挡下就是一步都不动，与 `appendFlow` 的"全有或全无"同口径）。
//   ② **走账务事务层，不是偷偷改数字**（铁律 10）：成功**恰好产一条**流水
//      （`amount = cost.money`、`direction: 'out'`、`kind: 'cashflow'`、事由必填），
//      由调用方交给唯一写者 `appendFlow` 落账。本函数**不写账本**，也**不**"只改 state 不产流水"。
//   ③ **`effect` 是自由文本**（同 `spec`）：系统**不理解**它 —— 不许拿它改结构、不许从里面
//      解析出等级 / 进度 / 倍数。本函数只做三件事：**校验 cost → 产流水 → 把新的字段值写进 `state`**。
//      `effect` 原样留在模板里给 AI 读（归一化层按"不透明地收着"保留它，见 `normalizeField`）。
//      ★ **不设等级 / 经验 / 成就点**（§15.5 末条，用户裁定"里程碑暂时不加"）：
//        本函数**不往条目上添任何键** —— 升级的唯一产物就是"那一个字段的新值 + 一条流水"。
//
// ★ **`to` 由调用方给**（面板上就是用户填 / 选的那个值）：§15.5 只说"提升某个 `state` 字段"，
//   没说值从哪来 —— 而 `effect` 是自由文本，系统读不懂。所以没给 `to` ⇒ `LA_ASSET_VALUE_REQUIRED`，
//   **绝不按 `effect` 猜一个值**（那就是"编数字"，铁律 6）。
// ★ **`fieldKey` 定位失败**（模板里没有这个 key）⇒ `LA_ASSET_FIELD_REQUIRED`，不静默成功。
//   字段定义在**分类模板**上（`template.fields[]`），所以签名要收 `template`。
//
// ★ **一处自定裁定：材料（`cost.resources`）写进事由，不建库存机制**（brief §2.2 把这个边界
//   留给本任务定，理由写在这里，测试逐条钉住）：
//   · **流水形状只管钱**：`amount = cost.money` —— 材料不折成钱、也不另开一条材料流水
//     （`appendFlow` 的流水形状本来也只有金额那一格）。
//   · 材料**原样写进事由**（`<调用方的事由>（材料：玄铁 3）`），用户读得出"这次升级还花了玄铁 3"。
//     §15.5 对材料的要求是**留痕**（与"花钱走流水""改值走重估"三样都必须留痕），
//     留痕在本任务的做法就是**写进事由** —— 事由是 §9 的一等字段，谁都不会把它当成备注丢掉。
//   · **不新增"材料库存 / 扣减"机制**：材料一旦要扣减，就得有库存与对账，那是另一个规格
//     （模板上的 `resources` 一个字都不动，没有任何"已扣减"的格子被造出来）。
//
// ---- 边界与纯函数纪律（与 C2 三个动作同形）----
//   · 入参 `item` / `template` / `opts` **一个字都不改**（`flatten` 深拷副本，`flatten(to)` 存值）。
//   · `at` 缺不在乎这一层：流水落不落得下去由 `appendFlow` 的日期那道闸说了算（错码顺序是接口的一部分）。
//   · **全函数**：任何输入都不抛（错码从 `error` 出，`item` 照旧是形状完好的副本）。
//   · `note` 是可选的**自由备注**（原文带上，系统不解释）；`resources` 走事由、不靠它。
//     ⚠️ **对象与字符串都收**（C3 复查·Minor-3）：从前面板/将来批次传一个字符串备注会被
//        **静默丢掉**（只有 `isObj` 那一支带它）—— "可选"不等于"可以悄悄吞掉用户给的字"。
//     两档都原样带上（字符串不折成对象、对象不折成 JSON 文本）：流水那一格是**不透明数据**，
//     系统读不懂它，所以没有理由替调用方改形状。
function upgradableOf(field) {
  const f = isObj(field) ? field : {};
  if (!isObj(f.upgrade)) return null;            // 没有升级轨 = 不能升级（不是"白送一次"）
  const cost = isObj(f.upgrade.cost) ? f.upgrade.cost : null;
  const money = cost ? num(cost.money) : NaN;
  // **成本必须是正数**：0 与负数都不是"付出成本"（「没有成本的升级不是升级，是白送」）
  if (!cost || !Number.isFinite(money) || money <= 0) return null;
  return { upgrade: f.upgrade, cost, money };
}
// 材料清单 → 一句**数据描述**（不是面板词）：`玄铁 3、灵砂 10`。
// 取不到名字的那一项整条跳过（编一个名字才是错的）；全部取不到 ⇒ 空串（那时不往事由里塞空话）。
function resourcePhrase(cost) {
  const parts = [];
  for (const r of arr(isObj(cost) ? cost.resources : null)) {
    const label = str(isObj(r) ? r.label : '').trim();
    if (!label) continue;
    const n = num(isObj(r) ? r.amount : '');
    parts.push(label + (Number.isFinite(n) ? ' ' + n : ''));
  }
  return parts.join('、');
}
// 升级的事由：用户给的 **一个字不丢**，材料挂在后面的括号里（"留痕"最小的一步）。
// 缺省的事由用**数据**顶（`升级<字段>：<旧> → <新>`），不在这里编面板词 —— core 里没有三档表，
// 而事由是必填的一等字段（`appendFlow` 的第一道闸），少这一句这笔升级就静默失败了。
// ⚠️ 这句是**数据描述**，与 `stopReasonPhrase` 的「停<经营名>」同一族；面板要给它换个说法，
//    走的是"面板自己传 `reason`"那条路（面板那一侧知道该说什么）。
function upgradeReason(cost, fieldKey, fromValue, toValue, explicit) {
  const why = str(explicit).trim();
  const base = why || ('升级' + str(fieldKey) + '：' + str(fromValue) + ' → ' + str(toValue));
  const mats = resourcePhrase(cost);
  return mats ? base + '（材料：' + mats + '）' : base;
}
function upgradeField(item, template, fieldKey, opts) {
  const o = isObj(opts) ? opts : {};
  const key = str(fieldKey).trim();
  const fields = arr(isObj(template) ? template.fields : null).filter(isObj);
  const field = key ? fields.filter(f => str(f.key).trim() === key)[0] : null;
  // 错码顺序：**能不能升级**是这一层的问题（模板说了没有）⇒ 字段那道闸先说话；
  // 它过了之后才是"这一处升级自身有没有成本"与"调用方给没给新值"。
  // （"没有模板 / 模板里没有这个字段"都是同一件事：这一层根本没有可升级的那一处。）
  if (!field) return { item: flatten(isObj(item) ? item : {}), flows: [], error: 'LA_ASSET_FIELD_REQUIRED' };
  const up = upgradableOf(field);
  if (!up) return { item: flatten(isObj(item) ? item : {}), flows: [], error: 'LA_ASSET_COST_REQUIRED' };
  // `to` 必须**真给了**：`0` / `false` 是值（照收），空串与全空白 / 没给都不是 —— 不许猜。
  if (!has(o, 'to') || o.to === undefined || str(o.to).trim() === '') {
    return { item: flatten(isObj(item) ? item : {}), flows: [], error: 'LA_ASSET_VALUE_REQUIRED' };
  }

  const it = flatten(isObj(item) ? item : {});
  const toValue = flatten(o.to);                   // 值照原样收（用户给的就是那个值，不做类型猜测）
  const state = isObj(it.state) ? it.state : {};
  const fromValue = state[key];                    // 升级前的旧值（只用来读事由，不用来算新值）
  // ★ **两个入参都可以是 `__proto__`**：目标字段 key 来自模板，`toValue` 是**用户直接给的值**
  //   （给对象就穿透）⇒ 走共享原语。⚠️ 同样不用 `Object.create(null)`（这一格是产物的一部分）。
  setKey(state, key, toValue);
  it.state = state;
  // ★ 落点是**这处资产**（`assetLanding`）—— 与 C2 的挂 / 摘 / 换**同一个口、同一种所指**
  //   （升级没有对手方，说得出"到哪儿去"的只有这处资产本身；第三档兜底保证恒非空）。
  const reason = upgradeReason(up.cost, key, fromValue, toValue, o.reason);
  const flow = {
    direction: 'out', amount: up.money, kind: 'cashflow', reason, to: assetLanding(it),
    // 升的是哪一处字段：与 C2 的 `opId` 同一族 —— 账本里那两笔的差别**从流水本身**读得出来
    // （同一处资产同一天升级两个字段时，光看事由长短分不开）。`appendFlow` 今天不收它
    // （账本层的白名单是它自己的形状，本任务一个字都不许改），将来愿意收就直接有。
    fieldKey: key,
  };
  // ★ **`entryId` = 动的是哪一条资产**（账本层 `appendFlow` 认这一格）：升级在语义上是
  //   "动的是哪一条"（`entryId`），而 `to` 是"到哪儿去"的落点格。
  //   ⚠️★ **G3-D1 更正（本注释从前那句已经过期）**：从前这里写着"`appendFlow` **只在 `transfer`
  //   时收 `to`**，所以上面那格 `to`（`assetLanding`，给人读的资产名）在**落账之后就不在了**"
  //   —— 那是当时的**实测读数**（`appendFlow` 的写下来那一句只在 `isTransfer` 那一支）。
  //   账本层现已放宽成 `if (to)`（闸 `asset-ledger.js:334` 一位不动）⇒ **上面那格 `to` 完整落盘**，
  //   账本里那条升级流水现在**两格都在**：`entryId`（稳定 id、"动的是哪一条"）
  //   + `to`（给人读的落点、"到哪儿去"）。
  //   ⇒ **`entryId` 这一格照旧必须有**（它才是"动的是哪一条"，且是稳定 id）；两者不是一回事、
  //   也不许互相顶替：`to` 是资产**显示名**（用户可改名），`entryId` 是**身份**。
  //   条目连 id 都没有时才不留空壳键（`appendFlow` 那边 `str(i.entryId).trim()` 也是这么判的）。
  if (str(it.id).trim()) flow.entryId = str(it.id).trim();
  // 自由备注：调用方给了就带上（系统不解释它，也不拿它算任何东西）。
  // **对象与字符串两档都收**（C3 复查·Minor-3）：从前只认对象，字符串备注被静默丢掉 ——
  // 而 `opts.note` 是调用方写的一等输入，丢了它在流水上就再也读不回来（`note` 不在事由里）。
  // 空对象（`{}`）与空串照旧不带：一个空壳键与"根本没给"在读的时候分不开。
  if (isObj(o.note)) {
    if (Object.keys(o.note).length) flow.note = flatten(o.note);
  } else if (typeof o.note === 'string' && o.note.trim() !== '') {
    flow.note = o.note;
  }
  return { item: it, flows: [flow] };
}

// ---------------------------------------------------------------------------
// 转移（§15.8①，任务 C4·决策 45）：把一处资产从一个人名下转到另一个人名下
// ---------------------------------------------------------------------------
// `transferOwnership(item, toOwnerKey, { at, reason })` → `{ item, flows, error? }`
// —— 与 C2 的三个动作 / C3 的 `upgradeField` **同形**（纯函数；`flows` 是**描述数组**，
// 交给唯一写者 `appendFlow` 落账；本函数**绝不自己写账本**）。
//
// 三条硬语义（brief §2.1，逐条对应 §15.8①）：
//   ① **实例不新建**（§15.8①：「实例**不新建**，只改 `ownerKey`」）：返回的 `item` 就是同一条
//      （`id` 一字不变），更**不许**"先删后建"—— 设计文档点名的两条歧路是「不做先删后建
//      （丢历史归属）、不做多主共有（模型保持单主）」，所以这里既没有第二个实例，也没有份额。
//   ② **记一条历史归属**：往 `item.relations` **追加**一条
//      `{ kind:'transferred-to', from:<转移前的 ownerKey>, to:<新的 ownerKey>, at, reason }`。
//      ⚠️ **追加、不是覆盖** —— 一处资产可以被转手多次，历史是**一串**（`relations` 是数组）。
//      `normalizeItem` 用 `cloneList`（逐项 `flatten`，深拷贝）把这一格原样带出来，所以
//      本函数**不必**再自己拷一层，也**不需要**动归一化层。
//   ③ **流水必须留痕**（§15.8①：「无金钱往来时 `amount = 0`，但**必须留痕**」）：
//      恰好**一条**描述，`direction:'transfer'` / `amount: 0` / `kind:'reserve'`，
//      外加 `to` 与 `entryId` 两格（口径见下面）。
//
// ---- `to` 与 `entryId` 两个口径：**照 C2/C3 已定下来的走，不在这里自创第三个** ----
//   · `to` = **这处资产**（`assetLanding`，与 C2 挂 / 摘 / 换、C3 升级**同一个口**），
//     恒非空 ⇒ 过得了 `appendFlow` 的第二道闸（`LA_ASSET_TRANSFER_TARGET_REQUIRED`）。
//     "转给谁"不占这一格：那是 `reason` 与 `relations[]` 的事（`to` 的所指全模块只有一个）。
//   · `entryId` = **动的是哪一条资产**（`it.id`）：`appendFlow` 认这一格，它是账本一级
//     唯一稳定读法（与 C3 升级流水同一件事）。条目连 id 都没有时**不留空壳键**
//     （与 `appendFlow` 的 `str(i.entryId).trim()` 同一判据）。
//   · 转移**不需要** `opId`：它动的不是某一门经营（`opId` 是 C2 留痕的格子），
//     也**不占用** `fieldKey`（那是 C3 升级的格子）。
//
// ---- 闸门与**错码顺序** ----
//   · 没给 `toOwnerKey` / 全空白 ⇒ `LA_ASSET_TRANSFER_TARGET_REQUIRED`
//     （**复用** `appendFlow` 的既有错码，不新增同义词）；`amount` 不在这里归零 ——
//     归零是 `appendFlow` 的第一道闸（唯一写者），本函数只负责**发一笔该记的账**。
//   · 没给 `reason` / 全空白 ⇒ `LA_ASSET_REASON_REQUIRED`（事由是 §9 的一等字段）。
//   · 两道的先后：**去处先说**（brief §2.1 把这个函数的两道闸写成"去处 → 事由"，
//     且"转移要写清是转给谁"是用户最先要补的那一格）。
//     ⚠️ 这两个错码**只是 `appendFlow` 四道闸里的两道**；面板那一层交上来的流水仍要过
//     `appendFlow` 的**全部四道**（`LA_ASSET_ACTOR_REQUIRED` → `LA_ASSET_REASON_REQUIRED`
//     → `LA_ASSET_TRANSFER_TARGET_REQUIRED` → `LA_ASSET_DATE_REQUIRED`），
//     这里一个字都没改、也不许改（那是接口的一部分）。
//
// ---- ★ 自定裁定（brief 把这一条留给本任务定，只许选一条，理由与判据都写在这里）----
// **转给自己（`toOwnerKey === item.ownerKey`）⇒ 明确无操作**，不抛错、**但给一个专属错码**
// `LA_ASSET_TRANSFER_SELF`：
//   · **不许落成一次"假转移"**：`from === to` 的历史条目是一截**假历史** —— 而"历史归属"的
//     全部价值就在"真的换过手"（一段自己转给自己的记录会让 `relations` 从此不可信）。
//     也**不许**顺手发一笔 0 元流水：那是"编一笔没发生的账"（铁律 10 的反面）。
//   · **为什么不干脆静默成功**：静默成功 = 用户点了「转移…」什么都没发生、也没有任何回话，
//     正是铁律 9 禁止的"点了没反应"。所以**回一个错码**，由**面板**翻成一句能照做的话
//     （"这处资产已经记在这位名下，不用再转一次"）—— core 里不出现面板词（见文件头纪律）。
//   · 值缺失（`ownerKey` 空 / 认不出）走的是另一条路（`auditOwnership` 的 `lost`），
//     与"同一个具体的角色"这一档不混：空 `ownerKey` ⇒ `toOwnerKey !== item.ownerKey`，
//     这里**挡不下**它 —— 那是对的，把一处"没有主"的资产转给某个人是**真的一次转移**。
//   · `item` 原样回（不是 `undefined`），形状与成功路径一致：调用方不必为这一档另写一条分支。
function transferOwnership(item, toOwnerKey, opts) {
  const o = isObj(opts) ? opts : {};
  // 纯函数第一步：**一律走一份深拷副本**（`flatten` 认不出的入参 —— `null` / 字符串 / 数字 ——
  // 原样回来，所以每条出口都再过一道 `isObj`）。入参一个字都不改，是这一层所有函数的同一把尺子。
  const base = flatten(isObj(item) ? item : {});
  const src = () => (isObj(base) ? base : {});
  const to = str(toOwnerKey).trim();
  if (!to) return { item: src(), flows: [], error: 'LA_ASSET_TRANSFER_TARGET_REQUIRED' };
  const reason = str(o.reason).trim();
  if (!reason) return { item: src(), flows: [], error: 'LA_ASSET_REASON_REQUIRED' };
  // 转给自己：明确无操作（见下面裁定 —— 不造假历史、不编假账，也不假装成功）
  if (to === str(src().ownerKey).trim()) {
    return { item: src(), flows: [], error: 'LA_ASSET_TRANSFER_SELF' };
  }

  const it = src();
  const at = str(o.at).trim();
  const from = str(it.ownerKey);                     // 转移前的主（只 trim 掉空白；大小写与字面原样保住）
  const relations = arr(it.relations).map(flatten);  // 逐条深拷贝（`flatten` 认不出的东西按值带过去）
  // ★ **追加**一条：历史是一串（这处资产可以被转手多次），绝不覆盖、绝不重排
  relations.push({
    kind: 'transferred-to',
    from,
    to,
    at,
    reason,
  });
  it.relations = relations;
  it.ownerKey = to;
  // 归属已经**重新落到一个真主**身上 ⇒ "归属已失"这个判定作废（自检留下的那一格要摘掉，
  // 否则面板会一直把一处有主的资产印成"归属已失"）。没有这一格就不留空壳键（同 `ownerLost` 口径）。
  delete it.ownerLost;
  // 流水：§15.8① 的样板那一档（0 元 transfer / reserve）。`to` 与 `entryId` 的口径见上面。
  const flow = {
    direction: 'transfer',
    amount: 0,
    kind: 'reserve',
    reason,
    to: assetLanding(it),
  };
  if (str(it.id).trim()) flow.entryId = str(it.id).trim();
  return { item: it, flows: [flow] };
}

// ---------------------------------------------------------------------------
// 归属自检（§15.8①，任务 C4）：`ownerKey` 指向**已不存在的角色**
// ---------------------------------------------------------------------------
// 规格原文：「自检：`ownerKey` 指向已不存在的角色 → **能自己修就修**（归回原主或标"归属已失"），
//           不能就进日志，**不弹报错**（铁律 9）」。
//
// `auditOwnership(item, { hasRole })` → `{ item, fixed }` —— **纯函数**，任何输入都不抛。
//   · `hasRole(key) → boolean` 由**调用方注入**：core **不认识角色表**（角色表是宿主/面板的事，
//     这一层连它的形状都不该知道），所以"这个 key 还算不算一个人"只能问外面。
//   · 不是函数 / 没给 ⇒ **一律不动**（`fixed: null`）：问不出"还算不算一个人"就没有判据，
//     这时**猜**一个答案就是在编数据（"不可估值就明说，不编数字"的同一条立场）。
//
// ---- `fixed` 三档（本任务定，测试逐条钉住）----
//   · `null`      —— 不用管：`ownerKey` 空（这处资产本来就没写主，不是"主没了"），
//                    或者 `hasRole(ownerKey) === true`（主还在 ⇒ 一个字都不动，**只**顺手摘掉
//                    一格过期的 `ownerLost`，见下面那句注释：摘掉不算"修了什么"，`fixed` 仍是 `null`）。
//   · `'restored'`—— **能自己修就修**：从 `relations` 里找**上一个真实存在的主**并归回他。
//                    "上一个真实的主"怎么找：从**最新的一条** `transferred-to` 往回扫，
//                    取第一条 `from` 让 `hasRole(from) === true` 的（最近的一任真主 —— 时间上
//                    最接近、也最可能就是这一次丢失之前的那位）。
//   · `'lost'`    —— 修不了：历史里没有一个 `from` 还算得上人 ⇒ 把 `ownerKey` 标成**"归属已失"**，
//                    做法是 `ownerLost: true`（条目形状里那一格，见 `normalizeItem` 的白名单）。
//                    ⚠️ **`ownerKey` 上那个已不存在的键原样留着**：它是"从哪儿来"那半句
//                    （清零就等于抹掉"曾经归谁"），面板印的是那一行的**读数**（"归属已失"），
//                    不是要把它写成一个不认识的 key。（这与"不许编一个假 key"是同一条：
//                    标一个 `__lost__` 之类的哨兵，等于造了一个角色。）
//
// ---- 面板侧怎么用（见 `asset.script.js`）----
//   列表 / 详情渲染时跑这个自检，**静默修**；修完把条目**写回账本一次**（见面板那边的注释）。
//   §15.8① 要的是"**不弹报错**"：这一层**不抛**、也没有任何错误出口，唯一产物是
//   `ownerLost` 那一格与（能修时的）`ownerKey`；屏幕上会不会多一个词，由词表那一档说了算。
//
// ⚠️ 幂等：修过一次之后再跑，`hasRole` 若照旧说"这个人不在"，`restored` 会再写一次
//   同样的 `ownerKey`（并再追加一条同样的历史条目 —— 这也是为什么"只修一次就写回"）。
//    换句话说：**重复运行不会让结果变坏，但会让历史变长**，所以调用方应当只在
//    `fixed !== null` 时写回一次，而不是每次渲染都盲目重放。
function auditOwnership(item, opts) {
  const it = flatten(isObj(item) ? item : {});
  const o = isObj(opts) ? opts : {};
  const hasRole = typeof o.hasRole === 'function' ? o.hasRole : null;
  const key = str(it.ownerKey).trim();
  if (!hasRole || !key) return { item: it, fixed: null };   // 没有判据 / 本来就没写主 → 不动
  let ok = false;
  try { ok = hasRole(key) === true; } catch (e) { ok = false; }   // 问不出答案就当"不能修"（绝不抛）
  if (ok) {
    // 主还在 ⇒ 一个字都不动，**除了**摘掉"归属已失"那一格：它是一句**过期的错判定**
    //   （上一次是在"名单读不到 / 这个人当时问不到"的时刻写下的），留着它面板会**永远**把
    //   一处有主的资产印成「归属已失」—— 这就是"假信号不可逆"。
    // ⚠️ 摘掉 ≠ "修了什么"：`fixed` 照旧回 `null` —— 它说的是"我没有把谁归回给谁"，
    //    不是"这一趟盘上没有任何变化"。**调用方仍要把这份产物落回盘上**（否则它摘的是
    //    自己手上那份副本，盘上那一格照旧挂着 —— 面板侧就是按"这一格的去留变了"判的）。
    //    `hasOwnProperty` 而不是 `!== undefined`：空壳键也是脏的，不留。
    if (Object.prototype.hasOwnProperty.call(it, 'ownerLost')) delete it.ownerLost;
    return { item: it, fixed: null };
  }

  // ① 能自己修就修：从最新的一条 `transferred-to` 往回找上一个**真实存在**的主
  const found = arr(it.relations).slice().reverse().filter(r => isObj(r)
    && str(r.kind) === 'transferred-to' && str(r.from).trim()).map(r => str(r.from).trim())
    .filter(from => {
      try { return hasRole(from) === true; } catch (e) { return false; }
    })[0];
  if (found) {
    it.ownerKey = found;
    delete it.ownerLost;                                    // 归回原主 ⇒ 那一格作废
    // 记一条**引擎元数据**级的旁注（`relations[]` 是既有的历史数组，不新增键、不动白名单）：
    // 说明这一条历史条目是"自检归位"造出来的，不是用户那次转移。同一条目**只追加一次** ——
    // 自检是幂等的（见函数头），反复跑不该把历史越拖越长。
    const relations = arr(it.relations).map(flatten);
    const seen = relations.some(r => isObj(r)
      && str(r.kind) === 'transferred-to' && str(r.from).trim() === found
      && str(r.to).trim() === key && r.audited === true);
    if (!seen) {
      relations.push({ kind: 'transferred-to', from: found, to: key, at: '', reason: '', audited: true });
    }
    it.relations = relations;
    return { item: it, fixed: 'restored' };
  }
  // ② 修不了：标"归属已失"（`ownerKey` 上那个键留着 —— 见上面"从哪儿来"那半句）
  //    ★ **已经标过就不算一次"修"**（`fixed: null`）：这一条是**幂等**的关键 —— 判据回 null
  //      调用方才不会"每渲染一次就写回一次"（写回一次 ≠ 每次重算）。少了这一句，
  //      `'lost'` 这一档会**永远**报"我修了"，于是面板每打开一次就落一次盘。
  if (it.ownerLost === true) return { item: it, fixed: null };
  it.ownerLost = true;
  return { item: it, fixed: 'lost' };
}

// ---------------------------------------------------------------------------
// 分账（§15.8① 的**读侧**，任务 C6）：一处资产**现在归谁**
// ---------------------------------------------------------------------------
// 写侧（C4）只改 `ownerKey`、**不搬条目** —— 条目照旧躺在原来那个桶的 `entries[]` 里
// （§15.8① "实例不新建"）。于是"这处资产现在在谁名下"就**不能**再看它在谁的桶里，
// 只能看条目上那一格。这个函数就是那一格的**唯一判定口**（与 `flowSigned` 同一个道理：
// 面板 / 投影 / 将来的结算都调它，谁也不许自己再写一份"归谁"）。
//
// ---- 规则（三态，§15.8① 的语义）----
//   · 条目上有**非空**的 `ownerKey` ⇒ **就是它**（转移之后以它为准）。
//   · 没有 / 空串 / 只有空白 / 脏值 ⇒ **回落 `bucketKey`**（它落在谁的桶里就是谁的）。
//     ⚠️ **这条回落是兼容性的关键**：绝大多数老条目**从来没有**这一格，少了它，
//        所有老条目都会"没有主"（界面上凭空消失）。
//     ⚠️ **只认字符串**：这一格是**一个键**（与 `bucketKey` 同类），不是"一个有值的字段"。
//        `0` / `false` / `{}` 这类东西在 `String(...)` 之下都变成**非空**的文本（`'0'` /
//        `'false'` / `'[object Object]'`），照收就等于**编了一个叫"0"的人**出来
//        （同 `truncated key` 那一族的毛病：`tenant` 变 `ten`，屏幕上多一行查无此人的账）。
//        所以先过 `typeof === 'string'`，再 `trim()` —— 两关都过了才认。
//        ⚠️ 这也顺带挡住了会抛的入参（`Symbol` 过 `String()` 必抛）：一个读侧判定口
//        不该因为账本里混进一格怪东西就把整屏渲染带崩（"不可估值就明说，不编数字"的同一条）。
//   · **归属已失**（`ownerLost === true`）⇒ 也算**桶主**。
//
// ---- ★ 自定裁定（brief §2.1 把这一条留给本任务定，只选这一条）----
//   **`ownerLost` 的条目算桶主**，理由（三条，缺一条都不够）：
//     ① **它是"找不到主"的兜底，不是"没有主"**：`auditOwnership` 判 `'lost'` 的那一刻，
//        原主已经不在角色表里、历史里也找不回上一个真主 —— 但那处资产**还在**，
//        账面上也还落在 `bucketKey` 这个桶里。这时让它**跟随桶主**，是"读侧不掉东西"
//        的唯一一条路（§15.8① 要的是"不弹报错"，不是"东西消失"）。
//     ② **它保证"归属已失"的条目永远看得见**：按 `ownerKey`（那个已不存在的键）过滤，
//        这处资产会掉进"谁都不显示"的空档 —— 一处资产从屏幕上凭空消失，比一个状态词更坏。
//     ③ **与写侧同源**：`ownerKey` 上那个键**原样留着**（"曾经归谁"那半句），所以读侧
//        只能靠这一格来分账；用它过滤必然查无此人 ⇒ 必然不可见。所以这一格**必须在
//        判定口里被拦下**，而不是靠每个调用方各自记得处理（那迟早漏一处）。
//   ⚠️ 与 `ownerLost` **无关**的一切照旧按 `ownerKey` 走：自检若能把主修回来
//      （`'restored'`），那一格已经被摘掉，这里就按修好的主分账。
//
// **纯函数**：入参一个字都不改（认不出的条目 —— `null` / 字符串 —— 一律当"没这一条"）。
function ownerOf(item, bucketKey) {
  const it = isObj(item) ? item : {};
  // 只认字符串（见上面那一段）：`str()` 会把 `0` / `false` / `{}` 变成非空文本，
  // 照收就是编一个查无此人的主；`Symbol` 更是会抛。
  const fromItem = it.ownerKey;
  const key = (typeof fromItem === 'string') ? fromItem.trim() : '';
  const fromBucket = bucketKey;
  const bucket = (typeof fromBucket === 'string') ? fromBucket.trim() : '';
  // 主人**已经不在**（`ownerLost`）⇒ 桶主兜底（见上面裁定 ①②③）
  if (it.ownerLost === true) return bucket;
  return key || bucket;
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------
const api = {
  CATEGORY_IDS, SIDES, KINDS, AGGS, MODES, DEFAULT_SIDE, DEFAULT_MODE, DEFAULT_KIND,
  fieldAgg,
  fieldSum,
  fieldDefault,
  normalizeField,
  normalizeCategory,
  categoryDisplayName,
  normalizeFlow,
  normalizeFlowList,
  // 一条流量的正负号（入为正、出为负、转移不带钱 = 0）：**面板与将来的投影文本都按这一条印数**，
  // 谁也不许自己抄一份符号规则（C1 那版面板抄过一份，很快与这里分叉）。
  // 它是账本层的东西，从 core re-export —— core 是这份模块对外的取口，既有名字一个都没动。
  flowSigned,
  normalizeItem,
  migrateItem,
  markSupplied,
  // 新建一条资产（批次 F6·§7.4 #6 的"新增"那一个显式动作）：**纯函数**、内部走 `normalizeItem`。
  //   · `createEntryId` 只做**形状**（非空字符串），**不生成 id、不读时钟** —— 生成在面板那一层
  //     （见函数头那一族注释：core 是不读时钟的纯函数层，且空 id 会静默撞车）；
  //   · `createEntry` 直接回**条目**（不是 `{item, flows}` 那一族：建条目本身不产流水）。
  createEntryId,
  createEntry,
  sumNetWorth,
  sumFlows,
  appendFlow,
  // 动作层（§15.2 ② 部署）：挂 / 摘 / 换。纯函数，回 `{ item, flows }`；
  // 流水由调用方交给上面的 `appendFlow`（唯一写者）落账。
  attachOperation,
  detachOperation,
  switchOperation,
  // 纵向升级（§15.5，任务 C3）：提升某个 `state` 字段。**cost 强制**、走流水（回 `{ item, flows }`）、
  // `effect` 只是自由文本（系统不理解它）。与 C2 那三个**同形**（纯函数、`flows` 交调用方落账）。
  upgradeField,
  // ★ **"这一处字段到底能不能升级"的唯一判定口**（C3 复查·Minor-1）：面板从前在
  //   `asset.script.js` 自己写了一份数判定（`Number(cost.money) > 0`），与这一层用 `num()`
  //   的口径**分叉**：`cost.money` 是 `true` / `[12000]` 这类值时面板摆出「升级…」、
  //   而 core 必然回 `LA_ASSET_COST_REQUIRED` —— 点下去只剩一句拒绝（铁律 9 禁止）。
  //   两份口径就是两个真相，所以把**这一份**（`upgradeField` 自己用的那一份）交出去，
  //   面板调它、不再自己判（`upgradeField` 里 `const up = upgradableOf(field)` 同一处）。
  //   回 `null` = 不能升级；回 `{ upgrade, cost, money }` = 能，且 `money` 是已经算好的正数。
  upgradableOf,
  // 转移（§15.8①，任务 C4·决策 45）：把一处资产从一个人名下转到另一个人名下。
  // **实例不新建**（只改 `ownerKey`）、往 `relations` **追加**一条 `transferred-to` 保历史归属、
  // 产**一条** 0 元 `reserve` 留痕（`to` = 这处资产、`entryId` = 动的是哪一条 —— C2/C3 的口径）。
  // 与 C2/C3 那四个**同形**（纯函数、`flows` 交调用方落账、错码从 `error` 出）。
  transferOwnership,
  // 归属自检（§15.8①）：`ownerKey` 指向**已不存在的角色** ⇒ 能自己修就修（`'restored'` /
  // `'lost'`），不能就交给调用方去记日志，**这里不抛、也没有错误出口**（铁律 9：不弹报错）。
  // 判据 `hasRole` 由调用方**注入** —— core 不认识角色表。
  auditOwnership,
  // 分账（§15.8① 的**读侧**，任务 C6）：`ownerOf(item, bucketKey)` → "这一处资产**现在**在谁名下"。
  // 写侧（C4）只改 `ownerKey`、不搬条目，所以**读**的时候必须按这一格分账 ——
  // 面板拿它扫**所有**桶、把 `ownerOf(entry, bucketKey) === 当前看的人` 的条目挑出来。
  // 规则与三条自定裁定（尤其 `ownerLost` 算桶主）见函数头 —— 那里是唯一一份口径。
  ownerOf,
  get BUILTIN_CATEGORIES() { return builtinCategories(); },
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  // 面板 / 投影 / 结算都**惰性**取，别在 IIFE 顶层抓（同 store 的取法）
  rt.__LA_ASSET_CORE__ = api;
}

})();

  return module.exports;
})();
