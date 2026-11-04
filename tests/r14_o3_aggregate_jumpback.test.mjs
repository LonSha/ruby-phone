/* ========================================================
 * r14_o3_aggregate_jumpback.test.mjs — [v4.119.0 · 第十四期 R14-O3]
 * 聚合页点回原条目：日记 / 日历备忘的跨 App 靶心
 * --------------------------------------------------------
 * 本套件守的是 R14-O3 的验收：「在聚合面（搜索 / 今天 / 通知中心）看到的那一条，
 *   点下去必须落在**那一条**上」，而不是只把 App 打开到首屏。
 *
 *   A 协议面：`OPEN_REF_KINDS` 必须先登记 diary / calendar，未登记一律不投；
 *   B 源侧：引擎两条源逐条带靶心，且靶心 id 取自真源里的稳定 id（没 id 的条目直接不收）；
 *   C 消费侧：日记 / 日历的 `openRef` 按 id 现找（不按下标），找不到如实报 not_found，
 *     `clearRef` 把定位态真空掉；
 *   D 行归一：`today-rows` 只筛靶心的**形状**（坏值降 null ⇒ 按钮只写「打开 X」）；
 *   E 视图：按钮文案由**靶心在不在**决定（有 ⇒ 「打开这一条」+ data-today-ref；无 ⇒ 「打开 X」）；
 *   F 装配器：投靶心必须在 `render()` 之前（顺序反了详情态画不出来）；
 *   G 负控制：真源码破坏——登记撤掉 / 源侧去靶心 / 文案写死 / 定位乱指，判据必须转红；
 *   H 通知中心：落账层留住靶心、桥接层带到行上、点一条把靶心投出去。
 *
 * 【为什么这些判据不能只测「调用了 openRef」】
 *   本仓最贵的缺陷形态是「不报错、只是默默没生效」：
 *     · 按下标定位 ⇒ 删中间一条后点到邻居头上，一个字都不报；
 *     · 源侧没写 meta.ref ⇒ 搜索面照样能搜到，只是点不回去；
 *     · 文案按源名写死 ⇒ 某天补了口但文案不改（或反过来先承诺、口还没补）；
 *     · 落账层把 meta 收成固定几字段 ⇒ 靶心写进去了却被丢掉，重启后全变「只开 App」。
 *   故 B / C / D / E / H 五面必须各自独立可观测。
 * ======================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REF_REL = 'config/open-ref.js';
const ENGINE_REL = 'apps/memory/global-search-engine.js';
const DIARY_APP_REL = 'apps/diary/diary-app.js';
const CALENDAR_APP_REL = 'apps/calendar/calendar-app.js';
const ROWS_REL = 'config/today-rows.js';
const VIEW_REL = 'apps/clock/clock-view.js';
const INDEX_REL = 'index.js';
const NOTIF_REL = 'config/system-notifications.js';
const BRIDGE_REL = 'config/notification-hub-bridge.js';
const NCVIEW_REL = 'apps/notifications/notification-center-view.js';
const MIN_VERSION = '4.119.0';
/** 本切片新增的两条 kind（与协议件登记表**分开声明**：同源自述恒绿）。 */
const EXPECT_NEW_KINDS = Object.freeze({ diary: 'diary', calendar: 'calendar' });
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const temps = [];
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

/* Node 测试环境注入最小 window 垫片（App 构造期会挂监听器）。 */
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    VirtualPhone: {}
  };
}

/** 内存 storage 替身：只实现本层真正用到的 get/set（与 v216 / v3660 同款）。 */
function mkStorage(seed = {}) {
  const d = Object.assign({}, seed);
  const writes = [];
  return {
    d, writes,
    get(k, dflt = null) { return (k in d) ? d[k] : dflt; },
    set(k, v) { d[k] = v; writes.push({ key: k, value: v }); }
  };
}
function mkTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
async function loadMod(dir, rel) {
  return import(pathToFileURL(path.join(dir, rel)).href + '?v=' + Date.now() + Math.random());
}

