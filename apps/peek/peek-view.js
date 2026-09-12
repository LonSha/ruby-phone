/**
 * 查手机 App - 视图
 */
export class PeekView {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.sectionId = '';
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _draw() {
    const view = this.app.data.buildViewModel();
    const section = this.sectionId
      ? (view.sections || []).find((item) => item.id === this.sectionId)
      : null;
    const names = view.characters || [];
    const chips = names.map((name) => {
      const active = name === view.selectedName ? ' active' : '';
      return '<button class="pk-chip' + active + '" data-name="' + this._esc(name) + '">' + this._esc(name) + '</button>';
    }).join('') || '<span class="pk-empty">还没有可查的角色</span>';

    let body = '';
    if (section && section.id === 'douyin' && section.douyin) {
      body = this._renderDouyin(view, section);
    } else if (section) {
      const items = (section.items || []).map((item) => {
        const mark = item.generated ? '<span class="pk-guess">推测</span>' : '';
        const img = item.imageUrl
          ? '<div class="pk-thumb" style="background-image:url(' + JSON.stringify(String(item.imageUrl)) + ')"></div>'
          : '';
        return '<article class="pk-item">' + img
          + '<div class="pk-item-body"><div class="pk-item-top"><b>' + this._esc(item.title) + '</b>' + mark
          + '<span>' + this._esc(item.subtitle || '') + '</span></div><p>' + this._esc(item.body) + '</p></div></article>';
      }).join('') || '<div class="pk-empty">这一栏还是空的</div>';
      body = '<button class="pk-back" id="pk-back-section"><i class="fa-solid fa-chevron-left"></i> 返回概览</button>'
        + '<div class="pk-section-head"><h3>' + this._esc(section.title) + '</h3><p>'
        + this._esc(section.description || '') + '</p></div>' + items;
    } else {
      body = (view.sections || []).map((item) => {
        const mark = item.generated
          ? '<span class="pk-guess">推测痕迹</span>'
          : '<span class="pk-real">实际数据</span>';
        return '<button class="pk-card" data-section="' + this._esc(item.id) + '">'
          + '<div class="pk-card-top"><b>' + this._esc(item.title) + '</b>' + mark + '</div>'
          + '<p>' + this._esc(item.description || '暂无内容') + '</p>'
          + '<span>' + (item.count || 0) + ' 条</span></button>';
      }).join('');
    }

    this.container.innerHTML = [
      '<div class="pk-root">',
      '  <header class="pk-header">',
      '    <button class="pk-nav" id="pk-home"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2>查手机</h2>',
      '    <label class="pk-inject"><input type="checkbox" id="pk-auto" '
        + (this.app.data.autoInject ? 'checked' : '') + ' /> 注入上下文</label>',
      '  </header>',
      '  <div class="pk-chips">' + chips + '</div>',
      '  <main class="pk-body">' + body + '</main>',
      '</div>'
    ].join('\n');
    this._bind();
  }

