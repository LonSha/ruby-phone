/* ============================================================
 * config/cadence-topic-thread.js — [R9-O5 · 第九期规划]
 * 角色交流连续议题与回应节奏状态机（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   ① 交流线程状态 (Thread Cadence):
 *      - IDLE:       空闲，角色可即时回应
 *      - BUSY:       正在参与剧情/特定活动，回应带延迟与忙碌说明
 *      - AWAITING_ACTION: 等待用户提供道具或做出关键选择
 *      - COOLDOWN:   交谈冷却中，防高频刷屏
 *
 *   ② 议题流转 (Topic Progression):
 *      - 支持中断后重新接回先前未完成的核心讨论，避免“角色失忆”
 * ============================================================ */

export const CADENCE_STATES = Object.freeze({
    IDLE: 'idle',
    BUSY: 'busy',
    AWAITING_ACTION: 'awaiting_action',
    COOLDOWN: 'cooldown'
});

export function createTopicThread(threadId, characterId, initialTopic) {
    const id = String(threadId || `th-${Date.now()}`).trim();
    if (!id || !characterId) return null;

    return {
        threadId: id,
        characterId: String(characterId).trim(),
        cadenceState: CADENCE_STATES.IDLE,
        currentTopic: String(initialTopic || '日常寒暄').trim(),
        pendingQuestions: [],
        cooldownUntil: 0,
        activityContext: null,
        history: [],
        updatedAt: Date.now()
    };
}

export function updateCharacterCadence(thread, newState, options = {}) {
    if (!thread || !thread.threadId) return { ok: false, error: 'invalid-thread' };
    if (!Object.values(CADENCE_STATES).includes(newState)) {
        return { ok: false, error: 'invalid-state' };
    }

    const updated = {
        ...thread,
        cadenceState: newState,
        activityContext: options.activityContext || null,
        cooldownUntil: newState === CADENCE_STATES.COOLDOWN ? (Date.now() + (options.durationMs || 60000)) : 0,
        updatedAt: Date.now()
    };

    return { ok: true, thread: updated };
}

export function resumeThreadTopic(thread, newTopic, resumeReason) {
    if (!thread || !thread.threadId) return { ok: false, error: 'invalid-thread' };

    const historyEntry = {
        previousTopic: thread.currentTopic,
        resumedTopic: newTopic,
        reason: String(resumeReason || 'manual-resume').trim(),
        timestamp: Date.now()
    };

    const updated = {
        ...thread,
        currentTopic: String(newTopic).trim(),
        history: [...thread.history, historyEntry],
        updatedAt: Date.now()
    };

    return { ok: true, thread: updated };
}