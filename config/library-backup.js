/* ========================================================
 * config/library-backup.js — [v4.21.0 · 优化计划 R4-O9]
 *   本地书库随备份真正搬走（纯内核）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   本仓的书**不在** storage 里：正文活在 indexedDB（apps/reading/reading-attachment.js），
 *   而备份面（config/data-backup.js）的模型**只围绕 storage 键**——
 *   `enumerateKeys()` 枚举的是 storage 的会话面与全局面，附件层根本不在它的射程里。
 *   修前实测后果（三件用户真会遇到的事）：
 *     ① **换设备书架只剩空壳**：书目条目（storage 键）搬走了，正文（indexedDB）留在了旧机器，
 *        新机器上每本书点开都是一句「正文取不到」；
 *     ② **导出前看不清搬的是什么**：没有一处能说出「这次导出含几本正文、多少字节、
 *        哪些外链资源不会跟着走」——用户只能导出后到新机器上才发现书是空的；
 *     ③ **恢复只演了一半**：即便正文被搬过去，摘录与进度（各自独立的 storage 键）没人配对，
 *        书回来了但划线、摘录、读到第几段全丢。
 *
 * 【本模块只做四件事（纯函数，与 data-backup.js / capability-health.js 同范式）】
 *   ① **四段声明**：书库 = 书架条目 / 书籍正文 / 摘录标记 / 阅读进度。四段**必须一起搬**，
 *      「书回来了但正文没回来」是一本打不开的书（故每本都带 `complete`）。
 *   ② **引用教学**：逐书核四段引用（正文在不在、摘录指向哪、进度锚在哪），
 *      并单独列出**孤儿正文**（附件里有、书架上没有）与**悬空引用**（书架有、正文没有）。
 *   ③ **包体构建**：把四段装进一份带身份的包（魔标 / schema / 宿主版本 / 范围 / 计数），
 *      正文以文本随包（换设备原样落回附件层，正文 hash 不变）。
 *   ④ **导入计划**：逐书五态（新增 / 逐字相同 / 冲突 / 还原 / 拒收）**且带完整性**；
 *      正文、摘录、进度各有写口；**不完整的一律不写**（除非调用方显式允许部分导入）。
 *
 * 【不做什么（计划「不做」原文）】
 *   · **不静默下载外链图片**：包里只带书自己的正文文本；书中以 http(s) 引用的远端资源
 *     一律进 `LIB_UNINCLUDED` 如实列出，绝不替用户去网上取。
 *   · **不上传云端**：本模块里没有任何网络调用（无 fetch / XMLHttpRequest / new Image）。
 *   · **不把「完整手机备份」用于仅含元数据的包**：本模块的 `libraryScanLine` 会把
 *     「只搬了书目、没搬正文」这种半吊子状态**点名说穿**（元数据 ≠ 附件）。
 *   · 不写存储、不碰 DOM、不读文件系统、不带计时器（时间由调用方给）。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';

/* ───────── ① 四段声明 ───────── */

/** 包魔标与 schema 版本（**唯一真源**：导出侧与导入侧不许各写一份字面量）。
 *  与 data-backup.js 的 `yuzuki-phone-backup` **刻意不同**：那是「整台手机的 storage」，
 *  这是「书库（含 indexedDB 正文）」—— 两种包身份混用会让导入侧拿 storage 规则去读正文包。 */
export const LIB_MARK = 'yuzuki-phone-library';
export const LIB_SCHEMA_VERSION = 1;

/** 书库四段。四段**必须一起搬** —— 少任何一段，用户手里就是一本残缺的书。 */
export const LIB_SECTIONS = Object.freeze([
    Object.freeze({ key: 'shelf', label: '书架条目', note: '书名 / 文件指纹 / 来源格式（在哪本书架上）' }),
    Object.freeze({ key: 'body', label: '书籍正文', note: 'TXT / EPUB 全文（体积主体，落在本机附件层）' }),
    Object.freeze({ key: 'excerpt', label: '摘录标记', note: '书 / 章 / 段引用与摘录文本' }),
    Object.freeze({ key: 'progress', label: '阅读进度', note: '读到第几章、第几段（回跳要落在同一段）' }),
]);
export const LIB_SECTION_KEYS = Object.freeze(LIB_SECTIONS.map(function (d) { return d.key; }));

/** 正文载体的两种形态：文本（可随包，换设备原样落回）/ 引用（包里只有指针，搬不动）。 */
export const LIB_BODY_TRANSPORTS = Object.freeze({
    TEXT: 'text',      // 正文文本随包 —— 本模块唯一的「真搬走」
    REFERENCE: 'ref',  // 只有引用（对象 URL / 远端路径）—— 换设备即失效，故不得当已搬走
});

/**
 * 未包含清单。**这不是免责声明，是导出前要给用户看的那一屏**：
 * 用户有权在导出前知道「哪些东西不会跟着走」，而不是到新机器上才发现。
 */
export const LIB_UNINCLUDED = Object.freeze([
    Object.freeze({ key: 'remote', label: '远端资源', note: '书中以 http(s) 外链引用的图片 / 字体 —— 不替你去下载' }),
    Object.freeze({ key: 'other-device', label: '其它设备上的附件', note: '附件是本机存储：别的设备上的正文不在本机，搬不走' }),
    Object.freeze({ key: 'quota', label: '超出配额的部分', note: '写不进去的部分如实记为未包含，不做静默截断' }),
    Object.freeze({ key: 'memory-only', label: '仅在内存里的正文', note: '导入后尚未落进附件层的那一份（关掉页面即丢）' }),
]);

/** 上限（冻结）：与 apps/reading/reading-attachment.js 的 ATTACHMENT_LIMITS 同源口径，
 *  但本模块**不 import 它**（config 不得依赖 apps 的分层纪律）—— 两处数字必须一起改。 */
