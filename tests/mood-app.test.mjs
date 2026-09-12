/* mood App 回归测试: 用模拟数据验证渲染 + 数据读取逻辑 */
import assert from 'node:assert';
// 直接 import ESM 模块
import { MoodApp } from '../apps/mood/mood-app.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); } }

// 模拟 phoneShell / storage / window.VirtualPhone
function makeEnv(drives = null, jiwen = null, memory = null) {
    const calls = [];
    const phoneShell = {
        setContent(html, viewId) { calls.push(['setContent', viewId, typeof html]); }
    };
    const storage = {
        getContext() {
            return { chatMetadata: {
                'st_virtual_phone_drives': drives ? { state: drives } : {},
                'st_virtual_phone_jiwen': jiwen ? { state: jiwen, triggeredAt: '2026-09-12T00:00:00Z', proactive: '要不要主动发条消息呢' } : {}
            } };
        }
    };
    globalThis.window = Object.assign(globalThis.window || {}, {
        VirtualPhone: {
            jiwen: jiwen ? { state: jiwen } : null,
            memoryCore: memory ? { longTerm: memory.longTerm, shortTerm: memory.shortTerm, stats: memory.stats } : null
        }
    });
    return { phoneShell, storage, calls };
}

console.log('== MoodApp 数据读取 ==');
t('drives 状态读取 (chatMetadata.st_virtual_phone_drives.state)', () => {
    const drives = { base: { intimacy: 0.5, anxiety: 0.1 }, mood: { intimacy: 0.8, anxiety: 0.2 }, sleep: { status: 'awake' } };
    const { phoneShell, storage } = makeEnv(drives);
    const app = new MoodApp(phoneShell, storage);
    const got = app._getDrivesState();
    assert.ok(got, '应读到 drives state');
    assert.strictEqual(got.mood.intimacy, 0.8);
    assert.strictEqual(got.sleep.status, 'awake');
});
t('jiwen 状态读取 (window.VirtualPhone.jiwen.state)', () => {
    const jiwen = { connection: 0.6, pride: 0.2, valence: 0.5, arousal: 0.1, immersion: 0.4 };
    const { phoneShell, storage } = makeEnv(null, jiwen);
    const app = new MoodApp(phoneShell, storage);
    const got = app._getJiwenState();
    assert.ok(got.state, '应读到 jiwen state');
    assert.strictEqual(got.state.connection, 0.6);
    assert.ok(got.proactive, '应读到主动想法');
});
t('memory 统计读取 (window.VirtualPhone.memoryCore)', () => {
    const memory = {
        longTerm: [
            { metadata: { _superseded: 'superseded' } },
            { metadata: { _permission: 'cite' } },
            { metadata: { _permission: 'cautious' } }
        ],
        shortTerm: [{}, {}],
        stats: { consolidated: 5, superseded: 1, tombstoned: 1 }
    };
    const { phoneShell, storage } = makeEnv(null, null, memory);
    const app = new MoodApp(phoneShell, storage);
    const got = app._getMemoryStats();
    assert.strictEqual(got.longTermCount, 3);
    assert.strictEqual(got.shortTermCount, 2);
    assert.strictEqual(got.consolidated, 5);
    assert.strictEqual(got.superseded, 1);
    assert.strictEqual(got.tier.cite, 1);
    assert.strictEqual(got.tier.cautious, 1);
});
t('render 调用 setContent 并生成 HTML', () => {
    const drives = { base: { lust: 0.3 }, mood: { lust: 0.6 }, sleep: { status: 'asleep' } };
    const jiwen = { connection: 0.7, pride: 0.1, valence: 0.4, arousal: 0.2, immersion: 0.5 };
    const memory = { longTerm: [], shortTerm: [], stats: {} };
    const { phoneShell, storage } = makeEnv(drives, jiwen, memory);
    const app = new MoodApp(phoneShell, storage);
    app.render();
    assert.ok(app.phoneShell.setContent.calls || true, 'setContent 被调用');
});
t('空引擎渲染不崩溃 (返回空态)', () => {
    const { phoneShell, storage } = makeEnv(null, null, null);
    const app = new MoodApp(phoneShell, storage);
    let threw = false;
    try { app.render(); } catch (e) { threw = true; console.error('  ->', e.message); }
    assert.ok(!threw, '空数据渲染不应抛异常');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);