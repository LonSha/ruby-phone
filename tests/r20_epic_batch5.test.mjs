/* [v4.137.0 · V20 手机端批次5] 跨设备电子取证与时序行为拓扑重构测试 */
import test from 'node:test';
import assert from 'node:assert/strict';

import ForensicLib from '../apps/investigation/cross-device-forensic-timeline-reconstructor.js';

test('R20-O8 跨设备行为取证、生理心率异常与行为时序矛盾重构', () => {
    const state = ForensicLib.createInitialForensicState();
    const baseTime = 1762410000000;

    // 智能手表记录 23:15:00 心率尖峰暴增到 165
    ForensicLib.recordForensicEvent(state, {
        timestamp: baseTime,
        device: 'smartwatch',
        eventType: 'HEART_RATE_MONITOR',
        detail: '心跳急剧加速',
        biometricHeartRate: 168
    });

    // 车载系统记录 23:16:00 紧急刹车
    ForensicLib.recordForensicEvent(state, {
        timestamp: baseTime + 60000,
        device: 'vehicle_infotainment',
        eventType: 'EMERGENCY_BRAKE',
        detail: 'ABS防抱死激活，车速从120降为0'
    });

    // 手机记录 23:16:30 强行关机
    ForensicLib.recordForensicEvent(state, {
        timestamp: baseTime + 90000,
        device: 'smartphone',
        eventType: 'POWER_OFF',
        detail: '长按电源键强制关机'
    });

    const anomalies = ForensicLib.reconstructForensicTimeline(state);
    assert.equal(anomalies.length, 2);
    assert.equal(anomalies[0].type, 'STRESS_SPIKE');
    assert.equal(anomalies[1].type, 'FLIGHT_OR_CRASH');

    const directives = ForensicLib.generateForensicDirectives(state);
    assert.match(directives, /【跨设备数字取证与行为链铁证】/);
    assert.match(directives, /168 BPM/);
    assert.match(directives, /车载黑匣子记录紧急制动后，手机在60秒内被强制关机/);
});