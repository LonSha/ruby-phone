#!/usr/bin/env node
/* ============================================================
 * tests/audit/scan_body_slice_candidates.mjs —— 方法体内切片的可搬性读数（R23-O2）
 * ------------------------------------------------------------
 * 【为什么不能沿用它 R22 的做法】
 *   R22-O1/O2 的口径是「整段方法搬到新模块，body_sha256 逐字节 + 原型混入」。
 *   但 chat-view.js 剩下的大方法（renderMessage 783 / bindEvents 690 / parseSpecialMessage 326 …）
 *   体内有真业务分支，整段搬不动。实测 parseSpecialMessage 依赖 7 个模块级符号
 *   （parseWangxiangTaskTags / wangxiangTaskData / taskInvitationStatus / honeyInviteStatus …），
 *   塞进新模块就得 import 一堆判定，等于把判定搬进"只排版"的地方 —— 那正是 R22 闸 R9 要禁的事。
 *
 * 【结论性前提（R23-O2 实测修正过一次，别照旧版读）】
 *   ① **整段搬方法**对剩下的大方法不可行：parseSpecialMessage 依赖 7 个模块级符号，
 *      硬搬等于把判定搬进「只排版」的模块 —— 那正是 R22 闸 R9 要禁的事。
 *   ② 所以只能切**块**。块的约束只看三条：读哪些外层局部（→形参）／写哪些外层局部
 *      （→回传）／用不用 this（→传 self）。
 *   ③ **同文件切 vs 出文件，要看出文件**：把块搬到同一文件的模块级函数，模块作用域确实不变，
 *      但文件本身会**变大**（函数壳 + 调用点至少 +6 行/段 —— R23-O2 实测同文件版把
 *      chat-view.js 从 18531 推到 18551）。而块只要「读 ≤1、写 0、用 this」，出文件后
 *      新模块**零 import** 也成立 —— 那才是既压方法又压文件的那条路。
 *   ④ 判据不是「看着像」，是三层：L1 函数体与源行区间逐字节相同／L2 调用点实参来自
 *      outer_reads 且 this 经 `.call` 传入／L3 切片前后对同一批 fixture 的产出相同。
 *      DOM 型方法的「产出」用**事件挂载序列**快照（见 tests/_bind_events_snapshot.mjs）。
 *
 * 【产物分工】
 *   本工具写 tests/audit/body_slice_candidates.json —— 只是**候选读数**。
 *   真正切了哪几段、每段 body 的 sha、从哪调到哪、结论是什么，写在人维护的
 *   tests/audit/body_slice_ledger.json 里；两边由 tests/r23_o2_body_slice.test.mjs 对账。
 *

 * 【等级（定级规则就写在下面 classify 里，不靠人拍）】
 *   READY    ：不写外层、不 return、显式传参（含 self）≤ 8 个 —— 可以直接切。
 *   TUPLE    ：写外层变量 ≤ 3 个，或需要回传 1 个值 —— 切的时候返回元组/对象。
 *   NOT_YET  ：写外层 > 3、或在段内 return（控制流外流）、或依赖 eval/with 之类 —— 先别动。
 *
 * 【诚实写明】
 *   · 这是**启发式读数**：去注释/字符串/正则后统计，嵌套函数边界不精确拆解，
 *     解构声明里的名字算作整体声明（`const {a,b}` 记 a、b）。
 *   · 它给的是「候选 + 原因」，不是「等价性证明」。真正切完还是要产出对拍（见 tests/audit/body_slice_ledger.json 的 protocol）。
 *
 * 用法：
 *   node tests/audit/scan_body_slice_candidates.mjs            # 打印候选
 *   node tests/audit/scan_body_slice_candidates.mjs --json      # 机读
 *   node tests/audit/scan_body_slice_candidates.mjs --write     # 写候选读数
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const PLAN = 'R23-O2';
export const LEDGER = 'tests/audit/body_slice_candidates.json';

/** 要分析的（文件, 方法）。按「最想动」排序。 */
export const TARGETS = [
  { file: 'apps/wechat/chat-view.js', method: 'renderMessage' },
  { file: 'apps/wechat/chat-view.js', method: 'bindEvents' },
  { file: 'apps/wechat/chat-view.js', method: 'parseSpecialMessage' },
  { file: 'apps/wechat/chat-view.js', method: 'showBackgroundPicker' },
];

