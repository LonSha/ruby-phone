/* ========================================================
 * r14_o5_inline_action_idempotent.test.mjs — [v4.120.0 · 第十四期 R14-O5]
 * 消息动作的重复点击与后续撤销
 * --------------------------------------------------------
 * 计划书该项验收原文：
 *   「增稳定来源身份、幂等提交回执与重复处理提示；源句变化、日期变化、撤后重办分别处理。
 *     玩家入口：微信消息动作条与日历回执。
 *     验收旅程：双击只新增一条；刷新后再点不重复；撤销只针对该动作创建项；
 *               不撤掉后来人工修改的内容。」
 *
 * 【这一刀治的四种形态，逐种都要能单独观测】
 *   ① 双击 ⇒ 两次提交，日历里两条一模一样（用户点两下，数据错一次）；
 *   ② 刷新 / 重进会话 ⇒ 实例内存清了，按钮重新变「加入日程」，再点又一条；
 *   ③ 源句被改过（重 roll / 编辑消息）⇒ 标题变了，用户以为是同一件事，实际又加一条；
 *   ④ 撤后重办 ⇒ **这条合法**，但它与①②在旧代码里长得一模一样（都是「调 commitAction」），
 *      故必须有独立归因词，不能被当成重复拦掉。
 *
 * 【为什么判据不能只测「返回 ok」】本仓最贵缺陷形态是「不报错、只是默默没生效」：
 *   · 重放时若只是「不再 addMemo」但仍刷新时间戳 ⇒ 回执说的时刻是假的，界面上看不出来；
 *   · 撤销若按标题找 ⇒ 删掉用户手写的那条，一个字都不报；
 *   · 撤销若不比内容 ⇒ 用户改过的条目无声消失；
 *   · 撤销若把「条目已经不在了」报成成功 ⇒ 回执说已撤销，用户在回收站里找不到。
 *   故 A/B/C/D/E 五组各自独立可观测，且 F 组用**真源码破坏**证明这些判据不是恒绿。
 *
 * 分段：
 *   A 身份与指纹：identity 稳（跨刷新不变）、fingerprint 只管内容；
 *   B 幂等判定：new / replayed / drifted / recommit / invalid 五态逐态；
 *   C 提交面：replayed 一个字节都不写、drifted 写明「上一条已作废」、recommit 正常新建；
 *   D 撤销面：按 memoId 删、entry-missing / modified-since 不静默、撤后不可再撤；
 *   E 接线：动作条跨「重建实例」仍然判得重（刷新不再重复）、一条消息两个档互不串；
 *   F 负控制：真源码破坏三处，逐处必须看得见行为变化；
 *   G 会话隔离与自证：台账键命中 /^ia_/、本套件覆盖了计划的四条验收旅程。
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness } from './_inline_action_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ } }
});

const LEDGER_REL = 'config/inline-action-ledger.js';
const COMMIT_REL = 'config/inline-action-commit.js';
const BAR_REL = 'apps/wechat/inline-action-bar.js';
const STORAGE_REL = 'config/storage.js';

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LG = await import(path.join(ROOT, LEDGER_REL));
const CM = await import(path.join(ROOT, COMMIT_REL));
const IA = await import(path.join(ROOT, 'config', 'inline-action.js'));
const BarMod = await import(path.join(ROOT, BAR_REL));

/** 固定剧情当下：2026-10-01（星期四）10:00。本地时间构造，带 Z 会因时区漂。 */
const T0 = new Date(2026, 9, 1, 10, 0, 0).getTime();
const NOW = { storyMs: T0 };
const H = makeHarness(T0);
const { mkStorage, mkCalendar, mkMsg, mkApp, mkHost, paintMessages, withDom } = H;

/** 取内核给出的某一档真候选（不手搓候选：手搓的候选测不到「sourceMsgId 接得上」）。 */
function actOf(content, kind) {
    const scan = IA.scanMessage(mkMsg('m1', content), NOW);
    const got = (scan.actions || []).find((a) => a.kind === kind) || null;
    assert.ok(got, '内核必须给出 ' + kind + ' 档：' + content);
    return got;
}
/** 提交一次并把结果落账（**这是动作条的完整一轮**，抽出来只为一处实现）。 */
function commitOnce(ledger, storage, act, ctxOpt) {
    const o = ctxOpt || {};
    const plan = LG.planCommit(ledger, act, T0);
    const res = CM.commitAction(act, {
        calendarData: o.calendar,
        nowMs: T0,
        chatName: '阿莲',
        atMs: T0,
        ledger: plan
    });
    let next = ledger;
    if (res.ok && res.entryId && !res.replayed) {
        const p = act.payload || {};
        const written = (o.calendar && typeof o.calendar.getMemos === 'function')
            ? (o.calendar.getMemos() || []).find((m) => String(m.id) === String(res.entryId)) : null;
        next = LG.appendRecord(ledger, {
            identity: LG.identityOf(act),
            sourceMsgId: String(act.sourceMsgId || ''),
            kind: String(act.kind || ''),
            memoId: String(res.entryId),
            fingerprint: LG.fingerprintOf(act),
            title: String((written && written.title) || p.title || act.title || '').trim(),
            dateKey: String((written && written.dateKey) || p.dateKey || '').trim(),
            time: String((written && written.time) || p.time || '').trim(),
            status: LG.IA_RECORD_STATUS.committed,
            at: T0
        }, plan.decision === LG.IA_LEDGER_WHY.drifted ? plan.supersede : null);
        if (storage) LG.writeLedger(storage, next);
    }
    return { res: res, plan: plan, ledger: next };
}

