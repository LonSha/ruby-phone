import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarData } from '../apps/calendar/calendar-data.js';
import { travelCalendarPreview, commitTravelCalendar } from '../apps/traveldesk/traveldesk-calendar.js';
const party = { stops: [{ id: 's', place: '公园', day: '2026-11-08' }] };
function setup() {
 const rows = [{ id: 'm', title: '游园', dateKey: '2026-11-07', time: '10:00', type: 'daily', source: 'manual' }];
 let saved = JSON.stringify(rows); let writes = 0;
 const cal = Object.create(CalendarData.prototype);
 cal._memos = rows; cal.memoKey = 'calendar_memos';
 cal.storage = { get: () => saved, set: (k,v) => { saved = v; writes++; } };
 cal.refreshDomainLifeEvent = () => {};
 return { cal, writes: () => writes };
}
test('真实日历 owner 改期保留 ID 与时间，预览无写且不新增', () => {
 const { cal, writes } = setup(); const preview = travelCalendarPreview(party, 's', 'm', cal);
 assert.equal(preview.ok, true); assert.equal(writes(), 0);
 assert.equal(commitTravelCalendar(party, preview, cal).ok, true);
 assert.equal(cal.getMemos().length, 1); assert.equal(cal.getMemos()[0].time, '10:00');
 assert.equal(JSON.parse(cal.storage.get())[0].dateKey, '2026-11-08');
 const repeat = travelCalendarPreview(party, 's', 'm', cal);
 assert.equal(commitTravelCalendar(party, repeat, cal).ok, true); assert.equal(writes(), 1);
});
test('过时预览、来源缺失和周期日程不写入', () => {
 const { cal, writes } = setup(); const preview = travelCalendarPreview(party, 's', 'm', cal);
 cal.getMemos()[0].title = '已编辑';
 assert.equal(commitTravelCalendar(party, preview, cal).ok, false);
 assert.equal(travelCalendarPreview(party, 's', 'gone', cal).ok, false);
 cal.getMemos()[0].type = 'birthday';
 assert.equal(travelCalendarPreview(party, 's', 'm', cal).ok, false); assert.equal(writes(), 0);
});
test('静默保存失败不能报成功', () => {
 const { cal } = setup(); cal.storage.set = () => {};
 const preview = travelCalendarPreview(party, 's', 'm', cal);
 assert.equal(commitTravelCalendar(party, preview, cal).ok, false);
});
test('保存记录在预览后被外部编辑时拒绝覆盖', () => {
 const { cal } = setup(); const preview = travelCalendarPreview(party, 's', 'm', cal);
 cal.storage.set('calendar_memos', JSON.stringify([{...cal.getMemos()[0], title:'另一处编辑'}]));
 assert.equal(commitTravelCalendar(party, preview, cal).ok, false);
 assert.equal(JSON.parse(cal.storage.get())[0].title, '另一处编辑');
});

test('其他日程被外部新增时不以旧缓存覆盖整表', () => {
 const { cal } = setup(); const preview = travelCalendarPreview(party, 's', 'm', cal);
 cal.storage.set('calendar_memos', JSON.stringify([...cal.getMemos(), {id:'other',title:'新安排',dateKey:'2026-11-09'}]));
 assert.equal(commitTravelCalendar(party, preview, cal).ok, false);
 assert.equal(JSON.parse(cal.storage.get()).length, 2);
});
