// tests/seventh-cycle-batch-b.test.mjs — [RubyPhone · 第七期批次 B]
// R7-O3 今日节奏编排 + R7-O4 人物在场与可用性 + R7-O7 关系边界与共享控制
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    RHYTHM_SLOTS,
    RHYTHM_CONFLICT_TYPES,
    RHYTHM_ITEM_STATUS,
    buildDailyRhythmDraft,
    rescheduleConflict,
    rejectRhythmItem,
    dailyRhythmSelfCheck
} from '../config/daily-rhythm.js';

import {
    PRESENCE_STATES,
    CONTACT_CHANNELS,
    INVITATION_STATUS,
    evaluateCharacterPresence,
    queueInvitation,
    cancelInvitation,
    resolvePendingInvitations,
    characterPresenceSelfCheck
} from '../config/character-presence.js';

import {
    SHARING_SCOPES,
    ACCESS_STATUS,
    buildShareDraft,
    previewRecipientView,
    markRecipientRead,
    revokeShare,
    sharingBoundarySelfCheck
} from '../config/sharing-boundary.js';

test('R7-O3 · 今日节奏编排：自检、冲突识别与锁定保护重排', () => {
    assert.deepEqual(dailyRhythmSelfCheck().problems, []);

    // 初始日程：工作会议（锁定）、午餐约会（未锁定）、临时研讨（未锁定，与午餐冲突）
    const items = [
        { id: 'work_meeting', title: '核心开发例会', slot: RHYTHM_SLOTS.MORNING, startMinute: 600, durationMinutes: 90, locked: true },
        { id: 'lunch_date', title: '小雪午餐约会', slot: RHYTHM_SLOTS.AFTERNOON, startMinute: 720, durationMinutes: 60, locked: true },
        { id: 'urgent_sync', title: '突发需求对齐', slot: RHYTHM_SLOTS.AFTERNOON, startMinute: 750, durationMinutes: 45, locked: false }
    ];

    const draft = buildDailyRhythmDraft(items, { date: '2026-10-25' });
    assert.equal(draft.hasConflict, true);
    assert.equal(draft.conflicts.length, 1);
    assert.equal(draft.conflicts[0].type, RHYTHM_CONFLICT_TYPES.TIME_OVERLAP);
    assert.equal(draft.isCommitted, false, '草案态未确认前绝不直接写入正式日历');

    // 局部改排：将未锁定的 urgent_sync 挪至 14:00 (840分)
    const rescheduled = rescheduleConflict(draft, 'urgent_sync', 840);
    assert.equal(rescheduled.hasConflict, false, '顺延冲突项后冲突解除');

    // 尝试改排锁定的午餐约会 -> 必须被拒绝保持原样
    const failedReschedule = rescheduleConflict(rescheduled, 'lunch_date', 900);
    const lunchItem = failedReschedule.items.find(i => i.id === 'lunch_date');
    assert.equal(lunchItem.startMinute, 720, '锁定事项绝不可被非授权强制改动');

    // 拒绝某项
    const rejectedDraft = rejectRhythmItem(rescheduled, 'urgent_sync', '今天精力不足，改期处理');
    const rejItem = rejectedDraft.items.find(i => i.id === 'urgent_sync');
    assert.equal(rejItem.status, RHYTHM_ITEM_STATUS.REJECTED);
    assert.equal(rejItem.rejectReason, '今天精力不足，改期处理');
});

