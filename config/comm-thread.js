/* ========================================================
 * comm-thread.js — [v4.49.0 · 第六期 R6-O2] 连续通信内核（「一段交流」）
 * --------------------------------------------------------
 * 【本件是什么】把**消息 / 来电 / 漏接 / 短信**归成同一段交流。R6-O1（事务台）回答
 *   「这件事进行到哪」；本件回答「我们这一段聊到哪了、中间断在哪」。
 *
 * 【为什么必须是新落点（读码可复算，不是推演）】本仓三处痕迹各答一个不同的问题，
 *   没有一处答得了「这是一段交流」：
 *     · apps/wechat 的会话（getChatList）只有「最后一条消息 + 时间」，**没有段**：
 *       三年前的寒暄和昨天的事故在同一个会话里同形；
 *     · config/phone-chat-memory.js（v2.9.0）是**滚动摘要**（300 字压平），
 *       摘要只给「关系长期状态」，答不了「这次为什么断了」；
 *     · config/contact-insight.js（v3.15.0）只统计**频率与最近时间**（谁很久没联系），
 *       它明确只读、不下「段」的判定，且它把漏接归到 unattributedCalls（同名歧义面）。
 *   后果三件都不报错：① 漏接来电在本仓**不进入任何交流读数** ——「没接到的电话」
 *   在界面上与「没发生过」同形（处置完全相反：前者要回拨，后者不用）；② 「看了没回」
 *   与「根本没看」同形（都只是一个红点或者都没红点），而处置相反（前者是待办，
 *   后者是角标）；③ 断了很多天之后又聊上，界面读成「一直没联系过」而实际是
 *   「中间断过、这是续谈」—— 续谈与初识的关系进展读法**完全不同**。
 *
 * 【三条不能松的机制】
 *   ① **漏接不是「没发生」**（KINDS.MISSED 单列，summary 里单独报，绝不并进消息数）；
 *   ② **未读与未回分列**（COMM_ATTENTION 两态 + SETTLED；markPointSeen 与
 *      markPointAnswered 是两个动作，读一次不能顺手把「回过了」也算上）；
 *   ③ **误合比漏合更伤**：新接触点静默超过 COMM_LIMITS.gapHours **一律开新段**
 *      （GAP_TOO_LONG），绝不顺着时间线硬续成一段 —— 合错了用户看到的是**假的
 *      关系进展**，而多出一段用户自己会合。这是本件唯一一处「宁可保守」的判据。
 *
 * 【本件的诚实面：坏形态不许静默消失】normalizeThread 对形态坏但**有身份**的条目
 *   **保留**并标 `readable:false`（进 COMM_STATES.UNREADABLE），只有连 id 与
 *   participant 都没有的条目才丢弃（无从显示）。「本来没有这段」与「有但读不出来」
 *   在界面上同形、处置相反（前者该开新段，后者该修存储）—— 故四态**不压平**。
 *
 * 【只持引用不持正文（与 R6-O1 / open-ref 同源铁律）】接触点只存
 *   `{ channel, refId, kind, at, direction, seen, answered, label }`：
 *   `label` 是**读数**（一句话摘要），正文永远留在 wechat / phone 各自的存储里。
 *   本件**不摸任何 App 存储**，读写只经注入的 storage 句柄上的那一个键。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';

/* ---------- 词表（全部冻结；判据按词表核，不按实现核） ---------- */
/** 接触点四类。★ MISSED 单列：漏接来电不是「没发生」，也不是「一条消息」。 */
export const COMM_KINDS = Object.freeze({
    MESSAGE: 'message',
    CALL: 'call',
    MISSED: 'missed',
    SMS: 'sms',
});
/** 来源面三格（与痕迹所有者一一对应，落点回查用）。 */
export const COMM_CHANNELS = Object.freeze({
    WECHAT: 'wechat',
    CALL: 'phone-call',
    SMS: 'phone-sms',
});
/** 一段交流的四态（absent 与 unreadable 分列，刻意不压平）。 */
export const COMM_STATES = Object.freeze({
    ABSENT: 'absent',
    UNREADABLE: 'unreadable',
    OPEN: 'open',
    CLOSED: 'closed',
});
/** 注意面三态（与开合面**正交**：安静了的那段也可能留着未回）。 */
export const COMM_ATTENTION = Object.freeze({
    SETTLED: 'settled',
    UNREAD: 'unread',
    UNANSWERED: 'unanswered',
});
/** 归因词表（why 只许取这里的值）。 */
export const COMM_REASONS = Object.freeze({
    OK: '',
    BAD_SHAPE: 'bad-shape',
    NO_PARTICIPANT: 'no-participant',
    NO_ID: 'no-id',
    KIND_UNKNOWN: 'kind-unknown',
    CHANNEL_UNKNOWN: 'channel-unknown',
    ALREADY_CLOSED: 'already-closed',
    NOT_FOUND: 'not-found',
    NO_SOURCE: 'no-source',
    DUP_POINT: 'dup-point',
    OUT_OF_ORDER: 'out-of-order',
    GAP_TOO_LONG: 'gap-too-long',
});
/** 上限八项（防无限增长；语义与 te_ledger / affairs 同族）。 */
export const COMM_LIMITS = Object.freeze({
    threads: 40,
    points: 80,
    participants: 8,
    label: 40,
    note: 200,
    gapHours: 12,
    idleHours: 72,
    unreadCap: 99,
});

