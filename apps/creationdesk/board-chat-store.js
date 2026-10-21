/* ========================================================
 * apps/creationdesk/board-chat-store.js — [v4.45.0 · 第五期 R5-O1]
 *   「下一次主聊天要带的材料」的**唯一读写实现**（登记 / 读 / 取用即清 / 幂等台账）
 * --------------------------------------------------------
 * 【为什么单独一件】这一格有**两个消费者**：
 *   · 取材板（`creationdesk-app.js`）在用户点「用于下一次主聊天」时登记；
 *   · 主聊天侧（宿主 / 记忆插件面）在装配下一次请求时取用。
 *   若两边各写一份「读 JSON / 判重 / 落盘」，两份必然漂移 —— 漂移的后果是
 *   「取材板说登记了、主聊天说没有」这种最难查的读数分歧（本仓「同一口径只许一份实现」）。
 *
 * 【三条纪律】
 *   · 永不抛：存储读不出 / JSON 坏 / 形态不对，一律降级为 null / [] / false（并如实说明）；
 *   · 不猜：没有登记就是没有（**不拟一份空的出来**，也不把「读不出」当成「没有」）；
 *   · **登记 ≠ 已发送**：本件只管「下一次要带什么」，一个字节都不进任何一次请求。
 *     发送归用户在主聊天里显式确认（计划原文：「发送主聊天必须另行显式确认，
 *     取材板不自行生成或发消息」）。
 *
 * 【键名】走 `config/material-board-handoff.js` 的 `MBH_KEYS` 唯一出处；
 *   命中 `^cw_`（随会话隔离，换角色不带着上一个角色的待用材料）。
 * ======================================================== */
'use strict';
import {
    MBH_STATES,
    MBH_LIMITS,
    MBH_KEYS,
    normalizeHandoff,
    handoffLine
} from '../../config/material-board-handoff.js';

/** 读一个 JSON 键（读不出 ⇒ null；**不抛**）。 */
function readJson(storage, key) {
    try {
        const saved = storage?.get?.(key, null);
        if (saved === null || saved === undefined || saved === '') return null;
        return (typeof saved === 'string') ? JSON.parse(saved) : saved;
    } catch (_e) { return null; }
}

/** 写一个 JSON 键（写不成 ⇒ false；**不抛**）。 */
function writeJson(storage, key, value) {
    try {
        storage?.set?.(key, JSON.stringify(value));
        return true;
    } catch (_e) { return false; }
}

/** 台账（已登记过的幂等键）。读不出 ⇒ []（**不假装「都登记过」也不假装「都没登记过」**）。 */
export function appliedKeys(storage) {
    const parsed = readJson(storage, MBH_KEYS.pending);
    const rows = (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) ? parsed.rows : [];
    const out = [];
    for (const r of rows) {
        const k = String((r && r.key) || '').trim();
        if (k && out.indexOf(k) < 0) out.push(k);
    }
    return out;
}

/** 这一份交接登记过没有。 */
export function isApplied(storage, key) {
    const k = String(key || '').trim();
    if (!k) return false;
    return appliedKeys(storage).indexOf(k) >= 0;
}

/**
 * 登记一份「下一次主聊天要带的材料」。
 *   ★ 同一份（同幂等键）**第二次只报 `replayed`，不重复插**：
 *     重复登记会让同一次取材在主聊天里出现两遍（用户无法分辨哪一份是真的）。
 *   ★ 超上限**丢最旧**，**不静默截断新记录**。
 * @returns {{ok,state,why,handoff,count,line}} 永不抛
 */
export function receiveHandoff(storage, input) {
    let norm = null;
    try { norm = normalizeHandoff(input); } catch (_e) { norm = null; }
    if (!norm || !norm.ok) {
        const why = String((norm && norm.why) || 'handoff-not-object');
        const read = { ok: false, state: MBH_STATES.FAILED, why: why, count: 0, handoff: norm || null };
        read.line = handoffLine(read);
        return read;
    }
    const parsed = readJson(storage, MBH_KEYS.pending);
    const rows = (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) ? parsed.rows.slice() : [];
    if (rows.some((r) => String((r && r.key) || '') === norm.key)) {
        const read = { ok: true, state: MBH_STATES.REPLAYED, why: '', count: norm.items.length, handoff: norm };
        read.line = handoffLine(read);
        return read;
    }
    rows.push({
        key: norm.key,
        target: norm.target,
        task: norm.task,
        refs: norm.refs.slice(),
        note: norm.note,
        items: norm.items.slice(),
        sourceKind: norm.sourceKind || 'memory-fact',
        sent: false,
        at: Date.now()
    });
    const max = Number(MBH_LIMITS.pending) || 60;
    const kept = rows.slice(-max);
    if (!writeJson(storage, MBH_KEYS.pending, { rows: kept })) {
        const read = { ok: false, state: MBH_STATES.FAILED, why: '', writeWhy: 'write-failed', count: norm.items.length, handoff: norm };
        read.line = handoffLine(read);
        return read;
    }
    const read = { ok: true, state: MBH_STATES.PENDING, why: '', count: norm.items.length, handoff: norm };
    read.line = handoffLine(read);
    return read;
}

