/* ========================================================
 * system-v4113.test.mjs — [v4.112.0 · 第十三期 R13-X1] 「今天」：把散在各 app 里的事收成一条时间轴
 * --------------------------------------------------------
 * 本套件守的是 R13-X1 的验收（计划书 §1 该项原文 + §5 共同验收）：
 *   A 口径：边界先定死并写进条目（剧情日 0 点切、不退回墙钟）、排序口径写在数据里；
 *   B 行归一：at 不可用 / 没有 id / 不在今天，三件事**分开记**（丢弃 ≠ 正常过滤）；
 *   C 聚合：最近在前、同刻按源序稳定、五态互不塔缩、截断要记账；
 *   D 接线：取钟只走 time-source、视图五态各自画、跳转不写做不到的承诺；
 *   E 负控制（真源码破坏）：抹掉 id 检查 ⇒ 点不回去的条目进时间轴；写死排序方向 ⇒ 口径声明变假。
 *
 * 【本期计划书点名的两条验收在本套件的位置】
 *   ① 「今天」的边界必须先定死并写进条目  ⇒ A2（同时核术语件头注与算法件真读口径）；
 *   ② 负控制：把其中一条的 at 改早，排序必须变 ⇒ C2（手工对照）；另有 E2 做真源码破坏，
 *      证明「方向由数据决定」不是只在判据里写了一遍。
 *
 * 【本套件自己抓到过的三种判据失真形（写下来防复发）】
 *   · 用「两段数据」测排序规则的破坏方向 ⇒ 比较符号不变，规矩坏没坏不可观测，必用三段以上；
 *   · 破坏只改比较器一支 ⇒ 比较器不对称（cmp(a,b) 与 cmp(b,a) 反号），必须两支同改或改方向源；
 *   · 用区间内数据测 `at <= 0` 那一支 ⇒ 该支其实不可达（区间已排除），破坏也不可观测，
 *     故 B1 用**含 0 的伪区间**（-1e15 … 1e15）才能真正接通那一支。
 * ============================================================ */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ } } });

const TM = await import(path.join(ROOT, 'config', 'today-terms.js'));
const RW = await import(path.join(ROOT, 'config', 'today-rows.js'));
const TL = await import(path.join(ROOT, 'config', 'today-timeline.js'));
const AppMod = await import(path.join(ROOT, 'apps', 'clock', 'clock-app.js'));
const ViewMod = await import(path.join(ROOT, 'apps', 'clock', 'clock-view.js'));

/** 固定时刻（本地时间构造：带 Z 会因时区让 getHours 漂）。 */
const T0 = new Date(2026, 9, 1, 10, 0, 0).getTime();
const HOUR = 3600000;

/* ══════════ A 口径（边界先定死） ══════════ */

test('A1 术语件是零 import 叶子，五态 / 三源态 / 四源 / 四 kind 各自闭集且互不重名', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'today-terms.js'), 'utf8');
    assert.equal(/^\s*import\s/m.test(src), false, '口径件必须是零 import 叶子（调边界不许牵到算法）');
    assert.equal(Object.keys(TM.TODAY_STATES).length, 5);
    assert.equal(new Set(Object.values(TM.TODAY_STATES)).size, 5, '五态必须互不同名（重名就是塔缩的入口）');
    assert.equal(Object.keys(TM.TODAY_SOURCE_STATES).length, 3);
    assert.deepEqual([...TM.TODAY_SOURCES], ['wechat', 'calendar', 'diary', 'album']);
    /* 源序不只是展示序：它是同刻并列时的稳定次序，改它就是改时间轴的写法。 */
    assert.equal(new Set(TM.TODAY_SOURCES).size, TM.TODAY_SOURCES.length);
    assert.deepEqual(Object.values(TM.TODAY_KINDS).sort(), ['diary', 'memo', 'message', 'photo']);
    assert.equal(TM.TODAY_LIMITS.maxEvents, 40);
    assert.equal(TM.TODAY_ORDER.byRecentFirst, true);
});

test('A2 边界口径写进条目：剧情日 0 点切，三条理由在场，且明确不退回墙钟', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'today-terms.js'), 'utf8');
    /* 计划书硬要求：「今天」的边界必须先定死并写进条目。没写下来的边界等于没定。 */
    assert.ok(src.includes('剧情日的 0 点切'), '必须明文写下边界');
    assert.ok(src.includes('不退回墙钟'), '必须写明读不到时钟时的处置');
    assert.ok(src.includes('睡眠周期') && src.includes('世界历'), '另外两种切法要写明为何不选');
    assert.ok(src.includes('需要'), '要写明「没定义就不实现」的理由');
    assert.ok(src.includes('no-clock'), '读不到要落到具体状态名');
});

