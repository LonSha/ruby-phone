// tests/intent-relay-receipt.test.mjs — [R7-O1 + R7-O2] 意图接力台与行动回执定向门禁
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    IR_STAGES,
    IR_STEP_STATUS,
    IR_REASONS,
    createIntent,
    normalizeIntent,
    normalizeRelayLedger,
    advanceIntentStep,
    rollbackIntentStep,
    resolvePendingQuestion,
    dispatchNextAction,
    filterIntents,
    readIntents,
    writeIntents,
    upsertIntent,
    intentRelaySelfCheck
} from '../config/intent-relay.js';

import {
    AR_STATUS,
    AR_ORIGIN,
    AR_REASONS,
    buildRemedy,
    normalizeActionReceipt,
    normalizeReceiptList,
    planActionReceipt,
    cancelReceipt,
    readReceipts,
    writeReceipts,
    recordActionReceipt,
    actionReceiptSelfCheck
} from '../config/action-receipt.js';

// 内存版假 storage 实现
function makeFakeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        get(key) {
            return store.get(key) !== undefined ? store.get(key) : null;
        },
        async set(key, value) {
            store.set(key, JSON.parse(JSON.stringify(value)));
            return true;
        },
        _store: store
    };
}

test('R7-O1 · 结构自检与词表完整性', () => {
    const check = intentRelaySelfCheck();
    assert.deepEqual(check.problems, [], '自检不应有任何问题');
    assert.equal(Object.keys(IR_STAGES).length, 6, '阶段应有 6 态');
    assert.equal(Object.keys(IR_STEP_STATUS).length, 6, '步骤状态应有 6 态');
});

test('R7-O1 · 完整业务流程：微信发起 → 日历约时 → 商店采购 → 回微信确认', async () => {
    const storage = makeFakeStorage();

    // 1. 从微信发起意图
    const intent = createIntent({
        id: 'birthday_xiaoxue',
        title: '小雪生日惊喜企划',
        goal: '为小雪准备生日派对与礼物',
        source: { appId: 'wechat', refId: 'msg_1001', floor: 45 },
        participants: [{ id: 'user', name: '我', role: '发起人' }, { id: 'xiaoxue', name: '小雪', role: '主角' }],
        pendingQuestions: [
            { id: 'q_date', question: '选定派对日期' },
            { id: 'q_gift', question: '选定礼物款式' }
        ],
        steps: [
            { id: 's_date', title: '日历预约派对时段', target: { appId: 'calendar', tab: 'agenda' } },
            { id: 's_gift', title: '商店挑选并购买礼物', target: { appId: 'shop', tab: 'orders' } },
            { id: 's_confirm', title: '微信确认并发送邀请', target: { appId: 'wechat', tab: 'chat' } }
        ]
    });

    assert.equal(intent.stage, IR_STAGES.ACTIVE);
    assert.equal(intent.currentStepIndex, 0);

    // 派发第一步动作
    const action1 = dispatchNextAction(intent);
    assert.ok(action1);
    assert.equal(action1.appId, 'calendar');
    assert.equal(action1.intentRef.stepId, 's_date');
    assert.equal(action1.actionPayload.pendingQuestions.length, 2);

    // 2. 完成日历步骤并回写完成证据
    const step1Done = advanceIntentStep(intent, 's_date', {
        summary: '已预约 11月15日 晚上7点',
        calendarEventId: 'evt_20261115'
    });
    assert.ok(step1Done.ok);
    assert.equal(step1Done.intent.steps[0].status, IR_STEP_STATUS.DONE);
    assert.equal(step1Done.intent.currentStepIndex, 1);

    // 解决日期问题
    const q1Done = resolvePendingQuestion(step1Done.intent, 'q_date', '2026-11-15 19:00');
    assert.ok(q1Done.ok);

    // 3. 派发第二步动作（商店）
    const action2 = dispatchNextAction(q1Done.intent);
    assert.equal(action2.appId, 'shop');
    assert.equal(action2.intentRef.stepId, 's_gift');

    // 商店记采购完成
    const step2Done = advanceIntentStep(q1Done.intent, 's_gift', {
        summary: '已购买 星空八音盒',
        orderId: 'ord_98765',
        cost: 299
    });
    assert.ok(step2Done.ok);
    assert.equal(step2Done.intent.steps[1].status, IR_STEP_STATUS.DONE);
    assert.equal(step2Done.intent.currentStepIndex, 2);

    // 4. 派发第三步动作（微信确认）
    const action3 = dispatchNextAction(step2Done.intent);
    assert.equal(action3.appId, 'wechat');
    assert.equal(action3.intentRef.stepId, 's_confirm');

    // 微信确认完成
    const finalStep = advanceIntentStep(step2Done.intent, 's_confirm', {
        summary: '已在微信群发出邀请并得到小雪确认'
    });
    assert.ok(finalStep.ok);
    assert.equal(finalStep.intent.stage, IR_STAGES.COMPLETED);
    assert.equal(finalStep.intent.steps[2].status, IR_STEP_STATUS.DONE);

    // 持久化存储与重开验证
    await upsertIntent(storage, finalStep.intent);
    const reloaded = readIntents(storage);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].id, 'birthday_xiaoxue');
    assert.equal(reloaded[0].stage, IR_STAGES.COMPLETED);
    assert.equal(reloaded[0].steps[1].evidence.orderId, 'ord_98765');
});

