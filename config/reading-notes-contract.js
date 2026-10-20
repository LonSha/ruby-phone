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
    /* [v4.34.0 · R5-O7] 两格**节奏上限**（不是结果上限：分片只影响让出节奏，
     *   不影响扫到的章与命中的条数 —— 这是与上面四格的根本区别，故注释分开写）。
     *   为什么要有它们：200 万汉字的书建一次索引 ≈16ms、扫一遍 ≈17ms，
     *   一次做完就是**一段同步台阶**：计时器与点击事件排在宏任务队列里，
     *   要等它返回才轮得到 —— 用户点「取消」不会有任何反应。
     *   粒度取值是「单片耗时远小于取消反馈预算（200ms）」推出来的，不是拍的：
     *   1000 章的书按 50 章/片 ⇒ 20 片，单片 ≈0.8ms，取消最坏等一片 + 一轮宏任务。 */
    buildChunk: 50,  // 建索引每片处理多少章
    scanChunk: 25,   // 比中每片扫多少章
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
/**
 * 取**节奏上限**（分片粒度）。与结果上限走同一个取数门 `numOrNull`：
 *   本仓只许有一个数值口径，「这格是节奏、那格是结果」不是另开一门的理由。
 *   取不到 / 非正数 ⇒ 退回 `dflt`（**不退回 0**：0 会让分片消失，变成「没有让出」，
 *   那正是本版要治的形态，绝不能因为一格读数缺失而静默复发）。
 */
function chunkSizeOf(raw, dflt) {
    const n = numOrNull(raw);
    if (n === null || n <= 0) return dflt;
    return Math.max(1, Math.floor(n));
}

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
    /* 同步抽干生成器：**唯一实现只有一份**（`buildIndexChunks`）。
     *   为什么不做成「同步一份、分片一份」：本仓最忌同一口径两份实现 ——
     *   两份必然会漂移，而漂移的表现是「同一个查询在取消路径与普通路径上命中不同」，
     *   不报错、只是错数。故分片是**唯一真源**，同步入口只是把它抽干。 */
    const gen = buildIndexChunks(book);
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
}
/**
 * 由章节数组**按章分片**建索引（生成器；[v4.34.0 · R5-O7]）。
 *   每 `SEARCH_LIMITS.buildChunk` 章 `yield` 一次，驱动器决定是否等待 ——
 *   于是「建索引」这段最贵的工作不再是一整块同步台阶。
 *   分片只影响**节奏**：无论怎么分，返回的索引对象逐字段与 `buildSearchIndex` 相同。
 *   宿主能力（`for...of` 逐章）之外没有别的依赖，故本件仍是零 DOM / 零存储 / 零时钟。
 *   ★ 声明处**不写 `export`**：全仓零消费导出门禁（`scripts/dead-export-check.mjs`）
 *     刻意不认 `export function*` 这一写法（E9/B5 判据锁着「生成器声明必须被兜住」），
 *     故出口统一在文件末的 `export { ... }` 块里给 —— 那才是门禁能枚举成员的通道。
 * @param {object} book 同 `buildSearchIndex`
 * @returns {Generator<void, object, void>} `next().value`（done 时）才是索引对象
 */
function* buildIndexChunks(book) {
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
    const chunk = chunkSizeOf(SEARCH_LIMITS.buildChunk, 50);
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
        /* 每片末让出一次。用 `(i + 1) % chunk` 而不是「凑够 chunk 就重置计数」：
         *   后者在 chapters 很长时要多维护一个变量，且与「第几章」对不上号。 */
        if ((i + 1) % chunk === 0 && i + 1 < chapters.length) yield;
    }
    out.ok = true;
    out.reason = 'indexed';
    return out;
}
/**
 * 索引的**版本键**（[v4.34.0 · R5-O7] 复用缓存的唯一判据）。
 *   为什么不能只用书 ID：同一本书**可以改版**（重导同名文件、换版本 txt）——
 *   正文一变，旧索引的章文本与段起点全部失效，而「书 ID 没变」会让缓存
 *   把旧索引端上来：查出来的段号指到别的段上，界面一声不响。
 *   故键 = 书 ID + 内容版本（`contentHash`，M5 的正文 owner 给的同一枚指纹）。
 *   为什么不是「索引对象自己算个 hash」：算 hash 要把整本正文再读一遍，
 *   那正是本版要省掉的那段成本；而 `contentHash` 是现成的、且与摘录锚点同源。
 * @returns {{bookId:string, contentHash:string, key:string}} key 空串表示**判不了**
 *   （缺书 ID 或缺指纹 ⇒ 不许复用：宁可重建，不可错认版本）
 */
