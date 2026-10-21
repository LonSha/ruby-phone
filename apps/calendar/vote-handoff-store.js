/* ========================================================
 * apps/calendar/vote-handoff-store.js — [v4.44.0 · 第五期 R5-O2]
 *   群投票凭据的**草稿与幂等台账**（两键读写的唯一实现）
 * --------------------------------------------------------
 * 【为什么单独一件】这两个键有**两个消费者**：
 *   · 宿主（`index.js`）在 `phone:groupVoteConfirm` 到达时要**同步**给微信侧一份回执
 *     （那句「已转交」必须如实），此时日历 App 可能还没被懒加载出来；
 *   · 日历 App（`apps/calendar/calendar-app.js`）在表单里读草稿、提交后记台账。
 *   若两边各写一份「读 JSON / 判重 / 落盘」，两份必然漂移 —— 漂移的后果是
 *   「宿主说收到了、日历说没有」这种最难查的读数分歧。故两键读写只此一份，
 *   两侧都**委派**到本件（本仓「同一口径只许一份实现」）。
 *
 * 【三条纪律】
 *   · 永不抛：存储读不出/JSON 坏/形态不对，一律降级为 null / [] / false（并如实说明）；
 *   · 不猜：没有草稿就是没有（不拟一份空的出来）；
 *   · 不替用户决定日期：本件只管「凭据」与「台账」，日期时段由用户在表单上给。
 *
 * 【键名】走 `config/group-vote-handoff.js` 的 `GV_HANDOFF_KEYS` 唯一出处；
 *   两键都命中 `^calendar_`（随会话隔离），换角色不会带着上一个角色的待办。
 * ======================================================== */
'use strict';
import {
    GV_HANDOFF_STATES,
    GV_HANDOFF_LIMITS,
    GV_HANDOFF_KEYS,
    normalizeHandoff,
    handoffLine
} from '../../config/group-vote-handoff.js';

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

/**
 * 收下一份凭据：归一 → 查幂等台账 → 落草稿。**只落草稿，不建事项**。
 *   ★ 已建过的（台账里有这个 `activityKey`）**不再落草稿**，直接报 `replayed`：
 *     否则表单会预填一份已经建过的活动，用户再提交一次就真的双建了。
 * @returns {{ok,state,why,handoff,line}} 永不抛
 */
export function receiveHandoff(storage, detail) {
    let norm = null;
    try { norm = normalizeHandoff(detail); } catch (_e) { norm = null; }
    if (!norm || !norm.ok) {
        const why = String((norm && norm.why) || 'handoff-not-object');
        const read = { ok: false, state: GV_HANDOFF_STATES.FAILED, why: why, handoff: null };
        read.line = handoffLine(read);
        return read;
    }
    if (isApplied(storage, norm.activityKey)) {
        /* ★ [v4.44.0 · R5-O2 收尾] 已建过 ⇒ 把**这一份**的草稿清掉。
         *   留着它，表单会预填一份**已经建过**的活动，用户再提交就撞台账 —— 白挨一次
         *   「不重复建」，读数还容易读成「刚才那次没成」。
         *   ★ 只清 `activityKey` 相同的那一份：草稿若是**另一场**投票（还没建），
         *     那是用户的待办，一个字节都不许动（清错比不清更难收拾）。 */
        const held = pendingHandoff(storage);
        if (held && held.activityKey === norm.activityKey) {
            try { storage?.remove?.(GV_HANDOFF_KEYS.draft); } catch (_e) { /* 清不掉不影响「已建过」这条读数 */ }
        }
        const read = { ok: true, state: GV_HANDOFF_STATES.REPLAYED, why: '', handoff: norm };
        read.line = handoffLine(read);
        return read;
    }
    writeJson(storage, GV_HANDOFF_KEYS.draft, { handoff: norm, at: Date.now() });
    const read = { ok: true, state: GV_HANDOFF_STATES.RECEIVED, why: '', handoff: norm };
    read.line = handoffLine(read);
    return read;
}

/** 读草稿（**不消费**；表单渲染时用）。没有 ⇒ null（不拟一份出来）。 */
export function pendingHandoff(storage) {
    const parsed = readJson(storage, GV_HANDOFF_KEYS.draft);
    const h = (parsed && typeof parsed === 'object') ? parsed.handoff : null;
    if (!h || h.ok !== true || !h.activityKey) return null;
    return h;
}

/** 取用草稿（取完即清：一次转交只喂一次表单，不让它反复预填）。 */
export function consumeHandoff(storage) {
    const h = pendingHandoff(storage);
    try { storage?.remove?.(GV_HANDOFF_KEYS.draft); } catch (_e) { /* 清不掉不影响本次取用 */ }
    return h;
}

/** 幂等台账（活动 id 列表）。读不出 ⇒ []（**不假装「都建过了」也不假装「都没建过」**）。 */
export function appliedKeys(storage) {
    const parsed = readJson(storage, GV_HANDOFF_KEYS.applied);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.keys) ? parsed.keys : []);
    const out = [];
    for (const item of list) {
        const k = String(item || '').trim();
        if (k && out.indexOf(k) < 0) out.push(k);
    }
    return out;
}

