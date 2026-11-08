/* ============================================================
 * thermodynamics-battery-physics-sim.js — [v4.139.0 · 第十八期全新拟真生态]
 * 硬件多阶热动力学与电池电压骤降动力学 (Hardware Thermodynamics & Battery Physics)
 * ------------------------------------------------------------
 * 【核心机制与硬件物理学】
 * 解决手机电量常年作为一个呆板静态百分比的虚假感：
 *   建立真实手机物理动力学模型——
 *   - 功耗发热: 运行 3D 大作、长时间录制 4K 视频或环境高温导致机身发烫至 42℃，触发温控降频卡顿；
 *   - 极寒跳电: 模拟零下严寒环境中，锂电池内阻骤增导致端电压跌落，发生“电量从40%骤降至1%并黑屏关机”的险境。
 * ============================================================ */

export class ThermodynamicsBatteryPhysicsSim {
    constructor(options = {}) {
        this.options = Object.assign({
            ambientTempC: 22.0,
            batteryHealth: 88, // 百分比
            initialLevel: 65
        }, options);

        this.currentTempC = 26.0;
        this.batteryLevel = this.options.initialLevel;
        this.isThrottling = false;
        this.isPowerCutOff = false;
    }

    /**
     * 步进物理环境与负载变化
     * @param {Object} load { cpuLoad: 0~1, ambientTempC: number, isFastCharging: boolean }
     */
    stepPhysics(load = {}) {
        const ambient = typeof load.ambientTempC === "number" ? load.ambientTempC : this.options.ambientTempC;
        const cpu = Math.max(0, Math.min(1, Number(load.cpuLoad || 0.2)));
        const fastCharge = !!load.isFastCharging;

        // 温度演算
        let targetTemp = ambient + (cpu * 20.0) + (fastCharge ? 8.0 : 0);
        this.currentTempC = Number((this.currentTempC * 0.7 + targetTemp * 0.3).toFixed(1));
        this.isThrottling = this.currentTempC >= 42.0;

        // 极寒电池跳电物理特征 (锂离子在 < -5℃ 时内阻剧烈增大)
        if (ambient <= -10.0 && this.batteryLevel > 5) {
            // 发生雪崩式电压降 (跳电)
            this.batteryLevel = 1;
            this.isPowerCutOff = true;
        } else {
            // 常规耗电
            const drainRate = 0.1 * (1 + cpu * 2);
            this.batteryLevel = Math.max(0, Number((this.batteryLevel - drainRate).toFixed(1)));
            if (this.batteryLevel <= 0) {
                this.isPowerCutOff = true;
            }
        }

        return {
            currentTempC: this.currentTempC,
            batteryLevel: this.batteryLevel,
            isThrottling: this.isThrottling,
            isPowerCutOff: this.isPowerCutOff
        };
    }

    formatHardwarePrompt() {
        if (!this.isThrottling && !this.isPowerCutOff && this.batteryLevel > 20) {
            return "";
        }
        const lines = ["【手机物理硬件状态告警】"];
        if (this.isPowerCutOff) {
            lines.push(`- [硬件关机] 电池因严寒电压骤降或耗尽，手机屏幕瞬间黑屏，无法响应！`);
        } else {
            lines.push(`- 电池电量: ${this.batteryLevel}% | 机身温度: ${this.currentTempC}℃ ${this.isThrottling ? "(严重发烫温控降频中)" : ""}`);
        }
        return lines.join("\n");
    }

    exportState() {
        return {
            currentTempC: this.currentTempC,
            batteryLevel: this.batteryLevel,
            isThrottling: this.isThrottling,
            isPowerCutOff: this.isPowerCutOff
        };
    }

    hydrateState(state) {
        if (!state) return;
        this.currentTempC = typeof state.currentTempC === "number" ? state.currentTempC : 26.0;
        this.batteryLevel = typeof state.batteryLevel === "number" ? state.batteryLevel : 65;
        this.isThrottling = !!state.isThrottling;
        this.isPowerCutOff = !!state.isPowerCutOff;
    }
}

export default ThermodynamicsBatteryPhysicsSim;