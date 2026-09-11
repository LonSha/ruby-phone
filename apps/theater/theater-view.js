import { THEATER_STYLES } from './theater-data.js';

export class TheaterView {
  constructor(app) {
    this.app = app;
    this.container = null;
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
    const draft = this.app.data.draft;
    const styles = Object.entries(THEATER_STYLES).map(([key, label]) => {
      const active = draft.style === key ? ' active' : '';
      return '<button class="th-chip' + active + '" data-style="' + key + '">' + this._esc(label) + '</button>';
    }).join('');
    const stories = (this.app.data.stories || []).slice(0, 8).map((story) => {
      return '<article class="th-story"><b>' + this._esc(story.theme) + '</b><p>' + this._esc(String(story.content || '').slice(0, 120)) + '</p></article>';
    }).join('') || '<div class="th-empty">还没有保存的小剧场。</div>';

    this.container.innerHTML = [
      '<div class="th-root">',
      '  <header class="th-header">',
      '    <button class="th-nav" id="th-home"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2>小剧场</h2>',
      '  </header>',
      '  <div class="th-form">',
      '    <input id="th-theme" value="' + this._esc(draft.theme) + '" placeholder="主题，例如：雨夜便利店" />',
      '    <div class="th-chips">' + styles + '</div>',
      '    <select id="th-length">',
      '      <option value="short"' + (draft.length === 'short' ? ' selected' : '') + '>短 200-600 字</option>',
      '      <option value="medium"' + (draft.length === 'medium' ? ' selected' : '') + '>中 400-800 字</option>',
      '      <option value="long"' + (draft.length === 'long' ? ' selected' : '') + '>长 800-1500 字</option>',
      '      <option value="custom"' + (draft.length === 'custom' ? ' selected' : '') + '>自由设置</option>',
      '    </select>',
      '    <textarea id="th-content" placeholder="生成或粘贴正文后可保存 / 续写">' + this._esc(draft.content) + '</textarea>',
      '    <div class="th-actions">',
      '      <button id="th-copy">复制提示词</button>',
      '      <button id="th-continue">复制续写提示词</button>',
      '      <button id="th-save">保存</button>',
      '    </div>',
      '  </div>',
      '  <main class="th-body">' + stories + '</main>',
      '</div>'
    ].join('\n');
    this._bind();
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    const data = this.app.data;
    q('#th-home')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#th-theme')?.addEventListener('input', (e) => { data.draft.theme = e.target.value; data._save(); });
    q('#th-length')?.addEventListener('change', (e) => { data.draft.length = e.target.value; data._save(); });
    q('#th-content')?.addEventListener('input', (e) => { data.draft.content = e.target.value; data._save(); });
    this.container.querySelectorAll('.th-chip').forEach((btn) => {
      btn.addEventListener('click', () => { data.draft.style = btn.dataset.style; data._save(); this._draw(); });
    });
    q('#th-copy')?.addEventListener('click', async () => {
      const prompt = data.buildPrompt(false);
      try { await navigator.clipboard.writeText(prompt); window.toastr?.success?.('已复制生成提示词', '小剧场'); }
      catch (e) { window.toastr?.info?.(prompt.slice(0, 80), '小剧场'); }
    });
    q('#th-continue')?.addEventListener('click', async () => {
      const prompt = data.buildPrompt(true);
      try { await navigator.clipboard.writeText(prompt); window.toastr?.success?.('已复制续写提示词', '小剧场'); }
      catch (e) { window.toastr?.info?.(prompt.slice(0, 80), '小剧场'); }
    });
    q('#th-save')?.addEventListener('click', () => {
      const story = data.saveCurrent();
      window.toastr?.[story ? 'success' : 'warning']?.(story ? '已保存' : '没有可保存的正文', '小剧场');
      this._draw();
    });
  }
}

export default TheaterView;
