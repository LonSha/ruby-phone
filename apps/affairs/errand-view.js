import { ConditionReminderView } from './condition-reminder-view.js';
/* ========================================================
 * errand-view.js — [v4.114.0 · R13-X7] 事务台的「这个月」页
 * --------------------------------------------------------
 * 只画三样东西：一串行（每条带到期日 / 去处 / 状态）、每行的两个动作（办掉 / 不办）、
 * 过期行的后果（一条后果事件 + 一个「知道了」）。**判定一格都不在本件**：
 *   状态来自 `config/errand-lifecycle.js`，动作来自 `config/errand-actions.js`，
 *   本件只在拿不到读数时如实说出「读不出来」，不自己顶上一条。
 *
 * 【为什么过期行要把后果写出来】过期的价值全在「用户知道会怎么样」。只写「已过期」
 *   三个字，用户还是不知道房租晚交了会怎样 —— 而 consequence 已经存在数据里，
 *   不显示等于这份数据白存。
 *
 * 【为什么动作按钮要按状态分别给】给一个点了会报错的按钮比不给更贵：
 *   · pending ⇒ 办掉 / 不办；· expired ⇒ 知道了 / 不办；· done / waived ⇒ 不给按钮。
 *   走不通的按钮不许亮，这条与事务台既有口径一致。
 * ============================================================ */
'use strict';
import { ERRAND_LABEL, ERRAND_APPS, ERRAND_STATES } from '../../config/errand-terms.js';

import { SharedChoreView } from './shared-chore-view.js';
export class ErrandView {
    constructor(app) {
        this.app = app;
        this.container = null;
    }

    render(container) {
        if (!container) return;
        this.container = container;
        this._draw();
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
            .split('"').join('&#x26quot;');
    }

    _draw() {
        const res = this.app.monthFace();
        const rows = res.rows.map((e) => this._row(e)).join('');
        const html = [
            '<div class="er-root">',
            '  <header class="er-header">',
            '    <h2>这个月要处理的</h2>',
            '    <span class="er-count">' + this._esc(res.line) + '</span>',
            '  </header>',
            res.warn ? '<div class="er-warn">' + this._esc(res.warn) + '</div>' : '',
            '  <div class="er-body">',
            rows || '<div class="er-empty">这个月没有欠着的事。</div>',
            '  </div>',
            '  <div class="er-new">',
            '    <input id="er-new-title" class="er-input" maxlength="40" placeholder="要处理的事（如：交房租）" />',
            '    <input id="er-new-due" class="er-input" type="date" />',
            '    <select id="er-new-app" class="er-input">',
            Object.keys(ERRAND_APPS).map((k) => '<option value="' + this._esc(k) + '">' + this._esc(ERRAND_APPS[k]) + '</option>').join(''),
            '    </select>',
            '    <button id="er-new-btn" class="er-primary">记一笔</button>',
            '  </div>',
            '</div>'
        ].join('\n');
        this.container.innerHTML = html;
        this._bind();
        const slot = document.createElement('div');
        this.container.appendChild(slot);
        if (!this.sharedView) this.sharedView = new SharedChoreView(this.app);
        this.sharedView.render(slot);
        const reminderSlot = document.createElement('div');
        this.container.appendChild(reminderSlot);
        if (!this.conditionView) this.conditionView = new ConditionReminderView(this.app);
        this.conditionView.render(reminderSlot);
    }

    _row(e) {
        const acts = [];
        if (e.state === ERRAND_STATES.pending) {
            acts.push('<button class="er-act" data-er="' + this._esc(e.id) + '" data-op="done">' + ERRAND_LABEL.doIt + '</button>');
            acts.push('<button class="er-act" data-er="' + this._esc(e.id) + '" data-op="waive">' + ERRAND_LABEL.waive + '</button>');
        } else if (e.state === ERRAND_STATES.expired) {
            acts.push('<button class="er-act" data-er="' + this._esc(e.id) + '" data-op="ack">' + ERRAND_LABEL.ack + '</button>');
            acts.push('<button class="er-act" data-er="' + this._esc(e.id) + '" data-op="waive">' + ERRAND_LABEL.waive + '</button>');
        }
        /* 后果只在过期时显示，且承认过就写「已承认」—— 二者形态不同，不许画成一个样。 */
        let consequence = '';
        if (e.state === ERRAND_STATES.expired) {
            consequence = '<div class="er-consequence">'
                + (e.consequence.acked ? '已承认：' : '后果：')
                + this._esc(e.consequence.text || '这件事一直没办')
                + '</div>';
        }
        const receipts = e.receipts.length
            ? '<div class="er-receipts">' + e.receipts.map((r) => this._esc((r.at ? r.at + ' ' : '') + r.text)).join(' · ') + '</div>'
            : '';
        return '<div class="er-row er-' + this._esc(e.state) + '" data-er="' + this._esc(e.id) + '">'
            + '<div class="er-title">' + this._esc(e.title)
            + '<span class="er-state">' + (ERRAND_LABEL[e.state] || e.state) + '</span></div>'
            + '<div class="er-meta">' + this._esc(e.dueAt) + ' · ' + this._esc(ERRAND_APPS[e.app] || e.app)
            + '</div>' + consequence + receipts
            + (acts.length ? '<div class="er-actions">' + acts.join('') + '</div>' : '')
            + '</div>';
    }

    _bind() {
        const c = this.container;
        if (!c) return;
        const btn = c.querySelector('#er-new-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                const t = c.querySelector('#er-new-title');
                const d = c.querySelector('#er-new-due');
                const a = c.querySelector('#er-new-app');
                this.app.createErrand({
                    title: t ? String(t.value || '').trim() : '',
                    dueAt: d ? String(d.value || '').trim() : '',
                    app: a ? String(a.value || '').trim() : ''
                });
                this._draw();
            });
        }
        const acts = c.querySelectorAll('.er-act');
        if (acts && typeof acts.forEach === 'function') {
            acts.forEach((el) => {
                el.addEventListener('click', () => {
                    const id = el.getAttribute('data-er');
                    const op = el.getAttribute('data-op');
                    if (op === 'done') this.app.doErrand(id);
                    else if (op === 'waive') this.app.waiveErrand(id);
                    else if (op === 'ack') this.app.ackErrand(id);
                    this._draw();
                });
            });
        }
    }
}
