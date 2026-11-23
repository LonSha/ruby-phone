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
 * apps/bilibili/bili-view.js — B站视图层（v4.160.0 照现实重写）
 * ------------------------------------------------------------
 * 这一版为什么要重写：旧视图只有 62 行 —— 一个搜索框 + 两张横卡 + 一个刷新
 *   按钮就结束了。现实里 B站 是「分区页签 + 双列瀑布流 + 播放页（弹幕/三连/
 *   评论）+ 动态 + 消息 + 我的 + 搜索 + UP 主页」。界面不是装饰：它决定了
 *   用户能不能做出现实里那些动作（点赞、投币、收藏、追UP、看历史、发弹幕）。
 *
 * 【三条落地纪律（与本仓门禁一一对应，不是风格偏好）】
 *   ① **事件委托**：整页重绘时不能把监听器丢了，也不能每绘一次就多挂一份。
 *      故监听只挂在容器上（`_syncBinding` 按容器身份去重），页面内一切交互
 *      走 `[data-act]` + `closest()`；
 *   ② **不弹宿主对话框**：`alert/confirm/prompt` 会卡住 SillyTavern 的消息流，
 *      提示一律用自绘的 `.bl-toast`；需要输入的地方就是页面里的一行表单；
 *   ③ **宿主读不到也不许抛**：单测夹具的 `querySelector` 一律返回 null、
 *      `getBoundingClientRect` 不存在。所有 DOM 读取都走 `_q()` + 空判断，
 *      拿不到就「这次不生效」，绝不让一次点击把整个 App 打崩。
 *
 * 【刻意不做的事（逐条写清，免得下一个人以为是漏了）】
 *   · 不做「投稿上传」：本地没有上传管线，做一个只会弹提示的按钮就是假控件。
 *     底栏中间的凸起按钮进的是**创作中心**，如实显示 0 稿件 / 0 播放；
 *   · 不做「分享成功」的假回执：分享面板把真实可复制的链接摆出来，剪贴板
 *     被环境禁用时如实说「不让复制」，不假装复制成功；
 *   · 不做无限循环弹幕动画：全仓动效门禁要求每个 `infinite` 动画都被降频规则
 *     覆盖。这里用**一次性**飞过（`animation-iteration-count:1`），既不新增
 *     门禁面，也不会在后台空转；
 *   · 不自己算时间：内容时间戳全部来自数据层（剧情钟/墙钟的归属在
 *     `bili-data.js` 顶部逐字段写明），本文件不出现任何取钟调用。
 * ============================================================ */
import { fmtCount, fmtDur } from './bili-data.js';

/* 图标统一收在一处：换图标只改这里，不用在十几个模板串里找。 */
const ICON = {
    home: 'fa-solid fa-house',
    dynamic: 'fa-solid fa-tv',
    message: 'fa-solid fa-comment-dots',
    mine: 'fa-solid fa-user',
    plus: 'fa-solid fa-plus',
    back: 'fa-solid fa-chevron-left',
    search: 'fa-solid fa-magnifying-glass',
    play: 'fa-solid fa-play',
    pause: 'fa-solid fa-pause',
    like: 'fa-solid fa-thumbs-up',
    coin: 'fa-solid fa-coins',
    star: 'fa-solid fa-star',
    share: 'fa-solid fa-share-nodes',
    later: 'fa-solid fa-clock',
    trash: 'fa-regular fa-trash-can'
};

export class BiliView {
    constructor(app) {
        this.app = app;
        this.container = null;
        /* 页面栈：只存页面名。返回键弹一层，弹空即回桌面。 */
        this.page = 'home';
        this.stack = [];
        this.tab = '';
        this.searchKw = '';
        this.searchResult = null;
        this.spaceMid = '';
        this.shelfTab = '历史';
        this.shelfFid = '';
        this.video = null;
        this.replyTo = '';
        this.replyUser = '';
        this.expanded = [];
        this.favForm = false;
        this.shareSheet = false;
        this._tick = null;
        this._toastTimer = null;
        this._clickX = NaN;
        this._boundEl = null;
        this._hClick = null;
        this._hKey = null;
        this._hInput = null;
    }

    /* ---------- 0. 入口 ---------- */

    /**
     * 渲染当前 App。重复调用是安全的：页面状态（当前页/页签/播放进度）保留，
     * 只重画 DOM。手机外壳每次打开 App 都会调它。
     * @param {HTMLElement} container 图层容器（App 侧已解析 layerHost/screen）
     */
    render(container) {
        if (!container) return;
        this.container = container;
        const d = this._data();
        if (!this.tab) {
            const tabs = d ? d.getTabs() : [];
            const saved = d ? d.activeTab : '';
            this.tab = (saved && tabs.indexOf(saved) >= 0) ? saved : '推荐';
        }
        /* 每日硬币与首批内容都在「真正打开」这一刻做：构造函数里做会让
         * 换会话时凭空多出一批内容（v224 判据要求新会话是真空档）。 */
        try { d.ensureDailyCoin(); } catch (_e) { /* 存储不可用：不拦着开 App */ }
        try { d.ensureSeeded(); } catch (_e) { /* 同上 */ }
        this._syncBinding(container);
        this._paint();
    }

    /* ---------- 1. 数据/文本小工具 ---------- */

    _data() {
        return (this.app && this.app.data) ? this.app.data : null;
    }

    /** 取当前页里的一个节点；夹具返回 null 时调用方必须自己兜住。 */
    _q(sel) {
        const c = this.container;
        if (!c || typeof c.querySelector !== 'function') return null;
        try { return c.querySelector(sel); } catch (_e) { return null; }
    }

    /** HTML 转义。引号用数字实体（`"` 在部分宿主里会被二次解码）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&#34;')
            .replace(/'/g, '&#39;');
    }

    _attr(el, name) {
        if (!el) return '';
        try {
            const v = el.getAttribute ? el.getAttribute('data-' + name) : null;
            return v == null ? '' : String(v);
        } catch (_e) { return ''; }
    }

    _tone(tone) {
        const n = (typeof tone === 'number' && Number.isFinite(tone)) ? tone : 0;
        return 'bl-tone' + (Math.abs(Math.round(n)) % 8);
    }

    /** 头像用「名字首字」当占位：真实头像为空时不塞假图片。 */
    _face(name) {
        const s = String(name == null ? '' : name).trim();
        return s ? s.slice(0, 1) : '我';
    }

    _fmtTime(sec) {
        return fmtDur(sec);
    }

    /* ---------- 2. 绘制骨架 ---------- */

    _syncBinding(c) {
        if (this._boundEl === c) return;
        const old = this._boundEl;
        if (old && this._hClick && typeof old.removeEventListener === 'function') {
            try {
                old.removeEventListener('click', this._hClick);
                if (this._hKey) old.removeEventListener('keydown', this._hKey);
                if (this._hInput) old.removeEventListener('input', this._hInput);
            } catch (_e) { /* 老容器已经死了：忽略 */ }
        }
        this._hClick = (ev) => this._handleClick(ev);
        this._hKey = (ev) => this._handleKey(ev);
        this._hInput = (ev) => this._handleInput(ev);
        if (typeof c.addEventListener === 'function') {
            c.addEventListener('click', this._hClick);
            c.addEventListener('keydown', this._hKey);
            c.addEventListener('input', this._hInput);
        }
        this._boundEl = c;
    }

