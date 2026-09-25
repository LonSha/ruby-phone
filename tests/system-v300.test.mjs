/**
 * tests/system-v300.test.mjs — 跨仓投影契约的**消费侧**（L-F5 的下游一半）[v3.0.0]
 *
 * 【本版接的是另一半】
 *   上游记忆插件 v3.208.0 建了投影管线（6 项投影、三态读数、缺席清单），但产出退化成
 *   `this._lastProjection` 之后**零外供**；上游 **v3.212.0** 补上了出口（`projection-pipeline.js`
 *   的 envelope + `index.js` 的 `_buildProjectionEnvelope()`，随桥快照 `projection` 字段外供）。
 *   本仓这一版是**消费的那一半**：`config/projection-contract.js` 把那份 envelope 读成
 *   手机端可用的面，并在诊断中心里落成第六面。
 *
 * 【为什么消费侧必须自己重写一份字段清单（不是抄漏了纪律）】
 *   跨仓不能 import（上游是酒馆插件、本仓是扩展，两侧各自自足，且 lonsha 侧的
 *   `scan_cross_repo_binding.mjs` 的 P2 明令禁止引用本仓路径）。更要紧的是：消费者必须能
 *   **独立判**「我认不认得这份结构」，判据就是「必填字段是否都在」+「结构版是否高于我认得的」。
 *   故本套件把这份清单**当跨仓契约快照**锁在 C 组（第三份：上游实现 / 下游实现 / 本判据），
 *   任何一侧偷偷改字段都会在这里红。
 *
 * 【覆盖】
 *   A 契约结构面：模块落地 + 导出面 + 五态裁定 + 结构恒定 + 三态分面 + 过期只报不改
 *   B 诊断接线面：两颗新面 + 视图第六面 + 缺省文案 + 坏消息先说 + 逐面容错不连坐
 *   C 跨仓契约一致性：字段清单 / 结构版 / 身份三键 / revision 形态（不硬编）
 *   D 版本与读数面：五源同源（3.0.0）+ 弹窗逐字同源 + 死导出读数如实（95 → 96 的构成）
 *   E 负控制：**真源码破坏 → 浅镜像副本 → 在副本上重跑同款真判据必须转红且指向真因**
 *   F 镜像自证：未破坏的镜像树上五条判据全为真（否则 E 组是假绿）
 *
 * 【负控制为什么用「判据函数集中定义 + 传入模块」的形态】
 *   本仓历史负控制踩过三种假绿（①对原文件断言；②破坏写死成模拟常量；③破坏把判据自己删了）。
 *   这里统一：判据写成纯函数 `j*(mod)`，正控制传真模块、负控制传**破坏后的副本模块**，
 *   同一份判据跑两遍 —— 副本上必须转红、原版上必须为真（阳性对照）。
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
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const PC = 'config/projection-contract.js';
const DG_DATA = 'apps/diagnose/diagnose-data.js';
const DG_VIEW = 'apps/diagnose/diagnose-view.js';
const IDX = 'index.js';

const PC_MOD = await import(at(PC));
const DG_MOD = await import(at(DG_DATA));

/** 版本比较（与 v289/v290 同款；本仓各套件历史口径一致） */
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));

const CURRENT = '3.0.0';

/* ============================================================
 * 0. 版本锚：本套件锁自己的出生版本（不随抬版上抬）
 *
 * 交棒约定：本版之后的历史套件只锁**下限**，当版精确判定由最新套件接管
 *   （本版接管 v299 E3 —— 它的 `a[0]===b[0] && a[1]===b[1]` 硬结构断言在主版本跳到 3
 *   时必红，已按仓内惯例改成下限锚点，交棒注释写在 v299 的 E3 里）。
 * ============================================================ */
test('v300 0. 版本锚：本套件锁自己的出生版本 3.0.0（不随抬版上抬）', () => {
    const man = JSON.parse(read('manifest.json'));
    assert.ok(vnum(man.version) >= vnum(CURRENT), '本体须不早于 ' + CURRENT + '，实得 ' + man.version);
});

/* ============================================================
 * 判据区（正控制与负控制共用同一份；见文件头「为什么」）
 *
 * 每条判据返回 { ok, why }，**不抛**：负控制要能观测「为什么转红」，
 *   而不是被断言异常吞掉原因。
 * ============================================================ */

