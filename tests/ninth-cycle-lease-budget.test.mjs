import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateAppLease } from '../config/runtime-resource-lease-budget.js';

test('R9-O8 · 运行时应用租约分配与按上限剔除', () => {
    let leases = [];
    const apps = ['app1', 'app2', 'app3', 'app4', 'app5', 'app6'];

    for (const a of apps) {
        const res = allocateAppLease(leases, a, { maxActive: 5 });
        leases = res.kept;
    }

    assert.equal(leases.length, 5);
    assert.equal(leases.some(l => l.appId === 'app6'), true);
    assert.equal(leases.some(l => l.appId === 'app1'), false); // 最早进入的被逐出
});