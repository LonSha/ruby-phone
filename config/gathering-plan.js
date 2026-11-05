/* ================================================================
 * config/gathering-plan.js — [v4.124.0 · R14-X2] 多人邀约：邀请 → 候选时段
 *   → 逐人答复 → 改期 → 散场回执的**纯契约内核**
 * ----------------------------------------------------------------
 * 【这一刀治的是什么（读码可复算，不是推演）】
 *   R14-X2 要求「邀请对象、候选时段、逐人答复、改期与活动结束回执」是**同一旅程**。
 *   修前全仓这一旅程在**三个地方各断一段**：
 *     · `config/group-vote-contract.js` 只回答「哪个选项票多」——
 *       它明确 `commitmentCreated` 恒假、参与名单只取**明确支持者**；
 *       于是「谁被邀请了还没回」「谁回了后来又改期」它一个字都不说；
 *     · `config/group-vote-handoff.js` 只做「投票结果 → 日历草稿」的**交接凭据**，
 *       凭据里没有「逐人答复」，也没有「改期会让旧答复失效」这一层；
 *     · `config/group-deliberation.js` 有立场与未回应问题，但那是**议题**的读法
 *       （propose/support/reserve/oppose），不是「来 / 不来 / 还没定」的**邀约**读法。
 *   后果三件都不报错：① 改期之后，上一轮说「来」的人**照样算到场**（界面看不出
 *   他的答复已过期）；② 「没被邀请的人」与「被邀请但没回」在名单里同形
 *   （处置相反：前者要补邀请，后者要催一次）；③ 取消活动时把相关聊天一并删掉
 *   —— 而验收明确要求「取消不删除相关聊天」。
 *
 * 【三条铁律（每条都对应一个具体的错法）】
 *   ① **改期让旧答复待复核，不默认全员参加**：`reschedule()` 把本轮 push 成新
 *      一轮，上一轮的 `yes` 一律降为 `stale`（具名保留，不删），`going` 清空。
 *      「上次说来」不等于「这次也来」—— 这是本件最重要的一条，也是验收旅程第一条。
 *   ② **确认才建日程，且重复确认不双建**：`confirm()` 只产出**读数**（`wrote:false`），
 *      真正落笔在日历 owner；幂等键 = `gatherId + round + slotId`，重复确认恒得同一
 *      `scheduleKey` 并报 `replayed`。取消**不改账**、**不删聊天**（`chatRefs` 只读不写）。
 *   ③ **三圈人分开数**：`invited`（被邀请的全体）/ `replied`（本轮真的回过话的）/
 *      `going`（本轮明确说来的）。没回的人**不被代答**，退出的人**不被当成没邀请**。
 *      压成一句「N 人参加」就分不清「该催谁」与「该补邀请谁」。
 *
 * 【不做（明确登记，不装）】
 *   · 不碰任何 App 存储：本件零 DOM 零存储零时钟（`now` 一律由调用方给）。
 *   · 不复制消息正文：只持 `{channel, refId}` 引用（与 comm-thread / open-ref 同源）。
 *   · 不替用户选时段：`candidates` 只做集合运算，选哪个由 `confirm(slotId)` 显式点名。
 * ================================================================ */
'use strict';
import { numOrNull } from './num-gate.js';

/* ---------- 词表（全部冻结；判据按词表逐词核，不按实现核） ---------- */
/**
 * 逐人答复四态。
 *   ★ `STALE` 单列：它是「上几轮说过话、本轮不算数」—— 与 `PENDING`（从没说过）
 *     处置相反（前者要「再问一次」，后者要「第一次问」），绝不压平。
 */
export const GP_REPLIES = Object.freeze({
    YES: 'yes',
    NO: 'no',
    MAYBE: 'maybe',
    PENDING: 'pending',
    STALE: 'stale',
});

/** 邀约六态（阶段机；`unknown` 具名，不认识的状态不猜）。 */
export const GP_STATES = Object.freeze({
    DRAFT: 'draft',
    INVITED: 'invited',
    REPLIED: 'replied',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    CLOSED: 'closed',
    UNKNOWN: 'unknown',
});

/**
 * 归因词表（why 只许取这里的值；恰十四项，判据按项数核）。
 *   ★ 单独一张表，**不并进** COMM_REASONS（那张是 R6-O2 冻结的十二项）也不并进
 *     GV_REASONS（那是投票的）—— 三张表答三个不同层的问题，合并会让历史判据变红。
 */
export const GP_REASONS = Object.freeze({
    OK: '',
    BAD_SHAPE: 'bad-shape',
    NO_TITLE: 'no-title',
    NO_ID: 'no-id',
    NO_INVITEES: 'no-invitees',
    NOT_INVITED: 'not-invited',
    REPLY_UNKNOWN: 'reply-unknown',
    SLOT_ABSENT: 'slot-absent',
    SLOT_UNKNOWN: 'slot-unknown',
    STAGE_BLOCKED: 'stage-blocked',
    ALREADY_CLOSED: 'already-closed',
    ALREADY_CANCELLED: 'already-cancelled',
    NOT_FOUND: 'not-found',
    NO_SOURCE: 'no-source',
});

/** 上限（冻结；调用方不得就地改语义）。 */
export const GP_LIMITS = Object.freeze({
    invitees: 40,
    candidates: 8,
    rounds: 8,
    repliesPerRound: 160,
    chatRefs: 12,
    /** 台账里最多留几场（超了丢最旧；与 comm-thread 的 40 段同量级）。 */
    gatherings: 40,
    title: 60,
    note: 120,
    slotLabel: 60,
});