/** 这一份活动建过事项没有。 */
export function isApplied(storage, activityKey) {
    const key = String(activityKey || '').trim();
    if (!key) return false;
    return appliedKeys(storage).indexOf(key) >= 0;
}

/** 记一次「这份活动已建过事项」（超上限丢最旧，**不静默截断新记录**）。 */
export function markApplied(storage, activityKey) {
    const key = String(activityKey || '').trim();
    if (!key) return false;
    const list = appliedKeys(storage).filter((k) => k !== key);
    list.push(key);
    const max = Number(GV_HANDOFF_LIMITS.applied) || 80;
    return writeJson(storage, GV_HANDOFF_KEYS.applied, list.slice(-max));
}

/**
 * 自检（判据与体检共用；真跑一遍，不写「已检查」）。
 *   用一份**内存假件**跑：落草稿 → 读回 → 消费即清 → 记台账 → 判重 → 拒收三态。
 * @param {object} [fakeStorage] 可选注入（判据给假件；不给则用内置假件）
 */
export function voteHandoffStoreSelfCheck(fakeStorage) {
    const problems = [];
    const bag = new Map();
    const st = fakeStorage || {
        get: (k, d) => (bag.has(k) ? bag.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); }
    };
    const good = { activityId: 'act_9', optionId: 'o9', participants: ['甲'], label: '郊游' };
    const r1 = receiveHandoff(st, good);
    if (r1.state !== GV_HANDOFF_STATES.RECEIVED) problems.push('合法凭据未按 received 收下：' + r1.state);
    const p = pendingHandoff(st);
    if (!p || p.activityKey !== 'act_9') problems.push('草稿没落上（或读不回）');
    const c = consumeHandoff(st);
    if (!c || c.activityKey !== 'act_9') problems.push('取用没拿到草稿');
    if (pendingHandoff(st) !== null) problems.push('取用后草稿没清（会反复预填）');
    if (!markApplied(st, 'act_9')) problems.push('台账没记上');
    if (!isApplied(st, 'act_9')) problems.push('台账读不回');
    const r2 = receiveHandoff(st, good);
    if (r2.state !== GV_HANDOFF_STATES.REPLAYED) problems.push('已建过的再收未报 replayed：' + r2.state);
    if (pendingHandoff(st) !== null) problems.push('replayed 时不得再落草稿（否则会双建）');
    /* ★ 已建过**且草稿还在场**（表单已预填、用户还没提交）⇒ 再收一次必须把这份草稿清掉。 */
    const bag2 = new Map();
    const st2 = {
        get: (k, d) => (bag2.has(k) ? bag2.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag2.set(k, v); },
        remove: (k) => { bag2.delete(k); }
    };
    receiveHandoff(st2, good);
    markApplied(st2, 'act_9');
    receiveHandoff(st2, good);
    if (pendingHandoff(st2) !== null) problems.push('已建过的再收，同一份草稿没清（表单会预填已建活动）');
    /* ★ 草稿若属于**另一场**投票（还没建）⇒ 一个字节都不许动（那是用户的待办）。 */
    const bag3 = new Map();
    const st3 = {
        get: (k, d) => (bag3.has(k) ? bag3.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag3.set(k, v); },
        remove: (k) => { bag3.delete(k); }
    };
    receiveHandoff(st3, { activityId: 'act_other', optionId: 'o1' });
    markApplied(st3, 'act_9');
    receiveHandoff(st3, good);
    if (pendingHandoff(st3)?.activityKey !== 'act_other') problems.push('清草稿误伤了另一场投票的待办');
    if (receiveHandoff(st, { optionId: 'o1' }).state !== GV_HANDOFF_STATES.FAILED) problems.push('缺活动 id 未拒收');
    if (receiveHandoff(st, 'x').state !== GV_HANDOFF_STATES.FAILED) problems.push('非对象未拒收');
    /* 坏存储不得抛（三个出口各来一遍）。 */
    const broken = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); }, remove: () => { throw new Error('x'); } };
    try {
        if (receiveHandoff(broken, good).state !== GV_HANDOFF_STATES.RECEIVED) problems.push('坏存储时未按 received 降级');
        if (pendingHandoff(broken) !== null) problems.push('坏存储时草稿应为 null');
        if (appliedKeys(broken).length !== 0) problems.push('坏存储时台账应为空表');
        if (isApplied(broken, 'k')) problems.push('坏存储时判重应为 false');
        if (markApplied(broken, 'k') !== false) problems.push('坏存储时记台账应报 false');
        if (consumeHandoff(broken) !== null) problems.push('坏存储时取用应为 null');
    } catch (e) {
        problems.push('坏存储把出口抛了：' + String((e && e.message) || e));
    }
    return { problems: problems, keys: Object.keys(GV_HANDOFF_KEYS).length };
}

export default {
    receiveHandoff,
    pendingHandoff,
    consumeHandoff,
    appliedKeys,
    isApplied,
    markApplied,
    voteHandoffStoreSelfCheck
};