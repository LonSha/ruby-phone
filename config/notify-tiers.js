/* ============================================================
 * config/notify-tiers.js — [R25-X6] 通知语义分级 + 免打扰时段 + 挡下回执
 * ------------------------------------------------------------
 * 【它要治的缺陷】
 *   通知中心早就有「重要/普通/静默」这套**名字**：`config/system-notification-dispatcher.js`
 *   里 `NOTIFICATION_PRIORITY` 三档齐全，`config/dnd-schedule.js` 也能判「此刻在不在
 *   免打扰时段」。但真正决定「弹不弹横幅」的那个咽喉（`index.js` 的
 *   `showUnifiedPhoneNotification`）对三档**一律同形**：
 *     · 静默档（后台同步）到点照样弹横幅 —— 「静默」只是日志里的一个数字；
 *     · 免打扰判出来之后**没有任何回执** —— 用户事后无法回答「刚才是不是挡下了什么」；
 *     · 时段配置只能读 `rp22_dnd_schedule`，**设置页没有入口**，改时段得手改存档。
 *
 * 【本模块只做四件事】
 *   ① `TIER_TABLE` —— 三档行为写成**表**（弹不弹横幅 / 进不进中心 / 免打扰能不能穿透），
 *      不许各处再写一遍 `if (priority < 3)`；
 *   ② `decideDelivery()` —— 唯一判决口：给档位与免打扰现场，返回 `banner` / `center` 与**原因**；
 *   ③ `readDndSchedule` / `writeDndSchedule` —— 时段配置的读写唯一口（四态，逐项点名）；
 *   ④ `createDeliveryLedger()` —— 挡下回执账（环形），能答「最近挡下了几条、各为什么」。
 *
 * 【纪律】
 *   · 「挡下」与「没这个通知」不同形：回执账空 ⇒ `empty`（最近什么都没挡），
 *     账读不到 ⇒ `unreadable`。两者**不许合并成一句「一切正常」**；
 *   · 时段非法（读不出 start/end）⇒ `invalid` 并**点名**，不许回落到默认时段冒充已生效；
 *   · 认不出的档位一律当 `normal` 并留 `unknownTier:true` —— 静默**不**静默掉用户没标过的通知。
 * ============================================================ */
'use strict';

import { dndFace } from './dnd-schedule.js';
import { numOrNull } from './num-gate.js';

/** 三档（闭集）。顺序即「重要程度从高到低」，供界面照抄。 */
export const NOTIFY_TIERS = Object.freeze(['urgent', 'normal', 'silent']);

/**
 * 档位行为表（**唯一真源**）。
 * `pierceDnd` 是「该档**是否允许**被放行」，不是「默认放行」：
 *   - false ⇒ 免打扰期间连上游显式请求也不放行（普通/静默是这种）；
 *   - true  ⇒ 允许被放行，但仍需上游**显式**传 `pierceUrgent: true`
 *     （来电这类在真实手机上确实会响的场景），表不替用户决定。
 * 两个条件缺一不可，所以默认行为仍是「零打扰」优先：连重要档也只进中心。
 */
export const TIER_TABLE = Object.freeze({
    urgent: Object.freeze({
        id: 'urgent', label: '重要', priority: 3, banner: true, center: true, pierceDnd: true,
        note: '重要：默认弹横幅；免打扰期间按「零打扰」只进中心（允许上游显式要求穿透）'
    }),
    normal: Object.freeze({
        id: 'normal', label: '普通', priority: 2, banner: true, center: true, pierceDnd: false,
        note: '普通：弹横幅并进中心；免打扰期间只进中心'
    }),
    silent: Object.freeze({
        id: 'silent', label: '静默', priority: 1, banner: false, center: true, pierceDnd: false,
        note: '静默：永不弹横幅，只进中心（后台同步这类「看得到但不打断」）'
    })
});

/** 投递结论（闭集）。`center` = 只入中心不弹横幅。 */
export const DELIVERY = Object.freeze({ banner: 'banner', center: 'center' });

/** 免打扰时段配置的存储键（本仓既有键，不是新开的一份真源）。 */
export const DND_SCHEDULE_KEY = 'rp22_dnd_schedule';
/** 空/缺省时段：老行为（免打扰开关打开即全天生效），显式写出来免得各处各猜。 */
export const DEFAULT_DND_WINDOW = Object.freeze({ start: 23, end: 7 });

export const SCHEDULE_STATES = Object.freeze({
    stored: 'stored', absent: 'absent', invalid: 'invalid', unreadable: 'unreadable'
});

