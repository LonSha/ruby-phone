/**
 * 记忆 App - 视图组件 (MemoryView)
 * iOS 风格: 概览卡 + 检索 + 时间线 + 自动注入开关
 */

export class MemoryView {
  constructor(app) {
    this.app = app;
    this.container = null;
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _row(m) {
    const emo = m.emotion || {};
    const tag = emo.label ? '<span class="mem-emo" style="--emo:' + this._emoColor(emo.label) + '">' + emo.label + '</span>' : '';
    const role = m.role === 'user' ? '我' : 'TA';
    const roleCls = m.role === 'user' ? 'ru' : 'ra';
    // LonSha 回填的提炼记忆加徽标 (内容带 [剧情]/[事件]/[关系] 前缀)
    const lonshaTag = /^\[(剧情|事件|关系)\]/.test(m.content || '') ? '<span class="mem-lonsha">LLM</span>' : '';
    return '<div class="mem-item">' +
      '<div class="mem-item-top"><span class="mem-role ' + roleCls + '">' + role + '</span>' + lonshaTag + tag + (m.storyTime ? '<span class="mem-stime">' + this._esc(m.storyTime) + '</span>' : '') + '<span class="mem-time">' + this._fmt(m.createdAt) + '</span>' + (m.pinned ? '<span class="mem-pin" title="已收藏">📌</span>' : '<span class="mem-pin-btn" title="收藏（不会被衰减清理）" data-mid="' + this._esc(m.id || '') + '">☆</span>') + '</div>' +
      '<div class="mem-item-text">' + this._esc(m.content) + '</div>' +
      '</div>';
  }

  _draw() {
    if (!this.app.data) {
      this.container.innerHTML = '<div class="mem-root"><div class="mem-none">记忆系统未初始化，请刷新酒馆后重试</div></div>';
      return;
    }
    const st = this.app.data.getStats();
    const pool = st.pool || {};
    const items = this.app.data.getTimeline(30);
    const listHtml = items.length ? items.map(m => this._row(m)).join('') : '<div class="mem-none">对话积累到一定量后，记忆会自动沉淀到这里</div>';
    const html = [
      '<div class="mem-root">',
      '  <header class="mem-header">',
      '    <button class="mem-back" id="mem-back"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2 class="mem-title"><i class="fa-solid fa-brain"></i> 记忆</h2>',
      '    <button class="mem-sleep" id="mem-sleep" title="立即巩固"><i class="fa-solid fa-moon"></i></button>',
      '  </header>',
      '  <div class="mem-overview">',
      '    <div class="mem-o-card"><div class="mem-o-num">' + st.longTerm + '</div><div class="mem-o-lbl">长期记忆</div></div>',
      '    <div class="mem-o-card"><div class="mem-o-num">' + st.shortTerm + '</div><div class="mem-o-lbl">短期缓冲</div></div>',
      '    <div class="mem-o-card"><div class="mem-o-num">' + (pool.perception || 0) + '</div><div class="mem-o-lbl">感知层</div></div>',
      '    <div class="mem-o-card"><div class="mem-o-num">' + (pool.temporal || 0) + '</div><div class="mem-o-lbl">时间层</div></div>',
      '  </div>',
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-magnifying-glass"></i> 检索记忆</div>',
      '    <div class="mem-search-row"><input id="mem-q" placeholder="输入关键词, 如: 海边 / 面馆" /><button id="mem-search-btn">搜索</button></div>',
      '    <div id="mem-results" class="mem-results"></div>',
      '  </div>',
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-clock-rotate-left"></i> 最近沉淀</div>',
      '    <div class="mem-list" id="mem-list">' + listHtml + '</div>',
      '  </div>',
      '  <div class="mem-footer">',
      '    <label class="mem-toggle"><input type="checkbox" id="mem-auto" ' + (st.config.autoInject ? 'checked' : '') + ' /><span><i class="fa-solid fa-wand-magic-sparkles"></i> 自动注入 AI 上下文</span></label>',
      '    <button class="mem-danger" id="mem-clear"><i class="fa-solid fa-trash"></i> 清空当前聊天记忆</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    this.container.innerHTML = html;
    this._bindEvents();
  }

  _emoColor(label) {
    if (!label) return '#9ca3af';
    if (label.includes('兴奋') || label.includes('喜悦')) return '#f59e0b';
    if (label.includes('悲伤')) return '#60a5fa';
    if (label.includes('愤怒')) return '#ef4444';
    if (label.includes('满足')) return '#10b981';
    return '#9ca3af';
  }

  _fmt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return ''; }
  }

  _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _bindEvents() {
    const q = (sel) => this.container.querySelector(sel);
    q('#mem-back')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#mem-sleep')?.addEventListener('click', () => {
      const r = this.app.data.sleep();
      window.toastr?.success(r && r.consolidated ? '已巩固 ' + r.consolidated + ' 条记忆' : '没有待巩固的记忆', '记忆');
      this._draw();
    });
    q('#mem-search-btn')?.addEventListener('click', () => this._doSearch());
    // [RA] 收藏记忆: pinned 条目永不参与衰减淘汰
    if (!this._pinBound) {
      this._pinBound = true;
      this.container.addEventListener('click', (e) => {
        const btn = e.target.closest('.mem-pin-btn');
        if (!btn) return;
        const mid = btn.getAttribute('data-mid');
        if (mid && this.app.data?.pin?.(mid, true)) this._draw();
      });
    }
    q('#mem-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') this._doSearch(); });
    q('#mem-auto')?.addEventListener('change', e => {
      this.app.data.updateConfig({ autoInject: e.target.checked });
      window.toastr?.info(e.target.checked ? '已开启自动注入' : '已关闭自动注入', '记忆');
    });
    q('#mem-clear')?.addEventListener('click', () => {
      if (!confirm('确定清空当前聊天的全部记忆?')) return;
      this.app.data.clearCurrentChat();
      this._draw();
    });
  }

  _doSearch() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#mem-q')?.value?.trim();
    const box = q('#mem-results');
    if (!box) return;
    if (!kw) { box.innerHTML = ''; return; }
    const hits = this.app.data.recall(kw, 8) || [];
    box.innerHTML = hits.length
      ? hits.map(h => '<div class="mem-res"><div class="mem-res-lbl">' + h.layer + ' <span class="mem-res-score">' + (h._score || 0).toFixed(2) + '</span></div><div class="mem-res-text">' + this._esc(h.content) + '</div></div>').join('')
      : '<div class="mem-none">没有相关记忆</div>';
  }
}

export default MemoryView;
