// tests/system-v3410.test.mjs — 需求沙盘 [v3.41.0]
//
// 本套件守四件事：
//  ① 收拾内核的六条口径（需求读不出来不许当 5 / 心情缺项不许落最差档 /
//     池子四态不许塔成一态 / 游标绕回不许无痕迹 / 愿望过期不许与「今天没有」同形 /
//     记忆满了不许整本清空）；
//  ② 四块不缝真的没缝（零网络零密钥 / 不碰宿主对象 / 不跨 App 读 / 不收外链不落数据库）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 / v3.36 / v3.37 / v3.38 / v3.39 / v3.40 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as DAT from '../apps/needsim/needsim-data.js';
import * as APP from '../apps/needsim/needsim-app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NS_DATA = 'apps/needsim/needsim-data.js';
const NS_APP = 'apps/needsim/needsim-app.js';
const NS_VIEW = 'apps/needsim/needsim-view.js';
const NS_CSS = 'apps/needsim/needsim.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
/** 单引号（破坏表里拼锚点用）：一律拼装形，不写裸引号。 */
const Q = String.fromCharCode(39);
/** 反斜杠（剥注释器里判转义用）：同样拼装形，免得文件里出现裸反斜杠。 */
const BS = String.fromCharCode(92);
/** 双引号（造 JSON 文本用）：拼装形，源码里不出现裸双引号。 */
const DQ = String.fromCharCode(34);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300…v3400 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故本件的被审代码一律字串比对、不写正则字面量，
 *    并在 J 组用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
            if (c === Q || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        /* 字符串态：本件被审代码不许有裸引号，故只需处理转义与收尾。 */
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === state) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}

/** 内存存储（单会话）。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^needsim_/` 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致 —— 抄别版的前缀会把「换会话后读到别人数据」这条判据测成空气。 */
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

/** 取不出来的存储（一取就抛）—— 守「取不出来不许读成空的」那一族。 */
function hostileStorage() {
    return { get: () => { throw new Error('boom'); }, set: () => {} };
}

/** 假宿主壳：只提供视图层要的 getContentContainer（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null, showNotification: () => {} };
}
const newApp = (storage) => new APP.NeedsimApp(shellStub(), storage);

/** 六项都读得出来的那组值（心情愉悦档）。 */
const fullNeeds = { hunger: 80, energy: 80, bladder: 80, hygiene: 80, fun: 80, social: 80 };
/** 六项全在最低档（真的非常不开心）。 */
const worstNeeds = { hunger: 1, energy: 1, bladder: 1, hygiene: 1, fun: 1, social: 1 };

/** 造一封回信文本（用 JSON.stringify 拼，源码里不出现裸引号）。 */
function replyText(over) {
    const base = {
        needs: { hunger: 10, energy: 20, bladder: 30, hygiene: 40, fun: 50, social: 60 },
        actionLines: { snack: ['x1', 'x2', 'x3'] },
        randomEvents: [{ title: 'tt', text: 'xx', effects: { fun: 3 } }],
        thoughts: ['t1', 't2']
    };
    return JSON.stringify(Object.assign(base, over || {}));
}
/** 三格都写好的存储（六项齐 / 池子齐 / 愿望今天 / 台账空）。 */
function fullStorage(over = {}) {
    return memStorage(Object.assign({
        needsim_needs: JSON.stringify({ needs: fullNeeds }),
        needsim_pool: JSON.stringify({
            actions: {
                snack: ['a1', 'a2', 'a3'], nap: ['b1', 'b2', 'b3'], bath: ['c1', 'c2', 'c3'],
                play: ['d1', 'd2', 'd3'], chat: ['e1', 'e2', 'e3'], focus: ['f1', 'f2', 'f3']
            },
            events: [{ title: '小事件A', text: '哦', effects: { fun: 5 } }],
            indexes: {}
        }),
        needsim_journal: JSON.stringify({ memories: [], wish: null }),
        needsim_ledger: JSON.stringify({ receipts: [], ledgerKeep: 1 }),
    }, over));
}

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 需求读不出来不许当成 5（源 clampSimsNeedValue 回落 5 并照画进度条）', () => {
    for (const v of ['abc', null, undefined, NaN, Infinity, {}]) {
        const r = DAT.clampNeed(v);
        assert.equal(r.ok, false, '「' + String(v) + '」必须判成读不出来');
        /* ★ 回落值仍在（供调用方兜底），但 **为什么要报出来**。 */
        assert.equal(r.why, 'not_number');
    }
    /* 真值 5 与「读不出来」必须可区分：真值 ok=true。 */
    assert.equal(DAT.clampNeed(5).ok, true, '真的 5 是「读得出来」');
    assert.equal(DAT.clampNeed(5).why, 'ok');
    /* 够低的数**仍然是数**（低与读不出来不是一回事）。 */
    const low = DAT.clampNeed(2);
    assert.equal(low.ok, true);
    assert.equal(low.value, DAT.SIMS_VALUE_MIN);
    assert.equal(low.clamped, true, '被夹到边界要报出来');
    assert.equal(DAT.clampNeed(999).value, DAT.SIMS_VALUE_MAX);
    /* 逐项分开判：坏的那项 null、好的那项照给。 */
    const ro = DAT.needsReadout({ hunger: 2, energy: 'x', bladder: 60, hygiene: 60, fun: 60, social: 60 });
    assert.equal(ro.rows.find((x) => x.key === 'energy').value, null, '读不出来的那项不许给回落值');
    assert.equal(ro.rows.find((x) => x.key === 'energy').level, '');
    assert.equal(ro.rows.find((x) => x.key === 'hunger').value, DAT.SIMS_VALUE_MIN);
    assert.equal(ro.unreadable, 1, '六项给全、只坏一项 ⇒ 只算一项');
    /* ★「压根没给」与「给了但读不出来」都算读不出来（源把没给的那几项当 0 算并照画）。 */
    assert.equal(DAT.needsReadout({ hunger: 2 }).unreadable, 5, '没给的那几项同样是读不出来');
    assert.equal(ro.ok, false);
    /* 一项读不出来不影响别项：其余四项照样按真值判档。 */
    const ro2 = DAT.needsReadout({ hunger: 80, energy: 'x', bladder: 80, hygiene: 80, fun: 80, social: 80 });
    assert.equal(ro2.rows.filter((x) => x.ok).length, 5);
});

test('A2 心情缺项不许落最差档（源 updateMood 六项不齐即「非常不开心」）', () => {
    assert.equal(DAT.moodOf(worstNeeds).label, DAT.SIMS_MOOD_META[DAT.SIMS_MOODS[3]].label);
    assert.equal(DAT.moodOf(worstNeeds).ok, true, '真的最低档仍然是「读得出来」');
    /* 缺一项：**读不出来**，不许落最差档。 */
    const partial = Object.assign({}, fullNeeds);
    delete partial.social;
    const m = DAT.moodOf(partial);
    assert.equal(m.ok, false);
    assert.equal(m.label, DAT.SIMS_MOOD_UNKNOWN);
    assert.notEqual(m.label, DAT.SIMS_MOOD_META[DAT.SIMS_MOODS[3]].label, '缺项不许显示成最差档');
    assert.equal(m.avg, null, '缺项时平均分也不许给');
    /* 四档边界（源四档阈值 70/50/30/else）。 */
    const pick = (v) => DAT.moodOf({ hunger: v, energy: v, bladder: v, hygiene: v, fun: v, social: v }).mood;
    assert.equal(pick(70), DAT.SIMS_MOODS[0]);
    assert.equal(pick(69), DAT.SIMS_MOODS[1]);
    assert.equal(pick(50), DAT.SIMS_MOODS[1]);
    assert.equal(pick(49), DAT.SIMS_MOODS[2]);
    assert.equal(pick(30), DAT.SIMS_MOODS[2]);
    assert.equal(pick(29), DAT.SIMS_MOODS[3]);
});

