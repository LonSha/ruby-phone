/* ============================================================
 * tests/system-v41000.test.mjs — R11-X6 验收：中枢通知派发器接进通知中心
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   本仓有**两套通知真源**：`NotificationLog`（落盘 `sys_notifs`，通知中心在读）
 *   与 `SystemNotificationDispatcher`（落盘 `sys_notifications_queue`，中枢在写）。
 *   后者是 25 个中枢实例里唯二在中枢内部有真调用的那一件，但**产品端零读** ——
 *   于是「健康异动预警」「日程提醒」这类中枢派发的通知，用户一次都没看到过。
 *   「中枢能通向产品」这件事在本仓此前一次都没成立过，本项是第一个模板。
 *
 * 【覆盖】
 *   A 映射：两张表的行形状不同，映射必须显式（ts/timestamp、message/body、count）
 *   B 合并：只读不改入参、不写回、不复制成两份真源；排序新者在前
 *   C 三态：读到了有 N 条 / 读到了 0 条 / **读不到** —— 必须不同形
 *   D 写回：已读回中枢那张表，**不**抄进落账层
 *   E 顺带修掉的真缺陷：优先级字符串 / 数字混用 ⇒ 免打扰此前一条都拦不住
 *   F 接线自证：App 真 import 桥、视图真走 App 的 feed、不自己去碰第二张表
 *   G 负控制：破坏映射锚点 / 破坏三态分流 ⇒ 同款判据在副本上转红
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeFeed, mapHubNotification } from '../config/notification-hub-bridge.js';
import {
  SystemNotificationDispatcher, NOTIFICATION_PRIORITY, normalizePriority, priorityName,
} from '../config/system-notification-dispatcher.js';
import { NotificationLog } from '../config/system-notifications.js';
import { NotificationCenterApp } from '../apps/notifications/notifications-app.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');

function mkStorage() {
  const m = new Map();
  return {
    get: (k, d) => (m.has(k) ? m.get(k) : d),
    set: (k, v) => m.set(k, v),
    remove: (k) => m.delete(k),
    _map: m,
  };
}
/** 装一个宿主夹具：VirtualPhone.subsystems.notifications + notificationLog。 */
function mountHost(hub, log) {
  const vp = { subsystems: hub ? { notifications: hub } : null, notificationLog: log || null };
  globalThis.window = { VirtualPhone: vp };
  return vp;
}
function unmountHost() { delete globalThis.window; }

/* ══════════ A ── 映射：两套行形状不同，必须显式 ══════════ */
test('A1 中枢行 → 落账层行形状：ts/timestamp 与 message/body 都要搬到正确字段', () => {
  const raw = {
    id: 'notif_1', appId: 'smart_band', title: '健康异动预警', body: '心率骤升',
    priority: 3, priorityName: 'URGENT', timestamp: 1700000000000, read: false,
    deepLink: { targetApp: 'health', view: 'detail' }, metadata: { k: 'v' },
  };
  const row = mapHubNotification(raw);
  assert.ok(row, '合格行必须映射成功');
  assert.equal(row.ts, 1700000000000, 'timestamp 必须搬到 ts（搬错 ⇒ 界面显示 1970）');
  assert.equal(row.message, '心率骤升', 'body 必须搬到 message（搬错 ⇒ 正文永远是空的）');
  assert.equal(row.title, '健康异动预警');
  assert.equal(row.count, 1, '中枢行没有 count，恒 1（不能留 undefined）');
  assert.ok(row.icon, '必须有图标字形（缺了行会画成空白头像）');
  assert.equal(row.appId, 'smart_band', 'appId 不得改名（改名 ⇒ 点开跳错 App，且不报错）');
  assert.equal(row.meta.hubSource, true, '必须带来源标记：界面要能说清它不来自 sys_notifs');
  assert.equal(row.meta.hubPriority, 'URGENT');
  assert.deepEqual(row.meta.hubDeepLink, { targetApp: 'health', view: 'detail' });
  assert.equal(row.meta.k, 'v', 'metadata 必须原样带上（不许丢）');
  assert.match(row.id, /^hub_/, 'id 必须有独立命名空间前缀（防与落账层 id 撞车）');
});

test('A2 不合格行不补空壳：非对象 / 空标题 一律返回 null（补一个「（无标题）」会让界面假装有东西）', () => {
  assert.equal(mapHubNotification(null), null);
  assert.equal(mapHubNotification(undefined), null);
  assert.equal(mapHubNotification(42), null);
  assert.equal(mapHubNotification([]), null);
  assert.equal(mapHubNotification({}), null);
  assert.equal(mapHubNotification({ title: '' }), null);
  assert.equal(mapHubNotification({ title: '   ' }), null);
});

