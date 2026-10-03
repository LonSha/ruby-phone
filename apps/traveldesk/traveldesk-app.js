/* ========================================================
 * traveldesk-app.js — [v3.54.0] 旅行记账案头 · 落盘与接线
 * 两条会话键走 ^tv_ 前缀随会话隔离：tv_book 账本（人/家庭/费用） / tv_ledger 台账。
 * 源挂 AppState.data.travelData 并满篇 DOM 渲染与 confirm，本件零 DOM。
 * ======================================================== */
'use strict';
import {
    TV_LEDGER_MAX, TV_PEOPLE_MAX, TV_EPSILON, TV_CURRENCY_SYMBOLS, toCNY, balancesOf, consolidateFamilies,
    internalSettlement, externalSettlement, normalizeExpenses, normalizeExpense, readingsOf, trimRows, listOf, toStr, isPlain
} from './traveldesk-data.js';
import { TraveldeskView } from './traveldesk-view.js';

export const TV_BOOK_KEY = 'tv_book';
export const TV_LEDGER_KEY = 'tv_ledger';

export class TraveldeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._people = [];
        this._families = [];
        this._expenses = [];
        this._lastSummary = null;
        this._lastQuote = null;
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
            const wrote = this.storage.set(key, value);
            return { saved: wrote === true, why: wrote === true ? '' : 'set_false' };
        } catch (e) { return { saved: false, why: 'write_threw' }; }
    }
    _log(action, detail) {
        const entry = { at: Date.now(), action: toStr(action), detail: toStr(detail) };
        const trimmed = trimRows([entry].concat(this._ledger), TV_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(TV_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const b = this._readRaw(TV_BOOK_KEY);
        const book = (b.ok && b.why === 'present' && isPlain(b.value)) ? b.value : {};
        this._people = listOf(book.people).slice(0, TV_PEOPLE_MAX);
        this._families = listOf(book.families);
        this._expenses = listOf(book.expenses);
        const l = this._readRaw(TV_LEDGER_KEY);
        this._ledger = (l.ok && l.why === 'present' && Array.isArray(l.value)) ? l.value : [];
    }
    intakeBook(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json', saved: false }; }
        const book = isPlain(parsed) ? parsed : {};
        this._people = listOf(book.people).slice(0, TV_PEOPLE_MAX);
        this._families = listOf(book.families);
        const norm = normalizeExpenses(book.expenses, this._people);
        this._expenses = norm.expenses;
        const w = this._writeRaw(TV_BOOK_KEY, { people: this._people, families: this._families, expenses: this._expenses });
        this._log('intake_book', 'people=' + String(this._people.length) + ' expenses=' + String(this._expenses.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, people: this._people.length, expenses: this._expenses.length, rejected: norm.rejected };
    }
    /* 汇率试算（不落账）。 */
    quote(amount, currency, rate, rateUnit) {
        const q = toCNY(amount, currency, rate, rateUnit);
        this._lastQuote = q;
        return q;
    }
    /* 结算全链：余额 → 家庭归并 → 内部清算 + 外部债务。 */
    settle() {
        const raw = balancesOf(this._expenses, this._people);
        const merged = consolidateFamilies(raw.balances, this._families);
        const internal = internalSettlement(merged);
        const external = externalSettlement(raw.externalDebts);
        const summary = { payerTotals: raw.payerTotals, transfers: internal.transfers, balanced: internal.balanced, external: external };
        this._lastSummary = summary;
        this._log('settle', 'transfers=' + String(internal.transfers.length) + ' external=' + String(external.length) + ' eps=' + String(TV_EPSILON));
        return summary;
    }
    readings() { return readingsOf(this._expenses, this._people); }
    symbols() { return TV_CURRENCY_SYMBOLS; }
    clearAll() { this._people = []; this._families = []; this._expenses = []; this._writeRaw(TV_BOOK_KEY, {}); this._log('clear', ''); }
    clearLedger() { this._ledger = []; this._writeRaw(TV_LEDGER_KEY, []); this._log('clear_ledger', ''); }
    onChatChanged() { this._probe(); this._dropped = 0; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new TraveldeskView(this);
        this._view.render(this._vm());
    }
    _vm() { return { people: this._people, families: this._families, expenses: this._expenses, lastSummary: this._lastSummary, lastQuote: this._lastQuote, readings: this.readings(), ledger: this._ledger, dropped: this._dropped }; }
}