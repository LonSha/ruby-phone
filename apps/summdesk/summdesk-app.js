/* ========================================================
 * summdesk-app.js — [v3.52.0] 总结案头 · 落盘与接线
 * 两条会话键走 ^sm_ 前缀随会话隔离：sm_memories 记忆册 / sm_cursors 双游标。
 * 源把记忆挂宿主 chat 大对象，换角色串味；fetch 生成不缝 —— 文本由用户贴回。
 * ======================================================== */
'use strict';
import {
    parseSummaryText, composeTitle, initCursor, planBatches, rollbackCursor, normalizeMemories, readingsOf, listOf, toStr, isPlain, numOrNull
} from './summdesk-data.js';
import { SummdeskView } from './summdesk-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

export const SM_MEMORIES_KEY = 'sm_memories';
export const SM_CURSORS_KEY = 'sm_cursors';

export class SummdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._memories = [];
        this._cursors = { normal: 0, normalChunk: 0, normalInterval: 0, trueV: 0, trueChunk: 0, trueInterval: 0 };
        this._lastParse = null;
        /* [v3.66.0 · X2] 跨 App 定位到的记忆 id（'' = 无定位态）。按 id 不按下标。 */
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
    _nowMs() {
        if (this.shell && typeof this.shell.now === 'function') {
            try { const n = this.shell.now(); if (Number.isFinite(n)) return n; } catch (e) {}
        }
        return Date.now();
    }
    _probe() {
        const m = this._readRaw(SM_MEMORIES_KEY);
        const norm = normalizeMemories((m.ok && m.why === 'present' && Array.isArray(m.value)) ? m.value : []);
        this._memories = norm.memories;
        const c = this._readRaw(SM_CURSORS_KEY);
        const base = { normal: 0, normalChunk: 0, normalInterval: 0, trueV: 0, trueChunk: 0, trueInterval: 0 };
        this._cursors = (c.ok && c.why === 'present' && isPlain(c.value)) ? Object.assign(base, c.value) : base;
    }
    /* 收总结文本：解析归一 → 入册落盘（标题组装：标题-条数-日期）。 */
    intakeSummary(rawText, msgRange) {
        const now = this._nowMs();
        const r = parseSummaryText(rawText);
        const finalTitle = composeTitle(r.title, msgRange || '', now);
        const entry = { id: 'sm_m_' + String(now), title: finalTitle, content: r.content, timestamp: now };
        this._memories.unshift(entry);
        const w = this._writeRaw(SM_MEMORIES_KEY, this._memories);
        this._lastParse = { title: finalTitle, content: r.content.slice(0, 80), notes: r.notes, saved: w.saved };
        return { ok: true, saved: w.saved, title: finalTitle, notes: r.notes };
    }
    /* 双通道游标设置与推进读数（只算不拉：历史由用户手输长度模拟）。 */
    setCursors(normalInterval, trueInterval, historyLen, normalChunk, trueChunk) {
        const a = initCursor(normalChunk || this._cursors.normalChunk, normalInterval, historyLen || 0);
        const b = initCursor(trueChunk || this._cursors.trueChunk, trueInterval, historyLen || 0);
        this._cursors.normalInterval = numOrNull(normalInterval) || 0;
        this._cursors.trueInterval = numOrNull(trueInterval) || 0;
        this._cursors.normal = a.cursor; this._cursors.active = a.active;
        this._cursors.trueV = b.cursor; this._cursors.trueActive = b.active;
        this._cursors.historyLen = historyLen || 0;
        const w = this._writeRaw(SM_CURSORS_KEY, this._cursors);
        const pa = planBatches(historyLen || 0, this._cursors.normal, this._cursors.normalInterval);
        return { ok: true, saved: w.saved, batches: pa.batches.length, why: pa.why };
    }
    rollback(channel, batchStart) {
        if (channel === 'normal') this._cursors.normal = rollbackCursor(this._cursors.normal, batchStart);
        else this._cursors.trueV = rollbackCursor(this._cursors.trueV, batchStart);
        this._writeRaw(SM_CURSORS_KEY, this._cursors);
        return { ok: true };
    }
    readings() { return readingsOf(this._memories, this._cursors.normal, this._cursors.trueV, this._cursors.historyLen || 0); }
    /* ---------- [v3.66.0 · X2] 跨 App 定位口 ---------- */
    /**
     * 定位到某一条记忆（全局搜索点进来时用）。
     *   ★ 按 id 找，不按下标 —— 册里删中间一条后，下标会让定位串到别的一条头上。
     *   ★ 回报 reason：「点进来停在首屏」与「这条记忆没了」必须分得开。
     */
    openRef(ref) {
        const id = (ref && typeof ref === 'object') ? toStr(ref.id) : '';
        if (!id) return { ok: false, reason: 'no_id' };
        this._probe();
        const idx = this._memories.findIndex((m) => toStr(m && m.id) === id);
        if (idx < 0) return { ok: false, reason: 'not_found', id: id, saw: this._memories.length };
        this._focus = id;
        return { ok: true, id: id, index: idx, saw: this._memories.length };
    }
    clearRef() { this._focus = ''; return { ok: true }; }
    /** 定位态：id + 当下下标（找不到时 index = -1 且 gone，绝不假装还在）。 */
    focusRow() {
        if (!this._focus) return null;
        const idx = this._memories.findIndex((m) => toStr(m && m.id) === this._focus);
        if (idx < 0) return { id: this._focus, index: -1, gone: true };
        const m = this._memories[idx];
        return { id: this._focus, index: idx, gone: false, title: toStr(m.title), excerpt: toStr(m.content).slice(0, 60) };
    }
    clearMemories() { this._memories = []; this._writeRaw(SM_MEMORIES_KEY, []); }
    onChatChanged() { this._probe(); this._focus = ''; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new SummdeskView(this);
        this._view.render(this._vm());
    }
    _vm() { return { memories: this._memories, cursors: this._cursors, lastParse: this._lastParse, readings: this.readings(), focus: this.focusRow() }; }
}