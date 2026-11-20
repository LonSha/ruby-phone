/**
 * tests/r26_x8_notification_digest.test.mjs — 通知分组 / 批量 / 摘要判据 [R26-X8]
 *
 * A1 同源分组：按 appId 聚，不按标题猜；组内 unread 与 latestAt 正确
 * A2 分组按最近时间倒序（界面上最新的在最前）
 * A3 批量已读只动点名的，返回真实 changed；重复执行 changed=0
 * A4 批量清除返回被移除的 id，点名的缺失项不产生假记录
 * A5 摘要可关：关闭时返回 enabled:false + 理由，绝不返回空摘要冒充「今天没事」
 * A6 摘要有 since 时只统计该时刻之后
 * A7 缺 id / 缺 appId 直接抛错（分组无依据就不许静默）
 * A8 文案三态：关闭 / 今天没有 / 有摘要
 * A9 自检为绿
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：摘要关闭时也照常出内容 ⇒ 「关了」被藏起来
 * N2 破坏副本：批量已读把没点名的也标了 ⇒ changed 虚高
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DIGEST_DISABLED_REASON,
  buildDigest,
  clearBulk,
  digestText,
  groupNotifications,
  markReadBulk,
  notificationDigestSelfCheck,
} from '../config/notification-digest.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'notification-digest.js'), 'utf8');

const LIST = [
  { id: 'n1', appId: 'wechat', at: 100, read: false },
  { id: 'n2', appId: 'wechat', at: 300, read: true },
  { id: 'n3', appId: 'calendar', at: 200, read: false },
];

test('A1 同源分组按 appId', () => {
  const groups = groupNotifications(LIST);
  assert.equal(groups.length, 2);
  const wechat = groups.find((g) => g.appId === 'wechat');
  assert.equal(wechat.count, 2);
  assert.equal(wechat.unread, 1);
  assert.equal(wechat.latestAt, 300);
  assert.deepEqual(wechat.ids, ['n1', 'n2']);
  const renamed = groupNotifications([
    { id: 'a', appId: 'wechat', at: 1, title: '甲' },
    { id: 'b', appId: 'wechat', at: 2, title: '乙' },
  ]);
  assert.equal(renamed.length, 1, '标题不同但同源，必须并到一组');
});

test('A2 分组按最近时间倒序', () => {
  const groups = groupNotifications(LIST);
  assert.deepEqual(groups.map((g) => g.appId), ['wechat', 'calendar']);
});

test('A3 批量已读只动点名的', () => {
  const r = markReadBulk(LIST, ['n1', 'n2']);
  assert.equal(r.changed, 1, 'n2 本来就已读，不算改动');
  assert.equal(r.list.filter((n) => n.read).length, 2);
  assert.equal(r.list.find((n) => n.id === 'n3').read, false, '没点名的不许被动');
  assert.equal(markReadBulk(r.list, ['n1']).changed, 0, '重复执行不许虚报');
});

test('A4 批量清除返回被移除的 id', () => {
  const r = clearBulk(LIST, ['n2', 'missing']);
  assert.deepEqual(r.removed, ['n2'], '缺失项不许进 removed');
  assert.equal(r.list.length, 2);
  assert.ok(!r.list.some((n) => n.id === 'n2'));
});

test('A5 摘要可关且不冒充「今天没事」', () => {
  const off = buildDigest(LIST, { enabled: false });
  assert.equal(off.enabled, false);
  assert.deepEqual(off.items, []);
  assert.equal(off.reason, DIGEST_DISABLED_REASON);
  const text = digestText(off);
  assert.ok(text.includes('已关闭'));
  assert.ok(!text.includes('今天没有新通知'), '关了就必须说关了');
});

test('A6 摘要 since 过滤', () => {
  const digest = buildDigest(LIST, { since: 150 });
  assert.equal(digest.total, 2);
  assert.equal(digest.items.length, 2);
  const wechat = digest.items.find((g) => g.appId === 'wechat');
  assert.equal(wechat.count, 1, 'n1 在 150 之前，不进摘要');
  const all = buildDigest(LIST, {});
  assert.equal(all.total, 3);
  assert.equal(all.enabled, true);
});

test('A7 缺 id / 缺 appId 抛错', () => {
  assert.throws(() => groupNotifications([{ appId: 'x' }]), /必须有 id/);
  assert.throws(() => groupNotifications([{ id: 'a' }]), /缺少 appId/);
  assert.throws(() => groupNotifications(null), /必须是数组/);
});

test('A8 文案三态', () => {
  assert.ok(digestText(buildDigest([], {})).includes('今天没有新通知'));
  assert.ok(digestText(buildDigest(LIST, {})).includes('3 条'));
  assert.ok(digestText(buildDigest(LIST, {})).includes('wechat'));
  assert.equal(digestText(null), '通知摘要：没有数据');
});

test('A9 自检为绿', () => {
  const r = notificationDigestSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*groupNotifications[^}]*\}\s*from\s*'\.\/config\/notification-digest\.js'/);
  assert.ok(/VirtualPhone\.notificationDigest\s*=/.test(indexSrc), '通知摘要必须挂诊断面');
  assert.ok(/['"]_r26X8['"]/.test(indexSrc), '自检必须进启动自检总表 _r26X8');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_x8_${tag}_`));
  const file = path.join(dir, 'notification-digest.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：摘要关闭也照常出内容 ⇒ 「关了」被藏起来', async () => {
  const broken = await loadMutant(
    [['  if (!enabled) return { enabled: false, items: [], total: 0, reason: DIGEST_DISABLED_REASON };', '  if (!enabled) { /* 照常出 */ }']],
    'offascontent'
  );
  const off = broken.buildDigest(LIST, { enabled: false });
  assert.equal(off.enabled, true, '破坏后关了也报开着（正说明真实现明说关闭）');
  assert.ok(off.total > 0);
});

test('N2 破坏：批量已读把没点名的也标了 ⇒ changed 虚高', async () => {
  const broken = await loadMutant(
    [['    if (set.has(n.id) && !n.read) {', '    if (!n.read) {']],
    'markall'
  );
  const r = broken.markReadBulk(LIST, ['n1']);
  assert.equal(r.changed, 2, '破坏后没点名的也被标已读（正说明真实现只动点名的）');
});