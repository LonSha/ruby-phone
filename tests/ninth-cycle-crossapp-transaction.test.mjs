import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TX_STATUS,
    createTransaction,
    appendTransactionStep,
    commitTransaction,
    previewRollback,
    executeRollback
} from '../config/crossapp-transaction-stack.js';

test('R9-O2 · 跨 App 事务创建与步骤追加', () => {
    const tx = createTransaction('tx-reschedule-01', '行程改期与通知');
    assert.equal(tx.status, TX_STATUS.PENDING);
    assert.equal(tx.steps.length, 0);

    // 步骤 1：日历更新日程
    const s1Res = appendTransactionStep(tx, {
        app: 'calendar',
        action: 'update_event',
        payload: { eventId: 'ev-1', newDate: '2026-10-30' },
        compensator: { app: 'calendar', action: 'update_event', payload: { eventId: 'ev-1', newDate: '2026-10-25' } }
    });
    assert.equal(s1Res.ok, true);

    // 步骤 2：微信发送通知消息（标记为不可逆，已发出不能自动从对方脑中撤回）
    const s2Res = appendTransactionStep(s1Res.tx, {
        app: 'wechat',
        action: 'send_message',
        payload: { target: 'luo_jia', text: '改到30号了' },
        irreversible: true
    });
    assert.equal(s2Res.ok, true);
    assert.equal(s2Res.tx.steps.length, 2);
});

test('R9-O2 · 事务回滚预演：逆序补偿与不可逆步骤排查', () => {
    let tx = createTransaction('tx-shop-refund', '购买道具并扣款');
    
    // 步骤 1：钱包扣款
    tx = appendTransactionStep(tx, {
        stepId: 'step-deduct-balance',
        app: 'wallet',
        action: 'deduct',
        payload: { amount: 50 },
        compensator: { app: 'wallet', action: 'refund', payload: { amount: 50 } }
    }).tx;

    // 步骤 2：背包放入物品
    tx = appendTransactionStep(tx, {
        stepId: 'step-add-item',
        app: 'backpack',
        action: 'add_item',
        payload: { itemId: 'item-magic-pen' },
        compensator: { app: 'backpack', action: 'remove_item', payload: { itemId: 'item-magic-pen' } }
    }).tx;

    const commitRes = commitTransaction(tx);
    assert.equal(commitRes.ok, true);

    // 预演回滚
    const preview = previewRollback(commitRes.tx);
    assert.equal(preview.ok, true);
    assert.equal(preview.canFullyRollback, true);
    assert.equal(preview.compensationCount, 2);
    // 验证逆序补偿 (LIFO)：背包物品先移除，然后钱包退款
    assert.equal(preview.compensations[0].targetStepId, 'step-add-item');
    assert.equal(preview.compensations[1].targetStepId, 'step-deduct-balance');

    // 执行回滚
    const exec = executeRollback(commitRes.tx);
    assert.equal(exec.ok, true);
    assert.equal(exec.tx.status, TX_STATUS.ROLLED_BACK);
    assert.equal(exec.tx.compensationPlan.length, 2);
});