/* ============================================================
 * tests/system-v4141.test.mjs —— v4.141.0 · 第二十一期批次 A · R21-O2
 *   「内容时间轴收口 + 收口进度机器读数」判据
 *
 * 【规格来源】.agents/notes/proposed/architecture/2026-11-11-product-optimization-v21.md
 *   的 R21-O2 节（本文件文件名以 v4141 为准：规格里的 `system-v4110` 是笔误，
 *   该名已被 v4.11.0 · R3-O1「通话同名歧义认领」判据占用，勿覆盖）。
 *
 * 【本项要做的事，一句话】
 *   白名单里仍标「待收口」的 6 处**内容时间轴**全部改走 `storyNowWallFallback`，
 *   其余 wall 档一处不动；并新增机器读数三列计数 + 诊断台进度行。
 *
 * 【四组判据（对应规格四条验收）】
 *   A 字样清零：白名单内不存在任何「待收口」字样（含历史叙述）——欠债归零可机器读；
 *   B 六处真跑：六个规格点名位置在假剧情钟宿主下写出**剧情时刻**（不是墙钟），
 *     且**改回墙钟必被看见**（B 组每条都自带「不是现在」的反向断言）；
 *   C 负控制：把降级出口的墙钟读数换掉 ⇒ B 组判据必红。证明 B 不是自证；
 *   D 读数同源：`tools/gen_time_debt_readings.mjs` 的两份产物（JSON + 运行时模块）
 *     与磁盘逐字一致，且已收口文件在册（防视图手抄漂移）。
 *
 * 【本套件自己抓到过 / 刻意避开的三种判据失真形（写下来防复发）】
 *   · 「只断言不为 null」⇒ 墙钟也是 number，永远绿。故每条都断言「落在剧情纪元 ±5 分钟内」，
 *     并对 `Date.now()` 量级再补一条「不等于现在」；
 *   · 「构造器太重就直接 new」⇒ chat-view 构造器里有 `new Audio()`，Node 下必炸（会伪装成产品红）。
 *     故重类一律 `Object.create(Prototype)` + 只挂被测方法所需的最小 stub；
 *   · 「负控制改真源再恢复」⇒ 与仓库其它判据并发跑时会互相污染（`node --test` 按文件并发）。
 *     故采用本仓 v4113 先例：**整树暂存到 tmp 再破**，真源一个字节都不动。
 * ============================================================ */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

let SEQ = 0;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readRel(rel));
/* 产品代码读裸 `window`（music / chat-view 的收口点都是 `storyNowWallFallback(window)`）。
 *   node --test 每个文件是独立进程，这里补一个指向自身的 window 不影响其它判据文件。 */
globalThis.window = globalThis;

/* ══════════ 剧情纪元：2044-01-10 08:00 UTC（刻意远离现在） ══════════ */
const STORY_EPOCH = Date.UTC(2044, 0, 10, 8, 0, 0);
const MINUTE = 60 * 1000;
/* 容差：假宿主每次取钟自增 1 分钟，一次调用最多取几次；5 分钟足够宽且**远小于**「现在」的偏差 */
const TOLERANCE = 5 * MINUTE;
const nearStory = (ts) => (typeof ts === 'number')
    && Math.abs(ts - STORY_EPOCH) <= TOLERANCE;
/* 「不是现在」：真墙钟与 2044 差着十几年，这条断言是 B 组的防自证保险 */
const notWallClock = (ts) => Math.abs(ts - Date.now()) > 365 * 24 * 3600 * 1000;

/**
 * 装一个假剧情钟宿主。`getCurrentStoryTime()` 每次调用把时刻推进 1 分钟，
 * 形状与 `config/time-source.js` 的 `storyNow()` 期望的 face 完全一致
 * （`date` / `time` / `weekday` / `timestamp` / `source` 五个字段，两者非空才算有效）。
 * 推进是有意的：它让「六个位置各自取一次钟」不会被同一个值蒙对。
 */
