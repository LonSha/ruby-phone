// tests/system-v277.test.mjs
// [v2.77.0] 生活事件跟随源头：日历备忘改了/删了，时间线不再停在第一次写入。
//   旧实现只在新建备忘时 `add()` 一条生活事件，而 `add()` 命中同 sourceId 时
//   直接返回旧条目——改标题、改日期、改时间后时间线永远显示旧内容；
//   删除备忘后那条事件还留着，继续冒充一件已经不存在的事。
//   两处都不报错、不崩溃，只错数据（本仓最贵的形态）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeEventStore } from '../config/life-events.js';
import { CalendarData } from '../apps/calendar/calendar-data.js';

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

test('v277 1. 改标题后时间线跟着改，而不是停在第一次写入', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', time: '10:00', type: 'work' });
  assert.equal(stored(c).length, 1, '新建即入时间线');
  assert.equal(stored(c)[0].summary.includes('项目评审'), true);
  c.updateMemo(memo.id, { title: '项目终审' });
  assert.equal(stored(c).length, 1, '还是一条，不能复制出第二条');
  assert.equal(stored(c)[0].summary.includes('项目终审'), true, '改后的标题必须生效');
  assert.equal(stored(c)[0].summary.includes('项目评审'), false, '旧读数不得残留');
});

test('v277 2. 改日期/时间后（含清空时间）时间线同样重算', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '补习线性代数', type: 'study' });
  assert.equal(stored(c)[0].summary, '补习线性代数（2026-09-25）');
  c.updateMemo(memo.id, { time: '18:30' });
  assert.equal(stored(c)[0].summary, '补习线性代数（2026-09-25 18:30）');
  c.updateMemo(memo.id, { time: '' });
  assert.equal(stored(c)[0].summary, '补习线性代数（2026-09-25）', '清空时间不得留下残影');
});

test('v277 3. 领域类型被改成日常后，原先那条事件必须撤掉', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-26', title: '去火车站', time: '08:30', type: 'travel' });
  assert.equal(stored(c).length, 1);
  c.updateMemo(memo.id, { type: 'daily' });
  assert.equal(stored(c).length, 0, '改回日常后不得继续冒充生活事件');
  c.updateMemo(memo.id, { type: 'travel' });
  assert.equal(stored(c).length, 1, '再改回领域类型应重新入线');
  assert.equal(stored(c)[0].title, '出行');
});

test('v277 4. 领域之间换类型：旧条目退役，不并存两条', () => {
  const c = new CalendarData(memoryStorage());
  const memo = c.addMemo({ dateKey: '2026-09-26', title: '例行事项', type: 'work' });
  assert.equal(stored(c).length, 1);
  c.updateMemo(memo.id, { type: 'study' });
  assert.equal(stored(c).length, 1, '换类型后只应剩一条');
  assert.equal(stored(c)[0].title, '学业');
});

test('v277 5. 删除备忘后事件必须被回收，不留幽灵', () => {
  const c = new CalendarData(memoryStorage());
  const keep = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', type: 'work' });
  const drop = c.addMemo({ dateKey: '2026-09-27', title: '去火车站', type: 'travel' });
  assert.equal(stored(c).length, 2);
  c.deleteMemo(drop.id);
  const left = stored(c);
  assert.equal(left.length, 1, '被删备忘的事件不得留在时间线');
  assert.equal(left[0].summary.includes('项目评审'), true, '别的备忘不受影响');
  assert.equal(keep.id === drop.id, false);
});

test('v277 6. store 层：updateBySource 就地更新、removeBySource 只删该源', () => {
  const store = new LifeEventStore(memoryStorage());
  store.add({ type: 'calendar', app: 'calendar', title: '工作', summary: '甲（2026-09-25）', importance: 3, sourceId: 'src-a' });
  store.add({ type: 'calendar', app: 'calendar', title: '学业', summary: '乙（2026-09-26）', importance: 3, sourceId: 'src-b' });
  const updated = store.updateBySource('src-a', { summary: '甲改了（2026-09-28）' });
  assert.equal(updated.summary, '甲改了（2026-09-28）');
  assert.equal(store.events.length, 2, '更新不新增条目');
  assert.equal(store.updateBySource('src-a', { summary: '' }), null, '空内容不得覆盖旧读数');
  assert.equal(store.events.find((e) => e.sourceId === 'src-a').summary, '甲改了（2026-09-28）');
  assert.equal(store.removeBySource('src-a'), 1);
  assert.deepEqual(store.events.map((e) => e.sourceId), ['src-b'], '只删命中的源');
  assert.equal(store.removeBySource('src-a'), 0, '重复删除是无操作');
});

test('v277 7. 找不到源时 updateBySource 回落为新增（幂等：同源只留一条）', () => {
  const store = new LifeEventStore(memoryStorage());
  const created = store.updateBySource('src-x', { type: 'calendar', app: 'calendar', title: '出行', summary: '丙（2026-09-27）', importance: 3 });
  assert.equal(created.sourceId, 'src-x');
  assert.equal(store.events.length, 1);
  store.updateBySource('src-x', { summary: '丙改（2026-09-29）' });
  assert.equal(store.events.length, 1, '同源第二次仍是更新');
  assert.equal(store.events[0].summary, '丙改（2026-09-29）');
});

test('v277 8. 实例重建后读数一致（改过的内容确实落了盘）', () => {
  const storage = memoryStorage();
  const c = new CalendarData(storage);
  const memo = c.addMemo({ dateKey: '2026-09-25', title: '项目评审', type: 'work' });
  c.updateMemo(memo.id, { title: '项目终审', time: '14:00' });
  const reopened = new CalendarData(storage);
  reopened.clearCache?.();
  const raw = storage.get('life_events_v1');
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  assert.equal(list.length, 1);
  assert.equal(list[0].summary, '项目终审（2026-09-25 14:00）');
});
