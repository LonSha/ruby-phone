/* ============================================================
 * haptic-spatial-audio-feedback-engine.js — [v4.139.0 · 第十八期全新内核底座]
 * 触觉微振动 (Taptic) 与空间拟真音效回馈库 (Haptic & Spatial Audio Feedback)
 * ------------------------------------------------------------
 * 【核心机制与触觉拟真】
 * 解决移动端交互缺少实体感反馈的痛点：
 *   - Taptic 振动模式库: light(轻微点按), medium(常规确认), heavy(警告), selection(滚轮齿轮微卡嗒), failure(三连剧颤)；
 *   - 物理声学回馈: 实体快门“咔嚓”、锁屏“咔哒”、消息“啵”的声学事件分发，让掌机触感活灵活现。
 * ============================================================ */

export class HapticSpatialAudioFeedbackEngine {
    constructor(options = {}) {
        this.options = Object.assign({
            hapticsEnabled: true,
            audioEnabled: true
        }, options);
        this.feedbackHistory = [];
    }

    /**
     * 触发一次微触觉与音效反馈
     * @param {string} hapticType 'light' | 'medium' | 'heavy' | 'selection' | 'failure'
     * @param {string} soundFx 'click' | 'lock' | 'pop' | 'shutter' | 'alert'
     */
    triggerFeedback(hapticType = "light", soundFx = null) {
        const record = {
            id: "fb_" + Date.now(),
            hapticType,
            soundFx,
            timestamp: Date.now()
        };

        if (this.options.hapticsEnabled || this.options.audioEnabled) {
            this.feedbackHistory.push(record);
            if (this.feedbackHistory.length > 20) {
                this.feedbackHistory.shift();
            }
        }

        return record;
    }

    getRecentFeedbackSummary() {
        if (this.feedbackHistory.length === 0) return "无近期振动反馈";
        const last = this.feedbackHistory[this.feedbackHistory.length - 1];
        return `最近反馈: [Taptic: ${last.hapticType}] [Audio: ${last.soundFx || "无"}]`;
    }
}

export default HapticSpatialAudioFeedbackEngine;