    _readScrolls() {
        const out = {};
        const c = this.container;
        if (!c || typeof c.querySelectorAll !== 'function') return out;
        try {
            const els = c.querySelectorAll('[data-scroll]');
            for (let i = 0; i < els.length; i += 1) {
                const el = els[i];
                const k = el && el.getAttribute ? el.getAttribute('data-scroll') : '';
                if (k) out[k] = el.scrollTop || 0;
            }
        } catch (_e) { /* 读不到就不保滚动，不能因此不画 */ }
        return out;
    }

    _restoreScrolls(scrolls) {
        const c = this.container;
        if (!c || typeof c.querySelectorAll !== 'function') return;
        try {
            const els = c.querySelectorAll('[data-scroll]');
            for (let i = 0; i < els.length; i += 1) {
                const el = els[i];
                const k = el && el.getAttribute ? el.getAttribute('data-scroll') : '';
                if (k && typeof scrolls[k] === 'number') el.scrollTop = scrolls[k];
            }
        } catch (_e) { /* 同上 */ }
    }

    /**
     * 重画整屏。**保留滚动位置**：点赞/发评论这类局部动作也会走到这里，
     * 若每次都把滚动条甩回顶部，用户看到的就是「点一下跳一下」。
     */
    _paint() {
        const c = this.container;
        if (!c) return;
        const scrolls = this._readScrolls();
        try {
            c.innerHTML = this._shell();
        } catch (err) {
            console.warn('[BiliView]绘制失败:', err && err.message);
            return;
        }
        this._restoreScrolls(scrolls);
        this._startTickIfNeeded();
    }

    _shell() {
        return '<div class="bl-root bl-app">'
            + '<div class="bl-view">' + this._pageHtml() + '</div>'
            + this._tabbarHtml()
            + '</div>';
    }

    _pageHtml() {
        switch (this.page) {
            case 'video': return this._videoHtml();
            case 'search': return this._searchHtml();
            case 'space': return this._spaceHtml();
            case 'dynamic': return this._dynamicHtml();
            case 'message': return this._messageHtml();
            case 'mine': return this._mineHtml();
            case 'shelf': return this._shelfHtml();
            case 'publish': return this._publishHtml();
            default: return this._homeHtml();
        }
    }

    _tabbarHtml() {
        const sub = { video: 'home', search: 'home', space: 'home', shelf: 'home' };
        const cur = sub[this.page] || this.page;
        const item = (nav, icon, label) => '<button class="bl-tabitem' + (cur === nav ? ' on' : '')
            + '" data-act="nav" data-nav="' + nav + '"><i class="' + icon + '"></i><span>' + label + '</span></button>';
        return '<nav class="bl-tabbar">'
            + item('home', ICON.home, '首页')
            + item('dynamic', ICON.dynamic, '动态')
            + '<button aria-label="创作中心" class="bl-pub" data-act="nav" data-nav="publish"><i class="' + ICON.plus + '"></i></button>'
            + item('message', ICON.message, '消息')
            + item('mine', ICON.mine, '我的')
            + '</nav>';
    }

    /* ---------- 3. 首页 ---------- */

    _homeHtml() {
        const d = this._data();
        const tabs = d.getTabs();
        const list = d.getFeed(this.tab);
        const unread = d.getMessages().length;
        const tabBtns = tabs.map((t) => '<button class="bl-tab' + (t === this.tab ? ' on' : '')
            + '" data-act="tab" data-tab="' + this._esc(t) + '">' + this._esc(t) + '</button>').join('');
        const cards = list.length
            ? list.map((e) => this._cardHtml(e)).join('')
            : '<div class="bl-emptybox"><b>这个分区今天没刷到内容</b><span>换个页签，或者换一批看看。</span>'
                + '<button class="bl-btn" data-act="refresh">换一批</button></div>';
        return '<div class="bl-page" data-page="home">'
            + ' <div class="bl-top">'
            + '  <button aria-label="搜索" class="bl-iconbtn" data-act="search"><i class="' + ICON.search + '"></i></button>'
            + '  <button class="bl-pill" data-act="search"><i class="' + ICON.search + '"></i><span>搜你想看的</span></button>'
            + '  <button aria-label="消息" class="bl-iconbtn" data-act="message"><i class="' + ICON.message + '"></i>'
            + (unread ? '<em class="bl-badge">' + unread + '</em>' : '') + '</button>'
            + ' </div>'
            + ' <div class="bl-tabs" data-scroll="tabs">' + tabBtns + '</div>'
            + ' <div class="bl-feed" data-scroll="feed">' + cards
            + (list.length ? '<button class="bl-more" data-act="refresh">换一批</button>' : '')
            + ' </div>'
            + '</div>';
    }

    _cardHtml(e) {
        if (e.live) {
            return '<article class="bl-live" role="button" tabindex="0" data-act="open" data-bvid="' + this._esc(e.bvid) + '">'
                + '<div class="bl-thumb ' + this._tone(e.tone) + '"><span class="bl-temoji">' + this._esc(e.temoji) + '</span>'
                + '<em class="bl-livetag">直播中</em></div>'
                + '<div class="bl-lmeta"><b class="bl-ltitle">' + this._esc(e.title) + '</b>'
                + '<span class="bl-sub">' + this._esc(e.upName) + ' · ' + fmtCount(e.viewers || e.play) + '人气</span></div>'
                + '</article>';
        }
        return '<article class="bl-vcard" role="button" tabindex="0" data-act="open" data-bvid="' + this._esc(e.bvid) + '">'
            + '<div class="bl-thumb ' + this._tone(e.tone) + '"><span class="bl-temoji">' + this._esc(e.temoji) + '</span>'
            + '<em class="bl-dur">' + this._esc(e.durationText) + '</em>'
            + '<em class="bl-views">' + fmtCount(e.play) + '</em></div>'
            + '<b class="bl-vtitle">' + this._esc(e.title) + '</b>'
            + '<span class="bl-sub">' + this._esc(e.upName) + ' · ' + this._esc(e.pubText || '') + '</span>'
            + '</article>';
    }

    /* ---------- 4. 播放页 ---------- */

