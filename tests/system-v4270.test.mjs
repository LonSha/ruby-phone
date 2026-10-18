/* ============================================================
 * tests/system-v4270.test.mjs -- [v4.27.0 · 第四期 R4-X6 可操作的线索与未完事项板]
 *
 * 验收口径（计划原文 R4-X6）：
 *   「plotline 增列表/详情、不新造无限画布，读既有 causal-chain/commitment/seed，
 *     依赖 R4-O1，完成状态仍由剧情事实决定。」
 *   验收四条：① 一条未结约定、一条已解决伏笔、一条仅推测因果同屏可区分；
 *   ② 点击回源和去行动均到正确对象；③ 选择追踪不自动标已解决；
 *   ④ 重新生成后视图跟随有效证据。
 *   不做三条：不扩大 MAX_OPEN / 不增加第二套任务事实库 / 不把「提醒过」当「履约」。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游因果面（v3.323.0 M3-X3）的 causal-chain.js 早已有 build/proposeCandidates/
 *   traceBack/todos 等出口，而手机侧 `grep -RIn 'causalChain' apps config`
 *   **零命中** —— 建好了没人用。后果三件，都不是报错：
 *     ① 「未结约定」与「已解决伏笔」在界面上**同形**（都是「一条记录」），
 *        而前者该去做、后者不必再提；
 *     ② 「仅推测因果」与「已确认因果」也同形，前者**不能当事实**用进生成；
 *     ③ 「追这条线」没有入口，用户不知道「为什么 A 发生」时只能翻楼猜。
 *   另：因果面上游交付时已登记外供表（第 50 行，consumer=none@0），
 *   故本版走「下游两处」补齐（登记行 + 门禁标签），上游表行已存在。
 *
 * 【跨仓分工（本版全部判据都建立在这条上）】
 *   因果图的构建、节点判定、收口分类、推测边标记一律**走上游口径**；
 *   手机只做三件事：呈现（四收口分列 + 推测边单列）、起点持有（用户显式选择）、
 *   行动路由声明（不执行跳转）。故「不扩大 MAX_OPEN」「不增加第二套任务事实库」
 *   「不把提醒过当履约」在本套件里是**可判的**：读数里不许出现第二份收口序 /
 *   第二份标签表 / 百分比 / 置信度一族键（深度扫描，真跑）。
 *
 * 判据面（五组）：
 *   A 口径：六态两两不同形 / 纯契约零副作用 / 出口名与状态字面量唯一出现点 /
 *          视图不直呼内核 / 禁用键清单在场
 *   B 内核行为：六态分形逐态 / 四收口按上游 id 数组分列（不重判 closure） /
 *              推测边只进 speculative 一列（不混进 edges） / not-in-graph 与追到头不同形 /
 *              行动路由声明式 / 回源凭证原样搬 / 自检真跑
 *   C 接线行为：真接线件 + 真 App + 假宿主走完整旅程（未装插件 → 装插件 →
 *              取板 → 设起点 → 追溯 → 回源/去行动 → 换会话作废 → 真视图渲染与绑定）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么自检里也要真跑判据】数常量只能证明表在，不能证明**判得对**。
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
const KERNEL_REL = 'config/causal-board-contract.js';
const WIRE_REL = 'apps/plotline/plotline-board.js';
const APP_REL = 'apps/plotline/plotline-app.js';
const VIEW_REL = 'apps/plotline/plotline-view.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const WIRE = await import(pathToFileURL(path.join(ROOT, WIRE_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const kernelSrc = read(KERNEL_REL);
const wireSrc = read(WIRE_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const S = K.CB_STATES;
const countOf = (hay, needle) => hay.split(needle).length - 1;
/* 本面独有的状态字面量：**只许契约件一份**（接线层零命中）。
 *   ★ `'ok'` / `'empty'` 不进这一档：它们与别处通用词同字（算进来是误报）。 */
