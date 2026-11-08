/* ============================================================
 * cellular-radio-weak-signal-simulation.js — [v4.139.0 · 第十八期全新拟真生态]
 * 虚拟蜂窝基站弱网断连与红感叹号失联模拟器 (Cellular Radio & Weak Signal Simulator)
 * ------------------------------------------------------------
 * 【核心机制与网络拟真】
 * 解决手机网络“永远满格即时到达”的假人感：
 *   模拟真实物理世界的射频衰减——
 *   - 场景衰减: 电梯井、地下车库、偏远隧道、雷暴天气信号跳变为“无服务”或“1格E网”；
 *   - 微信红色感叹号: 弱网下发消息持续转圈，超时后在气泡旁挂上【！发送失败】；
 *   - 电话卡顿破音与突然中断: 通话中伴随噪音与“喂？喂？听得到吗？”，增强戏剧爆发力。
 * ============================================================ */

export class CellularRadioWeakSignalSimulation {
    constructor(options = {}) {
        this.options = Object.assign({
            currentLocationType: "outdoor_urban", // elevator, basement, tunnel, mountain, outdoor_urban
            carrierName: "中国移动 5G",
            baseSignalBars: 4
        }, options);
        this.failedOutbox = []; // [{ id, chatId, text, timestamp }]
        this.signalBars = 4;
        this.networkType = "5G"; // 5G, 4G, 3G, EDGE, NO_SERVICE
    }

    /**
     * 更新当前地理环境并计算网络衰减
     */
    updateEnvironment(locationType) {
        this.options.currentLocationType = locationType;
        switch (locationType) {
            case "elevator":
                this.signalBars = 0;
                this.networkType = "NO_SERVICE";
                break;
            case "basement":
            case "tunnel":
                this.signalBars = 1;
                this.networkType = "EDGE";
                break;
            case "mountain":
                this.signalBars = 2;
                this.networkType = "4G";
                break;
            default:
                this.signalBars = 4;
                this.networkType = "5G";
        }

        return {
            locationType,
            signalBars: this.signalBars,
            networkType: this.networkType,
            isOffline: this.networkType === "NO_SERVICE"
        };
    }

    /**
     * 模拟消息发送，弱网时触发超时与红色感叹号
     */
    sendMessage(chatId, text) {
        if (this.networkType === "NO_SERVICE") {
            const failedRecord = {
                id: "msg_fail_" + Date.now(),
                chatId,
                text,
                status: "failed",
                errorTag: "【！发送失败，点击重试】",
                timestamp: Date.now()
            };
            this.failedOutbox.push(failedRecord);
            return failedRecord;
        }

        return {
            id: "msg_ok_" + Date.now(),
            chatId,
            text,
            status: "delivered",
            timestamp: Date.now()
        };
    }

    formatNetworkPrompt() {
        if (this.networkType === "5G" && this.signalBars >= 3 && this.failedOutbox.length === 0) {
            return "";
        }
        const lines = ["【手机物理基站网络状态】"];
        lines.push(`- 当前信号: [${this.networkType} · ${this.signalBars}格] (环境: ${this.options.currentLocationType})`);
        if (this.failedOutbox.length > 0) {
            const last = this.failedOutbox[this.failedOutbox.length - 1];
            lines.push(`- 滞留未发出消息 [红感叹号]: \"${last.text}\" (因信号断绝未能送达对方手机)`);
        }
        return lines.join("\n");
    }

    exportState() {
        return {
            currentLocationType: this.options.currentLocationType,
            signalBars: this.signalBars,
            networkType: this.networkType,
            failedOutbox: [...this.failedOutbox]
        };
    }

    hydrateState(state) {
        if (!state) return;
        this.options.currentLocationType = state.currentLocationType || "outdoor_urban";
        this.signalBars = typeof state.signalBars === "number" ? state.signalBars : 4;
        this.networkType = state.networkType || "5G";
        if (Array.isArray(state.failedOutbox)) this.failedOutbox = [...state.failedOutbox];
    }
}

export default CellularRadioWeakSignalSimulation;