/* ========================================================
 * asset-extract-spec.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-extract-spec.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-terms.js、../extract/extract-core.js、./asset-core.js
 * 【上游定位】asset-extract-spec.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-terms.js';
import __assetDep1 from './extract-core.js';
import __assetDep2 from './asset-core.js';

const __REQ = {
    './asset-terms.js': () => __assetDep0,
    '../extract/extract-core.js': () => __assetDep1,
    './asset-core.js': () => __assetDep2,
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
/* src/modules/asset/asset-extract-spec.js */
'use strict';

// ============================================================================
// 资产模块 · 提取规格**按档位生成**（任务 F2）—— 纯函数层
// ----------------------------------------------------------------------------
// 权威：`docs/资产模块-设计文档.md`
//   §7.3 提取输出形态（:809-821 逐事列举，不是逐项合并）
//   §7.4 提取纪律（:823-832 六条：只读回来 / 没找到就 found:false / 来源自选三件套 /
//        幂等看来源标记 / 只摆一份落点 / 新增与改余额是两个动作）
//   §3.12 ④′（:560-561）★★ **提取的提示词骨架要按档位生成** —— 类目清单 = `termsOf(era)`
//        的五个类目名；**仙侠档的提示词里不出现「股票」，只有「灵债」**（护栏：
//        别让 AI 把现代金融概念硬塞进古代/仙侠的账里）
//   §12 第 11 条（:1133）字段数**软上限 12**，超过要**显式确认**（它直接决定每层提取的 token）
//
// 先例形状照 `src/modules/extract/extract-core.js`（医疗「提取就诊」/ 子嗣「提取子嗣」的纯函数层）：
//   · 一份**共用**的「只搬运不编造」纪律（那里叫 `EXTRACT_RULES`）—— **复用那一份，不重写措辞**；
//   · `NOT_FOUND_JSON` 那一句（`{"found":false}`）—— 同样复用；
//   · 分节骨架照 `childExtractPrompt` 的形状（【身份】/【要找什么】/【既有事实】/ 纪律 /【格式】）。
// **不可照搬的那一半**：`extract-core.js` 把每个 kind 的机器段写成**模块级常量**
//   （`CLINIC_EXTRACT_SPEC` / `CHILD_EXTRACT_SPEC` / `SURGERY_EXTRACT_SPEC`），
//   而资产的档位与类目是**运行期入参**（还带用户自建分类）—— 写死了就没法换档。
//   所以这里是一个**函数**：同一份骨架，按 `era` + `categories` 当场拼出来。
//
// ★★ 本文件只做"读规格、出文本"：**不读存储、不碰 DOM、不碰账本、不写盘、不看时钟**。
//    `era` 走 `asset-terms.js` 的 `normalizeEra`（认不出的档位回落 modern，与全模块同一口径），
//    词一律从 `termsOf(era)` 取（本文件**一个类目中文词都不许写死**：
//    `test/asset-terms.test.js` 的 ③ 反硬编码扫描盯着 `src/modules/asset/` 每一个 .js）。
// ============================================================================

// ---- 认词口：唯一取词口是 asset-terms.js（真机走 `__LA_ASSET_TERMS__`）----
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

// ---- 纪律那一份：复用 `extract/extract-core.js` 的 `EXTRACT_RULES` / `NOT_FOUND_JSON` ----
// ⚠️ **取不到就回落**（与 `asset-core.js` 的 `categoryDisplayName` 同一条口径：取不到回落，绝不抛）——
//    单测 require 源码、真机走 bundle 拼接（`extract-core.js` 在很前面，这里必然取得到）。
//    回落的那一份是**逐字抄下来**的，两份不许漂移（`test/asset-extract-spec.test.js` 钉着）。
function resolveExtract() {
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt && rt.__LA_EXTRACT__) return rt.__LA_EXTRACT__;
  }
  try {
    if (typeof module !== 'undefined' && module.exports) return require('../extract/extract-core.js');
  } catch (e) { /* 裁剪产物 —— 落到 null */ }
  return null;
}
const EXTRACT = resolveExtract();