test('A3 时钟读不到就不算边界：App 侧返回 null，**不拿墙钟顶替**', () => {
    const app = new AppMod.ClockApp({}, mkStorage());
    withHost({}, () => {
        /* 无 timeManager：storyNow 的 ok 为 false，边界必须定不下来。 */
        assert.equal(app._todayRange(), null, '读不到剧情钟必须返回 null');
    });
    withHost({ timeManager: { getCurrentStoryTime: () => ({ date: '', time: '', timestamp: 0 }) } }, () => {
        assert.equal(app._todayRange(), null, '空时钟面也必须当读不到');
    });
    withHost({ timeManager: { getCurrentStoryTime: () => ({ date: '2043-05-01', time: '23:10', timestamp: T0 }) } }, () => {
        const r = app._todayRange();
        assert.ok(r && r.start > 0 && r.end > r.start);
        /* 半开区间且恰好一天（夏令时区除外；本机固定时区下 24h）。 */
        const d0 = new Date(r.start);
        assert.equal(d0.getHours(), 0);
        assert.equal(d0.getMinutes(), 0);
        assert.equal(r.end - r.start, 24 * HOUR);
    });
});

test('A4 排序口径写在数据里，算法件必须真读它（不是写死一个方向）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'today-timeline.js'), 'utf8');
    assert.ok(src.includes('TODAY_ORDER.byRecentFirst'), '排序方向必须读口径表');
    /* 反方向写法（写死 desc）必须不存在 —— 否则那句「口径写在数据里」就是假的。 */
    assert.equal(/desc\s*=\s*true\s*;/.test(src), false, '不许把方向写死');
});

/* ══════════ B 行归一（丢弃 ≠ 正常过滤） ══════════ */

test('B1 at 不可用或 ≤0 当场丢弃并记账（不给 0 充数）', () => {
    /* ★ 区间故意包含 0：否则 `at <= 0` 那一支不可达（区间已把它排除），破坏了也看不见。 */
    const got = RW.collectSource('diary', [
        { at: 0, id: 'zero' },
        { at: 'abc', id: 'nan' },
        { id: 'no-at' },
        { at: T0, id: 'good', title: '好的' }
    ], -1e15, 1e15);
    assert.equal(got.rows.length, 1);
    assert.equal(got.rows[0].id, 'good');
    assert.equal(got.dropped, 3, '三条时刻不可用的都要记账');
    assert.equal(got.mounted, true);
    /* 0 不许被排进 1970：它以「丢弃」的形态消失，而不是以「最早一条」的形态出现。 */
    assert.equal(got.rows.some((r) => r.id === 'zero'), false);
});

test('B2 没有 id 就不收：点不回去的条目进时间轴，就是让用户点死链', () => {
    const got = RW.collectSource('wechat', [
        { at: T0, id: '', title: '没有 id' },
        { at: T0, id: 'c1:m1', title: '有 id' }
    ], T0 - 1000, T0 + 1000);
    assert.equal(got.rows.length, 1);
    assert.equal(got.dropped, 1);
});

test('B3 不在今天记 outOfRange，**不算丢弃**（正常过滤不许报警）', () => {
    const got = RW.collectSource('calendar', [
        { at: T0 - 5 * HOUR, id: 'old' },
        { at: T0 + 5 * HOUR, id: 'future' },
        { at: T0, id: 'in' }
    ], T0 - HOUR, T0 + HOUR);
    assert.equal(got.rows.length, 1);
    assert.equal(got.outOfRange, 2);
    assert.equal(got.dropped, 0, '历史列表很长不等于「丢了很多条」');
});

test('B4 没接上来 ≠ 今天没事：未登记源与非数组都报 mounted:false', () => {
    assert.equal(RW.collectSource('life', [], 0, 1).mounted, false, '未登记源整源不收');
    assert.equal(RW.collectSource('diary', null, 0, 1).mounted, false, 'null 是没接上来');
    assert.equal(RW.collectSource('diary', { length: 3 }, 0, 1).mounted, false, '伪数组也是没接上来');
    assert.equal(RW.collectSource('diary', [], 0, 1).mounted, true, '空数组是接上了、只是今天没有');
});

