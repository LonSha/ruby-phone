/* ========================================================
 * summdesk-data.js — [v3.52.0] 总结案头 · 纯函数内核
 *
 * 源是 Kawaii 主题包总结引擎（05 base.js 2869 行）的**格式归一与游标一族**：
 * ① 总结文本解析：标题六形（【标题】/标题:/标题：/加粗标题/# 标题/裸标题）与
 *    正文四形（【正文】/正文:/正文：/加粗正文）、无正文时剥离标题行、无标题时
 *    首非空行截 15 字加省略号、终回退「记忆碎片」、引号剥离、标题组装（标题-条数-日期）；
 * ② 双通道自动总结游标：普通/vector 与 true 向量两套独立游标（chunk×间隔推算
 *    初始位、超长收口、成批循环、失败回滚到批次起点）。
 *
 * 立场差：源的 generateVectorSummary 是发请求的那个人（fetch + 双 provider），
 * 本件零网络 —— 用户把任何对话端生成的总结文本贴回来，本件只做解析归一与
 * 游标读数；会话键走 ^sm_ 前缀随会话隔离。
 * ======================================================== */
'use strict';

/* [v3.57.0·O3] 数值取值走**全仓唯一实现**（`config/num-gate.js`）。
 *   本件此前自带的那份 `numOrNull` 只给 `number` 放行、其余一律 `Number(v)` ——
 *   游标与时间戳面上的 0 是**合法读数**，与「没给」必须分得开。 */
import { numOrNull } from '../../config/num-gate.js';
/* 本件对外仍导出同名入口（下游 -app.js 照旧 `import { numOrNull }`），不做第二份实现。 */
export { numOrNull };

export const SM_TITLE_MAX = 15;
export const SM_ELLIPSIS = '...';
export const SM_FALLBACK_TITLE = '记忆碎片';
export const SM_MEMORIES_MAX = 500;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}
/* ---------- 总结文本解析（源 generateVectorSummary 的标题正文抽取段）---------- */
/* 标题标记六形与正文标记四形（逐字面匹配，不用正则）。 */
const TITLE_MARKS = ['【标题】', '标题:', '标题：', '**标题**', '# 标题', '标题'];
const CONTENT_MARKS = ['【正文】', '正文:', '正文：', '**正文**'];
const STRIP_QUOTES = [String.fromCharCode(34), String.fromCharCode(39)];

function stripQuoteChars(s) {
    let out = toStr(s);
    for (const q of STRIP_QUOTES) out = out.split(q).join('');
    return out.trim();
}

function stripAllMarks(s) {
    let out = toStr(s);
    for (const m of ['【标题】', '【正文】']) out = out.split(m).join('');
    return out;
}

function findMark(text, marks) {
    /* 最长优先（【标题】先于裸'标题'，防'标题：'被裸标记抢先截断）。 */
    let best = -1; let bestLen = 0; let bestMark = '';
    for (const mk of marks) {
        const i = text.indexOf(mk);
        if (i >= 0 && (best < 0 || mk.length > bestLen)) { best = i; bestLen = mk.length; bestMark = mk; }
    }
    return best >= 0 ? { at: best, mark: bestMark } : null;
}

/* 行内取标题：标记后到行尾，剥其余标记与引号。 */
function inlineValue(text, hit) {
    let line = text.slice(hit.at + hit.mark.length);
    const nl = line.indexOf(String.fromCharCode(10));
    if (nl >= 0) line = line.slice(0, nl);
    return stripQuoteChars(stripAllMarks(line));
}

/* 解析总结文本（源 title/content 抽取逐支对齐 + 静默失效显式化）：
 *   有标题无正文标记 → 正文=剥离标题行后的剩余；
 *   无标题 → 首个非空行截 15 字（超出加省略号）；
 *   全空 → 回退「记忆碎片」。 */
