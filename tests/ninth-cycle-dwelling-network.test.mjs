import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDwellingItemTransition } from '../config/character-dwelling-network.js';

test('R9-X3 · 角色居所物件流转谱系与私密阻断', () => {
    const dwelling = { id: 'dw_alice_room', items: [] };
    const secretLetter = { id: 'item_letter', title: '绝密信件', isPrivate: true };

    // 缺少来源事件阻断
    const failRes = recordDwellingItemTransition(dwelling, secretLetter, {
        type: 'gift'
    });
    assert.equal(failRes.success, false);
    assert.equal(failRes.reason, 'missing_source_event_lineage');

    // 携带事件谱系成功流转，且私密物件在默认公共展示中受限
    const okRes = recordDwellingItemTransition(dwelling, secretLetter, {
        type: 'gift',
        sourceEventId: 'ev_birthday_party'
    });
    assert.equal(okRes.success, true);
    assert.equal(okRes.itemRecord.isVisibleInPublic, false);
});