/* ========================================================
 * cardtable-view.js — [v3.51.0] 牌桌案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形；零图片。
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

export class CardtableView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'ct-root';
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
        let h = '<div class="ct-wrap">';
        h += '<div class="ct-head">牌组 ' + num(r.tarot) + '+' + num(r.lenormand) + ' · 逆位 ' + num(r.reversed) + ' · 已选 ' + num(r.selected) + '/' + num(r.selected + r.selectedLeft) + '</div>';
        h += '<div class="ct-sec"><h3>操作</h3>' +
            '<button class="ct-btn" data-act="new-all">新牌组（全部）</button>' +
            '<button class="ct-btn" data-act="new-lenormand">新牌组（雷诺曼）</button>' +
            '<button class="ct-btn" data-act="clear">清牌桌</button>' +
            (vm.lastWhy ? '<span class="ct-why">' + esc(vm.lastWhy) + '</span>' : '') + '</div>';
        h += '<div class="ct-sec"><h3>已选（按抽牌顺序）</h3>';
        if (!(vm.order || []).length) h += '<div class="ct-empty">还没选牌。</div>';
        for (const o of (vm.order || [])) {
            const c = vm.deck[o.cardIndex];
            if (c) h += '<div class="ct-row"><span>' + String(o.order) + '</span><span>' + esc(c.name) + '</span><span>' + esc(c.orientation) + '</span></div>';
        }
        h += '</div>';
        h += '<div class="ct-sec"><h3>牌组（前 40 张，点击翻选）</h3><div class="ct-grid">' +
            ((vm.deck || []).slice(0, 40).map(function (c, i) {
                const sel = c.state === 'selected';
                return '<button class="ct-card' + (sel ? ' ct-sel' : '') + '" data-idx="' + String(i) + '">' + (sel ? esc(c.name) : '牌背') + '</button>';
            }).join('')) +
        '</div></div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'new-all') { self.app.newDeck('all'); self.app.render(); }
                else if (act === 'new-lenormand') { self.app.newDeck('lenormand'); self.app.render(); }
                else if (act === 'clear') { self.app.clearAll(); self.app.render(); }
            });
        });
        el.querySelectorAll('[data-idx]').forEach(function (b) {
            b.addEventListener('click', function () {
                self.app.pick(Number(b.getAttribute('data-idx')));
                self.app.render();
            });
        });
    }
}