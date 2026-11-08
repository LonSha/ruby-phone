/* ============================================================
 * forensic-timeline-clue-matrix.js — [v4.138.0 · V21-R13]
 * 跨 App 侦探物证链拓扑与电子取证工作台 (Forensic Timeline Clue Matrix)
 * ------------------------------------------------------------
 * 1. 微信聊天、通话、相册、备忘录线索拓扑联立 (Cross-App Clue Graph)
 * 2. 嫌疑人不在场证明破绽时空对撞 (Alibi Contradiction Detector)
 * 3. 审讯对质结构化证据链出示 (Evidence Interrogation Presentation)
 * ============================================================ */
export function crossExamineAlibi(claimedAlibi = {}, physicalClues = []) {
    const claimTime = Number(claimedAlibi.timestamp) || 0;
    const claimLoc = String(claimedAlibi.location || "").trim();
    const contradictions = [];

    for (const clue of physicalClues) {
        const clueTime = Number(clue.timestamp) || 0;
        const clueLoc = String(clue.location || "").trim();
        // 如果时间窗口在 30 分钟内，但地点完全不同，触发不在场证明矛盾
        if (Math.abs(claimTime - clueTime) < 1800000 && claimLoc && clueLoc && claimLoc !== clueLoc) {
            contradictions.push({
                claimed: `${claimTime} 时自称在「${claimLoc}」`,
                physicalEvidence: `${clueTime} 时在「${clueLoc}」留下了${clue.type || "物证痕迹"}`,
                verdict: "不在场证明彻底破裂！"
            });
        }
    }

    return {
        hasContradiction: contradictions.length > 0,
        contradictions
    };
}
