/* ========================================================
 * usage-tracker.js — [v3.15.0] 使用统计采集内核（计划 #52）
 * --------------------------------------------------------
 * 动机：计划 #52「使用统计面板：展示每日使用时长 / 最常用功能 / 访问热点」。
 *   ★ 取证先于动手：本仓此前**没有任何使用面记录** —— 全仓对 `phone:openApp`
 *   只有路由消费（`index.js` 那一个 `addEventListener`），没有一处记「谁被打开过、
 *   待了多久、集中在哪个时段」。故本版先建**采集面**（本文件），再建展示面
 *   （`apps/usage/`）；顺序反过来的话，统计只能编。
 *
 * 三条纪律（与 config/rollback-preview.js / diagnose 同规）：
 *   ① 单一读写门：本模块是 `usage_stats_v1` 的**唯一读写口**。采集点（`index.js`
 *      的 `phone:openApp` 咽喉点）只调 `trackerNote` / `trackerClose`，
 *      自己绝不碰 storage —— 否则「谁在写这个键」就没有答案了；
 *   ② 不抛：采集跑在**每次开 App 的热路径**上，任何异常一律吞掉并返回原读数
 *      （与 config/system-notifications.js 的落账层同规）；
 *   ③ 不猜：读数畸形 / 未知字段一律按「没给」处理，**不补 0 冒充真实读数**
 *      —— 0 分钟与「没有记录」是两件不同的事，塌成同形是本仓最贵的形态。
 *
 * ★ 边界（本版的诚实登记，不在别处重复声明）：
 *   · **时长是两次开 App 之间的间隔，不是真实前台驻留时间** —— 扩展拿不到宿主的
 *     前台/后台信号（见 docs/runtime-verification-boundary.md 的同类登记）。
 *     故单次访问按 `USAGE_MAX_VISIT_MS` 封顶：把手机开着不管，不会把一个 App
 *     算成「用了一整天」。
 *   · 本模块**只记次数 / 时长 / 时段**，不记任何内容（不记消息、不记操作、不记输入）。
 *     「访问热点」是 **0–23 时的时段分布**，不是点击坐标，也不是页面路径。
 * ======================================================== */

/** 使用统计的 storage 键（会话隔离，见 config/storage.js 的 `/^usage_/`）。 */
export const USAGE_KEY = 'usage_stats_v1';

/** 保留天数：超出即裁剪最旧的日子（防 chatMetadata 长线膨胀）。 */
export const USAGE_MAX_DAYS = 60;

/** 单次访问时长上限（4 小时）：超时视为「挂着没关」，按上限记。 */
export const USAGE_MAX_VISIT_MS = 4 * 60 * 60 * 1000;

/** 空读数。`open` 是「当前还开着的那次访问」（进程重启后靠它续上时长）。 */
function emptyUsage() {
    return { version: 1, days: {}, open: null };
}

