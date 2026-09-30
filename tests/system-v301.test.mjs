/**
 * tests/system-v301.test.mjs — 业务面消费投影 + 探针自述面收口 [v3.0.1]
 *
 * 【这一版治的欠债（v3.0.0 的遗留观察项，逐字写在 TODO.md 的 L-F5 条目里）】
 *   ① 「投影目前只接进**诊断面**；业务 App（place / chars / plotline / clock）仍各自经
 *      `faceFieldState` 读旧面，**尚未**改为直接消费投影 —— 这是有意的（先有可信读数出口、
 *      再逐 App 迁移），迁移时须补一条『投影真被业务面消费』的判据，否则又是一次
 *      『抽出来没人用』」；
 *   ② 「`readPushProbe` 的 `sourceState` / `lastError` **仍无消费点**（v2.97.0 起挂账至今），
 *      归因面子集与投影面有重叠，迁移时应一并收口而不是再开一条通路」。
 *
 * 【为什么迁移的形态是「补归属面」而不是「换数据源」（本版最重要的设计结论）】
 *   上游投影只外供 **6 项窄面**（`peopleLocations` / `factKeys` / `characterNames` /
 *   `clockDay` / `promiseKeys` / `knowledgeOwners`），而四个业务面要的是**整面**
 *   （场所树 / 角色字段表 / 大纲与六账本 / 时计全量）。
 *   若把整面硬塞进投影，等于把「跨仓稳定契约」变成「上游内部结构的镜像」：上游每改一个
 *   内部字段都得抬 `projectionApiVersion`，而这恰恰违背投影契约的设计初衷（结构版只在
 *   字段增删时抬）。故本版口径是：
 *     · **数据面照旧**读只读快照（`faceFieldState` 那条路不动，三态归因不动）；
 *     · **投影面补一面**，回答「这份读数是**谁的** / **哪一代** / **什么时候** / **能不能用**」
 *       —— 即 `projectionScopeLine()`。
 *   这一条决定了本版是**新增出口**，不是改造 `projectionValue()`。
 *
 * 【覆盖】
 *   A 结构面：新出口在场 + 四个业务 App 真消费投影 + 四个视图真渲染来源读数
 *             + 探针自述面收口 + 两条新判据落进第九道门（J8/J9）
 *   B 行为面：来源读数带出同源身份/修订/时效/权限；取不到如实 null 且与「真的 0」分开；
 *             非就绪态如实报归因；无宿主下四 App 不抛且结构恒定；有宿主时来源面与数据面同源
 *   C 负控制：**全量镜像 → 真门禁**（业务面停消费 ⇒ J8 红；自述面停消费 ⇒ J9 红；
 *             新增零消费导出 ⇒ dead-exports 红）+ 破坏后副本重跑同款真判据
 *   D 版本与文档面：五源同源（≥ 3.0.1）+ 弹窗逐字同源 + 迭代日志与 TODO 不说谎
 *
 * 【负控制的假绿史（本仓踩过三次，本套件一律照 v299 G0 的形态防）】
 *   ① 对原文件断言；② 破坏写死成模拟常量；③ 破坏把判据自己删了。
 *   故：判据写成纯函数 `j*(mod)` 正负两跑；门禁走**全量镜像树**（排除 .git）并在
 *   未破坏时先自证全绿（C0）；破坏点用 `mutateOnce` 断言锚点**恰中 1 次**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const PC = 'config/projection-contract.js';
const DG_DATA = 'apps/diagnose/diagnose-data.js';
const GATE = 'scripts/bridge-contract-audit.mjs';
const IDX = 'index.js';

/** 四个业务面：控制器 + 视图 + 应用名 + 视图来源卡类名（渲染断言用） */
const BIZ = [
    { app: 'apps/place/place-app.js', view: 'apps/place/place-view.js', name: '地点图景', cls: 'pl-src' },
    { app: 'apps/chars/chars-app.js', view: 'apps/chars/chars-view.js', name: '群像', cls: 'cs-src' },
    { app: 'apps/plotline/plotline-app.js', view: 'apps/plotline/plotline-view.js', name: '剧情线', cls: 'pn-src' },
    { app: 'apps/clock/clock-app.js', view: 'apps/clock/clock-view.js', name: '时计', cls: 'cl-src' }
];

