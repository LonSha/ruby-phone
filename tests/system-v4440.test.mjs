/* ============================================================
 * tests/system-v4440.test.mjs -- [v4.44.0 · 第五期 R5-O2 群投票确认后确实能建立日历事项]
 *
 * 验收口径（计划原文 R5-O2）：
 *   「群投票→确认安排→日历表单→取消不新建，提交后能打开同一事项；重复转交不双建；
 *     缺插件可只存日历并提示未登记记忆。」
 *   不做：「不把投票自动当承诺；不另建跨 App 消息总线。」
 *
 * 【本件治的缺陷形态（读码可复算，不是报错）】
 *   `apps/wechat/chat-view.js::confirmGroupVote` 派发 `phone:groupVoteConfirm` 后**立刻**
 *   弹「已转交日历确认」；而实测 `grep -rn 'GROUP_VOTE_CONFIRM' apps/ config/ index.js`
 *   只命中派发点本身与事件登记表 —— **接收者为 0**。且日历是懒加载 App
 *   （不在 `config/app-lazy-routes.js` 表内，属内联分支），用户没打开过日历时
 *   连实例都不存在。⇒ 那句提示是**谎报**，属本仓反复治过的「看起来没坏但显示不对」。
 *
 * 【本件判什么（六组）】
 *   A 口径：契约件纯函数零副作用 / 状态与标签唯一出处 / 两键命中 `^calendar_` /
 *          上限唯一出处 / 视图与宿主不自持第二份状态表
 *   B 契约件内核：合法归一 / 三态拒收 / 去重限量 / 幂等键跟随活动 id /
 *               活动名缺席退回选项 id（不编占位名）/ 读数五态互不同形 /
 *               「记忆未登记」只在该补时补（null ≠ false）
 *   C 两键读写件：落草稿→读回→消费即清→台账→判重 / **replayed 不再落草稿**（否则双建）/
 *               坏存储三出口降级不抛 / 自检真跑
 *   D 日历交接口：不替用户猜日期（无合法日期如实拒收且零写盘）/ 建成了才清草稿 /
 *               台账判重（第二次提交报 replayed 且不双建）/ 记忆未登记时日历仍成立
 *   E 接线：宿主真接收（监听器在场且走唯一常量）/ 回执同步写回微信侧 /
 *         微信侧念回执而不再无条件念「已转交」/ 视图提交走交接口、取消清凭据 /
 *         样式双侧投递（calendar.css + phone.css）
 *   F 负控制 + 版本锚：真源码副本定点破坏 ⇒ 同款判据必转红；五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「没建成」与「没登记」要分开判】把「不适用」读成「未登记」是另一种谎报。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/group-vote-handoff.js';
const STORE_REL = 'apps/calendar/vote-handoff-store.js';
const APP_REL = 'apps/calendar/calendar-app.js';
const VIEW_REL = 'apps/calendar/calendar-view.js';
const CHAT_REL = 'apps/wechat/chat-view.js';
const HOST_REL = 'index.js';
const NL = '\n';
const countOf = (s, sub) => s.split(sub).length - 1;
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const ST = await import(pathToFileURL(path.join(ROOT, STORE_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const kernelCode = stripComments(kernelSrc);
const storeSrc = read(STORE_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const chatSrc = read(CHAT_REL);
const hostSrc = read(HOST_REL);

/** 内存假存储（与真 `storage` 同形的三出口）。 */
function mkStorage(seed = {}) {
    const bag = new Map(Object.entries(seed));
    return {
        _bag: bag,
        get: (k, d) => (bag.has(k) ? bag.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); }
    };
}

/* ══════════ A ── 口径 ══════════ */
test('A1 契约件是纯函数：零 DOM / 零存储 / 零网络 / 零时钟', () => {
    for (const bad of ['document', 'window', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'setInterval', 'querySelector', 'Date.now', 'Math.random']) {
        assert.equal(kernelCode.indexOf(bad), -1, '交接契约件不得出现：' + bad);
    }
    assert.equal(kernelCode.indexOf('storage'), -1, '契约件不得摸存储（存草稿是 owner 的事）');
});

test('A2 状态与标签唯一出处：视图与宿主不自持第二份状态表', () => {
    /* 五态 id 在契约件里各只声明一次。 */
    for (const s of ['received', 'replayed', 'created', 'failed', 'unreceived']) {
        assert.equal(kernelCode.split("'" + s + "'").length - 1, 1,
            '状态字面量必须只出现一次（唯一出处）：' + s);
    }
    /* 视图不写第二份状态表：日历视图里一个状态字面量都不许有。 */
    for (const s of ['received', 'replayed', 'unreceived']) {
        assert.equal(viewSrc.indexOf("'" + s + "'"), -1, '日历视图不得自持状态字面量：' + s);
    }
    /* ★ 微信侧只许引用契约件常量，不许自持状态串。
     *   判据只扫**代码**（剥注释），且靶子收窄到「回执状态比较」这个形态：
     *   · 首版判整份源文 ⇒ 注释里说明用的那个词把判据自己顶红；
     *   · 收窄到代码后仍有一处**同名不同物**：R4-X7 既有的
     *     `voteReasonHint('replayed')`（投票内核的理由提示，与交接状态无关）。
     *     拿裸字面量当靶子会把那行正确代码判红，故改判「比较写法」。 */
    const chatCode = stripComments(chatSrc);
    assert.ok(chatCode.indexOf('GV_HANDOFF_STATES') >= 0,
        '微信侧必须引用契约件常量（而不是手写状态串）');
    assert.equal(/receipt\.state\s*===\s*'/.test(chatCode), false,
        '回执状态比较不得用字面量（应引用契约件常量）');
    /* 宿主侧同理：只许引用常量，不许手写**交接状态串**。
     *   ★ 靶子收窄到「当状态值用」的写法：`index.js` 是 13000 行的宿主，
     *     里面有一处既有的转账收款状态 `paymentStatus === 'received'` ——
     *     它与群投票交接毫无关系，拿裸字面量当靶子会把它判红（首版正是如此）。 */
    const hostCode = stripComments(hostSrc);
    assert.equal(/state:\s*'(received|replayed|created|failed|unreceived)'/.test(hostCode), false,
        '宿主不得手写交接状态串（应引用 GV_HANDOFF_STATES）');
    assert.ok(hostCode.indexOf('GV_HANDOFF_STATES') >= 0, '宿主必须引用契约件常量');
});