/* 三条日记 / 三条备忘：id 是稳定 id 形（与真源同款），**不是下标**。 */
const DIARY_SEED = [
  { id: 'diary_entry_a', date: '2026-11-03', title: '晴空万里', content: '走了一下午', storyAt: 1699000000000, createdAt: 1699000000000 },
  { id: 'diary_entry_b', date: '2026-11-04', title: '细雨微风', content: '在窗边读信', storyAt: 1699100000000, createdAt: 1699100000000 },
  { id: 'diary_entry_c', date: '2026-11-05', title: '起雾了', content: '看不清对面的楼', storyAt: 1699200000000, createdAt: 1699200000000 }
];
const MEMO_SEED = [
  { id: 'calendar_memo_a', title: '星空露营', dateKey: '2026-11-06', time: '20:00', type: 'daily', storyAt: 1699300000000, createdAt: 1699300000000 },
  { id: 'calendar_memo_b', title: '旧书集市', dateKey: '2026-11-07', time: '10:00', type: 'daily', storyAt: 1699400000000, createdAt: 1699400000000 },
  { id: 'calendar_memo_c', title: '取干洗', dateKey: '2026-11-08', time: '15:00', type: 'daily', storyAt: 1699500000000, createdAt: 1699500000000 }
];

/* ══════════════ A 面 协议（config/open-ref.js） ══════════════ */

test('A1 ★★★ 登记表：diary / calendar 逐条登记且归属自洽，自检零问题', async () => {
  const m = await loadMod(ROOT, REF_REL);
  for (const [kind, appId] of Object.entries(EXPECT_NEW_KINDS)) {
    assert.ok(m.OPEN_REF_KINDS[kind], '★ 未登记 kind ⇒ 消费侧怎么接线都是空话：' + kind);
    assert.equal(m.OPEN_REF_KINDS[kind].appId, appId, kind + ' 的归属 App 漂了');
    assert.ok(String(m.OPEN_REF_KINDS[kind].label || '').length > 0, kind + ' 缺 label（诊断视图要用）');
  }
  assert.deepEqual(m.openRefSelfCheck().problems, [], m.openRefSelfCheck().problems.join(' | '));
});

test('A2 ★★ 归一：两条新 kind 各自成立，跨 kind 错配与未登记一律不投', async () => {
  const m = await loadMod(ROOT, REF_REL);
  assert.equal(m.normalizeOpenRef({ kind: 'diary', id: 'd1', appId: 'diary' }).ok, true);
  assert.equal(m.normalizeOpenRef({ kind: 'calendar', id: 'm1', appId: 'calendar' }).ok, true);
  assert.equal(m.normalizeOpenRef({ kind: 'diary', id: 'd1', appId: 'calendar' }).why, m.OPEN_REF_REASONS.APP_MISMATCH,
    '★ 日记靶心投到日历必须被判死（错配会报「这条没了」，用户以为被删）');
  assert.equal(m.normalizeOpenRef({ kind: 'memo', id: 'm1', appId: 'calendar' }).why, m.OPEN_REF_REASONS.KIND_UNKNOWN,
    '★ 未登记的 kind 一律不投');
});

/* ══════════════ B 面 源侧（引擎两条源带靶心） ══════════════ */

function seedStorage() {
  return mkStorage({
    diary_entries: JSON.parse(JSON.stringify(DIARY_SEED)),
    calendar_memos: JSON.parse(JSON.stringify(MEMO_SEED))
  });
}
async function engineSources(storage, dir = ROOT) {
  const eng = await loadMod(dir, ENGINE_REL);
  return eng.buildDefaultSources(storage, {});
}

test('B1 ★★★ 引擎两条源逐条带靶心，且靶心自身归一成立、归属与源一致', async () => {
  const m = await loadMod(ROOT, REF_REL);
  const sources = await engineSources(seedStorage());
  const byId = new Map(sources.map((s) => [s.id, s]));
  for (const sid of ['diary', 'calendar']) {
    assert.ok(byId.has(sid), '★ 源表缺本切片登记的源：' + sid);
    const items = byId.get(sid).items();
    assert.equal(items.length, 3, sid + ' 的 seed 有 3 条却只索引出 ' + items.length + ' 条（源侧没真读到）');
    for (const it of items) {
      const ref = it.meta && it.meta.ref;
      assert.ok(ref, '★ 源条目必须带靶心（否则「搜到了」与「点得回去」之间没有桥）：' + sid);
      const n = m.normalizeOpenRef(ref);
      assert.equal(n.ok, true, '★★ 源侧写出的 ref 必须自身归一成立：' + JSON.stringify(ref) + ' / ' + n.why);
      assert.equal(n.appId, byId.get(sid).appId, '★ 靶心归属必须与源条目所属 App 一致');
    }
  }
});

