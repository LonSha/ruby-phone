/* ============================================================
 * social-data.js — [v4.188.0] NPC 自主朋友圈的纯函数内核
 * ------------------------------------------------------------
 * 重构自 npc-autonomous-social-feed-engine.js（95 行）：类持 feedPosts、
 *   periodPools[timePeriod] || periodPools.night 把认不出的时段悄悄兜成夜间、
 *   自己 Date.now + Math.random 生成 id、三段挂载（globalThis/window/module.exports）、
 *   moodTag 收下任何字面量（nonsense 也算）。
 * 本件：时段与心情都是封闭词表、越界截断记账、点赞/评论拒答、注入只给计数读数。
 * 刻意不做：不取 now（调用方传）、不 Math.random、不持实例字段、不写任何文艺句。
 * ============================================================ */

/** 时段封闭词表。 */
export const DAY_PARTS = Object.freeze(['morning', 'afternoon', 'night']);

/** 心情封闭词表。 */
export const MOOD_TAGS = Object.freeze(['calm', 'reflective', 'restless', 'joyful', 'down']);

/** 动作封闭词表：只认 like / comment 两件。 */
export const ACTIONS = Object.freeze(['like', 'comment']);

export const SOCIAL_LIMITS = Object.freeze({ maxFeed: 80, maxNotes: 6, maxBody: 500 });
export const SOCIAL_FACE = Object.freeze({ EMPTY: 'empty', POSTS: 'posts' });
export const SOCIAL_REJECT = Object.freeze({
    unknownPart: 'unknown_part',
    unknownMood: 'unknown_mood',
    unknownAction: 'unknown_action',
    emptyBody: 'empty_body',
    noPost: 'no_post',
    badPayload: 'bad_payload'
});

function inList(list, v) {
    if (typeof v !== 'string') return false;
    return list.indexOf(v) >= 0;
}

export function defaultSocialState() { return { posts: [], notes: [] }; }

/** 归一：坏档不抛；半截数据（没 id / 没作者 / 时段或心情不认得）一律丢，不猜。 */
export function normalizeSocialState(raw) {
    const out = defaultSocialState();
    if (!raw || typeof raw !== 'object') return out;
    if (!Array.isArray(raw.posts)) return out;
    for (const p of raw.posts) {
        if (!p || typeof p !== 'object') continue;
        if (typeof p.postId !== 'string' || !p.postId) continue;
        if (typeof p.author !== 'string' || !p.author) continue;
        if (!inList(DAY_PARTS, p.part)) continue;
        if (!inList(MOOD_TAGS, p.mood)) continue;
        out.posts.push({
            postId: p.postId,
            author: p.author,
            body: typeof p.body === 'string' ? p.body.slice(0, SOCIAL_LIMITS.maxBody) : '',
            part: p.part,
            mood: p.mood,
            likes: Array.isArray(p.likes) ? p.likes.filter((x) => typeof x === 'string') : [],
            comments: Array.isArray(p.comments) ? p.comments.filter((c) => c && typeof c === 'object' && typeof c.commentId === 'string') : [],
            at: Number.isFinite(p.at) ? p.at : 0
        });
    }
    if (Array.isArray(raw.notes)) for (const n of raw.notes) if (typeof n === 'string') out.notes.push(n);
    if (out.notes.length > SOCIAL_LIMITS.maxNotes) out.notes = out.notes.slice(0, SOCIAL_LIMITS.maxNotes);
    return out;
}

/** 面态：有没有帖子。 */
export function readSocialFace(state) {
    const s = normalizeSocialState(state);
    return s.posts.length ? SOCIAL_FACE.POSTS : SOCIAL_FACE.EMPTY;
}

/** 发一条：时段 / 心情 / 正文都得过封闭词表；正文不许空。 */
export function postToFeed(state, spec, at) {
    const s = normalizeSocialState(state);
    if (!spec || typeof spec !== 'object') return { state: s, ok: false, reason: SOCIAL_REJECT.badPayload };
    if (typeof spec.postId !== 'string' || !spec.postId) return { state: s, ok: false, reason: SOCIAL_REJECT.badPayload };
    if (typeof spec.author !== 'string' || !spec.author) return { state: s, ok: false, reason: SOCIAL_REJECT.badPayload };
    const body = typeof spec.body === 'string' ? spec.body.trim() : '';
    if (!body) return { state: s, ok: false, reason: SOCIAL_REJECT.emptyBody };
    if (!inList(DAY_PARTS, spec.part)) return { state: s, ok: false, reason: SOCIAL_REJECT.unknownPart };
    if (!inList(MOOD_TAGS, spec.mood)) return { state: s, ok: false, reason: SOCIAL_REJECT.unknownMood };
    const post = {
        postId: spec.postId,
        author: spec.author,
        body: body.slice(0, SOCIAL_LIMITS.maxBody),
        part: spec.part,
        mood: spec.mood,
        likes: [],
        comments: [],
        at: Number.isFinite(at) ? at : 0
    };
    const posts = [post].concat(s.posts).slice(0, SOCIAL_LIMITS.maxFeed);
    return { state: { posts, notes: s.notes }, ok: true, reason: null, post };
}

/** 互动：like 幂等（同一 actor 只算一次），comment 要正文。 */
export function interactPost(state, postId, actor, action, commentText, at) {
    const s = normalizeSocialState(state);
    const idx = s.posts.findIndex((p) => p.postId === postId);
    if (idx < 0) return { state: s, ok: false, reason: SOCIAL_REJECT.noPost };
    if (!inList(ACTIONS, action)) return { state: s, ok: false, reason: SOCIAL_REJECT.unknownAction };
    if (typeof actor !== 'string' || !actor) return { state: s, ok: false, reason: SOCIAL_REJECT.badPayload };
    const posts = s.posts.slice();
    const p = Object.assign({}, posts[idx]);
    p.likes = p.likes.slice();
    p.comments = p.comments.slice();
    if (action === 'like') {
        if (p.likes.indexOf(actor) >= 0) return { state: s, ok: false, reason: SOCIAL_REJECT.badPayload };
        p.likes.push(actor);
    } else {
        const text = typeof commentText === 'string' ? commentText.trim() : '';
        if (!text) return { state: s, ok: false, reason: SOCIAL_REJECT.emptyBody };
        if (typeof at !== 'number') return { state: s, ok: false, reason: SOCIAL_REJECT.badPayload };
        p.comments.push({ commentId: 'c_' + postId + '_' + p.comments.length, author: actor, text, at });
    }
    posts[idx] = p;
    return { state: { posts, notes: s.notes }, ok: true, reason: null, likes: p.likes.length, comments: p.comments.length };
}

/** 注入面：只给计数读数（谁发了几条 / 谁被赞了几次）。零文艺句。 */
export function socialPromptBlock(state) {
    const s = normalizeSocialState(state);
    const out = ['[自主朋友圈·事实读数]'];
    out.push('帖子 ' + s.posts.length + ' 条');
    const byAuthor = new Map();
    for (const p of s.posts) {
        const cur = byAuthor.get(p.author) || { posts: 0, likes: 0, comments: 0 };
        cur.posts += 1; cur.likes += p.likes.length; cur.comments += p.comments.length;
        byAuthor.set(p.author, cur);
    }
    for (const [name, c] of byAuthor) {
        out.push('- ' + name + ' | 发 ' + c.posts + ' | 收赞 ' + c.likes + ' | 收评论 ' + c.comments);
    }
    return out;
}
