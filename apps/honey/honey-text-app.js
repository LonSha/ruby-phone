/* ========================================================
 * honey-text-app.js — [v4.191.0] 蜜语 文本清洗与数值钳制 · 控制器
 *
 * 职责：把 honey-text-core.js 的纯函数接到「一段带 HTML 的文本怎么洗、
 *   一个好感度怎么钳、一条直播间评论怎么归一」这三件界面上天天要用的
 *   清洗上，给一个可试算的面。
 * 为什么不动 honey-data.js 那个 5228 行的类：HoneyData 构造器接 storage，
 *   持一票全局社交键，generate* 一族全是 async —— 是有副作用的编排。
 *   本件只包纯清洗面。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    sanitizeInlineText, sanitizePromptLine, sanitizePromptBlockLine,
    clampFavorability, clampReferenceValue, normalizeNaiReferenceImage,
    isCommentStatusLine, normalizeCommentLine
} from './honey-text-core.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'honey_text_v1';

import { HoneyTextView } from './honey-text-view.js';
export class HoneyTextApp {
    render() {
        this._view ??= new HoneyTextView(this, this.shell);
        this._view.render();
    }
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this._initFromStorage();
    }

    /**
     * 构造与换会话共用同一条重取路径（v4.199.0 从构造函数抽出，只为让 onChatChanged 不抄一份）。
     * 读的是**本会话**的存储快照，所以换会话 = 回构造态再读一次。
     */
    _initFromStorage() {
        this.lastInput = null;
        this.lastOut = null;
        this._view = null;
        const snap = this._readSnapshot();
        if (snap) { this.lastInput = snap.input || null; this.lastOut = snap.out || null; }
    }

    /**
     * [v4.199.0] 换会话：上次清洗是**会话数据**（落盘键按会话隔离），
     * 不重取的话，上一会话的读数会原样出现在新会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this._initFromStorage();
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

    _record(kind, value, out) {
        this.lastInput = { kind, value: String(value == null ? '' : value) };
        this.lastOut = out;
        this._saveSnapshot();
        return out;
    }

    /** 内联清洗：剥 HTML、折叠空白、截断。 */
    inline(value, maxLen) {
        const out = { text: sanitizeInlineText(value, maxLen) };
        return this._record('inline', value, { ok: true, reason: null, out });
    }

    /** 提示词行清洗（单行不截断 / 块行去回车）。 */
    promptLine(value) {
        const out = { line: sanitizePromptLine(value), block: sanitizePromptBlockLine(value) };
        return this._record('promptLine', value, { ok: true, reason: null, out });
    }

    /** 好感度钳制：0~100 一位小数；读不出给 fallback。 */
    favorability(value) {
        const out = { clamped: clampFavorability(value, null), bad: clampFavorability('', null) };
        return this._record('favorability', value, { ok: true, reason: null, out });
    }

    /** 参考值钳制：0~1 两位小数。 */
    reference(value) {
        const out = { clamped: clampReferenceValue(value) };
        return this._record('reference', value, { ok: true, reason: null, out });
    }

    /** 参考图归一：只放行 http(s) 与站内 backgrounds/。 */
    image(value) {
        const out = { url: normalizeNaiReferenceImage(value) };
        return this._record('image', value, { ok: true, reason: null, out });
    }

    /** 评论行归一；状态行/空行给 ''（调用方剔除）。 */
    comment(line) {
        const text = normalizeCommentLine(line);
        const out = { text, status: isCommentStatusLine(line) };
        return this._record('comment', line, { ok: true, reason: null, out });
    }

    destroy() { this._view = null; }
}

export {
    sanitizeInlineText, sanitizePromptLine, sanitizePromptBlockLine,
    clampFavorability, clampReferenceValue, normalizeNaiReferenceImage,
    isCommentStatusLine, normalizeCommentLine
};
export default HoneyTextApp;