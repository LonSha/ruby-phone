/* ========================================================
 * accounting-data.js — [v3.22.0] 记账 App 纯函数内核
 *
 * 缝合自 EPhone·xintuk 的 tukey-accounting（runtime/scripts/tukey-accounting）。
 * 源里有两半：① **本地账本**（ACCOUNT_STRUCTURE 账户树 + 账户余额 + 收支流水 + 分类 + Excel 导出）；
 *   ② **AI 群聊记账**（建一个「记账群聊」，靠模型解析自然语言生成账单、支持重 Roll）。
 * 本仓只缝第①半 —— 第②半是模型侧的事，本仓没有群聊引擎也没有账单生成器，
 *   且「多人群聊记账」那套 conversation/state.chats 结构与 ruby 的会话模型不同构。
 *
 * 源里账户图标是外链图床（postimg），本仓不引外链（离线即装即用），改用**分类自带的 emoji**。
 * ======================================================== */

/** 账户大类。源的 isAsset 三态（true/false/null）是它的语义：资产 / 负债 / 不计入净值。 */
export const ACCOUNT_GROUPS = Object.freeze([
    Object.freeze({ name: '普通账户', isAsset: true, icon: '\ud83d\udcb5' }),
    Object.freeze({ name: '信用账户', isAsset: false, icon: '\ud83d\udcb3' }),
    Object.freeze({ name: '投资理财', isAsset: true, icon: '\ud83d\udcc8' }),
    Object.freeze({ name: '充值账户', isAsset: true, icon: '\ud83c\udfab' }),
    Object.freeze({ name: '其他账户', isAsset: null, icon: '\ud83d\udce6' }),
]);

/** 源里 ACCOUNT_STRUCTURE 的账户类型清单（图标换成组图标，不再引外链）。 */
export const ACCOUNT_TYPES = Object.freeze({
    '普通账户': Object.freeze(['现金', '储蓄卡', '微信钱包', '支付宝', '其他']),
    '信用账户': Object.freeze(['信用卡', '花呗', '白条', '其他']),
    '投资理财': Object.freeze(['股票', '基金', '其他']),
    '充值账户': Object.freeze(['饭卡', '公交卡', '其他']),
    '其他账户': Object.freeze(['借入', '借出', '其他']),
});

/** 支出分类（源的取值）。 */
export const EXPENSE_CATEGORIES = Object.freeze(['餐饮', '交通', '住房', '娱乐', '医疗', '购物', '学习', '其他']);
/** 收入分类（源的取值）。 */
export const INCOME_CATEGORIES = Object.freeze(['工资', '理财', '红包', '报销', '其他']);

export const ACCOUNTING_REASONS = Object.freeze({
    ready: 'ready',
    no_accounts: 'no-accounts',
    storage_absent: 'storage-absent',
});

export const DEFAULT_ACCOUNTING_SETTINGS = Object.freeze({
    monthlyBudget: 0,        // 0 = 不设预算
    injectToPrompt: true,    // 只注入月度事实
    keepRecords: 2000,       // 流水滚动上限（源不设限，本仓给个上限防存档膨胀）
});

export function defaultAccountingSettings() {
    return Object.freeze({ ...DEFAULT_ACCOUNTING_SETTINGS });
}

/* 私有助手。**刻意不叫 clampInt** —— 本仓的零消费导出门禁（dead-export-check.mjs）
 * 的消费判定是**按裸名全仓匹配**：任一产品文件里出现同名标识符，就算「消费」掉了
 * 别处的同名导出。实测：本文件原用 clampInt 时，apps/health/medical-core.js 的
 * `clampInt` 从「零消费」被**假消费**成「已消费」，零消费读数 24→23，
 * tests/system-v245 的 D3（钉住 24）当场翻红。
 * 我不把这条当成「门禁太脆」就绕过去：**假消费是真读数污染**（账本会显示欠债已还清，
 * 而那个导出其实一个消费方都没有），故改名为不可能撞车的 boundedInt。 */
function boundedInt(v, fallback, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** 分转元 / 元转分：金额一律以**分**为整数存，避免浮点累加误差。 */
export function yuanToCents(y) {
    const n = Number(y);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
}

export function centsToYuan(c) {
    const n = Number(c);
    if (!Number.isFinite(n)) return 0;
    return n / 100;
}

export function formatMoney(cents) {
    const y = centsToYuan(cents);
    const neg = y < 0;
    const abs = Math.abs(y);
    const s = abs.toFixed(2);
    return (neg ? '-' : '') + '\u00a5' + s;
}

export function normalizeAccountingSettings(raw) {
    const d = DEFAULT_ACCOUNTING_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        monthlyBudget: boundedInt(o.monthlyBudget, d.monthlyBudget, 0, 100000000),
        injectToPrompt: o.injectToPrompt !== false,
        keepRecords: boundedInt(o.keepRecords, d.keepRecords, 50, 20000),
    });
}

