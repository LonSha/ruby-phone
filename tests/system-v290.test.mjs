/**
 * tests/system-v290.test.mjs — 生活事件跨会话残留 / 双副本丢失 / 门禁间接键面 [v2.90.0]
 *
 * 本轮修四件（探针 probe_v290_life.mjs 修复前后对比实证）：
 *   D1 跨会话残留：CalendarData.clearCache() 只清 _memos/_holidays，不清懒建的
 *      _lifeEvents（LifeEventStore 实例）。换会话后旧 store 携带旧 events 数组，
 *      add() 时把旧会话事件写进新会话（A 会话事件污染 B 会话）。
 *   D2 双副本 lost update：CalendarApp 自持 this._lifeEvents，CalendarData 另持一个；
 *      备忘写 data 层、约定写 app 层，交错写入时后写者的旧内存快照覆盖前者。
 *   D3 重复方法定义：domainLifeEventSourceId（calendar-data）/ updateBySource、
 *      removeBySource（life-events）各重复一份逐字节相同定义，源自 e880b63 补丁重复落盘。
 *   D4 门禁盲区：life_events_v1 等 14 键以 `this.<prop> = 'lit'` + `storage.x(this.<prop>)`
 *      间接形态使用，旧抽取面（CALL/CONST/LOCAL_GET）全看不见，K1/K2/K3 对它失效。
 *
 * 覆盖：
 *   A 源码面：D1 清 store 接线 / D2 共享 store / D3 定义唯一
 *   B 行为面（真宿主 + 真 PhoneStorage + 真 CalendarData/CalendarApp）
 *   C 结构面：三个方法在全仓（apps+config）各恰定义 1 次
 *   D 负控制（真源码破坏 → 在副本上重跑同款真判据必须转红）
 *   E 版本锚点
 *   F keys-audit 新抽取面（结构 + 行为 + 负控制）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const CAL_DATA_SRC = read('apps/calendar/calendar-data.js');
const CAL_APP_SRC = read('apps/calendar/calendar-app.js');
const LIFE_SRC = read('config/life-events.js');
const KEYS_SRC = read('scripts/keys-audit.mjs');
const SELF = readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** 真仓库模块（只读加载） */
const url = (rel) => 'file://' + path.join(ROOT, rel);
const realStorage = () => import(url('config/storage.js'));
const realCalData = () => import(url('apps/calendar/calendar-data.js'));
const realCalApp = () => import(url('apps/calendar/calendar-app.js'));

/** 把若干仓库文件按相对路径写进临时树，返回临时 root（副本加载用；真仓库只读） */
function stageTree(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v290-tree-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
/** 锚点替换：计数必须恰为 1，否则测试自身有问题 */
const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
  return s.replace(from, to);
};
/** 计数：源码内某正则的命中数 */
const count = (src, re) => (src.match(re) || []).length;

/* ============================================================
 * A. 源码面
 * ============================================================ */