test('B5 标题超长要截断加省略号（不静默截）', () => {
    assert.equal(RW.titleOf('  '), '');
    assert.equal(RW.titleOf('短标题'), '短标题');
    const long = '雨'.repeat(100);
    const t = RW.titleOf(long);
    assert.equal(t.length, TM.TODAY_LIMITS.titleMaxChars + 1);
    assert.ok(t.endsWith('…'));
});

/* ══════════ C 聚合 ══════════ */

const DAY0 = new Date(2026, 9, 1, 0, 0, 0).getTime();
const DAY1 = DAY0 + 24 * HOUR;

function build(sources) { return TL.buildToday({ start: DAY0, end: DAY1, sources: sources }); }

test('C1 时间轴最近在前；同刻按源序 → 源内序号（两次跑逐字相同）', () => {
    const res = build({
        wechat: [{ at: T0 + HOUR, id: 'c1:m1' }, { at: T0 + HOUR, id: 'c1:m2' }],
        calendar: [{ at: T0 + HOUR, id: 'mm1' }],
        diary: [{ at: T0 + 2 * HOUR, id: 'd1' }]
    });
    assert.equal(res.state, TM.TODAY_STATES.ok);
    assert.deepEqual(res.events.map((e) => e.id), ['d1', 'c1:m1', 'c1:m2', 'mm1']);
    /* 重跑一次，逐字相同（稳定性不是可选项：判据直接比序列）。 */
    const again = build({
        wechat: [{ at: T0 + HOUR, id: 'c1:m1' }, { at: T0 + HOUR, id: 'c1:m2' }],
        calendar: [{ at: T0 + HOUR, id: 'mm1' }],
        diary: [{ at: T0 + 2 * HOUR, id: 'd1' }]
    });
    assert.deepEqual(again.events.map((e) => e.id), res.events.map((e) => e.id));
});

test('C2 ★计划书点名：把其中一条的 at 改早，排序必须变', () => {
    const before = build({
        wechat: [{ at: T0 + 1 * HOUR, id: 'a' }],
        calendar: [{ at: T0 + 2 * HOUR, id: 'b' }],
        diary: [{ at: T0 + 3 * HOUR, id: 'c' }]
    });
    assert.deepEqual(before.events.map((e) => e.id), ['c', 'b', 'a']);
    /* 只把 c 的 at 改早（内容、条数、源都不动）。 */
    const after = build({
        wechat: [{ at: T0 + 1 * HOUR, id: 'a' }],
        calendar: [{ at: T0 + 2 * HOUR, id: 'b' }],
        diary: [{ at: T0 - 3 * HOUR, id: 'c' }]
    });
    assert.deepEqual(after.events.map((e) => e.id), ['b', 'a', 'c'], '改早之后必须跑到最后');
    assert.notDeepEqual(after.events.map((e) => e.id), before.events.map((e) => e.id), '排序必须真的变');
});

test('C3 五态：absent 与 empty 处置相反，不许压成一句', () => {
    /* 一个源都没接：取数面本身不在。 */
    const absent = build({});
    assert.equal(absent.state, TM.TODAY_STATES.absent);
    /* 全接上了、今天真的什么都没有。 */
    const empty = build({ wechat: [], calendar: [], diary: [], album: [] });
    assert.equal(empty.state, TM.TODAY_STATES.empty);
    /* 只接上一个、今天还没有事：还不能说「今天没事」。 */
    const partly = build({ wechat: [] });
    assert.equal(partly.state, TM.TODAY_STATES.partly);
    /* 边界定不下来：不排时间轴，但源状态照报。 */
    const noClock = TL.buildToday({ start: 0, end: 0, sources: { wechat: [] } });
    assert.equal(noClock.state, TM.TODAY_STATES.noClock);
    assert.equal(noClock.events.length, 0);
    assert.equal(noClock.sourceRows.find((r) => r.source === 'wechat').state, TM.TODAY_SOURCE_STATES.ok,
        '算不出边界时也要如实报源状态，否则界面会说成「今天没事」');
    const set = new Set([absent.state, empty.state, partly.state, noClock.state]);
    assert.equal(set.size, 4, '四态必须互不同形');
});

