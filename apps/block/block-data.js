/* ========================================================
 * block-data.js — [v3.27.0] 拉黑 App 纯函数内核
 *
 * 缝合自 EPhone·xINOVO（`src_xinovo/js/modules/block_system.js`，530 行 / 27324 字符，IIFE 包裹）。
 * 源的结构是**双向的两本账**：
 *   · 你拉黑角色  —— `isBlocked` / `blockedAt` / `blockHistory[]`（`{blockedAt, unblockedAt}`）
 *                    + `friendRequests[]`（角色来申请：`{reason, status, rejectReason}`）
 *                    + `blockReapply`（`{mode:'fixed'|'auto', fixedInterval(默认 30 分), lastRequestTime}`）
 *   · 角色拉黑你  —— `isBlockedByChar` / `blockedByCharAt` / `blockedByCharReason`
 *                    + `charBlockHistory[]` + `userFriendRequests[]`
 * 两块记忆注入：`getBlockMemoryContext`（你拉黑过它 N 次 + 它在被拉黑期间独自写的话）、
 * `getCharBlockMemoryContext`（它主动拉黑过你 N 次 + 每回的理由）。
 *
 * 【缝什么、不缝什么 —— 源里三处「本仓不能有」】
 *   ① **角色的对象账不在本仓**：源全篇按 `db.characters.find(c => c.id === charId)` 定位，
 *      拉黑标记是**写在角色对象上**的（`char.isBlocked`）。本仓的角色对象归宿主，
 *      App 不能往上面挂字段 —— 故本件改为**本会话的一本拉黑账**，
 *      以「本会话的这个角色」为条目单位，不反向引用角色对象。
 *   ② **源自己叫模型**：`submitUserFriendRequest` 把角色人设拼成 system prompt、
 *      调角色接口、解析 `{"accept":true/false,"rejectReason":"…"}`。本仓模型调用一律走宿主生成侧，
 *      App 不自己发请求。故本件把「角色答不答应」**留在 pending**，交给生成侧在它自己的回合里回；
 *      本件只提供「记为接受 / 记为拒绝（含理由）」两个落定口（以及它由正文触发时的落定口）。
 *   ③ **源起了一个 60 秒轮询**（`setInterval(checkBlockedCharacterRequests, 60000)`）：
 *      本仓不做后台轮询（省电、也不该有常驻定时器）。改为**读数**：`cooldownRemaining()`
 *      现场算出「离上次申请满 fixedInterval 还差多久」，由视图显示 —— 该不该置灰由读数说话，
 *      而不是靠一个自己转的定时器。
 *
 * 【从源里取的三块真价值】
 *   · **两本账是对称的**，而且**各有各的历史**：你拉黑它、它来申请；它拉黑你、你去申请。
 *     不是一条布尔「拉黑了」，是带时间和理由的账。
 *   · **申请是有频次的**：源给了 `fixed`（固定间隔，默认 30 分钟）与 `auto`（让角色自己决定何时再来）。
 *     本件保留这两个模式的**语义**（谁来决定再来一次），但不自己转定时器。
 *   · **拒绝是要留理由的**（源 `rejectReason`），而且理由会进下一次申请时拼进 prompt
 *     —— 「之前拒绝过几次、理由分别是什么」是它记仇的材料。
 *
 * 【与源的偏离（逐条写明）】
 *   1. 条目的**身份是「本会话的这条拉黑账」**，不再 `find` 角色对象；本仓没有跨会话的角色实体。
 *   2. **不做后台轮询**（见上面第 ③ 条）：`cooldownRemaining` 是纯函数读数，不注册任何定时器。
 *   3. **申请落定带 `decidedBy`**（`'char'` | `'user'`）：源里只有 AI 定的，本仓两种来源都有
 *      （生成侧在正文里触发 → 本 App 记录；用户手动标记 → 也记录）。读数上分得清是谁定的。
 *
 * 本文件只引 num-gate，无副作用、不碰 DOM、不碰 window、不碰网络、不读聊天历史。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（同 focus / piggy / punchcard 纪律）。 */
export const BLOCK_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 源那两个重来模式（`blockReapply.mode`）。 */
export const BLOCK_REAPPLY_MODES = Object.freeze(['fixed', 'auto']);

export const BLOCK_LIMITS = Object.freeze({
    maxHistory: 50,
    maxRequests: 50,
    maxReasonLen: 120,
    maxRejectReasonLen: 60,
    maxInjectLines: 6,
    minInterval: 1,
    maxInterval: 1440,
    defaultIntervalMin: 30,   // 源 `fixedInterval || 30`
});

