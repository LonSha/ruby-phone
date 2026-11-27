/* ========================================================
 * annidate-view.js — [v4.165.0]「照现实重写」· 纪念日案头视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 一行条目读数 + 两颗按钮 + 今日匹配 + 前 30 条全堆在一起，
 *   事件每次重绘都 querySelectorAll('[data-act]') 再逐个绑一遍。
 * 现实里的纪念日 App 是三块：**今天**（有几个今天/这周要过的、还差多少天）→
 *   **条目**（每一件本身）→ **设置**（整批录入与清空）。
 *
 * 纪律（与桃宝 / 心境 / 周期数学 / 幸运转盘同一套）：
 *   ① 事件只挂在根容器上一次（click 一个），靠 data-act 与 closest() 分派；
 *   ② 读不到 DOM 一律不抛（夹具里 querySelector 返回 null）；
 *   ③ 天数只在数据层算（daysOf 是唯一口径），视图不另算一份「大概几天」；
 *   ④ 破坏性操作走 config/destructive-confirm.js 的确认口，不弹宿主对话框。
 * ======================================================== */
'use strict';
import { esc } from '../../config/esc-face.js';
import { daysOf } from './annidate-data.js';
import { confirmDestroy } from '../../config/destructive-confirm.js';
import { numeralText } from '../../config/num-face.js';

const DASH = String.fromCharCode(45, 45);


/** 一件纪念日的天数说法：只在视图这一处拼，口径来自数据层的 daysOf。 */
function wordOf(it, nowMs) {
    const d = daysOf(it && it.date, nowMs);
    if (!d || typeof d.form !== 'string') return DASH;
    if (d.form === 'past') return d.text + String(d.diff) + ' 天';
    if (d.form === 'future') return d.text + String(d.abs) + ' 天';
    return d.text;
}

const TABS = [
    { key: 'today', label: '今天' },
    { key: 'items', label: '条目' },
    { key: 'settings', label: '设置' },
];
/* [v4.215.0 · 照现实] 底栏真源别名：AD_FACES 与 TABS 同一引用，不另写格表。 */
export const AD_FACES = TABS;

export class AnnidateView {
    constructor(app) {
        this.app = app;
        this.root = null;
        this.tab = 'today';
        this._lastVm = null;
        this._boundEl = null;
        this._hClick = null;
        this._lastIntake = null;
    }

