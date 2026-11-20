/**
 * tests/r26_x3_relation_timeline.test.mjs — 关系时间线数据面判据 [R26-X3]
 *
 * A1 排序确定：按时间升序，同一时刻按 id 升序（同输入必须同序）
 * A2 可筛：类型 / 人物 / 时间范围，且 filtered 是真实读数
 * A3 超上限截断时报 truncated，且保留最近的点
 * A4 可点到消息：没有 messageId 的事件单列 unanchored
 * A5 零事件文案是「还没有」，不是空图
 * A6 非法事件（缺 id / 未知类型 / at 非数值）抛错
 * A7 nearestEvent：拖动定位到最近点；空时间线返回 null
 * A8 文案给出首末事件与筛掉条数
 * A9 自检为绿
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：排序只按时间 ⇒ 同刻顺序随输入漂移（同数据两次画图不一样）
 * N2 破坏副本：没有 messageId 也不计入 unanchored ⇒ 假装每条都能点进去
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  RELATION_EVENT_KINDS,
  buildTimeline,
  nearestEvent,
  relationTimelineSelfCheck,
  timelineText,
} from '../config/relation-timeline.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'relation-timeline.js'), 'utf8');

const EVENTS = [
  { id: 'e2', at: 200, kind: 'trust-up', actor: 'me', target: 'her', delta: 5, messageId: 'm2' },
  { id: 'e1', at: 100, kind: 'met', actor: 'me', target: 'her', messageId: 'm1' },
  { id: 'e3', at: 200, kind: 'gift', actor: 'her', target: 'me', delta: 1 },
  { id: 'e4', at: 300, kind: 'conflict', actor: 'her', target: 'me', delta: -8, messageId: 'm4' },
];

test('A1 排序确定：同刻按 id 升序', () => {
  assert.deepEqual([...RELATION_EVENT_KINDS], ['met', 'trust-up', 'trust-down', 'conflict', 'repair', 'gift']);
  const a = buildTimeline(EVENTS);
  const b = buildTimeline([...EVENTS].reverse());
  assert.deepEqual(a.points.map((p) => p.id), ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual(b.points.map((p) => p.id), ['e1', 'e2', 'e3', 'e4'], '输入顺序不许影响输出顺序');
});

test('A2 可筛且 filtered 是真实读数', () => {
  const byKind = buildTimeline(EVENTS, { kinds: ['met', 'conflict'] });
  assert.deepEqual(byKind.points.map((p) => p.id), ['e1', 'e4']);
  assert.equal(byKind.total, 4);
  assert.equal(byKind.kept, 2);
  assert.equal(byKind.filtered, 2);
  const byRange = buildTimeline(EVENTS, { from: 150, to: 250 });
  assert.deepEqual(byRange.points.map((p) => p.id), ['e2', 'e3']);
  const byActor = buildTimeline(EVENTS, { actors: ['her'] });
  assert.equal(byActor.kept, 4, 'her 既是对方又是行动者，四条都该留');
  const none = buildTimeline(EVENTS, { actors: ['nobody'] });
  assert.equal(none.kept, 0);
  assert.equal(none.filtered, 4);
});

test('A3 超上限截断时报 truncated 并保留最近的点', () => {
  const tl = buildTimeline(EVENTS, { limit: 2 });
  assert.equal(tl.truncated, true);
  assert.deepEqual(tl.points.map((p) => p.id), ['e3', 'e4'], '保留最近的');
  assert.equal(tl.kept, 4, 'kept 说的是筛后总量，不是显示量');
  const full = buildTimeline(EVENTS, { limit: 10 });
  assert.equal(full.truncated, false);
});

test('A4 可点到消息：无锚点的单列 unanchored', () => {
  const tl = buildTimeline(EVENTS);
  assert.deepEqual(tl.unanchored, ['e3']);
  assert.equal(tl.points.find((p) => p.id === 'e1').messageId, 'm1');
});

test('A5 零事件文案是「还没有」', () => {
  const empty = buildTimeline([]);
  assert.equal(empty.points.length, 0);
  assert.ok(timelineText(empty).includes('还没有'), '零数据不许显示空图');
  const nothingInRange = buildTimeline(EVENTS, { from: 1000 });
  assert.ok(timelineText(nothingInRange).includes('这段时间里没有事件'));
  assert.ok(timelineText(nothingInRange).includes('被筛掉 4 条'));
  assert.ok(timelineText(null).includes('还没有'));
});

test('A6 非法事件抛错', () => {
  assert.throws(() => buildTimeline([{ at: 1, kind: 'met', actor: 'a' }]), /必须有 id/);
  assert.throws(() => buildTimeline([{ id: 'x', at: 1, kind: 'hug', actor: 'a' }]), /未知关系事件类型/);
  assert.throws(() => buildTimeline([{ id: 'x', at: 'soon', kind: 'met', actor: 'a' }]), /at 必须是时间戳/);
  assert.throws(() => buildTimeline(null), /事件数组/);
});

test('A7 nearestEvent 拖动定位', () => {
  const tl = buildTimeline(EVENTS);
  assert.equal(nearestEvent(tl, 190).id, 'e2');
  assert.equal(nearestEvent(tl, 299).id, 'e4');
  assert.equal(nearestEvent(buildTimeline([]), 5), null, '空时间线不许瞎返回一个点');
  assert.throws(() => nearestEvent(tl, 'now'), /需要时间戳/);
});

test('A8 文案给出首末与筛掉条数', () => {
  const text = timelineText(buildTimeline(EVENTS, { kinds: ['met', 'conflict'] }));
  assert.ok(text.includes('2 个点'));
  assert.ok(text.includes('筛掉 2 条'));
  assert.ok(text.includes('最早 met（e1）'));
  assert.ok(text.includes('最近 conflict（e4）'));
  const withUnanchored = timelineText(buildTimeline(EVENTS));
  assert.ok(withUnanchored.includes('点不到具体消息'));
  assert.ok(withUnanchored.includes('e3'));
});

test('A9 自检为绿', () => {
  const r = relationTimelineSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*buildTimeline[^}]*\}\s*from\s*'\.\/config\/relation-timeline\.js'/);
  assert.ok(/VirtualPhone\.relationTimeline\s*=/.test(indexSrc), '时间线数据面必须挂诊断面');
  assert.ok(/['"]_r26X3['"]/.test(indexSrc), '自检必须进启动自检总表 _r26X3');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_x3_${tag}_`));
  const file = path.join(dir, 'relation-timeline.js');
  fs.writeFileSync(file, text, 'utf8');
  // 依赖闭包：relation-timeline.js → num-gate.js（漏拷会 ERR_MODULE_NOT_FOUND，负控制变成「加载失败」）
  fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'num-gate.js'));
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：排序只按时间 ⇒ 同刻顺序随输入漂移', async () => {
  const broken = await loadMutant(
    [["const all = [...normalized].sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));", 'const all = [...normalized].sort((a, b) => a.at - b.at);']],
    'timeonly'
  );
  const a = broken.buildTimeline(EVENTS).points.map((p) => p.id);
  const b = broken.buildTimeline([...EVENTS].reverse()).points.map((p) => p.id);
  assert.notDeepEqual(a, b, '破坏后同刻顺序随输入漂移（正说明真实现按 id 兜底）');
});

test('N2 破坏：没有 messageId 也不计入 unanchored ⇒ 假装每条都能点进去', async () => {
  const broken = await loadMutant(
    [["unanchored: kept.filter((e) => !e.messageId).map((e) => e.id),", 'unanchored: [],']],
    'allanchored'
  );
  const tl = broken.buildTimeline(EVENTS);
  assert.deepEqual(tl.unanchored, [], '破坏后点不进去的事件被藏了（正说明真实现如实列出）');
});