/* ============================================================
 * config/joint-media-serial-studio.js — [R9-X5 · 第九期规划]
 * 角色共创节目与连载栏目制作管线（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   用户与角色围绕主题制作播客、特刊、专栏或剧场：
 *     - 维护共创生命周期阶段：
 *       'proposal' (提案) -> 'delegation' (分工) -> 'review' (审稿)
 *       -> 'revision' (返修) -> 'published' (发布)
 *     - 保留反对意见与返修争议记录 (review_dissent)
 *     - 成员退出或中途分歧不毁坏既往各期发布快照
 * ============================================================ */
export function processSerialIssueState(issue, action = {}) {
    if (!issue || (!issue.id && !issue.issueId)) return { success: false, reason: 'invalid_issue' };

    const issueId = issue.id || issue.issueId;
    const validStages = ['proposal', 'delegation', 'review', 'revision', 'published'];
    const currentStage = validStages.includes(issue.stage) ? issue.stage : 'proposal';
    const targetStage = action.targetStage;

    if (!validStages.includes(targetStage)) {
        return { success: false, reason: 'invalid_target_stage' };
    }

    const reviews = Array.isArray(issue.reviews) ? issue.reviews.slice() : [];
    if (action.reviewFeedback) {
        reviews.push({
            reviewerId: action.reviewerId || 'editor',
            isApproved: Boolean(action.isApproved),
            dissentNote: action.dissentNote || '',
            timestamp: Date.now()
        });
    }

    return {
        ...issue,
        success: true,
        issueId,
        id: issueId,
        previousStage: currentStage,
        stage: targetStage,
        reviews,
        updatedAt: Date.now()
    };
}