test('R7-O1 · 安全回滚：撤销已选日期不误删已完成采购', () => {
    // 构造一个日历和采购都已完成的意图
    const intent = createIntent({
        id: 'birthday_rollback_test',
        title: '测试回滚事务',
        steps: [
            { id: 's_date', title: '选定日期', target: { appId: 'calendar' } },
            { id: 's_gift', title: '采购礼物', target: { appId: 'shop' } },
            { id: 's_venue', title: '预订场地', target: { appId: 'restaurant' } }
        ]
    });

    const step1 = advanceIntentStep(intent, 's_date', { date: '2026-11-15' }).intent;
    const step2 = advanceIntentStep(step1, 's_gift', { gift: '定制蛋糕', orderId: 'ord_cake_1' }).intent;

    assert.equal(step2.steps[0].status, IR_STEP_STATUS.DONE);
    assert.equal(step2.steps[1].status, IR_STEP_STATUS.DONE);

    // 用户发现日期有冲突，回滚到步骤 0（选定日期）重新决策
    const rolledBack = rollbackIntentStep(step2, 0, '发现周六小雪加班需改期');
    assert.ok(rolledBack.ok);
    assert.equal(rolledBack.intent.stage, IR_STAGES.ROLLED_BACK);
    assert.equal(rolledBack.intent.currentStepIndex, 0);

    // 验证：步骤 0 变为进行中，步骤 1（采购）被标记为 rolled_back 但采购证据保留！
    assert.equal(rolledBack.intent.steps[0].status, IR_STEP_STATUS.IN_PROGRESS);
    assert.equal(rolledBack.intent.steps[1].status, IR_STEP_STATUS.ROLLED_BACK);
    assert.equal(rolledBack.intent.steps[1].evidence.orderId, 'ord_cake_1', '已完成采购证据必须完好保留，不得误删');
});

