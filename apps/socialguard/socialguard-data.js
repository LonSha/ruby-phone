/* ========================================================
 * socialguard-data.js — [v3.50.0] 熟人可见性案头 · 纯函数内核
 *
 * 源是 EPhone·xINOVO 熟人动态（moments.js 237647 字节）的**知情治理一族**：
 * 受众名单（audienceIds）、互动可见五分支（canSeeInteraction）、人脉闭包
 * （friendIds 双向镜像）、知情账（seenBy 首看时刻）、未看不许互动、
 * persona 分身隔离（user 的赞只被「认识的那个分身」看见）。
 *
 * 立场差：源把帖子/人脉/通知全挂宿主 db.moments 大对象（换角色一起串味），
 * 本件零数据库，四条会话键走 ^sg_ 前缀；源满篇 promptDefaults 拼 AI 提示词、
 * MediaRecorder 录音、贴图出图 —— 三块一律不缝，本件只做「谁能看见什么、
 * 谁已经看过、谁能跟谁互动」的**判定与读数**。
 *
 * 静默失效形态（本件守的）：帖子不可见不许假装可见；未看过不许互动；
 * 受众里认不出的人不许硬留；通知收件人失去可见权要剔除；
 * 人脉双向镜像不许只算单向；story 过期不许再进 feed。
 * ======================================================== */
'use strict';
/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前自带的那份 `numOrNull` 只给 `number` 放行、其余一律 `Number(v)` ——
 *   `null` / `''` / `[]` / `false` → 0、`true` → 1、`[5]` → 5。
 *   ⚠ 知情账（seenBy）与时刻面正是被这一步读坏的：`seenBy[k]` 的 `null` / `[]` / `false`
 *   被收成 0，**键留下了**，于是 `readingsOf` 按键数据实计到了这些脏值；而互动门读的
 *   是同一个 0（falsy）⇒ 界面统计与互动门对同一条记录给出相反结论。 */
import { numOrNull } from '../../config/num-gate.js';
/* 本件对外仍导出同名入口（下游 -app.js 照旧 `import { numOrNull }`），不做第二份实现。 */
export { numOrNull };
/* ---------- 真源常量 ---------- */
export const SG_KINDS = Object.freeze(['post', 'story']);
export const SG_CONTACT_KINDS = Object.freeze(['direct', 'linked']);
export const SG_POSTS_MAX = 500;
export const SG_COMMENTS_PER_POST_MAX = 200;
export const SG_TEXT_MAX = 5000;
export const SG_LEDGER_MAX = 120;
export const SG_HISTORY_SUMMARY_MAX = 6;

/* ---------- 基础工具 ---------- */
export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
/* ---------- 知情账单格判定（[v3.57.0·O3]） ----------
 * 「看过没」在源里只有一种可表示形态：`markSeen` 写进去的**正数**（首看时刻；
 * 拿不到时刻时写 1，见该函数）。故本判定只认「有限数且 > 0」，其余一律判「表示不了已看」：
 *   · `0`（含脏值被收成的 0、历史遗留的 0）——0 是 falsy，互动门与历史摘要本来就不认它，
 *     若 `readingsOf` 按键计数就把它算成一个人 ⇒ **同一条记录两种结论**（O3 的病灶）；
 *   · `null` / `undefined` / `''` / `[]` / `false`（归一阶段的怪值）——它们从不是「看过」。
 * 归一（normalizePost）与读数（readingsOf）、门（mayInteractWith）、首看（markSeen）四处
 * 必须同用这一条判据，否则四个读数会各自为政。 */
export function seenAtOf(v) {
    const t = numOrNull(v);
    return (t !== null && t > 0) ? t : null;
}
export function deepClone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}
export function charActor(charId) { return 'char:' + toStr(charId); }
export function charIdOfActor(actorId) {
    const s = toStr(actorId);
    return (s.indexOf('char:') === 0) ? s.slice(5) : '';
}

/* ---------- 帖子归一（源 ensure/moments posts 一族）---------- */
export function normalizeComment(raw, index) {
    const r = isPlain(raw) ? raw : {};
    return {
        id: toStr(r.id) || ('sg_cmt_' + String(index + 1)),
        authorId: toStr(r.authorId),
        authorPersonaId: toStr(r.authorPersonaId),
        text: toStr(r.text),
        stickerId: toStr(r.stickerId),
        replyTo: toStr(r.replyTo),
        deletedAt: numOrNull(r.deletedAt) || 0,
        createdAt: numOrNull(r.createdAt) || 0
    };
}

