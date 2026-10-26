/* ========================================================
 * config/activation-diffusion.js —— 图上的能量传播检索
 * --------------------------------------------------------
 * 缝合自 memory-plugin-research/stbme/retrieval/diffusion.js
 *   （ST-BME 的 PEDSA：Parallel Energy-Decay Spreading Activation，
 *    原作者从 PeroCore 的 Rust CognitiveGraphEngine 移植成纯 JS）。
 *
 * 本仓为什么需要它：`apps/memory/graph-bridge.js` 的 `search()` 只有
 *   **一跳邻居 + 固定 0.5 分**（`_score: 0.5`）。于是「A 认识 B、B 认识 C」
 *   在检索面上是一模一样的两条边，命中强度不衰减、抑制关系（前妻/仇人）也不
 *   带负分，排序只能靠命中顺序。图明明存了强弱与关系类型，检索面却全丢。
 *
 * 保留的机制（逐条对应源实现，不是重写）：
 *   · 每步传播乘 `decayFactor`（默认 0.6）——「隔一层就弱一层」；
 *   · 抑制边（edgeType === INHIBIT_EDGE_TYPE）传**负能量**并乘 `inhibitMultiplier`；
 *   · 每步只保留绝对值 Top-K（默认 100）—— 攻击面有界；
 *   · 能量钳位 `[-2.0, 2.0]`，低于 `minEnergy`（0.01）视为不活跃；
 *   · 可选 PPR 回拉（`teleportAlpha`），把种子能量按比例拉回来防漂移；
 *   · 累积结果取**各步绝对值最大**，不是最后一步（最后一步会把被衰减掉的强命中丢掉）；
 *   · 没有活跃节点即提前终止。
 *
 * 与源的差异（都写在这里，免得后来者以为是漏）：
 *   · 源用 `Map<string, Array<…>>` 邻接表；本仓图是边数组（`{from,to,strength,label}`），
 *     所以多一层 `buildAdjacency(edges)`，把边数组折成邻接表 —— 调用侧不必自己拼；
 *   · 源导出 `diffuseAndRank` 只留正能量；本仓多给一个 `diffuseWithSuppression`
 *     同时返回负能量条目，好让 UI 能画「这条是被谁压下去的」；
 *   · 源的 `minEnergy_clamp` 键名带下划线，本仓归一成 `minEnergyClamp`，
 *     但**两个键都认**（`opts.minEnergyClamp ?? opts.minEnergy_clamp`）。
 *
 * 边界（诚实两条）：
 *   · 拓扑只到「边数组折邻接表」这一层，不做社区发现/聚类；
 *   · 全部是确定性算术，无随机、无时钟，同一份输入必得同一份输出（自检里锁这点）。
 * ======================================================== */
'use strict';
/* [v4.89.0] 数值取值走全仓唯一的门（本文件原先就地写了份 `numOr` 弱口径抄件）。 */
import { numOrNull } from './num-gate.js';

/** 抑制边类型标记（与源一致：255） */
export const INHIBIT_EDGE_TYPE = 255;

/** 默认配置 —— 每个数都是源里的原值，改这里等于改行为 */
export const DIFFUSION_DEFAULTS = Object.freeze({
    maxSteps: 2,
    decayFactor: 0.6,
    topK: 100,
    minEnergy: 0.01,
    maxEnergy: 2.0,
    minEnergyClamp: -2.0,
    teleportAlpha: 0.0,
    inhibitMultiplier: 2.0
});

/* 保留局部名 `numOr`（带默认值的调用语义），实现交给 numOrNull —— 不再就地复制口径。
 *   注意语义差别：numOrNull 把 `''` / `[]` / `true` 判「没给」（回落默认），这正是本仓要的。 */
const numOr = (v, d) => {
    const n = numOrNull(v);
    return n === null ? d : n;
};

function clampEnergy(energy, opts) {
    const lo = numOr(opts.minEnergyClamp ?? opts.minEnergy_clamp, DIFFUSION_DEFAULTS.minEnergyClamp);
    const hi = numOr(opts.maxEnergy, DIFFUSION_DEFAULTS.maxEnergy);
    return Math.max(lo, Math.min(hi, energy));
}

function clamp01(value) {
    return Math.max(0, Math.min(1, numOr(value, 0)));
}

