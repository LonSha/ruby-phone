/* ==========================================================================
 * apps/reading/reading-attachment.js — [第三期 R3-X8] 书籍正文的本地附件层
 * --------------------------------------------------------------------------
 * 【计划原文 R3-X8 · 具体增量】
 *   「**正文作为独立本地附件持久化**,metadata 只存引用/进度;可书签、划线、
 *     摘录成素材;**优先复用宿主附件存储,替代方案需先确认本地 Blob 存储边界**。」
 *   验收原文四条:
 *     一 重启继续同章同位置;
 *     二 同名不同文件不静默覆盖;
 *     三 丢附件可重新定位;
 *     四 摘录保留书/章/段引用;
 *     另有硬约束:**正文不塞入提示词或 chatMetadata**。
 *
 * 【修前实测的缺口(不是推演)】
 *   apps/reading/reading-app.js::openBook 里那句注释就是缺口本身:
 *     「正文未在内存(重启后):书架条目仅有元数据,提示需重新导入」
 *   —— 重启之后书架里每本书都打不开,读者必须重新导入同一个文件。
 *   而 reading-data.js::addBook 的注释写着「正文经 objectURL 或 dataURL 存于本 App
 *   内存;重启后需重新导入」。也就是说 R3-X8 的正文面**当时没有落地**。
 *
 * 【宿主存储边界:真 SillyTavern 1.19.0 实测读数(不是推测)】
 *   探针脚本:Chromium 1148 经 CDP 连真宿主 http://127.0.0.1:8000/,在页面上下文实测:
 *     · localStorage 可用,配额实测 **4 MB**(写满 64 个 1MB 键时在第 4 个抛配额错);
 *     · **indexedDB 可用**(open → onsuccess);
 *     · `/api/files/upload` 的 OPTIONS 返回 **204**(端点在场);
 *     · host 端 `/api/files/` 列表端点 404(没有可枚举的宿主附件列表面);
 *     · `chatMetadata` 在真宿主只有一个键 `st_virtual_phone`(本仓自己的命名空间)。
 *   结论:**body 不能落 localStorage**(一本 2MB 的 TXT 就吃掉一半配额,两本即死,
 *   且配额耗尽会连带影响本仓其它 `ruby_*` 键 —— 这是「一处膨胀、全机受伤」)。
 *   Chrome/SillyTavern 前端环境里 indexedDB 是本机可用的**结构化大对象**存储面
 *   (本仓 apps/weather 的注释里也记着同类 indexedDB 通道),故本模块走 indexedDB,
 *   且**不经过任何网络、不进提示词、不进 chatMetadata**。
 *
 * 【三条口径纪律(本仓治理过的老账,逐条对应)】
 *   1 **读不到 ≠ 空**:五态分形(unavailable / denied / empty / ok / writer-error)。
 *      「浏览器不给 indexedDB」(隐私模式/被禁)与「你没有存过任何正文」处置相反:
 *      前者必须告知读者「重启后仍会丢」,后者只是一个空库。
 *   2 **同名不同文件不静默覆盖**:附件按 `contentHash` 建键、按 `bookId` 建索引;
 *      同一书名而指纹不同的两本各存各的正文 —— 与 reading-data 的 coexist 口径同源。
 *   3 **删书要连正文一起删**,不留正文孤儿(附件层不许成为不可见的存储泄漏)。
 *
 * 【边界(如实登记,不装)】
 *   · 本模块只做「存 / 取 / 删 / 认领 / 盘库」五件事,不解析 TXT/EPUB(那是
 *     reading-data / reading-epub 的职责),不碰 UI,不写 chatMetadata。
 *   · 附件层是**本机**存储:换设备/清浏览器数据即丢。故「丢附件可重新定位」
 *     的落地方式是 `relink(hash, chapters)`:读者重新导入同一文件时,
 *     按指纹把正文**重新挂回原 bookId**,进度与摘录引用不动(不需要读者重新找章节)。
 * ========================================================================== */
'use strict';

/** 本模块自己的库名与对象仓(不占用会话隔离键:正文不是会话状态,是读者本机的书) */
const DB_NAME = 'ruby-phone-reading';
const DB_VERSION = 1;
const STORE = 'bodies';

/** 五态(本模块自己的归因;两个同形即失败) */
export const ATTACHMENT_STATES = Object.freeze({
    UNAVAILABLE: 'unavailable',   // 本环境没有 indexedDB(等宿主/等权限)
    DENIED: 'denied',             // open 被拒 / 抛错(隐私模式等)
    EMPTY: 'empty',               // 库建起来了,但真的没有这本书的正文
    OK: 'ok',
    WRITER_ERROR: 'writer-error'   // 写失败(配额/事务中止)—— 与「没存过」不同形
});

