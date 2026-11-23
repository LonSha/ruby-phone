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
 * apps/tieba/tieba-view.js — 贴吧视图层（v4.161.0）
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
        c.innerHTML = `<div class="tb-app" data-page="${esc(this.page)}">`
            + this._appbarHtml()
            + `<div class="tb-scroll" data-role="scroll">${this._bodyHtml()}</div>`
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
        const title = this.page === 'search'
            ? '搜索贴吧'
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
        return this._homeHtml();
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
            case 'compose': return this._openCompose();
            case 'compose-close': return this._closeCompose();
            case 'compose-send': return this._sendPost();
            case 'reply-send': return this._sendReply(this._attr(el, 'post'));
            default: return null;
        }
    }

    _back() {
        if (this.page === 'detail' || this.page === 'search') {
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
