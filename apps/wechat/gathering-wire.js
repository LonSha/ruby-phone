/* ================================================================
 * apps/wechat/gathering-wire.js — [v4.124.0 · R14-X2] 群聊邀约的**接线件**
 * ----------------------------------------------------------------
 * 【本件的位置】夹在纯契约内核（`config/gathering-plan.js` + `config/gathering-store.js`）
 *   与视图之间，只做三件事：
 *     ① **取数**：把群里的邀约消息读成内核要的形状（标题 / 邀请对象 / 候选时段 / 引用）；
 *     ② **持起点**：记住「用户当前看着哪一场、点了哪个时段」——**用户显式点选**，不猜；
 *     ③ **落点形状**：把读数 + 一行读数 + 门 + 逐人清单打包给视图；
 *        并在「确认」时把要转交给日历 owner 的东西原样端出去（不写第二份判定词）。
 *
 * 【三条纪律（与 group-vote.js / archive-canon.js 同规格）】
 *   · 只读消息面：本件**不替任何人答复**——没回的人不进 replied、不算反对，
 *     也不按关系刻度推断（内核压根不读关系刻度）；
 *   · 不抛：读不到消息面 / 消息畸形 / 内核抛错，一律降级为归因读数；
 *   · 不猜：没选时段时如实报 `slot-absent`，**不默认挑第一个**
 *     （那会把「用户还没定」伪装成「已经定了」）。
 *
 * 【与 R14-X1 的关系】X1 治「会话台里逐个接触点要不要回应」，
 *   本件治「一场多人邀约里逐个**人**要不要来」。两者共用同一套分层纪律：
 *   系统读数（谁回过话）与用户决定（谁被手动标成「已确认」）**分存**，绝不合成一格。
 * ================================================================ */
'use strict';
import {
    GP_REPLIES,
    GP_REASONS,
    createGathering,
    setReply,
    reschedule,
    confirmGathering,
    cancelGathering,
    closeGathering,
    replyBoard,
    confirmGateOf,
    gatheringLine,
    gatheringStateLabel,
    replyLabel,
    gatherIdOfMessage,
} from '../../config/gathering-plan.js';
import {
    readGatherings,
    findGathering,
    saveGathering,
    dropGathering,
} from '../../config/gathering-store.js';
import { PHONE_EVENTS } from '../../config/phone-events.js';

/**
 * 群聊邀约的**两条消息标签**（AI 侧唯一入口；视图不写第二份类型字面量）。
 *   · `[邀约：周五 KTV｜甲、乙、丙｜周五晚 8 点 / 周六下午]`
 *   · `[答复：甲 来]` / `[答复：乙 不来]` / `[答复：丙 还没定]`
 */
export const GP_MESSAGE_KINDS = Object.freeze(['gathering_card', 'gathering_reply']);

/** 中文答复词 → 内核答复 id（唯一映射；视图不写第二份表）。 */
const REPLY_BY_WORD = Object.freeze({
    '来': GP_REPLIES.YES,
    '去': GP_REPLIES.YES,
    '可以': GP_REPLIES.YES,
    '说来': GP_REPLIES.YES,
    '不去': GP_REPLIES.NO,
    '不来': GP_REPLIES.NO,
    '说不来': GP_REPLIES.NO,
    '没空': GP_REPLIES.NO,
    '还没定': GP_REPLIES.MAYBE,
    '待定': GP_REPLIES.MAYBE,
    '看情况': GP_REPLIES.MAYBE,
});

/** 这一行中文答复词能不能认（认不出 ⇒ ''，不猜）。 */
export function replyIdOfWord(word) {
    return REPLY_BY_WORD[String(word == null ? '' : word).trim()] || '';
}

export class GatheringWire {
    constructor(app) {
        this.app = app;
        /** 用户当前看着哪一场（'' = 没看某一场）。 */
        this._focusId = '';
        /** 用户在表单里点了哪个时段（'' = 还没点）。 */
        this._pickedSlot = '';
        /**
         * 上一次确认的**回执**（宿主同步写进来；null = 还没派发过 / 没有接收者）。
         *   ★ [v4.124.0 · R14-X2] 与 R5-O2 群投票同规格：派发前先清空、
         *     派发后**读回执说话**，不无条件念「已转交日历」。
         */
        this._receipt = null;
    }
    /**
     * 宿主把「这份凭据收下了没有」写回这里（**同步**调用；与
     *   `chat-view.js::noteGroupVoteHandoffReceipt` 同规格）。
     *   ★ 只存读数，不改台账：草稿落没落是日历 owner 的事。
     */
    noteConfirmReceipt(read) {
        this._receipt = (read && typeof read === 'object') ? read : null;
        return this._receipt;
    }

    _data() {
        try { return this.app?.wechatData || null; } catch (_e) { return null; }
    }

    _storage() {
        try { return this.app?.storage || this.app?.phone?.storage || null; } catch (_e) { return null; }
    }