function normalizeOptions(options = {}) {
    const o = options && typeof options === 'object' ? options : {};
    return {
        maxSteps: Math.max(0, Math.floor(numOr(o.maxSteps, DIFFUSION_DEFAULTS.maxSteps))),
        decayFactor: Math.max(0, numOr(o.decayFactor, DIFFUSION_DEFAULTS.decayFactor)),
        topK: Math.max(1, Math.floor(numOr(o.topK, DIFFUSION_DEFAULTS.topK))),
        minEnergy: Math.max(0, numOr(o.minEnergy, DIFFUSION_DEFAULTS.minEnergy)),
        maxEnergy: numOr(o.maxEnergy, DIFFUSION_DEFAULTS.maxEnergy),
        minEnergyClamp: numOr(o.minEnergyClamp ?? o.minEnergy_clamp, DIFFUSION_DEFAULTS.minEnergyClamp),
        teleportAlpha: clamp01(o.teleportAlpha),
        inhibitMultiplier: Math.max(0, numOr(o.inhibitMultiplier, DIFFUSION_DEFAULTS.inhibitMultiplier))
    };
}

/**
 * 把本仓的边数组折成邻接表。
 *   `strength` 缺省按 1 处理（源里由建图侧保证，这里兜底，免得漏一个字段就整条边失效）；
 *   `label` 落到 `edgeType`：抑制类关系（仇人/前妻/敌对…）走 `INHIBIT_EDGE_TYPE`。
 */
export const INHIBIT_LABELS = Object.freeze(['仇人', '前妻', '前夫', '敌对', '宿敌', '决裂', '闹翻', '讨厌', 'enemy', 'rival']);

export function edgeTypeOf(edge) {
    const raw = edge?.edgeType ?? edge?.label ?? edge?.type;
    /* 只认真正的 number（字符串留给下面的 label 分支：`'1'` 与 `'仇人'` 走同一条判定更稳）。 */
    if (typeof raw === 'number') {
        const n = numOrNull(raw);
        if (n !== null) return n;
    }
    const text = String(raw ?? '').trim().toLowerCase();
    return INHIBIT_LABELS.some((k) => text.includes(k.toLowerCase())) ? INHIBIT_EDGE_TYPE : 0;
}

export function buildAdjacency(edges = []) {
    const map = new Map();
    for (const e of Array.isArray(edges) ? edges : []) {
        if (!e || e.from == null || e.to == null) continue;
        const key = String(e.from);
        const list = map.get(key) || [];
        list.push({
            targetId: String(e.to),
            strength: Math.abs(numOr(e.strength ?? e.weight, 1)),
            edgeType: edgeTypeOf(e)
        });
        map.set(key, list);
    }
    return map;
}

/**
 * 执行一步一轮的扩散激活。
 * @param {Map<string, Array<{targetId: string, strength: number, edgeType: number}>>} adjacencyMap
 * @param {Array<{id: string, energy: number}>} seedNodes
 * @returns {Map<string, number>} 节点 → 最终能量（正=激活，负=被抑制）
 */
