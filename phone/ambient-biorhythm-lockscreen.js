/**
 * 呼吸氛围情境动态锁屏与心率微光投影 (Ambient Biorhythm Lockscreen)
 * 依据现实气象、剧情心率(BPM)与羁绊好感，动态演化锁屏粒子呼吸光晕与微光投影
 */
export class AmbientBiorhythmLockscreen {
    constructor() {
        this.currentState = {
            weatherMood: 'RAINY_REFLECTIVE', // SUNNY | RAINY_REFLECTIVE | MIDNIGHT_NEON | SNOWY_SOLITUDE
            heartRateBpm: 75,
            particleSpeed: 1.0,
            auraGlowHex: '#4A90E2',
            pulseFrequencyHz: 1.25 // 75 bpm / 60
        };
    }

    /**
     * 更新锁屏情绪与生理环境
     */
    updateBiorhythm({ weather = 'RAINY', bpm = 75, intimacyLevel = 50 }) {
        this.currentState.heartRateBpm = bpm;
        this.currentState.pulseFrequencyHz = +(bpm / 60).toFixed(2);

        // 依据心率动态调整粒子流动速度与光圈色调
        if (bpm > 110) {
            // 心跳加速（紧张/心动/惊悚）
            this.currentState.particleSpeed = 2.5;
            this.currentState.auraGlowHex = '#FF4D6D'; // 绯红微光
            this.currentState.weatherMood = 'RACING_PULSE_ALERT';
        } else if (bpm < 60) {
            // 沉静/入眠
            this.currentState.particleSpeed = 0.5;
            this.currentState.auraGlowHex = '#3A0CA3'; // 深蓝静谧
            this.currentState.weatherMood = 'DEEP_SLUMBER';
        } else {
            // 正常温和陪伴
            this.currentState.particleSpeed = 1.0;
            this.currentState.auraGlowHex = intimacyLevel > 80 ? '#F72585' : '#4CC9F0';
            this.currentState.weatherMood = weather;
        }

        return {
            ...this.currentState,
            renderSpecs: {
                cssFilter: `drop-shadow(0 0 15px ${this.currentState.auraGlowHex})`,
                animationDurationSec: +(1 / this.currentState.pulseFrequencyHz).toFixed(2)
            }
        };
    }

    getState() {
        return { ...this.currentState };
    }
}

export default AmbientBiorhythmLockscreen;