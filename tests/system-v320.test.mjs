/**
 * tests/system-v320.test.mjs — F-3 同楼同刻三态卡 + F-6 口径自述转述 [v3.4.3]
 *
 * 上游 v3.232.0 两个新面（`scene.coPresence` / `scene.observationNotes`）的消费侧。
 * 两件事同一纪律：**只呈现事实，不呈现判断**。
 *
 * 覆盖：
 *   A 投影面（三态：缺格 / 有面为空 / 有面有内容；≥2 过滤；畸形过滤；无判断字段）
 *   B 视图面（三态三句话各不相同；不得出现判断词）
 *   C 诊断面（F-6 口径自述如实转述；无面时明说「这版上游没带」）
 *   D 负控制（真源码破坏 → 破坏副本上重跑同款真判据）
 *   E 版本锚（五源同源）
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const PD_SRC = read('apps/place/place-data.js');
const PV_SRC = read('apps/place/place-view.js');
const DD_SRC = read('apps/diagnose/diagnose-data.js');
const DV_SRC = read('apps/diagnose/diagnose-view.js');

/** 镜像仓：被测模块带相对 import（place-data → ../../config/world-bridge.js），
 *  搬到临时目录会断相对路径（实测 ERR_MODULE_NOT_FOUND）⇒ 按真仓结构建镜像。 */
const MIRROR = mkdtempSync(path.join(os.tmpdir(), 'v320-mir-'));
(function copyTree(src, dst) {
    for (const e of readdirSync(src, { withFileTypes: true })) {
        if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
        const sp = path.join(src, e.name), dp = path.join(dst, e.name);
        if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copyTree(sp, dp); }
        else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* 跳过读不到的 */ } }
    }
})(ROOT, MIRROR);
const load = (rel) => import('file://' + path.join(MIRROR, rel));
const PD = await load('apps/place/place-data.js');

/** 造一份带 coPresence 的场景面 */
const sceneWith = (cp) => ({
    version: 1, scale: { nodes: 2, detailed: 1, depth: 2, visits: 1, presence: 3 },
    current: '城A/钟楼',
    currentChain: [{ key: '城A/钟楼', name: '钟楼', path: ['城A', '钟楼'], desc: '', floor: 7 }],
    presence: [{ name: '甲', key: '城A/钟楼', atFloor: 7 }, { name: '乙', key: '城A/钟楼', atFloor: 7 },
        { name: '丙', key: '城A/集市', atFloor: 7 }],
    coverage: {
        floors: [7], floorCount: 1, steps: [], trackFloors: [7], headerFloors: [], headerCount: 0,
        nodes: 2, detailed: 1, visits: 1, presence: 3, unregistered: [], unregisteredCount: 0,
        state: 'ok', broken: [], warnings: []
    },
    tree: [{ key: '城A', name: '城A', desc: '', depth: 1, floor: 3, visited: true, visits: 1 }],
    visits: [{ key: '城A/钟楼', path: ['城A', '钟楼'], count: 2, firstFloor: 3, lastFloor: 7, revisit: true, registered: true }],
    header: null,
    ...(cp === undefined ? {} : { coPresence: cp }),
    empty: false
});

/* ══════════ 共用判据体（A/D 跑同一份代码） ══════════ */
function assertTriStateHasFace(face) {
    /* 缺格 ⇒ hasFace=false；有面（哪怕是空面）⇒ hasFace=true。两者处置相反，不得同形。 */
    const missing = PD.projectScene(sceneWith(undefined));
    assert.equal(missing.hasCoPresenceFace, false, '缺格必须报 false');
    assert.equal(missing.coPresenceFace, null, '缺格时面读数必须是 null（不是「有面但空」）');
    const present = PD.projectScene(sceneWith(face));   // ★ 入参是 coPresence 面，须包成整个 scene face
    assert.equal(present.hasCoPresenceFace, true, '有面（哪怕空）必须报 true');
    assert.ok(present.coPresenceFace && typeof present.coPresenceFace === 'object', '有面须给面读数');
}