    /** 当前焦点场（没设焦点就取第一场；读不到 ⇒ null，不拟一份出来）。 */
    focused() {
        const st = this._storage();
        const id = String(this._focusId || '').trim();
        if (id) {
            const hit = findGathering(st, id);
            if (hit) return hit;
            /* 焦点场被删了 ⇒ 如实回落并清掉焦点（不留一个指向空气的焦点）。 */
            this._focusId = '';
        }
        const list = readGatherings(st);
        return list.length ? list[list.length - 1] : null;
    }

    /** 设焦点场（'' = 清掉）。 */
    setFocus(gatherId) {
        this._focusId = String(gatherId == null ? '' : gatherId).trim();
        this._pickedSlot = '';
        return this._focusId;
    }

    /** 用户点选的时段（'' = 还没点）。 */
    get pickedSlot() { return this._pickedSlot; }

    /** 设为要定的那个时段；空值即清空（**不回落成第一个**）。 */
    setPickedSlot(slotId) {
        this._pickedSlot = String(slotId == null ? '' : slotId).trim();
        return this._pickedSlot;
    }

    /**
     * 从一条**邀约卡消息**建一场（幂等：同一条消息恒得同一个 gatherId）。
     *   ★ 邀请对象与候选时段都来自消息；认不出的答复词在答复侧拒收，不在这里猜。
     * @returns {{ok,why,gathering}}
     */
    openFromMessage(msg, now) {
        const m = (msg && typeof msg === 'object') ? msg : {};
        const card = (m.gatheringCard && typeof m.gatheringCard === 'object') ? m.gatheringCard : {};
        const title = String(card.title || m.content || '').trim();
        const invitees = Array.isArray(card.invitees) ? card.invitees : [];
        const candidates = Array.isArray(card.candidates) ? card.candidates : [];
        const chatId = String(m.chatId || this.app?.currentChat?.id || '').trim();
        const res = createGathering({
            /* ★ gatherId 由「消息 id」派生：同一条邀约消息永远同一场（重复解析不建两场）。 */
            gatherId: gatherIdOfMessage(m.id, chatId, title),
            title: title,
            hostId: String(card.hostId || m.senderId || '').trim(),
            invitees: invitees.map((x) => (typeof x === 'string' ? { id: x, name: x } : x)),
            candidates: candidates,
            chatRefs: chatId ? [{ channel: 'wechat', refId: chatId, label: String(m.chatName || '').trim() }] : [],
        }, typeof now === 'number' ? now : Date.now());
        if (!res.ok) return res;
        /* 已存在（同一条消息解析过）⇒ 覆盖写会丢掉已有的答复进度。
         *   故**已存在就原样返回**，只在没有时新建 —— 这是幂等的真实含义。 */
        const st = this._storage();
        const existed = findGathering(st, res.gathering.gatherId);
        if (existed) {
            this._focusId = existed.gatherId;
            return { ok: true, why: GP_REASONS.OK, gathering: existed, existed: true };
        }
        saveGathering(st, res.gathering);
        this._focusId = res.gathering.gatherId;
        return { ok: true, why: GP_REASONS.OK, gathering: res.gathering, existed: false };
    }

    /**
     * 从一条**答复消息**记一条逐人答复。
     *   ★ 答复归属**当前焦点场**（读不到焦点 ⇒ 如实报 not-found，不乱猜一场）。
     *   ★ 人不在邀请名单 ⇒ 内核如实拒 `not-invited`（本件不改写这个判定）。
     */
    applyReplyFromMessage(msg, now) {
        const m = (msg && typeof msg === 'object') ? msg : {};
        const r = (m.gatheringReply && typeof m.gatheringReply === 'object') ? m.gatheringReply : {};
        const g = this.focused();
        if (!g) return { ok: false, why: GP_REASONS.NOT_FOUND, gathering: null };
        const memberId = String(r.memberId || r.name || m.senderId || m.senderName || '').trim();
        const reply = String(r.reply || replyIdOfWord(r.word) || '').trim().toLowerCase();
        const res = setReply(g, memberId, reply, typeof now === 'number' ? now : Date.now());
        if (res.ok) saveGathering(this._storage(), res.gathering);
        return res;
    }

    /** 记一条**用户手动**答复（origin='manual'，与消息回执分开记）。 */
    markReply(gatherId, memberId, reply, now) {
        const st = this._storage();
        const g = gatherId ? findGathering(st, gatherId) : this.focused();
        if (!g) return { ok: false, why: GP_REASONS.NOT_FOUND, gathering: null };
        const res = setReply(g, memberId, reply, typeof now === 'number' ? now : Date.now(), { manual: true });
        if (res.ok) saveGathering(st, res.gathering);
        return res;
    }

    /** 改期（旧答复降为「要复核」，已定时段作废）。 */
    changeDate(gatherId, input, now) {
        const st = this._storage();
        const g = gatherId ? findGathering(st, gatherId) : this.focused();
        if (!g) return { ok: false, why: GP_REASONS.NOT_FOUND, gathering: null, stale: [] };
        const res = reschedule(g, input, typeof now === 'number' ? now : Date.now());
        if (res.ok) saveGathering(st, res.gathering);
        return res;
    }

