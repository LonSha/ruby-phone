/* ========================================================
 * clock-view.js — [v2.52.0] 时计 App 视图
 * 归因卡 + 时间轴卡片 + 诊断卡片 + 设置卡
 * ======================================================== */

import { CLOCK_REASONS } from './clock-data.js';
/* [v4.112.0 · R13-X1] 「今天」页签的词表**取真源**（键面与标签都从 config 读），
 *   视图不手写第二份 —— 手写一份标识符形会与本仓已立判据（文案表不得手写键）相撞，
 *   且真源一旦改名，本表会静默落兜底、多种处境显示成同一句话。 */
import { TODAY_STATES, TODAY_SOURCE_STATES, TODAY_SOURCE_LABEL, TODAY_SOURCES } from '../../config/today-terms.js';
/* [v4.119.0 · R14-O3] 载荷走唯一一支笔（与 search-view / 装配器同一件）：
 *   手拼 { appId, ref } 会让字段名一漂，而漂掉的表现是「点了没反应」。 */
import { buildOpenDetail } from '../../config/app-open-detail.js';

/* [v4.112.0 · R13-X1] 「今天」的一条原话点回去 ⇒ 打开**那个 App**。
 * [v4.119.0 · R14-O3] 升级：**有靶心的那一条**，点下去就落在那一篇 / 那一则备忘上。
 *   本版给 `diary` 与 `calendar` 两源补齐了 `OPEN_REF_KINDS` 登记与 App 侧 `openRef`，
 *   于是这两源的按钮从「打开日记」变成「打开这一条」（真的能落到）；
 *   `wechat` / `album` 仍**没有** `openRef` 定位口，按钮文案照旧只写「打开 X」——
 *   ★ 文案必须由**靶心在不在**决定，不能按源名写死：写死就会出现「某天补了口但文案不改」
 *   （或反过来，文案先承诺、口还没补）两类静默缺陷，而两类都只在用户点下去时才暴露。 */
const TODAY_JUMP_APP = Object.freeze({
  wechat: 'wechat', calendar: 'calendar', diary: 'diary', album: 'album'
});

/* [v2.98.0] 键必须取 CLOCK_REASONS 的**值**（连字符形），不得另写一套下划线形。
   修前实测：本表键写作 no_clock_face / no_snapshot / bridge_absent，
   而 CLOCK_REASONS 的值是 no-clock-face / no-snapshot / bridge-absent ⇒
   五态里三态查不到，而下一行的兜底又是 FACE_META.bridge_absent，于是
   「快照不可用」「这版快照没时钟面」「桥未连接」三种完全不同的处境
   **一律显示成「桥未连接」**。与本仓最贵的缺陷形态同形。
   改用常量做键：形状由真源决定，真源改了这里跟着变，不会再静默塔缩。 */
const FACE_META = {
  [CLOCK_REASONS.ready]: { icon: '\u23f1\ufe0f', label: '已同步', tone: 'ok' },
  [CLOCK_REASONS.empty]: { icon: '\u2615', label: '尚无时间', tone: 'warn' },
  [CLOCK_REASONS.upstream_empty]: { icon: '\u2615', label: '上游报该项为空', tone: 'warn' },
  [CLOCK_REASONS.no_clock_face]: { icon: '\u2b50', label: '这版快照无时钟面', tone: 'warn' },
  [CLOCK_REASONS.no_snapshot]: { icon: '\u26d4', label: '快照不可用', tone: 'err' },
  [CLOCK_REASONS.bridge_absent]: { icon: '\u26a1', label: '桥未连接', tone: 'err' },
};

export class ClockView {
  constructor(app, shell, storage) {
    this.app = app;
    this.shell = shell;
    this.storage = storage;
    this._root = null;
    /* [v4.112.0 · R13-X1] 页签态**不落盘**：它只是「现在在看哪一屏」，
     *   每次打开都从「今天」开始 —— 用户打开时计最想知道的是今天发生了什么。 */
    this._tab = 'today';
  }

  /** 页签表（既有一屏 = 时计原屏，新增一屏 = 今天）。 */
  _tabs() {
    return [
      { key: 'today', label: '今天' },
      { key: 'clock', label: '时计' }
    ];
  }