export const LIB_LIMITS = Object.freeze({
    bodies: 60,
    bodyBytes: 8 * 1024 * 1024,
    packBytes: 256 * 1024 * 1024,
});

/* ───────── 状态集 ───────── */

/** 包体六态（刻意不合并 unmarked 与 foreign，与 data-backup 同一个理由）。 */
export const LIB_PACK_STATES = Object.freeze({
    OK: 'ok',
    EMPTY: 'empty',
    NOT_OBJECT: 'not-object',
    UNMARKED: 'unmarked',
    FOREIGN: 'foreign',
    FUTURE: 'future',
});

/** 引用三态：四段之间的引用是否接得上。 */
export const LIB_REF_STATES = Object.freeze({
    LINKED: 'linked',     // 引用接上了（正文在 / 摘录指得到 / 进度锚得住）
    DANGLING: 'dangling', // 悬空：本机有引用、被指的那一段不在
    ORPHAN: 'orphan',     // 孤儿：那一段在、却没有任何引用它（删书漏删就是这一态）
});

/** 逐书导入判定五态（与 data-backup 的 BACKUP_ENTRY_STATES 同形，便于用户认知一致）。 */
export const LIB_ENTRY_STATES = Object.freeze({
    NEW: 'new',
    IDENTICAL: 'identical',
    CONFLICT: 'conflict',
    RESTORE: 'restore',
    REJECTED: 'rejected',
});

/** 正文落盘五态（与附件层 ATTACHMENT_STATES 同形 + 一个 oversize）。 */
export const LIB_BODY_STATES = Object.freeze({
    OK: 'ok',
    EMPTY: 'empty',
    MISSING: 'missing',
    UNAVAILABLE: 'unavailable',
    WRITER_ERROR: 'writer-error',
    OVERSIZE: 'oversize',
});

/** 迁移四态。 */
export const LIB_MIGRATE_STATES = Object.freeze({
    CURRENT: 'current',
    MIGRATED: 'migrated',
    TOO_OLD: 'too-old',
    FUTURE: 'future',
});
/** 迁移表（本版只有 v1，故为空；保留结构是为了下一版不必改签名）。 */
export const LIB_MIGRATIONS = Object.freeze([]);


/* ───────── ② 引用教学 ───────── */

function str(v) { return String(v == null ? '' : v).trim(); }

/**
 * 逐书核四段引用。
 * @param {{shelf?:Array, bodies?:Array, excerpts?:Array, progress?:Array}} input
 *   shelf    书架条目 `[{id,title,fileName,contentHash,format,...}]`
 *   bodies   附件层元数据 `[{bookId,bytes,contentHash,title}]`（**不含正文**：盘库不该把几 MB 读回内存）
 *   excerpts 摘录 `[{bookId,chapter,para,text}]`
 *   progress 进度 `[{bookId,chapter,para}]`
 * @returns {{books:Array, orphans:Array, counts:object}}
 */
export function refsOf(input) {
    const i = (input && typeof input === 'object') ? input : {};
    const shelf = Array.isArray(i.shelf) ? i.shelf : [];
    const bodies = Array.isArray(i.bodies) ? i.bodies : [];
    const excerpts = Array.isArray(i.excerpts) ? i.excerpts : [];
    const progress = Array.isArray(i.progress) ? i.progress : [];

    const bodyOf = new Map();
    for (const b of bodies) {
        const id = str(b && b.bookId);
        if (id) bodyOf.set(id, b);
    }
    const exOf = new Map();
    for (const e of excerpts) {
        const id = str(e && e.bookId);
        if (!id) continue;
        exOf.set(id, (exOf.get(id) || 0) + 1);
    }
    const pgOf = new Map();
    for (const p of progress) {
        const id = str(p && p.bookId);
        if (id) pgOf.set(id, p);
    }

    const claimed = new Set();
    const books = [];
    for (const s of shelf) {
        /* 书架条目在 storage 里叫 `id`,在书库包里叫 `bookId` —— 两种形态都要认。
         *   只认 `id` 的后果是探针实测出来的:把一份 bookId 形态的书架数组喂进来,
         *   这一支会把每一条**静默丢掉** ⇒ 导出的包「0 本」,而同一屏的扫描行还说「2 本」。
         *   静默空包与「书目搬走了、书是空的」是同一族形态:看起来没坏,只是东西没了。 */
        const bookId = str(s && (s.id || s.bookId));
        if (!bookId) continue;
        claimed.add(bookId);
        const body = bodyOf.get(bookId) || null;
        const nEx = exOf.get(bookId) || 0;
        const pg = pgOf.get(bookId) || null;
        /* 四段的在场性。正文**单独判指纹**：附件里那本正文是不是这本书的
         *   （同名不同文件并存时，光看 bookId 在场会把别人的正文当自己的）。 */
        const bodyHash = body ? str(body.contentHash) : '';
        const shelfHash = str(s.contentHash);
        const bodyRef = !body
            ? { state: LIB_REF_STATES.DANGLING, why: '书架里有这本书，附件层里没有它的正文（重启后打不开）' }
            : (bodyHash && shelfHash && bodyHash !== shelfHash
                ? { state: LIB_REF_STATES.DANGLING, why: '附件里的正文指纹与书架条目不符（可能是另一本书的正文）' }
                : { state: LIB_REF_STATES.LINKED, why: '' });
        books.push({
            bookId: bookId,
            title: str(s.title),
            fileName: str(s.fileName),
            contentHash: shelfHash,
            format: str(s.format),
            body: body ? {
                bookId: bookId,
                bytes: (typeof body.bytes === 'number') ? body.bytes : 0,
                contentHash: bodyHash,
                chapterCount: (typeof body.chapterCount === 'number') ? body.chapterCount : 0,
            } : null,
            excerptCount: nEx,
            progress: pg ? { chapter: Number(pg.chapter) || 0, para: Number(pg.para) || 0 } : null,
            refs: {
                body: bodyRef,
                excerpt: nEx > 0
                    ? { state: LIB_REF_STATES.LINKED, why: '' }
                    : { state: LIB_REF_STATES.DANGLING, why: '这本书还没有摘录（不是错，是空）' },
                progress: pg
                    ? { state: LIB_REF_STATES.LINKED, why: '' }
                    : { state: LIB_REF_STATES.DANGLING, why: '这本书还没有进度记录（从头读）' },
            },
            /* ★ 完整性只在**正文**这一格上判：摘录与进度为空是正常状态（新书就是空的），
             *   正文缺席才是「书打不开」。把空摘录判成不完整，会让每本新书都报残缺。 */
            complete: bodyRef.state === LIB_REF_STATES.LINKED,
        });
    }

    /* 孤儿正文：附件层里有、书架上没有任何条目引用它（删书漏删出来的那一类）。 */
    const orphans = [];
    for (const b of bodies) {
        const id = str(b && b.bookId);
        if (!id || claimed.has(id)) continue;
        orphans.push({
            bookId: id,
            title: str(b.title),
            bytes: (typeof b.bytes === 'number') ? b.bytes : 0,
            contentHash: str(b.contentHash),
        });
    }

    const withBody = books.filter(function (b) { return b.refs.body.state === LIB_REF_STATES.LINKED; }).length;
    return {
        books: books,
        orphans: orphans,
        counts: {
            books: books.length,
            withBody: withBody,
            withoutBody: books.length - withBody,
            orphans: orphans.length,
            excerpts: excerpts.length,
            progress: progress.length,
            bodyBytes: books.reduce(function (n, b) { return n + (b.body ? b.body.bytes : 0); }, 0),
        },
    };
}

