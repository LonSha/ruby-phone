/* ============================================================
 * tests/system-v4380.test.mjs -- [v4.38.0 · 第五期 R5-X2 把大目标拆成可推进的剧情任务]
 *
 * 验收口径（计划原文 R5-X2）：
 *   「『搬家』目标展开三层，签约未完成时取钥匙显示受阻；点下一步打开原约定；
 *     撤回签约后 UI 同步，目标重开仍在；**无插件保留纯计划模式且不称已记忆**。」
 *   不做：**不做团队协作平台**；**不以九宫格计数充当任务推进**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `apps/plotline` 已有「线索与未完事项板」（v4.27.0 · R4-X6），它能列**账里有什么**，
 *   但**没有任何一格能表达用户自己的目标与前置条件**：全仓零 `goal` / `prereq` /
 *   `blocked` 命中。于是用户想把「搬家」拆成「签约 → 取钥匙 → 搬东西」时，
 *   只能在聊天里自己记 —— 而手机里那一屏永远只显示**已经发生的事**。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/goal-tree-contract.js`：五态分形（absent / no-goal / planned /
 *   tracked / unreadable）、**计划与事实两格分列**、受阻与缺数据分形（waiting /
 *   undeclared）、三层上限（超深如实报截断）、不产任何分数（自检真跑）、十项自证。
 *   （二）控制器 `goalNode` / `goalPlanToggle` / `goalPlanCount` / `goalTreeSelfCheck` /
 *   `goalPack` 五口；换会话整块作废目标草稿。
 *   （三）视图目标树卡（面 / 「计划 vs 事实」独立一行 / 三层展开 / 勾选）+ 四处事件
 *   + 样式双侧（源面 plotline.css 与运行时投递面 phone.css）。
 *
 * 判据面（六组）：
 *   A 口径：五态互不同形 / 计划与事实两格 / 纯契约零副作用 / 视图不自己拼那一句
 *   B 内核行为：勾了但事实没有（最要紧的一格）、受阻说清先做哪一件、缺数据说判不了顺序、
 *            三层上限与截断、不产分数
 *   C 接线行为：真 App + 假插件走完整旅程（有事实面 / 无插件纯计划 / 这件没记过 /
 *            取数抛了 / 勾选只在本机 / 换会话作废）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X2
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「撤回签约后 UI 同步」不在本套件判到底】那是**上游事实面**的读数
 *   （M5-X2 未实现）；本套件判它的可判定前件：事实态变了读数跟着变、
 *   计划侧不被事实侧改写（两格分列）。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KERNEL_REL = 'config/goal-tree-contract.js';
const APP_REL = 'apps/plotline/plotline-app.js';
const VIEW_REL = 'apps/plotline/plotline-view.js';
const VIEW_CSS_REL = 'apps/plotline/plotline.css';
const BUNDLE_CSS_REL = 'phone.css';
const NL = String.fromCharCode(10);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (c === String.fromCharCode(92)) { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const S = K.GT_STATES;
const B = K.GT_BLOCK;

/* ══════════ 假件 ══════════ */
function mkStorage() {
    const mem = new Map();
    return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k) };
}
/**
 * 上游插件假身。`impl` 可换 ⇒ 各测试自己造「有事实面 / 这件没记过 / 取数抛了」。
 *   ★ 假件必须**真收参数**并把它转成回执（只记「被调过」会让「目标名真下传了没有」空转）。
 */
