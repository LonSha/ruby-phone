/**
 * tests/system-v297.test.mjs — 桥消费面收敛到单一真源 + clock/ledger 桥读取真缺陷 [v2.97.0]
 *
 * 本版两个目标：
 *   ① **修一个真缺陷**（功能性失效，已取证）：clock / ledger 的 probeBridge() 把**推送型**桥的
 *      `snapshot`（对象）当函数调用 —— `bridge.snapshot ? bridge.snapshot() : null` ——
 *      必然抛 TypeError 并被 `catch (_e) { snap = null; }` 吞掉，于是 snap 恒为 null、
 *      两个 App 永久显示「桥在但没快照」，哪怕桥里躺着完整快照。
 *      取证（修复前实测）：桥梁实际有快照 = true，而 CLOCK / LEDGER 的 probeBridge 报
 *      `hasSnapshot:false`、face = `no-snapshot`。
 *   ② **把「同一口径只许一份实现」落成机制**：新增第九道门 `scripts/bridge-contract-audit.mjs`，
 *      钉住「桥名单一真源 / 禁止 `.snapshot(` 调用式 / 禁止自写形态判据 / 出口必须真被消费」。
 *      修前实测漂移：桥名字面量 9 处、调用式 2 处、自写形态判据 7 处。
 *
 * 覆盖：
 *   A 结构面：门禁接入 check 链、真仓库全绿、门禁自证（fail-closed 开关在场）、9 个消费方
 *   B 真源行为面：push / refresh 回落 / 拉取型 / 无桥畸形 四形态
 *   C 端到端：七个 App 的 probeBridge + clock/ledger 的**缺陷回归**（修前必红）
 *   D 负控制：四条真源码破坏 → 在**副本树**上重跑同款真判据必须转红，且信息指向真原因
 *   E 版本下限：五源同源 + 不低于 2.97.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GATE_REL = 'scripts/bridge-contract-audit.mjs';
const SRC_REL = 'config/world-bridge.js';
const CONSUMERS = [
    'apps/place/place-app.js',
    'apps/wallet/wallet-app.js',
    'apps/profile/profile-app.js',
    'apps/plotline/plotline-app.js',
    'apps/chars/chars-app.js',
    'apps/clock/clock-app.js',
    'apps/ledger/ledger-app.js',
    'apps/memory/global-search-engine.js',
    'apps/dirtytalk/dirtytalk-app.js',
];

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v297 A1. 门禁接入 check 链（否则等于没做）', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.scripts['bridge-contract'], 'package.json 缺 bridge-contract 脚本');
    assert.match(pkg.scripts.check, /bridge-contract/, 'check 链未包含 bridge-contract');
    assert.ok(fs.existsSync(path.join(ROOT, GATE_REL)), '门禁脚本不存在');
});

test('v297 A2. 真仓库上门禁全绿，且给出「消费点真有 9 个」的读数', () => {
    const out = execFileSync('node', [GATE_REL], { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /桥名自持点 0/, '未给出「桥名单一真源」结论');
    assert.match(out, /自写形态 0/, '未给出「自写形态绝迹」结论');
    const m = /readPushProbe 消费点 (\d+) 个/.exec(out);
    assert.ok(m, '未输出消费点计数：' + out.slice(0, 200));
    assert.ok(Number(m[1]) >= 7, '消费点只有 ' + m[1] + ' 个（< 7 即为摆设出口）');
});

test('v297 A3. 门禁自证：扫描面下限 + 真源逐名 1 次 + 判据锚点齐备', () => {
    const src = read(GATE_REL);
    assert.match(src, /MIN_PRODUCT_FILES/, '缺「扫描面下限」自证（探测器失效时不许零命中全绿）');
    assert.match(src, /RP_BRIDGE_FIXTURE/, '缺夹具开关（副本树运行须显式声明）');
    assert.match(src, /countOf\(sourceCode, lit\) === 1/, '缺「真源逐名恰好 1 次」自证');
    assert.match(src, /lonsha_memory_bridge_v1/, '缺桥名口径');
    assert.match(src, /worldaxis_bridge_v1/, '缺桥名口径（worldaxis）');
    assert.match(src, /sourceHasExport/, '缺出口在场检查（J3）');
    // 这两个锚点必须**逐字**等于门禁源码里的正则字面量形态。
    //   首版写成 /\.snapshot\\s\*\(/ 是过度转义（匹配的是反斜杠本身，不是源码里的 `\.snapshot\s*\(`），
    //   于是 J2/J4 判据明明在场却假红 —— 判据锚点写错与判据缺失必须能分开。
    assert.ok(src.includes('/\\.snapshot\\s*\\(/'), '缺 .snapshot( 调用式判据（J2）');
    assert.ok(src.includes('/\\bsnapshot\\s*&&\\s*typeof'), '缺自写形态判据（J4）');
});

test('v297 A4. 9 个消费方全部改走真源，且不再自持桥名字面量', () => {
    const src = read(SRC_REL);
    assert.match(src, /export function readPushProbe\(/, '真源缺出口 readPushProbe');
    // 只在**去注释**的源码上判「自持桥名」：本仓注释大量逐字提到桥名（说明文档），
    //   把注释算进来就会产生「文本包含式假红」——本仓明令禁止的判据形态。
    const stripComments = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const f of CONSUMERS) {
        const s = read(f);
        assert.match(s, /readPushProbe\(/, f + ' 未改为经真源读桥');
        assert.ok(!stripComments(s).includes('lonsha_memory_bridge_v1'), f + ' 仍自持桥名字面量');
        assert.ok(!/\.snapshot\s*\(/.test(stripComments(s)), f + ' 仍在使用 .snapshot( 调用式');
    }
});

/* ============================================================
 * B. 真源行为面
 * ============================================================ */
