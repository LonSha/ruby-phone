/* ========================================================
 * config/stall-watch.js — 无进展告警（纯函数，非执行超时）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   后台任务（媒体渲染、批量导入、跨 App 编排）卡住时，界面只有一个「在跑」。
 *   十分钟没动与刚开始跑长得一模一样 —— 用户等到熄屏也不知道该不该取消。
 *   本仓修前只有「有没有报错」这两种读法，没有「在跑但没进展」这第三种。
 *
 * 【源形态（非描述，按源码判定）】
 *   EvelynnYu/MIRROW · ai-chat-backend/task_stall_policy.py
 *     · **只读状态，不改执行**：标题就写明「no-progress warnings are advisory,
 *       never execution deadlines」；
 *     · 三类豁免：无界任务（名字在白名单里）、状态不是 running、正在等待重试
 *       （`routing_wait.retry_after` 未到点）；
 *     · 有进展时间戳（`last_progress`，缺则回退 `started_at`）才计时；
 *     · 只在**首次**越过阈值时返回一次 elapsed，其余时刻返回 None ——
 *       故告警不会每 tick 重刷，也不会自己撤销；
 *     · 一旦判回不 stalled（豁免/恢复）就把 `stalled` 从状态里摘掉。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的时间戳是 ISO 且要解析时区；本仓一律毫秒数（`Date.now()` 口味的整数），
 *     故无需时区处理，但要防「时间戳比现在大」（时钟回拨）。
 *   · 源的白名单是具体任务名；本仓任务名散在各 App，故改成**按前缀/正则**传，
 *     不硬编码任何名字。空表即「没有无界任务」，这是安全的（只多告警不多吞）。
 *   · 源把 stalled 写在 state 里再吐 elapsed；本仓保持同形（state 由调用方持久化），
 *     但额外返回 `cleared`，让视图知道该擦掉界面上的告警。
 *
 * 【纪律】
 *   ① 纯函数：只改调用方传进来的 state 的 `stalled` 字段，不碰别的；
 *   ② 不改执行：返回里没有任何「取消」指令；
 *   ③ 三态互不同形：running / stalled / exempt 必须分得开；
 *   ④ 只告警一次：同一段停滞不会每 tick 都吐 elapsed。
 * ======================================================== */
'use strict';

/** 判定结果态。 */
export const STALL_VERDICTS = Object.freeze({
    EXEMPT: 'exempt',        // 无界任务 / 非 running / 等重试中
    ON_TIME: 'on-time',      // 有进展或在阈值内
    STALLED: 'stalled',      // 首次越线，本次返回 elapsed
    STILL_STALLED: 'still'   // 已告过，别重复告
});

export const STALL_REASONS = Object.freeze({
    UNBOUNDED: 'unbounded-task',
    NOT_RUNNING: 'not-running',
    AWAITING_RETRY: 'awaiting-retry',
    NO_STAMP: 'no-timestamp',
    BAD_STAMP: 'bad-timestamp',
    CLOCK_WENT_BACK: 'clock-went-back',
    UNDER_THRESHOLD: 'under-threshold'
});

export const DEFAULT_STALL_SECONDS = 300;

function matchUnbounded(name, unbounded) {
    const n = String(name || '');
    if (!n) return false;
    const list = Array.isArray(unbounded) ? unbounded : [];
    return list.some((pat) => {
        if (pat instanceof RegExp) return pat.test(n);
        return String(pat) === n;
    });
}

/**
 * 判一次。
 * @param {object} input
 * @param {string} input.name 任务名
 * @param {object} input.state 任务状态（含 status / last_progress / started_at / routing_wait）
 * @param {number} input.now 现在（毫秒）
 * @param {number} [input.thresholdSeconds]
 * @param {Array<string|RegExp>} [input.unbounded]
 * @returns {{verdict:string, reason:string, elapsedSeconds:number|null, cleared:boolean}}
 */