function str(v) { return String(v == null ? '' : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
function clip(s, max) {
    const t = str(s);
    const m = Math.max(8, Number(max) || GP_LIMITS.title);
    return t.length <= m ? t : (t.slice(0, m - 1) + String.fromCharCode(8230));
}
function keyOf(s) { return clip(s, 120); }

/** 稳定短哈希（纯算术、无随机、无时钟）—— 幂等键就是它。 */
function shortHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) h = (((h * 33) ^ s.charCodeAt(i)) >>> 0);
    return h.toString(36);
}

/**
 * 由**一条邀约消息**派生场次 id（确定性：同一条消息恒得同一个 id）。
 *   ★ 为什么要派生而不是随机：同一条消息可能被读多次（重绘 / 重进会话 / 回看历史），
 *     随机 id 会让「同一场邀约」变成两场 —— 于是答复记到 A、日程建在 B。
 *   ★ 消息 id 缺席时退回「会话 + 标题」：同一会话里同名的两场会被合并，
 *     这是**已知取舍**（比随机 id 造出重复场次更可收拾），已在实现笔记登记。
 */
export function gatherIdOfMessage(messageId, chatId, title) {
    const mid = str(messageId);
    const seed = mid ? ('msg:' + str(chatId) + '#' + mid) : ('title:' + str(chatId) + '#' + str(title));
    return 'gp_' + shortHash(seed);
}

/** 这一答复算不算「本轮真的表过态」（stale/pending 都不算）。 */
function isLiveReply(r) {
    return r === GP_REPLIES.YES || r === GP_REPLIES.NO || r === GP_REPLIES.MAYBE;
}

/* ================================================================
 * 归一
 * ================================================================ */
/**
 * 归一一条聊天引用（`{channel, refId}`；正文永远留在源 App）。
 *   纯空白 id 不算引用 —— 拿一条认不出出处的引用去「回原处」会指向空气。
 */
export function normalizeChatRef(raw) {
    const r = obj(raw) || {};
    const refId = keyOf(r.refId);
    return {
        channel: clip(r.channel, 40),
        refId: refId,
        label: clip(r.label, GP_LIMITS.title),
        /** ★ 恒 false：引用不写源 App 的任何一个字节（取消活动也不删聊天）。 */
        reserved: false,
    };
}

/** 归一一个候选时段。 */
export function normalizeSlot(raw, index) {
    const r = obj(raw) || {};
    const label = clip(r.label || r.text, GP_LIMITS.slotLabel);
    const id = keyOf(r.id) || (label ? 'slot_' + shortHash(label) : '');
    if (!id) return null;
    return {
        id: id,
        label: label || id,
        /** 剧情/墙钟时刻由调用方给；读不出就是 null（不兜底成「现在」）。 */
        at: numOrNull(r.at),
        order: Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0,
    };
}

/**
 * 归一一轮答复（成员表 + 答复表）。
 *   ★ 答复**只认词表内四值**（yes/no/maybe/stale）；`pending` 由「没出现在答复表里」
 *     表达，**不许写进表内** —— 写进去就等于说「他答了 pending」，那是伪造一个回答。
 */
function normalizeRound(raw, index) {
    const r = obj(raw) || {};
    const round = Math.max(1, Math.floor(numOrNull(r.round) || (index + 1)));
    const seen = new Set();
    const replies = [];
    for (const it of arr(r.replies).slice(0, GP_LIMITS.repliesPerRound)) {
        const x = obj(it);
        if (!x) continue;
        const memberId = keyOf(x.memberId);
        if (!memberId || seen.has(memberId)) continue;
        const reply = str(x.reply).toLowerCase();
        if (!isLiveReply(reply) && reply !== GP_REPLIES.STALE) continue;
        seen.add(memberId);
        replies.push({
            memberId: memberId,
            name: clip(x.name || memberId, GP_LIMITS.title),
            reply: reply,
            at: numOrNull(x.at),
            /** 答复来源（'manual' = 用户手动记的；'' = 系统读数）。与 R14-X1 同分层。 */
            origin: str(x.origin) === 'manual' ? 'manual' : '',
        });
    }
    return {
        round: round,
        /** 这一轮的候选时段快照（改期时整轮换掉；上一轮的时段不再生效）。 */
        slotId: keyOf(r.slotId),
        replies: replies,
        at: numOrNull(r.at),
        /** 改期理由（'' = 不是改期造出来的那一轮）。 */
        reason: clip(r.reason, GP_LIMITS.note),
    };
}

/**
 * 归一一整场邀约。
 *   ★ 归一**只收敛形状**，不判任何一格结果：谁缺席、旧答复过期、能不能确认
 *     全在读函数里判（与 group-vote-contract 同一分工）。
 * @returns {object|null} 连标题都没有 ⇒ null（无从显示）
 */
