/**
 * 图谱 App (Graph App) - 视图组件
 * 联动 LonSha 记忆引擎的知识图谱可视化 (GraphBridge)
 * 展示: 概览 / 节点检索 / 关系图 / 剧情时间线 / 角色日记
 */

export class GraphView {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.tab = 'overview';
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '"');
  }

  _fmt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d)) return '';
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return ''; }
  }

  _draw() {
    const bridge = this.app.data;
    const ok = bridge ? bridge.probe() : false;
    const ov = bridge ? bridge.getOverview() : null;

    const tabs = ['overview', 'search', 'timeline', 'diary'];
    const tabNames = { overview: '图谱', search: '检索', timeline: '时间线', diary: '日记' };

    const html = [
      '<div class="gph-root">',
      '  <header class="gph-header">',
      '    <button class="gph-back" id="gph-back"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2 class="gph-title"><i class="fa-solid fa-diagram-project"></i> 知识图谱</h2>',
      '    <button class="gph-sync" id="gph-sync" title="同步手机记忆到图谱"><i class="fa-solid fa-arrows-rotate"></i></button>',
      '  </header>',
      ok === false ? '<div class="gph-empty"><i class="fa-solid fa-plug-circle-xmark"></i><p>未检测到 LonSha 记忆引擎<br/>请先安装 <b>lonsha-memory-plugin</b> 并开启</p></div>' : '',
      ok ? '  <div class="gph-tabs">' + tabs.map(t => '<button class="gph-tab ' + (this.tab === t ? 'active' : '') + '" data-tab="' + t + '">' + tabNames[t] + '</button>').join('') + '</div>' : '',
      ok ? '  <div class="gph-body" id="gph-body">' + this._body(ov) + '</div>' : ''
    ].join('\n');
    this.container.innerHTML = html;
    this._bind();
  }

  _body(ov) {
    const t = this.tab;
    if (t === 'overview') {
      const byType = ov.byType || {};
      const typeHtml = Object.keys(byType).length
        ? Object.entries(byType).map(([k, v]) => '<span class="gph-type-chip">' + this._esc(k) + ' ' + v + '</span>').join('')
        : '<span class="gph-type-chip">暂无节点</span>';
      return [
        '<div class="gph-overview-cards">',
        '  <div class="gph-o-card"><div class="gph-o-num">' + ov.nodes + '</div><div class="gph-o-lbl">图谱节点</div></div>',
        '  <div class="gph-o-card"><div class="gph-o-num">' + ov.edges + '</div><div class="gph-o-lbl">关系边</div></div>',
        '  <div class="gph-o-card"><div class="gph-o-num">' + ov.summaries + '</div><div class="gph-o-lbl">摘要</div></div>',
        '  <div class="gph-o-card"><div class="gph-o-num">' + ov.diaries + '</div><div class="gph-o-lbl">角色日记</div></div>',
        '</div>',
        '<div class="gph-section"><div class="gph-section-title">节点类型分布</div><div class="gph-chips">' + typeHtml + '</div></div>',
        '<div class="gph-section"><div class="gph-section-title">数据源</div><p class="gph-src">' + (ov.source === 'runtime' ? '运行实例 (实时)' : '存储快照') + '</p></div>'
      ].join('\n');
    }
    if (t === 'search') {
      return [
        '<div class="gph-search-row"><input id="gph-q" placeholder="搜索角色 / 事件 / 地点..." /><button id="gph-search-btn">搜索</button></div>',
        '<div class="gph-results" id="gph-results"></div>'
      ].join('\n');
    }
    if (t === 'timeline') {
      const tl = this.app.data.getTimeline(60);
      const items = tl.length ? tl.map(ev =>
        '<div class="gph-tl-item"><span class="gph-tl-time">' + this._fmt(ev.time) + '</span><span class="gph-tl-src ' + ev.source + '">' + (ev.source === 'lonsha' ? '图谱' : '手机') + '</span><div class="gph-tl-text">' + this._esc(ev.text) + '</div></div>'
      ).join('') : '<div class="gph-none">暂无时间线事件</div>';
      return '<div class="gph-tl">' + items + '</div>';
    }
    if (t === 'diary') {
      const diaries = this.app.data.getDiaries();
      const items = diaries.length ? diaries.map(d => {
        const c = d.content || d.text || d.entry || '';
        const who = d.char || d.character || d.name || '';
        return '<div class="gph-diary-item"><div class="gph-diary-who">' + this._esc(who) + '</div><div class="gph-diary-text">' + this._esc(c) + '</div><div class="gph-diary-time">' + this._fmt(d.timestamp || d.date || d.time) + '</div></div>';
      }).join('') : '<div class="gph-none">暂无角色日记</div>';
      return '<div class="gph-diary">' + items + '</div>';
    }
    return '';
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    q('#gph-back')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#gph-sync')?.addEventListener('click', () => {
      const r = this.app.data.syncToGraph ? this.app.data.syncToGraph({ minImportance: 7 }) : { ok: false, reason: 'no-sync-method' };
      window.toastr?.info(r.ok ? ('已同步 ' + r.pushed + ' 条手机记忆到图谱') : ('同步跳过: ' + (r.reason || '未知')), '图谱');
    });
    this.container.querySelectorAll('.gph-tab')?.forEach(btn => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this._draw(); });
    });
    q('#gph-search-btn')?.addEventListener('click', () => this._doSearch());
    q('#gph-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') this._doSearch(); });
  }

  _doSearch() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#gph-q')?.value?.trim();
    const box = q('#gph-results');
    if (!box) return;
    if (!kw) { box.innerHTML = ''; return; }
    const hits = this.app.data.search(kw, 12) || [];
    box.innerHTML = hits.length ? hits.map(h => {
      const kind = h._kind === 'neighbor' ? '<span class="gph-kind nb">关联</span>' : '<span class="gph-kind">节点</span>';
      const via = h._via ? '<span class="gph-via">' + this._esc(h._via) + '</span>' : '';
      return '<div class="gph-res-item gph-clickable" data-node-id="' + this._esc(h.id || '') + '">' + kind + '<span class="gph-res-name">' + this._esc(h.name || h.id || '') + '</span>' + via + '<div class="gph-res-text">' + this._esc(h.content || h.summary || '') + '</div><div class="gph-res-score">' + (h._score || 0).toFixed(2) + '</div></div>';
    }).join('') : '<div class="gph-none">没有匹配的图谱节点</div>';
    // B3: 绑定点击 → 展开节点详情
    box.querySelectorAll('.gph-clickable').forEach(el => {
      el.addEventListener('click', () => this._showNodeDetail(el.dataset.nodeId));
    });
  }

  /** B3: 节点详情 — 关系链 + 相关记忆 */
  _showNodeDetail(nodeId) {
    if (!nodeId) return;
    const bridge = this.app.data;
    const q = (sel) => this.container.querySelector(sel);
    const box = q('#gph-results');
    if (!box) return;

    // 找节点本体
    const data = bridge.getData ? bridge.getData() : null;
    const node = (data?.graph?.nodes || []).find(n => n.id === nodeId) || { id: nodeId, name: nodeId, content: '' };
    const relations = bridge.getRelations ? bridge.getRelations(nodeId) : [];

    // 手机侧相关记忆
    let phoneHits = [];
    try {
      const core = window.VirtualPhone?.memoryCore;
      if (core && node.name) phoneHits = (core.recall(node.name, 5) || []).slice(0, 5);
    } catch (e) {}

    const relHtml = relations.length ? relations.map(r => {
      const dir = r.direction === 'out' ? '→' : '←';
      return '<div class="gph-rel-item"><b>' + this._esc(r.from) + '</b> <span class="gph-rel-label">' + this._esc(r.label) + '</span> ' + dir + ' <b>' + this._esc(r.to) + '</b></div>';
    }).join('') : '<div class="gph-none">暂无关联关系</div>';

    const memHtml = phoneHits.length ? phoneHits.map(h =>
      '<div class="gph-mem-item"><span class="gph-mem-layer">' + this._esc(h.layer || '') + '</span><div class="gph-mem-text">' + this._esc(String(h.content || '').slice(0, 120)) + '</div></div>'
    ).join('') : '<div class="gph-none">手机侧暂无相关记忆</div>';

    box.innerHTML = [
      '<div class="gph-detail">',
      '  <div class="gph-detail-head">',
      '    <span class="gph-detail-name">' + this._esc(node.name || node.id) + '</span>',
      '    <span class="gph-detail-type">' + this._esc(node.type || 'node') + '</span>',
      '    <button class="gph-detail-back" id="gph-detail-back">返回</button>',
      '  </div>',
      node.content ? '  <div class="gph-detail-content">' + this._esc(node.content) + '</div>' : '',
      '  <div class="gph-detail-section"><div class="gph-section-title">关系链 (' + relations.length + ')</div>' + relHtml + '</div>',
      '  <div class="gph-detail-section"><div class="gph-section-title">手机侧相关记忆</div>' + memHtml + '</div>',
      '</div>'
    ].join('\n');

    q('#gph-detail-back')?.addEventListener('click', () => this._doSearch());
  }
}

export default GraphView;