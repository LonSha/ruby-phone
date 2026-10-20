/* ============================================================
 * tests/system-v4360.test.mjs -- [v4.36.0 · 第五期 R5-O9 追问条件可见、可改，时点不误写成以后]
 *
 * 验收口径（计划原文 R5-O9）：
 *   「从『20楼当时甲在哪』追问到『后来乙呢』，界面能辨**当时与以后**、旧人名不暗继承；
 *     **清除时间后真正查询全范围**；两人比较各自出处；切会话清轨迹。」
 *   不做：**不让手机另造问句解释器**；**不只把 ≥ 改成 ≤ 掩盖上游问题**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   ① `config/memory-ask-thread.js::carryLineOf` 对任何 `atFloor` 一律写
 *      「时点 ≥N楼」—— 而「截至第20楼她住哪」（**上界**：只看到那为止）与
 *      「第20楼以后呢」（下界：从那起往后）在**同一个数字**上落出**相反**的方向。
 *      用户读到「≥20楼」会以为「从20楼往后都算」，而真实查询恰恰相反。
 *      不报错、只是错读数，且**数字看着是对的**（本仓最贵的一类）。
 *   ② **没有任何入口**能撤掉一个已继承的条件：要撤时点只能重新问一句全句，
 *      而重问会重新认主体（用户只想撤时间、不想换人），且新句还可能再带一个时点。
 *
 * 【本版落的三件】
 *   （一）上游 `qa-thread.js`：`advanceThread` 增**条件清除**（`opts.clear`，可清轴表
 *   `QT_CLEAR_AXES`，逐轴具名「清掉了 / 本来就没有 / 本句新设优先 / 轴名不认识」）；
 *   宿主 `index.js` 把 `clear` 下传并回送 `cleared` / `clearAxes`（缺件降级路径同键）。
 *   （二）契约件 `config/memory-ask-thread.js`：增时间方向三态 `ASK_TIME_OPS` 与
 *   **唯一出处** `timeConditionLine`（三种方向三句不同；方向不认识**不许**按 `≥` 兜底）；
 *   `carryLineOf` / `traceLineOf` 都改走它；归一增 `timeOp` / `cleared` / `clearAxes`。
 *   （三）控制器 `clearAskCondition` / `askClearAxes` / `askTimeLine` 三口；
 *   视图时点行 + 可撤条件按钮（轴名照上游那张表，视图不另立清单）。
 *
 * 判据面（六组）：
 *   A 口径：方向三态唯一出处 / 旧口径句式不变 / 可清轴表唯一出处 / 纯契约零副作用
 *   B 内核行为：三种方向三句不同、as-of 不得写成「以后」、不认识不许兜底、
 *            清除读数与未清除读数分列、无时点条件给空串
 *   C 接线行为：真 App + 假插件走完整旅程（清成 / 没清成 / 本句新设优先 / 没出口不许假装清过）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-O9
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「真正查询全范围」不在本套件判】那是**上游查询层**的读数（清掉时点后
 *   实际扫了多少楼），本套件判它的**可判定前件**：清除真的下传了、读数如实、
 *   清不掉时不许报成清掉了。
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

const KERNEL_REL = 'config/memory-ask-thread.js';
const APP_REL = 'apps/memory/memory-app.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const VIEW_CSS_REL = 'apps/memory/memory.css';
const BUNDLE_CSS_REL = 'phone.css';
const NL = String.fromCharCode(10);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。 */
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

/* ══════════ 假件 ══════════ */
function mkStorage() {
    const mem = new Map();
    return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k) };
}
/**
 * 上游插件假身（追问面）。
 *   `impl` 可换 ⇒ 各测试自己造「清成了 / 没清成 / 本句新设优先」的回执。
 *   ★ 假件必须**真收 opts** 并把它转成回执读数 —— 只记「被调过」的假件会让
 *     「清除真的下传了没有」这条判据空转（本仓明记过的形态）。
 */
