/* ========================================================
 * config/inline-action-commit.js — [v4.113.0 · R13-X3] 把候选动作**真办掉**
 * --------------------------------------------------------
 * 【与内核的分工】`config/inline-action.js` 只认「该办什么」，一个字节都不写；
 *   本件只做「怎么办」，不认一个字。两件事分开的理由是代价不对称：
 *   认错的后果是「多出一条待办」（看得见、可撤），写错的后果是「数据没了或写歪了」（看不见）。
 *
 * 【本件只写两样东西】
 *   schedule / memo 档 ⇒ 日历备忘（`addMemo`，与本仓其它写口同一条路，不另开存储键）；
 *   reply 档 ⇒ **什么都不写**，只交回一句草稿（填进输入框，发不发由用户决定）。
 *
 * 【每条写下去的条目必须带 `sourceMsgId`】计划书原文。
 *   没有它，回执上写不出「来自与 XX 的聊天 · 10月30日 21:14」，也做不了「点回原消息」。
 *   故本件把 `sourceMsgId` 作为**提交的前置条件**：拿不到就不写，并如实报 `no-source`。
 *   这与内核「没有 id 的消息一律不办」是同一条纪律的两头。
 *
 * 【撤销走既有回收站，不新画一套】日历的 `deleteMemo` 已经把条目送进 `config/recycle-bin.js`，
 *   恢复后 id 逐字回来（R13-O8 已证明）。故本件的 undo 就是「调 deleteMemo」——
 *   再造一个「内联动作撤销栈」等于把用户学到的撤销行为分成两套。
 *
 * [v4.120.0 · R14-O5] **幂等**：`ctx.ledger` 传入 `config/inline-action-ledger.js` 的
 *   台账判定（`planCommit` 的结果）时，本件按判定分两支：
 *     · `replayed` ⇒ **一个字节都不写**，直接把旧记录原样交回（`replayed:true`）；
 *     · `drifted`  ⇒ 照常写，但回执文案必须写明「上一条已作废」——
 *       否则用户会以为日历里只有一条，而实际有两条（一条已作废、一条新的）。
 *   不传 `ctx.ledger` 时行为与 v4.113.0 **逐字一致**（旧调用方零改动）。
 *
 * 【诚实边界（必须写进书）】
 *   · memo 档的日子**还没定**：本仓没有「无日期备忘」这种容器，故本件把它落在**今天**，
 *     并在标题前加「待定 · 」。这样用户打开日历一眼能看出「这条日子没定」——
 *     不这样标注，一条日期精确的备忘会让用户以为已经约好了，那比不记更坏。
 *   · 提交成功**不保证**用户看得懂那条日程写得对不对（文案质量无人能替）。
 * ============================================================ */
'use strict';
import { INLINE_ACTION_KINDS } from './inline-action-terms.js';
import { dateKeyOf } from './inline-action-time.js';

/** 提交结果的因由闭集（逐条给人话，不抛）。 */
export const INLINE_COMMIT_WHY = Object.freeze({
    ok: 'ok',
    noSource: 'no-source',       /* 拿不到 sourceMsgId ⇒ 不写（回执也就写不出来） */
    noCalendar: 'no-calendar',   /* 日历不在（App 没起来）≠ 写成功 */
    rejected: 'rejected',        /* 数据层自已拒了（空标题 / 空日期键） */
    draftOnly: 'draft-only',     /* reply 档：只给草稿，没写盘 */
    replayed: 'replayed',        /* [v4.120.0 · R14-O5] 台账判为重放：一个字节都没写 */
    unknownKind: 'unknown-kind'
});

/** 待定档的标题前缀（**写进数据**，不是只在界面上加 —— 界面会关，数据不会）。 */
export const INLINE_PENDING_PREFIX = '待定 · ';

/**
 * 回执：写明「来自与谁、哪一刻的聊天」。
 *   拿不到的东西如实缺着（不编个日期顶上）—— 回执的全部价值就是它每一条都是真的。
 * @param {{chatName?:string, atMs?:number}} ctx
 */
export function receiptLine(ctx) {
    const c = ctx || {};
    const who = String(c.chatName == null ? '' : c.chatName).trim();
    const ms = Number(c.atMs);
    let when = '';
    if (Number.isFinite(ms) && ms > 0) {
        const d = new Date(ms);
        const p2 = (x) => String(x).padStart(2, '0');
        when = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }
    if (!who && !when) return '来自一条聊天记录（那一刻读不出来）';
    if (!who) return '来自一条聊天 · ' + when;
    if (!when) return '来自与 ' + who + ' 的聊天（时刻读不出来）';
    return '来自与 ' + who + ' 的聊天 · ' + when;
}

/**
 * 提交一个动作。
 *
 * @param {object} action 内核给的候选（`{kind, sourceMsgId, title, payload}`）
 * @param {{calendarData?:object, nowMs?:number}} ctx
 * @returns {{ok:boolean, why:string, kind:string, entryId:string, receipt:string, draft:string}}
 *   · `ok:false` 时 `why` 必非空；**不抛**（渲染路径不许因提交失败而崩）。
 */
