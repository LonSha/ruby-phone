/* ============================================================
 * tests/r14_x1_reply_board.test.mjs — v4.123.0 · R14-X1 会话台 → 待回应清单
 * ------------------------------------------------------------
 * 判据分六面（口径同 system-v4490.test.mjs）：
 *   A 口径：回应三动作词表 + 落地词表 + 两族状态分存（系统读数 vs 用户决定）
 *   B 状态机：三动作各改什么、不该改什么；坏 action / 找不到点必须如实拒
 *   C ★ 三条验收旅程：
 *       C1 回应一项不关闭整段交流、不篡改读数（验收①）
 *       C2 无源不猜：readable:false 的接触点不上清单（验收②）
 *       C3 手动标记与实际消息回执可区分（验收③）
 *   D 刷新保留与会话隔离：写回存储再读出，决定仍在；换 storage 不串
 *   E 回到原处：channel→App 登记表 + 不编假靶心（landed 如实）
 *   F 接线与结构自证：App/视图/样式双侧 + 负控制（真源码破坏必红）
 *
 * ★ 判据纪律（与 4490 同款）：
 *   ① 不引用被测模块自己的词表当结论 —— 词表改了判据跟着改，等于没判；
 *   ② 破坏必须**在真源码副本上重跑同款判据**，不许写死模拟常量；
 *   ③ 破坏锚点必须**恰中 1 次**，否则整件抛出（锚点不唯一 ⇒ 改的不是我以为那处）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

/** 去注释（只留代码）：本套件多处要查「代码里有没有 X」，而注释里正写着「不许有 X」。 */
function stripComments(src) {
    return String(src)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const MIN_VERSION = '4.123.0';
const KERNEL_REL = 'config/comm-thread.js';
const APP_REL = 'apps/comms/comms-app.js';
const VIEW_REL = 'apps/comms/comms-view.js';
const CSS_REL = 'apps/comms/comms.css';
const RUNTIME_CSS_REL = 'phone.css';

const K = await import(pathToFileURL(rel(KERNEL_REL)).href);

const HOUR = 3600 * 1000;
const T0 = 1761187200000;

/** 内存 storage 桩（与真 PhoneStorage 的 get/set 同形）。 */
function mkStorage() {
    const bag = new Map();
    return {
        get(k, dflt) { return bag.has(k) ? bag.get(k) : dflt; },
        set(k, v) { bag.set(k, v); },
        _bag: bag,
    };
}

/** 造一段交流：opened + 若干 incoming 接触点（走真内核写路径，不手捏对象）。 */
function seedThread(storage, participant, points) {
    let list = [];
    const opened = K.openThread(list, participant, T0, '');
    assert.equal(opened.ok, true, '开段必须成功：' + JSON.stringify(opened));
    list = opened.list;
    let at = T0;
    for (const p of points) {
        at += 1000;
        const res = K.appendPoint(list, opened.thread.id, Object.assign({ at: at, direction: 'incoming' }, p), at);
        assert.equal(res.ok, true, '挂点必须成功：' + JSON.stringify(res));
        list = res.list;
    }
    K.writeThreads(storage, list);
    return opened.thread.id;
}

function pointOf(thread, refId) {
    return (thread.points || []).find((p) => p.refId === refId) || null;
}

/* ============================================================
 * A 面：口径
 * ========================================================== */
test('A1 回应三动作词表冻结且恰好三项（逐字面写死，不引用词表自证）', () => {
    const a = K.COMM_REPLY_ACTIONS;
    assert.equal(Object.isFrozen(a), true, '词表必须冻结');
    assert.equal(a.ANSWERED, 'answered');
    assert.equal(a.LATER, 'later');
    assert.equal(a.NOT_NEEDED, 'not-needed', '★ 连字符形，不是下划线形（本仓老账）');
    assert.equal(Object.keys(a).length, 3, '必须恰三动作');
});

test('A2 落地词表与归因词表分层：COMM_REASONS 仍恰十二项（不被新功能撑大）', () => {
    assert.equal(Object.keys(K.COMM_REASONS).length, 12,
        '★ 接触点归因十二项是 R6-O2 已冻结的口径，跳转落地必须另开一表');
    const L = K.COMM_LANDING;
    assert.equal(Object.isFrozen(L), true);
    assert.equal(L.OK, '');
    assert.equal(L.NO_APP, 'no-app');
    assert.equal(L.NO_SOURCE, 'no-source');
    assert.equal(L.NO_LANDING, 'no-landing');
    assert.equal(Object.keys(L).length, 4, '落地四态不许再并表');
});

test('A3 ★★★ 两族状态分存：归一必须接住 replyState / replyAt / replyOrigin', () => {
    /* ★ 这是本版真实抓到的缺陷：normalizePoint 是**重建式**白名单归一，
     *   不列出来的字段写回存储后就被抹掉 —— 表现为「点了已回应、刷新又回到清单」。 */
    const raw = {
        kind: 'message', channel: 'wechat', refId: 'm1', at: T0,
        direction: 'incoming', seen: false, answered: false,
        replyState: 'later', replyAt: T0 + 5000, replyOrigin: 'manual',
    };
    const n = K.normalizeThread({ id: 't1', participant: '阿岚', points: [raw] });
    assert.ok(n, '归一不得返回 null');
    const p = pointOf(n, 'm1');
    assert.ok(p, '接触点必须还在');
    assert.equal(p.replyState, 'later', '★ replyState 被归一抹掉了（刷新即丢决定）');
    assert.equal(p.replyAt, T0 + 5000, 'replyAt 必须留住（读不出才是 null）');
    assert.equal(p.replyOrigin, 'manual', '手动标记的来源必须留住');
    /* 坏值一律读成「没决定过」，不许洗成三动作之一。 */
    const bad = K.normalizeThread({
        id: 't2', participant: '阿岚',
        points: [Object.assign({}, raw, { refId: 'm2', replyState: 'answered-by-system', replyOrigin: 'auto' })],
    });
    const bp = pointOf(bad, 'm2');
    assert.equal(bp.replyState, '', '不认识的 replyState 必须读成空（不许兜底成某项）');
    assert.equal(bp.replyOrigin, '', '非 manual 的 origin 必须读成空');
    assert.equal(bp.replyAt, T0 + 5000, '时刻本身仍可读（那一格不因 state 坏而清空）');
});

test('A4 两族状态互不越界：markSeen / markAnswered 绝不写 replyState', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [
        { kind: 'message', channel: 'wechat', refId: 'm1', label: '第一条' },
    ]);
    let list = K.readThreads(st);
    const t0 = list.find((x) => x.id === tid);
    const pid = pointOf(t0, 'm1').id;

    let res = K.markPointSeen(list, tid, pid, T0 + 100);
    assert.equal(res.ok, true);
    K.writeThreads(st, res.list);
    list = K.readThreads(st);
    let p = pointOf(list.find((x) => x.id === tid), 'm1');
    assert.equal(p.seen, true, '读数面必须变');
    assert.equal(p.replyState, '', '★ 系统看到 ≠ 用户决定（markSeen 不许写 replyState）');

    res = K.markPointAnswered(list, tid, pid, T0 + 200);
    assert.equal(res.ok, true);
    K.writeThreads(st, res.list);
    list = K.readThreads(st);
    p = pointOf(list.find((x) => x.id === tid), 'm1');
    assert.equal(p.answered, true);
    assert.equal(p.replyState, '', '★ markAnswered 也不许写 replyState（验收③）');
});

