/* ============================================================
 * config/phone-world-state-machine.js — [R9-X1 · 第九期规划]
 * 手机世界状态机与多源情境投影器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   手机不再是单纯静态 App 集合，而是拥有世界时空感知与当前生活情境的世界状态机：
 *     五大核心状态：
 *       - HAPPENING: 正在发生（存在正在进行的即时互动或高优先级事务）
 *       - AWAITING_RESPONSE: 等待回应（有未回复的重要消息或待确认事项）
 *       - SETTLING: 沉淀中（日常结束或事务归档期）
 *       - TRANSITION: 转场中（地点变动或日程跨度过渡）
 *       - HIATUS: 断档期（无紧急事项，保留断档痕迹，不捏造虚假日常）
 * ============================================================ */
export const WORLD_STATES = Object.freeze({
    HAPPENING: 'happening',
    AWAITING_RESPONSE: 'awaiting_response',
    SETTLING: 'settling',
    TRANSITION: 'transition',
    HIATUS: 'hiatus'
});

export function resolveWorldState(signals = {}) {
    const activeIncidentCount = Number(signals.activeIncidentCount) || 0;
    const pendingResponseCount = Number(signals.pendingResponseCount) || 0;
    const isTransitioning = Boolean(signals.isTransitioning);
    const isSettlingTime = Boolean(signals.isSettlingTime);

    let state = WORLD_STATES.HIATUS;
    let rationale = '无紧急事件，处于自然断档期';

    if (activeIncidentCount > 0) {
        state = WORLD_STATES.HAPPENING;
        rationale = `存在 ${activeIncidentCount} 件正在进行的跨应用事务`;
    } else if (pendingResponseCount > 0) {
        state = WORLD_STATES.AWAITING_RESPONSE;
        rationale = `存在 ${pendingResponseCount} 项等待用户或角色回应的事项`;
    } else if (isTransitioning) {
        state = WORLD_STATES.TRANSITION;
        rationale = '空间位置或故事阶段处于转场过渡期';
    } else if (isSettlingTime) {
        state = WORLD_STATES.SETTLING;
        rationale = '日程归档与记忆沉淀时段';
    }

    return {
        state,
        rationale,
        timestamp: Date.now(),
        signals: {
            activeIncidentCount,
            pendingResponseCount,
            isTransitioning,
            isSettlingTime
        }
    };
}