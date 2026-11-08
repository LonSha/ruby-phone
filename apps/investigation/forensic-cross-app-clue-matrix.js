/**
 * forensic-cross-app-clue-matrix.js - RubyPhone 第十七期拓展 (R17-X2)
 * 跨 App 刑侦物证链与不在场证明时空对撞机 (Forensic Cross-App Clue Matrix)
 *
 * 核心机制：
 * 聚合并碰撞多 App 数据源：
 * 1. 微信聊天声明（如：声称昨晚 10 点睡觉）；
 * 2. 钱包账单记录（如：深夜 23:45 便利店咖啡消费）；
 * 3. 相册 EXIF 定位（如：00:15 某酒吧定位照片）；
 * 4. 通话记录（如：01:20 与未知号码的长途通话）。
 * 自动比对矛盾点与疑点证据链，还原真实时空轨迹。
 */

export class ForensicCrossAppClueMatrix {
    constructor(state = {}) {
        this.clues = Array.isArray(state.clues) ? state.clues : [];
        this.inconsistencies = Array.isArray(state.inconsistencies) ? state.inconsistencies : [];
    }

    /**
     * 注册物证条目
     * @param {Object} item { id, sourceApp, timestamp, claimType, content, location }
     */
    addEvidence(item) {
        if (!item || !item.id) return null;
        const evidence = {
            id: item.id,
            sourceApp: item.sourceApp || 'unknown',
            timestamp: item.timestamp || Date.now(),
            claimType: item.claimType || 'fact', // 'claim' (口供/声称) | 'physical' (账单/定位/通话)
            content: String(item.content || ''),
            location: item.location || '未知'
        };
        this.clues.push(evidence);
        return evidence;
    }

    /**
     * 执行时空对撞，检测口供与物理物证的矛盾点
     */
    crossExamine() {
        const findings = [];
        const claims = this.clues.filter(c => c.claimType === 'claim');
        const physicals = this.clues.filter(c => c.claimType === 'physical');

        for (const claim of claims) {
            for (const phys of physicals) {
                // 示例矛盾规则 1: 早睡口供 vs 深夜消费/拍照
                if (/睡|休息|在床上/.test(claim.content) && (/便利店|酒吧|消费|购买|外卖/.test(phys.content) || phys.location.includes('酒吧') || phys.location.includes('路'))) {
                    const timeDiff = Math.abs(claim.timestamp - phys.timestamp);
                    if (timeDiff <= 4 * 3600 * 1000) { // 4小时内重叠
                        findings.push({
                            type: 'ALIBI_CONTRADICTION',
                            severity: 'HIGH',
                            claimId: claim.id,
                            evidenceId: phys.id,
                            description: `声称「${claim.content}」（来源：${claim.sourceApp}），但实证记录显示「${phys.content}」（地点：${phys.location}，来源：${phys.sourceApp}），存在明显不在场证明破绽！`
                        });
                    }
                }
            }
        }

        this.inconsistencies = findings;
        return {
            totalClues: this.clues.length,
            inconsistenciesFound: findings.length,
            details: findings
        };
    }

    getTimeline() {
        return [...this.clues].sort((a, b) => a.timestamp - b.timestamp);
    }
}

export function createForensicClueMatrix(state) {
    return new ForensicCrossAppClueMatrix(state);
}

export default ForensicCrossAppClueMatrix;