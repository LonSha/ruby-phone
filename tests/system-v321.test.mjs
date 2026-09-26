/**
 * tests/system-v321.test.mjs — F-2 跨平台事件来源构成（下游消费侧）[v3.5.0]
 *
 * 上游 v3.233.0 把事件段的 `source`（40 字自由文本）折成受控分级
 * （extract / platform / other / none）并外供 `snapshot.eventPlatforms`。
 * 下游这一轮的活儿是**把它读出来并真消费**（本仓第十次「建好不消费」的防治），
 * 且在读的地方只做一件真源不做的事：把**五六种处境**分开。
 *
 * ★ 本套件头一条判据来自**真跑取证**，不是推演：
 *   `event-completeness.js` 的 `platformFace()` 对空账返回
 *   **`ok:true` + `reason:'no-events'`**（「有面、只是还没有事件段」），
 *   而上游两条兜底分支（`_eventPlatformsFace()` 里模块未挂上 / 读面抛错）返回
 *   **`ok:false` + `reason:'module-unavailable' | 'thrown'`**。
 *   下游初稿一律按 `ok !== true` 归一 ⇒ 会把「上游模块根本没挂上」谎报成
 *   「还没有事件线」——两种处境处置相反（前者等上游修/升级，后者等剧情推进）。
 *
 * 覆盖：
 *   A 真源出口面（恒定键面 / 健壮态可分 / 行文案 / 不抛）
 *   B 收集器（哪两态不建卡 / 三态透传 / 不并入 empty）
 *   C 视图（织光机卡片 / 世界脉动桥卡片，两处都不重判形态）
 *   D 负控制（真源码破坏 → 破坏副本上重跑同款真判据）
 *   E 版本锚
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const WB_SRC = read('config/world-bridge.js');
const TWC_SRC = read('apps/timeweaver/timeweaver-collector.js');
const TWV_SRC = read('apps/timeweaver/timeweaver-view.js');
const WPA_SRC = read('apps/worldpulse/worldpulse-app.js');
const WPV_SRC = read('apps/worldpulse/worldpulse-view.js');

/** 镜像仓：世界桥有相对 import（config/*），搬单文件会断路径 ⇒ 按真仓结构建镜像。 */
const MIRROR = mkdtempSync(path.join(os.tmpdir(), 'v321-mir-'));
(function copyTree(src, dst) {
    for (const e of readdirSync(src, { withFileTypes: true })) {
        if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
        const sp = path.join(src, e.name), dp = path.join(dst, e.name);
        if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copyTree(sp, dp); }
        else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* 跳过读不到的 */ } }
    }
})(ROOT, MIRROR);
const WB = await import(pathToFileURL(path.join(MIRROR, 'config', 'world-bridge.js')).href);
const TWC = await import(pathToFileURL(path.join(MIRROR, 'apps', 'timeweaver', 'timeweaver-collector.js')).href);

const KEYS = ['state', 'reason', 'platforms', 'platformCount', 'topPlatform', 'topSegments',
    'segments', 'countedEvents', 'unlabeled', 'truncated', 'pluginVersion'].sort();

/** 造一份挂上 lonsha 桥的 window（推送型：snapshot 是对象） */
const mkWin = (snap) => ({ lonsha_memory_bridge_v1: { snapshot: snap } });
const faceSnap = (face) => (face === undefined
    ? { pluginVersion: '3.233.0' }
    : { pluginVersion: '3.233.0', eventPlatforms: face });

/** 上游 v3.233.0 真值（探针实测）：空账 = ok:true + no-events */
const EMPTY_FACE = { ok: true, reason: 'no-events', events: [], segments: 0, platforms: [],
    levels: { extract: 0, platform: 0, other: 0, none: 0 }, unlabeled: 0, countedEvents: 0, truncated: false };
/** 上游兜底两态（探针实测）：ok:false */
const UNAVAIL_FACE = { ok: false, reason: 'module-unavailable', events: [], segments: 0, platforms: [],
    levels: { extract: 0, platform: 0, other: 0, none: 0 }, unlabeled: 0, countedEvents: 0, truncated: false };
