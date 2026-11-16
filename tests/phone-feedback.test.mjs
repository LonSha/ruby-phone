import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    feedbackSelfCheck,
    phoneNotice,
    phoneConfirm,
    phonePrompt,
    phoneConfirmAsync,
    phonePromptAsync,
} from '../config/phone-feedback.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function productJsFiles() {
    const out = [];
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name === 'node_modules' || ent.name === '.git' || ent.name.includes('.bak')) continue;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(abs);
            else if (ent.isFile() && abs.endsWith('.js')) out.push(abs);
        }
    };
    for (const dir of ['apps', 'config', 'phone']) walk(path.join(ROOT, dir));
    out.push(path.join(ROOT, 'index.js'));
    return out;
}

test('页内反馈出口暴露提示、确认、输入和异步变体', () => {
    const read = feedbackSelfCheck();
    assert.equal(read.ok, true);
    assert.equal(typeof phoneNotice, 'function');
    assert.equal(typeof phoneConfirm, 'function');
    assert.equal(typeof phonePrompt, 'function');
    assert.equal(typeof phoneConfirmAsync, 'function');
    assert.equal(typeof phonePromptAsync, 'function');
});

test('无手机 DOM 时提示不抛、确认和输入 fail-closed', () => {
    const oldWindow = globalThis.window;
    try {
        delete globalThis.window;
        assert.equal(phoneNotice('headless').ok, false);
        assert.equal(phoneConfirm('must not pass'), false);
        assert.equal(phonePrompt('must not pass', 'x'), null);
    } finally {
        if (oldWindow === undefined) delete globalThis.window;
        else globalThis.window = oldWindow;
    }
});

test('产品调用点不再直接触碰原生反馈 API', () => {
    // 只拦截宿主对象上的原生 API；业务对象可以合法拥有 confirm()/prompt() 方法。
    const forbidden = /(?:\b(?:window|globalThis)\??\.\s*|\b[A-Za-z_$][A-Za-z0-9_$]*\.ownerDocument\.defaultView\??\.\s*)(?:alert|confirm|prompt)\s*\(/;
    const violations = [];
    for (const file of productJsFiles()) {
        if (file.endsWith(path.join('config', 'phone-feedback.js'))) continue;
        const src = fs.readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        if (forbidden.test(src)) violations.push(path.relative(ROOT, file));
    }
    assert.deepEqual(violations, [], '仍有直接原生反馈调用：' + violations.join(', '));
});

test('统一兼容层是唯一原生反馈调用面', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config/phone-feedback.js'), 'utf8');
    assert.equal((src.match(/win\?\.(confirm|prompt)/g) || []).length, 2);
    assert.match(src, /role', options\.role \|\| 'status'/);
    assert.match(src, /setAttribute\('role', 'dialog'\)/);
    assert.match(src, /setAttribute\('aria-modal', 'true'\)/);
});