/* ============================================================
 * config/diff-review-pipeline.js — [R9-O6 · 第九期规划]
 * 创作与资料差异审阅流水线（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   针对多版本草稿与资料派生物，提供行级/段级差异比对：
 *     - IDENTICAL: 无变更
 *     - ADDED:     新增段落
 *     - MODIFIED:  修改段落（展示旧版 vs 新版）
 *     - DELETED:   移除段落
 *   支持对特定段落锁定人工保护，防止模型更新将其覆盖。
 * ============================================================ */

export const DIFF_TYPES = Object.freeze({
    IDENTICAL: 'identical',
    ADDED: 'added',
    MODIFIED: 'modified',
    DELETED: 'deleted'
});

export function computeParagraphDiff(baseParagraphs, incomingParagraphs, options = {}) {
    const base = Array.isArray(baseParagraphs) ? baseParagraphs.map(String) : [];
    const incoming = Array.isArray(incomingParagraphs) ? incomingParagraphs.map(String) : [];
    const lockedIndices = new Set(Array.isArray(options.lockedIndices) ? options.lockedIndices : []);

    const diffResults = [];
    const maxLen = Math.max(base.length, incoming.length);

    for (let i = 0; i < maxLen; i++) {
        const bText = base[i] != null ? base[i].trim() : null;
        const iText = incoming[i] != null ? incoming[i].trim() : null;
        const isLocked = lockedIndices.has(i);

        if (bText != null && iText != null) {
            if (bText === iText) {
                diffResults.push({ index: i, type: DIFF_TYPES.IDENTICAL, text: bText, isLocked });
            } else {
                diffResults.push({
                    index: i,
                    type: DIFF_TYPES.MODIFIED,
                    baseText: bText,
                    incomingText: iText,
                    isLocked
                });
            }
        } else if (bText != null && iText == null) {
            diffResults.push({ index: i, type: DIFF_TYPES.DELETED, text: bText, isLocked });
        } else if (bText == null && iText != null) {
            diffResults.push({ index: i, type: DIFF_TYPES.ADDED, text: iText, isLocked: false });
        }
    }

    return {
        totalParagraphs: diffResults.length,
        hasModifications: diffResults.some(d => d.type !== DIFF_TYPES.IDENTICAL),
        diffs: diffResults
    };
}