/* ========================================================
 * config/smart-band-biometrics.js
 * RubyPhone R10-X6 · 角色健康手环与生理指标心率联动
 * 
 * 核心机制：
 * 1. 穿戴式生理指标动力学模型 (Biometric Dynamic Engine):
 *    - 实时心率 (Heart Rate: 60~180 bpm)
 *    - 压力指数 (Stress Level: 0~100)
 *    - 睡眠阶段与质量 (SLEEP_STAGE: DEEP, LIGHT, REM, AWAKE)
 * 2. 剧情心动/惊悚与预警联动 (Dramatic Biometric Resonance):
 *    - 当角色心率 > 130 且处于亲密/对质场景时，触发 HEART_RACE_ALERT（心跳加速心动预警）
 *    - 压力指数过高时推送 "呼吸调节引导"
 * 3. 健康周报与生命体征数据物化 (Biometric Weekly Digest):
 *    - 生成近 7 天步数、睡眠时长与卡路里消耗概览
 * ======================================================== */

export const SLEEP_STAGES = Object.freeze({
    DEEP: 'DEEP',
    LIGHT: 'LIGHT',
    REM: 'REM',
    AWAKE: 'AWAKE'
});

export class SmartBandBiometrics {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.heartRate = opts.initialHeartRate || 72;
        this.stressLevel = 25; // 0 ~ 100
        this.sleepStage = SLEEP_STAGES.AWAKE;
        this.dailySteps = 4520;
        this.historyLog = [];
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('smart_band_biometrics_data', null);
            if (raw) {
                if (raw.heartRate) this.heartRate = raw.heartRate;
                if (raw.stressLevel) this.stressLevel = raw.stressLevel;
                if (raw.dailySteps) this.dailySteps = raw.dailySteps;
            }
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('smart_band_biometrics_data', {
                heartRate: this.heartRate,
                stressLevel: this.stressLevel,
                dailySteps: this.dailySteps,
                updatedAt: Date.now()
            });
        } catch (_e) {}
    }

    /**
     * 依据剧情情境突发事件触发心率与压力共振
     * @param {string} scenarioType 'INTIMATE_MOMENT' | 'CONFRONTATION' | 'CALM_REST' | 'PANIC'
     * @param {Object} [meta]
     * @returns {Object} 预警与生理状态
     */
    modulateBiometricsByEvent(scenarioType, meta = {}) {
        let hrDelta = 0;
        let stressDelta = 0;
        let resonanceTitle = '平稳心率';

        switch (scenarioType) {
            case 'INTIMATE_MOMENT': // 告白、拥抱、极度心动
                hrDelta = Math.round(35 + Math.random() * 20);
                stressDelta = 10;
                resonanceTitle = '心跳急剧加速（心动过载）';
                break;
            case 'CONFRONTATION': // 谎言拆穿、剑拔弩张
                hrDelta = Math.round(40 + Math.random() * 25);
                stressDelta = 45;
                resonanceTitle = '应激压力激增';
                break;
            case 'PANIC': // 惊悚、密室逃亡
                hrDelta = Math.round(55 + Math.random() * 30);
                stressDelta = 60;
                resonanceTitle = '恐慌级心律失常预警';
                break;
            case 'CALM_REST': // 闲聊、散步、睡前
            default:
                hrDelta = -15;
                stressDelta = -20;
                resonanceTitle = '生命体征平稳回落';
                break;
        }

        this.heartRate = Math.max(55, Math.min(185, this.heartRate + hrDelta));
        this.stressLevel = Math.max(5, Math.min(100, this.stressLevel + stressDelta));

        let alert = null;
        if (this.heartRate >= 135) {
            alert = {
                type: 'HEART_RATE_SPIKE',
                message: `[手环预警] 检测到心率骤升至 ${this.heartRate} bpm！请注意深呼吸`,
                bpm: this.heartRate,
                reason: resonanceTitle
            };
        } else if (this.stressLevel >= 75) {
            alert = {
                type: 'HIGH_STRESS_WARNING',
                message: `[健康提醒] 当前处于极度精神紧绷状态（压力 ${this.stressLevel}）`,
                stress: this.stressLevel
            };
        }

        this._save();

        return {
            heartRate: this.heartRate,
            stressLevel: this.stressLevel,
            resonanceTitle,
            alert
        };
    }

    /**
     * 同步夜间睡眠数据
     */
    syncSleepSession(deepMins = 120, lightMins = 240, remMins = 90) {
        const totalMinutes = deepMins + lightMins + remMins;
        const sleepScore = Math.min(100, Math.round((deepMins / totalMinutes) * 120 + (totalMinutes / 480) * 40));

        return {
            totalHours: Number((totalMinutes / 60).toFixed(1)),
            deepMinutes: deepMins,
            lightMinutes: lightMins,
            remMinutes: remMins,
            sleepScore,
            verdict: sleepScore >= 80 ? '睡眠充足，活力充沛' : '深度睡眠偏少，易疲劳'
        };
    }
}