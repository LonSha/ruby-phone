/* ========================================================
 * freehome-app.js — [v3.50.0] 自由桌面布局案头 · 落盘与接线
 * 两条会话键走 ^fh_ 前缀随会话隔离：fh_layout 布局本体 / fh_ledger 台账。
 * 源把布局挂 db.freeHomeLayout 宿主大对象，换角色后旧布局原样留着。
 * 源的拖拽手势 / 指针画布 / 底部抽屉（DOM 演出面）一律不缝。
 * ======================================================== */
'use strict';
import {
    FH_LEDGER_MAX, trimRows, layoutProblems, normalizeLayout, readingsOf, listOf, toStr, isPlain
} from './freehome-data.js';
import { FreehomeView } from './freehome-view.js';

export const FH_LAYOUT_KEY = 'fh_layout';
export const FH_LEDGER_KEY = 'fh_ledger';

export class FreehomeApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'board';
        this._layout = null;
        this._ledger = [];
        this._dropped = 0;
        this._lastProblems = [];
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
        const trimmed = trimRows([entry].concat(this._ledger), FH_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(FH_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const l = this._readRaw(FH_LAYOUT_KEY);
        this._layout = (l.ok && l.why === 'present' && isPlain(l.value)) ? l.value : null;
        const g = this._readRaw(FH_LEDGER_KEY);
        this._ledger = (g.ok && g.why === 'present' && Array.isArray(g.value)) ? g.value : [];
    }
    /* 收布局：先归一（护栏裁边报 dropped），再跑校验逐因报问题，收下后落盘。 */
    intakeLayout(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { this._log('intake_layout', 'why=bad_json'); return { ok: false, why: 'bad_json', saved: false }; }
        const norm = normalizeLayout(parsed);
        if (!norm.layout) { this._log('intake_layout', 'why=bad_shape'); return { ok: false, why: 'bad_shape', saved: false }; }
        this._layout = norm.layout;
        this._lastProblems = layoutProblems(this._layout, {});
        const w = this._writeRaw(FH_LAYOUT_KEY, this._layout);
        this._log('intake_layout', 'pages=' + String(this._layout.pages.length) + ' problems=' + String(this._lastProblems.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, problems: this._lastProblems, notes: norm.notes };
    }
    audit() { this._lastProblems = this._layout ? layoutProblems(this._layout, {}) : ['bad_shape']; return this._lastProblems; }
    readings() { return readingsOf(this._layout, null); }
    setTab(tab) { this._tab = toStr(tab) || 'board'; this.render(); }
    clearLayout() { this._layout = null; this._writeRaw(FH_LAYOUT_KEY, null); this._log('clear_layout', ''); this.render(); }
    clearLedger() { this._ledger = []; this._writeRaw(FH_LEDGER_KEY, []); this.render(); }
    onChatChanged() { this._probe(); this._dropped = 0; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new FreehomeView(this);
        this._view.render(this._vm());
    }
    _vm() {
        return { tab: this._tab, layout: this._layout, problems: this._lastProblems, readings: this.readings(), ledger: this._ledger, dropped: this._dropped };
    }
}