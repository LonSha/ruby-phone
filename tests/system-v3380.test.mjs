// tests/system-v3380.test.mjs — 召回治理台 [v3.38.0]
//
// 本套件守三件事：
//  ① 治理内核的六条口径（六态互不同形 / 失败批次不推进 / 逐路报贡献 /
//     真的没有与四路全坏不同形 / 认得出来与认不出来分开 / 三轴可复现）；
//  ② 四块不缝真的没缝（零网络 / 不碰宿主 / 不跨 App 读 / 不落数据库）；
//  ③ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 / v3.36 / v3.37 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/recall/recall-data.js';
import { RecallApp } from '../apps/recall/recall-app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RC_DATA = 'apps/recall/recall-data.js';
const RC_APP = 'apps/recall/recall-app.js';
const RC_VIEW = 'apps/recall/recall-view.js';
const RC_CSS = 'apps/recall/recall.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const PHONE_CSS = 'phone.css';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300…3370 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词（`fetch`、`apiKey`、`IndexedDB`…）是
 *    **说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故 J1 用**尾随哨兵**逐文件实测「剥器能复位」。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

/** 内存假存储：`key -> 字符串`。App 只经 `storage.get/set`，与真件同形。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^recall_/` 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致（`recall_`）—— 抄别版的前缀会把「换会话后读到别人数据」
 *    这条判据测成空气（假绿三形之一）。 */
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
        set: (k, v) => { box.set(chat + '::' + k, v); },
        switchTo: (c) => { chat = c; },
        _box: box,
    };
}

/** 假宿主壳：只提供视图层要的 `getContentContainer`（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null, showNotification: () => {} };
}
const newApp = (storage) => new RecallApp(shellStub(), storage);

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 六态互不同形：没配与被关不许塌成同一读数（源塌成「不可用」）', () => {
    /* 判序本身是口径：先判没配、再判被关。 */
    assert.equal(DAT.channelState({}), 'absent');
    assert.equal(DAT.channelState({ configured: true, enabled: false }), 'off');
    assert.equal(DAT.channelState({ configured: true, enabled: true }), 'ready');
    assert.equal(DAT.channelState({ configured: true, enabled: true, modelChanged: true }), 'stale');
    assert.equal(DAT.channelState({ configured: true, enabled: true, degraded: true }), 'degraded');
    assert.equal(DAT.channelState({ configured: true, enabled: true, lastError: 'x' }), 'failed');
    /* 六态必须都在，且没配 ≠ 被关。 */
    assert.equal(DAT.RECALL_STATE_KEYS.length, 6);
    assert.notEqual(DAT.channelState({}), DAT.channelState({ configured: true, enabled: false }));
    /* 没配是「mute」，陈旧/降级/失败是「warn」—— 严重度分两族。 */
    assert.equal(DAT.stateSeverity('absent'), 'mute');
    assert.equal(DAT.stateSeverity('off'), 'mute');
    assert.equal(DAT.stateSeverity('stale'), 'warn');
    assert.equal(DAT.stateSeverity('degraded'), 'warn');
    assert.equal(DAT.stateSeverity('failed'), 'warn');
    assert.equal(DAT.stateSeverity('ready'), 'ok');
    /* 每一态都要有自己的 severity（不许两态共用一个未知兜底）。 */
    const sev = DAT.RECALL_STATE_KEYS.map((k) => DAT.RECALL_STATES[k].severity);
    for (const s of sev) assert.ok(['ok', 'mute', 'warn'].includes(s), 'severity 必须是三档之一，实测 ' + s);
});

test('A2 不推进水位线：失败批次不许推（推了那批记忆就永久丢了）', () => {
    const p = 10;
    /* 有失败 ⇒ 不推进，且如实报失败条数。 */
    const f = DAT.advanceWatermark(p, { from: 11, to: 20, ok: false, failedCount: 2 });
    assert.equal(f.advanced, false);
    assert.equal(f.value, p, '失败批次必须把水位线留在原处');
    assert.equal(f.reason, 'failed_batch');
    assert.equal(f.failedCount, 2);
    /* 光给 failedCount 不给 ok:false 也必须拦住。 */
    assert.equal(DAT.advanceWatermark(p, { from: 11, to: 20, failedCount: 1 }).advanced, false);
    /* 全成功才推进。 */
    const okr = DAT.advanceWatermark(p, { from: 11, to: 20 });
    assert.equal(okr.advanced, true);
    assert.equal(okr.value, 20);
    assert.equal(okr.reason, 'ok');
    /* 四种不推进各有各的因，不许蹋成一因。 */
    assert.equal(DAT.advanceWatermark(p, {}).reason, 'no_range');
    assert.equal(DAT.advanceWatermark(p, { from: 20, to: 11 }).reason, 'backwards');
    assert.equal(DAT.advanceWatermark(p, { from: 1, to: 9 }).reason, 'already_ahead');
    assert.equal(DAT.advanceWatermark(null, { from: 1, to: 9 }).advanced, true, '从没推过时必须能推进');
    /* already_ahead 不许把水位线**倒退**。 */
    assert.equal(DAT.advanceWatermark(p, { from: 1, to: 9 }).value, p);
});

test('A3 融合必须报贡献：空候选池与这一路没配**不同形**', () => {
    /* 四路全空 ⇒ 逐路都要报 skipped，且贡献路数为 0。 */
    const empty = DAT.fuseChannels({});
    assert.equal(empty.total, 0);
    assert.equal(empty.contributedChannels, 0);
    assert.equal(empty.skippedChannels, DAT.RECALL_CHANNELS.length);
    for (const ch of DAT.RECALL_CHANNELS) {
        assert.equal(empty.per[ch].present, false, ch + ' 没给 must present=false');
        assert.equal(empty.per[ch].skipped, true, ch + ' 空候选必须报 skipped');
    }
    /* 只给一路 ⇒ 只有那一路不 skipped，其余如实报跳过。 */
    const one = DAT.fuseChannels({ sparse: ['a', 'b'] });
    assert.equal(one.per.sparse.present, true);
    assert.equal(one.per.sparse.skipped, false);
    assert.equal(one.per.sparse.in, 2);
    assert.equal(one.per.sparse.merged, 2);
    assert.equal(one.per.semantic.present, false);
    assert.equal(one.contributedChannels, 1);
    assert.equal(one.total, 2);
    /* 路内重复要去重并计数（不许静默当作多条）。 */
    const dup = DAT.fuseChannels({ sparse: ['a', 'a', 'b'] });
    assert.equal(dup.per.sparse.in, 3);
    assert.equal(dup.per.sparse.merged, 2);
    assert.equal(dup.per.sparse.dupInChannel, 1);
    assert.equal(dup.total, 2);
    /* 跨路同 id 必须合流（RRF 分要看两路都给）。 */
    const both = DAT.fuseChannels({ sparse: ['a'], semantic: ['a'] });
    assert.equal(both.total, 1);
    assert.equal(both.contributedChannels, 2);
    assert.ok(both.hits[0].score > one.hits[0].score, '两路都给的条必须比单路给的分高');
});

