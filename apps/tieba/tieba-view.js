/* ========================================================
 * RubyPhone — SillyTavern 虚拟智能手机 UI
 * 作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
/* ============================================================
 * apps/tieba/tieba-view.js — 贴吧视图层（v4.207.0 底栏一级导航）
 * ------------------------------------------------------------
 * 画法按「真机上贴吧长什么样」倒推，不按旧模板的 div 堆叠：
 *   首页：48 顶栏（返回 / 吧名 / 发帖）· 搜索框 · 吧 chip 横滑 · 帖子卡流
 *   详情：顶栏（返回 / 吧名 / 点赞）· 1 楼楼主帖 · 楼层列表 · 底部回复栏
 *   搜索：同一顶栏 + 结果列表（空词不出结果，没命中如实说没搜到）
 * 三条纪律：
 *   ① **不回显未转义的用户文本**：标题 / 正文 / 作者 / 楼层全部过 `_esc()`，
 *      旧版直接拼 innerHTML，AI 生成的一行 `<img onerror=...>` 就是一次注入；
 *   ② **状态只放在 this 上，DOM 只是它的投影**：翻页、返回、点赞之后统一
 *      `_paint()`，不做「局部改一下 class 再看运气」；
 *   ③ **所有交互走 `[data-act]` + 事件委托**：容器上只挂一次监听（`_bound`），
 *      重绘不会把监听器丢掉，也不会越挂越多。
 * 头像不用外链图片：离线 / 宿主禁网时远程图必然 404，画成「首字 + 色调」。
 * ============================================================
 * 【v4.207.0 照现实：一级导航从「顶栏返回键」改为「底栏常驻」】
 *   修前的真实缺口：本 App 只有 首页 / 详情 / 搜索 三个面，面与面之间只有顶栏那颗
 *   返回键可走 —— 现实中贴吧 App 的一级导航在**画面底部**，且「我的」在最右格
 *   （判据见下方 `TB_NAV` 的注释，两条都是贴吧吧内可检索到的原话，不是记忆）。
 *   四格的**能力对位**（「结构照官方、能力照本仓」——本仓没有的能力不画假键）：
 *     首页  现有 home（帖子流 + 吧 chip）
 *     进吧  新增 page='bars'：全部吧列表 + 每吧帖数 → 点进该吧（getBars / getPostsByBar）
 *     消息  **本仓无消息模块** → 标 disabled：opacity .38 + aria-disabled，
 *           点它走页面内 `.tb-toast` 如实说「本机还没做」，不弹宿主 alert、
 *           也不假造一个空消息列表（空列表会被读成「今天没人回我」）
 *     我的  新增 page='me'：我发的帖 / 我赞过的帖（author==='我' / isLiked）
 *   详情页与搜索页**不进底栏**：它们是二级面，底栏留着但不高亮任何一格，
 *   返回键仍然回首页 —— 与现实中「点进帖子后底栏消失或保持」的两种做法里，
 *   本仓选「保持并取消高亮」，因为本仓没有独立的消息流可以跳走，保留底栏
 *   能让人随时切回「进吧」，跳走也不会丢掉帖子上下文。
 * ============================================================ */

/** 文本归一 + 转义：同一处收口，避免有的地方转义了、有的地方忘了。 */
function esc(value, max = 0) {
    let s = String(value == null ? '' : value);
    if (max > 0 && s.length > max) s = s.slice(0, max);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '\u0026quot;')
        .replace(/'/g, '&#39;');
}

