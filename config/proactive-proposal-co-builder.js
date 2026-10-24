/* ============================================================
 * config/proactive-proposal-co-builder.js — [R9-X9 · 第九期规划]
 * 角色主动提案塑造手机与共同世界裁决器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   角色主动提出手机主题、居所布置、栏目、公约或资产收藏提案：
 *     - 提案生命周期状态：
 *       'proposed' (角色发起) -> 'approved' (用户批准)
 *       -> 'modified' (用户修改后通过) -> 'rejected' (用户驳回)
 *     - 角色绝无权限私自静默改机或执行不可逆外部动作
 *     - 共同构建记录保存完整的提议人、裁决人和具体配置版本
 * ============================================================ */
export const PROPOSAL_STATUS = Object.freeze({
    PROPOSED: 'proposed',
    APPROVED: 'approved',
    MODIFIED: 'modified',
    REJECTED: 'rejected'
});

export function adjudicateCharacterProposal(proposal = {}, userVerdict = {}) {
    if (!proposal || !proposal.id) {
        return { success: false, reason: 'invalid_proposal' };
    }

    const action = userVerdict.verdict; // 'approve', 'modify', 'reject'
    let status = PROPOSAL_STATUS.REJECTED;
    let finalConfig = null;

    if (action === 'approve') {
        status = PROPOSAL_STATUS.APPROVED;
        finalConfig = proposal.suggestedConfig || {};
    } else if (action === 'modify') {
        status = PROPOSAL_STATUS.MODIFIED;
        finalConfig = userVerdict.modifiedConfig || proposal.suggestedConfig || {};
    }

    return {
        success: true,
        proposalId: proposal.id,
        proposerActorId: proposal.proposerActorId || 'character',
        status,
        finalConfig,
        userFeedback: String(userVerdict.note || '').trim(),
        ratifiedAt: Date.now()
    };
}