/* ══════════ B ── 合并：只读、不复制两份真源、排序 ══════════ */
test('B1 合并是纯读：入参数组与元素不被改写（复制一份就是两份真源）', () => {
  const logRows = [{ id: 'L1', ts: 100, title: 'A', message: 'a', read: false }];
  const hubRows = [{ id: 'h1', title: 'B', body: 'b', timestamp: 200, priority: 'URGENT' }];
  const logSnap = JSON.stringify(logRows);
  const hubSnap = JSON.stringify(hubRows);
  const out = mergeFeed(logRows, hubRows);
  assert.equal(out.rows.length, 2);
  assert.equal(JSON.stringify(logRows), logSnap, '入参 logRows 被改写了');
  assert.equal(JSON.stringify(hubRows), hubSnap, '入参 hubRows 被改写了');
});

test('B2 排序口径：新者在前；ts 缺失（0）的沉底，不许冒充「刚刚」', () => {
  const logRows = [{ id: 'L1', ts: 100, title: 'old', message: '', read: false }];
  const hubRows = [
    { id: 'h1', title: 'noTs', body: '', timestamp: undefined },
    { id: 'h2', title: 'newest', body: '', timestamp: 900 },
  ];
  const out = mergeFeed(logRows, hubRows);
  assert.deepEqual(out.rows.map((r) => r.title), ['newest', 'old', 'noTs']);
});

test('B3 计数如实：hubMapped / hubDropped 分开报（丢了几条不许静默）', () => {
  const hubRows = [null, 42, {}, { title: '' }, { title: '真的一条' }];
  const out = mergeFeed([], hubRows);
  assert.equal(out.counts.hub, 5);
  assert.equal(out.counts.hubMapped, 1);
  assert.equal(out.counts.hubDropped, 4);
  assert.equal(out.counts.total, 1);
});

/* ══════════ C ── 三态必须不同形 ══════════ */
test('C1 三态不同形：读到了有 N 条 / 读到了 0 条 / 读不到（第三类压成第二类=粉饰）', () => {
  const has = mergeFeed([{ id: 'L', ts: 1, title: 'x', message: '' }], [{ title: 'h', body: '', timestamp: 2 }],
    { logReadable: true, hubReadable: true });
  const empty = mergeFeed([{ id: 'L', ts: 1, title: 'x', message: '' }], [],
    { logReadable: true, hubReadable: true });
  const broke = mergeFeed([{ id: 'L', ts: 1, title: 'x', message: '' }], [],
    { logReadable: true, hubReadable: false, hubWhy: 'no_dispatcher' });
  assert.equal(has.notes.complete, true);
  assert.equal(has.counts.hubMapped, 1);
  /* 空表 vs 读不到：rows 都是 1（只有落账层那条），必须靠 notes 分开 */
  assert.deepEqual(empty.rows.length, broke.rows.length, '两种情况下行数相同 —— 正因如此才必须靠 notes 分');
  assert.equal(empty.notes.hubReadable, true, '读到了 0 条：hubReadable 必须为 true');
  assert.equal(empty.notes.hubWhy, '', '读到了就不该有 why');
  assert.equal(empty.notes.complete, true, '两侧都读到了 ⇒ complete=true（哪怕中枢是空的）');
  assert.equal(broke.notes.hubReadable, false, '读不到：hubReadable 必须为 false');
  assert.equal(broke.notes.hubWhy, 'no_dispatcher', '读不到必须给出可念出来的原因');
  assert.equal(broke.notes.complete, false, '读不到 ⇒ complete=false，列表不可当「就这些」');
});

