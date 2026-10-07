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
import { writeReceipt } from '../../config/write-receipt.js';

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
        /* [v3.66.0 · X2] 跨 App 定位到的费用 id（'' = 没有定位态）。
         *   ★ 存 **id** 不存下标：本仓曲库那件正是按数组下标定位详情态，
         *     删中间项后详情会串到别的一条头上（不报错、只串项）。
         *     费用 id 由 `normalizeExpense` 派生的 `tv_e_<下标>` 兜底，
         *     但**用户/上游给了 id 就以它为准** —— 故这里一律按 id 找。 */
        this._focus = '';
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
    /* ---------- [v3.66.0 · X2] 跨 App 定位口 ---------- */
    /**
     * 定位到某一条费用（全局搜索点进来时用）。
     *   ★ 按 **id** 找，不按下标：删中间一条后下标会让定位串到别的一条头上。
     *   ★ 回报 `{ok:false, reason}` 而**不是**静默返回 —— 「点进来还停在首屏」
     *     与「这条费用没了」在界面上长得一样，必须由调用方把理由报出来。
     */
    openRef(ref) {
        const id = (ref && typeof ref === 'object') ? toStr(ref.id) : '';
        if (!id) return { ok: false, reason: 'no_id' };
        this._probe();
        const hit = this._expenses.filter((e) => toStr(e && e.id) === id);
        if (!hit.length) return { ok: false, reason: 'not_found', id: id, saw: this._expenses.length };
        this._focus = id;
        return { ok: true, id: id, index: this._expenses.indexOf(hit[0]), saw: this._expenses.length };
    }
    /** 清掉定位态（视图「收起」与换会话都走这里，防定位态跨会话残留）。 */
    clearRef() { this._focus = ''; return { ok: true }; }
    /** 定位态：id + 它在**当下**曲库里的下标（找不到时 index = -1，不假装还在）。 */
    focusRow() {
        if (!this._focus) return null;
        const idx = this._expenses.findIndex((e) => toStr(e && e.id) === this._focus);
        if (idx < 0) return { id: this._focus, index: -1, gone: true };
        const e = this._expenses[idx];
        return { id: this._focus, index: idx, gone: false, payer: toStr(e.payer), note: toStr(e.note), finalCNY: e.finalCNY };
    }
    symbols() { return TV_CURRENCY_SYMBOLS; }
    clearAll() { this._people = []; this._families = []; this._expenses = []; this._writeRaw(TV_BOOK_KEY, {}); this._log('clear', ''); }
    clearLedger() { this._ledger = []; this._writeRaw(TV_LEDGER_KEY, []); this._log('clear_ledger', ''); }
    onChatChanged() { this._probe(); this._dropped = 0; this._focus = ''; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new TraveldeskView(this);
        this._view.render(this._vm());
    }
    _vm() { return { people: this._people, families: this._families, expenses: this._expenses, lastSummary: this._lastSummary, lastQuote: this._lastQuote, readings: this.readings(), ledger: this._ledger, dropped: this._dropped, focus: this.focusRow() }; }
}