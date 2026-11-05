import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as finance from '../config/finance-commit.js';
import { normalizeFinanceLedger } from '../config/finance-overview.js';
import { readChores, saveChore } from '../config/shared-chore-store.js';
import { choreFinanceDraft } from '../config/shared-chore-finance.js';
const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('    function applyFinanceCommitAction(');
const end = source.indexOf('\n    /**', start);
const code = source.slice(start, end);
const raw = { id: 'host-case', title: '准备聚餐', members: ['甲','乙'], cents: 123, tasks: [{ id: 'a', title: '买菜', assignee: '甲' }] };
test('真实宿主函数：确认、重复、作废与坏存储', () => {
    const data = new Map();
    const storage = { get: k => data.get(k), set: (k,v) => data.set(k,v) };
    assert.equal(saveChore(storage, raw).ok, true);
    const context = vm.createContext({ ...finance, normalizeFinanceLedger, storage, readChores, choreFinanceDraft,
        window: { VirtualPhone: {} }, refreshFinanceCommit() {}, Date });
    vm.runInContext(code, context);
    const apply = context.applyFinanceCommitAction;
    assert.equal(apply('commit', raw.id).ok, true);
    const first = data.get(finance.FINANCE_COMMIT_LEDGER_KEY);
    assert.equal(apply('commit', raw.id).plan, finance.FC_PLANS.replay);
    assert.equal(data.get(finance.FINANCE_COMMIT_LEDGER_KEY), first);
    assert.equal(saveChore(storage, raw, { op: 'cancel' }).ok, true);
    assert.equal(apply('commit', raw.id).ok, false);
    assert.equal(data.get(finance.FINANCE_COMMIT_LEDGER_KEY), first);
});