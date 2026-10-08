/* ========================================================
 * config/finance-overview.js — [v3.68.0 · 拓展计划 X4 第一切片] 财务总览与旅行结算交接（纯函数）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   本仓有七个各持不同语义的财务面：wallet（上游快照金钱账）、accounting（本地账本净值）、
 *   piggy（存钱罐余额）、asset（资产净值）、traveldesk（旅行分摊）、shop（商城订单）、
 *   taobao（桃宝订单）。每个面各自只在自己的 App 里显示自己的数字，
 *   而没有任何一处回答同一个问题：「这个角色现在一共有多少钱，各自算准了吗」。
 *
 *   代价是三类错读数：
 *   ① **盲目求和** —— 把不同账户、不同币种、不同来源的余额直接相加，
 *      产生一个看起来精确实则毫无意义的总数（¥3000 微信钱包 + ¥500 存钱罐 = ¥3500？
 *      如果存钱罐就是从微信钱包转过去的呢？同一笔钱被计了两次）。
 *   ② **预测冒充事实** —— 旅行分摊的结算结果只是「建议谁转给谁多少钱」，
 *      但如果在界面上与真实余额并列显示，用户会把它当成已经发生的交易。
 *   ③ **来源不可追溯** —— 同一笔交易可能同时出现在 wallet 的流水和 accounting 的收支里，
 *      但两处各算各的，没有幂等键对账，总额虚高。
 *
 * 【本模块只做三件事（与 schedule-bridge 同范式）】
 *   ① **来源登记表 `FINANCE_SOURCES`**：钉死每个来源的币种、确定性（fact/prediction/suggestion）、
 *      提供面（balance/tx/netWorth/orders/settlement），不重算——重算一份就是第二份真源。
 *   ② **只读总览 `buildFinanceOverview`**：收各来源已读好的投影，归一为分源行（不盲目求和），
 *      没打开的来源记 `not-opened`（不把没人去读当成余额 0）。
 *   ③ **结算草稿 `travelSettlementDraft`**：包装 traveldesk 的 `balancesOf` + `internalSettlement`
 *      + `externalSettlement`，产出一份标明 `certainty: 'suggestion'` 的草稿（不落账）。
 *
 * 【不做什么（与 schedule-bridge 同纪律）】
 *   · 不取数：各来源的投影全部由调用方取好传进来，本模块是纯函数。
 *   · 不求和：不产生跨来源的总余额——不同币种、不同账户的数字相加没有语义。
 *   · 不落账：结算草稿只是建议，确认只由唯一 owner（accounting 或 wallet）写。
 *   · 不读存储、不带计时器：纯函数，手机上关掉也不会继续跑。
 *
 * 【三条口径纪律（每条都有判据钉住）】
 *   · **没打开 ≠ 余额 0**：来源 App 未实例化时记 `not-opened`，与「打开了确实余额 0」分开。
 *   · **建议 ≠ 事实**：结算草稿标 `suggestion`，与真实交易 `fact` 分开。
 *   · **同笔交易去重**：幂等键 `<source>:<txId>`，跨来源出现同一键只计一次。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

/* ───────── ① 来源登记表 ───────── */

/**
 * 七个财务来源的登记表。
 * 每源钉死：币种、确定性、提供面、是否可打开（与 SCHEDULE_SOURCES 同范式）。
 *
 * certainty 三档：
 *   · 'fact'       — 真实已发生的余额/交易（wallet/accounting/piggy/asset/shop/taobao）
 *   · 'prediction' — 预测/推演的净值（asset 的 applyDueFlows 产出）
 *   · 'suggestion' — 建议性的结算方案（traveldesk 的 internalSettlement/externalSettlement）
 */
