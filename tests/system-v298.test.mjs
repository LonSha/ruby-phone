/**
 * tests/system-v298.test.mjs — 上游字段三态（present/kind）真正被消费 + 归因文案表键形 [v2.98.0]
 *
 * 本版两个真缺陷（均已取证，不是设计洁癖）：
 *   ① **字段三态零消费**：上游 lonsha v3.174 在 `snapshot.meta.fieldTypes` 里如实声明了每个
 *      顶层字段的「在不在 / 是什么」。而 RubyPhone 侧实测：**零消费**。7 个消费方一律写成
 *      `const x = (snap.k && typeof snap.k === 'object') ? snap.k : null;`，于是
 *        「源里没这项（旧版插件）」 与 「源里给了这项、值是空」
 *      压成同一个 reason（`no-*-face`），文案还告诉用户「需插件较新版本」——
 *      对后一种处境是**事实错误**的归因（插件已最新，只是这一项为空）。
 *      修前实测（本套件 C 组取证脚本可复现）：两种输入产出**逐字相同**的 reason。
 *   ② **归因文案表键形漂移**：clock-view / ledger-view 的 `FACE_META` 键写作
 *      `no_clock_face`（下划线形），而 `CLOCK_REASONS` 的值是 `no-clock-face`（连字符形）
 *      ⇒ 五态里三态查不到，兜底又指向 `bridge_absent`
 *      ⇒「快照不可用」「这版没这面」「桥未连接」**一律显示成「桥未连接」**。
 *      而当时所有判据全绿 —— 因为没有任何判据看键形。
 *
 * 覆盖：
 *   A 结构面：J6/J7 接入同一道门、真仓库全绿、消费点数、视图键取真源常量
 *   B 真源行为面：readPushField 六态 + faceFieldState 优先级裁定 + 幂等/畸形
 *   C 端到端：7 个内核三态分离（修前必红）+ clock/ledger 视图键命中率
 *   D 负控制：真源码破坏 → 副本树上重跑同款真判据必须转红且指向真因
 *   E 版本下限：五源同源 + 不低于 2.98.0
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

/** 七个「面」内核：文件 + 该面对应的上游字段 + 该面的 reason 表导出名 */
const FACES = [
    { file: 'apps/profile/profile-data.js', keys: ['protagonist', 'lifeDetails'], face: 'profile', reasons: 'PROFILE_REASONS', noFace: 'no-profile-face' },
    { file: 'apps/wallet/wallet-data.js', keys: ['moneyLedger'], face: 'wallet', reasons: 'WALLET_REASONS', noFace: 'no-ledger-face' },
    { file: 'apps/chars/chars-data.js', keys: ['characters'], face: 'chars', reasons: 'CHARS_REASONS', noFace: 'no-chars-face' },
    { file: 'apps/place/place-data.js', keys: ['scene'], face: 'place', reasons: 'PLACE_REASONS', noFace: 'no-scene-face' },
    { file: 'apps/plotline/plotline-data.js', keys: ['outline', 'worldProg'], face: 'plotline', reasons: 'PLOTLINE_REASONS', noFace: 'no-plot-face' },
    { file: 'apps/clock/clock-data.js', keys: ['clock'], face: 'clock', reasons: 'CLOCK_REASONS', noFace: 'no-clock-face' },
    { file: 'apps/ledger/ledger-data.js', keys: ['worldLedgerRead'], face: 'ledger', reasons: 'LEDGER_REASONS', noFace: 'no-ledger-face' },
];
const VIEWS = [
    { file: 'apps/clock/clock-view.js', reasons: 'CLOCK_REASONS', bare: ['no_clock_face', 'no_snapshot', 'bridge_absent'] },
    { file: 'apps/ledger/ledger-view.js', reasons: 'LEDGER_REASONS', bare: ['no_ledger_face', 'no_snapshot', 'bridge_absent'] },
];

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v298 A1. J6/J7 落在同一道门（不新开一道：桥消费面本来就该一处收口）', () => {
    const src = read(GATE_REL);
    assert.match(src, /FIELD_READER = 'readPushField'/, '缺 J6 出口名常量');
    assert.match(src, /FACE_STATE_READER = 'faceFieldState'/, '缺 J6 面级出口名常量');
    assert.match(src, /FACE_READER_MIN_CONSUMERS/, '缺 J6 消费点下限（否则「抽出来没人用」无法拦）');
    assert.match(src, /META_TABLE_RE/, '缺 J7 文案表识别');
    assert.match(src, /BARE_SNAKE_KEY_RE/, '缺 J7 手写键识别');
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts.check, /bridge-contract/, 'J6/J7 必须随第九道门进 check 链');
});

