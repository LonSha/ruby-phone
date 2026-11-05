import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParty } from '../apps/traveldesk/traveldesk-plan.js';
import { progressAction } from '../apps/traveldesk/traveldesk-progress.js';
import { TraveldeskApp, TV_PARTY_KEY } from '../apps/traveldesk/traveldesk-app.js';
const board = () => normalizeParty({ stops: [{ id: 'a', place: '车站' }, { id: 'b', place: '公园', day: '明天' }], costs: [] }).party;
test('跳站保留路线，当前站推进保留到访历史，归一不丢新字段', () => {
    const original = board();
    const first = progressAction(original, { id: 'a', op: 'current' });
    const second = progressAction(first.party, { id: 'b', op: 'current' });
    assert.equal(second.party.stops[0].progress, 'visited');
    const skipped = progressAction(second.party, { id: 'b', op: 'skip' });
    assert.equal(skipped.party.stops.length, 2);
    assert.equal(normalizeParty(skipped.party).party.stops[1].progress, 'skipped');
    assert.equal(original.stops[0].progress, 'pending');
    assert.deepEqual(skipped.party.costs, original.costs);
});
test('晚到及会合仅改显式字段，未知交通时间不推算日程', () => {
    const late = progressAction(board(), { id: 'a', op: 'late', minutes: 30 });
    assert.equal(late.party.stops[0].lateMinutes, 30);
    assert.equal(late.affected[0].day, '明天');
    assert.equal(late.party.stops[1].day, '明天');
    assert.equal(progressAction(board(), { id: 'a', op: 'late', minutes: -1 }).ok, false);
    assert.equal(progressAction(board(), { id: 'gone', op: 'skip' }).ok, false);
});
test('真实 owner 预览无写，确认回读，旧预览拒绝，重开保留', () => {
    let raw = board(); let writes = 0;
    const app = Object.create(TraveldeskApp.prototype);
    app._readPartyRaw = () => structuredClone(raw);
    app._writeRaw = (key, value) => { assert.equal(key, TV_PARTY_KEY); raw = structuredClone(value); writes++; return { saved: true }; };
    const action = { id: 'a', op: 'skip', expected: JSON.stringify(raw) };
    assert.equal(app.partyAct('progress-preview', action).ok, true);
    assert.equal(writes, 0);
    assert.equal(app.partyAct('progress-confirm', action).saved, true);
    assert.equal(writes, 1);
    assert.equal(app.partyAct('progress-confirm', action).ok, false);
    assert.equal(normalizeParty(raw).party.stops[0].progress, 'skipped');
});
