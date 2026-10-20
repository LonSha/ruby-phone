/* ============================================================
 * config/goal-tree-contract.js — [v4.38.0 · 第五期 R5-X2 把大目标拆成可推进的剧情任务]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   上游 M5-X2（长期目标的前置条件与下一步记忆）在**本版尚未实现** —— 本件按计划
 *   原文「先做计划编辑后接事实状态」先落**手机侧的纯计划模式**：目标树、前置条件、
 *   下一步入口全在手机上编辑，读数里**明说**「这是你的计划，不是已发生的事实」。
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   `apps/plotline` 已有「线索与未完事项板」（v4.27.0 · R4-X6），它能列**账里有什么**，
 *   但**没有任何一格能表达用户自己的目标与前置条件**：全仓零 `goal` / `prereq` /
 *   `blocked` 命中。于是用户想把「搬家」拆成「签约 → 取钥匙 → 搬东西」时，
 *   只能在聊天里自己记 —— 而手机里那一屏永远只显示**已经发生的事**。
 *
 * 【三件必须分形（本仓最贵的老账）】
 *   ① **用户计划**（勾选）与**事实达成**（证据/确认）不是同一件事：
 *      勾了「签约完成」不等于剧情里签了约。故 `planDone` 与 `factState` 分列，
 *      且**读数句各说各的**。
 *   ② **受阻**（前置没完成）与**缺数据**（前置根本没记）处置相反：
 *      前者是「先去做那件事」，后者是「这条依赖没人知道」。压成一格会让用户
 *      以为系统知道顺序、而其实什么都没记。
 *   ③ **上游不在场**（没有事实面）与**上游在场但没有这一条**（这件没发生过）
 *      同规于本仓既有口径：前者是「问不了」，后者是「确实没有」。
 *
 * 【不做（计划原文）】不做团队协作平台；**不以九宫格计数充当任务推进**
 *   —— 故本件**不产**任何分数/进度百分比（`FORBIDDEN_KEYS` 自检真跑）。
 * ============================================================ */

/** 目标树面态（互不相同：压平任意两态即造出处置相反的处境长得一样）。 */
export const GT_STATES = Object.freeze({
    ABSENT: 'absent',            // 上游不在场：没有事实面（纯计划模式仍可用）
    NO_GOAL: 'no-goal',          // 上游在场，但这一条目标没记过（与「问不了」相反）
    PLANNED: 'planned',          // 只有用户计划（本版默认：没有事实面）
    TRACKED: 'tracked',          // 有事实面，逐条给计划 vs 事实
    UNREADABLE: 'unreadable',    // 取数抛了（如实报，不假装没有）
});

/** 计划态（**用户勾选**）与事实态（**证据/确认**）分列的两套词表。 */
export const GT_PLAN = Object.freeze({ TODO: 'todo', DONE: 'done' });
export const GT_FACT = Object.freeze({
    UNKNOWN: 'unknown',          // 事实面没给这一条（**不是**「没完成」）
    PENDING: 'pending',          // 事实面说还没发生
    DONE: 'done',                // 事实面说已发生（有证据/确认）
    BLOCKED: 'blocked',          // 事实面说被挡（前置未达成）
});

/** 一步的受阻态（与「缺数据」分形）。 */
export const GT_BLOCK = Object.freeze({
    READY: 'ready',              // 前置都完成（或没有前置）
    WAITING: 'waiting',          // 前置**已知**未完成 ⇒ 先说清该先做哪一件
    UNDECLARED: 'undeclared',    // 前置**根本没记** ⇒ 判不了顺序（不猜）
});

export const GT_LIMITS = Object.freeze({
    depth: 3,        // 目标树最多展开三层（计划原文验收「展开三层」）
    steps: 40,       // 一次最多列几步
});

/** 读数里**不得出现**的键名（分数 / 进度 / 优先级一族）。 */
export const GT_FORBIDDEN_KEYS = Object.freeze([
    'percent', 'percentage', 'progress', 'confidence', 'score', 'probability', 'weight', 'rank', 'priority',
]);

function str(v) { return String(v == null ? '' : v).trim(); }
function strList(v, cap) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const x of v) { const t = str(x); if (t && out.indexOf(t) < 0) out.push(t); if (out.length >= cap) break; }
    return out;
}

/**
 * 派发相：有事实面走 `tracked`；只有计划则 `planned`；两样都没有则 `absent`。
 *   严格判 true（非 true 一律当「没有」）。
 */
export function planGoalState(hasFacts, hasPlan) {
    if (hasFacts === true) return GT_STATES.TRACKED;
    if (hasPlan === true) return GT_STATES.PLANNED;
    return GT_STATES.ABSENT;
}

