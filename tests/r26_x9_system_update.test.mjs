/**
 * tests/r26_x9_system_update.test.mjs — 系统更新语义判据 [R26-X9]
 *
 * A1 版本按数值比较（4.157.10 > 4.157.9），非法版本号抛错
 * A2 升级类型：major / minor / patch 各自由哪一段决定
 * A3 跨大版本必须标记 mustBackup，且 backup 自动排到第一步
 * A4 同版本 / 降级 / 空变更说明 → problems 点名，ok=false（不沉默放行）
 * A5 未登记迁移步骤要点名，且不许混进 steps
 * A6 跨大版本未备份 ⇒ apply 抛错；备份后按序执行并给回执
 * A7 步骤失败即停（后续步骤不再执行），state=refused
 * A8 延后状态文案必须是「待升级」，不许说成「已是最新」
 * A9 三组闭集常量
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：版本改字符串比较 ⇒ A1 必红
 * N2 破坏副本：apply 去掉备份闸 ⇒ A6 必红
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  UPDATE_KINDS,
  UPDATE_STATES,
  UPDATE_STEPS,
  applyUpdate,
  compareVersion,
  parseVersion,
  planUpdate,
  systemUpdateSelfCheck,
  updateFaceText,
  updateKind,
} from '../config/system-update.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'system-update.js'), 'utf8');

test('A1 版本按数值比较，非法版本号抛错', () => {
  assert.equal(compareVersion('4.157.10', '4.157.9'), 1, '数值比较才对；字符串比较会判 -1');
  assert.equal(compareVersion('5.0.0', '4.999.999'), 1);
  assert.equal(compareVersion('4.157', '4.157.0'), 0, '缺位按 0');
  assert.equal(compareVersion('v4.157.0', '4.157.0'), 0, 'v 前缀可接受');
  assert.equal(compareVersion('4.157.0', '4.157.0+build.7'), 0, '构建元数据不影响顺序');
  assert.deepEqual(parseVersion('4.157.0'), { major: 4, minor: 157, patch: 0 });
  for (const bad of ['', 'abc', '4.x', null]) {
    assert.throws(() => parseVersion(bad), /无法解析/, `非法版本号未抛：${String(bad)}`);
  }
});

test('A2 升级类型由哪一段决定', () => {
  assert.equal(updateKind('4.157.0', '5.0.0'), 'major');
  assert.equal(updateKind('3.157.0', '4.157.0'), 'major');
  assert.equal(updateKind('4.157.0', '4.158.0'), 'minor');
  assert.equal(updateKind('4.157.0', '4.157.1'), 'patch');
  assert.deepEqual([...UPDATE_KINDS], ['patch', 'minor', 'major']);
});

test('A3 跨大版本强制备份，且 backup 排第一步', () => {
  const p = planUpdate({ from: '4.157.0', to: '5.0.0', notes: ['大版本'], migrations: ['storage-schema', 'cache-clear'] });
  assert.equal(p.kind, 'major');
  assert.equal(p.mustBackup, true);
  assert.equal(p.steps[0], 'backup', '备份必须自动排第一，不靠调用方记得');
  assert.deepEqual(p.steps, ['backup', 'storage-schema', 'cache-clear']);
  assert.equal(p.ok, true);

  const minor = planUpdate({ from: '4.157.0', to: '4.158.0', notes: ['小版本'] });
  assert.equal(minor.mustBackup, false, '次版本不强制备份');
});

test('A4 同版本 / 降级 / 空说明 必须点名，不沉默', () => {
  const same = planUpdate({ from: '4.157.0', to: '4.157.0', notes: ['x'] });
  assert.equal(same.ok, false);
  assert.ok(same.problems.includes('same-version'));

  const down = planUpdate({ from: '4.157.0', to: '4.150.0', notes: ['回退'] });
  assert.ok(down.problems.includes('downgrade-refused'), '降级必须明确拒绝');

  const mute = planUpdate({ from: '4.157.0', to: '4.158.0', notes: [] });
  assert.ok(mute.problems.includes('notes-empty'), '没有变更说明不许升级');

  const blank = planUpdate({ from: '4.157.0', to: '4.158.0', notes: ['   '] });
  assert.ok(blank.problems.includes('notes-empty'), '空白说明不算说明');
});

test('A5 未登记步骤要点名，且不混进 steps', () => {
  const p = planUpdate({ from: '4.157.0', to: '4.158.0', notes: ['x'], migrations: ['rm-rf', 'cache-clear', 'cache-clear'] });
  assert.ok(p.problems.includes('step-unregistered'));
  assert.deepEqual(p.steps, ['cache-clear'], '未登记的不许进步骤表；重复的只留一次');
  assert.deepEqual([...UPDATE_STEPS].includes('cache-clear'), true);
});

test('A6 未备份不许升；备份后按序执行并给回执', () => {
  const p = planUpdate({ from: '4.157.0', to: '5.0.0', notes: ['大版本'] });
  assert.throws(() => applyUpdate(p, { backupTaken: false }), /必须先备份/, '没备份竟然放行');
  const order = [];
  const rep = applyUpdate(p, { backupTaken: true, run: (s) => order.push(s), now: () => 42 });
  assert.equal(rep.ok, true);
  assert.equal(rep.state, 'applied');
  assert.deepEqual(order, ['backup']);
  assert.equal(rep.at, 42);
  assert.ok(rep.lines.some((l) => l.includes('已备份')));
  assert.ok(rep.lines.some((l) => l.includes('大版本')), '变更说明必须进回执');
});

test('A7 步骤失败即停，state=refused', () => {
  const p = planUpdate({ from: '4.157.0', to: '4.158.0', notes: ['x'], migrations: ['storage-schema', 'cache-clear'] });
  const seen = [];
  const rep = applyUpdate(p, {
    backupTaken: true,
    run: (s) => { seen.push(s); if (s === 'storage-schema') throw new Error('磁盘满'); },
  });
  assert.equal(rep.ok, false);
  assert.equal(rep.state, 'refused');
  assert.deepEqual(seen, ['storage-schema'], '失败之后不许继续跑后面的步骤');
  assert.equal(rep.failed[0].step, 'storage-schema');
});

test('A8 延后状态文案说「待升级」，不说「已是最新」', () => {
  const p = planUpdate({ from: '4.157.0', to: '4.158.0', notes: ['x'], deferred: true });
  assert.equal(p.state, 'deferred');
  const text = updateFaceText(p);
  assert.match(text, /待升级/);
  assert.ok(!text.includes('已是最新'), '延后不等于最新');
  assert.equal(updateFaceText(null), '系统更新：没有待升级内容');
});

test('A9 闭集常量', () => {
  assert.deepEqual([...UPDATE_STATES], ['pending', 'deferred', 'applied', 'refused']);
  assert.equal(UPDATE_STEPS.includes('backup'), true);
  const sc = systemUpdateSelfCheck();
  assert.deepEqual(sc.bad, [], JSON.stringify(sc.bad));
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*planUpdate[^}]*\}\s*from\s*'\.\/config\/system-update\.js'/);
  assert.ok(/VirtualPhone\.systemUpdate\s*=/.test(indexSrc), '升级语义必须挂诊断面');
  assert.ok(/['"]_r26X9['"]/.test(indexSrc), '自检必须进启动自检总表 _r26X9');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_x9_${tag}_`));
  const file = path.join(dir, 'system-update.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：版本改字符串比较 ⇒ 4.157.10 小于 4.157.9（证明 A1 靠真解析）', async () => {
  const broken = await loadMutant(
    [["  const x = parseVersion(a);\n  const y = parseVersion(b);\n  for (const key of ['major', 'minor', 'patch']) {\n    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;\n  }\n  return 0;", "  return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);"]],
    'strcmp'
  );
  assert.equal(broken.compareVersion('4.157.10', '4.157.9'), -1, '改字符串比较后应立即出错（正说明真实现是数值比较）');
});

test('N2 破坏：去掉备份闸 ⇒ 跨大版本不备份也放行（证明 A6 不是空过）', async () => {
  const broken = await loadMutant(
    [['  if (plan.mustBackup && !backupTaken) {', '  if (false && plan.mustBackup && !backupTaken) {']],
    'nobackup'
  );
  const p = broken.planUpdate({ from: '4.157.0', to: '5.0.0', notes: ['大版本'] });
  const rep = broken.applyUpdate(p, { backupTaken: false });
  assert.equal(rep.ok, true, '闸被拆后未备份也放行（正说明真实现是硬闸）');
});