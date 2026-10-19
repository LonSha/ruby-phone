/* ========================================================
 * creationdesk-board.js — [v4.30.0 · 第四期 R4-X9]
 *   「面向下一幕的写作取材板」接线件（创作台侧取数件）
 *
 * 【本件的位置】夹在纯契约件（config/material-board-contract.js）与视图之间，
 *   只做三件事：
 *     ① **取数**：把宿主窗口交给契约件的四路读数（取材集合 / 逐面明细 / 被挡住 / 选定集合）；
 *     ② **持起点**：记住「用户当前要写哪一幕、选到哪个时点、勾了哪几条」
 *        ——**用户显式选择**，本件不猜；
 *     ③ **落点形状**：把读数 + 四行读数打包给视图，并把「选定集合」原样端出去
 *        （不写第二份状态判定词、不写第二份标签表、**不落笔**）。
 *
 * 【三条纪律（与 archive-canon.js / group-vote.js 同规格）】
 *   · 只读：本件一个字节都不落盘（契约件 writesNothing 恒 true）；
 *     交接（进主聊天 / 进创作草稿）归既有 owner —— 本件只把「用户选了哪几条」端出去；
 *   · 不抛：桥不在 / 面畸形 / 上游缺席，一律降级为归因读数；
 *   · 不猜：没选时点就如实报 `asOfGiven:false`（**不默认挑一个时点**）；
 *     勾了但不在包里的如实进 `notInPack`（**不静默丢掉**）——
 *     把「它没被选进这一场」与「它还没发生」显示成同一句话，正是本件要防的那件事。
 *
 * 【为什么不在实例里缓存读数】与同族两件同一理由：取材面随消息与事实变，
 *   任何实例级缓存都会在新楼层 / 删楼回滚后变成陈旧数据。故本件只持有
 *   `_task / _asOf / _picked`（用户的选择，不是读数），`resetScene()` 把它们清掉。
 * ======================================================== */
