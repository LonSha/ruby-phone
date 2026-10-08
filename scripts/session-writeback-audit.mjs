/* ============================================================
 * scripts/session-writeback-audit.mjs — R-O3「跨会话异步写回统一栅栏」静态门
 * ------------------------------------------------------------
 * 为什么单独立一道门（与 tests/system-v3580.test.mjs 的分工）：
 *   · v3580 是**接线面**判据：令牌与栅栏成对在场、域名逐条对账、真源码破坏负控制
 *     （摘掉栅栏 / 只设栅栏不记令牌）。
 *   · 本门治的是**时序面**：v3580 判不出「令牌记在了第一次 await **之后**」——
 *     那种写法令牌与栅栏都「在场且成对」，但语义已废：
 *       回来时才取身份 ⇒ 取的必然是「现在」⇒ 栅栏**恒判当前** ⇒ 等于没建。
 *     这正是本仓最贵的一族假绿（**接线在场，语义已死**）。
 *
 * ★ 本工具的判据在第一版上**自己踩了两个坑**，记在这里以免复刻：
 *   ① 第一版用「向上找最近的函数声明行」当作用域边界 —— 结果 `if (...) {`
 *      与内层 `forEach((x) => {` 都被当成「函数头」，作用域被切碎，
 *      17 处**正确代码**被判成「有栅栏无令牌」（假红）。判据错会把好代码逼着改坏。
 *   ② 第一版没剥注释 —— 本仓注释极密且含中文括号，靠数括号定作用域必错。
 *   修法：**先剥注释与字符串，再用括号配平**定「包含该行的最内块」——
 *   从该行向上扫，遇到使深度转负的那个 `{` 所在行即块首。这样嵌套块与
 *   `if` / `try` / 回调块、函数体**同等对待**，正是本门要的口径
 *   （判的是「同一块内」，不是「同一个函数内」）。
 *   ★ 顺带一条结论校准：修好判据后，本门对**同一批代码**的结论从 17 红
 *     变成 0 红 —— 说明第一版测的是它自己写错的地方，不是产品。
 *
 * 判据（每个写回口逐条核）：
 *   ① 捕获时机：`captureSessionToken(` 所在块内、该行**之前**不得有 `await`
 *      （有则报出 await 行号：令牌记晚了，栅栏会恒判当前）。
 *   ② 成对且次序对：每个 `guardSessionWrite(` 所在块内必须有捕获点，
 *      且捕获行 < 栅栏行。
 *   ③ 拒绝必撤：`if (!guardSessionWrite(...))` 形态的拒绝块内必须有 `return`/`throw`。
 *      （另一种合法形态「`if (guard(...)) { 写 }`」不适用本条 —— 它只在通过时才写。）
 *   ④ 覆盖下限：捕获点总数不得少于下限（防写回口被删到只剩一个还全绿）。
 *
 * 纪律：本门只读、不改代码。退出码：0 = 全过；1 = 有违规。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* `--root=<dir>`：把扫描面指到别处 —— 供 `tests/system-v3740.test.mjs` 的
 *   真源码破坏负控制使用（在**临时夹具树**上跑同款判据，真仓全程只读）。
 *   不传则按脚本位置定位仓库根（与既有静态门同口径）。 */
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const ROOT = rootArg ? path.resolve(rootArg.slice('--root='.length)) : path.resolve(HERE, '..');

/** 扫描面：生产 .js（排除 node_modules / .git / `_` 前缀探针）。 */
function walk(dir, out = []) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const e of names) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') && !e.name.startsWith('_')) out.push(p);
  }
  return out;
}