test('C4 截断要记账：41 条只排 40 条，并如实报被截掉多少', () => {
    const many = [];
    for (let i = 0; i < 41; i += 1) many.push({ at: DAY0 + (i + 1) * 1000, id: 'd' + i });
    const res = build({ diary: many });
    assert.equal(res.events.length, TM.TODAY_LIMITS.maxEvents);
    assert.equal(res.truncated, 1);
    const line = TL.todayLine(res);
    assert.ok(line.includes('另有 1 条没排进来'), '截断必须在读数里说出来：' + line);
});

test('C5 五态读数互不同形（同一句话不能同时被两种处境拿去用）', () => {
    const texts = {};
    for (const st of [TM.TODAY_STATES.ok, TM.TODAY_STATES.empty, TM.TODAY_STATES.partly,
        TM.TODAY_STATES.absent, TM.TODAY_STATES.noClock]) {
        texts[st] = TL.todayLine({ state: st, events: [], truncated: 0, sourceRows: [] });
        assert.ok(String(texts[st]).trim().length > 0, st + ' 必须有自己的说法');
    }
    assert.equal(new Set(Object.values(texts)).size, 5, '五态读数必须两两不同形');
    /* 「不等于今天没事」这类诚实句只能出现在三种「算不出来」里，不许出现在 empty。 */
    assert.equal(texts[TM.TODAY_STATES.empty].includes('不等于今天没事'), false);
    assert.ok(texts[TM.TODAY_STATES.noClock].includes('不等于今天没事'));
    assert.ok(texts[TM.TODAY_STATES.absent].includes('不等于今天没事'));
});

/* ══════════ D 接线（取钟、五态画法、跳转诚实边界） ══════════ */

test('D1 App 侧取钟只走 time-source：不许直接读 Date.now 当今天', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'clock', 'clock-app.js'), 'utf8');
    assert.ok(src.includes("from '../../config/time-source.js'"), '取钟必须接 time-source 取数口');
    assert.ok(src.includes('storyNow('), '必须用 storyNow 读剧情钟');
    assert.equal(src.includes('Date.now('), false, 'App 侧不许直接读墙钟当今天边界');
    /* 墙钟退回不仅不能写在 today 路径上，连注释里也不许留下「回退到墙钟」的口子。 */
    assert.equal(/storyNowWallFallback\s*\(/.test(src), false, '不许用墙钟回退口');
});

test('D2 App 侧「没接上」与「钟读不到」分开报：live0 判定必须在场', () => {
    const app = new AppMod.ClockApp({}, mkStorage());
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'clock', 'clock-app.js'), 'utf8');
    assert.ok(src.includes('live0'), '必须区分「一个源都没有」与「源在但钟读不到」');
    /* 端到端两种情形：无宿主 ⇒ absent；源在但无钟 ⇒ no-clock。 */
    withHost({}, () => {
        const r = app.today();
        assert.equal(r.state, TM.TODAY_STATES.absent, '无宿主应当 absent，不得报 no-clock');
        assert.ok(r.line.includes('不等于今天没事'));
    });
    const host = mkHostWithSources();
    withHost(host, () => {
        const r = app.today();
        assert.equal(r.state, TM.TODAY_STATES.noClock, '源在但钟读不到应当 no-clock');
        assert.equal(r.events.length, 0);
        assert.ok(r.line.includes('边界定不下来'));
    });
});

test('D3 App 侧四源取数：今天的事件全收，区间外的正常过滤', () => {
    const host = mkHostWithSources({ withClock: true });
    const app = new AppMod.ClockApp({}, mkStorage());
    withHost(host, () => {
        const r = app.today();
        assert.equal(r.state, TM.TODAY_STATES.ok, JSON.stringify(r.sourceRows));
        const ids = r.events.map((e) => e.id).sort();
        assert.deepEqual(ids, ['c1:m1', 'd1', 'mm1']);
        const row = r.sourceRows.find((x) => x.source === 'album');
        assert.equal(row.state, TM.TODAY_SOURCE_STATES.ok);
        assert.equal(row.count, 0, '相册这一条是历史数据（无 storyAt），不能拿墙钟顶替');
        assert.ok(row.dropped >= 1, '无 storyAt 的相片要记账为丢弃');
    });
});