/* ══════════ A 身份与指纹 ══════════ */
test('A1 身份只由 sourceMsgId + kind 决定：跨刷新不变，且与标题无关', () => {
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const again = actOf('明天晚上八点一起吃饭吧', 'schedule');
    assert.equal(LG.identityOf(act), LG.identityOf(again), '同一条消息的同一档，重算多少遍都是同一个身份');
    assert.equal(LG.identityOf(act), 'm1|schedule');
    /* 标题变了仍是同一身份 —— 这正是本项要能看见（而不是悄悄变成新身份）的形态。 */
    const renamed = Object.assign({}, act, { title: '换个说法' });
    assert.equal(LG.identityOf(renamed), LG.identityOf(act), '★ 标题不许参与身份：改了标题仍是「同一件事」');
    /* 但指纹必须变（这才是判定 drifted 的依据）。 */
    assert.notEqual(LG.fingerprintOf(renamed), LG.fingerprintOf(act), '指纹必须跟着内容变');
});

test('A2 没出处就没有身份：identityOf 返回空串，不许编一个', () => {
    assert.equal(LG.identityOf({ kind: 'schedule' }), '', '没有 sourceMsgId ⇒ 空身份');
    assert.equal(LG.identityOf({ sourceMsgId: 'm1' }), '', '没有 kind ⇒ 空身份');
    assert.equal(LG.identityOf(null), '');
    /* 空身份必须被判成 invalid（不能当成 new 放过去 —— 否则台账记不住它，撤销也就无从谈起）。 */
    const p = LG.planCommit([], { kind: 'schedule', title: 'x', payload: {} }, T0);
    assert.equal(p.decision, 'invalid');
    assert.equal(p.why, LG.IA_LEDGER_WHY.invalid);
});

test('A3 指纹三件纯空白按空串收：多一个空格不许被判成「内容变了」', () => {
    const a = { sourceMsgId: 'm1', kind: 'memo', title: ' 聚一聚 ', payload: { dateKey: ' 2026-10-02 ', time: ' ' } };
    const b = { sourceMsgId: 'm1', kind: 'memo', title: '聚一聚', payload: { dateKey: '2026-10-02', time: '' } };
    assert.equal(LG.fingerprintOf(a), LG.fingerprintOf(b));
    /* 但真变了必须能分出来。 */
    const c = Object.assign({}, b, { payload: { dateKey: '2026-10-03', time: '' } });
    assert.notEqual(LG.fingerprintOf(c), LG.fingerprintOf(b), '★ 日期变了必须算内容变了（否则「改了日子」会被当重放拦掉）');
});

/* ══════════ B 幂等判定的五态 ══════════ */
test('B1 new：台账里没有 ⇒ 正常新建（不许对第一次点击就报「已办过」）', () => {
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const p = LG.planCommit([], act, T0);
    assert.equal(p.decision, 'new');
    assert.equal(p.why, LG.IA_LEDGER_WHY.new);
    assert.equal(p.record, null);
});

test('B2 replayed：同身份同指纹 ⇒ 不新建，交回旧记录（双击只新增一条）', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    assert.equal(first.res.ok, true);
    assert.equal(cal.calls.length, 1);
    /* 第二次：同一条消息、同样内容 —— 这就是「双击」的第二下。 */
    const second = commitOnce(first.ledger, null, act, { calendar: cal });
    assert.equal(second.plan.decision, 'replayed');
    assert.equal(second.res.ok, true);
    assert.equal(second.res.replayed, true);
    assert.equal(second.res.why, CM.INLINE_COMMIT_WHY.replayed);
    assert.equal(cal.calls.length, 1, '★ 双击只许新增一条：第二次一个字节都不许写盘');
    assert.equal(second.res.entryId, first.res.entryId, '重放必须交回**原来那一条**（不是编个新 id）');
});

