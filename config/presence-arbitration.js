/* ========================================================
 * config/presence-arbitration.js — 多会话在场状态仲裁（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   角色/助手可能同时在好几个地方「在忙」：聊天里在打字、后台任务在跑、
 *   刚弹过一条通知等人看、正在整理相册。**最终只该显示一个状态**
 *   —— 但本仓没有这层：谁最后写谁赢，于是「刚弹的通知」会被
 *   紧接着的一次「空闲」覆盖掉，用户根本来不及看见。
 *
 * 【源形态（非描述，按源码判定）】
 *   rullerzhou-afk/clawd-on-desk · src/state-priority.js
 *     · 一张固定数值表 STATE_PRIORITY（error 8 / notification 7 / sweeping 6 /
 *       attention 5 / carrying 4 / juggling 4 / working 3 / thinking 2 / idle 1 /
 *       roam 1 / sleeping 0）—— 全部状态都有号，**没有「未登记」的暗档**；
 *     · 三种强制抬升：compacting 至少抬到 sweeping、permissionLocked 直接抬到
 *       notification、外部 updateVisualState 优先级更高则覆盖；
 *     · 一次性状态（attention / error / sweeping / notification / carrying）另有一张表；
 *     · 全 headless 时显示 idle 而不是 sleeping（没人看着，睡觉最不打扰）。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的状态名是桌宠外壳的；本仓要的是「别人看得见的角色在场」，
 *     故改成本仓自己的六档（error×2 / notice / sweep / typing / idle / sleep），
 *     数值仍取源的相对序（错误最高、睡最低、一次性夹在中间）。
 *   · 源在一次性的判定上靠外部判断「这状态是不是 one-shot」；本仓直接按表派发，
 *     表里不带 oneShot 标记的一律不算一次性。
 *   · 源对 `sessions` 的形态很宽容（Map / 可迭代 / 空）；本仓也照做，
 *     因为它的调用点确实会传 Map。
 *
 * 【纪律】
 *   ① 纯函数：不读时钟、不写状态；
 *   ② 不猜：表外状态号按 0 处理但**如实记进 unknown**，不静默等于 sleeping；
 *   ③ 三态互不同形：winner / forcedBy / unknown 都要能分开答；
 *   ④ headless 不吞错误：全是 headless 时仍若有 error 则给 error。
 * ======================================================== */
'use strict';

/** 在场状态优先级。数值只表示相对序，不表示时长。 */
export const PRESENCE_PRIORITY = Object.freeze({
    error: 8,
    alertError: 7,
    notice: 6,
    attention: 5,
    sweeping: 4,
    working: 3,
    thinking: 2,
    idle: 1,
    roam: 1,
    sleeping: 0
});

/** 一次性状态：显示一轮后应回落，不该长期挂着。 */
export const ONE_SHOT_STATES = Object.freeze(['attention', 'error', 'alertError', 'sweeping', 'notice']);

const ONESHOT_SET = new Set(ONE_SHOT_STATES);

export function isOneShotState(state) {
    return ONESHOT_SET.has(String(state || ''));
}

export function priorityOf(state) {
    const n = PRESENCE_PRIORITY[String(state || '')];
    return (typeof n === 'number') ? n : 0;
}

function normalizeSessions(sessions) {
    if (!sessions) return [];
    if (sessions instanceof Map) return Array.from(sessions.entries());
    if (typeof sessions[Symbol.iterator] === 'function') return Array.from(sessions);
    return [];
}

/**
 * 仲裁出唯一显示态。
 * @param {Iterable|Map} sessions 每项 [id, { state, headless }]
 * @param {{ compacting?:boolean, permissionLocked?:boolean,
 *           updateVisualState?:string, statePriority?:object }} [opts]
 * @returns {{ winner:string, forcedBy:string, unknown:string[], headless:boolean }}
 *   forcedBy 是抬高来源（'' / 'compacting' / 'permissionLocked' / 'update')，诊断可读。
 */
