/* ========================================================
 * freehome-view.js — [v3.50.0] 自由桌面布局案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形；键面不重列。
 * ======================================================== */
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
function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : DASH; }

export class FreehomeView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'fh-root';
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
    _html(vm) {
        const r = vm.readings || {};
        let h = '<div class="fh-wrap">';
        h += '<div class="fh-head"><span class="fh-face">' + esc(vm.layout ? '已收布局' : '还没收过布局') + '</span>' +
            '<span class="sg-kv">页 ' + num(r.pages) + ' / 余 ' + num(r.pagesLeft) + ' · app ' + num(r.apps) + ' · 夹 ' + num(r.folders) + ' · 组件 ' + num(r.widgets) + '</span></div>';
        h += '<div class="fh-sec"><h3>收布局（JSON）</h3>' +
            '<textarea class="fh-input" data-in="layout"></textarea>' +
            '<button class="fh-btn" data-act="intake">收下布局</button>' +
            '<button class="fh-btn" data-act="audit">重审计</button>' +
            '<button class="fh-btn" data-act="clear">清布局</button>' +
            '<button class="fh-btn" data-act="clear-ledger">清台账</button></div>';
        h += '<div class="fh-sec"><h3>审计读数（逐因）</h3>';
        const probs = vm.problems || [];
        if (!probs.length) h += '<div class="fh-empty">布局合法（或还没收）。</div>';
        for (const p of probs) h += '<div class="fh-prob">' + esc(p) + '</div>';
        h += '</div>';
        h += '<div class="fh-sec"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="fh-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || [])) h += '<div class="fh-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        if (vm.dropped > 0) h += '<div class="fh-dropped">台账挤掉 ' + String(vm.dropped) + ' 条</div>';
        h += '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'intake') {
                    const ta = el.querySelector('[data-in="layout"]');
                    self.app.intakeLayout(ta ? ta.value : '');
                } else if (act === 'audit') { self.app.audit(); self.app.render(); }
                else if (act === 'clear') { self.app.clearLayout(); }
                else if (act === 'clear-ledger') { self.app.clearLedger(); }
            });
        });
    }
}