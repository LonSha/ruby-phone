#!/usr/bin/env node
/* ============================================================
 * RubyPhone 零消费导出门禁（dead-export gate）
 * ------------------------------------------------------------
 * 为什么存在（本仓反复出现的病）：
 *   v2.12 首 chunk 屏障、v2.26/2.27 运行时登记制、v2.34 重复存活域、
 *   v2.35 对外世界桥、v2.38 世界书随机、v2.39 群聊发言调度 —— 六个版本
 *   都在治同一件事：「内核建好了、导出挂出来了、产品端零消费」。
 *   每次都是事后侦察、事后补接线，**没有任何门禁能拦住新的一例**。
 *   导出一个纯函数不报错、不测试失败、不崩界面，它只是静静地不被调用；
 *   而单元测试恰恰只测这个纯函数本身，于是 100% 覆盖、0 功能。
 *
 * 本门禁把这份「消费契约」变成发布前的硬约束：
 *   E1 每个 export 必须至少被消费一次（本模块内部或其它产品文件）；
 *   E2 未消费的导出必须显式登记在基线账本 scripts/dead-export-baseline.json；
 *   E3 基线是**冻结账本**：新增未消费导出即红灯（禁止静默腐烂）；
 *   E4 基线条目若已被消费（或已被删除）属「账本腐坏」，仅提示不判错
 *      （漏报比误报更伤；清理账本是洁癖而非缺陷，不应阻塞发布）；
 *   E5 结构健康标记：扫描面低于下限即 exit 2（防探测器失效后以全绿通过）。
 *   E9（v2.45.0）枚举面**完整性**必须由门禁自证，而不是靠逐个补语法：
 *      E7（跨行块）与 E8（解构转出）本是**同一缺口类别的两个个案**——某条抽取路径没覆盖某种
 *      写法 ⇒ 该写法导出的名字在门禁眼里根本不存在 ⇒ 不报红灯也不进账本（fail-open 静默放行）。
 *      补掉两个个案，**类别本身依然无守卫**：下一次用上新写法，同样的静默漏面会原样重演。
 *      本版判据：把真代码里每条 `export` 语句与既有抽取路径硬挂钩——**凡未被任一路径命中的语句，
 *      一律 fail-closed**（exit 2 拒判）。不预见更多语法，只**拒绝**预见不到的语法：
 *      新增写法要么补抽取路径、要么进 UNHANDLED_ALLOWLIST 并写明「为什么没有具名成员可对账」。
 *      实测现场：179 文件 / 566 条导出语句全部被识别（未识别 0），故本版不改扫描面、不引入新债务，
 *      只把「已经成立的事实」变成「跑不掉的门槛」。
 *   E8（v2.44.0）导出枚举必须覆盖**解构转出**与**枚举源**两处缺口，二者后果同一（名字在门禁
 *      眼里根本不存在 ⇒ 不报红灯也不进账本，fail-open 静默放行）：
 *      ① `export const { A, B } = expr;`（对象/数组解构，可跨行）此前**整块 0 枚举**——DECL_RE
 *         只认 `const NAME`，`const {` 直接落下。实测 apps/phone/status-tracker.js:286 转出 5 个
 *         名字全是隐形，而该模块除测试外零引用＝产品端零消费，正是本仓最典型的欠债形态。
 *      ② 枚举此前跑在**原文**上，被注释掉的 `export { ... };` 备份块会把并不存在的名字算作
 *         本模块真实导出（幽灵导出）。修法：枚举与消费判定共用**同一份真代码**——
 *         「判据的输入面与结论面必须是同一件事」。
 *   E7（v2.43.0）导出枚举必须覆盖 `export { ... }` 的**跨行**写法：此前单行正则让多行块整块
 *      0 枚举，块内死导出既不报红灯也不进账本（fail-open 静默放行）。配套：`声明行` 不等于
 *      `export 行`——`function X(){} export { X }` 中 X 的声明行不含消费，须一并跳过，
 *      否则「零消费的真死导出」会被它自己的声明行伪装成「内部消费」；跨行 `export {}` 还要跳过
 *      **整个语句区间**——成员行 `a,` / `b,` 本身也含名字，只跳首行会把块内每个名字都算成已消费。
 *   E7（v2.43.0）导出枚举必须覆盖 `export { ... }` 的**跨行**写法：此前单行正则让多行块整块
 *      0 枚举，块内死导出既不报红灯也不进账本（fail-open 静默放行）。配套：`声明行` 不等于
 *      `export 行`——`function X(){} export { X }` 中 X 的声明行不含消费，须一并跳过，
 *      否则「零消费的真死导出」会被它自己的声明行伪装成「内部消费」；跨行 `export {}` 还要跳过
 *      **整个语句区间**——成员行 `a,` / `b,` 本身也含名字，只跳首行会把块内每个名字都算成已消费。
 *   E6（v2.42.0）消费判定必须**基于真代码**：剔除注释与字符串字面量后再做词匹配。
 *      此前用裸词正则扫全文，**注释/字符串里提一嘴就算「已消费」**——真死导出
 *      被一句 `// TODO: eventually call X` 掩盖，门禁静默放过（假阴性）。
 *      本仓最危险的是漏报（漏报比误报更伤），故 E6 修的是「探测器的诚实度」。
 *
 * 消费域定义（谁算消费）：
 *   · 测试（tests/**）**不算**消费 —— 只有测试引用 = 产品端零消费，
 *     这正是本仓六次欠债的共同形态（floor-store 仅测试引用即此例）；
 *   · 外部平台消费域（assets/vendor/**、workers/**）整体豁免：前者是
 *     第三方库的对外 API 面，后者是 Cloudflare Worker 平台入口，二者
 *     的消费者都不在本仓库内，门禁无从观测。
 *
 * 用法：
 *   node scripts/dead-export-check.mjs              # 校验（CI/发布门）
 *   node scripts/dead-export-check.mjs --list       # 列出当前未消费导出
 *   node scripts/dead-export-check.mjs --update     # 重写基线账本（显式、会打印 diff）
 *   node scripts/dead-export-check.mjs --root <dir> # 校验指定目录（负控制测试用）
 * 退出码：0=通过  1=存在未登记的新零消费导出  2=结构漂移（探测器失效）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0
  ? path.resolve(args[rootIdx + 1] || '.')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listMode = args.includes('--list');
const updateMode = args.includes('--update');

if (rootIdx >= 0 && !fs.existsSync(root)) {
  console.error(`✗ --root 指向不存在的路径: ${root}`);
  process.exit(2);
}

// 测试不作为消费方（只有测试引用 = 零消费，本仓最典型的欠债形态）
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'tests']);
// 夹具通道：单测塞合成小仓库时放宽结构下限（与 lonsha scan_module_wiring 同款做法）
const FIXTURE_MODE = process.env.RP_DEAD_EXPORT_FIXTURE === '1';
// 外部平台消费域：消费者不在本仓库内，门禁无从观测
const EXTERNAL_CONSUMER_DIRS = ['assets/vendor/', 'workers/'];
const BASELINE_REL = 'scripts/dead-export-baseline.json';
// 结构健康下限（v2.40 实测：产品侧 export 声明数约 1000+；低于 500 说明抽取器坏了）
const MIN_EXPORTS = FIXTURE_MODE ? 1 : 500;

function* walk(dir, base = '') {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(abs, rel);
    else if (/(\.js|\.mjs)$/.test(ent.name)) yield { abs, rel };
  }
}

// 导出名抽取：export function/const/let/var/class NAME + export { A, B as C }
// 刻意不处理 `export default`（默认导出常用于平台入口/单例，无稳定名字可对账）
//
// v2.43.0（E7）: `export { ... }` 必须支持**跨行**。此前用一个单行正则 `export\s*\{([^}]*)\}`，
//   于是 `export {\n  a,\n  b,\n};` 这种多行写法**整块 0 枚举**——文件里声明的导出在门禁眼里
//   根本不存在，其中的死导出既不报红灯、也不进账本（fail-open 静默放行）。
//   实测现场：config/drives-engine.js 真实导出 7 项，门禁只枚举到 1 项（多行块里的 6 项全隐形）；
//   夹具复现：导出 2 项（1 真消费 + 1 真死）的多行块文件被报成「0 个 export 声明」并 exit 0。
//   修法：见到 `export {` 即向后累积到 `}`，再按同一套分段逻辑取键。
// 导出名抽取：export function/const/let/var/class NAME + export { A, B as C }（可跨行）
//             + export const { A, B } = expr（对象/数组解构转出，可跨行）
// 刻意不处理 `export default`（默认导出常用于平台入口/单例，无稳定名字可对账）
//
// v2.44.0（E8）：两处枚举缺口，形态不同、后果同一——**导出的名字在门禁眼里根本不存在**，
//   于是既不报红灯、也进不了账本（fail-open 静默放行）。
//   ① 解构转出：`export const { A, B } = expr;` 此前**整块 0 枚举**（DECL_RE 只认 `const NAME`，
//      `const {` 直接落下）。实测 apps/phone/status-tracker.js:286 转出 5 个名字全是隐形，
//      而该模块除测试外零引用＝产品端零消费，属本仓最典型的欠债形态，却无人报警。
//   ② 枚举源：枚举此前跑在**原文**上，被注释掉的 `export { ... };` 备份块会把并不存在的名字
//      当成本模块的真实导出（幽灵导出）。修法：枚举与消费判定共用**同一份真代码**——
//      「判据的输入面与结论面必须是同一件事」；剥离只可能让注释里的伪声明消失，方向安全。
//
// v2.43.0（E7）: `export { ... }` 必须支持**跨行**。此前用一个单行正则 `export\s*\{([^}]*)\}`，
//   于是 `export {\n  a,\n  b,\n};` 这种多行写法**整块 0 枚举**——文件里声明的导出在门禁眼里
//   根本不存在，其中的死导出既不报红灯、也不进账本（fail-open 静默放行）。
//   实测现场：config/drives-engine.js 真实导出 7 项，门禁只枚举到 1 项（多行块里的 6 项全隐形）；
//   夹具复现：导出 2 项（1 真消费 + 1 真死）的多行块文件被报成「0 个 export 声明」并 exit 0。
//   修法：见到 `export {` 即向后累积到 `}`，再按同一套分段逻辑取键。
const DECL_RE = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
// v2.44.0（E8）: `export const { A, B } = expr` / `export let [a, b] = x`（解构转出，可跨行）
const DESTRUCT_RE = /^\s*export\s+(?:const|let|var)\s*([\[{])/;
/* v2.45.0（E9）: 枚举面完整性自证 —— 与上面两条正则**一一对应**的「单行抽取路径」表。
 *   判定纪律：真代码里每条 `export` 语句都必须被下表中任一条命中，或命中独立的
 *   `export {` 块路径（源码里那个 `/^\s*export\s*\{/`），否则 fail-closed（exit 2）。
 *   为什么必须显式写出来：E7/E8 的漏面之所以能长期潜伏，正是因为「抽取路径」散落在
 *   代码里、没有任何一处能回答「一共认得几种写法」。此表就是那份可回答的清单——
 *   **新增抽取路径必须同步登记**，否则测试节的锁会立刻失败（见 UNHANDLED_ALLOWLIST 下方断言）。 */
