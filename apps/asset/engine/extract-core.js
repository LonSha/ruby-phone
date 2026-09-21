/* ========================================================
 * extract-core.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/extract-core.js）
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
 * 【上游定位】extract-core.js
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
/* src/modules/extract/extract-core.js */
'use strict';

// =====================================================================
// 从正文提取（0.6.81）—— 医疗「提取就诊」与子嗣「提取子嗣」**共用一份实现**
// ---------------------------------------------------------------------
// 定位：这是一条**反方向**的能力 —— 生成是"往前写"，提取是"把已经发生过的读回来"。
//   · 正文里自己去了医院 / 复查 / 生了孩子，面板不知道 → 提醒一直挂着、数据缺席；
//   · 提取只做"搬运与归类"：**只从给定参考里找已经发生的事实，一个字都不编**。
// 纯函数层（不读存储、不碰 DOM）：提示词骨架 + 纪律 + 两份机器段规格 + found 判定 + 核对清单数据。
// 落盘（写报告 / 登记子嗣）由各模块自己的门去做，这里只给"读到什么"。
// =====================================================================

(() => {
  const runtime = (typeof window !== 'undefined') ? (window.parent || window) : globalThis;
  const str = v => (v == null ? '' : String(v));
  const arr = x => (Array.isArray(x) ? x : []);

  // 「只搬运不编造」——两个 kind 共用的纪律。措辞与 §10.1 的 RP 红线一脉相承。
  const EXTRACT_RULES = [
    '【这是"读回来"，不是"写下去"】',
    '· 只从上面给的参考里找**已经发生过**的事；参考里没有就照实说没有，**一个字都不许编**。',
    '· 时间 / 机构 / 科室 / 人物 / 药名一律**以参考原文为准**，不要套用任何默认值，也不要"顺手补全"。',
    '· 参考里没写清楚的字段**留空**（不要推断、不要猜、不要写成"未知"以外的编造内容）。',
    '· 不推进剧情、不新增事件、不改写既有记录 —— 你只是把已经写出来的东西抄成结构化字段。',
    '· 如果参考里有两段相似内容，按**发生时间**优先取最近的一段，并在 `evidence` 里写清依据原句。',
  ].join('\n');

  // 找不到时的机器段（**明说没有**，而不是返回一个空壳记录）
  const NOT_FOUND_JSON = '{"found":false}';

  const CLINIC_EXTRACT_SPEC = '<MED_JSON>{"found":true,"kind":"clinic",'
    + '"summary":"一两句结论（以原文为准，可以照抄原文的结论句）",'
    + '"meta":{"date":"YYYY-MM-DD（原文写的日期）","place":"机构名（原文写的）","registeredDept":"挂号科","actualDept":"实际就诊科","attendants":["接诊者"],"subjects":["受检者"],"escorts":[]},'
    + '"steps":[{"i":1,"close":{"dept":"科室","status":"pending|confirmed|ruled_out","dx":"这一科的诊断（原文有才写）","plan":["处置（原文有才写）"]},'
    + '"prescription":{"items":[{"drug":"药名","spec":"规格","dose":"一次用量","freq":"频次","days":0,"note":""}],"advice":"医嘱","followUp":"复诊"}}],'
    + '"findings":[{"subject":"受检者名","name":"病症规范名","category":"分类","severity":"mild|moderate|severe|critical","course":"acute|chronic|congenital|obstetric|injury","value":null,"unit":null,'
    + '"evidence":"原文里对应原句","suggest":"处置/建议","stepId":"s1","final":true}],'
    + '"vitals":[{"subject":"受检者名","name":"项目","value":"数值","unit":"单位"}],'
    + '"problems":[{"title":"问题名","status":"pending|confirmed|ruled_out","steps":["s1"],"next":"下一步"}]}</MED_JSON>';

  const CHILD_EXTRACT_SPEC = '<CHILD_JSON>{"found":true,'
    + '"gestating":"母体（正文里那位已生产的角色名）","birthDate":"YYYY-MM-DD（正文写的出生日；没写具体日期就留空）",'
    + '"children":[{"name":"孩子名（原文有才写）","sex":"female|male"}],'
    + '"evidence":"原文里那一段原句（一到两句）","note":"可选的补充（如是否明确写了早产/双胎）"}</CHILD_JSON>';

  // 0.6.103（阶段 D · 设计 §3.4 / §15 #4）：手术是**第三个 kind**。
  // 三条硬口径：
  //   ① **粒度三层**（§6.2 / 锁定规则 4）：`status`（状态 5 档）、`pagesDone`（**已发生的页**，可以跳着发生）、
  //      `opStage`（术中走到第几段）**分别给**，不许合成一个字段；
  //   ② `pagesDone` 用**页 id**（正典 id 是 `visit/consent/prepare/transfer/during/wake`，由调用方喂进来），
  //      不记序号 —— 跳页（只做了"术前准备 + 术中"）序号表达不了（§15 #4 已拍定）；
  //   ③ 反面内容（术者侧）**只可能来自用户手补**（§3.6）：正文通常跟角色视角，所以 `channels` 不向模型要。
  const SURGERY_EXTRACT_SPEC = '<MED_JSON>{"found":true,"kind":"surgery",'
    + '"procedureName":"术式名（原文怎么写就怎么抄，俗称也照抄）",'
    + '"intent":"therapeutic|emergency|obstetric|elective（判不出就给 therapeutic）",'
    + '"status":"planned|performed|recovering|recovered|complication",'
    + '"meta":{"date":"YYYY-MM-DD（原文写的行术日；只写到月就写 YYYY-MM）","place":"机构名（原文写的）","operator":"术者名（原文写的）",'
    + '"anesthesiaText":"原文怎么写的麻醉（如「全麻」）","subjects":["受术者"],"attendants":[]},'
    + '"pagesDone":["visit","consent","prepare","transfer","during","wake"],'
    + '"opStage":0,"opStageName":"原文写到的那一步（如「切皮」；原文没写就留空）",'
    + '"findings":[{"name":"术中或术后发现（原文写法）","severity":"mild|moderate|severe|critical","evidence":"原句"}],'
    + '"evidence":"原文里那一段原句（一到两句）","note":"可选的补充"}</MED_JSON>';


  function line(label, value) { return value ? '· ' + label + '：' + value : ''; }

  // 医疗：从参考里读回一次就诊（可以是别的机构、别的日期）
  function clinicExtractPrompt(input = {}) {
    const facts = (input.facts && typeof input.facts === 'object') ? input.facts : {};
    const parts = [];
    parts.push('【身份】你是医疗档案的整理者。你的任务是：从给定的参考材料里，把**已经发生过**的一次就诊抄成结构化记录。');
    parts.push('【要找什么】挂号 / 分诊 / 候诊 / 问诊 / 查体 / 开单检查 / 回诊看结果 / 处置开药 / 医嘱 —— 凡原文写到的，按发生顺序抄下来；'
      + '原文没写的环节**不要补**（宁可只有两三步）。**可以在另一家机构**（以原文为准）。');
    const factLines = [
      line('已知人物', arr(facts.subjects).map(s => (s && s.text) || s).join('；')),
      line('当前在记病症', arr(facts.conditions).join('、')),
      line('身体档案', arr(facts.body).join('、')),
      line('数据库参考', facts.db),
      line('本次提取范围', input.scopeText),
      line('额外要求', input.extra),
    ].filter(Boolean);
    parts.push('【既有事实（不可推翻，只作对照）】\n' + (factLines.length ? factLines.join('\n') : '· （暂无既有记录）'));
    parts.push(EXTRACT_RULES);
    parts.push('【格式】\n'
      + '1. 正文按 `[环节] 在做什么 · 科室 · 人 · 地点` 分段（后三段可省），顺序即事实；段内用 `[问]`/`[答]`/`[查]`/`[案]`/`[景]` 标记照原文抄录。\n'
      + '2. 机器段**必须给**：找到了就给下面这份规格；**一段都没找到就只输出 `' + NOT_FOUND_JSON + '`**（不要输出空壳对象、不要编）。\n'
      + '3. 每条结论/数值都要带 `evidence`（原文原句），供人核对。\n'
      + CLINIC_EXTRACT_SPEC);
    return parts.join('\n\n');
  }

  // 子嗣：从参考里读回"已经出生的孩子"（只登记事实，不做医学结算）
  function childExtractPrompt(input = {}) {
    const facts = (input.facts && typeof input.facts === 'object') ? input.facts : {};
    const parts = [];
    parts.push('【身份】你是家族档案的整理者。你的任务是：从给定的参考材料里，把**已经发生过的生育事实**抄成结构化记录。');
    parts.push('【要找什么】谁生了孩子、生了几个、孩子的名字与性别、出生日期（原文写了才写）。'
      + '**只登记事实，不做医学判断**（不写体重 / 早产 / 健康状况——原文没写就不写）。');
    const factLines = [
      line('已知角色', arr(facts.roles).join('、')),
      line('已知子嗣', arr(facts.children).join('、')),
      // 数据库参考（0.6.91）：医疗那份（clinicExtractPrompt）本来就有这一行，子嗣这份漏了 ——
      // 于是生育提取弹窗勾「数据库」等于没勾（提示词读的就是 `facts.db`）。
      line('数据库参考', facts.db),
      line('本次提取范围', input.scopeText),
      line('额外要求', input.extra),
    ].filter(Boolean);
    parts.push('【既有事实（不可推翻，只作对照）】\n' + (factLines.length ? factLines.join('\n') : '· （暂无既有记录）'));
    parts.push(EXTRACT_RULES);
    parts.push('【格式】\n'
      + '1. 机器段**必须给**：找到了就给下面这份规格；**没找到生育事实就只输出 `' + NOT_FOUND_JSON + '`**（不要编）。\n'
      + '2. `gestating` 与 `birthDate` 是落盘的**必需字段**：原文没写清就**留空**（留空 = 不落盘，只把读到的事实列给人看）。\n'
      + '3. `evidence` 写原文原句。\n'
      + CHILD_EXTRACT_SPEC);
    return parts.join('\n\n');
  }

  // 手术：从参考里读回**一台已经做过的手术**（阶段 D · 0.6.103）。
  // `opts.pageOptions` = `[{id,name}]`（正典页表，由调用方从 core 取）、`opts.stageOptions` = `[{id,name,atText}]`
  //（**术式已知时**才给得到 —— 术式名要先由模型判出来，所以阶段那一段写成"判不出就给 0"）。
  function surgeryExtractPrompt(input = {}) {
    const facts = (input.facts && typeof input.facts === 'object') ? input.facts : {};
    const pageOptions = arr(input.pageOptions);
    const stageOptions = arr(input.stageOptions);
    const parts = [];
    parts.push('【身份】你是医疗档案的整理者。你的任务是：从给定的参考材料里，把**已经发生过的一台手术**'
      + '（正文里写到的开刀 / 手术 / 施术）抄成结构化记录。');
    parts.push('【要找什么】术前谈话 / 签字画押 / 备皮禁食 / 接送进手术室 / 术中 / 出室苏醒 / 术后医嘱 —— '
      + '凡原文写到的，按发生顺序抄下来；原文没写的环节**不要补**（宁可只有一两段）。'
      + '**可以在另一家机构、另一个日期**（以原文为准）。');
    const factLines = [
      line('已知人物', arr(facts.subjects).map(s => (s && s.text) || s).join('；')),
      line('当前在记病症', arr(facts.conditions).join('、')),
      line('已知术式库条目', arr(facts.procedures).join('、')),
      line('数据库参考', facts.db),
      line('本次提取范围', input.scopeText),
      line('额外要求', input.extra),
    ].filter(Boolean);
    parts.push('【既有事实（不可推翻，只作对照）】\n' + (factLines.length ? factLines.join('\n') : '· （暂无既有记录）'));
    parts.push(EXTRACT_RULES);
    // 三层分别判定 —— 这一段是本 kind 的关键，措辞直接对着锁定规则 4。
    parts.push('【必须分别判定三层，不许合成一个字段】（合成一个就表达不了「已行术但仍在恢复中、术中只走到第 5 段」）\n'
      + '① **状态** `status`：`planned` 只安排了还没做 / `performed` 已经做了 / `recovering` 术后恢复中 / '
      + '`recovered` 已愈 / `complication` 出了并发症。'
      + '**做到一半就断在术中也算 `performed`** —— 走到哪一步由 ② ③ 说（别为了"还没做完"而写成 `planned`）。\n'
      + '② **已发生的页** `pagesDone`（**可以跳着发生**，只列原文真的写到的那几页）：\n'
      + (pageOptions.length
        ? pageOptions.map(p => '   · `' + str(p.id) + '` = ' + str(p.name)).join('\n')
        : '   · （页表未提供）') + '\n'
      + '③ **术中阶段** `opStage`：术程走到第几段（**从 1 数**；判不出就给 `0`）。'
      + '另外用 `opStageName` **照抄原文写到的那一步**（例如「切皮」「探查」「关腹」）—— '
      + '阶段表由术式库给，你没拿到表也没关系：照抄原名，机器去对表。\n'
      + (stageOptions.length
        ? ('   这台术式的阶段表（按顺序，供你数 `opStage`）：' + stageOptions.map((s, i) => (i + 1) + '.' + str(s.name)).join(' → '))
        : '   这次**没给**术式阶段表（术式名还没判出来 / 库里没有这个术式）→ `opStage` 给 0，但 `opStageName` 仍要照抄。'));
    parts.push('【格式】\n'
      + '1. 正文照原文抄（可以分段）：原文是第几人称就保留第几人称，不要改写成通稿。\n'
      + '2. 机器段**必须给**：找到了就给下面这份规格；**一段都没找到就只输出 `' + NOT_FOUND_JSON + '`**（不要输出空壳对象、不要编）。\n'
      + '3. `meta.date` 与 `procedureName` 是落盘的**必需字段**：原文没写清就**留空**（留空 = 不落盘，先让人核对补齐）。\n'
      + '4. **不要**写术者侧的反面内容（术程记录 / 清点 / 隐瞒）——正文跟角色视角时根本读不到，那是用户手补的活。\n'
      + '5. 每条结论都要带 `evidence`（原文原句），供人核对。\n'
      + SURGERY_EXTRACT_SPEC);
    return parts.join('\n\n');
  }

  // 核对清单的**字段数据**（阶段 D）：一份数据同时供"渲染 / 校验 / 落盘"三处用 ——
  // 不另写一份只读版本（两个模板必然漂移，见 `sillytavern-embedded-ui` 的"one builder"）。
  const FIELD_KINDS = ['text', 'select', 'pages'];
  function surgeryExtractFields(json, opts = {}) {
    const j = (json && typeof json === 'object') ? json : {};
    const meta = (j.meta && typeof j.meta === 'object') ? j.meta : {};
    const pages = arr(j.pagesDone).map(str).filter(Boolean);
    const findings = arr(j.findings);
    const chosen = arr(opts.intents).map(x => ({ id: str(x.id), name: str(x.name) }));
    const statuses = arr(opts.statuses).map(x => ({ id: str(x.id), name: str(x.name) }));
    const stageOptions = arr(opts.stages).map((x, i) => ({ id: String(i + 1), name: str(x.name) || ('第 ' + (i + 1) + ' 段') }));
    const fields = [
      { key: 'date', label: '行术日', value: str(meta.date), kind: 'text', required: true,
        hint: '原文没写就留空 —— 留空不会落盘（不拿今天顶替）' },
      { key: 'procedureName', label: '术式', value: str(j.procedureName), kind: 'text', required: true,
        hint: '原文怎么写就怎么抄；库里没有也能落盘，只是术式库给出的分级 / 恢复期 / 映射会缺席' },
      { key: 'place', label: '机构', value: str(meta.place), kind: 'text' },
      { key: 'operator', label: '术者', value: str(meta.operator), kind: 'text' },
      { key: 'anesthesiaText', label: '麻醉', value: str(meta.anesthesiaText), kind: 'text' },
      { key: 'intent', label: '意图', value: str(j.intent) || 'therapeutic', kind: 'select', options: chosen },
      { key: 'status', label: '状态', value: str(j.status) || 'planned', kind: 'select', options: statuses },
      { key: 'pagesDone', label: '已发生的页', value: pages.join(','), kind: 'pages', options: arr(opts.pages), multi: true,
        hint: '可以跳着选（只做了「术前准备 + 术中」就只勾这两页）' },
      { key: 'opStage', label: '术中走到', value: String(numOr0(j.opStage)), kind: 'select',
        hint: str(j.opStageName) ? ('原文写的是「' + str(j.opStageName) + '」—— 机器按术式库的阶段表对位；对不上就按你选的这一段记') : '',
        options: [{ id: '0', name: '判不出 / 未行术' }].concat(stageOptions) },
      { key: 'findings', label: '术中·术后发现', value: findings.map(f => str(f && f.name)).filter(Boolean).join('、'), kind: 'text' },
      { key: 'evidence', label: '依据（原文）', value: str(j.evidence), kind: 'text' },
    ];
    if (str(j.note)) fields.push({ key: 'note', label: '补充', value: str(j.note), kind: 'text' });
    return fields.map(f => Object.assign({}, f, { kind: FIELD_KINDS.indexOf(f.kind) >= 0 ? f.kind : 'text' }));
  }
  function numOr0(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  // 逐字段**来源标记**（§3.4 的三档，纯函数）：
  //   · 用户没动 → `原文抄录`（模型从原文抄的）
  //   · 模型没给、用户填了 → `用户补充`
  //   · 用户改了模型给的值 → `用户修改`
  // ⚠️ 这三档不是装饰：落盘后写进报告的 `surgery.extracted.sources`，**下一轮 AI 整理不许覆盖标了用户的字段**。
  function fieldSource(aiValue, userValue) {
    const a = str(aiValue).trim();
    const u = str(userValue).trim();
    if (!u) return '原文抄录';
    if (!a) return '用户补充';
    return a === u ? '原文抄录' : '用户修改';
  }
  // 能不能落盘（必需字段齐不齐）—— 与子嗣那份同一条口径：**缺必需字段就不落盘**，只在清单里说清缺什么
  function surgeryExtractReady(json) {
    const j = (json && typeof json === 'object') ? json : {};
    const meta = (j.meta && typeof j.meta === 'object') ? j.meta : {};
    const missing = [
      !str(j.procedureName).trim() ? '术式' : '',
      !str(meta.date).trim() ? '行术日' : '',
    ].filter(Boolean);
    return { ok: missing.length === 0, missing: missing };
  }
  // 把清单里的**用户编辑合并回机器段**（§3.4「清单可补可改」）—— 纯函数，返回 `{ json, sources, changed }`。
  // 字段 → 机器段路径的映射**只写在这一处**：UI 只认 `key`，不认路径（否则加一个字段就要改三处）。
  function applyExtractEdits(json, fields, edits) {
    const j = JSON.parse(JSON.stringify(json && typeof json === 'object' ? json : {}));
    const e = (edits && typeof edits === 'object') ? edits : {};
    if (!j.meta || typeof j.meta !== 'object') j.meta = {};
    const sources = {};
    const changed = [];
    for (const f of arr(fields)) {
      const key = str(f && f.key);
      if (!key) continue;
      const aiValue = str(f.value);
      const touched = Object.prototype.hasOwnProperty.call(e, key);
      const userValue = touched ? str(e[key]) : aiValue;
      sources[key] = fieldSource(aiValue, touched ? userValue : '');
      if (userValue === aiValue) continue;          // 没改 → 机器段原样
      changed.push(key);
      if (key === 'date' || key === 'place' || key === 'operator' || key === 'anesthesiaText') { j.meta[key] = userValue; continue; }
      if (key === 'pagesDone') {
        j.pagesDone = userValue.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean);
        continue;
      }
      if (key === 'findings') {
        const prev = arr(j.findings);
        const byName = {};
        for (const f0 of prev) if (str(f0 && f0.name)) byName[str(f0.name)] = f0;
        j.findings = userValue.split(/[、,，]+/).map(s => s.trim()).filter(Boolean)
          .map(name => Object.assign({ name: name }, byName[name] || {}));
        continue;
      }
      if (key === 'opStage') { j.opStage = Number(userValue) || 0; continue; }
      j[key] = userValue;                            // procedureName / intent / status / evidence / note
    }
    return { json: j, sources: sources, changed: changed };
  }

  // 解析结果：`split` 是 medical-core 的 splitMedResponse 产物（各模块共用同一条解析路径）。  // ⚠️ 0.6.81 真 Chromium 抓到的坑：`{"found":false}` **不符合"医疗报告"的形状**，共享解析器会判
  // `ok:false`（"JSON 不是对象"）—— 于是"模型照实说没找到"会被显示成"解析失败"（误导，且掩盖了正常的
  // 保守回落）。所以这里**同时看原始文本**：只要文本里有 `found:false`，就是一次正当的"没有"。
  function extractJson(split, rawText) {
    const j = (split && split.json && typeof split.json === 'object') ? split.json : null;
    if (j) {
      if (j.found === false) return { found: false, json: j };
      // 0.6.103：实体键要把**手术**那一套也算进来（`procedureName` / `pagesDone` / `opStage` / `status`）——
      // 漏了的话 `found:true` 会被当成"没找到"（设计 §3.4 专门点了这条）。
      if (j.found !== true && !j.name && !j.gestating && !arr(j.children).length && !arr(j.findings).length && !arr(j.steps).length
        && !str(j.procedureName) && !arr(j.pagesDone).length && !Number(j.opStage)) {
        return { found: false, json: j };   // 既没写 found，也没有任何实体 → 当没找到（保守）
      }
      return { found: true, json: j };
    }
    const raw = str(rawText != null ? rawText : (split && (split.body || split.raw || split.text)));
    if (/["']?found["']?\s*:\s*false/i.test(raw)) return { found: false, json: { found: false }, recoveredFromRaw: true };
    return null;
  }

  // 核对清单（**先清单后落盘**）：把"读到了什么"变成可读的行，UI 只负责排版
  function clinicChecklist(json, opts = {}) {
    const j = (json && typeof json === 'object') ? json : {};
    const meta = (j.meta && typeof j.meta === 'object') ? j.meta : {};
    const steps = arr(j.steps);
    const findings = arr(j.findings);
    const vitals = arr(j.vitals);
    const problems = arr(j.problems);
    const rows = [];
    rows.push({ label: '日期', value: str(meta.date) || '（原文没写）' });
    rows.push({ label: '机构', value: str(meta.place) || '（原文没写）' });
    rows.push({ label: '科室', value: [str(meta.registeredDept), str(meta.actualDept)].filter(Boolean).join(' → ') || '（原文没写）' });
    rows.push({ label: '受检者', value: arr(meta.subjects).join('、') || '（原文没写）' });
    rows.push({ label: '接诊者', value: arr(meta.attendants).join('、') || '（原文没写）' });
    rows.push({ label: '环节', value: steps.length ? (steps.length + ' 步：' + steps.map(s => '第' + str(s && s.i) + '步').join(' / ')) : '（原文没写环节，按整段正文抄录）' });
    const closes = steps.filter(s => s && s.close).map(s => (str(s.close.dept) || '一科') + '：' + (str(s.close.dx) || '（未写诊断）'));
    if (closes.length) rows.push({ label: '各科收口', value: closes.join('；') });
    const rx = arr(steps).filter(s => s && s.prescription && arr(s.prescription.items).length)
      .map(s => arr(s.prescription.items).map(x => str(x.drug)).filter(Boolean).join('、'));
    if (rx.length) rows.push({ label: '处方', value: rx.join('；') });
    if (findings.length) rows.push({ label: '发现', value: findings.length + ' 条：' + findings.map(f => str(f && f.name)).filter(Boolean).join('、') });
    if (vitals.length) rows.push({ label: '数值', value: vitals.length + ' 项：' + vitals.map(v => str(v && v.name)).filter(Boolean).join('、') });
    if (problems.length) rows.push({ label: '问题', value: problems.map(p => str(p && p.title)).filter(Boolean).join('、') });
    rows.push({ label: '结论', value: str(j.summary) || '（原文没写）' });
    if (opts.warn) rows.push({ label: '注意', value: str(opts.warn), warn: true });
    return rows;
  }

  function childChecklist(json, opts = {}) {
    const j = (json && typeof json === 'object') ? json : {};
    const kids = arr(j.children);
    const rows = [];
    rows.push({ label: '母体', value: str(j.gestating) || '（原文没写 → 不能落盘）', warn: !str(j.gestating) });
    rows.push({ label: '出生日期', value: str(j.birthDate) || '（原文没写 → 不能落盘）', warn: !str(j.birthDate) });
    rows.push({
      label: '孩子',
      // 性别没写就**照实说没写**（落盘时数据模型只有 male/female，会按「女」登记 —— 这一点必须在清单里说清，
      // 否则等于用"默认值"编了一条原文没有的事实）
      value: kids.length ? kids.map(k => str(k && k.name) || '（未写名字）').join('、') + '　性别：'
        + kids.map(k => ((k && k.sex) === 'male' ? '男' : ((k && k.sex) === 'female' ? '女' : '（未写 → 按女登记）'))).join('、') : '（原文没写）',
    });
    if (str(j.note)) rows.push({ label: '补充', value: str(j.note) });
    if (str(j.evidence)) rows.push({ label: '依据', value: str(j.evidence) });
    if (opts.warn) rows.push({ label: '注意', value: str(opts.warn), warn: true });
    return rows;
  }

  // 能不能落盘（必需字段齐不齐）——各模块的"保守回落"判据
  function childExtractReady(json) {
    const j = (json && typeof json === 'object') ? json : {};
    const kids = arr(j.children).filter(k => k && (str(k.name) || k.sex));
    return {
      ok: !!str(j.gestating) && !!str(j.birthDate) && kids.length > 0,
      missing: [
        !str(j.gestating) ? '母体' : '',
        !str(j.birthDate) ? '出生日期' : '',
        !kids.length ? '孩子' : '',
      ].filter(Boolean),
      children: kids,
    };
  }

  // 疑似重复（幂等提示用）：把"日期 + 机构"归一成一把钥匙
  function sameOccasionKey(date, place) {
    const d = str(date).trim();
    const p = str(place).trim();
    return (d || p) ? (d + '|' + p) : '';
  }

  const api = {
    EXTRACT_RULES, NOT_FOUND_JSON, CLINIC_EXTRACT_SPEC, CHILD_EXTRACT_SPEC, SURGERY_EXTRACT_SPEC,
    clinicExtractPrompt, childExtractPrompt, surgeryExtractPrompt, extractJson,
    clinicChecklist, childChecklist, childExtractReady, sameOccasionKey,
    // 0.6.103（阶段 D）
    surgeryExtractFields, surgeryExtractReady, fieldSource, applyExtractEdits,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') runtime.__LA_EXTRACT__ = api;
})();

})();

  return module.exports;
})();
