import test from 'node:test';
import assert from 'node:assert/strict';

import { DynamicMomentsFeed, MOMENT_VISIBILITY } from '../config/dynamic-moments-feed.js';
import { ShareSheet } from '../phone/share-sheet.js';

test('R15-X5: 朋友圈分组可见与定向互动网络', () => {
    const feed = new DynamicMomentsFeed();
    
    // 1. 发布一条对 'adventurers' 分组可见的动态
    const post = feed.publishPost({
        authorId: 'alice',
        authorName: '爱丽丝',
        text: '秘密地下城集结！仅冒险者小队可见。',
        visibility: MOMENT_VISIBILITY.GROUP,
        allowedGroup: ['adventurers']
    });

    assert.equal(post.visibility, 'GROUP');
    assert.deepEqual(post.allowedGroup, ['adventurers']);

    // 2. 属于该分组的玩家可以看到
    const visibleForAdventurer = feed.getVisiblePosts('bob', 'adventurers');
    assert.ok(visibleForAdventurer.some(p => p.id === post.id), '同组角色应当可见该动态');

    // 3. 不属于该分组的局外人无法看到
    const visibleForCivilian = feed.getVisiblePosts('charlie', 'civilians');
    assert.ok(!visibleForCivilian.some(p => p.id === post.id), '局外角色绝不可见该动态');

    // 4. 作者本人无条件可见
    const visibleForAuthor = feed.getVisiblePosts('alice', 'any_group');
    assert.ok(visibleForAuthor.some(p => p.id === post.id), '作者本人始终可见自己发布的动态');

    // 负控制：篡改分组，使可见性判定翻转
    const mutatedPosts = feed.getVisiblePosts('bob', 'wrong_group');
    assert.ok(!mutatedPosts.some(p => p.id === post.id), '错误分组角色不可访问动态');
});

test('R15-O3: 跨 App 媒体分享中枢 ShareSheet 流转链路', async () => {
    const shareSheet = new ShareSheet();
    const targets = shareSheet.getAvailableTargets();
    
    assert.ok(targets.some(t => t.id === 'wechat_chat'));
    assert.ok(targets.some(t => t.id === 'moments'));
    assert.ok(targets.some(t => t.id === 'notes'));

    // 分享到聊天
    const chatShareResult = await shareSheet.shareTo('wechat_chat', {
        text: '看看这篇绝密笔记！',
        mediaUrl: 'assets/secret.png',
        targetContactId: 'contact_alice'
    });

    assert.equal(chatShareResult.success, true);
    assert.equal(chatShareResult.dispatchedPayload.text, '看看这篇绝密笔记！');
    assert.equal(chatShareResult.dispatchedPayload.contactId, 'contact_alice');

    // 负控制：分享到未注册的目标抛错
    await assert.rejects(async () => {
        await shareSheet.shareTo('unregistered_fake_app', {});
    }, /Share target not registered/);
});