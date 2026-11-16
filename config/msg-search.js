/**
 * 微信消息全文搜索 —— 唯一桥（v4.157.0 · R22-O4）
 *
 * 纪律：纯函数。跨会话搜消息全文，按 storyAt 倒序，命中给会话+消息定位，用于跳回原会话。
 * 只读既有消息数组，不建索引、不写存储。时刻读不出不回落墙钟（排序沉底）。
 */
import { numOrNull } from './num-gate.js';

export const MSG_SEARCH_FACES = Object.freeze(['empty', 'results', 'noMatch']);
export const MSG_SEARCH_LIMITS = Object.freeze({ maxHits: 50 });

export function searchMessages(conversations, query) {
    const convs = Array.isArray(conversations) ? conversations.filter((c) => c && typeof c === 'object') : [];
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (convs.length === 0) return { face: 'empty', hits: [], total: 0 };
    if (!q) return { face: 'empty', hits: [], total: 0, query: '' };
    const hits = [];
    for (const conv of convs) {
        const chatId = String(conv.id == null ? '' : conv.id).trim();
        const msgs = Array.isArray(conv.messages) ? conv.messages : [];
        for (const m of msgs) {
            if (!m || typeof m !== 'object') continue;
            const text = String(m.text != null ? m.text : (m.content != null ? m.content : ''));
            const idx = text.toLowerCase().indexOf(q);
            if (idx < 0) continue;
            const start = Math.max(0, idx - 16);
            hits.push({
                chatId,
                chatName: String(conv.name == null ? '' : conv.name),
                msgId: m.id != null ? m.id : null,
                snippet: text.slice(start, start + 100),
                hitAt: idx - start,
                atMs: numOrNull(m.storyAt != null ? m.storyAt : m.at)
            });
        }
    }
    hits.sort((a, b) => {
        if (a.atMs == null && b.atMs == null) return 0;
        if (a.atMs == null) return 1;
        if (b.atMs == null) return -1;
        return b.atMs - a.atMs;
    });
    const capped = hits.slice(0, MSG_SEARCH_LIMITS.maxHits);
    if (capped.length === 0) return { face: 'noMatch', hits: [], total: 0, query: q };
    return { face: 'results', hits: capped, total: hits.length, truncated: hits.length > capped.length, query: q };
}

export function msgSearchNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '没有可搜的消息';
    if (face === 'noMatch') return `没有找到含「${r.query}」的消息`;
    const extra = r.truncated ? `（共 ${r.total} 条，显示前 ${r.hits.length}）` : '';
    return `找到 ${r.total} 条消息${extra}`;
}

export function msgSearchSelfCheck() {
    const bad = [];
    const convs = [
        { id: 'c1', name: '小明', messages: [{ id: 'm1', text: '今天下雨了', storyAt: 100 }, { id: 'm2', text: '带伞', storyAt: 200 }] },
        { id: 'c2', name: '小红', messages: [{ id: 'm3', text: '下雨别忘了伞', storyAt: 150 }] }
    ];
    if (searchMessages([], '雨').face !== 'empty') bad.push('空会话应 empty');
    if (searchMessages(convs, '').face !== 'empty') bad.push('空查询应 empty');
    const r = searchMessages(convs, '雨');
    if (r.face !== 'results' || r.total !== 2) bad.push('命中数错，得 ' + r.total);
    if (r.hits[0].atMs !== 150) bad.push('应按 storyAt 倒序，得 ' + r.hits[0].atMs);
    if (searchMessages(convs, '雪').face !== 'noMatch') bad.push('无命中应 noMatch');
    const noAt = searchMessages([{ id: 'x', messages: [{ id: 'z', text: '雨' }] }], '雨');
    if (noAt.hits[0].atMs !== null) bad.push('无时刻应为 null 不回落');
    return { ok: bad.length === 0, bad };
}
