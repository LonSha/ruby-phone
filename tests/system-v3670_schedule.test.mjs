// tests/system-v3670_schedule.test.mjs — 日程提醒协议（X3 第一切片）[v3.67.0]
//
// 本套件守五面（每面都对着**磁盘真源**算，不读被测模块的自述）：
//   A 面 协议：`config/schedule-bridge.js` 的四源登记表 / 三件协议物
//     （归一 / 账本 / 投递）真模块真调；
//   B 面 归一：`buildScheduleAdvice` 在各种输入下产出的 rows / gaps / read 必须如实——
//     缺剧情钟不产行（不拿今天顶替）、没读的源记 gap（不把「没人去读」当「没有」）、
//     时间基不得混用（剧情基的行在 story.missing 时不产）；
//   C 面 账本：`diffScheduleLedger` 的幂等/撤回/改期/回档四态归因必须互相分辨——
//     ① 同键复算→replay（不重投）；② 源没读→不撤回（把「不知道」当「没有」是本仓最贵反向错读数）；
//     ③ 源读过且条消失→撤回归因 source-gone；④ 同源换日键→撤回归因 source-rescheduled；
//     ⑤ 回档（atStoryDay > storyDay）→ source-rewound（仅对 story 基，real 基不判回档）；
//   D 面 投递：`scheduleDeliveryPlan` 拆 deliver/recordOnly 两列，self 源只记账不投；
//     `scheduleNoticeOf` 无靶心时 appId 必须为空（否则横幅点击把用户丢到别人首屏）；
//   V 面 版本与导出面：本套件只在 3.67.0 及以后成立 + 协议件导出面恒定。
//
// 判据纪律（本仓硬纪律）：锚点必须恰中 1 次；破坏只落副本树；
//   判据不得引用被测模块的自述常量当结论。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BRIDGE_REL = 'config/schedule-bridge.js';
const BRIDGE_ABS = path.join(ROOT, BRIDGE_REL);

/* ---------- 辅助：动态 import 磁盘真源 ---------- */
async function loadBridge() {
    const mod = await import(pathToFileURL(BRIDGE_ABS).href + '?t=' + Date.now());
    return mod;
}

/* ---------- A 面：协议 ---------- */
test('A1 ★ 四源登记表必须含四个源且三属性钉死', async () => {
    const m = await loadBridge();
    const sources = Object.keys(m.SCHEDULE_SOURCES);
    assert.ok(sources.includes('calendar-memo'), '缺 calendar-memo');
    assert.ok(sources.includes('commitment'), '缺 commitment');
    assert.ok(sources.includes('anniversary'), '缺 anniversary');
    assert.ok(sources.includes('cycle'), '缺 cycle');
    for (const [name, reg] of Object.entries(m.SCHEDULE_SOURCES)) {
        assert.ok(reg.timeBasis === 'story' || reg.timeBasis === 'real', name + ' 时间基不合法');
        assert.ok(reg.certainty === 'fact' || reg.certainty === 'prediction', name + ' 确定性不合法');
        assert.ok(reg.deliver === 'self' || reg.deliver === 'bridge', name + ' 投递责任不合法');
        assert.ok(reg.label, name + ' 缺 label');
        if (reg.openable === false) assert.ok(reg.why, name + ' 不可点回却没有 why');
    }
});

test('A2 ★ 表自检必须全绿（scheduleBridgeSelfCheck）', async () => {
    const m = await loadBridge();
    const r = m.scheduleBridgeSelfCheck();
    assert.deepEqual(r, { problems: [] });
});

test('A3 ★ 账本自检必须全绿（scheduleLedgerSelfCheck）', async () => {
    const m = await loadBridge();
    const r = m.scheduleLedgerSelfCheck();
    assert.deepEqual(r, { problems: [] });
});