const SRC = await import(pathToFileURL(path.join(ROOT, SRC_REL)).href);
const WIN_BACKUP = Object.getOwnPropertyDescriptor(globalThis, 'window');
/**
 * [v2.97.0] 必须 async-aware。首版写法 `try { return fn(); } finally {…}` 在 fn 为 async 时
 * **立刻**执行 finally —— `await import(...)` 刚把控制权交出去，window 就被还原了，
 * 于是测试体里的探针读到的是空全局（C4 首跑：`mounted: false !== true` 就是这么红的）。
 * 结论：包 window 的工具函数要么 await 回调，要么别用 finally 还原。
 */
const withWin = async (obj, fn) => {
    globalThis.window = obj;
    try { return await fn(); } finally {
        if (WIN_BACKUP) Object.defineProperty(globalThis, 'window', WIN_BACKUP);
        else delete globalThis.window;
    }
};

test('v297 B1. 推送型桥：snapshot 是对象 ⇒ kind=push、hasSnapshot=true、带回本体本身', () => {
    const snap = { clock: { date: '9月17日' }, worldLedgerRead: { ok: true } };
    const p = SRC.readPushProbe({ lonsha_memory_bridge_v1: { snapshot: snap, sourceState: 'ready', lastError: null } });
    assert.equal(p.mounted, true);
    assert.equal(p.kind, 'push');
    assert.equal(p.hasSnapshot, true);
    assert.equal(p.snapshot, snap, '必须带回快照本体（不是副本、不是 null）');
    assert.equal(p.reason, 'ready');
    assert.equal(p.sourceState, 'ready', '上游 v3.174 的来源态必须如实带出（下游可归因）');
    assert.equal(p.lastError, null);
});

test('v297 B2. 推送型无快照但有 refresh ⇒ 回落 refresh（旧版桥不静默丢数据）', () => {
    const produced = { scene: { currentLine: '码头' } };
    const p = SRC.readPushProbe({ lonsha_memory_bridge_v1: { refresh: () => produced } });
    assert.equal(p.kind, 'unknown', '无 snapshot 属性 ⇒ 形态未知（不硬猜 push）');
    assert.equal(p.hasSnapshot, true);
    assert.equal(p.snapshot, produced);
});

test('v297 B3. 拉取型桥只在自述已发布时才拉（不把对方的记账刷脏）', () => {
    let calls = 0;
    const fn = () => { calls++; return { worldClock: { iso: '2026-09-17' } }; };
    const p1 = SRC.readPushProbe({ worldaxis_bridge_v1: { snapshot: fn, stat: () => ({ published: true }) } });
    assert.equal(p1.kind, 'pull');
    assert.equal(typeof p1.snapshot, 'object', '自述已发布 ⇒ 真拉且拿到快照');
    assert.equal(calls, 1);
    const before = calls;
    SRC.readPushProbe({ lonsha_memory_bridge_v1: { snapshot: fn, stat: () => ({ published: false }) } });
    assert.equal(calls, before, '未发布时不得去拉（否则会把对方的拒绝记账刷脏）');
});

test('v297 B3b. 统一探针探**两个**桥：lonsha 不在时读 worldaxis（v2.97.0 加的第二台）', () => {
    const produced = { worldClock: { iso: '2026-09-17' } };
    const p = SRC.readPushProbe({ worldaxis_bridge_v1: { snapshot: () => produced, stat: () => ({ published: true }) } });
    assert.equal(p.id, 'worldaxis_bridge_v1', '快照是谁家的必须如实标注（两台桥不许混成一份读数）');
    assert.equal(p.kind, 'pull');
    assert.equal(p.hasSnapshot, true);
    assert.equal(p.snapshot, produced);
});