export const DEFAULT_BLOCK_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectLines: 6,
    defaultIntervalMin: 30,
});

export function defaultBlockSettings() {
    return Object.freeze({ ...DEFAULT_BLOCK_SETTINGS });
}

function boundedInt(v, fallback, min, max) {
    const n = numOrNull(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeBlockSettings(raw) {
    const d = DEFAULT_BLOCK_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectLines: boundedInt(o.maxInjectLines, d.maxInjectLines, 0, 20),
        defaultIntervalMin: boundedInt(o.defaultIntervalMin, d.defaultIntervalMin,
            BLOCK_LIMITS.minInterval, BLOCK_LIMITS.maxInterval),
    });
}

/* ---------- 空白账 ---------- */

/** 一本空的拉黑账：两本对称的子账。 */
export function emptyBlockState() {
    return {
        /** 你拉黑了这个角色 */
        direct: {
            blocked: false,
            blockedAt: 0,
            history: [],          // [{ blockedAt, unblockedAt }]
            requests: [],         // [{ id, reason, status, rejectReason, createdAt, respondedAt, decidedBy }]
            reapply: { mode: 'fixed', intervalMin: BLOCK_LIMITS.defaultIntervalMin, lastRequestTime: 0, autoNextCheck: 0 },
        },
        /** 这个角色拉黑了你 */
        reverse: {
            blocked: false,
            blockedAt: 0,
            reason: '',
            history: [],          // [{ blockedAt, reason, unblockedAt }]
            myRequests: [],       // [{ id, reason, status, rejectReason, createdAt, respondedAt, decidedBy }]
        },
    };
}

function normHistory(list, reverse) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (const x of arr) {
        const o = (x && typeof x === 'object') ? x : {};
        const blockedAt = boundedInt(o.blockedAt, 0, 0, 4102444800000);
        const unblockedAt = boundedInt(o.unblockedAt, 0, 0, 4102444800000);
        if (!blockedAt) continue;
        const row = { blockedAt, unblockedAt };
        if (reverse) row.reason = String(o.reason || '').trim().slice(0, BLOCK_LIMITS.maxReasonLen);
        out.push(row);
    }
    return out.slice(-BLOCK_LIMITS.maxHistory);
}

function normRequests(list) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (const x of arr) {
        const o = (x && typeof x === 'object') ? x : {};
        const id = String(o.id || '').trim();
        if (!id) continue;
        const status = (o.status === 'accepted' || o.status === 'rejected') ? o.status : 'pending';
        out.push({
            id,
            reason: String(o.reason || '').trim().slice(0, BLOCK_LIMITS.maxReasonLen),
            status,
            rejectReason: String(o.rejectReason || '').trim().slice(0, BLOCK_LIMITS.maxRejectReasonLen),
            createdAt: boundedInt(o.createdAt, 0, 0, 4102444800000),
            respondedAt: boundedInt(o.respondedAt, 0, 0, 4102444800000),
            /* 是谁落的定（见文件头偏离第 3 条）：生成侧在正文里触发，或用户手动标 */
            decidedBy: (o.decidedBy === 'char' || o.decidedBy === 'user') ? o.decidedBy : '',
        });
    }
    return out.slice(-BLOCK_LIMITS.maxRequests);
}

/** 全账规范化。任何野格式都不进内存（换版留下的字段一律丢掉）。 */
export function normalizeBlockState(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const d = (o.direct && typeof o.direct === 'object') ? o.direct : {};
    const r = (o.reverse && typeof o.reverse === 'object') ? o.reverse : {};
    const ra = (d.reapply && typeof d.reapply === 'object') ? d.reapply : {};
    const mode = BLOCK_REAPPLY_MODES.includes(ra.mode) ? ra.mode : 'fixed';
    return {
        direct: {
            blocked: d.blocked === true,
            blockedAt: boundedInt(d.blockedAt, 0, 0, 4102444800000),
            history: normHistory(d.history, false),
            requests: normRequests(d.requests),
            reapply: {
                mode,
                intervalMin: boundedInt(ra.intervalMin, BLOCK_LIMITS.defaultIntervalMin,
                    BLOCK_LIMITS.minInterval, BLOCK_LIMITS.maxInterval),
                lastRequestTime: boundedInt(ra.lastRequestTime, 0, 0, 4102444800000),
                autoNextCheck: boundedInt(ra.autoNextCheck, 0, 0, 4102444800000),
            },
        },
        reverse: {
            blocked: r.blocked === true,
            blockedAt: boundedInt(r.blockedAt, 0, 0, 4102444800000),
            reason: String(r.reason || '').trim().slice(0, BLOCK_LIMITS.maxReasonLen),
            history: normHistory(r.history, true),
            myRequests: normRequests(r.myRequests),
        },
    };
}

