/**
 * tests/system-v318.test.mjs — saveChat 失败注入：重试 / 串行 / 丢弃三面行为可观察 [v3.4.1 · P-5]
 *
 * 背景与**实测纠正**（重要，避免后人照抄错计划）：
 *   TODO 的「运行时模拟器剩余三维」里写着「**需要让夹具里的 `saveChat` 可控失败**
 *   （当前是 `async () => {}`）」。开工实测发现**该记载不准确**：
 *   `installRuntimeHost` 返回的 `host.context` 就是那个活对象，
 *   `host.context.saveChat = async () => { throw … }` **当场生效**（探针第 1 例实测 1 次调用）。
 *   所以「夹具不可控」不是缺能力，缺的是**把注入做成一眼可读的用法**与**判据**。
 *   本版据此把 P-5 的交付重新定义为：给夹具补显式 `saveChatFails` 入参 + `saveChatCalls()` 读数，
 *   并为 `_debouncedSaveChat` 那套「串行队列 + 四档退避（0/350/900/1800ms）+ 放弃」立判据
 *   —— 它在 P-5 之前**从来没有被任何判据观察过**（默认 `saveChat` 永远成功，
 *   「重试了几次」「放弃后是什么状态」全是空白）。
 *
 * 为什么值得立判据（不只是补测试）：
 *   这套重试是**在数据丢失路径上**运行的 —— 它是「存档没落盘」与「用户没发现」之间唯一的一道手续。
 *   而它此前只有「成功一次」这一条路径被覆盖过：失败、恢复、放弃、切会话、队列卡死全无观察。
 *
 * 覆盖：
 *   A 夹具面（注入入参默认零影响 + 计数读数 + 优先序）
 *   B 行为面（真源码 + 真宿主）：重试四档 / 第 N 次成功 / 全失败放弃 / 不抛 / 退避实测
 *   C 串行面：并发三次同时在飞峰值 1、队列不交叉
 *   D 隔离面：等待期间切会话 ⇒ 不落盘到新会话；失败不污染队列
 *   E 负控制（真源码破坏 → 破坏副本上重跑同款真判据）
 *   F 版本锚
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const STORAGE_SRC = read('config/storage.js');
const HOST_SRC = read('tests/_runtime_host.mjs');
const RETRY_DELAYS = [0, 350, 900, 1800];
const TOTAL_RETRY_MS = RETRY_DELAYS.reduce((a, b) => a + b, 0);

/** 真源码加载（去掉 export 前缀后落盘成模块；不手抄） */
async function loadStorage(mutator) {
    let src = STORAGE_SRC.replace(/^export\s+class\s+/m, 'class ') + '\nexport { PhoneStorage };\n';
    if (typeof mutator === 'function') src = mutator(src);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v318-storage-'));
    const file = path.join(dir, 'storage_mod.mjs');
    writeFileSync(file, src);
    return (await import('file://' + file)).PhoneStorage;
}

/** 装宿主 + 造实例。★ 必须先 getContext() 让身份落地（否则首次保存就被身份守卫拦下）； */
async function mk(opts = {}) {
    resetHostFlags();
    const host = installRuntimeHost({ chatMetadata: {}, chatId: opts.chatId || 'chat_A', saveChatFails: opts.saveChatFails || 0 });
    const PS = await loadStorage(opts.mutate);
    const st = new PS();
    st.getContext();
    return { host, st };
}

/* ══════════════ A 夹具面 ══════════════ */
test('v318 A1. ★★★ 注入入参默认零影响：saveChatFails 不给时行为与加它之前一致', async () => {
    const { host, st } = await mk();
    await st._debouncedSaveChat(true);
    assert.equal(host.saveChatCalls(), 1, '默认成功路径：恰好 1 次调用');
});

test('v318 A2. ★★★ 夹具面自证：saveChatFails=N ⇒ 前 N 次抛错，第 N+1 次成功（计数读数可用）', async () => {
    resetHostFlags();
    const host = installRuntimeHost({ chatMetadata: {}, saveChatFails: 2 });
    /* 直接打宿主（不经产品代码），先证「注入这件事本身成立」 */
    const results = [];
    for (let i = 0; i < 3; i++) {
        try { await host.context.saveChat(); results.push('ok'); } catch (e) { results.push('throw'); }
    }
    assert.deepEqual(results, ['throw', 'throw', 'ok'], '前 2 次抛、第 3 次成功');
    assert.equal(host.saveChatCalls(), 3, '计数读数如实');
    /* 源码面：默认值必须是 0（否则所有既有测试的宿主都开始抛错） */
    assert.match(HOST_SRC, /const saveChatFails = Number\(opts\.saveChatFails\) \|\| 0;/, '默认 0');
    assert.match(HOST_SRC, /saveChatCalls: \(\) => _saveChatCalls/, '必须暴露调用次数读数');
});

