/* [v4.137.0 · V20 手机端批次6] 沙盒绝密文件分级加密与泄露溯源测试 */
import test from 'node:test';
import assert from 'node:assert/strict';

import VaultLib from '../apps/security/sandbox-file-encryption-leak-tracer.js';

test('R20-O9 沙盒绝密文件分级加密、未授权外发追踪与泄露警报', () => {
    const state = VaultLib.createInitialFileSecurityState();

    // 录入绝密档案
    VaultLib.registerSecureFile(state, {
        fileId: 'doc_omega_plan',
        name: '代号：红汞计划执行名单.pdf',
        classification: 'TOP_SECRET',
        isEncrypted: true
    });

    assert.equal(state.vaultFiles['doc_omega_plan'].leakIndex, 0.0);

    // 记录未授权截图外发
    const file = VaultLib.recordUnauthorizedAccess(state, 'doc_omega_plan', {
        actor: '内鬼黑客',
        action: 'EXTERNAL_BLUETOOTH_LEAK'
    });

    assert.ok(file);
    assert.equal(file.leakIndex, 0.45);
    assert.equal(file.accessLog.length, 1);

    // 生成泄露警报提示词
    const directives = VaultLib.generateSecurityLeakDirectives(state);
    assert.match(directives, /【手机绝密档案泄露溯源警报】/);
    assert.match(directives, /代号：红汞计划执行名单\.pdf/);
    assert.match(directives, /泄露指数达到 45%/);
});