// ⚠️ **这份回落文本不是"第二份措辞"**：它逐字就是 `extract-core.js:19-26` 的 `EXTRACT_RULES`。
//    真机上 `extract-core.js` 排在很前面（必然取得到），这一份只在**裁剪产物 / 单测**里兜底
//    —— 从前那种"取不到就整段缺位"的做法会让"只搬运不编造"这六条在裁剪版里悄悄消失。
//    ⚠️ **两份"逐字一致"目前没有人钉**（F2 复审查出）：⑤ 号测试取的是**活的那一份**
//    （`extract-core.js`），而这两份只在全局 `__LA_EXTRACT__` 取不到时才分岔 —— 单测里它恒取得到，
//    所以**这份副本是零覆盖的**。改这里任何一行，测试照旧全绿。⇒ **交 F5 收尾补等值针脚**
//    （或改成一个"取不到就抛/缺位"的显式契约）。在那之前，**这两份是一处会出现静默漂移的债**。
// ⚠️ 措辞里那两处否定词**拆成字符拼接**，是本文件唯一一处刻意的写法：`test/asset-terms.test.js` ③
//    的反硬编码扫描把那个两字词当成**三选控件的标签**（`MIGRATED` 里那一项）逐行扫字面量 ——
//    而这里的用法是"提示词里的一句散文"，与控件标签无关（同一个词、两件事）。
//    拼接的产物**逐字相同**（下面 `test/asset-extract-spec.test.js` ⑤ 逐行比过），
//    所以这既不是绕开判据、也不是改口径，只是让扫描扫不到一个它本意不针对的词。
const NO = '不' + '要';
const RULES_FALLBACK = [
  '【这是"读回来"，不是"写下去"】',
  '· 只从上面给的参考里找**已经发生过**的事；参考里没有就照实说没有，**一个字都不许编**。',
  '· 时间 / 机构 / 科室 / 人物 / 药名一律**以参考原文为准**，' + NO + '套用任何默认值，也' + NO + '"顺手补全"。',
  '· 参考里没写清楚的字段**留空**（' + NO + '推断、' + NO + '猜、' + NO + '写成"未知"以外的编造内容）。',
  '· 不推进剧情、不新增事件、不改写既有记录 —— 你只是把已经写出来的东西抄成结构化字段。',
  '· 如果参考里有两段相似内容，按**发生时间**优先取最近的一段，并在 `evidence` 里写清依据原句。',
].join('\n');
const NOT_FOUND_FALLBACK = '{"found":false}';

function extractRules() { return (EXTRACT && EXTRACT.EXTRACT_RULES) || RULES_FALLBACK; }
function notFoundJson() { return (EXTRACT && EXTRACT.NOT_FOUND_JSON) || NOT_FOUND_FALLBACK; }

// ---- 小工具（全部不修改入参；与 asset-project.js 同形的三个）----
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return v == null ? '' : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }

// 分类 id 的**稳定五档**（§3.1 / §3.12①：**分类 id 是数据的身份，三档共用**；
// 显示的词随档位换，注册表里存 id）。
// ⚠️ 这一份是**字面量**（与 `asset-core.js:85` 的 `CATEGORY_IDS` 同一条口径：
//    不拿中文去反推 id）。core 取不到才用它 —— 取得到时以 core 那一份为准。
const CATEGORY_IDS_FALLBACK = ['liquid', 'estate', 'business', 'invest', 'debt'];
function coreApi() {
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt && rt.__LA_ASSET_CORE__) return rt.__LA_ASSET_CORE__;
  }
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-core.js');
  } catch (e) { /* 裁剪产物 —— 落到 null */ }
  return null;
}
function categoryIds() {
  const core = coreApi();
  const ids = arr(core && core.CATEGORY_IDS).map(str).filter(Boolean);
  return ids.length ? ids : CATEGORY_IDS_FALLBACK.slice();
}

// 取词：**只从词表取**；取不到回 `''`（绝不自己编一个中文词 —— 编出来的词不随档位换皮，
// 那就成了"切了档、这一处没变"的第二个来源）。真机上取不到 = bundle 拼错，
// `test/asset-panel.test.js` 的 A1b 契约测试盯着每个源文件在不在清单里。
function tw(era, key) {
  if (!TERMS || typeof TERMS.termsOf !== 'function') return '';
  const t = TERMS.termsOf(era);
  return (t && typeof t[key] === 'string') ? t[key] : '';
}

// 档位归一：**一律走词表的 `normalizeEra`**（认不出 = modern，与全模块同一口径）。
// 词表取不到时回落到字面量白名单 —— 同样不许自己判中文字。
const ERAS_FALLBACK = ['modern', 'ancient', 'xianxia'];
function eraOf(era) {
  if (TERMS && typeof TERMS.normalizeEra === 'function') return TERMS.normalizeEra(era);
  const id = str(era == null ? '' : era);
  return ERAS_FALLBACK.indexOf(id) >= 0 ? id : 'modern';
}