function mkPlugin(impl) {
    const p = {};
    p.__opts = null;
    p.askMemoryQuestionFollowUp = (q, opts) => {
        p.__opts = opts || null;
        if (impl) return impl(q, opts || {});
        return {
            version: 1, question: q, followUp: true, turn: 2, threadState: 'open',
            inherit: [{ axis: 'subject' }], condition: [], awaiting: false, accepted: true,
            candidates: [], actors: ['甲'], actor: '甲', refs: [], answer: [], gaps: [],
            atFloor: 20, timeOp: 'as-of',
            cleared: Array.isArray(opts && opts.clear) ? opts.clear.slice() : [],
            clearAxes: ['subject', 'atFloor', 'time', 'compare', 'branch', 'scope'],
            writesNothing: true
        };
    };
    p.askMemoryQuestion = (q) => ({ version: 1, question: q, answer: [], gaps: [], refs: [], plans: [], actor: null, actors: [], writesNothing: true });
    p.__thread = { version: 1, state: 'open', subjects: ['甲'], candidates: [], atFloor: 20, timeOp: 'as-of', atHint: '', compareAxis: '', branchKey: '', scope: {}, turn: 2, cleared: [], clearAxes: ['subject', 'atFloor', 'time', 'compare', 'branch', 'scope'] };
    p.qaThread = () => p.__thread;
    return { LonShaMemory: p, __p: p };
}
function mkApp(plugin, kind) {
    globalThis.window = {
        VirtualPhone: {},
        ...(kind === 'no-plugin' ? {} : { LonShaMemory: plugin.LonShaMemory })
    };
    return new APP.MemoryApp(null, mkStorage());
}
function clearWin() { delete globalThis.window; }

/* ══════════ A ── 口径面 ══════════ */

test('A1 时间方向三态唯一出处：三种方向都从 timeConditionLine 出，且各态互不相同', () => {
    const ops = K.ASK_TIME_OPS;
    assert.equal(ops.AT, 'at');
    assert.equal(ops.AS_OF, 'as-of', '★「截至当时」必须是**独立**一格（与下界方向相反）');
    assert.equal(ops.SINCE, 'since');
    assert.equal(ops.UNKNOWN, 'unknown', '给了但不认识必须单列（归空会与旧口径没给同形）');
    /* 三态 + 空 + 不认识 = 五格，各自可辨。 */
    const vals = Object.values(ops);
    assert.equal(new Set(vals).size, vals.length, '方向各态必须互不相同');
    /* 唯一出处：方向的人读文案只在 `timeConditionLine` 里判一次。 */
    assert.ok(kernelCode.indexOf('function timeConditionLine(') >= 0, '唯一出处必须真存在');
    /* ★ 旧口径那句「时点 ≥」**只许在 timeConditionLine 里出现一次**：
     *   散在别处就会出现「一处改了、另一处还是老句式」的错读数。 */
    assert.equal(kernelCode.split("'时点 ≥'").length - 1, 1,
        '★ 「时点 ≥」句式必须只在唯一出处里出现一次（实测散在别处即分叉）');
    assert.equal(viewCode.indexOf("'时点 ≥'"), -1, '★ 视图不得自己拼时点句式（那正是修前那条错读数的老路）');
    assert.equal(appCode.indexOf("'时点 ≥'"), -1, '★ 控制器不得自己拼时点句式');
    /* 视图与控制器都必须走取数口，不许自己算。 */
    assert.ok(viewCode.indexOf('askTimeLine?.(') >= 0, '视图必须走 app.askTimeLine()');
    assert.ok(appCode.indexOf('timeConditionLine(') >= 0, '控制器必须转交契约件');
});

test('A2 可清轴表唯一出处：轴名只在契约件/上游声明，视图与控制器不另立清单', () => {
    /* 视图**不写**轴名字面量（按钮是照上游给的表画出来的）。 */
    for (const axis of ['subject', 'atFloor', 'compare', 'branch', 'scope']) {
        assert.equal(viewCode.split("'" + axis + "'").length - 1, 0,
            '★ 视图不得自持轴名字面量（应从 app.askClearAxes() 取）：' + axis);
    }
    assert.ok(viewCode.indexOf('askClearAxes?.(') >= 0, '视图必须走 app.askClearAxes()');
    assert.ok(appCode.indexOf('askClearAxes()') >= 0, '控制器必须有该出口');
    /* 控制器把轴名原样下传，**不先过滤**（合法性只有上游那张表说了算）。 */
    assert.ok(appCode.indexOf('clear: clear') >= 0, '清除表必须原样下传');
    /* 控制器只在**上游给过表**时做预检（表缺席时不假装能判）。 */
    assert.ok(appCode.indexOf('face0.clearAxes') >= 0, '预检必须读上游给的表');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟（判据扫去注释后的代码）', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    /* 本件不得自己算继承/查询（上游唯一真源）。 */
    for (const bad of ['planQuestion(', 'composeAnswer(', 'advanceThread(', 'normalizeThread(']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己算继承/查询：' + bad);
    }
});

