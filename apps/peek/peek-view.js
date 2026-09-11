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
    if (section) {
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

  _bind() {
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
  }
}

export default PeekView;