  _renderDouyin(view, section) {
    const d = section.douyin || {};
    const profile = d.profile || {};
    const tabs = [
      { id: 'works', label: '作品' },
      { id: 'saved', label: '收藏' },
      { id: 'liked', label: '喜欢' }
    ];
    const tab = this.douyinTab || 'works';
    const videos = d[tab === 'saved' ? 'savedVideos' : tab === 'liked' ? 'likedVideos' : 'works'] || [];
    const grid = videos.map((v, i) => {
      const cover = v.coverIcon
        ? ' style="background-image:url(' + JSON.stringify(String(v.coverIcon)) + ')"'
        : '';
      const toneCls = 'pk-dy-tone-' + (v.tone || 'ivory');
      const tag = v.id && v.id.startsWith('dy-guess-') ? '<span class="pk-guess">推测</span>' : '';
      return '<button class="pk-dy-cell ' + toneCls + '" data-video-index="' + i + '"' + cover + '>'
        + '<div class="pk-dy-cell-cover">' + (cover ? '' : '<i class="fa-solid fa-play"></i>') + '</div>'
        + '<div class="pk-dy-cell-meta"><b>' + this._esc(v.title) + '</b>' + tag
        + '<span>❤ ' + (v.likeCount || 0) + ' 💬 ' + (v.commentCount || 0) + '</span></div></button>';
    }).join('') || '<div class="pk-empty">这个分区还是空的</div>';
    const tabsHtml = tabs.map((t) => {
      const active = t.id === tab ? ' active' : '';
      return '<button class="pk-dy-tab' + active + '" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('');
    return '<button class="pk-back" id="pk-back-section"><i class="fa-solid fa-chevron-left"></i> 返回概览</button>'
      + '<div class="pk-dy-root">'
      + '  <header class="pk-dy-head"><div class="pk-dy-avatar">' + this._esc((profile.name || '?').slice(0, 1)) + '</div>'
      + '    <div class="pk-dy-head-info"><b>' + this._esc(profile.name || '') + '</b>'
      + '      <span>' + this._esc(profile.handle || '') + '</span>'
      + '      <p>' + this._esc(profile.bio || '') + '</p></div>'
      + '    <div class="pk-dy-stats"><span><b>' + (profile.followingCount || 0) + '</b> 关注</span>'
      + '      <span><b>' + (profile.followerCount || 0) + '</b> 粉丝</span>'
      + '      <span><b>' + (profile.likesTotal || 0) + '</b> 获赞</span></div>'
      + '  </header>'
      + '  <div class="pk-dy-tabs">' + tabsHtml + '</div>'
      + '  <div class="pk-dy-grid">' + grid + '</div>'
      + '</div>'
      + (this.douyinVideo != null && videos[this.douyinVideo]
        ? this._renderDouyinDetail(videos[this.douyinVideo])
        : '');
  }
  _renderDouyinDetail(video) {
    const cover = video.coverIcon
      ? ' style="background-image:url(' + JSON.stringify(String(video.coverIcon)) + ')"'
      : '';
    return '<div class="pk-dy-detail">'
      + '<div class="pk-dy-detail-cover"' + cover + '>' + (cover ? '' : '<div class="pk-dy-detail-ph" style="background:' + this._dyToneColor(video.tone) + '"><i class="fa-solid fa-play"></i></div>') + '</div>'
      + '<div class="pk-dy-detail-info">'
      + '  <h4>' + this._esc(video.title) + '</h4>'
      + '  <p>' + this._esc(video.videoDescription || '') + '</p>'
      + '  <div class="pk-dy-detail-actions">'
      + '    <span>❤ ' + (video.likeCount || 0) + '</span>'
      + '    <span>💬 ' + (video.commentCount || 0) + '</span>'
      + '    <span>⭐ ' + (video.saveCount || 0) + '</span></div>'
      + '  <div class="pk-dy-comments">' + this._renderDouyinComments(video) + '</div>'
      + '</div></div>';
  }
  _renderDouyinComments(video) {
    if (!video.comments || !video.comments.length) {
      return '<div class="pk-dy-comments-empty">评论还没生成，只有 TA 看得见。</div>';
    }
    return video.comments.map((c) => {
      return '<div class="pk-dy-comment"><b>' + this._esc(c.authorName) + '</b><p>' + this._esc(c.text) + '</p></div>';
    }).join('');
  }
  _dyToneColor(tone) {
    return {
      ivory: '#f6ecd7',
      mist: '#d8e4ea',
      blush: '#f0d8dd',
      graphite: '#3a3d42'
    }[tone] || '#f6ecd7';
  }
    const q = (sel) => this.container.querySelector(sel);
    q('#pk-home')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#pk-auto')?.addEventListener('change', (e) => { this.app.data.autoInject = !!e.target.checked; });
    q('#pk-back-section')?.addEventListener('click', () => { this.sectionId = ''; this._draw(); });
    this.container.querySelectorAll('.pk-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.app.data.setSelectedName(btn.dataset.name);
        this.sectionId = '';
        this._draw();
      });
    });
    this.container.querySelectorAll('.pk-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sectionId = btn.dataset.section;
        this._draw();
      });
    });
    // 抖音页互动
    this.container.querySelectorAll('.pk-dy-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.douyinTab = btn.dataset.tab;
        this.douyinVideo = null;
        this._draw();
      });
    });
    this.container.querySelectorAll('.pk-dy-cell').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.douyinVideo = Number(btn.dataset.videoIndex);
        this._draw();
      });
    });
    q('.pk-dy-detail')?.addEventListener('click', (e) => {
      if (e.target.closest('.pk-dy-detail-info')) return;
      this.douyinVideo = null;
      this._draw();
    });
  }
}

export default PeekView;
