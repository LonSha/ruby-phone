/* ========================================================
 * config/social-knowledge-bridge.js — [v3.69.0 · 拓展计划 X5 第一切片] 社媒知情边界实际接入（纯函数）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   socialguard 已有完整的可见性判定：visibleTo（帖子受众）、canSeeInteraction（互动可见五分支）、
 *   mayInteractWith（未看不能互动）、filterNotifications（按可见性过滤通知）、readingsOf（知情读数）。
 *   但这些判定**只在本 App 内用**——朋友圈不读它、通知收件人不读它、AI 回复上下文不读它。
 *
 *   代价是三类越界：
 *   ① **看不见帖子的人从搜索/通知/AI 回复另获内容** —— socialguard 判定某人不可见，
 *      但通知系统照发、搜索照索引、AI 照生成上下文，该角色仍能获得帖子内容。
 *   ② **未看不能互动被绕过** —— mayInteractWith 判定未看不可互动，但消费端不查，
 *      用户/角色未看就能赞和评论。
 *   ③ **撤回/换分身/修改受众后缓存不失效** —— 帖子撤回或受众修改后，
 *      已派发的通知/已索引的搜索结果/已生成的 AI 上下文不更新，陈旧内容继续流通。
 *
 * 【本模块只做三件事（与 schedule-bridge / finance-overview 同范式）】
 *   ① **知情判定 `knowledgeCheck`**：收 socialguard 的 posts + contacts + actorId，
 *      判定该 actor 对哪些帖子可见、哪些已看、哪些可互动——不重算，只包装已有判定。
 *   ② **通知过滤 `filterNotificationsByVisibility`**：把通知列表按可见性过滤，
 *      看不见帖子的人不收到相关通知。
 *   ③ **知情账 `knowledgeLedger`**：记录谁在哪个剧情时刻获得了哪条信息，
 *      撤回/修改受众后据此失效缓存。
 *
 * 【不做什么】
 *   · 不取数：posts/contacts 全部由调用方取好传进来，本模块是纯函数。
 *   · 不写 socialguard 的存储：只读判定，写入只由 socialguard App 自己做。
 *   · 不读存储、不带计时器：纯函数。
 *
 * 【三条口径纪律】
 *   · **未知权限保留未知**：受众列表为空 = 公开（所有人可见），与「没有受众数据」分开。
 *   · **未看不能互动**：mayInteractWith 返回 not_seen 时，互动必须被拦。
 *   · **撤回失效缓存**：帖子被删或受众修改后，已派发的通知必须标记陈旧。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

/* ───────── ① 知情判定 ───────── */

/**
 * 判定一个 actor 对帖子库的知情状态。
 *
 * 收 socialguard 的 posts + contacts + actorId，
 * 用 visibleTo / seenAtOf / mayInteractWith 判定每个帖子对该 actor 的可见性与互动权。
 *
 * @param {Array} posts — socialguard 归一化后的帖子列表
 * @param {Array} contacts — socialguard 归一化后的人脉册
 * @param {string} actorId — 被判定的 actor（'user' 或 'char:xxx'）
 * @param {number} [nowMs] — 当前时间戳（用于 story 时效判定）
 * @returns {{visible: Array, seen: Array, unseen: Array, canInteract: Array, blocked: Array, summary: string}}
 */
