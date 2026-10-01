/* ========================================================
 * pixiv-view.js — [v3.35.0] Pixiv 视图层
 * 照抄 lofter / date / taobao 规格：`_buildHTML()` 拼串 → `innerHTML` → `_bindEvents()`。
 * 只在 render / refresh 里读 App 现算值，**不缓存投影**（防陈旧）。
 *
 * 三条视图纪律：
 *  ① 一张图都不渲染：本件没有 `<img>`、没有地址字段，插画面是**登记面**。
 *  ② 心数是**确定性读数**（来自数据层派生式），视图不做任何美化、不做随机。
 *  ③ 评论三态「没读过 / 读出来了 / 试过没成」在视图里必须看起来不一样：
 *     源把三者压成一个 boolean，视图于是永远显示「还没有人说话」——
 *     那是「没读过」的句子，拿来说「读失败了」就是自洽地骗人。
 * ======================================================== */
'use strict';
import {
    PIXIV_REASONS, PIXIV_LIMITS, PIXIV_COMMENT_DELIM, PIXIV_COMMENT_FACES,
} from './pixiv-data.js';
/** HTML 转义要 replace 掉的「双引号」——用**字符数组 + split/join**，不写成正则字面量。
 *  ★ 本仓判据共用的剥注释器（`stripComments`）是字符状态机、**不解析正则字面量**：
 *    正则字面量里一旦出现半个引号，剥器就把它当成字符串的起头，从那一行往后块注释再也剥不掉。
 *    v3.31.0 在 date-view 上当场踩到，本件一律照 date / lofter 的写法抄。 */
const DQUOTE = '"';
/** `&` 的**拼装形**（不写实体字面量：落盘传输链会把 `&amp;` 这类字面量解码成真字符，
 *  于是 `_esc` 静默失效却不报错 —— 本件在数据层当场踩过这个坑）。 */
const AMP = String.fromCharCode(38);
/** 「多久以前」的人话（只看毫秒与 Date，不 import App —— 免得 App <-> View 成环）。 */
function agoText(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '时间不详';
    const d = Math.max(0, Date.now() - n);
    const s2 = Math.floor(d / 1000);
    if (s2 < 60) return '刚刚';
    const m = Math.floor(s2 / 60);
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const dy = Math.floor(h / 24);
    if (dy < 30) return dy + ' 天前';
    const dt = new Date(n);
    const p = (x) => String(x).padStart(2, '0');
    return p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}
