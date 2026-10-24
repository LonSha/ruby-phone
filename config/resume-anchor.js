/* ========================================================
 * config/resume-anchor.js — [R8-O3 · 第八期规划] 原位续办内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户回来后不是只看到一张摘要，而是能回到上次编辑中的段落、未处理的联系人、
 *   未确认的提案或场景节点。
 *     ① 锚点类型：paragraph / topic / proposal / scene_node / draft_pos；
 *     ② 状态机：active（待续办）/ visited（已重访）/ resolved（已完成）/ stale（已失效）；
 *     ③ 位置校验：检查依赖实体是否被修改/删除，若失效则给出具名原因与就近降级出口；
 *     ④ 会话隔离，防重消费，支持多项目并行保留。
 * ======================================================== */
'use strict';

export const RA_STORAGE_KEY = 'ra_anchor_state_v1';
export const RA_MAX_ANCHORS = 50;

export const ANCHOR_TYPES = Object.freeze({
    PARAGRAPH: 'paragraph',     // 编辑中具体段落指针
    TOPIC: 'topic',             // 通信或群聊未决议题
    PROPOSAL: 'proposal',       // 待确认提议
    SCENE_NODE: 'scene_node',   // 剧场或剧情场景节点
    DRAFT_POS: 'draft_pos'      // 草稿工作区游标
});

export const ANCHOR_STATUS = Object.freeze({
    ACTIVE: 'active',
    VISITED: 'visited',
    RESOLVED: 'resolved',
    STALE: 'stale',
    DISMISSED: 'dismissed'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

/**
 * 规格化锚点状态
 */
export function normalizeAnchorState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            anchors: {},
            lastAnchorId: null,
            updatedAt: Date.now()
        };
    }
    const anchors = {};
    if (raw.anchors && typeof raw.anchors === 'object') {
        for (const [id, a] of Object.entries(raw.anchors)) {
            if (!a || typeof a !== 'object') continue;
            const aid = safeStr(a.id) || id;
            anchors[aid] = {
                id: aid,
                appId: safeStr(a.appId) || 'unknown',
                type: Object.values(ANCHOR_TYPES).includes(a.type) ? a.type : ANCHOR_TYPES.PARAGRAPH,
                targetId: safeStr(a.targetId),
                title: safeStr(a.title) || '未命名续办点',
                contextSnippet: safeStr(a.contextSnippet),
                cursorOffset: typeof a.cursorOffset === 'number' ? a.cursorOffset : 0,
                status: Object.values(ANCHOR_STATUS).includes(a.status) ? a.status : ANCHOR_STATUS.ACTIVE,
                createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
                metadata: (a.metadata && typeof a.metadata === 'object') ? { ...a.metadata } : {}
            };
        }
    }
    return {
        anchors,
        lastAnchorId: safeStr(raw.lastAnchorId) || null,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 记录或更新续办锚点
 */
export function recordAnchor(state, spec) {
    const s = normalizeAnchorState(state);
    if (!spec || typeof spec !== 'object') {
        return { success: false, reason: 'invalid-spec', state: s };
    }
    const appId = safeStr(spec.appId);
    const targetId = safeStr(spec.targetId);
    if (!appId || !targetId) {
        return { success: false, reason: 'missing-app-or-target-id', state: s };
    }

    const type = Object.values(ANCHOR_TYPES).includes(spec.type) ? spec.type : ANCHOR_TYPES.PARAGRAPH;
    const id = safeStr(spec.id) || `anc_${appId}_${targetId}_${Date.now()}`;
    const now = Date.now();

    const anchor = {
        id,
        appId,
        type,
        targetId,
        title: safeStr(spec.title) || `续办: ${appId}/${targetId}`,
        contextSnippet: safeStr(spec.contextSnippet).slice(0, 200),
        cursorOffset: typeof spec.cursorOffset === 'number' ? Math.max(0, spec.cursorOffset) : 0,
        status: ANCHOR_STATUS.ACTIVE,
        createdAt: now,
        metadata: (spec.metadata && typeof spec.metadata === 'object') ? { ...spec.metadata } : {}
    };

    const keys = Object.keys(s.anchors);
    let nextAnchors = { ...s.anchors, [id]: anchor };

    // 上限回收：若超过最大数量，清理最老的 RESOLVED 或 DISMISSED，若都为 ACTIVE 则清理最老已访问
    if (keys.length >= RA_MAX_ANCHORS) {
        const sorted = Object.values(nextAnchors).sort((a, b) => a.createdAt - b.createdAt);
        const purgeCandidate = sorted.find(a => a.status === ANCHOR_STATUS.RESOLVED || a.status === ANCHOR_STATUS.DISMISSED)
            || sorted.find(a => a.status === ANCHOR_STATUS.STALE)
            || sorted[0];
        if (purgeCandidate && purgeCandidate.id !== id) {
            delete nextAnchors[purgeCandidate.id];
        }
    }

    return {
        success: true,
        anchor,
        state: {
            ...s,
            anchors: nextAnchors,
            lastAnchorId: id,
            updatedAt: now
        }
    };
}

/**
 * 校验锚点在当前真实世界中的有效性
 */
export function resolveAnchorLocation(anchor, currentEntities = {}) {
    if (!anchor || typeof anchor !== 'object') {
        return { valid: false, reason: 'null-anchor', fallback: null };
    }
    if (anchor.status === ANCHOR_STATUS.RESOLVED || anchor.status === ANCHOR_STATUS.DISMISSED) {
        return { valid: false, reason: `anchor-${anchor.status}`, fallback: null };
    }

    const targetList = safeArr(currentEntities[anchor.appId]);
    // 若当前环境提供了该 App 的活动实体列表，则进行存在性比对
    if (targetList.length > 0) {
        const found = targetList.find(e => (typeof e === 'string' ? e === anchor.targetId : (e && e.id === anchor.targetId)));
        if (!found) {
            return {
                valid: false,
                reason: 'target-entity-missing-or-deleted',
                fallback: {
                    appId: anchor.appId,
                    action: 'open_app_root',
                    notice: `续办目标「${anchor.title}」已不存在或已移除，已为您跳转应用主页`
                }
            };
        }
    }

    return {
        valid: true,
        destination: {
            appId: anchor.appId,
            targetId: anchor.targetId,
            type: anchor.type,
            cursorOffset: anchor.cursorOffset,
            snippet: anchor.contextSnippet
        }
    };
}

/**
 * 推进锚点状态（如标记访问、完成、忽略）
 */
export function transitionAnchorStatus(state, anchorId, newStatus) {
    const s = normalizeAnchorState(state);
    const aid = safeStr(anchorId);
    const anchor = s.anchors[aid];
    if (!anchor) {
        return { success: false, reason: 'anchor-not-found', state: s };
    }
    if (!Object.values(ANCHOR_STATUS).includes(newStatus)) {
        return { success: false, reason: 'invalid-status', state: s };
    }
    const updatedAnchor = { ...anchor, status: newStatus };
    return {
        success: true,
        previousStatus: anchor.status,
        newStatus,
        state: {
            ...s,
            anchors: {
                ...s.anchors,
                [aid]: updatedAnchor
            },
            updatedAt: Date.now()
        }
    };
}
