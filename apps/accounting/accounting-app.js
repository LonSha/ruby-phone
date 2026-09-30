/* ========================================================
 * accounting-app.js — [v3.22.0] 记账 App 控制器
 * 照抄 clock/focus 规格：取数 → 投影 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xintuk 的 tukey-accounting。**只缝本地账本那一半**：
 *   账户树（5 大类 × 类型）→ 账户余额 → 收支流水 → 本月投影 → 事实注入。
 * 不缝另一半（AI 群聊记账）：它建一个「记账群聊」，让模型解析自然语言生成账单、
 *   并支持重 Roll —— 那是群聊引擎 + 模型侧的事，本仓没有对应结构，
 *   硬缝只会造出一个「点开就报错」的壳。
 * ======================================================== */

import {
    ACCOUNT_GROUPS, ACCOUNT_TYPES, EXPENSE_CATEGORIES, INCOME_CATEGORIES,
    ACCOUNTING_REASONS,
    defaultAccountingSettings, normalizeAccountingSettings,
    normalizeAccount, normalizeRecord,
    readAccountingFace, projectAccounting, formatMoney, accountingPromptBlock,
    yuanToCents,
    /* 导入不取别名：零消费导出门禁按**裸名**判消费，
       别名（如 `selfTest as x`）在它眼里不算消费。 */
    selfTest,
} from './accounting-data.js';
import { AccountingView } from './accounting-view.js';

const SETTINGS_KEY = 'accounting_settings';
const ACCOUNTS_KEY = 'accounting_accounts';
const RECORDS_KEY = 'accounting_records';

