/* ========================================================
 * lexiscore-view.js — [v3.50.0] 词法评分案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形。
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

export class LexiscoreView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'ls-root';
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
        let h = '<div class="ls-wrap">';
        h += '<div class="ls-head">词条 ' + num(vm.readings && vm.readings.entries) + ' · 台账 ' + num(vm.readings && vm.readings.ledger) + '</div>';
        h += '<div class="ls-sec"><h3>收词条（JSON 数组）</h3>' +
            '<textarea class="ls-input" data-in="entries"></textarea>' +
            '<button class="ls-btn" data-act="intake">收下词条</button>' +
            '<button class="ls-btn" data-act="clear">清词条</button>' +
            '<button class="ls-btn" data-act="clear-ledger">清台账</button></div>';
        h += '<div class="ls-sec"><h3>查询（词法兜底）</h3>' +
            '<textarea class="ls-input ls-input-sm" data-in="query"></textarea>' +
            '<button class="ls-btn" data-act="query">查询</button></div>';
        const q = vm.lastQuery;
        if (q) h += '<div class="ls-sec"><h3>上次查询</h3><div class="ls-row"><span>' + esc(q.text || DASH) + '</span><span>切词 ' + num(q.tokens) + ' · 命中 ' + num(q.hits) + '</span></div></div>';
        h += '<div class="ls-sec"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="ls-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || [])) h += '<div class="ls-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        h += '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'intake') {
                    const ta = el.querySelector('[data-in="entries"]');
                    self.app.intakeEntries(ta ? ta.value : '');
                } else if (act === 'query') {
                    const ta = el.querySelector('[data-in="query"]');
                    self.app.query(ta ? ta.value : '');
                } else if (act === 'clear') { self.app.clearEntries(); }
                else if (act === 'clear-ledger') { self.app.clearLedger(); }
            });
        });
    }
}