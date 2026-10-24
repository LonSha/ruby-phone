import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIFF_TYPES,
    computeParagraphDiff
} from '../config/diff-review-pipeline.js';

test('R9-O6 · 段落差异比对与锁定保护生效', () => {
    const base = ['第一段：原著开头', '第二段：受保护的人工手填设定', '第三段：旧结局'];
    const incoming = ['第一段：原著开头', '第二段：模型擅自修改的设定', '第三段：新结局', '第四段：全新补充'];

    // 锁定下标 1（第二段）
    const res = computeParagraphDiff(base, incoming, { lockedIndices: [1] });
    assert.equal(res.hasModifications, true);
    assert.equal(res.diffs.length, 4);

    // 验证锁定标记
    assert.equal(res.diffs[1].type, DIFF_TYPES.MODIFIED);
    assert.equal(res.diffs[1].isLocked, true);

    // 验证第四段为新增
    assert.equal(res.diffs[3].type, DIFF_TYPES.ADDED);
});