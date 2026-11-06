/* [v4.137.0 · V20 批次9] 蓝牙外设物联网矩阵与终端Linux黑客沙盒测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import BleMatrix from '../apps/hardware/bluetooth-iot-peripheral-matrix.js';
import ShellExecutor from '../apps/security/local-sandbox-reverse-shell-executor.js';

test('R20-13 蓝牙外设物联网拓扑感知机：外设连接、RSSI 距离感应与私密耳语', () => {
    const bleState = BleMatrix.createInitialBleMatrixState();

    // 连接骨传导私密耳机与智能感应门锁
    BleMatrix.registerPeripheralDevice(bleState, {
        deviceId: 'ble_earphone_01',
        name: '夜魔骨传导特工耳机',
        deviceType: 'EARPHONE',
        battery: 88
    });

    BleMatrix.registerPeripheralDevice(bleState, {
        deviceId: 'ble_lock_alpha',
        name: '安全屋重型防爆电子门锁',
        deviceType: 'SMART_LOCK',
        rssi: -45 // 极近距离
    });

    const directives = BleMatrix.generateBleMatrixDirectives(bleState);
    assert.ok(directives);
    assert.match(directives, /【手机外设物联网拓扑 · 近场硬件感知】/);
    assert.match(directives, /骨传导私密耳机已连接/);
    assert.match(directives, /夜魔骨传导特工耳机/);
    assert.match(directives, /安全屋重型防爆电子门锁/);
    assert.match(directives, /清脆解锁蜂鸣/);

    // 模拟外设远离脱手
    BleMatrix.updatePeripheralRssi(bleState, 'ble_earphone_01', -92);
    const alertDirectives = BleMatrix.generateBleMatrixDirectives(bleState);
    assert.match(alertDirectives, /距离告警/);
});

test('R20-14 手机极客终端 Linux 原生沙盒与黑客渗透脚本执行机', () => {
    const shellState = ShellExecutor.createInitialShellSandboxState();

    // 执行 nmap 网络扫描
    const nmapResult = ShellExecutor.executeSandboxCommand(shellState, 'nmap -sV 192.168.1.105');
    assert.equal(nmapResult.exitCode, 0);
    assert.match(nmapResult.stdout, /22\/tcp\s+open\s+ssh/);
    assert.match(nmapResult.stdout, /8080\/tcp open\s+http-proxy/);

    // 执行 openssl 解密
    const decResult = ShellExecutor.executeSandboxCommand(shellState, 'openssl enc -d -aes-256-gcm');
    assert.equal(decResult.exitCode, 0);
    assert.match(decResult.stdout, /AES-256-GCM Payload decrypted/);

    // 尝试越权读取 shadow（触发权限拦截）
    const deniedResult = ShellExecutor.executeSandboxCommand(shellState, 'cat /etc/shadow');
    assert.equal(deniedResult.exitCode, 1);
    assert.match(deniedResult.stderr, /Permission denied/);

    // 生成发话指令
    const shellDirectives = ShellExecutor.generateShellSandboxDirectives(shellState);
    assert.ok(shellDirectives);
    assert.match(shellDirectives, /【手机极客终端 · Linux沙盒执行输出】/);
    assert.match(shellDirectives, /openssl/);
    assert.match(shellDirectives, /Permission denied/);
});