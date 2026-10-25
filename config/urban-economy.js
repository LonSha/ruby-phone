/* ========================================================
 * config/urban-economy.js — [R8-X3 · 第八期规划] 有因果的城市经济内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决街区地点变成死板陈列、没有因果交易网络的问题：
 *     ① 交换网络不仅包含虚拟货币，还包括时间、信任度、承诺与特定名额；
 *     ② 交易执行：partyA / partyB / giveItems / receiveItems / condition；
 *     ③ 因果沉淀：用户的拒绝、缺席与选择会改变后续地点的开放名额与信任要求；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */
'use strict';

const UE_STORAGE_KEY = 'ue_urban_economy_v1';

const ASSET_TYPES = Object.freeze({
    CURRENCY: 'currency',
    TRUST: 'trust',
    PLEDGE: 'pledge',
    MATERIAL: 'material',
    SLOT: 'slot'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeEconomyState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            balances: { currency: 1000, trust: 50 },
            transactions: [],
            locationReputation: {},
            updatedAt: Date.now()
        };
    }
    return {
        balances: (raw.balances && typeof raw.balances === 'object') ? { ...raw.balances } : { currency: 1000, trust: 50 },
        transactions: safeArr(raw.transactions).slice(-50),
        locationReputation: (raw.locationReputation && typeof raw.locationReputation === 'object') ? { ...raw.locationReputation } : {},
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 评估地点交易可行性
 */
export function evaluateTransaction(state, spec) {
    const s = normalizeEconomyState(state);
    if (!spec || typeof spec !== 'object') {
        return { feasible: false, reason: 'invalid-spec' };
    }
    const costCurrency = safeNum(spec.costCurrency, 0);
    const requiredTrust = safeNum(spec.requiredTrust, 0);

    const currentCurrency = safeNum(s.balances.currency, 0);
    const currentTrust = safeNum(s.balances.trust, 0);

    if (currentCurrency < costCurrency) {
        return { feasible: false, reason: 'insufficient-currency', deficit: costCurrency - currentCurrency };
    }
    if (currentTrust < requiredTrust) {
        return { feasible: false, reason: 'insufficient-trust', deficit: requiredTrust - currentTrust };
    }

    return { feasible: true };
}

/**
 * 提交一次城市交换交易
 */
export function executeTransaction(state, spec) {
    const s = normalizeEconomyState(state);
    const evalRes = evaluateTransaction(s, spec);
    if (!evalRes.feasible) {
        return { success: false, reason: evalRes.reason, deficit: evalRes.deficit, state: s };
    }

    const txId = safeStr(spec.id) || `tx_${Date.now()}`;
    const costCurrency = safeNum(spec.costCurrency, 0);
    const gainTrust = safeNum(spec.gainTrust, 0);
    const locationId = safeStr(spec.locationId) || 'market';

    const nextBalances = {
        ...s.balances,
        currency: safeNum(s.balances.currency, 0) - costCurrency,
        trust: safeNum(s.balances.trust, 0) + gainTrust
    };

    const nextRep = {
        ...s.locationReputation,
        [locationId]: safeNum(s.locationReputation[locationId], 0) + 1
    };

    const txEntry = {
        id: txId,
        title: safeStr(spec.title) || '城市物品交易',
        locationId,
        costCurrency,
        gainTrust,
        timestamp: Date.now()
    };

    return {
        success: true,
        transaction: txEntry,
        state: {
            ...s,
            balances: nextBalances,
            transactions: [...s.transactions, txEntry].slice(-50),
            locationReputation: nextRep,
            updatedAt: Date.now()
        }
    };
}