/* ============================================================
 * B 面：状态机
 * ========================================================== */
test('B1 answered：改决定，并单向收敛读数（seen 与 answered 同置真）', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [{ kind: 'message', channel: 'wechat', refId: 'm1' }]);
    const list = K.readThreads(st);
    const pid = pointOf(list.find((x) => x.id === tid), 'm1').id;

    const res = K.markPointReply(list, tid, pid, K.COMM_REPLY_ACTIONS.ANSWERED, T0 + 9000);
    assert.equal(res.ok, true, '三个参数都对时必须成：' + JSON.stringify(res));
    assert.equal(res.why, K.COMM_REASONS.OK);
    const p = pointOf(res.thread, 'm1');
    assert.equal(p.replyState, 'answered');
    assert.equal(p.replyAt, T0 + 9000, '时刻必须落账');
    assert.equal(p.replyOrigin, 'manual');
    assert.equal(p.seen, true, '★ answered 是唯一允许单向会话读数的一格');
    assert.equal(p.answered, true);
});

test('B2 later / not-needed：只改决定，不动读数（「稍后」不是「已回」）', () => {
    for (const act of [K.COMM_REPLY_ACTIONS.LATER, K.COMM_REPLY_ACTIONS.NOT_NEEDED]) {
        const st = mkStorage();
        const tid = seedThread(st, '阿岚', [{ kind: 'message', channel: 'wechat', refId: 'm1' }]);
        const list = K.readThreads(st);
        const pid = pointOf(list.find((x) => x.id === tid), 'm1').id;

        const res = K.markPointReply(list, tid, pid, act, T0 + 1000);
        assert.equal(res.ok, true, act + ' 必须成');
        const p = pointOf(res.thread, 'm1');
        assert.equal(p.replyState, act);
        assert.equal(p.seen, false, act + ' 不许把读数改成已读');
        assert.equal(p.answered, false, act + ' 不许把读数改成已回');
    }
});