test('v297 B3c. 两台桥都在 ⇒ 按固定序取第一台（读数可复现，不随探测顺序漂移）', () => {
    const lo = { scene: { currentLine: '老城 › 钟楼' } };
    const wa = { worldClock: { iso: '2026-09-17' } };
    const p = SRC.readPushProbe({
        lonsha_memory_bridge_v1: { snapshot: lo },
        worldaxis_bridge_v1: { snapshot: () => wa, stat: () => ({ published: true }) },
    });
    assert.equal(p.id, 'lonsha_memory_bridge_v1');
    assert.equal(p.snapshot, lo);
});

test('v297 B3d. 桥都不在 ⇒ id 仍如实（不虚报谁在场，mounted=false）', () => {
    const p = SRC.readPushProbe({});
    assert.equal(p.id, 'lonsha_memory_bridge_v1', 'id 回落到固定序第一台，但不得谎报在场');
    assert.equal(p.mounted, false);
    assert.equal(p.hasSnapshot, false);
});

test('v297 B4. 无桥 / 桥畸形 / getter 抛错一律降级，绝不外抛', () => {
    const a = SRC.readPushProbe({});
    assert.equal(a.mounted, false);
    assert.equal(a.reason, 'not-mounted');
    assert.equal(a.snapshot, null);
    assert.equal(SRC.readPushProbe({ lonsha_memory_bridge_v1: 'not-an-object' }).mounted, false);
    const c = SRC.readPushProbe({ lonsha_memory_bridge_v1: { get snapshot() { throw new Error('boom'); } } });
    assert.equal(c.mounted, true, 'getter 抛错也必须降级为「无快照」，而不是把异常外抛');
    assert.equal(c.snapshot, null);
});

test('v297 B5. 上游 sourceState / lastError 如实带出（旧版无字段 ⇒ null，不伪造）', () => {
    const b = { snapshot: { clock: {} }, sourceState: 'thrown', lastError: 'engine exploded' };
    const p = SRC.readPushProbe({ lonsha_memory_bridge_v1: b });
    assert.equal(p.sourceState, 'thrown');
    assert.equal(p.lastError, 'engine exploded');
    const old = SRC.readPushProbe({ lonsha_memory_bridge_v1: { snapshot: {} } });
    assert.equal(old.sourceState, null, '旧版桥无该字段必须如实 null');
    assert.equal(old.lastError, null);
});

/* ============================================================
 * C. 端到端：七个 App 的探针 + clock/ledger 缺陷回归
 * ============================================================ */
test('v297 C1. clock：真桥有快照 ⇒ face 不再是 no-snapshot（本版修的缺陷）', async () => {
    const { ClockApp } = await import(pathToFileURL(path.join(ROOT, 'apps/clock/clock-app.js')).href);
    await withWin({ lonsha_memory_bridge_v1: { snapshot: { clock: { date: '9月17日', label: '傍晚' } } } }, async () => {
        const app = new ClockApp({}, null);
        app.probeBridge();
        const p = app._probe;
        assert.equal(p.hasBridge, true);
        assert.equal(p.hasSnapshot, true, '桥里有快照就必须读到（修前恒为 false）');
        assert.equal(app.clockFace(), 'ready');
    });
});

test('v297 C2. ledger：真桥有快照 ⇒ face 不再是 no-snapshot（本版修的缺陷）', async () => {
    const { LedgerApp } = await import(pathToFileURL(path.join(ROOT, 'apps/ledger/ledger-app.js')).href);
    await withWin({ lonsha_memory_bridge_v1: { snapshot: { worldLedgerRead: { ok: true, counts: { currents: 3, facts: 12, people: 5, opinionCanon: 2, opinionForum: 1 } } } } }, async () => {
        const app = new LedgerApp({}, null);
        app.probeBridge();
        assert.equal(app._probe.hasSnapshot, true, '桥里有快照就必须读到（修前恒为 false）');
        assert.equal(app.ledgerFace(), 'ready');
    });
});

test('v297 C3. clock/ledger 无桥时仍如实报 bridge-absent（降级不能反向塌成 ready）', async () => {
    const { ClockApp } = await import(pathToFileURL(path.join(ROOT, 'apps/clock/clock-app.js')).href);
    const { LedgerApp } = await import(pathToFileURL(path.join(ROOT, 'apps/ledger/ledger-app.js')).href);
    await withWin({}, async () => {
        const c = new ClockApp({}, null);
        c.probeBridge();
        assert.equal(c.clockFace(), 'bridge-absent');
        const l = new LedgerApp({}, null);
        l.probeBridge();
        assert.equal(l.ledgerFace(), 'bridge-absent');
    });
});

