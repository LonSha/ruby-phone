/**
 * 射频基站嗅探与 NPC 手机信号三角接近雷达 (Cellular RF Proximity Radar)
 * 实时扫描周边基站小区 CellID、侦测特定角色信号强度 (RSSI) 并计算几何距离与接近波纹
 */
export class CellularRFProximityRadar {
    constructor() {
        this.baseStations = [
            { cellId: 'BS_1024', name: '中央商业街宏蜂窝', lac: 4100, coords: [121.47, 31.23] },
            { cellId: 'BS_1025', name: '旧洋房街区微基站', lac: 4100, coords: [121.48, 31.24] },
            { cellId: 'BS_1026', name: '地下防空洞边缘直放站', lac: 4101, coords: [121.46, 31.22] }
        ];
        this.trackedTargets = new Map();
    }

    /**
     * 注册/追踪目标 NPC 设备
     */
    trackTarget(targetId, targetName, initialDistanceMeters = 500) {
        const target = {
            targetId,
            targetName,
            distanceMeters: initialDistanceMeters,
            rssi: this._distanceToRSSI(initialDistanceMeters),
            proximityLevel: this._calcProximityLevel(initialDistanceMeters),
            lastUpdated: Date.now()
        };
        this.trackedTargets.set(targetId, target);
        return target;
    }

    /**
     * 模拟目标移动并更新接近距离
     */
    updateTargetDistance(targetId, newDistanceMeters) {
        const target = this.trackedTargets.get(targetId);
        if (!target) return null;

        target.distanceMeters = Math.max(1, newDistanceMeters);
        target.rssi = this._distanceToRSSI(target.distanceMeters);
        target.proximityLevel = this._calcProximityLevel(target.distanceMeters);
        target.lastUpdated = Date.now();

        return {
            ...target,
            radarWarning: target.proximityLevel === 'DANGER_PROXIMITY'
                ? '【高危警戒】目标已进入 10 米绝对近身圈！呼吸声纹已可捕捉！'
                : target.proximityLevel === 'CLOSE'
                    ? '【接近提示】目标正在快速靠近（< 50米），雷达波纹剧烈扩散。'
                    : '【平静】目标处于安全距离之外。'
        };
    }

    _distanceToRSSI(meters) {
        // -30dBm (极近) ~ -110dBm (极远/无信号)
        const rssi = Math.round(-30 - 20 * Math.log10(Math.max(1, meters)));
        return Math.max(-110, Math.min(-30, rssi));
    }

    _calcProximityLevel(meters) {
        if (meters <= 15) return 'DANGER_PROXIMITY';
        if (meters <= 60) return 'CLOSE';
        if (meters <= 200) return 'NEARBY';
        return 'FAR';
    }

    getTrackedList() {
        return Array.from(this.trackedTargets.values());
    }
}

export default CellularRFProximityRadar;