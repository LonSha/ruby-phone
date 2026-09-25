// tests/system-v311.test.mjs — 场所覆盖度接上游场景头两键（R3-D 下游侧）[v3.2.0]
//   上游记忆插件 v3.221.0（R3-D）把「删楼 / 前移对**本楼场景头**（headers）做了什么」
//   做成读数外供（`coverage.headerFloors` / `coverage.headerCount`），并在模块缺席时
//   让退路覆盖度与之**逐键同形**。本版把这两格真读进来并渲染成诊断行。
//   层次：A 数据层真解析（含列号 / 条数 / 兜底）
//         B 两态分域（「上游这版没这面」与「有面但没登记」不得同形）
//         C 视图真渲染（★ 行为驱动：卡里必须出现真数据）
//         D 消费点下限（★ 声明了却零消费 = 死声明）
//         E 版本与文档五源同源
//         F 负控制（真源码破坏 → **整仓镜像** → 同款真判据必须转红）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const PD = 'apps/place/place-data.js';
const PV = 'apps/place/place-view.js';
const IDX = 'index.js';

const PD_MOD = await import(at(PD));
const PD_SRC = read(PD);
const PV_SRC = read(PV);
const IDX_SRC = read(IDX);
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
const CURRENT = '3.2.0';

/** 携带场景头两键的覆盖度读数（上游 v3.221.0 形态）。 */
const covWith = (over = {}) => Object.assign({
    floors: [3], floorCount: 1, steps: [], trackFloors: [3],
    headerFloors: [3, 9], headerCount: 2,
    nodes: 4, detailed: 2, visits: 2, presence: 1, unregistered: [], unregisteredCount: 0,
    state: 'ok', broken: [], warnings: []
}, over);
/** 上游 v3.220 及以前的形态（无这两格）。 */
const covOld = () => ({
    floors: [3], floorCount: 1, steps: [], trackFloors: [3],
    nodes: 4, detailed: 2, visits: 2, presence: 1, unregistered: [], unregisteredCount: 0,
    state: 'ok', broken: [], warnings: []
});
const face = (over = {}) => Object.assign({
    version: 1, scale: { nodes: 4, detailed: 2, depth: 4, visits: 2, presence: 1 },
    currentLine: '梧桐市 › 老城区 › 钟楼 › 顶层',
    presence: [{ name: '林晚', key: '梧桐市/老城区/钟楼/顶层', atFloor: 3 }],
    coverage: covWith(), tree: [], visits: [], header: null, empty: false
}, over);

// ══════════ A 数据层真解析 ══════════
test('v311 A1. ★ 场景头楼层列号真被读出来（逐楼可对账，不是只给一个数）', () => {
    const c = PD_MOD.coverageLines(covWith());
    assert.ok(typeof c.headers === 'string' && c.headers.length, 'headers 行必须有');
    assert.ok(c.headers.includes('第3楼') && c.headers.includes('第9楼'), '★ 逐楼列号进读数：' + c.headers);
    assert.ok(c.headers.includes('2 楼'), '★ 条数用上游 headerCount：' + c.headers);
});

test('v311 A2. ★ headerCount 缺失时兜底为列号长度（不编数、不落 0）', () => {
    const c = PD_MOD.coverageLines(covWith({ headerCount: null }));
    assert.ok(c.headers.includes('2 楼'), '★ 条数取列号长度（实 ' + c.headers + '）');
});

test('v311 A3. ★ 脏列号被剔除、不污染列号行；条数照上游给的报', () => {
    const c = PD_MOD.coverageLines(covWith({ headerFloors: [3, '怪', null, 9], headerCount: 2 }));
    assert.ok(c.headers.includes('第3楼') && c.headers.includes('第9楼'), '好行保留');
    assert.ok(!c.headers.includes('第怪楼') && !c.headers.includes('第null楼'), '★ 坏行不产出');
});

