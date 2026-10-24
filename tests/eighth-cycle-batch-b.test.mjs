/* ========================================================
 * tests/eighth-cycle-batch-b.test.mjs — 第八期批次 B 综合测试
 * --------------------------------------------------------
 * 覆盖：
 *   - R8-O2 · 可逆行动栈（action-stack.js）
 *   - R8-O7 · 授权继承与到期（auth-expiration.js）
 *   - R8-O8 · 本地恢复中心（recovery-hub.js）
 *   - R8-X3 · 有因果的城市经济（urban-economy.js）
 *   - R8-X4 · 可变化的角色居所（character-dwelling.js）
 *   - R8-X6 · 可交易的生活资产（living-assets.js）
 * ======================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ACTION_STATUS,
    normalizeActionStack,
    pushAction,
    undoAction
} from '../config/action-stack.js';

import {
    GRANT_STATUS,
    AUTH_SCOPES,
    normalizeAuthState,
    issueGrant,
    checkPermission,
    revokeGrant
} from '../config/auth-expiration.js';

import {
    normalizeRecoveryState,
    createSnapshot,
    computeSnapshotDiff,
    restoreSnapshot
} from '../config/recovery-hub.js';

import {
    normalizeEconomyState,
    evaluateTransaction,
    executeTransaction
} from '../config/urban-economy.js';

import {
    normalizeDwellingState,
    placeItemInRoom,
    inspectRoomItem
} from '../config/character-dwelling.js';

import {
    LIVING_ASSET_KINDS,
    normalizeLivingAssetState,
    mintAsset,
    transferAsset
} from '../config/living-assets.js';

test('R8-O2 · 可逆行动栈：动作入栈、单步撤销与不可逆操作保护', () => {
    let state = normalizeActionStack(null);

    // 1. 压入可撤销动作（改期）
    const a1 = pushAction(state, {
        appId: 'calendar',
        actionType: 'reschedule_event',
        description: '会议推迟一小时',
        rollbackData: { eventId: 'evt_01', prevTime: 1000 }
    });
    assert.equal(a1.success, true);
    state = a1.state;

    // 2. 压入不可逆动作（发布作品）
    const a2 = pushAction(state, {
        appId: 'creation-project',
        actionType: 'publish_chapter',
        description: '公开发布第一章',
        canUndo: false,
        compensationSuggestion: '请前往创作者后台进行下架处理'
    });
    assert.equal(a2.success, true);
    assert.equal(a2.action.status, ACTION_STATUS.IRREVERSIBLE);
    state = a2.state;

    // 3. 执行撤销（智能跳过不可逆动作，撤销栈顶可撤销的改期操作）
    const undoRes = undoAction(state);
    assert.equal(undoRes.success, true);
    assert.equal(undoRes.undoneAction.appId, 'calendar');
    assert.equal(undoRes.rollbackData.eventId, 'evt_01');

    // 4. 重复撤销防护
    const undoRes2 = undoAction(undoRes.state, a1.action.id);
    assert.equal(undoRes2.success, false);
    assert.equal(undoRes2.reason, 'already-undone');
});

test('R8-O7 · 授权继承与到期：时效控制、继承链路与级联失效', () => {
    let state = normalizeAuthState(null);
    const now = 10000;

    // 1. 签发母授权（查看日历，1000秒有效）
    const g1 = issueGrant(state, {
        id: 'grant_calendar_root',
        granteeId: 'char_assistant',
        scope: AUTH_SCOPES.READ_CALENDAR,
        validUntil: now + 1000
    });
    assert.equal(g1.success, true);
    state = g1.state;

    // 2. 派生子授权（查看创作，继承自母授权）
    const g2 = issueGrant(state, {
        id: 'grant_creation_child',
        granteeId: 'char_assistant',
        scope: AUTH_SCOPES.READ_CREATION,
        inheritedFrom: 'grant_calendar_root'
    });
    assert.equal(g2.success, true);
    state = g2.state;

    // 3. 校验有效性
    assert.equal(checkPermission(state, 'char_assistant', AUTH_SCOPES.READ_CREATION, now + 500).allowed, true);

    // 4. 超时后子授权随之失效
    assert.equal(checkPermission(state, 'char_assistant', AUTH_SCOPES.READ_CREATION, now + 1500).allowed, false);

    // 5. 撤销母授权，子授权级联撤销
    const revokeRes = revokeGrant(state, 'grant_calendar_root');
    assert.equal(revokeRes.success, true);
    assert.ok(revokeRes.revokedIds.includes('grant_creation_child'));
});

test('R8-O8 · 本地恢复中心：快照创建、精细差异比对与受控还原', () => {
    let state = normalizeRecoveryState(null);

    const baseData = {
        'memo_note_1': '重要备忘',
        'calendar_evt_1': '开会'
    };

    // 1. 创建备份快照
    const snapRes = createSnapshot(state, '手动备份点A', baseData);
    assert.equal(snapRes.success, true);
    state = snapRes.state;

    // 2. 模拟当前数据发生变更与新增
    const modifiedData = {
        'memo_note_1': '重要备忘已修改',
        'calendar_evt_2': '新增日程'
        // calendar_evt_1 已被删除
    };

    const diff = computeSnapshotDiff(snapRes.snapshot, modifiedData);
    assert.equal(diff.diffCount, 3);
    assert.ok(diff.modified.includes('memo_note_1'));
    assert.ok(diff.added.includes('calendar_evt_2'));
    assert.ok(diff.removed.includes('calendar_evt_1'));

    // 3. 受控还原：仅还原 memo_note_1
    const restoreRes = restoreSnapshot(snapRes.snapshot, ['memo_note_1']);
    assert.equal(restoreRes.success, true);
    assert.equal(restoreRes.restoredKeyCount, 1);
    assert.equal(restoreRes.restoredData['memo_note_1'], '重要备忘');
});

test('R8-X3 · 有因果的城市经济：交易评估、信任门槛与声誉累积', () => {
    let state = normalizeEconomyState(null);
    state.balances = { currency: 500, trust: 20 };

    // 1. 尝试交易：所需信任不够
    const txHighTrust = {
        costCurrency: 100,
        requiredTrust: 50
    };
    const check1 = evaluateTransaction(state, txHighTrust);
    assert.equal(check1.feasible, false);
    assert.equal(check1.reason, 'insufficient-trust');

    // 2. 成功交易：购买入门道具并增加声誉
    const txOk = {
        id: 'tx_coffee_shop',
        title: '老街咖啡馆买咖啡',
        costCurrency: 30,
        requiredTrust: 10,
        gainTrust: 5,
        locationId: 'old_street_cafe'
    };
    const execRes = executeTransaction(state, txOk);
    assert.equal(execRes.success, true);
    assert.equal(execRes.state.balances.currency, 470);
    assert.equal(execRes.state.balances.trust, 25);
    assert.equal(execRes.state.locationReputation['old_street_cafe'], 1);
});

test('R8-X4 · 可变化的角色居所：布置摆件、回忆共鸣与上限维护', () => {
    let state = normalizeDwellingState(null);

    // 1. 放置音乐盒
    const placeRes = placeItemInRoom(state, 'room_alice', {
        id: 'item_music_box',
        name: '八音盒',
        slot: 'shelf',
        originEvent: '游乐园告别',
        reminiscenceSnippet: '轻柔的旋律响起时，总会想起那个微风拂过的黄昏。'
    });
    assert.equal(placeRes.success, true);
    state = placeRes.state;

    // 2. 检视摆件
    const inspectRes = inspectRoomItem(state, 'room_alice', 'item_music_box');
    assert.equal(inspectRes.found, true);
    assert.ok(inspectRes.narrativeSnippet.includes('黄昏'));
});

test('R8-X6 · 可交易的生活资产：资产铸造、完整权属链与转让验证', () => {
    let state = normalizeLivingAssetState(null);

    // 1. 登记一份作品原稿
    const mintRes = mintAsset(state, {
        id: 'art_poem_draft',
        title: '致夜空的长诗手稿',
        kind: LIVING_ASSET_KINDS.ARTWORK,
        owner: 'user',
        note: '在深夜书桌前完成的原稿'
    });
    assert.equal(mintRes.success, true);
    state = mintRes.state;

    // 2. 非所有者转让报错
    const badTransfer = transferAsset(state, 'art_poem_draft', 'stranger', 'char_alice', '转让');
    assert.equal(badTransfer.success, false);
    assert.equal(badTransfer.reason, 'owner-mismatch');

    // 3. 正式转让给 Alice
    const okTransfer = transferAsset(state, 'art_poem_draft', 'user', 'char_alice', '赠予珍藏');
    assert.equal(okTransfer.success, true);
    assert.equal(okTransfer.asset.currentOwner, 'char_alice');
    assert.equal(okTransfer.asset.provenanceChain.length, 2);
    assert.equal(okTransfer.asset.provenanceChain[1].to, 'char_alice');
});