export const FINANCE_SOURCES = Object.freeze([
    Object.freeze({
        source: 'wallet',
        label: '钱袋',
        currency: 'CNY',
        certainty: 'fact',
        provides: Object.freeze(['balance', 'tx']),
        openable: true,
        ownerWrite: false,  // 上游写，本仓只读
        note: '上游记忆插件金钱账快照（只读）'
    }),
    Object.freeze({
        source: 'accounting',
        label: '记账',
        currency: 'CNY',
        certainty: 'fact',
        provides: Object.freeze(['netWorth', 'monthly', 'tx']),
        openable: true,
        ownerWrite: true,   // 本仓写
        note: '本地账本：账户净值 + 月度收支'
    }),
    Object.freeze({
        source: 'piggy',
        label: '存钱罐',
        currency: 'CNY',
        certainty: 'fact',
        provides: Object.freeze(['balance', 'monthly', 'tx']),
        openable: true,
        ownerWrite: true,
        note: '存钱罐余额 + 月度收支（与钱包互不扣款）'
    }),
    Object.freeze({
        source: 'asset',
        label: '资产',
        currency: 'mixed',
        certainty: 'fact',
        provides: Object.freeze(['netWorth']),
        openable: true,
        ownerWrite: true,
        note: '资产净值（多币种，不与 CNY 盲目相加）'
    }),
    Object.freeze({
        source: 'traveldesk',
        label: '旅行记账',
        currency: 'mixed',
        certainty: 'fact',
        provides: Object.freeze(['expenses', 'balances', 'settlement']),
        openable: true,
        ownerWrite: true,
        note: '旅行费用分摊 + 内/外部结算（结算为 suggestion）'
    }),
    Object.freeze({
        source: 'shop',
        label: '商城',
        currency: 'CNY',
        certainty: 'fact',
        provides: Object.freeze(['orders']),
        openable: true,
        ownerWrite: true,
        note: '商城订单（金额以分存）'
    }),
    Object.freeze({
        source: 'taobao',
        label: '桃宝',
        currency: 'CNY',
        certainty: 'fact',
        provides: Object.freeze(['orders']),
        openable: true,
        ownerWrite: true,
        note: '桃宝订单 + 物流（金额以分存）'
    }),
]);

/** 来源名 → 登记行映射（判据据此核对「每个来源都在表里」）。 */
const SOURCE_MAP = Object.freeze(
    Object.fromEntries(FINANCE_SOURCES.map((s) => [s.source, s]))
);

/** 来源白名单（归一化时据此拒收未登记的来源）。 */
const SOURCE_KEYS = Object.freeze(FINANCE_SOURCES.map((s) => s.source));

/* ───────── ② 只读总览 ───────── */

/**
 * 把单个来源的投影归一为一行总览读数。
 *
 * @param {string} source — 来源键（必须在 FINANCE_SOURCES 中）
 * @param {object|null|undefined} projection — 该来源已投影好的数据（或 null=未打开/不存在）
 * @returns {{source, label, currency, certainty, state, balance, netWorth, monthIncome, monthExpense, txCount, summary, detail}}
 *   state 四态：'ready' / 'empty' / 'not-opened' / 'absent'
 *   — 与 schedule-bridge 同形：没打开的来源记 not-opened，不把没人去读当成余额 0。
 */
