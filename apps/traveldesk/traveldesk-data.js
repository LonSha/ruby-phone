/* ========================================================
 * traveldesk-data.js — [v3.54.0] 旅行记账案头 · 纯函数内核
 *
 * 源是 Perigee OS 旅行记账（travel.js 564 行）的**分账清算一族**：
 * ① 汇率折算：外币 ÷ rateUnit × 汇率 = finalCNY（人民币原样 1.0）；
 * ② 三型费用：shared 均摊（按人头）/ split 指定分摊（按明细）/ 私人（payer 自负）；
 * ③ 余额计算：payer +支出，均摊 −人头份，指定分摊 −明细份，外部人份额转外部债务；
 * ④ 家庭账户归并：families 成员余额并入 rep 代理人统一结算；
 * ⑤ 贪心内部清算：债务人升序 × 债权人降序双指针配对，差额 <0.01 视为清零；
 * ⑥ 外部债务表：外部人 → payer 逐笔列。
 *
 * 立场差：源挂在 AppState.data.travelData 并满篇 DOM 渲染，本件零 DOM 零 confirm；
 * 会话键走 ^tv_ 前缀随会话隔离。
 * ======================================================== */
'use strict';
/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前自带的那份 `numOrNull` 只给 `number` 放行、其余一律 `Number(v)` ——
 *   金额与汇率面上的 0 是**合法读数**，与「没给」必须分得开。 */
import { numOrNull } from '../../config/num-gate.js';
export const TV_EXPENSES_MAX = 500;
export const TV_PEOPLE_MAX = 20;
export const TV_EPSILON = 0.01;
export const TV_CURRENCY_SYMBOLS = Object.freeze({ JPY: '¥', CNY: '¥', USD: '$', EUR: '€', KRW: '₩', THB: '฿', GBP: '£', SGD: '$', MYR: 'RM' });
export const TV_EXPENSE_TYPES = Object.freeze(['shared', 'split', 'private']);
export const TV_LEDGER_MAX = 120;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* 汇率折算（源 finalCNY 一致）：人民币 1.0；外币 ÷ rateUnit × rate，两位截断。 */
export function toCNY(amount, currency, rate, rateUnit) {
    const amt = numOrNull(amount);
    if (amt === null) return { finalCNY: null, recordedRate: null };
    if (currency === 'CNY') return { finalCNY: Math.round(amt * 100) / 100, recordedRate: 1.0 };
    const r = numOrNull(rate); const u = numOrNull(rateUnit) || 1;
    if (r === null || u <= 0) return { finalCNY: null, recordedRate: null };
    return { finalCNY: Math.round((amt / u) * r * 100) / 100, recordedRate: r };
}
/* 余额计算（源 updateSummary 逐支对齐）： payer 加支出；shared 减人头份；split 减明细份（成员在册）
 *   或减到 payer 头上并把债务记到外部人（成员不在册）；private 全额减 payer。 */
export function balancesOf(expenses, people) {
    const ps = listOf(people);
    const payerTotals = {}; const balances = {}; const externalDebts = {};
    for (const p of ps) { payerTotals[p] = 0; balances[p] = 0; }
    for (const exp of listOf(expenses)) {
        if (!isPlain(exp)) continue;
        const finalCNY = numOrNull(exp.finalCNY) || 0;
        if (payerTotals.hasOwnProperty(exp.payer)) payerTotals[exp.payer] += finalCNY;
        if (balances.hasOwnProperty(exp.payer)) balances[exp.payer] += finalCNY;
        const type = (TV_EXPENSE_TYPES.indexOf(exp.type) >= 0) ? exp.type : 'shared';
        if (type === 'split') {
            const details = isPlain(exp.splitDetails) ? exp.splitDetails : {};
            const total = numOrNull(exp.amount) || 0;
            for (const person of Object.keys(details)) {
                const share = (total > 0) ? (finalCNY / total) * (numOrNull(details[person]) || 0) : 0;
                if (ps.indexOf(person) >= 0) {
                    if (balances.hasOwnProperty(person)) balances[person] -= share;
                } else {
                    if (balances.hasOwnProperty(exp.payer)) balances[exp.payer] -= share;
                    if (!externalDebts[person]) externalDebts[person] = {};
                    externalDebts[person][exp.payer] = (externalDebts[person][exp.payer] || 0) + share;
                }
            }
        } else if (!exp.isPrivate && type === 'shared') {
            const per = (ps.length > 0) ? finalCNY / ps.length : 0;
            for (const p of ps) balances[p] -= per;
        } else {
            if (balances.hasOwnProperty(exp.payer)) balances[exp.payer] -= finalCNY;
        }
    }
    return { payerTotals: payerTotals, balances: balances, externalDebts: externalDebts };
}

