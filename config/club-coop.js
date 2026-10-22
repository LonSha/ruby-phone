/* ============================================================
 * config/club-coop.js — [v4.52.0 · 第六期 R6-X3]
 *   「社团共营：从一次群投票到共同完成长期事业」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X3）】
 *   「五人团队从提案到展览结束，至少两次分工变更；
 *    换负责人后待办交接但未授权私人消息不交接。」
 *
 * 【修前实测的缺口】
 *   本仓 `config/group-vote-contract.js`（v4.29.0）已实现群投票→活动确认，
 *   `config/group-vote-handoff.js`（v4.44.0）已实现投票→日历事项交接凭据。
 *   但投票只解决「选哪个方案」，交接只解决「票变成日历事项」——
 *   从「确认方案」到「展览结束」中间缺一层：
 *     · 投票确认后，谁负责什么？怎么分工？（缺角色分工与责任分配）
 *     · 中途有人退出/加入怎么办？（缺分工变更与接替）
 *     · 换负责人时，待办要交接，但**未授权的私人消息不交接**（缺权限边界）
 *   group-vote 解决「选方案」；club-coop 解决「从方案到完成之间的长期协作」。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不读时钟）】
 *   1 **createProject**：从投票确认结果创建长期协作项目，
 *      带 projectId / members / roles / phases / todos；
 *   2 **reassignDivision**：分工变更——角色退出/加入/换岗，
 *      记录变更历史，标明谁接替了谁；
 *   3 **handoverLeadership**：换负责人——待办列表按权限交接，
 *      未授权的私人消息**留在原负责人**不交接；
 *   4 **auditProjectClosure**：项目结束时审计——
 *      交代完了吗、未授权数据有没有泄漏、分工变更了几次。
 *
 * 【口径纪律】
 *   · 投票结果由调用方传入（不依赖 group-vote-contract 的实现细节）；
 *   · 「未授权」由调用方在 todo 上标 isPrivate: true，本模块不猜；
 *   · 分工变更有历史记录（divisionLog），不静默覆盖；
 *   · 私人消息的权限边界是结构性的：isPrivate=true 的 todo 不进交接列表。
 * ============================================================ */
'use strict';

export const CC_VERSION = '4.52.0';
export const PROJECT_PHASES = Object.freeze({
    proposal: Object.freeze({ label: '提案', order: 1 }),
    planning: Object.freeze({ label: '筹备', order: 2 }),
    'in-progress': Object.freeze({ label: '执行', order: 3 }),
    review: Object.freeze({ label: '审收', order: 4 }),
    closed: Object.freeze({ label: '结束', order: 5 }),
});
export const ROLE_KINDS = Object.freeze({
    leader: Object.freeze({ label: '负责人', note: '统筹与最终决定' }),
    coordinator: Object.freeze({ label: '协调员', note: '对接外部与进度跟踪' }),
    executor: Object.freeze({ label: '执行员', note: '具体事项落地' }),
    supporter: Object.freeze({ label: '支援员', note: '后勤与补位' }),
});
export const CC_LIMITS = Object.freeze({
    maxMembers: 12,
    maxTodos: 200,
    maxDivChanges: 50,
    textMax: 200,
});

function _s(x, max) {
    const t = (x === null || x === undefined) ? '' : String(x);
    return max ? t.slice(0, max) : t;
}

/* ───────── ① 创建长期协作项目 ───────── */
/**
 * @param {object} input
 *   · `projectId`   — 项目标识（由调用方给，如从投票 activityId 派生）
 *   · `title`       — 项目名
 *   · `members`     — [{actorId, role}]
 *   · `phases`      — 初始阶段列表（默认 ['proposal','planning','in-progress','review']）
 *   · `todos`       — 初始待办列表 [{id, title, assigneeId, isPrivate, phase}]
 *   · `at`          — 创建时点
 * @returns {{ projectId:string, title:string, phase:string, members:Array, todos:Array, divisionLog:Array, summary:string }}
 */
