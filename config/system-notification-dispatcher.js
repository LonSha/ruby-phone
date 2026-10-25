/* ========================================================
 * config/system-notification-dispatcher.js
 * RubyPhone R10-O2 · 系统级常驻通知中心与锁屏横幅堆叠
 * 
 * 核心机制：
 * 1. 统一通知模型与优先级调度 (Priority Dispatch):
 *    - 优先级: URGENT (紧急来电/剧情求助/电量告急) > NORMAL (微信消息/备忘录) > SILENT (后台同步)
 *    - 支持免打扰 (DND) 拦截过滤（URGENT 穿透）
 * 2. 横幅堆叠与折叠治理 (Banner Stack & App Clustering):
 *    - 同一应用的多条通知自动聚合为一个分组卡片 (App Grouping)
 *    - 内存上限控制（最大 50 条，溢出按优先级和时间自然淘汰）
 * 3. 锁屏与深度路由 (Deep Link Routing):
 *    - 点击通知直接解析 targetApp 与 targetParams，支持深度唤醒
 * ======================================================== */

export const NOTIFICATION_PRIORITY = Object.freeze({
    URGENT: 3,
    NORMAL: 2,
    SILENT: 1
});

export const NOTIFICATION_CHANNELS = Object.freeze({
    WECHAT: 'wechat',
    PHONE_CALL: 'phone_call',
    MEMO: 'memo',
    DELIVERY: 'delivery',
    SYSTEM: 'system'
});

export class SystemNotificationDispatcher {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.maxNotifications = opts.maxNotifications || 50;
        this.dndEnabled = opts.dndEnabled || false;
        this.notifications = [];
        this.subscribers = new Set();
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('sys_notifications_queue', []);
            if (Array.isArray(raw)) this.notifications = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('sys_notifications_queue', this.notifications);
        } catch (_e) {}
    }

    /**
     * 发送系统通知
     * @param {Object} notif 
     * @returns {Object|null} 派发的通知对象，若被拦截则返回 null
     */
    post(notif) {
        if (!notif || !notif.title) return null;

        const priority = notif.priority || NOTIFICATION_PRIORITY.NORMAL;
        
        // 免打扰拦截：仅允许 URGENT 穿透
        if (this.dndEnabled && priority < NOTIFICATION_PRIORITY.URGENT) {
            return null;
        }

        const item = {
            id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            appId: notif.appId || NOTIFICATION_CHANNELS.SYSTEM,
            title: String(notif.title).trim(),
            body: String(notif.body || '').trim(),
            priority,
            timestamp: notif.timestamp || Date.now(),
            read: false,
            deepLink: notif.deepLink || null, // { targetApp, view, params }
            metadata: notif.metadata || {}
        };

        this.notifications.unshift(item);

        // 上限修剪（优先淘汰 SILENT，然后按最旧时间）
        if (this.notifications.length > this.maxNotifications) {
            const silentIdx = this.notifications.findLastIndex(n => n.priority === NOTIFICATION_PRIORITY.SILENT);
            if (silentIdx >= 0) {
                this.notifications.splice(silentIdx, 1);
            } else {
                this.notifications.pop();
            }
        }

        this._save();
        this._notifySubscribers('POST', item);
        return item;
    }

    /**
     * 按 App 分组聚合横幅
     * @returns {Array<Object>} 聚合后的卡片数组
     */
    getClusteredNotifications() {
        const groups = new Map();
        for (const n of this.notifications) {
            if (!groups.has(n.appId)) {
                groups.set(n.appId, {
                    appId: n.appId,
                    latestTimestamp: n.timestamp,
                    unreadCount: 0,
                    items: []
                });
            }
            const g = groups.get(n.appId);
            if (!n.read) g.unreadCount++;
            g.items.push(n);
        }
        return Array.from(groups.values()).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
    }

    /**
     * 标记单条通知已读或点击唤醒
     * @param {string} id 
     * @returns {Object|null} 包含 deepLink 路由信息
     */
    acknowledge(id) {
        const target = this.notifications.find(n => n.id === id);
        if (!target) return null;
        target.read = true;
        this._save();
        this._notifySubscribers('ACK', target);
        return target.deepLink;
    }

    /**
     * 清空指定应用或全部通知
     * @param {string} [appId] 
     */
    clear(appId = null) {
        if (appId) {
            this.notifications = this.notifications.filter(n => n.appId !== appId);
        } else {
            this.notifications = [];
        }
        this._save();
        this._notifySubscribers('CLEAR', { appId });
    }

    setDnd(enabled) {
        this.dndEnabled = !!enabled;
    }

    subscribe(fn) {
        if (typeof fn === 'function') this.subscribers.add(fn);
        return () => this.subscribers.delete(fn);
    }

    _notifySubscribers(action, payload) {
        for (const fn of this.subscribers) {
            try { fn(action, payload); } catch (_e) {}
        }
    }
}