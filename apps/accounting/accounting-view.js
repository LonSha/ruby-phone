/* ========================================================
 * accounting-view.js — [v3.22.0] 记账 App 视图
 * 归因卡 + 净值卡 + 本月汇总 + 账本自检 + 账户列表 + 账户表单 + 记一笔 + 流水 + 设置
 * 归因文案表的键取 ACCOUNTING_REASONS 的**值**（连字符形），不另写一套下划线形。
 * ======================================================== */
import { ACCOUNTING_REASONS, formatMoney } from './accounting-data.js';

const FACE_META = {
    [ACCOUNTING_REASONS.ready]: { icon: '\ud83d\udcd2', label: '账本已就绪', tone: 'ok' },
    [ACCOUNTING_REASONS.no_accounts]: { icon: '\u2615', label: '还没有账户（先建一个）', tone: 'warn' },
    [ACCOUNTING_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};
export class AccountingView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._kind = 'expense';
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'ac-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    /**
     * 重画。**只重画、不重算** —— 派生量（净值 / 本月收支）由 app.refresh() 现算。
     * 为什么要把两件事分开：本视图的 refresh() 若被当成「改完数据的刷新入口」，
     *   记一笔后界面会照旧画出**旧读数**（不报错、不崩溃、只错结果）。
     *   改数据 → app.refresh()（重算 + 重画）；纯视图态（收支切换）→ view.refresh()。
     */
    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const stats = app.projection();
        const accounts = app.accountList();
        const parts = [];

        parts.push('<div class="ac-header"><h2>\ud83d\udcd2 记账</h2></div>');
        parts.push('<div class="ac-face ac-face-' + meta.tone + '">');
        parts.push('<span class="ac-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="ac-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');
        if (stats && stats.hasAccounts) {
            parts.push('<div class="ac-net">');
            parts.push('<div class="ac-net-label">净值</div>');
            parts.push('<div class="ac-net-value">' + this._esc(formatMoney(stats.netWorth)) + '</div>');
            parts.push('<div class="ac-net-meta">');
            parts.push('<span class="ac-chip">资产 ' + this._esc(formatMoney(stats.assets)) + '</span>');
            parts.push('<span class="ac-chip ac-chip-debt">负债 ' + this._esc(formatMoney(stats.liabilities)) + '</span>');
            parts.push('</div>');
            parts.push('</div>');
            parts.push('<div class="ac-month">');
            parts.push('<div class="ac-stat-row"><span>本月收入</span><span>' + this._esc(formatMoney(stats.monthIncome)) + '</span></div>');
            parts.push('<div class="ac-stat-row"><span>本月支出</span><span>' + this._esc(formatMoney(stats.monthExpense)) + '</span></div>');
            parts.push('<div class="ac-stat-row"><span>本月结余</span><span>' + this._esc(formatMoney(stats.monthBalance)) + '</span></div>');
            if (stats.topExpenseCategory) {
                parts.push('<div class="ac-stat-row"><span>最大支出</span><span>' + this._esc(stats.topExpenseCategory.category + ' ' + formatMoney(stats.topExpenseCategory.amount)) + '</span></div>');
            }
            parts.push('</div>');
        }

        // 账本自检卡（可核对读数：净值 = 资产 − 负债）
        parts.push(this._selfCheckHTML());

        // 账户列表
        if (accounts.length > 0) {
            parts.push('<div class="ac-accounts">');
            for (const a of accounts) {
                parts.push('<div class="ac-account" data-id="' + this._esc(a.id) + '">');
                parts.push('<div class="ac-account-info">');
                parts.push('<div class="ac-account-name">' + this._esc(a.name) + '</div>');
                parts.push('<div class="ac-account-type">' + this._esc(a.group + ' · ' + a.type) + '</div>');
                parts.push('</div>');
                parts.push('<div class="ac-account-right">');
                parts.push('<span class="ac-account-balance' + (a.balance < 0 ? ' is-neg' : '') + '">' + this._esc(formatMoney(a.balance)) + '</span>');
                parts.push('<button class="ac-mini ac-acc-del">删除</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        // 账户表单
        const groups = app.groups();
        parts.push('<div class="ac-card">');
        parts.push('<h3>\u2795 新建账户</h3>');
        parts.push('<input class="ac-input" id="ac-acc-name" type="text" maxlength="20" placeholder="账户名（如：招行储蓄卡）">');
        parts.push('<div class="ac-row">');
        parts.push('<select class="ac-select" id="ac-acc-group">');
        for (const g of groups) parts.push('<option value="' + this._esc(g.name) + '">' + g.icon + ' ' + this._esc(g.name) + '</option>');
        parts.push('</select>');
        parts.push('<select class="ac-select" id="ac-acc-type"></select>');
        parts.push('</div>');
        parts.push('<input class="ac-input" id="ac-acc-balance" type="number" step="0.01" placeholder="初始余额（元，可留空）">');
        parts.push('<button class="ac-btn ac-btn-primary" id="ac-acc-add">创建账户</button>');
        parts.push('</div>');
        // 记一笔
        if (accounts.length > 0) {
            const cats = (this._kind === 'income') ? app.incomeCategories() : app.expenseCategories();
            parts.push('<div class="ac-card">');
            parts.push('<h3>\u270f\ufe0f 记一笔</h3>');
            parts.push('<div class="ac-kinds">');
            parts.push('<button class="ac-kind' + (this._kind === 'expense' ? ' is-active' : '') + '" data-kind="expense">支出</button>');
            parts.push('<button class="ac-kind' + (this._kind === 'income' ? ' is-active' : '') + '" data-kind="income">收入</button>');
            parts.push('</div>');
            parts.push('<input class="ac-input" id="ac-rec-amount" type="number" step="0.01" min="0" placeholder="金额（元）">');
            parts.push('<div class="ac-row">');
            parts.push('<select class="ac-select" id="ac-rec-cat">');
            for (const c of cats) parts.push('<option value="' + this._esc(c) + '">' + this._esc(c) + '</option>');
            parts.push('</select>');
            parts.push('<select class="ac-select" id="ac-rec-acc">');
            for (const a of accounts) parts.push('<option value="' + this._esc(a.id) + '">' + this._esc(a.name) + '</option>');
            parts.push('</select>');
            parts.push('</div>');
            parts.push('<input class="ac-input" id="ac-rec-note" type="text" maxlength="30" placeholder="备注（可留空）">');
            parts.push('<button class="ac-btn ac-btn-primary" id="ac-rec-add">记下</button>');
            parts.push('</div>');
        }
        // 流水
        const recs = app.recordList().slice().reverse().slice(0, 30);
        if (recs.length > 0) {
            parts.push('<div class="ac-records">');
            parts.push('<h3>最近流水</h3>');
            for (const r of recs) {
                parts.push('<div class="ac-record" data-id="' + this._esc(r.id) + '">');
                parts.push('<span class="ac-rec-cat">' + this._esc(r.category) + '</span>');
                parts.push('<span class="ac-rec-note">' + this._esc(r.note || this._dateLabel(r.at)) + '</span>');
                parts.push('<span class="ac-rec-amt ' + (r.kind === 'income' ? 'is-in' : 'is-out') + '">' + (r.kind === 'income' ? '+' : '-') + this._esc(formatMoney(r.amount)) + '</span>');
                parts.push('<button class="ac-mini ac-rec-del">\u2715</button>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        // 设置
        parts.push('<div class="ac-card ac-settings">');
        parts.push('<h3>\u2699\ufe0f 设置</h3>');
        parts.push('<label class="ac-toggle"><input type="checkbox" id="ac-inject" ' + (app.settings.injectToPrompt ? 'checked' : '') + '><span>月度收支注入 Prompt</span></label>');
        parts.push('<label class="ac-field"><span>月度预算（元，0=不设）</span><input type="number" id="ac-budget" min="0" step="1" value="' + Math.round(app.settings.monthlyBudget / 100) + '"></label>');
        parts.push('<div class="ac-hint">只注入月度事实（收入/支出/结余/最大支出项），逐笔流水不注入。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    /**
     * 账本自检卡。
     * ★ 为什么要有这张卡：账本算法坏掉时，界面不报错、不崩溃，只是**算出一个错的数**
     *   —— “算错了”与“本来就是这个数”在界面上**同形**，用户自己无法分辨。
     *   自检把“算式链没坏”变成一个可核对的读数（净值是否真的等于 资产 − 负债）。
     */
    _selfCheckHTML() {
        const sc = this.app.selfCheck ? this.app.selfCheck() : null;
        if (!sc) {
            return '<div class="ac-card ac-warn">账本自检读不出来（取数失败）。</div>';
        }
        const stats = this.app.projection();
        const parts = [];
        parts.push('<div class="ac-card ac-selfcheck">');
        parts.push('<h3>\ud83e\uddea 账本自检</h3>');
        parts.push('<div class="ac-stat-row"><span>算式检查</span><span>'
            + sc.pass + ' 项通过' + (sc.fail > 0 ? ' · <b>' + sc.fail + ' 项不过</b>' : ' · 全部通过')
            + '</span></div>');
        if (stats && stats.hasAccounts) {
            parts.push('<div class="ac-stat-row"><span>可核对（净值 = 资产 − 负债）</span><span>'
                + this._esc(formatMoney(stats.assets) + ' − ' + formatMoney(stats.liabilities) + ' = ' + formatMoney(stats.netWorth))
                + '</span></div>');
        }
        parts.push('<div class="ac-hint">若这里出现不过的项，说明账本算法本身坏了（'
            + (sc.notes && sc.notes.length ? '失败：' + this._esc(sc.notes.slice(0, 3).join('、')) : '当前无')
            + '）—— 而界面看上去一切正常。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }

    _dateLabel(ts) {
        try {
            const d = new Date(ts);
            if (!Number.isFinite(d.getTime())) return '';
            return (d.getMonth() + 1) + '月' + d.getDate() + '日';
        } catch (_e) { return ''; }
    }
    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);
        const groupSel = q('#ac-acc-group');
        const typeSel = q('#ac-acc-type');
        const fillTypes = () => {
            if (!groupSel || !typeSel) return;
            const types = app.typesOf(groupSel.value);
            typeSel.innerHTML = '';
            for (const t of types) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                typeSel.appendChild(opt);
            }
        };
        if (groupSel) { fillTypes(); groupSel.addEventListener('change', fillTypes); }
        const accAdd = q('#ac-acc-add');
        if (accAdd) accAdd.addEventListener('click', () => {
            const nameEl = q('#ac-acc-name');
            const balEl = q('#ac-acc-balance');
            const acc = app.addAccount(nameEl ? nameEl.value : '', groupSel ? groupSel.value : '普通账户', typeSel ? typeSel.value : '其他', balEl ? balEl.value : '');
            if (!acc) { if (nameEl) nameEl.classList.add('is-error'); return; }
            /* 这里不再自己重画：改数据的方法自己会叫 app.refresh()（重算派生量 + 重画）。 */
        });
        for (const row of this._root.querySelectorAll('.ac-account')) {
            const delBtn = row.querySelector('.ac-acc-del');
            if (delBtn) delBtn.addEventListener('click', () => { app.removeAccount(row.dataset.id); });
        }
        for (const k of this._root.querySelectorAll('.ac-kind')) {
            k.addEventListener('click', () => { this._kind = k.dataset.kind; this.refresh(); });
        }
        const recAdd = q('#ac-rec-add');
        if (recAdd) recAdd.addEventListener('click', () => {
            const amtEl = q('#ac-rec-amount');
            const catEl = q('#ac-rec-cat');
            const accEl = q('#ac-rec-acc');
            const noteEl = q('#ac-rec-note');
            const rec = app.addRecord(this._kind, amtEl ? amtEl.value : '', catEl ? catEl.value : '其他', accEl ? accEl.value : '', noteEl ? noteEl.value : '');
            if (!rec) { if (amtEl) amtEl.classList.add('is-error'); return; }
            /* 同上：重画由改数据的方法（app.addRecord → app.refresh）承担。 */
        });
        for (const row of this._root.querySelectorAll('.ac-record')) {
            const delBtn = row.querySelector('.ac-rec-del');
            if (delBtn) delBtn.addEventListener('click', () => { app.removeRecord(row.dataset.id); });
        }
        const inject = q('#ac-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const budget = q('#ac-budget');
        if (budget) budget.addEventListener('change', (e) => {
            const yuan = parseInt(e.target.value, 10);
            app.settings = { ...app.settings, monthlyBudget: Number.isFinite(yuan) && yuan > 0 ? yuan * 100 : 0 };
            app.saveSettings();
        });
    }
    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}