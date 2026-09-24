/* ========================================================
 * clock-view.js — [v2.52.0] 时计 App 视图
 * 归因卡 + 时间轴卡片 + 诊断卡片 + 设置卡
 * ======================================================== */

import { CLOCK_REASONS } from './clock-data.js';

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
    // [v2.98.0] 未识别的状态如实报出（带原值），不冒充「桥未连接」。
    const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
    const parts = [];

    // Header
    parts.push('<div class="cl-header"><h2>\u23f1\ufe0f 时计</h2></div>');

    // Face card
    parts.push('<div class="cl-face cl-face-' + meta.tone + '">');
    parts.push('<span class="cl-face-icon">' + meta.icon + '</span>');
    parts.push('<span class="cl-face-label">' + meta.label + '</span>');
    parts.push('</div>');

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

  _bindEvents() {
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
