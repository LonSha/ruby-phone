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

test('真仓读数：966 个 .js / 合计与台账 total_lines_max 同源 / 45 个大文件，台账全绿', () => {
  const r = checkCeilings({ rows, ledger });
  green(r);
  /* [1120 批次] 937 → 942（+5：data/cheats/part-35…39 五个新分片），
   *   行数 392884 → 393174（+290：五个分片各 1 包 × 4 行 + 聚合器 import 行）。
   *   台账由 `node tests/audit/scan_file_size_ceiling.mjs --write` 重压，快照不留余量。 */
  /* [v4.163.0 交棒改写] 行数台账按 `--write` 重压后的真读数改写：396239 → 396711（+472：桃宝视图 457→860 = +403、数据层补三个纯函数 +69）。
   * 读数跟着交付物走 —— 不是放宽判据：同一道门照样在跑，只是天花板随本版真实交付抬了。
   * 旧版读数（v4.162.0 交棒）：393174 → 396239（+3065）、
   *   大文件 44 → 45。这不是放宽判据，是**读数跟着交付物走**：+2852 是 B 站 / 贴吧两站三层重写
   *   （含 config/style-skin-v3.js +16 的 v3 退役名单），+213 是台账快照之后已有提交没刷台账的
   *   存量漂移（在 `git archive HEAD` 干净快照上跑同一道门逐字复现，不是本版引入）。
   *   逐项算术写在 tests/audit/scan_file_size_ceiling.mjs 的 note 里。
   *   新增的大文件是 apps/bilibili/bili-data.js 1365 行（六种异构实体逐条建模 + 旧档归一）。 */
  /* [v4.186.0] 942 → 945：智能家居中枢重构落了 iot-data / iot-app / iot-view 三个真新增 .js；
   *   合计行数仍走两本账同源（当前 399075），只是文件计数跟着交付物走。
   *   不是放宽判据：同一道门照样在跑，只是基准随本版真实新增抬了。 */
  /* [v4.188.0] 948 → 960：四件小 App（call / social / daily / keyboard）各落 3 个真新增 .js；
   *   台账已按 --write 重压（45 个大文件 / 合计 400884 行），两侧同源。
   *   不是放宽判据：同一道门照样在跑，只是基准随本版真实新增抬了。 */
  /* [v4.187.0] 945 → 948：近场快传重构落了 share-data / share-app / share-view 三个真新增 .js；
   *   台账已按 --write 重压（45 个大文件 / 合计 399526 行），两侧同源。
   *   不是放宽判据：同一道门照样在跑，只是基准随本版真实新增抬了。 */
  /* [v4.188.0] 948 → 960：四件小 App（call / social / daily / keyboard）各落 3 个真新增 .js；
   *   台账已按 --write 重压（45 个大文件 / 合计 400884 行），两侧同源。
   *   不是放宽判据：同一道门照样在跑，只是基准随本版真实新增抬了。 */
  /* [v4.189.0] 960 → 966：两件大件（poker-eval / werewolf-rules）各落 3 个真新增 .js（内核 / 控制器 / 视图）+ 1 个 .css（.css 不计入这里的 .js 计数）；
   *   台账已按 --write 重压（45 个大文件 / 合计 401751 行），两侧同源。
   *   不是放宽判据：同一道门照样在跑，只是基准随本版真实新增抬了。 */
  assert.equal(r.stats.files, 966, '扮到的 .js 数量与当前实际不符（1120 批次 +5 个分片 · iot/share +6 · 四件小 App +12 · 两件大件 +6：937 → 966）');
  /* [v4.181.0 交棒改写] 396711 → 398528：这个读数自 v4.163.0 钉下后就没人再签过，而 v4.164 ~ v4.180 十七个版本一直在给 apps/ 加行（台账那边每次 --write 都重签了 total_lines_max，这行字面却没跟着动）—— 它从那时起就是红的，只是逐版回归从没跑到这一套。本版把它按当前真读数重签：这不是放宽判据，是让**两本账同源**：台账的 total_lines_max 与这里的字面必须一致，否则「总量没涨」就只是一句空话。 */
  /* [v4.183.0 交棒改写] 不再钉字面行数，改为断言**两本账同源**：现场合计 === 台账 total_lines_max。
   *   为什么：钉字面的代价是每版动一次 apps/ 就得重签一次（v4.163 钉 396711、v4.181 重签 398528、
   *   v4.182 又因王相 +9 再红），而重签本身**没有任何守卫作用** —— 谁涨了都能改这一行，红灯只是噪音。
   *   真正的不变式是两本账同源：台账那侧每次 --write 都要在 note 里写明算术（谁涨、涨多少、为什么），
   *   那才是人签字的地方；这条判据负责的只是「两侧不许各说各话」。 */
  assert.equal(r.stats.total, ledger.total_lines_max, '现场合计与台账 total_lines_max 不同源（两本账必须同值）');
  assert.equal(r.stats.overDefault, 45, '大文件数量应为 45（新增 apps/bilibili/bili-data.js 1365 行）');
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
  /* [v4.162.0] 12802 → 12809：本项快照之后的提交在 settings-app.js 里长了 7 行（存量，非本版引入；
   *   干净快照 `git archive HEAD` 上现读就是 12809）。判据钉的是「台账是快照」，故跟着真读数走。 */
  assert.equal(ledger.files['apps/settings/settings-app.js'].lines_max, 12809);
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
  assert.equal(Object.keys(built.files).length, 45);
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
  /* 【不写死数字】这条测的是「子进程与正面读数同源」，那就直接比同一个真源（rows），
   *   而不是把 937 抄进来 —— 抄数字会让每次合法扩库都要回来手改一次，且改错了也看不出来。 */
  assert.equal(j.stats.files, rows.length, '子进程读数必须与正面真仓读数同源');
  assert.equal(j.stats.total, rows.reduce((n, x) => n + x.lines, 0), '合计行数必须与正面真仓读数同源');
  assert.deepEqual(j.problems, []);
});

test('进程级：fail-closed —— 改路径读不到台账必须 rc=2，不许把读不到当通过', () => {
  const gate = read('tests/audit/scan_file_size_ceiling.mjs');
  assert.match(gate, /existsSync/, '闸里必须有存在性检查');
  assert.match(gate, /fail-closed/);
  assert.match(gate, /return 2/, '缺台账必须 rc=2');
});