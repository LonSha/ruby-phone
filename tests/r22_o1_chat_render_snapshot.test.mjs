/* ============================================================
 * tests/r22_o1_chat_render_snapshot.test.mjs — R22-O1 拆分判据（正反两面 + 负控制）
 * ------------------------------------------------------------
 * 判据正的一面：抽出 chat-render-core.js 之后，7 个方法的**真实输出逐字节不变**，
 *   且 7 个方法在两边各只有一份实现，混入接得上，依赖面没长。
 * 判据反的一面（负控制）：把这些判据自己打坏——塞回第二份实现 / 删掉混入 /
 *   篡改一个快照 hash / 多引一个依赖 / 行数涨回去——**必须逐条翻红**。
 *   只验正面的闸等于「只会说 OK 的闸」，这里每组负控制都配了一条。
 *
 * 口径（诚实写明）：
 *   · 快照是 12 条 fixture 的 sha256，不是全输入空间；
 *   · R4b 是运行时判据（真 import 原型），其余是文本/进程判据；
 *   · fail-closed 那条是**静态**判据（源里必须含 existsSync 检查 + exit(2)），
 *     真正跑缺文件的分支要改名仓库文件，不在单测里做。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ROOT,
  CHAT_VIEW,
  CORE,
  SNAPSHOT,
  LEDGER,
  CALL_CORE,
  CALL_LEDGER,
  EXTRACTED,
  CORE_IMPORTS,
  linesOf,
  countDefs,
  checkSingleImplementation,
  checkMixin,
  checkCoreImports,
  coreImportNames,
  snapshotDiff,
  checkRatchet,
  runChecks,
} from './audit/scan_chat_render_split.mjs';
import { captureChatRenderSnapshot } from './_chat_render_snapshot.mjs';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const viewText = read(CHAT_VIEW);
const coreText = read(CORE);
const snap = JSON.parse(read(SNAPSHOT));
const ledger = JSON.parse(read(LEDGER));
const callCoreText = read(CALL_CORE);
const callLedger = JSON.parse(read(CALL_LEDGER));
const { ChatView } = await import(path.join(ROOT, CHAT_VIEW));
const now = captureChatRenderSnapshot(ChatView);

const red = (r) => assert.equal(r.ok, false, '本应判红却通过了：' + JSON.stringify(r.problems));
const green = (r) => assert.equal(r.ok, true, '本应通过却红了：' + JSON.stringify(r.problems));

/* ---------------- R1：快照零差异 ---------------- */

test('R1 抽后 12 个快照键全部逐字节相同（抽前抽后都是真实 hash）', () => {
  const r = snapshotDiff(snap.snapshots, now);
  green(r);
  assert.equal(r.count, 12, '快照键数应为 12');
});

test('R1 基线快照里没有任何 __error 形态（抛错不许被当成通过）', () => {
  const errs = Object.entries(snap.snapshots).filter(([, v]) => String(v).startsWith('__error:'));
  assert.deepEqual(errs, [], '基线里有 __error：' + JSON.stringify(errs));
});

test('R1 本次也没有 __error 形态（fixture 都被真实跑通）', () => {
  const errs = Object.entries(now).filter(([, v]) => String(v).startsWith('__error:'));
  assert.deepEqual(errs, [], '本次出现 __error：' + JSON.stringify(errs));
});

test('R1 负控制①：篡改一个 hash → 判红', () => {
  const tampered = { ...snap.snapshots, 'bubble.plain': '0'.repeat(64) };
  red(snapshotDiff(tampered, now));
});

test('R1 负控制②：新增一个未落账的用例 → 判红', () => {
  red(snapshotDiff(snap.snapshots, { ...now, 'bubble.newCase': 'f'.repeat(64) }));
});

test('R1 负控制③：基线空表 → 判红（空表本身不是通过）', () => {
  red(snapshotDiff({}, {}));
});

test('R1 负控制④：抽后才抛错（基线真 hash / 本次 __error）→ 判红', () => {
  red(snapshotDiff(snap.snapshots, { ...now, 'emojiPanel': '__error:' + 'a'.repeat(64) }));
});

