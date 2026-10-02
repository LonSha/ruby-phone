/* ========================================================
 * annidate-view.js — [v3.51.0] 纪念日数学案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形。
 * ======================================================== */
'use strict';
import { daysOf } from './annidate-data.js';
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

export class AnnidateView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'ad-root';
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
        let h = '<div class="ad-wrap">';
        h += '<div class="ad-head">条目 ' + num(r.items) + ' · 星标 ' + num(r.starred) + '</div>';
        h += '<div class="ad-sec"><h3>操作</h3>' +
            '<button class="ad-btn" data-act="check">查今日提醒</button>' +
            '<button class="ad-btn" data-act="clear">清条目</button></div>';
        const ms = vm.lastMatches;
        if (ms) {
            h += '<div class="ad-sec"><h3>今日匹配</h3>';
            if (!ms.length) h += '<div class="ad-empty">今天没有匹配的提醒。</div>';
            for (const m of ms) h += '<div class="ad-row"><span>' + esc(m.text) + '</span><span>' + esc(m.kind) + '</span></div>';
            h += '</div>';
        }
        h += '<div class="ad-sec"><h3>条目</h3>' +
            ((vm.items || []).slice(0, 30).map(function (it) {
                const d = daysOf(it.date, Date.now());
                const word = d.form === 'past' ? d.text + String(d.diff) + ' 天' : d.form === 'future' ? d.text + String(d.abs) + ' 天' : d.text;
                return '<div class="ad-row"><span>' + esc(it.title) + '</span><span>' + word + '</span></div>';
            }).join('')) +
        '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'check') { self.app.checkAlerts(); self.app.render(); }
                else if (act === 'clear') { self.app.clearAll(); self.app.render(); }
            });
        });
    }
}