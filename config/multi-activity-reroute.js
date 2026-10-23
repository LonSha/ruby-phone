/**
 * config/multi-activity-reroute.js — [v4.51.0 · R6-O4] 能改道的多人活动契约内核
 * 
 * 【设计职责】
 * 解决“多人活动中途遭遇变化（迟到、场所不可用、成员退出）时只能从头建活动、费用重复扣款、未到场者被伪造亲历”的缺陷：
 * 1. 活动分段流水线（segments）：可替换、可重排、可跳过；
 * 2. 参与者状态追踪（participants）：arrived / delayed / withdrawn，严禁把未到场者写成亲历；
 * 3. 经费与已支付保护（budget & cost）：已支付或已完成段不重复扣款，只根据改道调整剩余预算；
 * 4. 局部改道协商（proposeActivityReroute & confirm）：改期、换地点、调换段序需参与者确认；
 * 5. 共同经历沉淀与精确分账（settleActivity）：分账只由实际亲历者分摊，缺席者不分摊未参与段的专属支出。
 * 
 * 零宿主依赖、零 DOM、纯函数、状态受控克隆，全面冻结导出。
 */
import { numOrNull } from './num-gate.js';

export const MAR_SEGMENT_STATES = Object.freeze({
    PLANNED: 'planned',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    SKIPPED: 'skipped',
    REROUTED: 'rerouted',
});

export const MAR_PARTICIPANT_STATES = Object.freeze({
    CONFIRMED: 'confirmed',
    ARRIVED: 'arrived',
    DELAYED: 'delayed',
    WITHDRAWN: 'withdrawn',
});

export const MAR_STORAGE_KEY = 'multi_activity_reroute_v1';

function normStr(v) {
    return String(v ?? '').trim();
}


/**
 * 创建或标准化多人活动结构
 */