test('B2 ★★★ 靶心 id 是稳定 id：删中间一条后，剩两条的靶心一字不变', async () => {
  const m = await loadMod(ROOT, REF_REL);
  const idsOf = (items) => items.map((x) => m.normalizeOpenRef(x.meta.ref).id).sort();
  const one = await engineSources(seedStorage());
  const two = seedStorage();
  const diaryCut = two.d.diary_entries.slice();
  diaryCut.splice(1, 1);
  two.d.diary_entries = diaryCut;
  const memoCut = two.d.calendar_memos.slice();
  memoCut.splice(1, 1);
  two.d.calendar_memos = memoCut;
  const after = await engineSources(two);
  const pick = (list, id) => list.find((s) => s.id === id).items();
  assert.deepEqual(idsOf(pick(after, 'diary')), ['diary_entry_a', 'diary_entry_c'],
    '★ 删中间项后剩两条的靶心必须一字不变（按下标生成的会整体前移）');
  assert.deepEqual(idsOf(pick(after, 'calendar')), ['calendar_memo_a', 'calendar_memo_c'],
    '★ 同上：日历靶心也不许按下标生成');
  assert.deepEqual(idsOf(pick(one, 'diary')), ['diary_entry_a', 'diary_entry_b', 'diary_entry_c']);
});

test('B3 ★★ 没有 id 的条目不进索引：点不回去的东西不许出现在搜索面', async () => {
  const st = seedStorage();
  st.d.diary_entries = [{ date: '2026-11-09', title: '无 id 的残片' }].concat(st.d.diary_entries);
  st.d.calendar_memos = [{ title: '无 id 的备忘', dateKey: '2026-11-09' }].concat(st.d.calendar_memos);
  const sources = await engineSources(st);
  const diaryItems = sources.find((s) => s.id === 'diary').items();
  const memoItems = sources.find((s) => s.id === 'calendar').items();
  assert.equal(diaryItems.length, 3, '没有 id 的日记条目必须被过滤掉（搜到了点不回去 = 死链）');
  assert.equal(memoItems.length, 3, '没有 id 的备忘同样必须被过滤掉');
});

/* ══════════════ C 面 消费侧（两个 App 的 openRef / clearRef） ══════════════ */

async function mkDiary(seed = DIARY_SEED) {
  const mod = await loadMod(ROOT, DIARY_APP_REL);
  const inst = new mod.DiaryApp({ screen: {} }, mkStorage({ diary_entries: JSON.parse(JSON.stringify(seed)) }));
  inst.render = () => {};   /* 本层只验「定位态」，不渲染（渲染顺序由 F 面独立守） */
  return inst;
}
async function mkCalendar(seed = MEMO_SEED) {
  const mod = await loadMod(ROOT, CALENDAR_APP_REL);
  const inst = new mod.CalendarApp({ screen: {} }, mkStorage({ calendar_memos: JSON.parse(JSON.stringify(seed)) }));
  inst.render = () => {};
  return inst;
}
async function mkApp(which, seed) {
  return which === 'diary' ? mkDiary(seed) : mkCalendar(seed);
}

const CONSUME = Object.freeze([
  {
    app: 'diary', kind: 'diary', seed: () => DIARY_SEED, mid: 'diary_entry_b', last: 'diary_entry_c',
    peek: (inst) => inst.diaryView.currentEntryId || null
  },
  {
    app: 'calendar', kind: 'calendar', seed: () => MEMO_SEED, mid: 'calendar_memo_b', last: 'calendar_memo_c',
    peek: (inst) => inst.calendarView.detailMemoId || null
  }
]);

test('C1 ★★★ 两件 App 都真接了定位口：同一 id 命中**同一条**，详情态同步', async () => {
  for (const row of CONSUME) {
    const inst = await mkApp(row.app, row.seed());
    assert.equal(typeof inst.openRef, 'function', '★ ' + row.app + ' 没有 openRef ⇒ 靶心投过来会落在 no-open-ref（静默无形）');
    const r = inst.openRef({ kind: row.kind, id: row.mid, appId: row.app });
    assert.equal(r && r.ok, true, '★ ' + row.app + ' 定位未命中：' + JSON.stringify(r));
    assert.equal(row.peek(inst), row.mid, '★ ' + row.app + ' 回报命中了，但详情态**没同步**（「投了但没画出来」本仓最贵形态）');
    assert.equal(inst.openRef({ kind: row.kind, id: 'no_such_id', appId: row.app }).ok, false,
      '★ ' + row.app + ' 对不存在的 id 必须如实报失败（不许静默成功）');
    assert.equal(inst.clearRef().ok, true, row.app + ' 的 clearRef 必须可用');
    assert.equal(row.peek(inst), null, '★ ' + row.app + ' 清掉之后定位态必须真空（防「合上了但定位还在」）');
  }
});

