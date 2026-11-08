/* ============================================================
 * dynamic-power-battery-physics.js — 拟真动态电池放电与超级低功耗模式模拟器
 * [v4.140.0 · 物理耗电衰减模型、电量红线与超级省电态]
 * ============================================================ */

export class DynamicPowerBatteryPhysics {
    constructor(options = {}) {
        this.options = Object.assign({
            initialPercent: 88,
            lowPowerThreshold: 20,
            criticalPowerThreshold: 5,
            idleDrainPerHour: 1.2
        }, options);
        
        this.batteryLevel = Math.max(0, Math.min(100, Number(this.options.initialPercent) || 88));
        this.isLowPowerModeActive = false;
        this.isCharging = false;
        this.temperatureCelsius = 31.5;
        this.drainHistory = [];
    }

    stepDrain(activityMetrics = {}) {
        if (this.isCharging) return { batteryLevel: this.batteryLevel, isCharging: true };

        const elapsedMinutes = Math.max(1, Number(activityMetrics.elapsedMinutes) || 15);
        const brightness = Math.min(1.0, Math.max(0.1, Number(activityMetrics.screenBrightness) || 0.6));
        const runningApps = Math.max(1, Number(activityMetrics.activeAppCount) || 1);

        // 耗电速率推导
        const baseDrain = (this.options.idleDrainPerHour / 60) * elapsedMinutes;
        const screenDrain = (brightness * 3.5 / 60) * elapsedMinutes;
        const cpuDrain = (runningApps * 0.8 / 60) * elapsedMinutes;
        
        let totalDrain = baseDrain + screenDrain + cpuDrain;
        if (this.isLowPowerModeActive) {
            totalDrain *= 0.35; // 低功耗模式节电 65%
        }

        this.batteryLevel = Math.max(0, Number((this.batteryLevel - totalDrain).toFixed(1)));
        this.temperatureCelsius = Number((30 + (runningApps * 1.8) + (brightness * 2.5)).toFixed(1));

        if (this.batteryLevel <= this.options.lowPowerThreshold) {
            this.isLowPowerModeActive = true;
        }

        const statusRecord = {
            batteryLevel: this.batteryLevel,
            temperatureC: this.temperatureCelsius,
            isLowPowerMode: this.isLowPowerModeActive,
            isCritical: this.batteryLevel <= this.options.criticalPowerThreshold,
            promptDirective: this.batteryLevel <= this.options.criticalPowerThreshold
                ? `【电量极度垂危·${this.batteryLevel}%】手机即将因电量耗尽自动关机，屏幕泛白闪烁，触控反馈减弱。`
                : (this.batteryLevel <= 20 ? `【低电量告警·${this.batteryLevel}%】电池图标变黄，系统进入极简省电状态。` : null)
        };
        
        this.drainHistory.push(statusRecord);
        if (this.drainHistory.length > 30) this.drainHistory.shift();
        return statusRecord;
    }

    plugInCharger(fastCharge = false) {
        this.isCharging = true;
        const gain = fastCharge ? 25 : 12;
        this.batteryLevel = Math.min(100, Number((this.batteryLevel + gain).toFixed(1)));
        if (this.batteryLevel > 30) this.isLowPowerModeActive = false;
        return { batteryLevel: this.batteryLevel, isCharging: true };
    }

    exportState() {
        return {
            batteryLevel: this.batteryLevel,
            isLowPowerModeActive: this.isLowPowerModeActive,
            temperatureCelsius: this.temperatureCelsius
        };
    }

    hydrateState(state) {
        if (!state) return;
        if (typeof state.batteryLevel === "number") this.batteryLevel = state.batteryLevel;
        if (typeof state.isLowPowerModeActive === "boolean") this.isLowPowerModeActive = state.isLowPowerModeActive;
        if (typeof state.temperatureCelsius === "number") this.temperatureCelsius = state.temperatureCelsius;
    }
}
if (typeof globalThis !== "undefined") { globalThis.DynamicPowerBatteryPhysics = DynamicPowerBatteryPhysics; }
if (typeof window !== "undefined") { window.DynamicPowerBatteryPhysics = DynamicPowerBatteryPhysics; }
if (typeof module !== "undefined" && module.exports) { module.exports = DynamicPowerBatteryPhysics; }
export default DynamicPowerBatteryPhysics;