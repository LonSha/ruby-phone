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