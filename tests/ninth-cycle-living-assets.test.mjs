import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionLivingAsset, ASSET_TRANSITION } from '../config/lineage-living-assets.js';

test('R9-X6 · 生活资产借用/失约/追回四态流转与持有人谱系', () => {
    let asset = {
        id: 'asset_camera',
        title: '老式胶片机',
        ownerId: 'alice',
        currentHolderId: 'alice',
        holderHistory: []
    };

    // 1. 借用给 Bob
    asset = transitionLivingAsset(asset, {
        action: ASSET_TRANSITION.BORROW,
        toActorId: 'bob',
        contractNote: '借用一周用于摄影展'
    });
    assert.equal(asset.currentHolderId, 'bob');
    assert.equal(asset.isUsageActive, true);
    assert.equal(asset.holderHistory.length, 1);

    // 2. Bob 失约未归还 -> 标记失约，使用权阻断
    asset = transitionLivingAsset(asset, {
        action: ASSET_TRANSITION.BREACH,
        toActorId: 'bob',
        contractNote: '逾期未归还'
    });
    assert.equal(asset.isUsageActive, false);

    // 3. 追回
    asset = transitionLivingAsset(asset, {
        action: ASSET_TRANSITION.RECOVER,
        toActorId: 'alice',
        contractNote: '委托好友取回'
    });
    assert.equal(asset.currentHolderId, 'alice');
    assert.equal(asset.isUsageActive, true);
    assert.equal(asset.holderHistory.length, 3);
});