// tests/seventh-cycle-expansion-batch-b.test.mjs — [RubyPhone · 第七期拓展批次 B]
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COMMISSION_STATUS,
    LICENSE_TYPES,
    CREATOR_DOMAINS,
    normalizeCommission,
    clarifyAndQuoteCommission,
    requestRevision,
    handleCommissionDelay,
    deliverAndAuthorize,
    evaluateCreatorCareer,
    creatorCareerMarketSelfCheck
} from '../config/creator-career-market.js';

import {
    AUTONOMY_PHASES,
    MEMBER_ENGAGEMENT,
    normalizeCommunitySeason,
    advanceSeasonPhase,
    deliberateOnIssue,
    handleMemberAbsence,
    archiveCommunityOutput,
    communityAutonomySelfCheck
} from '../config/community-autonomy.js';

test('RubyPhone · 第七期拓展批次 B · R7-X3 创作者生涯与委托市场', async (t) => {
    await t.test('自检零异常', () => {
        const res = creatorCareerMarketSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('委托返修、延误协商与圈层声誉隔离', () => {
        let comm = normalizeCommission({
            commissionId: 'comm_novel_cover',
            title: '奇幻小说封面设计',
            domain: CREATOR_DOMAINS.DESIGN,
            creatorId: 'designer_ming',
            styleTags: ['厚涂', '古典']
        });

        // 1. 澄清与报价
        comm = clarifyAndQuoteCommission(comm, {
            budget: 500,
            dueTime: Date.now() + 10 * 86400000,
            license: LICENSE_TYPES.COMMERCIAL_EXCLUSIVE,
            requirements: '突出古树与晨光'
        });
        assert.equal(comm.status, COMMISSION_STATUS.QUOTED);
        assert.equal(comm.license, LICENSE_TYPES.COMMERCIAL_EXCLUSIVE);

        // 2. 提出返修
        comm = requestRevision(comm, '古树枝干过密，遮挡了书名预留位');
        assert.equal(comm.status, COMMISSION_STATUS.REVISING);
        assert.equal(comm.revisionHistory.length, 1);
        assert.equal(comm.revisionHistory[0].feedback, '古树枝干过密，遮挡了书名预留位');

        // 3. 延误协商（绝不自动成功）
        comm = handleCommissionDelay(comm, '渲染服务器故障，需推迟三天', 3);
        assert.equal(comm.status, COMMISSION_STATUS.DELAYED);
        assert.ok(comm.delayNegotiation);
        assert.equal(comm.delayNegotiation.proposedExtensionDays, 3);

        // 4. 交付与授权
        comm = deliverAndAuthorize(comm, 'cdn://assets/cover_final.png');
        assert.equal(comm.status, COMMISSION_STATUS.AUTHORIZED);

        // 5. 圈层声誉计算：设计圈层获得声誉，插画与写作保持 0
        const career = evaluateCreatorCareer([comm], 'designer_ming');
        assert.equal(career.domainReputation[CREATOR_DOMAINS.DESIGN], 15);
        assert.equal(career.domainReputation[CREATOR_DOMAINS.WRITING], 0);
        assert.equal(career.domainReputation[CREATOR_DOMAINS.ILLUSTRATION], 0);
    });
});

test('RubyPhone · 第七期拓展批次 B · R7-X5 角色社群自治季', async (t) => {
    await t.test('自检零异常', () => {
        const res = communityAutonomySelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('跨阶段自治协商、分歧折中与缺席替代方案', () => {
        let season = normalizeCommunitySeason({
            seasonId: 'season_music_fest',
            communityName: '老街青年民谣社',
            seasonGoal: '举办夏夜河畔音乐会',
            members: [
                { memberId: 'm_player', name: '玩家', role: '音响与主持' },
                { memberId: 'm_luojia', name: '珞珈', role: '吉他弹唱' },
                { memberId: 'm_haoyu', name: '浩宇', role: '物资搬运' }
            ]
        });

        // 推进到议事
        season = advanceSeasonPhase(season, AUTONOMY_PHASES.DELIBERATION);
        assert.equal(season.currentPhase, AUTONOMY_PHASES.DELIBERATION);

        // 议事分歧记录
        season = deliberateOnIssue(season, {
            topic: '下雨天备用室内场地选择',
            resolution: '租用老礼堂半天作为下雨备选',
            dissentingOpinions: ['老礼堂租金偏高', '下雨不如直接改期']
        });
        assert.equal(season.deliberations.length, 1);
        assert.equal(season.deliberations[0].dissentingOpinions.length, 2);

        // 玩家临时请辞缺席，社团启动替代方案，严禁伪造在场
        season = handleMemberAbsence(season, {
            memberId: 'm_player',
            reason: '当晚需参加公司紧急加班',
            fallbackAction: '由珞珈兼任主持，临时向隔壁琴行借用智能功放',
            isPlayer: true
        });
        const playerMem = season.members.find(m => m.memberId === 'm_player');
        assert.equal(playerMem.engagement, MEMBER_ENGAGEMENT.ABSENT);
        assert.equal(season.absenceRecords.length, 1);
        assert.equal(season.absenceRecords[0].isPlayer, true);

        // 攻坚与归档结项
        season = advanceSeasonPhase(season, AUTONOMY_PHASES.EXECUTION);
        season = archiveCommunityOutput(season, {
            title: '夏夜河畔民谣会纪实音频',
            summary: '在突发缺员情况下依靠备用方案圆满演出'
        });
        assert.equal(season.currentPhase, AUTONOMY_PHASES.ARCHIVING);
        assert.ok(season.finalOutput);
        // 缺席人员绝不可列为主力贡献人
        assert.equal(season.finalOutput.contributors.includes('玩家'), false);
        assert.equal(season.finalOutput.contributors.includes('珞珈'), true);
    });
});