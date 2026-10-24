import test from 'node:test';
import assert from 'node:assert/strict';
import { auditJourneyReadability } from '../config/touch-interaction-journey-audit.js';

test('R9-O9 · 真实触控与可读性旅程收口校验', () => {
    // 正常场景
    const okRes = auditJourneyReadability('messages', {
        targetWidth: 48,
        targetHeight: 48,
        viewportWidth: 375
    });
    assert.equal(okRes.passed, true);
    assert.equal(okRes.errors.length, 0);

    // 小热区拦截
    const smallTargetRes = auditJourneyReadability('studio', {
        targetWidth: 32,
        targetHeight: 32,
        viewportWidth: 375
    });
    assert.equal(smallTargetRes.passed, false);
    assert.equal(smallTargetRes.errors[0].code, 'TOUCH_TARGET_TOO_SMALL');

    // 窄屏横向溢出警告
    const overflowRes = auditJourneyReadability('calendar', {
        targetWidth: 44,
        targetHeight: 44,
        viewportWidth: 320,
        contentWidth: 360
    });
    assert.equal(overflowRes.passed, true);
    assert.equal(overflowRes.warnings.length, 1);
    assert.equal(overflowRes.warnings[0].code, 'NARROW_VIEWPORT_HORIZONTAL_OVERFLOW');
});