const HANDLED_LINE_PATHS = [
  { kind: 'block', re: /^\s*export\s*\{/ },   // `export { A, B }` / `export { A as B } from ...`
  { kind: 'decl', re: DECL_RE },               // `export function|const|let|var|class NAME`
  { kind: 'destruct', re: DESTRUCT_RE }        // `export const { A, B } = expr`
];
/* 未处理 export 语句的**白名单**（必须写明「为什么没有具名成员可对账」，且逐条给例子）。
 *   当前唯一准入项是 `export default`——本门禁对它的立场是「刻意不处理」而非「不认识」。
 *   ⚠️ 白名单是准入闸，不是放行条：往这里加任何别的东西，等同于承认「这类导出不受门禁约束」，
 *   必须同时说明为何不可能有具名消费方可对账，并由测试节的锁逐条复核。
 *   ⚠️ 数字与形态都必须如实：此前注释写「全仓 61 处，均在平台入口/单例位」（v2.45.0 写就），
 *   v2.68.0 实测已是 **90 处**，而且**形态远超当初的假设**。
 *   **数字会随新增模块漂移，每次漂移都必须在此如实核销其构成**（而不是只改数字）：
 *     · v2.68.0、v2.73.0 实测均为 90；
 *     · v2.99.0 实测 **95**，增量 +5 经逐个核对：本版新增的 5 个文件
 *       各自有 1 处 `export default`（config/back-guard.js 对象 · config/source-key-rules.js 对象 ·
 *       apps/diagnose/diagnose-data.js 对象 · diagnose-view.js 裸标识符 · diagnose-app.js 裸标识符），
 *       形态全落在下述①②两类（无具名成员可对账），不涉及新的边界外情形。逐条查清的现状是三类：
 *     ① **裸标识符 60 处 + 单行对象字面量 8 处**（`export default AssetApp;`、
 *        `export default { a, b };`）——确实无具名成员可对账，白名单名副其实；
 *     ② IIFE 13 处（`export default (function () { … })()`，集中在 apps/asset/engine/）——
 *        同上；
 *     ③ **多行对象字面量 9 处**（apps/cheat/cheat-data.js 18 成员、apps/dirtytalk/dt-data.js
 *        26 成员、config/world-bridge.js 10 成员、apps/health/medical-core.js 8 成员…）
 *        ——这些成员名其实是**稳定且有具名的**，把它们一并放行属本白名单的**边界外覆盖**。
 *   为什么 ③ **不**纳入导出枚举（v2.68.0 的理由，v2.73.0 实测**部分证伪**）：
 *     成员是 default 对象的**属性名**、不是模块导出名，本枚举器（只抽模块导出名）确实不该收
 *     —— 这一半成立；但当时据以拒绝的**代价判断错了**。原文写「消费形态是 `import M from
 *     './m.js'; M.A`，要准确判定必须解析 default 导入的绑定名，属另一量级的静态分析（需数据
 *     流）」；v2.73.0 实测指向这些模块的 **default 导入点为 0**，成员消费**全走具名 import**，
 *     指向它们的 `.default` 访问**只出现在测试里** ⇒ **可静态对账、不需要数据流分析**。
 *     v2.73.0 据此新增 **E11（default 面的消费通道对账，见下）**：属性名仍不进导出枚举
 *     （分工不变），但 default 面的**消费通道**另立判据并逐条对账进 TEST_ONLY_DEFAULT_LEDGER。
 *     故 ③ 已不再属于「边界外覆盖」——边界说明保留在此，账目由 E11 承担。
 *   E10（v2.68.0）**条目存活自证**：白名单里每一条都必须在真仓库里至少认领到 1 条语句，
 *   否则它已不指向任何真实存在的东西——继续留着就是为「不存在的情形」背书（幽灵放行条）。
 *   与 lifecycle 的「派生前提消失即 fail-closed」同族：准入清单的合法性来自「它确实在放行某物」。 */
const UNHANDLED_ALLOWLIST = [
  { label: 'export-default', re: /^\s*export\s+default\b/,
    why: '默认导出无稳定名字可对账（平台入口/单例位），故不进导出枚举；其上的具名成员不在此放行范围——按【消费通道】另由 E11 对账（见 TEST_ONLY_DEFAULT_LEDGER）' }
];
function unhandledKind(line) {
  for (const p of HANDLED_LINE_PATHS) if (p.re.test(line)) return null;   // 已被某条抽取路径命中
  for (const a of UNHANDLED_ALLOWLIST) if (a.re.test(line)) return null;  // 白名单准入
  return 'UNHANDLED';
}
function exportsOf(src) {
  const out = [];
  const lines = src.split('\n');
  // 取块成员名：支持 `A`、`A as B`（export 块）、`A: B`（解构重命名）、`...rest`、`A = 默认值`
  const addBraceBody = (body, lineNo, endLine) => {
    for (const part of body.split(',')) {
      let seg = part.trim();
      if (!seg) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(seg);
      if (as) {
        out.push({ name: as[1], line: lineNo, declLine: lineNo - 1, declEnd: endLine });
        continue;
      }
      seg = seg.replace(/\s*=[^=][\s\S]*$/, '').trim();   // 丢弃默认值（`= expr`，不碰 `==`）
      const colon = seg.lastIndexOf(':');
      if (colon >= 0) seg = seg.slice(colon + 1).trim();  // 解构重命名取右侧本地名
      seg = seg.replace(/^\.\.\./, '').replace(/^type\s+/, '').trim();
      // declEnd：本导出语句占用的**最后一行**（跨行块 > 起始行）。成员行本身不含消费，
      //   内部消费扫描必须跳过整个语句区间，否则 `export {\n a,\n b,\n}` 会把 a/b 都算成「已消费」。
      if (/^[A-Za-z_$][\w$]*$/.test(seg)) {
        out.push({ name: seg, line: lineNo, declLine: lineNo - 1, declEnd: endLine });
      }
    }
  };
  // 从行 i 的 open 起累积到配对的 close，返回块体与结束行（跨行块的关键：不能只看首行）
  const collectBlock = (i, open, close) => {
    const matchIdx = (s) => {
      let d = 0;
      for (let k = 0; k < s.length; k++) {
        if (s[k] === open) d++;
        else if (s[k] === close) { d--; if (d < 0) return k; }
      }
      return -1;
    };
    let acc = lines[i].slice(lines[i].indexOf(open) + 1);
    let j = i;
    while (matchIdx(acc) < 0 && j + 1 < lines.length) acc += '\n' + lines[++j];
    const cut = matchIdx(acc);
    if (cut >= 0) acc = acc.slice(0, cut);
    return { body: acc, endLine: j };
  };
  for (let i = 0; i < lines.length; i++) {
    const m = DECL_RE.exec(lines[i]);
    if (m) { out.push({ name: m[1], line: i + 1, declLine: i, declEnd: i }); continue; }
    const d = DESTRUCT_RE.exec(lines[i]);
    if (d) {
      const open = d[1], close = open === '{' ? '}' : ']';
      const { body, endLine } = collectBlock(i, open, close);
      addBraceBody(body, i + 1, endLine);
      i = endLine;                     // 跳过已被本块消费的后续行
      continue;
    }
    if (/^\s*export\s*\{/.test(lines[i])) {
      const { body, endLine } = collectBlock(i, '{', '}');
      addBraceBody(body, i + 1, endLine);
      i = endLine;                     // 跳过已被本块消费的后续行
    }
  }
  return out;
}
// v2.42.0（E6）: 剔除注释与字符串字面量，只留**真代码**用于消费判定。
//   为什么必须做：消费判定此前是「裸词全文正则匹配」——注释里的 TODO、JSDoc 的 @param、
//   字符串里的 key 名都算命中，于是真死导出能被一句注释掩盖（实测：fixture 中
//   `// TODO: eventually call onlyInComment` 让 onlyInComment 被判为「已消费」）。
//   本仓最危险的是漏报（漏报比误报更伤），故这里修的是「探测器的诚实度」。
//
//   实现要点（第一版踩过的坑，务必保留）：**模板串的 `${...}` 插值必须按真代码处理**。
//   本仓大量用模板串拼 HTML，并在 `${fn()}` 里**真实调用**函数——若把整个模板串都当
//   非代码，会把真消费误抹（实测第一版在 wangxiang-app.js 清空 930 行，导致两个真有
//   同文件调用的导出被误判死）。故模板串文本部分置空、插值递归按代码扫描。
//   其余：单/双引号字符串同款跳过；块注释保留换行以维持行号；正则字面量在其起始
//   「前一有效字符是运算符/开括号」时识别，体内按字符串跳过（防其中引号破坏状态）。
function stripNonCode(src) {
  const out = [];
  const n = src.length;
  const prevMeaningful = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const ch = out[k];
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') continue;
      return ch;
    }
    return '';
  };
  // 末尾的标识符（用于「关键词后跟的 / 是正则起始」判定：return /re/、typeof /re/、case /re/）
  const prevWord = () => {
    let k = out.length - 1;
    while (k >= 0 && (out[k] === ' ' || out[k] === '\n' || out[k] === '\t' || out[k] === '\r')) k--;
    let e = k;
    while (k >= 0 && /[\w$]/.test(out[k])) k--;
    return out.slice(k + 1, e + 1).join('');
  };
  const REGEX_KW = /^(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/;
  // scan(i, stopAtBrace)：处理 [i, ...)；stopAtBrace=true 时在**配对**的 `}` 处停（模板插值用）
  function scan(i, stopAtBrace) {
    let depth = 0;   // stopAtBrace 时的花括号配平（对象字面量/嵌套块内的 } 不算插值结束）
    while (i < n) {
      const c = src[i], c2 = src[i + 1];
      if (stopAtBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return i; depth--; }
      }
      if (c === '/' && c2 === '/') {            // 行注释
        while (i < n && src[i] !== '\n') { out.push(' '); i++; }
        continue;
      }
      if (c === '/' && c2 === '*') {            // 块注释
        out.push(' ', ' '); i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
          out.push(src[i] === '\n' ? '\n' : ' '); i++;
        }
        if (i < n) { out.push(' ', ' '); i += 2; }
        continue;
      }
      if (c === '`') {                          // 模板串：文本置空，${...} 插值内按代码处理
        out.push(' '); i++;
        while (i < n && src[i] !== '`') {
          if (src[i] === '\\') { out.push(' ', ' '); i += 2; continue; }
          if (src[i] === '$' && src[i + 1] === '{') {
            out.push(' ', ' '); i += 2;
            i = scan(i, true);
            if (i < n && src[i] === '}') { out.push(' '); i++; }
            continue;
          }
          if (src[i] === '\n') { out.push('\n'); i++; continue; }
          out.push(' '); i++;
        }
        if (i < n) { out.push(' '); i++; }
        continue;
      }
      if (c === '\'' || c === '"') {            // 普通字符串
        const q = c; out.push(' '); i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\') { out.push(' ', ' '); i += 2; continue; }
          if (src[i] === '\n') { out.push('\n'); i++; continue; }
          out.push(' '); i++;
        }
        if (i < n) { out.push(' '); i++; }
        continue;
      }
      const pc = prevMeaningful();
      if (c === '/' && (/[=(,:;[!&|?{}+\-*%<>~^]/.test(pc) || REGEX_KW.test(prevWord()))) {
        // 正则字面量——体内按字符串跳过，防止其中的引号/括号破坏状态
        out.push(' '); i++;
        let inClass = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { out.push(' ', ' '); i += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { out.push(' '); i++; break; }
          else if (d === '\n') { out.push('\n'); i++; continue; }
          out.push(' '); i++;
        }
        continue;
      }
      out.push(c); i++;
    }
    return i;
  }
  scan(0, false);
  return out.join('');
}
const wordRe = (n) => new RegExp(`\\b${n.replace(/[$]/g, '\\$&')}\\b`);