function mkPlugin(impl) {
    const p = {};
    p.__args = null;
    p.goalFacts = (name, opts) => {
        p.__args = { name: name, opts: opts || null };
        if (impl) return impl(name, opts || {});
        return { goal: name, factState: 'pending', next: 'calendar:签约', prereqs: [] };
    };
    return { LonShaMemory: p, __p: p };
}
function mkApp(plugin, kind) {
    globalThis.window = {
        VirtualPhone: {},
        ...(kind === 'no-plugin' ? {} : { LonShaMemory: plugin.LonShaMemory })
    };
    return new APP.PlotlineApp(null, mkStorage());
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 五态互不同形：问不了 / 上游没记过 / 只有计划 / 有计划也有事实 / 读不到', () => {
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 五态值必须唯一（压平即造出处置相反的处境长得一样）');
    assert.notEqual(S.ABSENT, S.NO_GOAL, '「插件不在场」与「上游没记过这条」处置相反');
    assert.notEqual(S.PLANNED, S.TRACKED, '「只有计划」与「有计划也有事实」处置相反（纯计划 vs 可对照）');
    assert.notEqual(S.UNREADABLE, S.NO_GOAL, '「读不到」与「没记过」处置相反（再试 vs 就是这样）');
    /* 派发相严格判 true。 */
    assert.equal(K.planGoalState(true, true), S.TRACKED);
    assert.equal(K.planGoalState(false, true), S.PLANNED);
    assert.equal(K.planGoalState(false, false), S.ABSENT);
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        assert.equal(K.planGoalState(bad, false), S.ABSENT, '★ 非 true 一律当「没有」：' + JSON.stringify(bad));
    }
    assert.ok(kernelCode.indexOf('hasFacts === true') >= 0, '严格判必须写在代码里');
});

test('A2 计划与事实两格分列：勾了不等于发生了（视图与控制器都不许自己拼）', () => {
    const n = K.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    assert.equal(n.planDone, true, '计划侧来自用户勾选');
    assert.equal(n.factState, 'pending', '事实侧来自上游');
    assert.notEqual(n.planDone === true && n.factState === 'done', true, '两格必须是两件事');
    /* 「计划 vs 事实」那一句只许在契约件里拼一次。 */
    assert.ok(kernelCode.indexOf('function planVsFactLine(') >= 0, '唯一出处必须真存在');
    assert.equal(viewCode.indexOf('计划勾了'), -1, '★ 视图不得自己拼那一句');
    assert.equal(appCode.indexOf('计划勾了'), -1, '★ 控制器不得自己拼那一句');
    assert.ok(viewCode.indexOf('planVsFact') >= 0, '视图必须读取数口给的 planVsFact');
    assert.ok(appCode.indexOf('planVsFactLine(') >= 0, '控制器必须转交契约件');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    for (const bad of ['plugin.', 'LonShaMemory', 'memoryCore']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己取数：' + bad);
    }
});