export function createMultiActivity(raw = {}) {
    const id = normStr(raw.id) || `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = normStr(raw.title) || '未命名多人活动';
    const organizer = normStr(raw.organizer) || 'user';

    const participants = (Array.isArray(raw.participants) ? raw.participants : []).map(normParticipant).filter(Boolean);
    const segments = (Array.isArray(raw.segments) ? raw.segments : []).map(normSegment).filter(Boolean);
    const budgetInitial = (numOrNull(raw.budget?.initial) ?? 500);
    const budgetSpent = (numOrNull(raw.budget?.spent) ?? 0);

    return {
        version: 1,
        id,
        title,
        organizer,
        status: ['planned', 'active', 'settled', 'cancelled'].includes(raw.status) ? raw.status : 'planned',
        participants,
        segments,
        budget: {
            initial: budgetInitial,
            spent: budgetSpent,
            remaining: Math.max(0, budgetInitial - budgetSpent),
        },
        activeSegmentId: normStr(raw.activeSegmentId) || (segments.length > 0 ? segments[0].id : null),
        pendingProposals: (Array.isArray(raw.pendingProposals) ? raw.pendingProposals : []).map(normProposal).filter(Boolean),
        rerouteHistory: (Array.isArray(raw.rerouteHistory) ? raw.rerouteHistory : []).slice(0, 20),
        settlement: raw.settlement ? { ...raw.settlement } : null,
        updatedAt: (numOrNull(raw.updatedAt) ?? Date.now()),
    };
}

function normParticipant(p) {
    if (!p) return null;
    const actor = typeof p === 'string' ? normStr(p) : normStr(p.actor || p.id);
    if (!actor) return null;
    const status = (typeof p === 'object' && Object.values(MAR_PARTICIPANT_STATES).includes(p.status))
        ? p.status
        : MAR_PARTICIPANT_STATES.CONFIRMED;
    return {
        actor,
        status,
        delayMinutes: (numOrNull(p.delayMinutes) ?? 0),
        arrivalTime: p.arrivalTime ? normStr(p.arrivalTime) : null,
        withdrawnReason: p.withdrawnReason ? normStr(p.withdrawnReason) : null,
    };
}

function normSegment(s) {
    if (!s || typeof s !== 'object') return null;
    const id = normStr(s.id) || `seg_${Math.random().toString(36).slice(2, 7)}`;
    return {
        id,
        name: normStr(s.name) || id,
        type: normStr(s.type || 'activity'), // 'dining', 'sightseeing', 'travel', 'discussion'
        location: normStr(s.location || '待定地点'),
        plannedCost: (numOrNull(s.plannedCost) ?? 0),
        actualCost: (numOrNull(s.actualCost) ?? 0),
        isPaid: !!s.isPaid,
        status: Object.values(MAR_SEGMENT_STATES).includes(s.status) ? s.status : MAR_SEGMENT_STATES.PLANNED,
        attendeeActors: Array.isArray(s.attendeeActors) ? s.attendeeActors.map(normStr).filter(Boolean) : [],
    };
}

function normProposal(p) {
    if (!p || typeof p !== 'object') return null;
    const proposalId = normStr(p.proposalId || p.id) || `prop_${Math.random().toString(36).slice(2, 7)}`;
    return {
        proposalId,
        type: ['delay_adjustment', 'location_switch', 'segment_reorder', 'scope_reduction'].includes(p.type) ? p.type : 'location_switch',
        reason: normStr(p.reason),
        description: normStr(p.description),
        proposedSegments: Array.isArray(p.proposedSegments) ? p.proposedSegments.map(normSegment).filter(Boolean) : [],
        costDelta: (numOrNull(p.costDelta) ?? 0),
        confirmedActors: Array.isArray(p.confirmedActors) ? p.confirmedActors.map(normStr) : [],
        requiredConfirmers: Array.isArray(p.requiredConfirmers) ? p.requiredConfirmers.map(normStr) : [],
    };
}

/**
 * 报告成员迟到
 * 保留已到场人员的事实，不影响已到场者
 */
export function reportParticipantDelay(activity, actor, delayMinutes = 15, note = '') {
    const act = createMultiActivity(activity);
    const target = act.participants.find(p => p.actor === actor);
    if (!target) return { ok: false, reason: 'participant_not_found' };

    target.status = MAR_PARTICIPANT_STATES.DELAYED;
    target.delayMinutes = (numOrNull(delayMinutes) ?? 15);

    act.updatedAt = Date.now();
    return { ok: true, activity: act, participant: target };
}

/**
 * 标记成员到场
 */
export function markParticipantArrived(activity, actor, arrivalTime = '当前') {
    const act = createMultiActivity(activity);
    const target = act.participants.find(p => p.actor === actor);
    if (!target) return { ok: false, reason: 'participant_not_found' };

    target.status = MAR_PARTICIPANT_STATES.ARRIVED;
    target.arrivalTime = normStr(arrivalTime);
    act.updatedAt = Date.now();
    return { ok: true, activity: act, participant: target };
}

/**
 * 报告成员退出活动
 * 移出后续未开始段的应到名单，防止未到场者被虚构为亲历
 */
export function reportParticipantWithdraw(activity, actor, reason = '临时有急事') {
    const act = createMultiActivity(activity);
    const target = act.participants.find(p => p.actor === actor);
    if (!target) return { ok: false, reason: 'participant_not_found' };

    target.status = MAR_PARTICIPANT_STATES.WITHDRAWN;
    target.withdrawnReason = normStr(reason);

    // 从后续未完成段中移除
    for (const seg of act.segments) {
        if (seg.status === MAR_SEGMENT_STATES.PLANNED) {
            seg.attendeeActors = seg.attendeeActors.filter(a => a !== actor);
        }
    }

    act.updatedAt = Date.now();
    return { ok: true, activity: act, participant: target };
}

/**
 * 开始某个活动段
 */
export function startSegment(activity, segmentId) {
    const act = createMultiActivity(activity);
    const seg = act.segments.find(s => s.id === segmentId);
    if (!seg) return { ok: false, reason: 'segment_not_found' };

    seg.status = MAR_SEGMENT_STATES.IN_PROGRESS;
    act.activeSegmentId = seg.id;
    act.updatedAt = Date.now();
    return { ok: true, activity: act, segment: seg };
}

/**
 * 完成某个活动段，记录真实到场亲历者与实际支出
 */
export function completeSegment(activity, segmentId, actualAttendeeActors = [], actualCost = null) {
    const act = createMultiActivity(activity);
    const seg = act.segments.find(s => s.id === segmentId);
    if (!seg) return { ok: false, reason: 'segment_not_found' };

    seg.status = MAR_SEGMENT_STATES.COMPLETED;
    seg.attendeeActors = actualAttendeeActors.length > 0 ? actualAttendeeActors.map(normStr) : seg.attendeeActors;
    if (actualCost != null) {
        seg.actualCost = (numOrNull(actualCost) ?? seg.plannedCost);
    } else {
        seg.actualCost = seg.plannedCost;
    }
    seg.isPaid = true;

    // 重新统计已花费
    act.budget.spent = act.segments
        .filter(s => s.status === MAR_SEGMENT_STATES.COMPLETED)
        .reduce((sum, s) => sum + s.actualCost, 0);
    act.budget.remaining = Math.max(0, act.budget.initial - act.budget.spent);

    act.updatedAt = Date.now();
    return { ok: true, activity: act, segment: seg };
}

/**
 * 提出活动改道提议（例如成员迟到、场地不可用导致调换顺序或改地点）
 * 核心保护：
 * 已完成段绝对保留；
 * 已支付的费用不重扣，只评估新安排对未支出预算的影响。
 */
export function proposeActivityReroute(activity, proposalPayload) {
    const act = createMultiActivity(activity);
    const prop = normProposal(proposalPayload);
    if (!prop) return { ok: false, reason: 'invalid_proposal' };

    // 默认需要所有已到场和在场人员确认
    if (prop.requiredConfirmers.length === 0) {
        prop.requiredConfirmers = act.participants
            .filter(p => p.status !== MAR_PARTICIPANT_STATES.WITHDRAWN)
            .map(p => p.actor);
    }

    act.pendingProposals.push(prop);
    act.updatedAt = Date.now();
    return { ok: true, activity: act, proposal: prop };
}

/**
 * 确认改道提议
 */
export function confirmActivityReroute(activity, proposalId, actor) {
    const act = createMultiActivity(activity);
    const prop = act.pendingProposals.find(p => p.proposalId === proposalId);
    if (!prop) return { ok: false, reason: 'proposal_not_found' };

    const a = normStr(actor);
    if (!prop.confirmedActors.includes(a)) {
        prop.confirmedActors.push(a);
    }

    act.updatedAt = Date.now();
    return { ok: true, activity: act, proposal: prop };
}

/**
 * 应用生效改道方案
 * 1. 保留已完成段的支出和亲历事实；
 * 2. 将未执行段替换为提议的新段；
 * 3. 不重扣已支付费用。
 */
export function applyActivityReroute(activity, proposalId) {
    const act = createMultiActivity(activity);
    const propIdx = act.pendingProposals.findIndex(p => p.proposalId === proposalId);
    if (propIdx < 0) return { ok: false, reason: 'proposal_not_found' };

    const prop = act.pendingProposals[propIdx];

    // 保留已完成和正在进行的段
    const keptSegments = act.segments.filter(s =>
        s.status === MAR_SEGMENT_STATES.COMPLETED || s.status === MAR_SEGMENT_STATES.IN_PROGRESS
    );

    // 将替换段追加到已完成段之后
    const newSegments = prop.proposedSegments.map(s => ({
        ...s,
        status: MAR_SEGMENT_STATES.PLANNED,
    }));

    act.segments = [...keptSegments, ...newSegments];
    act.pendingProposals.splice(propIdx, 1);

    act.rerouteHistory.push({
        timestamp: Date.now(),
        reason: prop.reason,
        description: prop.description,
        appliedSegmentsCount: act.segments.length,
    });

    act.updatedAt = Date.now();
    return { ok: true, activity: act, rerouteRecord: act.rerouteHistory[act.rerouteHistory.length - 1] };
}

/**
 * 结算分账与共同经历生成
 * 规则：
 * 1. 只有亲身参与该段（attendeeActors）的人才承担该段费用；
 * 2. 迟到或提前退出者，不分摊缺席段的专属支出；
 * 3. 产出最终共同经历摘要与每人分账单。
 */
export function settleActivity(activity, options = {}) {
    const act = createMultiActivity(activity);

    const completedSegments = act.segments.filter(s => s.status === MAR_SEGMENT_STATES.COMPLETED);
    const totalSpent = completedSegments.reduce((sum, s) => sum + s.actualCost, 0);

    const perPersonDebt = {};
    for (const p of act.participants) {
        perPersonDebt[p.actor] = 0;
    }

    // 逐段按实际到场亲历者分摊
    for (const seg of completedSegments) {
        const attendees = seg.attendeeActors.filter(a => act.participants.some(p => p.actor === a));
        if (attendees.length > 0) {
            const costPerAttendee = seg.actualCost / attendees.length;
            for (const a of attendees) {
                perPersonDebt[a] = (perPersonDebt[a] || 0) + costPerAttendee;
            }
        }
    }

    // 共同经历生成：记录实际到场的人所经历的全部段落
    const experienceHighlights = completedSegments.map(seg => {
        return `【${seg.name}】（地点：${seg.location}，亲历者：${seg.attendeeActors.join('、')}）`;
    });

    const settlementResult = {
        isSettled: true,
        settledAt: Date.now(),
        totalSpent,
        perPersonDebt,
        experienceSummary: `本次「${act.title}」共完成 ${completedSegments.length} 个环节，总支出 ${totalSpent} 元。\n经历串联：\n${experienceHighlights.join('\n')}`,
    };

    act.status = 'settled';
    act.settlement = settlementResult;
    act.updatedAt = Date.now();

    return { ok: true, activity: act, settlement: settlementResult };
}
