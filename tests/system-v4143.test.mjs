/* ============================================================
 * tests/system-v4143.test.mjs — [v4.143.0 · R21-O1 真·窗口化消息流]
 * ------------------------------------------------------------
 * 计划原文（R21-O1）：「按 startIndex/endIndex 只物化可见区间 + 上下各 1 屏缓冲；
 *   与 tailWindowOf 共存：tailWindowOf 管取多少条数据，本模块管物化多少节点；
 *   两个上界各管一层，不许合并成一个常量。」
 *
 * 判据面（五组）：
 *   A 口径：normalizeStreamMode 只认 windowed，未知值回落 full；纯函数零副作用。
 *   B 行为：computeWindowedRange 按像素缓冲切区间、maxNodes 封顶、windowItems 保留全局下标；
 *           ChatView.renderWindowedMessageStream 产出的 HTML 带上下占位、索引 offset = base + start。
 *   C 负控制：真源码定点破坏 ⇒ 同款判据必红（配原版必真的反向对照）。
 *   D 接线：chat-view 两处刷新路径都走窗口化；设置页有开关；键已登记；样式在位。
 *   E 版本锚：下限形（≥ 4.143.0，四源同源）。
 *
 * 为什么负控制要改**真源码副本**而不是只调参数：只调参数证明的是「函数尊重参数」，
 *   证明不了「产品路径真的用了封顶/缓冲」。故 C 组把副本里的封顶与缓冲破坏掉，再跑同一组断言。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readRel(rel));
globalThis.window = globalThis;
const MOD_REL = 'apps/wechat/chat-view-windowed-stream.js';
const VIEW_REL = 'apps/wechat/chat-view.js';
const SETTINGS_REL = 'apps/settings/settings-app.js';
const M = await import(pathToFileURL(path.join(ROOT, MOD_REL)).href);
const { computeWindowedRange, windowItems, normalizeStreamMode, WINDOWED_STREAM_MODE, WINDOWED_STREAM_LIMIT } = M;
const { ChatView } = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const span = (r) => r.endIndex - r.startIndex;
const mkMsgs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, content: '第 ' + i + ' 楼', type: 'text' }));
let SEQ = 0;
const TEMP_DIRS = [];
test.after(() => {
    for (const d of TEMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
async function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rubyphone-v4143-'));
    TEMP_DIRS.push(dir);
    const mod = await import(pathToFileURL(path.join(ROOT, 'tests', '_mirror_tree.mjs')).href + '?v=v4143-' + (SEQ += 1));
    await mod.copyTreeSafe(path.join(ROOT, 'apps', 'wechat'), path.join(dir, 'apps', 'wechat'));
    await mod.copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
async function damage(rel, from, to) {
    const src = readRel(rel);
    assert.equal(src.split(from).length - 1, 1, '破坏锚点必须恰中一次：' + rel);
    const dir = await stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

/* ═══════════════════════════ A · 口径 ═══════════════════════════ */
test('A1 normalizeStreamMode 只认 windowed，未知值一律回落 full', () => {
    assert.equal(normalizeStreamMode('windowed'), WINDOWED_STREAM_MODE.WINDOWED);
    for (const v of ['full', '', null, undefined, 'WINDOWED', 'window', 0, 1, {}, []]) {
        assert.equal(normalizeStreamMode(v), WINDOWED_STREAM_MODE.FULL, '未知值 ' + String(v) + ' 必须回落 full');
    }
});
test('A2 常量分离：节点上界是 40，且与 tailWindowOf 的 200 条数据窗口不是同一个数', () => {
    assert.equal(WINDOWED_STREAM_LIMIT, 40);
    const listWindow = readRel('config/list-window.js');
    assert.match(listWindow, /export function tailWindowOf/, 'tailWindowOf 必须仍在（两层共存）');
    assert.notEqual(String(WINDOWED_STREAM_LIMIT), '200', '节点上界不得复用数据窗口的 200');
});
test('A3 纯函数零副作用：同一输入连算两次逐字相等', () => {
    const a = computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 1 });
    const b = computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 1 });
    assert.deepEqual(a, b);
});

