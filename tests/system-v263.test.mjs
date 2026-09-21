/**
 * system-v263.test.mjs — v2.63.0 会话生命周期接线收口回归
 *
 * 背景：v2.62.0 之后做了一轮**系统性生命周期审计**（脚本枚举 apps/ 下全部
 *   生命周期出口方法 onChatChanged/clearCache/destroy/deactivate/reload，
 *   再在 index.js 反查调用路径），从「定义但零调用」候选里辨伪后收敛出三处真缺陷：
 *
 *   ① memoryApp.onChatChanged：实现了却从未接入 REBIND 表（漏接线）；
 *   ② timeweaverApp.aiLetter：实例级 AI 信缓存跨会话不失效，视图直读；
 *   ③ _calendarReminderApp：独立提醒实例的回收散落三处且没有一处完整。
 *
 *   三者同属本仓最贵的缺陷形态——**不报错、不崩溃、只错数据**（前两处）与
 *   **静默资源泄漏**（第三处，旧实例 SWIPE_BACK 监听器无人解绑）。
 *
 * 本测试分两层：
 *   A. 行为层：timeweaver 实例域 onChatChanged() 真的丢弃跨会话缓存（含视图端到端）；
 *   B. 接线层：index.js 的日历提醒回收是**单一真源**，三处路径与两处覆盖点都接上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const idx = read('index.js');

// ══════════════ A. 行为层：timeweaver 实例域缓存 ══════════════
test('v263-A1 timeweaverApp.onChatChanged 丢弃 AI 信缓存 / 草稿 / 自动织信标志', async () => {
  const { TimeweaverApp } = await import('../apps/timeweaver/timeweaver-app.js');
  const store = {};
  const storage = { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; return Promise.resolve(); } };
  const app = new TimeweaverApp({ setContent() {}, element: null }, storage);
  // 构造期初值
  assert.equal(app.aiLetter, null, '构造期 aiLetter 应为 null');
  assert.equal(app.composeDraft, '', '构造期 composeDraft 应为空串');
  // 模拟「上一段剧情」留下的实例态
  app.aiLetter = { loading: false, error: null, paragraphs: ['上一段剧情的信'], ts: 1 };
  app.composeDraft = '上一段剧情写的草稿';
  app._autoChecked = true;
  app.onChatChanged();
  assert.equal(app.aiLetter, null, '换会话后 aiLetter 必须丢弃（否则首屏渲染上一段剧情的信）');
  assert.equal(app.composeDraft, '', '换会话后草稿必须清空');
  assert.equal(app._autoChecked, false, '换会话后自动织信标志必须复位（否则新会话永不评估织信）');
});

test('v263-A2 端到端：换绑后视图不再吐出上一段剧情的 AI 信', async () => {
  const { TimeweaverApp } = await import('../apps/timeweaver/timeweaver-app.js');
  const store = { diary_entries: JSON.stringify([{ content: '今天很开心 温暖', createdAt: 1000 }]) };
  const storage = { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; return Promise.resolve(); } };
  const app = new TimeweaverApp({ setContent() {}, element: null }, storage);
  app.aiLetter = { loading: false, error: null, paragraphs: ['旧会话的段落'], ts: 7 };
  const before = app.view._currentLetter();
  assert.equal(before?.source, 'ai', '换绑前：视图直读实例缓存，交出 AI 版');
  assert.deepEqual(before.paragraphs, ['旧会话的段落']);
  app.onChatChanged();
  const after = app.view._currentLetter();
  assert.notEqual(after?.source, 'ai', '换绑后：绝不能再交出 AI 版（串味已清除）');
  // 本地规则版（若碎片够）或 null（碎片不足），两种都算合规，唯独不许是旧 AI 信
  assert.ok(after === null || after.source === 'local', '换绑后只允许本地规则版或空');
  if (after) assert.notDeepEqual(after.paragraphs, ['旧会话的段落'], '换绑后不得残留旧段落');
});

// ══════════════ B. 接线层：日历提醒实例回收单一真源 ══════════════
const fnBody = (idx.match(/function disposeCalendarReminderApp\(options = \{\}\) \{([\s\S]*?)\n    \}/) || [])[1] || '';
const p1At = idx.indexOf('disposeCalendarReminderApp({ preserveActiveInstance: true });');

test('v263-B1 回收函数存在且三件事齐备（解绑监听器 / 置 null / 复位游标）', () => {
  assert.ok(fnBody.length > 0, 'disposeCalendarReminderApp 未定义');
  assert.match(fnBody, /destroy\?\.\(\)/, '未解绑构造期监听器（SWIPE_BACK 泄漏）');
  assert.match(fnBody, /_calendarReminderApp = null/, '未释放槽位引用');
  assert.match(fnBody, /_lastCalendarReminderCheckTime = null/, '未复位提醒检查游标');
  assert.match(fnBody, /try\s*\{[\s\S]*catch/, '缺少容错（本仓「不抛」纪律）');
});

test('v263-B2 三条会话路径全部接线，且 P1 区分保留活动实例', () => {
  assert.ok(p1At > 0, 'P1 换会话未接线');
  assert.match(idx.slice(p1At, p1At + 120), /preserveActiveInstance:\s*true/, 'P1 应保留活动 calendarApp（只清缓存，不 destroy）');
  // P2 / P3：清数据路径会把活动实例也 destroy，故用无参调用（连提醒实例一起回收）
  const bare = [...idx.matchAll(/\n\s*disposeCalendarReminderApp\(\);/g)];
  assert.equal(bare.length, 2, `无参调用应恰为 2 处（P2/P3），实际 ${bare.length}`);
});

test('v263-B3 两处「实例覆盖」点先回收再写槽（防监听器永久泄漏）', () => {
  // ① 自动补全日程：槽位被顶替前守护销毁
  const holder = idx.indexOf('const _reminderSlotHolder = window.VirtualPhone._calendarReminderApp;');
  assert.ok(holder > 0, '槽位顶替前回收缺失');
  assert.match(idx.slice(holder, holder + 300), /_reminderSlotHolder !== window\.VirtualPhone\.calendarApp/, '须守卫：不得销毁活动实例本身');
  // ② 打开日历 App：覆盖单例前解绑旧监听器
  const openCal = idx.indexOf('if (!window.VirtualPhone.calendarApp || !window.VirtualPhone.calendarApp.phoneShell?.setContent) {');
  assert.ok(openCal > 0, '开日历分支未找到');
  assert.match(idx.slice(openCal, openCal + 400), /window\.VirtualPhone\.calendarApp\?\.destroy\?\.\(\)/, '覆盖既有实例前未 destroy');
});

test('v263-B4 防漂移：提醒检查游标只在回收函数内复位（单一真源）', () => {
  const declAt = idx.indexOf('let _lastCalendarReminderCheckTime = null;');
  assert.ok(declAt > 0, '声明行未找到');
  // 声明行自身即含 `_lastCalendarReminderCheckTime = null;` 子串，须按位置排除，
  //   否则会把声明行当成「另一处复位」（本测试首版即踩此坑，实测修正）。
  const hits = [...idx.matchAll(/_lastCalendarReminderCheckTime = null;/g)]
    .map((m) => m.index)
    .filter((h) => Math.abs(h - declAt) > 20);
  assert.equal(hits.length, 1, `除声明行外应恰 1 处复位，实际 ${hits.length}：${hits.join(',')}`);
  const fnStart = idx.indexOf('function disposeCalendarReminderApp(options = {}) {');
  assert.ok(fnStart > 0, '回收函数未找到');
  assert.ok(
    hits[0] > fnStart && hits[0] < fnStart + fnBody.length + 120,
    '唯一一处复位必须落在回收函数体内（不得散落在各路径）'
  );
});

test('v263-B5 防回归：三条路径不再残留「只清缓存不解绑」的旧写法', () => {
  const legacy = idx.match(/window\.VirtualPhone\._calendarReminderApp\.clearCache\(\);/g) || [];
  assert.equal(legacy.length, 0, '旧写法（只 clearCache、不解绑监听器）不应再出现');
});

test('v263-B6 REBIND 表已收编本轮两个漏接线 App', () => {
  const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
  for (const k of ['memoryApp', 'timeweaverApp']) {
    assert.ok(new RegExp(`'${k}'`).test(tbl), `REBIND 表缺 ${k}`);
  }
});

console.log('\nv263 done');
