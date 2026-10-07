/* ========================================================
 * lofter-view.js — [v3.34.0] 老福特（LOFTER）App 视图（上半）
 * 四面（首页 / 关注 / 我的 / 搜索） + 文章详情（评论楼中楼） + 三个「摆给用户复制的」生成格
 *   + 文风库 + 作者池 + 设置
 *
 * 与 date-view / taobao-view 同纪律：归因文案表的键取 LOFTER_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 四处「不糊弄」：
 *   · 三态读数分得开：「存储不可用」「还没有稿子」「有稿子」——**不把读不到说成空**；
 *   · 评论数「0 条」与「未读」**不同形**（`commentCountFace` 给三态）；
 *   · 生成格子摆的是**可复制的要求文本**，本视图**不替宿主发请求、不替宿主写楼层**；
 *   · 一张图都不存：只显示「有图 · N 张」两个数字，**不显示任何地址**。
 * ======================================================== */
'use strict';
import {
    LOFTER_REASONS, LOFTER_ACTIVE_TYPES, LOFTER_IDLE_TYPES, LOFTER_TYPE_LABELS,
    LOFTER_ARTICLE_TYPES,
    LOFTER_CHAPTER_LENGTHS, LOFTER_FULL_TEXT_WINDOW, formatCount, commentCountFace,
} from './lofter-data.js';
/** HTML 转义要 replace 掉的「双引号」——用**字符数组 + split/join**，不写成正则字面量。
 *  ★ 本仓判据共用的剥注释器（`stripComments`）是字符状态机、**不解析正则字面量**：
 *    正则字面量里一旦出现半个引号，剥器就把它当成字符串的起头，从那一行往后块注释再也剥不掉。
 *    v3.31.0 在 date-view 上当场踩到，本件一律照 date 的写法抄。 */
