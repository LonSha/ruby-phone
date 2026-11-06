/* [v4.137.0 · V20 手机端批次2] 暗网双域空间、硬件传感器与NPC自主演化通知测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import DarknetVault from '../apps/darknet/darknet-dual-domain-vault.js';
import HardwareSim from '../apps/hardware/hardware-signal-sensor-simulator.js';
import NpcPushes from '../apps/notifications/npc-autonomous-notification-synthesizer.js';

test('R20-O2 暗网双域空间隔离、暗号唤醒与紧急恐慌伪装', async () => {
    const vault = DarknetVault.createInitialVaultState();
    assert.equal(vault.activeDomain, DarknetVault.DOMAIN_MODE.PUBLIC, '初始状态必须在日常表层空间');

    // 错误密码无法切入
    const wrong = DarknetVault.switchDomain(vault, '123456');
    assert.equal(wrong, false, '错误暗号无法激活暗网');
    assert.equal(vault.activeDomain, DarknetVault.DOMAIN_MODE.PUBLIC);

    // 正确暗号激活暗网
    const ok = DarknetVault.switchDomain(vault, '*#9981#*');
    assert.equal(ok, true, '正确暗号必须激活暗网');
    assert.equal(vault.activeDomain, DarknetVault.DOMAIN_MODE.DARKNET);

    // 在暗网中存入地下情报
    DarknetVault.storeDarknetDossier(vault, {
        id: 'dark_doc_1',
        title: '密室逃脱路径图',
        content: '从地下通风管道第三拐角可直达外部排污口',
        burnAfterReading: true
    });
    assert.equal(vault.darknetDossiers.size, 1, '地下机密必须成功保存');

    // 触发恐慌模式，瞬间降级回公共表层空间
    DarknetVault.triggerPanicMode(vault);
    assert.equal(vault.activeDomain, DarknetVault.DOMAIN_MODE.PUBLIC, '恐慌模式必须瞬间降级回公共空间');
    assert.equal(vault.panicTriggerCount, 1);
});

test('R20-O3 拟真无线基站信号与硬件传感器跌落仿真', async () => {
    const hwState = HardwareSim.createInitialHardwareState();

    // 模拟进入地底密室导致断网
    HardwareSim.applyEnvironmentConditions(hwState, {
        signalBars: 0,
        batteryDelta: -20,
        impactDetected: true
    });

    assert.equal(hwState.networkType, HardwareSim.NETWORK_TYPE.NO_SERVICE, '0格信号必须判定为无网络');
    assert.equal(hwState.motionState, 'violent_impact', '跌落检测必须触发');

    const directives = HardwareSim.resolveHardwarePromptDirectives(hwState);
    assert.ok(directives, '必须生成硬件环境提示词指引');
    assert.match(directives, /手机无信号/);
    assert.match(directives, /剧烈震落/);
});

test('R20-O4 NPC自主演化推送通知合成与排空', async () => {
    const pushState = NpcPushes.createInitialNotificationEngineState();

    const npcs = [
        { name: '苏离', affinity: 90 },
        { name: '暗桩07', role: 'informant' }
    ];

    // 离线时间60分钟
    const pushes = NpcPushes.synthesizeAutonomousPushes(pushState, npcs, 60);
    assert.equal(pushes.length, 2, '必须根据亲密度和角色身份生成两条自主推送');

    // 排空通知交付锁屏
    const drained = NpcPushes.drainPendingNotifications(pushState);
    assert.equal(drained.length, 2, '排空队列长度必须一致');
    assert.equal(pushState.pendingNotifications.length, 0, '待交付队列必须清空');
});