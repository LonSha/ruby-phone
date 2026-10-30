#!/usr/bin/env node
/**
 * scripts/bind-consumption-audit.mjs — 绑定级零消费导出审计（计划 R11-O1）
 *
 * 为什么存在：`dead-export-check.mjs` 的跨文件消费判定是**裸词正则**（只要别的文件
 * 真代码里出现 `\bNAME\b` 就算已消费），于是「同名不同体 / 陌生词面命中」能让真死导出
 * 永远判绿（负控制可复现：把被消费的 desk 版改名，门立刻报出含真孤儿的未登记零消费）。
 *
 * 本门把消费单位升级为「模块解析后的绑定」：
 *   只认 `import { X } from 'm.js'`、`import * as NS from 'm.js'` + `NS.X`、
 *   `export { A } from`（不计，转出不等于被用）、动态 `import()`（含 instrumentImport
 *   包装 / Promise.all 位置解构 / 常量折叠 / 赋值别名）——详见 scripts/lib/binding-consumption.mjs。
 *
 * 判据（对齐计划「只判增量，存量冻结」纪律）：
 *   - 枚举模块级导出（复用 dead-export-check 的枚举口径）；
 *   - 每个导出若：内部零消费（文件正文真代码不含）且绑定级零跨文件消费 ⇒ 记作「绑定级死」；
 *   - 与基线 scripts/bind-dead-baseline.json 比对：新增未登记 ⇒ 红；
 *   - 基线项已复活（被消费）⇒ 从基线移除（提示，不红）；
 *   - 扫描面塌陷（文件数/导出数低于阈值）⇒ exit 2（fail-closed，防探测器失效后全绿）。
 *
 * 退出码：0 通过 / 1 有新增死导出 / 2 结构失效（fail-closed）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTree, buildConsumptionIndex, hasBindingConsumer,
} from './lib/binding-consumption.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BASELINE_PATH = path.join(__dir, 'bind-dead-baseline.json');

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : ROOT;
const listMode = args.includes('--list');
const updateMode = args.includes('--update');
const REAL_REPO = rootIdx < 0;

const MIN_FILES = 600;   // 真仓 675；合成夹具必须显式 --fixture，否则一律按塌陷处理
const FIXTURE = args.includes('--fixture');
const { texts, bindTexts, codeTexts } = loadTree(root, {
  skipDirs: new Set(['node_modules', '.git', '.wrangler', 'tests']),
});

// 结构健康：三份视图必须一一对应（探测器失效即拒判）
if (!(texts.size === bindTexts.size && bindTexts.size === codeTexts.size)) {
  console.error(`[bind-audit] 三份视图数量不一致 (${texts.size}/${bindTexts.size}/${codeTexts.size})，fail-closed`);
  process.exit(2);
}
if (REAL_REPO && codeTexts.size < MIN_FILES) {
  console.error(`[bind-audit] 扫描面塌陷：${codeTexts.size} 文件（<${MIN_FILES}），fail-closed`);
  process.exit(2);
}
// ★ 非本地根（--root 指到别处）也必须是真仓规模，除非显式 --fixture。
//   否则「把 --root 指到一个空目录」就能让门禁 0 文件 0 死导出地全绿通过，
//   这正是 dead-export-check 历史上被拿掉的那种假绿通道。
if (!REAL_REPO && !FIXTURE && codeTexts.size < MIN_FILES) {
  console.error(`[bind-audit] --root ${root} 扫描面只有 ${codeTexts.size} 文件（<${MIN_FILES}）；`);
  console.error('  若确实是合成夹具请显式加 --fixture，否则 fail-closed。');
  process.exit(2);
}

/* ---------- 导出枚举（与 dead-export-check 同口径） ---------- */
function exportsOf(src) {
  const out = [];
  const lines = src.split('\n');
  const DECL_RE = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
  const DESTRUCT_RE = /^\s*export\s+(?:const|let|var)\s*([\[{])/;
  const addBraceBody = (body, lineNo, endLine) => {
    for (const part of body.split(',')) {
      let seg = part.trim();
      if (!seg) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(seg);
      if (as) { out.push({ name: as[1], line: lineNo, declLine: lineNo - 1, declEnd: endLine }); continue; }
      seg = seg.replace(/\s*=[^=][\s\S]*$/, '').trim();
      const colon = seg.lastIndexOf(':');
      if (colon >= 0) seg = seg.slice(colon + 1).trim();
      seg = seg.replace(/^\.\.\./, '').replace(/^type\s+/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(seg)) out.push({ name: seg, line: lineNo, declLine: lineNo - 1, declEnd: endLine });
    }
  };
  const collectBlock = (i, open, close) => {
    const matchIdx = (s) => { let d = 0; for (let k = 0; k < s.length; k++) { if (s[k] === open) d++; else if (s[k] === close) { d--; if (d < 0) return k; } } return -1; };
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
    if (d) { const o = d[1], close = o === '{' ? '}' : ']'; const { body, endLine } = collectBlock(i, o, close); addBraceBody(body, i + 1, endLine); i = endLine; continue; }
    if (/^\s*export\s*\{/.test(lines[i])) {
      // ★ 纯转出 `export { A } from './m.js'` 不是「本模块声明」：
      //   `apps/games/games-data.js` 全文只有一行转出语句，成员由 poker-data 声明。
      //   把它当成本模块导出会产出伪条目 `games-data.js::HAND_LABELS`
      //   （该名字在本文件正文里根本不出现 ⇒ 必然被误判零消费），
      //   而真正的消费又会经重导出穿透记到 poker-data（真·双记账错位）。
      const collected = collectBlock(i, '{', '}');
      const tail = lines[collected.endLine].slice(lines[collected.endLine].indexOf('}') + 1);
      // ⚠️ 判据用 `from` 关键字而非 `from '...'`：枚举跑在 codeTexts（去字符串）上，
      //    说明符已被置空，只剩 `from ;`。用带引号的判据会一条都认不出（首版实测即此坑）。
      const continues = /^\s*$/.test(tail) ? (lines[collected.endLine + 1] || '') : tail;
      const isReexport = /^\s*from\b/.test(continues);
      if (isReexport) { i = collected.endLine; continue; }
      addBraceBody(collected.body, i + 1, collected.endLine);
      i = collected.endLine;
    }
  }
  return out;
}
const wordRe = (n) => new RegExp(`\\b${n.replace(/[$]/g, '\\$&')}\\b`);

const index = buildConsumptionIndex(bindTexts, { codeTexts, rawTexts: texts });

const dead = [];   // { file, name, line }
let totalExports = 0;
for (const rel of codeTexts.keys()) {
  const src = codeTexts.get(rel);
  if (typeof src !== 'string') continue;
  const exps = exportsOf(src);
  if (!exps.length) continue;
  const fileLines = src.split('\n');
  for (const e of exps) {
    totalExports += 1;
    // 内部消费：声明行以外、真代码行里出现本名
    const re = wordRe(e.name);
    const declRe = new RegExp('^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+' + e.name + '\\b');
    const stmtEnd = (typeof e.declEnd === 'number') ? e.declEnd : e.declLine;
    let internal = 0;
    for (let i = 0; i < fileLines.length; i++) {
      if (i >= e.declLine && i <= stmtEnd) continue;
      if (declRe.test(fileLines[i])) continue;
      if (re.test(fileLines[i])) { internal++; break; }
    }
    if (internal > 0) continue;
    // 绑定级跨文件消费
    if (hasBindingConsumer(index, rel, e.name)) continue;
    dead.push({ file: rel, name: e.name, line: e.line });
  }
}
dead.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

/* ---------- 证据分级（写进基线，让账本自解释） ----------
 * 计划纪律：「账本合法性来自它确实在放行某物」。若只冻结一个 file::name 列表，
 * 半年后没人说得清每条为什么可以放行。故对每条算一档证据。
 *
 * ⚠️ 口径边界：遍历的是 codeTexts，而 loadTree 的 skipDirs 含 `tests`，
 *    故 tests/ 与 scripts/ 的提及**不在**这一面的统计里。三档因此是「产品面」语义：
 *   no-ref     —— 产品扫描面内除本文件外零次提及该名字（含注释已剔除的字符串面）。
 *                 任何消费形态（import / NS 成员 / 重导出 / 动态 import）都必须写字面名，
 *                 一次都不出现 ⇒ 铁真孤儿（测试是否引用由原列表另行取证）。
 *   name-clash —— 产品面有提及，但逐点核对后**没有一处**是从目标模块 import 取得的
 *                 （全部来自别的模块同名导出或本地定义）⇒ 同名异构，目标仍零消费。
 * 这两档都不依赖解析器的形态覆盖度，因此即使解析器将来漏了新形态，
 * 也不会把这类条目误判为「已被消费」。反之，若真有一处从目标模块 import 了该名，
 * 判据会返回 PARSER-GAP 并 fail-closed（见下方自证段）。
 */
function evidenceOf(rel, name) {
  const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`);
  const hits = [];
  for (const [other, src] of codeTexts) {
    if (other === rel) continue;
    if (typeof src !== 'string') continue;
    if (re.test(src)) hits.push(other);
  }
  if (!hits.length) return { kind: 'no-ref', refs: [] };
  const prod = hits.filter((h) => !h.startsWith('tests/') && !h.startsWith('scripts/'));
  if (!prod.length) return { kind: 'test-only', refs: hits.slice(0, 4) };
  // 产品端确有提及 ⇒ 必须逐个确认它是不是从目标模块拿的（用原文 texts，说明符还在）。
  //   只要有一处真从 rel 导入该名，就不是死导出（本不该进这张表）——
  //   真出现说明绑定级解析漏了形态，属于探测器缺陷，直接 fail-closed 报出来。
  let foreign = 0;
  for (const other of prod) {
    const raw = texts.get(other);
    if (typeof raw !== 'string') { foreign += 1; continue; }
    const gotIt = importsNameFrom(raw, other, rel, name);
    if (gotIt) {
      return { kind: 'PARSER-GAP', refs: [other] };
    }
    foreign += 1;
  }
  return { kind: 'name-clash', refs: prod.slice(0, 4), foreign };
}
/** 原文里 other 是否「经由 import 从 rel 取得 name」（named / default / NS 成员）。 */
function importsNameFrom(raw, fromRel, rel, name) {
  const dir = path.posix.dirname(fromRel);
  const norm = (spec) => (spec.startsWith('.') ? path.posix.normalize(path.posix.join(dir, spec)) : null);
  const esc = name.replace(/[$]/g, '\\$&');
  const nsLocals = [];
  for (const m of raw.matchAll(/import\s+\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (norm(m[2]) !== rel) continue;
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(seg);
      const local = as ? as[2] : seg;
      if (local === name) return true;
    }
  }
  for (const m of raw.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (norm(m[2]) === rel) nsLocals.push(m[1]);
  }
  for (const m of raw.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (norm(m[2]) !== rel) continue;
    if (m[1] === name) return true;
    nsLocals.push(m[1]);   // default 导入的对象可能以成员形式用（asset 引擎）
  }
  for (const local of nsLocals) {
    const mm = new RegExp(`(?<![\\w$.])${local.replace(/[$]/g, '\\$&')}\\s*\\.\\s*${esc}\\b`).exec(raw);
    if (mm) return true;
  }
  return false;
}
for (const e of dead) {
  const ev = evidenceOf(e.file, e.name);
  e.evidence = ev.kind;
  if (ev.refs.length) e.refs = ev.refs;
}

/* ---------- 探测器自证（fail-closed） ----------
 * PARSER-GAP = 「绑定级判据说零消费，但原文里确有 import 从该模块取了该名」。
 * 这只有一种成因：解析器漏了某种消费形态。此时若照常出表，就是把假红冻结进账本
 * （计划明令禁止：账本合法性来自它确实在放行某物）。故一律 exit 2，逼着补形态。
 */
const gaps = dead.filter((e) => e.evidence === 'PARSER-GAP');
if (gaps.length) {
  console.error(`[bind-audit] ❌ 探测器缺口 ${gaps.length} 条（绑定级判零消费，但原文确实 import 了）：`);
  for (const e of gaps.slice(0, 20)) console.error(`  ${e.file}:${e.line} ${e.name}  ← ${(e.refs || []).join(', ')}`);
  console.error('  修法：在 scripts/lib/binding-consumption.mjs 补该消费形态；不得写入基线。');
  process.exit(2);
}
const evTally = dead.reduce((acc, e) => { acc[e.evidence] = (acc[e.evidence] || 0) + 1; return acc; }, {});

/* ---------- 与基线比对 ---------- */
let baseline = { note: '', entries: [] };
if (fs.existsSync(BASELINE_PATH)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
  catch { baseline = { note: '', entries: [] }; }
}
const baseKeys = new Set(baseline.entries.map((e) => `${e.file}::${e.name}`));
const deadKeys = new Set(dead.map((e) => `${e.file}::${e.name}`));
const newly = dead.filter((e) => !baseKeys.has(`${e.file}::${e.name}`));
const revived = baseline.entries.filter((e) => !deadKeys.has(`${e.file}::${e.name}`));

if (listMode) {
  console.log(`[bind-audit] 绑定级零消费导出 ${dead.length} 条（基线 ${baseline.entries.length} / 新增 ${newly.length} / 复活 ${revived.length}）`);
  for (const e of dead) console.log(`  ${e.file}:${e.line} ${e.name}`);
  process.exit(newly.length ? 1 : 0);
}

let rc = 0;

if (updateMode) {
  baseline.entries = dead;
  baseline = {
    note: baseline.note || '',
    generated_at: new Date().toISOString(),
    generated_version_hint: process.env.RP_VERSION || 'auto',
    rule: '绑定级零消费冻结账本：新增项必须显式登记理由；条目被真接线后应清理。口径见 scripts/bind-consumption-audit.mjs 头注释。',
    entries: dead,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`[bind-audit] 已更新基线：${dead.length} 条绑定级死导出`);
  process.exit(0);
}

if (revived.length) {
  // 基线项复活 ⇒ 提示并写回（账本腐坏方向是安全的：清掉的旧项不再拦）
  console.warn(`[bind-audit] ${revived.length} 条基线项已复活（被真接线），建议 --update 清理：`);
  for (const e of revived.slice(0, 10)) console.warn(`  ${e.file}:${e.line} ${e.name}${e.why ? '  ' + e.why : ''}`);
}

if (newly.length) {
  rc = 1;
  console.error(`[bind-audit] ❌ ${newly.length} 条绑定级零消费导出未登记（名字级判绿但绑定级无消费）：`);
  for (const e of newly.slice(0, 40)) {
    console.error(`  ${e.file}:${e.line} ${e.name}  —— 补接线或写进基线（${BASELINE_PATH}）`);
  }
  if (newly.length > 40) console.error(`  … 其余 ${newly.length - 40} 条`);
}

console.log(`[bind-audit] 扫描 ${codeTexts.size} 文件 / ${totalExports} 导出 / 绑定级死 ${dead.length} / 基线 ${baseline.entries.length} / 新增 ${newly.length}`);
process.exit(rc);