test('R7-O1 · 并行两场生日事务不串线', async () => {
    const storage = makeFakeStorage();

    const intentXiaoxue = createIntent({
        id: 'birthday_xiaoxue',
        title: '小雪生日',
        source: { appId: 'wechat', contactId: 'xiaoxue' },
        steps: [{ id: 's1', title: '买花', target: { appId: 'shop' } }]
    });

    const intentMom = createIntent({
        id: 'birthday_mom',
        title: '妈妈生日',
        source: { appId: 'wechat', contactId: 'mom' },
        steps: [{ id: 's1', title: '订餐厅', target: { appId: 'restaurant' } }]
    });

    await upsertIntent(storage, intentXiaoxue);
    await upsertIntent(storage, intentMom);

    const all = readIntents(storage);
    assert.equal(all.length, 2);

    const filteredXiaoxue = filterIntents(all, { intentId: 'birthday_xiaoxue' });
    const filteredMom = filterIntents(all, { intentId: 'birthday_mom' });

    assert.equal(filteredXiaoxue.length, 1);
    assert.equal(filteredXiaoxue[0].title, '小雪生日');
    assert.equal(filteredMom.length, 1);
    assert.equal(filteredMom[0].title, '妈妈生日');
});

test('R7-O2 · 行动回执五态、归一与自检', () => {
    const check = actionReceiptSelfCheck();
    assert.deepEqual(check.problems, []);
    assert.equal(Object.keys(AR_STATUS).length, 5);

    const r1 = normalizeActionReceipt({
        id: 'rc_1',
        actionKey: 'cal:reschedule:evt_1',
        appId: 'calendar',
        status: AR_STATUS.SAVED,
        title: '已更新日程时间'
    });
    assert.equal(r1.status, AR_STATUS.SAVED);
    assert.equal(r1.origin, AR_ORIGIN.USER);
    assert.equal(r1.confirmed, true);
    assert.equal(r1.replayed, false);
});

test('R7-O2 · 幂等性：短时间内重复提交返回 replayed: true 且不产生副作用', async () => {
    const storage = makeFakeStorage();
    const draft = {
        actionKey: 'shop:checkout:cart_999',
        appId: 'shop',
        actionType: 'checkout',
        title: '购买生日礼物',
        detail: '扣除金币 199'
    };

    const res1 = await recordActionReceipt(storage, draft, 1000);
    assert.ok(res1.ok);
    assert.equal(res1.receipt.replayed, false);
    assert.equal(res1.saved, true);

    // 模拟快速重复点击（3 秒后）
    const res2 = await recordActionReceipt(storage, draft, 4000);
    assert.ok(res2.ok);
    assert.equal(res2.why, AR_REASONS.REPLAYED);
    assert.equal(res2.receipt.replayed, true, '短时间重复操作必须识别为幂等重放');

    const receipts = readReceipts(storage);
    assert.equal(receipts.length, 1, '账本中只能有一条原始扣款回执，不重复记录副作用');
});

test('R7-O2 · 失败补救：失败状态自动计算结构化 remedies 且可撤销', async () => {
    const storage = makeFakeStorage();
    const failDraft = {
        actionKey: 'calendar:book:room_conflicted',
        appId: 'calendar',
        actionType: 'book_room',
        status: AR_STATUS.RETRYABLE_FAILURE,
        title: '预约场地超时失败',
        detail: '网络抖动或包厢已被占用'
    };

    const res = await recordActionReceipt(storage, failDraft, 5000);
    assert.ok(res.ok);
    assert.equal(res.receipt.status, AR_STATUS.RETRYABLE_FAILURE);
    assert.ok(res.receipt.remedies.length >= 2, '失败状态必须提供补救方案');

    const retryRemedy = res.receipt.remedies.find(r => r.actionType === 'retry');
    const cancelRemedy = res.receipt.remedies.find(r => r.actionType === 'cancel');
    assert.ok(retryRemedy, '必须提供重试选项');
    assert.ok(cancelRemedy, '必须提供撤销选项');

    // 测试撤销
    const cancelRes = cancelReceipt([res.receipt], res.receipt.id, '用户决定改用户外公园');
    assert.ok(cancelRes.ok);
    assert.equal(cancelRes.receipt.status, AR_STATUS.CANCELLED);
    assert.ok(cancelRes.receipt.detail.includes('用户决定改用户外公园'));
});

