/* ========================================================
 * clock-app.js — [v2.52.0] 时计 App 控制器
 * 照抄 wallet-app 规格：probeBridge → face → projection → promptBlock
 * ======================================================== */

import { CLOCK_REASONS, defaultClockSettings, readClockFace, projectClock, clockPromptBlock } from './clock-data.js';
import { ClockView } from './clock-view.js';
import { readPushProbe } from '../../config/world-bridge.js';
/* [v3.0.1] 投影契约的**归属面**（L-F5 的遗留观察项之一）。
 *   数据面照旧读只读快照的时计面（`readClockFace` 的三态归因一个字不动）；
 *   投影只补「这份读数是哪一次的」（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
 *   不替换数据源的理由见 config/projection-contract.js 的 projectionScopeLine 文件头。 */
import { readProjection, projectionScopeLine } from '../../config/projection-contract.js';

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
    // [v2.98.0] 第二参传快照本体：三态判定（「没这面」vs「声明了但空」）要看上游自述
    this._face = readClockFace(this._probe, snap);
    this._proj = (this._face === CLOCK_REASONS.ready) ? projectClock(clock) : null;
  }

  clockFace() { return this._face; }
  projection() { return this._proj; }

  /**
   * 归属面（[v3.0.1]）：这份读数是**哪一次的**（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
   * 与数据面分开取（`_face` / `_proj` 由 probeBridge 现取，本面只回答「能不能用、是谁的」）；
   * 不抛、结构恒定。
   */
  sourceFace() {
    try {
      return projectionScopeLine(readProjection(this._win()));
    } catch (_e) {
      return projectionScopeLine(null);
    }
  }

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
