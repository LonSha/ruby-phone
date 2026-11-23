/* ========================================================
 * diagnose-reason-app.js — [v4.192.0] 诊断归因文案 · 控制器
 * --------------------------------------------------------
 * 把 diagnose-reason-core.js 的纯函数接到「一个归因取值怎么读成一句中文」上，
 *   外加存档健康行的拼装试算。
 * 不碰 diagnose-data.js 那个 2921 行的内核（collectDiagnose 是 1880 行的聚合函数，
 *   持 win/storage 与一票 try/catch，是编排面）。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    fieldReasonText, bridgeReasonText, projAbsentText,
    sourceStateText, schemaStateText, storageFaceLine
} from './diagnose-reason-core.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'diagnose_reason_v1';

export class DiagnoseReasonApp {
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
     * [v4.199.0] 换会话：上次归因是**会话数据**（落盘键按会话隔离），
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

    /** 字段级归因：'value'/'absent'/'legacy-null'…（未知取值如实输出原值）。 */
    field(reason) { return this._record('field', reason, { text: fieldReasonText(reason) }); }

    /** 桥归因：'not-mounted'/'engine-empty'… */
    bridge(reason) { return this._record('bridge', reason, { text: bridgeReasonText(reason) }); }

    /** 投影缺席原因：'no-provider'/'skipped'… */
    proj(reason) { return this._record('proj', reason, { text: projAbsentText(reason) }); }

    /** 桥自述态：'idle'/'engine-absent'… */
    source(state) { return this._record('source', state, { text: sourceStateText(state) }); }

    /** 存档 schema 代次：'current'/'legacy'/'future'/'unknown'。 */
    schema(state) { return this._record('schema', state, { text: schemaStateText(state) }); }

    /** 存档健康行：本会话档与全局档分列，一边读不出不说成两边都读不出。 */
    storage(face) {
        return this._record('storage', JSON.stringify(face || {}), { line: storageFaceLine(face) });
    }

    destroy() { this._view = null; }
}

export { fieldReasonText, bridgeReasonText, projAbsentText, sourceStateText, schemaStateText, storageFaceLine };
export default DiagnoseReasonApp;