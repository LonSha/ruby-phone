#!/usr/bin/env node
/* ============================================================
 * RubyPhone 静态导入可解析门禁（import-resolve gate）
 * ------------------------------------------------------------
 * 为什么存在（本轮实测抓到的真缺陷）：
 *   本仓的语法门 `syntax-check.mjs` 只做 `node --check` —— 它回答「这个文件
 *   自己能不能被解析」，**不回答「它 import 的东西存不存在」**。
 *   于是下面这种错误语法完全正确、门禁全绿、日志无痕：
 *
 *     apps/games/sudoku/sudoku-view.js:5
 *       import { childRuntime } from '../../config/runtime-lifecycle.js';
 *                                                          ~~~~ 少退一层
 *
 *   真实路径是 apps/games/sudoku/ → 需 '../../../config/'。
 *   后果：浏览器加载 sudoku-view.js 时抛
 *     TypeError: Failed to resolve module specifier / 404
 *   → games-app.js（它 `import { SudokuView } from './sudoku/sudoku-view.js'`）
 *     整条 import 链失败 → **游戏大厅整个 App 打不开**（不是数独单独坏）。
 *   而这行是 v2.28.0 引入实例级资源域时写下的，此后 v2.29~v2.81 共 50 余版
 *   全绿通过 —— 因为没有任何门禁看 import 路径。
 *
 * 判据（N1）：产品侧（apps/ phone/ config/ index.js workers/ assets/vendor/）
 *   每个 .js/.mjs 的**静态**相对导入说明符（import ... from / import '...' /
 *   export ... from）必须能在文件系统上解析到真实文件。
 *
 * 刻意排除（否则门禁变成噪声源，重蹈 v2.33「恒非零告警会被学会忽略」）：
 *   ① 带缓存串的说明符（`./x.js?v=1.2.3&r=...`）—— 浏览器/宿主合法，
 *      本地文件系统当然不认；判据只取 `?` / `#` 之前的路径部分；
 *   ② 裸说明符（'node:fs' / '@x/y'）—— 解析责任在宿主，不在仓库；
 *   ③ **动态** `import('...')` —— 本仓用它写「多路兜底」
 *      （如 worldbook-manager 先试 `/scripts/world-info.js`，失败再试相对路径），
 *      设计上允许失败，故不计入 N1（N1 只对静态链 fail-closed）。
 *
 * 负控制纪律：真源码破坏（锚点恰中 1 次）→ 写到临时副本 →
 *   **在副本上重跑同款真判据**（`--root <dir>`）。禁止对原文件断言。
 *
 * 用法：
 *   node scripts/import-resolve-check.mjs              # 校验（CI/发布门）
 *   node scripts/import-resolve-check.mjs --list       # 列出全部导入与解析结果
 *   node scripts/import-resolve-check.mjs --root <dir> # 校验指定目录（负控制用）
 * 退出码：0=通过  1=存在无法解析的静态相对导入  2=结构漂移（探测器失效）
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
// 夹具通道：负控制测试塞合成小仓库时放宽枚举下限
const FIXTURE_MODE = process.env.RP_IMPORT_FIXTURE === '1';

if (rootIdx >= 0 && !fs.existsSync(root)) {
  console.error(`✗ --root 指向不存在的路径: ${root}`);
  process.exit(2);
}

const SCOPE_DIRS = ['apps', 'phone', 'config', 'workers', 'assets/vendor'];
const ROOT_FILES = ['index.js'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'tests']);
const EXT = new Set(['.js', '.mjs']);

/* ---------- 收集扫描面 ---------- */
const files = [];
for (const f of ROOT_FILES) {
  const abs = path.join(root, f);
  if (fs.existsSync(abs)) files.push(abs);
}
for (const d of SCOPE_DIRS) {
  const base = path.join(root, d);
  if (!fs.existsSync(base)) continue;
  (function walk(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (EXT.has(path.extname(e.name))) files.push(abs);
    }
  })(base);
}

/* ---------- 结构守卫：枚举面必须真的存在 ---------- */
// 扫描不到入口文件 = 探针坏了（或 --root 指错了地方）。此时任何出口都不可信，必须拒判。
// 注意：本守卫**不因传了 --root 而放宽** —— 那会让「--root 指到空目录」以 0 退出，
//   正是「探针坏了还发合格证」的形态。夹具模式（RP_IMPORT_FIXTURE=1）才放宽。
if (!FIXTURE_MODE) {
  const idxAbs = path.join(root, 'index.js');
  if (!fs.existsSync(idxAbs)) {
    console.error(`[import-resolve] 在 ${root} 找不到 index.js —— 扫描面不存在，fail-closed 拒判`);
    process.exit(2);
  }
  /* [v3.3.2 · O-3 下游侧] **入口被掏空**这一档原先漏了：index.js 若只剩一行注释，
   *   本门仍能从 apps/ 里枚举到 100+ 个文件与 150+ 个说明符 ⇒ 两道下限都过 ⇒ exit 0。
   *   实测：掏空 index.js 后本门报「✓ 全部静态相对导入均可解析」（把「入口没了」读成「都解析得开」）。
   *   补「入口非退化」守卫（与 scripts/syntax-check.mjs 同口径、同失败码语义）。 */
  const MIN_ENTRY_BYTES = 1000;
  const entrySize = fs.statSync(idxAbs).size;
  if (entrySize < MIN_ENTRY_BYTES) {
    console.error(`[import-resolve] index.js 仅 ${entrySize} 字节（下限 ${MIN_ENTRY_BYTES}）—— 入口已退化，fail-closed 拒判`);
    process.exit(2);
  }
}
if (!files.length) {
  console.error('[import-resolve] 未枚举到任何待检文件 —— 探测器失效，fail-closed 拒判');
  process.exit(2);
}