/** 段的最小行数：太小的段切出去只会增加跳转成本。 */
export const MIN_BLOCK_LINES = 20;
/** READY 的形参上限。 */
export const MAX_PARAMS = 8;
/** TUPLE 允许回写的外层变量数。 */
export const MAX_WRITE = 3;

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const TICK = String.fromCharCode(96);
const KEYWORDS = new Set(
  ('const let var if else return for while do of in new function true false null undefined typeof instanceof try catch finally throw switch case break ' +
    'continue default await async void delete yield class extends super this self import export').split(' ')
);

const isSpace = (c) => c.charCodeAt(0) <= 32;
const isWordCh = (c) => {
  const k = c.charCodeAt(0);
  return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || c === '_' || c === '$';
};

/** 把源码某段清洗成「等长、同换行」的可分析文本：注释/字符串/正则内容抹成空格。 */
export function scrub(text) {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== NL) out[k] = ' ';
  };
  while (i < n) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === TICK) {
      const q = ch;
      let k = i + 1;
      while (k < n && text[k] !== q) {
        if (text[k] === BS) k++;
        k++;
      }
      blank(i + 1, k);
      i = k + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      let k = i;
      while (k < n && text[k] !== NL) k++;
      blank(i, k);
      i = k;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/') {
      let j = i - 1;
      while (j >= 0 && isSpace(text[j])) j--;
      const prev = j >= 0 ? text[j] : '';
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
        let k = i + 1;
        let inClass = false;
        while (k < n) {
          const c = text[k];
          if (c === BS) {
            k += 2;
            continue;
          }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) {
            k++;
            break;
          } else if (c === NL) break;
          k++;
        }
        blank(i + 1, k);
        i = k;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

/** 找一个 4 空格缩进的方法（返回 {start,end} 行索引，含声明行）。 */
export function findMethod(lines, method) {
  const needle = '    ' + method + '(';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(needle)) {
      let depth = 0;
      let seen = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') {
            depth++;
            seen = true;
          } else if (ch === '}') depth--;
        }
        if (seen && depth <= 0) return { start: i, end: j };
      }
    }
  }
  return null;
}

/** 声明名（含简单解构）。返回 [{name, line}]。 */
export function declarations(cleanLines, from, to) {
  const out = [];
  const re = /\b(?:const|let|var)\s+(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))/g;
  for (let i = from; i <= to; i++) {
    const line = cleanLines[i];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const names = [];
      if (m[1]) for (const p of m[1].split(',')) names.push(p.split(':').pop().trim().split('=')[0].trim());
      if (m[2]) for (const p of m[2].split(',')) names.push(p.trim().split('=')[0].trim());
      if (m[3]) names.push(m[3]);
      for (const nm of names) if (nm && /^[A-Za-z_$][\w$]*$/.test(nm)) out.push({ name: nm, line: i });
    }
  }
  return out;
}