test('B3 坏输入如实拒：action 不在词表 / 段不存在 / 点不存在，三态各归各的', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [{ kind: 'message', channel: 'wechat', refId: 'm1' }]);
    const list = K.readThreads(st);
    const pid = pointOf(list.find((x) => x.id === tid), 'm1').id;

    const badAct = K.markPointReply(list, tid, pid, 'answered-by-robot', T0);
    assert.equal(badAct.ok, false, '不认识的 action 必须拒');
    assert.equal(badAct.why, K.COMM_REASONS.BAD_SHAPE, '词表外的 action 归 bad-shape');
    assert.equal(badAct.thread, null, '★ 拒的时候不返回半截 thread（是 null，不是「改了一半」）');

    const badThread = K.markPointReply(list, 'no-such-thread', pid, K.COMM_REPLY_ACTIONS.LATER, T0);
    assert.equal(badThread.ok, false);
    assert.equal(badThread.why, K.COMM_REASONS.NOT_FOUND);

    const badPoint = K.markPointReply(list, tid, 'no-such-point', K.COMM_REPLY_ACTIONS.LATER, T0);
    assert.equal(badPoint.ok, false);
    assert.equal(badPoint.why, K.COMM_REASONS.NOT_FOUND);

    assert.equal(list.length, K.readThreads(st).length, '★ 拒的三次都不许改存储');
});

test('B4 只改那一条：同段其它接触点原封不动（逐项处理不是整段处理）', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [
        { kind: 'message', channel: 'wechat', refId: 'm1' },
        { kind: 'missed', channel: 'phone-call', refId: 'c1' },
    ]);
    const list = K.readThreads(st);
    const t = list.find((x) => x.id === tid);
    const p1 = pointOf(t, 'm1').id;
    const before = pointOf(t, 'c1');

    const res = K.markPointReply(list, tid, p1, K.COMM_REPLY_ACTIONS.ANSWERED, T0 + 3000);
    assert.equal(res.ok, true);
    const after = pointOf(res.thread, 'c1');
    assert.deepEqual(after, before, '★ 另一条接触点一个字都不许动');
});

/* ============================================================
 * C 面：三条验收旅程
 * ========================================================== */
test('C1 ★★★ 验收①：回应一项不关闭整段交流，也不篡改整段读数', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [
        { kind: 'message', channel: 'wechat', refId: 'm1' },
        { kind: 'message', channel: 'wechat', refId: 'm2' },
    ]);
    let list = K.readThreads(st);
    const t0 = list.find((x) => x.id === tid);
    const pid = pointOf(t0, 'm1').id;
    const stateBefore = K.threadStateOf(t0);
    const countsBefore = K.threadCounts(t0);

    const res = K.markPointReply(list, tid, pid, K.COMM_REPLY_ACTIONS.LATER, T0 + 1000);
    assert.equal(res.ok, true);
    K.writeThreads(st, res.list);
    list = K.readThreads(st);
    const t1 = list.find((x) => x.id === tid);

    assert.equal(K.threadStateOf(t1), K.COMM_STATES.OPEN, '★ 回一项绝不关闭整段交流');
    assert.equal(t1.closedAt, null, '不许写 closedAt');
    assert.equal(K.threadStateOf(t1), stateBefore, '整段状态不许因逐项回应而变');
    const c1 = K.threadCounts(t1);
    assert.equal(c1.messages, countsBefore.messages, '读数里消息条数不许因回应而变');
    assert.equal(c1.total, countsBefore.total, '读数总数不许因回应而变');
});

