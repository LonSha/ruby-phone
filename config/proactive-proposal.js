/* ========================================================
 * config/proactive-proposal.js — [R7-O9 · 第七期规划] 可控主动体验内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户希望角色在关键节点有主动性（如特定时间联系、主动提议事件），
 *   但不希望系统越权无限后台生成、擅自扣费或产生刷屏骚扰。
 *   可控主动体验建立“可见、可控、限额、需确认的提议队列”：
 *     ① 提议透明队列(proposalQueue)：明确呈现触发原因(triggerReason)、成本预估(costEstimate)、
 *        有效期(expiresAt)与可执行动作(executableAction)；
 *     ② 幂等防重机制(triggerKey)：同一事件或相同上下文哈希绝不重复生成提议；
 *     ③ 用户主动控制权优先：支持暂停(pause)、合并(merge)、拒绝(reject)与预算限额(dailyBudgetLimit)；
 *     ④ 确定性执行边界：只有在用户明确确认(approve)后，方才释放不可逆的发送/生成指令；
 *     ⑤ 暂停彻底性：暂停期间阻断一切后台推演与提议入队，开关默认遵从用户偏好。
 * ======================================================== */

'use strict';

/** 主动提议类型 */
export const PROPOSAL_TYPES = Object.freeze({
    CHARACTER_MESSAGE: 'character_message', // 角色主动消息/邀约
    MEDIA_TASK: 'media_task',               // 媒体渲染/生图提议
    PLOT_CLOCK: 'plot_clock',               // 剧情时钟推进提醒
    SCHEDULE_ALERT: 'schedule_alert'        // 待办/日程主动关怀
});

