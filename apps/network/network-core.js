export function completedTransfer(id, senderPeerName, fileName, fileSizeMB, receivedAt) {
  return {
    transferId: id,
    senderPeerName: senderPeerName || '隔空投送者',
    fileName,
    fileSizeMB,
    progress: 100,
    status: 'COMPLETED',
    receivedAt
  };
}