    _videoHtml() {
        const d = this._data();
        const v = this.video;
        const e = v ? d.getEntry(v.bvid) : null;
        if (!e) {
            /* 条目已经不在档里（换了一批/换会话）：如实回首页，不留空白播放器。 */
            this.page = 'home';
            this.video = null;
            return this._homeHtml();
        }
        const dur = Math.max(1, e.duration || 1);
        const pos = Math.max(0, Math.min(dur, v.pos || 0));
        const pct = Math.round((pos / dur) * 1000) / 10;
        const playing = Boolean(v.playing);
        const dms = (e.danmaku || []).slice(0, 12).map((dm, i) => {
            const top = 8 + ((i * 13) % 60);
            const delay = (i * 0.8).toFixed(1);
            return '<span class="bl-dm" style="--dm-top:' + top + '%;--dm-delay:' + delay + 's">'
                + this._esc(dm.text) + '</span>';
        }).join('');
        const related = d.getFeed(this.tab).filter((x) => x.bvid !== e.bvid).slice(0, 8);
        const sheet = this.shareSheet ? this._shareSheetHtml(e) : '';
        return '<div class="bl-page bl-vpage" data-page="video">'
            + '<div class="bl-player' + (playing ? ' playing' : ' paused') + '" id="bl-player">'
            + ' <div class="bl-screen ' + this._tone(e.tone) + '"><span class="bl-bigemoji">' + this._esc(e.temoji) + '</span></div>'
            + ' <div class="bl-dmlayer">' + dms + '</div>'
            + ' <div class="bl-ptop"><button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
            + '<span class="bl-ptitle">' + this._esc(e.title) + '</span></div>'
            + ' <div class="bl-pctl">'
            + '  <button aria-label="播放或暂停" class="bl-iconbtn" data-act="toggle" id="bl-toggle"><i class="'
            + (playing ? ICON.pause : ICON.play) + '"></i></button>'
            + '  <div class="bl-bar" data-act="seek" id="bl-bar"><div class="bl-barfill" id="bl-barfill" style="width:' + pct + '%"></div></div>'
            + '  <span class="bl-ptime" id="bl-ptime">' + this._fmtTime(pos) + ' / ' + this._fmtTime(dur) + '</span>'
            + ' </div>'
            + '</div>'
            + '<div class="bl-scroll" data-scroll="video">'
            + ' <h1 class="bl-h1">' + this._esc(e.title) + '</h1>'
            + ' <div class="bl-stat">' + fmtCount(e.play) + '播放 · ' + fmtCount(e.danmakuCount) + '弹幕 · '
            + this._esc(e.pubText || '') + ' · ' + this._esc(e.tname) + '</div>'
            + ' ' + this._actsHtml(e)
            + ' <p class="bl-desc">' + this._esc(e.desc) + '</p>'
            + ' <div class="bl-tags">' + (e.tags || []).map((t) => '<span class="bl-tag">#' + this._esc(t) + '</span>').join('') + '</div>'
            + ' ' + this._upRowHtml(e)
            + ' <div class="bl-form"><input id="bl-dm-input" class="bl-input" maxlength="40" placeholder="发一条弹幕（40 字以内）" />'
            + '<button class="bl-btn" data-act="dm-send">发送</button></div>'
            + ' ' + this._commentsHtml(e)
            + ' <div class="bl-rellist"><div class="bl-secttl">相关推荐</div>'
            + (related.length ? related.map((x) => this._relRowHtml(x)).join('') : '<div class="bl-hint">暂时没有相关推荐。</div>')
            + ' </div>'
            + '</div>'
            + sheet
            + '</div>';
    }

    _actsHtml(e) {
        const u = this._data().getUser();
        const liked = u.liked.indexOf(e.bvid) >= 0;
        const coined = u.coined.indexOf(e.bvid) >= 0;
        const favored = u.favored.indexOf(e.bvid) >= 0;
        const later = u.watchLater.indexOf(e.bvid) >= 0;
        const btn = (act, on, icon, label, count) => '<button class="bl-act'
            + (on ? ' on' : '') + '" data-act="' + act + '" data-bvid="' + this._esc(e.bvid) + '">'
            + '<i class="' + icon + '"></i><span>' + label + '</span><em>' + fmtCount(count) + '</em></button>';
        return '<div class="bl-acts" id="bl-acts">'
            + btn('like', liked, ICON.like, liked ? '已赞' : '点赞', e.like)
            + btn('coin', coined, ICON.coin, coined ? '已投' : '投币', e.coin)
            + btn('fav', favored, ICON.star, favored ? '已藏' : '收藏', e.fav)
            + btn('share', false, ICON.share, '分享', e.share)
            + btn('later', later, ICON.later, later ? '已加' : '稍后看', 0)
            + '</div>';
    }

    _upRowHtml(e) {
        const info = this._data().getUpInfo(e.upMid);
        const followed = info ? info.followed : false;
        /* 头像 + 名字是进 UP 主页的入口：没有它，「UP 主页」这一页在界面上
         * 永远点不到（自检时抓到的真缺陷）。关注按钮单独一层，不嵌在入口里。 */
        return '<div class="bl-up">'
            + '<div class="bl-upenter" role="button" tabindex="0" data-act="space" data-mid="' + this._esc(e.upMid) + '">'
            + ' <div class="bl-avatar">' + this._esc(this._face(e.upName)) + '</div>'
            + ' <div class="bl-uinfo"><b>' + this._esc(e.upName) + '</b>'
            + '  <span class="bl-sub">' + fmtCount(info ? info.fans : e.upFans) + '粉丝'
            + (e.upSign ? ' · ' + this._esc(e.upSign) : '') + '</span></div>'
            + '</div>'
            + '<button class="bl-follow' + (followed ? ' on' : '') + '" data-act="follow" data-mid="' + this._esc(e.upMid) + '">'
            + (followed ? '已关注' : '关注') + '</button>'
            + '</div>';
    }

    _shareSheetHtml(e) {
        const url = e.url || ('phone://bilibili/video/' + e.bvid);
        return '<div class="bl-sheet">'
            + '<div class="bl-sheet-card">'
            + ' <div class="bl-secttl">分享「' + this._esc(e.title) + '」</div>'
            + ' <div class="bl-shareurl" id="bl-shareurl">' + this._esc(url) + '</div>'
            + ' <div class="bl-sheetacts">'
            + '  <button class="bl-btn" data-act="share-copy" data-url="' + this._esc(url) + '">复制链接</button>'
            + '  <button class="bl-btn bl-ghost" data-act="share-close">关闭</button>'
            + ' </div>'
            + '</div></div>';
    }

