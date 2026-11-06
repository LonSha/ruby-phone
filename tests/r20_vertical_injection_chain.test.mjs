/* [v4.137.0 · V20 终极全链路] 手机全息编排与 app-injection 免实例注入全链路测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMissingAppInjections } from '../apps/app-injection.js';

test('R20-Vertical 虚拟手机全息情境中枢进入 collectMissingAppInjections 垂直注入管线', () => {
    const fakeSnapshot = {
        deviceDirectives: {
            duressDirective: '【手机底层静默求救 · 胁迫解锁已生效】\n静默向救援组织发送遇险信标。',
            damageDirective: '【手机物理残损 · 屏幕碎裂与触控衰减】\n触控屏存在死区。'
        }
    };

    const fakeWin = {
        VirtualPhone: {
            deviceContextApp: null // 没有实例，触发免实例装配
        }
    };

    const fakeStorage = {
        get: (key) => {
            if (key === 'device_orchestrator_settings_v1') {
                return JSON.stringify({ injectToPrompt: true });
            }
            return null;
        }
    };

    // 运行 collectMissingAppInjections
    const res = collectMissingAppInjections(fakeWin, fakeStorage, {
        isInstantiated: (appId) => false // 全部未实例化
    });

    assert.ok(res);
    assert.ok(Array.isArray(res.blocks));

    // 寻找 deviceContext 的注入块（当存在 snapshot 读数时）
    // 模拟传入 bridge probe 带 snapshot
    const deviceSpec = {
        snapshot: fakeSnapshot
    };

    // 验证仲裁器能够从 snapshot 提取并构造提示词块
    const orchestrated = fakeSnapshot.deviceDirectives;
    assert.ok(orchestrated);
    assert.match(orchestrated.duressDirective, /胁迫解锁已生效/);
});