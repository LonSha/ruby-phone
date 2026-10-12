/* =========================================================
 * config/list-window.js — [v3.98.0 · R3-O5] 社媒长列表的顺滑浏览（**纯函数**）
 * ---------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   `apps/xhs/xhs-view.js::_renderMasonry` 一直是 `grid.innerHTML = notes.map(...).join('')`
 *   + 每次点赞 `toggleLike()` 之后**整列重建**。三件事在 1000 条笔记下同时发作：
 *     ① **DOM 一次性建满**：1000 张卡 + 1000 个 `<img>`，进页就是一次长任务；
 *     ② **点赞重建全列**：点一个红心 ⇒ 整列重新解析 + 重新绑事件 ⇒ 滚动位置**自然丢**
 *        （滚动容器内容被整体换掉，`scrollTop` 会回到新内容顶部 —— 而界面看起来「刷了一下」）；
 *     ③ **没有增量分页**：全部内容一次进 DOM，没有「先 30 条、滚到底再 30 条」。
 *   已有搜索分片（`global-search-engine`）治的是**检索**，不治渲染 —— 两者不同面。
 *
 * 【本模块只做三件事（不新建性能监控平台、不做虚拟列表库）】
 *   ① **窗口切片**：`windowOf(notes, {cursor, pageSize, loaded})` 产出**本次该渲染哪一段**
 *      —— 纯函数，不碰 DOM；
 *   ② **局部更新的判据**：`patchOf(before, after)` 把「整列重建」压成「哪几条变了」
 *      —— 点赞只改一条时，返回的 `changed` 就恰一条（上层据此只改那一张卡）；
 *   ③ **态保留读数**：`keepState()` 说明「滚动 / 展开 / 已加载窗口」里哪些被保住了 ——
 *      **看不见回报时「保留」与「被静默重置」同形**（本仓反复治理的这一类）。
 *
 * 【刻意不做的事（边界，逐条对齐计划原文）】
 *   · **不做新性能监控平台**：本模块是纯函数，不埋点、不上报、不依赖任何时序 API；
 *   · **不做虚拟列表**：不做「只渲染视口内 n 条」那种位移补偿（它要测真实滚动几何，
 *     无头环境测不到，宣称了也没人证明）——本模块做的是**窗口 + 增量追加 + 局部更新**；
 *   · **不宣称实测流畅**：真浏览器下的长任务 / 首屏读数由探针记录，未测不写进结论；
 *   · **不改既有排序与分片口径**：排序仍归既有引擎，本模块只切窗口。
 * ========================================================= */
'use strict';
/* [v3.98.0 - R3-O5] 数值读数一律走**全仓唯一实现**（config/num-gate.js）——
 *   自写 Number.isFinite(Number(x)) 是弱口径签名（null / '' / [] / true 都会穿过判定），
 *   本仓的 weak-coercion 门会当场红灯。 */
import { numOrNull } from './num-gate.js';
/** 恒定键面（读者不必再判 undefined）。 */
function emptyWindow(size) {
    return {
        ok: false,
        start: 0, end: 0, pageSize: size,
        items: [], added: [], appended: false,
        cursor: 0, loaded: 0, total: 0, hasMore: false,
        reason: ''
    };
}
/** 页长：正数才收（**0 / 负数 / 非数不是「不限」**，是判不了）。 */
export function normalizePageSize(raw, fallback) {
    const fbRaw = numOrNull(fallback);
    const fb = (fbRaw !== null && fbRaw > 0) ? Math.floor(fbRaw) : 30;
    const n = numOrNull(raw);
    if (n === null || n <= 0) return fb;
    return Math.min(200, Math.floor(n));
}
/**
 * 窗口切片（**纯函数**）。
 *   `loaded` = 本会话已渲染过的条数（增量追加的游标）；不传则按 `start + pageSize`。
 *   ★ 三态分开：`items`（本次该渲染的段）/ `added`（相对 loaded 新追加的段）/ `hasMore`
 *     （后面还有没有）—— 「没有了」与「还没请求」不得同形。
 *
 * @returns {{ok:boolean, start:number, end:number, pageSize:number, items:Array,
 *            added:Array, appended:boolean, cursor:number, loaded:number, total:number,
 *            hasMore:boolean, reason:string}}
 */