const PC_MOD = await import(at(PC));
const DG_MOD = await import(at(DG_DATA));
const { PlaceApp } = await import(at(BIZ[0].app));
const { CharsApp } = await import(at(BIZ[1].app));
const { PlotlineApp } = await import(at(BIZ[2].app));
const { ClockApp } = await import(at(BIZ[3].app));
const APPS = [PlaceApp, CharsApp, PlotlineApp, ClockApp];
const VIEW_MODS = [];
for (const b of BIZ.slice(0, 3)) VIEW_MODS.push(await import(at(b.view)));

const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
const CURRENT = '3.0.1';

/** 去注释（判「真消费」须在去注释源码上判；本仓注释里大量逐字提到旧写法） */
function codeOf(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

/* ============================================================
 * 夹具
 * ============================================================ */
function env(over) {
    const base = {
        projectionApiVersion: 1,
        projectionVersion: 6,
        generatedAt: 1000,
        conversationId: 'chat-1',
        sceneId: '老城›钟楼›顶层',
        worldId: 'world-ledger',
        items: { peopleLocations: { 阿澈: '老城›钟楼' } },
        visibility: { peopleLocations: 'given' },
        sourceLedger: {
            available: true, bound: true, reason: 'ok', absent: [],
            summary: { total: 6, ok: 5, empty: 0, absent: 1, skipped: 0 }
        },
        revision: 7,
        expiresAt: 1000 + 60000
    };
    return Object.assign({}, base, over || {});
}
function snap(face) {
    const s = { meta: { fieldTypes: { projection: { present: true, kind: 'object' } } } };
    /* 数据面夹具（[v3.0.1] B5 用）：**必须**给一份最小可用的场所面。
     *   修前这一版没给 `scene`，于是 place 的三态归因走到 `no-scene-face`，
     *   B5 断言的 `face.reason === 'ready'` 测的就不是「数据面照旧读快照」，
     *   而是「夹具不全」——这类夹具缺陷会让断言失败被误读成产品回归。
     *   注：chars / plotline 的归因面各读自己的字段，本项对它们无副作用。 */
    s.scene = { currentLine: '老城›钟楼›顶层', scale: { nodes: 3 }, coverage: { state: 'ok' } };
    if (face !== undefined) s.projection = face;
    return s;
}
/** 宿主 window：lonsha 推送型桥 + 完整快照（业务面真功能测试用） */
function hostWin(face, snapOver) {
    const snapshot = Object.assign(snap(face), snapOver || {});
    return { lonsha_memory_bridge_v1: { snapshot } };
}
function withHost(win, fn) {
    const g = globalThis;
    const saved = g.lonsha_memory_bridge_v1;
    if (win) g.lonsha_memory_bridge_v1 = win.lonsha_memory_bridge_v1;
    else delete g.lonsha_memory_bridge_v1;
    try { return fn(); } finally {
        if (saved === undefined) delete g.lonsha_memory_bridge_v1;
        else g.lonsha_memory_bridge_v1 = saved;
    }
}
const NEW_APP = (Cls) => new Cls({ screen: null }, { get: () => null, set: () => {} });

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v301 A1. projectionScopeLine 出口在场，且结构恒定（缺字段一律给空形）', () => {
    assert.equal(typeof PC_MOD.projectionScopeLine, 'function', '缺 projectionScopeLine 出口（本版新增面）');
    const shape = (o) => Object.keys(o).sort().join(',');
    const base = shape(PC_MOD.projectionScopeLine(PC_MOD.readProjection({}, { snapshot: null })));
    const cases = [
        PC_MOD.projectionScopeLine(null),
        PC_MOD.projectionScopeLine(undefined),
        PC_MOD.projectionScopeLine({}),
        PC_MOD.projectionScopeLine(PC_MOD.readProjection({}, { snapshot: snap(env({ projectionApiVersion: 9 })) })),
        PC_MOD.projectionScopeLine(PC_MOD.readProjection({}, { snapshot: snap(env()) }))
    ];
    for (const c of cases) {
        assert.equal(shape(c), base, '结构漂移（消费方要判 undefined 了）');
        assert.equal(typeof c.usable, 'boolean', 'usable 必须是布尔（视图按它决定是否显示身份行）');
        assert.ok(typeof c.line === 'string' && c.line.length > 0, '每态都必须有一行可读文案');
    }
    assert.ok(PC_MOD.default && typeof PC_MOD.default.projectionScopeLine === 'function',
        'default 面须带上新出口（本仓模块一贯形制）');
});