const files = [];
for (const f of walk(root)) files.push(f);
const texts = new Map();
const codeTexts = new Map();   // v2.42.0: 去注释/字符串后的真代码（消费判定用）
for (const f of files) {
  try {
    const raw = fs.readFileSync(f.abs, 'utf8');
    texts.set(f.rel, raw);
    codeTexts.set(f.rel, stripNonCode(raw));
  } catch { /* 读不到按不存在算 */ }
}

/* ---------- 结构健康：真代码文本必须与原文一一对应 ----------
 * 为什么放在这里：枚举与消费判定都跑在 stripNonCode 的产物上。若该函数因任何原因缺失/失效，
 *   `codeTexts.get(rel)` 会返回 undefined，而 `|| src` 的写法会**静默退回原文口径**——
 *   门禁不会报错，只会把「注释/字符串里的提及」重新算成消费，跨文件消费整片消失、
 *   判定结果面目全非（本版开发中真实踩到：误删 stripNonCode 后跨文件消费 191 → 0）。
 *   故这里显式 fail-closed：两侧数量不等即 exit 2（探测器失效，拒判）。 */
if (codeTexts.size !== texts.size) {
  console.error(`[dead-export] 真代码文本 ${codeTexts.size} 份 ≠ 原文文本 ${texts.size} 份` +
    '（stripNonCode 未对每个文件生效）—— 消费判定会退回原文口径，fail-closed 拒判');
  process.exit(2);
}

