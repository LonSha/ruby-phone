/* ============================================================
 * tests/system-v4997.test.mjs — R11-X7 余项验收：使用范式 → 通知中心阈值过滤
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   `config/usage-paradigm.js` 的 `filterNoticesByParadigm` 早就写好了（R8 期的纯函数），
 *   但**产品端零消费**（全仓实测：只有 orchestrator 的一句注释与 tests/ 提到它）。
 *   计划原文 R11-X7 的验收语里明写：「被过滤的通知在中心里显示『已按范式隐藏』而非消失」。
 *
 * 【直连为什么不行（本版真抓到的坑）】
 *   内核只看 `item.level` / `item.isUrgent` / `item.isImportant`，而通知中心的两种行**一个都不带**：
 *     · `NotificationLog` 的行（`_normalize`）字段里**没有 level**，`push()` 也不收 level；
 *     · 中枢映射行把优先级塞在 `meta.hubPriority`('URGENT'|'NORMAL'|'SILENT') /
 *       `meta.hubPriorityNum`(3|2|1) 里，行上同样没有 level。
 *   探针实测（一次性脚本，产物已清理）：直连后 urgent_only 把 **5 条全丢光**，
 *   连中枢那条 URGENT 也一起丢（hub 行存活 0/2）。不报错、不缺勤，纯粹把
 *   「过滤根本没生效/生效过头」演成「一切正常」—— 本仓治过多次的同一种病。
 *   故本版先加一层形状态翻译（`config/notice-paradigm-bridge.js`），再过滤。
 *
 * 【覆盖】
 *   A 适配层：档次判定有出处 / 入参一字不动 / 阈值三态（all / 未知回落 / 未设）
 *   B 分档：三档阈值在**真通知行**上留得对（含中枢 URGENT 不被误杀、SILENT 被隐）
 *   C 视图：被隐藏的不消失（区块 + 实名行）、all 档不占位、隐藏≠删除
 *   D 范式读口：读不到 / 没设过 / 坏 JSON 三态不同形，且读不到时**不过滤**
 *   E 接线自证：App 真 import 内核、视图不自己写第二套判据、键与另两处同源
 *   F 搜索重绘同链：打字不会把被范式藏起来的通知放出来（本版真修掉的一处）
 *   G 负控制：真源码破坏 ⇒ 在副本上重跑**同款判据**必须转红（双向断言）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PARADIGMS, PARADIGM_IDS, resolveActiveParadigm, filterNoticesByParadigm
} from '../config/usage-paradigm.js';
import {
  noticeLevelOf, thresholdOf, thresholdLabelOf, splitNoticesByParadigm
} from '../config/notice-paradigm-bridge.js';
import { mapHubNotification } from '../config/notification-hub-bridge.js';
import { NotificationLog } from '../config/system-notifications.js';
import { NotificationCenterApp, NOTICE_PARADIGM_KEY } from '../apps/notifications/notifications-app.js';
import { NotificationCenterView } from '../apps/notifications/notification-center-view.js';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BRIDGE_REL = 'config/notice-paradigm-bridge.js';
const APP_REL = 'apps/notifications/notifications-app.js';
const VIEW_REL = 'apps/notifications/notification-center-view.js';
const KERNEL_REL = 'config/usage-paradigm.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 夹具 ─────────────────────────────────────────────────── */
/** 内存 storage（本仓 storage 面只有 get/set）。 */
function memStorage(init = {}) {
  const mem = new Map(Object.entries(init));
  return {
    _mem: mem,
    get: (k, d) => (mem.has(k) ? mem.get(k) : d),
    set: (k, v) => { mem.set(k, v); },
    keys: () => [...mem.keys()]
  };
}
/** 三点 log 行（无 level）+ 四条 hub 行（URGENT/NORMAL/SILENT/URGENT）= 7 条。 */
function sampleRows() {
  return [
    { id: 'l1', ts: 7, title: '普通私信', message: '嗯', appId: 'wechat', read: false, count: 1, meta: {} },
    { id: 'l2', ts: 6, title: '重要通知', message: 'x', appId: 'calendar', read: false, count: 1, meta: {}, level: 'important' },
    { id: 'l3', ts: 5, title: '紧急来电', message: 'y', appId: 'phone', read: false, count: 1, meta: {}, level: 'urgent' },
    mapHubNotification({ id: 'h1', title: '日程提醒', appId: 'calendar', priority: 'NORMAL', timestamp: 4 }),
    mapHubNotification({ id: 'h2', title: '健康异动预警', appId: 'health', priority: 'URGENT', timestamp: 3 }),
    mapHubNotification({ id: 'h3', title: '早上好', appId: 'health', priority: 'SILENT', timestamp: 2 }),
    mapHubNotification({ id: 'h4', title: '低电量', appId: 'settings', priority: 3, timestamp: 1 })
  ];
}
/** 装一个最小 App（宿主只有 storage，无中枢 —— 本项不需要中枢）。 */
function mkApp(storageInit = {}) {
  const storage = memStorage(storageInit);
  const vp = { storage, notificationLog: null };
  globalThis.window = { VirtualPhone: vp };
  const log = new NotificationLog(storage, { key: 'sys_notifs', limit: 200 });
  vp.notificationLog = log;
  const app = new NotificationCenterApp({ setContent() {}, screen: null }, storage);
  return { app, storage, log, vp };
}
function unmount() { delete globalThis.window; }
/** 用一组行驱动视图渲染，抓 setContent 收到的 HTML（视图层判据只看这段文本）。 */
function renderView(rows, paradigmRaw, viewOverrides = {}) {
  const { app, storage } = mkApp();
  if (paradigmRaw !== undefined) storage.set(NOTICE_PARADIGM_KEY, paradigmRaw);
  app.feed = () => ({ rows, counts: { log: rows.length, hub: 0, hubMapped: 0, hubDropped: 0, total: rows.length }, notes: { logReadable: true, hubReadable: true, hubWhy: '', complete: true } });
  const view = new NotificationCenterView(app);
  Object.assign(view, viewOverrides);
  const chunks = [];
  app.phoneShell = { setContent(html) { chunks.push(html); } };
  view.render();
  unmount();
  return { html: chunks.join('\n'), chunks, view, app };
}

