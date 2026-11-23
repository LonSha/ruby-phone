/* ========================================================
 * keyboard-app.js — [v4.188.0] 像素键盘 · 控制器
 * 零网络 / 零定时器 / 注入只给候选计数。会话键走 ^ime_ 前缀。
 * ======================================================== */
'use strict';
import {
    KB_FACE, KB_REJECT, DEFAULT_SLANGS, KB_LIMITS, IME_DRAFT_KEY,
    normalizeProfile, readKbFace, predictCandidates, checkDraft, kbPromptBlock,
} from './keyboard-data.js';
import { writeReceipt } from '../../config/write-receipt.js';

const PROFILE_KEY = 'ime_profile_v1';
const DRAFT_KEY = IME_DRAFT_KEY;

export class KeyboardApp {
    constructor(shell, storage) {
        this.shell = shell; this.storage = storage;
        this.profile = { slangs: DEFAULT_SLANGS.slice() };
        this.draft = '';
        this.lastCandidates = [];
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
    _load() {
        const pr = this._readJSON(PROFILE_KEY);
        if (pr && Array.isArray(pr.slangs)) {
            const n = normalizeProfile(pr);
            if (n.ok) this.profile = { slangs: n.slangs };
        }
        const dr = this._readJSON(DRAFT_KEY);
        if (typeof dr === 'string') this.draft = dr;
    }
    _saveProfile() { return this._writeJSON(PROFILE_KEY, this.profile); }
    _saveDraft() { return this._writeJSON(DRAFT_KEY, this.draft); }

    get face() {
        return this.storageOk ? readKbFace(this.lastCandidates) : KB_FACE.EMPTY;
    }
    promptBlock() {
        if (!this.storageOk) return '【输入法读数】存储读不出（不是没设过）';
        return kbPromptBlock(this.lastCandidates, this.profile);
    }

    /** 联想：候选不进盘（每次算就行），只把结果留在内存供界面/注入读。 */
    predict(prefix) {
        const r = predictCandidates(prefix, this.profile);
        this.lastCandidates = r.ok ? r.candidates : [];
        return r;
    }

    /** 加一条口癖：重复不加、超长拒。 */
    addSlang(s) {
        if (typeof s !== 'string' || !s.trim()) return { ok: false, reason: KB_REJECT.notString };
        if (this.profile.slangs.indexOf(s) >= 0) return { ok: false, reason: KB_REJECT.notArray };
        if (this.profile.slangs.length >= KB_LIMITS.maxProfile) return { ok: false, reason: KB_REJECT.tooLong };
        this.profile = { slangs: this.profile.slangs.concat([s]) };
        return { ok: true, reason: null, saved: this._saveProfile() };
    }

    removeSlang(s) {
        this.profile = { slangs: this.profile.slangs.filter((x) => x !== s) };
        return { ok: true, reason: null, saved: this._saveProfile() };
    }

    /** 存草稿：超长拒收。 */
    saveDraft(text) {
        const c = checkDraft(text);
        if (!c.ok) return c;
        this.draft = c.text;
        return { ok: true, reason: null, saved: this._saveDraft() };
    }

    clearDraft() { this.draft = ''; return { ok: true, saved: this._saveDraft() }; }

    reset() {
        this.profile = { slangs: DEFAULT_SLANGS.slice() };
        this.draft = ''; this.lastCandidates = [];
        this._saveProfile(); this._saveDraft();
        return { ok: true };
    }
    /**
     * [v4.199.0] 换会话：本 App 的读数全是**会话数据**（落盘键按会话隔离），
     * 换会话必须整份重取 —— 与构造走同一条路径（this._load()），
     * 否则 A 会话的『口癖与草稿』会原样留在 B 会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this.profile = { slangs: DEFAULT_SLANGS.slice() };
        this.draft = '';
        this.lastCandidates = [];
        this.storageOk = true;
        this._view = null;
        this._load();
    }

    destroy() { this._view = null; }
}

export { KB_FACE, KB_REJECT, DEFAULT_SLANGS, KB_LIMITS, IME_DRAFT_KEY };
export default KeyboardApp;