/* ---------- 基础归一（与 open-ref / affair-state 同口径：纯空白不算 id） ---------- */
function str(v) { return String(v == null ? '' : v).trim(); }
function capStr(v, n) {
    const s = str(v);
    return s.length > n ? s.slice(0, n) : s;
}
function strList(v, cap) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const item of v) {
        const s = str(item);
        if (s && out.indexOf(s) < 0) out.push(s);
        if (out.length >= cap) break;
    }
    return out;
}
function hasKind(k) { return Object.values(COMM_KINDS).indexOf(str(k)) >= 0; }
function hasChannel(c) { return Object.values(COMM_CHANNELS).indexOf(str(c)) >= 0; }

/**
 * 归一一个接触点。
 * ★ NO_SOURCE 的口径：channel + refId **双键齐备**才算有源（能回查）。
 *   只有 channel 没有 refId 的点回查不到任何东西 —— 收下它等于挂了一个假引用。
 * ★ 畸形输入不抛、不补，一律产出 `readable:false` 的空壳（由上层计数上报）。
 */
export function normalizePoint(raw) {
    const p = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const kind = str(p.kind);
    const channel = str(p.channel);
    const refId = str(p.refId);
    const at = numOrNull(p.at);
    /* ★ 判定必须看**原始值**（*Raw 优先），不许看兜底后的值：
     *   否则归一不幂等 —— 首次归一已把不认识的 kind 兜底成 message，
     *   二次归一就会拿 message 去判「认识」，把 readable:false 洗成 true，
     *   于是「有但读不出来」的段读两遍就变成「好好的一段」（本版判据 B5 抓到的真缺陷）。
     *   归一的产物必须能被归一自己再吃一遍而结论不变。 */
    const kindRaw = str(p.kindRaw) || kind;
    const channelRaw = str(p.channelRaw) || channel;
    const readable = hasKind(kindRaw) && hasChannel(channelRaw) && !!refId && at !== null;
    return {
        id: str(p.id) || (channel && refId ? channel + ':' + refId : ''),
        kind: hasKind(kindRaw) ? kindRaw : COMM_KINDS.MESSAGE,
        kindRaw: kindRaw,
        channel: hasChannel(channelRaw) ? channelRaw : COMM_CHANNELS.WECHAT,
        channelRaw: channelRaw,
        refId: refId,
        direction: (str(p.direction) === 'incoming') ? 'incoming' : 'outgoing',
        at: at,
        seen: p.seen === true,
        answered: p.answered === true,
        label: capStr(p.label, COMM_LIMITS.note),
        readable: readable,
    };
}
/** 判两个点是不是**同一个源**（channel+refId 双键；label/at 是读数不是身份）。 */
export function samePointSource(a, b) {
    return str(a && a.channel) === str(b && b.channel) && str(a && a.refId) === str(b && b.refId);
}
function normalizePoints(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw.slice(0, COMM_LIMITS.points)) out.push(normalizePoint(item));
    return out;
}
/**
 * 归一一段交流。
 * ★ 有 id 或 participant 的**一律保留**（哪怕形态坏）—— 只把它标成 readable:false。
 *   连身份都没有的条目才丢弃：那种条目在界面上无从显示，留着只会占位置。
 */
