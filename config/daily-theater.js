/* ============================================================
 * config/daily-theater.js — [v4.52.0 · 第六期 R6-X1]
 *   「共同生活剧场：让普通的一天有安排、打断、回应和余韵」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X1）】
 *   「连续三个剧情日，每日有不同任务；至少一次打断；打断后有后续回应；
 *    不是事件列表，而是有节奏的一天——安排→执行→打断→回应→余韵。」
 *
 * 【修前实测的缺口】
 *   本仓 `config/life-events.js`（v2.90.0）已有「生活事件时间线」：
 *   add / update / remove / timeline，按 sourceId 去重、按 importance 排序。
 *   但它是一张**事件列表**——没有「一天的节奏」：
 *     · 没有「上午做 A → 下午做 B → 中途被打断 → 回应打断 → 余韵」的结构；
 *     · 没有「打断」的概念——事件只有 type 与 importance，没有 wasInterrupted / interruptionFrom；
 *     · 没有「余韵」——事件完成后就消失在列表里，没有「今天做完后明天还有回响」。
 *   life-events 解决「事件归档」；daily-theater 解决「一天的戏剧节奏」。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不读时钟）】
 *   1 **buildDaySchedule**：把一天的安排按时段（morning/noon/afternoon/evening/night）结构化，
 *      每段带 task + role（谁在做）+ expectedOutcome；
 *   2 **injectInterruption**：在某个时段插入打断事件，
 *      标 wasInterrupted + interruptionFrom + pendingResponse，
 *      被打断的 task 标为 paused（不是 cancelled——打断不等于取消）；
 *   3 **buildResponseChain**：打断发生后，角色对打断的回应链——
 *      谁知道了、谁回应了、回应了什么、余韵是什么（后续剧情日还有回响）；
 *   4 **deriveDayRhythm**：一天结束后的节奏读数——
 *      完成 / 打断 / 余韵各几项，有没有「今天不像昨天」的变化感。
 *
 * 【口径纪律】
 *   · 时段由调用方给（不读时钟），at 全部外部传入；
 *   · 打断不取消原任务（paused ≠ cancelled），回应后才决定是 resume 还是 abandon；
 *   · 余韵跨日：今天的事明天还有回响，由 tomorrowEcho 字段标出；
 *   · 「安排」是结构不是建议：只给出时段+任务+角色，不写「你应该做」。
 * ============================================================ */
'use strict';

export const DT_VERSION = '4.52.0';
export const DAY_SLOTS = Object.freeze({
    morning: Object.freeze({ label: '上午', order: 1 }),
    noon: Object.freeze({ label: '中午', order: 2 }),
    afternoon: Object.freeze({ label: '下午', order: 3 }),
    evening: Object.freeze({ label: '傍晚', order: 4 }),
    night: Object.freeze({ label: '夜晚', order: 5 }),
});
export const TASK_STATES = Object.freeze({
    planned: 'planned',
    in_progress: 'in_progress',
    paused: 'paused',
    completed: 'completed',
    abandoned: 'abandoned',
});
export const DT_LIMITS = Object.freeze({
    maxSlots: 5,
    maxInterrupts: 3,
    maxEchoes: 10,
    textMax: 200,
});

function _s(x, max) {
    const t = (x === null || x === undefined) ? '' : String(x);
    return max ? t.slice(0, max) : t;
}

/* ───────── ① 一天安排 ───────── */
/**
 * @param {object} input
 *   · `day`        — 剧情日标识（如 'day-3'）
 *   · `slots`      — 时段安排 [{slot, task, role, expectedOutcome}]
 *   · `at`         — 生成时点
 * @returns {{ day:string, schedule:Array, summary:string }}
 */
export function buildDaySchedule(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const day = _s(o.day, 40).trim() || 'unknown-day';
    const rawSlots = Array.isArray(o.slots) ? o.slots : [];
    const schedule = [];
    for (const s of rawSlots) {
        if (!s || typeof s !== 'object') continue;
        const slot = _s(s.slot, 20).trim();
        if (!DAY_SLOTS[slot]) continue;
        schedule.push({
            slot,
            label: DAY_SLOTS[slot].label,
            order: DAY_SLOTS[slot].order,
            task: _s(s.task, DT_LIMITS.textMax),
            role: _s(s.role, 60),
            expectedOutcome: _s(s.expectedOutcome, DT_LIMITS.textMax),
            state: TASK_STATES.planned,
            interrupted: false,
        });
    }
    schedule.sort((a, b) => a.order - b.order);
    while (schedule.length > DT_LIMITS.maxSlots) schedule.pop();
    const summary = day + '：' + schedule.length + ' 个时段安排'
        + (schedule.some(s => s.state === TASK_STATES.paused) ? ' · 含被打断' : '');
    return { day, schedule, summary };
}