test('A3 效果口径：未知项 / 非数 / 零 / 越界四件事逐条报（源静默丢弃）', () => {
    const s = DAT.sanitizeEffects({ hunger: 20, bogus: 5, energy: 'x', fun: 0, social: 999, bladder: -999 });
    assert.equal(s.effects.hunger, 20);
    assert.equal(s.effects.social, DAT.SIMS_EFFECT_MAX, '越上界要夹并报');
    assert.equal(s.effects.bladder, DAT.SIMS_EFFECT_MIN, '越下界要夹并报');
    assert.equal(Object.prototype.hasOwnProperty.call(s.effects, 'bogus'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(s.effects, 'fun'), false, '零变化不留');
    const whys = s.rejected.map((x) => x.why).sort().join(',');
    assert.equal(whys, 'clamped,clamped,not_number,unknown_need,zero');
    /* 应用：读不出来的那项要**跳过并报**（不许拿回落值去加）。 */
    const a = DAT.applyEffects({ hunger: 99, energy: 'x' }, { hunger: 20, energy: 5 });
    assert.equal(a.applied.length, 1);
    assert.equal(a.applied[0].capped, true);
    assert.equal(a.skipped.length, 1);
    assert.equal(a.skipped[0].why, 'need_unreadable');
    /* 到边界再加 = 没变 = 跳过（源照样记一笔「变了」）。 */
    const b = DAT.applyEffects({ hunger: 100, energy: 50 }, { hunger: 20 });
    assert.equal(b.applied.length, 0);
    assert.equal(b.skipped[0].why, 'no_change');
    assert.equal(b.needs.hunger, 100);
});

test('A4 池子四态不许塔成一态（源只有「拆得开」与「当成空」）', () => {
    const P = DAT.SIMS_POOL_STATES;
    const pool = DAT.normalizePool({
        actions: { snack: ['a', 'b', 'c'], nap: ['a'], bath: 'not-array', play: [] },
        events: { bad: 1 }
    });
    assert.equal(pool.faces.snack, P[0]);
    assert.equal(pool.faces.nap, P[1], '不满三条是「缺」，不是「没有」');
    assert.equal(pool.faces.bath, P[3], '写了但不是数组是「认不出来」');
    assert.equal(pool.faces.play, P[3], '空数组也是「写了但一条都用不上」');
    assert.equal(pool.faces.chat, P[2], '压根没这一格才是「没有」');
    assert.equal(pool.eventsState, P[3], '小事件池整格坏要单列');
    /* 四态取值互不相同（塔平就同形了）。 */
    assert.equal(new Set(P).size, 4);
    assert.equal(new Set([pool.faces.snack, pool.faces.nap, pool.faces.bath, pool.faces.chat]).size, 4,
        '四格四态必须互不相同（塔平就是同形）');
    /* 台词上限与去重（源 split 后照单全收）。 */
    const dup = DAT.normalizePool({ actions: { snack: ['a', 'a', 'b', 'c', 'd', 'e'] } });
    assert.equal(dup.actions.snack.length, DAT.SIMS_LINE_USE_LIMIT);
    assert.ok(dup.rejected.some((x) => x.why === 'repeat'), '重复要报');
    assert.ok(dup.rejected.some((x) => x.why === 'over_limit'), '超上限要报');
    /* 小事件：字符串条目当正文、标题取缺省（源的口径），且要计数。 */
    const ev = DAT.normalizePool({ events: ['像一条串'] });
    assert.equal(ev.events[0].title, DAT.SIMS_DEFAULT_EVENT_TITLE);
    assert.equal(ev.events[0].text, '像一条串');
    assert.equal(ev.defaulted, 1, '缺省标题要计数');
});

test('A5 游标绕回不许无痕迹（源取模后不报，用户看到的台词莫名回到开头）', () => {
    const p = DAT.nextFromPool(['a', 'b', 'c'], 0);
    assert.equal(p.line, 'a');
    assert.equal(p.wrapped, false);
    assert.equal(p.cursor, 1);
    const q = DAT.nextFromPool(['a', 'b', 'c'], 3);
    assert.equal(q.line, 'a');
    assert.equal(q.wrap, 1, '绕回第一轮要报出来');
    assert.equal(q.wrapped, true);
    const r = DAT.nextFromPool(['a', 'b', 'c'], 7);
    assert.equal(r.wrap, 2);
    assert.equal(r.index, 1);
    /* 坏游标要单列（源静默落 0 = 从头开始）。 */
    assert.equal(DAT.nextFromPool(['a'], NaN).badCursor, true);
    assert.equal(DAT.nextFromPool(['a'], -1).badCursor, true);
    assert.equal(DAT.nextFromPool(['a'], 1).badCursor, false);
    /* 空池与坏游标是两件事。 */
    const empty = DAT.nextFromPool([], 0);
    assert.equal(empty.ok, false);
    assert.equal(empty.why, 'empty_pool');
    /* 坏游标计数：两种坏形都要计（只认非数会把「负数被当成从头开始」放走）。 */
    const np = DAT.normalizePool({ indexes: { snack: 'x', nap: -5, bath: 2 } });
    assert.equal(np.indexBad, 2, '非数与负数都算坏游标');
    assert.equal(np.cursors.bath, 2, '好的游标照留');
    assert.equal(np.cursors.nap, 0, '坏游标落 0');
});

test('A6 愿望四态不许同形（源只判存在不判日子，过期与没有一样）', () => {
    const W = DAT.SIMS_WISH_STATES;
    assert.equal(DAT.parseSavedWish('', '2026-10-05').state, W[2], '空 = 今天没有');
    assert.equal(DAT.parseSavedWish('{bad', '2026-10-05').state, W[3], '坏 = 读不出来');
    const stale = DAT.parseSavedWish(JSON.stringify({ title: 't', desc: 'd', date: '2026-10-01' }), '2026-10-05');
    assert.equal(stale.state, W[1], '过去那天 = 过期');
    assert.notEqual(stale.state, W[2], '过期不许与「今天没有」同形');
    assert.ok(stale.stale && stale.stale.title === 't', '过期那条的内容要留出来给用户看');
    assert.equal(stale.savedDate, '2026-10-01');
    const okW = DAT.parseSavedWish(JSON.stringify({ title: 't', desc: 'd', date: '2026-10-05' }), '2026-10-05');
    assert.equal(okW.state, W[0]);
    assert.equal(okW.wish.title, 't');
    /* 缺字段不许当「今天没有」：那是「写了但认不出来」。 */
    assert.equal(DAT.parseSavedWish(JSON.stringify({ desc: 'd', date: '2026-10-05' }), '2026-10-05').state, W[3]);
    assert.equal(DAT.parseSavedWish(JSON.stringify({ title: 't', desc: 'd' }), '2026-10-05').state, W[3]);
    /* 四态取值互不相同。 */
    assert.equal(new Set(W).size, 4);
});

test('A7 按最弱那项定愿望：缺项如实拒（源 Math.min 拿到 NaN 会定出空愿望）', () => {
    const b = DAT.buildWish({ hunger: 80 }, '2026-10-05');
    assert.equal(b.ok, false);
    assert.equal(b.why, 'need_unreadable');
    assert.equal(b.unknown, 5);
    assert.equal(b.wish, null);
    const g = DAT.buildWish({ hunger: 80, energy: 80, bladder: 80, hygiene: 10, fun: 80, social: 80 }, '2026-10-05');
    assert.equal(g.ok, true);
    assert.equal(g.lowest, 'hygiene');
    assert.equal(g.wish.actionId, DAT.SIMS_CARE_OF.hygiene);
    assert.equal(g.wish.title, DAT.SIMS_WISH_TITLE.hygiene);
    assert.equal(g.wish.date, '2026-10-05');
});

test('A8 记忆满了落最旧一条并报（源 simsMemories = [] 一次清光且不报）', () => {
    const list = [];
    for (let i = 0; i < DAT.SIMS_MEMORY_LIMIT; i += 1) list.push({ title: 't' + i, text: 'x' });
    const r = DAT.addMemory(list, { title: 'new', text: 'y' }, DAT.SIMS_MEMORY_LIMIT);
    assert.equal(r.list.length, DAT.SIMS_MEMORY_LIMIT);
    assert.equal(r.evicted, 1, '顶掉几条要报出来');
    assert.equal(r.list[0].title, 'new', '新的在最前');
    assert.equal(r.list[r.list.length - 1].title, 't' + (DAT.SIMS_MEMORY_LIMIT - 2), '被顶掉的是最旧那条');
    assert.ok(r.list.some((x) => x.title === 't1'), '旧的一条都还在（不是整本清空）');
    /* 读数：时间戳在未来要报出来（源夹成 0 显示「刚刚」）。 */
    const now = Date.now();
    assert.equal(DAT.memoryAgeOf(now + 60000, now).ok, false);
    assert.equal(DAT.memoryAgeOf(now + 60000, now).why, 'future');
    assert.equal(DAT.memoryAgeOf(null, now).ok, false);
    assert.equal(DAT.memoryAgeOf(now - 3600000, now).label, '1小时前');
});

test('A9 回信归一：五种失败因各自可辨 + 缺项如实报（源只在控制台吞掉）', () => {
    const W = Object.keys(DAT.SIMS_REPLY_WHYS);
    assert.ok(W.length >= 5, '失败因至少五种，实测 ' + W.length);
    assert.equal(DAT.parseReply('', {}).why, 'no_text');
    assert.equal(DAT.parseReply('hello', {}).why, 'no_object');
    assert.equal(DAT.parseReply('{' + DQ + 'a' + DQ + ':1', {}).why, 'unbalanced');
    assert.equal(DAT.parseReply('{oops}', {}).why, 'bad_json');
    /* 配平取**第一个完整对象**（源用贪婪字串取，后面还有对象时会吞错）。 */
    const ex = DAT.extractObject('前 {' + DQ + 'a' + DQ + ':1} 后 {' + DQ + 'b' + DQ + ':2}');
    assert.equal(ex.ok, true);
    assert.equal(ex.json, '{' + DQ + 'a' + DQ + ':1}');
    /* 只给两项：缺的四项要报出来，不许当零。 */
    const r = DAT.parseReply(JSON.stringify({ needs: { hunger: 10, energy: 20 } }), { today: '2026-10-05' });
    assert.equal(r.ok, true);
    assert.equal(Object.keys(r.needs).length, 2);
    assert.equal(r.missing.length, 4);
    assert.equal(r.needs.bladder, undefined, '没给的不许补零');
    /* 池子逐格四态 + 小事件整格坏一眼可辨。 */
    const r2 = DAT.parseReply(replyText({ randomEvents: { bad: 1 } }), { today: '2026-10-05' });
    assert.equal(r2.pool.eventsState, DAT.SIMS_POOL_STATES[3]);
    /* 想法条数照数。 */
    assert.equal(DAT.parseReply(replyText(), {}).thoughts, 2);
});

test('A10 面判定：取不出来 / 写了但认不出来 / 还没记过 / 有可用内容 四态不许塔平', () => {
    assert.equal(DAT.faceOf(false, false, false), DAT.SIMS_FACES[3], '取不出来');
    assert.equal(DAT.faceOf(true, false, true), DAT.SIMS_FACES[2], '写了但认不出来');
    assert.equal(DAT.faceOf(true, false, false), DAT.SIMS_FACES[1], '还没记过');
    /* ★ 口径：**有坏格就先报坏格** —— 「你看到的不对、原因不在你」优先于「一切正常」，
     *   否则「池子坏了一格」会被「还有五格是好的」盖掉（本件的面优先级写死了这条）。 */
    assert.equal(DAT.faceOf(true, true, true), DAT.SIMS_FACES[2], '有坏格就要报出来');
    assert.equal(DAT.faceOf(true, false, false), DAT.SIMS_FACES[1]);
    assert.equal(new Set(DAT.SIMS_FACES).size, 4);
    /* 读数面：四格逐格数，不塔成「合格 / 不合格」。 */
    const pool = DAT.normalizePool({ actions: { snack: ['a', 'b', 'c'], nap: ['a', 'b'], bath: 'x', play: [] } });
    const rd = DAT.readingsOf([{ auto: true }], pool, DAT.SIMS_WISH_STATES[0], { receipts: 2 });
    assert.equal(rd.poolOk, 1, 'snack 三条齐 ⇒ 齐');
    assert.equal(rd.poolPartial, 1, 'nap 只给两条 ⇒ 不够用');
    assert.equal(rd.poolMalformed, 2, 'bath 写了不是数组 / play 写了是空数组 ⇒ 两格都算「写了但用不上」');
    assert.equal(rd.poolAbsent, 2, 'chat / focus 压根没给 ⇒ 「没生成」，不许并进「用不上」');
    /* 四格计数加起来必须正好六个行动：漏一格或重算一格就会被抓。 */
    assert.equal(rd.poolOk + rd.poolPartial + rd.poolMalformed + rd.poolAbsent, DAT.SIMS_ACTION_IDS.length);
    assert.equal(rd.auto, 1);
    assert.equal(rd.manual, 0);
    assert.equal(rd.lines, 5, '线条数 = snack 3 + nap 2');
});

test('A11 要求文本：本件只产可复制的要求（不调模型），五段要素齐备', () => {
    const t = DAT.composeRequestText({ role: '阿棠' });
    assert.ok(t.includes('阿棠'));
    for (const k of DAT.SIMS_NEED_KEYS) assert.ok(t.includes(k), '要求里必须写明需求键名 ' + k);
    for (const a of DAT.SIMS_ACTION_IDS) assert.ok(t.includes(a), '要求里必须写明行动键名 ' + a);
    assert.ok(t.includes(String(DAT.SIMS_LINE_LIMIT)), '要写明每个行动几条台词');
    assert.ok(t.includes(String(DAT.SIMS_EVENT_LIMIT)), '要写明小事件几条');
    assert.ok(t.includes(DAT.SIMS_EFFECT_RANGE_TEXT), '要写明单项变化区间');
    assert.ok(t.includes('JSON'));
});

test('A12 真源表十一条在场且取值互不相同（塔平就是同形）', () => {
    assert.equal(DAT.SIMS_NEED_KEYS.length, 6);
    assert.equal(DAT.SIMS_ACTION_IDS.length, 6);
    assert.equal(DAT.SIMS_LEVELS.length, 4);
    assert.equal(DAT.SIMS_MOODS.length, 4);
    assert.equal(DAT.SIMS_MEMORY_STATES.length, 3);
    assert.equal(new Set(DAT.SIMS_NEED_KEYS).size, 6);
    assert.equal(new Set(DAT.SIMS_ACTION_IDS).size, 6);
    assert.equal(DAT.SIMS_VALUE_FALLBACK, 5, '源回落值就是 5（本件留着它但不当读数用）');
    assert.equal(DAT.SIMS_MEMORY_LIMIT, 10);
    /* 六个行动各自对应一项需求，且是**一对一**（源 care 表与行动表对得上）。 */
    const cares = DAT.SIMS_ACTION_IDS.map((a) => DAT.SIMS_ACTION_META[a].need);
    assert.equal(new Set(cares).size, 6, '六个行动不许有两项指向同一需求');
    for (const k of DAT.SIMS_NEED_KEYS) {
        assert.ok(cares.indexOf(k) >= 0, '每项需求都要有一个对应的照护行动：' + k);
        assert.ok(DAT.SIMS_WISH_TITLE[k] && DAT.SIMS_WISH_DESC[k], '愿望文案表要齐：' + k);
        assert.ok(DAT.SIMS_ICON_OF[DAT.SIMS_CARE_OF[k]], '图标表要齐：' + k);
    }
});

/* ══════════════════════ B — App 行为面 ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来不许读成「一条都没记过」', () => {
    const a = newApp(hostileStorage());
    assert.equal(a.faceOf(), DAT.SIMS_FACES[3]);
    assert.equal(a.probe(), null, '取不出来时投影必须是 null');
    assert.equal(a.readings(), null);
    assert.equal(a.summaryLine(), '读数拿不到（存储不可用）');
    /* 没有 set 也算存储不可用（本件的核心动作就是落盘）。 */
    assert.equal(newApp({ get: () => null }).faceOf(), DAT.SIMS_FACES[3]);
    assert.equal(newApp({ set: () => {} }).faceOf(), DAT.SIMS_FACES[3]);
    assert.equal(newApp(null).faceOf(), DAT.SIMS_FACES[3]);
    /* get 好、写抛：面是「还没记过」（storage 可用），不许拿写入失败去冒充取不出来。 */
    const d = newApp({ get: () => null, set: () => { throw new Error('nope'); } });
    assert.equal(d.faceOf(), DAT.SIMS_FACES[1]);
    assert.equal(d.resetNeeds().ok, true, '写失败不许抛出来');
});

