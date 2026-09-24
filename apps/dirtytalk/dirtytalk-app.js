/* ========================================================
 * dirtytalk-app.js — [v2.48.0] 撩语 · 语料控制器
 *
 * 「撩语」App：把聊骚语料世界书的 199 个模块做成手机里可查、可装配、可注入的说话方式库。
 * 获取侧走幸运转盘（模块以自身 `dt_<hash>` id 入背包），生效侧走本模块的生成前钩子。
 *
 * 三条纪律（与 cheat-app.js 同规格）：
 *   ① 只读：语料正文是内置静态事实源（data/dirtytalk.js），本模块不写它；
 *         背包读数从幸运转盘的 `ruby_gacha_state` **现取**，不复制一份到本 App 的键里
 *         （否则两处库存必然会漂移——本仓反复治理过的「双份真相」形态）；
 *   ② 不抛：storage 畸形 / 宿主无 eventSource / 注入载荷畸形，一律降级，绝不阻断；
 *   ③ 不猜：装备的是哪个模块由 id 如实查询，未知 id 如实丢弃并可上报，绝不顶替。
 *
 * 【本 App 只持久化「装配清单」】键 dt_state_v1（匹配 /^dt_/），存 installed[] + 设置。
 *   装配清单**不必**与背包求交：抽卡记录可能随会话回滚，而清单只需保证「装的是库里真有的模块」，
 *   sanitizeInstalled 每次读取时都会重新校验并丢未知 id。
 * ======================================================== */
'use strict';
import {
  defaultDtSettings,
  sanitizeInstalled,
  installedChars,
  buildDtPromptBlock,
  vaultOverview,
  corpusOverview,
  getModuleById,
  dtModuleIdOfItem,
  sceneStyleHints,
} from './dt-data.js';
import { readPushProbe } from '../../config/world-bridge.js';
// [v2.49.0] 场景联动：位置链解析复用 place 侧唯一真源（纯函数，跨 App 只读复用不造第二套）
import { currentChainOf } from '../place/place-data.js';
import { DtView } from './dt-view.js';

/** 状态键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^dt_/`，否则跨会话串味 */
const STATE_KEY = 'dt_state_v1';
/** 幸运转盘的背包键（**只读**，本 App 绝不写它；键名与 gacha-data.js 逐字一致） */
const GACHA_KEY = 'ruby_gacha_state';

