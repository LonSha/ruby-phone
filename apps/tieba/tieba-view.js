/**
 * 百度贴吧 (Tieba App) - 视图组件
 */

export class TiebaView {
  constructor(app) {
    this.app = app;
    this.currentBarId = 'all';
    this.container = null;
  }

  render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="tb-root">
        <header class="tb-header">
          <button class="tb-back-btn" id="tb-back-btn"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="tb-header-title">百度贴吧</div>
          <button class="tb-post-trigger" id="tb-post-open-btn"><i class="fa-solid fa-pen-to-square"></i> 发帖</button>
        </header>

        <nav class="tb-bar-selector" id="tb-bar-selector">
          <button class="tb-bar-chip ${this.currentBarId === 'all' ? 'active' : ''}" data-bar="all">全部吧</button>
          ${this.app.data.bars.map(b => `
            <button class="tb-bar-chip ${b.id === this.currentBarId ? 'active' : ''}" data-bar="${b.id}">
              ${b.name}
            </button>
          `).join('')}
        </nav>

        <main class="tb-body">
          <div class="tb-posts-list" id="tb-posts-list">
            <!-- 帖子动态填充 -->
          </div>
        </main>

        <!-- 帖子详情全屏弹窗 -->
        <div class="tb-detail-modal" id="tb-detail-modal" style="display:none;">
          <div class="tb-detail-card" id="tb-detail-card"></div>
        </div>

        <!-- 发帖弹窗 -->
        <div class="tb-compose-modal" id="tb-compose-modal" style="display:none;">
          <div class="tb-compose-overlay"></div>
          <div class="tb-compose-card">
            <div class="tb-compose-head">
              <button class="tb-compose-close" id="tb-compose-close"><i class="fa-solid fa-xmark"></i></button>
              <h3>发布新帖</h3>
              <button class="tb-compose-submit" id="tb-compose-submit">发布</button>
            </div>
            <div class="tb-compose-body">
              <select class="tb-compose-bar-select" id="tb-new-bar-select">
                ${this.app.data.bars.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
              <input type="text" class="tb-compose-title" id="tb-new-title" placeholder="请拟一个吸引人的标题吧..." />
              <textarea class="tb-compose-content" id="tb-new-content" placeholder="填写帖子正文，与吧友一起交流～"></textarea>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindHeaderEvents();
    this._renderPosts();
  }

  _renderPosts() {
    const list = this.container.querySelector('#tb-posts-list');
    if (!list) return;
    const posts = this.app.data.getPostsByBar(this.currentBarId);

    if (posts.length === 0) {
      list.innerHTML = '<div class="tb-empty"><p>这个吧空空如也，快来抢一楼！</p></div>';
      return;
    }

    list.innerHTML = posts.map(p => `
      <div class="tb-post-card" data-id="${p.id}">
        <div class="tb-post-bar-tag"><i class="fa-solid fa-fire"></i> ${p.barName}</div>
        <h3 class="tb-post-title">${p.title}</h3>
        <p class="tb-post-excerpt">${p.content}</p>
        <div class="tb-post-meta-row">
          <div class="tb-post-author-group">
            <img class="tb-post-avatar" src="${p.avatar}" />
            <span class="tb-post-author">${p.author}</span>
            <span class="tb-post-time">${p.time}</span>
          </div>
          <div class="tb-post-stats">
            <span class="tb-post-stat-item"><i class="fa-regular fa-comment"></i> ${p.replies.length}</span>
            <span class="tb-post-stat-item ${p.isLiked ? 'liked' : ''}"><i class="fa-regular fa-thumbs-up"></i> ${p.likes}</span>
          </div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.tb-post-card').forEach(card => {
      card.addEventListener('click', () => {
        this._openDetail(card.dataset.id);
      });
    });
  }

  _openDetail(postId) {
    const post = this.app.data.getPostById(postId);
    if (!post) return;
    const modal = this.container.querySelector('#tb-detail-modal');
    const card = this.container.querySelector('#tb-detail-card');

    card.innerHTML = `
      <div class="tb-detail-header">
        <button class="tb-detail-back" id="tb-detail-back"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="tb-detail-barname">${post.barName}</div>
        <button class="tb-detail-like-btn ${post.isLiked ? 'liked' : ''}" id="tb-detail-like-btn">
          <i class="fa-solid fa-thumbs-up"></i> ${post.likes}
        </button>
      </div>
      <div class="tb-detail-scroll">
        <!-- 1楼 楼主帖 -->
        <div class="tb-floor-main">
          <h2 class="tb-floor-title">${post.title}</h2>
          <div class="tb-floor-author-bar">
            <img src="${post.avatar}" />
            <div>
              <span class="author">${post.author} <span class="lz-tag">楼主</span></span>
              <span class="time">1楼 · ${post.time}</span>
            </div>
          </div>
          <div class="tb-floor-content">${post.content}</div>
        </div>

        <!-- 回复区 -->
        <div class="tb-replies-section">
          <div class="tb-replies-count">全部回复 (${post.replies.length})</div>
          ${post.replies.map(r => `
            <div class="tb-reply-row">
              <div class="tb-reply-head">
                <span class="r-author">${r.author}</span>
                <span class="r-floor">${r.floor}楼</span>
              </div>
              <div class="r-text">${r.text}</div>
              <div class="r-time">${r.time}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="tb-detail-footer">
        <input type="text" class="tb-reply-input" id="tb-reply-input" placeholder="回复楼主..." />
        <button class="tb-reply-send" id="tb-reply-send">回复</button>
      </div>
    `;

    modal.style.display = 'flex';
    card.querySelector('#tb-detail-back').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    const replyInput = card.querySelector('#tb-reply-input');
    const replySend = card.querySelector('#tb-reply-send');
    const doReply = () => {
      const val = replyInput.value.trim();
      if (!val) return;
      this.app.data.addReply(post.id, val, '我');
      this._openDetail(post.id);
      this._renderPosts();
    };
    replySend.addEventListener('click', doReply);
    replyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doReply(); });

    card.querySelector('#tb-detail-like-btn').addEventListener('click', () => {
      this.app.data.toggleLike(post.id);
      this._openDetail(post.id);
      this._renderPosts();
    });
  }

  _bindHeaderEvents() {
    this.container.querySelector('#tb-back-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });

    // 分类吧切换
    const nav = this.container.querySelector('#tb-bar-selector');
    nav?.querySelectorAll('.tb-bar-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.currentBarId = chip.dataset.bar;
        nav.querySelectorAll('.tb-bar-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this._renderPosts();
      });
    });

    // 发帖弹窗
    const composeModal = this.container.querySelector('#tb-compose-modal');
    this.container.querySelector('#tb-post-open-btn')?.addEventListener('click', () => {
      composeModal.style.display = 'flex';
    });
    this.container.querySelector('#tb-compose-close')?.addEventListener('click', () => {
      composeModal.style.display = 'none';
    });
    this.container.querySelector('#tb-compose-submit')?.addEventListener('click', () => {
      const barId = this.container.querySelector('#tb-new-bar-select').value;
      const title = this.container.querySelector('#tb-new-title').value.trim();
      const content = this.container.querySelector('#tb-new-content').value.trim();
      if (!title) {
        window.toastr?.warning('帖子标题不能为空', '贴吧');
        return;
      }
      this.app.data.createPost(barId, title, content, '我');
      composeModal.style.display = 'none';
      this._renderPosts();
      window.toastr?.success('帖子发布成功！', '贴吧');
    });
  }
}