/** 剥注释与字符串（保留换行以维持行号）——
 *   为什么非剥不可：本仓注释密且含中文括号与 `await` 字样，不剥则括号配平必错、
 *   `await` 探测会把注释里的说明算成真 await（第一版就是这么假红的）。
 *
 *   ★ 第二版在这里又踩一坑：**没处理正则字面量**。像 `/['"]/` 这种正则在
 *     "引号开字符串"的朴素扫描里会被当成字符串起点，此后整个文件的状态机错位，
 *     把后面**真**的 `captureSessionToken(` 一起抹掉 —— 于是捕获点从 16 静默
 *     掉到 14（honey / moments 两处写回口凭空消失），而工具仍报「✓ 全过」。
 *     这就是本仓最贵的那类错：**判据被掏空却不报**。
 *   修法两条：
 *     ① 加正则字面量识别（按"上一个有意义字符"启发式判断 `/` 是除号还是正则起点，
 *        并正确处理字符类 `[...]` 内的 `/`）；
 *     ② 另加**判据纯度自证**（见下方 purity 检查）：raw 命中数 > 剥后命中数时
 *        直接判红并报出行号 —— 剥器再吃真调用，本门会自己喊出来，不再静默少报。
 *   模板字面量仍按朴素字符串处理（`${}` 内部一并抹成空白）：本门要量的两个符号
 *   不会出现在插值表达式里，且抹白保持括号配平，是**保守且安全**的一侧。 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inBlock = false;
  let inLine = false;
  let quote = null;
  let prev = '';
  const isRegexStart = (p) => !p || '(,=:[!&|?{};+-*%^~<>'.includes(p);
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inBlock) {
      if (c === '*' && c2 === '/') { inBlock = false; out += '  '; i += 2; continue; }
      out += (c === '\n') ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (inLine) {
      if (c === '\n') { inLine = false; out += '\n'; i += 1; continue; }
      out += ' ';
      i += 1;
      continue;
    }
    if (quote) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) { quote = null; out += ' '; i += 1; continue; }
      out += (c === '\n') ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (c === '/' && c2 === '*') { inBlock = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '/') { inLine = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'") { quote = c; out += ' '; i += 1; prev = c; continue; }
    /* ── 模板字面量：必须支持 `${}` 嵌套模板 ──
     *   第三版在这里再踩一坑：把反引号当朴素字符串、扫到下一个反引号为止。
     *   但本仓大量使用「模板串里嵌 `${cond ? `…` : ''}`」这种嵌套模板，
     *   朴素扫法会在内层反引号处提前闭合、状态机错位，把后面**真**的
     *   `captureSessionToken(` 一起抹掉（weibo-view 2127 处凭空消失，工具仍报 ✓，
     *   与正则那一坑同形）。修法：用**栈**维护「模板层 / 表达式层」两种模式，
     *   `${` 进表达式层、配对的 `}` 退回模板层。 */
    if (c === '`') {
      out += ' ';
      i += 1;
      /* stack 元素：{ kind:'tpl' } 或 { kind:'expr', depth:number } */
      const stack = [{ kind: 'tpl' }];
      while (i < n && stack.length) {
        const top = stack[stack.length - 1];
        const d = src[i];
        const d2 = src[i + 1];
        if (d === '\\') { out += '  '; i += 2; continue; }
        if (top.kind === 'tpl') {
          if (d === '`') { out += ' '; i += 1; stack.pop(); continue; }
          if (d === '$' && d2 === '{') { out += '  '; i += 2; stack.push({ kind: 'expr', depth: 0 }); continue; }
          out += (d === '\n') ? '\n' : ' ';
          i += 1;
          continue;
        }
        /* 表达式层：注释 / 字符串 / 嵌套模板 / 花括号深度 */
        if (d === '/' && d2 === '*') {
          out += '  '; i += 2;
          while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n') ? '\n' : ' '; i += 1; }
          out += '  '; i += 2; continue;
        }
        if (d === '/' && d2 === '/') {
          out += '  '; i += 2;
          while (i < n && src[i] !== '\n') { out += ' '; i += 1; }
          continue;
        }
        if (d === '`') { out += ' '; i += 1; stack.push({ kind: 'tpl' }); continue; }
        if (d === '"' || d === "'") {
          const q2 = d;
          out += ' '; i += 1;
          while (i < n && src[i] !== q2) {
            if (src[i] === '\\') { out += '  '; i += 2; continue; }
            if (src[i] === '\n') break;
            out += ' '; i += 1;
          }
          out += ' '; i += 1; continue;
        }
        if (d === '{') { top.depth += 1; out += ' '; i += 1; continue; }
        if (d === '}') {
          if (top.depth === 0) { out += ' '; i += 1; stack.pop(); continue; }
          top.depth -= 1; out += ' '; i += 1; continue;
        }
        out += (d === '\n') ? '\n' : ' ';
        i += 1;
      }
      prev = '`';
      continue;
    }
    if (c === '/' && isRegexStart(prev)) {
      out += ' ';
      i += 1;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { out += '  '; i += 2; continue; }
        if (d === '\n') break; // 未闭合：就地退出，别把后续整片吃掉
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { out += ' '; i += 1; break; }
        out += ' ';
        i += 1;
      }
      prev = '/';
      continue;
    }
    out += c;
    i += 1;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