/* ══════════ A 投影面 ══════════ */
test('v320 A1. ★★★ 三态：缺格 / 有面为空 / 有面有内容，三者各不相同', () => {
    const full = { rows: [{ floor: 7, key: '城A/钟楼', path: ['城A', '钟楼'], names: ['甲', '乙'], count: 2 }], count: 1, totalPresent: 3, skippedUnknownFloor: 0 };
    assertTriStateHasFace(full);
    const withRows = PD.projectScene(sceneWith(full));
    assert.equal(withRows.coPresence.length, 1, '有内容须给一行');
    assert.equal(withRows.coPresence[0].floor, 7);
    assert.deepEqual(withRows.coPresence[0].names, ['甲', '乙']);

    const empty = PD.projectScene(sceneWith({ rows: [], count: 0, totalPresent: 2, skippedUnknownFloor: 1 }));
    assert.equal(empty.coPresence.length, 0, '空面零行');
    assert.equal(empty.hasCoPresenceFace, true, '空面仍是「有面」');
    /* ★ 三态的判别点：空面要给元读数（在场总数 / 未记楼层数），否则「空」与「缺格」读起来一样 */
    assert.equal(empty.coPresenceFace.totalPresent, 2, '空面须带在场总数');
    assert.equal(empty.coPresenceFace.skippedUnknownFloor, 1, '空面须带未记楼层数');
});

test('v320 A2. ★★★ 只呈现事实：读数里不得出现任何判断类字段', () => {
    /* 上游能给的是「两人此刻都在钟楼」；「他们会不会打起来」不是账本能回答的。
     *   本仓在这一层加「疑似冲突」就是把猜测渲染成事实。 */
    const p = PD.projectScene(sceneWith({
        rows: [{ floor: 7, key: '城A/钟楼', path: ['城A', '钟楼'], names: ['甲', '乙'], count: 2 }],
        count: 1, totalPresent: 3, skippedUnknownFloor: 0
    }));
    const txt = JSON.stringify(p.coPresence) + JSON.stringify(p.coPresenceFace);
    for (const bad of ['conflict', 'tension', 'risk', 'severity', 'intent', 'emotion']) {
        assert.equal(txt.includes(bad), false, '★ 读数不得含判断字段：' + bad);
    }
    /* row 字段面恒定 */
    assert.deepEqual(Object.keys(p.coPresence[0]).sort(), ['count', 'floor', 'key', 'names', 'path'], 'row 字段面恒定');
    assert.match(PD_SRC, /只说「这几个人此刻都在这里」/, '源码面须写明边界');
});

test('v320 A3. ★★★ ≥2 过滤与畸形过滤（与上游同口径）', () => {
    /* 一人不算「同楼同刻」 */
    const one = PD.projectScene(sceneWith({ rows: [{ floor: 7, key: 'x', path: [], names: ['独'], count: 1 }], count: 0, totalPresent: 1, skippedUnknownFloor: 0 }));
    assert.equal(one.coPresence.length, 0, '★ 单人须被过滤（≥2 才是同楼同刻）');
    assert.equal(one.hasCoPresenceFace, true, '过滤后仍是「有面」');
    /* 畸形行 / 空名字 */
    const bad = PD.projectScene(sceneWith({
        rows: [null, 42, { names: ['a', ''] }, { names: ['甲', '乙'], floor: null, key: 'k' }],
        count: 9, totalPresent: 2, skippedUnknownFloor: 0
    }));
    assert.equal(bad.coPresence.length, 1, '只有名字 ≥2 个的行才留下');
    assert.deepEqual(bad.coPresence[0].names, ['甲', '乙'], '空名字被剔除');
    assert.equal(bad.coPresence[0].floor, null, '「没给楼层」如实 null（不当第 0 楼）');
});

