/* ========================================================
 * daily-app.js — [v4.188.0] 跨 App 生活事件 · 控制器
 * 零网络 / 零定时器 / 注入只给计数。会话键走 ^daily_ 前缀。
 * ======================================================== */
'use strict';
import {
    DAILY_FACE, DAILY_REJECT, LIFE_RULES, LIFE_APPS, EVENT_TYPES, DAILY_LIMITS,
    defaultDailyState, normalizeDailyState, readDailyFace,
    triggerRule, dailyPromptBlock,
} from './daily-data.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'daily_fabric_v1';

export class DailyApp {
    constructor(shell, storage) {
        this.shell = shell; this.storage = storage;
        this.state = defaultDailyState();
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
    _load() { this.state = normalizeDailyState(this._readJSON(STATE_KEY)); }
    _save() { return this._writeJSON(STATE_KEY, this.state); }

    get face() { return this.storageOk ? readDailyFace(this.state) : DAILY_FACE.EMPTY; }
    promptBlock() {
        if (!this.storageOk) return '【跨App事件读数】存储读不出（不是没设过）';
        return dailyPromptBlock(this.state);
    }

    /** 手动触发一条规则：正文由调用方给，内核只判规则、判命中、记账。 */
    fire(ruleId, text) {
        const at = Date.now();
        const r = triggerRule(this.state, ruleId, text, at, 'evt_' + at + '_' + ruleId);
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, event: r.event, saved: this._save() };
    }

    reset() { this.state = defaultDailyState(); return { ok: true, saved: this._save() }; }
    /**
     * [v4.199.0] 换会话：本 App 的读数全是**会话数据**（落盘键按会话隔离），
     * 换会话必须整份重取 —— 与构造走同一条路径（this._load()），
     * 否则 A 会话的『生活织机』会原样留在 B 会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this.storageOk = true;
        this._view = null;
        this._load();
    }

    destroy() { this._view = null; }
}

export { DAILY_FACE, DAILY_REJECT, LIFE_RULES, LIFE_APPS, EVENT_TYPES, DAILY_LIMITS };
export default DailyApp;
