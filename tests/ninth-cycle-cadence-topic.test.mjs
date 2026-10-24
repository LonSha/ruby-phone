import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CADENCE_STATES,
    createTopicThread,
    updateCharacterCadence,
    resumeThreadTopic
} from '../config/cadence-topic-thread.js';

test('R9-O5 · 角色回应节奏流转与忙碌状态设置', () => {
    const thread = createTopicThread('th-1', 'luo_jia', '探讨黑客技术');
    assert.equal(thread.cadenceState, CADENCE_STATES.IDLE);

    // 角色进入忙碌状态
    const busyRes = updateCharacterCadence(thread, CADENCE_STATES.BUSY, {
        activityContext: '正在进行服务器维护'
    });
    assert.equal(busyRes.ok, true);
    assert.equal(busyRes.thread.cadenceState, CADENCE_STATES.BUSY);
    assert.equal(busyRes.thread.activityContext, '正在进行服务器维护');

    // 重新接回原先议题
    const resumeRes = resumeThreadTopic(busyRes.thread, '继续探讨加密协议', '维护结束');
    assert.equal(resumeRes.ok, true);
    assert.equal(resumeRes.thread.currentTopic, '继续探讨加密协议');
    assert.equal(resumeRes.thread.history.length, 1);
});