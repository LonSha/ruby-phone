import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml,
    resolveDialogHost,
    showPhoneDialog,
    showPhoneAlert,
    showPhoneConfirm,
    showPhonePrompt
} from '../config/phone-dialog.js';

test('U2 phone-dialog: escapeHtml handles specials correctly', () => {
    assert.equal(escapeHtml('<script>alert("xss")&\'</script>'), '&lt;script&gt;alert("xss")&amp;&#39;&lt;/script&gt;');
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

test('U2 phone-dialog: headless fail-closed fallbacks', async () => {
    // In Node.js without DOM:
    const alertRes = await showPhoneAlert('hello');
    assert.equal(alertRes, true);

    const confirmDefault = await showPhoneConfirm('delete?');
    assert.equal(confirmDefault, false, 'Default confirm without DOM must fail-closed (false)');

    const confirmAssume = await showPhoneConfirm('delete?', { assumeConfirm: true });
    assert.equal(confirmAssume, true, 'assumeConfirm:true should resolve true for test stubs');

    const promptDefault = await showPhonePrompt('name:');
    assert.equal(promptDefault, null, 'Default prompt without DOM must fail-closed (null)');

    const promptAssume = await showPhonePrompt('name:', 'default-val', { assumeConfirm: true });
    assert.equal(promptAssume, 'default-val');
});

test('U2 phone-dialog: DOM host mounting and interaction', async () => {
    // Setup minimal DOM mocks
    const elements = new Map();
    const created = [];

    const mockRoot = {
        nodeType: 1,
        style: { position: 'static' },
        querySelector: (sel) => null,
        appendChild: (el) => {
            created.push(el);
            mockRoot.children = mockRoot.children || [];
            mockRoot.children.push(el);
        }
    };

    const mockBody = { nodeType: 1, style: {} };
    globalThis.document = {
        querySelector: (sel) => mockRoot,
        createElement: (tag) => {
            const listeners = {};
            const childList = [];
            const el = {
                tagName: tag.toUpperCase(),
                id: '',
                style: {},
                innerHTML: '',
                dataset: {},
                appendChild: (c) => childList.push(c),
                querySelector: (sel) => {
                    if (sel === '[data-action="confirm"]') {
                        return {
                            addEventListener: (evt, cb) => { listeners['confirm:' + evt] = cb; },
                            click: () => listeners['confirm:click']?.()
                        };
                    }
                    if (sel === '[data-action="cancel"]') {
                        return {
                            addEventListener: (evt, cb) => { listeners['cancel:' + evt] = cb; },
                            click: () => listeners['cancel:click']?.()
                        };
                    }
                    if (sel === '#rp-dialog-prompt-input') {
                        return {
                            value: 'user input',
                            addEventListener: (evt, cb) => { listeners['input:' + evt] = cb; }
                        };
                    }
                    return null;
                },
                addEventListener: (evt, cb) => { listeners[evt] = cb; },
                remove: () => {
                    const idx = created.indexOf(el);
                    if (idx >= 0) created.splice(idx, 1);
                },
                _listeners: listeners
            };
            return el;
        },
        body: mockBody
    };

    globalThis.window = {
        getComputedStyle: () => ({ position: 'static' })
    };

    try {
        // Test confirm accept
        const p1 = showPhoneConfirm({
            title: '测试确认',
            message: '确认删除吗？',
            host: mockRoot
        });
        assert.equal(created.length, 1, 'Dialog overlay should be mounted');
        assert.equal(mockRoot.style.position, 'relative');
        // Simulate click confirm
        created[0].querySelector('[data-action="confirm"]').click();
        const r1 = await p1;
        assert.equal(r1, true);
        assert.equal(created.length, 0, 'Dialog should be removed on confirm');

        // Test confirm cancel
        const p2 = showPhoneConfirm({
            title: '测试取消',
            message: '取消吗？',
            host: mockRoot
        });
        assert.equal(created.length, 1);
        created[0].querySelector('[data-action="cancel"]').click();
        const r2 = await p2;
        assert.equal(r2, false);
        assert.equal(created.length, 0);

        // Test prompt accept
        const p3 = showPhonePrompt('输入名字', '默认名', { host: mockRoot });
        assert.equal(created.length, 1);
        created[0].querySelector('[data-action="confirm"]').click();
        const r3 = await p3;
        assert.equal(r3, 'user input');
        assert.equal(created.length, 0);
    } finally {
        delete globalThis.document;
        delete globalThis.window;
    }
});