test('A4 旧口径不许被改坏：at 与「上游没给方向」仍读作下界（历史判据锁着这一句）', () => {
    /* 这是本项最容易写坏的一处：为了修「截至当时」而把**所有**时点都改成
     *   「方向未定」，会把历史读数一起改错（v4220 的 B2 判据锁着「时点 ≥12楼」）。 */
    assert.equal(K.timeConditionLine(12, K.ASK_TIME_OPS.AT), '时点 ≥12楼', 'at 保持旧句式');
    assert.equal(K.timeConditionLine(12, ''), '时点 ≥12楼', '上游没给方向（旧口径）仍读作下界');
    assert.equal(K.timeConditionLine(12, undefined), '时点 ≥12楼');
    assert.equal(K.timeConditionLine(null, K.ASK_TIME_OPS.AT), '', '没有时点条件 ⇒ 空串');
    /* 历史那一条完整读数必须逐字不变（v4220 B2 的同款夹具）。 */
    const legacy = K.normalizeThreadFace({
        followUp: true, turn: 2, threadState: 'open', actors: ['甲'], atFloor: 12,
        inherit: [{ axis: 'subject' }], condition: [{ axis: 'time' }]
    });
    assert.ok(K.carryLineOf(legacy).indexOf('时点 ≥12楼') >= 0,
        '★ 历史读数的句式必须逐字保留：' + K.carryLineOf(legacy));
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 三种方向三句不同：as-of 不得写成「以后」，since 必须写「以后」', () => {
    const at = K.timeConditionLine(20, K.ASK_TIME_OPS.AT);
    const asOf = K.timeConditionLine(20, K.ASK_TIME_OPS.AS_OF);
    const since = K.timeConditionLine(20, K.ASK_TIME_OPS.SINCE);
    assert.equal(new Set([at, asOf, since]).size, 3, '★ 三句必须互不相同：' + [at, asOf, since].join(' | '));
    assert.ok(asOf.indexOf('截至') >= 0, 'as-of 必须说清是「截至当时」');
    assert.equal(asOf.indexOf('以后'), -1, '★★ as-of 不许出现「以后」（方向正好相反，而数字看着是对的）');
    assert.ok(since.indexOf('以后') >= 0, 'since 必须说清是「从此以后」');
    assert.ok(at.indexOf('≥') >= 0, 'at 保持旧口径写法');
    /* 「当时」那一句必须自证「只看到那为止」—— 只写「截至第20楼」会让人以为
     *   「截至」是修饰数字而不是查询方向。 */
    assert.ok(asOf.indexOf('为止') >= 0, 'as-of 必须说清「只看到那为止」：' + asOf);
});

test('B2 方向不认识 ⇒ 不许按 ≥ 兜底（兜底就是修前那条错读数的老路）', () => {
    const unk = K.timeConditionLine(20, K.ASK_TIME_OPS.UNKNOWN);
    assert.notEqual(unk, K.timeConditionLine(20, K.ASK_TIME_OPS.AT),
        '★ 不认识的方向不许兜底成「≥N楼」');
    assert.ok(unk.indexOf('不认识') >= 0, '必须如实说「方向不认识」：' + unk);
    /* 归一：给了不认识的方向 ⇒ 记 unknown；上游没给 ⇒ 空。两者不许同形。 */
    const bad = K.normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open', atFloor: 9, timeOp: 'bogus' });
    const none = K.normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open', atFloor: 9 });
    assert.equal(bad.timeOp, K.ASK_TIME_OPS.UNKNOWN, '不认识的方向必须记 unknown');
    assert.equal(none.timeOp, '', '上游没给方向必须归空（旧口径）');
    assert.notEqual(bad.timeOp, none.timeOp, '★「不认识」与「没给」必须不同形');
    assert.notEqual(K.timeConditionLine(9, bad.timeOp), K.timeConditionLine(9, none.timeOp),
        '★ 两者的人读文案也必须不同（否则用户看不出差别）');
    /* 空回执（插件不在场）也要给得出这些格，不许 undefined。 */
    const absent = K.normalizeThreadFace(null);
    assert.equal(absent.timeOp, '');
    assert.deepEqual(absent.cleared, []);
    assert.deepEqual(absent.clearAxes, []);
});

