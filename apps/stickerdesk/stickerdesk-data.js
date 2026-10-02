/* ========================================================
 * stickerdesk-data.js — [v3.50.0] 表情包册案头 · 纯函数内核
 *
 * 源是 EPhone·xINOVO 表情包管理（sticker.js 1499 行）的**解析与治理一族**：
 * 宽泛格式单行解析（名称:URL，全半角分隔符与尾部标点剥离）、整段解析逐行
 * 去重（URL 幂等）、分类册（重命名 / 移动 / 解散逐因拒）、AI 识别与出图
 * 两块一律不缝 —— 本件只做「这段文本能收出几张、谁重了、分类里有什么」的读数。
 * ======================================================== */
'use strict';

export const SD_STICKERS_MAX = 1000;
export const SD_NAME_MAX = 60;
export const SD_LEDGER_MAX = 120;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* URL 门（源 safeImage 同款口径收窄到 http(s)）：只认 http:// 与 https://。 */
export function isHttpUrl(s) {
    const v = toStr(s);
    return (v.indexOf('http://') === 0 || v.indexOf('https://') === 0);
}

/* 尾部标点剥离（源 replace(/[.,;:：，、]+$/, '') 的逐字符版）。 */
const TRAILING = ['.', ',', ';', ':', '：', '，', '、'];
function stripTrailing(s) {
    let out = toStr(s);
    while (out.length && TRAILING.indexOf(out.charAt(out.length - 1)) >= 0) out = out.slice(0, -1);
    return out;
}

/* 行切分（CRLF / LF）。 */
function lineSplit(s) {
    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch === LF) { out.push(cur); cur = ''; }
        else if (ch === CR && s.charAt(i + 1) === LF) { i++; out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}
/* ---------- 宽泛格式解析（源 parseStickerLine / parseStickerText）---------- */
/* 支持名称:URL / 名称：URL / 名称 URL / 名称URL：URL 之前是名称（剥尾部分隔符）。 */
export function parseStickerLine(line) {
    const trimmed = toStr(line).trim();
    if (!trimmed) return null;
    if (trimmed.charAt(0) === '#' || trimmed.indexOf('//') === 0) return null;
    const httpIdx = trimmed.indexOf('http://');
    const httpsIdx = trimmed.indexOf('https://');
    let urlIdx = -1;
    if (httpIdx >= 0 && httpsIdx >= 0) urlIdx = (httpIdx < httpsIdx) ? httpIdx : httpsIdx;
    else if (httpIdx >= 0) urlIdx = httpIdx;
    else if (httpsIdx >= 0) urlIdx = httpsIdx;
    if (urlIdx < 0) return null;
    /* URL 终点：其后第一个空白。 */
    let urlEnd = trimmed.length;
    for (let i = urlIdx; i < trimmed.length; i++) {
        const ch = trimmed.charAt(i);
        if (ch === ' ' || ch === String.fromCharCode(9)) { urlEnd = i; break; }
    }
    let url = stripTrailing(trimmed.slice(urlIdx, urlEnd));
    if (!isHttpUrl(url)) return null;
    let name = trimmed.substring(0, urlIdx).trim();
    while (name.length && TRAILING.indexOf(name.charAt(name.length - 1)) >= 0) name = name.slice(0, -1);
    name = name.trim();
    if (!name) return null;
    if (name.length > SD_NAME_MAX) name = name.slice(0, SD_NAME_MAX);
    return { name: name, url: url };
}

/* 整段解析：逐行收，URL 幂等去重（seen 幂等表），坏行与重行逐条报。 */
export function parseStickerText(text, existingUrls) {
    const out = { stickers: [], rejected: [], notes: [] };
    const seen = {};
    for (const u of listOf(existingUrls)) seen[u] = true;
    const lines = lineSplit(toStr(text));
    let lineNo = 0;
    for (const line of lines) {
        lineNo++;
        const item = parseStickerLine(line);
        if (!item) {
            if (toStr(line).trim() && toStr(line).trim().charAt(0) !== '#') out.rejected.push({ line: lineNo, why: 'bad_line' });
            continue;
        }
        if (seen[item.url]) { out.rejected.push({ line: lineNo, why: 'dup_url', name: item.name }); continue; }
        seen[item.url] = true;
        out.stickers.push(item);
    }
    const capped = trimRows(out.stickers, SD_STICKERS_MAX);
    out.stickers = capped.rows;
    if (capped.dropped > 0) out.notes.push('stickers_overflow_' + String(capped.dropped));
    return out;
}

/* ---------- 分类册（源 category manage 一族的纯面）---------- */
export function normalizeCategory(raw, index) {
    const r = isPlain(raw) ? raw : {};
    return { id: toStr(r.id) || ('sd_cat_' + String(index + 1)), name: toStr(r.name) || ('分类' + String(index + 1)) };
}

export function normalizeSticker(raw, index) {
    const r = isPlain(raw) ? raw : {};
    const url = toStr(r.url);
    if (!isHttpUrl(url)) return { sticker: null, why: 'bad_url' };
    return {
        sticker: {
            id: toStr(r.id) || ('sd_st_' + String(index + 1)),
            name: toStr(r.name).slice(0, SD_NAME_MAX) || '未命名',
            url: url,
            categoryId: toStr(r.categoryId) || '',
            desc: toStr(r.desc)
        },
        why: ''
    };
}
/* 分类守门：重命名 / 移动 / 解散逐因拒（源 sc-rename / move / dissolve 一族）。 */
export function renameCategory(categories, categoryId, newName) {
    const name = toStr(newName).trim();
    if (!name) return { ok: false, why: 'bad_name' };
    if (!listOf(categories).some(function (c) { return c && c.id === categoryId; })) return { ok: false, why: 'unknown_category' }; /* 不在册的分类不许改名 */
    if (listOf(categories).some(function (c) { return c && c.name === name && c.id !== categoryId; })) return { ok: false, why: 'category_exists' };
    return { ok: true, why: '', name: name.slice(0, SD_NAME_MAX) };
}

export function dissolveCategory(categories, stickers, categoryId) {
    const exists = listOf(categories).some(function (c) { return c && c.id === categoryId; });
    if (!exists) return { ok: false, why: 'unknown_category' };
    const holding = listOf(stickers).filter(function (s) { return s && s.categoryId === categoryId; }).length;
    if (holding > 0) return { ok: false, why: 'category_not_empty', holding: holding };
    return { ok: true, why: '' };
}

export function moveStickers(stickers, ids, targetCategoryId, categories) {
    const known = {};
    for (const c of listOf(categories)) known[c && c.id] = true;
    if (targetCategoryId && !known[targetCategoryId]) return { ok: false, why: 'unknown_category', moved: 0 };
    let moved = 0;
    const out = listOf(stickers).map(function (s) {
        if (s && listOf(ids).indexOf(s.id) >= 0) { moved++; return Object.assign({}, s, { categoryId: targetCategoryId || '' }); }
        return s;
    });
    return { ok: true, why: '', moved: moved, stickers: out };
}

/* 读数面：分类计数与未分类数。 */
export function readingsOf(stickers, categories) {
    const st = listOf(stickers);
    let uncategorized = 0;
    for (const s of st) if (!s || !s.categoryId) uncategorized++;
    return {
        stickers: st.length,
        categories: listOf(categories).length,
        uncategorized: uncategorized,
        stickersLeft: SD_STICKERS_MAX - st.length
    };
}