export function resolvePresence(sessions, opts = {}) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const table = (o.statePriority && typeof o.statePriority === 'object') ? o.statePriority : PRESENCE_PRIORITY;
    const prio = (s) => {
        const n = table[String(s || '')];
        return (typeof n === 'number') ? n : 0;
    };
    const unknown = [];
    let best = 'sleeping';       // 可见会话的赢家
    let bestHeadless = 'sleeping'; // 后台会话的赢家（只在全 headless 时用）
    let anyVisible = false;

    for (const row of normalizeSessions(sessions)) {
        const sess = (row && typeof row === 'object' && !Array.isArray(row)) ? row : (Array.isArray(row) ? row[1] : null);
        if (!sess || typeof sess !== 'object') continue;
        const state = sess.state;
        if (typeof state === 'string' && !(state in table) && unknown.indexOf(state) < 0) unknown.push(state);
        if (sess.headless === true) {
            if (prio(state) > prio(bestHeadless)) bestHeadless = state;
            continue;
        }
        anyVisible = true;
        if (prio(state) > prio(best)) best = state;
    }
    if (!anyVisible) {
        /* 全 headless：默认 idle。但**错误仍要穿透** —— 没人看着也得出错，
         *   全压成 idle 会让后台崩掉完全无声（本仓反复点名的「沉默降级」形态）。 */
        best = (bestHeadless === 'error' || bestHeadless === 'alertError') ? bestHeadless : 'idle';
    }

    let forcedBy = '';
    if (o.compacting === true && prio(best) < prio('thinking')) { best = 'sweeping'; forcedBy = 'compacting'; }
    if (o.permissionLocked === true && prio(best) < prio('notice')) { best = 'notice'; forcedBy = 'permissionLocked'; }
    const upd = typeof o.updateVisualState === 'string' ? o.updateVisualState : '';
    if (upd && prio(upd) > prio(best)) { best = upd; forcedBy = 'update'; }

    return { winner: best, forcedBy, unknown, headless: !anyVisible };
}

/** 一行读数。 */
export function presenceLine(r) {
    const o = (r && typeof r === 'object') ? r : {};
    const bits = ['在场：' + String(o.winner || 'idle')];
    if (o.forcedBy) bits.push('抬升自 ' + String(o.forcedBy));
    if (o.headless) bits.push('全为后台会话');
    if (Array.isArray(o.unknown) && o.unknown.length) bits.push('未登记态 ' + o.unknown.join(','));
    return bits.join(' · ');
}

/** 自检：错误压过通知、headless 不显示 sleeping、外部更新能被更高态盖住而不能盖更低态、未登记态记账。 */
export function presenceSelfCheck() {
    const bad = [];
    const r1 = resolvePresence([['a', { state: 'notice' }], ['b', { state: 'error' }]]);
    if (r1.winner !== 'error') bad.push('错误未压过通知');
    const r2 = resolvePresence([['a', { state: 'sleeping', headless: true }]]);
    if (r2.winner !== 'idle') bad.push('全 headless 未回落 idle');
    const r2b = resolvePresence([['a', { state: 'error', headless: true }]]);
    if (r2b.winner !== 'error') bad.push('全 headless 吞掉了错误');
    const r3 = resolvePresence([['a', { state: 'idle' }]], { updateVisualState: 'thinking' });
    if (r3.winner !== 'thinking') bad.push('外部更新未生效');
    const r4 = resolvePresence([['a', { state: 'error' }]], { updateVisualState: 'idle' });
    if (r4.winner !== 'error') bad.push('低优先级外部更新盖掉了错误');
    const r5 = resolvePresence([['a', { state: 'wat' }]]);
    if (r5.unknown.indexOf('wat') < 0) bad.push('未登记态未记账');
    const r6 = resolvePresence([], { permissionLocked: true });
    if (r6.winner !== 'notice' || r6.forcedBy !== 'permissionLocked') bad.push('权限锁未抬升');
    if (!isOneShotState('notice') || isOneShotState('idle')) bad.push('一次性表错');
    return { ok: bad.length === 0, bad };
}