test('v301 A2. 四个业务 App 真消费投影（readProjection 出口 + sourceFace 归属面）', () => {
    for (const b of BIZ) {
        const code = codeOf(read(b.app));
        assert.ok(code.includes('projection-contract.js'), b.app + ' 未接入投影契约真源（投影又被抽成摆设）');
        assert.ok(code.includes('readProjection('), b.app + ' 未真调 readProjection');
        assert.ok(code.includes('sourceFace('), b.app + ' 未提供 sourceFace() 归属面（视图无从渲染来源）');
    }
});

test('v301 A3. 四个业务视图真渲染来源读数（三个可真渲染 + 时计按源码面）', () => {
    withHost(hostWin(env()), () => {
        for (let i = 0; i < 3; i++) {
            const inst = NEW_APP(APPS[i]);
            const container = { innerHTML: '' };
            inst.view.render(container);
            const html = String(container.innerHTML || '');
            assert.ok(html.includes(BIZ[i].cls), BIZ[i].view + ' 未渲染来源卡（类 ' + BIZ[i].cls + ' 缺席）');
            assert.ok(html.includes('chat-1'), BIZ[i].view + ' 来源卡未带出同源身份（会话号缺席）');
        }
    });
    const cv = codeOf(read(BIZ[3].view));
    assert.ok(cv.includes(BIZ[3].cls), BIZ[3].view + ' 未渲染来源卡（类 ' + BIZ[3].cls + ' 缺席）');
    assert.ok(cv.includes('sourceFace('), BIZ[3].view + ' 未从控制器取归属面（视图自己重取 = 两次读数）');
});

test('v301 A4. 探针自述面收口：readPushProbe 的 sourceState/lastError 有了消费点（不再挂账）', () => {
    const dg = codeOf(read(DG_DATA));
    for (const tok of ['probe.sourceState', 'probe.lastError', 'probeSelf']) {
        assert.ok(dg.includes(tok), DG_DATA + ' 缺 ' + tok + '（探针自述面仍无消费点）');
    }
    /* 形状判据不许写成单行对象字面量：本仓的收口面一律是**逐行键值**的块，
     * 写成 `{ id, mounted, ... }` 短形会永远红（本轮已踩过一次）。改判「块在场 + 五个键齐」。 */
    const block = /const probeSelf = \{[\s\S]*?\};/.exec(dg);
    assert.ok(block, 'probeSelf 须落成一个结构化面（const probeSelf = { … };）');
    for (const k of ['id', 'mounted', 'reason', 'sourceState', 'lastError']) {
        assert.ok(new RegExp('\\b' + k + '\\s*:').test(block[0]), 'probeSelf 面缺字段 ' + k + '（散着塞不算收口）');
    }
});

test('v301 A5. 两条新判据落进同一道门（不新开一道），且真仓库上门禁全绿并给出 J8/J9 读数', () => {
    const src = read(GATE);
    assert.match(src, /J8/, '缺 J8 判据（业务面真消费投影）');
    assert.match(src, /J9/, '缺 J9 判据（探针自述面真被消费）');
    assert.match(src, /PROJECTION_READER_MIN_CONSUMERS/, '缺 J8 消费点下限常量');
    assert.match(src, /readProjection/, 'J8 未扫 readProjection');
    assert.match(src, /sourceState/, 'J9 未扫 sourceState');
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts.check, /bridge-contract/, '新判据必须随第九道门进 check 链');
    const out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8' });
    const m8 = /readProjection 消费点 (\d+) 个/.exec(out);
    assert.ok(m8, '门禁未输出 J8 消费点计数：' + out.slice(-400));
    assert.ok(Number(m8[1]) >= 4, 'readProjection 消费点只有 ' + m8[1] + ' 个（业务面没真接上）');
    assert.match(out, /sourceState\/lastError 消费点 [1-9]/, 'J9 未给出「消费点 ≥1」的结论：' + out.slice(-400));
});