test('B2 「写了但认不出来」单列：坏内容不许与「还没记过」同形', () => {
    const a = newApp(memStorage({ needsim_needs: '{bad' }));
    assert.equal(a.faceOf(), DAT.SIMS_FACES[2]);
    assert.notEqual(a.faceOf(), DAT.SIMS_FACES[1]);
    /* ★ 二次 probe 不许把痕迹洗掉（早退分支不归零会让上一轮的值残留）。 */
    a.probe();
    assert.equal(a.faceOf(), DAT.SIMS_FACES[2], '二次取数不许把「认不出来」洗成「还没记过」');
    /* 四格中的每一格坏掉都能单列出面（不是只管需求格）。 */
    for (const k of ['needsim_needs', 'needsim_pool', 'needsim_journal', 'needsim_ledger']) {
        const bad = newApp(memStorage({ [k]: '{bad' }));
        bad.probe();
        assert.equal(bad.faceOf(), DAT.SIMS_FACES[2], k + ' 坏掉必须报「写了但认不出来」');
    }
    /* 需求格坏：逐项画「读不出来」，不是画一根 5% 的条。 */
    const n = newApp(memStorage({ needsim_needs: '{bad' }));
    for (const r of n.needRows()) assert.equal(r.value, null);
    assert.equal(n.moodRow().ok, false);
    assert.equal(n.moodRow().label, DAT.SIMS_MOOD_UNKNOWN);
});

test('B3 需求逐项读：好项照给、坏项 null、心情缺项不落最差档', () => {
    const a = newApp(memStorage({
        needsim_needs: JSON.stringify({ needs: { hunger: 50, energy: 'x', bladder: 90 } })
    }));
    const rows = a.needRows();
    assert.equal(rows.length, 6, '六项始终画六行（不因缺项少画）');
    assert.equal(rows.find((r) => r.key === 'hunger').value, 50);
    assert.equal(rows.find((r) => r.key === 'energy').value, null);
    assert.equal(rows.find((r) => r.key === 'energy').unreadableText, DAT.SIMS_NEED_UNREADABLE);
    assert.equal(rows.find((r) => r.key === 'fun').ok, false, '压根没给的那项也算读不出来');
    assert.equal(a.moodRow().ok, false);
    assert.equal(a.moodRow().given, 3, '给了几项要报出来');
    /* 六个行动逐行：读不出来的那项会在下一次生效，故要预告。 */
    const acts = a.actionRows();
    assert.equal(acts.length, 6);
    assert.equal(acts.find((x) => x.key === 'snack').blocked, true, '饥饿读不出来 ⇒ 点它会跳过，要预告');
    assert.ok(acts.find((x) => x.key === 'nap').needLabel);
    assert.ok(acts.find((x) => x.key === 'snack').effectText.includes(String.fromCharCode(43)), '效果文案要带加号');
});

test('B4 点行动：取台词 / 落效果 / 落记忆 / 判愿望 / 落回执 五件事各自报出', () => {
    const a = newApp(fullStorage());
    const r = a.performAction('snack');
    assert.equal(r.ok, true);
    assert.equal(r.line, 'a1');
    assert.equal(r.applied.length, 3);
    assert.equal(r.memoryRows === undefined ? 0 : 0, 0);
    assert.equal(a.memoryRows().length, 1, '点一次落一条记忆');
    assert.equal(a.memoryRows()[0].text, 'a1');
    assert.equal(a.receiptRows().length, 1, '点一次留一张回执');
    assert.equal(a.receiptRows()[0].kind, 'action');
    assert.equal(a.readings().poolOk, 6);
    /* 池空 / 不存在的行动都要分因。 */
    const b = newApp(fullStorage({
        needsim_pool: JSON.stringify({ actions: { snack: [] }, events: [] })
    }));
    assert.equal(b.performAction('snack').reason, 'empty_pool');
    assert.equal(b.performAction('nope').reason, 'unknown_action');
    assert.equal(b.triggerEvent().reason, 'empty_pool');
    assert.equal(b.triggerEvent().poolState, DAT.SIMS_POOL_STATES[3], '池子空要报是哪一态');
});

test('B5 游标绕回在回执里留痕（源取模后不报，用户看到的台词莫名回到开头）', () => {
    const a = newApp(fullStorage({
        needsim_pool: JSON.stringify({ actions: { snack: ['a', 'b'], events: [] }, indexes: { snack: 2 } })
    }));
    const r = a.performAction('snack');
    assert.equal(r.wrapped, true);
    assert.equal(r.wrap, 1);
    assert.equal(a.receiptRows()[0].wrap, 1, '回执要留绕回轮次');
});

test('B6 记忆满了落最旧一条并在回执里报（源 simsMemories = [] 一次清光）', () => {
    const a = newApp(fullStorage());
    const acts = ['snack', 'nap', 'bath', 'play', 'chat', 'focus'];
    for (let i = 0; i < 11; i += 1) a.performAction(acts[i % 6]);
    assert.equal(a.memoryRows().length, DAT.SIMS_MEMORY_LIMIT, '记忆上限按真源表');
    assert.ok(a.receiptRows().some((x) => x.evicted > 0), '顶掉记忆要在回执里报');
    /* 清记忆只清记忆，不动需求与池。 */
    const before = a.needRows().map((x) => x.value).join(',');
    const cleared = a.clearMemories();
    assert.ok(cleared.cleared > 0);
    assert.equal(a.memoryRows().length, 0);
    assert.equal(a.needRows().map((x) => x.value).join(','), before, '清记忆不许动需求');
});