/* ============================================================
 * 一级导航四格（v4.207.0）
 * ------------------------------------------------------------
 * 【顺序依据 · 两条独立原话，都是贴吧站内可检索到的，不是记忆】
 *   ① 「底部导航条怎么关?」—— 贴吧吧内提问帖标题。它证明贴吧 App 的一级导航
 *      在**底部**，且用户对它是有感知的（会想关掉）；
 *   ② 「点击右下角【我的】图标，进入个人主页」—— 站内教程原文。它证明
 *      「我的」在**最右下角**，即四格里的最后一格。
 *   「进吧」落在第二格：贴吧把「进吧」作为一级入口是长期稳定的结构，本仓照此
 *   落格。**不当判据**的部分是中间两格的官方配色与图标细节 —— 取不到官方图，
 *   就按本仓视觉台（深色底 + 亮蓝强调）画，不假装那是官方样式。
 *
 * 【为什么只有四格】官方底栏容量是四到五格，本仓真正有落点的只有三格半：
 *   首页（有）· 进吧（有）· 我的（有）· 消息（**没有消息模块**）。
 *   第五格无论放「发现 / 商店 / 直播」都会是一颗点了不动的假键 —— 本仓从
 *   LOFTER 那一轮起就定了规矩：宁可少一格，不画假键。四格封顶的另一面是
 *   每格更宽（真机上四格比五格更好按）。
 *
 * 【disabled 的语义】`on:false` 的格子不是「隐藏」，是「如实告知还没做」：
 *   画出来 + opacity .38 + aria-disabled，点击走页面内提示条。藏起来用户会
 *   以为「这个 App 压根没有消息」，画出来并说明才符合「照现实」。
 * ============================================================ */
const TB_NAV = [
    { key: 'home', label: '首页', icon: 'fa-house', on: true },
    { key: 'bars', label: '进吧', icon: 'fa-compass', on: true },
    { key: 'message', label: '消息', icon: 'fa-comment-dots', on: false },
    { key: 'me', label: '我的', icon: 'fa-user', on: true }
];
/* 二级面（详情 / 搜索）不参与高亮：底栏留着，但不骗人说「你现在在首页」。 */
const TB_SUB_PAGES = { detail: '', search: '' };

/** 头像色调：按作者名取稳定下标，同一个人永远同一个色。 */
function toneOf(name) {
    const s = String(name == null ? '' : name);
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 8;
}

export class TiebaView {
    constructor(app) {
        this.app = app;
        this.container = null;
        this.page = 'home';
        this.barId = 'all';
        this.postId = '';
        this.keyword = '';
        this._bound = false;
        this._scrollTop = 0;
        this._toastTimer = null;
    }

    /** 数据层：换会话后 `this.app.data` 会换成新实例，每次取当前那份。 */
    _data() {
        return this.app.data;
    }

    _q(sel) {
        const c = this.container;
        if (!c || typeof c.querySelector !== 'function') return null;
        try { return c.querySelector(sel); } catch (_e) { return null; }
    }

    /* ---------- 1. 外壳与重绘 ---------- */

    render(container) {
        if (!container) return;
        if (this.container !== container) {
            this.container = container;
            this.page = 'home';
            this.barId = 'all';
            this.postId = '';
            this.keyword = '';
        }
        this._paint();
        this._syncBinding();
    }

    _paint() {
        const c = this.container;
        if (!c) return;
        this._scrollTop = this._readScroll();
        /* 三层外壳（与 LOFTER / Pixiv 同一套口径，缺陷根因写在两处文件头）：
         *   .tb-app     满屏纵向 flex、overflow:hidden、padding:0
         *   .tb-view    flex:1 1 auto + min-height:0，**不写 height:100%**
         *   .tb-scroll  唯一滚动区，承接原有内边距
         *   .tb-tabbar  flex-shrink:0 贴底，**不用 position:fixed**
         * 两条已实测过的坑：`height:100%` 在 overflow:hidden 的父级里会溢出把
         * 底栏裁掉（LOFTER 那轮）；position:fixed 会脱离外壳高度约束，微博那轮
         * 实测 nav 溢出 appH 8px。 */
        c.innerHTML = `<div class="tb-app" data-page="${esc(this.page)}">`
            + this._appbarHtml()
            + `<div class="tb-view">`
            + `<div class="tb-scroll" data-role="scroll">${this._bodyHtml()}</div>`
            + `</div>`
            + this._tabbarHtml()
            + this._composeHtml()
            + `</div>`;
        this._restoreScroll();
    }

