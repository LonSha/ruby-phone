/* ============================================================
 * offline-mesh-beacon-transceiver.js — [R20-7 · 第二十期史诗级双项目双计划]
 * 离线近场自组网与信标广播收发器 (Offline Mesh Beacon Transceiver)
 * ============================================================ */

export function createInitialMeshState() {
  return {
    meshEnabled: true,
    localNodeId: 'node_' + Math.random().toString(36).slice(2, 8),
    knownPeers: [], // Array<{ peerId, character, distanceMeters, signalStrength, lastHeardAt }>
    pendingPackets: [] // Array<{ packetId, sender, recipient, encryptedPayload, hopsRemaining, timestamp }>
  };
}

/**
 * 发现附近的近场节点
 */
export function registerNearPeer(state, { peerId, character, distanceMeters = 20 }) {
  if (!state || !peerId) return;
  const existing = state.knownPeers.find(p => p.peerId === peerId);
  const signalStrength = Math.max(0, Math.min(100, Math.round(100 - (distanceMeters / 1.5))));

  if (existing) {
    existing.distanceMeters = distanceMeters;
    existing.signalStrength = signalStrength;
    existing.lastHeardAt = new Date().toISOString();
  } else {
    state.knownPeers.push({
      peerId,
      character,
      distanceMeters,
      signalStrength,
      lastHeardAt: new Date().toISOString()
    });
  }
}

/**
 * 发送离线信标或近场自组网数据包
 */
export function transmitMeshPacket(state, { sender, recipient, message, hops = 3 }) {
  if (!state || !sender || !message) {
    return { success: false, reason: 'invalid_params' };
  }

  // 检查目标是否在自组网视野内
  const targetPeer = state.knownPeers.find(p => p.character === recipient || p.peerId === recipient);
  const reachable = !!targetPeer && targetPeer.distanceMeters <= 150;

  const packet = {
    packetId: 'pkt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    sender,
    recipient,
    payload: message,
    hopsRemaining: hops,
    status: reachable ? 'DELIVERED_MESH' : 'HOPPING_PENDING',
    timestamp: new Date().toISOString()
  };

  state.pendingPackets.push(packet);

  return {
    success: true,
    packetId: packet.packetId,
    deliveredDirectly: reachable,
    hopPath: reachable ? [state.localNodeId, targetPeer.peerId] : [state.localNodeId]
  };
}

/**
 * 生成手机近场自组网状态指示提示词
 */
export function generateMeshNetworkDirective(state) {
  if (!state || !state.meshEnabled || state.knownPeers.length === 0) return '';

  const peersDesc = state.knownPeers
    .map(p => `[${p.character || p.peerId}]（距离约 ${p.distanceMeters}米，信标强度 ${p.signalStrength}%）`)
    .join('、');

  return `【手机离线近场自组网 · 物理通信局限】\n` +
         `蜂窝基站已失联，当前通过低功耗蓝牙/近场Mesh自组网维持通信。\n` +
         `周围侦测到物理近场节点：${peersDesc}。\n` +
         `限制要求：无法联络远距离实体，所有信息传递受物理距离衰减与跳点延迟约束。`;
}

const OfflineMeshBeaconTransceiver = {
  createInitialMeshState,
  registerNearPeer,
  transmitMeshPacket,
  generateMeshNetworkDirective
};

export default OfflineMeshBeaconTransceiver;