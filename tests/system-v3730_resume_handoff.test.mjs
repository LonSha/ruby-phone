/* ============================================================
 * v3730_resume_handoff.test.mjs — [v3.72.0 · X8] 受控恢复交接的**成对判据**
 *
 * 【本档拦的是什么（逐条对应 X8 验收原文）】
 *   A 结构面     —— 出口在场、`HANDOFF_VERSION`、三组状态常量齐全、四道预检在册
 *   B1 预检三档  —— ok / blocked / unusable **各自成形**（不可测 ≠ 通过）
 *   B2 清单缺席  —— `targets` 读不到 ⇒ unusable，**不得**报「没有这份存档」（处置相反）
 *   B3 在飞回信  —— 有在飞 ⇒ blocked 且**点名**是哪几条（不是一句「忙」）
 *   B4 覆盖语义  —— 非空必须显式告知会被覆盖；空时不说（不造成噪声）
 *   C1 held≠done —— 预检不过 ⇒ **根本没动手**（执行体调用次数 = 0）
 *   C2 幂等      —— 同一 handoffId 重复调用**返回首次结果**，执行体只跑 1 次
 *   C3 自述不算数 —— `apply` 回 `{ok:true}` 但回读不符 ⇒ `partial`（**不是** done）
 *   C4 抛错归因  —— 执行体抛错 ⇒ held + applier-threw（不与 refused 同形）
 *   C5 无执行体  —— 未注入 apply ⇒ held + no-applier（本模块自己**没有**写面）
 *   D1 回读三态  —— ok / mismatch / unreadable 互不同形；unreadable **不得**被读成「一致」
 *   D2 逐键点名  —— mismatch 须点出**哪些键**不符（含「回读多出来的键」）
 *   E1 旧写入被拒 —— 恢复期间飞出的回信（恢复**前**的世代）被挡下并记账
 *   E2 两把闸门  —— 恢复**不改会话身份** ⇒ 只过 session-gate 的令牌**必须仍被本模块挡下**
 *   E3 先抬后写  —— 世代必须在执行体被调用**之前**抬（顺序反了就是漏洞窗口）
 *   F 真源码破坏 —— 摘掉「先抬世代」⇒ E1/E3 真判据实测失败（破坏可观测）
 *   G 自防护 + 当版锚点（V4 计数形态）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REL = 'config/resume-handoff.js';
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const src = () => readRoot(REL);
const ok = (m) => console.log('  OK ' + m);

/* 真源是 ESM 且**有依赖**（`./num-gate.js`）：破坏副本要能**独立**载入，
 *  就不能把单文件搬到 /tmp —— 那会让相对导入解析到 /tmp 去（ERR_MODULE_NOT_FOUND）。
 *  故与本仓 v3480 同款：建**工作区副本树**（把 REL 与它的依赖一起拷进去），
 *  破坏时改写工作区里的同一份，再从工作区路径 import。 */
const WS_FILES = [REL, 'config/num-gate.js'];
function makeWorkspace(sourceOverride) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-ws-'));
    for (const rel of WS_FILES) {
        const to = path.join(d, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, fs.readFileSync(path.join(ROOT, rel), 'utf8'), 'utf8');
    }
    if (typeof sourceOverride === 'string') {
        fs.writeFileSync(path.join(d, REL), sourceOverride, 'utf8');
    }
    return d;
}
let seq = 0;
async function loadFrom(source) {
    const ws = makeWorkspace(source);
    return import(pathToFileURL(path.join(ws, REL)).href + '?v=' + String(++seq));
}
const api = () => loadFrom(src());

/* ---- 破坏锚点（逐字取自真源，禁改；本档须逐字持有） ---- */
/* 锚点①：先抬交接世代，再执行（E1/E3 的根据）。 */
const A_BUMP_BEFORE = String.raw`    const before = gate.epoch;
    const after = bumpHandoffEpoch('restore:' + (id || 'anonymous'));`;
/* 锚点②：交接栅栏判世代（E1 的根据）。 */
const A_GATE_EPOCH = String.raw`    if (t !== gate.epoch) return 'epoch-bumped';`;
/* 锚点③：预检「清单读不到」分支（B2 的根据）。 */
const A_LIST_UNREADABLE = String.raw`    if (!Array.isArray(o.targets)) {
        add('target', 'unusable', 'target-list-unreadable');`;