/* ============================================================
 * B. 行为面
 * ============================================================ */
/** J-A：就绪态带出同源身份 / 修订 / 时间 / 权限（「谁的、哪一代、什么时候、能不能用」） */
function jScopeCarriesProvenance(mod) {
    const pj = mod.readProjection({}, { snapshot: snap(env()), now: 2000 });
    const sc = mod.projectionScopeLine(pj);
    if (sc.usable !== true) return { ok: false, why: '就绪态被判不可用：' + sc.reason };
    if (sc.identity.conversationId !== 'chat-1') return { ok: false, why: '未带出会话号：' + sc.identity.conversationId };
    if (sc.identity.sceneId !== '老城›钟楼›顶层') return { ok: false, why: '未带出场景：' + sc.identity.sceneId };
    if (sc.identity.worldId !== 'world-ledger') return { ok: false, why: '未带出世界：' + sc.identity.worldId };
    if (sc.revision !== 7) return { ok: false, why: '未带出修订：' + sc.revision };
    if (sc.generatedAt !== 1000) return { ok: false, why: '未带出生成时刻：' + sc.generatedAt };
    if (sc.expiresAt !== 61000) return { ok: false, why: '未带出有效期：' + sc.expiresAt };
    if (sc.stale !== false) return { ok: false, why: '未过期被报成 ' + sc.stale };
    if (sc.scopeBound !== true) return { ok: false, why: '未带出权限绑定：' + sc.scopeBound };
    for (const kw of ['chat-1', '修订']) {
        if (!sc.line.includes(kw)) return { ok: false, why: '一行文案里缺 ' + kw + '：' + sc.line };
    }
    return { ok: true, why: '' };
}

/** J-B：「没给」与「给了 0」必须分形（v300 C2 的同款纪律，不许在归属面上塌掉） */
function jScopeKeepsNullDistinct(mod) {
    const bare = env({ conversationId: null, sceneId: null, worldId: null, revision: null, expiresAt: null });
    const sc = mod.projectionScopeLine(mod.readProjection({}, { snapshot: snap(bare) }));
    if (sc.usable !== true) return { ok: false, why: '夹具本身应可用，实得 ' + sc.reason };
    if (sc.identity.conversationId !== null) return { ok: false, why: '取不到的会话号被冒充：' + sc.identity.conversationId };
    if (sc.revision !== null) return { ok: false, why: 'revision 非数却硬编：' + sc.revision };
    if (sc.expiresAt !== null) return { ok: false, why: '没给有效期却硬编：' + sc.expiresAt };
    if (sc.stale !== null) return { ok: false, why: '没给有效期却被算成 ' + sc.stale + '（0 会被算成 1970 已过期）' };
    const real = mod.projectionScopeLine(mod.readProjection({}, { snapshot: snap(env({ revision: 0, expiresAt: 0 })), now: 0 }));
    if (real.revision !== 0) return { ok: false, why: '真的 0 被吞成 ' + real.revision };
    if (real.stale !== false) return { ok: false, why: 'now === expiresAt 应算未过期，实得 ' + real.stale };
    return { ok: true, why: '' };
}

