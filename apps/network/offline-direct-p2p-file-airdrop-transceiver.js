/* ============================================================
 * offline-direct-p2p-file-airdrop-transceiver.js
 * [v4.137.0 · V20 史诗级双计划 · R20-16]
 * 绝密离线近场 Wi-Fi Direct 点对点快传与隔空投送器 (Offline Direct P2P File Airdrop Transceiver)
 *
 * 核心机制：
 * 1. 模拟绝密离线无蜂窝网络环境下的 Wi-Fi Direct / 隔空投送（AirDrop-like P2P）；
 * 2. 点对点高速近场通道发现（SSID: DIRECT-xy、握手协商密钥、传输速率 20MB/s）；
 * 3. 接收端匿名弹窗确认与防物理尾随欺诈鉴权；
 * 4. 向提示词管线注入接收到绝密加密文件包、在极近距离对视确认的惊心动魄交接动作。
 * ============================================================ */

export function createInitialP2PAirdropState() {
  return {
    isP2PBroadcasting: true,
    nearbyDirectPeers: [], // Array<{ peerId, peerName, rssi, status: 'AVAILABLE'|'PAIRING'|'TRANSFERRING' }>
    incomingTransfers: [], // Array<{ transferId, senderPeerName, fileName, fileSizeMB, progress: 0..100, status: 'PENDING'|'COMPLETED' }>
    completedFiles: []
  };
}

/**
 * 发现附近的 P2P 直连节点
 */
export function discoverP2PPeer(state, { peerId, peerName, rssi = -48 }) {
  if (!state || !peerId) return;
  const existing = state.nearbyDirectPeers.find(p => p.peerId === peerId);
  if (!existing) {
    state.nearbyDirectPeers.push({
      peerId,
      peerName: peerName || '未知离线节点',
      rssi,
      status: 'AVAILABLE'
    });
  }
}

/**
 * 接收一次隔空投送文件传输
 */
export function initiateIncomingP2PTransfer(state, { transferId, senderPeerName, fileName, fileSizeMB = 45 }) {
  if (!state || !fileName) return null;

  const id = transferId || 'p2p_' + Date.now();
  const transfer = {
    transferId: id,
    senderPeerName: senderPeerName || '隔空投送者',
    fileName,
    fileSizeMB,
    progress: 100,
    status: 'COMPLETED',
    receivedAt: new Date().toISOString()
  };

  state.incomingTransfers.push(transfer);
  state.completedFiles.push(fileName);
  return transfer;
}

/**
 * 生成离线隔空快传提示词指令
 */
export function generateP2PAirdropDirectives(state) {
  if (!state || !Array.isArray(state.incomingTransfers) || state.incomingTransfers.length === 0) return '';

  const recent = state.incomingTransfers.filter(t => t.status === 'COMPLETED').slice(-1)[0];
  if (!recent) return '';

  return `【手机离线直连 · Wi-Fi Direct 隔空快传到账】\n` +
         `手机屏幕亮起近场隔空投送提示：成功从附近的匿名节点 [${recent.senderPeerName}] 接收到加密数据包 [${recent.fileName}]（大小：${recent.fileSizeMB} MB）！\n` +
         `指令要求：发话角色在近距离（<10米内）已与对方完成绝密数字交接。请在交互中通过眼神对视或暗号轻声确认收到，切勿在公共场合声张。`;
}

const OfflineDirectP2PFileAirdropTransceiver = {
  createInitialP2PAirdropState,
  discoverP2PPeer,
  initiateIncomingP2PTransfer,
  generateP2PAirdropDirectives
};

export default OfflineDirectP2PFileAirdropTransceiver;