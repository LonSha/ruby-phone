/* ========================================================
 * config/intent-relay.js — [R7-O1 · 第七期规划] 意图接力台内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户说想给朋友办生日惊喜，之后会查日期、问人、选方案、采购、安排时间；
 *   此前跨 App 交互缺乏全局有状态的事务上下文，每次切换到不同 App 用户必须重述目的。
 *   意图接力台提供有阶段、有待决问题、有责任人与完成证据的跨 App 意图接力：
 *     ① 跨 App 只传递轻量事务引用（intentRef）与下一动作（nextAction），不复制全部正文；
 *     ② 步骤完成后回写证据并推进阶段，支持失败与安全回滚（撤销已选日期不误删已采购条目）；
 *     ③ 支持多场事务并行推进（如两场不同人生日事务），通过 intentId 严格隔离、互不串线；
 *     ④ 会话隔离存储，提供完整的纯函数归一与自检。
 * ======================================================== */
'use strict';

import { buildOpenRef } from './open-ref.js';
import { writeReceipt } from './write-receipt.js';

/** 意图接力会话存储键（随会话隔离，前缀 ir_ 进入 storage 会话前缀族）。 */
export const IR_STORAGE_KEY = 'ir_relay_v1';
export const IR_MAX_INTENTS = 50;
export const IR_MAX_STEPS = 20;

/** 意图六大生命周期阶段 */
export const IR_STAGES = Object.freeze({
    DRAFT: 'draft',
    ACTIVE: 'active',
    WAITING: 'waiting',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    ROLLED_BACK: 'rolled_back'
});

/** 单一步骤五态 */
export const IR_STEP_STATUS = Object.freeze({
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    DONE: 'done',
    FAILED: 'failed',
    SKIPPED: 'skipped',
    ROLLED_BACK: 'rolled_back'
});

/** 归因词表 */
export const IR_REASONS = Object.freeze({
    OK: '',
    INVALID_INTENT: 'invalid-intent',
    NOT_FOUND: 'intent-not-found',
    STEP_NOT_FOUND: 'step-not-found',
    ALREADY_COMPLETED: 'already-completed',
    INVALID_STAGE_TRANSITION: 'invalid-stage-transition',
    CANNOT_ROLLBACK_DRAFT: 'cannot-rollback-draft',
    ROLLBACK_INDEX_OUT_OF_BOUNDS: 'rollback-index-out-of-bounds',
    NO_STORAGE: 'no-storage',
    WRITE_THREW: 'write-threw'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }

/**
 * 结构归一：确保步骤字段完整合规
 */
export function normalizeStep(raw, index) {
    if (!raw || typeof raw !== 'object') {
        return {
            id: 'step_' + index,
            index: typeof index === 'number' ? index : 0,
            title: '未命名步骤',
            target: { appId: '', tab: null },
            status: IR_STEP_STATUS.PENDING,
            evidence: null,
            completedAt: null
        };
    }
    const id = safeStr(raw.id) || ('step_' + index);
    const title = safeStr(raw.title) || ('步骤 ' + (index + 1));
    const targetRaw = (raw.target && typeof raw.target === 'object') ? raw.target : {};
    const target = {
        appId: safeStr(targetRaw.appId),
        tab: safeStr(targetRaw.tab) || null,
        note: safeStr(targetRaw.note)
    };
    const validStatuses = Object.values(IR_STEP_STATUS);
    const status = validStatuses.includes(raw.status) ? raw.status : IR_STEP_STATUS.PENDING;
    return {
        id,
        index: typeof index === 'number' ? index : 0,
        title,
        target,
        status,
        evidence: (raw.evidence && typeof raw.evidence === 'object') ? Object.freeze({ ...raw.evidence }) : null,
        completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null
    };
}

/**
 * 结构归一：单条意图归一化
 */
export function normalizeIntent(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const id = safeStr(raw.id);
    if (!id) return null;

    const title = safeStr(raw.title) || '未命名意图';
    const goal = safeStr(raw.goal);
    const sourceRaw = (raw.source && typeof raw.source === 'object') ? raw.source : {};
    const source = {
        appId: safeStr(sourceRaw.appId) || 'unknown',
        refId: safeStr(sourceRaw.refId),
        floor: typeof sourceRaw.floor === 'number' ? sourceRaw.floor : null
    };

    const validStages = Object.values(IR_STAGES);
    const stage = validStages.includes(raw.stage) ? raw.stage : IR_STAGES.ACTIVE;

    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    const steps = rawSteps.slice(0, IR_MAX_STEPS).map((s, idx) => normalizeStep(s, idx));

    const rawQuestions = Array.isArray(raw.pendingQuestions) ? raw.pendingQuestions : [];
    const pendingQuestions = rawQuestions.map((q, idx) => {
        if (!q || typeof q !== 'object') return { id: 'q_' + idx, question: '', status: 'open', resolvedValue: null };
        return {
            id: safeStr(q.id) || ('q_' + idx),
            question: safeStr(q.question),
            status: q.status === 'resolved' ? 'resolved' : 'open',
            resolvedValue: q.resolvedValue !== undefined ? q.resolvedValue : null
        };
    });

    const rawParticipants = Array.isArray(raw.participants) ? raw.participants : [];
    const participants = rawParticipants.map(p => {
        if (!p || typeof p !== 'object') return { id: '', name: '', role: '' };
        return {
            id: safeStr(p.id),
            name: safeStr(p.name),
            role: safeStr(p.role)
        };
    }).filter(p => p.id || p.name);

    let currentStepIndex = typeof raw.currentStepIndex === 'number' ? raw.currentStepIndex : 0;
    if (currentStepIndex < 0) currentStepIndex = 0;
    if (steps.length > 0 && currentStepIndex >= steps.length) {
        currentStepIndex = steps.length - 1;
    }

    const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
    const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt;

    return {
        id,
        title,
        goal,
        source,
        stage,
        currentStepIndex,
        steps,
        pendingQuestions,
        participants,
        createdAt,
        updatedAt
    };
}

/**
 * 意图账本归一化
 */
export function normalizeRelayLedger(raw) {
    if (!raw || typeof raw !== 'object') return [];
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.intents) ? raw.intents : []);
    const result = [];
    const seenIds = new Set();
    for (const item of list) {
        const norm = normalizeIntent(item);
        if (norm && !seenIds.has(norm.id)) {
            seenIds.add(norm.id);
            result.push(norm);
            if (result.length >= IR_MAX_INTENTS) break;
        }
    }
    return result;
}