/* ───────── ② 打断注入 ───────── */
/**
 * 在某个时段插入打断：原 task 标 paused，新增 interrupt 条目。
 * @param {object} dayResult buildDaySchedule 的返回
 * @param {object} interruption { slot, from, content, severity }
 * @returns {{ updatedDay:object, interruption:object|null, reason:string }}
 */
export function injectInterruption(dayResult, interruption = {}) {
    if (!dayResult || !Array.isArray(dayResult.schedule)) return { updatedDay: dayResult, interruption: null, reason: '日程不在场' };
    const ir = (interruption && typeof interruption === 'object') ? interruption : {};
    const slot = _s(ir.slot, 20).trim();
    if (!DAY_SLOTS[slot]) return { updatedDay: dayResult, interruption: null, reason: '打断时段认不出' };
    const target = dayResult.schedule.find(s => s.slot === slot);
    if (!target) return { updatedDay: dayResult, interruption: null, reason: '该时段无安排可打断' };
    /* 打断不取消原任务 */
    target.state = TASK_STATES.paused;
    target.interrupted = true;
    const intObj = {
        slot,
        label: DAY_SLOTS[slot].label,
        from: _s(ir.from, 60),
        content: _s(ir.content, DT_LIMITS.textMax),
        severity: _s(ir.severity, 20).trim() || 'normal',
        pendingResponse: true,
        responseChain: [],
        tomorrowEcho: null,
    };
    if (!Array.isArray(dayResult.interruptions)) dayResult.interruptions = [];
    dayResult.interruptions.push(intObj);
    while (dayResult.interruptions.length > DT_LIMITS.maxInterrupts) dayResult.interruptions.shift();
    return {
        updatedDay: dayResult,
        interruption: intObj,
        reason: '时段 ' + DAY_SLOTS[slot].label + ' 被打断（原任务暂停非取消）',
    };
}

/* ───────── ③ 回应链 ───────── */
/**
 * 打断发生后，角色对打断的回应链。
 * @param {object} interruption injectInterruption 返回的 interruption 对象
 * @param {Array} responses [{actorId, content, at}]
 * @param {object} opts { tomorrowEcho }
 * @returns {{ chain:Array, resolved:boolean, tomorrowEcho:string|null, reason:string }}
 */
export function buildResponseChain(interruption, responses = [], opts = {}) {
    if (!interruption) return { chain: [], resolved: false, tomorrowEcho: null, reason: '打断不在场' };
    const o = (opts && typeof opts === 'object') ? opts : {};
    const chain = (Array.isArray(responses) ? responses : []).map(r => ({
        actorId: _s(r && r.actorId, 60),
        content: _s(r && r.content, DT_LIMITS.textMax),
        at: (r && typeof r.at === 'number') ? r.at : 0,
    }));
    interruption.responseChain = chain;
    interruption.pendingResponse = chain.length === 0;
    const echo = _s(o.tomorrowEcho, DT_LIMITS.textMax).trim() || null;
    if (echo) interruption.tomorrowEcho = echo;
    const resolved = chain.length > 0;
    const reason = '回应 ' + chain.length + ' 条'
        + (resolved ? ' · 已回应' : ' · 待回应')
        + (echo ? ' · 有余韵（跨日回响）' : '');
    return { chain, resolved, tomorrowEcho: echo, reason };
}

/* ───────── ④ 节奏读数 ───────── */
/**
 * 一天结束后的节奏读数。
 * @param {object} dayResult buildDaySchedule + injectInterruption 后的产物
 * @returns {{ completed:number, paused:number, abandoned:number, interrupts:number, echoes:number, hasVariation:boolean, summary:string }}
 */
export function deriveDayRhythm(dayResult) {
    if (!dayResult || !Array.isArray(dayResult.schedule)) {
        return { completed: 0, paused: 0, abandoned: 0, interrupts: 0, echoes: 0, hasVariation: false, summary: '日程不在场' };
    }
    let completed = 0, paused = 0, abandoned = 0;
    for (const s of dayResult.schedule) {
        if (s.state === TASK_STATES.completed) completed++;
        else if (s.state === TASK_STATES.paused) paused++;
        else if (s.state === TASK_STATES.abandoned) abandoned++;
    }
    const interrupts = Array.isArray(dayResult.interruptions) ? dayResult.interruptions.length : 0;
    const echoes = Array.isArray(dayResult.interruptions)
        ? dayResult.interruptions.filter(i => i && i.tomorrowEcho).length : 0;
    const hasVariation = interrupts > 0 || echoes > 0;
    const summary = dayResult.day + ' 节奏：完成 ' + completed + ' / 暂停 ' + paused + ' / 放弃 ' + abandoned
        + ' · 打断 ' + interrupts + ' · 余韵 ' + echoes
        + (hasVariation ? ' · 有变化感' : ' · 平稳');
    return { completed, paused, abandoned, interrupts, echoes, hasVariation, summary };
}