    _commentsHtml(e) {
        const list = Array.isArray(e.comments) ? e.comments : [];
        const replyHint = this.replyTo
            ? '<div class="bl-replyhint">回复 @' + this._esc(this.replyUser) + ' <button class="bl-mini" data-act="cmt-cancel">取消</button></div>'
            : '';
        const body = list.length ? list.map((c) => {
            const key = e.bvid + ':' + c.id;
            const open = this.expanded.indexOf(key) >= 0;
            const replies = Array.isArray(c.replies) ? c.replies : [];
            const shown = open ? replies : replies.slice(0, 2);
            const more = replies.length > shown.length
                ? '<button class="bl-mini" data-act="cmt-expand" data-cid="' + this._esc(c.id) + '">展开 ' + replies.length + ' 条回复</button>'
                : '';
            const replyHtml = shown.map((r) => '<div class="bl-reply"><b>' + this._esc(r.user) + '</b>：' + this._esc(r.text) + '</div>').join('');
            return '<div class="bl-cmt">'
                + '<div class="bl-cmt-av">' + this._esc(this._face(c.user)) + '</div>'
                + '<div class="bl-cmt-main">'
                + ' <div class="bl-cmt-hd"><b>' + this._esc(c.user) + '</b><span>' + this._esc(c.timeText || '') + '</span></div>'
                + ' <div class="bl-cmt-tx">' + this._esc(c.text) + '</div>'
                + ' <div class="bl-cmt-bar">'
                + '  <button class="bl-mini' + (c.liked ? ' on' : '') + '" data-act="cmt-like" data-cid="' + this._esc(c.id) + '">'
                + '<i class="' + ICON.like + '"></i> ' + (typeof c.likes === 'number' ? c.likes : 0) + '</button>'
                + '  <button class="bl-mini" data-act="cmt-reply" data-cid="' + this._esc(c.id) + '" data-user="' + this._esc(c.user) + '">回复</button>'
                + ' </div>'
                + replyHtml + more
                + '</div></div>';
        }).join('') : '<div class="bl-hint">还没有评论，来发第一条。</div>';
        return '<div class="bl-cmts" id="bl-cmts">'
            + '<div class="bl-secttl">评论 ' + (typeof e.reply === 'number' ? e.reply : 0) + '</div>'
            + replyHint
            + '<div class="bl-form"><input id="bl-cmt-input" class="bl-input" maxlength="300" placeholder="'
            + (this.replyTo ? '回复 @' + this._esc(this.replyUser) : '发一条友善的评论') + '" />'
            + '<button class="bl-btn" data-act="cmt-send">发送</button></div>'
            + body + '</div>';
    }

    _relRowHtml(e) {
        return '<div class="bl-relrow" role="button" tabindex="0" data-act="open" data-bvid="' + this._esc(e.bvid) + '">'
            + '<div class="bl-relthumb ' + this._tone(e.tone) + '"><span>' + this._esc(e.temoji) + '</span></div>'
            + '<div class="bl-relmain"><b>' + this._esc(e.title) + '</b>'
            + '<span class="bl-sub">' + this._esc(e.upName) + ' · ' + fmtCount(e.play) + '播放</span></div>'
            + '</div>';
    }

    /* ---------- 5. 搜索页 ---------- */

    _searchHtml() {
        const d = this._data();
        const kw = this.searchKw || '';
        let body = '';
        if (this.searchResult) {
            const items = this.searchResult.items || [];
            body = '<div class="bl-secttl">「' + this._esc(this.searchResult.kw) + '」找到 ' + items.length + ' 条</div>'
                + (items.length
                    ? items.map((e) => this._relRowHtml(e)).join('')
                    : '<div class="bl-emptybox"><b>没找到相关视频</b><span>换个词试试，或者看看下面这些热搜。</span></div>'
                        + this._hotHtml(d.getHotSearch()));
        } else {
            const hist = d.getSearchHistory();
            body = '<div class="bl-secttl">搜索历史'
                + (hist.length ? '<button class="bl-mini" data-act="hist-clear-q">清空</button>' : '') + '</div>'
                + (hist.length
                    ? '<div class="bl-chips">' + hist.map((h) => '<button class="bl-chip" data-act="hot" data-kw="' + this._esc(h) + '">' + this._esc(h) + '</button>').join('') + '</div>'
                    : '<div class="bl-hint">还没有搜索记录。</div>')
                + this._hotHtml(d.getHotSearch());
        }
        return '<div class="bl-page" data-page="search">'
            + '<div class="bl-top bl-top-search">'
            + ' <button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
            + ' <input id="bl-q" class="bl-input bl-q" value="' + this._esc(kw) + '" placeholder="搜视频、UP主、番剧" />'
            + ' <button class="bl-btn" data-act="search-go">搜索</button>'
            + '</div>'
            + '<div class="bl-scroll" data-scroll="search">' + body + '</div>'
            + '</div>';
    }

    _hotHtml(hot) {
        const list = Array.isArray(hot) ? hot : [];
        return '<div class="bl-secttl">热搜</div>'
            + '<div class="bl-hotlist">' + list.map((w, i) => '<button class="bl-hotrow" data-act="hot" data-kw="' + this._esc(w) + '">'
                + '<em>' + (i + 1) + '</em><span>' + this._esc(w) + '</span></button>').join('') + '</div>';
    }

    /* ---------- 6. UP 主页 ---------- */

    _spaceHtml() {
        const d = this._data();
        const info = d.getUpInfo(this.spaceMid);
        if (!info) {
            return '<div class="bl-page" data-page="space">'
                + '<div class="bl-top"><button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
                + '<span class="bl-topttl">UP主主页</span></div>'
                + '<div class="bl-emptybox"><b>这个 UP 主现在刷不到了</b><span>可能刚换了一批内容。</span>'
                + '<button class="bl-btn" data-act="back">返回</button></div>'
                + '</div>';
        }
        return '<div class="bl-page" data-page="space">'
            + '<div class="bl-top"><button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
            + '<span class="bl-topttl">' + this._esc(info.name) + '</span></div>'
            + '<div class="bl-spacehd">'
            + ' <div class="bl-avatar bl-avatar-lg">' + this._esc(this._face(info.name)) + '</div>'
            + ' <div class="bl-uinfo"><b>' + this._esc(info.name) + '</b>'
            + '  <span class="bl-sub">' + fmtCount(info.fans) + '粉丝 · ' + info.works.length + '个投稿</span>'
            + '  <span class="bl-sub">' + this._esc(info.sign || '') + '</span></div>'
            + ' <button class="bl-follow' + (info.followed ? ' on' : '') + '" data-act="follow" data-mid="' + this._esc(info.mid) + '">'
            + (info.followed ? '已关注' : '关注') + '</button>'
            + '</div>'
            + '<div class="bl-feed" data-scroll="space">' + info.works.map((e) => this._cardHtml(e)).join('') + '</div>'
            + '</div>';
    }

    /* ---------- 7. 动态页 ---------- */

    _dynamicHtml() {
        const d = this._data();
        const dyn = d.getDynamics();
        const items = dyn.items || [];
        const body = items.length
            ? items.map((e) => '<div class="bl-dynrow">'
                + '<div class="bl-dynhd"><b>' + this._esc(e.upName) + '</b><span>' + this._esc(e.pubText || '') + '发布</span></div>'
                + this._relRowHtml(e) + '</div>').join('')
            : '<div class="bl-emptybox"><b>关注的 UP 主还没更新</b>'
                + '<span>' + (dyn.followed.length ? '先去首页逛逛，看到喜欢的就关注。' : '你还没有关注任何 UP 主。') + '</span>'
                + '<button class="bl-btn" data-act="nav" data-nav="home">去首页</button></div>';
        return '<div class="bl-page" data-page="dynamic">'
            + '<div class="bl-top"><span class="bl-topttl">动态</span>'
            + '<button aria-label="消息" class="bl-iconbtn" data-act="message"><i class="' + ICON.message + '"></i></button></div>'
            + '<div class="bl-scroll" data-scroll="dynamic">' + body + '</div>'
            + '</div>';
    }

