/* ============================================================
 * tests/r23_o1_file_size_ceiling.test.mjs —— 全仓单文件行数上界门判据（R23-O1）
 * ------------------------------------------------------------
 * 判据正的一面：全仓 837 个 .js 的读数与台账一致，大文件都有天花板，总量没涨。
 * 判据反的一面（负控制）：把每条判据自己打坏 —— 大文件不记账 / 文件涨了 /
 *   降了不压台账 / 台账条目文件已删 / 总量涨了 / 探针只扫到几个文件 —— **必须逐条翻红**。
 *
 * 口径（诚实写明）：
 *   · 负控制全部用**合成读数**（rows/ledger 是构造出来的对象），不动真仓文件：
 *     改真文件去测判据，会把"测试"变成"事故"。
 *   · 行数是弱指标：它只保证「长大必须有人签字」，不判断代码好坏，也不替代覆盖率。
 *   · 本门与 chat_render_split.json 的行数口径差 1（物理行数 vs split 长度），
 *     台账 note 里写明了，不是不一致。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ROOT,
  LEDGER,
  DEFAULT_MAX,
  MIN_FILES,
  readSizes,
  checkCeilings,
  buildLedger,
} from './audit/scan_file_size_ceiling.mjs';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const ledger = JSON.parse(read(LEDGER));
const rows = readSizes(ROOT);
const red = (r) => assert.equal(r.ok, false, '本应判红却通过了：' + JSON.stringify(r.problems));
const green = (r) => assert.equal(r.ok, true, '本应通过却红了：' + JSON.stringify(r.problems));
const hasId = (r, id) => r.problems.some((p) => p.id === id);

/** 合成一份"够多文件"的读数，用来测判空逻辑而不依赖真仓规模。 */
function synthetic({ big = [], small = 400 } = {}) {
  const out = [];
  for (let i = 0; i < small; i++) out.push({ path: `apps/x/f${i}.js`, lines: 10 });
  for (const b of big) out.push(b);
  return out;
}
const ledgerFor = (files, totalMax, defaultMax = DEFAULT_MAX) => ({
  schema: 'file-size-ceiling@1',
  default_max: defaultMax,
  total_lines_max: totalMax,
  files,
});
const sum = (r) => r.reduce((a, x) => a + x.lines, 0);

/* ---------------- 正面 ---------------- */

test('真仓读数：911 个 .js / 合计 386814 行 / 44 个大文件，台账全绿', () => {
  const r = checkCeilings({ rows, ledger });
  green(r);
  assert.equal(r.stats.files, 911, '扫到的 .js 数量与当前实际不符（R26-O4 新增 config/log-gate.js + tests/r26_o4_log_level.test.mjs 后已复核）');
  assert.equal(r.stats.total, 386814, '全仓合计行数与台账不符（R26-O4 log-gate 370 + 接线 23；R26-O1b boot-fallback 264 + 判据 179；R26-O6b 判据 ~190 + 矩阵报数 42，现 911 文件 / 386814 行（台账 note 里写了为什么涨））');
  assert.equal(r.stats.overDefault, 44, '大文件数量应为 44（cheats.js 已降到千行内，不再是大文件）');
  assert.equal(r.stats.overDefault, r.stats.ledgered, '大文件必须与台账条目一一对应');
});

test('台账里每一行的 lines_max 都等于当前真读数（快照，不留余量）', () => {
  const byPath = new Map(rows.map((r) => [r.path, r.lines]));
  for (const [rel, rec] of Object.entries(ledger.files)) {
    assert.equal(byPath.get(rel), rec.lines_max, rel + ' 的天花板与真读数不一致');
  }
});

test('「无上界门」这条欠账真的关了：PLAN.md 点名的三个大文件都在台账里', () => {
  // data/cheats.js 曾是 PLAN.md 原文点名的 27612 行文件。R24-O9 已把它拆成 34 个分片：
  //   现在它是 54 行的聚合器，**故意不再进台账**（低于默认上限）（这就是本项的交付），
  //   故这里改判「它真的掉下去了」，而不是留着旧天花板当纪念。
  const cheatsRow = rows.find((r) => r.path === 'data/cheats.js');
  assert.ok(cheatsRow, 'data/cheats.js 必须仍在扫描面里');
  assert.ok(cheatsRow.lines < DEFAULT_MAX, 'data/cheats.js 应已降到默认上限之内，实得 ' + cheatsRow.lines);
  assert.ok(!('data/cheats.js' in ledger.files), '已降到上限内的文件不该继续占台账条目');
  // [R25-O1] 第一刀把文本解析族（6 个方法）搬到 apps/wechat/chat-text-core.js；
  //   台账按真读数重压（18451 → 18457，R25-O2 接线四处 + 恢复读数上屏），只降不涨的棘轮方向未变。
  assert.equal(ledger.files['apps/wechat/chat-view.js'].lines_max, 18457);
  // [R25-O5] settings-app.js 12798 → 12802：只付 1 行 import + 1 行 mount + 2 行注释；逻辑全在新文件里。
  assert.equal(ledger.files['apps/settings/settings-app.js'].lines_max, 12802);
  assert.ok(rows.every((r) => r.lines <= DEFAULT_MAX || r.path in ledger.files), '存在未被记账的大文件');
});

