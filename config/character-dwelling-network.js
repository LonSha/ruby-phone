/* ============================================================
 * config/character-dwelling-network.js — [R9-X3 · 第九期规划]
 * 关系空间与角色居所网络联动器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   角色居所不仅是静态布置，而是沉淀关系记忆与互动痕迹的空间网络：
 *     - 每个居所维护物件流转谱系 (item_lineage: gift, borrow, lose, recover)
 *     - 针对私密物件 (isPrivate: true)，进入公共展示空间时严格限制可见性
 *     - 物件流转必须具有事件回溯 ID (sourceEventId)
 * ============================================================ */
export function recordDwellingItemTransition(dwelling, item, transition = {}) {
    if (!dwelling || !dwelling.id || !item || !item.id) {
        return { success: false, reason: 'invalid_dwelling_or_item' };
    }

    const items = Array.isArray(dwelling.items) ? dwelling.items.slice() : [];
    const transitionType = transition.type || 'display'; // gift, borrow, lost, recover, display
    const sourceEventId = String(transition.sourceEventId || '').trim();

    if (!sourceEventId) {
        return { success: false, reason: 'missing_source_event_lineage' };
    }

    const isVisibleInPublic = item.isPrivate ? Boolean(transition.allowPrivatePublic) : true;

    const existingIdx = items.findIndex(i => i.id === item.id);
    const itemRecord = {
        ...item,
        dwellingId: dwelling.id,
        currentPlacement: transition.placement || 'default_shelf',
        lastTransition: transitionType,
        sourceEventId,
        isVisibleInPublic,
        updatedAt: Date.now()
    };

    if (existingIdx >= 0) {
        items[existingIdx] = itemRecord;
    } else {
        items.push(itemRecord);
    }

    return {
        success: true,
        dwellingId: dwelling.id,
        items,
        itemRecord
    };
}