/* ══════════ D ── 写回：已读回中枢那张表，不抄进落账层 ══════════ */
test('D1 中枢 → 界面 → 已读回写中枢；落账层条数一条不变（不制造第二份真源）', () => {
  const storage = mkStorage();
  const hub = new SystemNotificationDispatcher({ storage });
  hub.post({ appId: 'smart_band', title: '健康异动预警', body: '心率骤升', priority: 'URGENT' });
  const log = new NotificationLog(storage, { key: 'sys_notifs', limit: 200 });
  log.push({ title: '落账层那条', message: 'm', appId: 'wechat' });
  mountHost(hub, log);
  try {
    const app = new NotificationCenterApp({ setContent() {} }, storage);
    const f = app.feed();
    assert.equal(f.counts.total, 2);
    assert.equal(f.counts.hubMapped, 1);
    const hubRow = f.rows.find((r) => r.meta?.hubSource);
    assert.ok(hubRow, '中枢那条必须出现在合并列表里（此前它用户永远看不到）');
    const logLenBefore = log.list().length;
    assert.equal(app.ackHub(hubRow.id), true, 'ackHub 必须真写回');
    assert.equal(hub.notifications.filter((n) => n.read).length, 1, '中枢那张表里必须变成已读');
    assert.equal(log.list().length, logLenBefore, '落账层条数不得因为标记中枢已读而变化');
    assert.equal(app.ackHub('hub_') , false, '空 id 必须返回 false（不真不假地成功）');
    assert.equal(app.ackHub('hub_not-exist'), false, '不存在的 id 必须返回 false');
  } finally { unmountHost(); }
});

test('D2 中枢缺失时可成功降级：落账层照常画，notes 如实说有一侧没读到', () => {
  const storage = mkStorage();
  const log = new NotificationLog(storage, { key: 'sys_notifs', limit: 200 });
  log.push({ title: '只有落账层那条', message: 'm', appId: 'wechat' });
  mountHost(null, log);
  try {
    const app = new NotificationCenterApp({ setContent() {} }, storage);
    const f = app.feed();
    assert.equal(f.counts.total, 1, '不得整页空白');
    assert.equal(f.notes.hubReadable, false);
    assert.equal(f.notes.hubWhy, 'no_subsystems');
    assert.equal(f.notes.complete, false);
  } finally { unmountHost(); }
});

/* ══════════ E ── 顺带修掉的真缺陷：优先级字符串/数字混用 ══════════ */
test('E1 优先级两种写法都认；认不出回落 NORMAL（不回落到 URGENT —— 拼错不许把人从免打扰里拽出来）', () => {
  assert.equal(normalizePriority('URGENT'), NOTIFICATION_PRIORITY.URGENT);
  assert.equal(normalizePriority('urgent'), NOTIFICATION_PRIORITY.URGENT, '小写也要认');
  assert.equal(normalizePriority(' NORMAL '), NOTIFICATION_PRIORITY.NORMAL, '带空格也要认');
  assert.equal(normalizePriority('SILENT'), NOTIFICATION_PRIORITY.SILENT);
  assert.equal(normalizePriority(3), NOTIFICATION_PRIORITY.URGENT, '数字档原样认');
  assert.equal(normalizePriority(99), NOTIFICATION_PRIORITY.URGENT, '越界按最近合法档夹紧');
  assert.equal(normalizePriority(-99), NOTIFICATION_PRIORITY.SILENT);
  assert.equal(normalizePriority('BOGUS'), NOTIFICATION_PRIORITY.NORMAL, '认不出必须回落 NORMAL');
  assert.equal(normalizePriority(undefined), NOTIFICATION_PRIORITY.NORMAL);
  assert.equal(priorityName(3), 'URGENT');
  assert.equal(priorityName('silent'), 'SILENT');
});

test('E2 ★ 免打扰对**字符串**优先级真生效（修前 \'NORMAL\' < 3 退化成 NaN ⇒ 一条都拦不住）', () => {
  const d = new SystemNotificationDispatcher({});
  d.setDnd(true);
  assert.equal(d.post({ title: 'n', priority: 'NORMAL' }), null, 'DND 开时字符串 NORMAL 必须被拦');
  assert.equal(d.post({ title: 's', priority: 'SILENT' }), null, 'DND 开时字符串 SILENT 必须被拦');
  const urg = d.post({ title: 'u', priority: 'URGENT' });
  assert.ok(urg, 'DND 开时字符串 URGENT 必须穿透');
  assert.equal(urg.priority, 3, '落盘的 priority 必须是数字档');
  assert.equal(urg.priorityName, 'URGENT', '可读名必须一起落盘（否则下一个人无从判断 3 原本是什么）');
  assert.equal(d.post({ title: 'x', priority: 'BOGUS' }), null, '拼错回落 NORMAL ⇒ 被拦');
  const d2 = new SystemNotificationDispatcher({});
  assert.ok(d2.post({ title: 'n', priority: 'NORMAL' }), 'DND 关时必须放行');
});

