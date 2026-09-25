/**
 * tests/system-v319.test.mjs — 沉默降级告警面：三类沉默各一句话 [v3.4.2 · F-5]
 *
 * 背景：本仓所有上游读数面都有各自的「坏消息」出口（桥未连接 / 投影缺席 / 注入被裁），
 *   但**有一类坏消息没有任何出口：什么都没发生**。三类具体形态：
 *     ① 桥在、快照也读得到，但**久未更新**（每张卡都显示「就绪」，数据停在半小时前）；
 *     ② 注入**连续多轮停在 pending**（每轮都「还没结束」，没有一轮落地）；
 *     ③ 投影**长期 empty**（上游管线在跑，但每轮都没装成）。
 *   三者都不是报错、页面上没有一行是红的 —— 这正是它们危险的原因：
 *   **沉默的降级与沉默的正常，在读数上长得一模一样。**
 *
 * 口径纪律（本模块的三条 + 一条特有的「台账不是读数缓存」）：
 *   ① 只读（不自己摸桥：取数口仍是诊断中心）；② 不抛（任何面坏掉降级为空表）；
 *   ③ 不猜（拿不到时刻就不判、不给「一切正常」的绿灯结论）；
 *   ④ 台账只记**计数与轮次身份**，不记读数内容 —— 它不产生陈旧读数、也不构成第二份真源。
 *
 * 覆盖：
 *   A 内核面（阈值表 / 导出齐全 / 台账字段不含读数内容 / 不弹窗的源码证据）
 *   B 行为面（三类沉默各造真场景 + 各造一次「不该报」的反场景）
 *   C 视图接线面（诊断卡片存在、零告警不出绿灯结论、Import 接线）
 *   D 负控制（真源码破坏 → 破坏副本上重跑同款真判据）
 *   E 版本锚（五源同源）
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const SG_SRC = read('config/silence-guard.js');
const VIEW_SRC = read('apps/diagnose/diagnose-view.js');
const DATA_SRC = read('apps/diagnose/diagnose-data.js');

/** 真源码加载（去 export 前缀不适用：本文件已是 ESM；直接落盘加载，不手抄） */
async function loadGuard(mutator) {
    let src = SG_SRC;
    if (typeof mutator === 'function') src = mutator(src);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v319-sg-'));
    const file = path.join(dir, 'silence-guard.mjs');
    writeFileSync(file, src);
    return import('file://' + file);
}
const M = await loadGuard();
const mkWin = () => ({});   // 假宿主窗口（WeakMap 键；每个用例独立一份，互不串账）

/** 三类都正常的包 */
const okPkg = () => ({
    at: Date.now(), snapshotAt: Date.now(), probeSelf: { mounted: true },
    injection: { outcome: 'completed', round: 1 },
    projection: { reason: 'ready', sourceLedger: { available: true }, visibility: { a: 'given' } }
});