/* ───────── ③ 包体构建 ───────── */

/** 正文文本的体积（UTF-8 近似 1:1，保守即可）。 */
export function bodyTextBytes(text) {
    const t = String(text == null ? '' : text);
    /* 逐字符算会把 8MB 的书跑成几十万次循环 × 每次正则 —— 本仓旧病。
     * 这里用「非 ASCII 记 3 字节、ASCII 记 1 字节」的保守估计（中文书 ≈ 字符数 × 2~3）。 */
    let ascii = 0;
    for (let i = 0; i < t.length; i++) { if (t.charCodeAt(i) < 128) ascii += 1; }
    return ascii + (t.length - ascii) * 3;
}

/**
 * 构建一份书库包。
 * @param {{hostVersion?:string, at?:number, source?:string, selection?:object,
 *          books?:Array, bodies?:Array, excerpts?:Array, progress?:Array}} input
 *   bodies 的形态：`[{bookId, chapters:[{title,paragraphs:[...]}]}]`（结构）或
 *   `[{bookId, text:'...'}]`（文本）；打包一律转成**文本**（换设备原样落回附件层）。
 * @returns {object} 包体（含身份、四段、逐书完整性、未包含清单、计数）
 */
export function buildLibraryPack(input) {
    const i = (input && typeof input === 'object') ? input : {};
    const refs = refsOf({
        shelf: i.books, bodies: (i.bodies || []).map(function (b) {
            return { bookId: b && b.bookId, bytes: (b && typeof b.bytes === 'number') ? b.bytes : 0, contentHash: b && b.contentHash, title: b && b.title, chapterCount: b && b.chapterCount };
        }), excerpts: i.excerpts, progress: i.progress,
    });

    /* 正文一律转文本。**引用型载体（REFERENCE）不得当作已搬走** ——
     *   对象 URL / 远端路径换设备即失效，包里带上它只会让新机器上多一本打不开的书。 */
    const rawBodies = Array.isArray(i.bodies) ? i.bodies : [];
    const textOf = new Map();
    const unconvertible = [];
    for (const b of rawBodies) {
        const id = str(b && b.bookId);
        if (!id) continue;
        let text = null;
        if (typeof b.text === 'string') text = b.text;
        else if (Array.isArray(b.chapters)) text = chaptersToText(b.chapters);
        if (text === null) { unconvertible.push(id); continue; }
        textOf.set(id, text);
    }

    const booksOut = [];
    const bodiesOut = [];
    let omittedBytes = 0;
    let oversize = 0;
    for (const bk of refs.books) {
        const text = textOf.get(bk.bookId);
        const row = {
            bookId: bk.bookId,
            title: bk.title,
            fileName: bk.fileName,
            contentHash: bk.contentHash,
            format: bk.format,
            excerptCount: bk.excerptCount,
            progress: bk.progress,
            complete: bk.complete,
            bodyIncluded: text !== undefined && text !== null,
            bodyBytes: 0,
        };
        if (row.bodyIncluded) {
            const bytes = bodyTextBytes(text);
            /* 超限**如实记未包含**，不截断：半个正文在新机器上是一本坏书。 */
            if (bytes > LIB_LIMITS.bodyBytes) {
                row.bodyIncluded = false;
                row.why = '正文 ' + String(bytes) + ' 字节超单本上限（' + String(LIB_LIMITS.bodyBytes) + '）—— 如实记为未包含，不截断';
                oversize += 1;
                omittedBytes += bytes;
            } else {
                row.bodyBytes = bytes;
                bodiesOut.push({
                    bookId: bk.bookId,
                    title: bk.title,
                    contentHash: bk.contentHash,
                    format: bk.format,
                    transport: LIB_BODY_TRANSPORTS.TEXT,
                    bytes: bytes,
                    text: text,
                });
            }
        } else {
            row.why = row.why || '包里没有这本书的正文（导出时附件层里就没有）';
            row.complete = false;
        }
        booksOut.push(row);
    }
    for (const id of unconvertible) {
        const row = booksOut.filter(function (b) { return b.bookId === id; })[0];
        if (row) { row.bodyIncluded = false; row.complete = false; row.why = '这本正文的载体只有引用（对象 URL / 远端路径），换设备即失效 —— 不当作已搬走'; }
    }

    const packBytes = bodiesOut.reduce(function (n, b) { return n + b.bytes; }, 0);
    const completeBooks = booksOut.filter(function (b) { return b.complete && b.bodyIncluded; }).length;

    return {
        mark: LIB_MARK,
        schemaVersion: LIB_SCHEMA_VERSION,
        hostVersion: String(i.hostVersion || ''),
        at: (typeof i.at === 'number') ? i.at : 0,
        source: String(i.source || 'local'),
        selection: (i.selection && typeof i.selection === 'object') ? i.selection : null,
        sections: LIB_SECTION_KEYS.slice(),
        books: booksOut,
        bodies: bodiesOut,
        excerpts: Array.isArray(i.excerpts) ? i.excerpts : [],
        progress: Array.isArray(i.progress) ? i.progress : [],
        refs: { orphans: refs.orphans },
        unincluded: LIB_UNINCLUDED,
        counts: {
            books: booksOut.length,
            completeBooks: completeBooks,
            partialBooks: booksOut.length - completeBooks,
            bodies: bodiesOut.length,
            bodyBytes: packBytes,
            omittedBytes: omittedBytes,
            oversize: oversize,
            orphans: refs.orphans.length,
            excerpts: Array.isArray(i.excerpts) ? i.excerpts.length : 0,
            progress: Array.isArray(i.progress) ? i.progress.length : 0,
        },
    };
}