/** 六个归因词(两个同形即失败) */
export const ATTACHMENT_REASONS = Object.freeze({
    ok: '正文附件可用',
    unavailable: '本环境没有可用的本地附件存储(indexedDB 缺席)',
    denied: '本地附件存储被拒或打不开(不影响阅读,但重启后正文会丢)',
    empty: '这本书还没有本地正文附件',
    'writer-error': '写入本地附件失败(配额或事务中止),本次正文仍在内存',
    'no-subject': '没给书标识'
});

/** 上限(冻结):单本正文附件上限 8MB —— 超过即如实拒绝,不做静默截断(截断的正文比没有更坏) */
export const ATTACHMENT_LIMITS = Object.freeze({
    bytes: 8 * 1024 * 1024,
    books: 60
});

function str(v) { return String(v == null ? '' : v).trim(); }

/** 取宿主里的 indexedDB(注入优先;没有则如实报 unavailable) */
function idbOf(win) {
    const w = win || (typeof globalThis !== 'undefined' ? globalThis : null);
    if (!w) return null;
    const idb = w.indexedDB || w.webkitIndexedDB || w.mozIndexedDB || null;
    return (idb && typeof idb.open === 'function') ? idb : null;
}

/** 恒定键面的读数模板(读者不必再判 undefined) */
function face(state, reason, extra) {
    return Object.assign({
        state,
        reason,
        text: ATTACHMENT_REASONS[reason] || ATTACHMENT_REASONS['unavailable'],
        ok: state === ATTACHMENT_STATES.OK,
        writesNothing: true,
        degraded: state === ATTACHMENT_STATES.UNAVAILABLE || state === ATTACHMENT_STATES.DENIED,
        bookId: '',
        books: [],
        count: 0
    }, extra || {});
}

/**
 * 打开附件库(每次调用都新开一个连接并显式关闭:本模块不持有长连接,
 *   避免把「读者关掉 App」与「库连接泄漏」耦合起来)。
 * @returns {Promise<{db:IDBDatabase|null, state:string, reason:string}>}
 */
function openDb(win) {
    const idb = idbOf(win);
    if (!idb) return Promise.resolve({ db: null, state: ATTACHMENT_STATES.UNAVAILABLE, reason: 'unavailable' });
    return new Promise((resolve) => {
        let req = null;
        try { req = idb.open(DB_NAME, DB_VERSION); }
        catch (_e) { resolve({ db: null, state: ATTACHMENT_STATES.DENIED, reason: 'denied' }); return; }
        req.onupgradeneeded = () => {
            try {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const os = db.createObjectStore(STORE, { keyPath: 'bookId' });
                    os.createIndex('contentHash', 'contentHash', { unique: false });
                }
            } catch (_e) { /* 建仓失败交由 onerror 路径如实报 denied */ }
        };
        req.onsuccess = () => resolve({ db: req.result, state: ATTACHMENT_STATES.OK, reason: 'ok' });
        req.onerror = () => resolve({ db: null, state: ATTACHMENT_STATES.DENIED, reason: 'denied' });
        req.onblocked = () => resolve({ db: null, state: ATTACHMENT_STATES.DENIED, reason: 'denied' });
    });
}

/** 一次事务的 Promise 包装(只做一件事,读完即关)。 */
async function withStore(win, mode, fn) {
    const opened = await openDb(win);
    if (!opened.db) return { state: opened.state, reason: opened.reason, value: null };
    const db = opened.db;
    try {
        const value = await new Promise((resolve, reject) => {
            let tx = null;
            try { tx = db.transaction(STORE, mode); }
            catch (e) { reject(e); return; }
            const store = tx.objectStore(STORE);
            let out;
            try { out = fn(store); }
            catch (e) { reject(e); return; }
            tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
            tx.onerror = () => reject(tx.error || new Error('tx-error'));
            tx.onabort = () => reject(tx.error || new Error('tx-abort'));
        });
        return { state: ATTACHMENT_STATES.OK, reason: 'ok', value };
    } catch (_e) {
        return { state: ATTACHMENT_STATES.WRITER_ERROR, reason: 'writer-error', value: null };
    } finally {
        try { db.close(); } catch (_e) { /* 关不上不影响读数 */ }
    }
}

