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
const DECL_RE = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const BRACE_RE = /^\s*export\s*\{([^}]*)\}/;
function exportsOf(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = DECL_RE.exec(lines[i]);
    if (m) { out.push({ name: m[1], line: i + 1, declLine: i }); continue; }
    const b = BRACE_RE.exec(lines[i]);
    if (b) {
      for (const part of b[1].split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const as = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(seg);
        const name = as ? as[1] : seg.replace(/^type\s+/, '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push({ name, line: i + 1, declLine: i });
      }
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

const isExternalConsumer = (rel) => EXTERNAL_CONSUMER_DIRS.some(d => rel.startsWith(d));

let totalExports = 0;
const dead = [];       // { name, file, line }
const stat = { files: 0, exports: 0, internal: 0, crossFile: 0 };
for (const f of files) {
  const src = texts.get(f.rel);
  if (typeof src !== 'string') continue;
  stat.files += 1;
  const exps = exportsOf(src);
  if (!exps.length) continue;
  totalExports += exps.length;
  // 本文件「除导出声明行以外」的正文：用于判定模块内部是否真的用了它
  const lines = src.split('\n');
  for (const e of exps) {
    stat.exports += 1;
    if (isExternalConsumer(f.rel)) { stat.internal += 1; continue; } // 豁免域直接算作已消费
    const re = wordRe(e.name);
    // v2.42.0（E6）: 内部消费按**真代码行**判定——注释/字符串里的同名提及不算消费
    const codeLines = (codeTexts.get(f.rel) || src).split('\n');
    let internal = 0;
    for (let i = 0; i < codeLines.length; i++) {
      if (i === e.declLine) continue;                 // 跳过声明行自身
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
let fail = 0;
console.log(`[dead-export] 扫描 ${stat.files} 个文件 / ${stat.exports} 个 export 声明` +
  `（内部消费 ${stat.internal} · 跨文件消费 ${stat.crossFile} · 零消费 ${dead.length}）`);
console.log(`[dead-export] 基线账本：${baseline.entries.length} 条冻结项`);

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