/** 章节结构 → 文本（正文随包的唯一载体形态）。 */
export function chaptersToText(chapters) {
    const list = Array.isArray(chapters) ? chapters : [];
    const parts = [];
    for (const c of list) {
        parts.push('## ' + str(c && c.title));
        const ps = Array.isArray(c && c.paragraphs) ? c.paragraphs : [];
        for (const p of ps) parts.push(str(p));
    }
    return parts.join(String.fromCharCode(10));
}

/** 文本 → 章节结构（落回附件层时用）。**与 chaptersToText 严格互为逆运算**（往返不丢段）。 */
export function textToChapters(text) {
    const lines = String(text == null ? '' : text).split(String.fromCharCode(10));
    const out = [];
    let cur = null;
    for (const ln of lines) {
        if (ln.slice(0, 3) === '## ') {
            cur = { title: ln.slice(3), paragraphs: [] };
            out.push(cur);
        } else {
            if (!cur) { cur = { title: '', paragraphs: [] }; out.push(cur); }
            cur.paragraphs.push(ln);
        }
    }
    return out;
}

/** 包体一行读数；一节都不省（含未包含项 —— 导出前用户要看的就是这一行）。 */
export function libraryPackLine(pack) {
    if (!pack || typeof pack !== 'object') return '还没有书库包';
    const c = pack.counts || {};
    let s = '书库包 v' + String(pack.schemaVersion)
        + ' · ' + String(c.books || 0) + ' 本（完整 ' + String(c.completeBooks || 0)
        + ' / 缺正文 ' + String(c.partialBooks || 0) + '）'
        + ' · 正文 ' + String(c.bodies || 0) + ' 本 / ' + String(c.bodyBytes || 0) + ' 字节'
        + ' · 摘录 ' + String(c.excerpts || 0) + ' 条 · 进度 ' + String(c.progress || 0) + ' 本';
    if (c.orphans) s += ' · 孤儿正文 ' + String(c.orphans) + ' 本';
    if (c.omittedBytes) s += ' · 未包含 ' + String(c.omittedBytes) + ' 字节';
    s += ' · 不上传云端';
    return s;
}

/** 导出前那一屏读数：四段各自的在场性与**未包含项**。 */
export function libraryScanLine(refs) {
    if (!refs || !refs.counts) return '书库还没盘过';
    const c = refs.counts;
    let s = '书库扫描：' + String(c.books) + ' 本 · 有正文 ' + String(c.withBody)
        + ' · **缺正文 ' + String(c.withoutBody) + '**';
    if (c.orphans) s += ' · 孤儿正文 ' + String(c.orphans) + ' 本（附件里有、书架上没有）';
    if (c.withoutBody) s += ' ｜ 缺正文的那几本换设备后点开是空的（元数据 ≠ 附件）';
    return s;
}

/* ───────── ④ 读包 / 迁移 / 导入计划 ───────── */

/** 读一份包：空 / 非对象 / 无魔标 / 异类魔标 / 未来版本 / 通过。 */
export function readLibraryPack(raw, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const expectVer = numOrNull(o.expectVersion) === null ? LIB_SCHEMA_VERSION : numOrNull(o.expectVersion);
    if (raw === null || raw === undefined || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0)) {
        return { state: LIB_PACK_STATES.EMPTY, accepted: false, mark: '', schemaVersion: null, pack: null, why: '空包' };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { state: LIB_PACK_STATES.NOT_OBJECT, accepted: false, mark: '', schemaVersion: null, pack: null, why: '不是对象（数组或标量）' };
    }
    const mark = str(raw.mark || raw.type);
    const ver = numOrNull(raw.schemaVersion);
    if (!mark) {
        return { state: LIB_PACK_STATES.UNMARKED, accepted: true, mark: '', schemaVersion: ver, pack: raw, why: '旧版导出（无魔标）：按兼容面收下，但下面必须走迁移' };
    }
    if (mark !== LIB_MARK) {
        return { state: LIB_PACK_STATES.FOREIGN, accepted: false, mark: mark, schemaVersion: ver, pack: null, why: '有魔标但不是书库包：' + mark };
    }
    if (ver !== null && ver > expectVer) {
        return { state: LIB_PACK_STATES.FUTURE, accepted: false, mark: mark, schemaVersion: ver, pack: null, why: '包比本机新（包 v' + String(ver) + ' > 本机 v' + String(expectVer) + '）—— 不猜字段，明确拒' };
    }
    return { state: LIB_PACK_STATES.OK, accepted: true, mark: mark, schemaVersion: ver, pack: raw, why: 'ok' };
}