/**
 * 归一档位。认 `'urgent'|'URGENT'|3` 这类写法，**认不出回落 normal** 并留痕。
 * @returns {{tier:string, known:boolean, raw:*}}
 */
export function tierOf(value) {
    if (value && typeof value === 'object') {
        const byId = String(value.tier || value.id || '').toLowerCase();
        if (TIER_TABLE[byId]) return { tier: byId, known: true, raw: value };
        return tierOf(value.priority !== undefined ? value.priority : value.priorityName);
    }
    if (typeof value === 'number') {
        if (value >= 3) return { tier: 'urgent', known: true, raw: value };
        if (value === 2) return { tier: 'normal', known: true, raw: value };
        if (value === 1) return { tier: 'silent', known: true, raw: value };
        return { tier: 'normal', known: false, raw: value };
    }
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (s === 'urgent' || s === 'high' || s === 'critical') return { tier: 'urgent', known: true, raw: value };
    if (s === 'silent' || s === 'quiet' || s === 'low') return { tier: 'silent', known: true, raw: value };
    if (s === 'normal' || s === 'default' || s === 'info') return { tier: 'normal', known: true, raw: value };
    return { tier: 'normal', known: false, raw: value };
}

/**
 * 唯一判决口：这一条该怎么投递。
 * @param {{tier?:*, priority?:*, dndEnabled?:boolean, hour?:number, window?:object, pierceUrgent?:boolean}} input
 * @returns {{tier:string, deliver:string, banner:boolean, center:boolean, reasons:string[], dnd:object, unknownTier:boolean}}
 */
export function decideDelivery(input) {
    const i = (input && typeof input === 'object') ? input : {};
    const t = tierOf(i.tier !== undefined ? i.tier : i.priority);
    const row = TIER_TABLE[t.tier];
    /* 免打扰现场：时段判据交给 dnd-schedule（唯一实现），本模块不另算一次时段。 */
    /* 免打扰现场：调用方已经算出过面（宿主侧走同一内核 dndFace）就直接用，
     *   不重算第二遍 —— 两遍在跨零点时可能落在不同分钟上，会互相矛盾。 */
    const win = (i.window && typeof i.window === 'object') ? i.window : null;
    const dnd = (i.dnd && typeof i.dnd === 'object' && i.dnd.face)
        ? i.dnd
        : dndFace({ enabled: i.dndEnabled === true, hour: i.hour, window: win || DEFAULT_DND_WINDOW });
    const reasons = [];
    if (t.known === false) reasons.push('unknown-tier');
    if (dnd.face === 'invalid') reasons.push('dnd-window-invalid');

    let banner = row.banner === true;
    let center = row.center === true;

    const quiet = dnd.quiet === true;
    if (quiet) {
        if (t.tier === 'urgent' && i.pierceUrgent === true && row.pierceDnd === true) {
            reasons.push('pierced-dnd');
        } else if (banner) {
            banner = false;
            reasons.push('dnd');
        } else {
            /* 静默档在免打扰期间本来就是「不弹」，但仍要留一条原因，
             * 否则回执里看不出「这段静默是被时段加强的」。 */
            reasons.push('silent', 'dnd');
        }
    } else if (t.tier === 'silent') {
        reasons.push('silent');
    }
    if (dnd.face === 'disabled' && i.dndEnabled === true) reasons.push('dnd-disabled');
    if (i.dndEnabled === true && dnd.face === 'outside') reasons.push('outside-window');

    return {
        tier: t.tier,
        deliver: banner ? DELIVERY.banner : DELIVERY.center,
        banner: banner,
        center: center,
        reasons: reasons,
        dnd: dnd,
        unknownTier: t.known === false
    };
}