export function commitAction(action, ctx) {
    const a = (action && typeof action === 'object') ? action : {};
    const c = ctx || {};
    const kind = String(a.kind || '');
    const out = {
        ok: false, why: INLINE_COMMIT_WHY.unknownKind, kind: kind,
        entryId: '', receipt: '', draft: '',
        /* [v4.120.0 · R14-O5] 这次是「重放」还是「新建」—— 回执文案与判据都要靠它分。 */
        replayed: false, supersededMemoId: ''
    };
    const srcId = String(a.sourceMsgId == null ? '' : a.sourceMsgId).trim();
    /* 没有出处就不办：写下去之后既回不了源、也无法在回执里交代来历。 */
    if (!srcId) { out.why = INLINE_COMMIT_WHY.noSource; return out; }

    /* [v4.120.0 · R14-O5] 台账判定为「重放」⇒ 立刻短路，**一个字节都不写**。
     *   这一步必须在 kind 分派之前：reply 档虽然不写盘，但它会把草稿填进输入框 ——
     *   双击两次等于把手打了一半的字又填一遍，同样是重复动作。
     *   旧回执原样交回（**不刷新时间戳**：回执说的是「什么时候办的」）。 */
    const led = (c.ledger && typeof c.ledger === 'object') ? c.ledger : null;
    if (led && led.decision === 'replayed' && led.record) {
        const rec = led.record;
        out.ok = true;
        out.why = INLINE_COMMIT_WHY.replayed;
        out.kind = String(rec.kind || kind);
        out.entryId = String(rec.memoId || '');
        out.replayed = true;
        out.receipt = '这条已经办过了（没有重复写第二条）—— 回执仍指向原来那一条';
        return out;
    }
    if (kind === INLINE_ACTION_KINDS.reply) {
        /* 只交草稿：**不替你发**。发消息是用户手上那一步，本项不代劳。 */
        out.ok = true;
        out.why = INLINE_COMMIT_WHY.draftOnly;
        out.draft = String((a.payload && a.payload.text) || a.title || '');
        out.receipt = '草稿已填进输入框 —— 发不发你决定';
        return out;
    }

    if (kind !== INLINE_ACTION_KINDS.schedule && kind !== INLINE_ACTION_KINDS.memo) {
        out.why = INLINE_COMMIT_WHY.unknownKind;
        return out;
    }

    const cal = c.calendarData;
    if (!cal || typeof cal.addMemo !== 'function') {
        /* 日历不在 ≠ 写成功。这一格是本项最容易糊的地方：写不进去时静默返回成功，
         *   用户会去找一条根本不存在的日程（本仓最贵的缺陷形态）。 */
        out.why = INLINE_COMMIT_WHY.noCalendar;
        return out;
    }

    const rawTitle = String(a.title == null ? '' : a.title).trim();
    if (!rawTitle) { out.why = INLINE_COMMIT_WHY.rejected; return out; }

    let dateKey = '';
    let time = '';
    let title = rawTitle;
    if (kind === INLINE_ACTION_KINDS.schedule) {
        const p = a.payload || {};
        dateKey = String(p.dateKey == null ? '' : p.dateKey).trim();
        time = String(p.time == null ? '' : p.time).trim();
        /* 算不出具体日子就不许冒充「已定」，退回待定档（**不填今天的精确日期**）。 */
        if (!dateKey) { dateKey = dateKeyOf(c.nowMs); title = INLINE_PENDING_PREFIX + rawTitle; }
    } else {
        /* memo 档：日子还没定 ⇒ 落在今天并**在数据里**标「待定」。 */
        dateKey = dateKeyOf(c.nowMs);
        title = INLINE_PENDING_PREFIX + rawTitle;
    }
    if (!dateKey) { out.why = INLINE_COMMIT_WHY.rejected; return out; }

    let memo = null;
    try {
        memo = cal.addMemo({
            dateKey: dateKey, title: title,
            time: time, type: 'daily', color: 'blue',
            source: 'inline-action', sourceMsgId: srcId
        });
    } catch (_e) { memo = null; }
    if (!memo || !memo.id) { out.why = INLINE_COMMIT_WHY.rejected; return out; }

    out.ok = true;
    out.why = INLINE_COMMIT_WHY.ok;
    out.entryId = String(memo.id);
    out.receipt = '已写进日历：' + dateKey + (time ? (' ' + time) : '') + ' · ' + title
        + ' —— ' + receiptLine({ chatName: c.chatName, atMs: c.atMs });
    /* [v4.120.0 · R14-O5] 源句 / 日期变了也照常写（用户确实改了这件事），
     *   但回执必须写明「上一条已作废」——否则用户会以为日历里只有一条，
     *   而实际上旧那条（描述已不对的那种）还在日历里（本件不替用户删数据）。 */
    if (led && led.decision === 'drifted' && led.supersede) {
        out.supersededMemoId = String(led.supersede.memoId || '');
        out.receipt += '（上一条已作废；它还在日历里，要清掉请手动删）';
    }
    return out;
}

/**
 * 撤销一次提交（走既有回收站，恢复后 id 逐字回来）。
 * @param {{ok:boolean, entryId:string}} res 提交结果
 * @param {{calendarData?:object}} ctx
 * @returns {{ok:boolean, why:string}}
 */
export function undoCommit(res, ctx) {
    const r = res || {};
    const id = String(r.entryId == null ? '' : r.entryId).trim();
    if (r.ok !== true || !id) return { ok: false, why: INLINE_COMMIT_WHY.rejected };
    const cal = (ctx || {}).calendarData;
    if (!cal || typeof cal.deleteMemo !== 'function') return { ok: false, why: INLINE_COMMIT_WHY.noCalendar };
    let done = false;
    try { done = cal.deleteMemo(id) === true; } catch (_e) { done = false; }
    return { ok: done, why: done ? INLINE_COMMIT_WHY.ok : INLINE_COMMIT_WHY.rejected };
}