/* 家庭归并（源 _calculateInternalSettlement 前半）：成员余额并入 rep；未归并成员原样。 */
export function consolidateFamilies(balances, families) {
    const finalBalances = {};
    const assigned = {};
    for (const f of listOf(families)) {
        if (!isPlain(f) || !f.rep) continue;
        finalBalances[f.rep] = finalBalances[f.rep] || 0;
        for (const member of listOf(f.members)) {
            if (balances[member] !== undefined) finalBalances[f.rep] += balances[member];
            assigned[member] = true;
        }
    }
    for (const person of Object.keys(balances)) {
        if (!assigned[person]) finalBalances[person] = balances[person];
    }
    return finalBalances;
}

/* 贪心内部清算（源双指针）：债务人升序 × 债权人降序，|差额|≤0.01 清零。 */
export function internalSettlement(finalBalances) {
    const arr = [];
    for (const name of Object.keys(finalBalances)) {
        if (Math.abs(finalBalances[name]) > 0.01) arr.push({ name: name, diff: finalBalances[name] });
    }
    const debtors = arr.filter(function (p) { return p.diff < 0; }).sort(function (a, b) { return a.diff - b.diff; });
    const creditors = arr.filter(function (p) { return p.diff > 0; }).sort(function (a, b) { return b.diff - a.diff; });
    const transfers = [];
    let i = 0; let j = 0;
    while (i < debtors.length && j < creditors.length) {
        const amount = Math.min(Math.abs(debtors[i].diff), creditors[j].diff);
        transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: Math.round(amount * 100) / 100 });
        debtors[i].diff += amount;
        creditors[j].diff -= amount;
        if (Math.abs(debtors[i].diff) < 0.01) i++;
        if (creditors[j].diff < 0.01) j++;
    }
    return { transfers: transfers, balanced: transfers.length === 0 };
}
/* 外部债务表（源 _calculateExternalSettlement）：外部人 → creditor 逐笔，>0.01 才列。 */
export function externalSettlement(externalDebts) {
    const rows = [];
    for (const outsider of Object.keys(isPlain(externalDebts) ? externalDebts : {})) {
        for (const creditor of Object.keys(externalDebts[outsider])) {
            const amount = externalDebts[outsider][creditor];
            if (amount > 0.01) rows.push({ from: outsider, to: creditor, amount: Math.round(amount * 100) / 100 });
        }
    }
    return rows;
}

/* 费用归一：payer 必有且在册；三型；split 明细归一。 */
export function normalizeExpense(raw, index, people) {
    const r = isPlain(raw) ? raw : {};
    const ps = listOf(people);
    if (!r.payer || ps.indexOf(r.payer) < 0) return { expense: null, why: 'unknown_payer' };
    const type = (TV_EXPENSE_TYPES.indexOf(r.type) >= 0) ? r.type : 'shared';
    const splitDetails = {};
    if (type === 'split' && isPlain(r.splitDetails)) {
        for (const k of Object.keys(r.splitDetails)) {
            const v = numOrNull(r.splitDetails[k]);
            if (v !== null && v > 0) splitDetails[k] = v;
        }
    }
    return { expense: { id: toStr(r.id) || ('tv_e_' + String(index + 1)), payer: r.payer, currency: toStr(r.currency) || 'CNY', amount: numOrNull(r.amount) || 0, rate: numOrNull(r.rate) || 1, unit: numOrNull(r.unit) || 1, finalCNY: numOrNull(r.finalCNY) || 0, type: type, splitDetails: splitDetails, isPrivate: r.isPrivate === true, note: toStr(r.note) }, why: '' };
}

export function normalizeExpenses(raw, people) {
    const out = { expenses: [], rejected: [] };
    for (let i = 0; i < listOf(raw).length; i++) {
        const r = normalizeExpense(listOf(raw)[i], i, people);
        if (!r.expense) { out.rejected.push({ index: i, why: r.why }); continue; }
        out.expenses.push(r.expense);
    }
    const capped = trimRows(out.expenses, TV_EXPENSES_MAX);
    out.expenses = capped.rows;
    return out;
}

/* 读数面：公共总支出与人均（源 publicTotalCost / perPersonShare）。 */
export function readingsOf(expenses, people) {
    const ps = listOf(people);
    const arr = listOf(expenses);
    let publicTotal = 0; let sharedTotal = 0;
    for (const e of arr) {
        if (!e || e.isPrivate) continue;
        publicTotal += numOrNull(e.finalCNY) || 0;
        if (e.type === 'shared') sharedTotal += numOrNull(e.finalCNY) || 0;
    }
    return { expenses: arr.length, people: ps.length, publicTotal: Math.round(publicTotal * 100) / 100, perPerson: (ps.length > 0) ? Math.round((sharedTotal / ps.length) * 100) / 100 : 0 };
}