test('v311 A4. ★ 接线面：projectScene 把「覆盖度面在不在」显式带出', () => {
    const on = PD_MOD.projectScene(face());
    const off = PD_MOD.projectScene(face({ coverage: covOld() }));
    assert.equal(on.hasHeaderFloorsFace, true, '有格 ⇒ 有这面');
    assert.equal(off.hasHeaderFloorsFace, false, '★ 旧上游无格 ⇒ 如实报「没这面」');
    const bare = PD_MOD.projectScene({ scale: {}, presence: [], currentChain: [] });
    assert.equal(bare.hasHeaderFloorsFace, false, '连 coverage 都没有 ⇒ 没这面');
    assert.equal(bare.coverage.headers, '', '空面 headers 如实空串');
    const emptyOn = PD_MOD.projectScene(face({ coverage: covWith({ headerFloors: [], headerCount: 0 }) }));
    assert.equal(emptyOn.hasHeaderFloorsFace, true,
        '★ 「有面但 0 条」仍是「有这面」—— 面存在性不得被写成「内容非空」');
});

// ══════════ B 两态分域 ══════════
test('v311 B1. ★ 「上游这版没这面」与「有面但没登记场景头」不得同形', () => {
    const gone = PD_MOD.coverageLines(covOld());
    const empty = PD_MOD.coverageLines(covWith({ headerFloors: [], headerCount: 0 }));
    assert.equal(gone.headers, '', '★ 没这面 ⇒ 空串（视图另给升级提示）');
    assert.ok(empty.headers.length > 0, '★ 有面为空 ⇒ 必须给一句话，不能也是空');
    assert.notEqual(empty.headers, gone.headers, '★ 两种相反处境不得同形');
    assert.ok(empty.headers.includes('尚未登记'), '空面文案明说「还没登记」：' + empty.headers);
});

test('v311 B2. ★ 「0 条场景头」是合法读数，不是「没给」', () => {
    const zero = PD_MOD.coverageLines(covWith({ headerFloors: [], headerCount: 0 }));
    assert.ok(zero.headers.includes('尚未登记'), '★ 有面 + 0 条 ⇒ 报「尚未登记」（不是空串）');
    const missingCount = PD_MOD.coverageLines(covWith({ headerCount: undefined }));
    assert.ok(missingCount.headers.includes('2 楼'), '★ count 没给 ⇒ 用列号长度，不落 0');
});

// ══════════ C 视图真渲染 ══════════
test('v311 C1. ★ 诊断卡真渲染场景头覆盖度行（真数据进 DOM）', async () => {
    const mod = await import(at(PV));
    const proj = PD_MOD.projectScene(face());
    const app = {
        projection: () => ({ face: { reason: 'ready', text: 'ok', state: 'ready' }, proj, src: null }),
        getSettings: () => ({ showDiagnostics: true }), saveSettings: () => {}
    };
    const view = new mod.PlaceView(app);
    const el = { innerHTML: '', querySelector: () => null };
    view.render(el);
    assert.ok(el.innerHTML.includes('场景头覆盖'), '★ 场景头覆盖度行进 DOM');
    assert.ok(el.innerHTML.includes('第9楼'), '★ 真列号进 DOM');
});

test('v311 C2. ★ 上游旧版时不撒谎：如实说「需插件 v3.221 或更新」', async () => {
    const mod = await import(at(PV));
    const proj = PD_MOD.projectScene(face({ coverage: covOld() }));
    const app = {
        projection: () => ({ face: { reason: 'ready', text: 'ok' }, proj, src: null }),
        getSettings: () => ({ showDiagnostics: true }), saveSettings: () => {}
    };
    const view = new mod.PlaceView(app);
    const el = { innerHTML: '', querySelector: () => null };
    view.render(el);
    assert.ok(el.innerHTML.includes('上游这版没有场景头覆盖度'), '★ 没这面如实说没');
    assert.ok(el.innerHTML.includes('v3.221'), '★ 给出升级所需版本');
    assert.ok(!el.innerHTML.includes('尚未登记任何楼层的场景头'), '★ 不得把「没这面」渲染成「还没登记」');
});

test('v311 C3. ★ 有面为空时不撒谎：说「尚未登记」而不是「上游没这面」', async () => {
    const mod = await import(at(PV));
    const proj = PD_MOD.projectScene(face({ coverage: covWith({ headerFloors: [], headerCount: 0 }) }));
    const app = {
        projection: () => ({ face: { reason: 'ready', text: 'ok' }, proj, src: null }),
        getSettings: () => ({ showDiagnostics: true }), saveSettings: () => {}
    };
    const view = new mod.PlaceView(app);
    const el = { innerHTML: '', querySelector: () => null };
    view.render(el);
    assert.ok(el.innerHTML.includes('尚未登记任何楼层的场景头'), '★ 空面如实说「未登记」');
    assert.ok(!el.innerHTML.includes('需插件 v3.221'), '★ 不得把「还没登记」渲染成「没这面」');
});