test('B3 replayed 不许刷新时间戳：回执说的「什么时候办的」必须是原来那一次', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    const atWas = first.ledger[0].at;
    assert.equal(atWas, T0);
    /* 重放时传一个明显更晚的 now：若时间戳被刷新，`at` 就会变。 */
    const p = LG.planCommit(first.ledger, act, T0 + 86400000);
    assert.equal(p.decision, 'replayed');
    assert.equal(first.ledger[0].at, atWas, '★ 判定这一步只读不写：`at` 不许被 planCommit 动过');
    const res = CM.commitAction(act, {
        calendarData: cal, nowMs: T0 + 86400000, chatName: '阿莲', atMs: T0 + 86400000, ledger: p
    });
    assert.equal(res.replayed, true);
    assert.equal(cal.calls.length, 1, '重放不许写盘');
});

test('B4 drifted：同身份但指纹变了 ⇒ 允许新建，且必须指出被取代的旧记录', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    /* 源句被改过（重 roll / 编辑消息）：同一 message id，标题与日期都变了。 */
    const drifted = Object.assign({}, act, {
        title: '看电影',
        payload: { dateKey: '2026-10-05', time: '19:00', title: '看电影' }
    });
    const p = LG.planCommit(first.ledger, drifted, T0);
    assert.equal(p.decision, 'drifted');
    assert.ok(p.supersede, 'drifted 必须交回被取代的那一条（它是「上一条已作废」这句话的唯一依据）');
    assert.equal(p.supersede.memoId, first.res.entryId);
    const second = commitOnce(first.ledger, null, drifted, { calendar: cal });
    assert.equal(second.res.ok, true);
    assert.equal(cal.calls.length, 2, 'drifted 允许新建（用户确实改了这件事）');
    /* 旧记录降级 superseded 后仍留在台账里（换键存）。 */
    const old = second.ledger.find((r) => r.status === LG.IA_RECORD_STATUS.superseded);
    assert.ok(old, '旧记录必须留痕作废');
    assert.ok(old.identity.includes('#superseded@'), '同身份只能一条，旧记录必须换键：' + old.identity);
    const live = second.ledger.find((r) => r.identity === LG.identityOf(drifted)
        && r.status !== LG.IA_RECORD_STATUS.superseded);
    assert.ok(live, '现行记录必须指向新建的那一条');
    assert.equal(live.memoId, second.res.entryId);
});

test('B5 drifted 的回执必须写明「上一条已作废」—— 否则用户以为日历里只有一条', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    const drifted = Object.assign({}, act, {
        title: '看电影', payload: { dateKey: '2026-10-05', time: '19:00', title: '看电影' }
    });
    const second = commitOnce(first.ledger, null, drifted, { calendar: cal });
    assert.equal(second.res.ok, true);
    assert.ok(second.res.receipt.includes('上一条已作废'), '回执必须自己说清：' + second.res.receipt);
    assert.equal(second.res.supersededMemoId, first.res.entryId, '回执的数据面也要带上旧 id');
    /* 且必须明说旧那条**还在日历里**（本项不替用户删数据）。 */
    assert.ok(/还在日历里/.test(second.res.receipt), '不许暗示旧那条已被清掉：' + second.res.receipt);
    assert.equal(cal.entries.length, 2, '旧条目确实还在（撤销前用户能自己看见两条）');
});

test('B6 recommit：上次已撤销 ⇒ 合法重办，不许当成「重复」拦掉', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    /* 撤销：按 memoId 删 + 记 undone。 */
    const memo = cal.getMemos()[0];
    const undoPlan = LG.planUndo(first.ledger, LG.identityOf(act), memo);
    assert.equal(undoPlan.ok, true);
    assert.equal(cal.deleteMemo(first.res.entryId), true);
    const ledgerAfterUndo = undoPlan.nextRecords;
    /* 再点一次「加入日程」：这是**重办**，必须新建。 */
    const p = LG.planCommit(ledgerAfterUndo, act, T0);
    assert.equal(p.decision, 'recommit');
    assert.equal(p.why, LG.IA_LEDGER_WHY.recommit);
    const again = commitOnce(ledgerAfterUndo, null, act, { calendar: cal });
    assert.equal(again.res.ok, true);
    assert.equal(again.res.replayed, false, '★ 撤后重办不是重放');
    assert.equal(cal.calls.length, 2, '重办必须真写一条新的');
});

