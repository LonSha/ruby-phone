// tests/system-v3202.test.mjs — 上游检查点「内容级只读对照」的下游消费面 [v3.20.2]
//
//   【本版治的欠债】
//     上游 lonsha-memory-plugin v3.252.0（F7 首阶段）交付了 `diffPayloadsDeep` 与引擎侧
//     `compareBranchCheckpointsDeep` / `checkpointContentDiffLines` —— 即「同键同长度但值不同」
//     （「余额 100→900」「朋友→仇人」）这类改变的**唯一**读数面。
//     下游实测零消费（`grep -RIn 'compareCheckpoints|diffPayloads|snapshot-checkpoint|LonShaSnapshot'
//     apps config` 零命中）⇒ 用户能看到的仍然只有「两边的键一样、字节差不多」。
//     本版把这一面接进下游：新增只读真源 `config/checkpoint-content-contract.js`，
//     并把产物接进诊断中心（内核取数 + 视图卡片）。
//
//   【判据分组】
//     A 真源形状：五态词表 / 恒定键面 / 方法名唯一收口 / 零写面（不碰 saveCheckpoint 等）
//     B 行为（真跑，注入合成引擎）：五态逐态不同形 + 上游半成功态（deep-unavailable）照给键面
//     C 诊断接线：内核真取数 + 视图卡片在场 + 一行文案走转发（不自拼）
//     D 负控制（四条真源码破坏 → 同款真判据转红 → 还原复绿）+ 两条 fail-closed
//     E 版本锚：五源同源 + 边界文档当版复校标记
//
//   【本仓老账（写进判据）】
//     ① 缺席与空必须不同形 —— 本套件逐态断言「文案互不相同」（不是「都非空」）；
//     ② 判据不得字面引用锚点（拼接构造），那是 v3216 假红的根因；
//     ③ 负控制必须是**真源码破坏**并在**同款真判据**上观测转红（不是另写模拟判据）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_REL = 'config/checkpoint-content-contract.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const man = JSON.parse(read('manifest.json'));
const log = JSON.parse(read('update-log.json'));

/** 剥注释（按字符状态机；本仓口径：注释里的提及不算消费） */
function stripComments(src) {
    let out = ''; let i = 0; const n = src.length; let state = 'code';
    while (i < n) {
        const c = src[i]; const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i++; continue; }
            out += c; i++; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; } else i++; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i++;
        if (c === state) state = 'code';
    }
    return out;
}

/* ── 夹具：合成上游引擎（把真源模块加载进来，注入到 window 上） ──
 *   刻意**不用**真插件：真插件是酒馆插件、本环境无宿主。合成引擎的键面按上游真源逐字对齐
 *   （键名逐字来自 snapshot-checkpoint.js 的 diffPayloadsDeep 与 index.js 的
 *    compareBranchCheckpointsDeep）。 */
