/* ========================================================
 * config/joint-media-studio.js — [R8-X5 · 第八期规划] 角色共同媒体台（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户和角色共同围绕主题制作可留存的节目（播客、杂志、歌单、图文志）：
 *     ① 四大媒体类型：podcast / magazine / playlist / photo_essay；
 *     ② 显式协作流：各角色的分工角色、提交提案、审稿意见与舍弃版本；
 *     ③ 发布版本与素材溯源：发布成品保留完整制作谱系；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */

export const MEDIA_PROJECT_TYPES = Object.freeze({
    PODCAST: 'podcast',
    MAGAZINE: 'magazine',
    PLAYLIST: 'playlist',
    PHOTO_ESSAY: 'photo_essay'
});

export const PROPOSAL_STATUS = Object.freeze({
    SUBMITTED: 'submitted',
    APPROVED: 'approved',
    REJECTED: 'rejected'
});

export const PROJECT_STATUS = Object.freeze({
    PLANNING: 'planning',
    IN_PRODUCTION: 'in_production',
    PUBLISHED: 'published'
});

export const STORAGE_KEY = 'jms_media_studio_v1';

export const DEFAULT_MEDIA_STUDIO_STATE = Object.freeze({
    projects: {}, // id -> mediaProject
    updatedAt: 0
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeMediaStudioState(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_MEDIA_STUDIO_STATE };
    return {
        projects: (raw.projects && typeof raw.projects === 'object') ? { ...raw.projects } : {},
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 发起共同媒体企划
 */
export function createMediaProject(state, projectSpec, now = Date.now()) {
    const s = normalizeMediaStudioState(state);
    const spec = (projectSpec && typeof projectSpec === 'object') ? projectSpec : {};
    const id = safeStr(spec.id) || `jmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = safeStr(spec.title);
    const type = Object.values(MEDIA_PROJECT_TYPES).includes(spec.type) ? spec.type : MEDIA_PROJECT_TYPES.PODCAST;

    if (!title) {
        return { success: false, reason: 'title-required', state: s };
    }

    const project = {
        id,
        title,
        type,
        status: PROJECT_STATUS.PLANNING,
        members: safeArr(spec.members), // ['user', 'char_alice']
        proposals: {}, // proposalId -> proposalObj
        publishedRelease: null,
        createdAt: now,
        updatedAt: now
    };

    return {
        success: true,
        project,
        state: {
            ...s,
            projects: { ...s.projects, [id]: project },
            updatedAt: now
        }
    };
}

/**
 * 成员提交稿件/素材提案
 */
export function submitMediaProposal(state, projectId, proposalSpec, now = Date.now()) {
    const s = normalizeMediaStudioState(state);
    const pId = safeStr(projectId);
    const proj = s.projects[pId];

    if (!proj) {
        return { success: false, reason: 'project-not-found', state: s };
    }
    if (proj.status === PROJECT_STATUS.PUBLISHED) {
        return { success: false, reason: 'project-already-published', state: s };
    }

    const spec = (proposalSpec && typeof proposalSpec === 'object') ? proposalSpec : {};
    const propId = safeStr(spec.id) || `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const author = safeStr(spec.author) || 'user';
    const content = safeStr(spec.content);

    if (!content) {
        return { success: false, reason: 'content-required', state: s };
    }

    const proposal = {
        id: propId,
        author,
        title: safeStr(spec.title) || '未命名片段',
        content,
        status: PROPOSAL_STATUS.SUBMITTED,
        reviewNotes: [],
        createdAt: now,
        updatedAt: now
    };

    const updatedProject = {
        ...proj,
        status: PROJECT_STATUS.IN_PRODUCTION,
        proposals: { ...proj.proposals, [propId]: proposal },
        updatedAt: now
    };

    return {
        success: true,
        proposal,
        state: {
            ...s,
            projects: { ...s.projects, [pId]: updatedProject },
            updatedAt: now
        }
    };
}

/**
 * 审阅提案（批准或驳回）
 */
export function reviewMediaProposal(state, projectId, proposalId, approved, reviewerNote = '', reviewer = 'user', now = Date.now()) {
    const s = normalizeMediaStudioState(state);
    const pId = safeStr(projectId);
    const propId = safeStr(proposalId);
    const proj = s.projects[pId];

    if (!proj || !proj.proposals[propId]) {
        return { success: false, reason: 'proposal-not-found', state: s };
    }

    const prop = proj.proposals[propId];
    const newStatus = approved ? PROPOSAL_STATUS.APPROVED : PROPOSAL_STATUS.REJECTED;

    const updatedProposal = {
        ...prop,
        status: newStatus,
        reviewNotes: [
            ...prop.reviewNotes,
            { reviewer: safeStr(reviewer), decision: newStatus, note: safeStr(reviewerNote), timestamp: now }
        ],
        updatedAt: now
    };

    const updatedProject = {
        ...proj,
        proposals: { ...proj.proposals, [propId]: updatedProposal },
        updatedAt: now
    };

    return {
        success: true,
        proposal: updatedProposal,
        state: {
            ...s,
            projects: { ...s.projects, [pId]: updatedProject },
            updatedAt: now
        }
    };
}

/**
 * 发布共同媒体成品，汇总所有已批准内容
 */
export function publishMediaProject(state, projectId, releaseNote = '', now = Date.now()) {
    const s = normalizeMediaStudioState(state);
    const pId = safeStr(projectId);
    const proj = s.projects[pId];

    if (!proj) {
        return { success: false, reason: 'project-not-found', state: s };
    }

    const approvedProposals = Object.values(proj.proposals).filter(p => p.status === PROPOSAL_STATUS.APPROVED);
    if (approvedProposals.length === 0) {
        return { success: false, reason: 'no-approved-proposals', state: s };
    }

    const release = {
        releaseId: `rel_${proj.id}_${now}`,
        releaseTitle: proj.title,
        note: safeStr(releaseNote),
        includedProposalIds: approvedProposals.map(p => p.id),
        publishedAt: now
    };

    const updatedProject = {
        ...proj,
        status: PROJECT_STATUS.PUBLISHED,
        publishedRelease: release,
        updatedAt: now
    };

    return {
        success: true,
        release,
        state: {
            ...s,
            projects: { ...s.projects, [pId]: updatedProject },
            updatedAt: now
        }
    };
}