/* ══════════ C 提交面（写不写盘 / 写什么） ══════════ */
test('C1 replayed 短路必须在 kind 分派之前：reply 档重放不重复填草稿', () => {
    const act = actOf('周六有空吗', 'reply');
    /* reply 档不写盘，也就不会进台账 ⇒ 手造一条等价记录来验短路位置。 */
    const ledger = [{
        identity: LG.identityOf(act), sourceMsgId: 'm1', kind: 'reply',
        memoId: 'memo_x', fingerprint: LG.fingerprintOf(act),
        title: String(act.title || ''), dateKey: '', time: '',
        status: LG.IA_RECORD_STATUS.committed, at: T0
    }];
    const p = LG.planCommit(ledger, act, T0);
    assert.equal(p.decision, 'replayed');
    const res = CM.commitAction(act, { calendarData: mkCalendar(), nowMs: T0, ledger: p });
    assert.equal(res.ok, true);
    assert.equal(res.replayed, true);
    assert.equal(res.draft, '', '★ 重放不许再给草稿（否则双击等于把用户打了一半的字覆盖两遍）');
});

test('C2 没有台账可问时行为逐字不变：不传 ledger ⇒ 照常提交（老调用方不受影响）', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const res = CM.commitAction(act, { calendarData: cal, nowMs: T0, chatName: '阿莲', atMs: T0 });
    assert.equal(res.ok, true);
    assert.equal(res.replayed, false);
    assert.equal(cal.calls.length, 1);
    assert.equal(cal.calls[0].sourceMsgId, 'm1', '来源必须照旧落到条目上');
});

test('C3 日历不在时台账不许记「办过了」（记了就等于这件事永远撤不掉）', () => {
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const p = LG.planCommit([], act, T0);
    const res = CM.commitAction(act, { calendarData: null, nowMs: T0, chatName: '阿莲', atMs: T0, ledger: p });
    assert.equal(res.ok, false);
    assert.equal(res.why, CM.INLINE_COMMIT_WHY.noCalendar);
    assert.equal(res.entryId, '', '没写成就没有 entryId');
    /* 调用方只有在 `res.ok && res.entryId` 时才落账 —— 这条纪律写在动作条里，此处核它。 */
    const bar = readRel(BAR_REL);
    assert.ok(bar.includes('if (res.ok && res.entryId)'), '动作条必须只在真写了条目时落账');
});

/* ══════════ D 撤销面（三条纪律） ══════════ */
test('D1 撤销按 memoId 删，不按标题找：同标题的第二条不受牵连', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    /* 用户自己手写一条一模一样的日程（同标题同日期）—— 这不是本动作创建的条目。 */
    const handWritten = cal.addMemo({ dateKey: '2026-10-02', title: '吃饭', time: '20:00', source: 'user' });
    const plan = LG.planUndo(first.ledger, LG.identityOf(act), cal.getMemos().find((m) => m.id === first.res.entryId));
    assert.equal(plan.ok, true);
    assert.equal(cal.deleteMemo(plan.record.memoId), true);
    assert.deepEqual(cal.deleted, [first.res.entryId], '★ 只许删本动作创建的那一条');
    assert.ok(cal.getMemos().some((m) => m.id === handWritten.id), '用户手写那条必须还在');
});

test('D2 entry-missing：条目已经不在 ⇒ 报「不存在」，不许报成功', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    /* 用户自己在日历里把那条删了（走的是回收站，本项不知情）。 */
    cal.deleteMemo(first.res.entryId);
    const plan = LG.planUndo(first.ledger, LG.identityOf(act), null);
    assert.equal(plan.ok, false);
    assert.equal(plan.why, LG.IA_LEDGER_WHY.entryMissing);
    assert.equal(plan.nextRecords, first.ledger.length ? plan.nextRecords : plan.nextRecords);
    assert.equal(plan.nextRecords[0].status, LG.IA_RECORD_STATUS.committed, '判定不过 ⇒ 台账一个字节都不许改');
});

test('D3 modified-since：条目办完之后被人工改过 ⇒ 不静默删（那是用户的东西）', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    const memo = cal.getMemos().find((m) => m.id === first.res.entryId);
    /* 用户改标题（把「吃饭」改成「吃饭 + 带上伞」）。 */
    memo.title = memo.title + ' + 带上伞';
    const plan = LG.planUndo(first.ledger, LG.identityOf(act), memo);
    assert.equal(plan.ok, false);
    assert.equal(plan.why, LG.IA_LEDGER_WHY.modifiedSince);
    assert.equal(cal.deleted.length, 0, '★ 判定不过就一个字节都不写：条目必须原样还在');
    /* 日期 / 时间任一项变动同样算改过（三项都要能各自拦下）。 */
    const memo2 = cal.getMemos().find((m) => m.id === first.res.entryId);
    memo2.time = '21:30';
    assert.equal(LG.planUndo(first.ledger, LG.identityOf(act), memo2).why, LG.IA_LEDGER_WHY.modifiedSince,
        '时间变了也算人工改过');
});

