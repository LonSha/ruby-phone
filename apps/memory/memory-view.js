/**
 * 记忆 App - 视图组件 (MemoryView)
 * iOS 风格: 概览卡 + 洞察分页 + 检索 + 时间线 + 自动注入开关
 *
 * 【v2.57.0 记忆洞察】修前形态：视图只有一个扁平长页 —— 四个计数 + 检索框 + 最近沉淀列表。
 *   引擎已经备好的五感归档 / 场景聚合 / 生命周期四段 / 换代压制 / 情感轨迹
 *   在界面上**一条都看不到**（`getSensoryArchive` / `getSceneTags` 全仓零调用）。
 *   本版把视图改成**分页**结构：概览 / 五感 / 场景 / 体检 四页 + 时间线常驻底部，
 *   让「数据已经在内存里，只是没人显示」的六面读数各自有落脚点。
 *
 * 【视图纪律（与其他 App 视图同规格）】
 *   ① 只吃投影后的数据：不摸 `memoryCore.longTerm` 这类引擎内部结构，
 *      一律经 `app.insights()` 取数（投影失败即空面，不连坐）；
 *   ② 全部文本转义：`_esc` 覆盖 `& < > "`（记忆正文来自正文解析，必须当不可信输入）；
 *   ③ 事件不累积：分页切换用容器级委托 + 幂等标志，重复 render 不叠加监听。
 */
export class MemoryView {
  constructor(app) {
    this.app = app;
    this.container = null;
    /** 当前分页（重绘后保持；非法值回落 overview） */
    this._tab = 'overview';
    this._delegated = false;
  }
  /** 合法分页清单（顺序即界面顺序） */
  static TABS = Object.freeze([
    { id: 'overview', label: '概览', icon: 'fa-chart-simple' },
    { id: 'sense', label: '五感', icon: 'fa-hand-sparkles' },
    { id: 'scene', label: '场景', icon: 'fa-location-dot' },
    { id: 'audit', label: '体检', icon: 'fa-stethoscope' }
  ]);
  render(container) {
    this.container = container;
    this._draw();
  }

