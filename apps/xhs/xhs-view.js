/**
 * 小红书 (XHS App) - 视图渲染组件
 * 包含双列瀑布流、笔记卡片、详情全屏弹层与发布抽屉
 */

import { windowOf, patchOf, keepState, line as windowLine } from '../../config/list-window.js';
export class XhsView {
  constructor(app) {
    this.app = app;
    this.container = null;
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

  render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="xhs-root">
        <header class="xhs-header">
          <button class="xhs-back-btn" id="xhs-back-btn"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="xhs-header-tabs">
            <span class="xhs-tab active">发现</span>
            <span class="xhs-tab">关注</span>
            <span class="xhs-tab">江城</span>
          </div>
          <button class="xhs-post-btn" id="xhs-open-compose-btn" title="发布新笔记"><i class="fa-solid fa-plus"></i></button>
        </header>

        <main class="xhs-body">
          <div class="xhs-masonry" id="xhs-masonry">
            <!-- 笔记卡片动态流 -->
          </div>
        </main>

        <!-- 笔记详情弹层 -->
        <div class="xhs-detail-modal" id="xhs-detail-modal" style="display:none;">
          <div class="xhs-modal-overlay"></div>
          <div class="xhs-modal-card" id="xhs-modal-card"></div>
        </div>

        <!-- 发布新笔记抽屉 -->
        <div class="xhs-compose-drawer" id="xhs-compose-drawer" style="display:none;">
          <div class="xhs-drawer-overlay"></div>
          <div class="xhs-drawer-content">
            <div class="xhs-drawer-header">
              <button class="xhs-drawer-close" id="xhs-compose-close"><i class="fa-solid fa-xmark"></i></button>
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
        </div>
      </div>
    `;

    this._bindHeaderEvents();
    this._loaded = 0;                 /* [v3.98.0 - R3-O5] 每次进页从首屏窗口起 */
    this._renderMasonry();
    this._bindScroll(this.container); /* 滚到底增量追加（不是一次性建满 DOM） */
  }

  /** [v3.98.0 · R3-O5] 单张卡片的 HTML（**唯一真源**：首屏、追加、局部更新三处共用一份）。 */
  _cardHtml(n) {
    return `
      <div class="xhs-card" data-id="${n.id}">
        <div class="xhs-card-cover-wrap">
          <img class="xhs-card-cover" src="${n.cover || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&q=80'}" loading="lazy" />
        </div>
        <div class="xhs-card-info">
          <h4 class="xhs-card-title">${n.title}</h4>
          <div class="xhs-card-author-row">
            <div class="xhs-author-group">
              <img class="xhs-author-avatar" src="${n.avatar || 'https://files.catbox.moe/r08d2g.jpg'}" />
              <span class="xhs-author-name">${n.author}</span>
            </div>
            <div class="xhs-like-badge ${n.isLiked ? 'liked' : ''}" data-like-id="${n.id}">
              <i class="${n.isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
              <span>${n.likes}</span>
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
      window: this._lastWindow, patch: this._lastPatch,
      loaded: this._loaded, pageSize: this._pageSize, viewIds: this._viewIds.slice()
    };
  }

  _openDetail(noteId) {
    const note = this.app.data.getNoteById(noteId);
    if (!note) return;
    const modal = this.container.querySelector('#xhs-detail-modal');
    const card = this.container.querySelector('#xhs-modal-card');

    card.innerHTML = `
      <div class="xhs-detail-header">
        <div class="xhs-detail-author">
          <img src="${note.avatar || 'https://files.catbox.moe/r08d2g.jpg'}" />
          <div class="xhs-detail-author-meta">
            <span class="name">${note.author}</span>
            <span class="time">${note.time}</span>
          </div>
        </div>
        <button class="xhs-detail-close" id="xhs-detail-close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="xhs-detail-scroll">
        <div class="xhs-detail-cover">
          <img src="${note.cover || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&q=80'}" />
        </div>
        <div class="xhs-detail-content">
          <h3 class="title">${note.title}</h3>
          <p class="desc">${note.content}</p>
          <div class="tags">${note.tags.map(t => `<span class="tag">#${t}</span>`).join(' ')}</div>
        </div>
        <div class="xhs-detail-comments">
          <div class="comments-count">共 ${note.comments.length} 条评论</div>
          <div class="comments-list">
            ${note.comments.map(c => `
              <div class="comment-item">
                <span class="c-author">${c.author}:</span>
                <span class="c-text">${c.text}</span>
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

    modal.style.display = 'flex';
    card.querySelector('#xhs-detail-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.querySelector('.xhs-modal-overlay').addEventListener('click', () => {
      modal.style.display = 'none';
    });

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

  _bindHeaderEvents() {
    this.container.querySelector('#xhs-back-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });

    const composeDrawer = this.container.querySelector('#xhs-compose-drawer');
    this.container.querySelector('#xhs-open-compose-btn')?.addEventListener('click', () => {
      composeDrawer.style.display = 'flex';
    });
    this.container.querySelector('#xhs-compose-close')?.addEventListener('click', () => {
      composeDrawer.style.display = 'none';
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
      composeDrawer.style.display = 'none';
      /* [v3.98.0 - R3-O5] 发布后把新条目真实带进视野：窗口加载量至少回到**上一次的可见量**，
       *   新条目在最前 ⇒ 它必然在位（不必把全量都建进 DOM）。 */
      this._loaded = Math.max(this._loaded, this._pageSize);
      this._renderMasonry({ refresh: true });
      window.toastr?.success('笔记发布成功！', '小红书');
    });
  }
}
