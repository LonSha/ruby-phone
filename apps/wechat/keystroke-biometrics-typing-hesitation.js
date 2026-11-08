/* ============================================================
 * keystroke-biometrics-typing-hesitation.js — [v4.139.0 · 第十八期全新拟真生态]
 * 输入法行为学打字撤回与犹豫测谎引擎 (Keystroke Biometrics & Typing Hesitation)
 * ------------------------------------------------------------
 * 【核心机制与行为拟真】
 * 突破机械式“一键发送”的消息生成体验：
 *   模拟真实人类聊天输入过程中的微行为——
 *   - 犹豫延迟 (Hesitation Latency): 情感激烈时的打字长时停顿与反复 Backspace 删改；
 *   - 未发送的潜台词草稿 (Unsent Drafts): 输入了三行心事但最终默默清空，保留内心潜台词物证；
 *   - 手滑手误与 2 秒内紧急撤回 (Miskey & Swift Recall): 拟真人类发错消息后的慌乱补发。
 * ============================================================ */

export class KeystrokeBiometricsTypingHesitation {
    constructor(options = {}) {
        this.options = Object.assign({
            hesitationBaseMs: 1500,
            miskeyProbability: 0.15,
            recallWindowMs: 3000
        }, options);
        this.draftArchive = []; // [{ id, chatId, rawDraft, finalizedMessage, hesitationDurationMs, timestamp }]
        this.recallEvents = []; // [{ id, chatId, recalledMessage, replacementMessage, recallTimestamp }]
    }

    /**
     * 模拟打字过程：评估犹豫时长并记录清空的草稿潜台词
     * @param {string} rawDraft 心理犹豫时原本打在输入框里的草稿
     * @param {string} finalizedMessage 最终下定决心发送的简短信息
     * @param {number} emotionalArousal 情感张力 (0~1)
     */
    simulateTypingSession(chatId, rawDraft, finalizedMessage, emotionalArousal = 0.5) {
        const hesitationDurationMs = Math.floor(
            this.options.hesitationBaseMs + (emotionalArousal * 4000) + Math.random() * 1500
        );

        const session = {
            id: "draft_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            chatId,
            rawDraft: rawDraft || "",
            finalizedMessage: finalizedMessage || "",
            hesitationDurationMs,
            isSubstantiallyDeleted: (rawDraft && rawDraft !== finalizedMessage),
            timestamp: Date.now()
        };

        if (session.isSubstantiallyDeleted) {
            this.draftArchive.push(session);
        }

        return session;
    }

    /**
     * 模拟打错字并紧急撤回重发
     */
    simulateMiskeyAndRecall(chatId, erroneousMessage, correctedMessage) {
        const recallId = "recall_" + Date.now();
        const record = {
            id: recallId,
            chatId,
            recalledMessage: erroneousMessage,
            replacementMessage: correctedMessage,
            recallTimestamp: Date.now(),
            statusTag: "[对方撤回了一条消息]"
        };

        this.recallEvents.push(record);
        return record;
    }

    formatUnsentDraftsForPrompt(chatId, limit = 2) {
        const matched = this.draftArchive
            .filter(d => !chatId || d.chatId === chatId)
            .slice(-limit);

        if (matched.length === 0) return "";
        const lines = ["【手机输入法行为学·未发送草稿物证】"];
        for (const d of matched) {
            lines.push(`- 犹豫耗时 ${(d.hesitationDurationMs / 1000).toFixed(1)}s，曾输入删掉的潜台词: \"${d.rawDraft}\" -> 最终勉强发出: \"${d.finalizedMessage}\"`);
        }
        return lines.join("\n");
    }

    exportState() {
        return {
            draftArchive: [...this.draftArchive],
            recallEvents: [...this.recallEvents]
        };
    }

    hydrateState(state) {
        if (!state) return;
        if (Array.isArray(state.draftArchive)) this.draftArchive = [...state.draftArchive];
        if (Array.isArray(state.recallEvents)) this.recallEvents = [...state.recallEvents];
    }
}

export default KeystrokeBiometricsTypingHesitation;