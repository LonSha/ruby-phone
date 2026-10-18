/* ============================================================
 * config/reading-notes-contract.js — [v4.24.0 · 第四期 R4-X8 阅读研究笔记与全文找句]
 *
 * 【本件是纯契约：零 DOM 零存储零联网零时钟】
 *   三件事，各只判一次：
 *     ① **全书找句**：索引可**本地重建**（不落第二份正文），扫描**全章**；
 *     ② **摘录锚点核对**：书改版后旧摘录的章/段引用**不再默认可信**；
 *     ③ **批注与标签**：批注是用户自己的解释，**不是原文** —— 两格严格分开。
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   reading 侧此前只有「点段落摘录」：摘录结构 `{id,text,bookId,chapter,para,...}`
 *   里既没有书的**指纹**，也没有用户自己的解释位。后果三件，都不是报错：
 *     ① 书改了版（重导同名文件、换版本 txt）后，旧摘录的 `chapter/para` 依旧被当作有效
 *        坐标 —— 用户点回跳，落在**另一段**上，而界面一声不响；
 *     ② 摘录只能当引文堆着，写不进「我为什么摘它」；
 *     ③ `reading-view` 的邻域窗口只渲染当前章的一小段，**书内没有查找**：
 *        记得住一句、记不住在第几章，就只能一页页翻。
 *   验收点名的正是这四条：末章与跨段命中要能找到、改版书要提示旧锚点需确认、
 *   批注不是原文、导出/恢复后标签批注与原文定位都在。
 *
 * 【为什么索引不落盘】计划落点原文：「只增本地**可重建**索引和笔记字段，
 *   **不把全书送进每轮提示词**」。故索引每次由章节数组现建（`buildSearchIndex`），
 *   只活在调用栈里；落盘的只有摘录本身的笔记字段（那才是用户写的东西）。
 *
 * 【跨段命中为什么要单独标】章文本按「段接段直接相连」拼（丢弃段间换行）——
 *   只有这样「上段末尾 + 下段开头」的一句才找得到（验收要求）。但拼接处**不是原文
 *   里连续的一句话**，故命中一律带 `crossPara` 与段区间，由界面如实标注。
 *   把拼接命中说成「原文如此」，与把批注当原文是同一族错。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
/* ───────── ① 上限（都是「结果上限」，不是「扫描上限」） ───────── */
export const SEARCH_LIMITS = Object.freeze({
    hits: 200,       // 一次查找返回的命中条数上限（超出如实报截断）
    collect: 2000,   // 单次扫描收集上限（防超长书把内存吃满；触顶如实报）
    query: 60,       // 查询串长度上限
    snippet: 60,     // 命中上下文每侧字符数
});
export const NOTE_LIMITS = Object.freeze({
    annotation: 500, // 一条批注的字数上限
    tags: 8,         // 一条摘录最多挂几个标签
    tagLen: 16,      // 单个标签字数上限
});
/* ───────── ② 摘录锚点七态 ───────── */
/**
 * 七态，`needsConfirm` 与 `settled` 由 `anchorNeedsConfirm` / `anchorSettled` 判（一处实现）：
 *   OK           指纹与段落文本**都**核过，对得上；
 *   FINGERPRINT  指纹这一环**没核成**（这次没读正文，或本机没记指纹）⇒ **未定论**（不是「已确认」）；
 *   REVISION     书已改版（指纹不符）⇒ 旧锚点**需确认**；
 *   MOVED        指纹一致，但那一段的文本已不是摘录的那段（错位）；
 *   GONE         章号/段号超出这本书的范围；
 *   UNPINNED     这条摘录没记书的指纹（旧摘录）⇒ 无从比对，**需确认**；
 *   UNREADABLE   书不在书架 / 正文读不到 ⇒ **判不了**（不是「没问题」）。
 */
