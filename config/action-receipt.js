/* ========================================================
 * config/action-receipt.js — [R7-O2 · 第七期规划] 行动回执与补救内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户确认改期或发出邀请后，想知道状态是否真的改变；遇到失败能继续而不是重复操作。
 *   为跨 App 关键动作提供统一的用户可读回执与补救机制：
 *     ① 区分五大明确状态：saved（已保存）/ waiting_reply（等待回应）/ rejected（被拒绝）/
 *        retryable_failure（失败可重试）/ cancelled（已撤销）；
 *     ② 区分模型提议（model）与用户确认结果（user + confirmed）；
 *     ③ 针对 actionKey 提供幂等去重与防抖，重复提交返回既有回执并标记 replayed: true；
 *     ④ 失败场景提供结构化补救行动建议（remedies: 重试/备选/撤销）；
 *     ⑤ 会话隔离存储，提供完整的纯函数归一与自检。
 * ======================================================== */
'use strict';

import { writeReceipt } from './write-receipt.js';

export const AR_STORAGE_KEY = 'ar_receipts_v1';
export const AR_MAX_RECEIPTS = 100;
export const AR_IDEMPOTENCY_WINDOW_MS = 60000; // 1 分钟内的相同操作视为重复回放

/** 行动回执五大状态 */
export const AR_STATUS = Object.freeze({
    SAVED: 'saved',
    WAITING_REPLY: 'waiting_reply',
    REJECTED: 'rejected',
    RETRYABLE_FAILURE: 'retryable_failure',
    CANCELLED: 'cancelled'
});

/** 来源类型 */
export const AR_ORIGIN = Object.freeze({
    MODEL: 'model',
    USER: 'user'
});

/** 归因词表 */
export const AR_REASONS = Object.freeze({
    OK: '',
    INVALID_DRAFT: 'invalid-draft',
    MISSING_ACTION_KEY: 'missing-action-key',
    MISSING_APP_ID: 'missing-app-id',
    UNKNOWN_STATUS: 'unknown-status',
    REPLAYED: 'replayed-idempotent',
    NO_STORAGE: 'no-storage',
    WRITE_THREW: 'write-threw'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }

/**
 * 补救方案构造器
 */
export function buildRemedy(remedyId, label, actionType, payload = {}) {
    return Object.freeze({
        id: safeStr(remedyId),
        label: safeStr(label),
        actionType: safeStr(actionType),
        payload: payload && typeof payload === 'object' ? Object.freeze({ ...payload }) : Object.freeze({})
    });
}

/**
 * 生成默认补救建议
 */
export function defaultRemediesFor(status, actionType, payload = {}) {
    const list = [];
    if (status === AR_STATUS.RETRYABLE_FAILURE) {
        list.push(buildRemedy('retry_now', '立即重试', 'retry', { actionType, ...payload }));
        list.push(buildRemedy('cancel_action', '放弃并撤销', 'cancel', { actionType, ...payload }));
    } else if (status === AR_STATUS.REJECTED) {
        list.push(buildRemedy('choose_alternative', '调整方案重试', 'adjust', { actionType, ...payload }));
        list.push(buildRemedy('dismiss', '我知道了', 'dismiss', { actionType, ...payload }));
    } else if (status === AR_STATUS.WAITING_REPLY) {
        list.push(buildRemedy('send_reminder', '提醒对方', 'remind', { actionType, ...payload }));
        list.push(buildRemedy('cancel_invite', '撤回等待', 'cancel', { actionType, ...payload }));
    }
    return Object.freeze(list);
}

/**
 * 单条回执归一化
 */
export function normalizeActionReceipt(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const id = safeStr(raw.id);
    const actionKey = safeStr(raw.actionKey);
    const appId = safeStr(raw.appId);
    if (!id || !actionKey || !appId) return null;

    const validStatuses = Object.values(AR_STATUS);
    const status = validStatuses.includes(raw.status) ? raw.status : AR_STATUS.SAVED;

    const origin = (raw.origin === AR_ORIGIN.MODEL) ? AR_ORIGIN.MODEL : AR_ORIGIN.USER;
    const confirmed = (raw.confirmed !== undefined) ? Boolean(raw.confirmed) : true;

    const title = safeStr(raw.title) || '操作回执';
    const detail = safeStr(raw.detail);
    const actionType = safeStr(raw.actionType) || 'unknown';

    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    const replayed = Boolean(raw.replayed);

    const actionRef = (raw.actionRef && typeof raw.actionRef === 'object') ? Object.freeze({ ...raw.actionRef }) : null;

    let remedies = [];
    if (Array.isArray(raw.remedies)) {
        remedies = raw.remedies.map(r => buildRemedy(r.id, r.label, r.actionType, r.payload));
    } else if (status === AR_STATUS.RETRYABLE_FAILURE || status === AR_STATUS.REJECTED || status === AR_STATUS.WAITING_REPLY) {
        remedies = defaultRemediesFor(status, actionType, actionRef);
    }

    return Object.freeze({
        id,
        actionKey,
        appId,
        actionType,
        title,
        detail,
        status,
        origin,
        confirmed,
        replayed,
        actionRef,
        remedies: Object.freeze(remedies),
        timestamp
    });
}

/**
 * 回执列表归一化
 */
export function normalizeReceiptList(raw) {
    if (!raw || typeof raw !== 'object') return [];
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.receipts) ? raw.receipts : []);
    const result = [];
    const seenIds = new Set();
    for (const item of list) {
        const norm = normalizeActionReceipt(item);
        if (norm && !seenIds.has(norm.id)) {
            seenIds.add(norm.id);
            result.push(norm);
            if (result.length >= AR_MAX_RECEIPTS) break;
        }
    }
    return result;
}