test('C2 ★★★ 删中间项后仍命中同一条（按下标的实现会在这里串项，且不报错）', async () => {
  for (const row of CONSUME) {
    const seed = JSON.parse(JSON.stringify(row.seed()));
    seed.splice(1, 1);
    const inst = await mkApp(row.app, seed);
    const gone = inst.openRef({ kind: row.kind, id: row.mid, appId: row.app });
    assert.equal(gone.ok, false, '★ ' + row.app + ' 对**被删掉的那一条**必须报失败（不是随便指一条）：' + JSON.stringify(gone));
    assert.equal(gone.reason, 'not_found', row.app + ' 的归因词应为 not_found，实得 ' + gone.reason);
    assert.equal(gone.saw, 2, '★ ' + row.app + ' 必须报出「看过几条」，好把空库与投错 id 分开');
    const hit = inst.openRef({ kind: row.kind, id: row.last, appId: row.app });
    assert.equal(hit.ok, true, '★ ' + row.app + ' 删中间项后末条仍须命中：' + JSON.stringify(hit));
    assert.equal(row.peek(inst), row.last, '★★ ' + row.app + ' 命中的**不是**那一条（按下标定位会串到邻居头上）');
  }
});

test('C3 ★★ 空 id 不投：纯空白 / 缺失一律当场判死，不当成「找不到」', async () => {
  for (const row of CONSUME) {
    const inst = await mkApp(row.app, row.seed());
    assert.equal(inst.openRef({ kind: row.kind, id: '   ', appId: row.app }).reason, 'empty_id',
      row.app + ' 对纯空白 id 必须报 empty_id（与 not_found 分开：两者处置相反）');
    assert.equal(inst.openRef(null).ok, false, row.app + ' 对空 ref 不许抛，也不许成功');
  }
});

test('C4 ★★ 日历命中时会**翻到那一页**：视图日期跟着靶心那条走', async () => {
  const inst = await mkCalendar();
  const r = inst.openRef({ kind: 'calendar', id: 'calendar_memo_b', appId: 'calendar' });
  assert.equal(r.ok, true);
  assert.equal(inst.calendarView.selectedDate.year, 2026);
  assert.equal(inst.calendarView.selectedDate.month, 11);
  assert.equal(inst.calendarView.selectedDate.day, 7, '★ 必须落到备忘自己那一天（不落到今天）');
  assert.equal(inst.calendarView.visibleMonth, 11, '★ 月份必须跟着翻（否则详情画在看不见的月份里）');
  assert.equal(inst.calendarView.detailEditMode, false, '定位进来必须是只读详情，不许直接进编辑态');
});

/* ══════════════ D 面 行归一（config/today-rows.js） ══════════════ */

test('D1 ★★★ 行上靶心只筛形状：三字段齐 ⇒ 原样带出；缺一 ⇒ 降 null（按钮退为「打开 X」）', async () => {
  const R = await loadMod(ROOT, ROWS_REL);
  assert.deepEqual(R.refOf({ appId: 'diary', kind: 'diary', id: 'd1', junk: 1 }), { appId: 'diary', kind: 'diary', id: 'd1' },
    '★ 只留三字段（多余字段会随 data 属性走到 HTML 里）');
  assert.equal(R.refOf({ appId: 'diary', kind: 'diary' }), null, '★ 缺 id 不是靶心');
  assert.equal(R.refOf({ appId: 'diary', kind: 'diary', id: '   ' }), null, '★ 纯空白 id 不是靶心');
  assert.equal(R.refOf({ appId: '', kind: 'diary', id: 'd1' }), null);
  assert.equal(R.refOf(null), null);
  assert.equal(R.refOf([]), null, '★ 数组不是靶心（不许当对象收下）');
});

test('D2 ★★★ collectSource 把靶心带到行上（源没给就保持 null，不凭空造一个）', async () => {
  const R = await loadMod(ROOT, ROWS_REL);
  const start = 0, end = 2e12;
  const got = R.collectSource('diary', [
    { at: 1e12, id: 'd1', kind: 'diary', title: '有靶心', ref: { appId: 'diary', kind: 'diary', id: 'd1' } },
    { at: 1e12, id: 'd2', kind: 'diary', title: '没靶心' },
    { at: 1e12, id: 'd3', kind: 'diary', title: '坏靶心', ref: { appId: 'diary', kind: 'diary', id: '' } }
  ], start, end);
  assert.equal(got.rows.length, 3);
  assert.deepEqual(got.rows[0].ref, { appId: 'diary', kind: 'diary', id: 'd1' });
  assert.equal(got.rows[1].ref, null, '★ 源没给靶心 ⇒ null（不许假装有）');
  assert.equal(got.rows[2].ref, null, '★ 坏靶心降 null ⇒ 按钮只写「打开 X」（诚实），不写做不到的承诺');
});