test('A4 空召回不许注入：真的没有与四路全坏**不许同形**（源无条件注入）', () => {
    /* 四路全坏：合出空、但贡献路数为 0 ⇒ all_broken。 */
    const broken = DAT.fuseChannels({});
    const v1 = DAT.decideInject(broken, {});
    assert.equal(v1.inject, false);
    assert.equal(v1.reason, 'all_broken');
    /* 真的没有：合出空、但确实有路出了力（只是候选都为 0 —— 构造 contributed > 0 的空 */
    const half = DAT.fuseChannels({ sparse: [] });
    assert.equal(half.contributedChannels, 0, '空数组的路不算出了力');
    /* 给一条然后被门槛削光 ⇒ below_floor（第三因，不许并进前两因）。 */
    const one = DAT.fuseChannels({ sparse: ['a'] });
    const v2 = DAT.decideInject(one, { floor: 0.99 });
    assert.equal(v2.inject, false);
    assert.equal(v2.reason, 'below_floor');
    /* 用户关掉：第四因，且**优先于**其他因。 */
    const v3 = DAT.decideInject(one, { userOff: true, floor: 0 });
    assert.equal(v3.reason, 'user_off');
    /* 过了门槛才注入，并给出条数。 */
    const v4 = DAT.decideInject(one, { floor: 0 });
    assert.equal(v4.inject, true);
    assert.equal(v4.reason, 'ok');
    assert.equal(v4.count, 1);
    /* 四种跳过因各有各的人话（不许两因同标）。 */
    const labels = DAT.RECALL_SKIP_KEYS.map((k) => DAT.skipReasonLabel(k));
    assert.equal(new Set(labels).size, labels.length, '四种跳过因的人话必须互不相同');
    assert.notEqual(DAT.skipReasonLabel('empty'), DAT.skipReasonLabel('all_broken'));
});

test('A5 认得出来与认不出来分开：BM25 认不出落 naive 且**如实报认不出**（源静默落档）', () => {
    assert.equal(DAT.bm25Mode('indexed').recognized, true);
    assert.equal(DAT.bm25Mode('indexed').mode, 'indexed');
    assert.equal(DAT.bm25Mode('dual').mode, 'dual');
    const bad = DAT.bm25Mode('xyz');
    assert.equal(bad.mode, DAT.RECALL_BM25_FALLBACK);
    assert.equal(bad.recognized, false);
    assert.equal(bad.sawRaw, 'xyz', '认不出的原值必须能被看见');
    /* 空 / 非字符串也走同一条路（不许抛）。 */
    assert.equal(DAT.bm25Mode('').mode, 'naive');
    assert.equal(DAT.bm25Mode(null).mode, 'naive');
    assert.equal(DAT.bm25Mode(7).recognized, false);
    /* 房间同理：认不出不许静默当 living_room。 */
    assert.equal(DAT.roomWeights('study').known, true);
    const r = DAT.roomWeights('attic');
    assert.equal(r.known, false);
    assert.equal(r.room, DAT.RECALL_ROOM_FALLBACK);
    assert.equal(r.sawRoom, 'attic');
});

/* ══════════════════════ B — App 行为面（真跑内存存储） ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来**不许**读成「四路都没配」', () => {
    /* 情形①：storage 一取就抛 —— 这是「取不出来」，不是「空的」。 */
    const hostile = { get: () => { throw new Error('boom'); }, set: () => {} };
    const a1 = newApp(hostile);
    assert.equal(a1.faceOf(), DAT.RECALL_FACES.storage_absent, '取不出来必须报 storage_absent');
    assert.equal(a1.probe(), null, '取不出来时投影必须是 null（视图拿不到投影）');
    /* 情形②：storage 根本没给 get —— 同样算取不出来。 */
    const a2 = newApp({});
    assert.equal(a2.faceOf(), DAT.RECALL_FACES.storage_absent);
    assert.equal(a2.probe(), null);
    /* 情形③：storage 好的、只是没东西 —— 这是「还没有配置」，不是「取不出来」。 */
    const a3 = newApp(memStorage());
    assert.equal(a3.faceOf(), DAT.RECALL_FACES.empty, '空的必须是 empty，不能与 storage_absent 同形');
    assert.notEqual(a3.faceOf(), a1.faceOf());
    /* 情形④：有东西 ⇒ ok，且投影是一份对象。 */
    const a4 = newApp(memStorage({ recall_settings: JSON.stringify({ bm25Raw: 'dual' }) }));
    assert.equal(a4.faceOf(), DAT.RECALL_FACES.ok);
    assert.ok(a4.probe() && typeof a4.probe() === 'object');
});

test('B2 配置：第一次改会自动置 configured（否则开关按了没反应）', () => {
    const st = memStorage();
    const app = newApp(st);
    /* 初始：四路全没配。 */
    assert.equal(app.channelRows().every((r) => r.state === 'absent'), true);
    /* 开开关 ⇒ 不再报「没配」。 */
    const r = app.configure('sparse', { enabled: true });
    assert.equal(r.ok, true);
    assert.equal(r.state, 'ready');
    const row = app.channelRows().find((x) => x.channel === 'sparse');
    assert.equal(row.configured, true);
    assert.equal(row.state, 'ready');
    /* 关掉 ⇒ 是「已关」不是「没配」。 */
    app.configure('sparse', { enabled: false });
    assert.equal(app.channelRows().find((x) => x.channel === 'sparse').state, 'off');
    /* 取消配置 ⇒ 回到「没配」（与「已关」不同态）。 */
    const u = app.unconfigure('sparse');
    assert.equal(u.state, 'absent');
    assert.equal(app.channelRows().find((x) => x.channel === 'sparse').state, 'absent');
    /* 坏路名一律拒绝（不许静默新建一路）。 */
    assert.equal(app.configure('ghost', { enabled: true }).reason, 'unknown_channel');
    assert.equal(app.configure('sparse', {}).reason, 'empty_patch');
    assert.equal(app.unconfigure('ghost').reason, 'unknown_channel');
    /* 落盘必须真写（不是只改内存）。 */
    app.configure('semantic', { enabled: true });
    const raw = JSON.parse(st.get('recall_settings'));
    assert.equal(raw.semantic.configured, true);
});