export function propagateActivation(adjacencyMap, seedNodes, options = {}) {
    const opts = normalizeOptions(options);
    const adjacency = adjacencyMap instanceof Map ? adjacencyMap : new Map();
    const teleportAlpha = opts.teleportAlpha;

    let currentEnergy = new Map();
    const initialEnergy = new Map();
    for (const seed of Array.isArray(seedNodes) ? seedNodes : []) {
        if (!seed || seed.id == null) continue;
        const clamped = clampEnergy(numOr(seed.energy, 0), opts);
        const minEnergy = opts.minEnergy;
        if (Math.abs(clamped) >= minEnergy) {
            const id = String(seed.id);
            const merged = clampEnergy((currentEnergy.get(id) || 0) + clamped, opts);
            currentEnergy.set(id, merged);
            initialEnergy.set(id, merged);
        }
    }

    const result = new Map(currentEnergy);

    for (let step = 0; step < opts.maxSteps; step += 1) {
        let nextEnergy = new Map();
        for (const [nodeId, energy] of currentEnergy) {
            const neighbors = adjacency.get(nodeId);
            if (!Array.isArray(neighbors) || neighbors.length === 0) continue;
            for (const neighbor of neighbors) {
                if (!neighbor || neighbor.targetId == null) continue;
                const strength = Math.abs(numOr(neighbor.strength, 0));
                let propagated;
                if (neighbor.edgeType === INHIBIT_EDGE_TYPE) {
                    /* 抑制边：传的是 |energy| 的负数 —— 负号来自「抑制」这件事本身，
                     *   与上一步能量的正负无关（上游被压下去的节点，它的抑制边依旧是抑制）。 */
                    propagated = -Math.abs(energy) * strength * opts.decayFactor * (opts.inhibitMultiplier || 1);
                } else {
                    propagated = energy * strength * opts.decayFactor * (1 - teleportAlpha);
                }
                const merged = (nextEnergy.get(neighbor.targetId) || 0) + propagated;
                nextEnergy.set(neighbor.targetId, merged);
            }
        }

        for (const [nodeId, energy] of nextEnergy) {
            const clamped = clampEnergy(energy, opts);
            if (Math.abs(clamped) < opts.minEnergy) nextEnergy.delete(nodeId);
            else nextEnergy.set(nodeId, clamped);
        }

        if (teleportAlpha > 0) {
            for (const [nodeId, seedEnergy] of initialEnergy) {
                const current = nextEnergy.get(nodeId) || 0;
                const teleported = (1 - teleportAlpha) * current + teleportAlpha * seedEnergy;
                const clamped = clampEnergy(teleported, opts);
                if (Math.abs(clamped) >= opts.minEnergy) nextEnergy.set(nodeId, clamped);
                else nextEnergy.delete(nodeId);
            }
        }

        if (nextEnergy.size > opts.topK) {
            const sorted = [...nextEnergy.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
            nextEnergy = new Map(sorted.slice(0, opts.topK));
        }

        /* 累积取绝对值最大：被衰减下来的强命中不该输给后一步的弱命中 */
        for (const [nodeId, energy] of nextEnergy) {
            const seen = result.get(nodeId) || 0;
            if (Math.abs(energy) > Math.abs(seen)) result.set(nodeId, energy);
        }

        currentEnergy = nextEnergy;
        if (currentEnergy.size === 0) break;
    }

    return result;
}

/** 只留正能量，按能量降序（同分按 id 字典序 —— 稳定，便于复算） */
export function diffuseAndRank(adjacencyMap, seeds, options = {}) {
    const energyMap = propagateActivation(adjacencyMap, seeds, options);
    return [...energyMap.entries()]
        .filter(([, energy]) => energy > 0)
        .map(([nodeId, energy]) => ({ nodeId, energy }))
        .sort((a, b) => (b.energy !== a.energy ? b.energy - a.energy : String(a.nodeId).localeCompare(String(b.nodeId))));
}

/**
 * 兼顾抑制面：正能量在前、负能量在后，各自按绝对值降序。
 * UI 拿 `suppressed` 就能画「这条是被谁压下去的」，不用自己再跑一遍。
 */
export function diffuseWithSuppression(adjacencyMap, seeds, options = {}) {
    const energyMap = propagateActivation(adjacencyMap, seeds, options);
    const active = [];
    const suppressed = [];
    for (const [nodeId, energy] of energyMap) {
        (energy >= 0 ? active : suppressed).push({ nodeId, energy });
    }
    const byAbs = (a, b) => Math.abs(b.energy) - Math.abs(a.energy) || String(a.nodeId).localeCompare(String(b.nodeId));
    active.sort(byAbs);
    suppressed.sort(byAbs);
    return { active, suppressed, total: energyMap.size };
}

/**
 * 给本仓图用的便捷入口：边数组 + 种子，直接出排序。
 *   `seeds` 可以是 `[{id, energy}]`，也可以是 `id` 字符串数组（默认给 1.0 能量）。
 */
export function diffuseGraph(edges, seeds, options = {}) {
    const normSeeds = (Array.isArray(seeds) ? seeds : []).map((s) =>
        (s && typeof s === 'object' ? { id: s.id, energy: s.energy } : { id: s, energy: 1 }));
    return diffuseWithSuppression(buildAdjacency(edges), normSeeds, options);
}

/**
 * 一行读数。`result` 是 `diffuseGraph` / `diffuseWithSuppression` 的返回（Map: id → 能量）。
 *   没有实况时**如实说未取**，不编「0 个节点」冒充跑过。
 */
export function diffusionLine(result) {
    if (!(result instanceof Map)) return '激活扩散：未取实况';
    if (result.size === 0) return '激活扩散：空';
    const ranked = [...result.entries()].sort((x, y) => y[1] - x[1]);
    const top = ranked.slice(0, 3).map(([id, energy]) => String(id) + ' ' + Number(energy).toFixed(2));
    return '激活扩散：' + result.size + ' 个节点，最强 ' + top.join(' / ');
}

/* ── 自检 ────────────────────────────────────────────────────────────── */
export function activationDiffusionSelfCheck() {
    const problems = [];
    const push = (ok, label) => { if (!ok) problems.push(label); };

    /* ① 衰减：隔一层必须弱一层（这是整套机制的立身之本） */
    const chain = [{ from: 'a', to: 'b', strength: 1 }, { from: 'b', to: 'c', strength: 1 }];
    const r1 = propagateActivation(buildAdjacency(chain), [{ id: 'a', energy: 2 }]);
    const bEnergy = r1.get('b') || 0;
    const cEnergy = r1.get('c') || 0;
    push(bEnergy > 0 && cEnergy > 0, '两层都要传到');
    push(cEnergy < bEnergy, '第二层必须弱于第一层（衰减没生效：' + cEnergy + ' vs ' + bEnergy + '）');

    /* ② 抑制：抑制边传负能量，且不受上游正负影响 */
    const inh = [{ from: 'a', to: 'b', strength: 1, edgeType: INHIBIT_EDGE_TYPE }];
    const r2 = propagateActivation(buildAdjacency(inh), [{ id: 'a', energy: 1 }]);
    push((r2.get('b') || 0) < 0, '抑制边必须传负能量，实得 ' + String(r2.get('b')));

    /* ③ 钳位：再大的种子也压不进 ±maxEnergy 之外 */
    const r3 = propagateActivation(new Map(), [{ id: 'x', energy: 99 }], { maxEnergy: 2 });
    push((r3.get('x') || 0) <= 2, '能源必须被钳到 maxEnergy，实得 ' + String(r3.get('x')));

    /* ④ Top-K 有界 */
    const wide = [];
    for (let i = 0; i < 50; i += 1) wide.push({ from: 'hub', to: 'n' + i, strength: 1 });
    const r4 = propagateActivation(buildAdjacency(wide), [{ id: 'hub', energy: 2 }], { topK: 7, maxSteps: 1 });
    push(r4.size <= 8, 'Top-K 必须有界（seed+7 以内），实得 ' + r4.size);

    /* ⑤ 确定性：同输入两次必同输出 */
    const a5 = JSON.stringify([...propagateActivation(buildAdjacency(chain), [{ id: 'a', energy: 2 }])]);
    const b5 = JSON.stringify([...propagateActivation(buildAdjacency(chain), [{ id: 'a', energy: 2 }])]);
    push(a5 === b5, '同一份输入必须复算出同一份输出');

    /* ⑥ 键名兼容：minEnergyClamp 与源的下划线键都认 */
    const r6a = propagateActivation(new Map(), [{ id: 'z', energy: -9 }], { minEnergyClamp: -1 });
    const r6b = propagateActivation(new Map(), [{ id: 'z', energy: -9 }], { minEnergy_clamp: -1 });
    push(r6a.get('z') === r6b.get('z'), '两种键名必须同效');

    /* ⑦ 抑制标签识别 */
    push(edgeTypeOf({ label: '仇人' }) === INHIBIT_EDGE_TYPE, '「仇人」必须识别为抑制边');
    push(edgeTypeOf({ label: '同事' }) === 0, '「同事」不得被识别为抑制边');

    /* ⑧ 断层：没有邻居不抛、不产出垃圾 */
    push(propagateActivation(buildAdjacency([{ from: 'p', to: 'q' }]), [{ id: 'solo', energy: 1 }]).get('solo') === 1,
        '孤立种子必须原样保留且不外扩');

    /* ⑨ 空输入不抛 */
    let threw = false;
    try { propagateActivation(new Map(), []); diffuseGraph([], []); } catch (_e) { threw = true; }
    push(!threw, '空输入不得抛');

    return { ok: problems.length === 0, problems };
}

export default {
    INHIBIT_EDGE_TYPE, INHIBIT_LABELS, DIFFUSION_DEFAULTS,
    edgeTypeOf, buildAdjacency, propagateActivation, diffuseAndRank, diffuseWithSuppression, diffuseGraph,
    activationDiffusionSelfCheck
};