test('A4 视图接线：目标卡在场、事件真投递、样式双侧都写', () => {
    for (const id of ['pn-goal-name', 'pn-goal-look', 'pn-goal-done', 'pn-goal-undo', 'pn-goal-note']) {
        assert.ok(viewSrc.indexOf('"' + id + '"') >= 0, '视图缺元素 ' + id);
    }
    for (const cls of ['pn-goal-card', 'pn-goal-face', 'pn-goal-pv', 'pn-goal-rows', 'pn-goal-row', 'pn-goal-mini']) {
        assert.ok(viewSrc.indexOf(cls) >= 0, '视图缺类 ' + cls);
    }
    for (const fn of ["q('#pn-goal-look')?.addEventListener", "q('#pn-goal-done')?.addEventListener",
        "q('#pn-goal-undo')?.addEventListener", "q('#pn-goal-name')?.addEventListener('keydown'"]) {
        assert.ok(viewCode.indexOf(fn) >= 0, '缺事件落点 ' + fn);
    }
    assert.ok(viewCode.indexOf('this._goalLookup()') >= 0, '「看这一条」必须真调到取数口');
    assert.ok(viewCode.indexOf('this._goalToggle(') >= 0, '勾选按钮必须真调到转交口');
    /* 视图不得在**本版新增的目标卡**里新建 document 元素
     *   （TH 沙箱与测试里 `document` 可能不可用）。
     *   ★ 切片必须**只圈本版新增的那几个方法**：从 `_goalCard() {` 到 `_goalCardInner() {` 结束
     *   （用 `_boardCard() {` 当终点会把**中间既有**的历史方法一起圈进来 —— 那些本来就有
     *   `document.createElement`，判全文等于把既有形态算成本版缺陷）。 */
    const i0 = viewCode.indexOf('_goalCard() {');
    const i2 = viewCode.indexOf('_goalCardInner() {');
    assert.ok(i0 > 0 && i2 > i0, '必须能切出目标卡那几个方法');
    /* ★ 判据要认的是「**代码里**有没有新建 document 元素」，故剥掉**每一行**的注释前缀，
     *   再逐行判：块注释里写 `document.createElement` 是在**说明「不新建它」**，
     *   拿整段原文判会命中注释 —— 本仓最贵的形态之一（注释里的名字被当成代码）。
     *   这里不依赖 stripComments 的块注释剥离（它对含反引号的块注释会误判进字符串态）。 */
    const goalSeg = viewCode.slice(i0, i2);
    const codeLines = goalSeg.split(NL)
        .map((l) => l.trim())
        .filter((l) => l && l.indexOf('*') !== 0 && l.indexOf('//') !== 0);
    const codeOnly = codeLines.join(NL);
    assert.equal(codeOnly.indexOf('document.createElement'), -1, '★ 目标卡不得新建 document 元素');
    assert.ok(codeOnly.indexOf('ownerDocument') >= 0, '重画必须走容器自己的 ownerDocument（或退化为原地重画）');
    /* 样式两侧投递：源面 + 运行时投递面。 */
    for (const cls of ['.pn-goal-card', '.pn-goal-face', '.pn-goal-pv', '.pn-goal-row',
        '.pn-goal-actions', '.pn-goal-mini', '.pn-goal-note-text']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, 'phone.css 运行时投递面缺 ' + cls);
    }
    /* 目标卡在渲染清单里（不是建好没挂）。 */
    assert.ok(viewCode.indexOf('this._goalCard()') >= 0, '目标卡必须真被渲染');
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 「勾了但事实没有」是独立一格（本项最要紧的那一格）', () => {
    const both = K.normalizeGoalNode({ goal: '签约', factState: 'done' }, { planDone: true });
    const gap = K.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    const l1 = K.planVsFactLine(both);
    const l2 = K.planVsFactLine(gap);
    assert.notEqual(l1, l2, '★「勾了且事实达成」与「勾了但事实没有」必须不同句');
    assert.ok(l1.indexOf('事实面也已达成') >= 0, '两侧都达成必须说清：' + l1);
    assert.ok(l2.indexOf('还没有') >= 0, '勾了但事实没有必须明说：' + l2);
    assert.ok(l2.indexOf('勾选只表达你的计划') >= 0, '必须点明勾选只表达计划：' + l2);
    /* 反向一格：事实达成但用户没勾。 */
    const onlyFact = K.normalizeGoalNode({ goal: '签约', factState: 'done' }, { planDone: false });
    const l3 = K.planVsFactLine(onlyFact);
    assert.ok(l3.indexOf('还没在计划里勾') >= 0, '事实达成但没勾也必须说清：' + l3);
    assert.equal(new Set([l1, l2, l3]).size, 3, '三格必须三句不同');
});