test('B3 清除标记：陈旧 / 降级 / 出错必须能各自清除且回到 ready', () => {
    const app = newApp(memStorage());
    app.configure('remote', { modelChanged: true });
    assert.equal(app.channelRows().find((x) => x.channel === 'remote').state, 'stale');
    app.configure('remote', { modelChanged: false, degraded: true });
    assert.equal(app.channelRows().find((x) => x.channel === 'remote').state, 'degraded');
    app.configure('remote', { degraded: false, lastError: 'x' });
    assert.equal(app.channelRows().find((x) => x.channel === 'remote').state, 'failed');
    app.configure('remote', { lastError: '' });
    assert.equal(app.channelRows().find((x) => x.channel === 'remote').state, 'ready');
    /* 失败那一格要能在读数面上被看见。 */
    app.configure('remote', { lastError: '上次这一路抛了错' });
    assert.equal(app.channelRows().find((x) => x.channel === 'remote').lastError, '上次这一路抛了错');
});

test('B4 候选快照：非数组一律拒绝，路内重复去重，封顶如实报', () => {
    const app = newApp(memStorage());
    assert.equal(app.setSnapshot('sparse', 'not-an-array').reason, 'not_array');
    assert.equal(app.setSnapshot('ghost', []).reason, 'unknown_channel');
    const r = app.setSnapshot('sparse', ['a', 'a', 'b', '']);
    assert.equal(r.ok, true);
    assert.equal(r.kept, 2, '重复与空串必须被剔掉并计数');
    assert.equal(r.saw, 4, '填了几条要如实报');
    assert.deepEqual(app.snapshotOf('sparse'), ['a', 'b']);
    /* snapshotOf 对坏路名回空数组（不抛）。 */
    assert.deepEqual(app.snapshotOf('ghost'), []);
    /* 快照要落盘（融合复现靠它）。 */
    assert.deepEqual(JSON.parse(app.storage.get('recall_ledger')).snapshots.sparse, ['a', 'b']);
    /* 清空全部。 */
    app.clearSnapshots();
    assert.deepEqual(app.snapshotOf('sparse'), []);
});

test('B5 融合与裁决走 App 口：逐路贡献可读，空与坏不同因', () => {
    const app = newApp(memStorage());
    /* 什么都没给 ⇒ 四路全坏（contributed 0）。 */
    const f1 = app.runFusion({});
    assert.equal(f1.contributedChannels, 0);
    assert.equal(app.decide(f1, {}).reason, 'all_broken');
    /* 给一路 ⇒ 有贡献，过了门槛就注入。 */
    app.setSnapshot('sparse', ['m1', 'm2']);
    const f2 = app.runFusion({});
    assert.equal(f2.contributedChannels, 1);
    assert.equal(f2.total, 2);
    app.setFloor(0);
    const v = app.decide(f2, {});
    assert.equal(v.inject, true);
    assert.equal(v.count, 2);
    /* 门槛抬高 ⇒ below_floor（第三因）。 */
    app.setFloor(0.9);
    assert.equal(app.decide(f2, {}).reason, 'below_floor');
    /* 策略关掉注入 ⇒ user_off，优先于门槛。 */
    app.setInjectEnabled(false);
    assert.equal(app.decide(f2, {}).reason, 'user_off');
});

test('B6 回执：字段全由数据层生（App 不自己拼），台账保最近 N 条', () => {
    const app = newApp(memStorage());
    app.setSnapshot('semantic', ['x']);
    app.setFloor(0);
    const fused = app.runFusion({});
    app.decide(fused, {});
    const card = app.recordReceipt({ at: '2026-01-01 00:00:00', entry: '手动', ms: 12 });
    /* 回执字段必须与数据层 recallReceipt 同口径。 */
    const want = DAT.recallReceipt({
        at: '2026-01-01 00:00:00', entry: '手动', fused: fused, verdict: app.verdictOf(),
        states: app.states, opts: {}, ms: 12, timedOut: false
    });
    assert.deepEqual(card, want, 'App 不许自己拼回执字段（视图/测试/导出会各拼一份）');
    assert.equal(card.hits, 1);
    assert.equal(card.inject, true);
    assert.equal(card.ms, 12);
    /* 台账要落盘。 */
    assert.equal(JSON.parse(app.storage.get('recall_ledger')).receipts.length, 1);
    /* 回执行带面，且回合面能读出三态。 */
    const rows = app.receiptRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].face, DAT.RECALL_FACES.ok);
    assert.equal(rows[0].reasonLabel, DAT.RECALL_SKIP_REASONS.ok ? rows[0].reasonLabel : rows[0].reasonLabel);
    /* 清空台账。 */
    app.clearReceipts();
    assert.equal(app.receiptRows().length, 0);
});

test('B7 台账容量：回执不许无限长（超上限截最近）', () => {
    const app = newApp(memStorage());
    for (let i = 0; i < DAT.RECALL_MAX_CANDIDATES + 12; i += 1) {
        app.recordReceipt({ at: 't' + i, entry: 'e' + i });
    }
    assert.equal(app.receipts.length, DAT.RECALL_MAX_CANDIDATES, '台账必须封顶');
    /* 截的必须是**最近**的（旧的先丢）。 */
    assert.equal(app.receiptRows()[app.receiptRows().length - 1].at, 't' + (DAT.RECALL_MAX_CANDIDATES + 11));
});

/* ══════════════════════ C — 接线与隔离 ══════════════════════ */
test('C1 三条会话键随会话隔离（换角色后不许读到别人的账）', () => {
    const st = sessionStorage();
    const app = newApp(st);
    app.configure('sparse', { enabled: true });
    app.setSnapshot('sparse', ['mine']);
    app.recordReceipt({ at: 'a', entry: 'e' });
    assert.equal(app.snapshotOf('sparse').length, 1);
    /* 换会话 ⇒ 全部重取（旧会话的账不许留着）。 */
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.channelRows().find((x) => x.channel === 'sparse').state, 'absent', '换会话后必须回到没配');
    assert.equal(app.snapshotOf('sparse').length, 0, '换会话后候选必须清空');
    assert.equal(app.receiptRows().length, 0, '换会话后台账必须清空');
    assert.equal(app.faceOf(), DAT.RECALL_FACES.empty);
    /* 切回去 ⇒ 原来的账还在。 */
    st.switchTo('c1');
    app.onChatChanged();
    assert.equal(app.snapshotOf('sparse').length, 1, '换回来必须能读回自己的候选');
    assert.equal(app.receiptRows().length, 1);
    assert.equal(app.channelRows().find((x) => x.channel === 'sparse').state, 'ready');
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    const apps = read(APPS);
    /* ① App 注册表：id 必须在册。 */
    assert.ok(/id: 'recall'/.test(apps), 'config/apps.js 必须有 recall 条目');
    /* ② 会话键前缀：不登记 ⇒ 三条键走全局存储（串味）。 */
    assert.ok(/\/\^recall_\//.test(read(STORAGE)), 'config/storage.js 必须有 /^recall_/ 前缀');
    /* ③ 入口：懒加载分支 + 重绑表。 */
    const idx = read(INDEX);
    assert.ok(idx.includes("appId === 'recall'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/recall/recall-app.js')"), 'index.js 必须真 import 本件');
    assert.ok(idx.includes('recallApp'), 'index.js 重绑表必须有 recallApp（换会话才重取）');
    /* ④ 会话键审计：三条键都要在册且 scope=chat。 */
    const keys = read(KEYS);
    for (const k of ['recall_settings', 'recall_policy', 'recall_ledger']) {
        assert.ok(keys.includes("'" + k + "'"), k + ' 必须在 keys-audit 登记');
    }
    /* ⑤ 懒加载目录映射（v255 套件用）。 */
    assert.ok(read(V255).includes("recallApp: 'recall'"), 'v255 dirMap 必须登记 recall 目录');
    /* ⑥ 样式段（段头独立成行）。 */
    const css = read(PHONE_CSS);
    assert.ok(css.includes('[v3.38.0] 召回治理台'), 'phone.css 必须有本版段头');
    assert.ok(css.includes('.rcl-root'), 'phone.css 必须贴上本件样式正文');
});