function installStoryHost(win = globalThis) {
    const state = { ticks: 0, calls: 0 };
    win.VirtualPhone = win.VirtualPhone || {};
    win.VirtualPhone.timeManager = {
        getCurrentStoryTime: () => {
            state.calls += 1;
            state.ticks += MINUTE;
            return {
                date: '2044年1月10日',
                time: '08:0' + String(Math.min(9, (state.ticks / MINUTE) % 10)),
                weekday: '星期日',
                timestamp: STORY_EPOCH + state.ticks,
                source: 'stub',
            };
        },
    };
    return state;
}
/** 摘掉剧情钟（用于「读不到剧情时刻」那一面，本套件 D 组之外暂不需要，留作显式工具）。 */
function removeStoryHost(win = globalThis) {
    try { delete win.VirtualPhone.timeManager; } catch (_e) { /* 已不存在 */ }
}
/** 跑一段代码在指定宿主下，结束后恢复原宿主（不把假钟漏给后续判据）。 */
function withStoryHost(fn) {
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    try {
        return { value: fn(state), state };
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
}
/** 内存存储：`get` 读不到返回 null，`set` 返回 true（`config/write-receipt.js` 认这个形状）。 */
function mkStorage() {
    const store = new Map();
    return {
        get: (k) => (store.has(k) ? store.get(k) : null),
        set: (k, v) => { store.set(k, v); return true; },
        remove: (k) => { store.delete(k); return true; },
    };
}

/* ══════════════════════════ A · 字样清零 ══════════════════════════ */
test('A1 白名单里不存在「待收口」字样 —— 欠债归零是可机器读的事实', () => {
    const wl = readJson('tests/fixtures/bare-now-whitelist.json');
    const files = wl.files || {};
    const hits = [];
    for (const [file, note] of Object.entries(files)) {
        const text = String(note);
        if (text.includes('待收口')) hits.push(file);
    }
    assert.deepEqual(hits, [], '这些白名单条目里还留着「待收口」字样：' + hits.join(', '));
});
test('A2 白名单每一条都说得出理由（不是零容忍，是必须逐条登记）', () => {
    const wl = readJson('tests/fixtures/bare-now-whitelist.json');
    const files = wl.files || {};
    const entries = Object.entries(files);
    assert.ok(entries.length > 0, '白名单为空等于这个审计没有覆盖任何文件');
    const silent = entries.filter(([, note]) => !String(note || '').trim()).map(([f]) => f);
    assert.deepEqual(silent, [], '这些条目没有写理由：' + silent.join(', '));
    /* policy 三键（story / wall / three）必须在册 —— 口径不许靠记忆 */
    assert.ok(wl.policy && typeof wl.policy === 'object', '白名单 policy 缺失');
    for (const key of ['story', 'wall', 'three']) {
        assert.ok(wl.policy[key], 'policy 缺 ' + key + ' 口径');
    }
});
test('A3 六个规格点名文件都在白名单在册（收口点不能是黑户）', () => {
    const wl = readJson('tests/fixtures/bare-now-whitelist.json');
    const files = wl.files || {};
    const spec = [
        'apps/loverspace/loverspace-app.js',
        'apps/music/music-app.js',
        'apps/piggy/piggy-app.js',
        'apps/wechat/chat-view.js',
    ];
    for (const rel of spec) {
        assert.ok(Object.prototype.hasOwnProperty.call(files, rel), '白名单缺条目：' + rel);
    }
});

/* ═════════════════════ B · 六处真跑（假剧情钟宿主） ═════════════════════ */
test('B1 loverspace.ask —— 提问的 timestamp 是剧情时刻', async () => {
    const { LoverSpaceApp } = await import(path.join(ROOT, 'apps/loverspace/loverspace-app.js'));
    let q = null;
    const { state } = withStoryHost(() => {
        const app = new LoverSpaceApp({}, mkStorage());
        const r = app.ask('判据：你最近睡得好吗');
        assert.equal(r.ok, true, 'ask 未成功：' + String(r && r.error));
        q = app.questions[0];
        return r;
    });
    assert.ok(q, 'questions 里没有刚落的那条（probe 会把列表重读，存储 stub 必须真存取）');
    assert.ok(nearStory(q.timestamp), 'ask 的 timestamp 不在剧情纪元内：' + String(q.timestamp));
    assert.ok(notWallClock(q.timestamp), 'ask 的 timestamp 落在墙钟量级 —— 收口没生效');
    assert.equal(q.questioner, 'user');
    assert.equal(q.answerer, 'char');
    assert.ok(state.calls >= 1, '假剧情钟一次都没被读到 —— 收口没接上');
});
test('B2 loverspace.askByChar —— Ta 问你的 timestamp 是剧情时刻', async () => {
    const { LoverSpaceApp } = await import(path.join(ROOT, 'apps/loverspace/loverspace-app.js'));
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    let q = null;
    try {
        const app = new LoverSpaceApp({}, mkStorage());
        const r = app.askByChar('判据：你今天怎么这么安静');
        assert.equal(r.ok, true, 'askByChar 未成功：' + String(r && r.error));
        q = app.questions[0];
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    assert.ok(q, 'questions 里没有刚落的那条（probe 会把列表重读，存储 stub 必须真存取）');
    assert.ok(nearStory(q.timestamp), 'askByChar 的 timestamp 不在剧情纪元内：' + String(q.timestamp));
    assert.ok(notWallClock(q.timestamp), 'askByChar 的 timestamp 落在墙钟量级 —— 收口没生效');
    assert.equal(q.questioner, 'char', 'askByChar 的提问者必须是 char（user↔char 语义不许交叉污染）');
    assert.equal(q.answerer, 'user');
    assert.ok(state.calls >= 1);
});
test('B3 music.shareCurrentTrackToWechat —— 分享消息的 timestamp 是剧情时刻', async () => {
    const { MusicApp } = await import(path.join(ROOT, 'apps/music/music-app.js'));
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    const calls = [];
    try {
        globalThis.VirtualPhone.wechatApp = {
            wechatData: {
                data: { messages: { c1: [] } },
                addMessage: (chatId, msg) => { calls.push({ chatId, msg }); },
            },
            currentChat: { id: 'c1' },
        };
        const music = Object.create(MusicApp.prototype);
        music.musicData = { getCurrentTrack: () => ({ name: '判据之歌', artist: '探针' }) };
        const ok = music.shareCurrentTrackToWechat('c1');
        assert.equal(ok, true, '分享未成功（stub 面不够：需 window.VirtualPhone.wechatApp.wechatData）');
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    assert.equal(calls.length, 1, 'addMessage 必须恰被调一次（stub 自己记 calls，别靠猜）');
    const msg = calls[0].msg;
    assert.equal(calls[0].chatId, 'c1');
    assert.ok(nearStory(msg.timestamp), '分享消息的 timestamp 不在剧情纪元内：' + String(msg.timestamp));
    assert.ok(notWallClock(msg.timestamp), '分享消息的 timestamp 落在墙钟量级 —— 收口没生效');
    assert.match(msg.text, /判据之歌/, '分享文案没带歌名');
    assert.ok(state.calls >= 1);
});
test('B4 piggy.addTransaction —— 记账条目的 time 是剧情时刻（并穿透到 id 与月键）', async () => {
    const { PiggyApp } = await import(path.join(ROOT, 'apps/piggy/piggy-app.js'));
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    let tx = null;
    try {
        const app = new PiggyApp({}, mkStorage());
        const ok = app.addTransaction({ kind: 'expense', amountYuan: '12.34', remark: '判据记账' });
        assert.equal(ok, true, '记账未成功（金额合法即应记上）');
        tx = app.state.transactions[0];
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    assert.ok(tx, 'state.transactions 为空');
    assert.ok(nearStory(tx.time), '记账 time 不在剧情纪元内：' + String(tx.time));
    assert.ok(notWallClock(tx.time), '记账 time 落在墙钟量级 —— 收口没生效');
    assert.equal(tx.amountCents, 1234);
    /* 交叉验证：time 会被卷进 id（`pg_<time>_<rand>`）与月键 —— 一处收口，两处跟着对 */
    assert.match(tx.id, /^pg_\d+_/, '流水 id 形状变了（源口径 pg_<time>_<rand>）');
    assert.ok(tx.id.includes(String(tx.time)), 'id 里的时刻与 time 字段不一致，说明 id 不是从同一个数生成的');
    assert.ok(state.calls >= 1);
});
test('B5 chat-view._claimGroupRedPacketForCurrentUser —— 领取记录的 timestamp 是剧情时刻', async () => {
    const { ChatView } = await import(path.join(ROOT, 'apps/wechat/chat-view.js'));
    const mkPacket = (id) => ({
        id, type: 'redpacket', from: '别人', packetMode: 'group_average',
        status: 'sent', amount: '3.00', count: 3, claims: [],
    });
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    let claim = null;
    try {
        const view = Object.create(ChatView.prototype);   /* 构造器里有 new Audio()，不 new */
        view.app = {
            wechatData: {
                getUserInfo: () => ({ name: '我' }),
                getMessages: () => [mkPacket('p1')],
                getChat: () => ({ type: 'group' }),
                updateMessageById: (chatId, mid, patch) => Object.assign({ id: mid }, patch),
                updateWalletBalance: () => { /* stub */ },
                addMessage: () => { /* stub */ },
            },
            currentChat: { name: '群' },
        };
        claim = view._claimGroupRedPacketForCurrentUser('g1', mkPacket('p1'));
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    assert.ok(claim && claim.message, '领取返回空（stub 面不够：需 getUserInfo/getMessages/updateMessageById/updateWalletBalance）');
    const c = claim.message.claims[0];
    assert.ok(c, 'claims 里没有新记录');
    assert.ok(nearStory(c.timestamp), '领取记录的 timestamp 不在剧情纪元内：' + String(c.timestamp));
    assert.ok(notWallClock(c.timestamp), '领取记录的 timestamp 落在墙钟量级 —— 收口没生效');
    assert.equal(claim.message.packetClaimCount, 1);
    assert.ok(state.calls >= 1);
});
test('B6 chat-view._applyWechatPaymentAction —— 群红包分支的 claims[].timestamp 是剧情时刻', async () => {
    const { ChatView } = await import(path.join(ROOT, 'apps/wechat/chat-view.js'));
    const mkPacket = () => ({
        id: 'p1', type: 'redpacket', from: '别人', packetMode: 'group_average',
        status: 'sent', amount: '3.00', count: 3, claims: [],
    });
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    let updated = null;
    try {
        const view = Object.create(ChatView.prototype);
        view.app = {
            wechatData: {
                getUserInfo: () => ({ name: '我' }),
                getMessages: () => [mkPacket()],
                getChat: () => ({ type: 'group' }),
                updateMessageById: (chatId, mid, patch) => Object.assign({ id: mid }, patch),
                updateWalletBalance: () => { /* stub */ },
                addMessage: () => { /* stub */ },
            },
            currentChat: { name: '群' },
        };
        updated = view._applyWechatPaymentAction('g1', {
            type: 'payment_action', targetType: 'redpacket', action: 'accept',
        }, '小蓝');
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    assert.ok(updated, '动作未命中任何红包（群红包 + 非自己发的才能领）');
    const c = updated.claims[0];
    assert.ok(c, 'claims 里没有新记录');
    assert.ok(nearStory(c.timestamp), 'claims[].timestamp 不在剧情纪元内：' + String(c.timestamp));
    assert.ok(notWallClock(c.timestamp), 'claims[].timestamp 落在墙钟量级 —— 收口没生效');
    assert.equal(c.name, '小蓝');
    assert.ok(state.calls >= 1);
});
test('B7 六处收口位置在源码里确实都走同一个降级出口（不许各写一份）', () => {
    const expect = {
        'apps/loverspace/loverspace-app.js': 2,
        'apps/music/music-app.js': 1,
        'apps/piggy/piggy-app.js': 1,
        'apps/wechat/chat-view.js': 2,
    };
    for (const [rel, want] of Object.entries(expect)) {
        const src = readRel(rel);
        /* import 行是 `import { storyNowWallFallback } from ...`（无括号），不含在计数里 */
        const calls = src.split('storyNowWallFallback(').length - 1;
        assert.equal(calls, want, rel + ' 的 storyNowWallFallback 调用数应为 ' + want + '，实为 ' + calls);
        assert.match(src, /import\s*\{[^}]*storyNowWallFallback[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/time-source\.js'/,
            rel + ' 没有从 config/time-source.js 导入 storyNowWallFallback');
    }
});

/* ═══════════════════ C · 负控制：把降级出口换掉，B 必须红 ═══════════════════ */
/* 做法对齐本仓 v4.113.0 判据先例：把 config/ 与 apps/ 整树暂存进 tmp，在 tmp 里破一处，
 *   再从 tmp 导入。理由：`node --test tests/*.test.mjs` 是**按文件并发**的，
 *   若直接改仓库真源再恢复，与其它判据的读盘窗口重叠就会互相污染。 */
const TEMP_DIRS = [];
process.on('exit', () => {
    for (const d of TEMP_DIRS) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ }
    }
});
async function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rubyphone-v4141-'));
    TEMP_DIRS.push(dir);
    /* 唯一实现纪律（tests/system-v3230 A1）：tests/ 下不得裸调 cpSync，镜像必须走共享实现
     *   `tests/_mirror_tree.mjs` 的 copyTreeSafe（它对「复制途中源文件消失」的瞬态竞态有容忍）。
     *   动态 import + cache-busting，与本文件其它假宿主手法一致。 */
    const mod = await import(pathToFileURL(path.join(ROOT, 'tests', '_mirror_tree.mjs')).href
        + '?v=v4141-' + (SEQ += 1));
    await mod.copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    await mod.copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
    return dir;
}
async function damage(rel, from, to) {
    const src = readRel(rel);
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = await stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}
test('C1 负控制：把降级出口的墙钟读数接上 ⇒ B6 的同一条断言必须变红', async () => {
    /* 破坏点：storyNowWallFallback 里「读不到剧情钟就走墙钟」的那一句。
     *   破成「永远走墙钟」——即在**有剧情钟**时也返回墙钟。
     *   注意：不能只改 wallNow()（剧情钟可读时根本不走那条分支，破坏不可观测）。 */
    const dir = await damage('config/time-source.js',
        '    const s = storyNow(win);\n    if (s.ms !== null) return s;',
        '    const s = storyNow(win);\n    if (false && s.ms !== null) return s;');
    const brokeSrc = fs.readFileSync(path.join(dir, 'config/time-source.js'), 'utf8');
    assert.ok(brokeSrc.includes('if (false && s.ms !== null) return s;'), '破坏没写进 tmp 树（staging 失效）');
    /* 原版：确有剧情钟时返回剧情时刻 */
    const good = await import(path.join(ROOT, 'config/time-source.js'));
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    const state = installStoryHost(globalThis);
    try {
        const got = good.storyNowWallFallback(globalThis);
        assert.equal(got.ok, true, '原版在假宿主下应读到剧情钟');
        assert.ok(nearStory(got.ms), '原版返回的不是剧情时刻');
        assert.equal(got.degraded, false, '原版不该标降级');
        assert.ok(state.calls >= 1);
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    /* 破坏版：同样的假宿主，返回墙钟 ⇒ 判据必须看得见 */
    const broke = await import(path.join(dir, 'config/time-source.js'));
    const prevDesc2 = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    installStoryHost(globalThis);
    let bad = null;
    try {
        bad = broke.storyNowWallFallback(globalThis);
    } finally {
        if (prevDesc2) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc2);
        else removeStoryHost(globalThis);
    }
    assert.ok(bad.ms !== null, '破坏版居然返回 null —— 破坏方式不对，这条负控制不成立');
    assert.equal(nearStory(bad.ms), false, '★ 破坏后仍被判为剧情时刻 —— 说明 B 组的断言是自证的，抓不到收口失效');
    assert.equal(bad.degraded, true, '破坏版应自报 degraded=true');
});
test('C2 负控制：破坏版下 B 组六处的产物都落到墙钟量级（真跑，不是读源码）', async () => {
    const dir = await damage('config/time-source.js',
        '    const s = storyNow(win);\n    if (s.ms !== null) return s;',
        '    const s = storyNow(win);\n    if (false && s.ms !== null) return s;');
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'VirtualPhone');
    installStoryHost(globalThis);
    let pigTime = null;
    let claimed = null;
    try {
        /* 从**破坏树**里导入 piggy 与 chat-view：它们的 `../../config/time-source.js` 指向破坏版 */
        const { PiggyApp } = await import(path.join(dir, 'apps/piggy/piggy-app.js'));
        const app = new PiggyApp({}, mkStorage());
        assert.equal(app.addTransaction({ kind: 'income', amountYuan: '8.88', remark: '负控制' }), true);
        pigTime = app.state.transactions[0].time;

        const { ChatView } = await import(path.join(dir, 'apps/wechat/chat-view.js'));
        const mkPacket = () => ({
            id: 'p1', type: 'redpacket', from: '别人', packetMode: 'group_average',
            status: 'sent', amount: '3.00', count: 3, claims: [],
        });
        const view = Object.create(ChatView.prototype);
        view.app = {
            wechatData: {
                getUserInfo: () => ({ name: '我' }),
                getMessages: () => [mkPacket()],
                getChat: () => ({ type: 'group' }),
                updateMessageById: (chatId, mid, patch) => Object.assign({ id: mid }, patch),
                updateWalletBalance: () => { /* stub */ },
                addMessage: () => { /* stub */ },
            },
            currentChat: { name: '群' },
        };
        claimed = view._claimGroupRedPacketForCurrentUser('g1', mkPacket());
    } finally {
        if (prevDesc) Object.defineProperty(globalThis, 'VirtualPhone', prevDesc);
        else removeStoryHost(globalThis);
    }
    assert.ok(pigTime !== null, '破坏版下没记上账 —— 这条负控制没接通');
    assert.equal(nearStory(pigTime), false, '★ 破坏后记账 time 仍是剧情时刻 —— B4 抓不到收口失效');
    assert.ok(notWallClock(pigTime) === false, '★ 破坏后 time 竟仍不落墙钟量级，负控制不成立');
    const cts = claimed && claimed.message && claimed.message.claims[0] && claimed.message.claims[0].timestamp;
    assert.ok(typeof cts === 'number', '破坏版下没领到红包 —— 这条负控制没接通');
    assert.equal(nearStory(cts), false, '★ 破坏后领取记录仍是剧情时刻 —— B5 抓不到收口失效');
});
test('C3 负控制之后真源必须完好（staging 不许污染仓库）', () => {
    const src = readRel('config/time-source.js');
    assert.ok(src.includes('if (s.ms !== null) return s;'), '真源里的降级判断被改坏了');
    assert.ok(!src.includes('if (false && s.ms !== null) return s;'), '真源里出现了破坏版代码');
    assert.equal(src.split('export function storyNowWallFallback(').length - 1, 1);
});

/* ═══════════════════ D · 读数同源（防视图手抄漂移） ═══════════════════ */
test('D1 生成器可重跑，产出与磁盘逐字一致（防手抄）', () => {
    const jsonRel = 'tests/audit/time_debt_readings.json';
    const modRel = 'config/time-debt-readings.js';
    const beforeJson = readRel(jsonRel);
    const beforeMod = readRel(modRel);
    execFileSync(process.execPath, [path.join(ROOT, 'tools/gen_time_debt_readings.mjs')], {
        cwd: ROOT, stdio: 'pipe', timeout: 30000,
    });
    const afterJson = readRel(jsonRel);
    const afterMod = readRel(modRel);
    assert.equal(afterJson, beforeJson, '重跑生成器后 JSON 读数变了 —— 磁盘上那份是手改的');
    assert.equal(afterMod, beforeMod, '重跑生成器后运行时模块变了 —— 磁盘上那份是手改的');
    assert.match(beforeMod, /AUTO-GENERATED/, '运行时模块缺自动生成标记（有人会顺手手改）');
});
test('D2 三列计数自洽：已收口 + 待收口 + wall 合法 = 白名单条目数', () => {
    const wl = readJson('tests/fixtures/bare-now-whitelist.json');
    const r = readJson('tests/audit/time_debt_readings.json');
    const total = Object.keys(wl.files || {}).length;
    assert.equal(r.total, total, '读数 total 与白名单条目数不一致');
    assert.equal(r.storyClosed + r.storyPending + r.wallLegal, r.total,
        '三列之和 != total（' + r.storyClosed + '+' + r.storyPending + '+' + r.wallLegal + ' vs ' + r.total + '）');
    assert.equal(r.storyPending, 0, 'R21-O2 的欠债必须清零，当前还剩 ' + r.storyPending);
    assert.equal(r.schema, 'time-debt-readings@1');
    assert.equal(r.version, wl.version, '读数版本与白名单版本不一致');
});
test('D3 已收口文件在册：11 个文件里必须含六个规格点名者与两个 moments 历史批次', () => {
    const r = readJson('tests/audit/time_debt_readings.json');
    const closed = new Set(r.closedFiles || []);
    const must = [
        'apps/loverspace/loverspace-app.js',
        'apps/music/music-app.js',
        'apps/piggy/piggy-app.js',
        'apps/wechat/chat-view.js',
        /* 实勘新增（同批收口，见 update-log 4.141.0 第 3 条） */
        'apps/games/games-app.js',
        'apps/games/poker/poker-app.js',
        'apps/honey/honey-data.js',
        'apps/weibo/weibo-data.js',
        'apps/wangxiang/wangxiang-app.js',
        /* 历史批次（v4.140.0）收口，读数应继续认账 */
        'apps/moments/moments-living-social-ecosystem.js',
        'apps/moments/npc-social-graph-dynamic-moments.js',
    ];
    const missing = must.filter((f) => !closed.has(f));
    assert.deepEqual(missing, [], '这些已收口文件没进读数在册：' + missing.join(', '));
    assert.equal(closed.size, 11, '已收口文件数应为 11，实为 ' + closed.size);
});
test('D4 运行时模块与 JSON 读数同一份数（诊断台不许自己编数）', async () => {
    const r = readJson('tests/audit/time_debt_readings.json');
    const mod = await import(path.join(ROOT, 'config/time-debt-readings.js'));
    const T = mod.TIME_DEBT_READINGS;
    for (const key of ['total', 'storyClosed', 'storyPending', 'wallLegal', 'schema', 'version']) {
        assert.equal(T[key], r[key], '运行时模块 ' + key + ' 与 JSON 不一致（' + String(T[key]) + ' vs ' + String(r[key]) + '）');
    }
    assert.deepEqual([...T.closedFiles].sort(), [...(r.closedFiles || [])].sort());
    assert.deepEqual([...T.pendingFiles].sort(), [...(r.pendingFiles || [])].sort());
    assert.ok(Object.isFrozen(T), '读数对象必须冻结（防止运行期被就地改写）');
});
test('D5 诊断台确实读自动生成模块，且渲染了「时间轴收口 x/y」', () => {
    const src = readRel('apps/clock/clock-view.js');
    assert.match(src, /import\s*\{\s*TIME_DEBT_READINGS\s*\}\s*from\s*'\.\.\/\.\.\/config\/time-debt-readings\.js'/,
        'clock-view 没有导入同源读数模块');
    assert.match(src, /时间轴收口/, 'clock-view 缺「时间轴收口」文案');
    assert.match(src, /TIME_DEBT_READINGS\.storyClosed/, '进度行的分子没读读数');
    assert.match(src, /TIME_DEBT_READINGS\.total/, '进度行的分母没读读数');
    /* 反例：视图里不许出现手写的三位数（会被误读成「进度是写死的」） */
    assert.ok(!/时间轴收口[^;]{0,80}\b11\s*\/\s*204\b/.test(src), '视图里出现了手写的 11/204 —— 应读 TIME_DEBT_READINGS');
});
test('D6 生成器与两份产物的文件头互相点名（谁生成谁，可追）', () => {
    const gen = readRel('tools/gen_time_debt_readings.mjs');
    assert.match(gen, /tests\/system-v4141\.test\.mjs/, '生成器头注没点名判据文件（判据是 v4141，规格里的 v4110 是笔误）');
    const mod = readRel('config/time-debt-readings.js');
    assert.match(mod, /tools\/gen_time_debt_readings\.mjs/, '运行时模块没写明由谁生成');
    const json = readJson('tests/audit/time_debt_readings.json');
    assert.match(String(json.generatedAt), /gen_time_debt_readings\.mjs/, 'JSON 的 generatedAt 没写生成来源');
});