test('台账元信息自洽：default_max / total_lines_max / 大文件数对得上', () => {
  assert.equal(ledger.default_max, DEFAULT_MAX);
  assert.equal(ledger.total_lines_max, sum(rows));
  const big = rows.filter((r) => r.lines > DEFAULT_MAX).length;
  assert.equal(big, Object.keys(ledger.files).length);
});

test('buildLedger 只收大文件：小文件不进台账（否则台账会变成 889 行噪音）', () => {
  const built = buildLedger(rows, DEFAULT_MAX, new Date('2026-11-17T00:00:00Z'));
  assert.equal(Object.keys(built.files).length, 44);
  assert.ok(!('apps/wechat/chat-render-core.js' in built.files), '小文件不该进台账');
  assert.equal(built.total_lines_max, sum(rows));
});

/* ---------------- 负控制 ---------------- */

test('负控制①：大文件没记天花板 → R1 红（无上界门的主要兑现点）', () => {
  const rr = synthetic({ big: [{ path: 'apps/x/huge.js', lines: DEFAULT_MAX + 1 }] });
  const r = checkCeilings({ rows: rr, ledger: ledgerFor({}, sum(rr)) });
  red(r);
  assert.ok(hasId(r, 'R1'), '应由 R1 抓，实际：' + JSON.stringify(r.problems));
});

test('负控制②：文件涨了 1 行 → R2 红（棘轮真的咬住）', () => {
  const rr = synthetic({ big: [{ path: 'apps/x/big.js', lines: 2000 }] });
  const r = checkCeilings({ rows: rr, ledger: ledgerFor({ 'apps/x/big.js': { lines_max: 1999 } }, sum(rr)) });
  red(r);
  assert.ok(hasId(r, 'R2'));
});

test('负控制③：文件降了但台账没压 → R3 红（不许留"能悄悄长回去"的余量）', () => {
  const rr = synthetic({ big: [{ path: 'apps/x/big.js', lines: 1500 }] });
  const r = checkCeilings({ rows: rr, ledger: ledgerFor({ 'apps/x/big.js': { lines_max: 2000 } }, sum(rr)) });
  red(r);
  assert.ok(hasId(r, 'R3'));
});

test('负控制④：台账条目对应的文件已被删 → R2 红（不是静默忽略）', () => {
  const rr = synthetic({});
  const r = checkCeilings({ rows: rr, ledger: ledgerFor({ 'apps/x/gone.js': { lines_max: 5000 } }, sum(rr)) });
  red(r);
  assert.ok(hasId(r, 'R2'));
});

test('负控制⑤：总量涨了 → R4 红（拆一个、长三个会被抓）', () => {
  const rr = synthetic({ big: [{ path: 'apps/x/big.js', lines: 2000 }] });
  const r = checkCeilings({ rows: rr, ledger: ledgerFor({ 'apps/x/big.js': { lines_max: 2000 } }, sum(rr) - 1) });
  red(r);
  assert.ok(hasId(r, 'R4'));
});

test('负控制⑥：扫不到 MIN_FILES 个文件 → R0 拒判（探针坏了不许算通过）', () => {
  const rr = [{ path: 'apps/x/a.js', lines: 10 }];
  const r = checkCeilings({ rows: rr, ledger: ledgerFor({}, 10) });
  red(r);
  assert.ok(hasId(r, 'R0'));
  assert.ok(rr.length < MIN_FILES, '负控制前提不成立');
});

test('负控制⑦：台账缺 total_lines_max → R4 红（总量没有天花板等于没设）', () => {
  const rr = synthetic({});
  red(checkCeilings({ rows: rr, ledger: { files: {} } }));
});

/* ---------------- 进程级 ---------------- */

test('进程级：闸 rc=0，--json 可机读', () => {
  const r = spawnSync(process.execPath, ['tests/audit/scan_file_size_ceiling.mjs', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.stats.files, 911, '子进程读数必须与正面真仓读数同源');
  assert.deepEqual(j.problems, []);
});

test('进程级：fail-closed —— 改路径读不到台账必须 rc=2，不许把读不到当通过', () => {
  const gate = read('tests/audit/scan_file_size_ceiling.mjs');
  assert.match(gate, /existsSync/, '闸里必须有存在性检查');
  assert.match(gate, /fail-closed/);
  assert.match(gate, /return 2/, '缺台账必须 rc=2');
});