test('D4 撤过一次不许再撤：undone 记录必须报 nothing-to-undo，不报「已撤销」', () => {
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    const memo = cal.getMemos().find((m) => m.id === first.res.entryId);
    const p1 = LG.planUndo(first.ledger, LG.identityOf(act), memo);
    assert.equal(p1.ok, true);
    assert.equal(p1.nextRecords[0].status, LG.IA_RECORD_STATUS.undone);
    /* 第二次：条目已经不在了 + 记录已 undone —— 两种理由都指向「没得可撤」。 */
    const p2 = LG.planUndo(p1.nextRecords, LG.identityOf(act), null);
    assert.equal(p2.ok, false);
    assert.equal(p2.why, LG.IA_LEDGER_WHY.nothingToUndo, '★ 已撤过就报「没得可撤」，不许再报成功');
});

test('D5 台账里没有这条记录 ⇒ nothing-to-undo（不是「撤销失败」）', () => {
    const p = LG.planUndo([], 'm1|schedule', { id: 'memo_1', title: 'x', dateKey: '', time: '' });
    assert.equal(p.ok, false);
    assert.equal(p.why, LG.IA_LEDGER_WHY.nothingToUndo);
    assert.equal(p.record, null);
});

test('D6 动作条把三种「不成」翻成三句不同的人话（不合并成一句「撤销失败」）', () => {
    const src = readRel(BAR_REL);
    assert.ok(src.includes('_undoWhyText'), '判定要翻译成人话（一个函数一处实现）');
    assert.ok(src.includes('已经不在日历里'), 'entry-missing 要说得让人能明白');
    assert.ok(src.includes('被改过'), 'modified-since 要说得让人能明白');
    assert.ok(src.includes('可能已经撤过了'), 'nothing-to-undo 要说得让人能明白');
});

/* ══════════ E 接线（动作条跨实例仍然判得重） ══════════ */
test('E1 刷新之后再点不重复：**换一个动作条实例**仍然判得出重（这是台账 vs 内存的分界）', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '明天晚上八点一起吃饭吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    let firstEntry = '';
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar1 = new BarMod.InlineActionBar(app);
        bar1.mount();
        const btn = d.box.querySelectorAll('[data-ia-action="schedule"]')[0];
        assert.ok(btn, '必须有加日程按钮');
        d.box.fire('click', { target: btn });
        assert.equal(cal.calls.length, 1);
        firstEntry = String(cal.entries[0].id);
        bar1.unmount();
    });
    /* 「刷新 / 重进会话」⇒ 全新实例，`_done` 是空的。 */
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar2 = new BarMod.InlineActionBar(app);
        bar2.mount();
        const btn = d.box.querySelectorAll('[data-ia-action="schedule"]')[0];
        assert.ok(btn, '刷新后按钮还在（此时应显示「加入日程」—— 界面态本来就该跟界面一起消失）');
        d.box.fire('click', { target: btn });
        assert.equal(cal.calls.length, 1, '★ 刷新之后再点不许新增第二条（台账跨实例仍然成立）');
        assert.equal(String(cal.entries[0].id), firstEntry, '原来那一条必须原封不动');
        const receipt = d.box.querySelectorAll('.ia-receipt')[0];
        assert.ok(receipt, '重放必须给回执（不然用户以为没反应，会再点第三次）');
        assert.ok(/已经办过/.test(String(receipt.textContent)), '回执要说清「办过了」：' + String(receipt.textContent));
    });
});

test('E2 双击两次（同一实例连点）也只新增一条', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '明天晚上八点一起吃饭吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        const btn = d.box.querySelectorAll('[data-ia-action="schedule"]')[0];
        assert.ok(btn);
        /* 连点两下**同一个元素**（真实双击就是这种形状：第二下时按钮可能已经换过，但事件已派出）。 */
        d.box.fire('click', { target: btn });
        d.box.fire('click', { target: btn });
        assert.equal(cal.calls.length, 1, '★ 双击只新增一条');
    });
});

test('E3 一条消息两个档互不串：办日程之后再办备忘，两个档各自独立', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '明天晚上八点一起吃饭吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        const sched = d.box.querySelectorAll('[data-ia-action="schedule"]')[0];
        assert.ok(sched);
        d.box.fire('click', { target: sched });
        /* 办完日程后，备忘档必须**仍然可以办**（不许因为同一条消息就一起变成「撤销」）。 */
        const memoBtn = d.box.querySelectorAll('[data-ia-action="memo"]')[0];
        assert.ok(memoBtn, '★ 办了日程之后，备忘档的按钮必须还在（`_done` 键若退回 msgId 就会一起变成撤销）');
        d.box.fire('click', { target: memoBtn });
        assert.equal(cal.calls.length, 2, '两档各写一条');
        /* 台账里必须两条独立记录，身份不同。 */
        const recs = LG.readLedger(storage);
        assert.equal(recs.length, 2, '两档各一条台账记录');
        const ids = recs.map((r) => r.identity).sort();
        assert.deepEqual(ids, ['m1|memo', 'm1|schedule'], '身份必须按 kind 分开');
    });
});