import {
    RW_INTERRUPTION_CHANNELS,
    RW_ITEM_ACTIONS,
    RW_ITEM_STATUS,
    buildInterruptionDeck,
    transitionInterruptionItem
} from '../config/resume-workbench.js';

test('R7-O8 · 中断恢复工作台：三类事项归一、独立选择演进、项目隔离与复开防重', () => {
    const rawItems = [
        {
            id: 'item_msg_1',
            projectId: 'proj_novel',
            channel: RW_INTERRUPTION_CHANNELS.REQUIRES_RESPONSE,
            title: '编辑部催稿消息',
            detail: '编辑询问第 5 章进度',
            sourceAppId: 'wechat',
            targetTab: 'chat'
        },
        {
            id: 'item_draft_1',
            projectId: 'proj_novel',
            channel: RW_INTERRUPTION_CHANNELS.ACTIONABLE_RESUME,
            title: '第 5 章未完草稿',
            detail: '上次写到 1200 字',
            sourceAppId: 'editor',
            targetTab: 'edit'
        },
        {
            id: 'item_world_1',
            projectId: 'proj_novel',
            channel: RW_INTERRUPTION_CHANNELS.ENVIRONMENT_CHANGED,
            title: '角色关系变迁',
            detail: '小雪好感度因前序事件提升至 85',
            sourceAppId: 'profile',
            targetTab: 'relations'
        },
        {
            id: 'item_other_proj',
            projectId: 'proj_music',
            channel: RW_INTERRUPTION_CHANNELS.REQUIRES_RESPONSE,
            title: '未完成编曲工程',
            sourceAppId: 'musicdesk'
        }
    ];

    // 1. 构建卡组并验证项目隔离
    const deck = buildInterruptionDeck({ items: rawItems, projectId: 'proj_novel' });
    assert.equal(deck.requiresResponse.length, 1);
    assert.equal(deck.actionableResume.length, 1);
    assert.equal(deck.environmentChanged.length, 1);
    assert.equal(deck.totalPending, 3, '其它项目 proj_music 的事项已被严格隔离');

    // 2. 选择其一（进入处理第 5 章草稿），另两项保持原状态
    const enterRes = transitionInterruptionItem(deck, 'item_draft_1', RW_ITEM_ACTIONS.ENTER);
    assert.ok(enterRes.ok);
    assert.equal(enterRes.item.status, RW_ITEM_STATUS.ENTERED);
    assert.equal(enterRes.openDetail.appId, 'editor');
    assert.equal(enterRes.openDetail.tab, 'edit');

    // 验证：下一轮 deck 中已排除已进入项，而 requiresResponse 与 environmentChanged 完好保持！
    assert.equal(enterRes.nextDeck.requiresResponse.length, 1);
    assert.equal(enterRes.nextDeck.environmentChanged.length, 1);
    assert.equal(enterRes.nextDeck.actionableResume.length, 0);
    assert.equal(enterRes.nextDeck.totalPending, 2);

    // 3. 对编辑部消息执行略过 (dismiss)
    const dismissRes = transitionInterruptionItem(enterRes.nextDeck, 'item_msg_1', RW_ITEM_ACTIONS.DISMISS);
    assert.ok(dismissRes.ok);
    assert.equal(dismissRes.nextDeck.totalPending, 1);

    // 4. 复开防重测试：将已确认的 ID 传入 buildInterruptionDeck，复开不再重复报告已确认条目
    const confirmedIds = [enterRes.confirmedId, dismissRes.confirmedId];
    const deckReopened = buildInterruptionDeck({ items: rawItems, confirmedIds, projectId: 'proj_novel' });
    assert.equal(deckReopened.totalPending, 1);
    assert.equal(deckReopened.environmentChanged[0].id, 'item_world_1');
    assert.equal(deckReopened.requiresResponse.length, 0, '已 dismiss 的消息不再重复呈现');
    assert.equal(deckReopened.actionableResume.length, 0, '已 enter 的草稿不再重复呈现');
});