test('C2 ★★★ 验收②：无源不猜 —— readable:false 的接触点不上待回应清单', () => {
    /* 造一条**读不出源**的接触点：缺 refId（真内核会判 readable:false）。 */
    const thread = K.normalizeThread({
        id: 't-x', participant: '阿岚',
        points: [
            { kind: 'message', channel: 'wechat', refId: '', at: T0, direction: 'incoming' },
            { kind: 'message', channel: 'wechat', refId: 'ok1', at: T0 + 1, direction: 'incoming' },
        ],
    });
    assert.equal(thread.readable, false, '这一段本身必须被读成不可读');
    const pts = K.replyPointsOf(thread);
    const refs = pts.map((p) => p.refId);
    assert.equal(refs.indexOf(''), -1, '★ 缺源的接触点不许上清单（用户不知道该去哪回应）');
    assert.equal(refs.indexOf('ok1') >= 0, true, '有源的那条必须还在（不能整段丢弃）');
});

test('C3 ★★★ 验收③：手动标记与实际消息回执可区分（同段两态并存）', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [
        { kind: 'message', channel: 'wechat', refId: 'm-manual' },
        { kind: 'message', channel: 'wechat', refId: 'm-receipt' },
    ]);
    let list = K.readThreads(st);
    const t = list.find((x) => x.id === tid);
    const manualId = pointOf(t, 'm-manual').id;
    const receiptId = pointOf(t, 'm-receipt').id;

    /* 一条走「系统看到回执」，一条走「用户手动标记」。 */
    let res = K.markPointAnswered(list, tid, receiptId, T0 + 100);
    assert.equal(res.ok, true);
    res = K.markPointReply(res.list, tid, manualId, K.COMM_REPLY_ACTIONS.ANSWERED, T0 + 200);
    assert.equal(res.ok, true);
    K.writeThreads(st, res.list);

    const after = K.readThreads(st).find((x) => x.id === tid);
    const mp = pointOf(after, 'm-manual');
    const rp = pointOf(after, 'm-receipt');
    assert.equal(mp.replyState, 'answered', '手动标记必须留下用户决定');
    assert.equal(mp.replyOrigin, 'manual', '来源必须是 manual');
    assert.equal(mp.replyAt, T0 + 200, '手动标记的时刻必须留住');
    assert.equal(rp.answered, true, '回执那条读数必须真');
    assert.equal(rp.replyState, '', '★ 回执那条**不许**有用户决定（这就是两者可区分的判据）');
    assert.equal(rp.replyAt, null, '回执那条不许有手动时刻');
    assert.notDeepEqual(
        { s: mp.replyState, o: mp.replyOrigin },
        { s: rp.replyState, o: rp.replyOrigin },
        '两条在数据上必须长得不一样（否则验收③无法成立）',
    );
});

test('C4 ★★ 漏接首次入口：missed 无 seen/answered 也算待回应（本版补的那个洞）', () => {
    const thread = K.normalizeThread({
        id: 't-m', participant: '阿岚',
        points: [
            { kind: 'missed', channel: 'phone-call', refId: 'c1', at: T0, direction: 'incoming' },
        ],
    });
    const pts = K.replyPointsOf(thread);
    assert.equal(pts.length, 1, '★ 漏接悬着必须出现在待回应清单里（修前它只在别处有一行红字）');
    assert.equal(pts[0].kind, 'missed');
    /* 与读数面并置：threadCounts 的 unread/unanswered 仍是它们自己的口径（本版**不**改它）。 */
    const c = K.threadCounts(thread);
    assert.equal(c.unread, 0, '漏接不进 unread（R6-O2 的既有口径不动）');
    assert.equal(c.unanswered, 0, '漏接不进 unanswered（同上）');
});

