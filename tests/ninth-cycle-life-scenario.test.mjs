import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceScenarioNode } from '../config/orchestrated-life-scenario.js';

test('R9-X2 · 可编排生活事件剧本推进与错失分支记录', () => {
    const scenario = {
        id: 'sc_weekend_trip',
        nodes: [
            {
                id: 'node_start',
                branches: [
                    { id: 'b_mountain', label: '去爬山', targetNodeId: 'node_mountain' },
                    { id: 'b_cafe', label: '留在咖啡馆', targetNodeId: 'node_cafe' }
                ]
            },
            {
                id: 'node_mountain',
                branches: []
            }
        ]
    };

    const res = advanceScenarioNode(scenario, 'node_start', 'b_mountain');
    assert.equal(res.success, true);
    assert.equal(res.currentNodeId, 'node_mountain');
    assert.equal(res.missedBranches.length, 1);
    assert.equal(res.missedBranches[0].branchId, 'b_cafe');
});