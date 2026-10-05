/**
 * tests/system-v293.test.mjs — 约定支的生活事件源键含状态与 revision [v2.93.0]
 *
 * 探针实证（真宿主 + 真 PhoneStorage + 真 CalendarApp）：
 *   sourceId 写成 `commitment:<id>:<status>:<revision>`，于是同一条约定每推进一次
 *   状态就多一条**不同源身份**的事件，且一律接不返回：
 *     propose → confirm → confirm(重复) → reschedule → fulfill
 *     时间线上并存 5 条（proposed / confirmed×2 / rescheduled / fulfilled），
 *     全部自称同一件事；终态也不回收（源头已退出投影）。
 *   两条命令并存时汇总为 8 条，真实事件只有 2 件。
 *
 * 修法：
 *   · 源键改回**稳定身份** `commitment:<id>`；
 *   · 打通三条出口：新增（add）/ 改写（updateBySource）/ 回收
 *     （removeBySourceBase：基名或其 `基名:` 族，兼容旧档带后缀的源键）；
 *   · 终态（fulfilled / cancelled）与「备忘退出投影」两条路径都回收。
 *
 * 覆盖：
 *   A 结构面：源键不得再含状态与 revision；三条出口齐备
 *   B 行为面：一条约定走完全程只占 1 条、正文跟随、终态回收
 *   C 行为面：取消 / 删备忘 / 旧格式迁移 / proposed 不误删
 *   D 负控制（真源码破坏 → 在副本上重跑同款真判据必须转红）
 *   E 版本下限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const APP_SRC = read('apps/calendar/calendar-app.js');
const DATA_SRC = read('apps/calendar/calendar-data.js');
const LIFE_SRC = read('config/life-events.js');

function stageTree(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v293-tree-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锛点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
  return s.replace(from, to);
};

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v293 A1. 源键是稳定身份：不得再含状态与 revision', () => {
  assert.match(APP_SRC, /commitmentLifeEventSourceId\(id\)\s*\{/,
    '源键必须由单一构造器给出');
  assert.match(APP_SRC, /return sid \? 'commitment:' \+ sid : null;/,
    '源键形如 commitment:<id>');
  const body = APP_SRC.slice(APP_SRC.indexOf('commitmentLifeEventSourceId(id) {'),
    APP_SRC.indexOf('commitmentLifeEventSourceId(id) {') + 400);
  assert.doesNotMatch(body, /status|revision/, '源键不得再把状态/修订号写进去');
  // 旧形态（每步换键）不得残留
  assert.equal(APP_SRC.includes("'commitment:' + item.id + ':' + item.status"), false,
    '不得残留旧源键拼接');
});

test('v293 A2. 三条出口齐备：新增 / 改写 / 整族回收', () => {
  assert.match(LIFE_SRC, /^\s*removeBySourceBase\s*\(base\)\s*\{/m, 'store 缺整族回收出口');
  const body = LIFE_SRC.slice(LIFE_SRC.indexOf('removeBySourceBase(base) {'),
    LIFE_SRC.indexOf('removeBySourceBase(base) {') + 700);
  assert.match(body, /sid !== b && !sid\.startsWith\(head\)/,
    '回收须同时收基名本身与 `基名:` 族（旧档源键带后缀）');
  assert.match(APP_SRC, /refreshCommitmentLifeEvent\(item\)\s*\{/, 'app 缺对齐出口');
  assert.match(APP_SRC, /forgetCommitmentLifeEvent\(id\)\s*\{/, 'app 缺回收出口');
  assert.match(DATA_SRC, /forgetCommitmentLifeEvent\(commitmentId\)\s*\{/, 'data 缺回收出口');
  // 推进状态走「对齐」而不是「再造一条」
  assert.match(APP_SRC, /this\.refreshCommitmentLifeEvent\(result\.item\);/,
    '状态推进必须走对齐出口');
  assert.equal(APP_SRC.includes('this.recordCommitmentLifeEvent(result.item);'), false,
    '不得残留「每步新增」调用');
});

test('v293 A3. 回收不得过宽：不得把「尚未进投影的约定」的事件一起删', () => {
  // 曾试过在同步里做「凡不在投影里的 commitment 事件一律撤掉」，
  // 但 proposed 阶段的约定本来就不进投影——那样写会把等确认的事件误删。
  assert.equal(DATA_SRC.includes('_reconcileCommitmentLifeEvents'), false,
    '不得保留过宽的全量回收');
  assert.match(DATA_SRC, /const replaced = new Set\(\);/, '顶替集合须只记真正被顶替的源');
  assert.match(DATA_SRC, /for \(const stale of replaced\)/, '只回收被顶替的那些');
});

/* ============================================================
 * B/C. 行为面（真宿主 + 真 PhoneStorage + 真 CalendarApp）
 * ============================================================ */