    /* ---------- 8. 消息页 ---------- */

    _messageHtml() {
        const d = this._data();
        const list = d.getMessages();
        const rows = list.length ? list.map((m) => {
            const act = m.bvid ? ' data-act="open" data-bvid="' + this._esc(m.bvid) + '"' : '';
            const tail = m.videoTitle ? '<span class="bl-sub">' + this._esc(m.videoTitle) + ' · ' + this._esc(m.timeText || '') + '</span>' : '';
            return '<div class="bl-msgrow"' + act + '>'
                + '<div class="bl-cmt-av">' + this._esc(this._face(m.user)) + '</div>'
                + '<div class="bl-msgmain"><b>' + this._esc(m.user) + (m.kind === 'reply' ? ' 回复了你' : '') + '</b>'
                + '<p>' + this._esc(m.text) + '</p>' + tail + '</div>'
                + '</div>';
        }).join('') : '<div class="bl-hint">还没有消息。</div>';
        return '<div class="bl-page" data-page="message">'
            + '<div class="bl-top"><button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
            + '<span class="bl-topttl">消息</span></div>'
            + '<div class="bl-scroll" data-scroll="message">' + rows + '</div>'
            + '</div>';
    }

    /* ---------- 9. 我的 ---------- */

    _mineHtml() {
        const d = this._data();
        const u = d.getUser();
        const st = d.stats();
        const pct = Math.max(0, Math.min(100, Math.round((st.exp / Math.max(1, st.expMax)) * 100)));
        const favs = d.getFavorites();
        const cells = [
            ['关注', st.following, 'dynamic', ''],
            ['历史', st.history, 'shelf', '历史'],
            ['收藏', st.favorites, 'shelf', '收藏'],
            ['稍后再看', st.watchLater, 'shelf', '稍后再看']
        ].map((c) => '<button class="bl-cellitem" data-act="' + (c[2] === 'shelf' ? 'shelf' : 'nav') + '"'
            + (c[2] === 'shelf' ? ' data-tab="' + this._esc(c[3]) + '"' : ' data-nav="dynamic"')
            + '><b>' + c[1] + '</b><span>' + this._esc(c[0]) + '</span></button>').join('');
        const favRows = favs.map((f) => '<div class="bl-favrow" data-act="shelf" data-tab="收藏" data-fid="' + this._esc(f.id) + '">'
            + '<i class="' + ICON.star + '"></i><b>' + this._esc(f.name) + '</b><span>' + f.count + '个视频</span></div>').join('');
        const form = this.favForm
            ? '<div class="bl-form"><input id="bl-fav-input" class="bl-input" maxlength="20" placeholder="给新收藏夹起个名字" />'
                + '<button class="bl-btn" data-act="fav-create">创建</button>'
                + '<button class="bl-btn bl-ghost" data-act="fav-cancel">取消</button></div>'
            : '';
        return '<div class="bl-page" data-page="mine">'
            + '<div class="bl-top"><button aria-label="回首页" class="bl-iconbtn" data-act="home"><i class="' + ICON.home + '"></i></button>'
            + '<span class="bl-topttl">我的</span><span class="bl-sp"></span></div>'
            + '<div class="bl-usercard">'
            + ' <div class="bl-avatar bl-avatar-lg">' + this._esc(this._face(u.name)) + '</div>'
            + ' <div class="bl-uinfo"><b>' + this._esc(u.name || '未设置昵称') + '</b>'
            + '  <span class="bl-lv">LV' + (u.level || 1) + '</span>'
            + '  <span class="bl-sub">' + this._esc(u.sign || '') + '</span></div>'
            + ' <div class="bl-coin"><i class="' + ICON.coin + '"></i><b>' + (st.coin || 0) + '</b><span>硬币</span></div>'
            + '</div>'
            + '<div class="bl-exprow"><div class="bl-expbar"><div class="bl-expfill" style="width:' + pct + '%"></div></div>'
            + '<span>' + st.exp + ' / ' + st.expMax + '</span></div>'
            + '<div class="bl-grid4">' + cells + '</div>'
            + '<div class="bl-panel"><div class="bl-panelhd"><b>我的收藏夹</b>'
            + '<button class="bl-mini" data-act="fav-new">新建</button></div>' + form + favRows + '</div>'
            + '<div class="bl-panel">'
            + (st.history ? '<div class="bl-cell" data-act="hist-clear">清空观看历史<span>' + st.history + '条</span></div>' : '')
            + '<div class="bl-cell bl-cell-static">内容全部本地生成 · 不联网<span>v4.160.0</span></div>'
            + '</div>'
            + '</div>';
    }

    /* ---------- 10. 历史 / 收藏 / 稍后再看 ---------- */

    _shelfHtml() {
        const d = this._data();
        const tabs = ['历史', '收藏', '稍后再看'];
        const seg = tabs.map((t) => '<button class="bl-segitem' + (t === this.shelfTab ? ' on' : '')
            + '" data-act="shelf-tab" data-tab="' + this._esc(t) + '">' + this._esc(t) + '</button>').join('');
        let body = '';
        if (this.shelfTab === '历史') {
            const rows = d.getHistory();
            body = rows.length
                ? '<div class="bl-panelhd"><b>观看记录</b><button class="bl-mini" data-act="hist-clear">清空</button></div>'
                    + rows.map((h) => '<div class="bl-histrow">'
                        + '<div class="bl-relthumb ' + this._tone(h.tone) + '"><span>' + this._esc(h.temoji) + '</span></div>'
                        + '<div class="bl-relmain" data-act="open" data-bvid="' + this._esc(h.bvid) + '"><b>' + this._esc(h.title) + '</b>'
                        + '<span class="bl-sub">看到 ' + this._fmtTime(h.pos) + ' · ' + this._esc(h.atText || '') + '</span></div>'
                        + '<button aria-label="从历史中删除" class="bl-iconbtn" data-act="hist-del" data-bvid="' + this._esc(h.bvid) + '">'
                        + '<i class="' + ICON.trash + '"></i></button>'
                        + '</div>').join('')
                : '<div class="bl-emptybox"><b>还没有观看记录</b><span>点开任意一个视频就会记在这里。</span></div>';
        } else if (this.shelfTab === '收藏') {
            const favs = d.getFavorites();
            /* 从「我的」点某一个收藏夹进来时只看那一夹；点错/夹子被删就退回全部。
             * 没有这层区分，点任何一个夹子看到的都是同一份合并列表（自检抓到的真缺陷）。 */
            const only = this.shelfFid ? favs.find((f) => f.id === this.shelfFid) : null;
            if (only) {
                body = '<div class="bl-panel"><div class="bl-panelhd"><b>' + this._esc(only.name) + '</b>'
                    + '<button class="bl-mini" data-act="fav-all">全部收藏夹</button></div>'
                    + (only.videos.length
                        ? only.videos.map((e) => this._relRowHtml(e)).join('')
                        : '<div class="bl-hint">这个收藏夹还是空的。</div>')
                    + '</div>';
            } else {
                const blocks = favs.map((f) => '<div class="bl-panel"><div class="bl-panelhd"><b>' + this._esc(f.name) + '</b>'
                    + '<span class="bl-sub">' + f.count + '个</span></div>'
                    + (f.videos.length ? f.videos.map((e) => this._relRowHtml(e)).join('') : '<div class="bl-hint">这个收藏夹还是空的。</div>')
                    + '</div>').join('');
                body = blocks || '<div class="bl-emptybox"><b>还没有收藏夹</b><span>在「我的」里可以新建。</span></div>';
            }
        } else {
            const list = d.getWatchLater();
            body = list.length
                ? list.map((e) => this._relRowHtml(e)).join('')
                : '<div class="bl-emptybox"><b>稍后再看是空的</b><span>在播放页点「稍后看」就会加进来。</span></div>';
        }
        return '<div class="bl-page" data-page="shelf">'
            + '<div class="bl-top"><button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
            + '<span class="bl-topttl">我的收藏与历史</span></div>'
            + '<div class="bl-seg">' + seg + '</div>'
            + '<div class="bl-scroll" data-scroll="shelf">' + body + '</div>'
            + '</div>';
    }