/** 提议状态 */
export const PROPOSAL_STATUS = Object.freeze({
    QUEUED: 'queued',     // 排队待用户审阅
    APPROVED: 'approved', // 用户确认执行
    REJECTED: 'rejected', // 用户明确拒绝
    EXPIRED: 'expired',   // 超过有效期自动过期
    DROPPED_BUDGET: 'dropped_budget' // 因超出当日预算被丢弃
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

function clone(val) {
    return JSON.parse(JSON.stringify(val));
}

/**
 * 规范化单条提议项
 */
export function normalizeProposalItem(raw, idx = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const proposalId = safeStr(raw.proposalId || raw.id, `prop_${Date.now().toString(36)}_${idx}`);
    const triggerKey = safeStr(raw.triggerKey);
    if (!triggerKey) return null; // 必须有幂等 triggerKey

    const typeValues = Object.values(PROPOSAL_TYPES);
    const type = typeValues.includes(raw.type) ? raw.type : PROPOSAL_TYPES.CHARACTER_MESSAGE;

    const statusValues = Object.values(PROPOSAL_STATUS);
    const status = statusValues.includes(raw.status) ? raw.status : PROPOSAL_STATUS.QUEUED;

    const triggerReason = safeStr(raw.triggerReason, '剧情时钟触发主动关怀');
    const costEstimate = Math.max(0, safeNum(raw.costEstimate, 10)); // 估算 token 消耗
    const expiresAt = safeNum(raw.expiresAt, Date.now() + 86400000); // 默认 24h 有效期

    const executableAction = (raw.executableAction && typeof raw.executableAction === 'object')
        ? {
            channel: safeStr(raw.executableAction.channel, 'chat'),
            targetRole: safeStr(raw.executableAction.targetRole, 'system'),
            payload: safeStr(raw.executableAction.payload, '')
        }
        : { channel: 'chat', targetRole: 'system', payload: '' };

    return Object.freeze({
        proposalId,
        triggerKey,
        type,
        status,
        triggerReason,
        costEstimate,
        expiresAt,
        executableAction: Object.freeze(executableAction),
        createdAt: safeNum(raw.createdAt, Date.now()),
        approvedAt: safeNum(raw.approvedAt, 0),
        rejectedReason: safeStr(raw.rejectedReason, '')
    });
}

/**
 * 构造提议调度管理器状态
 */
export function createProactiveScheduler(options = {}) {
    return Object.freeze({
        isPaused: Boolean(options.isPaused), // 全局暂停开关
        dailyBudgetLimit: Math.max(0, safeNum(options.dailyBudgetLimit, 1000)), // 每日总额度
        usedCostToday: Math.max(0, safeNum(options.usedCostToday, 0)),
        queue: Object.freeze([]),
        executedHistory: Object.freeze([])
    });
}

/**
 * 尝试提交主动提议到队列
 * 遵从契约：
 * 1. 调度暂停时，拒绝任何新提议入队；
 * 2. 幂等去重：同一 triggerKey 无论在队列或已执行历史中，均不可重复提交；
 * 3. 预算超限判定：超出每日限额时标记 dropped_budget；
 * 4. 过期自动淘汰。
 */
export function submitProposal(scheduler, rawProposal, now = Date.now()) {
    if (!scheduler) return scheduler;
    const norm = normalizeProposalItem(rawProposal);
    if (!norm) return scheduler;

    // 1. 若已暂停，完全不接受新提议
    if (scheduler.isPaused) {
        return scheduler;
    }

    // 2. 幂等检查：triggerKey 查重
    const alreadyExists = scheduler.queue.some(p => p.triggerKey === norm.triggerKey) ||
        scheduler.executedHistory.some(h => h.triggerKey === norm.triggerKey);
    if (alreadyExists) {
        return scheduler; // 幂等跳过，不重复新增
    }

    // 3. 清理已过期提议并计算当前有效队列
    const activeQueue = [];
    for (const item of scheduler.queue) {
        if (item.expiresAt <= now && item.status === PROPOSAL_STATUS.QUEUED) {
            activeQueue.push(Object.freeze({ ...item, status: PROPOSAL_STATUS.EXPIRED }));
        } else {
            activeQueue.push(item);
        }
    }

    // 4. 预算检查
    let proposalToAdd = norm;
    if (scheduler.usedCostToday + norm.costEstimate > scheduler.dailyBudgetLimit) {
        proposalToAdd = Object.freeze({
            ...norm,
            status: PROPOSAL_STATUS.DROPPED_BUDGET,
            rejectedReason: '超出当日主动提议预算限额'
        });
    }

    return Object.freeze({
        ...scheduler,
        queue: Object.freeze([...activeQueue, proposalToAdd])
    });
}

/**
 * 用户确认提议（生成不可逆动作执行凭据）
 */
export function approveProposal(scheduler, proposalId, now = Date.now()) {
    if (!scheduler || !Array.isArray(scheduler.queue)) return scheduler;
    const targetId = safeStr(proposalId);
    const target = scheduler.queue.find(p => p.proposalId === targetId);
    if (!target || target.status !== PROPOSAL_STATUS.QUEUED) {
        return scheduler;
    }

    const approvedItem = Object.freeze({
        ...target,
        status: PROPOSAL_STATUS.APPROVED,
        approvedAt: now
    });

    const nextQueue = scheduler.queue.filter(p => p.proposalId !== targetId);
    const nextHistory = [...scheduler.executedHistory, approvedItem];

    return Object.freeze({
        ...scheduler,
        usedCostToday: scheduler.usedCostToday + approvedItem.costEstimate,
        queue: Object.freeze(nextQueue),
        executedHistory: Object.freeze(nextHistory)
    });
}

/**
 * 用户拒绝提议
 */
export function rejectProposal(scheduler, proposalId, reason = '') {
    if (!scheduler || !Array.isArray(scheduler.queue)) return scheduler;
    const targetId = safeStr(proposalId);
    const nextQueue = scheduler.queue.map(p => {
        if (p.proposalId !== targetId) return p;
        return Object.freeze({
            ...p,
            status: PROPOSAL_STATUS.REJECTED,
            rejectedReason: safeStr(reason, '用户主动拒绝该提议')
        });
    });

    return Object.freeze({
        ...scheduler,
        queue: Object.freeze(nextQueue)
    });
}

/**
 * 暂停主动调度
 */
export function pauseProactiveScheduler(scheduler) {
    if (!scheduler) return scheduler;
    return Object.freeze({
        ...scheduler,
        isPaused: true
    });
}

/**
 * 恢复主动调度
 */
export function resumeProactiveScheduler(scheduler) {
    if (!scheduler) return scheduler;
    return Object.freeze({
        ...scheduler,
        isPaused: false
    });
}

/**
 * 模块自检函数
 */
export function proactiveProposalSelfCheck() {
    const problems = [];
    if (Object.keys(PROPOSAL_TYPES).length !== 4) {
        problems.push('PROPOSAL_TYPES 必须恰好为 4 种');
    }
    if (Object.keys(PROPOSAL_STATUS).length !== 5) {
        problems.push('PROPOSAL_STATUS 必须恰好为 5 态');
    }

    // 单元自测流转
    let sched = createProactiveScheduler({ dailyBudgetLimit: 50 });

    const p1 = {
        proposalId: 'p_msg_1',
        triggerKey: 'clock_ch12_night',
        type: 'character_message',
        costEstimate: 20,
        triggerReason: '夜深了角色主动询问是否需要热茶'
    };

    // 1. 提交成功入队
    sched = submitProposal(sched, p1);
    if (sched.queue.length !== 1 || sched.queue[0].status !== PROPOSAL_STATUS.QUEUED) {
        problems.push('正常提议未成功入队为 queued 状态');
    }

    // 2. 幂等去重测试：相同 triggerKey 不得重复提交
    sched = submitProposal(sched, p1);
    if (sched.queue.length !== 1) {
        problems.push('相同 triggerKey 重复提交未被幂等拦截');
    }

    // 3. 用户确认测试
    sched = approveProposal(sched, 'p_msg_1');
    if (sched.queue.length !== 0 || sched.executedHistory.length !== 1) {
        problems.push('用户确认后提议应从队列移至 executedHistory');
    }
    if (sched.usedCostToday !== 20) {
        problems.push(`确认后成本应累加至 20，实得 ${sched.usedCostToday}`);
    }

    // 4. 预算超限测试：再加 40 超过 50 上限
    const p2 = {
        proposalId: 'p_media_1',
        triggerKey: 'scene_art_rain',
        type: 'media_task',
        costEstimate: 40
    };
    sched = submitProposal(sched, p2);
    const addedP2 = sched.queue.find(x => x.proposalId === 'p_media_1');
    if (addedP2?.status !== PROPOSAL_STATUS.DROPPED_BUDGET) {
        problems.push('超出预算的提议未被标为 dropped_budget');
    }

    // 5. 暂停测试：暂停后拒绝新提议
    sched = pauseProactiveScheduler(sched);
    const p3 = { proposalId: 'p3', triggerKey: 'k3', costEstimate: 5 };
    sched = submitProposal(sched, p3);
    if (sched.queue.some(x => x.proposalId === 'p3')) {
        problems.push('暂停状态下新提议不应被入队');
    }

    return { problems };
}