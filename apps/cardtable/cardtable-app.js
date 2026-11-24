/* ========================================================
 * cardtable-app.js — [v3.51.0 / v4.200.0] 牌桌案头 · 落盘与接线
 * 两条会话键走 ^ct_ 前缀随会话隔离：ct_deck 当前牌组（含 seed 与牌组类型）/ ct_ledger 台账。
 *
 * [v4.200.0] 随机源改由**控制器**提供（内核只收 rng 函数，不自己取随机）：
 *   · 每次新牌组落一个 seed（不传就取 `Date.now()` 的低六位）；
 *   · seed 随牌组一起落盘，所以「换会话回来还是那副牌」，且能把 seed 报给人复现；
 *   · 点「重开」按旧 seed 重跑 —— 同 seed 同牌序（内核 makeRng 的确定性）。
 * 源的 DOM 网格渲染与图片加载与 overlay 弹层不缝；本件零图片。
 * ======================================================== */
'use strict';
import {
    CT_LEDGER_MAX, CT_REJECT, buildDeck, makeRng, normalizeDeckType, normalizeSeed,
    pickCard, renumber, readingsOf, trimRows, listOf, toStr
} from './cardtable-data.js';
import { CardtableView } from './cardtable-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

export const CT_DECK_KEY = 'ct_deck';
export const CT_LEDGER_KEY = 'ct_ledger';
export const CT_SETTINGS_KEY = 'ct_settings';

/** 控制器造种子：只用 Date.now 的低六位，不讲究质量（真随机由内核的 makeRng 展开）。 */
function seedOfNow() { return Date.now() % 1000000; }

export class CardtableApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._settings = {};
        this._deck = [];
        this._order = [];
        this._ledger = [];
        this._seed = null;
        this._deckType = '';
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
        this._order = val ? listOf(val.order) : [];
        /* seed 同牌组一起落盘；旧版本存下的牌组没有这一格，如实记 null（不编一个）。 */
        this._seed = val ? normalizeSeed(val.seed) : null;
        this._deckType = val ? toStr(val.deckType) : '';
        let st = { ok: false, why: '', value: undefined };
        try { const rawSt = this.storage ? this.storage.get(CT_SETTINGS_KEY, undefined) : undefined; if (rawSt && typeof rawSt === 'object' && !Array.isArray(rawSt)) st = { ok: true, why: 'present', value: rawSt }; else st = { ok: true, why: 'absent', value: undefined }; } catch (e2) { st = { ok: false, why: 'read_threw', value: undefined }; }
        this._settings = (st.ok && st.why === 'present' && st.value && typeof st.value === 'object' && !Array.isArray(st.value)) ? st.value : {};
    }
    /**
     * 新牌组。seed 可选：不传就用当前时刻的低六位。
     * 牌组类型认不出 **当场报 why**，不再静默兜 'all'（v4.200.0 拔掉的第二个病根）。
     */
    newDeck(deckType, seed) {
        const t = normalizeDeckType(deckType);
        if (t === null) {
            this._lastWhy = CT_REJECT.badDeckType;
            this._log('new_deck', 'why=' + CT_REJECT.badDeckType + ' got=' + toStr(deckType));
            return { ok: false, why: CT_REJECT.badDeckType, total: 0, saved: false };
        }
        const raw = (seed === undefined || seed === null) ? seedOfNow() : seed;
        const n = normalizeSeed(raw);
        if (n === null) {
            this._lastWhy = CT_REJECT.badSeed;
            this._log('new_deck', 'why=' + CT_REJECT.badSeed + ' got=' + toStr(raw));
            return { ok: false, why: CT_REJECT.badSeed, total: 0, saved: false };
        }
        this._settings.deckType = t;
        this._settings.seed = n;
        this._writeRaw(CT_SETTINGS_KEY, this._settings);
        this._deck = buildDeck(t, makeRng(n));
        this._order = [];
        this._seed = n;
        this._deckType = t;
        const w = this._writeRaw(CT_DECK_KEY, { deck: this._deck, order: this._order, seed: n, deckType: t });
        this._log('new_deck', 'type=' + t + ' seed=' + String(n) + ' n=' + String(this._deck.length) + ' saved=' + String(w.saved === true));
        this._lastWhy = '';
        return { ok: true, why: '', saved: w.saved, total: this._deck.length, seed: n, deckType: t };
    }
    /** 按当前牌组的 seed 重开一副（同 seed 同牌序）。没有 seed 就如实拒答。 */
    rebuild() {
        if (this._seed === null) {
            this._lastWhy = CT_REJECT.badSeed;
            return { ok: false, why: CT_REJECT.badSeed, total: 0, saved: false };
        }
        return this.newDeck(this._deckType || 'all', this._seed);
    }
    /* 抽牌：状态机落库；取消后序号自动重排（renumber）。
     * [v4.200.0] 内核返回新牌组，这里整副替换 —— 不再「内核报状态 + 控制器手工回写」。 */
    pick(cardIndex) {
        const r = pickCard(this._deck, cardIndex, this._order);
        if (!r.ok) { this._lastWhy = r.why; this._log('pick', 'why=' + r.why); return { ok: false, why: r.why, picked: false, order: renumber(this._order), saved: false }; }
        this._deck = r.deck;
        this._order = r.order;
        const w = this._writeRaw(CT_DECK_KEY, { deck: this._deck, order: this._order, seed: this._seed, deckType: this._deckType });
        this._log('pick', 'idx=' + String(cardIndex) + ' state=' + r.state + ' saved=' + String(w.saved === true));
        this._lastWhy = '';
        return { ok: true, why: '', picked: r.picked, order: renumber(this._order), saved: w.saved };
    }
    readings() { return readingsOf(this._deck, this._order); }
    clearAll() { this._deck = []; this._order = []; this._seed = null; this._deckType = ''; this._writeRaw(CT_DECK_KEY, null); this._log('clear', ''); }
    onChatChanged() { this._probe(); this._dropped = 0; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new CardtableView(this);
        this._view.render(this._vm());
    }
    _vm() { return { deck: this._deck, order: renumber(this._order), lastWhy: this._lastWhy, readings: this.readings(), ledger: this._ledger, dropped: this._dropped, seed: this._seed, deckType: this._deckType }; }
}
function isPlainLike(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
