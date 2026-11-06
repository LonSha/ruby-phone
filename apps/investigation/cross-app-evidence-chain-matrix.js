/* ============================================================
 * cross-app-evidence-chain-matrix.js — [R20-6 · 第二十期史诗级双项目双计划]
 * 跨应用侦探证据链与物理物证网拓扑分析机 (Cross-App Evidence Chain Matrix)
 * ------------------------------------------------------------
 * 【核心设计】
 *   解决手机应用各自为政、缺乏跨应用线索拼图能力的痛点：
 *   1. 跨应用物证锚定（Cross-App Evidence Nexus）：
 *      将散落在【微信聊天记录】、【相册EXIF地点】、【账单转账流水】与【备忘录速记】中的零碎线索统一打上物证元标签（`Evidence Node`）；
 *   2. 物证因果连线与矛盾裁决（Contradiction & Alibi Corroborator）：
 *      对比不在场证明：例如“聊天称在公司加班”与“同一时间在奢侈品店有刷卡账单”，自动判定不在场证明破绽；
 *   3. 侦探办案推演结论导出（Investigation Directives）：
 *      当证据链闭环率达到一定阈值时，自动向大模型注入揭露真相或对质审讯的高阶引导。
 * ============================================================ */

export const EVIDENCE_SOURCE = Object.freeze({
    WECHAT: 'wechat',
    ALBUM: 'album',
    WALLET: 'wallet',
    MEMO: 'memo'
});

export function createInitialEvidenceMatrixState() {
    return {
        evidenceNodes: new Map(), // evidenceId -> evidenceNode
        cluesLinks: [],           // [{ fromId, toId, relation, weight }]
        contradictions: [],
        updatedAt: Date.now()
    };
}

export function registerEvidenceNode(state, spec = {}) {
    if (!state || !state.evidenceNodes) return null;
    const id = String(spec.id || `evi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const node = {
        id,
        source: Object.values(EVIDENCE_SOURCE).includes(spec.source) ? spec.source : EVIDENCE_SOURCE.MEMO,
        actor: String(spec.actor || 'suspect').trim(),
        timestamp: Number(spec.timestamp) || Date.now(),
        location: String(spec.location || '').trim(),
        claimOrFact: String(spec.claimOrFact || spec.content || '').trim(),
        isAlibi: spec.isAlibi === true,
        createdAt: Date.now()
    };

    state.evidenceNodes.set(id, node);
    state.updatedAt = Date.now();
    return node;
}

export function detectEvidenceContradictions(state) {
    if (!state || !state.evidenceNodes || state.evidenceNodes.size < 2) return [];
    const nodes = Array.from(state.evidenceNodes.values());
    const contradictions = [];

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];

            if (a.actor.toLowerCase() === b.actor.toLowerCase()) {
                // 时间接近（1小时内）但地点冲突
                const timeDiff = Math.abs(a.timestamp - b.timestamp);
                if (timeDiff <= 3600000 && a.location && b.location && a.location !== b.location) {
                    const c = {
                        id: `contra_${a.id}_${b.id}`,
                        actor: a.actor,
                        evidenceA: a,
                        evidenceB: b,
                        reason: `时间间隔仅${Math.round(timeDiff/60000)}分钟，但${a.source}记录在“${a.location}”，而${b.source}记录在“${b.location}”，不在场证明严重冲突！`
                    };
                    contradictions.push(c);
                }
            }
        }
    }

    state.contradictions = contradictions;
    state.updatedAt = Date.now();
    return contradictions;
}

export function resolveInvestigationDirectives(state, suspectName = '') {
    if (!state) return [];
    const contra = detectEvidenceContradictions(state);
    const dirs = [];

    for (const c of contra) {
        if (!suspectName || c.actor.toLowerCase() === suspectName.toLowerCase()) {
            dirs.push(`【侦探破绽证据链】针对${c.actor}的跨应用物证发现致命破绽：${c.reason}。可在对质对话中以此铁证强势戳穿其谎言！`);
        }
    }

    return dirs;
}

const CrossAppEvidenceChainMatrix = {
    EVIDENCE_SOURCE,
    createInitialEvidenceMatrixState,
    registerEvidenceNode,
    detectEvidenceContradictions,
    resolveInvestigationDirectives
};

export default CrossAppEvidenceChainMatrix;