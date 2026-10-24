// tests/seventh-cycle-expansion-batch-d.test.mjs — [RubyPhone · 第七期拓展批次 D]
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RELIC_STATUS,
    RELIC_CATEGORY,
    normalizeRelic,
    annotateRelic,
    transferRelicOwnership,
    revokeRelicSharing,
    markRelicStatus,
    relicCollectionSelfCheck
} from '../config/relic-collection.js';
import {
    PRACTICE_PHASE,
    SKILL_CATEGORY,
    normalizeMentorshipProject,
    recordPracticeAttempt,
    swapMentorshipRoles,
    setPracticePaused,
    mentorshipPracticeSelfCheck
} from '../config/mentorship-practice.js';
import {
    SANDBOX_STATUS,
    createParallelLifeSandbox,
    advanceSandboxDay,
    contrastSandboxWithMainline,
    previewMemoryExport,
    confirmMemoryExportToMainline,
    discardSandbox,
    parallelLifeSandboxSelfCheck
} from '../config/parallel-life-sandbox.js';

test('RubyPhone · 第七期拓展批次 D · R7-X6 关系纪念物与共同收藏', async (t) => {
    await t.test('自检零异常', () => {
        const res = relicCollectionSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('多角色主观批注独立并存，所有权流转保留完整历史链', () => {
        let relic = normalizeRelic({
            relicId: 'relic_train_ticket',
            title: '1998年深秋的旧车票',
            category: RELIC_CATEGORY.PAPER_EPHEMERA,
            currentOwnerId: 'char_a',
            sharedRoleIds: ['char_a', 'char_b']
        });

        // 双方分别写下主观批注
        relic = annotateRelic(relic, 'char_a', '那天的雨很大，我以为只是暂别。');
        relic = annotateRelic(relic, 'char_b', '我看着列车远去，明白有些再见是永别。');

        assert.equal(relic.annotationsByRole.char_a, '那天的雨很大，我以为只是暂别。');
        assert.equal(relic.annotationsByRole.char_b, '我看着列车远去，明白有些再见是永别。');

        // 所有权转赠
        relic = transferRelicOwnership(relic, 'char_b', '郑重交付保管');
        assert.equal(relic.currentOwnerId, 'char_b');
        assert.equal(relic.ownershipHistory.length, 1);
        assert.equal(relic.ownershipHistory[0].fromOwnerId, 'char_a');
        assert.equal(relic.ownershipHistory[0].toOwnerId, 'char_b');
    });

    await t.test('撤销共享绝不抹杀对方已有主观记忆，物态破损与修缮留痕', () => {
        let relic = normalizeRelic({
            relicId: 'relic_music_box',
            title: '发条八音盒',
            category: RELIC_CATEGORY.KEEPSAKE,
            currentOwnerId: 'char_a',
            sharedRoleIds: ['char_a', 'char_b']
        });

        relic = annotateRelic(relic, 'char_b', '发条转动时的清脆旋律');

        // 撤销共享
        relic = revokeRelicSharing(relic, 'char_b');
        assert.equal(relic.sharedRoleIds.includes('char_b'), false);
        // 关键原则：绝不单方面让对方失忆
        assert.equal(relic.annotationsByRole.char_b, '发条转动时的清脆旋律');

        // 物态变化与修缮留痕
        relic = markRelicStatus(relic, RELIC_STATUS.DAMAGED, '发条齿轮崩断');
        assert.equal(relic.status, RELIC_STATUS.DAMAGED);
        assert.equal(relic.conditionNote, '发条齿轮崩断');
        relic = markRelicStatus(relic, RELIC_STATUS.REPAIRED, '钟表匠重新校准齿轮');
        assert.equal(relic.status, RELIC_STATUS.REPAIRED);
        assert.equal(relic.conditionNote, '钟表匠重新校准齿轮');
    });
});

test('RubyPhone · 第七期拓展批次 D · R7-X8 生活技能与师徒实践', async (t) => {
    await t.test('自检零异常', () => {
        const res = mentorshipPracticeSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('四次练习包含失败并调整方法，最终凭作品达成 mastery', () => {
        let proj = normalizeMentorshipProject({
            projectId: 'proj_guitar_fingerpicking',
            skillName: '木吉他卡农指弹',
            category: SKILL_CATEGORY.MUSIC,
            mentorId: 'char_teacher',
            apprenticeId: 'user_learner'
        });

        // 第 1 次：失败翻车
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '和弦转换卡顿杂音',
            isSuccess: false,
            feedback: '大横按未压紧品丝，右手指甲打弦角度倾斜',
            lessonLearned: '大拇指位置下移，指尖垂直立起'
        });
        assert.equal(proj.currentPhase, PRACTICE_PHASE.RETRY);
        assert.equal(proj.practiceRounds[0].isSuccess, false);

        // 第 2 次：调整方法后好转
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '前奏和弦清晰连贯',
            isSuccess: true,
            feedback: '杂音明显消除，节奏稳定',
            lessonLearned: '放慢速度配合节拍器练习见效'
        });

        // 第 3 次：巩固练习
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '主歌部分完整流畅演练',
            isSuccess: true,
            feedback: '音色圆润，强弱起伏自然',
            lessonLearned: '触弦轻重有了掌控力'
        });

        // 第 4 次：完整成曲结业作品
        proj = recordPracticeAttempt(proj, {
            artifactOutcome: '卡农指弹完整录音曲目',
            isSuccess: true,
            feedback: '完全具备现场演奏水平，正式结业',
            lessonLearned: '反复打磨细节形成肌肉记忆'
        });

        assert.equal(proj.currentPhase, PRACTICE_PHASE.MASTERY);
        assert.equal(proj.masteredArtifactProof, '卡农指弹完整录音曲目');
        assert.equal(proj.practiceRounds.length, 4);
    });

    await t.test('师徒角色平滑对调与会话中断暂存', () => {
        let proj = normalizeMentorshipProject({
            projectId: 'proj_baking_chiffon',
            skillName: '戚风蛋糕烘焙',
            category: SKILL_CATEGORY.COOKING,
            mentorId: 'char_baker',
            apprenticeId: 'user_learner'
        });

        // 中断暂存
        proj = setPracticePaused(proj, true);
        assert.equal(proj.isPaused, true);
        proj = setPracticePaused(proj, false);
        assert.equal(proj.isPaused, false);

        // 师徒对调
        const swapped = swapMentorshipRoles(proj, '手机数码摄影构图');
        assert.equal(swapped.mentorId, 'user_learner');
        assert.equal(swapped.apprenticeId, 'char_baker');
        assert.equal(swapped.currentPhase, PRACTICE_PHASE.DEMONSTRATION);
    });
});

