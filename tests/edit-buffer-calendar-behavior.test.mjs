import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarView } from '../apps/calendar/calendar-view.js';

function fixture() {
    const handlers = new Map();
    const memos = [];
    const commitments = [];
    const values = new Map();
    let persisted = null;
    let saveEnabled = false;
    let release;
    let waitForSave = false;
    let pageActive = true;
    const title = { value: '初稿', addEventListener() {}, insertAdjacentElement() {}, selectionStart: 0 };
    const time = { value: '10:00', addEventListener() {}, insertAdjacentElement() {}, selectionStart: null };
    const doc = {
        createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {}, textContent: '' }),
        defaultView: { Event },
        querySelector(selector) {
            if (selector === '.phone-view-current') return root;
            if (selector === '.phone-view-current .yzp-calendar-app') return pageActive ? root : null;
            return null;
        }
    };
    title.ownerDocument = doc;
    time.ownerDocument = doc;
    const root = {
        querySelector(selector) {
            if (selector === '#yzp-calendar-memo-input') return title;
            if (selector === '#yzp-calendar-time-input') return time;
            if (selector === '#yzp-calendar-add-form') return { addEventListener: (name, fn) => handlers.set(name, fn) };
            return null;
        },
        querySelectorAll: () => []
    };
    const ctx = {
        chatId: 'chat-a', characterId: 0, characters: [{ name: 'A', avatar: 'a.png' }],
        getRequestHeaders: () => ({}),
        async saveChat() {
            if (waitForSave) await new Promise(resolve => { release = resolve; });
            if (saveEnabled) persisted = values.get('memos');
        }
    };
    const storage = {
        NAMESPACE: 'st_virtual_phone', currentConversationId: 'a', getContext: () => ctx,
        get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        set: async (key, value) => { values.set(key, value); }
    };
    const save = () => values.set('memos', JSON.stringify(memos));
    const app = {
        storage,
        calendarData: {
            memoKey: 'memos', getMemos: () => memos, normalizeType: x => x,
            addMemo(input) { const memo = { ...input, id: 'memo-1' }; memos.push(memo); save(); return memo; },
            updateMemo(id, input) { const memo = memos.find(x => x.id === id); if (!memo) return false; Object.assign(memo, input); save(); return true; }
        },
        phoneShell: { showNotification() {} },
        _getContext: () => ({ name1: 'user', name2: 'character' }),
        proposeCommitmentFromMemo(input) { commitments.push(input); return { ok: true, item: { id: 'apt-1', status: 'proposed' } }; },
        confirmCommitmentById() {}
    };
    const view = Object.create(CalendarView.prototype);
    Object.assign(view, { app, selectedDate: {}, selectedMemoType: 'date', addPanelOpen: true,
        toDateKey: () => '2026-11-04', bindPromptFoldToggles() {}, render() {} });
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    globalThis.document = doc;
    globalThis.window = { VirtualPhone: null };
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ chat_metadata: { st_virtual_phone: { memos: persisted } } }] });
    view.bindEvents();
    return { view, title, time, memos, commitments, storage, submit: () => handlers.get('submit')({ preventDefault() {} }),
        enableSave() { saveEnabled = true; }, delaySave() { waitForSave = true; },
        releaseSave() { waitForSave = false; release?.(); },
        leavePage() { pageActive = false; }, cleanup() { globalThis.document = previousDocument; globalThis.window = previousWindow; globalThis.fetch = previousFetch; } };
}

test('calendar failed confirmation then changed retry reuses memo and creates only final commitment', async () => {
    const f = fixture();
    try {
        await f.submit();
        assert.equal(f.memos.length, 1);
        assert.equal(f.commitments.length, 0);
        assert.equal(f.view.addPanelOpen, true);
        f.title.value = '修改后的约会'; f.time.value = '11:30'; f.enableSave();
        await f.submit();
        assert.equal(f.memos.length, 1);
        assert.equal(f.memos[0].title, '修改后的约会');
        assert.equal(f.commitments.length, 1);
        assert.equal(f.commitments[0].content, '修改后的约会');
        assert.equal(f.commitments[0].time, '11:30');
        assert.equal(f.view.addPanelOpen, false);
    } finally { f.cleanup(); }
});

test('calendar double submit is ignored while confirmation is in flight', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.submit();
        await new Promise(resolve => setImmediate(resolve));
        await f.submit();
        assert.equal(f.memos.length, 1);
        f.releaseSave(); await first;
        assert.equal(f.commitments.length, 1);
    } finally { f.releaseSave(); f.cleanup(); }
});

test('calendar does not close or create commitment when input changes during confirmation', async () => {
    const f = fixture();
    try {
        f.enableSave(); f.delaySave();
        const first = f.submit();
        await new Promise(resolve => setImmediate(resolve));
        f.title.value = '继续输入';
        f.releaseSave(); await first;
        assert.equal(f.title.value, '继续输入');
        assert.equal(f.view.addPanelOpen, true);
        assert.equal(f.commitments.length, 0);
    } finally { f.releaseSave(); f.cleanup(); }
});
