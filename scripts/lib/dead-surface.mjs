/**
 * scripts/lib/dead-surface.mjs — 类方法面与模块入度面（计划 R11-O2）
 *
 * 为什么需要这一层（真实现场，2026-10-29 在 v4.93.0 上实测）：
 *   `scripts/dead-export-check.mjs` 与 `bind-consumption-audit.mjs` 枚举的都是
 *   **模块级导出**（`export function|const|let|var|class NAME`）。于是两整面结构性缺口：
 *
 *   ① **类方法完全不在扫描面**。`config/subsystem-orchestrator.js` 有 41 个类方法，
 *      产品端外部只有 2 个被真调用（`runSelfChecks` / `runSelfChecksSync`），
 *      实测 **34 个在产品面除声明行外零出现** —— 门一次都没报过。原因是门只看
 *      「`export class SubsystemOrchestrator` 这个名字有没有人 import」，
 *      而它被 `index.js` import 了，于是整个类的 41 个方法一次全部白拿「已消费」。
 *   ② **模块入度没人判**。`config/*.js` 264 件里 76 件只被 `subsystem-orchestrator.js`
 *      引、17 件零 import。因为 orchestrator 那一行 import 就算「已消费」，
 *      所以整批「只有中枢引、产品端不引」的件长期无人过问。
 *
 * 本模块给门提供这两面的**可复算读数**。口径设计原则是「宁可漏报，不出假红」：
 *
 *   · 方法面判据：某公开方法名在**全仓真代码**里，除声明行之外**一次都不出现** ⇒ 记死。
 *     这是最保守的口径 —— 只要别处有人 `.foo(`、`app.foo`、`{ foo } = x`、
 *     事件表里写 `'foo'` 字符串（字符串面不参与判定，故这种要靠补充形态）……
 *     名字出现一次就判活。故读数是**下界**，不会冤枉。
 *   · 已知边界（如实写）：
 *     - 走 `this.app.xxx()` 这种**反向回调**的方法，名字在本仓真代码里出现，判活 —— 正确。
 *     - 类字段箭头函数（`foo = () => {}`）不是方法，不在枚举面（它是属性）。
 *     - 访问器（`get foo()` / `set foo()`）不判：属性读与方法调用在文本上不可分。
 *     - 动态名字（`this['foo' + n]()`）无从静态对账，不覆盖。
 *     - **单行类体的方法不进枚举面**：方法枚举按行首匹配（`(^|\n)[ \t]*name(`），
 *       `export class Tt { m() {} }` 这类紧凑写法的 `m` 认不到（v4.94.0 的 F4 夹具实测踩到）。
 *       本仓 App 类都是多行写法，实跑 4803 条公开方法不受影响；方向是漏报，不出假红。
 *       若将来真出现单行类体，处理方式是补一条「同一行内的 `名(`」分支，不要放宽行首匹配
 *       （那会把 `if (x) { foo() }` 里的调用当成声明）。
 *   · 模块入度面：给 `config/` 与 `phone/` 顶层模块算「谁 import 它」，分四档
 *     `product` / `orchestrator-only` / `test-only`（本面 skipDirs 不含 tests，故不出现）/
 *     `zero`。判据只判**新增**落入 orchestrator-only 或 zero 的件（存量冻结为基线，
 *     计划明令不许一次性清零：会牵连整批 App）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSpecifier } from './binding-consumption.mjs';

/**
 * 保长度、保行号的掩码：把注释与字符串内容替换成空格（换行保留）。
 *
 * 为什么不用 `stripNonCodeShallow`：它把整个模板串压缩成一个空格，
 * 跨行模板串会让**行号整体错位**（方法行号直接指错地方，报告就无法核对）。
 * 本函数保证 `out.length === src.length` 且每个 `\n` 位置与原串一致，
 * 因此掩码面与原文面可以逐字符对照 —— 方法名、行号都取自同一坐标系。
 */