    /* ---------- 1. 挂载 ---------- */

    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = (shell && typeof shell.getContentContainer === 'function') ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'ad-root';
        container.appendChild(root);
        this.root = root;
        this._bind(root);
        return root;
    }

    /* [v4.215.0 · 照现实] v4 分层样式走 link 幂等注入投递。 */
    _loadV4CSS() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('ad-v4-css')) return;
        const link = document.createElement('link');
        link.id = 'ad-v4-css';
        link.rel = 'stylesheet';
        link.href = new URL('./annidate.v4.css', import.meta.url).href;
        document.head.appendChild(link);
    }

    render(vm) {
        this._loadV4CSS();
                this._lastVm = vm || {};
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(this._lastVm);
    }

    /* ---------- 2. 事件（根容器一次） ---------- */

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
        if (act === 'check') { this.app.checkAlerts(); this.app.render(); return; }
        if (act === 'unfocus') { this.app.clearRef(); this.app.render(); return; }
        if (act === 'clear') {
            if (!confirmDestroy({
                appId: 'annidate',
                action: '清空全部纪念日条目',
                what: '所有条目的标题与日期，重录只能靠你再抄一遍',
            })) return;
            this.app.clearAll();
            this.app.render();
            return;
        }
        if (act === 'intake') {
            let raw = '';
            try {
                const ta = (this.root && typeof this.root.querySelector === 'function')
                    ? this.root.querySelector('[data-in="items"]') : null;
                raw = ta ? ta.value : '';
            } catch (_e) { raw = ''; }
            const r = this.app.intakeItems(raw);
            this._lastIntake = r && r.ok
                ? { ok: true, items: r.items, rejected: r.rejected }
                : { ok: false, why: (r && r.why) || 'bad_json' };
            this.app.render();
            return;
        }
    }

    /* ---------- 3. 定位条（跨 App 点进来那条的唯一显形面） ---------- */

    _focusHTML(f) {
        if (!f) return '';
        const tail = f.gone
            ? '<span class="ad-focus-why">这条纪念日已不在条目册里（被清过，或换过会话）</span>'
            : '<span class="ad-focus-why">第 ' + esc(String(f.index + 1)) + ' 条 · ' + esc(f.title)
              + ' · ' + esc(f.word) + '</span>';
        return '<div class="ad-focus' + (f.gone ? ' is-gone' : '') + '">'
            + '<span class="ad-focus-lab">定位</span>'
            + '<span class="ad-focus-id">' + esc(f.id) + '</span>' + tail
            + '<button class="ad-btn ad-btn-ghost" data-act="unfocus">收起定位</button></div>';
    }

    /* ---------- 4. 今天 ---------- */

    _todayHTML(vm) {
        const r = vm.readings || {};
        const parts = ['<section class="ad-page" data-page="today">'];
        parts.push(this._focusHTML(vm.focus));
        parts.push('<div class="ad-face">' + (Number.isFinite(r.items)
            ? '一共 ' + numeralText(r.items) + ' 条纪念日，其中 ' + numeralText(r.starred) + ' 条标了星'
            : '条目册读不到 —— 数据层这不回话，先说清楚再谈天数') + '</div>');
        const ms = vm.lastMatches;
        if (ms === undefined || ms === null) {
            parts.push('<div class="ad-sec"><div class="ad-sec-title">今日提醒</div>'
                + '<div class="ad-hint">还没查过。按下下面的按钮才判，平常不打扰。</div>'
                + '<button class="ad-btn ad-btn-primary" data-act="check">查今日提醒</button></div>');
        } else if (!ms.length) {
            parts.push('<div class="ad-sec"><div class="ad-sec-title">今日提醒</div>'
                + '<div class="ad-empty">今天没有要过的纪念日 —— 没有就是没有，不编一条。</div>'
                + '<button class="ad-btn ad-btn-ghost" data-act="check">再查一次</button></div>');
        } else {
            const rows = ms.map((m) => '<div class="ad-row"><span>' + esc(m.text) + '</span>'
                + '<em>' + esc(m.kind) + '</em></div>');
            parts.push('<div class="ad-sec"><div class="ad-sec-title">今天 ' + numeralText(ms.length) + ' 条</div>'
                + rows.join('') + '<button class="ad-btn ad-btn-ghost" data-act="check">再查一次</button></div>');
        }
        const la = vm.lastAlert;
        if (la && !la.alert && la.why) {
            parts.push('<div class="ad-face">上次没提醒的原因：' + esc(la.why) + '</div>');
        }
        /* 今天这一页给「最近要过的那几条」：按天数绝对值排序，靠数据层的 daysOf 现算。 */
        const items = Array.isArray(vm.items) ? vm.items : [];
        const nowMs = Date.now();
        const soon = items
            .map((it) => ({ it: it, d: daysOf(it && it.date, nowMs) }))
            .filter((x) => x.d && typeof x.d.abs === 'number')
            .sort((a, b) => a.d.abs - b.d.abs)
            .slice(0, 3);
        if (soon.length) {
            const rows = soon.map((x) => '<div class="ad-row"><span>' + esc(x.it.title) + '</span>'
                + '<em>' + esc(wordOf(x.it, nowMs)) + '</em></div>');
            parts.push('<div class="ad-sec"><div class="ad-sec-title">最近的三件</div>' + rows.join('') + '</div>');
        }
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 5. 条目 ---------- */

    _itemsHTML(vm) {
        const items = Array.isArray(vm.items) ? vm.items : [];
        const parts = ['<section class="ad-page" data-page="items">'];
        parts.push(this._focusHTML(vm.focus));
        if (!items.length) {
            parts.push('<div class="ad-empty">条目册是空的。去「设置」里整批录入，或在会话里让角色记一条。</div></section>');
            return parts.join('');
        }
        const nowMs = Date.now();
        const rows = items.slice(0, 30).map(function (it) {
            return '<div class="ad-row"><span>' + esc(it.title) + '</span>'
                + '<em>' + esc(wordOf(it, nowMs)) + '</em></div>';
        });
        parts.push('<div class="ad-sec"><div class="ad-sec-title">全部 ' + numeralText(items.length) + ' 条'
            + (items.length > rows.length ? '（先显示前 ' + numeralText(rows.length) + ' 条）' : '') + '</div>'
            + rows.join('') + '</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 6. 设置 ---------- */

    _settingsHTML(vm) {
        const parts = ['<section class="ad-page" data-page="settings">'];
        parts.push('<div class="ad-sec"><div class="ad-sec-title">整批录入（JSON）</div>'
            + '<div class="ad-hint">形如 [{"title":"第一次见面","date":1730000000000}]：title 与 date 都要有；'
            + '解析不了会如实拒收，不会静默清空旧条目。</div>'
            + '<textarea class="ad-input" data-in="items" placeholder=\'[{"title": "第一次见面", "date": 1730000000000}]\'></textarea>'
            + '<button class="ad-btn ad-btn-primary" data-act="intake">收下条目</button></div>');
        const li = this._lastIntake;
        parts.push('<div class="ad-sec"><div class="ad-sec-title">上次录入</div><div class="ad-row">'
            + (li && li.ok
                ? '<span>收下 ' + numeralText(li.items) + ' 条</span><em>拒收 ' + numeralText(li.rejected) + ' 条</em>'
                : (li ? '<span>没收下：' + esc(li.why) + '</span>' : '<span>还没录过</span>'))
            + '</div></div>');
        parts.push('<div class="ad-sec"><div class="ad-sec-title">清空</div>'
            + '<div class="ad-hint">清空会删掉全部条目（含星标与提醒幂等键），要点确认。</div>'
            + '<button class="ad-btn ad-btn-danger" data-act="clear">清空全部</button></div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 7. 总装 ---------- */

    _html(vm) {
        const page = this.tab === 'items' ? this._itemsHTML(vm)
            : (this.tab === 'settings' ? this._settingsHTML(vm) : this._todayHTML(vm));
        const r = vm.readings || {};
        const tabs = ['<nav class="ad-tabbar" role="navigation" aria-label="主导航">']
            .concat(AD_FACES.map((t) => {
                const on = this.tab === t.key;
                return '<button class="ad-tab' + (on ? ' is-on' : '') + '" data-act="tab" data-tab="' + t.key
                    + '" data-ad-face="' + t.key + '"' + (on ? ' aria-current="page"' : '')
                    + '>' + esc(t.label) + '</button>';
            }))
            .concat(['</nav>'])
            .join('');
        return '<div class="ad-top"><div class="ad-title">纪念日</div>'
            + '<span class="ad-top-meta">' + numeralText(r.items) + ' 条</span></div>'
            + page + tabs;
    }
}

export default AnnidateView;