/** J-C：非就绪态**如实报归因**，不硬编来源（不许把「读不懂」渲染成「有一份读数」） */
function jScopeHonestWhenUnusable(mod) {
    const cases = [
        [mod.readProjection({}, { snapshot: null }), 'bridge-absent'],
        [mod.readProjection({}, { snapshot: snap(env({ projectionApiVersion: 9 })) }), 'contract-ahead'],
        [mod.readProjection({}, { snapshot: snap(env({ sourceLedger: { available: false, bound: false, reason: 'pipeline-absent', absent: [], summary: null } })) }), 'pipeline-absent']
    ];
    for (const [pj, want] of cases) {
        if (pj.reason !== want) return { ok: false, why: '夹具未走到 ' + want + '（实得 ' + pj.reason + '）' };
        const sc = mod.projectionScopeLine(pj);
        if (sc.usable !== false) return { ok: false, why: want + ' 被报成可用（等于给了一份不存在的读数）' };
        if (sc.line !== pj.text) return { ok: false, why: want + ' 的文案没原样透传：' + sc.line };
        if (sc.identity.conversationId !== null || sc.revision !== null || sc.scopeBound !== null) {
            return { ok: false, why: want + ' 却带出了身份/修订/权限（硬编来源）' };
        }
    }
    return { ok: true, why: '' };
}

function callScopeOf(inst) {
    const sc = inst.sourceFace();
    if (!sc || typeof sc !== 'object') return { ok: false, why: 'sourceFace() 未返回对象' };
    for (const k of ['usable', 'line', 'reason', 'identity', 'revision', 'generatedAt', 'expiresAt', 'stale', 'scopeBound']) {
        if (!Object.prototype.hasOwnProperty.call(sc, k)) return { ok: false, why: '缺字段 ' + k };
    }
    return { ok: true, why: '' };
}