/**
 * 创建新意图事务
 */
export function createIntent(params) {
    if (!params || typeof params !== 'object') {
        throw new Error('createIntent: params must be an object');
    }
    const id = safeStr(params.id) || ('intent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    const title = safeStr(params.title) || '未命名意图';
    const goal = safeStr(params.goal) || '';
    const source = (params.source && typeof params.source === 'object') ? params.source : { appId: 'system' };
    const participants = Array.isArray(params.participants) ? params.participants : [];
    const pendingQuestions = Array.isArray(params.pendingQuestions) ? params.pendingQuestions : [];
    const steps = (Array.isArray(params.steps) ? params.steps : []).map((s, idx) => normalizeStep(s, idx));

    return normalizeIntent({
        id,
        title,
        goal,
        source,
        stage: IR_STAGES.ACTIVE,
        currentStepIndex: 0,
        steps,
        pendingQuestions,
        participants,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
}

/**
 * 推进步骤并回写完成证据
 */
export function advanceIntentStep(intent, stepId, evidence, now = Date.now()) {
    const norm = normalizeIntent(intent);
    if (!norm) return { ok: false, why: IR_REASONS.INVALID_INTENT, intent: null };
    if (norm.stage === IR_STAGES.COMPLETED) {
        return { ok: false, why: IR_REASONS.ALREADY_COMPLETED, intent: norm };
    }

    const sIndex = norm.steps.findIndex(s => s.id === stepId || s.index === stepId);
    if (sIndex < 0) {
        return { ok: false, why: IR_REASONS.STEP_NOT_FOUND, intent: norm };
    }

    const newSteps = norm.steps.map((step, idx) => {
        if (idx !== sIndex) return step;
        return {
            ...step,
            status: IR_STEP_STATUS.DONE,
            evidence: evidence ? Object.freeze({ ...evidence }) : null,
            completedAt: now
        };
    });

    let nextIndex = sIndex + 1;
    let nextStage = norm.stage;
    if (nextIndex >= newSteps.length) {
        nextIndex = newSteps.length - 1;
        // 如果所有步骤都已完成，则意图完成
        const allDone = newSteps.every(s => s.status === IR_STEP_STATUS.DONE || s.status === IR_STEP_STATUS.SKIPPED);
        if (allDone) {
            nextStage = IR_STAGES.COMPLETED;
        }
    } else {
        newSteps[nextIndex] = {
            ...newSteps[nextIndex],
            status: IR_STEP_STATUS.IN_PROGRESS
        };
    }

    const updated = {
        ...norm,
        stage: nextStage,
        currentStepIndex: nextIndex,
        steps: newSteps,
        updatedAt: now
    };

    return { ok: true, why: IR_REASONS.OK, intent: updated };
}

/**
 * 安全回滚到指定历史步骤
 * 规则：回退到 targetStepIndex，但保留已完成采购/已完成存证，标记后续步骤为 rolled_back。
 * 避免误删已完成采购，支持从断点重新决策。
 */
export function rollbackIntentStep(intent, targetStepIndex, reason = '', now = Date.now()) {
    const norm = normalizeIntent(intent);
    if (!norm) return { ok: false, why: IR_REASONS.INVALID_INTENT, intent: null };
    if (typeof targetStepIndex !== 'number' || targetStepIndex < 0 || targetStepIndex >= norm.steps.length) {
        return { ok: false, why: IR_REASONS.ROLLBACK_INDEX_OUT_OF_BOUNDS, intent: norm };
    }

    const newSteps = norm.steps.map((step, idx) => {
        if (idx < targetStepIndex) {
            // 前序步骤保持现状（证据完整保留）
            return step;
        } else if (idx === targetStepIndex) {
            // 当前回滚目标步骤重新置为待决进行中（保留原有证据作为参考历史）
            return {
                ...step,
                status: IR_STEP_STATUS.IN_PROGRESS,
                rollbackReason: safeStr(reason) || '用户主动回滚',
                rolledBackAt: now
            };
        } else {
            // 后续步骤置为 rolled_back，其证据仍然记录在历史中而不抹除
            return {
                ...step,
                status: IR_STEP_STATUS.ROLLED_BACK,
                rollbackReason: safeStr(reason) || '随上游步骤回滚',
                rolledBackAt: now
            };
        }
    });

    const updated = {
        ...norm,
        stage: IR_STAGES.ROLLED_BACK,
        currentStepIndex: targetStepIndex,
        steps: newSteps,
        updatedAt: now
    };

    return { ok: true, why: IR_REASONS.OK, intent: updated };
}

/**
 * 更新或解决待决问题
 */
export function resolvePendingQuestion(intent, questionId, resolvedValue, now = Date.now()) {
    const norm = normalizeIntent(intent);
    if (!norm) return { ok: false, why: IR_REASONS.INVALID_INTENT, intent: null };

    const qIndex = norm.pendingQuestions.findIndex(q => q.id === questionId);
    if (qIndex < 0) {
        return { ok: false, why: 'question-not-found', intent: norm };
    }

    const newQuestions = norm.pendingQuestions.map((q, idx) => {
        if (idx !== qIndex) return q;
        return {
            ...q,
            status: 'resolved',
            resolvedValue: resolvedValue !== undefined ? resolvedValue : true
        };
    });

    const updated = {
        ...norm,
        pendingQuestions: newQuestions,
        updatedAt: now
    };

    return { ok: true, why: IR_REASONS.OK, intent: updated };
}

/**
 * 生成跨 App 派发载荷：只传轻量事务引用与下一动作，不复制全量正文
 */
export function dispatchNextAction(intent) {
    const norm = normalizeIntent(intent);
    if (!norm) return null;
    if (norm.stage === IR_STAGES.COMPLETED || norm.stage === IR_STAGES.CANCELLED) {
        return null;
    }
    const currentStep = norm.steps[norm.currentStepIndex];
    if (!currentStep) return null;

    const targetApp = currentStep.target.appId;
    const targetTab = currentStep.target.tab;

    return {
        appId: targetApp,
        tab: targetTab,
        intentRef: {
            intentId: norm.id,
            stepId: currentStep.id,
            stepIndex: currentStep.index
        },
        openRef: buildOpenRef('item', norm.id, 'annidate'),
        actionPayload: {
            title: norm.title,
            stepTitle: currentStep.title,
            pendingQuestions: norm.pendingQuestions.filter(q => q.status === 'open')
        }
    };
}

/**
 * 多事务并行隔离检索
 */
export function filterIntents(ledger, filters = {}) {
    const list = normalizeRelayLedger(ledger);
    return list.filter(item => {
        if (filters.stage && item.stage !== filters.stage) return false;
        if (filters.appId && item.source.appId !== filters.appId) return false;
        if (filters.intentId && item.id !== filters.intentId) return false;
        if (filters.search) {
            const s = filters.search.toLowerCase();
            const matchTitle = item.title.toLowerCase().includes(s);
            const matchGoal = item.goal.toLowerCase().includes(s);
            if (!matchTitle && !matchGoal) return false;
        }
        return true;
    });
}

/**
 * 存储读操作
 */
export function readIntents(storage) {
    if (!storage || typeof storage.get !== 'function') return [];
    try {
        const raw = storage.get(IR_STORAGE_KEY);
        return normalizeRelayLedger(raw);
    } catch (_e) {
        return [];
    }
}

/**
 * 存储写操作
 */
export async function writeIntents(storage, intents) {
    if (!storage || typeof storage.set !== 'function') {
        return { saved: false, why: IR_REASONS.NO_STORAGE };
    }
    const norm = normalizeRelayLedger(intents);
    try {
        return writeReceipt(storage, IR_STORAGE_KEY, norm);
    } catch (_e) {
        return { saved: false, why: IR_REASONS.WRITE_THREW };
    }
}

/**
 * 单条意图写入/更新
 */
export async function upsertIntent(storage, intent) {
    const norm = normalizeIntent(intent);
    if (!norm) return { saved: false, why: IR_REASONS.INVALID_INTENT };
    const current = readIntents(storage);
    const existingIndex = current.findIndex(i => i.id === norm.id);
    let nextList;
    if (existingIndex >= 0) {
        nextList = [...current];
        nextList[existingIndex] = norm;
    } else {
        nextList = [norm, ...current];
    }
    return writeIntents(storage, nextList);
}

/**
 * 模块自检函数
 */
export function intentRelaySelfCheck() {
    const problems = [];
    if (Object.keys(IR_STAGES).length !== 6) problems.push('IR_STAGES 必须恰好包含 6 态');
    if (Object.keys(IR_STEP_STATUS).length !== 6) problems.push('IR_STEP_STATUS 必须恰好包含 6 态');
    return { problems };
}
