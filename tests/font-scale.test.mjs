import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFontScaleManager } from '../phone/font-scale.js';

const DEPS = {
    ST_PHONE_VERSION: '2.8.13',
    ST_PHONE_CSS_REVISION: 'test-rev',
    ST_PHONE_GLOBAL_CSS_URL: './phone.css',
};
const mk = () => createFontScaleManager(DEPS);

test('createFontScaleManager: 暴露全部 18 个方法', () => {
    const m = mk();
    const methods = ['setStorage','normalizePhoneShellScalePercent','applyPhoneShellScale',
        'normalizePhoneFontScalePercent','isProtectedPhoneFontElement','hasDirectPhoneText',
        'shouldScalePhoneFontElement','restorePhoneFontEntry','capturePhoneFontEntry',
        'rescanGlobalPhoneFonts','renderGlobalPhoneFontScale','requestGlobalPhoneFontScaleRender',
        'applyGlobalFontScale','refreshGlobalFontScale','ensureGlobalTextColorOverrideStyle',
        'applyGlobalTextColor','initColors','ensureGlobalPhoneCSS'];
    for (const name of methods) assert.equal(typeof m[name], 'function', `缺方法 ${name}`);
});

// ===== normalize 纯函数（无 DOM 依赖，可独立测）=====
test('normalizePhoneShellScalePercent: 边界钳制 80-120', () => {
    const m = mk();
    assert.equal(m.normalizePhoneShellScalePercent(100), 100);
    assert.equal(m.normalizePhoneShellScalePercent(50), 80);
    assert.equal(m.normalizePhoneShellScalePercent(200), 120);
    assert.equal(m.normalizePhoneShellScalePercent(95.4), 95);
});
test('normalizePhoneShellScalePercent: 非有限值回退 100', () => {
    const m = mk();
    assert.equal(m.normalizePhoneShellScalePercent('abc'), 100);
    assert.equal(m.normalizePhoneShellScalePercent(NaN), 100);
    assert.equal(m.normalizePhoneShellScalePercent(undefined), 100);
});
test('normalizePhoneFontScalePercent: 边界钳制 70-130', () => {
    const m = mk();
    assert.equal(m.normalizePhoneFontScalePercent(100), 100);
    assert.equal(m.normalizePhoneFontScalePercent(10), 70);
    assert.equal(m.normalizePhoneFontScalePercent(999), 130);
    assert.equal(m.normalizePhoneFontScalePercent(115.6), 116);
});
test('normalizePhoneFontScalePercent: 非有限值回退 100', () => {
    const m = mk();
    assert.equal(m.normalizePhoneFontScalePercent('xyz'), 100);
    assert.equal(m.normalizePhoneFontScalePercent(null), 100);
});

// ===== storage 依赖方法在未注入时的行为（DOM 缺失环境下安全失败）=====
test('initColors: node 无 DOM 环境调用会抛（document 未定义），佐证依赖 DOM', () => {
    const m = mk();
    m.setStorage({ get: () => '' });
    // node 无 document，预期抛 ReferenceError —— 证明该函数确为 DOM 依赖型
    assert.throws(() => m.initColors(), ReferenceError);
});
test('模块纯函数子集可在无 DOM 环境独立测试', () => {
    // 这是模块化拆解的核心收益：normalize 系列不再被困在浏览器闭包里
    const m = mk();
    assert.doesNotThrow(() => {
        m.normalizePhoneShellScalePercent(110);
        m.normalizePhoneFontScalePercent(90);
    });
});