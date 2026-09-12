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
    // 导入一本书到书架
    addBook(text, fileName, encoding, mode = 'auto') {
        const parsed = parseTxtContent(text, fileName, mode);
        const book = {
            id: 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            title: parsed.title,
            fileName: fileName || '',
            encoding: encoding || 'utf-8',
            mode: mode,
            addedAt: Date.now(),
            chapterCount: parsed.chapters.length,
            // 章节内容存文件路径引用（惰性加载），书架列表不存正文，避免 chatMetadata 膨胀
            // 正文经 objectURL 或 dataURL 存于本 App 内存; 重启后需重新导入
            hasContent: true
        };
        // 同名覆盖：已存在同样文件名的书直接替换
        let replaced = false;
        this.shelf = this.shelf.filter(b => {
            if (b.fileName === book.fileName) { replaced = true; return false; }
            return true;
        });
        this.shelf.unshift(book);
        this._save();
        return { bookId: book.id, chapters: parsed.chapters, title: parsed.title, replaced };
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