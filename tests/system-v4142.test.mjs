/* v4.142.0 · R21-O5 玩家可见时间文案双钟统一口径定点判据。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captionOf, relTextOf } from '../config/time-caption.js';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';
import { fieldClockOf } from '../config/time-source.js';
import { MomentsView } from '../apps/wechat/moments-view.js';
import { ChatView } from '../apps/wechat/chat-view.js';
import { DiaryView } from '../apps/diary/diary-view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const face = { date: '2044年1月10日', time: '08:00' };

test('A story 文案只显示剧情日期，不产生墙钟相对量', () => {
  const got = captionOf('timestamp', Date.UTC(2044, 0, 10, 8), { face });
  assert.equal(got.ok, true);
  assert.equal(got.clock, 'story');
  assert.equal(got.text, '2044年1月10日 08:00');
  assert.doesNotMatch(got.text, /刚刚|分钟前|小时前|天前/);
});

test('B 跨钟拒答可判：跨档、story 强求相对量、缺剧情 face 均给非空理由', () => {
  const a = relTextOf('timestamp', 1000, 'createdAt', 500);
  const b = captionOf('timestamp', 1000, { face, relNow: true });
  const c = captionOf('timestamp', 1000, {});
  for (const x of [a, b, c]) {
    assert.equal(x.ok, false);
    assert.ok(x.reason);
    assert.ok(x.text);
  }
  assert.equal(a.reason, 'cross-clock');
  assert.equal(b.reason, 'cross-clock');
  assert.equal(c.reason, 'no-story-face');
  assert.equal(fieldClockOf('timestamp'), 'story');
  assert.equal(fieldClockOf('createdAt'), 'wall');
});


test('C1 朋友圈真实渲染保留记录日期，不随当前剧情钟漂移', () => {
  const view = Object.create(MomentsView.prototype);
  view.app = { wechatData: { getUserInfo: () => ({ name: '我' }) }, renderAvatar: () => '' };
  view.getContactAvatar = view.renderImages = view.renderInteractions = () => '';
  const row = { id: 'm1', name: '我', date: face.date, time: face.time };
  assert.match(view.renderMomentItem(row), /2044年1月10日 08:00/);
  assert.match(view.renderMomentItem({ ...row, date: '', time: '' }), /时间不详/);
  assert.match(view.renderMomentItem({ ...row, date: '', time: '刚刚' }), /时间不详/);
});
test('C2 微信真实分隔符消费记录日期；裸 timestamp 不拿当前剧情钟顶替', () => {
  const view = Object.create(ChatView.prototype);
  const row = { timestamp: 1234, date: face.date, time: face.time };
  assert.match(view._buildWechatTimeDividerText(row, { forceDate: true }), /2044/);
  assert.equal(view._buildWechatTimeDividerText(row), '08:00');
  assert.equal(view._buildWechatTimeDividerText({ timestamp: 1234 }), '时间不详');
  assert.match(read('apps/wechat/chat-view.js'), /this\._buildWechatTimeDividerText\(msg, \{ forceDate: !!isDateChanged \}\)/);
});
test('C3 日记真实目录渲染保留日期与正文反解回退', () => {
  let html = '';
  const view = Object.create(DiaryView.prototype);
  let entries = [{ id: 'd1', date: '2044年1月10日', content: '正文' }];
  view.app = { diaryData: {
    getEntries: () => entries, getTocBg: () => '',
    parseDiaryContent: () => ({ date: '2042年2月11日', body: '正文' }),
  }, phoneShell: { setContent: x => { html = x; } } };
  view.tocSelectedIds = new Set(); view._sortEntries = rows => rows;
  view._bindTOCEvents = () => {};
  view.renderTOC(); assert.match(html, /2044年/);
  entries = [{ id: 'd2', content: '正文' }];
  view.renderTOC(); assert.match(html, /2042年/); assert.doesNotMatch(html, /2044年/);
});
test('A2 墙钟差两年也不影响剧情日期；墙钟边界与非法锚点可判', () => {
  const nowMs = Date.UTC(2042, 0, 10, 8);
  assert.equal(captionOf('timestamp', Date.UTC(2044, 0, 10, 8), { face, nowMs }).text, face.date + ' ' + face.time);
  for (const [delta, text] of [[0, '刚刚'], [60000, '1分钟前'], [3600000, '1小时前'], [86400000, '1天前']]) {
    assert.equal(captionOf('createdAt', nowMs - delta, { nowMs }).text, text);
  }
  assert.equal(captionOf('createdAt', nowMs, { nowMs: null }).reason, 'bad-value');
  assert.equal(relTextOf('createdAt', 2000, 'updatedAt', 1000).reason, 'future-value');
  assert.equal(captionOf('unregistered', 1000).reason, 'unknown-field');
});
function assertCross(got) {
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'cross-clock');
  assert.ok(got.text);
}
test('D 真源码负控制：临时副本跨档强行算差值，同一断言必须红且真源不变', async () => {
  const original = read('config/time-caption.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rubyphone-v4142-'));
  try {
    await copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    const anchor = "if (ctx.relNow === true) return refuse(clock, 'cross-clock', '（跨档拒答：剧情时刻不能对着墙钟算相对量）');";
    assert.equal(original.split(anchor).length - 1, 1);
    fs.writeFileSync(path.join(dir, 'config/time-caption.js'), original.replace(anchor,
      "if (ctx.relNow === true) return { ok: true, clock, reason: '', text: relText(value, ctx.nowMs) };"));
    const broken = await import(pathToFileURL(path.join(dir, 'config/time-caption.js')).href);
    const ctx = { face, relNow: true, nowMs: 200000 };
    assertCross(captionOf('timestamp', 100000, ctx));
    const bad = broken.captionOf('timestamp', 100000, ctx);
    assert.equal(bad.text, '1分钟前');
    assert.throws(() => assertCross(bad), assert.AssertionError);
    assert.equal(read('config/time-caption.js'), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