/** 段内标识符（去掉属性访问右半边）。 */
export function identifiers(cleanLines, from, to) {
  const names = new Set();
  for (let i = from; i <= to; i++) {
    const line = cleanLines[i];
    for (const m of line.matchAll(/([A-Za-z_$][\w$]*)\s*(\.|\(|\[)?/g)) {
      const nm = m[1];
      if (KEYWORDS.has(nm)) continue;
      names.add(nm);
    }
  }
  return names;
}

/** 段内对「点号前的名字」的写操作（`x =`、`x +=`、`x.push(` 等）。 */
function writesTo(cleanLines, from, to, name) {
  const esc = name.replace(/\$/g, '\\$&');
  const assign = new RegExp('(^|[^\\w$.])' + esc + '\\s*(?:=(?![=>])|\\+=|-=|\\*=|/=|\\+\\+|--)');
  const mutate = new RegExp('(^|[^\\w$.])' + esc + '\\s*\\.\\s*(?:push|pop|shift|unshift|splice|sort|set|add|delete|clear)\\s*\\(');
  let n = 0;
  for (let i = from; i <= to; i++) {
    if (assign.test(cleanLines[i]) || mutate.test(cleanLines[i])) n++;
  }
  return n;
}

/** 定级（规则就是这一段，别处不许再写一份）。 */
export function classify({ lines, outerReads, outerWrites, escapes = [], hasReturn, usesThis, hasDynamic }) {
  if (hasDynamic) return { level: 'NOT_YET', why: '段内有 eval/with 之类的动态作用域' };
  if (hasReturn) return { level: 'NOT_YET', why: '段内有 return（控制流会外流，切出去要改签名）' };
  if (outerWrites.length > MAX_WRITE || escapes.length > MAX_WRITE) {
    return { level: 'NOT_YET', why: `回写/外带变量 ${Math.max(outerWrites.length, escapes.length)} 个（>${MAX_WRITE}）` };
  }
  const params = outerReads.length + (usesThis ? 1 : 0);
  if (outerWrites.length > 0 || escapes.length > 0) {
    const need = [...outerWrites, ...escapes];
    return { level: 'TUPLE', why: `需回传 ${need.length} 个变量（${need.join(', ')}）`, params };
  }
  if (params > MAX_PARAMS) return { level: 'TUPLE', why: `形参 ${params} 个（>${MAX_PARAMS}）`, params };
  return { level: 'READY', why: `纯读 ${params} 个形参、无回写`, params };
}

/** 某一行**开头前**的花括号净深度（方法体内的相对计数用）。 */
export function braceDepthAt(cleanLines, lineIdx, from = 0) {
  let d = 0;
  for (let i = from; i < lineIdx; i++) for (const ch of cleanLines[i]) ((ch === '{' && d++), (ch === '}' && d--));
  return d;
}

/**
 * 一个「可切块」必须满足的最起码形状（R23-O2 现场踩到的坑）：
 *   探针第一版把 `switch` 里的一段 `case ... break;` 报成 READY —— 那种片段单独搬出去
 *   根本不是合法语句。所以加两条硬约束：
 *     ① 段内花括号净变化为 0，且起点深度 == 方法体基线深度（不许切在 if/for/case 里面）；
 *     ② 首行首 token 不是 `case` / `default:` / `}` / `)` / `,` / `.`（不许从表达式中间开切）。
 * 这两条不保证「切得漂亮」，但能保证「切出来的东西是一串完整语句」。
 */
export function isStatementBlock(cleanLines, block, bodyDepth) {
  const first = cleanLines[block.from].trim();
  if (/^(case\b|default\s*:|}|\}|\)|,|\.)/.test(first)) return false;
  if (/^[}\])]/.test(first)) return false;
  const startDepth = braceDepthAt(cleanLines, block.from);
  const endDepth = braceDepthAt(cleanLines, block.to + 1);
  return startDepth === bodyDepth && endDepth === bodyDepth;
}

/**
 * 「段内 return 真的会把控制流带出这段吗」（R23-O2 现场踩到的第二、第三个坑）。
 *   坑一：用 /\breturn\b/ 直接扫，`lines.map(v => { return v; })` 里的 return 也算外流；
 *   坑二（按行花括号深度过滤）：`if (msg.type === 'system') { ... return ...; }` 整段被当成
 *         READY —— 因为 if 块内部的 return 深度确实比段基线深，被误判成"嵌套回调"。
 *   正确的判据只有一个：**这个 return 是不是在某个嵌套函数（回调/箭头/function）里面**。
 *   在嵌套函数里 → 只结束它自己；不在 → 它一定结束外层方法，切出去就换了语义。
 *   所以这里改成按字符扫，维护一个「花括号种类栈」：开括号时看它的 header 是函数头还是控制流头。
 */