    /**
     * 确认时段 → **交给日历 owner**（本件零写盘建日程）。
     *   ★ 幂等键 `scheduleKey` 原样端出去：重复确认恒同键，日历侧据此不双建。
     *   ★ 派发走 `phone:gatheringConfirm`（宿主已登记），detail 带齐凭据。
     */
    confirmSlot(gatherId, slotId, now) {
        const st = this._storage();
        const g = gatherId ? findGathering(st, gatherId) : this.focused();
        if (!g) return { ok: false, why: GP_REASONS.NOT_FOUND, gathering: null, wrote: false };
        const res = confirmGathering(g, { slotId: slotId || this._pickedSlot }, typeof now === 'number' ? now : Date.now());
        if (!res.ok) return res;
        saveGathering(st, res.gathering);
        const win = (typeof window !== 'undefined') ? window : globalThis;
        try {
            /* ★ 逐人清单只算一次（下面两处都要用，重复算会有两份读数）。 */
            const board = replyBoard(res.gathering);
            const detail = {
                gatherId: res.gathering.gatherId,
                title: res.gathering.title,
                slotId: res.slot ? res.slot.id : '',
                slotLabel: res.slot ? res.slot.label : '',
                slotAt: res.slot ? res.slot.at : null,
                round: res.round,
                scheduleKey: res.scheduleKey,
                replayed: res.replayed,
                going: board.counts.going || 0,
                participants: board.rows
                    .filter((r) => r.reply === GP_REPLIES.YES)
                    .map((r) => r.name),
                chatRefs: res.gathering.chatRefs.map((c) => ({ channel: c.channel, refId: c.refId })),
            };
            /* ★ 派发前先清空回执位：上一次确认的答复不能当这一次的。
             *   宿主监听器是**同步**跑的，所以派发返回时回执已就位。 */
            this._receipt = null;
            win?.dispatchEvent?.(new win.CustomEvent(PHONE_EVENTS.GATHERING_CONFIRM, { detail: detail }));
        } catch (_e) { /* 派发失败不影响「已确认」这条读数本身 */ }
        /* 把回执原样带回给调用方（视图据此说真话；没接收者就如实说没有）。 */
        return Object.assign({}, res, { receipt: this._receipt });
    }

    /** 取消（**不删聊天**；取消后不再建日程）。 */
    cancel(gatherId, now, reason) {
        const st = this._storage();
        const g = gatherId ? findGathering(st, gatherId) : this.focused();
        if (!g) return { ok: false, why: GP_REASONS.NOT_FOUND, gathering: null };
        const res = cancelGathering(g, typeof now === 'number' ? now : Date.now(), reason);
        if (res.ok) saveGathering(st, res.gathering);
        return res;
    }
    /** 散场（活动结束回执：谁真到了）。 */
    close(gatherId, now, receipt) {
        const st = this._storage();
        const g = gatherId ? findGathering(st, gatherId) : this.focused();
        if (!g) return { ok: false, why: GP_REASONS.NOT_FOUND, gathering: null };
        const res = closeGathering(g, typeof now === 'number' ? now : Date.now(), receipt);
        if (res.ok) saveGathering(st, res.gathering);
        return res;
    }

    /** 删一场台账（**只删台账**，不碰任何聊天）。 */
    drop(gatherId) {
        return dropGathering(this._storage(), gatherId || this._focusId);
    }

    /**
     * 一次取齐（逐人清单 + 门 + 一行读数 + 状态标签）。
     *   ★ 全部判定在内核；本层只打包，**不重判任何一格**。
     */
    pack(gatherId) {
        const g = gatherId ? findGathering(this._storage(), gatherId) : this.focused();
        if (!g) {
            return {
                found: false, gathering: null, board: replyBoard(null), gate: confirmGateOf(null),
                line: '', stateLabel: '', pickedSlot: '',
            };
        }
        const board = replyBoard(g);
        return {
            found: true,
            gathering: g,
            board: board,
            gate: confirmGateOf(g),
            line: gatheringLine(g),
            stateLabel: gatheringStateLabel(g.stage),
            pickedSlot: String(this._pickedSlot || ''),
            replyLabels: {
                yes: replyLabel(GP_REPLIES.YES),
                no: replyLabel(GP_REPLIES.NO),
                maybe: replyLabel(GP_REPLIES.MAYBE),
                pending: replyLabel(GP_REPLIES.PENDING),
                stale: replyLabel(GP_REPLIES.STALE),
            },
        };
    }

    /** 全部邀约（供列表/诊断；不排序 —— 顺序由调用方按自己的口径排）。 */
    list() {
        return readGatherings(this._storage());
    }
}

/** 答复词表（诊断与判据用；视图不另写一份）。 */
export function gatheringReplyWords() {
    return Object.keys(REPLY_BY_WORD);
}

export default { GatheringWire, GP_MESSAGE_KINDS, replyIdOfWord, gatheringReplyWords };