/* ══════════ A ── 适配层：档次判定有出处 ══════════ */
test('A1 档次判定必须说得出「凭什么」：每种来源都给对 source，不猜成重要', () => {
  assert.deepEqual(noticeLevelOf({ level: 'urgent' }), { level: 'urgent', source: 'row.level' });
  assert.deepEqual(noticeLevelOf({ level: 'IMPORTANT' }), { level: 'important', source: 'row.level' }, '大小写要归一');
  assert.deepEqual(noticeLevelOf({ meta: { hubPriority: 'URGENT' } }), { level: 'urgent', source: 'hubPriority' });
  assert.deepEqual(noticeLevelOf({ meta: { hubPriority: 'SILENT' } }), { level: 'silent', source: 'hubPriority' });
  assert.deepEqual(noticeLevelOf({ meta: { hubPriorityNum: 3 } }), { level: 'urgent', source: 'hubPriorityNum' });
  assert.deepEqual(noticeLevelOf({ meta: { hubPriorityNum: 1 } }), { level: 'silent', source: 'hubPriorityNum' });
  assert.deepEqual(noticeLevelOf({ isUrgent: true }), { level: 'urgent', source: 'isUrgent' });
  assert.deepEqual(noticeLevelOf({ isImportant: true }), { level: 'important', source: 'isImportant' });
  /* 什么都没说 ⇒ normal（与内核 `safeStr(item.level) || 'normal'` 同口径）。
   *   猜成 important 会让「读不到档次」在重要档下伪装成「这条很重要」—— 那是造假数据。 */
  assert.deepEqual(noticeLevelOf({ id: 'x' }), { level: 'normal', source: 'none' }, '说不出出处一律 normal，不许猜高');
  assert.deepEqual(noticeLevelOf(null), { level: 'normal', source: 'none' });
  assert.deepEqual(noticeLevelOf({ level: 'weird-write' }), { level: 'normal', source: 'none' }, '不认识的 level 当没说');
  /* 字符串名优先于数字：名字更明确，不受常量表漂移影响。 */
  assert.equal(noticeLevelOf({ meta: { hubPriority: 'URGENT', hubPriorityNum: 1 } }).level, 'urgent');
});

test('A2 适配不改入参：真通知行过滤完仍然一个字节都没变（过滤是呈现层的事，不许写回真源）', () => {
  const rows = sampleRows();
  const before = JSON.stringify(rows);
  splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]);
  assert.equal(JSON.stringify(rows), before, '入参必须一字不动');
  assert.ok(!('level' in rows[0]), 'log 行过滤后仍不该凭空长出 level');
  assert.ok(!('level' in rows[3]), 'hub 行同样');
  /* 行对象身份也不换：界面点击靠 id 反查，换对象会让「点开跳转」悄悄失效。 */
  const s = splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE]);
  assert.equal(s.visible[0], rows[0], 'all 档返回的必须是**同一批对象引用**（不是浅拷贝）');
});

/* 只取「这一条判据真正关心的三个字段」：`err` 是后加的第三个态（读阈值自己抛错），
 *   若用整对象 deepEqual，判据就过拟合到「返回体形状不许长新字段」这件无关的事上 ——
 *   加固桥层时会假红，而它本意只是核对三态分辨力。 */
