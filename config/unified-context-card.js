/* ============================================================
 * config/unified-context-card.js — [R9-O4 · 第九期规划]
 * 通知、搜索与行动上下文合流卡片引擎（纯函数内核）
 * ------------------------------------------------------------
 * 【治理缺口】
 *   旧通知中心与全局搜索各自为战，用户收到“周末聚餐”通知时，
 *   无法直接关联日历中的待办、备忘录中的地点笔记以及微信聊天上下文。
 *   统一上下文卡片实现通知、搜索命中、待办、人物回应与行动回执按“事情/角色”聚合。
 * ============================================================ */

export function createContextCard(cardId, title, options = {}) {
    const id = String(cardId || `card-${Date.now()}`).trim();
    if (!id) return null;

    return {
        cardId: id,
        title: String(title || '未命名上下文').trim(),
        incidentId: options.incidentId ? String(options.incidentId).trim() : null,
        characterId: options.characterId ? String(options.characterId).trim() : null,
        notifications: [],
        searchHits: [],
        todos: [],
        receipts: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

export function mergeContextItem(card, itemType, item) {
    if (!card || !card.cardId) return { ok: false, error: 'invalid-card' };
    if (!item || !item.id) return { ok: false, error: 'invalid-item' };

    const updated = { ...card };
    const validTypes = ['notifications', 'searchHits', 'todos', 'receipts'];
    if (!validTypes.includes(itemType)) {
        return { ok: false, error: 'invalid-item-type' };
    }

    const list = Array.isArray(updated[itemType]) ? updated[itemType].slice() : [];
    const existingIdx = list.findIndex(x => x.id === item.id);
    if (existingIdx >= 0) {
        list[existingIdx] = { ...item, mergedAt: Date.now() };
    } else {
        list.push({ ...item, mergedAt: Date.now() });
    }

    updated[itemType] = list;
    updated.updatedAt = Date.now();
    return { ok: true, card: updated };
}

export function summarizeContextCard(card) {
    if (!card) return null;
    return {
        cardId: card.cardId,
        title: card.title,
        totalItems: card.notifications.length + card.searchHits.length + card.todos.length + card.receipts.length,
        notificationCount: card.notifications.length,
        searchHitCount: card.searchHits.length,
        todoCount: card.todos.length,
        receiptCount: card.receipts.length
    };
}