    _readScroll() {
        const el = this._q('[data-role="scroll"]');
        return (el && typeof el.scrollTop === 'number') ? el.scrollTop : this._scrollTop;
    }

    _restoreScroll() {
        const el = this._q('[data-role="scroll"]');
        if (el && typeof el.scrollTop === 'number' && this._scrollTop) el.scrollTop = this._scrollTop;
    }

    _appbarHtml() {
        /* 标题按面切。bars / me 是本版新增的一级面，标题取「进吧」「我的」，
         * **不写「百度贴吧」**：一级面之间顶栏标题一样，用户会看不出自己切了面。 */
        const TITLE = { search: '搜索贴吧', bars: '进吧', me: '我的' };
        const title = TITLE[this.page]
            ? TITLE[this.page]
            : (this.page === 'detail'
                ? esc(this._barNameOfPost() || '贴吧')
                : '百度贴吧');
        const right = this.page === 'detail'
            ? `<button type="button" class="tb-act tb-act-like" data-act="like" data-post="${esc(this.postId)}" aria-label="点赞"><span class="tb-like-ico"></span></button>`
            : `<button type="button" class="tb-act tb-act-post" data-act="compose" aria-label="发帖"><span class="tb-pen-ico"></span><span>发帖</span></button>`;
        return `<header class="tb-appbar">`
            + `<button type="button" class="tb-act tb-back" data-act="back" aria-label="返回"><span class="tb-chevron"></span></button>`
            + `<div class="tb-title">${title}</div>`
            + right
            + `</header>`;
    }

    _bodyHtml() {
        if (this.page === 'detail') return this._detailHtml();
        if (this.page === 'search') return this._searchHtml();
        if (this.page === 'bars') return this._barsHtml();
        if (this.page === 'me') return this._meHtml();
        return this._homeHtml();
    }

    /* ---------- 1.5 底栏一级导航（v4.207.0） ---------- */
    /**
     * 底栏 HTML。**只有这里产出 `.tb-tabitem`**，重绘时整块替换，
     * 不单独打补丁 —— 与 `_paint()` 的「DOM 只是 this 的投影」同一条纪律。
     *
     * 高亮规则（`TB_SUB_PAGES` 参与判断，不是装饰）：
     *   详情 / 搜索 这两个二级面**不高亮任何一格**。理由：用户点进帖子后
     *   浏览器语义里「你还在首页那条路上」，但贴吧现实里底栏高亮的是「进吧」
     *   那一系。本仓没有独立消息流可跳，硬高亮一格会把「返回键」要表达的
     *   「这是二级面」冲掉，故取「保持底栏、取消高亮」，让人随时能切回去。
     */
    _tabbarHtml() {
        const cur = TB_SUB_PAGES[this.page] === '' ? '' : this.page;
        const items = TB_NAV.map((n) => {
            const on = n.on && cur === n.key;
            return '<button type="button" class="tb-tabitem'
                + (on ? ' is-on' : '')
                + (n.on ? '' : ' is-off')
                + '" data-act="nav" data-nav="' + n.key + '"'
                + (n.on ? '' : ' aria-disabled="true"')
                + ' aria-label="' + esc(n.label) + '">'
                + '<i class="fa-solid ' + n.icon + '" aria-hidden="true"></i>'
                + '<span class="tb-tabtext">' + esc(n.label) + '</span>'
                + '</button>';
        }).join('');
        return '<nav class="tb-tabbar" role="navigation" aria-label="主导航">' + items + '</nav>';
    }

    /* ---------- 2. 首页 ---------- */

