/* ============================================================
 * config/causal-district-economy.js — [R9-X4 · 第九期规划]
 * 有因果的虚构街区经济与信任交换网络（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   街区不仅流转货币，更流转信任度 (trust)、名额配额 (quota) 与作品引用权 (credit)：
 *     - 用户或角色的接受、拒绝与缺席产生可逆的因果账本 (transaction_ledger)
 *     - 支持交易反悔与因果回退 (rollback_causal_step)
 *     - 决不伪造真实货币与现实支付
 * ============================================================ */
export function executeDistrictTransaction(wallet, transaction = {}) {
    if (!wallet) return { success: false, reason: 'invalid_wallet' };

    const balances = {
        currency: Number(wallet.currency) || 0,
        trust: Number(wallet.trust) || 0,
        quota: Number(wallet.quota) || 0
    };

    const deltaCurrency = Number(transaction.deltaCurrency) || 0;
    const deltaTrust = Number(transaction.deltaTrust) || 0;
    const deltaQuota = Number(transaction.deltaQuota) || 0;

    // 检查余额下限（信任和货币不可为负）
    if (balances.currency + deltaCurrency < 0) {
        return { success: false, reason: 'insufficient_currency' };
    }
    if (balances.trust + deltaTrust < 0) {
        return { success: false, reason: 'insufficient_trust' };
    }

    balances.currency += deltaCurrency;
    balances.trust += deltaTrust;
    balances.quota += deltaQuota;

    const receipt = {
        txId: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        deltaCurrency,
        deltaTrust,
        deltaQuota,
        reason: String(transaction.reason || '').trim(),
        counterpartId: transaction.counterpartId || 'district_market',
        timestamp: Date.now()
    };

    return {
        success: true,
        balances,
        receipt
    };
}