export const EXCERPT_ANCHOR_STATES = Object.freeze({
    OK: 'ok',
    FINGERPRINT: 'fingerprint-only',
    REVISION: 'revision-needs-confirm',
    MOVED: 'moved',
    GONE: 'gone',
    UNPINNED: 'unpinned-needs-confirm',
    UNREADABLE: 'unreadable',
});
/** 需确认四态（改版 / 无指纹 / 错位 / 找不到）——用户必须自己看过的四种。 */
export const ANCHOR_CONFIRM_STATES = Object.freeze([
    EXCERPT_ANCHOR_STATES.REVISION,
    EXCERPT_ANCHOR_STATES.MOVED,
    EXCERPT_ANCHOR_STATES.GONE,
    EXCERPT_ANCHOR_STATES.UNPINNED,
]);
/** 该态是否「需确认」。**未定论（FINGERPRINT / UNREADABLE）不算确认过，也不算需确认**。 */
export function anchorNeedsConfirm(state) {
    return ANCHOR_CONFIRM_STATES.indexOf(String(state || '')) >= 0;
}
/** 该态是否「已定论且没问题」。只有 OK 是。 */
export function anchorSettled(state) {
    return String(state || '') === EXCERPT_ANCHOR_STATES.OK;
}
/* ───────── ③ 小工具（本件内部；只做字符串归一，不碰数值口径） ───────── */
function str(v) { return String(v == null ? '' : v); }
function trimStr(v) { return str(v).trim(); }
/** 折叠空白（核文本用：段落的换行/多空格不该让等值判定失败）。 */
function normWs(s) { return str(s).replace(/\s+/g, ' ').trim(); }
/* ───────── ④ 批注与标签（批注不是原文） ───────── */
/**
 * 批注归一：控制字符换成空格，超长截断到上限。取不到 / 非字符串 **如实 ''**（不编内容）。
 */
export function normalizeAnnotation(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number') return '';
    const t = trimStr(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
    if (!t) return '';
    return t.slice(0, NOTE_LIMITS.annotation);
}
/**
 * 标签归一：数组或「逗号/顿号/分号/空白分隔」的字符串都认；
 *   去空、去重、逐条截长、超上限**如实丢弃**（不静默膨胀）。
 */
export function normalizeNoteTags(raw) {
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string') arr = raw.split(/[,，、;；\s]+/);
    const out = [];
    for (const it of arr) {
        const t = trimStr(it).replace(/\s+/g, ' ').slice(0, NOTE_LIMITS.tagLen);
        if (!t) continue;
        if (out.indexOf(t) >= 0) continue;
        if (out.length >= NOTE_LIMITS.tags) break;
        out.push(t);
    }
    return out;
}
/**
 * 一条摘录的「原文 / 我写的」两分读数。**这是「批注不是原文」的唯一口径**：
 *   `text` 只可能是原文片段，`annotation` 只可能是用户写的；两者不互相掺。
 */
export function excerptNoteOf(excerpt) {
    const e = (excerpt && typeof excerpt === 'object') ? excerpt : {};
    const annotation = normalizeAnnotation(e.annotation);
    return {
        text: trimStr(e.text),
        annotation: annotation,
        tags: normalizeNoteTags(e.tags),
        hasAnnotation: annotation.length > 0,
        isQuoteOnly: annotation.length === 0,
    };
}
/* ───────── ⑤ 全书找句（索引可重建，扫全章） ───────── */
/**
 * 由章节数组现建一份**本地可重建索引**（不入存储）。
 *   章文本 = 各段**直接相连**（丢弃段间换行）：只有这样跨段的一句才找得到；
 *   `starts[i]` 记第 i 段在章文本里的起点，命中落在哪段靠它反查。
 * @returns {{ok:boolean, bookId:string, title:string, contentHash:string,
 *            chapters:Array, totalParas:number, totalChars:number, reason:string}}
 */
export function buildSearchIndex(book) {
    const b = (book && typeof book === 'object') ? book : {};
    const out = {
        ok: false, bookId: trimStr(b.id || b.bookId), title: trimStr(b.title),
        contentHash: trimStr(b.contentHash),
        chapters: [], totalParas: 0, totalChars: 0, reason: '',
    };
    const chapters = Array.isArray(b.chapters) ? b.chapters : null;
    if (!chapters) {
        out.reason = 'no-chapters（拿不到这本书的正文 ⇒ 判不了，不是「书里没有」）';
        return out;
    }
    for (let i = 0; i < chapters.length; i++) {
        const c = (chapters[i] && typeof chapters[i] === 'object') ? chapters[i] : {};
        const ps = Array.isArray(c.paragraphs) ? c.paragraphs : [];
        const parts = [];
        const starts = [];
        let off = 0;
        for (let j = 0; j < ps.length; j++) {
            const t = str(ps[j]);
            starts.push(off);
            parts.push(t);
            off += t.length;
        }
        out.chapters.push({
            index: i, title: trimStr(c.title),
            text: parts.join(''), starts: starts, paraCount: ps.length,
        });
        out.totalParas += ps.length;
        out.totalChars += off;
    }
    out.ok = true;
    out.reason = 'indexed';
    return out;
}
/** 命中坐标 → 段号（starts 升序，取最后一个 ≤ off 的）。 */
function paraAt(ch, off) {
    const starts = Array.isArray(ch.starts) ? ch.starts : [];
    let p = 0;
    for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= off) p = i; else break;
    }
    return p;
}
/** 造一条命中：带**段区间**与跨段标记（拼接处的命中不得被说成「原文一句」）。 */
function mkHit(ch, at, len, limitSnippet) {
    const startPara = paraAt(ch, at);
    const endPara = paraAt(ch, at + Math.max(0, len - 1));
    return {
        chapter: ch.index, chapterTitle: ch.title,
        para: startPara, paraEnd: endPara, crossPara: endPara > startPara,
        match: ch.text.slice(at, at + len),
        before: ch.text.slice(Math.max(0, at - limitSnippet), at),
        after: ch.text.slice(at + len, at + len + limitSnippet),
        at: at,
    };
}
/**
 * 全书找句。**扫全章**，不因凑够条数就收工 —— 验收要求「命中位于末章的文字也能找到」，
 *   故 `lastHit`（最靠后一处）永远是全量扫描的真读数；结果被上限截断时，
 *   **末章那一处一定留在返回列表里**（并标 `keptBy:'tail'`，界面据此如实说明）。
 * @returns {{ok:boolean, query:string, hits:Array, totalHits:number, truncated:boolean,
 *            chaptersScanned:number, chaptersTotal:number, firstHit:object|null,
 *            lastHit:object|null, reason:string}}
 */