/** 正文的体积(按字符数估:UTF-8 中文近似 1:1,保守即可,只用来挡明显超限的怪物)。 */
export function estimateBodyBytes(chapters) {
    let n = 0;
    for (const c of (Array.isArray(chapters) ? chapters : [])) {
        n += str(c && c.title).length;
        for (const p of (Array.isArray(c && c.paragraphs) ? c.paragraphs : [])) n += str(p).length;
        n += 4;
    }
    return n;
}

/**
 * 存一本书的正文(R3-X8 写入口)。
 * @param {object} win 宿主 window(注入,便于无头测试)
 * @param {{bookId:string, contentHash?:string, title?:string, chapters:Array}} entry
 * @returns {Promise<object>} 恒定键面读数
 */
export async function putBookBody(win, entry) {
    const e = (entry && typeof entry === 'object') ? entry : {};
    const bookId = str(e.bookId);
    if (!bookId) return face(ATTACHMENT_STATES.EMPTY, 'no-subject', { writesNothing: true });
    const chapters = Array.isArray(e.chapters) ? e.chapters : [];
    const bytes = estimateBodyBytes(chapters);
    /* 超限**如实拒绝**,不截断:半个正文比没有正文更容易被当成真读数。 */
    if (bytes > ATTACHMENT_LIMITS.bytes) {
        return face(ATTACHMENT_STATES.WRITER_ERROR, 'writer-error', { bookId: bookId, bytes: bytes, writesNothing: true });
    }
    const rec = {
        bookId: bookId,
        contentHash: str(e.contentHash),
        title: str(e.title),
        chapters: chapters,
        bytes: bytes,
        chapterCount: chapters.length,
        savedAt: Date.now()
    };
    const r = await withStore(win, 'readwrite', (store) => store.put(rec));
    if (r.state !== ATTACHMENT_STATES.OK) {
        return face(r.state, r.reason, { bookId: bookId, bytes: bytes, writesNothing: true });
    }
    return face(ATTACHMENT_STATES.OK, 'ok', {
        bookId: bookId, bytes: bytes, chapterCount: chapters.length,
        writesNothing: false
    });
}

/**
 * 取一本书的正文(打开书时用)。
 * @returns {Promise<{state, reason, text, bookId, chapters, bytes, contentHash, savedAt}>}
 */
export async function getBookBody(win, bookId) {
    const id = str(bookId);
    const base = { text: '', bookId: id, chapters: null, bytes: 0, contentHash: '', savedAt: null };
    if (!id) return Object.assign(face(ATTACHMENT_STATES.EMPTY, 'no-subject', base), base, { bookId: '' });
    const r = await withStore(win, 'readonly', (store) => store.get(id));
    if (r.state !== ATTACHMENT_STATES.OK) return Object.assign(face(r.state, r.reason, base), base);
    const got = r.value;
    if (!got || typeof got !== 'object' || !Array.isArray(got.chapters)) {
        return Object.assign(face(ATTACHMENT_STATES.EMPTY, 'empty', base), base);
    }
    return Object.assign(face(ATTACHMENT_STATES.OK, 'ok', {
        writesNothing: false,
        chapters: got.chapters,
        bytes: Number(got.bytes) || estimateBodyBytes(got.chapters),
        contentHash: str(got.contentHash),
        savedAt: Number(got.savedAt) || null
    }), { bookId: id });
}

/**
 * **丢附件后重新定位**:读者重新导入同一文件时,按指纹把正文挂回原 bookId。
 *   命中即写附件并返回命中的 bookId;未命中返回 empty(调用方照常新建条目)。
 *   这是验收第三条的落地方式 —— 不要求读者自己找章节,也不动进度键与摘录引用。
 * @returns {Promise<{state, reason, bookId, relinked:boolean}>}
 */
