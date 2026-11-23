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
    destroy() { this._view = null; }
}

export { DAILY_FACE, DAILY_REJECT, LIFE_RULES, LIFE_APPS, EVENT_TYPES, DAILY_LIMITS };
export default DailyApp;