export function normalizeThread(raw) {
    const t = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const id = str(t.id);
    const participant = capStr(t.participant, COMM_LIMITS.label);
    const base = {
        id: id,
        participant: participant,
        participants: strList(t.participants, COMM_LIMITS.participants),
        points: normalizePoints(t.points),
        openedAt: numOrNull(t.openedAt),
        lastAt: numOrNull(t.lastAt),
        closedAt: numOrNull(t.closedAt),
        closeReason: capStr(t.closeReason, COMM_LIMITS.note),
        note: capStr(t.note, COMM_LIMITS.note),
        readable: true,
        droppedPoints: 0,
    };
    if (!id && !participant) return null;
    if (!Array.isArray(t.points) || (Array.isArray(t.points) && t.points.length && base.points.length < t.points.length)) {
        base.readable = false;
    }
    base.droppedPoints = base.points.filter(function (p) { return p.readable === false; }).length;
    if (base.droppedPoints > 0) base.readable = false;
    /* ★ 不可读要**粘住**（幂等）：归一产物再被归一一次，结论必须还是不可读。
     *   段级坏形态（points 不是数组）在第一次归一里被判 readable:false，但那时 points 已
     *   兜底成 []，二次归一看见的是「一个正常的空数组」—— 不粘住就会把坏段读成好段。
     *   要真正修好，只能由写回路径显式置 readable:true（见 appendPoint），不许靠「再读一遍」。 */
    if (t.readable === false) base.readable = false;
    if (base.participants.indexOf(base.participant) < 0 && base.participant) {
        base.participants = [base.participant].concat(base.participants).slice(0, COMM_LIMITS.participants);
    }
    return base;
}
/** 归一列表（保留顺序；坏形态见 normalizeThread 的口径）。 */
export function normalizeThreads(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw.slice(0, COMM_LIMITS.threads)) {
        const t = normalizeThread(item);
        if (t) out.push(t);
    }
    return out;
}

/* ---------- 判定层（每步统一返回 {ok, why, thread, list}） ---------- */
/**
 * 按 id 找段 —— **返回原数组里的那一条（保持引用身份）**。
 * ★ 这里踩过一个真坑（v4.49.0 判据抓到的，本仓同族最贵的一类）：
 *   首版写成 `normalizeThreads(list)` 里找，返回的是**归一副本**；
 *   而写入点随后用 `arr.indexOf(t)` 找下标 —— 副本在数组里当然找不到，
 *   `indexOf` 返回 -1，于是 `next[-1] = updated`：
 *   **数组被挂在 -1 号属性上，原位置纹丝不动 ⇒ 挂点静默丢失**（不报错、只丢数据）。
 *   修法不是「加个兜底」，而是**读侧与写侧共用同一份真数组**（同 E6 那条判据纪律）。
 * ★ 坏形态的段**也找得到**（否则用户看到「没有这段」而实际是「读不出来」）。
 * 读字段请一律经 normalizeThread（形态兜底），本函数只负责**定位**。
 */
export function findThread(list, id) {
    const want = str(id);
    if (!want) return null;
    const arr = Array.isArray(list) ? list : [];
    for (const t of arr) {
        if (t && typeof t === 'object' && !Array.isArray(t) && str(t.id) === want) return t;
    }
    return null;
}
/** 段在真数组里的下标（-1 表示不在）；配合 findThread 保证写回落在原位置。 */
function indexOfThread(list, id) {
    const want = str(id);
    if (!want) return -1;
    const arr = Array.isArray(list) ? list : [];
    for (let i = 0; i < arr.length; i += 1) {
        const t = arr[i];
        if (t && typeof t === 'object' && !Array.isArray(t) && str(t.id) === want) return i;
    }
    return -1;
}
/** 定位 + 归一读取（写方法统一走这两步：raw 保身份、cur 保形态）。 */
function locate(list, id) {
    const raw = findThread(list, id);
    if (!raw) return null;
    return { raw: raw, cur: normalizeThread(raw), idx: indexOfThread(list, id) };
}
/**
 * 按参与者找**当前进行中**的段。
 * ★ 同名异人的历史在，故这里只按 participant 精确匹配（不做模糊、不跨人合并）；
 *   且只返回最后一段未收束的 —— 调用方据此判断「该续还是该开新段」。
 */