export function normalizeGathering(raw) {
    const o = obj(raw);
    if (!o) return null;
    const title = clip(o.title, GP_LIMITS.title);
    if (!title) return null;
    const gatherId = keyOf(o.gatherId) || ('gp_' + shortHash(title + '#' + str(o.createdAt)));
    /* 邀请对象：去重、限量、保留原序（顺序是用户的邀请顺序，不是排序结果）。 */
    const invitees = [];
    const seenM = new Set();
    for (const it of arr(o.invitees).slice(0, GP_LIMITS.invitees)) {
        const x = obj(it);
        const memberId = x ? keyOf(x.id || x.memberId) : keyOf(it);
        if (!memberId || seenM.has(memberId)) continue;
        seenM.add(memberId);
        invitees.push({
            id: memberId,
            name: clip((x && (x.name || x.memberId)) || memberId, GP_LIMITS.title),
        });
    }
    const candidates = [];
    const seenS = new Set();
    arr(o.candidates).slice(0, GP_LIMITS.candidates).forEach((it, i) => {
        const s = normalizeSlot(it, i);
        if (!s || seenS.has(s.id)) return;
        seenS.add(s.id);
        candidates.push(s);
    });
    const rounds = [];
    const seenR = new Set();
    for (const it of arr(o.rounds).slice(-GP_LIMITS.rounds)) {
        const rd = normalizeRound(it, rounds.length);
        if (seenR.has(rd.round)) continue;
        seenR.add(rd.round);
        rounds.push(rd);
    }
    rounds.sort((a, b) => a.round - b.round);
    const chatRefs = [];
    const seenC = new Set();
    for (const it of arr(o.chatRefs).slice(0, GP_LIMITS.chatRefs)) {
        const c = normalizeChatRef(it);
        if (!c.refId || seenC.has(c.channel + '|' + c.refId)) continue;
        seenC.add(c.channel + '|' + c.refId);
        chatRefs.push(c);
    }
    const stageRaw = str(o.stage).toLowerCase();
    return {
        version: 1,
        gatherId: gatherId,
        title: title,
        hostId: keyOf(o.hostId),
        invitees: invitees,
        candidates: candidates,
        rounds: rounds,
        chatRefs: chatRefs,
        stage: Object.values(GP_STATES).indexOf(stageRaw) >= 0 ? stageRaw : GP_STATES.DRAFT,
        /** 已确认的时段（'' = 还没定）。确认是**显式点名**，不自动取第一个。 */
        pickedSlotId: keyOf(o.pickedSlotId),
        createdAt: numOrNull(o.createdAt),
        updatedAt: numOrNull(o.updatedAt),
        /** ★ 恒 null：本件不产出承诺，也不复制任何 App 正文。 */
        commitment: null,
    };
}

/** 归一一个邀约列表（坏条目**保留**并标 readable:false，不静默消失）。 */
export function normalizeGatherings(raw) {
    const list = arr(raw);
    const out = [];
    for (const it of list) {
        const n = normalizeGathering(it);
        if (n) { out.push(n); continue; }
        /* 连标题都没有 ⇒ 只剩一个 id 也要留着（「有但读不出」≠「本来没有」）。 */
        const o = obj(it);
        if (o && (o.gatherId || o.id)) {
            out.push({
                version: 1, gatherId: keyOf(o.gatherId || o.id), title: '',
                hostId: '', invitees: [], candidates: [], rounds: [], chatRefs: [],
                stage: GP_STATES.UNKNOWN, pickedSlotId: '',
                createdAt: numOrNull(o.createdAt), updatedAt: numOrNull(o.updatedAt),
                commitment: null, readable: false,
            });
        }
    }
    return out;
}

/* ================================================================
 * 阶段与答复：写操作（全部返回新对象，不改入参）
 * ================================================================ */
/**
 * 建一场邀约（`stage` 停在 `invited`：邀请已发出，一个人都还没回）。
 *   ★ 没有邀请对象 ⇒ 如实拒（一个不请谁的「多人邀约」是空壳）。
 */
export function createGathering(raw, now) {
    const o = obj(raw) || {};
    const base = normalizeGathering(Object.assign({}, o, { stage: GP_STATES.INVITED, createdAt: now }));
    if (!base) {
        return { ok: false, why: GP_REASONS.NO_TITLE, gathering: null };
    }
    if (!base.invitees.length) {
        return { ok: false, why: GP_REASONS.NO_INVITEES, gathering: null };
    }
    base.updatedAt = numOrNull(now);
    base.rounds = [normalizeRound({ round: 1, at: now }, 0)];
    return { ok: true, why: GP_REASONS.OK, gathering: base };
}

/** 内部：取最新一轮（没有就造一个空轮）。 */
function lastRoundOf(g) {
    const rounds = arr(g && g.rounds);
    return rounds.length ? rounds[rounds.length - 1] : normalizeRound({ round: 1 }, 0);
}

/**
 * 记一条逐人答复。
 *   ★ 只接受**被邀请的人**：没被邀请的人答复不算（`NOT_INVITED`）——
 *     否则「谁被邀请了」这条读数的边界会被外来答复撑破。
 *   ★ 答复落**当前轮**，不回写历史轮：历史轮是「当时怎么说的」的证据。
 */
