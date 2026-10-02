/* ========================================================
 * freehome-data.js — [v3.50.0] 自由桌面布局案头 · 纯函数内核
 *
 * 源是 EPhone·xINOVO 自由主屏幕（free-home.js 1558 行 / 70 函数）的**布局治理一族**：
 * 4×4 网格占位（面积 / 占位标记 / 首个空位 / 位置合法性与装配可行性两套门）、
 * 条目形状（app / folder≥2 / widget 三型与 wide 4x2·square 2x2·cells 查表）、
 * id 全局唯一、页数 30 上限、页内 16 件上限、dock 只认在册件。
 *
 * 立场差：源满篇拖拽手势与 DOM 画布（pointer 与 ghost 与 sheet 全家桶），本件
 * 只做「这布局合不合法、这位置放不放得下、下一格在哪」的**判定与读数**；
 * 源把布局挂 db.freeHomeLayout，本件落两条会话键走 ^fh_ 前缀。
 * ======================================================== */
'use strict';

/* ---------- 真源常量 ---------- */
export const FH_GRID = 4;
export const FH_PAGE_MAX = 30;
export const FH_ITEMS_PER_PAGE_MAX = 16;
export const FH_LEDGER_MAX = 120;
export const FH_WIDGET_CELLS = Object.freeze({ custom: 4, clock: 8, photo: 4, note: 4, memory: 8, ins: 4 });

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function isInt(v) { return Number.isInteger(v); }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* ---------- 形状（源 cellCount / size）---------- */
export function sizeOf(item, widgetCells) {
    const tbl = isPlain(widgetCells) ? widgetCells : FH_WIDGET_CELLS;
    if (isPlain(item) && item.type === 'widget') {
        const cells = (item.size === 'wide') ? 8 : (item.size === 'square') ? 4 : (tbl[item.widget] || 4);
        return { width: (cells === 8) ? 4 : (cells === 4) ? 2 : 1, height: (cells === 1) ? 1 : 2 };
    }
    return { width: 1, height: 1 };
}

export function areaFree(cells, item, row, col, widgetCells) {
    const s = sizeOf(item, widgetCells);
    if (!isInt(row) || !isInt(col) || row < 0 || col < 0 || row + s.height > FH_GRID || col + s.width > FH_GRID) return false;
    for (let y = row; y < row + s.height; y++) for (let x = col; x < col + s.width; x++) if (cells[y][x]) return false;
    return true;
}

export function markArea(cells, item, row, col, widgetCells) {
    const s = sizeOf(item, widgetCells);
    for (let y = row; y < row + s.height; y++) for (let x = col; x < col + s.width; x++) cells[y][x] = true;
}

export function firstSpace(cells, item, widgetCells) {
    for (let row = 0; row < FH_GRID; row++) for (let col = 0; col < FH_GRID; col++) {
        if (areaFree(cells, item, row, col, widgetCells)) return { row: row, col: col };
    }
    return null;
}
/* ---------- 两套合法性门（源 validLayout / positionsValid / canFit）---------- */
/* 有显式 row/col 时逐件验位置；没有时按原序试装配（旧预设兼容，源同款口径）。 */
export function positionsValid(items, widgetCells) {
    const cells = [];
    for (let y = 0; y < FH_GRID; y++) { const rowArr = []; for (let x = 0; x < FH_GRID; x++) rowArr.push(false); cells.push(rowArr); }
    for (const item of listOf(items)) {
        if (!areaFree(cells, item, item.row, item.col, widgetCells)) return false;
        markArea(cells, item, item.row, item.col, widgetCells);
    }
    return true;
}

export function canFit(items, widgetCells) {
    const cells = [];
    for (let y = 0; y < FH_GRID; y++) { const rowArr = []; for (let x = 0; x < FH_GRID; x++) rowArr.push(false); cells.push(rowArr); }
    for (const item of listOf(items)) {
        const spot = firstSpace(cells, item, widgetCells);
        if (!spot) return false;
        markArea(cells, item, spot.row, spot.col, widgetCells);
    }
    return true;
}