test('R7-O4 · 人物在场与可用性：在场三态、排队邀请与活动结束接回', () => {
    assert.deepEqual(characterPresenceSelfCheck().problems, []);

    const now = 1700000000000;

    // 1. 角色正处于活动中（忙碌）
    const busyContext = {
        currentActivity: {
            title: '话剧彩排',
            location: '海淀剧院',
            startTime: now - 1800000,
            endTime: now + 3600000
        }
    };
    const presBusy = evaluateCharacterPresence('xiaoxue', busyContext, now);
    assert.equal(presBusy.state, PRESENCE_STATES.BUSY_LATER);
    assert.ok(presBusy.recommendedChannels.includes(CONTACT_CHANNELS.MESSAGE_QUEUE));

    // 2. 角色无行程且近期活跃（空闲在场）
    const idleContext = { hasLocationRecord: true, lastSeenRecent: true };
    const presIdle = evaluateCharacterPresence('xiaoxue', idleContext, now);
    assert.equal(presIdle.state, PRESENCE_STATES.AVAILABLE_NOW);
    assert.ok(presIdle.recommendedChannels.includes(CONTACT_CHANNELS.CALL));

    // 3. 无数据（未知）
    const presUnknown = evaluateCharacterPresence('xiaoxue', {}, now);
    assert.equal(presUnknown.state, PRESENCE_STATES.UNKNOWN);

    // 4. 排队邀请与撤回
    let queue = queueInvitation([], { characterId: 'xiaoxue', topic: '周末郊游讨论' }, now);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].status, INVITATION_STATUS.QUEUED);

    // 撤回邀请测试
    const cancelRes = cancelInvitation(queue, queue[0].id, '临时有别的事先取消', now + 1000);
    assert.ok(cancelRes.ok);
    assert.equal(cancelRes.queue[0].status, INVITATION_STATUS.CANCELLED);
    assert.equal(cancelRes.queue[0].cancelReason, '临时有别的事先取消');

    // 5. 活动结束时接回待决邀请
    const activeQueue = queueInvitation([], { characterId: 'xiaoxue', topic: '剧本反馈' }, now);
    const resolved = resolvePendingInvitations(activeQueue, 'xiaoxue', now + 4000000);
    assert.equal(resolved.delivered.length, 1);
    assert.equal(resolved.delivered[0].topic, '剧本反馈');
    assert.equal(resolved.queue[0].status, INVITATION_STATUS.DELIVERED);
});

test('R7-O7 · 关系边界与共享控制：圈层授权、敏感打码与撤回存证', () => {
    assert.deepEqual(sharingBoundarySelfCheck().problems, []);

    const now = 1700000000000;

    // 1. 创建一段群组分享草案，包含小秘密敏感词
    const draft = buildShareDraft({
        snippet: '昨天和小雪在五道口聚会，她悄悄告诉我其实她想辞职去旅行。',
        scope: SHARING_SCOPES.SHARED_GROUP,
        recipients: ['xiaoxue', 'laozhang'],
        sensitiveTokens: ['想辞职去旅行'],
        expiresAt: now + 86400000
    }, now);

    // 2. 授权成员（老张）视角预览：敏感片段被自动打码遮蔽
    const viewLaozhang = previewRecipientView(draft, 'laozhang', now);
    assert.equal(viewLaozhang.status, ACCESS_STATUS.MASKED_PARTIAL);
    assert.ok(viewLaozhang.content.includes('***'));
    assert.ok(!viewLaozhang.content.includes('想辞职去旅行'));

    // 3. 未授权圈层（小李）预览：直接拒止
    const viewXiaoli = previewRecipientView(draft, 'xiaoli', now);
    assert.equal(viewXiaoli.status, ACCESS_STATUS.UNAUTHORIZED);
    assert.equal(viewXiaoli.content, null);

    // 4. 老张查阅存证
    const readDraft = markRecipientRead(draft, 'laozhang', now + 5000);
    assert.equal(readDraft.readLogs.length, 1);
    assert.equal(readDraft.readLogs[0].readerId, 'laozhang');

    // 5. 撤回分享：未来访问阻断，但诚实保留已读痕迹
    const revoked = revokeShare(readDraft, '经小雪要求撤回', now + 10000);
    const viewAfterRevoke = previewRecipientView(revoked, 'laozhang', now + 12000);
    assert.equal(viewAfterRevoke.status, ACCESS_STATUS.REVOKED);
    assert.equal(viewAfterRevoke.content, null);
    assert.equal(revoked.readLogs.length, 1, '撤回绝不抹除老张撤回前的已读存证');
});