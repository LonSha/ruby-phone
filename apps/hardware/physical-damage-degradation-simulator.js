/* ============================================================
 * physical-damage-degradation-simulator.js — [v4.138.0 · V21-R16]
 * 手机物理残损、触控失灵与硬件退化拟真机 (Physical Damage Degradation Simulator)
 * ------------------------------------------------------------
 * 1. 剧情遭遇战斗或跌落后的屏幕像素裂纹拟真 (Pixel Screen Cracks Overlay)
 * 2. 局部触控死区与幽灵误触 (Touch Blind Spots & Ghost Touches)
 * 3. 扬声器杂音杂波与电池异常放电 (Hardware Degradation Artifacts)
 * ============================================================ */
export function applyPhysicalDamage(currentState = {}, damageLevel = "mild") {
    const levels = {
        mild: { cracksCount: 2, touchDeadZone: false, batteryDrainRate: 1.0 },
        severe: { cracksCount: 7, touchDeadZone: true, batteryDrainRate: 2.5 },
        critical: { cracksCount: 15, touchDeadZone: true, batteryDrainRate: 5.0, speakerStatic: true }
    };
    const dmg = levels[damageLevel] || levels.mild;

    return {
        healthStatus: damageLevel,
        cracksOverlayActive: true,
        cracksCount: dmg.cracksCount,
        hasDeadZone: dmg.touchDeadZone,
        batteryDrainFactor: dmg.batteryDrainRate,
        narrativeNote: "[手机硬件物理残损] 屏幕边缘布满裂痕，触控操作偶有迟滞。"
    };
}