test('v320 A4. ★★ 绝不抛：垃圾入参一律降级为空面', () => {
    let threw = false;
    try {
        PD.projectScene(null); PD.projectScene({}); PD.projectScene({ coPresence: 'x' });
        PD.projectScene(sceneWith('bad')); PD.projectScene(sceneWith(null)); PD.projectScene(sceneWith([1, 2]));
    } catch (_e) { threw = true; }
    assert.equal(threw, false, '垃圾入参不得外抛');
});

/* ══════════ B 视图面 ══════════ */
test('v320 B1. ★★★ 三态三句话各不相同（缺格 / 空 / 有内容）', () => {
    assert.match(PV_SRC, /上游这版没有同楼同刻面（需插件 v3\.232 或更新）/, '缺格话术须明说需升级');
    assert.match(PV_SRC, /此刻没有同楼同刻/, '空面话术须是「此刻没有」而不是「没有」');
    /* ★ 两句不得同形：一个要等上游升级，一个要用户去补 —— 处置相反 */
    const iMiss = PV_SRC.indexOf('上游这版没有同楼同刻面');
    const iEmpty = PV_SRC.indexOf('此刻没有同楼同刻');
    assert.ok(iMiss > 0 && iEmpty > 0 && iMiss !== iEmpty, '两句必须是不同的分支');
    assert.match(PV_SRC, /_coPresenceCard\(proj, face\)/, '卡片须接进渲染');
});

test('v320 B2. ★★★ 视图也不得出现判断词（只呈现事实）', () => {
    /* 切片起点必须**包含方法上方的注释块**：首版从方法定义行起切，
     *   于是「须写明只呈现事实」这句断言找不到它要的那句话 —— 判据切错了范围（不是产品没写）。 */
    const iDef = PV_SRC.indexOf('_coPresenceCard(proj, face) {');
    const i0 = PV_SRC.lastIndexOf('/**', iDef);
    assert.ok(i0 > 0, '须能定位到方法上方的注释块');
    assert.ok(i0 > 0, '卡片方法在场');
    const block = PV_SRC.slice(i0, PV_SRC.indexOf('_settingsCard() {', i0));
    /* ★ 判据必须在**代码**上做，不能在注释上做 —— 本卡上方的注释块正**点名**了这些词
     *   来说明「本卡不许写它们」；不剥注释的话，判据会把「禁用声明」读成「违规使用」，
     *   于是它变成「不准提历史」那种形态（本仓 OCR 同族教训）。 */
    const code = block.replace(/\/\*[\s\S]*?\*\//g, '').split(String.fromCharCode(10))
        .filter((l) => !/^\s*\/\//.test(l)).join(String.fromCharCode(10));
    for (const bad of ['冲突', '对峙', '打架', '碰面风险', '疑似', '危险']) {
        assert.equal(code.includes(bad), false, '★ 卡片代码里不得出现判断词：' + bad);
    }

    assert.match(block, /只呈现\*\*事实\*\*/, '须写明只呈现事实');
});

/* ══════════ C 诊断面（F-6） ══════════ */
test('v320 C1. ★★★ F-6 口径自述如实转述（只转述，不改口径）', () => {
    assert.match(DD_SRC, /readPushField\(snapshot, 'scene'\)/, '须从真源字段读（不自摸桥）');
    assert.match(DD_SRC, /observationNotes/, '须读该面');
    assert.match(DD_SRC, /obsNotes/, '须落成结构化面（obsNotes）');
    assert.match(DD_SRC, /只转述，不改口径/, '须写明只转述');
    /* 视图侧：没有面时明说「这版上游没带」，而不是静默空 */
    assert.match(DV_SRC, /上游这版没有口径自述面（需记忆插件 v3\.232 或更新）/, '无面话术须明说需升级');
    assert.match(DV_SRC, /_notesHtml\(pkg\)/, '卡片须接进渲染');
    assert.match(DV_SRC, /调用方职责：/, '须转述调用方职责（那条自述的要点）');
});

/* ══════════ D 负控制（真源码破坏 → 破坏副本上重跑同款真判据） ══════════ */
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

function withBrokenPlaceData(mutate, fn) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v320-neg-'));
    try {
        /* 破坏副本也要有完整镜像结构（相对 import） */
        (function copy(src, dst) {
            for (const e of readdirSync(src, { withFileTypes: true })) {
                if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
                const sp = path.join(src, e.name), dp = path.join(dst, e.name);
                if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copy(sp, dp); }
                else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* skip */ } }
            }
        })(ROOT, dir);
        const broken = mutate(PD_SRC);
        assert.notEqual(broken, PD_SRC, '破坏必须真发生');
        writeFileSync(path.join(dir, 'apps', 'place', 'place-data.js'), broken);
        return import('file://' + path.join(dir, 'apps', 'place', 'place-data.js')).then(fn);
    } finally { /* 目录留给进程退出清理（与仓内其它镜像类用例同口径） */ }
}

