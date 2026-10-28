/* ============================================================
 * tests/system-v4910.test.mjs — v4.91.0 第十一批：把上版登记的三条欠债做完
 * ------------------------------------------------------------
 * 上版（v4.90.0）在公告末条如实写了三条「没做什么」：
 *   ① 来源许可的 inspect 交互面只在纯函数层自证，没接 UI 弹层；
 *   ② `ageDisplay` 全档未移植；
 *   ③ 条目设置还没有设置面板，只能走 `writeMemoryEntries` 的 options 传。
 * 本版逐条做成**产品路径上的真实实现**，本档只钉「真接通了没有」。
 *
 * 判据分四面：
 *   A 面 版本锚（五源同源）+ 三件自检仍自绿 + 三条欠债的消费点都在产品端
 *   B 面 排除面：快照两态互不同形 / 弹层结构 / 逐行翻转 / 四种 stale 各有各的文案
 *   C 面 条目设置：键族分桶 / 补丁合并与归一 / 条件行 / 保存与取消 / 写入路径两级
 *   D 面 年龄推算的产品消费点：字段推算带归因小字 / 注入块打「约」/ 读数三态
 *   F 面 负控制（真源码破坏两向）
 *
 * 【为什么弹层判据要另造 DOM 替身（tests/_dom_stub.mjs）】
 *   本仓零依赖，`_runtime_host.mjs` 的 querySelector 一律 null —— 弹层连自己的
 *   body 节点都拿不到，画不下去。替身只做「够判」：节点记账 + 选择器返回稳定节点，
 *   于是「计数行文案 / 两节 / 每行翻转 / 条件行显隐」都能断言。
 *   它不解析 HTML、不跑 CSS、不做命中测试 —— 观感仍归真宿主（见边界文档）。
 *
 * 【负控制形式纪律（本仓三形假绿，逐条避开）】
 *   ① 对原文件断言 ② 破坏写死成模拟常量 ③ 破坏把判据自己删了。
 *   统一修法：真源码破坏（锚点恰中 1 次）→ 装破坏副本 → 在副本上重跑同款判据，
 *   并对原版跑同一判据证明判据真、对破坏副本证明它假。两向都要。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub } from './_dom_stub.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.91.0';
import * as SP from '../config/source-permission.js';
import * as TR from '../config/story-time-rel.js';
import * as ES from '../config/worldbook-entry-settings.js';
import * as PD from '../apps/profile/profile-data.js';
import { WorldbookManager } from '../config/worldbook-manager.js';

/* ══════════════════ A 版本锚与欠债收口 ══════════════════ */
test('A1: 五源版本同源且不低于 4.91.0', () => {
  /* [v4.92.0 交棒改写] 本版出生时五源都是 4.91.0，原判据写的是等值锚 —— 抬版即红（那是抬版仪式，
   *   不是缺陷）。按仓内既定口径换成**下限形**：五源必须彼此一致、且都不低于诞生版（不回退即可），
   *   「当版是否等于某值」由当版套件（tests/system-v4920.test.mjs 的 A1）接管。 */
  const sem = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
  const pkg = JSON.parse(read('package.json')).version;
  const man = JSON.parse(read('manifest.json')).version;
  const log = JSON.parse(read('update-log.json'));
  const idx = read('index.js');
  const led = JSON.parse(read('tests/audit/status-ledger.json'));
  const five = [pkg, man, log.latest, log.head, led.version];
  assert.equal(new Set(five).size, 1, '五源必须彼此一致：' + five.join('/'));
  for (const v of five) assert.ok(sem(v) >= sem(BORN_V), '不得低于诞生版 ' + BORN_V + '，实得 ' + v);
  assert.match(idx, new RegExp("const ST_PHONE_VERSION = '" + pkg.replace(/\./g, '\\.') + "';"), '入口常量必须与五源一致');
  assert.equal(led.version_same, true, '账本自评必须为同源');
  for (const [k, v] of Object.entries(led.version_sources)) {
    assert.equal(v, pkg, '账本来源 ' + k + ' 必须与五源同源');
  }
  /* 公告块装的是**当版**条目，抬版后本版条目自然不在里面了 —— 故这里不逐条比对，
   *   只锁两件不回退的事实：本版台账条目仍在、本版迭代段不可抹；公告块只查当版形态。
   *   「当版条目与公告块逐条一致」由当版套件 A1 接管。 */
  const items = (log.versions[BORN_V] || {}).items || [];
  assert.ok(items.length >= 8, '本版台账条目不得缩水，实得 ' + items.length);
  assert.ok(read('ITERATION_LOG.md').includes('## 迭代 217 · v4.91.0'), '本版迭代段不可抹');
  assert.ok(idx.includes('版本升至 ' + pkg), '公告块必须带当版收尾条');
  const annBody = idx.slice(idx.indexOf('items: [')).split('\n    ]')[0];
  assert.ok(annBody.split('\n        "').length - 1 >= 8, '当版公告块至少 8 条');
});

