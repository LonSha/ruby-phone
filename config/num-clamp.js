/* ============================================================
 * config/num-clamp.js — 全仓唯一的「有界取数」实现 [v3.84.0 · 计划 R-O8]
 * ------------------------------------------------------------
 * 【为什么有这份文件（R-O8 的实测起点，不是推演）】
 *   本版用一次真调用图扫描（按函数名 + 函数体指纹）在全仓 `apps/` `config/`
 *   `phone/` 上取数，实测结果：
 *     · 同名函数 163 组；其中**函数体逐字相同**的 30 组、**同名不同实现**的 133 组；
 *     · 其中最典型的一簇是「有界取整」：`boundedInt` 一份代码在 **11 个文件**里
 *       各写了一遍，参数名与语义**完全一致**（`v, fallback, min, max`），
 *       而其中 **2 份仍是弱口径**（`Number(v)` + `Number.isFinite`）——
 *       也就是说：同一条口径在 11 处复制，改好了 9 处，剩下 2 处没人知道。
 *   这正是计划原文点名的那件事：**行数不是问题，维护半径才是**。
 *   第 9 处改对不等于第 10 处改对，而「哪几处还是旧的」没有任何东西能回答。
 *
 * 【本模块的裁定】
 *   · `boundedInt` / `boundedNum` 是这两条口径的**唯一实现**；
 *   · 取数一律走 `numOrNull`（全仓唯一取数门）：**弱口径**（`Number.isFinite(Number(v))`）
 *     会把 `''` / `[]` / `null` 全读成 0，于是「上游没给」与「上游给了 0」塌成一个读数；
 *   · 边界 `min` / `max` **必须都是有限数**才夹取 —— 边界本身取不到时如实返回 `num`
 *     （不夹取，也不编一个边界）。这一条与「没给 ≠ 给了 0」同源。
 *
 * 【三态互不同形（`boundedBy` 的 `reason`）】
 *   `value`（取到并夹好）/ `fallback`（取不到，用了兜底）/ `unbounded`（取到了但边界
 *   取不到，故未夹取）。把 `unbounded` 并进 `value`，调用方会以为「边界生效了」；
 *   并进 `fallback`，会以为「没取到数」—— 而它取到了，只是没能夹。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/**
 * 有界取数（返回对象形态，带处置原因）。**唯一的判定实现**，
 * `boundedInt` / `boundedNum` 都走它 —— 不许各自写一份夹取逻辑。
 *
 * @param {*} v 上游读数
 * @param {*} fallback 取不到时的兜底值
 * @param {*} min 下界（取不到时不夹取）
 * @param {*} max 上界（取不到时不夹取）
 * @param {{round?:boolean}} options `round` 为真时四舍五入取整（整数口径）
 * @returns {{value:*, reason:string, num:number|null}}
 */
export function boundedBy(v, fallback, min, max, options = {}) {
    const n = numOrNull(v);
    if (n === null) return { value: fallback, reason: 'fallback', num: null };
    const lo = numOrNull(min);
    const hi = numOrNull(max);
    const rounded = options.round === true ? Math.round(n) : n;
    if (lo === null || hi === null) {
        return { value: rounded, reason: 'unbounded', num: rounded };
    }
    return { value: Math.min(hi, Math.max(lo, rounded)), reason: 'value', num: rounded };
}

/** 有界整数：取不到即兜底；边界取不到即不夹取（如实返回原数）。 */
export function boundedInt(v, fallback, min, max) {
    return boundedBy(v, fallback, min, max, { round: true }).value;
}

/** 有界浮点：与 `boundedInt` 同口径，只是不取整。 */
export function boundedNum(v, fallback, min, max) {
    return boundedBy(v, fallback, min, max, { round: false }).value;
}

/** 一行读数（诊断用）。三态各占一格。 */
export function clampLine(result) {
    if (!result || typeof result !== 'object') return '有界取数：无读数';
    if (result.reason === 'fallback') return '有界取数：取不到，用兜底';
    if (result.reason === 'unbounded') return '有界取数：取到了但边界取不到 —— 未夹取（不编边界）';
    return '有界取数：' + String(result.value);
}

export default { boundedBy, boundedInt, boundedNum, clampLine };
