/* ============================================================
 * didi-mobility-ride-hailing-system.js — [v4.139.0 · 第十八期全新拟真生态]
 * 拟真网约车行程与高精度地图导航中枢 (DiDi Mobility & Ride Hailing System)
 * ------------------------------------------------------------
 * 【核心机制与现代出行】
 * 打造完整的网约车打车体验：
 *   - 呼叫与司机匹配: 车型 (专车/快车)、司机评价 4.98星、车牌号；
 *   - 实时接驾位移: 接驾倒计时、剩余距离 800m 平滑缩短；
 *   - 行程中安全模式: 偏航预警、行程自动录音、一键将实时轨迹共享给紧急联系人。
 * ============================================================ */

export class DiDiMobilityRideHailingSystem {
    constructor(options = {}) {
        this.options = Object.assign({
            defaultCarType: "特斯拉 Model 3 · 白色",
            defaultPlate: "京A·D9821"
        }, options);
        this.activeTrip = null;
    }

    createTrip(pickupLoc, dropoffLoc, carType) {
        this.activeTrip = {
            tripId: "didi_" + Date.now(),
            pickupLoc,
            dropoffLoc,
            carType: carType || this.options.defaultCarType,
            plate: this.options.defaultPlate,
            driverName: "张师傅 (驾龄8年·4.96星)",
            status: "driver_en_route", // driver_en_route, passenger_onboard, completed
            distanceRemainingM: 1200,
            etaMinutes: 4,
            isSafetyRecordingOn: true,
            isDeviatedRoute: false
        };
        return this.activeTrip;
    }

    advanceTripStep() {
        if (!this.activeTrip || this.activeTrip.status === "completed") return null;

        if (this.activeTrip.status === "driver_en_route") {
            this.activeTrip.status = "passenger_onboard";
            this.activeTrip.distanceRemainingM = 5400;
            this.activeTrip.etaMinutes = 14;
        } else if (this.activeTrip.status === "passenger_onboard") {
            if (this.activeTrip.distanceRemainingM > 1000) {
                this.activeTrip.distanceRemainingM = 800;
                this.activeTrip.etaMinutes = 2;
            } else {
                this.activeTrip.status = "completed";
                this.activeTrip.distanceRemainingM = 0;
                this.activeTrip.etaMinutes = 0;
            }
        }

        return this.activeTrip;
    }

    triggerDeviationAlert() {
        if (this.activeTrip) {
            this.activeTrip.isDeviatedRoute = true;
        }
    }

    formatTripPrompt() {
        if (!this.activeTrip || this.activeTrip.status === "completed") return "";
        const t = this.activeTrip;
        const lines = ["【滴滴出行·高精地图实时行程】"];
        lines.push(`- 车辆: [${t.carType}] ${t.plate} · ${t.driverName}`);
        lines.push(`- 路线: 从「${t.pickupLoc}」前往「${t.dropoffLoc}」 (剩余${(t.distanceRemainingM / 1000).toFixed(1)}km, 预计${t.etaMinutes}分钟)`);
        if (t.isDeviatedRoute) {
            lines.push(`- ⚠️ [行程安全异常] 系统监测到车辆发生严重路线偏航，已启动安全录音！`);
        }
        return lines.join("\n");
    }

    exportState() {
        return { activeTrip: this.activeTrip ? Object.assign({}, this.activeTrip) : null };
    }

    hydrateState(state) {
        if (state && state.activeTrip) {
            this.activeTrip = Object.assign({}, state.activeTrip);
        }
    }
}

export default DiDiMobilityRideHailingSystem;