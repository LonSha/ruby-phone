/* ============================================================
 * config/incident-workspace.js — [R9-O1 · 第九期规划]
 * 以“事情/事件”为中心的多应用协作工作台（纯函数内核与投影机）
 * ------------------------------------------------------------
 * 【治理缺口】
 *   旧手机端拥有 89 个独立 App，应用之间依靠 intent-relay 传递参数，
 *   但缺乏以“事件/任务/事情”为维度的全局投影。
 *   用户参与一次剧情活动（如「周末海滨约会」或「调查禁闭区秘密」）时，
 *   微信消息、日历待办、备忘录笔记、背包道具和行动栈回执散落在各处，
 *   退出或重开后只能逐个 App 寻找上下文。
 *
 * 【核心设计】
 *   ① 事情投影模型 (Incident Projection Model):
 *      - id: 事情唯一标识符 (例如 inc_seaside_date)
 *      - title: 事情主题标题
 *      - phase: 当前阶段 (planning / in_progress / blocked / awaiting_reply / resolved / archived)
 *      - primaryCharacterId: 关联核心角色
 *      - linkedRefs: 跨 App 引用集合 [{ app: 'wechat', type: 'message', refId: 'msg-1' }, ...]
 *      - blockers: 阻断原因清单
 *      - nextActions: 推荐执行的下一步交互
 *
 *   ② 状态机与不可逆保护:
 *      - 事情状态迁移保留审计历史
 *      - 允许挂起、推进或归档
 *      - 不强行覆盖应用内部私有数据，仅作为轻量只读聚合与调度指针
 * ============================================================ */

export const INCIDENT_PHASES = Object.freeze({
    PLANNING: 'planning',
    IN_PROGRESS: 'in_progress',
    BLOCKED: 'blocked',
    AWAITING_REPLY: 'awaiting_reply',
    RESOLVED: 'resolved',
    ARCHIVED: 'archived'
});

export function normalizeIncident(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.incidentId || '').trim();
    if (!id) return null;

    const phase = Object.values(INCIDENT_PHASES).includes(raw.phase) ? raw.phase : INCIDENT_PHASES.PLANNING;

    return {
        id,
        title: String(raw.title || '未命名事项').trim(),
        phase,
        primaryCharacterId: raw.primaryCharacterId ? String(raw.primaryCharacterId).trim() : null,
        linkedRefs: Array.isArray(raw.linkedRefs) ? raw.linkedRefs.slice() : [],
        blockers: Array.isArray(raw.blockers) ? raw.blockers.map(String) : [],
        nextActions: Array.isArray(raw.nextActions) ? raw.nextActions.slice() : [],
        history: Array.isArray(raw.history) ? raw.history.slice() : [],
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || Date.now()
    };
}

/**
 * 将跨 App 的散落引用聚合至特定事件
 */
export function attachAppRef(incidentInput, appRef) {
    const inc = normalizeIncident(incidentInput);
    if (!inc) return { ok: false, error: 'invalid-incident' };
    if (!appRef || !appRef.app || !appRef.refId) {
        return { ok: false, error: 'invalid-app-ref' };
    }

    // 幂等防重
    const exists = inc.linkedRefs.some(r => r.app === appRef.app && r.refId === appRef.refId);
    if (exists) {
        return { ok: true, mutated: false, incident: inc };
    }

    const updated = {
        ...inc,
        linkedRefs: [...inc.linkedRefs, {
            app: String(appRef.app).trim(),
            type: String(appRef.type || 'generic').trim(),
            refId: String(appRef.refId).trim(),
            preview: String(appRef.preview || '').trim(),
            attachedAt: Date.now()
        }],
        updatedAt: Date.now()
    };

    return { ok: true, mutated: true, incident: updated };
}

/**
 * 推进事项阶段并留痕
 */
export function advanceIncidentPhase(incidentInput, targetPhase, options = {}) {
    const inc = normalizeIncident(incidentInput);
    if (!inc) return { ok: false, error: 'invalid-incident' };

    if (!Object.values(INCIDENT_PHASES).includes(targetPhase)) {
        return { ok: false, error: 'invalid-target-phase' };
    }

    if (inc.phase === targetPhase) {
        return { ok: true, mutated: false, incident: inc };
    }

    const reason = String(options.reason || 'user-phase-transition').trim();
    const historyEntry = {
        from: inc.phase,
        to: targetPhase,
        reason,
        timestamp: Date.now()
    };

    const updated = {
        ...inc,
        phase: targetPhase,
        history: [...inc.history, historyEntry],
        blockers: targetPhase === INCIDENT_PHASES.BLOCKED ? (options.blockers || inc.blockers) : [],
        updatedAt: Date.now()
    };

    return { ok: true, mutated: true, previousPhase: inc.phase, incident: updated };
}

/**
 * 聚合提取事项待办清单
 */
export function compileWorkspaceDashboard(incidents) {
    const list = Array.isArray(incidents) ? incidents.map(normalizeIncident).filter(Boolean) : [];

    const active = [];
    const awaiting = [];
    const blocked = [];
    const completed = [];

    for (const inc of list) {
        switch (inc.phase) {
            case INCIDENT_PHASES.IN_PROGRESS:
            case INCIDENT_PHASES.PLANNING:
                active.push(inc);
                break;
            case INCIDENT_PHASES.AWAITING_REPLY:
                awaiting.push(inc);
                break;
            case INCIDENT_PHASES.BLOCKED:
                blocked.push(inc);
                break;
            case INCIDENT_PHASES.RESOLVED:
            case INCIDENT_PHASES.ARCHIVED:
                completed.push(inc);
                break;
        }
    }

    return {
        total: list.length,
        activeCount: active.length,
        awaitingCount: awaiting.length,
        blockedCount: blocked.length,
        completedCount: completed.length,
        active,
        awaiting,
        blocked,
        completed
    };
}