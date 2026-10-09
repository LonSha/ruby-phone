/* ========================================================
 *  RubyPhone · 判定归脚本、骰子归脚本（B3）+ 平行线（B4）
 * ========================================================
 *
 * 【B3 为什么要把判定从模型手里拿走】
 *   把「这次成不成功」交给模型，得到的不是随机，而是**倾向** ——
 *   模型会按当下的叙事气氛决定成败：情绪往上走就给成功，要挫败感就给失败。
 *   结果是骰子看起来在摇，其实在**替叙事服务**：玩家无法通过「换个做法」提高胜率，
 *   因为胜率不是由做法决定的，而是由「这一段该不该顺」决定的。
 *
 *   故本模块把这条链切成两半：
 *     · **模型只写「难度 + 四个落点」**（`setDifficulty`）——
 *       它擅长判断这事有多难、以及四种不同结果分别长什么样；
 *     · **脚本摇骰子并裁决**（`rollCheck`）—— 骰子是脚本的，模型不许看、不许改。
 *
 *   四个落点是**都写出来**、不是只写一个：只写「成功时会怎样」的行文，
 *   一旦骰子摇出失败就得现编，而现编的那一版与前面的铺垫必然对不上。
 *
 * 【B4 平行线：不在场的那条线照样走】
 *   玩家不在场的另一条线（另一个城市里的另一个角色、另一场同时进行的饭局）
 *   是这个世界「在动」的全部证据。它有三个不可违反的约定：
 *     ① **照样记状态**：不进 present（本场人不该看到），但状态要落下来；
 *     ② **本场人不知道**：平行线的任何内容**不得**进本场的注入面 ——
 *        否则角色会说出他没可能知道的事（本仓最贵的一类错：知情网络被绕过）；
 *     ③ **将来可以撞上**：平行线留下的状态在后来某一场里能被读到。
 *   把 ② 与 ① 合并是最容易犯的错：一旦「因为本场人不知道所以不记」，
 *   这条线就永远不会有下文 —— 它不会发展，只会在下一次需要时被临时编出来。
 *
 * 【三态互不同形】
 *   判定：`resolved`（摇完了）/ `awaiting-difficulty`（模型还没给难度）/
 *        `invalid`（给了难度但不合法）。
 *   平行线：`parallel`（不在场、只记状态）/ `present`（在场，正常注入）/
 *          `leaked`（不在场的线被塞进了本场注入面 —— 这是**错**，不是一种状态）。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 四个落点。四者**必须**都写出来才允许摇骰 —— 缺一落点即拒判。 */
export const OUTCOMES = Object.freeze([
    { id: 'crit', label: '大成功', note: '比「成功」更多一层：事情成了，而且有额外的收获' },
    { id: 'success', label: '成功', note: '事情成了' },
    { id: 'fail', label: '失败', note: '事情没成，但局面没坏到不可收拾' },
    { id: 'crit-fail', label: '大失败', note: '事情没成，而且多了一层代价' }
]);

const OUTCOME_IDS = Object.freeze(OUTCOMES.map((o) => o.id));

/** 难度档与它的分数线（保守 / 标准 / 苛刻）。线是**脚本的**，不许模型传。 */
export const DIFFICULTY_LINES = Object.freeze({
    easy: { need: 25, label: '容易' },
    normal: { need: 50, label: '一般' },
    hard: { need: 70, label: '困难' },
    brutal: { need: 85, label: '极难' }
});

function text(v) {
    return String(v ?? '').trim();
}

/** 骰子：**脚本的**。区间 [1,100]，注入随机源以便测试与复现（seed 不给就用 Math.random）。 */
export function rollD100(rng) {
    const r = typeof rng === 'function' ? rng() : Math.random();
    const clamped = Math.min(Math.max(Number(r), 0), 0.999999999);
    return Math.floor(clamped * 100) + 1;
}

/**
 * 模型侧的输入：难度 + 四个落点。任一缺项即 `invalid`（缺落点就摇，等于让脚本现编）。
 * @returns {{ok:boolean, difficulty:string, need:number, outcomes:object, why:string}}
 */
export function setDifficulty(input = {}) {
    const key = text(input.difficulty).toLowerCase();
    const line = DIFFICULTY_LINES[key];
    if (!line) return { ok: false, difficulty: key, need: 0, outcomes: {}, why: '难度不在档内：' + (key || '（空）') };
    const src = input.outcomes && typeof input.outcomes === 'object' ? input.outcomes : {};
    const out = {};
    const missing = [];
    for (const id of OUTCOME_IDS) {
        const v = text(src[id]);
        if (!v) { missing.push(id); continue; }
        out[id] = v;
    }
    if (missing.length) {
        return { ok: false, difficulty: key, need: line.need, outcomes: out, why: '落点缺失：' + missing.join('/') };
    }
    return { ok: true, difficulty: key, need: line.need, outcomes: out, why: '' };
}

