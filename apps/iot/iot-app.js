/* ========================================================
 * iot-app.js — [v4.186.0] 智能家居中枢 · 控制器
 *
 * 规格照照 block / weather / focus 同族：取数 → 纯函数 → 视图；落盘走唯一回执实现。
 * 本件只做三件事：读、算（交给 iot-data 纯函数）、写。渲染交给 iot-view。
 *
 * 【三处不能有】
 *   ① 零网络（源里没有请求，但也没有“不请求”的说明；本件写明）；
 *   ② 零定时器（场景不会“到点自己变”—— 要变由用户/生成侧给一次性指令）；
 *   ③ 不拼叙事（`promptBlock()` 只把 `iotPromptBlock()` 的事实读数出去）。
 * ======================================================== */
'use strict';
import {
    IOT_FACE, IOT_DEVICES, IOT_SCENES, IOT_LIMITS, AC_MODES,
    defaultIotState, normalizeIotState, applyScene, setDeviceProp,
    readIotFace, projectIot, iotPromptBlock,
} from './iot-data.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 会话键：必须命中 config/storage.js 的 CHAT_DATA_PATTERNS 里 /^iot_/，否则跨会话串味 */
const STATE_KEY = 'iot_state';

import { IotView } from './iot-view.js';
export class IotApp {
    render() {
        this._view ??= new IotView(this, this.shell);
        this._view.render();
    }
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this.state = defaultIotState();
        this.storageOk = true;
        this.notes = [];
        this._view = null;
        this._load();
    }

    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            if (typeof raw === 'string') return JSON.parse(raw);
            return raw;
        } catch (_e) {
            /* 读不出 ≠ 没设过：由 storageOk 记着，面会分开报 */
            this.storageOk = false;
            return null;
        }
    }

    _writeJSON(key, v) {
        try {
            if (!this.storage) { this.storageOk = false; return false; }
            const raw = JSON.stringify(v);
            const r = writeReceipt(this.storage, key, raw);
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
        if (raw === null) {
            this.state = defaultIotState();
            if (this.storageOk) this.storageOk = true;
            return;
        }
        const norm = normalizeIotState(raw);
        this.state = norm.state;
        this.notes = norm.notes || [];
    }

    _save() {
        return this._writeJSON(STATE_KEY, this.state);
    }

    get face() { return readIotFace(this.state, this.storageOk); }

    projection() { return projectIot(this.state); }

    /** 生成侧/宿主走这个口取事实。不返回任何叙事。 */
    promptBlock() {
        if (!this.storageOk) return '【室内设备读数】存储读不出（不是“没设过”）';
        return iotPromptBlock(this.state);
    }

    activateScene(sceneId) {
        const r = applyScene(this.state, sceneId);
        if (!r.ok) return r;
        this.state = r.state;
        this.notes = r.changes.slice();
        const saved = this._save();
        return { ok: true, changes: r.changes, saved };
    }

    setProp(devId, key, value) {
        const r = setDeviceProp(this.state, devId, key, value);
        if (!r.ok) return r;
        this.state = r.state;
        this.state.notes = r.notes;
        const saved = this._save();
        return { ok: true, notes: r.notes, saved };
    }

    togglePower(devId) {
        const dev = IOT_DEVICES.find((d) => d.id === devId);
        if (!dev) return { ok: false, reason: 'unknown_device' };
        const cur = this.state.devices[devId] || {};
        return this.setProp(devId, 'power', !(cur.power === true));
    }

    reset() {
        this.state = defaultIotState();
        this.notes = [];
        return { ok: true, saved: this._save() };
    }

    /**
     * [v4.199.0] 换会话：设备状态本身就是会话数据（键 iot_state 命中 CHAT_DATA_PATTERNS 的 /^iot_/），
     * 所以换会话必须整份重取 —— 否则 A 会话调好的房间读数会原样出现在 B 会话里。
     * 只丢一次性提示与只读视图引用，不写盘（换会话不该产生副作用）。
     */
    onChatChanged() {
        this.notes = [];
        this._load();
    }

    destroy() { this._view = null; }
}

export { IOT_FACE, IOT_DEVICES, IOT_SCENES, IOT_LIMITS, AC_MODES };
export default IotApp;