/**
 * 归一一条目标（含它的一层前置与下一步）。
 *
 * 【为什么 `planDone` 与 `factState` 必须两个格子】
 *   勾选只表达**用户计划**；事实达成必须由证据/确认产生（计划原文）。
 *   合成一格就会出现「用户勾了一下，界面说这件事发生了」——
 *   而那正是本项要治的那类错读数。
 *
 * @param {object|null} recv 上游回执（或 null）
 * @param {object} [opts] { planDone:boolean, hasPlan:boolean }
 */
export function normalizeGoalNode(recv, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const r = (recv && typeof recv === 'object') ? recv : null;
    const base = {
        state: GT_STATES.ABSENT, goal: '', planDone: false, factState: GT_FACT.UNKNOWN,
        prereqs: [], next: '', why: '', writesNothing: true,
    };
    if (!r) {
        return Object.assign({}, base, {
            state: o.hasPlan === true ? GT_STATES.PLANNED : GT_STATES.ABSENT,
            planDone: o.planDone === true,
            why: o.hasPlan === true
                ? '本版插件没有目标事实面：这一屏只作**计划**（你勾的只表示你想做什么）'
                : '插件不在场：目标读不到（计划仍可写在手机上）',
        });
    }
    if (r.unreadable === true || r.thrown === true) {
        return Object.assign({}, base, {
            state: GT_STATES.UNREADABLE, goal: str(r.goal),
            why: '取数失败（已降级）—— 这是「读不到」，**不是**「没有这个目标」',
        });
    }
    const goal = str(r.goal || r.name);
    const hasRel = !!(goal || str(r.next) || (Array.isArray(r.prereqs) && r.prereqs.length));
    if (!hasRel) {
        return Object.assign({}, base, {
            state: GT_STATES.NO_GOAL, goal: goal,
            why: '上游**没有**这个目标（不是「问不了」—— 上游在场，只是没记过这一条）',
        });
    }
    const prereqs = (Array.isArray(r.prereqs) ? r.prereqs : []).slice(0, GT_LIMITS.steps).map((p) => {
        const e = (p && typeof p === 'object') ? p : {};
        const fact = Object.values(GT_FACT).indexOf(str(e.factState)) >= 0 ? str(e.factState) : GT_FACT.UNKNOWN;
        return { id: str(e.id), label: str(e.label || e.goal), factState: fact, declared: e.declared !== false };
    });
    /* 受阻态：前置**已知**未完成 ⇒ waiting；前置**根本没记** ⇒ undeclared。 */
    let block = GT_BLOCK.READY;
    if (prereqs.length) {
        const undeclared = prereqs.filter((p) => p.declared === false || p.factState === GT_FACT.UNKNOWN);
        const waiting = prereqs.filter((p) => p.factState === GT_FACT.PENDING || p.factState === GT_FACT.BLOCKED);
        if (waiting.length) block = GT_BLOCK.WAITING;
        else if (undeclared.length) block = GT_BLOCK.UNDECLARED;
    }
    return Object.assign({}, base, {
        state: GT_STATES.TRACKED, goal: goal,
        planDone: o.planDone === true,
        factState: Object.values(GT_FACT).indexOf(str(r.factState)) >= 0 ? str(r.factState) : GT_FACT.UNKNOWN,
        prereqs: prereqs, next: str(r.next), block: block,
        why: '',
    });
}

/**
 * 一步的受阻读数（**唯一出处**）。
 *   三态必须分句：**可以做** / **先做那一件** / **判不了顺序**。
 */
export function stepGateLine(node) {
    const n = (node && typeof node === 'object') ? node : null;
    if (!n) return '判不了（没有这一条）';
    if (n.state === GT_STATES.UNREADABLE) return '判不了（读不到 ≠ 没有这个目标）';
    if (n.state === GT_STATES.ABSENT) return '判不了（插件不在场；计划仍可写在手机上）';
    if (n.state === GT_STATES.NO_GOAL) return '判不了（上游没记过这个目标）';
    if (n.state === GT_STATES.PLANNED) {
        return n.planDone ? '你在计划里勾了「做完」（**只表示你的计划**，不是事实）'
            : '你在计划里还没勾（勾选只表达计划）';
    }
    if (n.block === GT_BLOCK.WAITING) {
        const wait = n.prereqs.filter((p) => p.factState === GT_FACT.PENDING || p.factState === GT_FACT.BLOCKED)
            .map((p) => p.label || p.id).filter(Boolean);
        return '先做：' + (wait.join(' / ') || '（前置未具名）') + '（这几件事实面上还没完成）';
    }
    if (n.block === GT_BLOCK.UNDECLARED) {
        return '判不了顺序：这条目标的前置**没人记过**（不是「没有前置」）';
    }
    if (n.factState === GT_FACT.DONE) return '可以做：事实面上这一条已达成';
    if (n.factState === GT_FACT.PENDING) return '还没到：事实面上这一条尚未发生';
    return '可以做（没有前置；事实面这一条未标注）';
}

