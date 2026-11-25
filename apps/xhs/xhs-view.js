/**
 * 小红书 (XHS App) — 视图
 * [v4.166.0]「照现实重写」：一页到底 → 三页签（发现 / 消息 / 我）
 * ------------------------------------------------------------
 * 上一版已经是真窗口（首屏切片 + 滚到底增量 + 点赞只改那一张卡），但**只有一页**：
 *   头部的「发现 / 关注 / 江城」三颗是死标签，点击没接；评论只能从详情里看；
 *   自己发的笔记散在瀑布流里，没有任何入口能「只看我发的」。
 * 现实里的小红书是四块：发现（瀑布流）→ 消息（谁评论了你）→ 我（我的笔记与发布）。
 *   本版把这三块真的分页：底部三颗页签，切换时重建对应页；瀑布流那套窗口机制
 *   （windowOf / patchOf / _maybeLoadMore / _patchLike / _cardHtml 单一真源）**一行未改**。
 */

import { windowOf, patchOf, keepState, line as windowLine } from '../../config/list-window.js';
import { numeralText } from '../../config/num-face.js';

const TABS = [
  { key: 'feed', label: '发现' },
  { key: 'messages', label: '消息' },
  { key: 'me', label: '我' },
];

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const DASH = String.fromCharCode(45, 45);

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .split(AMP).join(AMP + 'amp;')
    .split(LT).join(AMP + 'lt;')
    .split(GT).join(AMP + 'gt;')
    .split(QUOTE).join(AMP + 'quot;');
}

