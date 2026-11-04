import test from 'node:test';
import assert from 'node:assert/strict';
import { MomentsView } from '../apps/wechat/moments-view.js';

function fixture() {
    const values = new Map();
    const data = { moments: [] };
    let persisted = null, saveEnabled = false, waitForSave = false, release, onPage = true;
    const textarea = { value: '第一条动态', addEventListener() {} };
    const doc = { getElementById: id => id === 'moment-text-input' && onPage ? textarea : null };
    const ctx = { chatId: 'chat-a', characterId: 0, characters: [{ name: 'A', avatar: 'a.png' }], getRequestHeaders: () => ({}),
        async saveChat() { if (waitForSave) await new Promise(r => { release = r; }); if (saveEnabled) persisted = values.get('wechat'); } };
    const storage = { NAMESPACE: 'st_virtual_phone', currentConversationId: 'a', getContext: () => ctx,
        get: (k, f) => values.has(k) ? values.get(k) : f, set: async (k, v) => { values.set(k, v); } };
    const flush = () => values.set('wechat', JSON.stringify(data));
    const notes = [];
    const view = Object.create(MomentsView.prototype);
    Object.assign(view, {
        pendingMomentImages: [],
        _extractMomentImageTagsFromText: text => ({ text, images: [] }),
        _getCurrentPhoneTimeSnapshot: () => ({ time: '10:00', date: '2026-11-04', weekday: '三', timestamp: 1 }),
        triggerAIReaction: async () => {},
        _leavePostMomentDraft() {},
        app: { storage, phoneShell: { showNotification: (...a) => notes.push(a) }, render() {}, wechatData: {
            data, getUserInfo: () => ({ name: '我', avatar: '😊' }), getStorageKey: () => 'wechat',
            addMoment(m) { data.moments.unshift(m); flush(); }, saveData: flush
        } }
    });
    const prev = { document: globalThis.document, fetch: globalThis.fetch, window: globalThis.window, setTimeout: globalThis.setTimeout };
    globalThis.document = doc; globalThis.window = { VirtualPhone: null };
    globalThis.setTimeout = () => 0;
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ chat_metadata: { st_virtual_phone: { wechat: persisted } } }] });
    return { view, textarea, data, notes, submit: () => view.publishMoment(), leave() { onPage = false; },
        enableSave() { saveEnabled = true; }, delaySave() { waitForSave = true; }, releaseSave() { waitForSave = false; release?.(); },
        cleanup() { Object.assign(globalThis, prev); } };
}

test('moment failed confirmation then edited retry reuses one moment', async () => {
    const f = fixture();
    try {
        await f.submit();
        assert.equal(f.data.moments.length, 1);
        assert.equal(f.view._postMomentDraftCommitted, undefined);
        f.textarea.value = '改过的动态'; f.enableSave();
        await f.submit();
        assert.equal(f.data.moments.length, 1);
        assert.equal(f.data.moments[0].text, '改过的动态');
        assert.equal(f.view._postMomentDraftCommitted, true);
    } finally { f.cleanup(); }
});

test('moment double publish ignored; typing during confirmation keeps draft and retry reuses', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.submit();
        await new Promise(r => setImmediate(r));
        await f.submit();
        f.textarea.value = '继续写';
        f.releaseSave(); await first;
        assert.equal(f.data.moments.length, 1);
        assert.notEqual(f.view._postMomentDraftCommitted, true);
        await f.submit();
        assert.equal(f.data.moments.length, 1);
        assert.equal(f.data.moments[0].text, '继续写');
        assert.equal(f.view._postMomentDraftCommitted, true);
    } finally { f.releaseSave(); f.cleanup(); }
});

test('moment receipt after leaving the page does not mark published or navigate', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.submit();
        await new Promise(r => setImmediate(r));
        f.leave();
        f.releaseSave(); await first;
        assert.notEqual(f.view._postMomentDraftCommitted, true);
        assert.equal(f.view._pendingMomentConfirmation.inFlight, false);
    } finally { f.releaseSave(); f.cleanup(); }
});