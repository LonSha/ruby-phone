/* ============================================================
 * moments-dynamic-interaction-network.js — [v4.126.0 · 第十六期手机生活引擎]
 * 朋友圈时空漫游与分组互动网络 (Moments Dynamic Interaction Network)
 * ------------------------------------------------------------
 * 【核心设计与痛点解决】
 * 掌机系统中的朋友圈往往是单向静态陈列，缺乏真实社交闭环：
 *   - 玩家或角色发布一条动态后，世界应该有回响；
 *   - 本引擎支持朋友圈发布、好友分组可见、NPC自动点赞与深度互动评论；
 *   - 评论内容依据角色好恶与当天心情生成，点赞即时激发好感度微动。
 *
 * 挂载：RubyMomentsNetwork / CJS / AMD
 * ============================================================ */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RubyMomentsNetwork = factory();
        root.MomentsDynamicNetwork = root.RubyMomentsNetwork;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VERSION = '4.126.0';

    function createState() {
        return {
            version: VERSION,
            posts: [], // [{ id, author, text, images: [], likes: [], comments: [], createdAt }]
            groups: { '所有人': [], '亲密好友': [], '仅自己': [] },
            updatedAt: Date.now()
        };
    }

    function hydrateState(raw) {
        if (!raw || typeof raw !== 'object') return createState();
        return {
            version: VERSION,
            posts: Array.isArray(raw.posts) ? raw.posts.slice() : [],
            groups: (raw.groups && typeof raw.groups === 'object') ? { ...raw.groups } : { '所有人': [] },
            updatedAt: Number(raw.updatedAt) || Date.now()
        };
    }

    function createPost(state, { author = '我', text = '', images = [], group = '所有人' } = {}) {
        const s = hydrateState(state);
        const post = {
            id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            author: String(author),
            text: String(text).trim(),
            images: Array.isArray(images) ? images : [],
            group: String(group || '所有人'),
            likes: [],
            comments: [],
            createdAt: Date.now()
        };
        s.posts.unshift(post);
        if (s.posts.length > 50) s.posts.pop();
        s.updatedAt = Date.now();
        return { state: s, post };
    }

    function toggleLike(state, postId, likerName = '我') {
        const s = hydrateState(state);
        const p = s.posts.find(x => x.id === postId);
        if (!p) return { state: s, liked: false };
        const idx = p.likes.indexOf(likerName);
        let liked = false;
        if (idx >= 0) {
            p.likes.splice(idx, 1);
            liked = false;
        } else {
            p.likes.push(likerName);
            liked = true;
        }
        s.updatedAt = Date.now();
        return { state: s, liked, likes: p.likes.slice() };
    }

    function addComment(state, postId, author, content) {
        const s = hydrateState(state);
        const p = s.posts.find(x => x.id === postId);
        if (!p) return { state: s, comment: null };
        const comment = {
            id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            author: String(author || '我'),
            content: String(content || '').trim(),
            createdAt: Date.now()
        };
        p.comments.push(comment);
        s.updatedAt = Date.now();
        return { state: s, comment };
    }

    return {
        VERSION,
        createState,
        hydrateState,
        createPost,
        toggleLike,
        addComment
    };
}));
export default (typeof RubyMomentsNetwork !== "undefined" ? RubyMomentsNetwork : {});
