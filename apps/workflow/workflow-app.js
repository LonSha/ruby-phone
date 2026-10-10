/* ========================================================
 * workflow-app.js — [v3.89.0 · 拓展计划 R-X5] 声明式工作流 · 落盘与接线
 * 一条会话键走 ^wf_ 前缀随会话隔离：wf_runs 运行台账。
 * 判定与计划全在 config/workflow.js（纯函数），本件只做「读 → 判 → 落 → 渲染」。
 *
 * 【本件刻意不做的事】
 *   · **不执行任何用户脚本**：没有步骤编辑器、没有自定义步骤，也没有 eval / new Function /
 *     srcdoc / iframe / 字符串拼函数名。能跑的流程**完全由内核的声明表固定**。
 *   · 不在本件里判「能不能跑」：计划 / 幂等 / 跨段 / 默认 dry-run 全由内核判；
 *     本件只把动作交给咽喉（`applyWorkflowAction`）—— 重判就是同一口径两份实现。
 *   · 不自己拼行面：步骤行 / 总括行 / 权限行全走内核的 wfStepLine / wfSummaryLine / wfLevelLine。
 * ========================================================= */
'use strict';
import { WF_FLOWS, WF_STATES, wfStateText, wfSummaryLine, wfLevelLine, workflowSelfCheck } from '../../config/workflow.js';
import { WorkflowView } from './workflow-view.js';

export class WorkflowApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._flash = '';
        this._flashBad = false;
        this._openId = '';
    }
    /* ---------- 读数（本件只做「取」，判定在内核） ---------- */
    /** 宿主咽喉的只读读数口（不得在本件里再算一次）。 */
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.workflowFace === 'function') ? vp.workflowFace() : null;
        } catch (_e) { return null; }
    }
    /* ---------- 交互（全部转咽喉，一个字节都不自己写） ---------- */
    setOpen(id) { this._openId = String(id || ''); this.render(); return this._openId; }
    async act(action, flowId, extra) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyWorkflowAction !== 'function') {
            this._flash = '工作流入口不在位（咽喉未就绪）'; this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const scope = face?.scope;
        const token = face?.token;
        let r;
        try { r = await vp.applyWorkflowAction(Object.assign({ action, flowId, scope, token }, extra || {})); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now?.token !== token || JSON.stringify(now?.scope) !== JSON.stringify(scope)) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    /* ---------- 渲染 ---------- */
    render() {
        if (!this._view) this._view = new WorkflowView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const sc = host?.scope || {};
        const runs = host?.runs || { readable: false, entries: [], dropped: 0 };
        const flows = (host?.flows || WF_FLOWS.map(f => ({ id: f.id, label: f.label, hint: f.hint, blocked: true, problems: ['尚未取数'], steps: [] })))
            .map(f => Object.assign({}, f, { open: this._openId === f.id }));
        const self = workflowSelfCheck();
        return {
            scope: sc,
            scopeOk: host?.scopeState === 'ok',
            runs: runs,
            runsText: runs.readable
                ? ('运行台账 ' + String(runs.entries.length) + ' 条' + (runs.dropped ? ('（另有 ' + String(runs.dropped) + ' 条认不出）') : ''))
                : '运行台账**读不到**（不是「没跑过」—— 这两件事处置相反）',
            flows: flows,
            levels: wfLevelLine(),
            states: this._stateRows(),
            hostLine: host ? ('宿主读数已取到（' + String((host.flows || []).length) + ' 条流程）') : '宿主读数**还没取到**（咽喉那一轮尚未跑）',
            run: host ? host.run : null,
            runLine: wfSummaryLine(host?.run),
            selfCheck: { problems: self.problems || [], flows: self.flows, owners: self.owners },
            flash: this._flash, flashBad: this._flashBad
        };
    }
    /** 九态互不同形：把每一态的名字与处置都摆出来（不合并、不省略）。 */
    _stateRows() {
        const out = [];
        for (const k of Object.keys(WF_STATES)) {
            out.push({ key: k, label: WF_STATES[k].label, text: wfStateText(k) });
        }
        return out;
    }
    selfCheck() { return workflowSelfCheck(); }
    onChatChanged() {
        /* 换会话必须丢**实例态**：展开的流程 / 提示行；台账与读数的重取交给咽喉与下一次 render。 */
        this._openId = '';
        this._flash = '';
        this._flashBad = false;
        this.render();
    }
    destroy() { this._view = null; }
}

