/* ========================================================
 * system-v251.test.mjs — [v2.51.0] 群像（chars）App：消费记忆插件角色状态表
 *   （v2.49 三 App 消费了 protagonist/lifeDetails/moneyLedger/outline/worldProg，
 *     但 snapshot.characters 角色状态表仍全库零消费——本版补齐，与「档案」主角单档案互补）
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('v251 A: 群像（chars）四件套与注册', () => {
    for (const f of ['chars-data.js', 'chars-app.js', 'chars-view.js', 'chars.css']) {
        assert.ok(read(`apps/chars/${f}`).length > 200, `A1 四件套 ${f} 存在`);
    }
    const data = read('apps/chars/chars-data.js');
    assert.match(data, /export function readCharsFace\(/, 'A2 归因内核');
    assert.match(data, /export function projectChars\(/, 'A3 投影内核');
    assert.match(data, /export function charsPromptBlock\(/, 'A4 注入块内核');
    const app = read('apps/chars/chars-app.js');
    assert.match(app, /export class CharsApp/, 'A5 控制器');
    assert.match(app, /GENERATE_BEFORE_COMBINE_PROMPTS/, 'A6 主钩子（正确事件名）');
    assert.match(app, /lonsha_memory_bridge_v1/, 'A7 桥名一致');
    assert.match(app, /chars_settings_v1/, 'A8 设置键');
    const apps = read('config/apps.js');
    assert.match(apps, /id: 'chars'/, 'A9 桌面注册');
    assert.match(apps, /name: '群像'/, 'A10 中文名');
    const storage = read('config/storage.js');
    assert.match(storage, /\/\^chars_\//, 'A11 storage 白名单');
});

test('v251 B: 群像内核纯函数（五态归因 + 投影排序 + 注入块）', async () => {
    const { readCharsFace, projectChars, charsPromptBlock } = await import('../apps/chars/chars-data.js');
    // 五态归因逐态实测
    for (const [exp, probe] of [
        ['bridge-absent', { mounted: false }],
        ['no-snapshot', { mounted: true, hasSnapshot: false }],
        ['no-chars-face', { mounted: true, hasSnapshot: true, snapshot: { money: {} } }],
        ['empty', { mounted: true, hasSnapshot: true, snapshot: { characters: {} } }],
        ['ready', { mounted: true, hasSnapshot: true, snapshot: { characters: { A: { fields: {} } } } }],
    ]) {
        assert.equal(readCharsFace(probe).reason, exp, `B1 ${exp}`);
    }
    // 畸形不抛
    assert.doesNotThrow(() => readCharsFace(null));
    assert.doesNotThrow(() => projectChars(null));
    // 投影排序：有内容的角色优先（活动度降序）
    const chars = {
        '空角色': { fields: {}, todos: [] },
        '活跃角色': { fields: { '好感': 80, '重要': true }, todos: [{ text: '还书', date: '3月' }], floor: 12 },
        '中等角色': { fields: { '情绪': '紧张' }, floor: 5 }
    };
    const proj = projectChars(chars);
    assert.equal(proj.count, 3, 'B2 角色计数');
    assert.deepEqual(proj.roles.map((r) => r.name), ['活跃角色', '中等角色', '空角色'], 'B3 活动度排序');
    const active = proj.roles[0];
    assert.equal(active.fields.length, 2, 'B4 字段拍平');
    assert.equal(active.todos.length, 1, 'B5 待办拍平');
    assert.equal(active.floor, 12, 'B6 楼层如实');
    // 注入块：空内容返回空串（不产生空块）
    for (const arg of [null, {}, []]) {
        assert.equal(charsPromptBlock(arg), '', 'B7 空内容返回空串');
    }
    const blk = charsPromptBlock(chars, { maxRoles: 5 });
    assert.ok(blk.includes('活跃角色'), 'B8 注入块含高活动角色');
    assert.ok(blk.includes('好感:80'), 'B9 注入块含字段值');
});

test('v251 C: 微信注入表补齐群像 + 三处 onChatChanged 接线', () => {
    const cv = read('apps/wechat/chat-view.js');
    assert.match(cv, /app: _vp\.charsApp, name: 'SYSTEM \(群像\)'/, 'C1 群像在微信注入表');
    const idx = read('index.js');
    assert.match(idx, /appId === 'chars'/, 'C2 懒加载路由');
    assert.match(idx, /new module\.CharsApp\(phoneShell, storage\)/, 'C3 单例构造');
    const cnt = (idx.match(/window\.VirtualPhone\.charsApp\?\.onChatChanged\?\.?\(\)/g) || []).length;
    assert.equal(cnt, 3, `C4 三处 onChatChanged 接线（实际 ${cnt}）`);
    for (const key of ['clearCurrentData', 'clearAllData']) {
        assert.ok(new RegExp(`${key}[\\s\\S]{0,4000}charsApp\\?\\.onChatChanged\\?\\.\\(\\)`).test(idx), `C5 ${key} 窗口内可达`);
    }
});

test('v251 D: 版本同源', () => {
    const v = String(JSON.parse(read('manifest.json')).version);
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const idx = read('index.js');
    const upd = JSON.parse(read('update-log.json'));
    assert.equal(pkg.version, v, 'D1');
    assert.equal(manifest.version, v, 'D2');
    assert.match(idx, new RegExp(`const ST_PHONE_VERSION = '${v.replace(/\\./g, '\\\\.')}';`), 'D3');
    assert.equal(upd.latest, v, 'D4');
    assert.ok(upd.versions[v], 'D5');
    assert.ok(Array.isArray(upd.versions[v].items) && upd.versions[v].items.length >= 3, 'D6');
});