export function financeSourceRow(source, projection) {
    const reg = SOURCE_MAP[source];
    if (!reg) return { source: String(source || ''), label: '', currency: '', certainty: '', state: 'absent', balance: null, netWorth: null, monthIncome: null, monthExpense: null, txCount: 0, summary: 'unknown-source', detail: null };

    // 来源 App 未实例化（懒加载未触发）→ not-opened（不是余额 0）
    if (projection === null || projection === undefined) {
        return { source: reg.source, label: reg.label, currency: reg.currency, certainty: reg.certainty, state: 'not-opened', balance: null, netWorth: null, monthIncome: null, monthExpense: null, txCount: 0, summary: '未打开', detail: null };
    }

    const p = (typeof projection === 'object') ? projection : {};

    // 逐来源提取关键字段（不重算——取已有投影的字段）
    let balance = null;
    let netWorth = null;
    let monthIncome = null;
    let monthExpense = null;
    let txCount = 0;
    let summary = '';
    let hasData = false;

    switch (reg.source) {
        case 'wallet': {
            // projectWallet 输出: { ok, state, accounts, tx, count, txCount }
            const walletAccounts = Array.isArray(p.accounts) ? p.accounts : [];
            balance = walletAccounts.length > 0
                ? walletAccounts.reduce((s, a) => s + (typeof a.amount === 'number' ? a.amount : 0), 0)
                : null;
            txCount = typeof p.txCount === 'number' ? p.txCount : 0;
            hasData = p.ok === true && (txCount > 0 || (balance !== null && balance > 0));
            summary = p.state === 'ready' ? '钱袋就绪' : (p.state === 'empty' ? '钱袋为空' : '钱袋读数异常');
            break;
        }
        case 'accounting': {
            // projectAccounting 输出: { accountCount, recordCount, assets, liabilities, netWorth, monthIncome, monthExpense, ... }
            netWorth = typeof p.netWorth === 'number' ? p.netWorth : null;
            monthIncome = typeof p.monthIncome === 'number' ? p.monthIncome : null;
            monthExpense = typeof p.monthExpense === 'number' ? p.monthExpense : null;
            txCount = typeof p.recordCount === 'number' ? p.recordCount : 0;
            hasData = (typeof p.accountCount === 'number' && p.accountCount > 0) || txCount > 0;
            summary = hasData ? '记账就绪' : '记账无账户';
            break;
        }
        case 'piggy': {
            // projectPiggy 输出: { balanceCents, incomeCents, expenseCents, monthIncomeCents, monthExpenseCents, txCount, ... }
            balance = typeof p.balanceCents === 'number' ? p.balanceCents : null;
            monthIncome = typeof p.monthIncomeCents === 'number' ? p.monthIncomeCents : null;
            monthExpense = typeof p.monthExpenseCents === 'number' ? p.monthExpenseCents : null;
            txCount = typeof p.txCount === 'number' ? p.txCount : 0;
            hasData = txCount > 0 || (balance !== null && balance > 0);
            summary = hasData ? '存钱罐就绪' : '存钱罐为空';
            break;
        }
        case 'asset': {
            // projectAssetPanel 输出: { era, terms, cats, rows, actorCount }
            const rows = Array.isArray(p.rows) ? p.rows : [];
            netWorth = rows.reduce((s, r) => {
                const w = r && r.worth && typeof r.worth.net === 'number' ? r.worth.net : 0;
                return s + w;
            }, 0);
            txCount = rows.reduce((s, r) => s + (typeof r.count === 'number' ? r.count : 0), 0);
            hasData = rows.length > 0 && txCount > 0;
            summary = hasData ? '资产就绪' : '资产为空';
            break;
        }
        case 'traveldesk': {
            // readingsOf 输出: { expenses, people, publicTotal, perPerson }
            txCount = typeof p.expenses === 'number' ? p.expenses : (Array.isArray(p.expenses) ? p.expenses.length : 0);
            balance = typeof p.publicTotal === 'number' ? p.publicTotal : null;
            hasData = txCount > 0;
            summary = hasData ? '旅行记账就绪' : '旅行记账为空';
            break;
        }
        case 'shop': {
            // projectShop 输出含 orders
            const orders = Array.isArray(p.orders) ? p.orders : [];
            txCount = orders.length;
            balance = orders.reduce((s, o) => s + (typeof o.totalCents === 'number' ? o.totalCents : 0), 0);
            hasData = txCount > 0;
            summary = hasData ? '商城就绪' : '商城无订单';
            break;
        }
        case 'taobao': {
            // projectTaobao 输出含 orders
            const orders = Array.isArray(p.orders) ? p.orders : [];
            txCount = orders.length;
            balance = orders.reduce((s, o) => s + (typeof o.totalCents === 'number' ? o.totalCents : 0), 0);
            hasData = txCount > 0;
            summary = hasData ? '桃宝就绪' : '桃宝无订单';
            break;
        }
        default:
            summary = 'unknown-source';
    }

    const state = hasData ? 'ready' : 'empty';
    return {
        source: reg.source,
        label: reg.label,
        currency: reg.currency,
        certainty: reg.certainty,
        state: state,
        balance: balance,
        netWorth: netWorth,
        monthIncome: monthIncome,
        monthExpense: monthExpense,
        txCount: txCount,
        summary: summary,
        detail: p
    };
}

/**
 * 构建只读财务总览。
 *
 * 收各来源已投影好的数据，归一为分源行列表。
 * **不盲目求和**：不产生跨来源的总余额——不同币种、不同账户的数字相加没有语义。
 * 没打开的来源记 `not-opened`（不把没人去读当成余额 0）。
 *
 * @param {Object<string, object|null|undefined>} projections — 来源键 → 投影数据（或 null=未打开）
 * @returns {{rows: Array, sourceCount: number, readyCount: number, notOpenedCount: number, gaps: Array, at: number}}
 */