/** 造一份上游形态的 envelope（形状取自上游 projection-pipeline.js 的 buildEnvelope） */
function env(over) {
    const base = {
        projectionApiVersion: 1,
        projectionVersion: 6,
        generatedAt: 1000,
        conversationId: 'chat-1',
        sceneId: '老城›钟楼›顶层',
        worldId: 'world-ledger',
        items: {},
        visibility: {},
        sourceLedger: {
            available: true, bound: true, reason: 'ok', absent: [],
            summary: { total: 6, ok: 5, empty: 0, absent: 1, skipped: 0 }
        },
        revision: 7,
        expiresAt: 1000 + 60000
    };
    return Object.assign({}, base, over || {});
}
/** 快照壳：`meta.fieldTypes.projection` 是上游 v3.174 起的字段三态自述 */
function snap(projFace, declared) {
    const ft = { projection: { present: declared === undefined ? true : declared, kind: 'object' } };
    const s = { meta: { fieldTypes: ft } };
    if (projFace !== undefined) s.projection = projFace;
    return s;
}

/** J1：given 面显值 / withheld 面**绝不给值**（防「扣下的投影被当有值」） */
function jWithheldNeverGivesValue(mod) {
    const face = env({
        items: { peopleLocations: { 阿澈: '老城›钟楼' }, knowledgeOwners: { 阿澈: ['fact-1'] } },
        visibility: { peopleLocations: 'given', knowledgeOwners: 'withheld' },
        sourceLedger: {
            available: true, bound: true, reason: 'partial',
            absent: [{ id: 'knowledgeOwners', reason: 'no-provider' }],
            summary: { total: 2, ok: 1, empty: 0, absent: 1, skipped: 0 }
        }
    });
    const pj = mod.readProjection({}, { snapshot: snap(face) });
    if (pj.reason !== 'ready') return { ok: false, why: 'reason=' + pj.reason };
    const w = (pj.withheld || []).filter((x) => x.id === 'knowledgeOwners');
    if (w.length !== 1) return { ok: false, why: 'withheld 面丢了扣下项（' + JSON.stringify(pj.withheld) + '）' };
    if (w[0].reason !== 'no-provider') return { ok: false, why: '扣下原因没从 sourceLedger.absent 取到：' + w[0].reason };
    const r = mod.projectionValue(pj, 'knowledgeOwners');
    if (r.present === true) return { ok: false, why: '扣下的投影仍给出了值（最贵形态：拿空/旧值顶替）' };
    if (Object.prototype.hasOwnProperty.call(pj.items || {}, 'knowledgeOwners')) {
        return { ok: false, why: '扣下的投影进了 given 面（分面塌了）' };
    }
    const g = mod.projectionValue(pj, 'peopleLocations');
    if (g.present !== true || !g.value || g.value['阿澈'] !== '老城›钟楼') {
        return { ok: false, why: 'given 面没读出真值' };
    }
    return { ok: true, why: '' };
}

/** J2：管线缺席（available=false）与「跑了但都是空」**必须分开报** */
function jPipelineAbsentStaysSeparate(mod) {
    const absent = env({
        sourceLedger: { available: false, bound: true, reason: 'pipeline-absent', absent: [], summary: null }
    });
    const emptyRun = env({
        items: { peopleLocations: {} },
        visibility: { peopleLocations: 'given' },
        sourceLedger: {
            available: true, bound: true, reason: 'ok', absent: [],
            summary: { total: 1, ok: 0, empty: 1, absent: 0, skipped: 0 }
        }
    });
    const a = mod.readProjection({}, { snapshot: snap(absent) });
    const b = mod.readProjection({}, { snapshot: snap(emptyRun) });
    if (a.reason !== 'pipeline-absent') return { ok: false, why: '管线缺席读成 ' + a.reason + '（两者被压成同态）' };
    if (b.reason !== 'ready') return { ok: false, why: '跑过但为空的面读成 ' + b.reason };
    // 源空的 given 面仍是「有值（空）」——不得因为空就被降级成缺席
    if (!Object.prototype.hasOwnProperty.call(b.items || {}, 'peopleLocations')) {
        return { ok: false, why: '源空的 given 面被当成缺席（空 ≠ 缺席）' };
    }
    return { ok: true, why: '' };
}

