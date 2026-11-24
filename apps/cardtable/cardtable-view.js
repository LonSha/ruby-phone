/* ========================================================
 * cardtable-view.js — [v3.51.0 / v4.200.0] 牌桌案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形；零图片。
 * ======================================================== */
'use strict';
import { esc } from '../../config/esc-face.js';
import { confirmDestroy } from '../../config/destructive-confirm.js';
import { numeralText } from '../../config/num-face.js';
const DASH = String.fromCharCode(45, 45);

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
        /* [v4.200.0] 牌局 seed 上屏：抽到的牌不对时，人可以把这串数报上来，本机同 seed 重开就是同一副。
         * 没记录（v4.200.0 之前存下的牌组）就如实写「seed 未记录」，不编一个。 */
        const seedText = (typeof vm.seed === 'number') ? String(vm.seed) : '';
        h += '<div class="ct-head">牌组 ' + numeralText(r.tarot) + '+' + numeralText(r.lenormand) + ' · 逆位 ' + numeralText(r.reversed) + ' · 已选 ' + numeralText(r.selected) + '/' + numeralText(r.selected + r.selectedLeft) + ' · 牌局 ' + (seedText ? '#' + esc(seedText) : 'seed 未记录') + '</div>';
        h += '<div class="ct-sec"><h3>操作</h3>' +
            '<button class="ct-btn" data-act="new-all">新牌组（全部）</button>' +
            '<button class="ct-btn" data-act="new-lenormand">新牌组（雷诺曼）</button>' +
            /* [v4.200.0] 同 seed 重开：没 seed 就不给这颗按钮（不给一个点了也没用的按钮）。 */
            ((typeof vm.seed === 'number') ? '<button class="ct-btn" data-act="rebuild">按此 seed 重开</button>' : '') +
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
                else if (act === 'rebuild') { self.app.rebuild(); self.app.render(); }
                else if (act === 'clear') {
                    if (!confirmDestroy({
                        appId: 'cardtable',
                        action: '清空牌桌',
                        what: '当前牌阵与摆位',
                    })) return;
                    self.app.clearAll(); self.app.render(); }
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