test('B3 清除读数：做成了什么与没做成什么分列，且沿用读数报出来', () => {
    const done = K.normalizeThreadFace({
        followUp: true, turn: 3, threadState: 'open', actors: ['甲'], atFloor: 20,
        timeOp: 'as-of', cleared: ['atFloor', 'timeOp']
    });
    assert.deepEqual(done.cleared, ['atFloor', 'timeOp'], '清除读数原样归一（做成了什么）');
    assert.ok(K.carryLineOf(done).indexOf('已清除 atFloor/timeOp') >= 0,
        '★ 沿用读数必须报出这一轮清掉了什么：' + K.carryLineOf(done));
    /* 没清成什么**不在** cleared 里（它在上游 gaps 里，由控制器分列报出）。 */
    const nothing = K.normalizeThreadFace({ followUp: true, turn: 3, threadState: 'open', actors: ['甲'], atFloor: 20, timeOp: 'as-of' });
    assert.deepEqual(nothing.cleared, [], '没清任何东西时 cleared 必须为空（不许编一个）');
    assert.equal(K.carryLineOf(nothing).indexOf('已清除'), -1, '没清过就不许说「已清除」');
    /* 可清轴表原样归一（视图照它画按钮）。 */
    const axes = K.normalizeThreadFace({ followUp: true, turn: 1, threadState: 'open', clearAxes: ['subject', 'time'] });
    assert.deepEqual(axes.clearAxes, ['subject', 'time']);
    /* 轨迹行也要带方向与清除（回看条件时看不出方向 = 条件没记下来）。 */
    const step = K.traceStepOf({ followUp: true, turn: 2, atFloor: 20, timeOp: 'as-of', cleared: ['atFloor'] }, '当时呢');
    assert.equal(step.timeOp, 'as-of', '轨迹步必须留下方向');
    assert.deepEqual(step.cleared, ['atFloor'], '轨迹步必须留下清除读数');
    const line = K.traceLineOf(step);
    assert.ok(line.indexOf('截至') >= 0, '轨迹行必须报方向：' + line);
    assert.ok(line.indexOf('已清除') >= 0, '轨迹行必须报清除：' + line);
    /* 步 → 回执的形状翻译必须保住方向与清除（否则旧插件上回看就没这两格）。 */
    const back = K.receiptOfStep(step);
    assert.equal(back.timeOp, 'as-of');
    assert.deepEqual(back.cleared, ['atFloor']);
    const face = K.normalizeThreadFace(back);
    assert.equal(face.timeOp, 'as-of', '翻回来方向必须还在');
    assert.deepEqual(face.cleared, ['atFloor'], '翻回来清除读数必须还在');
});

test('B4 自检加项真跑：方向三句不同 / 不认识不兜底 / 清除读数报出', () => {
    const r = K.askThreadSelfCheck();
    assert.deepEqual(r.problems, [], '★ 内核自检必须零问题：' + JSON.stringify(r.problems));
    assert.equal(r.phases, 6, '六态不变');
    assert.equal(r.outlets, 3, '三派发相不变');
});

/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */

test('C1 清成了：清除表真下传、读数真回读、当面说清', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'followup');
    try {
        const res = app.clearAskCondition('time');
        assert.deepEqual(plugin.__p.__opts, { clear: ['time'] },
            '★ 清除表必须原样下传到上游（假件真收 opts，只记「被调过」会让这条判据空转）');
        assert.equal(res.ok, true);
        assert.deepEqual(res.cleared, ['time'], '清成了什么必须回读');
        assert.ok(res.note.indexOf('已撤掉') >= 0, '当面说清撤掉了：' + res.note);
        /* 空问句走「继续」：清除本身就是一个动作，不必逼用户再打一句。 */
        assert.equal(plugin.__p.__opts.clear[0], 'time');
    } finally { clearWin(); }
});

