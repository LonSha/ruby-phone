/* ========================================================
 * archive-canon.js — [v4.28.0 · 第四期 R4-X4]
 *   「支线结局选择与接续工作区」接线件（存档台第五页签的取数件）
 *
 * 【本件的位置】夹在纯契约件（config/branch-canon-contract.js）与视图之间，
 *   只做三件事：
 *     ① **取数**：把宿主窗口交给契约件的六路读数
 *        （列举 / 计划 / 预览 / 落卷 / 凭据 / 撤销）；
 *     ② **持起点**：记住「用户当前要定哪一位冲突」——**用户显式点选**，本件不猜；
 *     ③ **落点形状**：把读数 + 四行读数打包给视图，并把「去确认」的动作
 *        **原样转出去**（不写第二份状态判定词、不写第二份标签表）。
 *
 * 【三条纪律（与 plotline-board.js 同规格）】
 *   · 只读：本件一个字节都不落盘（契约件 writesNothing 恒 true）；
 *     分卷写入与撤销归上游 owner，手机只读预览并转原生确认；
 *   · 不抛：桥不在 / 面畸形 / 上游缺席，一律降级为归因读数；
 *   · 不猜：没选冲突位时如实报「还没选」，**不默认挑第一位**
 *     （那会把「用户还没定」伪装成「这一位已经定了」）。
 *
 * 【为什么不在实例里缓存读数】与 plotline-board 同一理由：正史面随会话变，
 *   任何实例级缓存都会在换会话 / 删楼回滚后变成陈旧数据。故本件只持有
 *   `_slot`（用户的选择，不是读数），`resetScene()` 把它清掉。
 * ======================================================== */