test('v298 A2. 真仓库上门禁全绿，且给出 J6/J7 两组读数', () => {
    const out = execFileSync('node', [GATE_REL], { cwd: ROOT, encoding: 'utf8' });
    const m = /faceFieldState 消费点 (\d+) 个/.exec(out);
    assert.ok(m, '未输出 J6 消费点计数：' + out.slice(0, 300));
    assert.ok(Number(m[1]) >= 5, 'faceFieldState 消费点只有 ' + m[1] + ' 个（< 5 即为摆设出口）');
    assert.match(out, /归因文案表手写键 0 张/, 'J7 未给出「手写键 0」结论');
});

test('v298 A3. 真源导出两个三态出口，且形态判定只有这一份', () => {
    const src = read(SRC_REL);
    assert.match(src, /export function readPushField\(snapshot, key\)/, '真源缺 readPushField');
    assert.match(src, /export function faceFieldState\(snapshot, keys\)/, '真源缺 faceFieldState');
    // 产品面不得直接摸 meta.fieldTypes（= 又抄一份三态判据）
    for (const f of FACES.map((x) => x.file)) {
        const s = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.ok(!s.includes('fieldTypes'), f + ' 直接摸了 meta.fieldTypes（应经 faceFieldState）');
    }
});

test('v298 A4. 两个视图的归因文案表键取真源常量（不得手写标识符形）', () => {
    for (const v of VIEWS) {
        const s = read(v.file);
        assert.match(s, new RegExp(`\\[${v.reasons}\\.`), v.file + ' 的 FACE_META 键未取真源常量');
        for (const b of v.bare) {
            assert.ok(!new RegExp(`^\\s+${b}\\s*:`, 'm').test(s),
                v.file + ' 仍在手写键 ' + b + '（形状漂移后查不到、静默走兜底）');
        }
        // 兜底不得指向「桥未连接」——那会把未知态伪装成一个具体结论
        assert.ok(!/FACE_META\[face\] \|\| FACE_META\.bridge_absent/.test(s),
            v.file + ' 兜底仍指向 bridge_absent（未知态被伪装成「桥未连接」）');
    }
});

test('v298 A5. 视图文案表的键与真源常量的值**逐一**对得上（不是只在源码里出现常量名）', async () => {
    for (const v of VIEWS) {
        const mod = await import(pathToFileURL(path.join(ROOT, v.reasons === 'CLOCK_REASONS'
            ? 'apps/clock/clock-data.js' : 'apps/ledger/ledger-data.js')).href);
        const values = Object.values(mod[v.reasons]);
        const src = read(v.file);
        for (const val of values) {
            // 键必须按常量取值写进表：形如 [REASONS.xxx]，且表尾收在 6/7 个键
            assert.ok(val.length > 0);
        }
        // 每个 reason 值都能在表里找到一把「指向它的键」
        const keyRefs = src.match(new RegExp(`\\[${v.reasons}\\.([A-Za-z_]+)\\]`, 'g')) || [];
        assert.ok(keyRefs.length >= values.length,
            v.file + ' 键引用数 ' + keyRefs.length + ' < reason 值数 ' + values.length + '（有态没有文案）');
    }
});

/* ============================================================
 * B. 真源行为面：readPushField 六态
 * ============================================================ */