  _switchTab(key) {
    const ok = this._tabs().some((t) => t.key === key);
    this._tab = ok ? key : 'today';
  }

  render() {
    const container = this.shell?.getContentContainer?.();
    if (!container) return;
    container.innerHTML = '';
    this._root = document.createElement('div');
    this._root.className = 'cl-root';
    this._root.innerHTML = this._buildHTML();
    container.appendChild(this._root);
    this._bindEvents();
  }

  refresh() {
    if (!this._root) return;
    this._root.innerHTML = this._buildHTML();
    this._bindEvents();
  }

  _buildHTML() {
    const face = this.app.clockFace();
    const proj = this.app.projection();
    /* [v3.0.1] 归属面：从控制器取（不在视图里重取投影 —— 两次读数会给出两份「来源」）。 */
    let src = null;
    try { src = this.app.sourceFace(); } catch (_e) { src = null; }
    // [v2.98.0] 未识别的状态如实报出（带原值），不冒充「桥未连接」。
    const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
    const parts = [];

    // Header
    parts.push('<div class="cl-header"><h2>\u23f1\ufe0f 时计</h2></div>');

    /* [v4.112.0 · R13-X1] 页签栏：两屏共用一条页签。
     *   为什么不做成两个 App：计划书原文「不增加主屏格子压力」，而时间是 clock 的主题。 */
    parts.push('<div class="cl-tabs">');
    for (const t of this._tabs()) {
      parts.push('<button type="button" class="cl-tab' + (this._tab === t.key ? ' is-on' : '')
        + '" data-tab="' + t.key + '">' + this._esc(t.label) + '</button>');
    }
    parts.push('</div>');

    if (this._tab === 'today') {
      parts.push(this._todayHtml());
      return parts.join('\n');
    }

    // Face card
    parts.push('<div class="cl-face cl-face-' + meta.tone + '">');
    parts.push('<span class="cl-face-icon">' + meta.icon + '</span>');
    parts.push('<span class="cl-face-label">' + meta.label + '</span>');
    parts.push('</div>');

    // Source card (v3.0.1: 这份读数是哪一次的)
    if (src) {
      const tone = src.usable === true ? (src.stale === true ? 'warn' : 'ok') : 'off';
      parts.push('<div class="cl-src cl-src-' + tone + '">');
      parts.push('<div class="cl-src-title">数据来源</div>');
      parts.push('<div class="cl-src-line">' + this._esc(src.line) + '</div>');
      parts.push('</div>');
    }

    // Time card (ready only)
    if (face === CLOCK_REASONS.ready && proj) {
      parts.push('<div class="cl-time-card">');
      if (proj.date) parts.push('<div class="cl-date">' + this._esc(proj.date) + '</div>');
      if (proj.label) parts.push('<div class="cl-label">' + this._esc(proj.label) + '</div>');
      parts.push('<div class="cl-meta">');
      parts.push('<span class="cl-chip cl-chip-prec">' + this._precLabel(proj.precision) + '</span>');
      if (proj.turn > 0) parts.push('<span class="cl-chip">L' + proj.turn + '</span>');
      if (proj.hasFlashback) parts.push('<span class="cl-chip cl-chip-fb">\u21a9 闪回</span>');
      parts.push('</div>');
      if (proj.hasFlashback && proj.flashback) {
        parts.push('<div class="cl-flashback">\u21a9 ' + this._esc(proj.flashback.date || '未知') + (proj.flashback.label ? ' \u00b7 ' + this._esc(proj.flashback.label) : '') + '</div>');
      }
      parts.push('</div>');
    }

    // Diagnostics card
    if (face === CLOCK_REASONS.ready && proj && this.app.settings.showDiagnostics) {
      parts.push('<div class="cl-diag-card">');
      parts.push('<h3>\ud83d\udd0d 诊断</h3>');
      if (proj.stats) {
        parts.push('<div class="cl-stat-row"><span>时间标签</span><span>' + proj.stats.paired + '/' + proj.stats.total + ' 配对</span></div>');
        parts.push('<div class="cl-stat-row"><span>校准</span><span>' + proj.stats.calibrated + ' 次</span></div>');
        if (proj.stats.unparseable > 0) parts.push('<div class="cl-stat-row cl-stat-warn"><span>不可解析</span><span>' + proj.stats.unparseable + '</span></div>');
      }
      if (proj.worldClock) {
        parts.push('<div class="cl-stat-row"><span>世界钟</span><span>已读</span></div>');
      }
      if (proj.anchor) {
        parts.push('<div class="cl-stat-row"><span>锚点</span><span>有</span></div>');
      }
      parts.push('</div>');
    }

    // Settings card
    parts.push('<div class="cl-settings">');
    parts.push('<h3>\u2699\ufe0f 设置</h3>');
    parts.push('<label class="cl-toggle"><input type="checkbox" id="cl-inject" ' + (this.app.settings.injectToPrompt ? 'checked' : '') + '><span>注入 Prompt</span></label>');
    parts.push('<label class="cl-toggle"><input type="checkbox" id="cl-diag" ' + (this.app.settings.showDiagnostics ? 'checked' : '') + '><span>显示诊断</span></label>');
    parts.push('</div>');

    return parts.join('\n');
  }