/** 判断一个 `{` 的 header 是函数体还是普通块。 */
export function classifyBrace(header) {
  /* 只看最后一个语句边界以来的一段：避免上一行没写分号时把更早的 `foo()` 带进来。 */
  const parts = header.split(/[;{}]/);
  const h = parts[parts.length - 1].trim();
  if (/=>\s*$/.test(h)) return 'fn';
  if (/\bfunction\b/.test(h)) return 'fn';
  if (/\b(if|for|while|switch|catch|else|do|try|finally)\b/.test(h)) return 'block';
  if (/\)\s*$/.test(h)) return 'fn'; // 方法简写 foo(x) { / 带括号的箭头
  return 'block';
}

/** 扫出段内所有 return，按"是否在嵌套函数内"分成 own（会外流）/ nested（只结束回调）。 */
export function scanReturnScopes(cleanLines, block) {
  const s = cleanLines.slice(block.from, block.to + 1).join(NL);
  const stack = [];
  const own = [];
  const nested = [];
  let line = block.from;
  let lastBoundary = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n') {
      line++;
    } else if (ch === '{') {
      stack.push(classifyBrace(s.slice(lastBoundary, i)));
      lastBoundary = i + 1;
    } else if (ch === '}') {
      stack.pop();
      lastBoundary = i + 1;
    } else if (ch === ';') {
      lastBoundary = i + 1;
    } else if (ch === 'r' && s.startsWith('return', i) && !/\w/.test(s[i + 6] || '')) {
      if (stack.includes('fn')) nested.push(line + 1);
      else own.push(line + 1);
      i += 5;
    }
  }
  return { own, nested };
}

/** 兼容旧签名：只返回会外流的 return 行号。 */
export function returnsAtOwnDepth(cleanLines, block) {
  return scanReturnScopes(cleanLines, block).own;
}