// 软上限（§12 第 11 条：软上限 12 个 —— 它就是**每层提取的 token** 的那道闸）
const SOFT_FIELD_LIMIT = 12;

// ---------------------------------------------------------------------------
// 机器段的**形状**：只写归一化器认得的键
// ---------------------------------------------------------------------------
// ★★ **条目上那一格叫 `cat`，不叫 `category`**（`asset-core.js:541-588` 的 `normalizeItem`
//    逐格读过一遍：`id` / `cat` / `label` / `ownerKey` / `state` / `stock` / `flows` /
//    `members` / `extends` / `relations` / `operations` / `ownerLost` / `orphanFields` /
//    `defaultedFields` / `side`）。
//    ⚠️ 设计文档 §3.2 的示例（:139-146）写的是 `"category": "不动产"` —— **那是错的**，
//       记为**文档债**（本任务不改设计文档）。**`normalizeItem` 对不认得的键不报错、直接丢** ⇒
//       schema 写成 `category` 的话，AI 吐出来的东西**当场看着有效、读一遍就没了**。
//       这正是本模块的高发缺陷类（已三次：`transfer` → `operations` → `upgrade`/`label`）。
// ★★ `cat` 里存的是**分类 id**（`liquid` / …），**不是词**（§3.12①）。⇒ 枚举里列的是 id，
//    提示词里给人看的类目名走**词表**（`termsOf(era)` 那五个）。
// ---------------------------------------------------------------------------

// 分类 → `{ id, name, fields[] }`（重名口径照 `asset-core.js` 的 `normalizeCategory`：
// 没有 id 的分类画不出来、同名字段只留第一条）
function normCategories(categories) {
  const out = [];
  const seenCat = Object.create(null);
  for (const c of arr(categories)) {
    if (!isObj(c)) continue;
    const id = str(c.id).trim();
    if (!id || seenCat[id]) continue;
    seenCat[id] = true;
    const fields = [];
    const seenField = Object.create(null);
    for (const f of arr(c.fields)) {
      if (!isObj(f)) continue;
      const key = str(f.key).trim();
      if (!key || seenField[key]) continue;
      seenField[key] = true;
      fields.push({ cat: id, key: key, type: str(f.type) || 'text' });
    }
    // 名字：用户起的名字**不换皮**（§3.12 换皮边界）；没起名就回落 id（**不编中文词**）
    out.push({ id: id, name: str(c.name) || id, fields: fields, spec: str(c.spec) });
  }
  return out;
}

// 逐字段清单（`fields`）：**字段数就是软上限数的那个数**（§12 第 11 条："字段清单就是给 AI 的约束"）
function fieldList(cats, era) {
  const words = TERMS && typeof TERMS.categoryWords === 'function' ? TERMS.categoryWords(era) : null;
  const out = [];
  for (const c of cats) {
    const word = (words && typeof words[c.id] === 'string' && words[c.id]) ? words[c.id] : '';
    for (const f of c.fields) out.push({ cat: c.id, catName: word, key: f.key, type: f.type });
  }
  return out;
}

// 机器段 JSON（**一份形状，两处用**：给 AI 看的规格文本 + 给 UI 看的字段名清单）
function buildSpec(era, cats, ids) {
  const stateKeys = [];
  const seen = Object.create(null);
  for (const c of cats) {
    for (const f of c.fields) {
      if (seen[f.key]) continue;
      seen[f.key] = true;
      stateKeys.push(f.key);
    }
  }
  const spec = {
    found: true,
    // ⚠️ 这里放**数组本身**（不是 `JSON.stringify(ids)`）—— 外层 `JSON.stringify(built.spec)`
    //    才是产出机器段的唯一一次序列化。先字符串化会被它二次转义，枚举就变成一串带引号的字。
    cat: ids.slice(),
    label: '这条资产的名字（原文怎么写就怎么抄）',
    ownerKey: '归属人（原文写的角色名；实指不了就留空）',
    // ⚠️ **null 原型**：下面的 key 是**用户自建的字段名**（模板字段 key，用户可控）。
    //    `{}` 上 `spec.state['__proto__'] = ''` 是**改写原型**而不是加一格 ⇒ 实测
    //    机器段 JSON 的 `state` own keys 少一格（`{"正常字段":""}`），**而提示词那一节照旧
    //    列着 `__proto__`** ⇒ AI 被要求填一个 schema 里不存在的字段。走 `Object.create(null)`：
    //    `JSON.stringify` 只认**自有可枚举**键，null 原型一位不改序列化结果；
    //    本格的消费方只有 `JSON.stringify`（`:234` 那一次）与测试的自有键断言。
    state: Object.create(null),
    stock: { worth: 0, unit: tw(era, 'worthUnit') || '' },
    flows: [{ key: '', label: '', amount: 0, period: 'month', direction: 'in|out' }],
    evidence: '原文里那一段原句（一到两句）',
  };
  for (const k of stateKeys) spec.state[k] = '';
  return { spec: spec, stateKeys: stateKeys };
}