const SRC = await import(pathToFileURL(path.join(ROOT, SRC_REL)).href);

const ftOf = (entries) => {
    const fieldTypes = {};
    for (const [k, v] of Object.entries(entries)) fieldTypes[k] = v;
    return { meta: { fieldTypes, contract: 'v3.174' } };
};

test('v298 B1. declared-null：上游说「给了这项、值是空」⇒ 与 absent 分开', () => {
    const snap = { protagonist: null, ...ftOf({ protagonist: { present: true, kind: 'null' } }) };
    const r = SRC.readPushField(snap, 'protagonist');
    assert.equal(r.reason, 'declared-null');
    assert.equal(r.present, true, 'present=true 表示「源里给了这项」');
    assert.equal(r.kind, 'null');
});

test('v298 B2. absent：上游说「源里根本没这项」⇒ 与 declared-null 不同形', () => {
    const snap = { ...ftOf({ protagonist: { present: false, kind: 'undefined' } }) };
    const r = SRC.readPushField(snap, 'protagonist');
    assert.equal(r.reason, 'absent');
    assert.equal(r.present, false);
    assert.equal(r.value, undefined);
});

test('v298 B3. value：真有值时带回本体（不是副本）', () => {
    const body = { name: 'A' };
    const snap = { protagonist: body, ...ftOf({ protagonist: { present: true, kind: 'object' } }) };
    const r = SRC.readPushField(snap, 'protagonist');
    assert.equal(r.reason, 'value');
    assert.equal(r.value, body);
});

test('v298 B4. 旧版桥无 fieldTypes ⇒ 如实报 legacy-null，不硬猜三态', () => {
    const r = SRC.readPushField({ protagonist: null }, 'protagonist');
    assert.equal(r.reason, 'legacy-null', '两种处境本就无从分辨 ⇒ 如实标出来，不得伪造成 declared-null');
    const r2 = SRC.readPushField({ protagonist: { name: 'A' } }, 'protagonist');
    assert.equal(r2.reason, 'legacy-value');
    assert.deepEqual(r2.value, { name: 'A' });
});

test('v298 B5. 畸形入参不抛（快照非对象 / 键非字符串 / meta 畸形 / getter 抛错）', () => {
    const bad = { meta: { get fieldTypes() { throw new Error('boom'); } } };
    assert.equal(SRC.readPushField(null, 'x').reason, 'no-snapshot');
    assert.equal(SRC.readPushField('nope', 'x').reason, 'no-snapshot');
    assert.equal(SRC.readPushField({}, '').reason, 'no-snapshot');
    assert.equal(SRC.readPushField({}, 42).reason, 'no-snapshot');
    assert.equal(SRC.readPushField(bad, 'x').reason, 'no-snapshot');
    assert.equal(SRC.readPushField({ meta: { fieldTypes: 'nope' } }, 'x').reason, 'legacy-null');
});

test('v298 B6. faceFieldState 裁定优先级：present > absent > legacy-unknown > declared-empty', () => {
    // 任一有值 ⇒ present（最强证据）
    assert.equal(SRC.faceFieldState({ a: { x: 1 }, ...ftOf({ a: { present: true, kind: 'object' } }) }, ['a']), 'present');
    // 任一被声明 absent ⇒ absent（比「旧版读不出」更确定）
    assert.equal(SRC.faceFieldState({
        a: null, ...ftOf({ a: { present: false, kind: 'undefined' } }),
    }, ['a']), 'absent');
    // 有 legacy 字段（旧版桥，无 meta）⇒ legacy-unknown，不硬猜
    assert.equal(SRC.faceFieldState({ a: null, b: null }, ['a', 'b']), 'legacy-unknown');
    // 全部 declared-null ⇒ declared-empty（这才是「声明了、就是空」）
    assert.equal(SRC.faceFieldState({
        a: null, b: null, ...ftOf({ a: { present: true, kind: 'null' }, b: { present: true, kind: 'null' } }),
    }, ['a', 'b']), 'declared-empty');
    assert.equal(SRC.faceFieldState({}, []), 'legacy-unknown');
    assert.equal(SRC.faceFieldState(null, ['a']), 'legacy-unknown');
});

