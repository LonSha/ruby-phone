/* ============================================================
 * config/story-clock-fanout.js — [R25-X9] 剧情钟推进的**唯一联动面**
 * ------------------------------------------------------------
 * 【修之前的现场】
 *   钟一跳，四个面各算各的：
 *     · 会话列表时间戳 —— 走 chat-list-time 自己一套（R25-X4 已收口到 time-format）；
 *     · 日记日期       —— 走 formatDateParts；
 *     · 日程 / 日历日期 —— 走 formatDateParts（另一条路）；
 *     · 锁屏摘要       —— `phone/lock-screen.js:_nowParts()` 里 **`new Date()` + `getMonth()+1`**
 *       直接拼「11月18日 星期二」，跟剧情钟**毫无关系**（剧情里写着 2044 年，锁屏显示本机今天）。
 *   所以「改钟一次四处同时变」在修前根本不成立：其中一处压根没接钟。
 *
 * 【本模块做什么】
 *   用 `composeMoment(ms, settings)` **一次算出**四个消费面要的文本，装成一份 fanout 面。
 *   任何消费面读的就是这份——它们想不一致，除非绕过宿主自己去算（判据会扫这个）。
 *   星期几单独算，因为它只跟日期有关、与小时制/日期序无关；且必须由**剧情毫秒**得出，
 *   不是 `new Date()`（那一个 `new Date()` 就是「锁屏显示本机今天」的根因）。
 *
 * 【三态纪律】
 *   剧情毫秒读不到 ⇒ `state:'unreadable'` 且 `surfaces:null`。**不**回落到墙钟：
 *   「不知道剧情现在几点」与「现在就是本机这个点」是两件事，前者不该冒充后者。
 * ============================================================ */
import { composeMoment, wallClockOf } from './time-format.js';
import { numOrNull } from './num-gate.js';

/** 四个消费面（闭集）。顺序 = 诊断页展示顺序。 */
export const FANOUT_SURFACES = Object.freeze(['chatStamp', 'diaryDate', 'scheduleDate', 'lockscreenSummary']);

/** 每面对应的中文名（诊断/设置共用，避免两处各写一句）。 */
export const SURFACE_LABELS = Object.freeze({
    chatStamp: '会话时间戳',
    diaryDate: '日记日期',
    scheduleDate: '日程 / 日历日期',
    lockscreenSummary: '锁屏摘要'
});

export const FANOUT_STATES = Object.freeze({ ok: 'ok', unreadable: 'unreadable' });

const WEEKDAYS = Object.freeze(['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']);

/** 星期几：只由剧情毫秒决定（不接受「现在几点」这种墙钟输入）。 */
export function weekdayOf(ms) {
    const n = numOrNull(ms);
    if (n === null || n < 0) return null;
    const idx = new Date(n).getDay();
    return (idx >= 0 && idx < 7) ? WEEKDAYS[idx] : null;
}

function unreadable(reason, detail) {
    return Object.freeze({
        state: FANOUT_STATES.unreadable,
        reason: reason,
        detail: detail === undefined ? null : String(detail),
        momentMs: null,
        surfaces: null,
        note: '剧情时刻读不到（' + reason + '）—— 这不等于「现在就是本机时间」'
    });
}

/**
 * 一次算出四个消费面。
 * @param {*} momentMs 剧情毫秒（storyNow(win).ms）
 * @param {object} settings 时间格式设置（config/time-format.js）
 * @param {object} [env] 时区环境（同 time-format 的 env）
 */
export function fanoutOf(momentMs, settings, env) {
    const ms = numOrNull(momentMs);
    if (ms === null || ms < 0) return unreadable('no-story-ms', momentMs);
    const moment = composeMoment(ms, settings, env);
    if (!moment.ok) return unreadable('format-failed', moment.reason);
    const s = moment.surfaces;
    const weekday = weekdayOf(ms);
    /* 小时（24 制）也要来自同一个时刻与同一套时区设置：锁屏的时段问候靠它，
     * 若拿墙钟 `new Date().getHours()`，问候语会与它上面那行日期分属两个世界。 */
    const wc = wallClockOf(ms, settings, env);
    const hour = (wc && wc.ok) ? wc.h : null;
    const lockscreenDate = s.diaryDate + (weekday ? (' ' + weekday) : '');
    return Object.freeze({
        state: FANOUT_STATES.ok,
        reason: null,
        detail: null,
        momentMs: ms,
        weekday: weekday,
        /* 四个面的文本**全部来自同一次 composeMoment**：
         * 结构上不可能出现「聊天是 12 小时制、锁屏是 24 小时制」这种分裂。 */
        surfaces: Object.freeze({
            chatStamp: s.chatStamp,
            diaryDate: s.diaryDate,
            scheduleDate: s.calendarDate,
            /* 锁屏这一面的定义就按**锁屏真显示的两行**拼（日期行 + 时间行），
             * 而不是复用 composeMoment 的 stamp：锁屏上还带星期几，
             * 若这里用 stamp，读回对拍会把「多了星期几」误判成不一致。 */
            lockscreenSummary: lockscreenDate + ' ' + s.statusBar
        }),
        /* 锁屏另外还要时间/日期分开用（它自己排版），同样是那一次算出来的。 */
        extras: Object.freeze({
            lockscreenTime: s.statusBar,
            lockscreenDate: lockscreenDate,
            lockscreenHour: hour
        }),
        note: '四个面由同一次 composeMoment 得出（时间格式与时区已在 config/time-format.js 收口）'
    });
}

/**
 * 读回对拍：消费面**真显示出来的**文本 vs 广播面。
 * @returns {{verdict:'same'|'mismatch'|'unknown', diffs:Array<{surface:string,want:string,got:string}>}}
 */
export function judgeFanout(fanout, observed) {
    if (!fanout || fanout.state !== FANOUT_STATES.ok || !fanout.surfaces) {
        return { verdict: 'unknown', diffs: [] };
    }
    if (!observed || typeof observed !== 'object') return { verdict: 'unknown', diffs: [] };
    const diffs = [];
    let compared = 0;
    for (const key of FANOUT_SURFACES) {
        const got = observed[key];
        if (typeof got !== 'string' || got === '') continue;   // 该面没挂/没显示 ⇒ 不参与判定
        compared += 1;
        if (got !== fanout.surfaces[key]) {
            diffs.push({ surface: key, want: fanout.surfaces[key], got: got });
        }
    }
    /* 一个面都没读回 ⇒ unknown（不是 same：没比过的东西不能算一致）。 */
    if (compared === 0) return { verdict: 'unknown', diffs: [] };
    return { verdict: diffs.length ? 'mismatch' : 'same', diffs: diffs };
}

/** 人话一行。 */
export function fanoutText(fanout) {
    if (!fanout || fanout.state !== FANOUT_STATES.ok) {
        return '剧情钟联动：' + ((fanout && fanout.note) || '读不到剧情时刻') + '（四处都没显示，不是「四处一致」）';
    }
    const s = fanout.surfaces;
    return '剧情钟联动：会话 ' + s.chatStamp + ' · 日记 ' + s.diaryDate
        + ' · 日程 ' + s.scheduleDate + ' · 锁屏 ' + s.lockscreenSummary;
}

/** 单面格式化（给「只要一个面」的调用方用；仍走同一内核，不许自己拼）。 */
export function surfaceOf(fanout, key) {
    if (!fanout || fanout.state !== FANOUT_STATES.ok || !fanout.surfaces) return '';
    const v = fanout.surfaces[key];
    return typeof v === 'string' ? v : '';
}


export default {
    FANOUT_SURFACES, SURFACE_LABELS, FANOUT_STATES,
    weekdayOf, fanoutOf, judgeFanout, fanoutText, surfaceOf
};