const THR_OF = (p) => {
  const r = thresholdOf(p);
  assert.equal(r.err, '', '正常输入不该报 err');
  return { threshold: r.threshold, raw: r.raw, fallback: r.fallback };
};
test('A3 阈值三态不同形：合法三档 / 未设（设计内默认）/ 写了但不认识（坏数据）', () => {
  assert.deepEqual(THR_OF({ noticeThreshold: 'all' }), { threshold: 'all', raw: 'all', fallback: false });
  assert.deepEqual(THR_OF({ noticeThreshold: 'important' }), { threshold: 'important', raw: 'important', fallback: false });
  assert.deepEqual(THR_OF({ noticeThreshold: 'urgent_only' }), { threshold: 'urgent_only', raw: 'urgent_only', fallback: false });
  /* 未设：这是**设计内默认**，不是坏数据。 */
  assert.deepEqual(THR_OF({}), { threshold: 'all', raw: '', fallback: false });
    assert.deepEqual(THR_OF(null), { threshold: 'all', raw: '', fallback: false });
  /* 写了但不认识：坏数据，界面该说出来。两者都落 all，但**不能压成同一句**。 */
  assert.deepEqual(THR_OF({ noticeThreshold: 'weird' }), { threshold: 'all', raw: 'weird', fallback: true });
  assert.notDeepEqual(THR_OF({ noticeThreshold: 'weird' }), THR_OF({}), '坏阈值与未设阈值必须不同形');
  /* 内置六档：五档有阈值、custom 未设（走内核回落）。 */
  assert.equal(thresholdOf(DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE]).threshold, 'all');
  assert.equal(thresholdOf(DEFAULT_PARADIGMS[PARADIGM_IDS.CREATIVE]).threshold, 'important');
  assert.equal(thresholdOf(DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]).threshold, 'urgent_only');
  assert.equal(thresholdOf(DEFAULT_PARADIGMS[PARADIGM_IDS.IMMERSIVE]).threshold, 'important');
  assert.equal(thresholdOf(DEFAULT_PARADIGMS[PARADIGM_IDS.MINIMAL]).threshold, 'urgent_only');
  assert.equal(thresholdOf(resolveActiveParadigm({ activeId: 'custom' })).threshold, 'all', 'custom 未设阈值 ⇒ all');
});

/* ══════════ B ── 分档：真通知行上留得对 ══════════ */
test('B1 三档阈值在真通知行上留得对（直连会全丢，接桥才留得住）', () => {
  const rows = sampleRows();
  const all = splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE]);
  assert.equal(all.counts.visible, 7, 'all 档一条都不许少');
  assert.equal(all.counts.hidden, 0);
  assert.equal(all.applied, false, 'all 档 applied 必须 false（界面据此不占位）');

  const imp = splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.CREATIVE]);
  assert.deepEqual(imp.visible.map(r => r.id), ['l2', 'l3', 'hub_h2', 'hub_h4'],
    'important 档：留 important + urgent（含中枢 URGENT）');
  assert.deepEqual(imp.hidden.map(r => r.id), ['l1', 'hub_h1', 'hub_h3'], 'normal 与 silent 被隐');
  assert.equal(imp.applied, true);

  const urg = splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]);
  /* h4 用的是**数字档** 3（URGENT），与 h2 的字符串名同等对待 —— 这本身是一条判据：
   *   两种写法都要认，认漏一种就是「同一优先级一半活一半死」。 */
  assert.deepEqual(urg.visible.map(r => r.id), ['l3', 'hub_h2', 'hub_h4'], 'urgent_only 档：只留 urgent（名字档与数字档都算）');
  assert.equal(urg.counts.hidden, 4);
});

test('B2 中枢 URGENT 在 urgent_only 下必须活下来（直连的致命坑：它会被误杀）', () => {
  const rows = sampleRows();
  const s = splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]);
  const h2 = rows.find(r => r.id === 'hub_h2');
  assert.ok(s.visible.some(r => r.id === 'hub_h2'), '「健康异动预警」是 URGENT，urgent_only 下丢了就是误杀');
  assert.ok(s.hidden.some(r => r.id === 'hub_h3'), 'SILENT 的「早上好」在 urgent_only 下该隐');
  /* 反向自证：**直连**内核在这批行上确实会全丢 —— 这就是本层存在的理由。
   *   若哪天真源真的补上了 level 字段，这条会转红，提示「适配层可以退休了」。 */
  const naive = filterNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]);
  assert.equal(naive.filter(r => String(r.id).startsWith('hub_')).length, 0,
    '直连内核在这批行上一个 hub 都留不住（本层不是多余的抽象）');
  assert.equal(naive.length, 1, '直连只剩 l3 那条带 level 的（对照证据）');
});

test('B3 脏输入不炸：空数组 / null / 混入非对象都当 0 条，不抛', () => {
  for (const bad of [[], null, undefined, [null, 1, 'x', {}]]) {
    const s = splitNoticesByParadigm(bad, DEFAULT_PARADIGMS[PARADIGM_IDS.MINIMAL]);
    assert.equal(s.ok, true, '脏输入不许抛');
    assert.equal(s.counts.total, s.visible.length + s.hidden.length, '总数必须等于留+隐（不许漏计）');
  }
  assert.equal(splitNoticesByParadigm([null, 1, 'x'], DEFAULT_PARADIGMS[PARADIGM_IDS.MINIMAL]).counts.total, 0);
});

test('B4 同一档判据与内核对拍：本层不许自己写第二套留/丢口径', () => {
  /* 把所有行先翻译成「内核认的形状」，再用内核原样跑一遍 —— 结果必须与本层逐条一致。
   *   若哪天有人在桥里偷偷改了判据，这条会红。 */
  const rows = sampleRows();
  for (const id of [PARADIGM_IDS.LIFE, PARADIGM_IDS.CREATIVE, PARADIGM_IDS.RESEARCH, PARADIGM_IDS.MINIMAL]) {
    const p = DEFAULT_PARADIGMS[id];
    const adapted = rows.map(r => {
      const info = noticeLevelOf(r);
      return { ...r, level: info.level, isUrgent: info.level === 'urgent', isImportant: info.level === 'urgent' || info.level === 'important' };
    });
    const expect = filterNoticesByParadigm(adapted, p).map(r => r.id);
    const got = splitNoticesByParadigm(rows, p).visible.map(r => r.id);
    assert.deepEqual(got, expect, id + ' 档与内核判据必须逐条一致');
  }
});