export function findOpenThreadOf(list, participant) {
    const want = str(participant);
    if (!want) return null;
    const arr = normalizeThreads(list);
    let hit = null;
    for (const t of arr) {
        if (t.participant !== want) continue;
        if (t.closedAt) continue;
        if (!hit || (t.lastAt || 0) >= (hit.lastAt || 0)) hit = t;
    }
    return hit;
}
/** 开一段新交流（只认「人 + 时间」；id 由 now + 随机片生成，和 affairs 同款）。 */
export function openThread(list, participant, now, note) {
    const who = capStr(participant, COMM_LIMITS.label);
    if (!who) return { ok: false, why: COMM_REASONS.NO_PARTICIPANT, thread: null, list: list || [] };
    const at = numOrNull(now);
    const arr = Array.isArray(list) ? list : [];
    if (arr.length >= COMM_LIMITS.threads) {
        const t = normalizeThread({
            id: 't' + String(at == null ? 0 : at) + '_' + Math.random().toString(36).slice(2, 8),
            participant: who, note: note, openedAt: at, lastAt: at,
        });
        return { ok: false, why: COMM_REASONS.BAD_SHAPE, thread: t, list: arr };
    }
    const t = normalizeThread({
        id: 'c' + String(at == null ? 0 : at) + '_' + Math.random().toString(36).slice(2, 8),
        participant: who,
        participants: [who],
        points: [],
        openedAt: at,
        lastAt: at,
        note: note,
    });
    return { ok: true, why: COMM_REASONS.OK, thread: t, list: arr.concat([t]) };
}
/**
 * 挂一个接触点。
 * 判定顺序（**改序即改结论**，判据按住）：
 *   缺段 → 形态 → 已收束 → 乱序 → 间隔超窗 → 重复源。
 *   为什么「已收束」排在「间隔」之前：段一旦显式收束，之后任何点都该开新段
 *   （用户手动合上的事不该被下一句「在吗」悄悄拉开）。
 */
export function appendPoint(list, threadId, point, now) {
    const arr = Array.isArray(list) ? list : [];
    const loc = locate(arr, threadId);
    if (!loc || loc.idx < 0) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const t = loc.cur;
    const idx = loc.idx;
    if (!t) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const p = normalizePoint(point);
    if (!p.refId || !p.id) return { ok: false, why: COMM_REASONS.NO_SOURCE, thread: t, list: arr };
    if (!p.readable) {
        const why = !hasKind(p.kindRaw) ? COMM_REASONS.KIND_UNKNOWN
            : (!hasChannel(p.channelRaw) ? COMM_REASONS.CHANNEL_UNKNOWN : COMM_REASONS.BAD_SHAPE);
        return { ok: false, why: why, thread: t, list: arr };
    }
    if (t.closedAt) return { ok: false, why: COMM_REASONS.ALREADY_CLOSED, thread: t, list: arr };
    const last = t.points.length ? t.points[t.points.length - 1] : null;
    if (last && p.at !== null && last.at !== null && p.at < last.at) {
        return { ok: false, why: COMM_REASONS.OUT_OF_ORDER, thread: t, list: arr };
    }
    if (last && p.at !== null && last.at !== null) {
        const gapMs = COMM_LIMITS.gapHours * 3600 * 1000;
        if (p.at - last.at > gapMs) {
            return { ok: false, why: COMM_REASONS.GAP_TOO_LONG, thread: t, list: arr };
        }
    }
    if (t.points.some(function (x) { return samePointSource(x, p); })) {
        return { ok: false, why: COMM_REASONS.DUP_POINT, thread: t, list: arr };
    }
    const points = t.points.concat([p]).slice(-COMM_LIMITS.points);
    const at = numOrNull(now);
    const updated = Object.assign({}, loc.raw, {
        points: points,
        lastAt: p.at !== null ? p.at : (t.lastAt || at),
        readable: true,
    });
    if (!t.openedAt) updated.openedAt = p.at;
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: COMM_REASONS.OK, thread: updated, list: next };
}
/** 收束一段（显式动作；closeReason 写清为什么合上 —— 空白不写会读回「不知道为啥断了」）。 */
export function closeThread(list, threadId, reason, now) {
    const arr = Array.isArray(list) ? list : [];
    const loc = locate(arr, threadId);
    if (!loc || loc.idx < 0) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const t = loc.cur;
    const idx = loc.idx;
    if (!t) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    if (t.closedAt) return { ok: false, why: COMM_REASONS.ALREADY_CLOSED, thread: t, list: arr };
    const at = numOrNull(now);
    const updated = Object.assign({}, loc.raw, { closedAt: at, closeReason: capStr(reason, COMM_LIMITS.note) });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: COMM_REASONS.OK, thread: updated, list: next };
}
/** 加参与者（去重；主角之外的人进 participants，participant 仍是这段的对话方）。 */
export function addThreadParticipants(list, threadId, names) {
    const arr = Array.isArray(list) ? list : [];
    const loc = locate(arr, threadId);
    if (!loc || loc.idx < 0) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const t = loc.cur;
    const idx = loc.idx;
    if (!t) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const add = strList(names, COMM_LIMITS.participants);
    if (!add.length) return { ok: false, why: COMM_REASONS.BAD_SHAPE, thread: t, list: arr };
    const merged = t.participants.concat(add)
        .filter(function (v, i, s) { return s.indexOf(v) === i; })
        .slice(0, COMM_LIMITS.participants);
    const next = arr.slice();
    next[idx] = Object.assign({}, loc.raw, { participants: merged });
    return { ok: true, why: COMM_REASONS.OK, thread: next[idx], list: next };
}
/**
 * 一个接触点标记「读过」。★ 只清 unread，**不动** answered ——
 *   「看了」与「回了」是两件事，顺手把 answered 也算上是本仓最典型的假读数。
 */
