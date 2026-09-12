/**
 * 查手机 App - 视图
 */
function formatCount(count) {
  if (count >= 10000) return (count / 10000).toFixed(count >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(count);
}
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
    if (section && section.id === 'daily' && section.daily) {
      body = this._renderDaily(view, section);
    } else if (section && section.id === 'douyin' && section.douyin) {
      body = this._renderDouyin(view, section);
    } else if (section && section.id === 'weibo' && section.weibo) {
      body = this._renderWeibo(view, section);
    } else if (section && section.id === 'bilibili' && section.bilibili) {
      body = this._renderBilibili(view, section);
    } else if (section && section.id === 'douban' && section.douban) {
      body = this._renderDouban(view, section);
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
  _renderDaily(view, section) {
    const d = section.daily || {};
    const dateStr = d.dateStr || '';
    const sectionsHtml = (d.sections || []).map((s) => {
      return '<section class="pk-dl-sec">'
        + '<div class="pk-dl-sec-head"><span class="pk-dl-name">' + this._esc(s.name) + '</span>'
        + (s.extra ? '<em>' + this._esc(s.extra) + '</em>' : '') + '</div>'
        + '<div class="pk-dl-sec-body">' + (s.lines || []).map((l) => '<p>' + this._esc(l) + '</p>').join('') + '</div>'
        + '</section>';
    }).join('');
    const noteHtml = d.note
      ? '<aside class="pk-dl-note"><span class="pk-dl-note-tag">便条</span><p>' + this._esc(d.note) + '</p></aside>'
      : '';
    return '<button class="pk-back" id="pk-back-section"><i class="fa-solid fa-chevron-left"></i> 返回概览</button>'
      + '<div class="pk-dl-root">'
      + '  <header class="pk-dl-head"><h2>' + this._esc(view.selectedName || '角色') + ' 的角色日报</h2>'
      + '    <span>' + this._esc(dateStr) + '</span></header>'
      + '  <div class="pk-dl-body">' + sectionsHtml + noteHtml + '</div>'
      + '  <footer class="pk-dl-foot">— 只给 ' + this._esc(view.selectedName || 'TA') + ' 看的报纸 —</footer>'
      + '</div>';
  }
  _renderDouban(view, section) {
    const d = section.douban || {};
    const activities = d.activities || [];
    const typeLabel = {
      post: '广播',
      movie_review: '影评',
      book_review: '书评',
      diary: '日记',
      listened: '在听',
      want_watch: '想看',
      want_read: '想读'
    };
    const items = activities.map((a) => {
      const tag = a.id && a.id.startsWith('db-guess-') ? '<span class="pk-guess">推测</span>' : '';
      return '<article class="pk-db-item">'
        + '<div class="pk-db-item-head"><span class="pk-db-type">' + (typeLabel[a.type] || a.type || '动态') + '</span>' + tag + '</div>'
        + '<h4>' + this._esc(a.title) + '</h4>'
        + (a.content ? '<p>' + this._esc(a.content) + '</p>' : '')
        + '</article>';
    }).join('') || '<div class="pk-empty">还没有广播</div>';
    return '<button class="pk-back" id="pk-back-section"><i class="fa-solid fa-chevron-left"></i> 返回概览</button>'
      + '<div class="pk-db-root">'
      + '  <header class="pk-db-head"><div class="pk-db-logo">豆</div><div><b>豆瓣</b><span>记录 · 发现 · 讨论</span></div></header>'
      + '  <div class="pk-db-feed">' + items + '</div>'
      + '</div>';
  }
  _renderWeibo(view, section) {
    const d = section.weibo || {};
    const myPosts = d.myPosts || [];
    const hotSearches = d.hotSearches || [];
    const posts = myPosts.map((p) => {
      const tag = p.id && p.id.startsWith('wb-guess-') ? '<span class="pk-guess">推测</span>' : '';
      return '<article class="pk-wb-post">'
        + '<div class="pk-wb-author"><div class="pk-wb-avatar">' + this._esc((p.authorName || '?').slice(0, 1)) + '</div>'
        + '  <div><b>' + this._esc(p.authorName || '') + '</b>' + (p.authorBadge ? '<em>' + this._esc(p.authorBadge) + '</em>' : '') + '</div></div>'
        + '<p class="pk-wb-body">' + this._esc(p.body) + '</p>'
        + '<div class="pk-wb-actions"><span>🔁 ' + (p.repostCount || 0) + '</span><span>💬 ' + (p.commentCount || 0) + '</span><span>❤ ' + (p.likeCount || 0) + '</span></div>'
        + tag + '</article>';
    }).join('') || '<div class="pk-empty">还没发过微博</div>';
    const hot = hotSearches.length ? hotSearches.map((h, i) => (
      '<div class="pk-wb-hot"><span class="pk-wb-hot-no">' + (i + 1) + '</span><span class="pk-wb-hot-title">' + this._esc(h.title || '') + '</span><span class="pk-wb-hot-tag">' + this._esc(h.hot || '') + '</span></div>'
    )).join('') : '';
    return '<button class="pk-back" id="pk-back-section"><i class="fa-solid fa-chevron-left"></i> 返回概览</button>'
      + '<div class="pk-wb-root">'
      + '  <header class="pk-wb-head"><b>微博</b></header>'
      + (hot ? '<section class="pk-wb-hotlist"><h5>热搜榜</h5>' + hot + '</section>' : '')
      + '  <section class="pk-wb-feed"><h5>' + this._esc(view.selectedName || '我') + '的微博</h5>' + posts + '</section>'
      + '</div>';
  }
  _renderBilibili(view, section) {
    const d = section.bilibili || {};
    const videos = d.videos || [];
    const grid = videos.map((v) => {
      const cover = v.coverIcon
        ? ' style="background-image:url(' + JSON.stringify(String(v.coverIcon)) + ')"'
        : '<div class="pk-bv-ph"><i class="fa-solid fa-play"></i></div>';
      const tag = v.id && v.id.startsWith('bv-guess-') ? '<span class="pk-guess">推测</span>' : '';
      return '<article class="pk-bv-card">'
        + '<div class="pk-bv-cover">' + (v.coverIcon ? '' : cover.slice(5)) + '</div>'
        + '<div class="pk-bv-info"><b>' + this._esc(v.title) + '</b>' + tag
        + '  <span>' + this._esc(v.author || '') + ' · ' + formatCount(v.playCount) + '播放 · ' + v.danmakuCount + '弹幕</span>'
        + '</div></article>';
    }).join('') || '<div class="pk-empty">还没有观看记录</div>';
    return '<button class="pk-back" id="pk-back-section"><i class="fa-solid fa-chevron-left"></i> 返回概览</button>'
      + '<div class="pk-bv-root">'
      + '  <header class="pk-bv-head"><div class="pk-bv-logo">B</div><div><b>哔哩哔哩</b><span>干杯 ~</span></div></header>'
      + '  <div class="pk-bv-grid">' + grid + '</div>'
      + '</div>';
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
