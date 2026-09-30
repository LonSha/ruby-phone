/* ========================================================
 * piggy-view.js — [v3.25.0] 存钱罐 App 视图
 * 归因卡 + 余额卡 + 统计卡 + 流水列表 + 记一笔表单 + 亲属卡列表 + 设置卡
 *
 * 与 focus-view 同纪律：归因文案表的键取 PIGGY_REASONS 的**值**（连字符形），
 *   不另写一套下划线形 —— 否则查不到会静默走兜底，多种处境显示成同一句话。
 *
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
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

export class PiggyView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 亲属卡表单里「自定义天数」输入框是否显示（纯视图态，不落盘） */
        this._customDaysOn = false;
        /** 两步确认：正在等待二次确认的按钮选择器（纯视图态） */
        this._pendingConfirm = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'pg-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || { balanceCents: 0 };
        const settings = app.settings;
        const parts = [];

        parts.push('<div class="pg-header"><h2>\u{1f437} 存钱罐</h2></div>');

        parts.push('<div class="pg-face pg-face-' + meta.tone + '">');
        parts.push('<span class="pg-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="pg-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        parts.push('<div class="pg-balance">');
        parts.push('<div class="pg-balance-num">' + this._esc(formatMoney(proj.balanceCents)) + '</div>');
        parts.push('<div class="pg-balance-unit">元 · 罐里现在这些</div>');
        parts.push('</div>');

        if (face === PIGGY_REASONS.empty) {
            parts.push('<div class="pg-open">');
            parts.push('<button class="pg-btn pg-btn-primary" id="pg-open">开罐（起始 ' + this._esc(formatMoney(app.defaultBalanceCents())) + ' 元）</button>');
            parts.push('<div class="pg-hint">开罐只在本会话生效；换角色后是另一个罐。</div>');
            parts.push('</div>');
        }

        if (proj.hasHistory) {
            parts.push('<div class="pg-stats">');
            parts.push('<div class="pg-stat-row"><span>本月支出</span><span>' + this._esc(formatMoney(proj.monthExpenseCents)) + ' 元</span></div>');
            parts.push('<div class="pg-stat-row"><span>本月收入</span><span>' + this._esc(formatMoney(proj.monthIncomeCents)) + ' 元</span></div>');
            parts.push('<div class="pg-stat-row"><span>累计结余</span><span>' + this._esc(formatMoney(proj.netCents)) + ' 元</span></div>');
            parts.push('<div class="pg-stat-row"><span>流水条数</span><span>' + proj.txCount + ' 条</span></div>');
            parts.push('</div>');
        }

        /* ---------- 记一笔 ---------- */
        parts.push('<div class="pg-create">');
        parts.push('<h3>记一笔</h3>');
        parts.push('<div class="pg-kind">');
        parts.push('<label class="pg-radio"><input type="radio" name="pg-kind" value="expense" checked> 支出</label>');
        parts.push('<label class="pg-radio"><input type="radio" name="pg-kind" value="income"> 收入</label>');
        parts.push('</div>');
        parts.push('<input class="pg-input" id="pg-amount" type="number" min="0.01" step="0.01" placeholder="金额（元）">');
        parts.push('<input class="pg-input" id="pg-remark" type="text" maxlength="40" placeholder="备注（可空）">');
        parts.push('<button class="pg-btn pg-btn-primary" id="pg-add">记下</button>');
        parts.push('</div>');

        /* ---------- 流水 ---------- */
        const txs = app.transactions();
        parts.push('<div class="pg-list">');
        parts.push('<h3 class="pg-list-title">流水（' + txs.length + '）</h3>');
        if (!txs.length) {
            parts.push('<div class="pg-empty">还没有记过。上面记一笔就会出现在这里。</div>');
        } else {
            for (const t of txs) {
                parts.push('<div class="pg-tx" data-id="' + this._esc(t.id) + '">');
                parts.push('<div class="pg-tx-info">');
                parts.push('<div class="pg-tx-remark">' + this._esc(t.remark) + '</div>');
                parts.push('<div class="pg-tx-meta">' + this._esc(t.source) + ' · ' + this._esc(this._when(t.time)) + '</div>');
                parts.push('</div>');
                parts.push('<div class="pg-tx-amt ' + (t.kind === 'expense' ? 'is-out' : 'is-in') + '">'
                    + (t.kind === 'expense' ? '-' : '+') + this._esc(formatMoney(t.amountCents)) + '</div>');
                parts.push('<button class="pg-mini pg-del" data-id="' + this._esc(t.id) + '">删</button>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 亲属卡 ---------- */
        parts.push('<div class="pg-cards">');
        parts.push('<h3 class="pg-list-title">亲属卡（' + proj.cardCount + '）</h3>');
        if (!proj.cardCount) {
            parts.push('<div class="pg-empty">还没有卡。下面开一张，额度会按周期自动重置。</div>');
        } else {
            for (const c of app.cards()) {
                parts.push('<div class="pg-card" style="background-color:' + this._esc(c.cardColor) + '">');
                parts.push('<div class="pg-card-top"><span class="pg-card-bank">' + this._esc(c.bankName) + '</span>'
                    + '<span class="pg-card-no">**** ' + this._esc(c.cardNumber) + '</span></div>');
                parts.push('<div class="pg-card-mid">' + this._esc(c.limitCents ? formatMoney(c.limitCents) : '0') + ' 元额度</div>');
                parts.push('<div class="pg-card-sub">' + this._esc(c.cardHolder || '未署名') + ' · '
                    + this._esc(PERIOD_LABEL[c.refreshPeriod] || c.refreshPeriod)
                    + (c.refreshPeriod === 'custom' ? ('（' + c.refreshDays + ' 天）') : '') + '</div>');
                parts.push('<div class="pg-card-sub">下次重置 ' + this._esc(this._when(c.nextRefreshTime))
                    + (c.status === 'draft' ? ' · 草稿' : '') + '</div>');
                parts.push('<button class="pg-mini pg-card-del" data-id="' + this._esc(c.id) + '">销卡</button>');
                parts.push('</div>');
            }
        }
        parts.push('<div class="pg-card-form">');
        parts.push('<input class="pg-input" id="pg-card-bank" type="text" maxlength="20" placeholder="卡名（默认「亲属卡」）">');
        parts.push('<input class="pg-input" id="pg-card-holder" type="text" maxlength="20" placeholder="持卡人署名（可空）">');
        parts.push('<input class="pg-input" id="pg-card-target" type="text" maxlength="20" placeholder="给谁用（填了才算在用，否则是草稿）">');
        parts.push('<input class="pg-input" id="pg-card-limit" type="number" min="0.01" step="0.01" placeholder="额度（元，默认 5000）">');
        parts.push('<select class="pg-input" id="pg-card-period">');
        for (const p of PIGGY_REFRESH_PERIODS) {
            parts.push('<option value="' + this._esc(p) + '"' + (p === 'monthly' ? ' selected' : '') + '>'
                + this._esc(PERIOD_LABEL[p]) + '</option>');
        }
        parts.push('</select>');
        parts.push('<input class="pg-input' + (this._customDaysOn ? '' : ' pg-hidden') + '" id="pg-card-days" type="number" min="1" step="1" value="30" placeholder="自定义天数">');
        parts.push('<button class="pg-btn pg-btn-primary" id="pg-card-add">开卡</button>');
        parts.push('</div>');
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="pg-settings">');
        parts.push('<h3>设置</h3>');
        parts.push('<label class="pg-toggle"><span>把余额交给生成侧</span>'
            + '<input type="checkbox" id="pg-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="pg-field"><span>注入时带最近几笔</span>'
            + '<input type="number" id="pg-max-tx" min="0" max="40" value="' + settings.maxInjectTx + '"></label>');
        parts.push('<label class="pg-field"><span>流水最多留几条</span>'
            + '<input type="number" id="pg-max-tx-keep" min="20" max="5000" value="' + settings.maxTransactions + '"></label>');
        parts.push('<div class="pg-hint">换角色 / 换会话后，这个罐和上一个角色的罐是分开的两份（键前缀 pg 前缀族随会话隔离）。'
            + '它与微信零钱是两笔不同的钱：本 App 不会扣零钱，零钱也不会动这里。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _when(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '时间未知';
        const d = new Date(n);
        const p = (x) => (x < 10 ? ('0' + x) : String(x));
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        const openBtn = q('#pg-open');
        if (openBtn) openBtn.addEventListener('click', () => { app.openPot(); this.refresh(); });

        const addBtn = q('#pg-add');
        if (addBtn) addBtn.addEventListener('click', () => {
            const amount = q('#pg-amount');
            const remark = q('#pg-remark');
            const kindEl = this._root.querySelector('input[name="pg-kind"]:checked');
            const kind = kindEl ? kindEl.value : 'expense';
            const ok = app.addTransaction({
                kind,
                amountYuan: amount ? amount.value : '',
                remark: remark ? remark.value : '',
            });
            if (!ok) {
                if (amount) amount.classList.add('is-error');
                return;
            }
            if (amount) { amount.value = ''; amount.classList.remove('is-error'); }
            if (remark) remark.value = '';
            this.refresh();
        });

        for (const btn of this._root.querySelectorAll('.pg-del')) {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                if (this._needConfirm('pg-del:' + id, btn)) return;
                app.removeTransaction(id);
                this.refresh();
            });
        }

        for (const btn of this._root.querySelectorAll('.pg-card-del')) {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                if (this._needConfirm('pg-card-del:' + id, btn)) return;
                app.removeCard(id);
                this.refresh();
            });
        }

        const period = q('#pg-card-period');
        if (period) period.addEventListener('change', () => {
            this._customDaysOn = (period.value === 'custom');
            const days = q('#pg-card-days');
            if (days) days.classList.toggle('pg-hidden', !this._customDaysOn);
        });

        const cardAdd = q('#pg-card-add');
        if (cardAdd) cardAdd.addEventListener('click', () => {
            const bank = q('#pg-card-bank');
            const holder = q('#pg-card-holder');
            const target = q('#pg-card-target');
            const limit = q('#pg-card-limit');
            const days = q('#pg-card-days');
            app.addFamilyCard({
                bankName: bank ? bank.value : '',
                cardHolder: holder ? holder.value : '',
                targetCharName: target ? target.value : '',
                limitYuan: limit ? limit.value : '',
                refreshPeriod: period ? period.value : 'monthly',
                refreshDays: days ? days.value : 30,
            });
            for (const el of [bank, holder, target, limit]) if (el) el.value = '';
            this.refresh();
        });

        const inject = q('#pg-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxTx = q('#pg-max-tx');
        if (maxTx) maxTx.addEventListener('change', (e) => {
            app.patchSettings({ maxInjectTx: e.target.value });
        });
        const maxKeep = q('#pg-max-tx-keep');
        if (maxKeep) maxKeep.addEventListener('change', (e) => {
            app.patchSettings({ maxTransactions: e.target.value });
        });
    }

    /**
     * 两步确认（销流水 / 销卡都不可逆，而本仓不弹宿主 confirm）。
     * 第一次点击把按钮变成「确认」，第二次才真执行；点别处或重画即复位。
     */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('pg-mini-armed'); }
        return true;
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}