/** 迁移判定：只有两条路（明确迁移 / 明确拒绝），与 data-backup 同规。 */
export function migrateLibraryPack(pack, target) {
    const to = numOrNull(target) === null ? LIB_SCHEMA_VERSION : numOrNull(target);
    const steps = [];
    if (!pack || typeof pack !== 'object') {
        return { state: LIB_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '包体不可读' };
    }
    const rawVer = pack.schemaVersion;
    const absent = (rawVer === null || rawVer === undefined || rawVer === '');
    const ver = absent ? null : numOrNull(rawVer);
    if (absent || ver === null) {
        return { state: LIB_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '无 schema 版本（不属于任何一代）—— 明确拒，不猜' };
    }
    if (ver > to) {
        return { state: LIB_MIGRATE_STATES.FUTURE, pack: null, steps: steps, why: '包 v' + String(ver) + ' > 本机 v' + String(to) };
    }
    let cur = ver;
    const hops = LIB_MIGRATIONS.filter(function (m) { return m.from >= cur && m.to <= to && m.from < to; })
        .sort(function (a, b) { return a.from - b.from; });
    let probe = cur;
    for (const m of hops) {
        if (m.from !== probe) {
            return { state: LIB_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '缺 v' + String(probe) + ' -> v' + String(probe + 1) + ' 的迁移步（不跳步改写）' };
        }
        probe = m.to;
    }
    if (hops.length && probe !== to) {
        return { state: LIB_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '迁移链未达目标版（到 v' + String(probe) + ' 为止）' };
    }
    for (const m of hops) {
        steps.push({ from: m.from, to: m.to, why: m.why });
        cur = m.to;
    }
    if (cur === to) {
        return {
            state: steps.length ? LIB_MIGRATE_STATES.MIGRATED : LIB_MIGRATE_STATES.CURRENT,
            pack: pack, steps: steps,
            why: steps.length ? ('已按 ' + String(steps.length) + ' 步迁移到 v' + String(to)) : '已是当版',
        };
    }
    return { state: LIB_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '无法从 v' + String(ver) + ' 迁到 v' + String(to) };
}

/**
 * 逐书导入判定：五态 + 完整性。
 * @param {object} pack 书库包
 * @param {{shelf?:Array, bodyIds?:Array, tombstones?:Array}} local
 *   shelf    本机书架条目 `[{id,contentHash}]`
 *   bodyIds  本机附件层**已有正文**的 bookId 列表
 *   tombstones 本机曾存在、已被删的 bookId（还原与新增分开）
 * @returns {{rows:Array, totals:object}}
 */
export function planLibraryImport(pack, local, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const sel = (o.selection && typeof o.selection === 'object') ? o.selection : null;
    const allowPartial = o.allowPartial === true;
    const l = (local && typeof local === 'object') ? local : {};
    const shelf = Array.isArray(l.shelf) ? l.shelf : [];
    const bodyIds = new Set(Array.isArray(l.bodyIds) ? l.bodyIds.map(String) : []);
    const tombstones = new Set(Array.isArray(l.tombstones) ? l.tombstones.map(String) : []);

    const shelfMap = new Map();
    for (const s of shelf) {
        const id = str(s && (s.id || s.bookId));
        if (id) shelfMap.set(id, s);
    }

    const books = Array.isArray(pack && pack.books) ? pack.books : [];
    const bodiesById = new Map();
    for (const b of (Array.isArray(pack && pack.bodies) ? pack.bodies : [])) {
        const id = str(b && b.bookId);
        if (id) bodiesById.set(id, b);
    }

    const rows = [];
    for (const bk of books) {
        const bookId = str(bk && bk.bookId);
        if (!bookId) continue;
        let state;
        let why = '';
        if (sel && !libraryEntrySelected(bk, sel)) {
            state = LIB_ENTRY_STATES.REJECTED;
            why = '不在所选导入范围里';
        } else if (!shelfMap.has(bookId)) {
            state = tombstones.has(bookId) ? LIB_ENTRY_STATES.RESTORE : LIB_ENTRY_STATES.NEW;
            why = tombstones.has(bookId) ? '本机曾有过这本书、已被删（墓碑）：还原而非新增' : '本机没有这本书';
        } else {
            const cur = shelfMap.get(bookId);
            const sameHash = str(cur.contentHash) === str(bk.contentHash);
            state = sameHash ? LIB_ENTRY_STATES.IDENTICAL : LIB_ENTRY_STATES.CONFLICT;
            why = sameHash ? '本机已有且文件指纹相同（重复导入不改不写）' : '本机已有但文件指纹不同（同名不同文件）';
        }
        /* ★ 完整性：这一本的四段在包里齐不齐。
         *   不完整的一律**默认不写** —— 「书回来了但正文没回来」正是本项要治的病。 */
        const bodyInPack = bodiesById.get(bookId) || null;
        const hasBodyInPack = !!(bodyInPack && typeof bodyInPack.text === 'string');
        const complete = !!(bk.bodyIncluded && hasBodyInPack);
        if (!complete && state !== LIB_ENTRY_STATES.REJECTED && !allowPartial) {
            state = LIB_ENTRY_STATES.REJECTED;
            why = (bk.why ? bk.why + '；' : '') + '本书四段不全（缺正文）—— 不完整不写，换新机后点开是空的';
        }
        rows.push({
            bookId: bookId,
            title: str(bk.title),
            state: state,
            why: why,
            complete: complete,
            hasBody: hasBodyInPack,
            bodyBytes: hasBodyInPack ? Number(bodyInPack.bytes) || 0 : 0,
            excerptCount: Number(bk.excerptCount) || 0,
            hasProgress: !!(bk.progress && (typeof bk.progress.chapter === 'number')),
            bodyKnown: bodyIds.has(bookId),
        });
    }

    const count = (s) => rows.filter(function (r) { return r.state === s; }).length;
    return {
        rows: rows,
        totals: {
            total: rows.length,
            new: count(LIB_ENTRY_STATES.NEW),
            identical: count(LIB_ENTRY_STATES.IDENTICAL),
            conflict: count(LIB_ENTRY_STATES.CONFLICT),
            restore: count(LIB_ENTRY_STATES.RESTORE),
            rejected: count(LIB_ENTRY_STATES.REJECTED),
            complete: rows.filter(function (r) { return r.complete; }).length,
            partial: rows.filter(function (r) { return !r.complete; }).length,
            bodyBytes: rows.reduce(function (n, r) { return n + r.bodyBytes; }, 0),
        },
    };
}

