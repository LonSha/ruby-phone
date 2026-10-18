/* ========================================================
 * 阅读 (Reading) App — 数据层
 * 纯本地 TXT 小说阅读器：多编码自动探测 + 章节切分 + 智能分段 + 书架存档
 * 解析引擎借鉴 ai-virtual-phone reading-parser (AGPL 启发, 本文为原创重写)
 * 零 LLM 零依赖
 * ======================================================== */
'use strict';

// ---- 多编码自动探测 ----
const TXT_DECODER_CANDIDATES = ['utf-8', 'gb18030', 'gbk', 'big5', 'utf-16le', 'utf-16be'];

function decodeWithEncoding(buffer, encoding) {
    try {
        return new TextDecoder(encoding, { fatal: false }).decode(buffer).replace(/^\uFEFF/, '');
    } catch (e) {
        return null;
    }
}

// 对解码结果评分: 有效 CJK/标点/可读字符加分, 替换符/空字符/控制字符重罚
function scoreDecodedTxt(text) {
    const sample = text.slice(0, 24000);
    if (!sample.trim()) return -100000;
    const replacementCount = (sample.match(/\uFFFD/g) || []).length;
    const nulCount = (sample.match(/\u0000/g) || []).length;
    const controlCount = (sample.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
    const cjkCount = (sample.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
    const punctuationCount = (sample.match(/[，。！？；：“”‘’、（）《》…]/g) || []).length;
    const readableCount = (sample.match(/[A-Za-z0-9\s]/g) || []).length;
    return cjkCount * 3
        + punctuationCount * 2
        + readableCount * 0.15
        - replacementCount * 80
        - nulCount * 100
        - controlCount * 20;
}

/**
 * 解码 TXT 字节流为文本。自动探测编码，BOM 优先。
 * @param {ArrayBuffer} buffer 文件字节
 * @param {string} [preferredEncoding] 手动指定编码（auto/undefined = 自动）
 * @returns {{text: string, encoding: string}}
 */
export function decodeTxtArrayBuffer(buffer, preferredEncoding) {
    const bytes = new Uint8Array(buffer);
    const bomCandidates = [];
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        bomCandidates.push(['utf-8', true]);
    } else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        bomCandidates.push(['utf-16le', true]);
    } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
        bomCandidates.push(['utf-16be', true]);
    }
    for (const [encoding] of bomCandidates) {
        const text = decodeWithEncoding(buffer, encoding);
        if (text !== null) return { text, encoding };
    }
    if (preferredEncoding && preferredEncoding !== 'auto') {
        const text = decodeWithEncoding(buffer, preferredEncoding);
        if (text !== null) return { text, encoding: preferredEncoding };
        return { text: '', encoding: preferredEncoding };
    }
    let best = null;
    let bestScore = -Infinity;
    for (const encoding of TXT_DECODER_CANDIDATES) {
        const text = decodeWithEncoding(buffer, encoding);
        if (text === null) continue;
        const score = scoreDecodedTxt(text);
        if (score > bestScore) {
            bestScore = score;
            best = { text, encoding };
        }
    }
    return best || { text: decodeWithEncoding(buffer, 'utf-8') || '', encoding: 'utf-8' };
}

// ---- 章节识别 ----
const CHAPTER_PATTERNS = [
    /^第[零一二三四五六七八九十百千\d]+[章节回卷集篇]/,
    /^Chapter\s+\d+/i,
    /^CHAPTER\s+[IVXLCDM\d]+/,
    /^卷[零一二三四五六七八九十百千\d]+/,
    /^={3,}/,
    /^-{3,}/,
    /^#{1,3}\s+/
];

function isChapterHeading(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) return false;
    return CHAPTER_PATTERNS.some(p => p.test(trimmed));
}

// 剥离开头/结尾空行（下载 TXT 常插分隔空行）
function trimBlankEdges(arr) {
    let s = 0;
    let e = arr.length;
    while (s < e && arr[s].trim() === '') s += 1;
    while (e > s && arr[e - 1].trim() === '') e -= 1;
    return arr.slice(s, e);
}

// 段落格式探测：空行分段 / 缩进分段 / 一行一段
const LENIENT_TITLE_PATTERNS = [
    /^第[零一二三四五六七八九十百千\d]+[章节回卷集部篇]/,
    /^[序楔]/,
    /^(?:终章|后记|前言|番外|尾声|外传|引子)/,
    /^[Cc]hapter\s+\d+/,
    /^[Pp]art\s+[IVXLCDM\d]+/,
    /^[零一二三四五六七八九十百千\d]+[、.．:：]/,
    /^[（(][零一二三四五六七八九十百千\d]+[)）]/,
    /^《.+》$/,
    /^[=#*\-]{3,}$/
];

function isTitleLikeLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 40) return false;
    return LENIENT_TITLE_PATTERNS.some(p => p.test(trimmed));
}

