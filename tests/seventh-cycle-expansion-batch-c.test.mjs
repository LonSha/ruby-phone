// tests/seventh-cycle-expansion-batch-c.test.mjs — [RubyPhone · 第七期拓展批次 C]
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SCENARIO_NODE_TYPES,
    normalizeScenario,
    createScenarioRun,
    advanceScenarioRun,
    filterVisibleCluesForParticipant,
    scenarioAuthoringDeskSelfCheck
} from '../config/scenario-authoring-desk.js';

import {
    MEDIA_CHANNEL,
    normalizeSerialEpisode,
    chooseBranchOption,
    buildContinuationPackage,
    revisePrimaryFact,
    multimediaSerialStudioSelfCheck
} from '../config/multimedia-serial-studio.js';

test('RubyPhone · 第七期拓展批次 C · R7-X4 可编排场景作者台', async (t) => {
    await t.test('自检零异常', () => {
        const res = scenarioAuthoringDeskSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('六节点场景编排、线索视角隔离与演练不污染原稿', () => {
        const scenario = normalizeScenario({
            scenarioId: 'scen_test_mansion',
            title: '老宅夜谈',
            version: 1,
            participants: [
                { characterId: 'char_a', name: '敏锐角色', perceptiveTier: 3 },
                { characterId: 'char_b', name: '普通角色', perceptiveTier: 1 }
            ],
            nodes: [
                {
                    nodeId: 'node_1',
                    type: SCENARIO_NODE_TYPES.ENTRY,
                    transitions: [
                        { choiceText: '调查暗格', targetNodeId: 'node_2' },
                        { choiceText: '避开暗格', targetNodeId: 'node_3' }
                    ]
                },
                {
                    nodeId: 'node_2',
                    type: SCENARIO_NODE_TYPES.CLUE,
                    visibleToRoles: ['char_a'],
                    transitions: [
                        { choiceText: '对质', targetNodeId: 'node_4' },
                        { choiceText: '隐瞒', targetNodeId: 'node_5' }
                    ]
                },
                {
                    nodeId: 'node_3',
                    type: SCENARIO_NODE_TYPES.TRANSITION,
                    transitions: [
                        { choiceText: '离场', targetNodeId: 'node_6' }
                    ]
                },
                { nodeId: 'node_4', type: SCENARIO_NODE_TYPES.ENDING, endingOutcome: '结局一' },
                { nodeId: 'node_5', type: SCENARIO_NODE_TYPES.ENDING, endingOutcome: '结局二' },
                { nodeId: 'node_6', type: SCENARIO_NODE_TYPES.ENDING, endingOutcome: '结局三' }
            ]
        });

        assert.equal(scenario.nodes.length, 6);

        // 线索视角隔离
        const cluesA = filterVisibleCluesForParticipant(scenario, 'char_a');
        const cluesB = filterVisibleCluesForParticipant(scenario, 'char_b');
        assert.equal(cluesA.length, 1);
        assert.equal(cluesB.length, 0);

        // 独立演练
        let run = createScenarioRun(scenario, 'char_a');
        run = advanceScenarioRun(scenario, run, '调查暗格');
        run = advanceScenarioRun(scenario, run, '对质');
        assert.equal(run.isCompleted, true);
        assert.equal(run.finalEndingId, 'node_4');

        // 原稿完全不受影响
        assert.equal(scenario.nodes[0].nodeId, 'node_1');
    });
});

test('RubyPhone · 第七期拓展批次 C · R7-X7 跨媒介互动连载工作室', async (t) => {
    await t.test('自检零异常', () => {
        const res = multimediaSerialStudioSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('主线事实恒定、分支选择与跨媒介未读接续包', () => {
        const ep = normalizeSerialEpisode({
            episodeNum: 2,
            title: '风起老街',
            primaryFact: '老琴行举办了结业告别演凑',
            branchOptions: [
                {
                    branchKey: 'branch_backstage',
                    label: '去后台寻找乐谱',
                    perspectiveShift: '后台探秘视角'
                }
            ],
            channelArtifacts: [
                {
                    artifactId: 'art_read_ep2',
                    channel: MEDIA_CHANNEL.READING,
                    content: '台前掌声雷动。'
                },
                {
                    artifactId: 'art_chat_ep2',
                    channel: MEDIA_CHANNEL.CHAT,
                    content: '微信群消息：“乐谱找到了吗？”'
                },
                {
                    artifactId: 'art_theater_ep2',
                    channel: MEDIA_CHANNEL.THEATER,
                    content: '后台尘封箱子被打开……',
                    requiredBranchKey: 'branch_backstage'
                }
            ]
        });

        // 读者选择分支
        const reader = chooseBranchOption(ep, 'branch_backstage', { readArtifactIds: ['art_read_ep2'] });
        assert.equal(reader.primaryFactPreserved, '老琴行举办了结业告别演凑');
        assert.equal(reader.currentPerspective, '后台探秘视角');

        // 跨媒介接续包与未读通道
        const pack = buildContinuationPackage(ep, reader);
        assert.equal(pack.unreadCount, 2);
        assert.ok(pack.unreadChannels.includes(MEDIA_CHANNEL.CHAT));
        assert.ok(pack.unreadChannels.includes(MEDIA_CHANNEL.THEATER));

        // 主线修订可保留快照
        const revised = revisePrimaryFact(ep, '老琴行告别演凑因暴雨提前终止', true);
        assert.equal(revised.previousFactSnapshot, '老琴行举办了结业告别演凑');
    });
});