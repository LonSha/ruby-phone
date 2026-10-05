/* ========================================================
 * lexiscore-data.js — [v3.50.0] 词法评分案头 · 纯函数内核
 *
 * 源是 EPhone·xINOVO 向量记忆（vector_memory.js 1849 行 / 80 函数）的**词法兜底通道**：
 * 网络嵌入（fetchEmbeddings / cosineSimilarity 走 API）一律不缝 —— 本件只取
 * Core 缺席时的纯词法评分：query 切词（空白与中西部标点分隔、长度 ≥2）、
 * 命中比基础分、置顶加成、权重加成、宽容线（threshold × 0.45 与 0.05 取大）、
 * 排序三键（置顶 → 分数 → 更新时刻）与 topK 截取。
 *
 * 与仓内召回台的裁定差：recall 是 BM25 三档（IDF 加权的文档级检索），
 * 本件是逐条目轻量 token 命中兜底（pinned / weight 加成族），机制族不同，并存不撞。
 * ======================================================== */
'use strict';
/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前自带的那份 `numOrNull` 只给 `number` 放行、其余一律 `Number(v)` ——
 *   `''` / `'  '` / `[]` / `null` / `false` 全被读成 0、`true` 读成 1、`[5]` 读成 5。
 *   0 在权重与阈值面上是**合法读数**，故「没给」与「给了 0」必须分得开。 */
import { numOrNull } from '../../config/num-gate.js';
/* 本件对外仍导出同名入口（下游 -app.js 照旧 `import { numOrNull }`），不做第二份实现。 */
export { numOrNull };
export const LS_TOKEN_MIN = 2;
export const LS_PINNED_BONUS = 0.35;
export const LS_WEIGHT_STEP = 0.08;
export const LS_FLOOR = 0.05;
export const LS_DEFAULT_TOP_K = 6;
export const LS_DEFAULT_THRESHOLD = 0.3;
export const LS_LEDGER_MAX = 120;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* 切词（源 tokens 一族）：分隔符是空白 / 中西标点（逐字符判，不用正则）。 */
const SEPS = ' ,。！？!?:：、;；' + String.fromCharCode(9) + String.fromCharCode(10) + String.fromCharCode(13);
export function tokenize(queryText) {
    const src = toStr(queryText).toLowerCase();
    const out = [];
    let cur = '';
    for (let i = 0; i < src.length; i++) {
        const ch = src.charAt(i);
        if (SEPS.indexOf(ch) >= 0) { if (cur) out.push(cur); cur = ''; }
        else cur += ch;
    }
    if (cur) out.push(cur);
    return out.filter(function (t) { return t.length >= LS_TOKEN_MIN; });
}

/* 词条干草堆：标题 + 正文 + 标签（源 haystack 口径）。 */
export function haystackOf(entry) {
    const e = isPlain(entry) ? entry : {};
    const tags = listOf(e.tags).map(toStr).join(' ');
    return (toStr(e.title) + ' ' + toStr(e.text) + ' ' + tags).toLowerCase();
}

/* 评分（源 computeLexicalScore 的 fallback 支）：命中比 + 置顶 + 权重，上限 1。 */
export function lexicalScore(entry, queryText) {
    const e = isPlain(entry) ? entry : {};
    const hay = haystackOf(entry);
    const tokens = tokenize(queryText);
    if (!tokens.length) return e.pinned ? 1 : 0;
    let hits = 0;
    for (const t of tokens) if (hay.indexOf(t) >= 0) hits++;
    const base = hits / tokens.length;
    const weight = (numOrNull(e.weight) || 1) - 1;
    return Math.min(1, base + (e.pinned ? LS_PINNED_BONUS : 0) + Math.max(0, weight) * LS_WEIGHT_STEP);
}

/* 兜底选取（源 selectFallbackEntries）：宽容线 + 排序三键 + topK。 */
export function selectEntries(entries, queryText, opts) {
    const o = isPlain(opts) ? opts : {};
    const topK = Math.max(1, numOrNull(o.topK) || LS_DEFAULT_TOP_K);
    const threshold = (numOrNull(o.threshold) !== null) ? numOrNull(o.threshold) : LS_DEFAULT_THRESHOLD;
    const lines = Math.max(LS_FLOOR, threshold * 0.45);
    return listOf(entries)
        .map(function (entry) {
            const score = lexicalScore(entry, queryText);
            return { entry: entry, score: score, pinned: !!(entry && entry.pinned), mode: 'lexical' };
        })
        .filter(function (row) { return row.pinned || row.score >= lines; })
        .sort(function (a, b) {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            if (b.score !== a.score) return b.score - a.score;
            return (numOrNull(b.entry && b.entry.updatedAt) || 0) - (numOrNull(a.entry && a.entry.updatedAt) || 0);
        })
        .slice(0, topK);
}
/* 词条归一：id / 标题 / 正文 / 标签 / 置顶 / 权重（源 entry 一族的纯面）。 */
export function normalizeEntry(raw, index) {
    const r = isPlain(raw) ? raw : {};
    const id = toStr(r.id);
    if (!id && !toStr(r.text)) return { entry: null, why: 'bad_entry' };
    return {
        entry: {
            id: id || ('ls_en_' + String(index + 1)),
            title: toStr(r.title),
            text: toStr(r.text),
            tags: listOf(r.tags).map(toStr).filter(Boolean),
            pinned: r.pinned === true,
            weight: (numOrNull(r.weight) !== null) ? numOrNull(r.weight) : 1,
            updatedAt: numOrNull(r.updatedAt) || 0
        },
        why: ''
    };
}