import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDistrictTransaction } from '../config/causal-district-economy.js';

test('R9-X4 · 虚构街区多维经济与信任资产流转', () => {
    const wallet = { currency: 100, trust: 10, quota: 1 };

    // 成功消费货币增加信任
    const tx1 = executeDistrictTransaction(wallet, {
        deltaCurrency: -50,
        deltaTrust: 5,
        deltaQuota: 1,
        reason: '赞助街区工坊演出'
    });
    assert.equal(tx1.success, true);
    assert.equal(tx1.balances.currency, 50);
    assert.equal(tx1.balances.trust, 15);

    // 货币透支拦截
    const tx2 = executeDistrictTransaction(tx1.balances, {
        deltaCurrency: -80,
        reason: '超额采购'
    });
    assert.equal(tx2.success, false);
    assert.equal(tx2.reason, 'insufficient_currency');
});