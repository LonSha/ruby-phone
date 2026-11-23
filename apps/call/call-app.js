/* ========================================================
 * call-app.js — [v4.188.0] 情境通话声场 · 控制器
 * 规格照 share / iot 同族：取数 -> 纯函数 -> 视图；落盘走唯一回执实现。
 * 【三处不能有】零网络 / 零定时器 / 不拼叙事（promptBlock 只给 callPromptBlock 的数值）。
 * 会话键走 ^call_scene_ 前缀（与既有 phone_call_ 通话记录分开，不撞车）。
 * ======================================================== */
'use strict';
import {
    CALL_FACE, CALL_REJECT, CALL_SCENES, SIGNAL_LIMITS,
    defaultCallState, normalizeCallState, readCallFace,
    startCall, endCall, setSignal, callPromptBlock,
} from './call-data.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'call_scene_state_v1';

export class CallApp {
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this.state = defaultCallState();
        this.storageOk = true;
        this._view = null;
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

    _load() { this.state = normalizeCallState(this._readJSON(STATE_KEY)); }
    _save() { return this._writeJSON(STATE_KEY, this.state); }

    get face() { return this.storageOk ? readCallFace(this.state) : CALL_FACE.IDLE; }

    promptBlock() {
        if (!this.storageOk) return '【情境通话读数】存储读不出（不是没设过）';
        return callPromptBlock(this.state);
    }

    begin(spec) {
        const r = startCall(this.state, spec, Date.now());
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, saved: this._save() };
    }

    hangup() {
        const r = endCall(this.state, Date.now());
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, ended: r.ended, saved: this._save() };
    }

    signal(bars) {
        const r = setSignal(this.state, bars);
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, note: r.note, saved: this._save() };
    }

    reset() {
        this.state = defaultCallState();
        return { ok: true, saved: this._save() };
    }

    /**
     * [v4.199.0] 换会话：本 App 的读数全是**会话数据**（落盘键按会话隔离），
     * 换会话必须整份重取 —— 与构造走同一条路径（this._load()），
     * 否则 A 会话的『通话状态』会原样留在 B 会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this.storageOk = true;
        this._view = null;
        this._load();
    }

    destroy() { this._view = null; }
}

export { CALL_FACE, CALL_REJECT, CALL_SCENES, SIGNAL_LIMITS };
export default CallApp;
