import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderPreview, matchReminder } from '../config/condition-reminder.js';
const rule = { kind: 'reply', target: 'member-id', enabled: true, createdAt: 100 };
const event = { id: 'message-id', kind: 'reply', target: 'member-id', at: 101, valid: true };
const sources = { reply: true };
test('真源缺席显示不可用且不能匹配', () => {
    assert.equal(reminderPreview(rule, {}).available, false);
    assert.equal(matchReminder(rule, event, {}).matched, false);
});
test('条件未满足、禁用、旧事件不提醒', () => {
    for (const changed of [{ ...event, target: 'other' }, { ...event, valid: false }, { ...event, at: 100 }, { ...event, id: '' }]) {
        assert.equal(matchReminder(rule, changed, sources).matched, false);
    }
    assert.equal(matchReminder({ ...rule, enabled: false }, event, sources).matched, false);
});
test('匹配保留来源回执，已有回执不重复触发', () => {
    const result = matchReminder(rule, event, sources);
    assert.equal(result.matched, true); assert.equal(result.receipt.eventId, event.id);
    assert.equal(matchReminder({ ...rule, receipt: result.receipt }, event, sources).matched, false);
});