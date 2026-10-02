/* ========================================================
 * periodmath-app.js — [v3.51.0] 周期数学案头 · 落盘与接线
 * 两条会话键走 ^pm_ 前缀随会话隔离：pm_cycles 周期记录 / pm_settings 设置。
 * 源挂 IndexedDB（PhoneSimPeriod）换角色串味；AI 建议生成不缝。
 * ======================================================== */
'use strict';
import {
    normalizeCycles, averagesOf, statusOf, alertGate, dayKeyOf, readingsOf, isPlain, listOf, toStr, numOrNull
} from './periodmath-data.js';
import { PeriodmathView } from './periodmath-view.js';

export const PM_CYCLES_KEY = 'pm_cycles';
export const PM_SETTINGS_KEY = 'pm_settings';

export class PeriodmathApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._cycles = [];
        this._settings = {};
        this._lastIntake = null;
        this._lastAlert = null;
    }
    _readRaw(key) {
        if (!this.storage || typeof this.storage.get !== 'function') return { ok: false, why: 'no_api', value: undefined };
        let v;
        try { v = this.storage.get(key, undefined); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }
    _writeRaw(key, value) {
        if (!this.storage || typeof this.storage.set !== 'function') return { saved: false, why: 'no_api' };
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
    _probe() {
        const c = this._readRaw(PM_CYCLES_KEY);
        const norm = normalizeCycles((c.ok && c.why === 'present' && Array.isArray(c.value)) ? c.value : []);
        this._cycles = norm.cycles;
        const st = this._readRaw(PM_SETTINGS_KEY);
        this._settings = (st.ok && st.why === 'present' && isPlain(st.value)) ? st.value : {};
    }
    intakeCycles(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json', saved: false }; }
        const norm = normalizeCycles(Array.isArray(parsed) ? parsed : (isPlain(parsed) && Array.isArray(parsed.cycles)) ? parsed.cycles : null);
        this._cycles = norm.cycles;
        const w = this._writeRaw(PM_CYCLES_KEY, this._cycles);
        this._lastIntake = { cycles: this._cycles.length, rejected: norm.rejected };
        return { ok: true, saved: w.saved, cycles: this._cycles.length, rejected: norm.rejected };
    }
    /* 切换经期（源 togglePeriod）：无 end 的记录补 end=今天；否则新开一条 start=今天。 */
    togglePeriod() {
        const now = this._nowMs();
        const latest = this._cycles[0];
        let changed = '';
        if (latest && latest.end === null) {
            latest.end = now; changed = 'end=' + String(now);
        } else {
            this._cycles.unshift({ id: 'pm_c_' + String(now), start: now, end: null, symptoms: [] });
            changed = 'start=' + String(now);
        }
        const w = this._writeRaw(PM_CYCLES_KEY, this._cycles);
        return { ok: true, saved: w.saved, changed: changed };
    }
    /* 预警：幂等键存设置里（lastAlertKey），当日不重警。 */
    checkAlert() {
        const now = this._nowMs();
        const avg = averagesOf(this._cycles, this._settings);
        const st = statusOf(this._cycles, { cycleLength: avg.cycleLength, periodLength: avg.periodLength }, now);
        const gate = alertGate(st, now, this._settings.lastAlertKey || '');
        if (gate.alert) { this._settings.lastAlertKey = gate.key; this._writeRaw(PM_SETTINGS_KEY, this._settings); }
        this._lastAlert = { status: st, alert: gate.alert, why: gate.why };
        return this._lastAlert;
    }
    readings() { return readingsOf(this._cycles, this._settings, this._nowMs()); }
    clearAll() { this._cycles = []; this._writeRaw(PM_CYCLES_KEY, []); this._settings = {}; this._writeRaw(PM_SETTINGS_KEY, {}); }
    onChatChanged() { this._probe(); this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new PeriodmathView(this);
        this._view.render(this._vm());
    }
    _vm() { return { cycles: this._cycles, settings: this._settings, lastIntake: this._lastIntake, lastAlert: this._lastAlert, readings: this.readings() }; }
}