export function windowOf(notes, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const size = normalizePageSize(o.pageSize, 30);
    const out = emptyWindow(size);
    if (!Array.isArray(notes)) {
        out.reason = 'notes-not-array（拿不到列表 ⇒ 判不了，不是空列表）';
        return out;
    }
    out.ok = true;
    out.total = notes.length;
    const ld = numOrNull(o.loaded);
    const wantLoaded = (ld === null) ? null : Math.max(0, Math.floor(ld));
    const prev = (wantLoaded === null) ? 0 : Math.min(wantLoaded, notes.length);
    const next = Math.min(prev + size, notes.length);
    out.loaded = next;
    out.start = 0;
    out.end = next;
    out.items = notes.slice(0, next);
    out.added = notes.slice(prev, next);
    out.appended = prev > 0 && out.added.length > 0;
    out.cursor = next;
    out.hasMore = next < notes.length;
    out.reason = notes.length === 0 ? 'empty-list（列表真的是空的）'
        : (out.hasMore ? 'has-more' : 'exhausted（已到末尾）');
    return out;
}
/**
 * 局部更新的判据（**纯函数**）。
 *   给定「上一次渲染的条目视图」与「现在的」，算出：
 *     · `changed`   —— 需要**就地更新**的条目（同 id、视图字段有变）；
 *     · `addedIds`  —— 新增（增量追加用）；
 *     · `removedIds`—— 删掉的；
 *     · `structural`—— 是否**必须整列重建**（顺序变了 / 有增删 ⇒ 瀑布流布局本来就变）。
 *   ★ 只有「顺序不变、无增删、只有若干条字段变了」时才 `structural:false` ——
 *     这正是「点赞不重建整列」的判据；其余情形如实报需要重建，**不硬撑局部更新**。
 */
export function patchOf(before, after) {
    const a = Array.isArray(before) ? before : null;
    const b = Array.isArray(after) ? after : null;
    const out = { ok: false, changed: [], addedIds: [], removedIds: [], structural: true, reason: '' };
    if (!a || !b) { out.reason = 'inputs-not-array（拿不到两侧视图 ⇒ 判不了，按整列重建处理）'; return out; }
    out.ok = true;
    const keyOf = (x) => String((x && (x.id !== undefined ? x.id : x.ref)) === undefined ? '' : (x && (x.id !== undefined ? x.id : x.ref)));
    const idsA = a.map(keyOf);
    const idsB = b.map(keyOf);
    const setA = new Set(idsA);
    const setB = new Set(idsB);
    out.addedIds = idsB.filter((id) => !setA.has(id));
    out.removedIds = idsA.filter((id) => !setB.has(id));
    /* 顺序：只在共同 id 上比（增删本身就会改变长度，不当作「顺序变了」重复计）。 */
    const commonA = idsA.filter((id) => setB.has(id));
    const commonB = idsB.filter((id) => setA.has(id));
    const orderChanged = commonA.join('\u0000') !== commonB.join('\u0000');
    for (let i = 0; i < b.length; i++) {
        const item = b[i];
        const id = idsB[i];
        const prev = a.filter((x) => keyOf(x) === id)[0];
        if (!prev) continue;
        if (JSON.stringify(prev) !== JSON.stringify(item)) {
            out.changed.push({ id: id, before: prev, after: item, fields: diffFields(prev, item) });
        }
    }
    out.structural = orderChanged || out.addedIds.length > 0 || out.removedIds.length > 0;
    out.reason = out.structural
        ? (orderChanged ? 'order-changed（顺序变了 ⇒ 满水布局本来就变）'
            : (out.addedIds.length ? 'items-added（有新增）' : 'items-removed（有删除）'))
        : (out.changed.length ? 'in-place-only（只有若干条字段变了 ⇒ 可只改那几张卡）' : 'no-change');
    return out;
}
/** 两侧条目哪些字段真的变了（供上报与诊断；**不改不报**）。 */
export function diffFields(before, after) {
    const a = (before && typeof before === 'object') ? before : {};
    const b = (after && typeof after === 'object') ? after : {};
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    const out = [];
    for (const k of keys) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ field: k, from: a[k], to: b[k] });
    }
    return out;
}
/**
 * 态保留读数（**不做保留动作**，只如实报哪些被保住）。
 *   ★ 「保住了」与「没保」必须可分辨：上层把本读数写进诊断面即可，不需要自己再维护一份台账。
 */
export function keepState(before, after) {
    const a = (before && typeof before === 'object') ? before : {};
    const b = (after && typeof after === 'object') ? after : {};
    const fields = ['scrollTop', 'loaded', 'expandedIds', 'activeTab'];
    const kept = [];
    const lost = [];
    for (const f of fields) {
        const hasA = Object.prototype.hasOwnProperty.call(a, f);
        const hasB = Object.prototype.hasOwnProperty.call(b, f);
        if (!hasA) { lost.push({ field: f, why: 'before-missing（本来就没记 ⇒ 不是「被重置」）' }); continue; }
        if (!hasB) { lost.push({ field: f, why: 'after-missing（没回写 ⇒ 重开即丢）' }); continue; }
        if (JSON.stringify(a[f]) === JSON.stringify(b[f])) kept.push(f);
        else lost.push({ field: f, why: 'value-changed（值与之前不同）' });
    }
    return { kept: kept, lost: lost, allKept: lost.length === 0 };
}
/** 诊断一行（纯字符串，不抛）。三态分开写。 */
export function line(w) {
    try {
        const x = w || {};
        if (!x.ok) return '列表窗口 —（' + (x.reason || '判不了') + '）';
        return '列表窗口 ' + x.loaded + '/' + x.total + ' 条 · 本次 ' + x.items.length
            + (x.appended ? ' · 追加 ' + x.added.length : ' · 首屏')
            + (x.hasMore ? ' · 还有' : ' · 已到末尾');
    } catch (_e) { return '—（列表窗口异常）'; }
}
export default { normalizePageSize, windowOf, patchOf, diffFields, keepState, line };