const isExternalConsumer = (rel) => EXTERNAL_CONSUMER_DIRS.some(d => rel.startsWith(d));

let totalExports = 0;
const dead = [];       // { name, file, line }
const stat = { files: 0, exports: 0, internal: 0, crossFile: 0 };
for (const f of files) {
  const src = texts.get(f.rel);
  if (typeof src !== 'string') continue;
  stat.files += 1;
  // v2.44.0（E8）: 枚举跑在**真代码**上（与消费判定同一份输入面）。此前枚举跑原文，
  //   被注释掉的 `export { ... };` 备份块会把并不存在的名字当成本模块真实导出（幽灵导出）。
  const exps = exportsOf(codeTexts.get(f.rel));
  if (!exps.length) continue;
  totalExports += exps.length;
  // 本文件「除导出声明行以外」的正文：用于判定模块内部是否真的用了它
  const lines = src.split('\n');
  for (const e of exps) {
    stat.exports += 1;
    if (isExternalConsumer(f.rel)) { stat.internal += 1; continue; } // 豁免域直接算作已消费
    const re = wordRe(e.name);
    // v2.42.0（E6）: 内部消费按**真代码行**判定——注释/字符串里的同名提及不算消费
    const codeLines = codeTexts.get(f.rel).split('\n');
    // v2.43.0（E7 配套）: 「声明行」不等于「export 行」。`function X(){} export { X }` 这类
    //   先声明后成块转出的写法里，X 的**声明行**本身含名字但不构成消费——此前只跳过 export 行，
    //   于是该声明行把它自己算成「内部消费」，真死导出被静默隐藏（夹具实测：0 消费的
    //   `deadMultiline` 被报成「内部消费」）。故凡「本名字的正规声明行」一律跳过。
    const declRe = new RegExp('^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+' + e.name + '\\b');
    const stmtEnd = (typeof e.declEnd === 'number') ? e.declEnd : e.declLine;
    let internal = 0;
    for (let i = 0; i < codeLines.length; i++) {
      if (i >= e.declLine && i <= stmtEnd) continue;  // 跳过整段导出语句（含跨行块的成员行）
      if (declRe.test(codeLines[i])) continue;        // 跳过本名字的声明行（声明不算消费）
      if (re.test(codeLines[i])) internal++;
    }
    if (internal > 0) { stat.internal += 1; continue; }
    let cross = 0;
    for (const g of files) {
      if (g.rel === f.rel) continue;
      const t = codeTexts.get(g.rel);   // v2.42.0: 只认真代码里的消费
      if (typeof t !== 'string') continue;
      if (re.test(t)) { cross++; break; }
    }
    if (cross > 0) { stat.crossFile += 1; continue; }
    dead.push({ name: e.name, file: f.rel, line: e.line });
  }
}

