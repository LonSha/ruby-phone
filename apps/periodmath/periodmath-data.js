/* ========================================================
 * periodmath-data.js — [v3.51.0] 周期数学案头 · 纯函数内核
 *
 * 源是 MyPhone 生理期模块（period.js 819 行）的**周期计算一族**：
 * 有效窗均值（周期 15~60 天 / 经期 2~14 天双有效窗，异常样本不进均值）、
 * 四相判定（月经期 / 卵泡期 / 排卵期 / 黄体期，排卵窗=周期中点±2）、
 * 三形倒计时（距下次 N 天 / 预计今天 / 已延期 N 天）、临近预警（≤3 天每日一次）。
 *
 * 立场差：源把周期挂 IndexedDB（PhoneSimPeriod）、建议走 callLLM 生成，
 * 本件零数据库零 AI，只做「这段周期记录算出什么」的判定与读数；
 * 会话键走 ^pm_ 前缀随会话隔离。
 * ======================================================== */
'use strict';

export const PM_CYCLE_MIN = 15;
export const PM_CYCLE_MAX = 60;
export const PM_PERIOD_MIN = 2;
export const PM_PERIOD_MAX = 14;
export const PM_ALERT_WINDOW = 3;
export const PM_DAY_MS = 24 * 60 * 60 * 1000;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function numOrNull(v) { const n = (typeof v === 'number') ? v : Number(v); return Number.isFinite(n) ? n : null; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* 天数差（源 dayDiff）：按日历日对齐（同日为 0）。 */
export function dayDiff(t1, t2) {
    const a = numOrNull(t1); const b = numOrNull(t2);
    if (a === null || b === null) return null;
    const d1 = Math.floor(a / PM_DAY_MS);
    const d2 = Math.floor(b / PM_DAY_MS);
    return d2 - d1;
}
/* 周期记录归一：start 必有、end 可无（进行中）。 */
export function normalizeCycle(raw, index) {
    const r = isPlain(raw) ? raw : {};
    const start = numOrNull(r.start);
    if (start === null) return { cycle: null, why: 'no_start' };
    const end = numOrNull(r.end);
    return { cycle: { id: toStr(r.id) || ('pm_c_' + String(index + 1)), start: start, end: (end !== null && end >= start) ? end : null, symptoms: listOf(r.symptoms).map(toStr).filter(Boolean) }, why: '' };
}

/* 记录册归一：按 start 倒序（最新在前，源同款口径），坏条单列。 */
export function normalizeCycles(raw) {
    const out = { cycles: [], rejected: [], notes: [] };
    for (let i = 0; i < listOf(raw).length; i++) {
        const r = normalizeCycle(listOf(raw)[i], i);
        if (!r.cycle) { out.rejected.push({ index: i, why: r.why }); continue; }
        out.cycles.push(r.cycle);
    }
    out.cycles.sort(function (a, b) { return b.start - a.start; });
    return out;
}

/* 有效窗均值（源 recalcAverages 逐条对齐）：
 *   周期长 = 相邻两次 start 的日差，15~60 天内才进均值；
 *   经期长 = start..end+1 的天数，2~14 天内才进均值（含最旧一条）；
 *   样本不足（<2 条）如实报 not_enough，不许拿缺省值冒充。 */
export function averagesOf(cycles, prevSettings) {
    const st = isPlain(prevSettings) ? prevSettings : {};
    const out = { cycleLength: numOrNull(st.cycleLength) || 28, periodLength: numOrNull(st.periodLength) || 5, cycleSamples: 0, periodSamples: 0, enough: false };
    const arr = listOf(cycles);
    let totalCycle = 0; let validCycles = 0; let totalPeriod = 0; let validPeriods = 0;
    for (let i = 0; i < arr.length - 1; i++) {
        const curr = arr[i]; const prev = arr[i + 1];
        const cd = dayDiff(prev.start, curr.start);
        if (cd !== null && cd >= PM_CYCLE_MIN && cd <= PM_CYCLE_MAX) { totalCycle += cd; validCycles++; }
        if (curr.end !== null) {
            const pd = dayDiff(curr.start, curr.end) + 1;
            if (pd >= PM_PERIOD_MIN && pd <= PM_PERIOD_MAX) { totalPeriod += pd; validPeriods++; }
        }
    }
    const oldest = arr[arr.length - 1];
    if (oldest && oldest.end !== null) {
        const pd = dayDiff(oldest.start, oldest.end) + 1;
        if (pd >= PM_PERIOD_MIN && pd <= PM_PERIOD_MAX) { totalPeriod += pd; validPeriods++; }
    }
    if (validCycles > 0) out.cycleLength = Math.round(totalCycle / validCycles);
    if (validPeriods > 0) out.periodLength = Math.round(totalPeriod / validPeriods);
    out.cycleSamples = validCycles; out.periodSamples = validPeriods;
    out.enough = arr.length >= 2;
    return out;
}
/* 状态判定（源 getStatus 逐支对齐）：
 *   无记录 → status none；最新一条无 end → 经期中（menstrual 第 N 天）；
 *   否则按 cycleLength 算下次：future（距 N 天）/ today（预计今天）/ overdue（已延期 N 天）；
 *   四相：经期 < periodLength；卵泡期 < 周期中点-2；排卵期 < 中点+2；其余黄体期。 */
export function statusOf(cycles, settings, nowMs) {
    const st = isPlain(settings) ? settings : {};
    const cycleLength = numOrNull(st.cycleLength) || 28;
    const periodLength = numOrNull(st.periodLength) || 5;
    const now = (typeof nowMs === 'number' && nowMs > 0) ? nowMs : 0;
    const arr = listOf(cycles);
    if (arr.length === 0) return { kind: 'none', isPeriod: false, days: 0, text: '无记录', phase: '' };
    const latest = arr[0];
    if (latest.end === null) {
        const d = (dayDiff(latest.start, now) || 0) + 1;
        return { kind: 'ongoing', isPeriod: true, days: d, text: '经期第 ' + String(d) + ' 天', phase: 'menstrual' };
    }
    const nextStart = latest.start + cycleLength * PM_DAY_MS;
    const diff = dayDiff(now, nextStart) || 0;
    const since = dayDiff(latest.start, now) || 0;
    let phase = 'luteal';
    if (since < periodLength) phase = 'menstrual';
    else if (since < cycleLength / 2 - 2) phase = 'follicular';
    else if (since < cycleLength / 2 + 2) phase = 'ovulation';
    if (diff > 0) return { kind: 'future', isPeriod: false, days: diff, text: '距下次约 ' + String(diff) + ' 天', phase: phase };
    if (diff === 0) return { kind: 'today', isPeriod: false, days: 0, text: '预计今天', phase: 'menstrual' };
    return { kind: 'overdue', isPeriod: false, days: -diff, text: '已延期 ' + String(-diff) + ' 天', phase: 'menstrual' };
}

/* 临近预警：非经期且 0~3 天内可警；alertedKey 是「今天已警过」的幂等键（日期串）。 */
export function alertGate(status, nowMs, alertedKey) {
    if (status.isPeriod || status.kind === 'none') return { alert: false, why: 'not_applicable' };
    if (status.kind !== 'future' || status.days > PM_ALERT_WINDOW) return { alert: false, why: 'not_in_window' };
    if (toStr(alertedKey) === toStr(nowMs === null ? '' : dayKeyOf(nowMs))) return { alert: false, why: 'already_alerted' };
    return { alert: true, why: '', key: dayKeyOf(nowMs) };
}

/* 日历日键（本地日期串，源 toDateString 口径等价）。 */
export function dayKeyOf(ms) {
    const n = numOrNull(ms);
    if (n === null) return '';
    const d = new Date(n);
    const pad = function (v) { return (v < 10 ? '0' : '') + v; };
    return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* 读数面。 */
export function readingsOf(cycles, settings, nowMs) {
    const arr = listOf(cycles);
    const avg = averagesOf(arr, settings);
    const st = statusOf(arr, settings, nowMs);
    let symptoms = 0;
    for (const c of arr) symptoms += listOf(c.symptoms).length;
    return { cycles: arr.length, cycleLength: avg.cycleLength, periodLength: avg.periodLength, cycleSamples: avg.cycleSamples, periodSamples: avg.periodSamples, enough: avg.enough, status: st, symptomCount: symptoms };
}