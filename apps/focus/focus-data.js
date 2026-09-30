/* ========================================================
 * focus-data.js — [v3.21.0] 番茄钟 App 纯函数内核
 *
 * 缝合自 EPhone·xINOVO（js/modules/pomodoro.js）的「专注」玩法。
 * 只取**逻辑与数据模型**，持久化一律改走 PhoneStorage：
 *   源文件把任务写在全局对象 db.pomodoroTasks 上并 await saveData()，
 *   本仓没有 db / saveData，所有读数由 App 层从 storage 取出后传进来。
 * 本文件保持纯函数、无副作用、不碰 DOM、不碰 window（与 clock-data 同规格）。
 * ======================================================== */

/** 两种计时语义。倒计时到点自动完成；正计时一直往上走，手动停止才算一次。 */
export const FOCUS_MODES = Object.freeze({
    countdown: 'countdown',
    stopwatch: 'stopwatch',
});

/**
 * 归因常量（「这个界面凭什么说这句话」）。
 * 形状与 clock-data 的 CLOCK_REASONS 同族：**值**是连字符形，视图文案表的键必须取这里的值。
 */
export const FOCUS_REASONS = Object.freeze({
    ready: 'ready',                     // 有任务在列表里
    no_tasks: 'no-tasks',               // 一条任务都没有
    storage_absent: 'storage-absent',   // storage 不可用（宿主没给或取数抛错）
});

/** 常用时长档（分钟）。源是 15/25/45/60 + 自定义，此处保留同样的四档。 */
export const DURATION_PRESETS = Object.freeze([15, 25, 45, 60]);

export const DEFAULT_FOCUS_SETTINGS = Object.freeze({
    mode: FOCUS_MODES.countdown,
    duration: 25,
    encouragementMinutes: 25,
    pokeLimit: 5,
    dailyGoalMinutes: 120,
    injectToPrompt: true,
});

/** 全新一份默认设置（冻结，防被就地改）。 */
export function defaultFocusSettings() {
    return Object.freeze({ ...DEFAULT_FOCUS_SETTINGS });
}

function boundedInt(v, fallback, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const r = Math.round(n);
    return Math.min(max, Math.max(min, r));
}

/**
 * 设置规范化：外部数据（存档里读出来的、用户手改的）一律先过这里。
 * 「读不出就如实回落默认」——不把 NaN / 负数 / 字符串混进运行时。
 */
export function normalizeFocusSettings(raw) {
    const d = DEFAULT_FOCUS_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        mode: (o.mode === FOCUS_MODES.stopwatch) ? FOCUS_MODES.stopwatch : FOCUS_MODES.countdown,
        duration: boundedInt(o.duration, d.duration, 1, 1440),
        encouragementMinutes: boundedInt(o.encouragementMinutes, d.encouragementMinutes, 1, 1440),
        pokeLimit: boundedInt(o.pokeLimit, d.pokeLimit, 0, 999),
        dailyGoalMinutes: boundedInt(o.dailyGoalMinutes, d.dailyGoalMinutes, 1, 1440),
        injectToPrompt: o.injectToPrompt !== false,
    });
}

/**
 * 任务规范化。
 * 名称为空即判为无效（返回 null，由调用方丢弃）——源文件用 alert 拦「请输入任务名称」，
 * 本仓没有 alert，改为在数据层就地拒绝，坏数据不进列表。
 */
export function normalizeTask(raw, now) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const name = (typeof o.name === 'string') ? o.name.trim() : '';
    if (!name) return null;
    const createdAt = Number.isFinite(o.createdAt) ? o.createdAt : (Number.isFinite(now) ? now : 0);
    const id = (typeof o.id === 'string' && o.id)
        ? o.id
        : ('focus_' + createdAt + '_' + Math.random().toString(36).slice(2, 8));
    return Object.freeze({
        id,
        name,
        mode: (o.mode === FOCUS_MODES.stopwatch) ? FOCUS_MODES.stopwatch : FOCUS_MODES.countdown,
        duration: boundedInt(o.duration, DEFAULT_FOCUS_SETTINGS.duration, 1, 1440),
        createdAt,
    });
}

/** 一次已完成专注的记录（源里的「专注记录」证书内容即由此渲染）。 */
export function normalizeSession(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const seconds = Number(o.seconds);
    if (!Number.isFinite(seconds) || seconds === 0) return null;
    const abs = Math.abs(seconds);
    return Object.freeze({
        taskId: (typeof o.taskId === 'string') ? o.taskId : '',
        name: (typeof o.name === 'string') ? o.name : '',
        seconds: Math.round(abs),
        pokes: boundedInt(o.pokes, 0, 0, 999),
        finishedAt: Number.isFinite(o.finishedAt) ? o.finishedAt : 0,
    });
}