export function maskKeepLines(src) {
  if (typeof src !== 'string') return '';
  const out = [];
  const n = src.length;
  let i = 0;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  // 正则字面量判定用的「上一个有意义字符」：`/` 出现在这些字符之后（或行首）时按正则起首算，
  // 出现在标识符 / `)` / `]` 之后则按除号算。这是 JS 词法里唯一可行的启发式。
  let prevSig = '';
  const REGEX_PREV = new Set(['', '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '~', '^', '<', '>', '/']);
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out.push(' ', ' '); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out.push(blank(src[i])); i++; }
      if (i < n) { out.push(' ', ' '); i += 2; }
      continue;
    }
    // ★ 正则字面量：`/\d{2,4}/` 里的 `{` 会让花括号配对错位（实测：231/293 个 export class
    //   认不全，就是被 `{n,m}` 这类量词带偏的）。必须整段置空，否则类体被截断或吞掉后继类。
    if (c === '/' && REGEX_PREV.has(prevSig)) {
      // 往前看：`return /re/` 这类「关键字后」也常是正则（prevSig 会是字母 r）。
      const go = isRegexStart(src, i);
      if (go) {
        out.push(' '); i++;
        let inClass = false;
        while (i < n) {
          const ch = src[i];
          if (ch === '\\') { out.push(blank(ch)); i++; if (i < n) { out.push(blank(src[i])); i++; } continue; }
          if (ch === '\n') { out.push('\n'); i++; break; }   // 未闭合，按除号回退语义：直接收尾
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) { out.push(' '); i++; break; }
          out.push(blank(ch)); i++;
        }
        prevSig = '/';
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out.push(' '); i++;
      while (i < n) {
        if (src[i] === '\\') { out.push(blank(src[i])); i++; if (i < n) { out.push(blank(src[i])); i++; } continue; }
        if (src[i] === q) { out.push(' '); i++; break; }
        out.push(blank(src[i])); i++;
      }
      prevSig = q;
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    out.push(c); i++;
  }
  return out.join('');
}

/** `/` 处是否为正则起首：上一非空格 token 是常见运算符/括号，或 `return|typeof|case|in|of|new|delete|void|do|else|yield|await` 等关键字。 */
function isRegexStart(src, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const ch = src[j];
  if ('([{,;:=!&|?+-*%~^<>'.includes(ch)) return true;
  if (ch === ')') return false;
  if (ch === ']') return false;
  if (/[\w$]/.test(ch)) {
    // 关键字后按正则；标识符/数字后按除号
    let k = j;
    while (k >= 0 && /[\w$]/.test(src[k])) k--;
    const word = src.slice(k + 1, j + 1);
    return /^(return|typeof|case|in|of|new|delete|void|do|else|yield|await|instanceof)$/.test(word);
  }
  return false;
}

/** 从 `{` 处向下配对，返回闭合 `}` 的字符下标（不配对返回 -1）。输入应为掩码文本。 */
function matchBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const CLASS_RE = /(^|\n)[ \t]*export[ \t]+(?:default[ \t]+)?class[ \t]+([A-Za-z_$][\w$]*)/g;

/**
 * 枚举 `export class` 的公开方法。
 * @param {Map<string,string>} maskedByRel rel → 掩码文本
 * @returns {Array<{rel,cls,line,endLine,methods:Array<{name,line,isStatic,isAccessor,isPrivate}>}>}
 */
export function collectClassMethods(maskedByRel) {
  const out = [];
  for (const [rel, masked] of maskedByRel) {
    if (typeof masked !== 'string' || !masked) continue;
    const lineAt = makeLineAt(masked);
    for (const m of masked.matchAll(CLASS_RE)) {
      const cls = m[2];
      const declStart = m.index + (m[1] ? m[1].length : 0);
      const braceIdx = masked.indexOf('{', declStart);
      if (braceIdx < 0) continue;
      // 类体前若先遇到 `;`（`export class A;` 之类不可能的形态）就跳过
      const semi = masked.indexOf(';', declStart);
      if (semi >= 0 && semi < braceIdx) continue;
      const closeIdx = matchBrace(masked, braceIdx);
      if (closeIdx < 0) continue;
      const bodyText = masked.slice(braceIdx, closeIdx + 1);
      // 行号 = `{` 所在行 + bodyText[0, 方法名起始) 里的换行数。
      //   bodyText 从 `{` **本身**开始，故偏移与行号基准同一坐标系，不会差 1。
      const bodyLine0 = lineAt(braceIdx);
      const methods = [];
      const M_RE = /(^|\n)([ \t]*)((?:static[ \t]+)?)((?:async[ \t]+)?)((?:get[ \t]+|set[ \t]+)?)(\*[ \t]*)?([A-Za-z_$][\w$]*)[ \t]*\(/g;
      for (const mm of bodyText.matchAll(M_RE)) {
        const name = mm[7];
        if (!name) continue;
        if (RESERVED.has(name)) continue;
        const indent = mm[2].length;
        // 行号 = `{` 所在行 + [0, 匹配处) 的换行数 + 1。
      //   +1 的来由：`(^|\n)` 捕获的换行符属于**上一行末尾**，方法名在它之后那一行；
      //   不 +1 就整体少一行（实测 `setLevel` 声明在 64 行、首版报 63）。
      const lineNo = bodyLine0 + countNl(bodyText, mm.index) + 1;
        methods.push({
          name,
          line: lineNo,
          isStatic: mm[3].trim() === 'static',
          isAccessor: mm[5].trim() !== '',
          isPrivate: name.startsWith('_') || name.startsWith('#'),
          indent,
        });
      }
      out.push({ rel, cls, line: lineAt(declStart), endLine: lineAt(closeIdx), methods });
      // ⚠️ 不要在这里写 CLASS_RE.lastIndex：matchAll 返回的是**独立迭代器**，
      //    改正则的 lastIndex 既不影响当前迭代（它会从 0 重新开始），
      //    又会让下一轮 matchAll 从 closeIdx 起扫、整段跳过 —— 首版实测
      //    「293 个 export class 只认出 2 个」就是这个坑。类体只被 matchAll 自身跳过。
    }
  }
  out.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel.localeCompare(b.rel)));
  return out;
}