/* ---------------- R3：单份实现 ---------------- */

test('R3 7 个方法在核心里各 1 次、在 chat-view.js 里 0 次', () => {
  green(checkSingleImplementation(coreText, viewText));
  for (const name of EXTRACTED) {
    assert.equal(countDefs(coreText, name), 1, name + ' 在核心里应恰 1 次');
    assert.equal(countDefs(viewText, name), 0, name + ' 不许在 chat-view.js 里留第二份');
  }
});

test('R3 负控制⑤：把某个方法定义塞回 chat-view.js → 判红', () => {
  const dirty = viewText.replace(
    '    /* [v4.157.0 · R22-O1] 渲染内核已抽到',
    '    _votePackCached(chatId, msgs, pollId) {\n        return null;\n    }\n    /* [v4.157.0 · R22-O1] 渲染内核已抽到'
  );
  assert.notEqual(dirty, viewText, '构造失败：没找到插入锚点');
  red(checkSingleImplementation(coreText, dirty));
});

test('R3 负控制⑥：核心模块少搬一个方法（签名行被删）→ 判红', () => {
  const lost = coreText.replace('    renderEmojiPanel() {', '    renderEmojiPanelRenamed() {');
  assert.notEqual(lost, coreText, '构造失败：没找到方法签名');
  red(checkSingleImplementation(lost, viewText));
});

test('R3 负控制⑦：核心模块多塞一个未登记方法 → 判红', () => {
  const extra = coreText.replace(
    '    _gatherIdOfMsg(msg) {',
    '    someJudgement(a, b) {\n        return a === b;\n    }\n    _gatherIdOfMsg(msg) {'
  );
  assert.notEqual(extra, coreText, '构造失败：没找到插入锚点');
  red(checkSingleImplementation(extra, viewText));
});

/* ---------------- R4：原型混入 ---------------- */

test('R4 chat-view.js 有 import + class 之后的 Object.assign 混入', () => {
  green(checkMixin(viewText));
});

test('R4b 运行时：原型上真取到这 7 个方法（不是只文本上写了 assign）', () => {
  const own = Object.getOwnPropertyNames(ChatView.prototype);
  for (const name of EXTRACTED) assert.ok(own.includes(name), '原型缺 ' + name);
});

test('R4 负控制⑧：删掉 Object.assign 行 → 判红', () => {
  const stripped = viewText.replace(/^Object\.assign\(\s*ChatView\.prototype\s*,\s*chatRenderCore\s*\);$/m, '');
  assert.notEqual(stripped, viewText, '构造失败：没找到 assign 行');
  red(checkMixin(stripped));
});

test('R4 负控制⑨：混入语句挪到 class 声明之前 → 判红', () => {
  const assignLine = viewText.match(/^Object\.assign\(\s*ChatView\.prototype\s*,\s*chatRenderCore\s*\);$/m)[0];
  const moved = assignLine + '\n' + viewText.replace(assignLine, '');
  red(checkMixin(moved));
});

/* ---------------- R5：依赖面 ---------------- */

test('R5 核心模块的 import 名单恰好是那 4 个', () => {
  green(checkCoreImports(coreText));
  assert.deepEqual(coreImportNames(coreText).slice().sort(), CORE_IMPORTS.slice().sort());
});

test('R5 负控制⑩：核心模块多引一个领域依赖 → 判红', () => {
  const fat = coreText.replace(
    "import { FACE_ATTR } from '../../config/empty-face.js';",
    "import { FACE_ATTR } from '../../config/empty-face.js';\nimport { groupVoteRead } from '../../config/group-vote.js';"
  );
  assert.notEqual(fat, coreText, '构造失败：没找到 import 锚点');
  red(checkCoreImports(fat));
});

