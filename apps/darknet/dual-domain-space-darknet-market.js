/* ============================================================
 * dual-domain-space-darknet-market.js — [v4.138.0 · V21-R12]
 * 双域隔离空间与绝密暗网黑市交易终端 (Dual-Domain Darknet Market)
 * ------------------------------------------------------------
 * 1. 伪装密码切换影子私密空间 (Shadow Space Seamless Switcher)
 * 2. 加密暗网黑市商品与情报交易 (Crypto Darknet Market)
 * 3. 虚拟加密代币流水与绝密信箱 (Encrypted Dead-Drop Mailbox)
 * ============================================================ */
export function createDarknetMarketState() {
    return {
        shadowUnlocked: false,
        cryptoBalance: 15.5, // 虚拟暗网代币
        marketListings: [
            { id: "item_dossier", name: "关键证人秘密住址情报", price: 5.0, purchased: false },
            { id: "item_trojan", name: "远程木马监听脚本", price: 8.0, purchased: false }
        ],
        deadDropInbox: []
    };
}

export function purchaseDarknetItem(state, itemId) {
    if (!state || !state.marketListings) return { success: false, reason: "invalid_state" };
    const item = state.marketListings.find(i => i.id === itemId);
    if (!item) return { success: false, reason: "not_found" };
    if (item.purchased) return { success: false, reason: "already_purchased" };
    if (state.cryptoBalance < item.price) return { success: false, reason: "insufficient_crypto" };

    state.cryptoBalance -= item.price;
    item.purchased = true;
    state.deadDropInbox.push({
        from: "Darknet_Broker",
        subject: `交付物：${item.name}`,
        receivedAt: Date.now()
    });
    return { success: true, item, remainingBalance: state.cryptoBalance };
}