/** 包含 `lines[idx]` 的所有块首行（**升序**：最外层在前，最内层在后）。
 *  口径：块首 = 从该行向上扫，深度转负的那个 `{` 所在行。找不到（顶层）不含 -1。 */
function ancestorBlocks(lines, idx) {
  const out = [];
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const l = lines[i];
    for (let k = l.length - 1; k >= 0; k--) {
      const ch = l[k];
      if (ch === '}') depth += 1;
      else if (ch === '{') {
        depth -= 1;
        if (depth < 0) { out.push(i); depth = 0; }
      }
    }
  }
  return out.reverse(); // 升序：外层 -> 内层
}

/** 块尾：从块首行向下配平，深度回到 0 的那一行即块尾（找不到返回 lines.length-1）。
 *  ★ 必须从**块首行最后一个 `{`** 起算 —— 第四版在这里又踩一坑：本仓大量函数签名
 *    带对象默认值（`async f(options = {}) {`）与解构参数，从行首起算会在参数里的
 *    `{}` 上把 depth 打回 0，函数据此被判成「只有一行」，于是「同函数内有没有栅栏」
 *    永远判假 —— 4 处正确代码被误报成「写回口裸奔」。 */
function blockEnd(lines, start) {
  const first = lines[start];
  const lastOpen = first.lastIndexOf('{');
  if (lastOpen < 0) return start;
  let depth = 1;
  for (let i = start; i < lines.length; i++) {
    const from = i === start ? lastOpen + 1 : 0;
    const l = lines[i];
    for (let k = from; k < l.length; k++) {
      const ch = l[k];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

/** 该块是否以「提前退出」收尾（return / throw / break / continue）。
 *  用途：`if (!x) { …; await …; return; }` 这类**已返回的兄弟分支**里的 await
 *  不可能排在后面的令牌捕获点之前执行 —— 它不是「记晚了」，是根本不在这条路上。
 *  第一版没做这一步，把 moments-view 那条**正确**写法判成红（判据过严 = 假红）。 */
function blockExits(lines, bs, be) {
  for (let i = be; i > Math.max(bs, be - 14); i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^\}/.test(t)) continue;
    return /\b(return|throw|break|continue)\b/.test(t);
  }
  return false;
}

/** 指定起点的块尾（col 为该行上开括号的下标）——`blockEnd` 只认「块首行最后一个 `{`」，
 *  拒绝体判定时需要精确从 if 体那个 `{` 起算，故另开一个按列定位的版本。 */
function blockEndAt(lines, start, col) {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    const from = i === start ? col : 0;
    for (let k = from; k < l.length; k++) {
      const ch = l[k];
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) return i; }
    }
  }
  return lines.length - 1;
}

/** 栅栏拒绝体的撤离判定 → 'ok' | 'bad' | 'none'（非 `!guard` 形态或找不到拒绝体）。
 *
 *  ★ 判据的这一版是**负控制逼出来的**（tests/system-v3740.test.mjs 的 N3）：
 *    上一版只检查「栅栏行往后 8 行里有没有 return/throw/break/continue」——
 *    把 diary 那条破坏成 `if (!guard(…)) { latest = null; }` 之后，
 *    紧跟其后的**兄弟行** `if (String(latest?.generationId…) !== …) return latest;`
 *    里的 return 被算成了撤离动作，判据照样全绿。
 *    这正是「判据过宽 = 假绿」的教科书形态：看的是**别处的** return。
 *    正确口径：撤离动作必须落在**拒绝体自己**里面 ——
 *      · 语句形态（`if (!guard(…)) return x;`）：该语句内必须有撤离关键字；
 *      · 块形态（`if (!guard(…)) { … }`）：块必须**以撤离收尾**（`blockExits`），
 *        或（同行收尾的紧凑写法）块内文本含撤离关键字。
 */