    _homeHtml() {
        const bars = this._data().getBars();
        const chips = [`<button type="button" class="tb-chip${this.barId === 'all' ? ' is-on' : ''}" data-act="chip" data-bar="all">全部</button>`]
            .concat(bars.map((b) => (
                `<button type="button" class="tb-chip${this.barId === b.id ? ' is-on' : ''}" data-act="chip" data-bar="${esc(b.id)}">${esc(b.name)}</button>`
            )));
        const posts = this._data().getPostsByBar(this.barId);
        const st = this._data().stats();
        return `<div class="tb-search-row">`
            + `<input class="tb-search" type="search" placeholder="搜索帖子 / 吧 / 作者" value="${esc(this.keyword)}" data-role="search" aria-label="搜索贴吧" />`
            + `<button type="button" class="tb-search-go" data-act="search">搜索</button>`
            + `</div>`
            + `<nav class="tb-chips" aria-label="选择贴吧">${chips.join('')}</nav>`
            + `<div class="tb-count">${esc(this._barLabel())} · ${st.posts} 帖 · ${st.replies} 条回复</div>`
            + (posts.length
                ? `<div class="tb-list">${posts.map((p) => this._postCardHtml(p)).join('')}</div>`
                : `<div class="tb-empty"><p class="tb-empty-title">这个吧还没有帖子</p><p class="tb-empty-tip">点右上角「发帖」，抢个一楼。</p></div>`);
    }

    _barLabel() {
        if (this.barId === 'all') return '全部吧';
        const bar = this._data().getBar(this.barId);
        return bar ? bar.name : '未知吧';
    }

    _postCardHtml(p) {
        const excerpt = p.content ? `<p class="tb-excerpt">${esc(p.content, 80)}</p>` : '';
        return `<article class="tb-card" data-act="open" data-post="${esc(p.id)}">`
            + `<div class="tb-card-bar"><span class="tb-bar-dot"></span>${esc(p.barName)}</div>`
            + `<h3 class="tb-card-title">${esc(p.title)}</h3>`
            + excerpt
            + `<div class="tb-card-foot">`
            + this._avaHtml(p.author)
            + `<span class="tb-author">${esc(p.author)}</span>`
            + `<span class="tb-time">${esc(p.time)}</span>`
            + `<span class="tb-stat">回复 ${p.replies.length}</span>`
            + `<button type="button" class="tb-act tb-like${p.isLiked ? ' is-on' : ''}" data-act="like" data-post="${esc(p.id)}" aria-label="点赞">`
            + `<span class="tb-like-ico"></span><span class="tb-like-num">${p.likes}</span>`
            + `</button>`
            + `</div></article>`;
    }

    _avaHtml(name, big) {
        return `<span class="tb-ava tb-tone${toneOf(name)}${big ? ' is-big' : ''}" aria-hidden="true">${esc(String(name || '吧').slice(0, 1))}</span>`;
    }

    /* ---------- 3. 详情 ---------- */

    _barNameOfPost() {
        const p = this._data().getPostById(this.postId);
        return p ? p.barName : '';
    }