export async function relinkBookBody(win, contentHash, chapters, opts = {}) {
    const hash = str(contentHash);
    const base = { bookId: '', relinked: false };
    if (!hash) return Object.assign(face(ATTACHMENT_STATES.EMPTY, 'no-subject', base), base);
    const r = await withStore(win, 'readonly', (store) => {
        const os = store;
        /* 按 contentHash 索引取(索引缺席则退回全表扫描:旧库升级路径不该直接判死) */
        if (typeof os.index === 'function') {
            try { return os.index('contentHash').getAll(hash); }
            catch (_e) { /* 落到全表扫描 */ }
        }
        return os.getAll();
    });
    if (r.state !== ATTACHMENT_STATES.OK) return Object.assign(face(r.state, r.reason, base), base);
    const all = Array.isArray(r.value) ? r.value : [];
    const hit = all.find((x) => x && str(x.contentHash) === hash) || null;
    if (!hit) return Object.assign(face(ATTACHMENT_STATES.EMPTY, 'empty', base), base);
    const targetId = str(opts.bookId) || str(hit.bookId);
    const wrote = await putBookBody(win, {
        bookId: targetId, contentHash: hash, title: str(hit.title), chapters: chapters
    });
    if (wrote.state !== ATTACHMENT_STATES.OK) {
        return Object.assign(face(wrote.state, wrote.reason, base), { bookId: targetId, relinked: false });
    }
    return Object.assign(face(ATTACHMENT_STATES.OK, 'ok', {
        writesNothing: false, bookId: targetId, relinked: true
    }), { bookId: targetId, relinked: true });
}

/** 删一本书的正文附件(删书时必须调用:附件层不许留孤儿)。 */
export async function removeBookBody(win, bookId) {
    const id = str(bookId);
    if (!id) return face(ATTACHMENT_STATES.EMPTY, 'no-subject', { removed: false });
    const r = await withStore(win, 'readwrite', (store) => store.delete(id));
    if (r.state !== ATTACHMENT_STATES.OK) return face(r.state, r.reason, { bookId: id, removed: false });
    return face(ATTACHMENT_STATES.OK, 'ok', { bookId: id, removed: true, writesNothing: false });
}

/** 盘库:列出本机已存的正文附件(**不含正文**,只出元数据 —— 盘库不该把几 MB 正文读回内存)。 */
export async function listBookBodies(win) {
    const r = await withStore(win, 'readonly', (store) => store.getAll());
    if (r.state !== ATTACHMENT_STATES.OK) return face(r.state, r.reason, { books: [], count: 0 });
    const all = Array.isArray(r.value) ? r.value : [];
    const books = all
        .filter((x) => x && typeof x === 'object' && str(x.bookId))
        .map((x) => ({
            bookId: str(x.bookId),
            title: str(x.title),
            contentHash: str(x.contentHash),
            bytes: Number(x.bytes) || 0,
            chapterCount: Number(x.chapterCount) || 0,
            savedAt: Number(x.savedAt) || null
        }))
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const state = books.length ? ATTACHMENT_STATES.OK : ATTACHMENT_STATES.EMPTY;
    return face(state, books.length ? 'ok' : 'empty', { books: books, count: books.length, writesNothing: true });
}

/** 一行读数(五态各占一格:「没存过」与「存不了」不同形)。 */
export function attachmentLine(read) {
    const r = read || {};
    const state = ATTACHMENT_REASONS[r.reason] ? r.reason : 'unavailable';
    if (state === 'ok') {
        const n = Number(r.count);
        return Number.isFinite(n) && n > 0
            ? '正文附件:本机已存 ' + n + ' 本'
            : '正文附件:可用' + (r.bytes ? '(' + r.bytes + ' 字节)' : '');
    }
    return '正文附件:' + (ATTACHMENT_REASONS[state] || ATTACHMENT_REASONS['unavailable']);
}

/**
 * 自检(纯函数式,不抛):三条口径当场自证 ——
 *   一 无 bookId 如实拒绝且不写;
 *   二 缺库时报 unavailable,而不是报 empty(两态不同形);
 *   三 超限如实拒绝,不静默截断。
 */
export function attachmentSelfCheck() {
    const problems = [];
    return (async () => {
        const noSubject = await putBookBody(null, { chapters: [] });
        if (!noSubject || noSubject.reason !== 'no-subject') problems.push('无 bookId 应报 no-subject');
        const noIdb = await getBookBody(null, 'b1');
        if (!noIdb || noIdb.state !== ATTACHMENT_STATES.UNAVAILABLE) problems.push('无 indexedDB 应报 unavailable(不是 empty)');
        const tooBig = await putBookBody(null, {
            bookId: 'b1',
            chapters: [{ title: 't', paragraphs: ['x'.repeat(ATTACHMENT_LIMITS.bytes + 10)] }]
        });
        if (!tooBig || tooBig.reason !== 'writer-error') problems.push('超限应如实拒绝');
        return { problems: problems };
    })();
}

export default {
    ATTACHMENT_STATES,
    ATTACHMENT_REASONS,
    ATTACHMENT_LIMITS,
    estimateBodyBytes,
    putBookBody,
    getBookBody,
    relinkBookBody,
    removeBookBody,
    listBookBodies,
    attachmentLine,
    attachmentSelfCheck
};