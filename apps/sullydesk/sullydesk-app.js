/* ========================================================
 * sullydesk-app.js — [v3.53.0] SullyOS 治理案头 · 落盘与接线
 * 两条会话键走 ^sd2_ 前缀随会话隔离：sd2_audit 最近审计读数 / sd2_ledger 台账。
 * 源们的 React 组件与宿主存储胶水不缝；本件零依赖零 confirm。
 * ======================================================== */
'use strict';
import {
    SD2_LEDGER_MAX, auditExport, scanSecrets, maskValue, sortGrouped, filterByGroup, buildChips,
    fingerprintOf, refKey, dedupeReferences, trimRows, listOf, toStr, isPlain
} from './sullydesk-data.js';
import { SullydeskView } from './sullydesk-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

export const SD2_AUDIT_KEY = 'sd2_audit';
export const SD2_LEDGER_KEY = 'sd2_ledger';

export class SullydeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'guard';
        this._lastAudit = null;
        this._items = [];
        this._groups = [];
        this._filterId = 'all';
        this._ledger = [];
        this._dropped = 0;
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
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：真 PhoneStorage.set 是 async，
             *   把它的返回值当同步布尔读会让 saved 恒假（见 config/write-receipt.js 头注）。 */
            return writeReceipt(this.storage, key, value);
        } catch (e) {
            return { saved: false, why: 'write_threw' };
        }
    }
    _log(action, detail) {
        const entry = { at: Date.now(), action: toStr(action), detail: toStr(detail) };
        const trimmed = trimRows([entry].concat(this._ledger), SD2_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(SD2_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const a = this._readRaw(SD2_AUDIT_KEY);
        this._lastAudit = (a.ok && a.why === 'present' && isPlain(a.value)) ? a.value : null;
        const g = this._readRaw(SD2_LEDGER_KEY);
        this._ledger = (g.ok && g.why === 'present' && Array.isArray(g.value)) ? g.value : [];
    }
    /* 审计贴回的导出 JSON（源 auditExport + confirm 的案头化：只报不弹）。 */
    auditExportText(rawText, expectSecrets) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json' }; }
        const r = auditExport(parsed, { expectSecrets: expectSecrets === true });
        this._lastAudit = r;
        const w = this._writeRaw(SD2_AUDIT_KEY, r);
        this._log('audit', 'level=' + r.level + ' hits=' + String(r.hits.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, level: r.level, message: r.message, hits: r.hits };
    }
    /* 分组过滤读数。 */
    setRoster(items, groups) {
        this._items = listOf(items);
        this._groups = listOf(groups);
    }
    filterBy(filterId) { this._filterId = toStr(filterId) || 'all'; return filterByGroup(this._items, this._groups, this._filterId); }
    chips() { return buildChips(this._items, this._groups); }
    /* 指纹读数。 */
    fingerprint(text) { return fingerprintOf(text); }
    setTab(tab) { this._tab = toStr(tab) || 'guard'; this.render(); }
    clearLedger() { this._ledger = []; this._writeRaw(SD2_LEDGER_KEY, []); this.render(); }
    onChatChanged() { this._probe(); this._dropped = 0; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new SullydeskView(this);
        this._view.render(this._vm());
    }
    _vm() { return { tab: this._tab, lastAudit: this._lastAudit, items: this._items, groups: this._groups, filterId: this._filterId, chips: this.chips(), ledger: this._ledger, dropped: this._dropped }; }
}