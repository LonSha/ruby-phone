/* ========================================================
 * usage-data.js — [v3.15.0] 洞察 App 的取数胶水层（计划 #52 + #53）
 * --------------------------------------------------------
 * 分工（刻意划清，防「同一口径被抄 N 份」）：
 *   · 纯算法 → config/usage-tracker.js（使用统计）与 config/contact-insight.js（联系人互动）；
 *   · 取数（摸宿主单例）→ **本文件**；
 *   · 渲染 → usage-view.js；编排 → usage-app.js。
 *
 * 三条纪律：
 *   ① 每个源独立 try/catch，坏源只空自己那一格（不连坐整页）；
 *   ② 读不到一律如实 null / 空态，**不补 0 冒充真实读数**；
 *   ③ 本文件不写任何 storage —— 使用统计的写只在 config/usage-tracker.js 的
 *      `trackerNote` / `trackerClose`（采集咽喉点在 index.js）。
 * ======================================================== */

import {
    readUsage, usageSummary, topApps, dailyRows, hourHeat, formatDuration
} from '../../config/usage-tracker.js';
import {
    buildContactInsight, STALE_DAYS_DEFAULT
} from '../../config/contact-insight.js';

export const USAGE_APP_ICON = '📊';

export function defaultInsightSettings() {
    return Object.freeze({
        injectToPrompt: true,          // 把「疏远度」注入 Prompt（既定事实语气）
        staleDays: STALE_DAYS_DEFAULT, // 长期未联系阈值（天）
        showDiagnostics: false
    });
}

/** 归一设置（畸形值一律回落默认；数值范围钳制，不静默接受越界）。 */
export function normalizeInsightSettings(raw) {
    const d = defaultInsightSettings();
    const out = { ...d };
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.injectToPrompt === 'boolean') out.injectToPrompt = raw.injectToPrompt;
    if (typeof raw.showDiagnostics === 'boolean') out.showDiagnostics = raw.showDiagnostics;
    if (typeof raw.staleDays === 'number' && Number.isFinite(raw.staleDays)) {
        out.staleDays = Math.min(365, Math.max(1, Math.trunc(raw.staleDays)));
    }
    return out;
}

/**
 * 取微信三件读数（会话表 / 分桶正文 / 已加载标记）。
 * 形状与 config/rollback-preview.js 的取数口**同一份**（那里已验证过：
 * fork 出第二份取数就会得到两份会漂移的读数）。此处只取只读内存桶，
 * **绝不调会触发懒加载的按会话取消息出口** —— 打开统计页不该改数据。
 */
export function readWechatStores(win) {
    const w = win || {};
    const vp = w.VirtualPhone || null;
    try {
        const wd = (vp && ((vp.wechatApp && vp.wechatApp.wechatData) || vp.cachedWechatData)) || null;
        if (!wd || !wd.data || typeof wd.data !== 'object') return null;
        const chats = Array.isArray(wd.data.chats) ? wd.data.chats : null;
        if (!chats) return null;
        const buckets = (wd.data.messages && typeof wd.data.messages === 'object') ? wd.data.messages : {};
        const loaded = (wd._messagesLoaded && typeof wd._messagesLoaded === 'object') ? wd._messagesLoaded : {};
        return {
            chats: chats,
            buckets: buckets,
            loadedIds: Object.keys(buckets).filter((id) => loaded[id] === true)
        };
    } catch (_e) { return null; }
}

/** 取短信 / 通话读数（走 phoneCallData 的公开读出口）。 */
export function readPhoneStores(win) {
    const w = win || {};
    const vp = w.VirtualPhone || null;
    const out = { sms: undefined, calls: undefined };
    try {
        const pcd = vp && vp.phoneApp && vp.phoneApp.phoneCallData;
        if (pcd) {
            const sms = (typeof pcd.getSmsConversations === 'function') ? pcd.getSmsConversations() : null;
            out.sms = Array.isArray(sms) ? sms : null;
            const hist = (typeof pcd.getCallHistory === 'function') ? pcd.getCallHistory() : null;
            out.calls = Array.isArray(hist) ? hist : null;
        }
    } catch (_e) { /* 两域各自为 null（读不到），不伪造 */ }
    return out;
}

/** 使用统计读数（计划 #52）。 */
export function collectUsage(storage) {
    const usage = readUsage(storage);
    return {
        summary: usageSummary(usage),
        top: topApps(usage, 5),
        daily: dailyRows(usage, 7),
        hours: hourHeat(usage),
        openApp: usage.open ? usage.open.appId : null
    };
}

/** 联系人互动读数（计划 #53）。 */
export function collectContactInsight(win, staleDays) {
    const wechat = readWechatStores(win);
    const phone = readPhoneStores(win);
    return buildContactInsight({ wechat: wechat, sms: phone.sms, calls: phone.calls }, { staleDays: staleDays });
}

/** 时长可读化再导出（视图与注入共用同一实现，避免第二份）。 */
export { formatDuration };