test('C2 没清成：不许报「已清除」（本来就没有 / 轴名不认识各自具名）', () => {
    /* 上游说「本来就没有这一轴」⇒ cleared 为空 + gaps 具名。 */
    const plugin = mkPlugin((q, opts) => ({
        version: 1, question: q, followUp: true, turn: 3, threadState: 'open',
        inherit: [], condition: [], awaiting: false, accepted: true, candidates: [],
        actors: ['甲'], actor: '甲', refs: [], answer: [], atFloor: null, timeOp: '',
        cleared: [], clearAxes: ['subject', 'atFloor', 'time'],
        gaps: [{ kind: 'clear-nothing', axis: 'time', why: '本会话本来就没有时轴条件（不是「已清除」）' }],
        writesNothing: true
    }));
    const app = mkApp(plugin, 'followup');
    try {
        const res = app.clearAskCondition('time');
        assert.equal(res.ok, false, '★ 没清成不许报成功');
        assert.deepEqual(res.cleared, []);
        assert.ok(res.note.indexOf('没撤掉') >= 0, '必须当面说没撤掉：' + res.note);
        assert.ok(res.note.indexOf('本来就没有') >= 0, '★「本来就没有」必须具名（不许与「清掉了」同形）');
    } finally { clearWin(); }
});

test('C3 本句新设优先：上游说被覆盖 ⇒ 如实报「未清除」而不是「已清除」', () => {
    const plugin = mkPlugin((q, opts) => ({
        version: 1, question: q, followUp: true, turn: 3, threadState: 'open',
        inherit: [], condition: [{ axis: 'atFloor' }], awaiting: false, accepted: true, candidates: [],
        actors: ['甲'], actor: '甲', refs: [], answer: [], atFloor: 30, timeOp: 'at',
        cleared: [], clearAxes: ['time'],
        gaps: [{ kind: 'clear-overridden', axis: 'time', why: '本句自己给了「第 N 楼」⇒ 清除时点条件不生效' }],
        writesNothing: true
    }));
    const app = mkApp(plugin, 'followup');
    try {
        const res = app.clearAskCondition('time', '第30楼她呢');
        assert.equal(res.ok, false);
        assert.ok(res.note.indexOf('不生效') >= 0, '★ 必须说清「本句自己给了时点 ⇒ 清除不生效」：' + res.note);
    } finally { clearWin(); }
});

test('C4 轴名不在表里：点下去那一刻就说清（不必等一轮往返）', () => {
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'followup');
    try {
        const res = app.clearAskCondition('nope');
        assert.equal(res.ok, false);
        assert.equal(plugin.__p.__opts, null, '★ 轴名不合法时**不该**去问上游（表就是判据）');
        assert.ok(res.note.indexOf('不在可清轴表里') >= 0, '必须说清是哪张表：' + res.note);
        /* 没点名要清哪一轴 ⇒ 也不问上游。 */
        const empty = app.clearAskCondition('  ');
        assert.equal(empty.ok, false);
        assert.equal(plugin.__p.__opts, null);
    } finally { clearWin(); }
});

test('C5 没有追问出口：不许回落普通问答假装清过了', () => {
    /* 只有普通问答口的插件。 */
    const plain = { LonShaMemory: { askMemoryQuestion: (q) => ({ version: 1, question: q, answer: [], gaps: [], refs: [], plans: [], actor: null, actors: [], writesNothing: true }) } };
    const app = mkApp(plain, 'plain');
    try {
        const res = app.clearAskCondition('time');
        assert.equal(res.ok, false, '★ 没有继承就没有可撤的条件，不许报成功');
        assert.deepEqual(res.cleared, []);
        assert.ok(res.note.indexOf('没有追问出口') >= 0, '必须说清是「没有可撤的继承条件」：' + res.note);
        assert.ok(res.note.indexOf('不是「清掉了」') >= 0, '★ 必须点明它与「清掉了」不是同一件事');
    } finally { clearWin(); }
    /* 插件不在场同样不许假装。 */
    const app2 = mkApp(null, 'no-plugin');
    try {
        const res2 = app2.clearAskCondition('time');
        assert.equal(res2.ok, false);
        assert.ok(res2.note.indexOf('没有追问出口') >= 0);
    } finally { clearWin(); }
});

