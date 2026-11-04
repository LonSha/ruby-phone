// tests/phone-components.test.mjs — U3 现代基础 UI 组件与无障碍契约单测
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIconButton, createCard, createListItem, createTabs } from '../config/phone-components.js';

test('U3 components: createIconButton requires label for accessibility', () => {
    assert.throws(() => createIconButton({}), /要求非空 label/);
    assert.throws(() => createIconButton({ label: '' }), /要求非空 label/);
    assert.throws(() => createIconButton({ label: '   ' }), /要求非空 label/);

    const fallback = createIconButton({ label: '设置', icon: 'fa fa-cog' });
    assert.equal(fallback.label, '设置');
    assert.equal(fallback.icon, 'fa fa-cog');
});

test('U3 components: createIconButton in DOM environment guarantees 44px min touch target', () => {
    const el = {
        style: {},
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        addEventListener() {}
    };

    const prevDoc = globalThis.document;
    globalThis.document = {
        createElement(tag) {
            return {
                tagName: tag,
                style: {},
                attrs: {},
                setAttribute(k, v) { this.attrs[k] = v; },
                getAttribute(k) { return this.attrs[k]; },
                appendChild(c) { (this.children = this.children || []).push(c); },
                addEventListener() {}
            };
        }
    };

    try {
        const btn = createIconButton({ label: '返回上一页', icon: '✕' });
        assert.equal(btn.attrs['aria-label'], '返回上一页');
        assert.equal(btn.attrs['title'], '返回上一页');
        assert.equal(btn.style.minWidth, '44px');
        assert.equal(btn.style.minHeight, '44px');
    } finally {
        globalThis.document = prevDoc;
    }
});

test('U3 components: createTabs WAI-ARIA roles and navigation structure', () => {
    const prevDoc = globalThis.document;
    globalThis.document = {
        createElement(tag) {
            return {
                tagName: tag,
                style: {},
                attrs: {},
                setAttribute(k, v) { this.attrs[k] = v; },
                getAttribute(k) { return this.attrs[k]; },
                appendChild(c) { (this.children = this.children || []).push(c); },
                addEventListener() {}
            };
        }
    };

    try {
        const tabs = createTabs({
            tabs: [
                { id: 'tab1', label: '基础设置', panel: '<div>基础</div>' },
                { id: 'tab2', label: '高级设置', panel: '<div>高级</div>' }
            ],
            initialTab: 'tab1'
        });

        const tablist = tabs.children[0];
        assert.equal(tablist.attrs['role'], 'tablist');
        assert.equal(tablist.children.length, 2);

        const tab0 = tablist.children[0];
        assert.equal(tab0.attrs['role'], 'tab');
        assert.equal(tab0.attrs['aria-selected'], 'true');
        assert.equal(tab0.tabIndex, 0);

        const tab1 = tablist.children[1];
        assert.equal(tab1.attrs['role'], 'tab');
        assert.equal(tab1.attrs['aria-selected'], 'false');
        assert.equal(tab1.tabIndex, -1);
    } finally {
        globalThis.document = prevDoc;
    }
});
