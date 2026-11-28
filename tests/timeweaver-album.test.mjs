import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeweaverApp } from '../apps/timeweaver/timeweaver-app.js';

function fixture() {
    const data = { diary_entries: [{ content: 'first', createdAt: 1000 }] };
    const storage = { get: k => data[k], set: async (k, v) => { data[k] = v; } };
    return { data, app: new TimeweaverApp({ setContent() {} }, storage) };
}

test('forced weaves in the same millisecond are distinct; legacy JSON remains shareable', async t => {
    const { app, data } = fixture();
    t.mock.method(Date, 'now', () => 1700000000000);
    const old = { id: 'Lold', ts: 123, savedAt: 124, title: 'old', source: 'local', paragraphs: ['legacy text'], meta: { keep: true } };
    data.tw_letters = JSON.stringify([old]);
    assert.equal((await app.autoWeaveIfDue()).generated, true);
    assert.equal((await app.autoWeaveIfDue({ force: true })).generated, true);
    const letters = app.listLetters();
    assert.equal(letters.length, 3);
    assert.notEqual(letters[0].ts, letters[1].ts);
    assert.deepEqual(letters[2], old);
    let post;
    app._vp = () => ({ cachedWechatData: { addMoment: m => { post = m; } } });
    app.view._shareById(old.id);
    assert.match(post.text, /legacy text/);
});

test('save button collects the displayed letter once, even when source changes before clicking', async t => {
    const { app, data } = fixture();
    let time = 100000, click;
    t.mock.method(Date, 'now', () => ++time);
    app.phoneShell.element = { querySelectorAll: () => [], querySelector: sel => sel === '#tw-save' ? {
        addEventListener: (_, fn) => { click = fn; }
    } : null };
    app.phoneShell.showNotification = () => {};
    app.view.render();
    click();
    await new Promise(setImmediate);
    click();
    await new Promise(setImmediate);
    assert.equal(app.listLetters().length, 1);
    const original = app.listLetters()[0];
    data.tw_letters = [];
    data.diary_entries = [];
    click();
    await new Promise(setImmediate);
    assert.deepEqual(app.listLetters()[0]?.paragraphs, original.paragraphs);
});

test('blank letter is rejected; duplicate signature uses the first retained paragraph', async () => {
    const { app, data } = fixture();
    assert.equal((await app.saveLetter({ paragraphs: [' ', ''] })).ok, false);
    assert.equal(data.tw_letters, undefined);
    const letter = { ts: 12, paragraphs: ['', 'body'] };
    assert.equal((await app.saveLetter(letter)).ok, true);
    assert.equal((await app.saveLetter(letter)).ok, false);
});

for (const mode of ['throw', 'noop']) test(`album write ${mode} permits retry without advancing cursor`, async () => {
    const { app, data } = fixture();
    const write = app.storage.set;
    app.storage.set = async (k, v) => {
        if (k !== 'tw_letters') return write(k, v);
        if (mode === 'throw') throw Error('refused');
    };
    assert.equal((await app.autoWeaveIfDue()).generated, false);
    assert.equal(data.tw_last_auto, undefined);
    app.storage.set = write;
    assert.equal((await app.autoWeaveIfDue()).generated, true);
});

for (const success of [true, false]) test(`late AI result (${success}) cannot fill a new session's album`, async () => {
    const { app, data } = fixture();
    let finish;
    app._vp = () => ({ apiManager: { callAI: () => new Promise(resolve => { finish = resolve; }) } });
    const pending = app.autoWeaveIfDue();
    app.onChatChanged();
    finish({ success, text: 'previous session' });
    assert.equal((await pending).generated, false);
    assert.equal(app.aiLetter, null);
    assert.equal(data.tw_letters, undefined);
    assert.equal(data.tw_last_auto, undefined);
});
