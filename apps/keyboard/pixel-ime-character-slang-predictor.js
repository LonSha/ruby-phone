/* ============================================================
 * pixel-ime-character-slang-predictor.js — [v4.138.0 · V21-R6]
 * 掌机像素虚拟键盘与角色口癖动态联想输入法 (Pixel IME Slang Predictor)
 * ------------------------------------------------------------
 * 1. 掌机按键音效反馈与复古像素按键 (Pixel Keycap Audio Haptics)
 * 2. 对话角色好感度与专属口癖智能预测词库 (Slang & Quirk Predictor)
 * 3. 长篇输入草稿防抖毫秒级持久化 (Draft Auto-Saver)
 * ============================================================ */
export function predictSlangCandidates(prefix = "", characterSlangProfile = {}) {
    const p = String(prefix || "").trim().toLowerCase();
    const commonSlangs = Array.isArray(characterSlangProfile.slangs) ? characterSlangProfile.slangs : ["笨蛋", "才没有", "听好了"];
    if (!p) return commonSlangs.slice(0, 4);

    const matches = commonSlangs.filter(s => s.toLowerCase().startsWith(p) || s.toLowerCase().includes(p));
    return matches.length > 0 ? matches : [p];
}

export function saveImeDraft(storage, draftKey, text) {
    if (!storage || !draftKey) return false;
    try {
        storage.setItem(`ime_draft_${draftKey}`, JSON.stringify({
            text: String(text || ""),
            savedAt: Date.now()
        }));
        return true;
    } catch (e) {
        return false;
    }
}