test('A3 两键是唯一实现且随会话隔离：都命中 ^calendar_', () => {
    const keys = Object.values(K.GV_HANDOFF_KEYS);
    assert.equal(keys.length, 2, '本项只该有两个键（草稿 + 台账）');
    const pat = /^calendar_/;
    for (const k of keys) assert.ok(pat.test(k), '两键必须命中 ^calendar_（随会话隔离）：' + k);
    /* 两键读写只有一份实现：App 侧不得再自己解析这两个键。
     *   ★ 靶子是**这两个键**，不是「文件里有没有 JSON.parse」——
     *     `calendar-app.js` 是 900 行的既有 App，它自己那套数据序列化（第 356 行）
     *     与群投票凭据无关；拿它当靶子会把既有的正确代码判红（判据过严）。 */
    for (const k of keys) {
        assert.equal(appSrc.indexOf("'" + k + "'"), -1, 'App 不得自己碰这两个键：' + k);
        assert.equal(viewSrc.indexOf("'" + k + "'"), -1, '视图不得自己碰这两个键：' + k);
    }
    assert.ok(appSrc.indexOf('vote-handoff-store.js') >= 0, 'App 必须委派两键读写件');
    assert.ok(hostSrc.indexOf('vote-handoff-store.js') >= 0, '宿主也必须委派同一件（不许各写一份）');
    /* 两键的 JSON 解析只许出现在那一件里（`readJson` 一处解析；`writeJson` 只序列化）。 */
    assert.equal(countOf(storeSrc, 'JSON.parse'), 1, 'JSON 解析只该有一处（readJson）');
    assert.equal(countOf(storeSrc, 'JSON.stringify'), 1, 'JSON 序列化只该有一处（writeJson）');
});

test('A4 上限与键名的唯一出处：视图不自己拟条数', () => {
    const L = K.GV_HANDOFF_LIMITS;
    for (const f of ['participants', 'title', 'place', 'optionId', 'activityId', 'applied']) {
        assert.ok(Number(L[f]) > 0, '上限表缺项：' + f);
    }
    /* ★ 视图不得把台账上限**当数用**（应问契约件）。
     *   修前首版扫的是裸子串 `'80'`，于是 `maxlength="80"` 这种既有的、与台账无关的
     *   属性把判据顶红了 —— 靶子必须收窄到「数字被当数用」的形态。 */
    assert.equal(new RegExp('(?<![\\w"=])' + L.applied + '(?![\\w"])').test(viewSrc), false,
        '视图不得出现台账上限数字（应问契约件）');
    assert.ok(viewSrc.indexOf('GV_HANDOFF_LIMITS') >= 0 || viewSrc.indexOf('pendingVoteHandoff') >= 0,
        '视图必须问契约件 / 两键读写件取凭据与上限');
});

/* ══════════ B ── 契约件内核 ══════════ */
test('B1 合法凭据归一：id 原样、参与者去空去重限量、幂等键跟随活动 id', () => {
    const n = K.normalizeHandoff({
        activityId: 'act_7', optionId: 'o3', round: 2,
        participants: ['甲', '乙', '甲', '', null, '丙'], label: '周五郊游'
    });
    assert.equal(n.ok, true);
    assert.equal(n.activityId, 'act_7');
    assert.equal(n.optionId, 'o3');
    assert.equal(n.round, 2);
    assert.deepEqual(n.participants, ['甲', '乙', '丙'], '去空 + 去重，顺序保持');
    assert.equal(n.title, '周五郊游');
    assert.equal(n.activityKey, n.activityId, '幂等键必须跟随活动 id');
    /* 超上限截断（不无限搬）。 */
    const many = K.normalizeHandoff({
        activityId: 'a', optionId: 'o',
        participants: Array.from({ length: K.GV_HANDOFF_LIMITS.participants + 10 }, (_, i) => 'n' + i)
    });
    assert.equal(many.participants.length, K.GV_HANDOFF_LIMITS.participants, '参与者必须限量');
});

test('B2 三态拒收各带归因词：非对象 / 缺活动 id / 缺选项', () => {
    const R = K.GV_HANDOFF_REASONS;
    assert.equal(K.normalizeHandoff('x').why, R.NOT_OBJECT);
    assert.equal(K.normalizeHandoff(null).why, R.NOT_OBJECT);
    assert.equal(K.normalizeHandoff([]).why, R.NOT_OBJECT);
    assert.equal(K.normalizeHandoff({ optionId: 'o1' }).why, R.NO_ACTIVITY);
    assert.equal(K.normalizeHandoff({ activityId: 'a1' }).why, R.NO_OPTION);
    for (const w of [R.NOT_OBJECT, R.NO_ACTIVITY, R.NO_OPTION]) {
        assert.ok(String(w).length > 0, '归因词不得为空');
    }
    assert.equal(new Set([R.NOT_OBJECT, R.NO_ACTIVITY, R.NO_OPTION]).size, 3, '三态归因词必须互不同形');
});

