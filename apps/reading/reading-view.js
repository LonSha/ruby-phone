/* ========================================================
 * 阅读 (Reading) App — 视图
 * 书架 → 导入 → 阅读器 三态; 纯本地, 正文 排版仿纸质书
 * ======================================================== */
'use strict';

/* L0 静态素材（纸纹）取数口：路径怎么拼只此一份，不在视图里手写 assets 路径。
 *   为什么用纸纹而不是纯色：本 App 的定位就是「正文排版仿纸质书」，
 *   而 paper 主题是唯一带纹理的纸面主题（parchment/night/ink 保持纯色不变）。 */
import { L0_ASSETS } from '../../config/l0-assets.js';
/* [v4.18.0 · R4-O6] 段落邻域窗口(中段切片)。
 *   为什么不能用已有两支:`windowOf` 头部切、`tailWindowOf` 尾部切,
 *   而「读者停在第 N 段」要看的是**它前后各 R 段** —— 中段。 */
import { paraWindowOf, anchorOf, paraLine } from '../../config/list-window.js';

/* 纸纹 key → URL 表（从 L0 取数口读，避免本文件自持第二条路径） */
const PAPER_TEXTURE_URLS = Object.freeze(Object.fromEntries(
    L0_ASSETS.textures.map((t) => [t.key, t.url])
));
const PAPER_THEME_TEXTURE = PAPER_TEXTURE_URLS['cream-paper'];

/* 主题清单（单一真源）：切换顺序、读回校验、标签表都以它为准。
 *   此前这三处各写一份字面量（切换用 order 数组、读回用三个 `===` OR、标签用对象键），
 *   加深色主题时漏改任一处的症状都是「存了不生效」——不报错。 */
const READING_THEMES = Object.freeze(['parchment', 'paper', 'night', 'ink']);