const THROWN_FACE = Object.assign({}, UNAVAIL_FACE, { reason: 'thrown' });
/** 一个有构成的面：chat 段数比 phone 多 —— 用来验证「不按段数重排」 */
const MIX_FACE = { ok: true, reason: 'ok', events: [], segments: 5, countedEvents: 2, unlabeled: 1, truncated: false,
    levels: { extract: 2, platform: 4, other: 0, none: 1 },
    platforms: [{ platform: 'phone', segments: 1, events: 1 }, { platform: 'chat', segments: 3, events: 2 }] };

/* ══════════ A 真源出口面 ══════════ */
test('v321 A1. ★★★ 五态常量齐名 + 恒定键面（缺席面与有值面逐键相同）', () => {
    assert.deepEqual(Object.keys(WB.default.EVENT_PLATFORM_STATES).sort(),
        ['BRIDGE_ABSENT', 'EMPTY', 'FACE_ABSENT', 'OK', 'UNUSABLE'], '五态齐名');
    assert.match(WB_SRC, /const EVENT_PLATFORM_STATES = Object\.freeze\(/, '状态表冻结（单一真源）');
    const absent = WB.readLonshaEventPlatforms({});
    assert.equal(absent.state, 'bridge-absent');
    assert.deepEqual(Object.keys(absent).sort(), KEYS, '缺席面键面恒定');
    const ok = WB.readLonshaEventPlatforms(mkWin(faceSnap(MIX_FACE)));
    assert.equal(ok.state, 'ok');
    assert.deepEqual(Object.keys(ok).sort(), KEYS, '★ 有值面键面必须与缺席面逐键相同（读者不必再判 undefined）');
});

test('v321 A2. ★★★★ 空账（ok:true+no-events）⇒ empty；上游两条兜底（ok:false）⇒ unusable，两者不得同形', () => {
    const e = WB.readLonshaEventPlatforms(mkWin(faceSnap(EMPTY_FACE)));
    assert.equal(e.state, 'empty', '★ 有面、没有事件段 ⇒ empty（真读数，等剧情推进）');
    assert.equal(e.segments, 0, '空账如实 0 段');
    for (const [face, reason] of [[UNAVAIL_FACE, 'module-unavailable'], [THROWN_FACE, 'thrown']]) {
        const u = WB.readLonshaEventPlatforms(mkWin(faceSnap(face)));
        assert.equal(u.state, 'unusable', '★ 上游兜底 ⇒ unusable（等上游修），不是「还没有事件线」：' + reason);
        assert.equal(u.reason, reason, '归因原样带出（不吞）');
    }
    assert.notEqual(e.state, WB.readLonshaEventPlatforms(mkWin(faceSnap(UNAVAIL_FACE))).state,
        '★★ 两态不得同形：一律按 ok!==true 归一就会把「上游模块没挂上」谎报成「还没有事件线」');
    /* 缺桥 / 缺面 / 畸形面：三者都不是「空读数」 */
    assert.equal(WB.readLonshaEventPlatforms(mkWin({})).state, 'face-absent', '旧版快照没这面');
    for (const bad of ['x', 42, [1, 2], null]) {
        assert.equal(WB.readLonshaEventPlatforms(mkWin({ eventPlatforms: bad })).state, 'face-absent', '畸形面 ⇒ 没这面：' + JSON.stringify(bad));
    }
});

test('v321 A3. ★★★ 五态五行各不相同；平台顺序照上游词表顺序（不按段数重排）', () => {
    const lines = new Set([
        WB.eventPlatformsLine({}),
        WB.eventPlatformsLine(mkWin({})),
        WB.eventPlatformsLine(mkWin(faceSnap(UNAVAIL_FACE))),
        WB.eventPlatformsLine(mkWin(faceSnap(EMPTY_FACE))),
        WB.eventPlatformsLine(mkWin(faceSnap(MIX_FACE)))
    ]);
    assert.equal(lines.size, 5, '★ 五态必须五句不同的话（缺席/没面/读不出/空/有构成，四种处置都不同）');
    const r = WB.readLonshaEventPlatforms(mkWin(faceSnap(MIX_FACE)));
    assert.deepEqual(r.platforms, ['phone', 'chat'], '★ 照上游受控词表顺序（phone 在前），**不按段数重排**');
    assert.equal(r.topPlatform, 'phone', '词表首个 —— 本面不排「最大 / 最重要」（那是一种重要性表达）');
    assert.equal(r.segments, 5, '段数照上游');
    assert.equal(r.unlabeled, 1, '未标来源如实带出（不是错误，是读数）');
    assert.match(WB.eventPlatformsLine(mkWin(faceSnap(MIX_FACE))), /2 个平台（phone · chat）/, '行里列出被标过的标签');
    /* ★ 有段但一个平台标签都没有：不得写成「0 个平台」 */
    const noPlat = { ok: true, reason: 'ok', events: [], segments: 3, countedEvents: 1, unlabeled: 3, truncated: false,
        levels: { extract: 0, platform: 0, other: 0, none: 3 }, platforms: [] };
    const line = WB.eventPlatformsLine(mkWin(faceSnap(noPlat)));
    assert.equal(/0 个平台/.test(line), false, '★ 不得写「0 个平台」（那句话读者会当成「确实没有」）');
    assert.match(line, /无平台标签/, '要说「无平台标签」');
    assert.equal(WB.readLonshaEventPlatforms(mkWin(faceSnap(noPlat))).state, 'ok',
        '有段而零标签仍是 ok（「等级 none 占比高」≠「没有构成面」）');
    assert.equal(WB.readLonshaEventPlatforms(mkWin(faceSnap(Object.assign({}, MIX_FACE, { truncated: true })))).truncated, true,
        '截断如实带出（读者才知道看到的是不全的）');
});

test('v321 A4. ★★ 绝不外抛；读数里不得混入判断字段（与上游同口径）', () => {
    let threw = false;
    try {
        for (const w of [null, undefined, 42, 'x', [], { lonsha_memory_bridge_v1: 7 }, { lonsha_memory_bridge_v1: { snapshot: 'x' } },
            mkWin(faceSnap({ ok: true, segments: 'x', platforms: 'y' }))]) {
            WB.readLonshaEventPlatforms(w);
            WB.eventPlatformsLine(w);
        }
    } catch (_e) { threw = true; }
    assert.equal(threw, false, '垃圾入参不得外抛（桥面契约：拿不到就如实缺席）');
    const txt = JSON.stringify(WB.readLonshaEventPlatforms(mkWin(faceSnap(MIX_FACE))));
    for (const bad of ['trust', 'weight', 'priority', 'important', 'confidence', 'severity']) {
        assert.equal(txt.includes(bad), false, '★ 读数不得含判断字段：' + bad);
    }
    assert.ok(WB_SRC.includes('空账返回 **`ok:true` + `reason:\'no-events\'`**'), '源码须写明这条真跑取证的形态');
    assert.match(WB_SRC, /不猜标签/, '源码须写明不猜标签这条硬约束');
});

/* ══════════ B 收集器 ══════════ */
function mockStorage(map = {}, ctx = null) {
    return { get: (k) => (k in map ? map[k] : null), getContext: () => ctx };
}

test('v321 B1. ★★★ 收集器：三态建卡、缺席两态不建卡（每张卡刷一行「尚未读到」只是噪声）', () => {
    assert.equal(TWC.collectLonshaEventPlatforms({}), null, '桥未装 ⇒ 不建卡');
    assert.equal(TWC.collectLonshaEventPlatforms(mkWin({})), null, '本版没这面 ⇒ 不建卡');
    const u = TWC.collectLonshaEventPlatforms(mkWin(faceSnap(UNAVAIL_FACE)));
    assert.ok(u, '★ 插件装了却读不出 ⇒ 必须建卡（否则又是一次静默降级）');
    assert.equal(u.state, 'unusable');
    const e = TWC.collectLonshaEventPlatforms(mkWin(faceSnap(EMPTY_FACE)));
    assert.ok(e, '有面、还没有事件段 ⇒ 建卡（真读数）');
    assert.equal(e.state, 'empty');
    assert.equal(e.segments, 0, '如实 0 段（不写「0 个平台」）；段数字段在，卡片才分得清「空」与「读到 0」');
    const ok = TWC.collectLonshaEventPlatforms(mkWin(faceSnap(MIX_FACE)));
    assert.equal(ok.state, 'ok');
    assert.deepEqual(ok.platforms, ['phone', 'chat'], '平台列表透传（不合并、不改写）');
    assert.equal(ok.platformCount, 2);
    assert.equal(ok.countedEvents, 2, '覆盖线数透传');
    assert.equal(ok.unlabeled, 1, '未标段数透传');
    assert.equal(ok.pluginVersion, '3.233.0', '上游版本透传（用户据此自证新旧）');
    assert.match(ok.line, /事件来源：/, '带一行读数文案（收集器不自己拼结论）');
    assert.match(TWC_SRC, /来源侧：事件是谁记的/, '源码须写明本读数答的是哪个问题');
});

test('v321 B2. ★★★ 来源侧与召回/注入并列，且**不并入 empty 判定**', () => {
    /* 没有生活碎片 ≠ 没有来源构成可读：两件事，压成一态就把「剧情侧有观测」吞了。 */
    const n = TWC.buildNarrative(mockStorage({}), { win: mkWin(faceSnap(MIX_FACE)) });
    assert.equal(n.empty, true, '没有生活碎片仍是 empty');
    assert.ok(n.eventPlatforms, '★ 但来源构成照样带出');
    assert.equal(n.eventPlatforms.state, 'ok');
    const mid = TWC.buildNarrative(mockStorage({ diary_entries: JSON.stringify([{ content: '今天', createdAt: 1000 }]) }), { win: mkWin({}) });
    assert.equal(mid.empty, false, '有生活碎片');
    assert.equal(mid.eventPlatforms, null, '缺席两态在非空分支同样不建卡');
    assert.match(TWC_SRC, /同样\*\*不并入 empty 判定\*\*/, '源码须写明为何不并进去');
});

/* ══════════ C 视图 ══════════ */
test('v321 C1. ★★★ 织光机卡片：三态各一句、段数如实、标签不排序不猜归类', () => {
    assert.match(TWV_SRC, /_eventPlatformsBlock\(m\) \{/, '卡片方法在场');
    assert.match(TWV_SRC, /来源侧观测 · 事件是谁记的/, '卡片标题答的是那个问题');
    assert.match(TWV_SRC, /empty: '（此刻还没有事件段）'/, '空态有自己的话');
    assert.match(TWV_SRC, /unusable: '（本版读不出该面）'/, '读不出的态有自己的话（不得与空态同形）');
    assert.match(TWV_SRC, /不排哪个平台更重要/, '卡片如实声明不排序');
    assert.match(TWV_SRC, /不做文本猜测归类/, '卡片如实声明不猜归类');
    assert.match(TWV_SRC, /本楼还没有事件段/, '零段时的话术（不是「0 段」）');
    assert.match(TWV_SRC, /\$\{this\._injectionBlock\(m\)\}\$\{this\._eventPlatformsBlock\(m\)\}/, '须真接进渲染（建好必须有人消费）');
});

test('v321 C2. ★★★ 世界脉动桥卡片：文案取自真源，视图**不重判形态**', () => {
    assert.match(WPA_SRC, /readLonshaEventPlatforms/, '应用层从真源取数');
    assert.equal(WPA_SRC.split('eventPlatforms: epBlock()').length - 1 >= 2, true, '★ 两条返回路径都要带出该面（否则某条路径上读者拿到 undefined）');
    assert.match(WPV_SRC, /st\.eventPlatforms/, '视图真读它（不是躺在 app 里无人消费）');
    assert.match(WPV_SRC, /esc\(ep\.line \|\| ''\)/, '文案直接取真源给出的行');
    /* ★ 判据必须在**代码**上做，不在注释上做：本卡上方注释正**点名**这些状态串
     *   来说明「形态判断归真源、视图不许重判」；不剥注释就会把「禁用声明」读成「违规使用」
     *   （与 v320 B2 同族，本仓已犯过一次的形态）。 */
    const wpvCode = WPV_SRC.replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10)).filter((l) => !/^\s*\/\//.test(l)).join(String.fromCharCode(10));
    for (const bad of ['face-absent', 'module-unavailable', 'no-events']) {
        assert.equal(wpvCode.includes(bad), false, '★ 视图不得自己判上游状态（真源已把五态分好）：' + bad);
    }
    /* 阳性对照：判据面必须真能看见代码（否则剥注释剥过了头，这条判据会变成恒真） */
    assert.equal(wpvCode.includes("ep.state === 'ok'"), true, '剥注释后代码面仍可见（判据不是恒真）');
    assert.match(WPV_SRC, /被标过的平台：/, '被标过的平台列出');
    assert.match(WPV_SRC, /不猜归类、不排重要性/, '视图也如实声明');
});

/* ══════════ D 负控制（真源码破坏 → 破坏副本上重跑同款真判据） ══════════ */
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

function withBrokenBridge(anchor, replacement, fn) {
    assert.equal(WB_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次：' + anchor.slice(0, 40));
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v321-neg-'));
    (function copy(src, dst) {
        for (const e of readdirSync(src, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
            const sp = path.join(src, e.name), dp = path.join(dst, e.name);
            if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copy(sp, dp); }
            else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* skip */ } }
        }
    })(ROOT, dir);
    const broken = WB_SRC.replace(anchor, replacement);
    assert.notEqual(broken, WB_SRC, '破坏必须真发生');
    writeFileSync(path.join(dir, 'config', 'world-bridge.js'), broken);
    return import(pathToFileURL(path.join(dir, 'config', 'world-bridge.js')).href + '?brk=' + Date.now()).then(fn);
}

