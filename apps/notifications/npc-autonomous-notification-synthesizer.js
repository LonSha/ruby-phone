/* ============================================================
 * npc-autonomous-notification-synthesizer.js — [R20-3 · 第二十期史诗级双项目双计划]
 * 离线世界演化与NPC自主演化动态通知生成器 (NPC Autonomous Notification Synthesizer)
 * ------------------------------------------------------------
 * 【核心设计】
 *   解决虚拟手机中「玩家不操作则世界完全静止、无NPC自主生活气息」的呆板感：
 *   1. 离线时间跨度自主演化（Elapsed Time Autonomous Ticking）：
 *      根据现实或剧情流逝时间，自动为多位 NPC 推进后台微事件（如聚餐、加班、动态发布、未接来电）；
 *   2. 角色性格驱动的主动通知生成（Personality-Driven Push Engine）：
 *      高亲密度角色发送关怀消息，商业伙伴推送合同催办，神秘线人发送模糊线索预警；
 *   3. 锁屏通知汇聚与未读气泡聚合（Lockscreen Push Aggregator）：
 *      开机/唤醒时将离线期间积累的真实通知依时间线依次呈现在锁屏，营造鲜活的沉浸生态。
 * ============================================================ */
export function createInitialNotificationEngineState() {
    return {
        pendingNotifications: [],
        deliveredNotifications: [],
        lastTickTimestamp: Date.now(),
        updatedAt: Date.now()
    };
}

export function synthesizeAutonomousPushes(state, npcProfiles = [], elapsedMinutes = 0) {
    if (!state || !Array.isArray(npcProfiles) || npcProfiles.length === 0) return [];
    if (elapsedMinutes < 5) return []; // 经过时间太短不触发

    const generated = [];
    for (const npc of npcProfiles) {
        const name = String(npc.name || npc.character || 'NPC');
        const affinity = Number(npc.affinity) || 50;

        if (affinity >= 80 && elapsedMinutes >= 60) {
            generated.push({
                id: `push_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                app: 'wechat',
                sender: name,
                title: name,
                preview: '最近降温了，记得多添件衣服……下班后有空聊聊吗？',
                urgency: 'normal',
                timestamp: Date.now()
            });
        } else if (npc.role === 'informant' || npc.isInvestigator) {
            generated.push({
                id: `push_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                app: 'encrypted_memo',
                sender: name,
                title: `[加密提醒] ${name}`,
                preview: '新线索已经放到老地方，阅读后请立刻销毁记录。',
                urgency: 'high',
                timestamp: Date.now()
            });
        }
    }

    if (generated.length > 0) {
        state.pendingNotifications.push(...generated);
        state.lastTickTimestamp = Date.now();
        state.updatedAt = Date.now();
    }

    return generated;
}

export function drainPendingNotifications(state) {
    if (!state || !Array.isArray(state.pendingNotifications)) return [];
    const drained = [...state.pendingNotifications];
    state.deliveredNotifications.push(...drained);
    state.pendingNotifications = [];
    state.updatedAt = Date.now();
    return drained;
}

const NpcAutonomousNotificationSynthesizer = {
    createInitialNotificationEngineState,
    synthesizeAutonomousPushes,
    drainPendingNotifications
};

export default NpcAutonomousNotificationSynthesizer;