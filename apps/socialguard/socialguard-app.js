/* ========================================================
 * socialguard-app.js — [v3.50.0] 熟人可见性案头 · 落盘与接线
 *
 * 四条会话键（走 ^sg_ 前缀随会话隔离）：
 *   sg_posts —— 帖子库（归一后整库）；sg_contacts —— 人脉册；
 *   sg_settings —— 三格设置（互动可见档 / 阅看模式 / 名字口径）；
 *   sg_ledger —— 动作台账。源把这一切挂 db.moments 宿主大对象，换角色一起串味；
 *   换会话四格全量重取，清各面只清自己那条键。
 * ======================================================== */
'use strict';
import {
    SG_LEDGER_MAX, trimRows, normalizePostStore, normalizeContact, mirrorContacts,
    visibleTo, canSeeInteraction, contactsFor, markSeen, mayInteractWith, filterNotifications, feedOf, historySummary,
    deleteGuard, commentGuard, readingsOf, isStoryAlive, seenAtOf,
    isPlain, listOf, toStr, numOrNull, deepClone, charActor, charIdOfActor
} from './socialguard-data.js';
import { SocialguardView } from './socialguard-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

export const SG_POSTS_KEY = 'sg_posts';
export const SG_CONTACTS_KEY = 'sg_contacts';
export const SG_SETTINGS_KEY = 'sg_settings';
export const SG_LEDGER_KEY = 'sg_ledger';

const FACE_OK = 'ok';
const FACE_EMPTY = 'empty';
const FACE_ABSENT = 'absent';