test('B3 活动名缺席时退回选项 id，不编占位名（否则用户以为这条日程有出处）', () => {
    const n = K.normalizeHandoff({ activityId: 'a2', optionId: 'o9' });
    assert.equal(n.title, 'o9', '必须退回选项 id');
    assert.equal(n.title.indexOf('群'), -1, '不得编「群活动」之类的占位名');
});

test('B4 读数五态互不同形，且两处关键口径必须明说', () => {
    const S = K.GV_HANDOFF_STATES;
    const lines = [
        K.handoffLine({ state: S.RECEIVED, handoff: K.normalizeHandoff({ activityId: 'a', optionId: 'o', label: 'T' }) }),
        K.handoffLine({ state: S.REPLAYED }),
        K.handoffLine({ state: S.CREATED, title: 'T' }),
        K.handoffLine({ state: S.UNRECEIVED }),
        K.handoffLine({ state: S.FAILED, why: K.GV_HANDOFF_REASONS.NO_ACTIVITY })
    ];
    assert.equal(new Set(lines).size, lines.length, '五态读数不得有同形的');
    assert.ok(lines[0].indexOf('还没成事项') >= 0, 'received 必须明说「还没成事项」（转交 ≠ 已约好）');
    assert.ok(lines[3].indexOf('没有接收者') >= 0, 'unreceived 必须明说「没有接收者」');
    assert.ok(lines[2].indexOf('已建立') >= 0, 'created 必须明说已建立');
});

test('B5 「记忆未登记」只在该补时补：false 才补，null 不补（不适用 ≠ 未登记）', () => {
    const S = K.GV_HANDOFF_STATES;
    const ok = K.handoffLine({ state: S.CREATED, title: 'T', memoryRegistered: true });
    const no = K.handoffLine({ state: S.CREATED, title: 'T', memoryRegistered: false });
    const na = K.handoffLine({ state: S.CREATED, title: 'T', memoryRegistered: null });
    assert.equal(ok, na, 'null（不适用）不得与 true 不同形');
    assert.notEqual(no, ok, '未登记必须与已登记不同形');
    assert.ok(no.indexOf('记忆未登记') >= 0);
    assert.ok(no.indexOf('已建立日历事项') >= 0, '未登记时日历这条仍成立（不得读成没建成）');
});

