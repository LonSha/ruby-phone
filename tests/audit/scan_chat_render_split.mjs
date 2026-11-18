/* ============================================================
 * tests/audit/scan_chat_render_split.mjs — R22-O1 / R22-O2 大文件拆分闸
 * ------------------------------------------------------------
 * 为什么需要这道闸：
 *   「把 chat-view.js 拆小」这句话最容易变成两件假事：
 *     ① 抽出去了，但两边各留一份实现 —— 于是「第二份派生规则」复活；
 *     ② 抽出去了，但顺手改了逻辑 —— 于是「拆」变成了「改」，没人验。
 *   本闸把这两件事都变成可红可绿的机器判据。
 *
 * 五道关（全绿才 rc=0）＋ R22-O2 四关（R6–R9）：
 *   R1 快照零差异：12 个 sha256 逐键相同；`__error:` 形态不许新增
 *      （抛错也是产出，"抽前抽后都抛同样的错"算等价，"抽后才抛"必须红）。
 *   R2 行数只降不涨：chat-view.js 行数 ≤ 台账里的天花板，且必须低于拆分行数。
 *   R3 单份实现：7 个方法在核心里各定义恰 1 次，在 chat-view.js 里 0 次。
 *   R4 混入接得上：chat-view.js 有 import 行 + 在 class 结束之后的
 *      Object.assign(ChatView.prototype, chatRenderCore)。
 *   R4b 运行时补刀：原型上真拿到这 7 个方法。
 *   R5 依赖面不许长：核心模块的 import 名单必须**恰好**是 4 个
 *      （bubbleTheme / FACE_ATTR / getPhoneInlineEmoji / renderPhoneInlineEmoji），
 *      多引一个领域引擎就可能把判定搬进"只排版"的模块里。
 *   R0 fail-closed：文件读不到 ⇒ exit 2（不许把"读不到"当成"通过"）。
 *
 * R22-O2 追加（通话界面内核 chat-call-core.js）：
 *   R6 逐字节：两个通话方法的 body_sha256 必须与台账里的源文件真值相同。
 *   R7 单份实现：两个方法在通话内核里各 1 次，chat-view.js 里 0 次（只留指针）。
 *   R8 混入接得上：三个内核各自 import + 在 class ChatView 之后 Object.assign 到原型
 *      （渲染内核 chatRenderCore / 通话内核 chatCallCore / 文本解析内核 chatTextCore）。
 *   R9 依赖面恰好 0 个 import（通话内核只用 this.* 与全局；多引一个都是把判定搬进来了）。
 *   R4b2 运行时补刀：原型上真拿到这两个方法。
 *
 * 用法：
 *   node tests/audit/scan_chat_render_split.mjs          # 检查（默认）
 *   node tests/audit/scan_chat_render_split.mjs --json   # 机器可读
 * ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

export const PLAN = 'R22-O1';
export const CHAT_VIEW = 'apps/wechat/chat-view.js';
export const CORE = 'apps/wechat/chat-render-core.js';
export const SNAPSHOT = 'tests/audit/chat_render_snapshot.json';
export const LEDGER = 'tests/audit/chat_render_split.json';

/** 本次抽出的 7 个方法（顺序即源文件顺序，便于人读 diff）。 */
export const EXTRACTED = [
  '_votePackCached',
  '_renderGroupVoteCard',
  '_renderGatheringCard',
  '_gatherIdOfMsg',
  'extractInnerThought',
  'renderTextMessageBubble',
  'renderEmojiPanel',
];

/** 内核模块允许的 import 名（恰好，不多不少）。 */
export const CORE_IMPORTS = ['bubbleTheme', 'FACE_ATTR', 'getPhoneInlineEmoji', 'renderPhoneInlineEmoji'];

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