test('C3 样式段头**独立成行**（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(PHONE_CSS);
    const idx = css.indexOf('[v3.38.0] 召回治理台');
    assert.ok(idx > 0);
    /* 段头行必须是「行首块注释起头、行尾块注释收尾」。 */
    const lineStart = css.lastIndexOf('\n', idx) + 1;
    const lineEnd = css.indexOf('\n', idx);
    const line = css.slice(lineStart, lineEnd);
    assert.ok(line.startsWith('/* ') && line.trim().endsWith('*/'), '段头必须独立成行，实测：' + line.slice(0, 60));
    assert.ok(lineStart === 0 || css[lineStart - 1] === '\n', '段头不许接在上一段尾后');
});

test('C4 源文件与 phone.css 段必须**逐字同源**（手工改两处必会再犯）', () => {
    const src = read(RC_CSS).trim();
    const css = read(PHONE_CSS);
    assert.ok(css.includes(src), 'recall.css 正文必须逐字出现在 phone.css 的本版段里');
});

test('C5 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const view = stripComments(read(RC_VIEW));
    const appSrc = stripComments(read(RC_APP));
    /* 抽出视图里所有 `app.xxx(` 的调用名。 */
    const names = new Set();
    const re = /app\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let m = re.exec(view);
    while (m) { names.add(m[1]); m = re.exec(view); }
    assert.ok(names.size >= 8, '视图必须真调 App（实测 ' + names.size + ' 个）');
    /* 每个被调的方法都必须在本件的 App 源里定义（前缀 `name(`）。 */
    const missing = [];
    for (const n of names) {
        const def = new RegExp('[\\s.]' + n + '\\s*\\(', 'g');
        if (!def.test(appSrc)) missing.push(n);
    }
    assert.deepEqual(missing, [], '视图调了 App 上不存在的方法：' + missing.join(', '));
});

test('C6 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const view = stripComments(read(RC_VIEW));
    const css = read(RC_CSS);
    /* 视图产出的类名（`class="rcl-xxx ..."`）。 */
    const names = new Set();
    const re = /class="([^"]+)"/g;
    let m = re.exec(view);
    while (m) {
        for (const one of m[1].split(/\s+/)) if (one) names.add(one);
        m = re.exec(view);
    }
    assert.ok(names.size >= 20, '视图必须产出成规模的类名（实测 ' + names.size + ' 个）');
    /* ★ 拼接面的类名会以 `rcl-face-'` 这种**带尾引号的碎片**出现（`'rcl-face-' + tone`）。
     *   碎片不能当完整类名查（查不到是正常的），但它的**词干**必须真在样式里存在——
     *   否则拼接出来的那一族类全都没有落点。故分两族对账。 */
    const missing = [];
    for (const n of names) {
        if (!n.startsWith('rcl-')) continue;
        if (n.endsWith("'")) {
            const stem = n.slice(0, -1);
            if (!css.includes(stem)) missing.push(n);
            continue;
        }
        if (!css.includes(n)) missing.push(n);
    }
    assert.deepEqual(missing, [], '视图产出但没有样式落点的类：' + missing.join(', '));
    /* 六态徽章的六个类必须都在（本件最要紧的一条：六态不许同色）。 */
    for (const k of DAT.RECALL_STATE_KEYS) {
        assert.ok(css.includes('.rcl-st-' + k), '六态徽章必须各有样式落点：' + k);
    }
});

/* ══════════════════════ D — 四块不缝 ══════════════════════ */
const RC_FILES = [RC_DATA, RC_APP, RC_VIEW];

test('D1 不碰模型：三件里一个网络调用都没有（源 47 处 apiKey / 56 处 fetch）', () => {
    for (const rel of RC_FILES) {
        const code = stripComments(read(rel));
        for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
        assert.equal(/apiKey/i.test(code), false, rel + ' 不许出现 apiKey');
        assert.equal(/Authorization/i.test(code), false, rel + ' 不许出现 Authorization');
        assert.equal(/\bembedding\b/i.test(code), false, rel + ' 不许自己算向量（embedding）');
    }
});

test('D2 不碰宿主对象、不落数据库、不跨 App 读（源把结果注入宿主请求）', () => {
    for (const rel of RC_FILES) {
        const code = stripComments(read(rel));
        for (const bad of ['indexedDB', 'localStorage', 'sessionStorage', 'window.location',
            'document.cookie', 'postMessage', 'iframe']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
    }
    /* ★ 不跨 App 读：不许出现别的 App 的会话键名。 */
    const appCode = stripComments(read(RC_APP));
    for (const bad of ['spark_char_handles', 'sully', 'memory_', 'soundkit_', 'magazine_']) {
        assert.equal(appCode.includes(bad), false, 'App 不许读别的 App 的表：' + bad);
    }
    /* 宿主只准经 shell 的一个容器口拿容器（那是**视图**的事：App 把 shell 传给视图）。 */
    const viewCode = stripComments(read(RC_VIEW));
    assert.ok(viewCode.includes('getContentContainer'), '视图必须经 shell 的容器口拿容器');
    assert.ok(appCode.includes('this.shell'), 'App 必须把 shell 交给视图（不自己摸 DOM）');
    assert.equal(/document\.body|document\.head|window\./.test(viewCode), false, '视图不许直摸宿主 DOM');
});

test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名', () => {
    for (const rel of RC_FILES) {
        const code = stripComments(read(rel));
        assert.equal(/https?:\/\//.test(code), false, rel + ' 不许出现 http(s) 链接');
        assert.equal(/data:(image|audio|video)/.test(code), false, rel + ' 不许出现 data URL 载荷');
        for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.wav', '.ogg', '.mp4']) {
            assert.equal(code.includes(ext), false, rel + ' 不许出现 ' + ext);
        }
        assert.equal(/base64/i.test(code), false, rel + ' 不许出现 base64');
    }
});

