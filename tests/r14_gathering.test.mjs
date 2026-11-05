/* ============================================================
 * tests/r14_gathering.test.mjs — v4.124.0 · R14-X2 多人邀约的邀请到散场
 * ------------------------------------------------------------
 * 判据分六面（口径同 r14_x1_reply_board.test.mjs）：
 *   A 口径：答复五态 / 阶段七态 / 上限 / 三张词表互不并表
 *   B 状态机：建场拒绝、逐人答复边界、pending 不许写进答复表
 *   C ★ 四条验收旅程（需求第 26 行逐条对应）：
 *       C1 改期使旧答复待复核，不默认全员参加（旧轮一个字节不改）
 *       C2 只确认后建日程（wrote 恒 false）
 *       C3 取消不删除相关聊天（chatRefs 逐字节不变）
 *       C4 重复确认不重复建（恒同键 + replayed）
 *   D 刷新保留与会话隔离：写回存储再读出仍在；换 storage 不串
 *   E 宿主与接线件：事件契约双侧、scheduleKey 落户、回执链路、幂等开卡
 *   F 结构自证与负控制：源面四处破坏必须各自被抓
 *
 * ★ 判据纪律（与 X1 同款）：
 *   ① 不引用被测模块自己的词表当结论；
 *   ② 破坏必须在**真源码副本**上重跑同款判据，不许写死模拟常量；
 *   ③ 破坏锚点必须**恰中 1 次**，否则整件抛出。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
/** 去注释（只留代码）：多处要查「代码里有没有 X」，而注释里正写着「不许有 X」。 */
function stripComments(src) {
    return String(src)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
const MIN_VERSION = '4.124.0';
const KERNEL_REL = 'config/gathering-plan.js';
const STORE_REL = 'config/gathering-store.js';
const WIRE_REL = 'apps/wechat/gathering-wire.js';
const VIEW_REL = 'apps/wechat/chat-view.js';
const APP_REL = 'apps/wechat/wechat-app.js';
const HOST_REL = 'index.js';
const EVENTS_REL = 'config/phone-events.js';
const STORAGE_REL = 'config/storage.js';
const KEYS_REL = 'scripts/keys-audit.mjs';

const K = await import(pathToFileURL(rel(KERNEL_REL)).href);
const S = await import(pathToFileURL(rel(STORE_REL)).href);
const W = await import(pathToFileURL(rel(WIRE_REL)).href);
const T0 = 1761187200000;

/** 内存 storage 桩（与真 PhoneStorage 的 get/set/remove 同形）。 */
function mkStorage() {
    const bag = new Map();
    return {
        get(k, dflt) { return bag.has(k) ? bag.get(k) : dflt; },
        set(k, v) { bag.set(k, v); },
        remove(k) { bag.delete(k); },
        _bag: bag,
    };
}

/** 造一场：三人两时段（走真内核写路径，不手捏对象）。 */
function seed(now = T0) {
    const r = K.createGathering({
        title: '周五 KTV',
        invitees: [{ id: 'm1', name: '甲' }, { id: 'm2', name: '乙' }, { id: 'm3', name: '丙' }],
        candidates: [{ label: '周五晚 8 点' }, { label: '周六下午' }],
        chatRefs: [{ channel: 'wechat', refId: 'chat_1', label: '周末小组' }],
    }, now);
    assert.equal(r.ok, true, '造场必须成功：' + r.why);
    return r.gathering;
}

/* ============================================================
 * A 口径
 * ============================================================ */
test('A1 答复五态齐备：yes/no/maybe/pending/stale 各自可达且取值固定', () => {
    const vals = Object.values(K.GP_REPLIES).sort();
    assert.deepEqual(vals, ['maybe', 'no', 'pending', 'stale', 'yes']);
});

test('A2 阶段七态齐备且 unknown 具名（不认识的状态不猜）', () => {
    const vals = Object.values(K.GP_STATES).sort();
    assert.deepEqual(vals, ['cancelled', 'closed', 'confirmed', 'draft', 'invited', 'replied', 'unknown']);
    assert.equal(K.gatheringStateLabel('nonsense'), '', '不认识的状态标签必须是空串');
});

test('A3 ★ 三张词表不并表：GP_REASONS 14 项，且不与 COMM/GV 共用名字', async () => {
    assert.equal(Object.keys(K.GP_REASONS).length, 14);
    /* 群投票词表是另一层的问题：本表不许把它并进来。 */
    const gv = await import(pathToFileURL(rel('config/group-vote-contract.js')).href);
    const gvVals = new Set(Object.values(gv.GV_REASONS || {}));
    for (const v of Object.values(K.GP_REASONS)) {
        assert.equal(gvVals.has(v), false, 'GP_REASONS 不许与 GV_REASONS 同名：' + v);
    }
});

test('A4 上限冻结（邀请 40 / 候选 8 / 轮次 8 / 台账 40）', () => {
    assert.equal(K.GP_LIMITS.invitees, 40);
    assert.equal(K.GP_LIMITS.candidates, 8);
    assert.equal(K.GP_LIMITS.rounds, 8);
    assert.equal(K.GP_LIMITS.gatherings, 40);
});

test('A5 答复标签与阶段标签与词表一一对应（视图不写第二份映射）', () => {
    assert.equal(K.replyLabel('yes'), '说来');
    assert.equal(K.replyLabel('stale'), '要复核');
    assert.equal(K.replyLabel('pending'), '没回');
    assert.equal(K.replyLabel(''), '');
    assert.equal(K.gatheringStateLabel('cancelled'), '已取消');
});

/* ============================================================
 * B 状态机
 * ============================================================ */
test('B1 建场拒绝：没标题 no-title / 没邀请对象 no-invitees', () => {
    assert.equal(K.createGathering({ invitees: [{ id: 'a' }] }, T0).why, K.GP_REASONS.NO_TITLE);
    assert.equal(K.createGathering({ title: 'KTV' }, T0).why, K.GP_REASONS.NO_INVITEES);
});

test('B2 只接被邀请者的答复：不在名单 reject、坏答复词 reject', () => {
    const g = seed();
    assert.equal(K.setReply(g, 'm9', 'yes', T0).why, K.GP_REASONS.NOT_INVITED);
    assert.equal(K.setReply(g, 'm1', 'whatever', T0).why, K.GP_REASONS.REPLY_UNKNOWN);
});

test('B3 ★ pending 不许写进答复表（写进去等于伪造一个回答）', () => {
    const g = seed();
    assert.equal(K.setReply(g, 'm1', 'pending', T0).why, K.GP_REASONS.REPLY_UNKNOWN);
    const r = K.setReply(g, 'm1', 'yes', T0);
    assert.equal(r.ok, true);
    const keys = r.gathering.rounds[0].replies.map((x) => x.reply);
    assert.equal(keys.includes('pending'), false, '答复表里不许出现 pending');
});

test('B4 答复推进 invited → replied；三人三态各自如实读数', () => {
    let g = seed();
    g = K.setReply(g, 'm1', 'yes', T0).gathering;
    assert.equal(g.stage, 'replied');
    g = K.setReply(g, 'm2', 'no', T0).gathering;
    g = K.setReply(g, 'm3', 'maybe', T0).gathering;
    const b = K.replyBoard(g);
    assert.equal(b.counts.replied, 3);
    assert.equal(b.counts.going, 1);
    assert.equal(b.counts.yes, 1);
    assert.equal(b.counts.no, 1);
    assert.equal(b.counts.maybe, 1);
    assert.equal(b.counts.pending, 0);
});

test('B5 表外答复单列 foreign，且不混进三圈人', () => {
    const g = seed();
    const bad = JSON.parse(JSON.stringify(g));
    bad.rounds[0].replies.push({ memberId: 'x9', name: '路人', reply: 'yes', at: T0, origin: '' });
    const b = K.replyBoard(K.normalizeGathering(bad));
    assert.ok(b.counts.foreign >= 1, '不在名单的答复必须单列 foreign');
    const names = b.rows.filter((r) => r.reply === 'yes').map((r) => r.name);
    assert.equal(names.includes('路人'), false, '表外人不得进说来名单');
});

test('B6 坏条目不静默消失：有 id 没标题的保留并标 readable:false', () => {
    const list = K.normalizeGatherings([{ id: 'g1' }, null, 'x']);
    assert.equal(list.length >= 1, true);
    assert.equal(list[0].readable, false);
    assert.equal(list[0].gatherId, 'g1');
});

test('B7 散场只收被邀请者：外来名字不进到场回执', () => {
    const g = seed();
    const r = K.closeGathering(g, T0, { attended: ['m1', 'm9'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.gathering.attended, ['m1']);
    assert.equal(K.closeGathering(r.gathering, T0).why, K.GP_REASONS.ALREADY_CLOSED);
});

/* ============================================================
 * C 四条验收旅程
 * ============================================================ */
test('C1 ★ 改期使旧答复待复核，不默认全员参加', () => {
    let g = seed();
    g = K.setReply(g, 'm1', 'yes', T0).gathering;
    g = K.setReply(g, 'm2', 'no', T0).gathering;
    /* 丙从头没说过话 */
    const rs = K.reschedule(g, { reason: '有人没空' }, T0 + 1000);
    assert.equal(rs.ok, true);

    /* ① 旧轮一个字节都不许改写（否则「第 1 轮他说来」这条证据永久消失） */
    const oldReplies = rs.gathering.rounds[0].replies.map((x) => x.memberId + '=' + x.reply).sort();
    assert.deepEqual(oldReplies, ['m1=yes', 'm2=no']);

    /* ② 读数：说过话的两人 stale、从没开过口的丙仍 pending */
    const b = K.replyBoard(rs.gathering);
    assert.equal(b.counts.stale, 2, '说过话的两人必须读成要复核');
    assert.equal(b.counts.pending, 1, '从没开过口的仍是没有答复');
    assert.equal(b.counts.going, 0, '不默认全员参加');
    assert.equal(b.counts.replied, 0, '本轮还没有人答过');

    /* ③ stale 行必须带出「他当时怎么说的、哪一轮说的」 */
    const staleA = b.rows.find((r) => r.memberId === 'm1');
    assert.equal(staleA.reply, 'stale');
    assert.equal(staleA.was, 'yes');
    assert.equal(staleA.wasRound, 1);

    /* ④ 回执具名（改期时点名谁要复核） */
    const named = rs.stale.map((x) => x.name).sort();
    assert.deepEqual(named, ['乙', '甲']);
});

test('C2 ★ 只确认后建日程：confirmGathering 的 wrote 恒 false', () => {
    let g = seed();
    g = K.setReply(g, 'm1', 'yes', T0).gathering;
    const r = K.confirmGathering(g, { slotId: g.candidates[0].id }, T0 + 1000);
    assert.equal(r.ok, true);
    assert.equal(r.wrote, false, '本件不落日程：建不建在约定 owner');
    assert.notEqual(r.scheduleKey, '');
});

test('C3 ★ 取消不删除相关聊天：chatRefs 逐字节不变', () => {
    const g = seed();
    const before = JSON.stringify(g.chatRefs);
    const r = K.cancelGathering(g, T0 + 1000, '用户取消');
    assert.equal(r.ok, true);
    assert.equal(r.gathering.stage, 'cancelled');
    assert.equal(JSON.stringify(r.gathering.chatRefs), before, '取消不许动 chatRefs');
    assert.equal(K.confirmGateOf(r.gathering).canConfirm, false, '取消后不再建日程');
});

test('C4 ★ 重复确认不重复建：同场同轮同时段恒同键 + replayed', () => {
    let g = seed();
    g = K.setReply(g, 'm1', 'yes', T0).gathering;
    const slotId = g.candidates[0].id;
    const a = K.confirmGathering(g, { slotId }, T0 + 1000);
    const b = K.confirmGathering(a.gathering, { slotId }, T0 + 2000);
    assert.equal(b.scheduleKey, a.scheduleKey, '同场同轮同时段必须恒同键');
    assert.equal(b.replayed, true);
    assert.equal(a.replayed, false);
    /* ★ 两个键必须在「改期之后」分开：改期后同一时段重新成立是另一场约定 */
    const rs = K.reschedule(a.gathering, { reason: '改期' }, T0 + 3000);
    const c = K.confirmGathering(rs.gathering, { slotId }, T0 + 4000);
    assert.notEqual(c.scheduleKey, a.scheduleKey, '改期后同一时段是另一场约定，不算重复建');
});

test('C5 未点时段不许确认（不替用户挑第一个）', () => {
    let g = seed();
    g = K.setReply(g, 'm1', 'yes', T0).gathering;
    const r = K.confirmGathering(g, {}, T0 + 1000);
    assert.equal(r.ok, false);
    assert.equal(r.why, K.GP_REASONS.SLOT_ABSENT);
});

test('C6 没人答复也能定，但读数必须如实警告「不是大家定了」', () => {
    const g = seed();
    const gate = K.confirmGateOf(g);
    assert.equal(gate.canConfirm, true);
    assert.notEqual(gate.warn, '', '没人答复时必须有一句警示');
});

/* ============================================================
 * D 存储
 * ============================================================ */
test('D1 写回再读出：改期与答复都还在（刷新不丢）', () => {
    const st = mkStorage();
    let g = seed();
    g = K.setReply(g, 'm1', 'yes', T0).gathering;
    g = K.reschedule(g, { reason: '改期' }, T0 + 1000).gathering;
    S.saveGathering(st, g);
    const back = S.findGathering(st, g.gatherId);
    assert.ok(back, '写回后必须读得到');
    assert.equal(back.rounds.length, 2);
    assert.equal(back.rounds[0].replies[0].reply, 'yes', '旧轮答复必须原样保留');
    const b = K.replyBoard(back);
    assert.equal(b.counts.stale, 1);
});

test('D2 同 id 覆盖不追加（否则列表里会出现两条同一场，导致双建）', () => {
    const st = mkStorage();
    const g = seed();
    S.saveGathering(st, g);
    S.saveGathering(st, Object.assign({}, g, { title: '周五 KTV（改名）' }));
    const list = S.readGatherings(st);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, '周五 KTV（改名）');
});

test('D3 会话隔离：换一份 storage 读不到别人那一场', () => {
    const a = mkStorage();
    const b = mkStorage();
    const g = seed();
    S.saveGathering(a, g);
    assert.ok(S.findGathering(a, g.gatherId));
    assert.equal(S.findGathering(b, g.gatherId), null);
});

test('D4 fail-safe：坏存储 / 坏 JSON / 空 id 一律不抛并给确定的空读数', () => {
    assert.deepEqual(S.readGatherings(null), []);
    const st = mkStorage();
    st.set('gathering_plan_v1', '{not json');
    assert.deepEqual(S.readGatherings(st), []);
    assert.equal(S.findGathering(st, ''), null);
    assert.equal(S.findGathering(st, 'nope'), null);
    assert.equal(S.saveGathering(st, null), false);
    assert.equal(S.dropGathering(st, ''), false);
});

test('D5 只删台账：dropGathering 不碰聊天引用也不会波及别的场次', () => {
    const st = mkStorage();
    const g1 = seed();
    const g2 = K.createGathering({ title: '周六爬山', invitees: [{ id: 'z', name: '丁' }] }, T0).gathering;
    S.saveGathering(st, g1);
    S.saveGathering(st, g2);
    assert.equal(S.dropGathering(st, g1.gatherId), true);
    const list = S.readGatherings(st);
    assert.equal(list.length, 1);
    assert.equal(list[0].gatherId, g2.gatherId);
});

/* ============================================================
 * E 宿主与接线件
 * ============================================================ */
test('E1 事件契约双侧：常量表与元数据表都有 GATHERING_CONFIRM', async () => {
    const ev = await import(pathToFileURL(rel(EVENTS_REL)).href);
    assert.equal(ev.PHONE_EVENTS.GATHERING_CONFIRM, 'phone:gatheringConfirm');
    const meta = ev.PHONE_EVENT_CONTRACT[ev.PHONE_EVENTS.GATHERING_CONFIRM];
    assert.ok(meta, '契约元数据必须存在（缺了 system-v226 的对账会红）');
    assert.equal(meta.target, 'window');
    assert.ok(String(meta.note || '').length > 10);
});

test('E2 消息标签两条：建卡与答复，且答复词认不出返回空串（不造假答复）', () => {
    assert.deepEqual([...W.GP_MESSAGE_KINDS], ['gathering_card', 'gathering_reply']);
    assert.equal(W.replyIdOfWord(' 来 '), 'yes');
    assert.equal(W.replyIdOfWord('不去'), 'no');
    assert.equal(W.replyIdOfWord('看情况'), 'maybe');
    assert.equal(W.replyIdOfWord('随便'), '', '认不出的词必须返回空串');
});

test('E3 同一条消息恒同一场（重复解析不建两场，且不覆盖已有进度）', () => {
    const app = { storage: mkStorage(), wechatData: null };
    const wire = new W.GatheringWire(app);
    const msg = {
        id: 'msg-1', chatId: 'grp1',
        gatheringCard: {
            title: '周五 KTV',
            invitees: [{ id: 'm1', name: '甲' }],
            candidates: [{ label: '周五晚 8 点' }],
        },
    };
    const a = wire.openFromMessage(msg, T0);
    assert.equal(a.ok, true);
    /* 先记一条答复，再重复解析同一条消息 */
    wire.applyReplyFromMessage({ gatheringReply: { memberId: 'm1', reply: 'yes' } }, T0 + 100);
    const b = wire.openFromMessage(msg, T0 + 200);
    assert.equal(b.existed, true);
    assert.equal(b.gathering.gatherId, a.gathering.gatherId);
    assert.equal(K.replyBoard(b.gathering).counts.yes, 1, '重复解析不许抹掉已有答复');
});

test('E4 ★ 确认时段派发宿主事件：detail 带幂等键与时段', () => {
    const dispatched = [];
    const app = { storage: mkStorage(), wechatData: null };
    const wire = new W.GatheringWire(app);
    globalThis.window = {
        CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
        dispatchEvent: (ev) => { dispatched.push(ev); return true; },
        addEventListener: () => {},
    };
    wire.openFromMessage({
        id: 'msg-9', chatId: 'g',
        gatheringCard: { title: '周五 KTV', invitees: [{ id: 'm1', name: '甲' }], candidates: [{ label: '周五晚 8 点' }] },
    }, T0);
    wire.setPickedSlot(wire.focused().candidates[0].id);
    const r = wire.confirmSlot('', wire.pickedSlot, T0 + 100);
    assert.equal(r.ok, true);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, 'phone:gatheringConfirm');
    assert.equal(dispatched[0].detail.scheduleKey, r.scheduleKey);
    assert.equal(dispatched[0].detail.slotLabel, '周五晚 8 点');
});

test('E5 回执链路：宿主写回执、接线件读得到；没接收者时如实为 null', () => {
    const app = { storage: mkStorage(), wechatData: null };
    const wire = new W.GatheringWire(app);
    assert.equal(wire._receipt, null);
    wire.noteConfirmReceipt({ ok: true, state: 'received', line: '已转交日历' });
    assert.equal(wire._receipt.state, 'received');
    assert.equal(wire.noteConfirmReceipt(null), null);
});

test('E6 宿主接住凭据：scheduleKey 落进草稿，重复转交报 replayed 且清草稿', async () => {
    const hs = await import(pathToFileURL(rel('apps/calendar/vote-handoff-store.js')).href);
    const st = mkStorage();
    const key = 'gps_test_key_1';
    const detail = { activityId: key, optionId: 'slot_1', round: 1, participants: ['甲'], label: '周五 KTV', place: '周五晚 8 点' };
    const a = hs.receiveHandoff(st, detail);
    assert.equal(a.ok, true);
    assert.equal(a.state, 'received');
    assert.ok(hs.pendingHandoff(st), '收下后必须有草稿');
    hs.markApplied(st, key);
    const b = hs.receiveHandoff(st, detail);
    assert.equal(b.state, 'replayed');
    assert.equal(hs.pendingHandoff(st), null, '已建过的草稿必须清掉（否则表单会预填一份建过的）');
});

/* ============================================================
 * F 结构自证与负控制
 * ============================================================ */
test('F1 内核自检仍绿（结构自证：导出面非空 + 词表数量对得上）', () => {
    const r = K.gatheringSelfCheck();
    assert.equal(r.ok, true, '内核自检失败：' + JSON.stringify(r.problems));
    assert.equal(r.states, 7);
    assert.equal(r.reasons, 14);
    assert.equal(r.replies, 5);
    assert.equal(S.gatheringStoreSelfCheck().problems.length, 0);
});

test('F2 接线件与视图/App 双侧接线齐备（不许只交内核）', () => {
    const app = stripComments(read(APP_REL));
    assert.ok(app.includes('new GatheringWire('), 'App 必须实例化接线件');
    assert.ok(app.includes('gatherConfirmSlot'), 'App 必须有确认出口');
    assert.ok(app.includes('.message-gather {'), '样式必须落在 App 的样式块里');
    assert.ok(app.includes('.message-gather-row.is-stale'), '要复核态必须有独立视觉（不许与 pending 同形）');

    const view = stripComments(read(VIEW_REL));
    assert.ok(view.includes("case 'gathering_card':"));
    assert.ok(view.includes("case 'gathering_reply':"));
    assert.ok(view.includes('_renderGatheringCard'));
    for (const a of ['gather-pick-slot', 'gather-mark-yes', 'gather-mark-no', 'gather-reschedule', 'gather-cancel', 'gather-confirm-slot']) {
        assert.ok(view.includes('data-action="' + a + '"'), '按钮必须渲染：' + a);
    }

    const host = stripComments(read(HOST_REL));
    assert.ok(host.includes('PHONE_EVENTS.GATHERING_CONFIRM'), '宿主必须接住确认事件');
    assert.ok(host.includes('receiveHandoff('), '宿主必须走同一份落笔实现');

    const storage = read(STORAGE_REL);
    assert.ok(storage.includes('/^gathering_/'), '隔离模式必须登记');
    const keys = read(KEYS_REL);
    assert.ok(keys.includes('gathering_plan_v1'), '键必须登记');
});

test('F3 版本锚：五源同版且 ≥ 4.124.0', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idx = read('index.js').match(/ST_PHONE_VERSION = '([^']+)'/)[1];
    assert.equal(pkg.version, MIN_VERSION);
    assert.equal(man.version, MIN_VERSION);
    assert.equal(log.latest, MIN_VERSION);
    assert.equal(idx, MIN_VERSION);
    assert.ok(log.versions && log.versions[MIN_VERSION], '更新日志必须有本版条目');
});

