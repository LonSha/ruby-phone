/* ========================================================
 * config/time-format.js — [R25-X4] 时区 / 12-24 小时制 / 日期格式的单一真源
 * --------------------------------------------------------
 * 【它要治的缺陷】
 *   同一个时刻在全仓被四种写法各算一遍：
 *     · 状态栏：`phone-shell.getCurrentTime()` 自己拼 `String(h).padStart(2,'0')`（永远 24 小时制）；
 *     · 消息戳：微信自己 `toLocaleTimeString()`（跟随浏览器 locale，桌面与手机可能不同）；
 *     · 日记/日历日期：各自 `getMonth()+1` 拼字符串（月日顺序各家不同）；
 *     · 剧情钟：上游给的是「剧情时刻」，与墙钟时区没有任何换算关系。
 *   于是「用户设了 12 小时制」这件事在界面上只影响他自己看到的某一处；
 *   跨时区会话里，同一条消息在两台机器上显示两个时间。
 *
 * 【本模块只做四件事】
 *   ① 三个**闭集**：`HOUR_CYCLES`（h24/h12）/ `DATE_STYLES`（ymd/mdy/dmy/cn）/ `TIMEZONE_MODES`（system/utc/fixed）；
 *   ② `readFormatSettings(storage)` —— 四态（stored / absent / invalid / unreadable）；
 *   ③ `formatClock/formatDate/composeMoment` —— **同一毫秒 + 同一设置**得到同一串（纯函数，不读时钟）；
 *   ④ `timeFormatMatrix()` —— 四组合逐格，供诊断页把「每一格长什么样」摆出来（不是口述）。
 *
 * 【为什么不用 `Intl` 自动本地化】
 *   本仓判据要在 Node 与浏览器两种环境复现，而 `Intl` 的输出随 ICU 版本变；
 *   更要紧的是：**用户选的格式必须压过浏览器 locale**（否则「改了没变」）。
 *   所以这里只做确定性换算：先按 `zone` 把毫秒换成「当地墙上时间」，再按闭集渲染。
 *
 * 【纪律】
 *   · 时区读不到（`system` 但没给 offset）⇒ `unreadable`，**不许**悄悄按 UTC 算 ——
 *     那是「拿一个读者不知道的时区冒充答案」；
 *   · 非法值逐项点名并回退默认，不许被 `||` 吞掉。
 * ============================================================ */
'use strict';

/* 数值取值门：全仓唯一实现（`Number(null) === 0` 这类塔陷不入本模块）。 */
import { numOrNull } from './num-gate.js';

/** 12/24 小时制（闭集）。 */
export const HOUR_CYCLES = Object.freeze(['h24', 'h12']);
/** 日期顺序（闭集）。`cn` 是中文习惯「2026年11月18日」。 */
export const DATE_STYLES = Object.freeze(['ymd', 'mdy', 'dmy', 'cn']);
/** 时区来源（闭集）。 */
export const TIMEZONE_MODES = Object.freeze(['system', 'utc', 'fixed']);

export const FORMAT_STORAGE_KEY = 'sys_time_format';

export const DEFAULT_FORMAT = Object.freeze({
    hourCycle: 'h24',
    dateStyle: 'ymd',
    zone: 'system',
    /* `fixed` 档用的偏移：**分钟**，东为正（UTC+8 ⇒ 480）。 */
    zoneOffsetMinutes: 0
});

export const FORMAT_STATES = Object.freeze({
    stored: 'stored',
    absent: 'absent',
    invalid: 'invalid',
    unreadable: 'unreadable'
});

function isOneOf(list, v) { return list.indexOf(v) >= 0; }

/**
 * 归一：逐项拒收非法值并点名（不做「静默回默认」—— 那会让用户以为自己改成功了）。
 * @returns {{settings:object, rejected:string[]}}
 */
export function normalizeFormat(raw) {
    const out = { ...DEFAULT_FORMAT };
    const rejected = [];
    if (!raw || typeof raw !== 'object') return { settings: out, rejected: rejected };
    if ('hourCycle' in raw && raw.hourCycle != null) {
        if (isOneOf(HOUR_CYCLES, raw.hourCycle)) out.hourCycle = raw.hourCycle;
        else rejected.push('hourCycle');
    }
    if ('dateStyle' in raw && raw.dateStyle != null) {
        if (isOneOf(DATE_STYLES, raw.dateStyle)) out.dateStyle = raw.dateStyle;
        else rejected.push('dateStyle');
    }
    if ('zone' in raw && raw.zone != null) {
        if (isOneOf(TIMEZONE_MODES, raw.zone)) out.zone = raw.zone;
        else rejected.push('zone');
    }
    if ('zoneOffsetMinutes' in raw && raw.zoneOffsetMinutes != null) {
        const n = Number(raw.zoneOffsetMinutes);
        if (Number.isFinite(n) && Math.abs(n) <= 14 * 60) out.zoneOffsetMinutes = Math.round(n);
        else rejected.push('zoneOffsetMinutes');
    }
    return { settings: out, rejected: rejected };
}