test('v297 C4. 五个 App 的探针形状与真源一致（mounted / hasSnapshot / snapshot）', async () => {
    const snap = {
        scene: { currentLine: '老城 › 钟楼' },
        moneyLedger: { money: {}, moneyLog: [] },
        protagonist: { 姓名: '林晚照' },
        lifeDetails: [],
        outline: { stage: {} },
        worldProg: {},
        characters: { A: { fields: {} } },
    };
    const cases = [
        ['apps/place/place-app.js', 'PlaceApp'],
        ['apps/wallet/wallet-app.js', 'WalletApp'],
        ['apps/profile/profile-app.js', 'ProfileApp'],
        ['apps/plotline/plotline-app.js', 'PlotlineApp'],
        ['apps/chars/chars-app.js', 'CharsApp'],
    ];
    await withWin({ lonsha_memory_bridge_v1: { snapshot: snap } }, async () => {
        for (const [f, cls] of cases) {
            const mod = await import(pathToFileURL(path.join(ROOT, f)).href);
            const app = new mod[cls]({ getContentContainer: () => null }, null);
            const p = app.probeBridge();
            assert.equal(p.mounted, true, f + ' mounted');
            assert.equal(p.hasSnapshot, true, f + ' hasSnapshot');
            assert.equal(p.snapshot, snap, f + ' 必须拿到同一份快照本体');
        }
    });
});

test('v297 C5. 搜索内核与撩语 App 经真源读到桥（不是各自摸 window）', async () => {
    const eng = await import(pathToFileURL(path.join(ROOT, 'apps/memory/global-search-engine.js')).href);
    const dta = await import(pathToFileURL(path.join(ROOT, 'apps/dirtytalk/dirtytalk-app.js')).href);
    const snap = { scene: { currentLine: '老城 › 钟楼 › 顶层', presence: [], empty: false } };
    await withWin({ lonsha_memory_bridge_v1: { snapshot: snap } }, () => {
        const storage = { get: () => null, set: () => {} };
        const sources = eng.buildDefaultSources(storage);
        const place = sources.find((s) => s.id === 'place');
        assert.ok(place, '搜索内核缺 place 源');
        assert.ok(place.items().length > 0, '桥在 ⇒ 搜索内核必须读到 place 面');
        const dt = new dta.DtApp({}, storage);   // 真类名是 DtApp（export class DtApp），不是 DirtyTalkApp
        const hints = dt.sceneStyleHints();
        assert.ok(hints && Array.isArray(hints.chain), '撩语场景联动必须读到位置链');
        assert.equal(hints.chain.join('/'), '老城/钟楼/顶层');
    });
});

/* ============================================================
 * D. 负控制：真源码破坏 → 副本树重跑同款真判据必须转红
 * ============================================================ */
const STAGE_FILES = [
    'package.json',
    GATE_REL,
    SRC_REL,
    ...CONSUMERS,
    'apps/clock/clock-data.js',
    'apps/ledger/ledger-data.js',
    'apps/place/place-data.js',
    'apps/wallet/wallet-data.js',
    'apps/profile/profile-data.js',
    'apps/plotline/plotline-data.js',
    'apps/chars/chars-data.js',
    // [v3.0.1] 第九道门新增 J9（探针自述面真被读出并落下成面），它的**唯一**结构化落点就在
    // 本文件里。副本树是**显式白名单暂存**（不是 v299 起的全量镜像），故门禁读到的消费面
    // 完全取决于白名单里放了什么：不放本文件，J9 就会在未破坏的副本树上读到「0 个消费点」而红
    // —— 那正是 v298 D 组注释明令禁止的「因缺文件而红」（会让 D0 自证失败、整组负控制变成假绿）。
    // 教训：门禁每长一条判据，所有「白名单暂存」型套件都要同步补上该判据的读数来源。
    'apps/diagnose/diagnose-data.js',
    // [v3.0.2] 第九道门新增 J10（上游注入读数真被业务面消费），本仓两个消费点里的
    // 第二个就在这里。白名单暂存型套件必须同步补上每条判据的读数来源，
    // 否则未破坏的副本树会在 J10 上红（D0 自证失败 ⇒ 整组负控制变假绿）。
    'apps/timeweaver/timeweaver-collector.js',
];

function stageTree(extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v297-tree-'));
    for (const rel of STAGE_FILES) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, read(rel));
    }
    for (const [rel, content] of Object.entries(extra)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    return dir;
}