/**
 * 记录行动回执（含幂等判定与副作用防抖）
 */
export function planActionReceipt(existingList, draft, now = Date.now()) {
    const list = normalizeReceiptList(existingList);
    if (!draft || typeof draft !== 'object') {
        return { ok: false, why: AR_REASONS.INVALID_DRAFT, receipt: null, nextList: list };
    }
    const actionKey = safeStr(draft.actionKey);
    const appId = safeStr(draft.appId);
    if (!actionKey) {
        return { ok: false, why: AR_REASONS.MISSING_ACTION_KEY, receipt: null, nextList: list };
    }
    if (!appId) {
        return { ok: false, why: AR_REASONS.MISSING_APP_ID, receipt: null, nextList: list };
    }

    // 检查是否有时间窗口内的幂等命中
    const existing = list.find(r => r.actionKey === actionKey);
    if (existing && (now - existing.timestamp <= AR_IDEMPOTENCY_WINDOW_MS)) {
        const replayedReceipt = Object.freeze({
            ...existing,
            replayed: true
        });
        return {
            ok: true,
            why: AR_REASONS.REPLAYED,
            receipt: replayedReceipt,
            nextList: list
        };
    }

    const id = safeStr(draft.id) || ('rcpt_' + now + '_' + Math.random().toString(36).slice(2, 7));
    const receipt = normalizeActionReceipt({
        id,
        actionKey,
        appId,
        actionType: draft.actionType,
        title: draft.title,
        detail: draft.detail,
        status: draft.status || AR_STATUS.SAVED,
        origin: draft.origin || AR_ORIGIN.USER,
        confirmed: draft.confirmed !== undefined ? draft.confirmed : true,
        replayed: false,
        actionRef: draft.actionRef,
        remedies: draft.remedies,
        timestamp: now
    });

    const nextList = [receipt, ...list.filter(r => r.id !== receipt.id)].slice(0, AR_MAX_RECEIPTS);
    return {
        ok: true,
        why: AR_REASONS.OK,
        receipt,
        nextList
    };
}

/**
 * 撤销回执与状态补救
 */
export function cancelReceipt(existingList, receiptId, reason = '', now = Date.now()) {
    const list = normalizeReceiptList(existingList);
    const idx = list.findIndex(r => r.id === receiptId);
    if (idx < 0) {
        return { ok: false, why: 'receipt-not-found', nextList: list, receipt: null };
    }
    const target = list[idx];
    const cancelled = normalizeActionReceipt({
        ...target,
        status: AR_STATUS.CANCELLED,
        detail: (target.detail ? target.detail + ' ' : '') + `[已撤销: ${safeStr(reason) || '用户取消'}]`,
        timestamp: now
    });
    const nextList = [...list];
    nextList[idx] = cancelled;
    return { ok: true, why: AR_REASONS.OK, nextList, receipt: cancelled };
}

/**
 * 存储读操作
 */
export function readReceipts(storage) {
    if (!storage || typeof storage.get !== 'function') return [];
    try {
        const raw = storage.get(AR_STORAGE_KEY);
        return normalizeReceiptList(raw);
    } catch (_e) {
        return [];
    }
}

/**
 * 存储写操作
 */
export async function writeReceipts(storage, receipts) {
    if (!storage || typeof storage.set !== 'function') {
        return { saved: false, why: AR_REASONS.NO_STORAGE };
    }
    const norm = normalizeReceiptList(receipts);
    try {
        return writeReceipt(storage, AR_STORAGE_KEY, norm);
    } catch (_e) {
        return { saved: false, why: AR_REASONS.WRITE_THREW };
    }
}

/**
 * 记录回执并持久化
 */
export async function recordActionReceipt(storage, draft, now = Date.now()) {
    const current = readReceipts(storage);
    const plan = planActionReceipt(current, draft, now);
    if (!plan.ok) {
        return { ok: false, why: plan.why, receipt: null };
    }
    // 如果是幂等重放且列表未变，无需重复落盘
    if (plan.why === AR_REASONS.REPLAYED) {
        return { ok: true, why: plan.why, receipt: plan.receipt, saved: true };
    }
    const writeRes = await writeReceipts(storage, plan.nextList);
    return {
        ok: true,
        why: plan.why,
        receipt: plan.receipt,
        saved: writeRes.saved
    };
}

/**
 * 模块自检函数
 */
export function actionReceiptSelfCheck() {
    const problems = [];
    if (Object.keys(AR_STATUS).length !== 5) problems.push('AR_STATUS 必须恰好包含 5 态');
    if (Object.keys(AR_ORIGIN).length !== 2) problems.push('AR_ORIGIN 必须包含 model 和 user');
    return { problems };
}