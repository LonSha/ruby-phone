import { captureSessionToken, guardSessionWrite } from './session-gate.js';

/** Confirm the exact owner value from the host's persisted chat header. The
 * host save API swallows failures, so its resolution is never a receipt. */
export async function confirmEditOwner(storage, key, contains) {
    const token = captureSessionToken(storage);
    const valid = () => {
        try { storage.getContext?.(); } catch (_e) { return false; }
        return guardSessionWrite(storage, token, 'edit-buffer-confirm');
    };
    if (!token.id || !valid()) return { saved: false, why: 'session' };
    try {
        const ctx = storage.getContext?.();
        const expected = storage.get(key, null);
        if (!ctx || typeof ctx.saveChat !== 'function' || typeof ctx.getRequestHeaders !== 'function'
            || !ctx.chatId || typeof expected !== 'string' || !storage.NAMESPACE
            || typeof contains !== 'function' || !contains(JSON.parse(expected))) {
            return { saved: false, why: 'unavailable' };
        }
        const group = Boolean(ctx.groupId);
        const character = ctx.characters?.[ctx.characterId];
        if (!group && (!character?.name || !character?.avatar)) return { saved: false, why: 'identity' };
        // Flush the exact owner snapshot before asking the host to serialize its
        // chat header. Ordinary owner methods intentionally debounce writes.
        if (typeof storage.set === 'function') await storage.set(key, expected, true);
        if (!valid()) return { saved: false, why: 'session' };
        const endpoint = group ? '/api/chats/group/get' : '/api/chats/get';
        const body = group ? { id: ctx.chatId } : {
            ch_name: character.name, file_name: ctx.chatId, avatar_url: character.avatar
        };
        await ctx.saveChat();
        if (!valid()) return { saved: false, why: 'session' };
        const response = await fetch(endpoint, { method: 'POST', headers: ctx.getRequestHeaders(),
            cache: 'no-cache', body: JSON.stringify(body) });
        if (!response.ok) return { saved: false, why: 'read_failed' };
        const chat = await response.json();
        if (!valid()) return { saved: false, why: 'session' };
        const actual = Array.isArray(chat) ? chat[0]?.chat_metadata?.[storage.NAMESPACE]?.[key] : null;
        if (actual === undefined) return { saved: false, why: 'owner_missing' };
        return actual === expected && storage.get(key, null) === expected
            ? { saved: true } : { saved: false, why: 'not_confirmed' };
    } catch (_e) { return { saved: false, why: 'error' }; }
}