test('B7 台账容量可调：坏值一律回落且如实报「我填的没被采纳」', () => {
    const a = newApp(fullStorage());
    for (const v of [0, -3, 1.5, 'abc', null, undefined, 9999]) {
        const r = a.setLedgerKeep(v);
        assert.equal(r.took, DAT.SIMS_MAX_UNITS, '「' + String(v) + '」不被采纳');
        assert.equal(r.saw, v === undefined ? undefined : v, '原值要回显给用户看');
    }
    assert.equal(a.setLedgerKeep(2).took, 2);
    assert.ok(a.ledgerKeepOf() >= 1, '裁剪循环自带下界，不许落到 0');
});

test('B8 愿望四态在 App 里各自带话（过期那条的内容要留出来）', () => {
    const a = newApp(fullStorage({
        needsim_journal: JSON.stringify({
            memories: [], wish: { title: '想听见你的声音', desc: 'd', date: '2020-01-01', need: 'social' }
        })
    }));
    const w = a.wishRow();
    assert.equal(w.state, DAT.SIMS_WISH_STATES[1]);
    assert.equal(w.has, false, '过期不算「今天有愿望」');
    assert.equal(w.title, '想听见你的声音', '过期那条的内容要看得见');
    assert.ok(w.staleText.includes('2020-01-01'));
    assert.equal(a.wishStateOf(), DAT.SIMS_WISH_STATES[1]);
    /* 过期态下按「最弱那项」重定：走通且报告替换掉了过期那条。 */
    const r = a.buildWishNow({ today: '2026-10-05' });
    assert.equal(r.ok, true);
    assert.equal(r.replacedStale, true, '重定时要报「刚才那条是过期的」');
    assert.equal(a.wishRow().state, DAT.SIMS_WISH_STATES[0], '重定之后就是今天的愿望');
    /* 六项读不出来时不替你按「他最饿」算。 */
    const b = newApp(memStorage({ needsim_needs: '{bad' }));
    assert.equal(b.buildWishNow().reason, 'need_unreadable');
    /* 手存愿望：缺标题 / 缺说明要分因。 */
    assert.equal(a.setWish({ desc: 'd' }).reason, 'no_title');
    assert.equal(a.setWish({ title: 't' }).reason, 'no_desc');
    assert.equal(a.setWish(null).reason, 'empty_input');
});

test('B9 收拾回信：成功报缺项与逐格四态，失败分五因', () => {
    const a = newApp(fullStorage());
    assert.equal(a.ingestReply('').reason, 'empty_input');
    assert.equal(a.ingestReply('hello').reason, 'no_object');
    assert.equal(a.ingestReply('{' + DQ + 'a' + DQ + ':1').reason, 'unbalanced');
    assert.equal(a.ingestReply('{oops}').reason, 'bad_json');
    assert.ok(a.ingestReply('hello').whyLabel, '失败要带人话标签（源只丢控制台）');
    assert.equal(a.ingestReply('{' + DQ + 'a' + DQ + ':1').truncated, true);
    const r = a.ingestReply(replyText());
    assert.equal(r.ok, true);
    assert.equal(r.given, 6);
    assert.equal(r.missing.length, 0);
    assert.equal(r.pool.lines, 3);
    assert.equal(r.pool.faces.snack, DAT.SIMS_POOL_STATES[0]);
    assert.equal(r.thoughts, 2);
    /* merge 模式：没给的项不动（不许当零）。 */
    const b = newApp(fullStorage());
    const r2 = b.ingestReply(replyText({ needs: { hunger: 10, energy: 20 } }));
    assert.equal(r2.given, 2);
    assert.equal(r2.missing.length, 4);
    assert.equal(b.needRows().find((x) => x.key === 'bladder').value, 80, '没给的不动');
    /* 回执里要留下心情的变化。 */
    assert.ok(r2.moodBefore && r2.moodAfter);
});

test('B10 详情态与页签：越界一律拒，换会话收回', () => {
    const a = newApp(fullStorage());
    a.performAction('snack');
    assert.equal(a.openMemory(0).ok, true);
    assert.equal(a.currentKey(), '0');
    assert.equal(a.openMemory(9).ok, false);
    assert.equal(a.openMemory(1.5).ok, false);
    assert.equal(a.closeMemory().ok, true);
    assert.equal(a.currentKey(), '');
    assert.equal(a.setTab('pool'), 'pool');
    assert.equal(a.setTab('xyz'), 'needs', '认不出的页签收回到第一页');
    assert.equal(a.tab(), 'needs');
});

test('B11 投影是视图唯一入口，且四态与读数都在里面', () => {
    const a = newApp(fullStorage());
    const p = a.probe();
    assert.ok(p && typeof p === 'object');
    for (const k of ['face', 'faceText', 'malformed', 'readings', 'mood', 'needs', 'actions', 'events',
        'wish', 'memories', 'receipts', 'policy']) {
        assert.ok(Object.prototype.hasOwnProperty.call(p, k), '投影缺字段 ' + k);
    }
    assert.equal(p.needs.length, 6);
    assert.equal(p.actions.length, 6);
    assert.equal(p.malformed, false);
    assert.equal(p.readings.poolOk, 6);
});

/* ══════════════════════ C — 接线与同源 ══════════════════════ */
test('C1 四条会话键随会话隔离（换角色后不许读到别人的需求与台词池）', () => {
    const st = sessionStorage();
    const app = new APP.NeedsimApp(shellStub(), st);
    app.resetNeeds();
    app.setLedgerKeep(3);
    app.ingestReply(replyText({ needs: { hunger: 10, energy: 20, bladder: 30, hygiene: 40, fun: 50, social: 60 } }));
    /* ★ 四条键各自的写入路径都要真走过一遍：愿望走 setWish（journal 键）。
     *   少了这一步，后面「journal 跟着会话隔离」那条判据测的是空气。 */
    app.setWish({ need: 'fun', actionId: 'play', title: '想去走两圈', desc: '出门透气' });
    assert.equal(app.wishRow().state, DAT.SIMS_WISH_STATES[0], '定下的愿望当场就是在的');
    assert.equal(app.needRows().find((x) => x.key === 'hunger').value, 10);
    assert.equal(app.ledgerKeepOf(), 3);
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.needRows().find((x) => x.key === 'hunger').value, null, '换会话需求必须全量重取');
    assert.equal(app.memoryRows().length, 0);
    assert.equal(app.receiptRows().length, 0);
    assert.equal(app.wishRow().state, DAT.SIMS_WISH_STATES[2], '换会话愿望也要回「今天没有」');
    assert.equal(app.ledgerKeepOf(), DAT.SIMS_MAX_UNITS, '换会话策略回缺省');
    assert.equal(app.faceOf(), DAT.SIMS_FACES[1], '新会话是「还没记过」而不是「读不出来」');
    assert.equal(app.currentKey(), '', '换会话要清详情态');
    assert.equal(app.tab(), 'needs', '换会话要把页签收回第一页');
    st.switchTo('c1');
    app.onChatChanged();
    assert.equal(app.needRows().find((x) => x.key === 'hunger').value, 10, '换回来必须能读回自己的');
    assert.equal(app.wishRow().state, DAT.SIMS_WISH_STATES[0], '换回来愿望也读得回');
    assert.equal(app.ledgerKeepOf(), 3);
    /* ★ 四条键都要真写过（写入路径各自的覆盖面）：
     *   needs/pool/journal 由 resetNeeds + performAction + persistMemoriesAndWish 写，
     *   ledger 由 setLedgerKeep 写。 */
    for (const k of ['needsim_needs', 'needsim_pool', 'needsim_journal', 'needsim_ledger']) {
        assert.equal(st._box.has('c1::' + k), true, k + ' 必须落在会话隔离的格上');
    }
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    const apps = read(APPS);
    assert.ok(apps.includes("id: 'needsim'"), 'config/apps.js 必须有 needsim 条目');
    assert.ok(apps.includes('需求沙盘'), '注册条目要有可读名');
    assert.ok(read(STORAGE).includes('/^needsim_/'), 'config/storage.js 必须有 /^needsim_/ 前缀');
    const idx = read(INDEX);
    assert.ok(idx.includes("appId === 'needsim'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/needsim/needsim-app.js')"), 'index.js 必须真 import 本件');
    assert.ok(idx.includes('needsimApp'), 'index.js 重绑表必须有 needsimApp（换会话才重取）');
    const keys = read(KEYS);
    for (const k of ['needsim_needs', 'needsim_pool', 'needsim_journal', 'needsim_ledger']) {
        assert.ok(keys.includes(Q + k + Q), k + ' 必须在 keys-audit 登记');
    }
    assert.ok(read(V255).includes("needsimApp: 'needsim'"), 'v255 dirMap 必须登记 needsim 目录');
    const css = read(PHONE_CSS);
    assert.ok(css.includes('[v3.41.0] 需求沙盘'), 'phone.css 必须有本版段头');
    assert.ok(css.includes('.nsm-root'), 'phone.css 必须贴上本件样式正文');
    assert.ok(css.indexOf('[v3.41.0] 需求沙盘') < css.indexOf('[v3.40.0] 对话水壶'),
        '本版段必须在 v3.40.0 段之前（最新版在最前）');
});

test('C3 样式段头独立成行（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(PHONE_CSS);
    const idx = css.indexOf('[v3.41.0] 需求沙盘');
    assert.ok(idx > 0);
    const lineStart = css.lastIndexOf(NL, idx) + 1;
    const lineEnd = css.indexOf(NL, idx);
    const line = css.slice(lineStart, lineEnd);
    assert.ok(line.startsWith('/*'), '段头行必须以块注释起头，实测：' + line.slice(0, 40));
    assert.ok(line.trimEnd().endsWith('*/'), '段头行必须以块注释收尾，实测：' + line.slice(-40));
    assert.ok(lineStart === 0 || css[lineStart - 1] === NL, '段头不许接在上一段尾后');
    assert.equal(line.split('/*').length, 2, '段头行只许有一个块注释起头');
});