test('D4 视图：五态各自画，且两种「不等于没事」不得与 empty 同形', () => {
    const view = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.ok), {}, mkStorage());
    const okHtml = view._todayHtml();
    assert.ok(okHtml.includes('cl-today'));
    /* 源状态逐行：没接入的那一行必须写「还没有接入今天」。 */
    assert.ok(okHtml.includes('还没有接入今天'));
    const emptyView = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.empty), {}, mkStorage());
    const absView = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.absent), {}, mkStorage());
    const ncView = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.noClock), {}, mkStorage());
    assert.notEqual(emptyView._todayHtml(), absView._todayHtml(), 'empty 与 absent 不许画成一个样子');
    assert.notEqual(emptyView._todayHtml(), ncView._todayHtml(), 'empty 与 no-clock 不许画成一个样子');
    assert.ok(ncView._todayHtml().includes('不等于今天没事'));
});

test('D5 视图：读数取不出来（抛错）不得冒充「今天没事」', () => {
    const app = fakeApp(TM.TODAY_STATES.ok);
    app.today = () => { throw new Error('boom'); };
    const view = new ViewMod.ClockView(app, {}, mkStorage());
    const html = view._todayHtml();
    assert.ok(html.includes('等不等于今天没事') || html.includes('这不等于今天没事'));
    const emptyApp = fakeApp(TM.TODAY_STATES.empty);
    assert.notEqual(html, new ViewMod.ClockView(emptyApp, {}, mkStorage())._todayHtml());
});

test('D6 跳转诚实边界：只写「打开 X」，不写做不到的「打开这一条」', () => {
    const view = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.ok), {}, mkStorage());
    const html = view._todayHtml();
    assert.ok(html.includes('data-today-app='), '必须走 phone:openApp 派发');
    assert.equal(html.includes('打开这一条'), false, '四源 App 都没有 openRef 定位口，不许承诺');
    const src = fs.readFileSync(path.join(ROOT, 'apps', 'clock', 'clock-view.js'), 'utf8');
    assert.ok(src.includes('TODAY_JUMP_APP'));
    assert.ok(src.includes("CustomEvent('phone:openApp'"), '必须派发官方跳转事件，不自造路');
});

test('D7 时刻人话：读不出来就说读不出来，不编一个日期', () => {
    const view = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.ok), {}, mkStorage());
    assert.equal(view._todayTime(0), '时间不可知');
    assert.equal(view._todayTime(null), '时间不可知');
    assert.equal(view._todayTime('abc'), '时间不可知');
    assert.equal(view._todayTime(T0), '10:00');
});

test('D8 页签：两屏共用一条页签，默认页是「今天」，未识别 key 回到今天', () => {
    const view = new ViewMod.ClockView(fakeApp(TM.TODAY_STATES.ok), {}, mkStorage());
    assert.deepEqual(view._tabs().map((t) => t.key), ['today', 'clock']);
    assert.equal(view._tab, 'today');
    view._switchTab('clock');
    assert.equal(view._tab, 'clock');
    view._switchTab('bogus');
    assert.equal(view._tab, 'today', '未识别 key 必须回到今天，不留一个画不出来的页');
});

/* ══════════ E 负控制（真源码破坏） ══════════ */

function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4113_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of ['num-gate.js', 'today-terms.js', 'today-rows.js', 'today-timeline.js']) {
        fs.copyFileSync(path.join(ROOT, 'config', f), path.join(dir, 'config', f));
    }
    return dir;
}

function damage(rel, from, to) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

test('E1 破坏「没有 id 就不收」⇒ 点不回去的条目进了时间轴（判据必须看得见）', async () => {
    const dir = damage('config/today-rows.js',
        'if (!id) { dropped += 1; continue; }',
        'if (!id) { dropped += 1; }');
    const broke = await import(path.join(dir, 'config', 'today-rows.js'));
    const raw = [{ at: T0, id: '', title: '没有 id' }, { at: T0, id: 'd1', title: '有 id' }];
    /* 原版：一条死链都不交。 */
    assert.deepEqual(RW.collectSource('diary', raw, T0 - 1000, T0 + 1000).rows.map((r) => r.id), ['d1']);
    /* 破坏版：空 id 进了 rows —— 用户点上去就是一个死链。 */
    const bad = broke.collectSource('diary', raw, T0 - 1000, T0 + 1000);
    assert.ok(bad.rows.some((r) => r.id === ''), '破坏后空 id 进了 rows（证明破坏生效）');
});

