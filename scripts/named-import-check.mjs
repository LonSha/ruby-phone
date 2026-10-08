#!/usr/bin/env node
/* ============================================================
 * RubyPhone 具名导入可满足门禁（named-import gate）
 * ------------------------------------------------------------
 * 为什么存在（真浏览器逐开 82 入口实测抓到的真缺陷，不是整洁性偏好）：
 *   本仓已有两道导入面门禁，但它们**都不看具名成员**：
 *     · `syntax-check.mjs`  —— 只回答「本文件能否被解析」（node --check）；
 *     · `import-resolve-check.mjs` —— 只回答「模块**路径**存不存在」（N1）。
 *   而浏览器加载一个 `import { X } from './m.js'` 时，**模块路径存在但 X 不存在**
 *   同样是致命错误：
 *     SyntaxError: The requested module './m.js' does not provide an export named 'X'
 *   后果是**整条 import 链失败** ⇒ 该 App 点开后永远是空白（外壳不崩、无一行错）。
 *
 *   本版实测（现场，非推断）：全仓 393 个文件里恰好 6 处落空 ——
 *     · `apps/diagnose/diagnose-view.js` 从 diagnose-data 取 injectionLine /
 *       injectionVerdictText / blockLine，而那三个名字只挂在 default 对象上；
 *     · `apps/taskentry/taskentry-app.js` 从 config/task-entry.js 取 hasTabSource /
 *       tabSourceReadings / TAB_SOURCE_NOTE，而它们定义在 config/tab-source.js。
 *   ⇒ diagnose 与 taskentry 两个入口**自交付起就没打开过**，而全部门禁与套件全绿。
 *
 * 判据（N2）：产品侧（apps/ phone/ config/ index.js）每个静态具名导入的**每个名字**，
 *   必须在目标模块的**具名导出面**里。
 *   刻意**不**判 default 导入（`import X from '...'`）与命名空间导入（`import * as X`）——
 *   那两种形态不依赖具名成员，不在本条口径内。
 *
 * 刻意排除（否则门禁变噪声源）：
 *   ① 带缓存串的说明符（`./x.js?v=1`）—— 只取 `?` / `#` 之前的路径部分；
 *   ② 裸说明符（`node:fs` / `@x/y`）—— 解析责任在宿主；
 *   ③ 目标文件不在扫描面（如 tests/ 下的夹具模块）—— 不判（不在本门职责内）。
 *
 * 结构自证（N3）：扫描面文件数、具名导入条数、可判定条数三项都必须高于下限，
 *   否则 exit 2 拒判 —— 防「探测器坏了以全绿通过」。
 *
 * 负控制纪律：真源码破坏（锚点恰中 1 次）→ 写到临时副本 → **在副本上重跑同款真判据**
 *   （`--root <dir>`）。禁止对原文件断言。
 *
 * 用法：
 *   node scripts/named-import-check.mjs              # 校验（CI/发布门）
 *   node scripts/named-import-check.mjs --list       # 列出全部具名导入与判定
 *   node scripts/named-import-check.mjs --root <dir> # 校验指定目录（负控制用）
 * 退出码：0=通过  1=存在无法满足的具名导入  2=结构漂移（探测器失效）
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
if (rootIdx >= 0 && !fs.existsSync(root)) {
  console.error(`✗ --root 指向不存在的路径: ${root}`);
  process.exit(2);
}

/** 剥注释（块注释整段抹白、保留换行；行注释直接删到行尾）。
 *  ★ 与本仓其它判据同一条纪律：剥注释器是字符状态机，**不解析正则字面量** ——
 *    故本门只对 import/export 语句做抽取，不去碰字符串里的斜杠。 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) break;
      out += '\n'.repeat(src.slice(i, j).split('\n').length - 1);
      i = j + 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      if (j < 0) break;
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

/* 扫描面：产品侧三目录 + 根入口。刻意不含 tests/ 与 scripts/ ——
 *   它们的模块（夹具）大量不在同一口径下，纳入会把门禁变成噪声源。 */