test('B2 受阻说清「先做哪一件」；缺数据说「判不了顺序」（两者分形）', () => {
    const waiting = K.normalizeGoalNode({
        goal: '取钥匙', prereqs: [{ id: 'p1', label: '签约', factState: 'pending' }],
    });
    assert.equal(waiting.block, B.WAITING);
    const wl = K.stepGateLine(waiting);
    assert.ok(wl.indexOf('先做') === 0, '受阻必须说清先做哪一件：' + wl);
    assert.ok(wl.indexOf('签约') >= 0, '要点名那一件：' + wl);

    const undecl = K.normalizeGoalNode({
        goal: '取钥匙', prereqs: [{ id: 'p1', label: '签约', factState: 'unknown' }],
    });
    assert.equal(undecl.block, B.UNDECLARED, '前置没记过 ⇒ undeclared');
    const ul = K.stepGateLine(undecl);
    assert.ok(ul.indexOf('判不了顺序') === 0, '缺数据必须说「判不了顺序」：' + ul);
    assert.ok(ul.indexOf('没人记过') >= 0, '必须点明是「没人记过」而不是「没有前置」：' + ul);
    assert.notEqual(ul, wl, '★ 两态必须不同句');

    /* 没有前置 ⇒ ready；事实面未发生 ⇒ 还没到。 */
    const ready = K.normalizeGoalNode({ goal: '搬东西', factState: 'pending' });
    assert.equal(ready.block, B.READY);
    assert.ok(K.stepGateLine(ready).indexOf('还没到') === 0, '事实面未发生必须说清：' + K.stepGateLine(ready));
});

test('B3 只有计划时明说「不是已发生的事实」；三态「看不了」各说各的', () => {
    const planned = K.normalizeGoalNode(null, { planDone: true, hasPlan: true });
    assert.equal(planned.state, S.PLANNED);
    assert.equal(planned.factState, K.GT_FACT.UNKNOWN, '没有事实面时事实态必须是 unknown（不是 done）');
    const pl = K.planVsFactLine(planned);
    assert.ok(pl.indexOf('不是已发生的事实') >= 0, '★ 纯计划必须明说不是事实：' + pl);
    assert.ok(K.stepGateLine(planned).indexOf('只表示你的计划') >= 0, '受阻读数也要说清：' + K.stepGateLine(planned));

    const absent = K.normalizeGoalNode(null);
    const noGoal = K.normalizeGoalNode({ goal: '' });
    const bad = K.normalizeGoalNode({ thrown: true, goal: '搬家' });
    const lines = [absent, noGoal, bad].map((n) => K.stepGateLine(n));
    assert.equal(new Set(lines).size, 3, '★ 三态「看不了」必须三句不同：' + lines.join(' | '));
    assert.ok(lines[0].indexOf('不在场') >= 0, '不在场必须说清');
    assert.ok(lines[1].indexOf('没记过') >= 0, '上游没记过必须说清：' + lines[1]);
    assert.ok(lines[2].indexOf('读不到') >= 0, '取数失败必须说「读不到」：' + lines[2]);
});

test('B4 三层上限与超深截断如实报；不产任何分数', () => {
    const deep = { goal: 'L1', children: [{ goal: 'L2', children: [{ goal: 'L3', children: [{ goal: 'L4' }] }] }] };
    const tree = K.goalTreeRows(deep, {});
    assert.equal(tree.depth, K.GT_LIMITS.depth, '层数上限必须是 ' + K.GT_LIMITS.depth);
    assert.equal(tree.rows.length, 3, '三层应出三行');
    assert.ok(tree.truncated >= 1, '★ 超深必须如实报截断（不静默丢）');
    assert.deepEqual(tree.rows.map((r) => r.depth), [1, 2, 3], '层次必须按序给出');
    /* 自定义深度被夹到上限（不许超）。 */
    const shallow = K.goalTreeRows(deep, { depth: 99 });
    assert.equal(shallow.depth, K.GT_LIMITS.depth, '★ 传入的深度必须被夹到上限');
    /* 不产分数 / 进度。 */
    const sample = JSON.stringify(tree) + JSON.stringify(K.normalizeGoalNode({ goal: 'x', factState: 'done' }));
    for (const k of K.GT_FORBIDDEN_KEYS) {
        assert.equal(sample.indexOf('"' + k + '"'), -1, '★ 读数里不得出现分数/进度键：' + k);
    }
});

