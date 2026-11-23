/* ========================================================
 * poker-eval-view.js — [v4.189.0] 牌型评估 · 视图
 * 纪律：_boundRoot 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面只做「点选牌面 -> 看评估」：选哪几张由用户点，评估结果只读不写。
 * ======================================================== */
'use strict';
import { SUITS, RANKS } from './poker-eval.js';

export class PokerEvalView {
    constructor(app, shell) {
        this.app = app; this.shell = shell;
        this._root = null; this._boundRoot = null; this._flash = '';
        this._picked = [];
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('poker-eval-css')) return;
            const link = document.createElement('link');
            link.id = 'poker-eval-css'; link.rel = 'stylesheet';
            link.href = new URL('./poker-eval.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'pe-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root; this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
        this._bind(this._root);
    }

    _html() {
        const flash = this._flash ? '<div class="pe-flash">' + this._flash + '</div>' : '';
        const grid = [];
        for (const s of SUITS) {
            for (const r of RANKS) {
                const on = this._picked.some((c) => c.suit === s.id && c.value === r.value);
                grid.push(
                    '<button class="pe-card' + (on ? ' is-on' : '') + '" type="button" data-act="pick" data-suit="' + s.id + '" data-value="' + r.value + '" data-label="' + r.label + '">'
                    + '<span class="pe-suit pe-' + s.color + '">' + s.symbol + '</span><span class="pe-rank">' + r.label + '</span></button>'
                );
            }
        }
        const pickedText = this._picked.length ? this.app.fmt(this._picked) : '（还没选牌）';
        let result = '<div class="pe-none">选 5~7 张再算</div>';
        if (this._picked.length >= 5) {
            const r = this.app.evaluate(this._picked);
            if (r.ok) {
                result = '<div class="pe-result">' + r.result.label
                    + ' <span class="pe-score">强度 ' + r.result.score + '/8</span></div>'
                    + '<div class="pe-cards">' + this.app.fmt(r.result.cards) + '</div>';
            } else {
                result = '<div class="pe-none">算不出：' + r.reason + '</div>';
            }
        }
        return (
            '<div class="pe-head">'
            + '<button class="pe-back" type="button" data-act="back">‹</button>'
            + '<div class="pe-title">牌型评估</div>'
            + '<div class="pe-count">' + this._picked.length + ' 张</div>'
            + '</div>'
            + flash
            + '<div class="pe-picked">' + pickedText + '</div>'
            + result
            + '<div class="pe-sec-t">点牌（' + SUITS.length + ' 种花色 × ' + RANKS.length + ' 种点数）</div>'
            + '<div class="pe-grid">' + grid.join('') + '</div>'
            + '<div class="pe-foot">'
            + '<button class="pe-btn" type="button" data-act="demo">试算一副</button>'
            + '<button class="pe-btn pe-btn-ghost" type="button" data-act="clear">清空</button>'
            + '</div>'
        );
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => this._onClick(ev));
    }

    _onClick(ev) {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el) return;
        const act = el.getAttribute('data-act');
        if (act === 'back') { if (this.shell && this.shell.goHome) this.shell.goHome(); return; }
        if (act === 'pick') {
            const suit = el.getAttribute('data-suit');
            const value = Number(el.getAttribute('data-value'));
            const label = el.getAttribute('data-label');
            const idx = this._picked.findIndex((c) => c.suit === suit && c.value === value);
            if (idx >= 0) this._picked.splice(idx, 1);
            else this._picked.push({ suit, value, label });
            this._flash = '';
            this.refresh(); return;
        }
        if (act === 'clear') { this._picked = []; this._flash = '已清空'; this.refresh(); return; }
        if (act === 'demo') {
            const r = this.app.demo();
            this._picked = r.hand.slice();
            this._flash = '试算：' + r.result.label;
            this.refresh();
        }
    }
}

export { SUITS, RANKS };
export default PokerEvalView;
