/* ========================================================
 * lexiscore-app.js — [v3.50.0] 词法评分案头 · 落盘与接线
 * 两条会话键走 ^ls_ 前缀随会话隔离：ls_entries 词条库 / ls_ledger 台账。
 * 源把词条挂 chat.vectorMemory（宿主聊天对象），换角色后旧词条原样留着。
 * 源的嵌入 API 与上下文注入不缝 —— 词条由用户贴回，查询文本本件手输。
 * ======================================================== */
'use strict';
import {
    LS_LEDGER_MAX, trimRows, selectEntries, tokenize, normalizeEntry,
    listOf, toStr, isPlain, numOrNull
} from './lexiscore-data.js';
import { LexiscoreView } from './lexiscore-view.js';

export const LS_ENTRIES_KEY = 'ls_entries';
export const LS_LEDGER_KEY = 'ls_ledger';

export class LexiscoreApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'board';
        this._entries = [];
        this._ledger = [];
        this._dropped = 0;
        this._lastQuery = null;
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
            const wrote = this.storage.set(key, value);
            return { saved: wrote === true, why: wrote === true ? '' : 'set_false' };
        } catch (e) { return { saved: false, why: 'write_threw' }; }
    }
    _nowMs() {
        if (this.shell && typeof this.shell.now === 'function') {
            try { const n = this.shell.now(); if (Number.isFinite(n)) return n; } catch (e) {}
        }
        return Date.now();
    }
    _log(action, detail) {
        const entry = { at: this._nowMs(), action: toStr(action), detail: toStr(detail) };
        const trimmed = trimRows([entry].concat(this._ledger), LS_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(LS_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const e = this._readRaw(LS_ENTRIES_KEY);
        this._entries = (e.ok && e.why === 'present' && Array.isArray(e.value)) ? e.value : [];
        const g = this._readRaw(LS_LEDGER_KEY);
        this._ledger = (g.ok && g.why === 'present' && Array.isArray(g.value)) ? g.value : [];
    }
    intakeEntries(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e2) { this._log('intake_entries', 'why=bad_json'); return { ok: false, why: 'bad_json', saved: false }; }
        const arr = Array.isArray(parsed) ? parsed : ((isPlain(parsed) && Array.isArray(parsed.entries)) ? parsed.entries : null);
        if (!arr) { this._log('intake_entries', 'why=bad_shape'); return { ok: false, why: 'bad_shape', saved: false }; }
        const norm = arr.map(normalizeEntry).filter(function (x) { return x.entry; });
        const existing = {};
        for (const e of this._entries) existing[e.id] = true;
        const fresh = norm.filter(function (x) { return !existing[x.entry.id]; });
        this._entries = this._entries.concat(fresh.map(function (x) { return x.entry; }));
        const w = this._writeRaw(LS_ENTRIES_KEY, this._entries);
        this._log('intake_entries', 'added=' + String(fresh.length) + ' total=' + String(this._entries.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, added: fresh.length, total: this._entries.length };
    }
    /* 查询：词法兜底选取，只报不写。 */
    query(queryText, opts) {
        const rows = selectEntries(this._entries, queryText, opts || {});
        this._lastQuery = { text: toStr(queryText), tokens: tokenize(queryText).length, hits: rows.length };
        this._log('query', 'tokens=' + String(this._lastQuery.tokens) + ' hits=' + String(rows.length));
        return { ok: true, rows: rows };
    }
    readings() { return { entries: this._entries.length, ledger: this._ledger.length, dropped: this._dropped }; }
    setTab(tab) { this._tab = toStr(tab) || 'board'; this.render(); }
    clearEntries() { this._entries = []; this._writeRaw(LS_ENTRIES_KEY, []); this._log('clear_entries', ''); this.render(); }
    clearLedger() { this._ledger = []; this._writeRaw(LS_LEDGER_KEY, []); this.render(); }
    onChatChanged() { this._probe(); this._dropped = 0; this._lastQuery = null; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new LexiscoreView(this);
        this._view.render(this._vm());
    }
    _vm() {
        return { tab: this._tab, entries: this._entries, lastQuery: this._lastQuery, readings: this.readings(), ledger: this._ledger, dropped: this._dropped };
    }
}