  /* ================= 基础工具 ================= */
  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      if (Number.isNaN(d.getTime())) return '';
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return ''; }
  }

  /* ================= 顶部分页条 ================= */
  _tabsHtml() {
    const cur = this._tab;
    return '  <nav class="mem-tabs">' + MemoryView.TABS.map((t) =>
      '<button class="mem-tab' + (t.id === cur ? ' on' : '') + '" data-tab="' + t.id + '">' +
      '<i class="fa-solid ' + t.icon + '"></i> ' + this._esc(t.label) + '</button>'
    ).join('') + '</nav>';
  }

  /* ================= 概览页 ================= */
  _overviewHtml(pkg) {
    const core = pkg.data;
    const st = (core && typeof core.getStats === 'function') ? core.getStats() : { longTerm: 0, shortTerm: 0, pool: {}, stats: {}, config: {} };
    const pool = st.pool || {};
    const audit = pkg.audit;
    const parts = [];
    // 体检条：评级 + 一句总述
    if (audit && audit.counts && (audit.counts.longTerm + audit.counts.shortTerm + audit.counts.pool) > 0) {
      parts.push('<div class="mem-audit-bar" style="--ag:' + this._esc(audit.color) + '">' +
        '<span class="mem-audit-dot"></span><b>' + this._esc(audit.gradeLabel) + '</b>' +
        '<span class="mem-audit-sum">' + this._esc(pkg.summary) + '</span></div>');
    } else {
      parts.push('<div class="mem-audit-bar" style="--ag:#9ca3af"><span class="mem-audit-dot"></span><b>尚无沉淀</b>' +
        '<span class="mem-audit-sum">' + this._esc(pkg.summary) + '</span></div>');
    }
    // 四个主计数
    parts.push('  <div class="mem-overview">' +
      '<div class="mem-o-card"><div class="mem-o-num">' + (st.longTerm || 0) + '</div><div class="mem-o-lbl">长期记忆</div></div>' +
      '<div class="mem-o-card"><div class="mem-o-num">' + (st.shortTerm || 0) + '</div><div class="mem-o-lbl">短期缓冲</div></div>' +
      '<div class="mem-o-card"><div class="mem-o-num">' + (pool.perception || 0) + '</div><div class="mem-o-lbl">感知层</div></div>' +
      '<div class="mem-o-card"><div class="mem-o-num">' + (pool.temporal || 0) + '</div><div class="mem-o-lbl">时间层</div></div>' +
      '</div>');
    // 情感轨迹（按天，成条的柱状）
    if (Array.isArray(pkg.trace) && pkg.trace.length) {
      const maxC = Math.max(...pkg.trace.map((t) => t.count), 1);
      parts.push('  <div class="mem-section">' +
        '<div class="mem-section-title"><i class="fa-solid fa-wave-square"></i> 情感轨迹（近 14 天）</div>' +
        '<div class="mem-trace">' + pkg.trace.map((t) => {
          const h = Math.max(6, Math.round(t.count / maxC * 40));
          const a = t.avgArousal === null ? 0.5 : t.avgArousal;
          const col = a >= 0.66 ? '#ef4444' : (a >= 0.4 ? '#f59e0b' : '#60a5fa');
          return '<div class="mem-trace-col" title="' + this._esc(t.label + ' · ' + t.count + ' 条 · 强度 ' + (t.avgArousal === null ? '—' : t.avgArousal)) + '">' +
            '<div class="mem-trace-bar" style="height:' + h + 'px;background:' + col + '"></div>' +
            '<div class="mem-trace-lbl">' + this._esc(t.label) + '</div></div>';
        }).join('') + '</div>' +
        '<div class="mem-hint">柱高＝当天沉淀条数，颜色＝平均情绪强度（红＝激烈 / 蓝＝平静）</div></div>');
    }
    // 检索
    parts.push('  <div class="mem-section">' +
      '    <div class="mem-section-title"><i class="fa-solid fa-magnifying-glass"></i> 检索记忆</div>' +
      '    <div class="mem-search-row"><input id="mem-q" placeholder="输入关键词, 如: 海边 / 面馆" /><button id="mem-search-btn">搜索</button></div>' +
      '    <div id="mem-results" class="mem-results"></div>' +
      '  </div>');
    // 最近沉淀
    const items = (core && typeof core.getTimeline === 'function') ? core.getTimeline(30) : [];
    const listHtml = items.length ? items.map((m) => this._row(m)).join('')
      : '<div class="mem-none">对话积累到一定量后，记忆会自动沉淀到这里</div>';
    parts.push('  <div class="mem-section">' +
      '    <div class="mem-section-title"><i class="fa-solid fa-clock-rotate-left"></i> 最近沉淀</div>' +
      '    <div class="mem-list" id="mem-list">' + listHtml + '</div>' +
      '  </div>');
    return parts.join('\n');
  }

  /* ================= 五感页 ================= */
  _senseHtml(pkg) {
    const rows = Array.isArray(pkg.senses) ? pkg.senses : [];
    if (!rows.length) {
      return '<div class="mem-none">还没有带感官细节的记忆<br><span class="mem-hint">当对话里出现气味、触感、声音等描写时，会自动归档到这里</span></div>';
    }
    return rows.map((r) => {
      const items = r.items.map((it) =>
        '<div class="mem-sense-item">' +
        '<div class="mem-sense-text">' + this._esc(it.content) + '</div>' +
        '<div class="mem-sense-meta">' + (it.age ? this._esc(it.age) : '') +
        (it.weight ? ' · 强度 ' + this._esc(it.weight.toFixed ? it.weight.toFixed(2) : it.weight) : '') + '</div>' +
        '</div>').join('');
      return '<div class="mem-sense-card" style="--sc:' + this._esc(r.color) + '">' +
        '<div class="mem-sense-head"><span class="mem-sense-icon">' + r.icon + '</span>' +
        '<span class="mem-sense-label">' + this._esc(r.label) + '</span>' +
        '<span class="mem-sense-count">' + r.count + ' 条</span></div>' +
        '<div class="mem-sense-body">' + items + '</div></div>';
    }).join('');
  }

  /* ================= 场景页 ================= */
  _sceneHtml(pkg) {
    const rows = Array.isArray(pkg.scenes) ? pkg.scenes : [];
    if (!rows.length) {
      return '<div class="mem-none">还没有按地点聚起来的记忆<br><span class="mem-hint">带地点标注的对话会归到对应场景下</span></div>';
    }
    return rows.map((r) => {
      const chips = r.senses.map((s) =>
        '<span class="mem-scene-chip" style="--cc:' + this._esc(s.color) + '">' + s.icon + this._esc(s.label) + ' ' + s.count + '</span>'
      ).join('');
      const samples = r.samples.map((s) => '<div class="mem-scene-sample">' + this._esc(s) + '</div>').join('');
      return '<div class="mem-scene-card">' +
        '<div class="mem-scene-head"><i class="fa-solid fa-location-dot"></i>' +
        '<span class="mem-scene-place">' + this._esc(r.place) + '</span>' +
        '<span class="mem-scene-count">' + r.count + ' 条</span></div>' +
        (chips ? '<div class="mem-scene-chips">' + chips + '</div>' : '') +
        (samples ? '<div class="mem-scene-samples">' + samples + '</div>' : '') +
        '</div>';
    }).join('');
  }

  /* ================= 体检页 ================= */
  _auditHtml(pkg) {
    const a = pkg.audit;
    if (!a) return '<div class="mem-none">体检读数不可用（已降级，不影响已有记忆）</div>';
    const parts = [];
    parts.push('<div class="mem-audit-card" style="--ag:' + this._esc(a.color) + '">' +
      '<div class="mem-audit-grade">' + this._esc(a.gradeLabel) + '</div>' +
      '<div class="mem-audit-counts">' +
      '<span>长期 ' + a.counts.longTerm + '</span>' +
      '<span>短期 ' + a.counts.shortTerm + '</span>' +
      '<span>记忆池 ' + a.counts.pool + '</span>' +
      '<span>已收藏 ' + a.counts.pinned + '</span>' +
      '<span>已换代 ' + a.counts.superseded + '</span>' +
      '<span>冻结/墓碑 ' + a.counts.guarded + '</span>' +
      '</div></div>');
    if (!a.issues.length) {
      parts.push('<div class="mem-none">没有发现需要处理的问题</div>');
    } else {
      const ICON = { info: 'fa-circle-info', warn: 'fa-triangle-exclamation', bad: 'fa-circle-exclamation' };
      const COL = { info: '#60a5fa', warn: '#f59e0b', bad: '#ef4444' };
      parts.push(a.issues.map((i) =>
        '<div class="mem-issue" style="--ic:' + (COL[i.level] || '#9ca3af') + '">' +
        '<div class="mem-issue-top"><i class="fa-solid ' + (ICON[i.level] || 'fa-circle-info') + '"></i>' +
        '<span>' + this._esc(i.text) + '</span></div>' +
        '<div class="mem-issue-advice"><i class="fa-solid fa-lightbulb"></i> ' + this._esc(i.advice) + '</div>' +
        '</div>').join(''));
    }
    // 生命周期分布
    const lc = pkg.lifecycle;
    if (lc && Array.isArray(lc.rows) && lc.rows.length) {
      parts.push('<div class="mem-section-title" style="margin-top:12px"><i class="fa-solid fa-layer-group"></i> 生命周期分布（长期 ' + lc.total + ' 条，其中受保护 ' + lc.protectedCount + ' 条）</div>');
      parts.push(lc.rows.map((r) => {
        const stale = r.stale.map((s) =>
          '<div class="mem-lc-row"><span class="mem-lc-days">' + s.days + ' 天</span>' +
          '<span class="mem-lc-text">' + this._esc(s.content) + '</span>' +
          (s.protected ? '<span class="mem-lc-prot">已保护</span>' : '') + '</div>').join('');
        return '<div class="mem-lc-card" style="--lcc:' + this._esc(r.color) + '">' +
          '<div class="mem-lc-head"><b>' + this._esc(r.label) + '</b><span class="mem-lc-n">' + r.count + ' 条</span></div>' +
          '<div class="mem-hint">' + this._esc(r.hint) + '</div>' +
          (stale ? '<div class="mem-lc-list">' + stale + '</div>' : '') +
          '</div>';
      }).join(''));
    }
    // 换代对读
    if (Array.isArray(pkg.supersede) && pkg.supersede.length) {
      parts.push('<div class="mem-section-title" style="margin-top:12px"><i class="fa-solid fa-right-left"></i> 换代对读（' + pkg.supersede.length + ' 组，正文都还在）</div>');
      parts.push(pkg.supersede.map((p) =>
        '<div class="mem-sup-card">' +
        '<div class="mem-sup-old"><span class="mem-sup-tag old">旧</span>' + this._esc(p.oldText) + '</div>' +
        '<div class="mem-sup-arrow">↓ 被顶掉' + (p.heldDays === null ? '' : '（' + p.heldDays + ' 天前）') + '</div>' +
        '<div class="mem-sup-new"><span class="mem-sup-tag new">新</span>' +
        (p.byMissing ? '<span class="mem-sup-missing">顶掉它的条目已不在池中（旧条目下次巩固会自动复活）</span>' : this._esc(p.byText)) +
        '</div></div>').join(''));
    }
    return parts.join('\n');
  }

  /* ================= 记忆条目行 ================= */
  _row(m) {
    const emo = m.emotion || {};
    const tag = emo.label ? '<span class="mem-emo" style="--emo:' + this._emoColor(emo.label) + '">' + this._esc(emo.label) + '</span>' : '';
    const role = m.role === 'user' ? '我' : 'TA';
    const roleCls = m.role === 'user' ? 'ru' : 'ra';
    // LonSha 回填的提炼记忆加徽标 (内容带 [剧情]/[事件]/[关系] 前缀)
    const lonshaTag = /^\[(剧情|事件|关系)\]/.test(m.content || '') ? '<span class="mem-lonsha">LLM</span>' : '';
    const lc = (m.metadata && m.metadata._lifecycle) || '';
    const lcTag = lc && lc !== 'active' ? '<span class="mem-lc-tag">' + this._esc({ cooling: '降温', frozen: '冻结', tombstone: '墓碑' }[lc] || lc) + '</span>' : '';
    const supTag = (m.metadata && m.metadata._superseded === 'superseded') ? '<span class="mem-sup-tag" title="已被后来的剧情顶掉（正文保留，可复活）">已换代</span>' : '';
    return '<div class="mem-item">' +
      '<div class="mem-item-top"><span class="mem-role ' + roleCls + '">' + role + '</span>' + lonshaTag + tag + lcTag + supTag +
      (m.storyTime ? '<span class="mem-stime">' + this._esc(m.storyTime) + '</span>' : '') +
      '<span class="mem-time">' + this._fmt(m.createdAt) + '</span>' +
      (m.pinned ? '<span class="mem-pin" title="已收藏">📌</span>' : '<span class="mem-pin-btn" title="收藏（不会被衰减清理）" data-mid="' + this._esc(m.id || '') + '">☆</span>') + '</div>' +
      '<div class="mem-item-text">' + this._esc(m.content) + '</div>' +
      '</div>';
  }

  /* ================= 主绘制 ================= */
  _draw() {
    const pkg = this.app.insights({ perSense: 4, perScene: 2, perStage: 3, traceDays: 14 });
    if (!pkg.data) {
      this.container.innerHTML = '<div class="mem-root"><div class="mem-none">记忆系统未初始化，请刷新酒馆后重试</div></div>';
      return;
    }
    // 非法分页回落（防外部污染 _tab 后渲染空白）
    const valid = MemoryView.TABS.some((t) => t.id === this._tab);
    if (!valid) this._tab = 'overview';
    let body;
    if (this._tab === 'sense') body = this._senseHtml(pkg);
    else if (this._tab === 'scene') body = this._sceneHtml(pkg);
    else if (this._tab === 'audit') body = this._auditHtml(pkg);
    else body = this._overviewHtml(pkg);

    const core = pkg.data;
    const autoOn = !!(core && core.config && core.config.autoInject);
    const html = [
      '<div class="mem-root">',
      '  <header class="mem-header">',
      '    <button class="mem-back" id="mem-back"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2 class="mem-title"><i class="fa-solid fa-brain"></i> 记忆</h2>',
      '    <button class="mem-sleep" id="mem-sleep" title="立即巩固"><i class="fa-solid fa-moon"></i></button>',
      '  </header>',
      this._tabsHtml(),
      '  <div class="mem-body">',
      body,
      '  </div>',
      '  <div class="mem-footer">',
      '    <label class="mem-toggle"><input type="checkbox" id="mem-auto" ' + (autoOn ? 'checked' : '') + ' /><span><i class="fa-solid fa-wand-magic-sparkles"></i> 自动注入 AI 上下文</span></label>',
      '    <button class="mem-danger" id="mem-clear"><i class="fa-solid fa-trash"></i> 清空当前聊天记忆</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    this.container.innerHTML = html;
    this._bindEvents();
  }

  /* ================= 事件绑定 ================= */
  _bindEvents() {
    const q = (sel) => this.container.querySelector(sel);
    q('#mem-back')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#mem-sleep')?.addEventListener('click', () => {
      this.app.sleepNow();
      this._draw();
    });
    q('#mem-search-btn')?.addEventListener('click', () => this._doSearch());
    q('#mem-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._doSearch(); });
    q('#mem-auto')?.addEventListener('change', (e) => {
      try { this.app.data?.updateConfig({ autoInject: e.target.checked }); } catch (_e) { /* 忽略 */ }
      window.toastr?.info(e.target.checked ? '已开启自动注入' : '已关闭自动注入', '记忆');
    });
    q('#mem-clear')?.addEventListener('click', () => {
      if (!confirm('确定清空当前聊天的全部记忆?')) return;
      try { this.app.data?.clearCurrentChat?.(); } catch (_e) { /* 忽略 */ }
      this._draw();
    });
    // 容器级委托（幂等：只挂一次，避免重复 render 叠加监听）
    if (!this._delegated) {
      this._delegated = true;
      this.container.addEventListener('click', (e) => {
        // 分页切换
        const tab = e.target.closest('.mem-tab');
        if (tab && this.container.contains(tab)) {
          const id = tab.getAttribute('data-tab');
          if (id && MemoryView.TABS.some((t) => t.id === id) && id !== this._tab) {
            this._tab = id;
            this._draw();
          }
          return;
        }
        // 收藏
        const btn = e.target.closest('.mem-pin-btn');
        if (btn && this.container.contains(btn)) {
          const mid = btn.getAttribute('data-mid');
          if (mid && this.app.data?.pin?.(mid, true)) this._draw();
        }
      });
    }
  }

  _doSearch() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#mem-q')?.value?.trim();
    const box = q('#mem-results');
    if (!box) return;
    if (!kw) { box.innerHTML = ''; return; }
    let hits = [];
    try { hits = this.app.data?.recall?.(kw, 8) || []; } catch (_e) { hits = []; }
    box.innerHTML = hits.length
      ? hits.map((h) => {
        const perm = h.permissionLabel ? '<span class="mem-res-perm">' + this._esc(h.permissionLabel) + '</span>' : '';
        const sc = Number.isFinite(Number(h._score)) ? Number(h._score).toFixed(2) : '—';
        return '<div class="mem-res"><div class="mem-res-lbl">' + this._esc(h.layer) +
          ' <span class="mem-res-score">' + sc + '</span>' + perm + '</div>' +
          '<div class="mem-res-text">' + this._esc(h.content) + '</div></div>';
      }).join('')
      : '<div class="mem-none">没有相关记忆</div>';
  }
}
export default MemoryView;