/**
 * 计划 vs 事实的那一句（本项验收原文点名的那一问）。
 *   三态分句：**只勾了** / **事实也达成** / **勾了但事实没有**（最要紧的一格）。
 */
export function planVsFactLine(node) {
    const n = (node && typeof node === 'object') ? node : null;
    if (!n) return '判不了（没有这一条）';
    if (n.state === GT_STATES.PLANNED) {
        return n.planDone
            ? '计划：你勾了「做完」——**这是你的计划，不是已发生的事实**（上游没有事实面）'
            : '计划：还没勾（上游没有事实面，故只有计划这一侧）';
    }
    if (n.state !== GT_STATES.TRACKED) return '判不了（' + stepGateLine(n) + '）';
    const fact = n.factState;
    if (n.planDone && fact === GT_FACT.DONE) return '计划已勾 · 事实面也已达成';
    if (n.planDone && fact !== GT_FACT.DONE) {
        return '★ 计划勾了「做完」，但事实面**还没有**（' + (fact === GT_FACT.PENDING ? '尚未发生' : (fact === GT_FACT.BLOCKED ? '被挡' : '未标注'))
            + '）—— 勾选只表达你的计划';
    }
    if (!n.planDone && fact === GT_FACT.DONE) return '事实面已达成，但你还没在计划里勾（两件事分开记）';
    return '计划未勾 · 事实面也未达成';
}

/**
 * 目标树 → 按层展开的行（**最多三层**，计划原文验收「展开三层」）。
 *   超深的层**如实报被截断**，不静默丢。
 */
export function goalTreeRows(root, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const maxDepth = Number.isFinite(Number(o.depth)) && Number(o.depth) > 0
        ? Math.min(Number(o.depth), GT_LIMITS.depth) : GT_LIMITS.depth;
    const rows = [];
    let truncated = 0;
    const walk = (node, depth) => {
        if (!node || typeof node !== 'object') return;
        if (depth > maxDepth) { truncated += 1; return; }
        rows.push({
            depth: depth,
            goal: str(node.goal || node.label),
            line: stepGateLine(normalizeGoalNode(node, { planDone: node.planDone === true, hasPlan: true })),
        });
        const kids = Array.isArray(node.children) ? node.children : [];
        for (const k of kids) walk(k, depth + 1);
    };
    walk(root, 1);
    return { rows: rows.slice(0, GT_LIMITS.steps), truncated: truncated, depth: maxDepth };
}