/* ══════════ C ── 视图：被隐藏的不消失 ══════════ */
test('C1 被范式隐藏的通知**不消失**：区块实名列出、带「已按范式隐藏」字样', () => {
  const rows = sampleRows();
  const { html } = renderView(rows, JSON.stringify({ activeId: PARADIGM_IDS.RESEARCH }));
  assert.match(html, /已按范式隐藏/, '验收语要求这五个字出现');
  assert.match(html, /已按范式隐藏 4 条/, '条数要写对（7 条里留 3 条：紧急来电 + 中枢 URGENT 两条）');
  assert.match(html, /nc-hid/, '必须有隐藏区容器');
  assert.match(html, /下面的通知没被删/, '必须明写「没被删」——否则用户以为丢了');
  /* 隐藏区的展开按钮要在，且列表区**不含**被隐的行、隐藏区**含**。 */
  assert.match(html, /data-hid-toggle/, '必须可展开');
  assert.match(html, /已按范式/, '读数行要在');
  const listPart = html.split('nc-hid')[0];
  assert.ok(!/data-id="l1"/.test(listPart), '被隐的行不许出现在主列表里');
});

test('C2 展开后隐藏区逐条实名、且能点开能删（不是死文本）', () => {
  const rows = sampleRows();
  const { html } = renderView(rows, JSON.stringify({ activeId: PARADIGM_IDS.RESEARCH }), { _hiddenOpen: true });
  for (const id of ['l1', 'l2', 'hub_h1', 'hub_h3']) {
    assert.match(html, new RegExp('data-id="' + id + '"'), '展开后必须逐条实名：' + id);
  }
  assert.match(html, /data-del="l1"/, '隐藏区里的行也要能删（删除钮走同一份 _row）');
  assert.match(html, /收起/, '展开后按钮应变成「收起」');
});

test('C3 all 档与「隐 0 条」不同形：all 档不占位，非 all 但没藏东西要说明', () => {
  const rows = sampleRows();
  const allHtml = renderView(rows, JSON.stringify({ activeId: PARADIGM_IDS.LIFE })).html;
  /* ⚠️ 不能直接搜 `nc-hid`：`css()` 会把样式表一起拼进 setContent 的 HTML，
   *   样式表里本来就有 `.nc-hid` 定义 —— 那样「有没有渲染隐藏区」这条判据永远为真（假绿）。
   *   只认**渲染出来的元素**。 */
  assert.ok(!/class="nc-hid"/.test(allHtml), 'all 档不该出现隐藏区容器（没藏东西就别占位）');
  assert.ok(!/已按范式隐藏/.test(allHtml), 'all 档不该喊「隐藏 0 条」');
  assert.ok(!/已按范式/.test(allHtml), 'all 档读数行应整体不显示');

  /* 非 all 档但一条都没藏：只说「这次没有需要隐藏的」，不说「隐藏 0 条」。 */
  const onlyUrgent = [mapHubNotification({ id: 'u1', title: '急', appId: 'health', priority: 'URGENT', timestamp: 1 })];
  const html = renderView(onlyUrgent, JSON.stringify({ activeId: PARADIGM_IDS.RESEARCH })).html;
  assert.match(html, /这次没有需要隐藏的/, '非 all 且没藏东西要如实说明');
  assert.ok(!/class="nc-hid"/.test(html), '没藏东西不该出现隐藏区容器');
  assert.ok(!/隐藏了 0 条/.test(html), '不许写「隐藏了 0 条」');
});

test('C4 隐藏≠删除：渲染前后真源条数不变，展开也不写盘', () => {
  const rows = sampleRows();
  const storage = memStorage({ [NOTICE_PARADIGM_KEY]: JSON.stringify({ activeId: PARADIGM_IDS.RESEARCH }) });
  const calls = [];
  const origSet = storage.set;
  storage.set = (k, v) => { calls.push([k, v]); origSet(k, v); };
  const vp = { storage, notificationLog: null };
  globalThis.window = { VirtualPhone: vp };
  const log = new NotificationLog(storage, { key: 'sys_notifs', limit: 200 });
  vp.notificationLog = log;
  for (const r of rows.slice(0, 3)) log.push({ title: r.title, message: r.message, appId: r.appId });
  const before = log.list().length;
  const app = new NotificationCenterApp({ setContent() {}, screen: null }, storage);
  app.feed = () => ({ rows, counts: {}, notes: { logReadable: true, hubReadable: true, hubWhy: '', complete: true } });
  const view = new NotificationCenterView(app);
  app.phoneShell = { setContent() {} };
  view.render();
  view._hiddenOpen = true;
  view.render();
  assert.equal(log.list().length, before, '渲染与展开都不许改真源条数');
  assert.ok(!calls.some(([k]) => k === 'sys_notifs'), '渲染不许往 sys_notifs 写（写回就是往真源塞渲染态）');
  unmount();
});

