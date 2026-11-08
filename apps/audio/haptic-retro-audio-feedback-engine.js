/* ============================================================
 * haptic-retro-audio-feedback-engine.js — 像素级动效插值与8-bit复古交互音效引擎
 * [v4.140.0 · 掌机按键音浪合成、触觉振动反馈与沉浸敲击声效]
 * ============================================================ */

export class HapticRetroAudioFeedbackEngine {
    constructor() {
        this.audioSynthesisPresets = {
            keyClick: { waveform: "square", frequency: 440, durationMs: 18, gain: 0.25 },
            messageSent: { waveform: "sine", frequency: 880, durationMs: 90, gain: 0.4 },
            alertChime: { waveform: "triangle", frequency: 587, durationMs: 140, gain: 0.5 },
            powerLock: { waveform: "sawtooth", frequency: 220, durationMs: 35, gain: 0.3 }
        };
        this.feedbackHistory = [];
    }

    triggerFeedback(presetKey = "keyClick", hapticScale = 1.0) {
        const preset = this.audioSynthesisPresets[presetKey] || this.audioSynthesisPresets.keyClick;
        const hapticDuration = Math.round(preset.durationMs * Math.min(2.0, Math.max(0.1, hapticScale)));

        const feedbackEvent = {
            preset: presetKey,
            waveform: preset.waveform,
            frequencyHz: preset.frequency,
            soundDurationMs: preset.durationMs,
            vibrationDurationMs: hapticDuration,
            timestamp: Date.now()
        };

        this.feedbackHistory.push(feedbackEvent);
        if (this.feedbackHistory.length > 50) this.feedbackHistory.shift();

        return feedbackEvent;
    }
}
if (typeof globalThis !== "undefined") { globalThis.HapticRetroAudioFeedbackEngine = HapticRetroAudioFeedbackEngine; }
if (typeof window !== "undefined") { window.HapticRetroAudioFeedbackEngine = HapticRetroAudioFeedbackEngine; }
if (typeof module !== "undefined" && module.exports) { module.exports = HapticRetroAudioFeedbackEngine; }
export default HapticRetroAudioFeedbackEngine;