/* 页内两套门二选一：全员有整数坐标走位置门，否则走装配门（源同款口径）。 */
export function pageFits(items, widgetCells) {
    const arr = listOf(items);
    const allPlaced = arr.every(function (item) { return item && isInt(item.row) && isInt(item.col); });
    return allPlaced ? positionsValid(arr, widgetCells) : canFit(arr, widgetCells);
}

/* 整布局校验（源 validLayout 逐条对齐，认不出的逐因报出而不是布尔一票否决）。 */
export function layoutProblems(layout, opts) {
    const o = isPlain(opts) ? opts : {};
    const appIds = isPlain(o.appIds) ? o.appIds : null;
    const widgetCells = isPlain(o.widgetCells) ? o.widgetCells : FH_WIDGET_CELLS;
    const bad = [];
    if (!isPlain(layout) || !Array.isArray(layout.pages) || !layout.pages.length) return ['bad_shape'];
    if (layout.pages.length > FH_PAGE_MAX) bad.push('too_many_pages');
    const dock = listOf(layout.dock);
    for (const d of dock) if (!o.dockIds || listOf(o.dockIds).indexOf(d) < 0) bad.push('dock_unknown');
    const seen = {};
    for (let pi = 0; pi < layout.pages.length; pi++) {
        const page = layout.pages[pi];
        if (!isPlain(page) || !Array.isArray(page.items) || !toStr(page.id)) { bad.push('bad_shape'); continue; }
        if (page.items.length > FH_ITEMS_PER_PAGE_MAX) bad.push('page_overflow_' + toStr(page.id));
        for (const item of page.items) {
            if (!isPlain(item) || !toStr(item.id)) { bad.push('bad_shape'); continue; }
            if (seen[item.id]) bad.push('dup_id_' + item.id);
            seen[item.id] = true;
            if (item.type === 'app') { if (appIds && listOf(appIds).indexOf(item.appId) < 0) bad.push('unknown_app_' + toStr(item.appId)); }
            else if (item.type === 'folder') {
                if (!Array.isArray(item.apps) || item.apps.length < 2) bad.push('folder_too_small_' + item.id);
                else if (appIds) for (const a of item.apps) if (listOf(appIds).indexOf(a) < 0) bad.push('unknown_app_' + toStr(a));
            } else if (item.type === 'widget') { if (!widgetCells[item.widget]) bad.push('unknown_widget_' + toStr(item.widget)); }
            else bad.push('bad_shape');
        }
        if (!pageFits(page.items, widgetCells)) bad.push('no_room_' + toStr(page.id));
    }
    return bad;
}
/* 归一（本件自定护栏）：页裁到 30、页内裁到 16，只报不截之外的兜底。 */
export function normalizeLayout(raw) {
    const out = { layout: null, notes: [] };
    if (!isPlain(raw) || !Array.isArray(raw.pages)) { out.notes.push('bad_shape'); return out; }
    const pagesCap = trimRows(raw.pages, FH_PAGE_MAX);
    if (pagesCap.dropped > 0) out.notes.push('pages_overflow_' + String(pagesCap.dropped));
    const pages = pagesCap.rows.map(function (page, pi) {
        const p = isPlain(page) ? page : {};
        const itemsCap = trimRows(listOf(p.items), FH_ITEMS_PER_PAGE_MAX);
        if (itemsCap.dropped > 0) out.notes.push('page_' + String(pi) + '_items_overflow_' + String(itemsCap.dropped));
        return { id: toStr(p.id) || ('fh_page_' + String(pi + 1)), items: itemsCap.rows };
    });
    out.layout = { pages: pages, dock: listOf(raw.dock).map(toStr).filter(Boolean) };
    return out;
}

/* 读数面：形状计数与页数余量。 */
export function readingsOf(layout, widgetCells) {
    const l = (isPlain(layout) && Array.isArray(layout.pages)) ? layout : { pages: [], dock: [] };
    let apps = 0; let folders = 0; let widgets = 0;
    for (const page of l.pages) for (const item of listOf(page.items)) {
        if (item && item.type === 'app') apps++;
        else if (item && item.type === 'folder') folders++;
        else if (item && item.type === 'widget') widgets++;
    }
    return {
        pages: l.pages.length,
        pagesLeft: FH_PAGE_MAX - l.pages.length,
        apps: apps, folders: folders, widgets: widgets,
        dock: listOf(l.dock).length
    };
}