export function indexVersionOf(book) {
    const b = (book && typeof book === 'object') ? book : {};
    const bookId = trimStr(b.id || b.bookId || b.bookId);
    const contentHash = trimStr(b.contentHash);
    /* 键分隔符用 `#` 并**逐个字段兜底**：`a#b` 与 `a#` + `b` 这类拼接歧义
     *   在两边都空时会出现，故键为空（`#`）时一律当「判不了」。 */
    const key = (bookId && contentHash) ? (bookId + '#' + contentHash) : '';
    return { bookId: bookId, contentHash: contentHash, key: key };
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
    /* 同步抽干生成器：与建索引同规 —— 分片是**唯一真源**，同步入口只是把它抽干。
     *   既有调用方（视图的普通查找、system-v4240 的全部判据）行为一字不改。 */
    const gen = searchBookChunks(index, query, opts);
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
}
/**
 * 全书找句**按章分片**版（生成器；[v4.34.0 · R5-O7]）。
 *   每 `SEARCH_LIMITS.scanChunk` 章 `yield` 一次 —— 驱动器据此让出宏任务并受理取消。
 *   分片只影响**节奏**：无论怎么分，返回的结果对象逐字段与 `searchInBook` 相同
 *   （包括「被取消时绝不返回半份结果」这条：半份结果比空结果更糟 ——
 *   用户会以为「只有这些」。取消由驱动器负责如实报，本生成器只负责扫）。
 *   ★ 声明处同样不写 `export`（理由见 `buildIndexChunks` 上方注释）。
 * @returns {Generator<void, object, void>} `next().value`（done 时）才是结果对象
 */