/* ---------- 你拉黑它 ---------- */

/** 拉黑。重复拉黑**不开第二段历史**（源每次 push 一条，本件只在「上一段还没结束」时才不 push）。 */
export function setBlocked(state, now) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    if (s.direct.blocked) return { state: s, changed: 0 };
    s.direct.blocked = true;
    s.direct.blockedAt = t;
    const open = s.direct.history.length ? s.direct.history[s.direct.history.length - 1] : null;
    if (!open || open.unblockedAt) {
        s.direct.history = s.direct.history.concat([{ blockedAt: t, unblockedAt: 0 }]).slice(-BLOCK_LIMITS.maxHistory);
    }
    return { state: s, changed: 1 };
}

/** 解除拉黑。给最后一段还没结束的历史**补上结束时间**（源的 `unblockedAt`）。 */
export function clearBlocked(state, now) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    if (!s.direct.blocked) return { state: s, changed: 0 };
    s.direct.blocked = false;
    const h = s.direct.history.slice();
    for (let i = h.length - 1; i >= 0; i -= 1) {
        if (!h[i].unblockedAt) { h[i] = { ...h[i], unblockedAt: t }; break; }
    }
    s.direct.history = h;
    return { state: s, changed: 1 };
}

/**
 * 角色来一条好友申请（源 `generateAndShowFriendRequest` / `aiDecideAndMaybeSendRequest` 的落点）。
 * 处于 pending 的**不再叠第二条**（源也是先看 pending）。返回 `{state, added, id?}`。
 */
export function charApplyRequest(state, reason, now, makeId) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    if (!s.direct.blocked) return { state: s, added: 0, id: '', error: '现在没拉黑它，没有「重新加好友」这回事' };
    if (s.direct.requests.some((r) => r.status === 'pending')) {
        return { state: s, added: 0, id: '', error: '上一条申请还没答复' };
    }
    const id = (typeof makeId === 'function') ? makeId() : ('bq_' + t);
    s.direct.requests = s.direct.requests.concat([{
        id,
        reason: String(reason || '').trim().slice(0, BLOCK_LIMITS.maxReasonLen),
        status: 'pending',
        rejectReason: '',
        createdAt: t,
        respondedAt: 0,
        decidedBy: '',
    }]).slice(-BLOCK_LIMITS.maxRequests);
    s.direct.reapply = { ...s.direct.reapply, lastRequestTime: t };
    return { state: s, added: 1, id };
}

/**
 * 落定一条申请。`by` 记是谁定的：`'char'`（生成侧在正文里答的）或 `'user'`（用户手动标）。
 * 接受 ⇒ **自动解除拉黑**（源 `acceptFriendRequest` 里就是这么连着的）。
 */
export function resolveRequest(state, requestId, accept, rejectReason, now, by) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    const id = String(requestId || '');
    let changed = 0;
    s.direct.requests = s.direct.requests.map((r) => {
        if (r.id !== id || r.status !== 'pending') return r;
        changed += 1;
        return {
            ...r,
            status: accept ? 'accepted' : 'rejected',
            rejectReason: accept ? '' : String(rejectReason || '').trim().slice(0, BLOCK_LIMITS.maxRejectReasonLen),
            respondedAt: t,
            decidedBy: (by === 'char' || by === 'user') ? by : '',
        };
    });
    if (!changed) return { state: s, changed: 0 };
    if (accept) {
        s.direct.blocked = false;
        const h = s.direct.history.slice();
        for (let i = h.length - 1; i >= 0; i -= 1) {
            if (!h[i].unblockedAt) { h[i] = { ...h[i], unblockedAt: t }; break; }
        }
        s.direct.history = h;
    }
    return { state: s, changed };
}

/** 重来模式（源的 `fixed` / `auto`）。**保留** lastRequestTime —— 那笔账是既成事实，
 *  改模式只改「下一回按谁的意思来」，不该把已经等过的时间抹掉。 */
export function setReapply(state, mode, intervalMin) {
    const s = normalizeBlockState(state);
    const m = BLOCK_REAPPLY_MODES.includes(mode) ? mode : 'fixed';
    s.direct.reapply = {
        mode: m,
        intervalMin: boundedInt(intervalMin, s.direct.reapply.intervalMin,
            BLOCK_LIMITS.minInterval, BLOCK_LIMITS.maxInterval),
        lastRequestTime: s.direct.reapply.lastRequestTime,
        autoNextCheck: 0,
    };
    return { state: s };
}

