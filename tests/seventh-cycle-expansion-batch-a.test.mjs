// tests/seventh-cycle-expansion-batch-a.test.mjs — [RubyPhone · 第七期拓展批次 A]
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    OPPORTUNITY_STATUS,
    OPPORTUNITY_TYPES,
    evaluateOpportunities,
    acceptOpportunity,
    declineOpportunity,
    completeOpportunityAndAdvance,
    districtOpportunitiesSelfCheck
} from '../config/district-opportunities.js';

import {
    FESTIVAL_CYCLE_TYPES,
    FESTIVAL_PHASES,
    normalizeFestival,
    normalizeCharacterHabit,
    recordAbsence,
    advanceToNextEdition,
    deprecateFestival,
    festivalCustomsSelfCheck
} from '../config/festival-customs.js';

test('RubyPhone · 第七期拓展批次 A · R7-X1 街区机会生态', async (t) => {
    await t.test('自检零异常', () => {
        const res = districtOpportunitiesSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('拒绝机会必须标记为 declined 而绝非 completed', () => {
        const oppList = [
            {
                opportunityId: 'opp_cafe_gig',
                title: '老街咖啡馆临时帮工',
                type: OPPORTUNITY_TYPES.COMMISSION_LEAD,
                status: OPPORTUNITY_STATUS.AVAILABLE
            }
        ];
        const updated = declineOpportunity(oppList, 'opp_cafe_gig', '当天需准备毕业论文');
        const declined = updated.find(o => o.opportunityId === 'opp_cafe_gig');
        assert.ok(declined);
        assert.equal(declined.status, OPPORTUNITY_STATUS.DECLINED);
        assert.notEqual(declined.status, OPPORTUNITY_STATUS.COMPLETED);
        assert.equal(declined.consequenceNote, '当天需准备毕业论文');
    });

    await t.test('完成机会因果推进并支持触发下一环衍生机会', () => {
        const oppList = [
            {
                opportunityId: 'opp_repair_bike',
                title: '帮修老旧自行车',
                type: OPPORTUNITY_TYPES.JOINT_ACTIVITY,
                status: OPPORTUNITY_STATUS.ACCEPTED,
                chainId: 'chain_bike',
                chainStep: 1
            }
        ];

        const nextList = completeOpportunityAndAdvance(
            oppList,
            'opp_repair_bike',
            '顺利换好了内胎，店老板十分赞赏',
            {
                title: '受邀参观老修车铺藏书室',
                placeId: 'old_town',
                type: OPPORTUNITY_TYPES.MYSTERY_CLUE
            }
        );

        const completedOpp = nextList.find(o => o.opportunityId === 'opp_repair_bike');
        assert.equal(completedOpp.status, OPPORTUNITY_STATUS.COMPLETED);

        const chainedOpp = nextList.find(o => o.title === '受邀参观老修车铺藏书室');
        assert.ok(chainedOpp);
        assert.equal(chainedOpp.chainId, 'chain_bike');
        assert.equal(chainedOpp.chainStep, 2);
    });
});

test('RubyPhone · 第七期拓展批次 A · R7-X2 城市节庆与习俗', async (t) => {
    await t.test('自检零异常', () => {
        const res = festivalCustomsSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('角色偏好与仪式习惯规范化', () => {
        const habit = normalizeCharacterHabit({
            characterId: 'char_shuyun',
            assignedDuty: '祈福仪式引导',
            tabooOrDislike: '剧烈喧哗',
            favoriteRitual: '放水灯',
            enthusiasmLevel: 4
        });

        assert.equal(habit.characterId, 'char_shuyun');
        assert.equal(habit.tabooOrDislike, '剧烈喧哗');
        assert.equal(habit.favoriteRitual, '放水灯');
        assert.equal(habit.enthusiasmLevel, 4);
    });

    await t.test('缺席留痕、跨届记忆承接与废除传统不倒抹历史', () => {
        let fest = normalizeFestival({
            festivalId: 'fest_harvest',
            name: '秋收河畔祭',
            editionHistory: [
                {
                    edition: 1,
                    highlights: ['村民聚齐'],
                    absences: []
                }
            ]
        });

        // 缺席留痕
        fest = recordAbsence(fest, 'char_luohua', '因省城集训未归缺席', '大家在敬酒时为她留了空位');
        const lastEdition = fest.editionHistory[fest.editionHistory.length - 1];
        assert.equal(lastEdition.absences.length, 1);
        assert.equal(lastEdition.absences[0].characterId, 'char_luohua');
        assert.equal(lastEdition.absences[0].reason, '因省城集训未归缺席');

        // 推进到下一届
        const nextFest = advanceToNextEdition(fest, ['新增了火把游行环节']);
        assert.equal(nextFest.editionHistory.length, 2);
        assert.equal(nextFest.currentPhase, FESTIVAL_PHASES.PREPARATION);

        // 废除传统不删除数据
        const deprecated = deprecateFestival(nextFest, '城市防洪带改造，原河畔集会地征收');
        assert.equal(deprecated.isDeprecated, true);
        assert.equal(deprecated.editionHistory.length, 2);
        assert.equal(deprecated.name, '秋收河畔祭');
    });
});