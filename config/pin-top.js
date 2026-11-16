/**
 * 聊天置顶 —— 唯一桥（v4.157.0 · R22-X1）
 *
 * 纪律：
 *   1. 纯函数零 IO：只算排序与集合，不写存储。谁置顶、何时置顶归宿主记账。
 *   2. 不替用户选：置顶集合由调用方传入，本桥只回答「按什么顺序排」。
 *   3. 置顶恒在顶部，组内按置顶时刻倒序；取消置顶回原位由调用方拿回 pinSet 决定。
 */
import { numOrNull } from './num-gate.js';

const PIN_TOP_FACES = Object.freeze(['empty', 'unpinned', 'pinned']);
export const PIN_TOP_LIMITS = Object.freeze({ maxPinned: 20 });

export function normalizePinSet(pins) {
    const out = [];
    const seen = new Set();
    const arr = Array.isArray(pins) ? pins : [];
    for (const p of arr) {
        if (!p || typeof p !== 'object') continue;
        const chatId = String(p.chatId == null ? '' : p.chatId).trim();
        if (!chatId || seen.has(chatId)) continue;
        if (out.length >= PIN_TOP_LIMITS.maxPinned) break;
        seen.add(chatId);
        out.push({ chatId, pinnedAt: numOrNull(p.pinnedAt) });
    }
    return out;
}

export function orderChats(chats, pins) {
    const list = Array.isArray(chats) ? chats.filter((c) => c && typeof c === 'object') : [];
    const pinList = normalizePinSet(pins);
    const pinMap = new Map(pinList.map((p, i) => [p.chatId, { at: p.pinnedAt, idx: i }]));
    const pinned = [];
    const rest = [];
    for (let i = 0; i < list.length; i++) {
        const id = String(list[i].id == null ? '' : list[i].id).trim();
        const rec = Object.assign({ _srcIdx: i }, list[i]);
        if (id && pinMap.has(id)) pinned.push({ chat: rec, pin: pinMap.get(id) });
        else rest.push(rec);
    }
    pinned.sort((a, b) => {
        const aa = a.pin.at;
        const ba = b.pin.at;
        if (aa != null && ba != null && aa !== ba) return aa - ba;
        if (aa != null && ba == null) return -1;
        if (aa == null && ba != null) return 1;
        return a.pin.idx - b.pin.idx;
    });
    const ordered = pinned.map((x) => x.chat).concat(rest);
    let face = 'unpinned';
    if (list.length === 0) face = 'empty';
    else if (pinned.length > 0) face = 'pinned';
    return { face, chats: ordered, pinnedCount: pinned.length, total: list.length };
}

function pinTopNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '还没有任何会话';
    if (face === 'pinned') return `置顶 ${r.pinnedCount} 个会话`;
    return '没有置顶的会话';
}

export function pinTopSelfCheck() {
    const bad = [];
    const chats = [
        { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }
    ];
    const pinned = orderChats(chats, [{ chatId: 'c', pinnedAt: 10 }, { chatId: 'a', pinnedAt: 20 }]);
    if (pinned.face !== 'pinned') bad.push('有置顶却不是 pinned');
    if (pinned.chats[0].id !== 'c' || pinned.chats[1].id !== 'a' || pinned.chats[2].id !== 'b') bad.push('置顶排序错');
    const none = orderChats(chats, []);
    if (none.face !== 'unpinned' || none.pinnedCount !== 0) bad.push('无置顶应为 unpinned');
    if (orderChats([], []).face !== 'empty') bad.push('空集应为 empty');
    const dup = normalizePinSet([{ chatId: 'x' }, { chatId: 'x' }]);
    if (dup.length !== 1) bad.push('重复置顶未去重');
    const frozen = Object.freeze([{ id: 'a' }]);
    const before = JSON.stringify(frozen);
    orderChats(frozen, [{ chatId: 'a', pinnedAt: 1 }]);
    if (JSON.stringify(frozen) !== before) bad.push('改了入参');
    return { ok: bad.length === 0, bad };
}
