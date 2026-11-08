/* ============================================================
 * radio-cellular-weak-signal-sim.js — 拟真硬件底层环境与无线网络信号仿真器
 * [v4.140.0 · 蜂窝射频衰减、多场景弱网与发信重试链路]
 * ============================================================ */

export class RadioCellularWeakSignalSim {
    constructor(options = {}) {
        this.options = Object.assign({
            baseLatencyMs: 35,
            maxRetries: 3,
            packetDropRateFloor: 0.02
        }, options);
        
        this.signalStrengthBars = 4; // 0 ~ 4
        this.currentScene = "outdoor_open";
        this.networkType = "5G"; // 5G | 4G | 2G | NoService
        this.packetLog = [];
    }

    setRadioEnvironment(sceneType = "elevator") {
        this.currentScene = sceneType;
        switch (sceneType) {
            case "elevator":
            case "deep_basement":
                this.signalStrengthBars = 1;
                this.networkType = "2G";
                break;
            case "tunnel":
            case "isolated_mountain":
                this.signalStrengthBars = 0;
                this.networkType = "NoService";
                break;
            case "indoor_highrise":
                this.signalStrengthBars = 3;
                this.networkType = "4G";
                break;
            case "outdoor_open":
            default:
                this.signalStrengthBars = 4;
                this.networkType = "5G";
                break;
        }

        return {
            scene: this.currentScene,
            bars: this.signalStrengthBars,
            networkType: this.networkType,
            isOnline: this.signalStrengthBars > 0,
            uiStatusBadge: `${this.networkType} · ${this.signalStrengthBars}/4格`
        };
    }

    simulatePacketDispatch(payloadSizeKb = 5, retryCount = 0) {
        if (this.signalStrengthBars === 0) {
            const dropEvent = {
                success: false,
                latencyMs: 9999,
                errorCode: "ERR_NO_CARRIER_SIGNAL",
                scene: this.currentScene,
                narrativeNotice: "屏幕上方旋转红感叹号，无基站射频信号，消息发送排队等待中。"
            };
            this.packetLog.push(dropEvent);
            return dropEvent;
        }

        // 延迟阶梯计算
        const weakSignalLag = (4 - this.signalStrengthBars) * 220;
        const totalLatency = this.options.baseLatencyMs + weakSignalLag + Math.round(payloadSizeKb * 4);
        const isSuccess = !(this.signalStrengthBars === 1 && Math.random() < 0.35);

        const event = {
            success: isSuccess,
            latencyMs: totalLatency,
            bars: this.signalStrengthBars,
            networkType: this.networkType,
            scene: this.currentScene,
            retryAttempt: retryCount,
            narrativeNotice: isSuccess 
                ? (this.signalStrengthBars <= 2 ? `转了约 ${(totalLatency / 1000).toFixed(1)} 秒菊花后艰难送达。` : "秒发秒达。")
                : "发送超时，界面提示轻触重试。"
        };
        this.packetLog.push(event);
        if (this.packetLog.length > 50) this.packetLog.shift();
        return event;
    }

    exportState() {
        return {
            signalStrengthBars: this.signalStrengthBars,
            currentScene: this.currentScene,
            networkType: this.networkType
        };
    }

    hydrateState(state) {
        if (!state) return;
        if (typeof state.signalStrengthBars === "number") this.signalStrengthBars = state.signalStrengthBars;
        if (typeof state.currentScene === "string") this.currentScene = state.currentScene;
        if (typeof state.networkType === "string") this.networkType = state.networkType;
    }
}
if (typeof globalThis !== "undefined") { globalThis.RadioCellularWeakSignalSim = RadioCellularWeakSignalSim; }
if (typeof window !== "undefined") { window.RadioCellularWeakSignalSim = RadioCellularWeakSignalSim; }
if (typeof module !== "undefined" && module.exports) { module.exports = RadioCellularWeakSignalSim; }
export default RadioCellularWeakSignalSim;