test('C4 源文件与 phone.css 段必须逐字同源（手工改两处必会再犯）', () => {
    const src = read(NS_CSS).trim();
    const css = read(PHONE_CSS);
    assert.ok(css.includes(src), 'needsim.css 正文必须逐字出现在 phone.css 的本版段里');
    /* 段头里的段名要与源文件名对得上（抄别件的段名会让下一个回灌脚本找错段）。 */
    const head = css.slice(css.lastIndexOf('/*', css.indexOf('[v3.41.0] 需求沙盘')), css.indexOf(NL, css.indexOf('[v3.41.0] 需求沙盘')));
    assert.ok(head.includes('needsim'), '段头要标明件名，实测：' + head);
});

test('C5 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const v = read(NS_VIEW);
    const a = read(NS_APP);
    const members = new Set();
    for (const m of a.matchAll(/^ {4}([a-zA-Z_$][\w$]*)\(/gm)) members.add(m[1]);
    const used = new Set();
    for (const m of v.matchAll(/\bapp\.([a-zA-Z_$][\w$]*)/g)) used.add(m[1]);
    assert.ok(used.size >= 15, '视图调用面要像话，实测 ' + used.size);
    const missing = [...used].filter((x) => !members.has(x));
    assert.deepEqual(missing, [], '视图调用了 App 上不存在的口：' + missing.join(', '));
});

test('C6 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const v = read(NS_VIEW);
    const css = read(NS_CSS);
    const names = new Set();
    for (const m of v.matchAll(/nsm-[a-z0-9-]+/g)) names.add(m[0]);
    const stems = [...names].filter((x) => x.endsWith('-'));
    for (const sy of stems) assert.ok(css.includes('.' + sy), '拼接族必须有样式落点：' + sy);
    const missing = [];
    for (const n of names) {
        if (n.endsWith('-')) continue;
        if (css.includes('.' + n)) continue;
        missing.push(n);
    }
    assert.deepEqual(missing, [], '视图产出的类没样式落点：' + missing.join(', '));
});

/* ══════════════════════ D — 四块不缝 ══════════════════════ */
test('D1 不碰模型：三件里一个网络调用都没有（源 refreshSims 直读本地存储三密钥走 fetch）', () => {
    for (const rel of [NS_DATA, NS_APP, NS_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
        assert.equal(/\bapiKey\b/i.test(code), false, rel + ' 不许读 apiKey');
        assert.equal(/\bAuthorization\b/i.test(code), false, rel + ' 不许出现 Authorization');
        assert.equal(/\bselectedModel\b/i.test(code), false, rel + ' 不许读 selectedModel');
        assert.equal(/\bapiUrl\b/i.test(code), false, rel + ' 不许读 apiUrl');
    }
});

test('D2 不碰宿主对象、不落数据库、不跨 App 读（源直读 roles 与宿主消息流）', () => {
    for (const rel of [NS_DATA, NS_APP, NS_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['indexedDB', 'localStorage', 'sessionStorage', 'window.VirtualPhone',
            'getUserPersona', 'currentChatRole', 'addMessage', 'parent.document']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
        assert.equal(/\bglobalThis\b/.test(code), false, rel + ' 不许摸 globalThis');
    }
    /* 也不许跨 App 读别的模块（只许读同目录三件与 num-gate）。 */
    const app = read(NS_APP);
    const imports = [...app.matchAll(/from '[^']+'/g)].map((m) => m[0]);
    for (const im of imports) {
        assert.ok(im.includes('./needsim-data.js') || im.includes('./needsim-view.js') || im.includes('num-gate.js'),
            'App 不许 import 别的东西：' + im);
    }
});

test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名', () => {
    for (const rel of [NS_DATA, NS_APP, NS_VIEW, NS_CSS]) {
        const code = stripComments(read(rel));
        for (const bad of ['http://', 'https://', 'data:', 'base64', '.png', '.jpg', '.webp', '.gif', 'Blob', 'FileReader']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
    }
});

test('D4 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const app = read(NS_APP);
    const code = stripComments(app);
    const hits = [...code.matchAll(/this\.storage\.([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]);
    assert.ok(hits.length >= 2, '必须真读真写，实测 ' + hits.length);
    assert.deepEqual([...new Set(hits)].sort(), ['get', 'set'], 'storage 只许 get / set');
});

/* ══════════════════════ E — 消费面 ══════════════════════ */
test('E1 数据层的每一条真源表与内核函数都必须被产品侧真消费（不许建好了零消费）', () => {
    const data = read(NS_DATA);
    const all = data + read(NS_APP) + read(NS_VIEW);
    const decls = [...data.matchAll(/^export (?:const|function) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    assert.ok(decls.length >= 40, '真源表与内核函数数目要像话，实测 ' + decls.length);
    /* ★ 消费面 = 数据层内部互用 + App + 视图 三处合集。
     *   零消费的判据是「全仓只出现在声明那一处」（建好了没人用）。 */
    const dead = decls.filter((d) => all.split(d).length - 1 <= 1);
    assert.deepEqual(dead, [], '数据层有零消费导出：' + dead.join(', '));
});

test('E2 手写键不许回潮：四态与定档的键面必须取真源', () => {
    const app = stripComments(read(NS_APP));
    assert.ok(app.includes('const FACE_OK = SIMS_FACES['), '面常量必须取真源');
    assert.equal(new RegExp('const FACE_OK\\s*=\\s*' + Q).test(app), false, '面常量不许手写');
    const view = stripComments(read(NS_VIEW));
    assert.ok(view.includes('FACE_TONE[SIMS_FACES['), '四态色相必须按真源逐态赋');
});

test('E3 视图不自己算内核（那是数据层与 App 的事）', () => {
    const view = stripComments(read(NS_VIEW));
    for (const bad of ['Math.round', 'Math.floor', 'Math.max', 'JSON.parse', 'JSON.stringify', 'clampNeed', 'sanitizeEffects']) {
        assert.equal(view.includes(bad), false, '视图不许自己算：' + bad);
    }
    /* 视图只许从数据层取**键面真源**（清单由 App 现算给出）。 */
    const imports = [...read(NS_VIEW).matchAll(/from '[^']+'/g)].map((m) => m[0]);
    assert.ok(imports.length >= 1 && imports.every((x) => x.includes('./needsim-data.js')), '视图的 import 面：' + imports.join(','));
});

/* ══════════════════════ F — 视图层 ══════════════════════ */
test('F1 四态必须分开画：视图画出四态人话与四色徽章（不许塔成一句）', () => {
    const v = read(NS_VIEW);
    assert.ok(v.includes('faceTextOf('), '面文案必须从 App 取');
    assert.ok(v.includes('poolTextOf('), '池子四态文案必须从 App 取');
    assert.ok(v.includes('wishTextOf(') || v.includes('stateText'), '愿望四态文案必须画出来');
    /* 四态四色：逐态抽出色相（塔成一色就算四态在用户眼里同形）。 */
    const tones = [];
    for (const m of stripComments(v).matchAll(/FACE_TONE\[SIMS_FACES\[(\d)\]\] = '([a-z]+)';/g)) tones.push(m[2]);
    assert.equal(tones.length, 4, '四态要逐态赋色');
    assert.ok(new Set(tones).size >= 3, '四态不许全同色');
    /* 池子四态逐格画：不是只画「有 / 没有」。 */
    assert.ok(read(NS_CSS).includes('.nsm-pool-partial'), '池子「缺」这一态必须有样式落点');
    assert.ok(read(NS_CSS).includes('.nsm-pool-malformed'), '池子「认不出来」这一态必须有样式落点');
    /* 愿望过期与没有不同形：两个状态各有一个色相类。 */
    assert.ok(read(NS_CSS).includes('.nsm-wish-stale'));
    assert.ok(read(NS_CSS).includes('.nsm-wish-absent'));
});

test('F2 空与坏不同形：同一句话不许两种处境共用（且逗号表达式坑不许回潮）', () => {
    const v = read(NS_VIEW);
    const code = stripComments(v);
    /* 计数在取不出来时画横线而不是零。 */
    assert.ok(code.includes('? DASH :'), '空与坏要有横线形态（null 画横线而不是零）');
    /* 读数取不出来时线条数与合计要画横线（读数为 null 走 _count）。 */
    assert.ok(code.includes('_count(rd ? rd.lines : null)'), '台词总数在读数拿不到时要画横线');
    assert.ok(code.includes('app.summaryLine()'), '概览必须取 App 现算（存储不可用时有专门的话）');
    /* ★ 逗号表达式坑：`bits.push(... + r.x ? a : b)` 会把拼串变成逗号表达式。 */
    assert.equal(new RegExp('\\)\\s*,' + NL).test(code), false, '视图里不许有三目逗号表达式');
    /* 空态那句话必须来自 App 的现算（不许写死一句「还没有」两种处境共用）。 */
    assert.ok(code.includes('faceTextOf'), '空态文案必须取 App 现算');
});

test('F3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const v = read(NS_VIEW);
    assert.ok(v.includes('String.fromCharCode(34)'), '双引号要走拼装形');
    assert.ok(v.includes('String.fromCharCode(38)'), '与号要走拼装形');
    assert.ok(v.includes('String.fromCharCode(39)'), '单引号要走拼装形');
    /* 剥注释器两向自证放在 J1（那里会实测尾随哨兵）。 */
});

test('F4 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const v = read(NS_VIEW);
    for (const f of ['_doFail', '_evFail', '_wishFail', '_ingestFail']) {
        assert.ok(v.includes(f + '('), '失败面缺 ' + f);
    }
    /* 台账保留数填了不收要当场说。 */
    assert.ok(stripComments(v).includes('不收'), '坏值被拒要当场说');
    /* 收拾不了要说坏在哪一步。 */
    assert.ok(stripComments(v).includes('whyLabel'), '失败因要用人话标签');
});

test('F5 点卡片要能打开：判定必须向上找祖先（不许只认直点元素）', () => {
    const code = stripComments(read(NS_VIEW));
    assert.ok(code.includes('const climb = (from, pred)'), '卡片判定要有向上找祖先的口');
    const ia = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-act' + Q + '))');
    const ic = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-open' + Q + ')');
    assert.ok(ia > 0 && ic > 0, '两个动作口都要走 climb');
    assert.ok(ia < ic, '★ 顺序：动作按钮先于卡片（按钮在卡片内部，先判卡片会把按钮吃掉）');
    /* 页签也要走 climb。 */
    assert.ok(code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-tab' + Q + '))') > 0);
});