export function linesOf(text) {
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/* ---------------- R3：单份实现 ---------------- */

/** 数「4 空格缩进 + 方法名 + (」的行数：class 方法与对象字面量方法都是这个形状。 */
export function countDefs(text, name) {
  const re = new RegExp('^ {4}' + name.replace(/\$/g, '\\$&') + '\\s*\\(', 'gm');
  return (text.match(re) || []).length;
}

/** 列出所有 4 空格缩进的方法名（用于抓「偷偷多塞一个方法进核心」）。 */
export function defNames(text) {
  const out = [];
  const re = /^ {4}([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function checkSingleImplementation(coreText, viewText) {
  const problems = [];
  for (const name of EXTRACTED) {
    const inCore = countDefs(coreText, name);
    const inView = countDefs(viewText, name);
    if (inCore !== 1) problems.push(name + '：核心模块里定义了 ' + inCore + ' 次（必须恰 1 次）');
    if (inView !== 0) problems.push(name + '：chat-view.js 里还留着 ' + inView + ' 次定义（第二份实现）');
  }
  const extra = defNames(coreText).filter((n) => !EXTRACTED.includes(n));
  if (extra.length) problems.push('核心模块多出未登记的方法：' + extra.join(', ') + '（要搬就写进台账）');
  return { ok: problems.length === 0, problems };
}

/* ---------------- R4：混入接得上 ---------------- */

export function checkMixin(viewText) {
  const problems = [];
  const importRe = /^import\s*\{\s*chatRenderCore\s*\}\s*from\s*'\.\/chat-render-core\.js[^']*';/m;
  const mixRe = /^Object\.assign\(\s*ChatView\.prototype\s*,\s*chatRenderCore\s*\);$/m;
  if (!importRe.test(viewText)) problems.push("chat-view.js 缺 import { chatRenderCore } from './chat-render-core.js…'");
  const className = viewText.search(/^export class ChatView\s*\{/m);
  if (className < 0) problems.push('chat-view.js 里找不到 export class ChatView {');
  const mix = viewText.match(mixRe);
  if (!mix) {
    problems.push('chat-view.js 缺 Object.assign(ChatView.prototype, chatRenderCore);');
  } else if (className >= 0 && mix.index < className) {
    problems.push('混入语句出现在 class 声明之前（此时 ChatView 还不存在）');
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------- R5：依赖面不许长 ---------------- */

export function coreImportNames(coreText) {
  const names = [];
  const re = /^import\s*\{([^}]*)\}\s*from\s*'[^']*';/gm;
  let m;
  while ((m = re.exec(coreText))) {
    for (const piece of m[1].split(',')) {
      const nm = piece.trim().split(/\s+as\s+/).pop().trim();
      if (nm) names.push(nm);
    }
  }
  return names;
}

export function checkCoreImports(coreText) {
  const got = coreImportNames(coreText);
  const problems = [];
  const missing = CORE_IMPORTS.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !CORE_IMPORTS.includes(n));
  if (missing.length) problems.push('核心模块缺依赖：' + missing.join(', '));
  if (extra.length) problems.push('核心模块多引依赖：' + extra.join(', ') + '（只排版的模块不许引来判定）');
  return { ok: problems.length === 0, problems, names: got };
}

/* ================================================================
 * R22-O2：通话界面内核（chat-call-core.js）
 * ----------------------------------------------------------------
 * 与 R22-O1 同一套纪律，但「正确值」不同：
 *   · R22-O1 的渲染内核允许**恰好 4 个** import（它要排版，必须引主题色/表情）；
 *   · R22-O2 的通话内核正确值是 **0 个** —— 它只用 this.*（ChatView 实例）、
 *     全局（window.VirtualPhone / window.SillyTavern）与本地变量。
 *     任何 import 出现，都意味着有人把判定搬进了这个「只摆界面」的模块。
 *   · 通话族是 DOM/事件型，产不出纯字符串快照（_chat_render_snapshot.mjs 只覆盖
 *     纯字符串产出），所以等价性改用 body_sha256 逐字节 + 运行时原型补刀。
 * ================================================================ */

export const CALL_CORE = 'apps/wechat/chat-call-core.js';
export const CALL_LEDGER = 'tests/audit/chat_call_split.json';

/** R22-O2 抽出的 2 个方法（顺序即源文件顺序）。 */
export const EXTRACTED2 = ['showVideoCallInterface', 'showVoiceCallInterface'];

/** 通话内核允许的 import 名：恰好 0 个（实测结论，不是省略）。 */
export const CALL_CORE_IMPORTS = [];

/* 用字符码代替转义字面量：本文件里就能不出现反斜杠，判据本身也更好读。 */
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const TICK = String.fromCharCode(96);
const isSpaceCh = (c) => c.charCodeAt(0) <= 32;
const isWordCh = (c) => {
  const k = c.charCodeAt(0);
  return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || c === '_' || c === '$';
};

/** 找一个 4 空格缩进、处于行首的方法起点；找不到返回 -1。 */
export function methodStart(text, name) {
  const needle = '    ' + name + '(';
  let at = text.indexOf(needle);
  while (at >= 0 && !(at === 0 || text[at - 1] === NL)) at = text.indexOf(needle, at + 1);
  return at;
}

/** 方法体提取：从 `    NAME(` 起到配对的 `}`（含）为止。
 *  口径与搬迁脚本、台账取 sha256 时完全一致 —— 跳字符串/模板串/注释/正则，
 *  **不含**对象字面量属性之间的那个逗号，所以与 class 里那份逐字节相等。 */
export function bodyOf(text, name) {
  const start = methodStart(text, name);
  if (start < 0) return null;
  let i = text.indexOf('{', start + name.length);
  if (i < 0) return null;
  let depth = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === TICK) {
      i++;
      while (i < n && text[i] !== ch) {
        if (text[i] === BS) i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== NL) i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (ch === '/') {
      let j = i - 1;
      while (j >= 0 && isSpaceCh(text[j])) j--;
      const prev = j >= 0 ? text[j] : '';
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
        i++;
        let inClass = false;
        while (i < n) {
          const c = text[i];
          if (c === BS) {
            i += 2;
            continue;
          }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) {
            i++;
            break;
          } else if (c === NL) break;
          i++;
        }
        while (i < n && isWordCh(text[i])) i++;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/* ---------------- R6：逐字节（拆不许顺手改逻辑） ---------------- */

export function checkBodySha(callCoreText, callLedger) {
  const problems = [];
  const cands = (callLedger && callLedger.candidates) || {};
  for (const name of EXTRACTED2) {
    const rec = cands[name];
    if (!rec || !rec.body_sha256) {
      problems.push(name + '：台账里没有 body_sha256 记录（没记真值就等于没验）');
      continue;
    }
    const body = bodyOf(callCoreText, name);
    if (!body) {
      problems.push(name + '：通话内核里取不到方法体');
      continue;
    }
    const got = sha256(body);
    if (got !== rec.body_sha256) {
      problems.push(name + '：body_sha256 变了 ' + rec.body_sha256.slice(0, 12) + ' → ' + got.slice(0, 12));
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------- R7：单份实现 ---------------- */

export function checkSingleImplementation2(callCoreText, viewText) {
  const problems = [];
  for (const name of EXTRACTED2) {
    const inCore = countDefs(callCoreText, name);
    const inView = countDefs(viewText, name);
    if (inCore !== 1) problems.push(name + '：通话内核里定义了 ' + inCore + ' 次（必须恰 1 次）');
    if (inView !== 0) problems.push(name + '：chat-view.js 里还留着 ' + inView + ' 次定义（第二份实现）');
  }
  const extra = defNames(callCoreText).filter((n) => !EXTRACTED2.includes(n));
  if (extra.length) problems.push('通话内核多出未登记的方法：' + extra.join(', ') + '（要搬就写进台账）');
  return { ok: problems.length === 0, problems };
}

/* ---------------- R8：混入接得上 ---------------- */

export function checkMixin2(viewText) {
  const problems = [];
  const importTail = "import { chatCallCore } from './chat-call-core.js";
  const assignStmt = 'Object.assign(ChatView.prototype, chatCallCore);';
  if (!viewText.includes(importTail)) {
    problems.push("chat-view.js 缺 import { chatCallCore } from './chat-call-core.js…'");
  }
  const classAt = viewText.indexOf('export class ChatView {');
  if (classAt < 0) problems.push('chat-view.js 里找不到 export class ChatView {');
  const mixAt = viewText.indexOf(assignStmt);
  if (mixAt < 0) {
    problems.push('chat-view.js 缺 ' + assignStmt);
  } else if (classAt >= 0 && mixAt < classAt) {
    problems.push('通话混入语句出现在 class 声明之前（此时 ChatView 还不存在）');
  }
  /* 只数「以该语句开头的代码行」：注释里也会出现这句话（指针注释），
   * 按字符串出现次数数会把注释算进来，那是假红。 */
  const stmtLine = (l) => l.trim().indexOf('Object.assign(ChatView.prototype,') === 0;
  const assigns = viewText.split(NL).filter(stmtLine).length;
  /* [R25-O1] 本闸现在必须认识第三个内核（文本解析族 chat-text-core）。
   * 不许只把数字从 2 改成 3 —— 那等于给新增内核开后门。所以同时要求：
   *   ① 存在 import { chatTextCore } from './chat-text-core.js…'；
   *   ② 存在 Object.assign(ChatView.prototype, chatTextCore);；
   *   ③ 它出现在 class 声明之后（此时 ChatView 才存在）。 */
  const textImport = "import { chatTextCore } from './chat-text-core.js";
  const textAssign = 'Object.assign(ChatView.prototype, chatTextCore);';
  if (!viewText.includes(textImport)) {
    problems.push("chat-view.js 缺 import { chatTextCore } from './chat-text-core.js…'");
  }
  const textMixAt = viewText.indexOf(textAssign);
  if (textMixAt < 0) {
    problems.push('chat-view.js 缺 ' + textAssign);
  } else if (classAt >= 0 && textMixAt < classAt) {
    problems.push('文本解析内核混入语句出现在 class 声明之前');
  }
  if (assigns !== 3) {
    problems.push('ChatView.prototype 的 Object.assign 语句有 ' + assigns + ' 处（应为 3：渲染内核 + 通话内核 + 文本解析内核）');
  }
  const pointers = viewText.split('已抽到 ./chat-call-core.js').length - 1;
  if (pointers !== 2) {
    problems.push('chat-view.js 里指向通话内核的指针注释 ' + pointers + ' 处（应为 2，两个方法各一处、不留第二份实现）');
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------- R9：依赖面必须是 0 ---------------- */

export function checkCallCoreImports(callCoreText) {
  const got = coreImportNames(callCoreText);
  const problems = [];
  if (got.length) {
    problems.push('通话内核多引依赖：' + got.join(', ') + '（正确值是 0 —— 只摆界面的模块不许引来判定）');
  }
  if (callCoreText.split('require(').length - 1 > 0) {
    problems.push('通话内核出现 require(');
  }
  return { ok: problems.length === 0, problems, names: got };
}


/* ---------------- R1：快照零差异 ---------------- */

export function snapshotDiff(baseMap, nowMap) {
  const problems = [];
  for (const k of Object.keys(baseMap)) {
    if (!(k in nowMap)) {
      problems.push(k + '：本次没取到（fixture 丢了）');
      continue;
    }
    if (String(baseMap[k]) !== String(nowMap[k])) {
      problems.push(k + '：' + baseMap[k] + ' → ' + nowMap[k]);
    }
  }
  for (const k of Object.keys(nowMap)) {
    if (!(k in baseMap)) problems.push(k + '：快照里没有这个用例（新增用例要落账）');
  }
  if (!Object.keys(baseMap).length) problems.push('基线快照是空的（空表本身不是通过）');
  return { ok: problems.length === 0, problems, count: Object.keys(baseMap).length };
}

/* ---------------- R2：行数只降不涨 ---------------- */

export function checkRatchet(ledger, viewLines) {
  const problems = [];
  if (typeof viewLines !== 'number' || !Number.isFinite(viewLines)) {
    problems.push('读不到 chat-view.js 行数');
    return { ok: false, problems };
  }
  if (viewLines >= ledger.lines_before_split) {
    problems.push('chat-view.js ' + viewLines + ' 行，没有低于拆分行数 ' + ledger.lines_before_split);
  }
  if (viewLines > ledger.view_lines_max) {
    problems.push('chat-view.js ' + viewLines + ' 行，超过台账天花板 ' + ledger.view_lines_max + '（拆完不许回涨）');
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------- 主流程 ---------------- */

export function runChecks({ viewText, coreText, callCoreText, callLedger, snapshotBase, snapshotNow, ledger }) {
  const results = [];
  const push = (id, name, r) => results.push({ id, name, ok: r.ok, problems: r.problems || [] });

  push('R1', '渲染快照零差异（12 个 sha256 逐键相同）', snapshotDiff(snapshotBase, snapshotNow));
  push('R2', 'chat-view.js 行数只降不涨', checkRatchet(ledger, linesOf(viewText)));
  push('R3', '7 个方法各一份实现（核心 1 次 / 视图 0 次）', checkSingleImplementation(coreText, viewText));
  push('R4', '原型混入接得上（import + class 之后 assign）', checkMixin(viewText));
  push('R5', '核心模块依赖面恰好 4 个', checkCoreImports(coreText));


  /* R22-O2：通话内核四关（输入缺失时 fail-closed，不许静默跳过） */
  if (typeof callCoreText === 'string' && callLedger && typeof callLedger === 'object') {
    push('R6', '通话内核 2 个方法 body_sha256 逐字节不变', checkBodySha(callCoreText, callLedger));
    push('R7', '通话 2 个方法各一份实现（内核 1 次 / 视图 0 次）', checkSingleImplementation2(callCoreText, viewText));
    push('R8', '三个内核混入都接得上（渲染 / 通话 / 文本解析；import + class 之后 assign）', checkMixin2(viewText));
    push('R9', '通话内核依赖面恰好 0 个 import', checkCallCoreImports(callCoreText));
  } else {
    push('R6-R9', 'R22-O2 输入缺失（fail-closed）', { ok: false, problems: ['没有传入 callCoreText / callLedger'] });
  }
  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  const need = [CHAT_VIEW, CORE, CALL_CORE, SNAPSHOT, LEDGER, CALL_LEDGER];
  const missing = need.filter((rel) => !existsSync(path.join(ROOT, rel)));
  if (missing.length) {
    console.error('[chat-render-split] fail-closed：读不到 ' + missing.join(', '));
    process.exit(2);
  }
  const viewText = read(CHAT_VIEW);
  const coreText = read(CORE);
  const callCoreText = read(CALL_CORE);
  const callLedger = JSON.parse(read(CALL_LEDGER));
  const snap = JSON.parse(read(SNAPSHOT));
  const ledger = JSON.parse(read(LEDGER));

  const { captureChatRenderSnapshot } = await import('../_chat_render_snapshot.mjs');
  const { ChatView } = await import(path.join(ROOT, CHAT_VIEW));
  const snapshotNow = captureChatRenderSnapshot(ChatView);

  const { ok, results } = runChecks({ viewText, coreText, callCoreText, callLedger, snapshotBase: snap.snapshots, snapshotNow, ledger });

  /* 运行时补一刀：原型上真拿到这 7 个方法（文本判据够了，但「真取到」更硬）。 */
  const own = Object.getOwnPropertyNames(ChatView.prototype);
  const runtimeMissing = EXTRACTED.filter((n) => !own.includes(n));
  results.push({
    id: 'R4b',
    name: '运行时原型上真取到这 7 个方法',
    ok: runtimeMissing.length === 0,
    problems: runtimeMissing.length ? ['原型缺：' + runtimeMissing.join(', ')] : [],
  });

  /* R22-O2 运行时补刀：两个通话方法也必须在原型上真取到（证明 assign 真跑了）。 */
  const runtimeMissing2 = EXTRACTED2.filter((n) => !own.includes(n));
  results.push({
    id: 'R4b2',
    name: '运行时原型上真取到这 2 个通话方法',
    ok: runtimeMissing2.length === 0,
    problems: runtimeMissing2.length ? ['原型缺：' + runtimeMissing2.join(', ')] : [],
  });
  const allOk = ok && runtimeMissing2.length === 0;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: allOk, viewLines: linesOf(viewText), callCoreLines: linesOf(callCoreText), results }, null, 2));
  } else {
    for (const r of results) {
      console.log((r.ok ? 'OK  ' : 'FAIL') + ' [' + r.id + '] ' + r.name);
      for (const p of r.problems) console.log('       - ' + p);
    }
    console.log(
      '\n[chat-render-split] ' + (allOk ? '通过' : '未通过') + '：chat-view.js ' + linesOf(viewText) + ' 行 / 核心 ' +
        linesOf(coreText) + ' 行 / 通话内核 ' + linesOf(callCoreText) + ' 行 / 快照 ' + Object.keys(snap.snapshots).length + ' 键'
    );
  }
  if (!allOk) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}