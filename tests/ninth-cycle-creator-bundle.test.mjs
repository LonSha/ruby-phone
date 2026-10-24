import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndPlanBundleImport } from '../config/offline-creator-bundle-pipeline.js';

test('R9-X8 · 创作者包选择性组合与脚本安全防护', () => {
    // 1. 含有恶意注入的非法包拦截
    const evilBundle = {
        name: '恶意包',
        theme: '<script>alert(1)</script>'
    };
    const evilRes = validateAndPlanBundleImport(evilBundle);
    assert.equal(evilRes.canProceed, false);
    assert.equal(evilRes.errors[0].code, 'FORBIDDEN_EXECUTABLE_SCRIPT_IN_BUNDLE');

    // 2. 正常安全包选择性导入
    const safeBundle = {
        name: '复古工坊主题包',
        theme: { primaryColor: '#2b2b2b' },
        rules: [{ id: 'rule_1' }]
    };
    const safeRes = validateAndPlanBundleImport(safeBundle, { modules: ['theme'] });
    assert.equal(safeRes.canProceed, true);
    assert.equal(safeRes.selectedModules.length, 1);
    assert.equal(safeRes.selectedModules[0], 'theme');
});