/* ========================================================
 * bili-format-app.js — [v4.190.0] B站 文本/计数/时间 · 控制器
 *
 * 职责：把 bili-format.js 的纯函数接到「一个数字怎么显示、一个时刻怎么描述、
 *   一个 BV 号怎么生成」这三件界面上天天要用的换算上，给一个可试算的面。
 * 为什么不动 bili-data.js 那个 1365 行的类：BiliData 持 this.state 并直写
 *   storage（用户态 / 硬币 / 关注 / 历史 / 收藏），是有副作用的编排。
 *   本件只包纯换算面。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    fmtCount, fmtDur, parseDur, parseCount, timeAgo, wallStampText,
    makeBvid, makeMid, seededInt, compactText, hash32
} from './bili-format.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'bili_format_v1';

/** 试算用的固定时刻（毫秒）。nowMs 一律由调用方给，内核不自己取时间。 */
const DEMO_NOW = 1763808000000;

export class BiliFormatApp {
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this.lastInput = null;
        this.lastOut = null;
        this._view = null;
        const snap = this._readSnapshot();
        if (snap) { this.lastInput = snap.input || null; this.lastOut = snap.out || null; }
    }

    _readSnapshot() {
        try {
            const raw = this.storage ? this.storage.get(STATE_KEY) : null;
            if (typeof raw !== 'string') return null;
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (_e) { return null; }
    }

    _saveSnapshot() {
        try {
            if (!this.storage) return false;
            const r = writeReceipt(this.storage, STATE_KEY, JSON.stringify({ input: this.lastInput, out: this.lastOut }));
            return r.saved === true;
        } catch (_e) { return false; }
    }

    /** 计数换算：'12.8万' -> 128000 -> '12.8万'（往返一致）。 */
    count(value) {
        const n = parseCount(value);
        const out = { parsed: n, shown: fmtCount(value) };
        this.lastInput = { kind: 'count', value: String(value == null ? '' : value) };
        this.lastOut = out;
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 时长换算：'12:34' -> 754 -> '12:34'。 */
    dur(value) {
        const s = parseDur(value);
        const out = { seconds: s, shown: fmtDur(s) };
        this.lastInput = { kind: 'dur', value: String(value == null ? '' : value) };
        this.lastOut = out;
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 时间文案：ts 相对 DEMO_NOW 怎么描述。 */
    ago(ts) {
        const out = { ts: Number(ts) || 0, now: DEMO_NOW, text: timeAgo(ts, DEMO_NOW), stamp: wallStampText(ts, DEMO_NOW) };
        this.lastInput = { kind: 'ago', value: String(ts == null ? '' : ts) };
        this.lastOut = out;
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 标识生成：同一个种子永远同一个 BV 号与 UID。 */
    id(seed) {
        const key = String(seed == null ? '' : seed);
        const out = { bvid: makeBvid(key), mid: makeMid(key), hash: hash32(key), luck: seededInt(key, 120, 1500) };
        this.lastInput = { kind: 'id', value: key };
        this.lastOut = out;
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 文本紧凑化。 */
    text(value, max) {
        const out = { text: compactText(value, max) };
        this.lastInput = { kind: 'text', value: String(value == null ? '' : value) };
        this.lastOut = out;
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    destroy() { this._view = null; }
}

export { fmtCount, fmtDur, parseDur, parseCount, timeAgo, wallStampText, makeBvid, makeMid, seededInt, compactText };
export default BiliFormatApp;