export function searchInBook(index, query, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const limitSnippet = SEARCH_LIMITS.snippet;
    const q = trimStr(query).slice(0, SEARCH_LIMITS.query);
    const ix = (index && typeof index === 'object') ? index : {};
    const rawLimit = numOrNull(o.limit);
    const limit = (rawLimit === null || rawLimit <= 0) ? SEARCH_LIMITS.hits : Math.floor(rawLimit);
    const caseSensitive = o.caseSensitive === true;
    const out = {
        ok: false, query: q, hits: [], totalHits: 0, truncated: false,
        chaptersScanned: 0, chaptersTotal: Array.isArray(ix.chapters) ? ix.chapters.length : 0,
        firstHit: null, lastHit: null, reason: '',
    };
    if (!ix.ok) { out.reason = 'index-unavailable（拿不到索引 ⇒ **搜不了**,不是「书里没有」：' + (ix.reason || '') + '）'; return out; }
    if (!q) { out.reason = 'empty-query（空查询不搜，也不返回全书）'; return out; }
    const needle = caseSensitive ? q : q.toLowerCase();
    const collected = [];
    const cap = SEARCH_LIMITS.collect;
    let capped = false;
    for (const ch of (Array.isArray(ix.chapters) ? ix.chapters : [])) {
        if (!ch || typeof ch.text !== 'string') continue;
        const hay = caseSensitive ? ch.text : ch.text.toLowerCase();
        let from = 0;
        while (from <= hay.length - needle.length) {
            const at = hay.indexOf(needle, from);
            if (at < 0) break;
            /* 折叠可能改变长度（个别字符），故用原文切片复核一次：对不上就往下找，不认这条。 */
            const raw = ch.text.slice(at, at + q.length);
            if (caseSensitive ? raw === q : raw.toLowerCase() === needle) {
                collected.push(mkHit(ch, at, q.length, limitSnippet));
                if (collected.length >= cap) { capped = true; break; }
            }
            from = at + Math.max(1, needle.length);
        }
        out.chaptersScanned += 1;
        if (capped) break;
    }
    out.ok = true;
    out.totalHits = collected.length;
    out.firstHit = collected.length ? collected[0] : null;
    out.lastHit = collected.length ? collected[collected.length - 1] : null;
    if (capped) {
        out.truncated = true;
        out.reason = 'collect-cap（命中太多，按上限 ' + String(cap) + ' 条收集：总数是**下限**）';
    } else if (collected.length > limit) {
        out.truncated = true;
        out.reason = 'hit-limit（命中 ' + String(collected.length) + ' 处，按上限显示 ' + String(limit) + ' 条）';
    } else {
        out.reason = 'ok';
    }
    if (!out.truncated) {
        out.hits = collected;
    } else {
        const head = collected.slice(0, Math.max(1, limit - 1)).map(function (h) {
            return { chapter: h.chapter, chapterTitle: h.chapterTitle, para: h.para, paraEnd: h.paraEnd, crossPara: h.crossPara, match: h.match, before: h.before, after: h.after, at: h.at, keptBy: 'head' };
        });
        const tail = collected[collected.length - 1];
        head.push({
            chapter: tail.chapter, chapterTitle: tail.chapterTitle, para: tail.para, paraEnd: tail.paraEnd,
            crossPara: tail.crossPara, match: tail.match, before: tail.before, after: tail.after, at: tail.at, keptBy: 'tail',
        });
        out.hits = head;
    }
    return out;
}
/** 查找一行读数（截断与跨段都如实说，一处都不省）。 */
export function searchLine(res) {
    const r = (res && typeof res === 'object') ? res : {};
    const q = trimStr(r.query);
    if (!q) return '查找 —（' + (r.reason || '空查询') + '）';
    if (r.ok !== true) return '查找「' + q + '」—（' + (r.reason || '搜不了') + '）';
    let s = '查找「' + q + '」命中 ' + String(r.totalHits) + ' 处 · 扫了 '
        + String(r.chaptersScanned) + '/' + String(r.chaptersTotal) + ' 章';
    if (r.truncated) {
        s += ' · **结果按上限截断，末章那一处已保留**（' + String(r.reason) + '）';
    }
    if (r.lastHit) {
        s += ' · 最靠后一处在第 ' + String(Number(r.lastHit.chapter) + 1) + ' 章第 ' + String(Number(r.lastHit.para) + 1) + ' 段';
    }
    if (!r.totalHits) s += ' · 一处都没有（全书都扫过了）';
    return s;
}
/* ───────── ⑥ 摘录锚点核对（改版书必须提示） ───────── */
/** 核文本用的探针：规范空白后取前 40 字（太短则全用）；取不到如实 ''。 */
function excerptProbeText(text) {
    const t = normWs(text);
    if (!t) return '';
    return t.slice(0, 40);
}
/**
 * 逐条核对摘录锚点。判定顺序（**先比指纹，再核文本**）：
 *   书读不到 ⇒ UNREADABLE；摘录没记指纹 ⇒ UNPINNED；本机没记指纹 ⇒ FINGERPRINT；
 *   指纹不符 ⇒ REVISION；这次没读正文 ⇒ FINGERPRINT；章段越界 ⇒ GONE；段文本对不上 ⇒ MOVED；全对 ⇒ OK。
 * @param {object} excerpt 摘录条目（须带 bookId / chapter / para / text，可选 bookHash）
 * @param {object|null} book 该书读数 `{id, title, contentHash, chapters?}`（chapters 缺席即「没读正文」）
 * @returns {{state:string, needsConfirm:boolean, settled:boolean, why:string, position:string, paraText:string, matched:boolean}}
 */
