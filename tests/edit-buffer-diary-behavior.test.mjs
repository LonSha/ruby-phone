import test from 'node:test';
import assert from 'node:assert/strict';
import { DiaryView } from '../apps/diary/diary-view.js';

function fixture() {
    const values = new Map();
    const entries = [];
    let persisted = null, saveEnabled = false, waitForSave = false, release;
    const doc = { createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {}, addEventListener() {} }), defaultView: { Event } };
    const textarea = { value: '初稿', addEventListener() {}, insertAdjacentElement() {}, selectionStart: 0, ownerDocument: doc };
    const save = {};
    const els = { 'diary-new-text': textarea, 'diary-new-save': save };
    doc.getElementById = id => els[id] || null;
    const ctx = { chatId: 'chat-a', characterId: 0, characters: [{ name: 'A', avatar: 'a.png' }], getRequestHeaders: () => ({}),
        async saveChat() { if (waitForSave) await new Promise(r => { release = r; }); if (saveEnabled) persisted = values.get('diary_entries'); } };
    const storage = { NAMESPACE: 'st_virtual_phone', currentConversationId: 'a', getContext: () => ctx,
        get: (k, f) => values.has(k) ? values.get(k) : f, set: async (k, v) => { values.set(k, v); } };
    const flush = () => values.set('diary_entries', JSON.stringify(entries));
    let n = 0;
    const view = Object.create(DiaryView.prototype);
    Object.assign(view, { currentView: 'new', render() { this.rendered = (this.rendered || 0) + 1; }, app: { storage, diaryData: {
        getEntry: id => entries.find(e => e.id === id) || null,
        createManualEntry(content) { const e = { id: 'd' + (++n), content }; entries.push(e); flush(); return e; },
        updateEntryContent(id, content) { const e = entries.find(x => x.id === id); if (!e) return false; e.content = content; flush(); return true; }
    } } });
    const prev = { document: globalThis.document, fetch: globalThis.fetch, alert: globalThis.alert, window: globalThis.window };
    globalThis.document = doc; globalThis.window = { VirtualPhone: null }; globalThis.alert = () => {};
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ chat_metadata: { st_virtual_phone: { diary_entries: persisted } } }] });
    view._bindNewEntryEvents();
    return { view, textarea, entries, submit: () => save.onclick(),
        enableSave() { saveEnabled = true; }, delaySave() { waitForSave = true; }, releaseSave() { waitForSave = false; release?.(); },
        cleanup() { Object.assign(globalThis, prev); } };
}

test('diary failed confirmation then edited retry reuses the same entry', async () => {
    const f = fixture();
    try {
        await f.submit();
        assert.equal(f.entries.length, 1);
        assert.equal(f.view.currentView, 'new');
        f.textarea.value = '改过的日记'; f.enableSave();
        await f.submit();
        assert.equal(f.entries.length, 1);
        assert.equal(f.entries[0].content, '改过的日记');
        assert.equal(f.view.currentView, 'page');
    } finally { f.cleanup(); }
});

test('diary double submit ignored and typing during confirmation keeps page and allows reuse', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.submit();
        await new Promise(r => setImmediate(r));
        await f.submit();
        f.textarea.value = '继续写';
        f.releaseSave(); await first;
        assert.equal(f.entries.length, 1);
        assert.equal(f.view.currentView, 'new');
        assert.equal(f.textarea.value, '继续写');
        await f.submit();
        assert.equal(f.entries.length, 1);
        assert.equal(f.entries[0].content, '继续写');
        assert.equal(f.view.currentView, 'page');
    } finally { f.releaseSave(); f.cleanup(); }
});
