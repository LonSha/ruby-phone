/* ========================================================
 * workflow-view.js — [v3.89.0 · 拓展计划 R-X5] 声明式工作流 · 视图（纯渲染）
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 *
 * 【本视图刻意不做的事（验收④的落点）】
 *   · **不执行用户 JS**：不 eval / 不 new Function / 不 srcdoc / 不建 iframe；
 *     不把任何用户串拼成函数名。步骤是**数据**，只被渲染成行。
 *   · **不写存储**：所有动作都转 app.act()，由咽喉收口；本层零 storage 调用。
 *   · **不自己判**：缺件 / 幂等 / 跨段 / 默认 dry-run 的名字与文案全部来自内核。
 *   · 动作白名单**只有五个**：preview / run / pause / resume / rollback
 *     （data-wf-act），加上一个纯视图态 data-wf-open。其余 data-* 一律不认 ——
 *     「受限声明式」的意思就是「认得出的动作是有限的」。
 * ========================================================= */
'use strict';
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';
const DASH = String.fromCharCode(45, 45);
function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}
export class WorkflowView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root && this.root.isConnected) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'wfl-root';
        container.appendChild(root);
        this.root = root;
        return this.root;
    }
    render(vm) {
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(vm);
        this._bind(el);
    }
    _head(vm) {
        let h = '<div class="wfl-head">';
        h += '<div class="wfl-title">声明式工作流</div>';
        h += '<div class="wfl-sub">流程与权限由内置声明表固定 —— 没有步骤编辑器，也不执行任何脚本</div>';
        h += '<div class="wfl-reads">权限档：' + esc(vm.levels) + '</div>';
        h += '<div class="wfl-reads">' + esc(vm.runsText) + '</div>';
        h += '<div class="wfl-reads">' + (vm.scopeOk ? '会话身份齐备' : '会话身份缺项（缺项即判「不是同一段」，一律不开工）') + '</div>';
        h += '<div class="wfl-reads">' + esc(vm.hostLine) + '</div>';
        const sc = vm.selfCheck || {};
        const probs = sc.problems || [];
        h += '<div class="wfl-self' + (probs.length ? ' wfl-self-bad' : '') + '">' +
            (probs.length ? ('自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；'))) : ('自检通过（流程 ' + String(sc.flows) + ' / owner ' + String(sc.owners) + '）')) +
            '</div>';
        if (vm.flash) h += '<div class="wfl-flash' + (vm.flashBad ? ' wfl-flash-bad' : '') + '">' + esc(vm.flash) + '</div>';
        if (vm.run) {
            h += '<div class="wfl-run">' + esc(vm.runLine) +
                (vm.run.readback ? (' · 回读 ' + esc(vm.run.readback.phase)) : '') + '</div>';
        }
        return h + '</div>';
    }
    _flow(f) {
        let h = '<div class="wfl-flow">';
        h += '<div class="wfl-flow-head">';
        h += '<span class="wfl-flow-label">' + esc(f.label) + '</span>';
        h += '<button class="wfl-open" data-wf-open="' + esc(f.id) + '">' + (f.open ? '收起' : '展开') + '</button>';
        h += '</div>';
        h += '<div class="wfl-flow-hint">' + esc(f.hint) + '</div>';
        h += '<div class="wfl-flow-read">' +
            (f.blocked ? ('开不了工：' + esc((f.problems || []).join(' / '))) : '预览就绪（默认 dry-run：不点头一个字节都不写）') +
            ' · 默认预览 ' + esc(f.planKind || '') + (f.planWhy ? ('（' + esc(f.planWhy) + '）') : '') + '</div>';
        if (f.open) {
            h += '<div class="wfl-steps">';
            for (const st of (f.steps || [])) {
                h += '<div class="wfl-step' + (st.writes ? ' wfl-step-write' : '') + '">';
                h += '<div class="wfl-step-head"><span class="wfl-step-label">' + esc(st.label) + '</span>' +
                    '<span class="wfl-step-lv">' + esc(st.levelLabel) + '</span></div>';
                h += '<div class="wfl-step-meta">owner ' + esc(st.owner) + ' · 产出 ' + esc(st.out) + '</div>';
                h += '<div class="wfl-step-faces">输入面：';
                if (!(st.faces || []).length) h += '（无）';
                for (const fa of (st.faces || [])) h += esc(fa.face) + '(' + esc(fa.state) + ') ';
                h += '</div>';
                if ((st.problems || []).length) h += '<div class="wfl-step-bad">' + esc(st.problems.join(' / ')) + '</div>';
                h += '</div>';
            }
            h += '</div>';
        }
        h += '<div class="wfl-acts">';
        h += '<button class="wfl-btn" data-wf-act="preview" data-wf-flow="' + esc(f.id) + '">预览（只读）</button>';
        h += '<button class="wfl-btn wfl-btn-run" data-wf-act="run" data-wf-flow="' + esc(f.id) + '">确认并运行</button>';
        h += '<button class="wfl-btn" data-wf-act="pause" data-wf-flow="' + esc(f.id) + '">暂停</button>';
        h += '<button class="wfl-btn" data-wf-act="resume" data-wf-flow="' + esc(f.id) + '">确认重试</button>';
        h += '<button class="wfl-btn" data-wf-act="rollback" data-wf-flow="' + esc(f.id) + '">确认回滚</button>';
        h += '</div></div>';
        return h;
    }
    _stateBox(vm) {
        let h = '<div class="wfl-box"><h3>九态（互不同形：完成与部分完成必须分得开）</h3>';
        for (const s of (vm.states || [])) h += '<div class="wfl-row"><span class="wfl-row-k">' + esc(s.label) + '</span><span class="wfl-row-v">' + esc(s.text) + '</span></div>';
        return h + '</div>';
    }
    _html(vm) {
        let h = '<div class="wfl-wrap">';
        h += this._head(vm);
        h += '<div class="wfl-flows">';
        for (const f of (vm.flows || [])) h += this._flow(f);
        h += '</div>';
        h += this._stateBox(vm);
        h += '</div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-wf-open]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setOpen(b.getAttribute('data-wf-open')); });
        });
        el.querySelectorAll('[data-wf-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-wf-act');
                const id = b.getAttribute('data-wf-flow');
                /* 运行 = 显式确认（默认 dry-run 的落点：**用户点这一下**就是确认）。 */
                const extra = (['run', 'resume', 'rollback'].includes(act)) ? { confirm: true } : null;
                self.app.act(act, id, extra);
            });
        });
    }
}