const tempDirs = [];
function tmp(prefix) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(d);
    return d;
}
process.on('exit', () => {
    for (const d of tempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

/** 造一份合成 window：holder 是 window.LonShaMemory */
function makeWin(engine) {
    const win = {};
    if (engine !== undefined) win.LonShaMemory = { engine };
    return win;
}

async function loadSrc() {
    return import(pathToFileURL(path.join(ROOT, SRC_REL)).href);
}
/* 缓存模块（同一进程内多次 import 同一 URL 是同一实例，无需自造 cache-busting） */
const SRC_MOD = await loadSrc();

/** 合成上游引擎：deep 出口按上游真源键面返回 */
function fakeEngine(opts = {}) {
    const {
        items = [{ name: 'A' }, { name: 'B' }],
        listNull = false, diffAbsent = false, deepUnavailable = false,
        diffThrows = false, linesValue = '上游文案', linesAbsent = false
    } = opts;
    const eng = {
        version: '3.255.0',
        listCheckpoints() {
            if (listNull) return { ok: false, reason: 'store-absent', items: null };
            return { ok: true, reason: 'ok', items };
        }
    };
    if (!diffAbsent) {
        eng.compareBranchCheckpointsDeep = (a, b) => {
            if (diffThrows) throw new Error('boom:' + a + '/' + b);
            if (deepUnavailable) return { ok: false, reason: 'deep-unavailable', face: { sharedCount: 3, onlyInA: [], onlyInB: [] }, deep: null };
            return {
                ok: true, reason: 'ok',
                face: { sharedCount: 3, onlyInA: [], onlyInB: [] },
                deep: { ok: true, changes: [{ path: 'balance', from: { text: '100' }, to: { text: '900' } }], sets: [], capped: [], cycles: [] }
            };
        };
    }
    if (!linesAbsent) eng.checkpointContentDiffLines = () => linesValue;
    return eng;
}

/* ══════════ A 真源形状 ══════════ */
test('v3202 A1. ★ 真源在场、导出面完整、五态词表逐字（缺一态即错读数）', () => {
    assert.ok(fs.existsSync(path.join(ROOT, SRC_REL)), '真源必须在场');
    for (const k of ['readLonshaCheckpointFace', 'readCheckpointContentDiff', 'checkpointContentLines', 'checkpointFaceLine']) {
        assert.equal(typeof SRC_MOD[k], 'function', '缺导出：' + k);
    }
    assert.deepEqual(Object.values(SRC_MOD.CHECKPOINT_FACE_STATES).sort(),
        ['empty', 'engine-absent', 'face-absent', 'ok', 'unusable'], '面五态词表即契约，不得增减');
    assert.deepEqual(Object.values(SRC_MOD.CHECKPOINT_DIFF_STATES).sort(),
        ['engine-absent', 'face-absent', 'readable', 'unusable'], '对照四态词表即契约');
});
test('v3202 A2. ★★ 零写面：真源不得出现任何检查点写动作或 localStorage 直访（只读纪律）', () => {
    /* 判据在**剥注释后**的代码上跑：文件头逐字引用了这些名字来解释为什么只读，
     *   披原文判会把文档判成实现（本仓「文本包含式假红」）。 */
    const code = stripComments(read(SRC_REL));
    assert.ok(code.length > 500, '剥注释把代码也吃掉了（工具失效）');
    for (const banned of ['saveCheckpoint', 'dropCheckpoint', 'previewRestore', 'setItem', 'removeItem', 'localStorage']) {
        assert.equal(code.includes(banned), false, '只读真源不得出现写动作或存储直访：' + banned);
    }
    /* 反向自证：真源**必须**真的读上游那两个只读出口（否则「零写」是空壳） */
    assert.ok(code.includes('compareBranchCheckpointsDeep'), '真源必须真读上游对照出口');
});
test('v3202 A3. ★★ 上游出口名唯一收口（同一口径只许一份实现）', () => {
    const code = stripComments(read(SRC_REL));
    /* 方法名常量只允许各出现一次（在常量声明处）——出现两次说明又在别处手写了名字 */
    assert.equal(code.split("'compareBranchCheckpointsDeep'").length - 1, 1,
        '上游对照出口名必须只在一处声明');
    assert.equal(code.split("'checkpointContentDiffLines'").length - 1, 1,
        '上游文案出口名必须只在一处声明');
    /* 引擎全局名也唯一（别处若再写一个字面量，改一处即两边失联） */
    assert.equal(code.split("'LonShaMemory'").length - 1, 1, '引擎全局名必须只在一处声明');
});
test('v3202 A4. ★★ 缺席形态键面恒定（读者不必按键在不在猜处境）', () => {
    const face = SRC_MOD.readLonshaCheckpointFace(makeWin(undefined));
    for (const k of ['state', 'reason', 'names', 'count', 'hasContentDiff', 'engineVersion']) {
        assert.ok(Object.prototype.hasOwnProperty.call(face, k), '缺席形态缺键：' + k);
    }
    const r = SRC_MOD.readCheckpointContentDiff(makeWin(undefined), 'A', 'B');
    for (const k of ['state', 'reason', 'face', 'deep', 'lines']) {
        assert.ok(Object.prototype.hasOwnProperty.call(r, k), '对照缺席形态缺键：' + k);
    }
});

/* ══════════ B 行为（真跑合成引擎） ══════════ */
test('v3202 B1. ★★★ 五态各不相同（缺席 / 没这面 / 读不出 / 空 / 有 —— 压平即错读数）', () => {
    const absent = SRC_MOD.readLonshaCheckpointFace(makeWin(undefined));
    const faceAbsent = SRC_MOD.readLonshaCheckpointFace(makeWin({ version: '3.200.0' }));
    const unusable = SRC_MOD.readLonshaCheckpointFace(makeWin(fakeEngine({ listNull: true })));
    const empty = SRC_MOD.readLonshaCheckpointFace(makeWin(fakeEngine({ items: [] })));
    const ok = SRC_MOD.readLonshaCheckpointFace(makeWin(fakeEngine()));
    assert.equal(absent.state, 'engine-absent');
    assert.equal(faceAbsent.state, 'face-absent');
    assert.equal(unusable.state, 'unusable');
    assert.equal(empty.state, 'empty');
    assert.equal(ok.state, 'ok');
    /* ★ 关键判据：五态的**文案必须互不相同**。只断言「都非空」是空判据 ——
     *   本仓最贵的老账就是「两种处置相反的处境长得一模一样」。 */
    const texts = [absent, faceAbsent, unusable, empty, ok].map((f) => SRC_MOD.checkpointFaceLine(f));
    assert.equal(new Set(texts).size, 5, '五态文案必须互不相同：' + JSON.stringify(texts, null, 1));
    /* 「读不到」与「还没有」必须各说各的（这一对最容易塌） */
    assert.notEqual(texts[2], texts[3], '「清单读不到」与「还没有检查点」必须不同形');
    assert.match(texts[2], /读不到/, '读不到态必须明说读不到');
    assert.match(texts[3], /还没有/, '空态必须明说还没有');
});
test('v3202 B2. ★★★ 上游半成功态照给键面（deep-unavailable 不得吞掉已经能给的读数）', () => {
    const r = SRC_MOD.readCheckpointContentDiff(makeWin(fakeEngine({ deepUnavailable: true })), 'A', 'B');
    assert.equal(r.state, 'readable', '「深比较这版没有」是半成功：键面读数照给');
    assert.equal(r.reason, 'deep-unavailable', 'reason 必须原样搬运（不折成本模块态词）');
    assert.ok(r.face && r.face.sharedCount === 3, '键面读数必须真搬过来');
    assert.equal(r.deep, null, '深比较没有就是没有（不得编一个空的顶替）');
});
test('v3202 B3. ★★★ 内容级改变真被搬过来（「同键同长度但值不同」的那一类）', () => {
    const r = SRC_MOD.readCheckpointContentDiff(makeWin(fakeEngine()), 'A', 'B');
    assert.equal(r.state, 'readable');
    assert.ok(r.deep && Array.isArray(r.deep.changes) && r.deep.changes.length === 1, '内容级改动必须搬过来');
    assert.equal(r.deep.changes[0].path, 'balance');
    assert.equal(r.deep.changes[0].to.text, '900');
});
test('v3202 B4. ★★ 对照组四态不同形（引擎缺席 / 没这面 / 抛错 / 能读）', () => {
    const absent = SRC_MOD.readCheckpointContentDiff(makeWin(undefined), 'A', 'B');
    const faceAbsent = SRC_MOD.readCheckpointContentDiff(makeWin({ version: '3.200.0' }), 'A', 'B');
    const thrown = SRC_MOD.readCheckpointContentDiff(makeWin(fakeEngine({ diffThrows: true })), 'A', 'B');
    const readable = SRC_MOD.readCheckpointContentDiff(makeWin(fakeEngine()), 'A', 'B');
    const states = [absent.state, faceAbsent.state, thrown.state, readable.state];
    assert.deepEqual(states, ['engine-absent', 'face-absent', 'unusable', 'readable']);
    assert.equal(thrown.reason, 'thrown', '抛错必须如实归因（不得吞成「没有差异」）');
    assert.equal(new Set([absent.reason, faceAbsent.reason, thrown.reason, readable.reason]).size, 4,
        '四种处境的 reason 必须互不相同');
});
test('v3202 B5. ★★★ 文案口拿不到时不得回 null（空行与「没有差异」同形）', () => {
    const noEngine = SRC_MOD.checkpointContentLines(makeWin(undefined), 'A', 'B');
    const noFace = SRC_MOD.checkpointContentLines(makeWin({ version: '3.200.0' }), 'A', 'B');
    const emptyLines = SRC_MOD.checkpointContentLines(makeWin(fakeEngine({ linesValue: '   ' })), 'A', 'B');
    const okLines = SRC_MOD.checkpointContentLines(makeWin(fakeEngine()), 'A', 'B');
    for (const [name, v] of [['不在场', noEngine], ['没这面', noFace], ['回了空', emptyLines], ['正常', okLines]]) {
        assert.equal(typeof v, 'string', name + ' 必须回字符串（回 null 会被渲染成空行）');
        assert.ok(v.trim().length > 0, name + ' 不得回空白');
    }
    assert.equal(new Set([noEngine, noFace, emptyLines]).size, 3, '三种拿不到必须各说各的');
    assert.equal(okLines, '上游文案', '能拿到时必须原样转发上游文案（本模块不自拼）');
});

/* ══════════ C 诊断接线 ══════════ */
test('v3202 C1. ★★ 诊断内核真取数（唯一取数口），且不在视图里重算', () => {
    const data = read('apps/diagnose/diagnose-data.js');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(data.includes('readLonshaCheckpointFace'), '内核必须真调真源（这是唯一的取数口）');
    assert.ok(data.includes('checkpointFaceLine'), '内核必须转发真源文案（不在内核自拼）');
    assert.equal(view.includes('readLonshaCheckpointFace'), false,
        '视图不得直接取数（本仓纪律：视图纯渲染，一切结论由内核给出）');
    assert.equal(view.includes('LonShaMemory'), false, '视图不得直摸上游全局');
});
test('v3202 C2. ★★ 诊断视图卡片在场，且文案走转发（视图不自拼结论）', () => {
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(/_checkpointHtml\s*\(/.test(view), '视图必须有检查点对照卡片的渲染方法');
    assert.ok(view.includes('checkpointFaceText'), '视图必须转发内核文案（不自己拼一句）');
    assert.ok(view.includes('检查点内容级对照'), '卡片标题必须在场（否则用户看不到这一格）');
});

/* ══════════ D 负控制（真源码破坏 → 同款真判据转红） ══════════ */
/** 破坏：把真源复制到临时目录，替换锚点后重新加载，在**同款真判据**上观测 */
async function brokenMod(anchor, replacement) {
    const src = read(SRC_REL);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 60));
    const dir = tmp('rp_v3202_');
    const rel = path.join(dir, 'broken.mjs');
    fs.writeFileSync(rel, src.split(anchor).join(replacement));
    return import(pathToFileURL(rel).href);
}

test('v3202 D1. ★★★ 负控制：把「读不到」与「空」的判据拆掉 ⇒ 同款真判据必须转红', async () => {
    /* 真源码破坏：让 listNull 分支不再报 unusable，而是落进「空清单」那条路
     *   —— 这正是「缺席与空塌成一态」的实现级形态。 */
    const m = await brokenMod(
        "if (r && r.items === null) {\n                return Object.assign(emptyFace(CHECKPOINT_FACE_STATES.UNUSABLE, String(r.reason || 'unavailable')),\n                    { engineVersion, hasContentDiff: hasDiff });\n            }\n            items = (r && Array.isArray(r.items)) ? r.items : null;",
        'items = [];');
    const u = m.readLonshaCheckpointFace(makeWin(fakeEngine({ listNull: true })));
    const e = m.readLonshaCheckpointFace(makeWin(fakeEngine({ items: [] })));
    assert.equal(u.state, 'empty', '（破坏后）读不到被塌进空态 —— 破坏确实生效');
    assert.equal(m.checkpointFaceLine(u), m.checkpointFaceLine(e),
        '破坏后两种文案必须同形（证明 B1 那条判据真在守这一处；原件上二者不同形）');
    /* 对照：原件上同款判据为真（不是「破坏不存在」的假绿） */
    const ou = SRC_MOD.readLonshaCheckpointFace(makeWin(fakeEngine({ listNull: true })));
    const oe = SRC_MOD.readLonshaCheckpointFace(makeWin(fakeEngine({ items: [] })));
    assert.notEqual(SRC_MOD.checkpointFaceLine(ou), SRC_MOD.checkpointFaceLine(oe), '对照：原件上必须不同形');
});

test('v3202 D2. ★★★ 负控制：把半成功态当失败吞掉 ⇒ 键面读数静默消失（转红）', async () => {
    /* 真源码破坏：把 `readable` 判据里的 deep-unavailable 那一支去掉
     *   —— 后果是「深比较这版没有」被当成读不出，键面读数一起被吞。 */
    const m = await brokenMod("const readable = (r.ok === true) || (reason === 'deep-unavailable');",
        'const readable = (r.ok === true);');
    const r = m.readCheckpointContentDiff(makeWin(fakeEngine({ deepUnavailable: true })), 'A', 'B');
    assert.equal(r.state, 'unusable', '（破坏后）半成功被当成失败 —— 破坏确实生效');
    assert.notEqual(r.state, 'readable', '破坏后不得再声称可读');
    /* 对照：原件上同款判据为真 */
    const o = SRC_MOD.readCheckpointContentDiff(makeWin(fakeEngine({ deepUnavailable: true })), 'A', 'B');
    assert.equal(o.state, 'readable', '对照：原件上半成功必须可读');
    assert.ok(o.face && o.face.sharedCount === 3, '对照：原件上键面读数必须在场');
});

test('v3202 D3. ★★★ 负控制：文案口拿不到时回 null ⇒ B5 必须转红', async () => {
    const m = await brokenMod(
        "            if (typeof s === 'string' && s.trim()) return s;\n            return '内容级对照：**读不到** —— 上游文案口回了空（两侧缺失或载荷损坏），不是「没有差异」。';",
        "            return s;");
    const v = m.checkpointContentLines(makeWin(fakeEngine({ linesValue: '   ' })), 'A', 'B');
    assert.equal(v, '   ', '（破坏后）空白被原样透传 —— 破坏确实生效');
    assert.equal(typeof v === 'string' && v.trim().length > 0, false, '破坏后 B5 的同款断言必须转红');
    /* 对照：原件上同款判据为真 */
    const o = SRC_MOD.checkpointContentLines(makeWin(fakeEngine({ linesValue: '   ' })), 'A', 'B');
    assert.ok(o.trim().length > 0, '对照：原件上必须换成一句人话');
});

test('v3202 D4. ★★ 负控制：只读真源被塞进写动作 ⇒ A2 必须转红', async () => {
    const src = read(SRC_REL);
    /* 注入点选在真源里一处真实代码行（不是注释），确保 stripComments 后仍留下痕迹 */
    const anchor = 'export function checkpointFaceLine(face) {';
    assert.equal(src.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
    const broken = src.split(anchor).join('export function checkpointFaceLine(face) {\n    try { localStorage.setItem("x", "1"); } catch (_e) {}\n');
    const code = stripComments(broken);
    assert.ok(code.includes('localStorage'), '（破坏后）写动作留在代码面 —— 破坏确实生效');
    /* ★ 关键：在**同款判据**上观测转红 —— 即 A2 里那条 `includes(banned) === false`。
     *   初稿在这里写了一句恒假的伪断言（`false === true`），那是「另写一份模拟判据」，
     *   既没测到 A2 是哪一条、也不随 A2 口径变化。改为逐条真跑 A2 的那组 banned 词表。 */
    const banned = ['saveCheckpoint', 'dropCheckpoint', 'previewRestore', 'setItem', 'removeItem', 'localStorage'];
    const offenders = banned.filter((b) => code.includes(b));
    assert.ok(offenders.length > 0, '破坏后 A2 的同款词表判据必须转红（实测命中：' + offenders.join('、') + '）');
    /* 对照：原件上同款判据为真（不是「破坏不存在」的假绿） */
    assert.deepEqual(banned.filter((b) => stripComments(src).includes(b)), [], '对照：原件上零写面');
});

/* ══════════ E 版本锚 ══════════ */
const VNUM = (s) => String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0);

test('v3202 E1. ★ 版本锚（五源同源 + 当版条目形态锚）', () => {
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.equal(log.latest, man.version, 'update-log.latest == manifest');
    assert.equal(Object.keys(log.versions)[0], man.version, '当版条目须在首位');
    assert.ok(VNUM(man.version) >= VNUM('3.20.2'), '本套件自 3.20.2 起成立；当前 ' + man.version);
    const m = read('index.js').match(/const ST_PHONE_CURRENT_UPDATE = {[\s\S]*?\n};/);
    assert.ok(m, '公告块可提取');
    for (const it of log.versions[log.latest].items) {
        assert.ok(m[0].includes(JSON.stringify(it)), '弹窗逐字同源：' + String(it).slice(0, 24));
    }
});
test('v3202 E2. ★★ 边界文档带当版复校标记（复校契约每次同源）', () => {
    const doc = read('docs/runtime-verification-boundary.md');
    assert.ok(doc.includes('v' + pkg.version + ' 复校'), '边界文档必须带当版复校标记');
    /* 本层新增的是「上游检查点内容级对照」的可观测面 —— 文档必须点名它与它的不可验面 */
    assert.ok(/检查点|内容级对照/.test(doc), '边界文档必须写明本版新增的读数面');
});

/* ══════════ F 判据面自防护 ══════════ */
test('v3202 F1. ★★ 本套件不重写判据实现（同一口径只许一处）', () => {
    const own = read(path.join('tests', 'system-v3202.test.mjs'));
    /* 锚点字面量必须拼接，不得让断言字符串自己命中自己（v3216 假红的根因） */
    const LIT = 'function ' + 'readLonshaCheckpointFace';
    assert.equal(own.includes(LIT), false, '判据实现必须住在真源里');
    assert.ok(own.includes('readLonshaCheckpointFace('), '本套件必须真调用真源出口');
    assert.ok(own.includes('stripComments('), '本套件必须剥注释后判代码面');
});