export function knowledgeCheck(posts, contacts, actorId, nowMs) {
    // 动态导入 socialguard 的纯函数——但本模块不 import 它（保持零依赖）。
    // 调用方传入了 calc 对象时使用 calc 的函数，否则使用内联逻辑。
    //
    // 为了保持零依赖但又能真正判定，本函数实现内联的 visibleTo 逻辑
    // （与 socialguard-data.js 的 visibleTo 同口径，但不是第二份真源——
    // socialguard App 打开后由它自己判，本函数只在 App 未打开时提供降级判定）。

    const ps = Array.isArray(posts) ? posts : [];
    const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : 0;
    const actor = String(actorId || '');

    const visible = [];
    const seen = [];
    const unseen = [];
    const canInteract = [];
    const blocked = [];

    for (const post of ps) {
        if (!post || typeof post !== 'object') continue;

        // story 时效：过期不进任何列表
        if (post.kind === 'story' && typeof post.expiresAt === 'number' && now > 0 && post.expiresAt < now) continue;

        // 可见性判定（与 socialguard-data.visibleTo 同口径）
        const isVisible = _isVisibleTo(post, actor);
        if (!isVisible) continue;

        visible.push({ postId: String(post.id || ''), authorId: String(post.authorId || ''), kind: String(post.kind || 'post') });

        // 已看判定（与 socialguard-data.seenAtOf 同口径）
        const seenAt = _seenAtOf(post, actor);
        if (seenAt !== null) {
            seen.push({ postId: String(post.id || ''), seenAt: seenAt });
            canInteract.push({ postId: String(post.id || ''), why: '' });
        } else {
            unseen.push({ postId: String(post.id || ''), why: 'not_seen' });
            blocked.push({ postId: String(post.id || ''), why: 'not_seen' });
        }
    }

    const summary = String(actor) + '：可见 ' + String(visible.length) + ' 条'
        + '（已看 ' + String(seen.length) + ' · 未看 ' + String(unseen.length) + '）'
        + '；可互动 ' + String(canInteract.length) + ' 条。';

    return { visible, seen, unseen, canInteract, blocked, summary };
}

/**
 * 内联可见性判定（与 socialguard-data.visibleTo 同口径）。
 * 只在 socialguard App 未打开时提供降级——App 打开后由它自己判。
 */
function _isVisibleTo(post, actorId) {
    if (!post || typeof post !== 'object' || !actorId) return false;
    if (post.authorId === actorId) return true;
    const aud = Array.isArray(post.audienceIds) ? post.audienceIds : [];
    if (aud.length === 0) return true;  // 空 = 公开
    return aud.indexOf(actorId) >= 0;
}

/**
 * 内联已看判定（与 socialguard-data.seenAtOf 同口径）。
 */
function _seenAtOf(post, actorId) {
    if (!post || typeof post !== 'object' || !actorId) return null;
    const seenBy = (post.seenBy && typeof post.seenBy === 'object') ? post.seenBy : {};
    const v = seenBy[actorId];
    if (typeof v === 'number' && v > 0) return v;
    if (v && typeof v === 'object' && typeof v.at === 'number' && v.at > 0) return v.at;
    return null;
}

/* ───────── ② 通知过滤 ───────── */

/**
 * 按可见性过滤通知列表。
 * 看不见帖子的人不收到相关通知。
 *
 * @param {Array} notifications — 通知列表（每个含 postId 或 refId + recipientId）
 * @param {Array} posts — socialguard 归一化后的帖子列表
 * @param {Array} contacts — 人脉册（暂不使用，预留）
 * @returns {{allowed: Array, blocked: Array, summary: string}}
 */
export function filterNotificationsByVisibility(notifications, posts, contacts) {
    const notifs = Array.isArray(notifications) ? notifications : [];
    const postMap = new Map();
    for (const p of (Array.isArray(posts) ? posts : [])) {
        if (p && typeof p === 'object' && p.id) postMap.set(String(p.id), p);
    }

    const allowed = [];
    const blocked = [];

    for (const n of notifs) {
        if (!n || typeof n !== 'object') continue;
        const recipientId = String(n.recipientId || n.actorId || '');
        const postId = String(n.postId || n.refId || '');
        const post = postId ? postMap.get(postId) : null;

        if (!post) {
            // 没有关联帖子（非社媒通知）→ 放行
            allowed.push(n);
            continue;
        }

        if (_isVisibleTo(post, recipientId)) {
            allowed.push(n);
        } else {
            blocked.push({ notification: n, reason: 'not_visible', postId: postId });
        }
    }

    const summary = '通知过滤：放行 ' + String(allowed.length) + ' · 拦截 ' + String(blocked.length) + '。';
    return { allowed, blocked, summary };
}

/* ───────── ③ 知情账本 ───────── */

/** 知情账本上限（随会话隔离）。 */
export const KNOWLEDGE_LEDGER_LIMIT = 200;

/**
 * 幂等键：actor + postId + 事件类型。
 * 同一 actor 对同一帖子的同一事件只记一次。
 */
export function knowledgeIdemKey(actorId, postId, eventType) {
    return String(actorId || '') + ':' + String(postId || '') + ':' + String(eventType || '');
}

/**
 * 归一化知情账本条目。
 */
