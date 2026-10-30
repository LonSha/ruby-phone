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
    /* [v4.99.6 · R11-X8] 读数面（`face()`）：产品端读电量的**唯一**入口。
     *   为什么要有：状态栏此前读的是 `navigator.getBattery()`（宿主真机的电池），
     *   与这里 tick 出来的虚拟电量各是一个真源 —— 剧情里手机放电到 5% 时状态栏仍显示宿主那格。
     *   现在把两个真源合并成一个：**宿主那格只允许当一次性初值**（seedFromHost），
     *   此后一律以本实例为准。face() 不抛（读坏了不能把状态栏带挂），但如实标 ok:false。
     * @returns {{ok:boolean, why:string, battery?:{level:number, charging:boolean, throttling:boolean, temperature:number, powerState:string, criticalAlert:*}}}
     */
    face() {
        try {
            return {
                ok: true,
                why: '',
                battery: {
                    level: this.level,
                    charging: !!this.isCharging,
                    throttling: !!this.isThrottling,
                    temperature: this.temperature,
                    powerState: this.isCharging
                        ? (this.level >= 100 ? POWER_STATES.FULL : POWER_STATES.CHARGING)
                        : (this.level <= 10 ? POWER_STATES.CRITICAL : POWER_STATES.DISCHARGING),
                    criticalAlert: this.level <= 5 ? 'CRITICAL_LAST_CALL' : (this.level <= 20 ? 'LOW_BATTERY_WARNING' : null)
                }
            };
        } catch (e) {
            return { ok: false, why: 'read_threw', detail: String((e && e.message) || e) };
        }
    }
    /**
     * [v4.99.6 · R11-X8] 一次性播种：只在**首次装配**（盘上还没有本实例的状态）时接纳外部初值。
     *   为什么要限一次：宿主真机电量与虚拟电量同时活着就是两个真源。
     *   盘上已有状态 ⇒ 返回 {seeded:false}，绝不覆盖用户剧情里推进出来的电量。
     * @param {{level:*, charging:*}} seed
     * @returns {{seeded:boolean, level:number, why:string}}
     */
    seedOnce(seed) {
        const has = (() => {
            if (!this.storage?.get) return false;
            try {
                const saved = this.storage.get('battery_thermo_state', null);
                return !!(saved && typeof saved.level === 'number');
            } catch (_e) { return false; }
        })();
        if (has) return { seeded: false, level: this.level, why: 'already_saved' };
        const lv = Number(seed && seed.level);
        if (!Number.isFinite(lv)) return { seeded: false, level: this.level, why: 'bad_seed' };
        this.level = Math.max(0, Math.min(100, lv));
        this.isCharging = !!(seed && seed.charging);
        this._save();
        return { seeded: true, level: this.level, why: '' };
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