/* ═══════════════════════════ B · 行为 ═══════════════════════════ */
test('B1 maxNodes 是硬上界：1000/3000 条、任意滚动位都不超过 40', () => {
    for (const total of [1000, 3000]) {
        for (const top of [0, 500, 5000, total * 68 - 640, total * 68]) {
            const r = computeWindowedRange(total, top, 640, { maxNodes: 40, overscan: 1 });
            assert.ok(span(r) > 0, '窗口不得为空（空 = 白屏）');
            assert.ok(span(r) <= 40, 'total=' + total + ' top=' + top + ' span=' + span(r) + ' 超过上界');
            assert.equal(r.startIndex >= 0 && r.endIndex <= total, true);
        }
    }
});
test('B2 滚动位影响区间：顶部/中部/底部切出不同的窗口（不是恒同一段）', () => {
    const top = computeWindowedRange(1000, 0, 640, { maxNodes: 40, overscan: 1 });
    const mid = computeWindowedRange(1000, 34000, 640, { maxNodes: 40, overscan: 1 });
    const bottom = computeWindowedRange(1000, 1000 * 68, 640, { maxNodes: 40, overscan: 1 });
    assert.equal(top.startIndex, 0);
    assert.ok(mid.startIndex > top.startIndex, '中部窗口起点必须晚于顶部');
    assert.equal(bottom.endIndex, 1000, '底部窗口必须到末尾');
});
test('B3 占位高度 = 区间外消息的高度和：topSpacer + 区间高度 + bottomSpacer = totalHeight', () => {
    const heights = Array.from({ length: 1000 }, (_, i) => 40 + (i % 5) * 20);
    const r = computeWindowedRange(1000, 20000, 640, { maxNodes: 40, overscan: 1, heights, avgRowHeight: 60 });
    let inside = 0;
    for (let i = r.startIndex; i < r.endIndex; i++) inside += heights[i];
    assert.equal(r.topSpacer + inside + r.bottomSpacer, r.totalHeight, '占位与区间高度必须闭合');
});
test('B4 可变行高：台账里已知的高行会被尊重（不再按固定 68px 一刀切）', () => {
    const heights = Array.from({ length: 1000 }, () => 68);
    heights[500] = 680;
    const before = computeWindowedRange(1000, 500 * 68 - 1, 640, { maxNodes: 40, overscan: 1, heights, avgRowHeight: 68 });
    const fixed = computeWindowedRange(1000, 500 * 68 - 1, 640, { maxNodes: 40, overscan: 1, avgRowHeight: 68 });
    assert.notEqual(before.totalHeight, fixed.totalHeight, '台账里的高行必须改变总高度');
    assert.equal(before.totalHeight, fixed.totalHeight + 680 - 68);
});
test('B5 windowItems 保留全局下标（窗口内相对下标不算数）', () => {
    const list = mkMsgs(1000);
    const r = computeWindowedRange(1000, 50000, 640, { maxNodes: 40, overscan: 1 });
    const entries = windowItems(list, r);
    assert.ok(entries.length > 0);
    assert.equal(entries[0].index, r.startIndex);
    assert.equal(entries[entries.length - 1].index, r.endIndex - 1);
    assert.equal(entries[0].item.id, 'm' + r.startIndex);
});
test('B6 ChatView 窗口化 HTML 带上下占位，且索引 offset = baseOffset + startIndex', () => {
    const msgs = mkMsgs(1000);
    const view = Object.create(ChatView.prototype);
    const calls = [];
    view.app = {
        storage: { get: () => 'windowed' },
        currentChat: { id: 'c1' },
        wechatData: { getMessages: () => msgs, getUserInfo: () => ({}) },
    };
    view.renderMessagesWithDateDividers = (list, _ui, offset) => {
        calls.push({ len: list.length, offset });
        return list.map((m) => '<div class="chat-message" data-message-id="' + m.id + '"></div>').join('');
    };
    view.bindWindowedStreamEvents = () => { /* 无 DOM，跳过绑定 */ };
    const container = { dataset: { chatId: 'c1' }, scrollTop: 34000, clientHeight: 640 };
    const html = view.renderWindowedMessageStream(msgs, {}, container);
    assert.match(html, /data-window-spacer="top"/, '缺顶部占位');
    assert.match(html, /data-window-spacer="bottom"/, '缺底部占位');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].len > 0 && calls[0].len <= 40, '物化条数必须在 (0,40]');
    assert.equal(calls[0].offset, view._lastWindowedRange.startIndex, 'baseOffset=0 时 offset 必须等于 startIndex');
});
test('B7 setMessageStreamMode 写键后清空高度台账并触发当前会话重画', async () => {
    const view = Object.create(ChatView.prototype);
    const writes = [];
    let refreshed = 0;
    view.app = { storage: { set: async (k, v) => { writes.push([k, v]); return true; } } };
    view._windowedHeightsByChat = new Map([['c1', { heights: [1], avg: 1 }]]);
    view._refreshCurrentChatMessages = () => { refreshed += 1; return true; };
    const mode = await view.setMessageStreamMode('windowed');
    assert.equal(mode, 'windowed');
    assert.deepEqual(writes, [['wechat-message-render-mode', 'windowed']]);
    assert.equal(view._windowedHeightsByChat.size, 0, '切换模式必须清空旧高度台账');
    assert.equal(refreshed, 1, '切换模式必须立即重画当前会话');
});