/** 读免打扰时段配置（四态）。 */
export function readDndSchedule(storage) {
    if (!storage || typeof storage.get !== 'function') {
        return { state: SCHEDULE_STATES.unreadable, reason: 'no-storage', enabled: false, window: { ...DEFAULT_DND_WINDOW }, rejected: [] };
    }
    let raw;
    try { raw = storage.get(DND_SCHEDULE_KEY); }
    catch (e) {
        return { state: SCHEDULE_STATES.unreadable, reason: 'read-threw', detail: String((e && e.message) || e || ''), enabled: false, window: { ...DEFAULT_DND_WINDOW }, rejected: [] };
    }
    if (raw === null || raw === undefined || raw === '') {
        return { state: SCHEDULE_STATES.absent, reason: 'never-set', enabled: false, window: { ...DEFAULT_DND_WINDOW }, rejected: [] };
    }
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (_e) {
            return { state: SCHEDULE_STATES.invalid, reason: 'unparsable', enabled: false, window: { ...DEFAULT_DND_WINDOW }, rejected: ['*'] };
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { state: SCHEDULE_STATES.invalid, reason: 'not-object', enabled: false, window: { ...DEFAULT_DND_WINDOW }, rejected: ['*'] };
    }
    const rejected = [];
    let enabled = false;
    if ('enabled' in obj && obj.enabled !== null && obj.enabled !== undefined) {
        if (typeof obj.enabled === 'boolean') enabled = obj.enabled;
        else rejected.push('enabled');
    }
    const win = (obj.window && typeof obj.window === 'object') ? obj.window : null;
    const start = numOrNull(win && win.start);
    const end = numOrNull(win && win.end);
    let window = { ...DEFAULT_DND_WINDOW };
    if (win) {
        if (start === null) rejected.push('window.start');
        if (end === null) rejected.push('window.end');
        if (start !== null && (start < 0 || start > 23)) rejected.push('window.start');
        if (end !== null && (end < 0 || end > 23)) rejected.push('window.end');
    }
    if (!rejected.length) window = { start: start, end: end };
    return {
        state: rejected.length ? SCHEDULE_STATES.invalid : SCHEDULE_STATES.stored,
        reason: rejected.length ? 'field-rejected' : 'ok',
        enabled: enabled, window: window, rejected: rejected
    };
}

/**
 * 写免打扰时段（唯一写口）。写失败**不静默**：回 `ok:false` 让调用方把「没落盘」说出来。
 */
export async function writeDndSchedule(storage, patch) {
    const p = (patch && typeof patch === 'object') ? patch : {};
    const cur = readDndSchedule(storage);
    const start = numOrNull(p.start !== undefined ? p.start : cur.window.start);
    const end = numOrNull(p.end !== undefined ? p.end : cur.window.end);
    const rejected = [];
    if (start === null || start < 0 || start > 23) rejected.push('window.start');
    if (end === null || end < 0 || end > 23) rejected.push('window.end');
    if (rejected.length) return { ok: false, rejected: rejected, saved: null };
    const next = {
        enabled: (p.enabled === undefined) ? cur.enabled === true : p.enabled === true,
        window: { start: Math.round(start), end: Math.round(end) }
    };
    if (!storage || typeof storage.set !== 'function') return { ok: false, rejected: ['no-storage'], saved: null };
    try {
        await storage.set(DND_SCHEDULE_KEY, JSON.stringify(next));
    } catch (e) {
        return { ok: false, rejected: ['write-threw'], saved: null, detail: String((e && e.message) || e || '') };
    }
    return { ok: true, rejected: [], saved: next };
}

/**
 * 回执汇总（**唯一口径**：回执账与通知中心视图都调它）。
 * 三态：`empty`（一条都没挡）/ `holds`（挡下了，逐原因计数）/ `unreadable`（账读不到）。
 */
export function summarizeReceipts(rows, opts) {
    const o2 = (opts && typeof opts === 'object') ? opts : {};
    if (!Array.isArray(rows)) return { face: 'unreadable', total: null, byReason: null, line: '回执账读不到' };
    const nowMs = numOrNull(o2.nowMs) === null ? Date.now() : numOrNull(o2.nowMs);
    const hours = numOrNull(o2.hours) === null ? 24 : numOrNull(o2.hours);
    const since = nowMs - hours * 3600 * 1000;
    const inWin = rows.filter((r) => r && numOrNull(r.at) !== null && r.at >= since);
    if (!inWin.length) {
        return { face: 'empty', total: 0, byReason: {}, line: '最近 ' + hours + ' 小时没有通知被挡下' };
    }
    const byReason = {};
    inWin.forEach((r) => {
        const keys = (Array.isArray(r.reasons) && r.reasons.length) ? r.reasons : ['unknown'];
        keys.forEach((k) => { byReason[k] = (byReason[k] || 0) + 1; });
    });
    const label = {
        dnd: '免打扰', silent: '静默档', 'unknown-tier': '未标档位',
        'dnd-window-invalid': '时段配置坏了', 'pierced-dnd': '穿透免打扰',
        'dnd-disabled': '免打扰未开', 'outside-window': '不在时段内'
    };
    const parts = Object.keys(byReason).map((k) => (label[k] || k) + ' ' + byReason[k] + ' 条');
    return {
        face: 'holds',
        total: inWin.length,
        byReason: byReason,
        line: '最近 ' + hours + ' 小时挡下 ' + inWin.length + ' 条（' + parts.join(' · ') + '）'
    };
}

