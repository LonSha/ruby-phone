/* ============================================================================
 * tests/r25_o2_scroll_memory.test.mjs — R25-O2 会话滚动位置记忆（判据本体）
 * ----------------------------------------------------------------------------
 * 本项验收口径（路线图原文）：「1 万条消息滚动帧率与内存有前后实测值；
 *   滚动位置与草稿在切 App 后一致」。本文件管**能在这里钉死的那一半**：
 *   · 位置记账/恢复的唯一实现（config/chat-scroll-memory.js）逐条行为；
 *   · 接线面真的在（import / 记账 / 恢复 / 绑定四处，且恢复在 DOM 就位时机）；
 * 帧率与内存的真读数归浏览器层场景 tests/browser/scenarios/o2-longlist-10k.scen.js，
 *   本文件**不冒充**帧率（Node 里没有排版引擎，算出来的只能是假数）。
 * ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    CSM_KEY, CSM_QUARANTINE_SUFFIX, CSM_MAX_CHATS,
    csmBlank, csmParse, csmRemember, csmRestoreOf, csmVerdict, chatScrollMemorySelfCheck,
} from '../config/chat-scroll-memory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/* 剥注释：判据扫源码时必须先剥，否则自己抄进注释的旧代码会骗红。
 *   手写扫描而不用正则 —— 正则里的反斜杠在本仓的生成/转义链上反复被吃掉（本轮实测两次）。 */
const NL = String.fromCharCode(10);
const codeOf = (src) => {
    let out = '';
    let i = 0;
    while (i < src.length) {
        if (src[i] === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
        if (src[i] === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== NL) i += 1; continue; }
        out += src[i];
        i += 1;
    }
    return out;
};
const countOf = (hay, needle) => hay.split(needle).length - 1;

test('O2-1 解析：没记过就是 absent —— 不是「位置 0」', () => {
    const p = csmParse(null);
    assert.equal(p.face, 'absent');
    assert.equal(p.reason, 'never-recorded');
    assert.deepEqual(p.state.chats, {});
    /* 反向：把 absent 读成「顶部 0px」就会在用户从未打开过该会话时
     * 也去写 scrollTop=0，把「默认贴底」顶掉。这条断言钉的就是那一格。 */
    assert.notEqual(p.face, 'ok');
});

test('O2-2 解析：坏 JSON 如实标 unreadable 并带原文（供隔离），不抛', () => {
    const p = csmParse('{oops');
    assert.equal(p.face, 'unreadable');
    assert.equal(p.reason, 'bad-json');
    assert.ok(String(p.rawText).includes('{oops'));
    assert.equal(Object.keys(p.state.chats).length, 0);
    /* 类型不对也算读不出，不许当成「空对象」 */
    assert.equal(csmParse('[1,2]').face, 'unreadable');
});

test('O2-3 解析：坏条目丢弃并计数，不当成「位置 0」', () => {
    const p = csmParse(JSON.stringify({ chats: { good: { top: 12, atBottom: false, at: 3 }, bad: { top: 'x' } } }));
    assert.equal(p.face, 'ok');
    assert.equal(Object.keys(p.state.chats).length, 1);
    assert.equal(p.dropped, 1);
});

test('O2-4 记账：不改入参，返回新对象（同一输入两次同一结果）', () => {
    const s0 = csmParse(JSON.stringify({ chats: { a: { top: 100, atBottom: false, at: 1 } } })).state;
    const r1 = csmRemember(s0, 'a', 300, 9, false);
    const r2 = csmRemember(s0, 'a', 300, 9, false);
    assert.equal(s0.chats.a.top, 100, '记账改了入参');
    assert.equal(r1.state.chats.a.top, 300);
    assert.deepEqual(r1.state, r2.state);
    /* chatId 不成立 ⇒ 不写进共享桶 */
    assert.deepEqual(csmRemember(s0, '   ', 5, 5, false).state, s0);
});

test('O2-5 记账：超上限淘汰最久未用，淘汰数如实返回', () => {
    let st = csmBlank();
    for (let i = 0; i < CSM_MAX_CHATS + 3; i += 1) st = csmRemember(st, 'c' + i, i, i + 1, false).state;
    assert.equal(Object.keys(st.chats).length, CSM_MAX_CHATS);
    assert.equal(st.chats.c0, undefined, '最久未用的那条应被淘汰');
    assert.ok(st.chats['c' + (CSM_MAX_CHATS + 2)], '刚写的那条必须还在');
    const overflow = csmRemember(st, 'newest', 1, 9999, false);
    assert.equal(overflow.dropped, 1, '淘汰了却不报数 = 静默丢位置');
});

test('O2-6 恢复四档互不同形：exact / clamped / bottom / absent', () => {
    const st = csmRemember(csmRemember(csmBlank(), 'mid', 500, 2, false).state, 'bottom', 800, 3, true).state;
    assert.equal(csmRestoreOf(st, 'mid', 1000).face, 'exact');
    assert.equal(csmRestoreOf(st, 'mid', 100).face, 'clamped');
    assert.equal(csmRestoreOf(st, 'bottom', 1000).face, 'bottom');
    assert.equal(csmRestoreOf(st, 'nope', 1000).face, 'absent');
    /* 贴底那一档 mode 必须是 none：界面本来就会贴底，再去写 scrollTop 就是多此一举 */
    assert.equal(csmRestoreOf(st, 'bottom', 1000).mode, 'none');
    assert.equal(csmRestoreOf(st, 'mid', 1000).mode, 'exact');
});

