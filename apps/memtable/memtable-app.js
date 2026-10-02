/* ========================================================
 * memtable-app.js — [v3.49.0] 结构化记忆案头 · 落盘与接线
 *
 * 数据层：memtable-data.js（纯函数内核）  视图层：memtable-view.js
 *
 * ── 三条会话键 ──────────────────────────────────────────
 *   · memtable_templates —— 模板库（贴回来的模板 JSON 归一后的库）；
 *   · memtable_data      —— 按模板落的数据（keyValue 值 / rows 行）；
 *   · memtable_xml       —— 最近贴回来的更新包原文 + 收下时刻；
 *   · memtable_ledger    —— 动作台账。
 *   ★ 为什么分开：源把模板、数据、历史、游标全挂宿主大对象 —— 换角色一起串味。
 * ======================================================== */
'use strict';
import {
    MT_INTAKE_WHYS, MT_APPLY_CODES, MT_STRATEGIES, MT_FACES, MT_LEDGER_MAX, MT_TEXT_MAX,
    isPlain, hasKey, numOrNull, listOf, toStr, trimRows,
    normalizeTemplateStore, isRowsTable,
    planFromXml, applyPlan, pushHistory, readingsOf, faceOf, limitsOf,
    templateDefinitionText, fieldHistorySeries, displayValue, autoUpdateCursorReadings,
    findTemplate, findTable, findField, caps
} from './memtable-data.js';
import { MemtableView } from './memtable-view.js';

export const MT_TEMPLATES_KEY = 'memtable_templates';
export const MT_DATA_KEY = 'memtable_data';
export const MT_XML_KEY = 'memtable_xml';
export const MT_LEDGER_KEY = 'memtable_ledger';

const FACE_OK = MT_FACES[0];
const FACE_EMPTY = MT_FACES[1];
const FACE_MALFORMED = MT_FACES[2];
const FACE_ABSENT = MT_FACES[3];
const FACE_TEXT = Object.freeze({
    [FACE_OK]: '已收下',
    [FACE_EMPTY]: '还没收过',
    [FACE_MALFORMED]: '收下的东西读不懂',
    [FACE_ABSENT]: '还没看过一眼'
});
const FACE_TONE = Object.freeze({ [FACE_OK]: 'ok', [FACE_EMPTY]: 'warn', [FACE_MALFORMED]: 'err', [FACE_ABSENT]: 'off' });
const DASH = '--';
const INTAKE_WHY_TEXT = Object.freeze({
    [MT_INTAKE_WHYS[0]]: '什么都没贴',
    [MT_INTAKE_WHYS[1]]: '贴进来的原文超过上限（只报，不截）',
    [MT_INTAKE_WHYS[2]]: '贴进来的东西解不出更新结构',
    [MT_INTAKE_WHYS[3]]: 'XML 结构性损坏（标签不配平 / 引号不闭合）',
    [MT_INTAKE_WHYS[4]]: '解出来了，但一条 memory_update 都没有',
    [MT_INTAKE_WHYS[5]]: '模板库超上限（只报，不截）'
});
const APPLY_CODE_TEXT = Object.freeze({
    [MT_APPLY_CODES[0]]: '收下',
    [MT_APPLY_CODES[1]]: '跳过：新旧一样',
    [MT_APPLY_CODES[2]]: '拒收：字段锁定或禁编',
    [MT_APPLY_CODES[3]]: '拒收：只填空且旧值非空',
    [MT_APPLY_CODES[4]]: '拒收：模板认不出',
    [MT_APPLY_CODES[5]]: '拒收：表认不出',
    [MT_APPLY_CODES[6]]: '拒收：字段认不出',
    [MT_APPLY_CODES[7]]: '拒收：行认不出',
    [MT_APPLY_CODES[8]]: '拒收：行数超上限',
    [MT_APPLY_CODES[9]]: '拒收：新增行一个可收字段都没有'
});