export class AccountingApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultAccountingSettings() };
        this.accounts = [];
        this.records = [];
        this.face = ACCOUNTING_REASONS.storage_absent;
        this.stats = null;
        /* 存储可读性（probe 时落）。归因按**实测**说明，不硬编 true。 */
        this._storageOk = false;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    _readArr(key) {
        try {
            if (!this.storage) return { ok: false, arr: [] };
            const raw = this.storage.get(key);
            let arr = raw;
            if (typeof raw === 'string') {
                try { arr = JSON.parse(raw); } catch (_e) { return { ok: true, arr: [] }; }
            }
            return { ok: true, arr: Array.isArray(arr) ? arr : [] };
        } catch (_e) { return { ok: false, arr: [] }; }
    }

    /** 现取（每次 render / refresh 重取，不持跨轮副本）。 */
    probe() {
        const a = this._readArr(ACCOUNTS_KEY);
        const r = this._readArr(RECORDS_KEY);
        this.accounts = a.arr.map((x) => normalizeAccount(x)).filter(Boolean);
        this.records = r.arr.map((x) => normalizeRecord(x)).filter(Boolean);
        const storageOk = a.ok && r.ok;
        this._storageOk = storageOk;
        this.face = readAccountingFace({ storageOk, accounts: this.accounts });
        this.stats = projectAccounting(this.accounts, this.records, Date.now());
    }

    /**
     * 重算派生量并重画 —— **改完数据后的唯一重画入口**。
     *
     * 为什么：`stats` 是**派生量**（由 accounts + records 现算出来的），
     * 而视图的 refresh() 只重建 HTML、不重算派生量 —— 于是记一笔后
     * 净值与本月结余会**停在旧读数**，界面不报错、不崩，只是显示不对。
     * 实测：tests/accounting-smoke.mjs 记一笔 88.5 元后，`projection().assets`
     * 仍报 100000，而真值应为 91150。
     */
    refresh() {
        this.stats = projectAccounting(this.accounts, this.records, Date.now());
        this.face = readAccountingFace({ storageOk: this._storageOk, accounts: this.accounts });
        if (this._view) this._view.refresh();
    }

    faceReason() { return this.face; }
    projection() { return this.stats; }
    accountList() { return this.accounts.slice(); }
    recordList() { return this.records.slice(); }
    groups() { return ACCOUNT_GROUPS.map((g) => ({ name: g.name, icon: g.icon })); }
    typesOf(group) { return (ACCOUNT_TYPES[group] || ['其他']).slice(); }
    expenseCategories() { return EXPENSE_CATEGORIES.slice(); }
    incomeCategories() { return INCOME_CATEGORIES.slice(); }
    money(cents) { return formatMoney(cents); }

    /* ---------- 账户 ---------- */

    addAccount(name, group, type, balanceYuan) {
        const parsed = (balanceYuan === '' || balanceYuan === null || balanceYuan === undefined)
            ? 0
            : yuanToCents(balanceYuan);
        const acc = normalizeAccount({ name, group, type, balance: Number.isFinite(parsed) ? parsed : 0, createdAt: Date.now() });
        if (!acc) return null;
        this.accounts.push(acc);
        this._saveAccounts();
        this.refresh();
        return acc;
    }

    removeAccount(id) {
        const before = this.accounts.length;
        this.accounts = this.accounts.filter((a) => a.id !== id);
        if (this.accounts.length === before) return;
        // 该账户名下的流水一并撤掉（否则会留下指向不存在账户的孤儿记录，投影仍在算它）。
        const rb = this.records.length;
        this.records = this.records.filter((r) => r.accountId !== id);
        this._saveAccounts();
        if (this.records.length !== rb) this._saveRecords();
        this.refresh();
    }

    _saveAccounts() {
        try { if (this.storage) this.storage.set(ACCOUNTS_KEY, this.accounts); } catch (_e) { /* silent */ }
    }

    /* ---------- 流水 ---------- */

    /**
     * 记一笔。**同时改账户余额**：源里余额与流水是两处独立数据、靠人工对齐，
     * 本仓把「记一笔」做成一个原子动作（余额跟着动），否则两份数会越走越远。
     */
    addRecord(kind, amountYuan, category, accountId, note) {
        const cents = yuanToCents(amountYuan);
        const rec = normalizeRecord({ kind, amount: Number.isFinite(cents) ? cents : 0, category, accountId, note, at: Date.now() });
        if (!rec) return null;
        this.records.push(rec);
        this.records = this.records.slice(-this.settings.keepRecords);
        const idx = this.accounts.findIndex((a) => a.id === rec.accountId);
        if (idx >= 0) {
            const acc = this.accounts[idx];
            const delta = (rec.kind === 'income') ? rec.amount : -rec.amount;
            /* 账户是冻结对象：改余额只能换一份新的（就地改会被静默忽略）。 */
            this.accounts[idx] = normalizeAccount({ ...acc, balance: acc.balance + delta });
            this._saveAccounts();
        }
        this._saveRecords();
        this.refresh();
        return rec;
    }

    removeRecord(id) {
        const rec = this.records.find((r) => r.id === id);
        if (!rec) return;
        // 删一笔要把余额退回去（与 addRecord 对称，否则余额会单向漂移）。
        const idx = this.accounts.findIndex((a) => a.id === rec.accountId);
        if (idx >= 0) {
            const acc = this.accounts[idx];
            const delta = (rec.kind === 'income') ? -rec.amount : rec.amount;
            this.accounts[idx] = normalizeAccount({ ...acc, balance: acc.balance + delta });
            this._saveAccounts();
        }
        this.records = this.records.filter((r) => r.id !== id);
        this._saveRecords();
        this.refresh();
    }

    _saveRecords() {
        try { if (this.storage) this.storage.set(RECORDS_KEY, this.records); } catch (_e) { /* silent */ }
    }

    /* ---------- 注入 ---------- */

    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        return accountingPromptBlock(this.stats, this.settings);
    }

    /**
     * 账本自检——把纯函数内核的可执行自证结果摆出来。
     * 为什么要有：账本算错了（取整口径 / 三态计入）时，界面不报错、不崩，
     *   只是**算出一个错的数**—— 用户自己无法分辨。自检卡把“算式本身链没坏”
     *   变成一个可核对的读数。
     */
    selfCheck() {
        try { return selfTest(); } catch (_e) { return null; }
    }

    summaryLine() {
        if (!this.stats || !this.stats.hasAccounts) return '还没有账户';
        return '本月结余 ' + formatMoney(this.stats.monthBalance) + ' · 资产 ' + formatMoney(this.stats.assets);
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const st = this._win().SillyTavern;
            const ctx = (st && st.getContext) ? st.getContext() : null;
            const es = ctx ? ctx.eventSource : null;
            const et = ctx ? ctx.event_types : null;
            if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const blk = this.promptBlock();
                    if (blk) payload.prompt.push({ role: 'system', content: blk });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hookBound = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    onChatChanged() {
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new AccountingView(this, this.shell, this.storage);
        }
        this._view.render();
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizeAccountingSettings(obj);
        } catch (_e) { this.settings = { ...defaultAccountingSettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }
}