    /* ---------- 11. 创作中心（如实空态） ---------- */

    _publishHtml() {
        return '<div class="bl-page" data-page="publish">'
            + '<div class="bl-top"><button aria-label="返回" class="bl-iconbtn" data-act="back"><i class="' + ICON.back + '"></i></button>'
            + '<span class="bl-topttl">创作中心</span></div>'
            + '<div class="bl-scroll" data-scroll="publish">'
            + ' <div class="bl-grid4">'
            + '  <div class="bl-cellitem bl-cell-static"><b>0</b><span>稿件</span></div>'
            + '  <div class="bl-cellitem bl-cell-static"><b>0</b><span>播放</span></div>'
            + '  <div class="bl-cellitem bl-cell-static"><b>0</b><span>粉丝</span></div>'
            + '  <div class="bl-cellitem bl-cell-static"><b>0</b><span>收益</span></div>'
            + ' </div>'
            + ' <div class="bl-emptybox"><b>你还没有投稿</b>'
            + '  <span>现实里的投稿在网页端 / 创作中心完成。这里只如实显示本地账号的稿件数，不做假上传。</span></div>'
            + '</div></div>';
    }

    /* ---------- 12. 交互路由 ---------- */

    _handleClick(ev) {
        try {
            const t = ev && ev.target;
            if (!t || typeof t.closest !== 'function') return;
            const el = t.closest('[data-act]');
            if (!el) return;
            /* 进度条要用点击位置算比例：坐标在事件里，`_act` 只拿到元素，
             * 所以在这里先记下来（夹具没有 clientX 时记 NaN，点不动就如实说）。 */
            this._clickX = (ev && typeof ev.clientX === 'number') ? ev.clientX : NaN;
            this._act(this._attr(el, 'act'), el);
        } catch (err) {
            console.warn('[BiliView]点击处理失败:', err && err.message);
        }
    }

    _handleKey(ev) {
        try {
            const key = ev && ev.key;
            if (key !== 'Enter') return;
            const t = ev && ev.target;
            if (!t) return;
            const tag = t.tagName ? String(t.tagName).toUpperCase() : '';
            if (tag === 'INPUT') {
                /* 输入框里的回车按「所属表单」提交，而不是触发外层卡片的打开。 */
                const id = t.id || (t.getAttribute ? t.getAttribute('id') : '') || '';
                if (id === 'bl-q') this._act('search-go', t);
                else if (id === 'bl-cmt-input') this._act('cmt-send', t);
                else if (id === 'bl-dm-input') this._act('dm-send', t);
                else if (id === 'bl-fav-input') this._act('fav-create', t);
                return;
            }
            if (typeof t.closest !== 'function') return;
            const el = t.closest('[data-act]');
            if (!el) return;
            this._act(this._attr(el, 'act'), el);
        } catch (err) {
            console.warn('[BiliView]按键处理失败:', err && err.message);
        }
    }

    _handleInput(ev) {
        try {
            const t = ev && ev.target;
            if (!t || !t.id) return;
            if (t.id === 'bl-q') this.searchKw = String(t.value == null ? '' : t.value);
        } catch (_e) { /* 输入只做记忆，不重绘 */ }
    }

    _act(act, el) {
        const d = this._data();
        if (!d) return;
        switch (act) {
            case 'back': this._back(); return;
            case 'home': this._goHome(); return;
            case 'nav': this._go(this._attr(el, 'nav')); return;
            case 'search': this._openSearch(); return;
            case 'message': this._go('message'); return;
            case 'tab': {
                const t = this._attr(el, 'tab');
                if (!t || t === this.tab) return;
                this.tab = t;
                try { d.setTab(t); } catch (_e) { /* 存档失败不影响本次浏览 */ }
                this._paint();
                return;
            }
            case 'refresh': this._refresh(); return;
            case 'space': {
                const mid = this._attr(el, 'mid');
                if (!mid) return;
                this.spaceMid = mid;
                this._go('space');
                return;
            }
            case 'open': this._openVideo(this._attr(el, 'bvid')); return;
            case 'toggle': this._togglePlay(); return;
            case 'seek': this._seekTo(el); return;
            case 'like': this._toggleLike(this._attr(el, 'bvid')); return;
            case 'coin': this._toggleCoin(this._attr(el, 'bvid')); return;
            case 'fav': this._toggleFav(this._attr(el, 'bvid')); return;
            case 'later': this._toggleLater(this._attr(el, 'bvid')); return;
            case 'share': this.shareSheet = true; this._paint(); return;
            case 'share-close': this.shareSheet = false; this._paint(); return;
            case 'share-copy': this._copy(this._attr(el, 'url')); return;
            case 'follow': this._toggleFollow(this._attr(el, 'mid')); return;
            case 'dm-send': this._sendDanmaku(); return;
            case 'cmt-send': this._sendComment(); return;
            case 'cmt-like': this._likeComment(this._attr(el, 'cid')); return;
            case 'cmt-reply': {
                this.replyTo = this._attr(el, 'cid');
                this.replyUser = this._attr(el, 'user');
                this._paint();
                return;
            }
            case 'cmt-cancel': this.replyTo = ''; this.replyUser = ''; this._paint(); return;
            case 'cmt-expand': {
                const cid = this._attr(el, 'cid');
                const bvid = this.video ? this.video.bvid : '';
                const key = bvid + ':' + cid;
                if (this.expanded.indexOf(key) < 0) this.expanded.push(key);
                this._patchComments();
                return;
            }
            case 'search-go': this._doSearch(this._inputValue('#bl-q', this.searchKw)); return;
            case 'hot': this._doSearch(this._attr(el, 'kw')); return;
            case 'hist-clear-q': d.clearSearchHistory(); this._paint(); return;
            case 'hist-del': {
                const bvid = this._attr(el, 'bvid');
                if (bvid) d.removeHistory(bvid);
                this._paint();
                return;
            }
            case 'hist-clear': d.clearHistory(); this._paint(); return;
            case 'shelf': {
                this.shelfTab = this._attr(el, 'tab') || '历史';
                this.shelfFid = this._attr(el, 'fid');
                this._go('shelf');
                return;
            }
            case 'shelf-tab': {
                const t = this._attr(el, 'tab');
                if (!t || t === this.shelfTab) return;
                this.shelfTab = t;
                this.shelfFid = '';
                this._paint();
                return;
            }
            case 'fav-all': this.shelfFid = ''; this._paint(); return;
            case 'fav-new': this.favForm = true; this._paint(); return;
            case 'fav-cancel': this.favForm = false; this._paint(); return;
            case 'fav-create': {
                const name = this._inputValue('#bl-fav-input', '');
                const fav = d.createFavorite(name);
                if (!fav) { this._toast('名字不能为空，也不能和已有的重复'); return; }
                this.favForm = false;
                this._toast('已创建「' + fav.name + '」');
                this._paint();
                return;
            }
            default: return;
        }
    }

