/* ========================================================
 * piggy-view.js — [v4.167.0]「照现实重写」· 存钱罐 App 视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 归因卡 + 余额 + 统计 + 记一笔 + 流水 + 亲属卡 + 设置，全挤在一列；
 *   事件按 id / 类名逐元素绑（每次重绘都重新绑一遍）。
 * 现实里的钱夹 App 是四块：**罐**（现在有多少、这个月花了多少、记一笔）→ **流水**
 *   → **卡**（亲属卡与额度）→ **设置**。
 *
 * 三处「不越界」照旧，一字未改：
 *   · 本件只记自己这本账：**它与微信零钱是两笔不同的钱**，不扣零钱，零钱也不动这里；
 *   · 换角色 / 换会话就是另一个罐（键前缀 piggy_ 随会话隔离）；
 *   · 销流水 / 销卡不可逆，按两下才动手（本仓不弹宿主 confirm）。
 *
 * 接线纪律（与心境 / 周期数学 / 幸运转盘 / 纪念日 / 小红书 / 天气 / 打卡同一套）：
 *   事件只在根容器上挂一次：click / input / change 各一个，靠 data-act 与 dataset 分派；
 *   读不到 DOM 不抛；钱数一律过 formatMoney，不自己拼小数。
 *
 * 关于亲属卡的 `style`：卡面底色是**数据**（每张卡自带 cardColor），不是布局状态 ——
 *   所以它只能随卡走 inline；状态类的东西（展开 / 待确认）一律走类名，不写行内样式。
 * ======================================================== */
'use strict';
import { PIGGY_REASONS, PIGGY_REFRESH_PERIODS, formatMoney } from './piggy-data.js';