/* ══════════════════════ G — 会话键 ══════════════════════ */
test('G1 四条会话键在 keys-audit 登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    for (const k of ['needsim_needs', 'needsim_pool', 'needsim_journal', 'needsim_ledger']) {
        const i = keys.indexOf(Q + k + Q);
        assert.ok(i > 0, k + ' 必须在册');
        const seg = keys.slice(i, i + 160);
        assert.ok(seg.includes('scope: ' + Q + 'chat' + Q), k + ' 的 scope 必须是 chat（否则跨会话串味）');
    }
    assert.ok(read(STORAGE).includes('/^needsim_/'), '宽匹配族要在场（一条前缀盖四键）');
});

test('G2 四条键真被产品消费（写面必须落到这四条上）', () => {
    const app = read(NS_APP);
    for (const k of ['needsim_needs', 'needsim_pool', 'needsim_journal', 'needsim_ledger']) {
        assert.ok(app.includes(Q + k + Q), k + ' 必须在 App 里真用');
    }
    const a = newApp(fullStorage());
    a.resetNeeds();
    a.performAction('snack');
    a.setLedgerKeep(5);
    assert.ok(a.readings() !== null, '写完之后读数要取得到');
});

/* ══════════════════════ H — 换会话 ══════════════════════ */
test('H1 换会话必须全量重取 + 清视图态（源把这些放在没有角色维度的键下，切角色原样留着）', () => {
    const app = read(NS_APP);
    const i = app.indexOf('    onChatChanged() {');
    assert.ok(i > 0);
    const rest = app.slice(i + 20);
    const endRel = rest.indexOf(NL + '    }' + NL);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    assert.ok(body.includes('this.probe()'), '换会话必须重取读数（四格的装载由 probe 一处承担）');
    assert.ok(body.includes('this._draft = '), '换会话必须清要求文本草稿');
    assert.ok(body.includes('this._current = '), '换会话必须清详情态');
    assert.ok(body.includes('this._tab = '), '换会话必须把页签收回');
    /* ★ 单一装载路径：四格不许有第二处装载口（双口径必然分岔）。
     *   定义处各 1 次 + probe 里各 1 次 = 2 次为上限。 */
    for (const m of ['this._loadNeeds(', 'this._loadPool(', 'this._loadMemoriesAndWish(', 'this._loadLedger(', 'this._loadPolicy(']) {
        assert.ok(app.split(m).length - 1 <= 2, m + ' 不许有第二处装载口（双口径）');
    }
});

test('H2 无 storage 也不许崩：四格一起报「取不出来」', () => {
    for (const st of [null, undefined, {}, { get: () => null }, { set: () => {} }, hostileStorage()]) {
        const a = newApp(st);
        assert.equal(a.faceOf(), DAT.SIMS_FACES[3]);
        assert.equal(a.probe(), null);
        assert.equal(a.summaryLine(), '读数拿不到（存储不可用）');
        /* 动作口在存储不可用时也不许崩（点了就是错，但要报得出来）。 */
        assert.equal(a.performAction('snack').ok, false);
        assert.equal(a.triggerEvent().ok, false);
    }
});

/* ====================== I — 负控制（破坏必须可观测） ====================== */
/** 数据层判据（加载**真破坏副本**后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 需求读不出来不许当 5。 */
    for (const v of ['abc', null, undefined, NaN, {}]) {
        if (mod.clampNeed(v).ok !== false) bad.push('need-unreadable-collapsed');
    }
    const ro = mod.needsReadout({ hunger: 80, energy: 'x' });
    if (ro.rows.find((x) => x.key === 'energy').value !== null) bad.push('need-unreadable-value-leaked');
    if (ro.rows.find((x) => x.key === 'energy').level !== '') bad.push('need-unreadable-level-leaked');
    /* ② 心情缺项不许落最差档。 */
    const partial = Object.assign({}, fullNeeds);
    delete partial.social;
    const m = mod.moodOf(partial);
    if (m.ok !== false) bad.push('mood-partial-not-reported');
    if (m.label === mod.SIMS_MOOD_META[mod.SIMS_MOODS[3]].label) bad.push('mood-partial-worst');
    /* ③ 效果四件事要逐条报。 */
    const s = mod.sanitizeEffects({ hunger: 20, bogus: 5, energy: 'x', fun: 0, social: 999 });
    const whys = s.rejected.map((x) => x.why).sort().join(',');
    if (!whys.includes('unknown_need')) bad.push('effect-unknown-swallowed');
    if (!whys.includes('not_number')) bad.push('effect-not-number-swallowed');
    if (!whys.includes('zero')) bad.push('effect-zero-swallowed');
    if (!whys.includes('clamped')) bad.push('effect-clamp-unreported');
    /* ④ 池子四态不许塌成一态。 */
    const P = mod.SIMS_POOL_STATES;
    if (new Set(P).size !== 4) bad.push('pool-states-collapsed');
    const pool = mod.normalizePool({ actions: { snack: ['a', 'b', 'c'], nap: ['a'], bath: 'x', play: [] } });
    if (pool.faces.nap === pool.faces.snack) bad.push('pool-partial-collapsed');
    if (pool.faces.bath === pool.faces.snack) bad.push('pool-malformed-collapsed');
    if (pool.faces.play === pool.faces.chat) bad.push('pool-empty-vs-written-collapsed');
    if (pool.faces.play !== P[3]) bad.push('pool-empty-vs-written-collapsed');
    /* ⑤ 游标绕回不许无痕迹。 */
    const w = mod.nextFromPool(['a', 'b', 'c'], 3);
    if (w.wrapped !== true || w.wrap !== 1) bad.push('cursor-wrap-unreported');
    if (mod.nextFromPool(['a'], -1).badCursor !== true) bad.push('bad-cursor-unreported');
    /* ⑥ 愿望四态不许同形。 */
    const W = mod.SIMS_WISH_STATES;
    if (new Set(W).size !== 4) bad.push('wish-states-collapsed');
    const stale = mod.parseSavedWish(JSON.stringify({ title: 't', desc: 'd', date: '2020-01-01' }), '2026-10-05');
    if (stale.state === W[2]) bad.push('wish-stale-collapsed-into-absent');
    if (stale.state !== W[1]) bad.push('wish-stale-lost');
    if (!stale.stale) bad.push('wish-stale-content-lost');
    /* ⑦ 记忆满了不许整本清空。 */
    const list = [];
    for (let i = 0; i < mod.SIMS_MEMORY_LIMIT; i += 1) list.push({ title: 't' + i, text: 'x' });
    const add = mod.addMemory(list, { title: 'new', text: 'y' }, mod.SIMS_MEMORY_LIMIT);
    if (add.list.length !== mod.SIMS_MEMORY_LIMIT) bad.push('memory-limit-lost');
    if (add.evicted !== 1) bad.push('memory-evict-unreported');
    if (!add.list.some((x) => x.title === 't1')) bad.push('memory-wiped-all');
    /* ⑧ 未来时间戳不许夹成「刚刚」。 */
    const now = Date.now();
    if (mod.memoryAgeOf(now + 60000, now).ok !== false) bad.push('future-stamp-clamped');
    /* ⑨ 回信五种失败因不许塌。 */
    if (Object.keys(mod.SIMS_REPLY_WHYS).length < 5) bad.push('reply-whys-collapsed');
    if (mod.parseReply('hello', {}).why !== 'no_object') bad.push('no-object-why-lost');
    if (mod.parseReply('{oops}', {}).why !== 'bad_json') bad.push('bad-json-why-lost');
    /* ⑩ 面四态不许塌。 */
    if (mod.faceOf(false, false, false) === mod.faceOf(true, false, true)) bad.push('face-absent-collapsed');
    if (mod.faceOf(true, false, false) === mod.faceOf(true, false, true)) bad.push('face-empty-collapsed');
    /* ⑪ 真源表条目不许少。 */
    if (mod.SIMS_NEED_KEYS.length !== 6) bad.push('need-keys-collapsed');
    if (mod.SIMS_ACTION_IDS.length !== 6) bad.push('action-ids-collapsed');
    if (mod.SIMS_LEVELS.length !== 4) bad.push('levels-collapsed');
    /* ⑫ 按最弱项定愿望：缺项要拒。 */
    if (mod.buildWish({ hunger: 80 }, '2026-10-05').ok !== false) bad.push('wish-build-accepted-missing');
    return bad;
};

/** App 面判据（在**破坏副本**上真的 new 一个 App 跑）。 */
const appFaceProblems = (mod) => {
    const bad = [];
    /* ★ 面键取**数据层**的（App 模块只导出类）：从 mod 取会拿到 undefined
     *   而让比较恒真——判据变成「恒红」，对照组就会假绿。 */
    const F = DAT.SIMS_FACES;
    const a = new mod.NeedsimApp(shellStub(), hostileStorage());
    if (a.faceOf() !== F[3]) bad.push('storage-absent-lost');
    if (a.probe() !== null) bad.push('projection-not-null-on-absent');
    if (a.readings() !== null) bad.push('readings-not-null-on-absent');
    for (const r of a.needRows()) if (r.value !== null) bad.push('need-value-not-null-on-absent');
    const ok = new mod.NeedsimApp(shellStub(), memStorage());
    if (ok.faceOf() !== F[1]) bad.push('empty-face-lost');
    const bad4 = new mod.NeedsimApp(shellStub(), memStorage({ needsim_needs: '{bad' }));
    if (bad4.faceOf() !== F[2]) bad.push('malformed-face-lost');
    bad4.probe();
    if (bad4.faceOf() !== F[2]) bad.push('malformed-face-lost');
    return bad;
};