export function checkStall(input) {
    const o = (input && typeof input === 'object') ? input : {};
    const state = (o.state && typeof o.state === 'object') ? o.state : {};
    const threshold = Math.max(1, Number(o.thresholdSeconds) || DEFAULT_STALL_SECONDS);
    const now = Number(o.now) || 0;

    const exempt = (reason) => {
        const wasStalled = state.stalled === true;
        delete state.stalled;
        return { verdict: STALL_VERDICTS.EXEMPT, reason, elapsedSeconds: null, cleared: wasStalled };
    };

    if (matchUnbounded(o.name, o.unbounded)) return exempt(STALL_REASONS.UNBOUNDED);
    if (state.status !== 'running') return exempt(STALL_REASONS.NOT_RUNNING);

    const wait = state.routing_wait;
    const retryAfter = wait && typeof wait === 'object' ? Number(wait.retry_after) : NaN;
    if (Number.isFinite(retryAfter) && now < retryAfter) return exempt(STALL_REASONS.AWAITING_RETRY);

    const stampRaw = (typeof state.last_progress === 'number') ? state.last_progress : state.started_at;
    if (typeof stampRaw !== 'number' || !Number.isFinite(stampRaw)) return exempt(STALL_REASONS.NO_STAMP);
    const elapsed = (now - stampRaw) / 1000;
    if (!Number.isFinite(elapsed)) return exempt(STALL_REASONS.BAD_STAMP);
    if (elapsed < 0) {
        /* 时钟回拨：不清告警也不新告（判不出来就不说），并如实标原因。 */
        return { verdict: STALL_VERDICTS.ON_TIME, reason: STALL_REASONS.CLOCK_WENT_BACK, elapsedSeconds: null, cleared: false };
    }
    if (elapsed <= threshold) {
        const wasStalled = state.stalled === true;
        delete state.stalled;
        return { verdict: STALL_VERDICTS.ON_TIME, reason: STALL_REASONS.UNDER_THRESHOLD, elapsedSeconds: null, cleared: wasStalled };
    }
    if (state.stalled === true) {
        return { verdict: STALL_VERDICTS.STILL_STALLED, reason: '', elapsedSeconds: null, cleared: false };
    }
    state.stalled = true;
    return { verdict: STALL_VERDICTS.STALLED, reason: '', elapsedSeconds: Math.floor(elapsed), cleared: false };
}

/** 一行告警文案（越线那一次才用得上）。 */
export function stallLine(r) {
    const o = (r && typeof r === 'object') ? r : {};
    if (o.verdict === STALL_VERDICTS.STALLED) return '已 ' + String(o.elapsedSeconds || 0) + ' 秒没有进展（仍可继续等）';
    if (o.verdict === STALL_VERDICTS.STILL_STALLED) return '仍在停滞中（已告过）';
    if (o.verdict === STALL_VERDICTS.EXEMPT) return '不计停滞：' + String(o.reason);
    return '正常：' + String(o.reason || '');
}

/** 自检：越线只告一次、恢复擦告警、三类豁免、回拨不告。 */
export function stallSelfCheck() {
    const bad = [];
    const s1 = { status: 'running', started_at: 1000 };
    const a = checkStall({ name: 'job', state: s1, now: 1000 + 301000 });
    if (a.verdict !== STALL_VERDICTS.STALLED) bad.push('越线未告');
    const b = checkStall({ name: 'job', state: s1, now: 1000 + 400000 });
    if (b.verdict !== STALL_VERDICTS.STILL_STALLED) bad.push('重复告警');
    const c = checkStall({ name: 'job', state: s1, now: 1000 + 400000, thresholdSeconds: 600 });
    if (c.cleared !== true) bad.push('恢复未擦告警');
    if (checkStall({ name: 'x', state: { status: 'running', started_at: 0 }, now: 1e9, unbounded: [/^x/] }).verdict !== STALL_VERDICTS.EXEMPT) bad.push('白名单未豁免');
    if (checkStall({ name: 'j', state: { status: 'done', started_at: 0 }, now: 1e9 }).verdict !== STALL_VERDICTS.EXEMPT) bad.push('非 running 未豁免');
    if (checkStall({ name: 'j', state: { status: 'running', started_at: 0, routing_wait: { retry_after: 5e9 } }, now: 1e6 }).verdict !== STALL_VERDICTS.EXEMPT) bad.push('等重试未豁免');
    const back = checkStall({ name: 'j', state: { status: 'running', started_at: 10000 }, now: 5000 });
    if (back.verdict !== STALL_VERDICTS.ON_TIME) bad.push('回拨被当停滞');
    return { ok: bad.length === 0, bad };
}