test('O2-7 clamped 如实带上「本来想去哪」', () => {
    const st = csmRemember(csmBlank(), 'mid', 5000, 2, false).state;
    const r = csmRestoreOf(st, 'mid', 1200);
    assert.equal(r.face, 'clamped');
    assert.equal(r.top, 1200);
    assert.equal(r.wanted, 5000);
    assert.equal(r.reason, 'out-of-range');
});

test('O2-8 判定三态：same / mismatch / unknown（读不出不许算「一样」）', () => {
    assert.equal(csmVerdict(300, 300).face, 'same');
    assert.equal(csmVerdict(300, 301).face, 'same');
    assert.equal(csmVerdict(300, 380).face, 'mismatch');
    assert.equal(csmVerdict(null, 300).face, 'unknown');
    assert.equal(csmVerdict(300, undefined).face, 'unknown');
});

test('O2-9 内核自检通过，且隔离键与台账键同源', () => {
    const sc = chatScrollMemorySelfCheck();
    assert.deepEqual(sc.bad, []);
    assert.equal(CSM_QUARANTINE_SUFFIX, '.corrupt');
    assert.ok(CSM_KEY.startsWith('chat_scroll_memory'));
});

test('O2-10 接线面：import / 记账 / 恢复 / 绑定 四处都在 chat-view', () => {
    const src = codeOf(read('apps/wechat/chat-view.js'));
    assert.ok(src.includes("from '../../config/chat-scroll-memory.js'"), '没有 import 内核（位置它拿什么算）');
    for (const m of ['_scrollMemoryEnsure', '_scrollMemoryRecord', '_scrollMemoryRestore', 'bindScrollMemoryEvents']) {
        assert.ok(src.includes(m + '('), '缺方法 ' + m);
    }
    /* 记账必须真接在某一个 scroll 监听里（不是写了个方法没人调）。
     *   全仓有多个 scroll 监听（窗口化换窗那个在前面），所以逐个看，不只看第一个。 */
    const needle = "addEventListener('scroll'";
    const spots = [];
    let from = 0;
    for (;;) {
        const i = src.indexOf(needle, from);
        if (i < 0) break;
        spots.push(i);
        from = i + needle.length;
    }
    assert.ok(spots.length > 0, '找不到 scroll 监听');
    assert.ok(spots.some((i) => src.slice(i, i + 900).includes('_scrollMemoryRecord(')), '没有任何 scroll 监听在做记账');
});

test('O2-11 恢复接在「DOM 已就位」的时机：在 bindEditBuffer 之后', () => {
    const src = codeOf(read('apps/wechat/chat-view.js'));
    const bindEdit = src.indexOf("bindEditBuffer(this.app.storage, 'wechatApp', 'chat:'");
    const restore = src.indexOf('this._scrollMemoryRestore(this.app.currentChat.id');
    assert.ok(bindEdit > 0, '找不到 bindEditBuffer 的接线点');
    assert.ok(restore > bindEdit, '恢复必须排在 bindEditBuffer 之后（更早时容器还没排版）');
});

test('O2-12 单一出处：apps/ 下不许再写字面量台账键', () => {
    const hits = [];
    const walk = (dir) => {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
            const rel = dir + '/' + name;
            const st = fs.statSync(path.join(ROOT, rel));
            if (st.isDirectory()) { walk(rel); continue; }
            if (!name.endsWith('.js')) continue;
            if (codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8')).includes("'" + CSM_KEY + "'")) hits.push(rel);
        }
    };
    walk('apps');
    assert.deepEqual(hits, [], '台账键应只由内核导出，apps 侧必须 import：' + hits.join(', '));
});

test('O2-13 死读接上真数据：_lastScrollTop 既有读也有写', () => {
    const src = codeOf(read('apps/wechat/chat-view.js'));
    const writes = countOf(src, 'this._lastScrollTop =');
    assert.ok(writes >= 2, '修前 _lastScrollTop 全仓零写（探针永远读到 0），现在至少有记账与恢复两处写入；实为 ' + writes);
});

test('O2-14 负控制：把 absent 抄成 exact（猜位置）⇒ O2-1 必须转红', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o2_'));
    const src = read('config/chat-scroll-memory.js');
    const broken = src.replace(
        "if (!entry) return { face: 'absent', mode: 'none', top: 0, at: null, reason: 'never-recorded' };",
        "if (!entry) return { face: 'exact', mode: 'exact', top: 0, at: null, reason: 'guessed' };",
    );
    assert.notEqual(broken, src, '负控制的补丁没打上（锚点变了就得改判据，不许假绿）');
    fs.writeFileSync(path.join(tmp, 'chat-scroll-memory.js'), broken);
    const mod = await import(pathToFileURL(path.join(tmp, 'chat-scroll-memory.js')).href);
    const st = mod.csmBlank();
    const guessed = mod.csmRestoreOf(st, 'never-opened', 1000);
    /* 契约破了：从未记过的会话被「猜」成顶部 0px ⇒ O2-1 的同一条断言转红 */
    assert.equal(guessed.face, 'exact');
    assert.notEqual(guessed.face, 'absent', '负控制生效：猜位置时 absent 这一档消失');
    fs.rmSync(tmp, { recursive: true, force: true });
});
