/* ========================================================
 * 阅读 (Reading) App — 视图
 * 书架 → 导入 → 阅读器 三态; 纯本地, 正文 排版仿纸质书
 * ======================================================== */
'use strict';

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '"');
}
function dateStr(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export class ReadingView {
    constructor(app) {
        this.app = app;
        this.currentBook = null;   // { id, title, encoding, mode, chapters }
        this.curChapter = 0;
        this.fontPx = 16;
        this.lineHeight = 1.9;
    }

    render() {
        const html = `
        <style>
        .rd-root { display:flex; flex-direction:column; height:100%; font-family: 'Songti SC','SimSun','Noto Serif SC',Georgia,serif; color:#3d3a35; background:#f5f1e6; box-sizing:border-box; }
        .rd-root * { box-sizing:border-box; }
        .rd-shelf { flex:1; overflow-y:auto; padding:14px; }
        .rd-shelf-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .rd-shelf-head h2 { margin:0; font-size:18px; letter-spacing:2px; color:#4a3f35; }
        .rd-btn { border:none; border-radius:8px; padding:8px 14px; cursor:pointer; font-size:13px; font-weight:600; }
        .rd-btn-import { background:#b08968; color:#fff; }
        .rd-empty { text-align:center; padding:60px 16px; color:#8a7a66; }
        .rd-empty p { margin:8px 0; font-size:14px; line-height:1.8; }
        .rd-empty-icon { font-size:40px; }
        .rd-book { background:#fffdf7; border:1px solid #e4dccb; border-radius:10px; padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; box-shadow:0 1px 3px rgba(120,100,70,.08); }
        .rd-book-info { flex:1; min-width:0; }
        .rd-book-title { font-size:15px; font-weight:700; color:#4a3f35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rd-book-meta { font-size:11px; color:#9a8b76; margin-top:4px; }
        .rd-book-actions { display:flex; gap:6px; margin-left:10px; }
        .rd-mini { border:none; background:#eee6d8; color:#6b5c48; border-radius:6px; padding:5px 10px; cursor:pointer; font-size:12px; }
        .rd-mini.read { background:#b08968; color:#fff; }
        /* ---------- 阅读器 ---------- */
        .rd-reader { flex:1; display:flex; flex-direction:column; }
        .rd-reader-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#efe7d7; border-bottom:1px solid #ddd2bd; }
        .rd-reader-bar .rd-back { border:none; background:transparent; font-size:18px; cursor:pointer; color:#6b5c48; }
        .rd-reader-bar .rd-chapters { flex:1; border:1px solid #cdbfa6; border-radius:6px; padding:5px 8px; font-size:12px; background:#fffdf7; color:#4a3f35; max-width:45%; }
        .rd-reader-bar .rd-fonts { display:flex; align-items:center; gap:4px; }
        .rd-reader-bar .rd-f { border:1px solid #cdbfa6; background:#fffdf7; color:#6b5c48; border-radius:6px; cursor:pointer; font-size:12px; padding:4px 8px; }
        .rd-book-title-bar { text-align:center; font-size:13px; color:#9a8b76; padding:6px 0 0; }
        .rd-chapter-title { text-align:center; font-size:16px; font-weight:700; color:#4a3f35; padding:10px 16px 4px; letter-spacing:1px; }
        .rd-content { flex:1; overflow-y:auto; padding:8px 20px 40px; }
        .rd-content p { margin:0 0 1em; text-indent:2em; font-size:${this.fontPx}px; line-height:${this.lineHeight}; color:#3d3a35; }
        .rd-reader-foot { display:flex; justify-content:space-between; align-items:center; padding:8px 14px; background:#efe7d7; border-top:1px solid #ddd2bd; }
        .rd-reader-foot .rd-mini { flex:1; }
        .rd-reader-foot .rd-mini + .rd-mini { margin-left:8px; }
        .rd-paste { display:none; }
        .rd-import-wrap { margin-bottom:12px; }
        .rd-import-wrap label.rd-paste-label { display:block; text-align:center; padding:10px; border:1px dashed #cdbfa6; border-radius:8px; font-size:12px; color:#9a8b76; cursor:pointer; margin-top:8px; }
        </style>
        ${this.currentBook ? this._renderReader() : this._renderShelf()}
        `;
        this.app.phoneShell.screen.innerHTML = html;
        this._bind();
    }

    _renderShelf() {
        const books = this.app.data.getBooks();
        const list = books.length ? books.map(b => `
            <div class="rd-book">
                <div class="rd-book-info">
                    <div class="rd-book-title">${esc(b.title || '未命名')}</div>
                    <div class="rd-book-meta">${esc(b.fileName)} · ${b.chapterCount || 0} 章 · ${dateStr(b.addedAt)}</div>
                </div>
                <div class="rd-book-actions">
                    <button class="rd-mini del" data-id="${esc(b.id)}">删除</button>
                    <button class="rd-mini read" data-id="${esc(b.id)}">阅读</button>
                </div>
            </div>`).join('') : `
            <div class="rd-empty">
                <div class="rd-empty-icon">📖</div>
                <p>书架上还没有书</p>
                <p>导入一个 TXT 小说，开始阅读</p>
            </div>`;
        return `
        <div class="rd-root">
            <div class="rd-shelf">
                <div class="rd-shelf-head">
                    <h2>📚 书架</h2>
                    <button class="rd-btn rd-btn-import" id="rd-import">＋ 导入 TXT</button>
                </div>
                <div class="rd-import-wrap">
                    <input type="file" id="rd-file" accept=".txt,text/plain" class="rd-paste" />
                    <label class="rd-paste-label" id="rd-paste-label">📄 选择 .txt 文件（自动识别编码）</label>
                </div>
                ${list}
            </div>
        </div>`;
    }

    _renderReader() {
        const book = this.currentBook;
        const ch = book.chapters[this.curChapter] || { title: '', paragraphs: [] };
        const paras = ch.paragraphs || [];
        const content = paras.length ? paras.map(p => `<p>${esc(p)}</p>`).join('') : '<p style="text-indent:0;color:#9a8b76">（本章暂无内容）</p>';
        const chapterOptions = book.chapters.map((c, i) =>
            `<option value="${i}" ${i === this.curChapter ? 'selected' : ''}>${esc(c.title || ('第' + (i + 1) + '章'))}</option>`).join('');
        return `
        <div class="rd-reader">
            <div class="rd-reader-bar">
                <button class="rd-back" id="rd-back" title="返回书架">‹</button>
                <select id="rd-chapters" class="rd-chapters">${chapterOptions}</select>
                <div class="rd-fonts">
                    <button class="rd-f" id="rd-fminus">A−</button>
                    <span style="font-size:11px;color:#9a8b76">${this.fontPx}px</span>
                    <button class="rd-f" id="rd-fplus">A＋</button>
                </div>
            </div>
            <div class="rd-book-title-bar">《${esc(book.title || '未命名')}》</div>
            <div class="rd-chapter-title">${esc(ch.title || '')}</div>
            <div class="rd-content">${content}</div>
            <div class="rd-reader-foot">
                <button class="rd-mini" id="rd-prev" ${this.curChapter === 0 ? 'disabled style="opacity:.4"' : ''}>‹ 上一章</button>
                <span style="font-size:11px;color:#9a8b76">${this.curChapter + 1} / ${book.chapters.length}</span>
                <button class="rd-mini" id="rd-next" ${this.curChapter >= book.chapters.length - 1 ? 'disabled style="opacity:.4"' : ''}>下一章 ›</button>
            </div>
        </div>`;
    }

    _bind() {
        const q = s => this.app.phoneShell.screen.querySelector(s);
        const root = this.app.phoneShell.screen;

        if (this.currentBook) {
            q('#rd-back')?.addEventListener('click', () => { this._saveProgress(); this.currentBook = null; this.render(); });
            q('#rd-chapters')?.addEventListener('change', e => { this._saveProgress(); this.curChapter = Number(e.target.value); this.render(); });
            q('#rd-prev')?.addEventListener('click', () => { if (this.curChapter > 0) { this._saveProgress(); this.curChapter--; this.render(); } });
            q('#rd-next')?.addEventListener('click', () => { if (this.curChapter < this.currentBook.chapters.length - 1) { this._saveProgress(); this.curChapter++; this.render(); } });
            q('#rd-fplus')?.addEventListener('click', () => { this.fontPx = Math.min(24, this.fontPx + 2); this.render(); });
            q('#rd-fminus')?.addEventListener('click', () => { this.fontPx = Math.max(12, this.fontPx - 2); this.render(); });
        } else {
            q('#rd-file')?.addEventListener('change', e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                this.app.importFile(file);
            });
            q('#rd-paste-label')?.addEventListener('click', () => q('#rd-file')?.click());
            root.querySelectorAll('.rd-mini.read')?.forEach(btn => {
                btn.addEventListener('click', () => this.app.openBook(btn.dataset.id));
            });
            root.querySelectorAll('.rd-mini.del')?.forEach(btn => {
                btn.addEventListener('click', () => { this.app.data.removeBook(btn.dataset.id); this.render(); });
            });
        }
    }

    _saveProgress() {
        try {
            if (!this.currentBook) return;
            this.app.storage?.set?.('ruby_reading_progress_' + this.currentBook.id, JSON.stringify({ chapter: this.curChapter, fontPx: this.fontPx }));
        } catch (e) { /* 忽略 */ }
    }

    _loadProgress(bookId) {
        try {
            const raw = this.app.storage?.get?.('ruby_reading_progress_' + bookId);
            if (raw) {
                const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
                this.curChapter = Number(p.chapter) || 0;
                this.fontPx = Number(p.fontPx) || 16;
            }
        } catch (e) { this.curChapter = 0; }
    }
}

export default ReadingView;