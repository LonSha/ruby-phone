/* ============================================================
 * temporal-notification-timeline-pixel-led.js — [v4.138.0 · V21-R7]
 * 离线通知时间轴平滑重排与掌机像素呼吸指示灯 (Pixel LED Notification Timeline)
 * ------------------------------------------------------------
 * 1. 剧情离线通知按真实发生时间戳排队 (Smooth Timeline Pacing)
 * 2. 避免瞬间刷屏炸裂 (Anti-Burst Staggering Dispatch)
 * 3. 掌机右上角像素呼吸指示灯仿真 (Pixel Blinking LED State)
 * ============================================================ */
export function createNotificationTimelineManager() {
    const queue = [];
    let unreadCount = 0;

    function enqueueOfflineNotification(notif = {}) {
        const entry = {
            id: String(notif.id || `notif_${Date.now()}`),
            appId: String(notif.appId || "system"),
            title: String(notif.title || "新通知"),
            message: String(notif.message || ""),
            timestamp: Number(notif.timestamp) || Date.now(),
            read: false
        };
        queue.push(entry);
        queue.sort((a, b) => b.timestamp - a.timestamp); // 最新在前
        unreadCount++;
        return entry;
    }

    function getLedState() {
        return {
            blinking: unreadCount > 0,
            ledColor: unreadCount > 0 ? "#ff0055" : "#333333",
            unreadCount
        };
    }

    function markAllRead() {
        queue.forEach(n => n.read = true);
        unreadCount = 0;
        return true;
    }

    return {
        enqueueOfflineNotification,
        getNotifications: () => [...queue],
        getLedState,
        markAllRead
    };
}