test('C5 决定过就不再骚扰：已回应的项从清单移出，其余项仍在', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [
        { kind: 'message', channel: 'wechat', refId: 'm1' },
        { kind: 'missed', channel: 'phone-call', refId: 'c1' },
    ]);
    let list = K.readThreads(st);
    let t = list.find((x) => x.id === tid);
    assert.equal(K.replyPointsOf(t).length, 2, '两条都该在清单里');

    const res = K.markPointReply(list, tid, pointOf(t, 'm1').id, K.COMM_REPLY_ACTIONS.ANSWERED, T0 + 10);
    assert.equal(res.ok, true);
    K.writeThreads(st, res.list);
    t = K.readThreads(st).find((x) => x.id === tid);
    const left = K.replyPointsOf(t);
    assert.equal(left.length, 1, '决定过的移出，没决定的仍在');
    assert.equal(left[0].refId, 'c1');
});

test('C6 outgoing 一律不进清单：自己发出去的不需要自己回应', () => {
    const thread = K.normalizeThread({
        id: 't-o', participant: '阿岚',
        points: [
            { kind: 'message', channel: 'wechat', refId: 'o1', at: T0, direction: 'outgoing' },
        ],
    });
    assert.equal(K.replyPointsOf(thread).length, 0, 'outgoing 不许进待回应');
});

/* ============================================================
 * D 面：刷新保留 + 会话隔离
 * ========================================================== */
test('D1 ★★★ 刷新保留：写回存储再读出来，决定仍在（本版真缺陷的回归判据）', () => {
    const st = mkStorage();
    const tid = seedThread(st, '阿岚', [{ kind: 'message', channel: 'wechat', refId: 'm1' }]);
    const list = K.readThreads(st);
    const pid = pointOf(list.find((x) => x.id === tid), 'm1').id;

    const res = K.markPointReply(list, tid, pid, K.COMM_REPLY_ACTIONS.NOT_NEEDED, T0 + 700);
    assert.equal(res.ok, true);
    const wrote = K.writeThreads(st, res.list);
    assert.equal(wrote, true, '写必须成功');

    /* 模拟「刷新」：重新从存储读（不拿内存里那份）。 */
    const reread = K.readThreads(st);
    const p = pointOf(reread.find((x) => x.id === tid), 'm1');
    assert.equal(p.replyState, 'not-needed', '★ 刷新后决定必须还在（丢=用户白点了）');
    assert.equal(p.replyAt, T0 + 700);
    assert.equal(p.replyOrigin, 'manual');
    assert.equal(K.replyPointsOf(reread.find((x) => x.id === tid)).length, 0,
        '★ 刷新后它必须仍在清单外（不许「刷新又回来了」）');
});

test('D2 会话隔离：两份 storage 互不串（键命中 ^comm 前缀族，落 chatMetadata）', () => {
    const stA = mkStorage();
    const stB = mkStorage();
    const tidA = seedThread(stA, '阿岚', [{ kind: 'message', channel: 'wechat', refId: 'm1' }]);
    seedThread(stB, '阿岚', [{ kind: 'message', channel: 'wechat', refId: 'm1' }]);

    const listA = K.readThreads(stA);
    const pid = pointOf(listA.find((x) => x.id === tidA), 'm1').id;
    const res = K.markPointReply(listA, tidA, pid, K.COMM_REPLY_ACTIONS.LATER, T0 + 50);
    K.writeThreads(stA, res.list);

    assert.equal(K.replyPointsOf(K.readThreads(stA)[0]).length, 0, 'A 会话里的决定生效');
    assert.equal(K.replyPointsOf(K.readThreads(stB)[0]).length, 1, '★ B 会话必须原封不动（隔离）');
});

/* ============================================================
 * E 面：回到原处
 * ========================================================== */
test('E1 ★★ 路由表登记齐备：三个 channel 各归我们对得上的 App（不引用词表自证）', () => {
    const m = K.COMM_CHANNEL_APP;
    assert.equal(Object.isFrozen(m), true, '路由表必须冻结');
    assert.equal(m['wechat'], 'wechat');
    assert.equal(m['phone-call'], 'phone');
    assert.equal(m['phone-sms'], 'phone');
    assert.equal(Object.keys(m).length, 3, '本仓就三个来源，多一格就是没人管的角');
    /* 词表里每个 channel 都必须有归属（漏一格 = 按钮指向空 App）。 */
    for (const ch of Object.values(K.COMM_CHANNELS)) {
        assert.ok(m[ch], '★ channel「' + ch + '」没有登记归属 App');
    }
});