/* ============================================================
 * C. 端到端：7 个内核三态分离（修前必红）
 * ============================================================ */
const BODY_KEYS = ['protagonist', 'lifeDetails', 'characters', 'moneyLedger', 'outline', 'worldProg', 'clock', 'scene', 'worldLedgerRead'];

function snapAbsent() { return { version: 1, bridge: 'lonsha_memory_bridge_v1', floor: 5 }; }
function snapDeclaredEmpty() {
    const ft = {}; const body = {};
    for (const k of BODY_KEYS) { body[k] = null; ft[k] = { present: true, kind: 'null' }; }
    return { version: 1, bridge: 'lonsha_memory_bridge_v1', floor: 5, ...body, meta: { fieldTypes: ft, contract: 'v3.174' } };
}

/** 走各内核的「面」入口；clock/ledger 的第二参就是快照本体 */
async function faceReasonOf(face, snap) {
    const mod = await import(pathToFileURL(path.join(ROOT, face.file)).href);
    if (face.face === 'profile') return mod.readProfileFace({ mounted: true, hasSnapshot: true, snapshot: snap }).reason;
    if (face.face === 'wallet') return mod.readWalletFace({ mounted: true, hasSnapshot: true, snapshot: snap }).reason;
    if (face.face === 'chars') return mod.readCharsFace({ mounted: true, hasSnapshot: true, snapshot: snap }).reason;
    if (face.face === 'place') return mod.readSceneFace({ mounted: true, hasSnapshot: true, snapshot: snap }).reason;
    if (face.face === 'plotline') return mod.readPlotlineFace({ mounted: true, hasSnapshot: true, snapshot: snap }).reason;
    if (face.face === 'clock') return mod.readClockFace({ mounted: true, hasSnapshot: true, snapshot: snap, clock: snap.clock }, snap);
    return mod.readLedgerFace({ mounted: true, hasSnapshot: true, snapshot: snap, ledger: snap.worldLedgerRead }, snap);
}

test('v298 C1. 七面：字段缺席 ⇒ 仍是「没这面」（旧版插件的提示口径不变）', async () => {
    for (const face of FACES) {
        const r = await faceReasonOf(face, snapAbsent());
        assert.equal(r, face.noFace, face.file + ' 对「源里没这项」应报 ' + face.noFace + '，实报 ' + r);
    }
});

test('v298 C2. 七面：上游声明了该面但值为空 ⇒ 必须与「没这面」分开（本版修的缺陷）', async () => {
    for (const face of FACES) {
        const r = await faceReasonOf(face, snapDeclaredEmpty());
        assert.notEqual(r, face.noFace,
            face.file + ' 把「上游声明了、值为空」误报成「没这面」——文案会误导用户去升级插件');
        assert.equal(r, 'upstream-empty', face.file + ' 应报 upstream-empty，实报 ' + r);
    }
});

test('v298 C3. 七面：真有值 ⇒ ready / empty（三态之外的正常路径不被扰动）', async () => {
    const snap = {
        version: 1, bridge: 'lonsha_memory_bridge_v1', floor: 5,
        protagonist: { name: 'A' },
        lifeDetails: [{ text: 'x', tier: 'active' }],
        characters: { A: { fields: {} } },
        moneyLedger: { money: { cash: 1 }, moneyLog: [] },
        outline: { stage: { title: 't' } },
        worldProg: { promises: [{ text: 'p' }] },
        clock: { date: '2026-09-13' },
        scene: { empty: true },
        worldLedgerRead: { ok: true, counts: {} },
    };
    const want = { profile: 'ready', wallet: 'ready', chars: 'ready', place: 'empty', plotline: 'ready', clock: 'ready', ledger: 'ready' };
    for (const face of FACES) {
        const r = await faceReasonOf(face, snap);
        assert.equal(r, want[face.face], face.file + ' 有值时应报 ' + want[face.face] + '，实报 ' + r);
    }
});

