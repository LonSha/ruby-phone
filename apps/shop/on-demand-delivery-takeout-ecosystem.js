/* ============================================================
 * on-demand-delivery-takeout-ecosystem.js — [v4.139.0 · 第十八期全新拟真生态]
 * 拟真本地生活外卖与即时配送履约系统 (On-Demand Delivery & Takeout Ecosystem)
 * ------------------------------------------------------------
 * 【核心机制与现代生活烟火气】
 * 填补现代手机生活最核心的履约场景：
 *   支持点外卖（咖啡、退烧药、夜宵、鲜花）与同城跑腿：
 *   - 订单生命周期: 商家接单 -> 骑手接单抢单 -> 到店取货 -> 骑手沿路飞驰 -> 已送达；
 *   - 动态轨迹与倒计时: 骑手实时距离缩短，伴随“您的外卖已被挂在门把手上”的电话/短信闭环。
 * ============================================================ */

export class OnDemandDeliveryTakeoutEcosystem {
    constructor(options = {}) {
        this.options = Object.assign({
            defaultCourierName: "李师傅",
            deliverySpeedMultiplier: 1.0
        }, options);
        this.activeOrders = new Map(); // orderId -> { id, storeName, items: [], status, etaMinutes, courierName, address }
    }

    createOrder(storeName, items = [], address = "幸福小区3号楼402") {
        const orderId = "order_takeout_" + Date.now();
        const record = {
            id: orderId,
            storeName,
            items: Array.isArray(items) ? items : [items],
            status: "merchant_preparing", // merchant_preparing, rider_assigned, in_transit, delivered
            etaMinutes: 28,
            courierName: this.options.defaultCourierName,
            courierPhone: "138****" + Math.floor(1000 + Math.random() * 9000),
            address,
            createdAt: Date.now()
        };

        this.activeOrders.set(orderId, record);
        return record;
    }

    /**
     * 推进外卖配送进度
     */
    advanceDeliveryStep(orderId) {
        const order = this.activeOrders.get(orderId);
        if (!order || order.status === "delivered") return null;

        if (order.status === "merchant_preparing") {
            order.status = "rider_assigned";
            order.etaMinutes = 20;
        } else if (order.status === "rider_assigned") {
            order.status = "in_transit";
            order.etaMinutes = 8;
        } else if (order.status === "in_transit") {
            order.status = "delivered";
            order.etaMinutes = 0;
            order.deliveredAt = Date.now();
        }

        return order;
    }

    formatDeliveryPrompt() {
        if (this.activeOrders.size === 0) return "";
        const lines = ["【美团/饿了么拟真外卖配送状态】"];
        for (const order of this.activeOrders.values()) {
            if (order.status === "delivered") {
                lines.push(`- [已送达] ${order.storeName} (${order.items.join("+")}) 已放置于门前`);
            } else {
                lines.push(`- [配送中 · 剩余${order.etaMinutes}分] 来自「${order.storeName}」(${order.items.join("+")}) 骑手${order.courierName}正在向目的地${order.address}飞驰`);
            }
        }
        return lines.join("\n");
    }

    exportState() {
        return { activeOrders: Array.from(this.activeOrders.entries()) };
    }

    hydrateState(state) {
        if (state && Array.isArray(state.activeOrders)) {
            this.activeOrders = new Map(state.activeOrders);
        }
    }
}

export default OnDemandDeliveryTakeoutEcosystem;