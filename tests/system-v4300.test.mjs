/* ============================================================
 * tests/system-v4300.test.mjs -- [v4.30.0 · 第四期 R4-X9 面向下一幕的写作取材板]
 *
 * 验收口径（计划原文 R4-X9）：
 *   「选择人物、地点、时间和写作目标，预览该用的旧事、尚未兑现的约定及禁知内容边界，
 *     再选择用于主聊天或创作草稿。」
 *   落点与依赖：creationdesk 复用 context-compose / 注入预算 owner；**M4-X8 负责按任务组织事实，
 *     手机负责取舍和目标选择**。引用动态重取，不存第二套世界状态。
 *   验收四条：① 同一人物分别准备「重逢」「赴约」「冲突后和解」三幕，材料有任务差异且均可回源；
 *     ② 取消不触发生成；③ 选定时点之后的事实不提前进入；④ 最终生成需真宿主/真模型体验核验。
 *   不做三条：不自动编造未发生事件、不替用户推进时间、不新建导演代理或注入框架。
 *
 * 【本件与 R4-X7 不同（读码可复算）】
 *   R4-X7 是**下游自建**（上游外供面表里没有投票面）；本件**消费上游真面**：
 *   上游 v3.346.0（M4-X8）交付 `material-pack.js`，本版三处同批把它接上
 *   （上游补表行 06ff173 / 本仓 registry 登记行 lonsha.materialPack / 本门 J22 标签），
 *   故本件同时锁「消费点下限」与「声明 ↔ 标签 ↔ 表行」三处逐字一致。
 *
 * 【本版治的缺陷形态（三条，都不是报错）】
 *   ① 「这一幕没有材料」与「插件没装」在界面上同形（都读成「取材板空着」），
 *      而两者处置相反：前者该去补事实或换一幕，后者该去装插件；
 *   ② 「池里有材料但一条都没进包」（全被两条闸挡住 / 全部未归面）与「池里就是空的」同形
 *      —— 前者要去看 held 里被挡住的是谁，后者才是真没有；
 *   ③ 手机侧没有「时点」这一格：选定的材料里混进**选定之后才发生**的事实，
 *      等于把没发生的剧情当成已发生交出去，而一个字符都不报错。
 *   故本件的三条口径在本套件里是**可判的**：五态两两不同形、池有而包空仍是 ok、
 *   时点之后的事实进 afterAsOf 且**不静默丢**。
 *
 * 判据面（五组）：
 *   A 口径：五态两两不同形 / 纯内核零副作用（只依赖唯一取数门） / 出口名与状态字面量唯一出现点 /
 *          视图不直呼内核（只认 App 出口） / 禁用键清单在场且**有意差异**（不许误禁排序键）
 *   B 内核行为：五态分形逐态 / 池有而包空与池空不同形 / 两条闸分别计数 / 缺口逐面具名 /
 *              时点闸（三类分列）/ 入参畸形与池空不同形 / 自检真跑
 *   C 接线行为：真接线件走完整旅程（读不到 → 五态 → 设任务/时点/勾选 → 换会话作废 →
 *              真视图渲染与绑定 → 交接零写盘 → 取消不触发生成）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 三处同批（上游表行 / 本仓登记行 / 本门标签）逐字一致
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
const NL = String.fromCharCode(10);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/material-board-contract.js';
const WIRE_REL = 'apps/creationdesk/creationdesk-board.js';
const VIEW_REL = 'apps/creationdesk/creationdesk-view.js';
const APP_REL = 'apps/creationdesk/creationdesk-app.js';
const GATE_REL = 'scripts/bridge-contract-audit.mjs';
const REGISTRY_REL = 'config/crossrepo-registry.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const WIRE = await import(pathToFileURL(path.join(ROOT, WIRE_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const kernelSrc = read(KERNEL_REL);
const wireSrc = read(WIRE_REL);
const viewSrc = read(VIEW_REL);
const appSrc = read(APP_REL);
const S = K.MB_STATES;
const countOf = (hay, needle) => hay.split(needle).length - 1;
/** 去注释（块注释 + 整行注释）：判据只认代码，不认注释里的自述。 */
const stripAll = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);
/* 本面独有的状态字面量：**只许内核一份**（接线层与视图零命中）。
 *   ★ 'meet' / 'reunion' / 'restricted' / 'future' 等不进这一档：
 *     视图要以它们作**查表键**（这不算第二份判定），算进来是误报。
 *   这一档只收「状态 / 归因」词，它们的唯一出现点就是内核的表。 */
const KERNEL_ONLY = ["'engine-absent'", "'face-absent'", "'unusable'",
    "'no-deps'", "'malformed'"];
/* 选定两类未取的**标签文案**：唯一出处是内核表（接线层与视图只准引用键，不准抄文案）。
 *   ★ 键本身（'not-in-pack' / 'after-as-of'）**不算**第二份判定：视图拿它去内核表取文案，
 *     与 'meet' / 'restricted' 同理 —— 把查表键也算违规会把正常用法读成违规（误报）。 */
const KERNEL_ONLY_LABELS = [K.MB_PICK_HELD_LABEL['not-in-pack'], K.MB_PICK_HELD_LABEL['after-as-of'],
    K.MB_FACET_LABEL.appointment, K.MB_FACET_LABEL.relation];
