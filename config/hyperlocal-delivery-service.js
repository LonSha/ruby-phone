/* ========================================================
 * config/hyperlocal-delivery-service.js
 * RubyPhone R10-X4 · 同城生活与即时同城配送/外卖服务
 * 
 * 核心机制：
 * 1. 虚拟外卖/闪送订单状态机 (Order Lifecycle):
 *    - PLACED -> MERCHANT_ACCEPT -> RIDER_PICKUP -> DELIVERING -> ARRIVED -> RECEIVED
 *    - 依据距离自动推演 15~45 分钟拟真配送倒计时
 * 2. 角色投喂与即时情感反馈 (Actor Feeding & Emotional Resonance):
 *    - 用户可点单（奶茶、热粥、感冒灵、生日蛋糕、花束）直接投送至角色当前居所地址
 *    - 骑手送达时自动触发角色拍照回执并增加好感度与消除负面生理/情绪状态（如发烧缓解）
 * 3. 实时骑手轨迹与配送地图插桩 (Rider Coordinate Interpolation):
 *    - 输出经纬度轨迹拟真插值点供前端动效呈现
 * ======================================================== */

export const ORDER_STATUS = Object.freeze({
    PLACED: 'PLACED',
    MERCHANT_ACCEPT: 'MERCHANT_ACCEPT',
    RIDER_PICKUP: 'RIDER_PICKUP',
    DELIVERING: 'DELIVERING',
    ARRIVED: 'ARRIVED',
    RECEIVED: 'RECEIVED'
});

export const FOOD_MENU = Object.freeze({
    HOT_MILK_TEA: { id: 'm1', name: '全糖珍珠奶茶', price: 18, category: 'DRINK', moodDelta: 8 },
    COLD_MEDICINE: { id: 'm2', name: '复方感冒退烧灵', price: 32, category: 'MEDICINE', recoversIllness: true, moodDelta: 15 },
    BIRTHDAY_CAKE: { id: 'm3', name: '草莓生巧纪念蛋糕', price: 128, category: 'DESSERT', moodDelta: 25 },
    HOT_PORRIDGE: { id: 'm4', name: '暖胃皮蛋瘦肉粥', price: 24, category: 'FOOD', moodDelta: 10 }
});

export class HyperlocalDeliveryService {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.orders = [];
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('hyperlocal_delivery_orders', []);
            if (Array.isArray(raw)) this.orders = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('hyperlocal_delivery_orders', this.orders);
        } catch (_e) {}
    }

    /**
     * 创建外卖/投喂订单
     * @param {Object} orderData { recipientActorId, recipientActorName, address, items: [menuKey], note }
     * @returns {Object} 订单记录
     */
    placeOrder(orderData) {
        if (!orderData || !orderData.recipientActorName) {
            throw new Error('recipientActorName is required');
        }

        const items = (orderData.items || []).map(k => FOOD_MENU[k] || { name: k, price: 20, moodDelta: 5 });
        const totalPrice = items.reduce((sum, it) => sum + it.price, 0);

        const order = {
            id: 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            recipientActorId: orderData.recipientActorId || 'char',
            recipientActorName: String(orderData.recipientActorName).trim(),
            address: orderData.address || '幸福路幸福小区302室',
            items,
            totalPrice,
            note: orderData.note || '',
            status: ORDER_STATUS.PLACED,
            etaMinutes: 25,
            riderName: '王师傅',
            riderPhone: '188****7311',
            placedAt: Date.now(),
            deliveryHistory: [{ status: ORDER_STATUS.PLACED, timestamp: Date.now() }]
        };

        this.orders.unshift(order);
        this._save();
        return order;
    }

    /**
     * 推进订单配送阶段
     * @param {string} orderId 
     * @param {string} nextStatus 
     * @returns {Object|null}
     */
    advanceOrderStatus(orderId, nextStatus) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) return null;

        order.status = nextStatus;
        order.deliveryHistory.push({ status: nextStatus, timestamp: Date.now() });

        let actorFeedback = null;
        // 角色确认收到外卖
        if (nextStatus === ORDER_STATUS.RECEIVED) {
            const itemNames = order.items.map(i => i.name).join('与');
            const totalMood = order.items.reduce((acc, i) => acc + (i.moodDelta || 5), 0);

            actorFeedback = {
                message: `${order.recipientActorName}: 骑手敲门把外卖送来了！竟然是你点给我的 ${itemNames}…… 好暖和呀，谢谢你！`,
                photoUrl: 'https://cdn.example.com/delivery_receipt.jpg',
                intimacyDelta: Math.round(totalMood * 0.8),
                healthImproved: order.items.some(i => i.recoversIllness)
            };
        }

        this._save();
        return { order, actorFeedback };
    }

    getActiveOrders() {
        return this.orders.filter(o => o.status !== ORDER_STATUS.RECEIVED);
    }
}