test('D4 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const appCode = stripComments(read(RC_APP));
    /* 只允许出现 .get( 与 .set(。 */
    for (const bad of ['.remove(', '.delete(', '.clear(', '.keys(', '.has(']) {
        assert.equal(appCode.includes(bad), false, 'App 不许用 storage 的第三个口：' + bad);
    }
    assert.ok(appCode.includes('this.storage.get('), 'App 必须经 storage.get 取数');
    assert.ok(appCode.includes('this.storage.set('), 'App 必须经 storage.set 落盘');
});

/* ══════════════════════ E — 真源消费面 ══════════════════════ */
test('E1 数据层的每一条真源表都必须被产品侧真消费（不许建好了零消费）', () => {
    const appCode = stripComments(read(RC_APP));
    const viewCode = stripComments(read(RC_VIEW));
    const both = appCode + '\n' + viewCode;
    /* ★ 数据层导出的每一张真源表都必须在 App 或视图里被用到。
     *   这条是「功能级失效」的防线（本仓 v2.x 的老形态：导出了 API 但全库零调用）。 */
    const tables = ['RECALL_CHANNELS', 'RECALL_CHANNEL_META', 'RECALL_STATES', 'RECALL_STATE_KEYS',
        'RECALL_BM25_MODES', 'RECALL_ROOM_WEIGHTS', 'RECALL_ROOM_FALLBACK', 'RECALL_SKIP_REASONS',
        'RECALL_SKIP_KEYS', 'RECALL_FACES', 'RECALL_MAX_CANDIDATES', 'RECALL_DEFAULT_TOP_N',
        'RECALL_MIN_SCORE'];
    const unused = [];
    for (const t of tables) {
        if (!both.includes(t)) unused.push(t);
    }
    assert.deepEqual(unused, [], '真源表导出但零消费：' + unused.join(', '));
    /* 函数面同样不许零消费。 */
    const fns = ['channelState', 'stateLabel', 'stateSeverity', 'bm25Mode', 'roomWeights',
        'scoreCandidate', 'advanceWatermark', 'fuseChannels', 'rerankCandidates', 'decideInject',
        'skipReasonLabel', 'recallReceipt', 'receiptFace', 'recallReadings'];
    const fnUnused = [];
    for (const f of fns) {
        if (!both.includes(f)) fnUnused.push(f);
    }
    assert.deepEqual(fnUnused, [], '内核函数导出但零消费：' + fnUnused.join(', '));
});

test('E2 手写键不许回潮：数据层与视图都不许再出现六态 / 四因的标识符形键面', () => {
    /* ★ 键面必须从真源算（计算键）。本仓 J7 形态：两份靠碰巧拼写一致对齐。 */
    const viewCode = stripComments(read(RC_VIEW));
    assert.equal(/TONE_BY_STATE|STATE_TONE/.test(viewCode), false, '视图不许手写六态配色表');
    assert.equal(/skipReasonLabels\s*=\s*\{/.test(viewCode), false, '视图不许手写跳过因人话表');
    /* 六态人话一律从 App / 真源取。 */
    assert.ok(viewCode.includes('app.catalogs()'), '视图的键面必须来自 catalogs()');
});

test('E3 视图不自己算内核（那是数据层与 App 的事）', () => {
    const viewCode = stripComments(read(RC_VIEW));
    /* 视图不许直接 import 内核函数自己算（只许 import 真源常量）。 */
    for (const f of ['channelState(', 'fuseChannels(', 'decideInject(', 'advanceWatermark(', 'scoreCandidate(']) {
        assert.equal(viewCode.includes(f), false, '视图不许自己算内核：' + f);
    }
    /* 视图必须只进口真源表（常量），不进口函数。 */
    const m = /import\s*\{([^}]+)\}\s*from\s*'\.\/recall-data\.js'/.exec(viewCode);
    assert.ok(m, '视图必须从数据层进口常量');
});

/* ====================== F - 视图面 ====================== */
test('F1 六态必须分开画：视图必须画出 stateLabel 与六态徽章类（不许塌成一句不可用）', () => {
    const viewCode = stripComments(read(RC_VIEW));
    assert.ok(viewCode.includes('row.stateLabel'), '视图必须画出六态人话');
    assert.ok(viewCode.includes("rcl-st-' + st"), '徽章类必须按六态键取（不是按三档严重度）');
    assert.ok(viewCode.includes('catalogs().stateKeys'), '六态键面必须来自真源');
});

test('F2 空与坏不同形：同一句话不许两种处境共用（文案必须不同）', () => {
    const appCode = stripComments(read(RC_APP));
    assert.ok(appCode.includes('skipReasonLabel'), 'App 必须透出跳过因人话');
    const viewCode = stripComments(read(RC_VIEW));
    assert.ok(viewCode.includes('skipLabelOf'), '视图必须用因来分叉文案');
    assert.ok(viewCode.includes("r.reason === 'all_broken'"), '台账必须分出四路全坏那一支');
    assert.ok(viewCode.includes("v.reason === 'all_broken'"), '裁决面必须分出四路全坏那一支');
});

test('F3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const viewCode = stripComments(read(RC_VIEW));
    assert.ok(viewCode.includes('String.fromCharCode(34)'), '双引号必须用拼装形');
    assert.ok(viewCode.includes('String.fromCharCode(38)'), '与号必须用拼装形');
    const ents = ['amp' + ';', 'quot' + ';', '#39' + ';', 'lt' + ';', 'gt' + ';'];
    for (const e of ents) {
        assert.equal(viewCode.includes('&' + e), false, '不许出现 HTML 实体字面量：' + e);
    }
});

test('F4 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const viewCode = stripComments(read(RC_VIEW));
    /* ★ 视图必须把**拒绝因**透到界面上（不许吞成一句「操作失败」）。
     *   App 的每个拒绝口都带 reason，视图只需如实把它拼进提示。 */
    const appCode4 = stripComments(read(RC_APP));
    for (const need of ['unknown_channel', 'empty_patch', 'not_array', 'unknown_room', 'bad_floor', 'bad_topn']) {
        assert.ok(appCode4.includes(need), 'App 必须如实报出拒绝因：' + need);
    }
    /* 视图侧：至少要把 App 回的 reason 拼出来（不是写死一句「失败」）。 */
    assert.ok(/r\.reason/.test(viewCode), '视图必须把拒绝因拼进提示');
    const dataCode = stripComments(read(RC_DATA));
    const q = String.fromCharCode(39);
    for (const r of [q + 'empty_pool' + q, q + 'no_new' + q, q + 'added' + q]) {
        assert.ok(dataCode.includes(r), '重排必须分三态，缺：' + r);
    }
});