/* 自防护锚点。 */
const A_SELF_HEAD = 'v3730_resume_handoff';

const base = (over) => Object.assign({
    target: 'save-1', targets: ['save-1', 'save-2'], identity: 'chat-1',
    inFlight: [], current: { rows: 0 }, at: 11
}, over || {});

test('v3630 A. 出口在场 + 三组状态常量齐全 + 四道预检在册', async () => {
    const m = await api();
    for (const k of ['precheckHandoff', 'handoffResume', 'readbackOf', 'guardHandoffWrite',
        'captureHandoffToken', 'bumpHandoffEpoch', 'handoffDropLog', 'handoffLine', 'precheckLine']) {
        assert.equal(typeof m[k], 'function', '出口缺: ' + k);
    }
    assert.equal(m.HANDOFF_VERSION, 1, '交接读数结构版本');
    assert.deepEqual(Object.values(m.PRECHECK_STATES), ['ok', 'blocked', 'unusable']);
    assert.deepEqual(Object.values(m.READBACK_STATES), ['ok', 'mismatch', 'unreadable']);
    assert.deepEqual(Object.values(m.HANDOFF_STATES), ['held', 'done', 'partial']);
    assert.deepEqual([...m.PRECHECK_CHECKS], ['target', 'identity', 'inFlight', 'current'],
        '四道预检顺序固定（UI 按此渲染）');
    /* 三组状态**必须两两不同字面量** —— 同形就等于没有三态。 */
    const all = [...Object.values(m.PRECHECK_STATES), ...Object.values(m.READBACK_STATES), ...Object.values(m.HANDOFF_STATES)];
    assert.equal(new Set(all).size >= 8, true, '状态字面量不得压平（实 ' + new Set(all).size + ' 个）');
    ok('出口 + 三组状态 + 四道预检');
});

test('v3630 B1. 预检三档各自成形（不可测 ≠ 通过）', async () => {
    const m = await api();
    const good = m.precheckHandoff(base());
    assert.equal(good.state, 'ok');
    assert.equal(good.blockedBy.length, 0);
    /* blocked：目标不在清单里。 */
    const miss = m.precheckHandoff(base({ target: 'save-9' }));
    assert.equal(miss.state, 'blocked', '目标不存在 ⇒ blocked');
    assert.deepEqual(miss.blockedBy, ['target']);
    /* unusable：身份取不到（**不是** blocked —— 处置相反：一个要修数据，一个要修环境）。 */
    const noId = m.precheckHandoff(base({ identity: '' }));
    assert.equal(noId.state, 'unusable', '身份取不到 ⇒ unusable');
    assert.notEqual(noId.state, miss.state, 'unusable 与 blocked **必须不同形**');
    assert.ok(/不可测/.test(noId.why), 'unusable 文案须点明不可测（实：' + noId.why + '）');
    ok('预检三档不同形（ok / blocked / unusable）');
});

test('v3630 B2. 清单读不到 ⇒ unusable，不得报「没有这份存档」', async () => {
    const m = await api();
    assert.equal(src().includes(A_LIST_UNREADABLE), true, '真源须有「清单读不到」落点');
    const r = m.precheckHandoff({ target: 'save-1', targets: null, identity: 'c', inFlight: [], current: { rows: 0 } });
    assert.equal(r.state, 'unusable', '清单读不到 ⇒ 不可测');
    assert.equal(r.checks.find((c) => c.key === 'target').reason, 'target-list-unreadable');
    assert.equal(r.targetKnown, null, '清单不可读 ⇒ targetKnown 恒 null（不得报 false）');
    assert.notEqual(r.targetKnown, false, '★ 不得把「查不到」降级成「不存在」');
    ok('清单缺席 ⇒ unusable（不与「不存在」同形）');
});

