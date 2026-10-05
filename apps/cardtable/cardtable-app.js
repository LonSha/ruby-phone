/* ========================================================
 * cardtable-app.js — [v3.51.0] 牌桌案头 · 落盘与接线
 * 两条会话键走 ^ct_ 前缀随会话隔离：ct_deck 当前牌组 / ct_ledger 台账。
 * 源的 DOM 网格渲染与图片加载与 overlay 弹层不缝；本件零图片。
 * ======================================================== */
'use strict';
import {
    CT_LEDGER_MAX, buildDeck, pickCard, renumber, readingsOf, trimRows, listOf, toStr
} from './cardtable-data.js';
import { CardtableView } from './cardtable-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

export const CT_DECK_KEY = 'ct_deck';
export const CT_LEDGER_KEY = 'ct_ledger';

export class CardtableApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._settings = {};
        this._deck = [];
        this._order = [];
        this._ledger = [];
        this._dropped = 0;
        this._lastWhy = '';
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
        const trimmed = trimRows([entry].concat(this._ledger), CT_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(CT_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const d = this._readRaw(CT_DECK_KEY);
        const val = (d.ok && d.why === 'present' && isPlainLike(d.value)) ? d.value : null;
        this._deck = val ? listOf(val.deck) : [];
        let st = { ok: false, why: '', value: undefined };
        try { const rawSt = this.storage ? this.storage.get('ct_settings', undefined) : undefined; if (rawSt && typeof rawSt === 'object' && !Array.isArray(rawSt)) st = { ok: true, why: 'present', value: rawSt }; else st = { ok: true, why: 'absent', value: undefined }; } catch (e2) { st = { ok: false, why: 'read_threw', value: undefined }; }
        this._settings = (st.ok && st.why === 'present' && st.value && typeof st.value === 'object' && !Array.isArray(st.value)) ? st.value : {};
        this._order = val ? listOf(val.order) : [];
    }
    newDeck(deckType) {
        this._settings.deckType = toStr(deckType) || 'all';
        this._writeRaw('ct_settings', this._settings);
        this._deck = buildDeck(deckType);
        this._order = [];
        const w = this._writeRaw(CT_DECK_KEY, { deck: this._deck, order: this._order });
        this._log('new_deck', 'type=' + toStr(deckType) + ' n=' + String(this._deck.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, total: this._deck.length };
    }
    /* 抽牌：状态机落库；取消后序号自动重排（renumber）。 */
    pick(cardIndex) {
        const r = pickCard(this._deck, cardIndex, this._order);
        if (!r.ok) { this._lastWhy = r.why; this._log('pick', 'why=' + r.why); return r; }
        this._deck[cardIndex].state = r.state;
        this._order = r.order;
        const w = this._writeRaw(CT_DECK_KEY, { deck: this._deck, order: this._order });
        this._log('pick', 'idx=' + String(cardIndex) + ' state=' + r.state + ' saved=' + String(w.saved === true));
        this._lastWhy = '';
        return { ok: true, why: '', picked: r.picked, order: renumber(this._order), saved: w.saved };
    }
    readings() { return readingsOf(this._deck, this._order); }
    clearAll() { this._deck = []; this._order = []; this._writeRaw(CT_DECK_KEY, null); this._log('clear', ''); }
    onChatChanged() { this._probe(); this._dropped = 0; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new CardtableView(this);
        this._view.render(this._vm());
    }
    _vm() { return { deck: this._deck, order: renumber(this._order), lastWhy: this._lastWhy, readings: this.readings(), ledger: this._ledger, dropped: this._dropped }; }
}
function isPlainLike(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }