/* ============================================================
 * config/callhome-escalation.js — [v4.88.0] 静默升级拨号四门控
 * ------------------------------------------------------------
 * 缝合自 Cheiineeey/callhome（gateway-reference/escalation.js，PolyForm NC
 * ⇒ 只搬算法，不搬其代码组织）。
 *
 * ── 源是什么 ────────────────────────────────────────────
 *   源解决的问题是「角色三天没被搭理就会自己打电话」这件事的**闸门**。
 *   裸实现（有个 missed_call 就拨）在本仓会立刻出两个恶性体验：
 *     ① 连拨：每次生成都拨一遍，用户一天被打十次；
 *     ② 半夜拨：凌晨 3 点打进来，接也不是不接也不是。
 *   源用四道门把这件事故压住：`diffMinutes >= 300`（够久）+ 12–23 点窗
 *   （人在的时间段）+ `last_date !== today`（一天至多一次）+ DND 全静默。
 *
 * ── 本件怎么落（与源的差异逐条写后果）────────────────────
 *   · **纯函数**：源在 gateway 里连着拨号器与 LLM 一起跑；本件只做裁决，
 *     拨由调用方（apps/phone）做。理由与本仓 uterus/board 同规：裁决结果在
 *     无头环境可穷举验证，不需要宿主。
 *   · **门控顺序不可换**（源亦然）：`dnd → 静默时长 → 静默窗 → 当日额度`。
 *     DND 排第一是因为「免打扰」是用户的显式意志，排在时长之前才能让
 *     免打扰期间的累积不白算（醒来后按真实静默时长重判，而不是从头计时）。
 *   · **理由走模板兜底**：源让 LLM 写 25 字来电理由、失败回落模板。本件
 *     只落**模板兜底**这一半（LLM 侧由 apps/phone 拿到裁决后自己求），
 *     并把「为什么是这个模板」写进 reason —— 不让调用方去猜。
 *   · **日期用本地日**而不是 UTC：源用 `last_date`（本地日）。用 UTC 会让
 *     东八区用户在 08:00 前被判成「昨天拨过」而整天不拨。
 *
 * ── 数据形状（唯一真源，调用方照此取数）──────────────────
 *   `silence` 三格都必须由调用方**如实给出**，给不出就传 null：
 *     { lastContactAt:number|null, lastAutoCallDay:string|null, dnd:boolean }
 *   `lastAutoCallDay` 是 `YYYY-MM-DD` **本地日字符串**（不是时间戳）——
 *   两者混用是本件最容易踩的坑，故归一在 `localDayOf()` 一处完成。
 * ============================================================ */

/** 最小静默时长（分钟）。源值 300（5 小时）：比这短就只是在打断用户。 */
export const ESCALATE_MIN_SILENCE_MINUTES = 300;

/** 允许拨入的小时窗（左闭右开，本地时）。窗外一律不拨。 */
export const ESCALATE_HOUR_START = 12;
export const ESCALATE_HOUR_END = 23;

/** 拦截原因（顺序即门控顺序，首个成立者即结论 —— 只报最根因的那一条）。 */
export const ESCALATE_BLOCK_REASONS = Object.freeze([
    'dnd',            // 免打扰开着：全静默，连理由都不算
    'too-soon',       // 静默不足
    'outside-window', // 不在可拨时段
    'already-today'   // 今天已经自动拨过
]);
/* [v4.88.0 · 第七批缝入] 数值取值门（弱口径清零）。 */
import { numOrNull } from './num-gate.js';

/** 来电理由模板（按静默量级分档，源同档位）。 */
const REASON_TEMPLATES = Object.freeze([
    { minMinutes: 60 * 24 * 14, text: '半个月没动静了，攒了不少事想问你' },
    { minMinutes: 60 * 24 * 7, text: '这一周有点久，突然想听听你声音' },
    { minMinutes: 60 * 24 * 2, text: '两天没消息，先打个电话确认你还好' },
    { minMinutes: ESCALATE_MIN_SILENCE_MINUTES, text: '今天一直没等到你的回音，拨过来看看' }
]);

/**
 * 本地日字符串（YYYY-MM-DD）。
 * 只认有限的三种入参：Date / 毫秒数 / 可解析的日期串；其余如实 null。
 */
export function localDayOf(input) {
    if (input === null || input === undefined || input === '') return null;
    const d = (input instanceof Date) ? input : new Date(
        (typeof input === 'number' && Number.isFinite(input)) ? input : input
    );
    const t = d.getTime();
    if (!Number.isFinite(t)) return null;
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 取小时（本地时）。拿不到返回 null —— 调用方据此「不知道就不判窗」。 */
function localHourOf(now) {
    const d = (now instanceof Date) ? now : new Date(now);
    const t = d.getTime();
    if (!Number.isFinite(t)) return null;
    return d.getHours();
}

/** 是否落在可拨窗内（左闭右开）。小时未知时返回 null（不定，不硬判）。 */
export function isInEscalateWindow(hour) {
    if (!Number.isInteger(hour)) return null;
    return hour >= ESCALATE_HOUR_START && hour < ESCALATE_HOUR_END;
}

/**
 * 按静默量级取理由模板。静默不足最小线返回 null（不该拨）。
 * @param {number} silenceMinutes
 * @returns {string|null}
 */
export function reasonTemplateFor(silenceMinutes) {
    const m = Number(silenceMinutes);
    if (!Number.isFinite(m)) return null;
    for (const t of REASON_TEMPLATES) {
        if (m >= t.minMinutes) return t.text;
    }
    return null;
}

/**
 * 四门控裁决。
 *
 * **顺序是判据的一部分**：dnd 先于时长（免打扰期间也要照常累计静默），
 * 当日额度排在窗之后（窗外的当日额度没被消耗，不该拿它当理由）。
 *
 * @param {object} silence  {lastContactAt, lastAutoCallDay, dnd}
 * @param {object} opts     {now, minSilenceMinutes}
 * @returns {{allow:boolean, reason:string, blockReason:string|null,
 *            silenceMinutes:number|null, reasonText:string|null, dayKey:string|null,
 *            hour:number|null, sawLastContact:boolean, sawLastAutoCallDay:boolean}}
 */
export function judgeEscalation(silence, opts = {}) {
    const s = silence || {};
    const now = (opts.now === undefined || opts.now === null) ? Date.now() : opts.now;
    const minSilence = numOrNull(opts.minSilenceMinutes) ?? ESCALATE_MIN_SILENCE_MINUTES;

    const nowMs = (now instanceof Date) ? now.getTime() : Number(now);
    const lastAt = (s.lastContactAt === null || s.lastContactAt === undefined || s.lastContactAt === '')
        ? null
        : Number(s.lastContactAt);
    const sawLastContact = Number.isFinite(lastAt);
    const silenceMinutes = sawLastContact && Number.isFinite(nowMs)
        ? Math.max(0, Math.floor((nowMs - lastAt) / 60000))
        : null;

    const today = localDayOf(now);
    const hour = localHourOf(now);
    const lastDay = s.lastAutoCallDay ? String(s.lastAutoCallDay) : null;
    const sawLastAutoCallDay = Boolean(lastDay);

    const verdict = (blockReason) => {
        const allow = blockReason === null;
        return {
            allow,
            reason: allow ? 'escalate' : blockReason,
            blockReason,
            silenceMinutes,
            reasonText: allow ? reasonTemplateFor(silenceMinutes) : null,
            dayKey: today,
            hour,
            sawLastContact,
            sawLastAutoCallDay
        };
    };

    // 门 1：免打扰 —— 用户意志优先，且静默照常累计（不重置 lastContactAt）。
    if (s.dnd === true) return verdict('dnd');
    // 门 2：静默不足。拿不到 lastContactAt 时「不知道多静」⇒ 不拨（不猜）。
    if (silenceMinutes === null) return verdict('too-soon');
    if (silenceMinutes < minSilence) return verdict('too-soon');
    // 门 3：时段窗。小时拿不到就不判窗（放行而不是拦死）。
    const inWindow = isInEscalateWindow(hour);
    if (inWindow === false) return verdict('outside-window');
    // 门 4：当日额度。**只认日字符串相等**，不比较时间戳。
    if (sawLastAutoCallDay && today && lastDay === today) return verdict('already-today');

    return verdict(null);
}