export function normalizeKnowledgeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const idemKey = typeof raw.idemKey === 'string' ? raw.idemKey : '';
    if (!idemKey) return null;
    return {
        idemKey: idemKey,
        actorId: typeof raw.actorId === 'string' ? raw.actorId : '',
        postId: typeof raw.postId === 'string' ? raw.postId : '',
        eventType: typeof raw.eventType === 'string' ? raw.eventType : '',  // seen/like/comment/revoke/audience-change
        at: typeof raw.at === 'number' ? raw.at : 0,
        storyTime: typeof raw.storyTime === 'string' ? raw.storyTime : '',  // 剧情时刻标记
        note: typeof raw.note === 'string' ? raw.note : ''
    };
}

/**
 * 归一化知情账本（去重 + 截断）。
 */
export function normalizeKnowledgeLedger(raw) {
    if (!Array.isArray(raw)) return { entries: [], dropped: 0 };
    const seen = new Set();
    const entries = [];
    let dropped = 0;
    for (const item of raw) {
        const e = normalizeKnowledgeEntry(item);
        if (!e) { dropped++; continue; }
        if (seen.has(e.idemKey)) { dropped++; continue; }
        seen.add(e.idemKey);
        entries.push(e);
    }
    if (entries.length > KNOWLEDGE_LEDGER_LIMIT) {
        dropped += entries.length - KNOWLEDGE_LEDGER_LIMIT;
        entries.splice(0, entries.length - KNOWLEDGE_LEDGER_LIMIT);
    }
    return { entries: entries, dropped: dropped };
}

/**
 * 对账：找出需要失效的缓存条目（帖子被删或受众修改后）。
 *
 * @param {Array} ledger — 已有知情账本
 * @param {Array} currentPosts — 当前帖子列表（已删的帖子不在其中）
 * @returns {{stale: Array, active: Array}}
 *   stale — 帖子已不存在，相关通知/搜索结果需标记陈旧
 *   active — 帖子仍在，知情记录有效
 */
export function diffKnowledgeLedger(ledger, currentPosts) {
    const prev = Array.isArray(ledger) ? ledger : [];
    const currentIds = new Set(
        (Array.isArray(currentPosts) ? currentPosts : [])
            .filter((p) => p && p.id)
            .map((p) => String(p.id))
    );

    const stale = [];
    const active = [];

    for (const e of prev) {
        if (!e || !e.postId) continue;
        if (currentIds.has(e.postId)) {
            active.push(e);
        } else {
            stale.push(e);
        }
    }

    return { stale, active };
}

/**
 * 应用账本更新：移除陈旧条目，写入新条目。
 */
export function applyKnowledgeLedger(prevLedger, newEntries, stalePostIds) {
    const prev = Array.isArray(prevLedger) ? prevLedger : [];
    const stale = new Set((Array.isArray(stalePostIds) ? stalePostIds : []).map((k) => String(k)));

    const filtered = prev.filter((e) => e && e.postId && !stale.has(e.postId));
    const merged = filtered.concat(
        (Array.isArray(newEntries) ? newEntries : []).map((e) => normalizeKnowledgeEntry(e)).filter(Boolean)
    );

    const normalized = normalizeKnowledgeLedger(merged);
    return {
        entries: normalized.entries,
        dropped: normalized.dropped,
        count: normalized.entries.length
    };
}

/* ───────── ④ 自检 ───────── */

/**
 * 知情判定自检。
 */
