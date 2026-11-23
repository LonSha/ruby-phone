/* ========================================================
 * daily-view.js — [v4.188.0] 跨 App 生活事件 · 视图
 * 纪律：_boundRoot 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面只做「选规则 + 贴一段对话」的触发，正文由用户贴，不由界面编。
 * ======================================================== */
'use strict';
import { DAILY_FACE, LIFE_RULES, LIFE_APPS } from './daily-data.js';

const FACE_META = {
    [DAILY_FACE.EVENTS]: { label: '有事件', tone: 'ok' },
    [DAILY_FACE.EMPTY]: { label: '空档（还没触发）', tone: 'idle' },
};

export class DailyView {
    constructor(app, shell) {
        this.app = app; this.shell = shell;
        this._root = null; this._boundRoot = null; this._flash = ''; this._rule = LIFE_RULES[0].ruleId;
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('daily-fabric-css')) return;
            const link = document.createElement('link');
            link.id = 'daily-fabric-css'; link.rel = 'stylesheet';
            link.href = new URL('./daily.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'daily-root';
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
        const st = this.app.state;
        const face = this.app.face;
        const meta = FACE_META[face] || FACE_META[DAILY_FACE.EMPTY];
        const flash = this._flash ? '<div class="daily-flash">' + this._flash + '</div>' : '';
        const ruleRow = LIFE_RULES.map((r) => (
            '<button class="daily-rule' + (this._rule === r.ruleId ? ' is-on' : '') + '" type="button" data-act="rule" data-rule="' + r.ruleId + '">'
            + r.ruleId + ' → ' + LIFE_APPS[r.app] + '</button>'
        )).join('');
        const kw = (LIFE_RULES.filter((r) => r.ruleId === this._rule)[0] || LIFE_RULES[0]).keywords.join(' / ');
        const events = st.events.length
            ? st.events.slice().reverse().slice(0, 12).map((e) => (
                '<div class="daily-row"><span class="daily-app">' + LIFE_APPS[e.app] + '</span>'
                + '<span class="daily-hit">命中「' + e.hit + '」</span>'
                + '<span class="daily-snip">' + e.snippet + '</span></div>'
            )).join('')
            : '<div class="daily-empty">还没有事件</div>';
        return (
            '<div class="daily-head">'
            + '<button class="daily-back" type="button" data-act="back">‹</button>'
            + '<div class="daily-title">生活织机</div>'
            + '<div class="daily-face daily-face-' + meta.tone + '">' + meta.label + '</div>'
            + '</div>'
            + flash
            + '<div class="daily-sec-t">规则（只认这些 App，命中词写死）</div>'
            + '<div class="daily-rules">' + ruleRow + '</div>'
            + '<div class="daily-kw">命中词：' + kw + '</div>'
            + '<button class="daily-fire" type="button" data-act="fire">贴一段对话，试跑当前规则</button>'
            + '<div class="daily-sec-t">事件（' + st.events.length + ' 条）</div>'
            + '<div class="daily-events">' + events + '</div>'
            + '<div class="daily-foot"><button class="daily-reset" type="button" data-act="reset">清空</button></div>'
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
        if (act === 'rule') { this._rule = el.getAttribute('data-rule'); this.refresh(); return; }
        if (act === 'fire') {
            const text = (typeof prompt === 'function') ? prompt('贴一段对话（本界面不代写正文）') : '';
            if (!text) { this._flash = '正文不能空'; this.refresh(); return; }
            const r = this.app.fire(this._rule, text);
            if (!r.ok) this._flash = '没触发：' + r.reason;
            else if (r.saved === false) this._flash = '事件记了，但没写进存储';
            else this._flash = '命中「' + r.event.hit + '」→ ' + LIFE_APPS[r.event.app];
            this.refresh(); return;
        }
        if (act === 'reset') { this.app.reset(); this._flash = '已清空'; this.refresh(); }
    }
}

export { LIFE_RULES, LIFE_APPS };
export default DailyView;