    _inputValue(sel, fallback) {
        const el = this._q(sel);
        if (el && typeof el.value === 'string') return el.value;
        return fallback == null ? '' : fallback;
    }

    _go(page) {
        const p = String(page || '');
        if (!p) return;
        this._leaveVideo();
        if (p === 'home') { this._goHome(); return; }
        if (this.page !== p) this.stack.push(this.page);
        this.page = p;
        this.shareSheet = false;
        this._stopTick();
        this._paint();
    }

    _openSearch() {
        this._leaveVideo();
        if (this.page !== 'search') this.stack.push(this.page);
        this.page = 'search';
        this.searchResult = null;
        this.shareSheet = false;
        this._stopTick();
        this._paint();
    }

    _goHome() {
        this._leaveVideo();
        this.stack = [];
        this.page = 'home';
        this.video = null;
        this.shareSheet = false;
        this.shelfFid = '';
        this._stopTick();
        this._paint();
    }

    _back() {
        if (this.page === 'video') this._leaveVideo();
        if (!this.stack.length) {
            /* 已经在首页：返回键的语义就是「退出 App 回桌面」。
             * 这里如实派发宿主的 goHome 事件 —— 不自己抹掉图层（那是外壳的事）。 */
            this._dispatchHome();
            return;
        }
        const prev = this.stack.pop();
        this.page = prev || 'home';
        this.video = null;
        this.shareSheet = false;
        this._stopTick();
        this._paint();
    }

    _dispatchHome() {
        try {
            const w = (typeof window !== 'undefined' && window) ? window : null;
            if (!w || typeof w.dispatchEvent !== 'function') return;
            const CE = w.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
            if (!CE) return;
            w.dispatchEvent(new CE('phone:goHome'));
        } catch (_e) { /* 宿主没有这个事件：忽略 */ }
    }

    /* ---------- 13. 内容动作 ---------- */

    _refresh() {
        const d = this._data();
        const q = this.searchKw || d.query || '';
        const payload = d.refresh(q);
        this.searchResult = null;
        this._toast('换了一批（' + ((payload && payload.entries) ? payload.entries.length : 0) + ' 条）');
        this._paint();
    }

    _openVideo(bvid) {
        const d = this._data();
        const key = String(bvid || '');
        if (!key) return;
        const e = d.getEntry(key);
        if (!e) { this._toast('这条内容已经不在了'); return; }
        if (this.page === 'video' && this.video) this._leaveVideo();
        const hist = (d.getUser().history || []).find((h) => h && h.bvid === key);
        const dur = Math.max(1, e.duration || 1);
        const pos = hist ? Math.max(0, Math.min(dur, hist.pos || 0)) : 0;
        this.stack.push(this.page);
        this.page = 'video';
        this.video = { bvid: key, pos, playing: true };
        this.replyTo = '';
        this.replyUser = '';
        this.shareSheet = false;
        this.expanded = [];
        try { d.addHistory(key, pos); } catch (_e) { /* 记录失败不拦着看 */ }
        this._paint();
    }

    /** 离开播放页时把进度落一次盘（每秒写一次会把存储打爆）。 */
    _leaveVideo() {
        if (this.page !== 'video' || !this.video) return;
        const d = this._data();
        const bvid = this.video.bvid;
        const pos = Math.max(0, Math.round(this.video.pos || 0));
        try { d.addHistory(bvid, pos); } catch (_e) { /* 同上 */ }
        this._stopTick();
    }

    _togglePlay() {
        if (!this.video) return;
        this.video.playing = !this.video.playing;
        this._patchPlayer();
        this._startTickIfNeeded();
        if (!this.video.playing) {
            const d = this._data();
            try { d.addHistory(this.video.bvid, this.video.pos || 0); } catch (_e) { /* 忽略 */ }
        }
    }

    _seekTo(bar) {
        if (!this.video) return;
        const d = this._data();
        const e = d.getEntry(this.video.bvid);
        if (!e) return;
        const rect = bar && typeof bar.getBoundingClientRect === 'function' ? bar.getBoundingClientRect() : null;
        const width = rect && rect.width ? rect.width : 0;
        const left = rect && typeof rect.left === 'number' ? rect.left : 0;
        if (!width) { this._toast('这个环境点不了进度条'); return; }
        const cx = this._clickX;
        if (typeof cx !== 'number' || !Number.isFinite(cx)) { this._toast('没拿到点击位置，拖不动进度'); return; }
        const x = Math.max(0, Math.min(width, cx - left));
        const dur = Math.max(1, e.duration || 1);
        this.video.pos = Math.round((x / width) * dur);
        this._patchPlayer();
        try { d.addHistory(e.bvid, this.video.pos); } catch (_e) { /* 忽略 */ }
    }

    _toggleLike(bvid) {
        const d = this._data();
        const r = d.toggleLike(bvid);
        if (!r) return;
        this._patchActs();
    }

    _toggleCoin(bvid) {
        const d = this._data();
        const r = d.toggleCoin(bvid);
        if (!r) return;
        if (r.ok === false) {
            this._toast(r.reason === 'no-coin' ? '硬币不够了。每天登录会送 2 枚' : '这一条投不了币');
            return;
        }
        this._toast(r.on ? '投了 1 枚硬币，经验 +10' : '已收回硬币');
        this._patchActs();
    }

    _toggleFav(bvid) {
        const d = this._data();
        const r = d.toggleFav(bvid);
        if (!r) return;
        this._toast(r.on ? ('已收藏到「' + r.favoriteName + '」') : '已取消收藏');
        this._patchActs();
    }

