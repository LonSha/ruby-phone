/* ========================================================
 * config/character-presence.js — [R7-O4 · 第七期规划] 人物在场与可用性内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户准备联系一位正在出行或忙于活动的角色时，以往常收到无视处境的随机即时回复；
 *   人物在场与可用性内核综合角色的行程、活动与知情状态，输出尊重当下处境的联络指引：
 *     ① 明确在场三态：此刻在场(available_now) / 稍后可联系(busy_later) / 处境未知(unknown)；
 *     ② 基于处境给出推荐联络渠道（即时通话、微信、留言排队）；
 *     ③ 支持邀请排队(queue)与撤回(cancel)；撤回诚实记录，绝不伪造对方已读；
 *     ④ 角色活动结束后自动接回挂起的原议题，实现自然的时序互动闭环。
 * ======================================================== */
'use strict';

/** 角色在场与可用性三态 */
export const PRESENCE_STATES = Object.freeze({
    AVAILABLE_NOW: 'available_now', // 此刻在场：空闲可立即联系
    BUSY_LATER: 'busy_later',       // 忙于活动：稍后可联系
    UNKNOWN: 'unknown'              // 处境未知：无有效行程/活动数据
});

/** 推荐通信渠道 */
export const CONTACT_CHANNELS = Object.freeze({
    CALL: 'call',
    WECHAT: 'wechat',
    MESSAGE_QUEUE: 'message_queue',
    SCHEDULE_LATER: 'schedule_later',
    LEAVE_MESSAGE: 'leave_message'
});

/** 邀请排队状态 */
export const INVITATION_STATUS = Object.freeze({
    QUEUED: 'queued',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RESPONDED: 'responded'
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 判定角色此刻的在场与可用性状态
 */
export function evaluateCharacterPresence(charId, context = {}, now = Date.now()) {
    const characterId = safeStr(charId);
    if (!characterId) {
        return Object.freeze({
            characterId: '',
            state: PRESENCE_STATES.UNKNOWN,
            activity: null,
            expectedAvailableAt: null,
            recommendedChannels: Object.freeze([CONTACT_CHANNELS.LEAVE_MESSAGE]),
            reason: 'missing-character-id'
        });
    }

    const activity = context.currentActivity && typeof context.currentActivity === 'object' ? context.currentActivity : null;
    const schedule = Array.isArray(context.schedule) ? context.schedule : [];

    // 1. 若当前有正在进行的活动
    if (activity) {
        const start = safeNum(activity.startTime, 0);
        const end = safeNum(activity.endTime, Infinity);
        if (now >= start && now < end) {
            return Object.freeze({
                characterId,
                state: PRESENCE_STATES.BUSY_LATER,
                activity: Object.freeze({
                    title: safeStr(activity.title) || '正在进行事务',
                    location: safeStr(activity.location),
                    startTime: start,
                    endTime: end
                }),
                expectedAvailableAt: end,
                recommendedChannels: Object.freeze([CONTACT_CHANNELS.MESSAGE_QUEUE, CONTACT_CHANNELS.SCHEDULE_LATER]),
                reason: 'busy-in-activity'
            });
        }
    }

    // 2. 若在日历日程中有当前冲突时段
    const ongoingEvent = schedule.find(ev => {
        const s = safeNum(ev.startTime, 0);
        const e = safeNum(ev.endTime, 0);
        return now >= s && now < e;
    });

    if (ongoingEvent) {
        return Object.freeze({
            characterId,
            state: PRESENCE_STATES.BUSY_LATER,
            activity: Object.freeze({
                title: safeStr(ongoingEvent.title) || '日程占用',
                location: safeStr(ongoingEvent.location),
                startTime: ongoingEvent.startTime,
                endTime: ongoingEvent.endTime
            }),
            expectedAvailableAt: ongoingEvent.endTime,
            recommendedChannels: Object.freeze([CONTACT_CHANNELS.MESSAGE_QUEUE, CONTACT_CHANNELS.SCHEDULE_LATER]),
            reason: 'busy-in-schedule'
        });
    }

    // 3. 检查是否有已知在线/在场记录
    if (context.hasLocationRecord || context.lastSeenRecent) {
        return Object.freeze({
            characterId,
            state: PRESENCE_STATES.AVAILABLE_NOW,
            activity: null,
            expectedAvailableAt: now,
            recommendedChannels: Object.freeze([CONTACT_CHANNELS.WECHAT, CONTACT_CHANNELS.CALL]),
            reason: 'idle-and-available'
        });
    }

    // 4. 数据缺失或无记录 -> UNKNOWN
    return Object.freeze({
        characterId,
        state: PRESENCE_STATES.UNKNOWN,
        activity: null,
        expectedAvailableAt: null,
        recommendedChannels: Object.freeze([CONTACT_CHANNELS.LEAVE_MESSAGE]),
        reason: 'no-context-data'
    });
}

/**
 * 提交排队邀请（当角色忙碌时暂存，等待可用后接回）
 */
export function queueInvitation(queue = [], draft = {}, now = Date.now()) {
    const list = Array.isArray(queue) ? [...queue] : [];
    const id = safeStr(draft.id) || ('inv_' + now + '_' + Math.random().toString(36).slice(2, 7));
    const characterId = safeStr(draft.characterId);
    const topic = safeStr(draft.topic) || '未命名议题';
    const preferredChannel = safeStr(draft.preferredChannel) || CONTACT_CHANNELS.WECHAT;

    const item = Object.freeze({
        id,
        characterId,
        topic,
        payload: draft.payload && typeof draft.payload === 'object' ? Object.freeze({ ...draft.payload }) : null,
        preferredChannel,
        status: INVITATION_STATUS.QUEUED,
        queuedAt: now,
        updatedAt: now
    });

    list.push(item);
    return Object.freeze(list);
}

/**
 * 撤回排队邀请
 * 契约：诚实标记 CANCELLED，不伪造对方已读
 */
export function cancelInvitation(queue = [], invitationId = '', reason = '', now = Date.now()) {
    const list = Array.isArray(queue) ? queue : [];
    const targetId = safeStr(invitationId);
    let found = false;

    const nextList = list.map(item => {
        if (item.id !== targetId) return item;
        found = true;
        return Object.freeze({
            ...item,
            status: INVITATION_STATUS.CANCELLED,
            cancelReason: safeStr(reason) || '用户主动撤回',
            updatedAt: now
        });
    });

    return {
        ok: found,
        why: found ? '' : 'invitation-not-found',
        queue: Object.freeze(nextList)
    };
}

/**
 * 当角色恢复空闲时，接回原议题
 */
export function resolvePendingInvitations(queue = [], characterId = '', now = Date.now()) {
    const list = Array.isArray(queue) ? queue : [];
    const charId = safeStr(characterId);
    const delivered = [];

    const nextList = list.map(item => {
        if (item.characterId === charId && item.status === INVITATION_STATUS.QUEUED) {
            const up = Object.freeze({
                ...item,
                status: INVITATION_STATUS.DELIVERED,
                deliveredAt: now,
                updatedAt: now
            });
            delivered.push(up);
            return up;
        }
        return item;
    });

    return {
        delivered: Object.freeze(delivered),
        queue: Object.freeze(nextList)
    };
}

/**
 * 自检函数
 */
export function characterPresenceSelfCheck() {
    const problems = [];
    if (Object.keys(PRESENCE_STATES).length !== 3) problems.push('PRESENCE_STATES 必须恰好为 3 态');
    if (Object.keys(INVITATION_STATUS).length !== 4) problems.push('INVITATION_STATUS 必须恰好为 4 态');
    return { problems };
}