test('C5 只读反查口：hub 行进隐藏区后能被查到（否则组内成员行静默留空）', () => {
  /* `_byId` 是组内成员行与隐藏区展开的唯一反查入口。若它只查落账层，
   *   `hub_` 前缀的行永远返回 null ⇒ 成员行**静默留空**（不报错、不缺勤），
   *   与「组里本来就没有」完全同形 —— 这正是本仓反复治的三态压平。 */
  const { app } = mkApp();
  const hubRows = [
    { id: 'n1', appId: 'health', title: '健康异动预警', body: '心率骤升', priority: 'URGENT', timestamp: 10 },
    { id: 'n2', appId: 'calendar', title: '日程提醒', body: '开会', priority: 'NORMAL', timestamp: 9 }
  ];
  app._resolveHub = () => ({ ok: true, why: '', hub: { notifications: hubRows } });
  const got = app.rowById('hub_n1');
  assert.ok(got, 'hub_n1 必须查得到');
  assert.equal(got.title, '健康异动预警');
  assert.equal(got.message, '心率骤升', '映射必须是桥那一份（body → message）');
  assert.equal(got.meta.hubPriority, 'URGENT', '必须带优先级（判档要用）');
  assert.equal(app.rowById('hub_nope'), null, '查不到如实 null，不许补空壳');
  assert.equal(app.rowById('hub_'), null, '空前缀不许抛出');
  assert.equal(app.rowById(''), null);
  /* 中枢读不到时同样是 null，而不是抛给渲染层（渲染层抛错会整片白屏）。 */
  app._resolveHub = () => ({ ok: false, why: 'no_dispatcher', hub: null });
  assert.equal(app.rowById('hub_n1'), null);
  unmount();
});

/* ══════════ D ── 范式读口四态 ══════════ */
test('D1 范式读口四态不同形：读到 / 没设过 / 坏 JSON / 没有 storage', () => {
  const { app, storage } = mkApp();
  const okUnset = app._resolveParadigm();
  assert.equal(okUnset.ok, true, '键没写过是**正常初态**，不是读不到');
  assert.equal(okUnset.why, 'unset');
  assert.equal(okUnset.paradigm.id, PARADIGM_IDS.LIFE, '初态回落内置生活档');

  storage.set(NOTICE_PARADIGM_KEY, JSON.stringify({ activeId: PARADIGM_IDS.MINIMAL }));
  const ok = app._resolveParadigm();
  assert.equal(ok.ok, true);
  assert.equal(ok.why, '');
  assert.equal(ok.paradigm.id, PARADIGM_IDS.MINIMAL, '必须读到盘上那个');

  storage.set(NOTICE_PARADIGM_KEY, '{坏 json');
  const bad = app._resolveParadigm();
  assert.equal(bad.ok, false, '坏 JSON 必须报读不到（不许静默当生活档）');
  assert.equal(bad.why, 'parse_threw');
  assert.equal(bad.paradigm.id, PARADIGM_IDS.LIFE, '读不到时给的是回落档，但 ok:false 让界面说得出差别');

  const noStore = new NotificationCenterApp({ setContent() {}, screen: null }, null);
  /* ⚠️ 必须先把宿主卸掉：`_resolveParadigm` 在实例 storage 为空时会**回落宿主 storage**
   *   （这是设计内的兜底），而本测试前半段已经装过宿主 —— 不卸就测不到 `no_storage` 这一态。
   *   这不是判据凑数：它恰好证明「兜底链真的存在」，见 E 段的接线自证。 */
  unmount();
  const ns = noStore._resolveParadigm();
  assert.equal(ns.ok, false);
  assert.equal(ns.why, 'no_storage');
  unmount();
});

test('D2 范式读不到时**不过滤**（不能因为一个坏键就把用户的未读藏起来）', () => {
  const { app, storage } = mkApp();
  storage.set(NOTICE_PARADIGM_KEY, '{坏 json');
  const rows = sampleRows();
  const s = app.splitByParadigm(rows);
  assert.equal(s.paradigm.ok, false);
  assert.equal(s.applied, false, '读不到就必须不过滤');
  assert.equal(s.rows.length, rows.length, '一条都不许少');
  assert.equal(s.hidden.length, 0);
  /* 界面必须说出来，且明写「不是你在生活档」。 */
  const { html } = renderView(rows, '{坏 json');
  assert.match(html, /使用范式没读到/, '必须报读不到');
  assert.match(html, /本次不过滤/, '必须说明没过滤');
  assert.match(html, /不是「你在生活档」/, '不许把读不到伪装成一个正常档位');
});

