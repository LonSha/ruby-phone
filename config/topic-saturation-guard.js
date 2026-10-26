/* ========================================================
 * config/topic-saturation-guard.js — 话题沉醉守卫（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   用户连着四五轮追问同一件事（角色的出身、某个旧设定、某次事故），
 *   模型就一路往那件事里钻：每轮都在扩写、翻新细节、加新支线。
 *   用户其实早就知道了，只是没明说 —— 而他得不到「你歇会儿」的机会。
 *   本仓修前只有 topic-echo（同一事件跨平台归拢）与 supersede-engine（话题冲突裁决），
 *   **没有「同一话题连续多少轮了」这一层**：没有任何东西会到点把它按住。
 *
 * 【源形态（非描述，按源码判定）】
 *   JasonLiu0826/ackem · src/main/canon/originEscalationGuard.ts
 *     · 四档曝光态 ENTRY(1) / EXPLORE(2) / DEEP(4) / GUARD_COOLDOWN(5)，纯由连击数推进；
 *     · 命中同一指称 streak+1，命中别的指称**立刻归零回 NORMAL**；
 *     · 到 streak 5 触发 guard：注入一段「最多一句带过、转回当前用户」的硬块，
 *       并进 8 轮冷却，冷却期内一律不许再注入该题材；
 *     · 冷却结束由轮次号（turnIndex >= cooldownUntilTurn）解除，不是靠计时器；
 *     · 注入预算随档位递增（400 / 800 / 1200 字，条数恒 1 —— 单条轮播）。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的指称是硬编码的 `ackem_creator`；本仓没有「创造者」概念，
 *     故由调用方传 `focusOf(turnText)` 判出的**话题键**，模块本身不认识任何专名。
 *   · 源的轮次推进由调用方传 turnIndex；本仓消息可能被编辑/重发，
 *     故冷却用的是**单调轮次号**（只增），而不是数组下标。
 *   · 源的注入预算单位是「条目 + 字数」；本仓是正文注入，
 *     故预算改为「追加句数 + 追加字数」，并且 **guard 时追加句数为 0**。
 *
 * 【纪律】
 *   ① 纯函数：状态由调用方持有并持久化（一条会话一份）；
 *   ② 不猜：判不出话题键（空）时**不动状态**（既不归零也不累加）；
 *   ③ 四态互不同形：NORMAL / ENTRY / EXPLORE / DEEP / GUARD_COOLDOWN，各自可见；
 *   ④ guard 只发生一次：进冷却即 streak 清零，「连续多轮」才不会每轮都触发。
 * ======================================================== */
'use strict';

export const SATURATION_STATES = Object.freeze({
    NORMAL: 'NORMAL',
    ENTRY: 'ENTRY',
    EXPLORE: 'EXPLORE',
    DEEP: 'DEEP',
    GUARD_COOLDOWN: 'GUARD_COOLDOWN'
});

/** 连击门槛：到 EXPLORE / DEEP 的档位，与触发 guard 的档位。 */
export const SATURATION_STREAKS = Object.freeze({
    explore: 2,
    deep: 4,
    guard: 5
});

/** 冷却长度（轮）。比 guard 本身长，避免刚说完「歇会儿」下一轮又钻回去。 */
export const GUARD_COOLDOWN_TURNS = 8;

/** 各档注入预算。条数恒 1（单条轮播），字数随档位放宽；guard 档为 0。 */
export const SATURATION_BUDGET = Object.freeze({
    NORMAL: Object.freeze({ entries: 0, chars: 0 }),
    ENTRY: Object.freeze({ entries: 1, chars: 400 }),
    EXPLORE: Object.freeze({ entries: 1, chars: 800 }),
    DEEP: Object.freeze({ entries: 1, chars: 1200 }),
    GUARD_COOLDOWN: Object.freeze({ entries: 0, chars: 0 })
});

/** guard 期间注入的那段硬话。四句各管一件事，不重复。 */
export const GUARD_BLOCK_LINES = Object.freeze([
    '【话题沉醉守卫 · 强制转回用户】',
    '已连续多轮聊同一件事。本回合最多一句带过，随后转向当前用户。',
    '可温和问一句：「你今天一直在这个话题上，是有什么让你在意了吗？」',
    '禁止再展开新的细节或支线。'
]);

export function defaultSaturationState() {
    return { state: SATURATION_STATES.NORMAL, streak: 0, cooldownUntilTurn: 0, topic: '' };
}

export function normalizeSaturationState(prev) {
    const p = (prev && typeof prev === 'object') ? prev : {};
    const state = Object.values(SATURATION_STATES).indexOf(p.state) >= 0 ? p.state : SATURATION_STATES.NORMAL;
    return {
        state,
        streak: Math.max(0, Number(p.streak) || 0),
        cooldownUntilTurn: Math.max(0, Number(p.cooldownUntilTurn) || 0),
        topic: typeof p.topic === 'string' ? p.topic : ''
    };
}

function streakToState(streak) {
    if (streak >= SATURATION_STREAKS.deep) return SATURATION_STATES.DEEP;
    if (streak >= SATURATION_STREAKS.explore) return SATURATION_STATES.EXPLORE;
    if (streak >= 1) return SATURATION_STATES.ENTRY;
    return SATURATION_STATES.NORMAL;
}