test('B5 自检十项零问题，且各态与受阻态计数与词表同源', () => {
    const r = K.goalTreeSelfCheck();
    assert.deepEqual(r.problems, [], '★ 内核自检必须零问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 5, '五态');
    assert.equal(r.blocks, 3, '三受阻态');
    assert.equal(Object.keys(K.GT_STATES).length, 5);
});

/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */

test('C1 有事实面：读到了、目标名真下传、读数走事实面', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'facts');
    try {
        const one = app.goalNode('搬家');
        assert.deepEqual(plugin.__p.__args, { name: '搬家', opts: null },
            '★ 目标名必须原样下传（只记「被调过」会让这条判据空转）');
        assert.equal(one.state, S.TRACKED);
        assert.ok(one.gate.length > 0, '受阻读数必须在场');
        assert.ok(one.planVsFact.length > 0, '计划对事实必须在场');
        assert.deepEqual(app.goalTreeSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 ★★★ 无插件：保留纯计划模式，且不称「已记忆」', () => {
    const app = mkApp(null, 'no-plugin');
    try {
        const before = app.goalNode('搬家');
        assert.equal(before.state, S.ABSENT, '没有计划时如实报不在场');
        assert.ok(before.gate.indexOf('不在场') >= 0, '必须说清是「问不了」：' + before.gate);
        /* 勾一条计划 ⇒ 态变成「只有计划」，且**明说不是事实**。 */
        const saved = app.goalPlanToggle('搬家', true);
        assert.equal(saved.ok, true);
        assert.ok(saved.note.indexOf('只是你的计划') >= 0, '★ 必须明说「只是你的计划」：' + saved.note);
        const after = app.goalNode('搬家');
        assert.equal(after.state, S.PLANNED, '★ 有计划时必须是「只有计划」，不许读成「读到了」');
        assert.ok(after.planVsFact.indexOf('不是已发生的事实') >= 0,
            '★ 纯计划模式不许称「已记忆」：' + after.planVsFact);
        assert.equal(after.node.factState, K.GT_FACT.UNKNOWN, '事实侧必须是 unknown');
        /* 取消勾选 ⇒ 回到不在场，且**没有任何事实被改写**。 */
        const undone = app.goalPlanToggle('搬家', false);
        assert.equal(undone.ok, true);
        assert.equal(app.goalNode('搬家').state, S.ABSENT);
        assert.equal(app.goalPlanCount(), 0);
        /* 空名勾不了。 */
        assert.equal(app.goalPlanToggle('  ', true).ok, false);
    } finally { clearWin(); }
});

test('C3 上游在但这条没记过：说清「没记过」，不说「问不了」', () => {
    /* ★ 夹具必须让上游**真的什么都不给**：`{goal:name}` 是「上游认下这个目标名但
     *   没给别的关系」，那是 tracked（`goal` 本身就构成关系）—— 拿它测 no-goal
     *   测的是另一条路径（与 R5-X1 的 D5 同族：夹具落点不对）。 */
    const plugin = mkPlugin(() => ({ item: 'x' }));
    const app = mkApp(plugin, 'facts');
    try {
        const one = app.goalNode('从没提过的目标');
        assert.equal(one.state, S.NO_GOAL, '★ 上游在场、没有关系 ⇒ 没记过');
        assert.notEqual(one.state, S.ABSENT, '不许读成「插件不在场」');
        assert.ok(one.gate.indexOf('没记过') >= 0, '必须说清：' + one.gate);
    } finally { clearWin(); }
});

test('C4 取数抛了：如实报「读不到」，不假装「没有这个目标」', () => {
    const plugin = mkPlugin(() => { throw new Error('boom'); });
    const app = mkApp(plugin, 'facts');
    try {
        const one = app.goalNode('搬家');
        assert.equal(one.state, S.UNREADABLE, '★ 取数抛了必须记 unreadable');
        assert.ok(one.gate.indexOf('读不到') >= 0, '必须说「读不到 ≠ 没有这个目标」：' + one.gate);
    } finally { clearWin(); }
});

test('C5 勾选只在本机：不改事实侧读数，且换会话整块作废', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'facts');
    try {
        const before = app.goalNode('签约');
        app.goalPlanToggle('签约', true);
        const after = app.goalNode('签约');
        assert.equal(after.node.factState, before.node.factState, '★ 勾选不得改动事实侧（勾选只表达计划）');
        assert.equal(after.gate, before.gate, '受阻读数也不得因勾选而变（事实没变）');
        assert.equal(app.goalPlanCount(), 1);
        /* 换会话：计划整块作废（与追问轨迹/物品草稿同族）。 */
        app.onChatChanged();
        assert.equal(app.goalPlanCount(), 0, '★★ 换会话必须作废计划（不作废会把上一段勾过的画进新会话）');
    } finally { clearWin(); }
});

