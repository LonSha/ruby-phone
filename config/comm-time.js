/* ========================================================
 * comm-time.js — [v4.49.0 · 第六期 R6-O2] 通信时间解析（纯件）
 * --------------------------------------------------------
 * 【为什么单独一件】R6-O2 要把三处痕迹汇成一段交流，而**三处的时间形状各不相同**：
 *   · wechat 会话带 `timestamp`（毫秒数）；
 *   · 短信消息带 `createdAt`（毫秒数）；
 *   · **通话记录只带文本** —— `date: '2026年10月22日'` + `time: '14:30'`
 *     （见 apps/phone/phone-data.js 的 addCallRecord 契约注释）。
 *   没有这一件，「漏接来电」根本进不了交流读数（它连不上时间轴）——
 *   而漏接恰恰是 R6-O2 最不能丢的那一格。
 *
 * 【本件的诚实面：读不出就是 null，绝不补「现在」】
 *   补 now 会把「三天前没接到的电话」读成「刚刚漏接」，是最离谱的错读数
 *   （与 config/contact-insight.js 的「读不到 ≠ 0」同族：那里补 0 会算成
 *   「55 年没联系」，这里补 now 会算成「刚刚发生」——两个方向的同一族假读数）。
 *   本件被点名的判据是 C 面：解析不出必须 null，且调用方不得回落。
 *
 * 【口径：只接受明确的年月日 + 时:分】
 *   缺年时可以补**故事年**（调用方传入，属显式参数而非猜），缺月/日/时/分一律 null；
 *   非法月日（13 月、2 月 30 日）一律 null，不静默归一成邻日。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';

/** 月天表（闰年规则与 Date 同源；不引第三方）。 */
function daysInMonth(year, month) {
    if (month === 2) {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        return leap ? 29 : 28;
    }
    return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
/**
 * 解析「年月日」文本。
 * 接受：`2026年10月22日` / `2026-10-22` / `2026/10/22` / `10月22日`（缺年）。
 * @returns {{year:number|null, month:number, day:number}|null} 读不出返回 null。
 */
export function parseCommDate(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;
    const m = s.match(/^(?:(\d{1,6})\s*(?:年|[-/.])\s*)?(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?$/);
    if (!m) return null;
    const yearRaw = m[1];
    const month = Number.parseInt(m[2], 10);
    const day = Number.parseInt(m[3], 10);
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    if (year !== null) {
        if (!Number.isInteger(year) || year < 1) return null;
        if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
    } else if (!Number.isInteger(day) || day < 1 || day > 31) {
        return null;
    }
    return { year: year, month: month, day: day };
}
/**
 * 解析「时:分」文本。接受 `14:30` / `14：30` / `9:05`。
 * @returns {{hour:number, minute:number}|null}
 */
export function parseCommClock(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
    if (!m) return null;
    const hour = Number.parseInt(m[1], 10);
    const minute = Number.parseInt(m[2], 10);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    return { hour: hour, minute: minute };
}
/**
 * 合成毫秒戳（通话记录那一格的真入口）。
 * @param {string} dateText 年月日文本（可为空 —— 空则用 fallback 的年月日）
 * @param {string} timeText 时:分文本
 * @param {{year?:number, month?:number, day?:number, tzOffsetMinutes?:number}} fallback
 *        故事日（date 缺年或缺整日时补；**属显式参数，不是猜**）
 * @returns {number|null} 读不出返回 null（**绝不回落成现在**）
 */
export function parseCommStamp(dateText, timeText, fallback) {
    const fb = (fallback && typeof fallback === 'object') ? fallback : {};
    const clock = parseCommClock(timeText);
    if (!clock) return null;
    const d = parseCommDate(dateText);
    let year = d ? d.year : null;
    let month = d ? d.month : null;
    let day = d ? d.day : null;
    if (year === null) {
        const fy = numOrNull(fb.year);
        if (d) {
            /* 有月日缺年：补故事年（补不到就 null —— 不假装是今年） */
            if (fy === null) return null;
            year = fy;
            if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
        } else {
            /* 整日都缺：用故事日补（仍是显式参数） */
            const fm = numOrNull(fb.month);
            const fd = numOrNull(fb.day);
            if (fy === null || fm === null || fd === null) return null;
            if (fm < 1 || fm > 12 || fd < 1 || fd > daysInMonth(fy, fm)) return null;
            year = fy; month = fm; day = fd;
        }
    }
    try {
        const ms = new Date(year, month - 1, day, clock.hour, clock.minute, 0, 0).getTime();
        return Number.isFinite(ms) ? ms : null;
    } catch (_e) { return null; }
}
/**
 * 从通话记录条目取毫秒戳（本件唯一被 App 直接消费的入口）。
 * ★ 只用记录自己的 date/time；`record.timestamp` 若存在且是真数则优先
 *   （有些来源会带），但**读不出就是 null**，绝不补 now。
 * @param {object} record 通话记录条目（apps/phone/phone-data.js 的形状）
 * @param {object} fallback 故事日
 */
export function stampOfCall(record, fallback) {
    const r = (record && typeof record === 'object' && !Array.isArray(record)) ? record : {};
    const ts = numOrNull(r.timestamp);
    if (ts !== null && ts > 0) return ts;
    return parseCommStamp(r.date, r.time, fallback);
}
/* ---------- 自检（三项形态纪律） ---------- */
export function commTimeSelfCheck() {
    const problems = [];
    if (parseCommDate('2026年10月22日') === null) problems.push('中文年月日读不出');
    if (parseCommDate('2026-10-22') === null) problems.push('横线年月日读不出');
    if (parseCommDate('2025年2月30日') !== null) problems.push('非法月日必须 null');
    if (parseCommDate('13月1日') !== null) problems.push('非法月必须 null');
    if (parseCommClock('24:00') !== null) problems.push('非法小时必须 null');
    if (parseCommClock('14:70') !== null) problems.push('非法分钟必须 null');
    if (parseCommStamp('', '', null) !== null) problems.push('全空必须 null（绝不补现在）');
    if (parseCommStamp('2026年10月22日', '14:30', null) === null) problems.push('完整时间读不出');
    const needYear = parseCommStamp('3月5日', '09:00', null);
    if (needYear !== null) problems.push('缺年且无故事年必须 null');
    const withYear = parseCommStamp('3月5日', '09:00', { year: 2026 });
    if (withYear === null) problems.push('缺年补故事年后应读得出');
    const call = stampOfCall({ date: '2026年10月22日', time: '08:05', status: 'missed' }, null);
    if (call === null) problems.push('通话记录文本时间读不出');
    const bad = stampOfCall({ date: '', time: '', status: 'missed' }, null);
    if (bad !== null) problems.push('通话记录读不出时必须 null');
    return { ok: problems.length === 0, problems: problems };
}