    _detailHtml() {
        const p = this._data().getPostById(this.postId);
        if (!p) {
            return `<div class="tb-empty"><p class="tb-empty-title">这帖不在了</p>`
                + `<p class="tb-empty-tip">可能已被删除，回首页看看别的。</p>`
                + `<button type="button" class="tb-btn" data-act="back">回首页</button></div>`;
        }
        const floors = p.replies.map((r) => (
            `<div class="tb-floor">`
            + `<div class="tb-floor-head">${this._avaHtml(r.author)}`
            + `<span class="tb-author">${esc(r.author)}</span>`
            + `<span class="tb-floor-no">${r.floor} 楼</span>`
            + `<span class="tb-time">${esc(r.time)}</span>`
            + `</div>`
            + `<p class="tb-floor-text">${esc(r.text)}</p>`
            + `</div>`
        )).join('');
        return `<section class="tb-main-floor">`
            + `<div class="tb-floor-head">${this._avaHtml(p.author, true)}`
            + `<span class="tb-author">${esc(p.author)}</span>`
            + `<span class="tb-lz">楼主</span>`
            + `<span class="tb-floor-no">1 楼</span>`
            + `<span class="tb-time">${esc(p.time)}</span>`
            + `</div>`
            + `<h2 class="tb-detail-title">${esc(p.title)}</h2>`
            + `<p class="tb-detail-text">${esc(p.content)}</p>`
            + `<div class="tb-detail-foot"><span class="tb-stat">回复 ${p.replies.length}</span>`
            + `<span class="tb-stat">赞 ${p.likes}</span></div>`
            + `</section>`
            + `<div class="tb-floors-head">全部回复 (${p.replies.length})</div>`
            + (p.replies.length ? `<div class="tb-floors">${floors}</div>`
                : `<div class="tb-empty tb-empty-quiet"><p class="tb-empty-tip">还没有人回复，说点什么吧。</p></div>`)
            + `<div class="tb-reply-bar">`
            + `<input class="tb-reply-input" type="text" placeholder="回复楼主…" data-role="reply" aria-label="回复内容" />`
            + `<button type="button" class="tb-btn tb-btn-send" data-act="reply-send" data-post="${esc(p.id)}">回复</button>`
            + `</div>`;
    }

    /* ---------- 3.5 进吧（v4.207.0） ---------- */
    /**
     * 「进吧」面：全部吧的列表，每格显示吧名 / 帖子数 / 最近一条标题。
     * 能力对位：`getBars()` + `getPostsByBar(id)` —— 点一格就把 `barId` 切过去
     * 并回首页，等价于现实里「进到那个吧」。
     *
     * 为什么不做「关注 / 未关注」两栏：本仓没有关注关系（数据层没有这字段，
     * 模型标签入库也不带），画出来两栏就是拿同一份数据换两个标题。
     */
    _barsHtml() {
        const d = this._data();
        const bars = d.getBars();
        if (!bars.length) {
            return `<div class="tb-empty"><p class="tb-empty-title">还没有吧</p>`
                + `<p class="tb-empty-tip">发第一帖时会自动建一个吧。</p>`
                + `<button type="button" class="tb-btn" data-act="compose">去发帖</button></div>`;
        }
        const rows = bars.map((b) => {
            const posts = d.getPostsByBar(b.id);
            const last = posts.length ? posts[0].title : '';
            const tail = posts.length
                ? `${posts.length} 帖 · 最新：${esc(last, 24)}`
                : '暂无帖子';
            return `<button type="button" class="tb-barrow" data-act="enter-bar" data-bar="${esc(b.id)}">`
                + `<span class="tb-barrow-ava tb-tone${toneOf(b.name)}" aria-hidden="true">${esc(String(b.name || '吧').slice(0, 1))}</span>`
                + `<span class="tb-barrow-main">`
                + `<b class="tb-barrow-name">${esc(b.name)}</b>`
                + `<span class="tb-barrow-sub">${tail}</span>`
                + `</span>`
                + `<span class="tb-barrow-go" aria-hidden="true"></span>`
                + `</button>`;
        }).join('');
        const st = d.stats();
        return `<div class="tb-count">全部 ${st.bars} 个吧 · ${st.posts} 帖 · ${st.replies} 条回复</div>`
            + `<div class="tb-barrows">${rows}</div>`;
    }