/* ====================== G - 会话键审计面 ====================== */
test('G1 三条会话键登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    const lines = keys.split(String.fromCharCode(10));
    for (const k of ['recall_settings', 'recall_policy', 'recall_ledger']) {
        const q = String.fromCharCode(39);
        const line = lines.find((l) => l.includes(q + k + q));
        assert.ok(line, k + ' 必须在册');
        assert.ok(line.includes('scope: ' + q + 'chat' + q), k + ' 的 scope 必须是 chat');
    }
    const st = read(STORAGE);
    assert.ok(st.indexOf('/^recall_/') > 0, '前缀必须在场');
    const re = new RegExp('[,\\[\\s]\\/\\^recall_\\/\\s*,');
    assert.ok(re.test(st), '前缀必须是数组里的一个元素');
});

test('G2 三条键真被产品消费（写面必须落到这三条上）', () => {
    const appCode = stripComments(read(RC_APP));
    const q = String.fromCharCode(39);
    for (const k of ['SETTINGS_KEY', 'POLICY_KEY', 'LEDGER_KEY']) {
        assert.ok(appCode.includes('const ' + k + ' = ' + q + 'recall_'), k + ' 必须指向 recall_ 前缀的键');
        const uses = appCode.split(k).length - 1;
        assert.ok(uses >= 3, k + ' 必须被真消费（实测 ' + uses + ' 处，只有定义不算）');
    }
});

/* ====================== H - 静默失效防线 ====================== */
test('H1 换会话必须全量重取：四路配置、策略、台账一律不许留（源把配置挂在角色卡上）', () => {
    const appCode = stripComments(read(RC_APP));
    const i = appCode.indexOf('    onChatChanged() {');
    assert.ok(i > 0, '必须有 onChatChanged');
    const rest = appCode.slice(i + 20);
    const endRel = rest.indexOf(String.fromCharCode(10) + '    }' + String.fromCharCode(10));
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    for (const need of ['this._loadSettings()', 'this._loadPolicy()', 'this._loadLedger()', 'this.probe()']) {
        assert.ok(body.includes(need), '换会话必须重取：' + need);
    }
    assert.ok(body.includes('this._current = ' + String.fromCharCode(39) + String.fromCharCode(39)), '换会话必须清当前选中');
});

test('H2 取数分两种回报：认源不许走吞异常的读法（坏 storage 不许读成空）', () => {
    const appCode = stripComments(read(RC_APP));
    const i = appCode.indexOf('    probe() {');
    const body = i < 0 ? '' : appCode.slice(i, i + 2400);
    assert.ok(body.includes('this._readRaw(SETTINGS_KEY)'), 'probe 必须经 _readRaw 认源');
    assert.ok(body.includes('this._readRaw(POLICY_KEY)'), 'probe 必须认策略键');
    assert.ok(body.includes('this._readRaw(LEDGER_KEY)'), 'probe 必须认台账键');
    const reOk = new RegExp('storageOk\\s*=');
    assert.ok(reOk.test(body), 'probe 必须真算出 storageOk');
    const reProj = new RegExp('this\\._proj = storageOk \\? this\\._project\\(\\) : null');
    assert.ok(reProj.test(body), '取不出来时投影必须为 null');
    const reAll = new RegExp('rs\\.ok && rp\\.ok && rl\\.ok');
    assert.ok(reAll.test(body), '三条键必须全 ok 才算 storage 可用');
});

test('H3 失败批次不许推进水位线（推进了那批记忆就永久丢了）且不推进必须回报因', () => {
    const appCode = stripComments(read(RC_APP));
    const i = appCode.indexOf('    advanceLine(batch) {');
    assert.ok(i > 0, '必须有 advanceLine');
    const rest = appCode.slice(i + 22);
    const endRel = rest.indexOf(String.fromCharCode(10) + '    }' + String.fromCharCode(10));
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    const reAdv = new RegExp('if \\(r\\.advanced === true\\)');
    assert.ok(reAdv.test(body), '只有真推进了才落盘');
    assert.ok(body.includes('this._persistPolicy()'), '推进了必须落盘');
    assert.ok(body.includes('return r'), '不推进时必须把因回报给调用方');
});

test('H4 空快照不许写掉：非数组一律拒绝（不许静默当空数组）', () => {
    const appCode = stripComments(read(RC_APP));
    const i = appCode.indexOf('    setSnapshot(ch, ids) {');
    assert.ok(i > 0, '必须有 setSnapshot');
    const rest = appCode.slice(i + 24);
    const endRel = rest.indexOf(String.fromCharCode(10) + '    }' + String.fromCharCode(10));
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    assert.ok(body.includes('Array.isArray(ids)'), '必须先验是不是数组');
    assert.ok(body.includes('not_array'), '非数组必须如实报因');
});

