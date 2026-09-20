/* ========================================================
 * clock-app.js — [v2.52.0] 时计 App 控制器
 * 照抄 wallet-app 规格：probeBridge → face → projection → promptBlock
 * ======================================================== */

import { CLOCK_REASONS, defaultClockSettings, readClockFace, projectClock, clockPromptBlock } from './clock-data.js';
import { ClockView } from './clock-view.js';

export class ClockApp {
  constructor(phoneShell, storage) {
    this.shell = phoneShell;
    this.storage = storage;
    this.settings = { ...defaultClockSettings() };
    this._probe = null;
    this._face = CLOCK_REASONS.bridge_absent;
    this._proj = null;
    this._view = null;
    this._hookBound = false;
    this._loadSettings();
  }

  probeBridge() {
    const bridge = window.lonsha_memory_bridge_v1 || null;
    if (!bridge) {
      this._probe = { hasBridge: false, hasSnapshot: false, clock: null };
      this._face = CLOCK_REASONS.bridge_absent;
      this._proj = null;
      return;
    }
    let snap = null;
    try { snap = bridge.snapshot ? bridge.snapshot() : null; } catch (e) { snap = null; }
    if (!snap || typeof snap !== 'object') {
      this._probe = { hasBridge: true, hasSnapshot: false, clock: null };
      this._face = CLOCK_REASONS.no_snapshot;
      this._proj = null;
      return;
    }
    const clock = snap.clock;
    this._probe = { hasBridge: true, hasSnapshot: true, clock };
    this._face = readClockFace(this._probe);
    this._proj = (this._face === CLOCK_REASONS.ready) ? projectClock(clock) : null;
  }

  clockFace() { return this._face; }
  projection() { return this._proj; }

  summaryLine() {
    if (!this._proj) return '';
    const p = this._proj;
    const parts = [];
    if (p.date) parts.push(p.date);
    if (p.label) parts.push(p.label);
    if (p.turn > 0) parts.push('L' + p.turn);
    return parts.join(' ');
  }

  promptBlock() {
    if (!this.settings.injectToPrompt) return '';
    if (this._face !== CLOCK_REASONS.ready) return '';
    return clockPromptBlock(this._probe ? this._probe.clock : null);
  }

  _initHook() {
    if (this._hookBound) return;
    this._hookBound = true;
    const api = window.ST_API || window.StApi || null;
    if (!api || typeof api.registerHook !== 'function') return;
    api.registerHook('GENERATE_BEFORE_COMBINE_PROMPTS', (payload) => {
      try {
        const blk = this.promptBlock();
        if (blk && payload && Array.isArray(payload.systemMessages)) {
          payload.systemMessages.push({ role: 'system', content: blk });
        }
      } catch (e) { /* silent */ }
    });
  }

  onChatChanged() {
    this.probeBridge();
    if (this._view) this._view.refresh();
  }

  render() {
    this.probeBridge();
    this._initHook();
    if (!this._view) {
      this._view = new ClockView(this, this.shell, this.storage);
    }
    this._view.render();
  }

  _loadSettings() {
    try {
      const raw = this.storage ? this.storage.get('clock_settings') : null;
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch (e) { /* default */ }
  }

  saveSettings() {
    try {
      if (this.storage) this.storage.set('clock_settings', JSON.stringify(this.settings));
    } catch (e) { /* silent */ }
  }
}