    /* ---------- 3.6 我的（v4.207.0） ---------- */
    /**
     * 「我的」面：我发的帖 / 我赞过的帖。
     * 能力对位：`author === '我'`（发帖与回复都写死这个署名）与 `isLiked`。
     *
     * 三件本仓做不到的事，如实说明而不画假控件：
     *   · 头像 / 昵称 —— 没有账号体系，写死「本机用户」；
     *   · 签到 / 经验 / 等级 —— 没有积分模型；
     *   · 我的收藏 —— 本仓的收藏在 B站 那套（favorites），贴吧数据层没有。
     * 所以这一页只有两个真实列表 + 一行说明，不做「设置项列表」凑数。
     */
    _meHtml() {
        const d = this._data();
        const all = d.getPostsByBar('all');
        const mine = all.filter((p) => String(p.author) === '我');
        const liked = all.filter((p) => p.isLiked && String(p.author) !== '我');
        const card = (p) => this._postCardHtml(p);
        return `<div class="tb-me-head">`
            + `<span class="tb-me-ava" aria-hidden="true">我</span>`
            + `<span class="tb-me-id">`
            + `<b>本机用户</b>`
            + `<span class="tb-me-sub">发过 ${mine.length} 帖 · 赞过 ${liked.length} 帖</span>`
            + `</span>`
            + `<button type="button" class="tb-btn tb-me-new" data-act="compose">发帖</button>`
            + `</div>`
            + `<div class="tb-me-sec">我的帖子 (${mine.length})</div>`
            + (mine.length
                ? `<div class="tb-list">${mine.map(card).join('')}</div>`
                : `<div class="tb-empty tb-empty-quiet"><p class="tb-empty-tip">还没发过帖，点右上角「发帖」说两句。</p></div>`)
            + `<div class="tb-me-sec">我赞过的 (${liked.length})</div>`
            + (liked.length
                ? `<div class="tb-list">${liked.map(card).join('')}</div>`
                : `<div class="tb-empty tb-empty-quiet"><p class="tb-empty-tip">还没赞过别人的帖。</p></div>`)
            + `<div class="tb-me-note">本机没有账号体系，这一页只数本会话里你自己发过和赞过的帖子。</div>`;
    }

    /* ---------- 4. 搜索 ---------- */

    _searchHtml() {
        const q = String(this.keyword || '').trim();
        return `<div class="tb-search-row">`
            + `<input class="tb-search" type="search" placeholder="搜索帖子 / 吧 / 作者" value="${esc(q)}" data-role="search" aria-label="搜索贴吧" />`
            + `<button type="button" class="tb-search-go" data-act="search">搜索</button>`
            + `</div>`
            + (q
                ? this._searchResultHtml(q)
                : `<div class="tb-empty"><p class="tb-empty-title">搜点什么</p><p class="tb-empty-tip">标题、正文、作者、吧名都能搜到。</p></div>`);
    }

    _searchResultHtml(q) {
        const hits = this._data().searchPosts(q);
        if (!hits.length) {
            return `<div class="tb-empty"><p class="tb-empty-title">没搜到「${esc(q, 20)}」</p>`
                + `<p class="tb-empty-tip">换个词试试，或者回首页翻翻。</p>`
                + `<button type="button" class="tb-btn" data-act="search-clear">清空关键词</button></div>`;
        }
        return `<div class="tb-count">找到 ${hits.length} 条</div>`
            + `<div class="tb-list">${hits.map((p) => this._postCardHtml(p)).join('')}</div>`;
    }

    /* ---------- 5. 发帖 sheet ---------- */

    _composeHtml() {
        const bars = this._data().getBars();
        const opts = bars.map((b) => (
            `<option value="${esc(b.id)}"${b.id === this.barId ? ' selected' : ''}>${esc(b.name)}</option>`
        )).join('');
        return `<div class="tb-sheet" data-role="sheet" hidden>`
            + `<div class="tb-sheet-mask" data-act="compose-close"></div>`
            + `<div class="tb-sheet-card">`
            + `<div class="tb-sheet-head">`
            + `<button type="button" class="tb-act tb-sheet-x" data-act="compose-close" aria-label="关闭">×</button>`
            + `<span class="tb-sheet-title">发布新帖</span>`
            + `<button type="button" class="tb-btn tb-btn-send" data-act="compose-send">发布</button>`
            + `</div>`
            + `<div class="tb-sheet-body">`
            + `<label class="tb-field"><span>选择吧</span><select data-role="bar">${opts}</select></label>`
            + `<input class="tb-input" type="text" placeholder="请拟一个吸引人的标题" data-role="title" aria-label="帖子标题" />`
            + `<textarea class="tb-textarea" rows="5" placeholder="填写帖子正文，与吧友一起交流～" data-role="content" aria-label="帖子正文"></textarea>`
            + `</div></div></div>`;
    }