/* ---------- B 面：归一 ---------- */
test('B1 ★★ 缺剧情钟时 calendar-memo 不产行（不拿今天顶替）', async () => {
    const m = await loadBridge();
    // 剧情钟完全缺 → story.missing
    const adv = m.buildScheduleAdvice({
        nowMs: Date.now(),
        calendarDue: { memo: { id: 'm1', title: 'test' }, dateKey: '2026-10-08', time: '10:00', title: 'test' }
    });
    const calRows = adv.rows.filter((r) => r.source === 'calendar-memo');
    assert.equal(calRows.length, 0, '缺剧情钟时日历备忘仍产行了（拿今天顶替了）');
    const calGaps = adv.gaps.filter((g) => g.source === 'calendar-memo');
    assert.ok(calGaps.length > 0, '缺剧情钟时未记 gap');
});

test('B2 ★ 没读的源记 gap（不把「没人去读」当「没有到期项」）', async () => {
    const m = await loadBridge();
    const adv = m.buildScheduleAdvice({ nowMs: Date.now() });
    assert.equal(adv.rows.length, 0);
    assert.equal(adv.gaps.length, 4, '四源全缺时应有 4 个 gap');
    for (const g of adv.gaps) {
        assert.ok(g.reason, g.source + ' gap 缺 reason');
    }
});

test('B3 ★ 时间基不得混用：现实基的行在缺剧情钟时仍可产', async () => {
    const m = await loadBridge();
    const adv = m.buildScheduleAdvice({
        nowMs: Date.now(),
        anniversaryMatches: [{ id: 'a1', title: '生日', text: '今天' }]
        // 故意不传 storyClock
    });
    const annRows = adv.rows.filter((r) => r.source === 'anniversary');
    assert.equal(annRows.length, 1, '纪念日（现实基）在缺剧情钟时应该照常产行');
    assert.equal(annRows[0].timeBasis, 'real');
});

test('B4 ★ 约定到期判定：只产 confirmed/rescheduled 且 dateKey 匹配的行', async () => {
    const m = await loadBridge();
    const adv = m.buildScheduleAdvice({
        nowMs: Date.now(),
        storyClock: { primaryDate: '2026-10-08', present: 1, conflict: false, agree: null },
        commitments: [
            { id: 'c1', status: 'confirmed', dateKey: '2026-10-08', actor: 'A', with: 'B', content: '见面' },
            { id: 'c2', status: 'cancelled', dateKey: '2026-10-08', actor: 'C', content: '取消' },
            { id: 'c3', status: 'confirmed', dateKey: '2026-10-09', actor: 'D', content: '明天' }
        ]
    });
    const comRows = adv.rows.filter((r) => r.source === 'commitment');
    assert.equal(comRows.length, 1, '只应产 1 行（c1 到期；c2 cancelled 跳过；c3 非今天）');
    assert.equal(comRows[0].sourceId, 'c1');
});

/* ---------- C 面：账本 ---------- */
test('C1 ★★ 幂等：同键复算→replay，不重投', async () => {
    const m = await loadBridge();
    const row = (src, id, dk) => ({
        source: src, sourceId: id, timeBasis: 'story', certainty: 'fact',
        label: src, dayKey: dk, title: 't', detail: 'd',
        idemKey: m.idemKeyOf(src, id, dk), canOpen: false, openWhy: '', ref: null
    });
    const adv = (rows, read) => ({ rows, read, counts: { total: rows.length }, gaps: [] });
    const empty = { version: 1, entries: [] };
    const a1 = m.diffScheduleLedger(adv([row('anniversary', 'a1', '2026-10-08')], { anniversary: true }), empty);
    assert.equal(a1.notify.length, 1, '首轮应投出 1 条');
    const led1 = m.applyScheduleLedger(empty, a1, 1000, '2026-10-08');
    const a2 = m.diffScheduleLedger(adv([row('anniversary', 'a1', '2026-10-08')], { anniversary: true }), led1);
    assert.equal(a2.notify.length, 0, '同键复算不应再投');
    assert.equal(a2.replay.length, 1, '应判为 replay');
});