export function checkExcerptAnchor(excerpt, book) {
    const out = {
        state: EXCERPT_ANCHOR_STATES.UNREADABLE, needsConfirm: false, settled: false,
        why: '', position: '', paraText: '', matched: false,
    };
    const settle = function (state, why) {
        out.state = state;
        out.why = why;
        out.needsConfirm = anchorNeedsConfirm(state);
        out.settled = anchorSettled(state);
        return out;
    };
    const e = (excerpt && typeof excerpt === 'object') ? excerpt : null;
    if (!e) return settle(EXCERPT_ANCHOR_STATES.UNREADABLE, '摘录条目不可读');
    const bookId = trimStr(e.bookId);
    if (!bookId) return settle(EXCERPT_ANCHOR_STATES.UNREADABLE, '这条摘录没有书记录（丢出处）');
    const ci = numOrNull(e.chapter);
    const pi = numOrNull(e.para);
    out.position = (ci === null || pi === null)
        ? '章段引用不完整'
        : ('第 ' + String(Math.floor(ci) + 1) + ' 章第 ' + String(Math.floor(pi) + 1) + ' 段');
    const b = (book && typeof book === 'object') ? book : null;
    if (!b) return settle(EXCERPT_ANCHOR_STATES.UNREADABLE, '这本书不在书架上（正文无从核对 ⇒ 不是「锚点没问题」）');
    const exHash = trimStr(e.bookHash);
    const bkHash = trimStr(b.contentHash);
    if (!exHash) {
        return settle(EXCERPT_ANCHOR_STATES.UNPINNED, '这条摘录没记书的指纹（旧摘录）—— 书改了版也无从比对，回跳前请确认');
    }
    if (!bkHash) {
        return settle(EXCERPT_ANCHOR_STATES.FINGERPRINT, '本机这本书没记内容指纹 —— 改版与否无从比对，这次不算确认过');
    }
    if (bkHash !== exHash) {
        return settle(EXCERPT_ANCHOR_STATES.REVISION, '书已改版（本机 ' + bkHash + ' ≠ 摘录记的 ' + exHash + '）—— 旧锚点需确认');
    }
    const chapters = Array.isArray(b.chapters) ? b.chapters : null;
    if (!chapters) {
        return settle(EXCERPT_ANCHOR_STATES.FINGERPRINT, '指纹一致，但这次没读正文 ⇒ 文本未核（不是「已确认」）');
    }
    if (ci === null || pi === null || ci < 0 || pi < 0 || ci >= chapters.length) {
        return settle(EXCERPT_ANCHOR_STATES.GONE, '章号超出这本书的范围（这本书只剩 ' + String(chapters.length) + ' 章）');
    }
    const c = (chapters[Math.floor(ci)] && typeof chapters[Math.floor(ci)] === 'object') ? chapters[Math.floor(ci)] : {};
    const ps = Array.isArray(c.paragraphs) ? c.paragraphs : [];
    if (pi >= ps.length) {
        return settle(EXCERPT_ANCHOR_STATES.GONE, '段号超出第 ' + String(Math.floor(ci) + 1) + ' 章的范围（该章只有 ' + String(ps.length) + ' 段）');
    }
    const paraText = str(ps[Math.floor(pi)]);
    out.paraText = paraText.slice(0, 200);
    const probe = excerptProbeText(e.text);
    if (probe && normWs(paraText).indexOf(probe) >= 0) {
        out.matched = true;
        return settle(EXCERPT_ANCHOR_STATES.OK, '指纹与段落文本都对得上');
    }
    return settle(EXCERPT_ANCHOR_STATES.MOVED, '指纹一致，但第 ' + String(Math.floor(pi) + 1) + ' 段的文本已不是摘录的那一段（可能错位）');
}
/** 单条锚点一行读数。 */
export function anchorLine(anchor) {
    const a = (anchor && typeof anchor === 'object') ? anchor : {};
    const tag = a.needsConfirm ? '⚠ 需确认' : (a.settled ? '✓ 已核对' : '◌ 未定论');
    return tag + ' · ' + String(a.position || '位置读不到') + ' · ' + String(a.why || '没有说明');
}
/* ───────── ⑦ 创作素材清单（原文与自己的解释分列） ───────── */
/**
 * 把摘录汇成一份**可回源**的素材清单。
 *   每条都带：`quote`（原文，来自摘录）与 `annotation`（自己写的，**不是原文**）两格，
 *   以及 `anchor` 读数（需确认的条目在清单里照样标出来，不因为「要拿去用」就免检）。
 * @param {Array} excerpts 摘录数组
 * @param {Array} books 书读数数组 `[{id, title, contentHash, chapters?}]`
 * @returns {{ok:boolean, items:Array, byTag:Array, counts:object, line:string}}
 */