export function normalizePost(raw, index) {
    if (!isPlain(raw)) return { post: null, notes: ['not_object'] };
    const notes = [];
    const kind = (SG_KINDS.indexOf(raw.kind) >= 0) ? raw.kind : 'post';
    if (SG_KINDS.indexOf(raw.kind) < 0 && raw.kind) notes.push('kind_unknown');
    const audience = listOf(raw.audienceIds).map(toStr).filter(Boolean);
    const commentsRaw = listOf(raw.comments);
    const cap = trimRows(commentsRaw, SG_COMMENTS_PER_POST_MAX);
    if (cap.dropped > 0) notes.push('comments_overflow_' + String(cap.dropped));
    const comments = cap.rows.map(normalizeComment);
    const seenBy = {};
    if (isPlain(raw.seenBy)) {
        for (const k of Object.keys(raw.seenBy)) {
            /* [v3.57.0·O3] 只认能**表示已看**的格（正数时刻，`seenAtOf`）；脏值与历史 0 一律丢弃。
             *   此处此前是「取到数就留」，而旧取数把 null/''/[]/false 收成 0 —— 键留下了，
             *   读数面按它计数、门面却不认它 ⇒ 界面统计与互动门对同一条记录相反。 */
            const t = seenAtOf(raw.seenBy[k]);
            if (k && t !== null) seenBy[k] = t;
        }
    }
    const text = toStr(raw.text).slice(0, SG_TEXT_MAX);
    if (toStr(raw.text).length > SG_TEXT_MAX) notes.push('text_clamped');
    return {
        post: {
            id: toStr(raw.id) || ('sg_post_' + String(index + 1)),
            kind: kind,
            authorId: toStr(raw.authorId),
            text: text,
            audienceIds: audience,
            likes: listOf(raw.likes).map(toStr).filter(Boolean),
            comments: comments,
            seenBy: seenBy,
            viewerPersonaIds: isPlain(raw.viewerPersonaIds) ? raw.viewerPersonaIds : {},
            authorPersonaId: toStr(raw.authorPersonaId),
            createdAt: numOrNull(raw.createdAt) || 0,
            expiresAt: numOrNull(raw.expiresAt) || 0
        },
        notes: notes
    };
}

export function normalizePostStore(raw) {
    const out = { posts: [], rejected: [], notes: [] };
    let arr = null;
    if (Array.isArray(raw)) arr = raw;
    else if (isPlain(raw) && Array.isArray(raw.posts)) arr = raw.posts;
    else { out.notes.push('store_shape'); return out; }
    for (let i = 0; i < arr.length; i++) {
        const r = normalizePost(arr[i], i);
        if (!r.post) { out.rejected.push({ index: i, why: 'not_object' }); continue; }
        out.posts.push(r.post);
        for (const n of r.notes) out.notes.push('post_' + String(i) + '_' + n);
    }
    const capped = trimRows(out.posts, SG_POSTS_MAX);
    out.posts = capped.rows;
    if (capped.dropped > 0) out.notes.push('posts_overflow_' + String(capped.dropped));
    return out;
}

/* ---------- 人脉归一（源 contactsFor 一族）---------- */
export function normalizeContact(raw, index) {
    const r = isPlain(raw) ? raw : {};
    const kind = (SG_CONTACT_KINDS.indexOf(r.kind) >= 0) ? r.kind : 'direct';
    return {
        contact: {
            id: toStr(r.id) || ('sg_ct_' + String(index + 1)),
            kind: kind,
            ownerCharId: toStr(r.ownerCharId),
            actorId: toStr(r.actorId),
            relationship: toStr(r.relationship),
            reverseRelationship: toStr(r.reverseRelationship),
            mayInteract: r.mayInteract === true,
            mayPost: r.mayPost === true,
            mayStory: r.mayStory === true,
            reverseMayInteract: r.reverseMayInteract === true,
            reverseMayPost: r.reverseMayPost === true,
            reverseMayStory: r.reverseMayStory === true,
            enabled: r.enabled !== false
        },
        notes: []
    };
}

/* 反向镜像（源 contactsFor 的 incoming 分支）：linked 人脉给对方生成一份
 * owner 反转 / 权限取反向字段的镜像，me 侧与 peer 侧各持一份不冲突。 */
export function mirrorContacts(contacts) {
    const out = [];
    for (const c of listOf(contacts)) {
        out.push(c);
        if (c && c.kind === 'linked' && c.ownerCharId && c.actorId) {
            out.push({
                id: c.id + '_rev',
                kind: 'linked',
                ownerCharId: charIdOfActor(c.actorId),
                actorId: charActor(c.ownerCharId),
                relationship: c.reverseRelationship || '',
                reverseRelationship: c.relationship || '',
                mayInteract: c.reverseMayInteract === true,
                mayPost: c.reverseMayPost === true,
                mayStory: c.reverseMayStory === true,
                reverseMayInteract: c.mayInteract === true,
                reverseMayPost: c.mayPost === true,
                reverseMayStory: c.mayStory === true,
                enabled: c.enabled !== false
            });
        }
    }
    return out;
}
/* ---------- 可见性与人脉闭包（源 visibleTo / friendIds / canSeeInteraction）---------- */

