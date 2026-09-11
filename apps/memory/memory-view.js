/**
 * 记忆 App - 视图组件 (MemoryView)
 * iOS 风格: 概览卡 + 检索 + 时间线 + 情感曲线 + 唤醒状态 + 自动注入开关
 */

export class MemoryView {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.tab = 'list';
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
    return '<div class="mem-item">' +
      '<div class="mem-item-top"><span class="mem-role ' + roleCls + '">' + role + '</span>' + tag + '<span class="mem-time">' + this._fmt(m.createdAt) + '</span></div>' +
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
    const tabs = [
      { id: 'list', label: '记忆' },
      { id: 'emotion', label: '情感' },
      { id: 'sense', label: '感官' },
      { id: 'awake', label: '唤醒' }
    ];
    const header = [
      '<div class="mem-root">',
      '  <header class="mem-header">',
      '    <button class="mem-back" id="mem-back"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2 class="mem-title"><i class="fa-solid fa-brain"></i> 记忆</h2>',
      '    <button class="mem-sleep" id="mem-sleep" title="立即巩固"><i class="fa-solid fa-moon"></i></button>',
      '  </header>',
      '  <div class="mem-tabs">' + tabs.map(tb => '<button class="mem-tab ' + (this.tab === tb.id ? 'active' : '') + '" data-tab="' + tb.id + '">' + tb.label + '</button>').join('') + '</div>',
      '  <div class="mem-overview">',
      '    <div class="mem-o-card"><div class="mem-o-num">' + st.longTerm + '</div><div class="mem-o-lbl">长期记忆</div></div>',
      '    <div class="mem-o-card"><div class="mem-o-num">' + st.shortTerm + '</div><div class="mem-o-lbl">短期缓冲</div></div>',
      '    <div class="mem-o-card"><div class="mem-o-num">' + (pool.perception || 0) + '</div><div class="mem-o-lbl">感知层</div></div>',
      '    <div class="mem-o-card"><div class="mem-o-num">' + (pool.temporal || 0) + '</div><div class="mem-o-lbl">时间层</div></div>',
      '  </div>'
    ].join('
');
    this.container.innerHTML = header + this._body(st);
    this._bindEvents();
  }

  _body(st) {
    if (this.tab === 'emotion') return this._emotionTab();
    if (this.tab === 'sense') return this._senseTab();
    if (this.tab === 'awake') return this._awakeTab();
    return this._listTab();
  }

  _listTab() {
    const items = this.app.data.getTimeline(30);
    const listHtml = items.length ? items.map(m => this._row(m)).join('') : '<div class="mem-none">对话积累到一定量后，记忆会自动沉淀到这里</div>';
    return [
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-magnifying-glass"></i> 检索记忆</div>',
      '    <div class="mem-search-row"><input id="mem-q" placeholder="输入关键词, 如: 海边 / 面馆" /><button id="mem-search-btn">搜索</button></div>',
      '    <div id="mem-results" class="mem-results"></div>',
      '  </div>',
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-clock-rotate-left"></i> 最近沉淀</div>',
      '    <div class="mem-list" id="mem-list">' + listHtml + '</div>',
      '  </div>',
      this._footer()
    ].join('
');
  }

  _footer() {
    const st = this.app.data.getStats();
    return [
      '  <div class="mem-footer">',
      '    <label class="mem-toggle"><input type="checkbox" id="mem-auto" ' + (st.config.autoInject ? 'checked' : '') + ' /><span><i class="fa-solid fa-wand-magic-sparkles"></i> 自动注入 AI 上下文</span></label>',
      '    <button class="mem-danger" id="mem-clear"><i class="fa-solid fa-trash"></i> 清空当前聊天记忆</button>',
      '  </div>',
      '</div>'
    ].join('
');
  }

  _emotionTab() {
    const hist = this.app.data.getEmotionHistory(60);
    if (!hist.length) return '<div class="mem-section"><div class="mem-none">还没有足够的情感数据</div></div>' + this._footer();
    // 折线: 用 SVG polyline 画 valence 曲线 + 情绪标签点
    const W = 300, H = 130, pad = 10;
    const x = (i) => pad + (i / Math.max(1, hist.length - 1)) * (W - pad * 2);
    const y = (v) => H - pad - (v || 0.5) * (H - pad * 2);
    const line = hist.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.valence).toFixed(1)).join(' ');
    const pts = hist.map((p, i) => {
      const col = p.valence > 0.6 ? '#f59e0b' : p.valence < 0.4 ? '#60a5fa' : '#9ca3af';
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.valence).toFixed(1) + '" r="3" fill="' + col + '"><title>' + this._esc(p.label + ' ' + p.content) + '</title></circle>';
    }).join('');
    return [
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-chart-line"></i> 情感起伏 (valence 情绪极性)</div>',
      '    <div class="mem-chart-card">',
      '      <svg viewBox="0 0 ' + W + ' ' + H + '" class="mem-chart">',
      '        <line x1="' + pad + '" y1="' + y(0.5).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y(0.5).toFixed(1) + '" stroke="#e5e7eb" stroke-dasharray="4,4"/>',
      '        <polyline points="' + line + '" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
      '        ' + pts,
      '      </svg>',
      '      <div class="mem-chart-legend"><span class="lg pos">开心</span><span class="lg neu">中性</span><span class="lg neg">低落</span></div>',
      '    </div>',
      '  </div>',
      this._footer()
    ].join('
');
  }

  _awakeTab() {
    const aw = this.app.data.awakening;
    const st = aw ? aw.getStatus() : null;
    if (!st) return '<div class="mem-section"><div class="mem-none">唤醒引擎未初始化</div></div>' + this._footer();
    const feels = (aw.state.feel || []);
    const feelHtml = feels.length ? feels.map(f => '<div class="mem-feel-item"><span class="mem-feel-label">' + this._esc(f.label) + '</span><div class="mem-feel-text">' + this._esc(f.feel) + '</div></div>').join('') : '<div class="mem-none">暂无昨日感受 (巩固后生成)</div>';
    return [
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-moon"></i> 昨日感受 (情绪结晶)</div>',
      '    <div class="mem-feels">' + feelHtml + '</div>',
      '  </div>',
      '  <div class="mem-section">',
      '    <div class="mem-section-title"><i class="fa-solid fa-clock-rotate-left"></i> 系统状态</div>',
      '    <div class="mem-awake-stats">',
      '      <div class="mem-awake-row"><span>上次唤醒</span><b>' + this._fmt(st.lastAwakenAt) + '</b></div>',
      '      <div class="mem-awake-row"><span>上次睡眠</span><b>' + this._fmt(st.lastSleepAt) + '</b></div>',
      '      <div class="mem-awake-row"><span>回声次数</span><b>' + st.echoUsed + '</b></div>',
      '      <div class="mem-awake-row"><span>错记 / 已纠正</span><b>' + st.misremembered + ' / ' + st.fixed + '</b></div>',
      '    </div>',
      '  </div>',
      this._footer()
    ].join('
');
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
    this.container.querySelectorAll('.mem-tab')?.forEach(btn => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this._draw(); });
    });
    q('#mem-sleep')?.addEventListener('click', () => {
      const r = this.app.data.sleep();
      window.toastr?.success(r && r.consolidated ? '已巩固 ' + r.consolidated + ' 条记忆' : '没有待巩固的记忆', '记忆');
      this._draw();
    });
    q('#mem-search-btn')?.addEventListener('click', () => this._doSearch());
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
