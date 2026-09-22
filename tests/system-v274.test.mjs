import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proposeCommitment, confirmCommitment, rescheduleCommitment,
  fulfillCommitment, cancelCommitment, commitmentCalendarProjection, summarizeCommitments
} from '../config/commitment-flow.js';
import { CalendarData } from '../apps/calendar/calendar-data.js';

function memoryStorage() {
  const data = new Map();
  return { get: (key, fallback) => data.has(key) ? data.get(key) : fallback, set: (key, value) => data.set(key, value) };
}

const base = { actor: '林夏', with: '玩家', content: '咖啡馆见面', dateKey: '2026-09-25', time: '19:00', place: '旧咖啡馆', eventKey: 'propose' };

test('约定确认、改期后才投影到日历，完成后退出投影', () => {
  const proposed = proposeCommitment(null, base);
  assert.equal(commitmentCalendarProjection(proposed.state).length, 0);
  const confirmed = confirmCommitment(proposed.state, { id: proposed.item.id, eventKey: 'confirm' });
  const moved = rescheduleCommitment(confirmed.state, { id: proposed.item.id, dateKey: '2026-09-26', time: '20:00', place: '书店', reason: '临时加班', eventKey: 'move' });
  assert.equal(moved.item.status, 'rescheduled');
  assert.deepEqual(commitmentCalendarProjection(moved.state), [{
    sourceId: 'apt_1', dateKey: '2026-09-26', time: '20:00', title: '林夏与玩家：咖啡馆见面', place: '书店', status: 'rescheduled'
  }]);
  const done = fulfillCommitment(moved.state, { id: proposed.item.id, eventKey: 'done' });
  assert.equal(commitmentCalendarProjection(done.state).length, 0);
  assert.deepEqual(done.item.history.map((event) => event.action), ['propose', 'confirm', 'reschedule', 'fulfill']);
});

test('重复事件、终态与损坏数据都不会造成重复或回退', () => {
  const proposed = proposeCommitment({}, base);
  const replay = proposeCommitment(proposed.state, base);
  assert.equal(replay.changed, false);
  assert.equal(replay.state.items.length, 1);
  const cancelled = cancelCommitment(proposed.state, { id: proposed.item.id, reason: '双方取消', eventKey: 'cancel' });
  const late = confirmCommitment(cancelled.state, { id: proposed.item.id, eventKey: 'late' });
  assert.equal(late.changed, false);
  assert.equal(late.item.status, 'cancelled');
  const dirty = summarizeCommitments({ items: [base, { id: 'apt_9' }, { id: 'apt_9', actor: '甲', content: '重复' }] });
  assert.deepEqual(dirty, { proposed: 1, confirmed: 0, rescheduled: 0, fulfilled: 0, cancelled: 0 });
});

test('日历按 sourceId 同步约定，重复同步不改写，取消后移除且保留手工日程', () => {
  const calendar = new CalendarData(memoryStorage());
  calendar.addMemo({ dateKey: '2026-09-25', title: '手工备忘', time: '09:00' });
  const state = confirmCommitment(proposeCommitment(null, base).state, { id: 'apt_1', eventKey: 'confirm' }).state;
  const first = calendar.syncCommitmentProjection(commitmentCalendarProjection(state));
  const second = calendar.syncCommitmentProjection(commitmentCalendarProjection(state));
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(calendar.getMemos().length, 2);
  const cancelled = cancelCommitment(state, { id: 'apt_1', eventKey: 'cancel' });
  calendar.syncCommitmentProjection(commitmentCalendarProjection(cancelled.state));
  assert.deepEqual(calendar.getMemos().map((memo) => memo.title), ['手工备忘']);
});

test('缺少人物、内容或合法日期时拒绝', () => {
  assert.equal(proposeCommitment({}, { ...base, dateKey: '周五' }).ok, false);
  assert.equal(rescheduleCommitment({ items: [{ ...base, id: 'apt_1', status: 'confirmed' }] }, { id: 'apt_1', dateKey: '明天' }).reason, 'invalid-date');
});
test('日历控制器把约定走完确认、改期、完成，并保留手工备忘', async () => {
  const { CalendarApp } = await import('../apps/calendar/calendar-app.js');
  const proto = CalendarApp.prototype;
  const app = Object.create(proto);
  app.phoneShell = { showNotification() {} };
  app.storage = memoryStorage();
  app.calendarData = new CalendarData(app.storage);
  app.storageKey = 'calendar_commitments';
  app.calendarData.addMemo({ dateKey: '2026-09-25', title: '手工备忘', time: '09:00' });
  app.proposeCommitmentFromMemo({ actor: '林夏', with: '玩家', content: '咖啡馆见面', dateKey: '2026-09-25', time: '19:00', eventKey: 'propose-ui' });
  const created = app.loadCommitments().items.at(-1);
  app.confirmCommitmentById(created.id, 'confirm-ui');
  assert.equal(app.calendarData.getMemos().some(memo => memo.commitmentSourceId === created.id), true);
  const moved = app.rescheduleCommitmentById(created.id, { dateKey: '2026-09-26', time: '20:00', reason: '日历改期', eventKey: 'move-ui' });
  assert.equal(moved.item.status, 'rescheduled');
  assert.equal(app.calendarData.getMemos().find(memo => memo.commitmentSourceId === created.id).dateKey, '2026-09-26');
  app.fulfillCommitmentById(created.id, 'done-ui');
  assert.equal(app.calendarData.getMemos().some(memo => memo.commitmentSourceId === created.id), false);
  assert.deepEqual(app.calendarData.getMemos().map(memo => memo.title), ['手工备忘']);
  assert.equal(app.commitmentSummary().fulfilled, 1);
  app.clearCache();
  assert.equal(app.loadCommitments().items[0].status, 'fulfilled');
});
