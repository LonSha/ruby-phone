/* ============================================================
 * offline-airdrop-digital-legacy.js — 近场快传与数字遗物离线定向寄递器
 * [v4.140.0 · 近场隔空闪传、长久静默定向遗言与心痕寄托]
 * ============================================================ */

export class OfflineAirdropDigitalLegacy {
    constructor() {
        this.digitalWill = null; // { recipient, secretMessage, condition, armedAt, deliveredAt, isDelivered }
        this.airdropTransfers = [];
    }

    dispatchAirdropFile(fileName, recipientDevice, fileBytes = 1024) {
        const transferRecord = {
            id: `airdrop_${Date.now()}`,
            fileName,
            recipient: recipientDevice,
            bytes: fileBytes,
            timestamp: Date.now(),
            notice: `与附近的「${recipientDevice}」完成近场隔空秒传：「${fileName}」。`
        };
        this.airdropTransfers.push(transferRecord);
        return transferRecord;
    }

    armDigitalLegacy(recipientContact, sealedMessage, triggerCondition = "inactive_30_days") {
        this.digitalWill = {
            recipient: recipientContact,
            sealedMessage: String(sealedMessage).trim(),
            triggerCondition,
            armedTimestamp: Date.now(),
            isDelivered: false
        };
        return this.digitalWill;
    }

    evaluateDeliveryTrigger(observedCondition) {
        if (!this.digitalWill || this.digitalWill.isDelivered) return null;

        if (observedCondition === this.digitalWill.triggerCondition) {
            this.digitalWill.isDelivered = true;
            this.digitalWill.deliveredTimestamp = Date.now();

            return {
                delivered: true,
                recipient: this.digitalWill.recipient,
                promptDirective: `【数字遗物离线信使·定向送达】触发静默条件「${observedCondition}」！` +
                    `系统已自动向「${this.digitalWill.recipient}」定向解密派发最终封缄信件：「${this.digitalWill.sealedMessage}」。`
            };
        }

        return { delivered: false };
    }

    exportState() {
        return {
            digitalWill: this.digitalWill,
            airdropTransfers: this.airdropTransfers
        };
    }

    hydrateState(state) {
        if (!state) return;
        if (state.digitalWill) this.digitalWill = Object.assign({}, state.digitalWill);
        if (Array.isArray(state.airdropTransfers)) this.airdropTransfers = [...state.airdropTransfers];
    }
}
if (typeof globalThis !== "undefined") { globalThis.OfflineAirdropDigitalLegacy = OfflineAirdropDigitalLegacy; }
if (typeof window !== "undefined") { window.OfflineAirdropDigitalLegacy = OfflineAirdropDigitalLegacy; }
if (typeof module !== "undefined" && module.exports) { module.exports = OfflineAirdropDigitalLegacy; }
export default OfflineAirdropDigitalLegacy;