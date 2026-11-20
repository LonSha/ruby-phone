/**
 * tests/r26_o3_memory_reclaim.test.mjs — 内存压力阈值与回收回执判据 [R26-O3]
 *
 * A1 阈值可配；非法值（负数 / NaN / soft ≥ hard）必须抛，不许悄悄回落默认
 * A2 三档边界：soft-1 → ok、soft → soft、hard → hard
 * A3 ok 档一条都不清（空闲时乱删 = 缺陷）
 * A4 soft 档只清 cache/log；media 保留并点名 kind-not-in-level
 * A5 hard 档才清 media
 * A6 草稿永不自动回收，且保留原因点名 draft-never-auto
 * A7 未登记类别一律不动（宁可不删）
 * A8 太新（未过 minAgeMs）不动
 * A9 回执：成功/失败逐条、失败不计入 freedBytes、文案说清草稿
 * A10 可复跑：乱序输入两次计划逐字相同
 * N1 破坏副本：删掉草稿分支 ⇒ 草稿进回收清单
 * N2 破坏副本：失败也累加 freedBytes ⇒ 回执虚报
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_THRESHOLDS,
  RECLAIM_KINDS,
  RECLAIM_LEVELS,
  assessUsage,
  memoryFaceText,
  memoryReclaimSelfCheck,
  planReclaim,
  resolveThresholds,
  runReclaim,
} from '../config/memory-reclaim.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'memory-reclaim.js'), 'utf8');
const T = { softBytes: 100, hardBytes: 200 };
const HOUR = 60 * 60 * 1000;
const OLD = 0;
const NOW = 10 * HOUR;

test('A1 阈值可配，非法值必须抛（不回落默认）', () => {
  assert.deepEqual(resolveThresholds(T), T);
  assert.deepEqual(resolveThresholds(), { ...DEFAULT_THRESHOLDS });
  for (const bad of [{ softBytes: -1 }, { softBytes: 0 }, { hardBytes: NaN }, { softBytes: 200, hardBytes: 200 }]) {
    assert.throws(() => resolveThresholds(bad), /memory-reclaim/, `非法阈值未抛：${JSON.stringify(bad)}`);
  }
});

test('A2 三档边界只在阈值处切换', () => {
  assert.equal(assessUsage(99, T).level, 'ok');
  assert.equal(assessUsage(100, T).level, 'soft');
  assert.equal(assessUsage(199, T).level, 'soft');
  assert.equal(assessUsage(200, T).level, 'hard');
  assert.equal(assessUsage(0, T).level, 'ok');
  assert.deepEqual([...RECLAIM_LEVELS], ['ok', 'soft', 'hard']);
});

test('A3 ok 档一条都不清', () => {
  const p = planReclaim([{ id: 'c', kind: 'cache', bytes: 50, at: OLD }], 10, { thresholds: T, now: NOW });
  assert.equal(p.level, 'ok');
  assert.deepEqual(p.reclaimable, []);
  assert.equal(p.kept[0].why, 'below-threshold');
  assert.equal(p.planBytes, 0);
});

test('A4 soft 档只清 cache/log，media 保留并点名', () => {
  const p = planReclaim([
    { id: 'c1', kind: 'cache', bytes: 10, at: OLD },
    { id: 'l1', kind: 'log', bytes: 20, at: OLD },
    { id: 'm1', kind: 'media', bytes: 30, at: OLD },
  ], 150, { thresholds: T, now: NOW });
  assert.equal(p.level, 'soft');
  assert.deepEqual(p.reclaimable.map((r) => r.id).sort(), ['c1', 'l1']);
  assert.ok(p.kept.some((k) => k.id === 'm1' && k.why === 'kind-not-in-level'));
});

test('A5 hard 档才清 media', () => {
  const p = planReclaim([
    { id: 'c1', kind: 'cache', bytes: 10, at: OLD },
    { id: 'm1', kind: 'media', bytes: 30, at: OLD },
  ], 500, { thresholds: T, now: NOW });
  assert.equal(p.level, 'hard');
  assert.deepEqual(p.reclaimable.map((r) => r.id).sort(), ['c1', 'm1']);
});

test('A6 草稿永不自动回收（哪怕 hard 档），保留原因点名', () => {
  const p = planReclaim([
    { id: 'd1', kind: 'draft', bytes: 999, at: OLD },
    { id: 'c1', kind: 'cache', bytes: 10, at: OLD },
  ], 9999, { thresholds: T, now: NOW });
  assert.equal(p.level, 'hard');
  assert.ok(!p.reclaimable.some((r) => r.kind === 'draft'), '草稿进了回收清单');
  assert.ok(p.kept.some((k) => k.id === 'd1' && k.why === 'draft-never-auto'));
});

test('A7 未登记类别不动；A8 太新的不动', () => {
  const p = planReclaim([
    { id: 'w1', kind: 'weird', bytes: 10, at: OLD },
    { id: 'c2', kind: 'cache', bytes: 10, at: NOW - 1000 },
  ], 9999, { thresholds: T, now: NOW, minAgeMs: HOUR });
  assert.ok(p.kept.some((k) => k.id === 'w1' && k.why === 'kind-not-registered'));
  assert.ok(p.kept.some((k) => k.id === 'c2' && k.why === 'too-new'));
  assert.deepEqual(p.reclaimable, []);
  assert.ok(RECLAIM_KINDS.includes('media') && !RECLAIM_KINDS.includes('weird'));
});

test('A9 回执：成功/失败逐条，失败不计 freedBytes，文案说清草稿', () => {
  const p = planReclaim([
    { id: 'ok1', kind: 'cache', bytes: 40, at: OLD },
    { id: 'boom', kind: 'log', bytes: 60, at: OLD },
    { id: 'd1', kind: 'draft', bytes: 5, at: OLD },
  ], 9999, { thresholds: T, now: NOW });
  const rep = runReclaim(p, (item) => {
    if (item.id === 'boom') throw new Error('io-fail');
    return true;
  }, { now: NOW });
  assert.equal(rep.ok, false);
  assert.deepEqual(rep.reclaimed.map((r) => r.id), ['ok1']);
  assert.equal(rep.freedBytes, 40, '失败那条不许计入释放量');
  assert.equal(rep.failed[0].id, 'boom');
  assert.ok(rep.lines.some((l) => l.includes('草稿')), ' 回执必须说清草稿被保留');
});

test('A10 可复跑：乱序输入两次计划逐字相同', () => {
  const a = planReclaim([
    { id: 'x', kind: 'cache', bytes: 5, at: OLD },
    { id: 'y', kind: 'log', bytes: 5, at: OLD },
    { id: 'z', kind: 'cache', bytes: 9, at: OLD },
  ], 9999, { thresholds: T, now: NOW });
  const b = planReclaim([
    { id: 'z', kind: 'cache', bytes: 9, at: OLD },
    { id: 'y', kind: 'log', bytes: 5, at: OLD },
    { id: 'x', kind: 'cache', bytes: 5, at: OLD },
  ], 9999, { thresholds: T, now: NOW });
  assert.equal(JSON.stringify(a.reclaimable), JSON.stringify(b.reclaimable));
  assert.deepEqual(a.reclaimable.map((r) => r.id), ['z', 'x', 'y'], '字节降序、同字节 id 升序');
});

test('A11 文案与自检', () => {
  assert.match(memoryFaceText(null), /未评估/);
  assert.match(memoryFaceText(assessUsage(1, T)), /不动/);
  assert.match(memoryFaceText(assessUsage(999, T)), /hard 档/);
  const sc = memoryReclaimSelfCheck();
  assert.deepEqual(sc.bad, [], JSON.stringify(sc.bad));
});

test('A12 产品面接线：内存回收挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*planReclaim[^}]*\}\s*from\s*'\.\/config\/memory-reclaim\.js'/, 'index.js 必须静态导入');
  assert.ok(/VirtualPhone\.memoryReclaim\s*=/.test(indexSrc), '阈值与回收能力必须挂诊断面');
  assert.ok(/['"]_r26O3['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O3');
  assert.ok(indexSrc.includes('probeUsage'), '必须给一个真探针口（否则「阈值可配」没有输入）');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_o3_${tag}_`));
  const file = path.join(dir, 'memory-reclaim.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：拆掉草稿两道保护 ⇒ 草稿进回收清单（证明 A6 靠真代码）', async () => {
  /* 草稿在本件里有**两道**保护：① 显式分支 `kind === 'draft'` 早退；
   * ② `LEVEL_KINDS` 三档里根本不登记 draft（结构上不给回收口）。
   * 负控制必须把两道都拆掉，才证明 A6 不是靠其中一道空过的。 */
  const broken = await loadMutant(
    [
      ["    if (kind === 'draft') {", "    if (kind === '__never__') {"],
      ["  hard: ['cache', 'log', 'media'],", "  hard: ['cache', 'log', 'media', 'draft'],"],
    ],
    'nodraft'
  );
  const p = broken.planReclaim([{ id: 'd1', kind: 'draft', bytes: 1, at: 0 }], 9999, { thresholds: T, now: NOW });
  assert.ok(p.reclaimable.some((r) => r.kind === 'draft'), '两道保护都拆掉后草稿必须进回收清单（否则 A6 是空过）');
});

test('N2 破坏：失败也累加 freedBytes ⇒ 回执虚报', async () => {
  const broken = await loadMutant(
    [['    } catch (e) {\n      failed.push(', '    } catch (e) {\n      freedBytes += item.bytes;\n      failed.push(']],
    'fakefreed'
  );
  const p = broken.planReclaim([{ id: 'boom', kind: 'log', bytes: 60, at: 0 }], 9999, { thresholds: T, now: NOW });
  const rep = broken.runReclaim(p, () => { throw new Error('io'); }, { now: NOW });
  assert.equal(rep.freedBytes, 60, '破坏后失败也计入释放量（正说明真回执是逐条记账）');
  assert.equal(rep.failed.length, 1);
});