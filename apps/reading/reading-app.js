/* ========================================================
 * 阅读 (Reading) App — 应用控制器
 * 纯本地 TXT 阅读器；导入/解析/章节/进度全在本机
 * ======================================================== */
'use strict';
import { ReadingData, decodeTxtArrayBuffer, parseTxtContent } from './reading-data.js';
import { ReadingView } from './reading-view.js';

export class ReadingApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.data = new ReadingData(storage);
        this.view = new ReadingView(this);
        // 内存中的书籍正文缓存: id -> { chapters }
        this._contentCache = new Map();
    }

    onChatChanged() {
        // [v2.23.0] 换会话重绑：重建数据层从新会话键重新载入。
        //   保留实例与构造期注册的常驻监听器，避免重建实例导致监听器累积。
        this.data = new ReadingData(this.storage);
    }

    render() {
        if (!this.phoneShell?.screen) return;
        this.view.render();
    }

    // 从 File 对象导入（支持 TXT / EPUB）
    importFile(file) {
        const isEpub = /\.epub$/i.test(file.name || '');
        if (isEpub) {
            this._importEpub(file);
            return;
        }
        this._importTxt(file);
    }

    _importTxt(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const { text, encoding } = decodeTxtArrayBuffer(buffer, 'auto');
                if (!text || !text.trim()) {
                    this.phoneShell?.showNotification?.('阅读', '文件为空或编码无法识别', '⚠️');
                    return;
                }
                const parsed = parseTxtContent(text, file.name, 'auto');
                const book = {
                    title: parsed.title,
                    author: '',
                    format: 'txt',
                    chapters: parsed.chapters
                };
                const result = this.data.addBook(book, file.name, encoding, 'auto');
                // 缓存章节正文（供本次会话阅读；书架列表不存正文避免 chatMetadata 膨胀）
                this._contentCache.set(result.bookId, result.chapters);
                this.view.currentBook = {
                    id: result.bookId,
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
            } catch (err) {
                console.error('❌ 阅读App导入失败:', err);
                this.phoneShell?.showNotification?.('阅读', '导入失败: ' + err.message, '❌');
            }
        };
        reader.onerror = () => this.phoneShell?.showNotification?.('阅读', '文件读取失败', '❌');
        reader.readAsArrayBuffer(file);
    }

    _importEpub(file) {
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
                const result = this.data.addBook(book, file.name, 'utf-8', 'auto');
                this._contentCache.set(result.bookId, result.chapters);
                this.view.currentBook = {
                    id: result.bookId,
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
            } catch (err) {
                console.error('❌ 阅读App EPUB导入失败:', err);
                this.phoneShell?.showNotification?.('阅读', 'EPUB导入失败: ' + err.message, '❌');
            }
        };
        reader.onerror = () => this.phoneShell?.showNotification?.('阅读', '文件读取失败', '❌');
        reader.readAsArrayBuffer(file);
    }

    // 打开书架中的一本书
    openBook(bookId) {
        const info = this.data.getBook(bookId);
        if (!info) return;
        let chapters = this._contentCache.get(bookId);
        if (!chapters) {
            // 正文未在内存（重启后）：书架条目仅有元数据，提示需重新导入
            this.phoneShell?.showNotification?.('阅读', '书本正文需重新导入后才能阅读（书柜只保存书目）', 'ℹ️');
            return;
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
    }
}

export default ReadingApp;