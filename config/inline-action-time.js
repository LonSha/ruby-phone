/* ========================================================
 * config/inline-action-time.js — [v4.113.0 · R13-X3] 一句话里的时间线索
 * --------------------------------------------------------
 * 【为何拆出来】主件同时管「认时间」「认意向」「剔词成标题」「挑草稿」「总装候选」，
 *   实测 10829 字节，超了 X3 给的 9K 预算。而时间解析是其中**最容易被改**的一块
 *   （用户会不断提「下周六」「月底」「下个月初」这类说法），改它不该去读总装逻辑；
 *   反过来改阈值与双重门槛也不必看跨月进位。
 *
 * 【它只回答「什么时候」，不回答「该不该办】
 *   返回 `{dateKey, time, hasTime, vague}` 四个字段，**不下任何办不办的决定**。
 *   决定权在主件（双重门槛）—— 两件事混在一起时，改阈值会动到日期算术，
 *   而日期算术出错的形式是「日程落在错的一天」，用户当场看不出。
 *
 * 【三条纪律】
 *   ① 算不出就是空串，**不拿今天充数**（那是替用户编了一个日子）；
 *   ② 模糊说法（改天 / 过两天）一旦命中，**一律不许填日期**（只能进备忘档）；
 *   ③ 一律用**剧情当下**算星期与相对日，不用墙钟（本仓两个钟，混用会把同一场雨落在两个时刻）。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
import {
    INLINE_ACTION_LIMITS, INLINE_ACTION_WEEKDAY_CHARS,
    INLINE_ACTION_TIME_RULES, INLINE_ACTION_VAGUE_WORDS
} from './inline-action-terms.js';

/** 编译一次，运行期不再 new RegExp（每条都编，等于把成本放在渲染路径上）。
 *  导出给主件：剔词成标题也要用同一张表 —— 两处各编一份就会「算得出日子、却删不掉那个字」。 */
export const RULES = INLINE_ACTION_TIME_RULES.map((r) => ({ ...r, rx: new RegExp(r.re) }));

/** 两位补零（日期键与时刻都用它，只此一份）。 */
function p2(n) { return String(Number(n)).padStart(2, '0'); }

/**
 * 毫秒 → 日期键 `YYYY-MM-DD`（**本地时间**，与日历的 dateKey 同口径）。
 * 读不出可用时刻 ⇒ 空串（不拿今天充数：那是替用户编了一个日子）。
 */