test('E2 ★★★ 不编假靶心：本版三个来源都还没有逐条定位口，landed 必须如实为 false', () => {
    for (const [kind, channel] of [['message', 'wechat'], ['missed', 'phone-call'], ['sms', 'phone-sms']]) {
        const land = K.replyLandingOf({ kind: kind, channel: channel, refId: 'r1', at: T0, direction: 'incoming' });
        assert.ok(land.appId, kind + ' 必须能定位到归属 App');
        assert.equal(land.ref, null, '★ 没有定位口就不许造 ref（造了会让用户以为「这条被删了」）');
        assert.equal(land.landed, false, '★ 落不到就说落不到');
        assert.equal(land.why, K.COMM_LANDING.NO_LANDING, '归因必须是 no-landing，不是成功');
    }
});

test('E3 无源不投：读不出来的接触点连 App 都不开（不假装去了哪儿）', () => {
    const land = K.replyLandingOf({ kind: 'message', channel: 'wechat', refId: '', at: T0 });
    assert.equal(land.landed, false);
    assert.equal(land.why, K.COMM_LANDING.NO_SOURCE);
    assert.equal(land.ref, null);
});

test('E4 未登记 channel 不投：归一就把它读成「读不出源」（不假装去了哪儿）', () => {
    /* ★ 这里有一个容易搞反的地方：本仓词表（COMM_CHANNELS）意外的手写 channel
     *   （这里故意写了 telegram）会在归一那一步就被判 readable:false，
     *   而不是「能读出、只是没登记 App」。也就是说**真实入口是 no-source**，
     *   不是 no-app。硬要求 no-app 只会把判据写成愿望，而不是实测行为。
     *   no-app 因此是**防御性分支**（词表有、路由表漏），由 E1 的「每个 channel 必须有归属」守住不发生。 */
    const land = K.replyLandingOf({ kind: 'message', channel: 'telegram', refId: 'x1', at: T0 });
    assert.equal(land.landed, false, '未登记的 channel 绝不声称能去');
    assert.equal(land.ref, null, '也不许编个靶心');
    assert.equal(land.why, K.COMM_LANDING.NO_SOURCE, '归一就读不出 ≤ 连 App 都不该开');
});

test('E5 App 侧 goto 走唯一派发链：不持实例、载荷走 buildOpenDetail', () => {
    const s = read(APP_REL);
    assert.ok(s.includes('phone:openApp'), '★ 派发链只有一条（phone:openApp）');
    assert.ok(s.includes('buildOpenDetail('), '载荷必须走唯一一支笔（不手拼字面量）');
    assert.ok(s.includes('replyLandingOf('), '落地读数必须向内核取（视图/App 不重算归属）');
    /* ★ 判据必须**去注释**再查：本文件的注释里正写着「不持有 wechatApp / phoneApp」，
     *   裸正则命中的就是那句注释自己（首版实测把真仓判红了）。 */
    const code = stripComments(s);
    assert.equal(/\b(wechatApp|phoneApp)\b/.test(code), false, '★ 本 App 不许持别的 App 实例');
});

/* ============================================================
 * F 面：接线、样式双侧、负控制
 * ========================================================== */
test('F1 App 接线：reply / replyBoard / goto / landingOf 四件都在，空分组必须跳过', () => {
    const s = read(APP_REL);
    for (const m of ['reply(threadId, pointId, action)', 'replyBoard()', 'goto(point)', 'landingOf(point)']) {
        assert.ok(s.includes(m), '★ App 缺 ' + m);
    }
    assert.ok(s.includes('if (!pts.length) continue;'), '★ 空分组必须跳过（否则清单出空壳）');
    assert.ok(/writeThreads\(this\.storage, res\.list\)/.test(s), '写路径必须把 list 写回存储（否则读数看不到变化）');
    assert.ok(s.includes('this.live().concat(this.idle())'), '★ 只收 open 段（closed 段已了结，不复出）');
});

