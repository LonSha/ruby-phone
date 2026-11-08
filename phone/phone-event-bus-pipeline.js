/* ============================================================
 * phone-event-bus-pipeline.js — 跨应用全局数据总线防抖与无锁管道
 * [v4.140.0 · 虚拟手机微内核事件总线、发布订阅与死信队列]
 * ============================================================ */

export class PhoneEventBusPipeline {
    constructor(options = {}) {
        this.options = Object.assign({
            maxHistoryLog: 150,
            maxDeadLetters: 50,
            debounceMs: 15
        }, options);
        
        this.listeners = new Map(); // eventType -> Set(callback)
        this.eventHistory = [];
        this.deadLetters = [];
        this.debounceTimers = new Map();
    }

    on(eventType, handler) {
        if (!eventType || typeof handler !== "function") return () => {};
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(handler);
        return () => this.off(eventType, handler);
    }

    off(eventType, handler) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).delete(handler);
        }
    }

    emit(eventType, payload = {}, options = {}) {
        if (!eventType) return null;
        const eventId = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const envelope = {
            id: eventId,
            type: eventType,
            payload,
            originApp: options.originApp || "system",
            timestamp: Date.now()
        };

        this.eventHistory.push(envelope);
        if (this.eventHistory.length > this.options.maxHistoryLog) {
            this.eventHistory.shift();
        }
        /* [v18 · IPC 背压引擎真实接入]
         *   ipc-event-bus-backpressure-controller 自投产起全仓无人 import。
         *   它与本管线是**互补**关系而不是重复：本管线负责「投递与死信」，
         *   它负责「令牌桶限流」—— 高频事件（消息刷屏、批量通知）需要这一层，
         *   否则监听方会被瞬时洪峰打爆。
         *   接在 emit 的最前段：被背压丢弃的事件直接记进读数面，
         *   而不是让它在后面无声消失。 */
        try {
            const lc = window.VirtualPhone?._lifecycleHandle;
            const ipc = lc?.engine?.ipc;
            if (ipc && typeof ipc.publish === 'function') {
                const priority = options.priority || 'normal';
                const pub = ipc.publish(eventType, envelope, priority);
                if (pub && pub.delivered === false) {
                    window.VirtualPhone._ipcBackpressureRead = {
                        at: Date.now(), type: eventType, reason: pub.reason,
                        droppedTotal: ipc.droppedEventCount
                    };
                    if (lc.read && lc.read.calls) lc.read.calls.ipcDropped += 1;
                } else if (lc && lc.read && lc.read.calls) {
                    lc.read.calls.ipcPublished += 1;
                }
            }
        } catch (_e) { /* 背压层异常绝不阻断真实投递 */ }

        const subscribers = this.listeners.get(eventType);
        if (!subscribers || subscribers.size === 0) {
            // 无人监听，归入死信队列观察
            this.deadLetters.push(envelope);
            if (this.deadLetters.length > this.options.maxDeadLetters) this.deadLetters.shift();
            return eventId;
        }

        for (const fn of subscribers) {
            try {
                fn(envelope.payload, envelope);
            } catch (err) {
                console.error(`[PhoneEventBus] 派发异常 [${eventType}]:`, err);
            }
        }
        return eventId;
    }

    getBusTelemetry() {
        return {
            activeEventTypes: Array.from(this.listeners.keys()),
            historyCount: this.eventHistory.length,
            deadLetterCount: this.deadLetters.length,
            recentEvents: this.eventHistory.slice(-10)
        };
    }
}
if (typeof globalThis !== "undefined") { globalThis.PhoneEventBusPipeline = PhoneEventBusPipeline; }
if (typeof window !== "undefined") { window.PhoneEventBusPipeline = PhoneEventBusPipeline; }
if (typeof module !== "undefined" && module.exports) { module.exports = PhoneEventBusPipeline; }
export default PhoneEventBusPipeline;