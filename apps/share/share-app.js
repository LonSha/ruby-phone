/* ========================================================
 * share-app.js — [v4.187.0] 近场快传 · 控制器
 *
 * 规格照 iot / weather / focus 同族：取数 -> 纯函数 -> 视图；落盘走唯一回执实现。
 *
 * 【三处不能有】
 *   ① 零网络（原来的 share 内核就有这一坑：把 handlerUri 编成 app.id://share_receive，
 *      而全仓没有任何东西在监听它 —— 本件不编 URI）；
 *   ② 零定时器（设备不会“到点自己出现”—— 碰一下才出现，离开就离开）；
 *   ③ 不拼叙事（promptBlock() 只把 sharePromptBlock() 的事实读数出去）。
 * ======================================================== */
'use strict';
import {
    SHARE_FACE, SHARE_REJECT, SHARE_KINDS, NEARBY_LIMITS,
    defaultShareState, normalizeShareState, readShareFace,
    bumpDevice, leaveDevice, exchangePayload, sharePromptBlock,
} from './share-data.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 会话键：命中 config/storage.js 的 CHAT_DATA_PATTERNS 里 /^share_/，随会话隔离 */
const STATE_KEY = 'share_nearby_v1';

export class ShareApp {
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this.state = defaultShareState();
        this.storageOk = true;
        this._view = null;
        this._load();
    }

    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            if (typeof raw === 'string') return JSON.parse(raw);
            return raw;
        } catch (_e) {
            /* 读不出 != 没设过：由 storageOk 记着，面会分开报 */
            this.storageOk = false;
            return null;
        }
    }

    _writeJSON(key, v) {
        try {
            if (!this.storage) { this.storageOk = false; return false; }
            const r = writeReceipt(this.storage, key, JSON.stringify(v));
            const ok = r.saved === true;
            if (!ok) this.storageOk = false;
            return ok;
        } catch (_e) {
            this.storageOk = false;
            return false;
        }
    }

    _load() {
        const raw = this._readJSON(STATE_KEY);
        this.state = normalizeShareState(raw);
    }

    _save() { return this._writeJSON(STATE_KEY, this.state); }

    get face() {
        return this.storageOk ? readShareFace(this.state) : SHARE_FACE.IDLE;
    }

    /** 生成侧 / 宿主走这个口取事实。不返回任何叙事。 */
    promptBlock() {
        if (!this.storageOk) return '【近场快传读数】存储读不出（不是“没设过”）';
        return sharePromptBlock(this.state);
    }

    /** 碰一下：设备进范围。at 由调用方传入，控制器自己取 now。 */
    bump(device) {
        const r = bumpDevice(this.state, device, Date.now());
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, saved: this._save() };
    }

    leave(deviceId) {
        const r = leaveDevice(this.state, deviceId);
        this.state = r.state;
        return { ok: r.ok, reason: r.ok ? null : SHARE_REJECT.unknownDevice, saved: this._save() };
    }

    /** 交换：控制器只负责把 now 补上，业务判定全在内核。 */
    send(deviceId, payload) {
        const r = exchangePayload(this.state, deviceId, payload, Date.now());
        if (!r.ok) return r;
        this.state = r.state;
        return { ok: true, reason: null, record: r.record, saved: this._save() };
    }

    reset() {
        this.state = defaultShareState();
        return { ok: true, saved: this._save() };
    }

    /**
     * [v4.199.0] 换会话：本 App 的读数全是**会话数据**（落盘键按会话隔离），
     * 换会话必须整份重取 —— 与构造走同一条路径（this._load()），
     * 否则 A 会话的『分享台账』会原样留在 B 会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this.storageOk = true;
        this._view = null;
        this._load();
    }

    destroy() { this._view = null; }
}

export { SHARE_FACE, SHARE_REJECT, SHARE_KINDS, NEARBY_LIMITS };
export default ShareApp;
