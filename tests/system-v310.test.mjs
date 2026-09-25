// tests/system-v310.test.mjs — 场所三新面消费（R3-A 下游侧）[v3.1.0]
//   上游记忆插件 v3.220.0 把场所面从「当前链 + 规模四数」扩到**带层级树 / 到访史 / 本楼场景头**。
//   本版把那三面真读进来并渲染成三张卡。
//   层次：A 投影层真解析（三面各自独立）
//         B 三面与旧面分域（「没给」与「给了空的」不得同形）
//         C 视图真渲染（★ 行为驱动：卡里必须出现真数据）
//         D 消费点下限（★ 声明了却零消费 = 死声明，仓内第九道门 J8 同域）
//         E 版本与文档五源同源
//         F 负控制（真源码破坏 → 破坏副本 → 同款真判据）
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
const PC = 'apps/place/place.css';
const IDX = 'index.js';

const PD_MOD = await import(at(PD));
const PD_SRC = read(PD);
const PV_SRC = read(PV);
const PC_SRC = read(PC);
const IDX_SRC = read(IDX);
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
const CURRENT = '3.1.0';  // 本套件出生版本（不随抬版上抬）

/** 上游 v3.220 的 scene 面夹具（三新面 + 旧面）。 */
function sceneFace(over = {}) {
    return Object.assign({
        version: 1,
        scale: { nodes: 4, detailed: 2, depth: 4, visits: 2, presence: 1 },
        current: '梧桐市/老城区/钟楼/顶层',
        currentLine: '梧桐市 › 老城区 › 钟楼（爬满藤蔓）› 顶层（塔顶）',
        currentChain: [
            { key: '梧桐市', path: ['梧桐市'], name: '梧桐市', desc: '', floor: 3 },
            { key: '梧桐市/老城区', path: ['梧桐市', '老城区'], name: '老城区', desc: '', floor: 3 },
            { key: '梧桐市/老城区/钟楼', path: ['梧桐市', '老城区', '钟楼'], name: '钟楼', desc: '爬满藤蔓', floor: 3 },
            { key: '梧桐市/老城区/钟楼/顶层', path: ['梧桐市', '老城区', '钟楼', '顶层'], name: '顶层', desc: '塔顶', floor: 3 }
        ],
        presence: [{ name: '林晚', key: '梧桐市/老城区/钟楼/顶层', atFloor: 3 }],
        coverage: { floors: [3], floorCount: 1, steps: [], trackFloors: [3], nodes: 4, detailed: 2, visits: 2, presence: 1, unregistered: [], unregisteredCount: 0, state: 'ok', broken: [], warnings: [] },
        tree: [
            { key: '梧桐市', path: ['梧桐市'], name: '梧桐市', depth: 1, desc: '', floor: 3, visited: true, visits: 3 },
            { key: '梧桐市/老城区', path: ['梧桐市', '老城区'], name: '老城区', depth: 2, desc: '', floor: 3, visited: true, visits: 3 },
            { key: '梧桐市/老城区/钟楼', path: ['梧桐市', '老城区', '钟楼'], name: '钟楼', depth: 3, desc: '爬满藤蔓', floor: 3, visited: true, visits: 2 },
            { key: '梧桐市/老城区/钟楼/顶层', path: ['梧桐市', '老城区', '钟楼', '顶层'], name: '顶层', depth: 4, desc: '塔顶', floor: 3, visited: true, visits: 1 }
        ],
        visits: [
            { key: '梧桐市/老城区/钟楼', path: ['梧桐市', '老城区', '钟楼'], count: 2, firstFloor: 3, lastFloor: 6, revisit: true, registered: true, desc: '爬满藤蔓' },
            { key: '梧桐市/老城区/钟楼/顶层', path: ['梧桐市', '老城区', '钟楼', '顶层'], count: 1, firstFloor: 3, lastFloor: 3, revisit: false, registered: true, desc: '塔顶' }
        ],
        header: { floor: 3, date: '7月28日', period: '傍晚', weather: '小雨' },
        empty: false
    }, over);
}

