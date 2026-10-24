/* ============================================================
 * config/crossapp-transaction-stack.js — [R9-O2 · 第九期规划]
 * 跨 App 复合业务事务协调器与逆向补偿栈（纯函数内核）
 * ------------------------------------------------------------
 * 【治理缺口】
 *   旧 action-stack.js 仅支持单 App 局部 action 撤销。
 *   在真实业务场景中（如「改期并通知相关角色」「退换道具并退款」），
 *   操作横跨日历、微信、背包、钱包等多个 App。如果第三步失败，
 *   系统产生脏数据且用户无法一键安全回滚。
 *
 * 【核心设计】
 *   ① 事务模型 (Composite Transaction):
 *      - txId: 事务唯一标识
 *      - label: 事务名称（如「海滩行程变更」）
 *      - status: PENDING / COMMITTED / ROLLED_BACK / FAILED
 *      - steps: 顺序执行的操作步骤清单
 *        每个 step 包含:
 *          - stepId, app, action, payload
 *          - compensator: 逆向补偿动作描述与参数 (若不可逆则标记 irreversible: true)
 *          - state: PENDING / DONE / COMPENSATED / FAILED
 *
 *   ② 事务提交与安全回滚 (Rollback Preview & Execute):
 *      - 预演回滚：计算若执行回滚将触发哪些补偿，哪些步骤无法撤销
 *      - 实际回滚：严格逆序 (LIFO) 执行 compensator
 *      - 幂等保护：防止重复提交或重复回滚
 * ============================================================ */

export const TX_STATUS = Object.freeze({
    PENDING: 'pending',
    COMMITTED: 'committed',
    ROLLED_BACK: 'rolled_back',
    FAILED: 'failed'
});

export function createTransaction(txId, label) {
    const id = String(txId || '').trim();
    if (!id) return null;

    return {
        txId: id,
        label: String(label || '未命名事务').trim(),
        status: TX_STATUS.PENDING,
        steps: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

export function appendTransactionStep(tx, step) {
    if (!tx || tx.status !== TX_STATUS.PENDING) {
        return { ok: false, error: 'transaction-not-pending' };
    }
    if (!step || !step.app || !step.action) {
        return { ok: false, error: 'invalid-step' };
    }

    const stepId = String(step.stepId || `step-${tx.steps.length + 1}`).trim();
    const newStep = {
        stepId,
        app: String(step.app).trim(),
        action: String(step.action).trim(),
        payload: step.payload || {},
        compensator: step.compensator || null, // { app, action, payload }
        irreversible: Boolean(step.irreversible),
        executed: true,
        executedAt: Date.now()
    };

    const updated = {
        ...tx,
        steps: [...tx.steps, newStep],
        updatedAt: Date.now()
    };

    return { ok: true, tx: updated };
}

export function commitTransaction(tx) {
    if (!tx || tx.status !== TX_STATUS.PENDING) {
        return { ok: false, error: 'transaction-not-pending' };
    }

    const updated = {
        ...tx,
        status: TX_STATUS.COMMITTED,
        committedAt: Date.now(),
        updatedAt: Date.now()
    };

    return { ok: true, tx: updated };
}

/**
 * 预演回滚操作，生成补偿计划
 */
export function previewRollback(tx) {
    if (!tx || (tx.status !== TX_STATUS.COMMITTED && tx.status !== TX_STATUS.PENDING)) {
        return { ok: false, error: 'transaction-not-rollbackable' };
    }

    const compensations = [];
    const irreversibleSteps = [];

    // LIFO 逆序生成补偿
    for (let i = tx.steps.length - 1; i >= 0; i--) {
        const step = tx.steps[i];
        if (step.irreversible) {
            irreversibleSteps.push({
                stepId: step.stepId,
                app: step.app,
                action: step.action
            });
        } else if (step.compensator) {
            compensations.push({
                targetStepId: step.stepId,
                app: step.compensator.app,
                action: step.compensator.action,
                payload: step.compensator.payload
            });
        }
    }

    return {
        ok: true,
        canFullyRollback: irreversibleSteps.length === 0,
        compensationCount: compensations.length,
        irreversibleCount: irreversibleSteps.length,
        compensations,
        irreversibleSteps
    };
}

/**
 * 执行逆序补偿并标记事务为已回滚
 */
export function executeRollback(tx) {
    const preview = previewRollback(tx);
    if (!preview.ok) return preview;

    const updated = {
        ...tx,
        status: TX_STATUS.ROLLED_BACK,
        rolledBackAt: Date.now(),
        compensationPlan: preview.compensations,
        updatedAt: Date.now()
    };

    return {
        ok: true,
        rolledBack: true,
        preview,
        tx: updated
    };
}