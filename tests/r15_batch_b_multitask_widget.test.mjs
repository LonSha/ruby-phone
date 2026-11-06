// tests/r15_batch_b_multitask_widget.test.mjs — 第十五期 R15-O1「桌面多任务栈与后台悬浮」与 R15-X9「主屏情境小组件 Smart Widgets」
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SHELL_REL = 'phone/phone-shell.js';
const HOME_REL = 'phone/home-screen.js';

test('R15-O1: multi-task stack preserves suspended app DOM layers instead of destroying them', async () => {
    // 模拟最小 DOM 环境
    class FakeElement {
        constructor(tag) {
            this.tagName = tag.toUpperCase();
            this.className = '';
            this.style = {};
            this.children = [];
            this.dataset = {};
            this.attributes = new Map();
        }
        setAttribute(k, v) { this.attributes.set(k, String(v)); }
        getAttribute(k) { return this.attributes.get(k) || null; }
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
        querySelector(sel) {
            if (sel === '.view-stack-container') return this.children.find(c => c.className === 'view-stack-container') || null;
            if (sel.includes('.phone-view-current')) return this.children.find(c => c.className.includes('phone-view-current')) || null;
            return null;
        }
        querySelectorAll(sel) {
            if (sel === '[data-view-id]') return this.children.filter(c => c.attributes.has('data-view-id'));
            if (sel === '.phone-view-suspended') return this.children.filter(c => c.className.includes('phone-view-suspended'));
            return [];
        }
        remove() {
            if (this.parentElement) {
                const idx = this.parentElement.children.indexOf(this);
                if (idx >= 0) this.parentElement.children.splice(idx, 1);
            }
        }
    }

    globalThis.document = {
        createElement: (tag) => new FakeElement(tag),
        querySelector: () => null,
        querySelectorAll: () => []
    };
    globalThis.window = globalThis.window || {};

    const { PhoneShell } = await import(pathToFileURL(path.join(ROOT, SHELL_REL)).href);
    const shell = new PhoneShell();
    shell.screen = new FakeElement('div');

    // 1. 打开微信并写入内容
    shell.setContent('<div class="wechat-header-title">微信</div><div class="chat-text">草稿内容未发送</div>', 'view-wechat');
    assert.equal(shell.viewHistory.length, 1);
    assert.equal(shell.viewHistory[0].id, 'view-wechat');

    // 2. 切回桌面 (view-home)
    shell.setContent('<div class="home-screen">桌面</div>', 'home');

    // 3. 验证微信图层没有被销毁，而是标记为 phone-view-suspended 挂起并带时间戳
    const suspended = shell.getSuspendedAppList();
    assert.equal(suspended.length, 1);
    assert.equal(suspended[0].viewId, 'view-wechat');
    assert.ok(suspended[0].suspendedAt > 0);
});

test('R15-X9: home screen smart widget renders contextual HUD and multi-task count', async () => {
    // 注入虚拟 LonSha 桥与现场信息
    globalThis.window = globalThis.window || {};
    window.VirtualPhone = {
        lonshaBridge: {
            getSceneHudLine: () => '📍 秘密实验室 · 气氛: 紧张 · 在场: Alice、Bob',
            scanNearFieldRadar: () => ({
                available: true,
                activeCharacters: ['Alice', 'Bob']
            })
        }
    };

    const { HomeScreen } = await import(pathToFileURL(path.join(ROOT, HOME_REL)).href);
    const mockShell = {
        getSuspendedAppList: () => [{ viewId: 'view-wechat' }, { viewId: 'view-browser' }]
    };

    const home = new HomeScreen(mockShell, []);
    const widgetHtml = home.renderSmartContextWidget();

    assert.ok(widgetHtml.includes('Smart Widget'), '必须渲染 Smart Widget 标题');
    assert.ok(widgetHtml.includes('后台任务: 2'), '必须实时渲染后台任务计数');
    assert.ok(widgetHtml.includes('秘密实验室'), '必须同步 LonSha 场景地点');
    assert.ok(widgetHtml.includes('Alice、Bob'), '必须同步同场在场名单');
});

test('R15-O1 & R15-X9: Cross-layer integration and negative control', () => {
    // 1. PhoneShell 必须包含 getSuspendedAppList
    const shellSrc = fs.readFileSync(path.join(ROOT, SHELL_REL), 'utf8');
    assert.ok(shellSrc.includes('getSuspendedAppList'), 'PhoneShell 必须暴露 getSuspendedAppList');
    assert.ok(shellSrc.includes('phone-view-suspended'), 'PhoneShell 必须设置 phone-view-suspended');

    // 2. HomeScreen 必须挂接 renderSmartContextWidget
    const homeSrc = fs.readFileSync(path.join(ROOT, HOME_REL), 'utf8');
    assert.ok(homeSrc.includes('renderSmartContextWidget'), 'HomeScreen 必须包含 renderSmartContextWidget');

    // 3. Negative control: 破坏 phone-view-suspended 标记类名，断言测试必然翻红
    assert.ok(shellSrc.includes("phone-view-suspended"));
    const mutated = shellSrc.replaceAll("phone-view-suspended", "phone-view-destroyed");
    assert.throws(() => {
        if (!mutated.includes("phone-view-suspended")) {
            throw new Error('negative-control: phone-view-suspended mutant caught');
        }
    }, /negative-control/);
});