function stampOf(ms) {
    const n = numOrNull(ms);
    if (n === null || n <= 0) return DASH;
    const d = new Date(n);
    if (!isFinite(d.getTime())) return DASH;
    const pad = function (v) { return (v < 10 ? '0' : '') + v; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export class MemtableApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'board';
        this._templates = [];
        this._data = {};
        this._locked = {};
        this._history = [];
        this._xml = '';
        this._xmlAt = 0;
        this._ledger = [];
        this._dropped = 0;
        this._strategy = MT_STRATEGIES[0];
        this._face = FACE_ABSENT;
        this._why = '';
        this._plan = null;
        this._readings = null;
        this._now = 0;
        this._msgCount = 0;
        this._cursorIndex = -1;
        this._interval = 100;
    }
    _storageUsable() {
        if (!this.storage) return { ok: false, why: 'no_storage' };
        if (typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, why: 'no_api' };
        }
        return { ok: true, why: '' };
    }
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        let v = null;
        try { v = this.storage.get(key, null); }
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
        } catch (e) {
            return { saved: false, why: 'write_threw' };
        }
    }
    _probe() {
        const t = this._readRaw(MT_TEMPLATES_KEY);
        this._templates = (t.ok && t.why === 'present' && Array.isArray(t.value)) ? t.value : [];
        const d = this._readRaw(MT_DATA_KEY);
        this._data = (d.ok && d.why === 'present' && isPlain(d.value)) ? d.value : {};
        const x = this._readRaw(MT_XML_KEY);
        if (x.ok && x.why === 'present' && isPlain(x.value)) {
            this._xml = toStr(x.value.text);
            this._xmlAt = numOrNull(x.value.at) || 0;
        } else { this._xml = ''; this._xmlAt = 0; }
        const g = this._readRaw(MT_LEDGER_KEY);
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
        const trimmed = trimRows([entry].concat(this._ledger), MT_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(MT_LEDGER_KEY, this._ledger);
    }
    intakeTemplates(rawText) {
        const text = toStr(rawText);
        if (text.trim() === '') { this._log('intake_templates', 'why=' + MT_INTAKE_WHYS[0]); return { ok: false, why: MT_INTAKE_WHYS[0] }; }
        if (text.length > MT_TEXT_MAX) { this._log('intake_templates', 'why=' + MT_INTAKE_WHYS[1]); return { ok: false, why: MT_INTAKE_WHYS[1] }; }
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { this._log('intake_templates', 'why=bad_json'); return { ok: false, why: 'bad_json' }; }
        const norm = normalizeTemplateStore(parsed);
        this._templates = norm.templates;
        const wT = this._writeRaw(MT_TEMPLATES_KEY, this._templates);
        this._log('intake_templates', 'templates=' + String(this._templates.length) + ' rejected=' + String(norm.rejected.length) + ' saved=' + String(wT.saved === true));
        return { ok: true, saved: wT.saved, templates: this._templates.length, rejected: norm.rejected, notes: norm.notes };
    }
    intakeXml(rawText) {
        const text = toStr(rawText);
        const plan = planFromXml(text, this._templates, this._data, this._locked, this._strategy);
        this._xml = text;
        this._xmlAt = this._nowMs();
        const wX = this._writeRaw(MT_XML_KEY, { text: text, at: this._xmlAt });
        this._savedXml = wX.saved;
        this._plan = plan;
        this._face = faceOf(text, plan);
        this._why = plan.intakeWhy || '';
        this._log('intake_xml', 'updates=' + String(plan.updateCount) + ' plans=' + String(plan.plans.length) + ' errors=' + String(plan.errors.length) + ' saved=' + String(this._savedXml === true) + (plan.intakeWhy ? ' why=' + plan.intakeWhy : ''));
        plan.saved = this._savedXml;
        return plan;
    }
    applyUpdates() {
        if (!this._plan || this._plan.intakeWhy) return { ok: false, why: this._why || 'no_plan' };
        const applied = applyPlan(this._templates, this._data, this._plan);
        this._data = applied.data;
        const wD = this._writeRaw(MT_DATA_KEY, this._data);
        const h = pushHistory(this._history, this._data, applied.changed, 'xml', this._nowMs());
        this._history = h.history;
        if (h.dropped > 0) this._log('history_trim', 'dropped=' + String(h.dropped));
        this._log('apply_xml', 'set=' + String(applied.changed.length));
        return { ok: true, saved: wD.saved, changed: applied.changed.length };
    }
    _refresh() {
        this._probe();
        this._now = this._nowMs();
        this._readings = readingsOf(this._templates, this._data, this._locked, this._history);
        if (this._xml) {
            const plan = this._plan || planFromXml(this._xml, this._templates, this._data, this._locked, this._strategy);
            this._face = faceOf(this._xml, plan);
            this._why = plan.intakeWhy || '';
        } else {
            this._face = FACE_ABSENT;
            this._why = '';
        }
    }
    render() {
        this._refresh();
        if (!this._view) this._view = new MemtableView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const limits = limitsOf(this._templates, this._history);
        const cursor = autoUpdateCursorReadings(this._msgCount, this._cursorIndex, this._interval);
        return {
            tab: this._tab,
            face: this._face,
            faceText: FACE_TEXT[this._face] || DASH,
            faceTone: FACE_TONE[this._face] || 'off',
            whyText: this._why ? (INTAKE_WHY_TEXT[this._why] || this._why) : '',
            readings: this._readings,
            limits: limits,
            cursor: cursor,
            xml: this._xml,
            xmlAt: stampOf(this._xmlAt),
            plan: this._plan,
            codeText: APPLY_CODE_TEXT,
            templates: this._templates,
            data: this._data,
            history: this._history,
            ledger: this._ledger,
            dropped: this._dropped,
            definitionText: templateDefinitionText(this._templates, this._data, this._locked),
            displayValue: displayValue,
            findTemplate: findTemplate,
            findTable: findTable,
            isRowsTable: isRowsTable,
            strategies: MT_STRATEGIES,
            strategy: this._strategy,
            stampOf: stampOf
        };
    }
    setTab(tab) { this._tab = toStr(tab) || 'board'; this.render(); }
    setStrategy(s) { this._strategy = (MT_STRATEGIES.indexOf(s) >= 0) ? s : MT_STRATEGIES[0]; this.render(); }
    onIntakeTemplates(text) { const r = this.intakeTemplates(text); this.render(); return r; }
    onIntakeXml(text) { const r = this.intakeXml(text); this.render(); return r; }
    onApply() { const r = this.applyUpdates(); this.render(); return r; }
    clearTemplates() { this._templates = []; this._writeRaw(MT_TEMPLATES_KEY, []); this._log('clear_templates', ''); this.render(); }
    clearData() { this._data = {}; this._writeRaw(MT_DATA_KEY, {}); this._log('clear_data', ''); this.render(); }
    clearXml() { this._xml = ''; this._xmlAt = 0; this._plan = null; this._writeRaw(MT_XML_KEY, null); this._log('clear_xml', ''); this.render(); }
    clearLedger() { this._ledger = []; this._writeRaw(MT_LEDGER_KEY, []); this.render(); }
    onChatChanged() { this._plan = null; this._dropped = 0; this.render(); }
    historySeries(templateId, tableId, fieldId, currentValue) {
        return fieldHistorySeries(this._history, templateId, tableId, fieldId, currentValue);
    }
    fieldHistoryOf(templateId, tableId, fieldId) {
        const t = findTemplate(this._templates, templateId);
        const tb = t ? findTable(t, tableId) : null;
        const f = tb ? findField(tb, fieldId) : null;
        const cur = f && !isRowsTable(tb) && isPlain(this._data[templateId]) && isPlain(this._data[templateId][tableId])
            ? this._data[templateId][tableId][fieldId] : undefined;
        return this.historySeries(templateId, tableId, fieldId, cur);
    }
    caps() { return caps(); }
}