'use strict';
import {
    readBranchCanonState,
    readBranchCanonPlan,
    readBranchCanonPreview,
    readBranchCanonAdopt,
    readBranchCanonAdoption,
    readBranchCanonRevokeGuard,
    readBranchCanonRevokeScope,
    canonLine,
    planLine,
    adoptLine,
    revokeLine,
    canonGateOf,
    canonNoteOf,
    bcSelfCheck,
    BC_DECISIONS,
    BC_DECISION_LABEL,
    BC_CLASH_LABEL,
    BC_ADOPT_LABEL,
    BC_PROVENANCE_LABEL,
    BC_UNMAPPED_LABEL,
    BC_REVOKE_BUCKETS,
    BC_REVOKE_LABEL,
    BC_STATE_HINT
} from '../../config/branch-canon-contract.js';
export class ArchiveCanon {
    constructor(app) {
        this.app = app;
        /** 当前选中的冲突位（**用户显式选择**；空串表示「还没选」） */
        this._slot = '';
    }
    /** 宿主窗口（与 App 同取法：注入优先，回落全局） */
    _win() {
        try {
            if (this.app && typeof this.app._win === 'function') return this.app._win();
            return (typeof window !== 'undefined') ? window : globalThis;
        } catch (_e) { return globalThis; }
    }
    /* ========== 六路读数（转手内核出口，本件不重判任何一格） ========== */
    /** 冲突列举（五态分形：插件缺席 / 面缺席 / 读不出 / 零冲突位 / 正常） */
    state(opts) {
        try { return readBranchCanonState(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonState(null); }
    }
    /** 结算计划（四档分列 + 未选尽单独报） */
    plan(opts) {
        try { return readBranchCanonPlan(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonPlan(null, opts || {}); }
    }
    /** 交接预览（未选尽 ⇒ blocked，**本件不替它出半份包**） */
    preview(opts) {
        try { return readBranchCanonPreview(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonPreview(null, opts || {}); }
    }
    /** 落卷计划（三态**不许压平**：可接 / 待选尽 / 无可接条目） */
    adopt(opts) {
        try { return readBranchCanonAdopt(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonAdopt(null, opts || {}); }
    }
    /** 落卷凭据（幂等键 + 撤销范围；**本件不传 commit**，落笔归上游） */
    adoption(opts) {
        try { return readBranchCanonAdoption(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonAdoption(null, opts || {}); }
    }
    /** 撤销保护面（四张表 + 两条口径写成读数） */
    revokeGuard(opts) {
        try { return readBranchCanonRevokeGuard(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonRevokeGuard(null, opts || {}); }
    }
    /** 撤销范围（批次级：只撤本次接续，原分支零写） */
    revokeScope(opts) {
        try { return readBranchCanonRevokeScope(this._win(), opts || {}); }
        catch (_e) { return readBranchCanonRevokeScope(null, opts || {}); }
    }
    /* ========== 四行读数（转手内核，视图不写第二套文案） ========== */
    canonLineOf(read) { try { return canonLine(read); } catch (_e) { return '结局:读数失败（已降级）'; } }
    planLineOf(read) { try { return planLine(read); } catch (_e) { return '选择:读数失败（已降级）'; } }
    adoptLineOf(read) { try { return adoptLine(read); } catch (_e) { return '落卷:读数失败（已降级）'; } }
    revokeLineOf(read) { try { return revokeLine(read); } catch (_e) { return '撤回:读数失败（已降级）'; } }
    /* ========== 这一面能不能读（判定词**只许内核一份**，本件只转发） ========== */
    gate(read) {
        try { return canonGateOf(read); }
        catch (_e) { return canonGateOf(null); }
    }
    /** 读数的一句说明（'' = 没有要说的） */
    note(read) {
        try { return canonNoteOf(read); }
        catch (_e) { return ''; }
    }
    /* ========== 起点（用户显式选择，不猜） ========== */
    get slot() { return this._slot; }
    /** 设为要定的那一位冲突；空值即清空（**不回落成「默认第一位」**） */
    setSlot(key) {
        const s = String(key == null ? '' : key).trim();
        this._slot = s.slice(0, 120);
        return this._slot;
    }
    clearSlot() { this._slot = ''; return ''; }
    /* ========== 标签（界面文案的唯一出处 = 内核表） ========== */
    decisionIds() { return BC_DECISIONS.slice(); }
    decisionLabel(d) { return BC_DECISION_LABEL[d] || String(d == null ? '' : d); }
    clashLabel(v) { return BC_CLASH_LABEL[v] || String(v == null ? '' : v); }
    adoptLabel(v) { return BC_ADOPT_LABEL[v] || String(v == null ? '' : v); }
    provLabel(v) { return BC_PROVENANCE_LABEL[v] || String(v == null ? '' : v); }
    unmappedLabel(v) { return BC_UNMAPPED_LABEL[v] || String(v == null ? '' : v); }
    revokeLabel(v) { return BC_REVOKE_LABEL[v] || String(v == null ? '' : v); }
    /** 撤销四张表的**表名与顺序**的唯一出处（视图不写第二份表名表）。 */
    revokeBuckets() { return BC_REVOKE_BUCKETS.slice(); }
    stateHint(s) { return BC_STATE_HINT[s] || ''; }
    /* ========== 一次取齐（视图用；保证同一份读数上的多面同源） ========== */
    pack(opts) {
        const o = opts || {};
        const st = this.state(o);
        const pl = this.plan(o);
        const pv = this.preview(o);
        const ad = this.adopt(o);
        const ao = this.adoption(o);
        const rg = this.revokeGuard(o);
        return {
            state: st,
            plan: pl,
            preview: pv,
            adopt: ad,
            adoption: ao,
            revoke: rg,
            lines: {
                canon: this.canonLineOf(st),
                plan: this.planLineOf(pl),
                adopt: this.adoptLineOf(ad),
                revoke: this.revokeLineOf(rg)
            },
            slot: this._slot
        };
    }
    /** 换会话 / 清数据：只丢弃「上一次选了哪一位」（读数本来就不缓存） */
    resetScene() { this._slot = ''; }
    /** 自检：转发内核九条口径真跑（本件不另立一份自检） */
    selfCheck() {
        try { return bcSelfCheck(); }
        catch (_e) { return { problems: ['selfcheck-threw'] }; }
    }
}
export default ArchiveCanon;
