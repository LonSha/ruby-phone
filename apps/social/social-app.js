/* ========================================================
 * social-app.js — [v4.188.0] 自主朋友圈 · 控制器
 * 规格照 call/share 同族。零网络 / 零定时器 / 注入只给计数。
 * 会话键走 ^social_ 前缀。
 * ======================================================== */
'use strict';
import {
    SOCIAL_FACE, SOCIAL_REJECT, DAY_PARTS, MOOD_TAGS, ACTIONS, SOCIAL_LIMITS,
    defaultSocialState, normalizeSocialState, readSocialFace,
    postToFeed, interactPost, socialPromptBlock,
} from './social-data.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'social_feed_v1';

import { SocialView } from './social-view.js';
export class SocialApp {
    render() {
        this._view ??= new SocialView(this, this.shell);
        this._view.render();
    }
    constructor(shell, storage) {
        this.shell = shell; this.storage = storage;
        this.state = defaultSocialState();
        this.storageOk = true; this._view = null;
        this._load();
    }
    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            if (typeof raw === 'string') return JSON.parse(raw);
            return raw;
        } catch (_e) { this.storageOk = false; return null; }
    }
    _writeJSON(key, v) {
        try {
            if (!this.storage) { this.storageOk = false; return false; }
            const r = writeReceipt(this.storage, key, JSON.stringify(v));
            const ok = r.saved === true;
            if (!ok) this.storageOk = false;
            return ok;
        } catch (_e) { this.storageOk = false; return false; }
    }
    _load() { this.state = normalizeSocialState(this._readJSON(STATE_KEY)); }
    _save() { return this._writeJSON(STATE_KEY, this.state); }

    get face() { return this.storageOk ? readSocialFace(this.state) : SOCIAL_FACE.EMPTY; }

    promptBlock() {
        if (!this.storageOk) return '【自主朋友圈读数】存储读不出（不是没设过）';
        return socialPromptBlock(this.state);
    }

    /** 生成侧调用：正文由生成侧给（本件不写文艺句），内核只校验词表与落盘。 */
    post(spec) {
        const r = postToFeed(this.state, spec, Date.now());
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, post: r.post, saved: this._save() };
    }

    like(postId, actor) {
        const r = interactPost(this.state, postId, actor, 'like', '', 0);
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, likes: r.likes, saved: this._save() };
    }

    comment(postId, actor, text) {
        const r = interactPost(this.state, postId, actor, 'comment', text, Date.now());
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, comments: r.comments, saved: this._save() };
    }

    reset() { this.state = defaultSocialState(); return { ok: true, saved: this._save() }; }
    /**
     * [v4.199.0] 换会话：本 App 的读数全是**会话数据**（落盘键按会话隔离），
     * 换会话必须整份重取 —— 与构造走同一条路径（this._load()），
     * 否则 A 会话的『朋友圈台』会原样留在 B 会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this.storageOk = true;
        this._view = null;
        this._load();
    }

    destroy() { this._view = null; }
}

export { SOCIAL_FACE, SOCIAL_REJECT, DAY_PARTS, MOOD_TAGS, ACTIONS, SOCIAL_LIMITS };
export default SocialApp;
