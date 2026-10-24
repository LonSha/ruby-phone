import test from 'node:test';
import assert from 'node:assert/strict';

import {
    INCIDENT_PHASES,
    normalizeIncident,
    attachAppRef,
    advanceIncidentPhase,
    compileWorkspaceDashboard
} from '../config/incident-workspace.js';

test('R9-O1 · 事情模型规范化与属性默认值', () => {
    const raw = {
        id: 'inc-beach-party',
        title: '海滩派对筹备',
        primaryCharacterId: 'luo_jia'
    };
    const inc = normalizeIncident(raw);
    assert.equal(inc.id, 'inc-beach-party');
    assert.equal(inc.title, '海滩派对筹备');
    assert.equal(inc.phase, INCIDENT_PHASES.PLANNING);
    assert.equal(inc.primaryCharacterId, 'luo_jia');
    assert.deepEqual(inc.linkedRefs, []);
});

test('R9-O1 · 跨 App 引用聚合与幂等防重', () => {
    const base = normalizeIncident({ id: 'inc-1', title: '调查档案' });
    const ref1 = { app: 'wechat', type: 'message', refId: 'msg-401', preview: '线索在旧仓库' };

    const res1 = attachAppRef(base, ref1);
    assert.equal(res1.ok, true);
    assert.equal(res1.mutated, true);
    assert.equal(res1.incident.linkedRefs.length, 1);

    // 重复添加相同 app + refId 应当幂等跳过
    const res2 = attachAppRef(res1.incident, ref1);
    assert.equal(res2.ok, true);
    assert.equal(res2.mutated, false);
    assert.equal(res2.incident.linkedRefs.length, 1);

    // 添加来自背包 App 的引用
    const ref2 = { app: 'backpack', type: 'item', refId: 'item-key-rusty', preview: '生锈的钥匙' };
    const res3 = attachAppRef(res1.incident, ref2);
    assert.equal(res3.ok, true);
    assert.equal(res3.mutated, true);
    assert.equal(res3.incident.linkedRefs.length, 2);
});

test('R9-O1 · 事项阶段流转留痕与阻断原因留存', () => {
    const inc = normalizeIncident({ id: 'inc-2', title: '剧情接力' });

    // 流转至阻断
    const res1 = advanceIncidentPhase(inc, INCIDENT_PHASES.BLOCKED, {
        reason: '缺少门禁通行卡',
        blockers: ['需要找珞花索要门禁卡']
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.incident.phase, INCIDENT_PHASES.BLOCKED);
    assert.deepEqual(res1.incident.blockers, ['需要找珞花索要门禁卡']);
    assert.equal(res1.incident.history.length, 1);
    assert.equal(res1.incident.history[0].from, INCIDENT_PHASES.PLANNING);
    assert.equal(res1.incident.history[0].to, INCIDENT_PHASES.BLOCKED);

    // 解除阻断至推进中
    const res2 = advanceIncidentPhase(res1.incident, INCIDENT_PHASES.IN_PROGRESS, {
        reason: '门禁卡已到手'
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.incident.phase, INCIDENT_PHASES.IN_PROGRESS);
    assert.deepEqual(res2.incident.blockers, []);
    assert.equal(res2.incident.history.length, 2);
});

test('R9-O1 · 事项工作台全局状态编译与分类统计', () => {
    const list = [
        { id: '1', title: 'A', phase: INCIDENT_PHASES.PLANNING },
        { id: '2', title: 'B', phase: INCIDENT_PHASES.IN_PROGRESS },
        { id: '3', title: 'C', phase: INCIDENT_PHASES.AWAITING_REPLY },
        { id: '4', title: 'D', phase: INCIDENT_PHASES.BLOCKED },
        { id: '5', title: 'E', phase: INCIDENT_PHASES.RESOLVED }
    ];

    const dash = compileWorkspaceDashboard(list);
    assert.equal(dash.total, 5);
    assert.equal(dash.activeCount, 2); // planning + in_progress
    assert.equal(dash.awaitingCount, 1);
    assert.equal(dash.blockedCount, 1);
    assert.equal(dash.completedCount, 1);
});