test('E3 中枢真调用点的写法必须被这套归一覆盖（回归钉：调用点传的是字符串）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'config/subsystem-orchestrator.js'), 'utf8');
  /* 调用点确实传字符串 —— 这正是修前那条缺陷存在的前提 */
  assert.match(src, /priority:\s*'URGENT'/, '中枢调用点仍传字符串 URGENT（若改成数字，本判据要跟着改）');
  const cal = fs.readFileSync(path.join(ROOT, 'config/calendar-autonomous-life.js'), 'utf8');
  assert.match(cal, /urgency:\s*evt\.category[^?]*\?\s*'URGENT'\s*:\s*'NORMAL'/, '日程链同样传字符串');
  /* 且这两处字符串都必须能被归一认出 */
  assert.equal(normalizePriority('URGENT'), 3);
  assert.equal(normalizePriority('NORMAL'), 2);
});

/* ══════════ F ── 接线自证 ══════════ */
test('F1 App 真 import 桥的合并函数，视图真走 App 的 feed()，视图不自己去碰第二张表', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'apps/notifications/notifications-app.js'), 'utf8');
  /* [v4.99.7 · R11-X7] 允许的名单从「只有 mergeFeed」扩到「同一桥上的纯函数」：
   *   `mapHubNotification` 是 `_byId`/`rowById` 反查 hubs 行要用的**同一个**纯映射，
   *   纪律没变 —— 映射仍然只有桥这一处，视图仍然一个都不许 import（下面那条照旧钉死）。 */
  assert.match(appSrc, /import\s*\{\s*mergeFeed\s*,\s*mapHubNotification\s*\}\s*from\s*'\.\.\/\.\.\/config\/notification-hub-bridge\.js'/,
    'App 必须真 import 桥（合并 + 单行映射两件）');
  assert.match(appSrc, /feed\(\)\s*\{/, 'App 必须暴露 feed()');
  assert.match(appSrc, /_resolveHub\(\)/, 'App 必须有中枢实例解析口');
  assert.match(appSrc, /getClusteredNotifications/, '解析口必须做能力探测（不是「有个对象就当真」）');

  const viewSrc = fs.readFileSync(path.join(ROOT, 'apps/notifications/notification-center-view.js'), 'utf8');
  assert.match(viewSrc, /this\.app\.feed\(\)/, '视图必须走 App 的 feed()');
  assert.ok(!/subsystems/.test(viewSrc), '视图不得自己去碰中枢（碰了就是第二份「怎么读」的口径）');
  assert.ok(!/notification-hub-bridge/.test(viewSrc), '视图不得自己 import 桥（映射只能有一处）');
  assert.match(viewSrc, /_hubNote\(/, '视图必须有中枢读数行');
  assert.match(viewSrc, /不是「没有通知」/, '读不到时必须明写它不等于「没有通知」');
});

test('F2 桥本身不写 storage（纯读 + 纯函数：碰 storage 就是在造第二份真源）', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'config/notification-hub-bridge.js'), 'utf8');
  /* ★ 先剥注释再判：本套件第一版直接对全文正则，命中了我自己写的注释
   *   「不碰任何 storage」——那正是「判据把说明文字当代码」的假红。
   *   判据要判的是**代码里有没有这个动作**，不是文档里有没有这个词。 */
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
    .replace(/^\s*\/\/.*$/gm, ' ');      // 行注释
  assert.ok(!/\bstorage\b/.test(code), '桥的**代码**里不得出现 storage（注释里说明不算）');
  assert.ok(!/\.set\(/.test(code), '桥不得写任何键');
  assert.ok(!/localStorage|indexedDB/.test(code));
  /* 自证这条判据不是「怎么查都有」：同一手法用在真会写盘的文件上必须命中 */
  const writer = fs.readFileSync(path.join(ROOT, 'config/system-notification-dispatcher.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(/\bstorage\b/.test(writer), '对照：派发器代码里确实有 storage（证明上面那条判据有分辨力）');
});

/* ══════════ G ── 负控制：破坏后同款判据必须转红 ══════════ */
/* ---------- 负控制的副本夹具 ----------
 * ★ 必须把**同目录相对依赖**一起抄过去。
 *   本套件第一版只抄单文件，三条 G 全部报 ERR_MODULE_NOT_FOUND ——
 *   那不是「破坏没生效」，而是**夹具的旧假设过期**（「被测件是自足单文件」）。
 *   同一形态在 tests/system-v3201.test.mjs 的 N5 上踩过一次，这里按同一修法：
 *   从源码里解析 `from './x'`，递归把同目录依赖逐个复制到副本目录。
 */
function copyWithRelDeps(rel, dstRoot) {
  const seen = new Set();
  const walk = (relPath) => {
    if (seen.has(relPath)) return;
    seen.add(relPath);
    const srcAbs = path.join(ROOT, relPath);
    const dstAbs = path.join(dstRoot, relPath);
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.copyFileSync(srcAbs, dstAbs);
    const text = fs.readFileSync(srcAbs, 'utf8');
    /* 只认同目录相对 import：`../` 跨目录的依赖在本夹具里不需要（被测件的依赖都是同级的）。 */
    const re = /from\s+'(\.[^']+)'/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('./')) continue;
      const depRel = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec));
      if (fs.existsSync(path.join(ROOT, depRel))) walk(depRel);
    }
  };
  walk(rel);
  return seen.size;
}
function cloneRepoFor(rel, tweak) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x6_'));
  const depCount = copyWithRelDeps(rel, dir);
  assert.ok(depCount >= 1, '夹具必须至少解析出一个依赖（解析为零说明这段变成了空动作）');
  const dst = path.join(dir, rel);
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const before = src;
  src = tweak(src);
  assert.notEqual(src, before, '负控制的破坏必须真的改到源码（否则这条负控制是自我实现）');
  fs.writeFileSync(dst, src, 'utf8');
  return { dir, file: dst, deps: depCount };
}

