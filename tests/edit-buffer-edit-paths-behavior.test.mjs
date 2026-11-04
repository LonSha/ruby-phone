import test from 'node:test';
import assert from 'node:assert/strict';
import { DiaryView } from '../apps/diary/diary-view.js';
import { CalendarView } from '../apps/calendar/calendar-view.js';

function host(key) {
    const values = new Map();
    const state = { persisted: null, saveEnabled: true, wait: false, release: null };
    const ctx = { chatId: 'chat-a', characterId: 0, characters: [{ name: 'A', avatar: 'a.png' }], getRequestHeaders: () => ({}),
        async saveChat() { if (state.wait) await new Promise(r => { state.release = r; }); if (state.saveEnabled) state.persisted = values.get(key); } };
    const storage = { NAMESPACE: 'st_virtual_phone', currentConversationId: 'a', getContext: () => ctx,
        get: (k, f) => values.has(k) ? values.get(k) : f, set: async (k, v) => { values.set(k, v); } };
    const fetch = async () => ({ ok: true, json: async () => [{ chat_metadata: { st_virtual_phone: { [key]: state.persisted } } }] });
    return { values, state, storage, fetch, release() { state.wait = false; state.release?.(); } };
}
const tick = () => new Promise(r => setImmediate(r));
function swapGlobals(next) {
    const prev = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, alert: globalThis.alert };
    Object.assign(globalThis, next);
    return () => Object.assign(globalThis, prev);
}

function diaryFixture() {
    const h = host('diary_entries');
    const entries = [{ id: 'd1', content: '旧内容' }];
    const flush = () => h.values.set('diary_entries', JSON.stringify(entries));
    flush();
    let updates = 0;
    const textarea = { value: '新内容', addEventListener() {}, insertAdjacentElement() {}, selectionStart: 0 };
    const els = { 'diary-edit-text': textarea, 'diary-edit-save': {}, 'diary-edit-cancel': {} };
    const doc = { getElementById: id => els[id] || null, defaultView: { Event },
        createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {}, addEventListener() {} }) };
    textarea.ownerDocument = doc;
    const view = Object.create(DiaryView.prototype);
    Object.assign(view, { _editingEntryId: 'd1', currentView: 'edit', render() {}, app: { storage: h.storage, diaryData: {
        updateEntryContent(id, c) { updates++; const e = entries.find(x => x.id === id); if (!e) return false; e.content = c; flush(); return true; }
    } } });
    const restore = swapGlobals({ document: doc, window: { VirtualPhone: null }, fetch: h.fetch, alert() {} });
    view._bindEditEvents();
    return { h, view, textarea, entries, els, get updates() { return updates; }, save: () => els['diary-edit-save'].onclick(), restore };
}

test('diary edit: double save ignored while confirming; success closes editor', async () => {
    const f = diaryFixture();
    try {
        f.h.state.wait = true;
        const first = f.save(); await tick();
        await f.save();
        assert.equal(f.updates, 1);
        f.h.release(); await first;
        assert.equal(f.view._editingEntryId, null);
        assert.notEqual(f.view.currentView, 'edit');
    } finally { f.h.release(); f.restore(); }
});

test('diary edit: typing during confirmation keeps editor open; later save works', async () => {
    const f = diaryFixture();
    try {
        f.h.state.wait = true;
        const first = f.save(); await tick();
        f.textarea.value = '再改一次';
        f.h.release(); await first;
        assert.equal(f.view._editingEntryId, 'd1');
        await f.save();
        assert.equal(f.entries[0].content, '再改一次');
        assert.equal(f.view._editingEntryId, null);
    } finally { f.h.release(); f.restore(); }
});

test('diary edit: unconfirmed save keeps editor and text', async () => {
    const f = diaryFixture();
    try {
        f.h.state.saveEnabled = false;
        await f.save();
        assert.equal(f.view._editingEntryId, 'd1');
        assert.equal(f.textarea.value, '新内容');
    } finally { f.restore(); }
});

function calendarEditFixture() {
    const h = host('memos');
    const memos = [{ id: 'm1', dateKey: '2026-11-04', title: '旧', time: '09:00', type: 'daily' }];
    const flush = () => h.values.set('memos', JSON.stringify(memos));
    flush();
    let updates = 0;
    const handlers = new Map();
    const title = { value: '新标题', addEventListener() {} };
    const time = { value: '10:00', addEventListener() {} };
    let active = true;
    const root = {
        querySelector(s) {
            if (s === '#yzp-calendar-edit-input') return title;
            if (s === '#yzp-calendar-edit-time-input') return time;
            if (s === '#yzp-calendar-edit-form') return { addEventListener: (n, fn) => handlers.set(n, fn) };
            return null;
        },
        querySelectorAll: () => []
    };
    const doc = { querySelector: s => s === '.phone-view-current .yzp-calendar-app' ? (active ? root : null) : null };
    const view = Object.create(CalendarView.prototype);
    Object.assign(view, { detailMemoId: 'm1', detailEditMode: true, editMemoType: 'daily', selectedDate: {},
        toDateKey: () => '2026-11-04', bindPromptFoldToggles() {}, render() {},
        app: { storage: h.storage, phoneShell: { showNotification() {} }, calendarData: {
            memoKey: 'memos', getMemos: () => memos, normalizeType: x => x,
            updateMemo(id, input) { updates++; const m = memos.find(x => x.id === id); if (!m) return false; Object.assign(m, input); flush(); return true; }
        } } });
    const restore = swapGlobals({ document: doc, window: { VirtualPhone: null }, fetch: h.fetch });
    view.bindEvents();
    return { h, view, title, memos, get updates() { return updates; }, leave() { active = false; },
        submit: () => handlers.get('submit')({ preventDefault() {} }), restore };
}

test('calendar edit: double submit ignored while confirming; success exits edit mode', async () => {
    const f = calendarEditFixture();
    try {
        f.h.state.wait = true;
        const first = f.submit(); await tick();
        await f.submit();
        assert.equal(f.updates, 1);
        f.h.release(); await first;
        assert.equal(f.view.detailEditMode, false);
        assert.equal(f.memos[0].title, '新标题');
    } finally { f.h.release(); f.restore(); }
});

test('calendar edit: leaving page during confirmation does not toggle edit state; unconfirmed keeps edit', async () => {
    const f = calendarEditFixture();
    try {
        f.h.state.wait = true;
        const first = f.submit(); await tick();
        f.leave();
        f.h.release(); await first;
        assert.equal(f.view.detailEditMode, true);
    } finally { f.h.release(); f.restore(); }
    const g = calendarEditFixture();
    try {
        g.h.state.saveEnabled = false;
        await g.submit();
        assert.equal(g.view.detailEditMode, true);
        assert.equal(g.title.value, '新标题');
    } finally { g.restore(); }
});