/* ═══════════════════════════ C · 负控制（真源码副本） ═══════════════════════════ */
test('C1 负控制：去掉 maxNodes 封顶 ⇒ B1 的同一条断言必红', async () => {
    const dir = await damage(MOD_REL,
        'if (endIndex - startIndex > maxNodes) {',
        'if (false && endIndex - startIndex > maxNodes) {');
    const broke = await import(pathToFileURL(path.join(dir, MOD_REL)).href + '?broke=' + (SEQ += 1));
    const r = broke.computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 3 });
    assert.ok(span(r) > 40, '★ 去掉封顶后仍 ≤ 40 —— 说明 B1 是自证的，抓不到上界失效');
    /* 反向对照：原版同参数必须被封在 40 */
    const good = computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 3 });
    assert.equal(span(good), 40);
});
test('C2 负控制：把缓冲改成 0 ⇒ B 的「缓冲让区间变大」断言必红', async () => {
    const dir = await damage(MOD_REL,
        'const overscanPx = pxRaw === null ? overscanScreens * height : Math.max(0, pxRaw);',
        'const overscanPx = 0;');
    const broke = await import(pathToFileURL(path.join(dir, MOD_REL)).href + '?broke=' + (SEQ += 1));
    const zero = broke.computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 0 });
    const withBuf = broke.computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 1 });
    assert.equal(span(zero), span(withBuf), '★ 破坏后缓冲不再起作用 —— 说明「缓冲 0 会更小」的断言是自证的');
    const good = computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 1 });
    const goodZero = computeWindowedRange(1000, 5000, 640, { maxNodes: 40, overscan: 0 });
    assert.ok(span(good) > span(goodZero), '原版缓冲 1 屏必须比 0 屏大');
});
test('C3 负控制之后真源必须完好（staging 不许污染仓库）', () => {
    const src = readRel(MOD_REL);
    assert.ok(src.includes('if (endIndex - startIndex > maxNodes) {'), '真源封顶被改坏了');
    assert.ok(!src.includes('if (false && endIndex - startIndex > maxNodes)'), '真源里出现破坏版代码');
    assert.ok(src.includes('overscanScreens * height'), '真源缓冲计算被改坏了');
});

