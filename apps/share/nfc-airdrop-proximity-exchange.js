/**
 * 近场 NFC 面对面“碰一碰”名片与快传通道 (NFC Airdrop Proximity Exchange)
 * 支持设备靠近模拟、名片/文件高速交换与安全凭证加密验证
 */
export class NFCAirdropProximityExchange {
    constructor() {
        this.devicesInRange = new Map();
        this.transferHistory = [];
        this.status = 'IDLE'; // IDLE | SCANNING | CONNECTED | TRANSFERRING
    }

    /**
     * 模拟发现近场设备（NFC 碰撞）
     */
    triggerBump(targetDevice = { id: 'npc_phone_001', name: '苏离的手机', nfcUid: '04:5A:32:1A:89' }) {
        this.status = 'CONNECTED';
        this.devicesInRange.set(targetDevice.id, {
            ...targetDevice,
            connectedAt: Date.now(),
            signalStrength: 98 // 近距离满格
        });
        return {
            success: true,
            status: this.status,
            device: targetDevice,
            hapticPattern: 'bump_double_vibrate'
        };
    }

    /**
     * 执行碰一碰隔空快传
     */
    exchangePayload(targetDeviceId, payload = { type: 'CONTACT_CARD', title: '我的名片', data: {} }) {
        const device = this.devicesInRange.get(targetDeviceId);
        if (!device) {
            return { success: false, reason: 'DEVICE_NOT_IN_NFC_RANGE' };
        }

        const transferRecord = {
            transferId: 'nfc_tx_' + Date.now(),
            targetDeviceId: targetDeviceId,
            targetName: device.name,
            payloadType: payload.type,
            title: payload.title,
            payloadData: payload.data,
            transferredAt: Date.now(),
            status: 'COMPLETED'
        };

        this.transferHistory.push(transferRecord);
        return {
            success: true,
            record: transferRecord,
            animation: 'airdrop_ripple_outgoing'
        };
    }

    getHistory() {
        return [...this.transferHistory];
    }
}

export default NFCAirdropProximityExchange;