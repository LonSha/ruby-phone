/* ========================================================
 * config/recall-injection-plan.js —— 召回注入计划（角色 / 策略 / 优先级）
 * --------------------------------------------------------
 * 缝合自 memory-plugin-research/stbme/retrieval/recall-injection-plan.js
 *   （ST-BME 的 recall plan：五注入角色 + 五策略 + 1–5 优先级 + 80 条上限 +
 *    角色→优先级→原序三段比较器）。
 *
 * 【修前本仓是什么样】`apps/memory/memory-data.js` 的 `buildPromptDirective()`
 *   把召回结果**按分数一刀切**，然后前 N 条原样铺进【记忆】块：
 *     · 分数相同就按召回顺序（= 检索代码的循环顺序）排 —— 没有第二判据；
 *     · 「这条是锚点事件还是背景交代」在注入面上根本不存在，
 *       模型看到的是一串同形短句，只能靠句子内容自己猜分量；
 *     · 带 `~`（需谨慎）的条目与可引用条目混排，越靠后的高分条目反而更靠前。
 *   后果不是崩，是**注入块读起来没有层次**：该先给的事实可能排在背景之后。
 *
 * 【本件给什么（逐条对应源，不是重写）】
 *   · 五角色 anchor / cause / pov / constraint / background，**顺序即注入顺序**；
 *   · 五策略 focused / causal / pov / timeline / balanced，各自改的是角色序
 *     （策略是「这一轮该先给什么」，不是另一套字段）；
 *   · 优先级整数 1–5（越大越先），越界即进 issues 并回落 1；
 *   · 80 条上限（超出进 issues，不静默砍）；
 *   · 重复 memoryId 进 issues（同一条注入两遍比漏一条更像 bug）；
 *   · 三段比较器：**角色 → 优先级降序 → 计划原序**，不让排序变成不稳定排序。
 *
 * 【本仓差异（照抄会坏的地方）】
 *   · 源只比较「在计划里的节点」；本仓召回结果里混着**不在计划里**的候选
 *     （例如判定为 background 而调用方没纳入），故比较器对「无计划项」给 0，
 *     由调用方排序时用稳定排序兜住 —— 本模块不假装能给它们排序。
 *   · 源的角色是外部输入；本仓在召回现场没有角色来源，故多一层
 *     `planFromCandidates()`：权限与层 → 角色、分数 → 优先级，全部确定性。
 *     这是**推断**，故规则写死在 `ROLE_BY_PERMISSION` / `PRIORITY_BY_PERMISSION` 里，
 *     不散落在调用点。
 *   · `balanced` 就是源里的默认角色序本身（anchor→background 也保留层次），
 *     其余策略只做**重排**，不删角色。
 *
 * 【纪律】
 *   ① 纯函数：不读存储、不看时间、不碰 DOM；
 *   ② 不抛：畸形结构按「没有计划」处理，绝不因计划坏掉而吞掉召回；
 *   ③ 不猜：策略非法就回落 balanced 并记 issue，不静默当合法。
 * ======================================================== */
'use strict';
/** 五注入角色。**顺序即注入顺序**，是契约的一部分。 */
export const RECALL_INJECTION_ROLES = Object.freeze([
    'anchor',
    'cause',
    'pov',
    'constraint',
    'background'
]);
/** 五策略。 */
export const RECALL_INJECTION_STRATEGIES = Object.freeze([
    'focused',
    'causal',
    'pov',
    'timeline',
    'balanced'
]);
/** 计划条数上限（源值 80，不放开）。 */
export const RECALL_INJECTION_MAX_ITEMS = 80;
/** 优先级合法区间（闭区间，整数）。 */
export const RECALL_INJECTION_PRIORITY_RANGE = Object.freeze([1, 5]);
/** 角色 → 中文标签（视图与诊断共用，不各写一份）。 */
export const ROLE_LABEL = Object.freeze({
    'anchor': '锚点',
    'cause': '因果',
    'pov': '视角',
    'constraint': '约束',
    'background': '背景'
});
/** 策略 → 角色序。balanced 即契约序本身；其余只重排。 */
const ROLE_ORDER_BY_STRATEGY = Object.freeze({
    focused: ['anchor', 'constraint', 'cause', 'pov', 'background'],
    causal: ['cause', 'anchor', 'constraint', 'pov', 'background'],
    pov: ['pov', 'anchor', 'cause', 'constraint', 'background'],
    timeline: ['anchor', 'cause', 'pov', 'background', 'constraint'],
    balanced: ['anchor', 'cause', 'pov', 'constraint', 'background']
});
/** 权限 → 角色（推断层；改动等于改注入层次）。 */
const ROLE_BY_PERMISSION = Object.freeze({
    'cite': 'anchor',
    'cautious': 'cause',
    'associate-only': 'background'
});
/** 权限 → 优先级（推断层；可引用最高，仅联想最低）。 */
const PRIORITY_BY_PERMISSION = Object.freeze({
    'cite': 5,
    'cautious': 3,
    'associate-only': 1
});
import { numOrNull } from './num-gate.js';