export function buildResearchList(excerpts, books) {
    const list = Array.isArray(excerpts) ? excerpts : [];
    const bs = Array.isArray(books) ? books : [];
    const byId = new Map();
    for (const b of bs) {
        const id = trimStr(b && (b.id || b.bookId));
        if (id) byId.set(id, b);
    }
    const items = [];
    const tagCount = new Map();
    let withAnnotation = 0;
    let needsConfirm = 0;
    let unverified = 0;
    for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const note = excerptNoteOf(e);
        const bookId = trimStr(e.bookId);
        const anchor = checkExcerptAnchor(e, byId.get(bookId) || null);
        if (note.hasAnnotation) withAnnotation += 1;
        if (anchor.needsConfirm) needsConfirm += 1;
        if (!anchor.settled && !anchor.needsConfirm) unverified += 1;
        for (const t of note.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
        items.push({
            id: trimStr(e.id), bookId: bookId,
            bookTitle: trimStr(e.bookTitle) || trimStr(byId.get(bookId) && byId.get(bookId).title),
            chapterTitle: trimStr(e.chapterTitle), position: anchor.position,
            quote: note.text,                 // 原文
            annotation: note.annotation,      // 不是原文
            tags: note.tags,
            hasAnnotation: note.hasAnnotation,
            anchor: { state: anchor.state, why: anchor.why, needsConfirm: anchor.needsConfirm, settled: anchor.settled },
        });
    }
    const byTag = [];
    for (const [tag, count] of tagCount) byTag.push({ tag: tag, count: count });
    byTag.sort(function (a, b) { return b.count - a.count || (a.tag < b.tag ? -1 : 1); });
    const counts = {
        total: items.length, withAnnotation: withAnnotation,
        tagged: byTag.reduce(function (n, t) { return n + t.count; }, 0),
        tags: byTag.length, needsConfirm: needsConfirm, unverified: unverified,
        quoteOnly: items.length - withAnnotation,
    };
    return { ok: true, items: items, byTag: byTag, counts: counts, line: researchLine({ items: items, byTag: byTag, counts: counts }) };
}
/** 素材清单一行读数。 */
export function researchLine(list) {
    const l = (list && typeof list === 'object') ? list : {};
    const c = (l.counts && typeof l.counts === 'object') ? l.counts : {};
    let s = '研究清单 ' + String(c.total || 0) + ' 条 · 带批注 ' + String(c.withAnnotation || 0)
        + ' · 只存原文 ' + String(c.quoteOnly || 0) + ' · 标签 ' + String(c.tags || 0) + ' 种';
    if (c.needsConfirm) s += ' · **锚点需确认 ' + String(c.needsConfirm) + ' 条**（改版书 / 无指纹 / 错位）';
    if (c.unverified) s += ' · 未定论 ' + String(c.unverified) + ' 条（只核了指纹或正文读不到）';
    s += ' · 批注是**自己的解释**，不算原文';
    return s;
}
/* ───────── ⑧ 自检（真跑判据，不是数常量） ───────── */
/**
 * 内核自检。**每条都真跑一次判据**（数常量只能证明表在，不能证明判得对）：
 *   末章命中、跨段命中、截断保尾、改版需确认、无指纹需确认、批注不掺进原文。
 * @returns {{problems:Array, states:number, confirmStates:number, limits:number}}
 */