const FACE_META = {
    [PIGGY_REASONS.ready]: { icon: '\u{1f437}', label: '存钱罐已就绪', tone: 'ok' },
    [PIGGY_REASONS.empty]: { icon: '\u{1f4e6}', label: '这个会话还没开过罐', tone: 'warn' },
    [PIGGY_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

const PERIOD_LABEL = {
    daily: '每天',
    weekly: '每周',
    monthly: '每月（按日历月）',
    custom: '自定义天数',
};

const TABS = [
    { key: 'pot', label: '罐' },
    { key: 'flow', label: '流水' },
    { key: 'cards', label: '卡' },
    { key: 'settings', label: '设置' },
];

const DASH = String.fromCharCode(45, 45);

export class PiggyView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this.tab = 'pot';
        /** 记一笔的表单草稿（纯视图态，不落盘） */
        this._form = { kind: 'expense', amount: '', remark: '' };
        /** 开卡表单草稿（纯视图态） */
        this._cardForm = { bank: '', holder: '', target: '', limit: '', period: 'monthly', days: '30' };
        /** 两步确认：`tx:<id>` / `card:<id>` */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
        this._boundRoot = null;
        this._hClick = null;
        this._hInput = null;
        this._hChange = null;
    }

    /* ---------- 1. 挂载与重绘 ---------- */

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'pg-root';
        container.appendChild(this._root);
        this.refresh();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _projection() {
        try {
            const p = this.app.projection();
            if (p && typeof p === 'object') return p;
        } catch (_e) { /* 读不到就按空投影画，归因条上会如实说明 */ }
        return {
            balanceCents: 0, monthExpenseCents: 0, monthIncomeCents: 0, netCents: 0,
            txCount: 0, cardCount: 0, hasHistory: false,
        };
    }

    _txs() {
        try {
            const list = this.app.transactions();
            if (Array.isArray(list)) return list;
        } catch (_e) { /* 同上 */ }
        return [];
    }

    _cards() {
        try {
            const list = this.app.cards();
            if (Array.isArray(list)) return list;
        } catch (_e) { /* 同上 */ }
        return [];
    }

    /* ---------- 2. 四页 ---------- */

    _potHTML(proj, face) {
        const app = this.app;
        const parts = ['<section class="pg-page" data-page="pot">'];
        parts.push('<div class="pg-balance">');
        parts.push('<div class="pg-balance-num">' + this._esc(formatMoney(proj.balanceCents)) + '</div>');
        parts.push('<div class="pg-balance-unit">元 · 罐里现在这些</div>');
        parts.push('</div>');

        if (face === PIGGY_REASONS.empty) {
            const start = (typeof app.defaultBalanceCents === 'function') ? app.defaultBalanceCents() : 0;
            parts.push('<div class="pg-open">');
            parts.push('<button class="pg-btn pg-btn-primary" data-act="open-pot">开罐（起始 '
                + this._esc(formatMoney(start)) + ' 元）</button>');
            parts.push('<div class="pg-hint">开罐只在本会话生效；换角色后是另一个罐。</div>');
            parts.push('</div>');
        }

        if (proj.hasHistory) {
            parts.push('<div class="pg-stats">');
            parts.push('<div class="pg-stat-row"><span>本月支出</span><span>'
                + this._esc(formatMoney(proj.monthExpenseCents)) + ' 元</span></div>');
            parts.push('<div class="pg-stat-row"><span>本月收入</span><span>'
                + this._esc(formatMoney(proj.monthIncomeCents)) + ' 元</span></div>');
            parts.push('<div class="pg-stat-row"><span>累计结余</span><span>'
                + this._esc(formatMoney(proj.netCents)) + ' 元</span></div>');
            parts.push('<div class="pg-stat-row"><span>流水条数</span><span>'
                + this._esc(String(proj.txCount)) + ' 条</span></div>');
            parts.push('</div>');
        }

        const f = this._form;
        parts.push('<div class="pg-create">');
        parts.push('<h3>记一笔</h3>');
        parts.push('<div class="pg-kind">');
        parts.push('<label class="pg-radio"><input type="radio" name="pg-kind" value="expense" data-act="kind"'
            + (f.kind === 'expense' ? ' checked' : '') + '> 支出</label>');
        parts.push('<label class="pg-radio"><input type="radio" name="pg-kind" value="income" data-act="kind"'
            + (f.kind === 'income' ? ' checked' : '') + '> 收入</label>');
        parts.push('</div>');
        parts.push('<input class="pg-input" type="number" min="0.01" step="0.01" data-in="amount"'
            + ' placeholder="金额（元）" value="' + this._esc(f.amount) + '">');
        parts.push('<input class="pg-input" type="text" maxlength="40" data-in="remark"'
            + ' placeholder="备注（可空）" value="' + this._esc(f.remark) + '">');
        parts.push('<button class="pg-btn pg-btn-primary" data-act="add-tx">记下</button>');
        parts.push('<div class="pg-hint">这一笔只动这个罐，<strong>不动微信零钱</strong>；'
            + '零钱那边也不会自动记到这里。两笔钱互不干涉。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _flowHTML(txs) {
        const parts = ['<section class="pg-page" data-page="flow">'];
        parts.push('<div class="pg-list">');
        parts.push('<h3 class="pg-list-title">流水（' + this._esc(String(txs.length)) + '）</h3>');
        if (!txs.length) {
            parts.push('<div class="pg-empty">还没有记过。去「罐」记一笔就会出现在这里。</div>');
        } else {
            for (const t of txs) {
                const armed = this._pendingConfirm === ('tx:' + t.id);
                parts.push('<div class="pg-tx" data-id="' + this._esc(t.id) + '">');
                parts.push('<div class="pg-tx-info">');
                parts.push('<div class="pg-tx-remark">' + this._esc(t.remark) + '</div>');
                parts.push('<div class="pg-tx-meta">' + this._esc(t.source) + ' · ' + this._esc(this._when(t.time)) + '</div>');
                parts.push('</div>');
                parts.push('<div class="pg-tx-amt ' + (t.kind === 'expense' ? 'is-out' : 'is-in') + '">'
                    + (t.kind === 'expense' ? '-' : '+') + this._esc(formatMoney(t.amountCents)) + '</div>');
                parts.push('<button class="pg-mini pg-del' + (armed ? ' pg-mini-armed' : '')
                    + '" data-act="del-tx" data-id="' + this._esc(t.id) + '">' + (armed ? '确认' : '删') + '</button>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');
        parts.push('<div class="pg-hint">销一笔会把那一笔的金额按反方向退回罐里；不可逆，所以第二下才动手。</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _cardsHTML(proj, cards) {
        const parts = ['<section class="pg-page" data-page="cards">'];
        parts.push('<div class="pg-cards">');
        parts.push('<h3 class="pg-list-title">亲属卡（' + this._esc(String(proj.cardCount)) + '）</h3>');
        if (!cards.length) {
            parts.push('<div class="pg-empty">还没有卡。下面开一张，额度会按周期自动重置。</div>');
        } else {
            for (const c of cards) {
                const armed = this._pendingConfirm === ('card:' + c.id);
                parts.push('<div class="pg-card" style="background-color:' + this._esc(c.cardColor) + '">');
                parts.push('<div class="pg-card-top"><span class="pg-card-bank">' + this._esc(c.bankName) + '</span>'
                    + '<span class="pg-card-no">**** ' + this._esc(c.cardNumber) + '</span></div>');
                parts.push('<div class="pg-card-mid">' + this._esc(c.limitCents ? formatMoney(c.limitCents) : '0')
                    + ' 元额度</div>');
                parts.push('<div class="pg-card-sub">' + this._esc(c.cardHolder || '未署名') + ' · '
                    + this._esc(PERIOD_LABEL[c.refreshPeriod] || c.refreshPeriod)
                    + (c.refreshPeriod === 'custom' ? ('（' + this._esc(String(c.refreshDays)) + ' 天）') : '') + '</div>');
                parts.push('<div class="pg-card-sub">下次重置 ' + this._esc(this._when(c.nextRefreshTime))
                    + (c.status === 'draft' ? ' · 草稿（没写给谁用）' : '') + '</div>');
                parts.push('<button class="pg-mini pg-card-del' + (armed ? ' pg-mini-armed' : '')
                    + '" data-act="del-card" data-id="' + this._esc(c.id) + '">' + (armed ? '确认销卡' : '销卡') + '</button>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        const cf = this._cardForm;
        parts.push('<div class="pg-card-form">');
        parts.push('<h3 class="pg-list-title">开一张</h3>');
        parts.push('<input class="pg-input" type="text" maxlength="20" data-in="bank" placeholder="卡名（默认「亲属卡」）"'
            + ' value="' + this._esc(cf.bank) + '">');
        parts.push('<input class="pg-input" type="text" maxlength="20" data-in="holder" placeholder="持卡人署名（可空）"'
            + ' value="' + this._esc(cf.holder) + '">');
        parts.push('<input class="pg-input" type="text" maxlength="20" data-in="target"'
            + ' placeholder="给谁用（填了才算在用，否则是草稿）" value="' + this._esc(cf.target) + '">');
        parts.push('<input class="pg-input" type="number" min="0.01" step="0.01" data-in="limit"'
            + ' placeholder="额度（元，默认 5000）" value="' + this._esc(cf.limit) + '">');
        parts.push('<select class="pg-input" data-act="period">');
        for (const p of PIGGY_REFRESH_PERIODS) {
            parts.push('<option value="' + this._esc(p) + '"' + (p === cf.period ? ' selected' : '') + '>'
                + this._esc(PERIOD_LABEL[p]) + '</option>');
        }
        parts.push('</select>');
        parts.push('<input class="pg-input' + (cf.period === 'custom' ? '' : ' pg-hidden') + '" type="number" min="1"'
            + ' step="1" data-in="days" placeholder="自定义天数" value="' + this._esc(String(cf.days)) + '">');
        parts.push('<button class="pg-btn pg-btn-primary" data-act="add-card">开卡</button>');
        parts.push('<div class="pg-hint">额度按周期自动重置；「给谁用」空着的卡是草稿，不参与扣款判断。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    _settingsHTML() {
        const settings = this.app.settings || {};
        const parts = ['<section class="pg-page" data-page="settings">'];
        parts.push('<div class="pg-settings">');
        parts.push('<h3>设置</h3>');
        parts.push('<label class="pg-toggle"><span>把余额交给生成侧</span>'
            + '<input type="checkbox" data-act="inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="pg-field"><span>注入时带最近几笔</span>'
            + '<input type="number" data-act="max-tx" min="0" max="40" value="'
            + this._esc(String(settings.maxInjectTx)) + '"></label>');
        parts.push('<label class="pg-field"><span>流水最多留几条</span>'
            + '<input type="number" data-act="max-keep" min="20" max="5000" value="'
            + this._esc(String(settings.maxTransactions)) + '"></label>');
        parts.push('<div class="pg-hint">换角色 / 换会话后，这个罐和上一个角色的罐是分开的两份。'
            + '它与微信零钱是两笔不同的钱：本 App 不会扣零钱，零钱也不会动这里。</div>');
        parts.push('</div>');
        parts.push('</section>');
        return parts.join('');
    }

    /* ---------- 3. 总装 ---------- */

    _buildHTML() {
        const app = this.app;
        let face = PIGGY_REASONS.empty;
        try {
            if (typeof app.faceReason === 'function') face = app.faceReason();
        } catch (_e) { face = PIGGY_REASONS.storage_absent; }
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = this._projection();
        const txs = this._txs();
        const cards = this._cards();
        const page = this.tab === 'flow' ? this._flowHTML(txs)
            : (this.tab === 'cards' ? this._cardsHTML(proj, cards)
                : (this.tab === 'settings' ? this._settingsHTML() : this._potHTML(proj, face)));

        const head = '<div class="pg-header"><h2>\u{1f437} 存钱罐</h2>'
            + '<span class="pg-head-meta">' + this._esc(formatMoney(proj.balanceCents)) + ' 元 · '
            + this._esc(String(proj.txCount)) + ' 笔</span></div>'
            + '<div class="pg-face pg-face-' + meta.tone + '">'
            + '<span class="pg-face-icon">' + meta.icon + '</span>'
            + '<span class="pg-face-label">' + this._esc(meta.label) + '</span></div>'
            + (this._flash ? '<div class="pg-flash">' + this._esc(this._flash) + '</div>' : '');

        const tabs = ['<nav class="pg-tabbar">']
            .concat(TABS.map((t) => '<button class="pg-tab' + (this.tab === t.key ? ' is-on' : '')
                + '" data-act="tab" data-tab="' + t.key + '">' + t.label + '</button>'))
            .concat(['</nav>'])
            .join('');
        return head + page + tabs;
    }

    /* ---------- 4. 事件（根容器各挂一次） ---------- */

    _bindEvents() {
        if (!this._root) return;
        if (this._boundRoot !== this._root) {
            this._hClick = (ev) => this._onClick(ev);
            this._hInput = (ev) => this._onInput(ev);
            this._hChange = (ev) => this._onChange(ev);
            this._root.addEventListener('click', this._hClick);
            this._root.addEventListener('input', this._hInput);
            this._root.addEventListener('change', this._hChange);
            this._boundRoot = this._root;
        }
    }

    /** 取元素：读不到就返回 null（宿主 DOM 不全会抛）。 */
    q(sel) {
        try { return this._root && this._root.querySelector ? this._root.querySelector(sel) : null; }
        catch (_e) { return null; }
    }

    _el(ev) { return (ev && ev.target) || null; }

    _attr(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    /** 读一条记录的 id：优先 dataset（事件回读的标准路径），再退到属性读。 */
    _id(el) {
        try {
            if (el && el.dataset && el.dataset.id) return String(el.dataset.id);
        } catch (_e) { /* 往下退 */ }
        return this._attr(el, 'data-id') || '';
    }

    _hit(target) {
        return (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
    }

    /** 把「待确认」这件事只画在那个按钮上，不重绘整页（省一次滚动复位与焦点丢失）。 */
    _armOnly(btn) {
        const all = this._root ? this._root.querySelectorAll('.pg-del, .pg-card-del') : [];
        for (const b of all) {
            if (b === btn) continue;
            b.textContent = b.classList.contains('pg-card-del') ? '销卡' : '删';
            if (b.classList && b.classList.remove) b.classList.remove('pg-mini-armed');
        }
        if (btn) {
            btn.textContent = btn.classList.contains('pg-card-del') ? '确认销卡' : '确认';
            if (btn.classList && btn.classList.add) btn.classList.add('pg-mini-armed');
        }
    }

    _onInput(ev) {
        const el = this._el(ev);
        const field = this._attr(el, 'data-in');
        if (!field) return;
        if (field in this._form) { this._form[field] = el.value; return; }
        if (field in this._cardForm) { this._cardForm[field] = el.value; return; }
    }

    _onChange(ev) {
        const el = this._el(ev);
        const hit = this._hit(el);
        const act = this._attr(hit, 'data-act');
        if (!act) return;

        if (act === 'kind') {
            this._form.kind = (el && el.value === 'income') ? 'income' : 'expense';
            return;
        }
        if (act === 'period') {
            this._cardForm.period = (el && el.value) || 'monthly';
            /* 只有「自定义天数」才露出天数输入框：重画一次比手改 class 更不容易漏。 */
            this.refresh();
            return;
        }
        if (act === 'inject') {
            this.app.settings = Object.assign({}, this.app.settings, { injectToPrompt: !!(el && el.checked) });
            if (typeof this.app.saveSettings === 'function') this.app.saveSettings();
            return;
        }
        if (act === 'max-tx') { this.app.patchSettings({ maxInjectTx: el.value }); return; }
        if (act === 'max-keep') { this.app.patchSettings({ maxTransactions: el.value }); return; }
    }

    _onClick(ev) {
        const target = this._el(ev);
        const hit = this._hit(target);
        const act = this._attr(hit, 'data-act');
        if (!act) return;

        if (act === 'tab') {
            const key = this._attr(hit, 'data-tab') || 'pot';
            if (!TABS.some((t) => t.key === key)) return;
            const on = this.q('.pg-tab.is-on');
            if (on && this._attr(on, 'data-tab') === key) return;
            this.tab = key;
            this._pendingConfirm = '';
            this.refresh();
            return;
        }
        if (act === 'open-pot') {
            this.app.openPot();
            this.refresh();
            return;
        }
        if (act === 'add-tx') {
            const ok = this.app.addTransaction({
                kind: this._form.kind,
                amountYuan: this._form.amount,
                remark: this._form.remark,
            });
            if (!ok) { this._flash = '金额要大于 0（比如 12.50）'; this.refresh(); return; }
            this._form.amount = '';
            this._form.remark = '';
            this._flash = '记下了';
            this.refresh();
            return;
        }
        if (act === 'del-tx') {
            const id = this._id(hit);
            if (this._pendingConfirm !== ('tx:' + id)) {
                this._pendingConfirm = 'tx:' + id;
                this._armOnly(hit);
                return;
            }
            this._pendingConfirm = '';
            const n = this.app.removeTransaction(id);
            this._flash = n ? '销掉一笔，金额已按反方向退回' : '没销到（这一笔可能已经不在流水里）';
            this.refresh();
            return;
        }
        if (act === 'del-card') {
            const id = this._id(hit);
            if (this._pendingConfirm !== ('card:' + id)) {
                this._pendingConfirm = 'card:' + id;
                this._armOnly(hit);
                return;
            }
            this._pendingConfirm = '';
            const n = this.app.removeCard(id);
            this._flash = n ? '销掉这张卡' : '没销到（这张卡可能已经不在册里）';
            this.refresh();
            return;
        }
        if (act === 'add-card') {
            const cf = this._cardForm;
            this.app.addFamilyCard({
                bankName: cf.bank,
                cardHolder: cf.holder,
                targetCharName: cf.target,
                limitYuan: cf.limit,
                refreshPeriod: cf.period,
                refreshDays: cf.days,
            });
            this._cardForm = { bank: '', holder: '', target: '', limit: '', period: cf.period, days: cf.days };
            this._flash = '开好了';
            this.refresh();
        }
    }

    _when(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '时间未知';
        const d = new Date(n);
        const p = (x) => (x < 10 ? ('0' + x) : String(x));
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}

export default PiggyView;