/* 帖子对 actor 可见：作者本人 或 在受众名单里。空受众名单 = 公开。 */
export function visibleTo(post, actorId) {
    if (!isPlain(post) || !actorId) return false;
    if (post.authorId === actorId) return true;
    const aud = listOf(post.audienceIds);
    if (aud.length === 0) return true;
    return aud.indexOf(actorId) >= 0;
}


/* 互动可见五分支（源 canSeeInteraction，语义逐支对齐）：
 *  ① 观者先得看得见帖子；② user 的赞/评带 persona 分身，只被「认识的那个分身」看见；
 *  ③ 互动者本人看不见帖子时，除作者与 user 外不许见；④ user / 作者本人 / all 档全可见；
 *  ⑤ mutual 档下：互动者是我自己或作者（人脉闭包判定留在 app 层读数，纯面只做无状态判定）。 */
export function canSeeInteraction(post, viewerId, actorId, interactionPersonaId, viewerPersonaId, settings) {
    if (!visibleTo(post, viewerId)) return false;
    if (actorId === 'user' && viewerId !== 'user' && interactionPersonaId && interactionPersonaId !== 'legacy') {
        const known = toStr(viewerPersonaId);
        if (known !== '' && known !== interactionPersonaId) return false;
    }
    if (!visibleTo(post, actorId) && actorId !== post.authorId && viewerId !== 'user' && viewerId !== post.authorId) return false;
    if (viewerId === 'user' || viewerId === post.authorId) return true;
    const vis = (isPlain(settings) && settings.interactionVisibility === 'all') ? 'all' : 'mutual';
    if (vis === 'all') return true;
    return actorId === post.authorId || actorId === viewerId;
}
export function contactsFor(contacts, charId) {
    const direct = [];
    const incoming = [];
    for (const c of listOf(contacts)) {
        if (!c || c.enabled === false) continue;
        if (c.kind === 'linked' && charIdOfActor(c.actorId) === toStr(charId)) {
            incoming.push({
                id: c.id + '_in',
                kind: 'linked',
                ownerCharId: toStr(charId),
                actorId: charActor(c.ownerCharId),
                relationship: c.reverseRelationship || '',
                reverseRelationship: c.relationship || '',
                mayInteract: c.reverseMayInteract === true,
                mayPost: c.reverseMayPost === true,
                mayStory: c.reverseMayStory === true,
                reverseOfId: c.id,
                enabled: true
            });
        } else if (c.ownerCharId === toStr(charId)) {
            direct.push(c);
        }
    }
    return direct.concat(incoming);
}

/* ---------- 知情账与互动门（源 markSeen / seenBy 一族）---------- */
/* 首看记账：seenBy[actorId] 只在第一次看时落时刻（源 firstView 语义）。
 *   [v3.57.0·O3] 「已看」的可表示形态只有一种：**正数**（时刻；拿不到时刻时写 1）。
 *   落格与查格同用 `seenAtOf`，故 `firstView`、`mayInteractWith`、`historySummary`、
 *   `readingsOf` 对同一条记录必然给出同一结论。 */
export function markSeen(post, actorId, atMs) {
    if (!isPlain(post) || !actorId) return { ok: false, why: 'bad_input', firstView: false, seenBy: null };
    if (!visibleTo(post, actorId)) return { ok: false, why: 'not_visible', firstView: false, seenBy: null };
    const seenBy = isPlain(post.seenBy) ? deepClone(post.seenBy) : {};
    const firstView = seenAtOf(seenBy[actorId]) === null;
    if (firstView) seenBy[actorId] = (numOrNull(atMs) !== null && Number(atMs) > 0) ? Number(atMs) : 1;
    return { ok: true, why: '', firstView: firstView, seenBy: seenBy };
}
/* 互动门：未看过不许互动（源「尚未观看这条动态」语义）；作者免看。 */
export function mayInteractWith(post, actorId) {
    if (!isPlain(post)) return { ok: false, why: 'bad_input' };
    if (post.authorId === actorId) return { ok: true, why: '' };
    if (!visibleTo(post, actorId)) return { ok: false, why: 'not_visible' };
    if (!isPlain(post.seenBy) || seenAtOf(post.seenBy[actorId]) === null) return { ok: false, why: 'not_seen' };
    return { ok: true, why: '' };
}

/* story 时效：过期不许再进 feed（源 activeStories 语义）。 */
export function isStoryAlive(post, nowMs) {
    if (!isPlain(post) || post.kind !== 'story') return false;
    const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : 0;
    return post.expiresAt > now;
}

