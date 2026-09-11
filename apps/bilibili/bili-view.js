export class BiliView {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.query = this.app.data.query || '';
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
    const entries = this.app.data.entries || [];
    const cards = entries.map((entry) => {
      const danmaku = (entry.danmaku || []).slice(0, 3).map((item) => this._esc(item)).join(' / ');
      return '<article class="bl-card">'
        + '<div class="bl-cover">' + this._esc(entry.playCount) + '播放</div>'
        + '<div class="bl-meta"><b>' + this._esc(entry.title) + '</b>'
        + '<span>' + this._esc(entry.upName) + ' · ' + this._esc(entry.danmakuCount) + '弹幕</span>'
        + '<p>' + this._esc(entry.description) + '</p>'
        + (danmaku ? '<em>' + danmaku + '</em>' : '')
        + '</div></article>';
    }).join('') || '<div class="bl-empty">还没有刷到视频。输入关键词后点刷新。</div>';

    this.container.innerHTML = [
      '<div class="bl-root">',
      '  <header class="bl-header">',
      '    <button class="bl-nav" id="bl-home"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2>B站</h2>',
      '  </header>',
      '  <div class="bl-search">',
      '    <input id="bl-query" value="' + this._esc(this.query || this.app.data.query || '') + '" placeholder="搜一个今晚会刷到的词" />',
      '    <button id="bl-refresh">刷新</button>',
      '  </div>',
      '  <p class="bl-summary">' + this._esc(this.app.data.summary || '不抓真实网页，只生成像从手机里刷到的 B站条目。') + '</p>',
      '  <main class="bl-body">' + cards + '</main>',
      '</div>'
    ].join('\n');
    this._bind();
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    q('#bl-home')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#bl-query')?.addEventListener('input', (e) => { this.query = e.target.value; });
    q('#bl-refresh')?.addEventListener('click', () => {
      this.app.data.refresh(this.query || '现实生活 日常 刷到的视频');
      this._draw();
    });
  }
}

export default BiliView;