test('C6 视图接线：时点行与可撤按钮在场，事件与样式都真投递', () => {
    for (const id of ['mem-fu-time']) {
        assert.ok(viewSrc.indexOf('"' + id + '"') >= 0, '视图缺元素 ' + id);
    }
    for (const cls of ['mem-fu-clear', 'mem-fu-clear-btn', 'mem-fu-clear-label']) {
        assert.ok(viewSrc.indexOf(cls) >= 0, '视图缺类 ' + cls);
    }
    assert.ok(viewCode.indexOf("e.target.closest('.mem-fu-clear-btn')") >= 0, '可撤按钮必须有事件落点（容器级委托）');
    assert.ok(viewCode.indexOf('this._clearAskCondition(') >= 0, '委托必须真调到转交口');
    assert.ok(viewCode.indexOf('askTimeLine?.(') >= 0, '时点行必须走取数口（不自己拼）');
    /* 样式两侧投递（源文件保留 + phone.css 打包）：只写一侧等于打包环境里裸奔。 */
    for (const cls of ['.mem-fu-time', '.mem-fu-time-none', '.mem-fu-clear', '.mem-fu-clear-label', '.mem-fu-clear-btn']) {
        assert.ok(appCssSrc.indexOf(cls) >= 0, '源样式缺 ' + cls);
        assert.ok(bundleCssSrc.indexOf(cls) >= 0, 'phone.css 打包侧缺 ' + cls);
    }
    /* 追问面那一块不许把时点行放到「问答面读不出就返回」之后（与 v4220 C6 同规）。 */
    const askHtml = viewCode.slice(viewCode.indexOf('_askHtml(pkg) {'));
    const body = askHtml.slice(0, askHtml.indexOf('  /* ====='));
    const iTime = body.indexOf('mem-fu-host');
    const iQa = body.indexOf('if (!qa) return');
    assert.ok(iTime >= 0 && iQa > iTime, '追问面（含时点行）必须排在「问答面读不出就返回」之前');
});

test('C7 上游出口名逐字对齐：不另造第二套（本仓「同一口径只许一份实现」）', () => {
    assert.ok(appCode.indexOf('plugin.askMemoryQuestionFollowUp') >= 0, '必须调上游那一个名字');
    /* 控制器不许自己维护 thread（那是上游的活）。 */
    assert.equal(appCode.indexOf('this._askThread'), -1, '★ 控制器不得自持第二份 thread');
    /* 上游回执字段名原样使用（形状翻译，不改名）。 */
    for (const k of ['cleared', 'clearAxes', 'timeOp']) {
        assert.ok(kernelCode.indexOf(k) >= 0, '回执键必须原样使用：' + k);
    }
});

/* ══════════ D ── 负控制（真源码破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4360_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'memory'), path.join(dir, 'apps', 'memory'));
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
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    assert.notEqual(K.timeConditionLine(20, K.ASK_TIME_OPS.AS_OF), K.timeConditionLine(20, K.ASK_TIME_OPS.SINCE), '原版：两种方向两句不同');
    assert.equal(K.timeConditionLine(12, K.ASK_TIME_OPS.AT), '时点 ≥12楼', '原版：at 旧句式');
    const plugin = mkPlugin();
    const app = mkApp(plugin, 'followup');
    try {
        const res = app.clearAskCondition('time');
        assert.equal(res.ok, true, '原版：清成了');
        assert.deepEqual(plugin.__p.__opts, { clear: ['time'] }, '原版：清除表真下传');
    } finally { clearWin(); }
});

test('D1 ★★★ 破坏「as-of 单列」⇒ 同款判据必转红（当时被读成以后）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (op === ASK_TIME_OPS.AS_OF) return '时点 截至第' + String(n) + '楼（只看到那为止）';",
        '    if (false) return \'\';');
    const mk = await loadKernel(dir, 'd1');
    const broken = mk.timeConditionLine(20, mk.ASK_TIME_OPS.AS_OF);
    /* ★ 判据必须写在**真落点**上：去掉 as-of 那一行后，as-of 会掉到末尾的
     *   下界兜底（`时点 ≥N楼`）—— 那正是「截至当时」被读成「以后」的形态。
     *   首版写成「与 since 同句」是**破坏写法不足**：它落的是 `≥`，不是「以后」。 */
    assert.equal(broken, mk.timeConditionLine(20, mk.ASK_TIME_OPS.AT),
        '★★ 破坏副本：as-of 落回下界兜底 ⇒「截至当时」被读成「≥N楼」（用户以为从那时起往后都算）');
    assert.notEqual(broken, mk.timeConditionLine(20, mk.ASK_TIME_OPS.SINCE),
        '（破坏后它并没有变成「以后」，而是变成「≥」—— 两者对用户是同一件错事，但落点不同）');
    assert.notEqual(K.timeConditionLine(20, K.ASK_TIME_OPS.AS_OF), K.timeConditionLine(20, K.ASK_TIME_OPS.AT),
        '原版 as-of 必须与 at 不同句（否则上面的转红不算证据）');
});