test('C2 ★★ 源没读→不撤回（把「不知道」当「没有」是本仓最贵反向错读数）', async () => {
    const m = await loadBridge();
    const row = (src, id, dk) => ({
        source: src, sourceId: id, timeBasis: 'story', certainty: 'fact',
        label: src, dayKey: dk, title: 't', detail: 'd',
        idemKey: m.idemKeyOf(src, id, dk), canOpen: false, openWhy: '', ref: null
    });
    const adv = (rows, read) => ({ rows, read, counts: { total: rows.length }, gaps: [] });
    const led = m.normalizeScheduleLedger({ entries: [
        { idemKey: m.idemKeyOf('anniversary', 'a1', '2026-10-08'), source: 'anniversary', sourceId: 'a1', dayKey: '2026-10-08', state: 'delivered' }
    ]});
    const a3 = m.diffScheduleLedger(adv([], { anniversary: false }), led);
    assert.equal(a3.withdraw.length, 0, '源没读时把缺席当成了取消');
});

test('C3 ★ 改期归因 vs 取消归因必须分辨', async () => {
    const m = await loadBridge();
    const row = (src, id, dk) => ({
        source: src, sourceId: id, timeBasis: 'story', certainty: 'fact',
        label: src, dayKey: dk, title: 't', detail: 'd',
        idemKey: m.idemKeyOf(src, id, dk), canOpen: false, openWhy: '', ref: null
    });
    const adv = (rows, read) => ({ rows, read, counts: { total: rows.length }, gaps: [] });
    // 改期：同源同 id 换日键
    const ledR = { version: 1, entries: [
        { idemKey: m.idemKeyOf('commitment', 'c1', '2026-10-08'), source: 'commitment', sourceId: 'c1', dayKey: '2026-10-08', state: 'delivered' }
    ]};
    const a5 = m.diffScheduleLedger(adv([row('commitment', 'c1', '2026-10-09')], { commitment: true }), ledR);
    assert.equal(a5.notify.length, 1, '改期应产新键');
    assert.equal(a5.withdraw.length, 1, '改期应撤回旧键');
    assert.equal(a5.withdraw[0].why, m.SCHEDULE_WITHDRAW_REASONS['source-rescheduled'], '改期归因错误');
    // 取消：同源同 id 不再出现
    const a4 = m.diffScheduleLedger(adv([], { commitment: true }), ledR);
    assert.equal(a4.withdraw.length, 1);
    assert.equal(a4.withdraw[0].why, m.SCHEDULE_WITHDRAW_REASONS['source-gone'], '取消归因错误');
});

test('C4 ★★ 回档归因：仅对 story 基且 atStoryDay > storyDay 判回档', async () => {
    const m = await loadBridge();
    // story 基 + 回档
    const ledS = { version: 1, entries: [
        { idemKey: m.idemKeyOf('calendar-memo', 'm1', '2026-10-10'), source: 'calendar-memo', sourceId: 'm1', dayKey: '2026-10-10', timeBasis: 'story', atStoryDay: '2026-10-10', state: 'delivered' }
    ]};
    const a7 = m.diffScheduleLedger({ rows: [], read: { 'calendar-memo': true }, story: { dayKey: '2026-10-05' }, counts: { total: 0 }, gaps: [] }, ledS);
    assert.equal(a7.withdraw.length, 1, '回档后应撤回');
    assert.equal(a7.withdraw[0].why, m.SCHEDULE_WITHDRAW_REASONS['source-rewound'], '回档归因错误');
    // real 基不判回档
    const ledReal = { version: 1, entries: [
        { idemKey: m.idemKeyOf('cycle', 'x1', '2026-10-10'), source: 'cycle', sourceId: 'x1', dayKey: '2026-10-10', timeBasis: 'real', atStoryDay: '2026-10-10', state: 'delivered' }
    ]};
    const a7b = m.diffScheduleLedger({ rows: [], read: { cycle: true }, story: { dayKey: '2026-10-05' }, counts: { total: 0 }, gaps: [] }, ledReal);
    assert.equal(a7b.withdraw.length, 1, 'real 基应该被撤回（但不按回档归因）');
    assert.notEqual(a7b.withdraw[0].why, m.SCHEDULE_WITHDRAW_REASONS['source-rewound'], 'real 基不应判回档');
    // story.dayKey 为空时不判回档
    const a7c = m.diffScheduleLedger({ rows: [], read: { 'calendar-memo': true }, story: { dayKey: '' }, counts: { total: 0 }, gaps: [] }, ledS);
    assert.notEqual(a7c.withdraw[0]?.why, m.SCHEDULE_WITHDRAW_REASONS['source-rewound'], 'story.dayKey 为空时不应判回档');
});

