/**
 * config/random-source.js — 可强制随机源 [R26-X5]
 *
 * 缝自 myworld：`G.forceGlitch || Math.random()*100 < S.glitch` ——
 * 每个随机判定都留了一个「强制口」，排查时能把一次偶发复现成必定发生。
 *
 * 【本仓的真洞（实测）】
 * grep -c 'Math.random' config/ + index.js 共 81 处，零可强制口。
 * 意思是：任何「偶尔才会出现」的现象（抽卡、抖动、采样、渲染偶发丢帧）
 * 只能靠反复刷；刷不出来就说不清。
 *
 * 【纪律】
 *   ① 默认源必须是 Math.random 本体：不许自己实现伪随机当默认（那会把真随机性质换掉）。
 *   ② 强制源必须可撤销（undo），撤销后必须回到原样。
 *   ③ 强制序列耗尽必须报错，绝不静默回落到 Math.random —— 静默回落 = 假复现。
 *   ④ activeMode() / isForced() 让读数看得出此刻是不是被强制；报表不许把强制态当真实态。
 *   ⑤ 种子源只为复现，不进产品默认路径。
 */
import { numOrNull } from './num-gate.js';

/** 随机源的三种模式。 */
export const RANDOM_MODE = Object.freeze({ NATIVE: 'native', FORCED: 'forced', SEEDED: 'seeded' });

/** 当前挂着的源。null = 原生 Math.random。 */
let _source = null;

/** 此刻是不是被强制（含种子源）。 */
export function isForced() {
    return _source !== null;
}

/** 此刻的模式。 */
export function activeMode() {
    return _source === null ? RANDOM_MODE.NATIVE : _source.mode;
}

/**
 * 换源。返回 undo：调一次就回到换之前（可嵌套，但只能按栈序撤）。
 */
export function setSource(fn, mode) {
    if (typeof fn !== 'function') throw new TypeError('random-source: 源必须是函数');
    const prev = _source;
    _source = { mode: mode === RANDOM_MODE.SEEDED ? RANDOM_MODE.SEEDED : RANDOM_MODE.FORCED, next: fn };
    let used = false;
    return function undo() {
        if (used) return false;
        used = true;
        _source = prev;
        return true;
    };
}

/** 无条件回原生（紧急出口）。 */
export function resetSource() {
    _source = null;
    return RANDOM_MODE.NATIVE;
}

/** 取一个 [0,1) 的数。产品代码只走这个口。 */
export function rand() {
    if (_source === null) return Math.random();
    return _source.next();
}

/** 整数 [min, max]。参数不对就炸，不许静默钳到边界。 */
export function randInt(min, max) {
    const a = numOrNull(min);
    const b = numOrNull(max);
    if (a === null || b === null) throw new TypeError('random-source: randInt 需要两个数字');
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new TypeError('random-source: randInt 只收整数');
    if (a > b) throw new RangeError('random-source: randInt 的 min 大于 max');
    return a + Math.floor(rand() * (b - a + 1));
}

/** 百分比判定。0 永不中、100 必中、其余按比例；越界/非法就炸。 */
export function chance(percent) {
    const p = numOrNull(percent);
    if (p === null) throw new TypeError('random-source: chance 需要数字');
    if (p < 0 || p > 100) throw new RangeError('random-source: chance 只收 0..100');
    if (p === 0) return false;
    if (p === 100) return true;
    return rand() * 100 < p;
}

/** 从数组里挑一个。空数组就炸（返回 undefined 会变成“悄悄什么都没发生”）。 */
export function pick(list) {
    if (!Array.isArray(list) || list.length === 0) throw new TypeError('random-source: pick 需要非空数组');
    return list[randInt(0, list.length - 1)];
}

/**
 * 强制序列：按给定顺序吐出。
 * 耗尽时 **抛错**（不许回落原生）：静默回落会让一次复现变成“看起来复现了”。
 */
export function forcedSequence(values) {
    if (!Array.isArray(values) || values.length === 0) throw new TypeError('random-source: 序列需要非空数组');
    const seq = values.map(function (v) {
        const n = numOrNull(v);
        if (n === null) throw new TypeError('random-source: 序列元素必须是数字');
        return n;
    });
    let i = 0;
    return {
        mode: RANDOM_MODE.FORCED,
        remaining: function () { return seq.length - i; },
        next: function () {
            if (i >= seq.length) throw new Error('random-source: 强制序列已耗尽（remaining=0），拒绝回落原生');
            const v = seq[i];
            i += 1;
            return v;
        }
    };
}

