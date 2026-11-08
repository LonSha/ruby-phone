/* ============================================================
 * smart-wearable-biometric-interop-v2.js — 智能穿戴手环与生物体征动态同步机
 * [v4.140.0 · 动态心率波动、应激压力指数与生理体征实时投射]
 * ============================================================ */

export class SmartWearableBiometricInteropV2 {
    constructor(options = {}) {
        this.options = Object.assign({
            restingBpm: 70,
            maxBpm: 185,
            vibrationStressThreshold: 80
        }, options);
        this.telemetryHistory = [];
    }

    sampleBiometrics(emotionalState = "normal", isExercising = false) {
        let bpm = this.options.restingBpm;
        let stressIndex = 20;

        if (emotionalState === "panic" || emotionalState === "shock") {
            bpm = 138;
            stressIndex = 95;
        } else if (emotionalState === "flustered" || emotionalState === "romantic_tension") {
            bpm = 112;
            stressIndex = 68;
        } else if (emotionalState === "anger") {
            bpm = 125;
            stressIndex = 88;
        } else if (emotionalState === "sleeping") {
            bpm = 56;
            stressIndex = 8;
        }

        if (isExercising) {
            bpm = Math.min(this.options.maxBpm, bpm + 35);
        }

        const isAlertVibrating = stressIndex >= this.options.vibrationStressThreshold || bpm > 130;
        const record = {
            heartRateBpm: bpm,
            stressIndex,
            isAlertVibrating,
            timestamp: Date.now()
        };
        
        this.telemetryHistory.push(record);
        if (this.telemetryHistory.length > 30) this.telemetryHistory.shift();

        return {
            heartRateBpm: bpm,
            stressIndex,
            statusTitle: bpm > 120 ? "心率骤升·手环触觉振动" : (bpm < 60 ? "深度静息" : "平稳生理态"),
            promptDirective: `【智能穿戴实时体征】手环传感器监测：即时心率 ${bpm} bpm，压力指数 ${stressIndex}/100（${record.statusTitle}）。`
        };
    }

    exportState() {
        return { telemetryHistory: this.telemetryHistory };
    }

    hydrateState(state) {
        if (!state) return;
        if (Array.isArray(state.telemetryHistory)) this.telemetryHistory = [...state.telemetryHistory];
    }
}
if (typeof globalThis !== "undefined") { globalThis.SmartWearableBiometricInteropV2 = SmartWearableBiometricInteropV2; }
if (typeof window !== "undefined") { window.SmartWearableBiometricInteropV2 = SmartWearableBiometricInteropV2; }
if (typeof module !== "undefined" && module.exports) { module.exports = SmartWearableBiometricInteropV2; }
export default SmartWearableBiometricInteropV2;