const DQUOTE = '"';
/** 「多久以前」的人话（只看毫秒与 Date，不 import App —— 免得 App <-> View 成环）。 */
function agoText(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return '';
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
    return p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
}
const FACE_META = {
    [LOFTER_REASONS.ok]: { icon: '\u{1f58b}', label: '老福特开着', tone: 'ok' },
    [LOFTER_REASONS.empty]: { icon: '\u{1f4dd}', label: '还没有稿子，也没有合集', tone: 'warn' },
    [LOFTER_REASONS.key_absent]: { icon: '\u2753', label: '这个会话还没有老福特的账', tone: 'warn' },
    [LOFTER_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};
const TABS = [
    { key: 'home', label: '首页' },
    { key: 'follow', label: '关注' },
    { key: 'me', label: '我的' },
    { key: 'search', label: '搜索' },
];
/* 作者类型的人话表**不在这里手写**：单一真源是数据层的 `LOFTER_TYPE_LABELS`
 * （键按 `LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES)` 现取）。改类型清单时它跟着走。 */
const MY_FACES = [
    { key: 'liked', label: '点过心的' },
    { key: 'favorited', label: '收进收藏的' },
    { key: 'readLater', label: '待读' },
    { key: 'footprint', label: '翻过的' },
];
/** 类型下拉用（含非活跃两类 —— 源静默过滤，本仓摆明）。 */
const AUTHOR_TYPES = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);
export class LofterView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._myFace = 'liked';
        this._article = '';
        this._collection = '';
        this._type = 'random';
        this._replyTo = '';
        this._promptFor = '';
        this._promptText = '';
        this._flash = '';
        this._draft = {
            batch: '', direction: '', authorName: '', authorHandle: '', authorBio: '',
            authorTags: '', authorType: 'fan_writer', colName: '', colDesc: '',
            chapterText: '', commentText: '', styleName: '', styleRules: '', search: '', tag: '',
        };
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'lof-root';
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
        /* [v3.66.0 · X2] 跨 App 定位态同步（与 pixiv 同款，理由同）：
         *   app 侧被全局搜索投了「要看哪一篇」时，视图自有的 `_article` 必须跟着走 ——
         *   否则它还是空，详情区画不出来（不报错、只是没反应）。 */
        const refArt = app.refArticleId();
        if (refArt && refArt !== this._article) this._article = refArt;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const tabs = TABS;
        const cur = app.tab();
        const parts = [];
        parts.push('<div class="lof-header"><h2>\u{1f58b} 老福特</h2>'
            + '<span class="lof-header-sub">中文同人圈</span></div>');
        parts.push('<div class="lof-face lof-face-' + meta.tone + '">');
        parts.push('<span class="lof-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="lof-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('<span class="lof-face-sub">' + this._esc(app.summaryLine()) + '</span>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="lof-flash">' + this._esc(this._flash) + '</div>');
        parts.push('<div class="lof-tabs">');
        for (const t of tabs) {
            parts.push('<button class="lof-tab' + (cur === t.key ? ' is-on' : '') + '" data-tab="' + t.key + '">');
            parts.push('<span class="lof-tab-label">' + this._esc(t.label) + '</span>');
            parts.push('<span class="lof-tab-sub">' + this._esc(app.faceOf(t.key)) + '</span>');
            parts.push('</button>');
        }
        parts.push('</div>');
        if (cur === 'follow') parts.push(this._followPanel());
        else if (cur === 'me') parts.push(this._mePanel());
        else if (cur === 'search') parts.push(this._searchPanel());
        else parts.push(this._homePanel());
        parts.push(this._writerPanel());
        parts.push(this._stylePanel());
        parts.push(this._settingsPanel());
        return parts.join('\n');
    }
    /* ---------- 首页 ---------- */
    _homePanel() {
        const app = this.app;
        const arts = app.articlesAll();
        const hot = app.hotTags();
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">首页（' + arts.length + ' / ' + app.limits().maxArticles + '）</h3>');
        if (hot.length) {
            parts.push('<div class="lof-tags">');
            for (const h of hot) {
                parts.push('<button class="lof-tag" data-tag="' + this._esc(h.tag) + '">#' + this._esc(h.tag)
                    + '<span class="lof-tag-n">' + h.count + '</span></button>');
            }
            parts.push('</div>');
        }
        if (!arts.length) {
            parts.push('<div class="lof-empty">还没有稿子。先去下面的「收下别处产出的短文」格子，'
                + '把模型给你写的整段贴回来 —— 本 App 自己不会去调模型。</div>');
        } else {
            const months = app.byMonth();
            for (const g of months) {
                parts.push('<div class="lof-month">' + this._esc(g.month) + '</div>');
                for (const a of g.list) parts.push(this._articleCard(a));
            }
        }
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 关注 ---------- */
    _followPanel() {
        const app = this.app;
        const feed = app.followFeed();
        const ids = app.stored().followedAuthorIds;
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">关注（' + ids.length + ' 位作者 · ' + feed.length + ' 篇）</h3>');
        if (!ids.length) {
            parts.push('<div class="lof-empty">还没关注谁。去作者池里点「关注」。</div>');
        } else if (!feed.length) {
            parts.push('<div class="lof-empty">关注的这几位这轮还没写东西。</div>');
        } else {
            for (const a of feed) parts.push(this._articleCard(a));
        }
        parts.push(this._authorPool());
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 我的 ---------- */
    _mePanel() {
        const app = this.app;
        const st = app.stored();
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">我的</h3>');
        parts.push('<div class="lof-subtabs">');
        for (const f of MY_FACES) {
            const n = app.myArticles(f.key).length;
            parts.push('<button class="lof-subtab' + (this._myFace === f.key ? ' is-on' : '')
                + '" data-myface="' + f.key + '">' + this._esc(f.label)
                + '<span class="lof-subtab-n">' + n + '</span></button>');
        }
        parts.push('</div>');
        const list = app.myArticles(this._myFace);
        if (!list.length) parts.push('<div class="lof-empty">这一格还是空的。</div>');
        else for (const a of list) parts.push(this._articleCard(a));
        parts.push('<h3 class="lof-title">订阅的 tag（' + st.subscribedTags.length + ' / '
            + app.limits().maxSubscribedTags + '）</h3>');
        if (!st.subscribedTags.length) parts.push('<div class="lof-empty">还没订阅 tag。</div>');
        else {
            parts.push('<div class="lof-tags">');
            for (const t of st.subscribedTags) {
                parts.push('<span class="lof-tag lof-tag-out">#' + this._esc(t)
                    + '<button class="lof-mini" data-untag="' + this._esc(t) + '">\u00d7</button></span>');
            }
            parts.push('</div>');
        }
        parts.push('<h3 class="lof-title">订阅的合集（' + st.subscribedCollectionIds.length + ' 个）</h3>');
        const cols = st.subscribedCollectionIds.map((id) => app.collectionById(id)).filter(Boolean);
        if (!cols.length) parts.push('<div class="lof-empty">还没订阅合集。</div>');
        else {
            for (const c of cols) {
                parts.push('<div class="lof-col-row"><span class="lof-col-name">' + this._esc(c.name) + '</span>'
                    + '<span class="lof-col-by">' + this._esc(c.authorName) + '</span>'
                    + '<span class="lof-col-n">' + c.chapterCount + ' 章</span></div>');
            }
        }
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 搜索 ---------- */
    _searchPanel() {
        const app = this.app;
        const q = this._draft.search;
        const hits = q ? app.search(q) : [];
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">搜索</h3>');
        parts.push('<input class="lof-input" id="lof-search" value="' + this._esc(q)
            + '" placeholder="标题 / 正文 / tag 里找（比如：刀）">');
        parts.push('<div class="lof-hint">搜索是**本地**的：只在这台手机已经存下的稿子里找，不会去网上找。'
            + '结果是「点进过一篇」才会记一笔足迹。</div>');
        if (q && !hits.length) parts.push('<div class="lof-empty">没找到。</div>');
        for (const h of hits) {
            parts.push(this._articleCard(h.article, h));
        }
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 文章卡（四面共用） ---------- */
    _articleCard(a, hit) {
        const app = this.app;
        const fl = app.flagsOf(a.id);
        const st = app.statsOf(a.id) || { hearts: '0', favorites: '0', comments: '0', images: 0 };
        // 评论数是**三态**：0 条 / 有 N 条 / 未读。别把它压成一个数（0 与「没读过」不同义）。
        const cf = commentCountFace(app.commentsOf(a.id));
        const cfText = (cf.count === null) ? '评论未读' : (cf.count === 0 ? '还没有评论' : ('评论 ' + cf.count));
        const open = this._article === a.id;
        const parts = [];
        parts.push('<div class="lof-card' + (open ? ' is-open' : '') + '">');
        parts.push('<button class="lof-card-head" data-open="' + this._esc(a.id) + '">');
        parts.push('<span class="lof-card-avatar" data-hue="' + a.coverHue + '">' + this._esc(a.authorName.slice(0, 1)) + '</span>');
        parts.push('<span class="lof-card-main">');
        parts.push('<span class="lof-card-title">' + this._esc(a.title || '(无题)') + '</span>');
        parts.push('<span class="lof-card-by">' + this._esc(a.authorName)
            + (a.collectionId ? ' · 合集第 ' + (a.chapterNum === null ? '?' : a.chapterNum) + ' 章' : '')
            + ' · ' + this._esc(a.editedAgoDisplay || agoText(a.createdAt)) + '</span>');
        parts.push('</span>');
        parts.push('<span class="lof-card-kind">' + this._esc(this._kindLabel(a.type)) + '</span>');
        parts.push('</button>');
        if (a.summary) parts.push('<div class="lof-card-sum">' + this._esc(a.summary) + '</div>');
        if (hit && hit.snippet) parts.push('<div class="lof-card-snip">' + this._esc(hit.snippet) + '</div>');
        parts.push('<div class="lof-card-meta">');
        parts.push('<span class="lof-n lof-n-heart">\u2665 ' + this._esc(st.hearts) + '</span>');
        parts.push('<span class="lof-n">\u2606 ' + this._esc(st.favorites) + '</span>');
        parts.push('<span class="lof-n">\u{1f4ac} ' + this._esc(cfText) + '</span>');
        if (a.hasImages) parts.push('<span class="lof-n lof-n-img">\u{1f5bc} ' + a.imageCount + ' 张</span>');
        if (a.tags.length) {
            parts.push('<span class="lof-card-tags">');
            for (const t of a.tags) parts.push('<button class="lof-tag lof-tag-sm" data-tag="' + this._esc(t) + '">#' + this._esc(t) + '</button>');
            parts.push('</span>');
        }
        parts.push('<span class="lof-card-acts">');
        parts.push('<button class="lof-mini' + (fl.liked ? ' is-on' : '') + '" data-like="' + this._esc(a.id) + '">\u2665</button>');
        parts.push('<button class="lof-mini' + (fl.favorited ? ' is-on' : '') + '" data-fav="' + this._esc(a.id) + '">\u2606</button>');
        parts.push('<button class="lof-mini' + (fl.readLater ? ' is-on' : '') + '" data-later="' + this._esc(a.id) + '">\u{1f516}</button>');
        parts.push('</span>');
        parts.push('</div>');
        if (open) parts.push(this._detail(a));
        parts.push('</div>');
        return parts.join('\n');
    }
    _kindLabel(type) {
        const k = String(type || '');
        if (k === 'meta') return '分析 / note';
        if (k === 'long') return '长篇';
        return '短打';
    }
    /* ---------- 作者池（关注面下半） ---------- */
    _authorPool() {
        const app = this.app;
        const all = app.authorsAll();
        const active = app.authorsActive();
        const followed = app.stored().followedAuthorIds;
        const read = app.readings();
        const parts = [];
        parts.push('<h3 class="lof-title">作者池（活跃 ' + active.length + ' · 池里共 ' + all.length + '）</h3>');
        if (read.inactiveAuthors) {
            parts.push('<div class="lof-warn">池里有 ' + read.inactiveAuthors
                + ' 位是源里会被**静默过滤**的类型（原创向 / 长评人）—— 本仓把它们摆明：'
                + '留着、标出来、不参与推送，而不是悄悄消失。</div>');
        }
        for (const a of all) {
            const isOn = followed.indexOf(String(a.id)) >= 0;
            const isActive = active.indexOf(a) >= 0;
            const n = app.articlesOfAuthor(a.id).length;
            parts.push('<div class="lof-author' + (isActive ? '' : ' is-idle') + '">');
            parts.push('<span class="lof-author-name">' + this._esc(a.name) + '</span>');
            parts.push('<span class="lof-author-type">' + this._esc(LOFTER_TYPE_LABELS[a.type] || String(a.type)) + '</span>');
            if (!isActive) parts.push('<span class="lof-author-idle">不推送</span>');
            parts.push('<span class="lof-author-bio">' + this._esc(a.bio || '') + '</span>');
            parts.push('<span class="lof-author-n">' + this._esc(formatCount(a.followerCount)) + ' 关注 · ' + n + ' 篇</span>');
            parts.push('<button class="lof-mini' + (isOn ? ' is-on' : '') + '" data-follow="' + this._esc(a.id) + '">'
                + (isOn ? '已关注' : '关注') + '</button>');
            parts.push('</div>');
        }
        return parts.join('\n');
    }
    /* ---------- 文章详情（展开面板） ---------- */
    _detail(a) {
        const app = this.app;
        const parts = [];
        parts.push('<div class="lof-detail">');
        parts.push('<div class="lof-body">' + this._esc(a.content || '(正文空着)') + '</div>');
        if (a.hasImages) {
            parts.push('<div class="lof-imgs">这篇带图 · ' + a.imageCount + ' 张'
                + '<span class="lof-imgs-note">（本 App 不存图、不收地址：要配图请自己在对话框里出图）</span></div>');
        }
        // 评论：楼中楼
        parts.push('<div class="lof-cmts">');
        const rows = app.commentRows(a.id);
        if (!rows.length) parts.push('<div class="lof-empty">还没有人说话。</div>');
        for (const n of rows) {
            parts.push('<div class="lof-cmt" data-depth="' + n.depth + '">');
            parts.push('<span class="lof-cmt-indent">' + '\u00a0'.repeat(Math.max(0, n.depth - 1) * 2) + '</span>');
            parts.push('<span class="lof-cmt-by"' + (n.isOpReply ? ' data-op="1"' : '') + '>'
                + this._esc(n.author) + (n.isOpReply ? ' · 作者' : '') + '</span>');
            parts.push('<span class="lof-cmt-tx">' + this._esc(n.content) + '</span>');
            parts.push('<button class="lof-mini" data-reply="' + this._esc(n.id) + '">回复</button>');
            parts.push('</div>');
        }
        parts.push('</div>');
        if (this._replyTo) {
            parts.push('<div class="lof-hint">正在回复：' + this._esc(this._replyTo)
                + '<button class="lof-mini" id="lof-reply-cancel">取消</button></div>');
        }
        parts.push('<textarea class="lof-input lof-ta" id="lof-cmt-text" rows="2" placeholder="说点什么'
            + (this._replyTo ? '（回给上面那条）' : '') + '"></textarea>');
        parts.push('<div class="lof-acts">');
        parts.push('<button class="lof-btn lof-btn-primary" id="lof-cmt-send" data-id="' + this._esc(a.id) + '">发出去</button>');
        parts.push('<button class="lof-btn" id="lof-cmt-prompt" data-id="' + this._esc(a.id) + '">要点「Ta 会怎么回」的提示词</button>');
        parts.push('</div>');
        if (this._promptFor === 'comment:' + a.id && this._promptText) {
            parts.push('<div class="lof-prompt">');
            parts.push('<div class="lof-hint">把下面这段复制到对话框里，让模型写一条回来，再把它贴进上面的评论框：</div>');
            parts.push('<pre class="lof-pre" id="lof-prompt-body">' + this._esc(this._promptText) + '</pre>');
            parts.push('</div>');
        }
        if (a.collectionId) {
            const col = app.collectionById(a.collectionId);
            if (col) {
                parts.push('<div class="lof-col-link">属于合集《' + this._esc(col.name) + '》（'
                    + col.chapterCount + ' 章·' + this._esc(col.authorName) + '）');
                const on = app.stored().subscribedCollectionIds.indexOf(String(col.id)) >= 0;
                parts.push('<button class="lof-mini' + (on ? ' is-on' : '') + '" data-subcol="' + this._esc(col.id) + '">'
                    + (on ? '已订阅' : '订阅') + '</button></div>');
            }
        }
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 生成格（三个：短文批量 / 合集续章 / 评论回复） ---------- */
    _writerPanel() {
        const app = this.app;
        const types = app.articleTypes();
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">收下别处产出的短文</h3>');
        parts.push('<div class="lof-hint">本 App **不调模型**。要稿子的走法：① 点下面「要一段提示词」→ '
            + '② 复制到对话框，让模型按格式写 → ③ 把整段贴回下面的格子 → ④ 点「收下」。</div>');
        parts.push('<div class="lof-row">');
        parts.push('<select class="lof-input lof-sel" id="lof-type">');
        for (const t of types) {
            parts.push('<option value="' + this._esc(t.id) + '"' + (this._type === t.id ? ' selected' : '') + '>'
                + this._esc(t.label) + '</option>');
        }
        parts.push('</select>');
        parts.push('<input class="lof-input" id="lof-count" value="' + app.settings.autoGenCount
            + '" placeholder="几条（1-5）">');
        parts.push('</div>');
        parts.push('<input class="lof-input" id="lof-direction" value="' + this._esc(this._draft.direction)
            + '" placeholder="想写点什么（可空：比如「下雨天的重逢」）">');
        parts.push('<div class="lof-acts">'
            + '<button class="lof-btn lof-btn-primary" id="lof-mk-prompt">要一段提示词</button></div>');
        if (this._promptFor === 'short' && this._promptText) {
            parts.push('<pre class="lof-pre" id="lof-prompt-body">' + this._esc(this._promptText) + '</pre>');
        }
        parts.push('<textarea class="lof-input lof-ta" id="lof-batch" rows="6" placeholder="把模型给的那一整段贴在这里'
            + '（每块以 ---LOF--- 分隔，块里要有 TAG: [N1] 与 CONTENT:）"></textarea>');
        parts.push('<div class="lof-acts">'
            + '<button class="lof-btn lof-btn-primary" id="lof-ingest">收下</button>'
            + '<span class="lof-hint">坏块会如实报数，不会静默丢。</span></div>');
        parts.push('</div>');

        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">开一个长篇合集</h3>');
        parts.push('<div class="lof-row">');
        parts.push('<input class="lof-input" id="lof-col-name" value="' + this._esc(this._draft.colName) + '" placeholder="合集名">');
        parts.push('<select class="lof-input lof-sel" id="lof-col-status">'
            + '<option value="ongoing">连载中</option><option value="finished">已完结</option></select>');
        parts.push('</div>');
        parts.push('<input class="lof-input" id="lof-col-desc" value="' + this._esc(this._draft.colDesc) + '" placeholder="一句话简介（可空）">');
        parts.push('<div class="lof-acts"><button class="lof-btn lof-btn-primary" id="lof-col-make">开合集</button></div>');
        const cols = app.collectionsAll();
        if (cols.length) {
            parts.push('<h3 class="lof-title">已有合集（' + cols.length + ' / ' + app.limits().maxCollections + '）</h3>');
            for (const c of cols) {
                const isCur = this._collection === c.id;
                parts.push('<div class="lof-col' + (isCur ? ' is-cur' : '') + '">');
                parts.push('<span class="lof-col-name">' + this._esc(c.name) + '</span>');
                parts.push('<span class="lof-col-by">' + this._esc(c.authorName) + '</span>');
                parts.push('<span class="lof-col-n">' + c.chapterCount + ' 章</span>');
                parts.push('<span class="lof-col-st">' + (c.status === 'finished' ? '已完结' : '连载中') + '</span>');
                const on = app.stored().subscribedCollectionIds.indexOf(String(c.id)) >= 0;
                parts.push('<button class="lof-mini' + (on ? ' is-on' : '') + '" data-subcol="' + this._esc(c.id) + '">'
                    + (on ? '已订阅' : '订阅') + '</button>');
                parts.push('<button class="lof-mini" data-colpick="' + this._esc(c.id) + '">续写</button>');
                parts.push('</div>');
                if (isCur) {
                    const pv = app.promptChapterText(c.id);
                    if (pv.ok) {
                        parts.push('<textarea class="lof-input lof-ta" id="lof-chapter" rows="5" placeholder="把这一章正文贴在这里（贴好点「收下这一章」）"></textarea>');
                        parts.push('<div class="lof-acts">'
                            + '<button class="lof-btn" id="lof-chapter-prompt" data-cid="' + this._esc(c.id) + '">要这一章的提示词</button>'
                            + '<button class="lof-btn lof-btn-primary" id="lof-chapter-ingest" data-cid="' + this._esc(c.id) + '">收下这一章</button>'
                            + '<span class="lof-hint">这一章会是第 ' + pv.num + ' 章（' + this._esc(pv.position) + '）</span></div>');
                    }
                }
            }
        }
        parts.push('</div>');

        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">加一位作者</h3>');
        parts.push('<div class="lof-row">');
        parts.push('<input class="lof-input" id="lof-au-name" value="' + this._esc(this._draft.authorName) + '" placeholder="作者名">');
        parts.push('<select class="lof-input lof-sel" id="lof-au-type">');
        for (const t of AUTHOR_TYPES) {
            parts.push('<option value="' + this._esc(t) + '"'
                + (this._draft.authorType === t ? ' selected' : '') + '>' + this._esc(LOFTER_TYPE_LABELS[t] || t) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<div class="lof-row">');
        parts.push('<input class="lof-input" id="lof-au-handle" value="' + this._esc(this._draft.authorHandle) + '" placeholder="账号（可空）">');
        parts.push('<input class="lof-input" id="lof-au-tags" value="' + this._esc(this._draft.authorTags) + '" placeholder="常写的三个 tag（空格隔开）">');
        parts.push('</div>');
        parts.push('<input class="lof-input" id="lof-au-bio" value="' + this._esc(this._draft.authorBio) + '" placeholder="一句话签名（可空）">');
        parts.push('<div class="lof-acts"><button class="lof-btn lof-btn-primary" id="lof-au-make">加进池里</button></div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 文风库 ---------- */
    _stylePanel() {
        const app = this.app;
        const list = app.styleList();
        const builtIn = app.builtInStyleIds();
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">文风库（' + list.length + ' 款 · 开着的 '
            + list.filter((s) => s.enabled !== false).length + ' 款）</h3>');
        parts.push('<div class="lof-hint">内置 11 款不能删、只能关（关掉之后随机就抽不到它）。'
            + '自己加的随便删。</div>');
        for (const s of list) {
            const isBuiltIn = builtIn.indexOf(s.id) >= 0;
            const on = s.enabled !== false;
            parts.push('<div class="lof-style' + (on ? '' : ' is-off') + '">');
            parts.push('<span class="lof-style-name">' + this._esc(s.name) + '</span>');
            if (isBuiltIn) parts.push('<span class="lof-style-bi">内置</span>');
            parts.push('<button class="lof-mini' + (on ? ' is-on' : '') + '" data-style-tog="' + this._esc(s.id) + '">'
                + (on ? '开着' : '关着') + '</button>');
            if (!isBuiltIn) parts.push('<button class="lof-mini" data-style-del="' + this._esc(s.id) + '">删</button>');
            parts.push('<div class="lof-style-rules">' + this._esc(s.rules || '(没写规则)') + '</div>');
            parts.push('</div>');
        }
        parts.push('<input class="lof-input" id="lof-st-name" value="' + this._esc(this._draft.styleName) + '" placeholder="新文风的名字">');
        parts.push('<textarea class="lof-input lof-ta" id="lof-st-rules" rows="2" placeholder="这款文风要模型怎么写（会原样进提示词）"></textarea>');
        parts.push('<div class="lof-acts"><button class="lof-btn lof-btn-primary" id="lof-st-make">加一款</button></div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 设置 ---------- */
    _settingsPanel() {
        const app = this.app;
        const s = app.settings;
        const read = app.readings();
        const parts = [];
        parts.push('<div class="lof-panel">');
        parts.push('<h3 class="lof-title">设置</h3>');
        parts.push('<div class="lof-field"><label>每轮默认写几条</label>'
            + '<input type="number" id="lof-set-count" min="1" max="5" value="' + app.settings.autoGenCount + '"></div>');
        parts.push('<div class="lof-field"><label>长篇每章篇幅</label><select class="lof-input lof-sel" id="lof-set-len">');
        for (const k of Object.keys(LOFTER_CHAPTER_LENGTHS)) {
            const L = LOFTER_CHAPTER_LENGTHS[k];
            parts.push('<option value="' + k + '"' + (s.chapterLength === k ? ' selected' : '') + '>'
                + this._esc(L.label) + '</option>');
        }
        parts.push('</select></div>');
        parts.push('<div class="lof-field"><label>列表样式</label><select class="lof-input lof-sel" id="lof-set-view">'
            + '<option value="grid"' + (s.defaultViewMode === 'grid' ? ' selected' : '') + '>卡片</option>'
            + '<option value="list"' + (s.defaultViewMode === 'list' ? ' selected' : '') + '>紧凑</option>'
            + '</select></div>');
        parts.push('<div class="lof-toggle"><label>把正文空着的也显示出来</label>'
            + '<input type="checkbox" id="lof-set-show"' + (s.showInvalidArticles ? ' checked' : '') + '></div>');
        parts.push('<h3 class="lof-title">这一轮读到的东西</h3>');
        parts.push('<div class="lof-note">内容面：' + this._esc(app.contentFace()) + '</div>');
        parts.push('<div class="lof-note">稿子 ' + read.totalArticles + ' 篇' +
            '、合集 ' + read.totalCollections + ' 个、池里 ' + app.authorsAll().length + ' 位作者' +
            (read.dropped ? ('；超过上限被裁掉 ' + read.dropped + ' 条（如实计数，没静默丢）') : '') + '</div>');
        parts.push('<div class="lof-note">前文滑窗：最近 ' + LOFTER_FULL_TEXT_WINDOW + ' 章给全文，更早给摘要。</div>');
        parts.push('</div>');
        return parts.join('\n');
    }
    /* ---------- 事件绑定 ---------- */
    _bindEvents() {
        const app = this.app;
        const self = this;
        const flash = (r, okText) => {
            if (r && r.ok) self._flash = okText || '好了';
            else self._flash = (r && r.error) ? r.error : '没成';
        };
        for (const b of this._qa('.lof-tab')) {
            b.addEventListener('click', () => { app.setTab(b.dataset.tab); this._article = ''; app.clearRef(); this.refresh(); });
        }
        for (const b of this._qa('.lof-subtab')) {
            b.addEventListener('click', () => { this._myFace = b.dataset.myface; this.refresh(); });
        }
        for (const b of this._qa('[data-open]')) {
            b.addEventListener('click', () => {
                const id = b.dataset.open;
                if (this._article === id) { this._article = ''; this.refresh(); return; }
                app.openArticle(id);
                this._article = id;
                this._replyTo = '';
                this.refresh();
            });
        }
        for (const b of this._qa('[data-like]')) {
            b.addEventListener('click', () => { app.toggleLike(b.dataset.like); this.refresh(); });
        }
        for (const b of this._qa('[data-fav]')) {
            b.addEventListener('click', () => { app.toggleFavorite(b.dataset.fav); this.refresh(); });
        }
        for (const b of this._qa('[data-later]')) {
            b.addEventListener('click', () => { app.toggleReadLater(b.dataset.later); this.refresh(); });
        }
        for (const b of this._qa('[data-follow]')) {
            b.addEventListener('click', () => { flash(app.toggleFollowAuthor(b.dataset.follow)); this.refresh(); });
        }
        for (const b of this._qa('[data-subcol]')) {
            b.addEventListener('click', () => { flash(app.toggleSubscribeCollection(b.dataset.subcol)); this.refresh(); });
        }
        for (const b of this._qa('[data-untag]')) {
            b.addEventListener('click', () => { app.unsubscribeTag(b.dataset.untag); this.refresh(); });
        }
        for (const b of this._qa('[data-tag]')) {
            b.addEventListener('click', () => {
                const t = b.dataset.tag;
                const r = app.subscribeTag(t);
                this._flash = r.ok ? ('订阅了 #' + t + (r.dropped ? ('（超上限，丢了最早的 ' + r.dropped + ' 个）') : '')) : ('# ' + t + ' 已经在订阅里了');
                this.refresh();
            });
        }
        for (const b of this._qa('[data-reply]')) {
            b.addEventListener('click', () => {
                this._replyTo = (this._replyTo === b.dataset.reply) ? '' : b.dataset.reply;
                this.refresh();
            });
        }
        const cancel = this._q('#lof-reply-cancel');
        if (cancel) cancel.addEventListener('click', () => { this._replyTo = ''; this.refresh(); });
        const send = this._q('#lof-cmt-send');
        if (send) send.addEventListener('click', () => {
            const ta = this._q('#lof-cmt-text');
            const r = app.addComment(send.dataset.id, ta ? ta.value : '', this._replyTo);
            this._flash = r.ok ? ('发出去了' + (r.rehomed ? '（这条太深了，改挂到最上面一层）' : '')) : (r.error || '没成');
            this._replyTo = '';
            this.refresh();
        });
        const cprompt = this._q('#lof-cmt-prompt');
        if (cprompt) cprompt.addEventListener('click', () => {
            const r = app.promptCommentText(cprompt.dataset.id, '', false);
            this._promptFor = 'comment:' + cprompt.dataset.id;
            this._promptText = r.ok ? r.text : (r.error || '');
            this.refresh();
        });
        const mk = this._q('#lof-mk-prompt');
        if (mk) mk.addEventListener('click', () => {
            const dir = this._q('#lof-direction');
            const cnt = this._q('#lof-count');
            this._draft.direction = dir ? dir.value : '';
            this._promptFor = 'short';
            this._promptText = app.promptShortText(this._type, this._draft.direction, cnt ? cnt.value : null);
            this.refresh();
        });
        const typeSel = this._q('#lof-type');
        if (typeSel) typeSel.addEventListener('change', (e) => { this._type = e.target.value; this.refresh(); });
        const ing = this._q('#lof-ingest');
        if (ing) ing.addEventListener('click', () => {
            const ta = this._q('#lof-batch');
            const r = app.ingestBatch(ta ? ta.value : '');
            if (r.ok) {
                this._flash = '收下 ' + r.added + ' 篇'
                    + (r.expired ? ('（超过 ' + app.limits().maxArticles + ' 篇上限，裁掉最早的 ' + r.expired + ' 篇）') : '');
                this._promptFor = '';
                this._promptText = '';
            } else {
                this._flash = r.error || '没解析出东西';
            }
            this.refresh();
        });
        const colMake = this._q('#lof-col-make');
        if (colMake) colMake.addEventListener('click', () => {
            const nm = this._q('#lof-col-name');
            const ds = this._q('#lof-col-desc');
            const stt = this._q('#lof-col-status');
            this._draft.colName = nm ? nm.value : '';
            this._draft.colDesc = ds ? ds.value : '';
            const r = app.createCollection({ name: this._draft.colName, description: this._draft.colDesc, status: stt ? stt.value : 'ongoing' });
            flash(r, '合集开好了');
            if (r.ok) this._collection = r.id;
            this.refresh();
        });
        for (const b of this._qa('[data-colpick]')) {
            b.addEventListener('click', () => {
                this._collection = (this._collection === b.dataset.colpick) ? '' : b.dataset.colpick;
                this.refresh();
            });
        }
        const chp = this._q('#lof-chapter-prompt');
        if (chp) chp.addEventListener('click', () => {
            const r = app.promptChapterText(chp.dataset.cid);
            this._promptFor = 'chapter:' + chp.dataset.cid;
            this._promptText = r.ok ? r.text : (r.error || '');
            this.refresh();
        });
        const chg = this._q('#lof-chapter-ingest');
        if (chg) chg.addEventListener('click', () => {
            const ta = this._q('#lof-chapter');
            const r = app.ingestChapter(chg.dataset.cid, ta ? ta.value : '');
            flash(r, r.ok ? ('第 ' + r.chapterNum + ' 章收下了') : '');
            this.refresh();
        });
        const auMake = this._q('#lof-au-make');
        if (auMake) auMake.addEventListener('click', () => {
            const g = (id) => { const e = this._q(id); return e ? e.value : ''; };
            this._draft.authorName = g('#lof-au-name');
            this._draft.authorHandle = g('#lof-au-handle');
            this._draft.authorBio = g('#lof-au-bio');
            this._draft.authorTags = g('#lof-au-tags');
            this._draft.authorType = g('#lof-au-type') || 'fan_writer';
            const r = app.addAuthor({
                name: this._draft.authorName, handle: this._draft.authorHandle, bio: this._draft.authorBio,
                type: this._draft.authorType, contentTags: String(this._draft.authorTags || '').split(/\s+/).filter(Boolean),
            });
            flash(r, r.ok ? ('「' + r.name + '」进池了') : '');
            if (r.ok) { this._draft.authorName = ''; this._draft.authorBio = ''; this._draft.authorTags = ''; this._draft.authorHandle = ''; }
            this.refresh();
        });
        for (const b of this._qa('[data-style-tog]')) {
            b.addEventListener('click', () => { const r = app.toggleStyle(b.dataset.styleTog); flash(r, r.ok ? (r.enabled ? '开着了' : '关掉了') : ''); this.refresh(); });
        }
        for (const b of this._qa('[data-style-del]')) {
            b.addEventListener('click', () => { const r = app.removeStyle(b.dataset.styleDel); flash(r, '删了'); this.refresh(); });
        }
        const stMake = this._q('#lof-st-make');
        if (stMake) stMake.addEventListener('click', () => {
            const nm = this._q('#lof-st-name');
            const ru = this._q('#lof-st-rules');
            const r = app.addStyle(nm ? nm.value : '', ru ? ru.value : '');
            flash(r, r.ok ? '加好了' : '');
            this.refresh();
        });
        const setCount = this._q('#lof-set-count');
        if (setCount) setCount.addEventListener('change', (e) => { app.patchSettings({ autoGenCount: e.target.value }); this.refresh(); });
        const setLen = this._q('#lof-set-len');
        if (setLen) setLen.addEventListener('change', (e) => { app.patchSettings({ chapterLength: e.target.value }); this.refresh(); });
        const setView = this._q('#lof-set-view');
        if (setView) setView.addEventListener('change', (e) => { app.patchSettings({ defaultViewMode: e.target.value }); this.refresh(); });
        const setShow = this._q('#lof-set-show');
        if (setShow) setShow.addEventListener('change', (e) => { app.patchSettings({ showInvalidArticles: e.target.checked }); this.refresh(); });
        const sea = this._q('#lof-search');
        if (sea) sea.addEventListener('input', (e) => { this._draft.search = e.target.value; this.refresh(); });
    }
    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            /* ★ 「双引号」用**字符数组 + split/join**，不写成正则字面量：
             *   本仓判据共用的剥注释器（`stripComments`）是字符状态机、**不解析正则字面量** ——
             *   正则里那半个引号会被它当成字符串的起头，从这一行往后块注释全部失守
             *   （v3.31.0 在 date-view 上当场踩到，本件照抄那条改法）。
             *   语义与 `.replace(/"/g, ...)` 完全一致（split/join 是字面替换，不解释 `$&`）。 */
            .split(DQUOTE).join('\x26quot;');
    }
}