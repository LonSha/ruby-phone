/* [v2.53.0] 世界账本 App 视图 */

import { LEDGER_REASONS } from './ledger-data.js';

const FACE_META = {
  ready: { icon: '\u1f9fe', label: '世界账本已读', tone: 'ok' },
  empty: { icon: '\u2615', label: '账本尚空', tone: 'warn' },
  no_worldaxis: { icon: '\u2b50', label: '世界桥未启用', tone: 'warn' },
  no_ledger_face: { icon: '\u26d4', label: '快照无账本面', tone: 'warn' },
  no_snapshot: { icon: '\u26d4', label: '快照不可用', tone: 'err' },
  bridge_absent: { icon: '\u26a1', label: '桥未连接', tone: 'err' },
};

export class LedgerView {
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
    this._root.className = 'lg-root';
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
    const face = this.app.ledgerFace();
    const proj = this.app.projection();
    const meta = FACE_META[face] || FACE_META.bridge_absent;
    const parts = [];
    parts.push('<div class="lg-header"><h2>\u1f9fe 世界账本</h2></div>');
    parts.push('<div class="lg-face lg-face-' + meta.tone + '">');
    parts.push('<span class="lg-face-icon">' + meta.icon + '</span>');
    parts.push('<span class="lg-face-label">' + meta.label + '</span>');
    parts.push('</div>');
    if (face === LEDGER_REASONS.ready && proj) {
      if (proj.describe) parts.push('<div class="lg-desc">' + this._esc(proj.describe) + '</div>');
      if (proj.counts) {
        const c = proj.counts;
        parts.push('<div class="lg-grid">');
        parts.push(this._tile('\u6697\u6d41', c.currents, 'lg-tile-cur'));
        parts.push(this._tile('\u4e8b\u5b9e', c.facts, 'lg-tile-fac'));
        parts.push(this._tile('\u4eba\u7269', c.people, 'lg-tile-pee'));
        parts.push(this._tile('\u8206\u60c5', c.opinion, 'lg-tile-opp'));
        parts.push('</div>');
      }
      if (proj.gap) {
        if (proj.gap.verdict === 'gapped') parts.push('<div class="lg-gap lg-gap-warn">\u26a0\ufe0f 未外供缺口 ' + proj.gap.notMarkedCount + ' 条暗流</div>');
        else if (proj.gap.verdict === 'no-filter') parts.push('<div class="lg-gap">缺口不可知（上游无 filter）</div>');
        else if (proj.gap.verdict === 'full') parts.push('<div class="lg-gap lg-gap-ok">\u2705 全量放行</div>');
      }
      if (proj.peopleMismatch > 0) parts.push('<div class="lg-gap lg-gap-warn">\u26a0\ufe0f 人物位置冲突 ' + proj.peopleMismatch + ' 条</div>');
    }
    parts.push('<div class="lg-settings">');
    parts.push('<h3>\u2699\ufe0f 设置</h3>');
    parts.push('<label class="lg-toggle"><input type="checkbox" id="lg-inject" ' + (this.app.settings.injectToPrompt ? 'checked' : '') + '><span>注入 Prompt</span></label>');
    parts.push('</div>');
    return parts.join('\n');
  }

  _tile(label, value, cls) {
    return '<div class="lg-tile ' + cls + '"><span class="lg-tile-num">' + value + '</span><span class="lg-tile-label">' + label + '</span></div>';
  }

  _bindEvents() {
    const inject = this._root.querySelector('#lg-inject');
    if (inject) inject.addEventListener('change', (e) => {
      this.app.settings.injectToPrompt = e.target.checked;
      this.app.saveSettings();
    });
  }

  _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