dead.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

/* ---------- E9 结构健康：枚举面完整性（未识别的导出写法一律拒判）----------
 * 为什么放在这里：E7/E8 的教训是「抽取路径没覆盖某种写法 ⇒ 名字在门禁眼里不存在 ⇒
 *   fail-open 静默放行」。逐个补语法只能治个案，本段把**类别的残余**一并堵死。
 * 判据：对每个文件的真代码，数出全部以 `export` 起首的语句，逐条问「被哪条抽取路径认领」；
 *   答不上来的（既不在 HANDLED_LINE_PATHS，也不在 UNHANDLED_ALLOWLIST）即 exit 2。
 * 方向性说明：这里只会**增加**红灯，不会放行任何原本判死的导出；漏报比误报更伤，故从严。
 * 夹具模式跳过（单测要能构造任意合成本文件；真实仓库才需要这道闸）。 */
const handled = { block: 0, decl: 0, destruct: 0, allowed: 0, total: 0 };
const unhandled = [];
// E10：白名单逐条的认领计数（label → 命中数）。用它做「存活自证」。
const allowHits = new Map(UNHANDLED_ALLOWLIST.map(a => [a.label, 0]));
if (!FIXTURE_MODE) {
  for (const f of files) {
    const code = codeTexts.get(f.rel);
    if (typeof code !== 'string') continue;
    const ls = code.split('\n');
    for (let i = 0; i < ls.length; i++) {
      if (!/^\s*export\b/.test(ls[i])) continue;
      handled.total += 1;
      const hit = HANDLED_LINE_PATHS.find(p => p.re.test(ls[i]));
      if (hit) { handled[hit.kind] += 1; continue; }
      const allow = UNHANDLED_ALLOWLIST.find(a => a.re.test(ls[i]));
      if (allow) { handled.allowed += 1; allowHits.set(allow.label, allowHits.get(allow.label) + 1); continue; }
      unhandled.push({ file: f.rel, line: i + 1, text: ls[i].trim().slice(0, 120) });
    }
  }
  if (unhandled.length) {
    console.error(`[dead-export] 枚举面不完整：${unhandled.length} 条 export 语句未被任何抽取路径识别` +
      '（这些名字在门禁眼里根本不存在，既不报红灯也不进账本）—— fail-closed 拒判：');
    for (const u of unhandled.slice(0, 20)) console.error(`    ${u.file}:${u.line}  ${u.text}`);
    if (unhandled.length > 20) console.error(`    … 其余 ${unhandled.length - 20} 条`);
    console.error('  修法二选一：① 给该写法补抽取路径并同步登记进 HANDLED_LINE_PATHS；' +
      '② 若确无具名成员可对账，写进 UNHANDLED_ALLOWLIST 并说明理由。');
    process.exit(2);
  }
  /* ---------- E10：白名单条目存活自证（v2.68.0）----------
   * 为什么必须有这一条：UNHANDLED_ALLOWLIST 是**准入闸**。它的合法性不是来自「被写下来」，
   *   而是来自「它确实在放行某些真实存在的语句」。一旦某条目零命中（比如未来 export default
   *   被全部消灭、或该正则被改写成永不匹配），它就从「准入闸」退化为「放行条」——
   *   为一种本仓已不存在的情形背书，且静默、无红灯、无人会去删。
   *   这与 lifecycle L3「派生前提消失即 fail-closed」是同一族缺陷：**清单的存活必须自证**。
   * 判据：每条 entry 的认领数必须 ≥ 1；0 命中即 exit 2 拒判（不是 exit 1——这不是数据缺陷，
   *   是**门禁自身的账目错了**，拒判才符合「不猜」纪律）。
   * 为什么不用固定数字（如「必须 == 90」）：数字漂移本身无害（写代码天经地义），若把 90 写死
   *   则每次新增一个平台入口都要改门禁，属自找的维护税；真正致命的是**零命中**。 */ 
  const deadAllow = [...allowHits.entries()].filter(([, n]) => n === 0);
  if (deadAllow.length) {
    console.error(`[dead-export] 白名单条目存活自证失败：${deadAllow.length} 条 UNHANDLED_ALLOWLIST 项` +
      '在真仓库里**零命中**（它不再放行任何语句，已退化为幽灵放行条）—— fail-closed 拒判：');
    for (const [label] of deadAllow) console.error(`    ${label}`);
    console.error('  修法：① 该写法确已从仓库消失 ⇒ 删掉这条白名单；' +
      '② 正则写错导致永不匹配 ⇒ 修正它。留着的唯一后果是给不存在的情形背书。');
    process.exit(2);
  }
}

/* ---------- E11：default 面的消费通道对账（v2.73.0）----------
 * 为什么必须有：UNHANDLED_ALLOWLIST 放行 `export default` 的依据是「无具名成员可对账」。
 *   v2.73.0 实测该依据**只对 76/90 处成立**：另有 17 处带具名成员（多行对象 9 + 单行对象 8），
 *   其中 2 个模块的 default 面是**产品端零消费、仅测试经 `.default` 取**
 *   （apps/cheat/cheat-data.js 的 QUALITY_META / QUALITY_ORDER、
 *     apps/dirtytalk/dt-data.js 的 TIER_META / TIER_ORDER）。
 *   这正是本仓六次欠债的共同形态（「只有测试引用 = 产品端零消费」），却因整条
 *   `export default` 被白名单放行，**既不报红灯、也不进账本** = 白名单的边界外覆盖。
 *   本仓纪律：如实声明边界不算过关，边界的**每一条都要能自证**。
 * 判定（三面，全部基于可复算的静态事实，不猜运行时）：
 *   D2 登记：模块 M 上若存在经 `.default` 取的成员，而 M 的**产品侧通道为 0**
 *      （无 default 导入点 · 无 `import * as` · 无本文件 `window|self|globalThis.X =`），
 *      则该 (模块, default.成员) 必须进 TEST_ONLY_DEFAULT_LEDGER，否则报红灯。
 *      报错时附带成员「有无依据」（真具名导出 / default 对象成员 / 别名）——成员名拼错的
 *      phantom 访问点会在这里现形（否则它会静默取到 undefined）。
 *   D3 存活自证：账本每条必须在真仓库里命中 ≥1 个 `X.default.Y` 访问点，0 命中即 exit 2
 *      （幽灵放行条，与 E10 同族）。
 *   D4 成员存在性：账本条的成员必须仍有依据；成员被删/改名 ⇒ 账本腐坏，exit 2
 *      （堵「删掉成员 + 留着账本」的假绿）。
 *   ⚠️ 刻意**没有**一条独立的「访问点无依据」判据：它永远轮不到自己决定结果
 *      （未登记的访问点先被 D2 抓住，已登记的先被 D4 抓住），留着就是一个不起决定作用的
 *      死判据——本仓对「写了却无效」的形态零容忍。成员依据只作为 D2 的报错信息与 D4 的
 *      判据存在，各司其职。
 *   ⚠️ D3/D4 只对「模块本身在本仓扫描面内」的账本条目生效：合成夹具里不存在真仓库的模块，
 *      此时属**无从观测**而非「零命中」——让观测不到伪装成判死是另一种不诚实。
 * 夹具通道：--root <dir> 指向的合成仓库同样生效（负控制靠它造真破坏）。
 *   测试目录名固定为 `tests`；该目录缺失时不判 D2/D3（无从观测），但账本非空仍会因
 *   D3 零命中而 exit 2 —— 不让「观测不到」伪装成「没问题」。 */