async function boot(root) {
  resetHostFlags();
  const host = installRuntimeHost({ chatMetadata: {}, settings: {} });
  const { PhoneStorage } = await import('file://' + path.join(root, 'config/storage.js'));
  const { CalendarApp } = await import('file://' + path.join(root, 'apps/calendar/calendar-app.js'));
  const st = new PhoneStorage();
  host.window.VirtualPhone = host.window.VirtualPhone || {};
  host.window.VirtualPhone.storage = st;
  const ns = {};
  host.context.chatMetadata['st_virtual_phone'] = ns;
  const app = new CalendarApp(null, st);
  return { host, app, ns, st };
}
const events = (ns) => (Array.isArray(ns['life_events_v1']) ? ns['life_events_v1'] : []);
const sidsOf = (ns, id) => events(ns).map((e) => String(e.sourceId || '')).filter((s) => s === 'commitment:' + id);

/** 真判据：把一条约定走完全程，返回每一步的读数（供负控制复用） */
export async function commitmentTrace(root) {
  const { host, app, ns } = await boot(root);
  try {
    app.proposeCommitmentFromMemo({ actor: '林夏', content: '咖啡馆见面', dateKey: '2026-09-25', eventKey: 'p1' });
    const id = app.loadCommitments().items[0].id;
    const afterPropose = { n: sidsOf(ns, id).length, title: events(ns)[0]?.title };
    app.confirmCommitmentById(id, 'c1');
    app.confirmCommitmentById(id, 'c1');   // 重复事件键：不得新增，也不得多一条
    const afterConfirm = { n: sidsOf(ns, id).length, title: events(ns)[0]?.title };
    app.rescheduleCommitmentById(id, { dateKey: '2026-09-26', time: '20:00', eventKey: 'm1' });
    const afterMove = {
      n: sidsOf(ns, id).length,
      title: events(ns)[0]?.title,
      summary: String(events(ns)[0]?.summary || ''),
      total: events(ns).length,
    };
    app.fulfillCommitmentById(id, 'd1');
    const afterFulfill = {
      n: sidsOf(ns, id).length,
      total: events(ns).length,
      memoGone: app.calendarData.getMemos().some((m) => m.commitmentSourceId === id) === false,
    };
    return { id, afterPropose, afterConfirm, afterMove, afterFulfill };
  } finally {
    host.uninstall();
  }
}

function assertTrace(t, where) {
  assert.equal(t.afterPropose.n, 1, where + ' 记下约定后恰 1 条');
  assert.equal(t.afterConfirm.n, 1, where + ' 确认后仍是同一条（不是又多一条）');
  assert.equal(t.afterMove.n, 1, where + ' 改期后仍是同一条');
  assert.equal(t.afterMove.total, 1, where + ' 全程时间线下只有这 1 条');
  assert.equal(t.afterMove.title, '改期约定', where + ' 正文跟随最新状态');
  assert.equal(t.afterMove.summary.includes('2026-09-26'), true, where + ' 正文带改期后的日期');
  assert.equal(t.afterFulfill.n, 0, where + ' 完成后源头不再存在，条目必须回收');
  assert.equal(t.afterFulfill.total, 0, where + ' 完成后时间线不得留幽灵');
  assert.equal(t.afterFulfill.memoGone, true, where + ' 日历投影同步移除');
}