test('v320 N1. ★★★ 破坏「≤1 人过滤」⇒ A3 同款判据必须转红', async () => {
    const anchor = '        if (names.length < 2) continue;                 // 与上游同口径：≥2 才算「同楼同刻」';
    assert.equal(PD_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    await withBrokenPlaceData((s) => s.replace(anchor, '        if (false) continue;'), async (M) => {
        const p = M.projectScene(sceneWith({ rows: [{ floor: 7, key: 'x', path: [], names: ['独'], count: 1 }], count: 0, totalPresent: 1, skippedUnknownFloor: 0 }));
        assert.throws(() => assert.equal(p.coPresence.length, 0, '单人须被过滤'), isAssertionFailure,
            'A3 同款判据在破坏副本上必须抛');
        assert.equal(p.coPresence.length, 1, '（破坏已生效：单人被当成了「同楼同刻」）');
    });
});

test('v320 N2. ★★★ 破坏「三态」（让缺格也报 hasFace=true）⇒ A1 同款判据必须转红', async () => {
    const anchor = "    out.hasCoPresenceFace = !!(face.coPresence && typeof face.coPresence === 'object');";
    assert.equal(PD_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    await withBrokenPlaceData((s) => s.replace(anchor, '    out.hasCoPresenceFace = true;'), async (M) => {
        const missing = M.projectScene(sceneWith(undefined));
        assert.throws(() => assert.equal(missing.hasCoPresenceFace, false, '缺格必须报 false'), isAssertionFailure,
            'A1 同款判据在破坏副本上必须抛');
        assert.equal(missing.hasCoPresenceFace, true, '（破坏已生效：缺格与有面同形了）');
    });
});

test('v320 N3. ★★★ 破坏「元读数」（空面不给 totalPresent）⇒ A1 同款判据必须转红', async () => {
    const anchor = '            totalPresent: numOrNull(cp.totalPresent),';
    assert.equal(PD_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    await withBrokenPlaceData((s) => s.replace(anchor, '            totalPresent: null,'), async (M) => {
        const empty = M.projectScene(sceneWith({ rows: [], count: 0, totalPresent: 2, skippedUnknownFloor: 1 }));
        assert.throws(() => assert.equal(empty.coPresenceFace.totalPresent, 2, '空面须带在场总数'), isAssertionFailure,
            'A1 同款判据在破坏副本上必须抛');
    });
});

/* ══════════ E 版本锚 ══════════ */
test('v320 E1. ★ 版本五源同源（入口 / manifest / package / update-log.latest / versions 首键）', () => {
    const idx = read('index.js');
    const ver = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.ok(ver, '入口版本常量在场');
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    assert.equal(JSON.parse(read('package.json')).version, ver, 'package 同源');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, ver, 'update-log.latest 同源');
    assert.equal(Object.keys(ul.versions)[0], ver, '★ versions 首键即当前版本');
});