test('R5 负控制⑪：核心模块少引一个依赖 → 判红', () => {
  const thin = coreText.replace(
    "import { getPhoneInlineEmoji, renderPhoneInlineEmoji } from '../../config/phone-emoji.js';",
    "import { getPhoneInlineEmoji } from '../../config/phone-emoji.js';"
  );
  assert.notEqual(thin, coreText, '构造失败：没找到 emoji import');
  red(checkCoreImports(thin));
});

/* ---------------- R2：行数只降不涨 ---------------- */

test('R2 chat-view.js 已低于拆分行数，且不超过台账天花板', () => {
  green(checkRatchet(ledger, linesOf(viewText)));
  assert.ok(linesOf(viewText) < ledger.lines_before_split, '行数未下降');
});

test('R2 负控制⑫：行数涨回拆前 19981 行 → 判红', () => {
  red(checkRatchet(ledger, 19981));
});

test('R2 负控制⑬：读到非数字行数 → 判红（fail-closed）', () => {
  red(checkRatchet(ledger, NaN));
});

/* ---------------- 台账与闸自洽 ---------------- */

test('台账：拆前/天花板/核心行数与实际读数自洽', () => {
  assert.equal(ledger.plan, 'R22-O1');
  assert.ok(ledger.view_lines_max < ledger.lines_before_split, '天花板必须低于拆前');
  assert.ok(linesOf(viewText) <= ledger.view_lines_max, '实际行数超过台账天花板');
  assert.equal(ledger.core_lines, linesOf(coreText), '台账里的核心行数与实际不符');
  assert.deepEqual(ledger.batch1.methods.map((m) => m.name), EXTRACTED);
  assert.ok(ledger.batch1.methods.every((m) => String(m.why || '').length >= 12), '每个方法的搬迁理由都要写实');
});

test('chat-view.js 不再直接 import bubbleTheme（同一桥只许一处引版本后缀）', () => {
  assert.equal(/^import\s*\{\s*bubbleTheme\s*\}/m.test(viewText), false);
  assert.equal(/^import\s*\{\s*bubbleTheme\s*\}/m.test(coreText), true);
});

test('R5 正控制：runChecks 真数据全绿（含 R1/R2/R3/R4/R5 + R22-O2 的 R6–R9）', () => {
  const { ok, results } = runChecks({
    viewText,
    coreText,
    callCoreText,
    callLedger,
    snapshotBase: snap.snapshots,
    snapshotNow: now,
    ledger,
  });
  assert.equal(ok, true, JSON.stringify(results.filter((r) => !r.ok)));
  assert.deepEqual(results.map((r) => r.id), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']);
});

test('R5 负控制⑭：runChecks 在快照被篡改时整体判红（闸不是只会说 OK）', () => {
  const { ok } = runChecks({
    viewText,
    coreText,
    callCoreText,
    callLedger,
    snapshotBase: { ...snap.snapshots, 'gatheringCard': '1'.repeat(64) },
    snapshotNow: now,
    ledger,
  });
  assert.equal(ok, false);
});

/* ---------------- 进程级：闸自己跑得通 ---------------- */

test('进程级：node tests/audit/scan_chat_render_split.mjs 退出码 0', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/audit/scan_chat_render_split.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  assert.match(r.stdout, /\[chat-render-split\] 通过/);
});

test('进程级：--json 输出结构可机读', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/audit/scan_chat_render_split.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.ok(j.viewLines > 0);
  assert.deepEqual(j.results.map((x) => x.id), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R4b', 'R4b2']);
});

test('fail-closed（静态判据）：缺文件必须 exit 2，不许把读不到当通过', () => {
  const gate = read('tests/audit/scan_chat_render_split.mjs');
  assert.match(gate, /existsSync/, '闸里必须有存在性检查');
  assert.match(gate, /fail-closed/, '闸里必须写明 fail-closed');
  assert.match(gate, /process\.exit\(2\)/, '缺文件必须 exit 2');
  for (const rel of [CHAT_VIEW, CORE, SNAPSHOT, LEDGER]) assert.ok(gate.includes(rel.split('/').pop()), '闸必须检查 ' + rel);
});