test('C6 视图不直摸上游全局；取数全走控制器', () => {
    assert.equal(viewSrc.indexOf('LonShaMemory') >= 0, false, '视图不得直摸上游全局');
    assert.ok(viewCode.indexOf('goalPack?.(') >= 0, '视图必须走 app.goalPack()');
    assert.ok(viewCode.indexOf('goalPlanToggle?.(') >= 0, '勾选必须走 app.goalPlanToggle()');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4380_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'plotline'), path.join(dir, 'apps', 'plotline'));
    copyTreeSafe(path.join(ROOT, 'apps', 'reading'), path.join(dir, 'apps', 'reading'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    assert.equal(K.planGoalState('yes', false), S.ABSENT, '原版：严格判 true');
    const gap = K.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    assert.ok(K.planVsFactLine(gap).indexOf('还没有') >= 0, '原版：勾了但事实没有单独成句');
    assert.equal(K.normalizeGoalNode({ goal: 'x', prereqs: [{ factState: 'unknown' }] }).block, B.UNDECLARED, '原版：缺数据单列');
    assert.equal(K.normalizeGoalNode(null).state, S.ABSENT, '原版：空件记不在场');
});

test('D1 ★★★★★ 破坏「勾了但事实没有」⇒ 同款判据必转红（勾选被当成发生）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (n.planDone && fact !== GT_FACT.DONE) {",
        '    if (false) {');
    const mk = await loadKernel(dir, 'd1');
    const gap = mk.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    const l = mk.planVsFactLine(gap);
    assert.equal(l.indexOf('还没有'), -1,
        '★★ 破坏副本：勾了但事实没有不再单独成句 ⇒ 勾选被读成「发生了」（正是本项要治的）');
    const good = K.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    assert.ok(K.planVsFactLine(good).indexOf('还没有') >= 0, '原版必须单独成句');
});

test('D2 ★★★★ 破坏「缺数据与受阻分形」⇒ 同款判据必转红（判不了顺序被读成先做）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        const undeclared = prereqs.filter((p) => p.declared === false || p.factState === GT_FACT.UNKNOWN);",
        '        const undeclared = [];');
    const mk = await loadKernel(dir, 'd2');
    const undecl = mk.normalizeGoalNode({ goal: '取钥匙', prereqs: [{ id: 'p1', label: '签约', factState: 'unknown' }] });
    assert.notEqual(undecl.block, mk.GT_BLOCK.UNDECLARED, '★ 破坏副本：前置没记过不再单列');
    assert.notEqual(mk.stepGateLine(undecl).indexOf('判不了顺序'), 0,
        '它被读成了别的结论 —— 用户会以为系统知道顺序，而其实什么都没记');
    const good = K.normalizeGoalNode({ goal: '取钥匙', prereqs: [{ factState: 'unknown' }] });
    assert.equal(K.stepGateLine(good).indexOf('判不了顺序'), 0, '原版必须说判不了顺序');
});