let failE11 = false;
const TEST_ONLY_DEFAULT_LEDGER = [
  { module: 'apps/cheat/cheat-data.js', member: 'QUALITY_META',
    reason: '别名导入（CHEAT_QUALITY_META as QUALITY_META）只经 default 对象外露；产品侧只用 qualityColorOf/qualityOrderOf，故产品端零消费。守的是与 cheat-index 的数值漂移，不要求产品接线' },
  { module: 'apps/cheat/cheat-data.js', member: 'QUALITY_ORDER',
    reason: '同上（对标 CHEAT_QUALITY_ORDER 的逐项等价）' },
  { module: 'apps/dirtytalk/dt-data.js', member: 'TIER_META',
    reason: '同上族：dt 侧品阶表只经 default 对象外露，产品侧零消费；测试守与 cheat 侧六档的一致' },
  { module: 'apps/dirtytalk/dt-data.js', member: 'TIER_ORDER',
    reason: '同上（对标 TIER_ORDER 的逐项等价）' },
];
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 收集 default 对象字面量的成员名（`export default { A, B, … }`，单行与多行）
function defaultObjectMembers(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const multi = /^\s*export\s+default\s*\{\s*$/.test(lines[i]);
    const single = !multi && /^\s*export\s+default\s*\{[\s\S]*\}\s*;?\s*$/.test(lines[i]);
    if (!multi && !single) continue;
    let body;
    if (single) body = lines[i].replace(/^\s*export\s+default\s*\{/, '').replace(/\}\s*;?\s*$/, '');
    else { body = ''; for (let j = i + 1; j < lines.length; j++) { if (/^\s*\};?\s*$/.test(lines[j])) break; body += lines[j] + ','; } }
    for (const part of body.split(',')) {
      const s = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(s)) out.push(s);
    }
  }
  return out;
}
// 本文件内的「别名名集合」：`import { X as Y }` 的 Y、`const { X: Y } = …` 的 Y
//   ⚠️ 输入是**剔字符串后**的真代码（E6/E8 纪律：判据的输入面与结论面同一份），
//   故 `from '...'` 的引号已被置空 —— import 块的正则**不能要求带引号的 specifier**，
//   否则一条别名都匹配不到（v2.73.0 踩过：成员依据被误判为「无依据」，账本校验假红）。
function aliasNames(src) {
  const s = new Set();
  for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\b/g)) {
    for (const p of m[1].split(',')) {
      const parts = p.trim().split(/\s+as\s+/);
      if (parts[1] && /^[A-Za-z_$][\w$]*$/.test(parts[1].trim())) s.add(parts[1].trim());
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([\s\S]*?)\}\s*=/g)) {
    for (const p of m[1].split(',')) {
      const parts = p.trim().split(/:\s*/);
      if (parts[1] && /^[A-Za-z_$][\w$]*$/.test(parts[1].trim())) s.add(parts[1].trim());
    }
  }
  return s;
}
// 模块 M 的产品侧通道是否存在（default 导入点 / import * as / 本文件 window 自挂载）
//   ⚠️ 这里刻意用**原文**（texts）而不是剔除后的真代码：import 的 specifier 本身就是字符串，
//   剔除后无法判断它指向哪个模块。残留风险（注释里恰好写着一条 import）在形态上极小，
//   且后果方向安全（只会让某面被当作「有产品通道」而不报红灯，不会造成误报红灯）。
function hasProdChannel(moduleRel) {
  const own = codeTexts.get(moduleRel);
  if (typeof own === 'string' && /\b(?:window|self|globalThis)\s*\.\s*[A-Za-z_$]/.test(own)) return true;
  const base = path.basename(moduleRel).replace(/\.js$/, '');
  const reDef = new RegExp("^\\s*import\\s+[A-Za-z_$][\\w$]*\\s*(?:,\\s*\\{[^}]*\\})?\\s+from\\s+['\"][^'\"]*" + escRe(base) + "\\.js['\"]", 'm');
  const reStar = new RegExp("^\\s*import\\s+\\*\\s+as\\s+[A-Za-z_$][\\w$]*\\s+from\\s+['\"][^'\"]*" + escRe(base) + "\\.js['\"]", 'm');
  for (const f of files) {
    const t = texts.get(f.rel);
    if (typeof t !== 'string' || !t.includes(base)) continue;
    if (reDef.test(t) || reStar.test(t)) return true;
  }
  return false;
}
// 成员 Y 是否在模块 M 里有依据（真具名导出 / default 对象成员 / 别名）
function memberBackedBy(moduleRel, member) {
  const src = codeTexts.get(moduleRel);
  if (typeof src !== 'string') return null;                 // 不在扫描面：无从判定，返回 null 表示「不猜」
  if (exportsOf(src).some((e) => e.name === member)) return true;
  if (defaultObjectMembers(src).includes(member)) return true;
  if (aliasNames(src).has(member)) return true;
  return false;
}
// 账本条目的**严格**依据：必须是真具名导出或别名。
//   刻意**不含**「default 对象成员」——账本条目说的就是 default 面的成员，
//   拿 default 面自己引用自己当依据是自我指涉：成员被删后 default 面若仍写着它，
//   宽松判定会继续判「有依据」，账本腐坏就永远抓不到（正是本仓最忌的自证形态）。
function strictMemberBacked(moduleRel, member) {
  const src = codeTexts.get(moduleRel);
  if (typeof src !== 'string') return null;
  if (exportsOf(src).some((e) => e.name === member)) return true;
  if (aliasNames(src).has(member)) return true;
  return false;
}
// 收集 tests 下的 `X.default.Y` 访问点，并把绑定名解析回模块
function collectTestDefaultAccesses(rootDir) {
  const out = [];
  const testsDir = path.join(rootDir, 'tests');
  if (!fs.existsSync(testsDir)) return out;
  const stack = [testsDir];
  const testFiles = [];
  while (stack.length) {
    const d = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.m?js$/.test(e.name)) testFiles.push(p);
    }
  }
  for (const tf of testFiles) {
    let src;
    try { src = fs.readFileSync(tf, 'utf8'); } catch { continue; }
    const lines = src.split('\n');
    const bindTo = new Map();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/.exec(l);
      if (m) { bindTo.set(m[1], m[2]); continue; }
      if (/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*(?:path\.)?join\(/.test(l)) {
        let acc = l, k = i;
        while (!/\.js['"]\s*\)/.test(acc) && k + 1 < lines.length) acc += ' ' + lines[++k];
        const mm = /['"]([^'"]+\.js)['"]/.exec(acc);
        const bm = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
        if (mm && bm) bindTo.set(bm[1], mm[1]);
        continue;
      }
      m = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/.exec(l);
      if (m) { bindTo.set(m[1], m[2]); continue; }
      m = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/.exec(l);
      if (m) { bindTo.set(m[1], m[2]); continue; }
    }
    const relOfTest = path.relative(rootDir, tf).split(path.sep).join('/');
    for (let i = 0; i < lines.length; i++) {
      for (const mm of lines[i].matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*default\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
        const spec = bindTo.get(mm[1]);
        if (!spec) continue;
        const moduleRel = resolveSpec(rootDir, relOfTest, spec);
        if (!moduleRel) continue;
        out.push({ testRel: relOfTest, line: i + 1, bind: mm[1], moduleRel, member: mm[2] });
      }
    }
  }
  return out;
}
function resolveSpec(rootDir, fromRel, spec) {
  if (/\.js$/.test(spec) && !spec.startsWith('.')) {
    // path.join(root, 'apps/x.js') 形态：已是 root 相对
    const abs = path.resolve(rootDir, spec);
    const r = path.relative(rootDir, abs);
    return r.startsWith('..') ? null : r.split(path.sep).join('/');
  }
  if (!spec.startsWith('.')) return null;                   // 裸包名，不属本仓
  const fromDir = path.dirname(path.join(rootDir, fromRel));
  const abs = path.resolve(fromDir, spec);
  const r = path.relative(rootDir, abs);
  return r.startsWith('..') ? null : r.split(path.sep).join('/');
}

const defaultAccesses = collectTestDefaultAccesses(root);
if (args.includes('--e11-dump')) {
  console.log(`[dead-export] E11 访问点明细：${defaultAccesses.length} 个`);
  for (const a of defaultAccesses) {
    const modOk = codeTexts.has(a.moduleRel);
    const chan = modOk && hasProdChannel(a.moduleRel);
    console.log(`  ${a.testRel}:${a.line}  ${a.bind}.default.${a.member}  → ${a.moduleRel}` +
      `  [在扫描面 ${modOk ? 'Y' : 'N'} · 产品通道 ${chan ? '有' : '无'} · 成员依据 ${memberBackedBy(a.moduleRel, a.member)}]`);
  }
  process.exit(0);
}
const testOnlyFaces = new Map();     // 'module::member' → 访问点数
for (const a of defaultAccesses) {
  if (isExternalConsumer(a.moduleRel)) continue;            // 外部平台消费域豁免
  if (!codeTexts.has(a.moduleRel)) continue;                // 不在扫描面（如 tests 内模块）
  if (hasProdChannel(a.moduleRel)) continue;                // 产品侧有通道 ⇒ 不是仅测试消费
  const k = a.moduleRel + '::' + a.member;
  testOnlyFaces.set(k, (testOnlyFaces.get(k) || 0) + 1);
}
const ledgerKeys = new Set(TEST_ONLY_DEFAULT_LEDGER.map((e) => `${e.module}::${e.member}`));
const unregisteredFaces = [...testOnlyFaces.keys()].filter((k) => !ledgerKeys.has(k));
if (unregisteredFaces.length) {
  failE11 = true;
  console.error(`[dead-export] ✗ 发现 ${unregisteredFaces.length} 个「仅测试消费的 default 面」未登记：`);
  for (const k of unregisteredFaces) {
    const [mod, mem] = k.split('::');
    const backed = memberBackedBy(mod, mem);
    console.error(`    ${k}  （${testOnlyFaces.get(k)} 个 .default 访问点）`
      + (backed === false ? '  ⚠️ 该成员在模块里找不到依据——成员名拼错/已改名（.default 访问会取到 undefined）' : ''));
  }
  console.error('  含义：该成员在产品端零消费、只有测试经 `.default` 取它——正是本仓欠债的共同形态，' +
    '只因整条 export default 被白名单放行而既不报红灯也不进账本。');
  console.error('  修法二选一：① 产品端真接线（用它，或把它接进真实代码路径）；' +
    '② 若它刻意只为「一致性守卫」而存在，登记进 TEST_ONLY_DEFAULT_LEDGER 并写明理由。');
}
const ledgerHits = new Map(TEST_ONLY_DEFAULT_LEDGER.map((e) => [`${e.module}::${e.member}`, 0]));
for (const a of defaultAccesses) {
  const k = a.moduleRel + '::' + a.member;
  if (ledgerHits.has(k)) ledgerHits.set(k, ledgerHits.get(k) + 1);
}
// D3/D4 合并为**一个**账本校验（两条归因，而非两条判据）：
//   为什么合并——若拆成两条独立判据，「成员无依据」那条永远抢不到决定权：
//   成员名一旦改错/消失，同一条目的 `.default` 访问点通常也随之归零 ⇒ 先被「零命中」拦下，
//   「成员依据」判据永不决定结果，就是一个写了却无效的死判据（本仓零容忍）。
//   合并后两个分支都可达、都可被负控制证明（见 system-v273 N4 / N4b）。
//   只对「模块在本仓扫描面内」的条目生效：夹具/子集仓库里模块不存在 = 无从观测，
//   不是「零命中」——让观测不到伪装成判死，是与漏报对称的不诚实。
const observableLedger = TEST_ONLY_DEFAULT_LEDGER.filter((e) => codeTexts.has(e.module));
const ledgerProblems = [];
for (const e of observableLedger) {
  const k = `${e.module}::${e.member}`;
  const hits = ledgerHits.get(k) || 0;
  if (hits === 0) {
    ledgerProblems.push({ k, kind: 'no-hit',
      msg: '在真仓库里**零命中**（不再有测试经 .default 取它）⇒ 已退化为幽灵放行条' });
  } else if (strictMemberBacked(e.module, e.member) === false) {
    ledgerProblems.push({ k, kind: 'gone',
      msg: `有 ${hits} 个 .default 访问点，但该成员在模块里已找不到依据（真具名导出 / 别名均无）` +
        '⇒ 账本腐坏 / 成员被删改名' });
  }
}
if (ledgerProblems.length) {
  console.error(`[dead-export] default 面账本校验失败：${ledgerProblems.length} 条 TEST_ONLY_DEFAULT_LEDGER 项失效` +
    ' —— fail-closed 拒判：');
  for (const p of ledgerProblems) console.error(`    ${p.k}  ${p.msg}`);
  console.error('  修法：① 该面已不再被测试消费 ⇒ 删掉这条账本；' +
    '② 成员已接线到产品端 ⇒ 同样删掉（它不再是「仅测试消费」）；③ 成员改名/删除 ⇒ 同步修正账本条目。');
  process.exit(2);
}
const testOnlyLedgerTotal = TEST_ONLY_DEFAULT_LEDGER.length;
const testOnlyHitsTotal = [...ledgerHits.values()].reduce((a, b) => a + b, 0);

/* ---------- E5 结构健康：扫描面低于下限即探测器失效 ---------- */
if (!FIXTURE_MODE && totalExports < MIN_EXPORTS) {
  console.error(`[dead-export] 只抽到 ${totalExports} 个 export 声明（低于下限 ${MIN_EXPORTS}），` +
    '文件遍历或导出抽取器已失效 —— fail-closed 拒判');
  process.exit(2);
}

const baselinePath = path.join(root, BASELINE_REL);
let baseline = { note: '', entries: [] };
if (fs.existsSync(baselinePath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baseline = { note: String(raw.note || ''), entries: Array.isArray(raw.entries) ? raw.entries : [] };
  } catch (e) {
    console.error(`[dead-export] 基线账本解析失败：${e.message}（fail-closed）`);
    process.exit(2);
  }
}
const baseKeys = new Set(baseline.entries.map(e => `${e.file}::${e.name}`));
const deadKeys = new Set(dead.map(e => `${e.file}::${e.name}`));
const newly = dead.filter(e => !baseKeys.has(`${e.file}::${e.name}`));
const stale = baseline.entries.filter(e => !deadKeys.has(`${e.file}::${e.name}`));

if (listMode) {
  console.log(`扫描 ${stat.files} 个文件 / ${stat.exports} 个 export 声明`);
  console.log(`内部消费 ${stat.internal} · 跨文件消费 ${stat.crossFile} · 零消费 ${dead.length}`);
  if (!FIXTURE_MODE) {
    console.log(`导出语句识别 ${handled.total} 条（声明 ${handled.decl} · 成块 ${handled.block} · ` +
      `解构 ${handled.destruct} · 无具名成员 ${handled.allowed}）· 未识别 ${unhandled.length}`);
  }
  for (const e of dead) console.log(`  ${e.file}:${e.line}  ${e.name}${baseKeys.has(`${e.file}::${e.name}`) ? '  [已登记]' : '  [新]'}`);
  process.exit(0);
}

if (updateMode) {
  const merged = dead.map(e => {
    const prev = baseline.entries.find(b => b.file === e.file && b.name === e.name);
    return { file: e.file, name: e.name, line: e.line, reason: prev?.reason || 'TODO: 补写原因或接线' };
  });
  const removed = stale.map(e => `${e.file}::${e.name}`);
  const added = merged.filter(e => !baseKeys.has(`${e.file}::${e.name}`)).map(e => `${e.file}::${e.name}`);
  const out = {
    note: baseline.note || '零消费导出冻结账本：新增项必须显式登记理由；条目被消费后应清理。',
    entries: merged
  };
  fs.writeFileSync(baselinePath, JSON.stringify(out, null, 2) + '\n');
  console.log(`[dead-export] 基线已重写：${merged.length} 条（+${added.length} / -${removed.length}）`);
  for (const a of added) console.log(`  + ${a}`);
  for (const r of removed) console.log(`  - ${r}`);
  process.exit(0);
}

/* ---------- 判定 ---------- */
let fail = failE11 ? 1 : 0;
console.log(`[dead-export] 扫描 ${stat.files} 个文件 / ${stat.exports} 个 export 声明` +
  `（内部消费 ${stat.internal} · 跨文件消费 ${stat.crossFile} · 零消费 ${dead.length}）`);
console.log(`[dead-export] 基线账本：${baseline.entries.length} 条冻结项`);
if (!FIXTURE_MODE) {
  // E9：枚举面完整性自证（识别分布 + 未识别数）。未识别数恒为 0，否则上面已 exit 2。
  console.log(`[dead-export] 枚举面完整性：${handled.total} 条 export 语句全部被识别` +
    `（声明 ${handled.decl} · 成块 ${handled.block} · 解构 ${handled.destruct} · ` +
    `无具名成员 ${handled.allowed}）· 未识别 ${unhandled.length}`);
}
// E11（v2.73.0）：default 面的消费通道对账（补白名单边界外的漏面）
//   读数里区分「本仓模块 / 非本仓扫描面」：测试用例里出现的合成夹具路径（如 apps/x/m.js）
//   会被同一个正则采集到，但它们不在本仓扫描面、也不参与登记判定——把它们混进总数
//   会让读数看着像漂移（下一次维护者会怀疑数字错了），故如实拆开报。
{
  const inScopeAcc = defaultAccesses.filter((a) => codeTexts.has(a.moduleRel)).length;
  console.log(`[dead-export] default 面（E11）：.default 访问点 ${defaultAccesses.length} 个` +
    `（本仓 ${inScopeAcc} / 非本仓扫描面 ${defaultAccesses.length - inScopeAcc}）· ` +
    `仅测试消费面 ${testOnlyFaces.size} 个 · 账本 ${testOnlyLedgerTotal} 条（命中 ${testOnlyHitsTotal} 次）`);
}

if (stale.length) {
  // E4：账本腐坏只提示不判错（漏报比误报更伤；清理账本是洁癖）
  console.log(`[dead-export] 提示：${stale.length} 条基线项已被消费或已不存在，账本可清理（--update）`);
  for (const s of stale.slice(0, 10)) console.log(`  - ${s.file}::${s.name}`);
  if (stale.length > 10) console.log(`  … 其余 ${stale.length - 10} 条`);
}

if (newly.length) {
  fail = 1;
  console.error(`[dead-export] ✗ 发现 ${newly.length} 个未登记的零消费导出（建好了却没人用）：`);
  for (const e of newly) console.error(`    ${e.file}:${e.line}  ${e.name}`);
  console.error('  修法二选一：① 接线（产品端真消费它）；② 若不是本版对外接口，' +
    '删除或改为模块内部函数。确需保留请 `node scripts/dead-export-check.mjs --update` 并写明理由。');
}

console.log(fail === 0 ? '[dead-export] ✓ 无新增零消费导出' : '[dead-export] ✗ 门禁未通过');
process.exit(fail);