/* ============================================================
 * D. 负控制：真源码破坏 → 副本树上重跑同款真判据必须转红
 *    （判据必须因破坏而红；不得因缺文件 / 畸形而红）
 * ============================================================ */
const STAGE_FILES = [
    'package.json',
    'manifest.json',
    'update-log.json',
    'index.js',
    GATE_REL,
    SRC_REL,
    ...FACES.map((f) => f.file),
    ...VIEWS.map((v) => v.file),
    // readPushProbe 的真实消费方也必须进副本树：否则 J3 在副本上读到「消费点 0」，
    // 副本树会因缺文件而红 —— 那是本仓明令禁止的「因缺文件而红」，负控制即假绿。
    'apps/place/place-app.js',
    'apps/wallet/wallet-app.js',
    'apps/profile/profile-app.js',
    'apps/plotline/plotline-app.js',
    'apps/chars/chars-app.js',
    'apps/clock/clock-app.js',
    'apps/ledger/ledger-app.js',
    'apps/memory/global-search-engine.js',
    'apps/dirtytalk/dirtytalk-app.js',
    // [v3.0.1] 第九道门新增 J8/J9 后的同步：J9 的**唯一**结构化落点在本文件，
    // J8 的四个业务消费点里也有本文件（诊断内核）一个。副本树是**显式白名单暂存**
    // （不是 v299 起的全量镜像），不放它就会在未破坏的副本树上读到「J9 消费点 0」而红
    // —— 那正是本组注释开头明令禁止的「因缺文件而红」，会让 D0 自证失败、整组负控制变假绿。
    'apps/diagnose/diagnose-data.js',
    // [v3.0.2] 第九道门新增 J10（上游注入读数真被业务面消费），本仓两个消费点里的
    // 第二个就在这里。白名单暂存型套件必须同步补上每条判据的读数来源，
    // 否则未破坏的副本树会在 J10 上红（D0 自证失败 ⇒ 整组负控制变假绿）。
    'apps/timeweaver/timeweaver-collector.js',
    // [v3.20.2] 第九道门新增 J13（上游检查点内容级对照真被业务面消费）：真源是
    // `config/checkpoint-content-contract.js`（不放入 ⇒ 副本树上四出口全缺 ⇒ 判 corrupt 拒判），
    // 消费点就在上面的诊断内核里。白名单暂存型套件必须同步补上每条判据的读数来源
    // —— 否则未破坏的副本树会在 J13 上红（D0 自证失败 ⇒ 整组负控制变假绿）。
    'config/checkpoint-content-contract.js',
];