test('RubyPhone · 第七期拓展批次 D · R7-X9 平行生活沙盒', async (t) => {
    await t.test('自检零异常', () => {
        const res = parallelLifeSandboxSelfCheck();
        assert.deepEqual(res.problems, []);
    });

    await t.test('连续 7 个游戏日演进、主线绝对隔离、多维对照与受控回导', () => {
        const baseSnapshot = {
            snapshotId: 'snap_crossroad_1999',
            checkpointName: '留在故乡开书店还是去往大都市',
            relationships: {
                char_hometown_friend: 'intimate',
                char_city_partner: 'stranger'
            }
        };

        let sandbox = createParallelLifeSandbox(baseSnapshot, {
            sandboxId: 'sb_bookstore_life',
            title: '故乡老书店岁月',
            divergenceReason: '选择接手老书店'
        });

        assert.equal(sandbox.isMainlineIsolated, true);
        assert.equal(sandbox.status, SANDBOX_STATUS.ACTIVE);

        // 模拟连续 7 个游戏日
        for (let day = 1; day <= 7; day++) {
            sandbox = advanceSandboxDay(sandbox, {
                daySummary: `书店日常第 ${day} 天`,
                newMessages: [{ from: 'reader_guest', to: 'user', content: `老板，第 ${day} 期杂志到了吗？` }],
                scheduleActivities: [`整理第 ${day} 排书架`],
                newWorks: day === 7 ? [{ title: '书店七日手记', contentSummary: '平淡而安宁的日子' }] : [],
                relationshipChanges: day === 3 ? { char_hometown_friend: 'unbreakable_bond' } : {},
                notableEpiphanies: day === 7 ? [{ memoryId: 'ep_peaceful_mind', text: '安顿好内心的方寸之间便是归宿' }] : []
            });
        }

        assert.equal(sandbox.sandboxState.timelineEvents.length, 7);
        assert.equal(sandbox.sandboxState.currentDay, 8);

        // 双线对照
        const mainlineSnapshot = {
            messages: [{ from: 'boss', content: '加班方案' }],
            calendarSchedule: ['赶地铁'],
            creativeWorks: [],
            relationships: {
                char_hometown_friend: 'distant_contact'
            }
        };
        const contrast = contrastSandboxWithMainline(sandbox, mainlineSnapshot);
        assert.equal(contrast.daysLivedInSandbox, 7);
        assert.equal(contrast.isCleanlyIsolated, true);
        assert.equal(contrast.relationshipDivergences.length > 0, true);

        // 记忆逐项预览与受控导回
        const preview = previewMemoryExport(sandbox);
        assert.equal(preview.items.length, 1);
        assert.equal(preview.items[0].memoryId, 'ep_peaceful_mind');

        const mainlineState = { status: 'running_clean' };
        const confirmRes = confirmMemoryExportToMainline(mainlineState, sandbox, {
            approvedMemoryIds: ['ep_peaceful_mind']
        });
        assert.equal(confirmRes.exportedCount, 1);
        assert.equal(confirmRes.mainlineFactsContaminated, false);
        assert.equal(confirmRes.updatedMainline.importedParallelInsights.length, 1);

        // 丢弃分支沙盒确保主线可继续
        const discardRes = discardSandbox(sandbox);
        assert.equal(discardRes.mainlineCanResumeNormally, true);
        assert.equal(discardRes.leakageDetected, false);
    });
});