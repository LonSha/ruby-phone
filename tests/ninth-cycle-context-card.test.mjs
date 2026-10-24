import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createContextCard,
    mergeContextItem,
    summarizeContextCard
} from '../config/unified-context-card.js';

test('R9-O4 · 上下文卡片创建与多维数据聚合', () => {
    const card = createContextCard('card-party', '周末聚会上下文', {
        incidentId: 'inc-party',
        characterId: 'luo_jia'
    });
    assert.equal(card.cardId, 'card-party');
    assert.equal(card.title, '周末聚会上下文');

    // 合并通知
    const r1 = mergeContextItem(card, 'notifications', { id: 'notif-1', text: '珞珈回复了你的消息' });
    assert.equal(r1.ok, true);

    // 合并待办
    const r2 = mergeContextItem(r1.card, 'todos', { id: 'todo-cake', title: '预定聚会蛋糕' });
    assert.equal(r2.ok, true);

    const summary = summarizeContextCard(r2.card);
    assert.equal(summary.totalItems, 2);
    assert.equal(summary.notificationCount, 1);
    assert.equal(summary.todoCount, 1);
});