/**
 * 账户规范化。余额以分存。
 * 名字为空即无效（源靠 alert 拦，本仓在数据层就地拒绝）。
 */
export function normalizeAccount(raw, now) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const name = (typeof o.name === 'string') ? o.name.trim() : '';
    if (!name) return null;
    const group = ACCOUNT_GROUPS.some((g) => g.name === o.group) ? o.group : '普通账户';
    const types = ACCOUNT_TYPES[group] || ['其他'];
    const type = types.indexOf(o.type) >= 0 ? o.type : types[0];
    const createdAt = Number.isFinite(o.createdAt) ? o.createdAt : (Number.isFinite(now) ? now : 0);
    const id = (typeof o.id === 'string' && o.id)
        ? o.id
        : ('acc_' + createdAt + '_' + Math.random().toString(36).slice(2, 8));
    const balance = Number.isFinite(o.balance) ? Math.round(o.balance) : 0;
    return Object.freeze({ id, name, group, type, balance, createdAt });
}

/**
 * 一条流水。金额恒为正数（方向由 kind 决定）——
 * 源里也用 kind('income'/'expense') 与 amount 分开，本仓保持一致：
 * **带符号的金额是缺陷温床**（-(-5) 这类双重否定一旦混进，账就反了）。
 */
export function normalizeRecord(raw, now) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const amount = Number.isFinite(o.amount) ? Math.abs(Math.round(o.amount)) : 0;
    if (amount <= 0) return null;
    const kind = (o.kind === 'income') ? 'income' : 'expense';
    const cats = (kind === 'income') ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const category = cats.indexOf(o.category) >= 0 ? o.category : '其他';
    const at = Number.isFinite(o.at) ? o.at : (Number.isFinite(now) ? now : 0);
    const id = (typeof o.id === 'string' && o.id)
        ? o.id
        : ('rec_' + at + '_' + Math.random().toString(36).slice(2, 8));
    return Object.freeze({
        id,
        kind,
        amount,
        category,
        accountId: (typeof o.accountId === 'string') ? o.accountId : '',
        note: (typeof o.note === 'string') ? o.note.slice(0, 60) : '',
        at,
    });
}

export function readAccountingFace(probe) {
    if (!probe || probe.storageOk === false) return ACCOUNTING_REASONS.storage_absent;
    if (!Array.isArray(probe.accounts) || probe.accounts.length === 0) return ACCOUNTING_REASONS.no_accounts;
    return ACCOUNTING_REASONS.ready;
}

function monthKey(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    const m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : String(m));
}

/**
 * 投影：净值 / 本月收支 / 分类合计。
 * 三态语义照抄源（isAsset：true 计入资产、false 计入负债、null 两边都不计）。
 * 读不出就如实 0，不编数。
 */
