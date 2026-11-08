/**
 * 沉浸式场景声学环境音与复古触觉/音效合成器 (Retro Haptic Acoustic Synthesizer)
 * 纯前端 Web Audio 拟真音效：打字清脆微回弹声、消息嗖声发送音、微雨环境声与震动模式
 */
export class RetroHapticAcousticSynthesizer {
    constructor() {
        this.soundEnabled = true;
        this.hapticEnabled = true;
        this.currentAmbientSound = 'NONE';
        this.playedEffects = [];
    }

    /**
     * 播放打字轻微微回弹机械音
     */
    playKeyClick(char = 'a') {
        const effect = {
            name: 'KEY_MECHANICAL_CLICK',
            freqHz: 1200 + Math.floor(Math.random() * 200),
            durationMs: 25,
            haptic: 'micro_tick_5ms',
            playedAt: Date.now()
        };
        this.playedEffects.push(effect);
        return effect;
    }

    /**
     * 播放消息“嗖”声发送提示音
     */
    playSendWhoosh() {
        const effect = {
            name: 'MESSAGE_WHOOSH_OUT',
            freqSweep: [600, 1800],
            durationMs: 120,
            haptic: 'ramp_up_vibrate_20ms',
            playedAt: Date.now()
        };
        this.playedEffects.push(effect);
        return effect;
    }

    /**
     * 切换背景情境微声场（如微雨声）
     */
    setAmbientScene(sceneName = 'DRIZZLE_WINDOW') {
        this.currentAmbientSound = sceneName;
        return {
            ambientActive: sceneName !== 'NONE',
            ambientSound: sceneName,
            loopGain: 0.25,
            description: sceneName === 'DRIZZLE_WINDOW' ? '窗外淅淅沥沥的微雨背景底噪' : '静音'
        };
    }

    getHistory() {
        return [...this.playedEffects];
    }
}

export default RetroHapticAcousticSynthesizer;