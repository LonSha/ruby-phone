import test from 'node:test';
import assert from 'node:assert/strict';
import { choreFinanceDraft } from '../config/shared-chore-finance.js';
import { planCommit, applyCommitPlan, readbackCommit, FC_PLANS } from '../config/finance-commit.js';
import { choreAction } from '../config/shared-chore.js';
const raw = { id: 'one', title: '聚餐', members: ['甲','乙'], cents: 101, tasks: [{ id: 'a', title: '订位', assignee: '乙' }] };
test('共同事项沿原财务计划提交并读回，重复提交幂等', () => {
    const draft = choreFinanceDraft(raw);
    const plan = planCommit(draft, [], { at: 100 });
    assert.equal(plan.plan, FC_PLANS.fresh); assert.equal(plan.entry.amountCents, 101);
    const applied = applyCommitPlan([], plan);
    assert.equal(readbackCommit(plan, applied.entries).confirmed, true);
    assert.equal(planCommit(draft, applied.entries).plan, FC_PLANS.replay);
    assert.match(draft.note, /不代表付款/);
});
test('作废无财务草案，完成代办不改变财务身份与金额', () => {
    assert.equal(choreFinanceDraft({ ...raw, state: 'cancelled' }), null);
    const done = choreAction(raw, { op: 'finish', taskId: 'a', member: '甲', at: '2026-11-05T10:00:00Z' });
    assert.equal(done.chore.tasks[0].completedAt, '2026-11-05T10:00:00Z');
    assert.deepEqual(choreFinanceDraft(done.chore), choreFinanceDraft(raw));
});