test('v318 A3. ★★ 优先序：saveChatDebounced 在场时走它，不走重试路径', async () => {
    const { host, st } = await mk();
    let deb = 0;
    host.context.saveChatDebounced = () => { deb += 1; };
    await st._debouncedSaveChat(true);
    assert.equal(deb, 1, 'debounced 优先');
    assert.equal(host.saveChatCalls(), 0, '不得同时走直连重试路径');
});

/* ══════════════ B 行为面：重试 / 恢复 / 放弃 ══════════════ */
test('v318 B1. ★★★ 全失败：恰好重试 4 次（四档退避），且**绝不外抛**（数据路径不许把异常抛给调用方）', async () => {
    const { host, st } = await mk({ saveChatFails: 99 });
    let threw = false;
    const t0 = Date.now();
    try { await st._debouncedSaveChat(true); } catch (_e) { threw = true; }
    assert.equal(threw, false, '★ 放弃后必须如实静默：不许把失败抛给调用方（否则「存档失败」会变成业务崩溃）');
    assert.equal(host.saveChatCalls(), RETRY_DELAYS.length, '重试次数必须等于四档表长度（' + RETRY_DELAYS.length + '）');
    /* 放弃前必须真的等过退避（不许「假装重试」——同步连打 4 次也是一种「没重试」） */
    assert.ok(Date.now() - t0 >= TOTAL_RETRY_MS - 200,
        '总耗时应 ≥ 四档退避之和 ' + TOTAL_RETRY_MS + 'ms，实测 ' + (Date.now() - t0) + 'ms');
});

test('v318 B2. ★★★ 第 N 次成功：恢复即停，不多打（重试是有限资源，不许无脑穷举）', async () => {
    const { host, st } = await mk({ saveChatFails: 1 });
    const t0 = Date.now();
    await st._debouncedSaveChat(true);
    assert.equal(host.saveChatCalls(), 2, '第 2 次成功即停');
    const used = Date.now() - t0;
    assert.ok(used < RETRY_DELAYS[2], '不应吃满后续退避（实测 ' + used + 'ms）');
});

test('v318 B3. ★★★ 退避表实测：四档间隔与源码表一致（0 / 350 / 900 / 1800）', async () => {
    /* 源码面：表必须以字面量在场（判据钉的是口径，不是「大约」） */
    assert.match(STORAGE_SRC, /const retryDelays = \[0, 350, 900, 1800\];/, '四档退避表');
    /* 行为面：真跑一次，量出四段的实际间隔 */
    const { host, st } = await mk();
    const stamps = [];
    host.context.saveChat = async () => { stamps.push(Date.now()); throw new Error('boom'); };
    await st._debouncedSaveChat(true);
    assert.equal(stamps.length, 4, '四次尝试的时间戳都要在');
    const gaps = stamps.map((t, i) => (i === 0 ? 0 : t - stamps[i - 1]));
    assert.ok(gaps[0] === 0, '第 1 档不等待');
    for (let i = 1; i < RETRY_DELAYS.length; i++) {
        assert.ok(Math.abs(gaps[i] - RETRY_DELAYS[i]) <= RETRY_DELAYS[i] * 0.5 + 120,
            '第 ' + (i + 1) + ' 档退避应约 ' + RETRY_DELAYS[i] + 'ms，实测 ' + gaps[i] + 'ms');
    }
});

test('v318 B4. ★★ 无保存能力（宿主既无 saveChat 也无 debounced）：不得抛', async () => {
    const { host, st } = await mk();
    delete host.context.saveChat;
    delete host.context.saveChatDebounced;
    let threw = false;
    try { await st._debouncedSaveChat(true); } catch (_e) { threw = true; }
    assert.equal(threw, false, '没有保存手段时如实静默');
});

/* ══════════════ C 串行面 ══════════════ */
test('v318 C1. ★★★ 串行化：并发三次立即保存 ⇒ 每秒最多一次在飞（防 EPERM rename 撞车）', async () => {
    const { host, st } = await mk();
    let inFlight = 0, maxInFlight = 0, calls = 0;
    host.context.saveChat = async () => {
        calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 40));
        inFlight -= 1;
    };
    await Promise.all([st._debouncedSaveChat(true), st._debouncedSaveChat(true), st._debouncedSaveChat(true)]);
    assert.equal(calls, 3, '三次都要跑（不许合并丢掉）');
    assert.equal(maxInFlight, 1, '★ 同时在飞必须恒为 1（这正是不走串行队列时会撞的那个形态）');
});

/* ══════════════ D 隔离面 ══════════════ */
test('v318 D1. ★★★ 等待重试期间切会话 ⇒ 不落盘到新会话', async () => {
    const { host, st } = await mk({ chatId: 'chat_A' });
    let calls = 0;
    host.context.saveChat = async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
    };
    const p = st._debouncedSaveChat(true);
    await new Promise((r) => setTimeout(r, 120));
    host.context.chatId = 'chat_B';       // 真切会话（不是手写字段：getContext() 会重算身份）
    await p;
    assert.equal(calls, 1, '★ 后续重试必须被身份守卫拦下（否则新会话的存档被旧会话的数据覆盖）');
});

