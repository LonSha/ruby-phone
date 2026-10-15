/* ========================================================
 * 阅读 (Reading) App — 应用控制器
 * 纯本地 TXT 阅读器；导入/解析/章节/进度全在本机
 * ======================================================== */
'use strict';
import { ReadingData, decodeTxtArrayBuffer, parseTxtContent, contentHashOf, normalizeExcerpt, normalizeExcerptList } from './reading-data.js';
import { ReadingView } from './reading-view.js';
/* [第三期 R3-X8] 正文的本地附件层:重启续读的落地处(indexedDB,不进 chatMetadata/提示词)。
 *   宿主存储边界的实测读数见该文件档头(真 SillyTavern 1.19.0:localStorage 仅 4MB、
 *   indexedDB 可用、/api/files/upload 在场但无可枚举列表面)。 */
import {
    putBookBody, getBookBody, relinkBookBody, removeBookBody, listBookBodies,
    ATTACHMENT_STATES, attachmentLine
} from './reading-attachment.js';

export class ReadingApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.data = new ReadingData(storage);
        this.view = new ReadingView(this);
        // 内存中的书籍正文缓存: id -> { chapters }
        this._contentCache = new Map();
        /* [第三期 R3-X8] 最近一次导入的 Promise：视图/测试/诊断可 await 到「真的导完了」。 */
        this._lastImport = null;
        this.EXCERPT_KEY = 'ruby_reading_excerpts';
        this._loadExcerpts();
    }

    /* [第三期 R3-X8] 正文落本地附件(indexedDB)。失败**不影响本次阅读**(内存里还有),
     *   但必须让读者知道「重启后这本书要重新导入」—— 这正是修前每本书的默认结局。 */
    _persistBody(bookId, title, hash, chapters) {
        try {
            return putBookBody(this._hostWin(), {
                bookId: bookId, title: title, contentHash: hash, chapters: chapters
            }).then((r) => {
                if (r && r.state !== ATTACHMENT_STATES.OK) {
                    this.phoneShell?.showNotification?.('阅读', '正文未能存入本机附件(重启后需重新导入):' + (r.text || ''), '⚠️');
                }
                return r;
            }).catch(() => null);
        } catch (_e) { return Promise.resolve(null); }
    }
    /** 宿主 window(读 indexedDB 用;无头测试可直接传 undefined)。 */
    _hostWin() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /** [第三期 R3-X8] 删书 = 书架条目 + 正文附件一起删(附件层不许留孤儿)。 */
    removeBook(bookId) {
        const id = String(bookId || '').trim();
        if (!id) return false;
        this.data.removeBook(id);
        this._contentCache.delete(id);
        try { removeBookBody(this._hostWin(), id).catch(() => null); } catch (_e) { /* 附件删不掉不阻塞书目删除 */ }
        return true;
    }
    /** [第三期 R3-X8] 本机附件盘库读数(视图用;五态各占一格)。 */
    async listBodies() {
        try { return await listBookBodies(this._hostWin()); }
        catch (_e) { return { state: ATTACHMENT_STATES.UNAVAILABLE, books: [], count: 0, text: attachmentLine({}) }; }
    }

    onChatChanged() {
        // [v2.23.0] 换会话重绑:重建数据层从新会话键重新载入。
        //   保留实例与构造期注册的常驻监听器,避免重建实例导致监听器累积。
        this.data = new ReadingData(this.storage);
        this._loadExcerpts();
        /* [第三期 R3-X8] 附件层是**本机**存储,不随会话走:换会话只重读书架,
         *   不清正文附件(那是读者的本机书库,不是这个会话的状态)。 */
    }
    /* [v3.99.2 · R3-X8] 摘录存取（会话隔离键，列表净化走纯函数窄口）。 */
    _loadExcerpts() {
        try {
            const raw = this.storage?.get?.(this.EXCERPT_KEY);
            this.excerpts = normalizeExcerptList(typeof raw === 'string' ? JSON.parse(raw) : raw);
        } catch (e) { this.excerpts = []; }
    }
    _saveExcerpts() {
        try { this.storage?.set?.(this.EXCERPT_KEY, JSON.stringify(this.excerpts)); } catch (e) { /* 忽略 */ }
    }
    addExcerpt(entry) {
        const n = normalizeExcerpt(entry);
        if (!n) return { error: 'excerpt-invalid（缺正文或书/章/段引用不完整，不收）' };
        this.excerpts = normalizeExcerptList([n].concat(this.excerpts));
        this._saveExcerpts();
        return { ok: true, id: n.id, count: this.excerpts.length };
    }
    getExcerpts() { return this.excerpts.slice(); }

    render() {
        if (!this.phoneShell?.screen) return;
        this.view.render();
    }

    // 从 File 对象导入（支持 TXT / EPUB）
    /* [第三期 R3-X8] **如实返回 Promise**：附件层是异步的（relink / persist），
     *   旧版这里返回 undefined，调用方只能靠「等一会儿」猜导入完没完 ——
     *   视图点完立刻 render 会读到旧书架，冒烟测试也会在回调前断言。
     *   现在 `await app.importFile(file)` 一定等到 currentBook 就位（或导入失败）。 */
    importFile(file) {
        const isEpub = /\.epub$/i.test(file.name || '');
        this._lastImport = isEpub ? this._importEpub(file) : this._importTxt(file);
        return this._lastImport;
    }

    _importTxt(file) {
        return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const { text, encoding } = decodeTxtArrayBuffer(buffer, 'auto');
                if (!text || !text.trim()) {
                    this.phoneShell?.showNotification?.('阅读', '文件为空或编码无法识别', '⚠️');
                    resolve(null);
                    return;
                }
                const parsed = parseTxtContent(text, file.name, 'auto');
                const book = {
                    title: parsed.title,
                    author: '',
                    format: 'txt',
                    chapters: parsed.chapters
                };
                // [v3.99.2 · R3-X8] 指纹重接：同一文件重新导入 ⇒ 回到原书（进度与摘录标记不丢）；
                //   同名不同文件 ⇒ 两本并存（不静默覆盖旧书）。
                const hash = contentHashOf(text);
                const reusable = this.data.findReusable(file.name, hash);
                const bookIdToUse = reusable ? reusable.id : null;
                const result = this.data.addBook(book, file.name, encoding, 'auto', { contentHash: hash });
                let finalId = bookIdToUse || result.bookId;
                /* [第三期 R3-X8] 丢附件后**重新定位**:同名同指纹的书在附件层若还留着旧条目,
                 *   按指纹把正文挂回原 bookId(进度键与摘录引用都指着旧 id,不动它们)。 */
                if (!reusable) {
                    try {
                        const re = await relinkBookBody(this._hostWin(), hash, result.chapters);
                        if (re && re.state === ATTACHMENT_STATES.OK && re.bookId) finalId = re.bookId;
                    } catch (_e) { /* 重定位失败不影响本次导入 */ }
                }
                // 缓存章节正文(供本次会话阅读;书架列表不存正文避免 chatMetadata 膨胀)
                this._contentCache.set(finalId, result.chapters);
                /* [第三期 R3-X8] 正文落本机附件:下一次开 App 不必重新导入。 */
                this._persistBody(finalId, result.title, hash, result.chapters);
                if (result.coexist) {
                    this.phoneShell?.showNotification?.('阅读', '书架上已有同名书（内容不同），两本并存', '📚');
                }
                if (bookIdToUse && result.coexist === false && result.replaced) {
                    this.phoneShell?.showNotification?.('阅读', '《' + result.title + '》重新导入，已回到原书进度与标记', '📖');
                }
                this.view.currentBook = {
                    id: finalId,
                    title: result.title,
                    author: '',
                    format: 'txt',
                    encoding,
                    mode: 'auto',
                    chapters: result.chapters
                };
                this.view.curChapter = 0;
                this.view._loadProgress(result.bookId);
                this.phoneShell?.showNotification?.('阅读', result.replaced ? `《${result.title}》已更新` : `《${result.title}》已上架`, '📖');
                this.render();
                resolve(this.view.currentBook || null);
            } catch (err) {
                console.error('❌ 阅读App导入失败:', err);
                this.phoneShell?.showNotification?.('阅读', '导入失败: ' + err.message, '❌');
                resolve(null);
            }
        };
        reader.onerror = () => { this.phoneShell?.showNotification?.('阅读', '文件读取失败', '❌'); resolve(null); };
        reader.readAsArrayBuffer(file);
        });
    }

    _importEpub(file) {
        return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                this.phoneShell?.showNotification?.('阅读', '正在解析 EPUB…', '⏳');
                const buffer = e.target.result;
                const { parseEpubFile } = await import('./reading-epub.js');
                const parsed = await parseEpubFile(buffer);
                const book = {
                    title: parsed.title,
                    author: parsed.author,
                    format: 'epub',
                    chapters: parsed.chapters
                };
                const hash = contentHashOf(parsed.chapters.map(c => (c.paragraphs || []).join('|')).join('#'));
                const reusable = this.data.findReusable(file.name, hash);
                const bookIdToUse = reusable ? reusable.id : null;
                const result = this.data.addBook(book, file.name, 'utf-8', 'auto', { contentHash: hash });
                let finalId = bookIdToUse || result.bookId;
                /* [第三期 R3-X8] 与 TXT 同一条重定位路径(同一份指纹口径)。 */
                if (!reusable) {
                    try {
                        const re = await relinkBookBody(this._hostWin(), hash, result.chapters);
                        if (re && re.state === ATTACHMENT_STATES.OK && re.bookId) finalId = re.bookId;
                    } catch (_e) { /* 重定位失败不影响本次导入 */ }
                }
                const finalIdFixed = finalId;
                this._contentCache.set(finalIdFixed, result.chapters);
                this._persistBody(finalIdFixed, result.title, hash, result.chapters);
                if (result.coexist) {
                    this.phoneShell?.showNotification?.('阅读', '书架上已有同名书（内容不同），两本并存', '📚');
                }
                this.view.currentBook = {
                    id: finalIdFixed,
                    title: result.title,
                    author: result.author,
                    format: 'epub',
                    encoding: 'utf-8',
                    mode: 'auto',
                    chapters: result.chapters
                };
                this.view.curChapter = 0;
                this.view._loadProgress(result.bookId);
                this.phoneShell?.showNotification?.('阅读', result.replaced ? `《${result.title}》已更新（${result.chapters.length}章）` : `《${result.title}》已上架（${result.chapters.length}章）`, '📚');
                this.render();
                resolve(this.view.currentBook || null);
            } catch (err) {
                console.error('❌ 阅读App EPUB导入失败:', err);
                this.phoneShell?.showNotification?.('阅读', 'EPUB导入失败: ' + err.message, '❌');
                resolve(null);
            }
        };
        reader.onerror = () => { this.phoneShell?.showNotification?.('阅读', '文件读取失败', '❌'); resolve(null); };
        reader.readAsArrayBuffer(file);
        });
    }

    // 打开书架中的一本书
    /* [第三期 R3-X8] 修前这里是「重启后一切打不开」的原点:正文只活在内存(_contentCache),
     *   重启后一律走「需重新导入」那句提示 —— 验收第一条(重启继续同章同位置)于是不成立。
     *   本版改为**先查内存、再查本机附件**:附件命中就恢复正文,由 _loadProgress 恢复同章同位置。
     *   附件也取不到时才如实告知需重新导入,并**说清是哪一种取不到**(没存过 / 本环境没有附件层)——
     *   压平成同一句话就会把「你的浏览器不支持」显示成「你从没导入过这本书」。 */
    async openBook(bookId) {
        const info = this.data.getBook(bookId);
        if (!info) return false;
        let chapters = this._contentCache.get(bookId);
        if (!chapters) {
            let attach = null;
            try { attach = await getBookBody(this._hostWin(), bookId); }
            catch (_e) { attach = null; }
            if (attach && attach.state === ATTACHMENT_STATES.OK
                && Array.isArray(attach.chapters) && attach.chapters.length) {
                chapters = attach.chapters;
                this._contentCache.set(bookId, chapters);
            } else {
                const why = (attach && attach.state === ATTACHMENT_STATES.EMPTY)
                    ? '本机附件里没有这本书的正文(可能被清理过)'
                    : '本机附件存储在本环境不可用';
                this.phoneShell?.showNotification?.('阅读', '正文取不到:' + why + ';重新导入同一个文件即可回到原进度', 'i️');
                return false;
            }
        }
        this.view.currentBook = {
            id: bookId,
            title: info.title,
            author: info.author || '',
            format: info.format || 'txt',
            encoding: info.encoding,
            mode: info.mode,
            chapters
        };
        this.view._loadProgress(bookId);
        this.render();
        return true;
    }
}

export default ReadingApp;