function markPoint(list, threadId, pointId, field) {
    const arr = Array.isArray(list) ? list : [];
    const loc = locate(arr, threadId);
    if (!loc || loc.idx < 0) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const t = loc.cur;
    const idx = loc.idx;
    if (!t) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: null, list: arr };
    const want = str(pointId);
    let hit = false;
    const points = t.points.map(function (p) {
        if (p.id !== want) return p;
        hit = true;
        const patch = {};
        patch[field] = true;
        return Object.assign({}, p, patch);
    });
    if (!hit) return { ok: false, why: COMM_REASONS.NOT_FOUND, thread: t, list: arr };
    const next = arr.slice();
    next[idx] = Object.assign({}, loc.raw, { points: points });
    return { ok: true, why: COMM_REASONS.OK, thread: next[idx], list: next };
}
/** 标记读过（清 unread）。 */
export function markPointSeen(list, threadId, pointId) {
    return markPoint(list, threadId, pointId, 'seen');
}
/** 标记回过（清 unanswered）。 */
export function markPointAnswered(list, threadId, pointId) {
    return markPoint(list, threadId, pointId, 'answered');
}
/**
 * 续谈判定：新接触点该**续**旧段还是**开**新段。
 * ★ 这是本件唯一一处「宁可保守」：只有「同一人 + 有未收束段 + 静默在窗口内」才续；
 *   否则一律开新段（并如实给出 why）。理由写在上面的档头：误合比漏合更伤。
 */
export function planPoint(list, participant, at) {
    const who = capStr(participant, COMM_LIMITS.label);
    if (!who) return { action: 'refuse', why: COMM_REASONS.NO_PARTICIPANT, thread: null };
    const t = findOpenThreadOf(list, who);
    if (!t) return { action: 'open', why: COMM_REASONS.NOT_FOUND, thread: null };
    const n = numOrNull(at);
    if (n !== null && t.lastAt !== null && (n - t.lastAt) > COMM_LIMITS.gapHours * 3600 * 1000) {
        return { action: 'open', why: COMM_REASONS.GAP_TOO_LONG, thread: t };
    }
    if (n !== null && t.lastAt !== null && n < t.lastAt) {
        return { action: 'open', why: COMM_REASONS.OUT_OF_ORDER, thread: t };
    }
    return { action: 'resume', why: COMM_REASONS.OK, thread: t };
}