    /* ---------- 6. 事件（委托在容器上，只挂一次） ---------- */

    _syncBinding() {
        const c = this.container;
        if (!c || this._bound) return;
        if (typeof c.addEventListener !== 'function') return;
        c.addEventListener('click', (e) => this._handleClick(e));
        c.addEventListener('keydown', (e) => this._handleKeydown(e));
        c.addEventListener('input', (e) => this._handleInput(e));
        this._bound = true;
    }

    _attr(el, name) {
        if (!el || typeof el.getAttribute !== 'function') return null;
        return el.getAttribute('data-' + name);
    }

    _handleClick(e) {
        const target = e && e.target ? e.target : null;
        const holder = target && typeof target.closest === 'function' ? target.closest('[data-act]') : null;
        const act = holder ? this._attr(holder, 'act') : null;
        if (!act) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        this._act(act, holder);
    }

    _handleInput(e) {
        const t = e && e.target ? e.target : null;
        const role = this._attr(t, 'role');
        if (role === 'search') {
            this.keyword = String(t.value == null ? '' : t.value);
            /* 搜索页边打边出结果；首页只记住词，不抢用户的点击。 */
            if (this.page === 'search') {
                const box = this._q('[data-role="scroll"]');
                if (box) box.innerHTML = this._searchHtml();
            }
        }
    }

