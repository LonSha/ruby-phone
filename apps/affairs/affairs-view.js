/* ========================================================
 * affairs-view.js — [v4.48.0 · 第六期 R6-O1] 事务台视图
 *
 * 只读投影 + 用户动作（建事务/推进阶段/记待决/解决待决）。
 * 数据全部来自 this.app.*（控制器 → 内核归一），本视图不重判任何一格；
 * 内核拒绝（ok=false）时把 why 原样展示，不静默、不猜。
 * 结构：_esc + _draw + _bind（与 plotline-view 同风格）。
 * ======================================================== */
'use strict';

export class AffairsView {
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
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&#x26quot;');
    }
    _draw() {
        const list = this.app.activeList();
        const all = this.app.list();
        const closed = all.filter((a) => a.stage === 'closed');
        const last = this.app._lastAction;
        const rows = list.map((a) => {
            const open = (a.decisions || []).filter((d) => d.state === 'open');
            const openTxt = open.length
                ? '<span class="af-open">待决 ' + open.length + ' 项：' + this._esc(open.map((d) => d.text).join('；')) + '</span>'
                : '';
            const parts = (a.participants || []).length
                ? '<span class="af-part">👥 ' + this._esc(a.participants.join('、')) + '</span>' : '';
            const nextStages = ['planning', 'scheduled', 'doing', 'wrapping', 'closed']
                .filter((s) => s !== a.stage)
                .map((s) => '<button class="af-stage-btn" data-aff="' + this._esc(a.id) + '" data-stage="' + s + '">' + this._stageLabel(s) + '</button>')
                .join('');
            return '<div class="af-card" data-aff="' + this._esc(a.id) + '">'
                + '<div class="af-title">' + this._esc(a.title) + '<span class="af-stage-tag">' + this._stageLabel(a.stage) + '</span></div>'
                + parts + openTxt
                + '<div class="af-actions">' + nextStages + '</div>'
                + '</div>';
        }).join('');
        const html = [
            '<div class="af-root">',
            '  <header class="af-header">',
            '    <h2>事务台</h2>',
            '    <span class="af-count">进行中 ' + list.length + ' · 已了结 ' + closed.length + '</span>',
            '  </header>',
            last && !last.ok ? '<div class="af-warn">上次操作被拒：' + this._esc(last.why) + '</div>' : '',
            '  <div class="af-body">',
            list.length ? rows : '<div class="af-empty">还没有进行中的事务。在下面新建一件，或让角色在聊天里提起正在进行的事。</div>',
            closed.length ? '<div class="af-closed-head">已了结</div>' + closed.map((a) => '<div class="af-closed-row">' + this._esc(a.title) + '</div>').join('') : '',
            '  </div>',
            '  <div class="af-new">',
            '    <input id="af-new-title" class="af-input" maxlength="40" placeholder="新事务标题（如：筹备展览）" />',
            '    <button id="af-new-btn" class="af-primary">新建事务</button>',
            '  </div>',
            '</div>',
        ].join('\n');
        this.container.innerHTML = html;
        this._bind();
    }
    _stageLabel(s) {
        const map = { planning: '在商议', scheduled: '已排期', doing: '进行中', wrapping: '收尾中', closed: '了结', unknown: '阶段不明' };
        return map[s] || s;
    }
    _bind() {
        const c = this.container;
        if (!c) return;
        const newBtn = c.querySelector('#af-new-btn');
        const newTitle = c.querySelector('#af-new-title');
        if (newBtn && newTitle) {
            newBtn.addEventListener('click', () => {
                const t = newTitle.value.trim();
                if (!t) return;
                this.app.create({ title: t });
                this._draw();
            });
        }
        const stageBtns = c.querySelectorAll('.af-stage-btn');
        if (stageBtns && typeof stageBtns.forEach === 'function') {
            stageBtns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.app.transition(btn.getAttribute('data-aff'), btn.getAttribute('data-stage'));
                    this._draw();
                });
            });
        }
    }
}
