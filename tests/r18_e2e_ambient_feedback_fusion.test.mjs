import test from 'node:test';
import assert from 'node:assert/strict';

import { LonShaBridge } from '../apps/memory/lonsha-bridge.js';

test('E2E RubyPhone 掌机日常事件因果反哺至 LonSha 注入管线', async () => {
    // 1. 初始化掌机记忆桥实例
    const bridge = new LonShaBridge();
    assert.ok(bridge.feedbackHub, '反馈枢纽必须成功初始化');
    assert.ok(bridge.typingHesitation, '输入法犹豫引擎必须挂载');
    assert.ok(bridge.deliveryEcosystem, '外卖即时配送引擎必须挂载');
    assert.ok(bridge.wearableInterop, '穿戴设备体征引擎必须挂载');

    // 2. 模拟打字犹豫测谎（玩家输入了喜欢你，犹豫了 9.5 秒后最终只发出好的）
    bridge.typingHesitation.simulateTypingSession('妹妹', '其实我一直在骗你', '好的', 0.95);

    // 反哺到 FeedbackHub
    bridge.feedbackHub.onTypingHesitationObserved('妹妹', '其实我一直在骗你', 9.5);

    // 3. 模拟外卖履约完成送达
    bridge.feedbackHub.onDeliveryArrivalObserved('老张牛肉面', '招牌牛腩面加溏心蛋', '门把手');

    // 4. 模拟智能手表体征突变（心率狂飙至 142 bpm）
    bridge.feedbackHub.onBiometricSpikeObserved(142, 'TACHYCARDIA');

    // 5. 校验反馈中枢指令提取
    const directives = bridge.feedbackHub.consumePendingDirectives();
    assert.ok(directives);
    assert.ok(directives.includes('输入法微表情因果反哺'), '必须包含打字犹豫潜台词反哺');
    assert.ok(directives.includes('其实我一直在骗你'), '必须包含删除草稿物证内容');
    assert.ok(directives.includes('现实生活物联反哺'), '必须包含外卖香气与挂门把手声响');
    assert.ok(directives.includes('智能穿戴生理反哺'), '必须包含 142 bpm 心率过速体征反馈');

    // 6. 验证消费后指令清空（幂等保护）
    const emptyDirectives = bridge.feedbackHub.consumePendingDirectives();
    assert.equal(emptyDirectives, '', '消费后缓冲区必须清空');

    console.log('✓ 掌机端日常物联微表情因果反哺端到端验证通过，生成指令:\n' + directives);
});