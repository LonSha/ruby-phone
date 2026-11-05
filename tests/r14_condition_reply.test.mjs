import test from 'node:test';
import assert from 'node:assert/strict';
import { receivedReplyCondition } from '../config/condition-reminder-runtime.js';
import { CONDITION_REMINDER_KEY } from '../config/condition-reminder-store.js';
test('回复沿已保存操作时间匹配，重放旧消息不刷新时间', () => {
    const rules = [{ id: 'r', kind: 'reply', target: '甲', chatId: 'c', enabled: true, createdAt: 100 }];
    const data = new Map([[CONDITION_REMINDER_KEY, JSON.stringify(rules)]]);
    const storage = { get: k => data.get(k), set: (k,v) => data.set(k,v) };
    const rows = []; let flushes = 0;
    const previous = globalThis.window;
    globalThis.window = { VirtualPhone: { notificationLog: { list: () => rows, push: r => { const row = { ...r, id: 'n1' }; rows.push(row); return row; }, flushNow: () => flushes++ } } };
    try {
        const message = { id: 'm', sender: '甲', type: 'text', content: '好', realTimestamp: 99 };
        receivedReplyCondition(storage, 'c', message); assert.equal(rows.length, 0);
        receivedReplyCondition(storage, 'other', { ...message, realTimestamp: 101 }); assert.equal(rows.length, 0);
        receivedReplyCondition(storage, 'c', { ...message, realTimestamp: 101 }); assert.equal(rows.length, 1); assert.equal(flushes, 1);
        receivedReplyCondition(storage, 'c', { ...message, realTimestamp: 101 }); assert.equal(rows.length, 1);
    } finally { globalThis.window = previous; }
});