/** 分析一个方法，返回候选段读数。 */
export function analyzeMethod({ lines, cleanLines, method }) {
  const range = findMethod(lines, method);
  if (!range) return { method, found: false, blocks: [] };
  const bodyFrom = range.start + 1;
  const bodyTo = range.end - 1;
  const decl = declarations(cleanLines, bodyFrom, bodyTo).filter((d) => d.line <= bodyTo);

  /* 按空行切段（raw 空行），只保留够长的段。 */
  const blocks = [];
  let cur = null;
  for (let i = bodyFrom; i <= bodyTo; i++) {
    const blank = lines[i].trim() === '';
    if (blank) {
      if (cur) {
        blocks.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur) cur = { from: i, to: i };
    else cur.to = i;
  }
  if (cur) blocks.push(cur);

  const out = [];
  const bodyDepth = braceDepthAt(cleanLines, bodyFrom);
  /* 【漂移自检（R23-O3 前置发现）】方法体开头与结尾的花括号净深度必须相等 —— 两边都是
     「方法自己那一层」。若不等，说明 scrub 在这一段里吃掉/留下了不配对的括号（模板字面量、
     正则、注释边界都可能），此时 bodyDepth 是错的，**所有块的深度判定都会连锁失效**。
     典型现场：settings-app.js 的 bindEvents（5374 行）在这条自检缺失时报出「0 个候选」——
     那不是「没得切」，是读数不可信。所以宁可给它盖个 unreliable 章，也不许当成结论用。 */
  const drift = braceDepthAt(cleanLines, bodyTo + 1) - bodyDepth;
  const unreliable = drift !== 0;
  for (const b of blocks) {
    const len = b.to - b.from + 1;
    if (len < MIN_BLOCK_LINES) continue;
    if (!isStatementBlock(cleanLines, b, bodyDepth)) continue; // ← 见函数注释：先排除 case 片段等假候选
    const used = identifiers(cleanLines, b.from, b.to);
    const declaredInside = new Set(declarations(cleanLines, b.from, b.to).map((d) => d.name));
    const declaredBefore = new Set(decl.map((d) => d.name).filter((_, idx) => decl[idx].line < b.from));
    const outerReads = [...used].filter((n) => declaredBefore.has(n) && !declaredInside.has(n)).sort();
    const outerWrites = [...declaredBefore].filter((n) => !declaredInside.has(n) && writesTo(cleanLines, b.from, b.to, n)).sort();
    const text = cleanLines.slice(b.from, b.to + 1).join(NL);
    const ret = scanReturnScopes(cleanLines, b);
    const ownReturns = ret.own;
    const hasReturn = ownReturns.length > 0;
    const nestedReturns = ret.nested.length;
    const usesThis = /\bthis\b/.test(text);
    const hasDynamic = /\beval\s*\(|\bwith\s*\(/.test(text);
    /* 段内声明的名字，段后还在用 → 必须一起回传（否则切完就少了个变量）。
     * 只算**段自身作用域**的声明：回调/if 里 declare 的 `style` `text` 出了那块就看不见，
     * 而方法后半段又很可能恰好也有同名局部 —— 按名字硬算会把它们全误报成"外带"。 */
    /* `after` 要同时看清洗后的代码和**原文**：像 `${presetHtml}` 这种只出现在模板字符串里的引用，
     * scrub 会把整段字符串抹成空格，于是"段后是否还在用"会漏判 —— 漏判的代价是切完少个变量。 */
    const after = new Set([...identifiers(cleanLines, b.to + 1, bodyTo), ...identifiers(lines, b.to + 1, bodyTo)]);
    const ownScopeDecls = declarations(cleanLines, b.from, b.to)
      .filter((d) => braceDepthAt(cleanLines, d.line) === bodyDepth)
      .map((d) => d.name);
    const escapes = [...new Set(ownScopeDecls)].filter((n) => after.has(n)).sort();
    const verdict = classify({ lines: len, outerReads, outerWrites, escapes, hasReturn, usesThis, hasDynamic });
    out.push({
      file: null,
      method,
      from: b.from + 1,
      to: b.to + 1,
      lines: len,
      outer_reads: outerReads,
      outer_writes: outerWrites,
      escapes,
      uses_this: usesThis,
      has_return: hasReturn,
      own_depth_returns: ownReturns,
      nested_returns: nestedReturns,
      level: verdict.level,
      unreliable, // 本段所属方法的深度基准是否漂移（true = 这个定级不可当结论用）
      why: verdict.why,
      params: verdict.params === undefined ? outerReads.length + (usesThis ? 1 : 0) : verdict.params,
    });
  }
  out.sort((a, b) => (a.level === b.level ? b.lines - a.lines : a.level < b.level ? -1 : 1));
  return { method, found: true, method_lines: range.end - range.start + 1, drift, unreliable, blocks: out };
}

/** 全量分析（读真仓）。 */
export function analyzeAll(rootDir = ROOT, targets = TARGETS) {
  const cache = new Map();
  const results = [];
  for (const t of targets) {
    if (!cache.has(t.file)) {
      const text = fs.readFileSync(path.join(rootDir, t.file), 'utf8');
      cache.set(t.file, { lines: text.split('\n'), clean: scrub(text).split('\n') });
    }
    const { lines, clean } = cache.get(t.file);
    const r = analyzeMethod({ lines, cleanLines: clean, method: t.method });
    for (const b of r.blocks) b.file = t.file;
    results.push({ file: t.file, ...r });
  }
  return results;
}

function main() {
  const argv = process.argv.slice(2);
  const results = analyzeAll();
  const all = results.flatMap((r) => r.blocks);
  const summary = {
    methods: results.map((r) => ({ method: r.method, found: r.found, method_lines: r.method_lines || 0, blocks: r.blocks.length, drift: r.drift, unreliable: r.unreliable })),
    unreliable_methods: results.filter((r) => r.unreliable).map((r) => r.method),
    counts: {
      READY: all.filter((b) => b.level === 'READY').length,
      TUPLE: all.filter((b) => b.level === 'TUPLE').length,
      NOT_YET: all.filter((b) => b.level === 'NOT_YET').length,
    },
    ready_lines: all.filter((b) => b.level === 'READY').reduce((a, b) => a + b.lines, 0),
  };

  if (argv.includes('--write')) {
    const doc = {
      schema: 'body-slice-ledger@1',
      plan: PLAN,
      note:
        '方法体内切片的**候选读数**（不是等价性证明）。口径：同文件内切片 → 模块作用域不变，所以约束只剩三条：读哪些外层局部（→形参）、写哪些外层局部（→回传）、用不用 this（→传 self）。' +
        '定级规则在 scan_body_slice_candidates.mjs#classify，只有一份。切完的等价性证明 protocol 见 protocol 字段。',
      generated_at: new Date().toISOString(),
      rule: {
        min_block_lines: MIN_BLOCK_LINES,
        max_params: MAX_PARAMS,
        max_write: MAX_WRITE,
        levels: {
          READY: '不写外层、不 return、显式传参 ≤ max_params —— 可直接切',
          TUPLE: '写外层 ≤ max_write，或形参超限 —— 切的时候回传元组/对象',
          NOT_YET: '写外层过多 / 段内 return / 动态作用域 —— 先别动',
        },
      },
      summary,
      protocol: {
        why_not_body_sha256: 'R22 的 body_sha256 是「整段逐字节」，切片会改调用点，逐字节口径不成立',
        required_proof: [
          'L1 切出的函数体：与其源行区间逐字节相同（切时算 body_sha256，落进本台账的 slices[]）',
          'L2 调用点：源区间被替换成一次调用，且实参来自 outer_reads、回写按 outer_writes 接回（闸按名对账）',
          'L3 行为：切片前后对同一批 fixture 的**产出**逐字节相同（方法返回值为字符串/结构时可 sha256；DOM 型则用事件挂载计数 + 调用序快照）',
        ],
        blocker: 'L3 需要为每个目标方法配 fixture 采集器；renderMessage/bindEvents 依赖 DOM 与 this 状态，采集器要基于 R22-O1 的 DOM 替身扩写。',
      },
      methods: results,
    };
    fs.writeFileSync(path.join(ROOT, LEDGER), JSON.stringify(doc, null, 2) + '\n');
    console.log('[body-slice] 台账已写：' + LEDGER);
    return 0;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ summary, results }, null, 2));
    return 0;
  }

  for (const r of results) {
    if (!r.found) {
      console.log('[body-slice] ' + r.method + '：找不到方法');
      continue;
    }
    if (r.unreliable) {
      console.log(`\n[body-slice] ${r.method}（${r.method_lines} 行）⚠ 读数不可信：花括号深度漂移 ${r.drift}（scrub 吃/留了不配对的括号）。下方候选数**不得当结论用**。`);
    }
    console.log(
      `\n[body-slice] ${r.method}（${r.method_lines} 行）候选 ${r.blocks.length} 段：READY ${r.blocks.filter((b) => b.level === 'READY').length} / TUPLE ${r.blocks.filter((b) => b.level === 'TUPLE').length} / NOT_YET ${r.blocks.filter((b) => b.level === 'NOT_YET').length}`
    );
    for (const b of r.blocks.slice(0, 6)) {
      const retTag = b.has_return
        ? ' own-depth-return@' + b.own_depth_returns.join(',')
        : b.nested_returns > 0
          ? ' 嵌套 return ' + b.nested_returns + ' 处（只结束回调自己，不算外流）'
          : '';
      console.log(`   ${b.level.padEnd(7)} L${b.from}-L${b.to}（${b.lines} 行）读 ${b.outer_reads.length} 写 ${b.outer_writes.length} this=${b.uses_this ? 'Y' : 'N'} · ${b.why}${retTag}`);
    }
  }
  console.log('\n[body-slice] 合计：READY ' + summary.counts.READY + ' 段 / TUPLE ' + summary.counts.TUPLE + ' 段 / NOT_YET ' + summary.counts.NOT_YET + ' 段；READY 共 ' + summary.ready_lines + ' 行');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}