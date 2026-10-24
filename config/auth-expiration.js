/* ========================================================
 * config/auth-expiration.js — [R8-O7 · 第八期规划] 授权继承与到期内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决用户与角色之间的内容授权（查看创作、查阅日历、代理事项）
 *   缺乏时效管理与继承管控的问题：
 *     ① 授权契约：grantId / granteeId / scope / validUntil / inheritedFrom；
 *     ② 状态机：active（有效）/ expired（已到期）/ revoked（被撤销）；
 *     ③ 权限继承链求值：派生事项自动继承母授权，母授权撤销/到期时连锁失效；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */
'use strict';

export const AE_STORAGE_KEY = 'ae_auth_expire_v1';

export const GRANT_STATUS = Object.freeze({
    ACTIVE: 'active',
    EXPIRED: 'expired',
    REVOKED: 'revoked'
});

export const AUTH_SCOPES = Object.freeze({
    READ_CALENDAR: 'read_calendar',
    READ_CREATION: 'read_creation',
    READ_MEMO: 'read_memo',
    MANAGE_TASK: 'manage_task'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }

export function normalizeAuthState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            grants: {},
            updatedAt: Date.now()
        };
    }
    const grants = {};
    if (raw.grants && typeof raw.grants === 'object') {
        for (const [id, g] of Object.entries(raw.grants)) {
            if (!g || typeof g !== 'object') continue;
            grants[id] = {
                id: safeStr(g.id) || id,
                granteeId: safeStr(g.granteeId),
                scope: Object.values(AUTH_SCOPES).includes(g.scope) ? g.scope : AUTH_SCOPES.READ_MEMO,
                validUntil: typeof g.validUntil === 'number' ? g.validUntil : null,
                inheritedFrom: safeStr(g.inheritedFrom) || null,
                status: Object.values(GRANT_STATUS).includes(g.status) ? g.status : GRANT_STATUS.ACTIVE,
                grantedAt: typeof g.grantedAt === 'number' ? g.grantedAt : Date.now()
            };
        }
    }
    return {
        grants,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 签发新授权
 */
export function issueGrant(state, spec) {
    const s = normalizeAuthState(state);
    if (!spec || typeof spec !== 'object') {
        return { success: false, reason: 'invalid-spec', state: s };
    }
    const granteeId = safeStr(spec.granteeId);
    const scope = spec.scope;
    if (!granteeId || !Object.values(AUTH_SCOPES).includes(scope)) {
        return { success: false, reason: 'missing-grantee-or-invalid-scope', state: s };
    }

    const id = safeStr(spec.id) || `grant_${granteeId}_${Date.now()}`;
    const entry = {
        id,
        granteeId,
        scope,
        validUntil: typeof spec.validUntil === 'number' ? spec.validUntil : null,
        inheritedFrom: safeStr(spec.inheritedFrom) || null,
        status: GRANT_STATUS.ACTIVE,
        grantedAt: Date.now()
    };

    return {
        success: true,
        grant: entry,
        state: {
            ...s,
            grants: {
                ...s.grants,
                [id]: entry
            },
            updatedAt: Date.now()
        }
    };
}

/**
 * 校验特定角色对特定权限的有效性（含继承与到期时间检测）
 */
export function checkPermission(state, granteeId, scope, currentTime = Date.now()) {
    const s = normalizeAuthState(state);
    const gid = safeStr(granteeId);
    const sc = safeStr(scope);

    // 寻找匹配的 active grant
    const candidate = Object.values(s.grants).find(g => g.granteeId === gid && g.scope === sc && g.status === GRANT_STATUS.ACTIVE);
    if (!candidate) {
        return { allowed: false, reason: 'no-active-grant' };
    }

    // 检查时间到期
    if (candidate.validUntil != null && candidate.validUntil <= currentTime) {
        return { allowed: false, reason: 'grant-expired', grantId: candidate.id };
    }

    // 检查母授权继承
    if (candidate.inheritedFrom) {
        const parent = s.grants[candidate.inheritedFrom];
        if (!parent || parent.status !== GRANT_STATUS.ACTIVE) {
            return { allowed: false, reason: 'parent-grant-inactive-or-revoked', parentId: candidate.inheritedFrom };
        }
        if (parent.validUntil != null && parent.validUntil <= currentTime) {
            return { allowed: false, reason: 'parent-grant-expired', parentId: parent.id };
        }
    }

    return { allowed: true, grantId: candidate.id };
}

/**
 * 撤销授权（支持连锁撤销子授权）
 */
export function revokeGrant(state, grantId) {
    const s = normalizeAuthState(state);
    const gid = safeStr(grantId);
    if (!s.grants[gid]) {
        return { success: false, reason: 'grant-not-found', state: s };
    }

    let nextGrants = { ...s.grants };
    const revokedIds = [gid];
    nextGrants[gid] = { ...nextGrants[gid], status: GRANT_STATUS.REVOKED, revokedAt: Date.now() };

    // 级联处理继承自此授权的子授权
    for (const [id, g] of Object.entries(nextGrants)) {
        if (g.inheritedFrom === gid && g.status === GRANT_STATUS.ACTIVE) {
            nextGrants[id] = { ...g, status: GRANT_STATUS.REVOKED, revokedAt: Date.now() };
            revokedIds.push(id);
        }
    }

    return {
        success: true,
        revokedIds,
        state: {
            ...s,
            grants: nextGrants,
            updatedAt: Date.now()
        }
    };
}