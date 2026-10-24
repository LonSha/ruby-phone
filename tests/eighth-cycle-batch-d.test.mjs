/* ========================================================
 * tests/eighth-cycle-batch-d.test.mjs — 第八期批次 D 综合测试
 * --------------------------------------------------------
 * 覆盖：
 *   - R8-O9 · 触摸与可读性基线（touch-readability-baseline.js）
 *   - R8-X8 · 手机内生创作者生态（creator-bundle-ecosystem.js）
 *   - R8-X9 · 双人共建的手机世界（co-built-world.js）
 * ======================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    VIEWPORT_MODES,
    normalizeReadabilitySettings,
    evaluateViewport,
    generateReadabilityStyle
} from '../config/touch-readability-baseline.js';

import {
    normalizeBundleEcosystemState,
    buildCreatorBundle,
    inspectBundleDependencies,
    installBundleSelective,
    uninstallBundle
} from '../config/creator-bundle-ecosystem.js';

import {
    WORLD_PROPOSAL_STATUS,
    normalizeCoBuiltWorldState,
    proposeWorldChange,
    adjudicateWorldProposal,
    getCoBuiltWorldChronicle
} from '../config/co-built-world.js';

test('R8-O9 · 触摸与可读性基线：小屏适配、减弱动画与高可读排版', () => {
    // 1. 小屏 (360px) 视口判定为 NARROW 模式
    const vpNarrow = evaluateViewport(360);
    assert.equal(vpNarrow.mode, VIEWPORT_MODES.NARROW);
    assert.equal(vpNarrow.maxInlineColumns, 1);

    // 2. 宽屏 (1024px) 视口判定为 EXPANDED 模式
    const vpWide = evaluateViewport(1024);
    assert.equal(vpWide.mode, VIEWPORT_MODES.EXPANDED);
    assert.equal(vpWide.maxInlineColumns, 3);

    // 3. 阅读偏好设置：放大字体、减弱动画、高对比度
    let settings = normalizeReadabilitySettings({
        fontScale: 1.2,
        reducedMotion: true,
        highContrast: true
    });
    assert.equal(settings.fontScale, 1.2);
    assert.equal(settings.reducedMotion, true);

    const style = generateReadabilityStyle(settings);
    assert.equal(style.cssVars['--phone-transition-duration'], '0ms'); // 动画停用
    assert.ok(style.classList.includes('reduced-motion'));
    assert.ok(style.classList.includes('high-contrast'));
    assert.equal(style.isAccessible, true);
});

test('R8-X8 · 手机内生创作者生态：组合包打包、依赖检视、选择性安装与卸载', () => {
    let state = normalizeBundleEcosystemState(null);

    // 1. 创作者制作一个扩展包（包含主题、规则和依赖 memo 的工作包）
    const bundleRes = buildCreatorBundle({
        id: 'bundle_cozy_night',
        title: '温馨深夜创作者拓展包',
        version: '1.2.0',
        author: 'char_alice',
        themes: [{ id: 'night_theme', name: '夜空蓝' }],
        rules: [{ id: 'rule_night_quiet', name: '夜间静音' }],
        workPackages: [{
            id: 'pkg_night_note',
            title: '睡前随手记',
            steps: [{ appId: 'memo', title: '随想录入' }, { appId: 'player', title: '播放白噪音' }]
        }]
    });
    assert.equal(bundleRes.success, true);
    const bundle = bundleRes.bundle;

    // 2. 检视依赖：当前环境缺少 'player' App
    const depCheck = inspectBundleDependencies(bundle, ['memo', 'chat']);
    assert.equal(depCheck.valid, true);
    assert.equal(depCheck.hasMissingDependencies, true);
    assert.equal(depCheck.missingApps[0].appId, 'player');

    // 3. 接收者选择性安装：只安装 themes 与 rules，跳过工作包
    const instRes = installBundleSelective(state, bundle, ['themes', 'rules']);
    assert.equal(instRes.success, true);
    state = instRes.state;
    assert.equal(state.installedBundles['bundle_cozy_night'].installedComponents.themes.length, 1);
    assert.equal(state.installedBundles['bundle_cozy_night'].installedComponents.workPackages, undefined);

    // 4. 卸载扩展包
    const uninstRes = uninstallBundle(state, 'bundle_cozy_night');
    assert.equal(uninstRes.success, true);
    assert.equal(uninstRes.state.installedBundles['bundle_cozy_night'], undefined);
});

test('R8-X9 · 双人共建的手机世界：角色形态建议、共同历史演化与审批', () => {
    let state = normalizeCoBuiltWorldState(null);
    const now = 1700000000000;

    // 1. Alice 主动提出居所装饰建议
    const propRes = proposeWorldChange(state, {
        id: 'prop_alice_plant',
        proposer: 'char_alice',
        category: 'dwelling',
        summary: '在阳台角落摆放一盆喜阴的长春藤',
        suggestedPayload: { itemId: 'plant_ivy', location: 'balcony' }
    }, now);
    assert.equal(propRes.success, true);
    state = propRes.state;

    // 2. 用户审核并批准采纳
    const adjRes = adjudicateWorldProposal(
        state,
        'prop_alice_plant',
        WORLD_PROPOSAL_STATUS.ACCEPTED,
        '非常好的提议，给房间增添了一抹生机。',
        now + 1000
    );
    assert.equal(adjRes.success, true);
    state = adjRes.state;
    assert.equal(state.proposals['prop_alice_plant'].status, WORLD_PROPOSAL_STATUS.ACCEPTED);

    // 3. 校验演化纪要
    const chronicle = getCoBuiltWorldChronicle(state);
    assert.equal(chronicle.totalProposals, 1);
    assert.equal(chronicle.acceptedCount, 1);
    assert.equal(chronicle.history[0].proposer, 'char_alice');
    assert.ok(chronicle.history[0].userFeedback.includes('一抹生机'));
});