test('G1 负控制：把 timestamp→ts 的映射搬错 ⇒ A1 的同款判据在副本上转红', async () => {
  const { dir, file } = cloneRepoFor('config/notification-hub-bridge.js', (s) => {
    /* 把 ts 映射改成读错字段（经典写法错误：以为派发器用 ts） */
    return s.replace('ts: Number(raw.timestamp) || 0,', 'ts: Number(raw.ts) || 0,');
  });
  try {
    const mod = await import('file://' + file);
    const row = mod.mapHubNotification({ title: 't', body: 'b', timestamp: 1700000000000, priority: 3 });
    assert.equal(row.ts, 0, '破坏后 ts 必须变成 0（时间显示 1970）');
    assert.ok(row.ts !== 1700000000000, '破坏必须可观测地改行为');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G2 负控制：把「读不到」与「空表」压成同一态 ⇒ C1 的同款判据在副本上转红', async () => {
  const { dir, file } = cloneRepoFor('config/notification-hub-bridge.js', (s) => {
    /* 破坏形态：把 hubReadable 硬写成 true（读不到也当读到了）*/
    return s.replace('const hubReadable = opts.hubReadable !== false;', 'const hubReadable = true;');
  });
  try {
    const mod = await import('file://' + file);
    const out = mod.mergeFeed([], [], { logReadable: true, hubReadable: false, hubWhy: 'no_dispatcher' });
    assert.equal(out.notes.hubReadable, true, '破坏后「读不到」被冒充成「读到了」');
    assert.equal(out.notes.complete, true, '破坏后 complete 也变成 true（用户被告知「就这些」）');
    /* 原版上同判据仍然真（防「怎么查都红」） */
    const good = mergeFeed([], [], { logReadable: true, hubReadable: false, hubWhy: 'no_dispatcher' });
    assert.equal(good.notes.complete, false, '原版上同款判据必须仍为假');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G3 负控制：把优先级的字符串分支删掉 ⇒ E2 的同款判据在副本上转红', async () => {
  const { dir, file } = cloneRepoFor('config/system-notification-dispatcher.js', (s) => {
    /* 破坏形态：字符串一律回落 NORMAL（URGENT 字符串不再穿透免打扰） */
    return s.replace(
      /const key = String\(value \|\| ''\)\.trim\(\)\.toUpperCase\(\);\n\s*if \(key && Object\.prototype\.hasOwnProperty\.call\(NOTIFICATION_PRIORITY, key\)\) \{\n\s*return NOTIFICATION_PRIORITY\[key\];\n\s*\}/,
      '/* 破坏：字符串分支被摘掉 */'
    );
  });
  try {
    const mod = await import('file://' + file);
    assert.equal(mod.normalizePriority('URGENT'), NOTIFICATION_PRIORITY.NORMAL, '破坏后字符串 URGENT 被冒充成 NORMAL');
    const d = new mod.SystemNotificationDispatcher({});
    d.setDnd(true);
    assert.equal(d.post({ title: 'u', priority: 'URGENT' }), null, '破坏后 URGENT 不再穿透免打扰（正是修前那条缺陷）');
    /* 原版上同判据仍然真 */
    assert.equal(normalizePriority('URGENT'), NOTIFICATION_PRIORITY.URGENT);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});