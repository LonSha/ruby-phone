import test from 'node:test';
import assert from 'node:assert/strict';
import { CONDITION_REMINDER_KEY as KEY, evaluateConditionReminders, readConditionReminders } from '../config/condition-reminder-store.js';
const rule = { id: 'r1', kind: 'task-completed', target: 'c:t', enabled: true, createdAt: 10 };
const event = { id: 'e1', kind: rule.kind, target: rule.target, at: 11, valid: true };
const sources = { 'task-completed': true };
function setup() {
    const map = new Map([[KEY, JSON.stringify([rule])]]);
    const storage = { get: k => map.get(k), set: (k,v) => map.set(k,v) };
    const rows = []; const log = { list: () => rows, push: rec => { const row = { ...rec, id: 'n' + rows.length }; rows.push(row); return row; } };
    return { storage, rows, log };
}
test('条件到达仅通知一次并保存来源', () => {
    const { storage, rows, log } = setup();
    assert.equal(evaluateConditionReminders(storage, [event], sources, log).triggered, 1);
    assert.equal(evaluateConditionReminders(storage, [event], sources, log).triggered, 0);
    assert.equal(rows.length, 1); assert.equal(readConditionReminders(storage).rules[0].receipt.eventId, 'e1');
});
test('禁用不触发，通知失败可以重试', () => {
    const { storage, rows, log } = setup();
    storage.set(KEY, JSON.stringify([{ ...rule, enabled: false }]));
    evaluateConditionReminders(storage, [event], sources, log); assert.equal(rows.length, 0);
    storage.set(KEY, JSON.stringify([rule]));
    assert.equal(evaluateConditionReminders(storage, [event], sources, { list: () => [], push: () => ({ id: '' }) }).ok, false);
    assert.equal(evaluateConditionReminders(storage, [event], sources, log).triggered, 1);
});
test('回执写入失败不通知', () => {
    const { storage, rows, log } = setup(); storage.set = () => {};
    assert.equal(evaluateConditionReminders(storage, [event], sources, log).ok, false); assert.equal(rows.length, 0);
});
test('通知已落但最终回执中断，重试不新增通知', () => {
    const { storage, rows, log } = setup(); const set = storage.set; let writes = 0;
    storage.set = (k,v) => { if (++writes === 2) throw Error('interrupted'); set(k,v); };
    assert.equal(evaluateConditionReminders(storage, [event], sources, log).ok, false);
    storage.set = set; evaluateConditionReminders(storage, [event], sources, log); assert.equal(rows.length, 1);
});
test('最终回执静默写失败可检测，重试复用通知', () => {
 const { storage, rows, log } = setup(); const set = storage.set; let writes = 0;
 storage.set = (k,v) => { if (++writes !== 2) set(k,v); };
 assert.equal(evaluateConditionReminders(storage, [event], sources, log).ok, false);
 storage.set = set;
 assert.equal(evaluateConditionReminders(storage, [], sources, log).triggered, 1);
 assert.equal(rows.length, 1);
});
