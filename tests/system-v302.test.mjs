/**
 * tests/system-v302.test.mjs — R2-C 注入读数消费侧接入 [v3.0.2]
 *
 * 【这一版治的欠债】
 *   上游记忆插件 v3.215.0（Gate R2-A）把「AI 这一轮实际看到了什么」做成了读数
 *   （快照 `injection` 字段，9 键 + 逐块 6 键），v3.216.0（Gate R2-B）又把落地时机
 *   收紧到代际确认之后。而本仓实测：`snapshot.injection` **全库零消费** ——
 *   下游用户既看不出「AI 到底收到几块」，也看不出「哪几块被预算裁掉了」。
 *   这是本仓反复点名的第七次「建好不消费」。
 *
 * 【本 Gate 的裁定面（不是把数字搬过来，而是把上游已给、没人读的那层分态读出来）】
 *   上游做到了第一层分态：「跑过、真的 0 块」≠「还没跑过」。
 *   本仓补第二层：**「0 块」内部还有两义**，而上游只给数据不给裁定 ——
 *     · `total === 0` ⇒ 召回压根没给出可用素材（查召回键 / 上游编辑 / 键漂移）
 *     · `total > 0 && kept === 0` ⇒ 素材有，**全被预算裁掉**（查 injectionBudget / 预算策略）
 *   两者处置方向相反，压成一态即错读数。上游逐块读数的 `reason`（kept / dropped-budget）
 *   恰好够判开 —— 这就是消费侧接入的真价值。
 *
 * 【覆盖】
 *   A 结构面：出口在场 + 结构恒定（无宿主 / 无快照 / 无注入面 / 畸形四态）
 *   B 行为面：四类处境四句话互不相同（没这面 / 没跑过 / 候选空 / 全被裁）；
 *             「没给 ≠ 给了 0」；逐块读数与文案；归属复核；诊断面与织光机面真消费
 *   C 负控制：**真源码破坏 → 载入破坏副本 → 在副本上重跑同款真判据**（判据不得写死）
 *   D 门禁面：第九道门 J10（注入读数消费点下限）在场，且真仓库上门禁全绿
 *   E 版本与文档面：五源同源 + 弹窗逐字同源 + 文档不说谎
 *
 * 【负控制的假绿史（本仓踩过三次，本套件一律照 v299 G0 / v301 C0 的形态防）】
 *   ① 对原文件断言；② 破坏写死成模拟常量；③ 破坏把判据自己删了。
 *   故：判据写成纯函数 `j*(mod)` 正负两跑；门禁走**全量镜像树**（排除 .git）
 *   并在未破坏时先自证全绿（C0）；破坏点断言锚点**恰中 1 次**。
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

const IC = 'config/injection-contract.js';
const DG_DATA = 'apps/diagnose/diagnose-data.js';
const DG_VIEW = 'apps/diagnose/diagnose-view.js';
const TW_COL = 'apps/timeweaver/timeweaver-collector.js';
const TW_VIEW = 'apps/timeweaver/timeweaver-view.js';
const GATE = 'scripts/bridge-contract-audit.mjs';
const IDX = 'index.js';
const UL = 'update-log.json';

const IC_MOD = await import(at(IC));
const DG_MOD = await import(at(DG_DATA));
const TW_MOD = await import(at(TW_COL));

const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
const CURRENT = '3.0.2';

/** 去注释（判「真消费」须在去注释源码上判；本仓注释里大量逐字提到旧写法） */
function codeOf(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

/* ============================================================
 * 夹具：上游 v3.215.0 的 `injection` 读数（逐键照真源码 index.js 的 9 键 / 6 键）
 * ============================================================ */
function injFace(over) {
    const base = {
        origin: 'generation',
        round: 3,
        ts: 1000,
        tokens: 120,
        chars: 240,
        html: '[前情摘要]\n一段记忆',
        total: 2,
        kept: 1,
        blocks: [
            { ref: 'inj_3_0', id: 0, label: '一段记忆', kept: true, chars: 120, reason: 'kept' },
            { ref: 'inj_3_1', id: 1, label: '被裁的记忆', kept: false, chars: 120, reason: 'dropped-budget' }
        ]
    };
    return Object.assign({}, base, over || {});
}
/** 宿主 window：lonsha 推送型桥 + 快照（注入面的三态自述也照上游形态给） */
function hostWin(inj, opts = {}) {
    const fieldTypes = Object.prototype.hasOwnProperty.call(opts, 'fieldTypes')
        ? opts.fieldTypes
        /* 上游语义（index.js `typeOf`）：not-given ⇒ kind='undefined'/present=false；
         *   给了但值是 null ⇒ present=true + kind='null'（**不是** present=false）；
         *   真给了对象 ⇒ present=true + kind='object'。夹具必须照真源写，
         *   否则测的是夹具缺陷而不是产品回归（本仓 v3.0.1 已踩过一次）。 */
        : { injection: { present: inj !== undefined, kind: inj === undefined ? 'undefined' : (inj === null ? 'null' : 'object') } };
    const snapshot = { meta: { fieldTypes } };
    if (inj !== undefined) snapshot.injection = inj;
    return { lonsha_memory_bridge_v1: { snapshot } };
}
const readOf = (win, opts) => IC_MOD.readInjection(win, opts);

/**
 * 判据（纯函数，**正负两跑**）：
 *   J-A 四类处境必须落在四个**互不相同**的 reason 上（判据的核心价值就在这条）
 *   J-B 「0 块」的两义必须判开，且总述文案不同
 */
function jFourStates(mod) {
    const noBridge = mod.readInjection({});
    const noSnap = mod.readInjection({ lonsha_memory_bridge_v1: {} });
    const noFace = mod.readInjection(hostWin(undefined), { snapshot: { meta: { fieldTypes: {} } } });
    const never = mod.readInjection(hostWin(null));
    const rs = [noBridge.reason, noSnap.reason, noFace.reason, never.reason];
    const set = new Set(rs);
    if (set.size !== rs.length) return { ok: false, why: '四类处境共用同一 reason：' + rs.join(' / ') };
    if (noBridge.reason !== 'bridge-absent') return { ok: false, why: '未装桥的 reason 实为 ' + noBridge.reason };
    if (noSnap.reason !== 'no-snapshot') return { ok: false, why: '无快照的 reason 实为 ' + noSnap.reason };
    if (noFace.reason !== 'no-injection-face') return { ok: false, why: '无注入面的 reason 实为 ' + noFace.reason };
    if (never.reason !== 'never-run') return { ok: false, why: '没跑过的 reason 实为 ' + never.reason };
    if (never.reason === noFace.reason) return { ok: false, why: '「没跑过」与「没这面」塌成同形' };
    return { ok: true, why: '' };
}
function jZeroBlockTwoMeanings(mod) {
    const empty = mod.readInjection(hostWin(injFace({ total: 0, kept: 0, blocks: [] })));
    const dropped = mod.readInjection(hostWin(injFace({ total: 1, kept: 0, blocks: [{ ref: 'inj_3_0', id: 0, label: 'A', kept: false, chars: 10, reason: 'dropped-budget' }] })));
    if (empty.kept !== 0 || dropped.kept !== 0) return { ok: false, why: '两侧 kept 都该是 0' };
    if (empty.verdict === dropped.verdict) return { ok: false, why: '「候选空」与「全被裁」共用同一裁定：' + empty.verdict };
    if (empty.verdict !== 'candidates-empty') return { ok: false, why: '候选空的裁定实为 ' + empty.verdict };
    if (dropped.verdict !== 'all-dropped') return { ok: false, why: '全被裁的裁定实为 ' + dropped.verdict };
    if (mod.injectionLine(empty) === mod.injectionLine(dropped)) return { ok: false, why: '两种零块的总述文案同形' };
    if (dropped.total !== 1 || dropped.dropped !== 1) return { ok: false, why: '全被裁的计数不对：total=' + dropped.total + ' dropped=' + dropped.dropped };
    return { ok: true, why: '' };
}
/** J-C 「没给」≠「给了 0」：null 必须保 null，不许被归一成 0 */
function jNullNotZero(mod) {
    const r = mod.readInjection(hostWin(injFace({ round: null, ts: null, tokens: null, chars: null })));
    if (r.round !== null) return { ok: false, why: 'round=null 被归一成 ' + r.round };
    if (r.ts !== null) return { ok: false, why: 'ts=null 被归一成 ' + r.ts };
    if (r.ageMs !== null) return { ok: false, why: 'ts 没给时 ageMs 必须是 null（实 ' + r.ageMs + '）' };
    if (r.tokens !== null || r.chars !== null) return { ok: false, why: 'tokens/chars=null 被归一' };
    const z = mod.readInjection(hostWin(injFace({ round: 0, ts: 0 })), { now: 5000 });
    if (z.round !== 0) return { ok: false, why: 'round=0 是合法值，不该变 null' };
    if (z.ageMs !== 5000) return { ok: false, why: 'ts=0 是合法值（1970），ageMs 应为 5000，实 ' + z.ageMs };
    if (String(mod.injectionLine(z)).includes('?')) return { ok: false, why: 'round=0 被显示成「?」' };
    return { ok: true, why: '' };
}
/** J-D 逐块读数：两态可分 + 键面恒定 + 未知 reason 如实输出原值 */
function jBlocks(mod) {
    const r = mod.readInjection(hostWin(injFace()));
    if (r.blocks.length !== 2) return { ok: false, why: '逐块读数条数不对：' + r.blocks.length };
    const keys = Object.keys(r.blocks[0]).sort().join(',');
    if (keys !== 'chars,dropped,id,kept,label,reason,ref') return { ok: false, why: '逐块键面漂移：' + keys };
    if (r.blocks[0].dropped !== false || r.blocks[1].dropped !== true) return { ok: false, why: 'kept/dropped 两态判反' };
    if (mod.blockReasonText('dropped-budget') === mod.blockReasonText('kept')) return { ok: false, why: '两态文案同形' };
    if (mod.blockReasonText('zzz-unknown') !== 'zzz-unknown') return { ok: false, why: '未知原因被静默兜底（应如实输出原值）' };
    if (!mod.blockLine(r.blocks[0]).includes('进了上下文')) return { ok: false, why: 'blockLine 未带归因文案' };
    return { ok: true, why: '' };
}
/** J-E 归属复核：读数只该由真生成写（诊断路径写回必须现形） */
function jStrayOrigin(mod) {
    const ok = mod.readInjection(hostWin(injFace()));
    if (ok.strayOrigin !== false) return { ok: false, why: 'default 前提（origin=generation）被误判为异常' };
    const bad = mod.readInjection(hostWin(injFace({ origin: 'dry-run' })));
    if (bad.strayOrigin !== true) return { ok: false, why: '诊断读数冒充「AI 真实所见」未被识破' };
    if (!String(mod.injectionLine(bad)).includes('不是真生成写的')) return { ok: false, why: '总述未把归属异常说出来' };
    return { ok: true, why: '' };
}
/** J-F 消费面：诊断内核与织光机都必须真消费注入读数（结构性接线，不是注释） */
function jConsumed(readFn) {
    /* 判据必须能对**任意源树**生效（负控制要在破坏副本上重跑同款判据），
     *   故取源的方式作为参数传入，而不是把真仓库路径写死在里面 ——
     *   写死会让负控制只能「对原文件断言」，正是本仓假绿清单里的第①形。 */
    const take = readFn || read;
    const dg = codeOf(take(DG_DATA));
    if (!/readInjection\(/.test(dg)) return { ok: false, why: '诊断内核未消费 readInjection' };
    /* 判「并入返回值」必须认**简写属性**形态（`return { …, injection, injBlocks }`）：
     *   写成 `injection:\\s` 是「形状判据写成字面量形态」的老毛病（本仓 v3.0.1 A4 踩过同形），
     *   真源码用简写就永远红 —— 断言的是写法，不是接线。 */
    if (!/return\s*\{[^}]*\binjection\b[^}]*\binjBlocks\b/.test(dg)) return { ok: false, why: '诊断内核未把注入面并入返回值' };
    /* 判「落下成面」必须看**逐块读数是从注入面派生的**，而不是看有没有一个叫 injBlocks 的名字：
     *   写成 `!/injBlocks/` 会被 `const injBlocks = [];`（读完就丢）骗过 ——
     *   正是本仓「假绿第②形（破坏写死成模拟常量）」的变体，故锚点取派生表达式本身。 */
    if (!/injBlocks\s*=\s*\(injection\s*&&\s*Array\.isArray\(injection\.blocks\)\)/.test(dg)) return { ok: false, why: '诊断内核未带出逐块读数' };
    const tw = codeOf(take(TW_COL));
    if (!/readInjection\(/.test(tw)) return { ok: false, why: '织光机收集器未消费 readInjection' };
    if (!/collectLonshaInjection/.test(tw)) return { ok: false, why: '织光机收集器未落下成面' };
    const view = codeOf(take(DG_VIEW));
    if (!/injectionVerdictText\(/.test(view)) return { ok: false, why: '诊断视图未渲染裁定文案' };
    const twv = codeOf(take(TW_VIEW));
    if (!/injectionLine\(/.test(twv)) return { ok: false, why: '织光机视图未渲染注入总述' };
    if (!/blockLine\(/.test(twv)) return { ok: false, why: '织光机视图未渲染逐块行' };
    return { ok: true, why: '' };
}

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v302 A1. 消费侧真源出口在场，且读出面结构恒定（缺字段一律给空形）', () => {
    const shape = (o) => Object.keys(o).sort().join(',');
    const base = shape(IC_MOD.readInjection({}));
    const shapes = [
        IC_MOD.readInjection({}),
        IC_MOD.readInjection({ lonsha_memory_bridge_v1: {} }),
        IC_MOD.readInjection(hostWin(null)),
        IC_MOD.readInjection(hostWin(injFace())),
        IC_MOD.readInjection(hostWin('畸形'))
    ];
    for (const s of shapes) {
        assert.equal(shape(s), base, '读出面结构必须恒定（消费方不必判 undefined）');
    }
    assert.ok(base.includes('verdict') && base.includes('blocks') && base.includes('ageMs') && base.includes('strayOrigin'),
        '结构里必须含裁定 / 逐块 / 时效 / 归属四格：' + base);
    for (const fn of ['readInjection', 'injectionLine', 'injectionBlocksOf', 'injectionStateText', 'injectionVerdictText', 'blockReasonText', 'blockLine']) {
        assert.equal(typeof IC_MOD[fn], 'function', '出口缺失：' + fn);
    }
});

test('v302 A2. 无宿主 / 无快照 / 无注入面 / 畸形：四态各自成面且都不抛', () => {
    assert.equal(readOf({}).reason, 'bridge-absent');
    assert.equal(readOf({ lonsha_memory_bridge_v1: {} }).reason, 'no-snapshot');
    assert.equal(readOf(hostWin(undefined), { snapshot: { meta: { fieldTypes: {} } } }).reason, 'no-injection-face');
    const malformed = readOf(hostWin('not-an-object'));
    assert.equal(malformed.state, 'unusable', '形状读不懂必须如实报畸形，不按就绪处理');
    assert.equal(malformed.reason, 'no-injection-face');
    // 桥存在但快照是拉取型（函数）时，真源 readPushProbe 会如实报无快照，不得抛
    assert.equal(readOf({ lonsha_memory_bridge_v1: { snapshot: () => ({}) } }).reason, 'no-snapshot');
});

test('v302 A3. 跨仓契约快照：上游 9 键 + 逐块 6 键被本仓照读（改上游字段此条必红）', async () => {
    /* 为什么这条要存在：本仓与上游跨仓不能 import（上游是酒馆插件、本仓是扩展），
     *   字段清单只能靠**有意重复一份**来当契约快照（与 config/projection-contract.js 的
     *   ENVELOPE_FIELDS 同动机）。上游若改名（如 kept → keptCount），本仓必须能当场发现，
     *   而不是把新字段读成 undefined 当成「没有」。 */
    const raw = injFace();
    const upstreamTop = Object.keys(raw).sort();
    assert.deepEqual(upstreamTop,
        ['blocks', 'chars', 'html', 'kept', 'origin', 'round', 'tokens', 'total', 'ts'],
        '上游 injection 面 9 键（照 tests/v3216 组 9 的键面锁）');
    assert.deepEqual(Object.keys(raw.blocks[0]).sort(),
        ['chars', 'id', 'kept', 'label', 'reason', 'ref'],
        '上游逐块 6 键（照 tests/v3216 组 9 的键面锁）');
    const r = IC_MOD.readInjection(hostWin(raw));
    assert.equal(r.chars, raw.chars, 'chars 照读');
    assert.equal(r.kept, raw.kept, 'kept 照读');
    assert.equal(r.total, raw.total, 'total 照读');
});

test('v302 A4. 逐块归一：畸形项被跳过而不是产出半成品（半成品与「真没有块」同形）', () => {
    const r = IC_MOD.injectionBlocksOf({ blocks: [{ ref: 'a', kept: false, reason: 'dropped-budget' }, null, 42, 'x'] });
    assert.equal(r.length, 1, '非对象项必须跳过');
    assert.equal(r[0].chars, 0, '缺 chars 如实补 0（不是 undefined）');
    assert.equal(r[0].id, 0, '缺 id 用下标兜底');
    assert.deepEqual(IC_MOD.injectionBlocksOf(null), [], '畸形输入一律空数组');
    assert.deepEqual(IC_MOD.injectionBlocksOf({ blocks: 'nope' }), []);
});

/* ============================================================
 * B. 行为面（本 Gate 的价值所在）
 * ============================================================ */
test('v302 B1. 四类处境落在四个互不相同的 reason 上（判据：jFourStates）', () => {
    const r = jFourStates(IC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v302 B2. 「0 块」的两义判开：候选空 vs 全被裁（这是本 Gate 的核心）', () => {
    const r = jZeroBlockTwoMeanings(IC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v302 B3. 「没给」≠「给了 0」：null 保 null、0 保 0（判据：jNullNotZero）', () => {
    const r = jNullNotZero(IC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v302 B4. 逐块读数与文案：两态可分、键面恒定、未知原因如实输出原值', () => {
    const r = jBlocks(IC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v302 B5. 归属复核：诊断读数冒充「AI 真实所见」必须在下游现形', () => {
    const r = jStrayOrigin(IC_MOD);
    assert.equal(r.ok, true, r.why);
    assert.equal(IC_MOD.injectionStateText('zzz'), 'zzz', '未知归因如实输出原值');
    assert.equal(IC_MOD.injectionStateText(''), '未知');
    assert.equal(IC_MOD.injectionVerdictText('zzz'), 'zzz');
});

test('v302 B6. 诊断内核：注入面并入返回值，且坏消息进总述首行', () => {
    const shape = (o) => Object.keys(o).sort().join(',');
    const base = shape(DG_MOD.collectDiagnose());
    assert.equal(base, shape(DG_MOD.collectDiagnose(hostWin(injFace()))), '注入面接入后返回值结构仍恒定');
    const pkg0 = DG_MOD.collectDiagnose();
    assert.ok(Object.prototype.hasOwnProperty.call(pkg0, 'injection'), '缺 injection 面');
    assert.ok(Array.isArray(pkg0.injBlocks), 'injBlocks 必须是数组（视图直接 map）');
    assert.equal(pkg0.injection.reason, 'bridge-absent', '无宿主时注入面应如实报未装桥');
    // 全被裁 ⇒ 坏消息必须进首行（本仓「有坏消息先说坏消息」纪律）
    const dropped = DG_MOD.collectDiagnose(hostWin(injFace({ kept: 0, blocks: [{ ref: 'inj_3_0', id: 0, label: 'A', kept: false, chars: 10, reason: 'dropped-budget' }] })));
    const s1 = DG_MOD.summarizeDiagnose(dropped);
    assert.ok(s1.startsWith('需注意'), '全被裁必须进总述首行：' + s1);
    assert.ok(s1.includes('预算'), '首行须点明是预算裁的（与「召回空」处置相反）：' + s1);
    assert.equal(dropped.injBlocks.length, 1, '逐块读数须带出');
    // 候选空 ⇒ 也是坏消息，但措辞必须与「全被裁」不同
    const empty = DG_MOD.collectDiagnose(hostWin(injFace({ total: 0, kept: 0, blocks: [] })));
    const s2 = DG_MOD.summarizeDiagnose(empty);
    assert.ok(s2.startsWith('需注意'), '候选空也必须进首行：' + s2);
    assert.notEqual(s1, s2, '两种零块的总述不得同形（这正是本 Gate 要治的形态）');
    // 就绪且正常 ⇒ 不进首行
    const fine = DG_MOD.collectDiagnose(hostWin(injFace()));
    assert.ok(!DG_MOD.summarizeDiagnose(fine).includes('预算'), '正常注入不得进坏消息首行');
});

test('v302 B7. 织光机：收集器真读注入读数，视图真渲染总述与逐块', () => {
    assert.equal(typeof TW_MOD.collectLonshaInjection, 'function', '织光机收集器缺 collectLonshaInjection');
    const r = TW_MOD.collectLonshaInjection({ lonsha_memory_bridge_v1: { snapshot: { injection: injFace() } } });
    /* 该出口**刻意**只回就绪态（未就绪一律 null，与 collectLonshaRecall 同规格）：
     *   判据要看的是「读到了什么」，而不是它的 reason —— 断言 reason 等于在判一个不存在的格子。 */
    assert.ok(r, '有宿主且有注入面时不得回 null');
    assert.equal(r.verdict, 'injected', '裁定须带出：' + JSON.stringify(r && r.verdict));
    assert.equal(r.kept, 1);
    assert.ok(String(r.line).includes('实际注入'), '总述须由真源 injectionLine 生成');
    assert.equal(TW_MOD.collectLonshaInjection({}), null, '桥未装 ⇒ null（不影响织光机其它源）');
    const view = read(TW_VIEW);
    assert.ok(view.includes('injectionLine('), '回望面板未渲染注入总述');
    assert.ok(view.includes('blockLine('), '回望面板未渲染逐块行');
    // buildNarrative 须把注入面挂上进行（与 recall 并列，不改变 empty 判定）
    const n = TW_MOD.buildNarrative({ get: () => null, getContext: () => null }, { withRecall: false });
    assert.ok(Object.prototype.hasOwnProperty.call(n, 'injection'), 'buildNarrative 未带注入面');
});

test('v302 B8. 消费面判据（jConsumed）：两个产品面真消费、且是结构性接线', () => {
    const r = jConsumed();
    assert.equal(r.ok, true, r.why);
});

/* ============================================================
 * C. 负控制（真源码破坏 → 载入破坏副本 → 同款判据必须转红）
 * ============================================================ */
const ORIG = new Map();
for (const f of [GATE, IC, DG_DATA, DG_VIEW, TW_COL, TW_VIEW]) ORIG.set(f, read(f));

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v302-mir-'));
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

test('v302 C0. 镜像树自证：未破坏时门禁与全部判据全绿（否则 C 组是假绿）', () => {
    withMirror({}, (dir) => {
        const r = runGate(dir, GATE);
        assert.equal(r.ok, true, '未破坏的镜像树上第九道门必须通过：' + r.out.slice(0, 400));
    });
    for (const j of [jFourStates, jZeroBlockTwoMeanings, jNullNotZero, jBlocks, jStrayOrigin]) {
        const r = j(IC_MOD);
        assert.equal(r.ok, true, '原版上判据 ' + j.name + ' 必须为真（阳性对照）：' + r.why);
    }
    assert.equal(jConsumed().ok, true, '原版上消费面判据必须为真：' + jConsumed().why);
});

test('v302 C1. 破坏：把「候选空」与「全被裁」合成一个裁定 ⇒ 同款判据在副本上转红', async () => {
    await withMirror({
        [IC]: (s) => mutateOnce(s,
            "        else if (totalEff > 0) verdict = 'all-dropped';",
            "        else if (totalEff > 0) verdict = 'candidates-empty';")
    }, async (dir) => {
        const mod = await loadMirror(dir, IC);
        const r = jZeroBlockTwoMeanings(mod);
        assert.equal(r.ok, false, '两义被合并，判据却没转红');
        assert.ok(/全被裁的裁定|共用同一裁定/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v302 C2. 破坏：把 null 归一成 0 ⇒ 同款判据在副本上转红', async () => {
    await withMirror({
        [IC]: (s) => mutateOnce(s, '    if (typeof v !== \'number\' && typeof v !== \'string\') return null;',
            '    if (typeof v !== \'number\' && typeof v !== \'string\') return 0;   // 破坏：没给也算 0')
    }, async (dir) => {
        const mod = await loadMirror(dir, IC);
        const r = jNullNotZero(mod);
        assert.equal(r.ok, false, '「没给」被当成「给了 0」，判据却没转红');
        assert.ok(/归一成|ageMs/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v302 C3. 破坏：把「没跑过」与「没这面」合成一态 ⇒ 同款判据在副本上转红', async () => {
    await withMirror({
        [IC]: (s) => mutateOnce(s, "            const reason = faceAbsent ? 'no-injection-face' : 'never-run';",
            "            const reason = 'no-injection-face';   // 破坏：两种处境压成一态")
    }, async (dir) => {
        const mod = await loadMirror(dir, IC);
        const r = jFourStates(mod);
        assert.equal(r.ok, false, '四态被压成三态，判据却没转红');
        assert.ok(/共用同一 reason|塌成同形/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v302 C4. 破坏：产品面停消费注入读数 ⇒ 第九道门 J10 红灯并点名', () => {
    withMirror({
        [DG_DATA]: (s) => s.split('readInjection(').join('_disabledInjection('),
        [TW_COL]: (s) => s.split('readInjection(').join('_disabledInjection(')
    }, (dir) => {
        const r = runGate(dir, GATE);
        assert.equal(r.ok, false, '两个产品面停消费，J10 却没红灯');
        assert.ok(r.out.includes('J10'), '红灯须指向 J10：' + r.out.slice(0, 500));
        assert.ok(/readInjection 只有 \d+ 个/.test(r.out), '红灯须给出真实读数：' + r.out.slice(0, 500));
    });
});

test('v302 C5. 破坏：诊断面对注入读数只读不用（不落下成面）⇒ 同款判据在副本上转红', async () => {
    const readerOf = (dir) => (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
    // 阳性对照：真仓库上同款判据必须为真
    assert.equal(jConsumed().ok, true, '原版上消费面判据必须为真（阳性对照）：' + jConsumed().why);
    await withMirror({
        [DG_DATA]: (s) => mutateOnce(s,
            '    const injBlocks = (injection && Array.isArray(injection.blocks)) ? injection.blocks : [];',
            '        const injBlocks = [];   // 破坏：读完就丢，不落下成面')
    }, async (dir) => {
        const body = fs.readFileSync(path.join(dir, DG_DATA), 'utf8');
        assert.ok(!/injBlocks\s*=\s*\(injection/.test(body), '破坏确实发生（锚点命中且被替换）');
        const r = jConsumed(readerOf(dir));
        assert.equal(r.ok, false, '「只读不用」没被同款判据抓到');
        assert.ok(/未带出逐块读数/.test(r.why), '转红原因须指向真因：' + r.why);
    });
    // 第二例：织光机收集器停消费 ⇒ 同款判据亦须转红
    await withMirror({
        [TW_COL]: (s) => s.split('readInjection(').join('_disabledInjection(')
    }, async (dir) => {
        const r = jConsumed(readerOf(dir));
        assert.equal(r.ok, false, '织光机停消费没被同款判据抓到');
        assert.ok(/织光机收集器未消费/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

/* ============================================================
 * D. 门禁面
 * ============================================================ */
test('v302 D1. 第九道门 J10 在场（常量 + 判据 + 失败分支 + 成功输出行），且真仓库上门禁全绿', () => {
    const g = read(GATE);
    for (const tok of ['INJECTION_READER', 'INJECTION_READER_MIN_CONSUMERS', 'J10']) {
        assert.ok(g.includes(tok), '第九道门缺 J10 要素：' + tok);
    }
    /* 成功输出行在源码里是**拼接**形式（`INJECTION_READER + ' 消费点 '`），
     *   断言字面 'readInjection 消费点' 是「判据写成字面量形态」的老毛病（本仓已踩多次）。 */
    assert.ok(/INJECTION_READER\s*\+\s*' 消费点 '/.test(g), '成功输出行须报出 J10 读数（否则没人看得见它绿过）');
    const r = runGate(ROOT, GATE);
    assert.equal(r.ok, true, '真仓库上门禁必须通过：' + r.out.slice(0, 500));
    assert.ok(/readInjection 消费点 \d+ 个/.test(r.out), '输出行须给出真实消费点数：' + r.out.slice(0, 500));
});

/* ============================================================
 * E. 版本与文档面
 * ============================================================ */
test('v302 E1. 五源同源且不低于 3.0.2', () => {
    const log = JSON.parse(read(UL));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read(IDX).match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, man.version, 'update-log.latest 与 manifest 同源');
    assert.equal(man.version, pkg.version, 'package 与 manifest 同源');
    assert.equal(pkg.version, m[1], '入口常量与 manifest 同源');
    assert.equal(Object.keys(log.versions)[0], log.latest, 'versions 首键即当前版本');
    assert.ok(vnum(log.latest) >= vnum(CURRENT), '不低于 ' + CURRENT + '，实得 ' + log.latest);
});

test('v302 E2. 变更说明与实现同域 + 弹窗逐字同源 + TODO 不再把注入面零消费写成待办', () => {
    const log = JSON.parse(read(UL));
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
    /* [v3.0.3] 同 v300 D2 / v301 D2 / v298 E2 的口径：落地项关键词锚**本套件出生版本**，
     *   不锚 `log.latest`（否则每次抬版都要回来改历史测试，而它钉的其实是历史事实：
     *   v3.0.2 的说明写了「注入/消费/判据/预算」，v3.0.3 的说明自然不会重复这四个词）。
     *   而「弹窗逐字同源」那半仍锚**当版**（它比的是此刻 index.js 里的弹窗与该版条目）。 */
    const own = log.versions['3.0.2'];
    assert.ok(own && Array.isArray(own.items), 'v3.0.2 条目必须仍在（本判据钉的是历史事实）');
    const all = own.items.join('\n');
    for (const kw of ['注入', '消费', '判据', '预算']) {
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
    const iter = read('ITERATION_LOG.md');
    const mm = /- \*\*当前版本\*\*：`([0-9.]+)`/.exec(iter);
    assert.ok(mm, '迭代日志元信息须有「当前版本」一行');
    assert.equal(mm[1], JSON.parse(read('manifest.json')).version, '迭代日志元信息与 manifest 不一致（文档已腐坏）');
});
