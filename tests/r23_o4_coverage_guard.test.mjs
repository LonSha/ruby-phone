/* ============================================================
 * tests/r23_o4_coverage_guard.test.mjs — 覆盖率坏采集守卫 + 账本不得被假零污染（R23-O4）
 * ------------------------------------------------------------
 * 【这一批为什么不叫「刷新覆盖率台账」】
 *   打算做的是 `node scripts/coverage-report.mjs --write`。实际现场（2026-11-17，本机）：
 *   `--verify` 真跑一次全量覆盖，spec 表里 **441 个盘上文件条条「一行都没覆盖」**，脚本照样往下走，
 *   于是它报出「101 个目录全部退步 100pp」。如果再跑 `--write`，就会把这份 0% 写成**新基线** ——
 *   那不是刷新，那是把账本毁掉。
 *   所以本轮交付的是：**先让脚本会说不**，账本一个字不动（measured_at 仍是 2026-11-13），
 *   并把「读数年龄」打在自检第一屏。真刷新必须去能跑全量的环境，这条不许含糊。
 *
 * 【判据正的一面】
 *   · 守卫函数对「全部零覆盖 / 零文件 / ≥98% 零覆盖 / 非数字」都判 broken；
 *   · 真账本不是假零（coverage_rows 2483、零测试文件 115 < 盘上 437）；
 *   · 结构自检 rc=0，且输出里带「读数年龄 N 天」。
 * 【判据反的一面（负控制）】
 *   · 把守卫判据自己打坏：全部零覆盖却判 ok / 缺参数 / 边界 97% 与 98% 两侧。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { coverageCollectionBroken } from '../scripts/lib/coverage-debt.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const ledger = JSON.parse(read('tests/audit/coverage_baseline.json'));
const script = read('scripts/coverage-report.mjs');

const broken = (o) => assert.equal(coverageCollectionBroken(o).broken, true, '本应判「采集坏了」：' + JSON.stringify(o));
const healthy = (o) => assert.equal(coverageCollectionBroken(o).broken, false, '本应判正常：' + JSON.stringify(o));

/* ---------------- 守卫本身 ---------------- */

test('守卫：441 个文件全部零覆盖 → 判「采集坏了」（现场就是这个数）', () => {
  broken({ totalFiles: 441, totalZero: 441 });
});

test('守卫：零覆盖占比 ≥98% 且文件数 ≥100 → 判坏（留 2% 余量，不追求极限）', () => {
  broken({ totalFiles: 400, totalZero: 392 }); // 98%
  broken({ totalFiles: 400, totalZero: 400 });
});

test('守卫：阈值下方的正常读数 → 判正常（真账本的 115/437 不能被误杀）', () => {
  healthy({ totalFiles: 437, totalZero: 115 });
  healthy({ totalFiles: 400, totalZero: 380 }); // 95%，仍算正常
});

test('守卫：一个文件都没扫到 → 判坏（读不到不许算通过）', () => {
  broken({ totalFiles: 0, totalZero: 0 });
});

test('守卫：参数不是数字 → 判坏（结构不对）', () => {
  broken({ totalFiles: undefined, totalZero: 1 });
  broken({ totalFiles: '441', totalZero: 441 });
});

test('负控制：把守卫判据打坏 —— 「全部零覆盖算正常」这种实现必须存在就被抓出来', () => {
  const naive = () => ({ broken: false, reason: '' }); // 永远说 ok 的假守卫
  assert.notEqual(naive({ totalFiles: 441, totalZero: 441 }).broken, coverageCollectionBroken({ totalFiles: 441, totalZero: 441 }).broken);
});

/* ---------------- 脚本接线顺序（守卫必须在 --write 之前） ---------------- */

test('接线：脚本 import 了守卫，且守卫调用发生在 if (WRITE) 之前（否则会先写坏基线）', () => {
  assert.match(script, /coverageCollectionBroken/, '脚本没有 import / 调用守卫');
  const guardAt = script.indexOf('coverageCollectionBroken({ totalFiles, totalZero })');
  const writeAt = script.indexOf('if (WRITE) {');
  assert.ok(guardAt > 0, '找不到守卫调用点');
  assert.ok(writeAt > 0, '找不到 --write 分支');
  assert.ok(guardAt < writeAt, '守卫必须在 --write 之前，否则 0% 会先被写进账本');
  assert.match(script.slice(guardAt, writeAt), /return 2;/, '守卫命中必须 return 2（fail-closed）');
});

/* ---------------- 真账本没有被假零污染 ---------------- */

test('账本不是假零：coverage_rows 2483 / 零测试文件 115 < 盘上 437', () => {
  const t = ledger.totals;
  assert.equal(t.coverage_rows, 2483);
  assert.equal(t.files_on_disk, 437);
  assert.equal(t.zero_test_files, 115);
  assert.ok(t.zero_test_files < t.files_on_disk, '零覆盖文件数等于盘上文件数 = 假零基线');
  assert.equal(coverageCollectionBroken({ totalFiles: t.files_on_disk, totalZero: t.zero_test_files }).broken, false);
});

test('账本没有被本轮改动：measured_at 仍是 2026-11-13、measured_by 仍是官方命令', () => {
  assert.equal(ledger.measured_at, '2026-11-13', '本轮承诺「不刷新」——账本被改就说明有人偷偷写了假读数');
  assert.equal(ledger.measured_by, 'node scripts/coverage-report.mjs --write');
  assert.equal(ledger.drop_pp, 0.5);
});

test('诚实边界仍在：note 里两条（浏览器层不计入 / 量行不量行为）都没被抹掉', () => {
  assert.match(ledger.note, /不覆盖浏览器层/);
  assert.match(ledger.note, /行被执行过/);
});

/* ---------------- 进程级 ---------------- */

test('进程级：结构自检 rc=0，且第一屏打印读数年龄', () => {
  const r = spawnSync(process.execPath, ['scripts/coverage-report.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  assert.match(r.stdout, /读数年龄 \d+ 天/, '自检输出没报读数年龄（旧账本就会被当成现状）');
  assert.match(r.stdout, /结构自检通过/);
});

test('进程级：坏采集时 --verify 必须 rc=2 且说「拒判」，不许报「退步 100pp」', () => {
  const r = spawnSync(process.execPath, ['scripts/coverage-report.mjs', '--verify'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    timeout: 600000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 2) {
    assert.match(out, /拒判/);
    assert.ok(!/覆盖率退步/.test(out), '坏采集不许被判成退步');
    return;
  }
  /* 在不崩的环境里，真跑会给出真表（rc 0 通过 / 1 真退步）——那时这条判据不适用，
   * 但必须留下可核查的痕迹：输出里得有真账本读数，不能是空表。 */
  assert.match(out, /app 目录 101 个/);
  assert.ok(r.status === 0 || r.status === 1, '非 0/1/2 的退出码说明脚本自己坏了：' + out.slice(0, 400));
});