/* ---------- 去注释/去字符串：只在**代码**里找 import ----------
 * 必要性：本仓有大量 JSDoc 里的类型引用（`@param {import('./x.js').T}`），
 *   以及测试夹具里作为**字符串内容**出现的 import 语句。若不剥离，
 *   会把「文档里提到的路径」当成「代码要加载的路径」→ 假阳性。
 * 局限（已知）：不处理正则字面量里的引号（本仓这些文件的 import 语句
 *   不在正则字面量内）；若将来出现在场，须升级为词法扫描。 */
function stripCommentsAndStrings(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === '//') { while (i < n && src[i] !== '\n') i++; continue; }
    if (two === '/*') { i += 2; while (i < n && src.slice(i, i + 2) !== '*/') i++; i += 2; continue; }
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      // 保留字符串**本身**（说明符就在里面），但先原样搬到 out
      const q = ch;
      out.push(ch); i++;
      while (i < n) {
        if (src[i] === '\\') { out.push(src[i] + (src[i + 1] || '')); i += 2; continue; }
        out.push(src[i]);
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '`') {
      // 模板串：内容不可静态解析，整段丢弃（其中不可能有静态 import 说明符）
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { depth--; i++; continue; }
        i++;
      }
      out.push('`TEMPLATE`');
      continue;
    }
    out.push(ch); i++;
  }
  return out.join('');
}

const STATIC_RES = [
  // import ... from '...'  /  import '...'
  /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  // export ... from '...'
  /export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g
];

const problems = [];
const allRows = [];
let specCount = 0;
let dynamicCount = 0;

for (const f of files) {
  let raw = '';
  try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const src = stripCommentsAndStrings(raw);
  const seen = new Set();
  for (const re of STATIC_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;          // 裸说明符：宿主负责
      const clean = spec.split('?')[0].split('#')[0];
      if (!clean) continue;
      if (seen.has(spec)) continue;
      seen.add(spec);
      specCount += 1;
      const abs = path.resolve(path.dirname(f), clean);
      const ok = fs.existsSync(abs);
      const rel = path.relative(root, f);
      allRows.push({ file: rel, spec, resolved: path.relative(root, abs), ok });
      if (!ok) problems.push({ file: rel, spec, resolved: path.relative(root, abs) });
    }
  }
  // 动态导入仅计数（设计上允许失败，见文件头说明）
  const dyn = src.match(/import\s*\(/g);
  if (dyn) dynamicCount += dyn.length;
}

/* ---------- L2：枚举面自证 ---------- */
// 低于下限即视为探测器失效（防「正则被改坏了 → 全仓 0 命中 → 全绿通过」）
const MIN_SPECS = 150;
if (!FIXTURE_MODE && specCount < MIN_SPECS) {
  console.error(`[import-resolve] 只解析出 ${specCount} 个静态相对导入说明符` +
    `（低于下限 ${MIN_SPECS}）—— 枚举器或外部结构已失效，fail-closed 拒判`);
  process.exit(2);
}
if (!FIXTURE_MODE && files.length < 100) {
  console.error(`[import-resolve] 只枚举到 ${files.length} 个文件（低于下限 100）—— fail-closed 拒判`);
  process.exit(2);
}

/* ---------- 输出 ---------- */
console.log(`[import-resolve] 扫描 ${files.length} 个文件 · 静态相对导入 ${specCount} 条 · ` +
  `动态 import(${dynamicCount}) 条（设计上允许失败，不计入判据）`);
if (listMode) {
  console.log('\n── 静态相对导入解析明细 ──');
  for (const r of allRows) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.file}\n      '${r.spec}'  →  ${r.resolved}`);
  }
  process.exit(0);
}
if (problems.length) {
  console.error(`[import-resolve] ✗ 发现 ${problems.length} 条无法解析的静态相对导入：`);
  for (const p of problems) {
    console.error(`    ${p.file}\n        import '${p.spec}'\n        → ${p.resolved}  (不存在)`);
  }
  console.error('  修法：把路径改成相对**本文件所在目录**的正确层级（数一数 ../ 的个数），' +
    '或确认目标文件是否已被移动/改名。注意：语法门不会报这个错 —— 文件本身语法完全正确，' +
    '坏的是加载链。');
  process.exit(1);
}
console.log('[import-resolve] ✓ 全部静态相对导入均可解析');