export function createProject(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const projectId = _s(o.projectId, 80).trim() || 'project-unknown';
    const title = _s(o.title, CC_LIMITS.textMax);
    const members = (Array.isArray(o.members) ? o.members : []).filter(m => m && typeof m === 'object').map(m => ({
        actorId: _s(m.actorId, 60),
        role: Object.prototype.hasOwnProperty.call(ROLE_KINDS, _s(m.role, 20).trim()) ? _s(m.role, 20).trim() : 'executor',
    })).filter(m => m.actorId);
    while (members.length > CC_LIMITS.maxMembers) members.pop();
    const todos = (Array.isArray(o.todos) ? o.todos : []).filter(t => t && typeof t === 'object').map(t => ({
        id: _s(t.id, 80) || ('todo-' + Math.random().toString(36).slice(2, 8)),
        title: _s(t.title, CC_LIMITS.textMax),
        assigneeId: _s(t.assigneeId, 60),
        isPrivate: t.isPrivate === true,
        phase: _s(t.phase, 20).trim() || 'planning',
        state: 'open',
    }));
    while (todos.length > CC_LIMITS.maxTodos) todos.pop();
    const phase = 'planning';
    const divisionLog = [{ at: (typeof o.at === 'number' ? o.at : 0), action: 'create', detail: '项目创建，初始分工' }];
    const summary = projectId + '（' + title + '）：' + members.length + ' 人 · ' + todos.length + ' 待办 · 阶段 ' + phase;
    return { projectId, title, phase, members, todos, divisionLog, summary };
}

/* ───────── ② 分工变更 ───────── */
/**
 * 角色退出/加入/换岗，记录变更历史。
 * @param {object} project createProject 的返回
 * @param {object} change { action:'join'|'leave'|'switch-role', actorId, newRole?, at }
 * @returns {{ updatedProject:object, changeRecord:object|null, reason:string }}
 */
export function reassignDivision(project, change = {}) {
    if (!project || !Array.isArray(project.members)) return { updatedProject: project, changeRecord: null, reason: '项目不在场' };
    const ch = (change && typeof change === 'object') ? change : {};
    const action = _s(ch.action, 20).trim();
    const actorId = _s(ch.actorId, 60);
    const at = (typeof ch.at === 'number') ? ch.at : 0;
    if (!actorId) return { updatedProject: project, changeRecord: null, reason: '缺角色' };

    if (action === 'join') {
        const role = Object.prototype.hasOwnProperty.call(ROLE_KINDS, _s(ch.newRole, 20).trim()) ? _s(ch.newRole, 20).trim() : 'executor';
        project.members.push({ actorId, role });
    } else if (action === 'leave') {
        /* 退出的角色名下待办标 orphaned（不自动转交，等人工分配或接替） */
        project.todos.forEach(t => { if (t.assigneeId === actorId && t.state === 'open') t.orphaned = true; });
        project.members = project.members.filter(m => m.actorId !== actorId);
    } else if (action === 'switch-role') {
        const newRole = Object.prototype.hasOwnProperty.call(ROLE_KINDS, _s(ch.newRole, 20).trim()) ? _s(ch.newRole, 20).trim() : null;
        if (newRole) {
            const m = project.members.find(m => m.actorId === actorId);
            if (m) m.role = newRole;
        }
    } else {
        return { updatedProject: project, changeRecord: null, reason: '变更动作认不出：' + action };
    }
    while (project.members.length > CC_LIMITS.maxMembers) project.members.pop();
    const record = { at, action, actorId, newRole: _s(ch.newRole, 20).trim() || null, detail: action + ' ' + actorId };
    if (!Array.isArray(project.divisionLog)) project.divisionLog = [];
    project.divisionLog.push(record);
    while (project.divisionLog.length > CC_LIMITS.maxDivChanges) project.divisionLog.shift();
    const reason = '分工变更：' + action + ' ' + actorId + ' · 变更累计 ' + project.divisionLog.length + ' 次';
    return { updatedProject: project, changeRecord: record, reason };
}