/* ══════════ 假件 ══════════ */
/** 上游读数假件：只按上游契约形状造（**不 import 上游**）。 */
const baseOut = () => ({
    kind: 'material_pack', version: 1, judged: true,
    task: 'meet', taskLabel: '赴约', taskGiven: true, taskKnown: true,
    priority: K.MB_FACETS.slice(), criticalFacets: ['appointment', 'place', 'participants'],
    pack: [], packIds: [], sheet: [], gaps: [], gapsCritical: [],
    superseded: [], held: { restricted: [], future: [], superseded: [], unclassified: [] },
    budget: { given: false, perItem: 9 }, overBudget: [],
    cost: { items: 0, estChars: 0, estCharsAll: 0, estCharsSkipped: 0 },
    counts: { inventory: 0, usable: 0, packed: 0, restricted: 0, future: 0, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 },
    reasons: [], orderIsRank: true, writesNothing: true
});
const PACK3 = [
    { id: 'm1', facet: 'appointment', title: '周三的约', floor: 5, source: 'promise', order: 1, facetRank: 0, usable: true },
    { id: 'm2', facet: 'place', title: '老码头', floor: 4, source: 'scene-book', order: 2, facetRank: 1, usable: true },
    { id: 'm3', facet: 'participants', title: '阿岚到场', floor: 9, source: 'relation', order: 3, facetRank: 2, usable: true }
];
const okOut = () => Object.assign(baseOut(), {
    pack: PACK3.slice(), packIds: ['m1', 'm2', 'm3'],
    sheet: K.MB_FACETS.map((f, i) => ({ facet: f, facetLabel: K.MB_FACET_LABEL[f], count: i < 3 ? 1 : 0, critical: i < 3, ids: [] })),
    gaps: K.MB_FACETS.slice(3).map((f) => ({ facet: f, facetLabel: K.MB_FACET_LABEL[f], critical: false })),
    counts: { inventory: 3, usable: 3, packed: 3, restricted: 0, future: 0, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 }
});
/** 假宿主：**按真取法**造（内核读的是 `win.LonShaMemory.engine` —— 少一层包装整组会假绿）。 */
function mkWin(fn) { return { LonShaMemory: { engine: { materialPack: fn } } }; }
const WIN_NONE = {};
const WIN_MOD_ONLY = { LonShaMaterialPack: { build: function () { return {}; } } };
const WIN_FACE_ABSENT = mkWin(() => ({ kind: 'material_pack', version: 0, judged: false }));
const WIN_EMPTY = mkWin(() => baseOut());
const WIN_OK = mkWin(() => okOut());
const WIN_ALL_HELD = mkWin(() => Object.assign(baseOut(), {
    held: {
        restricted: [{ id: 'h1', facet: 'place', title: '他不该知道的地方', why: 'restricted' }],
        future: [{ id: 'h2', facet: 'place', title: '打算去的地方', why: 'future' }],
        superseded: [{ id: 'h3', facet: 'place', title: '旧地址', why: 'superseded', supersededBy: 'm2' }],
        unclassified: [{ id: 'h4', facetRaw: 'person', title: '没归面的那条', why: 'unclassified' }]
    },
    counts: { inventory: 4, usable: 0, packed: 0, restricted: 1, future: 1, unclassified: 1, superseded: 1, truncated: 0, dropped: 0, truncatedIn: 0 }
}));
/** 任务轴窗口：同一池，赴约与重逢**不同序**（顺序由上游给，内核只如实搬运）。 */
const WIN_TASK_AXIS = mkWin((task) => Object.assign(baseOut(), {
    task: task, taskLabel: K.MB_TASK_LABEL[task],
    pack: (task === 'reunion'
        ? [{ id: 'm3', facet: 'relation', title: '和解了', floor: 4, source: 'relation', order: 1, facetRank: 0, usable: true },
           { id: 'm1', facet: 'appointment', title: '周三的约', floor: 5, source: 'promise', order: 2, facetRank: 6, usable: true }]
        : [{ id: 'm1', facet: 'appointment', title: '周三的约', floor: 5, source: 'promise', order: 1, facetRank: 0, usable: true },
           { id: 'm3', facet: 'relation', title: '和解了', floor: 4, source: 'relation', order: 2, facetRank: 5, usable: true }]),
    packIds: (task === 'reunion' ? ['m3', 'm1'] : ['m1', 'm3']),
    counts: { inventory: 2, usable: 2, packed: 2, restricted: 0, future: 0, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 }
}));
const WIN_MALFORMED = mkWin(() => Object.assign(baseOut(), { judged: false, malformedInput: true }));
/** 上游认不出任务时**原样回 advance**（不编第五类）—— 本窗口 task 为空，专测那一路。 */
const WIN_TASK_UNKNOWN = mkWin(() => Object.assign(okOut(), { task: '', taskLabel: '', taskGiven: false, taskKnown: false }));
/** 接线件 + 假宿主（视图只经 App 出口取数）。 */
function mkApp(win) {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => win });
    const notes = [];
    return {
        _wire: wire,
        _notes: notes,
        _hostWin: () => win,
        render() {},
        boardPack: () => wire.packAll(),
        boardLine: () => wire.packLineOf(wire.pack()),
        boardTaskIds: () => wire.taskIds(),
        boardTaskLabel: (t) => wire.taskLabel(t),
        boardHeldBucketIds: () => wire.heldBucketIds(),
        boardHeldBucketLabel: (b) => wire.heldBucketLabel(b),
        boardPickHeldIds: () => wire.pickHeldIds(),
        boardPickHeldLabel: (b) => wire.pickHeldLabel(b),
        boardStateHint: (s) => wire.stateHint(s),
        setBoardTask: (t) => wire.setTask(t),
        setBoardAsOf: (v) => wire.setAsOf(v),
        toggleBoardPicked: (id) => wire.togglePicked(id),
        boardHandoff: () => wire.handoff(),
        cancelBoard: () => wire.cancel()
    };
}
/** 视图假件：Object.create(真 CreationdeskView.prototype)，只补它真正用到的字段。 */
function mkView(app) {
    const v = Object.create(VIEW.CreationdeskView.prototype);
    v.app = app;
    v.root = null;
    return v;
}
/* ══════════ A ── 口径 ══════════ */
test('A1 五态两两不同形（没装 / 面不在场 / 读不出 / 真跑过零材料 / 读到）', () => {
    const st = Object.keys(S).map((k) => S[k]);
    assert.equal(new Set(st).size, 5, '五态必须五态不同形');
    const w = [WIN_NONE, WIN_MOD_ONLY, WIN_FACE_ABSENT, WIN_EMPTY, WIN_OK].map((x) => K.readMaterialPack(x, { task: 'meet' }).state);
    assert.equal(new Set(w).size, 5, '真跑五态必须两两不同形');
    /* 归因词也要五句不同形（两态共用一句 = 压平）。 */
    const words = [S.ENGINE_ABSENT, S.FACE_ABSENT, S.UNUSABLE, S.EMPTY, S.OK].map((s) => {
        if (s === S.ENGINE_ABSENT) return K.MB_REASONS['engine-absent'];
        if (s === S.FACE_ABSENT) return K.MB_REASONS['face-absent'];
        if (s === S.UNUSABLE) return K.MB_REASONS.unusable;
        if (s === S.EMPTY) return K.MB_REASONS.empty;
        return K.MB_REASONS.ok;
    });
    assert.equal(new Set(words).size, 5, '五态归因词不许两态共用一句');
});
test('A2 纯内核零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    const src = stripAll(kernelSrc);
    /* 唯一 import：数值取值门（config/num-gate.js）。 */
    const imports = src.split(NL).filter((l) => /^\s*import\s/.test(l));
    assert.equal(imports.length, 1, '内核只许一条 import（实测 ' + imports.length + '）：' + imports.join(' | '));
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '唯一 import 必须是数值取值门');
    for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'document.', 'fetch(', 'XMLHttpRequest', 'setTimeout(', 'Date.now(']) {
        assert.equal(src.indexOf(bad), -1, '内核不得出现 ' + bad);
    }
});
test('A3 出口名与状态字面量唯一出现点：改一处即全仓同改', () => {
    for (const name of ['readMaterialPack', 'readMaterialPackSheet', 'readMaterialPackHeld', 'readMaterialPackPick']) {
        assert.ok(new RegExp('export\\s+function\\s+' + name + '\\s*\\(').test(kernelSrc), '内核必须导出 ' + name);
    }
    /* 状态 / 归因字面量：只许内核一份（接线层与视图零命中）。 */
    const w = stripAll(wireSrc);
    const v = stripAll(viewSrc);
    for (const lit of KERNEL_ONLY) {
        assert.equal(countOf(w, lit), 0, '接线件不得复写状态字面量 ' + lit);
        assert.equal(countOf(v, lit), 0, '视图不得复写状态字面量 ' + lit);
    }
    /* 标签文案也不许外泄（接线层与视图只准引用键，文案的唯一出处是内核表）。 */
    for (const lit of KERNEL_ONLY_LABELS) {
        assert.ok(lit && lit.length > 0, '内核标签表必须真给得出文案');
        assert.equal(countOf(w, lit), 0, '接线件不得复写标签文案 ' + lit);
        assert.equal(countOf(v, lit), 0, '视图不得复写标签文案 ' + lit);
    }
});
test('A4 视图不直呼内核：判定全由 App 转交', () => {
    const v = stripAll(viewSrc);
    assert.equal(v.indexOf('material-board-contract'), -1, '视图不得直接 import 内核件');
    for (const name of ['readMaterialPack(', 'packLine(', 'sheetLine(', 'heldLine(', 'pickLine(']) {
        assert.equal(countOf(v, name), 0, '视图不得直呼内核出口 ' + name);
    }
    /* 视图也不直呼接线件实例（只认 App 出口）。 */
    assert.equal(countOf(v, 'this.app._board'), 0, '视图不得直呼接线件实例');
    const a = stripAll(appSrc);
    assert.ok(a.indexOf('CreationdeskBoard') >= 0, 'App 必须持接线件');
    for (const name of ['boardTaskLabel', 'boardHeldBucketLabel', 'boardPickHeldLabel']) {
        assert.ok(countOf(a, name) >= 1, 'App 必须提供转发出口 ' + name);
    }
});
test('A5 禁用键清单在场且非空，且**有意差异**：不许误禁本面必须搬运的确定性排序键', () => {
    assert.ok(K.MB_FORBIDDEN_KEYS.length >= 8, '禁用键清单不许为空（空清单等于不扫）');
    /* ★ 与 R4-X4 的清单差异是**有意的**：本面必须搬运上游的确定性排序键。 */
    for (const k of ['priority', 'rank', 'index']) {
        assert.equal(K.MB_FORBIDDEN_KEYS.indexOf(k), -1, '禁用键清单不许含必须搬运的排序键 ' + k);
    }
    for (const k of ['score', 'percent', 'confidence', 'recommend']) {
        assert.ok(K.MB_FORBIDDEN_KEYS.indexOf(k) >= 0, '禁用键清单必须含 ' + k);
    }
    /* 真跑：读数里不得出现禁用键一族。 */
    assert.equal(K.hasForbiddenKey(K.readMaterialPack(WIN_OK, { task: 'meet' })), false, '真读数不许含禁用键');
    assert.equal(K.hasForbiddenKey({ nested: [{ score: 1 }] }), true, '深度扫描必须能抓到嵌套的禁用键');
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 五态分形逐态实测（没装 / 面不在场 / 读不出 / 真跑过零材料 / 读到）', () => {
    const r1 = K.readMaterialPack(WIN_NONE, { task: 'meet' });
    assert.equal(r1.state, S.ENGINE_ABSENT);
    assert.equal(r1.silentCapable, false, '没跑过不许替沉默作证');
    const r2 = K.readMaterialPack(WIN_MOD_ONLY, { task: 'meet' });
    assert.equal(r2.state, S.UNUSABLE);
    assert.equal(r2.reason, 'no-deps', '模块在场而宿主没装配 ⇒ no-deps（**不是**没装插件）');
    const r3 = K.readMaterialPack(WIN_FACE_ABSENT, { task: 'meet' });
    assert.equal(r3.state, S.FACE_ABSENT);
    const r4 = K.readMaterialPack(WIN_EMPTY, { task: 'meet' });
    assert.equal(r4.state, S.EMPTY);
    assert.equal(r4.silentCapable, true, '真跑过（零材料）可替沉默作证');
    assert.equal(r4.poolHasMaterial, false);
    const r5 = K.readMaterialPack(WIN_OK, { task: 'meet' });
    assert.equal(r5.state, S.OK);
    assert.deepEqual(r5.packIds, ['m1', 'm2', 'm3']);
    assert.equal(r5.poolHasMaterial, true);
    /* 五态各自的 silentCapable 只许在真跑过的两态为真。 */
    for (const r of [r1, r2, r3]) assert.equal(r.silentCapable, false, '没跑过的态不许替沉默作证');
});
test('B2 池有而包空与池空**不同形**（前者仍是 ok，且 held 里四类具名）', () => {
    const empty = K.readMaterialPack(WIN_EMPTY, { task: 'meet' });
    const allHeld = K.readMaterialPack(WIN_ALL_HELD, { task: 'meet' });
    assert.equal(empty.state, S.EMPTY, '池空 ⇒ empty');
    assert.equal(allHeld.state, S.OK, '池有材料但零进包 ⇒ 仍是 ok（不许读成 empty）');
    assert.equal(allHeld.packIds.length, 0);
    assert.equal(allHeld.counts.inventory, 4);
    /* 四类**分别**具名（压成一格就分不出「不该带」与「没轮到」）。 */
    assert.equal(allHeld.held.restricted.length, 1);
    assert.equal(allHeld.held.future.length, 1);
    assert.equal(allHeld.held.superseded.length, 1);
    assert.equal(allHeld.held.unclassified.length, 1);
    assert.equal(allHeld.held.superseded[0].supersededBy, 'm2', '被取代者必须**具名**被谁取代');
    assert.ok(K.mbNoteOf(allHeld).indexOf('一条都没进包') >= 0, '说明行必须指出「去看被挡住的是谁」');
});
test('B3 两条闸**分别计数**（受限与未发生不许压成一格）', () => {
    const h = K.readMaterialPackHeld(WIN_ALL_HELD, { task: 'meet' });
    assert.equal(h.restrictedCount, 1);
    assert.equal(h.futureCount, 1);
    assert.notEqual(h.restrictedCount, h.futureCount === 0 ? 0 : -1, '两格必须各自可读');
    assert.ok(h.bucketLabels.restricted !== h.bucketLabels.future, '两格标签不许同形');
    const line = K.heldLine(h);
    assert.ok(line.indexOf('受限 1') >= 0, '一行读数必须报受限数');
    assert.ok(line.indexOf('未发生 1') >= 0, '一行读数必须报未发生数');
});
test('B4 缺口逐面具名：关键面另列，且**不许**混进普通缺口压平', () => {
    const w = mkWin(() => Object.assign(baseOut(), {
        pack: [{ id: 's1', facet: 'item', title: '旧钥匙', floor: 4, source: 'recall', usable: true }],
        packIds: ['s1'],
        sheet: K.MB_FACETS.map((f, i) => ({ facet: f, facetLabel: K.MB_FACET_LABEL[f], count: i === 7 ? 1 : 0, critical: i < 3, ids: [] })),
        gaps: K.MB_FACETS.filter((f, i) => i !== 7).map((f, i) => ({ facet: f, facetLabel: K.MB_FACET_LABEL[f], critical: i < 3 })),
        gapsCritical: K.MB_FACETS.slice(0, 3).map((f) => ({ facet: f, facetLabel: K.MB_FACET_LABEL[f], critical: true })),
        counts: { inventory: 1, usable: 1, packed: 1, restricted: 0, future: 0, unclassified: 0, superseded: 0, truncated: 0, dropped: 0, truncatedIn: 0 }
    }));
    const r = K.readMaterialPack(w, { task: 'meet' });
    assert.equal(r.gapsCritical.length, 3, '关键面零材料必须另列');
    assert.ok(r.gapsCritical.every((g) => g.critical === true && g.facetLabel !== ''), '关键面缺口必须带标签');
    assert.ok(r.gaps.length > r.gapsCritical.length, '普通缺口与关键缺口**不许压平成一格**');
    const s = K.readMaterialPackSheet(w, { task: 'meet' });
    assert.equal(s.criticalEmpty.length, 3, '逐面明细必须单列「关键面里空着的」');
    assert.ok(K.sheetLine(s).indexOf('空面:') >= 0, '逐面行必须把空面点出来');
    assert.ok(K.mbNoteOf(r).indexOf('关键面缺') >= 0, '说明行必须点名关键面缺口');
});
test('B5 时点闸：选定之后的事实进 afterAsOf 且**不静默丢**（三类分列）', () => {
    const p = K.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'm2', 'm3', 'mZ'], asOf: 5 });
    /* m1(5) 与 m2(4) 在时点之内 ⇒ 能交；m3(9) 在之后 ⇒ 不该取；mZ 不在包里 ⇒ 无从取。 */
    assert.deepEqual(p.ids, ['m1', 'm2']);
    assert.equal(p.count, 2);
    assert.equal(p.afterAsOf.length, 1);
    assert.equal(p.afterAsOf[0].id, 'm3');
    assert.equal(p.afterAsOf[0].why, 'after-as-of');
    assert.equal(p.notInPack.length, 1);
    assert.equal(p.notInPack[0].id, 'mZ');
    assert.equal(p.notInPack[0].why, 'not-in-pack');
    assert.ok(K.MB_PICK_HELD_LABEL['not-in-pack'] !== K.MB_PICK_HELD_LABEL['after-as-of'], '两类未取不许同形');
    assert.equal(p.writesNothing, true, '选定集合只是读数');
    /* 没给时点 ⇒ 不判在时点之后（没有定位格就没有判据，不编一个）。 */
    const p2 = K.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'm3'], asOf: null });
    assert.equal(p2.afterAsOf.length, 0);
    assert.equal(p2.asOfGiven, false);
    assert.deepEqual(p2.ids, ['m1', 'm3']);
    /* 没勾任何东西 ⇒ 不许凭空产出选定集合。 */
    const p3 = K.readMaterialPackPick(WIN_OK, { task: 'meet', picked: [], asOf: 5 });
    assert.equal(p3.count, 0);
    assert.equal(p3.afterAsOf.length, 0);
    assert.equal(p3.notInPack.length, 0);
    const line = K.pickLine(p);
    assert.ok(line.indexOf('能交 2 条') >= 0, '选定行必须报能交几条');
    assert.ok(line.indexOf('时点之后 1') >= 0, '选定行必须报时点之后几条');
});
test('B6 入参畸形与池空**不同形**（前者无从选材，后者是合法的「这次没有材料」）', () => {
    const bad = K.readMaterialPack(WIN_MALFORMED, { task: 'meet' });
    const empty = K.readMaterialPack(WIN_EMPTY, { task: 'meet' });
    assert.equal(bad.state, S.UNUSABLE);
    assert.equal(bad.reason, 'malformed');
    assert.equal(empty.state, S.EMPTY);
    assert.notEqual(bad.state, empty.state, '判不了与没有**不许同形**');
    assert.notEqual(K.MB_REASONS.malformed, K.MB_REASONS.empty);
});
test('B7 任务轴真的改变产物（同一池，赴约与重逢不同序）', () => {
    const meet = K.readMaterialPack(WIN_TASK_AXIS, { task: 'meet' });
    const reunion = K.readMaterialPack(WIN_TASK_AXIS, { task: 'reunion' });
    assert.notEqual(meet.packIds.join(','), reunion.packIds.join(','), '四种任务的产物不许同形');
    assert.equal(meet.packIds[0], 'm1', '赴约场首位落在约定面');
    assert.equal(reunion.packIds[0], 'm3', '重逢场首位落在关系面');
    /* 未识别的任务 ⇒ 按推进并**说明**（不编第五类）。
     *   ★ 必须用**上游回空 task 的窗口**：拿 WIN_OK（它固定回 meet）来测这一路，
     *     判据量到的其实是上游给的 task，与本件「认不出怎么办」无关（判据打偏）。 */
    const weird = K.readMaterialPack(WIN_TASK_UNKNOWN, { task: '不存在的任务' });
    assert.equal(weird.task, 'advance', '认不出上游 task ⇒ 按推进');
    assert.ok(weird.taskWhy.indexOf('未识别') >= 0, '认不出任务必须说明，不许静默替换');
});
test('B8 调用方给的预算与材料**原样转交**（本件不替调用方改一个字段）', () => {
    let seen = null;
    const w = mkWin((task, opts) => { seen = { task: task, opts: opts }; return okOut(); });
    K.readMaterialPack(w, { task: 'meet', budget: 3, materials: [{ id: 'x', facet: 'place' }] });
    assert.equal(seen.task, 'meet');
    assert.equal(seen.opts.budget, 3, '预算必须原样转交');
    assert.deepEqual(seen.opts.materials, [{ id: 'x', facet: 'place' }], '调用方直给的材料必须原样转交');
    /* 没给预算时**不凭空造一个**（让上游用它自己的缺省并如实报 given:false）。 */
    K.readMaterialPack(w, { task: 'meet' });
    assert.equal(seen.opts.budget, undefined, '调用方没给预算时不许替它填一个');
});
test('B9 自检真跑判据（不是数常量）', () => {
    const sc = K.mbSelfCheck();
    assert.equal(sc.problems.length, 0, '内核自检必须 0 问题：' + sc.problems.join(' / '));
    assert.ok(Array.isArray(sc.problems), '自检必须返回可读的问题清单');
});
/* ══════════ C ── 接线行为 ══════════ */
test('C1 读不到上游：如实报读不出，不假装成「这一幕没有材料」', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_NONE });
    const r = wire.pack();
    assert.equal(r.state, S.ENGINE_ABSENT);
    assert.ok(wire.packLineOf(r).indexOf('记忆插件未装') >= 0);
    assert.equal(wire.gate(r).readable, false, '读不到 ⇒ 视图不该画取材板');
    assert.equal(wire.note(r).indexOf('没有材料'), -1, '说明行不许把「没装插件」写成「没有材料」');
});
test('C2 完整旅程：真接线件走五态 → 设任务 → 设时点 → 勾选 → 交接读数', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    assert.equal(wire.pack().state, S.OK);
    assert.equal(wire.setTask('meet'), 'meet');
    assert.equal(wire.setAsOf(5), 5);
    wire.togglePicked('m1');
    wire.togglePicked('m3');
    wire.togglePicked('mZ');
    const pack = wire.packAll();
    assert.equal(pack.task, 'meet');
    assert.equal(pack.asOf, 5);
    assert.deepEqual(pack.picked, ['m1', 'm3', 'mZ']);
    assert.equal(pack.pick.count, 1, 'm1 在时点内能交');
    assert.equal(pack.pick.afterAsOf.length, 1, 'm3 在时点之后');
    assert.equal(pack.pick.notInPack.length, 1, 'mZ 不在本幕包里');
    const ho = wire.handoff();
    assert.equal(ho.count, 1);
    assert.deepEqual(ho.ids, ['m1']);
    assert.equal(ho.writesNothing, true, '交接读数只是读数');
    assert.equal(ho.handoff.budgetOwner, 'injection-router', '交接对象必须是既有 owner');
    assert.equal(ho.handoff.draftOwner, 'creation-pipeline');
});
test('C3 设任务：空值即清空（不回落成「推进」）', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    wire.setTask('reunion');
    assert.equal(wire.task, 'reunion');
    wire.setTask('');
    assert.equal(wire.task, '', '空值即清空，不许回落成「推进」');
    wire.setTask('不认识');
    assert.equal(wire.task, '', '认不出的任务不许塞进实例态');
    /* 读数里如实按推进并说明（契约件那一层的事）。
     *   ★ 实例任务为空 ⇒ 读数报 given:false 且**无说明**（什么都没给，谈不上「未识别」）；
     *     「未识别 ⇒ 按推进并说明」那一路必须**显式传一个不认识的任务**才走得到。 */
    const wire2 = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_TASK_UNKNOWN });
    const rEmpty = wire2.pack();
    assert.equal(rEmpty.task, 'advance');
    assert.equal(rEmpty.taskGiven, false, '什么都没给时不许报 given:true');
    assert.equal(rEmpty.taskWhy, '', '什么都没给时谈不上「未识别」，不许编一句说明');
    const rWeird = wire2.pack({ task: '不认识的任务' });
    assert.equal(rWeird.task, 'advance');
    assert.ok(rWeird.taskWhy.indexOf('未识别') >= 0, '显式给了不认识的任务必须说明');
});
test('C4 设时点：空值即清空（不默认挑一个楼层）', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    wire.setAsOf(7);
    assert.equal(wire.asOf, 7);
    wire.setAsOf('');
    assert.equal(wire.asOf, null, '空值即清空，不许默认挑一个楼层');
    wire.setAsOf('不是数字');
    assert.equal(wire.asOf, null, '认不出的时点不许塞进实例态');
    wire.setAsOf(null);
    assert.equal(wire.asOf, null);
});
test('C5 勾选：空 id 一律忽略；再勾一次即取消（视图不自己记）', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    assert.deepEqual(wire.togglePicked(''), []);
    assert.deepEqual(wire.togglePicked('  '), []);
    wire.togglePicked('m1');
    wire.togglePicked('m2');
    assert.deepEqual(wire.picked, ['m1', 'm2']);
    wire.togglePicked('m1');
    assert.deepEqual(wire.picked, ['m2'], '再勾一次即取消');
    assert.deepEqual(wire.clearPicked(), []);
});
test('C6 取消不触发生成（验收②），且交接读数里零写面', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    wire.setTask('meet');
    wire.setAsOf(5);
    wire.togglePicked('m1');
    const c = wire.cancel();
    assert.equal(c.generated, false, '取消**不许**触发生成');
    assert.equal(c.writesNothing, true);
    assert.deepEqual(wire.picked, [], '取消必须清掉勾选');
    assert.equal(wire.asOf, null, '取消必须清掉时点');
    /* 接线件里不得出现任何写面调用。 */
    const w = stripAll(wireSrc);
    for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'storage.set', 'setItem', 'fetch(', 'publish', 'addMoment']) {
        assert.equal(w.indexOf(bad), -1, '接线件不得出现写面 ' + bad);
    }
});
test('C7 换会话作废：任务 / 时点 / 勾选全清（读数本来就不缓存）', () => {
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    wire.setTask('resolve');
    wire.setAsOf(9);
    wire.togglePicked('m1');
    wire.resetScene();
    assert.equal(wire.task, '');
    assert.equal(wire.asOf, null);
    assert.deepEqual(wire.picked, []);
    /* App 侧也必须在换会话时清（否则上一个角色的选中项会留着）。 */
    const a = stripAll(appSrc);
    assert.ok(a.indexOf('_board.resetScene()') >= 0, 'App 的 onChatChanged 必须清取材板实例态');
});
test('C8 真视图渲染：读到时可辨（任务行 / 条目行 / 交接与取消按钮同屏）', () => {
    const app = mkApp(WIN_OK);
    app.setBoardTask('meet');
    const v = mkView(app);
    const html = v._board({ board: app.boardPack(), note: '' });
    assert.ok(html.indexOf('面向下一幕的取材板') >= 0, '段标题必须在场');
    assert.ok(html.indexOf('data-cw-btask') >= 0, '任务按钮必须在场');
    assert.ok(html.indexOf('data-cw-basof') >= 0, '时点输入必须在场');
    assert.ok(html.indexOf('data-cw-bpick') >= 0, '条目勾选必须在场');
    assert.ok(html.indexOf('data-cw-bhandoff') >= 0, '交接按钮必须在场');
    assert.ok(html.indexOf('data-cw-bcancel') >= 0, '取消按钮必须在场');
    /* 被挡住与被取代都在场（具名）。 */
    const app2 = mkApp(WIN_ALL_HELD);
    const html2 = mkView(app2)._board({ board: app2.boardPack(), note: '' });
    assert.ok(html2.indexOf('被挡住') >= 0, '被挡住行必须在场');
});
test('C9 真视图：读不出时不摆条目行、也不画交接按钮（不拿空板冒充）', () => {
    const app = mkApp(WIN_NONE);
    const v = mkView(app);
    const html = v._board({ board: app.boardPack(), note: '' });
    assert.equal(html.indexOf('data-cw-btask'), -1, '读不出时不许摆任务行');
    assert.equal(html.indexOf('data-cw-bpick'), -1, '读不出时不许摆条目行');
    assert.equal(html.indexOf('data-cw-bhandoff'), -1, '读不出时不许画交接按钮');
    assert.ok(html.indexOf('未检测到') >= 0 || html.indexOf('插件') >= 0, '读不出时必须如实给出处置建议');
});
test('C10 真视图绑定：动作全走 App 出口（视图不自己记、不落笔）', () => {
    const v = stripAll(viewSrc);
    for (const name of ['setBoardTask', 'setBoardAsOf', 'toggleBoardPicked', 'boardHandoff', 'cancelBoard']) {
        assert.ok(countOf(v, name) >= 1, '视图必须经 App 出口调用 ' + name);
    }
    assert.equal(v.indexOf('storage'), -1, '视图不得碰存储');
    /* ★ 「视图不得发布」只判**取材板段**：既有视图的 `data-cw-act="publish"`
     *   是 R-X6 的发布白名单（另一件事），拿它判本版会把旧功能读成本版违规。 */
    const segStart = viewSrc.indexOf('_board(vm) {');
    const segEnd = viewSrc.indexOf('_html(vm) {', segStart);
    assert.ok(segStart > 0 && segEnd > segStart, '取材板段必须在场且可切出方法体');
    /* ★ 只取**那一个方法体**：切到文件尾会把 _bind 里既有的 topic publish 白名单
     *   一起算进来（那是 R3-X4 的旧功能，不是本版的落点）。 */
    const seg = viewSrc.slice(segStart, segEnd);
    assert.equal(seg.indexOf('publish'), -1, '取材板段不得发布');
    assert.equal(seg.indexOf('storage'), -1, '取材板段不得碰存储');
});
test('C11 本版三条「不做」在代码上可判', () => {
    const k = stripAll(kernelSrc);
    const w = stripAll(wireSrc);
    /* ① 不自动编造未发生事件：读数里 devisesNothing 恒真，且无生成面。 */
    assert.equal(K.readMaterialPack(WIN_OK, { task: 'meet' }).devisesNothing, true);
    for (const src of [k, w]) {
        /* ★ 判 `generate(` 调用形态而不是裸词 `generate`：`cancel()` 返回的
         *   `generated: false` 正是「取消不触发生成」的读数本身，拿裸词判会把它读成违规。 */
        assert.equal(src.indexOf('generate('), -1, '不许有生成调用');
        assert.equal(src.indexOf('createNovel'), -1, '不许新建文稿');
    }
    /* 取消读数里必须**如实报**没生成（不靠注释承诺）。 */
    assert.equal(new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK }).cancel().generated, false);
    /* ② 不替用户推进时间：内核不读时钟、不写楼层。 */
    assert.equal(k.indexOf('Date.now('), -1, '内核不许读时钟');
    assert.equal(k.indexOf('advanceTime'), -1);
    /* ③ 不新建导演代理或注入框架：内核不注册定时器 / 监听。 */
    assert.equal(k.indexOf('setInterval('), -1);
    assert.equal(k.indexOf('addEventListener('), -1);
    /* 零写面写成读数（不靠注释承诺）。 */
    assert.equal(K.readMaterialPackPick(WIN_OK, { task: 'meet' }).writesNothing, true);
    assert.equal(K.readMaterialPackSheet(WIN_OK, { task: 'meet' }).writesNothing, true);
    assert.equal(K.readMaterialPackHeld(WIN_OK, { task: 'meet' }).writesNothing, true);
});
/* ══════════ D ── 负控制 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4300_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps', 'creationdesk'), path.join(dir, 'apps', 'creationdesk'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});
/** 定点破坏真源码副本：锚点必须恰中 1 次（失配即 abort，防「破坏没发生也算红」）。 */
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
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真', () => {
    assert.equal(K.readMaterialPack(WIN_NONE, { task: 'meet' }).state, S.ENGINE_ABSENT, '原版：未装 ⇒ engine-absent');
    assert.equal(K.readMaterialPack(WIN_EMPTY, { task: 'meet' }).state, S.EMPTY, '原版：池空 ⇒ empty');
    assert.equal(K.readMaterialPack(WIN_ALL_HELD, { task: 'meet' }).state, S.OK, '原版：池有而包空 ⇒ 仍是 ok');
    const p = K.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'm3'], asOf: 5 });
    assert.equal(p.afterAsOf.length, 1, '原版：时点之后进 afterAsOf');
    assert.equal(p.count, 1, '原版：时点内的能交');
    const wire = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    wire.setTask('meet');
    assert.equal(wire.task, 'meet');
    wire.setTask('');
    assert.equal(wire.task, '', '原版：空值即清空');
    wire.setTask('meet');
    wire.resetScene();
    assert.equal(wire.task, '', '原版：换会话作废');
    assert.equal(wire.cancel().generated, false, '原版：取消不触发生成');
});
test('D1 ★★★ 破坏「池有而包空仍是 ok」⇒ B2 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!norm.poolHasMaterial) return faceOf(MB_STATES.EMPTY, 'empty', extra);",
        "    if (!norm.pack.length) return faceOf(MB_STATES.EMPTY, 'empty', extra);");
    const M = await loadKernel(dir, 'd1');
    const r = M.readMaterialPack(WIN_ALL_HELD, { task: 'meet' });
    assert.equal(r.state, S.EMPTY, '破坏副本：池有而包空被读成了 empty');
    assert.equal(K.readMaterialPack(WIN_ALL_HELD, { task: 'meet' }).state, S.OK, '原版必须报 ok');
});
test('D2 ★★★ 破坏「时点之后不许提前进入」⇒ B5 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        if (asOf !== null && m.floor !== null && m.floor > asOf) {",
        "        if (false) {");
    const M = await loadKernel(dir, 'd2');
    const p = M.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'm3'], asOf: 5 });
    assert.equal(p.afterAsOf.length, 0, '破坏副本：时点之后的事实被放进了能交的清单');
    assert.ok(p.ids.indexOf('m3') >= 0, '破坏副本：m3 应已混进能交清单');
    assert.equal(K.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'm3'], asOf: 5 }).afterAsOf.length, 1, '原版必须报时点之后');
});
test('D3 ★★★ 破坏「勾了但不在包里的进 notInPack」⇒ B5 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "            notInPack.push({ id: id.slice(0, 120), why: 'not-in-pack' });",
        "            continue;");
    const M = await loadKernel(dir, 'd3');
    const p = M.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'mZ'], asOf: null });
    assert.equal(p.notInPack.length, 0, '破坏副本：不在包里的被静默丢掉了');
    assert.equal(K.readMaterialPackPick(WIN_OK, { task: 'meet', picked: ['m1', 'mZ'], asOf: null }).notInPack.length, 1, '原版必须如实报无从取');
});
test('D4 ★★★ 破坏「两条闸分别计数」⇒ B3 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        future: arr(h.future).map((x) => normHeldRow(x, 'future')).filter(Boolean).slice(0, MB_LIMITS.held),",
        "        future: [],");
    const M = await loadKernel(dir, 'd4');
    const h = M.readMaterialPackHeld(WIN_ALL_HELD, { task: 'meet' });
    assert.equal(h.futureCount, 0, '破坏副本：未发生那一格被压掉了');
    assert.equal(K.readMaterialPackHeld(WIN_ALL_HELD, { task: 'meet' }).futureCount, 1, '原版必须报未发生 1 条');
});
test('D5 ★★★ 破坏「入参畸形与池空不同形」⇒ B6 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (g.judged === false) {",
        "    if (false) {");
    const M = await loadKernel(dir, 'd5');
    const bad = M.readMaterialPack(WIN_MALFORMED, { task: 'meet' });
    assert.notEqual(bad.reason, 'malformed', '破坏副本：判不了被读成了别的态');
    assert.equal(K.readMaterialPack(WIN_MALFORMED, { task: 'meet' }).reason, 'malformed', '原版必须报 malformed');
});
test('D6 ★★★ 破坏「未装插件不报成没有材料」⇒ B1 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        return faceOf(MB_STATES.ENGINE_ABSENT, 'engine-absent', {",
        "        return faceOf(MB_STATES.EMPTY, 'empty', {");
    const M = await loadKernel(dir, 'd6');
    const r = M.readMaterialPack(WIN_NONE, { task: 'meet' });
    assert.equal(r.state, S.EMPTY, '破坏副本：没装插件被读成了「没有材料」');
    assert.equal(K.readMaterialPack(WIN_NONE, { task: 'meet' }).state, S.ENGINE_ABSENT, '原版必须报 engine-absent');
});
test('D7 ★★★ 破坏接线件「空值即清空」⇒ C3 同款判据必转红', async () => {
    const dir = breakCopy(WIRE_REL,
        "        this._task = (MB_TASKS.indexOf(s) >= 0) ? s : '';",
        "        this._task = (MB_TASKS.indexOf(s) >= 0) ? s : 'advance';");
    const W = await import(pathToFileURL(path.join(dir, WIRE_REL)).href + '?d7=' + Date.now());
    const wire = new W.CreationdeskBoard({ _hostWin: () => WIN_OK });
    wire.setTask('');
    assert.equal(wire.task, 'advance', '破坏副本：空值回落成了「推进」');
    const orig = new WIRE.CreationdeskBoard({ _hostWin: () => WIN_OK });
    orig.setTask('');
    assert.equal(orig.task, '', '原版必须清空');
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
    /* ★ 同 v4260 / v4270 / v4280 / v4290 的修法：这几条断的是「**v4.30.0 这一版**记全了」，
     *   故锁自己那一版的字面量，不跟随 `pkg.version` ——
     *   否则本套件会在抬到下一版时因「新版公告里没有本版件名」而转红。 */
    const own = log.versions['4.30.0'];
    assert.ok(own, 'v4.30.0 条目必须在账上');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('material-board-contract.js') >= 0, 'v4.30.0 公告必须记内核件');
    assert.ok(all.indexOf('creationdesk-board.js') >= 0, 'v4.30.0 公告必须记接线件');
    assert.ok(all.indexOf('运行时验证边界') >= 0);
    assert.ok(all.indexOf('R4-X9') >= 0, 'v4.30.0 公告必须记计划项 id');
    for (const rel of [KERNEL_REL, WIRE_REL]) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), 'v4.30.0 公告记的件必须在仓里：' + rel);
    }
});
test('E2 三处同批逐字一致（上游表行 / 本仓登记行 / 本门标签）', () => {
    const gate = read(GATE_REL);
    const reg = read(REGISTRY_REL);
    /* ① 本门标签：面 id / 读出口 / 下限三格。 */
    assert.ok(gate.indexOf('[face: materialPack] [reader: readMaterialPack] [floor: 1]') >= 0, '本门必须有 J22 标签');
    /* ② 本仓登记行：declaredConsumer / declaredFloor / upstreamFace 逐字对齐。 */
    assert.ok(reg.indexOf("id: 'lonsha.materialPack'") >= 0, '登记行必须在场');
    assert.ok(reg.indexOf("upstreamFace: 'materialPack'") >= 0);
    assert.ok(reg.indexOf("declaredConsumer: 'readMaterialPack'") >= 0);
    assert.ok(reg.indexOf("declaredFloor: 1") >= 0);
    assert.ok(reg.indexOf("since: '3.346.0'") >= 0, 'since 必须指上游 producer_version 那一版');
    /* ③ 登记行的消费点文件必须真存在且真含 token（登记表不得与真源脱节）。 */
    assert.ok(fs.existsSync(path.join(ROOT, 'apps/creationdesk/creationdesk-board.js')), '消费点文件必须在仓里');
    assert.ok(countOf(wireSrc, 'readMaterialPack(') >= 1, '消费点文件必须真含消费 token');
    /* ④ 冻读取里的表行必须已含这一面（否则 R3 会报「登记了不存在的面」）。 */
    const cache = JSON.parse(read('tests/audit/upstream_face_cache.json'));
    assert.ok(cache.faces && cache.faces.materialPack, '冻读取必须已含 materialPack 面');
    assert.equal(cache.faces.materialPack.consumer, 'readMaterialPack@1', '冻读取的 consumer 列必须与标签逐字一致');
});