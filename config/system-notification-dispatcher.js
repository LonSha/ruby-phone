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

/* [v4.88.0 · 第七批缝入] 在场状态仲裁（config/presence-arbitration.js，缝自 clawd-on-desk）。
 *   分工：仲裁内核只裁决「谁该被看见」（纯函数、可穷举）；本模块只做**登记 + 取用**。
 *   为什么接在这里：通知中心正是「同一时刻多路都在说话」的那个口 ——
 *   修前排序**只看时间**（最新在最上），于是一条后台同步的 SILENT 能把
 *   「健康异动预警」盖到列表下面，用户看到的永远是最近的那条而不是最要紧的那条。 */
import { resolvePresence, priorityOf, isOneShotState, presenceLine } from './presence-arbitration.js';
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
/* [v4.99.0 · R11-X6] 优先级**两种写法都要认**（字符串名 / 数字档）。
 *
 * 【为什么必须在这里归一，而不是在调用点逐个改】
 *   修前 `post()` 直接拿 `notif.priority` 与 `NOTIFICATION_PRIORITY.URGENT`（数字 3）
 *   做 `<` 比较。而**所有真调用点传的都是字符串**（`subsystem-orchestrator.js:684`
 *   传 'URGENT'、`calendar-autonomous-life.js:178` 的 urgency 也是 'URGENT'/'NORMAL'）。
 *   `'NORMAL' < 3` 在 JS 里是 **false**（比较退化成 NaN）⇒ 免打扰**一条都拦不住**，
 *   而且这条缺陷不报错、只是「开关拨了没反应」—— 本仓最贵的形态。
 *
 * 【口径】认不出的一律回落 NORMAL，**不回落到 URGENT**：
 *   认不出就穿透免打扰，等于让一个拼错的字符串把用户从免打扰里拽出来。
 *   同时另给 `priorityName` 让渲染层与持久化能拿回可读名（见 `_priorityName`）。
 */
export function normalizePriority(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        /* 数字档：越界按最近的合法档夹紧（不静默放行到 URGENT）。 */
        const vals = Object.values(NOTIFICATION_PRIORITY);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        return Math.min(hi, Math.max(lo, Math.round(value)));
    }
    const key = String(value || '').trim().toUpperCase();
    if (key && Object.prototype.hasOwnProperty.call(NOTIFICATION_PRIORITY, key)) {
        return NOTIFICATION_PRIORITY[key];
    }
    return NOTIFICATION_PRIORITY.NORMAL;
}
/** 数字档 → 可读名（认不出回落 'NORMAL'，与 normalizePriority 同口径）。 */
export function priorityName(value) {
    const n = normalizePriority(value);
    for (const [k, v] of Object.entries(NOTIFICATION_PRIORITY)) {
        if (v === n) return k;
    }
    return 'NORMAL';
}

export class SystemNotificationDispatcher {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.maxNotifications = opts.maxNotifications || 50;
        this.dndEnabled = opts.dndEnabled || false;
        this.notifications = [];
        this.subscribers = new Set();
        /* 在场登记表：[来源 id] → { state, headless }。只由 notePresence 写。 */
        this._presence = new Map();
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
     * [v4.88.0] 登记一个来源的在场状态。**由宿主在状态变化时调**，本模块不猜。
     *   未登记的状态不会被静默当成 sleeping：`readPresence()` 会如实列进 unknown。
     * @param {string} id 来源 id（如 'wechat' / 'band' / 'background:sync'）
     * @param {string} state 状态名（表在 presence-arbitration 的 PRESENCE_PRIORITY）
     * @param {{headless?:boolean}} [opts]
     */
    notePresence(id, state, opts = {}) {
        const key = String(id || '').trim();
        if (!key) return false;
        this._presence.set(key, { state: String(state || ''), headless: opts.headless === true });
        return true;
    }
    /** 摘掉一个来源（关掉之后不该继续参与仲裁）。 */
    clearPresence(id) {
        return this._presence.delete(String(id || '').trim());
    }
    /** 当前仲裁读数。compacting / permissionLocked 由调用方按现场传（本模块不持这些事实）。 */
    readPresence(opts = {}) {
        const r = resolvePresence(this._presence, opts);
        return { ...r, line: presenceLine(r) };
    }
    /**
     * 发送系统通知
     * @param {Object} notif 
     * @returns {Object|null} 派发的通知对象，若被拦截则返回 null
     */
    post(notif) {
        if (!notif || !notif.title) return null;
        /* [v4.99.0 · R11-X6] 归一在入口一次做完：下面的比较、排序、持久化全用数字档。
         *   修前这一行是 `notif.priority || NOTIFICATION_PRIORITY.NORMAL` —— 字符串原样进来，
         *   `'NORMAL' < 3` 退化成 NaN ⇒ 免打扰全放行（缺陷，见文件头 normalizePriority 注释）。 */
        const priority = normalizePriority(notif.priority);
        
        // 免打扰拦截：仅允许 URGENT 穿透
        if (this.dndEnabled && priority < NOTIFICATION_PRIORITY.URGENT) {
            return null;
        }

        /* 在场态记账：调用方给了 presenceState 才参与仲裁；没给就是「与在场无关的通知」，
         *   一并不压（否则所有老调用点都会被新机制静默改行为）。 */
        const presenceState = String(notif.presenceState || '');
        const presenceId = String(notif.presenceId || notif.appId || 'anon');
        let suppressedBy = '';
        if (presenceState) {
            this.notePresence(presenceId, presenceState, { headless: notif.headless === true });
            const arb = resolvePresence(this._presence);
            /* 被更高的在场态压住 ⇒ 标 suppressedBy（仍入队，稍后还能翻到）。
             *   但 URGENT 一律穿透：压住一条电量告急去让位给「正在思考」是错的。 */
            if (priority < NOTIFICATION_PRIORITY.URGENT && arb.winner !== presenceState
                && priorityOf(arb.winner) > priorityOf(presenceState)) {
                suppressedBy = arb.winner;
            }
            /* 一次性态（attention / error / notice …）显示一轮后回落，不留常驻。 */
            if (isOneShotState(presenceState)) {
                setTimeout(() => { this._presence.delete(presenceId); }, 0);
            }
        }
        const item = {
            id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            appId: notif.appId || NOTIFICATION_CHANNELS.SYSTEM,
            presenceState,
            suppressedBy,
            title: String(notif.title).trim(),
            body: String(notif.body || '').trim(),
            priority,
            /* [v4.99.0 · R11-X6] 可读名跟着一起落盘：持久化里只有数字 3 时，
             *   下一次冷启读回来的人无从判断它原本是 'URGENT' 还是个越界夹紧值。 */
            priorityName: priorityName(priority),
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
        /* 排序 = 在场优先级（高者在前）→ 时间（新者在前）。
         *   修前只按时间：最新的一条永远压在最上面，与它有多要紧无关。 */
        const rankOf = (g) => g.items.reduce((m, n) => Math.max(m, priorityOf(n.presenceState)), -1);
        return Array.from(groups.values()).sort((a, b) => {
            const d = rankOf(b) - rankOf(a);
            return d !== 0 ? d : (b.latestTimestamp - a.latestTimestamp);
        });
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