function stageTree(extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v298-tree-'));
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

/** 在副本树上跑门禁（RP_BRIDGE_FIXTURE=1 只放宽 J5 扫描面下限，不放宽 J6/J7） */
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

test('v298 D0. 副本树自身全绿（否则负控制是假绿）', () => {
    const dir = stageTree();
    try {
        const r = runGate(dir);
        assert.equal(r.ok, true, '未破坏的副本树必须通过：' + r.err);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v298 D1. 负控制：视图键改回手写形 → J7 红灯并点名该表', () => {
    const broken = replaceOnce(read('apps/clock/clock-view.js'),
        '  [CLOCK_REASONS.no_clock_face]:',
        '  no_clock_face:');
    const dir = stageTree({ 'apps/clock/clock-view.js': broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '手写键必须红灯');
        assert.match(r.err, /J7/, '红灯须指向 J7 判据');
        assert.match(r.err, /clock-view\.js/, '红灯须点名该文件');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v298 D2. 负控制：faceFieldState 消费点降到下限以下 → J6 红灯', () => {
    /* [v3.0.1] 破坏面须随**真消费点数**同步：本案是「把消费点数压到下限 5 以下」，
     *   而下限是绝对值、真消费点数却会长 —— 本版白名单补入 `apps/diagnose/diagnose-data.js`
     *   （J9 的落点，见 STAGE_FILES 注释）后，副本树上的消费点由 7 升到 8，
     *   原来破坏 3 个只剩 5，恰好**不低于**下限 5 ⇒ 负控制静默失效（红不了）。
     *   故破坏面同步加到 4 个：8 - 4 = 4 < 5，判据才真被触到。
     *   这类「判据阈值与真读数之间的余量被侵蚀」是负控制最常见的静默失效形态之一。 */
    const extra = {};
    for (const f of ['apps/chars/chars-data.js', 'apps/place/place-data.js',
        'apps/plotline/plotline-data.js', 'apps/clock/clock-data.js']) {
        extra[f] = read(f).split('faceFieldState(').join('__removed__(');
    }
    const dir = stageTree(extra);
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '消费点不足必须红灯');
        assert.match(r.err, /J6/, '红灯须指向 J6 判据');
        assert.match(r.err, /只有 4 个产品侧调用点/, '读数应真降到 4（8-4）');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v298 D3. 负控制：真源字段三态出口被改名 → J6 拒判（不是红一条，是拒判）', () => {
    const broken = replaceOnce(read(SRC_REL),
        'export function faceFieldState(snapshot, keys) {',
        'function _faceFieldStateRenamed(snapshot, keys) {');
    const dir = stageTree({ [SRC_REL]: broken });
    try {
        const r = runGate(dir);
        assert.equal(r.ok, false, '出口改名必须红灯');
        assert.match(r.err, /J6/, '红灯须指向 J6 判据');
        assert.match(r.err, /faceFieldState/, '红灯须点名该出口');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v298 D4. 负控制：内核把 declared-empty 判据删掉 → C2 的真判据在副本上转红', async () => {
    const broken = read('apps/place/place-data.js').split(
        "if (faceFieldState(snap, ['scene']) === 'declared-empty') {").join('if (false) {');
    assert.notEqual(broken, read('apps/place/place-data.js'), '破坏未发生（锚点没命中）');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v298-c2-'));
    try {
        for (const rel of ['apps/place/place-data.js', SRC_REL]) {
            const abs = path.join(dir, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, rel === SRC_REL ? read(SRC_REL) : broken);
        }
        const mod = await import(pathToFileURL(path.join(dir, 'apps/place/place-data.js')).href
            + '?brk=' + Date.now());
        const r = mod.readSceneFace({ mounted: true, hasSnapshot: true, snapshot: snapDeclaredEmpty() }).reason;
        assert.equal(r, 'no-scene-face',
            '判据被删后副本必须退回旧行为（旧的错报），这正是 C2 断言要拦的那个值，实报 ' + r);
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

test('v298 E1. 版本不低于 2.98.0 且五源同源', () => {
    const log = JSON.parse(read('update-log.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, manifest.version);
    assert.equal(manifest.version, pkg.version);
    assert.equal(pkg.version, m[1]);
    assert.equal(atLeast(log.latest, '2.98.0'), true, `版本 ${log.latest} < 2.98.0`);
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
    assert.equal(entry.version, log.latest, '版本节内 version 须与 latest 同源');
});

test('v298 E2. 发布说明与本版实现同域（申明里不得漏掉新增出口与新增判据）', () => {
    /* 【实测修】原写 `log.versions[log.latest]`：那把「v2.98 的发布说明必须提到 J6/J7」
     *   变成了**对以后每一版的永久约束**（v2.99 的说明里自然不会重复上一版的判据名）。
     *   契约：发布说明的同域性必须**锚它自己的版本**，不随升版漂移（同 v255 C4 / v256 C4 的「锚自身版本」口径）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = log.versions['2.98.0'];
    assert.ok(own && Array.isArray(own.items), 'v2.98.0 条目必须仍在（本判据钉的是历史事实）');
    const items = own.items.join('\n');
    assert.match(items, /readPushField|faceFieldState|字段三态/, '发布说明未提及字段三态消费');
    assert.match(items, /J6|J7/, '发布说明未提及新增判据');
});