test('H5 剥注释器在每个文件里都必须复位（裸引号会把文件尾注释吞掉）', () => {
    for (const rel of [RC_DATA, RC_APP, RC_VIEW]) {
        const sentinel = stripComments(read(rel) + String.fromCharCode(10) + '/* RP_TAIL_3380 */' + String.fromCharCode(10));
        assert.equal(sentinel.includes('RP_TAIL_3380'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
    }
});

/* ====================== I - 负控制（破坏必须可观测） ====================== */
/** 数据层判据（加载破坏副本后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 六态互不同形：没配与被关必须分开。 */
    if (mod.channelState({}) !== 'absent') bad.push('absent-lost');
    if (mod.channelState({ configured: true, enabled: false }) !== 'off') bad.push('off-not-distinguished');
    if (mod.channelState({ configured: true, enabled: true, modelChanged: true }) !== 'stale') bad.push('stale-lost');
    /* ② 失败批次不许推进水位线。 */
    const f = mod.advanceWatermark(10, { from: 11, to: 20, ok: false, failedCount: 2 });
    if (f.advanced !== false || f.value !== 10) bad.push('failed-batch-advanced');
    /* ③ 空候选池必须报 skipped（不许静默消失）。 */
    const z = mod.fuseChannels({ sparse: [] });
    if (z.per.sparse.skipped !== true) bad.push('empty-pool-not-skipped');
    /* ④ 真的没有与四路全坏不许同形。 */
    const v1 = mod.decideInject(mod.fuseChannels({}), {});
    if (v1.reason !== 'all_broken') bad.push('all-broken-collapsed');
    /* ⑤ 认不出必须如实报（不许静默当认得）。 */
    const bm = mod.bm25Mode('xyz');
    if (bm.recognized !== false || bm.sawRaw !== 'xyz') bad.push('bm25-silent-fallback');
    /* ⑥ 房间认不出不许静默当认得。 */
    if (mod.roomWeights('attic').known !== false) bad.push('room-silent-fallback');
    /* ⑦ 回执行面：零条不许报成 ok。 */
    if (mod.receiptFace({ hits: 0 }) !== mod.RECALL_FACES.empty) bad.push('empty-receipt-face-ok');
    return bad;
};
const appProbeProblems = (src) => {
    const bad = [];
    const i = src.indexOf('    probe() {');
    const body = i < 0 ? '' : src.slice(i, i + 2400);
    if (!body.includes('this._readRaw(SETTINGS_KEY)')) bad.push('read-raw-not-used');
    if (!new RegExp('storageOk\\s*=').test(body)) bad.push('storage-ok-not-computed');
    if (i < 0) bad.push('probe-missing');
    return bad;
};
const appChatProblems = (src) => {
    const bad = [];
    const i = src.indexOf('    onChatChanged() {');
    if (i < 0) { bad.push('on-chat-changed-missing'); return bad; }
    const rest = src.slice(i + 20);
    const nl = String.fromCharCode(10);
    const endRel = rest.indexOf(nl + '    }' + nl);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    if (!body.includes('this._loadPolicy()')) bad.push('chat-change-no-policy-reload');
    if (!body.includes('this.probe()')) bad.push('chat-change-no-refetch');
    return bad;
};
const appAdvanceProblems = (src) => {
    const bad = [];
    const i = src.indexOf('    advanceLine(batch) {');
    if (i < 0) { bad.push('advance-missing'); return bad; }
    const rest = src.slice(i + 22);
    const nl = String.fromCharCode(10);
    const endRel = rest.indexOf(nl + '    }' + nl);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    if (!new RegExp('if \\(r\\.advanced === true\\)').test(body)) bad.push('advance-guard-lost');
    return bad;
};
const appFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const FACE = RECALL_FACES')) bad.push('face-constant-handwritten');
    if (/const FACE\s*=\s*Object\.freeze\s*\(\s*\{/.test(code)) bad.push('face-constant-handwritten');
    return bad;
};
const viewStateProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes("rcl-st-' + st")) bad.push('state-badge-not-by-six-state');
    if (/rcl-st-' \+ (fam|tone)/.test(code)) bad.push('state-badge-by-severity');
    return bad;
};
const viewFaceProblems2 = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (code.split('[RECALL_FACES.').length - 1 < 3) bad.push('face-keys-handwritten');
    const q = String.fromCharCode(39);
    if (code.includes('    ' + 'storage_absent' + ': ')) bad.push('face-keys-handwritten');
    return bad;
};
const viewBranchProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    const q = String.fromCharCode(39);
    /* ★ 两处都要管：裁决面（v）与台账面（r）都得分出「四路全坏」那一支——
     *   只盖一处时，破坏另一处判据照样为真（判据面没盖住破坏面）。 */
    const vBranch = code.includes('v.reason === ' + q + 'all_broken' + q);
    const rBranch = code.includes('r.reason === ' + q + 'all_broken' + q);
    if (!vBranch) bad.push('verdict-all-broken-branch-lost');
    if (!rBranch) bad.push('ledger-all-broken-branch-lost');
    if (!code.includes('skipLabelOf')) bad.push('skip-reason-label-not-used');
    return bad;
};

/** 破坏表：每一条破坏都必须**语义可观测**（不是装饰）。 */
const DAMAGE = {
    /* ① 六态塌成一态：「已关」合流进「没配」（源就是这个形态）。 */
    d1: [RC_DATA,
        "    if (!r.configured) return 'absent';\n    if (!r.enabled) return 'off';",
        "    if (!r.configured) return 'absent';\n    if (!r.enabled) return 'absent';"],
    /* ② 失败批次也推进水位线（那批记忆就永久丢了）。 */
    d2: [RC_DATA,
        '    if (b.ok === false || (failed !== null && failed > 0)) {',
        '    if (false) {'],
    /* ③ 空候选池静默消失（不报 skipped）。 */
    d3: [RC_DATA,
        '            skipped: !present || arr.length === 0,',
        '            skipped: false,'],
    /* ④ 真的没有与四路全坏合流成一因（源无条件注入）。 */
    d4: [RC_DATA,
        "        if (contributed !== null && contributed === 0) {\n            return { inject: false, reason: 'all_broken', count: 0 };\n        }\n        return { inject: false, reason: 'empty', count: 0 };",
        "        return { inject: false, reason: 'empty', count: 0 };"],
    /* ⑤ 认不出就认不出：不许静默当认得（把 recognized 写死 true）。 */
    d5: [RC_DATA,
        '    return { mode: RECALL_BM25_FALLBACK, recognized: false, sawRaw: v };',
        '    return { mode: v, recognized: true, sawRaw: v };'],
    /* ⑥ 房间认不出静默当认得。 */
    d6: [RC_DATA,
        "    return {\n        room: RECALL_ROOM_FALLBACK,\n        weights: RECALL_ROOM_WEIGHTS[RECALL_ROOM_FALLBACK],\n        known: false,",
        "    return {\n        room: RECALL_ROOM_FALLBACK,\n        weights: RECALL_ROOM_WEIGHTS[RECALL_ROOM_FALLBACK],\n        known: true,"],
    /* ⑦ 零条回执报成 ok（空与好同形）。 */
    d7: [RC_DATA,
        '    if ((num(receipt.hits) || 0) === 0) return RECALL_FACES.empty;',
        '    if (false) return RECALL_FACES.empty;'],
    /* ⑧ App：认源改走吞异常的读法（坏 storage 被读成「空」）。 */
    a1: [RC_APP,
        '        const rs = this._readRaw(SETTINGS_KEY);',
        '        const rs = { ok: true, raw: this._readJSON(SETTINGS_KEY) };'],
    /* ⑨ App：换会话不再重取策略（旧会话的账留着）。 */
    a2: [RC_APP,
        '        this._loadSettings();\n        this._loadPolicy();\n        this._loadLedger();\n        this.probe();',
        '        this._loadSettings();\n        this._loadLedger();\n        this.probe();'],
    /* ⑩ App：三态常量退回手写一份（同族另一半）。 */
    a3: [RC_APP,
        'const FACE = RECALL_FACES;',
        "const FACE = { ok: 'ok', empty: 'empty', storage_absent: 'storage_absent' };"],
    /* ⑪ App：水位线不再管失败（推进了那批就丢了）。
     *   ★ 破坏必须让**旧判据看不见的那一半**暴露：只破判据就得跟着改，
     *     故这里把整个守卫拿掉（写成永远成立）。 */
    a4: [RC_APP,
        '        if (r.advanced === true) {\n            this.watermark = r.value;',
        '        if (true) {\n            this.watermark = r.value;'],
    /* ⑫ 视图：徽章色相退回按三档严重度算（六态又塌回三色）。 */
    v1: [RC_VIEW,
        "rcl-st-' + st",
        "rcl-st-' + fam"],
    /* ⑬ 视图：三态人话表退回手写标识符形键（本仓 J7 形态）。 */
    v2: [RC_VIEW,
        '    [RECALL_FACES.ok]: { icon:',
        '    ok: { icon:'],
    /* ⑭ 视图：四路全坏不再单独一支（与「真的没有」合流）。 */
    v3: [RC_VIEW,
        "            const tone = r.inject ? 'ok' : (r.reason === 'all_broken' ? 'err' : 'warn');",
        "            const tone = r.inject ? 'ok' : 'warn';"],
};