/* ══════════════ E 面 视图（apps/clock/clock-view.js） ══════════════ */

function mkClockApp(events) {
  const res = {
    state: 'ok', events: events, sourceRows: [], truncated: 0, dropped: 0, readError: ''
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
const T0 = new Date(2026, 10, 5, 10, 0, 0).getTime();

async function mkView(events) {
  const mod = await loadMod(ROOT, VIEW_REL);
  return new mod.ClockView(mkClockApp(events), {}, mkStorage());
}

test('E1 ★★★ 有靶心 ⇒ 「打开这一条」+ data-today-ref；没靶心 ⇒ 「打开 X」且不写 data 属性', async () => {
  const view = await mkView([
    { at: T0, source: 'diary', sourceLabel: '日记', id: 'd1', kind: 'diary', title: '有靶心', ref: { appId: 'diary', kind: 'diary', id: 'd1' } },
    { at: T0 - 1000, source: 'wechat', sourceLabel: '微信', id: 'w1', kind: 'chat', title: '没靶心' },
    { at: T0 - 2000, source: 'album', sourceLabel: '照片', id: 'p1', kind: 'photo', title: '没靶心' }
  ]);
  const html = view._todayHtml();
  assert.ok(html.includes('打开这一条'), '★ 有靶心的那一条必须真承诺（否则用户以为点不到）');
  assert.ok(html.includes('data-today-ref='), '★ 靶心必须随 data 属性带出（否则派发时投不出去）');
  assert.ok(html.includes('打开微信'), '★ 没靶心的源只写「打开 X」（不承诺做不到的事）');
  assert.ok(html.includes('打开照片'));
  assert.equal(html.split('data-today-ref=').length - 1, 1, '★ 只有带靶心的那一条才写 data-today-ref（不许给没靶心的补一个空串）');
  assert.equal(html.split('打开这一条').length - 1, 1, '★ 文案必须按条算，不按源名写死');
});

test('E2 ★★★ 点击派发：靶心随 phone:openApp 投出，仍是唯一一支笔（buildOpenDetail）', async () => {
  const seen = [];
  const prev = globalThis.window;
  globalThis.window = {
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: (ev) => { seen.push(ev); return true; }
  };
  try {
    const mod = await loadMod(ROOT, VIEW_REL);
    const view = new mod.ClockView(mkClockApp([]), {}, mkStorage());
    const handlers = [];
    view._root = { addEventListener: (t, fn) => { if (t === 'click') handlers.push(fn); }, querySelector: () => null };
    view._bindEvents();
    const withRef = {
      target: {
        getAttribute: (n) => (n === 'data-today-app' ? 'diary' : (n === 'data-today-ref'
          ? JSON.stringify({ appId: 'diary', kind: 'diary', id: 'd1' }) : null))
      }
    };
    handlers[0](withRef);
    assert.equal(seen.length, 1, '必须真派发一次 phone:openApp');
    assert.equal(seen[0].type, 'phone:openApp', '必须走官方跳转事件，不自造路');
    assert.equal(seen[0].detail.appId, 'diary');
    assert.deepEqual(seen[0].detail.ref, { appId: 'diary', kind: 'diary', id: 'd1' },
      '★ 靶心必须随载荷投出（不带就等于只开 App）');
    const noRef = { target: { getAttribute: (n) => (n === 'data-today-app' ? 'wechat' : null) } };
    handlers[0](noRef);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].detail.appId, 'wechat');
    assert.equal('ref' in seen[1].detail, false, '★ 没靶心时不许编一个 ref 出来');
  } finally {
    globalThis.window = prev;
  }
});

test('E3 ★★ 靶心读不出来时不静默吞：退为只开 App，并把原因报出来', async () => {
  const seen = [];
  const warns = [];
  const prevW = globalThis.window;
  const prevC = console.warn;
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: (ev) => { seen.push(ev); return true; } };
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    const mod = await loadMod(ROOT, VIEW_REL);
    const view = new mod.ClockView(mkClockApp([]), {}, mkStorage());
    const handlers = [];
    view._root = { addEventListener: (t, fn) => { if (t === 'click') handlers.push(fn); }, querySelector: () => null };
    view._bindEvents();
    handlers[0]({ target: { getAttribute: (n) => (n === 'data-today-app' ? 'diary' : (n === 'data-today-ref' ? '{bad json' : null)) } });
    assert.equal(seen.length, 1, '坏靶心不能把「打开 App」这条路也吞掉');
    assert.equal('ref' in seen[0].detail, false);
    assert.ok(warns.length >= 1, '★ 坏靶心必须出声（「点了没反应」与「这条没了」在界面上长得一样）');
  } finally {
    globalThis.window = prevW;
    console.warn = prevC;
  }
});

