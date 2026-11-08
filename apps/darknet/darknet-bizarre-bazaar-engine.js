/**
 * 深夜暗网双域集市与匿名加密信道 (Darknet Bizarre Bazaar Engine)
 * 支持拨号暗号 (*#0666#) 激活、午夜限时上架机密情报道具、加密购买与寄存柜提货机制
 */
export class DarknetBizarreBazaarEngine {
    constructor() {
        this.unlocked = false;
        this.bazaarItems = [
            { id: 'item_black_sim', name: '不记名加密黑卡SIM', price: 500, category: 'HARDWARE', stock: 3, desc: '具备动态IMEI防嗅探基站功能' },
            { id: 'item_surveillance_log', name: '绝密监控底片碎片', price: 1200, category: 'INTEL', stock: 1, desc: '记载了深夜老洋房火灾案的幕后涉案车辆' },
            { id: 'item_chameleon_agent', name: '变色龙声纹扰频器', price: 800, category: 'TOOL', stock: 5, desc: '通话时将己方声线伪装为机械电音' }
        ];
        this.orderHistory = [];
    }

    /**
     * 校验拨号盘暗号或深夜时间以解锁暗网
     */
    verifyAccessCode(dialCode, currentHour = 2) {
        if (dialCode === '*#0666#' || (currentHour >= 1 && currentHour <= 4)) {
            this.unlocked = true;
            return {
                unlocked: true,
                portalBanner: 'WELCOME TO ONION BAZAAR // 节点延迟 18ms // 链路全端匿名加密',
                theme: 'MATRIX_NEON_GREEN'
            };
        }
        return {
            unlocked: false,
            reason: 'INVALID_DIAL_HASH_OR_NOT_MIDNIGHT'
        };
    }

    /**
     * 获取暗网货架
     */
    getMarketListing() {
        if (!this.unlocked) return [];
        return this.bazaarItems.map(item => ({ ...item }));
    }

    /**
     * 匿名拍下机密商品
     */
    purchaseItem(itemId, buyerWalletBalance = 2000) {
        if (!this.unlocked) {
            return { success: false, reason: 'BAZAAR_NOT_ACCESSIBLE' };
        }
        const item = this.bazaarItems.find(i => i.id === itemId);
        if (!item) return { success: false, reason: 'ITEM_NOT_FOUND' };
        if (item.stock <= 0) return { success: false, reason: 'ITEM_OUT_OF_STOCK' };
        if (buyerWalletBalance < item.price) return { success: false, reason: 'INSUFFICIENT_FUNDS' };

        item.stock -= 1;
        const pickupCode = 'CAB_' + Math.floor(1000 + Math.random() * 9000);
        const order = {
            orderId: 'onion_order_' + Date.now(),
            itemId: item.id,
            itemName: item.name,
            cost: item.price,
            lockerPickupCode: pickupCode,
            lockerLocation: '地铁1号线终点站3号行李寄存柜',
            status: 'PENDING_PICKUP',
            orderedAt: Date.now()
        };
        this.orderHistory.push(order);
        return {
            success: true,
            order: order,
            smsReceiptPrompt: '【加密短讯】提货码已投递：前往 ' + order.lockerLocation + '，凭码 ' + pickupCode + ' 取走包裹。'
        };
    }
}

export default DarknetBizarreBazaarEngine;