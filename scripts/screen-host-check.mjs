#!/usr/bin/env node
/* ============================================================
 * RubyPhone 外壳宿主纪律门禁（screen-host gate）
 * ------------------------------------------------------------
 * 为什么存在（真浏览器逐开 82 入口实测抓到的真缺陷，不是整洁性偏好）：
 *   `.phone-screen` 是**常驻外壳**：`.view-stack-container`（图层栈）、
 *   `#phone-back-button`（返回键）、`.phone-home-indicator`（小白条）都是它的直系子节点。
 *   App 的内容应写进**图层**（`[data-view-id]`），走 setContent 或 layerHost。
 *
 *   一旦某个 view 写 `this.container.innerHTML = html` 而 container 是 `.phone-screen`，
 *   它就把上述三件**一并抹掉**：栈没了之后 `setContent` 会以为自己是首帧而重建空栈，
 *   但返回键与小白条**再无任何路径加回来**（createInPanel 只在建壳时渲染一次）。
 *   用户表现：点开这个 App，手机从此没有返回键、无法回到桌面。
 *
 *   本版实测（现场，非推断）：19 个入口有此形态 ——
 *     playbook / achievement / xhs / tieba / health / memory / graph / peek /
 *     bilibili / theater / place / cheat / dirtytalk / wallet / profile /
 *     plotline / chars / asset / diagnose。
 *   而 v3.61.0 已经在 setContent **自己**那条路径上修过同一形态（那里的注释
 *   逐字写着「进了 App 左上角没有返回键」）—— 修了一条路径、漏了 19 个调用方。
 *
 * 判据（S1）：`apps/**` 里不得出现「把内容写进外壳 screen」的写法：
 *   · `view.render(<shell>.screen)` / `.render(<shell>?.screen)`
 *   · `<shell>.screen.innerHTML =` / `.appendChild(` / `.replaceChildren(`
 *   合法写法：`view.render(<shell>.layerHost?.('x-main') || <shell>.screen)` ——
 *   它的**回退**是 screen，但那只在「壳里没有栈」的单元测试夹具里成立，
 *   且写法显式（`layerHost?.(...) ||`）为门禁所识别。
 *   ⇒ 门禁只判「**直接**以 screen 作宿主」，不判「以 screen 作回退」。
 *
 * 结构自证（S2）：扫描面文件数、`layerHost` 使用点数、可识别宿主表达式数
 *   三项都需高于下限，否则 exit 2 拒判。
 *   `layerHost` 计数是**正向自证**：若某个版本把 layerHost 整个删了，
 *   本门不能“恰好零违规”而全绿 —— 那正是 fail-open。
 *
 * 负控制纪律：真源码破坏（锚点恰中 1 次）→ 临时副本 → 副本上重跑同款真判据
 *   （`--root <dir>`）。禁止对原文件断言。
 *
 * 用法：
 *   node scripts/screen-host-check.mjs              # 校验
 *   node scripts/screen-host-check.mjs --list       # 列出全部命中
 *   node scripts/screen-host-check.mjs --root <dir> # 校验指定目录（负控制用）
 * 退出码：0=通过  1=存在直接写外壳的调用点  2=结构漂移（探测器失效）
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
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(root, 'apps'));

/* 外壳表达式：`this.phoneShell` / `this.shell` / `this.app.phoneShell` / 变量名 shell|phoneShell。
 *   刻意写成「标识符链 + .screen」而不是白名单式枚举 —— 新写法（如 `const sh = this.shell; sh.screen`）
 *   也落得进判据；但为避免噪声，只接受**以 shell/phoneShell 结尾的标识符链**。 */
const SHELL_SCREEN = String.raw`(?:[A-Za-z_$][\w$]*\.)*(?:phoneShell|shell)(?:\?\.|\.)screen`;
const DIRECT_RULES = [
  { id: 'render-into-screen', re: new RegExp(String.raw`\.render\s*\(\s*${SHELL_SCREEN}\s*\)`, 'g') },
  { id: 'screen-innerHTML', re: new RegExp(String.raw`${SHELL_SCREEN}(?:\?\.)?\.(?:innerHTML|textContent)\s*=\s*(?!=)`, 'g') },
  { id: 'screen-appendChild', re: new RegExp(String.raw`${SHELL_SCREEN}(?:\?\.)?\.(?:appendChild|replaceChildren|insertAdjacentHTML)\s*\(`, 'g') },
];
const FALLBACK_RE = new RegExp(String.raw`layerHost\s*\?\.?\s*\(`, 'g');

const hits = [];
let layerHostCount = 0;
for (const f of files) {
  let src = '';
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripComments(src);
  const lineOf = (idx) => code.slice(0, idx).split('\n').length;
  FALLBACK_RE.lastIndex = 0;
  while (FALLBACK_RE.exec(code)) layerHostCount += 1;
  for (const rule of DIRECT_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code))) {
      /* \u540c\u4e00\u884c\u5185\u5e26 `layerHost` \u56de\u9000\u7684\u5199\u6cd5\u7b97\u5408\u6cd5\uff1a
       *   `view.render(shell.layerHost?.('x-main') || shell.screen)` \u2014\u2014
       *   \u5b83\u4ee5\u56fe\u5c42\u4e3a\u5bbf\u4e3b\uff0cscreen \u53ea\u662f\u65e0\u58f3\u5939\u5177\u4e0b\u7684\u56de\u9000\u3002 */
      const lineStart = code.lastIndexOf('\n', m.index) + 1;
      const lineEnd = code.indexOf('\n', m.index);
      const line = code.slice(lineStart, lineEnd < 0 ? code.length : lineEnd);
      if (/layerHost/.test(line)) continue;
      hits.push({ file: path.relative(root, f), line: lineOf(m.index), rule: rule.id, text: line.trim().slice(0, 120) });
    }
  }
}

/* ---------- 结构自证（fail-closed） ---------- */
const FLOOR_FILES = 250;
const FLOOR_LAYERHOST = 15;
if (files.length < FLOOR_FILES) {
  console.error(`✗ [screen-host] 结构漂移：apps/** 只扫到 ${files.length} 个 .js（下限 ${FLOOR_FILES}）`);
  process.exit(2);
}
if (layerHostCount < FLOOR_LAYERHOST) {
  console.error(`✗ [screen-host] 正向自证失败：全仓 \`layerHost\` 使用点仅 ${layerHostCount}（下限 ${FLOOR_LAYERHOST}）。` +
    '若层宿主机制被移除，本门会「零违规」而全绿 —— 那是 fail-open，必须拒判。');
  process.exit(2);
}
if (listMode) for (const h of hits) console.log(`✗ ${h.file}:${h.line} [${h.rule}] ${h.text}`);
console.log(`[screen-host] 扫描 ${files.length} 个文件 · layerHost 使用点 ${layerHostCount} · 直接写外壳的调用点 ${hits.length}`);
if (hits.length > 0) {
  console.error('[screen-host] ✗ 以下调用点把内容直接写进 .phone-screen（会连同图层栈 / 返回键 / 小白条一起抹掉）：');
  for (const h of hits) console.error(`  ✗ ${h.file}:${h.line} [${h.rule}] ${h.text}`);
  process.exit(1);
}
console.log('[screen-host] ✓ 无 App 直接写外壳');