function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength);
}

/** 策略 → 角色序号表（非法策略按 balanced，不抛）。 */
export function roleOrderOf(strategy) {
    const s = cleanText(strategy, 32);
    const order = ROLE_ORDER_BY_STRATEGY[s] || ROLE_ORDER_BY_STRATEGY.balanced;
    return new Map(order.map((role, index) => [role, index]));
}

/**
 * 归一化一份计划。
 * @returns {{valid:boolean, issues:string[], plan:{version:number, strategy:string, items:Array}}}
 *   `issues` 非空即 `valid:false`，但 `plan` **仍返回**（调用方可以照旧注入，
 *   不因一条 issue 就整块放弃）。
 */
export function normalizeRecallInjectionPlan(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const rawItems = Array.isArray(source.items) ? source.items : [];
    const issues = [];
    if (rawItems.length > RECALL_INJECTION_MAX_ITEMS) {
        issues.push('items exceeds the ' + RECALL_INJECTION_MAX_ITEMS + '-memory limit');
    }
    const seen = new Set();
    const items = [];
    const list = rawItems.slice(0, RECALL_INJECTION_MAX_ITEMS);
    for (let index = 0; index < list.length; index += 1) {
        const rawItem = list[index] && typeof list[index] === 'object' ? list[index] : {};
        const memoryId = cleanText(rawItem.memoryId, 256);
        const role = cleanText(rawItem.role, 32);
        const priority = numOrNull(rawItem.priority);
        if (!memoryId) issues.push('items[' + index + '].memoryId is required');
        if (RECALL_INJECTION_ROLES.indexOf(role) < 0) {
            issues.push('items[' + index + '].role is invalid');
        }
        if (priority === null || !Number.isInteger(priority)
            || priority < RECALL_INJECTION_PRIORITY_RANGE[0]
            || priority > RECALL_INJECTION_PRIORITY_RANGE[1]) {
            issues.push('items[' + index + '].priority must be an integer from '
                + RECALL_INJECTION_PRIORITY_RANGE[0] + ' to ' + RECALL_INJECTION_PRIORITY_RANGE[1]);
        }
        if (memoryId && seen.has(memoryId)) {
            issues.push('items[' + index + '].memoryId is duplicated');
        }
        if (memoryId) seen.add(memoryId);
        /* 越界或读不出：一律回落 1（进 issues 已记，不再把 9 混进排序面）。 */
        const inRange = priority !== null && Number.isInteger(priority)
            && priority >= RECALL_INJECTION_PRIORITY_RANGE[0]
            && priority <= RECALL_INJECTION_PRIORITY_RANGE[1];
        items.push({
            memoryId: memoryId,
            role: role,
            priority: inRange ? priority : 1,
            reason: cleanText(rawItem.reason, 500)
        });
    }
    const strategy = cleanText(source.strategy, 32) || 'balanced';
    if (RECALL_INJECTION_STRATEGIES.indexOf(strategy) < 0) {
        issues.push('strategy is invalid');
    }
    return {
        valid: issues.length === 0,
        issues: issues,
        plan: { version: 1, strategy: strategy, items: items }
    };
}

/**
 * 从召回候选生成计划（确定性推断，不猜）。
 * @param {Array} candidates 召回条目：`{ id|memoryId, layer, _permission|permission, _score|score }`
 *   ★ 两种字段名都认：只认带下划线的私有名，外部裸对象会整批落成 background（静默降级）。
 * @param {{strategy?:string, maxItems?:number}} options
 * @returns 同 `normalizeRecallInjectionPlan` 的返回形状
 */
