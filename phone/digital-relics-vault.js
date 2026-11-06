/* ========================================================
 * phone/digital-relics-vault.js
 * [v4.132.0 · R15-X8] 随身数字遗物探索与加密草稿解密柜
 * ======================================================== */
export class DigitalRelicsVault {
    constructor() {
        this.relics = new Map();
    }

    /**
     * 存入一件密封数字遗物
     */
    registerRelic(relic = {}) {
        if (!relic.id) return false;
        this.relics.set(relic.id, {
            id: relic.id,
            title: relic.title || '无名旧档案',
            passcode: String(relic.passcode || '0000'),
            cipherText: relic.cipherText || '',
            plainText: relic.plainText || '',
            isUnlocked: false,
            createdAt: Date.now()
        });
        return true;
    }

    /**
     * 尝试解密数字遗物
     * @param {string} relicId
     * @param {string} inputCode
     * @returns {Object}
     */
    attemptUnlock(relicId, inputCode) {
        const relic = this.relics.get(relicId);
        if (!relic) return { success: false, reason: 'relic_not_found' };
        if (relic.isUnlocked) {
            return { success: true, relic, decryptedContent: relic.plainText };
        }
        if (String(inputCode).trim() === relic.passcode) {
            relic.isUnlocked = true;
            return {
                success: true,
                relic,
                decryptedContent: relic.plainText
            };
        }
        return {
            success: false,
            reason: 'passcode_mismatch'
        };
    }

    /**
     * 获取所有可探索遗物列表（未解密的不暴露正文）
     */
    listRelics() {
        return Array.from(this.relics.values()).map(r => ({
            id: r.id,
            title: r.title,
            isUnlocked: r.isUnlocked,
            contentPreview: r.isUnlocked ? r.plainText : '【加密档案·需要密码】'
        }));
    }
}