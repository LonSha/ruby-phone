/* ========================================================
 * periodmath-view.js — [v4.164.0]「照现实重写」· 周期数学案头视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 状态一句话 + 三颗按钮 + 一框 JSON + 列表全堆在一起。
 * 现实里的经期 App 是三块：**今天**（到哪一步了）→ **记录**（每一段经期）
 * → **设置**（录入与清空）。底部页签切换，操作靠 data-act 委托。
 *
 * 纪律：
 *   ① 事件只在根容器上挂一次（整页重绘不丢监听、也不重复挂）；
 *   ② 读不到 DOM 不抛；数值缺失如实显示「—」，不拿 0 冒充；
 *   ③ 破坏性操作走 config/destructive-confirm.js 的确认口。
 * ======================================================== */
'use strict';
import { esc } from '../../config/esc-face.js';
import { confirmDestroy } from '../../config/destructive-confirm.js';
import { numeralText } from '../../config/num-face.js';

const DASH = String.fromCharCode(45, 45);

function dayKey(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return DASH;
    const d = new Date(ms);
    const p = (v) => (v < 10 ? '0' : '') + v;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const TABS = [
    { key: 'today', label: '今天' },
    { key: 'records', label: '记录' },
    { key: 'settings', label: '设置' },
];
/* [v4.215.0 · 照现实] 底栏真源别名：PM_FACES 与 TABS 同一引用，不另写格表。 */
export const PM_FACES = TABS;

const PHASE_TEXT = {
    menstrual: '月经期',
    follicular: '卵泡期',
    ovulation: '排卵期',
    luteal: '黄体期',
    '': '—',
};

/* 样式源：apps/periodmath/periodmath.css（phone.css 逐字同源），视图不写行内 style。 */

export class PeriodmathView {
    constructor(app) {
        this.app = app;
        this.root = null;
        this.tab = 'today';
        this._lastVm = null;
        this._boundEl = null;
        this._hClick = null;
    }

    /* ---------- 1. 挂载 ---------- */

    _mount() {
        if (this.root && this.root.parentNode) return this.root;
        const shell = this.app && this.app.shell;
        const container = (shell && typeof shell.getContentContainer === 'function') ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'pm-root';
        root.innerHTML = '';
        container.appendChild(root);
        this.root = root;
        this._bind(root);
        return root;
    }

    /* [v4.215.0 · 照现实] periodmath 样式逐字拼入 phone.css（无独立 link），
     v4 分层样式走 link 幂等注入投递。 */
    _loadV4CSS() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('pm-v4-css')) return;
        const link = document.createElement('link');
        link.id = 'pm-v4-css';
        link.rel = 'stylesheet';
        link.href = new URL('./periodmath.v4.css', import.meta.url).href;
        document.head.appendChild(link);
    }

    render(vm) {
        this._lastVm = vm || {};
        this._loadV4CSS();
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(this._lastVm);
    }

    /* ---------- 2. 事件（根容器委托一次） ---------- */

    _bind(el) {
        if (this._boundEl === el) return;
        this._hClick = (ev) => this._handleClick(ev);
        if (typeof el.addEventListener === 'function') el.addEventListener('click', this._hClick);
        this._boundEl = el;
    }

    _act(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    _handleClick(ev) {
        const target = ev && ev.target;
        const hit = (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
        const act = this._act(hit, 'data-act');
        if (!act) return;
        if (act === 'tab') {
            const key = this._act(hit, 'data-tab') || 'today';
            if (TABS.some((t) => t.key === key)) { this.tab = key; this.render(this._lastVm); }
            return;
        }
        if (act === 'toggle') { this.app.togglePeriod(); this.app.render(); return; }
        if (act === 'alert') { this.app.checkAlert(); this.app.render(); return; }
        if (act === 'clear') {
            if (!confirmDestroy({
                appId: 'periodmath',
                action: '清空周期数据与设置',
                what: '已录入的周期记录与参数',
            })) return;
            this.app.clearAll();
            this.app.render();
            return;
        }
        if (act === 'intake') {
            let raw = '';
            try {
                const ta = (this.root && typeof this.root.querySelector === 'function')
                    ? this.root.querySelector('[data-in="cycles"]') : null;
                raw = ta ? ta.value : '';
            } catch (_e) { raw = ''; }
            this.app.intakeCycles(raw);
            this.app.render();
            return;
        }
    }

    /* ---------- 3. 今天 ---------- */

    _todayHTML(vm) {
        const r = vm.readings || {};
        const st = r.status || {};
        const parts = ['<section class="pm-page" data-page="today">'];
        parts.push('<div class="pm-face">' + (r.cycles
            ? '本会话共 ' + numeralText(r.cycles) + ' 段周期记录' + (r.enough ? '，均值可用于推算' : '，样本还不足 2 段')
            : '这个会话还没有记录 —— 不是算不出来，是还没有数据') + '</div>');
        parts.push('<div class="pm-hero"><div class="pm-hero-kind">当前状态</div>'
            + '<div class="pm-hero-text">' + esc(st.text || DASH) + '</div>'
            + '<div class="pm-hero-phase">所处阶段：' + esc(PHASE_TEXT[st.phase || ''] || DASH) + '</div></div>');
        parts.push('<div class="pm-grid">'
            + '<div class="pm-cell"><b>' + numeralText(r.cycleLength) + '</b><span>周期均值（天 / ' + numeralText(r.cycleSamples) + ' 样本）</span></div>'
            + '<div class="pm-cell"><b>' + numeralText(r.periodLength) + '</b><span>经期均值（天 / ' + numeralText(r.periodSamples) + ' 样本）</span></div>'
            + '</div>');
        parts.push('<div class="pm-sec"><div class="pm-sec-title">记一段</div>'
            + '<button class="pm-btn pm-btn-primary" data-act="toggle">开始 / 结束当前经期</button>'
            + '<button class="pm-btn pm-btn-ghost" data-act="alert">查预警</button></div>');
        const la = vm.lastAlert;
        if (la) {
            parts.push('<div class="pm-sec"><div class="pm-sec-title">上次预警</div><div class="pm-row">'
                + (la.alert ? '<span class="pm-live">已触发：' + esc((la.status && la.status.text) || DASH) + '</span>'
                    : '<span>' + esc(la.why || DASH) + '</span>')
                + '</div></div>');
        }
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 4. 记录 ---------- */

    _recordsHTML(vm) {
        const rows = Array.isArray(vm.cycles) ? vm.cycles.slice(0, 20) : [];
        const parts = ['<section class="pm-page" data-page="records">'];
        if (!rows.length) {
            parts.push('<div class="pm-empty">还没有记录。去「今天」点一下「开始 / 结束当前经期」，或在「设置」里整批录入。</div></section>');
            return parts.join('');
        }
        parts.push('<div class="pm-sec"><div class="pm-sec-title">最近 ' + rows.length + ' 段（最新在前）</div>');
        for (const c of rows) {
            parts.push('<div class="pm-row"><span>' + esc(dayKey(c.start)) + '</span>'
                + '<em>' + (c.end === null ? '<span class="pm-live">进行中</span>' : '结束 ' + esc(dayKey(c.end))) + '</em></div>');
        }
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 5. 设置 ---------- */

    _settingsHTML(vm) {
        const parts = ['<section class="pm-page" data-page="settings">'];
        parts.push('<div class="pm-sec"><div class="pm-sec-title">整批录入（JSON）</div>'
            + '<div class="pm-hint">形如 [{"start":1730000000000,"end":null}]：start 必填，end 留空表示进行中；'
            + '解析不了会如实拒收，不会静默清空旧记录。</div>'
            + '<textarea class="pm-input" data-in="cycles" placeholder="[{\\"start\\": 1730000000000, \\"end\\": null}]"></textarea>'
            + '<button class="pm-btn pm-btn-primary" data-act="intake">收下记录</button></div>');
        const li = vm.lastIntake;
        parts.push('<div class="pm-sec"><div class="pm-sec-title">上次录入</div><div class="pm-row">'
            + (li ? '<span>收下 ' + numeralText(li.cycles) + ' 段</span><em>拒收 ' + numeralText(li.rejected) + ' 条</em>' : '<span>还没录过</span>')
            + '</div></div>');
        parts.push('<div class="pm-sec"><div class="pm-sec-title">清空</div>'
            + '<div class="pm-hint">清空会同时删掉记录与参数（含预警幂等键），要点确认。</div>'
            + '<button class="pm-btn pm-btn-danger" data-act="clear">清空全部</button></div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 6. 总装 ---------- */

    _html(vm) {
        const page = this.tab === 'records' ? this._recordsHTML(vm)
            : (this.tab === 'settings' ? this._settingsHTML(vm) : this._todayHTML(vm));
        const tabs = ['<nav class="pm-tabbar" role="navigation" aria-label="周期主导航">']
            .concat(PM_FACES.map((t) => {
                const on = this.tab === t.key;
                return '<button class="pm-tab' + (on ? ' is-on' : '') + '" data-act="tab" data-tab="' + t.key
                    + '" data-pm-face="' + t.key + '"' + (on ? ' aria-current="page"' : '')
                    + '>' + esc(t.label) + '</button>';
            }))
            .concat(['</nav>'])
            .join('');
        return '<div class="pm-top"><div class="pm-title">周期</div><span class="pm-top-meta">会话内隔离</span></div>'
            + page + tabs;
    }
}