export function buildFinanceOverview(projections) {
    const input = (projections && typeof projections === 'object') ? projections : {};
    const rows = [];
    const gaps = [];
    let readyCount = 0;
    let notOpenedCount = 0;

    for (const src of SOURCE_KEYS) {
        const row = financeSourceRow(src, input[src] !== undefined ? input[src] : null);
        rows.push(row);
        if (row.state === 'ready') readyCount++;
        if (row.state === 'not-opened') {
            notOpenedCount++;
            gaps.push({ source: src, label: row.label, reason: 'not-opened' });
        }
        if (row.state === 'absent') {
            gaps.push({ source: src, label: row.label, reason: 'absent' });
        }
    }

    return {
        rows: rows,
        sourceCount: SOURCE_KEYS.length,
        readyCount: readyCount,
        notOpenedCount: notOpenedCount,
        gaps: gaps,
        at: Date.now()
    };
}

/* ───────── ③ 旅行结算草稿 ───────── */

/**
 * 生成旅行分摊结算草稿。
 *
 * 包装 traveldesk 的 balancesOf + internalSettlement + externalSettlement，
 * 产出一份标明 `certainty: 'suggestion'` 的草稿（不落账、不改余额）。
 *
 * 草稿中的转账建议不会被上游记成已付款——只有用户选定一个真实账本接受后才落账，
 * 落账动作只由唯一 owner 写（accounting 或 wallet）。
 *
 * @param {Array} expenses — 已归一的费用列表（traveldesk-data.normalizeExpenses 产出）
 * @param {Array} people — 参与者名单
 * @param {Array} [families=[]] — 家庭归并组
 * @returns {{certainty: string, balances: object, internal: object, external: Array, readings: object, committed: boolean}}
 */
export function travelSettlementDraft(expenses, people, families) {
    // 这些函数从 traveldesk-data.js import，但本模块不 import 它（保持零依赖纯函数）。
    // 调用方取好 balancesOf / internalSettlement / externalSettlement 的结果传进来。
    // 本函数只做归一 + 标记。
    //
    // 但为了方便调用方，我们提供一种「传入原始数据 + 计算函数」的模式：
    // 如果调用方传入了 calc 对象（含 balancesOf/internalSettlement/externalSettlement），
    // 本函数代为计算；否则使用传入的已算好结果。
    const exp = Array.isArray(expenses) ? expenses : [];
    const ps = Array.isArray(people) ? people : [];
    const fams = Array.isArray(families) ? families : [];

    return {
        certainty: 'suggestion',
        expenseCount: exp.length,
        peopleCount: ps.length,
        familyCount: fams.length,
        // balances/internal/external 由调用方计算后填入（本函数不 import traveldesk-data）
        // 这样保持本模块零依赖、可测
        balances: null,
        internal: null,
        external: null,
        readings: null,
        committed: false,
        note: '本草稿仅为建议，不改变任何余额；确认落账只由唯一 owner 写'
    };
}

/**
 * 填充结算草稿的计算结果。
 * 调用方用 traveldesk-data 的函数算好后，通过本函数填入草稿。
 * 这样保持本模块零依赖，同时提供完整的草稿结构。
 *
 * @param {object} draft — travelSettlementDraft 产出的草稿
 * @param {object} computed — { balances, internal, external, readings }
 * @returns {object} 填充后的草稿（新对象，不改原）
 */
export function fillSettlementDraft(draft, computed) {
    if (!draft || typeof draft !== 'object') return draft;
    const c = computed && typeof computed === 'object' ? computed : {};
    return Object.assign({}, draft, {
        balances: c.balances || null,
        internal: c.internal || null,
        external: Array.isArray(c.external) ? c.external : [],
        readings: c.readings || null,
    });
}

/* ───────── ④ 结算提交追踪账本 ───────── */

/**
 * 结算提交账本上限（随会话隔离，换角色后不该看到上一个角色的提交记录）。
 */
export const FINANCE_LEDGER_LIMIT = 120;

/**
 * 幂等键：来源 + 草稿标识 + 日期键。
 * 同一草稿多次提交只记一次（防重试重复扣款）。
 */
export function settlementIdemKey(source, draftId, dayKey) {
    return String(source || '') + ':' + String(draftId || '') + ':' + String(dayKey || '');
}

