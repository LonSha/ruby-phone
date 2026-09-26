/* ========================================================
 * 阅读 (Reading) App — 视图
 * 书架 → 导入 → 阅读器 三态; 纯本地, 正文 排版仿纸质书
 * ======================================================== */
'use strict';

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        this.theme = 'parchment';
    }

    render() {
        const tc = this._themeCss();
        const html = `
        <style>
        .rd-root { display:flex; flex-direction:column; height:100%; font-family: 'Songti SC','SimSun','Noto Serif SC',Georgia,serif; color:${tc.text}; background:${tc.bg}; box-sizing:border-box; }
        .rd-root * { box-sizing:border-box; }
        .rd-shelf { flex:1; overflow-y:auto; padding:14px; }
        .rd-shelf-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .rd-shelf-head h2 { margin:0; font-size:18px; letter-spacing:2px; color:${tc.text}; }
        .rd-btn { border:none; border-radius:8px; padding:8px 14px; cursor:pointer; font-size:13px; font-weight:600; }
        .rd-btn-import { background:${tc.soft}; color:#fff; }
        .rd-empty { text-align:center; padding:60px 16px; color:${tc.sub}; }
        .rd-empty p { margin:8px 0; font-size:14px; line-height:1.8; }
        .rd-empty-icon { font-size:40px; }
        .rd-book { background:${tc.card}; border:1px solid ${tc.border}; border-radius:10px; padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; box-shadow:0 1px 3px rgba(120,100,70,.08); }
        .rd-book-info { flex:1; min-width:0; }
        .rd-book-title { font-size:15px; font-weight:700; color:${tc.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rd-book-meta { font-size:11px; color:${tc.sub}; margin-top:4px; }
        .rd-book-actions { display:flex; gap:6px; margin-left:10px; }
        .rd-mini { border:none; background:${tc.bar}; color:${tc.soft}; border-radius:6px; padding:5px 10px; cursor:pointer; font-size:12px; }
        .rd-mini.read { background:${tc.soft}; color:#fff; }
        /* ---------- 阅读器 ---------- */
        .rd-reader { flex:1; display:flex; flex-direction:column; }
        .rd-reader-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:${tc.bar}; border-bottom:1px solid ${tc.border}; }
        .rd-reader-bar .rd-back { border:none; background:transparent; font-size:18px; cursor:pointer; color:${tc.soft}; }
        .rd-reader-bar .rd-chapters { flex:1; border:1px solid ${tc.border}; border-radius:6px; padding:5px 8px; font-size:12px; background:${tc.card}; color:${tc.text}; max-width:40%; }
        .rd-reader-bar .rd-fonts { display:flex; align-items:center; gap:4px; }
        .rd-reader-bar .rd-f { border:1px solid ${tc.border}; background:${tc.card}; color:${tc.soft}; border-radius:6px; cursor:pointer; font-size:12px; padding:4px 8px; }
        .rd-book-title-bar { text-align:center; font-size:12px; color:${tc.sub}; padding:6px 0 0; }
        .rd-chapter-title { text-align:center; font-size:16px; font-weight:700; color:${tc.text}; padding:10px 16px 4px; letter-spacing:1px; }
        .rd-content { flex:1; overflow-y:auto; padding:8px 20px 40px; }
        .rd-content p { margin:0 0 1em; text-indent:2em; font-size:${this.fontPx}px; line-height:${this.lineHeight}; color:${tc.text}; }
        .rd-reader-foot { display:flex; justify-content:space-between; align-items:center; padding:8px 14px; background:${tc.bar}; border-top:1px solid ${tc.border}; }
        .rd-reader-foot .rd-mini { flex:1; }
        .rd-reader-foot .rd-mini + .rd-mini { margin-left:8px; }
        .rd-paste { display:none; }
        .rd-import-wrap { margin-bottom:12px; }
        .rd-import-wrap label.rd-paste-label { display:block; text-align:center; padding:10px; border:1px dashed ${tc.border}; border-radius:8px; font-size:12px; color:${tc.sub}; cursor:pointer; margin-top:8px; }
        .rd-progress { height:3px; background:${tc.bar}; }
        .rd-progress > div { height:100%; background:${tc.soft}; width:0; transition:width .2s; }
        </style>
        ${this.currentBook ? this._renderReader(tc) : this._renderShelf(tc)}
        `;
        this.app.phoneShell.screen.innerHTML = html;
        this._bind();
    }

    // 主题预设
    _themeCss() {
        const t = this.theme || 'parchment';
        const themes = {
            parchment: { bg: '#f5f1e6', card: '#fffdf7', bar: '#efe7d7', border: '#e4dccb', text: '#3d3a35', sub: '#9a8b76', soft: '#6b5c48' },
            night: { bg: '#1c1f24', card: '#24282e', bar: '#20242a', border: '#33383f', text: '#cfd3d8', sub: '#7c828a', soft: '#a7adb5' },
            ink: { bg: '#121212', card: '#171717', bar: '#141414', border: '#2a2a2a', text: '#d4d4d4', sub: '#6f6f6f', soft: '#a3a3a3' }
        }[t] || {};
        return {
            bg: themes.bg, card: themes.card, bar: themes.bar, border: themes.border,
            text: themes.text, sub: themes.sub, soft: themes.soft
        };
    }

    _renderShelf(tc) {
        const books = this.app.data.getBooks();
        const list = books.length ? books.map(b => {
            const fmtBadge = b.format === 'epub' ? '<span style="font-size:10px;background:#7c6a5a;color:#fff;border-radius:4px;padding:1px 6px;margin-right:6px">EPUB</span>' : '';
            const authorStr = b.author ? ' · ' + esc(b.author) : '';
            return `
            <div class="rd-book">
                <div class="rd-book-info">
                    <div class="rd-book-title">${fmtBadge}${esc(b.title || '未命名')}</div>
                    <div class="rd-book-meta">${esc(b.fileName)}${authorStr} · ${b.chapterCount || 0} 章 · ${dateStr(b.addedAt)}</div>
                </div>
                <div class="rd-book-actions">
                    <button class="rd-mini del" data-id="${esc(b.id)}">删除</button>
                    <button class="rd-mini read" data-id="${esc(b.id)}">阅读</button>
                </div>
            </div>`;
        }).join('') : `
            <div class="rd-empty">
                <div class="rd-empty-icon">📖</div>
                <p>书架上还没有书</p>
                <p>导入 TXT 或 EPUB，开始阅读</p>
            </div>`;
        return `
        <div class="rd-root">
            <div class="rd-shelf">
                <div class="rd-shelf-head">
                    <h2>📚 书架</h2>
                    <button class="rd-btn rd-btn-import" id="rd-import">＋ 导入</button>
                </div>
                <div class="rd-import-wrap">
                    <input type="file" id="rd-file" accept=".txt,.epub,text/plain,application/epub+zip" class="rd-paste" />
                    <label class="rd-paste-label" id="rd-paste-label">📂 选择 .txt 或 .epub 文件（自动识别编码）</label>
                </div>
                ${list}
            </div>
        </div>`;
    }

    _renderReader(tc) {
        const book = this.currentBook;
        const ch = book.chapters[this.curChapter] || { title: '', paragraphs: [] };
        const paras = ch.paragraphs || [];
        const content = paras.length ? paras.map(p => `<p>${esc(p)}</p>`).join('') : '<p style="text-indent:0;color:#9a8b76">（本章暂无内容）</p>';
        const chapterOptions = book.chapters.map((c, i) =>
            `<option value="${i}" ${i === this.curChapter ? 'selected' : ''}>${esc(c.title || ('第' + (i + 1) + '章'))}</option>`).join('');
        const themeLabels = { parchment: '☀', night: '🌙', ink: '⚫' };
        const authorLine = book.author ? ` · ${esc(book.author)}` : '';
        const pct = book.chapters.length ? Math.round(((this.curChapter + 1) / book.chapters.length) * 100) : 0;
        return `
        <div class="rd-reader">
            <div class="rd-reader-bar">
                <button class="rd-back" id="rd-back" title="返回书架">‹</button>
                <select id="rd-chapters" class="rd-chapters">${chapterOptions}</select>
                <div class="rd-fonts">
                    <button class="rd-f" id="rd-theme" title="切换主题">${themeLabels[this.theme || 'parchment'] || '☀'}</button>
                    <button class="rd-f" id="rd-fminus">A−</button>
                    <span style="font-size:11px;color:${tc.sub}">${this.fontPx}px</span>
                    <button class="rd-f" id="rd-fplus">A＋</button>
                </div>
            </div>
            <div class="rd-progress">
                <div id="rd-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="rd-book-title-bar">《${esc(book.title || '未命名')}》${authorLine}</div>
            <div class="rd-chapter-title">${esc(ch.title || '')}</div>
            <div class="rd-content">${content}</div>
            <div class="rd-reader-foot">
                <button class="rd-mini" id="rd-prev" ${this.curChapter === 0 ? 'disabled style="opacity:.4"' : ''}>‹ 上一章</button>
                <span style="font-size:11px;color:${tc.sub}">${this.curChapter + 1} / ${book.chapters.length} · ${pct}%</span>
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
            q('#rd-theme')?.addEventListener('click', () => {
                const order = ['parchment', 'night', 'ink'];
                this.theme = order[(order.indexOf(this.theme) + 1) % order.length];
                this._saveProgress();
                this.render();
            });
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
            this.app.storage?.set?.('ruby_reading_progress_' + this.currentBook.id, JSON.stringify({ chapter: this.curChapter, fontPx: this.fontPx, theme: this.theme }));
        } catch (e) { /* 忽略 */ }
    }

    _loadProgress(bookId) {
        try {
            const raw = this.app.storage?.get?.('ruby_reading_progress_' + bookId);
            if (raw) {
                const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
                this.curChapter = Number(p.chapter) || 0;
                this.fontPx = Number(p.fontPx) || 16;
                if (p.theme === 'parchment' || p.theme === 'night' || p.theme === 'ink') this.theme = p.theme;
            }
        } catch (e) { this.curChapter = 0; }
    }
}

export default ReadingView;