export class DtApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.view = new DtView(this);
    this._hooked = false;
    this._initHook();
  }

  /* ========== 状态（随会话隔离，容错读写） ========== */
  _readState() {
    try {
      const raw = this.storage?.get?.(STATE_KEY);
      const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_e) { return {}; }
  }
  _writeState(next) {
    try {
      this.storage?.set?.(STATE_KEY, JSON.stringify(next || {}));
      return true;
    } catch (_e) { return false; }
  }
  /** 设置（缺项用默认值补齐；maxInstall 超范围由 sanitizeInstalled 再夹一次） */
  getSettings() {
    const s = this._readState().settings;
    return { ...defaultDtSettings(), ...((s && typeof s === 'object') ? s : {}) };
  }
  saveSettings(patch) {
    const state = this._readState();
    state.settings = { ...this.getSettings(), ...(patch || {}) };
    this._writeState(state);
    return state.settings;
  }
  /** 装配清单（已校验：丢未知 id、去重、按设置上限截断） */
  getInstalled() {
    const s = this.getSettings();
    return sanitizeInstalled(this._readState().installed, { limit: s.maxInstall }).ids;
  }
  isInstalled(id) { return this.getInstalled().includes(String(id || '')); }
  /**
   * 装配 / 卸载（切换）。超过上限时**不改动清单**并如实回报，由视图提示用户先卸一个。
   * @returns {{ok:boolean, reason?:string, installed:string[], limit:number}}
   */
  toggleInstall(id) {
    const key = String(id || '');
    const settings = this.getSettings();
    const cur = this.getInstalled();
    if (!key) return { ok: false, reason: '模块 id 为空', installed: cur, limit: settings.maxInstall };
    if (!getModuleById(key)) {
      return { ok: false, reason: `未知模块（${key}）`, installed: cur, limit: settings.maxInstall };
    }
    if (cur.includes(key)) {
      const next = cur.filter((x) => x !== key);
      const state = this._readState();
      state.installed = next;
      this._writeState(state);
      return { ok: true, installed: next, limit: settings.maxInstall };
    }
    if (cur.length >= settings.maxInstall) {
      return { ok: false, reason: `装配位已满（${settings.maxInstall}）`, installed: cur, limit: settings.maxInstall };
    }
    const next = cur.concat([key]);
    const state = this._readState();
    state.installed = next;
    this._writeState(state);
    return { ok: true, installed: next, limit: settings.maxInstall };
  }
  /** 一键清空装配（换玩法时的常用动作） */
  clearInstalled() {
    const state = this._readState();
    state.installed = [];
    this._writeState(state);
    return [];
  }

  /* ========== 背包（从幸运转盘现取，只读） ========== */
  ownedIds() {
    try {
      const raw = this.storage?.get?.(GACHA_KEY);
      const d = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      const inv = (d && typeof d === 'object' && d.inventory && typeof d.inventory === 'object') ? d.inventory : {};
      const out = new Set();
      for (const [itemId, count] of Object.entries(inv)) {
        if (!(Number(count) > 0)) continue;
        const packId = dtModuleIdOfItem(itemId);
        if (packId) out.add(packId);
      }
      return out;
    } catch (_e) { return new Set(); }
  }
  /** 装配概览：条数 + 占位上限 + 合计字数（视图头部/设置页实时反馈注入负担） */
  installedSummary() {
    const s = this.getSettings();
    const ids = this.getInstalled();
    const { count, chars } = installedChars(ids);
    return { ids, count, chars, limit: s.maxInstall, settings: s };
  }
  /** 库概览（总数/总字数/各类别条数） */
  overview() { return { ...vaultOverview(), corpus: corpusOverview() }; }

  /* ========== 生成侧 ========== */
  promptBlock() {
    try {
      const s = this.getSettings();
      if (!s.injectToPrompt) return '';
      return buildDtPromptBlock(this.getInstalled(), { settings: s });
    } catch (_e) { return ''; }
  }
  /**
   * [v2.49.0] 场景联动：读 place 侧只读桥的当前所在位置链（不缓存、不写上游），
   * 映射成词库页顶部的风格推荐。桥不在 / 无快照 / 无位置链 → 空结果（不编推荐）。
   * 本 App 依然只读：位置链来自 place 的桥快照，撩语不碰 place 的任何状态。
   * @returns {{chain:string[], styles:Array<{name:string, why:string}>}}
   */
  sceneStyleHints() {
    try {
      // [v2.97.0] 读法收敛到真源 readPushProbe（不再自摸全局、不再自判快照形态）
      const snap = readPushProbe().snapshot;
      if (!snap || typeof snap !== 'object') return { chain: [], styles: [] };
      const face = snap.scene;
      if (!face || typeof face !== 'object') return { chain: [], styles: [] };
      const chain = currentChainOf(face);
      return sceneStyleHints(chain, { max: 3 });
    } catch (_e) { return { chain: [], styles: [] }; }
  }
  _initHook() {
    if (this._hooked) return;
    try {
      const ctx = (typeof window !== 'undefined' ? window : globalThis)?.SillyTavern?.getContext?.();
      const es = ctx?.eventSource;
      const et = ctx?.event_types;
      if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
      es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
        try {
          if (!payload || !Array.isArray(payload.prompt)) return;
          const block = this.promptBlock();
          if (block) payload.prompt.push({ role: 'system', content: block });
        } catch (_e) { /* 静默失败：生成照常进行 */ }
      });
      this._hooked = true;
    } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
  }

  /**
   * 换会话 / 清数据：装配清单存在本 App 自己的会话键里（storage 按 chatMetadata 隔离），
   * 换会话后读的就是新会话的清单，**无需重绑数据层**；背包也是每次现取，不持副本。
   * 真正要丢的是**视图的浏览位置**。
   */
  onChatChanged() {
    try {
      if (this.view) { this.view.detail = null; this.view.q = ''; this.view.tab = 'installed'; this.view.cat = ''; }
    } catch (_e) { /* 视图状态清理失败不影响数据正确性 */ }
  }

  render() { this.view.render(this.phoneShell?.screen); }
}

export default DtApp;