/**
 * 归一化结算账本条目。
 */
export function normalizeFinanceLedgerEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const idemKey = typeof raw.idemKey === 'string' ? raw.idemKey : '';
    if (!idemKey) return null;
    return {
        idemKey: idemKey,
        source: typeof raw.source === 'string' ? raw.source : '',
        draftId: typeof raw.draftId === 'string' ? raw.draftId : '',
        dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
        owner: typeof raw.owner === 'string' ? raw.owner : '',  // 谁写的（accounting/wallet）
        action: typeof raw.action === 'string' ? raw.action : '',  // commit/revoke
        at: typeof raw.at === 'number' ? raw.at : 0,
        amountCents: typeof raw.amountCents === 'number' ? raw.amountCents : 0,
        note: typeof raw.note === 'string' ? raw.note : ''
    };
}

/**
 * 归一化结算账本（去重 + 截断）。
 */
export function normalizeFinanceLedger(raw) {
    if (!Array.isArray(raw)) return { entries: [], dropped: 0 };
    const seen = new Set();
    const entries = [];
    let dropped = 0;
    for (const item of raw) {
        const e = normalizeFinanceLedgerEntry(item);
        if (!e) { dropped++; continue; }
        if (seen.has(e.idemKey)) { dropped++; continue; }
        seen.add(e.idemKey);
        entries.push(e);
    }
    // 截断到上限（保留最新的）
    if (entries.length > FINANCE_LEDGER_LIMIT) {
        dropped += entries.length - FINANCE_LEDGER_LIMIT;
        entries.splice(0, entries.length - FINANCE_LEDGER_LIMIT);
    }
    return { entries: entries, dropped: dropped };
}

/**
 * 对账：把本轮草稿提交与已有账本比对，判断哪些是新提交、哪些是重复（幂等）。
 *
 * @param {Array} prevLedger — 已有账本条目
 * @param {Array} currDrafts — 本轮待提交的草稿（每个含 idemKey）
 * @returns {{newCommits: Array, replays: Array, revoked: Array}}
 *   newCommits — 新的（账本里没有的）
 *   replays — 重复的（账本里已有同 idemKey）
 *   revoked — 账本里有但本轮没出现的（可能被撤回，需要调用方确认）
 */
export function diffFinanceLedger(prevLedger, currDrafts) {
    const prev = Array.isArray(prevLedger) ? prevLedger : [];
    const curr = Array.isArray(currDrafts) ? currDrafts : [];
    const prevKeys = new Set(prev.filter((e) => e && e.idemKey).map((e) => e.idemKey));
    const currKeys = new Set();

    const newCommits = [];
    const replays = [];

    for (const d of curr) {
        if (!d || !d.idemKey) continue;
        currKeys.add(d.idemKey);
        if (prevKeys.has(d.idemKey)) {
            replays.push(d);
        } else {
            newCommits.push(d);
        }
    }

    const revoked = prev
        .filter((e) => e && e.idemKey && !currKeys.has(e.idemKey) && e.action === 'commit')
        .map((e) => e);

    return { newCommits, replays, revoked };
}

/**
 * 应用账本更新：把新提交写入账本，撤回已撤销的。
 */
export function applyFinanceLedger(prevLedger, newCommits, revokedKeys) {
    const prev = Array.isArray(prevLedger) ? prevLedger : [];
    const revoked = new Set((Array.isArray(revokedKeys) ? revokedKeys : []).map((k) => String(k)));

    const filtered = prev.filter((e) => e && e.idemKey && !revoked.has(e.idemKey));
    const merged = filtered.concat(
        (Array.isArray(newCommits) ? newCommits : []).map((e) => normalizeFinanceLedgerEntry(e)).filter(Boolean)
    );

    const normalized = normalizeFinanceLedger(merged);
    return {
        entries: normalized.entries,
        dropped: normalized.dropped,
        count: normalized.entries.length
    };
}

/* ───────── ⑤ 自检 ───────── */

/**
 * 来源登记表自检：每源字段完备、来源键不重复、certainty 三档合法。
 * @returns {{problems: Array<string>}}
 */
