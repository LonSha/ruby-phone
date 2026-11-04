import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatView } from '../apps/wechat/chat-view.js';

function fixture() {
    const values = new Map();
    const messages = [];
    let persisted = null, saveEnabled = false, waitForSave = false, release, n = 0;
    const input = { value: '你好', addEventListener() {} };
    const ctx = { chatId: 'chat-a', characterId: 0, characters: [{ name: 'A', avatar: 'a.png' }], getRequestHeaders: () => ({}),
        async saveChat() { if (waitForSave) await new Promise(r => { release = r; }); if (saveEnabled) persisted = values.get('msgs'); } };
    const storage = { NAMESPACE: 'st_virtual_phone', currentConversationId: 'a', getContext: () => ctx,
        get: (k, f) => values.has(k) ? values.get(k) : f, set: async (k, v) => { values.set(k, v); } };
    const flush = () => values.set('msgs', JSON.stringify(messages));
    const enqueued = [];
    const view = Object.create(ChatView.prototype);
    Object.assign(view, {
        _isBlockedSingleChat: () => false, _resolveQuickReplySendText: t => t, _handleManualTimeAdvance: () => false,
        _shouldUseRealTimeForOnlineChat: () => false, _collapseTransientInputPanels() {}, _syncChatSendButton() {},
        _getVisibleChatMessagesContainer: () => null,
        _enqueuePendingChat: id => { enqueued.push(id); return true; },
        app: { storage, currentChat: { id: 'c1' }, phoneShell: { showNotification() {} }, render() {}, wechatData: {
            getUserInfo: () => ({ avatar: 'x' }), getMessages: () => messages, _getMessageKey: () => 'msgs',
            addMessage(_id, m) { m.id = 'm' + (++n); messages.push(m); flush(); }, _saveMessages: flush, saveData() {}
        } }
    });
    const prev = { document: globalThis.document, fetch: globalThis.fetch, window: globalThis.window };
    globalThis.document = { querySelector: () => null, body: { classList: { add() {}, remove() {} } } };
    globalThis.window = { innerWidth: 1000, VirtualPhone: null };
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ chat_metadata: { st_virtual_phone: { msgs: persisted } } }] });
    const send = () => { view._lastSendClickTime = 0; return view.handleSendClick(input); };
    return { view, input, messages, enqueued, send,
        enableSave() { saveEnabled = true; }, delaySave() { waitForSave = true; }, releaseSave() { waitForSave = false; release?.(); },
        cleanup() { Object.assign(globalThis, prev); } };
}

test('chat failed confirmation then edited retry reuses one message', async () => {
    const f = fixture();
    try {
        await f.send();
        assert.equal(f.messages.length, 1);
        assert.equal(f.input.value, '你好');
        f.input.value = '你好呀'; f.enableSave();
        await f.send();
        assert.equal(f.messages.length, 1);
        assert.equal(f.messages[0].content, '你好呀');
        assert.equal(f.input.value, '');
        assert.deepEqual(f.enqueued, ['c1']);
    } finally { f.cleanup(); }
});

test('chat double send ignored; typing during confirmation keeps text, no enqueue, retry reuses', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.send();
        await new Promise(r => setImmediate(r));
        await f.send();
        f.input.value = '再补一句';
        f.releaseSave(); await first;
        assert.equal(f.messages.length, 1);
        assert.equal(f.input.value, '再补一句');
        assert.equal(f.enqueued.length, 0);
        await f.send();
        assert.equal(f.messages.length, 1);
        assert.equal(f.messages[0].content, '再补一句');
        assert.equal(f.enqueued.length, 1);
    } finally { f.releaseSave(); f.cleanup(); }
});

test('chat receipt after switching chat window does not clear or enqueue', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.send();
        await new Promise(r => setImmediate(r));
        f.view.app.currentChat = { id: 'c2' };
        f.releaseSave(); await first;
        assert.equal(f.input.value, '你好');
        assert.equal(f.enqueued.length, 0);
        assert.equal(f.view._pendingTextConfirmation.inFlight, false);
    } finally { f.releaseSave(); f.cleanup(); }
});