test('v293 B. 一条约定走完全程：始终只占 1 条，正文跟随，终态回收', async () => {
  assertTrace(await commitmentTrace(ROOT), '真仓库');
});

test('v293 C1. 取消同样回收；未确认的 proposed 不得被误删', async () => {
  const { host, app, ns } = await boot(ROOT);
  try {
    app.proposeCommitmentFromMemo({ actor: '我', content: '看电影', dateKey: '2026-09-26', eventKey: 'pa' });
    app.proposeCommitmentFromMemo({ actor: '我', content: '吃晚饭', dateKey: '2026-09-27', eventKey: 'pb' });
    const items = app.loadCommitments().items;
    const a = items.find((i) => i.content === '看电影');
    const b = items.find((i) => i.content === '吃晚饭');
    assert.equal(events(ns).length, 2, '两条约定各占 1 条');
    // 同步日历（仍无已确认项）不得把 proposed 的事件误删
    app.syncCommitmentsToCalendar();
    assert.equal(sidsOf(ns, a.id).length, 1, '未进投影的 proposed 不得被同步期回收误删');
    app.confirmCommitmentById(b.id, 'cb');
    app.cancelCommitmentById(b.id, '取消', 'xb');
    assert.equal(sidsOf(ns, b.id).length, 0, '取消后条目必须回收');
    assert.equal(sidsOf(ns, a.id).length, 1, '别人的条目不受影响');
  } finally {
    host.uninstall();
  }
});

test('v293 C2. 旧档迁移：带状态后缀的旧源键同样被回收（不留下双份）', async () => {
  const { host, app, ns } = await boot(ROOT);
  try {
    // 模拟升级前的存档：同一条约定残留 4 条带后缀的旧源键
    ns['life_events_v1'] = ['proposed:2', 'confirmed:3', 'confirmed:4', 'rescheduled:5'].map((tail, i) => ({
      id: 'old' + i, type: 'calendar', app: 'calendar', title: '旧条目', summary: '咖啡馆见面（2026-09-26）', importance: 3,
      sourceId: 'commitment:apt_1:' + tail,
    }));
    app.calendarData._lifeEvents = null;   // 丢弃内存副本，从存档重读
    app.calendarData.clearCache();
    app.confirmCommitmentById('apt_9', 'noop');   // 不存在的 id 只是拒绝，不改档
    app.forgetCommitmentLifeEvent('apt_1');
    assert.equal(events(ns).length, 0, '旧格式源键必须被整族收掉');
  } finally {
    host.uninstall();
  }
});

test('v293 C3. 删备忘 / 投影移除：约定条目一并回收', async () => {
  const { host, app, ns } = await boot(ROOT);
  try {
    app.proposeCommitmentFromMemo({ actor: '我', content: '看电影', dateKey: '2026-09-26', eventKey: 'pd' });
    const id = app.loadCommitments().items[0].id;
    app.confirmCommitmentById(id, 'cd');
    const memo = app.calendarData.getMemos().find((m) => m.commitmentSourceId === id);
    assert.ok(memo, '确认后应有日历投影');
    app.calendarData.deleteMemo(memo.id);
    assert.equal(sidsOf(ns, id).length, 0, '删掉投影备忘后生活事件必须一并回收');
  } finally {
    host.uninstall();
  }
});

/* ============================================================
 * D. 负控制：真源码破坏 → 同款真判据必须转红
 * ============================================================ */