const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'do',
  'await', 'new', 'typeof', 'else', 'try', 'throw', 'of', 'in', 'case', 'yield',
  'super', 'this', 'void', 'delete', 'const', 'let', 'var', 'class', 'extends',
  'default', 'import', 'export', 'break', 'continue', 'debugger', 'with',
]);

function makeLineAt(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (idx) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}
function countNl(text, upto) {
  let c = 0;
  for (let i = 0; i < upto; i++) if (text[i] === '\n') c++;
  return c;
}

/**
 * 建立「名字 → 出现位置」索引（掩码面：注释已去，字符串已置空）。
 *
 * ⚠️ 只是置空字符串会不会把「数据表里写的 `'openAlbum'`」这类真消费也抹掉？
 *   会。但那类消费本来就无法静态证实（字符串只是名字的复印件），
 *   本仓的滑动事实是：这样会**少判活 ⇒ 多报死**，与「宁可漏报」相反。
 *   故本面**额外**扫一遍 raw 文本（保留字符串）取出现位置，
 *   用「任一面出现即算活」的并集口径 —— 代价是可能把「纯字符串提及」也判活，
 *   但那方向是漏报，符合纪律。
 */
export function buildNameIndex(maskedByRel, rawByRel, names) {
  const want = names instanceof Set ? names : new Set(names);
  const idx = new Map();
  for (const n of want) idx.set(n, []);
  const scan = (byRel) => {
    for (const [rel, text] of byRel) {
      if (typeof text !== 'string' || !text) continue;
      let line = 1;
      let i = 0;
      const len = text.length;
      while (i < len) {
        const ch = text[i];
        if (ch === '\n') { line++; i++; continue; }
        if (!isIdStart(ch)) { i++; continue; }
        let j = i + 1;
        while (j < len && isIdPart(text[j])) j++;
        const word = text.slice(i, j);
        if (want.has(word)) idx.get(word).push({ rel, line });
        i = j;
      }
    }
  };
  scan(maskedByRel);
  if (rawByRel) scan(rawByRel);
  return idx;
}
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdPart = (c) => /[\w$]/.test(c);

/**
 * 判死：方法名在「声明行之外」一次都不出现。
 * @returns {Array<{rel, cls, name, line, isStatic}>}
 */
export function findDeadMethods(classes, nameIndex) {
  const dead = [];
  for (const c of classes) {
    for (const m of c.methods) {
      if (m.isAccessor || m.isPrivate) continue;
      const sites = nameIndex.get(m.name) || [];
      let live = false;
      for (const s of sites) {
        if (s.rel === c.rel && s.line === m.line) continue;
        live = true; break;
      }
      if (live) continue;
      dead.push({ rel: c.rel, cls: c.cls, name: m.name, line: m.line, isStatic: m.isStatic });
    }
  }
  dead.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel.localeCompare(b.rel)));
  return dead;
}