export function notesSelfCheck() {
    const problems = [];
    const stateKeys = Object.keys(EXCERPT_ANCHOR_STATES);
    if (stateKeys.length !== 7) problems.push('锚点应为七态，实际 ' + String(stateKeys.length));
    if (ANCHOR_CONFIRM_STATES.length !== 4) problems.push('需确认态应为四态，实际 ' + String(ANCHOR_CONFIRM_STATES.length));
    if (!(SEARCH_LIMITS.hits > 0 && SEARCH_LIMITS.collect >= SEARCH_LIMITS.hits)) problems.push('查找上限必须为正且收集上限不低于结果上限');
    if (!(NOTE_LIMITS.annotation > 0 && NOTE_LIMITS.tags > 0 && NOTE_LIMITS.tagLen > 0)) problems.push('笔记上限必须为正');
    /* 一 末章命中 + 跨段命中：造一本末章带跨段句的书。 */
    const chapters = [
        { title: '第一章', paragraphs: ['开头一句', '中段一句'] },
        { title: '第二章', paragraphs: ['甲段结尾：他说', '乙段开头：我去了'] },
        { title: '第三章', paragraphs: ['结尾章唯一一句'] },
    ];
    const ix = buildSearchIndex({ id: 'b1', title: '书', contentHash: 'h1', chapters: chapters });
    if (!ix.ok) problems.push('自检：索引建不起来（' + ix.reason + '）');
    const last = searchInBook(ix, '结尾章唯一一句');
    if (last.totalHits !== 1 || !last.lastHit || last.lastHit.chapter !== 2) problems.push('自检：末章命中没找到');
    const cross = searchInBook(ix, '他说乙段开头');
    if (!cross.hits.length || cross.hits[0].crossPara !== true) problems.push('自检：跨段命中没标出来');
    /* 二 截断保尾：上限压到 1，末章那一处必须在返回列表里。 */
    const many = [{ title: '章', paragraphs: ['同一句话', '同一句话', '同一句话', '末章一句'] }];
    const ix2 = buildSearchIndex({ id: 'b2', chapters: many });
    const cut = searchInBook(ix2, '一句', { limit: 1 });
    if (!cut.truncated) problems.push('自检：上限压到 1 却没报截断');
    if (!cut.hits.length || cut.hits[cut.hits.length - 1].keptBy !== 'tail') problems.push('自检：截断后末章那一处没保留');
    /* 三 锚点：改版 / 无指纹。 */
    const book3 = { id: 'b1', title: '书', contentHash: 'h2', chapters: [{ title: '甲', paragraphs: ['第一段文字'] }] };
    const rev = checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h1', chapter: 0, para: 0 }, book3);
    if (rev.state !== EXCERPT_ANCHOR_STATES.REVISION || !rev.needsConfirm) problems.push('自检：改版书未判成需确认');
    const unp = checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', chapter: 0, para: 0 }, book3);
    if (unp.state !== EXCERPT_ANCHOR_STATES.UNPINNED || !unp.needsConfirm) problems.push('自检：无指纹的旧摘录未判成需确认');
    const okAnchor = checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, book3);
    if (okAnchor.state !== EXCERPT_ANCHOR_STATES.OK || okAnchor.needsConfirm) problems.push('自检：对得上的锚点被误判');
    const noText = checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, { id: 'b1', contentHash: 'h2' });
    if (noText.state !== EXCERPT_ANCHOR_STATES.FINGERPRINT || noText.settled) problems.push('自检：没读正文时不该算「已确认」');
    const noBkHash = checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, { id: 'b1', contentHash: '', chapters: [{ title: '甲', paragraphs: ['第一段文字'] }] });
    if (noBkHash.settled || noBkHash.needsConfirm) problems.push('自检：本机没记指纹时既不该算已确认，也不该算需确认（是未定论）');
    /* 四 批注不掺进原文。 */
    const note = excerptNoteOf({ text: '原文一句', annotation: '我的解释', tags: ['素材', '素材', ' '] });
    if (note.text !== '原文一句' || note.annotation !== '我的解释') problems.push('自检：原文与批注掺在一起了');
    if (note.tags.length !== 1) problems.push('自检：标签没去重去空');
    /* 五 清单：需确认的条目照样标出来。 */
    const rl = buildResearchList(
        [{ id: 'e1', text: '原文一句', bookId: 'b1', bookHash: 'h0', chapter: 0, para: 0, annotation: '我的解释' }],
        [{ id: 'b1', title: '书', contentHash: 'h9' }]
    );
    if (!rl.counts.needsConfirm) problems.push('自检：清单里没把需确认的条目标出来');
    if (rl.counts.withAnnotation !== 1) problems.push('自检：带批注的条目没计上');
    return { problems: problems, states: stateKeys.length, confirmStates: ANCHOR_CONFIRM_STATES.length, limits: Object.keys(SEARCH_LIMITS).length };
}
export default {
    SEARCH_LIMITS, NOTE_LIMITS, EXCERPT_ANCHOR_STATES, ANCHOR_CONFIRM_STATES,
    anchorNeedsConfirm, anchorSettled, normalizeAnnotation, normalizeNoteTags, excerptNoteOf,
    buildSearchIndex, searchInBook, searchLine, checkExcerptAnchor, anchorLine,
    buildResearchList, researchLine, notesSelfCheck,
};