test('v321 N1. ★★★ 破坏「ok!==true ⇒ unusable」⇒ A2 同款判据必须转红', async () => {
    await withBrokenBridge('        if (face.ok !== true) {', '        if (false) {', async (M) => {
        const u = M.readLonshaEventPlatforms(mkWin(faceSnap(UNAVAIL_FACE)));
        assert.throws(() => assert.equal(u.state, 'unusable', '上游兜底 ⇒ unusable'), isAssertionFailure,
            'A2 同款判据在破坏副本上必须抛');
        assert.equal(u.state, 'empty', '（破坏已生效：模块未挂上被谎报成「还没有事件线」）');
    });
});

test('v321 N2. ★★★ 破坏「空账 ⇒ empty」⇒ A2 同款判据必须转红', async () => {
    await withBrokenBridge("        if (reason === 'no-events' || segs === 0) {", '        if (false) {', async (M) => {
        const e = M.readLonshaEventPlatforms(mkWin(faceSnap(EMPTY_FACE)));
        assert.throws(() => assert.equal(e.state, 'empty', '空账 ⇒ empty'), isAssertionFailure,
            'A2 同款判据在破坏副本上必须抛');
        assert.equal(e.state, 'ok', '（破坏已生效：空账被当成有构成，行里就成了「无平台标签」）');
        assert.equal(M.eventPlatformsLine(mkWin(faceSnap(EMPTY_FACE))).includes('还没有事件线'), false,
            '（破坏已生效：空账不再说「还没有事件线」）');
    });
});

