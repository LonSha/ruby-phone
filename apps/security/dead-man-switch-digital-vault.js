/**
 * 随身数字遗物保险箱与死人开关定时密信 (Dead Man Switch Digital Vault)
 * 监测心跳与会话间隔，若失联超时（触发死人开关），自动向指定角色或玩家解锁密封信件与绝密账本
 */
export class DeadManSwitchDigitalVault {
    constructor(heartbeatTimeoutMs = 7 * 24 * 3600 * 1000) {
        this.timeoutLimitMs = heartbeatTimeoutMs;
        this.lastHeartbeatAt = Date.now();
        this.sealedLetters = [];
        this.triggeredLetters = [];
    }

    /**
     * 封存一份定时告别/解密密信
     */
    depositSealedLetter(recipientId, letterTitle, letterContent, condition = 'OFFLINE_TIMEOUT') {
        const letter = {
            id: 'deadman_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            recipientId,
            letterTitle,
            letterContent,
            condition,
            depositedAt: Date.now(),
            status: 'SEALED'
        };
        this.sealedLetters.push(letter);
        return letter;
    }

    /**
     * 更新心跳时间戳（证明生还/活跃）
     */
    refreshHeartbeat() {
        this.lastHeartbeatAt = Date.now();
        return { success: true, lastHeartbeatAt: this.lastHeartbeatAt };
    }

    /**
     * 周期巡检死人开关（支持模拟时间流逝）
     */
    checkSwitchState(currentTimeMs = Date.now()) {
        const elapsed = currentTimeMs - this.lastHeartbeatAt;
        const isTriggered = elapsed >= this.timeoutLimitMs;

        if (isTriggered) {
            const newlyUnlocked = [];
            for (const letter of this.sealedLetters) {
                if (letter.status === 'SEALED') {
                    letter.status = 'UNSEALED';
                    letter.unsealedAt = currentTimeMs;
                    newlyUnlocked.push(letter);
                    this.triggeredLetters.push(letter);
                }
            }
            return {
                deadManSwitchTriggered: true,
                elapsedMs: elapsed,
                unsealedLetters: newlyUnlocked,
                alert: '【死人开关已激活】由于长时间未检测到生命体征与终端心跳，遗物保险箱已自动解密并投递！'
            };
        }

        return {
            deadManSwitchTriggered: false,
            elapsedMs: elapsed,
            remainingMs: this.timeoutLimitMs - elapsed
        };
    }

    getTriggeredLetters() {
        return [...this.triggeredLetters];
    }
}

export default DeadManSwitchDigitalVault;