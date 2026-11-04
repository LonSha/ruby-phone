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
/* [v4.112.0 · R13-X1] 「今天」：把散在各 App 里的事收成一条时间轴。
 *   为什么接在时计而不是新开一个 App：计划书两个入口里倾向「挂到 apps/clock 内部页签」，
 *   理由写在计划原文：「不增加主屏格子压力」，且**时间是 clock 的主题**。
 *   内核只做聚合（config/today-timeline.js），取数在 App 这侧（它才拿得到各 App 实例）。 */
import { buildToday, todayLine } from '../../config/today-timeline.js';
import { TODAY_STATES, TODAY_SOURCES, TODAY_SOURCE_STATES, TODAY_KINDS } from '../../config/today-terms.js';
/* [v4.119.0 · R14-O3] 今天的两条本地源（日记 / 日历）带靶心：靶心只能用渲射面的唯一一支笔写
 *   （手写字段名一漂，消费侧就静默落空，而落空的表现是「点了没反应」）。 */
import { buildOpenRef } from '../../config/open-ref.js';
import { storyNow } from '../../config/time-source.js';

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

  /* ════════ [v4.112.0 · R13-X1] 「今天」：五条时间流收成一条 ════════
   * 三条口径（与内核的分工）：
   *   ① **边界由本侧算**：剧情日的 0 点切（口径与理由写在 config/today-terms.js 文件头）。
   *      内核不读钟，故必须在这里算好 `[start, end)` 传进去；
   *   ② **取数由本侧做**：只有 App 拿得到别的 App 实例。每个源**单独 try**：
   *      一个 App 抛错不许把整条时间轴带走（那会把「某个 App 坏了」显示成「今天没事」）；
   *   ③ **没接入 ≠ 没事**：源实例不在就**不放这个键**，内核据此报 absent。
   */
  /** 剧情日今天的半开区间（毫秒）。读不到剧情钟 ⇒ null，**不拿墙钟顶替**。 */
  _todayRange() {
    const s = storyNow(this._win());
    if (!s || s.ok !== true || s.ms === null || s.ms <= 0) return null;
    const d = new Date(s.ms);
    d.setHours(0, 0, 0, 0);
    const start = d.getTime();
    const e = new Date(start);
    e.setDate(e.getDate() + 1);
    return { start: start, end: e.getTime() };
  }

  /** 取一个源的原串（形状统一成 `{at, id, kind, title}`）。拿不到 / 抛错 ⇒ null。 */
  _todaySourceRows(name, vp) {
    const safe = (fn) => { try { return fn(); } catch (_e) { return null; } };
    if (name === 'wechat') {
      const wd = vp?.wechatApp?.wechatData;
      /* 会话列表没有 getter（本仓就是 `data.chats`），故直接读数据面；
       *   但**不自己拼第二份会话结构** —— 只取 id 与 name 两个字段。 */
      if (!wd || typeof wd.getMessages !== 'function') return null;
      const chats = Array.isArray(wd.data?.chats) ? wd.data.chats : null;
      if (!chats) return null;
      return safe(() => {
        const out = [];
        for (const chat of chats) {
          const cid = String(chat?.id || '');
          if (!cid) continue;
          for (const m of (wd.getMessages(cid) || [])) {
            out.push({
              at: m?.storyAt ?? m?.timestamp,
              /* id 拼上会话：同一条消息的 id 只在会话内唯一，跨会话会撞。 */
              id: cid + ':' + String(m?.id || ''),
              kind: TODAY_KINDS.message,
              title: String(chat?.name || '') + '：' + String(m?.content || m?.mes || '')
            });
          }
        }
        return out;
      });
    }
    if (name === 'calendar') {
      const cd = vp?.calendarApp?.calendarData;
      if (!cd || typeof cd.getMemos !== 'function') return null;
      return safe(() => (cd.getMemos() || []).map((mm) => {
        const id = String(mm?.id || '');
        return {
          at: mm?.storyAt, id: id, kind: TODAY_KINDS.memo,
          title: String(mm?.title || '') + (mm?.time ? (' ' + String(mm.time)) : ''),
          /* [v4.119.0 · R14-O3] 靶心用渲射面的**同一支笔**（buildOpenRef），
           *   不手写 object 字面量 —— 归属一改就会有一处静默失配。 */
          ref: buildOpenRef('calendar', id, 'calendar')
        };
      }));
    }
    if (name === 'diary') {
      const dd = vp?.diaryApp?.diaryData;
      if (!dd || typeof dd.getEntries !== 'function') return null;
      return safe(() => (dd.getEntries() || []).map((e) => {
        const id = String(e?.id || '');
        return {
          at: e?.storyAt, id: id, kind: TODAY_KINDS.diary,
          title: String(e?.title || e?.date || ''),
          /* [v4.119.0 · R14-O3] 同上：日记条目带靶心，「今天」才能点回那一篇。 */
          ref: buildOpenRef('diary', id, 'diary')
        };
      }));
    }
    if (name === 'album') {
      const ad = vp?.albumApp?.albumData;
      if (!ad || typeof ad.getMedia !== 'function') return null;
      return safe(() => (ad.getMedia() || []).map((it) => ({
        /* 相册的剧情轨是 `storyAt`（历史数据没有它 ⇒ 内核会当作「时刻不可用」丢弃并记账，
         *   不拿墙钟 createdAt 顶替 —— 那会把「哪次导入写的索引」显示成「什么时候拍的」）。 */
        at: it?.storyAt, id: String(it?.id || ''), kind: TODAY_KINDS.photo,
        title: String(it?.filename || '')
      })));
    }
    return null;
  }

  /**
   * 「今天」的取数口（视图唯一入口）。
   * @returns {{state:string, events:Array, sourceRows:Array, truncated:number, dropped:number, line:string, readError:string}}
   */
  today() {
    const range = this._todayRange();
    const vp = this._win()?.VirtualPhone || null;
    const sources = {};
    for (const name of TODAY_SOURCES) {
      const rows = vp ? this._todaySourceRows(name, vp) : null;
      /* 拿不到就**不放这个键** —— 内核据此报 absent（没接入），而不是「今天没事」。 */
      if (rows !== null) sources[name] = rows;
    }
    if (!range) {
      /* 剧情钟读不到：不排时间轴，但源状态照报（否则界面会把「算不出来」说成「没事」）。
       * ★ 必须区分两种「读不到」：**一个源都没有**（absent，整机没装/没开宿主）与
       *   **源在、但钟读不到**（no-clock）。压成一句会让「手机还没起来」与
       *   「时钟没同步」变成同一句话 —— 处置相反（等它就绪 / 去同步时间）。 */
      const res0 = buildToday({ start: 0, end: 0, sources: sources });
      const live0 = res0.sourceRows.filter((x) => x.state === TODAY_SOURCE_STATES.ok).length;
      if (!live0) {
        return {
          state: TODAY_STATES.absent, events: [], sourceRows: res0.sourceRows,
          truncated: 0, dropped: 0, line: todayLine({ state: TODAY_STATES.absent, sourceRows: res0.sourceRows }),
          readError: '一个 App 都还没接入今天 —— 这不等于今天没事'
        };
      }
      return {
        state: TODAY_STATES.noClock, events: [], sourceRows: res0.sourceRows,
        truncated: 0, dropped: 0, line: todayLine(res0),
        readError: '剧情时刻读不到，今天的边界定不下来 —— 这不等于今天没事'
      };
    }
    const res = buildToday({ start: range.start, end: range.end, sources: sources });
    return {
      state: res.state, events: res.events, sourceRows: res.sourceRows,
      truncated: res.truncated, dropped: res.dropped,
      line: todayLine(res), readError: ''
    };
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
