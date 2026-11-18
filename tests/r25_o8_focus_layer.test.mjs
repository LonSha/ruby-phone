/**
 * r25_o8_focus_layer.test.mjs — R25-O8 键盘与焦点
 *
 * 【咬点】
 *   1. 栈是唯一次序真源：`open` 两次后最上面那层就是最后开的（不靠 DOM 顺序猜）；
 *   2. Tab 在**最上层内**首尾相接（末个回第一个 / 首个 Shift+Tab 回末个）；
 *   3. Esc 只关一层（连按两次才关两层），且关层后焦点还给开层前那一格；
 *      那一格已不在文档里 ⇒ 如实 `restored:false`（不硬塞给 body 假装成功）；
 *   4. 兜底作用域（当前 App 内容层）**不是一层**：depth 不变、Esc 不被它吃掉；
 *   5. 没有 document ⇒ `unreadable`，不判成「栈是空的」；
 *   6. 装配点自检：index.js 真建了栈、真挂了 keydown、图片预览真入栈/出栈。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFocusLayers, FOCUSABLE_SELECTOR } from '../config/focus-layer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** 造一个可聚焦元素（focus 会记录到共享 state）。 */
function fakeEl(name, st) {
    return {
        name,
        disabled: false,
        focus() { st.active = this; },
        getAttribute() { return null; }
    };
}

/** 造一层：`els` 是该层里的可聚焦元素。 */
function fakeLayer(prefix, count, st) {
    const els = [];
    for (let i = 0; i < count; i += 1) els.push(fakeEl(prefix + i, st));
    return { els, querySelectorAll() { return els; } };
}

function harness(opts) {
    const st = { active: null, contains: (el) => (opts && opts.gone ? false : true) };
    const doc = {
        get activeElement() { return st.active; },
        contains(el) { return st.contains(el); }
    };
    const layers = createFocusLayers({
        doc,
        listFocusable: (r) => (r && r.els) ? r.els : [],
        activeElement: () => st.active,
        now: () => 1,
        fallbackRoot: (opts && opts.fallback) ? opts.fallback : null
    });
    return { st, doc, layers };
}

test('O8-1 选择器是一份声明，且含六类常见可聚焦元素', () => {
    for (const piece of ['a[href]', 'button:not([disabled])', 'input:not([disabled])', 'textarea:not([disabled])', '[tabindex]']) {
        assert.ok(FOCUSABLE_SELECTOR.includes(piece), '缺少 ' + piece);
    }
});

test('O8-2 栈次真源：最后 open 的那层在最上面，depth 与 names 同步', () => {
    const { layers } = harness();
    const a = fakeLayer('a', 2, { active: null });
    const b = fakeLayer('b', 2, { active: null });
    layers.open('app', a);
    layers.open('modal', b);
    assert.equal(layers.depth(), 2);
    assert.deepEqual(layers.names(), ['app', 'modal']);
    assert.equal(layers.top().name, 'modal');
    assert.equal(layers.state().state, 'layered');
});

test('O8-3 开层会把焦点放到该层第一个可聚焦元素；没有可聚焦元素时如实报原因', () => {
    const { layers, st } = harness();
    const a = fakeLayer('a', 2, st);
    const r = layers.open('app', a);
    assert.equal(r.focused, true);
    assert.equal(st.active, a.els[0]);

    const empty = { els: [], querySelectorAll() { return []; } };
    const r2 = layers.open('blank', empty);
    assert.equal(r2.opened, true);
    assert.equal(r2.focused, false);
    assert.equal(r2.reason, 'no-focusable');
});

test('O8-4 Tab 在最上层内循环：末个→第一个，首个 Shift+Tab→末个', () => {
    const { layers, st } = harness();
    const a = fakeLayer('a', 3, st);
    layers.open('app', a);
    st.active = a.els[2];
    const r1 = layers.handleKey({ key: 'Tab' });
    assert.equal(r1.handled, true);
    assert.equal(r1.action, 'cycle');
    assert.equal(r1.to, 0);
    assert.equal(st.active, a.els[0]);

    const r2 = layers.handleKey({ key: 'Tab', shiftKey: true });
    assert.equal(r2.to, 2);
    assert.equal(st.active, a.els[2]);
});