/**
 * 读数归因（storage 探针 → 三态）。
 * 与 clock 的 readClockFace 同纪律：**先判能不能读，再判读到了什么**。
 */
export function readFocusFace(probe) {
    if (!probe || probe.storageOk === false) return FOCUS_REASONS.storage_absent;
    if (!Array.isArray(probe.tasks) || probe.tasks.length === 0) return FOCUS_REASONS.no_tasks;
    return FOCUS_REASONS.ready;
}

function pad2(n) { return n < 10 ? ('0' + n) : String(n); }

/** 本地日键（YYYY-MM-DD）。用本地时区切天，跨零点算新的一天。 */
export function dayKey(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/**
 * 统计聚合（投影）。
 * 读不到就如实给 0 / null，**不编数**（例如没有历史时 avgSessionSeconds 给 0，
 * 而不是拿 0 除出个 NaN 冒充「平均 0 分钟」）。
 */
export function projectFocusStats(sessions, now) {
    const arr = (Array.isArray(sessions) ? sessions : [])
        .map(normalizeSession)
        .filter(Boolean);
    const totalSessions = arr.length;
    const totalSeconds = arr.reduce((s, x) => s + x.seconds, 0);
    const nowMs = Number.isFinite(now) ? now : Date.now();
    const todayK = dayKey(nowMs);

    let todaySeconds = 0;
    let todaySessions = 0;
    const perDay = new Map();
    for (const x of arr) {
        const k = dayKey(x.finishedAt);
        if (!k) continue;
        perDay.set(k, (perDay.get(k) || 0) + x.seconds);
        if (k === todayK) { todaySeconds += x.seconds; todaySessions += 1; }
    }

    // 连续专注天数：从今天起往回数；今天还没开工则从昨天起算（早上看时不该显示 0）。
    const daySet = new Set(perDay.keys());
    let streakDays = 0;
    let cursor = nowMs;
    if (!daySet.has(todayK)) cursor = nowMs - 86400000;
    while (daySet.has(dayKey(cursor))) {
        streakDays += 1;
        cursor -= 86400000;
    }

    let bestDaySeconds = 0;
    for (const v of perDay.values()) bestDaySeconds = Math.max(bestDaySeconds, v);

    const latest = totalSessions ? arr[totalSessions - 1] : null;

    return {
        totalSessions,
        totalSeconds,
        todaySeconds,
        todaySessions,
        streakDays,
        bestDaySeconds,
        avgSessionSeconds: totalSessions ? Math.round(totalSeconds / totalSessions) : 0,
        latest,
        hasHistory: totalSessions > 0,
    };
}

/** 人类可读时长（视图与注入块共用一份口径）。 */
export function formatDuration(seconds) {
    const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h !== 0) return h + ' 小时 ' + m + ' 分';
    if (m !== 0) return sec !== 0 ? (m + ' 分 ' + sec + ' 秒') : (m + ' 分');
    return sec + ' 秒';
}

/**
 * 「专注记录」一行的文案（源里转发到聊天框的那句）。
 * 只在视图里显示，不写进任何角色会话 —— 本仓不替用户发消息。
 */
export function focusRecordLine(session) {
    const s = normalizeSession(session);
    if (!s) return '';
    const name = s.name ? ('「' + s.name + '」') : '';
    return '专注' + name + ' ' + formatDuration(s.seconds) + ' · 期间分心 ' + s.pokes + ' 次';
}

/**
 * 生成侧注入块。
 * 只给**事实**（最近一次专注 / 今日累计 / 连续天数 / 今日目标进度），
 * 不给角色台词模板 —— 让模型自己决定要不要接话，避免每次注固定台词。
 */
export function focusPromptBlock(stats, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!stats || stats.hasHistory !== true) return '';
    const parts = [];
    if (stats.latest) {
        parts.push('【最近专注】' + (stats.latest.name ? ('「' + stats.latest.name + '」 ') : '') + formatDuration(stats.latest.seconds));
    }
    parts.push('【今日累计】' + formatDuration(stats.todaySeconds) + '（' + stats.todaySessions + ' 次）');
    if (stats.streakDays > 1) parts.push('【连续】' + stats.streakDays + ' 天');
    const goal = settings.dailyGoalMinutes * 60;
    if (goal !== 0) {
        const pct = Math.min(100, Math.round(stats.todaySeconds * 100 / goal));
        parts.push('【今日目标】' + pct + '%（' + settings.dailyGoalMinutes + ' 分钟）');
    }
    return '【系统·番茄钟】\n' + parts.join('\n');
}