// ══════════ A 投影层真解析 ══════════
test('v310 A1. ★ 层级树真被读出来（含 depth / 末级名 / 出处楼层）', () => {
    const p = PD_MOD.projectScene(sceneFace());
    assert.ok(Array.isArray(p.tree), 'tree 是数组');
    assert.equal(p.tree.length, 4, '★ 四行都进来（不漏行）');
    const leaf = p.tree.find((n) => n.name === '顶层');
    assert.ok(leaf, '★ 末级名可用于渲染');
    assert.equal(leaf.depth, 4, '★ 层级深度从上游带出（不本地猜）');
    assert.equal(leaf.floor, 3, '出处楼层带出');
    assert.equal(leaf.desc, '塔顶', '描述带出');
});

test('v310 A2. ★ 到访史真被读出来（去过几次现在能答）', () => {
    const p = PD_MOD.projectScene(sceneFace());
    const v = p.history.find((x) => x.key === '梧桐市/老城区/钟楼');
    assert.ok(v, '钟楼在到访史里');
    assert.equal(v.count, 2, '★ count 真的有值（修前本页只能报条目数）');
    assert.equal(v.revisit, true, '重访标记');
    assert.equal(v.registered, true, '登记状态');
});

test('v310 A3. ★ 场景头真被读出来（日期/时段/天气分字段）', () => {
    const p = PD_MOD.projectScene(sceneFace());
    assert.ok(p.header, '有场景头');
    assert.equal(p.header.date, '7月28日');
    assert.equal(p.header.period, '傍晚');
    assert.equal(p.header.weather, '小雨');
});

test('v310 A4. ★ 当前链结构化面也接进来（带 desc/floor，不只是名字）', () => {
    const p = PD_MOD.projectScene(sceneFace());
    assert.ok(Array.isArray(p.chainFace) && p.chainFace.length === 4, '四级链');
    assert.equal(p.chainFace[3].name, '顶层');
    assert.equal(p.chainFace[3].desc, '塔顶');
    assert.equal(p.chainFace[3].floor, 3);
});

test('v310 A5. ★ 畸形行不污染（坏行丢掉，好行照常）', () => {
    const p = PD_MOD.projectScene(sceneFace({ tree: [null, '怪', { path: ['甲'], name: '甲', depth: '怪' }, 42] }));
    assert.equal(p.tree.length, 1, '★ 只有一行合法');
    assert.equal(p.tree[0].depth, 1, '★ 坏 depth 归一为 1（不生成 NaN 缩进）');
});

// ══════════ B 分域 ══════════
test('v310 B1. ★ 三面「没给」与「给了空的」分开（不得同形）', () => {
    const old = sceneFace();
    delete old.tree; delete old.visits; delete old.header; delete old.currentChain;
    const pOld = PD_MOD.projectScene(old);
    assert.equal(pOld.hasTreeFace, false, '★ 如实报「这版没层级面」');
    assert.equal(pOld.hasVisitFace, false, '★ 如实报「这版没到访史面」');
    assert.equal(pOld.hasHeaderFace, false, '★ 如实报「这版没场景头面」');
    const pNew = PD_MOD.projectScene(sceneFace({ tree: [], visits: [], header: null }));
    assert.equal(pNew.hasTreeFace, true, '给了空数组 ⇒ 有这面');
    assert.equal(pNew.hasVisitFace, true, '给了空数组 ⇒ 有这面');
    assert.equal(pNew.hasHeaderFace, true, '★ header:null 仍是「有这面」（与「没给」分开）');
    assert.equal(pNew.header, null, '头为空如实 null');
});

test('v310 B2. ★ 「去了 0 次」不会被读成 null，反之亦然', () => {
    const p = PD_MOD.projectScene(sceneFace({ visits: [{ key: '甲/乙', path: ['甲', '乙'], count: 0, firstFloor: null, lastFloor: null }] }));
    assert.equal(p.history[0].count, 0, '★ 0 是合法读数（不是「没给」）');
    assert.equal(p.history[0].firstFloor, null, '★ 楼层没给如实 null（不写 0）');
});