test('F2 视图接线：待回应段 + 三动作按钮 + 回到原处 + 事件分支', () => {
    const v = read(VIEW_REL);
    assert.ok(v.includes('_replySection()'), '必须有待回应段');
    assert.ok(v.includes("data-cm-act=\"reply\""), '三动作按钮必须带 reply 动作');
    for (const r of ['answered', 'later', 'not-needed']) {
        assert.ok(v.includes("data-r=\"" + r + "\""), '★ 缺动作按钮：' + r);
    }
    assert.ok(v.includes("act === 'reply'"), '事件绑定必须有 reply 分支');
    assert.ok(v.includes("act === 'goto'"), '事件绑定必须有 goto 分支（回到原处）');
    assert.ok(v.includes('this.app.replyBoard()'), '读数必须向 App 取（视图不自算口径）');
    /* ★ 视图不许自己判落地：文案必须走 App.landingOf。 */
    assert.ok(v.includes('this.app.landingOf('), '落地文案必须向 App 取');
});

test('F3 样式双侧一致：源面与运行时面都备齐待回应与回到原处的类', () => {
    const src = read(CSS_REL);
    const runtime = read(RUNTIME_CSS_REL);
    const classes = ['.cm-reply', '.cm-reply-group', '.cm-reply-item', '.cm-reply-btns', '.cm-reply-btn', '.cm-pt-go'];
    for (const cls of classes) {
        assert.ok(src.indexOf(cls) >= 0, '源面缺 ' + cls);
        assert.ok(runtime.indexOf(cls) >= 0, '★ 运行时面缺 ' + cls + '（样式双侧是硬纪律）');
    }
    /* 窄屏：两侧都要有收窄落点（不许用横向滚动兜，也不许窄屏挤爆）。 */
    assert.ok(/@media \(max-width: 340px\)[\s\S]{0,900}\.cm-pt-go/.test(src), '源面窄屏段必须收窄 .cm-pt-go');
    assert.ok(/@media \(max-width: 340px\)[\s\S]{0,900}\.cm-pt-go/.test(runtime), '运行时面窄屏段必须收窄 .cm-pt-go');
});

test('F4 版本锚：本套件只在 ' + MIN_VERSION + ' 及以后成立（五源同源）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const upd = JSON.parse(read('update-log.json'));
    const ledger = JSON.parse(read('tests/audit/status-ledger.json'));
    const idx = read('index.js');
    const toNum = (v) => String(v).split('.').map((x) => Number.parseInt(x, 10)).reduce((a, b) => a * 1000 + b, 0);
    for (const [tag, v] of [['package', pkg.version], ['manifest', man.version], ['update-log', upd.latest]]) {
        assert.ok(toNum(v) >= toNum(MIN_VERSION), tag + ' 版本必须 >= ' + MIN_VERSION + '（实测 ' + v + '）');
    }
    assert.equal(pkg.version, man.version, 'package 与 manifest 必须同版');
    assert.equal(upd.latest, pkg.version, 'update-log.latest 必须同版');
    assert.equal(ledger.version, pkg.version, 'status-ledger 必须同版');
    assert.ok(idx.includes("const ST_PHONE_VERSION = '" + pkg.version + "'"), 'index.js 版本常量必须同版');
    assert.ok(upd.versions[pkg.version], 'update-log 必须有本版条目');
    assert.ok(upd.versions[pkg.version].items.length >= 6, '本版条目不得薄成一句话');
});

