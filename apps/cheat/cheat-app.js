/* ========================================================
 * cheat-app.js — [v2.47.0] 万界武库 · 外挂控制器
 *
 * 「金手指」App：把万界武库的 165 个外挂包做成手机里可查、可装配、可注入的权能库。
 * 获取侧走幸运转盘（外挂以 `cheat_<packId>` 入背包），生效侧走本模块的生成前钩子。
 *
 * 三条纪律（与 place-app.js 同规格）：
 *   ① 只读：外挂正文是内置静态事实源（data/cheats.js），本模块不写它；
 *         背包读数从幸运转盘的 `ruby_gacha_state` **现取**，不复制一份到本 App 的键里
 *         （否则两处库存必然会漂移——本仓反复治理过的「双份真相」形态）；
 *   ② 不抛：storage 畸形 / 宿主无 eventSource / 注入载荷畸形，一律降级，绝不阻断；
 *   ③ 不猜：装备的是哪个外挂由 id 如实查询，未知 id 如实丢弃并可上报，绝不顶替。
 *
 * 【本 App 只持久化「装配清单」】键 cheat_state_v1（匹配 /^cheat_/），存 installed[] + 设置。
 *   装配清单**不必**与背包求交：抽卡记录可能随会话回滚，而清单只需保证「装的是库里真有的外挂」，
 *   sanitizeInstalled 每次读取时都会重新校验并丢未知 id。
 * ======================================================== */
'use strict';
import {
  defaultCheatSettings,
  sanitizeInstalled,
  installedChars,
  buildCheatPromptBlock,
  vaultOverview,
  getCheatById,        // 装配前校验 id 真实存在（不把未知 id 写进存储等读时净化）
  cheatPackIdOfItem,   // 背包 itemId → packId 的唯一真源（不在本模块手写 'cheat_' 前缀）
} from './cheat-data.js';
import { CheatView } from './cheat-view.js';

/** 状态键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^cheat_/`，否则跨会话串味 */
const STATE_KEY = 'cheat_state_v1';
/** 幸运转盘的背包键（**只读**，本 App 绝不写它；键名与 gacha-data.js 逐字一致） */
const GACHA_KEY = 'ruby_gacha_state';

export class CheatApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.view = new CheatView(this);
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
    return { ...defaultCheatSettings(), ...((s && typeof s === 'object') ? s : {}) };
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
    if (!key) return { ok: false, reason: '外挂 id 为空', installed: cur, limit: settings.maxInstall };
    // 未知 id 如实拒绝：**不写进存储**（否则存储里留下永不生效的垃圾项，
    //   虽然读取时 sanitizeInstalled 会丢，但「写脏 + 读时净化」是多一层终将被绕过的兜底）。
    if (!getCheatById(key)) {
      return { ok: false, reason: `未知外挂（${key}）`, installed: cur, limit: settings.maxInstall };
    }
    if (cur.includes(key)) {
      const next = cur.filter((x) => x !== key);
      const state = this._readState();
      state.installed = next;
      this._writeState(state);
      return { ok: true, installed: next, limit: settings.maxInstall };
    }
    if (cur.length >= settings.maxInstall) {
      // 到顶了：如实拒绝，不静默踢掉先装的那个（用户预期里先装的更该留住）
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
  /**
   * 已拥有的外挂 id 集合。读不到（没抽过 / 未开过抽卡 / 键畸形）一律返回空集——
   * 「读不到」与「没有」在本 App 里都是「库里还没你的东西」，不需要分开报。
   */
  ownedIds() {
    try {
      const raw = this.storage?.get?.(GACHA_KEY);
      const d = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      const inv = (d && typeof d === 'object' && d.inventory && typeof d.inventory === 'object') ? d.inventory : {};
      const out = new Set();
      for (const [itemId, count] of Object.entries(inv)) {
        if (!(Number(count) > 0)) continue;
        // 反解走 cheatPackIdOfItem（非外挂 id 返回空串，不猜）：避免本模块自行截前缀致漂移
        const packId = cheatPackIdOfItem(itemId);
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
  /** 库概览（总数/总字数/各品阶条数） */
  overview() { return vaultOverview(); }

  /* ========== 生成侧 ========== */
  /** 生成前注入块：无装配/开关关闭返回 ''（不产生空块） */
  promptBlock() {
    try {
      const s = this.getSettings();
      if (!s.injectToPrompt) return '';
      return buildCheatPromptBlock(this.getInstalled(), { settings: s });
    } catch (_e) { return ''; }
  }
  /** 挂生成前钩子（构造期一次；宿主无 eventSource 时静默不挂，不影响 App 本体） */
  _initHook() {
    if (this._hooked) return;
    try {
      const ctx = (typeof window !== 'undefined' ? window : globalThis)?.SillyTavern?.getContext?.();
      const es = ctx?.eventSource;
      const et = ctx?.event_types;
      if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
      es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
        // 注入失败绝不阻断生成：外挂是「既定事实」，不是必需上下文
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
   * 真正要丢的是**视图的浏览位置**：上一条会话展开到哪一篇外挂、搜索词是什么，
   * 都是旧会话的上下文，带到新会话会让人以为「新角色也装了那个」。
   */
  onChatChanged() {
    try {
      if (this.view) { this.view.detail = null; this.view.q = ''; this.view.tab = 'installed'; }
    } catch (_e) { /* 视图状态清理失败不影响数据正确性 */ }
  }

  render() { this.view.render(this.phoneShell?.screen); }
}

export default CheatApp;