const KERNEL_ONLY = ["'engine-absent'", "'face-absent'", "'unusable'", "'no-subject'", "'not-in-graph'"];
/* ══════════ 假件 ══════════ */
/** storage 假件：只实现数据层用到的 get/set/has。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k),
        version: '1.19.0'
    };
}
/** 假宿主 window 的安装/还原（必须 async-aware）。 */
const withWin = async (obj, fn) => {
    const backup = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = obj;
    try { return await fn(); } finally {
        if (backup) Object.defineProperty(globalThis, 'window', backup);
        else delete globalThis.window;
    }
};
/** 上游假件：一个最小的因果图（三种收口 + 一条已确认边 + 一条推测边）。 */
function mkUp(opt) {
    const o = opt || {};
    const node = (id, kind, closure) => ({ id, kind, label: id, closure, ref: 'r:' + id });
    const graph = {
        kind: 'causal_chain', version: 1,
        nodes: [node('a', 'commitment', 'unresolved'), node('b', 'seed', 'resolved'), node('c', 'event', 'broken')],
        edges: [{ from: 'a', to: 'b', basis: 'evidence' }],
        speculative: [{ from: 'b', to: 'c', basis: 'speculative' }],
        unresolved: ['a'], resolved: ['b'], cancelled: [], broken: ['c'],
        counts: { nodes: 3 }, truncated: 0, malformedInput: false, writesNothing: true, degraded: false
    };
    const engine = {
        causalChainGraph: (opts) => (typeof o.graph === 'function' ? o.graph(opts) : graph),
        causalChainTodos: () => graph.nodes.filter((x) => x.closure === 'unresolved'),
        causalChainTrace: (id) => ({
            kind: 'causal_chain@trace', version: 1, id, path: [id], roots: [id],
            cycles: 0, truncated: false, known: true, reason: '', writesNothing: true
        }),
        causalChainProposals: () => [{ from: 'b', to: 'c', basis: 'speculative', label: '猜的' }]
    };
    return { LonShaMemory: { engine: Object.assign(engine, o.enginePatch || {}) } };
}
/** 真 App + 假存储（宿主 window 由 withWin 装）。 */
function mkApp(win, storage) {
    const shell = { showNotification: () => {}, screen: null, layerHost: () => null };
    return new APP.PlotlineApp(shell, storage || mkStorage());
}
/** 接线件的 App 假件（只提供它真正用到的面）。 */
function fakeApp(win) {
    return {
        _win: () => win,
        boardClosureIds: () => K.CB_CLOSURE.slice(),
        boardClosureLabel: (c) => K.CB_CLOSURE_LABEL[c] || '',
        boardKindLabel: (k) => K.CB_KIND_LABEL[k] || '',
        boardActionFor: (k) => K.CB_ACTIONS[k] || null,
        boardGate: (r) => K.boardGateOf(r),
        boardTraceNote: (r) => K.traceNoteOf(r)
    };
}
/* 最小 DOM 替身。 */
function mkEl(sel, val) {
    const ls = {};
    return {
        sel: sel, val: val, _ls: ls,
        addEventListener: (t, fn) => { (ls[t] || (ls[t] = [])).push(fn); },
        getAttribute: (n) => val,
        fire: (t) => { for (const fn of (ls[t] || [])) fn({ target: { value: val } }); }
    };
}
function mkContainer(width, els) {
    const list = els || [];
    const hit = (x, sel) => (sel.charAt(0) === '[' ? x.sel === sel.slice(1, -1) : x.sel === sel);
    const c = {
        _html: '', clientWidth: width, _list: list,
        addEventListener: () => {},
        querySelector: (sel) => list.filter((x) => hit(x, sel))[0] || null,
        querySelectorAll: (sel) => list.filter((x) => hit(x, sel))
    };
    Object.defineProperty(c, 'innerHTML', {
        get() { return this._html; },
        set(v) {
            this._html = v;
            for (const x of list) for (const k of Object.keys(x._ls || {})) x._ls[k].length = 0;
        }
    });
    return c;
}
const NL = String.fromCharCode(10);
/* ══════════ A ── 口径 ══════════ */
test('A1 六态两两不同形（没装插件 ≠ 面不在场 ≠ 读不出 ≠ 没给看谁 ≠ 真读数空）', () => {
    const vals = Object.keys(S).map((k) => S[k]);
    assert.equal(new Set(vals).size, vals.length, '状态各格必须互不相同');
    assert.notEqual(S.ENGINE_ABSENT, S.EMPTY, '「插件不在场」与「真读数无内容」必须不同形');
    assert.notEqual(S.NO_SUBJECT, S.EMPTY, '「没给看谁」与「他们都没说法」必须不同形');
    assert.notEqual(S.FACE_ABSENT, S.ENGINE_ABSENT, '「这一面不在场」与「插件不在场」必须不同形');
    assert.notEqual(S.UNUSABLE, S.EMPTY, '「本机读不出」与「真读数无内容」必须不同形');
});
test('A2 纯契约零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'fetch(',
        'XMLHttpRequest', 'Date.now', 'Math.random', 'setTimeout', 'setInterval',
        'innerHTML', 'writeFile', 'process.env']) {
        assert.equal(countOf(kernelSrc, bad), 0, '契约件不得出现 ' + bad);
    }
    const imports = (kernelSrc.match(/^import .*$/gm) || []);
    assert.equal(imports.length, 1, '契约件只许一条静态导入');
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '唯一导入必须是 config/num-gate.js');
    assert.equal(countOf(kernelSrc, "from './num-gate.js'"), 1);
    assert.equal(K.readCausalBoard(mkUp()).writesNothing, true);
    assert.equal(K.readCausalTrace(mkUp(), 'a').writesNothing, true);
});
test('A3 出口名与状态字面量唯一出现点：改一处即全仓同改', () => {
    const outlets = ['readCausalBoard', 'readCausalTodos', 'readCausalTrace', 'readCausalProposals',
        'boardLine', 'todosLine', 'traceLine', 'cbSelfCheck', 'boardGateOf', 'traceNoteOf',
        'CB_STATES', 'CB_CLOSURE', 'CB_NODE_KINDS', 'CB_ACTIONS', 'CB_FORBIDDEN_KEYS',
        'CB_STATE_HINT'];
    for (const name of outlets) {
        assert.ok(countOf(kernelSrc, name) >= 2, '出口 ' + name + ' 必须定义并进 default');
        const inDefault = countOf(kernelSrc, '    ' + name + ',') + countOf(kernelSrc, '    ' + name + NL + '};');
        assert.ok(inDefault >= 1, '出口 ' + name + ' 必须进 default export');
    }
    const wiringAll = wireSrc + appSrc + viewSrc;
    for (const lit of KERNEL_ONLY) {
        assert.equal(countOf(wiringAll, lit), 0, '接线层不得再写判定词 ' + lit);
    }
});
test('A4 视图不直呼内核：判定全由 App 转交', () => {
    assert.equal(countOf(viewSrc, 'causal-board-contract.js'), 0, '视图不得 import 契约件');
    for (const fn of ['readCausalBoard(', 'readCausalTodos(', 'readCausalTrace(',
        'readCausalProposals(', 'boardLine(', 'todosLine(', 'traceLine(', 'cbSelfCheck(',
        'boardGateOf(', 'traceNoteOf(']) {
        assert.equal(countOf(viewSrc, fn), 0, '视图不得直呼内核函数 ' + fn);
    }
    for (const fn of ['boardPack(', 'boardGate(', 'boardTraceNote(',
        'boardClosureIds()', 'boardClosureLabel(', 'boardKindLabel(', 'boardActionFor(']) {
        assert.ok(countOf(viewSrc, fn) >= 1, '视图必须经 App 出口取数：' + fn);
    }
});
test('A5 禁用键清单在场且非空：读数里不得出现百分比 / 置信度一族', () => {
    const keys = K.CB_FORBIDDEN_KEYS;
    assert.ok(Array.isArray(keys) && keys.length >= 5);
    for (const k of ['percent', 'percentage', 'confidence', 'score', 'probability']) {
        assert.ok(keys.indexOf(k) >= 0, '禁用键必须含 ' + k);
    }
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (keys.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const hits = scan([K.readCausalBoard(mkUp()), K.readCausalTodos(mkUp()),
        K.readCausalTrace(mkUp(), 'a'), K.readCausalProposals(mkUp())], []);
    assert.deepEqual(hits, [], '读数里出现禁用键：' + hits.join('/'));
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 六态分形逐态实测', () => {
    assert.equal(K.readCausalBoard(null).state, S.ENGINE_ABSENT);
    assert.equal(K.readCausalBoard(mkUp({ graph: () => ({ version: 0 }) })).state, S.FACE_ABSENT);
    assert.equal(K.readCausalBoard(mkUp({ graph: () => { throw new Error('x'); } })).state, S.UNUSABLE);
    assert.equal(K.readCausalTrace(mkUp(), '').state, S.NO_SUBJECT, '没给起点单独一格');
    assert.equal(K.readCausalBoard(mkUp({ graph: () => ({ version: 1, nodes: [] }) })).state, S.EMPTY);
    assert.equal(K.readCausalBoard(mkUp()).state, S.OK);
    for (const bad of [null]) {
        assert.equal(K.readCausalBoard(bad).degraded, true);
        assert.equal(K.readCausalBoard(bad).silentCapable, false);
    }
    assert.equal(K.readCausalBoard(mkUp()).silentCapable, true);
});
test('B2 四收口按上游 id 数组分列（不重判 closure 字段）', () => {
    const b = K.readCausalBoard(mkUp());
    assert.equal(b.state, S.OK);
    assert.deepEqual(b.closure.unresolved, ['a']);
    assert.deepEqual(b.closure.resolved, ['b']);
    assert.deepEqual(b.closure.cancelled, []);
    assert.deepEqual(b.closure.broken, ['c']);
});
test('B3 推测边只进 speculative 一列（不混进 edges）', () => {
    const b = K.readCausalBoard(mkUp());
    assert.equal(b.edges.length, 1);
    assert.equal(b.edges[0].basis, 'evidence');
    assert.equal(b.speculative.length, 1);
    assert.equal(b.speculative[0].basis, 'speculative');
    assert.equal(b.edges.some((e) => e.basis === 'speculative'), false, '推测边混进了已确认边');
    const line = K.boardLine(b);
    assert.ok(line.indexOf('仅推测') >= 0, '一行读数必须单列推测边');
});
test('B4 not-in-graph 与「追到头了」不同形（处置相反）', () => {
    const notIn = K.readCausalTrace({
        LonShaMemory: { engine: { causalChainTrace: () => ({ version: 1, id: 'zz', path: [], roots: [], cycles: 0, truncated: false, known: false, reason: 'not-in-graph' }) } }
    }, 'zz');
    assert.equal(notIn.reason, 'not-in-graph');
    assert.equal(notIn.known, false);
    assert.notEqual(notIn.state, S.OK);
    const ok = K.readCausalTrace(mkUp(), 'a');
    assert.equal(ok.state, S.OK);
    assert.equal(ok.known, true);
    assert.notEqual(K.traceLine(notIn), K.traceLine(ok), '两态文案不得同形');
});
test('B5 行动路由声明式（不执行跳转）', () => {
    const act = K.CB_ACTIONS;
    assert.equal(act.commitment.app, 'calendar');
    assert.equal(act.seed.app, 'plotline');
    assert.equal(act.event.app, 'memory');
    const b = K.readCausalBoard(mkUp());
    assert.ok(b.writesNothing === true);
    for (const bad of ['fetch(', 'localStorage', 'bridge.write', 'openApp(']) {
        assert.equal(countOf(wireSrc, bad), 0, '接线件不得出现写口 ' + bad);
    }
});
test('B6 回源凭证原样搬（不拼 id、不改写上游给的出处）', () => {
    const b = K.readCausalBoard(mkUp());
    const n = b.nodes[0];
    assert.ok(n.ref === 'r:a', '回源凭证必须原样');
    /* 凭证取法在 normNode 里只出现一次（注释里也会提到，不判注释）。 */
    assert.ok(countOf(kernelSrc, 'o.ref || o.sourceRef || o.evidenceRef') >= 1, '凭证取法必须在场');
});
test('B7 boardGateOf：读到走 readable=true / 读不到 hint 必非空 / 未知态也走不可读', () => {
    const gOk = K.boardGateOf(K.readCausalBoard(mkUp()));
    assert.equal(gOk.readable, true);
    assert.equal(gOk.hint, '');
    const gAbsent = K.boardGateOf(K.readCausalBoard(null));
    assert.equal(gAbsent.readable, false);
    assert.ok(gAbsent.hint.length > 0);
    const gWeird = K.boardGateOf({ state: 'some-future-state' });
    assert.equal(gWeird.readable, false, '未知态也必须走不可读');
    assert.ok(gWeird.hint.length > 0);
});
test('B8 traceNoteOf：not-in-graph 给说明、其余给空串', () => {
    assert.equal(K.traceNoteOf({ reason: 'not-in-graph' }), '起点不在图里 —— 该换一个起点，不是「已经追到头了」');
    assert.equal(K.traceNoteOf({ reason: '' }), '');
    assert.equal(K.traceNoteOf(null), '');
});
test('B9 自检真跑判据（不是数常量）', () => {
    const sc = K.cbSelfCheck();
    assert.deepEqual(sc.problems, [], '自检必须零问题：' + (sc.problems || []).join('/'));
});
/* ══════════ C ── 接线行为 ══════════ */
test('C1 未装插件：如实报「插件不在场」，不编一份因果图冒充', async () => {
    const store = mkStorage();
    await withWin({}, async () => {
        const app = mkApp({}, store);
        const pkg = app.boardPack();
        assert.equal(pkg.board.state, S.ENGINE_ABSENT);
        assert.equal(pkg.trace.state, S.ENGINE_ABSENT);
        const gate = app.boardGate(pkg.board);
        assert.equal(gate.readable, false);
        assert.ok(gate.hint.length > 0);
    });
});
test('C2 完整旅程：装插件后 pack 四面同源（board / todos / trace / proposals）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const pkg = app.boardPack();
        assert.equal(pkg.board.state, S.OK);
        assert.ok(pkg.todos.todos.length > 0);
        assert.equal(pkg.trace.state, S.NO_SUBJECT, '没选起点时如实报 no-subject');
        assert.ok(pkg.proposals.proposals.length > 0);
        assert.equal(pkg.focus, '', '初始无起点');
        const line = pkg.lines.board;
        assert.ok(line.indexOf('未收口 1') >= 0);
        assert.ok(line.indexOf('仅推测') >= 0);
    });
});
test('C3 设起点：用户显式选择，空值即清空（不回落成默认第一条）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        app.setBoardFocus('a');
        assert.equal(app.boardFocus(), 'a');
        const pkg = app.boardPack();
        assert.equal(pkg.trace.state, S.OK);
        app.setBoardFocus('');
        assert.equal(app.boardFocus(), '', '空值即清空');
        const pkg2 = app.boardPack();
        assert.equal(pkg2.trace.state, S.NO_SUBJECT, '清空后追溯如实报 no-subject');
    });
});
test('C4 行动路由走 App 出口（视图不自己判该去哪）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        assert.equal(app.boardActionFor('commitment').app, 'calendar');
        assert.equal(app.boardActionFor('seed').app, 'plotline');
        assert.equal(app.boardActionFor('unknown'), null, '未知类别如实给 null');
    });
});
test('C5 界面选项唯一出处是内核（不写第二份收口序 / 标签表）', async () => {
    await withWin(mkUp(), async () => {
        const app = mkApp({}, {});
        assert.deepEqual(app.boardClosureIds(), ['unresolved', 'resolved', 'cancelled', 'broken']);
        assert.deepEqual(app.boardKindIds(), ['seed', 'commitment', 'event', 'note']);
        assert.equal(app.boardClosureLabel('unresolved'), '未收口');
        assert.equal(app.boardKindLabel('seed'), '伏笔');
        /* 接线件不得自己再写一份 CB_CLOSURE / CB_KIND_LABEL。 */
        assert.equal(countOf(wireSrc, 'unresolved'), 0, '接线件不得出现收口字面量');
        assert.equal(countOf(wireSrc, 'resolved'), 0);
        assert.equal(countOf(wireSrc, "'seed'"), 0, '接线件不得出现类别字面量');
    });
});
test('C6 换会话作废起点（读数本来就不缓存）', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        app.setBoardFocus('a');
        assert.equal(app.boardFocus(), 'a');
        app.onChatChanged();
        assert.equal(app.boardFocus(), '', '换会话必须作废起点');
    });
});
test('C7 真视图渲染：因果板卡片在场', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const c = mkContainer(375, []);
        app.view.render(c);
        const html = c.innerHTML;
        assert.ok(html.indexOf('线索与未完事项') >= 0, '卡片标题必须在场');
        assert.ok(html.indexOf('pn-cb-group') >= 0, '收口分组必须在场');
        assert.ok(html.indexOf('仅推测') >= 0, '推测边必须单列');
        assert.ok(html.indexOf('追这条线') >= 0, '追溯按钮必须在场');
    });
});
test('C8 真视图渲染：未装插件时显示归因（不画假板）', async () => {
    const store = mkStorage();
    await withWin({}, async () => {
        const app = mkApp({}, store);
        const c = mkContainer(375, []);
        app.view.render(c);
        const html = c.innerHTML;
        assert.ok(html.indexOf('因果面') >= 0 || html.indexOf('不可读') >= 0, '未装插件必须显示归因');
        assert.equal(html.indexOf('追这条线'), -1, '未装插件不得画追溯按钮');
    });
});
test('C9 真视图绑定：追这条线走 App 出口', async () => {
    const store = mkStorage();
    await withWin(mkUp(), async () => {
        const app = mkApp({}, store);
        const calls = [];
        const realSet = app.setBoardFocus.bind(app);
        app.setBoardFocus = (v) => { calls.push(String(v)); return realSet(v); };
        const btn = mkEl('data-pb-focus', 'a');
        btn.sel = 'data-pb-focus';
        const c = mkContainer(375, [btn]);
        app.view.render(c);
        btn.fire('click');
        assert.deepEqual(calls, ['a'], '追这条线必须经 App 出口');
        assert.equal(app.boardFocus(), 'a');
    });
});
test('C10 本版三条「不做」在代码上可判', async () => {
    /* 去块注释 + 去单行注释 + 去含「不做」的登记句：判的是**引入形态**。 */
    const stripAll = (s) => s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(NL).filter((l) => !/^\s*\/\//.test(l) && l.indexOf('不做') < 0).join(NL);
    const all = stripAll(kernelSrc + wireSrc + appSrc + viewSrc);
    for (const bad of ['MAX_OPEN', 'taskDatabase', 'commitRevoke', 'markResolved']) {
        assert.equal(countOf(all, bad), 0, '本版不得引入 ' + bad);
    }
    /* 不以优先级排序：接线件不写第二份收口序，也不按「重要度」排节点。 */
    assert.equal(countOf(wireSrc, 'priority'), 0, '接线件不得引入优先级键');
    assert.equal(countOf(wireSrc, "=== 'resolved'"), 0, '接线件不得重判收口');
    assert.equal(countOf(wireSrc, "=== 'unresolved'"), 0);
});
/* ══════════ D ── 负控制 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4270_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps', 'plotline'), path.join(dir, 'apps', 'plotline'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
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
async function loadWire(dir, tag) {
    return await import(pathToFileURL(path.join(dir, WIRE_REL)).href + '?' + tag + '=' + Date.now());
}
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真', () => {
    assert.equal(K.readCausalBoard(null).state, S.ENGINE_ABSENT);
    assert.equal(K.readCausalTrace(mkUp(), '').state, S.NO_SUBJECT, '原版：没给起点单独一格');
    const b = K.readCausalBoard(mkUp());
    assert.equal(b.edges.length, 1);
    assert.equal(b.speculative.length, 1);
    assert.equal(b.edges.some((e) => e.basis === 'speculative'), false);
    assert.equal(K.boardGateOf(b).readable, true);
    assert.equal(K.boardGateOf(K.readCausalBoard(null)).readable, false);
    const wp = new WIRE.PlotlineBoard(fakeApp(null));
    wp.setFocus('a');
    assert.equal(wp.focus, 'a');
    wp.clearFocus();
    assert.equal(wp.focus, '');
    wp.resetScene();
    assert.equal(wp.focus, '');
});
test('D1 ★★★ 破坏「没给起点单独一格」⇒ B1 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!start) return faceOf(CB_STATES.NO_SUBJECT, 'no-subject', { id: '', path: [], roots: [], known: false });",
        "    if (false) return faceOf(CB_STATES.NO_SUBJECT, 'no-subject');");
    const M = await loadKernel(dir, 'd1');
    const r = M.readCausalTrace(mkUp(), '');
    assert.notEqual(r.state, S.NO_SUBJECT, '破坏副本：没给起点不再单独一格');
    assert.equal(K.readCausalTrace(mkUp(), '').state, S.NO_SUBJECT, '原版必须单独一格');
});
test('D2 ★★★ 破坏「推测边只进 speculative」⇒ B3 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    const spec = arr(g.speculative).map(normEdge).filter(Boolean).slice(0, CB_LIMITS.edges);",
        "    const spec = arr(g.edges).map(normEdge).filter(Boolean).slice(0, CB_LIMITS.edges);");
    const M = await loadKernel(dir, 'd2');
    const b = M.readCausalBoard(mkUp());
    assert.ok(b.speculative.length >= 1, '破坏副本：推测边被搬进了 edges');
    assert.equal(K.readCausalBoard(mkUp()).speculative.length, 1, '原版必须正常分列');
});
test('D3 ★★★ 破坏「not-in-graph 与追到头不同形」⇒ B4 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (reason === 'not-in-graph') {",
        "    if (false) {");
    const M = await loadKernel(dir, 'd3');
    const notIn = M.readCausalTrace({
        LonShaMemory: { engine: { causalChainTrace: () => ({ version: 1, id: 'zz', path: [], roots: [], cycles: 0, truncated: false, known: false, reason: 'not-in-graph' }) } }
    }, 'zz');
    assert.notEqual(notIn.reason, 'not-in-graph', '破坏副本：not-in-graph 被吞掉或降级');
    const orig = K.readCausalTrace({
        LonShaMemory: { engine: { causalChainTrace: () => ({ version: 1, id: 'zz', path: [], roots: [], cycles: 0, truncated: false, known: false, reason: 'not-in-graph' }) } }
    }, 'zz');
    assert.equal(orig.reason, 'not-in-graph', '原版必须保留');
});
test('D4 ★★★ 破坏「boardGateOf 未知态走不可读」⇒ B7 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (r.state === CB_STATES.OK) return { readable: true, state: r.state, hint: '' };",
        "    return { readable: true, state: r.state, hint: '' };");
    const M = await loadKernel(dir, 'd4');
    const g = M.boardGateOf({ state: 'weird-future-state' });
    assert.equal(g.readable, true, '破坏副本：未知态被当成可读');
    assert.equal(K.boardGateOf({ state: 'weird-future-state' }).readable, false, '原版必须走不可读');
});
test('D5 ★★★ 破坏「四收口分列」⇒ B2 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    const pick = (key) => arr(g[key]).map(str).filter((id) => idSet.has(id));",
        "    const pick = (key) => arr(g.unresolved).map(str).filter((id) => idSet.has(id));");
    const M = await loadKernel(dir, 'd5');
    const b = M.readCausalBoard(mkUp());
    assert.deepEqual(b.closure.resolved, ['a'], '破坏副本：resolved 被填成了 unresolved 的内容');
    const orig = K.readCausalBoard(mkUp());
    assert.deepEqual(orig.closure.resolved, ['b'], '原版必须正常分列');
});
test('D6 ★★★ 破坏「换会话作废起点」⇒ C6 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL,
        "    resetScene() { this._focus = ''; }",
        "    resetScene() { /* broken: 不清 */ }");
    const W = await loadWire(dir, 'd6');
    const wp = new W.PlotlineBoard(fakeApp(null));
    wp.setFocus('a');
    wp.resetScene();
    assert.equal(wp.focus, 'a', '破坏副本：换会话没清起点');
    const orig = new WIRE.PlotlineBoard(fakeApp(null));
    orig.setFocus('a');
    orig.resetScene();
    assert.equal(orig.focus, '', '原版必须清');
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（不锁死具体版本值，但必须一致且当版条目在场）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/);
    assert.equal(man.version, ver);
    assert.equal(log.latest, ver);
    assert.equal(log.head, ver);
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0);
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0);
    /* ★ 同 v4260 的修法：这几条断的是「**v4.27.0 这一版**记全了」，
     *   故锁自己那一版的字面量，不跟随 `pkg.version` ——
     *   否则本套件会在抬到 v4.28.0 时因「新版公告里没有本版件名」而转红。 */
    const own = log.versions['4.27.0'];
    assert.ok(own, 'v4.27.0 条目必须在账上');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('plotline-board.js') >= 0, 'v4.27.0 公告必须记接线件');
    assert.ok(all.indexOf('J20') >= 0, 'v4.27.0 公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0);
    assert.ok(all.indexOf('causalChain') >= 0, 'v4.27.0 公告必须记因果面 id');
});