test('v293 D. 负控制：源键退回「含状态与 revision」→ 全程多条并存（判据转红）', async () => {
  // 真源码破坏：把**对齐路径**的源键换回旧形态（每推进一次状态换一个键）。
  //   只改 record 路径不算破坏 —— 那已经不是主路径了。
  let broken = replaceOnce(APP_SRC,
    'return store.updateBySource(sid, {',
    "return store.updateBySource(sid + ':' + item.status + ':' + item.revision, {");
  broken = replaceOnce(broken,
    'const n = store.removeBySourceBase(sid);',
    "const n = store.removeBySourceBase(sid + ':' + item.status + ':' + item.revision);");
  assert.notEqual(broken, APP_SRC, '破坏必须真的发生');
  const dir = stageTree({
    'package.json': JSON.stringify({ type: 'module' }),
    'index.js': read('index.js'),
    'apps/calendar/calendar-app.js': broken,
    'apps/calendar/calendar-data.js': DATA_SRC,
    'apps/calendar/calendar-view.js': read('apps/calendar/calendar-view.js'),
    'config/life-events.js': LIFE_SRC,
    'config/storage.js': read('config/storage.js'),
    /* [v3.58.0 · 计划 O4] calendar-app 的会话栅栏依赖这两件（少一件即 ERR_MODULE_NOT_FOUND）。 */
    'config/session-gate.js': read('config/session-gate.js'),
    'config/num-gate.js': read('config/num-gate.js'),
    'config/tag-filter.js': read('config/tag-filter.js'),
    'config/phone-events.js': read('config/phone-events.js'),
    'config/commitment-flow.js': read('config/commitment-flow.js'),
  });
  try {
    const traced = await commitmentTrace(dir);
    assert.ok(traced.afterMove.total > 1,
      '破坏后同一条约定在多步推进中必然多条并存（实测 ' + traced.afterMove.total + ' 条）');
    // 双向证明：**同款真判据**在破坏树上必须抛（不能只靠我手写的读数）。
    let threw = null;
    try { assertTrace(traced, '破坏树'); } catch (e) { threw = e; }
    assert.ok(threw, '破坏后同款真判据必须转红');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v293 D2. 负控制：抽掉整族回收 → 终态幽灵复现（B 判据转红）', async () => {
  const broken = replaceOnce(LIFE_SRC,
    "return sid !== b && !sid.startsWith(head);",
    "return sid !== b;");
  const dir = stageTree({
    'package.json': JSON.stringify({ type: 'module' }),
    'index.js': read('index.js'),
    'apps/calendar/calendar-app.js': APP_SRC,
    'apps/calendar/calendar-data.js': DATA_SRC,
    'apps/calendar/calendar-view.js': read('apps/calendar/calendar-view.js'),
    'config/life-events.js': broken,
    'config/storage.js': read('config/storage.js'),
    /* [v3.58.0 · 计划 O4] calendar-app 的会话栅栏依赖这两件（少一件即 ERR_MODULE_NOT_FOUND）。 */
    'config/session-gate.js': read('config/session-gate.js'),
    'config/num-gate.js': read('config/num-gate.js'),
    'config/tag-filter.js': read('config/tag-filter.js'),
    'config/phone-events.js': read('config/phone-events.js'),
    'config/commitment-flow.js': read('config/commitment-flow.js'),
  });
  try {
    const { host, app, ns } = await boot(dir);
    try {
      // 旧档里带后缀的源键：只认精确就等于收不掉它们
      ns['life_events_v1'] = [{
        id: 'x', type: 'calendar', app: 'calendar', title: '旧', summary: 's', importance: 3,
        sourceId: 'commitment:apt_1:fulfilled:6',
      }];
      app.calendarData._lifeEvents = null;
      app.calendarData.clearCache();
      app.forgetCommitmentLifeEvent('apt_1');
      assert.equal(events(ns).length, 1, '破坏后旧格式条目收不掉（判据转红）');
    } finally {
      host.uninstall();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
test('v293 E. 版本不低于 2.93.0 且五源同源', () => {
  const log = JSON.parse(read('update-log.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION 必须存在');
  assert.equal(log.latest, manifest.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, m[1]);
  assert.equal(atLeast(log.latest, '2.93.0'), true, `版本 ${log.latest} < 2.93.0`);
  const entry = log.versions[log.latest];
  assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
});
