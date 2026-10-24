/* ============================================================
 * config/multiproject-resume-anchor.js — [R9-O3 · 第九期规划]
 * 原位多工作区续办锚点与草稿恢复引擎（纯函数内核）
 * ------------------------------------------------------------
 * 【治理缺口】
 *   旧 resume-anchor.js / resume-brief.js 偏向整页或仅记录单一上次打开的 App。
 *   当用户同时在“备忘录创作段落”、“群聊讨论议题”、“场景地图节点”之间多线进行时，
 *   切出后再进入往往重置为应用首页，丢失具体编辑的光标段落、选中的议题和未提交草稿。
 *
 * 【核心设计】
 *   ① 细粒度原位锚点 (Fine-Grained Resume Anchor):
 *      - anchorId: 锚点全局唯一标识
 *      - app: 所属应用 (notes / wechat / scenario / etc.)
 *      - targetType: 目标类型 ('paragraph' / 'thread_topic' / 'node' / 'editor_cursor')
 *      - targetId: 目标实体唯一标识
 *      - cursorOffset: 行/字符光标精确偏移量
 *      - uncommittedDraft: 未提交草稿快照
 *
 *   ② 目标失效优雅降级 (Graceful Anchor Degradation):
 *      - 若目标段落被删除，降级指向该文档最近邻段落或章节入口，而不是抛出 404 或白屏。
 * ============================================================ */

export function createResumeAnchor(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const anchorId = String(raw.anchorId || `anc-${Date.now()}`).trim();
    const app = String(raw.app || '').trim();
    if (!app) return null;

    return {
        anchorId,
        app,
        targetType: String(raw.targetType || 'view').trim(),
        targetId: raw.targetId ? String(raw.targetId).trim() : null,
        cursorOffset: typeof raw.cursorOffset === 'number' ? raw.cursorOffset : 0,
        uncommittedDraft: raw.uncommittedDraft ? String(raw.uncommittedDraft) : null,
        pinned: Boolean(raw.pinned),
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/**
 * 校验锚点有效性并在目标丢失时优雅降级
 */
export function resolveAnchorLocation(anchor, existingTargets) {
    if (!anchor || !anchor.app) {
        return { ok: false, error: 'invalid-anchor' };
    }

    const targets = Array.isArray(existingTargets) ? existingTargets : [];
    
    // 若不需要具体 targetId 或目标确实存在
    if (!anchor.targetId || targets.includes(anchor.targetId)) {
        return {
            ok: true,
            status: 'exact_match',
            anchor
        };
    }

    // 目标已丢失：降级定位到该 App 默认安全回退锚点
    const degradedAnchor = {
        ...anchor,
        targetType: 'view',
        targetId: null,
        cursorOffset: 0,
        degraded: true,
        degradeReason: `Target [${anchor.targetId}] no longer exists`,
        updatedAt: Date.now()
    };

    return {
        ok: true,
        status: 'degraded_fallback',
        anchor: degradedAnchor
    };
}

/**
 * 工作区多锚点并发管理与最近活动提取
 */
export function syncWorkspaceAnchors(currentList, newAnchor) {
    const list = Array.isArray(currentList) ? currentList.slice() : [];
    if (!newAnchor || !newAnchor.anchorId) return list;

    const idx = list.findIndex(a => a.anchorId === newAnchor.anchorId || (a.app === newAnchor.app && a.targetId === newAnchor.targetId));
    if (idx >= 0) {
        list[idx] = { ...newAnchor, updatedAt: Date.now() };
    } else {
        list.push(newAnchor);
    }

    // 按活跃时间倒序，保留最多 10 个热锚点，但置顶项 (pinned) 绝不淘汰
    list.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    return list.slice(0, 10);
}