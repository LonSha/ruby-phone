/* ========================================================
 * stickerdesk-app.js — [v3.50.0] 表情包册案头 · 落盘与接线
 * 三条会话键走 ^sd_ 前缀随会话隔离：sd_stickers 册 / sd_categories 分类 / sd_ledger 台账。
 * 源的 AI 识别与下载与出图一律不缝；本件零网络零图片处理。
 * ======================================================== */
'use strict';
import {
    SD_LEDGER_MAX, trimRows, parseStickerText, normalizeSticker, normalizeCategory,
    renameCategory, dissolveCategory, moveStickers, readingsOf, listOf, toStr, isPlain
} from './stickerdesk-data.js';
import { StickerdeskView } from './stickerdesk-view.js';

export const SD_STICKERS_KEY = 'sd_stickers';
export const SD_CATEGORIES_KEY = 'sd_categories';
export const SD_LEDGER_KEY = 'sd_ledger';

export class StickerdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'board';
        this._stickers = [];
        this._categories = [];
        this._ledger = [];
        this._dropped = 0;
        this._lastIntake = null;
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
        const trimmed = trimRows([entry].concat(this._ledger), SD_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(SD_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const s = this._readRaw(SD_STICKERS_KEY);
        this._stickers = (s.ok && s.why === 'present' && Array.isArray(s.value)) ? s.value : [];
        const c = this._readRaw(SD_CATEGORIES_KEY);
        this._categories = (c.ok && c.why === 'present' && Array.isArray(c.value)) ? c.value : [];
        const g = this._readRaw(SD_LEDGER_KEY);
        this._ledger = (g.ok && g.why === 'present' && Array.isArray(g.value)) ? g.value : [];
    }
    /* 收文本：宽泛格式整段解析 → 与既有册 URL 幂等去重 → 追加落盘。 */
    intakeText(rawText) {
        const existing = this._stickers.map(function (s) { return s && s.url; });
        const r = parseStickerText(rawText, existing);
        const added = r.stickers.map(function (item, i) {
            const n = normalizeSticker({ id: 'sd_st_' + String(Date.now()) + '_' + String(i), name: item.name, url: item.url, categoryId: '' }, i);
            return n.sticker;
        }).filter(Boolean);
        this._stickers = this._stickers.concat(added);
        const w = this._writeRaw(SD_STICKERS_KEY, this._stickers);
        this._lastIntake = { added: added.length, rejected: r.rejected, notes: r.notes };
        this._log('intake_text', 'added=' + String(added.length) + ' rejected=' + String(r.rejected.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, added: added.length, rejected: r.rejected, notes: r.notes };
    }
    intakeCategories(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json', saved: false }; }
        const arr = Array.isArray(parsed) ? parsed : ((isPlain(parsed) && Array.isArray(parsed.categories)) ? parsed.categories : null);
        if (!arr) return { ok: false, why: 'bad_shape', saved: false };
        this._categories = arr.map(normalizeCategory);
        const w = this._writeRaw(SD_CATEGORIES_KEY, this._categories);
        this._log('intake_categories', 'n=' + String(this._categories.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, categories: this._categories.length };
    }
    doRename(categoryId, newName) {
        const r = renameCategory(this._categories, categoryId, newName);
        if (!r.ok) { this._log('rename', 'why=' + r.why); return r; }
        this._categories = this._categories.map(function (c) { return c && c.id === categoryId ? Object.assign({}, c, { name: r.name }) : c; });
        this._writeRaw(SD_CATEGORIES_KEY, this._categories);
        this._log('rename', 'cat=' + categoryId);
        return { ok: true, why: '' };
    }
    doDissolve(categoryId) {
        const r = dissolveCategory(this._categories, this._stickers, categoryId);
        if (!r.ok) { this._log('dissolve', 'why=' + r.why + ' holding=' + String(r.holding || 0)); return r; }
        this._categories = this._categories.filter(function (c) { return c && c.id !== categoryId; });
        this._writeRaw(SD_CATEGORIES_KEY, this._categories);
        this._log('dissolve', 'cat=' + categoryId);
        return { ok: true, why: '' };
    }
    doMove(ids, targetCategoryId) {
        const r = moveStickers(this._stickers, ids, targetCategoryId, this._categories);
        if (!r.ok) { this._log('move', 'why=' + r.why); return r; }
        this._stickers = r.stickers;
        this._writeRaw(SD_STICKERS_KEY, this._stickers);
        this._log('move', 'moved=' + String(r.moved));
        return { ok: true, why: '', moved: r.moved };
    }
    readings() { return readingsOf(this._stickers, this._categories); }
    setTab(tab) { this._tab = toStr(tab) || 'board'; this.render(); }
    clearAll() { this._stickers = []; this._writeRaw(SD_STICKERS_KEY, []); this._categories = []; this._writeRaw(SD_CATEGORIES_KEY, []); this._log('clear_all', ''); this.render(); }
    clearLedger() { this._ledger = []; this._writeRaw(SD_LEDGER_KEY, []); this.render(); }
    onChatChanged() { this._probe(); this._dropped = 0; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new StickerdeskView(this);
        this._view.render(this._vm());
    }
    _vm() {
        return { tab: this._tab, stickers: this._stickers, categories: this._categories, lastIntake: this._lastIntake, readings: this.readings(), ledger: this._ledger, dropped: this._dropped };
    }
}