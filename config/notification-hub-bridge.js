/* ============================================================
 * config/notification-hub-bridge.js — [v4.99.0 · R11-X6] 通知中枢 ↔ 通知中心的**中间一层**
 * ------------------------------------------------------------
 * 【为什么需要这一层，而不是让 App 直接读 `subsystems.notifications`】
 *   本仓有**两套通知真源**：
 *     ① `config/system-notifications.js` 的 `NotificationLog`（落盘键 `sys_notifs`，
 *        历史 200 条，`index.js` 的 `showNotification` 写它）—— 通知中心**已经在读它**；
 *     ② `config/system-notification-dispatcher.js` 的 `SystemNotificationDispatcher`
 *        （落盘键 `sys_notifications_queue`，中枢 `advanceAutonomousLifeStep` 往里 `post`）
 *        —— 25 个中枢实例里唯一两处在中枢内部被调用的那一件，但**产品端零读**。
 *   于是「健康异动预警」「日程提醒」这类由中枢派发的通知，用户**永远看不到**：
 *   它们落在 ②，而通知中心画的是 ①。「中枢能通向产品」这件事在本仓一次都没成立过。
 *
 * 【本层只做一件事：把 ② 读出来并**映射成 ① 的行形状**】
 *   ★ 不合并写回、不复制成两份真源：本层是**纯读 + 纯函数映射**，不碰任何 storage。
 *     把 ② 的行 append 进 ① 会让同一条通知存两处，读一次变两次、
 *     标记已读要写两个键、清空只清一边 —— 那是本仓治过多次的「第二份真源」。
 *     正确的口径是：**两张表各存各的，界面在同一处合并呈现**，写回各回各家。
 *   ★ 不判归属：哪条属于哪个 App 由派发器记的 `appId` 决定，本层不改名（改名 =
 *     通知点开后跳错 App，而它不会报错）。
 *
 * 【映射为什么必须显式（两套行形状不同）】
 *   ① 的行：{ id, ts, title, message, icon, appId, senderKey, read, count, meta }
 *   ② 的行：{ id, appId, title, body, priority, priorityName, timestamp, read, deepLink, metadata }
 *   差别在 `ts/timestamp`、`message/body` 与 `count`（② 没有 count，恒 1）。
 *   映射写错一处就得到「时间全显示 1970」或「正文永远是空的」——两者都不报错。
 * ============================================================ */
'use strict';
import { normalizePriority, priorityName } from './system-notification-dispatcher.js';

/** ② 的优先级 → ① 渲染用的图标字形（挑最接近的一档，不新造字形）。 */
const PRIORITY_ICON = { URGENT: '⚠️', NORMAL: '📱', SILENT: '🕰️' };

/**
 * 把中枢派发器的一条通知映射成通知中心的行形状。
 * @param {object} raw 派发器里的原始条目
 * @returns {object|null} 映射失败（不是对象 / 没标题）返回 null —— **不补空壳**
 */
export function mapHubNotification(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const title = String(raw.title || '').trim();
    /* 派发器自己就不收没标题的（post 直接 return null），这里同样不补 ——
     *   补一个「（无标题）」会让界面看起来「有东西」而其实那条是不该存在的。 */
    if (!title) return null;
    const pName = raw.priorityName ? String(raw.priorityName) : priorityName(raw.priority);
    const pNum = normalizePriority(raw.priority);
    return {
        id: 'hub_' + String(raw.id || ''),
        ts: Number(raw.timestamp) || 0,
        title,
        message: String(raw.body || '').trim(),
        icon: PRIORITY_ICON[pName] || PRIORITY_ICON.NORMAL,
        appId: String(raw.appId || ''),
        senderKey: '',
        read: raw.read === true,
        count: 1,
        meta: {
            ...(raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}),
            /* 来源标记必须落到行上：界面要能说清「这条不是 showNotification 写的那张表」。 */
            hubSource: true,
            hubPriority: pName,
            hubPriorityNum: pNum,
            hubDeepLink: raw.deepLink || null
        }
    };
}

/**
 * 合并两张表的行（**只读，不改入参**）。
 * @param {Array} logRows ① NotificationLog 的行
 * @param {Array} hubRows ② 派发器的行
 * @returns {{rows: Array, counts: object, notes: object}}
 *   counts 三态**必须不同形**（本仓既有纪律）： 
 *     logReadable / hubReadable 各自说「读到了没有」，
 *     读不到不是「没有数据」—— 界面文案要靠它分两句。
 */
export function mergeFeed(logRows, hubRows, opts = {}) {
    const a = Array.isArray(logRows) ? logRows : [];
    const b = Array.isArray(hubRows) ? hubRows : [];
    const logReadable = opts.logReadable !== false;
    const hubReadable = opts.hubReadable !== false;
    const out = [];
    for (const r of a) {
        if (r && typeof r === 'object') out.push(r);
    }
    let hubMapped = 0;
    let hubDropped = 0;
    for (const r of b) {
        const m = mapHubNotification(r);
        if (!m) { hubDropped += 1; continue; }
        out.push(m);
        hubMapped += 1;
    }
    /* 排序口径与 ① 一致：**新者在前**。ts 缺失（0）的一律沉底 ——
     *   不能让一条没有时间的通知排在最上面冒充「刚刚」。 */
    out.sort((x, y) => (Number(y.ts) || 0) - (Number(x.ts) || 0));
    return {
        rows: out,
        counts: {
            log: a.length,
            hub: b.length,
            hubMapped,
            hubDropped,
            total: out.length
        },
        notes: {
            logReadable,
            hubReadable,
            /* 读不到时的具体原因（'no_host' / 'no_dispatcher' / 'read_threw' …）——
             *   界面要能把它念出来；只给一个 false 让人无从下手。空串表示读到了。 */
            hubWhy: String(opts.hubWhy || ''),
            /* 两个布尔合起来才是「能不能信这份列表」：
             *   有一侧读不到时，界面必须说「有一侧没读到」而不是「就这些」。 */
            complete: logReadable && hubReadable
        }
    };
}