/* ══════════ E ── 接线自证 ══════════ */
test('E1 App 真 import 内核与桥：两个真 import 都在，不是注释里提一句', () => {
  const src = stripComments(read(APP_REL));
  assert.match(src, /import\s*\{\s*resolveActiveParadigm\s*\}\s*from\s*'\.\.\/\.\.\/config\/usage-paradigm\.js'/,
    'App 必须真 import 内核（范式从盘上读，不许自造一份）');
  assert.match(src, /import\s*\{\s*splitNoticesByParadigm\s*\}\s*from\s*'\.\.\/\.\.\/config\/notice-paradigm-bridge\.js'/,
    'App 必须真 import 桥');
  /* 内核的过滤函数必须**只在桥里**被调用一次（App/视图不许再调一遍）。 */
  assert.ok(!/filterNoticesByParadigm\s*\(/.test(stripComments(read(APP_REL))),
    'App 不许直接调过滤内核（会在适配之外的形状上再过滤一遍）');
  assert.ok(!/filterNoticesByParadigm\s*\(/.test(stripComments(read(VIEW_REL))),
    '视图更不许调（视图只渲染，不判档）');
});

test('E2 视图不写第二套判据：_visibleRows 里没有 level/urgent/threshold 判断', () => {
  const src = read(VIEW_REL);
  const at = src.indexOf('_visibleRows(all) {');
  assert.ok(at > 0, '找不到 _visibleRows');
  const open = src.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open, end + 1);
  assert.ok(!/urgent/i.test(body), '_visibleRows 不许出现 urgent（判档是内核的事）');
  assert.ok(!/threshold/i.test(body), '_visibleRows 不许出现 threshold');
  assert.ok(!/\.level\b/.test(body), '_visibleRows 不许读 level');
});

test('E3 范式键三处同源：App 常量 == 洞察 App 的 PARADIGM_KEY == 主屏字面量', async () => {
  const usage = await import('../apps/usage/usage-app.js');
  assert.equal(NOTICE_PARADIGM_KEY, usage.PARADIGM_KEY, 'App 与洞察 App 必须同一个键');
  const homeSrc = stripComments(read('phone/home-screen.js'));
  assert.ok(homeSrc.includes("'" + NOTICE_PARADIGM_KEY + "'"),
    '主屏读的必须是同一个键（否则「切了范式通知不变」）');
  /* 全仓不许有第二个范式键字面量。 */
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); continue; }
      if (!/\.(js|mjs)$/.test(e.name)) continue;
      const t = fs.readFileSync(p, 'utf8');
      if (/usage_paradigm_v\d/.test(t)) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'apps')); walk(path.join(ROOT, 'phone')); walk(path.join(ROOT, 'config'));
  assert.deepEqual(hits.sort(), ['apps/notifications/notifications-app.js', 'apps/usage/usage-app.js', 'phone/home-screen.js'],
    '范式键只许出现在这三处（多一处就是第二份真源）');
});

test('E4 过滤顺序：先范后 chip（chip 计数必须反映范式之后剩下的）', () => {
  const rows = sampleRows();
  const { html } = renderView(rows, JSON.stringify({ activeId: PARADIGM_IDS.RESEARCH }));
  /* 全部 chip 的计数应是范式之后的 3（紧急来电 + 中枢 URGENT 名/数两条），不是原来的 7。 */
  const m = html.match(/data-filter="">全部<span class="nc-chip-num">(\d+)<\/span>/);
  assert.ok(m, '找不到「全部」chip');
  const n = Number(m[1]);
  assert.equal(n, 3, 'chip 计数必须按范式之后的行算（实际 ' + n + '），否则点开会变空');
  /* 双向：主列表里也不许出现被隐的 appId chip（否则 chip 点开是空的）。 */
  assert.ok(!/data-filter="wechat"/.test(html), '普通私信被隐后不该留 wechat chip');
});

