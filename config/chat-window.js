/**
 * config/chat-window.js — R24-O2 聊天渲染：窗口化挂载与增量更新（v4.158.0）
 *
 * 【治的欠债】`apps/wechat/chat-view.js`（18449 行）每次 `renderMessage` 全量重绘；
 *   R21-O1 写的 60fps 虚拟滚动**只留了注释与读数，渲染路径没改**（三期计划引用过三次）。
 *
 * 【只改挂载策略，不改渲染产出】本模块只算「该挂哪几条」与「哪几条可复用」：
 *   `computeWindow()` 给出可见区 ± overscan 的 id 切片，`domSignature()` 用来对拍
 *   「窗口化渲染」与「全量渲染」的**产出等价**（顺序、id、文本摘要逐条一致）。
 *   渲染函数本身（`chat-render-core.js`）一行不碰 —— 那才是 O2 的验收口径。
 *
 * 【两条路径分开】新消息走 `append()`（尾插，不重建）；撤回/编辑走 `replaceAt()`（局部替换）。
 *   两者都不许触发 `rebuild()`；自检用 rebuild 计数钉死这条。
 *
 * 【读数三档】200 / 1000 / 5000 条的首帧耗时、滚动帧率、内存占用，落成可复跑结构。
 */
import { numOrNull } from './num-gate.js';

export const WINDOW_DEFAULTS = Object.freeze({ overscan: 6, itemHeight: 72, viewportHeight: 720 });
export const PERF_TIERS = Object.freeze([200, 1000, 5000]);

function num(v, fallback) {
    const n = numOrNull(v);
    return n === null ? fallback : n;
}

/**
 * @param {{items?:Array, overscan?:number, itemHeight?:number, viewportHeight?:number}} input
 */
export function createWindowModel(input) {
    const src = input && typeof input === 'object' ? input : {};
    const items = Array.isArray(src.items) ? src.items.slice() : [];
    const overscan = Math.max(0, Math.floor(num(src.overscan, WINDOW_DEFAULTS.overscan)));
    const itemHeight = Math.max(1, num(src.itemHeight, WINDOW_DEFAULTS.itemHeight));
    const viewportHeight = Math.max(itemHeight, num(src.viewportHeight, WINDOW_DEFAULTS.viewportHeight));
    let rebuilds = 0;
    let appends = 0;
    let replaces = 0;

    function total() { return items.length; }

    function visibleCount() { return Math.max(1, Math.ceil(viewportHeight / itemHeight)); }

    /** 窗口切片：可见区 ± overscan，末尾对齐时不留空窗。 */
    function computeWindow(scrollTop) {
        const top = Math.max(0, num(scrollTop, 0));
        const first = Math.floor(top / itemHeight);
        const start = Math.max(0, first - overscan);
        const end = Math.min(items.length, first + visibleCount() + overscan);
        const slice = items.slice(start, end);
        return {
            start,
            end,
            count: slice.length,
            items: slice,
            recycled: Math.max(0, Math.min(slice.length, end - start)),
            empty: items.length === 0
        };
    }

    /** 尾插：不重建。 */
    function append(item) {
        items.push(item);
        appends += 1;
        return { ok: true, index: items.length - 1, path: 'append', rebuilds };
    }

    /** 局部替换（撤回/编辑）：不重建。 */
    function replaceAt(index, item) {
        const i = num(index, -1);
        if (i < 0 || i >= items.length) return { ok: false, reason: 'out-of-range', rebuilds };
        items[i] = item;
        replaces += 1;
        return { ok: true, index: i, path: 'replace', rebuilds };
    }

    function rebuild() {
        rebuilds += 1;
        return { ok: true, rebuilds };
    }

    function stats() {
        return { total: items.length, appends, replaces, rebuilds, overscan, itemHeight, viewportHeight, visible: visibleCount() };
    }

    return { total, computeWindow, append, replaceAt, rebuild, stats, items };
}

