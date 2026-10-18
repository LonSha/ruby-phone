/* ========================================================
 * plotline-board.js — [v4.27.0 · 第四期 R4-X6]
 *   「可操作的线索与未完事项板」接线件
 *
 * 【本件的位置】夹在纯契约件与视图之间，只做三件事：
 *   ① **取数**：把宿主 window 交给 config/causal-board-contract.js 的四出口；
 *   ② **持起点**：记住「用户当前要追哪条线」——**用户显式点选**，本件不猜；
 *   ③ **落点形状**：把四路读数 + 三行读数打包给视图，并把「该去哪个 App」
 *      的声明**原样转发**（不写第二份 App 名映射、不写第二份标签表）。
 *
 * 【三条纪律（与 plotline-app.js 同规格）】
 *   · 只读：绝不写上游状态，也绝不替用户标「已解决」（契约件 writesNothing 恒 true）；
 *   · 不抛：桥不在 / 面畸形 / 上游缺席，一律降级为归因读数；
 *   · 不猜：没选起点时追溯如实报 `no-subject`，**不默认挑一条线**（那会把
 *     「用户没说要追哪条」伪装成「这条线没有源头」）。
 *
 * 【为什么不在实例里缓存读数】与 plotline-app 同一理由：因果面随会话变，
 *   任何实例级缓存都会在换会话 / 删楼回滚后变成陈旧数据。故本件只持有
 *   `_focus`（用户的选择，不是读数），`resetScene()` 把它清掉。
 * ======================================================== */
'use strict';
import {
    readCausalBoard,
    readCausalTodos,
    readCausalTrace,
    readCausalProposals,
    boardLine,
    todosLine,
    traceLine,
    cbSelfCheck,
    CB_ACTIONS,
    CB_NODE_KINDS,
    CB_KIND_LABEL,
    CB_CLOSURE,
    CB_CLOSURE_LABEL,
    boardGateOf,
    traceNoteOf
} from '../../config/causal-board-contract.js';
export class PlotlineBoard {
    constructor(app) {
        this.app = app;
        /** 当前追踪起点（**用户显式选择**；空串表示「还没选」） */
        this._focus = '';
    }
    /** 宿主窗口（与 App 同取法：注入优先，回落全局） */
    _win() {
        try {
            if (this.app && typeof this.app._win === 'function') return this.app._win();
            return (typeof window !== 'undefined') ? window : globalThis;
        } catch (_e) { return globalThis; }
    }
    /* ========== 四路读数（转手内核出口，本件不重判任何一格） ========== */
    /** 因果图（四收口分列 + 已确认边 / 推测边两列） */
    board(opts) {
        try { return readCausalBoard(this._win(), opts || {}); }
        catch (_e) { return readCausalBoard(null); }
    }
    /** 未解待办（按上游给的顺序，含行动声明） */
    todos(opts) {
        try { return readCausalTodos(this._win(), opts || {}); }
        catch (_e) { return readCausalTodos(null, opts || {}); }
    }
    /** 追溯（**没选起点时如实报 no-subject**） */
    trace(id, opts) {
        const start = (id === undefined || id === null || id === '') ? this._focus : id;
        try { return readCausalTrace(this._win(), start, opts || {}); }
        catch (_e) { return readCausalTrace(null, start, opts || {}); }
    }
    /** 候选边（恒为推测：手机端不替用户确认因果） */
    proposals(opts) {
        try { return readCausalProposals(this._win(), opts || {}); }
        catch (_e) { return readCausalProposals(null, opts || {}); }
    }
    /* ========== 三行读数（转手内核，视图不写第二套文案） ========== */
    boardLineOf(read) { try { return boardLine(read); } catch (_e) { return '线索:读数失败（已降级）'; } }
    todosLineOf(read) { try { return todosLine(read); } catch (_e) { return '待办:读数失败（已降级）'; } }
    traceLineOf(read) { try { return traceLine(read); } catch (_e) { return '追溯:读数失败（已降级）'; } }
    /* ========== 这一面能不能读（判定词**只许内核一份**，本件只转发） ========== */
    /** 读不到时给一句处置建议；读到则 readable=true、hint='' */
    gate(read) {
        try { return boardGateOf(read); }
        catch (_e) { return boardGateOf(null); }
    }
    /** 追溯读数的一句说明（'' = 没有要说的） */
    traceNote(read) {
        try { return traceNoteOf(read); }
        catch (_e) { return ''; }
    }
    /* ========== 起点（用户显式选择，不猜） ========== */
    get focus() { return this._focus; }
    /** 设为要追的那条线；空值即清空（**不回落成「默认第一条」**） */
    setFocus(id) {
        const s = String(id == null ? '' : id).trim();
        this._focus = s.slice(0, 120);
        return this._focus;
    }
    clearFocus() { this._focus = ''; return ''; }
    /* ========== 落点（界面选项 / 标签的唯一出处 = 内核表） ========== */
    /** 节点类别 id 列表（界面下拉项的唯一出处） */
    kindIds() { return CB_NODE_KINDS.slice(); }
    /** 四收口 id 列表 */
    closureIds() { return CB_CLOSURE.slice(); }
    /** 类别标签（视图不写第二份标签表） */
    kindLabel(kind) { return CB_KIND_LABEL[kind] || String(kind == null ? '' : kind); }
    /** 收口标签 */
    closureLabel(closure) { return CB_CLOSURE_LABEL[closure] || String(closure == null ? '' : closure); }
    /**
     * 该去哪个 App（**声明式**：本件不执行跳转，只把内核给的路由转出来）。
     * @returns {{app:string,label:string}|null} 未知类别如实给 null
     */
    actionFor(kind) {
        const k = String(kind == null ? '' : kind).trim().toLowerCase();
        const act = CB_ACTIONS[k];
        return act ? { app: act.app, label: act.label } : null;
    }
    /* ========== 一次取齐（视图用；保证同一份读数上的多面同源） ========== */
    /**
     * @param {{maxNodes?:number, maxEdges?:number}} [opts]
     * @returns 四路读数 + 三行读数 + 当前起点（未选起点时追溯如实为 no-subject）
     */
    pack(opts) {
        const o = opts || {};
        const b = this.board(o);
        const t = this.todos(o);
        const tr = this.trace(undefined, o);
        const pr = this.proposals(o);
        return {
            board: b,
            todos: t,
            trace: tr,
            proposals: pr,
            lines: { board: this.boardLineOf(b), todos: this.todosLineOf(t), trace: this.traceLineOf(tr) },
            focus: this._focus
        };
    }
    /** 换会话 / 清数据：只丢弃「上一次选了哪条线」（读数本来就不缓存） */
    resetScene() { this._focus = ''; }
    /** 自检：转发内核八条口径真跑（本件不另立一份自检） */
    selfCheck() {
        try { return cbSelfCheck(); }
        catch (_e) { return { problems: ['selfcheck-threw'] }; }
    }
}
export default PlotlineBoard;