test('B6 契约件自检真跑（不是写「已检查」）：无 problems 且覆盖面在场', () => {
    const r = K.handoffSelfCheck();
    assert.deepEqual(r.problems, [], '契约件自检不得有问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 5, '五态必须在场');
    assert.ok(r.reasons >= 4, '归因词表必须在场');
    /* 纯函数被破坏时自检必须报（真跑一遍入参不变）。 */
    const input = { activityId: 'a', optionId: 'o', participants: ['甲'] };
    const snapshot = JSON.stringify(input);
    K.normalizeHandoff(input);
    assert.equal(JSON.stringify(input), snapshot, '归一不得改入参');
});

/* ══════════ C ── 两键读写件 ══════════ */
test('C1 落草稿 → 读回 → 消费即清（一次转交只喂一次表单）', () => {
    const st = mkStorage();
    const r = ST.receiveHandoff(st, { activityId: 'act_1', optionId: 'o1', label: '郊游' });
    assert.equal(r.state, K.GV_HANDOFF_STATES.RECEIVED);
    assert.ok(r.ok, '收下了');
    const p = ST.pendingHandoff(st);
    assert.equal(p.activityKey, 'act_1');
    const c = ST.consumeHandoff(st);
    assert.equal(c.activityKey, 'act_1', '取用拿到草稿');
    assert.equal(ST.pendingHandoff(st), null, '取用后草稿必须清');
    assert.equal(ST.consumeHandoff(st), null, '再取用不得凭空造一份');
});

test('C2 ★ 已建过的再收只报 replayed 且**不再落草稿**（否则表单预填已建活动 ⇒ 双建）', () => {
    const st = mkStorage();
    ST.receiveHandoff(st, { activityId: 'act_2', optionId: 'o1' });
    ST.markApplied(st, 'act_2');
    const again = ST.receiveHandoff(st, { activityId: 'act_2', optionId: 'o1' });
    assert.equal(again.state, K.GV_HANDOFF_STATES.REPLAYED);
    assert.equal(ST.pendingHandoff(st), null, 'replayed 时不得落草稿');
});

test('C2b ★ 清草稿只清**这一份**：另一场投票的待办一个字节都不许动', () => {
    const st = mkStorage();
    /* 先收下另一场投票（还没建）⇒ 它是用户的待办。 */
    ST.receiveHandoff(st, { activityId: 'act_other', optionId: 'o2', label: '另一场' });
    ST.markApplied(st, 'act_2');
    const again = ST.receiveHandoff(st, { activityId: 'act_2', optionId: 'o1' });
    assert.equal(again.state, K.GV_HANDOFF_STATES.REPLAYED);
    const held = ST.pendingHandoff(st);
    assert.ok(held, '另一场投票的待办不得被清掉（那是用户还没落笔的安排）');
    assert.equal(held.activityKey, 'act_other', '留在场上的必须是另一场那份');
});

test('C3 台账：记上 → 判重 → 超上限丢最旧（不静默截断新记录）', () => {
    const st = mkStorage();
    assert.equal(ST.isApplied(st, 'k1'), false, '没记过就是没记过');
    assert.equal(ST.markApplied(st, 'k1'), true);
    assert.equal(ST.isApplied(st, 'k1'), true);
    assert.equal(ST.markApplied(st, ''), false, '空键不记');
    const max = K.GV_HANDOFF_LIMITS.applied;
    for (let i = 0; i < max + 5; i++) ST.markApplied(st, 'z' + i);
    const keys = ST.appliedKeys(st);
    assert.equal(keys.length, max, '台账必须限量');
    assert.equal(keys[keys.length - 1], 'z' + (max + 4), '最新一条必须在（不得把新记录截掉）');
});

test('C4 坏存储：三个出口一律降级不抛（读不出 ⇒ null / [] / false）', () => {
    const broken = {
        get: () => { throw new Error('x'); },
        set: () => { throw new Error('x'); },
        remove: () => { throw new Error('x'); }
    };
    assert.doesNotThrow(() => {
        assert.equal(ST.pendingHandoff(broken), null);
        assert.equal(ST.consumeHandoff(broken), null);
        assert.deepEqual(ST.appliedKeys(broken), []);
        assert.equal(ST.isApplied(broken, 'k'), false);
        assert.equal(ST.markApplied(broken, 'k'), false);
        assert.equal(ST.receiveHandoff(broken, { activityId: 'a', optionId: 'o' }).state,
            K.GV_HANDOFF_STATES.RECEIVED, '写不进去也要如实报 received（读数与落盘是两件事）');
    });
});

test('C5 两键读写件自检真跑：无 problems 且两键在场', () => {
    const r = ST.voteHandoffStoreSelfCheck();
    assert.deepEqual(r.problems, [], '两键读写自检不得有问题：' + JSON.stringify(r.problems));
    assert.equal(r.keys, 2);
});

/* ══════════ D ── 日历交接口 ══════════ */
/** 用真原型 + 假依赖构造交接口宿主（不 new：构造期会装全局监听器）。 */
function mkAppHost(storage, opts = {}) {
    const host = Object.create(APP.CalendarApp.prototype);
    const memos = [];
    host.storage = storage;
    host.calendarData = {
        _memos: memos,
        addMemo: (input) => {
            if (opts.memoFails) return null;
            const memo = Object.assign({ id: 'm' + (memos.length + 1) }, input);
            memos.push(memo);
            return memo;
        }
    };
    host._getContext = () => ({ name1: '玩家', name2: '角色' });
    host.proposeCommitmentFromMemo = (input) => {
        if (opts.commitFails) return { ok: false };
        return { ok: true, item: { id: 'c1', status: 'proposed', content: input.content } };
    };
    host.confirmCommitmentById = (id) => ({ ok: true, item: { id: id, status: 'confirmed' } });
    host.syncCommitmentsToCalendar = () => true;
    return host;
}

test('D1 ★ 不替用户猜日期：没有合法 dateKey 就如实拒收且**零写盘**', () => {
    const st = mkStorage();
    const host = mkAppHost(st);
    ST.receiveHandoff(st, { activityId: 'act_d1', optionId: 'o1', label: '郊游' });
    for (const bad of ['', '今天', '2026/04/06', '2026-4-6', null]) {
        const r = host.commitVoteHandoff({ dateKey: bad, title: '郊游' });
        assert.equal(r.ok, false, '非法日期必须拒收：' + String(bad));
        assert.equal(r.why, 'invalid-date');
        assert.ok(r.line.indexOf('不替你猜') >= 0, '读数必须说明不替用户猜日期');
    }
    assert.equal(host.calendarData._memos.length, 0, '拒收路径必须零写盘');
    assert.equal(ST.pendingHandoff(st) !== null, true, '拒收不得清掉凭据（用户还要改）');
});

test('D2 提交成功：建日程 + 记台账 + 清草稿 + 读数如实', () => {
    const st = mkStorage();
    const host = mkAppHost(st);
    ST.receiveHandoff(st, { activityId: 'act_d2', optionId: 'o1', label: '郊游', participants: ['甲', '玩家'] });
    const r = host.commitVoteHandoff({ dateKey: '2026-04-10', title: '郊游', time: '15:00' });
    assert.equal(r.ok, true);
    assert.equal(r.state, K.GV_HANDOFF_STATES.CREATED);
    assert.equal(host.calendarData._memos.length, 1, '必须建一条日程');
    assert.equal(host.calendarData._memos[0].source, 'group_vote', '来源必须标注（可回溯是哪次投票来的）');
    assert.equal(ST.isApplied(st, 'act_d2'), true, '台账必须记上');
    assert.equal(ST.pendingHandoff(st), null, '建成了才清草稿（这里已建成）');
    assert.equal(r.memoryRegistered, true, '约定建成了 ⇒ 记忆已登记');
});

test('D3 ★ 重复提交不双建：第二次报 replayed 且日程数不变', () => {
    const st = mkStorage();
    const host = mkAppHost(st);
    ST.receiveHandoff(st, { activityId: 'act_d3', optionId: 'o1', label: '郊游' });
    host.commitVoteHandoff({ dateKey: '2026-04-10', title: '郊游' });
    const before = host.calendarData._memos.length;
    /* ★ 第一次建成后草稿就清了（清草稿 = 这次转交的使命已完成），所以第二次提交时
     *   表单上**可能已经没有凭据** —— 但「同一场投票只该建一次」不因此失效。
     *   判据因此覆盖两条路径：① 显式把凭据再递一次；② 什么都不递（靠本次会话经手过的那份）。
     *   两条都必须报 `replayed`，且都不得多建。 */
    const again = host.commitVoteHandoff({ dateKey: '2026-04-11', title: '郊游（又来一次）' });
    assert.equal(again.state, K.GV_HANDOFF_STATES.REPLAYED, '不递凭据也要认得出这是同一场');
    assert.equal(again.ok, false, '重复不得报成功（那会读成「又建了一条」）');
    const explicit = host.commitVoteHandoff({
        dateKey: '2026-04-11', title: '郊游（又来一次）',
        handoff: { ok: true, activityKey: 'act_d3', title: '郊游' }
    });
    assert.equal(explicit.state, K.GV_HANDOFF_STATES.REPLAYED, '显式再递一次也必须报 replayed');
    assert.equal(host.calendarData._memos.length, before, '不得双建');
    /* ★ 台账判定必须**早于**日期判定：重复提交时用户填的哪一天已无关紧要，
     *   报 `invalid-date` 只会把「已经建过」误导成「日期填错了」。 */
    const badDate = host.commitVoteHandoff({ dateKey: '今天', title: '郊游' });
    assert.equal(badDate.state, K.GV_HANDOFF_STATES.REPLAYED, '重复提交不得被读成日期不合法');
});

test('D4 ★ 缺插件可只存日历并提示未登记记忆：日历成立 + 读数补一句', () => {
    const st = mkStorage();
    const host = mkAppHost(st, { commitFails: true });
    ST.receiveHandoff(st, { activityId: 'act_d4', optionId: 'o1', label: '郊游', participants: ['甲', '玩家'] });
    const r = host.commitVoteHandoff({ dateKey: '2026-04-10', title: '郊游' });
    assert.equal(r.ok, true, '日历这条照样成立');
    assert.equal(r.memoryRegistered, false);
    assert.ok(r.line.indexOf('记忆未登记') >= 0, '读数必须如实补一句');
    assert.ok(r.line.indexOf('已建立日历事项') >= 0, '不得读成没建成');
});

test('D5 没有约定对象时不谎报「未登记」：memoryRegistered 为 null', () => {
    const st = mkStorage();
    const host = mkAppHost(st, { commitFails: true });
    /* 参与名单里只有自己 ⇒ 约定这一环不适用。 */
    ST.receiveHandoff(st, { activityId: 'act_d5', optionId: 'o1', label: '独处', participants: ['玩家'] });
    const r = host.commitVoteHandoff({ dateKey: '2026-04-10', title: '独处' });
    assert.equal(r.ok, true);
    assert.equal(r.memoryRegistered, null, '不适用必须报 null');
    assert.equal(r.line.indexOf('记忆未登记'), -1, '不适用不得说成未登记');
});

test('D6 没有凭据就交不过去（不凭空建一条没有出处的日程）', () => {
    const st = mkStorage();
    const host = mkAppHost(st);
    const r = host.commitVoteHandoff({ dateKey: '2026-04-10', title: '凭空' });
    assert.equal(r.ok, false);
    assert.equal(r.why, 'handoff-no-activity');
    assert.equal(host.calendarData._memos.length, 0);
});

test('D7 写盘失败如实报（不是「已经建好了」）', () => {
    const st = mkStorage();
    const host = mkAppHost(st, { memoFails: true });
    ST.receiveHandoff(st, { activityId: 'act_d7', optionId: 'o1', label: '郊游' });
    const r = host.commitVoteHandoff({ dateKey: '2026-04-10', title: '郊游' });
    assert.equal(r.ok, false);
    assert.equal(r.why, 'memo-failed');
    assert.ok(r.line.indexOf('不是') >= 0, '读数必须点明「不是已经建好了」');
    assert.equal(ST.pendingHandoff(st) !== null, true, '失败不得清凭据');
});

test('D8 交接口自检合并两件（契约件 + 两键读写件），无 problems', () => {
    const host = mkAppHost(mkStorage());
    const r = host.voteHandoffSelfCheck();
    assert.deepEqual(r.problems, [], '交接口自检不得有问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 5);
    assert.equal(r.keys, 2);
    assert.ok(r.reasons >= 4);
});

/* ══════════ E ── 接线（宿主 / 微信侧 / 日历视图 / 样式） ══════════ */
test('E1 ★ 宿主是真接收者：监听器在场、走唯一事件常量、且不借「派发即成功」', () => {
    const code = stripComments(hostSrc);
    assert.ok(code.indexOf('addEventListener(PHONE_EVENTS.GROUP_VOTE_CONFIRM') >= 0,
        '宿主必须真的挂监听器（修前接收者为 0）');
    assert.equal(code.indexOf("'phone:groupVoteConfirm'"), -1, '不得手写事件字面量（走唯一常量）');
    /* 监听器里必须真落草稿：走两键读写件，而不是只写个空回调。 */
    assert.ok(code.indexOf('receiveHandoff(storage') >= 0, '监听器必须真落草稿');
    /* 不许为这一件事 new CalendarApp（那会把日历实例提前装进来）。
     *   ★ 判的是**监听器块内**：块外别处仍有正常的懒加载 `new module.CalendarApp`。
     *   ★ 切块锚点用 `phone:goHome`（真源码里的下一处监听器），不用注释 ——
     *     本判据跑在剥掉注释的文本上，注释锚点必然失配（失配后 slice 会切到文件末尾，
     *     于是把块外那些**正常的**懒加载一起判红；首版正是栽在这里）。 */
    const iStart = code.indexOf('addEventListener(PHONE_EVENTS.GROUP_VOTE_CONFIRM');
    const iNext = code.indexOf("addEventListener('phone:goHome'", iStart);
    assert.ok(iStart > 0 && iNext > iStart, '必须能切出监听器块（锚点失配即判据失效）');
    const listenerBlock = code.slice(iStart, iNext);
    assert.equal(listenerBlock.indexOf('new module.CalendarApp'), -1,
        '监听器内不得 new CalendarApp（日历懒加载，不该被这一件事提前拉起）');
    assert.equal(listenerBlock.indexOf('new CalendarApp'), -1,
        '监听器内不得 new CalendarApp（另一种写法同判）');
    assert.ok(listenerBlock.indexOf('noteGroupVoteHandoffReceipt') >= 0, '必须把回执同步送回微信侧');
});

test('E2 ★ 微信侧念回执，不再无条件念「已转交」（修前那句是谎报）', () => {
    const code = stripComments(chatSrc);
    /* ★ 那句谎报只许出现在**注释**里（说明「修前这里念的是什么」），不许出现在代码里。
     *   首版判的是整份源文，于是那段解释性注释把判据自己顶红了 —— 靶子是代码。 */
    assert.equal(code.indexOf('已转交日历确认'), -1, '那句谎报必须从代码里消失');
    assert.ok(code.indexOf('noteGroupVoteHandoffReceipt') >= 0, '必须收得下回执');
    /* 没有回执 ⇒ 必须如实说「没有接收者」，不得静默或假装成功。 */
    assert.ok(code.indexOf('没有接收者') >= 0, '无回执时必须如实说没有接收者');
    /* 派发处必须**清空 → 派发 → 读回执**这个顺序（同步监听器在派发返回前写好回执）。 */
    const iClear = code.indexOf('this._groupVoteHandoffReceipt = null;');
    const iDispatch = code.indexOf('win.dispatchEvent(new win.CustomEvent(PHONE_EVENTS.GROUP_VOTE_CONFIRM');
    const iRead = code.indexOf('const receipt = this._groupVoteHandoffReceipt');
    assert.ok(iClear > 0, '必须先把回执位清空（否则会读到上一次的答复）');
    assert.ok(iDispatch > iClear, '清空回执位必须紧贴在派发之前');
    assert.ok(iRead > iDispatch, '读回执必须在派发之后（同步监听器已写好）');
});

test('E3 日历视图：表单打开时预填凭据、提交走交接口、取消清凭据', () => {
    assert.ok(viewSrc.indexOf('pendingVoteHandoff') >= 0, '表单打开必须取草稿预填');
    assert.ok(viewSrc.indexOf('commitVoteHandoff') >= 0, '提交必须走交接口');
    /* 提交分支必须在 addMemo 之前判凭据（否则凭据路径会被普通路径吞掉）。 */
    const iCommit = viewSrc.indexOf('this.app.commitVoteHandoff?.(');
    const iAdd = viewSrc.indexOf('this.app.calendarData.addMemo({ dateKey, title, time, type })');
    assert.ok(iCommit > 0 && iAdd > iCommit, '凭据分支必须早于普通 addMemo 分支');
    /* 取消/关闭三处都要清凭据（取消不新建）。 */
    assert.ok(countOf(viewSrc, 'this._voteHandoff = null') >= 4,
        '取消/关闭处理器必须清凭据（取消不新建）');
    /* 凭据条渲染在场且明说还没成事项。 */
    assert.ok(viewSrc.indexOf('yzp-calendar-vote-handoff') >= 0, '凭据提示条必须在场');
    assert.ok(viewSrc.indexOf('还没成事项') >= 0, '提示条必须明说还没成事项');
});

test('E4 样式双侧投递：calendar.css（link 加载面）与 phone.css（运行时投递面）都在场', () => {
    const calCss = read('apps/calendar/calendar.css');
    const bundle = read('phone.css');
    for (const cls of ['.yzp-calendar-vote-handoff', '.yzp-calendar-vote-handoff-head',
        '.yzp-calendar-vote-handoff-body', '.yzp-calendar-vote-handoff-foot']) {
        assert.ok(calCss.indexOf(cls) >= 0, 'calendar.css 缺样式：' + cls);
        assert.ok(bundle.indexOf(cls) >= 0, 'phone.css 缺样式（运行时投递面）：' + cls);
    }
    assert.equal(countOf(bundle, 'yzp-calendar-vote-handoff {'), 1,
        'phone.css 里该块只该有一份（重复插入会让后一份覆盖前一份）');
});

test('E5 不做面在代码上可判：不把投票自动当承诺、不另建跨 App 消息总线', () => {
    const all = stripComments(kernelSrc + storeSrc + appSrc + viewSrc);
    /* 不接真实通讯平台 / 不自建总线：零网络口。
     *   ★ `EventSource` 必须按**词**判：`commitmentLifeEventSourceId` /
     *     `domainLifeEventSourceId` 这两个既有的方法名里含 `EventSource` 子串，
     *     拿子串当靶子会把与总线毫无关系的正确代码判红（首版正是如此）。
     *     `fetch(` / `postMessage` / `WebSocket` 同理按词判（前者带括号、后两者本就少见于标识符）。 */
    const banned = [
        ['fetch(', /(?<![\w.$])fetch\s*\(/],
        ['XMLHttpRequest', /(?<![\w.$])XMLHttpRequest(?![\w$])/],
        ['WebSocket', /(?<![\w.$])WebSocket(?![\w$])/],
        ['EventSource', /(?<![\w.$])EventSource(?![\w$])/],
        ['postMessage', /(?<![\w.$])postMessage(?![\w$])/]
    ];
    for (const [name, re] of banned) {
        assert.equal(re.test(all), false, '不得另建跨 App 消息总线：' + name);
    }
    /* 不引入常驻定时器（本项是一次性交接，没有轮询）。 */
    for (const bad of ['setInterval']) {
        assert.equal(all.indexOf(bad), -1, '不得引入常驻代理：' + bad);
    }
    /* 投票不得自动变成承诺：交接口只在**用户显式提交**时才建约定，
     *   故 `proposeCommitmentFromMemo` 只许出现在 commitVoteHandoff 之后。 */
    const iPropose = appSrc.indexOf('this.proposeCommitmentFromMemo({');
    const iCommitFn = appSrc.indexOf('commitVoteHandoff(input = {})');
    assert.ok(iPropose > iCommitFn, '约定只许在显式提交路径里建（不得在收凭据时建）');
});

/* ══════════ F ── 负控制 + 版本锚 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4440_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps', 'calendar'), path.join(dir, 'apps', 'calendar'));
    copyTreeSafe(path.join(ROOT, 'apps', 'wechat'), path.join(dir, 'apps', 'wechat'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});
/** 定点破坏真源码副本：锚点必须恰中 1 次（失配即 abort，防「破坏没发生也算红」）。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
const loadAt = async (dir, rel, tag) =>
    await import(pathToFileURL(path.join(dir, rel)).href + '?' + tag + '=' + Date.now());

test('F0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真', () => {
    assert.equal(K.normalizeHandoff({ optionId: 'o' }).why, K.GV_HANDOFF_REASONS.NO_ACTIVITY,
        '原版：缺活动 id 按 NO_ACTIVITY 拒收');
    assert.equal(K.handoffLine({ state: K.GV_HANDOFF_STATES.RECEIVED, handoff: K.normalizeHandoff({ activityId: 'a', optionId: 'o' }) })
        .indexOf('还没成事项') >= 0, true, '原版：received 明说还没成事项');
    const st = mkStorage();
    ST.receiveHandoff(st, { activityId: 'x', optionId: 'o' });
    ST.markApplied(st, 'x');
    assert.equal(ST.receiveHandoff(st, { activityId: 'x', optionId: 'o' }).state,
        K.GV_HANDOFF_STATES.REPLAYED, '原版：已建过再收报 replayed');
    assert.equal(ST.pendingHandoff(st), null, '原版：replayed 不落草稿');
    const host = mkAppHost(mkStorage());
    ST.receiveHandoff(host.storage, { activityId: 'y', optionId: 'o', label: 'T' });
    assert.equal(host.commitVoteHandoff({ dateKey: 'bad' }).why, 'invalid-date', '原版：非法日期拒收');
});

test('F1 ★★★ 破坏「缺活动 id 的拒收」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        return Object.assign({}, empty, { why: GV_HANDOFF_REASONS.NO_ACTIVITY });",
        "        return Object.assign({}, empty, { why: GV_HANDOFF_REASONS.OK, ok: true });");
    const k2 = await loadAt(dir, KERNEL_REL, 'f1');
    assert.equal(k2.normalizeHandoff({ optionId: 'o' }).why, K.GV_HANDOFF_REASONS.OK,
        '破坏副本：缺活动 id 不再按 NO_ACTIVITY 拒收');
    /* 同款判据在破坏副本上必转红（与原版对照在 F0）。
     *   ★ 破坏后归一只剩 `optionId`，没有 `activityKey` ⇒ 两键读写件仍会拒收它，
     *     但归因词是 `handoff-not-object`（`norm.ok` 为真、`activityKey` 为空那条分支），
     *     读数因此是 `failed`。判据要断的是「**不再**按 NO_ACTIVITY 拒收」这件事本身，
     *     不能写成「破坏后必然被收下」—— 那是把「破坏生效」与「防线全丢」混为一谈。 */
    const st = mkStorage();
    const s2 = await loadAt(dir, STORE_REL, 'f1');
    const r = s2.receiveHandoff(st, { optionId: 'o' });
    assert.notEqual(r.why, K.GV_HANDOFF_REASONS.NO_ACTIVITY,
        '破坏副本：同款判据必转红（归因词不再是 NO_ACTIVITY）');
    assert.equal(s2.pendingHandoff(st), null, '破坏副本：不得凭空落一份没有活动 id 的草稿');
});

test('F2 ★★★ 破坏「replayed 不再落草稿」⇒ 同款判据必转红（双建前夜）', async () => {
    /* ★ 破坏锚点取**分支条件那一行**（短、唯一、不随分支体改写而漂）：
     *   首版锚的是整个 if 块（含读数字段），收尾时给该分支加了「清掉这一份草稿」
     *   的处置，锚点随即失配（`breakCopy` 会 abort —— 这是有意的防呆：
     *   锚点失配意味着「破坏没发生」，那时判红就是假红）。 */
    const dir = breakCopy(STORE_REL,
        "    if (isApplied(storage, norm.activityKey)) {",
        "    if (false && isApplied(storage, norm.activityKey)) {");
    const s2 = await loadAt(dir, STORE_REL, 'f2');
    const st = mkStorage();
    s2.receiveHandoff(st, { activityId: 'x', optionId: 'o' });
    s2.markApplied(st, 'x');
    const again = s2.receiveHandoff(st, { activityId: 'x', optionId: 'o' });
    assert.notEqual(again.state, K.GV_HANDOFF_STATES.REPLAYED,
        '破坏副本：同款判据必转红（已建过的仍被当成新凭据收下）');
    assert.notEqual(s2.pendingHandoff(st), null, '破坏副本：草稿又被落上了（表单会预填已建活动）');
});

test('F3 ★★★ 破坏「不替用户猜日期」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(APP_REL,
        "        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateKey)) {",
        "        if (false) {");
    const a2 = await loadAt(dir, APP_REL, 'f3');
    const host = Object.create(a2.CalendarApp.prototype);
    const st = mkStorage();
    host.storage = st;
    const memos = [];
    host.calendarData = { addMemo: (i) => { memos.push(i); return Object.assign({ id: 'm' }, i); } };
    host._getContext = () => ({ name1: '玩家', name2: '角色' });
    host.proposeCommitmentFromMemo = () => ({ ok: false });
    host.confirmCommitmentById = () => ({ ok: false });
    host.syncCommitmentsToCalendar = () => true;
    const s2 = await loadAt(dir, STORE_REL, 'f3');
    s2.receiveHandoff(st, { activityId: 'z', optionId: 'o', label: 'T' });
    const r = host.commitVoteHandoff({ dateKey: '今天', title: 'T' });
    assert.notEqual(r.ok, false, '破坏副本：同款判据必转红（非法日期被放过去了）');
    assert.equal(memos.length, 1, '破坏副本：没有合法日期也照样建了日程');
});