export function setReply(gathering, memberId, reply, now, opts) {
    const g = normalizeGathering(gathering);
    if (!g) return { ok: false, why: GP_REASONS.BAD_SHAPE, gathering: null };
    if (g.stage === GP_STATES.CANCELLED) return { ok: false, why: GP_REASONS.ALREADY_CANCELLED, gathering: g };
    if (g.stage === GP_STATES.CLOSED) return { ok: false, why: GP_REASONS.ALREADY_CLOSED, gathering: g };
    const mid = keyOf(memberId);
    if (!mid) return { ok: false, why: GP_REASONS.NO_ID, gathering: g };
    if (!g.invitees.some((m) => m.id === mid)) return { ok: false, why: GP_REASONS.NOT_INVITED, gathering: g };
    const r = str(reply).toLowerCase();
    if (!isLiveReply(r)) return { ok: false, why: GP_REASONS.REPLY_UNKNOWN, gathering: g };

    const next = JSON.parse(JSON.stringify(g));
    const last = lastRoundOf(next);
    const exists = next.rounds.some((x) => x.round === last.round);
    const round = exists ? next.rounds.filter((x) => x.round === last.round)[0] : last;
    if (!exists) next.rounds.push(round);
    const o = obj(opts) || {};
    const name = (g.invitees.filter((m) => m.id === mid)[0] || {}).name || mid;
    const prev = round.replies.filter((x) => x.memberId === mid)[0];
    if (prev) {
        prev.reply = r;
        prev.at = numOrNull(now);
        if (o.manual === true) prev.origin = 'manual';
    } else {
        round.replies.push({
            memberId: mid, name: name, reply: r, at: numOrNull(now),
            origin: o.manual === true ? 'manual' : '',
        });
    }
    round.at = numOrNull(now);
    next.updatedAt = numOrNull(now);
    /* 有人回过话 ⇒ 阶段从 invited 推进到 replied（已确认/已取消的不动）。 */
    if (next.stage === GP_STATES.INVITED) next.stage = GP_STATES.REPLIED;
    return { ok: true, why: GP_REASONS.OK, gathering: next };
}

/**
 * 改期：把「旧答复」变成「待复核」，**绝不默认全员参加**。
 *   ★ 这是 R14-X2 验收旅程的第一条，也是本件存在的理由：
 *     上一轮说「来」的人，在改期之后**必须重新答复**——
 *     把旧 yes 直接搬进新一轮，等于替人答应了新时间。
 *   ★ 旧答复**原样不动**（一个字都不改写）：旧轮是「他当时说了什么」的证据。
 *     「待复核」是**读出来的**（见 `replyBoard`：本轮没答复 + 更早轮有 live 答复
 *     ⇒ `stale`），不是把历史改写成 stale 改出来的。
 *     两种做法的读数差别很实在：改写会把「第 1 轮他说来」永久抹成「他说 stale」，
 *     用户再想核对「到底谁答应过」就查不到了。
 * @returns {{ok, why, gathering, stale:Array}} `stale` = 将被要求复核的具名名单
 */
export function reschedule(gathering, input, now) {
    const g = normalizeGathering(gathering);
    if (!g) return { ok: false, why: GP_REASONS.BAD_SHAPE, gathering: null, stale: [] };
    if (g.stage === GP_STATES.CANCELLED) {
        return { ok: false, why: GP_REASONS.ALREADY_CANCELLED, gathering: g, stale: [] };
    }
    if (g.stage === GP_STATES.CLOSED) {
        return { ok: false, why: GP_REASONS.ALREADY_CLOSED, gathering: g, stale: [] };
    }
    const i = obj(input) || {};
    if (arr(g.rounds).length >= GP_LIMITS.rounds) {
        return { ok: false, why: GP_REASONS.STAGE_BLOCKED, gathering: g, stale: [] };
    }
    const next = JSON.parse(JSON.stringify(g));
    const last = lastRoundOf(next);
    /* ★ 只**读出**旧轮里答过话的人（供回执具名报「谁要复核」），不改写旧轮。 */
    const stale = [];
    const prevRound = next.rounds.filter((x) => x.round === last.round)[0] || null;
    if (prevRound) {
        for (const x of prevRound.replies) {
            if (isLiveReply(x.reply)) {
                stale.push({ memberId: x.memberId, name: x.name, was: x.reply, round: last.round });
            }
        }
    }
    /* 新一轮：候选时段可整轮换（`slots` 给了就换），答复表**空**（全 pending）。 */
    const slots = arr(i.slots);
    if (slots.length) {
        const list = [];
        const seen = new Set();
        slots.slice(0, GP_LIMITS.candidates).forEach((it, idx) => {
            const s = normalizeSlot(it, idx);
            if (!s || seen.has(s.id)) return;
            seen.add(s.id);
            list.push(s);
        });
        next.candidates = list;
    }
    const roundNo = last.round + 1;
    next.rounds.push(normalizeRound({
        round: roundNo,
        at: now,
        reason: clip(i.reason, GP_LIMITS.note),
    }, next.rounds.length));
    /* ★ 已定时段作废：改期之后「哪个时段定了」必须重新点名。 */
    next.pickedSlotId = '';
    next.stage = GP_STATES.REPLIED;
    next.updatedAt = numOrNull(now);
    return { ok: true, why: GP_REASONS.OK, gathering: next, stale: stale, round: roundNo };
}

/**
 * 确认一个时段（**只产出读数**，`wrote` 恒 false —— 落笔在日历 owner）。
 *   ★ 幂等：同一 `gatherId + round + slotId` 恒得同一个 `scheduleKey`，
 *     第二次起 `replayed: true`（重复确认不双建日程）。
 *   ★ 不替用户挑：`slotId` 必须显式给且真的存在（`SLOT_ABSENT` / `SLOT_UNKNOWN`）。
 *   ★ 取消过的**不许**再确认（取消是不可逆的账，不给「又建回来」）。
 */
