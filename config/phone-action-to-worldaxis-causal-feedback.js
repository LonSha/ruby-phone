/* ============================================================
 * phone-action-to-worldaxis-causal-feedback.js — [v4.138.0 · V21-R10]
 * 手机全息交互向 WorldAxis 因果全量反哺中枢 (Phone Action to WorldAxis Causal Bridge)
 * ------------------------------------------------------------
 * 对接 WorldAxis 入站桥 window.worldaxis_phone_ops_v1 / engines/phone-bridge.js：
 * 1. 采集拉黑、发微信、转账、拨打紧急电话等核心手机动作 (Phone Ops Harvesting)
 * 2. 格式化为 WorldAxis 标准入站 causal op (Idempotent Action Normalization)
 * 3. 作为客观世界演化的驱动因，闭环双向互动 (Closed-Loop Causal Synthesis)
 * ============================================================ */
export function buildWorldAxisPhoneOp(actionType, details = {}) {
    const validActs = ["block_actor", "send_message", "transfer_money", "call_emergency"];
    const act = validActs.includes(actionType) ? actionType : "send_message";
    const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return {
        opId,
        act,
        targetActor: String(details.targetActor || "npc"),
        params: details.params || {},
        timestamp: Date.now(),
        clientVersion: "4.138.0"
    };
}

export function reportOpToWorldAxis(phoneOp, win = (typeof window !== "undefined" ? window : null)) {
    if (!win || !phoneOp) return { reported: false, reason: "window_or_op_absent" };
    try {
        if (win.WorldAxis && win.WorldAxis.phoneBridge && typeof win.WorldAxis.phoneBridge.noteAction === "function") {
            const res = win.WorldAxis.phoneBridge.noteAction(phoneOp);
            return { reported: true, bridgeResponse: res };
        }
        return { reported: false, reason: "worldaxis_phonebridge_unmounted" };
    } catch (err) {
        return { reported: false, error: String(err && err.message ? err.message : err) };
    }
}
