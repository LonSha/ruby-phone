/* ========================================================
 * weibo-text-app.js — [v4.191.0] 微博 文本解析 · 控制器
 *
 * 职责：把 weibo-text-core.js 的纯函数接到「一段相对时间怎么读、一个 @人名
 *   怎么归一、一个粉丝数怎么读、一条评论怎么切」这四件界面上天天要用的解析上，
 *   给一个可试算的面。
 * 为什么不动 weibo-data.js 那个 2719 行的类：WeiboData 构造器接 storage，
 *   持一票点赞/热搜缓存键，generate* 一族全是 async 且自己 window 兜底取时钟
 *   —— 是有副作用的编排。本件只包文本解析面。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    parseRelativeTimeToMinutes, formatRelativeTimeFromMinutes,
    normalizeAtName, normalizeBareName, stripDuplicateReplyMention,
    parseFollowerNumber, extractTrailingLocation, parseCommentLine
} from './weibo-text-core.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'weibo_text_v1';

export class WeiboTextApp {
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
     * [v4.199.0] 换会话：上次解析是**会话数据**（落盘键按会话隔离），
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

    /** 相对时间读：「3小时前」-> 180 分钟。 */
    ago(text) {
        const out = { minutes: parseRelativeTimeToMinutes(text), shown: formatRelativeTimeFromMinutes(parseRelativeTimeToMinutes(text)) };
        return this._record('ago', text, { ok: true, reason: null, out });
    }

    /** 相对时间写：180 分钟 -> 「3小时前」。 */
    stamp(minutes) {
        const out = { minutes: Number(minutes) || 0, shown: formatRelativeTimeFromMinutes(minutes) };
        return this._record('stamp', minutes, { ok: true, reason: null, out });
    }

    /** @ 人名归一：给名补 @，剥名去 @。 */
    at(name) {
        const out = { at: normalizeAtName(name), bare: normalizeBareName(name) };
        return this._record('at', name, { ok: true, reason: null, out });
    }

    /** 剥重复回复称呼：正文开头已有「@张三：」而回复对象就是张三时。 */
    dedupe(text, replyTo) {
        const out = { text: stripDuplicateReplyMention(text, replyTo) };
        return this._record('dedupe', text + ' | ' + String(replyTo == null ? '' : replyTo), { ok: true, reason: null, out });
    }

    /** 粉丝数读：「1.2万」-> 12000；认不出给 null（不编 0）。 */
    followers(raw) {
        const n = parseFollowerNumber(raw);
        const out = { parsed: n };
        return this._record('followers', raw, { ok: true, reason: null, out });
    }

    /** 属地切分：「名字（IP属地：北京）」-> { location: '北京', head: '名字' }。 */
    location(head) {
        const out = extractTrailingLocation(head);
        return this._record('location', head, { ok: true, reason: null, out });
    }

    /** 评论行解析：一条「@名字（属地）：正文」⇒ 结构化四段。 */
    comment(line) {
        const r = parseCommentLine(line);
        return this._record('comment', line, r);
    }

    destroy() { this._view = null; }
}

export {
    parseRelativeTimeToMinutes, formatRelativeTimeFromMinutes,
    normalizeAtName, normalizeBareName, stripDuplicateReplyMention,
    parseFollowerNumber, extractTrailingLocation, parseCommentLine
};
export default WeiboTextApp;