test('E5 档次文案只有一处出处：视图不许自己写档名字面量', () => {
  /* 视图曾经自己写过 `{ important: ... , urgent_only: ... }` —— 那等于第二处档次真源：
   *   内核改名 / 加第四档时视图不会跟着变，也没有判据替它响。
   *   本判据钉死：档名字面量只在桥层出现，视图只许消费 `split.label`。 */
  const viewSrc = stripComments(read(VIEW_REL));
  assert.ok(!/'important'/.test(viewSrc), '视图不许出现 important 字面量（档名属桥层）');
  assert.ok(!/'urgent_only'/.test(viewSrc), '视图不许出现 urgent_only 字面量（档名属桥层）');
  assert.match(viewSrc, /s\.label/, '视图必须从 split.label 取档次文案');
});
test('E6 三档阈值都有中文文案、坏阈值如实念、all 档空串（行为判据，不看表结构）', () => {
  /* 不 export 文案表来给判据核对键集：那会让表自己变成「只有测试消费的导出」，
   *   bind-audit 会记一条零消费（本版真踩过）。
   *   改为打**行为**：对内核认的三档逐个问文案，必须都是非空中文；
   *   坏值必须如实念出来，不许装成正常档 —— 这才是用户会看到的那一面。 */
  const labelAll = thresholdLabelOf('all');
  const labelImp = thresholdLabelOf('important');
  const labelUrg = thresholdLabelOf('urgent_only');
  assert.equal(labelAll, '', 'all 档不该有文案（界面本来就不该为它占位）');
  for (const [k, v] of [['important', labelImp], ['urgent_only', labelUrg]]) {
    assert.equal(typeof v, 'string', k + ' 必须有字符串文案');
    assert.ok(v.length > 0, k + ' 的文案不许为空（空了界面上会印出英文档名）');
    assert.ok(/[\u4e00-\u9fa5]/.test(v), k + ' 的文案必须是中文（英文档名漏到界面 = 像没做完）');
    assert.ok(!v.includes(k), k + ' 的文案不许包含它自己的英文档名');
  }
  assert.notEqual(labelImp, labelUrg, '两个档的文案必须不同形（否则用户分不清哪个是哪个）');
  assert.equal(thresholdLabelOf('weird'), '阈值「weird」', '坏阈值要如实念出来，不许装成正常档');
  assert.equal(thresholdLabelOf(''), '', '空阈值不念「阈值「」」这种怪话');
});
test('E7 返回体两形都带 label，且失败形不许少条目（形状不留例外）', () => {
  const rows = sampleRows();
  const okSplit = splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]);
  assert.equal(okSplit.ok, true);
  assert.equal(okSplit.label, '只留紧急');
  /* 失败形：阈值的 getter 抛错 ⇒ 桥层必须抓出来并全量显示，且 label 仍是字符串
   *   （否则界面拿 undefined 拼出「已按范式undefined」）。 */
  const evil = {};
  Object.defineProperty(evil, 'noticeThreshold', {
    get() { throw new Error('boom_thr'); }
  });
  const badSplit = splitNoticesByParadigm(rows, evil);
  assert.equal(badSplit.ok, false, '内核抛错必须被这一层念出来，不许静默');
  assert.equal(badSplit.applied, false);
  assert.equal(badSplit.visible.length, rows.length, '过滤坏了就全量显示，一条都不许少');
  assert.equal(typeof badSplit.label, 'string', '失败分支的 label 不许是 undefined');
});
/* ══════════ F ── 搜索重链 ══════════ */
test('F1 搜索重绘必须同一条过滤链：打字不会把被范式藏起来的通知放出来', () => {
  const src = read(VIEW_REL);
  const at = src.indexOf("root.querySelector('#nc-search')");
  assert.ok(at > 0);
  const seg = src.slice(at, at + 1600);
  assert.match(seg, /splitByParadigm/, '搜索回调必须也走范式分流');
  assert.match(seg, /feed\(\)/, '搜索回调必须也走 feed()（不许直接 log.list()）');
  assert.ok(!/const all = this\.app\.log\.list\(\);/.test(seg), '不许退回直读 log.list()');
});

/* ══════════ G ── 负控制（双向断言） ══════════ */
/** 真源码破坏（锚点必须恰中一次）。 */
function brokenSource(rel, pairs) {
  let src = read(rel);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(String(from).slice(0, 70)));
    src = src.replace(from, to);
  }
  return src;
}
/** 把破坏源码落成临时文件（同目录依赖一并复制），返回 file:// URL。 */
function brokenCopy(rel, pairs, outName) {
  const src = brokenSource(rel, pairs);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x7_'));
  const deps = new Set();
  const re = /from\s+'\.\/([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) deps.add(m[1]);
  for (const dep of deps) {
    const from = path.join(ROOT, 'config', dep);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, dep));
  }
  const file = path.join(dir, outName);
  fs.writeFileSync(file, src, 'utf8');
  return 'file://' + file;
}

test('G1 负控制 · hub 优先级不再被翻译 ⇒ 中枢行集体掉档，同款判据必须转红', async () => {
  const criterion = (mod) => {
    const rows = sampleRows();
    const s = mod.splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.RESEARCH]);
    return s.visible.some(r => r.id === 'hub_h2');
  };
  assert.equal(criterion({ splitNoticesByParadigm }), true, '同款判据在原版上必须为真');
  const B = await import(brokenCopy(BRIDGE_REL, [
    /* 两条路径都要拆：hub 行同时带 `hubPriority`(名字) 与 `hubPriorityNum`(数字)，
     *   只拆一条的话另一条照样把它翻成 urgent —— 那样判据不红，是**破坏没打中分辨力点**，
     *   不是判据写得不对（本仓 G 段反复踩的坑，这里一次拆全）。 */
    ["if (name && HUB_NAME_TO_LEVEL[name]) return { level: HUB_NAME_TO_LEVEL[name], source: 'hubPriority' };", ""],
    ["return { level: HUB_NUM_TO_LEVEL[num], source: 'hubPriorityNum' };", ""]
  ], 'notice-paradigm-bridge.nohub.js'));
  assert.equal(criterion(B), false, '不翻译 hubPriority/hubPriorityNum ⇒ 中枢 URGENT 再也没人认得出，判据必须转红');
});