/* ══════════════ A 内核面 ══════════════ */
test('v319 A1. ★★ 阈值表显式且三项齐备（阈值即判据，必须能在源码里读出来）', () => {
    const T = M.SILENCE_THRESHOLDS;
    assert.equal(T.snapshotStaleMs, 5 * 60 * 1000, '① 快照陈旧阈值');
    assert.equal(T.pendingStreak, 3, '② pending 连续轮数阈值');
    assert.equal(T.emptyStreak, 3, '③ empty 连续轮数阈值');
    assert.match(SG_SRC, /export const SILENCE_THRESHOLDS = Object\.freeze\(/, '阈值表须冻结导出');
});

test('v319 A1b. ★★★ 告警 id 键形必须是连字符形且来自单源常量（v2.98 表键漂移同族）', () => {
    /* 第九道门 J7 把这条判在门禁上（*_TEXT 表不得手写键），本套件把它判在内核面上：
     *   ① 常量必须导出（调用方按 id 分辨三类，不许各处手写字符串）；
     *   ② 值必须是连字符形（本仓真源归因常量一律这个形状）；
     *   ③ 文案表必须用计算键（源码证据）。 */
    const ids = M.SILENCE_ALERT_IDS;
    assert.ok(ids && typeof ids === 'object', 'ID 常量必须导出');
    assert.deepEqual(Object.values(ids).sort(), ['pending-streak', 'projection-empty', 'stale-snapshot'], '三个 id 值形');
    for (const [k, v] of Object.entries(ids)) {
        assert.match(v, /^[a-z]+(-[a-z]+)+$/, k + ' 必须是连字符形（下划线形与真源常量不同形 ⇒ 查不到、静默走兜底）');
    }
    assert.match(SG_SRC, /\[SILENCE_ALERT_IDS\.staleSnapshot\]:/, '文案表须用计算键（J7）');
    assert.equal(/^\s+stale_snapshot:/m.test(SG_SRC), false, '不得出现下划线形裸键');
});

test('v319 A2. ★★★ 台账**不是读数缓存**：只含计数与轮次身份，不得出现读数内容', async () => {
    const w = mkWin();
    M.resetSilenceLedger(w);
    M.noteSilenceCycle(w, {
        snapshotAt: 12345, at: 99999,
        injection: { outcome: 'pending', round: 3, blocks: [{ id: 'x', kept: true }] },
        projection: { reason: 'ready', sourceLedger: { available: false }, items: { a: 1 } }
    });
    const face = M.silenceLedgerFace(w);
    assert.deepEqual(Object.keys(face).sort(),
        ['cycles', 'emptyLastRoundKey', 'emptyStreak', 'pendingLastRound', 'pendingStreak'].sort(),
        '台账面字段须恰好是「计数 + 轮次身份」');
    /* 不得把读数内容带进来（注入块 / 投影项 / 快照本体都不许出现） */
    const txt = JSON.stringify(face);
    for (const bad of ['blocks', 'kept', 'items', '"a"', 'exportedAt']) {
        assert.equal(txt.includes(bad), false, '台账不得含读数内容：' + bad);
    }
    /* 源码面：模块头必须写明「台账不是读数缓存」这条口径（否则会被「不缓存读数」的铁律误伤） */
    assert.match(SG_SRC, /台账不是读数缓存/, '须写明这条口径');
});

test('v319 A3. ★★★ 不弹窗：模块与视图都不得出现弹窗/通知调用', () => {
    /* 三类沉默都是上游或宿主那边的事，弹窗提示用户也做不了什么 ——
     *   把「安静地降级」换成「吵闹地降级」。故在源码面把它钉住。 */
    for (const [label, src] of [['silence-guard', SG_SRC], ['diagnose-view', VIEW_SRC]]) {
        for (const bad of ['alert(', 'toast', 'Notification', 'confirm(', 'notify(']) {
            assert.equal(src.includes(bad), false, label + ' 不得出现弹窗/通知：' + bad);
        }
    }
    assert.match(SG_SRC, /不弹窗/, '口径须写明不弹窗');
});

/* ══════════════ B 行为面 ══════════════ */
test('v319 B1. ★★★ 三类都正常 ⇒ 零告警（不给「一切正常」的绿灯结论，只给空表）', () => {
    const w = mkWin();
    M.resetSilenceLedger(w);
    for (let i = 0; i < 5; i++) M.noteSilenceCycle(w, okPkg());
    assert.deepEqual(M.silenceAlerts(w, okPkg()), [], '正常时必须是空表');
    assert.equal(M.silenceSummary([]), '', '空表的总述必须是空串（不是「一切正常」）');
});

test('v319 B2. ★★★ ① 快照陈旧：桥在 + 超阈值 ⇒ 报警；桥未挂 ⇒ 不报（未挂载不是沉默）', () => {
    const w = mkWin();
    M.resetSilenceLedger(w);
    const stale = { at: Date.now(), snapshotAt: Date.now() - 40 * 60 * 1000, probeSelf: { mounted: true } };
    const a = M.silenceAlerts(w, stale);
    assert.equal(a.length, 1, '陈旧须报一条');
    assert.equal(a[0].id, 'stale-snapshot');
    assert.match(a[0].text, /40 分钟没有更新/, '文案须带实测分钟数');
    assert.equal(a[0].evidence.ageMs >= M.SILENCE_THRESHOLDS.snapshotStaleMs, true, '证据须给实测 age');
    assert.equal(a[0].evidence.thresholdMs, M.SILENCE_THRESHOLDS.snapshotStaleMs, '证据须给阈值');
    /* 反场景：桥没挂上 ⇒ 不算沉默（此刻的「没有新数据」是如实状态） */
    assert.deepEqual(M.silenceAlerts(w, { ...stale, probeSelf: { mounted: false } }), [], '桥未挂不得报');
    /* 反场景：拿不到导出时刻 ⇒ 不判（不猜） */
    assert.deepEqual(M.silenceAlerts(w, { at: Date.now(), probeSelf: { mounted: true } }), [], '无时刻不得报');
});

test('v319 B3. ★★★ ② 注入连续 pending：第 3 轮起报警；同一轮重复 render 不得凑阈值', () => {
    const w = mkWin();
    M.resetSilenceLedger(w);
    const ids = [];
    for (let i = 0; i < 4; i++) {
        const pkg = { at: Date.now(), injection: { outcome: 'pending', round: i } };
        M.noteSilenceCycle(w, pkg);
        ids.push(M.silenceAlerts(w, pkg).map((x) => x.id).join(',') || '-');
    }
    assert.deepEqual(ids, ['-', '-', 'pending-streak', 'pending-streak'],
        '★ 连续 3 轮才报（第 3 轮起），这是「跨轮计数」的唯一可观测面');

    /* 反场景：同一轮被 render 10 次 ⇒ 只算一轮（否则多开关几次诊断页就把阈值凑满） */
    const w2 = mkWin();
    M.resetSilenceLedger(w2);
    const pkg = { at: Date.now(), injection: { outcome: 'pending', round: 7 } };
    for (let i = 0; i < 10; i++) M.noteSilenceCycle(w2, pkg);
    assert.deepEqual(M.silenceAlerts(w2, pkg), [], '同一轮重复 render 不得报');
    assert.equal(M.silenceLedgerFace(w2).pendingStreak, 1, '同一轮只计一次');
});

test('v319 B4. ★★★ ② 离开 pending 即清零（完成 / 中止 / 无读数三条路径都要清）', () => {
    for (const [label, after] of [['completed', { outcome: 'completed', round: 9 }],
        ['aborted', { outcome: 'aborted', round: 9 }], ['无读数', null]]) {
        const w = mkWin();
        M.resetSilenceLedger(w);
        for (let i = 0; i < 3; i++) M.noteSilenceCycle(w, { injection: { outcome: 'pending', round: i } });
        const pkg = { injection: after };
        M.noteSilenceCycle(w, pkg);
        assert.deepEqual(M.silenceAlerts(w, pkg).filter((x) => x.id === 'pending-streak'), [],
            label + ' 之后不得仍报 pending 连续');
        assert.equal(M.silenceLedgerFace(w).pendingStreak, 0, label + ' 之后计数须清零');
    }
});

test('v319 B5. ★★★ ③ 投影长期 empty：第 3 轮起报警；但「没跑」（pipeline-absent）不算空', () => {
    const w = mkWin();
    M.resetSilenceLedger(w);
    const ids = [];
    for (let i = 0; i < 4; i++) {
        const pkg = { at: Date.now(), snapshotAt: 1000 + i, injection: { outcome: 'completed' },
            projection: { reason: 'ready', sourceLedger: { available: false }, visibility: {} } };
        M.noteSilenceCycle(w, pkg);
        ids.push(M.silenceAlerts(w, pkg).map((x) => x.id).join(',') || '-');
    }
    assert.deepEqual(ids, ['-', '-', 'projection-empty', 'projection-empty'], '连续 3 轮才报');
    assert.match(M.silenceAlerts(w, { snapshotAt: 1000, projection: { reason: 'ready', sourceLedger: { available: false }, visibility: {} } })[0].text,
        /连续 4 轮/, '文案须带实测轮数');

    /* 反场景：管线没跑（pipeline-absent）⇒ 与「跑了但空」处置相反，不得算空 */
    const w2 = mkWin();
    M.resetSilenceLedger(w2);
    for (let i = 0; i < 5; i++) M.noteSilenceCycle(w2, { snapshotAt: 1 + i, projection: { reason: 'pipeline-absent', visibility: {} } });
    assert.deepEqual(M.silenceAlerts(w2, { snapshotAt: 99, projection: { reason: 'pipeline-absent', visibility: {} } })
        .filter((x) => x.id === 'projection-empty'), [], 'pipeline-absent 不得报 empty');

    /* 反场景：有投影装成 ⇒ 清零 */
    const w3 = mkWin();
    M.resetSilenceLedger(w3);
    for (let i = 0; i < 3; i++) M.noteSilenceCycle(w3, { snapshotAt: 100 + i, projection: { reason: 'ready', sourceLedger: { available: true }, visibility: { a: 'withheld' } } });
    const good = { snapshotAt: 200, projection: { reason: 'ready', sourceLedger: { available: true }, visibility: { a: 'given' } } };
    M.noteSilenceCycle(w3, good);
    assert.deepEqual(M.silenceAlerts(w3, good).filter((x) => x.id === 'projection-empty'), [], '有装成即清零');
});

test('v319 B6. ★★ 不抛 + 不连坐：垃圾输入一律降级为空表', () => {
    const w = mkWin();
    M.resetSilenceLedger(w);
    let threw = false;
    try {
        M.silenceAlerts(w, null); M.silenceAlerts(w, 42); M.silenceAlerts(w, 'x');
        M.silenceAlerts(w, { projection: 'x', injection: [], probeSelf: 'y', snapshotAt: {} });
        M.noteSilenceCycle(w, 'junk'); M.noteSilenceCycle(w, { injection: [] });
        M.silenceLedgerFace(null); M.resetSilenceLedger(null);
    } catch (_e) { threw = true; }
    assert.equal(threw, false, '诊断面自己坏掉不得连坐主流程');
    assert.deepEqual(M.silenceAlerts(w, 'junk'), [], '垃圾入参须降级为空表');
});

test('v319 B7. ★★ ③ 轮次身份缺 fast-path 时的保守口径：宁可晚报，不可噪声报警', () => {
    /* 拿不到快照导出时刻时按「每两轮算一轮」——因为此时无法区分「新的一轮」与「又被 render 了一次」。 */
    const w = mkWin();
    M.resetSilenceLedger(w);
    const pkg = { at: Date.now(), projection: { reason: 'ready', sourceLedger: { available: false }, visibility: {} } };
    let firstAlertAt = -1;
    for (let i = 0; i < 10; i++) {
        M.noteSilenceCycle(w, pkg);
        if (firstAlertAt < 0 && M.silenceAlerts(w, pkg).some((x) => x.id === 'projection-empty')) firstAlertAt = i + 1;
    }
    assert.ok(firstAlertAt >= 3, '★ 保守口径下不得早于第 3 轮报警，实测第 ' + firstAlertAt + ' 轮');
    /* 且**必须**最终报出来（保守不等于不报 —— 那会变成漏报） */
    assert.ok(firstAlertAt > 0, '保守口径最终必须报出来');
});

/* ══════════════ C 视图接线面 ══════════════ */
test('v319 C1. ★★★ 诊断视图接线：先记账再算告警，且告警卡在有坏消息时置于最前', () => {
    const iNote = VIEW_SRC.indexOf('noteSilenceCycle(');
    const iAlerts = VIEW_SRC.indexOf('silenceAlerts(');
    assert.ok(iNote > 0 && iAlerts > 0, '视图必须接这两个出口');
    assert.ok(iNote < iAlerts, '★ 必须先记账再算告警（反了「连续 3 轮」永远差一轮）');
    assert.match(VIEW_SRC, /silence\.length > 0/, '零告警与有告警须分流');
    /* 告警卡的位置：必须在第一个上游卡片（上游桥）之前。
     *   注意锚点要用**渲染串**里的标题（`沉默降级告警</h3>`），不能用裸词 ——
     *   首版找裸词命中的是文件头注释里那句说明（注释当然在最前），于是判据测的是「注释的位置」。
     *   同一份判据在改对锚点前是**假绿**：它永远成立，与卡片实际位置无关。 */
    const iCard = VIEW_SRC.indexOf('沉默降级告警</h3>');
    const iBridges = VIEW_SRC.indexOf('上游桥</h3>');
    assert.ok(iCard > 0 && iBridges > 0, '两个卡片标题都必须在渲染串里（iCard=' + iCard + ' / iBridges=' + iBridges + '）');
    assert.ok(iCard < iBridges, '★ 告警卡须置于最前（有坏消息先说坏消息），实测 ' + iCard + ' vs ' + iBridges);
    /* 零告警时只在「本来就有坏消息」的情形下出提示，且不得写成绿灯结论 */
    assert.equal(/本轮未观察到三类沉默[\s\S]{0,80}一切正常/.test(VIEW_SRC), false, '不得给绿灯结论');
});

test('v319 C2. ★★ 取数口唯一：告警模块不得自己摸桥（不新增第二个取数点）', () => {
    for (const bad of ['world-bridge', 'readPushProbe', 'lonsha_memory_bridge', 'SillyTavern']) {
        assert.equal(SG_SRC.includes(bad), false, 'silence-guard 不得自己取快照：' + bad);
    }
    /* 而快照导出时刻必须由诊断中心取好带出来（否则「陈旧」这一条永远判不了） */
    assert.match(DATA_SRC, /const snapshotAt = \(\(\) => \{/, '诊断中心须带出 snapshotAt');
    assert.match(DATA_SRC, /snapshot && snapshot\.exportedAt/, '取法须来自快照真源字段');
    assert.match(DATA_SRC, /return \{ at, snapshotAt,/, '须进返回包');
});

test('v319 C3. ★★★ 三个导出**真接线**（不许靠登记豁免）：每条出口都有产品消费点', () => {
    /* 本版在 dead-export 门禁上被当场抓到：silenceLedgerFace / resetSilenceLedger / silenceSummary
     *   三个导出「建好了却没人用」。修法不是往基线账本里登记理由（那是把欠债记成资产），
     *   而是**接线**：台账面进诊断卡（回答「这几轮是怎么数出来的」）、清零给用户动作、
     *   总述给控制器。本判据把「接线」这件事钉住，防止后人为了过门禁改成登记。 */
    const APP_SRC = read('apps/diagnose/diagnose-app.js');
    assert.match(VIEW_SRC, /silenceLedgerFace\(/, '台账面须被诊断卡消费');
    assert.match(VIEW_SRC, /resetSilenceLedger\(/, '清零须有产品出口');
    assert.match(APP_SRC, /silenceSummary\(/, '总述须被控制器消费');
    assert.match(APP_SRC, /silenceAlerts\(/, '控制器须有告警出口（不经视图也能读）');
    /* 反证：不得出现在死导出基线账本里 */
    const ledger = read('scripts/dead-export-baseline.json');
    for (const n of ['silenceLedgerFace', 'resetSilenceLedger', 'silenceSummary', 'silenceAlerts', 'noteSilenceCycle']) {
        assert.equal(ledger.includes('"' + n + '"'), false, '★ ' + n + ' 不得被登记为冻结项（应真接线）');
    }
});
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

test('v319 N1. ★★★ 破坏「跨轮计数」（把 pending 去重拆掉）⇒ B3 同款判据必须转红', async () => {
    const anchor = 'const sameRoundAsBefore = (round !== null && round === pend.lastRound);';
    assert.equal(SG_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const B = await loadGuard((s) => {
        const out = s.replace(anchor, 'const sameRoundAsBefore = false;');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    });
    const w = mkWin();
    B.resetSilenceLedger(w);
    const pkg = { at: Date.now(), injection: { outcome: 'pending', round: 7 } };
    for (let i = 0; i < 10; i++) B.noteSilenceCycle(w, pkg);
    assert.throws(() => assert.deepEqual(B.silenceAlerts(w, pkg), [], '同一轮重复 render 不得报'),
        isAssertionFailure, 'B3 同款判据在破坏副本上必须抛');
    assert.equal(B.silenceLedgerFace(w).pendingStreak, 10, '（破坏已生效：同一轮被计了 10 次）');
});

test('v319 N2. ★★★ 破坏「移出 pending 即清零」⇒ B4 同款判据必须转红', async () => {
    const anchor = "else pend.streak = 0;                 // 离开 pending 即清零（含 completed/aborted/无读数）";
    assert.equal(SG_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const B = await loadGuard((s) => {
        const out = s.replace(anchor, 'else pend.streak = pend.streak;');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    });
    const w = mkWin();
    B.resetSilenceLedger(w);
    for (let i = 0; i < 3; i++) B.noteSilenceCycle(w, { injection: { outcome: 'pending', round: i } });
    const done = { injection: { outcome: 'completed', round: 3 } };
    B.noteSilenceCycle(w, done);
    assert.throws(() => assert.equal(B.silenceLedgerFace(w).pendingStreak, 0, '完成之后计数须清零'),
        isAssertionFailure, 'B4 同款判据在破坏副本上必须抛');
    assert.ok(B.silenceLedgerFace(w).pendingStreak > 0, '（破坏已生效：计数没被清零）');
});

test('v319 N3. ★★★ 破坏「不猜」（把 pipeline-absent 也算成空）⇒ B5 同款判据必须转红', async () => {
    const anchor = "if (pj.reason !== 'ready') return false;               // 只有「跑过」才谈空";
    assert.equal(SG_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const B = await loadGuard((s) => {
        const out = s.replace(anchor, 'if (false) return false;');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    });
    const w = mkWin();
    B.resetSilenceLedger(w);
    for (let i = 0; i < 5; i++) B.noteSilenceCycle(w, { snapshotAt: 1 + i, projection: { reason: 'pipeline-absent', visibility: {} } });
    const al = B.silenceAlerts(w, { snapshotAt: 99, projection: { reason: 'pipeline-absent', visibility: {} } });
    assert.throws(() => assert.deepEqual(al.filter((x) => x.id === 'projection-empty'), [], 'pipeline-absent 不得报 empty'),
        isAssertionFailure, 'B5 同款判据在破坏副本上必须抛');
    assert.ok(al.some((x) => x.id === 'projection-empty'), '（破坏已生效：没跑被当成了空）');
});

/* ══════════════ E 版本锚 ══════════════ */
test('v319 E1. ★ 版本五源同源（入口 / manifest / package / update-log.latest / versions 首键）', () => {
    const idx = read('index.js');
    const ver = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.ok(ver, '入口版本常量在场');
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    assert.equal(JSON.parse(read('package.json')).version, ver, 'package 同源');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, ver, 'update-log.latest 同源');
    assert.equal(Object.keys(ul.versions)[0], ver, '★ versions 首键即当前版本');
});

test('v319 E2. ★ 已激活包一致（宿主机夹具可用：installRuntimeHost 在场）', () => {
    resetHostFlags();
    const host = installRuntimeHost({ chatMetadata: {} });
    assert.ok(host && host.context, '夹具可用（本套件的存在前提）');
});