export class SocialguardApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'board';
        this._posts = [];
        this._contacts = [];
        this._settings = {};
        this._ledger = [];
        this._dropped = 0;
        this._face = FACE_ABSENT;
        this._why = '';
        this._now = 0;
    }
    _storageUsable() {
        if (!this.storage) return { ok: false, why: 'no_storage' };
        if (typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') return { ok: false, why: 'no_api' };
        return { ok: true, why: '' };
    }
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        let v;
        try { v = this.storage.get(key, undefined); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }
    _writeRaw(key, value) {
        const gate = this._storageUsable();
        if (!gate.ok) return { saved: false, why: gate.why };
        try {
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：真 PhoneStorage.set 是 async，
             *   把它的返回值当同步布尔读会让 saved 恒假（见 config/write-receipt.js 头注）。 */
            return writeReceipt(this.storage, key, value);
        } catch (e) {
            return { saved: false, why: 'write_threw' };
        }
    }
    _probe() {
        const p = this._readRaw(SG_POSTS_KEY);
        const store = (p.ok && p.why === 'present' && isPlain(p.value)) ? p.value : null;
        const norm = normalizePostStore(store || []);
        this._posts = norm.posts;
        this._storeNotes = norm.notes;
        const c = this._readRaw(SG_CONTACTS_KEY);
        const rawC = (c.ok && c.why === 'present' && isPlain(c.value) && Array.isArray(c.value.contacts)) ? c.value.contacts : ((c.ok && c.why === 'present' && Array.isArray(c.value)) ? c.value : []);
        this._contacts = mirrorContacts(listOf(rawC).map(normalizeContact).map(function (x) { return x.contact; }));
        const st = this._readRaw(SG_SETTINGS_KEY);
        this._settings = (st.ok && st.why === 'present' && isPlain(st.value)) ? st.value : {};
        const g = this._readRaw(SG_LEDGER_KEY);
        this._ledger = (g.ok && g.why === 'present' && Array.isArray(g.value)) ? g.value : [];
    }
    _nowMs() {
        if (this.shell && typeof this.shell.now === 'function') {
            try { const n = this.shell.now(); if (Number.isFinite(n)) return n; } catch (e) {}
        }
        return Date.now();
    }
    _log(action, detail) {
        const entry = { at: this._nowMs(), action: toStr(action), detail: toStr(detail) };
        const trimmed = trimRows([entry].concat(this._ledger), SG_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(SG_LEDGER_KEY, this._ledger);
    }    intakePosts(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { this._log('intake_posts', 'why=bad_json'); return { ok: false, why: 'bad_json', saved: false }; }
        const norm = normalizePostStore(parsed);
        this._posts = norm.posts;
        const w = this._writeRaw(SG_POSTS_KEY, { posts: this._posts });
        this._log('intake_posts', 'posts=' + String(this._posts.length) + ' rejected=' + String(norm.rejected.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, posts: this._posts.length, rejected: norm.rejected, notes: norm.notes };
    }
    intakeContacts(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { this._log('intake_contacts', 'why=bad_json'); return { ok: false, why: 'bad_json', saved: false }; }
        const arr = (isPlain(parsed) && Array.isArray(parsed.contacts)) ? parsed.contacts : (Array.isArray(parsed) ? parsed : null);
        if (!arr) { this._log('intake_contacts', 'why=bad_shape'); return { ok: false, why: 'bad_shape', saved: false }; }
        this._contacts = mirrorContacts(arr.map(normalizeContact).map(function (x) { return x.contact; }));
        const w = this._writeRaw(SG_CONTACTS_KEY, { contacts: this._contacts });
        this._log('intake_contacts', 'contacts=' + String(this._contacts.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, contacts: this._contacts.length };
    }
    /* 判定面：帖子对谁能见 / 看过没 / 能不能互动 / 互动流谁可见 —— 只报不写。 */
    checkPost(postId, viewerId, actorId, interactionPersonaId, viewerPersonaId) {
        const post = this._posts.find(function (p) { return p && p.id === postId; });
        if (!post) return { ok: false, why: 'not_found', visibleTo: false, seen: false, mayInteract: false };
        const vis = visibleTo(post, viewerId);
        const seen = isPlain(post.seenBy) && seenAtOf(post.seenBy[viewerId]) !== null;
        const inter = mayInteractWith(post, actorId || viewerId);
        const interVis = canSeeInteraction(post, viewerId, actorId || viewerId, interactionPersonaId || '', viewerPersonaId || '', this._settings);
        const mirror = contactsFor(this._contacts, charIdOfActor(viewerId));
        return { ok: true, why: '', visibleTo: vis, seen: seen, mayInteract: inter.ok, interactWhy: inter.why, interactionVisible: interVis, myCircle: mirror.length };
    }
    /* 收看：某 actor 对某帖的首看记账落库（互动门要查的知情账）。 */
    applySeen(postId, actorId) {
        const idx = this._posts.findIndex(function (p) { return p && p.id === postId; });
        if (idx < 0) { this._log('seen', 'why=not_found'); return { ok: false, why: 'not_found', saved: false }; }
        const r = markSeen(this._posts[idx], actorId, this._nowMs());
        if (!r.ok) { this._log('seen', 'why=' + r.why); return { ok: false, why: r.why, saved: false }; }
        this._posts[idx].seenBy = r.seenBy;
        const w = this._writeRaw(SG_POSTS_KEY, { posts: this._posts });
        this._log('seen', 'post=' + postId + ' actor=' + actorId + ' first=' + String(r.firstView) + ' saved=' + String(w.saved === true));
        return { ok: true, why: '', firstView: r.firstView, saved: w.saved };
    }
    /* 通知清理（源通知过滤的案头化：只报 dropped，源直接改库）。 */
    cleanNotifications() {
        this._log('clean_notifications', 'checked=1');
        return { ok: true };
    }
    deletePost(postId, actorId) {
        const post = this._posts.find(function (p) { return p && p.id === postId; });
        const g = deleteGuard(post, actorId);
        if (!g.ok) { this._log('delete', 'why=' + g.why); return { ok: false, why: g.why, saved: false }; }
        this._posts = this._posts.filter(function (p) { return p.id !== postId; });
        const w = this._writeRaw(SG_POSTS_KEY, { posts: this._posts });
        this._log('delete', 'post=' + postId + ' saved=' + String(w.saved === true));
        return { ok: true, why: '', saved: w.saved };
    }
    feed() { return feedOf(this._posts, this._nowMs()); }
    summaryFor(actorId) { return historySummary(this._posts, actorId, null); }
    readings() { return readingsOf(this._posts, this._contacts, this._nowMs()); }
    setTab(tab) { this._tab = toStr(tab) || 'board'; this.render(); }
    clearPosts() { this._posts = []; this._writeRaw(SG_POSTS_KEY, { posts: [] }); this._log('clear_posts', ''); this.render(); }
    clearContacts() { this._contacts = []; this._writeRaw(SG_CONTACTS_KEY, { contacts: [] }); this._log('clear_contacts', ''); this.render(); }
    clearLedger() { this._ledger = []; this._writeRaw(SG_LEDGER_KEY, []); this.render(); }
    onChatChanged() { this._probe(); this._face = 'absent'; this._dropped = 0; this.render(); }
    _refresh() {
        this._probe();
        this._now = this._nowMs();
        this._face = this._posts.length ? 'ok' : 'empty';
    }
    render() {
        this._refresh();
        if (!this._view) this._view = new SocialguardView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const postsFeed = this.feed();
        return {
            tab: this._tab,
            face: this._face,
            posts: postsFeed.posts,
            stories: postsFeed.stories,
            mine: postsFeed.mine,
            contacts: this._contacts,
            readings: this.readings(),
            ledger: this._ledger,
            dropped: this._dropped,
            why: this._why
        };
    }
}