/**
 * r25_x7_keyboard_map.test.mjs — R25-X7 外接键盘与快捷键
 *
 * 【咬点】
 *   1. 默认键位只声明一次（闭集派生），设置页/测试读同一份；
 *   2. 归一化只有一个实现：`Ctrl+K` / `k+ctrl` 这类写法必须归一到同一键串；
 *   3. 「发送」不许被改成不带修饰键的裸键（否则一碰就发）；
 *   4. 冲突键位**谁都不触发**并留痕（不按对象顺序挑一个）；
 *   5. 读不到存储 ≠ 用默认：`unreadable` 与 `absent` 文案必须不同形；
 *   6. 装配点自检：index.js 真接线、设置页真能改、键位真落在一个已登记的键上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SHORTCUT_ACTIONS, SHORTCUT_STORAGE_KEY, BINDING_STATES,
    comboOf, acceptsCombo, defaultBindings, readKeyBindings, matchShortcut,
    shortcutRows, humanCombo, shortcutText
} from '../config/keyboard-map.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function fakeStorage(value, opts) {
    return {
        get: (k) => {
            if (opts && opts.throwing) throw new Error('boom');
            return k === SHORTCUT_STORAGE_KEY ? value : undefined;
        }
    };
}

test('X7-1 五个动作是闭集，且默认键位不重复', () => {
    assert.deepEqual(SHORTCUT_ACTIONS.map((a) => a.id), ['back', 'home', 'search', 'send', 'switch-app']);
    const defs = SHORTCUT_ACTIONS.map((a) => a.def);
    assert.equal(new Set(defs).size, defs.length, '默认键位内部不得重复');
    for (const a of SHORTCUT_ACTIONS) assert.ok(a.label.length >= 2, a.id + ' 必须有人话');
});

test('X7-2 归一化只有一份：同一物理键的不同写法归一成同一键串', () => {
    assert.equal(comboOf({ key: 'k', code: 'KeyK', ctrlKey: true }), 'ctrl+k');
    assert.equal(comboOf({ key: 'K', code: 'KeyK', ctrlKey: true }), 'ctrl+k', '按住 Shift 造成的大写不得改变键串');
    assert.equal(comboOf({ key: 'Escape', code: 'Escape' }), 'escape');
    assert.equal(comboOf({ key: '3', code: 'Digit3', altKey: true }), 'alt+3');
    assert.equal(comboOf({ key: 'Enter', code: 'Enter', ctrlKey: true }), 'ctrl+enter');
    assert.equal(comboOf({}), '', '没有键信息时给空串（不许编一个）');
});

test('X7-3 默认键位表从闭集派生（不另写一份常量）', () => {
    const d = defaultBindings();
    for (const a of SHORTCUT_ACTIONS) assert.equal(d[a.id], a.def);
    assert.equal(Object.keys(d).length, SHORTCUT_ACTIONS.length);
});

test("X7-4 「发送」不许改成裸键；Esc 只给「返回」", () => {
    assert.equal(acceptsCombo('send', 'a'), false, '裸键会让一碰就发');
    assert.equal(acceptsCombo('send', 'ctrl+enter'), true);
    assert.equal(acceptsCombo('back', 'escape'), true, 'Esc 是系统级返回语义，允许不带修饰键');
    assert.equal(acceptsCombo('search', 'escape'), false, '别的动作不许占用裸 Esc');
    assert.equal(acceptsCombo('switch-app', 'alt+digit'), true);
    assert.equal(acceptsCombo('home', 'ctrl'), false, '只有修饰键、没有主体键不算合规');
});

test('X7-5 匹配：默认键位与改后的键位都命中，且回报切 App 的槽位', () => {
    const d = defaultBindings();
    assert.equal(matchShortcut('ctrl+k', d).action, 'search');
    assert.equal(matchShortcut('ctrl+enter', d).action, 'send');
    assert.equal(matchShortcut('escape', d).action, 'back');
    const sw = matchShortcut('alt+3', d);
    assert.equal(sw.action, 'switch-app');
    assert.equal(sw.slot, 3);
    assert.equal(matchShortcut('ctrl+q', d), null, '没有登记的键串不许命中任何动作');
});

test('X7-6 冲突：两个动作占同一键串时谁都不触发，并如实报冲突', () => {
    const bindings = { ...defaultBindings(), search: 'ctrl+j', send: 'ctrl+j' };
    /* 走一遍读取归一，确认冲突在读取期就被拦下并回退默认。 */
    const r = readKeyBindings(fakeStorage(JSON.stringify({ search: 'ctrl+j', send: 'ctrl+j' })));
    assert.equal(r.state, BINDING_STATES.invalid);
    assert.ok(r.rejected.includes('send') || r.rejected.includes('search'));
    assert.notEqual(r.bindings.search, r.bindings.send, '冲突不许留在生效表里');
    /* 直接对匹配器喂一张冲突表：必须报 conflict 而不是挑一个。 */
    const m = matchShortcut('ctrl+j', bindings);
    assert.equal(m.action, null);
    assert.deepEqual(m.conflict.sort(), ['search', 'send']);
});

