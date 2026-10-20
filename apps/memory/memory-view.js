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
import { numOrNull } from '../../config/num-gate.js';
/* [v4.13.0 · R4-O1] 出处靶心归一(纯函数)。本视图只用它排版:哪一行给按钮、
 *   按钮点了该去哪、去不成该说什么。**视图不自己判靶心形态** —— 自己判的话
 *   `kind` 会漂(chat / floor / chat-floor 迟早三种写法同时存在),而
 *   「本版宿主没有定位口」与「这一楼删了」会被压成同一句「打不开」——
 *   前者等升级、后者去翻历史楼,处置相反。 */
import { normalizeSource, isLocatable, sourceLocatorLine, sourceOpenRef, locateResultLine } from '../../config/source-locator.js';
/* [v4.14.0 · R4-O2] 运行态与进度的人读文案:六态互不同形全在那件里,
 *   本视图**不自己判一份**(自己判就会把「已取消」与「被新问题顶掉」压成同一句)。 */
import { ASK_RUN_STATES, askRunLine } from '../../config/ask-request.js';
/* [v4.22.0 · R4-X1] 追问轨迹一行的人读文案(口要在哪、各态怎么说,全在契约件里一处判)。
 *   本视图**不自己拼**那一行:自己拼就会把「待消歧(本次没查)」与「沿用条件」压成同一句。 */
