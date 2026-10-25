/* ========================================================
 * config/response-cadence.js — [R8-O4 · 第八期规划] 人物回应节奏内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决人物“在线/离线”过于二值化且无后续的问题。
 *   把“现在能不能联系”推进到“这段交流如何继续”：
 *     ① 节奏状态：immediate（即时）/ delayed_busy（忙碌延时）/ asynchronous（异步留言）/ night_quiet（夜间静音）/ traveling（旅途微弱）；
 *     ② 漏接回执与回拨上下文：携带原有 topic、未决问题与挂起证据；
 *     ③ 补救行动：语音留言、预约回电、改用文字、紧急拍一拍；
 *     ④ 会话隔离，不搞轮询或常驻后台心跳。
 * ======================================================== */
'use strict';

const RC_STORAGE_KEY = 'rc_cadence_state_v1';

export const CADENCE_STATES = Object.freeze({
    IMMEDIATE: 'immediate',         // 即时在线，秒回
    DELAYED_BUSY: 'delayed_busy',   // 正在处理手头要事，有延迟
    ASYNCHRONOUS: 'asynchronous',   // 习惯异步留言（如工作或闭关）
    NIGHT_QUIET: 'night_quiet',     // 夜间/休息时间，静音防打扰
    TRAVELING: 'traveling'          // 在外移动/信号不稳定
});

export const CADENCE_REMEDIES = Object.freeze({
    LEAVE_VOICEMAIL: 'leave_voicemail', // 留下语音/文字详细留言
    SCHEDULE_CALLBACK: 'schedule_callback', // 预约约定回电时间
    SWITCH_CHANNEL: 'switch_channel',   // 切换到异步轻消息
    URGENT_PING: 'urgent_ping'          // 标记紧急拍一拍
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

/**
 * 规格化节奏状态
 */
export function normalizeCadenceState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            overrides: {},
            missedContexts: {},
            updatedAt: Date.now()
        };
    }
    return {
        overrides: (raw.overrides && typeof raw.overrides === 'object') ? { ...raw.overrides } : {},
        missedContexts: (raw.missedContexts && typeof raw.missedContexts === 'object') ? { ...raw.missedContexts } : {},
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 评估角色当前的回应节奏与建议动作
 */
export function evaluateCadence(characterId, characterMeta = {}, context = {}) {
    const cid = safeStr(characterId) || 'unknown';
    // 若有显式手工覆盖
    const explicitOverride = safeStr(context.overrideCadence);
    if (Object.values(CADENCE_STATES).includes(explicitOverride)) {
        return buildCadenceResult(cid, explicitOverride, 'explicit-override', context);
    }

    // 检查时间环境（夜间 23:00 - 07:00 默认静音）
    const hour = typeof context.currentHour === 'number' ? context.currentHour : new Date().getHours();
    if (hour >= 23 || hour < 7) {
        return buildCadenceResult(cid, CADENCE_STATES.NIGHT_QUIET, 'night-hours', context);
    }

    // 检查角色忙碌标记或日程标签
    const busyTag = safeStr(characterMeta.statusTag);
    if (busyTag === 'busy' || busyTag === 'in_meeting' || busyTag === 'focused') {
        return buildCadenceResult(cid, CADENCE_STATES.DELAYED_BUSY, 'character-busy-tag', context);
    }
    if (busyTag === 'on_trip' || busyTag === 'flight') {
        return buildCadenceResult(cid, CADENCE_STATES.TRAVELING, 'character-travel-tag', context);
    }

    return buildCadenceResult(cid, CADENCE_STATES.IMMEDIATE, 'default-available', context);
}

function buildCadenceResult(characterId, state, reason, context) {
    let estimatedWaitMinutes = 0;
    let remedyList = [];
    let notice = '';

    switch (state) {
        case CADENCE_STATES.IMMEDIATE:
            estimatedWaitMinutes = 1;
            notice = '对方当前方便，可即时交流';
            remedyList = [];
            break;
        case CADENCE_STATES.DELAYED_BUSY:
            estimatedWaitMinutes = 30;
            notice = '对方正专注手头事务，预计将在30分钟内查看消息';
            remedyList = [CADENCE_REMEDIES.LEAVE_VOICEMAIL, CADENCE_REMEDIES.SCHEDULE_CALLBACK];
            break;
        case CADENCE_STATES.NIGHT_QUIET:
            estimatedWaitMinutes = 480;
            notice = '当前为休息静音时段，消息已妥善投递，将在明晨提醒对方';
            remedyList = [CADENCE_REMEDIES.LEAVE_VOICEMAIL, CADENCE_REMEDIES.URGENT_PING];
            break;
        case CADENCE_STATES.TRAVELING:
            estimatedWaitMinutes = 120;
            notice = '对方正在途中或网络受限，建议留下完整事项';
            remedyList = [CADENCE_REMEDIES.LEAVE_VOICEMAIL, CADENCE_REMEDIES.SWITCH_CHANNEL];
            break;
        case CADENCE_STATES.ASYNCHRONOUS:
        default:
            estimatedWaitMinutes = 60;
            notice = '对方习惯批次阅读并异步回复';
            remedyList = [CADENCE_REMEDIES.LEAVE_VOICEMAIL];
            break;
    }

    return {
        characterId,
        cadenceState: state,
        reason,
        estimatedWaitMinutes,
        notice,
        recommendedRemedies: remedyList,
        evaluatedAt: Date.now()
    };
}

/**
 * 创建漏接/未接通的上下文包裹
 */
export function createMissedPacket(state, spec) {
    const s = normalizeCadenceState(state);
    if (!spec || typeof spec !== 'object') {
        return { success: false, reason: 'invalid-spec', state: s };
    }
    const characterId = safeStr(spec.characterId);
    if (!characterId) {
        return { success: false, reason: 'missing-character-id', state: s };
    }
    const id = safeStr(spec.id) || `miss_${characterId}_${Date.now()}`;
    const packet = {
        id,
        characterId,
        topic: safeStr(spec.topic) || '日常联络',
        lastMessageSnippet: safeStr(spec.lastMessageSnippet).slice(0, 150),
        missedAt: typeof spec.missedAt === 'number' ? spec.missedAt : Date.now(),
        urgency: ['normal', 'urgent'].includes(spec.urgency) ? spec.urgency : 'normal',
        consumed: false
    };

    return {
        success: true,
        packet,
        state: {
            ...s,
            missedContexts: {
                ...s.missedContexts,
                [id]: packet
            },
            updatedAt: Date.now()
        }
    };
}

/**
 * 当角色恢复接话时，接续漏接话题
 */
export function consumeMissedPacket(state, packetId) {
    const s = normalizeCadenceState(state);
    const pid = safeStr(packetId);
    const packet = s.missedContexts[pid];
    if (!packet) {
        return { success: false, reason: 'packet-not-found', state: s };
    }
    return {
        success: true,
        resumedTopic: packet.topic,
        snippet: packet.lastMessageSnippet,
        state: {
            ...s,
            missedContexts: {
                ...s.missedContexts,
                [pid]: { ...packet, consumed: true, consumedAt: Date.now() }
            },
            updatedAt: Date.now()
        }
    };
}