function rejectionRetreat(lines, i) {
  /* 只治 `if (!guard…` 这一种形态。另一种合法形态「通过才写」
     （`if (isAuto && guardSessionWrite(…)) this.setAutoLastFloor(…)`）不适用本条：
     它不在通过前写任何东西，没有「拒绝后还在往下走」的问题。判据不做形态越权。 */
  if (!/if\s*\(\s*!\s*guardSessionWrite/.test(lines.slice(i, Math.min(i + 3, lines.length)).join(' '))) return 'none';
  /* 先配平**条件括号**，再看 `)` 之后紧跟的是 `{`（块形态）还是语句（语句形态）。
     ★ 这里踩过第三坑：上一版把「块首行第一个 depth 归 0 的 `{`」当块体 ——
       `if (!guard(…)) return { title, posts: mergedPosts, generatedAt: Date.now() };`
       里那个 **对象字面量** 的 `{` 被认成了块体，于是「块」在同一行就闭合、
       块尾行文本是 `return {…};` 含 return 反而判 ok，而**多行对象字面量**
       （weibo-data 三处 `return {\n comments: [],\n …};`）被判「块不以撤离收尾」→ 3 处假红。
       正确判法：条件括号配平之后，`)` 后第一个非空字符才是形态分叉点。 */
  let depth = 0;
  let after = null; // { li, k }：条件右括号 ) 之后的位置
  for (let li = i; li < Math.min(i + 12, lines.length); li += 1) {
    const l = lines[li];
    const from = li === i ? Math.max(0, l.indexOf('if') + 2) : 0;
    for (let k = from; k < l.length; k += 1) {
      const ch = l[k];
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) { after = { li, k }; break; } }
    }
    if (after) break;
  }
  if (!after) return 'none';
  /* 从右括号之后找第一个非空字符 */
  let cur = { li: after.li, k: after.k + 1 };
  for (; cur.li < Math.min(i + 14, lines.length); cur = { li: cur.li + 1, k: 0 }) {
    const l = lines[cur.li];
    let k = cur.k;
    while (k < l.length && /\s/.test(l[k])) k += 1;
    if (k < l.length) { cur = { li: cur.li, k }; break; }
  }
  const tailLines = lines.slice(i, Math.min(i + 14, lines.length));
  const chAt = lines[cur.li] ? lines[cur.li][cur.k] : '';
  if (chAt === '{') {
    const be = blockEndAt(lines, cur.li, cur.k);
    if (be === cur.li) {
      const tail = lines[cur.li].slice(cur.k + 1);
      return /\b(return|throw|break|continue)\b/.test(tail) ? 'ok' : 'bad';
    }
    return blockExits(lines, cur.li, be) ? 'ok' : 'bad';
  }
  /* 语句形态：从右括号到语句分号之间的文本里必须有撤离关键字。
     ★ 分号探测要**跳过对象字面量内层**：`return { a: 1 };` 的 `{`…`}` 之间
       允许出现分号（对象方法、多语句数组元素），不能在那儿截断。 */
  let brace = 0;
  for (let li = cur.li; li < Math.min(i + 14, lines.length); li += 1) {
    const l = lines[li];
    const startK = li === cur.li ? cur.k : 0;
    for (let k = startK; k < l.length; k += 1) {
      const ch = l[k];
      if (ch === '{') brace += 1;
      else if (ch === '}') brace -= 1;
      else if (ch === ';' && brace <= 0) {
        const stmt = lines.slice(cur.li, li + 1).join('\n');
        return /\b(return|throw|break|continue)\b/.test(stmt) ? 'ok' : 'bad';
      }
    }
  }
  /* 没有分号（块尾）也能收：看这小段有没有撤离关键字 */
  return /\b(return|throw|break|continue)\b/.test(tailLines.join('\n')) ? 'ok' : 'bad';
}

