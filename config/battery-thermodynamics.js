/* ========================================================
 * config/battery-thermodynamics.js
 * RubyPhone R10-O6 · 虚拟手机电池动力学与发热降频仿真
 * 
 * 核心机制：
 * 1. 电池容量与功耗动力学模型 (Battery Drain & Power Load):
 *    - 基础待机功耗 (STANDBY: 0.1%/min)
 *    - 应用负载动态功耗 (GAME/LIVE/CAMERA: 1.5%~3.0%/min, CHAT: 0.5%/min)
 *    - 充电加速曲线 (FAST_CHARGE: 2.5%/min, NORMAL: 1.2%/min)
 * 2. 芯片温度与发热节流降频 (Thermal Throttling):
 *    - 高负载发热指数 (35°C ~ 48°C)
 *    - 达到 42°C 时触发 THERMAL_THROTTLING，界面动画降频、提示设备过热
 * 3. 低电量剧情张力与关机前告警 (Low Battery Emergency):
 *    - 电量 <= 20% 触发低电量警报
 *    - 电量 <= 5% 触发剧情临界事件（如急迫发送关机前最后一条信息）
 * ======================================================== */

export const POWER_STATES = Object.freeze({
    DISCHARGING: 'DISCHARGING',
    CHARGING: 'CHARGING',
    FULL: 'FULL',
    CRITICAL: 'CRITICAL'
});

export const APP_POWER_LOADS = Object.freeze({
    STANDBY: 0.1,
    CHAT: 0.4,
    GAME: 2.2,
    LIVE_STREAM: 1.8,
    CAMERA: 1.5,
    VIDEO: 1.0
});

export class BatteryThermodynamics {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.level = opts.initialLevel !== undefined ? opts.initialLevel : 85; // 0 ~ 100
        this.temperature = 36.5; // 摄氏度
        this.isCharging = false;
        this.isFastCharge = false;
        this.currentLoad = APP_POWER_LOADS.STANDBY;
        this.isThrottling = false;
        this.lastTickTime = Date.now();
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const saved = this.storage.get('battery_thermo_state', null);
            if (saved && typeof saved.level === 'number') {
                this.level = saved.level;
                this.temperature = saved.temperature || 36.5;
            }
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('battery_thermo_state', {
                level: this.level,
                temperature: this.temperature,
                savedAt: Date.now()
            });
        } catch (_e) {}
    }

    setAppLoad(loadType) {
        this.currentLoad = APP_POWER_LOADS[loadType] || APP_POWER_LOADS.STANDBY;
    }

    setCharging(isCharging, fast = false) {
        this.isCharging = !!isCharging;
        this.isFastCharge = !!fast;
    }

    /**
     * 模拟推进分钟级时间流
     * @param {number} elapsedMinutes 经过分钟数
     * @returns {Object} 状态更新结果
     */
    tick(elapsedMinutes = 1) {
        const mins = Math.max(0.1, Math.min(60, Number(elapsedMinutes) || 1));

        if (this.isCharging) {
            const chargeSpeed = this.isFastCharge ? 2.5 : 1.2;
            this.level = Math.min(100, Number((this.level + chargeSpeed * mins).toFixed(2)));
            // 充电微热
            this.temperature = Math.min(41.0, Number((this.temperature + 0.15 * mins).toFixed(1)));
        } else {
            // 放电耗电
            const drain = this.currentLoad * mins;
            this.level = Math.max(0, Number((this.level - drain).toFixed(2)));

            // 温度随负载上升或回落环境温 (35°C)
            if (this.currentLoad >= APP_POWER_LOADS.GAME) {
                this.temperature = Math.min(48.5, Number((this.temperature + 0.4 * mins).toFixed(1)));
            } else {
                this.temperature = Math.max(35.0, Number((this.temperature - 0.25 * mins).toFixed(1)));
            }
        }

        // 节流判定
        this.isThrottling = this.temperature >= 42.0;

        // 低电量剧情判定
        let criticalAlert = null;
        if (this.level <= 0) {
            criticalAlert = 'SHUTDOWN_IMMINENT';
        } else if (this.level <= 5) {
            criticalAlert = 'CRITICAL_LAST_CALL'; // 紧急发送关机前最后遗言
        } else if (this.level <= 20) {
            criticalAlert = 'LOW_BATTERY_WARNING';
        }

        this._save();

        return {
            level: this.level,
            temperature: this.temperature,
            isCharging: this.isCharging,
            isThrottling: this.isThrottling,
            powerState: this.isCharging ? (this.level >= 100 ? POWER_STATES.FULL : POWER_STATES.CHARGING) : (this.level <= 10 ? POWER_STATES.CRITICAL : POWER_STATES.DISCHARGING),
            criticalAlert
        };
    }
}