test('F4 ★ 负控制：真源码副本上重跑同款判据，四处破坏必须各自被抓', async () => {
    const src = read(KERNEL_REL);

    /* 破坏① 把 stale 推导关掉 ⇒ 改期后旧答复被读成 pending（「改期」在界面消失） */
    const b1 = src.replace('const reply = hit ? hit.reply : (old ? GP_REPLIES.STALE : GP_REPLIES.PENDING);', 'const reply = hit ? hit.reply : GP_REPLIES.PENDING;');
    assert.notEqual(b1, src, '锚点①没命中');
    /* 破坏② 让 reschedule 改写旧轮答复（把历史抹掉）：注入在深拷贝之后，作用于 next */
    const b2 = src.replace('const roundNo = last.round + 1;', "for (const rr of next.rounds) { for (const it of rr.replies) it.reply = 'stale'; }\n    const roundNo = last.round + 1;");
    assert.notEqual(b2, src, '锚点②没命中');
    /* 破坏③ 取消时顺手清空 chatRefs（删了相关聊天） */
    const b3 = src.replace('next.stage = GP_STATES.CANCELLED;', 'next.stage = GP_STATES.CANCELLED; next.chatRefs = [];');
    assert.notEqual(b3, src, '锚点③没命中');
    /* 破坏④ 幂等键去掉轮次 ⇒ 改期后重新确认会被判成重复建 */
    const b4 = src.replace("shortHash(g.gatherId + '#' + round + '#' + slotId)", "shortHash(g.gatherId + '#' + slotId)");
    assert.notEqual(b4, src, '锚点④没命中');

    const cases = [
        ['stale 推导被关掉',
            (m) => { let g = seed(); g = K.setReply(g, 'm1', 'yes', T0).gathering; const rs = m.reschedule(g, { reason: 'x' }, T0 + 1); return m.replyBoard(rs.gathering).counts.stale === 2; },
            b1],
        ['旧轮被改写',
            (m) => { let g = seed(); g = K.setReply(g, 'm1', 'yes', T0).gathering; const rs = m.reschedule(g, { reason: 'x' }, T0 + 1); return rs.gathering.rounds[0].replies[0].reply === 'yes'; },
            b2],
        ['取消清空了 chatRefs',
            (m) => { const g = seed(); return m.cancelGathering(g, T0 + 1, 'x').gathering.chatRefs.length === 1; },
            b3],
        ['幂等键漏了轮次',
            (m) => { let g = seed(); g = m.setReply(g, 'm1', 'yes', T0).gathering; const keep = g.candidates[0].id; const a = m.confirmGathering(g, { slotId: keep }, T0 + 1); const rs = m.reschedule(a.gathering, { reason: 'x' }, T0 + 2); const c = m.confirmGathering(rs.gathering, { slotId: keep }, T0 + 3); return c.scheduleKey !== a.scheduleKey; },
            b4],
    ];

    for (const [name, judge, brokenSrc] of cases) {
        /* 写到临时文件再 import：跑的是**真源码的副本**，不是模拟常量。 */
        const tmp = rel('config/.tmp-neg-' + Math.random().toString(36).slice(2) + '.mjs');
        fs.writeFileSync(tmp, brokenSrc);
        let broken = null;
        try {
            broken = await import(pathToFileURL(tmp).href + '?t=' + Date.now());
            const stillOk = judge(broken);
            assert.equal(stillOk, false, '负控制失效：破坏「' + name + '」之后判据仍然通过');
        } finally {
            fs.unlinkSync(tmp);
        }
    }
});

test('F5 负控制纪律：锚点必须恰中 1 次（否则改的不是我以为那处）', () => {
    const src = read(KERNEL_REL);
    for (const anchor of [
        'const reply = hit ? hit.reply : (old ? GP_REPLIES.STALE : GP_REPLIES.PENDING);',
        'const roundNo = last.round + 1;',
        'next.stage = GP_STATES.CANCELLED;',
        "shortHash(g.gatherId + '#' + round + '#' + slotId)",
    ]) {
        const n = src.split(anchor).length - 1;
        assert.equal(n, 1, '锚点必须恰中 1 次：' + anchor + '（实际 ' + n + '）');
    }
});

test('F6 无残留调试件：内核/存储/接线件不许有 console.log 与 debugger', () => {
    for (const p of [KERNEL_REL, STORE_REL, WIRE_REL]) {
        const code = stripComments(read(p));
        assert.equal(/console\.(log|debug)\(/.test(code), false, p + ' 里有 console.log');
        assert.equal(/debugger/.test(code), false, p + ' 里有 debugger');
    }
});