/* ══════════════ F 面 装配器（index.js） ══════════════ */

function dispatchOrderJudge(src) {
  const problems = [];
  for (const key of ['diaryApp', 'calendarApp']) {
    const at = src.indexOf('applyOpenRef(window.VirtualPhone.' + key);
    if (at < 0) { problems.push(key + ' 分支里没有投靶心'); continue; }
    const renderAt = src.indexOf('window.VirtualPhone.' + key + '.render()', at);
    if (renderAt < 0) problems.push(key + ' 分支里投靶心之后找不到 render');
    else if (renderAt < at) problems.push(key + '：投靶心在 render 之后（目标只点亮详情态、自己不渲染 ⇒ 画不出来）');
    const detailAt = src.indexOf('applyOpenDetail(window.VirtualPhone.' + key);
    if (detailAt < 0) problems.push(key + ' 分支里没有投页签/详情');
    else if (detailAt > at) problems.push(key + '：页签投递应在靶心之前（先归一页签再定位）');
    const warnAt = src.indexOf('未定位到靶心', at);
    if (warnAt < 0) problems.push(key + '：投靶心失败时不出声（静默 = 用户停在首屏却不知道）');
  }
  return problems;
}

test('F1 ★★★ 装配器：两件 App 都在 render 之前投靶心，页签在前，失败必须出声', () => {
  const problems = dispatchOrderJudge(readRel(INDEX_REL));
  assert.deepEqual(problems, [], '接线面问题：' + problems.join(' | '));
});

/* ══════════════ G 面 负控制（真源码破坏） ══════════════ */

/** 副本树必须够模块加载：一整份 config/ + 被破坏的 App 整个目录 + data/（引擎静态 import 它）。 */
function damage(rel, anchor, replacement) {
  const dir = mkTemp('rp_r14o3_');
  fs.cpSync(path.join(ROOT, 'config'), path.join(dir, 'config'), { recursive: true });
  if (rel.indexOf('apps/') === 0) {
    const seg = rel.split('/')[1];
    fs.cpSync(path.join(ROOT, 'apps', seg), path.join(dir, 'apps', seg), { recursive: true });
  }
  /* 引擎静态 import 了 `data/cheat-index.js` 与 `data/dirtytalk-index.js`：
   *   副本树若只带 config/ + apps/，ESM 解析会 MODULE_NOT_FOUND，
   *   而那是**判据基建坏了**，会被误读成「破坏没反应」。 */
  if (fs.existsSync(path.join(ROOT, 'data'))) {
    fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  }
  const src = readRel(rel);
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  const dst = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, src.split(anchor).join(replacement));
  return dir;
}

test('G1 ★★★ 破坏登记（撤掉 diary 的 kind）⇒ 源侧靶心归一必须转红', async () => {
  const Q = String.fromCharCode(39);
  const dir = damage(REF_REL, 'diary: Object.freeze({ appId: ' + Q + 'diary' + Q + ', label: ' + Q + '日记条目' + Q + ' }),', '');
  const m = await loadMod(dir, REF_REL);
  assert.equal(m.normalizeOpenRef({ kind: 'diary', id: 'd1', appId: 'diary' }).ok, false,
    '★ 登记撤掉后，源侧靶心必须当场归一失败（B1 就靠这条抓「登记面不动、消费侧白接」）');
});

test('G2 ★★★ 破坏源侧（把日记源的 meta.ref 去掉）⇒ 源侧靶心判据必须转红', async () => {
  const Q = String.fromCharCode(39);
  const dir = damage(ENGINE_REL, 'meta: { ref: buildOpenRef(' + Q + 'diary' + Q + ', id, ' + Q + 'diary' + Q + ') }', 'meta: {}');
  const sources = await engineSources(seedStorage(), dir);
  const items = sources.find((s) => s.id === 'diary').items();
  assert.ok(items.length > 0, '破坏后源仍要能读到条目（否则测的是加载失败）');
  assert.equal(items.some((it) => it.meta && it.meta.ref), false,
    '★★ 源侧去掉靶心后必须能被看见（B1 同款判据在这里必须转红）');
});

