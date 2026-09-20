/* ========================================================
 * system-v250.test.mjs — [v2.50.0] 地点/钱袋/档案/剧情线 四新 App 的 promptBlock 接入微信链路
 *   （v2.49 只补了 dt+cheat；v2.50 把表驱动注入扩展到四个 v2.46-v2.49 新 App，
 *     否则它们在微信聊天里和撩语当年一样是「孤岛 App」）
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('v250 A: 微信注入表驱动补齐 place/wallet/profile/plotline', () => {
    const cv = read('apps/wechat/chat-view.js');
    for (const [inst, label] of [
        ['placeApp', '地点'],
        ['walletApp', '钱袋'],
        ['profileApp', '档案'],
        ['plotlineApp', '剧情线'],
    ]) {
        assert.match(cv, new RegExp(`app: _vp\\.${inst}, name: 'SYSTEM \\(\\${label}\\)'`), `A ${inst}(${label}) 在注入表`);
    }
    const tableCnt = (cv.match(/app: _vp\.[a-zA-Z]+App, name: 'SYSTEM \(/g) || []).length;
    assert.ok(tableCnt >= 6, `A 注入表至少 6 项（实际 ${tableCnt}）`);
    assert.match(cv, /for \(const _item of _injectApps\)\s*\{/, 'A 表驱动 for 循环');
    assert.match(cv, /const _blk = _item\.app\?\.promptBlock\?\.\(\);/, 'A 统一取块');
    assert.match(cv, /if \(_blk\)\s*\{[\s\S]{0,200}?messages\.push\(/, 'A 空块不 push');
    assert.match(cv, /isPhoneMessage: true/, 'A 系统消息标记');
});

test('v250 B: 四新 App 纯函数空内容返回空串（不产生空注入块）', async () => {
    const { scenePromptBlock } = await import('../apps/place/place-data.js');
    const { walletPromptBlock } = await import('../apps/wallet/wallet-data.js');
    const { profilePromptBlock } = await import('../apps/profile/profile-data.js');
    const { plotlinePromptBlock } = await import('../apps/plotline/plotline-data.js');
    for (const [label, fn] of [
        ['scene', scenePromptBlock], ['wallet', walletPromptBlock],
        ['profile', profilePromptBlock], ['plotline', plotlinePromptBlock],
    ]) {
        for (const arg of [null, {}]) {
            let r, threw = false;
            try { r = fn(arg); } catch (_e) { threw = true; }
            assert.ok(!threw, `B ${label}(${JSON.stringify(arg)}) 不抛`);
            assert.equal(r, '', `B ${label}(${JSON.stringify(arg)}) 空内容返回空串`);
        }
    }
});

test('v250 C: 版本同源（四源一致，动态跟随当前版）', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const idx = read('index.js');
    const upd = JSON.parse(read('update-log.json'));
    const v = String(manifest.version);
    assert.equal(pkg.version, v, 'C1 package.json 同源');
    assert.match(idx, new RegExp(`const ST_PHONE_VERSION = '${v.replace(/\./g, '\\.')}';`), 'C2 入口常量同源');
    assert.equal(String(upd.latest), v, 'C3 update-log.latest 同源');
    assert.ok(upd.versions[v], 'C4 update-log 有当前版条目');
    assert.ok(Array.isArray(upd.versions[v].items) && upd.versions[v].items.length >= 3, 'C5 当前版 items 非空');
});
