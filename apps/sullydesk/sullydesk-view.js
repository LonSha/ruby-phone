/* ========================================================
 * sullydesk-view.js — [v3.53.0] SullyOS 治理案头 · 视图
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

export class SullydeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'sd2-root';
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
        let h = '<div class="sd2-wrap">';
        h += '<div class="sd2-sec"><h3>导出审计（贴回 JSON）</h3>' +
            '<textarea class="sd2-input" data-in="export"></textarea>' +
            '<button class="sd2-btn" data-act="audit">审计</button>' +
            '<button class="sd2-btn" data-act="audit-expect">审计（预期含密钥）</button>' +
            '<button class="sd2-btn" data-act="clear-ledger">清台账</button></div>';
        const la = vm.lastAudit;
        if (la) {
            const tone = la.level === 'safe' ? 'sd2-ok' : 'sd2-bad';
            h += '<div class="sd2-sec"><h3>审计结果</h3><div class="sd2-row ' + tone + '">' + esc(la.level) + '：' + esc(la.message) + '</div>';
            for (const hit of (la.hits || []).slice(0, 10)) h += '<div class="sd2-row"><span>' + esc(hit.path) + '</span><span>' + esc(hit.masked) + ' · ' + esc(hit.why) + '</span></div>';
            h += '</div>';
        }
        h += '<div class="sd2-sec"><h3>分组档位</h3>' +
            ((vm.chips || []).map(function (chip) { return '<span class="sd2-chip">' + esc(chip.label) + ' ' + String(chip.count) + '</span>'; }).join('')) +
        '</div>';
        h += '<div class="sd2-sec"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="sd2-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || []).slice(0, 20)) h += '<div class="sd2-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        h += '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'audit' || act === 'audit-expect') {
                    const ta = el.querySelector('[data-in="export"]');
                    self.app.auditExportText(ta ? ta.value : '', act === 'audit-expect');
                    self.app.render();
                } else if (act === 'clear-ledger') { self.app.clearLedger(); }
            });
        });
    }
}