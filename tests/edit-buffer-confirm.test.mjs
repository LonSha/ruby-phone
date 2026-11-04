import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmEditOwner } from '../config/edit-buffer-confirm.js';

function fixture(group = false) {
    let persisted = null;
    const value = JSON.stringify([{ id: 'submitted', content: 'hello' }]);
    const ctx = { chatId: 'chat-a', groupId: group ? 'group-a' : null, characterId: 0,
        characters: [{ name: 'A', avatar: 'a.png' }], getRequestHeaders: () => ({}),
        saveChat: async () => {} };
    const storage = { NAMESPACE: 'st_virtual_phone', currentConversationId: 'a',
        getContext: () => ctx, get: () => value, set: async () => {} };
    const fetch = async (url, opts) => {
        assert.equal(url, group ? '/api/chats/group/get' : '/api/chats/get');
        assert.equal(JSON.parse(opts.body)[group ? 'id' : 'file_name'], 'chat-a');
        return { ok: true, json: async () => [{ chat_metadata: { st_virtual_phone: { owner: persisted } } }] };
    };
    return { storage, ctx, value, fetch, persist: () => { persisted = value; } };
}
const contains = (entries) => entries.some(entry => entry.id === 'submitted');
test('server readback proves exact persisted owner for individual and group chats', async () => {
    const original = globalThis.fetch;
    try {
        for (const group of [false, true]) {
            const f = fixture(group); globalThis.fetch = f.fetch;
            let setImmediate = false;
            f.storage.set = async (_key, _value, immediate) => { setImmediate = immediate === true; };
            f.ctx.saveChat = async () => f.persist();
            assert.equal((await confirmEditOwner(f.storage, 'owner', contains)).saved, true);
            assert.equal(setImmediate, true);
        }
    } finally { globalThis.fetch = original; }
});
test('swallowed save failures, failed read and missing submitted object never confirm', async () => {
    const original = globalThis.fetch;
    try {
        const f = fixture(); globalThis.fetch = f.fetch;
        assert.equal((await confirmEditOwner(f.storage, 'owner', contains)).saved, false);
        f.persist();
        assert.equal((await confirmEditOwner(f.storage, 'owner', () => false)).saved, false);
        globalThis.fetch = async () => ({ ok: false });
        assert.equal((await confirmEditOwner(f.storage, 'owner', contains)).saved, false);
    } finally { globalThis.fetch = original; }
});
test('chat switching while host save or read is pending rejects the receipt', async () => {
    const original = globalThis.fetch;
    try {
        const f = fixture(); f.persist(); globalThis.fetch = f.fetch;
        f.ctx.saveChat = async () => { f.storage.currentConversationId = 'b'; };
        assert.equal((await confirmEditOwner(f.storage, 'owner', contains)).saved, false);
        f.storage.currentConversationId = 'a'; f.ctx.saveChat = async () => {};
        globalThis.fetch = async () => { f.storage.currentConversationId = 'b'; return f.fetch('/api/chats/get', { body: '{"file_name":"chat-a"}' }); };
        assert.equal((await confirmEditOwner(f.storage, 'owner', contains)).saved, false);
    } finally { globalThis.fetch = original; }
});