test('G3 ★★★ 破坏视图（按钮文案按源名写死）⇒ E1 的判据必须不再成立', async () => {
  const dir = damage(VIEW_REL, "const label = refJson ? ('打开这一条') : ('打开' + (ev.sourceLabel || ''));", "const label = '打开' + (ev.sourceLabel || '');");
  const mod = await loadMod(dir, VIEW_REL);
  const view = new mod.ClockView(mkClockApp([
    { at: T0, source: 'diary', sourceLabel: '日记', id: 'd1', kind: 'diary', title: '有靶心', ref: { appId: 'diary', kind: 'diary', id: 'd1' } }
  ]), {}, mkStorage());
  const html = view._todayHtml();
  assert.equal(html.includes('打开这一条'), false,
    '★ 写死文案后，有靶心也不会再写「打开这一条」—— E1 必须能看见这件事');
});

test('G4 ★★ 破坏定位（找不到时不报失败、改成随便指一条）⇒ C2 必须转红', async () => {
  const dir = damage(DIARY_APP_REL,
    "return { ok: false, reason: 'not_found', id: id, saw: entries.length };",
    "this._focusRefId = entries[0] ? String(entries[0].id || '') : ''; if (this.diaryView) this.diaryView.currentEntryId = this._focusRefId; return { ok: true, id: this._focusRefId, saw: entries.length };");
  const mod = await loadMod(dir, DIARY_APP_REL);
  const seed = JSON.parse(JSON.stringify(DIARY_SEED));
  seed.splice(1, 1);
  const inst = new mod.DiaryApp({ screen: {} }, mkStorage({ diary_entries: seed }));
  inst.render = () => {};
  const gone = inst.openRef({ kind: 'diary', id: 'diary_entry_b', appId: 'diary' });
  assert.equal(gone.ok, true, '★ 破坏后它会对「被删掉的那一条」回报成功 —— C2 的判据必须在这里转红');
  assert.notEqual(inst.diaryView.currentEntryId, 'diary_entry_c', '★ 而且会串到别的条目头上（这正是按下标定位的形态）');
});

/* ══════════════ H 面 通知中心路径（落账层 + 桥接层 + 视图） ══════════════ */

async function mkNotifLog(storage) {
  const mod = await loadMod(ROOT, NOTIF_REL);
  return new mod.NotificationLog(storage || mkStorage());
}

test('H1 ★★★ 落账层保留靶心（写入 / 读回两道都在），坏靶心不写空壳', async () => {
  /* 同一份 storage 跨两个实例（模拟重启）。落账层是**防抖落盘**（setTimeout+unref），
   *   兵底路径是 flushNow：不显式 flush 就去重读，测的是「防抖还没到」，不是「靶心没存」。 */
  const storage = mkStorage();
  const log = await mkNotifLog(storage);
  log.push({
    title: '日记', message: '今天写了一篇', appId: 'diary', icon: '📔',
    meta: { ref: { appId: 'diary', kind: 'diary', id: 'diary_entry_b' } }
  });
  const row = log.list()[0];
  assert.deepEqual(row.meta.ref, { appId: 'diary', kind: 'diary', id: 'diary_entry_b' },
    '★ 写入时靶心必须落库（否则通知中心只能开 App 首屏）');
  log.push({
    title: '一条坏靶心', message: 'id 是空串', appId: 'diary', icon: '📔',
    meta: { ref: { appId: 'diary', kind: 'diary', id: '   ' } }
  });
  const bad = log.list().find((r) => r.title === '一条坏靶心');
  assert.equal(bad.meta.ref, null, '★ 坏靶心必须降 null（写空串会分不清「没有靶心」还是「靶心坏了」）');
  log.flushNow();
  /* 读回层：换一个实例重读（模拟重启后从 storage 反序列化）靶心仍在。 */
  const log2 = await mkNotifLog(storage);
  const again = log2.list().find((r) => r.title === '日记');
  assert.deepEqual(again.meta.ref, { appId: 'diary', kind: 'diary', id: 'diary_entry_b' },
    '★ 读回时靶心也必须在（写不存等于没写）');
});

test('H2 ★★ 合并分支也不得把靶心弄丢', async () => {
  const log = await mkNotifLog();
  const ref = { appId: 'calendar', kind: 'calendar', id: 'calendar_memo_b' };
  log.push({ title: '日历', message: '一', appId: 'calendar', icon: '📅', senderKey: 'cal:1', meta: { ref } });
  log.push({ title: '日历', message: '二', appId: 'calendar', icon: '📅', senderKey: 'cal:1', meta: { ref } });
  const rows = log.list();
  assert.equal(rows.length, 1, '同 senderKey 应该合并成一条');
  assert.deepEqual(rows[0].meta.ref, ref, '★ 合并时靶心必须跟着更新（丢了就是「后来那条点不到」）');
});