/** 从 idx 向外找最近的**函数形态**块首（`=> {` / `function` / `name(...) {` / `async ...(`）。
 *  找不到则退到最外层块首（-1 表示顶层）。用途：捕获时机要在**函数内**判，
 *  而不是在某个 `if` / `try` 里判 —— 否则 `const token` 写在函数开头、
 *  第一个 await 在后面的 try 里，就会被误判成「记晚了」。 */
function functionAncestor(lines, idx) {
  const a = ancestorBlocks(lines, idx);
  for (let i = a.length - 1; i >= 0; i--) {
    const l = lines[a[i]];
    if (/=>\s*\{/.test(l) || /\bfunction\b/.test(l)
      || /^\s*(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(l)) return a[i];
  }
  return a.length ? a[0] : -1;
}

const files = [
  ...walk(path.join(ROOT, 'apps')),
  ...walk(path.join(ROOT, 'config')),
  path.join(ROOT, 'index.js'),
].filter((f) => fs.existsSync(f));

const problems = [];
let capturePoints = 0;
let guardPoints = 0;
const perFile = [];
/* ⑤ 逐写回口配对：记录「有捕获点但同函数内无栅栏点」的单位（文件:行）。 */
const unpaired = [];

for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  if (rel === 'config/session-gate.js') continue; // 栅栏本体（定义处不适用本门）
  let raw = '';
  try { raw = fs.readFileSync(abs, 'utf8'); } catch (_e) { continue; }
  if (!raw.includes('captureSessionToken')) continue;
  const stripped = stripCommentsAndStrings(raw);
  const lines = stripped.split('\n');

  /* ── 判据纯度自证（防剥器吃掉真调用而本门静默少报）──
     口径：真调用**必然**出现在代码里，`import { captureSessionToken }` 这一类
     语句也让 raw 命中数 ≥ 剥后命中数。若 raw 里出现的**真调用形态**
     （非注释行、非 import 行）数量大于剥后数量，说明剥器把真调用当字符串抹掉了
     ⇒ 直接判红（这是**本工具自己**的缺陷，不是产品缺陷，但一样不许静默）。 */
  const rawCodeHits = raw.split('\n').filter((l) => {
    const t = l.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
    if (/^import\b/.test(t)) return false;
    return /\bcaptureSessionToken\s*\(/.test(l);
  }).length;
  const strippedHits = (stripped.match(/\bcaptureSessionToken\s*\(/g) || []).length;
  if (rawCodeHits > strippedHits) {
    problems.push(`${rel} 判据纯度自证失败：代码行里真调用 ${rawCodeHits} 处，剥注释后只剩 ${strippedHits} 处 ——`
      + ' 剥器把真调用抹掉了（本门会静默少报写回口）。这是**工具缺陷**，先修剥器再谈结论。');
  }
  const rawGuardHits = raw.split('\n').filter((l) => {
    const t = l.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
    if (/^import\b/.test(t)) return false;
    return /\bguardSessionWrite\s*\(/.test(l);
  }).length;
  const strippedGuardHits = (stripped.match(/\bguardSessionWrite\s*\(/g) || []).length;
  if (rawGuardHits > strippedGuardHits) {
    problems.push(`${rel} 判据纯度自证失败（栅栏侧）：代码行 ${rawGuardHits} 处，剥注释后只剩 ${strippedGuardHits} 处`);
  }

  /* ── 捕获点 ── */
  const capLines = [];
  lines.forEach((l, i) => { if (/\bcaptureSessionToken\s*\(/.test(l)) capLines.push(i); });
  capturePoints += capLines.length;

  for (const ci of capLines) {
    /* 捕获时机在**函数**范围内判（不是在内层 if/try 里判）：
       `const token = capture…()` 常写在函数开头，第一个 await 在其后的 try 内 ——
       那是**正确**写法（令牌已在任何等待之前记下），不能判红。 */
    const fStart = functionAncestor(lines, ci);
    const late = [];
    for (let i = fStart + 1; i < ci; i++) {
      if (!/\bawait\b/.test(lines[i])) continue;
      /* 只算**可达**的 await：若该 await 位于一个已提前退出的兄弟分支内
         （`if (...) { … await …; return; }`），它不在这条路上，不算「记晚了」。
         判法：取该 await 的最内层块首/块尾，块尾是 return/throw/break/continue
         且块尾 < 捕获行 ⇒ 该分支已收尾，跳过。 */
      const aBs = ancestorBlocks(lines, i);
      const abs = aBs.length ? aBs[0] : -1;
      const innermost = aBs.length ? aBs[aBs.length - 1] : -1;
      if (innermost >= 0) {
        const be = blockEnd(lines, innermost);
        if (be < ci && blockExits(lines, innermost, be)) continue;
      }
      if (abs >= 0 && abs > fStart && blockExits(lines, abs, blockEnd(lines, abs)) && blockEnd(lines, abs) < ci) continue;
      late.push(i + 1);
    }
    if (late.length) {
      problems.push(`${rel}:${ci + 1} 捕获时机过晚 —— 令牌记在 await 之后（同函数内先 await 的行：${late.join(', ')}）；`
        + '回来时取的必然是「现在」，栅栏会恒判当前（接线在场、语义已死）');
    }
  }

  /* ── 栅栏点 ──
     成对判定用**块包含关系**（不是"同一块"）：令牌可能记在外层块（函数头）、
     栅栏在内层块（try 里、if 里、回调里）—— 那是正确写法，只要
     捕获点的块是栅栏点块的前缀（即捕获点在词法上先于且包住栅栏点）。
     第一版把这种正确写法判成 18 处假红，故此处改判"祖先链包含"。 */
  const capsWithChain = capLines.map((c) => ({ line: c, chain: ancestorBlocks(lines, c).join(',') }));
  lines.forEach((l, i) => {
    if (!/\bguardSessionWrite\s*\(/.test(l)) return;
    /* ⑥ 恒假短路绕过（★ 负控制②抓出来的缺口）：
       `if (false && guardSessionWrite(…))` / `true || …guard…` 这类写法**文本在场、
       运行时不执行** —— 本门是文本判据，若不显式抓这一形态，
       改一行 `false &&` 就能让门全绿而那个写回口已裸奔。
       口径：判红 **且不计入守卫点**，于是「逐函数配对」同时转红（双保险）。 */
    const win = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
    const gIdx = win.search(/\bguardSessionWrite\s*\(/);
    const before = gIdx >= 0 ? win.slice(0, gIdx) : '';
    /* 只在**紧邻该栅栏调用之前**（同一语句内，中间无分号）出现短路算子时判红，
       避免把上一句里的 `x === false && …` 这类无关文本误算进来。 */
    const sc = /(?:\bfalse\s*&&|\btrue\s*\|\|)(?:(?!;)[\s\S]){0,160}$/.exec(before);
    if (sc && !/;/.test(before.slice(sc.index + sc[0].length))) {
      problems.push(`${rel}:${i + 1} 栅栏被恒假短路绕过（false && / true || —— 文本在场、运行时不执行）`);
      return;
    }
    guardPoints += 1;
    const chain = ancestorBlocks(lines, i);
    /* 合法：存在某捕获点，其行号 < 栅栏行号，且其块链是栅栏块链的前缀
       （或两者在同一块 —— 前缀含相等情形）。 */
    const ok = capsWithChain.some(({ line, chain: cchain }) => {
      if (line >= i) return false;
      if (cchain === chain.join(',')) return true;          // 同一块内
      return chain.join(',').startsWith(cchain);            // 捕获块是栅栏块的外层
    });
    if (!ok) {
      problems.push(`${rel}:${i + 1} 有栅栏而词法上找不到**在此之前、且包住它**的令牌捕获点`);
    }
    /* ③ 拒绝必撤：仅对 `if (!guard…` 形态要求（另一种形态「通过才写」不适用）。
       合法撤离动作有四种，缺一不可：
         return / throw —— 函数级撤离；
         break / continue —— **循环级**撤离（多批次任务逐批裁，本批不写、也不再接着跑）。
       ★ 判据第一版只认 return/throw，把 diary 多批次那条**正确**的 `break` 收摊判成红，
         属「判据过窄逼好代码改坏」。故此处显式收全四种。
       ★ 判据第二版又**过宽**：只看「栅栏行往后 8 行里有没有撤离关键字」——
         `if (!guard(…)) { latest = null; }` 这种坏形态照样全绿，因为紧跟其后的
         兄弟行有自己的 return。现改为**块级判定**（`rejectionRetreat`），
         撤离必须落在拒绝体自己里面。该缺口由 tests/system-v3740.test.mjs 的 N3 抓出。 */
    const retreat = rejectionRetreat(lines, i);
    if (retreat === 'bad') {
      problems.push(`${rel}:${i + 1} 栅栏拒绝后无撤离动作 —— 拒绝体自身不以 return/throw/break/continue 收尾`
        + '（别处的 return 不算；只判不撤，正是本模块要消灭的形态）');
    }
  });

  if (capLines.length) perFile.push({ file: rel, captures: capLines.length });

  /* ── ⑤ 逐捕获点配对：每个捕获点所在的**函数**里必须至少有一个栅栏点 ──
     为什么要按函数配对而不是比总数：见文件尾 ⑤ 的说明（总数守恒抓不到单个裸奔）。 */
  for (const ci of capLines) {
    const fStart = functionAncestor(lines, ci);
    const fEnd = fStart >= 0 ? blockEnd(lines, fStart) : lines.length - 1;
    const hasGuard = lines.some((l, i) => i > fStart && i <= fEnd && /\bguardSessionWrite\s*\(/.test(l));
    if (!hasGuard) {
      unpaired.push(`${rel}:${ci + 1}（函数始于 ${fStart + 1} 行）`);
    }
  }
}

/* ④ 覆盖面下限：R-O3 计划原文点名七族写回口（日历 / 日记 / 微信 / 朋友圈 / 微博 / honey / 搜索）。
 *   捕获点总数低于 8 即判「写回口被人删了」——判据被掏空等同没测。 */
const MIN_CAPTURE = 8;
if (capturePoints < MIN_CAPTURE) {
  problems.push(`捕获点总数 ${capturePoints} 少于下限 ${MIN_CAPTURE} —— 写回口被删到不足覆盖面，等同判据被掏空`);
}
if (guardPoints < capturePoints) {
  problems.push(`栅栏调用数 ${guardPoints} 少于捕获点数 ${capturePoints} —— 存在「记了令牌但从不裁决」的写回口`);
}
/* ⑤ **逐写回口配对**（★ 负控制抓出来的缺口）：
 *   只比总数（栅栏数 ≥ 捕获点数）抓不到「摘掉**某一个**写回口的栅栏」——
 *   本仓微博一处就有 8 个栅栏点，摘掉 honey 那唯一一个，总数 24 ≥ 15 照样成立，
 *   判据全绿而那个写回口已经裸奔。这正是负控制②第一次跑出来的形态。
 *   修法：按**函数**为单位要求「有捕获点 ⟹ 同函数内有栅栏点」。 */
for (const u of unpaired) {
  problems.push(`${u} 该函数里有令牌捕获点却没有栅栏点 —— 写回口裸奔（总数守恒抓不到这一形态）`);
}

console.log(`[session-writeback] 扫描 ${files.length} 个生产 .js；捕获点 ${capturePoints} · 栅栏点 ${guardPoints}`);
for (const r of perFile) console.log(`  · ${r.file} 捕获点 ${r.captures}`);
if (problems.length) {
  console.error(`[session-writeback] 发现 ${problems.length} 处违规：`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('[session-writeback] ✓ 全部写回口：令牌在首个 await 之前、栅栏在其后、拒绝必撤');