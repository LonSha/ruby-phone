/* [v4.137.0 · V20 批次8] 电源管理调度器与双卡基站安全防御测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import PowerScheduler from '../apps/hardware/device-power-sleep-scheduler.js';
import SimCarrierGuard from '../apps/network/sim-card-carrier-imsi-switcher.js';

test('R20-11 手机电源管理、动态放电与极限省电指令', () => {
    const powerState = PowerScheduler.createInitialPowerState();
    assert.equal(powerState.batteryLevel, 85);

    // 运行高功耗视频通话与解密运算 60 分钟
    PowerScheduler.updateBatteryDrain(powerState, {
        activityType: 'VIDEO_CALL',
        elapsedMinutes: 60,
        charging: false
    });

    // 85 - 1.2 * 60 = 13 (触发低电量模式)
    assert.ok(powerState.batteryLevel <= 20);
    assert.equal(powerState.powerSaveMode, true);

    const directive = PowerScheduler.generatePowerDirectives(powerState);
    assert.ok(directive);
    assert.match(directive, /【手机低电量提示/);

    // 极端掉电至 3%（触发黑白极限省电）
    PowerScheduler.updateBatteryDrain(powerState, {
        activityType: 'GPS_NAVIGATION',
        elapsedMinutes: 20
    });
    assert.ok(powerState.batteryLevel <= 5);
    assert.equal(powerState.ultraPowerSaveMode, true);

    const ultraDirective = PowerScheduler.generatePowerDirectives(powerState);
    assert.match(ultraDirective, /【手机电池极限告警 · 濒临关机/);
    assert.match(ultraDirective, /长话短说/);
});

test('R20-12 双卡双待与伪基站 IMSI 嗅探防御机', () => {
    const simState = SimCarrierGuard.createInitialSimCarrierState();
    assert.equal(simState.activeSlot, 1);

    // 切换至卡槽2（境外漫游 eSIM）
    SimCarrierGuard.switchActiveSimSlot(simState, 2);
    assert.equal(simState.activeSlot, 2);

    const roamDirective = SimCarrierGuard.generateSimSecurityDirectives(simState);
    assert.match(roamDirective, /【手机网络状态 · 国际漫游网络接入中】/);
    assert.match(roamDirective, /境外虚拟eSIM/);

    // 检测到强行降级 2G GSM 伪基站监听攻击
    const attack = SimCarrierGuard.inspectBaseStationEnvironment(simState, {
        cellTowerId: 'fake_catcher_alpha',
        signalProtocol: '2G-GSM',
        forced2GDowngrade: true,
        encryptionEnabled: false
    });
    assert.ok(attack);
    assert.equal(simState.imsiCatcherAttacksDetected.length, 1);

    const attackDirective = SimCarrierGuard.generateSimSecurityDirectives(simState);
    assert.match(attackDirective, /【手机射频安全警报 · 检出伪基站 IMSI 嗅探监听】/);
    assert.match(attackDirective, /已被外部特工设备\/监听车完全截获/);
    assert.match(attackDirective, /严禁在当前通话中透露任何真实姓名/);
});