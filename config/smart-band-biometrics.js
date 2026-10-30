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
/* [v4.99.6 · R11-X8] 采样历史上限。
 *   为什么要有：`historyLog` 从 R10 起就声明在构造器里，但**全库没有一处写过它** ——
 *   「心率曲线」这件事在手机里从来没存在过（健康 App 只能显示一个当前值）。
 *   现在补上采样口与落盘；上限按「一晚睡眠 8h × 每 2 分钟一点」再留余量取 240，
 *   免得长剧情里数组无界增长（那是本仓治过的长线熵增形态之一）。 */
export const BAND_HISTORY_MAX = 240;

export class SmartBandBiometrics {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.heartRate = opts.initialHeartRate || 72;
        this.stressLevel = 25; // 0 ~ 100
        this.sleepStage = SLEEP_STAGES.AWAKE;
        this.dailySteps = 4520;
        /* [v4.99.6 · R11-X8] 采样历史：每点 { t, hr, stage }。
         *   与 _save 的那几个字段不同，它**当初没被 _save 带走**（落盘对象里没有 historyLog），
         *   于是即便有人写了采样，重载也会整条曲线消失。本版一并补进落盘。 */
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
                // [v4.99.6 · R11-X8] 曲线可回溯：重载后采样历史必须还在，
                //   否则「回看这条曲线」在换楼/重开后就成了空的。
                if (Array.isArray(raw.historyLog)) {
                    this.historyLog = raw.historyLog
                        .filter(p => p && typeof p === 'object')
                        .slice(-BAND_HISTORY_MAX);
                }
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
                // [v4.99.6 · R11-X8] 曲线随盘走（上限见 BAND_HISTORY_MAX）。
                historyLog: this.historyLog.slice(-BAND_HISTORY_MAX),
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
        /* [v4.99.6 · R11-X8] 每次生理变动之后自动采一点 —— 曲线于是「自己长出来」。
         *   ★ 这一步只做采样、不改前面算出来的返回值（返回值是业务结论，采样是留痕）。 */
        try { this.sample(meta && meta.at); } catch (_e) { /* 采样坏了不改业务结论 */ }
        return {
            heartRate: this.heartRate,
            stressLevel: this.stressLevel,
            resonanceTitle,
            alert
        };
    }

    /**
     * [v4.99.6 · R11-X8] 采一个点进曲线（historyLog 的**唯一**写入口）。
     *   为什么要有这个口：`historyLog` 从 R10 声明至今全库零写入 —— 曲线永远空着，
     *   健康 App 只能显示「当前值」这一个数。采样挂在**每次生理状态变动之后**自动发生，
     *   不依赖谁记得手动记一笔（那种「靠自觉」的口最后总是没人调，本仓治过同族）。
     * @param {number} [now] 采样时刻（毫秒）；显式传入便于判据用受控时间。
     * @returns {{t:number, hr:number, stage:string}} 本点
     */
    sample(now) {
        const n = Number(now);
        const t = Number.isFinite(n) ? n : Date.now();
        const point = { t, hr: this.heartRate, stage: this.sleepStage };
        this.historyLog.push(point);
        if (this.historyLog.length > BAND_HISTORY_MAX) {
            this.historyLog = this.historyLog.slice(-BAND_HISTORY_MAX);
        }
        this._save();
        return point;
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