test('v290 A1. D1 修复点：CalendarData.clearCache 清懒建的 _lifeEvents', () => {
  const block = CAL_DATA_SRC.slice(CAL_DATA_SRC.indexOf('    clearCache() {'), CAL_DATA_SRC.indexOf('    clearCache() {') + 400);
  assert.match(block, /this\._memos = null;/, 'clearCache 清 _memos');
  assert.match(block, /this\._holidays = null;/, 'clearCache 清 _holidays');
  assert.match(block, /this\._lifeEvents = null;/, 'clearCache 必须一并清 _lifeEvents（本轮修复点）');
  assert.match(block, /\[v2\.90\.0\]/, '修复点须留版本注记');
});
test('v290 A2. D2 修复点：CalendarApp 共享 calendarData 的 store，不自持第二实例', () => {
  assert.match(CAL_APP_SRC,
    /if \(!this\.calendarData\._lifeEvents\) this\.calendarData\._lifeEvents = new LifeEventStore\(this\.storage\);/,
    'recordCommitmentLifeEvent 懒建挂在 calendarData 上（共享）');
  assert.match(CAL_APP_SRC, /const store = this\.calendarData\._lifeEvents;/, '写路径取共享 store');
  assert.doesNotMatch(CAL_APP_SRC, /this\._lifeEvents\s*=\s*new LifeEventStore/,
    'CalendarApp 不得再自建 LifeEventStore（双副本根源）');
  const clearBlock = CAL_APP_SRC.slice(CAL_APP_SRC.indexOf('    clearCache() {'), CAL_APP_SRC.indexOf('    clearCache() {') + 400);
  assert.doesNotMatch(clearBlock, /this\._lifeEvents = null/, '共享后 CalendarApp.clearCache 不再自清该字段');
  assert.match(clearBlock, /this\.calendarData\.clearCache\(\);/, 'clearCache 经 calendarData 一并清共享 store');
});
test('v290 A3. D3 修复点：三处重复定义各恰 1 份', () => {
  assert.equal(count(CAL_DATA_SRC, /^\s*domainLifeEventSourceId\s*\(memo\)\s*\{/gm), 1, 'domainLifeEventSourceId 恰 1 份');
  assert.equal(count(LIFE_SRC, /^\s*updateBySource\s*\(sourceId,\s*fields\s*=\s*\{\}\)\s*\{/gm), 1, 'updateBySource 恰 1 份');
  assert.equal(count(LIFE_SRC, /^\s*removeBySource\s*\(sourceId\)\s*\{/gm), 1, 'removeBySource 恰 1 份');
});

/* ============================================================
 * B. 行为面（真宿主 + 真 PhoneStorage + 真 CalendarData/CalendarApp）
 * ============================================================ */
/** 装宿主并造会话命名空间；返回 { st, host, ns }（ns 可整体替换以模拟切会话） */
async function freshSession(PhoneStorage) {
  resetHostFlags();
  const host = installRuntimeHost({ chatMetadata: {}, settings: {} });
  const st = new PhoneStorage();
  if (!host.window.VirtualPhone) host.window.VirtualPhone = {};
  host.window.VirtualPhone.storage = st;
  const ns = {};
  host.context.chatMetadata['st_virtual_phone'] = ns;
  return { st, host, ns };
}
const summaries = (v) => (Array.isArray(v) ? v : []).map((e) => String(e.summary || e.title || ''));

async function loadBrokenTree(files) {
  const dir = stageTree(files);
  return { dir, url: (rel) => 'file://' + path.join(dir, rel) };
}

test('v290 B1. 跨会话：clearCache 后旧 store 不得存活，新会话不被旧事件污染', async () => {
  const { PhoneStorage } = await realStorage();
  const { CalendarData } = await realCalData();
  const { st, host, ns } = await freshSession(PhoneStorage);
  try {
    const data = new CalendarData(st);
    data.addMemo({ dateKey: '2026-09-23', title: 'A会话的工作备忘', type: 'work' });
    assert.deepEqual(summaries(ns['life_events_v1']).length, 1, 'A 会话写入 1 条');
    assert.ok(data._lifeEvents, '写后 store 懒建存活');
    // 切会话：命名空间整体换新（等价 onChatChanged 重建上下文）
    const nsB = {};
    host.context.chatMetadata['st_virtual_phone'] = nsB;
    data.clearCache();
    assert.equal(data._lifeEvents, null, 'clearCache 后 _lifeEvents 必须清空（D1 判据）');
    data.addMemo({ dateKey: '2026-09-24', title: 'B会话的学业备忘', type: 'study' });
    const bList = summaries(nsB['life_events_v1']);
    assert.equal(bList.length, 1, 'B 会话应只有自己的 1 条');
    assert.equal(bList.some((s) => s.includes('A会话')), false, 'B 会话不得被 A 会话事件污染');
  } finally {
    host.uninstall();
  }
});

test('v290 B2. 单会话：app/data 交错写入，约定事件不被备忘覆盖', async () => {
  const { PhoneStorage } = await realStorage();
  const { CalendarApp } = await realCalApp();
  const { st, host, ns } = await freshSession(PhoneStorage);
  try {
    const app = new CalendarApp(null, st);
    app.calendarData.addMemo({ dateKey: '2026-09-25', title: '工作备忘一', type: 'work' });
    app.recordCommitmentLifeEvent({ id: 'c1', content: '看电影', status: 'confirmed', actor: '我', revision: 1, dateKey: '2026-09-26' });
    app.calendarData.addMemo({ dateKey: '2026-09-27', title: '学业备忘二', type: 'study' });
    const list = Array.isArray(ns['life_events_v1']) ? ns['life_events_v1'] : [];
    assert.ok(list.some((e) => String(e.sourceId || '').startsWith('commitment:')),
      '交错写入后约定事件必须仍在（D2 判据：不得被后写的备忘覆盖）');
    assert.equal(list.length, 3, '三条事件都应在（备忘×2 + 约定×1）');
    assert.equal(Object.prototype.hasOwnProperty.call(app, '_lifeEvents'), false,
      'CalendarApp 不得自持 _lifeEvents 字段（双副本根源）');
    assert.ok(app.calendarData._lifeEvents, '共享 store 挂在 calendarData 上');
  } finally {
    host.uninstall();
  }
});

/* ============================================================
 * C. 结构面：三个方法在全仓（apps+config）各恰定义 1 次
 * ============================================================ */
test('v290 C. 全仓扫描：三方法各恰 1 处定义（D3 无重复残留）', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'tests', 'scripts'].includes(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.js')) files.push(abs);
    }
  };
  walk(path.join(ROOT, 'apps'));
  walk(path.join(ROOT, 'config'));
  let d = 0, u = 0, r = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    d += count(src, /^\s*domainLifeEventSourceId\s*\(memo\)\s*\{/gm);
    u += count(src, /^\s*updateBySource\s*\(sourceId,\s*fields\s*=\s*\{\}\)\s*\{/gm);
    r += count(src, /^\s*removeBySource\s*\(sourceId\)\s*\{/gm);
  }
  assert.equal(d, 1, `domainLifeEventSourceId 全仓应有且仅有 1 处，实际 ${d}`);
  assert.equal(u, 1, `updateBySource 全仓应有且仅有 1 处，实际 ${u}`);
  assert.equal(r, 1, `removeBySource 全仓应有且仅有 1 处，实际 ${r}`);
});

/* ============================================================
 * D. 负控制（真源码破坏 → 在副本上重跑同款真判据必须转红）
 * ============================================================ */
test('v290 D1. 负控制：抽掉 clearCache 的 _lifeEvents 清理 → B1 判据在副本上转红', async () => {
  // 锚点必须恰中 1 次
  const anchor = '        this._lifeEvents = null;';
  const hits = CAL_DATA_SRC.split(anchor).length - 1;
  assert.equal(hits, 1, '锚点恰中 1 次（防误伤别处）');
  const broken = CAL_DATA_SRC.replace(anchor, '/* 破坏：漏清 _lifeEvents */');
  const dir = stageTree({
    'apps/calendar/calendar-data.js': broken,
    'apps/calendar/calendar-app.js': CAL_APP_SRC,
    'config/life-events.js': LIFE_SRC,
    'config/storage.js': read('config/storage.js'),
  });
  try {
    const { PhoneStorage } = await import('file://' + path.join(dir, 'config/storage.js'));
    const { CalendarData } = await import('file://' + path.join(dir, 'apps/calendar/calendar-data.js'));
    const { st, host, ns } = await freshSession(PhoneStorage);
    try {
      const data = new CalendarData(st);
      data.addMemo({ dateKey: '2026-09-23', title: 'A会话的工作备忘', type: 'work' });
      host.context.chatMetadata['st_virtual_phone'] = {};
      data.clearCache();
      // 破坏后：_lifeEvents 未被清 → 旧 store 存活（B1 判据转红）
      assert.notEqual(data._lifeEvents, null, '破坏后旧 store 存活（判据转红）');
    } finally {
      host.uninstall();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('v290 D2. 负控制：恢复 app 自持第二个 store → lost update 复现（B2 判据转红）', async () => {
  // 把共享行改回自建：this._lifeEvents = new LifeEventStore(this.storage)
  const anchor = 'if (!this.calendarData._lifeEvents) this.calendarData._lifeEvents = new LifeEventStore(this.storage);';
  const hits = CAL_APP_SRC.split(anchor).length - 1;
  assert.equal(hits, 1, '锚点恰中 1 次');
  const broken = CAL_APP_SRC.replace(anchor,
    'if (!this._lifeEvents) this._lifeEvents = new LifeEventStore(this.storage);');
  // 还要把 store 引用改回 this._lifeEvents
  const broken2 = broken.replace('const store = this.calendarData._lifeEvents;', 'const store = this._lifeEvents;');
  assert.notEqual(broken2, broken, '第二处破坏也须生效');
  const dir = stageTree({
    'package.json': '{"type":"module"}',
    'apps/calendar/calendar-app.js': broken2,
    'apps/calendar/calendar-data.js': CAL_DATA_SRC,
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
    const { PhoneStorage } = await import('file://' + path.join(dir, 'config/storage.js'));
    const { CalendarApp } = await import('file://' + path.join(dir, 'apps/calendar/calendar-app.js'));
    const { st, host, ns } = await freshSession(PhoneStorage);
    try {
      const app = new CalendarApp(null, st);
      app.calendarData.addMemo({ dateKey: '2026-09-25', title: '工作备忘一', type: 'work' });
      app.recordCommitmentLifeEvent({ id: 'c1', content: '看电影', status: 'confirmed', actor: '我', revision: 1, dateKey: '2026-09-26' });
      app.calendarData.addMemo({ dateKey: '2026-09-27', title: '学业备忘二', type: 'study' });
      const list = Array.isArray(ns['life_events_v1']) ? ns['life_events_v1'] : [];
      // 破坏后：双 store → 约定事件被备忘覆盖丢失（B2 判据转红）
      assert.equal(list.some((e) => String(e.sourceId || '').startsWith('commitment:')), false,
        '破坏后约定事件丢失（判据转红）');
    } finally {
      host.uninstall();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ============================================================
 * E. 版本锚点（动态锚定 latest，下限 2.90.0）
 * ============================================================ */
test('v290 E. 版本不低于 2.90.0（本套件接管版本锚点）', () => {
  const log = JSON.parse(read('update-log.json'));
  const v = log.latest;
  const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
  assert.ok(vnum(v) >= vnum('2.90.0'), `版本 ${v} < 2.90.0`);
});

/* ============================================================
 * F. keys-audit 新抽取面（间接属性键：D4）
 * ============================================================ */
const runKeys = (args, env) => {
  try {
    const out = execFileSync(process.execPath, ['scripts/keys-audit.mjs', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
      env: { ...process.env, ...(env || {}) },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};
test('v290 F1. 结构：间接属性键面两条正则齐备并被接线', () => {
  assert.ok(KEYS_SRC.includes('const PROP_ASSIGN_RE = /this\\.'), 'PROP_ASSIGN_RE 存在且以 this\\. 属性捕获开头');
  assert.ok(KEYS_SRC.includes('const PROP_CALL_RE = /(?:storage|VirtualPhone'), 'PROP_CALL_RE 存在');
  assert.ok(KEYS_SRC.includes('const propCalls = new Set([...txt.matchAll(PROP_CALL_RE)].map((m) => m[1]));'), '抽取循环先收集 propCalls');
  assert.ok(KEYS_SRC.includes('if (propCalls.size > 0)'), 'propCalls 非空才收编');
  assert.ok(KEYS_SRC.includes('if (!propCalls.has(m[1])) continue;'), '仅收编确有间接调用的属性名');
  assert.ok(KEYS_SRC.includes("bump(m[2], f.rel, 'prop-key');"), '以 prop-key 种类收编');
});
test('v290 F2. 行为：真仓库抽键量与登记量相等（本套件守 14 个新键全登记 + K1 零未登记）', () => {
  const r = runKeys(['--root', ROOT]);
  assert.equal(r.code, 0, r.out);
  /* [v3.10.0 交棒] 原判据写死「157 个 / 157 条」—— 那是**当版精确读数**，抬版即过期。
   *   本套件要守的是「抽取面与登记面**逐量相等**」（这才是 K1/K2/K3 零未登记的前提），
   *   不是某个具体数字。改为从读数行现取两个数再比 —— 数字换代不再翻红，口径消失才翻红。 */
  const uses = /storage 键使用点 (\d+) 个/.exec(r.out);
  const regd = /登记 (\d+) 条/.exec(r.out);
  assert.ok(uses && regd, '两条读数行都必须在场（口径不得静默消失）：' + r.out.slice(0, 200));
  assert.equal(uses[1], regd[1], '抽取量必须等于登记量（实测 ' + uses[1] + ' vs ' + regd[1] + '）');
  assert.ok(Number(uses[1]) >= 139, '抽取量必须 ≥ 139（v2.58 时的真实量级）');
  assert.match(r.out, /✓ 键归属全登记 \/ 声明与机制一致 \/ 登记条目全部存活/);
  assert.doesNotMatch(r.out, /K1 有/);
  assert.doesNotMatch(r.out, /K2 有/);
  assert.doesNotMatch(r.out, /K3 有/);
  // 14 个新增键必须全部在登记表里（会话隔离 11 + 全局 3）
  for (const k of ['life_events_v1', 'calendar_holidays', 'calendar_holiday_defaults_version',
    'calendar_theme', 'calendar_reminder_enabled', 'calendar_reminder_advance_minutes',
    'calendar_auto_schedule_enabled', 'music_favorites', 'weibo_profile',
    'weibo_liked_recommend_posts', 'weibo_liked_hot_search_index',
    'global_music_favorites', 'global_social_store_v1', 'phone_album_deleted_paths']) {
    assert.ok(KEYS_SRC.includes(`{ key: '${k}'`), `登记表缺 ${k}`);
  }
  // legacy 豁免：music_favorites 必须标 legacy（读侧已迁移）
  assert.match(KEYS_SRC, /\{ key: 'music_favorites', scope: 'chat', legacy: true,/);
});
test('v290 F3. 负控制：破坏 PROP_CALL_RE → 间接键面消失 → 14 个登记变死条目 → K3 拒判', () => {
  // 真源码破坏：把 PROP_CALL_RE 的 this\. 改成不可能命中的 this\NN_NEVER_
  const broken = replaceOnce(KEYS_SRC,
    'const PROP_CALL_RE = /(?:storage|VirtualPhone(?:\\?)?\\.storage)\\??\\.(?:set|get|remove)\\??\\.?\\s*\\(\\s*this\\.([A-Za-z_$][\\w$]*)\\b/g;',
    'const PROP_CALL_RE = /NEVER_MATCH/g;');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v290-keys-'));
  try {
    const copy = path.join(dir, 'keys-audit.mjs');
    writeFileSync(copy, broken);
    const r = (() => {
      try {
        const out = execFileSync(process.execPath, [copy, '--root', ROOT], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
        });
        return { code: 0, out };
      } catch (e) {
        return { code: e.status ?? -1, out: `${e.stdout || ''}${e.stderr || ''}` };
      }
    })();
    assert.equal(r.code, 2, `破坏后应 K3 拒判，实际 code=${r.code}`);
    assert.match(r.out, /K3 有 \d+ 条登记已失效/);
    assert.match(r.out, /life_events_v1/);
    assert.match(r.out, /calendar_holidays/);
    assert.match(r.out, /global_music_favorites/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
