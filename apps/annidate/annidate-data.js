/* ========================================================
 * annidate-data.js — [v3.51.0] 纪念日数学案头 · 纯函数内核
 *
 * 源是 MyPhone 纪念日模块（anniversary.js 682 行）的**日期数学一族**：
 * 三形天数（已过去 N 天 / 距目标还有 N 天 / 就是今天）、
 * 四类提醒（当天 / 前一天 / 每年当天 / 每年前一天，周年数>0 才算）、
 * 星座表（month/day → 十二星座，分界表逐月）、今日已警幂等。
 *
 * 立场差：源挂 IndexedDB + DOM 轮播（setInterval 5 秒换星标项），
 * 本件零数据库零定时器，只做「这个日期算出什么」的判定与读数；
 * 会话键走 ^ad_ 前缀随会话隔离。
 * ======================================================== */
'use strict';
/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前自带一份 `numOrNull`，形态是「先给 number 放行、其余一律 `Number(v)`」——
 *   它把上游**没给**这一格读成了有效值：`null → 0`、`'' → 0`、`'  ' → 0`、`[] → 0`、
 *   `false → 0`、`true → 1`、`[5] → 5`。0 在这里是**合法读数**（第 0 分钟、第 0 天），
 *   于是「没给」与「给了 0」在同一个读数上塌在一起 —— 而两者处置相反。 */
import { numOrNull } from '../../config/num-gate.js';
export const AD_DAY_MS = 24 * 60 * 60 * 1000;
export const AD_ZODIAC_CUTS = Object.freeze([20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22]);
export const AD_ZODIAC_SIGNS = Object.freeze(['摩羯座', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座']);

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

export function dayStartOf(ms) { return Math.floor(numOrNull(ms) / AD_DAY_MS) * AD_DAY_MS; }

/* 三形天数（源 updateWidget 的 diffDays 三分支）。 */
export function daysOf(targetMs, nowMs) {
    const t = dayStartOf(targetMs); const n = dayStartOf(nowMs);
    const diff = Math.floor((n - t) / AD_DAY_MS);
    if (diff > 0) return { diff: diff, form: 'past', text: '已经过去' };
    if (diff < 0) return { diff: diff, form: 'future', text: '距离目标还有', abs: -diff };
    return { diff: 0, form: 'today', text: '就是今天' };
}

/* 星座（源 getZodiac 逐月分界表）。 */
export function zodiacOf(month, day) {
    const m = numOrNull(month); const d = numOrNull(day);
    if (m === null || d === null || m < 1 || m > 12 || d < 1 || d > 31) return '';
    return (d < AD_ZODIAC_CUTS[m - 1]) ? AD_ZODIAC_SIGNS[m - 1] : AD_ZODIAC_SIGNS[m];
}
/* 条目归一：date 必有、reminders 四开关、isStarred 幂等布尔。 */
export function normalizeItem(raw, index) {
    const r = isPlain(raw) ? raw : {};
    const date = numOrNull(r.date);
    if (date === null) return { item: null, why: 'no_date' };
    const rem = isPlain(r.reminders) ? r.reminders : {};
    return {
        item: {
            id: toStr(r.id) || ('ad_i_' + String(index + 1)),
            title: toStr(r.title) || '未命名纪念日',
            date: date,
            isStarred: r.isStarred === true,
            reminders: { onDay: rem.onDay === true, dayBefore: rem.dayBefore === true, yearlyOnDay: rem.yearlyOnDay === true, yearlyDayBefore: rem.yearlyDayBefore === true },
            note: toStr(r.note)        },
        why: ''
    };
}

export function normalizeItems(raw) {
    const out = { items: [], rejected: [] };
    for (let i = 0; i < listOf(raw).length; i++) {
        const r = normalizeItem(listOf(raw)[i], i);
        if (!r.item) { out.rejected.push({ index: i, why: r.why }); continue; }
        out.items.push(r.item);
    }
    return out;
}

/* 同月同日判定（源 setFullYear 周年对齐法）。 */
function sameMonthDay(aMs, bMs) {
    const a = new Date(aMs); const b = new Date(bMs);
    return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/* 四类提醒判定（源 checkNotifications 逐支对齐）：
 *   onDay：目标日=今天；dayBefore：目标日=明天；
 *   yearlyOnDay：今年同月同日=今天且已过 ≥1 周年；yearlyDayBefore：今年同月同日=明天且已过 ≥1 周年。 */
export function matchReminders(item, nowMs) {
    const out = [];
    const it = isPlain(item) ? item : {};
    const rem = isPlain(it.reminders) ? it.reminders : {};
    const target = dayStartOf(it.date);
    const today = dayStartOf(nowMs);
    const tomorrow = today + AD_DAY_MS;
    if (rem.onDay && target === today) out.push({ kind: 'onDay', years: 0, text: '今天是你设置的【' + toStr(it.title) + '】！' });
    if (rem.dayBefore && target === tomorrow) out.push({ kind: 'dayBefore', years: 0, text: '明天就是【' + toStr(it.title) + '】啦，不要忘记哦！' });
    const years = new Date(today).getFullYear() - new Date(target).getFullYear();
    if (rem.yearlyOnDay && sameMonthDay(target, today) && years > 0) out.push({ kind: 'yearlyOnDay', years: years, text: '今天是【' + toStr(it.title) + '】' + String(years) + '周年纪念日！' });
    if (rem.yearlyDayBefore && sameMonthDay(target, tomorrow) && years > 0) out.push({ kind: 'yearlyDayBefore', years: years, text: '明天是【' + toStr(it.title) + '】' + String(years) + '周年纪念日，准备一下吧！' });
    return out;
}

/* 当日幂等门：同一日历日同一批条目只警一次（源 anni_notified_日期键）。 */
export function alertOnce(matches, dayKey, lastKey) {
    if (!matches.length) return { alert: false, why: 'no_match' };
    if (toStr(lastKey) === toStr(dayKey)) return { alert: false, why: 'already_alerted' };
    return { alert: true, why: '', key: toStr(dayKey) };
}

/* 读数面：星标数与最近一个纪念日。 */
export function readingsOf(items, nowMs) {
    const arr = listOf(items);
    let starred = 0;
    for (const it of arr) if (it && it.isStarred) starred++;
    return { items: arr.length, starred: starred };
}