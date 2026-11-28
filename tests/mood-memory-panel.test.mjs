import test from 'node:test';
import assert from 'node:assert/strict';
import { MoodApp } from '../apps/mood/mood-app.js';

function panel(t, core) {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = { VirtualPhone: { memoryCore: core } };
    t.after(() => { if (before) Object.defineProperty(globalThis, 'window', before); else delete globalThis.window; });
    let html;
    const app = new MoodApp({ setContent(s) { html = s; } }, {});
    app.view.tab = 'memory';
    app.render();
    return html;
}

test('realistic unlabelled memories and legacy permission labels remain distinct', t => {
    const core = { longTerm: [{ content: 'normal' }, { metadata: { _permission: 'cite' } },
        { metadata: { _permission: 'associate-only' } }, { metadata: { _permission: 'unknown' } }], shortTerm: [], stats: {} };
    const original = structuredClone(core);
    const html = panel(t, core);
    assert.match(html, /<b>2<\/b><span>未标注/);
    assert.match(html, /<b>1<\/b><span>可引用/);
    assert.match(html, /<b>1<\/b><span>仅联想/);
    assert.deepEqual(core, original);
});

test('a malformed record does not hide valid rows or inflate their count', t => {
    const html = panel(t, { longTerm: [null, {}, [], false], shortTerm: [null, {}], stats: {} });
    assert.match(html, /<b>1<\/b><span>长期/);
    assert.match(html, /<b>1<\/b><span>短期/);
});

test('historical integer counters are readable; invalid counters never become markup', t => {
    const html = panel(t, { stats: { consolidated: '12', tombstoned: '<bad-counter>', superseded: -1 } });
    assert.match(html, /<b>12<\/b><span>已巩固/);
    assert.doesNotMatch(html, /<bad-counter>|<b>-1<\/b>/);
});

test('missing memory engine remains distinguishable from an empty one', t => {
    assert.match(panel(t, null), /记忆系统没接上/);
});