test('F5 ★★ 负控制：真源码副本上重跑同款判据，四处破坏必须各自被抓', () => {
    const ORIGINAL = read(KERNEL_REL);

    function mutate(src, old, neu, code) {
        const hits = src.split(old).length - 1;
        assert.equal(hits, 1, '★ 破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + code);
        return src.replace(old, neu);
    }

    /* 判据本体（对**源码文本**做、只依赖内核自己的口径句，不依赖实现细节变量名）。 */
    function kernelJudge(src) {
        const bad = [];
        /* ① 归一层必须接住 replyState（否则刷新即丢决定）。 */
        if (!/replyState:\s*hasReplyAction\(p\.replyState\)/.test(src)) bad.push('normalize-drops-reply-state');
        /* ② 待回应投影必须排除读不出源的接触点。 */
        if (!/if \(p\.readable !== true\) return false;/.test(src)) bad.push('no-readable-guard');
        /* ③ 落地不许编 ref（本版零例可落地）。 */
        if (/return \{ appId: appId, ref: \{/.test(src)) bad.push('fake-landing-ref');
        /* ④ 两族状态不许合流：markPoint 一族不许写 replyState。 */
        /* ★ 必须去注释：markPointReply 前面的档头正写着「markSeen / markAnswered 绝不反写 replyState」，
         *   裸切片会把那句注释当成「实现里写了 replyState」（首版实测把真仓判红）。 */
        const markZone = stripComments(src.slice(src.indexOf('function markPoint('), src.indexOf('export function markPointReply')));
        if (markZone.includes('replyState')) bad.push('markpoint-writes-reply-state');
        return bad;
    }

    /* 一向：真仓必绿 */
    assert.deepEqual(kernelJudge(ORIGINAL), [], '真仓在判据本身上必须全绿');

    /* 二向：四处破坏必须各自被抓 */
    const breaks = [
        ['replyState: hasReplyAction(p.replyState) ? str(p.replyState) : \'\',',
            "replyState: '',", 'normalize-drops-reply-state',
            '归一层不接 replyState ⇒ 点了已回应、刷新又回到清单'],
        ['if (p.readable !== true) return false;',
            'if (false) return false;', 'no-readable-guard',
            '摘掉无源守卫 ⇒ 用户对着一条不知道该去哪回应的条目做决定'],
        ['    return { appId: appId, ref: null, landed: false, why: COMM_LANDING.NO_LANDING };',
            "    return { appId: appId, ref: { kind: 'chat', id: p.refId }, landed: true, why: COMM_LANDING.OK };",
            'fake-landing-ref',
            '造一个本版根本没有的靶心 ⇒ 用户以为这条被删了'],
    ];
    for (const [old, neu, code, why] of breaks) {
        const broken = mutate(ORIGINAL, old, neu, code);
        const got = kernelJudge(broken);
        assert.ok(got.indexOf(code) >= 0,
            '★ 破坏副本必须被抓：' + why + '（期望 ' + code + '，实测 ' + JSON.stringify(got) + '）');
    }

    /* 三向：锚点不唯一必须抛（挑一处真·多处出现的） */
    const AMBIG = 'const arr = Array.isArray(list) ? list : [];';
    assert.ok(ORIGINAL.split(AMBIG).length - 1 > 1, '★ 「锚点不唯一」这一向的锚点必须实测多处出现，否则该向在空转');
    assert.throws(() => mutate(ORIGINAL, AMBIG, 'const arr = [];', 'anchor-not-unique'),
        /锚点必须恰中 1 次/, '★ 锚点不唯一时必须抛，不许静默改到别处');

    /* 四向：无关改动必须仍绿（防判据过敏） */
    const neutral = mutate(ORIGINAL, '/* ---------- 基础归一', '/* ---------- 基础归一（无关改动）', 'neutral');
    assert.deepEqual(kernelJudge(neutral), [], '★ 无关改动必须仍绿');
});

test('F6 结构自证：导出面非空、内核自检仍绿（防「空对空」全绿）', () => {
    assert.ok(Object.keys(K).length >= 20, '内核导出面不得塌缩（实测 ' + Object.keys(K).length + '）');
    for (const k of ['COMM_REPLY_ACTIONS', 'markPointReply', 'replyPointsOf', 'replyLandingOf', 'COMM_CHANNEL_APP', 'COMM_LANDING']) {
        assert.ok(K[k], '★ 内核缺导出：' + k);
    }
    const self = K.commSelfCheck();
    assert.equal(self.ok, true, '内核自检必须绿：' + JSON.stringify(self.problems));
    /* 扫描面非空：源文件必须真存在且足够大（防判据扫到空文件全绿）。 */
    assert.ok(read(VIEW_REL).length > 2000, '视图文件不得薄成空壳');
    assert.ok(read(APP_REL).length > 4000, 'App 文件不得薄成空壳');
});