/**
 * 距上次申请满 `intervalMin` 还差多少毫秒（0 = 可以来下一条）。
 * **这是读数，不是定时器**（见文件头「不缝什么」第 ③ 条）：没人转它，问的时候才算。
 */
export function cooldownRemaining(state, now) {
    const s = normalizeBlockState(state);
    if (!s.direct.blocked) return 0;
    if (s.direct.reapply.mode === 'auto') return 0;   // auto = 谁来什么时候由角色自己看着办，本件不拦
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    const last = s.direct.reapply.lastRequestTime || s.direct.blockedAt;
    if (!last) return 0;
    const span = s.direct.reapply.intervalMin * 60 * 1000;
    return Math.max(0, (last + span) - t);
}

/* ---------- 它拉黑你 ---------- */

/** 角色主动拉黑用户（源由正文里的 `[char-action:block-user|reason:xxx]` 触发）。 */
export function setCharBlocked(state, reason, now) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    const rs = String(reason || '').trim().slice(0, BLOCK_LIMITS.maxReasonLen) || '不想再聊了';
    if (s.reverse.blocked) return { state: s, changed: 0 };
    s.reverse.blocked = true;
    s.reverse.blockedAt = t;
    s.reverse.reason = rs;
    s.reverse.history = s.reverse.history.concat([{ blockedAt: t, reason: rs, unblockedAt: 0 }])
        .slice(-BLOCK_LIMITS.maxHistory);
    return { state: s, changed: 1 };
}

/** 解除（它把你放出来）。 */
export function clearCharBlocked(state, now) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    if (!s.reverse.blocked) return { state: s, changed: 0 };
    s.reverse.blocked = false;
    const h = s.reverse.history.slice();
    for (let i = h.length - 1; i >= 0; i -= 1) {
        if (!h[i].unblockedAt) { h[i] = { ...h[i], unblockedAt: t }; break; }
    }
    s.reverse.history = h;
    return { state: s, changed: 1 };
}

/**
 * 你去申请加回它（源 `submitUserFriendRequest`）。
 * 源在这里调模型当场判接受/拒绝 —— 本件**不调**，落成 pending 等生成侧回（见文件头第 ② 条）。
 */
export function myApply(state, reason, now, makeId) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    if (!s.reverse.blocked) return { state: s, added: 0, id: '', error: '对方没拉黑你，不用申请' };
    if (s.reverse.myRequests.some((r) => r.status === 'pending')) {
        return { state: s, added: 0, id: '', error: '上一条申请还没回音' };
    }
    const id = (typeof makeId === 'function') ? makeId() : ('ur_' + t);
    s.reverse.myRequests = s.reverse.myRequests.concat([{
        id,
        reason: String(reason || '').trim().slice(0, BLOCK_LIMITS.maxReasonLen),
        status: 'pending',
        rejectReason: '',
        createdAt: t,
        respondedAt: 0,
        decidedBy: '',
    }]).slice(-BLOCK_LIMITS.maxRequests);
    return { state: s, added: 1, id };
}

/** 落定你那条申请（生成侧答的 / 用户手动标的）。接受 ⇒ 反向解除。 */
export function resolveMyRequest(state, requestId, accept, rejectReason, now, by) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    const id = String(requestId || '');
    let changed = 0;
    s.reverse.myRequests = s.reverse.myRequests.map((r) => {
        if (r.id !== id || r.status !== 'pending') return r;
        changed += 1;
        return {
            ...r,
            status: accept ? 'accepted' : 'rejected',
            rejectReason: accept ? '' : String(rejectReason || '').trim().slice(0, BLOCK_LIMITS.maxRejectReasonLen),
            respondedAt: t,
            decidedBy: (by === 'char' || by === 'user') ? by : '',
        };
    });
    if (!changed) return { state: s, changed: 0 };
    if (accept) {
        s.reverse.blocked = false;
        const h = s.reverse.history.slice();
        for (let i = h.length - 1; i >= 0; i -= 1) {
            if (!h[i].unblockedAt) { h[i] = { ...h[i], unblockedAt: t }; break; }
        }
        s.reverse.history = h;
    }
    return { state: s, changed };
}

/* ---------- 清账 ---------- */

export function clearAllHistory(state) {
    const s = normalizeBlockState(state);
    const n = s.direct.history.length + s.direct.requests.length
        + s.reverse.history.length + s.reverse.myRequests.length;
    s.direct.history = [];
    s.direct.requests = [];
    s.reverse.history = [];
    s.reverse.myRequests = [];
    return { state: s, removed: n };
}