  /* ════════ [v4.112.0 · R13-X1] 「今天」面板 ════════
   * 五态各自画，且**每种都写清这是哪一种**：
   *   · no-clock  —— 剧情钟读不到 ⇒ 边界定不下来（不等于今天没事）
   *   · absent    —— 一个 App 都没接入（不等于今天没事）
   *   · partly    —— 只接上了一部分，且今天还没有事（还不能说今天没事）
   *   · empty     —— 都接上了，今天确实什么都没有
   *   · ok        —— 有事件
   * 压平任意两态，都会造出「处置相反的两件事长得一样」（本仓最贵的老账）。 */
  _todayHtml() {
    let res = null;
    try { res = this.app.today(); } catch (_e) { res = null; }
    const parts = [];
    parts.push('<div class="cl-today">');
    if (!res || typeof res !== 'object') {
      /* 取数口自己抛了：这是**读数坏了**，不是「今天没事」。 */
      parts.push('<div class="cl-today-face cl-face-err">今天的读数取不出来 —— 这不等于今天没事</div>');
      parts.push('</div>');
      return parts.join('\n');
    }
    const tone = (res.state === TODAY_STATES.ok) ? 'ok'
      : (res.state === TODAY_STATES.empty) ? 'mute' : 'err';
    const faceText = res.readError || res.line || '';
    parts.push('<div class="cl-today-face cl-face-' + tone + '">' + this._esc(faceText) + '</div>');

    /* 源状态：逐源一行。**没接入与今天没事必须分开写** —— 这是本项最容易被糊掉的一处。 */
    parts.push('<div class="cl-today-srcs">');
    for (const row of (res.sourceRows || [])) {
      const cls = (row.state === TODAY_SOURCE_STATES.ok) ? 'is-ok'
        : (row.state === TODAY_SOURCE_STATES.error) ? 'is-err' : 'is-off';
      const label = TODAY_SOURCE_LABEL[row.source] || row.label || row.source;
      let text;
      if (row.state === TODAY_SOURCE_STATES.ok) {
        text = label + '：今天 ' + row.count + ' 条'
          + (row.dropped ? ('，另有 ' + row.dropped + ' 条没有可用时刻没排进来') : '');
      } else if (row.state === TODAY_SOURCE_STATES.error) {
        text = label + '：读不出来（**不等于**今天没有）';
      } else {
        text = label + '：还没有接入今天';
      }
      parts.push('<div class="cl-src-row ' + cls + '">' + this._esc(text) + '</div>');
    }
    parts.push('</div>');

    const events = Array.isArray(res.events) ? res.events : [];
    if (events.length) {
      parts.push('<div class="cl-tl">');
      for (const ev of events) {
        const jumpApp = TODAY_JUMP_APP[ev.source] || '';
        parts.push('<div class="cl-tl-row">');
        parts.push('<span class="cl-tl-at">' + this._esc(this._todayTime(ev.at)) + '</span>');
        parts.push('<span class="cl-tl-src">' + this._esc(ev.sourceLabel || ev.source) + '</span>');
        parts.push('<span class="cl-tl-title">' + this._esc(ev.title || '（这一条没有标题）') + '</span>');
        if (jumpApp) {
          /* 文案由**靶心在不在**决定（见 TODAY_JUMP_APP 头注）：
           *   有靶心 ⇒ 「打开这一条」（真能落到那一条）；没靶心 ⇒ 「打开 X」（不承诺做不到的事）。
           *   data-today-ref 只在有靶心时写，派发时才带 ref —— 空串靶心不投。 */
          const refJson = ev && ev.ref ? this._esc(JSON.stringify(ev.ref)) : '';
          const label = refJson ? ('打开这一条') : ('打开' + (ev.sourceLabel || ''));
          parts.push('<button type="button" class="cl-tl-go" data-today-app="' + this._esc(jumpApp)
            + (refJson ? ('" data-today-ref="' + refJson) : '"')
            + ' title="' + this._esc(refJson ? ('落到' + (ev.sourceLabel || '') + '的那一条') : ('只打开' + (ev.sourceLabel || '') + '，落不到具体那一条'))
            + '">' + this._esc(label) + '</button>');
        }
        parts.push('</div>');
      }
      parts.push('</div>');
      if (Number(res.truncated) > 0) {
        parts.push('<div class="cl-today-cut">另有 ' + Number(res.truncated) + ' 条没排进来（本次只排了前 '
          + TODAY_SOURCES.length + ' 类里的 ' + events.length + ' 条）</div>');
      }
    }
    parts.push('</div>');
    return parts.join('\n');
  }

