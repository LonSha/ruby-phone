/* ========================================================
 * periodmath-view.js — [v3.51.0] 周期数学案头 · 视图
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

export class PeriodmathView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'pm-root';
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
        const st = r.status || {};
        let h = '<div class="pm-wrap">';
        h += '<div class="pm-status">' + esc(st.text || DASH) + '</div>';
        h += '<div class="pm-readings">周期均值 ' + num(r.cycleLength) + ' 天（样本 ' + num(r.cycleSamples) + '）· 经期均值 ' + num(r.periodLength) + ' 天（样本 ' + num(r.periodSamples) + '）· 记录 ' + num(r.cycles) + ' 条 · 症状标记 ' + num(r.symptomCount) + '</div>';
        h += '<div class="pm-sec"><h3>操作</h3>' +
            '<button class="pm-btn" data-act="toggle">开始/结束当前经期</button>' +
            '<button class="pm-btn" data-act="alert">查预警</button>' +
            '<button class="pm-btn" data-act="clear">清记录</button></div>';
        const la = vm.lastAlert;
        if (la) h += '<div class="pm-sec"><h3>预警</h3><div class="pm-row">' + (la.alert ? '触发：' + esc(la.status.text) : '未触发：' + esc(la.why)) + '</div></div>';
        h += '<div class="pm-sec"><h3>收周期记录（JSON）</h3>' +
            '<textarea class="pm-input" data-in="cycles"></textarea>' +
            '<button class="pm-btn" data-act="intake">收下记录</button></div>';
        h += '<div class="pm-sec"><h3>记录（前 20 条）</h3>' +
            ((vm.cycles || []).slice(0, 20).map(function (c) { return '<div class="pm-row"><span>' + esc(c.id) + '</span><span>' + (c.end === null ? '进行中' : '已结束') + '</span></div>'; }).join('')) +
        '</div>';
        h += '</div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'toggle') { self.app.togglePeriod(); self.app.render(); }
                else if (act === 'alert') { self.app.checkAlert(); self.app.render(); }
                else if (act === 'clear') { self.app.clearAll(); self.app.render(); }
                else if (act === 'intake') {
                    const ta = el.querySelector('[data-in="cycles"]');
                    self.app.intakeCycles(ta ? ta.value : ''); self.app.render();
                }
            });
        });
    }
}