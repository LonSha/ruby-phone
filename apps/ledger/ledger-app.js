/* [v2.53.0] 世界账本 App 控制器 */

import { LEDGER_REASONS, defaultLedgerSettings, readLedgerFace, projectLedger, ledgerPromptBlock } from './ledger-data.js';
import { LedgerView } from './ledger-view.js';

export class LedgerApp {
  constructor(phoneShell, storage) {
    this.shell = phoneShell;
    this.storage = storage;
    this.settings = { ...defaultLedgerSettings() };
    this._probe = null;
    this._face = LEDGER_REASONS.bridge_absent;
    this._proj = null;
    this._view = null;
    this._hookBound = false;
    this._loadSettings();
  }

  probeBridge() {
    const bridge = window.lonsha_memory_bridge_v1 || null;
    if (!bridge) {
      this._probe = { hasBridge: false, hasSnapshot: false, ledger: null };
      this._face = LEDGER_REASONS.bridge_absent;
      this._proj = null;
      return;
    }
    let snap = null;
    try { snap = bridge.snapshot ? bridge.snapshot() : null; } catch (e) { snap = null; }
    if (!snap || typeof snap !== 'object') {
      this._probe = { hasBridge: true, hasSnapshot: false, ledger: null };
      this._face = LEDGER_REASONS.no_snapshot;
      this._proj = null;
      return;
    }
    const wlr = snap.worldLedgerRead;
    this._probe = { hasBridge: true, hasSnapshot: true, ledger: wlr };
    this._face = readLedgerFace(this._probe);
    this._proj = (this._face === LEDGER_REASONS.ready) ? projectLedger(wlr) : null;
  }

  ledgerFace() { return this._face; }
  projection() { return this._proj; }

  summaryLine() {
    if (!this._proj) return '';
    const p = this._proj;
    if (!p.counts) return '';
    return '暗流 ' + p.counts.currents + ' · 事实 ' + p.counts.facts + ' · 人物 ' + p.counts.people;
  }

  promptBlock() {
    if (!this.settings.injectToPrompt) return '';
    if (this._face !== LEDGER_REASONS.ready) return '';
    return ledgerPromptBlock(this._probe ? this._probe.ledger : null);
  }

  _win() {
    try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
  }
  /** [v2.55.0 修复] 同 clock：改用 SillyTavern eventSource + payload.prompt（原桥接钩子全仓无定义）。 */
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
    if (!this._view) this._view = new LedgerView(this, this.shell, this.storage);
    this._view.render();
  }

  _loadSettings() {
    try {
      const raw = this.storage ? this.storage.get('ledger_settings') : null;
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch (e) { /* default */ }
  }

  saveSettings() {
    try { if (this.storage) this.storage.set('ledger_settings', JSON.stringify(this.settings)); } catch (e) { /* silent */ }
  }
}