test('v321 N3. ★★★ 破坏「顺序照上游」⇒ A3 同款判据必须转红', async () => {
    const anchor = '            .filter((p) => p.platform && p.segments > 0);   // ★ 顺序照上游（不重排）';
    await withBrokenBridge(anchor,
        '            .filter((p) => p.platform && p.segments > 0).sort((a, b) => b.segments - a.segments);',
        async (M) => {
            const r = M.readLonshaEventPlatforms(mkWin(faceSnap(MIX_FACE)));
            assert.throws(() => assert.deepEqual(r.platforms, ['phone', 'chat'], '照上游词表顺序'), isAssertionFailure,
                'A3 同款判据在破坏副本上必须抛');
            assert.deepEqual(r.platforms, ['chat', 'phone'], '（破坏已生效：按段数重排了 —— 那就是一种重要性表达）');
        });
});

/* ══════════ E 版本锚 ══════════ */
test('v321 E1. ★ 本套件只在 3.5.0 及以后成立（五源同源由 entry-integrity 锁）', () => {
    const idx = read('index.js');
    const ver = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.ok(ver, '入口版本常量在场');
    const [maj, min] = ver.split('.').map(Number);
    assert.ok(maj > 3 || (maj === 3 && min >= 5), '本套件只在 3.5.0 及以后成立；当前 ' + ver);
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, ver, 'update-log.latest 同源');
});