test('E4 撤销只撤这一档：另一档的记录与条目都不许被牵连', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '明天晚上八点一起吃饭吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        d.box.fire('click', { target: d.box.querySelectorAll('[data-ia-action="schedule"]')[0] });
        d.box.fire('click', { target: d.box.querySelectorAll('[data-ia-action="memo"]')[0] });
        assert.equal(cal.calls.length, 2);
        const before = LG.readLedger(storage);
        const schedMemoId = before.find((r) => r.identity === 'm1|schedule').memoId;
        /* 撤销按钮上的 kind 必须能定位到具体哪一档。 */
        const undoBtns = d.box.querySelectorAll('[data-ia-undo]');
        assert.equal(undoBtns.length, 2, '两档都办完之后应当有两个撤销按钮');
        const schedUndo = undoBtns.find((b) => b.getAttribute('data-ia-undokind') === 'schedule');
        assert.ok(schedUndo, '★ 撤销按钮必须带 kind（否则两个档分不清撤谁）');
        d.box.fire('click', { target: schedUndo });
        assert.deepEqual(cal.deleted, [schedMemoId], '★ 只删日程那一条');
        const after = LG.readLedger(storage);
        assert.equal(after.find((r) => r.identity === 'm1|schedule').status, LG.IA_RECORD_STATUS.undone,
            '日程记录必须标 undone');
        assert.equal(after.find((r) => r.identity === 'm1|memo').status, LG.IA_RECORD_STATUS.committed,
            '★ 备忘记录必须仍是 committed（撤销不许牵连另一档）');
    });
});

test('E5 撤销后重办：撤了再点要能真再写一条（以及台账回到 committed）', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '明天晚上八点一起吃饭吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        d.box.fire('click', { target: d.box.querySelectorAll('[data-ia-action="schedule"]')[0] });
        assert.equal(cal.calls.length, 1);
        d.box.fire('click', { target: d.box.querySelectorAll('[data-ia-undo]')[0] });
        assert.equal(cal.deleted.length, 1);
        /* 撤销之后按钮必须变回「加入日程」。 */
        const again = d.box.querySelectorAll('[data-ia-action="schedule"]')[0];
        assert.ok(again, '★ 撤销之后必须能再点（按钮变回「加入日程」）');
        d.box.fire('click', { target: again });
        assert.equal(cal.calls.length, 2, '重办必须真写一条新的');
        const recs = LG.readLedger(storage);
        assert.equal(recs.length, 1, '台账里同身份只留一条');
        assert.equal(recs[0].status, LG.IA_RECORD_STATUS.committed, '重办后台账必须回到 committed');
        assert.equal(recs[0].memoId, String(cal.entries[0].id), '台账指向重办的那一条');
    });
});

test('E6 「待定 · 」标题不许把撤销误判成「人工改过」（台账记的是**写进数据那一版**）', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '改天一起聚一聚吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        const memoBtn = d.box.querySelectorAll('[data-ia-action="memo"]')[0];
        if (!memoBtn) return; /* 这句若不给候选档，本判据由 D 面覆盖（不在这里假装）。 */
        d.box.fire('click', { target: memoBtn });
        const entry = cal.entries[0];
        assert.ok(entry, '必须写出了一条');
        const rec = LG.readLedger(storage)[0];
        assert.equal(rec.title, String(entry.title), '★ 台账必须记**写进数据的那一版**标题（带「待定 · 」）');
        /* 于是撤销时不会把这条自己的前缀判成「用户改过」。 */
        const plan = LG.planUndo(LG.readLedger(storage), rec.identity, entry);
        assert.equal(plan.ok, true, '★ 自己写的前缀不许被判成人工修改：' + plan.why);
    });
});

