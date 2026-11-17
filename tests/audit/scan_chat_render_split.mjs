/* ============================================================
 * tests/audit/scan_chat_render_split.mjs — R22-O1 大文件拆分闸
 * ------------------------------------------------------------
 * 为什么需要这道闸：
 *   「把 chat-view.js 拆小」这句话最容易变成两件假事：
 *     ① 抽出去了，但两边各留一份实现 —— 于是「第二份派生规则」复活；
 *     ② 抽出去了，但顺手改了逻辑 —— 于是「拆」变成了「改」，没人验。
 *   本闸把这两件事都变成可红可绿的机器判据。
 *
 * 五道关（全绿才 rc=0）：
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
 * 用法：
 *   node tests/audit/scan_chat_render_split.mjs          # 检查（默认）
 *   node tests/audit/scan_chat_render_split.mjs --json   # 机器可读
 * ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
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

export function runChecks({ viewText, coreText, snapshotBase, snapshotNow, ledger }) {
  const results = [];
  const push = (id, name, r) => results.push({ id, name, ok: r.ok, problems: r.problems || [] });

  push('R1', '渲染快照零差异（12 个 sha256 逐键相同）', snapshotDiff(snapshotBase, snapshotNow));
  push('R2', 'chat-view.js 行数只降不涨', checkRatchet(ledger, linesOf(viewText)));
  push('R3', '7 个方法各一份实现（核心 1 次 / 视图 0 次）', checkSingleImplementation(coreText, viewText));
  push('R4', '原型混入接得上（import + class 之后 assign）', checkMixin(viewText));
  push('R5', '核心模块依赖面恰好 4 个', checkCoreImports(coreText));

  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  const need = [CHAT_VIEW, CORE, SNAPSHOT, LEDGER];
  const missing = need.filter((rel) => !existsSync(path.join(ROOT, rel)));
  if (missing.length) {
    console.error('[chat-render-split] fail-closed：读不到 ' + missing.join(', '));
    process.exit(2);
  }
  const viewText = read(CHAT_VIEW);
  const coreText = read(CORE);
  const snap = JSON.parse(read(SNAPSHOT));
  const ledger = JSON.parse(read(LEDGER));

  const { captureChatRenderSnapshot } = await import('../_chat_render_snapshot.mjs');
  const { ChatView } = await import(path.join(ROOT, CHAT_VIEW));
  const snapshotNow = captureChatRenderSnapshot(ChatView);

  const { ok, results } = runChecks({ viewText, coreText, snapshotBase: snap.snapshots, snapshotNow, ledger });

  /* 运行时补一刀：原型上真拿到这 7 个方法（文本判据够了，但「真取到」更硬）。 */
  const own = Object.getOwnPropertyNames(ChatView.prototype);
  const runtimeMissing = EXTRACTED.filter((n) => !own.includes(n));
  results.push({
    id: 'R4b',
    name: '运行时原型上真取到这 7 个方法',
    ok: runtimeMissing.length === 0,
    problems: runtimeMissing.length ? ['原型缺：' + runtimeMissing.join(', ')] : [],
  });

  const allOk = ok && runtimeMissing.length === 0;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: allOk, viewLines: linesOf(viewText), results }, null, 2));
  } else {
    for (const r of results) {
      console.log((r.ok ? 'OK  ' : 'FAIL') + ' [' + r.id + '] ' + r.name);
      for (const p of r.problems) console.log('       - ' + p);
    }
    console.log(
      '\n[chat-render-split] ' + (allOk ? '通过' : '未通过') + '：chat-view.js ' + linesOf(viewText) + ' 行 / 核心 ' +
        linesOf(coreText) + ' 行 / 快照 ' + Object.keys(snap.snapshots).length + ' 键'
    );
  }
  if (!allOk) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}