export function planFromCandidates(candidates, options = {}) {
    const list = Array.isArray(candidates) ? candidates : [];
    const cap = Math.max(1, Math.floor(numOrNull(options.maxItems) ?? RECALL_INJECTION_MAX_ITEMS));
    const items = [];
    for (let index = 0; index < list.length && items.length < cap; index += 1) {
        const c = list[index];
        if (!c || typeof c !== 'object') continue;
        const id = cleanText(c.id != null ? c.id : c.memoryId, 256);
        if (!id) continue;
        const perm = cleanText(c._permission != null ? c._permission : c.permission, 32);
        const role = ROLE_BY_PERMISSION[perm] || 'background';
        const base = PRIORITY_BY_PERMISSION[perm] || 1;
        /* 同权限内按分数微调：只在 1–5 内抬一格，不越过权限档（分数高不等于更重要）。 */
        const score = numOrNull(c._score != null ? c._score : c.score) ?? 0;
        const bump = score >= 1.5 ? 1 : 0;
        const lo = RECALL_INJECTION_PRIORITY_RANGE[0];
        const hi = RECALL_INJECTION_PRIORITY_RANGE[1];
        items.push({
            memoryId: id,
            role: role,
            priority: Math.max(lo, Math.min(hi, base + (base < hi ? bump : 0))),
            reason: cleanText(perm, 64)
        });
    }
    return normalizeRecallInjectionPlan({ strategy: options.strategy, items: items });
}

/**
 * 三段比较器：角色序 → 优先级降序 → 计划原序。
 * 不在计划里的节点返回 0（调用方用稳定排序兜住）。
 */
export function compareNodesByRecallInjectionPlan(plan, left, right) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const items = Array.isArray(source.items) ? source.items : [];
    if (!items.length) return 0;
    const order = roleOrderOf(source.strategy);
    const fallback = RECALL_INJECTION_ROLES.length;
    const byId = new Map();
    for (let i = 0; i < items.length; i += 1) {
        if (!byId.has(items[i].memoryId)) byId.set(items[i].memoryId, { item: items[i], index: i });
    }
    const leftHit = byId.get(String((left && (left.id != null ? left.id : left.memoryId)) || ''));
    const rightHit = byId.get(String((right && (right.id != null ? right.id : right.memoryId)) || ''));
    if (!leftHit && !rightHit) return 0;
    if (leftHit && !rightHit) return -1;
    if (!leftHit && rightHit) return 1;
    const roleDelta = (order.get(leftHit.item.role) ?? fallback) - (order.get(rightHit.item.role) ?? fallback);
    if (roleDelta !== 0) return roleDelta;
    const priorityDelta = Number(rightHit.item.priority || 0) - Number(leftHit.item.priority || 0);
    if (priorityDelta !== 0) return priorityDelta;
    return leftHit.index - rightHit.index;
}

/** 一行读数（计划长什么样，一眼可数；三态不压平）。 */
export function recallPlanLine(result) {
    const r = result && typeof result === 'object' ? result : {};
    const plan = r.plan && typeof r.plan === 'object' ? r.plan : { strategy: 'balanced', items: [] };
    const items = Array.isArray(plan.items) ? plan.items : [];
    if (!items.length) return '召回注入计划：空';
    const counts = new Map();
    for (const it of items) counts.set(it.role, (counts.get(it.role) || 0) + 1);
    const parts = RECALL_INJECTION_ROLES
        .filter((role) => counts.has(role))
        .map((role) => (ROLE_LABEL[role] || role) + ' ' + counts.get(role));
    const tail = (r.issues && r.issues.length) ? ' · 问题 ' + r.issues.length : '';
    return '召回注入计划（' + plan.strategy + '）：' + parts.join(' · ') + tail;
}