export function resetBlockState() {
    return { state: emptyBlockState(), changed: 1 };
}

/* ---------- 投影 / 归因 / 注入 ---------- */

/** 归因：先判能不能读，再判读到了什么。**两本账都空**才算 empty。 */
export function readBlockFace(probe) {
    if (!probe || probe.storageOk === false) return BLOCK_REASONS.storage_absent;
    if (probe.hasAny !== true) return BLOCK_REASONS.empty;
    return BLOCK_REASONS.ready;
}

/** 最近一次拒绝的理由（源把它拼进下一次申请的 prompt）。 */
export function lastRejectReason(requests) {
    const arr = Array.isArray(requests) ? requests : [];
    for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (arr[i] && arr[i].status === 'rejected' && arr[i].rejectReason) return arr[i].rejectReason;
    }
    return '';
}

/** 投影（读数）。读不到就如实给 0 / 空数组，**不编数**。 */
export function projectBlock(state, now) {
    const s = normalizeBlockState(state);
    const t = boundedInt(now, Date.now(), 0, 4102444800000);
    const reqs = s.direct.requests;
    const mine = s.reverse.myRequests;
    return {
        directBlocked: s.direct.blocked,
        directSince: s.direct.blockedAt,
        directTimes: s.direct.history.length,
        directRequests: reqs,
        requestCount: reqs.length,
        pendingFromChar: reqs.filter((r) => r.status === 'pending'),
        acceptedCount: reqs.filter((r) => r.status === 'accepted').length,
        rejectedCount: reqs.filter((r) => r.status === 'rejected').length,
        lastReject: lastRejectReason(reqs),
        reapply: s.direct.reapply,
        cooldownMs: cooldownRemaining(s, t),
        reverseBlocked: s.reverse.blocked,
        reverseSince: s.reverse.blockedAt,
        reverseReason: s.reverse.reason,
        reverseTimes: s.reverse.history.length,
        myRequests: mine,
        myPending: mine.filter((r) => r.status === 'pending'),
        myRejectedCount: mine.filter((r) => r.status === 'rejected').length,
        hasAny: s.direct.history.length > 0 || reqs.length > 0
            || s.reverse.history.length > 0 || mine.length > 0
            || s.direct.blocked || s.reverse.blocked,
    };
}

/** 毫秒 → 「X 分钟」/「X 小时 Y 分」（给视图与注入共用，两边口径一致）。 */
export function formatCooldown(ms) {
    const n = numOrNull(ms);
    if (n === null || n <= 0) return '';
    const min = Math.ceil(n / 60000);
    if (min < 60) return min + ' 分钟';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? (h + ' 小时 ' + m + ' 分') : (h + ' 小时');
}

/**
 * 生成侧注入块。只给**事实**（两本账的状态、几次、最近的回绝理由、还有几条申请悬着），
 * 不给角色台词、不替它决定答不答应。两本账都平 ⇒ 返回**空串**（不产生空块）。
 */
export function blockPromptBlock(proj, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj || !proj.hasAny) return '';
    const max = (typeof settings.maxInjectLines === 'number') ? settings.maxInjectLines : 6;
    if (max <= 0) return '';
    const rows = [];
    if (proj.directBlocked) {
        rows.push('\u00b7 用户**正在拉黑你**（第 ' + proj.directTimes + ' 次）'
            + (function () {
                const p = proj.pendingFromChar.length;
                if (!p) return '';
                const cd = formatCooldown(proj.cooldownMs);
                return '；你提了 ' + p + ' 条好友申请还没答复'
                    + (cd ? ('（按约定还要等 ' + cd + '）') : '');
            }())
            + '。');
        if (proj.lastReject) rows.push('\u00b7 用户上次回绝你的理由：' + proj.lastReject);
    } else if (proj.directTimes > 0) {
        rows.push('\u00b7 用户曾拉黑过你 ' + proj.directTimes + ' 次（现在没拉黑）。');
    }
    if (proj.reverseBlocked) {
        rows.push('\u00b7 **你正在拉黑用户**（第 ' + proj.reverseTimes + ' 次），'
            + '你当时给的理由：' + (proj.reverseReason || '（没记）') + '。');
        if (proj.myPending.length) rows.push('\u00b7 用户提了 ' + proj.myPending.length + ' 条加回申请还没回音。');
    } else if (proj.reverseTimes > 0) {
        rows.push('\u00b7 你曾主动拉黑过用户 ' + proj.reverseTimes + ' 次（现在没有）。');
    }
    if (!rows.length) return '';
    return '【系统·拉黑】\n' + rows.slice(0, max).join('\n');
}