export function confirmGathering(gathering, input, now) {
    const g = normalizeGathering(gathering);
    if (!g) return { ok: false, why: GP_REASONS.BAD_SHAPE, gathering: null, wrote: false, replayed: false, scheduleKey: '' };
    if (g.stage === GP_STATES.CANCELLED) {
        return { ok: false, why: GP_REASONS.ALREADY_CANCELLED, gathering: g, wrote: false, replayed: false, scheduleKey: '' };
    }
    if (g.stage === GP_STATES.CLOSED) {
        return { ok: false, why: GP_REASONS.ALREADY_CLOSED, gathering: g, wrote: false, replayed: false, scheduleKey: '' };
    }
    const i = obj(input) || {};
    const slotId = keyOf(i.slotId);
    if (!slotId) return { ok: false, why: GP_REASONS.SLOT_ABSENT, gathering: g, wrote: false, replayed: false, scheduleKey: '' };
    const slot = g.candidates.filter((s) => s.id === slotId)[0];
    if (!slot) return { ok: false, why: GP_REASONS.SLOT_UNKNOWN, gathering: g, wrote: false, replayed: false, scheduleKey: '' };
    const round = lastRoundOf(g).round;
    const scheduleKey = 'gps_' + shortHash(g.gatherId + '#' + round + '#' + slotId);
    const replayed = g.pickedSlotId === slotId && g.stage === GP_STATES.CONFIRMED;
    const next = JSON.parse(JSON.stringify(g));
    next.pickedSlotId = slotId;
    next.stage = GP_STATES.CONFIRMED;
    next.updatedAt = numOrNull(now);
    return {
        ok: true, why: GP_REASONS.OK, gathering: next, wrote: false, replayed: replayed,
        scheduleKey: scheduleKey, slot: slot, round: round,
    };
}

/**
 * 取消：**不删聊天、不改账**。
 *   ★ 验收原文「取消不删除相关聊天」—— 故 `chatRefs` 原样保留（一个字节都不动），
 *     且 `cancelled` 是终态（不再接受答复 / 改期 / 确认）。
 *   ★ 取消**不退已确认的日程**：退日程是日历 owner 的事，本件只在读数里
 *     `scheduleKey` 上标 `cancelled: true`，说清「这条日程要由谁去退」。
 */
export function cancelGathering(gathering, now, reason) {
    const g = normalizeGathering(gathering);
    if (!g) return { ok: false, why: GP_REASONS.BAD_SHAPE, gathering: null };
    if (g.stage === GP_STATES.CANCELLED) return { ok: false, why: GP_REASONS.ALREADY_CANCELLED, gathering: g };
    if (g.stage === GP_STATES.CLOSED) return { ok: false, why: GP_REASONS.ALREADY_CLOSED, gathering: g };
    const next = JSON.parse(JSON.stringify(g));
    next.stage = GP_STATES.CANCELLED;
    next.cancelReason = clip(reason, GP_LIMITS.note);
    next.updatedAt = numOrNull(now);
    /* ★ chatRefs 一字节不动（含 reserved:false）—— 取消不是删除聊天。 */
    return { ok: true, why: GP_REASONS.OK, gathering: next };
}

/**
 * 散场：活动结束回执（`closed`）。与取消**不同形**：
 *   取消 = 没办成；散场 = 办完了（要回执：谁真到了）。
 */
export function closeGathering(gathering, now, receipt) {
    const g = normalizeGathering(gathering);
    if (!g) return { ok: false, why: GP_REASONS.BAD_SHAPE, gathering: null };
    if (g.stage === GP_STATES.CANCELLED) return { ok: false, why: GP_REASONS.ALREADY_CANCELLED, gathering: g };
    if (g.stage === GP_STATES.CLOSED) return { ok: false, why: GP_REASONS.ALREADY_CLOSED, gathering: g };
    const r = obj(receipt) || {};
    const next = JSON.parse(JSON.stringify(g));
    next.stage = GP_STATES.CLOSED;
    /* 到场名单：**只收被邀请的人**（外来名字不进回执，与答复同一道边界）。 */
    const att = [];
    const seen = new Set();
    for (const it of arr(r.attended)) {
        const mid = keyOf(it);
        if (!mid || seen.has(mid)) continue;
        if (!next.invitees.some((m) => m.id === mid)) continue;
        seen.add(mid);
        att.push(mid);
    }
    next.attended = att;
    next.receiptNote = clip(r.note, GP_LIMITS.note);
    next.updatedAt = numOrNull(now);
    return { ok: true, why: GP_REASONS.OK, gathering: next };
}

/* ================================================================
 * 读数（判据都在这里；每一格都不压平）
 * ================================================================ */
/**
 * 逐人答复读数：三圈人分开数 + 每人一格。
 *
 * 【为什么必须分开】`invited` / `replied` / `going` 三圈处置相反：
 *   · `pending`（被邀请、本轮没回）→ 该**催一次**（且是第一次问）；
 *   · `stale`（上几轮说过、本轮要复核）→ 该**再确认一次**（「上次说的还算吗」）；
 *   · `going`（本轮明确说来）→ 该**备位**。
 * 把 stale 并进 pending 会让「改期」这件事实在界面上消失 —— 那正是验收第一条要防的。
 * @returns {{round:number, rows:Array, counts:object, readable:boolean, hint:string}}
 */