test('v3630 B3. 在飞回信 ⇒ blocked 且点名', async () => {
    const m = await api();
    const r = m.precheckHandoff(base({ inFlight: [{ domain: 'wechat-image' }, { domain: 'diary-photo' }] }));
    assert.equal(r.state, 'blocked');
    assert.deepEqual(r.blockedBy, ['inFlight']);
    assert.equal(r.inFlightCount, 2, '须给出条数');
    assert.deepEqual(r.inFlight, ['wechat-image', 'diary-photo'], '须**点名**是哪几条（不是一句「忙」）');
    /* 清单读不到（null）⇒ unusable，与「没有在飞」不同形。 */
    const unknown = m.precheckHandoff(base({ inFlight: null }));
    assert.equal(unknown.state, 'unusable');
    assert.notEqual(unknown.state, m.precheckHandoff(base()).state, '读不到在飞清单 ≠ 无在飞');
    ok('在飞回信 ⇒ blocked + 点名（读不到则 unusable）');
});

test('v3630 B4. 覆盖语义：非空显式告知，空时不说', async () => {
    const m = await api();
    const nonEmpty = m.precheckHandoff(base({ current: { rows: 42 } }));
    assert.equal(nonEmpty.currentState, 'non-empty');
    assert.equal(nonEmpty.overwritesExisting, true, '非空 ⇒ 必须告知会被覆盖');
    const empty = m.precheckHandoff(base({ current: { rows: 0 } }));
    assert.equal(empty.overwritesExisting, false);
    assert.ok(!/覆盖/.test(m.precheckLine(empty)), '空档不出现「覆盖」字样（不造成噪声）');
    assert.ok(/覆盖/.test(m.precheckLine(nonEmpty)), '非空文案须点明覆盖');
    /* 数据面读不到 ⇒ unusable（不是 empty）。 */
    const unknown = m.precheckHandoff(base({ current: null }));
    assert.equal(unknown.state, 'unusable');
    assert.notEqual(unknown.currentState, 'empty', '读不到 ≠ 空');
    ok('覆盖语义显式 + 读不到 ≠ 空');
});

test('v3630 C1. held ≠ done：预检不过 ⇒ 根本没动手（执行体 0 次）', async () => {
    const m = await api();
    let calls = 0;
    const h = m.handoffResume(base({ target: 'save-9', handoffId: 'h-held-' + Date.now(),
        apply: () => { calls++; return { ok: true }; } }));
    assert.equal(h.state, 'held', '预检不过 ⇒ held');
    assert.equal(calls, 0, '★ 预检不过时执行体**调用次数必须为 0**（held = 拦住了）');
    assert.equal(h.applied, false);
    assert.equal(h.execute, null, '未动手 ⇒ execute 段为空（不是「跑了但失败」）');
    assert.notEqual(h.state, 'partial', 'held 与 partial 必须不同形');
    const line = m.handoffLine(h);
    assert.ok(/未动手/.test(line), '文案须点明未动手（实：' + line + '）');
    ok('预检不过 ⇒ 零调用（held ≠ partial ≠ done）');
});

test('v3630 C2. 幂等：同一 handoffId 只执行一次', async () => {
    const m = await api();
    let calls = 0;
    const id = 'h-idem-' + Date.now();
    const args = base({ handoffId: id, expect: { rows: 5 }, observed: { rows: 5 },
        apply: () => { calls++; return { ok: true }; } });
    const first = m.handoffResume(args);
    assert.equal(first.state, 'done');
    assert.equal(calls, 1);
    const again = m.handoffResume(args);
    assert.equal(again.state, 'done');
    assert.equal(again.idempotent, true, '重复调用须标 idempotent');
    assert.equal(calls, 1, '★ 执行体**只许跑一次**（重复调用返回首次结果）');
    assert.ok(/未二次执行/.test(m.handoffLine(again)), '文案须点明未二次执行');
    ok('幂等：同一交接只执行一次（返回首次结果）');
});

test('v3630 C3. 写面自述成功不算证据：回读不符 ⇒ partial', async () => {
    const m = await api();
    const h = m.handoffResume(base({ handoffId: 'h-rb-' + Date.now(),
        expect: { rows: 5, branch: 'A' }, observed: { rows: 3, branch: 'B' },
        apply: () => ({ ok: true }) }));
    assert.equal(h.execute.ok, true, '执行体自述成功（这正是要**不信**的那个读数）');
    assert.equal(h.readback.state, 'mismatch');
    assert.equal(h.state, 'partial', '★ 自述成功 + 回读不符 ⇒ partial（不是 done）');
    assert.notEqual(h.state, 'done');
    assert.equal(h.applied, true, 'applied 记的是「执行体真跑了」，「交接成功」看 state');
    ok('写面自述成功不作为证据（partial ≠ done）');
});