  /** 时刻人话：读不出来就说读不出来，**不编一个日期**。 */
  _todayTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '时间不可知';
    try {
      const d = new Date(n);
      const p2 = (x) => String(x).padStart(2, '0');
      return p2(d.getHours()) + ':' + p2(d.getMinutes());
    } catch (_e) { return '时间不可知'; }
  }

  _bindEvents() {
    /* [v4.112.0 · R13-X1] 页签切换与「打开某个 App」都走容器级委托：
     *   面板是整段 innerHTML 重绘的，逐按钮挂监听会在每次 refresh 后失效（本仓治过同款）。 */
    if (this._root && !this._delegated) {
      this._root.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.getAttribute) return;
        const tab = t.getAttribute('data-tab');
        if (tab) { this._switchTab(tab); this.refresh(); return; }
        const appId = t.getAttribute('data-today-app');
        if (appId) {
          /* [v4.119.0 · R14-O3] 有靶心就投靶心（落到那一条），没靶心只开 App。
           *   载荷走唯一一支笔（buildOpenDetail）：手拼 { appId, ref } 会让「字段名一漂」
           *   又回到本仓老账上（ref / openRef / target 三种写法同时在）。
           *    ★ ref 解析失败不静默吞：退为只开 App 并报原因（与 search-view 同款）。 */
          let ref = null;
          const refRaw = t.getAttribute('data-today-ref') || '';
          if (refRaw) {
            try { ref = JSON.parse(refRaw); }
            catch (_e) {
              ref = null;
              try { console.warn('[clock] 今天的靶心读不出（退为只开 App）', refRaw); } catch (_e2) { /* 无 console 也不影响结论 */ }
            }
          }
          try {
            const win = (typeof window !== 'undefined') ? window : globalThis;
            win.dispatchEvent(new CustomEvent('phone:openApp', { detail: buildOpenDetail(appId, null, ref) }));
          } catch (_e) {
            /* 宿主不在（判据环境）：不假装开了。 */
          }
        }
      });
      this._delegated = true;
    }
    const inject = this._root.querySelector('#cl-inject');
    const diag = this._root.querySelector('#cl-diag');
    if (inject) inject.addEventListener('change', (e) => {
      this.app.settings.injectToPrompt = e.target.checked;
      this.app.saveSettings();
    });
    if (diag) diag.addEventListener('change', (e) => {
      this.app.settings.showDiagnostics = e.target.checked;
      this.app.saveSettings();
      this.refresh();
    });
  }

  _precLabel(p) {
    if (p === 'day') return '精确';
    if (p === 'approximate') return '约数';
    return '未知';
  }

  _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