export function replyBoard(gathering) {
    const g = normalizeGathering(gathering);
    if (!g) {
        return {
            round: 0, rows: [], readable: false, hint: '这场的邀约形态读不出来（不是对象或缺标题）',
            counts: { invited: 0, pending: 0, yes: 0, no: 0, maybe: 0, stale: 0, going: 0, replied: 0 },
        };
    }
    const round = lastRoundOf(g);
    const byMember = new Map();
    for (const x of round.replies) byMember.set(x.memberId, x);
    /* ★ 「要复核」是**读出来的**：本轮没有答复，但**更早的轮**里答过话（live）。
     *   这样历史轮一个字都不用改写，「他第 1 轮说来」这条证据永远查得到；
     *   而本轮的读数是 `stale` —— 两件事同时成立，互不覆盖。 */
    const earlierLive = new Map();
    for (const r of arr(g.rounds)) {
        if (r.round >= round.round) continue;
        for (const x of r.replies) {
            if (isLiveReply(x.reply)) earlierLive.set(x.memberId, { reply: x.reply, round: r.round });
        }
    }
    const rows = [];
    for (const m of g.invitees) {
        const hit = byMember.get(m.id) || null;
        const old = earlierLive.get(m.id) || null;
        /* ★ 没有答复 = pending（**不写进答复表**，在这里读出来）；
         *   更早轮答过 = stale（要复核，处置与 pending 相反）。 */
        const reply = hit ? hit.reply : (old ? GP_REPLIES.STALE : GP_REPLIES.PENDING);
        rows.push({
            memberId: m.id,
            name: m.name,
            reply: reply,
            at: hit ? hit.at : null,
            origin: hit ? hit.origin : '',
            /** 更早轮他当时是怎么说的（stale 才带；其余为空串）。 */
            was: (hit || !old) ? '' : old.reply,
            wasRound: (hit || !old) ? 0 : old.round,
            /** 这一格能不能当作「本轮的表态」：pending / stale 都不能。 */
            live: isLiveReply(reply),
        });
    }
    /* 表外人（答复表里有人、邀请名单里没有）—— 具名报出，不静默丢。 */
    const invitedIds = new Set(g.invitees.map((m) => m.id));
    const foreign = round.replies.filter((x) => !invitedIds.has(x.memberId)).map((x) => x.memberId);
    const counts = {
        invited: g.invitees.length,
        pending: rows.filter((r) => r.reply === GP_REPLIES.PENDING).length,
        yes: rows.filter((r) => r.reply === GP_REPLIES.YES).length,
        no: rows.filter((r) => r.reply === GP_REPLIES.NO).length,
        maybe: rows.filter((r) => r.reply === GP_REPLIES.MAYBE).length,
        stale: rows.filter((r) => r.reply === GP_REPLIES.STALE).length,
        going: rows.filter((r) => r.reply === GP_REPLIES.YES).length,
        replied: rows.filter((r) => r.live).length,
        foreign: foreign.length,
    };
    const hint = g.invitees.length
        ? ''
        : '没有邀请对象：这场邀约没法回答「谁来」（先补名单）';
    return {
        round: round.round, rows: rows, counts: counts, readable: true, hint: hint,
        foreign: foreign,
        /** ★ 候选时段原样带出（视图不自己算「哪些时段还能选」）。 */
        candidates: g.candidates.slice(),
        pickedSlotId: g.pickedSlotId,
        stage: g.stage,
    };
}

/**
 * 这场邀约能不能确认（能不能建日程）。
 *   ★ 判据：`slotId` 存在、本轮至少有一个 live 答复、没取消没散场。
 *     「没人说来」时**不拦**（用户可能就是要给自己记一条），但 `warn` 要说清
 *     「至今没人说来」—— 拦与不拦都不是猜，是读数。
 */
export function confirmGateOf(gathering) {
    const g = normalizeGathering(gathering);
    if (!g) return { readable: false, canConfirm: false, warn: '邀约读不出来', why: GP_REASONS.BAD_SHAPE };
    if (g.stage === GP_STATES.CANCELLED) {
        return { readable: true, canConfirm: false, warn: '这场已取消（取消后不再建日程）', why: GP_REASONS.ALREADY_CANCELLED };
    }
    if (g.stage === GP_STATES.CLOSED) {
        return { readable: true, canConfirm: false, warn: '这场已散场（要再聚请新开一场）', why: GP_REASONS.ALREADY_CLOSED };
    }
    if (!g.candidates.length) {
        return { readable: true, canConfirm: false, warn: '还没有候选时段（先给几个时间让人挑）', why: GP_REASONS.SLOT_ABSENT };
    }
    const b = replyBoard(g);
    if (!b.counts.replied) {
        return {
            readable: true, canConfirm: true, why: GP_REASONS.OK,
            warn: '本轮还没有人答复：建的日程只有你自己知道（不是「大家定了」）',
        };
    }
    return { readable: true, canConfirm: true, warn: '', why: GP_REASONS.OK };
}

/** 一句话读数（'' = 没有要说的）。**唯一实现**：视图与回执都念这一句。 */
export function gatheringLine(gathering) {
    const g = normalizeGathering(gathering);
    if (!g) return '邀约:读不出来（形态不对）';
    if (g.stage === GP_STATES.CANCELLED) {
        return '邀约:' + g.title + ' —— 已取消（相关聊天保留，日程要自己去退）';
    }
    if (g.stage === GP_STATES.CLOSED) {
        const n = arr(g.attended).length;
        return '邀约:' + g.title + ' —— 已散场' + (n ? '（到场 ' + n + ' 人）' : '（没记到场人）');
    }
    const b = replyBoard(g);
    const c = b.counts;
    const parts = ['第 ' + b.round + ' 轮'];
    parts.push('邀请 ' + c.invited);
    if (c.yes) parts.push('说来 ' + c.yes);
    if (c.no) parts.push('说不来 ' + c.no);
    if (c.maybe) parts.push('还没定 ' + c.maybe);
    /* ★ stale **永远单独报**：它决定「这个时间到底定没定」。
     *   ★ 文案里不写 `**`：这一句会经 `_escapeHtml` 直接显示，星号会原样露出来。 */
    if (c.stale) parts.push('上次说过要复核 ' + c.stale);
    if (c.pending) parts.push('没回 ' + c.pending);
    if (c.foreign) parts.push('表外答复 ' + c.foreign);
    const tail = g.pickedSlotId ? '已定时段' : '还没定时段';
    return '邀约:' + g.title + ' · ' + parts.join(' · ') + ' · ' + tail;
}