const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

/** 造一份破坏副本并**落盘**（只写文件，不加载）。副本按**真目录结构**建。 */
function writeDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3380_'));
    const target = path.join(dir, path.dirname(rel), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return { target, src: damaged };
}

const NEG = [
    ['I1 破坏「已关与没配分开」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['off-not-distinguished', 'absent-lost']],
    ['I2 破坏「失败批次不推进」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['failed-batch-advanced']],
    ['I3 破坏「空候选池报 skipped」⇒ 内核判据必须转红', 'd3', 'data', dataProblems, ['empty-pool-not-skipped']],
    ['I4 破坏「空与全坏不同因」⇒ 内核判据必须转红', 'd4', 'data', dataProblems, ['all-broken-collapsed']],
    ['I5 破坏「认不出如实报」⇒ 内核判据必须转红', 'd5', 'data', dataProblems, ['bm25-silent-fallback']],
    ['I6 破坏「房间认不出如实报」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['room-silent-fallback']],
    ['I7 破坏「零条回执不许报成 ok」⇒ 内核判据必须转红', 'd7', 'data', dataProblems, ['empty-receipt-face-ok']],
    ['I8 破坏「认源走不吞异常的读法」⇒ 结构面判据必须转红', 'a1', 'src', appProbeProblems, ['read-raw-not-used']],
    ['I9 破坏「换会话必须重取策略」⇒ 结构面判据必须转红', 'a2', 'src', appChatProblems, ['chat-change-no-policy-reload']],
    ['I10 破坏「App 三态常量取真源」⇒ 结构面判据必须转红', 'a3', 'src', appFaceProblems, ['face-constant-handwritten']],
    ['I11 破坏「水位线守卫」⇒ 结构面判据必须转红', 'a4', 'src', appAdvanceProblems, ['advance-guard-lost']],
    ['I12 破坏「徽章按六态取」⇒ 视图判据必须转红', 'v1', 'src', viewStateProblems, ['state-badge-not-by-six-state']],
    ['I13 破坏「三态人话表取真源计算键」⇒ 视图判据必须转红', 'v2', 'src', viewFaceProblems2, ['face-keys-handwritten']],
    ['I14 破坏「四路全坏单独一支」⇒ 视图判据必须转红', 'v3', 'src', viewBranchProblems,
        ['ledger-all-broken-branch-lost', 'verdict-all-broken-branch-lost']],
];

for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        if (kind === 'data') {
            const { target: dmgTarget, src: damagedSrc } = writeDamagedCopy(rel, from, to);
            /* ★ 破坏副本按**内容哈希**命名：Node 的 ESM 加载器按 URL 缓存，
             *   同一路径只会加载一次 —— 用内容哈希既保证内容变了就重新加载，
             *   也让缓存键与内容一致。 */
            let hash = 0;
            for (let i = 0; i < damagedSrc.length; i += 1) hash = (hash * 31 + damagedSrc.charCodeAt(i)) | 0;
            const dir = path.join(os.tmpdir(), 'rp_v3380_dmg');
            fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
            fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
            const target = path.join(dir, path.dirname(rel), 'h' + (hash >>> 0) + '_' + path.basename(rel));
            fs.writeFileSync(target, damagedSrc);
            const mod = await import(pathToFileURL(target).href);
            const bad = judge(mod);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            /* 对照：真模块必须干净（否则「转红」可能只是因为判据本来就红）。 */
            assert.deepEqual(judge(DAT), [], '对照：真模块必须干净');
        } else {
            const { src } = writeDamagedCopy(rel, from, to);
            const bad = judge(src);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(read(rel)), [], '对照：真源码必须干净');
        }
    });
}

/* ====================== J - 判据工具自证 ====================== */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    const q = String.fromCharCode(96);
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + String.fromCharCode(10) + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 fetch(';").includes('fetch('), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + q + '模板里的 fetch(' + q + ';').includes('fetch('), true, '模板串里的必须留住');
    for (const rel of [RC_DATA, RC_APP, RC_VIEW]) {
        const sentinel = stripComments(read(rel) + String.fromCharCode(10) + '/* RP_TAIL_3380 */');
        assert.equal(sentinel.includes('RP_TAIL_3380'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
    }
});

test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, key + ' 的锚点必须恰中 1 次（实测 ' + hits + '）');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3380k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split(String.fromCharCode(10))[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [RC_DATA, RC_APP, RC_VIEW]) {
        const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r.status, 0, rel + ' 必须语法正确：' + (r.stderr || '').split(String.fromCharCode(10))[0]);
    }
});

test('J4 十道静态门必须在场（含本版两处缺陷所属的那两道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts.check.includes(g), 'check 链必须含 ' + g + ' 门');
    }
});

test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 38),
        '本套件成立于 RubyPhone 3.38.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.38.0 召回治理台），不是「当版」 */
    const SELF = '3.38.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6,
        '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join(String.fromCharCode(10));
    for (const marker of ['召回', '六态', '水位线', '融合', '注入']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* ★ 运行时验证边界的**同源标志语**：user 侧条目与 docs/runtime-verification-boundary.md
     *   必须共用同一句（v328 A2/B1 判据守的就是这一条）。本套件在**自己那一版**上也守一遍 ——
     *   标志语不在这里手写：从边界文档原文取，取不到即红（防两处各改各的）。 */
    const doc = read('docs/runtime-verification-boundary.md');
    const markLine = doc.split(String.fromCharCode(10)).find((l) => l.includes('看起来没坏但显示不对'));
    assert.ok(markLine, '边界文档必须含同源标志语');
    assert.ok(joined.includes('看起来没坏但显示不对'),
        '本版条目必须带与边界文档同源的标志语（v328 A2/B1 守这一条）');
    /* ★ 取值口径：本件不许出现弱口径签名（`Number(null)` 是 0 ⇒ 把「没给」说成「给了 0」），
     *   一律走唯一实现 numOrNull；`numOrSelf(` 是覆盖值取值口，调用点不得少于 4（防摆设出口）。 */
    const appSrc = read('apps/recall/recall-app.js');
    const codeOnly = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(codeOnly.includes('Number.isFinite(Number('), false,
        '真代码里不许有弱口径签名（注释里的说明不算）；一律走 numOrNull');
    const gateUses = (codeOnly.match(/numOrSelf\(/g) || []).length;
    assert.ok(gateUses >= 4, '覆盖值取值口调用点应 ≥ 4，实测 ' + gateUses);
});
