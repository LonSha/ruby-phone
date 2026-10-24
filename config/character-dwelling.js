/* ========================================================
 * config/character-dwelling.js — [R8-X4 · 第八期规划] 角色居所内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决与角色的关系缺少空间落脚点与生活沉淀的问题：
 *     ① 居所空间：roomId / characterId / theme / items；
 *     ② 摆件操作：placeItem（赠送/摆放）/ inspectItem（回忆共鸣）/ removeItem（收回）；
 *     ③ 摆件附带事件引用与回忆文本，随剧情互动深化；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */
'use strict';

export const CD_STORAGE_KEY = 'cd_dwelling_state_v1';
export const CD_MAX_ITEMS = 25;

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeDwellingState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            rooms: {},
            updatedAt: Date.now()
        };
    }
    const rooms = {};
    if (raw.rooms && typeof raw.rooms === 'object') {
        for (const [id, r] of Object.entries(raw.rooms)) {
            if (!r || typeof r !== 'object') continue;
            rooms[id] = {
                id: safeStr(r.id) || id,
                characterId: safeStr(r.characterId),
                roomName: safeStr(r.roomName) || '专属房间',
                items: safeArr(r.items).slice(-CD_MAX_ITEMS),
                updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now()
            };
        }
    }
    return {
        rooms,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 在角色居所中布置/赠送一件物品
 */
export function placeItemInRoom(state, roomId, itemSpec) {
    const s = normalizeDwellingState(state);
    const rid = safeStr(roomId);
    if (!rid || !itemSpec || typeof itemSpec !== 'object') {
        return { success: false, reason: 'invalid-room-or-item', state: s };
    }
    const itemId = safeStr(itemSpec.id) || `item_${Date.now()}`;
    const name = safeStr(itemSpec.name);
    if (!name) {
        return { success: false, reason: 'missing-item-name', state: s };
    }

    const room = s.rooms[rid] || {
        id: rid,
        characterId: safeStr(itemSpec.characterId) || rid,
        roomName: `${name}的居所`,
        items: []
    };

    const entry = {
        id: itemId,
        name,
        slot: safeStr(itemSpec.slot) || 'desk', // desk | shelf | wall | floor
        originEvent: safeStr(itemSpec.originEvent),
        reminiscenceSnippet: safeStr(itemSpec.reminiscenceSnippet) || '承载着一段回忆的信物',
        placedAt: Date.now()
    };

    const nextItems = [...room.items.filter(i => i.id !== itemId), entry].slice(-CD_MAX_ITEMS);
    const updatedRoom = { ...room, items: nextItems, updatedAt: Date.now() };

    return {
        success: true,
        item: entry,
        state: {
            ...s,
            rooms: {
                ...s.rooms,
                [rid]: updatedRoom
            },
            updatedAt: Date.now()
        }
    };
}

/**
 * 检视房间摆件，触发回忆共鸣
 */
export function inspectRoomItem(state, roomId, itemId) {
    const s = normalizeDwellingState(state);
    const room = s.rooms[safeStr(roomId)];
    if (!room) return { found: false, reason: 'room-not-found' };

    const item = room.items.find(i => i.id === safeStr(itemId));
    if (!item) return { found: false, reason: 'item-not-found' };

    return {
        found: true,
        item,
        narrativeSnippet: `目光停留在【${item.name}】上：${item.reminiscenceSnippet}`
    };
}