// ══════════ D 消费点下限 ══════════
test('v311 D1. ★ 两键都有真消费点（数据层解析 + 视图渲染）', () => {
    assert.ok(/c\.headerFloors/.test(PD_SRC), '★ headerFloors 未在投影层被消费（声明了却零消费）');
    assert.ok(/c\.headerCount/.test(PD_SRC), '★ headerCount 未在投影层被消费');
    assert.ok(/hasHeaderFloorsFace/.test(PD_SRC) && /hasHeaderFloorsFace/.test(PV_SRC), '★ 面存在性须在视图被消费');
    assert.ok(/cov\.headers/.test(PV_SRC), '★ 视图须消费 headers 行');
});

test('v311 D2. ★ 不写回退逻辑：仍用「面在不在」而不是「版本号」判据', () => {
    assert.ok(!/LonSha.*version.*[<>]=/.test(PD_SRC), '★ 数据层不得自行比较上游版本号');
    assert.ok(PD_SRC.includes('hasHeaderFloorsFace') && PD_SRC.includes('hasHeaderFace'), '★ 用面存在性判据');
});

// ══════════ E 版本与文档 ══════════
test('v311 E1. ★ 五源同源且不低于 3.2.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(IDX_SRC);
    assert.ok(m, '入口版本常量可提取');
    assert.equal(man.version, pkg.version, 'package 与 manifest 同源');
    assert.equal(pkg.version, m[1], '入口常量与 manifest 同源');
    assert.equal(log.latest, man.version, 'update-log.latest 同源');
    assert.ok(vnum(log.latest) >= vnum(CURRENT), '不低于 ' + CURRENT + '，实得 ' + log.latest);
});

test('v311 E2. ★ 变更说明真讲本版（提场景头覆盖度）且与弹窗逐字同源', () => {
    const log = JSON.parse(read('update-log.json'));
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length, '当前版本节须有条目');
    const all = entry.items.join('\n');
    for (const kw of ['场景头', '覆盖度']) {
        assert.ok(all.includes(kw), '变更说明未提到本版落地项：' + kw);
    }
    const blk = IDX_SRC.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(blk, 'ST_PHONE_CURRENT_UPDATE 可提取');
    for (const item of entry.items) {
        assert.ok(blk[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 24) + '…');
    }
    assert.match(blk[0], new RegExp('date: "' + entry.date + '"'), 'date 同源');
});

// ══════════ F 负控制（真源码破坏 → **整仓镜像** → 同款判据转红）══════════
/* 【为什么必须整仓镜像】place-data.js 顶部 `import { faceFieldState } from '../../config/world-bridge.js'`
 *   是相对路径；把破坏副本写进裸临时目录会解析成 `/config/world-bridge.js` ⇒ ERR_MODULE_NOT_FOUND，
 *   负控制跑的就不是判据而是一次加载失败（假红）。本仓 v2.99.0 起统一为 cpSync 整仓镜像（v310 同款基建）。 */
const ORIG = new Map();
for (const f of [PD, PV, IDX]) ORIG.set(f, read(f));

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v311-mir-'));
    fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('.git') });
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
/* 【必须 await】`fn` 是异步用例（要 dynamic import 副本里的模块）。
 *   写成 `try { return fn(dir); } finally { rmSync(dir) }` 会在 fn 的 Promise 还挂着时
 *   就把镜像删掉 ⇒ 动态 import 报 ERR_MODULE_NOT_FOUND —— 那是**假红**（跑的不是判据
 *   而是一次加载失败）。 */
async function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ── 判据（纯函数，正负两跑；负控制必须用**同款**判据）── */
/** J1 覆盖度真读：列号行在 + 逐楼可对账 → 原版 true，破坏后 false */
function jHeaderCov(mod) {
    const c = mod.coverageLines(covWith());
    return typeof c.headers === 'string' && c.headers.includes('第3楼') && c.headers.includes('第9楼');
}
/** J2 两态分域 → 原版 true，破坏后 false */
function jHeaderCovGap(mod) {
    const gone = mod.coverageLines(covOld());
    const empty = mod.coverageLines(covWith({ headerFloors: [], headerCount: 0 }));
    return gone.headers !== empty.headers && empty.headers.length > 0;
}
/** J3 面存在性真读 → 原版 true，破坏后 false。
 *   【三探针缺一不可】只测「有面有数」时，把判据写成「内容非空才算有面」
 *   （`... && c.headerFloors.length`）破坏掉 `Array.isArray` 分支也照样为 true ——
 *   破坏不可观测 = 假绿。必须同时钉住「有面但 0 条仍算有这面」这一支。 */