'use strict';
import {
    readMaterialPack,
    readMaterialPackSheet,
    readMaterialPackHeld,
    readMaterialPackPick,
    packLine,
    sheetLine,
    heldLine,
    pickLine,
    mbGateOf,
    mbNoteOf,
    mbSelfCheck,
    MB_TASKS,
    MB_TASK_LABEL,
    MB_FACETS,
    MB_FACET_LABEL,
    MB_HELD,
    MB_HELD_LABEL,
    MB_PICK_HELD,
    MB_PICK_HELD_LABEL,
    MB_STATES,
    MB_STATE_HINT,
    MB_REASONS,
    MB_LIMITS
} from '../../config/material-board-contract.js';
export class CreationdeskBoard {
    constructor(app) {
        this.app = app;
        /** 用户显式选的下一幕任务（**空串表示「还没选」**；不回落成「推进」） */
        this._task = '';
        /** 用户显式选的时点（楼层号；**null 表示「还没选」**，不默认挑一个） */
        this._asOf = null;
        /** 用户勾选的取材条目（**有序**；空数组表示「还没勾」） */
        this._picked = [];
    }
    /** 宿主窗口（与 App 同取法：注入优先，回落全局） */
    _win() {
        try {
            if (this.app && typeof this.app._hostWin === 'function') return this.app._hostWin();
            return (typeof window !== 'undefined') ? window : globalThis;
        } catch (_e) { return globalThis; }
    }
    /** 当前任务（'' = 还没选；契约件收到空串会按推进并**说明**，本件不替它填） */
    get task() { return this._task; }
    /** 当前时点（null = 还没选） */
    get asOf() { return this._asOf; }
    /** 当前勾选（副本，防外部改实例态） */
    get picked() { return this._picked.slice(); }
    /** 设下一幕任务；空值即清空（**不回落成「推进」**） */
    setTask(t) {
        const s = String(t == null ? '' : t).trim();
        this._task = (MB_TASKS.indexOf(s) >= 0) ? s : '';
        return this._task;
    }
    /** 设时点；空值即清空（**不默认挑一个楼层**） */
    setAsOf(v) {
        if (v === null || v === undefined || v === '') { this._asOf = null; return null; }
        const n = Number(v);
        this._asOf = Number.isFinite(n) ? Math.floor(n) : null;
        return this._asOf;
    }
    /** 勾 / 取消勾一条取材；空 id 一律忽略（不记空条目） */
    togglePicked(id) {
        const s = String(id == null ? '' : id).trim();
        if (!s) return this._picked.slice();
        const i = this._picked.indexOf(s);
        if (i >= 0) this._picked.splice(i, 1);
        else this._picked.push(s);
        return this._picked.slice();
    }
    /** 清空勾选 */
    clearPicked() { this._picked = []; return []; }
    /* ========== 四路读数（转手内核出口，本件不重判任何一格） ========== */
    /** 取材集合（五态分形：插件缺席 / 面缺席 / 读不出 / 零材料 / 读到） */
    pack(opts) {
        const o = this._opts(opts);
        try { return readMaterialPack(this._win(), o); }
        catch (_e) { return readMaterialPack(null, o); }
    }
    /** 逐面明细（哪一面几条、哪几面空着、空的是不是关键面） */
    sheet(opts) {
        const o = this._opts(opts);
        try { return readMaterialPackSheet(this._win(), o); }
        catch (_e) { return readMaterialPackSheet(null, o); }
    }
    /** 被挡住的三类 + 被取代（逐条具名） */
    held(opts) {
        const o = this._opts(opts);
        try { return readMaterialPackHeld(this._win(), o); }
        catch (_e) { return readMaterialPackHeld(null, o); }
    }
    /** 选定集合（能交的 / 不在包里的 / 时点之后的 —— **三类分列**） */
    pick(opts) {
        const o = this._opts(opts);
        try { return readMaterialPackPick(this._win(), o); }
        catch (_e) { return readMaterialPackPick(null, o); }
    }
    /** 把实例态与调用方给的额外参数合成一次读数的入参（**本件不替调用方改字段**） */
    _opts(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const out = {
            task: (o.task !== undefined ? o.task : this._task),
            picked: (Array.isArray(o.picked) ? o.picked : this._picked),
            asOf: (o.asOf !== undefined ? o.asOf : this._asOf)
        };
        if (o.budget !== undefined) out.budget = o.budget;
        if (Array.isArray(o.materials)) out.materials = o.materials;
        return out;
    }
    /* ========== 四行读数（转手内核，视图不写第二套文案） ========== */
    packLineOf(read) { try { return packLine(read); } catch (_e) { return '取材:读数失败（已降级）'; } }
    sheetLineOf(read) { try { return sheetLine(read); } catch (_e) { return '逐面:读数失败（已降级）'; } }
    heldLineOf(read) { try { return heldLine(read); } catch (_e) { return '被挡住:读数失败（已降级）'; } }
    pickLineOf(read) { try { return pickLine(read); } catch (_e) { return '选定:读数失败（已降级）'; } }
    /* ========== 这一面能不能读（判定词**只许内核一份**，本件只转发） ========== */
    gate(read) {
        try { return mbGateOf(read); }
        catch (_e) { return mbGateOf(null); }
    }
    /** 读数的一句说明（'' = 没有要说的） */
    note(read) {
        try { return mbNoteOf(read); }
        catch (_e) { return ''; }
    }
    /* ========== 标签（界面文案的唯一出处 = 内核表） ========== */
    taskIds() { return MB_TASKS.slice(); }
    taskLabel(t) { return MB_TASK_LABEL[t] || String(t == null ? '' : t); }
    facetIds() { return MB_FACETS.slice(); }
    facetLabel(f) { return MB_FACET_LABEL[f] || String(f == null ? '' : f); }
    /** 被挡住四格的 id 与标签（界面不写第二份分列表）。 */
    heldBucketIds() { return MB_HELD.slice(); }
    heldBucketLabel(b) { return MB_HELD_LABEL[b] || String(b == null ? '' : b); }
    /** 选定两类未取的 id 与标签（界面不写第二份分列表）。 */
    pickHeldIds() { return MB_PICK_HELD.slice(); }
    pickHeldLabel(b) { return MB_PICK_HELD_LABEL[b] || String(b == null ? '' : b); }
    stateIds() { return Object.values(MB_STATES).slice(); }
    stateHint(s) { return MB_STATE_HINT[s] || ''; }
    reasonText(r) { return MB_REASONS[String(r || '')] || ''; }
    /** 上限的唯一出处（视图不自己拟一个条数）。 */
    limits() { return MB_LIMITS; }
    /* ========== 一次取齐（视图用；保证同一份读数上的多面同源） ========== */
    packAll(opts) {
        const o = this._opts(opts);
        const read = this.pack(o);
        const sheet = this.sheet(o);
        const held = this.held(o);
        const pick = this.pick(o);
        return {
            read: read,
            sheet: sheet,
            held: held,
            pick: pick,
            lines: {
                pack: this.packLineOf(read),
                sheet: this.sheetLineOf(sheet),
                held: this.heldLineOf(held),
                pick: this.pickLineOf(pick)
            },
            gate: this.gate(read),
            note: this.note(read),
            task: this._task,
            asOf: this._asOf,
            picked: this._picked.slice(),
            state: read.state
        };
    }
    /**
     * 交接形状（**本件不落笔**）：把「用户选的这几条 + 去哪一幕」打包成一份**读数**，
     *   交给既有 owner（注入预算 owner / 草稿 owner）去真正使用。
     *   ★ 本件**不写任何键**、**不发布**、**不生成正文** —— 只算并端出。
     *   ★ 取消（`cancel`）**不触发生成**：它只清实例态并返回一份「已取消」读数。
     * @returns {{ok,kind,reason,task,taskLabel,asOf,ids[],count,chars,items[],notInPack[],afterAsOf[],handoff}}
     */
    handoff(opts) {
        const o = this._opts(opts);
        const p = this.pick(o);
        return {
            ok: p.ok === true,
            kind: 'material_board_handoff',
            reason: p.ok ? '' : (p.state || MB_STATES.ENGINE_ABSENT),
            task: p.task,
            taskLabel: p.taskLabel,
            asOf: p.asOf,
            ids: p.ids.slice(),
            count: p.count,
            chars: p.chars,
            items: p.items.slice(),
            notInPack: p.notInPack.slice(),
            afterAsOf: p.afterAsOf.slice(),
            /** 交接对象是**既有 owner**，本件不替它们做（也不假装已经做了） */
            handoff: { composeOwner: 'context-compose', budgetOwner: 'injection-router', draftOwner: 'creation-pipeline' },
            writesNothing: true
        };
    }
    /** 取消：只清实例态，**不触发生成、不落盘**（验收②）。 */
    cancel() {
        this.clearPicked();
        this._asOf = null;
        return { ok: true, kind: 'material_board_cancel', writesNothing: true, generated: false };
    }
    /** 换会话 / 清数据：丢弃用户的选择（读数本来就不缓存） */
    resetScene() {
        this._task = '';
        this._asOf = null;
        this._picked = [];
    }
    /** 自检：转发内核九条口径真跑（本件不另立一份自检） */
    selfCheck() {
        try { return mbSelfCheck(); }
        catch (_e) { return { problems: ['selfcheck-threw'] }; }
    }
}
export default CreationdeskBoard;