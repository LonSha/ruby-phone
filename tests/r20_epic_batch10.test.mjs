/* [v4.137.0 · V20 批次10] 屏幕残损断触、离线隔空快传与胁迫自毁保险库测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import DamageSim from '../apps/hardware/physical-damage-touch-degradation-simulator.js';
import P2PAirdrop from '../apps/network/offline-direct-p2p-file-airdrop-transceiver.js';
import DuressVault from '../apps/security/biometrics-duress-panic-wipe-vault.js';

test('R20-15 屏幕物理碎裂、OLED漏液与触控失灵拟真机', () => {
    const damageState = DamageSim.createInitialDamageState();
    assert.equal(damageState.screenCracked, false);

    // 手机遭遇重摔撞击
    DamageSim.applyPhysicalImpact(damageState, { impactJoules: 24, damageType: 'FALL_FROM_HEIGHT' });
    assert.equal(damageState.screenCracked, true);
    assert.ok(damageState.crackSeverity >= 80);
    assert.ok(damageState.oledLeakBleedRadiusPx > 100);
    assert.equal(damageState.deadTouchZones.length, 1);

    // 生成受阻提示词指令
    const directives = DamageSim.generatePhysicalDamageDirectives(damageState);
    assert.ok(directives);
    assert.match(directives, /【手机物理残损 · 屏幕碎裂与触控衰减】/);
    assert.match(directives, /蜘蛛网碎裂纹/);
    assert.match(directives, /OLED 漏液盲斑/);
    assert.match(directives, /触控屏存在死区/);
});

test('R20-16 绝密离线近场 Wi-Fi Direct 点对点快传与隔空投送器', () => {
    const airdropState = P2PAirdrop.createInitialP2PAirdropState();

    // 发现附近离线特工节点
    P2PAirdrop.discoverP2PPeer(airdropState, {
        peerId: 'peer_agent_shadow',
        peerName: '幽灵节点·K',
        rssi: -42
    });
    assert.equal(airdropState.nearbyDirectPeers.length, 1);

    // 接收点对点加密快传
    const transfer = P2PAirdrop.initiateIncomingP2PTransfer(airdropState, {
        transferId: 'trans_topsecret_01',
        senderPeerName: '幽灵节点·K',
        fileName: 'Project_Exodus_Blueprint.enc',
        fileSizeMB: 128
    });
    assert.ok(transfer);
    assert.equal(airdropState.completedFiles.length, 1);

    const airdropDirectives = P2PAirdrop.generateP2PAirdropDirectives(airdropState);
    assert.ok(airdropDirectives);
    assert.match(airdropDirectives, /【手机离线直连 · Wi-Fi Direct 隔空快传到账】/);
    assert.match(airdropDirectives, /幽灵节点·K/);
    assert.match(airdropDirectives, /Project_Exodus_Blueprint\.enc/);
    assert.match(airdropDirectives, /绝密数字交接/);
});

test('R20-17 胁迫指纹密码、紧急静默求救与不可逆恐慌自毁保险库', () => {
    const vaultState = DuressVault.createInitialDuressVaultState();

    // 1. 正常密码解锁（无报警）
    const normalAuth = DuressVault.authenticateWithDuressDetection(vaultState, { inputPin: '1234' });
    assert.equal(normalAuth.success, true);
    assert.equal(normalAuth.isDuress, false);
    assert.equal(vaultState.emergencyDistressDispatched, false);

    // 2. 遭遇枪口胁迫，输入胁迫密码 9999
    const duressAuth = DuressVault.authenticateWithDuressDetection(vaultState, {
        inputPin: '9999',
        currentGps: '39.9042,116.4074'
    });
    assert.equal(duressAuth.success, true);
    assert.equal(duressAuth.isDuress, true);
    assert.equal(vaultState.emergencyDistressDispatched, true);

    const duressDirectives = DuressVault.generateDuressDirectives(vaultState);
    assert.match(duressDirectives, /【手机底层静默求救 · 胁迫解锁已生效】/);
    assert.match(duressDirectives, /装作温顺交出手机/);

    // 3. 终极恐慌自毁熔断
    DuressVault.triggerPanicWipe(vaultState, { reason: 'HOSTILE_RAID' });
    assert.equal(vaultState.systemWiped, true);

    const wipeDirectives = DuressVault.generateDuressDirectives(vaultState);
    assert.match(wipeDirectives, /【手机硬件级安全熔断 · 绝密数据彻底自毁】/);
    assert.match(wipeDirectives, /不可逆覆盖擦除/);
});