const appContentProblems = (mod) => {
    const bad = [];
    const a = new mod.NeedsimApp(shellStub(), fullStorage());
    /* 点行动：五件事都要真做。 */
    const r = a.performAction('snack');
    if (r.ok !== true) bad.push('action-ok-lost');
    if (a.memoryRows().length !== 1) bad.push('action-memory-lost');
    if (a.receiptRows().length !== 1) bad.push('action-receipt-lost');
    if (a.receiptRows()[0] && a.receiptRows()[0].kind !== 'action') bad.push('receipt-kind-lost');
    /* 池空 / 池坏都要分因。 */
    if (a.performAction('nope').reason !== 'unknown_action') bad.push('unknown-action-accepted');
    /* 记忆满了要在回执里报。 */
    const b = new mod.NeedsimApp(shellStub(), fullStorage());
    for (let i = 0; i < 11; i += 1) b.performAction('snack');
    if (b.memoryRows().length !== DAT.SIMS_MEMORY_LIMIT) bad.push('memory-limit-lost');
    if (!b.receiptRows().some((x) => x.evicted > 0)) bad.push('evict-unreported');
    /* 愿望过期要看得见内容。 */
    const c = new mod.NeedsimApp(shellStub(), fullStorage({
        needsim_journal: JSON.stringify({ memories: [], wish: { title: 't', desc: 'd', date: '2020-01-01' } })
    }));
    if (c.wishRow().state !== DAT.SIMS_WISH_STATES[1]) bad.push('wish-stale-lost');
    if (c.wishRow().has !== false) bad.push('wish-stale-counted-as-today');
    if (c.wishRow().title !== 't') bad.push('wish-stale-content-lost');
    return bad;
};

const appGateProblems = (mod) => {
    const bad = [];
    const a = new mod.NeedsimApp(shellStub(), fullStorage());
    for (const v of [0, -3, 1.5, 'abc', null, undefined, 9999]) {
        if (a.setLedgerKeep(v).took !== DAT.SIMS_MAX_UNITS) bad.push('keep-fallback-lost');
    }
    if (a.setLedgerKeep(2).took !== 2) bad.push('keep-ok-lost');
    /* ★ 填了不收必须回显原值（用户得知道「我填的没被采纳」）。 */
    if (a.setLedgerKeep('abc').saw !== 'abc') bad.push('keep-saw-lost');
    /* 手存愿望的三种拒因。 */
    if (a.setWish({ desc: 'd' }).reason !== 'no_title') bad.push('no-title-accepted');
    if (a.setWish({ title: 't' }).reason !== 'no_desc') bad.push('no-desc-accepted');
    if (a.setWish(null).reason !== 'empty_input') bad.push('empty-wish-accepted');
    /* 回信失败五因。 */
    if (a.ingestReply('').reason !== 'empty_input') bad.push('empty-reply-accepted');
    if (a.ingestReply('hello').reason !== 'no_object') bad.push('no-object-reply-accepted');
    if (a.ingestReply('{' + DQ + 'a' + DQ + ':1').reason !== 'unbalanced') bad.push('unbalanced-reply-accepted');
    if (a.ingestReply('{oops}').reason !== 'bad_json') bad.push('bad-json-reply-accepted');
    /* 越界拒。 */
    if (a.openMemory(9).ok !== false) bad.push('out-of-range-accepted');
    return bad;
};

const appChatProblems = (mod) => {
    const bad = [];
    const st = sessionStorage();
    const app = new mod.NeedsimApp(shellStub(), st);
    app.resetNeeds();
    app.performAction('snack');
    app.setLedgerKeep(3);
    app.openMemory(0);
    st.switchTo('c2');
    app.onChatChanged();
    if (app.readings() !== null && app.readings().memories !== 0) bad.push('chat-change-no-memory-reload');
    if (app.receiptRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    if (app.ledgerKeepOf() !== DAT.SIMS_MAX_UNITS) bad.push('chat-change-no-policy-reload');
    if (app.currentKey() !== '') bad.push('chat-change-no-detail-reset');
    if (app.tab() !== 'needs') bad.push('chat-change-no-tab-reset');
    if (app.needRows().find((x) => x.key === 'hunger').value !== null) bad.push('chat-change-no-needs-reload');
    return bad;
};

/** 结构面判据（手写键面 / 视图形态 —— 本仓 J7 那一族，只能静态判）。 */
const appHandKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const FACE_OK = SIMS_FACES[')) bad.push('face-constant-handwritten');
    if (new RegExp('const FACE_OK\\s*=\\s*' + Q).test(code)) bad.push('face-constant-handwritten');
    return bad;
};

const viewFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('FACE_TONE[SIMS_FACES[')) bad.push('face-tone-not-by-source');
    const tones = [];
    for (const m of code.matchAll(/FACE_TONE\[SIMS_FACES\[(\d)\]\] = '([a-z]+)';/g)) tones.push(m[2]);
    if (tones.length !== 4) bad.push('face-tone-not-by-source');
    else if (new Set(tones).size < 3) bad.push('face-tone-not-by-source');
    if (!code.includes('app.faceTextOf(')) bad.push('face-text-not-from-app');
    return bad;
};

const viewCardProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const climb = (from, pred)')) bad.push('card-climb-lost');
    const ia = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-act' + Q + '))');
    const ic = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-open' + Q + ')');
    if (!(ia > 0 && ic > 0 && ia < ic)) bad.push('card-climb-order-lost');
    return bad;
};

const viewEmptyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    /* 空与坏不同形：计数位在**取不出来时传 null**、由 _count 画横线而不是零。 */
    if (!code.includes('? DASH :')) bad.push('empty-and-bad-collapsed');
    if (!code.includes('_count(')) bad.push('empty-and-bad-collapsed');
    if (!code.includes(': null)')) bad.push('empty-and-bad-collapsed');
    return bad;
};

const viewCommaProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (new RegExp('\\)\\s*,' + NL).test(code)) bad.push('trailing-comma-expression');
    return bad;
};

/** 破坏表：每一条破坏都必须**语义可观测**（不是装饰）。 */
const DAMAGE = {
    /* ① 需求坏值回落成可用的 5（源就是回落 5 还照画进度条）。 */
    q1: [NS_DATA,
        '    if (n === null) {' + NL + "        return { ok: false, why: 'not_number',",
        '    if (false) {' + NL + "        return { ok: false, why: 'not_number',"],
    /* ② 心情缺项落最差档（源就是六项不齐即「非常不开心」）。 */
    q2: [NS_DATA,
        "            return { ok: false, mood: '', label: SIMS_MOOD_UNKNOWN, avg: null, why: 'need_unreadable' };",
        "            return { ok: true, mood: SIMS_MOODS[3], label: SIMS_MOOD_META[SIMS_MOODS[3]].label, avg: null, why: 'ok' };"],
    /* ③ 零变化也照收（源静默丢弃，本件要报出来）。 */
    q3: [NS_DATA,
        '        if (r === 0) {',
        '        if (false) {'],
    /* ④ 池子「缺」与「齐」塔平。 */
    q4: [NS_DATA,
        '        else if (kept.length < SIMS_LINE_LIMIT) faces[a] = SIMS_POOL_STATES[1];',
        '        else if (false) faces[a] = SIMS_POOL_STATES[1];'],
    /* ⑤ 游标绕回不报（源取模后不报）。 */
    q5: [NS_DATA,
        '    const wrap = Math.floor(idx / arr.length);',
        '    const wrap = 0;'],
    /* ⑥ 愿望过期与「今天没有」同形（源只判存在）。 */
    q6: [NS_DATA,
        "            state: SIMS_WISH_STATES[1], wish: null, why: 'stale',",
        "            state: SIMS_WISH_STATES[2], wish: null, why: 'absent',"],
    /* ⑦ 记忆满了整本清空（源就是 simsMemories = []）。 */
    q7: [NS_DATA,
        '    while (arr.length > lim) { arr.pop(); evicted += 1; }',
        '    if (arr.length > lim) { arr.length = 0; evicted = 0; }'],
    /* ⑧ 未来时间戳夹成「刚刚」（源就是这样）。 */
    q8: [NS_DATA,
        "    if (diff < 0) return { ok: false, why: 'future', label: '" + '时间戳在未来' + "', minutes: null };",
        "    if (diff < 0) return { ok: true, why: 'ok', label: '刚刚', minutes: 0 };"],
    /* ⑨ 面三态塔平（源把「写了但认不出来」当空）。 */
    q9: [NS_DATA,
        '    if (bad === true) return SIMS_FACES[2];',
        '    if (false) return SIMS_FACES[2];'],
    /* ⑩ 需求读数给回落值（视图据此画一根 5% 的条）。 */
    q10: [NS_DATA,
        '            value: r.ok ? r.value : null, ok: r.ok, why: r.why,',
        '            value: r.value, ok: r.ok, why: r.why,'],
    /* ⑪ 按最弱项定愿望时不拒缺项（源拿 NaN 也照定）。 */
    q11: [NS_DATA,
        '    if (unknown > 0 || !lowest) {',
        '    if (false) {'],
    /* ⑫ 回信里没有对象时塌成「都没给」（源在这一步抛异常并吞掉）。 */
    q12: [NS_DATA,
        "    if (start < 0) return { ok: false, why: 'no_object', json: '', start: -1, end: -1, truncated: false };",
        "    if (start < 0) return { ok: false, why: 'bad_json', json: '', start: -1, end: -1, truncated: false };"],
    /* ⑬ App：取不出来当没事（源把取不到读成空）。 */
    q13: [NS_APP,
        '        const storageOk = !!(rn.ok && rp.ok && rj.ok && rl.ok);',
        '        const storageOk = true;'],
    /* ⑭ App：「写了但认不出来」不再单列（源就是把它当空）。 */
    q14: [NS_APP,
        '            if (this._loadNeeds(rn)) this._needsBad = true;',
        '            if (false) this._needsBad = true;'],
    /* ⑮ App：保留数取值门塔平（坏值照收）。 */
    q15: [NS_APP,
        '    if (n === null || !Number.isInteger(n) || n < 1) return fb;',
        '    if (false) return fb;'],
    /* ⑯ App：换会话不再重取（四格全留着 —— 源就是切角色原样留着）。 */
    q16: [NS_APP,
        '        this.probe();' + NL + '        if (this._view) this._view.refresh();' + NL + '    }' + NL + '    render() {',
        '        if (false) this.probe();' + NL + '        if (this._view) this._view.refresh();' + NL + '    }' + NL + '    render() {'],
    /* ⑰ App：点行动不落记忆（源是往宿主消息流里塞，本件落自己的记忆流）。 */
    q17: [NS_APP,
        '        this.memories = mem.list;' + NL + '        const done = this._wishDoneBy(meta.effects, aid);',
        '        this.memories = [];' + NL + '        const done = this._wishDoneBy(meta.effects, aid);'],
    /* ⑱ App：四态取值互不相同也要守住（塌一档就同形）。
     *   ★ 这条破坏**数据层**：把池子「缺」与「认不出来」并成一态，
     *     于是 App 的 actionRows 也跟着同形。 */
    q18: [NS_DATA,
        '        if (!kept.length) faces[a] = SIMS_POOL_STATES[3];',
        '        if (!kept.length) faces[a] = SIMS_POOL_STATES[1];'],
    /* ⑲ App：坏值被拒时不再回显原值（用户不知道自己填的没被采纳）。 */
    q19: [NS_APP,
        '        return { ok: true, saw: saw, took: this.ledgerKeep, max: SIMS_MAX_UNITS };',
        '        return { ok: true, saw: this.ledgerKeep, took: this.ledgerKeep, max: SIMS_MAX_UNITS };'],
    /* ★ 面常量手写（本仓 J7 形态）单独一条负控制（结构面判据守的那一族）。 */
    q23: [NS_APP,
        'const FACE_OK = SIMS_FACES[0];',
        'const FACE_OK = ' + Q + 'ok' + Q + ';'],
    /* ⑳ 视图：面色相塔平（四态只有一种色）。 */
    q20: [NS_VIEW,
        "FACE_TONE[SIMS_FACES[2]] = 'err';",
        'FACE_TONE[SIMS_FACES[2]] = FACE_TONE[SIMS_FACES[0]];'],
    /* ㉑ 视图：卡片判定退回直点元素。 */
    q21: [NS_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);",
        "            const cardEl = (t.getAttribute('data-open') !== null) ? t : null;"],
    /* ㉒ 视图：空与坏塔成一话（null 也当零画）。 */
    q22: [NS_VIEW,
        '        return (v === null || v === undefined) ? DASH : String(v);',
        '        return String(v === null || v === undefined ? 0 : v);'],
};