test('v3630 C4. 执行体抛错 ⇒ held + 归因（不与 refused 同形）', async () => {
    const m = await api();
    const threw = m.handoffResume(base({ handoffId: 'h-threw-' + Date.now(),
        apply: () => { throw new Error('boom'); } }));
    assert.equal(threw.state, 'held');
    assert.equal(threw.execute.reason, 'applier-threw');
    assert.ok(/boom/.test(threw.execute.note), '须带原错信息（实：' + threw.execute.note + '）');
    const refused = m.handoffResume(base({ handoffId: 'h-refused-' + Date.now(),
        apply: () => ({ ok: false, reason: 'owner-says-no' }) }));
    assert.equal(refused.state, 'held');
    assert.equal(refused.execute.reason, 'owner-says-no');
    assert.notEqual(threw.execute.reason, refused.execute.reason, '抛错与拒绝**必须不同形**');
    ok('抛错 / 拒绝各自归因（不与「没动手」同形）');
});

test('v3630 C5. 未注入执行体 ⇒ held + no-applier（本模块自己没有写面）', async () => {
    const m = await api();
    const h = m.handoffResume(base({ handoffId: 'h-noapp-' + Date.now() }));
    assert.equal(h.state, 'held');
    assert.ok(/执行体/.test(h.why), '归因须点明缺执行体（实：' + h.why + '）');
    /* 结构性：真源本身**没有**任何写面。
     *  v3.63.0 起本模块**不再零 import** —— 取数一律走全仓唯一实现
     *  `config/num-gate.js`（weak-coercion 门 W1 的硬要求；就地写
     *  `Number.isFinite(Number(x))` 会被判弱口径）。故口径改为：
     *  **只准 import 取数门**，不得 import 任何执行/宿主/存储面。 */
    const s = src();
    const imports = (s.match(/^import .*$/gm) || []);
    assert.deepEqual(imports, ["import { numOrNull } from './num-gate.js';"],
        '★ 本模块只准 import 取数门（实：' + JSON.stringify(imports) + '）');
    assert.equal(/\bdocument\./.test(s), false, '交接内核不得碰 DOM');
    assert.equal(/'config\//.test(s) && !/num-gate/.test(s), false, '不得引入配置面（取数门除外）');
    assert.equal(s.includes('setChatMessages'), false, '不得直接调宿主写口（委托 owner）');
    ok('无执行体 ⇒ 不动手（只 import 取数门 / 零写面，结构性成立）');
});

test('v3630 D1. 回读三态互不同形（unreadable 不得读成「一致」）', async () => {
    const m = await api();
    const same = m.readbackOf({ expect: { rows: 5 }, observed: { rows: 5 } }, 1);
    assert.equal(same.state, 'ok');
    assert.equal(same.mismatched.length, 0);
    const diff = m.readbackOf({ expect: { rows: 5 }, observed: { rows: 3 } }, 1);
    assert.equal(diff.state, 'mismatch');
    /* 回读面取不到 ⇒ unreadable（**不是** ok）。 */
    const gone = m.readbackOf({ expect: { rows: 5 }, observed: null }, 1);
    assert.equal(gone.state, 'unreadable');
    assert.notEqual(gone.state, same.state, '★ 取不到 ≠ 一致');
    assert.notEqual(gone.state, diff.state, '取不到 ≠ 不符（处置相反）');
    assert.ok(/不是/.test(gone.why), '文案须显式否认「一致」（实：' + gone.why + '）');
    /* 预期面没给 ⇒ 同样 unreadable，且归因不同。 */
    const noExp = m.readbackOf({ expect: null, observed: { rows: 5 } }, 1);
    assert.equal(noExp.state, 'unreadable');
    assert.notEqual(noExp.reason, gone.reason, '两种 unreadable 的归因须不同');
    ok('回读三态不同形（ok / mismatch / unreadable × 2 归因）');
});

test('v3630 D2. mismatch 须逐键点名（含回读多出来的键）', async () => {
    const m = await api();
    const r = m.readbackOf({ expect: { rows: 5, branch: 'A' }, observed: { rows: 5, branch: 'B', extra: 1 } }, 1);
    assert.equal(r.state, 'mismatch');
    const keys = r.mismatched.map((x) => x.key).sort();
    assert.deepEqual(keys, ['branch', 'extra'], '★ 须点出**哪些键**不符（含回读多出来的键）');
    assert.equal(r.compared, 2, 'compared 只数预期面的键');
    assert.ok(/branch/.test(r.why), '文案须带键名（实：' + r.why + '）');
    ok('mismatch 逐键点名（含未预期键）');
});

test('v3630 E1. 旧异步写入被拒：恢复前的回信被挡下并记账', async () => {
    const m = await api();
    const tok = m.captureHandoffToken({ id: 'chat-1', epoch: 0 });
    /* 恢复前：令牌有效。 */
    assert.equal(m.guardHandoffWrite(tok, 'wechat-image'), true, '恢复前须放行');
    const before = m.handoffDropLog().count;
    /* 走一次真恢复（抬世代）。 */
    m.handoffResume(base({ handoffId: 'h-gate-' + Date.now(), expect: { rows: 1 }, observed: { rows: 1 },
        apply: () => ({ ok: true }) }));
    /* 恢复后：同一个令牌（恢复**之前**记的）必须被拒。 */
    assert.equal(m.guardHandoffWrite(tok, 'wechat-image'), false, '★ 恢复前的旧回信须被挡下');
    const log = m.handoffDropLog();
    assert.equal(log.count, before + 1, '须记账');
    assert.equal(log.rows[log.rows.length - 1].domain, 'wechat-image', '域名须上榜');
    assert.ok(/恢复/.test(log.rows[log.rows.length - 1].text), '文案须点明「出发于恢复之前」');
    /* 恢复**之后**记的令牌须放行（栅栏不能把新回信也一起挡了）。 */
    assert.equal(m.guardHandoffWrite(m.captureHandoffToken({ id: 'chat-1', epoch: 0 }), 'diary-photo'), true,
        '恢复后新发出的回信须放行');
    ok('恢复前的旧回信被挡下并记账（恢复后的新回信不受影响）');
});

test('v3630 E2. 两把闸门：恢复不改会话身份 ⇒ 只过 session-gate 的令牌仍须被挡', async () => {
    const m = await api();
    /* 会话身份自始至终不变（id/epoch 都没动）—— 这正是 session-gate 判不出来的情形。 */
    const token = { id: 'chat-1', epoch: 0 };
    const cap = m.captureHandoffToken(token);
    assert.equal(cap.session.id, token.id, '令牌须同时带会话身份');
    assert.equal(Number.isFinite(cap.handoff), true, '令牌须带交接世代');
    m.handoffResume({ target: 'save-1', targets: ['save-1'], identity: 'chat-1', inFlight: [],
        current: { rows: 0 }, handoffId: 'h-two-' + Date.now(), expect: { rows: 1 }, observed: { rows: 1 },
        apply: () => ({ ok: true }) });
    /* 会话令牌本身没变（模拟 session-gate 会判「current」）⇒ 本模块必须**独立**拦住。 */
    assert.equal(m.handoffWriteReason(cap), 'epoch-bumped',
        '★ 会话身份未变也会被判「恢复前」—— 这正是本维度存在的理由');
    assert.equal(m.guardHandoffWrite(cap, 'x'), false);
    ok('会话身份不变时仍能拦下恢复前的回信（补 session-gate 的盲区）');
});

test('v3630 E3. 顺序：世代必须在执行体被调用**之前**抬', async () => {
    const m = await api();
    assert.equal(src().includes(A_BUMP_BEFORE), true, '真源须在 apply 之前抬世代（结构落点）');
    let seenEpoch = null;
    let epochBeforeCall = null;
    m.handoffResume(base({ handoffId: 'h-order-' + Date.now(), expect: { rows: 1 }, observed: { rows: 1 },
        apply: () => { seenEpoch = m.handoffEpoch(); return { ok: true }; } }));
    epochBeforeCall = seenEpoch;
    assert.ok(epochBeforeCall !== null, '执行体须被调用');
    /* 执行体被调用那一刻，世代**已经**是新值（证明「先抬后调」）。 */
    const afterAll = m.handoffEpoch();
    assert.equal(epochBeforeCall, afterAll, '★ 执行体看到的世代须已是新值（否则存在漏洞窗口）');
    ok('先抬世代、再执行（执行体看到的已是新世代）');
});

test('v3630 F. 真源码破坏：摘掉「先抬世代」⇒ E1/E3 真判据实测失败', async () => {
    const s = src();
    assert.equal(s.split(A_BUMP_BEFORE).length - 1, 1, '锚点须在真源恰中 1 次');
    /* 破坏：把「先抬」改成「不抬」（世代停在原处）—— 真判据必须真的失败。
     *   ★ 这是本仓反复踩过的坑：破坏必须**在读数面可观测**。
     *     这里用 guardHandoffWrite 的返回值与 handoffEpoch 两个读数同时验。 */
    const broken = s.replace(A_BUMP_BEFORE,
        "    const before = gate.epoch;\n    const after = before;");
    assert.notEqual(broken, s, '破坏须可观测改动');
    const B = await loadFrom(broken);
    /* 原版：恢复后旧令牌被拒。 */
    const am = await api();
    const tokA = am.captureHandoffToken({ id: 'c', epoch: 0 });
    am.handoffResume({ target: 's', targets: ['s'], identity: 'c', inFlight: [], current: { rows: 0 },
        handoffId: 'f-orig-' + Date.now(), expect: { rows: 1 }, observed: { rows: 1 }, apply: () => ({ ok: true }) });
    const origVerdict = am.guardHandoffWrite(tokA, 'd');
    /* 破坏版：同一序列。 */
    const tokB = B.captureHandoffToken({ id: 'c', epoch: 0 });
    B.handoffResume({ target: 's', targets: ['s'], identity: 'c', inFlight: [], current: { rows: 0 },
        handoffId: 'f-broken-' + Date.now(), expect: { rows: 1 }, observed: { rows: 1 }, apply: () => ({ ok: true }) });
    const brokenVerdict = B.guardHandoffWrite(tokB, 'd');
    assert.equal(origVerdict, false, '原版真判据须通过（恢复后旧回信被拒）');
    assert.equal(brokenVerdict, true, '★ 破坏版上真判据须失败（旧回信**不再**被拒）');
    assert.notEqual(origVerdict, brokenVerdict, '破坏须在读数面留下可见差异');
    /* 反向：新令牌在破坏版上仍放行 ⇒ 证明破坏精确命中「抬世代」这一行。 */
    assert.equal(B.guardHandoffWrite(B.captureHandoffToken({ id: 'c', epoch: 0 }), 'd'), true,
        '破坏后新回信仍放行（破坏只命中抬世代）');
    ok('真源码破坏：摘掉「先抬世代」⇒ E1 真判据实测失败');
});

test('v3630 G. 自防护 + 当版锚点（V4 计数形态）', async () => {
    const self = readRoot(path.join('tests', 'system-v3730_resume_handoff.test.mjs'));
    assert.ok(self.includes(A_SELF_HEAD), '本档须持有自防护锚点');
    assert.ok(self.length > 6000, '本档自身不得被清空（实 ' + self.length + ' 字符）');
    /* 破坏锚点须逐字持有（否则 F 段的破坏无从发生）。
     *   ★ 含换行的锚点**必须**用 String.raw 声明：普通引号串里的 `\n` 是真的换行字符，
     *     而源文件里那一处是**两字符** `\` + `n`（缩进存在于源文本），
     *     `self.includes(...)` 会恒假 —— v3288 已踩过同形一次，此处按同一口径）。 */
    assert.ok(self.includes(A_BUMP_BEFORE), '本档须持有锚点①原串');
    assert.ok(self.includes(A_GATE_EPOCH), '本档须持有锚点②原串');
    assert.ok(self.includes(A_LIST_UNREADABLE), '本档须持有锚点③原串');
    const pkgRaw = JSON.parse(readRoot('package.json')).version;
    const vnum = (s) => String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0);
    assert.ok(vnum(pkgRaw) >= vnum('3.63.0'), '当版锚点须 ≥ 出生版（下限形，V4 计数形态；实 ' + pkgRaw + '）');
    ok('自防护 + 当版锚点 ' + pkgRaw);
});