/* ── 自检 ────────────────────────────────────────────────────────────── */
export function recallInjectionPlanSelfCheck() {
    const problems = [];
    const push = (ok, label) => { if (!ok) problems.push(label); };
    /* ① 角色序即注入序：anchor 必须排在 background 之前 */
    const base = normalizeRecallInjectionPlan({
        strategy: 'balanced',
        items: [
            { memoryId: 'b', role: 'background', priority: 5 },
            { memoryId: 'a', role: 'anchor', priority: 1 }
        ]
    });
    push(base.valid, '合法计划被判非法：' + base.issues.join('; '));
    const sorted = [{ id: 'b' }, { id: 'a' }].sort((l, r) => compareNodesByRecallInjectionPlan(base.plan, l, r));
    push(sorted[0].id === 'a', '角色序未生效（anchor 应最先），实得 ' + sorted.map((x) => x.id).join(','));
    /* ② 同角色时优先级降序 */
    const same = normalizeRecallInjectionPlan({
        items: [{ memoryId: 'x', role: 'cause', priority: 1 }, { memoryId: 'y', role: 'cause', priority: 5 }]
    });
    const s2 = [{ id: 'x' }, { id: 'y' }].sort((l, r) => compareNodesByRecallInjectionPlan(same.plan, l, r));
    push(s2[0].id === 'y', '优先级降序未生效');
    /* ③ 完全并列时回原序（稳定） */
    const tie = normalizeRecallInjectionPlan({
        items: [{ memoryId: 'p', role: 'pov', priority: 3 }, { memoryId: 'q', role: 'pov', priority: 3 }]
    });
    const s3 = [{ id: 'q' }, { id: 'p' }].sort((l, r) => compareNodesByRecallInjectionPlan(tie.plan, l, r));
    push(s3.map((x) => x.id).join('') === 'pq', '并列时应回计划原序，实得 ' + s3.map((x) => x.id).join(''));
    /* ④ 越界优先级进 issues 且回落 1 */
    const bad = normalizeRecallInjectionPlan({ items: [{ memoryId: 'z', role: 'pov', priority: 9 }] });
    push(!bad.valid && bad.plan.items[0].priority === 1, '越界优先级必须进 issues 并回落 1');
    /* ⑤ 重复 id 进 issues（不合并） */
    const dup = normalizeRecallInjectionPlan({
        items: [{ memoryId: 'k', role: 'pov', priority: 1 }, { memoryId: 'k', role: 'pov', priority: 2 }]
    });
    push(!dup.valid && dup.plan.items.length === 2, '重复 id 必须进 issues 且保留两条');
    /* ⑥ 80 条上限：超出被截断且进 issues */
    const many = [];
    for (let i = 0; i < RECALL_INJECTION_MAX_ITEMS + 5; i += 1) {
        many.push({ memoryId: 'm' + i, role: 'pov', priority: 1 });
    }
    const cap = normalizeRecallInjectionPlan({ items: many });
    push(cap.plan.items.length === RECALL_INJECTION_MAX_ITEMS, '上限未生效');
    push(!cap.valid, '超上限必须进 issues');
    /* ⑦ 非法策略回落 balanced 并进 issues */
    const badStrategy = normalizeRecallInjectionPlan({ strategy: 'chaos', items: [] });
    push(badStrategy.plan.strategy === 'chaos' && !badStrategy.valid, '非法策略必须进 issues');
    push(roleOrderOf('chaos').get('anchor') === 0, '非法策略必须回落 balanced 序');
    /* ⑧ 计划外节点不参与排序（返回 0） */
    push(compareNodesByRecallInjectionPlan(base.plan, { id: 'nope' }, { id: 'nada' }) === 0, '计划外节点必须返回 0');
    /* ⑨ 推断层：权限 → 角色与优先级，且 cite > cautious > associate */
    const inferred = planFromCandidates([
        { id: 'i1', _permission: 'associate-only', _score: 0.2 },
        { id: 'i2', _permission: 'cite', _score: 0.4 },
        { id: 'i3', _permission: 'cautious', _score: 0.1 }
    ]);
    const byId = new Map(inferred.plan.items.map((it) => [it.memoryId, it]));
    push(byId.get('i2') && byId.get('i2').role === 'anchor', '可引用必须推断为锚点');
    push(byId.get('i2').priority > byId.get('i1').priority, '可引用优先级必须高于仅联想');
    /* ⑩ 空/畸形不抛，且读数不说谎 */
    let threw = false;
    try {
        normalizeRecallInjectionPlan(null);
        planFromCandidates(null, {});
        compareNodesByRecallInjectionPlan(null, null, null);
        recallPlanLine(null);
    } catch (_e) { threw = true; }
    push(!threw, '空输入不得抛');
    push(recallPlanLine(base).indexOf('锚点 1') > 0, '读数必须报出角色与条数');
    return { ok: problems.length === 0, problems: problems };
}

export default {
    RECALL_INJECTION_ROLES, RECALL_INJECTION_STRATEGIES, RECALL_INJECTION_MAX_ITEMS,
    RECALL_INJECTION_PRIORITY_RANGE, ROLE_LABEL, roleOrderOf,
    normalizeRecallInjectionPlan, planFromCandidates, compareNodesByRecallInjectionPlan,
    recallPlanLine, recallInjectionPlanSelfCheck
};
