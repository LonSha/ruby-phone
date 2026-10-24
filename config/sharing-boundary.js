/* ========================================================
 * config/sharing-boundary.js — [R7-O7 · 第七期规划] 关系边界与共享控制内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户想把一段回忆或消息发给某个角色或群聊，但担心整段私聊内容被无差别公开；
 *   以往缺乏细粒度分享控制，要么全公开要么完全无法分享。
 *   关系边界与共享控制提供细粒度的分享授权、收件人视角预览与可撤回机制：
 *     ① 三级授权范围：一对一私密(private_one_to_one) / 群组受限(shared_group) / 公开(public)；
 *     ② 显式设置可否再分享(reshareable)与时效(expiresAt)；
 *     ③ 视角预览(previewRecipientView)：预览不同接收人实际可见的裁剪/遮蔽内容；
 *     ④ 撤回访问(revokeShare)：撤回未来访问权限；但诚实保留撤回前已知晓的既有事实，不伪造记忆抹除。
 * ======================================================== */
'use strict';

/** 共享授权范围 */
export const SHARING_SCOPES = Object.freeze({
    PRIVATE_ONE_TO_ONE: 'private_one_to_one', // 单人私聊
    SHARED_GROUP: 'shared_group',             // 指定群组
    PUBLIC: 'public'                          // 公开全员
});

/** 接收方授权判定状态 */
export const ACCESS_STATUS = Object.freeze({
    AUTHORIZED: 'authorized',
    MASKED_PARTIAL: 'masked_partial',
    UNAUTHORIZED: 'unauthorized',
    EXPIRED: 'expired',
    REVOKED: 'revoked'
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 构造分享协议草案
 */
export function buildShareDraft(opts = {}, now = Date.now()) {
    const id = safeStr(opts.id) || ('share_' + now + '_' + Math.random().toString(36).slice(2, 7));
    const snippet = safeStr(opts.snippet);
    const scope = Object.values(SHARING_SCOPES).includes(opts.scope) ? opts.scope : SHARING_SCOPES.PRIVATE_ONE_TO_ONE;
    const recipients = Array.isArray(opts.recipients) ? opts.recipients.map(safeStr).filter(Boolean) : [];
    const reshareable = Boolean(opts.reshareable);
    const expiresAt = opts.expiresAt ? safeNum(opts.expiresAt, null) : null;
    const sensitiveTokens = Array.isArray(opts.sensitiveTokens) ? opts.sensitiveTokens.map(safeStr).filter(Boolean) : [];

    return Object.freeze({
        id,
        snippet,
        scope,
        recipients: Object.freeze(recipients),
        reshareable,
        expiresAt,
        sensitiveTokens: Object.freeze(sensitiveTokens),
        revoked: false,
        createdAt: now,
        readLogs: Object.freeze([]) // 记录已经查阅过的角色
    });
}

/**
 * 预览特定接收方的可见内容（敏感信息遮蔽与圈层鉴权）
 */
export function previewRecipientView(shareDraft, viewerId, now = Date.now()) {
    if (!shareDraft || typeof shareDraft !== 'object') {
        return { status: ACCESS_STATUS.UNAUTHORIZED, content: null, reason: 'invalid-draft' };
    }
    const viewer = safeStr(viewerId);

    // 1. 已被撤回
    if (shareDraft.revoked) {
        return { status: ACCESS_STATUS.REVOKED, content: null, reason: 'share-revoked' };
    }

    // 2. 已过期
    if (shareDraft.expiresAt && now > shareDraft.expiresAt) {
        return { status: ACCESS_STATUS.EXPIRED, content: null, reason: 'share-expired' };
    }

    // 3. 圈层授权检查
    if (shareDraft.scope !== SHARING_SCOPES.PUBLIC) {
        if (!shareDraft.recipients.includes(viewer)) {
            return { status: ACCESS_STATUS.UNAUTHORIZED, content: null, reason: 'viewer-not-in-recipients' };
        }
    }

    // 4. 遮蔽与脱敏（若在群组分享且含敏感片段）
    let content = shareDraft.snippet;
    let isMasked = false;
    if (shareDraft.scope === SHARING_SCOPES.SHARED_GROUP && shareDraft.sensitiveTokens.length > 0) {
        for (const token of shareDraft.sensitiveTokens) {
            if (token && content.includes(token)) {
                content = content.split(token).join('***');
                isMasked = true;
            }
        }
    }

    return Object.freeze({
        status: isMasked ? ACCESS_STATUS.MASKED_PARTIAL : ACCESS_STATUS.AUTHORIZED,
        content,
        viewerId: viewer,
        reshareable: shareDraft.reshareable,
        reason: isMasked ? 'sensitive-tokens-masked' : 'authorized-clean'
    });
}

/**
 * 记录查阅痕迹（诚实存证）
 */
export function markRecipientRead(shareDraft, readerId, now = Date.now()) {
    if (!shareDraft || typeof shareDraft !== 'object') return shareDraft;
    const reader = safeStr(readerId);
    if (!reader) return shareDraft;

    const logs = Array.isArray(shareDraft.readLogs) ? [...shareDraft.readLogs] : [];
    if (!logs.some(l => l.readerId === reader)) {
        logs.push(Object.freeze({ readerId: reader, readAt: now }));
    }

    return Object.freeze({
        ...shareDraft,
        readLogs: Object.freeze(logs)
    });
}

/**
 * 撤回分享
 * 契约：撤回未来访问权限；但诚实保留撤回前已读者的历史记录，不伪造记忆抹除
 */
export function revokeShare(shareDraft, reason = '', now = Date.now()) {
    if (!shareDraft || typeof shareDraft !== 'object') return null;
    return Object.freeze({
        ...shareDraft,
        revoked: true,
        revokeReason: safeStr(reason) || '用户主动撤回',
        revokedAt: now
    });
}

/**
 * 自检函数
 */
export function sharingBoundarySelfCheck() {
    const problems = [];
    if (Object.keys(SHARING_SCOPES).length !== 3) problems.push('SHARING_SCOPES 必须恰好为 3 级');
    if (Object.keys(ACCESS_STATUS).length !== 5) problems.push('ACCESS_STATUS 必须恰好为 5 态');
    return { problems };
}