/* ---------- 投影层 ---------- */
function normNow(now) {
    const n = numOrNull(now);
    return n === null ? Date.now() : n;
}
/**
 * 一段交流的读数态（四格）。
 *   · 连身份都读不出 → ABSENT（本来没有这段）
 *   · 有身份但形态坏 → UNREADABLE（有但读不出来；处置相反，故分列）
 *   · 有 closedAt → CLOSED（收束是唯一终结）
 *   · 否则 → OPEN（安静了也是 OPEN，安静不是结束）
 */
export function threadStateOf(thread) {
    const t = normalizeThread(thread);
    if (!t) return COMM_STATES.ABSENT;
    if (t.readable === false) return COMM_STATES.UNREADABLE;
    if (t.closedAt) return COMM_STATES.CLOSED;
    return COMM_STATES.OPEN;
}
/** 注意面三态（unread 优先于 unanswered：没看的比看了没回的更急着处理）。 */
export function attentionOf(thread) {
    const t = normalizeThread(thread);
    if (!t) return COMM_ATTENTION.SETTLED;
    const incoming = t.points.filter(function (p) { return p.direction === 'incoming' && p.kind !== COMM_KINDS.MISSED; });
    const unread = incoming.filter(function (p) { return p.seen !== true; });
    if (unread.length) return COMM_ATTENTION.UNREAD;
    const unanswered = incoming.filter(function (p) { return p.answered !== true; });
    if (unanswered.length) return COMM_ATTENTION.UNANSWERED;
    return COMM_ATTENTION.SETTLED;
}
/** 计数投影（供读数句与材料共用一处，避免第二份口径）。 */
export function threadCounts(thread) {
    const t = normalizeThread(thread);
    if (!t) return { messages: 0, calls: 0, missed: 0, sms: 0, unread: 0, unanswered: 0, points: 0, dropped: 0 };
    const count = function (k) { return t.points.filter(function (p) { return p.kind === k; }).length; };
    const incoming = t.points.filter(function (p) { return p.direction === 'incoming' && p.kind !== COMM_KINDS.MISSED; });
    return {
        messages: count(COMM_KINDS.MESSAGE),
        calls: count(COMM_KINDS.CALL),
        missed: count(COMM_KINDS.MISSED),
        sms: count(COMM_KINDS.SMS),
        unread: incoming.filter(function (p) { return p.seen !== true; }).length,
        unanswered: incoming.filter(function (p) { return p.seen === true && p.answered !== true; }).length,
        points: t.points.length,
        dropped: t.droppedPoints,
    };
}
/**
 * 「错过与续谈」投影（本件标题里那一格的真机制）。
 *   `missed`：漏接次数；`resumedAfterMissed`：漏接之后是否又接上了
 *   （后续出现 call / message / sms 任一，即算续上）。
 *   ★ 这两个数**必须分开给**：漏接 3 次之后聊上了，与漏接 3 次至今没接上，
 *     关系读数完全不同 —— 合成一个「最近接触」就把它抹平了。
 */