/** 选择面：给定 selection 判定一本书在不在范围里（多维取**交集**）。 */
export function libraryEntrySelected(book, selection) {
    const s = (selection && typeof selection === 'object') ? selection : null;
    if (!s) return true;
    const b = (book && typeof book === 'object') ? book : {};
    const one = (dim, val) => {
        const want = s[dim];
        if (want === undefined || want === null) return true;
        const list = Array.isArray(want) ? want.map(String) : [String(want)];
        if (!list.length) return true;
        return list.indexOf(String(val || '')) >= 0;
    };
    return one('format', b.format) && one('book', b.bookId);
}

/**
 * 提交计划：把逐书判定变成**四段各自的写计划**。
 *   · identical 一律不写（幂等）；
 *   · conflict 按 onConflict（keep / overwrite / skip）处置，默认 keep；
 *   · rejected 一律不写；
 *   · 正文写口与书架写口**分开列**（调用方还要把正文喂给附件层，那是异步的）。
 * @returns {{shelfWrites:Array, bodyWrites:Array, excerptWrites:Array, progressWrites:Array, skipped:Array, counts:object, ok:boolean}}
 */
export function commitLibraryImport(plan, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const onConflict = ['keep', 'overwrite', 'skip'].indexOf(String(o.onConflict || 'keep')) >= 0 ? String(o.onConflict || 'keep') : 'keep';
    const rows = (plan && Array.isArray(plan.rows)) ? plan.rows : [];
    const shelfWrites = [];
    const bodyWrites = [];
    const excerptWrites = [];
    const progressWrites = [];
    const skipped = [];
    for (const r of rows) {
        if (r.state === LIB_ENTRY_STATES.REJECTED) { skipped.push({ bookId: r.bookId, why: r.why }); continue; }
        if (r.state === LIB_ENTRY_STATES.CONFLICT) {
            if (onConflict !== 'overwrite') {
                skipped.push({ bookId: r.bookId, why: onConflict === 'keep' ? '冲突：保留本机现有书' : '冲突：用户选择跳过' });
                continue;
            }
        }
        if (r.state === LIB_ENTRY_STATES.IDENTICAL) {
            /* 逐字相同：既不写也不跳（混进任何一边都会让「导两次多出一堆」看不出来）。
             *   但**正文缺席**时仍要补写正文 —— 那正是本项要治的半吊子状态。 */
            if (r.hasBody && !r.bodyKnown) bodyWrites.push({ bookId: r.bookId, kind: 'body-fill' });
            continue;
        }
        shelfWrites.push({ bookId: r.bookId, kind: r.state });
        if (r.hasBody) bodyWrites.push({ bookId: r.bookId, kind: r.state });
        if (r.excerptCount > 0) excerptWrites.push({ bookId: r.bookId, kind: r.state });
        if (r.hasProgress) progressWrites.push({ bookId: r.bookId, kind: r.state });
    }
    return {
        shelfWrites: shelfWrites,
        bodyWrites: bodyWrites,
        excerptWrites: excerptWrites,
        progressWrites: progressWrites,
        skipped: skipped,
        counts: {
            shelf: shelfWrites.length,
            bodies: bodyWrites.length,
            excerpts: excerptWrites.length,
            progress: progressWrites.length,
            skipped: skipped.length,
        },
        ok: true,
    };
}

/** 撤销计划：只撤本次写入（按写入逆序）。 */
export function undoLibraryImport(commit) {
    const c = (commit && typeof commit === 'object') ? commit : {};
    const shelf = Array.isArray(c.shelfWrites) ? c.shelfWrites : [];
    const bodies = Array.isArray(c.bodyWrites) ? c.bodyWrites : [];
    const undone = [];
    /* ★ 正文一律以「删掉本次写进去的那份」来撤。为什么不是按 kind 分叉：
     *   本机在导入前的状态只有三种 —— 本来没有这本书（new）/ 本来有、已被删（restore）/
     *   本来有书但正文缺席（body-fill）。三种情况下「撤掉本次写入的正文」都是**同一件事**：
     *   删掉它。修前按 body-fill 分叉，于是本次**新增**那几本的正文被判成 `restore-body`
     *   —— App 侧没有这个动作，兜底分支把它计成「已撤销」，读数报成功而附件仍在。
     *   假成功比失败更坏：用户不会去检查附件层，那几份正文就一直占着本机存储。 */
    for (const w of bodies.slice().reverse()) undone.push({ bookId: w.bookId, action: 'remove-body', kind: w.kind });
    /* ★ 书架条目同理：撤本次写入就是**把本次加上去的条目删掉**。
     *   还原（restore）情形也一样 —— 本机导入前没有这个条目，删掉即回到原状。
     *   修前按 kind 分叉产出 `restore-book`，而 App 侧不认识这个动作
     *   （它只会删条目，不会把一本书「恢复成被删状态」）⇒ 同样落进兜底分支。
     *   两处合起来才是完整的「撤销动作只出 App 认识的那两种」。 */
    for (const w of shelf.slice().reverse()) undone.push({ bookId: w.bookId, action: 'remove-book', kind: w.kind });
    return { undo: undone, count: undone.length, note: undone.length ? '按写入逆序列出（正文与书架条目都要撤）' : '本次没有写入，无可撤' };
}