export function dateKeyOf(ms) {
    const n = numOrNull(ms);
    if (n === null || n <= 0) return '';
    const d = new Date(n);
    if (!Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/** 日期键加天数（用 Date 进位，不手写跨月判断）。 */
export function addDaysToKey(key, days) {
    const parts = String(key || '').split('-');
    if (parts.length !== 3) return '';
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isFinite(d.getTime())) return '';
    d.setDate(d.getDate() + Number(days || 0));
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/** 中文数字 → 阿拉伯（只覆盖 0..59，够钟点用；超出范围一律 null 不猜）。 */
const CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
export function cnNumber(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    if (s === '十') return 10;
    if (s.length === 1) return Object.prototype.hasOwnProperty.call(CN_DIGIT, s) ? CN_DIGIT[s] : null;
    if (s.length === 2 && s[0] === '十') {
        const one = CN_DIGIT[s[1]];
        return one === undefined ? null : (10 + one);
    }
    if (s.length === 2 && s[1] === '十') {
        const ten = CN_DIGIT[s[0]];
        return ten === undefined ? null : (ten * 10);
    }
    if (s.length === 3 && s[1] === '十') {
        const a = CN_DIGIT[s[0]];
        const b = CN_DIGIT[s[2]];
        return (a === undefined || b === undefined) ? null : (a * 10 + b);
    }
    return null;
}

/** 时刻归一：把「晚上八点半」这类拼成 `HH:MM`；拼不出 ⇒ 空串（不编）。 */
function clockText(prefix, hourRaw, tail) {
    let h = cnNumber(hourRaw);
    if (h === null || h < 0 || h > 24) return '';
    let m = 0;
    if (tail === '半') m = 30;
    else if (tail === '一刻') m = 15;
    else if (tail === '三刻') m = 45;
    const p = String(prefix || '');
    if ((p === '下午' || p === '晚上') && h < 12) h += 12;
    if (p === '中午' && h < 11) h += 12;
    if (h > 23) return '';
    return p2(h) + ':' + p2(m);
}

/**
 * 从一句话里取时间线索。
 * @returns {{dateKey:string, time:string, hasTime:boolean, vague:boolean}}
 *   · `dateKey` 空串 ⇒ 算不出具体日子（只能进备忘档）；
 *   · `vague:true` ⇒ 句子里有「改天 / 过两天」这类说法，**不许**填日期。
 */
export function pickTime(text, now) {
    const s = String(text == null ? '' : text);
    const out = { dateKey: '', time: '', hasTime: false, vague: false };
    for (const w of INLINE_ACTION_VAGUE_WORDS) {
        if (s.includes(w)) { out.vague = true; out.hasTime = true; break; }
    }
    const todayKey = dateKeyOf(now && now.storyMs);
    /* 相对天：今 / 明 / 后 / 大后天（**先长后短**，否则「大后天」会被「后天」抢走）。 */
    const dayRule = RULES.find((r) => r.name === 'day');
    const dayHit = dayRule ? dayRule.rx.exec(s) : null;
    if (dayHit) {
        out.hasTime = true;
        const word = dayHit[1];
        const off = (word === '今天' || word === '今日') ? 0
            : (word === '明天' || word === '明日') ? 1
                : (word === '后天') ? 2 : 3;
        if (todayKey && !out.vague) out.dateKey = addDaysToKey(todayKey, off);
    }
    const eveHit = RULES.find((r) => r.name === 'eve').rx.exec(s);
    if (eveHit) {
        out.hasTime = true;
        /* 今晚 / 明晚只补时刻，不覆盖已算出的日期（「明天晚上」两句都在时以日期为准）。 */
        if (!out.time) out.time = '20:00';
    }
    const wdHit = RULES.find((r) => r.name === 'weekday').rx.exec(s);
    if (wdHit) {
        out.hasTime = true;
        const ch = wdHit[2];
        const target = Object.prototype.hasOwnProperty.call(INLINE_ACTION_WEEKDAY_CHARS, ch)
            ? INLINE_ACTION_WEEKDAY_CHARS[ch] : null;
        if (target !== null && todayKey && !out.vague) {
            /* 今天星期几：从**剧情当下**算，不从墙钟算（本仓两个钟，混用会把同一场雨落在两个时刻）。 */
            const base = new Date(numOrNull(now && now.storyMs) || 0);
            const cur = Number.isFinite(base.getTime()) ? base.getDay() : null;
            if (cur !== null) {
                let delta = (target - cur + 7) % 7;
                const nextWeek = String(wdHit[1] || '') === '下';
                if (nextWeek && delta === 0) delta = 7;
                if (delta > INLINE_ACTION_LIMITS.maxDaysAhead) delta = delta - 7;
                if (delta >= 0) out.dateKey = addDaysToKey(todayKey, delta);
            }
        }
    }
    const clockHit = RULES.find((r) => r.name === 'clock').rx.exec(s);
    if (clockHit) {
        const h = Number(clockHit[1]);
        const mi = Number(clockHit[2]);
        if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
            out.hasTime = true;
            if (!out.time) out.time = p2(h) + ':' + p2(mi);
        }
    }
    const pointHit = RULES.find((r) => r.name === 'point').rx.exec(s);
    if (pointHit) {
        const t = clockText(pointHit[1], pointHit[2], pointHit[3] || '');
        if (t) { out.hasTime = true; if (!out.time) out.time = t; }
    }
    return out;
}

/** 剔掉所有时间词（主件拿它做标题；本件是这张表的唯一主人）。 */
export function stripTimeWords(text) {
    let s = String(text == null ? '' : text);
    for (const r of RULES) s = s.replace(new RegExp(r.re, 'g'), ' ');
    for (const w of INLINE_ACTION_VAGUE_WORDS) s = s.split(w).join(' ');
    return s;
}
