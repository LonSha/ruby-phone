import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarView } from '../apps/calendar/calendar-view.js';

test('calendar create receipt after page navigation cannot create a commitment or close the new page', async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    let release;
    let persisted;
    const values = new Map([['memos', JSON.stringify([{ id: 'm1', dateKey: '2026-11-04', title: '约会', time: '10:00', type: 'date' }])]]);
    const input = { value: '约会', addEventListener() {}, insertAdjacentElement() {}, selectionStart: 0 };
    const time = { value: '10:00', addEventListener() {}, insertAdjacentElement() {}, selectionStart: null };
    const root = { querySelector(selector) { return selector === '#yzp-calendar-memo-input' ? input : selector === '#yzp-calendar-time-input' ? time : null; }, querySelectorAll() { return []; } };
    const form = { addEventListener(_name, handler) { this.handler = handler; } };
    const doc = { createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {} }), defaultView: { Event }, querySelector(selector) { return selector === '.phone-view-current' ? root : selector === '.phone-view-current .yzp-calendar-app' ? root : null; } };
    input.ownerDocument = doc; time.ownerDocument = doc;
    root.querySelector = (selector) => selector === '#yzp-calendar-memo-input' ? input : selector === '#yzp-calendar-time-input' ? time : selector === '#yzp-calendar-add-form' ? form : null;
    const ctx = { chatId: 'chat-a', characterId: 0, characters: [{ name: 'A', avatar: 'a' }], getRequestHeaders: () => ({}), async saveChat() { await new Promise(resolve => { release = resolve; }); persisted = values.get('memos'); } };
    const storage = { NAMESPACE: 'st_virtual_phone', currentConversationId: 'a', getContext: () => ctx, get: (k, fallback) => values.has(k) ? values.get(k) : fallback, async set(k, v) { values.set(k, v); } };
    const memos = [{ id: 'm1', dateKey: '2026-11-04', title: '约会', time: '10:00', type: 'date' }];
    const commitments = [];
    const view = Object.create(CalendarView.prototype);
    Object.assign(view, { app: { storage, calendarData: { memoKey: 'memos', getMemos: () => memos, normalizeType: x => x }, phoneShell: { showNotification() {} }, _getContext: () => ({}), proposeCommitmentFromMemo(x) { commitments.push(x); return { ok: true, item: { id: 'c1', status: 'proposed' } }; }, confirmCommitmentById() {} }, selectedDate: {}, selectedMemoType: 'date', addPanelOpen: true, toDateKey: () => '2026-11-04', bindPromptFoldToggles() {}, render() { this.rendered = true; } });
    try {
        globalThis.document = doc; globalThis.window = { VirtualPhone: null };
        globalThis.fetch = async () => ({ ok: true, async json() { return [{ chat_metadata: { st_virtual_phone: { memos: persisted } } }]; } });
        view.bindEvents();
        view.app.calendarData.updateMemo = () => true;
        view._pendingMemoConfirmation = { sessionId: 'a', id: 'm1', inFlight: false };
        const save = form.handler({ preventDefault() {} });
        await new Promise(resolve => setImmediate(resolve));
        doc.querySelector = selector => selector === '.phone-view-current' ? root : null;
        release();
        await save;
        assert.equal(commitments.length, 0);
        assert.equal(view.addPanelOpen, true);
        assert.equal(view._pendingMemoConfirmation.inFlight, false);
    } finally {
        release?.(); globalThis.document = previousDocument; globalThis.window = previousWindow; globalThis.fetch = previousFetch;
    }
});