export function resumeOf(thread) {
    const t = normalizeThread(thread);
    if (!t) return { missed: 0, lastMissedAt: null, resumedAfterMissed: false, endedOnMissed: false };
    let lastMissedAt = null;
    let lastAnyAt = null;
    let lastMissedIdx = -1;
    t.points.forEach(function (p, i) {
        if (p.at !== null) lastAnyAt = p.at;
        if (p.kind === COMM_KINDS.MISSED) {
            if (p.at !== null) lastMissedAt = p.at;
            lastMissedIdx = i;
        }
    });
    return {
        missed: t.points.filter(function (p) { return p.kind === COMM_KINDS.MISSED; }).length,
        lastMissedAt: lastMissedAt,
        resumedAfterMissed: lastMissedIdx >= 0 && t.points.slice(lastMissedIdx + 1).length > 0,
        /* 最后一次接触就是漏接 ⇒ 这段**正悬着**（该回拨，不该算安静） */
        endedOnMissed: lastMissedIdx >= 0 && lastMissedIdx === t.points.length - 1,
        lastAt: lastAnyAt,
    };
}
/** 进行中的段（开着的，按最后接触倒序）——「最近在聊的事」在前。 */
export function liveThreads(list, now) {
    return normalizeThreads(list)
        .filter(function (t) { return threadStateOf(t) === COMM_STATES.OPEN; })
        .sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); });
}
/** 安静了的段（open 且静默超 idleHours；不是结束，只是没动静了）。 */
export function idleThreads(list, now) {
    const n = normNow(now);
    return liveThreads(list).filter(function (t) { return t.lastAt !== null && (n - t.lastAt) > COMM_LIMITS.idleHours * 3600 * 1000; });
}
/** 待处理面：所有注意面非 settled 的段（跨段汇总，供角标与生成侧读数）。 */
export function pendingAttention(list) {
    return normalizeThreads(list)
        .filter(function (t) { return threadStateOf(t) === COMM_STATES.OPEN && attentionOf(t) !== COMM_ATTENTION.SETTLED; })
        .sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); });
}
function attnLabel(a) {
    const map = { settled: '已回', unread: '未读', unanswered: '未回' };
    return map[a] || a;
}
/**
 * 一段交流的读数句（各面各说各的，不拼结论）。
 * ★ 优先级坑（R6-O1 档头记过、本件同样按住）：任何 `'前缀' + x || y` 都拆成
 *   显式中间变量 —— `+` 比 `||` 紧，回退分支会永远走不到。
 */
export function threadSummaryLine(thread, now) {
    const t = normalizeThread(thread);
    if (!t) return '这段交流读不出来（连身份都没有）';
    const state = threadStateOf(t);
    if (state === COMM_STATES.UNREADABLE) {
        return (t.participant || t.id) + '：这段交流有 ' + t.droppedPoints + ' 条接触点读不出来，如实报，不猜。';
    }
    const c = threadCounts(t);
    const r = resumeOf(t);
    const parts = [];
    parts.push('跟' + (t.participant || t.id) + '的一段交流');
    const bits = [];
    if (c.messages) bits.push(c.messages + ' 条消息');
    if (c.sms) bits.push(c.sms + ' 条短信');
    if (c.calls) bits.push(c.calls + ' 通电话');
    if (c.missed) bits.push(c.missed + ' 通漏接');
    if (!bits.length) bits.push('还没有接触点');
    parts.push(bits.join('、'));
    const attn = attentionOf(t);
    if (attn !== COMM_ATTENTION.SETTLED) parts.push('待处理：' + attnLabel(attn) + '（未读 ' + c.unread + ' / 未回 ' + c.unanswered + '）');
    if (r.endedOnMissed) parts.push('★ 最后一次接触是漏接，这段正悬着（该回拨，不算安静）');
    else if (r.resumedAfterMissed) parts.push('漏接过 ' + r.missed + ' 次，之后又接上了');
    if (state === COMM_STATES.CLOSED) parts.push('已收束' + (t.closeReason ? '（' + t.closeReason + '）' : ''));
    return parts.join('；') + '。';
}
/**
 * 投影到「本幕材料」：给记忆桥 / 生成侧 / R6-O3 消费（**引用不复制正文**）。
 *   points 只出 `{ channel, refId }` 与读数，不出任何正文。
 */
