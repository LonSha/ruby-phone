/* ============================================================
 * ipc-event-bus-backpressure-controller.js — [v4.139.0 · 第十八期全新内核底座]
 * 跨 App 进程间通信 (IPC) 背压与流量节流控制器 (IPC Backpressure Controller)
 * ------------------------------------------------------------
 * 【核心机制与异步通信管线】
 * 解决多应用（微信、相册、网约车、外卖、手表）同时向总线抛发事件导致的消息风暴：
 *   - 动态令牌桶背压算法 (Token Bucket Backpressure):
 *   - 针对不同优先级事件（SOS紧急 > 微信消息 > 计步同步）分流限速；
 *   - 避免主线程事件循环由于高频 IPC 产生卡死。
 * ============================================================ */

export class IPCEventBusBackpressureController {
    constructor(options = {}) {
        this.options = Object.assign({
            maxTokens: 50,
            refillRatePerSec: 25
        }, options);

        this.tokens = this.options.maxTokens;
        this.lastRefillTimestamp = Date.now();
        this.subscribers = new Map(); // topic -> Set(handlers)
        this.droppedEventCount = 0;
    }

    refillTokens() {
        const now = Date.now();
        const deltaSec = (now - this.lastRefillTimestamp) / 1000;
        this.tokens = Math.min(this.options.maxTokens, this.tokens + (deltaSec * this.options.refillRatePerSec));
        this.lastRefillTimestamp = now;
    }

    subscribe(topic, handler) {
        if (!this.subscribers.has(topic)) {
            this.subscribers.set(topic, new Set());
        }
        this.subscribers.get(topic).add(handler);
        return () => this.subscribers.get(topic)?.delete(handler);
    }

    /**
     * 抛发事件并应用背压节流
     * @param {string} topic 
     * @param {any} payload 
     * @param {string} priority 'high' | 'normal' | 'low'
     */
    publish(topic, payload, priority = "normal") {
        this.refillTokens();

        const cost = priority === "high" ? 0.5 : (priority === "normal" ? 1.0 : 2.0);
        if (this.tokens < cost && priority !== "high") {
            this.droppedEventCount++;
            return { delivered: false, reason: "BACKPRESSURE_DROP" };
        }

        this.tokens = Math.max(0, this.tokens - cost);
        const handlers = this.subscribers.get(topic);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(payload);
                } catch (e) {
                    console.error("[IPC] handler error:", e);
                }
            }
        }

        return { delivered: true, remainingTokens: this.tokens };
    }
}

export default IPCEventBusBackpressureController;