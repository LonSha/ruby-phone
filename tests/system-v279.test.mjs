// tests/system-v279.test.mjs
// [v2.79.0] 备忘改到另一天必须真的改（此前静默漏改还报成功）。
//   `updateMemo` 认识 title / time / type / remindedKeys / globalReminder，
//   唯独不认识 dateKey——传「改到另一天」既不改也不报错，还返回 true。
//   而约定投影（syncCommitmentProjection）本来就用 Object.assign 按天移动备忘，
//   说明数据模型允许改日期，只有直改路径忘了这个字段。
//   本版同时把 v2.77 的修复固化为常驻契约：按 sourceId 去重的派生库
//   必须同时提供「新增 / 改写 / 回收」三条出口，否则同类缺陷会原样重演。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CalendarData } from '../apps/calendar/calendar-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function memoryStorage() {
  const data = new Map();
  return {
    get: (key, fallback) => (data.has(key) ? data.get(key) : fallback),
    set: (key, value) => data.set(key, value)
  };
}
function stored(calendar) {
  const raw = calendar.storage.get('life_events_v1');
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(list) ? list : [];
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', 'tests', 'scripts'].includes(name) || name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (name.endsWith('.js')) out.push(abs);
  }
  return out;
}

test('v279 1. 改到另一天真的改（而不是返回 true 却不动）', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', type: 'work' });
  const ok = c.updateMemo(memo.id, { dateKey: '2026-09-28' });
  assert.equal(ok, true);
  const now = c.getMemos().find((m) => m.id === memo.id);
  assert.equal(now.dateKey, '2026-09-28', 'dateKey 必须生效');
});

test('v279 2. 改日期后它的事件跟着改（与 v2.77 的对齐链连通）', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', time: '10:00', type: 'work' });
  assert.equal(stored(c)[0].summary, '项目评审（2026-09-25 10:00）');
  c.updateMemo(memo.id, { dateKey: '2026-09-28' });
  assert.equal(stored(c).length, 1, '不得因此多出一条');
  assert.equal(stored(c)[0].summary, '项目评审（2026-09-28 10:00）');
});

test('v279 3. 空日期拒改且如实报 false（不静默损坏）', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', type: 'work' });
  assert.equal(c.updateMemo(memo.id, { dateKey: '   ' }), false, '空白日期必须被拒');
  const now = c.getMemos().find((m) => m.id === memo.id);
  assert.equal(now.dateKey, '2026-09-25', '被拒时原日期不得被改掉');
  assert.equal(stored(c)[0].summary.includes('2026-09-25'), true);
});

test('v279 4. 未知字段仍被忽略、更新项找不到时报 false（不抛）', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', type: 'work' });
  assert.equal(c.updateMemo(memo.id, { 不存在的字段: 1 }), true, '无匹配字段时不得误报改动');
  assert.equal(c.updateMemo('nonexistent-id', { title: 'x' }), false);
  assert.equal(c.getMemos().find((m) => m.id === memo.id).title, '项目评审');
});

test('v279 5. 多字段一次改：日期 + 标题 + 时间同步生效，只留一条事件', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', time: '10:00', type: 'work' });
  c.updateMemo(memo.id, { dateKey: '2026-10-02', title: '项目终审', time: '14:30' });
  const now = c.getMemos().find((m) => m.id === memo.id);
  assert.equal(now.dateKey, '2026-10-02');
  assert.equal(now.title, '项目终审');
  assert.equal(now.time, '14:30');
  assert.equal(stored(c).length, 1);
  assert.equal(stored(c)[0].summary, '项目终审（2026-10-02 14:30）');
});

test('v279 6. 常驻契约：按 sourceId 去重的派生库必须三条出口齐备', () => {
  // v2.77 的修复是「给生活事件库补上改写与回收」。判据若只盯那个文件，
  // 下次新增第二个按 sourceId 去重的库时同一缺陷会原样重演——
  // 故这里改成结构判据：凡定义了 add() 且提到 sourceId 的模块，
  // 必须同时导出 updateBySource 与 removeBySource（新增/改写/回收）。
  const sites = [];
  for (const abs of walk(ROOT)) {
    const src = readFileSync(abs, 'utf8');
    if (!/\bsourceId\b/.test(src)) continue;
    if (!/(^|\n)\s+add\s*\(/.test(src)) continue;
    sites.push({ rel: path.relative(ROOT, abs).replace(/\\/g, '/'), src });
  }
  assert.ok(sites.length >= 1, '判据必须至少命中一处（否则说明探测器失效，而不是仓库变干净了）');
  const missing = [];
  for (const s of sites) {
    if (!/\bupdateBySource\s*\(/.test(s.src)) missing.push(s.rel + ' 缺 updateBySource');
    if (!/\bremoveBySource\s*\(/.test(s.src)) missing.push(s.rel + ' 缺 removeBySource');
  }
  assert.deepEqual(missing, [], 'commit 面派生库缺改写/回收出口，源头变更后会留下陈旧条目');
  assert.ok(sites.some((s) => s.rel === 'config/life-events.js'), '生活事件库必须在这份判据里');
});

test('v279 7. 版本不低于 2.78.0（本套件接管版本锚点）', () => {
  const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(readFileSync(path.join(ROOT, 'index.js'), 'utf8'));
  assert.ok(m, 'ST_PHONE_VERSION 必须存在');
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(m[1], String(manifest.version));
  const num = (v) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
  assert.ok(num(m[1]) >= num('2.79.0'), '本套件需要 2.79.0 及以上，实得 ' + m[1]);
});