/** 导入计划一行读数。 */
export function libraryPlanLine(plan, commit) {
    if (!plan) return '还没有导入计划';
    const t = plan.totals || {};
    let s = '新增 ' + String(t.new || 0) + ' · 还原 ' + String(t.restore || 0)
        + ' · 逐字相同 ' + String(t.identical || 0) + ' · 冲突 ' + String(t.conflict || 0)
        + ' · 拒收 ' + String(t.rejected || 0)
        + ' ｜ 四段齐 ' + String(t.complete || 0) + ' 本 / 不全 ' + String(t.partial || 0) + ' 本';
    if (commit) {
        s += ' ｜ 将写 书架 ' + String(commit.counts.shelf) + ' / 正文 ' + String(commit.counts.bodies)
            + ' / 摘录 ' + String(commit.counts.excerpts) + ' / 进度 ' + String(commit.counts.progress);
    }
    return s;
}

/* ───────── ⑤ 自检 ───────── */

export function librarySelfCheck() {
    const problems = [];
    if (LIB_SECTION_KEYS.length !== 4) problems.push('书库应为四段，实际 ' + String(LIB_SECTION_KEYS.length));
    if (!LIB_UNINCLUDED.length) problems.push('未包含项必须常驻（用户有权在导出前看到）');

    /* 一 四段齐：有正文的书 complete=true，缺正文的 false。 */
    const shelf = [{ id: 'b1', title: '甲', contentHash: 'h1', format: 'txt' },
                   { id: 'b2', title: '乙', contentHash: 'h2', format: 'txt' }];
    const bodiesMeta = [{ bookId: 'b1', bytes: 10, contentHash: 'h1', chapterCount: 2 }];
    const refs = refsOf({ shelf: shelf, bodies: bodiesMeta, excerpts: [{ bookId: 'b1', chapter: 0, para: 1, text: 'x' }], progress: [{ bookId: 'b1', chapter: 1, para: 3 }] });
    if (refs.counts.withBody !== 1) problems.push('有正文应为 1 本，实际 ' + String(refs.counts.withBody));
    if (refs.counts.withoutBody !== 1) problems.push('缺正文应为 1 本，实际 ' + String(refs.counts.withoutBody));
    if (refs.books[1].complete !== false) problems.push('缺正文的书 complete 必须为 false');
    if (!libraryScanLine(refs).includes('缺正文')) problems.push('扫描读数必须点名缺正文（元数据 ≠ 附件）');

    /* 二 往返：chaptersToText 与 textToChapters 互为逆（不丢段）。 */
    const chapters = [{ title: '第一章', paragraphs: ['甲', '乙'] }, { title: '第二章', paragraphs: ['丙'] }];
    const back = textToChapters(chaptersToText(chapters));
    if (back.length !== 2) problems.push('往返后章数应 2，实际 ' + String(back.length));
    if (back[0].paragraphs.join('|') !== '甲|乙') problems.push('往返后段落不一致');

    /* 三 包体：正文随包、计数、未包含项到位。 */
    const pack = buildLibraryPack({
        hostVersion: 'x', at: 1, source: 'local',
        books: shelf, bodies: [{ bookId: 'b1', chapters: chapters }],
        excerpts: [{ bookId: 'b1', chapter: 0, para: 1, text: 'x' }],
        progress: [{ bookId: 'b1', chapter: 1, para: 3 }],
    });
    if (pack.mark !== LIB_MARK) problems.push('包魔标不对');
    if (pack.counts.bodies !== 1) problems.push('包里应有 1 本正文，实际 ' + String(pack.counts.bodies));
    if (pack.counts.completeBooks !== 1) problems.push('完整书应 1 本，实际 ' + String(pack.counts.completeBooks));
    if (pack.counts.partialBooks !== 1) problems.push('缺正文书应 1 本，实际 ' + String(pack.counts.partialBooks));
    if (pack.bodies[0].transport !== LIB_BODY_TRANSPORTS.TEXT) problems.push('正文载体必须是文本');
    if (!libraryPackLine(pack).includes('不上传云端')) problems.push('一行读数必须写明不上传云端');

    /* 四 不完整不写（本项的核心纪律）。 */
    const plan = planLibraryImport(pack, { shelf: [], bodyIds: [] }, {});
    if (plan.totals.rejected < 1) problems.push('缺正文的那本必须被拒（不完整不写）');
    const rowB2 = plan.rows.filter(function (r) { return r.bookId === 'b2'; })[0];
    if (!rowB2 || rowB2.state !== LIB_ENTRY_STATES.REJECTED) problems.push('缺正文的书状态应为 rejected');
    const planAllow = planLibraryImport(pack, { shelf: [], bodyIds: [] }, { allowPartial: true });
    if (planAllow.totals.rejected !== 0) problems.push('显式允许部分导入时不得再拒');

    /* 五 幂等：第二次导入全 identical 且不产生写入。 */
    const local = { shelf: [{ id: 'b1', contentHash: 'h1' }], bodyIds: ['b1'] };
    const plan2 = planLibraryImport(pack, local, {});
    if (plan2.totals.identical !== 1) problems.push('指纹相同应记 identical，实际 ' + String(plan2.totals.identical));
    const c2 = commitLibraryImport(plan2, {});
    if (c2.counts.shelf !== 0) problems.push('逐字相同不得产生书架写入，实际 ' + String(c2.counts.shelf));

    /* 六 正文缺席时即使书架逐字相同，也必须补写正文（半吊子状态的解药）。 */
    const localNoBody = { shelf: [{ id: 'b1', contentHash: 'h1' }], bodyIds: [] };
    const c3 = commitLibraryImport(planLibraryImport(pack, localNoBody, {}), {});
    if (c3.counts.bodies !== 1) problems.push('本机缺正文时必须补写正文，实际 ' + String(c3.counts.bodies));

    /* 七 冲突默认保留本机。 */
    const localConflict = { shelf: [{ id: 'b1', contentHash: 'DIFFERENT' }], bodyIds: ['b1'] };
    const planC = planLibraryImport(pack, localConflict, {});
    const rowC = planC.rows.filter(function (r) { return r.bookId === 'b1'; })[0];
    if (!rowC || rowC.state !== LIB_ENTRY_STATES.CONFLICT) problems.push('指纹不同应记冲突');
    const cKeep = commitLibraryImport(planC, {});
    if (cKeep.shelfWrites.some(function (w) { return w.bookId === 'b1'; })) problems.push('冲突默认必须保留本机');
    const cOver = commitLibraryImport(planC, { onConflict: 'overwrite' });
    if (cOver.shelfWrites.filter(function (w) { return w.bookId === 'b1'; }).length !== 1) problems.push('显式 overwrite 时才允许写');

    /* 八 读包六态 + 迁移两条路。 */
    if (readLibraryPack(null).state !== LIB_PACK_STATES.EMPTY) problems.push('空包状态不对');
    if (readLibraryPack([]).state !== LIB_PACK_STATES.NOT_OBJECT) problems.push('数组必须记为 not-object');
    if (readLibraryPack({ books: [] }).state !== LIB_PACK_STATES.UNMARKED) problems.push('无魔标应记为 unmarked');
    if (readLibraryPack({ mark: 'x' }).state !== LIB_PACK_STATES.FOREIGN) problems.push('异类魔标应记为 foreign');
    if (readLibraryPack({ mark: LIB_MARK, schemaVersion: 99 }).state !== LIB_PACK_STATES.FUTURE) problems.push('未来版本应记为 future');
    if (readLibraryPack(pack).state !== LIB_PACK_STATES.OK) problems.push('本版包应通过');
    if (migrateLibraryPack({ mark: LIB_MARK, schemaVersion: null }, 1).state !== LIB_MIGRATE_STATES.TOO_OLD) problems.push('无版本号必须明确拒');
    if (migrateLibraryPack({ mark: LIB_MARK, schemaVersion: 9 }, 1).state !== LIB_MIGRATE_STATES.FUTURE) problems.push('未来版本必须明确拒');
    if (migrateLibraryPack(pack, 1).state !== LIB_MIGRATE_STATES.CURRENT) problems.push('当版包应记为 current');

    /* 九 撤销：四段都要撤。 */
    const cAll = commitLibraryImport(planLibraryImport(pack, { shelf: [], bodyIds: [] }, { allowPartial: true }), {});
    const undo = undoLibraryImport(cAll);
    if (undo.count < 2) problems.push('撤销应至少覆盖正文与书架两项，实际 ' + String(undo.count));

    /* 十 孤儿正文与悬空引用必须分得开。 */
    const refs2 = refsOf({ shelf: [], bodies: [{ bookId: 'b9', bytes: 1, contentHash: 'h9', title: '孤儿' }] });
    if (refs2.counts.orphans !== 1) problems.push('孤儿正文应 1 本，实际 ' + String(refs2.counts.orphans));

    /* 十一 正文落盘六态与导入计划读数：这两处导出必须**真被消费**（不是摆出来的枚举）。 */
    const bodyStates = Object.keys(LIB_BODY_STATES).map(function (k) { return LIB_BODY_STATES[k]; });
    if (new Set(bodyStates).size !== bodyStates.length) problems.push('正文落盘态必须互不同值');
    if (bodyStates.indexOf(LIB_BODY_STATES.OK) < 0 || bodyStates.indexOf(LIB_BODY_STATES.OVERSIZE) < 0) problems.push('正文落盘态必须含 ok 与 oversize');
    const planAll = planLibraryImport(pack, { shelf: [], bodyIds: [] }, { allowPartial: true });
    const line = libraryPlanLine(planAll, commitLibraryImport(planAll, {}));
    if (!line.includes('四段齐')) problems.push('导入计划读数必须含「四段齐」（元数据 ≠ 附件，这一格是给用户看的）');
    if (!line.includes('正文')) problems.push('导入计划读数必须逐段列出将写哪些面');

    return { problems: problems, sections: LIB_SECTION_KEYS.length, schema: LIB_SCHEMA_VERSION, unincluded: LIB_UNINCLUDED.length };
}

/* ───────── ⑥ 导出清单 ───────── */

export default {
    LIB_MARK,
    LIB_SCHEMA_VERSION,
    LIB_SECTIONS,
    LIB_SECTION_KEYS,
    LIB_BODY_TRANSPORTS,
    LIB_UNINCLUDED,
    LIB_LIMITS,
    LIB_PACK_STATES,
    LIB_REF_STATES,
    LIB_ENTRY_STATES,
    LIB_BODY_STATES,
    LIB_MIGRATE_STATES,
    LIB_MIGRATIONS,
    refsOf,
    bodyTextBytes,
    buildLibraryPack,
    chaptersToText,
    textToChapters,
    libraryPackLine,
    libraryScanLine,
    readLibraryPack,
    migrateLibraryPack,
    planLibraryImport,
    libraryEntrySelected,
    commitLibraryImport,
    undoLibraryImport,
    libraryPlanLine,
    librarySelfCheck,
};
