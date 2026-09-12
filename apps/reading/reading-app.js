/* ========================================================
 * 阅读 (Reading) App — 应用控制器
 * 纯本地 TXT 阅读器；导入/解析/章节/进度全在本机
 * ======================================================== */
'use strict';
import { ReadingData, decodeTxtArrayBuffer } from './reading-data.js';
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

    render() {
        if (!this.phoneShell?.screen) return;
        this.view.render();
    }

    // 从 File 对象导入
    importFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const buffer = e.target.result;
                const { text, encoding } = decodeTxtArrayBuffer(buffer, 'auto');
                if (!text || !text.trim()) {
                    this.phoneShell?.showNotification?.('阅读', '文件为空或编码无法识别', '⚠️');
                    return;
                }
                const result = this.data.addBook(text, file.name, encoding, 'auto');
                // 缓存章节正文（供本次会话阅读；书架列表不存正文避免 chatMetadata 膨胀）
                this._contentCache.set(result.bookId, result.chapters);
                this.view.currentBook = {
                    id: result.bookId,
                    title: result.title,
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
            encoding: info.encoding,
            mode: info.mode,
            chapters
        };
        this.view._loadProgress(bookId);
        this.render();
    }
}

export default ReadingApp;