/** 本地日历日键（YYYY-MM-DD）。刻意用本地时区：用户看到的「今天」是本地今天。 */
export function usageDayKey(at) {
    const d = new Date(typeof at === 'number' && Number.isFinite(at) ? at : Date.now());
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function asFiniteInt(v) {
    return (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.trunc(v)) : 0;
}

/**
 * 形态归一：把任意来源的读数收成**结构恒定**的对象。
 * 坏字段按「没给」处理（不抛、不补 0 造假），未知字段一律丢弃。
 */
export function normalizeUsage(raw) {
    const out = emptyUsage();
    if (!raw || typeof raw !== 'object') return out;
    const days = (raw.days && typeof raw.days === 'object') ? raw.days : {};
    for (const key of Object.keys(days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        const d = days[key];
        if (!d || typeof d !== 'object') continue;
        const day = { apps: {}, hours: {}, ms: 0, count: 0 };
        const apps = (d.apps && typeof d.apps === 'object') ? d.apps : {};
        for (const id of Object.keys(apps)) {
            const a = apps[id];
            if (!a || typeof a !== 'object') continue;
            const cell = { count: asFiniteInt(a.count), ms: asFiniteInt(a.ms) };
            if (cell.count === 0 && cell.ms === 0) continue;
            day.apps[String(id)] = cell;
            day.ms += cell.ms;
            day.count += cell.count;
        }
        const hours = (d.hours && typeof d.hours === 'object') ? d.hours : {};
        for (const h of Object.keys(hours)) {
            const hn = Number(h);
            if (!Number.isInteger(hn) || hn < 0 || hn > 23) continue;
            const c = asFiniteInt(hours[h]);
            if (c > 0) day.hours[String(hn)] = c;
        }
        out.days[key] = day;
    }
    const o = raw.open;
    if (o && typeof o === 'object' && typeof o.appId === 'string' && o.appId
        && typeof o.at === 'number' && Number.isFinite(o.at)) {
        out.open = { appId: o.appId, at: o.at };
    }
    return pruneUsage(out);
}

/** 裁剪到 `USAGE_MAX_DAYS` 天（按键排序取最新，字典序即时间序）。 */
export function pruneUsage(usage) {
    const keys = Object.keys(usage.days).sort();
    if (keys.length <= USAGE_MAX_DAYS) return usage;
    const drop = keys.slice(0, keys.length - USAGE_MAX_DAYS);
    for (const k of drop) delete usage.days[k];
    return usage;
}

function dayOf(usage, key) {
    if (!usage.days[key]) usage.days[key] = { apps: {}, hours: {}, ms: 0, count: 0 };
    return usage.days[key];
}

/**
 * 结算「还开着的那次访问」。返回被结算的 `{appId, ms}` 或 null。
 * 时长 = now - open.at，负值与超上限一律按 `USAGE_MAX_VISIT_MS` 封顶/归零：
 * 时钟跳变（宿主改时间 / 跨时区）不该产生一条负时长，更不该产生一条天文数字。
 */
export function settleOpen(usage, at) {
    const o = usage.open;
    usage.open = null;
    if (!o || typeof o.appId !== 'string' || !o.appId) return null;
    const from = (typeof o.at === 'number' && Number.isFinite(o.at)) ? o.at : null;
    if (from === null) return null;
    let ms = at - from;
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    if (ms > USAGE_MAX_VISIT_MS) ms = USAGE_MAX_VISIT_MS;
    return { appId: o.appId, ms };
}

/**
 * 记一次「打开」。**每次开 App 只有这一个入口** —— 它先结算上一次访问的时长，
 * 再把本次挂成 open。返回新读数（不落盘，落盘是 trackerNote 的事）。
 */
export function noteOpen(usage, appId, at) {
    const now = (typeof at === 'number' && Number.isFinite(at)) ? at : Date.now();
    const closed = settleOpen(usage, now);
    if (closed) recordVisit(usage, closed.appId, closed.ms, now);
    const id = String(appId || '');
    if (!id) return usage;
    usage.open = { appId: id, at: now };
    // 次数在**打开时**即计：只记时长会让「开了一下就关」的 App 完全消失。
    applyVisit(usage, id, 0, now, true);
    return usage;
}

/** 记一次「回桌面 / 关闭」。只结算时长，不改变 open。 */
export function noteClose(usage, at) {
    const now = (typeof at === 'number' && Number.isFinite(at)) ? at : Date.now();
    const closed = settleOpen(usage, now);
    if (closed) recordVisit(usage, closed.appId, closed.ms, now);
    return usage;
}

function applyVisit(usage, appId, ms, at, countVisit) {
    const day = dayOf(usage, usageDayKey(at));
    const cell = day.apps[appId] || (day.apps[appId] = { count: 0, ms: 0 });
    if (countVisit) cell.count += 1;
    if (ms > 0) { cell.ms += ms; day.ms += ms; }
    if (countVisit) day.count += 1;
    const h = String(new Date(at).getHours());
    day.hours[h] = asFiniteInt(day.hours[h]) + 1;
}

/** 落一条已结算的访问时长（次数已在 noteOpen 计过，故此处只加时长与时段）。 */
export function recordVisit(usage, appId, ms, at) {
    const id = String(appId || '');
    if (!id) return usage;
    applyVisit(usage, id, ms, at, false);
    return usage;
}

/* ---------------- 投影（展示面用的纯函数，不碰 storage） ---------------- */

/** 最常用功能：按「次数」降序（并列按时长），返回前 n 项。 */
export function topApps(usage, n = 5) {
    const agg = new Map();
    for (const key of Object.keys(usage.days)) {
        const apps = usage.days[key].apps;
        for (const id of Object.keys(apps)) {
            const cur = agg.get(id) || { id: id, count: 0, ms: 0 };
            cur.count += apps[id].count;
            cur.ms += apps[id].ms;
            agg.set(id, cur);
        }
    }
    return [...agg.values()]
        .sort((a, b) => (b.count - a.count) || (b.ms - a.ms) || (a.id < b.id ? -1 : 1))
        .slice(0, Math.max(0, n));
}

/** 每日使用时长：最近 days 天（从旧到新），**无记录的日子如实为 null 而非 0**。 */
export function dailyRows(usage, days = 7) {
    const out = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const key = usageDayKey(d.getTime());
        const rec = usage.days[key];
        out.push({
            key: key,
            label: (d.getMonth() + 1) + '/' + d.getDate(),
            ms: rec ? asFiniteInt(rec.ms) : null,
            count: rec ? asFiniteInt(rec.count) : null
        });
    }
    return out;
}

/** 访问热点：0–23 时的打开次数（无记录的时段为 0 次是**真实读数**：那个点没开过）。 */
export function hourHeat(usage) {
    const buckets = new Array(24).fill(0);
    for (const key of Object.keys(usage.days)) {
        const hours = usage.days[key].hours;
        for (const h of Object.keys(hours)) {
            const hn = Number(h);
            if (Number.isInteger(hn) && hn >= 0 && hn <= 23) buckets[hn] += asFiniteInt(hours[hn]);
        }
    }
    return buckets.map((count, hour) => ({ hour: hour, count: count }));
}

/** 总述读数。无任何记录时 `empty: true`（视图据此说「还没有记录」，不说「0 分钟」）。 */
export function usageSummary(usage) {
    let totalMs = 0;
    let totalCount = 0;
    const keys = Object.keys(usage.days).sort();
    for (const k of keys) {
        totalMs += asFiniteInt(usage.days[k].ms);
        totalCount += asFiniteInt(usage.days[k].count);
    }
    const top = topApps(usage, 1)[0] || null;
    return {
        empty: keys.length === 0,
        activeDays: keys.length,
        totalMs: totalMs,
        totalCount: totalCount,
        topApp: top ? top.id : null,
        firstDay: keys.length ? keys[0] : null,
        lastDay: keys.length ? keys[keys.length - 1] : null
    };
}

/** 时长可读化（本模块内共用，避免三处各写一套）。 */
export function formatDuration(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0 分钟';
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 1) return '不到 1 分钟';
    if (totalMin < 60) return totalMin + ' 分钟';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? (h + ' 小时 ' + m + ' 分钟') : (h + ' 小时');
}

