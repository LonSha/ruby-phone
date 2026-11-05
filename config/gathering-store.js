/* ================================================================
 * config/gathering-store.js — [v4.124.0 · R14-X2] 邀约台账的**唯一读写口**
 * ----------------------------------------------------------------
 * 【为什么单独一件】这个键有两个消费者：
 *   · 微信侧（群聊邀约卡）要读「这场现在谁说来、要复核谁」；
 *   · 日历侧（建日程时）要读「这场定了哪个时段、按什么幂等键」。
 *   若两边各写一份「读 JSON / 判重 / 落盘」，两份必然漂移 —— 漂移的后果是
 *   「微信说甲说来、日历说没人回」这种最难查的读数分歧。故读写只此一份。
 *
 * 【三条纪律】
 *   · 永不抛：存储读不出 / JSON 坏 / 形态不对，一律降级为 [] / null / false；
 *   · 不猜：没有这场就是没有（不拟一份空的出来）；
 *   · 不替用户决定：本件只管「存的形状」，答复与确认都在内核里判。
 *
 * 【键名】`gathering_plan_v1`，命中 `^gathering_`（随会话隔离），
 *   换角色不会带着上一个角色的邀约。
 * ================================================================ */
'use strict';
import {
    GP_REASONS,
    GP_LIMITS,
    normalizeGathering,
    normalizeGatherings,
} from './gathering-plan.js';

export const GP_KEY = 'gathering_plan_v1';

/** 读一个 JSON 键（读不出 ⇒ null；**不抛**）。 */
function readJson(storage) {
    try {
        const saved = storage?.get?.(GP_KEY, null);
        if (saved === null || saved === undefined || saved === '') return null;
        return (typeof saved === 'string') ? JSON.parse(saved) : saved;
    } catch (_e) { return null; }
}

/** 写一个 JSON 键（写不成 ⇒ false；**不抛**）。 */
function writeJson(storage, value) {
    try {
        storage?.set?.(GP_KEY, JSON.stringify(value));
        return true;
    } catch (_e) { return false; }
}

/** 读全部邀约（读不出 ⇒ []；坏条目保留并标 readable:false）。 */
export function readGatherings(storage) {
    const parsed = readJson(storage);
    if (!parsed) return [];
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.list) ? parsed.list : []);
    return normalizeGatherings(list);
}

/** 写全部邀约（超上限丢最旧，**不静默截断新记录**）。 */
export function writeGatherings(storage, list) {
    const arr = normalizeGatherings(list);
    const max = Math.max(1, Number(GP_LIMITS.gatherings) || 40);
    return writeJson(storage, arr.slice(-max));
}

/** 按 id 取一场（取不到 ⇒ null；不拟一份出来）。 */
export function findGathering(storage, gatherId) {
    const id = String(gatherId == null ? '' : gatherId).trim();
    if (!id) return null;
    const list = readGatherings(storage);
    return list.filter((g) => g.gatherId === id)[0] || null;
}

/** 存一场（同 id 覆盖；新场追加）。**幂等**：同一场写两次结果一样。 */
export function saveGathering(storage, gathering) {
    const g = normalizeGathering(gathering);
    if (!g) return false;
    const list = readGatherings(storage);
    const idx = list.findIndex((x) => x.gatherId === g.gatherId);
    if (idx >= 0) list[idx] = g;
    else list.push(g);
    return writeGatherings(storage, list);
}

/** 删一场（**只删这条邀约台账**，绝不碰任何聊天 —— 取消≠删除聊天）。 */
export function dropGathering(storage, gatherId) {
    const id = String(gatherId == null ? '' : gatherId).trim();
    if (!id) return false;
    const list = readGatherings(storage).filter((g) => g.gatherId !== id);
    return writeGatherings(storage, list);
}

/**
 * 自检（判据与体检共用；真跑一遍，不写「已检查」）。
 *   用一份**内存假件**跑：写→读回→按 id 取→覆盖→删→坏存储六出口。
 */
export function gatheringStoreSelfCheck(fakeStorage) {
    const problems = [];
    const bag = new Map();
    const st = fakeStorage || {
        get: (k, d) => (bag.has(k) ? bag.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); },
    };
    const g = { gatherId: 'g1', title: '周五 KTV', invitees: [{ id: 'a' }], stage: 'invited' };
    if (!saveGathering(st, g)) problems.push('save 报失败');
    const back = findGathering(st, 'g1');
    if (!back || back.title !== '周五 KTV') problems.push('写进去读不回');
    if (readGatherings(st).length !== 1) problems.push('列表长度不对');
    /* 覆盖不追加。 */
    if (!saveGathering(st, Object.assign({}, g, { title: '周六 KTV' }))) problems.push('覆盖写报失败');
    const list = readGatherings(st);
    if (list.length !== 1) problems.push('同 id 覆盖变成了两条（会双建日程）');
    if (list[0].title !== '周六 KTV') problems.push('覆盖没生效');
    if (!findGathering(st, '') && findGathering(st, '') !== null) problems.push('空 id 应返回 null');
    if (findGathering(st, 'nope') !== null) problems.push('不存在的 id 应返回 null（不拟一份出来）');
    if (!dropGathering(st, 'g1')) problems.push('drop 报失败');
    if (readGatherings(st).length !== 0) problems.push('删完还有残留');
    if (saveGathering(st, { title: '' })) problems.push('没标题的邀约不该被存进去');
    /* 坏存储不得抛（六个出口各来一遍）。 */
    const broken = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); } };
    try {
        if (readGatherings(broken).length !== 0) problems.push('坏存储时列表应为空');
        if (findGathering(broken, 'x') !== null) problems.push('坏存储时按 id 取应为 null');
        if (saveGathering(broken, g) !== false) problems.push('坏存储时 save 应报 false');
        if (dropGathering(broken, 'x') !== false) problems.push('坏存储时 drop 应报 false');
        if (writeGatherings(broken, []) !== false) problems.push('坏存储时 write 应报 false');
    } catch (e) {
        problems.push('坏存储把出口抛了：' + String((e && e.message) || e));
    }
    /* 坏 JSON 不得抛。 */
    const badJson = { get: () => '{not json', set: () => {} };
    if (readGatherings(badJson).length !== 0) problems.push('坏 JSON 应降级为空表');
    return { problems: problems, key: GP_KEY, reasons: Object.keys(GP_REASONS).length };
}

export default {
    GP_KEY,
    readGatherings,
    writeGatherings,
    findGathering,
    saveGathering,
    dropGathering,
    gatheringStoreSelfCheck,
};