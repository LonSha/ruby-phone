/* ========================================================
 * phone-text-app.js — [v4.192.0] 通话/短信文本归一 · 控制器
 * --------------------------------------------------------
 * 把 phone-text-core.js 的纯函数接到「一条通话 AI 回复怎么读、一条拒接理由怎么读、
 *   一段短信批量回复怎么切、一个 TTS 缓存键怎么拼、一个头像地址怎么归一」上。
 * 不碰 phone-view.js 那个 4243 行的类（它持 this.app / this.currentView /
 *   this._phoneCallTtsCache 一票运行时态，并直写 storage）—— 那是有副作用的编排。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    cleanCallAiResponse, cleanCallRejectReason, parseSmsAiResponse,
    buildCallTtsCacheKey, normalizeWechatAvatarPath, normalizeTtsGender,
    TTS_GENDERS, TTS_CACHE_KEY_SEPARATOR, AVATAR_PLACEHOLDER
} from './phone-text-core.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'phone_text_v1';

export class PhoneTextApp {
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
     * [v4.199.0] 换会话：上次归一是**会话数据**（落盘键按会话隔离），
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

    /** 通话 AI 回复：<Call> 优先 → 去姓名行/残留标签 → 按行拆并去重。 */
    call(response, callerName) {
        return this._record('call', response, { lines: cleanCallAiResponse(response, callerName) });
    }

    /** 拒接理由：剥标签与姓名头；读不出给「暂时不方便接听」兜底句。 */
    reject(raw, callerName) {
        return this._record('reject', raw, { reason: cleanCallRejectReason(raw, callerName) });
    }

    /** 短信批量回复：<短信> 标签优先，块内取 [发送方] + 内容 + 发送时间。 */
    sms(response, fallbackSender) {
        return this._record('sms', response, { messages: parseSmsAiResponse(response, fallbackSender) });
    }

    /** TTS 缓存键：五段用 US 分隔（文本自带空格不会串味）。 */
    cacheKey(parts) {
        return this._record('cacheKey', JSON.stringify(parts || {}), { key: buildCallTtsCacheKey(parts) });
    }

    /** 头像地址归一：绝对地址原样放行；站内只认 maleN/femaleN 与白名单扩展名。 */
    avatar(value) {
        return this._record('avatar', value, { path: normalizeWechatAvatarPath(value) });
    }

    /** TTS 性别归一：只认 male/m/男 与 female/f/女，其余 ''（不猜）。 */
    ttsGender(gender) {
        return this._record('ttsGender', gender, { gender: normalizeTtsGender(gender) });
    }

    /** 内核三张常量表的读数出口（界面用来展示分段符与占位符）。 */
    constants() {
        return this._record('constants', '', {
            genders: TTS_GENDERS.join('/'),
            separator: TTS_CACHE_KEY_SEPARATOR,
            placeholder: AVATAR_PLACEHOLDER
        });
    }

    destroy() { this._view = null; }
}

export {
    cleanCallAiResponse, cleanCallRejectReason, parseSmsAiResponse,
    buildCallTtsCacheKey, normalizeWechatAvatarPath, normalizeTtsGender,
    TTS_GENDERS, TTS_CACHE_KEY_SEPARATOR, AVATAR_PLACEHOLDER
};
export default PhoneTextApp;