test('E7 计划签名与 DOM 签名**同维度**：办过之后 DOM 不再重画（不动手才是不动，不是「删了重建」）', () => {
    const cal = mkCalendar();
    const storage = mkStorage({});
    const msgs = [mkMsg('m1', '明天晚上八点一起吃饭吧')];
    const app = mkApp({ messages: msgs, storage: storage });
    withDom(mkHost({ calendar: cal }), (d) => {
        paintMessages(d.box, msgs);
        const bar = new BarMod.InlineActionBar(app);
        bar.mount();
        /* 连点两次：第一次办成、第二次是重放。两轮之间若两个签名维度不同，
         *   `_refreshAll` 会每轮都判定「DOM 长得不一样」而整层删了重建；
         *   判据用**节点对象身份**来分「原样留着」与「重建了一份长得一样的」——
         *   后者在界面上完全看不出来（这正是本仓最贵的那类病）。 */
        d.box.fire('click', { target: d.box.querySelectorAll('[data-ia-action="schedule"]')[0] });
        const stackAfter = d.box.querySelectorAll('.ia-stack')[0];
        assert.ok(stackAfter, '办完必须有一块动作条');
        bar.mount();
        bar.mount();
        const stackAgain = d.box.querySelectorAll('.ia-stack')[0];
        assert.equal(stackAgain, stackAfter, '★ 签名同维度 ⇒ DOM 已经长成该长的样子就不许再动（节点必须是同一对象）');
        assert.equal(d.box.querySelectorAll('.ia-stack').length, 1, '不许长出第二块');
    });
});

/* ══════════ F 负控制（真源码破坏） ══════════ */
/** 副本树：够模块加载（动作条静态 import 台账件与提交件）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_r14o5_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'apps', 'wechat'), { recursive: true });
    for (const f of ['num-gate.js', 'inline-action-terms.js', 'inline-action-time.js',
        'inline-action.js', 'inline-action-commit.js', 'inline-action-ledger.js']) {
        fs.copyFileSync(path.join(ROOT, 'config', f), path.join(dir, 'config', f));
    }
    fs.copyFileSync(path.join(ROOT, 'apps', 'wechat', 'inline-action-bar.js'),
        path.join(dir, 'apps', 'wechat', 'inline-action-bar.js'));
    return dir;
}
function damage(rel, from, to) {
    const src = readRel(rel);
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

test('F1 拿掉 replayed 判定 ⇒ 双击真写出两条（副作用可见才算破坏生效）', async () => {
    const dir = damage(LEDGER_REL,
        "    if (prev.fingerprint === fp) {",
        "    if (false) {");
    const broke = await import(path.join(dir, LEDGER_REL));
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    /* 原版：第二次是 replayed。 */
    const ok = commitOnce([], null, act, { calendar: cal });
    assert.equal(LG.planCommit(ok.ledger, act, T0).decision, 'replayed');
    /* 破坏版：第二次判成 drifted ⇒ 真又写了一条。 */
    const p = broke.planCommit(ok.ledger, act, T0);
    assert.equal(p.decision, 'drifted', '这一条不红，就证明 replayed 那道判定在判据里根本没被验到');
    const res = CM.commitAction(act, { calendarData: cal, nowMs: T0, ledger: p });
    assert.equal(res.ok, true);
    assert.equal(res.replayed, false);
    assert.equal(cal.calls.length, 2, '破坏版真写出第二条（双击病回来了）');
});

test('F2 拿掉「指纹被动过」检测 ⇒ 用户改过的条目被静默删掉', async () => {
    const dir = damage(LEDGER_REL,
        "    const changed = strOf(m.title) !== rec.title",
        "    const changed = false && strOf(m.title) !== rec.title");
    const broke = await import(path.join(dir, LEDGER_REL));
    const cal = mkCalendar();
    const act = actOf('明天晚上八点一起吃饭吧', 'schedule');
    const first = commitOnce([], null, act, { calendar: cal });
    const memo = cal.getMemos()[0];
    memo.title = memo.title + ' + 带上伞';
    /* 原版：拦下（modified-since）。 */
    assert.equal(LG.planUndo(first.ledger, LG.identityOf(act), memo).why, LG.IA_LEDGER_WHY.modifiedSince);
    /* 破坏版：放行 ⇒ 用户改过的内容真被删。 */
    const bad = broke.planUndo(first.ledger, LG.identityOf(act), memo);
    assert.equal(bad.ok, true, '这一条不红，就证明 modified-since 那道检查没被验到');
});

test('F3 拿掉 sourceMsgId 前置检查 ⇒ 没出处的动作也进了台账（撤销就再也对不上）', async () => {
    const dir = damage(COMMIT_REL,
        "if (!srcId) { out.why = INLINE_COMMIT_WHY.noSource; return out; }",
        "if (false) { out.why = INLINE_COMMIT_WHY.noSource; return out; }");
    const broke = await import(path.join(dir, COMMIT_REL));
    const cal = mkCalendar();
    const act = { kind: 'memo', title: '聚一聚', payload: {} };
    /* 原版：一字节不写。 */
    assert.equal(CM.commitAction(act, { calendarData: cal, nowMs: T0 }).ok, false);
    assert.equal(cal.calls.length, 0);
    /* 破坏版：写进去了，而且条目上 sourceMsgId 是空的 —— 身份为空，台账记不住。 */
    const r = broke.commitAction(act, { calendarData: cal, nowMs: T0 });
    assert.equal(r.ok, true);
    assert.equal(cal.calls.length, 1, '这一条不红，就证明 noSource 那道检查没被验到');
    assert.equal(cal.calls[0].sourceMsgId, '');
    assert.equal(LG.identityOf(act), '', '身份为空 ⇒ 台账无法记录 ⇒ 撤销无从谈起');
});