/* ───────── ③ 换负责人交接 ───────── */
/**
 * 换负责人时，待办按权限交接：
 *   - isPrivate=true 的待办**留在原负责人**，不交接；
 *   - isPrivate=false 的待办转给新负责人。
 * @param {object} project
 * @param {string} oldLeaderId 旧负责人
 * @param {string} newLeaderId 新负责人
 * @param {number} at 时点
 * @returns {{ handed:number, withheld:number, record:object, reason:string }}
 */
export function handoverLeadership(project, oldLeaderId, newLeaderId, at = 0) {
    if (!project || !Array.isArray(project.todos)) return { handed: 0, withheld: 0, record: null, reason: '项目不在场' };
    const oldId = _s(oldLeaderId, 60);
    const newId = _s(newLeaderId, 60);
    if (!oldId || !newId) return { handed: 0, withheld: 0, record: null, reason: '缺负责人标识' };
    let handed = 0, withheld = 0;
    for (const t of project.todos) {
        if (t.assigneeId !== oldId) continue;
        if (t.state !== 'open') continue;
        if (t.isPrivate === true) {
            /* 未授权的私人消息不交接 */
            withheld++;
        } else {
            t.assigneeId = newId;
            t.handedAt = at;
            handed++;
        }
    }
    /* 更新负责人角色 */
    const oldM = project.members.find(m => m.actorId === oldId);
    const newM = project.members.find(m => m.actorId === newId);
    if (oldM && oldM.role === 'leader') oldM.role = 'supporter';
    if (newM) newM.role = 'leader';
    if (!Array.isArray(project.divisionLog)) project.divisionLog = [];
    const record = { at, action: 'handover', actorId: oldId, newRole: newId, detail: '负责人 ' + oldId + ' → ' + newId + '（交接 ' + handed + ' / 保留 ' + withheld + '）' };
    project.divisionLog.push(record);
    while (project.divisionLog.length > CC_LIMITS.maxDivChanges) project.divisionLog.shift();
    const reason = '交接 ' + handed + ' 项 · 保留 ' + withheld + ' 项私人待办（未授权不交接）';
    return { handed, withheld, record, reason };
}

/* ───────── ④ 项目结束审计 ───────── */
/**
 * 项目结束时审计：交代完了吗、私人数据有没有泄漏、分工变更了几次。
 * @param {object} project
 * @returns {{ closed:boolean, openTodos:number, privateLeaks:Array, divChanges:number, summary:string }}
 */
export function auditProjectClosure(project) {
    if (!project || !Array.isArray(project.todos)) {
        return { closed: false, openTodos: 0, privateLeaks: [], divChanges: 0, summary: '项目不在场' };
    }
    const openTodos = project.todos.filter(t => t.state === 'open').length;
    /* 审计：私人待办的 assigneeId 不应是新负责人（交接不应传私人消息） */
    const privateLeaks = [];
    const leaders = project.members.filter(m => m.role === 'leader').map(m => m.actorId);
    for (const t of project.todos) {
        if (t.isPrivate === true && leaders.includes(t.assigneeId)) {
            /* 如果负责人换了，私人待办仍挂在旧负责人名下是正常的；
               如果挂在新负责人名下，说明泄漏了 */
            privateLeaks.push({ todoId: _s(t.id, 80), assigneeId: _s(t.assigneeId, 60), reason: '私人待办挂在当前负责人名下（疑似交接泄漏）' });
        }
    }
    const divChanges = Array.isArray(project.divisionLog) ? project.divisionLog.length : 0;
    const closed = openTodos === 0 && privateLeaks.length === 0;
    const summary = project.projectId + ' 审计：' + (closed ? '可关闭' : '未关闭')
        + ' · 待办 ' + openTodos + ' 项未关 · 私人泄漏 ' + privateLeaks.length + ' 处'
        + ' · 分工变更 ' + divChanges + ' 次';
    return { closed, openTodos, privateLeaks, divChanges, summary };
}