/* ========================================================
 * tests/eighth-cycle-batch-a.test.mjs — 第八期批次 A 综合测试
 * --------------------------------------------------------
 * 覆盖：
 *   - R8-O1 · 手机使用范式（usage-paradigm.js）
 *   - R8-O3 · 原位续办（resume-anchor.js）
 *   - R8-O4 · 人物回应节奏（response-cadence.js）
 *   - R8-X1 · 主题包（theme-pack.js）
 *   - R8-X2 · 规则剧场（rule-theatre.js）
 * ======================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PARADIGM_IDS,
    DEFAULT_PARADIGMS,
    normalizeParadigmState,
    resolveActiveParadigm,
    switchParadigm,
    saveCustomParadigm,
    resolveAppOrder,
    filterNoticesByParadigm
} from '../config/usage-paradigm.js';

import {
    ANCHOR_TYPES,
    ANCHOR_STATUS,
    normalizeAnchorState,
    recordAnchor,
    resolveAnchorLocation,
    transitionAnchorStatus
} from '../config/resume-anchor.js';

import {
    CADENCE_STATES,
    CADENCE_REMEDIES,
    normalizeCadenceState,
    evaluateCadence,
    createMissedPacket,
    consumeMissedPacket
} from '../config/response-cadence.js';

import {
    THEME_PRESETS,
    validateThemePack,
    normalizeThemeState,
    applyTheme,
    previewTheme,
    rollbackTheme
} from '../config/theme-pack.js';

import {
    RULE_TRIGGERS,
    RULE_OPERATORS,
    RULE_ACTIONS,
    validateRuleSpec,
    normalizeRuleState,
    registerRule,
    evaluateEvent
} from '../config/rule-theatre.js';

test('R8-O1 · 手机使用范式：预设、自定义与应用展示权重重排', () => {
    let state = normalizeParadigmState(null);
    assert.equal(state.activeId, PARADIGM_IDS.LIFE);

    // 1. 切换为创意创作范式
    const switchRes = switchParadigm(state, PARADIGM_IDS.CREATIVE, { reason: 'writing_session' });
    assert.equal(switchRes.success, true);
    assert.equal(switchRes.current, PARADIGM_IDS.CREATIVE);
    state = switchRes.state;

    // 2. 检查应用排序（创作类优先，记账生活类靠后）
    const sampleApps = [
        { id: 'accounting', name: '记账' },
        { id: 'creation-project', name: '长篇创作' },
        { id: 'memo', name: '备忘录' },
        { id: 'health', name: '健康' }
    ];
    const ordered = resolveAppOrder(sampleApps, resolveActiveParadigm(state));
    assert.equal(ordered[0].id, 'creation-project');
    assert.equal(ordered[1].id, 'memo');
    assert.equal(ordered[ordered.length - 1].id, 'health');

    // 3. 自定义范式
    const customRes = saveCustomParadigm(state, {
        id: 'night_reading',
        name: '夜间精读',
        priorityApps: ['reading-studio', 'memo'],
        deprioritizedApps: ['wechat'],
        noticeThreshold: 'urgent_only'
    });
    assert.equal(customRes.success, true);
    state = customRes.state;

    const switchCustom = switchParadigm(state, 'night_reading');
    assert.equal(switchCustom.success, true);
    assert.equal(resolveActiveParadigm(switchCustom.state).noticeThreshold, 'urgent_only');

    // 4. 通知过滤
    const notices = [
        { id: 1, title: '常规动态', level: 'normal' },
        { id: 2, title: '紧急来电', level: 'urgent' }
    ];
    const filtered = filterNoticesByParadigm(notices, resolveActiveParadigm(switchCustom.state));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 2);
});

test('R8-O3 · 原位续办：精确定位、多项目并行与失效降级', () => {
    let state = normalizeAnchorState(null);

    // 1. 记录段落续办点与议题续办点
    const a1 = recordAnchor(state, {
        appId: 'creation-project',
        type: ANCHOR_TYPES.PARAGRAPH,
        targetId: 'ch_01_p15',
        title: '第一章第十五段修辞润色',
        contextSnippet: '窗外雨声渐息，烛火微微晃动……',
        cursorOffset: 120
    });
    assert.equal(a1.success, true);
    state = a1.state;

    const a2 = recordAnchor(state, {
        appId: 'wechat',
        type: ANCHOR_TYPES.TOPIC,
        targetId: 'topic_dinner_time',
        title: '周末晚饭碰头时间',
        contextSnippet: '你觉得选周六还是周日？'
    });
    assert.equal(a2.success, true);
    state = a2.state;

    // 2. 校验有效性（目标存在时正确定位）
    const check1 = resolveAnchorLocation(a1.anchor, {
        'creation-project': ['ch_01_p15', 'ch_01_p16']
    });
    assert.equal(check1.valid, true);
    assert.equal(check1.destination.cursorOffset, 120);

    // 3. 校验失效降级（目标已被删除时给出友善替代）
    const checkDeleted = resolveAnchorLocation(a1.anchor, {
        'creation-project': ['ch_01_p16'] // p15 已删
    });
    assert.equal(checkDeleted.valid, false);
    assert.equal(checkDeleted.reason, 'target-entity-missing-or-deleted');
    assert.equal(checkDeleted.fallback.appId, 'creation-project');

    // 4. 推进状态至 RESOLVED
    const resolved = transitionAnchorStatus(state, a1.anchor.id, ANCHOR_STATUS.RESOLVED);
    assert.equal(resolved.success, true);
    assert.equal(resolved.state.anchors[a1.anchor.id].status, ANCHOR_STATUS.RESOLVED);
});

test('R8-O4 · 人物回应节奏：时间环境、忙碌延时与漏接上下文', () => {
    // 1. 夜间时段判定
    const nightEval = evaluateCadence('char_alice', {}, { currentHour: 23 });
    assert.equal(nightEval.cadenceState, CADENCE_STATES.NIGHT_QUIET);
    assert.ok(nightEval.recommendedRemedies.includes(CADENCE_REMEDIES.LEAVE_VOICEMAIL));

    // 2. 白天忙碌状态
    const busyEval = evaluateCadence('char_alice', { statusTag: 'busy' }, { currentHour: 14 });
    assert.equal(busyEval.cadenceState, CADENCE_STATES.DELAYED_BUSY);
    assert.ok(busyEval.estimatedWaitMinutes >= 30);

    // 3. 创建与接续漏接包裹
    let cadenceState = normalizeCadenceState(null);
    const packetRes = createMissedPacket(cadenceState, {
        characterId: 'char_alice',
        topic: '关于下周演出的曲目安排',
        lastMessageSnippet: '我们先定第一首还是第二首？'
    });
    assert.equal(packetRes.success, true);
    cadenceState = packetRes.state;

    // 接续包裹
    const resumeRes = consumeMissedPacket(cadenceState, packetRes.packet.id);
    assert.equal(resumeRes.success, true);
    assert.equal(resumeRes.resumedTopic, '关于下周演出的曲目安排');
    assert.equal(resumeRes.state.missedContexts[packetRes.packet.id].consumed, true);
});

test('R8-X1 · 主题包：预设加载、严格防御校验、预览与安全回滚', () => {
    let state = normalizeThemeState(null);
    assert.equal(state.activeThemeId, 'obsidian_pure');

    // 1. 应用极光浅柔主题
    const applyRes = applyTheme(state, 'aurora_pastel');
    assert.equal(applyRes.success, true);
    assert.equal(applyRes.appliedThemeId, 'aurora_pastel');
    state = applyRes.state;

    // 2. 预览生成 CSS 变量
    const previewRes = previewTheme(THEME_PRESETS.WARM_RETRO);
    assert.equal(previewRes.success, true);
    assert.ok(previewRes.cssVariables['--phone-bg-primary']);

    // 3. 防御校验：拦截非法脚本或畸形颜色
    const maliciousManifest = {
        id: 'bad_theme',
        name: 'Bad Theme',
        palette: {
            bgPrimary: 'red; evilScript()',
            bgSurface: '#ffffff',
            textPrimary: '#000000',
            accent: '#123456'
        }
    };
    const invalidCheck = validateThemePack(maliciousManifest);
    assert.equal(invalidCheck.valid, false);

    // 4. 回滚主题
    const rolled = rollbackTheme(state);
    assert.equal(rolled.success, true);
    assert.equal(rolled.appliedThemeId, 'obsidian_pure');
});

test('R8-X2 · 规则剧场：白名单编排、条件评估与事件驱动执行', () => {
    let state = normalizeRuleState(null);

    // 1. 注册一条规则：当收到 Alice 的消息且内容包含“紧急”时，建议提议高优先级提醒
    const ruleSpec = {
        id: 'rule_alice_urgent',
        name: 'Alice 紧急消息自动标记',
        trigger: RULE_TRIGGERS.MESSAGE_RECEIVED,
        conditions: [
            { field: 'sender', operator: RULE_OPERATORS.EQUALS, value: 'char_alice' },
            { field: 'content', operator: RULE_OPERATORS.CONTAINS, value: '紧急' }
        ],
        actions: [
            { type: RULE_ACTIONS.PROPOSE_NOTIFICATION, level: 'urgent', text: 'Alice 发送了紧急事项' },
            { type: RULE_ACTIONS.FLAG_CALENDAR, tag: 'urgent_followup' }
        ]
    };

    const reg = registerRule(state, ruleSpec);
    assert.equal(reg.success, true);
    state = reg.state;

    // 2. 触发不匹配事件（内容不包含“紧急”）
    const eventMismatch = {
        type: RULE_TRIGGERS.MESSAGE_RECEIVED,
        payload: { sender: 'char_alice', content: '今天天气不错' }
    };
    const resMismatch = evaluateEvent(state, eventMismatch);
    assert.equal(resMismatch.triggeredActions.length, 0);

    // 3. 触发匹配事件
    const eventMatch = {
        type: RULE_TRIGGERS.MESSAGE_RECEIVED,
        payload: { sender: 'char_alice', content: '有个紧急演出方案需要敲定' }
    };
    const resMatch = evaluateEvent(state, eventMatch);
    assert.equal(resMatch.triggeredActions.length, 2);
    assert.equal(resMatch.triggeredActions[0].action.type, RULE_ACTIONS.PROPOSE_NOTIFICATION);
    assert.equal(resMatch.state.rules['rule_alice_urgent'].fireCount, 1);
});