/** 把 forcedSequence 挂上，返回 undo。 */
export function useSequence(values) {
    const s = forcedSequence(values);
    const undo = setSource(s.next, RANDOM_MODE.FORCED);
    return { undo: undo, remaining: s.remaining };
}

/** mulberry32：只为复现，不进产品默认路径。 */
export function seededSequence(seed) {
    let a = numOrNull(seed) === null ? 1 : Math.floor(numOrNull(seed)) >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 挂种子源（复现用），返回 undo。 */
export function useSeed(seed) {
    return setSource(seededSequence(seed), RANDOM_MODE.SEEDED);
}

/** 一行读数。 */
export function randomSourceText() {
    const m = activeMode();
    if (m === RANDOM_MODE.NATIVE) return '随机源：原生 Math.random（未被强制）';
    return '随机源：**已被强制**（' + m + '）——此刻读数不能当真实概率';
}

/** 自检：纯逻辑，不动真随机性质。 */
export function randomSourceSelfCheck() {
    const bad = [];
    if (activeMode() !== RANDOM_MODE.NATIVE || isForced()) bad.push('自检开始时随机源不该被强制');
    for (let i = 0; i < 8; i += 1) {
        const v = rand();
        if (!(v >= 0 && v < 1)) bad.push('原生源越界：' + v);
    }
    const undo = setSource(function () { return 0.5; });
    if (!isForced() || activeMode() !== RANDOM_MODE.FORCED) bad.push('setSource 后应处于 forced');
    if (rand() !== 0.5) bad.push('强制源未生效');
    if (randInt(1, 1) !== 1) bad.push('randInt 单点区间错');
    if (chance(0) !== false || chance(100) !== true) bad.push('chance 边界错');
    if (chance(1) !== false) bad.push('rand=0.5 时 chance(1) 应不中（比例判定不等于必中）');
    if (chance(99) !== true) bad.push('rand=0.5 时 chance(99) 应中');
    if (undo() !== true) bad.push('undo 第一次应成功');
    if (isForced()) bad.push('undo 后应回到原生');
    if (undo() !== false) bad.push('undo 重复调用应返回 false');

    const seq = useSequence([0.1, 0.2]);
    if (rand() !== 0.1 || rand() !== 0.2) bad.push('强制序列顺序错');
    if (seq.remaining() !== 0) bad.push('序列余量错');
    let threw = false;
    try { rand(); } catch (e) { threw = true; }
    if (!threw) bad.push('序列耗尽必须抛错（不许回落原生）');
    seq.undo();
    if (isForced()) bad.push('序列 undo 后应回原生');

    const s1 = seededSequence(42);
    const s2 = seededSequence(42);
    const a1 = [s1(), s1(), s1()].join(',');
    const a2 = [s2(), s2(), s2()].join(',');
    if (a1 !== a2) bad.push('同种子必须同序列（否则不能复现）');
    if (seededSequence(42)() < 0 || seededSequence(42)() >= 1) bad.push('种子源越界');

    let t1 = false;
    try { chance(101); } catch (e) { t1 = true; }
    if (!t1) bad.push('chance 越界必须报错');
    let t2 = false;
    try { randInt(3, 1); } catch (e) { t2 = true; }
    if (!t2) bad.push('randInt min>max 必须报错');
    let t3 = false;
    try { pick([]); } catch (e) { t3 = true; }
    if (!t3) bad.push('pick 空数组必须报错');
    if (pick(['x']) !== 'x') bad.push('pick 单元素错');
    if (resetSource() !== RANDOM_MODE.NATIVE || isForced()) bad.push('resetSource 未回原生');
    if (!randomSourceText().includes('原生')) bad.push('原生读数应有说明');
    return { ok: bad.length === 0, bad: bad };
}

export default {
    RANDOM_MODE, isForced, activeMode, setSource, resetSource, rand, randInt,
    chance, pick, forcedSequence, useSequence, seededSequence, useSeed,
    randomSourceText, randomSourceSelfCheck
};