test('H3 ★★★ 桥接层：metadata.ref 带到行上，deepLink 不被当成靶心反推', async () => {
  const mod = await loadMod(ROOT, BRIDGE_REL);
  const withRef = mod.mapHubNotification({
    id: 'a1', appId: 'diary', title: '日记', body: '一', timestamp: 1000,
    metadata: { ref: { appId: 'diary', kind: 'diary', id: 'diary_entry_c', junk: 'x' } }
  });
  assert.deepEqual(withRef.meta.ref, { appId: 'diary', kind: 'diary', id: 'diary_entry_c' },
    '★ 桥接层必须把 metadata.ref 完整带到行上（否则中枢派发的通知永远落不到）');
  const onlyDeep = mod.mapHubNotification({
    id: 'a2', appId: 'calendar', title: '日历', body: '二', timestamp: 1000,
    deepLink: { targetApp: 'calendar', view: 'detail', params: { id: 'calendar_memo_a' } }
  });
  assert.equal(onlyDeep.meta.ref, null,
    '★ 只有 deepLink 时不许猜一个靶心（deepLink 不含 kind/id 语义，硬猜 ⇒ 永远 not_found）');
  assert.deepEqual(onlyDeep.meta.hubDeepLink, { targetApp: 'calendar', view: 'detail', params: { id: 'calendar_memo_a' } },
    'deepLink 本身仍须保留（它是另一份契约，不替代靶心）');
});

test('H4 ★★★ 通知中心点一条：有靶心投靶心，没靶心只开 App', async () => {
  const seen = [];
  const prev = globalThis.window;
  const mkItem = (attrs) => ({
    dataset: { id: 'N1', app: 'diary' },
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    addEventListener: (t, fn) => { if (t === 'click') clicks.push(fn); }
  });
  const clicks = [];
  const items = [
    mkItem({ 'data-ref': JSON.stringify({ appId: 'diary', kind: 'diary', id: 'diary_entry_b' }) }),
    mkItem({ 'data-ref': '' })
  ];
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: (ev) => { seen.push(ev); return true; } };
  try {
    const mod = await loadMod(ROOT, NCVIEW_REL);
    const view = new mod.NotificationCenterView({
      log: { markRead: () => ({}) },
      phoneShell: { screen: { querySelectorAll: (sel) => (sel === '.nc-item' ? items : []) } }
    });
    view._syncBadge = () => {};
    view.render = () => {};
    view._bindItems();
    assert.equal(clicks.length, 2, '两条 .nc-item 都必须挂上点击处理（没挂 = 点了没反应）');
    clicks[0]();
    assert.equal(seen.length, 1, '必须真派发一次 phone:openApp');
    assert.equal(seen[0].type, 'phone:openApp', '必须走官方跳转事件，不自造路');
    assert.deepEqual(seen[0].detail.ref, { appId: 'diary', kind: 'diary', id: 'diary_entry_b' },
      '★ 通知中心必须把靶心投出去（否则只能落在 App 首屏）');
    clicks[1]();
    assert.equal(seen.length, 2);
    assert.equal('ref' in seen[1].detail, false, '★ 没靶心时不许编一个 ref 出来');
  } finally {
    globalThis.window = prev;
  }
});

/* ══════════════ V 面 结构自证 ══════════════ */

test('V1 ★ 版本下限锚：本套件只在 ' + MIN_VERSION + ' 及以后成立', async () => {
  const head = readRel(REF_REL).slice(0, 4000);
  assert.ok(head.includes(MIN_VERSION), '协议件头注必须留下本切片版本锚');
});

test('V2 ★★ 结构自证：两件 App 文件都在、openRef/clearRef 都在（防「空对空」全绿）', () => {
  for (const rel of [DIARY_APP_REL, CALENDAR_APP_REL]) {
    const src = readRel(rel);
    assert.ok(src.includes('openRef(ref)'), rel + ' 缺 openRef');
    assert.ok(src.includes('clearRef()'), rel + ' 缺 clearRef');
  }
  assert.ok(readRel(ENGINE_REL).includes("buildOpenRef('diary', id, 'diary')"));
  assert.ok(readRel(ENGINE_REL).includes("buildOpenRef('calendar', id, 'calendar')"));
});