export function parseSummaryText(rawText) {
    const text = toStr(rawText).trim();
    const notes = [];
    if (!text) return { title: SM_FALLBACK_TITLE, content: '', notes: ['empty'] };
    const tHit = findMark(text, TITLE_MARKS);
    const cHit = findMark(text, CONTENT_MARKS);
    let title = '';
    let content = text;
    if (tHit) {
        title = inlineValue(text, tHit);
        const cStart = tHit.at + text.slice(tHit.at).indexOf(String.fromCharCode(10));
        content = (cStart > tHit.at) ? text.slice(cStart).trim() : '';
    }
    if (cHit) {
        content = text.slice(cHit.at + cHit.mark.length).trim();
    } else if (tHit) {
        notes.push('content_mark_missing');
        content = content.replace(text.slice(tHit.at, tHit.at + tHit.mark.length + inlineValue(text, tHit).length), '').trim();
    }
    if (!title) {
        notes.push('title_missing');
        const lines = content.split(String.fromCharCode(10)).map(function (l) { return stripAllMarks(l).trim(); }).filter(function (l) { return l.length > 0; });
        if (lines.length > 0) {
            title = lines[0].substring(0, SM_TITLE_MAX);
            if (title.length < lines[0].length) title += SM_ELLIPSIS;
        } else {
            title = SM_FALLBACK_TITLE;
        }
    }
    title = stripQuoteChars(title);
    if (!title) title = SM_FALLBACK_TITLE;
    return { title: title, content: content, notes: notes };
}

/* 标题组装（源 finalTitle：标题 - 条数范围 - 日期，日期 2026/10/2 形）。 */
export function composeTitle(title, msgRange, nowMs) {
    let out = toStr(title);
    if (msgRange) out += ' ' + toStr(msgRange).split('~').join('-');
    const d = new Date(numOrNull(nowMs) || Date.now());
    out += ' ' + String(d.getFullYear()) + '/' + String(d.getMonth() + 1) + '/' + String(d.getDate());
    return out;
}
/* ---------- 双通道自动总结游标（源 checkAutoSummary / checkTrueVectorAutoSummary 的纯算术面）---------- */
/* 初始游标：chunk×间隔 推算（源 vectorLastIndex 初始化）。 */
export function initCursor(lastChunk, interval, historyLen) {
    const iv = (numOrNull(interval) !== null && numOrNull(interval) > 0) ? Math.floor(numOrNull(interval)) : 0;
    if (iv === 0) return { cursor: 0, active: false };
    const chunk = numOrNull(lastChunk) || 0;
    let cursor = chunk * iv;
    if (cursor > historyLen) cursor = historyLen; /* 超长收口（源同款） */
    return { cursor: cursor, active: true };
}

/* 成批推进：攒够一批取一段，推进游标；批次起点留给失败回滚。 */
export function planBatches(historyLen, cursor, interval) {
    const out = [];
    const iv = (numOrNull(interval) !== null && numOrNull(interval) > 0) ? Math.floor(numOrNull(interval)) : 0;
    if (iv === 0) return { batches: out, why: 'interval_off' };
    let pos = cursor;
    while (historyLen - pos >= iv) {
        out.push({ start: pos, end: pos + iv, range: String(pos + 1) + '-' + String(pos + iv) });
        pos += iv;
    }
    return { batches: out, why: '' };
}

/* 回滚（源 catch 分支）：该批失败把游标退回批次起点，停止本轮。 */
export function rollbackCursor(cursor, batchStart) {
    return (numOrNull(batchStart) !== null) ? batchStart : cursor;
}

/* 记忆册归一（源 vectorMemories push 的形状）。 */
export function normalizeMemory(raw, index) {
    const r = isPlain(raw) ? raw : {};
    return {
        memory: {
            id: toStr(r.id) || ('sm_m_' + String(index + 1)),
            title: toStr(r.title) || SM_FALLBACK_TITLE,
            content: toStr(r.content),
            timestamp: numOrNull(r.timestamp) || 0
        },
        why: ''
    };
}

export function normalizeMemories(raw) {
    const out = { memories: [], rejected: [] };
    for (let i = 0; i < listOf(raw).length; i++) {
        const r = normalizeMemory(listOf(raw)[i], i);
        if (!r.memory) { out.rejected.push({ index: i }); continue; }
        out.memories.push(r.memory);
    }
    const capped = trimRows(out.memories, SM_MEMORIES_MAX);
    out.memories = capped.rows;
    if (capped.dropped > 0) out.notes_push = capped.dropped;
    return out;
}

/* 读数面。 */
export function readingsOf(memories, cursorA, cursorB, historyLen) {
    return { memories: listOf(memories).length, cursorNormal: numOrNull(cursorA) || 0, cursorTrue: numOrNull(cursorB) || 0, historyLen: numOrNull(historyLen) || 0, pendingNormal: Math.max(0, (numOrNull(historyLen) || 0) - (numOrNull(cursorA) || 0)) };
}