/** 判据自证（十项）。 */
export function goalTreeSelfCheck() {
    const problems = [];
    const states = Object.values(GT_STATES);
    if (new Set(states).size !== states.length) problems.push('目标树各态必须互不相同');
    if (GT_STATES.ABSENT === GT_STATES.NO_GOAL) problems.push('「问不了」与「上游没记过」必须不同形');
    if (GT_STATES.PLANNED === GT_STATES.TRACKED) problems.push('「只有计划」与「有计划也有事实」必须不同形');
    if (GT_BLOCK.WAITING === GT_BLOCK.UNDECLARED) problems.push('「前置未完成」与「前置没记过」必须不同形');

    /* 一 派发相严格判 true。 */
    if (planGoalState(true, true) !== GT_STATES.TRACKED) problems.push('有事实面必须走 tracked');
    if (planGoalState(false, true) !== GT_STATES.PLANNED) problems.push('只有计划 ⇒ planned');
    if (planGoalState(false, false) !== GT_STATES.ABSENT) problems.push('两样都没有 ⇒ absent');
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        if (planGoalState(bad, false) !== GT_STATES.ABSENT) problems.push('派发相必须严格判 true：' + String(bad));
    }

    /* 二 计划与事实分列（本项最容易写坏的一处）。 */
    const planned = normalizeGoalNode(null, { planDone: true, hasPlan: true });
    if (planned.state !== GT_STATES.PLANNED) problems.push('只有计划必须记 planned');
    if (planned.factState !== GT_FACT.UNKNOWN) problems.push('没有事实面时事实态必须是 unknown（**不是** done）');
    const pv = planVsFactLine(planned);
    if (pv.indexOf('不是已发生的事实') < 0) problems.push('计划态必须明说「不是已发生的事实」：' + pv);

    const both = normalizeGoalNode({ goal: '签约', factState: 'done' }, { planDone: true });
    if (both.state !== GT_STATES.TRACKED) problems.push('有事实面 ⇒ tracked');
    if (planVsFactLine(both).indexOf('事实面也已达成') < 0) problems.push('两侧都达成必须说清：' + planVsFactLine(both));

    /* 三 「勾了但事实没有」是独立一格（最要紧的那一格）。 */
    const gap = normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    const gl = planVsFactLine(gap);
    if (gl.indexOf('计划勾了') < 0 || gl.indexOf('还没有') < 0) problems.push('勾了但事实没有必须明说：' + gl);
    if (gl === planVsFactLine(both)) problems.push('★「勾了且事实达成」与「勾了但事实没有」必须不同句');

    /* 四 受阻与缺数据分形。 */
    const waiting = normalizeGoalNode({
        goal: '取钥匙', prereqs: [{ id: 'p1', label: '签约', factState: 'pending' }],
    });
    if (waiting.block !== GT_BLOCK.WAITING) problems.push('前置已知未完成 ⇒ waiting');
    if (stepGateLine(waiting).indexOf('先做') !== 0) problems.push('受阻必须说清先做哪一件：' + stepGateLine(waiting));
    const undecl = normalizeGoalNode({
        goal: '取钥匙', prereqs: [{ id: 'p1', label: '签约', factState: 'unknown' }],
    });
    if (undecl.block !== GT_BLOCK.UNDECLARED) problems.push('前置没记过 ⇒ undeclared');
    if (stepGateLine(undecl).indexOf('判不了顺序') !== 0) problems.push('缺数据必须说「判不了顺序」：' + stepGateLine(undecl));
    if (stepGateLine(undecl) === stepGateLine(waiting)) problems.push('★「前置未完成」与「前置没记过」必须不同句');

    /* 五 没有前置 ⇒ ready。 */
    const ready = normalizeGoalNode({ goal: '搬东西', factState: 'pending' });
    if (ready.block !== GT_BLOCK.READY) problems.push('没有前置 ⇒ ready');
    if (stepGateLine(ready).indexOf('还没到') !== 0) problems.push('事实面未发生必须说清：' + stepGateLine(ready));

    /* 六 三态「看不了」各说各的。 */
    const absent = normalizeGoalNode(null);
    const noGoal = normalizeGoalNode({ goal: '' });
    const bad = normalizeGoalNode({ thrown: true, goal: '搬家' });
    const lines = [absent, noGoal, bad].map((n) => stepGateLine(n));
    if (new Set(lines).size !== 3) problems.push('★ 三态「看不了」必须三句不同：' + lines.join(' | '));
    if (lines[2].indexOf('读不到') < 0) problems.push('取数失败必须说「读不到」');

    /* 七 目标树最多三层，超深如实报截断。 */
    const deep = { goal: 'L1', children: [{ goal: 'L2', children: [{ goal: 'L3', children: [{ goal: 'L4' }] }] }] };
    const tree = goalTreeRows(deep, {});
    if (tree.depth !== GT_LIMITS.depth) problems.push('层数上限必须是 ' + GT_LIMITS.depth);
    if (tree.rows.length !== 3) problems.push('三层应出三行，实测 ' + tree.rows.length);
    if (tree.truncated < 1) problems.push('超深必须如实报截断（不静默丢）');

    /* 八 不产任何分数 / 进度（计划原文「不以九宫格计数充当任务推进」）。 */
    const sample = JSON.stringify({ p: planned, b: both, g: gap, w: waiting, u: undecl, t: tree });
    for (const k of GT_FORBIDDEN_KEYS) {
        if (sample.indexOf('"' + k + '"') >= 0) problems.push('读数里不得出现分数/进度键：' + k);
    }

    /* 九 只读面。 */
    if (planned.writesNothing !== true || both.writesNothing !== true) problems.push('本件恒为只读面');

    /* 十 空件与异常不抛。 */
    if (normalizeGoalNode(undefined).state !== GT_STATES.ABSENT) problems.push('空件 ⇒ absent');
    if (stepGateLine(null) !== '判不了（没有这一条）') problems.push('空节点的读数必须如实');

    return { problems: problems, states: states.length, blocks: Object.keys(GT_BLOCK).length };
}

export default {
    GT_STATES,
    GT_PLAN,
    GT_FACT,
    GT_BLOCK,
    GT_LIMITS,
    GT_FORBIDDEN_KEYS,
    planGoalState,
    normalizeGoalNode,
    stepGateLine,
    planVsFactLine,
    goalTreeRows,
    goalTreeSelfCheck,
};