test('D2 ★★★ 破坏「不认识不兜底」⇒ 同款判据必转红（不认识被读成下界）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (op === ASK_TIME_OPS.UNKNOWN) return '时点 第' + String(n) + '楼（方向不认识，未按任何方向查）';",
        '    if (false) return \'\';');
    const mk = await loadKernel(dir, 'd2');
    assert.equal(mk.timeConditionLine(20, mk.ASK_TIME_OPS.UNKNOWN), mk.timeConditionLine(20, mk.ASK_TIME_OPS.AT),
        '★ 破坏副本：不认识的方向被兜底成「≥N楼」—— 那正是修前那条错读数的老路');
    assert.notEqual(K.timeConditionLine(20, K.ASK_TIME_OPS.UNKNOWN), K.timeConditionLine(20, K.ASK_TIME_OPS.AT),
        '原版必须不同句');
});

test('D3 ★★★ 破坏「清除表原样下传」⇒ C1 同款判据必转红（清除没到上游）', async () => {
    const dir = breakCopy(APP_REL,
        '      try { receipt = plugin.askMemoryQuestionFollowUp(q, callOpts) || null; } catch (_e) { receipt = null; }',
        '      try { receipt = plugin.askMemoryQuestionFollowUp(q, {}) || null; } catch (_e) { receipt = null; }');
    const m = await loadApp(dir, 'd3');
    const plugin = mkPlugin();
    /* ★ 副本类构造要读 `window`：必须先按真宿主同形挂好，再 new 副本实例
     *   （首版漏了这一步 ⇒ 报的是 `window is not defined`，那是夹具缺件、
     *   不是「破坏被抓到」——本仓明记过「因缺件而红不算负控制」）。 */
    mkApp(plugin, 'followup');
    const app = new m.MemoryApp(null, mkStorage());
    try {
        app.clearAskCondition('time');
        assert.deepEqual(plugin.__p.__opts, {},
            '★★ 破坏副本：清除表没下传 ⇒ 界面说撤了、上游按老条件查（清除按钮成了摆设）');
    } finally { clearWin(); }
});

test('D4 ★★★ 破坏「没清成不许报成功」⇒ C2 同款判据必转红（本来就没有被读成清掉了）', async () => {
    const dir = breakCopy(APP_REL,
        '    const ok = done.length > 0;',
        '    const ok = true;');
    const m = await loadApp(dir, 'd4');
    const plugin = mkPlugin(() => ({
        version: 1, question: 'q', followUp: true, turn: 3, threadState: 'open',
        inherit: [], condition: [], awaiting: false, accepted: true, candidates: [],
        actors: ['甲'], actor: '甲', refs: [], answer: [], atFloor: null, timeOp: '',
        cleared: [], clearAxes: ['time'],
        gaps: [{ kind: 'clear-nothing', axis: 'time', why: '本会话本来就没有时轴条件（不是「已清除」）' }],
        writesNothing: true
    }));
    /* 同 D3：副本构造要读 `window`，先按真宿主同形挂好**这一个**插件再 new
     *   （首版挂了个空对象 ⇒ 副本走「没有追问出口」分支，红得莫名其妙：
     *   那是夹具挂错件，不是「破坏被抓到」——本仓明记过「因缺件而红不算负控制」）。 */
    globalThis.window = { VirtualPhone: {}, LonShaMemory: plugin.LonShaMemory };
    const app = new m.MemoryApp(null, mkStorage());
    try {
        const res = app.clearAskCondition('time');
        assert.equal(res.ok, true,
            '★★ 破坏副本：什么都没清掉却报成功 ⇒ 用户以为条件撤了，实际下一句照样带时点');
    } finally { clearWin(); }
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-O9', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);
    assert.ok(items.indexOf('R5-O9') >= 0, '当版条目必须点名 R5-O9');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});