    _toggleLater(bvid) {
        const d = this._data();
        const r = d.toggleWatchLater(bvid);
        if (!r) return;
        this._toast(r.on ? '已加入稍后再看' : '已移出稍后再看');
        this._patchActs();
    }

    _toggleFollow(mid) {
        const d = this._data();
        const r = d.toggleFollow(mid);
        if (!r) return;
        this._toast(r.on ? ('已关注 ' + r.name) : ('已取消关注 ' + r.name));
        this._paint();
    }

    _sendDanmaku() {
        if (!this.video) return;
        const d = this._data();
        const text = this._inputValue('#bl-dm-input', '');
        const dm = d.addDanmaku(this.video.bvid, text);
        if (!dm) { this._toast('弹幕不能为空'); return; }
        const input = this._q('#bl-dm-input');
        if (input) input.value = '';
        const layer = this._q('.bl-dmlayer');
        const doc = this._doc();
        if (layer && doc && typeof doc.createElement === 'function') {
            const el = doc.createElement('span');
            el.className = 'bl-dm bl-dm-self';
            el.textContent = dm.text;
            el.setAttribute('style', '--dm-top:' + (10 + (Math.abs(dm.text.length * 7) % 60)) + '%;--dm-delay:0s');
            if (layer.appendChild) layer.appendChild(el);
        }
        this._toast('弹幕已发送');
    }

    _sendComment() {
        if (!this.video) return;
        const d = this._data();
        const text = this._inputValue('#bl-cmt-input', '');
        const c = d.addComment(this.video.bvid, text, this.replyTo);
        if (!c) { this._toast('评论不能为空'); return; }
        this.replyTo = '';
        this.replyUser = '';
        const input = this._q('#bl-cmt-input');
        if (input) input.value = '';
        this._toast('评论已发布');
        this._patchComments();
    }

    _likeComment(cid) {
        if (!this.video) return;
        const d = this._data();
        const r = d.likeComment(this.video.bvid, cid);
        if (!r) return;
        this._patchComments();
    }

    _doSearch(raw) {
        const d = this._data();
        const kw = String(raw == null ? '' : raw).trim().slice(0, 24);
        if (!kw) { this._toast('先输入要搜的内容'); return; }
        try { d.addSearchHistory(kw); } catch (_e) { /* 忽略 */ }
        this.searchKw = kw;
        this.searchResult = { kw, items: d.search(kw) };
        this._paint();
    }

    /* ---------- 14. 局部刷新（不重绘整屏） ---------- */

    _patchActs() {
        if (!this.video) return;
        const d = this._data();
        const e = d.getEntry(this.video.bvid);
        const el = this._q('#bl-acts');
        if (!e || !el) { this._paint(); return; }
        el.innerHTML = this._actsHtml(e);
    }

    _patchComments() {
        if (!this.video) return;
        const d = this._data();
        const e = d.getEntry(this.video.bvid);
        const el = this._q('#bl-cmts');
        if (!e || !el) { this._paint(); return; }
        el.innerHTML = this._commentsHtml(e);
    }

    _patchPlayer() {
        const player = this._q('#bl-player');
        if (player && player.classList) {
            player.classList.toggle('playing', Boolean(this.video && this.video.playing));
            player.classList.toggle('paused', !(this.video && this.video.playing));
        }
        const icon = this._q('#bl-toggle i');
        if (icon && icon.className !== undefined) {
            icon.className = (this.video && this.video.playing) ? ICON.pause : ICON.play;
        }
        this._patchProgress();
    }

    _patchProgress() {
        if (!this.video) return;
        const d = this._data();
        const e = d.getEntry(this.video.bvid);
        if (!e) return;
        const dur = Math.max(1, e.duration || 1);
        const pos = Math.max(0, Math.min(dur, this.video.pos || 0));
        const fill = this._q('#bl-barfill');
        if (fill && fill.style) fill.style.width = (Math.round((pos / dur) * 1000) / 10) + '%';
        const txt = this._q('#bl-ptime');
        if (txt) txt.textContent = this._fmtTime(pos) + ' / ' + this._fmtTime(dur);
    }

    _startTickIfNeeded() {
        this._stopTick();
        if (this.page !== 'video' || !this.video || !this.video.playing) return;
        const d = this._data();
        const e = d.getEntry(this.video.bvid);
        if (!e || e.live) return;
        const dur = Math.max(1, e.duration || 1);
        this._tick = setInterval(() => {
            if (!this.video || this.page !== 'video') { this._stopTick(); return; }
            /* 图层被移除（离开 App / 外壳重建）时必须自己停：没人会来调 destroy()。
             * `isConnected` 只在真 DOM 上有；夹具没有这个属性时按「还在」处理。 */
            const c = this.container;
            if (typeof (c && c.isConnected) === 'boolean' && !c.isConnected) { this._stopTick(); return; }
            this.video.pos = Math.min(dur, (this.video.pos || 0) + 1);
            this._patchProgress();
            if (this.video.pos >= dur) {
                this.video.playing = false;
                this._stopTick();
                this._patchPlayer();
            }
        }, 1000);
    }

    _stopTick() {
        if (this._tick) {
            clearInterval(this._tick);
            this._tick = null;
        }
    }

    /* ---------- 15. 提示与剪贴板 ---------- */

    _doc() {
        const c = this.container;
        if (c && c.ownerDocument) return c.ownerDocument;
        return (typeof document !== 'undefined') ? document : null;
    }

    _toast(msg) {
        const c = this.container;
        const doc = this._doc();
        if (!c || !doc || typeof doc.createElement !== 'function') return;
        try {
            const old = this._q('.bl-toast');
            if (old && old.remove) old.remove();
            const el = doc.createElement('div');
            el.className = 'bl-toast';
            el.textContent = String(msg == null ? '' : msg);
            if (c.appendChild) c.appendChild(el);
            if (this._toastTimer) clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                this._toastTimer = null;
                try { if (el.remove) el.remove(); } catch (_e) { /* 已经不在树上 */ }
            }, 1800);
        } catch (_e) { /* 提示不是功能，画不出来就算了 */ }
    }

    /**
     * 复制链接。剪贴板被环境禁用时**如实说**（不假装成功），
     * 面板里的链接本身就选中得了，用户还能手动复制。
     */
    _copy(text) {
        const s = String(text == null ? '' : text);
        if (!s) return;
        try {
            const nav = (typeof navigator !== 'undefined') ? navigator : null;
            if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
                const p = nav.clipboard.writeText(s);
                if (p && typeof p.then === 'function') {
                    p.then(() => this._toast('链接已复制')).catch(() => this._toast('这个环境不让复制，链接在面板里可以直接选中'));
                    return;
                }
                this._toast('链接已复制');
                return;
            }
        } catch (_e) { /* 落到下面的如实提示 */ }
        this._toast('这个环境不支持复制，链接在面板里可以直接选中');
    }
}

export default BiliView;
