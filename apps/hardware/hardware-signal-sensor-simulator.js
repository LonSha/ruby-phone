/* ============================================================
 * hardware-signal-sensor-simulator.js — [R20-5 · 第二十期史诗级双项目双计划]
 * 拟真硬件底层环境与无线信号传感器仿真引擎 (Hardware Signal & Sensor Simulator)
 * ------------------------------------------------------------
 * 【核心设计】
 *   赋予虚拟手机真实的物理感知能力，告别“永远满信号、永远不断网”的虚假体验：
 *   1. 物理环境与无线基站仿真（RF Signal Simulation）：
 *      模拟深山、地底密室、地铁隧道等环境带来的信号衰减（0..5格）、网络降级（5G -> 4G -> 2G/E -> 无服务）；
 *   2. 传感器动态反馈（Sensor Telemetry Simulation）：
 *      包含电池电量健康度与过热降频、微弱环境光感知、加速度与剧烈震动/跌落事件检测；
 *   3. 极端物理事件对叙事触发器的上报（Hardware Telemetry Directives）：
 *      断网时阻止即时通讯发送并转入离线队列；手机摔落时触发自动紧急求助或语音呼叫中断。
 * ============================================================ */
export const NETWORK_TYPE = Object.freeze({
    WIFI: 'WiFi_6E',
    CELL_5G: '5G_NR',
    CELL_4G: '4G_LTE',
    CELL_2G: '2G_EDGE',
    NO_SERVICE: 'No_Service'
});

export function createInitialHardwareState() {
    return {
        batteryLevel: 85,          // 0..100
        isCharging: false,
        batteryTemperature: 32.5,  // 摄氏度
        signalBars: 4,             // 0..5 格
        networkType: NETWORK_TYPE.CELL_5G,
        ambientLightLux: 350,      // 照度 lux
        motionState: 'stationary', // stationary | walking | violent_impact
        updatedAt: Date.now()
    };
}

export function applyEnvironmentConditions(state, env = {}) {
    if (!state) return;
    if (typeof env.signalBars === 'number') {
        state.signalBars = Math.max(0, Math.min(5, Math.floor(env.signalBars)));
    }
    if (state.signalBars === 0) {
        state.networkType = NETWORK_TYPE.NO_SERVICE;
    } else if (state.signalBars <= 2) {
        state.networkType = NETWORK_TYPE.CELL_2G;
    } else if (env.networkType && Object.values(NETWORK_TYPE).includes(env.networkType)) {
        state.networkType = env.networkType;
    }

    if (typeof env.batteryDelta === 'number') {
        state.batteryLevel = Math.max(0, Math.min(100, state.batteryLevel + env.batteryDelta));
    }

    if (env.impactDetected === true) {
        state.motionState = 'violent_impact';
    } else if (env.isMoving === true) {
        state.motionState = 'walking';
    } else {
        state.motionState = 'stationary';
    }

    state.updatedAt = Date.now();
}

export function resolveHardwarePromptDirectives(state) {
    if (!state) return null;
    const notices = [];
    if (state.networkType === NETWORK_TYPE.NO_SERVICE) {
        notices.push('【手机无信号】手机处于无网络服务区，无法发送即时通讯消息或实时联网检索。');
    } else if (state.signalBars <= 1) {
        notices.push('【信号微弱】基站网络极度微弱，网页与图片加载可能超时受阻。');
    }
    if (state.batteryLevel <= 10) {
        notices.push('【极度低电量】手机剩余电量不足10%，随时可能自动关机。');
    }
    if (state.motionState === 'violent_impact') {
        notices.push('【剧烈震落】手机传感器检测到剧烈坠落冲击，屏幕可能已破损或脱手。');
    }
    return notices.join(' ');
}

const HardwareSim = {
    NETWORK_TYPE,
    createInitialHardwareState,
    applyEnvironmentConditions,
    resolveHardwarePromptDirectives
};

export default HardwareSim;