/**
 * 读设置。
 * @param {{get?:Function}} storage
 */
export function readFormatSettings(storage) {
    if (!storage || typeof storage.get !== 'function') {
        return { state: FORMAT_STATES.unreadable, reason: 'no-storage', settings: { ...DEFAULT_FORMAT }, rejected: [] };
    }
    let raw;
    try { raw = storage.get(FORMAT_STORAGE_KEY); }
    catch (e) {
        return { state: FORMAT_STATES.unreadable, reason: 'read-threw', detail: String((e && e.message) || e || ''), settings: { ...DEFAULT_FORMAT }, rejected: [] };
    }
    if (raw === null || raw === undefined || raw === '') {
        return { state: FORMAT_STATES.absent, reason: 'never-set', settings: { ...DEFAULT_FORMAT }, rejected: [] };
    }
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (_e) {
            return { state: FORMAT_STATES.invalid, reason: 'unparsable', settings: { ...DEFAULT_FORMAT }, rejected: ['*'] };
        }
    }
    if (!obj || typeof obj !== 'object') {
        return { state: FORMAT_STATES.invalid, reason: 'not-object', settings: { ...DEFAULT_FORMAT }, rejected: ['*'] };
    }
    const n = normalizeFormat(obj);
    return {
        state: n.rejected.length ? FORMAT_STATES.invalid : FORMAT_STATES.stored,
        reason: n.rejected.length ? 'field-rejected' : 'ok',
        settings: n.settings, rejected: n.rejected
    };
}

/**
 * 解出「当地墙上时间」。
 * @param {number} ms 时刻（毫秒）
 * @param {object} settings
 * @param {{systemOffsetMinutes?:number}} env 仅 `zone==='system'` 时需要
 * @returns {{ok:boolean, reason?:string, y?:number, mo?:number, d?:number, h?:number, mi?:number, wd?:number}}
 */