test('D3 ★★★★ 破坏「三层上限」⇒ 同款判据必转红（无限展开）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        ? Math.min(depthNum, GT_LIMITS.depth) : GT_LIMITS.depth;',
        '        ? depthNum : GT_LIMITS.depth;');
    const mk = await loadKernel(dir, 'd3');
    const deep = { goal: 'L1', children: [{ goal: 'L2', children: [{ goal: 'L3', children: [{ goal: 'L4' }] }] }] };
    const tree = mk.goalTreeRows(deep, { depth: 99 });
    assert.notEqual(tree.depth, mk.GT_LIMITS.depth, '★ 破坏副本：深度不再被夹到上限');
    assert.equal(tree.rows.length, 4, '四层全展开了（原版只出三层）');
    const good = K.goalTreeRows(deep, { depth: 99 });
    assert.equal(good.depth, K.GT_LIMITS.depth, '原版必须夹到上限');
});

test('D4 ★★★★ 破坏「纯计划明说不是事实」⇒ C2 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "            ? '计划：你勾了「做完」——**这是你的计划，不是已发生的事实**（上游没有事实面）'",
        "            ? '计划：已完成'");
    const mk = await loadKernel(dir, 'd4');
    const planned = mk.normalizeGoalNode(null, { planDone: true, hasPlan: true });
    assert.equal(mk.planVsFactLine(planned).indexOf('不是已发生的事实'), -1,
        '★★ 破坏副本：纯计划模式不再明说「不是事实」⇒ 用户以为它「已记忆/已发生」');
    const good = K.normalizeGoalNode(null, { planDone: true, hasPlan: true });
    assert.ok(K.planVsFactLine(good).indexOf('不是已发生的事实') >= 0, '原版必须明说');
});

test('D5 ★★★★ 破坏「事实态不许被勾选改写」⇒ C5 同款判据必转红', async () => {
    /* 真落点：把事实态改成**由计划侧推出来**（那正是「勾了就算发生」的写法）。 */
    const dir = breakCopy(KERNEL_REL,
        "        factState: Object.values(GT_FACT).indexOf(str(r.factState)) >= 0 ? str(r.factState) : GT_FACT.UNKNOWN,",
        "        factState: o.planDone === true ? GT_FACT.DONE : (Object.values(GT_FACT).indexOf(str(r.factState)) >= 0 ? str(r.factState) : GT_FACT.UNKNOWN),");
    const mk = await loadKernel(dir, 'd5');
    const before = mk.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: false });
    const after = mk.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    assert.notEqual(after.factState, before.factState,
        '★★ 破坏副本：勾选改写了事实侧 ⇒ 用户勾一下，界面就说这件事发生了');
    assert.equal(after.factState, mk.GT_FACT.DONE, '破坏副本：事实侧被勾选推成 done');
    const gb = K.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: false });
    const ga = K.normalizeGoalNode({ goal: '签约', factState: 'pending' }, { planDone: true });
    assert.equal(ga.factState, gb.factState, '原版：勾选不得改动事实侧');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X2', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    /* ★ [v4.44.0 · 抬版接管] 一致性跟随当前版；当版**内容**锁自己那一版。
     *   修前两句共用一个 `ver` ⇒ 抬版后「本版公告记了本版那件事」被判成假：
     *   那不是产品缺陷，是判据的主语写错了（见 tools/patch_x6e.py 档头同因）。 */
    const cur = pkg.version;
    assert.match(cur, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + cur);
    assert.equal(man.version, cur, 'manifest 与 package 必须同版');
    assert.equal(log.latest, cur, 'update-log.latest 必须同版');
    assert.equal(log.head, cur, 'update-log.head 必须同版');
    const ver = '4.38.0';
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);
    assert.ok(items.indexOf('R5-X2') >= 0, '当版条目必须点名 R5-X2');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + cur + "';") >= 0, 'index.js 版本常量必须同源');
});