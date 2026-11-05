import { readChores } from './shared-chore-store.js';
function fingerprint(value) {
    const text = JSON.stringify(value); let a = 2166136261; let b = 5381;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
    return text.length + ':' + (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16);
}
export const AFFAIR_LIVE_KEY = 'affairs_live_v1';
export function liveSources(storage) {
    const chores = readChores(storage);
    const rows = chores.ok ? chores.rows.map(c => ({ key: 'chore:' + c.id, label: c.title, value: fingerprint(c) })) : [];
    const unavailable = chores.ok ? [] : ['共同事项'];
    for (const [key, kind, label] of [['calendar_memos', 'calendar', '日历'], ['tv_party', 'travel', '旅行']]) {
        try {
            const raw = storage.get(key);
            const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (value == null) continue;
            const list = kind === 'calendar' ? value : [value];
            if (!Array.isArray(list) || list.some(r => !r || typeof r.id !== 'string' || !r.id) || new Set(list.map(r => r.id)).size !== list.length) throw Error('bad source');
            for (const item of list) rows.push({ key: kind + ':' + item.id, label: item.title || item.id, value: fingerprint(item) });
        } catch (_) { unavailable.push(label); }
    }
    try {
        const raw = storage.get('pixiv_content'); const content = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (content != null) {
            if (!content || typeof content !== 'object' || !Array.isArray(content.novels)) throw Error('bad works');
            for (const work of content.novels) {
                if (!work || typeof work.id !== 'string' || !work.id) throw Error('bad identity');
                rows.push({ key: 'work:' + work.id, label: work.title || work.id, value: fingerprint(work) });
            }
        }
    } catch (_) { unavailable.push('作品'); }
    const wechat = globalThis.window?.VirtualPhone?.wechatApp?.wechatData;
    if (!wechat || wechat.storage !== storage || typeof wechat.getMessages !== 'function') unavailable.push('回复');
    else {
        try {
            for (const chat of wechat.data.chats) {
                if (!wechat._messagesLoaded?.[chat.id] || !Array.isArray(wechat.data.messages?.[chat.id])) { unavailable.push('回复'); continue; }
                const messages = wechat.data.messages[chat.id].filter(m => m && m.id && m.type === 'text' && !['me', 'system'].includes(m.sender) && !m.hiddenFromPreview && !m.isTimeMarker && String(m.content || '').trim());
                rows.push({ key: 'reply:' + chat.id, label: (chat.name || chat.id) + ' 的回复', value: fingerprint(messages) });
            }
        } catch (_) { unavailable.push('回复'); }
    }
    return { rows, unavailable };
}
export function readLive(storage) {
    try {
        const raw = storage.get(AFFAIR_LIVE_KEY, false);
        const rows = raw == null ? [] : typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(rows) || rows.length > 40 || rows.some(r => !r || typeof r.id !== 'string' || !r.id.trim() || typeof r.title !== 'string' || !Array.isArray(r.refs) || r.refs.length > 24 || r.refs.some(x => typeof x !== 'string') || !r.seen || typeof r.seen !== 'object' || Array.isArray(r.seen) || Object.entries(r.seen).some(([key,value]) => !r.refs.includes(key) || typeof value !== 'string' || !/^\d+:[0-9a-f]+:[0-9a-f]+$/.test(value))) || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('bad storage');
        return { ok: true, rows };
    } catch (_) { return { ok: false, rows: [] }; }
}
export function liveChanges(entry, sources) {
    return [...new Set(entry.refs)].map(key => {
        const source = sources.rows.find(r => r.key === key);
        const kind = key.split(':')[0];
        const unknown = sources.unavailable.includes({chore:'共同事项',calendar:'日历',travel:'旅行',work:'作品',reply:'回复'}[kind]);
        return { key, label: source?.label || key, state: !source && unknown ? '来源读不出来' : !source ? '来源失效' : !Object.hasOwn(entry.seen, key) ? '新增' : entry.seen[key] !== source.value ? '已修改' : '无变化' };
    });
}
export function writeLive(storage, rows) {
    const before = readLive(storage);
    if (!before.ok || !Array.isArray(rows) || rows.length > 40) return false;
    const candidate = readLive({ get: () => rows });
    if (!candidate.ok || rows.some(r => !r.title.trim() || r.title.length > 80 || !r.refs.length || new Set(r.refs).size !== r.refs.length || r.refs.some(key => !/^(chore|calendar|travel|work|reply):.+$/.test(key)))) return false;
    try {
        storage.set(AFFAIR_LIVE_KEY, JSON.stringify(rows), false);
        const back = readLive(storage);
        return back.ok && JSON.stringify(back.rows) === JSON.stringify(rows);
    } catch (_) { return false; }
}