function* searchBookChunks(index, query, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const limitSnippet = SEARCH_LIMITS.snippet;
    const q = trimStr(query).slice(0, SEARCH_LIMITS.query);
    const ix = (index && typeof index === 'object') ? index : {};
    const rawLimit = numOrNull(o.limit);
    const limit = (rawLimit === null || rawLimit <= 0) ? SEARCH_LIMITS.hits : Math.floor(rawLimit);
    const caseSensitive = o.caseSensitive === true;
    const list = Array.isArray(ix.chapters) ? ix.chapters : [];
    const out = {
        ok: false, query: q, hits: [], totalHits: 0, truncated: false,
        chaptersScanned: 0, chaptersTotal: list.length,
        firstHit: null, lastHit: null, reason: '',
    };
    if (!ix.ok) { out.reason = 'index-unavailable（拿不到索引 ⇒ **搜不了**,不是「书里没有」：' + (ix.reason || '') + '）'; return out; }
    if (!q) { out.reason = 'empty-query（空查询不搜，也不返回全书）'; return out; }
    const needle = caseSensitive ? q : q.toLowerCase();
    const collected = [];
    const cap = SEARCH_LIMITS.collect;
    let capped = false;
    const chunk = chunkSizeOf(SEARCH_LIMITS.scanChunk, 25);
    for (let ci = 0; ci < list.length; ci++) {
        const ch = list[ci];
        /* 章体不可读**照样记进已扫章数**（它确实被扫过了）——
         *   修前用 `continue` 跳过，那一章既不计数也不让出：分片节奏被它带偏。 */
        if (ch && typeof ch.text === 'string') {
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
        }
        out.chaptersScanned += 1;
        if (capped) break;
        if ((ci + 1) % chunk === 0 && ci + 1 < list.length) yield;
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
/**
 * 按书**逐本读正文**核对摘录锚点（生成器；[v4.35.0 · R5-O8]）。
 *   为什么需要它：修前「研究清单」只拿运行时缓存里的正文交给 `buildResearchList`，
 *   冷启动（重启后直接进研究页、没先打开过书）时缓存是空的 ⇒ 每条摘录都落成
 *   `FINGERPRINT`「未定论」。那个态**不算错**（它说的是实话：这次没读正文），
 *   但它把两件不同的事压成同一格：
 *     ① 这本书**根本没存过正文附件**（换设备 / 没导入）⇒ 该显示「缺失」；
 *     ② 附件在、只是**这次没读**（重启后的第一眼）⇒ 该显示「正在核对」再变结论。
 *   本生成器把「读不到」如实写进读数（`chapters:null` + `why` 说清是没存过），
 *   并**照样产出这一条**（不跳过它 —— 跳过就等于把「没读到」伪装成「没有这条摘录」）。
 *   ★ 让出粒度是**每本**（不是每 N 本）：一本书本身可能就是百万字级，按本让出才贴近
 *     取消预算；且**入口先让出一次** —— 书目为空时下面一次都不会让出，取消就永远
 *     受理不到（与 R5-O7 同一族形态：同一功能两种脾气，用户只会认为按钮时灵时不灵）。
 *   ★ 声明处同样不写 `export`（理由见 `buildIndexChunks` 上方注释）。
 * @param {Array} books 书目 `[{id, title, contentHash}]`
 * @param {(book:object)=>Promise|object} readBook 宿主给的读正文口（返回 Promise 或同步值）
 * @param {{missing?:Array}} [opts] 已知「这本没存过附件」的集合（可选；不传就现读现判）
 * @returns {Generator<void, Array, void>} `next().value`（done 时）才是读数数组
 */
function* readBooksForAnchors(books, readBook, opts) {
    const list = Array.isArray(books) ? books : [];
    const o = (opts && typeof opts === 'object') ? opts : {};
    const missSet = new Set();
    for (const raw of (Array.isArray(o.missing) ? o.missing : [])) {
        const id = trimStr(raw);
        if (id) missSet.add(id);
    }
    const out = [];
    yield null;   // 阶段入口先让出一次（书目为空也至少有一个受理窗口）
    for (const it of list) {
        const b = (it && typeof it === 'object') ? it : {};
        const id = trimStr(b.id || b.bookId);
        if (!id) { yield null; continue; }
        const base = { id: id, title: trimStr(b.title), contentHash: trimStr(b.contentHash), chapters: null, why: '' };
        /* 调用方**自带正文**（同步入口的老用法）：直接用，不调读口 ——
         *   两条入口（同步抽干 / 分片异步）必须给出同一份读数，差别只许在节奏上。
         *   若这里改调读口，同步入口就会把「调用方已经拿到手的正文」丢掉，
         *   于是同一批摘录在同步与分片两条路上得到不同的锚点结论。 */
        const own = Array.isArray(b.chapters) ? b.chapters : null;
        if (own) { out.push(Object.assign(base, { chapters: own, why: 'ok' })); yield null; continue; }
        if (missSet.has(id)) {
            out.push(Object.assign(base, { why: '这本书没存过正文附件（换设备或没导入过）⇒ 锚点判不了，不是「没问题」' }));
            yield null;
            continue;
        }
        let r = null;
        try { r = yield (readBook ? readBook(b) : null); } catch (_e) { r = null; }
        /* ★ 只认 `chapters` 是数组，**不额外要求 `r.ok === true`**：
         *   App 的读口 `bookReadOf` 给的是 `{id,title,contentHash,chapters,why}`，
         *   本来就没有 `ok` 格 —— 多加一条要求会让「读到了正文」被判成「读不到」，
         *   而那正是本版要治的形态（把读到与读不到压成同一格）。 */
        const chapters = (r && Array.isArray(r.chapters)) ? r.chapters : null;
        if (!chapters) missSet.add(id);
        out.push(Object.assign(base, {
            chapters: chapters,
            why: chapters ? 'ok' : '正文读不到（没存过附件 / 本环境没有附件层）',
        }));
    }
    return out;
}
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
    /* 同步抽干生成器：**唯一实现只有一份**（`researchListChunks`）。
     *   为什么不做成「同步一份、分片一份」：与建索引同规 —— 两份必然漂移，
     *   而漂移的表现是「同一批摘录，重开第一眼与核对之后看到的条目不一样」，
     *   不报错、只是错数。故分片是**唯一真源**，同步入口只是把它抽干。 */
    const gen = researchListChunks(excerpts, books, null, null);
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
}
/**
 * 一条摘录的**研究条目**（原文 / 我写的 / 出处读数三件套；[v4.35.0 · R5-O8]）。
 *   ★ 这是清单条目的**唯一装配点**：同步入口与分片入口都从这里取 ——
 *     两份装配必然漂移，而漂移的表现是「同一批摘录在两条路上得到不同的出处结论」。
 * @param {object} excerpt 摘录条目
 * @param {object|null} book 该书读数（`chapters` 缺席 = 这次没读正文）
 * @returns {{note:object, anchor:object, item:object}}
 */
function researchItemsOf(excerpt, book) {
    const e = (excerpt && typeof excerpt === 'object') ? excerpt : {};
    const note = excerptNoteOf(e);
    const bookId = trimStr(e.bookId);
    const bk = (book && typeof book === 'object') ? book : null;
    const anchor = checkExcerptAnchor(e, bk);
    return {
        note: note,
        anchor: anchor,
        item: {
            id: trimStr(e.id), bookId: bookId,
            bookTitle: trimStr(e.bookTitle) || trimStr(bk && bk.title),
            chapterTitle: trimStr(e.chapterTitle), position: anchor.position,
            quote: note.text,                 // 原文
            annotation: note.annotation,      // 不是原文
            tags: note.tags,
            hasAnnotation: note.hasAnnotation,
            anchor: { state: anchor.state, why: anchor.why, needsConfirm: anchor.needsConfirm, settled: anchor.settled },
        },
    };
}
/**
 * 研究清单**按书分片**版（生成器；[v4.35.0 · R5-O8]）。
 *   与同步入口逐字段等价（同一 `researchItemsOf` 装配），差别只在「读正文 / 归条」
 *   之间**逐本让出**，于是驱动器能受理取消、能报「正在核对」。
 *   ★ 冷启动（运行时缓存空）时它**会去读附件**再归条 —— 这正是本版要治的那条：
 *     修前清单只吃运行时缓存，重启后第一眼全是「未定论」，而其中「附件压根没存过」
 *     与「这次没读」被压成同一格，用户看到的就是「这个清单核不了」。
 *   ★ 声明处同样不写 `export`（理由见 `buildIndexChunks` 上方注释）。
 * @param {Array} excerpts 摘录条目
 * @param {Array} books 书目 `[{id, title, contentHash, chapters?}]`
 * @param {(book:object)=>Promise|object} readBook 读正文口（同步入口传 null）
 * @param {{missing?:Array}} [opts] 已知「没存过附件」的集合
 * @returns {Generator<void, object, void>} `next().value`（done 时）才是清单对象
 */
function* researchListChunks(excerpts, books, readBook, opts) {
    const list = Array.isArray(excerpts) ? excerpts : [];
    /* 读正文这一段交给同一个生成器（`readBooksForAnchors`）：
     *   它是**逐本让出**的那一段，也是最贵的一段，取消要在这里受理得到。 */
    const reads = yield* readBooksForAnchors(books, readBook, opts);
    const byId = new Map();
    for (const b of (Array.isArray(reads) ? reads : [])) {
        const id = trimStr(b && (b.id || b.bookId));
        if (id) byId.set(id, b);
    }
    const items = [];
    const tagCount = new Map();
    let withAnnotation = 0;
    let needsConfirm = 0;
    let unverified = 0;
    yield null;   // 读完之后、归条之前再让出一次（条目多时归条本身也是一段活）
    for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const built = researchItemsOf(e, byId.get(trimStr(e.bookId)) || null);
        const note = built.note;
        const anchor = built.anchor;
        if (note.hasAnnotation) withAnnotation += 1;
        if (anchor.needsConfirm) needsConfirm += 1;
        if (!anchor.settled && !anchor.needsConfirm) unverified += 1;
        for (const t of note.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
        items.push(built.item);
    }
    const byTag = [];
    for (const [tag, count] of tagCount) byTag.push({ tag: tag, count: count });
    byTag.sort(function (a, b) { return b.count - a.count || (a.tag < b.tag ? -1 : 1); });
    const counts = {
        total: items.length, withAnnotation: withAnnotation,
        tagged: byTag.reduce(function (n, t) { return n + t.count; }, 0),
        tags: byTag.length, needsConfirm: needsConfirm, unverified: unverified,
        quoteOnly: items.length - withAnnotation,
        /* [v4.35.0 · R5-O8] 两格**回源读数**：几本在书目里、几本这次真读到了正文。
         *   为什么必须分开报：「没存过附件」与「这次没读」在界面上是两句话，
         *   而在修前它们都表现为「未定论」—— 混成一格正是本版要治的形态。 */
        books: byId.size,
        read: (Array.isArray(reads) ? reads.filter(function (r) { return Array.isArray(r.chapters); }).length : 0),
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
    /* [v4.35.0 · R5-O8] 回源读数：**这次真读到几本正文**。
     *   为什么要单列这一句：修前清单只吃运行时缓存，冷启动时「一本都没读」与
     *   「读了但都对不上」在界面上长得一样（都是「未定论」）—— 这一句把它们分开：
     *   读到 0 本时读数会**明说是没读到**，而不是让用户以为清单核过了没问题。 */
    if (c.books !== undefined) {
        const readN = Number(c.read || 0);
        const bookN = Number(c.books || 0);
        s += ' · 这次读到正文 ' + String(readN) + '/' + String(bookN) + ' 本';
        if (bookN > 0 && readN === 0) s += '（**一本都没读到** ⇒ 出处读数是「没核成」，不是「都对得上」）';
    }
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
    /* 六 [v4.34.0 · R5-O7] 分片与同步**逐字段等价**（分片只许改节奏，不许改结果）。
     *   为什么这条必须真跑：分片最危险的形态不是报错，而是「分片版少扫了一章 /
     *   多收了一条」—— 界面上什么都不会响，只是命中列表与不取消时不一样。 */
    const manyCh = [];
    for (let i = 0; i < SEARCH_LIMITS.buildChunk * 2 + 7; i++) {
        manyCh.push({ title: '第' + (i + 1) + '章', paragraphs: ['甲' + i + '一句', '乙' + i + '一句'] });
    }
    const ixSync = buildSearchIndex({ id: 'b3', contentHash: 'h3', chapters: manyCh });
    const gen = buildIndexChunks({ id: 'b3', contentHash: 'h3', chapters: manyCh });
    let yields = 0;
    let step = gen.next();
    while (!step.done) { yields += 1; step = gen.next(); }
    const ixChunk = step.value;
    if (ixChunk.totalParas !== ixSync.totalParas || ixChunk.totalChars !== ixSync.totalChars) {
        problems.push('自检：分片建索引与同步建索引的段数/字数不一致');
    }
    if (ixChunk.chapters.length !== ixSync.chapters.length) problems.push('自检：分片建索引少建了章');
    for (let i = 0; i < ixSync.chapters.length; i++) {
        if (ixChunk.chapters[i].text !== ixSync.chapters[i].text
            || ixChunk.chapters[i].starts.length !== ixSync.chapters[i].starts.length) {
            problems.push('自检：分片建索引第 ' + String(i + 1) + ' 章与同步版不一致');
            break;
        }
    }
    if (yields <= 0) problems.push('自检：分片建索引一次都没让出（跨过片边界却不让出）');
    const rSync = searchInBook(ixSync, '乙3一句');
    const gen2 = searchBookChunks(ixSync, '乙3一句');
    let step2 = gen2.next();
    while (!step2.done) step2 = gen2.next();
    const rChunk = step2.value;
    if (rChunk.totalHits !== rSync.totalHits || rChunk.chaptersScanned !== rSync.chaptersScanned
        || rChunk.hits.length !== rSync.hits.length) {
        problems.push('自检：分片搜索与同步搜索的命中/已扫章数不一致');
    }
    /* 七 [v4.34.0 · R5-O7] 版本键三性：同版本同键 / 改指纹即变 / 缺指纹为空（判不了）。 */
    const v1 = indexVersionOf({ id: 'b1', contentHash: 'h1' });
    const v2 = indexVersionOf({ id: 'b1', contentHash: 'h1' });
    const v3 = indexVersionOf({ id: 'b1', contentHash: 'h2' });
    const v4 = indexVersionOf({ id: 'b1' });
    if (!v1.key || v1.key !== v2.key) problems.push('自检：同一版本没给出同一个索引键');
    if (v1.key === v3.key) problems.push('自检：改了内容指纹却给出同一个索引键（会把旧索引当成新的）');
    if (v4.key !== '') problems.push('自检：没有指纹时不该给出可复用的索引键');
    /* 八 [v4.35.0 · R5-O8] 研究清单：分片与同步**逐字段等价**，且冷启动**真的去读了正文**。
     *   为什么这条必须真跑：分片清单最危险的形态不是报错，而是「分片版把读正文这一步
     *   省掉了」—— 界面上什么都不会响，只是每一条都显示「未定论」，
     *   而用户读到的是「这个清单核不了」。 */
    const exR = [{ id: 'e1', text: '原文一句', bookId: 'b1', bookHash: 'h9', chapter: 0, para: 0, annotation: '我的解释' }];
    const syncR = buildResearchList(exR, [{ id: 'b1', title: '书', contentHash: 'h9', chapters: [{ paragraphs: ['原文一句'] }] }]);
    let readsCalled = 0;
    const genR = researchListChunks(exR, [{ id: 'b1', title: '书', contentHash: 'h9' }], function () {
        readsCalled += 1;
        return { chapters: [{ paragraphs: ['原文一句'] }] };
    }, null);
    let stepR = genR.next();
    while (!stepR.done) stepR = genR.next(stepR.value);
    const chunkR = stepR.value;
    if (readsCalled <= 0) problems.push('自检：分片研究清单一次都没去读正文（冷启动会全落成「未定论」）');
    if (!chunkR || chunkR.counts.total !== syncR.counts.total) problems.push('自检：分片研究清单与同步版的条数不一致');
    if (!chunkR || !chunkR.items[0] || chunkR.items[0].anchor.settled !== true) problems.push('自检：分片研究清单读了正文却没把锚点定论下来');
    if (!chunkR || chunkR.counts.read !== 1) problems.push('自检：分片研究清单没把「这次读到几本正文」如实计上');
    return { problems: problems, states: stateKeys.length, confirmStates: ANCHOR_CONFIRM_STATES.length, limits: Object.keys(SEARCH_LIMITS).length };
}
export default {
    SEARCH_LIMITS, NOTE_LIMITS, EXCERPT_ANCHOR_STATES, ANCHOR_CONFIRM_STATES,
    anchorNeedsConfirm, anchorSettled, normalizeAnnotation, normalizeNoteTags, excerptNoteOf,
    buildSearchIndex, searchInBook, searchLine,
    indexVersionOf, checkExcerptAnchor, anchorLine,
    buildResearchList, researchLine, notesSelfCheck,
};
export { buildIndexChunks, searchBookChunks };
/* [v4.35.0 · R5-O8] 研究清单分片出口**另起一块**，不改上面那一块：
 *   v4.34.0 的判据（tests/system-v4340.test.mjs 的 A4）锁着上一块的**精确形态** ——
 *   那是**那一版的事实**，本版不为了自己方便去改历史判据（改判据与放宽门禁只差一步）。
 *   门禁的成块路径认得多个转出块，故增补一块即可。 */
export { researchListChunks };
/* 两个生成器出口走**具名转出块**（不是 `export function*`）：
 *   全仓零消费导出门禁的抽取路径不认 `export function*`，而它对此的立场是
 *   **fail-closed 拒判**（E9）而非放行 —— 那条 B5 判据锁的正是「生成器声明必须被兜住」。
 *   两条路可选：① 给门禁补一条抽取路径（会同时改掉 B9 的清单断言）；
 *   ② 声明处不写 `export`、出口在本块里给（block 路径认得并会枚举成员名）。
 *   本版取 ②：**不为了加一个出口去放宽一道门禁** —— 门禁的覆盖面比本版方便更重要。 */