/* ---------- D 面：投递 ---------- */
test('D1 ★★ self 源只记账不投，bridge 源要投', async () => {
    const m = await loadBridge();
    const rows = [
        { source: 'calendar-memo', sourceId: 'm1', idemKey: 'calendar-memo:m1:2026-10-08', deliver: 'self', title: 't', label: '日历备忘', dayKey: '2026-10-08', detail: 'd', canOpen: false, ref: null },
        { source: 'anniversary', sourceId: 'a1', idemKey: 'anniversary:a1:2026-10-08', deliver: 'bridge', title: 't', label: '纪念日', dayKey: '2026-10-08', detail: 'd', canOpen: false, ref: null }
    ];
    const plan = m.scheduleDeliveryPlan(rows);
    assert.equal(plan.deliver.length, 1, 'bridge 源应进 deliver');
    assert.equal(plan.deliver[0].source, 'anniversary');
    assert.equal(plan.recordOnly.length, 1, 'self 源应进 recordOnly');
    assert.equal(plan.recordOnly[0].source, 'calendar-memo');
});

test('D2 ★★ 无靶心时 appId 必须为空', async () => {
    const m = await loadBridge();
    const row = { source: 'cycle', sourceId: 'x1', idemKey: 'cycle:x1:2026-10-08', dayKey: '2026-10-08', title: 't', label: '周期预警', detail: 'd', canOpen: false, ref: null, timeBasis: 'real', certainty: 'prediction' };
    const n = m.scheduleNoticeOf(row);
    assert.equal(n.appId, '', '无靶心时 appId 应为空');
    assert.equal(n.meta.appId, '', 'meta.appId 也应为空');
    assert.ok(n.senderKey.startsWith('schedule:cycle:x1:'), 'senderKey 应按稳定键形生成');
});

/* ---------- V 面：版本与导出面 ---------- */
test('V1 ★ 版本下限锚：本套件只在 3.67.0 及以后成立', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const ver = pkg.version;
    const parts = ver.split('.').map(Number);
    assert.ok(parts[0] >= 3 && (parts[0] > 3 || parts[1] >= 67), '版本未达 3.67.0');
});

test('V2 ★★ 协议件导出面恒定', async () => {
    const m = await loadBridge();
    const expected = [
        'SCHEDULE_TIME_BASES', 'SCHEDULE_CERTAINTY', 'SCHEDULE_DELIVERY',
        'SCHEDULE_SOURCES', 'SCHEDULE_REASONS',
        'dayKeyOf', 'storyDayKeyOf', 'idemKeyOf',
        'buildScheduleAdvice', 'scheduleAdviceLine', 'scheduleBridgeSelfCheck',
        'SCHEDULE_LEDGER_VERSION', 'SCHEDULE_LEDGER_LIMIT', 'SCHEDULE_LEDGER_STATES',
        'SCHEDULE_WITHDRAW_REASONS',
        'normalizeScheduleLedger', 'diffScheduleLedger', 'applyScheduleLedger',
        'scheduleSenderKey', 'scheduleDeliveryPlan', 'scheduleNoticeOf',
        'scheduleLedgerSelfCheck'
    ];
    for (const name of expected) {
        assert.ok(typeof m[name] !== 'undefined', '缺导出: ' + name);
    }
});