test('v318 D2. ★★ 一次失败不得污染队列：下一次调用照常落盘', async () => {
    const { host, st } = await mk({ saveChatFails: 4 });
    await st._debouncedSaveChat(true);
    const before = host.saveChatCalls();
    await st._debouncedSaveChat(true);            // 第 5 次起宿主成功
    assert.equal(host.saveChatCalls() - before, 1, '下一次调用应恰好一次成功');
});

/* ══════════════ E 负控制（真源码破坏 → 破坏副本上重跑**同款真判据**） ══════════════ */
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

test('v318 N1. ★★★ 破坏「退避表」（把四档压成两档）⇒ B1 同款判据必须转红', async () => {
    const anchor = 'const retryDelays = [0, 350, 900, 1800];';
    assert.equal(STORAGE_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = (s) => {
        const out = s.replace(anchor, 'const retryDelays = [0, 350];');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    };
    const { host, st } = await mk({ saveChatFails: 99, mutate: broken });
    let threw = false;
    try { await st._debouncedSaveChat(true); } catch (_e) { threw = true; }
    assert.equal(threw, false, '（破坏后仍不得外抛）');
    assert.throws(() => assert.equal(host.saveChatCalls(), RETRY_DELAYS.length, '重试次数必须等于四档表长度'),
        isAssertionFailure, 'B1 同款判据在破坏副本上必须抛（2 次 ≠ 4 次）');
    assert.equal(host.saveChatCalls(), 2, '（破坏已生效：只重试 2 次）');
});

test('v318 N2. ★★★ 破坏「串行队列」（每调用自起一条链，不再串到同一个队列尾）⇒ C1 同款判据必须转红', async () => {
    const anchor = 'this._chatSaveQueue = this._chatSaveQueue\n                        .catch(() => undefined)\n                        .then(async () => {';
    assert.equal(STORAGE_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = (s) => {
        /* 破坏形态的选择（首版栽过）：最初改成 `(async () => { … })();`，那是**脱手执行** ——
         *   调用方 await 的 `_chatSaveQueue` 仍是已 resolve 的旧值，于是整个 `Promise.all` 在
         *   保存体跑完之前就返回，读数变成「在飞 0 个」。那不叫「串行被破坏」，那叫「等待被切断」，
         *   判据读到的是一个更早结束的世界。
         *   真正的「去掉串行」形态是：**每个调用各自起一条链**（不再挂到同一个队列尾），
         *   于是同一时刻真的会有多个 saveChat 在飞 —— 这正是 EPERM rename 撞车的形态。 */
        const out = s.replace(anchor, 'this._chatSaveQueue = Promise.resolve().then(async () => {');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    };
    const { host, st } = await mk({ mutate: broken });
    let inFlight = 0, maxInFlight = 0, calls = 0;
    host.context.saveChat = async () => {
        calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 40));
        inFlight -= 1;
    };
    await Promise.all([st._debouncedSaveChat(true), st._debouncedSaveChat(true), st._debouncedSaveChat(true)]);
    assert.equal(calls, 3, '（破坏后三次仍都会跑，只是不再互相排队）');
    assert.throws(() => assert.equal(maxInFlight, 1, '同时在飞必须恒为 1'), isAssertionFailure,
        'C1 同款判据在破坏副本上必须抛');
    assert.ok(maxInFlight > 1, '（破坏已生效：同时在飞出现 ' + maxInFlight + ' 个）');
});

test('v318 N3. ★★★ 破坏「身份守卫」（切会话后仍继续重试）⇒ D1 同款判据必须转红', async () => {
    const anchor = 'if (!latestContext || this.currentConversationId !== queuedConversationId) return;';
    assert.equal(STORAGE_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = (s) => {
        const out = s.replace(anchor, 'if (!latestContext) return;');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    };
    const { host, st } = await mk({ chatId: 'chat_A', mutate: broken });
    let calls = 0;
    host.context.saveChat = async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
    };
    const p = st._debouncedSaveChat(true);
    await new Promise((r) => setTimeout(r, 120));
    host.context.chatId = 'chat_B';
    await p;
    assert.throws(() => assert.equal(calls, 1, '切会话后不得继续重试'), isAssertionFailure,
        'D1 同款判据在破坏副本上必须抛');
    assert.equal(calls, 2, '（破坏已生效：第 2 次重试真的打出去了 → 会写到新会话）');
});

/* ══════════════ F 版本锚 ══════════════ */
test('v318 F1. ★ 版本五源同源（入口 / manifest / package / update-log.latest / versions 首键）', () => {
    const idx = read('index.js');
    const ver = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.ok(ver, '入口版本常量在场');
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    assert.equal(JSON.parse(read('package.json')).version, ver, 'package 同源');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, ver, 'update-log.latest 同源');
    assert.equal(Object.keys(ul.versions)[0], ver, '★ versions 首键即当前版本');
});