test('E2 破坏「排序方向读口径」⇒ 口径声明的方向不再管事', async () => {
    /* 破坏方式：把方向写死成与 TODAY_ORDER 相反的值。
     *   注意**不能只改比较器一支**（那会造出不对称比较器，排序变成垃圾）。
     *   这里只改方向源的本体，比较器一字不动。 */
    const dir = damage('config/today-timeline.js',
        'const desc = TODAY_ORDER.byRecentFirst !== false;',
        'const desc = TODAY_ORDER.byRecentFirst === false;');
    const broke = await import(path.join(dir, 'config', 'today-timeline.js'));
    const src = { diary: [{ at: T0 + 2 * HOUR, id: 'late' }, { at: T0, id: 'early' }] };
    /* 原版：最近在前。 */
    assert.deepEqual(TL.buildToday({ start: DAY0, end: DAY1, sources: src }).events.map((e) => e.id),
        ['late', 'early']);
    /* 破坏版：方向反过来（若如实报口径已失效，且不再是最近在前）。 */
    assert.deepEqual(broke.buildToday({ start: DAY0, end: DAY1, sources: src }).events.map((e) => e.id),
        ['early', 'late'], '★ 方向由数据决定 —— 这一条不红，那句声明就是假的');
});

/* ══════════ 造 App / 造宿主（不碰 DOM：本套件只验数据与串） ══════════ */

function mkStorage() {
    const store = new Map();
    return {
        get: (k) => (store.has(k) ? store.get(k) : null),
        set: (k, v) => { store.set(k, v); return true; },
        remove: (k) => { store.delete(k); return true; }
    };
}

/** 跑一段在指定宿主下的代码（本仓取数口读的是 window.VirtualPhone）。 */
function withHost(vp, fn) {
    const prev = globalThis.VirtualPhone;
    globalThis.VirtualPhone = vp;
    try { return fn(); } finally {
        if (prev === undefined) delete globalThis.VirtualPhone;
        else globalThis.VirtualPhone = prev;
    }
}

/** 四源齐备的假宿主；`withClock` 决定剧情钟能不能读。 */
function mkHostWithSources(opt) {
    const o = opt || {};
    const todayMs = T0;
    const yesterday = T0 - 26 * HOUR;
    const vp = {
        wechatApp: {
            wechatData: {
                data: { chats: [{ id: 'c1', name: '阿莲' }, { id: 'c2', name: '老王' }] },
                getMessages: (cid) => (cid === 'c1'
                    ? [{ id: 'm1', content: '今天的事', storyAt: todayMs }]
                    : [{ id: 'm9', content: '昨天的事', storyAt: yesterday }])
            }
        },
        calendarApp: {
            calendarData: {
                getMemos: () => ([
                    { id: 'mm1', title: '交房租', time: '18:00', storyAt: todayMs },
                    { id: 'mm0', title: '旧日程', storyAt: yesterday }
                ])
            }
        },
        diaryApp: {
            diaryData: {
                getEntries: () => ([
                    { id: 'd1', title: '今天写的', storyAt: todayMs },
                    { id: 'd0', title: '昨天写的', storyAt: yesterday }
                ])
            }
        },
        albumApp: {
            albumData: {
                /* 历史数据：只有墙钟 createdAt、没有 storyAt —— 它必须被当作「时刻不可用」。 */
                getMedia: () => ([{ id: 'p1', filename: 'a.jpg', createdAt: todayMs }])
            }
        }
    };
    if (o.withClock) {
        vp.timeManager = {
            getCurrentStoryTime: () => ({ date: '2043-05-01', time: '20:00', timestamp: todayMs })
        };
    }
    return vp;
}

/** 视图用的假 App：只给 _todayHtml 所需的最小面。 */
function fakeApp(state) {
    const okRow = { source: 'diary', label: '日记', state: TM.TODAY_SOURCE_STATES.ok, count: 1, dropped: 0 };
    const offRow = { source: 'album', label: '照片', state: TM.TODAY_SOURCE_STATES.absent, count: 0, dropped: 0 };
    const res = {
        state: state,
        events: [{
            at: T0, source: 'diary', sourceLabel: '日记', id: 'd1', kind: TM.TODAY_KINDS.diary, title: '今天写的'
        }],
        sourceRows: [okRow, offRow],
        truncated: 0, dropped: 0,
        line: TL.todayLine({
            state: state, events: [], truncated: 0,
            sourceRows: state === TM.TODAY_STATES.absent ? [offRow] : [okRow, offRow]
        }),
        readError: ''
    };
    return {
        settings: { injectToPrompt: false, showDiagnostics: false },
        today: () => res,
        clockFace: () => 'bridge-absent',
        projection: () => null,
        sourceFace: () => null,
        saveSettings: () => true
    };
}