test('O8-5 焦点不在本层时 Tab 回到本层第一个（不留在被遮挡的层）', () => {
    const { layers, st } = harness();
    const a = fakeLayer('a', 2, st);
    layers.open('app', a);
    st.active = fakeEl('outside', st);
    const r = layers.handleKey({ key: 'Tab' });
    assert.equal(r.from, -1);
    assert.equal(r.to, 0);
    assert.equal(st.active, a.els[0]);
});

test('O8-6 Esc 只关一层（连两次才关两层），且 focus 不越权关下面那层', () => {
    const { layers } = harness();
    const a = fakeLayer('a', 1, { active: null });
    const b = fakeLayer('b', 1, { active: null });
    layers.open('app', a);
    layers.open('modal', b);
    const r1 = layers.handleKey({ key: 'Escape' });
    assert.equal(r1.handled, true);
    assert.equal(r1.closed, 'modal');
    assert.equal(layers.depth(), 1);
    assert.equal(layers.top().name, 'app');
    const r2 = layers.handleKey({ key: 'Escape' });
    assert.equal(r2.closed, 'app');
    assert.equal(layers.depth(), 0);
    const r3 = layers.handleKey({ key: 'Escape' });
    assert.equal(r3.handled, false);
    assert.equal(r3.reason, 'no-layer');
});

test('O8-7 关层后焦点还给开层前那一格；那一格已消失则如实 restored:false', () => {
    const ok = harness();
    const opener = fakeEl('opener', ok.st);
    ok.st.active = opener;
    const a = fakeLayer('a', 2, ok.st);
    ok.layers.open('app', a);
    ok.st.active = a.els[0];
    const r = ok.layers.close('app');
    assert.equal(r.restored, true);
    assert.equal(ok.st.active, opener);

    const gone = harness({ gone: true });
    const opener2 = fakeEl('opener2', gone.st);
    gone.st.active = opener2;
    const b = fakeLayer('b', 1, gone.st);
    gone.layers.open('app', b);
    const r2 = gone.layers.close('app');
    assert.equal(r2.restored, false);
    assert.equal(r2.reason, 'opener-gone');
});

test('O8-8 关不存在的层：如实 not-found，不改栈', () => {
    const { layers } = harness();
    layers.open('app', fakeLayer('a', 1, { active: null }));
    const r = layers.close('nope');
    assert.equal(r.closed, false);
    assert.equal(r.reason, 'not-found');
    assert.equal(layers.depth(), 1);
});

test('O8-9 兜底作用域不是一层：depth 不变，Esc 交给调用方', () => {
    const fb = fakeLayer('f', 2, { active: null });
    const { layers, st } = harness({ fallback: () => fb });
    assert.equal(layers.depth(), 0);
    st.active = fb.els[0];
    const tab = layers.handleKey({ key: 'Tab' });
    assert.equal(tab.handled, true, 'Tab 在兜底作用域里也要成环');
    assert.equal(layers.depth(), 0, '兜底作用域不许把 depth 变成 1');
    const esc = layers.handleKey({ key: 'Escape' });
    assert.equal(esc.handled, false);
    assert.equal(esc.reason, 'fallback-scope');
});

test('O8-10 没有 document ⇒ unreadable（不是「栈是空的」）', () => {
    const layers = createFocusLayers({ doc: null });
    const s = layers.state();
    assert.equal(s.state, 'unreadable');
    assert.equal(s.reason, 'no-document');
    assert.notEqual(s.state, 'none');
});

test('O8-11 非焦点键不处理（Tab/Esc 之外一律交给别人）', () => {
    const { layers } = harness();
    layers.open('app', fakeLayer('a', 2, { active: null }));
    const r = layers.handleKey({ key: 'a' });
    assert.equal(r.handled, false);
    assert.equal(r.reason, 'not-a-focus-key');
});

test('O8-12 装配点自检：index.js 建栈 + 挂 keydown；图片预览入栈/出栈', () => {
    const index = read('index.js');
    assert.ok(index.includes('createFocusLayers'), 'index.js 必须真建焦点栈');
    assert.ok(index.includes('focusLayers.handleKey'), 'Tab/Esc 必须真走栈');
    assert.ok(/addEventListener\('keydown'/.test(index), '必须真挂 keydown');
    assert.ok(index.includes('phoneShell._focusLayers'), '外壳要拿到同一个栈（否则浮层无从入栈）');
    const shell = read('phone/phone-shell.js');
    assert.ok(shell.includes("this._focusLayers?.open?.('image-viewer'"), '图片预览必须入栈');
    assert.ok(shell.includes("this._focusLayers?.close?.('image-viewer'"), '图片预览必须出栈');
});