/* ========================================================
 * summdesk-view.js — [v3.52.0] 总结案头 · 视图
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

export class SummdeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'sm-root';
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
        let h = '<div class="sm-wrap">';
        /* [v3.66.0 · X2] 跨 App 定位条（找不到即明说，不假装还在） */
        const f = vm.focus;
        if (f) {
            h += '<div class="sm-focus' + (f.gone ? ' is-gone' : '') + '">' +
                '<span class="sm-focus-lab">定位</span>' +
                '<span class="sm-focus-id">' + esc(f.id) + '</span>' +
                (f.gone
                    ? '<span class="sm-focus-why">这条记忆已不在册里（被清过，或换过会话）</span>'
                    : '<span class="sm-focus-why">第 ' + esc(String(f.index + 1)) + ' 条 · ' + esc(f.title) + (f.excerpt ? ' · ' + esc(f.excerpt) : '') + '</span>') +
                '<button class="sm-btn" data-act="unfocus">收起定位</button></div>';
        }
        h += '<div class="sm-head">记忆册 ' + num(r.memories) + ' · 普通游标 ' + num(r.cursorNormal) + ' · 向量游标 ' + num(r.cursorTrue) + '</div>';
        h += '<div class="sm-sec"><h3>收总结文本</h3>' +
            '<textarea class="sm-input" data-in="text"></textarea>' +
            '<input class="sm-range" data-in="range" placeholder="条数范围如 1-20（可空）" />' +
            '<button class="sm-btn" data-act="intake">解析收下</button>' +
            '<button class="sm-btn" data-act="clear">清记忆册</button></div>';
        const lp = vm.lastParse;
        if (lp) h += '<div class="sm-sec"><h3>上次解析</h3><div class="sm-row">' + esc(lp.title) + (lp.saved ? '' : '（未存盘）') + '</div></div>';
        h += '<div class="sm-sec"><h3>记忆册（前 20 条）</h3>';
        if (!(vm.memories || []).length) h += '<div class="sm-empty">册还是空的。</div>';
        for (const m of (vm.memories || []).slice(0, 20)) h += '<div class="sm-row"><span>' + esc(m.title) + '</span><span>' + esc((m.content || '').slice(0, 40)) + '</span></div>';
        h += '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'intake') {
                    const ta = el.querySelector('[data-in="text"]');
                    const ra = el.querySelector('[data-in="range"]');
                    self.app.intakeSummary(ta ? ta.value : '', ra ? ra.value : '');
                    self.app.render();
                } else if (act === 'clear') { self.app.clearMemories(); self.app.render(); }
                else if (act === 'unfocus') { self.app.clearRef(); self.app.render(); }
            });
        });
    }
}