test('v301 B1. 就绪态：来源读数带出身份/修订/时间/权限（J-A）', () => {
    const r = jScopeCarriesProvenance(PC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v301 B2. 「没给」与「给了 0」分形：取不到如实 null，真的 0 如实保留（J-B）', () => {
    const r = jScopeKeepsNullDistinct(PC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v301 B3. 非就绪态：一律如实报归因、不硬编来源（J-C）', () => {
    const r = jScopeHonestWhenUnusable(PC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v301 B4. 无宿主下四个业务 App 不抛，且归属面结构恒定', () => {
    withHost(null, () => {
        for (let i = 0; i < APPS.length; i++) {
            const inst = NEW_APP(APPS[i]);
            const r = callScopeOf(inst);
            assert.equal(r.ok, true, BIZ[i].app + '：' + r.why);
            const sc = inst.sourceFace();
            assert.equal(sc.usable, false, BIZ[i].app + ' 无宿主时来源面应不可用，实得 ' + sc.usable);
            assert.ok(sc.line.length > 0, BIZ[i].app + ' 非就绪态必须仍有一行可读文案');
            assert.equal(sc.identity.conversationId, null);
        }
    });
});

test('v301 B5. 有宿主时：归属面与数据面来自**同一次**读数（同一份快照的会话号）', () => {
    withHost(hostWin(env()), () => {
        const place = NEW_APP(PlaceApp);
        const pkg = place.projection();
        assert.ok(pkg.src, 'projection() 未带上归属面（视图只能自己去重取 = 两次读数）');
        assert.equal(pkg.src.usable, true, '有宿主却不可用：' + pkg.src.reason);
        assert.equal(pkg.src.identity.conversationId, 'chat-1');
        assert.equal(pkg.face.reason, 'ready', '数据面仍须照旧读快照（迁移不换数据源）：' + pkg.face.reason);
        for (const Cls of [CharsApp, PlotlineApp]) {
            const inst = NEW_APP(Cls);
            const p = inst.projection();
            assert.ok(p.src && p.src.identity.conversationId === 'chat-1', Cls.name + ' 的归属面与数据面不同源');
        }
        const clock = NEW_APP(ClockApp);
        clock.probeBridge();
        assert.equal(clock.sourceFace().identity.conversationId, 'chat-1', '时计归属面未同源');
    });
});

/* ============================================================
 * C. 负控制（全量镜像 → 真门禁）
 * ============================================================ */
const GATES = [GATE, 'scripts/dead-export-check.mjs'];
const ORIG = new Map();
for (const g of GATES) ORIG.set(g, read(g));

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v301-mir-'));
    copyTreeSafe(ROOT, dir, { filter: (src) => !src.split(path.sep).includes('.git') });
    for (const [rel, fn] of Object.entries(mut)) {
        const body = fn(read(rel));
        assert.notEqual(body, read(rel), '破坏未发生（锚点没命中）：' + rel);
        fs.writeFileSync(path.join(dir, rel), body);
    }
    for (const [g, src] of ORIG) {
        if (Object.prototype.hasOwnProperty.call(mut, g)) continue;
        fs.writeFileSync(path.join(dir, g), src);
    }
    return dir;
}
function runGate(dir, rel) {
    try {
        const out = execFileSync('node', [rel], { cwd: dir, encoding: 'utf8' });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}
function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const loadMirror = (dir, rel) => import(pathToFileURL(path.join(dir, rel)).href + '?m=' + Date.now());

test('v301 C0. 镜像树自证：未破坏时两道门全绿（否则 C 组是假绿）', () => {
    withMirror({}, (dir) => {
        for (const g of GATES) {
            const r = runGate(dir, g);
            assert.equal(r.ok, true, '未破坏的镜像树上 ' + g + ' 必须通过：' + r.out.slice(0, 400));
        }
    });
});

test('v301 C1. 负控制：业务面不再消费投影 ⇒ J8 红灯并点名', () => {
    const mut = {};
    for (const b of BIZ) mut[b.app] = (s) => s.split('readProjection(').join('_disabledProjection(');
    withMirror(mut, (dir) => {
        const r = runGate(dir, GATE);
        assert.equal(r.ok, false, '业务面停消费投影，J8 却没红灯');
        assert.ok(r.out.includes('J8'), '红灯须指向 J8：' + r.out.slice(0, 400));
        assert.ok(/readProjection 只有 \d+ 个/.test(r.out), '红灯须给出真实读数：' + r.out.slice(0, 400));
    });
});

test('v301 C2. 负控制：探针自述面不再被消费 ⇒ J9 红灯并点名 sourceState', () => {
    /* 破坏面必须让**读取点归零**：只把 `? probe.sourceState : null` 改成 `? null : null`
     * 是不会红的 —— 门禁数的是 `probe.(sourceState|lastError)` 的**出现次数**，
     * 值分支怎么写它都还是一次读。这正是「假绿第②形」（破坏写死成模拟常量）的变体：
     * 看着像破坏，判据根本没被触到。故这里直接把两个字段的取数一并摘掉。 */
    withMirror({
        [DG_DATA]: (s) => mutateOnce(
            s,
            "        sourceState: (typeof probe.sourceState === 'string') ? probe.sourceState : null,\n" +
            "        lastError: probe.lastError ? String(probe.lastError) : null",
            '        sourceState: null,\n        lastError: null')
    }, (dir) => {
        const r = runGate(dir, GATE);
        assert.equal(r.ok, false, '自述面停消费，J9 却没红灯');
        assert.ok(r.out.includes('J9'), '红灯须指向 J9：' + r.out.slice(0, 400));
        assert.ok(r.out.includes('sourceState'), '红灯须点名该自述字段：' + r.out.slice(0, 400));
    });
});

test('v301 C3. 负控制：新增一个零消费导出 ⇒ dead-exports 红灯并点名', () => {
    withMirror({
        [PC]: (s) => mutateOnce(s, 'export function projectionScopeLine(', 'export function __v301Probe(x) { return x; }\nexport function projectionScopeLine(')
    }, (dir) => {
        const r = runGate(dir, 'scripts/dead-export-check.mjs');
        assert.equal(r.ok, false, '零消费导出必须红灯');
        assert.ok(r.out.includes('__v301Probe'), '红灯须点名该导出：' + r.out.slice(-400));
    });
});

test('v301 C4. 负控制：归属面摘掉身份带出 ⇒ 同款真判据在副本上转红（真源码破坏→副本重跑）', async () => {
    assert.equal(jScopeCarriesProvenance(PC_MOD).ok, true, '原版上 J-A 必须为真（阳性对照）');
    await withMirror({
        [PC]: (s) => mutateOnce(
            s,
            "conversationId: (raw.conversationId === undefined) ? null : raw.conversationId,",
            'conversationId: null,')
    }, async (dir) => {
        const pc = await loadMirror(dir, PC);
        const r = jScopeCarriesProvenance(pc);
        assert.equal(r.ok, false, '身份被摘掉，J-A 却没转红');
        assert.ok(/会话号/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

/* ============================================================
 * D. 版本与文档面
 * ============================================================ */
test('v301 D1. 五源同源且不低于 3.0.1（补丁位：本版是迁移，不动结构版）', () => {
    const log = JSON.parse(read('update-log.json'));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read(IDX).match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, man.version, 'update-log.latest 与 manifest 同源');
    assert.equal(man.version, pkg.version, 'package 与 manifest 同源');
    assert.equal(pkg.version, m[1], '入口常量与 manifest 同源');
    assert.equal(Object.keys(log.versions)[0], log.latest, 'versions 首键即当前版本');
    assert.ok(vnum(log.latest) >= vnum(CURRENT), '不低于 ' + CURRENT + '，实得 ' + log.latest);
    const a = String(log.latest).split('.').map((n) => Number.parseInt(n, 10) || 0);
    /* [v3.1.0] 交棒：原判据钉死「次版本恰为 0」（本套件出生时是 3.0 线）。
     *   同 v300-D1 的处境：那是当版精确判定，不能当永久约束。改为「主版本不动」。 */
    assert.equal(a[0] === 3, true, '本仓仍在 3.x 线：实得 ' + log.latest);
    assert.equal(PC_MOD.SUPPORTED_API_VERSION, 1, '本版不动结构版（迁移不换数据源）');
});

test('v301 D2. 变更说明与实现同域（提投影/业务/探针/判据）+ 弹窗逐字同源', () => {
    const log = JSON.parse(read('update-log.json'));
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
    assert.equal(entry.version, log.latest);
    /* [v3.0.2] 同 v300 D2 / v298 E2 的口径：落地项关键词锚**本套件出生版本**，
     *   不锚 `log.latest`（否则每次抬版都要回来改历史测试，而它钉的其实是历史事实）。 */
    const own = log.versions['3.0.1'];
    assert.ok(own && Array.isArray(own.items), 'v3.0.1 条目必须仍在（本判据钉的是历史事实）');
    const all = own.items.join('\n');
    for (const kw of ['投影', '业务', '探针', '判据']) {
        assert.ok(all.includes(kw), '变更说明未提到本版落地项：' + kw);
    }
    assert.ok(all.includes(own.version), 'release note 须出现本版版本号');
    assert.ok(/版本升至/.test(all), '须保留「版本升至 X」的收尾条（仓内一贯格式）');
    const blk = read(IDX).match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(blk, 'ST_PHONE_CURRENT_UPDATE 可提取');
    for (const item of entry.items) {
        assert.ok(blk[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 24) + '…');
    }
    assert.match(blk[0], new RegExp('date: "' + entry.date + '"'), 'date 同源');
});

test('v301 D3. 文档面不说谎：迭代日志指向本版，且 TODO 不再把这两条写成待办', () => {
    const iter = read('ITERATION_LOG.md');
    const man = JSON.parse(read('manifest.json'));
    const m = /- \*\*当前版本\*\*：`([0-9.]+)`/.exec(iter);
    assert.ok(m, '元信息须有「当前版本」一行');
    assert.equal(m[1], man.version, '迭代日志元信息与 manifest 不一致（文档已腐坏）');
    assert.ok(iter.includes('迭代 33'), '本版迭代段未登记');
    const todo = read('TODO.md');
    assert.ok(!/仍各自经 `faceFieldState` 读旧面/.test(todo), 'TODO 仍把「业务面未迁投影」写成待办');
    assert.ok(!/仍无消费点/.test(todo), 'TODO 仍把「探针自述面零消费」写成待办');
});
