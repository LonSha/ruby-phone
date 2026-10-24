/* ========================================================
 * config/co-built-world.js — [R8-X9 · 第八期规划] 双人共建的手机世界（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   角色不再只是被动联系人，他们会主动对手机世界提出环境形态与陈设建议：
 *     ① 结构化形态提案：proposeTheme / proposeRule / proposeDwelling / proposeMedia；
 *     ② 显式四态裁决：proposed（提出）/ accepted（采纳）/ rejected（驳回）/ modified（修润采纳）；
 *     ③ 共同历史演变纪要：保留由谁提出、由谁批准、为何采纳的连续脉络；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */

export const STORAGE_KEY = 'cbw_co_built_world_v1';

export const WORLD_PROPOSAL_STATUS = Object.freeze({
    PROPOSED: 'proposed',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    MODIFIED: 'modified'
});

export const DEFAULT_CO_BUILT_WORLD_STATE = Object.freeze({
    proposals: {}, // id -> worldProposal
    chronicle: [], // [{ proposalId, proposer, summary, decision, timestamp }]
    updatedAt: 0
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }

export function normalizeCoBuiltWorldState(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CO_BUILT_WORLD_STATE };
    return {
        proposals: (raw.proposals && typeof raw.proposals === 'object') ? { ...raw.proposals } : {},
        chronicle: Array.isArray(raw.chronicle) ? [...raw.chronicle] : [],
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 角色主动提出形态建议
 */
export function proposeWorldChange(state, proposalSpec, now = Date.now()) {
    const s = normalizeCoBuiltWorldState(state);
    const spec = (proposalSpec && typeof proposalSpec === 'object') ? proposalSpec : {};
    const id = safeStr(spec.id) || `wprop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const proposer = safeStr(spec.proposer);
    const summary = safeStr(spec.summary);

    if (!proposer || !summary) {
        return { success: false, reason: 'proposer-and-summary-required', state: s };
    }

    const proposal = {
        id,
        proposer,
        category: safeStr(spec.category) || 'theme', // theme | rule | dwelling | app
        summary,
        suggestedPayload: (spec.suggestedPayload && typeof spec.suggestedPayload === 'object') ? { ...spec.suggestedPayload } : {},
        status: WORLD_PROPOSAL_STATUS.PROPOSED,
        userFeedback: '',
        createdAt: now,
        updatedAt: now
    };

    return {
        success: true,
        proposal,
        state: {
            ...s,
            proposals: { ...s.proposals, [id]: proposal },
            updatedAt: now
        }
    };
}

/**
 * 用户裁决角色的建议
 */
export function adjudicateWorldProposal(state, proposalId, decision, userFeedback = '', now = Date.now()) {
    const s = normalizeCoBuiltWorldState(state);
    const pId = safeStr(proposalId);
    const prop = s.proposals[pId];

    if (!prop) {
        return { success: false, reason: 'proposal-not-found', state: s };
    }

    const validDecision = Object.values(WORLD_PROPOSAL_STATUS).includes(decision)
        ? decision
        : WORLD_PROPOSAL_STATUS.REJECTED;

    const updatedProposal = {
        ...prop,
        status: validDecision,
        userFeedback: safeStr(userFeedback),
        adjudicatedAt: now,
        updatedAt: now
    };

    const chronicleEntry = {
        proposalId: pId,
        proposer: prop.proposer,
        summary: prop.summary,
        decision: validDecision,
        userFeedback: safeStr(userFeedback),
        timestamp: now
    };

    return {
        success: true,
        proposal: updatedProposal,
        state: {
            ...s,
            proposals: { ...s.proposals, [pId]: updatedProposal },
            chronicle: [...s.chronicle, chronicleEntry],
            updatedAt: now
        }
    };
}

/**
 * 获取共同世界的演进纪要
 */
export function getCoBuiltWorldChronicle(state) {
    const s = normalizeCoBuiltWorldState(state);
    return {
        totalProposals: Object.keys(s.proposals).length,
        acceptedCount: Object.values(s.proposals).filter(p => p.status === WORLD_PROPOSAL_STATUS.ACCEPTED || p.status === WORLD_PROPOSAL_STATUS.MODIFIED).length,
        history: s.chronicle.slice(-20)
    };
}