/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3410_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    const kd = path.join(dir, 'apps', 'needsim');
    fs.mkdirSync(kd, { recursive: true });
    for (const f of ['needsim-data.js', 'needsim-view.js', 'needsim-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'needsim', f), path.join(kd, f));
    }
    return dir;
}

/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「需求读不出来不许当 5」⇒ 内核判据必须转红', 'q1', 'data', dataProblems, ['need-unreadable-collapsed', 'need-unreadable-value-leaked']],
    ['I2 破坏「心情缺项不许落最差档」⇒ 内核判据必须转红', 'q2', 'data', dataProblems, ['mood-partial-not-reported', 'mood-partial-worst']],
    ['I3 破坏「零变化要报出来」⇒ 内核判据必须转红', 'q3', 'data', dataProblems, ['effect-zero-swallowed']],
    ['I4 破坏「池子四态不许塔平」⇒ 内核判据必须转红', 'q4', 'data', dataProblems, ['pool-partial-collapsed']],
    ['I5 破坏「游标绕回不许无痕迹」⇒ 内核判据必须转红', 'q5', 'data', dataProblems, ['cursor-wrap-unreported']],
    ['I6 破坏「愿望过期不许与今天没有同形」⇒ 内核判据必须转红', 'q6', 'data', dataProblems, ['wish-stale-collapsed-into-absent', 'wish-stale-lost']],
    ['I7 破坏「记忆满了不许整本清空」⇒ 内核判据必须转红', 'q7', 'data', dataProblems, ['memory-wiped-all', 'memory-evict-unreported']],
    ['I8 破坏「未来时间戳不许夹成刚刚」⇒ 内核判据必须转红', 'q8', 'data', dataProblems, ['future-stamp-clamped']],
    ['I9 破坏「面四态不许塔平」⇒ 内核判据必须转红', 'q9', 'data', dataProblems, ['face-empty-collapsed']],
    ['I10 破坏「需求读数不许泄回落值」⇒ 内核判据必须转红', 'q10', 'data', dataProblems, ['need-unreadable-value-leaked']],
    ['I11 破坏「定愿望缺项要拒」⇒ 内核判据必须转红', 'q11', 'data', dataProblems, ['wish-build-accepted-missing']],
    ['I12 破坏「回信失败因不许塌」⇒ 内核判据必须转红', 'q12', 'data', dataProblems, ['no-object-why-lost']],
    ['I13 破坏「取不出来不许当空」（App）⇒ 行为判据必须转红', 'q13', 'appmod', appFaceProblems,
        ['storage-absent-lost', 'projection-not-null-on-absent', 'readings-not-null-on-absent']],
    ['I14 破坏「写了但认不出来单列」（App）⇒ 行为判据必须转红', 'q14', 'appmod', appFaceProblems, ['malformed-face-lost']],
    ['I15 破坏「保留数取值门」（App）⇒ 行为判据必须转红', 'q15', 'appmod', appGateProblems, ['keep-fallback-lost']],
    ['I16 破坏「换会话全量重取」（App）⇒ 行为判据必须转红', 'q16', 'appmod', appChatProblems,
        ['chat-change-no-needs-reload', 'chat-change-no-ledger-reload', 'chat-change-no-policy-reload']],
    ['I17 破坏「点行动要落记忆」（App）⇒ 行为判据必须转红', 'q17', 'appmod', appContentProblems, ['action-memory-lost']],
    ['I18 破坏「池子空与坏不同形」（数据层）⇒ 内核判据必须转红', 'q18', 'data', dataProblems,
        ['pool-empty-vs-written-collapsed', 'pool-malformed-collapsed']],
    ['I19 破坏「坏值被拒要回显原值」（App）⇒ 行为判据必须转红', 'q19', 'appmod', appGateProblems, ['keep-saw-lost']],
    ['I20 破坏「面常量取真源」（App）⇒ 结构面判据必须转红', 'q23', 'src', appHandKeyProblems, ['face-constant-handwritten']],
    ['I21x 破坏「面色相取真源」（视图）⇒ 视图判据必须转红', 'q20', 'src', viewFaceProblems, ['face-tone-not-by-source']],
    ['I22x 破坏「点卡片向上找祖先」（视图）⇒ 视图判据必须转红', 'q21', 'src', viewCardProblems, ['card-climb-lost', 'card-climb-order-lost']],
    ['I23 破坏「空与坏不同形」（视图）⇒ 视图判据必须转红', 'q22', 'src', viewEmptyProblems, ['empty-and-bad-collapsed']],
];

for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 60));
        const damaged = src.split(from).join(to);
        assert.notEqual(damaged, src, '破坏必须真的发生');
        if (kind === 'src') {
            const bad = judge(damaged);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(src), [], '对照：真源码必须干净');
            return;
        }
        const dir = stageTree();
        fs.writeFileSync(path.join(dir, rel), damaged);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href);
        const bad = judge(mod);
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        const real = (kind === 'data') ? DAT : APP;
        assert.deepEqual(judge(real), [], '对照：真模块必须干净');
    });
}

/* ====================== J - 判据工具自证 ====================== */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + NL + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.ok(stripComments('const s = ' + Q + 'fetch(' + Q + ';').includes('fetch('), '字符串里的同形文本必须留住');
    /* ★ 被审三件必须能让剥器复位（尾随哨兵）：剥完不许把哨兵也吃掉。 */
    for (const rel of [NS_DATA, NS_APP, NS_VIEW]) {
        const src = read(rel) + NL + 'const SENTINEL_TAIL = 1;' + NL;
        assert.ok(stripComments(src).trimEnd().endsWith('const SENTINEL_TAIL = 1;'),
            rel + ' 必须能让剥器复位（否则说明代码里有裸引号骗住了状态机）');
    }
});

test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, key + ' 的锚点必须恰中 1 次');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3410k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [NS_DATA, NS_APP, NS_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' 必须语法正确：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J4 十道静态门必须在场（含本版缺陷所属的那几道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts.check.includes(g), 'check 链必须含 ' + g + ' 门');
    }
});

test('J5 判据两向自证：真模块上每一条行为判据都必须干净（且真的会跑）', () => {
    assert.deepEqual(dataProblems(DAT), [], '数据层判据在真模块上必须干净');
    assert.deepEqual(appFaceProblems(APP), []);
    assert.deepEqual(appContentProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(appHandKeyProblems(read(NS_APP)), []);
    assert.deepEqual(viewFaceProblems(read(NS_VIEW)), []);
    assert.deepEqual(viewCardProblems(read(NS_VIEW)), []);
    assert.deepEqual(viewEmptyProblems(read(NS_VIEW)), []);
    assert.deepEqual(viewCommaProblems(read(NS_VIEW)), []);
});

/* ====================== K - 版本与交棒 ====================== */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 41),
        '本套件成立于 RubyPhone 3.41.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含本版号');
});

test('K2 交棒必须指向小鼠机余件的真实现状（路线图字面不成立时以实测为准）', () => {
    /* ★ 钉**本件自己那一版的 update-log 条目**，不钉 index.js 当前公告 ——
     *   公告随每次抬版整体重写（钉它等于给自己埋一条下一版必红的断言）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.41.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('需求沙盘'), 'v3.41.0 条目必须自述本件名');
    assert.ok(text.includes('xiaoshuji'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
    assert.ok(text.includes('netease'), '交棒必须指向小鼠机剩余两块');
});