// ══════════ C 视图真渲染 ══════════
test('v310 C1. ★ 视图真渲染三张卡（卡名 + 真数据都出现）', async () => {
    const mod = await import(at(PV));
    const proj = PD_MOD.projectScene(sceneFace());
    const app = {
        projection: () => ({ face: { reason: 'ready', text: 'ok', state: 'ready' }, proj, src: { usable: true, stale: false, line: '会话 A · 修订 3' } }),
        getSettings: () => ({ showDiagnostics: true, injectToPrompt: false, maxInject: 8 }),
        saveSettings: () => {}
    };
    const view = new mod.PlaceView(app);
    const el = { innerHTML: '', querySelector: () => null };
    view.render(el);
    const html = el.innerHTML;
    assert.ok(html.includes('场所层级'), '★ 有「场所层级」卡');
    assert.ok(html.includes('到访史'), '★ 有「到访史」卡');
    assert.ok(html.includes('本楼场景头'), '★ 有「本楼场景头」卡');
    assert.ok(html.includes('顶层'), '★ 树里真数据进 DOM');
    assert.ok(html.includes('2 次'), '★ 到访次数进 DOM（修前答不出）');
    assert.ok(html.includes('小雨'), '★ 天气进 DOM');
    assert.ok(/padding-left:\s*0px/.test(html) && /padding-left:\s*42px/.test(html), '★ 缩进按下推层级渲染（四级 = 3×14）');
});

test('v310 C2. ★ 上游旧版时不撒谎：三卡各自说「这版没有这个面」', async () => {
    const mod = await import(at(PV));
    const face = sceneFace();
    delete face.tree; delete face.visits; delete face.header;
    const proj = PD_MOD.projectScene(face);
    const app = {
        projection: () => ({ face: { reason: 'ready', text: 'ok', state: 'ready' }, proj, src: null }),
        getSettings: () => ({ showDiagnostics: true }),
        saveSettings: () => {}
    };
    const view = new mod.PlaceView(app);
    const el = { innerHTML: '', querySelector: () => null };
    view.render(el);
    assert.ok(el.innerHTML.includes('上游这版没有层级面'), '★ 层级面缺如实说缺');
    assert.ok(el.innerHTML.includes('上游这版没有到访史面'), '★ 到访史面缺如实说缺');
    assert.ok(el.innerHTML.includes('上游这版没有场景头面'), '★ 场景头面缺如实说缺');
});

test('v310 C3. ★ 到访但未登记的条目显式标注（真缺陷不问不响）', async () => {
    const mod = await import(at(PV));
    const proj = PD_MOD.projectScene(sceneFace({
        visits: [{ key: '梧桐市/丙巷', path: ['梧桐市', '丙巷'], count: 1, firstFloor: 4, lastFloor: 4, registered: false }]
    }));
    const app = {
        projection: () => ({ face: { reason: 'ready', text: 'ok' }, proj, src: null }),
        getSettings: () => ({ showDiagnostics: true }), saveSettings: () => {}
    };
    const view = new mod.PlaceView(app);
    const el = { innerHTML: '', querySelector: () => null };
    view.render(el);
    assert.ok(el.innerHTML.includes('未登记'), '★ 孤儿到访被标出');
});

test('v310 C4. ★ 新样式类有 CSS 支撑（不是裸标记）', () => {
    for (const cls of ['.pl-node', '.pl-node-name', '.pl-node-mark', '.pl-visit', '.pl-visit-mark', '.pl-visit-bad']) {
        assert.ok(new RegExp(cls.replace('.', '\\.') + '\\s*[,{]').test(PC_SRC), '★ 缺样式：' + cls);
    }
});