/**
 * 推进一回合。
 * @param {object} prev 上一状态
 * @param {string} focus 本回合判出的话题键（空 ⇒ 不动）
 * @param {number} turnIndex 单调轮次号
 * @returns {{state:string, streak:number, cooldownUntilTurn:number, topic:string, guardTriggered:boolean, hold:boolean}}
 *   hold=true 表示本回合仍在冷却里，不许再注入该题材。
 */
export function advanceSaturation(prev, focus, turnIndex) {
    const p = normalizeSaturationState(prev);
    const turn = Math.max(0, Number(turnIndex) || 0);
    const key = typeof focus === 'string' ? focus.trim() : '';

    /* 冷却到期：整体复位（含话题键，冷却结束视为新话题段）。 */
    if (p.state === SATURATION_STATES.GUARD_COOLDOWN && turn >= p.cooldownUntilTurn) {
        return { ...defaultSaturationState(), guardTriggered: false, hold: false };
    }
    /* 冷却未到期：hold，且不累加 streak（否则冷却里还在涨）。 */
    if (p.state === SATURATION_STATES.GUARD_COOLDOWN) {
        return { ...p, streak: 0, guardTriggered: false, hold: true };
    }
    /* 判不出话题键：原样返回，不动状态。 */
    if (!key) return { ...p, guardTriggered: false, hold: false };
    /* 换了话题：立刻归零回 NORMAL（源同形：非本指称即重置）。 */
    if (p.topic && p.topic !== key) {
        return { state: SATURATION_STATES.NORMAL, streak: 0, cooldownUntilTurn: 0, topic: key, guardTriggered: false, hold: false };
    }

    const streak = p.streak + 1;
    if (streak >= SATURATION_STREAKS.guard) {
        return {
            state: SATURATION_STATES.GUARD_COOLDOWN,
            streak: 0,
            cooldownUntilTurn: turn + GUARD_COOLDOWN_TURNS,
            topic: key,
            guardTriggered: true,
            hold: false
        };
    }
    return { state: streakToState(streak), streak, cooldownUntilTurn: 0, topic: key, guardTriggered: false, hold: false };
}

/**
 * 本回合该注入什么。
 * @returns {{budget:{entries:number,chars:number}, block:string}}
 *   block 只在 guardTriggered 时非空；其余档位为空串（档位差异体现在 budget 上）。
 */
export function saturationInjection(next, guardTriggered) {
    if (guardTriggered === true) {
        return { budget: SATURATION_BUDGET.GUARD_COOLDOWN, block: GUARD_BLOCK_LINES.join('\n') };
    }
    const s = (next && SATURATION_STATES[next.state]) ? next.state : SATURATION_STATES.NORMAL;
    return { budget: SATURATION_BUDGET[s] || SATURATION_BUDGET.NORMAL, block: '' };
}

/** 一行读数（诊断页用）。 */
export function saturationLine(s) {
    const o = normalizeSaturationState(s);
    if (o.state === SATURATION_STATES.GUARD_COOLDOWN) {
        return '话题沉醉：守卫冷却中（到第 ' + String(o.cooldownUntilTurn) + ' 轮）· 曾连击 5';
    }
    if (o.state === SATURATION_STATES.NORMAL && !o.topic) return '话题沉醉：无（尚未判定话题）';
    return '话题沉醉：' + o.state + ' · 连击 ' + String(o.streak) + (o.topic ? ' · 话题 ' + o.topic : '');
}

/** 自检：到 5 触发、冷却期不再触发、换话题归零、空键不动、到期复位。 */
export function saturationSelfCheck() {
    const bad = [];
    let s = defaultSaturationState();
    let guardAt = 0;
    for (let t = 1; t <= 6; t++) {
        const r = advanceSaturation(s, 'origin', t);
        if (r.guardTriggered) { guardAt = t; s = r; break; }
        s = r;
    }
    if (guardAt !== SATURATION_STREAKS.guard) bad.push('未在门槛轮触发守卫: ' + guardAt);
    const held = advanceSaturation(s, 'origin', guardAt + 1);
    if (held.guardTriggered) bad.push('冷却期内重复触发');
    if (held.hold !== true) bad.push('冷却期未 hold');
    const switched = advanceSaturation({ state: SATURATION_STATES.DEEP, streak: 4, cooldownUntilTurn: 0, topic: 'a' }, 'b', 10);
    if (switched.state !== SATURATION_STATES.NORMAL || switched.streak !== 0) bad.push('换话题未归零');
    const same = advanceSaturation({ state: SATURATION_STATES.ENTRY, streak: 1, cooldownUntilTurn: 0, topic: 'a' }, '', 11);
    if (same.streak !== 1) bad.push('空话题键改动了 streak');
    const cooled = advanceSaturation({ state: SATURATION_STATES.GUARD_COOLDOWN, streak: 0, cooldownUntilTurn: 9, topic: 'a' }, 'a', 9);
    if (cooled.state !== SATURATION_STATES.NORMAL) bad.push('冷却到期未复位');
    if (saturationInjection({}, true).budget.entries !== 0) bad.push('守卫档预算应为 0');
    return { ok: bad.length === 0, bad };
}