const FACE_META = {
    [PIXIV_REASONS.ok]: { icon: '\u{1f3a8}', label: 'Pixiv 开着', tone: 'ok' },
    [PIXIV_REASONS.empty]: { icon: '\u{1f4c4}', label: '还没有作品，也没有插画登记', tone: 'warn' },
    [PIXIV_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};
const TABS = [
    { key: 'novel', label: '作品' },
    { key: 'illust', label: '插画' },
    { key: 'me', label: '我的' },
    { key: 'search', label: '检索' },
];
/* 「我的」五格的真源是 App 投影里的 `meTabs`；这里只给每格配人话标签，
 * 顺序与投影一致（favorites / following / history / works / settings）。 */
const MY_FACES = [
    { key: 'favorites', label: '收藏' },
    { key: 'following', label: '追更' },
    { key: 'history', label: '翻过' },
    { key: 'works', label: '我写的' },
];
/** 评论四态的人话（`failed` 与 `not_read` **不许同形**，故各给各的话）。
 *  ★ 键**取真源常量**（计算键），不手写标识符形 —— 见数据层 `PIXIV_COMMENT_FACES`
 *    的注释（本仓 J7 的真缺陷：手写键与真源值不同形 ⇒ 查不到、静默走兜底）。 */
const CMT_FACE_TEXT = {
    [PIXIV_COMMENT_FACES.not_read]: '评论还没读',
    [PIXIV_COMMENT_FACES.partial]: '评论读了一半',
    [PIXIV_COMMENT_FACES.read]: '评论已读',
    [PIXIV_COMMENT_FACES.failed]: '评论这次没读出来',
};
export class PixivView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._myFace = 'favorites';
        this._open = '';
        this._replyTo = '';
        this._promptFor = '';
        this._promptText = '';
        this._flash = '';
        this._draft = {
            title: '', synopsis: '', tagLine: '', styleId: '', isSerial: false,
            chapterText: '', commentText: '', direction: '', lengthLabel: '',
            prompt: '', negativePrompt: '', size: '1024x1024', count: '', search: '', hostComments: '',
            authorName: '', authorBio: '', authorTags: '', authorType: '', styleName: '', styleRules: '',
        };
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'pxv-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _q(sel) { return this._root ? this._root.querySelector(sel) : null; }
    _qa(sel) { return this._root ? this._root.querySelectorAll(sel) : []; }
    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const cur = app.tab();
        const parts = [];
        parts.push('<div class="pxv-header"><h2>\u{1f3a8} Pixiv</h2>'
            + '<span class="pxv-header-sub">日文同人平台</span></div>');
        parts.push('<div class="pxv-face pxv-face-' + meta.tone + '">');
        parts.push('<span class="pxv-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="pxv-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="pxv-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="pxv-flash">' + this._esc(this._flash) + '</div>');
        if (this._open) parts.push(this._readerPanel());
        parts.push('<div class="pxv-tabs">');
        for (const t of TABS) {
            parts.push('<button class="pxv-tab' + (cur === t.key ? ' is-on' : '') + '" data-tab="' + t.key + '">');
            parts.push('<span class="pxv-tab-label">' + this._esc(t.label) + '</span>');
            parts.push('<span class="pxv-tab-sub">' + this._esc(app.faceOf(t.key)) + '</span>');
            parts.push('</button>');
        }
        parts.push('</div>');
        if (cur === 'illust') parts.push(this._illustPanel());
        else if (cur === 'me') parts.push(this._mePanel());
        else if (cur === 'search') parts.push(this._searchPanel());
        else parts.push(this._novelPanel());
        parts.push(this._promptPanel());
        parts.push(this._writePanel());
        parts.push(this._stylePanel());
        parts.push(this._settingsPanel());
        return parts.join('\n');
    }
    /* ---------- 作品面 ---------- */
    _novelPanel() {
        const app = this.app;
        const list = app.novelsAll();
        const parts = [];
        parts.push('<div class="pxv-panel">');
        const hot = app.hotTags();
        if (hot.length) {
            parts.push('<div class="pxv-tagrow"><span class="pxv-tagrow-lab">热门</span>');
            for (const h of hot.slice(0, 8)) {
                parts.push('<button class="pxv-tag pxv-tag-sm" data-tag="' + this._esc(h.tag) + '">'
                    + this._esc(h.tag) + '<span class="pxv-tag-n">' + h.count + '</span></button>');
            }
            parts.push('</div>');
        }
        const months = app.byMonth();
        parts.push('<h3 class="pxv-title">作品（' + list.length + ' / 池里 '
            + app.readings().totalNovels + '）</h3>');
        if (!list.length) {
            parts.push('<div class="pxv-empty">池里还没有带正文的作品。'
                + '去下面的「投稿」贴一段宿主写的正文，或者关掉「隐藏没有正文的作品」。</div>');
        } else {
            if (months.length > 1) {
                for (const m of months) {
                    parts.push('<div class="pxv-month">' + this._esc(m.month) + ' · ' + m.list.length + ' 篇</div>');
                    for (const n of m.list) parts.push(this._novelCard(n));
                }
            } else {
                for (const n of list) parts.push(this._novelCard(n));
            }
        }
        parts.push('</div>');
        return parts.join('\n');
    }
    /** 作品卡（列表与检索共用）：**心数是读数、不是随机数**。 */
    _novelCard(n) {
        const app = this.app;
        const fl = app.flagsOf(n.id);
        const st = app.statsOf(n.id) || { hearts: '0', raw: null, words: 0, minutes: 1, chapters: 0 };
        const parts = [];
        parts.push('<div class="pxv-card">');
        parts.push('<button class="pxv-card-head" data-read="' + this._esc(n.id) + '">');
        parts.push('<span class="pxv-card-avatar">' + this._esc(String(n.authorName || '?').slice(0, 1)) + '</span>');
        parts.push('<span class="pxv-card-main">');
        parts.push('<span class="pxv-card-title">' + this._esc(n.title || '(无题)') + '</span>');
        parts.push('<span class="pxv-card-by">' + this._esc(n.authorName || '佚名')
            + ' · ' + this._esc(agoText(n.updatedAt || n.createdAt))
            + ' · ' + n.chapters.length + ' 話</span>');
        parts.push('</span>');
        parts.push('<span class="pxv-card-kind">' + (n.completed ? '完结' : (n.isSerial ? '连载' : '短篇')) + '</span>');
        parts.push('</button>');
        if (n.synopsis) parts.push('<div class="pxv-card-sum">' + this._esc(n.synopsis) + '</div>');
        parts.push('<div class="pxv-card-meta">');
        parts.push('<span class="pxv-n pxv-n-heart">\u2661 ' + this._esc(st.hearts) + '</span>');
        parts.push('<span class="pxv-n">' + this._esc(this._n(st.words)) + ' 字</span>');
        parts.push('<span class="pxv-n">' + st.minutes + ' 分钟</span>');
        if (st.raw && !st.raw.consistent) {
            parts.push('<span class="pxv-n pxv-n-warn">心数不自洽（缓存 ' + st.raw.cached
                + ' / 逐章最高 ' + st.raw.maxChapter + '）</span>');
        }
        if (n.tags.length) {
            parts.push('<span class="pxv-card-tags">');
            for (const t of n.tags) {
                parts.push('<button class="pxv-tag pxv-tag-xs" data-tag="' + this._esc(t) + '">'
                    + this._esc(t) + '</button>');
            }
            parts.push('</span>');
        }
        parts.push('<span class="pxv-card-acts">');
        parts.push('<button class="pxv-mini' + (fl.favorited ? ' is-on' : '') + '" data-fav="'
            + this._esc(n.id) + '">\u2606</button>');
        parts.push('<button class="pxv-mini' + (fl.following ? ' is-on' : '') + '" data-following="'
            + this._esc(n.id) + '">\u{1f516}</button>');
        parts.push('<button class="pxv-mini" data-read="' + this._esc(n.id) + '">读</button>');
        parts.push('</span>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 阅读器（含评论区与续章） ---------- */
    _readerPanel() {
        const app = this.app;
        const n = app.novelById(this._open);
        if (!n) return '';
        const ch = app.currentChapter();
        const chapters = app.chaptersOf(n.id);
        const parts = [];
        parts.push('<div class="pxv-reader">');
        parts.push('<div class="pxv-reader-head">');
        parts.push('<h3 class="pxv-reader-title">' + this._esc(n.title || '(无题)') + '</h3>');
        parts.push('<span class="pxv-reader-by">' + this._esc(n.authorName || '佚名') + '</span>');
        parts.push('<button class="pxv-mini" id="pxv-reader-close">\u2715 合上</button>');
        parts.push('</div>');
        // 目录
        parts.push('<div class="pxv-toc">');
        parts.push('<span class="pxv-toc-lab">目录</span>');
        if (!chapters.length) parts.push('<span class="pxv-empty-inline">还没有章。</span>');
        for (const c of chapters) {
            const pos = app.positionOf(n.id, c.num, n.completed && c.num === chapters[chapters.length - 1].num);
            const on = ch && c.num === ch.num;
            // ★ 坏号章（`num === null`）：不假装成一个具体章号，也不给点击目标。
            const numLabel = c.num === null ? '章号不详' : ('第 ' + c.num + ' 話');
            const chapAttr = c.num === null ? '' : (' data-chap="' + c.num + '"');
            parts.push('<button class="pxv-toc-item' + (on ? ' is-on' : '') + (c.num === null ? ' is-bad' : '') + '"' + chapAttr + '>'
                + '<span class="pxv-toc-n">' + numLabel + '</span>'
                + '<span class="pxv-toc-pos">' + this._esc(pos.label) + '</span>'
                + '<span class="pxv-toc-heart">\u2661 ' + this._esc(String(c.hearts + (c.likeBoost || 0))) + '</span>'
                + '</button>');
        }
        parts.push('</div>');
        if (ch) {
            const pos = app.positionOf(n.id, ch.num, false);
            parts.push('<div class="pxv-chapter-head">');
            parts.push('<span class="pxv-chap-num">第 ' + ch.num + ' 話</span>');
            parts.push('<span class="pxv-chap-title">' + this._esc(ch.title || '') + '</span>');
            parts.push('<span class="pxv-chap-pos pxv-pos-' + pos.kind + '">' + this._esc(pos.label) + '</span>');
            parts.push('</div>');
            const paras = app.paragraphsOf(n.id, ch.num);
            parts.push('<div class="pxv-body">');
            if (!paras.length) parts.push('<div class="pxv-empty">这一話正文是空的。</div>');
            for (const p of paras) {
                parts.push('<p class="pxv-para">' + p.html + '</p>');
                if (p.droppedTags || p.droppedAttrs) {
                    parts.push('<div class="pxv-warn-inline">这一段里有 '
                        + (p.droppedTags ? (p.droppedTags + ' 个非白名单标签') : '')
                        + (p.droppedTags && p.droppedAttrs ? ' 和 ' : '')
                        + (p.droppedAttrs ? (p.droppedAttrs + ' 个非法属性') : '')
                        + '被挡下了（只留译文折叠块用的 details / summary / span / br）。</div>');
                }
            }
            parts.push('</div>');
            parts.push('<div class="pxv-chap-acts">');
            parts.push('<button class="pxv-mini' + (ch.isLiked ? ' is-on' : '') + '" data-chlike="' + ch.num + '">'
                + (ch.isLiked ? '\u2665 已点心' : '\u2661 点心') + '</button>');
            parts.push('<span class="pxv-chap-read">' + this._esc(String(ch.wordCount || 0)) + ' 字</span>');
            parts.push('</div>');
        }
        parts.push(this._commentBlock(n, ch));
        parts.push(this._continueBlock(n, ch));
        parts.push('</div>');
        return parts.join('\n');
    }
    /** 评论区：楼中楼 + 三态读数 + 「回复谁」 + 「让宿主给评论」。 */
    _commentBlock(n, ch) {
        const app = this.app;
        const parts = [];
        parts.push('<div class="pxv-cmts">');
        if (!ch) { parts.push('<div class="pxv-empty">先选一話。</div></div>'); return parts.join('\n'); }
        const cf = app.commentCountOf(n.id, ch.num);
        const all = app.commentRowsAll(n.id, ch.num);
        parts.push('<h4 class="pxv-cmt-title">评论 · ' + this._esc(CMT_FACE_TEXT[cf.face] || cf.face)
            + '（' + cf.count + ' 条）</h4>');
        if (cf.face === PIXIV_COMMENT_FACES.failed) {
            parts.push('<div class="pxv-warn">这一話的评论上次没读出来（不是「没有人说话」——'
                + '两件事本件分开记）。可以让宿主再给一次，或者自己先写一条。</div>');
        }
        if (all.truncated || all.orphans) {
            parts.push('<div class="pxv-warn">楼里有 ' + all.truncated + ' 条超过 '
                + PIXIV_LIMITS.maxCommentDepth + ' 层（已挂到最上面一层，没丢）；'
                + all.orphans + ' 条的父评论找不到（也挂到最上面一层）。</div>');
        }
        if (!all.rows.length) {
            parts.push('<div class="pxv-empty">' + (cf.face === PIXIV_COMMENT_FACES.not_read
                ? '还没读过这一話的评论。' : '这一話还没有人说话。') + '</div>');
        }
        for (const r of all.rows) {
            parts.push('<div class="pxv-cmt" data-depth="' + r.depth + '">');
            parts.push('<span class="pxv-cmt-indent">' + '\u00a0'.repeat(Math.max(0, (r.depth || 1) - 1) * 2) + '</span>');
            parts.push('<span class="pxv-cmt-by"' + (r.isOpReply ? ' data-op="1"' : '')
                + (r.from === 'me' ? ' data-me="1"' : '') + '>' + this._esc(r.author || '匿名')
                + (r.isOpReply ? ' · 作者' : '') + (r.from === 'me' ? ' · 我' : '') + '</span>');
            parts.push('<span class="pxv-cmt-text">' + this._esc(r.content) + '</span>');
            parts.push('<button class="pxv-mini" data-reply="' + this._esc(r.id) + '">'
                + (this._replyTo === r.id ? '取消' : '回复') + '</button>');
            parts.push('</div>');
        }
        if (this._replyTo) {
            const t = all.rows.filter((x) => x.id === this._replyTo)[0];
            parts.push('<div class="pxv-replying">正在回复 ' + this._esc(t ? (t.author || '匿名') : '某条')
                + '<button class="pxv-mini" id="pxv-reply-cancel">\u2715</button></div>');
        }
        parts.push('<textarea class="pxv-ta" id="pxv-cmt-text" placeholder="写一句……（挂到谁下面就先点那条的「回复」）">'
            + this._esc(this._draft.commentText) + '</textarea>');
        parts.push('<div class="pxv-row">');
        parts.push('<button class="pxv-btn" id="pxv-cmt-send">发出</button>');
        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cmt-prompt">让宿主给几条评论</button>');
        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cmt-ingest">收下宿主给的评论</button>');
        parts.push('</div>');
        parts.push('<textarea class="pxv-ta" id="pxv-cmt-host" placeholder="把宿主写的评论贴回来：每块用 '
            + PIXIV_COMMENT_DELIM + ' 起头，块内可写 AUTHOR: 名字 与 REPLY: 要回的序号（本次第几条）">'
            + this._esc(this._draft.hostComments) + '</textarea>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /** 续章块：下一話号 + 滑窗读数（几章全文 / 几章摘要，**明着报**）。 */
    _continueBlock(n, ch) {
        const app = this.app;
        const next = app.nextNumOf(n.id);
        const ctx = app.prevContextOf(n.id, next);
        const parts = [];
        parts.push('<div class="pxv-cont">');
        parts.push('<h4 class="pxv-cmt-title">写下一話（第 ' + next + ' 話）</h4>');
        parts.push('<div class="pxv-hint">前文给了 ' + ctx.fullCount + ' 章全文、'
            + ctx.digestCount + ' 章梗概（最近 ' + ctx.window + ' 章给全文）—— '
            + '这份要求是**文本**，请贴到你惯用的对话端，写完了再贴回来。</div>');
        parts.push('<div class="pxv-row">');
        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cont-prompt" data-novel="'
            + this._esc(n.id) + '">生成「下一話」的要求</button>');
        if (ch && n.isSerial) {
            parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-reroll" data-novel="' + this._esc(n.id)
                + '" data-chap="' + ch.num + '">重写这一話的要求</button>');
        }
        parts.push('</div>');
        parts.push('<textarea class="pxv-ta pxv-ta-tall" id="pxv-chapter" placeholder="把写好的正文贴在这里，再按「收下」">'
            + this._esc(this._draft.chapterText) + '</textarea>');
        parts.push('<div class="pxv-row">');
        parts.push('<button class="pxv-btn" id="pxv-chapter-ingest" data-novel="' + this._esc(n.id) + '">收下这一話</button>');
        if (ch) {
            parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-reroll-ingest" data-novel="'
                + this._esc(n.id) + '" data-chap="' + ch.num + '">收下并替换第 ' + ch.num + ' 話</button>');
        }
        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-complete" data-novel="' + this._esc(n.id) + '">'
            + (n.completed ? '重启连载' : '标完结') + '</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 插画面（登记面，一张图都不存） ---------- */
    _illustPanel() {
        const app = this.app;
        const list = app.illustsAll();
        const parts = [];
        parts.push('<div class="pxv-panel">');
        parts.push('<h3 class="pxv-title">插画登记（' + list.length + ' / ' + app.limits().maxIllusts + '）</h3>');
        parts.push('<div class="pxv-hint">这一面**只登记「你画过什么」**：提示词、尺寸、张数、谁画的。'
            + '不存图、不存地址、不渲染图片 —— 出图请在你自己的对话端做。</div>');
        if (!list.length) parts.push('<div class="pxv-empty">还没有登记。</div>');
        for (const i of list) {
            parts.push('<div class="pxv-ill">');
            parts.push('<div class="pxv-ill-prompt">' + this._esc(i.prompt) + '</div>');
            if (i.negativePrompt) parts.push('<div class="pxv-ill-neg">不要出现：' + this._esc(i.negativePrompt) + '</div>');
            parts.push('<div class="pxv-ill-meta">' + this._esc(i.size) + ' · ' + i.count + ' 张 · 画的人：'
                + this._esc(i.drawnBy || '未记') + ' · ' + this._esc(agoText(i.createdAt)) + '</div>');
            parts.push('<div class="pxv-row">');
            parts.push('<button class="pxv-mini' + (i.isFavorite ? ' is-on' : '') + '" data-illfav="'
                + this._esc(i.id) + '">' + (i.isFavorite ? '\u2665' : '\u2661') + '</button>');
            parts.push('<button class="pxv-mini" data-illprompt="' + this._esc(i.id) + '">要求</button>');
            parts.push('<button class="pxv-mini" data-illdel="' + this._esc(i.id) + '">\u2715</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        parts.push('<h4 class="pxv-cmt-title">登记一条</h4>');
        parts.push('<input class="pxv-input" id="pxv-ill-prompt" placeholder="画的是什么（比如：雪夜里的电车）" value="'
            + this._esc(this._draft.prompt) + '">');
        parts.push('<input class="pxv-input" id="pxv-ill-neg" placeholder="不要出现什么（可空）" value="'
            + this._esc(this._draft.negativePrompt) + '">');
        parts.push('<div class="pxv-row">');
        parts.push('<input class="pxv-input pxv-input-sm" id="pxv-ill-size" placeholder="尺寸" value="'
            + this._esc(this._draft.size) + '">');
        parts.push('<input class="pxv-input pxv-input-sm" id="pxv-ill-count" placeholder="张数" value="'
            + this._esc(this._draft.count) + '">');
        parts.push('<button class="pxv-btn" id="pxv-ill-add">登记</button>');
        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-ill-mkprompt">生成出图要求</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 我的 ---------- */
    _mePanel() {
        const app = this.app;
        const st = app.stored();
        const parts = [];
        parts.push('<div class="pxv-panel">');
        parts.push('<h3 class="pxv-title">我的</h3>');
        parts.push('<div class="pxv-subtabs">');
        for (const f of MY_FACES) {
            const n = app.myList(f.key).length;
            parts.push('<button class="pxv-subtab' + (this._myFace === f.key ? ' is-on' : '')
                + '" data-myface="' + f.key + '">' + this._esc(f.label)
                + '<span class="pxv-subtab-n">' + n + '</span></button>');
        }
        parts.push('</div>');
        const list = app.myList(this._myFace);
        if (!list.length) parts.push('<div class="pxv-empty">这一格还是空的。</div>');
        else for (const n of list) parts.push(this._novelCard(n));
        parts.push('<h4 class="pxv-cmt-title">订阅的 tag（' + st.subscribedTags.length + ' / '
            + app.limits().maxSubscribedTags + '）</h4>');
        if (!st.subscribedTags.length) parts.push('<div class="pxv-empty">还没订阅 tag。</div>');
        else {
            parts.push('<div class="pxv-tagrow">');
            for (const t of st.subscribedTags) {
                parts.push('<span class="pxv-tag pxv-tag-out">' + this._esc(t)
                    + '<button class="pxv-mini" data-untag="' + this._esc(t) + '">\u00d7</button></span>');
            }
            parts.push('</div>');
        }
        parts.push(this._authorPool());
        parts.push('</div>');
        return parts.join('\n');
    }
    /** 作者池：活跃与非活跃**都摆出来**（源把非活跃三类静默丢掉，本件标出来）。 */
    _authorPool() {
        const app = this.app;
        const all = app.authorsAll();
        const active = app.authorsActive();
        // ★ 走 App 那个出口（它直调数据层 `followedAuthorsOf`）—— 视图自己拆 store
        //   就是第二个口径，数据层改口径后视图不会跟着变。
        const followed = app.followedAuthors();
        const rec = app.recommendAuthors(3, '', 7);
        const read = app.readings();
        const parts = [];
        parts.push('<h4 class="pxv-cmt-title">作者池（活跃 ' + active.length + ' · 池里共 ' + all.length + '）</h4>');
        if (read.inactiveAuthors) {
            parts.push('<div class="pxv-warn">池里有 ' + read.inactiveAuthors
                + ' 位是源里会被**静默丢弃**的类型（公式号 / 推广号 / 情报站）—— 本仓把它们摆明：'
                + '留着、标出来、不参与推荐，而不是悄悄消失。</div>');
        }
        if (rec.length) {
            parts.push('<div class="pxv-rec">这轮想读：');
            for (const a of rec) {
                parts.push('<button class="pxv-tag pxv-tag-sm" data-author="' + this._esc(a.id) + '">'
                    + this._esc(a.name) + '</button>');
            }
            parts.push('</div>');
        }
        for (const a of all) {
            const isOn = followed.indexOf(String(a.id)) >= 0;
            const isActive = active.indexOf(a) >= 0;
            const n = app.novelsOfAuthor(a.id).length;
            parts.push('<div class="pxv-author' + (isActive ? '' : ' is-idle') + '">');
            parts.push('<span class="pxv-author-name">' + this._esc(a.name) + '</span>');
            parts.push('<span class="pxv-author-type">' + this._esc(app.typeLabel(a.type)) + '</span>');
            if (!isActive) parts.push('<span class="pxv-author-idle">不参与推荐</span>');
            if (a.builtIn) parts.push('<span class="pxv-author-built">内置</span>');
            if (a.bio) parts.push('<span class="pxv-author-bio">' + this._esc(a.bio) + '</span>');
            parts.push('<span class="pxv-author-n">' + n + ' 篇</span>');
            parts.push('<button class="pxv-mini' + (isOn ? ' is-on' : '') + '" data-followauthor="'
                + this._esc(a.id) + '">' + (isOn ? '已关注' : '关注') + '</button>');
            parts.push('</div>');
        }
        parts.push('<h4 class="pxv-cmt-title">加一位自己的写手</h4>');
        parts.push('<div class="pxv-row">');
        parts.push('<input class="pxv-input pxv-input-sm" id="pxv-au-name" placeholder="名字" value="'
            + this._esc(this._draft.authorName) + '">');
        parts.push('<select class="pxv-input pxv-input-sm" id="pxv-au-type">');
        for (const t of app.allTypes()) {
            parts.push('<option value="' + this._esc(t) + '"'
                + (this._draft.authorType === t ? ' selected' : '') + '>' + this._esc(app.typeLabel(t)) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<input class="pxv-input" id="pxv-au-bio" placeholder="一句话介绍（可空）" value="'
            + this._esc(this._draft.authorBio) + '">');
        parts.push('<input class="pxv-input" id="pxv-au-tags" placeholder="常写的方向，空格分开（最多 3 个）" value="'
            + this._esc(this._draft.authorTags) + '">');
        parts.push('<div class="pxv-row"><button class="pxv-btn" id="pxv-au-add">进池</button></div>');
        return parts.join('\n');
    }
    /* ---------- 检索 ---------- */
    _searchPanel() {
        const app = this.app;
        const q = this._draft.search;
        const hits = q ? app.search(q) : [];
        const parts = [];
        parts.push('<div class="pxv-panel">');
        parts.push('<h3 class="pxv-title">检索</h3>');
        parts.push('<input class="pxv-input" id="pxv-search" value="' + this._esc(q)
            + '" placeholder="标题 / 作者 / 摘要 / tag 里找（比如：純愛）">');
        parts.push('<div class="pxv-hint">检索是**本地**的：只在这台手机已经存下的作品里找，不去网上找。'
            + '上限 ' + app.limits().maxSearchHits + ' 条。</div>');
        if (q && !hits.length) parts.push('<div class="pxv-empty">没找到。</div>');
        for (const h of hits) parts.push(this._novelCard(h.novel));
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 生成要求（可复制文本） ---------- */
    _promptPanel() {
        if (!this._promptText) return '';
        const parts = [];
        parts.push('<div class="pxv-prompt">');
        parts.push('<h4 class="pxv-cmt-title">这份要求 · ' + this._esc(this._promptFor) + '</h4>');
        parts.push('<div class="pxv-hint">本 App **不会自己调模型** —— 下面这段贴到你惯用的对话端，'
            + '结果贴回上面相应的框里。</div>');
        parts.push('<pre class="pxv-pre" id="pxv-prompt-pre">' + this._esc(this._promptText) + '</pre>');
        parts.push('<div class="pxv-row"><button class="pxv-btn pxv-btn-ghost" id="pxv-prompt-close">收起</button></div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 投稿（新建作品） ---------- */
    _writePanel() {
        const app = this.app;
        const styles = app.styleList();
        const parts = [];
        parts.push('<div class="pxv-panel">');
        parts.push('<h3 class="pxv-title">投稿</h3>');
        parts.push('<input class="pxv-input" id="pxv-nv-title" placeholder="标题" value="'
            + this._esc(this._draft.title) + '">');
        parts.push('<textarea class="pxv-ta" id="pxv-nv-sum" placeholder="简介（可空）">'
            + this._esc(this._draft.synopsis) + '</textarea>');
        parts.push('<input class="pxv-input" id="pxv-nv-tags" placeholder="标签，拿空格或逗号分开（最多 '
            + app.limits().maxTagsPerNovel + ' 个）" value="' + this._esc(this._draft.tagLine) + '">');
        parts.push('<div class="pxv-row">');
        parts.push('<select class="pxv-input pxv-input-sm" id="pxv-nv-style">');
        parts.push('<option value="">不指定文风</option>');
        for (const s of styles) {
            parts.push('<option value="' + this._esc(s.id) + '"'
                + (this._draft.styleId === s.id ? ' selected' : '') + '>' + this._esc(s.name) + '</option>');
        }
        parts.push('</select>');
        parts.push('<label class="pxv-check"><input type="checkbox" id="pxv-nv-serial"'
            + (this._draft.isSerial ? ' checked' : '') + '>连载</label>');
        parts.push('<button class="pxv-btn" id="pxv-nv-add">建一篇</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 文风库 ---------- */
    _stylePanel() {
        const app = this.app;
        const list = app.styleList();
        const builtIn = app.builtInStyleIds();
        const parts = [];
        parts.push('<div class="pxv-panel">');
        parts.push('<h3 class="pxv-title">文风库（' + list.filter((s) => s.enabled !== false).length
            + ' 款开着 / 共 ' + list.length + '）</h3>');
        for (const s of list) {
            const isBuiltIn = builtIn.indexOf(s.id) >= 0;
            parts.push('<div class="pxv-style' + (s.enabled === false ? ' is-off' : '') + '">');
            parts.push('<span class="pxv-style-name">' + this._esc(s.name) + '</span>');
            if (isBuiltIn) parts.push('<span class="pxv-style-built">内置</span>');
            parts.push('<span class="pxv-style-rules">' + this._esc(s.rules || '（没有规则）') + '</span>');
            parts.push('<button class="pxv-mini' + (s.enabled !== false ? ' is-on' : '') + '" data-styletog="'
                + this._esc(s.id) + '">' + (s.enabled !== false ? '开着' : '关着') + '</button>');
            if (!isBuiltIn) {
                parts.push('<button class="pxv-mini" data-styledel="' + this._esc(s.id) + '">\u2715</button>');
            }
            parts.push('</div>');
        }
        parts.push('<div class="pxv-row">');
        parts.push('<input class="pxv-input pxv-input-sm" id="pxv-st-name" placeholder="文风名" value="'
            + this._esc(this._draft.styleName) + '">');
        parts.push('<input class="pxv-input" id="pxv-st-rules" placeholder="规则（真正喂给模型的那句）" value="'
            + this._esc(this._draft.styleRules) + '">');
        parts.push('<button class="pxv-btn" id="pxv-st-add">加一款</button>');
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 设置 ---------- */
    _settingsPanel() {
        const app = this.app;
        const s = app.settings || {};
        const styles = app.styleList();
        const parts = [];
        parts.push('<div class="pxv-panel">');
        parts.push('<h3 class="pxv-title">设置</h3>');
        parts.push('<div class="pxv-set">');
        parts.push('<label class="pxv-set-lab">正文语言</label>');
        parts.push('<select class="pxv-input pxv-input-sm" id="pxv-set-lang">');
        for (const m of app.languageModes()) {
            parts.push('<option value="' + this._esc(m.id) + '"'
                + (s.language === m.id ? ' selected' : '') + '>' + this._esc(m.label) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<div class="pxv-set">');
        parts.push('<label class="pxv-set-lab">默认文风</label>');
        parts.push('<select class="pxv-input pxv-input-sm" id="pxv-set-style">');
        parts.push('<option value="">每篇随机挑一款</option>');
        for (const st of styles) {
            parts.push('<option value="' + this._esc(st.id) + '"'
                + (s.styleId === st.id ? ' selected' : '') + '>' + this._esc(st.name) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<div class="pxv-set">');
        parts.push('<label class="pxv-set-lab">显示没有正文的作品</label>');
        parts.push('<label class="pxv-check"><input type="checkbox" id="pxv-set-show"'
            + (s.showInvalidNovels ? ' checked' : '') + '>显示</label>');
        parts.push('</div>');
        parts.push('<div class="pxv-set">');
        parts.push('<label class="pxv-set-lab">字号</label>');
        parts.push('<input class="pxv-input pxv-input-sm" id="pxv-set-font" value="' + this._esc(String(s.fontSize || 16)) + '">');
        parts.push('</div>');
        parts.push('<div class="pxv-readings">读数：作品池 ' + app.readings().totalNovels
            + ' · 登记 ' + app.readings().totalIllusts
            + ' · 本轮裁掉 ' + app.readings().dropped
            + ' · 非活跃作者 ' + app.readings().inactiveAuthors + '</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 事件 ---------- */
    _bindEvents() {
        const app = this.app;
        const self = this;
        const flash = (r, okText) => {
            if (r && r.ok) self._flash = okText || '好了';
            else self._flash = (r && r.error) ? r.error : '没成';
        };
        for (const b of this._qa('.pxv-tab')) {
            b.addEventListener('click', () => { app.setTab(b.dataset.tab); this._open = ''; this.refresh(); });
        }
        for (const b of this._qa('.pxv-subtab')) {
            b.addEventListener('click', () => { this._myFace = b.dataset.myface; this.refresh(); });
        }
        for (const b of this._qa('[data-read]')) {
            b.addEventListener('click', () => {
                const id = b.dataset.read;
                if (this._open === id) { this._open = ''; this.refresh(); return; }
                const r = app.openNovel(id);
                if (!r.ok) { this._flash = r.error || '打不开'; this.refresh(); return; }
                this._open = id;
                this._replyTo = '';
                this.refresh();
            });
        }
        const rc = this._q('#pxv-reader-close');
        if (rc) rc.addEventListener('click', () => { this._open = ''; this._replyTo = ''; this.refresh(); });
        for (const b of this._qa('[data-chap]')) {
            b.addEventListener('click', () => { app.setCurrentChapter(b.dataset.chap); this._replyTo = ''; this.refresh(); });
        }
        for (const b of this._qa('[data-chlike]')) {
            b.addEventListener('click', () => {
                const r = app.toggleChapterLike(this._open, b.dataset.chlike);
                flash(r, r.ok ? ('这一話现在 \u2661 ' + r.hearts) : '');
                this.refresh();
            });
        }
        for (const b of this._qa('[data-fav]')) {
            b.addEventListener('click', () => { flash(app.toggleFavorite(b.dataset.fav), '收进收藏了'); this.refresh(); });
        }
        for (const b of this._qa('[data-following]')) {
            b.addEventListener('click', () => { flash(app.toggleFollowing(b.dataset.following), '追更了'); this.refresh(); });
        }
        for (const b of this._qa('[data-followauthor]')) {
            b.addEventListener('click', () => { flash(app.toggleFollowAuthor(b.dataset.followauthor)); this.refresh(); });
        }
        for (const b of this._qa('[data-tag]')) {
            b.addEventListener('click', () => {
                const t = b.dataset.tag;
                const r = app.subscribeTag(t);
                this._flash = r.ok
                    ? ('订阅了 ' + t + (r.dropped ? ('（超上限，丢了最早的 ' + r.dropped + ' 个）') : ''))
                    : (t + ' 已经在订阅里了');
                this.refresh();
            });
        }
        for (const b of this._qa('[data-untag]')) {
            b.addEventListener('click', () => { app.unsubscribeTag(b.dataset.untag); this.refresh(); });
        }
        for (const b of this._qa('[data-author]')) {
            b.addEventListener('click', () => {
                this._tabAuthor = b.dataset.author;
                const a = app.authorById(b.dataset.author);
                this._flash = a ? ('「' + a.name + '」常写的方向：' + (a.contentTags || []).join('・')) : '找不到这位';
                this.refresh();
            });
        }
        for (const b of this._qa('[data-reply]')) {
            b.addEventListener('click', () => {
                this._replyTo = (this._replyTo === b.dataset.reply) ? '' : b.dataset.reply;
                this.refresh();
            });
        }
        const rcx = this._q('#pxv-reply-cancel');
        if (rcx) rcx.addEventListener('click', () => { this._replyTo = ''; this.refresh(); });
        const cmt = this._q('#pxv-cmt-text');
        if (cmt) cmt.addEventListener('input', (e) => { this._draft.commentText = e.target.value; });
        const send = this._q('#pxv-cmt-send');
        if (send) send.addEventListener('click', () => {
            const ch = app.currentChapter();
            if (!ch) return;
            const ta = this._q('#pxv-cmt-text');
            const r = app.addComment(this._open, ch.num, ta ? ta.value : this._draft.commentText, this._replyTo);
            this._flash = r.ok
                ? ('发出来了' + (r.rehomed ? '（那条已经到最深一层了，改挂到最上面一层）' : '')
                    + (r.expired ? ('（满 ' + PIXIV_LIMITS.maxCommentsPerChapter + ' 条，丢了最早的 ' + r.expired + ' 条）') : ''))
                : (r.error || '没成');
            if (r.ok) { this._draft.commentText = ''; this._replyTo = ''; }
            this.refresh();
        });
        const cp = this._q('#pxv-cmt-prompt');
        if (cp) cp.addEventListener('click', () => {
            const ch = app.currentChapter();
            const n = app.currentNovel();
            if (!ch || !n) return;
            const r = app.copyPrompt('comment', {
                novelTitle: n.title, novelAuthor: n.authorName, chapterNum: ch.num,
                chapterTitle: ch.title, readerText: (this._draft.commentText || '').trim(),
                wantsOpReply: false, language: (app.settings || {}).language,
            });
            this._promptFor = '让宿主给这一話写几条评论';
            this._promptText = r.ok ? r.text : (r.error || '');
            this.refresh();
        });
        const cht = this._q('#pxv-cmt-host');
        if (cht) cht.addEventListener('input', (e) => { this._draft.hostComments = e.target.value; });
        const cg = this._q('#pxv-cmt-ingest');
        if (cg) cg.addEventListener('click', () => {
            const ch = app.currentChapter();
            if (!ch) return;
            const ta = this._q('#pxv-cmt-host');
            const r = app.ingestCommentsText(this._open, ch.num, ta ? ta.value : this._draft.hostComments);
            this._flash = r.ok
                ? ('收下 ' + r.added + ' 条' + (r.skipped ? ('（另有 ' + r.skipped + ' 块没有正文，丢了）') : '')
                    + (r.expired ? ('（满 ' + PIXIV_LIMITS.maxCommentsPerChapter + ' 条，丢了最早的 ' + r.expired + ' 条）') : ''))
                : (r.error || '没成');
            if (r.ok) this._draft.hostComments = '';
            this.refresh();
        });
        const contP = this._q('#pxv-cont-prompt');
        if (contP) contP.addEventListener('click', () => {
            const n = app.novelById(contP.dataset.novel);
            if (!n) return;
            const next = app.nextNumOf(n.id);
            const r = app.copyPrompt('chapter', {
                novel: n, chapterNum: next, styleId: (app.settings || {}).styleId || '',
                lengthLabel: this._draft.lengthLabel, userDirection: this._draft.direction,
                language: (app.settings || {}).language,
            });
            this._promptFor = '第 ' + next + ' 話的要求';
            this._promptText = r.ok ? r.text : (r.error || '');
            this.refresh();
        });
        const rr = this._q('#pxv-reroll');
        if (rr) rr.addEventListener('click', () => {
            const n = app.novelById(rr.dataset.novel);
            if (!n) return;
            const r = app.copyPrompt('chapter', {
                novel: n, chapterNum: Number(rr.dataset.chap), isEnding: false,
                styleId: (app.settings || {}).styleId || '',
                userDirection: this._draft.direction, language: (app.settings || {}).language,
            });
            this._promptFor = '重写第 ' + rr.dataset.chap + ' 話的要求';
            this._promptText = r.ok ? r.text : (r.error || '');
            this.refresh();
        });
        const ct = this._q('#pxv-chapter');
        if (ct) ct.addEventListener('input', (e) => { this._draft.chapterText = e.target.value; });
        const ci = this._q('#pxv-chapter-ingest');
        if (ci) ci.addEventListener('click', () => {
            const ta = this._q('#pxv-chapter');
            const r = app.ingestChapter(ci.dataset.novel, ta ? ta.value : this._draft.chapterText);
            flash(r, r.ok ? ('第 ' + r.num + ' 話收下了' + (r.expired ? ('（超 ' + PIXIV_LIMITS.maxChaptersPerNovel + ' 章，裁掉最早的 ' + r.expired + ' 章）') : '')) : '');
            if (r.ok) this._draft.chapterText = '';
            this.refresh();
        });
        const ri = this._q('#pxv-reroll-ingest');
        if (ri) ri.addEventListener('click', () => {
            const ta = this._q('#pxv-chapter');
            const r = app.ingestChapter(ri.dataset.novel, ta ? ta.value : this._draft.chapterText,
                { mode: 'reroll', chapterNum: Number(ri.dataset.chap) });
            flash(r, r.ok ? ('第 ' + r.num + ' 話换新的了（这一話的评论清零）') : '');
            if (r.ok) this._draft.chapterText = '';
            this.refresh();
        });
        const comp = this._q('#pxv-complete');
        if (comp) comp.addEventListener('click', () => {
            const n = app.novelById(comp.dataset.novel);
            if (!n) return;
            flash(app.setCompleted(n.id, !n.completed), n.completed ? '重启连载了' : '标完结了');
            this.refresh();
        });
        /* 插画登记 */
        for (const b of this._qa('[data-illfav]')) {
            b.addEventListener('click', () => { flash(app.toggleIllustFavorite(b.dataset.illfav)); this.refresh(); });
        }
        for (const b of this._qa('[data-illdel]')) {
            b.addEventListener('click', () => { app.removeIllust(b.dataset.illdel); this.refresh(); });
        }
        for (const b of this._qa('[data-illprompt]')) {
            b.addEventListener('click', () => {
                const it = app.illustById(b.dataset.illprompt);
                if (!it) return;
                const r = app.copyPrompt('illust', {
                    prompt: it.prompt, negativePrompt: it.negativePrompt, size: it.size, count: it.count,
                });
                this._promptFor = '出图要求 · ' + it.prompt.slice(0, 12);
                this._promptText = r.ok ? r.text : (r.error || '');
                this.refresh();
            });
        }
        const ig = (id, setter) => {
            const el = this._q(id);
            if (el) el.addEventListener('input', (e) => { setter(e.target.value); });
        };
        ig('#pxv-ill-prompt', (v) => { this._draft.prompt = v; });
        ig('#pxv-ill-neg', (v) => { this._draft.negativePrompt = v; });
        ig('#pxv-ill-size', (v) => { this._draft.size = v; });
        ig('#pxv-ill-count', (v) => { this._draft.count = v; });
        const ia = this._q('#pxv-ill-add');
        if (ia) ia.addEventListener('click', () => {
            const g = (id) => { const e = this._q(id); return e ? e.value : ''; };
            const r = app.ingestIllust({
                prompt: g('#pxv-ill-prompt'), negativePrompt: g('#pxv-ill-neg'),
                size: g('#pxv-ill-size'), count: g('#pxv-ill-count'),
            });
            flash(r, r.ok ? '登记上了' : '');
            if (r.ok) { this._draft.prompt = ''; this._draft.negativePrompt = ''; }
            this.refresh();
        });
        const im = this._q('#pxv-ill-mkprompt');
        if (im) im.addEventListener('click', () => {
            const g = (id) => { const e = this._q(id); return e ? e.value : ''; };
            const r = app.copyPrompt('illust', {
                prompt: g('#pxv-ill-prompt'), negativePrompt: g('#pxv-ill-neg'),
                size: g('#pxv-ill-size'), count: g('#pxv-ill-count'),
            });
            this._promptFor = '出图要求';
            this._promptText = r.ok ? r.text : (r.error || '');
            this.refresh();
        });
        /* 投稿 / 文风 / 作者 */
        ig('#pxv-nv-title', (v) => { this._draft.title = v; });
        ig('#pxv-nv-sum', (v) => { this._draft.synopsis = v; });
        ig('#pxv-nv-tags', (v) => { this._draft.tagLine = v; });
        const nvStyle = this._q('#pxv-nv-style');
        if (nvStyle) nvStyle.addEventListener('change', (e) => { this._draft.styleId = e.target.value; });
        const nvSerial = this._q('#pxv-nv-serial');
        if (nvSerial) nvSerial.addEventListener('change', (e) => { this._draft.isSerial = e.target.checked; });
        const nvAdd = this._q('#pxv-nv-add');
        if (nvAdd) nvAdd.addEventListener('click', () => {
            const g = (id) => { const e = this._q(id); return e ? e.value : ''; };
            const r = app.createNovel({
                title: g('#pxv-nv-title'), synopsis: g('#pxv-nv-sum'), tagLine: g('#pxv-nv-tags'),
                styleId: this._draft.styleId, isSerial: this._draft.isSerial,
            });
            flash(r, r.ok ? ('建好了' + (r.expired ? ('（超 ' + PIXIV_LIMITS.maxNovels + ' 篇，裁掉最早的 ' + r.expired + ' 篇）') : '')) : '');
            if (r.ok) {
                this._draft.title = ''; this._draft.synopsis = ''; this._draft.tagLine = '';
                const rr2 = app.openNovel(r.id);
                if (rr2.ok) this._open = r.id;
            }
            this.refresh();
        });
        ig('#pxv-st-name', (v) => { this._draft.styleName = v; });
        ig('#pxv-st-rules', (v) => { this._draft.styleRules = v; });
        const stAdd = this._q('#pxv-st-add');
        if (stAdd) stAdd.addEventListener('click', () => {
            const g = (id) => { const e = this._q(id); return e ? e.value : ''; };
            const r = app.addStyle(g('#pxv-st-name'), g('#pxv-st-rules'));
            flash(r, r.ok ? '加好了' : '');
            if (r.ok) { this._draft.styleName = ''; this._draft.styleRules = ''; }
            this.refresh();
        });
        for (const b of this._qa('[data-styletog]')) {
            b.addEventListener('click', () => {
                const r = app.toggleStyle(b.dataset.styletog);
                this._flash = r.ok
                    ? ((r.enabled ? '开着了' : '关掉了') + '（现在 ' + r.enabledCount + ' 款开着）')
                    : (r.error || '没成');
                this.refresh();
            });
        }
        for (const b of this._qa('[data-styledel]')) {
            b.addEventListener('click', () => { flash(app.removeStyle(b.dataset.styledel), '删了'); this.refresh(); });
        }
        ig('#pxv-au-name', (v) => { this._draft.authorName = v; });
        ig('#pxv-au-bio', (v) => { this._draft.authorBio = v; });
        ig('#pxv-au-tags', (v) => { this._draft.authorTags = v; });
        const auType = this._q('#pxv-au-type');
        if (auType) auType.addEventListener('change', (e) => { this._draft.authorType = e.target.value; });
        const auAdd = this._q('#pxv-au-add');
        if (auAdd) auAdd.addEventListener('click', () => {
            const g = (id) => { const e = this._q(id); return e ? e.value : ''; };
            const r = app.addAuthor({
                name: g('#pxv-au-name'), bio: g('#pxv-au-bio'), type: this._draft.authorType,
                contentTags: String(g('#pxv-au-tags')).split(/\s+/).filter(Boolean),
            });
            flash(r, r.ok ? ('「' + r.name + '」进池了' + (r.active ? '' : '（这类不参与推荐）')) : '');
            if (r.ok) { this._draft.authorName = ''; this._draft.authorBio = ''; this._draft.authorTags = ''; }
            this.refresh();
        });
        /* 设置 */
        const setLang = this._q('#pxv-set-lang');
        if (setLang) setLang.addEventListener('change', (e) => { app.patchSettings({ language: e.target.value }); this.refresh(); });
        const setStyle = this._q('#pxv-set-style');
        if (setStyle) setStyle.addEventListener('change', (e) => { app.patchSettings({ styleId: e.target.value }); this.refresh(); });
        const setShow = this._q('#pxv-set-show');
        if (setShow) setShow.addEventListener('change', (e) => { app.patchSettings({ showInvalidNovels: e.target.checked }); this.refresh(); });
        const setFont = this._q('#pxv-set-font');
        if (setFont) setFont.addEventListener('change', (e) => { app.patchSettings({ fontSize: e.target.value }); this.refresh(); });
        /* 检索 */
        const sea = this._q('#pxv-search');
        if (sea) sea.addEventListener('input', (e) => { this._draft.search = e.target.value; this.refresh(); });
        const pc = this._q('#pxv-prompt-close');
        if (pc) pc.addEventListener('click', () => { this._promptText = ''; this._promptFor = ''; this.refresh(); });
    }
    /** 千分位（万位以上折成「万」）。 */
    _n(v) {
        const n = Number(v) || 0;
        if (n >= 10000) return (Math.round(n / 100) / 100) + ' 万';
        return String(n);
    }
    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split('<').join(AMP + 'lt;')
            .split('>').join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;');
    }
}