test('F4 ★★★ 破坏「没有接收者时不假装已转交」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(CHAT_REL,
        "                this.app.phoneShell?.showNotification('投票', '**没有接收者**：日历没接这一份（本卡零写盘，不代写事项）。', '⚠️');",
        "                this.app.phoneShell?.showNotification('投票', '已转交日历确认。', '✅');");
    /* ★ 读副本必须用 `fs.readFileSync` 走绝对路径：判据顶部的 `read()` 会把相对路径
     *   拼到 `ROOT`（真仓）上，于是「破坏副本里那句还在不在」这件事根本读不到 ——
     *   首版正是这么写错的（报 ENOENT `/home/user/ruby-phone/tmp/rp_v4440_...`）。 */
    const chat2 = fs.readFileSync(path.join(dir, CHAT_REL), 'utf8');
    /* ★ 比的是**代码**（剥注释）：注释里为了说明「无回执时该说什么」而写着这几个字，
     *   拿整份源文当靶子会把自己顶红（与 A2/E2 同因）。 */
    const chat2Code = stripComments(chat2);
    assert.ok(chat2Code.indexOf('没有接收者') < 0, '破坏副本：那句如实读数已被换掉');
    assert.ok(chat2Code.indexOf('已转交日历确认') >= 0, '破坏副本：谎报又回来了');
    /* 同款判据（原版上为真）在破坏副本上必转红 —— 判的是**代码**（剥注释）。 */
    assert.equal(stripComments(chatSrc).indexOf('已转交日历确认'), -1, '原版代码里必须没有这句');
    assert.ok(chat2Code.indexOf('已转交日历确认') >= 0, '破坏副本代码里必须有（对照）');
});