/** 在副本树上跑门禁（夹具开关只放宽扫描面下限，不放宽判据） */
function runGate(dir) {
    try {
        const out = execFileSync('node', [GATE_REL], {
            cwd: dir, encoding: 'utf8',
            env: { ...process.env, RP_BRIDGE_FIXTURE: '1' },
        });
        return { ok: true, out, err: '' };
    } catch (e) {
        return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || '') };
    }
}

const replaceOnce = (s, from, to) => {
    const n = s.split(from).length - 1;
    assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
    return s.replace(from, to);
};

test('v297 D0. 副本树自身全绿（否则负控制是假绿）', () => {
    const dir = stageTree();
    try {
        const r = runGate(dir);
        assert.equal(r.ok, true, '未破坏的副本树必须通过：' + r.err);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v297 D1. 负控制：消费方恢复自持桥名字面量 → J1 红灯点名该文件', () => {
    const broken = replaceOnce(read('apps/clock/clock-app.js'),
        "import { readPushProbe } from '../../config/world-bridge.js';",
        "const BRIDGE_ID = 'lonsha_memory_bridge_v1';");
    const dir = stageTree({ 'apps/clock/clock-app.js': broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '自持桥名后必须红灯');
        assert.match(r.err, /J1/, '红灯须指向 J1 判据');
        assert.match(r.err, /clock-app\.js/, '红灯须点名该文件');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v297 D2. 负控制：把推送型桥的 snapshot 当函数调用 → J2 红灯（本版修掉的那个形态）', () => {
    const broken = replaceOnce(read('apps/ledger/ledger-app.js'),
        '    const snap = p.snapshot;',
        "    const snap = (window.lonsha_memory_bridge_v1 || {}).snapshot ? window.lonsha_memory_bridge_v1.snapshot() : null;");
    const dir = stageTree({ 'apps/ledger/ledger-app.js': broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '调用式读桥必须红灯');
        assert.match(r.err, /J2/, '红灯须指向 J2 判据');
        assert.match(r.err, /ledger-app\.js/, '红灯须点名该文件');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v297 D3. 负控制：抽掉真源出口 → J3 拒判（消费方会全数失联）', () => {
    const broken = replaceOnce(read(SRC_REL),
        'export function readPushProbe(win) {',
        'function _readPushProbeRenamed(win) {');
    const dir = stageTree({ [SRC_REL]: broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '出口被改名必须红灯');
        assert.match(r.err, /J3/, '红灯须指向 J3 判据');
        assert.match(r.err, /readPushProbe/, '红灯须点名该出口');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v297 D4. 负控制：消费方重新自写形态判据 → J4 红灯（重复实现的种子）', () => {
    const broken = replaceOnce(read('apps/place/place-app.js'),
        '        const p = readPushProbe(this._win());',
        "        const b = this._win().lonsha_memory_bridge_v1;\n        const p = { mounted: !!b, hasSnapshot: !!(b.snapshot && typeof b.snapshot === 'object'), snapshot: b.snapshot };");
    const dir = stageTree({ 'apps/place/place-app.js': broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '自写形态判据必须红灯');
        assert.match(r.err, /J4/, '红灯须指向 J4 判据');
        assert.match(r.err, /place-app\.js/, '红灯须点名该文件');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v297 D5. 负控制：门禁自己的桥名口径被改坏 → J5/自证拒判（不许零命中全绿）', () => {
    const broken = replaceOnce(read(GATE_REL),
        "const BRIDGE_LITERALS = Object.freeze(['lonsha_memory_bridge_v1', 'worldaxis_bridge_v1']);",
        "const BRIDGE_LITERALS = Object.freeze(['no_such_bridge_zzz']);");
    const dir = stageTree({ [GATE_REL]: broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '桥名口径被改坏必须拒判');
        assert.match(r.err, /J1|J3/, '红灯须指向被改坏的判据');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* ============================================================
 * E. 版本下限
 * ============================================================ */
function vnum(v) { return String(v || '').split('.').map((n) => Number.parseInt(n, 10) || 0); }
function atLeast(v, floor) {
    const a = vnum(v), b = vnum(floor);
    for (let i = 0; i < 3; i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return true;
}
test('v297 E. 版本不低于 2.97.0 且五源同源', () => {
    const log = JSON.parse(read('update-log.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, manifest.version);
    assert.equal(manifest.version, pkg.version);
    assert.equal(pkg.version, m[1]);
    assert.equal(atLeast(log.latest, '2.97.0'), true, `版本 ${log.latest} < 2.97.0`);
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
});