test('X7-7 读不到存储 → unreadable，文案与 absent 不同形', () => {
    const bad = readKeyBindings(null);
    assert.equal(bad.state, BINDING_STATES.unreadable);
    const textBad = shortcutText(bad);
    const absent = readKeyBindings(fakeStorage(undefined));
    assert.equal(absent.state, BINDING_STATES.absent);
    const textAbsent = shortcutText(absent);
    assert.notEqual(textBad, textAbsent);
    assert.ok(textBad.includes('读不到'), '读不到必须明说');
    assert.ok(!textAbsent.includes('读不到'), '从没设置过不该说读不到');
});

test('X7-8 get 抛错 → unreadable（不得冒充默认可用）', () => {
    const r = readKeyBindings(fakeStorage(null, { throwing: true }));
    assert.equal(r.state, BINDING_STATES.unreadable);
    assert.equal(r.reason, 'read-threw');
});

test('X7-9 非法键位被逐条点名并回退默认；合法键位保留', () => {
    const r = readKeyBindings(fakeStorage(JSON.stringify({ search: 'k', back: 'ctrl+escape' })));
    assert.equal(r.state, BINDING_STATES.invalid);
    assert.deepEqual(r.rejected, ['search']);
    assert.equal(r.bindings.search, 'ctrl+k', '被拒的键位要回退默认');
    assert.equal(r.bindings.back, 'ctrl+escape', '合法键位必须保留');
});

test('X7-10 字符串化 JSON 可读；坏 JSON 报 invalid 并点名 *', () => {
    const ok = readKeyBindings(fakeStorage(JSON.stringify({ home: 'ctrl+alt+h' })));
    assert.equal(ok.state, BINDING_STATES.stored);
    assert.equal(ok.bindings.home, 'ctrl+alt+h');
    const bad = readKeyBindings(fakeStorage('{oops'));
    assert.equal(bad.state, BINDING_STATES.invalid);
    assert.deepEqual(bad.rejected, ['*']);
});

test('X7-11 行表与人话：默认项标 isDefault，改过的项不标', () => {
    const r = readKeyBindings(fakeStorage(JSON.stringify({ search: 'ctrl+f' })));
    const rows = shortcutRows(r.bindings);
    const search = rows.find((x) => x.id === 'search');
    assert.equal(search.combo, 'ctrl+f');
    assert.equal(search.isDefault, false);
    assert.equal(search.human, 'Ctrl + F');
    assert.equal(rows.find((x) => x.id === 'back').human, 'Esc');
    assert.equal(rows.find((x) => x.id === 'switch-app').human, 'Alt + 1~9');
    assert.equal(humanCombo(''), '（未设置）');
});

test('X7-12 装配点自检：index.js 真接线；设置页真能改；键位已登记归属', () => {
    const index = read('index.js');
    assert.ok(index.includes('readKeyBindings'), '启动时必须读键位真源');
    assert.ok(index.includes('matchShortcut'), 'keydown 必须走同一匹配器');
    assert.ok(index.includes('_keyboard'), '读数要挂到 VirtualPhone 供诊断/排查');
    const settings = read('apps/settings/settings-app.js');
    assert.ok(settings.includes('renderShortcutSection'), '设置页必须能看');
    assert.ok(settings.includes('data-shortcut-capture'), '设置页必须能改');
    assert.ok(settings.includes('data-shortcut-reset'), '设置页必须有恢复默认');
    assert.ok(settings.includes('keyboard-map.js'), '设置页必须走同一内核');
    const keys = read('scripts/keys-audit.mjs');
    assert.ok(keys.includes("'sys_keyboard_shortcuts'"), '新存储键必须登记归属（否则换会话串味）');
});