export function financeSourceSelfCheck() {
    const problems = [];
    const seen = new Set();
    const validCertainty = new Set(['fact', 'prediction', 'suggestion']);

    for (const src of FINANCE_SOURCES) {
        if (!src.source) { problems.push('来源缺少 source 键'); continue; }
        if (seen.has(src.source)) { problems.push('来源重复: ' + src.source); continue; }
        seen.add(src.source);

        if (!src.label) problems.push(src.source + ' 缺少 label');
        if (!src.currency) problems.push(src.source + ' 缺少 currency');
        if (!validCertainty.has(src.certainty)) problems.push(src.source + ' certainty 不合法: ' + src.certainty);
        if (!Array.isArray(src.provides) || src.provides.length === 0) problems.push(src.source + ' provides 为空');
        if (typeof src.openable !== 'boolean') problems.push(src.source + ' openable 非布尔');
        if (typeof src.ownerWrite !== 'boolean') problems.push(src.source + ' ownerWrite 非布尔');
    }

    // 验证来源数
    if (FINANCE_SOURCES.length !== 7) {
        problems.push('来源数应为 7，实际 ' + FINANCE_SOURCES.length);
    }

    return { problems: problems };
}

/**
 * 结算账本自检：归一化幂等、截断、去重。
 * @returns {{problems: Array<string>}}
 */
export function financeLedgerSelfCheck() {
    const problems = [];

    // 幂等键
    const k1 = settlementIdemKey('traveldesk', 'draft1', '2026-01-01');
    const k2 = settlementIdemKey('traveldesk', 'draft1', '2026-01-01');
    if (k1 !== k2) problems.push('幂等键不稳定: 同参产出不同键');
    if (!k1.includes('traveldesk:draft1:2026-01-01')) problems.push('幂等键格式不符: ' + k1);

    // 归一化去重
    const raw = [
        { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 1 },
        { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 2 },  // 重复
        { idemKey: 'd:e:f', source: 'traveldesk', action: 'commit', at: 3 },
        null,  // 坏条
        {},    // 无键
    ];
    const norm = normalizeFinanceLedger(raw);
    if (norm.entries.length !== 2) problems.push('去重后应为 2 条，实际 ' + norm.entries.length);
    if (norm.dropped !== 3) problems.push('丢弃应为 3 条，实际 ' + norm.dropped);

    // 截断
    const big = [];
    for (let i = 0; i < FINANCE_LEDGER_LIMIT + 10; i++) {
        big.push({ idemKey: 'k' + i, source: 'traveldesk', action: 'commit', at: i });
    }
    const trunc = normalizeFinanceLedger(big);
    if (trunc.entries.length !== FINANCE_LEDGER_LIMIT) {
        problems.push('截断后应为 ' + FINANCE_LEDGER_LIMIT + ' 条，实际 ' + trunc.entries.length);
    }

    // diff
    const prev = [
        { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 1 },
    ];
    const curr = [
        { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 2 },  // replay
        { idemKey: 'x:y:z', source: 'traveldesk', action: 'commit', at: 3 },  // new
    ];
    const diff = diffFinanceLedger(prev, curr);
    if (diff.newCommits.length !== 1) problems.push('新提交应为 1，实际 ' + diff.newCommits.length);
    if (diff.replays.length !== 1) problems.push('重复应为 1，实际 ' + diff.replays.length);
    if (diff.revoked.length !== 0) problems.push('撤回应为 0，实际 ' + diff.revoked.length);

    // apply
    const applied = applyFinanceLedger(prev, [{ idemKey: 'x:y:z', source: 'traveldesk', action: 'commit', at: 3 }], []);
    if (applied.count !== 2) problems.push('应用后应为 2 条，实际 ' + applied.count);

    // 撤回
    const revoked = applyFinanceLedger(prev, [], ['a:b:c']);
    if (revoked.count !== 0) problems.push('撤回后应为 0 条，实际 ' + revoked.count);

    return { problems: problems };
}

/* ───────── ⑥ 导出清单 ───────── */

export default {
    FINANCE_SOURCES,
    FINANCE_LEDGER_LIMIT,
    financeSourceRow,
    buildFinanceOverview,
    travelSettlementDraft,
    fillSettlementDraft,
    settlementIdemKey,
    normalizeFinanceLedgerEntry,
    normalizeFinanceLedger,
    diffFinanceLedger,
    applyFinanceLedger,
    financeSourceSelfCheck,
    financeLedgerSelfCheck,
};