// 统计「作者段落空行」（剔除紧邻标题的章节分隔空行）
function countAuthorBlankLines(lines) {
    const titleLike = new Set();
    lines.forEach((line, i) => {
        if (isTitleLikeLine(line)) titleLike.add(i);
    });
    const isBlank = i => i >= 0 && i < lines.length && lines[i].trim() === '';
    let count = 0;
    let i = 0;
    while (i < lines.length) {
        if (!isBlank(i)) { i += 1; continue; }
        const runStart = i;
        while (i < lines.length && isBlank(i)) i += 1;
        const runEnd = i - 1;
        const beforeTitle = runStart > 0 && titleLike.has(runStart - 1);
        const afterTitle = runEnd + 1 < lines.length && titleLike.has(runEnd + 1);
        if (!beforeTitle && !afterTitle) count += runEnd - runStart + 1;
    }
    return count;
}

function splitByBlankLines(lines) {
    const paragraphs = [];
    let current = [];
    for (const line of lines) {
        if (line.trim() === '') {
            if (current.length > 0) {
                paragraphs.push(current.join('\n').trim());
                current = [];
            }
        } else {
            current.push(line);
        }
    }
    if (current.length > 0) paragraphs.push(current.join('\n').trim());
    return paragraphs.filter(p => p.length > 0);
}

function isIndentedParagraphStart(line) {
    return /^\u3000/.test(line) || /^ {2,}/.test(line) || /^\t/.test(line);
}

function splitByIndent(lines) {
    const paragraphs = [];
    let current = [];
    const flush = () => {
        if (current.length > 0) {
            paragraphs.push(current.join('\n').trim());
            current = [];
        }
    };
    for (const line of lines) {
        if (line.trim() === '') {
            flush();
        } else if (isIndentedParagraphStart(line)) {
            flush();
            current.push(line);
        } else {
            current.push(line);
        }
    }
    flush();
    return paragraphs.filter(p => p.length > 0);
}

export function detectParagraphMode(lines) {
    const nonEmpty = lines.filter(l => l.trim() !== '');
    if (nonEmpty.length === 0) return 'line';
    const blankRatio = countAuthorBlankLines(lines) / Math.max(1, lines.length);
    const indentedRatio = nonEmpty.filter(isIndentedParagraphStart).length / nonEmpty.length;
    if (blankRatio >= 0.15) return 'blank';
    if (indentedRatio >= 0.2) return 'indent';
    if (blankRatio >= 0.02) return 'blank';
    return 'line';
}

function splitParagraphs(lines, mode = 'auto') {
    const nonEmpty = lines.filter(l => l.trim() !== '');
    if (nonEmpty.length === 0) return [];
    if (mode === 'blank') return splitByBlankLines(lines);
    if (mode === 'indent') return splitByIndent(lines);
    if (mode === 'line') return nonEmpty.map(l => l.trim()).filter(p => p.length > 0);
    const detected = detectParagraphMode(lines);
    if (detected === 'blank') return splitByBlankLines(lines);
    if (detected === 'indent') return splitByIndent(lines);
    return nonEmpty.map(l => l.trim()).filter(p => p.length > 0);
}

/**
 * 解析 TXT 文本为书名 + 章节数组。
 * @param {string} text 解码后的文本
 * @param {string} [fileName] 文件名（用于缺书名时兜底）
 * @param {string} [mode] auto/blank/indent/line
 * @returns {{title: string, chapters: {title: string, paragraphs: string[]}[]}}
 */