/**
 * 裁决：脚本摇骰 + 判落点。
 *
 * @param {{difficulty?:string, outcomes?:object, bonus?:number, rng?:Function, margin?:number}} input
 * @returns {{state:string, roll:number, need:number, total:number, outcome:string, text:string, why:string}}
 *   `bonus` 是**做法带来的修正**（不是模型的态度）：玩家做了什么，决定加多少。
 *   `margin` 是「大成功 / 大失败」的带宽，默认 15。
 */
export function rollCheck(input = {}) {
    const model = setDifficulty(input);
    if (!model.ok) {
        const state = /难度不在档内/.test(model.why) ? 'invalid' : 'awaiting-difficulty';
        return { state: state, roll: 0, need: model.need, total: 0, outcome: '', text: '', why: model.why };
    }
    const margin = numOrNull(input.margin) !== null ? numOrNull(input.margin) : 15;
    const bonus = numOrNull(input.bonus) !== null ? numOrNull(input.bonus) : 0;
    const roll = rollD100(input.rng);
    const total = roll + bonus;
    let outcome;
    if (total >= 100) outcome = 'crit';
    else if (total >= model.need + margin) outcome = 'crit';
    else if (total >= model.need) outcome = 'success';
    else if (total <= Math.max(1, model.need - margin - 50)) outcome = 'crit-fail';
    else outcome = 'fail';
    return {
        state: 'resolved', roll: roll, need: model.need, total: total,
        outcome: outcome, text: model.outcomes[outcome], why: ''
    };
}

/** 一行读数。三态各占一格（`invalid` 与 `awaiting-difficulty` 不许同形）。 */
export function rollLine(result) {
    if (!result || typeof result !== 'object') return '判定：无读数';
    if (result.state === 'awaiting-difficulty') return '判定：等难度与四落点 —— ' + result.why;
    if (result.state === 'invalid') return '判定：输入不合法 —— ' + result.why;
    return '判定：掷 ' + result.roll + (result.total !== result.roll ? '（含做法修正 ' + (result.total - result.roll) + '）' : '')
        + ' · 线 ' + result.need + ' ⇒ ' + result.outcome;
}

/* ───────────────────────── B4 平行线 ───────────────────────── */

/** 一条线的在场性：`present` / `parallel`。 */
export function linePresence(line, presentIds) {
    const id = text(line && line.id);
    const roster = new Set((presentIds || []).map(String));
    if (!id) return { presence: 'absent', why: '这条线没有 id' };
    return roster.has(id)
        ? { presence: 'present', why: '' }
        : { presence: 'parallel', why: '本场不在场：只记状态，不进注入' };
}

/**
 * 把多条线分成「本场可见」与「平行（不可见）」，并**明确**平行线不许进注入面。
 *
 * @param {Array} lines 线（每条 `{id, ...}`）
 * @param {Array} presentIds 本场在场 id
 * @returns {{visible:Array, parallel:Array, leaks:Array, note:string}}
 *   `leaks` 是**已被塞进本场注入面**的平行线（调用方传入 `injectedIds` 时才有）
 *   —— 它一旦非空即为缺陷，不是一种状态。
 */
export function splitLines(lines, presentIds, injectedIds) {
    const list = Array.isArray(lines) ? lines : [];
    const visible = [];
    const parallel = [];
    for (const line of list) {
        const p = linePresence(line, presentIds);
        if (p.presence === 'present') visible.push(line);
        else parallel.push(line);
    }
    const injected = new Set((injectedIds || []).map(String));
    const leaks = parallel.filter((l) => injected.has(text(l && l.id)));
    return {
        visible: visible, parallel: parallel, leaks: leaks,
        note: leaks.length
            ? '★ 有 ' + leaks.length + ' 条平行线被塞进了本场注入面（本场人会知道他不该知道的事）'
            : '平行线 ' + parallel.length + ' 条：只记状态、不进注入（将来可撞上）'
    };
}

/** 一行读数。 */
export function parallelLine(split) {
    if (!split || typeof split !== 'object') return '平行线：无读数';
    if (split.leaks.length) {
        return '平行线：在场 ' + split.visible.length + ' · 平行 ' + split.parallel.length
            + ' · ★ 泄漏 ' + split.leaks.length + '（' + split.leaks.map((l) => text(l.id)).join('/') + '）';
    }
    return '平行线：在场 ' + split.visible.length + ' · 平行 ' + split.parallel.length + '（不进注入）';
}

export default {
    OUTCOMES, DIFFICULTY_LINES,
    rollD100, setDifficulty, rollCheck, rollLine,
    linePresence, splitLines, parallelLine
};