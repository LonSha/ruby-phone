/* ========================================================
 * clock-app.js — [v2.52.0] 时计 App 控制器
 * 照抄 wallet-app 规格：probeBridge → face → projection → promptBlock
 * ======================================================== */

import { CLOCK_REASONS, defaultClockSettings, readClockFace, projectClock, clockPromptBlock } from './clock-data.js';
import { ClockView } from './clock-view.js';
import { readPushProbe } from '../../config/world-bridge.js';

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
    const p = readPushProbe(this._win());
    const snap = p.snapshot;
    const clock = (snap && typeof snap === 'object') ? snap.clock : null;
    this._probe = { hasBridge: p.mounted, hasSnapshot: p.hasSnapshot, clock };
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

  _win() {
    try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
  }
  /** [v2.55.0 修复] 主链路挂钩：此前误用不存在的 window.ST_API 桥接钩子且 push 到
   *  systemMessages 字段，导致时计注入块在主链路静默失效；改为与 wallet/place 同源的
   *  SillyTavern.getContext().eventSource.on(GENERATE_BEFORE_COMBINE_PROMPTS) + payload.prompt。 */
  _initHook() {
    if (this._hookBound) return;
    try {
      const ctx = this._win().SillyTavern?.getContext?.();
      const es = ctx?.eventSource;
      const et = ctx?.event_types;
      if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
      es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
        try {
          if (!payload || !Array.isArray(payload.prompt)) return;
          const blk = this.promptBlock();
          if (blk) payload.prompt.push({ role: 'system', content: blk });
        } catch (_e) { /* 静默失败：生成照常进行 */ }
      });
      this._hookBound = true;
    } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
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