export class XhsView {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.tab = 'feed';
    /* [v3.98.0 - R3-O5] 窗口状态（本会话内有效；不落盘 —— 它只是「本次看多少」的游标） */
    this._loaded = 0;
    this._pageSize = 30;
    this._viewIds = [];
    this._lastPatch = null;
    this._lastWindow = null;
  }
  /** [v3.98.0 - R3-O5] 诊断一行：现在加载到哪、上一步是不是只改了那几张卡。 */
  windowLine() { return windowLine(this._lastWindow); }
  /** [v3.98.0 - R3-O5] 态保留读数（滚动 / 已加载窗口 / 当前页签）。 */
  keepReading(before, after) { return keepState(before, after); }

  /* ---------- 1. 外壳与三页 ---------- */

  render(container) {
    this.container = container;
    container.innerHTML = this._shell();
    this._bindHeaderEvents();
    this._bindTabs();
    if (this.tab === 'feed') {
      this._loaded = 0;                 /* [v3.98.0 - R3-O5] 每次进页从首屏窗口起 */
      this._renderMasonry();
      this._bindScroll(this.container); /* 滚到底增量追加（不是一次性建满 DOM） */
    }
  }

  _shell() {
    const feed = this.tab === 'feed';
    const body = feed
      ? `<main class="xhs-body">
          <div class="xhs-masonry" id="xhs-masonry">
            <!-- 笔记卡片动态流 -->
          </div>
        </main>`
      : (this.tab === 'messages' ? this._messagesHTML() : this._meHTML());
    const detail = feed
      ? `<div class="xhs-detail-modal" id="xhs-detail-modal" data-open="0">
          <div class="xhs-modal-overlay"></div>
          <div class="xhs-modal-card" id="xhs-modal-card"></div>
        </div>`
      : '';
    const compose = `<div class="xhs-compose-drawer" id="xhs-compose-drawer" data-open="0">
          <div class="xhs-drawer-overlay"></div>
          <div class="xhs-drawer-content">
            <div class="xhs-drawer-header">
              <button aria-label="关闭" class="xhs-drawer-close" id="xhs-compose-close"><i class="fa-solid fa-xmark"></i></button>
              <h3>发布小红书笔记</h3>
              <button class="xhs-drawer-publish" id="xhs-submit-post">发布</button>
            </div>
            <div class="xhs-drawer-body">
              <input type="text" class="xhs-input-title" id="xhs-new-title" placeholder="填写标题会有更多赞哦～" />
              <textarea class="xhs-input-desc" id="xhs-new-content" placeholder="添加正文... 分享你的日常心情与生活细节"></textarea>
              <input type="text" class="xhs-input-cover" id="xhs-new-cover" placeholder="封面图片 URL (可选)" />
              <input type="text" class="xhs-input-tags" id="xhs-new-tags" placeholder="标签以空格隔开，如: 日常 美食 恋爱" />
            </div>
          </div>
        </div>`;
    /* [v4.202.0 · 照现实] 官方小红书 9.55 的底栏是**五格**：
     *   首页 / 购物 / ＋ / 消息 / 我 —— 中间那个「＋」是凸起的圆形发布键，
     *   不是页头右上角的一颗小加号。旧实现把发布放在页头、底栏只有三格，
     *   与官方结构差两层（格数 + 发布键位置）。
     *   这里把「＋」原样搬到底栏正中：左右各两格，中间独立成一个 flex 单元。
     *   `data-tab` 只给真正的页签；「＋」用 `data-act="xhs-compose"`，不混入页签语义。 */
    const tabs = TABS.map((t, i) => {
      const btn = `<button class="xhs-nav${this.tab === t.key ? ' is-on' : ''}" data-tab="${t.key}">${t.label}</button>`;
      /* 「购物」在本仓没有对应实现：照官方**位置与文案**列出，但明确 disabled，点了给一句提示。 */
      if (i === 0) return btn + '<button class="xhs-nav is-disabled" data-act="xhs-soon" data-what="购物" aria-disabled="true">购物</button>';
      if (i === 1) return '<button class="xhs-nav-pub" data-act="xhs-compose" aria-label="发布笔记"><i class="fa-solid fa-plus"></i></button>' + btn;
      return btn;
    }).join('');
    return `
      <div class="xhs-root">
        <header class="xhs-header">
          <button aria-label="返回" class="xhs-back-btn" id="xhs-back-btn"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="xhs-header-title">${this.tab === 'messages' ? '消息' : (this.tab === 'me' ? '我' : '发现')}</div>
          <button class="xhs-post-btn" id="xhs-open-compose-btn" title="发布新笔记"><i class="fa-solid fa-plus"></i></button>
        </header>
        ${body}
        ${detail}
        ${compose}
        <nav class="xhs-navbar">${tabs}</nav>
      </div>
    `;
  }

  _messagesHTML() {
    const notes = this._notes();
    const rows = [];
    for (const n of notes) {
      for (const c of (Array.isArray(n.comments) ? n.comments : [])) {
        rows.push({ who: c.author || '有人', text: c.text || '', note: n.title || '无题笔记', time: c.time || DASH, id: n.id });
      }
    }
    const parts = ['<main class="xhs-body xhs-list">'];
    if (!rows.length) {
      parts.push('<div class="xhs-empty"><p>还没有人评论你的笔记 —— 空着就空着，不编一条通知出来。</p></div></main>');
      return parts.join('');
    }
    parts.push(`<div class="xhs-list-head">共 ${numeralText(rows.length)} 条评论</div>`);
    for (const r of rows.slice(0, 40)) {
      parts.push(`<button class="xhs-msg" data-jump="${esc(r.id)}">
          <span class="xhs-msg-who">${esc(r.who)}</span>
          <span class="xhs-msg-text">${esc(r.text)}</span>
          <span class="xhs-msg-meta">在《${esc(r.note)}》· ${esc(r.time)}</span>
        </button>`);
    }
    parts.push('</main>');
    return parts.join('');
  }

  _meHTML() {
    const notes = this._notes();
    const mine = notes.filter((n) => (n.author || '') === '我');
    const likes = notes.reduce((s, n) => s + (Number(n.likes) || 0), 0);
    const parts = ['<main class="xhs-body xhs-list">'];
    parts.push(`<div class="xhs-me-card">
        <div class="xhs-me-name">我</div>
        <div class="xhs-me-stats">
          <span><b>${numeralText(mine.length)}</b> 篇笔记</span>
          <span><b>${numeralText(likes)}</b> 次获赞</span>
        </div>
        <button class="xhs-me-post" id="xhs-me-compose">发一篇</button>
      </div>`);
    if (!mine.length) {
      parts.push('<div class="xhs-empty"><p>你还没发过笔记。发一篇就会出现在「发现」的最上面。</p></div></main>');
      return parts.join('');
    }
    parts.push(`<div class="xhs-list-head">我的笔记 · ${numeralText(mine.length)} 篇</div>`);
    for (const n of mine) {
      parts.push(`<button class="xhs-mine" data-jump="${esc(n.id)}">
          <span class="xhs-mine-title">${esc(n.title)}</span>
          <span class="xhs-mine-meta">${numeralText(Number(n.likes) || 0)} 赞 · ${numeralText((n.comments || []).length)} 评论</span>
        </button>`);
    }
    parts.push('</main>');
    return parts.join('');
  }

  _notes() {
    try {
      const list = this.app.data.getNotes();
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  /** 页签切换：只换页，不重置数据；发现页切回来时窗口从首屏重新起。 */
  _bindTabs() {
    if (!this.container || typeof this.container.querySelectorAll !== 'function') return;
    this.container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.tab;
        if (!TABS.some((t) => t.key === key) || key === this.tab) return;
        this.tab = key;
        this.render(this.container);
      });
    });
    if (typeof this.container.querySelectorAll === 'function') {
      this.container.querySelectorAll('[data-jump]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.jump;
          this.tab = 'feed';
          this.render(this.container);
          this._openDetail(id);
        });
      });
    }
    const mePost = this.container.querySelector('#xhs-me-compose');
    if (mePost) mePost.addEventListener('click', () => this._openCompose());
    /* [v4.202.0] 底栏中央「＋」与「购物」：
     *   · ＋ 走与页头那颗**同一个** _openCompose()（单一入口，不另写一份打开逻辑）；
     *   · 购物在本仓无实现，点击必须给一句真话，不能静默无反应 ——
     *     静默会被当成「按钮坏了」，排查成本比一句提示高得多。 */
    this.container.querySelectorAll('[data-act="xhs-compose"]').forEach((btn) => {
      btn.addEventListener('click', () => this._openCompose());
    });
    this.container.querySelectorAll('[data-act="xhs-soon"]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const what = btn.dataset.what || '该入口';
        try {
          if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert('「' + what + '」本机未实现。');
          }
        } catch (_e) { /* 宿主无 alert 时不制造新崩溃 */ }
      });
    });
  }

  _openCompose() {
    const drawer = this.container.querySelector('#xhs-compose-drawer');
    if (drawer) this._setOpen(drawer, true);
  }

  /** 开合走 dataset 状态 + 类名（不写行内 style：内联样式是上一轮被点名的形态）。 */
  _setOpen(el, on) {
    if (!el) return;
    if (el.dataset) el.dataset.open = on ? '1' : '0';
    const cls = String(el.className || '').replace(/\s*is-open/g, '');
    el.className = cls + (on ? ' is-open' : '');
  }

  /* ---------- 2. 瀑布流（窗口 + 局部更新；本段是 v3.98.0 交付物，本版一字未改） ---------- */

  /** [v3.98.0 · R3-O5] 单张卡片的 HTML（**唯一真源**：首屏、追加、局部更新三处共用一份）。 */
  _cardHtml(n) {
    return `
      <div class="xhs-card" data-id="${n.id}">
        <div class="xhs-card-cover-wrap">
          <img class="xhs-card-cover" src="${n.cover || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&q=80'}" loading="lazy" />
        </div>
        <div class="xhs-card-info">
          <h4 class="xhs-card-title">${esc(n.title)}</h4>
          <div class="xhs-card-author-row">
            <div class="xhs-author-group">
              <img class="xhs-author-avatar" src="${n.avatar || 'https://files.catbox.moe/r08d2g.jpg'}" />
              <span class="xhs-author-name">${esc(n.author)}</span>
            </div>
            <div class="xhs-like-badge ${n.isLiked ? 'liked' : ''}" data-like-id="${n.id}">
              <i class="${n.isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
              <span>${numeralText(Number(n.likes) || 0)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  /** [v3.98.0 · R3-O5] 条目视图（只取会影响渲染的字段 —— 拿整条笔记比，会让「评论数变了」这种不影响卡片的改动也判成「这张卡变了」）。 */
  _cardViews(notes) {
    return notes.map(n => ({
      id: n.id, title: n.title, author: n.author,
      likes: n.likes, isLiked: !!n.isLiked,
      cover: n.cover || '', avatar: n.avatar || ''
    }));
  }
  /** 绑定**一张**卡的事件（局部更新时不必全列重绑）。 */
  _bindCard(card) {
    if (!card || card.__xhsBound) return;
    card.__xhsBound = true;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.xhs-like-badge')) return;
      this._openDetail(card.dataset.id);
    });
    const badge = card.querySelector('.xhs-like-badge');
    if (badge) {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = badge.dataset.likeId;
        this.app.data.toggleLike(id);
        this._patchLike(id);
      });
    }
  }
  /**
   * [v3.98.0 · R3-O5] 点赞的**局部更新**：只改那一条，不重建整列。
   *   修前 `_renderMasonry()` 整列重建 ⇒ 滚动位置自然丢；本函数的契约是只碰一张卡。
   *   找不到那张卡时**如实退回**整列渲染（不假装局部成功）。
   * @returns {boolean} 是否真的走了局部路径
   */
  _patchLike(id) {
    const grid = this.container && this.container.querySelector('#xhs-masonry');
    if (!grid) return false;
    const note = this.app.data.getNoteById(id);
    const card = grid.querySelector('.xhs-card[data-id="' + id + '"]');
    if (!note || !card) { this._renderMasonry(); return false; }
    const wrap = document.createElement('div');
    wrap.innerHTML = this._cardHtml(note);
    const next = wrap.firstElementChild;
    card.replaceWith(next);
    this._bindCard(next);
    return true;
  }
  /** [v3.98.0 · R3-O5] 滚到底追加下一页（**增量**：只 append 新段，不动已有卡）。 */
  _maybeLoadMore() {
    const grid = this.container && this.container.querySelector('#xhs-masonry');
    if (!grid) return false;
    const notes = this.app.data.getNotes();
    if (this._loaded >= notes.length) return false;
    const w = windowOf(notes, { loaded: this._loaded, pageSize: this._pageSize });
    this._lastWindow = w;
    const beforeViews = this._cardViews(notes.slice(0, this._loaded));
    const afterViews = this._cardViews(w.items);
    this._lastPatch = patchOf(beforeViews, afterViews);
    this._loaded = w.loaded;
    for (const n of w.added) {
      const tmp = document.createElement('div');
      tmp.innerHTML = this._cardHtml(n);
      const card = tmp.firstElementChild;
      grid.appendChild(card);
      this._bindCard(card);
    }
    this._viewIds = w.items.map(n => String(n.id));
    this._updateMoreHint(grid, w);
    return true;
  }
  /** 页尾提示（**「还有」与「到底了」不同形**；不渲染假控件）。 */
  _updateMoreHint(grid, w) {
    const old = grid.querySelector('.xhs-more-hint');
    if (old) old.remove();
    const hint = document.createElement('div');
    hint.className = 'xhs-more-hint';
    hint.dataset.state = w.hasMore ? 'has-more' : 'exhausted';
    hint.textContent = w.hasMore ? ('继续下滑加载（已 ' + w.loaded + '/' + w.total + '）') : '已经到底啦';
    grid.appendChild(hint);
  }
  /**
   * 渲染瀑布流（**窗口**：默认只渲染前 `_loaded + pageSize` 条，不再一次性建满）。
   *   `opts.forceAll` 是给「需要看全量」的调用方用的开关（发布后确认新条目在位）。
   *   自适应路径：顺序不变、无增删、只有若干条字段变了 ⇒ **只改那几张卡**。
   */
  _renderMasonry(opts) {
    const grid = this.container.querySelector('#xhs-masonry');
    if (!grid) return;
    const notes = this.app.data.getNotes();
    if (notes.length === 0) {
      grid.innerHTML = '<div class="xhs-empty"><p>还没有笔记，点击右上角「+」发布第一篇吧！</p></div>';
      this._loaded = 0;
      this._viewIds = [];
      return;
    }
    const o = (opts && typeof opts === 'object') ? opts : {};
    const w = windowOf(notes, { loaded: o.forceAll ? notes.length : this._loaded, pageSize: this._pageSize });
    this._lastWindow = w;
    this._loaded = w.loaded;
    const shown = o.forceAll ? notes : w.items;
    const patch = patchOf(this._cardViews(notes.slice(0, Math.max(0, shown.length - w.added.length))), this._cardViews(shown));
    this._lastPatch = patch;
    if (!patch.structural && patch.changed.length) {
      let allPatched = true;
      for (const ch of patch.changed) {
        const card = grid.querySelector('.xhs-card[data-id="' + ch.id + '"]');
        const note = this.app.data.getNoteById(ch.id);
        if (!card || !note) { allPatched = false; break; }
        const tmp = document.createElement('div');
        tmp.innerHTML = this._cardHtml(note);
        const next = tmp.firstElementChild;
        card.replaceWith(next);
        this._bindCard(next);
      }
      if (allPatched) {
        this._viewIds = shown.map(n => String(n.id));
        this._updateMoreHint(grid, w);
        return;
      }
    }
    grid.innerHTML = shown.map(n => this._cardHtml(n)).join('');
    grid.querySelectorAll('.xhs-card').forEach(card => this._bindCard(card));
    this._viewIds = shown.map(n => String(n.id));
    this._updateMoreHint(grid, w);
  }
  /** [v3.98.0 · R3-O5] 滚动监听：接近底部时增量追加（只在容器内监听，不挂 window）。 */
  _bindScroll(container) {
    const scroller = container.querySelector('.xhs-body') || container;
    scroller.addEventListener('scroll', () => {
      const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (gap <= 120) this._maybeLoadMore();
    }, { passive: true });
  }
  /** [v3.98.0 · R3-O5] 窗口读数（给外部/诊断面看：现在加载到哪、上一步是不是只改了那几张卡）。 */
  windowState() {
    return {
      tab: this.tab,
      window: this._lastWindow, patch: this._lastPatch,
      loaded: this._loaded, pageSize: this._pageSize, viewIds: this._viewIds.slice()
    };
  }

  /* ---------- 3. 详情（评论就在这一层） ---------- */

  _openDetail(noteId) {
    const note = this.app.data.getNoteById(noteId);
    if (!note) return;
    /* 从消息 / 我 点进来时详情弹层不在场：先切回发现页并重绘（把 id 记下再开）。 */
    if (!this.container.querySelector('#xhs-detail-modal')) {
      this.tab = 'feed';
      this.render(this.container);
    }
    const modal = this.container.querySelector('#xhs-detail-modal');
    const card = this.container.querySelector('#xhs-modal-card');
    if (!modal || !card) return;

    card.innerHTML = `
      <div class="xhs-detail-header">
        <div class="xhs-detail-author">
          <img src="${note.avatar || 'https://files.catbox.moe/r08d2g.jpg'}" />
          <div class="xhs-detail-author-meta">
            <span class="name">${esc(note.author)}</span>
            <span class="time">${esc(note.time)}</span>
          </div>
        </div>
        <button aria-label="关闭" class="xhs-detail-close" id="xhs-detail-close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="xhs-detail-scroll">
        <div class="xhs-detail-cover">
          <img src="${note.cover || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&q=80'}" />
        </div>
        <div class="xhs-detail-content">
          <h3 class="title">${esc(note.title)}</h3>
          <p class="desc">${esc(note.content)}</p>
          <div class="tags">${(Array.isArray(note.tags) ? note.tags : []).map(t => `<span class="tag">#${esc(t)}</span>`).join(' ')}</div>
        </div>
        <div class="xhs-detail-comments">
          <div class="comments-count">共 ${numeralText((note.comments || []).length)} 条评论</div>
          <div class="comments-list">
            ${(Array.isArray(note.comments) ? note.comments : []).map(c => `
              <div class="comment-item">
                <span class="c-author">${esc(c.author)}:</span>
                <span class="c-text">${esc(c.text)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="xhs-detail-footer">
        <input type="text" class="xhs-comment-input" id="xhs-comment-input" placeholder="说点什么..." />
        <button class="xhs-comment-send" id="xhs-comment-send">发送</button>
      </div>
    `;

    this._setOpen(modal, true);
    const close = () => this._setOpen(modal, false);
    const closeBtn = card.querySelector('#xhs-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const overlay = modal.querySelector('.xhs-modal-overlay');
    if (overlay) overlay.addEventListener('click', close);

    const commentInput = card.querySelector('#xhs-comment-input');
    const commentSend = card.querySelector('#xhs-comment-send');
    const doComment = () => {
      const val = commentInput.value.trim();
      if (!val) return;
      this.app.data.addComment(note.id, val);
      this._openDetail(note.id);
      /* [v3.98.0 - R3-O5] 评论不改变卡片视图（评论数不进卡片），故**不重建瀑布流** ——
       *   修前这里整列重建，等于「发一条评论就重置整个列表」。清单列是**如实不做**，
       *   不是忘掉：卡片视图字段见 _cardViews。 */
    };
    commentSend.addEventListener('click', doComment);
    commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doComment(); });
  }

  /* ---------- 4. 头部与发布 ---------- */

  _bindHeaderEvents() {
    this.container.querySelector('#xhs-back-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });

    const composeDrawer = this.container.querySelector('#xhs-compose-drawer');
    this.container.querySelector('#xhs-open-compose-btn')?.addEventListener('click', () => {
      this._setOpen(composeDrawer, true);
    });
    this.container.querySelector('#xhs-compose-close')?.addEventListener('click', () => {
      this._setOpen(composeDrawer, false);
    });

    this.container.querySelector('#xhs-submit-post')?.addEventListener('click', () => {
      const title = this.container.querySelector('#xhs-new-title').value.trim();
      const content = this.container.querySelector('#xhs-new-content').value.trim();
      const cover = this.container.querySelector('#xhs-new-cover').value.trim();
      const tags = this.container.querySelector('#xhs-new-tags').value.trim().split(/\s+/).filter(Boolean);

      if (!title && !content) {
        window.toastr?.warning('请至少填写标题或正文', '小红书');
        return;
      }

      this.app.data.addNote({ title, content, cover, tags, author: '我' });
      this._setOpen(composeDrawer, false);
      /* [v3.98.0 - R3-O5] 发布后把新条目真实带进视野：窗口加载量至少回到**上一次的可见量**，
       *   新条目在最前 ⇒ 它必然在位（不必把全量都建进 DOM）。 */
      this._loaded = Math.max(this._loaded, this._pageSize);
      this.tab = 'feed';
      this.render(this.container);
      this._renderMasonry({ refresh: true });
      window.toastr?.success('笔记发布成功！', '小红书');
    });
  }
}
