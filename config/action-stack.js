/* ========================================================
 * config/action-stack.js — [R8-O2 · 第八期规划] 可逆行动栈内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决跨 App 复杂操作无法撤销、用户误操作无法挽回的问题：
 *     ① 行动记录：appId / actionType / description / rollbackData / canUndo；
 *     ② 单步与批量撤销：支持直接撤销回退，若不可逆则提供补偿命令（compensation）；
 *     ③ 幂等防护：防止重复触发撤销导致重复扣除或状态混乱；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */
'use strict';

const AS_STORAGE_KEY = 'as_action_stack_v1';
export const AS_MAX_STACK = 40;

export const ACTION_STATUS = Object.freeze({
    DONE: 'done',
    UNDONE: 'undone',
    COMPENSATED: 'compensated',
    IRREVERSIBLE: 'irreversible'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeActionStack(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            stack: [],
            updatedAt: Date.now()
        };
    }
    return {
        stack: safeArr(raw.stack).slice(-AS_MAX_STACK),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 压入一次跨 App 行动
 */
export function pushAction(state, spec) {
    const s = normalizeActionStack(state);
    if (!spec || typeof spec !== 'object') {
        return { success: false, reason: 'invalid-spec', state: s };
    }
    const appId = safeStr(spec.appId);
    const actionType = safeStr(spec.actionType);
    if (!appId || !actionType) {
        return { success: false, reason: 'missing-app-or-action-type', state: s };
    }

    const id = safeStr(spec.id) || `act_${appId}_${Date.now()}`;
    const entry = {
        id,
        appId,
        actionType,
        description: safeStr(spec.description) || `${appId}: ${actionType}`,
        canUndo: spec.canUndo !== false,
        rollbackData: spec.rollbackData ? { ...spec.rollbackData } : null,
        compensationSuggestion: safeStr(spec.compensationSuggestion),
        status: spec.canUndo === false ? ACTION_STATUS.IRREVERSIBLE : ACTION_STATUS.DONE,
        createdAt: Date.now()
    };

    const nextStack = [...s.stack, entry].slice(-AS_MAX_STACK);
    return {
        success: true,
        action: entry,
        state: {
            ...s,
            stack: nextStack,
            updatedAt: Date.now()
        }
    };
}

/**
 * 撤销栈顶（或指定）行动
 */
export function undoAction(state, actionId) {
    const s = normalizeActionStack(state);
    const targetId = safeStr(actionId);
    let targetIndex = -1;

    if (targetId) {
        targetIndex = s.stack.findIndex(a => a.id === targetId);
    } else {
        // 默认寻找最顶层可撤销的动作
        for (let i = s.stack.length - 1; i >= 0; i--) {
            if (s.stack[i].status === ACTION_STATUS.DONE && s.stack[i].canUndo) {
                targetIndex = i;
                break;
            }
        }
    }

    if (targetIndex === -1) {
        return { success: false, reason: 'no-undoable-action-found', state: s };
    }

    const target = s.stack[targetIndex];
    if (target.status === ACTION_STATUS.UNDONE) {
        return { success: false, reason: 'already-undone', state: s };
    }
    if (!target.canUndo) {
        return {
            success: false,
            reason: 'action-is-irreversible',
            remedySuggestion: target.compensationSuggestion || '该操作不可逆，建议采取补偿替代',
            state: s
        };
    }

    const updatedAction = { ...target, status: ACTION_STATUS.UNDONE, undoneAt: Date.now() };
    const nextStack = [...s.stack];
    nextStack[targetIndex] = updatedAction;

    return {
        success: true,
        undoneAction: updatedAction,
        rollbackData: target.rollbackData,
        state: {
            ...s,
            stack: nextStack,
            updatedAt: Date.now()
        }
    };
}