/** 读当前登记（**不消费**；界面读数用）。没有 ⇒ null（不拟一份出来）。 */
export function pendingHandoff(storage) {
    const parsed = readJson(storage, MBH_KEYS.pending);
    const rows = (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) ? parsed.rows : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    if (!last || !last.key) return null;
    return {
        key: String(last.key),
        target: String(last.target || 'chat'),
        task: String(last.task || ''),
        refs: Array.isArray(last.refs) ? last.refs.slice() : [],
        note: String(last.note || ''),
        items: Array.isArray(last.items) ? last.items.slice() : [],
        sourceKind: String(last.sourceKind || 'memory-fact'),
        sent: last.sent === true,
        at: Number(last.at) || 0,
        count: (Array.isArray(last.items) ? last.items.length : 0)
    };
}

/**
 * 取用（取完即清：一次登记只喂一次下一次请求）。
 *   ★ 取用**不等于已发送**：取用者拿到的是「要带的材料」，发不发仍由用户确认。
 *   ★ 已发送标记**不由本件写**（本件一个字节都不进请求）：`markSent` 只给主聊天侧
 *     在**真发出去之后**如实留痕用。
 */
export function consumeHandoff(storage) {
    const h = pendingHandoff(storage);
    if (!h) return null;
    const parsed = readJson(storage, MBH_KEYS.pending);
    const rows = (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) ? parsed.rows : [];
    const kept = rows.filter((r) => String((r && r.key) || '') !== h.key);
    try { writeJson(storage, MBH_KEYS.pending, { rows: kept }); } catch (_e) { /* 清不掉不影响本次取用 */ }
    return h;
}

/** 主聊天侧真发出去之后留痕（**本件不判断「发没发」**，由调用方如实给）。 */
export function markSent(storage, key) {
    const k = String(key || '').trim();
    if (!k) return false;
    const parsed = readJson(storage, MBH_KEYS.pending);
    const rows = (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) ? parsed.rows.slice() : [];
    let hit = false;
    for (const r of rows) if (String((r && r.key) || '') === k) { r.sent = true; hit = true; }
    if (!hit) return false;
    return writeJson(storage, MBH_KEYS.pending, { rows: rows });
}

/**
 * 自检（判据与体检共用；真跑一遍，不写「已检查」）。
 *   用一份**内存假件**跑：登记 → 读回 → 取用即清 → 判重 → 拒收三态 → 坏存储降级。
 */
export function boardChatStoreSelfCheck(fakeStorage) {
    const problems = [];
    const bag = new Map();
    const st = fakeStorage || {
        get: (k, d) => (bag.has(k) ? bag.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); }
    };
    const good = {
        target: 'chat', task: 'reunion',
        items: [{ id: 'f1', source: 'continuity', facet: 'sharedPast', facetLabel: '共同往事', title: '雨夜那次', floor: 88 }]
    };
    const r1 = receiveHandoff(st, good);
    if (r1.state !== MBH_STATES.PENDING) problems.push('合法交接未按 pending 登记：' + r1.state);
    const p = pendingHandoff(st);
    if (!p || p.count !== 1) problems.push('登记没落上（或读不回）');
    const again = receiveHandoff(st, good);
    if (again.state !== MBH_STATES.REPLAYED) problems.push('同一份再登记未报 replayed：' + again.state);
    if (appliedKeys(st).length !== 1) problems.push('台账必须只记一条（幂等键）');
    const c = consumeHandoff(st);
    if (!c || c.count !== 1) problems.push('取用没拿到登记');
    if (pendingHandoff(st) !== null) problems.push('取用后必须清（一次登记只喂一次请求）');
    /* 拒收三态 */
    if (receiveHandoff(st, { target: 'draft', items: [] }).state !== MBH_STATES.FAILED) problems.push('一条没选未拒收');
    if (receiveHandoff(st, null).state !== MBH_STATES.FAILED) problems.push('非对象未拒收');
    if (receiveHandoff(st, { target: 'publish', items: good.items }).state !== MBH_STATES.FAILED) problems.push('去向不认识未拒收');
    /* 坏存储不得抛（三个出口各来一遍） */
    const broken = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); }, remove: () => { throw new Error('x'); } };
    try {
        if (pendingHandoff(broken) !== null) problems.push('坏存储时读登记应为 null');
        if (appliedKeys(broken).length !== 0) problems.push('坏存储时台账应为空表');
        if (isApplied(broken, 'k')) problems.push('坏存储时判重应为 false');
        if (consumeHandoff(broken) !== null) problems.push('坏存储时取用应为 null');
        if (receiveHandoff(broken, good).state !== MBH_STATES.FAILED) problems.push('坏存储时登记应如实报 failed（写不进去不许当成功）');
        if (markSent(broken, 'k') !== false) problems.push('坏存储时留痕应报 false');
    } catch (e) {
        problems.push('坏存储把出口抛了：' + String((e && e.message) || e));
    }
    return { problems: problems, keys: Object.keys(MBH_KEYS).length };
}

export default {
    receiveHandoff,
    pendingHandoff,
    consumeHandoff,
    appliedKeys,
    isApplied,
    markSent,
    boardChatStoreSelfCheck
};