const SCAN_DIRS = ['apps', 'phone', 'config'];
const SCAN_FILES = ['index.js'];
const files = [];
for (const d of SCAN_DIRS) files.push(...walk(path.join(root, d)));
for (const f of SCAN_FILES) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) files.push(p);
}

/* ---------- 1. 收集每个模块的具名导出面 ---------- */
const EXPORT_DECL_RE = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /export\s*\{([^}]*)\}/g;
const exportsOf = new Map();
const rawOf = new Map();
for (const f of files) {
  let src = '';
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  rawOf.set(f, src);
  const code = stripComments(src);
  const names = new Set();
  let m;
  EXPORT_DECL_RE.lastIndex = 0;
  while ((m = EXPORT_DECL_RE.exec(code))) names.add(m[1]);
  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(code))) {
    for (const part of m[1].split(',')) {
      const raw = part.trim();
      if (!raw) continue;
      const nm = raw.includes(' as ') ? raw.split(' as ').pop().trim() : raw;
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) names.add(nm);
    }
  }
  exportsOf.set(f, names);
}

/* ---------- 2. 逐条具名导入比对 ---------- */
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs;
const bad = [];
let importCount = 0;
let judgedCount = 0;
for (const f of files) {
  const code = stripComments(rawOf.get(f) || '');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) {
    /* 具名导入的别名方向：`import { X as Y }` 要检查的是**原名 X**（导出面里有的是 X）。
     *  ★ 本门初版在这里取了 `.pop()`（拿别名），一上线就报出 17 处「缺失」而它们**全是合法的别名导入** ——
     *  与被测对象无关的假红，属本门自身的判据缺陷（同一类别名方向错位）。修正为取原名。 */
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((raw) => (raw.includes(' as ') ? raw.split(' as ')[0].trim() : raw));
    const spec = m[2];
    importCount += 1;
    if (!spec.startsWith('.')) continue;                       // 裸说明符：宿主责任
    const base = path.resolve(path.dirname(f), spec.split('?')[0].split('#')[0]);
    if (!fs.existsSync(base)) continue;                        // 路径不在场：N1 的职责
    const avail = exportsOf.get(base);
    if (!avail) continue;                                      // 目标不在扫描面：不判
    judgedCount += 1;
    for (const raw of names) {
      const nm = raw.startsWith('type ') ? raw.slice(5).trim() : raw;
      if (!nm) continue;
      const ok = avail.has(nm);
      if (listMode) console.log(`${ok ? '✓' : '✗'} ${path.relative(root, f)} <= ${spec} (${nm})`);
      if (!ok) bad.push({ file: path.relative(root, f), spec, name: nm });
    }
  }
}

/* ---------- 3. 结构自证（fail-closed） ---------- */
const FLOOR_FILES = 300;
const FLOOR_IMPORTS = 300;
const FLOOR_JUDGED = 200;
if (files.length < FLOOR_FILES || importCount < FLOOR_IMPORTS || judgedCount < FLOOR_JUDGED) {
  console.error(`✗ [named-import] 结构漂移，探测器可能失效：文件 ${files.length}（下限 ${FLOOR_FILES}）· 具名导入 ${importCount}（下限 ${FLOOR_IMPORTS}）· 可判定 ${judgedCount}（下限 ${FLOOR_JUDGED}）`);
  process.exit(2);
}
console.log(`[named-import] 扫描 ${files.length} 个文件 · 具名导入 ${importCount} 条 · 可判定 ${judgedCount} 条`);
if (bad.length > 0) {
  console.error(`[named-import] ✗ ${bad.length} 处具名导入在目标模块里不存在（浏览器会整条 import 链失败 ⇒ App 点开是空白）：`);
  for (const b of bad) console.error(`  ✗ ${b.file}  <= ${b.spec}  (缺 ${b.name})`);
  process.exit(1);
}
console.log('[named-import] ✓ 全部具名导入均可满足');