/* ═══════════════════════════ D · 接线 ═══════════════════════════ */
test('D1 chat-view 同时 import tailWindowOf 与窗口化模块（两层共存，缺一即红）', () => {
    const src = readRel(VIEW_REL);
    assert.match(src, /import \{ tailWindowOf \} from '\.\.\/\.\.\/config\/list-window\.js'/, 'tailWindowOf 导入丢了');
    assert.match(src, /from '\.\/chat-view-windowed-stream\.js'/, '窗口化模块没导入');
});
test('D2 索引贯穿：renderMessagesWithDateDividers 把 messageIndex 传给 renderMessage 与手工标记', () => {
    const src = readRel(VIEW_REL);
    assert.match(src, /renderMessagesWithDateDividers\(messages, userInfo, indexOffset = 0\)/);
    assert.match(src, /const messageIndex = index \+ indexOffset;/);
    assert.match(src, /renderMessage\(msg, userInfo, messageIndex\)/, 'renderMessage 仍收相对下标');
    assert.match(src, /renderManualTimeMarkerDivider\(msg, messageIndex, markerText\)/, '手工标记仍收相对下标');
});
test('D3 三条刷新路径都走窗口化：首屏 / 全量回退 / smartUpdateMessages', () => {
    const src = readRel(VIEW_REL);
    assert.match(src, /this\._windowedFirstPaintHtml\(win\.items, userInfo, chat\.id\)/, '首屏没接窗口化');
    assert.match(src, /windowedMode[\s\S]{0,120}?_windowedFirstPaintHtml\(win\.items, userInfo, chatId\)/, '全量回退路径没接窗口化');
    assert.match(src, /renderWindowedMessageStream\(win\.items, userInfo, container\)/, 'smartUpdateMessages 没接窗口化');
    assert.match(src, /if \(windowedMode\) this\.bindWindowedStreamEvents\(messagesDiv\)/, '首屏没绑滚动事件');
});
test('D4 设置页有「消息流渲染方式」开关与 change 监听', () => {
    const src = readRel(SETTINGS_REL);
    assert.match(src, /id="wechat-message-render-mode"/, '缺设置开关');
    assert.match(src, /消息流渲染方式/, '缺设置文案');
    assert.match(src, /getElementById\('wechat-message-render-mode'\)\?\.addEventListener\('change'/, '缺 change 监听');
    assert.match(src, /setMessageStreamMode\?\.\(value\)/, '设置页没调统一入口');
});
test('D5 存储键已登记、样式在位', () => {
    const keys = readRel('scripts/keys-audit.mjs');
    assert.match(keys, /key: 'wechat-message-render-mode'/, 'K1 未登记键会红灯');
    const css = readRel('phone.css');
    assert.match(css, /\.wechat-window-spacer\s*\{/, '缺窗口占位样式');
});
test('D6 浏览器场景存在，且断言真实 DOM 上界与两处负控制', () => {
    const scen = readRel('tests/browser/scenarios/r21-windowed-stream.scen.js');
    assert.match(scen, /querySelectorAll\('#chat-messages \.chat-message'\)/, '没有真数 DOM');
    assert.match(scen, /materialized=' \+ n \+ ' limit=' \+ LIMIT/, '滚动三处没断言上界');
    assert.match(scen, /r21-negative-full-mode/, '缺「全量必须超过上界」的负控制');
    assert.match(scen, /maxNodes: Infinity/, '缺上界改 Infinity 的负控制');
    assert.match(scen, /overscan: 0/, '缺缓冲改 0 的负控制');
});

/* ═══════════════════════════ E · 版本锚（下限形） ═══════════════════════════ */
test('E1 四源版本同源且 ≥ 4.143.0', () => {
    const pkg = readJson('package.json').version;
    const man = readJson('manifest.json').version;
    const ul = readJson('update-log.json');
    const idx = readRel('index.js');
    const m = idx.match(/const ST_PHONE_VERSION = '([0-9.]+)'/);
    assert.ok(m, 'index.js 缺 ST_PHONE_VERSION');
    assert.equal(pkg, man);
    assert.equal(pkg, ul.latest);
    assert.equal(pkg, m[1]);
    const num = (v) => v.split('.').map(Number);
    const [a, b, c] = num(pkg);
    const [x, y, z] = num('4.143.0');
    assert.ok(a > x || (a === x && (b > y || (b === y && c >= z))), '版本低于 4.143.0：' + pkg);
});