// ══════════ D 消费点下限 ══════════
test('v310 D1. ★ 三面每面都有真消费点（数据层解析 + 视图渲染 ≥ 2 处）', () => {
    for (const key of ['tree', 'history', 'header']) {
        const inData = (PD_SRC.match(new RegExp('out\\.' + key + '\\s*=', 'g')) || []).length;
        assert.ok(inData >= 1, '★ ' + key + ' 未在投影层落面（声明了却零消费）');
    }
    const viewHits = (PV_SRC.match(/proj\.(tree|history|header)/g) || []).length;
    assert.ok(viewHits >= 3, '★ 视图消费点 ' + viewHits + ' 处（下限 3）');
});

test('v310 D2. ★ 不写回退逻辑：旧桥兼容只在适配层（本 App 不自己判版本）', () => {
    assert.ok(!/LonSha.*version.*[<>]=/.test(PD_SRC), '★ 数据层不得自行比较上游版本号（回退集中在适配层）');
    assert.ok(PD_SRC.includes('hasTreeFace') && PD_SRC.includes('hasHeaderFace'), '★ 用「面在不在」而不是「版本号」判据');
});

// ══════════ E 版本与文档 ══════════
test('v310 E1. ★ 五源同源且不低于 3.1.0', () => {
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

test('v310 E2. ★ 变更说明真讲本版（提场所三面）且与弹窗逐字同源', () => {
    const log = JSON.parse(read('update-log.json'));
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length, '当前版本节须有条目');
    /* [v3.2.0] 交棒：原判据拿 `log.latest` 的条目比「层级 / 到访 / 场景头」三个词，
     *   是**当版精确判定**（本套件出生版本 v3.1.0 的说明自然写这三个词）。
     *   锚 `log.latest` 等于对以后每一版下永久约束 —— v3.2.0 的说明写的是「场景头覆盖度」，
     *   「层级 / 到访」两词不再出现，判据随即翻红。改为仓内既定口径（同 v298-E2 / v300-D2 /
     *   v301-D2 / v302-E2 / v303-D2）：落地项关键词锚**本套件出生版本**，
     *   而「弹窗逐字同源」那半仍锚当版。这不是放宽 —— v311 的 E1/E2 已对当版 3.2.0 精确判定。 */
    const own = log.versions['3.1.0'];
    assert.ok(own && Array.isArray(own.items), 'v3.1.0 条目必须仍在（本判据钉的是历史事实）');
    const all = own.items.join('\n');
    for (const kw of ['层级', '到访', '场景头']) {
        assert.ok(all.includes(kw), '变更说明未提到本版落地项：' + kw);
    }
    const blk = IDX_SRC.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(blk, 'ST_PHONE_CURRENT_UPDATE 可提取');
    for (const item of entry.items) {
        assert.ok(blk[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 24) + '…');
    }
    assert.match(blk[0], new RegExp('date: "' + entry.date + '"'), 'date 同源');
});
// ══════════ F 负控制（真源码破坏 → **整仓镜像** → 同款判据在副本上必须转红）══════════
/* 【为什么必须是整仓镜像而不是一个裸临时目录】
 *   place-data.js 顶部 `import { faceFieldState } from '../../config/world-bridge.js'` 是
 *   **相对路径**。把破坏副本单独写进 os.tmpdir() 时，Node 按副本自身位置解析该相对说明符
 *   ⇒ 解析到 `/config/world-bridge.js` ⇒ ERR_MODULE_NOT_FOUND，负控制跑的不是判据而是
 *   一次加载失败（假红）。本仓 v2.99.0 起已把这一类判据统一为「cpSync 整仓 → 在镜像里
 *   改写目标文件 → 从镜像加载」，本套件沿用同一基建（镜像同时顺带消掉「对仓库原件断言」）。 */
const ORIG = new Map();
for (const f of [PD, PV, PC, IDX]) ORIG.set(f, read(f));

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v310-mir-'));
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
function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ── 判据（纯函数，正负两跑；负控制必须用**同款**判据，不许另写一套宽松断言）── */
/** J1 层级面：四行都在 + 末级 depth/precise 字段对 → 原版 true，破坏后 false */
function jTree(mod) {
    const p = mod.projectScene(sceneFace());
    return Array.isArray(p.tree) && p.tree.length === 4
        && p.tree.some((n) => n.name === '顶层' && n.depth === 4 && n.floor === 3);
}
/** J2 分域面：「没给」与「给了空」必须在 hasXFace 上分开 → 原版 true，破坏后 false */
function jFaceGap(mod) {
    const gone = mod.projectScene((() => { const f = sceneFace(); delete f.header; return f; })());
    const empty = mod.projectScene(sceneFace({ header: null }));
    return gone.hasHeaderFace === false && empty.hasHeaderFace === true;
}
/** J3 「没给该格」不得被读成 0（本版当场捐到的投影层缺陷）→ 原版 true，破坏后 false */
function jNullNotZero(mod) {
    const p = mod.projectScene(sceneFace({ visits: [{ key: '甲/乙', path: ['甲', '乙'], count: 0, firstFloor: null, lastFloor: null }] }));
    return p.history[0].count === 0 && p.history[0].firstFloor === null && p.history[0].lastFloor === null;
}

// C0 阳性对照：未破坏时三条判据必须**全部为真**，否则下面的「转红」是假绿。
test('v310 F0. 镜像树自证 + 阳性对照：未破坏时三条判据全真（否则 F 组是假绿）', () => {
    assert.equal(jTree(PD_MOD), true, 'J1 在原件上必须为真');
    assert.equal(jFaceGap(PD_MOD), true, 'J2 在原件上必须为真');
    assert.equal(jNullNotZero(PD_MOD), true, 'J3 在原件上必须为真（本版修的就是它）');
    const dir = mirror({});
    try {
        assert.ok(fs.existsSync(path.join(dir, 'config', 'world-bridge.js')), '镜像里必须带上相对 import 的落点');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v310 N1. ★ 负控制：把层级解析摘掉 ⇒ **同款判据 J1** 在破坏副本上转红', async () => {
    await withMirror({
        [PD]: (s) => mutateOnce(s, '        out.tree = treeRows(face.tree, maxEntries);', '        out.tree = [];')
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        assert.equal(jTree(broken), false, '★ 同款判据（J1）在副本上必须为 false');
        assert.equal(jTree(PD_MOD), true, '对照：原件上仍为 true（差值来自破坏本身）');
    });
});

test('v310 N2. ★ 负控制：把「没给」与「给了空」压成一态 ⇒ **同款判据 J2** 转红', async () => {
    await withMirror({
        [PD]: (s) => mutateOnce(s,
            "        out.hasHeaderFace = Object.prototype.hasOwnProperty.call(face, 'header');",
            '        out.hasHeaderFace = !!face.header;')
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        assert.equal(jFaceGap(broken), false, '★ 同款判据（J2）在副本上必须为 false');
    });
});

test('v310 N3. ★ 负控制：「没给该格」被读成 0 ⇒ **同款判据 J3** 转红（本版真缺陷的守门人）', async () => {
    /* [v3.3.1·O-8] 破坏锚点交棒：原锚点 `if (v === null || v === undefined || v === '') return null;`
     *   正是 O-8 修掉的那行**弱口径**，已不复存在（锚点消失属于正常交棒，不是判据失效）。
     *   改为更彻底的破坏形态：把门换成 `Number()` 兜底（`Number(null) === 0`、`Number('') === 0`）——
     *   这是本判据要守的那一类缺陷的**最原始形态**，比原来那行弱口径更能代表「没给被读成 0」。 */
    await withMirror({
        [PD]: (s) => mutateOnce(s,
            "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n    if (typeof v === 'string' && !v.trim()) return null;",
            "    if (v === undefined) return null;",
            "    const n = Number(v);")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, PD)).href + '?m=' + Date.now());
        assert.equal(jNullNotZero(broken), false, '★ 同款判据（J3）在副本上必须为 false（null 又被读成 0）');
    });
});
