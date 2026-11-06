/* [v4.137.0 · V20 批次11 · 终极大收官] 虚拟手机全息情境综合编排中枢测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import DeviceOrchestrator from '../apps/settings/virtual-device-contextual-orchestrator.js';

test('R20-18 虚拟手机全息情境综合编排中枢：优先级分层、冲突仲裁与 Token 压缩', () => {
    const p0Duress = '【手机底层静默求救 · 胁迫解锁已生效】\n静默向救援组织发送遇险信标。';
    const p0FakeBts = '【手机射频安全警报 · 检出伪基站 IMSI 嗅探监听】\n严禁透露真实姓名。';
    const p1Damage = '【手机物理残损 · 屏幕碎裂与触控衰减】\n触控屏存在死区。';
    const p2Shell = '【手机极客终端 · Linux沙盒执行输出】\n$ nmap completed.';

    // 进行综合情境编排
    const orchestrated = DeviceOrchestrator.arbitrateDeviceDirectives({
        duressDirective: p0Duress,
        simDirective: p0FakeBts,
        damageDirective: p1Damage,
        shellDirective: p2Shell
    });

    assert.ok(orchestrated);
    assert.match(orchestrated, /【虚拟手机情境全息编排 · 物理与数字环境综合指示】/);
    // P0 危机排在最前
    assert.match(orchestrated, /胁迫解锁已生效/);
    assert.match(orchestrated, /伪基站 IMSI 嗅探监听/);
    // P1 紧随其后
    assert.match(orchestrated, /屏幕碎裂与触控衰减/);
    // 超过3条上限时，P2 会被智能截断压缩保护上下文预算
    assert.equal(orchestrated.includes('$ nmap completed'), false);
});