/* 通知可见过滤（源 m.notifications.filter 一族）：收件人失去可见权的通知剔除。 */
export function filterNotifications(notifications, posts) {
    const out = [];
    let dropped = 0;
    for (const n of listOf(notifications)) {
        if (n && n.postId) {
            const p = listOf(posts).find(function (x) { return x && x.id === n.postId; });
            if (p && !visibleTo(p, n.toId)) { dropped++; continue; }
        }
        out.push(n);
    }
    return { notifications: out, dropped: dropped };
}
/* ---------- feed 三类与读数（源 userFeed / activeStories / profilePosts 一族）---------- */
export function feedOf(posts, nowMs) {
    const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : 0;
    const alive = function (p) { return (p.kind === 'story') ? isStoryAlive(p, now) : (p.kind === 'post'); };
    const postsFeed = listOf(posts).filter(function (p) { return p && p.kind === 'post' && visibleTo(p, 'user'); }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    const stories = listOf(posts).filter(function (p) { return p && p.kind === 'story' && visibleTo(p, 'user') && isStoryAlive(p, now); }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    const mine = postsFeed.filter(function (p) { return p.authorId === 'user'; });
    return { posts: postsFeed, stories: stories, mine: mine };
}

/* 历史摘要（源 1254 行）：作者自己发的或我看过的，至多 6 条，用于自述不撒谎。 */
export function historySummary(posts, actorId, summarize) {
    const rows = listOf(posts)
        .filter(function (p) { return p && visibleTo(p, actorId) && (p.authorId === actorId || (isPlain(p.seenBy) && seenAtOf(p.seenBy[actorId]) !== null)); })
        .sort(function (a, b) { return b.createdAt - a.createdAt; })
        .slice(0, SG_HISTORY_SUMMARY_MAX);
    return rows.map(function (p) { return { id: p.id, authorId: p.authorId, text: (typeof summarize === 'function') ? summarize(p) : toStr(p.text) }; });
}

/* 删帖因（源 delete 语义）：不可见 / 不是作者 / 已不在。 */
export function deleteGuard(post, actorId) {
    if (!isPlain(post)) return { ok: false, why: 'already_gone' };
    if (!visibleTo(post, actorId)) return { ok: false, why: 'not_visible' };
    if (post.authorId !== actorId) return { ok: false, why: 'not_author' };
    return { ok: true, why: '' };
}

/* 评论创建门（源 1108 行）：不可见 / 空文 / 回复目标已删，逐因拒。 */
export function commentGuard(post, actorId, text, stickerId, replyTo) {
    if (!isPlain(post)) return { ok: false, why: 'not_visible' };
    if (!visibleTo(post, actorId)) return { ok: false, why: 'not_visible' };
    const inter = mayInteractWith(post, actorId);
    if (!inter.ok) return { ok: false, why: inter.why };
    if (!toStr(text).trim() && !toStr(stickerId)) return { ok: false, why: 'empty' };
    if (toStr(replyTo)) {
        const ok = listOf(post.comments).some(function (c) { return c && c.id === replyTo && !c.deletedAt; });
        if (!ok) return { ok: false, why: 'reply_target_gone' };
    }
    return { ok: true, why: '' };
}

/* 读数面。 */
export function readingsOf(posts, contacts, nowMs) {
    const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : 0;
    const store = normalizePostStore(posts);
    const ps = store.posts;
    const alive = ps.filter(function (p) { return (p.kind === 'story') ? isStoryAlive(p, now) : true; });
    let seen = 0; let likes = 0; let comments = 0;
    for (const p of alive) {
        /* [v3.57.0·O3] 计的是**能表示已看**的格（`seenAtOf`），不是「seenBy 里有几个键」。
         *   此前按 `Object.keys().length` 计：归一阶段留下的 0 值键（脏值被收成 0）被算成
         *   一个人，而互动门与历史摘要判它是「未看」⇒ 界面读数 4、允许互动仅 1。
         *   归一已把这类格丢弃，此处再按同一判据计数，四个读数才真正同源。 */
        seen += Object.keys(isPlain(p.seenBy) ? p.seenBy : {}).filter(function (k) { return seenAtOf(p.seenBy[k]) !== null; }).length;
        likes += listOf(p.likes).length;
        comments += listOf(p.comments).filter(function (c) { return c && !c.deletedAt; }).length;
    }
    return {
        posts: alive.filter(function (p) { return p.kind === 'post'; }).length,
        stories: alive.filter(function (p) { return p.kind === 'story'; }).length,
        contacts: listOf(contacts).filter(function (c) { return c && c.enabled !== false; }).length,
        seenCount: seen,
        likeCount: likes,
        commentCount: comments
    };
}