function jHeaderCovFace(mod) {
    const on = mod.projectScene(face());
    const off = mod.projectScene(face({ coverage: covOld() }));
    const emptyOn = mod.projectScene(face({ coverage: covWith({ headerFloors: [], headerCount: 0 }) }));
    return on.hasHeaderFloorsFace === true
        && emptyOn.hasHeaderFloorsFace === true
        && off.hasHeaderFloorsFace === false;
}

test('v311 F0. 镜像树自证 + 阳性对照：未破坏时三条判据全真（否则 F 组是假绿）', () => {
    assert.equal(jHeaderCov(PD_MOD), true, 'J1 在原件上必须为真');
    assert.equal(jHeaderCovGap(PD_MOD), true, 'J2 在原件上必须为真');
    assert.equal(jHeaderCovFace(PD_MOD), true, 'J3 在原件上必须为真');
    const dir = mirror({});
    try {
        assert.ok(fs.existsSync(path.join(dir, 'config', 'world-bridge.js')), '镜像里必须带上相对 import 的落点');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v311 N1. ★ 负控制：把场景头列号行摘掉 ⇒ **同款判据 J1** 转红', async () => {
    await withMirror({
        [PD]: (s) => mutateOnce(s,
            "    const hFloors = Array.isArray(c.headerFloors) ? c.headerFloors.filter((f) => numOrNull(f) !== null) : [];",
            "    const hFloors = [];")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        assert.equal(jHeaderCov(broken), false, '★ 同款判据（J1）在副本上必须为 false');
        assert.equal(jHeaderCov(PD_MOD), true, '对照：原件上仍为 true（差值来自破坏本身）');
    });
});

test('v311 N2. ★ 负控制：把「没这面」与「有面为空」压成一态 ⇒ **同款判据 J2** 转红', async () => {
    await withMirror({
        [PD]: (s) => mutateOnce(s,
            "    const headers = !Array.isArray(c.headerFloors) ? ''",
            "    const headers = false ? ''")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        assert.equal(jHeaderCovGap(broken), false, '★ 同款判据（J2）在副本上必须为 false（两态塌成一态）');
    });
});

test('v311 N3. ★ 负控制：面存在性写成「内容非空」⇒ **同款判据 J3** 转红', async () => {
    await withMirror({
        [PD]: (s) => mutateOnce(s,
            "        out.hasHeaderFloorsFace = !!(face.coverage && typeof face.coverage === 'object'\n            && Array.isArray(face.coverage.headerFloors));",
            "        out.hasHeaderFloorsFace = !!(face.coverage && face.coverage.headerFloors && face.coverage.headerFloors.length);")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        assert.equal(jHeaderCovFace(broken), false, '★ 同款判据（J3）在副本上必须为 false（有面为空被读成没这面）');
    });
});

test('v311 N4. ★ 负控制：视图不渲染该行 ⇒ 判据（DOM 含真数据）转红', async () => {
    await withMirror({
        [PV]: (s) => mutateOnce(s,
            "        const hdrCov = (cov.headers",
            "        const hdrCov = (false")
    }, async (dir) => {
        const mod = await import(pathToFileURL(path.join(dir, PV)).href + '?m=' + Date.now());
        const pd = await import(pathToFileURL(path.join(dir, PD)).href);
        const proj = pd.projectScene(face());
        const app = {
            projection: () => ({ face: { reason: 'ready', text: 'ok' }, proj, src: null }),
            getSettings: () => ({ showDiagnostics: true }), saveSettings: () => {}
        };
        const view = new mod.PlaceView(app);
        const el = { innerHTML: '', querySelector: () => null };
        view.render(el);
        assert.ok(!el.innerHTML.includes('场景头覆盖'), '★ 破坏副本上真数据不再进 DOM');
    });
});
