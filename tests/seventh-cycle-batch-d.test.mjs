// tests/seventh-cycle-batch-d.test.mjs — [RubyPhone · 第七期批次 D]
// R7-O9 可控主动体验
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PROPOSAL_TYPES,
    PROPOSAL_STATUS,
    normalizeProposalItem,
    createProactiveScheduler,
    submitProposal,
    approveProposal,
    rejectProposal,
    pauseProactiveScheduler,
    resumeProactiveScheduler,
    proactiveProposalSelfCheck
} from '../config/proactive-proposal.js';

test('RubyPhone · 第七期批次 D · R7-O9 可控主动体验', async (t) => {
    await t.test('自检零异常', () => {
        const check = proactiveProposalSelfCheck();
        assert.deepEqual(check.problems, [], 'proactiveProposalSelfCheck 必须零问题');
    });

    await t.test('提议队列透明性、幂等防重、每日限额控制、暂停调度与用户确认执行', () => {
        // 1. 初始化主动调度器，设置每日预算为 100
        let scheduler = createProactiveScheduler({ dailyBudgetLimit: 100 });
        assert.equal(scheduler.isPaused, false);
        assert.equal(scheduler.dailyBudgetLimit, 100);
        assert.equal(scheduler.usedCostToday, 0);

        // 2. 提交两条不同类型的提议
        const p1 = {
            proposalId: 'p_msg_weather',
            triggerKey: 'trigger_clock_rain_morning',
            type: PROPOSAL_TYPES.CHARACTER_MESSAGE,
            costEstimate: 25,
            triggerReason: '晨间天气骤变，周姐主动提醒出门带伞',
            executableAction: { channel: 'wechat', targetRole: 'zhou_jie', payload: '外面下大雨了，你出门别忘了带伞。' }
        };

        const p2 = {
            proposalId: 'p_media_dossier',
            triggerKey: 'trigger_dossier_finished',
            type: PROPOSAL_TYPES.MEDIA_TASK,
            costEstimate: 40,
            triggerReason: '第四章大纲完成，提议生成对应章节封面配图',
            executableAction: { channel: 'creationdesk', targetRole: 'painter', payload: 'prompt: ancient rain alley' }
        };

        scheduler = submitProposal(scheduler, p1);
        scheduler = submitProposal(scheduler, p2);

        assert.equal(scheduler.queue.length, 2);
        assert.equal(scheduler.queue[0].status, PROPOSAL_STATUS.QUEUED);
        assert.equal(scheduler.queue[1].status, PROPOSAL_STATUS.QUEUED);

        // 3. 幂等查重测试：重复提交 p1 无论多少次，队列决不重复
        scheduler = submitProposal(scheduler, p1);
        scheduler = submitProposal(scheduler, p1);
        assert.equal(scheduler.queue.length, 2, '相同 triggerKey 必须被严格去重拦截');

        // 4. 用户确认执行 p1：不可逆释放动作，进入 executedHistory，扣减/累计成本
        scheduler = approveProposal(scheduler, 'p_msg_weather');
        assert.equal(scheduler.queue.length, 1);
        assert.equal(scheduler.executedHistory.length, 1);
        assert.equal(scheduler.executedHistory[0].status, PROPOSAL_STATUS.APPROVED);
        assert.equal(scheduler.usedCostToday, 25);

        // 再次提交已被执行过的 p1，仍应被幂等拦截，防止重复触发
        scheduler = submitProposal(scheduler, p1);
        assert.equal(scheduler.queue.length, 1, '历史已执行的 triggerKey 同样杜绝重复提交');

        // 5. 预算限额测试：当前已用 25，上限 100。再提交耗资 90 的任务 (25+90=115 > 100)
        const pOver = {
            proposalId: 'p_heavy_render',
            triggerKey: 'trigger_heavy_3d_render',
            type: PROPOSAL_TYPES.MEDIA_TASK,
            costEstimate: 90,
            triggerReason: '高质量视频渲染'
        };
        scheduler = submitProposal(scheduler, pOver);
        const overItem = scheduler.queue.find(x => x.proposalId === 'p_heavy_render');
        assert.equal(overItem?.status, PROPOSAL_STATUS.DROPPED_BUDGET, '超预算任务应打标 dropped_budget');

        // 6. 用户主动拒绝 p2
        scheduler = rejectProposal(scheduler, 'p_media_dossier', '用户暂不需要封面图');
        const rejectedItem = scheduler.queue.find(x => x.proposalId === 'p_media_dossier');
        assert.equal(rejectedItem?.status, PROPOSAL_STATUS.REJECTED);
        assert.ok(rejectedItem.rejectedReason.includes('暂不需要'));

        // 7. 调度暂停测试：暂停后彻底阻断一切新提议入队
        scheduler = pauseProactiveScheduler(scheduler);
        assert.equal(scheduler.isPaused, true);

        const pPaused = {
            proposalId: 'p_after_pause',
            triggerKey: 'trigger_after_pause',
            costEstimate: 10
        };
        scheduler = submitProposal(scheduler, pPaused);
        assert.ok(!scheduler.queue.some(x => x.proposalId === 'p_after_pause'), '暂停状态下绝对不入队任何新提议');

        // 恢复调度
        scheduler = resumeProactiveScheduler(scheduler);
        assert.equal(scheduler.isPaused, false);
    });
});