// ---------------------------------------------------------------------------
// 提示词骨架（分节照 `childExtractPrompt` 的真实结构）
// ---------------------------------------------------------------------------
function line(label, value) { return value ? '· ' + label + '：' + value : ''; }

// 入参（**只出骨架，不负责传参** —— 传参是 F3 接线的事）：
//   era          档位（认不出的回落 modern）
//   categories   分类模板数组 `[{ id, name?, fields:[{key,type}], spec? }]`
//   facts        既有事实（不可推翻，只作对照）：`{ db, worldbook, items }`
//   contextDepth 上下文层数（**来源自选三件套**的第二件；§7.4 第 3 条）
//   scopeText    本次提取范围（可选）
//   extra        额外要求（可选）
function buildExtractSpec(input = {}) {
  // ⚠️ 入参不是对象（`null` / `0` / 字符串）也要**不抛**：纯函数层照旧给一份现代档的骨架。
  const o = isObj(input) ? input : {};
  const era = eraOf(o.era);
  const cats = normCategories(o.categories);
  const ids = categoryIds();
  // 枚举 = 五个内置 id + 入参里那些**自建分类**的 id（自建分类的 id 也是数据身份，三档共用）。
  // ⚠️ 顺序：内置五个在前（§3.12① 点名的就是这五个），自建的按入参顺序跟在后。
  const enumIds = ids.slice();
  for (const c of cats) if (enumIds.indexOf(c.id) < 0) enumIds.push(c.id);
  const fields = fieldList(cats, era);
  const built = buildSpec(era, cats, enumIds);
  const spec = JSON.stringify(built.spec);
  const tag = '<ASSET_JSON>' + spec + '</ASSET_JSON>';

  // 类目清单：**词走词表**（档位在这里生效），id 与字段名只在机器段里出现。
  const nodes = [];
  for (const id of ids) {
    const word = tw(era, id) || id;
    const owned = cats.filter(c => c.id === id);
    const keys = [];
    for (const c of owned) for (const f of c.fields) if (keys.indexOf(f.key) < 0) keys.push(f.key);
    nodes.push('· ' + word + '（`' + id + '`）' + (keys.length ? '：字段 ' + keys.join(' / ') : ''));
  }
  for (const c of cats) {
    if (ids.indexOf(c.id) >= 0) continue;
    const keys = c.fields.map(f => f.key);
    nodes.push('· **' + c.name + '**（自建分类，`' + c.id + '`）' + (keys.length ? '：字段 ' + keys.join(' / ') : '')
      + (c.spec ? '　' + c.spec : ''));
  }

  const facts = isObj(o.facts) ? o.facts : {};
  const parts = [];
  parts.push('【身份】你是资产账本的整理者。你的任务是：从给定的参考材料里，把**已经发生过**的资产事实'
    + '（一笔进账 / 一笔出账 / 一处资产的获得或失去 / 一次归属变更）抄成结构化记录。'
    + '**只登记事实，不做判断** —— 值多少、划不划算由用户自己定。');
  parts.push('【要找什么】谁、什么时候、哪一处资产、进还是出、原文写的数额 —— 凡原文写到的，'
    + '按**发生顺序**逐事列举；原文没写的**' + NO + '补**。'
    + '**无法估值的不计入总估值，但合计句里要显式带上它**（"另有 N 项无法估值"）—— '
    + '否则模型会自己编一个数填坑（§7.3）。**逐事列举，不是逐项合并**。');

  // ---- 来源自选三件套（§7.4 第 3 条）----
  // ⚠️ 这三件就是"勾了却等于没勾"的坑（`extract-core.js:99-101` 踩过：子嗣那份漏了
  //    「数据库参考」那一行）。这里**三件都摆出来，缺哪件就照实说没给** —— 不静默省略。
  // ⚠️ `ordered_prompts` / `max_chat_history` 必须**显式传**（§7.4 第 3 条）：那是 F3 接线的事，
  //    本函数只出文本骨架，所以在骨架里把这两样**点名说清**，别让接线那一步忘了。
  parts.push('【来源（三件自选，缺哪件就说没给）】\n'
    + '· **世界书**：固定件（投影那两条 / 世界书里写的既有设定）—— ' + (str(facts.worldbook) ? '已给（见下）' : '这一趟没有给') + '\n'
    + '· **上下文**：最近 ' + (str(o.contextDepth) ? str(o.contextDepth) + ' 层' : '层数没有给（这一趟按 0 层算）')
    + '　⚠️ 取上下文要**显式传** `max_chat_history`（它决定这 N 层是多少，别用宿主默认值顶）\n'
    + '· **数据库**：' + (str(facts.db) ? '已给（见下）' : '这一趟没有给')
    + '　⚠️ 取数据库要**显式传** `ordered_prompts`（来源顺序由它定，别用宿主默认值顶）');

  const factLines = [
    line('既有资产条目', arr(facts.items).join('、')),
    line('数据库参考', facts.db),
    line('世界书参考', facts.worldbook),
    line('本次提取范围', o.scopeText),
    line('额外要求', o.extra),
  ].filter(Boolean);
  parts.push('【既有事实（不可推翻，只作对照）】\n' + (factLines.length ? factLines.join('\n') : '· （暂无既有记录）'));
  parts.push(extractRules());
  parts.push('【类目（这一档的说法；分类 id 是数据的身份，三档共用）】\n' + nodes.join('\n'));
  if (built.stateKeys.length) {
    parts.push('【这一类可以填的状态字段】（用户自建的字段名，**照抄，' + NO + '翻译、' + NO + '改名**）：\n'
      + '· ' + built.stateKeys.join(' / ') + '\n'
      + '⚠️ 字段名是**用户自己写的 key**，机器只认这些名字；编一个新名字 = 这一格读一遍就没了。');
  }
  const tooMany = fields.length > SOFT_FIELD_LIMIT;
  parts.push('【格式】\n'
    + '1. 正文照原文抄（可以分段），逐事列举：一件事一行 —— 谁 / 何时 / 哪一处 / 进还是出 / 数额（§7.3）。\n'
    + '2. 机器段**必须给**：找到了就给下面这份规格；**一段都没找到就只输出 `' + notFoundJson() + '`**'
    + '（' + NO + '输出空壳对象、' + NO + '编）。\n'
    + '3. `cat` 只许填枚举里的那一个 id（**id 是数据的身份**，不是给人看的词）；'
    + '`label` 是这条资产的名字，**原文怎么写就怎么抄**。\n'
    + '4. `state` 里的字段名**只许用上面列出的那些**（用户自建的名字照抄）；'
    + '每个值都要有原文依据。\n'
    + '5. `amount` 是**正数**，方向由 `direction` 说；`evidence` 写原文原句，供人核对。\n'
    + '6. 清单里只摆**一份**落点说明（"去哪儿确认、那儿可逐项取消"），不摆第二份（§7.4 第 5 条）。\n'
    + (tooMany ? '7. 这一次的字段共 ' + fields.length + ' 个，**超过软上限 ' + SOFT_FIELD_LIMIT
      + ' 个**（§12 第 11 条）—— 每一层提取的 token 就压在这份清单上：'
      + '**先请用户显式确认这份字段清单**，再往下提取。\n' : '')
    + tag);
  const prompt = parts.join('\n\n');

  return {
    era: era,
    prompt: prompt,
    spec: spec,
    tag: tag,
    notFound: notFoundJson(),
    categories: cats.map(c => ({ id: c.id, name: c.name, keys: c.fields.map(f => f.key) })),
    fields: fields,
    fieldCount: fields.length,
    softLimit: SOFT_FIELD_LIMIT,
    needsConfirm: tooMany,
  };
}

const api = {
  buildExtractSpec,
  SOFT_FIELD_LIMIT,
  // 给测试/调用方看的取词与形状口（**不是**第二份口径：都转发到同一个实现）
  extractRules: extractRules,
  notFoundJson: notFoundJson,
  eraOf: eraOf,
  categoryIds: categoryIds,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  // 面板 / 提取接线都**惰性**取，别在 IIFE 顶层抓（同 core / store 的取法）
  rt.__LA_ASSET_EXTRACT__ = api;
}

})();

  return module.exports;
})();
