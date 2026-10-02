/* ========================================================
 * annidate-app.js — [v3.51.0] 纪念日数学案头 · 落盘与接线
 * 两条会话键走 ^ad_ 前缀随会话隔离：ad_items 条目册 / ad_alerts 预警幂等。
 * 源挂 IndexedDB + DOM 轮播 + 图片上传（出图面）全不缝。
 * ======================================================== */
'use strict';
import {
    normalizeItems, matchReminders, alertOnce, readingsOf, daysOf, zodiacOf, listOf, toStr, isPlain, dayStartOf
} from './annidate-data.js';
import { AnnidateView } from './annidate-view.js';

export const AD_ITEMS_KEY = 'ad_items';
export const AD_ALERTS_KEY = 'ad_alerts';

export class AnnidateApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._items = [];
        this._lastAlert = null;
        this._lastMatches = null;
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
        const e = this._readRaw(AD_ITEMS_KEY);
        const norm = normalizeItems((e.ok && e.why === 'present' && Array.isArray(e.value)) ? e.value : []);
        this._items = norm.items;
    }
    intakeItems(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json', saved: false }; }
        const norm = normalizeItems(Array.isArray(parsed) ? parsed : (isPlain(parsed) && Array.isArray(parsed.items)) ? parsed.items : null);
        this._items = norm.items;
        const w = this._writeRaw(AD_ITEMS_KEY, this._items);
        return { ok: true, saved: w.saved, items: this._items.length, rejected: norm.rejected };
    }
    /* 当日四类提醒判定 + 幂等（源 checkNotifications 的案头化：只报不弹）。 */
    checkAlerts() {
        const now = this._nowMs();
        const matches = [];
        for (const it of this._items) {
            for (const m of matchReminders(it, now)) matches.push({ id: it.id, title: it.title, kind: m.kind, years: m.years, text: m.text });
        }
        const lastKey = this._readRaw(AD_ALERTS_KEY);
        const lastVal = (lastKey.ok && lastKey.why === 'present' && isPlain(lastKey.value)) ? toStr(lastKey.value.dayKey) : '';
        const dayKey = String(Math.floor(dayStartOf(now) / 86400000));
        const gate = alertOnce(matches, dayKey, lastVal);
        if (gate.alert) this._writeRaw(AD_ALERTS_KEY, { dayKey: gate.key });
        this._lastMatches = matches;
        this._lastAlert = gate;
        return { matches: matches, alert: gate.alert, why: gate.why };
    }
    readings() { return readingsOf(this._items, this._nowMs()); }
    clearAll() { this._items = []; this._writeRaw(AD_ITEMS_KEY, []); }
    onChatChanged() { this._probe(); this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new AnnidateView(this);
        this._view.render(this._vm());
    }
    _vm() { return { items: this._items, lastAlert: this._lastAlert, lastMatches: this._lastMatches, readings: this.readings() }; }
}