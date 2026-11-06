/* [v4.137.0 · V20 手机端批次4] 离线近场自组网与信标广播收发测试 */
import test from 'node:test';
import assert from 'node:assert/strict';

import OfflineMesh from '../apps/network/offline-mesh-beacon-transceiver.js';

test('R20-O7 离线近场自组网、信标广播与跳点中继', () => {
    const state = OfflineMesh.createInitialMeshState();
    assert.equal(state.meshEnabled, true);

    // 注册附近节点
    OfflineMesh.registerNearPeer(state, {
        peerId: 'node_alpha',
        character: '赛博黑客·艾拉',
        distanceMeters: 45
    });

    assert.equal(state.knownPeers.length, 1);
    assert.equal(state.knownPeers[0].signalStrength, 70);

    // 发送离线近场消息
    const result = OfflineMesh.transmitMeshPacket(state, {
        sender: '主角',
        recipient: '赛博黑客·艾拉',
        message: '基站已被EMP瘫痪，我们在防空洞汇合。'
    });

    assert.equal(result.success, true);
    assert.equal(result.deliveredDirectly, true);
    assert.equal(state.pendingPackets.length, 1);

    // 生成自组网提示词指示
    const directive = OfflineMesh.generateMeshNetworkDirective(state);
    assert.match(directive, /【手机离线近场自组网 · 物理通信局限】/);
    assert.match(directive, /赛博黑客·艾拉/);
    assert.match(directive, /距离约 45米/);
});