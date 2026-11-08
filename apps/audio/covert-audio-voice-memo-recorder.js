/* ============================================================
 * covert-audio-voice-memo-recorder.js — [v4.139.0 · 第十八期全新拟真生态]
 * 全息录音笔与息屏暗访秘密取证系统 (Covert Audio Voice Memo Recorder)
 * ------------------------------------------------------------
 * 【核心机制与刑侦调查】
 * 解决手机调查取证工具链闭环：
 *   - 后台息屏录音: 屏幕完全漆黑，无红点无提示暗中录制关键对话；
 *   - 动态波形与打点标记: 实时音频分贝采样（0~100dB），支持一键在波形时间戳上打下【物证锚点】；
 *   - 语音转文字智能速记: 自动提取音频对话要点，输出物证直通相册与司法对撞链。
 * ============================================================ */

export class CovertAudioVoiceMemoRecorder {
    constructor(options = {}) {
        this.options = Object.assign({
            sampleRateHz: 44100,
            covertScreenBlackout: true
        }, options);

        this.recordingSessions = new Map(); // id -> { id, title, durationSec, keyPins: [], transcriptSummary, isCovert }
        this.currentActiveId = null;
    }

    startRecording(title = "未命名录音", isCovert = true) {
        const id = "memo_" + Date.now();
        const session = {
            id,
            title,
            isCovert: !!isCovert,
            durationSec: 0,
            keyPins: [],
            transcriptSummary: "",
            status: "recording",
            startedAt: Date.now()
        };

        this.recordingSessions.set(id, session);
        this.currentActiveId = id;
        return session;
    }

    addPinMarker(note = "突发交谈转折") {
        if (!this.currentActiveId) return null;
        const current = this.recordingSessions.get(this.currentActiveId);
        if (!current) return null;

        const pin = {
            sec: current.durationSec,
            note,
            pinnedAt: Date.now()
        };
        current.keyPins.push(pin);
        return pin;
    }

    stopRecording(transcript = "") {
        if (!this.currentActiveId) return null;
        const current = this.recordingSessions.get(this.currentActiveId);
        if (!current) return null;

        current.status = "saved";
        current.transcriptSummary = transcript || "【录音转文字完成】录下了现场关键对话录音物证。";
        current.durationSec = Math.max(5, Math.floor((Date.now() - current.startedAt) / 1000));
        this.currentActiveId = null;
        return current;
    }

    formatAudioPrompt() {
        if (this.recordingSessions.size === 0) return "";
        const latest = Array.from(this.recordingSessions.values()).slice(-2);
        const lines = ["【全息语音备忘录·暗中录音物证】"];
        for (const s of latest) {
            lines.push(`- 录音 [${s.title}] (${s.durationSec}s, ${s.isCovert ? "息屏暗访" : "常规录音"}): \"${s.transcriptSummary}\" (标记了${s.keyPins.length}处疑点)`);
        }
        return lines.join("\n");
    }

    exportState() {
        return {
            recordingSessions: Array.from(this.recordingSessions.entries()),
            currentActiveId: this.currentActiveId
        };
    }

    hydrateState(state) {
        if (!state) return;
        this.currentActiveId = state.currentActiveId || null;
        if (Array.isArray(state.recordingSessions)) {
            this.recordingSessions = new Map(state.recordingSessions);
        }
    }
}

export default CovertAudioVoiceMemoRecorder;