export function parseTxtContent(text, fileName, mode = 'auto') {
    const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const resolvedMode = mode === 'auto' ? detectParagraphMode(lines) : mode;
    const chapterStarts = [];
    for (let i = 0; i < lines.length; i++) {
        if (isChapterHeading(lines[i])) {
            chapterStarts.push({ lineIdx: i, title: lines[i].trim().replace(/^#{1,3}\s+/, '') });
        }
    }
    let bookTitle = (fileName || '').replace(/\.[^.]+$/, '') || '未命名';
    if (chapterStarts.length > 0 && chapterStarts[0].lineIdx > 0) {
        for (let i = 0; i < chapterStarts[0].lineIdx; i++) {
            if (lines[i].trim()) { bookTitle = lines[i].trim(); break; }
        }
    }
    if (chapterStarts.length === 0) {
        return {
            title: bookTitle,
            chapters: [{ title: '全文', paragraphs: splitParagraphs(trimBlankEdges(lines), resolvedMode) }]
        };
    }
    const chapters = [];
    for (let i = 0; i < chapterStarts.length; i++) {
        const start = chapterStarts[i].lineIdx + 1;
        const end = i + 1 < chapterStarts.length ? chapterStarts[i + 1].lineIdx : lines.length;
        const chapterLines = trimBlankEdges(lines.slice(start, end));
        const paragraphs = splitParagraphs(chapterLines, resolvedMode);
        if (paragraphs.length > 0) {
            chapters.push({ title: chapterStarts[i].title, paragraphs });
        }
    }
    if (chapterStarts[0].lineIdx > 1) {
        const prologueLines = trimBlankEdges(lines.slice(0, chapterStarts[0].lineIdx));
        const paragraphs = splitParagraphs(prologueLines, resolvedMode);
        if (paragraphs.length > 0) {
            chapters.unshift({ title: '序', paragraphs });
        }
    }
    return { title: bookTitle, chapters };
}

// ---- [v3.99.2 · R3-X8] 阅读标记层（纯函数：书签 / 划线 / 摘录，全部带书/章/段引用） ----
/** FNV-1a 32 位内容指纹（纯本地，识别「同名不同文件」）。 */
export function contentHashOf(text) {
    const t = String(text || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return 'h' + h.toString(16) + '_' + t.length;
}
/** 摘录条目净化与校验（窄口：缺引用的摘录不收——丢出处等于丢素材）。 */
export function normalizeExcerpt(entry) {
    const e = (entry && typeof entry === 'object') ? entry : {};
    const text = String(e.text || '').trim();
    const bookId = String(e.bookId || '').trim();
    const chapter = Number(e.chapter);
    const para = Number(e.para);
    if (!text || !bookId) return null;
    if (!Number.isInteger(chapter) || chapter < 0) return null;
    if (!Number.isInteger(para) || para < 0) return null;
    /* [v4.24.0 · R4-X8] id 前缀**只加一次**：本函数是幂等的净化口，二次净化（备份导出后再
     *   读回、列表重排）若再叠一层前缀，同一摘录的 id 每过一遍就长一截。
     *   ★ 前缀只拼一次的写法要**先算底串再拼**：`'ex_' + (x || y)` 里 `+` 优先于 `||`，
     *     写成 `'ex_' + x || y` 时空 id 会得到字面量 `'ex_'`（每一类空 id 撞成同一个）。 */
    const idBase = String(e.id || '').replace(/^ex_/, '').slice(0, 40)
        || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    return {
        id: 'ex_' + idBase,
        text: text.slice(0, 2000),
        bookId, bookTitle: String(e.bookTitle || ''),
        chapter, para,
        chapterTitle: String(e.chapterTitle || ''),
        createdAt: Number(e.createdAt) || Date.now(),
        /* [v4.24.0 · R4-X8] 三格笔记字段（改版判定与「批注不是原文」的物质基础）：
         *   · bookHash  —— 摘录时那本书的**内容指纹**。没有它，书改了版就无从比对，
         *                  回跳会静默落在另一段上（本项要治的第一个病）。
         *   · annotation——用户自己的解释。与 text（原文）**分格存放**，不掺。
         *   · tags      ——检索用的标签。
         *   旧条目（v3.99.2 及更早落的盘）没有这三格：读回来时 bookHash 为空，
         *   锚点核对会判成 UNPINNED「需确认」—— 这正是应有的处置，不补假指纹。 */
        bookHash: String(e.bookHash || ''),
        annotation: String(e.annotation || '').slice(0, 500),
        tags: Array.isArray(e.tags) ? e.tags.map(t => String(t)).filter(t => t.trim()).slice(0, 8) : []
    };
}
/** 摘录列表净化 + 上限（超限丢最旧，不静默膨胀存储）。 */
export function normalizeExcerptList(list, limit = 200) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (const it of arr) {
        const n = normalizeExcerpt(it);
        if (n) out.push(n);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, limit);
}
// ---- 书架存取 ----
export class ReadingData {
    constructor(storage) {
        this.storage = storage;
        this.KEY = 'ruby_reading_shelf';
        this.shelf = [];
        this._load();
    }
    _load() {
        try {
            const raw = this.storage?.get?.(this.KEY);
            if (raw) this.shelf = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
        } catch (e) { this.shelf = []; }
    }
    _save() {
        try {
            this.storage?.set?.(this.KEY, JSON.stringify(this.shelf));
        } catch (e) { /* 忽略 */ }
    }
    /* [v3.99.2 · R3-X8] 按内容指纹找既有条目：同名同指纹 ⇒ 重接（丢附件后重新导入回到原书、
     *   进度与标记不丢）；同名不同指纹 ⇒ 返回 null（由调用方决定并存，不静默覆盖）。 */
    findReusable(fileName, contentHash) {
        if (!fileName || !contentHash) return null;
        for (const b of this.shelf) {
            if (b.fileName === fileName && b.contentHash === contentHash) return b;
        }
        return null;
    }
    // 导入一本书到书架
    addBook(parsed, fileName, encoding, mode = 'auto', extra = {}) {
        const book = {
            id: 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            title: parsed.title,
            fileName: fileName || '',
            author: parsed.author || '',
            encoding: encoding || 'utf-8',
            format: parsed.format || 'txt',
            mode: mode,
            addedAt: Date.now(),
            chapterCount: parsed.chapters.length,
            // 章节内容存文件路径引用（惰性加载），书架列表不存正文，避免 chatMetadata 膨胀
            // 正文经 objectURL 或 dataURL 存于本 App 内存; 重启后需重新导入
            // [v3.99.2 · R3-X8] contentHash：同名不同文件（指纹不同）不再静默覆盖，两本并存。
            contentHash: extra.contentHash || '',
            hasContent: true
        };
        // 同名且同指纹：替换（同一文件重新导入，回到原书进度与标记）。
        // 同名但指纹不同：**不删旧条目**（同名不同文件并存，由返回值 coexist 告知调用方）。
        let replaced = false;
        let coexist = false;
        let reuseId = null;
        this.shelf = this.shelf.filter(b => {
            if (b.fileName === book.fileName) {
                if (b.contentHash === book.contentHash) { replaced = true; reuseId = b.id; return false; }
                coexist = true; return true;
            }
            return true;
        });
        /* 同指纹替换必须**继承旧 id**：进度键（ruby_reading_progress_<id>）与摘录引用
         *   （bookId）都指着旧 id，换新 id 等于把读者已积累的读数断链——重接的意思就是回到原书。 */
        if (reuseId) book.id = reuseId;
        this.shelf.unshift(book);
        this._save();
        return { bookId: book.id, chapters: parsed.chapters, title: parsed.title, author: parsed.author || '', format: parsed.format || 'txt', replaced, coexist, reusedId: reuseId };
    }

    /* [v4.21.0 · R4-O9] 收下**外来条目**(从书库包导入)。
     *   为什么不能走 addBook:addBook 按「文件名 + 指纹」判并存或替换,而导入侧的身份是
     *   **bookId**(进度键 ruby_reading_progress_<id> 与摘录引用都指着它)。
     *   若导入时按文件名另发一个新 id,「重复导入不产生双书」当场不成立 ——
     *   同一本书会在书架上出现两次,一次有进度、一次没有。
     *   故:同 id 就地更新(保留 addedAt 与进度键),异 id 追加;全程不抛。 */
    adoptBook(entry) {
        const e = (entry && typeof entry === 'object') ? entry : {};
        const id = String(e.id == null ? '' : e.id).trim();
        if (!id) return { ok: false, reason: 'no-subject' };
        const at = this.shelf.findIndex(b => b.id === id);
        const old = at >= 0 ? this.shelf[at] : null;
        const book = {
            id,
            title: String(e.title == null ? '' : e.title),
            fileName: String(e.fileName == null ? '' : e.fileName),
            author: String(e.author == null ? '' : e.author),
            encoding: String(e.encoding == null ? '' : e.encoding) || 'utf-8',
            format: String(e.format == null ? '' : e.format) || 'txt',
            mode: String(e.mode == null ? '' : e.mode) || 'auto',
            /* 导入进来的书**没有本机的导入时刻**:沿用旧条目的 addedAt(若这本本机有过),
             *   否则记导入时刻 —— 拿包里的 0 当 addedAt 会在书架上显示「1970 年 1 月 1 日」。 */
            addedAt: (old && old.addedAt) || Number(e.addedAt) || Date.now(),
            chapterCount: Number(e.chapterCount) || 0,
            contentHash: String(e.contentHash == null ? '' : e.contentHash),
            hasContent: true
        };
        if (at >= 0) this.shelf[at] = book; else this.shelf.unshift(book);
        this._save();
        return { ok: true, id, replaced: at >= 0, count: this.shelf.length };
    }
    removeBook(id) {
        this.shelf = this.shelf.filter(b => b.id !== id);
        this._save();
    }
    getBook(id) {
        return this.shelf.find(b => b.id === id) || null;
    }
    getBooks() {
        return this.shelf.slice();
    }
}

export default ReadingData;