/* ---------------- 读写门（唯一碰 storage 的地方） ---------------- */

/** 读门：拿不到/畸形一律返回空读数（**不抛**，也不退回上一次的读数）。 */
export function readUsage(storage) {
    try {
        const raw = storage?.get?.(USAGE_KEY, null);
        let obj = raw;
        if (typeof raw === 'string') {
            try { obj = JSON.parse(raw); } catch (_e) { obj = null; }
        }
        return normalizeUsage(obj);
    } catch (_e) {
        return emptyUsage();
    }
}

function writeUsage(storage, usage) {
    try {
        storage?.set?.(USAGE_KEY, JSON.stringify(usage));
    } catch (_e) { /* 采集失败绝不阻断开 App */ }
}

/**
 * 采集点唯一入口：记一次「打开」。**绝不抛**——它跑在 `phone:openApp` 热路径上。
 * @returns {boolean} 是否成功落盘（失败不影响开 App，调用方也不该据此做分支）
 */
export function trackerNote(storage, appId, at) {
    try {
        const usage = readUsage(storage);
        noteOpen(usage, appId, at);
        writeUsage(storage, usage);
        return true;
    } catch (_e) { return false; }
}

/** 采集点唯一入口：记一次「回桌面 / 关闭实例」。绝不抛。 */
export function trackerClose(storage, at) {
    try {
        const usage = readUsage(storage);
        noteClose(usage, at);
        writeUsage(storage, usage);
        return true;
    } catch (_e) { return false; }
}

/** 采集面自检：给诊断/测试用，回答「这个键现在放得下吗」。 */
export function usageSelfCheck(storage) {
    const usage = readUsage(storage);
    const summary = usageSummary(usage);
    return { ok: true, key: USAGE_KEY, days: summary.activeDays, open: usage.open ? usage.open.appId : null };
}