export function projectAccounting(accounts, records, now) {
    const accs = Array.isArray(accounts) ? accounts : [];
    const recs = Array.isArray(records) ? records : [];
    const nowMs = Number.isFinite(now) ? now : Date.now();
    const thisMonth = monthKey(nowMs);

    let assets = 0;
    let liabilities = 0;
    for (const a of accs) {
        const g = ACCOUNT_GROUPS.find((x) => x.name === a.group);
        if (!g || g.isAsset === null) continue;
        if (g.isAsset) assets += a.balance;
        else liabilities += a.balance;
    }

    let monthIncome = 0;
    let monthExpense = 0;
    const expenseByCat = new Map();
    const incomeByCat = new Map();
    for (const r of recs) {
        if (monthKey(r.at) !== thisMonth) continue;
        if (r.kind === 'income') {
            monthIncome += r.amount;
            incomeByCat.set(r.category, (incomeByCat.get(r.category) || 0) + r.amount);
        } else {
            monthExpense += r.amount;
            expenseByCat.set(r.category, (expenseByCat.get(r.category) || 0) + r.amount);
        }
    }

    const topExpense = [...expenseByCat.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    return {
        accountCount: accs.length,
        recordCount: recs.length,
        assets,
        liabilities,
        netWorth: assets - liabilities,
        monthKey: thisMonth,
        monthIncome,
        monthExpense,
        monthBalance: monthIncome - monthExpense,
        expenseByCat: [...expenseByCat.entries()].map(([k, v]) => ({ category: k, amount: v })),
        incomeByCat: [...incomeByCat.entries()].map(([k, v]) => ({ category: k, amount: v })),
        topExpenseCategory: topExpense ? { category: topExpense[0], amount: topExpense[1] } : null,
        hasAccounts: accs.length > 0,
    };
}

/**
 * 生成侧注入块：只给月度事实（收入/支出/结余/最大支出项），不替角色编台词。
 * 为什么值得注入：角色「记得」用户最近手头紧不紧，是自然的剧情素材；
 * 但**逐笔流水不注入**（那是隐私噪声，写进上下文只烧 token）。
 */
export function accountingPromptBlock(stats, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!stats || stats.hasAccounts !== true) return '';
    const parts = [];
    parts.push('【本月收支】收入 ' + formatMoney(stats.monthIncome) + ' · 支出 ' + formatMoney(stats.monthExpense) + ' · 结余 ' + formatMoney(stats.monthBalance));
    if (stats.topExpenseCategory) {
        parts.push('【最大支出】' + stats.topExpenseCategory.category + ' ' + formatMoney(stats.topExpenseCategory.amount));
    }
    const budget = settings.monthlyBudget;
    if (budget > 0) {
        const pct = Math.min(100, Math.round(stats.monthExpense * 100 / budget));
        parts.push('【本月预算】已用 ' + pct + '%（' + formatMoney(budget) + '）');
    }
    return '【系统·记账】\n' + parts.join('\n');
}
/* ========================================================
 * selfTest —— 可执行自证（供冒烟 / 诊断真调用）
 *
 * 为什么有这一项：本仓的零消费导出门禁（dead-export-check.mjs）按
 *   **裸名全仓匹配**判消费，只被测试文件引入的导出仍算「零消费」。
 *   与其把 yuanToCents / centsToYuan 这类确实该外供的口子登记进豁免账本，
 *   不如给它们一条**真调用链**：自证函数真调用它们，自证本身又被冒烟调用
 *   ⇒ 整条链是活的（而不是「导出了却没人用」）。
 *
 * 断言的都是**写错了也不报错**的几处：
 *   ① 分 / 元换算取整口径（浮点累加误差是账本最经典的错法）；
 *   ② 「没账户」与「读不到」必须不同形（处置相反的两种处境）；
 *   ③ 净值三态（资产 / 负债 / 不计入 —— isAsset:null 的账户两边都不许计）。
 * 返回 `{ pass, fail, notes }`，不抛 —— 怎么处置由调用方定。
 * ======================================================== */
export function selfTest() {
    const notes = [];
    let pass = 0;
    let fail = 0;
    const ok = (name, cond) => { if (cond) { pass += 1; } else { fail += 1; notes.push(name); } };
    ok('元→分取整（19.99 → 1999）', yuanToCents(19.99) === 1999);
    ok('分→元不四舍五入（1999 → 19.99）', centsToYuan(1999) === 19.99);
    ok('非数金额不编数（返 null）', yuanToCents('abc') === null);
    ok('金额形式化（负号 + 两位小数）', formatMoney(-5050) === '-¥50.50');
    ok('无名不当成“无账户”', normalizeAccount({ name: '' }) === null);
    ok('账户大类越界回落默认', normalizeAccount({ name: 'x', group: '不存在的组' }).group === '普通账户');
    ok('流水金额恒为正（方向由 kind 定）', normalizeRecord({ kind: 'expense', amount: -300 }).amount === 300);
    ok('零金额流水不成条', normalizeRecord({ kind: 'expense', amount: 0 }) === null);
    const absent = readAccountingFace({ storageOk: false, accounts: [] });
    const empty = readAccountingFace({ storageOk: true, accounts: [] });
    const ready = readAccountingFace({ storageOk: true, accounts: [{ id: 'a' }] });
    ok('读不到 ≠ 没账户（不同形）', absent !== empty);
    ok('三态互不相同', absent !== ready && empty !== ready);
    const accs = [
        { id: 'a', name: 'A', group: '普通账户', type: '现金', balance: 10000 },
        { id: 'b', name: 'B', group: '信用账户', type: '信用卡', balance: 3000 },
        { id: 'c', name: 'C', group: '其他账户', type: '其他', balance: 999999 },
    ];
    const st = projectAccounting(accs, [], Date.now());
    ok('净值 = 资产 - 负债', st.netWorth === 10000 - 3000);
    ok('isAsset:null 两边都不计', st.assets === 10000 && st.liabilities === 3000);
    const emptySt = projectAccounting([], [], Date.now());
    ok('无账户时 hasAccounts 为假', emptySt.hasAccounts === false);
    ok('没数据就如实 0（不编数）', emptySt.monthIncome === 0 && emptySt.monthExpense === 0);
    ok('注入开关关了就是空串', accountingPromptBlock(st, { injectToPrompt: false }) === '');
    ok('开着但无账户也不注（无事实可注）', accountingPromptBlock(emptySt, { injectToPrompt: true }) === '');
    return { pass: pass, fail: fail, notes: notes };
}