import { traceLineOf, ASK_THREAD_LIMITS } from '../../config/memory-ask-thread.js';
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
    { id: 'ask', label: '问往事', icon: 'fa-comment-dots' },
    { id: 'audit', label: '体检', icon: 'fa-stethoscope' },
    { id: 'coverage', label: '覆盖度', icon: 'fa-layer-group' }
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

  /* ================= 覆盖度页 ================= */
  /**
   * [v2.62.0] 楼层覆盖度页：把「记忆系统对聊天的覆盖情况」读成有名有数的界面。
   * 只读分态报告：ok（真读数）/ unavailable（模块未挂载或取数抛错）/ absent（宿主上下文不可得），
   * 绝不编数顶替。数据经 `app.coverage()` 单一出口，视图不摸 window。
   */
  _coverageHtml(pkg) {
    const c = (pkg && typeof pkg === 'object') ? pkg.coverage : null;
    if (!c || typeof c !== 'object') {
      return '<div class="mem-none">覆盖度读数不可用（已降级，不影响已有记忆）</div>';
    }
    if (c.state === 'absent') {
      return '<div class="mem-none">宿主聊天上下文不可得，暂无法统计覆盖度</div>';
    }
    if (c.state === 'unavailable') {
      return '<div class="mem-none">覆盖度模块未加载（floor-ledger.js）<br>' +
        '<span class="mem-hint">记忆引擎的楼层账本模块未随插件载入，装好后这里会显示逐楼盖章情况</span></div>';
    }
    const parts = [];
    // 顶部读数条：覆盖率大数 + 一行归因
    const ratePct = (c.rate === null || c.rate === undefined) ? null : Math.round(c.rate * 100);
    const color = c.complete ? '#10b981' : (ratePct !== null && ratePct >= 80 ? '#f59e0b' : '#ef4444');
    parts.push('<div class="mem-cov-hero" style="--ag:' + color + '">' +
      '<div class="mem-cov-rate">' + (ratePct === null ? '—' : ratePct + '%') + '</div>' +
      '<div class="mem-cov-line">' + this._esc(c.line || '—') + '</div></div>');
    // 缺口归因分布
    if (Array.isArray(c.byWhy) && c.byWhy.length) {
      parts.push('<div class="mem-cov-why"><div class="mem-section-title"><i class="fa-solid fa-clipboard-question"></i> 缺口归因（' +
        c.missingCount + ' 楼未盖章）</div>' +
        c.byWhy.map((b) =>
          '<div class="mem-cov-why-row"><i class="fa-solid ' + this._esc(b.icon || 'fa-circle-question') + '"></i>' +
          '<span class="mem-cov-why-label">' + this._esc(b.label) + '</span>' +
          '<span class="mem-cov-why-count">×' + b.count + '</span></div>').join('') +
        '</div>');
    }
    // 缺楼清单（逐楼列号；被 maxMissing 截断时如实标注）
    if (Array.isArray(c.missing) && c.missing.length) {
      const chips = c.missing.map((n) => '<span class="mem-cov-floor">第' + n + '楼</span>').join('');
      parts.push('<div class="mem-section"><div class="mem-section-title"><i class="fa-solid fa-list-check"></i> 缺口楼号</div>' +
        '<div class="mem-cov-missing">' + chips + '</div>' +
        (c.missingCount > c.missing.length
          ? '<div class="mem-hint">共 ' + c.missingCount + ' 楼有缺口，此处显示前 ' + c.missing.length + ' 个</div>'
          : '') +
        '</div>');
    }
    if (c.complete) {
      parts.push('<div class="mem-none" style="color:#10b981">当前所有参与统计的楼层都已被记忆系统盖章，无缺口</div>');
    }
    if (c.total === 0) {
      parts.push('<div class="mem-none">还没有可统计的 AI 楼层<br><span class="mem-hint">番外楼与空楼不计入覆盖度</span></div>');
    }
    return parts.join('\n');
  }

  /* ================= 问往事页（R3-X2） ================= */
  /**
   * [v3.97.0 · R3-X2] 「问往事」页：消费上游 `memoryQaAnswer`（唯一真源），
   *   本视图**只排版**，不合成答案、不补缺口（取数在 `app.askPast()`）。
   *
   * 【四态各有各的形（本仓最贵的老账）】
   *   · 有答案      ⇒ 逐句列出（每句带出处：账名 + 楼层，可点开）
   *   · 问了没命中  ⇒ 明说「问了、扫了、没命中」+ 缺口具名（**不是**「没这功能」）
   *   · 本版没出口  ⇒ 明说「本版插件没有问答出口（等升级）」
   *   · 插件不在场  ⇒ 明说「记忆插件不在场」（**不是**「没有答案」）
   *   压平任何两态都会造出处置相反的两种处境长得一模一样的读数。
   */
  _askHtml(pkg) {
    const qa = (pkg && typeof pkg === 'object') ? pkg.qa : null;
    const parts = [];
    parts.push('  <div class="mem-section">' +
      '    <div class="mem-section-title"><i class="fa-solid fa-comment-dots"></i> 问往事（带出处）</div>' +
      '    <div class="mem-search-row"><input id="mem-ask-q" placeholder="例如：上次林安安谈还款 / 为什么改了约会地点" /><button id="mem-ask-btn">问</button>'
      + '<button id="mem-ask-cancel" class="mem-ask-cancel" hidden>取消</button></div>' +
      '    <div id="mem-ask-run" class="mem-ask-run"></div>' +
      '    <div class="mem-hint">回答来自记忆插件（唯一真源）；答不出时会给「缺口」而**不编**答案。</div>' +
      '    <div id="mem-ask-results" class="mem-results"></div>' +
      '  </div>');
    /* [v4.22.0 · R4-X1] 追问面**独立于问答面**渲染:插件不在场 / 没有追问出口 /
     *   有出口但本会话还没开始,三态各有各的话。**不能连坐**——问答面读不出
     *   (`qa` 为空)是常有的事,而追问面此时照样该如实说出自己是哪一态。 */
    parts.push('<div id="mem-fu-host">' + this._askFollowUpHtml() + '</div>');
    /* [v4.23.0 · R4-X2] 资料导入面**独立于问答面**渲染(同追问面规格):问答面读不出是
     *   常有的事,导入面此时照样该如实说出自己是哪一态。 */
    parts.push('<div id="mem-lore-host">' + this._loreHtml() + '</div>');
    if (!qa) return parts.join('\n');
    parts.push('<div id="mem-ask-face">' + this._askFaceHtml(qa) + '</div>');
    return parts.join('\n');
  }

  /* ================= [v4.22.0 · R4-X1] 接着上一句（追问会话） ================= */
  /**
   * 追问面排版。**只取数、不合成**:
   *   读数行来自 `app.askThreadLine()`,候选行来自 `app.askCandidateRows()`,
   *   轨迹行来自纯函数 `traceLineOf`(各态怎么说,不在此处重判一份)。
   *
   * 【为什么整块可以重画】这一区没有用户输入之外的**未提交状态**:
   *   输入框的值在重画后由 `_doFollowUp` 主动清掉,候选与轨迹都是取数结果,
   *   所以「重画 = 重新取数」不会丢任何东西(比逐元素打补丁更不容易漂)。
   *
   * @param {string} note 本次追问的一句回话(瞬时,不参与持久化)
   */
  _askFollowUpHtml() {
    const read = (fn, dft) => { try { return fn() ?? dft; } catch (_e) { return dft; } };
    const face = String(read(() => this.app.askThreadLine?.(), '') || '');
    const rows = read(() => this.app.askCandidateRows?.(), []) || [];
    const trace = read(() => this.app.askTrace?.(), []) || [];
    /* [v4.36.0 · R5-O9] **时点条件那一格走唯一出处**（`app.askTimeLine()` →
     *   契约件 `timeConditionLine`）。视图**不许**自己拼「时点 ≥N楼」：
     *   旧口径就是在这里（或那一层）硬拼的，于是「截至当时」被读成「以后」——
     *   方向正好相反，而数字看着是对的。
     *   【为什么单独一行显示】它与「人物」不是同一类条件：用户判断「这一问看的是哪一段」
     *   只需要这一句，混在人物后面会读成附注。 */
    const timeLine = String(read(() => this.app.askTimeLine?.(), '') || '');
    const timeRow = timeLine
      ? '<div id="mem-fu-time" class="mem-fu-time">' + this._esc(timeLine) + '</div>'
      : '<div id="mem-fu-time" class="mem-fu-time mem-fu-time-none">本会话还没有时点条件（问一句带「第 N 楼」的就会定下）</div>';
    /* [v4.36.0 · R5-O9] **可撤条件**按钮：轴名与「能不能撤」全部取自上游那张表
     *   （`app.askClearAxes()`），视图**不另立一份轴名清单** —— 两份清单迟早分叉，
     *   而分叉的后果是「按钮点了没反应」（界面说能撤、上游说没这轴）。 */
    const axes = read(() => this.app.askClearAxes?.(), []) || [];
    const clearRow = (Array.isArray(axes) && axes.length)
      ? '<div class="mem-fu-clear"><span class="mem-fu-clear-label">撤掉某个继承条件：</span>' +
        axes.map((a) => '<button class="mem-fu-clear-btn" data-axis="' + this._esc(String(a)) + '">撤 ' + this._esc(String(a)) + '</button>').join('') +
        '</div>'
      : '<div class="mem-fu-clear"><span class="mem-hint">本版插件没给可撤条件清单（追问那一层不支持按轴清除）</span></div>';
    const cands = (Array.isArray(rows) && rows.length)
      ? rows.map((r) => '<button class="mem-fu-cand" data-name="' + this._esc(String((r && r.name) || '')) + '">'
          + this._esc(String((r && r.line) || '')) + '</button>').join('')
      : '<span class="mem-hint">没有待消歧的候选（这一排只在「指代不定」时出现人可选）</span>';
    const tlines = (Array.isArray(trace) && trace.length)
      ? trace.map((s) => '<div class="mem-fu-trace-row">' + this._esc(traceLineOf(s)) + '</div>').join('')
      : '<span class="mem-hint">还没有追问过</span>';
    /* 滚动提示:轨迹到上限后**一直**是上限条数,不显示这一行用户看不出早前的已不再回看。 */
    const dropped = Number(read(() => this.app.askDroppedTotal?.(), 0)) || 0;
    const scroll = dropped > 0
      ? '<div class="mem-fu-scroll">早前 ' + this._esc(String(dropped)) + ' 轮已不再回看（只留最近 ' + this._esc(String(ASK_THREAD_LIMITS.turns)) + ' 轮）</div>'
      : '';
    const note = String(this._fuNote || '');
    return '  <div class="mem-section mem-fu-section">' +
      '    <div class="mem-section-title"><i class="fa-solid fa-turn-down"></i> 接着上一句</div>' +
      '    <div id="mem-fu-face" class="mem-fu-face">' + this._esc(face) + '</div>' +
      timeRow +
      clearRow +
      '    <div class="mem-search-row"><input id="mem-fu-q" placeholder="例如：那后来呢 / 另一个人呢 / 她那晚之后呢" /><button id="mem-fu-btn">追问</button></div>' +
      '    <div class="mem-hint">追问会**沿用**上一轮认下的人与时点；上面那一屏「问往事」每次都从头问。</div>' +
      '    <div id="mem-fu-cands" class="mem-fu-cands">' + cands + '</div>' +
      '    <div id="mem-fu-note" class="mem-fu-note">' + (note ? '<span class="mem-fu-note-text">' + this._esc(note) + '</span>' : '') + '</div>' +
      '    <div class="mem-fu-trace"><div class="mem-fu-trace-title">追问轨迹（只回看条件，不留答案全文）</div>' + scroll + tlines + '</div>' +
      '  </div>';
  }

  /** 追问一句:取数走 `app.askFollowUp()`(唯一出口;它负责派发与回落告知)。 */
  _doFollowUp() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#mem-fu-q')?.value?.trim();
    if (!kw) return;
    let res = null;
    try { res = this.app.askFollowUp?.(kw) || null; } catch (_e) { res = null; }
    if (!res) {
      this._paintFollowUp('追问口读不出：本版 App 未接线（不是「没查到」）');
      return;
    }
    const notes = [];
    if (res.note) notes.push(res.note);
    if (!res.ok) notes.push('本次没有问到（' + String(res.note || '原因未给') + '）');
    this._paintFollowUp(notes.join(' '));
    if (q('#mem-fu-q')) q('#mem-fu-q').value = '';
  }

  /** 消歧点选(**只读**;没认下就保持待消歧)——不替用户在候选里猜一个。 */
  _pickAskCandidate(name) {
    let res = null;
    try { res = this.app.resolveAskPick?.(name) || null; } catch (_e) { res = null; }
    if (!res) { this._paintFollowUp('消歧口读不出：本版 App 未接线'); return; }
    this._paintFollowUp(String(res.note || ''));
  }

  /**
   * [v4.36.0 · R5-O9] 撤掉某个继承条件（**只转交**；本视图不自己改任何条件）。
   *   `axis` 取自上游给的可清轴表（按钮是照那张表画出来的）。
   *   回话**照抄控制器给的 note** —— 它已经把「清成了什么 / 没清成什么」分开说了，
   *   视图再拼一句就会把「清掉了」与「本来就没有」压成同一句。
   */
  _clearAskCondition(axis) {
    let res = null;
    try { res = this.app.clearAskCondition?.(axis) || null; } catch (_e) { res = null; }
    if (!res) { this._paintFollowUp('清除口读不出：本版 App 未接线（不是「清掉了」）'); return; }
    this._paintFollowUp(String(res.note || ''));
  }

  /** 追问区整块重画(面 / 候选 / 轨迹 / 回话一并,避免三处各画各的)。 */
  _paintFollowUp(note) {
    this._fuNote = String(note == null ? '' : note);
    const host = this.container.querySelector('#mem-fu-host');
    if (host) host.innerHTML = this._askFollowUpHtml();
  }

  /* ================= [v4.23.0 · R4-X2] 设定资料导入向导 ================= */
  /**
   * 资料导入分区排版。**只取数、不合成**：
   *   六阶段行来自 `app.loreWizard().stages`（文案在契约件里一处判），
   *   逐段行来自同一个投影（判定已由内核译成五态词）。
   *
   * 【为什么不新增分页】`tests/system-v257.test.mjs` 的 F4 用正则扫全文钉死了六页清单，
   *   新增任意页 id 都会打断它；故本区并入既有「问往事」页，与「接着上一句」并列。
   *
   * 【为什么要说清三件事】读数里最容易被压平的三对：
   *   「未判」 vs 「没有」（映射面没给清单 / 冲突面没给事实）；
   *   「重复导入」 vs 「这次没写」；「计划」 vs 「落笔」。
   *   压平任意一对都会让用户**以为导进去了**，而其实一个字节没落。
   */
  _loreHtml() {
    const read = (fn, dft) => { try { return fn() ?? dft; } catch (_e) { return dft; } };
    const w = read(() => this.app.loreWizard?.(), null);
    if (!w) {
      return '  <div class="mem-section mem-lore-section">' +
        '    <div class="mem-section-title"><i class="fa-solid fa-file-import"></i> 资料导入</div>' +
        '    <div class="mem-none">导入口读不出：本版 App 未接线（不是「这份资料导不进去」）</div>' +
        '  </div>';
    }
    const f = w.face || {};
    const classes = Array.isArray(w.classes) ? w.classes : [];
    const rows = Array.isArray(w.rows) ? w.rows : [];
    const needs = Array.isArray(w.needs) ? w.needs : [];
    const resolved = Array.isArray(w.resolved) ? w.resolved : [];
    /* 六阶段行：缺哪一段就少一行（不补空行 —— 补了就看不出「还没走到」）。 */
    const stages = (Array.isArray(w.stages) ? w.stages : [])
      .map((s) => '<div class="mem-lore-stage">' + this._esc(s) + '</div>').join('');
    /* 逐段行：每行可改类、可选入；判定词来自内核译文。 */
    const rowHtml = rows.map((r) => {
      const opts = classes.map((c) =>
        '<option value="' + this._esc(c.cls) + '"' + (c.cls === r.cls ? ' selected' : '') + '>' +
        this._esc(c.label || c.cls) + '</option>').join('');
      const tags = [];
      if (r.manual) tags.push('人工改过');
      /* 受限段：上游会**跳过并具名**，落笔时一个字节都不写 —— 必须在选之前就说。 */
      if (r.sensitive) tags.push('受限正文(上游会跳过并具名)');
      return '      <div class="mem-lore-row">' +
        '        <div class="mem-lore-rowhead">' +
        '          <label class="mem-lore-pickwrap"><input type="checkbox" class="mem-lore-pick" data-key="' + this._esc(r.key) + '"' +
        (r.picked ? ' checked' : '') + ' />选入</label>' +
        (classes.length
          ? '<span class="mem-lore-clswrap">改类<select class="mem-lore-cls" data-key="' + this._esc(r.key) + '">' + opts + '</select></span>'
          : '<span class="mem-lore-clswrap">类：' + this._esc(r.clsLabel || r.cls) + '（本版插件没给可改类选项）</span>') +
        '          <span class="mem-lore-verdict">' + this._esc(r.verdictLine || '') + '</span>' +
        '        </div>' +
        '        <div class="mem-lore-title">' + this._esc(r.title || r.key) + '</div>' +
        '        <div class="mem-lore-snip">' + this._esc(r.snippet || '') + '</div>' +
        (tags.length ? '<div class="mem-lore-tags">' + this._esc(tags.join(' · ')) + '</div>' : '') +
        '      </div>';
    }).join('');
    const rowsBlock = rows.length ? rowHtml
      : '<div class="mem-none">还没有逐段读数（先读一份资料，再过一遍预览）</div>';
    /* 同名待认：未裁决的段留在待认里，不静默合并。 */
    const needsHtml = needs.map((n) => {
      const btns = (Array.isArray(n.names) ? n.names : []).map((nm) =>
        '<button class="mem-lore-owner" data-key="' + this._esc(n.itemKey) + '" data-owner="' + this._esc(nm) + '">认作 ' + this._esc(nm) + '</button>').join('');
      return '      <div class="mem-lore-need"><div class="mem-lore-needtxt">' + this._esc(n.itemKey) +
        '：与已登记的同名角色对不上（' + this._esc(n.why || 'needs-confirm') + '）—— **未认下不合并**</div>' +
        '<div class="mem-lore-owners">' + (btns || '<span class="mem-hint">上游没给候选</span>') + '</div></div>';
    }).join('');
    const resolvedHtml = resolved.length
      ? resolved.map((x) => '<div class="mem-lore-resolved">已认下：' + this._esc(x.itemKey) + ' → ' + this._esc(x.owner) + '</div>').join('')
      : '';
    /* [v4.33.0 · R5-O6] 三份版本各一行 + 变更读数行。
     *   【为什么三行都要】已应用 / 候选 / 阅读窗口修前恒指同一份 —— 于是界面永远说
     *   「什么都没变」,而真实处境可能是「没得比」或「窗口外的段根本没读到」。
     *   【为什么读数行不在这里拼】句子由契约件 `loreChangedLine` **唯一实现**产出
     *   (「没有基线」/「还没比过」/「窗口候选」三句各不相同),视图只排版 ——
     *   在这里再拼一份就是第二个真源,迟早与判据分叉。
     *   【为什么「只剩引用」要显眼】正文归上游与附件 owner,本版刻意不复制全文;
     *   此时**比不了也回不去**,不能显示成「还没有应用过」。 */
    const V = w.versions || null;
    const ap = (V && V.applied) || null;
    const cd = (V && V.candidate) || null;
    const wn = (V && V.window) || null;
    const verBlock = V
      ? '    <div id="mem-lore-versions" class="mem-lore-versions">' +
        '<div class="mem-lore-verline">已应用：' + (ap && ap.has
          ? (this._esc(String(ap.file || '未命名')) + ' · ' + this._esc(String(ap.key || '')) +
            ' · ' + this._esc(String(ap.chars || 0)) + ' 字符 / ' + this._esc(String(ap.sections || 0)) + ' 段' +
            (ap.bodyInHand ? '' : ' · **只剩引用**(正文不在手上 ⇒ 比不了,也回不去)'))
          : '还没有应用过任何版本(**不是**「什么都没变」)') + '</div>' +
        '<div class="mem-lore-verline">候选：' + (cd && cd.has
          ? (this._esc(String(cd.file || '未命名')) + ' · ' + this._esc(String(cd.key || '')) +
            ' · ' + this._esc(String(cd.chars || 0)) + ' 字符 / ' + this._esc(String(cd.sections || 0)) + ' 段' +
            (cd.partial ? ' · **部分候选**(窗口读 / 被截短 —— 窗口外的段不得据此判「已删除」)' : ''))
          : '还没有读进任何一份') + '</div>' +
        '<div class="mem-lore-verline">阅读窗口：' + (wn && wn.has
          ? (this._esc(String(wn.from || 0)) + ' ~ ' + this._esc(String(wn.to || 0)))
          : '整篇(没有窗口)') + '</div>' +
        /* ★ 这一格**不许兜底拼句**:读数由契约件 `loreChangedLine` 唯一产出,
         *   投影总会给一句(哪怕是「还没比过」)。在这里写 `|| '变更:…'` 就是
         *   第二份实现 —— 判据实测抓到过:视图里那句兜底文案会被当成「自己拼句子」。 */
        '<div id="mem-lore-changed" class="mem-lore-changed">' + this._esc(String(w.changedLine || '')) + '</div>' +
        '</div>'
      : '';
    /* 落笔按钮只在**真有落笔口**时给出；只有预览口时如实说「只能看不能落」。 */
    const canApply = w.outlet === 'parse+apply';
    const dup = (w.plan && w.plan.duplicate === true);
    const note = String(w.note || '');
    return '  <div class="mem-section mem-lore-section">' +
      '    <div class="mem-section-title"><i class="fa-solid fa-file-import"></i> 资料导入（设定 / 前史分层）</div>' +
      '    <div id="mem-lore-face" class="mem-lore-face">' + this._esc(w.line || '') + '</div>' +
      verBlock +
      '    <div class="mem-hint">导入的是**资料**：设定规则与前史各归各的段；不把「看过一本书」当成角色经历过。</div>' +
      '    <div class="mem-search-row">' +
      '      <input type="file" id="mem-lore-file" accept=".txt,.md,.text,text/plain" style="display:none" />' +
      '      <button id="mem-lore-pickfile">选文件</button>' +
      '      <button id="mem-lore-read" class="mem-lore-mini">读粘贴的正文</button>' +
      '      <button id="mem-lore-reset" class="mem-lore-mini">重来一份</button>' +
      '    </div>' +
      '    <textarea id="mem-lore-text" class="mem-lore-text" rows="3" placeholder="或直接粘贴资料正文（剧本 / 设定 / 前史）。不默认上传整本书。"></textarea>' +
      '    <div class="mem-hint">长资料请用「选范围逐段读」：整篇超上限会被上游判截断（读数会说明，不当作读完了）。</div>' +
      '    <div class="mem-search-row">' +
      '      <input id="mem-lore-from" class="mem-lore-num" placeholder="从" />' +
      '      <input id="mem-lore-to" class="mem-lore-num" placeholder="到" />' +
      '      <button id="mem-lore-win" class="mem-lore-mini">选范围逐段读</button>' +
      '      <button id="mem-lore-winnext" class="mem-lore-mini">接着读下一段</button>' +
      '    </div>' +
      '    <div id="mem-lore-stages" class="mem-lore-stages">' + stages + '</div>' +
      '    <div class="mem-search-row">' +
      '      <button id="mem-lore-preview" class="mem-lore-mini">过一遍预览</button>' +
      '      <button id="mem-lore-compare" class="mem-lore-mini">对账（与已应用版本比）</button>' +
      '      <button id="mem-lore-discard" class="mem-lore-mini">取消候选（回到已应用）</button>' +
      '      <button id="mem-lore-plan" class="mem-lore-mini">出计划（只算不写）</button>' +
      '      <button id="mem-lore-apply" class="mem-lore-mini mem-lore-apply"' + ((canApply && !dup) ? '' : ' disabled') + '>' +
      (canApply ? '确认导入' : '本版插件不能落笔') + '</button>' +
      '    </div>' +
      '    <div class="mem-lore-rows-title">逐段（共 ' + this._esc(String(w.rowTotal || 0)) + ' 段，这里列 ' +
      this._esc(String(rows.length)) + ' 段' +
      (w.truncatedRows ? '，还有 ' + this._esc(String(w.truncatedRows)) + ' 段没列出来' : '') + '）</div>' +
      '    <div id="mem-lore-rows" class="mem-lore-rows">' + rowsBlock + '</div>' +
      (needs.length || resolvedHtml
        ? '    <div class="mem-lore-needwrap"><div class="mem-lore-rows-title">同名角色映射（待认 ' +
          this._esc(String(w.pendingCount || 0)) + ' 段）</div>' + resolvedHtml + needsHtml + '</div>'
        : '') +
      '    <div id="mem-lore-ledger" class="mem-lore-ledger">' + this._esc(this._loreLedgerLine(w)) + '</div>' +
      '    <div id="mem-lore-note" class="mem-lore-note">' + (note ? '<span class="mem-lore-note-text">' + this._esc(note) + '</span>' : '') + '</div>' +
      '  </div>';
  }
  /** 导入账那一行（**重开可查**的落点；读数口径取自内核的六阶段行）。 */
  _loreLedgerLine(w) {
    const led = w && w.ledger;
    if (!led) return '导入账：还没落过任何资料（重开也是这个读数）';
    const seen = Number(led.seen || 0);
    if (!seen) return '导入账：还没落过任何资料（重开也是这个读数）';
    const rb = (led.lastApply && led.lastApply.readback === null) ? '未尝试'
      : (led.lastApply && led.lastApply.readback) ? '是' : '否';
    return '导入账：已落 ' + String(seen) + ' 篇 · ' + String(led.chars || 0) + ' 字符 · 人工决定 ' +
      String(led.decisions || 0) + ' 条（重启后仍在）· 上次回读 ' + rb;
  }
  /** 导入区整块重画（面 / 阶段 / 逐段 / 待认 / 账 / 回话一并，避免几处各画各的）。 */
  _paintLore(note) {
    this._loreNote = String(note == null ? '' : note);
    const host = this.container.querySelector('#mem-lore-host');
    if (!host) return;
    const keep = this._loreNote;
    host.innerHTML = this._loreHtml();
    /* 回话是**瞬时**的：取数口里那一份可能还是上一跳留的，这里以本次为准。 */
    const noteEl = host.querySelector('#mem-lore-note');
    if (noteEl) noteEl.innerHTML = keep ? '<span class="mem-lore-note-text">' + this._esc(keep) + '</span>' : '';
    this._loreSyncInputs();
  }
  /** 读进来的源与游标回填到输入框（重画后用户能看出「手上是哪一份、读到哪了」）。 */
  _loreSyncInputs() {
    let cur = 0;
    try { cur = Number(this.app?.loreWizard?.()?.cursor || 0) || 0; } catch (_e) { cur = 0; }
    const to = this.container.querySelector('#mem-lore-to');
    if (to && !to.value) to.value = String(cur);
  }
  /** 选文件（交给控制器读；解码口径只有阅读 App 那一份）。 */
  _lorePickFile() {
    const el = this.container.querySelector('#mem-lore-file');
    el?.click();
  }
  _loreOnFileChosen(file) {
    let p = null;
    try { p = this.app.loreReadFile?.(file); } catch (_e) { p = null; }
    if (!p || typeof p.then !== 'function') {
      this._paintLore('读文件口读不出：本版 App 未接线（不是「文件有问题」）');
      return;
    }
    this._paintLore('正在读…');
    p.then((r) => {
      this._paintLore(String((r && r.note) || '读完了'));
      if (r && r.ok) this._loreAfterRead();
    }, (e) => {
      this._paintLore('读文件失败：' + String((e && e.message) || e));
    });
  }
  /** 读粘贴的正文（与选文件同一条下游路径）。 */
  _loreReadPasted() {
    const ta = this.container.querySelector('#mem-lore-text');
    const text = String(ta?.value || '');
    if (!text.trim()) { this._paintLore('先粘一段正文（空的读不出任何段）'); return; }
    let r = null;
    try { r = this.app.loreReadSource?.(text, '粘贴的资料') ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('读资料口读不出：本版 App 未接线'); return; }
    this._paintLore('已读进粘贴的正文（' + String(text.length) + ' 字符）');
    this._loreAfterRead();
  }
  /** 读完一份源之后**自动**过一遍实体映射与预览（省一次点击，读数照样逐项说清）。 */
  _loreAfterRead() {
    try { this.app.loreEntities?.({}); } catch (_e) { /* 忽略 */ }
    let pv = null;
    try { pv = this.app.lorePreview?.(null, {}) ?? null; } catch (_e) { pv = null; }
    /* [v4.33.0 · R5-O6] 顺手对一次账：基线（已应用那一版）与候选（刚读进来的这份）分家后，
     *   这一步才第一次**真**比得出来。修前这里不调也能「看着有读数」—— 那是因为读数恒为
     *   「全部同值」（拿候选与自己比），看着像比过了。 */
    try { this.app.loreCompareSource?.({}); } catch (_e) { /* 比不了不影响读进 */ }
    if (pv && pv.confirmedChecked === false) {
      this._paintLore('已预览：**已确认事实面未判**（手机不自己装配事实账）—— 那不等于「无冲突」');
    } else {
      this._paintLore('已预览');
    }
  }
  /**
   * [v4.33.0 · R5-O6] 源更新对账（**只读**，不写任何账）。
   *   为什么单独给一个按钮：自动那一次是「读完顺手比」，而用户改完手上的文件想**再比一次**
   *   时不该被迫重读一遍（重读会把候选换成同一份，读数看起来一样，但多了几次无用解析）。
   */
  _loreCompare() {
    let r = null;
    try { r = this.app.loreCompareSource?.({}) ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('对账口读不出：本版 App 未接线'); return; }
    const st = String(r.state || '');
    if (r.oldChecked === false && r.faceReason === 'baseline-body-absent') {
      this._paintLore('比不了：已应用的那一版**只剩引用**（正文不在手上）—— 不是「没有已应用版本」，也不是「全部新增」');
    } else if (r.oldChecked === false) {
      this._paintLore('比不了：还没有应用过任何版本 ⇒ 无从对账（**不是**「什么都没变」）');
    } else if (r.partialCandidate === true) {
      this._paintLore('对完账（**窗口候选**：移除清单不可采信 —— 窗口外的段不是被删了）');
    } else {
      this._paintLore('对完账（' + (st === 'ok' ? '比出来了' : '读数 ' + st) + '）');
    }
    this._loreRepaint();
  }
  /**
   * [v4.33.0 · R5-O6] **取消候选**：放掉手上这份新读进来的，回到已应用的那一版。
   *   计划验收原文「选B→显示真实差异→**取消仍是A**」靠这一口落地；回不去时如实说清是
   *   哪一种回不去（「只剩引用」/「没有应用过」处置相反，不许压平）。
   */
  _loreDiscard() {
    let r = null;
    try { r = this.app.loreDiscardCandidate?.() ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('取消候选口读不出：本版 App 未接线'); return; }
    if (r.ok) {
      this._paintLore(String(r.note || '已回到已应用的那一版'));
      this._loreRepaint();
      return;
    }
    this._paintLore('回不去：' + String(r.note || r.reason || '原因未给'));
    this._loreRepaint();
  }
  /** 导入区整块重画（几处按钮共用同一份重画口径，避免各画各的）。 */
  _loreRepaint() {
    const host = this.container.querySelector('#mem-lore-host');
    if (host) { host.innerHTML = this._loreHtml(); this._loreSyncInputs(); this._paintLore(this._loreNote); }
  }
  /** 选范围逐段读（范围没给就按游标续读）。 */
  _loreReadWindow(useInputs) {
    const q = (sel) => this.container.querySelector(sel);
    let range = null;
    if (useInputs) {
      const from = String(q('#mem-lore-from')?.value || '').trim();
      const to = String(q('#mem-lore-to')?.value || '').trim();
      range = {};
      if (from) range.from = Number(from);
      if (to) range.to = Number(to);
      if (!from && !to) range = null;
    }
    let r = null;
    try { r = this.app.loreReadWindow?.(range, {}) ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('逐段读口读不出：本版 App 未接线'); return; }
    this._paintLore('读了这一段');
    this._loreAfterRead();
  }
  /** 逐段改类（**零写**；非法类名由上游拒收，本处只把原话显示出来）。 */
  _loreSetClass(key, cls) {
    let r = null;
    try { r = this.app.loreSetClass?.(key, cls) ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('改类口读不出：本版 App 未接线'); return; }
    const bad = (Array.isArray(r.rejected) ? r.rejected : []).filter((x) => String(x.key) === String(key));
    if (bad.length) { this._paintLore('这一段没改成：' + String(bad[0].why || '上游拒收')); return; }
    this._paintLore('已把这一段改成「' + String(cls) + '」（还没落笔）');
  }
  /** 逐段选入开关（只记选择；未选段由上游具名 not-selected）。 */
  _loreTogglePick(key, on) {
    try { this.app.loreTogglePick?.(key, on); } catch (_e) { /* 忽略 */ }
  }
  /** 同名映射点选（**只读**；没认下保持待认）。 */
  _loreConfirmOwner(key, owner) {
    let r = null;
    try { r = this.app.loreConfirmPick?.(key, owner) ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('映射确认口读不出：本版 App 未接线'); return; }
    const ok = (Array.isArray(r.resolved) ? r.resolved : []).some((x) => String(x.itemKey) === String(key));
    this._paintLore(ok ? ('已认下：' + String(key) + ' → ' + String(owner)) : ('没认下「' + String(owner) + '」：保持待认（候选里没有这个名字）'));
    if (ok) this._loreAfterRead();
  }
  /** 出计划（**只算不写**）。 */
  _loreMakePlan() {
    let r = null;
    try { r = this.app.loreMakePlan?.(null, {}) ?? null; } catch (_e) { r = null; }
    if (!r) { this._paintLore('计划口读不出：本版 App 未接线'); return; }
    this._paintLore('');
    const host = this.container.querySelector('#mem-lore-host');
    if (host) { host.innerHTML = this._loreHtml(); this._loreSyncInputs(); this._paintLore(''); }
  }
  /** 确认导入（**真写入**；没预览就不去调上游 —— 上游自己拒一次不如这里先说清）。 */
  _loreApply() {
    let p = null;
    try { p = this.app.loreApplyNow?.({}) ?? null; } catch (_e) { p = null; }
    if (!p || typeof p.then !== 'function') {
      this._paintLore('落笔口读不出：本版 App 未接线（不是「导入失败」）');
      return;
    }
    const btn = this.container.querySelector('#mem-lore-apply');
    if (btn) btn.disabled = true;
    this._paintLore('正在落笔…');
    p.then((r) => {
      const st = String((r && r.state) || '');
      if (r && r.duplicate) {
        this._paintLore('重复提交：上游幂等挡住了，**一个字都没写**（不是「这次没写」）');
      } else if (r && r.ok) {
        this._paintLore('已落 ' + String(r.applied || 0) + ' 段 · 核验 ' + String(r.verified || 0) + ' 段（逐段核过真账）');
      } else {
        this._paintLore('没落成：' + String((r && (r.reason || r.faceReason)) || st || '原因未给'));
      }
      this._paintLore(this._loreNote);
      const host = this.container.querySelector('#mem-lore-host');
      if (host) { host.innerHTML = this._loreHtml(); this._loreSyncInputs(); this._paintLore(this._loreNote); }
    }, (e) => {
      this._paintLore('落笔抛错：' + String((e && e.message) || e));
    });
  }
  /** 重来一份（只动本会话现场，不碰上游任何账）。 */
  _loreReset() {
    try { this.app.loreReset?.(); } catch (_e) { /* 忽略 */ }
    const host = this.container.querySelector('#mem-lore-host');
    if (host) { host.innerHTML = this._loreHtml(); this._loreSyncInputs(); }
    this._paintLore('已重来一份（上游的导入账不动）');
  }
  /** 问往事结果区（供 `_askHtml` 与事件回调共用同一份排版口径）。 */
  _askFaceHtml(qa, runState) {
    const r = (qa && typeof qa === 'object') ? qa : null;
    /* [v4.14.0 · R4-O2] 取消态:**先**说清「下面是已处理部分」,再列答案 ——
     *   顺序反了,读者会先把它当全量结论记住。 */
    if (runState === ASK_RUN_STATES.CANCELED) {
      const body = r ? this._askBodyHtml(r) : '';
      return '<div class="mem-none mem-ask-canceled">已取消 —— 下面是**已处理部分**,不是全量结论</div>' + body;
    }
    if (!r) return '';
    if (r.state === 'engine-absent') {
      return '<div class="mem-none">记忆插件不在场 —— **不是**「没有答案」（两者处置相反：这个等装插件）</div>';
    }
    if (r.state === 'face-absent') {
      return '<div class="mem-none">本版插件没有问答出口（等升级记忆插件 v3.322+）—— 这不是「没查到」</div>';
    }
    if (r.state === 'unusable') {
      return '<div class="mem-none">问答读不出（' + this._esc(r.faceReason || 'unavailable') + '）—— 这不是「没查到」</div>';
    }
    return this._askBodyHtml(r);
  }

  /** 答案主体(有答案 / 没命中的排版;**取消态与正常态共用同一份口径**)。 */
  _askBodyHtml(r) {
    if (!r || typeof r !== 'object') return '';
    const answer = Array.isArray(r.answer) ? r.answer : [];
    if (!answer.length) {
      const gaps = Array.isArray(r.gaps) ? r.gaps : [];
      return '<div class="mem-none">问了、扫了、**没命中**（真读数）' +
        (gaps.length ? '<br><span class="mem-hint">缺口：' + gaps.map((g) => this._esc(String((g && g.why) || (g && g.kind) || ''))).join('；') + '</span>' : '') +
        '</div>';
    }
    const rows = answer.map((a) => {
      const text = this._esc(String((a && a.text) || ''));
      /* [v4.13.0 · R4-O1] 出处行从「一行字」变成「可点开的靶心」。
       *   归一交给纯函数(config/source-locator.js),本视图只排版 ——
       *   六态互不同形是那件契约的核心(压平任意两态都会造出处置相反的处境长得一样)。 */
      return '<div class="mem-res"><div class="mem-res-text">' + text + '</div>'
        + this._srcHtml(normalizeSource(a || {}), a) + '</div>';
    }).join('');
    const meta = '答 ' + answer.length + ' 句 · 出处 ' + (Array.isArray(r.refs) ? r.refs.length : 0) + ' 条'
      + (r.masked ? ' · 遮蔽 ' + r.masked : '') + (r.truncated ? ' · 已截断' : '');
    return '<div class="mem-hint">' + this._esc(meta) + '</div>' + rows;
  }

  /**
   * [v4.13.0 · R4-O1] 一条答案的出处行(唯一实现:首帧与 `_doAsk` 重绘共用同一份口径)。
   *
   * 【修前实测处境】`出处:承诺 · 第 12 楼` 只是一个 `mem-res-lbl` 普通 div ——
   *   注释与计划都写着「可点开」,而答案行上**没有任何跳转按钮**。
   *   而 `qaRefOf` 与 `applyOpenRef` 早就在仓里,只是这条路一个消费点都没有。
   *
   * 【可点与不可点各有各的形】能去(chat / memory 两态)给按钮;其余四态**不给按钮**,
   *   并把「为什么不能去」如实念出——`no-target`(未给出出处)与
   *   `location-unavailable`(本版宿主没有楼层口,等升级)与 `not-found`(删了,去翻历史楼)
   *   处置**相反**,压成一句「打不开」就是把用户丢在没答案里。
   *
   * @param {{state:string,kind:string,id:string,floor:number|null,label:string}} t 归一后的靶心
   * @param {object} a 上游答案项(`{ref, floor, ledger}`,用于把原始值原样带进 data 属性)
   */
  _srcHtml(t, a) {
    const target = t || normalizeSource(null);
    const label = target.label ? this._esc(target.label) : '';
    let line;
    if (target.state === 'chat') {
      line = '出处:' + label + ' · 第 ' + target.floor + ' 楼';
    } else if (target.state === 'memory') {
      line = '出处:' + label + '(只有引用键,没有楼层)';
    } else if (target.state === 'no-target') {
      line = '出处:未给出(**不假装有**)';
    } else {
      /* ref-invalid / location-unavailable / not-found 三态:如实念出是哪一态。 */
      line = '出处:' + label + ' ' + this._esc(sourceLocatorLine(target));
    }
    let btn = '';
    if (isLocatable(target)) {
      const raw = JSON.stringify({
        ref: (a && a.ref !== undefined) ? a.ref : null,
        floor: (a && a.floor !== undefined) ? a.floor : null,
        ledger: (a && a.ledger !== undefined) ? a.ledger : ''
      });
      const goLabel = (target.state === 'chat') ? '打开原文' : '去总结记忆';
      btn = '<button class="mem-src-go" data-src="' + this._esc(raw) +
        '" title="' + this._esc(sourceLocatorLine(target)) + '">' + this._esc(goLabel) + '</button>';
    }
    return '<div class="mem-res-lbl">' + line + btn + '</div>';
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
    // 覆盖度单独特数（现算纯读，不与 insights 混取——模块缺席不连坐其他页）
    let coverage = null;
    try { coverage = this.app.coverage(); } catch (_e) { coverage = null; }
    pkg.coverage = coverage || { state: 'unavailable', reason: 'coverage-thrown', cov: null };
    /* [v3.97.0 · R3-X2/R3-X1] 上游三面读数**面自述**（只读、不跑真查询）：
     *   它回答的是「这三个出口在不在、是哪一态」——不跑真问答（那是按钮的活），
     *   故本页首次打开不会付出全量扫描代价（与上游「诊断面不许有副作用」同纪律）。 */
    try { pkg.factFace = this.app.phoneFactFace(); } catch (_e) { pkg.factFace = null; }
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
    else if (this._tab === 'ask') body = this._askHtml(pkg);
    else if (this._tab === 'audit') body = this._auditHtml(pkg);
    else if (this._tab === 'coverage') body = this._coverageHtml(pkg);
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
    /* [v3.97.0 · R3-X2] 问往事：取数走 `app.askPast()`（唯一出口），本视图只排版。 */
    /* [v4.14.0 · R4-O2] 问往事:取数走 `app.askPastAsync()`(唯一出口;旧插件自动回落同步),
     *   本视图只排版。取消按钮默认隐藏,只在问的期间出现(见 `_doAsk` 的 `setRun`)。 */
    q('#mem-ask-btn')?.addEventListener('click', () => this._doAsk());
    q('#mem-ask-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._doAsk(); });
    q('#mem-ask-cancel')?.addEventListener('click', () => this._cancelAsk());
    /* [v4.22.0 · R4-X1] 追问:输入口两条(点按钮 / 回车),与「问往事」同规格。
     *   为什么单独一个输入框而不复用上面那个:两者的**语义相反** —— 「问往事」每问
     *   都从头查,追问沿用上一轮条件;共用一个框会让用户分不清这一次到底带没带上文。 */
    q('#mem-fu-btn')?.addEventListener('click', () => this._doFollowUp());
    q('#mem-fu-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._doFollowUp(); });
    /* [v4.23.0 · R4-X2] 资料导入:选文件 / 读粘贴 / 选范围逐段读 / 过预览 / 出计划 / 落笔。
     *   落笔是异步的(上游走 PrequelSystem owner 四步),故这里等 Promise 回执再显示。 */
    q('#mem-lore-file')?.addEventListener('change', (e) => {
      const f = (e.target && e.target.files && e.target.files[0]) || null;
      if (f) this._loreOnFileChosen(f);
    });
    q('#mem-lore-pickfile')?.addEventListener('click', () => this._lorePickFile());
    q('#mem-lore-read')?.addEventListener('click', () => this._loreReadPasted());
    q('#mem-lore-win')?.addEventListener('click', () => this._loreReadWindow(true));
    q('#mem-lore-winnext')?.addEventListener('click', () => this._loreReadWindow(false));
    q('#mem-lore-preview')?.addEventListener('click', () => this._loreAfterRead());
    q('#mem-lore-compare')?.addEventListener('click', () => this._loreCompare());
    q('#mem-lore-discard')?.addEventListener('click', () => this._loreDiscard());
    q('#mem-lore-plan')?.addEventListener('click', () => this._loreMakePlan());
    q('#mem-lore-apply')?.addEventListener('click', () => this._loreApply());
    q('#mem-lore-reset')?.addEventListener('click', () => this._loreReset());
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
          return;
        }
        /* [v4.13.0 · R4-O1] 出处跳转(容器级委托,幂等同上)。
         *   两类靶心分派**互不相同**:
         *     · chat 靶心   ⇒ 交 `app.locateSource()`(它调宿主 `locateChatFloor`);
         *     · memory 靶心 ⇒ 派跨 App 事件(走既有 `config/open-ref.js` 已登记归属),
         *                     并顺便把记忆 App 收起 —— 目标是另一个 App,留在原地会
         *                     看着像「点了没反应」。
         *   ★ 失败必须出声:定位不成一律 toast 出**那一态的原话**(六态互不同形)。 */
        const srcBtn = e.target.closest('.mem-src-go');
        if (srcBtn && this.container.contains(srcBtn)) {
          this._goSource(srcBtn);
        }
        /* [v4.22.0 · R4-X1] 消歧候选点选(容器级委托,幂等同上)。
         *   未认下**不产确定结论**:上游说没这个人就保持待消歧,本处只把原话显示出来。 */
        /* [v4.36.0 · R5-O9] 可撤条件按钮(容器级委托,幂等同上):
         *   轴名取自按钮的 data-axis(它又取自上游那张表) —— 视图不另立清单。 */
        const clearBtn = e.target.closest('.mem-fu-clear-btn');
        if (clearBtn && this.container.contains(clearBtn)) {
          this._clearAskCondition(clearBtn.getAttribute('data-axis') || '');
          return;
        }
        /* [v4.23.0 · R4-X2] 导入面的三处点选(容器级委托,幂等同上):
         *   · 改类   —— 每行一个 select,交给上游 applyOverrides(本层不算一遍);
         *   · 选入   —— 只记选择,未选段由上游具名 not-selected;
         *   · 同名认人 —— 未认下保持待认,不静默合并。 */
        const clsSel = e.target.closest('.mem-lore-cls');
        if (clsSel && this.container.contains(clsSel)) {
          this._loreSetClass(clsSel.getAttribute('data-key') || '', clsSel.value);
          return;
        }
        const pickBox = e.target.closest('.mem-lore-pick');
        if (pickBox && this.container.contains(pickBox)) {
          this._loreTogglePick(pickBox.getAttribute('data-key') || '', pickBox.checked === true);
          return;
        }
        const ownerBtn = e.target.closest('.mem-lore-owner');
        if (ownerBtn && this.container.contains(ownerBtn)) {
          this._loreConfirmOwner(ownerBtn.getAttribute('data-key') || '', ownerBtn.getAttribute('data-owner') || '');
          return;
        }
        const cand = e.target.closest('.mem-fu-cand');
        if (cand && this.container.contains(cand)) {
          this._pickAskCandidate(cand.getAttribute('data-name') || '');
          return;
        }
      });
    }
  }

  /**
   * [v4.13.0 · R4-O1] 出处按钮的落点(容器级委托的唯一消费点)。
   *
   * 【为什么不用 `app.locateSource()` 一把包完】memory 靶心**要派跨 App 事件**,
   *   而事件只有视图层才该派(宿主 `phone:openApp` 的消费方是 index.js 的路由;
   *   取数层派 UI 事件会把「谁来打开哪个 App」写进内核)。故此处只做两件事:
   *   解析按钮上的原始出处 → 按靶心态分派。
   *
   * 【失败必出声】定位不成一律 toast 出**那一态的原话**:
   *   `location-unavailable`(本版宿主没有楼层口,等升级)与 `not-found`(删了,
   *   去翻历史楼)处置**相反**,静默吞掉就等于把用户丢在「点了没反应」里。
   */
  _goSource(btn) {
    let raw = null;
    try { raw = JSON.parse(btn.getAttribute('data-src') || 'null'); }
    catch (_e) { raw = null; }
    /* 解析失败**不静默**:按钮是自家渲染的,走到这里说明 data-src 被写坏了。 */
    if (!raw || typeof raw !== 'object') {
      window.toastr?.error('这条出处读不出(按钮数据坏了)', '记忆');
      return;
    }
    const target = normalizeSource(raw);
    if (target.state === 'memory') {
      const ref = sourceOpenRef(target);
      if (!ref) {
        window.toastr?.warn('这条出处没有可用的引用键', '记忆');
        return;
      }
      try {
        window.dispatchEvent(new CustomEvent('phone:openApp', {
          detail: { appId: ref.appId, ref }
        }));
      } catch (_e) {
        window.toastr?.error('打开总结记忆失败', '记忆');
      }
      return;
    }
    if (target.state === 'chat') {
      /* 取数走控制器(它调宿主定位口);本视图不直接摸 window 上的宿主口。 */
      let res = null;
      try { res = this.app.locateSource?.(raw) || null; } catch (_e) { res = null; }
      const r = (res && typeof res === 'object') ? res : { ok: false, method: 'none', reason: 'unavailable' };
      if (r.ok) {
        window.toastr?.success(locateResultLine(r), '记忆');
      } else {
        window.toastr?.warn(locateResultLine(r), '记忆');
      }
      return;
    }
    /* 其余四态:按钮本不该出现(渲染时就只给 chat / memory 两态按钮);
     *   真走到这里如实报出是哪一态,不假装跳了。 */
    window.toastr?.warn(sourceLocatorLine(target), '记忆');
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
        /* [v3.12.0] 取数走唯一实现：`Number([])` / `Number('  ')` 都是 0 ⇒ 命中分会显示成
         *  「0.00」，与「真的算出了 0 分」同形；读不出时本文件的约定是显示 `—`。 */
        const scoreNum = numOrNull(h._score);
        const sc = scoreNum !== null ? scoreNum.toFixed(2) : '—';
        return '<div class="mem-res"><div class="mem-res-lbl">' + this._esc(h.layer) +
          ' <span class="mem-res-score">' + sc + '</span>' + perm + '</div>' +
          '<div class="mem-res-text">' + this._esc(h.content) + '</div></div>';
      }).join('')
      : '<div class="mem-none">没有相关记忆</div>';
  }

  /**
   * [v3.97.0 · R3-X2] 问往事：把问句交唯一出口 `app.askPast()`（转发上游 `askMemoryQuestion`），
   *   再把读数交给 `_askFaceHtml` 排版。**本件不合成答案、不补缺口**。
   */
  /**
   * [v4.14.0 · R4-O2] 问往事(**异步派发**):有异步口走异步(可取消、有进度、片间让出),
   *   没有则回落同步并**如实告知**(「本版插件没有异步问答出口」不等于「后台跑」)。
   *
   * 【旧回信不写面板】控制器会把被顶掉的那一条报成 `stale-dropped`且 `receipt` 为 null:
   *   本处对该态**只显示一条提示**,不把上一次的答案重新画上去(那正是本版要治的形态)。
   */
  _doAsk() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#mem-ask-q')?.value?.trim();
    const box = q('#mem-ask-results');
    const face = q('#mem-ask-face');
    if (!box && !face) return;
    if (!kw) { if (box) box.innerHTML = ''; return; }
    const paint = (html) => {
      const f = q('#mem-ask-face') || face;
      if (f) f.innerHTML = html;
      else if (box) box.innerHTML = html;
    };
    const setRun = (state, progress) => {
      const el = q('#mem-ask-run');
      if (el) el.innerHTML = this._askRunHtml(state, progress);
      const btn = q('#mem-ask-cancel');
      if (btn) btn.hidden = (state !== ASK_RUN_STATES.RUNNING);
    };
    if (typeof this.app.askPastAsync !== 'function') {
      /* 控制器无异步口(异常情形:旧版插件下仍应在位)⇒ 退回同步。 */
      let qa = null;
      try { qa = this.app.askPast?.(kw) || null; } catch (_e) { qa = null; }
      paint(this._askFaceHtml(qa));
      return;
    }
    setRun(ASK_RUN_STATES.RUNNING, null);
    let promise = null;
    try {
      promise = this.app.askPastAsync(kw, {
        chatId: this._chatId(),
        onProgress: (p) => setRun(ASK_RUN_STATES.RUNNING, p),
        onDone: (receipt, runState) => {
          if (runState === ASK_RUN_STATES.STALE_DROPPED) {
            setRun(runState, null);
            return;   /* 旧回信:不把它画上去 */
          }
          setRun(runState, null);
          paint(this._askFaceHtml(receipt, runState));
        }
      });
    } catch (_e) { promise = null; }
    if (!promise || typeof promise.then !== 'function') {
      let qa = null;
      try { qa = this.app.askPast?.(kw) || null; } catch (_e) { qa = null; }
      setRun(ASK_RUN_STATES.DONE, null);
      paint(this._askFaceHtml(qa));
    }
  }

  /** 当前会话身份(只读,不写)——作为任务身份的会话部分。取不到返回空串(纯函数会写 na)。 */
  _chatId() {
    try {
      const s = this.app?.storage;
      return String(s?.currentConversationId || '');
    } catch (_e) { return ''; }
  }

  /** 运行态一行(六态各有各的形;文案取自纯函数件)。 */
  _askRunHtml(state, progress) {
    const line = askRunLine(state, { progress });
    if (!line) return '';
    return '<div class="mem-hint mem-ask-runline">' + this._esc(line) + '</div>';
  }
  /**
   * [v4.14.0 · R4-O2] 用户按了取消。**只打标记,不打断调用栈** ——
   *   上游在**下一个协作分片让出点**读这个标记并停下(它自己那一层是 `queryAsync` 的片间检查)。
   *   本处立刻把按钮收起并写一行「正在停…」:让用户看到按键**已经受理**,
   *   而不是盯着一个不动的界面怀疑没点上。
   */
  _cancelAsk() {
    let res = null;
    try { res = this.app.cancelAskNow?.() || null; } catch (_e) { res = null; }
    const btn = this.container.querySelector('#mem-ask-cancel');
    if (btn) btn.hidden = true;
    const el = this.container.querySelector('#mem-ask-run');
    if (el) {
      const ok = !!(res && res.ok === true);
      el.innerHTML = '<div class="mem-hint mem-ask-runline">' + this._esc(
        ok ? '已受理取消 —— 正在停(下一片生效)' : '当前没有在问的请求'
      ) + '</div>';
    }
  }

}
export default MemoryView;