    _handleKeydown(e) {
        if (!e || (e.key !== 'Enter' && e.keyCode !== 13)) return;
        const role = this._attr(e.target, 'role');
        if (role === 'reply') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            this._act('reply-send', e.target);
        } else if (role === 'search') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            this._act('search', e.target);
        } else if (role === 'title') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            const box = this._q('[data-role="content"]');
            if (box && typeof box.focus === 'function') box.focus();
        }
    }

    /* ---------- 7. 动作路由 ---------- */

    _act(act, el) {
        const data = this._data();
        switch (act) {
            case 'back': return this._back();
            case 'chip': {
                this.barId = this._attr(el, 'bar') || 'all';
                return this._paint();
            }
            case 'open': {
                const id = this._attr(el, 'post');
                if (!id || !data.getPostById(id)) return this._toast('这帖不在了');
                this.page = 'detail';
                this.postId = id;
                return this._paint();
            }
            case 'like': {
                const id = this._attr(el, 'post') || this.postId;
                const r = data.toggleLike(id);
                if (!r) return this._toast('这帖不在了');
                this._paint();
                return this._toast(r.on ? '已点赞' : '已取消点赞');
            }
            case 'search': {
                const input = this._q('[data-role="search"]');
                if (input && typeof input.value === 'string') this.keyword = input.value;
                this.page = 'search';
                return this._paint();
            }
            case 'search-clear': {
                this.keyword = '';
                const s = this._q('[data-role="scroll"]');
                if (s) s.innerHTML = this._searchHtml();
                const input = this._q('[data-role="search"]');
                if (input && typeof input.focus === 'function') input.focus();
                return null;
            }
            case 'nav': {
                const to = this._attr(el, 'nav') || 'home';
                const item = TB_NAV.find((n) => n.key === to);
                if (!item) return null;
                /* disabled 格：如实说「还没做」，不假跳一个空页。用页面内提示条，
                 * 不碰宿主 alert —— alert 会卡住 SillyTavern 的消息流。 */
                if (!item.on) return this._toast('「' + item.label + '」本机还没做。');
                if (to === 'home') {
                    this.postId = '';
                    this.page = 'home';
                } else {
                    this.postId = '';
                    this.page = to;
                }
                return this._paint();
            }
            case 'enter-bar': {
                const bid = this._attr(el, 'bar');
                if (!bid || !data.getBar(bid)) return this._toast('这个吧不在了');
                this.barId = bid;
                this.page = 'home';
                this.postId = '';
                this._paint();
                return this._toast('已进入「' + this._barLabel() + '」');
            }
            case 'compose': return this._openCompose();
            case 'compose-close': return this._closeCompose();
            case 'compose-send': return this._sendPost();
            case 'reply-send': return this._sendReply(this._attr(el, 'post'));
            default: return null;
        }
    }

    _back() {
        /* 一级面（bars / me）按返回 = 回首页；二级面（detail / search）同理。
         * 已经在首页时才把返回键交给宿主（退出 App）。 */
        const NAV_PAGES = { bars: 1, me: 1 };
        if (this.page === 'detail' || this.page === 'search' || NAV_PAGES[this.page]) {
            this.page = 'home';
            this.postId = '';
            return this._paint();
        }
        const w = (typeof window !== 'undefined') ? window : null;
        if (w && typeof w.dispatchEvent === 'function' && typeof w.CustomEvent === 'function') {
            w.dispatchEvent(new w.CustomEvent('phone:goHome'));
        } else {
            this._toast('已在首页');
        }
        return null;
    }

    /* ---------- 8. 发帖 / 回复 ---------- */

    _openCompose() {
        const sheet = this._q('[data-role="sheet"]');
        if (!sheet) return null;
        sheet.hidden = false;
        sheet.removeAttribute?.('hidden');
        const title = this._q('[data-role="title"]');
        if (title && typeof title.focus === 'function') title.focus();
        return null;
    }

    _closeCompose() {
        const sheet = this._q('[data-role="sheet"]');
        if (sheet) {
            sheet.hidden = true;
            sheet.setAttribute?.('hidden', '');
        }
        return null;
    }

    _sendPost() {
        const barEl = this._q('[data-role="bar"]');
        const titleEl = this._q('[data-role="title"]');
        const contentEl = this._q('[data-role="content"]');
        const barId = barEl && barEl.value ? barEl.value : this.barId;
        const title = titleEl && titleEl.value ? String(titleEl.value).trim() : '';
        const content = contentEl && contentEl.value ? String(contentEl.value).trim() : '';
        if (!title) return this._toast('标题不能为空');
        const post = this._data().createPost(barId, title, content, '我');
        if (!post) return this._toast('发帖失败');
        if (titleEl) titleEl.value = '';
        if (contentEl) contentEl.value = '';
        this._closeCompose();
        this.page = 'home';
        this.barId = post.barId;
        this.keyword = '';
        this._paint();
        return this._toast('发布成功');
    }

    _sendReply(postId) {
        const id = postId || this.postId;
        const input = this._q('[data-role="reply"]');
        const text = input && input.value ? String(input.value).trim() : '';
        if (!text) return this._toast('说点什么再回复');
        const floor = this._data().addReply(id, text, '我');
        if (!floor) return this._toast('这帖不在了');
        if (input) input.value = '';
        this._paint();
        return this._toast(`已回复（${floor.floor} 楼）`);
    }

    /* ---------- 9. 提示 ---------- */

    _toast(msg) {
        const c = this.container;
        if (!c) return null;
        const old = this._q('.tb-toast');
        if (old && typeof old.remove === 'function') old.remove();
        const doc = (c.ownerDocument) || ((typeof document !== 'undefined') ? document : null);
        if (!doc || typeof doc.createElement !== 'function' || typeof c.appendChild !== 'function') return null;
        const el = doc.createElement('div');
        el.className = 'tb-toast';
        el.textContent = String(msg == null ? '' : msg);
        c.appendChild(el);
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this._toastTimer = null;
            if (el && typeof el.remove === 'function') el.remove();
        }, 1600);
        return null;
    }
}

export default TiebaView;