export function wallClockOf(ms, settings, env) {
    const s = settings && typeof settings === 'object' ? settings : DEFAULT_FORMAT;
    /* `null` / `''` 与 `0` 必须区分：前者是「没给时刻」，后者是 1970。 */
    const t = numOrNull(ms);
    if (t === null) return { ok: false, reason: 'bad-moment' };
    let offset;
    if (s.zone === 'utc') offset = 0;
    else if (s.zone === 'fixed') {
        const fixed = numOrNull(s.zoneOffsetMinutes);
        if (fixed === null) return { ok: false, reason: 'no-fixed-offset' };
        offset = fixed;
    }
    else {
        const sys = numOrNull(env && env.systemOffsetMinutes);
        if (sys === null) {
            /* 「系统时区」但拿不到系统偏移 ⇒ 读不到。**不许**按 UTC 顶上去：
             *   那会让所有时间整体偏 8 小时，而界面上看不出任何异常。 */
            return { ok: false, reason: 'no-system-offset' };
        }
        offset = sys;
    }
    const local = new Date(t + offset * 60000);
    return {
        ok: true, offsetMinutes: offset,
        y: local.getUTCFullYear(), mo: local.getUTCMonth() + 1, d: local.getUTCDate(),
        h: local.getUTCHours(), mi: local.getUTCMinutes(), wd: local.getUTCDay()
    };
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * 把 `HH:MM` 文本按 12/24 制重排（供状态栏这类「上游已经给了文本」的地方复用）。
 * 为什么要接受文本入口：状态栏的时钟来自剧情钟/墙钟双源，形如 `21:05`；
 * 强制它先变成毫秒再格式化，等于把「剧情钟不是真时刻」这件事掩盖掉。
 */
export function formatClockText(text, settings) {
    const raw = String(text == null ? '' : text).trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return raw;   /* 不是可识别时钟文本：原样返回，不猜 */
    const s = settings && typeof settings === 'object' ? settings : DEFAULT_FORMAT;
    let h = Number(m[1]);
    const mi = Number(m[2]);
    if (!Number.isFinite(h) || h < 0 || h > 23) return raw;
    if (s.hourCycle === 'h12') {
        const suffix = h < 12 ? 'AM' : 'PM';
        let hh = h % 12;
        if (hh === 0) hh = 12;
        return hh + ':' + pad2(mi) + ' ' + suffix;
    }
    return pad2(h) + ':' + pad2(mi);
}

/** 时刻 → 时钟串（`h12` 带 AM/PM）。 */
export function formatClock(ms, settings, env) {
    const w = wallClockOf(ms, settings, env);
    if (!w.ok) return { ok: false, reason: w.reason, text: '' };
    const s = settings || DEFAULT_FORMAT;
    if (s.hourCycle === 'h12') {
        const suffix = w.h < 12 ? 'AM' : 'PM';
        let hh = w.h % 12;
        if (hh === 0) hh = 12;
        return { ok: true, text: hh + ':' + pad2(w.mi) + ' ' + suffix };
    }
    return { ok: true, text: pad2(w.h) + ':' + pad2(w.mi) };
}

/**
 * 年月日三元组 → 日期串（**唯一实现**，`formatDate` 也走这里）。
 * 为什么要单独有「传三元组」的入口：剧情钟/日记/日程上游给的是「年月日」而不是毫秒，
 * 硬要它们先拼成毫秒再格式化，等于把「剧情年份可能不是公元」这件事糊掉。
 */
export function formatDateParts(parts, dateStyle) {
    const p = parts && typeof parts === 'object' ? parts : {};
    const y = Number(p.year);
    const mo = Number(p.month);
    const d = Number(p.day);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const Y = String(Math.round(y));
    const M = pad2(Math.round(mo));
    const D = pad2(Math.round(d));
    const style = isOneOf(DATE_STYLES, dateStyle) ? dateStyle : 'ymd';
    if (style === 'mdy') return M + '/' + D + '/' + Y;
    if (style === 'dmy') return D + '/' + M + '/' + Y;
    if (style === 'cn') return Y + '年' + Math.round(mo) + '月' + Math.round(d) + '日';
    return Y + '-' + M + '-' + D;
}

/**
 * 同年省略年份的短日期（会话列表这类「一屏很多行」的地方用）。
 * 跨年时不省——否则「01-05」到底是今年还是去年读者无从判断。
 */
export function formatShortDay(parts, dateStyle, currentYear) {
    const full = formatDateParts(parts, dateStyle);
    if (full === null) return null;
    const y = Number(parts.year);
    const cy = Number(currentYear);
    const sameYear = Number.isFinite(cy) ? (Math.round(y) === Math.round(cy)) : true;
    if (!sameYear) return full;
    const M = pad2(Math.round(Number(parts.month)));
    const D = pad2(Math.round(Number(parts.day)));
    const style = isOneOf(DATE_STYLES, dateStyle) ? dateStyle : 'ymd';
    if (style === 'mdy') return M + '/' + D;
    if (style === 'dmy') return D + '/' + M;
    if (style === 'cn') return Math.round(Number(parts.month)) + '月' + Math.round(Number(parts.day)) + '日';
    return M + '-' + D;
}

/** 时刻 → 日期串（四种顺序各自成形）。 */
export function formatDate(ms, settings, env) {
    const w = wallClockOf(ms, settings, env);
    if (!w.ok) return { ok: false, reason: w.reason, text: '' };
    const s = settings || DEFAULT_FORMAT;
    return { ok: true, text: formatDateParts({ year: w.y, month: w.mo, day: w.d }, s.dateStyle) };
}

/**
 * 一个时刻在各产品面上的**同一份投影**（状态栏 / 消息戳 / 日记 / 日程 / 锁屏）。
 * 五处共用同一个 `ms` 与同一份设置 ⇒ 它们不可能互相不一致（这是结构保证，不是检查）。
 */
export function composeMoment(ms, settings, env) {
    const clock = formatClock(ms, settings, env);
    const date = formatDate(ms, settings, env);
    if (!clock.ok || !date.ok) {
        return { ok: false, reason: clock.reason || date.reason, surfaces: null };
    }
    const stamp = date.text + ' ' + clock.text;
    return {
        ok: true,
        surfaces: {
            statusBar: clock.text,
            chatStamp: clock.text,
            lockscreenSummary: stamp,
            diaryDate: date.text,
            calendarDate: date.text,
            stamp: stamp
        }
    };
}

/**
 * 四组合矩阵（诊断页逐格展示用）：`hourCycle × dateStyle`，时区按当前设置。
 * 每一格都是**真算出来**的，不是文案（判据会对同一 ms 逐格比对）。
 */
export function timeFormatMatrix(ms, settings, env) {
    const base = settings && typeof settings === 'object' ? settings : DEFAULT_FORMAT;
    const rows = [];
    for (const hourCycle of HOUR_CYCLES) {
        for (const dateStyle of DATE_STYLES) {
            const s = { ...base, hourCycle, dateStyle };
            const m = composeMoment(ms, s, env);
            rows.push({
                hourCycle, dateStyle,
                ok: m.ok,
                reason: m.ok ? null : m.reason,
                clock: m.ok ? m.surfaces.statusBar : null,
                date: m.ok ? m.surfaces.diaryDate : null
            });
        }
    }
    return rows;
}

/**
 * 本机 UTC 偏移（分钟，东为正）。读不到返回 null（**不**返回 0 —— 0 是「UTC」这个具体时区）。
 */
export function systemOffsetMinutes(atMs) {
    const given = numOrNull(atMs);
    const t = given === null ? Date.now() : given;
    const d = new Date(t);
    if (!d || typeof d.getTimezoneOffset !== 'function') return null;
    const off = d.getTimezoneOffset();
    if (!Number.isFinite(off)) return null;
    return -off;
}

/**
 * 诊断页用的「读回对拍」面：把设置、逐格矩阵、五面投影一次性摆出来。
 * 关键设计：`projectionUnreadable` 与「投影为空」不同形 ——
 * 前者说明「这个时区下算不出来」，后者说明「没算」。
 */
export function timeFormatFace(storage, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const read = readFormatSettings(storage);
    const sysGiven = numOrNull(o.systemOffsetMinutes);
    const sysRaw = sysGiven === null ? systemOffsetMinutes(o.atMs) : sysGiven;
    const env = (numOrNull(sysRaw) === null) ? {} : { systemOffsetMinutes: sysRaw };
    const givenMs = numOrNull(o.atMs);
    const atMs = givenMs === null ? Date.now() : givenMs;
    const moment = composeMoment(atMs, read.settings, env);
    const face = {
        state: read.state,
        reason: read.reason,
        detail: read.detail || null,
        rejected: Array.isArray(read.rejected) ? read.rejected.slice() : [],
        settings: { ...read.settings },
        env,
        atMs,
        projection: moment.ok ? moment.surfaces : null,
        projectionUnreadable: moment.ok ? null : moment.reason,
        matrix: timeFormatMatrix(atMs, read.settings, env),
        line: timeFormatText(read)
    };
    return face;
}

/**
 * 「写了」≠「生效」：拿真源里的设置与**界面最后一次真用**的那份对拍。
 * @param {object} face   `timeFormatFace()` 的结果（真源侧）
 * @param {object} receipt 宿主侧痕迹（状态栏最后一次渲染时的设置 + 渲染出的文本）
 * 三态：same / mismatch / unknown —— unknown 与 same **不同形**（没读到不等于一致）。
 */
export function judgeTimeFormatApplied(face, receipt) {
    if (!face || typeof face !== 'object') {
        return { state: 'unknown', reason: 'no-face', diff: [], line: '读不到时间格式面，无法对拍' };
    }
    if (!receipt || typeof receipt !== 'object') {
        return {
            state: 'unknown', reason: 'no-receipt', diff: [],
            line: '状态栏还没渲染过（或宿主未留痕迹）—— 这是「没读到」，**不是**「一致」'
        };
    }
    const want = face.settings || {};
    const got = receipt.settings || {};
    const diff = ['hourCycle', 'dateStyle', 'zone'].filter((k) => want[k] !== got[k]);
    return {
        state: diff.length ? 'mismatch' : 'same',
        reason: diff.length ? 'differs' : 'ok',
        diff,
        at: receipt.at || null,
        rendered: receipt.text || null,
        appliedHourCycle: got.hourCycle || null,
        line: diff.length
            ? ('状态栏最后用的是另一份设置（不一致：' + diff.join('、') + '）')
            : '状态栏最后一次渲染与存的一致'
    };
}

/** 一行总述（设置页与诊断卡共用；四态不同形）。 */
export function timeFormatText(face) {
    if (!face || !face.state) return '时间格式：读不到（没有面）';
    if (face.state === FORMAT_STATES.unreadable) {
        return '时间格式：设置读不到（' + String(face.reason || '') + '）— 界面用的是内置默认，**不是**你选的那份';
    }
    const s = face.settings || DEFAULT_FORMAT;
    const zone = s.zone === 'system' ? '系统时区' : (s.zone === 'utc' ? 'UTC' : ('UTC' + (s.zoneOffsetMinutes >= 0 ? '+' : '') + (s.zoneOffsetMinutes / 60) + ' 时'));
    const head = face.state === FORMAT_STATES.invalid
        ? ('时间格式：有 ' + face.rejected.join('、') + ' 取值不合法已回退默认')
        : (face.state === FORMAT_STATES.absent ? '时间格式：还没设置过（24 小时制 · 年-月-日）' : '时间格式：已设置');
    return head + '：' + (s.hourCycle === 'h12' ? '12 小时制' : '24 小时制') + ' · ' + s.dateStyle + ' · ' + zone;
}

export default {
    HOUR_CYCLES, DATE_STYLES, TIMEZONE_MODES, FORMAT_STORAGE_KEY, DEFAULT_FORMAT, FORMAT_STATES,
    normalizeFormat, readFormatSettings, wallClockOf, formatClockText,
    systemOffsetMinutes, formatDateParts, formatShortDay,
    formatClock, formatDate, composeMoment, timeFormatMatrix, timeFormatFace, judgeTimeFormatApplied, timeFormatText
};