import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createResumeAnchor,
    resolveAnchorLocation,
    syncWorkspaceAnchors
} from '../config/multiproject-resume-anchor.js';

test('R9-O3 · 细粒度续办锚点创建与草稿携带', () => {
    const raw = {
        anchorId: 'anc-note-chapter-4',
        app: 'notes',
        targetType: 'paragraph',
        targetId: 'p-12',
        cursorOffset: 45,
        uncommittedDraft: '未保存的伏笔记录...'
    };

    const anchor = createResumeAnchor(raw);
    assert.equal(anchor.anchorId, 'anc-note-chapter-4');
    assert.equal(anchor.app, 'notes');
    assert.equal(anchor.targetType, 'paragraph');
    assert.equal(anchor.targetId, 'p-12');
    assert.equal(anchor.cursorOffset, 45);
    assert.equal(anchor.uncommittedDraft, '未保存的伏笔记录...');
});

test('R9-O3 · 锚点有效性定位与目标删除后优雅降级', () => {
    const anchor = createResumeAnchor({
        anchorId: 'anc-wechat-topic',
        app: 'wechat',
        targetType: 'thread_topic',
        targetId: 'topic-99'
    });

    // 目标存在：精准命中
    const res1 = resolveAnchorLocation(anchor, ['topic-98', 'topic-99', 'topic-100']);
    assert.equal(res1.ok, true);
    assert.equal(res1.status, 'exact_match');
    assert.equal(res1.anchor.targetId, 'topic-99');

    // 目标不存在（已删除）：降级回退
    const res2 = resolveAnchorLocation(anchor, ['topic-01', 'topic-02']);
    assert.equal(res2.ok, true);
    assert.equal(res2.status, 'degraded_fallback');
    assert.equal(res2.anchor.degraded, true);
    assert.equal(res2.anchor.targetId, null);
    assert.equal(res2.anchor.targetType, 'view');
});

test('R9-O3 · 多锚点并发同步与置顶保护', () => {
    const a1 = createResumeAnchor({ anchorId: 'a1', app: 'notes', pinned: true });
    const a2 = createResumeAnchor({ anchorId: 'a2', app: 'calendar', pinned: false });

    let list = syncWorkspaceAnchors([], a1);
    list = syncWorkspaceAnchors(list, a2);

    assert.equal(list.length, 2);
    // a1 置顶，必定排在最前
    assert.equal(list[0].anchorId, 'a1');
});