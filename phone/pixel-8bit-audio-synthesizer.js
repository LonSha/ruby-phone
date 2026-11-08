/* ============================================================
 * pixel-8bit-audio-synthesizer.js — [v4.138.0 · V21-R2]
 * 复古掌机 8-bit WebAudio 纯音合成器 (Pixel 8-Bit Audio Synthesizer)
 * ------------------------------------------------------------
 * 1. 纯 WebAudio 方波/三角波合成（零外部音频文件依赖）
 * 2. 经典掌机音效预设 (Click, Pop, Warp, Beep, Error)
 * 3. 音量与静音环境感知管控 (Acoustic Context Manager)
 * ============================================================ */
export const SFX_TYPE = Object.freeze({
    CLICK: "click",
    SELECT: "select",
    BACK: "back",
    POPUP: "popup",
    ERROR: "error"
});

export function play8BitSfx(type = SFX_TYPE.CLICK, options = {}) {
    if (typeof window === "undefined" || !window.AudioContext && !window.webkitAudioContext) {
        return false;
    }
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = options.audioContext || new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "square"; // 经典复古 8-bit 方波
        const now = ctx.currentTime;
        const volume = Number(options.volume ?? 0.15);

        switch (type) {
            case SFX_TYPE.SELECT:
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
                gain.gain.setValueAtTime(volume, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                osc.start(now);
                osc.stop(now + 0.08);
                break;
            case SFX_TYPE.BACK:
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(300, now + 0.06);
                gain.gain.setValueAtTime(volume, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
                osc.start(now);
                osc.stop(now + 0.06);
                break;
            case SFX_TYPE.ERROR:
                osc.frequency.setValueAtTime(150, now);
                gain.gain.setValueAtTime(volume * 1.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
                osc.start(now);
                osc.stop(now + 0.12);
                break;
            case SFX_TYPE.CLICK:
            default:
                osc.frequency.setValueAtTime(800, now);
                gain.gain.setValueAtTime(volume, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);
                osc.start(now);
                osc.stop(now + 0.03);
                break;
        }

        osc.connect(gain);
        gain.connect(ctx.destination);
        return true;
    } catch (e) {
        return false;
    }
}