test('F6 ★ 历史套件的版本锚不再被抬版连带转红（本版接管的那十一条）', () => {
    /* 本版抬版时实测到 v4330…v4430 十一条套件各红 1 条，红在同一处：
     *   `const ver = pkg.version` 被**同时**用来断「五源一致」与「当版公告记了本版那件事」。
     *   本版按同仓口径接管（一致性跟随当前版；当版内容锁自己那一版），
     *   本判据锁这个**不变量**：那十一条里不许再出现「拿 pkg.version 去索引当版条目」的写法。
     *   ★ 判的是写法形态（不是跑一遍套件）：这样抬版时不再需要人肉重查一遍。 */
    const own = {
        v4330: '4.33.0', v4340: '4.34.0', v4350: '4.35.0', v4360: '4.36.0',
        v4370: '4.37.0', v4380: '4.38.0', v4390: '4.39.0', v4400: '4.40.0',
        v4410: '4.41.0', v4420: '4.42.0', v4430: '4.43.0'
    };
    for (const [suite, ver] of Object.entries(own)) {
        const src = read('tests/system-' + suite + '.test.mjs');
        const code = stripComments(src);
        /* ★ 禁的是**组合**：把 `ver` 动态绑到 `pkg.version`、又拿它索引当版条目。
         *   v4330 那种 `ver = '4.33.0'` 字面量写法里 `log.versions[ver]` 是无害的
         *   （它索引的正是自己那一版），首版把两者一律禁掉即误判了它。 */
        const dynBound = code.indexOf('const ver = pkg.version;') >= 0
            || code.indexOf('const ver = pkg.version') >= 0;
        if (dynBound) {
            assert.ok(code.indexOf('log.versions[ver]') < 0 && code.indexOf('ul.versions[ver]') < 0,
                suite + ' 不得拿 pkg.version 去索引当版条目（那是抬版连带转红的根因）');
        }
        assert.ok(code.indexOf("versions['" + ver + "']") >= 0 || code.indexOf("ver = '" + ver + "'") >= 0
            || code.indexOf("const ver = '" + ver + "';") >= 0,
            suite + ' 必须锁自己那一版：' + ver);
        /* 一致性仍必须跟随当前版（接管只换主语，不放宽）。
         *   三条历史套件各有自己的「跟随」写法：`const ver = pkg.version` /
         *   `const versions = [pkg.version, ...]` / `assert.equal(pkg.version, mm[1])`。
         *   判据因此只锁「当前版仍在场」（`pkg.version` 被读到）——
         *   若某套件把一切都锁死在历史版本上，那才是真放宽。 */
        assert.ok(code.indexOf('pkg.version') >= 0,
            suite + ' 仍必须断言五源一致（跟随当前版）');
    }
});

test('F5 版本锚：五源同源（不锁死具体版本值，但必须一致且当版条目在场）', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idxVer = (read(HOST_REL).match(/ST_PHONE_VERSION = '([^']+)'/) || [])[1];
    const ledger = JSON.parse(read('tests/audit/status-ledger.json'));
    const vers = [pkg.version, manifest.version, log.latest, idxVer, ledger.version];
    assert.equal(new Set(vers).size, 1, '五源版本必须一致：' + JSON.stringify(vers));
    assert.equal(log.head, log.latest, 'update-log 的 head 必须跟上 latest');
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, log.latest),
        '当版条目必须在 versions 里');
    /* 迭代段在场且条目数达标。 */
    const iter = read('tools/iter203_seg.md');
    assert.ok(countOf(iter, '- 【') >= 8, '迭代段条目数不足（须 ≥ 8）');
});
