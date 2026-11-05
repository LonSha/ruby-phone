import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedChore, choreAction, choreSplit } from '../config/shared-chore.js';
import { readChores, saveChore } from '../config/shared-chore-store.js';
import { SharedChoreView } from '../apps/affairs/shared-chore-view.js';
const seed = () => ({ id: 'one', title: '聚餐准备', members: ['甲', '乙', '丙'], cents: 100,
    tasks: [{ id: 'a', title: '买菜', assignee: '乙' }, { id: 'b', title: '订位', assignee: '丙' }] });
const storage = () => { const data = new Map(); return { get: k => data.get(k), set: (k,v) => data.set(k,v) }; };
test('代办保留负责人且费用草案不变', () => {
    const raw = seed(); const before = structuredClone(raw);
    const result = choreAction(raw, { op: 'delegate', taskId: 'a', member: '甲' });
    assert.equal(result.ok, true); assert.equal(result.chore.tasks[0].assignee, '乙');
    assert.equal(result.chore.tasks[0].executor, '甲'); assert.equal(result.chore.tasks[0].done, false);
    assert.deepEqual(choreSplit(result.chore), choreSplit(raw)); assert.deepEqual(raw, before);
});
test('部分完成保留余项且重复完成被拒绝', () => {
    const result = choreAction(seed(), { op: 'finish', at: '2026-11-05T10:00:00Z', taskId: 'a', member: '甲' });
    assert.equal(result.chore.state, 'partial'); assert.equal(result.chore.tasks[1].done, false);
    assert.equal(choreAction(result.chore, { op: 'finish', at: '2026-11-05T10:00:00Z', taskId: 'a', member: '乙' }).ok, false);
    assert.equal(choreAction(result.chore, { op: 'finish', at: '2026-11-05T10:00:00Z', taskId: 'b', member: '丙' }).chore.state, 'done');
});
test('分摊逐分守恒且从不标记付款', () => {
    for (const cents of [0,1,2,100,10001]) {
        const split = choreSplit({ ...seed(), cents });
        assert.equal(split.rows.reduce((n,r) => n+r.cents, 0), cents);
        assert.equal(split.paid, false); assert.ok(split.rows.every(r => r.state === 'draft'));
    }
});
test('作废不改费用及执行历史，作废后拒绝执行', () => {
    const before = sharedChore(seed()); const cancelled = choreAction(before, { op: 'cancel' }).chore;
    assert.deepEqual(cancelled.tasks, before.tasks); assert.deepEqual(choreSplit(cancelled), choreSplit(before));
    assert.equal(choreAction(cancelled, { op: 'finish', at: '2026-11-05T10:00:00Z', taskId: 'a', member: '甲' }).ok, false);
});
test('刷新读回与存储隔离', () => {
    const a = storage(), b = storage(); assert.equal(saveChore(a, seed()).ok, true);
    assert.equal(saveChore(a, { id: 'one' }, { op: 'finish', at: '2026-11-05T10:00:00Z', taskId: 'a', member: '甲' }).ok, true);
    assert.equal(readChores(a).rows[0].state, 'partial'); assert.deepEqual(readChores(b).rows, []);
});
test('坏存储禁止覆盖，写失败禁止报成功', () => {
    let writes = 0;
    assert.equal(saveChore({ get: () => '{', set: () => writes++ }, seed()).ok, false); assert.equal(writes, 0);
    assert.equal(saveChore({ get: () => null, set: () => {} }, seed()).why, 'write-failed');
});
test('拒绝重复人名、重复子项与非整数金额', () => {
    assert.equal(sharedChore({ ...seed(), members: ['甲','甲'] }), null);
    assert.equal(sharedChore({ ...seed(), cents: 0.1 }), null);
    assert.equal(sharedChore({ ...seed(), tasks: [seed().tasks[0], seed().tasks[0]] }), null);
});
test('视图转义属性引号和标签', () => {
    const view = new SharedChoreView({}); const out = view.esc('\"\'><img src=x>');
    assert.equal(/[<>"']/.test(out), false);
});