test('G2 负控制 · 未设阈值被当成 unknown 而回落 ⇒ 「设计内默认」与「坏数据」混成一句，判据转红', async () => {
  const criterion = (mod) => {
    const unset = mod.thresholdOf({});
    const bad = mod.thresholdOf({ noticeThreshold: 'weird' });
    /* 判据本体的分辨力点：两者 fallback 必须不同（False vs True）。 */
    return unset.fallback === false && bad.fallback === true;
  };
  assert.equal(criterion({ thresholdOf }), true, '原版上必须分得开');
  const B = await import(brokenCopy(BRIDGE_REL, [
    /* 锚点跟着桥层加固后的形状走：`err` 是后加的第三个态（读阈值自己抛错），
     *   负控制要破坏的仍是「未设 vs 坏数据」这一对，故锚更新为现形状。 */
    ["return { threshold: 'all', raw, fallback: raw !== '', err: '' };",
     "return { threshold: 'all', raw, fallback: true, err: '' };"]
  ], 'notice-paradigm-bridge.badfb.js'));
  assert.equal(criterion(B), false, '未设阈值也被标成 fallback ⇒ 三态压成一句，判据必须转红');
});

test('G3 负控制 · 适配层改写入参 ⇒ 「不过滤时返回同一批对象引用」判据转红', async () => {
  const criterion = (mod) => {
    const rows = sampleRows();
    const ref = rows[0];
    const s = mod.splitNoticesByParadigm(rows, DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE]);
    return s.visible[0] === ref;
  };
  assert.equal(criterion({ splitNoticesByParadigm }), true, '原版上 all 档返回同一批引用');
  const B = await import(brokenCopy(BRIDGE_REL, [
    ['if (keptSet.has(adapted[i])) visible.push(list[i]);', 'if (keptSet.has(adapted[i])) visible.push(adapted[i]);']
  ], 'notice-paradigm-bridge.alias.js'));
  assert.equal(criterion(B), false, '把适配副本当结果返回 ⇒ 界面点击反查会失效，判据必须转红');
});

test('G4 负控制 · 范式读不到也照样过滤 ⇒ 「读不到就不过滤」判据转红', async () => {
  /* 判据走真 App：破坏 `_resolveParadigm` 的失败分支，让它谎报 ok:true。 */
  const criterion = async (appSrc) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x7app_'));
    const dir = path.join(tmp, 'apps', 'notifications');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notifications-app.js'), appSrc, 'utf8');
    /* 同目录依赖一并复制（视图与 CSS 全在同目录）。 */
    for (const f of fs.readdirSync(path.join(ROOT, 'apps', 'notifications'))) {
      if (f === 'notifications-app.js') continue;
      const from = path.join(ROOT, 'apps', 'notifications', f);
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, f));
    }
    for (const d of ['config']) {
      fs.mkdirSync(path.join(tmp, d), { recursive: true });
      for (const f of fs.readdirSync(path.join(ROOT, d))) {
        if (/\.js$/.test(f)) fs.copyFileSync(path.join(ROOT, d, f), path.join(tmp, d, f));
      }
    }
    const mod = await import('file://' + path.join(dir, 'notifications-app.js').replace(/\\/g, '/'));
    const storage = memStorage({ [mod.NOTICE_PARADIGM_KEY]: '{坏 json' });
    globalThis.window = { VirtualPhone: { storage } };
    const app = new mod.NotificationCenterApp({}, storage);
    const s = app.splitByParadigm(sampleRows());
    unmount();
    /* ★ 判据必须打中**分辨力点**：只看「没过滤」是不够的 —— 坏 JSON 被静默当成 `{}`
     *   照样会落到 life 档、threshold=all、applied=false、一条不少，与「读不到」**完全同形**。
     *   真正区分两者的是 `paradigm.ok` 与 `why`：读不到必须是 ok:false + 具体原因。
     *   （本仓 G 段的老坑：破坏与默认行为等价 ⇒ 判据不红 ⇒ 假绿，这里正是那个坑。） */
    return s.applied === false && s.rows.length === 7 && s.paradigm.ok === false && s.paradigm.why === 'parse_threw';
  };
  assert.equal(await criterion(read(APP_REL)), true, '原版：范式读不到 ⇒ applied:false、一条不少、且 ok:false 说得出原因');
  const broken = brokenSource(APP_REL, [
    ["try { obj = JSON.parse(raw); } catch (_e) { return { ok: false, why: 'parse_threw', paradigm: this._defaultParadigm(), key }; }",
     "try { obj = JSON.parse(raw); } catch (_e) { obj = {}; }"]
  ]);
  assert.equal(await criterion(broken), false, '坏 JSON 静默当生活档 ⇒ 「藏了用户未读还说一切正常」，判据必须转红');
});

test('G5 负控制 · 隐藏区移除 ⇒ 「被隐藏的通知不消失」判据转红（验收语本体）', () => {
  /* 用源码面判据：`_hiddenSection` 的渲染必须真的接进 render() 的返回值。
   *   破坏方式：把 render() 里的 `${this._hiddenSection(split)}` 摘掉。 */
  const criterion = (src) => {
    const at = src.indexOf('render() {');
    assert.ok(at > 0, '找不到 render()');
    const seg = src.slice(at, src.indexOf('shell.setContent', at));
    return /\$\{this\._hiddenSection\(split\)\}/.test(seg);
  };
  assert.equal(criterion(read(VIEW_REL)), true, '原版：render() 必须真接隐藏区');
  const broken = brokenSource(VIEW_REL, [
    ['${this._hiddenSection(split)}', '']
  ]);
  assert.equal(criterion(broken), false, '摘掉隐藏区 ⇒ 被隐藏的通知就真消失了，判据必须转红');
});