/** 类实例化点：`new Cls(`（掩码面，去字符串后仍保留真 new）。 */
export function buildInstantiationIndex(maskedByRel, classNames) {
  const want = classNames instanceof Set ? classNames : new Set(classNames);
  const idx = new Map();
  for (const n of want) idx.set(n, []);
  for (const [rel, text] of maskedByRel) {
    if (typeof text !== 'string' || !text) continue;
    for (const m of text.matchAll(/\bnew[ \t]+([A-Za-z_$][\w$]*)[ \t]*\(/g)) {
      if (!want.has(m[1])) continue;
      idx.get(m[1]).push(rel);
    }
  }
  return idx;
}

/**
 * 模块入度分档：只判 `config/` 与 `phone/` 的**顶层**模块（`.js`，非子目录）。
 *
 * 分档口径（照计划 O2）：
 *   product          —— 至少一处非 orchestrator 的仓内 import
 *   orchestrator-only —— 只被 config/subsystem-orchestrator.js 引
 *   zero             —— 零仓内 import（完全孤岛）
 *   注意：本面 skipDirs 不含 tests 时才会出现 test-only；门禁侧输入 **含** tests 视角的
 *   数据由调用方决定。这里如实记录 importers 全名单，分档只是对其切片。
 */
export function buildModuleIndegree(bindByRel, { scopeRe = /^(config|phone)\/[^/]+\.js$/, orchestrator = 'config/subsystem-orchestrator.js' } = {}) {
  const scope = [...bindByRel.keys()].filter((r) => scopeRe.test(r));
  const importers = new Map(scope.map((r) => [r, new Set()]));
  for (const [rel, text] of bindByRel) {
    if (typeof text !== 'string' || !text) continue;
    // ⚠️ 输入面若已是**掩码文本**（字符串被置空），说明符就没了 —— 入度会全表 0。
    //    判据不能是「本文件有没有引号」（无 import 的纯计算文件本来就没引号，那样会误抛），
    //    而是**整面零命中但整体有 import 语句**时才算传错了面。故只在最外层做一次总校验
    //    （见函数尾部的 surfaceLooksMasked），单个文件无引号一律跳过。
    // 覆盖：`import ... from '...'`、`export ... from '...'`、`import('...')`、`require('...')`
    for (const m of text.matchAll(/(?:\bfrom|\bimport|\brequire)[ \t]*\(?[ \t]*['"]([^'"]+)['"]/g)) {
      const target = resolveSpecifier(rel, m[1]);
      if (!target || target === rel) continue;
      if (!importers.has(target)) continue;
      importers.get(target).add(rel);
    }
  }
  const rows = [];
  for (const [rel, set] of importers) {
    const arr = [...set].sort();
    const prod = arr.filter((r) => r !== orchestrator && !r.startsWith('tests/') && !r.startsWith('scripts/'));
    const tier = !arr.length ? 'zero' : (prod.length ? 'product' : 'orchestrator-only');
    rows.push({ rel, tier, importers: arr, productImporters: prod });
  }
  rows.sort((a, b) => a.rel.localeCompare(b.rel));

  // 输入面自证：如果全表零入度、而这个面里明明有 import 语句 ⇒ 说明传进来的是掩码文本
  // （说明符已被置空）。产出一张全 `zero` 的表比抛错更坏 —— 那是「探测器失效后全绿」。
  const anyEdge = rows.some((r) => r.importers.length);
  if (!anyEdge) {
    let importStatements = 0;
    for (const [, text] of bindByRel) {
      if (typeof text !== 'string') continue;
      if (/(^|\n)[ \t]*import[ \t(]/.test(text)) importStatements++;
    }
    if (importStatements > 0) {
      throw new Error(`[dead-surface] 入度全表 0，但扫描面里有 ${importStatements} 个文件含 import 语句 ⇒ 输入面丢了字符串（传了掩码文本？）。请传 bindTexts 或 raw。`);
    }
  }
  return rows;
}

/** 读一个目录树，返回 { raw, masked } 两份视图（保行号，便于与原文对照）。 */
export function loadSurfaces(root, { skipDirs = new Set(['node_modules', '.git', '.wrangler', 'tests']) } = {}) {
  const raw = new Map();
  const masked = new Map();
  const walk = function* (dir, base) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (skipDirs.has(ent.name) || ent.name.startsWith('.')) continue;
      const rel = base ? `${base}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) yield* walk(abs, rel);
      else if (/\.(js|mjs)$/.test(ent.name)) yield { abs, rel };
    }
  };
  for (const f of walk(root, '')) {
    try {
      const src = fs.readFileSync(f.abs, 'utf8');
      raw.set(f.rel, src);
      masked.set(f.rel, maskKeepLines(src));
    } catch { /* 读不到按不存在算 */ }
  }
  return { raw, masked };
}