export function threadMaterial(thread, now) {
    const t = normalizeThread(thread);
    if (!t) return null;
    const c = threadCounts(t);
    const r = resumeOf(t);
    return {
        id: t.id,
        participant: t.participant,
        participants: t.participants.slice(),
        state: threadStateOf(t),
        attention: attentionOf(t),
        counts: c,
        resume: { missed: r.missed, resumedAfterMissed: r.resumedAfterMissed, endedOnMissed: r.endedOnMissed },
        lastAt: t.lastAt,
        closedAt: t.closedAt,
        closeReason: t.closeReason,
        /* 只出引用（channel+refId），正文留在所有者那边 */
        refs: t.points.map(function (p) { return { channel: p.channel, refId: p.refId, kind: p.kind }; }),
    };
}
/** 自检十项（本件零 DOM 零存储，故只验词表一致性与形态纪律）。 */
export function commSelfCheck() {
    const problems = [];
    const kinds = Object.values(COMM_KINDS);
    if (kinds.length !== 4) problems.push('接触点词表不是四类');
    if (Object.values(COMM_STATES).length !== 4) problems.push('交流态词表不是四格');
    if (Object.values(COMM_ATTENTION).length !== 3) problems.push('注意面词表不是三态');
    if (Object.keys(COMM_REASONS).length !== 12) problems.push('归因词表条数不对');
    const bad = normalizePoint({ kind: 'nope', channel: 'wechat', refId: 'r1', at: 1 });
    if (bad.readable !== false) problems.push('不认识的 kind 必须判 readable:false');
    if (bad.kind !== COMM_KINDS.MESSAGE) problems.push('不认识 kind 的回落格不对');
    const nosrc = normalizePoint({ kind: 'message', channel: 'wechat', refId: '', at: 1 });
    if (nosrc.readable !== false) problems.push('没有 refId 的点必须判 readable:false');
    const noat = normalizePoint({ kind: 'message', channel: 'wechat', refId: 'r1' });
    if (noat.readable !== false) problems.push('没有时间的点必须判 readable:false');
    const keep = normalizeThread({ id: 't1', participant: '阿明', points: [{ kind: 'nope' }] });
    if (!keep) problems.push('有身份的坏形态段不许丢弃');
    if (threadStateOf(keep) !== COMM_STATES.UNREADABLE) problems.push('坏形态段应投影 unreadable');
    if (threadStateOf({ id: '', participant: '' }) !== COMM_STATES.ABSENT) problems.push('无身份应投影 absent');
    const opened = openThread([], '阿明', 1000, '');
    const p1 = appendPoint(opened.list, opened.thread.id, { kind: 'message', channel: 'wechat', refId: 'm1', at: 1000, direction: 'incoming' }, 1000);
    if (!p1.ok) problems.push('正常挂点不该被拒：' + p1.why);
    if (attentionOf(p1.thread) !== COMM_ATTENTION.UNREAD) problems.push('进来的未读应投影 unread');
    const seen = markPointSeen(p1.list, opened.thread.id, p1.thread.points[0].id);
    if (attentionOf(seen.thread) !== COMM_ATTENTION.UNANSWERED) problems.push('读过未回应投影 unanswered');
    const ans = markPointAnswered(seen.list, opened.thread.id, seen.thread.points[0].id);
    if (attentionOf(ans.thread) !== COMM_ATTENTION.SETTLED) problems.push('回过应投影 settled');
    const dup = appendPoint(ans.list, opened.thread.id, { kind: 'message', channel: 'wechat', refId: 'm1', at: 1000 }, 1000);
    if (dup.why !== COMM_REASONS.DUP_POINT) problems.push('同源重点应判 dup-point');
    const gap = appendPoint(ans.list, opened.thread.id,
        { kind: 'message', channel: 'wechat', refId: 'm2', at: 1000 + COMM_LIMITS.gapHours * 3600 * 1000 + 1 }, 1);
    if (gap.why !== COMM_REASONS.GAP_TOO_LONG) problems.push('超窗应判 gap-too-long（不硬续）');
    const closed = closeThread(ans.list, opened.thread.id, '说完了', 2000);
    const afterClose = appendPoint(closed.list, opened.thread.id, { kind: 'message', channel: 'wechat', refId: 'm3', at: 2000 }, 2000);
    if (afterClose.why !== COMM_REASONS.ALREADY_CLOSED) problems.push('收束后不许再挂点');
    return { ok: problems.length === 0, problems: problems };
}

/* ---------- 存储口（唯一一组；与 affair-state / task-entry 同规） ---------- */
export const COMM_KEY = 'comm_threads_v1';
/** 读（键不存在返回 []，不抛）。 */
export function readThreads(storage) {
    try {
        const raw = storage && typeof storage.get === 'function' ? storage.get(COMM_KEY, false) : null;
        if (!raw) return [];
        const arr = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        return normalizeThreads(arr);
    } catch (_e) { return []; }
}
/** 写（fail-safe：写不进不抛，返回 false）。 */
export function writeThreads(storage, list) {
    try {
        const arr = normalizeThreads(list);
        if (storage && typeof storage.set === 'function') {
            storage.set(COMM_KEY, JSON.stringify(arr));
            return true;
        }
        return false;
    } catch (_e) { return false; }
}