/**
 * 挡下回执账（环形，内存态）。
 * 「有回执」的意思是：用户能回答「刚才挡下了几条、为什么」。
 */
export function createDeliveryLedger(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const limit = Math.max(1, numOrNull(o.limit) === null ? 50 : Math.round(numOrNull(o.limit)));
    const rows = [];
    return {
        /** 记一条挡下（只记 center 结论的，banner 不算挡下）。 */
        record(decision, extra) {
            const d = (decision && typeof decision === 'object') ? decision : null;
            if (!d) return null;
            if (d.deliver !== DELIVERY.center) return null;
            const e = extra && typeof extra === 'object' ? extra : {};
            const row = {
                at: numOrNull(e.at) === null ? Date.now() : numOrNull(e.at),
                tier: String(d.tier || 'normal'),
                reasons: Array.isArray(d.reasons) ? d.reasons.slice() : [],
                title: String(e.title || '').slice(0, 80),
                appId: String(e.appId || '')
            };
            rows.push(row);
            while (rows.length > limit) rows.shift();
            return row;
        },
        list() { return rows.slice(); },
        clear() { rows.length = 0; },
        /**
         * 最近 N 小时的挡下汇总。
         * `empty`（一条都没挡）/ `holds`（挡下了，逐原因计数）/ `unreadable`（账本身读不到）
         * 三态**不同形** —— 「什么都没挡」与「不知道挡了没有」不是一件事。
         */
        summary(opts2) { return summarizeReceipts(rows, opts2); }
    };
}

/**
 * 诊断页用的面：三档行为表 + 当前时段读数 + 三档各算一遍 + 回执汇总。
 * 关键：三档**逐档真算**（用 decideDelivery），不是把表复述一遍。
 */
export function notifyTierFace(storage, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const sched = readDndSchedule(storage);
    const hour = numOrNull(o.hour);
    const dndEnabled = (o.dndEnabled === undefined) ? sched.enabled : o.dndEnabled === true;
    const rows = NOTIFY_TIERS.map((tier) => {
        const d = decideDelivery({ tier: tier, dndEnabled: dndEnabled, hour: hour, window: sched.window, pierceUrgent: o.pierceUrgent === true });
        return {
            tier: tier,
            label: TIER_TABLE[tier].label,
            banner: TIER_TABLE[tier].banner,
            center: TIER_TABLE[tier].center,
            note: TIER_TABLE[tier].note,
            deliver: d.deliver,
            reasons: d.reasons,
            dndFace: d.dnd.face
        };
    });
    const ledger = o.ledger && typeof o.ledger.summary === 'function' ? o.ledger : null;
    return {
        schedule: sched,
        dndEnabled: dndEnabled,
        hour: hour,
        rows: rows,
        receipts: ledger ? ledger.summary({ hours: o.hours, nowMs: o.nowMs }) : { face: 'unreadable', total: null, byReason: null, line: '没有回执账（宿主未创建）' },
        line: notifyTierText({ schedule: sched, rows: rows })
    };
}

/** 一行总述（设置页与诊断卡共用）。 */
export function notifyTierText(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f || !f.schedule) return '通知分级：读不到（没有面）';
    const s = f.schedule;
    const win = s.window ? (String(s.window.start) + ':00–' + String(s.window.end) + ':00') : '--';
    if (s.state === SCHEDULE_STATES.unreadable) return '通知分级：免打扰时段读不到（' + String(s.reason || '') + '）—— 现在按默认时段 ' + win + ' 判，不是你设的那份';
    if (s.state === SCHEDULE_STATES.invalid) return '通知分级：时段取值不合法已回退默认（' + (s.rejected || []).join('、') + '）';
    const head = (s.state === SCHEDULE_STATES.absent)
        ? ('通知分级：还没设置过时段，按默认 ' + win + ' 判')
        : ('通知分级：免打扰' + (s.enabled ? '已开' : '未开') + ' · ' + win);
    return head + ' · 重要/普通/静默三档行为不同形（静默只进中心）';
}

export default {
    NOTIFY_TIERS, TIER_TABLE, DELIVERY, DND_SCHEDULE_KEY, DEFAULT_DND_WINDOW, SCHEDULE_STATES,
    tierOf, decideDelivery, readDndSchedule, writeDndSchedule,
    createDeliveryLedger, summarizeReceipts, notifyTierFace, notifyTierText
};