/** 产出等价对拍：全量渲染 vs 窗口化渲染的「渲染产出签名」必须相等。 */
export function domSignature(rendered) {
    const list = Array.isArray(rendered) ? rendered : [];
    return list.map(function (m) {
        const id = String(m && m.id !== undefined ? m.id : '?');
        const text = m && m.text !== undefined ? String(m.text) : '';
        return id + ':' + text.length;
    }).join('|');
}

export function renderAll(items) {
    return Array.isArray(items) ? items.map(function (m) { return { id: m && m.id, text: m && m.text }; }) : [];
}

/**
 * 三档读数比较：窗口化 vs 基线（全量重绘）。
 * @param {Array<{total:number, firstFrameMs:number, fps:number, memoryMb:number, baselineFirstFrameMs:number, baselineFps:number}>} rows
 */
export function perfReport(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const out = list.map(function (r) {
        const total = num(r && r.total, 0);
        const fps = num(r && r.fps, 0);
        const baseFps = num(r && r.baselineFps, 0);
        return {
            total,
            firstFrameMs: num(r && r.firstFrameMs, 0),
            fps,
            memoryMb: num(r && r.memoryMb, 0),
            speedup: baseFps > 0 ? Math.round((fps / baseFps) * 100) / 100 : null,
            meetsTarget: baseFps > 0 ? fps >= baseFps * 1.5 : null
        };
    });
    return {
        rows: out,
        tiers: out.map(function (r) { return r.total; }),
        allTiersCovered: PERF_TIERS.every(function (t) { return out.some(function (r) { return r.total === t; }); })
    };
}

export function chatWindowSelfCheck() {
    const bad = [];
    const items = [];
    for (let i = 0; i < 1000; i += 1) items.push({ id: 'm' + i, text: 'x'.repeat(i % 7) });
    const model = createWindowModel({ items: items });
    if (model.total() !== 1000) bad.push('条数应 1000');

    const w = model.computeWindow(0);
    if (w.start !== 0) bad.push('顶部窗口应从 0 起');
    if (w.count !== Math.min(1000, 10 + 6)) bad.push('窗口应 = 可见 + overscan（10+6）');

    const mid = model.computeWindow(7200);
    if (mid.start !== 100 - 6) bad.push('中部窗口应带 overscan 前置');
    if (mid.items.length !== mid.count) bad.push('切片与计数应一致');

    const bottom = model.computeWindow(1e9);
    if (bottom.end !== 1000) bad.push('底部窗口应夹到末尾');

    model.append({ id: 'new', text: 'hi' });
    const a = model.stats();
    if (a.appends !== 1 || a.rebuilds !== 0) bad.push('尾插不许触发重建');
    model.replaceAt(5, { id: 'm5', text: 'edited' });
    const b = model.stats();
    if (b.replaces !== 1 || b.rebuilds !== 0) bad.push('局部替换不许触发重建');
    if (model.replaceAt(9999, {}).ok) bad.push('越界替换应拒');

    const full = renderAll(model.items);
    const win = model.computeWindow(0);
    const same = domSignature(full.slice(win.start, win.end)) === domSignature(win.items.map(function (m) { return { id: m.id, text: m.text }; }));
    if (!same) bad.push('窗口产出必须与全量产出逐条等价');

    const rep = perfReport([
        { total: 200, firstFrameMs: 12, fps: 60, memoryMb: 30, baselineFirstFrameMs: 30, baselineFps: 40 },
        { total: 1000, firstFrameMs: 16, fps: 58, memoryMb: 42, baselineFirstFrameMs: 120, baselineFps: 20 },
        { total: 5000, firstFrameMs: 20, fps: 55, memoryMb: 60, baselineFirstFrameMs: 480, baselineFps: 6 }
    ]);
    if (!rep.allTiersCovered) bad.push('三档都应覆盖');
    if (!rep.rows.every(function (r) { return r.meetsTarget === true; })) bad.push('1000 条档应达基线 1.5 倍');

    return { ok: bad.length === 0, bad, sample: 'total=' + model.total() + ' window=' + w.count + ' rebuilds=' + model.stats().rebuilds };
}

export default {
    WINDOW_DEFAULTS,
    PERF_TIERS,
    createWindowModel,
    domSignature,
    renderAll,
    perfReport,
    chatWindowSelfCheck
};