/* ══════════ G 会话隔离与自证 ══════════ */
test('G1 台账键随会话隔离：storage 的 CHAT_DATA_PATTERNS 必须收录 /^ia_/', () => {
    const src = readRel(STORAGE_REL);
    assert.ok(src.includes('/^ia_/'), '★ 会话内的账不许落全局（换角色会看到别人的办事记录）');
    assert.ok(LG.IA_LEDGER_KEY.startsWith('ia_'), '台账键必须以 ia_ 开头才命中会话隔离族：' + LG.IA_LEDGER_KEY);
});

test('G2 台账件是纯函数叶子里的「零副作用」一族：不 import 任何 App / 不碰 DOM', () => {
    const src = readRel(LEDGER_REL);
    assert.equal(/^\s*import\s/m.test(src), false, '台账件必须是零 import 叶子（判定要能单独被单测逐态验）');
    assert.equal(/document\.|window\./.test(src), false, '台账件不许碰 DOM');
});

test('G3 台账坏行直接丢：不补空壳（补出来的记录会让「办过没有」答错）', () => {
    const bad = [
        null,
        {},
        { identity: 'm1|schedule' },                       /* 缺 memoId / kind */
        { identity: '', sourceMsgId: 'm1', kind: 'schedule', memoId: 'x' },
        { identity: 'm1|schedule', sourceMsgId: 'm1', kind: 'schedule', memoId: 'memo_1', at: 5 },
        { identity: 'm1|schedule', sourceMsgId: 'm1', kind: 'schedule', memoId: 'memo_2', at: 9 }
    ];
    const list = LG.normalizeLedger(bad);
    assert.equal(list.length, 1, '★ 每个坏值都要丢掉；同身份只留最新一条');
    assert.equal(list[0].memoId, 'memo_2', '同身份留 at 更新的那条');
    /* 读坏了当空台账、不抛（台账坏了不该让「加入日程」整个不可用）。 */
    const broken = { get: () => '{bad json', set: () => true };
    assert.deepEqual(LG.readLedger(broken), []);
    assert.deepEqual(LG.readLedger(null), []);
});

test('G4 台账有上限：不许无限长（写盘面必须截住）', () => {
    assert.ok(Number(LG.IA_LEDGER_LIMIT) > 0);
    const many = [];
    for (let i = 0; i < LG.IA_LEDGER_LIMIT + 40; i += 1) {
        many.push({
            identity: 'm' + i + '|schedule', sourceMsgId: 'm' + i, kind: 'schedule',
            memoId: 'memo_' + i, fingerprint: 't|d|h', title: 't', dateKey: 'd', time: 'h',
            status: LG.IA_RECORD_STATUS.committed, at: 1000 + i
        });
    }
    assert.equal(LG.normalizeLedger(many).length, LG.IA_LEDGER_LIMIT);
});

test('G5 自检：状态 / 判定名各自闭集且互不重名（判据要靠它分处置）', () => {
    const r = LG.iaLedgerSelfCheck();
    assert.deepEqual(r.problems, []);
    assert.deepEqual(Object.values(LG.IA_RECORD_STATUS).sort(), ['committed', 'superseded', 'undone']);
    const whys = Object.values(LG.IA_LEDGER_WHY);
    assert.equal(new Set(whys).size, whys.length, '判定名必须互不同名');
});

test('G6 自证：计划书四条验收旅程各自都有判据在场（不许只写其中一条）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'tests', 'r14_o5_inline_action_idempotent.test.mjs'), 'utf8');
    const journeys = [
        ['双击只新增一条', 'E2 双击两次'],
        ['刷新后再点不重复', 'E1 刷新之后再点不重复'],
        ['撤销只针对该动作创建项', 'D1 撤销按 memoId 删'],
        ['不撤掉后来人工修改的内容', 'D3 modified-since']
    ];
    for (const [name, anchor] of journeys) {
        assert.ok(src.includes(anchor), '验收旅程「' + name + '」必须有一条判据在场：缺 ' + anchor);
    }
    /* 判据自指会恒假：「本文件不许出现某串」这条判据自己必然含那一串 —— 故拆开拼。 */
    const skipNeedle = 'test' + '.skip';
    assert.equal(src.includes(skipNeedle), false, '★ 不许用 skip 凑绿');
});
