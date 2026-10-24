import test from 'node:test';
import assert from 'node:assert/strict';
import { processSerialIssueState } from '../config/joint-media-serial-studio.js';

test('R9-X5 · 共创连载节目审稿与争议留痕', () => {
    const issue = { id: 'issue_vol1', stage: 'delegation', reviews: [] };

    // 进入审稿阶段并附带反对返修意见
    const res1 = processSerialIssueState(issue, {
        targetStage: 'review',
        reviewerId: 'bob',
        isApproved: false,
        dissentNote: '第二幕节奏过慢需要删减',
        reviewFeedback: true
    });

    assert.equal(res1.success, true);
    assert.equal(res1.stage, 'review');
    assert.equal(res1.reviews.length, 1);
    assert.equal(res1.reviews[0].isApproved, false);
    assert.equal(res1.reviews[0].dissentNote, '第二幕节奏过慢需要删减');

    // 终审通过进入发布
    const res2 = processSerialIssueState(res1, {
        targetStage: 'published',
        reviewerId: 'alice',
        isApproved: true,
        reviewFeedback: true
    });
    assert.equal(res2.stage, 'published');
    assert.equal(res2.reviews.length, 2);
});