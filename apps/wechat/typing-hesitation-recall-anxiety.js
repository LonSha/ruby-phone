/* ============================================================
 * typing-hesitation-recall-anxiety.js — 微信打字犹豫停顿与撤回消息焦虑机
 * [v4.140.0 · 正在输入状态反复闪烁、迟疑秒数与撤回消息悬念]
 * ============================================================ */

export class TypingHesitationRecallAnxiety {
    constructor(options = {}) {
        this.options = Object.assign({
            maxRecallWindowSec: 120,
            hesitationNoticeFloorSec: 3.0
        }, options);
        
        this.recalledVault = [];
        this.hesitationTelemetry = [];
    }

    recordTypingHesitation(contactId, originalRawDraft, sentSanitizedText, durationSec = 4.8) {
        const dur = Math.max(0.5, Number(durationSec) || 4.8);
        const isDraftModified = originalRawDraft !== sentSanitizedText;

        const record = {
            id: `type_${Date.now()}`,
            contactId,
            originalRawDraft: String(originalRawDraft || "").trim(),
            sentSanitizedText: String(sentSanitizedText || "").trim(),
            hesitationDurationSec: dur,
            isDraftModified,
            timestamp: Date.now()
        };

        this.hesitationTelemetry.push(record);
        if (this.hesitationTelemetry.length > 30) this.hesitationTelemetry.shift();

        return {
            contactId,
            hesitationDurationSec: dur,
            indicatorPulseCount: Math.round(dur / 1.5),
            narrativeBehavior: dur >= this.options.hesitationNoticeFloorSec
                ? `对方屏幕顶部的「正在输入……」反反复复亮起又熄灭，迟疑了整整 ${dur.toFixed(1)} 秒，最终只发出简短一句。`
                : "正常回复。"
        };
    }

    executeEmergencyRecall(messageId, senderName, rawContent) {
        const recallId = `rec_${Date.now()}`;
        const record = {
            recallId,
            messageId,
            sender: senderName,
            originalContent: rawContent,
            recalledAt: Date.now(),
            chatNotice: `"${senderName}" 撤回了一条消息`,
            anxietyResidue: "消息虽被秒速抹除，但空白的撤回提示在二人之间留下了巨大的情绪悬念与不安。"
        };

        this.recalledVault.push(record);
        if (this.recalledVault.length > 20) this.recalledVault.shift();
        return record;
    }

    exportState() {
        return {
            recalledVault: this.recalledVault,
            hesitationTelemetry: this.hesitationTelemetry
        };
    }

    hydrateState(state) {
        if (!state) return;
        if (Array.isArray(state.recalledVault)) this.recalledVault = [...state.recalledVault];
        if (Array.isArray(state.hesitationTelemetry)) this.hesitationTelemetry = [...state.hesitationTelemetry];
    }
}
if (typeof globalThis !== "undefined") { globalThis.TypingHesitationRecallAnxiety = TypingHesitationRecallAnxiety; }
if (typeof window !== "undefined") { window.TypingHesitationRecallAnxiety = TypingHesitationRecallAnxiety; }
if (typeof module !== "undefined" && module.exports) { module.exports = TypingHesitationRecallAnxiety; }
export default TypingHesitationRecallAnxiety;