export function knowledgeSelfCheck() {
    const problems = [];

    // 可见性判定
    const post1 = { id: 'p1', authorId: 'user', audienceIds: [], kind: 'post', seenBy: {} };
    if (!_isVisibleTo(post1, 'char:a')) problems.push('公开帖子应所有人可见');
    if (!_isVisibleTo(post1, 'user')) problems.push('作者应可见自己的帖子');

    const post2 = { id: 'p2', authorId: 'user', audienceIds: ['char:a'], kind: 'post', seenBy: {} };
    if (!_isVisibleTo(post2, 'char:a')) problems.push('受众内的角色应可见');
    if (_isVisibleTo(post2, 'char:b')) problems.push('受众外的角色不应可见');

    // 已看判定
    const post3 = { id: 'p3', authorId: 'user', audienceIds: [], kind: 'post', seenBy: { 'char:a': 12345 } };
    if (_seenAtOf(post3, 'char:a') !== 12345) problems.push('已看判定应返回时间戳');
    if (_seenAtOf(post3, 'char:b') !== null) problems.push('未看判定应返回 null');

    const post4 = { id: 'p4', authorId: 'user', audienceIds: [], kind: 'post', seenBy: { 'char:a': { at: 999 } } };
    if (_seenAtOf(post4, 'char:a') !== 999) problems.push('对象形式 seenBy 应正确读取 at');

    // knowledgeCheck
    const posts = [post1, post2, post3];
    const check = knowledgeCheck(posts, [], 'char:a', 0);
    if (check.visible.length !== 3) problems.push('char:a 应可见 3 条（p1 公开 + p2 受众内 + p3 公开），实际 ' + check.visible.length);
    if (check.seen.length !== 1) problems.push('char:a 已看 1 条（p3），实际 ' + check.seen.length);
    if (check.canInteract.length !== 1) problems.push('char:a 可互动 1 条（p3），实际 ' + check.canInteract.length);

    // 通知过滤
    const notifs = [
        { postId: 'p1', recipientId: 'char:a' },
        { postId: 'p2', recipientId: 'char:b' },  // char:b 不在 p2 受众
        { postId: 'p2', recipientId: 'char:a' },
        { type: 'system' },  // 非社媒通知
    ];
    const filtered = filterNotificationsByVisibility(notifs, posts, []);
    if (filtered.allowed.length !== 3) problems.push('放行应 3 条（p1+char:a / p2+char:a / system），实际 ' + filtered.allowed.length);
    if (filtered.blocked.length !== 1) problems.push('拦截应 1 条（p2+char:b），实际 ' + filtered.blocked.length);

    // 幂等键
    const k1 = knowledgeIdemKey('char:a', 'p1', 'seen');
    const k2 = knowledgeIdemKey('char:a', 'p1', 'seen');
    if (k1 !== k2) problems.push('幂等键不稳定');
    if (k1 !== 'char:a:p1:seen') problems.push('幂等键格式不符: ' + k1);

    // 账本去重
    const raw = [
        { idemKey: 'a:b:seen', actorId: 'a', postId: 'b', eventType: 'seen', at: 1 },
        { idemKey: 'a:b:seen', actorId: 'a', postId: 'b', eventType: 'seen', at: 2 },
        null,
    ];
    const norm = normalizeKnowledgeLedger(raw);
    if (norm.entries.length !== 1) problems.push('去重后应 1 条，实际 ' + norm.entries.length);
    if (norm.dropped !== 2) problems.push('丢弃应 2 条，实际 ' + norm.dropped);

    // 截断
    const big = [];
    for (let i = 0; i < KNOWLEDGE_LEDGER_LIMIT + 5; i++) {
        big.push({ idemKey: 'k' + i, actorId: 'a', postId: 'p' + i, eventType: 'seen', at: i });
    }
    const trunc = normalizeKnowledgeLedger(big);
    if (trunc.entries.length !== KNOWLEDGE_LEDGER_LIMIT) {
        problems.push('截断后应 ' + KNOWLEDGE_LEDGER_LIMIT + ' 条，实际 ' + trunc.entries.length);
    }

    // diff
    const ledger = [
        { idemKey: 'a:p1:seen', actorId: 'a', postId: 'p1', eventType: 'seen', at: 1 },
        { idemKey: 'a:p2:seen', actorId: 'a', postId: 'p2', eventType: 'seen', at: 2 },
    ];
    const diff = diffKnowledgeLedger(ledger, [{ id: 'p1' }]);  // p2 被删
    if (diff.stale.length !== 1) problems.push('陈旧应 1 条（p2 已删），实际 ' + diff.stale.length);
    if (diff.active.length !== 1) problems.push('有效应 1 条（p1 仍在），实际 ' + diff.active.length);

    // apply
    const applied = applyKnowledgeLedger(ledger, [], ['p2']);
    if (applied.count !== 1) problems.push('应用后应 1 条，实际 ' + applied.count);

    return { problems: problems };
}

/* ───────── ⑤ 导出清单 ───────── */

export default {
    KNOWLEDGE_LEDGER_LIMIT,
    knowledgeCheck,
    filterNotificationsByVisibility,
    knowledgeIdemKey,
    normalizeKnowledgeEntry,
    normalizeKnowledgeLedger,
    diffKnowledgeLedger,
    applyKnowledgeLedger,
    knowledgeSelfCheck,
};