/** 阶段中文标签（'' = 认不出；视图不写第二份映射）。 */
export const GP_STATE_LABEL = Object.freeze({
    draft: '草稿',
    invited: '已邀请',
    replied: '有人回了',
    confirmed: '已定时段',
    cancelled: '已取消',
    closed: '已散场',
    unknown: '状态不明',
});

/** 答复中文标签（'' = 认不出；视图不写第二份映射）。 */
export const GP_REPLY_LABEL = Object.freeze({
    yes: '说来',
    no: '说不来',
    maybe: '还没定',
    pending: '没回',
    stale: '要复核',
});

/** 阶段的中文标签。 */
export function gatheringStateLabel(state) {
    return GP_STATE_LABEL[str(state)] || '';
}

/** 答复的中文标签。 */
export function replyLabel(reply) {
    return GP_REPLY_LABEL[str(reply)] || '';
}

/* ================================================================
 * 自检（判据与体检共用；真跑一遍，不写「已检查」）
 * ================================================================ */
export function gatheringSelfCheck() {
    const problems = [];
    const now = 1761187200000;

    /* ① 建场：没标题 / 没邀请对象都必须**如实拒**。 */
    if (createGathering({ invitees: [{ id: 'a' }] }, now).why !== GP_REASONS.NO_TITLE) {
        problems.push('没标题的邀约未按 no-title 拒');
    }
    if (createGathering({ title: 'KTV' }, now).why !== GP_REASONS.NO_INVITEES) {
        problems.push('没邀请对象的邀约未按 no-invitees 拒');
    }

    const made = createGathering({
        title: '周五 KTV',
        invitees: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }],
        candidates: [{ label: '周五晚 8 点' }, { label: '周六下午' }],
        chatRefs: [{ channel: 'wechat', refId: 'chat_1', label: '周末小组' }],
    }, now);
    if (!made.ok) { problems.push('合法邀约没建出来：' + made.why); }
    const g0 = made.gathering;
    if (!g0 || g0.stage !== GP_STATES.INVITED) problems.push('新邀约阶段必须是 invited');
    /* 新建时**一个人都没回**（不是「都 pending」地被写成答复）。 */
    const b0 = replyBoard(g0);
    if (b0.counts.pending !== 3 || b0.counts.replied !== 0) {
        problems.push('新邀约应三人全 pending、零人回过（实得 pending=' + b0.counts.pending + ' replied=' + b0.counts.replied + '）');
    }

    /* ② 逐人答复：只有被邀请的人能答；坏答复拒收。 */
    const r1 = setReply(g0, 'a', GP_REPLIES.YES, now + 1000);
    const r2 = setReply(r1.gathering, 'b', GP_REPLIES.NO, now + 2000);
    if (replyBoard(r2.gathering).counts.going !== 1) problems.push('甲说来后 going 应为 1');
    if (setReply(g0, 'zzz', GP_REPLIES.YES, now).why !== GP_REASONS.NOT_INVITED) {
        problems.push('没被邀请的人答复未按 not-invited 拒');
    }
    if (setReply(g0, 'a', 'whatever', now).why !== GP_REASONS.REPLY_UNKNOWN) {
        problems.push('坏答复未按 reply-unknown 拒');
    }
    /* ★ pending 不许被写进答复表（那等于伪造一个回答）。 */
    if (setReply(g0, 'a', GP_REPLIES.PENDING, now).why !== GP_REASONS.REPLY_UNKNOWN) {
        problems.push('pending 不许作为答复写入（应由「不在答复表」表达）');
    }

    /* ③ 改期：旧 yes/no 一律降 stale，新一轮**全 pending**，已定时段作废。 */
    const cf = confirmGathering(r2.gathering, { slotId: g0.candidates[0].id }, now + 3000);
    if (!cf.ok) problems.push('确认时段失败：' + cf.why);
    if (cf.wrote !== false) problems.push('确认必须 wrote:false（落笔在日历 owner）');
    const again = confirmGathering(cf.gathering, { slotId: g0.candidates[0].id }, now + 3500);
    if (!again.replayed) problems.push('重复确认必须报 replayed（不双建）');
    if (again.scheduleKey !== cf.scheduleKey) problems.push('同一场同一轮同一时段必须恒得同一个 scheduleKey');

    const rs = reschedule(cf.gathering, { reason: '甲临时有事' }, now + 4000);
    if (!rs.ok) problems.push('改期失败：' + rs.why);
    if (rs.stale.length !== 2) problems.push('改期后应有两个旧答复降 stale（实得 ' + rs.stale.length + '）');
    if (rs.gathering.pickedSlotId !== '') problems.push('改期后已定时段必须作废');
    const b1 = replyBoard(rs.gathering);
    if (b1.round !== 2) problems.push('改期必须推进到第 2 轮（实得 ' + b1.round + '）');
    if (b1.counts.stale !== 2) problems.push('旧答复应留在**旧轮**并降 stale（实得 stale=' + b1.counts.stale + '）');
    if (b1.counts.going !== 0) problems.push('★ 改期后**不许默认全员参加**（going 必须归零）');
    /* ★ 三圈人本轮的正确读法（不是「三人全 pending」——那是把 stale 压平进 pending）：
     *   甲（说过 yes）/ 乙（说过 no）⇒ stale（要复核）；
     *   丙（从头没说过话）⇒ pending（第一次问）。
     *   两者处置相反，故必须分开数：pending=1、stale=2、going=0。 */
    if (b1.counts.pending !== 1) problems.push('改期后只有**没说过话的人**才是 pending（实得 ' + b1.counts.pending + '）');
    if (b1.counts.replied !== 0) problems.push('改期后本轮应零人回过（stale 不算回过）');
    /* stale 的「当时怎么说的」必须带得出来（否则用户不知道要复核什么）。 */
    const staleA = b1.rows.filter((r) => r.memberId === 'a')[0];
    if (!staleA || staleA.was !== GP_REPLIES.YES || staleA.wasRound !== 1) {
        problems.push('stale 行必须带出「他当时怎么说的、哪一轮说的」');
    }
    /* 旧轮的历史答复**一个字都不许改写**（证据要能回看「他当时说来」）。 */
    const oldRound = rs.gathering.rounds.filter((x) => x.round === 1)[0];
    if (!oldRound) {
        problems.push('改期把第 1 轮整轮弄丢了（历史轮必须保留）');
    } else {
        const a = oldRound.replies.filter((x) => x.memberId === 'a')[0];
        if (!a || a.reply !== GP_REPLIES.YES) {
            problems.push('★ 改期不许改写旧轮答复（第 1 轮甲说来这条证据必须原样留着）');
        }
    }

    /* ④ 取消：不删聊天、终态、不许再确认。 */
    const cc = cancelGathering(r2.gathering, now + 5000, '不聚了');
    if (!cc.ok) problems.push('取消失败：' + cc.why);
    if (arr(cc.gathering.chatRefs).length !== 1) problems.push('★ 取消不许删除相关聊天（chatRefs 必须原样保留）');
    if (cc.gathering.chatRefs[0].refId !== 'chat_1') problems.push('取消后聊天引用被改动了');
    if (cc.gathering.stage !== GP_STATES.CANCELLED) problems.push('取消后阶段必须是 cancelled');
    if (confirmGathering(cc.gathering, { slotId: g0.candidates[0].id }, now).why !== GP_REASONS.ALREADY_CANCELLED) {
        problems.push('取消后仍能确认时段（必须拒）');
    }
    if (reschedule(cc.gathering, {}, now).why !== GP_REASONS.ALREADY_CANCELLED) {
        problems.push('取消后仍能改期（必须拒）');
    }

    /* ⑤ 散场回执：到场名单只收被邀请的人。 */
    const cl = closeGathering(r2.gathering, now + 6000, { attended: ['a', 'zzz'], note: '甲到了' });
    if (!cl.ok) problems.push('散场失败：' + cl.why);
    if (arr(cl.gathering.attended).length !== 1) problems.push('散场到场名单必须只收被邀请的人（外来名字不进回执）');
    if (cl.gathering.stage !== GP_STATES.CLOSED) problems.push('散场后阶段必须是 closed');

    /* ⑥ 读数互不同形（任意两态写成同一句就是「读数在撒谎」）。 */
    const lines = [
        gatheringLine(g0),
        gatheringLine(r2.gathering),
        gatheringLine(cf.gathering),
        gatheringLine(rs.gathering),
        gatheringLine(cc.gathering),
        gatheringLine(cl.gathering),
        gatheringLine(null),
    ];
    if (lines.some((s) => !String(s || '').length)) problems.push('六态里有一态没有读数');
    if (lines[4].indexOf('已取消') < 0) problems.push('取消读数必须明说已取消');
    if (lines[5].indexOf('已散场') < 0) problems.push('散场读数必须明说已散场');
    if (lines[3].indexOf('要复核') < 0) problems.push('改期读数必须明说要复核（不许与其它态同形）');
    if (lines[0] === lines[1]) problems.push('没人回与有人回读数不可同形');

    /* ⑦ 纯函数：归一不改入参。 */
    const rawIn = { title: 'x', invitees: [{ id: 'a' }, { id: 'a' }] };
    const before = JSON.stringify(rawIn);
    normalizeGathering(rawIn);
    if (JSON.stringify(rawIn) !== before) problems.push('归一改了入参（纯函数被破坏）');

    /* ⑧ 坏形态：连标题都没有 ⇒ null；有 id 没标题 ⇒ 保留并 readable:false。 */
    if (normalizeGathering({}) !== null) problems.push('空对象应归一为 null');
    const list = normalizeGatherings([{}, { gatherId: 'g_half' }]);
    if (list.length !== 1 || list[0].readable !== false) {
        problems.push('有 id 没标题的条目必须保留并标 readable:false（不许静默消失）');
    }

    return {
        ok: problems.length === 0,
        problems: problems,
        states: Object.keys(GP_STATES).length,
        reasons: Object.keys(GP_REASONS).length,
        replies: Object.keys(GP_REPLIES).length,
    };
}

export default {
    GP_REPLIES, GP_STATES, GP_REASONS, GP_LIMITS, GP_STATE_LABEL, GP_REPLY_LABEL,
    normalizeChatRef, normalizeSlot, normalizeGathering, normalizeGatherings,
    gatherIdOfMessage,
    createGathering, setReply, reschedule, confirmGathering, cancelGathering, closeGathering,
    replyBoard, confirmGateOf, gatheringLine, gatheringStateLabel, replyLabel,
    gatheringSelfCheck,
};