/** J3：结构版超前**不得按就绪处理**（旧下游遇到新结构必须报 ahead） */
function jAheadIsNotReady(mod) {
    const ahead = mod.readProjection({}, { snapshot: snap(env({ projectionApiVersion: 2 })) });
    const behind = mod.readProjection({}, { snapshot: snap(env({ projectionApiVersion: 0 })) });
    if (ahead.reason !== 'contract-ahead') return { ok: false, why: '结构版超前读成 ' + ahead.reason };
    if (behind.reason !== 'contract-behind') return { ok: false, why: '结构版偏旧读成 ' + behind.reason };
    if (mod.contractOf({}).state !== 'malformed') return { ok: false, why: '空对象应判畸形' };
    if (mod.contractOf(null).state !== 'missing') return { ok: false, why: 'null 应判缺席' };
    return { ok: true, why: '' };
}

/** J4：缺必填字段**必须判畸形**（把新结构读成「没有这项」是本仓最贵的错读数） */
function jMissingFieldsRejected(mod) {
    const partial = env();
    delete partial.items;
    delete partial.visibility;
    const r = mod.contractOf(partial);
    if (r.state !== 'malformed') return { ok: false, why: '缺 2 个必填字段却未判畸形（实得 ' + r.state + '）' };
    if (!Array.isArray(r.missing) || r.missing.length !== 2) return { ok: false, why: '畸形裁定未如实带出 missing 清单：' + JSON.stringify(r.missing) };
    const pj = mod.readProjection({}, { snapshot: snap(partial) });
    if (pj.reason !== 'contract-malformed') return { ok: false, why: '畸形结构读成 ' + pj.reason };
    return { ok: true, why: '' };
}

/** J5：过期只**如实报** stale，不偷偷重算（上游给了 expiresAt 就是判据） */
function jStaleIsReportedNotFixed(mod) {
    const face = env({ expiresAt: 5000 });
    const fresh = mod.readProjection({}, { snapshot: snap(face), now: 4000 });
    const old = mod.readProjection({}, { snapshot: snap(face), now: 6000 });
    if (fresh.stale !== false) return { ok: false, why: '未过期报成 ' + fresh.stale };
    if (old.stale !== true) return { ok: false, why: '已过期报成 ' + old.stale };
    // 「过期」不等于「失效」：读数仍必须给全（不得因为过期就清空 items）
    if (!old.items || old.reason !== 'ready') return { ok: false, why: '过期被当成失效（读数被清空）' };
    return { ok: true, why: '' };
}

/** J6：诊断面的缺省文案**未知原因如实输出原值**（不静默兜底） */
function jAbsentTextHonest(mod) {
    const t = mod.projAbsentText('__never-seen__');
    return { ok: t === '__never-seen__', why: String(t) };
}

/* ============================================================
 * A. 契约结构面
 * ============================================================ */
test('v300 A1. 模块落地 + 导出面 + 结构版常量', () => {
    assert.ok(fs.existsSync(path.join(ROOT, PC)), PC + ' 未落地');
    assert.equal(PC_MOD.SUPPORTED_API_VERSION, 1, '本仓只认结构版 1');
    for (const k of ['contractOf', 'readProjection', 'projectionValue', 'projectionLine']) {
        assert.equal(typeof PC_MOD[k], 'function', '缺导出 ' + k);
    }
    assert.ok(Array.isArray(PC_MOD.ENVELOPE_FIELDS) && PC_MOD.ENVELOPE_FIELDS.length === 11);
    assert.ok(Object.isFrozen(PC_MOD.ENVELOPE_FIELDS), '字段清单必须冻结（防消费方就地改真源）');
    assert.deepEqual(PC_MOD.CONTRACT_STATES.slice().sort(), ['ahead', 'behind', 'malformed', 'missing', 'ok']);
    assert.ok(PC_MOD.default && typeof PC_MOD.default === 'object', 'default 面须有（本仓模块一贯形制）');
});

test('v300 A2. readProjection 结构恒定：无宿主 / 畸形输入一律不抛且同形', () => {
    const shape = (o) => Object.keys(o).sort().join(',');
    const base = shape(PC_MOD.readProjection({}, { snapshot: null }));
    const cases = [
        PC_MOD.readProjection(),
        PC_MOD.readProjection(null, { snapshot: 123 }),
        PC_MOD.readProjection({}, { snapshot: snap('not-an-object') }),
        PC_MOD.readProjection({}, { snapshot: { get projection() { throw new Error('boom'); } } }),
        PC_MOD.readProjection({}, { snapshot: snap({}) })
    ];
    for (const c of cases) {
        assert.equal(shape(c), base, '结构漂移（消费方要判 undefined 了）');
        assert.equal(typeof c.reason, 'string');
        assert.ok(c.text && c.text.length > 0, '每态都要有可读文案');
    }
});

