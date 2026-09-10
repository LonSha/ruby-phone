/**
 * 小红书 (XHS App) - 视图渲染组件
 * 包含双列瀑布流、笔记卡片、详情全屏弹层与发布抽屉
 */

export class XhsView {
  constructor(app) {
    this.app = app;
    this.container = null;
  }

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
    this._renderMasonry();
  }

  _renderMasonry() {
    const grid = this.container.querySelector('#xhs-masonry');
    if (!grid) return;
    const notes = this.app.data.getNotes();

    if (notes.length === 0) {
      grid.innerHTML = '<div class="xhs-empty"><p>还没有笔记，点击右上角「+」发布第一篇吧！</p></div>';
      return;
    }

    grid.innerHTML = notes.map(n => `
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
    `).join('');

    // 绑定点击查看详情
    grid.querySelectorAll('.xhs-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.xhs-like-badge')) return;
        const id = card.dataset.id;
        this._openDetail(id);
      });
    });

    // 绑定点赞事件
    grid.querySelectorAll('.xhs-like-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = badge.dataset.likeId;
        this.app.data.toggleLike(id);
        this._renderMasonry();
      });
    });
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
      this._renderMasonry();
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
      this._renderMasonry();
      window.toastr?.success('笔记发布成功！', '小红书');
    });
  }
}
