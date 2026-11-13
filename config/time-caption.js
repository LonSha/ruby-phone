/* ============================================================
 * config/time-caption.js —— v4.142.0 · 第二十一期批次 A · R21-O5
 *   「玩家可见时间文案的统一口径」唯一实现。
 *
 * 【本文件回答的问题】
 *   同一个时刻，有的展示位显示剧情日期，有的显示「刚刚」这类墙钟相对量；
 *   剧情回拨后两套文案会同时在场并互相矛盾。本文件给所有要显示时间的
 *   地方一个唯一出口：字段属于哪个钟，由 config/time-source.js 的
 *   fieldClockOf 闭集说了算（这里不抄第二份名单）；文案只按归属出牌。
 *
 * 【三条纪律（判据 tests/system-v4142.test.mjs 逐条看守）】
 *   ① story 档文案只从剧情 face 的日期/时刻字符串来。face 缺席就拒答
 *      （no-story-face），绝不拿墙钟日历把剧情时间戳硬格式化成「现在」的模样。
 *   ② wall 档出相对量（刚刚 / N 分钟前 / N 小时前 / N 天前），锚点用
 *      time-source 的 wallNow()，本文件不裸取机器时刻。
 *   ③ 跨档比较一律拒答：relTextOf 两侧钟不同 ⇒ cross-clock；
 *      story 档被要求按墙钟算相对量（ctx.relNow）⇒ cross-clock。
 *      拒答必须给非空原因码与可读说明，不许硬算一个看起来合理的差值。
 *
 * 【诚实边界】
 *   调用方拿到 ok:false 时必须自己决定展示什么占位（时间不详 / 空着），
 *   本文件不替调用方编一个「看起来对」的时刻。
 * ============================================================ */
'use strict';
import { fieldClockOf, wallNow } from './time-source.js';
import { numOrNull } from './num-gate.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* 拒答形态：ok=false + 非空原因码 + 非空可读说明（「拒答」本身必须是可判别的值）。 */
function refuse(clock, reason, note) {
    return { ok: false, clock, reason, text: String(note || reason) };
}

/* 相对量文案：只对墙钟档使用（锚点 base 必须与 ms 同钟）。 */
function relText(ms, base) {
    const rel = Math.max(0, base - ms);
    if (rel < MINUTE) return '刚刚';
    if (rel < HOUR) return String(Math.floor(rel / MINUTE)) + '分钟前';
    if (rel < DAY) return String(Math.floor(rel / HOUR)) + '小时前';
    return String(Math.floor(rel / DAY)) + '天前';
}

/**
 * 玩家可见时间文案的统一出口。
 * @param {string} field 字段名（走 fieldClockOf 闭集；未登记 ⇒ 拒答 unknown-field）
 * @param {number|string} value 字段读数（story 档只配合 face 用；wall 档须是毫秒时刻）
 * @param {{face?:{date?:string,time?:string}, nowMs?:number, relNow?:boolean}} ctx
 *   face：剧情日期/时刻字符串（story 档文案唯一来源）；
 *   nowMs：墙钟锚点覆盖（判据注入用；缺省用 wallNow()）；
 *   relNow：显式要求「按墙钟算相对量」—— story 档收到这个要求一律 cross-clock 拒答。
 * @returns {{ok:boolean, clock:'story'|'wall'|null, reason:string, text:string}}
 */
export function captionOf(field, value, ctx = {}) {
    const clock = fieldClockOf(field);
    if (clock === null) return refuse(null, 'unknown-field', '（时间文案拒答：字段未登记时钟归属，闭集不猜）');
    if (clock === 'story') {
        if (ctx.relNow === true) return refuse(clock, 'cross-clock', '（跨档拒答：剧情时刻不能对着墙钟算相对量）');
        const face = (ctx.face && typeof ctx.face === 'object') ? ctx.face : null;
        const date = face ? String(face.date == null ? '' : face.date).trim() : '';
        const time = face ? String(face.time == null ? '' : face.time).trim() : '';
        if ((!date && !time) || /刚刚|分钟前|小时前|天前|时间不详/.test(date + time)) {
            return refuse(clock, 'no-story-face', '（剧情文案拒答：读不到剧情日期与时刻，不拿墙钟日历顶替）');
        }
        return { ok: true, clock, reason: '', text: [date, time].filter(Boolean).join(' ') };
    }
    /* wall 档：相对量。锚点与读数同钟（都是墙钟），这才允许算差。 */
    const ms = numOrNull(value);
    if (ms === null || ms <= 0) return refuse(clock, 'bad-value', '（时间文案拒答：墙钟读数不是可用时刻）');
    const rawBase = (ctx.nowMs === undefined) ? wallNow() : numOrNull(ctx.nowMs);
    if (rawBase === null || rawBase <= 0) return refuse(clock, 'bad-value', '（时间文案拒答：墙钟锚点不可用）');
    const base = rawBase;
    if (ms > base) return refuse(clock, 'future-value', '（时间文案拒答：读数晚于当前墙钟，不许倒着算）');
    return relTextOf(field, ms, field, base);
}

/**
 * 两个字段读数之间的相对量文案。**先验钟，再算差**：
 *   两侧任一字段未登记 ⇒ unknown-field；两侧钟不同 ⇒ cross-clock（本函数存在的意义）；
 *   两侧都是剧情档 ⇒ no-story-delta（剧情时刻差没有用户可读语义，不编）；
 *   两侧都是墙钟档 ⇒ 与 captionOf 的 wall 档同一套相对量文案。
 */
export function relTextOf(field, value, baseField, baseValue) {
    const clock = fieldClockOf(field);
    const baseClock = fieldClockOf(baseField);
    if (clock === null || baseClock === null) {
        return refuse(clock, 'unknown-field', '（时间文案拒答：字段未登记时钟归属，闭集不猜）');
    }
    if (clock !== baseClock) {
        return refuse(clock, 'cross-clock', '（跨档拒答：两个字段分属剧情钟与墙钟，不许硬算差值）');
    }
    if (clock === 'story') {
        return refuse(clock, 'no-story-delta', '（剧情档拒答：剧情时刻差值没有可读语义）');
    }
    const ms = numOrNull(value);
    const base = numOrNull(baseValue);
    if (ms === null || ms <= 0 || base === null || base <= 0) {
        return refuse(clock, 'bad-value', '（时间文案拒答：墙钟读数不是可用时刻）');
    }
    if (ms > base) return refuse(clock, 'future-value', '（时间文案拒答：读数晚于墙钟锚点）');
    return { ok: true, clock, reason: '', text: relText(ms, base) };
}