test('v300 A3. 三态分面：given 显值 / withheld 显原因且绝不给值（J1）', () => {
    const r = jWithheldNeverGivesValue(PC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v300 A4. 管线缺席与「跑了但空」分开报；源空仍是「有值（空）」（J2）', () => {
    const r = jPipelineAbsentStaysSeparate(PC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v300 A5. 契约五态裁定：超前 / 偏旧 / 畸形 / 缺席逐态可达（J3 / J4）', () => {
    const a = jAheadIsNotReady(PC_MOD);
    assert.equal(a.ok, true, a.why);
    const b = jMissingFieldsRejected(PC_MOD);
    assert.equal(b.ok, true, b.why);
});

test('v300 A6. 过期只如实报 stale，不偷偷重算也不清读数（J5）', () => {
    const r = jStaleIsReportedNotFixed(PC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v300 A7. 无投影面：与「声明了但空」分得开（declaredAbsent 如实带出）', () => {
    const noFace = PC_MOD.readProjection({}, { snapshot: { meta: { fieldTypes: {} } } });
    assert.equal(noFace.reason, 'no-projection-face');
    assert.equal(noFace.declaredAbsent, true, '上游没声明过这项 ⇒ declaredAbsent=true（旧版插件形态）');
    const oldFace = PC_MOD.readProjection({}, { snapshot: snap(undefined, false) });
    assert.equal(oldFace.reason, 'no-projection-face');
    assert.equal(oldFace.declaredAbsent, true, '上游明说 present=false（这面是空）');
});

test('v300 A8. 取快照只许经统一探针（本文件不得自摸桥全局 / 不得自写形态判据）', () => {
    const src = read(PC);
    const code = src.split('\n').filter((l) => !/^\s*\*|^\s*\/\*|^\s*\/\//.test(l)).join('\n');
    assert.ok(code.includes("from './world-bridge.js'"), '必须从真源导入探针');
    assert.ok(code.includes('readPushProbe('), '取快照必须经 readPushProbe');
    for (const bad of ['lonsha_memory_bridge_v1', 'worldaxis_bridge_v1']) {
        assert.ok(!code.includes(bad), '桥名字面量不得出现在本文件（第九道门 J1 口径）：' + bad);
    }
    assert.ok(!/\.snapshot\s*&&\s*typeof/.test(code), '不得自写形态判据（J4 口径）');
    assert.ok(!/typeof\s+\w+\.snapshot\s*===\s*'function'/.test(code), '不得自判推/拉型');
});

test('v300 A9. 一句话总述如实：就绪态报三态计数与扣下项，非就绪态报归因', () => {
    const face = env({
        items: { clockDay: 41 },
        visibility: { clockDay: 'given', promiseKeys: 'withheld' },
        sourceLedger: {
            available: true, bound: true, reason: 'partial',
            absent: [{ id: 'promiseKeys', reason: 'skipped' }],
            summary: { total: 2, ok: 1, empty: 0, absent: 1, skipped: 0 }
        }
    });
    const line = PC_MOD.projectionLine(PC_MOD.readProjection({}, { snapshot: snap(face) }));
    assert.ok(line.includes('1 项有值'), '总述须报有值数：' + line);
    assert.ok(line.includes('扣下 1 项'), '总述须报扣下项：' + line);
    assert.ok(line.includes('promiseKeys'), '总述须点名扣了谁：' + line);
    const bad = PC_MOD.projectionLine(PC_MOD.readProjection({}, { snapshot: null }));
    assert.ok(bad.length > 0 && !/就绪/.test(bad), '非就绪态不得报「就绪」：' + bad);
});

/* ============================================================
 * B. 诊断接线面（投影「真被消费」的落点）
 * ============================================================ */
test('v300 B1. 诊断内核新增投影两面，且无宿主下不抛、结构恒定', () => {
    const pkg = DG_MOD.collectDiagnose();
    assert.ok(Object.prototype.hasOwnProperty.call(pkg, 'projection'), '缺 projection 面');
    assert.ok(Array.isArray(pkg.projItems), 'projItems 必须是数组（视图直接 map）');
    assert.equal(pkg.projection && pkg.projection.state, 'absent', '无宿主时投影面应是缺席态');
    assert.ok(String(pkg.projection.reason).length > 0);
});

/** 造一个「宿主 window」：lonsha 推送型桥 + 上游快照（第六面真功能测试用） */
function fakeWin(face) {
    const snapshot = { projection: face, meta: { fieldTypes: { projection: { present: true, kind: 'object' } } } };
    return { lonsha_memory_bridge_v1: { snapshot } };
}

test('v300 B2. 第六面逐项形态：given 项给 kind、withheld 项给原因（视图各取一格）', () => {
    const face = env({
        items: { peopleLocations: { 阿澈: '老城›钟楼' }, factKeys: [] },
        visibility: { peopleLocations: 'given', factKeys: 'given', knowledgeOwners: 'withheld' },
        sourceLedger: {
            available: true, bound: true, reason: 'partial',
            absent: [{ id: 'knowledgeOwners', reason: 'no-provider' }],
            summary: { total: 3, ok: 1, empty: 1, absent: 1, skipped: 0 }
        }
    });
    const pkg = DG_MOD.collectDiagnose(fakeWin(face));
    assert.equal(pkg.projection.reason, 'ready', '探针取到快照后应就绪');
    const byId = {};
    for (const it of pkg.projItems) byId[it.id] = it;
    assert.equal(byId.peopleLocations.kind, 'object', 'given 项须给值形状');
    assert.equal(byId.peopleLocations.present, true);
    assert.equal(byId.factKeys.kind, 'array', '空数组的 given 项仍是「有值」');
    assert.equal(byId.knowledgeOwners.visibility, 'withheld');
    assert.equal(byId.knowledgeOwners.present, false);
    assert.equal(byId.knowledgeOwners.kind, 'withheld');
    assert.equal(byId.knowledgeOwners.reason, 'no-provider', '扣下原因须带出');
});

test('v300 B3. 视图第六面接线：卡片挂进 render，样式类在 CSS 里真实存在', () => {
    const v = read(DG_VIEW);
    assert.ok(v.includes('this._projHtml('), 'render 未挂第六面（做了面却没显示 = 又一例「建好不消费」）');
    assert.ok(v.includes('projectionLine'), '总述未接（视图只吃内核结论的形制）');
    assert.ok(v.includes('projAbsentText'), '缺省文案未接（未知原因会显示成裸英文）');
    const css = read('apps/diagnose/diagnose.css');
    for (const cls of ['dg-note', 'dg-sub', 'dg-table', 'dg-trow', 'dg-key']) {
        assert.ok(css.includes('.' + cls), '视图用了未定义的样式类：' + cls);
    }
});

test('v300 B4. 缺省文案四态齐备，未知原因如实输出原值（J6）', () => {
    for (const k of ['no-provider', 'thrown', 'skipped', 'absent']) {
        const t = DG_MOD.projAbsentText(k);
        assert.ok(t && t !== k, '缺文案：' + k);
    }
    const r = jAbsentTextHonest(DG_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v300 B5. 有坏消息先说坏消息：投影三类坏消息都进总述首行', () => {
    const ahead = env({ projectionApiVersion: 9 });
    const s1 = DG_MOD.summarizeDiagnose(DG_MOD.collectDiagnose(fakeWin(ahead)));
    assert.ok(/^需注意/.test(s1) && s1.includes('升级手机端'), '结构超前须先说：' + s1);
    const bumped = env({
        items: { clockDay: 1 },
        visibility: { clockDay: 'given', promiseKeys: 'withheld' },
        sourceLedger: {
            available: true, bound: true, reason: 'partial',
            absent: [{ id: 'promiseKeys', reason: 'skipped' }],
            summary: { total: 2, ok: 1, empty: 0, absent: 1, skipped: 0 }
        }
    });
    const s2 = DG_MOD.summarizeDiagnose(DG_MOD.collectDiagnose(fakeWin(bumped)));
    assert.ok(/^需注意/.test(s2) && s2.includes('扣下'), '有扣下项须先说：' + s2);
    const gone = env({ sourceLedger: { available: false, bound: true, reason: 'pipeline-absent', absent: [], summary: null } });
    const s3 = DG_MOD.summarizeDiagnose(DG_MOD.collectDiagnose(fakeWin(gone)));
    assert.ok(s3.includes('管线缺席'), '管线缺席与「空的」不得同形：' + s3);
});

test('v300 B6. 面级隔离：投影面取数抛错只空该面，不连坐其余五面', () => {
    const win = {
        lonsha_memory_bridge_v1: {
            get snapshot() { throw new Error('snapshot getter boom'); }
        }
    };
    const pkg = DG_MOD.collectDiagnose(win);
    assert.ok(pkg, '投影面抛错不得让 collectDiagnose 整页失败');
    assert.equal(Array.isArray(pkg.projItems), true, 'projItems 仍须是数组（结构恒定）');
    assert.ok(pkg.bridgeReport, '桥面须仍在');
    assert.ok(Array.isArray(pkg.fields) && pkg.fields.length >= 9, '字段面须仍在');
});

/* ============================================================
 * C. 跨仓契约一致性（第三份：上游实现 / 下游实现 / 本判据）
 * ============================================================ */
test('v300 C1. envelope 必填字段与上游同清单（跨仓契约快照）', () => {
    /* 上游 projection-pipeline.js 的 ENVELOPE_FIELDS（v3.212.0 实测）。
     *   改这份清单**必须同时抬 projectionApiVersion**，否则旧下游会把新结构读成「没有这项」。 */
    const UPSTREAM = [
        'projectionApiVersion', 'projectionVersion', 'generatedAt',
        'conversationId', 'sceneId', 'worldId',
        'items', 'visibility', 'sourceLedger', 'revision', 'expiresAt'
    ];
    assert.deepEqual(PC_MOD.ENVELOPE_FIELDS.slice(), UPSTREAM, '下游字段清单与上游漂移了');
    assert.equal(PC_MOD.default.SUPPORTED_API_VERSION, 1, '结构版同源');
});

test('v300 C2. 身份三键与 revision：取不到一律 null，不硬编占位', () => {
    /* 夹具：必填字段**在场且为 null**（上游「没给」的真实形态就是 null —— 不是删字段；
     *   删字段会走畸形分支，那样测的是「缺必填字段」，判据会假红）。 */
    const bare = env({ conversationId: null, sceneId: null, worldId: null, revision: null });
    assert.equal(PC_MOD.contractOf(bare).state, 'ok', '夹具本身必须是一份可用的 envelope（否则测的不是这条）');
    const pj = PC_MOD.readProjection({}, { snapshot: snap(bare) });
    assert.equal(pj.reason, 'ready');
    assert.equal(pj.identity.conversationId, null, '取不到必须是 null（不得空串冒充「没提供」）');
    assert.equal(pj.identity.sceneId, null);
    assert.equal(pj.identity.worldId, null);
    assert.equal(pj.revision, null, 'revision 非数不得硬编 0（0 是合法栅栏号，会与「没给」同形）');
    const real = PC_MOD.readProjection({}, { snapshot: snap(env({ revision: 0 })) });
    assert.equal(real.revision, 0, '真的 0 必须如实保留');
});

test('v300 C3. 消费侧不得依赖账本内部字段（只吃 envelope）', () => {
    const code = read(PC).split('\n').filter((l) => !/^\s*\*|^\s*\/\*|^\s*\/\//.test(l)).join('\n');
    for (const inner of ['worldLedger', 'scene-book', 'public-interface', 'status.characters']) {
        assert.ok(!code.includes(inner), '契约要求「只消费投影」，不得摸上游内部面：' + inner);
    }
    assert.ok(code.includes('sourceLedger'), '归因必须从 sourceLedger 取（读数元数据就进这里）');
});

/* ============================================================
 * D. 版本与读数面
 * ============================================================ */
test('v300 D1. 五源同源且主次版本为 3.0（当版精确判定；补丁位留给后续版本）', () => {
    const log = JSON.parse(read('update-log.json'));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read(IDX).match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, man.version, 'update-log.latest 与 manifest 同源');
    assert.equal(man.version, pkg.version, 'package 与 manifest 同源');
    assert.equal(pkg.version, m[1], '入口常量与 manifest 同源');
    assert.equal(Object.keys(log.versions)[0], log.latest, 'versions 首键即当前版本');
    const a = String(log.latest).split('.').map((n) => Number.parseInt(n, 10) || 0);
    assert.equal(a[0] === 3 && a[1] === 0 && a[2] >= 0, true, '本版是主版本跳跃：实得 ' + log.latest);
    assert.ok(vnum(log.latest) >= vnum(CURRENT), '不低于 ' + CURRENT);
});

test('v300 D2. release note 与内置弹窗逐字同源 + 写到本版 + 保留收尾条', () => {
    const log = JSON.parse(read('update-log.json'));
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
    assert.equal(entry.version, log.latest);
    /* [v3.0.2] 「发布说明须提到本版落地项」必须锚**本套件的出生版本**，不能锚 `log.latest`：
     *   锚当版等于对**以后每一版**下一次永久约束（v3.0.2 的说明自然不会重复「投影/契约/诊断」
     *   这三个词），每次抬版都要回来改历史测试 —— 本仓 v298 E2 已立同一口径。
     *   而「弹窗逐字同源」那半仍锚**当版**（它比的是此刻 index.js 里的弹窗与该版条目）。 */
    const own = log.versions['3.0.0'];
    assert.ok(own && Array.isArray(own.items), 'v3.0.0 条目必须仍在（本判据钉的是历史事实）');
    const all = own.items.join('\n');
    for (const kw of ['投影', '契约', '诊断']) {
        assert.ok(all.includes(kw), '变更说明未提到本版落地项：' + kw);
    }
    assert.ok(all.includes(own.version), 'release note 须出现本版版本号');
    assert.ok(/版本升至/.test(all), '须保留「版本升至 X」的收尾条（仓内一贯格式）');
    const idxSrc = read(IDX);
    const blk = idxSrc.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(blk, 'ST_PHONE_CURRENT_UPDATE 可提取');
    for (const item of entry.items) {
        assert.ok(blk[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 24) + '…');
    }
    assert.match(blk[0], new RegExp('date: "' + entry.date + '"'), 'date 同源');
});

test('v300 D3. 文档面不说谎：迭代日志元信息与 TODO 指向本版', () => {
    const iter = read('ITERATION_LOG.md');
    const man = JSON.parse(read('manifest.json'));
    const m = /- \*\*当前版本\*\*：`([0-9.]+)`/.exec(iter);
    assert.ok(m, '元信息须有「当前版本」一行');
    assert.equal(m[1], man.version, '迭代日志元信息与 manifest 不一致（文档已腐坏）');
    assert.ok(iter.includes('迭代 32'), '本版迭代段未登记');
    const todo = read('TODO.md');
    assert.ok(!/（下一步）\*\*跨仓投影契约（L-F5）\*\*/.test(todo), 'TODO 仍把已交付项写成待办');
});

test('v300 D4. 死导出读数如实：本版新增 1 处 export default（95 → 96）', () => {
    /* 这一条锁的是**本版造成的读数漂移**，不是门禁本身。
     *   构成：config/projection-contract.js 的 `export default { … }`（对象字面量，
     *   无具名成员可对账，落在 UNHANDLED_ALLOWLIST 的准入形）。故白名单认领数 95 → 96。
     *   将来再漂移时，由**当版套件**接管这两个数字（v268-P1 / v273-P2 交棒给本版）。 */
    let out = '';
    try {
        out = execFileSync('node', ['scripts/dead-export-check.mjs'], { cwd: ROOT, encoding: 'utf8' });
    } catch (e) {
        out = String(e.stdout || '') + String(e.stderr || '');
        assert.fail('死导出门禁未通过：' + out.slice(0, 400));
    }
    assert.match(out, /无具名成员 96/, '白名单认领数应随本版 +1：\n' + out);
    assert.match(out, /未识别 0/, '枚举面完整性不得破：\n' + out);
});

/* ============================================================
 * E/F. 负控制与镜像自证
 *
 * 为什么用**浅镜像**（config/ + apps/）而不是全量镜像：
 *   本套件的破坏面只涉及这两个目录，两处都**自足**（projection-contract.js 只 import
 *   config/world-bridge.js，diagnose-data.js 只 import config/* 与 apps/diagnose/*）。
 *   自足性不是推理出来的：F0 在**未破坏**的镜像上把五条判据全跑一遍，缺文件会当场红
 *   （本仓历史上两次假绿正是因为副本树缺文件而「没找到文件」被当成通过）。
 * ============================================================ */
const MIRROR_DIRS = ['config', 'apps'];
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v300-mir-'));
    for (const d of MIRROR_DIRS) {
        fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    }
    for (const [rel, fn] of Object.entries(mut)) {
        const body = fn(read(rel));
        assert.notEqual(body, read(rel), '破坏未发生（锚点没命中）：' + rel);
        fs.writeFileSync(path.join(dir, rel), body);
    }
    return dir;
}
function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 70));
    return src.replace(from, to);
}
async function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const loadMirror = (dir, rel) => import(pathToFileURL(path.join(dir, rel)).href + '?m=' + Date.now());

test('v300 F0. 镜像树自证：未破坏时五条判据全为真（否则 E 组是假绿）', async () => {
    await withMirror({}, async (dir) => {
        const pc = await loadMirror(dir, PC);
        const dg = await loadMirror(dir, DG_DATA);
        const rs = [
            ['J1', jWithheldNeverGivesValue(pc)],
            ['J2', jPipelineAbsentStaysSeparate(pc)],
            ['J3', jAheadIsNotReady(pc)],
            ['J4', jMissingFieldsRejected(pc)],
            ['J6', jAbsentTextHonest(dg)]
        ];
        for (const [name, r] of rs) assert.equal(r.ok, true, name + ' 在未破坏的镜像上就红了（假绿警戒）：' + r.why);
    });
});

test('v300 E1. 负控制：withheld 分面被拆掉 ⇒ J1 在副本上转红', async () => {
    await withMirror({
        [PC]: (s) => mutateOnce(s, "if (v === 'withheld') {", 'if (false) {')
    }, async (dir) => {
        const pc = await loadMirror(dir, PC);
        assert.equal(jWithheldNeverGivesValue(PC_MOD).ok, true, '原版上 J1 必须为真（阳性对照）');
        const r = jWithheldNeverGivesValue(pc);
        assert.equal(r.ok, false, '扣下的投影被当成有值，J1 却没转红');
        assert.ok(/扣下|given 面|withheld/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v300 E2. 负控制：管线缺席守卫被拆 ⇒ J2 在副本上转红', async () => {
    await withMirror({
        [PC]: (s) => mutateOnce(s, 'const pipelineAbsent = !!(sl && sl.available === false);', 'const pipelineAbsent = false;')
    }, async (dir) => {
        const pc = await loadMirror(dir, PC);
        assert.equal(jPipelineAbsentStaysSeparate(PC_MOD).ok, true, '原版上 J2 必须为真（阳性对照）');
        const r = jPipelineAbsentStaysSeparate(pc);
        assert.equal(r.ok, false, '「没跑」被伪装成「跑了但空」，J2 却没转红');
        assert.ok(/缺席|空|ready/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v300 E3. 负控制：结构版裁定被摘 ⇒ J3 在副本上转红（旧下游把新结构读成就绪）', async () => {
    await withMirror({
        [PC]: (s) => mutateOnce(s, 'if (api > SUPPORTED_API_VERSION)', 'if (false)')
    }, async (dir) => {
        const pc = await loadMirror(dir, PC);
        assert.equal(jAheadIsNotReady(PC_MOD).ok, true, '原版上 J3 必须为真（阳性对照）');
        const r = jAheadIsNotReady(pc);
        assert.equal(r.ok, false, '结构超前被按就绪处理，J3 却没转红');
        assert.ok(/超前|ready|ok/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v300 E4. 负控制：必填字段检查被摘 ⇒ J4 在副本上转红', async () => {
    await withMirror({
        [PC]: (s) => mutateOnce(
            s,
            'const missing = ENVELOPE_FIELDS.filter((k) => !Object.prototype.hasOwnProperty.call(env, k));',
            'const missing = [];')
    }, async (dir) => {
        const pc = await loadMirror(dir, PC);
        assert.equal(jMissingFieldsRejected(PC_MOD).ok, true, '原版上 J4 必须为真（阳性对照）');
        const r = jMissingFieldsRejected(pc);
        assert.equal(r.ok, false, '缺必填字段仍被判可用，J4 却没转红');
        assert.ok(/malformed|missing|畸形/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v300 E5. 负控制：未知原因兜底成固定串 ⇒ J6 在副本上转红', async () => {
    await withMirror({
        [DG_DATA]: (s) => mutateOnce(
            s,
            "return PROJ_ABSENT_TEXT[reason] || String(reason || '未知');",
            "return PROJ_ABSENT_TEXT[reason] || '未知';")
    }, async (dir) => {
        const dg = await loadMirror(dir, DG_DATA);
        assert.equal(jAbsentTextHonest(DG_MOD).ok, true, '原版上 J6 必须为真（阳性对照）');
        const r = jAbsentTextHonest(dg);
        assert.equal(r.ok, false, '未知原因被兜底成固定串，J6 却没转红');
        assert.equal(r.why, '未知', '转红形态须是「原值丢了」：' + r.why);
    });
});