/* 主题按钮字符（与 READING_THEMES 同源：少一个键就回落到第一项的字符，不会渲染成 undefined） */
const READING_THEME_LABELS = Object.freeze({ parchment: '☀', paper: '📜', night: '🌙', ink: '⚫' });

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function dateStr(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/* [v4.18.0 · R4-O6] 段落窗口大小:满足计划原文验收的「可视邻域不超过 250 段」。
 *   与既有两个窗口函数同源(list-window 的 normalizePageSize 硬上限 200 是**页长**口径,
 *   而段落邻域的 `pageSize` 走同一支归一,故这里取 250 会被它夹到 200 —— 见下)。
 *   ★ 实际值:250 会被 normalizePageSize 夹到 200;而邻域默认半径取 (size-1)/2,
 *     得 99 ⇒ 窗口 = 199 段,**仍然满足「不超过 250 段」**。 */
const PARA_WINDOW_SIZE = 250;
export class ReadingView {
    constructor(app) {
        this.app = app;
        this.currentBook = null;   // { id, title, encoding, mode, chapters }
        this.curChapter = 0;
        this.fontPx = 16;
        this.lineHeight = 1.9;
        this.theme = 'parchment';
        /* [v4.24.0 · R4-X8] 研究笔记面：查找态 / 锚点核对读数 / 正在编批注的那一条。
         *   全在视图实例上，**不落存储**（草稿态不是数据）。 */
        this._findQuery = '';
        this._findRes = null;
        /* [v4.34.0 · R5-O7] 查找的运行态与进度（运行态不是数据，不落存储；换会话作废）。 */
        this._findRunning = false;
        this._findProgress = null;
        this._anchorById = {};
        this._anchorLine = '';
        this._anchorSig = '';
        this._noteEditId = '';
        this._noteDraft = '';
        /* [v4.35.0 · R5-O8] 研究清单的**回源核对现场**（运行态 / 进度 / 读数 / 跑过没）。
         *   全在视图实例上，**不落存储**（运行态不是数据）；换会话一并作废。 */
        this._researchLine = '';
        this._researchRunning = false;
        this._researchProgress = null;
        this._researchTried = false;
        this._flash = '';
        /* [v4.25.0 · R4-X3] 故事年鉴面现场：章册缓存 / 选中的那一版 / 正在编哪一章的题。
         *   全在视图实例上，**不落存储**（草稿态不是数据）；换会话一并作废。 */
        this._annualBook = null;
        this._annualVersion = 'player';   // 默认给**阅读版**（作者全知版含未了事项，需显式切）
        this._annualEditNo = null;
        this._annualEditDraft = '';
        this._annualLine = '';
        this._annualStale = null;
    }

    render() {
        /* [v4.24.0 · R4-X8] 无头环境（诊断/测试桩里 screen 与 setContent 缺席）**如实不画**：
         *   本层新增的几口（核对出处 / 存批注 / 删摘录）都会自己收尾重绘；
         *   没有宿主屏时抛异常会把「已经存好」的批注报成失败。 */
        if (!this.app?.phoneShell?.screen || typeof this.app.phoneShell.setContent !== 'function') return;
        /* [v4.35.0 · R5-O8] 研究清单**重开自动回源核对**：本屏画出来后跑一次（每次进入只跑一次）。
         *   为什么放在画之后：先让用户看到「正在核对」，而不是先卡住再出内容。
         *   为什么必须自动：清单每条都带出处读数，而读数要正文才算得出来 ——
         *   重启后不先打开书就看清单，修前会显示一片「未定论」，等于把「还没核」显示成「核不了」。
         *   为什么用 setTimeout 而不是直接 await：render 是同步排版路径，
         *   在里面 await 会把这一帧的绘制拖到读附件之后（那正是修前的观感）。 */
        if (!this._researchRunning && !this._researchTried) {
            this._researchTried = true;
            const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : {};
            const kick = () => { this.refreshResearch({ silent: true }).catch(() => { /* 自动那一轮不弹通知 */ }); };
            if (typeof g.setTimeout === 'function') g.setTimeout(kick, 0); else kick();
        }
        const tc = this._themeCss();
        const html = `
        <style>
        .rd-root { display:flex; flex-direction:column; height:100%; font-family: 'Songti SC','SimSun','Noto Serif SC',Georgia,serif; color:${tc.text}; box-sizing:border-box; background-color:${tc.bg}; background-image:${tc.bgImage ? `url('${tc.bgImage}')` : 'none'}; background-repeat:repeat; background-size:auto; }
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
        .rd-excerpt { background:${tc.card}; border:1px solid ${tc.border}; border-radius:8px; padding:8px 12px; margin-bottom:8px; }
        .rd-excerpt-text { font-size:13px; color:${tc.text}; line-height:1.6; }
        .rd-excerpt-ref { font-size:11px; color:${tc.sub}; margin-top:4px; }
        .rd-excerpt-empty { font-size:12px; color:${tc.sub}; padding:12px 4px; }
        /* ---------- [v4.24.0 · R4-X8] 研究笔记面：原文 / 我写的 / 标签 / 出处 / 命中 ---------- */
        .rd-note-quote { font-size:13px; color:${tc.text}; line-height:1.6; border-left:3px solid ${tc.soft}; padding-left:8px; }
        .rd-note-mine { font-size:12px; color:${tc.soft}; line-height:1.6; margin-top:6px; padding:6px 8px; background:${tc.bar}; border-radius:6px; }
        .rd-note-mine.rd-note-empty { color:${tc.sub}; font-style:italic; }
        .rd-note-tags { margin-top:6px; display:flex; flex-wrap:wrap; gap:4px; }
        .rd-tag { font-size:11px; color:${tc.soft}; background:${tc.bar}; border:1px solid ${tc.border}; border-radius:10px; padding:1px 8px; }
        .rd-note-acts { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
        .rd-note-input { width:100%; min-height:52px; font-size:12px; line-height:1.5; color:${tc.text}; background:${tc.card}; border:1px solid ${tc.border}; border-radius:6px; padding:6px 8px; font-family:inherit; }
        .rd-note-tip { font-size:11px; color:${tc.sub}; margin-top:4px; }
        .rd-badge { font-size:11px; border-radius:8px; padding:1px 7px; margin-left:4px; border:1px solid ${tc.border}; color:${tc.sub}; }
        .rd-badge.warn { color:#8c3a22; border-color:#c98d75; background:rgba(201,141,117,.14); }
        .rd-badge.ok { color:#4e6b4e; border-color:#8ba98b; background:rgba(139,169,139,.14); }
        .rd-hit { background:${tc.card}; border:1px solid ${tc.border}; border-radius:8px; padding:8px 12px; margin-bottom:8px; }
        .rd-hit-text { font-size:12px; color:${tc.text}; line-height:1.6; }
        .rd-find-input { flex:1; font-size:12px; color:${tc.text}; background:${tc.card}; border:1px solid ${tc.border}; border-radius:6px; padding:6px 8px; font-family:inherit; }
        .rd-progress { height:3px; background:${tc.bar}; }
        .rd-progress > div { height:100%; background:${tc.soft}; width:0; transition:width .2s; }
        </style>
        ${this.currentBook ? this._renderReader(tc) : this._renderShelf(tc)}
        `;
        /* [v3.61.0 · O1] 同 gacha-view：唯一内容入口纪律 —— 不再直接覆盖 `.phone-screen`，
         *   改走 setContent（内容落进 [data-view-id] 图层），否则返回键与图层栈会被这次渲染抹掉。
         *   viewId 用「阅读-书架 / 阅读-正文」两态区分，切态时历史栈能各留一层（返回键行为与其余 App 一致）。
         *   `_bind()` 读的是 screen（图层祖先），选择器一字不用改。 */
        this.app.phoneShell.setContent(html, this.currentBook ? 'reading-reader' : 'reading-shelf');
        this._bind();
    }

    // 主题预设
    _themeCss() {
        const t = this.theme || 'parchment';
        const themes = {
            parchment: { bg: '#f5f1e6', card: '#fffdf7', bar: '#efe7d7', border: '#e4dccb', text: '#3d3a35', sub: '#9a8b76', soft: '#6b5c48' },
            /* [v3.24.0] paper：parchment 的**带纸纹版**（同一套配色，多铺一层 cream-paper 纸纹）。
             *   单列一个主题而不是把 parchment 直接换成带纹样，是为了让
             *   「旧读数（用户此前存的 theme='parchment'）行为一个字不变」。 */
            paper: { bg: '#f5f1e6', card: '#fffdf7', bar: '#efe7d7', border: '#e4dccb', text: '#3d3a35', sub: '#9a8b76', soft: '#6b5c48', bgImage: PAPER_THEME_TEXTURE },
            night: { bg: '#1c1f24', card: '#24282e', bar: '#20242a', border: '#33383f', text: '#cfd3d8', sub: '#7c828a', soft: '#a7adb5' },
            ink: { bg: '#121212', card: '#171717', bar: '#141414', border: '#2a2a2a', text: '#d4d4d4', sub: '#6f6f6f', soft: '#a3a3a3' }
        }[t] || {};
        return {
            bg: themes.bg, card: themes.card, bar: themes.bar, border: themes.border,
            text: themes.text, sub: themes.sub, soft: themes.soft,
            /* bgImage 缺席 ⇒ 空串（不是 'none'）：让调用方统一用「有则铺、无则保持纯色」的写法，
             *   不必在模板里再判一次假值。 */
            bgImage: themes.bgImage || ''
        };
    }

    /* [v4.21.0 · R4-O9] 书库面的一行读数与逐本四段表。
     *   为什么要在**视图**里逐本列:计划验收最后一条是「删除附件前列清引用它的书架项」——
     *   用户要看见的是「哪本书/几条摘录/进度到第几章」,不是一句「已删除」。 */
    _libLine() {
        try { return String(this.app.libraryLine ? this.app.libraryLine() : ''); }
        catch (_e) { return '书库读数读不到(不假装为 0)'; }
    }
    _libRowsHtml(tc) {
        const refs = this.app._libraryRefs;
        if (!refs || !Array.isArray(refs.books)) {
            return '<div class="rd-excerpt-empty">还没盘过书库。点「扫描书库」看四段齐不齐 —— 「书目在、正文不在」就是换设备后点开是空的那一类。</div>';
        }
        if (!refs.books.length) return '<div class="rd-excerpt-empty">书架是空的，没有可搬的书。</div>';
        return refs.books.map((b) => {
            const linked = b.refs && b.refs.body && b.refs.body.state === 'linked';
            const size = (b.body && b.body.bytes) ? (Math.round(b.body.bytes / 1024) + ' KB') : '—';
            const prog = b.progress ? ('第 ' + String(Number(b.progress.chapter) + 1) + ' 章') : '没有';
            const tag = linked
                ? '<span style="color:#5b7a5b">正文在</span>'
                : '<span style="color:#a3543f">★ 缺正文（换设备后点开是空的）</span>';
            return '<div class="rd-excerpt"><div class="rd-excerpt-text">《' + esc(b.title || '未命名') + '》' + tag + '</div>'
                + '<div class="rd-excerpt-ref">正文 ' + esc(size) + ' · 摘录 ' + String(b.excerptCount || 0)
                + ' 条 · 进度 ' + esc(prog) + '</div></div>';
        }).join('');
    }

    /* ══════════ [v4.24.0 · R4-X8] 研究笔记面（全文找句 / 锚点核对 / 批注与标签） ══════════
     * 【本段只排版与派发：搜、核、归一全走 App 与内核 config/reading-notes-contract.js】
     * 【不做什么】
     *   · 不自己算「命中落在第几段」——内核连**段区间**与跨段标记一起给，本层只照抄；
     *   · 不自己判「算不算确认过」——内核给 `needsConfirm` / `settled`，本层只翻成字；
     *   · 不把批注与原文合成一格——原文与「我写的」分两处排版（`.rd-note-quote` / `.rd-note-mine`）。
     *   · **不重开一份摘录列表**：下面的条就是既有那一批摘录，只是多显示了笔记与出处读数
     *     （计划「不做」原文：不再交付一次「摘录功能」）。
     * ------------------------------------------------------------------ */
    /** 一条摘录的锚点读数（没核过 ⇒ null，**不假装已核对**）。 */
    _anchorOf(ex) {
        const id = String((ex && ex.id) || '');
        return (id && this._anchorById[id]) || null;
    }
    /** 锚点徽章：需确认 / 已核对 / 未定论三形各一字样，**不把未定论说成已核对**。 */
    _anchorBadge(ex) {
        const a = this._anchorOf(ex);
        if (!a) return '';
        if (a.needsConfirm) return '<span class="rd-badge warn" title="' + esc(a.why) + '">⚠ 出处需确认</span>';
        if (a.settled) return '<span class="rd-badge ok" title="' + esc(a.why) + '">✓ 出处已核对</span>';
        return '<span class="rd-badge" title="' + esc(a.why) + '">◌ 出处未定论</span>';
    }
    /** 跑一次锚点核对（改版书提示的落点）。只核当前书架，结果存实例态供本屏渲染。 */
    async refreshAnchors(bookId) {
        let r = null;
        try { r = await this.app.checkExcerptAnchors(bookId); }
        catch (_e) { r = null; }
        if (!r) {
            this._anchorById = {};
            this._anchorLine = '锚点核对**读不到**（不是「全都对得上」）';
            this._anchorSig = '';
            this.render();
            return { ok: false, counts: {}, line: this._anchorLine };
        }
        const map = {};
        for (const row of r.rows) map[row.id] = row.anchor;
        this._anchorById = map;
        this._anchorLine = r.line;
        this._anchorSig = String(r.counts.total) + '/' + String(r.counts.needsConfirm);
        this.render();
        return { ok: true, counts: r.counts, line: r.line };
    }
    /** 摘录区：原文 / 我写的 / 标签 / 出处读数四格分列（**批注不是原文**在这里就看得出来）。 */
    _noteRowsHtml(tc, excerpts) {
        return excerpts.map(ex => {
            const annotation = String(ex.annotation || '');
            const tags = Array.isArray(ex.tags) ? ex.tags : [];
            const editing = this._noteEditId === String(ex.id);
            const mine = editing
                ? '<div class="rd-note-mine"><textarea class="rd-note-input" id="rd-note-input" '
                    + 'placeholder="写自己的解释（不是原文）">' + esc(this._noteDraft) + '</textarea>'
                    + '<div class="rd-note-acts">'
                    + '<button class="rd-mini" data-note-save="' + esc(ex.id) + '">存批注/标签</button>'
                    + '<button class="rd-mini" data-note-cancel="1">取消</button></div>'
                    + '<div class="rd-note-tip">标签写在批注末尾，用逗号分隔；只有原文进摘录正文，这些字**不会**被当成原文。</div></div>'
                : (annotation
                    ? '<div class="rd-note-mine">✎ ' + esc(annotation) + '</div>'
                    : '<div class="rd-note-mine rd-note-empty">还没写自己的解释（这一步是可选的）</div>');
            const tagHtml = tags.length
                ? '<div class="rd-note-tags">' + tags.map(t => '<span class="rd-tag">' + esc(t) + '</span>').join('') + '</div>'
                : '';
            return `
            <div class="rd-excerpt">
                <div class="rd-note-quote">${esc(String(ex.text || '').slice(0, 120))}${String(ex.text || '').length > 120 ? '…' : ''}</div>
                <div class="rd-excerpt-ref">《${esc(ex.bookTitle || ex.bookId)}》${esc(ex.chapterTitle || ('第' + (ex.chapter + 1) + '章'))} · 第${ex.para + 1}段 ${this._anchorBadge(ex)}</div>
                ${mine}${tagHtml}
                <div class="rd-note-acts">
                    <button class="rd-mini" data-note-edit="${esc(ex.id)}">✎ ${annotation ? '改批注' : '写批注'}</button>
                    <button class="rd-mini" data-note-goto="${esc(ex.id)}">↩ 回到这一段</button>
                    <button class="rd-mini" data-note-del="${esc(ex.id)}">删除</button>
                </div>
            </div>`;
        }).join('');
    }
    /** 查找区：输入 + 两个按钮 + 结果读数（截断与跨段都如实说）。 */
    _findHtml(tc) {
        const r = this._findRes;
        const hits = (r && Array.isArray(r.hits)) ? r.hits : [];
        const rows = hits.map((h, i) => `
            <div class="rd-hit">
                <div class="rd-hit-text">…${esc(h.before)}<b>${esc(h.match)}</b>${esc(h.after)}…</div>
                <div class="rd-excerpt-ref">第 ${h.chapter + 1} 章${h.chapterTitle ? '（' + esc(h.chapterTitle) + '）' : ''} · 第 ${h.para + 1}${h.crossPara ? '-' + (h.paraEnd + 1) : ''} 段${h.crossPara ? ' · <b>跨段</b>（这句横跨两段，是并起来找的）' : ''}${h.keptBy === 'tail' ? ' · 末章那一处（截断后保留）' : ''}</div>
                <div class="rd-note-acts"><button class="rd-mini" data-hit-goto="${i}">跳到这里</button></div>
            </div>`).join('');
        return `
            <div class="rd-import-wrap" style="display:flex;gap:6px;align-items:center">
                <input class="rd-find-input" id="rd-find-input" placeholder="全书找一句（记得住句子、记不住章也行）" value="${esc(this._findQuery)}" />
                <button class="rd-mini" id="rd-find-run">查找</button>
                ${this._findRunning ? '<button class="rd-mini" id="rd-find-cancel">取消</button>' : ''}
            </div>
            <div class="rd-excerpt">
                <div class="rd-excerpt-text" style="font-size:12px">${r ? esc(this._findLine(r)) : '还没找过。**扫全书**，末章与跨段的命中都能找到。'}</div>
            </div>
            <div class="rd-find-progress rd-excerpt-text" style="font-size:12px">${esc(this._findProgressLine())}</div>
            ${rows}`;
    }
    /**
     * 查找进度一行读数（[v4.34.0 · R5-O7]）。
     *   ★ 这一行的**唯一职责**是让「正在跑」与「卡住了」长得不一样：
     *     大书建索引要跨许多轮宏任务，没有这一行时用户只能看着旧读数发呆。
     *   ★ 进度里不许出现「已完成」这种话：查找没结束就永远是「正在」。
     */
    _findProgressLine() {
        const p = this._findProgress;
        if (!p) return this._findRunning ? '正在建索引…' : '';
        if (p.phase === 'index') return '正在建索引 ' + String(p.done) + '/' + String(p.total) + ' 章…（可点取消）';
        if (p.phase === 'scan') return '正在全书找句 ' + String(p.done) + '/' + String(p.total) + ' 章…（可点取消）';
        if (p.phase === 'index-reused') return '这本这一版已经建过索引，直接用（' + String(p.total) + ' 章）';
        return '';
    }
    /** 取消正在跑的那一轮查找（[v4.34.0 · R5-O7]）。 */
    cancelFind() {
        const r = this.app.cancelFind ? this.app.cancelFind() : { ok: false, why: 'no-task（这一轮没有正在跑的查找）' };
        if (r && r.ok) this.app.phoneShell?.showNotification?.('阅读', '已取消这次查找（一条命中都不给，免得你以为是全部）', '⏹');
        else this.app.phoneShell?.showNotification?.('阅读', '这一轮没有正在跑的查找', '⏹');
        this.render();
        return r;
    }
    /** 查找一行读数（本层只做拼接，**判据全在 searchLine**）。 */
    _findLine(r) {
        try { return String(this.app.searchLineOf ? this.app.searchLineOf(r) : ''); }
        catch (_e) { return '查找读数读不到（不假装为 0 处）'; }
    }
    /** 跑一次全书查找（[v4.34.0 · R5-O7]：索引按版本复用、分片让出、可取消）。 */
    async runFind(q) {
        const query = String(q == null ? '' : q);
        this._findQuery = query;
        if (!query.trim()) {
            this._findRes = null;
            this.app.phoneShell?.showNotification?.('阅读', '先写一句要找回的话', '🔎');
            this.render();
            return null;
        }
        /* ★ 上一轮还没跑完就再点一次：先把上一轮**顶掉**（换任务身份），
         *   否则两轮会互相覆盖读数 —— 先回来的是旧查询的结果，用户看到的却是新查询。 */
        if (this._findRunning) this.app.cancelFind?.();
        const task = this.app.newFindTask();
        this._findRunning = true;
        this._findProgress = null;
        this.render();
        let res = null;
        try {
            res = await this.app.searchBook(query, {
                task: task,
                onProgress: (p) => { this._findProgress = p; if (this.phoneShell?.screen) this.render(); },
            });
        } catch (_e) { res = null; }
        this._findRunning = false;
        this._findProgress = null;
        /* ★ 被顶掉 / 被取消的那一轮**不许画上去**：它是旧书的旧读数。
         *   界面照旧显示上一次的读数行（那才是用户点的那一次）。 */
        if (res && res.stale === true) { this.render(); return res; }
        this._findRes = res;
        this.render();
        return res;
    }
    /**
     * 从摘录回到对应章段。
     *   ★ **需确认的出处不许直接跳**：改版书的旧锚点点下去会落在另一段上，
     *     用户要的是「知道它可能要错位」，而不是「跳过去看看」。故先核、需确认就停在这里。
     */
    async gotoExcerpt(id) {
        const ex = this.app.findExcerpt(id);
        if (!ex) { this.app.phoneShell?.showNotification?.('阅读', '没有这条摘录', '⚠️'); return { ok: false, why: 'not-found' }; }
        const r = await this.app.checkExcerptAnchors(ex.bookId);
        const row = r.rows.filter(x => x.id === String(ex.id))[0] || null;
        const a = row ? row.anchor : null;
        if (a && a.needsConfirm) {
            this.app.phoneShell?.showNotification?.('阅读', '这条摘录的出处需确认，没有直接跳：' + a.why, '⚠️');
            return { ok: false, why: 'anchor-needs-confirm', anchor: a };
        }
        const ok = await this.app.openBook(ex.bookId);
        if (!ok) { this.app.phoneShell?.showNotification?.('阅读', '正文取不到，跳不过去', '⚠️'); return { ok: false, why: 'body-unreadable' }; }
        this.curChapter = Number(ex.chapter) || 0;
        this.anchorPara = Number(ex.para) || 0;
        this.render();
        this.app.phoneShell?.showNotification?.('阅读', '已回到第 ' + (this.curChapter + 1) + ' 章第 ' + (this.anchorPara + 1) + ' 段', '↩️');
        return { ok: true, anchor: a };
    }
    /** 跳到一条查找命中（章 + 段；用内核给的段号，**不自己数**）。 */
    async gotoHit(i) {
        const r = this._findRes;
        const h = (r && Array.isArray(r.hits)) ? r.hits[Number(i)] : null;
        if (!h) return false;
        const bookId = r.book && r.book.id;
        if (bookId) {
            const ok = await this.app.openBook(bookId);
            if (!ok) { this.app.phoneShell?.showNotification?.('阅读', '正文取不到，跳不过去', '⚠️'); return false; }
        }
        this.curChapter = Number(h.chapter) || 0;
        this.anchorPara = Number(h.para) || 0;
        this.render();
        return true;
    }
    /** 开始编批注（把既有批注与标签预填回来，**不覆盖**）。 */
    startNote(id) {
        const ex = this.app.findExcerpt(id);
        if (!ex) return '';
        this._noteEditId = String(ex.id);
        const tags = Array.isArray(ex.tags) ? ex.tags.join('，') : '';
        this._noteDraft = String(ex.annotation || '') + (tags ? (String(ex.annotation || '') ? '\n' : '') + tags : '');
        this.render();
        return this._noteDraft;
    }
    cancelNote() { this._noteEditId = ''; this._noteDraft = ''; this.render(); }
    /**
     * 存批注与标签：**第一行是批注，余下按标签拆**（界面上的极简约定，判定仍走内核归一）。
     *   ★ 只写 `annotation` / `tags` 两格，**原文一格都不动**。
     */
    saveNote(id) {
        const ta = this.app.phoneShell?.screen?.querySelector('#rd-note-input');
        const raw = ta ? String(ta.value || '') : String(this._noteDraft || '');
        const lines = raw.split(/\r?\n/);
        const note = String(lines[0] || '').trim();
        const tagLine = lines.slice(1).join('，');
        const cur = this.app.findExcerpt(id) || {};
        /* 标签那一行**留空 ⇒ 保留原标签**（不是清空）：用户只改批注时不该把标签一起抹掉。 */
        const r = this.app.setExcerptNote(id, note, tagLine ? tagLine : cur.tags);
        this._noteEditId = '';
        this._noteDraft = '';
        this.app.phoneShell?.showNotification?.('阅读', r && r.ok ? '批注已存（原文那一格没动）' : ((r && r.error) || '批注没存上'), r && r.ok ? '✎' : '⚠️');
        this.render();
        return r;
    }
    /**
     * 研究清单一行读数（真消费点：界面读一次，而不是只把汇总挂在导出面上）。
     *   [v4.35.0 · R5-O8] 优先给**这次回源核出来的**读数；还没有时退回同步汇总 ——
     *   但**不把同步汇总说成已核对**（那条读数里的「未定论」本来就写着「正文没读到」）。
     */
    researchText() {
        if (this._researchLine) return String(this._researchLine);
        try { return String((this.app.researchList() || {}).line || ''); }
        catch (_e) { return '研究清单读不到（不假装为 0 条）'; }
    }
    /**
     * 重开研究页时**自动回源核对**（[v4.35.0 · R5-O8]）。
     *   为什么必须自动：清单的每一条都带出处读数，而读数要正文才算得出来；
     *   重启后不先打开书就看清单，修前会显示一片「未定论」——
     *   那等于把「还没核」显示成「核不了」，而用户没有任何办法把它变好。
     *   ★ 上一轮没跑完就再点一次：先把上一轮**顶掉**（换任务身份），
     *     否则先回来的是旧读数，用户看到的却是刚点的那一次。
     * @param {{silent?:boolean}} [opts]
     */
    async refreshResearch(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        if (this._researchRunning) this.app.cancelAnchor?.();
        const task = this.app.newAnchorTask();
        this._researchRunning = true;
        this._researchProgress = null;
        this._researchLine = '正在核对清单出处…（**没核完之前这屏的读数不当结论**）';
        this.render();
        let res = null;
        try {
            res = await this.app.researchListAsync({
                task: task,
                onProgress: (p) => { this._researchProgress = p; if (this.app.phoneShell?.screen) this.render(); },
            });
        } catch (_e) { res = null; }
        this._researchRunning = false;
        this._researchProgress = null;
        if (!res) {
            this._researchLine = '清单核对**读不到**（不是「全都对得上」）';
            this.render();
            return null;
        }
        if (res.cancelled === true) {
            this._researchLine = String(res.line || '清单核对已取消（没核完）');
            this.render();
            return res;
        }
        this._researchLine = String(res.line || '');
        if (!o.silent) this.app.phoneShell?.showNotification?.('阅读', this._researchLine, '🧭');
        this.render();
        return res;
    }
    /** 取消正在跑的那一轮清单核对（[v4.35.0 · R5-O8]）。 */
    cancelResearch() {
        const r = this.app.cancelAnchor ? this.app.cancelAnchor() : { ok: false, why: 'no-task' };
        this.app.phoneShell?.showNotification?.('阅读',
            (r && r.ok) ? '已取消这次清单核对（没核完的那部分不当结论）' : '这一轮没有正在跑的清单核对', '⏹');
        this.render();
        return r;
    }
    /**
     * 清单核对进度一行读数（[v4.35.0 · R5-O8]）。
     *   ★ 与查找进度同规：这一行的唯一职责是让「正在跑」与「卡住了」长得不一样；
     *     没跑完就永远说「正在」，不许出现「已完成」。
     */
    _researchProgressLine() {
        if (!this._researchRunning && !this._researchProgress) return '';
        const p = this._researchProgress || {};
        const done = Number(p.done || 0);
        const total = Number(p.total || 0);
        return '正在核对清单出处 · 已读 ' + String(done) + '/' + String(total) + ' 本（**没核完之前这屏的读数不当结论**）';
    }
    /* ══════════ [v4.25.0 · R4-X3] 故事年鉴面（按卷章读 / 编辑草稿 / 导出） ══════════
     * 【本段只排版与派发：建章册、两版、编辑、过期、成稿、裁阅读版、导出全走 App 与内核】
     * 【不做什么】
     *   · **不自己判秘密**：阅读版一律读上游 `storyAnnualForPlayer` 的结果（App 转交）；
     *   · **不把作者版当兜底**：作者版只在你显式切到它时显示（默认给阅读版）；
     *   · **不改事实**：编辑只交上游出口，被拒的字段原样显示 —— 本层不自己认字段；
     *   · **不联网发布**：导出只是落一份本地 .txt。
     * ------------------------------------------------------------------ */
    /** 取章册（没有缓存就先读一次；未接插件时如实空）。 */
    _annualOf() {
        if (!this._annualBook) {
            try { this._annualBook = this.app.annualBook(); }
            catch (_e) { this._annualBook = null; }
        }
        return this._annualBook;
    }
    /** 章册一行读数（判据全在 App/内核）。 */
    annualLine() {
        try { return String(this.app.annualBookLine() || ''); }
        catch (_e) { return '年鉴读数读不到（不假装为 0 章）'; }
    }
    /** 重读章册（章册只读一次就缓存；原稿改了要显式重读）。 */
    refreshAnnual() {
        this._annualBook = null;
        this._annualOf();
        this._annualEditNo = null;
        this._annualEditDraft = '';
        this.render();
        return this._annualBook;
    }
    /** 切版（作者全知版 / 阅读版）。**默认阅读版**；作者版含未了事项，须显式切。 */
    setAnnualVersion(v) {
        const want = String(v || '');
        this._annualVersion = (want === 'authorial') ? 'authorial' : 'player';
        this.render();
        return this._annualVersion;
    }
    /** 当前该显示的那一版章册（作者版=全章；阅读版=按本机进度裁）。 */
    _annualShown() {
        const book = this._annualOf();
        const all = (book && Array.isArray(book.chapters)) ? book.chapters : [];
        if (this._annualVersion === 'authorial') return { chapters: all, cut: null };
        let through = null;
        try { through = this.app.annualReadThrough(); } catch (_e) { through = null; }
        const cut = this.app.annualReadingVersion(all, through);
        return { chapters: cut.chapters, cut: cut };
    }
    /** 年鉴区（四态各占一格：插件不在场 / 读不出 / 没章 / 有章）。 */
    _annualHtml(tc) {
        const line = this.annualLine();
        let h = '<div class="rd-excerpt"><div class="rd-excerpt-text" style="font-size:12px">' + esc(line) + '</div></div>';
        h += '<div class="rd-import-wrap" style="display:flex;flex-wrap:wrap;gap:6px">'
            + '<button class="rd-mini" id="rd-annual-refresh">重读章册</button>'
            + '<button class="rd-mini" id="rd-annual-export">导出可读文件</button>'
            + '<button class="rd-mini" data-annual-ver="player">阅读版</button>'
            + '<button class="rd-mini" data-annual-ver="authorial">作者版</button>'
            + '</div>';
        h += '<div class="rd-excerpt-empty" style="padding:0 4px 8px">默认给<b>阅读版</b>（按本机进度裁：读到哪一章，其后的章只留占位）；<b>章级去剧透</b>由上游 <b>storyAnnualForPlayer</b> 判，本屏不代替它。作者版含未了事项，需显式切。</div>';
        if (this._annualLine) h += '<div class="rd-excerpt-empty" style="padding:0 4px 8px">' + esc(this._annualLine) + '</div>';
        const shown = this._annualShown();
        const cut = shown.cut;
        if (cut) {
            h += '<div class="rd-excerpt-empty" style="padding:0 4px 8px">已读 ' + String(cut.readCount)
                + ' 章 · 未读 ' + String(cut.lockedCount) + ' 章（内容不在这里展开）</div>';
            h += '<div class="rd-import-wrap" style="display:flex;gap:6px;align-items:center">'
                + '<input class="rd-find-input" id="rd-annual-through" type="number" min="0" value="'
                + esc(String(cut.readThrough === null ? '' : cut.readThrough)) + '" placeholder="读到第几章" />'
                + '<button class="rd-mini" id="rd-annual-set">记进度</button></div>';
        }
        const rows = shown.chapters.map(c => {
            if (c.locked) {
                return '<div class="rd-excerpt"><div class="rd-excerpt-ref">第 ' + String(c.no)
                    + ' 章（未读）—— 内容未展开，读到这一章后再看</div></div>';
            }
            const editing = this._annualEditNo !== null && Number(this._annualEditNo) === Number(c.no);
            const title = editing
                ? '<input class="rd-find-input" id="rd-annual-title" value="' + esc(this._annualEditDraft) + '" />'
                    + '<div class="rd-note-acts"><button class="rd-mini" data-annual-save="' + esc(String(c.no)) + '">存章题</button>'
                    + '<button class="rd-mini" data-annual-cancel="1">取消</button></div>'
                : '<div class="rd-note-acts"><button class="rd-mini" data-annual-edit="' + esc(String(c.no)) + '">改章题</button></div>';
            const e = c.elements || {};
            const blk = (label, items, render) => (Array.isArray(items) && items.length
                ? '<div class="rd-note-quote">· ' + label + '</div>' + items.map(x => '<div class="rd-excerpt-ref">' + esc(render(x))
                    + (x && x.evidenceRef ? '<span style="opacity:.65"> 〔回源 ' + esc(String(x.evidenceRef)) + '〕</span>' : '') + '</div>').join('')
                : '');
            return '<div class="rd-excerpt">'
                + '<div class="rd-excerpt-text" style="font-weight:700">第 ' + String(c.no) + ' 章 ' + esc(c.title || '') + '</div>'
                + (c.summary ? '<div class="rd-note-quote">' + esc(String(c.summary).slice(0, 200)) + '</div>' : '')
                + blk('关键事件', e.events, x => String(x && x.text || ''))
                + blk('人物变化', e.changes, x => String(x && x.char || '') + '：' + String(x && x.from || '？') + ' → ' + String(x && x.to || '？'))
                + blk('未了事项', e.unfinished, x => String(x && x.text || ''))
                + blk('精选原话', e.quotes, x => (x && x.speaker ? String(x.speaker) + '：' : '') + String(x && x.text || ''))
                + title
                + '</div>';
        }).join('');
        return h + rows;
    }
    /** 存章题（**只交上游编辑出口**；被拒字段原样显示）。 */
    saveAnnualTitle(no) {
        const input = this.app.phoneShell?.screen?.querySelector('#rd-annual-title');
        const text = input ? String(input.value || '') : String(this._annualEditDraft || '');
        const r = this.app.annualEdit({ title: '', chapter: Number(no) }, { title: text });
        let msg = '';
        if (r && r.changed && r.changed.length) msg = '章题已改（事实位没动）';
        else if (r && r.rejected && r.rejected.length) msg = '有 ' + String(r.rejected.length) + ' 个字段被拒（事实位不属于草稿）';
        else msg = '没改动';
        this._annualEditNo = null;
        this._annualEditDraft = '';
        this.app.phoneShell?.showNotification?.('阅读', msg, r && r.ok ? '✎' : '⚠️');
        this.render();
        return r;
    }
    /** 记本机年鉴阅读进度（阅读版按它裁）。 */
    setAnnualReadThrough(v) {
        const r = this.app.setAnnualReadThrough(v);
        this.app.phoneShell?.showNotification?.('阅读', r && r.ok
            ? ('已记：读到第 ' + String(r.readThrough) + ' 章')
            : '进度没记上（' + String((r && r.why) || '') + '）', r && r.ok ? '📍' : '⚠️');
        this.render();
        return r;
    }
    /** 导出为**离线可读**的本地 .txt（不联网、不上传）。返回文本，宿主无 DOM 时也不抛。 */
    exportAnnual() {
        const shown = this._annualShown();
        let text = '';
        try {
            text = String(this.app.annualExportText(shown.chapters, {
                bookTitle: (this._annualOf() && this._annualOf().kind) ? '故事年鉴' : '故事年鉴',
                versionLabel: this._annualVersion === 'authorial' ? '（作者全知版）' : '（按当前进度阅读版）'
            }) || '');
        } catch (_e) { text = ''; }
        if (!text) { this.app.phoneShell?.showNotification?.('阅读', '导出读不到（不假装成空文件）', '⚠️'); return ''; }
        try {
            if (typeof Blob === 'function' && typeof document !== 'undefined' && document.createElement) {
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = '故事年鉴-' + Date.now() + '.txt';
                a.click();
                URL.revokeObjectURL(a.href);
            }
        } catch (_e) { /* 无宿主 DOM：文本仍返回，导出内容本身是完整的 */ }
        this._annualLine = '已导出本地可读文件（' + String(text.length) + ' 字，离线可读）';
        this.app.phoneShell?.showNotification?.('阅读', this._annualLine, '📄');
        this.render();
        return text;
    }
    /** 过期核对：原稿改动 ⇒ 逐条报需重建（**过期 ≠ 删除**）。 */
    checkAnnualStale(newPayload) {
        const book = this._annualOf();
        const raw = (book && Array.isArray(book.rawChapters)) ? book.rawChapters : [];
        let r = null;
        try { r = this.app.annualStale(raw, newPayload); } catch (_e) { r = null; }
        this._annualStale = r;
        const line = (!r || r.judged !== true) ? '过期判定读不到（不假装成「全都新鲜」）'
            : (r.needRebuild
                ? ('有 ' + String(r.stale) + ' 段变了 · ' + String(r.missingChapters) + ' 章不在了 —— 相关段需重建')
                : '没有段过期（原稿未变）');
        this.app.phoneShell?.showNotification?.('阅读', line, '🧭');
        this.render();
        return r;
    }
    /**
     * 删一条摘录（视图侧：报结果 + 重绘）。
     *   ★ 删的是**摘录**，不动正文附件、不动书架条目 —— 摘录只是读者贴的便签。
     */
    deleteExcerpt(id) {
        const r = this.app.removeExcerpt(id);
        this.app.phoneShell?.showNotification?.('阅读', r && r.ok ? '摘录已删（正文没动）' : ((r && r.error) || '没删掉'), r && r.ok ? '🗑' : '⚠️');
        if (this._noteEditId === String(id)) { this._noteEditId = ''; this._noteDraft = ''; }
        this.render();
        return r;
    }
    /**
     * [v4.24.0 · R4-X8] 换会话作废**本屏现场**（与 X2 同规）：
     *   上一会话的查找命中、锚点读数、正在编的批注草稿全指着上一会话的书与摘录；
     *   留着它们，用户在新会话里看到的是**上一场的读数**（不报错，只是错数据）。
     */
    onChatChanged() {
        this._findQuery = '';
        this._findRes = null;
        /* [v4.34.0 · R5-O7] 查找的运行态与进度：换会话必须一并作废，并且
         *   **先把正在跑的那一轮取消掉** —— 否则它跑完会把上一会话的读数画进新会话。 */
        try { this.app.cancelFind?.(); } catch (_e) { /* 取消失败不阻塞现场作废 */ }
        this._findRunning = false;
        this._findProgress = null;
        /* [v4.35.0 · R5-O8] 清单核对的运行态一并作废，并**先把正在跑的那一轮取消掉** ——
         *   否则它跑完会把上一会话的清单读数画进新会话（与查找同规）。 */
        try { this.app.cancelAnchor?.(); } catch (_e) { /* 取消失败不阻塞现场作废 */ }
        this._researchRunning = false;
        this._researchProgress = null;
        this._researchLine = '';
        this._researchTried = false;
        this._anchorById = {};
        this._anchorLine = '';
        this._anchorSig = '';
        this._noteEditId = '';
        this._noteDraft = '';
        /* [v4.25.0 · R4-X3] 年鉴现场一并作废（章册缓存 / 选中的版 / 正在编的章题草稿都指着上一会话）。 */
        this._annualBook = null;
        this._annualEditNo = null;
        this._annualEditDraft = '';
        this._annualLine = '';
        this._annualStale = null;
        if (this.app.phoneShell?.screen) this.render();
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
        const excerpts = this.app.getExcerpts ? this.app.getExcerpts() : [];
        /* [v4.24.0 · R4-X8] 摘录区改由 `_noteRowsHtml` 排（**同一批摘录**,多了批注/标签/出处读数）；
         *   `_anchorLine` 是上一次核对的读数，核对过就常驻显示在标题旁（改版提示不靠弹窗一闪而过）。 */
        const excerptHtml = excerpts.length
            ? this._noteRowsHtml(tc, excerpts.slice(0, 30))
            : '<div class="rd-excerpt-empty">还没有摘录。阅读时点击任意段落即可摘录（自动带书/章/段引用）。</div>';
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
                <div class="rd-shelf-head" style="margin-top:18px">
                    <h2>🔎 全书找句</h2>
                    <span style="font-size:11px;color:${tc.sub}">扫全章</span>
                </div>
                ${this._findHtml(tc)}
                <div class="rd-shelf-head" style="margin-top:18px">
                    <h2>✂️ 摘录与我的笔记</h2>
                    <span style="font-size:11px;color:${tc.sub}">${excerpts.length} 条</span>
                </div>
                <div class="rd-import-wrap" style="display:flex;flex-wrap:wrap;gap:6px">
                    <button class="rd-mini" id="rd-anchor-check">核对摘录出处</button>
                </div>
                <div class="rd-excerpt-empty" style="padding:0 4px 8px">${esc(this._anchorLine || '出处还没核过。改版过的旧书，摘录点回去可能落在别的段上 —— 核一次就知道。')}</div>
                ${excerptHtml}
                <div class="rd-shelf-head" style="margin-top:18px">
                    <h2>🧾 创作素材清单</h2>
                    <span style="font-size:11px;color:${tc.sub}">原文与我写的分列</span>
                </div>
                <div class="rd-import-wrap" style="display:flex;flex-wrap:wrap;gap:6px">
                    <button class="rd-mini" id="rd-research-refresh">重新核对清单出处</button>
                    ${this._researchRunning ? '<button class="rd-mini" id="rd-research-cancel">取消</button>' : ''}
                </div>
                <div class="rd-excerpt">
                    <div class="rd-excerpt-text" style="font-size:12px">${esc(this.researchText())}</div>
                </div>
                <div class="rd-find-progress rd-excerpt-text" style="font-size:12px">${esc(this._researchProgressLine())}</div>
                <div class="rd-shelf-head" style="margin-top:18px">
                    <h2>📖 故事年鉴</h2>
                    <span style="font-size:11px;color:${tc.sub}">按卷章读 · 导出离线可读</span>
                </div>
                ${this._annualHtml(tc)}
                <div class="rd-shelf-head" style="margin-top:18px">
                    <h2>🗄 书库与备份</h2>
                    <span style="font-size:11px;color:${tc.sub}">四段一起走</span>
                </div>
                <div class="rd-excerpt">
                    <div class="rd-excerpt-text" style="font-size:12px">${esc(this._libLine())}</div>
                </div>
                <div class="rd-import-wrap" style="display:flex;flex-wrap:wrap;gap:6px">
                    <button class="rd-mini" id="rd-lib-scan">扫描书库</button>
                    <button class="rd-mini" id="rd-lib-export">导出书库包</button>
                    <button class="rd-mini" id="rd-lib-plan">预演导入</button>
                    <button class="rd-mini" id="rd-lib-commit">确认导入</button>
                    <button class="rd-mini" id="rd-lib-undo">撤销本次导入</button>
                </div>
                <div class="rd-excerpt-empty" style="padding:6px 4px">不静默下载外链图片 · 不上传云端 · <b>不完整不写</b>（缺正文的书默认拒收，除非你显式允许部分导入）</div>
                ${this._libRowsHtml(tc)}
            </div>
        </div>`;
    }

    _renderReader(tc) {
        const book = this.currentBook;
        const ch = book.chapters[this.curChapter] || { title: '', paragraphs: [] };
        const paras = ch.paragraphs || [];
        /* [v4.18.0 · R4-O6] **只渲染邻域**:2 万段的单章一次全铺进 DOM 会把首屏变成一次长任务。
         *   ★ 切片是**窗口**而不是截断:两头都能用 `showMoreParas()` 扩(验收原文禁止「以截掉长章代替分页」)。
         *   ★ `data-para` 仍是**全章下标**,故摘录与进度锚点读的都是段身份,不受切片影响。 */
        const win = paraWindowOf(paras, { anchor: this.anchorPara, pageSize: PARA_WINDOW_SIZE });
        this._lastParaWindow = win;
        const paraNote = (win.ok && (win.hasBefore || win.hasAfter))
            ? '<div class="rd-para-note" id="rd-para-note">' + esc(paraLine(win)) + '</div>'
            : '';
        const content = paras.length ? win.items.map((p, k) => `<p data-para="${win.start + k}">${esc(p)}</p>`).join('') : '<p style="text-indent:0;color:#9a8b76">（本章暂无内容）</p>';
        const chapterOptions = book.chapters.map((c, i) =>
            `<option value="${i}" ${i === this.curChapter ? 'selected' : ''}>${esc(c.title || ('第' + (i + 1) + '章'))}</option>`).join('');
        const authorLine = book.author ? ` · ${esc(book.author)}` : '';
        const pct = book.chapters.length ? Math.round(((this.curChapter + 1) / book.chapters.length) * 100) : 0;
        return `
        <div class="rd-reader">
            <div class="rd-reader-bar">
                <button class="rd-back" id="rd-back" title="返回书架">‹</button>
                <select id="rd-chapters" class="rd-chapters">${chapterOptions}</select>
                <div class="rd-fonts">
                    <button class="rd-f" id="rd-theme" title="切换主题">${READING_THEME_LABELS[this.theme] || READING_THEME_LABELS[READING_THEMES[0]]}</button>
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
            ${paraNote}
            <div class="rd-para-more">
                <button class="rd-mini" id="rd-more-before" ${(!win.ok || !win.hasBefore) ? 'disabled style="opacity:.4"' : ''}>‹ 往上看</button>
                <button class="rd-mini" id="rd-more-after" ${(!win.ok || !win.hasAfter) ? 'disabled style="opacity:.4"' : ''}>往下看 ›</button>
            </div>
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
                const order = READING_THEMES;
                const at = order.indexOf(this.theme);
                this.theme = order[(at < 0 ? 0 : at + 1) % order.length];
                this._saveProgress();
                this.render();
            });
            /* [v4.18.0 · R4-O6] 扩窗口(往上看 / 往下看)。**只动画口,不删任何段**。 */
            q('#rd-more-before')?.addEventListener('click', () => this.showMoreParas(-1));
            q('#rd-more-after')?.addEventListener('click', () => this.showMoreParas(1));
            /* 滚动时记段落锚点(节流 400ms):离开页面/改字号/摘录回跳都靠它回到同段。 */
            q('.rd-content')?.addEventListener('scroll', () => this._captureParaAnchorThrottled());
            /* [v3.99.2 · R3-X8] 点击段落 ⇒ 摘录（带书/章/段引用，入会话键，随书隔离）。
             *   [v4.24.0 · R4-X8] 摘录时**顺手钉住这本书当前的指纹**：App 侧还有一道兜底
             *   （从书架条目补），两处都取不到就如实留空、日后判「需确认」。 */
            root.querySelectorAll('.rd-content p[data-para]').forEach(p => {
                p.style.cursor = 'pointer';
                p.title = '点击摘录这段';
                p.addEventListener('click', () => {
                    const book = this.currentBook;
                    if (!book) return;
                    const r = this.app.addExcerpt({
                        text: (book.chapters[this.curChapter]?.paragraphs || [])[Number(p.dataset.para)] || '',
                        bookId: book.id, bookTitle: book.title,
                        bookHash: (this.app.data.getBook(book.id) || {}).contentHash || '',
                        chapter: this.curChapter, para: Number(p.dataset.para),
                        chapterTitle: book.chapters[this.curChapter]?.title || ''
                    });
                    if (r && r.ok) {
                        p.style.background = 'rgba(180,150,90,.18)';
                        this.app.phoneShell?.showNotification?.('阅读', '已摘录（' + r.count + ' 条）', '✂️');
                    } else {
                        this.app.phoneShell?.showNotification?.('阅读', (r && r.error) || '摘录失败', '⚠️');
                    }
                });
            });
        } else {
            q('#rd-file')?.addEventListener('change', e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                this.app.importFile(file);
            });
            q('#rd-paste-label')?.addEventListener('click', () => q('#rd-file')?.click());
            /* ══ [v4.24.0 · R4-X8] 研究笔记面：查找 / 出处核对 / 批注与标签 ══
             *   三条纪律：① 出处**需确认就不跳**（改版书点回去会落到别的段上）；
             *   ② 批注只写 `annotation`/`tags` 两格，原文一格不动；
             *   ③ 查找与核对失败**如实说**，不显示成「没有命中 / 全都对得上」。 */
            q('#rd-find-run')?.addEventListener('click', async () => {
                const input = q('#rd-find-input');
                await this.runFind(input ? input.value : '');
            });
            /* [v4.34.0 · R5-O7] 取消：大书上建索引要跨许多轮宏任务，没有这一口
             *   用户只能干等 —— 而「能不能取消」正是本版验收点名的一条。 */
            q('#rd-find-cancel')?.addEventListener('click', () => this.cancelFind());
            q('#rd-find-input')?.addEventListener('keydown', async (e) => {
                if (e && e.key === 'Enter') await this.runFind(e.target ? e.target.value : '');
            });
            q('#rd-anchor-check')?.addEventListener('click', async () => {
                const r = await this.refreshAnchors();
                this.app.phoneShell?.showNotification?.('阅读', (r && r.line) || '核对读不到', '🧭');
            });
            /* [v4.35.0 · R5-O8] 清单出处回源核对：重开自动跑一次（见 render），这里给手动重跑与取消。 */
            q('#rd-research-refresh')?.addEventListener('click', async () => { await this.refreshResearch(); });
            q('#rd-research-cancel')?.addEventListener('click', () => this.cancelResearch());
            /* ══ [v4.25.0 · R4-X3] 故事年鉴面：重读 / 切版 / 编辑章题 / 记进度 / 导出 ══
             *   三条纪律：① 默认给**阅读版**（作者版须显式切）；
             *   ② 编辑只交上游出口；③ 导出只是本地文件，不联网发布。 */
            q('#rd-annual-refresh')?.addEventListener('click', () => this.refreshAnnual());
            q('#rd-annual-export')?.addEventListener('click', () => this.exportAnnual());
            q('#rd-annual-set')?.addEventListener('click', () => {
                const input = q('#rd-annual-through');
                this.setAnnualReadThrough(input ? input.value : '');
            });
            root.querySelectorAll('[data-annual-ver]').forEach(btn => {
                btn.addEventListener('click', () => this.setAnnualVersion(btn.dataset.annualVer));
            });
            root.querySelectorAll('[data-annual-edit]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._annualEditNo = Number(btn.dataset.annualEdit);
                    const book = this._annualOf();
                    const hit = (book && Array.isArray(book.chapters) ? book.chapters : [])
                        .filter(x => Number(x.no) === Number(this._annualEditNo))[0];
                    this._annualEditDraft = hit ? String(hit.title || '') : '';
                    this.render();
                });
            });
            root.querySelectorAll('[data-annual-save]').forEach(btn => {
                btn.addEventListener('click', () => this.saveAnnualTitle(btn.dataset.annualSave));
            });
            root.querySelectorAll('[data-annual-cancel]').forEach(btn => {
                btn.addEventListener('click', () => { this._annualEditNo = null; this._annualEditDraft = ''; this.render(); });
            });
            root.querySelectorAll('[data-hit-goto]').forEach(btn => {
                btn.addEventListener('click', () => this.gotoHit(btn.dataset.hitGoto));
            });
            root.querySelectorAll('[data-note-edit]').forEach(btn => {
                btn.addEventListener('click', () => this.startNote(btn.dataset.noteEdit));
            });
            root.querySelectorAll('[data-note-cancel]').forEach(btn => {
                btn.addEventListener('click', () => this.cancelNote());
            });
            root.querySelectorAll('[data-note-save]').forEach(btn => {
                btn.addEventListener('click', () => this.saveNote(btn.dataset.noteSave));
            });
            root.querySelectorAll('[data-note-goto]').forEach(btn => {
                btn.addEventListener('click', async () => { await this.gotoExcerpt(btn.dataset.noteGoto); });
            });
            root.querySelectorAll('[data-note-del]').forEach(btn => {
                btn.addEventListener('click', async () => { await this.deleteExcerpt(btn.dataset.noteDel); });
            });
            root.querySelectorAll('.rd-mini.read')?.forEach(btn => {
                btn.addEventListener('click', () => this.app.openBook(btn.dataset.id));
            });
            root.querySelectorAll('.rd-mini.del')?.forEach(btn => {
                /* [第三期 R3-X8] 删书改走 App 的 removeBook:书目条目与本机正文附件一起删,
                 *   否则附件层会留正文孤儿(删过的书重启后又"回来"一半)。
                 *   [v4.21.0 · R4-O9] 删之前**先列清引用**(验收最后一条):这本正文被谁指着 ——
                 *   书架条目 / 几条摘录 / 进度到第几章。删完才发现「进度没了」是最不需要吃的亏。 */
                btn.addEventListener('click', async () => {
                    let line = '';
                    try { const r = await this.app.bodyRefsOf(btn.dataset.id); line = (r && r.line) || ''; }
                    catch (_e) { line = '引用清单读不到（不假装为空）'; }
                    this.app.phoneShell?.showNotification?.('阅读', '将删除:' + line, '🗑');
                    this.app.removeBook(btn.dataset.id);
                    this.render();
                });
            });
            /* [v4.21.0 · R4-O9] 书库四步。**每一步都如实报告结果**,失败/部分不写说成完整成功。 */
            q('#rd-lib-scan')?.addEventListener('click', async () => {
                await this.app.scanLibrary();
                this.render();
            });
            q('#rd-lib-export')?.addEventListener('click', async () => {
                const r = await this.app.exportLibrary();
                this.app.phoneShell?.showNotification?.('阅读', (r && r.line) || '导出失败', '📦');
                this.render();
            });
            q('#rd-lib-plan')?.addEventListener('click', async () => {
                const r = await this.app.planLibraryImportOf(null, {});
                const note = (r && r.ok) ? String(r.line || '') : ('读不出这份包:' + String((r && r.note) || ''));
                this.app.phoneShell?.showNotification?.('阅读', note, '🧾');
                this.render();
            });
            q('#rd-lib-commit')?.addEventListener('click', async () => {
                const r = await this.app.commitLibrary({});
                const ok = !!(r && r.ok);
                this.app.phoneShell?.showNotification?.('阅读', (ok ? '✅ ' : '⚠️ ') + String((r && r.note) || (r && r.kind) || ''), ok ? '✅' : '⚠️');
                this.render();
            });
            q('#rd-lib-undo')?.addEventListener('click', async () => {
                const r = await this.app.undoLibrary();
                this.app.phoneShell?.showNotification?.('阅读', String((r && r.note) || ''), '↩️');
                this.render();
            });
        }
    }

    /* ================= [v4.18.0 · R4-O6] 段落锚点:精确进度 ================= */
    /** 当前滚动位置最靠近顶部的那一段(读不出 ⇒ 保持原锚点,**不补 0**)。 */
    _topVisiblePara() {
        const root = this.app.phoneShell?.screen;
        if (!root) return null;
        const box = root.querySelector('.rd-content');
        if (!box) return null;
        const top = box.getBoundingClientRect().top;
        const ps = Array.from(box.querySelectorAll('p[data-para]'));
        for (const p of ps) {
            if (p.getBoundingClientRect().bottom >= top) {
                const v = anchorOf([], p.dataset.para);
                if (v !== null) return v;
            }
        }
        return null;
    }
    /** 记锚点(**节流 400ms**;滚动事件每帧都来,不能每帧都写字段)。 */
    _captureParaAnchorThrottled() {
        const now = (typeof Date.now === 'function') ? Date.now() : 0;
        if (this._anchorAt && now && now - this._anchorAt < 400) return false;
        this._anchorAt = now;
        const v = this._topVisiblePara();
        if (v === null) return false;
        this.anchorPara = v;
        this._saveProgress();
        return true;
    }
    /**
     * 扩窗口(delta = -1 往上看 / +1 往下看):把锚点往那一头挪 `PARA_WINDOW_SIZE` 段并重绘。
     *   ★ **不删任何段**:窗口外仍在章数组里,只是这一帧不渲染。
     *   ★ 到边界如实返回 ok:false(不假装扩了)。
     * @returns {{ok:boolean, anchor:number, hasMore:boolean}}
     */
    showMoreParas(delta) {
        const book = this.currentBook;
        if (!book) return { ok: false, anchor: 0, hasMore: false };
        const ch = book.chapters[this.curChapter] || { paragraphs: [] };
        const total = (ch.paragraphs || []).length;
        if (!total) return { ok: false, anchor: 0, hasMore: false };
        const w = this._lastParaWindow || paraWindowOf(ch.paragraphs || [], { anchor: this.anchorPara, pageSize: PARA_WINDOW_SIZE });
        const cur = (w.anchor === null) ? 0 : w.anchor;
        const step = Math.max(1, Math.floor(PARA_WINDOW_SIZE / 2));
        let next = cur + (delta < 0 ? -step : step);
        if (next < 0) next = 0;
        if (next > total - 1) next = total - 1;
        const changed = next !== cur;
        this.anchorPara = next;
        this._saveProgress();
        if (changed) this.render();
        return { ok: changed, anchor: next, hasMore: (next > 0 && next < total - 1) };
    }
    _saveProgress() {
        try {
            if (!this.currentBook) return;
            this.app.storage?.set?.('ruby_reading_progress_' + this.currentBook.id, JSON.stringify({ chapter: this.curChapter, fontPx: this.fontPx, theme: this.theme, para: (this.anchorPara === null ? undefined : this.anchorPara) }));
        } catch (e) { /* 忽略 */ }
    }

    _loadProgress(bookId) {
        try {
            const raw = this.app.storage?.get?.('ruby_reading_progress_' + bookId);
            if (raw) {
                const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
                this.curChapter = Number(p.chapter) || 0;
                this.fontPx = Number(p.fontPx) || 16;
                if (READING_THEMES.includes(p.theme)) this.theme = p.theme;
                /* [v4.18.0 · R4-O6] 段落锚点:读不出保持 null(⇒ 从首段起),**不补 0**
                 *   —— 0 是合法首段,与「没记过锚点」在同一读数上处置相同、但语义不同,
                 *   故这里只做「有就贴、没有就不设」。 */
                const pa = anchorOf([], p.para);
                this.anchorPara = (pa === null) ? null : pa;
            }
        } catch (e) { this.curChapter = 0; }
    }
}

export default ReadingView;