test('A2: 三件内核自检仍自绿（本版只加消费点，不得改坏内核）', () => {
  for (const [m, name] of [[SP, 'sourcePermissionSelfCheck'], [TR, 'storyTimeRelSelfCheck'], [ES, 'worldbookEntrySettingsSelfCheck']]) {
    const r = m[name]();
    assert.equal(r.ok, true, name + ' 必须自绿：' + JSON.stringify(r.problems));
    assert.deepEqual(r.problems, [], name + ' 不得有问题项');
  }
});

test('A3: 三条欠债各自的消费点都在产品端（不是只被测试引用）', () => {
  const wm = read('config/worldbook-manager.js');
  /* ① inspect 面：三个纯函数必须被产品端 import 并真调 */
  for (const fn of ['filterBookNamesByPermission', 'dedupeBookNames', 'inspectVerdict']) {
    assert.ok(new RegExp('\\b' + fn + '\\b').test(wm), fn + ' 必须被产品端引用');
  }
  assert.match(wm, /async inspectExcludedBooks\(/, '必须有快照取数口');
  assert.match(wm, /async openPermissionInspectDialog\(/, '必须有弹层');
  assert.ok(wm.includes('phone-worldbook-perm-trigger'), '工具条必须有入口按钮');
  /* ② ageDisplay 全档：三个助手必须被产品端引用 */
  const pd = read('apps/profile/profile-data.js');
  for (const fn of ['ageDisplay', 'ageDisplayOf', 'ageDisplayLine', 'weekdayLabel', 'relativeTimeLabel']) {
    assert.ok(new RegExp('\\b' + fn + '\\b').test(pd), fn + ' 必须被档案产品端引用');
  }
  /* ③ 条目设置面板：读写口 + 面板 + 入口按钮 + 写入路径消费 */
  assert.match(wm, /getEntrySettingsKey\(/, '必须有键族');
  assert.match(wm, /async setEntrySettings\(/, '必须有写口');
  assert.match(wm, /async openEntrySettingsDialog\(/, '必须有设置面板');
  assert.ok(wm.includes('phone-worldbook-set-trigger'), '工具条必须有设置入口');
  assert.match(wm, /options\.entrySettings !== undefined \? options\.entrySettings : this\.getEntrySettings/,
    '写入路径必须两级（显式优先，否则用存起来的）');
  /* 新类必须有样式（修前这批类在 phone.css 一个都没有） */
  const css = read('phone.css');
  for (const cls of ['phone-worldbook-exclude-toggle', 'phone-worldbook-perm-modal', 'phone-worldbook-set-row', 'phone-worldbook-toolbar']) {
    assert.ok(css.includes('.' + cls), cls + ' 必须有样式');
  }
  /* 行内列数必须容得下四个子元素（勾选 / 文案 / 眼睛 / 条目） */
  assert.ok(css.includes('grid-template-columns: max-content minmax(0, 1fr) 32px 32px;'), '行必须是四列');
});

/* ══════════════════ B 排除面 ══════════════════ */
/** 造一个只够判的 manager：真 storage 替身、真身份、假书单。 */
function probeManager(over = {}) {
  const m = new WorldbookManager(null);
  const store = new Map();
  m.storage = { get: (k, d) => (store.has(k) ? store.get(k) : d), set: async (k, v) => { store.set(k, v); } };
  m._getCharacterScopeKey = () => 't';
  m._getContext = () => ({ chatMetadata: { file_name: 'chat-1' }, name2: '甲' });
  m.listAvailableWorldbooks = async () => [{ name: 'Ａ书' }, { name: 'a书' }, { name: 'B书' }, { name: 'C书' }];
  Object.assign(m, over);
  return m;
}

test('B1: 快照 ready 时两份名单互不相补、去重按规范化键', async () => {
  const m = probeManager();
  await m.setBookExcluded('t', 'A书', true);
  const snap = await m.inspectExcludedBooks('t');
  assert.equal(snap.status, 'ready', '身份没变必须 ready');
  assert.deepEqual(snap.kept, ['B书', 'C书'], '未排除的必须留在 kept');
  assert.equal(snap.excluded.length, 1, 'Ａ书 与 a书 规范化同键，只该留一条');
  assert.equal(snap.total, 3, '书单先去重再算总数（4 条原文 3 本）');
  assert.equal(snap.excluded.length + snap.kept.length, snap.total, '两份名单必须互不相补且合起来等于总数');
});

test('B2: 快照 stale 两态可分（换会话 / 换角色），两份名单都给空数组', async () => {
  let ctx = { chatMetadata: { file_name: 'chat-1' }, name2: '甲' };
  const m = probeManager({ _getContext: () => ctx });
  m.listAvailableWorldbooks = async () => { ctx = { chatMetadata: { file_name: 'chat-2' }, name2: '甲' }; return [{ name: 'X书' }]; };
  const a = await m.inspectExcludedBooks('t');
  assert.equal(a.status, 'stale', '读取途中换会话必须 stale');
  assert.equal(a.reason, 'chat-changed');
  assert.deepEqual([a.excluded, a.kept, a.total], [[], [], 0], 'stale 时不许给出半份名单（空数组 + 状态位）');

  ctx = { chatMetadata: { file_name: 'chat-1' }, name2: '甲' };
  const m2 = probeManager({ _getContext: () => ctx });
  m2.listAvailableWorldbooks = async () => { ctx = { chatMetadata: { file_name: 'chat-1' }, name2: '乙' }; return [{ name: 'X书' }]; };
  const b = await m2.inspectExcludedBooks('t');
  assert.equal(b.reason, 'host-chat-changed', '换了角色也是 stale，且因不同形');

  const m3 = probeManager({ _getContext: () => ({ chatMetadata: {}, name2: '甲' }) });
  assert.equal((await m3.inspectExcludedBooks('t')).reason, 'no-chat-id', '没有会话标识是第三因');

  const m4 = probeManager({ listAvailableWorldbooks: async () => { throw new Error('boom'); } });
  const d = await m4.inspectExcludedBooks('t');
  assert.equal(d.reason, 'list-failed', '书单读失败必须与「一本都没有」分开');
});

test('B3: 弹层结构（计数行 / 两节 / 逐行翻转 / 四种 stale 文案 / 关闭）', async () => {
  const m = probeManager();
  await m.setBookExcluded('t', 'B书', true);
  const h = installDomStub();
  try {
    const done = m.openPermissionInspectDialog('t');
    await new Promise((r) => setTimeout(r, 30));
    const modal = h.find('phone-worldbook-perm-modal');
    assert.ok(modal, '必须建出弹层');
    const count = modal.querySelector('.phone-worldbook-perm-count');
    assert.match(count.textContent, /^已排除 1 \/ 共 3 本$/, '计数行必须可数：' + count.textContent);
    const body = modal.querySelector('.phone-worldbook-perm-body');
    const titles = body.children.map((c) => c.children[0]?.textContent || '');
    assert.deepEqual(titles, ['已排除 · 不注入（1）', '仍在用（2）'], '两节标题必须带上计数：' + titles.join('/'));
    /* 逐行翻转：点「恢复」后该行状态必须真翻转（改的是排除表，不是只改界面） */
    const row = body.children[0].children[1];
    assert.match(row.className, /is-excluded/, '已排除行必须带 is-excluded');
    assert.equal(row.children[1].textContent, '恢复', '已排除行给「恢复」');
    await row.children[1].fire('click');
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(m.getExcludedBooks('t'), [], '点恢复后排除表必须真清掉');
    assert.match(modal.querySelector('.phone-worldbook-perm-count').textContent, /^已排除 0/, '重画后计数必须回到 0');
    /* 关闭 */
    modal.querySelector('[data-action="close"]').fire('click');
    assert.equal(await done, true);
    assert.equal(modal._removed, true, '关闭必须移除弹层');
  } finally { h.restore(); }
});

test('B4: stale 四种因各有各的文案（不压成一句「无法读取」）', async () => {
  const seen = new Set();
  for (const [reason, patch] of [
    ['chat-changed', { _getContext: () => ({ chatMetadata: { file_name: 'z' }, name2: '甲' }) }],
    ['host-chat-changed', { _getContext: () => ({ chatMetadata: { file_name: 'chat-1' }, name2: 'z' }) }],
    ['no-chat-id', { _getContext: () => ({ chatMetadata: {}, name2: '甲' }) }],
    ['list-failed', { listAvailableWorldbooks: async () => { throw new Error('x'); } }]
  ]) {
    const m = probeManager(patch);
    const h = installDomStub();
    try {
      m.inspectExcludedBooks = async () => ({ status: 'stale', reason: reason, excluded: [], kept: [], total: 0 });
      const done = m.openPermissionInspectDialog('t');
      await new Promise((r) => setTimeout(r, 20));
      const modal = h.find('phone-worldbook-perm-modal');
      const hint = modal.querySelector('.phone-worldbook-perm-body').children[0];
      assert.match(hint.className, /is-error/, reason + ' 必须走错误态');
      assert.ok(hint.textContent.length > 8, reason + ' 必须有具体因文案');
      seen.add(hint.textContent);
      modal.querySelector('[data-action="close"]').fire('click');
      await done;
    } finally { h.restore(); }
  }
  assert.equal(seen.size, 4, '四种因必须四句不同的话，实得 ' + seen.size);
});

/* ══════════════════ C 条目设置 ══════════════════ */
test('C1: 键族按 App × 按角色分桶、与排除表分键', () => {
  const m = probeManager();
  assert.equal(m.getEntrySettingsKey('honey'), 'phone_worldbook_entrysettings_honey_char_t');
  assert.notEqual(m.getEntrySettingsKey('honey'), m.getExcludedBooksKey('honey'), '设置与排除表必须分键');
  assert.equal(m.getEntrySettingsKey(), 'phone_worldbook_entrysettings_common_char_t', '缺省落 common 桶');
});

test('C2: 读写走补丁合并 + 归一，坏值不写坏条目', async () => {
  const m = probeManager();
  assert.equal(m.getEntrySettings('t').position, 0, '空存储必须是缺省表（position 缺省为 0）');
  await m.setEntrySettings('t', { position: 7, orderMode: 'reverse', reverseStart: 5000 });
  const one = m.getEntrySettings('t');
  assert.equal(one.position, 7);
  assert.equal(one.orderMode, 'reverse');
  assert.equal(one.reverseStart, 5000);
  assert.equal(one.titleFormat, '[000] - {{title}}', '没传的格子必须保持缺省（补丁合并不是整份覆盖）');
  /* 越界值必须被纯件夹紧，而不是原样落库 */
  await m.setEntrySettings('t', { position: 4, orderValue: 99999 });
  assert.equal(m.getEntrySettings('t').position, 0, '非法位置必须回落');
  assert.ok(m.getEntrySettings('t').orderValue <= 9999, '越界手填值必须夹紧');
});

test('C3: 面板条件行（位置 7 才出出口名，manual / reverse 才出各自数值格）', async () => {
  const m = probeManager();
  const h = installDomStub();
  try {
    const done = m.openEntrySettingsDialog('t');
    await new Promise((r) => setTimeout(r, 20));
    const modal = h.find('phone-worldbook-set-modal');
    assert.ok(modal, '必须建出面板');
    const pos = modal.querySelector('[data-field="position"]');
    const outlet = modal.querySelector('[data-outlet]');
    const order = modal.querySelector('[data-field="orderMode"]');
    const manual = modal.querySelector('[data-manual]');
    const reverse = modal.querySelector('[data-reverse]');
    assert.equal(outlet.hidden, true, '位置非 7 时出口名格必须藏起来');
    pos.value = '7';
    pos.fire('change');
    assert.equal(outlet.hidden, false, '位置 7 必须出出口名格');
    pos.value = '1';
    pos.fire('change');
    assert.equal(outlet.hidden, true, '离开 7 必须再藏起来');
    assert.equal(manual.hidden, true);
    order.value = 'manual';
    order.fire('change');
    assert.equal(manual.hidden, false);
    assert.equal(reverse.hidden, true, 'manual 时倒序起点必须藏着（两档互斥）');
    order.value = 'reverse';
    order.fire('change');
    assert.equal(manual.hidden, true);
    assert.equal(reverse.hidden, false);
    modal.querySelector('[data-action="close"]').fire('click');
    assert.equal(await done, false, '关闭按钮走的不是保存');
    assert.equal(h.hasCall('doc:off:keydown'), true, '关掉必须摘掉 Esc 监听');
  } finally { h.restore(); }
});

test('C4: 保存落库、取消不落库，Esc 走取消', async () => {
  const m = probeManager();
  const h = installDomStub();
  try {
    const done = m.openEntrySettingsDialog('t');
    await new Promise((r) => setTimeout(r, 20));
    const modal = h.find('phone-worldbook-set-modal');
    modal.querySelector('[data-field="titleFormat"]').value = '无占位标题';
    modal.querySelector('[data-field="position"]').value = '3';
    modal.querySelector('[data-action="save"]').fire('click');
    assert.equal(await done, true, '保存必须 resolve true');
    assert.equal(m.getEntrySettings('t').titleFormat, '无占位标题');
    assert.equal(m.getEntrySettings('t').position, 3);

    const done2 = m.openEntrySettingsDialog('t');
    await new Promise((r) => setTimeout(r, 20));
    const m2 = h.find('phone-worldbook-set-modal');
    m2.querySelector('[data-field="position"]').value = '6';
    m2.querySelector('[data-action="close"]').fire('click');
    assert.equal(await done2, false);
    assert.equal(m.getEntrySettings('t').position, 3, '取消后落库值不得被改');
  } finally { h.restore(); }
});

test('C5: 写入路径两级 —— 显式 options 优先，否则用存起来的那份', async () => {
  const m = probeManager();
  let saved = null;
  m._loadWorldInfoViaFrontendModule = async () => ({ entries: saved ? saved.entries : {} });
  m._saveWorldInfo = async (_n, d) => { saved = JSON.parse(JSON.stringify(d)); return true; };
  m._refreshWorldInfoCache = async () => true;
  await m.setEntrySettings('t', { position: 7 });
  await m.writeMemoryEntries('书', [{ comment: '甲', content: '一' }], { appKey: 't' });
  assert.equal(Object.values(saved.entries)[0].position, 7, '没显式传时必须用存起来的那份');
  await m.writeMemoryEntries('书', [{ comment: '乙', content: '二' }], { appKey: 't', entrySettings: { position: 5 } });
  assert.equal(Object.values(saved.entries)[1].position, 5, '显式传的必须压过存起来的那份');
  assert.equal(m.getEntrySettings('t').position, 7, '一次性覆盖不得改掉落库值');
});

/* ══════════════════ D 年龄推算的产品消费点 ══════════════════ */
test('D1: 字段投影推算年龄并带上归因小字，锚点不单独占一行', () => {
  const p = { gender: '女', age: '24岁', ageTime: '1994/3/1' };
  const out = PD.protagonistFields(p, { now: '2024/3/1' });
  const age = out.find((f) => f.key === 'age');
  assert.equal(age.value, '约54岁(1994年时24岁)');
  assert.equal(age.ageState, 'estimated');
  assert.match(age.note, /推算/, '推算来的值必须自带说明');
  assert.equal(out.some((f) => f.key === 'ageTime'), false, 'ageTime 是锚点不是独立事实，不单独成行');
  const within = PD.protagonistFields({ gender: '女', age: '24岁', ageTime: '2024/3/1' }, { now: '2024/9/1' });
  assert.equal(within.find((f) => f.key === 'age').value, '24岁', '不足一年必须原样、不得加「约」');
  assert.equal(within.find((f) => f.key === 'age').ageState, 'raw-within-year');
  const noAnchor = PD.protagonistFields({ age: '24岁' }, { now: '2024/9/1' });
  assert.equal(noAnchor.find((f) => f.key === 'age').ageState, 'raw-no-anchor');
});

test('D2: 注入块里的年龄同样是推算值（模型照抄确数会在跳时间后矛盾）', () => {
  const blk = PD.profilePromptBlock(
    { protagonist: { age: '24岁', ageTime: '1994/3/1' }, lifeDetails: [] },
    { maxLines: 3, now: '2024/3/1' });
  assert.ok(blk.includes('约54岁'), '注入块必须给推算值：' + blk);
  const plain = PD.profilePromptBlock(
    { protagonist: { age: '24岁', ageTime: '1994/3/1' }, lifeDetails: [] }, { maxLines: 3 });
  assert.ok(plain.includes('24岁'), '缺 now 时退化成原样（不猜）');
});

test('D3: 年龄读数行三态分列，锚点带周几与相对距离', () => {
  const line = PD.protagonistAgeLine({ age: '24岁', ageTime: '1994/3/1' }, '2024/3/1');
  assert.match(line, /约54岁/);
  assert.match(line, /记录于 .*1994\/3\/1/, '锚点必须摆出来：' + line);
  assert.match(line, /周二/, '公历带年必须给周几');
  assert.match(line, /年前/, '必须给相对距离');
  assert.equal(PD.protagonistAgeLine({}, '2024/3/1'), '', '没年龄就没有这一行');
  assert.match(PD.profileAgeLine({ age: '24岁', ageTime: '1994/3/1' }, '2024/3/1'), /推算 1 · 原样 0 · 算不出 0/);
  assert.match(PD.profileAgeLine({ age: '二十出头', ageTime: '1994/3/1' }, '2024/3/1'), /算不出 1/);
  assert.match(PD.profileAgeLine({}, ''), /没跑过/);
});

/* ══════════════════ F 负控制 ══════════════════ */
/** 真源码破坏：锚点必须恰中 1 次、必改字节（H6 工具两向自证）。 */
function breakSrc(src, anchor, repl) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（要求恰 1 次）：' + anchor.slice(0, 40));
  const out = src.split(anchor).join(repl);
  if (out === src) throw new Error('破坏未改字节');
  return out;
}
let seq = 0;
const loadBroken = async (src) => import(
  'data:text/javascript;charset=utf-8;base64,' + Buffer.from(src, 'utf8').toString('base64') + '#nc' + (++seq));
/** 两向：同一判据在原版上必须真、在破坏副本上必须假。
 *   零 import 的模块走 data: URL；带相对 import 的必须落临时文件。 */
async function negative(file, anchor, repl, judge, label) {
  const src = read(file);
  const brokenSrc = breakSrc(src, anchor, repl);
  const isLeaf = !/^import\s/m.test(src);
  let broken = null;
  let tmp = null;
  if (isLeaf) broken = await loadBroken(brokenSrc);
  else {
    tmp = rel('config/__nc491_' + file.replace(/[\\/]/g, '_'));
    fs.writeFileSync(tmp, brokenSrc, 'utf8');
    broken = await import('file://' + tmp + '?' + (++seq));
  }
  try {
    assert.equal(await judge(await import('file://' + rel(file))), true, label + ' 原版判据不为真（判据写歪了）');
    assert.equal(await judge(broken), false, label + ' 破坏副本仍为真（负控制失效＝判据自我指涉）');
  } finally {
    if (tmp) fs.unlinkSync(tmp);
  }
}

test('F1: inspect 的 stale 判定被拆 ⇒ 换了会话也照样 ready', async () => {
  await negative('config/source-permission.js',
    '    if (aChat !== bChat) return { status: \'stale\', reason: \'chat-changed\' };',
    '',
    (m) => m.inspectVerdict({ chatId: 'x', hostChatId: 'h' }, { chatId: 'y', hostChatId: 'h' }).status === 'stale',
    'F1');
});

test('F2: 写入路径只剩存起来的那份 ⇒ 显式 options 被吞掉', async () => {
  await negative('config/worldbook-manager.js',
    '            options.entrySettings !== undefined ? options.entrySettings : this.getEntrySettings(safeString(options.appKey) || \'common\')',
    '            this.getEntrySettings(safeString(options.appKey) || \'common\')',
    async (Mod) => {
      const m = new probeManager();
      Object.setPrototypeOf(m, Mod.WorldbookManager.prototype);
      let saved = null;
      m._loadWorldInfoViaFrontendModule = async () => ({ entries: {} });
      m._saveWorldInfo = async (_n, d) => { saved = d; return true; };
      m._refreshWorldInfoCache = async () => true;
      await m.setEntrySettings('t', { position: 7 });
      await m.writeMemoryEntries('书', [{ comment: '甲', content: '一' }], { appKey: 't', entrySettings: { position: 5 } });
      return Object.values(saved.entries)[0].position === 5;
    },
    'F2');
});

test('F3: 一年闸被拆 ⇒ 不足一年也打「约」', async () => {
  await negative('config/story-time-rel.js',
    '    if (days !== null && days >= 0 && days < 365) return { ok: true, state: \'raw-within-year\', text: raw };',
    '',
    (m) => m.ageDisplayOf('24岁', '2024/3/1', '2024/9/1').text === '24岁',
    'F3');
});

test('F4: 门禁现场自证 —— 零消费导出与键归属都不得因本版新增而红', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (script) => {
    try {
      execFileSync(process.execPath, [rel('scripts/' + script)], { stdio: 'pipe' });
      return 0;
    } catch (e) { return e.status || 1; }
  };
  assert.equal(run('dead-export-check.mjs'), 0, 'dead-export 必须零新增零消费导出');
  assert.equal(run('keys-audit.mjs'), 0, 'keys-audit 必须全登记且声明与机制一致');
});