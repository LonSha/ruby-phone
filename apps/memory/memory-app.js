/**
 * 记忆 App (Memory App) - 应用核心控制器
 * 数据层: MemoryCore (memory-data.js)  视图层: MemoryView (memory-view.js)
 * 洞察层: memory-insights.js (纯函数, v2.57.0)
 * 自动注入: 由 memoryCore.attachPromptHook() 统一挂载, autoInject 开启后生效
 *
 * 【v2.57.0 记忆洞察】修前形态：控制器只有 49 行，只把 MemoryCore 直接交给视图，
 *   而视图只用到引擎的四个计数 + 一个时间线列表。引擎里已经备好的五感归档
 *   （`getSensoryArchive`）、场景聚合（`getSceneTags`）、生命周期四段、换代压制、
 *   回忆权限三级全部**零消费**（全仓 grep 产品代码零命中）。
 *   本版把「引擎 → 可渲染读数」的投影收敛到 `insights()` 单一出口：
 *     ① 控制器不再让视图直接摸引擎内部结构（视图只吃投影后的数据）；
 *     ② 六面读数**一次取齐**（同一次调用的脸与数据必然同源，杜绝拼装期漂移）；
 *     ③ 全部经纯内核（memory-insights.js），控制器只负责取数与容错。
 *
 * 【为什么这里不缓存读数】与其他消费面 App 同规格：读数随会话变，
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据。
 *   故 onChatChanged() 只丢弃上一次的取数现场，不持有任何数据副本。
 */
import { MemoryView } from './memory-view.js';
import {
  senseRows, sceneRows, lifecycleRows, supersedePairs,
  emotionTrace, auditMemory, insightSummary, coverageRows
} from './memory-insights.js';
/* [v3.97.0 · R3-X2 / R3-X1] 上游三面的**唯一消费口**（本层只取数，不重算、不合成）：
 *   · `config/memory-qa-contract.js`     —— 往事问答（memoryQaAnswer）与记忆工具信封
 *                                            （memoryToolsEnvelope）；
 *   · `config/phone-fact-contract.js`    —— 手机事实回执（phoneFactReceipt）。
 *   为什么收在控制器这一层：视图**只吃投影后的数据**（本 App 既有纪律），
 *   而「上游出口在不在 / 读出来是什么态」属取数事，与渲染无关。 */
import {
  readMemoryQaAnswer, readMemoryToolsDescribe, readMemoryToolsEnvelope,
  MEMORY_QA_FACE_STATES
} from '../../config/memory-qa-contract.js';
import {
  readPhoneFactFace, readPhoneFactReceipt, readPhoneFactBatch, readPhoneFactPlanEdit,
  assemblePhoneFact
} from '../../config/phone-fact-contract.js';

export class MemoryApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    // 复用全局记忆核心 (index.js 空闲初始化, 后台持续运行)
    this.data = (window.VirtualPhone && window.VirtualPhone.memoryCore) || null;
    this.view = new MemoryView(this);
    /** 最近一次取数是否走了降级路径（供诊断；不参与渲染数据） */
    this._lastInsightDegraded = false;
  }

  render() {
    // 首次打开: 引导用户开启自动注入 (功能可见性)
    this._maybeShowOnboarding();
    const screen = this.phoneShell.layerHost?.('memory-main') || this.phoneShell.screen;
    this.view.render(screen);
  }

  /** 换会话/清数据时丢弃取数现场（本 App 不持有数据副本，故只需复位标志） */
  onChatChanged() {
    this._lastInsightDegraded = false;
    try {
      // 记忆核心由 index.js 统一 reload，这里只重新指向（实例可能被重建）
      this.data = (window.VirtualPhone && window.VirtualPhone.memoryCore) || null;
    } catch (_e) { /* 忽略 */ }
  }

  /* ========== 洞察取数：引擎 → 可渲染读数（单一出口） ========== */
  /**
   * 一次取齐六面读数。**任何一面失败都只让那一面为空，不连坐其余面**，
   * 且整体包一层 try/catch —— 洞察是「看一眼」，绝不能把一次渲染变成一次崩溃。
   *
   * @param {{perSense?:number, perScene?:number, perStage?:number, traceDays?:number}} [opts]
   * @returns {{ok:boolean, summary:string, senses:Array, scenes:Array,
   *            lifecycle:{rows:Array,total:number,protectedCount:number},
   *            supersede:Array, trace:Array, audit:object|null, data:object|null}}
   */
  insights(opts = {}) {
    const out = {
      ok: false, summary: '', senses: [], scenes: [],
      lifecycle: { rows: [], total: 0, protectedCount: 0 },
      supersede: [], trace: [], audit: null, data: null
    };
    try {
      const core = this.data;
      if (!core) { out.summary = '记忆系统未初始化'; return out; }
      out.data = core;
      const now = Date.now();

      // ① 五感归档（引擎已按权重排序；这里只做投影与裁剪）
      try {
        const archive = (core.pool && typeof core.pool.getSensoryArchive === 'function')
          ? core.pool.getSensoryArchive() : null;
        out.senses = senseRows(archive, { perSense: opts.perSense, now });
      } catch (_e) { out.senses = []; }

      // ② 场景聚合
      try {
        const scenes = (core.pool && typeof core.pool.getSceneTags === 'function')
          ? core.pool.getSceneTags() : null;
        out.scenes = sceneRows(scenes, { perScene: opts.perScene });
      } catch (_e) { out.scenes = []; }

      // ③ 生命周期四段（纯读，不触发墓碑化）
      try {
        out.lifecycle = lifecycleRows(core.longTerm, { perStage: opts.perStage, now });
      } catch (_e) { out.lifecycle = { rows: [], total: 0, protectedCount: 0 }; }

      // ④ 换代对读
      try { out.supersede = supersedePairs(core.longTerm, { now }); } catch (_e) { out.supersede = []; }

      // ⑤ 情感轨迹
      try { out.trace = emotionTrace(core.longTerm, { days: opts.traceDays, now }); } catch (_e) { out.trace = []; }

      // ⑥ 体检（依赖池统计与五感维度数，故放最后）
      try {
        let poolStats = {};
        try { poolStats = (core.pool && typeof core.pool.getStats === 'function') ? core.pool.getStats() : {}; } catch (_e) { poolStats = {}; }
        out.audit = auditMemory({
          longTerm: core.longTerm,
          shortTerm: core.shortTerm,
          poolStats,
          senseCount: out.senses.length
        }, { now });
      } catch (_e) { out.audit = null; }

      out.summary = insightSummary({
        senses: out.senses, scenes: out.scenes, lifecycle: out.lifecycle, audit: out.audit
      });
      out.ok = true;
      return out;
    } catch (_e) {
      this._lastInsightDegraded = true;
      out.summary = '洞察读取失败（已降级）';
      return out;
    }
  }

  /** 一行总述（供视图头部与 host 诊断） */
  summaryLine() {
    try {
      const pkg = this.insights({ perSense: 1, perScene: 1, perStage: 0 });
      return pkg.summary;
    } catch (_e) { return '记忆总述失败（已降级）'; }
  }

  /* ========== R3-X2 · 往事问答取数（消费上游 memoryQaAnswer） ========== */
  /**
   * 问一句往事。**只搬上游读数，不在这里合成答案、不补缺口**（R3-X2 验收原文：
   *   「未知时不编答案」「消费上游新面而非新增第 3 套记忆库」）。
   *
   * 【人名从哪来】`knownActors` 由本层从**引擎已认的实体名**装配（与上游
   *   `_qaKnownActors` 同源：图节点 + 实体表），**不由问句猜**。装配失败即给空数组 ——
   *   空数组让上游如实报「没认出人名」，本层不补、不编。
   *
   * @param {string} question
   * @returns 恒定 15 键 + { state, faceReason }（见 config/memory-qa-contract.js）
   */
  askPast(question) {
    /* ★ **不传 `knownActors`**：上游 `askMemoryQuestion` 的自述是
     *   `Array.isArray(o.knownActors) ? o.knownActors : this._qaKnownActors(maxActors)`——
     *   它自己有一个唯一装配点（图节点 + 实体表）。本层再装配一份就是**第二个真源**
     *   （本仓「同一口径只许一份实现」）；传空数组更糟：那会把上游装配点顶掉，
     *   把「本层没查出人名」谎报成「一个人名都没有」。故这一格整条交给上游。 */
    try {
      return readMemoryQaAnswer(typeof window !== 'undefined' ? window : null, question, {});
    } catch (_e) {
      return readMemoryQaAnswer(null, question, {});
    }
  }

  /** 记忆工具面自述（缺哪一格、为什么缺）——只转发上游 `memoryToolsDescribe()`。 */
  memoryToolsFace() {
    try { return readMemoryToolsDescribe(typeof window !== 'undefined' ? window : null); }
    catch (_e) { return readMemoryToolsDescribe(null); }
  }

  /** 结构化证据查询（走记忆工具信封；五态原样搬运）。 */
  evidenceQuery(spec, opts) {
    try { return readMemoryToolsEnvelope(typeof window !== 'undefined' ? window : null, spec, opts); }
    catch (_e) { return readMemoryToolsEnvelope(null, spec, opts); }
  }

  /* ========== R3-X1 · 手机事实回执取数（消费上游 phoneFactReceipt） ========== */
  /** 手机事实桥能力自述（面在位?/ 桥三态 / 四态是否穷尽）。只转发上游。 */
  phoneFactFace() {
    try { return readPhoneFactFace(typeof window !== 'undefined' ? window : null); }
    catch (_e) { return readPhoneFactFace(null); }
  }

  /**
   * 送一条手机事实（**只算不写**：上游 `handleFact` 是纯函数，落账由 owner 走既有门）。
   * @returns {{state, reason, eventClass, classKnown, guarded, guard, lifecycle, receipt, plan, notes}}
   */
  phoneFactReceipt(fact, ctx) {
    try { return readPhoneFactReceipt(typeof window !== 'undefined' ? window : null, fact, ctx); }
    catch (_e) { return readPhoneFactReceipt(null, fact, ctx); }
  }

  /** 批量送事实（批内去重与单条同函，本层不自写）。 */
  phoneFactBatch(facts, ctx) {
    try { return readPhoneFactBatch(typeof window !== 'undefined' ? window : null, facts, ctx); }
    catch (_e) { return readPhoneFactBatch(null, facts, ctx); }
  }

  /** 编辑 / 删除 / 撤回 ⇒ 上游换代或撤回计划（只算不写）。 */
  phoneFactPlanEdit(action, fact) {
    try { return readPhoneFactPlanEdit(typeof window !== 'undefined' ? window : null, action, fact); }
    catch (_e) { return readPhoneFactPlanEdit(null, action, fact); }
  }

  /**
   * 把「一条手机侧已发生的事」送上游并取回**可显示的回执**（财务/日历/剧情三类共用）。
   *
   * 【装配点唯一】`assemblePhoneFact` 住在 `config/phone-fact-contract.js`（**唯一实现**）——
   *   本方法与宿主口 `VirtualPhone.phoneFactReceiptFor` 都调它，不各拼一份
   *   （三处各拼一份必然漂移，而 `source` 名对不上时上游只会如实报 unknown）。
   *
   * @param {'finance'|'calendar'|'story'} cls
   * @param {object} payload 见 `assemblePhoneFact`
   * @param {{userDecision?:'accept'|'decline', revoked?:boolean, editAction?:string, chatId?:string}} [ctx]
   */
  sendPhoneEvent(cls, payload, ctx) {
    const c = Object.assign({}, ctx || {});
    try { c.chatId = c.chatId || String(this.storage?.currentConversationId || ''); } catch (_e) { /* 忽略 */ }
    try {
      return readPhoneFactReceipt(typeof window !== 'undefined' ? window : null, assemblePhoneFact(cls, payload), c);
    } catch (_e) {
      return readPhoneFactReceipt(null, assemblePhoneFact(cls, payload), c);
    }
  }

  /** 一条回执行是否「用户还需要动手」（供视图决定是否给确认/撤回按钮）。 */
  static needsUserAction(receipt) {
    const r = (receipt && typeof receipt === 'object') ? receipt : null;
    if (!r) return false;
    const step = String(r.nextStep || '');
    return step === 'ask-user-confirm' || step === 'retry-when-module-present' || step === 'retry-when-bridge-present';
  }

  /** 四态 → 是否已落定（**不把 pending 读成 rejected**）。 */
  static isSettled(receipt) {
    const r = (receipt && typeof receipt === 'object') ? receipt : null;
    const st = r ? String(r.state || '') : '';
    return st === 'accepted' || st === 'rejected' || st === 'revoked';
  }

  /* ========== 覆盖度取数：楼层账本现算读数（单一出口） ========== */
  /**
   * [v2.62.0] 楼层覆盖度读数。
   *
   * 【数据源】`window.LonShaFloorLedger.coverage(chat, opts)` 现算纯读——与上游引擎
   *   `_floorLedgerCoverage()` 同一真源、同一口径：只数 AI 楼，番外楼（lonsha_omit）
   *   与空楼不计，缺口逐楼列号并按 why 归因。**不缓存**：读数随楼层增删/重生成变，
   *   实例级缓存会陈旧，故每次打开现算（与其他消费面 App 同规格）。
   *
   * 【三态（不猜）】
   *   ok          —— 模块在位且拿到读数（total=0 亦是真值，如实报告）；
   *   unavailable —— 模块未加载（window.LonShaFloorLedger 不可用，reason='module-unavailable'）
   *                  或 coverage() 抛错（reason='thrown:…'）；
   *   absent      —— 存在 chat 的宿主上下文不可得。
   * @returns {{state:'ok'|'unavailable'|'absent', reason:string|null, cov:object}}
   */
  coverage() {
    try {
      const L = (typeof window !== 'undefined') ? window.LonShaFloorLedger : null;
      if (!L || typeof L.coverage !== 'function') {
        return { state: 'unavailable', reason: 'module-unavailable', cov: coverageRows(null) };
      }
      let chat = null;
      try {
        // 与上游引擎同形：SillyTavern 缺席时落到 {}，chat 取 [] —— 0 楼读数也是真值
        chat = (window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext() || {}).chat || [];
      } catch (_e) { chat = null; }   // getContext() 抛错：宿主上下文不可得
      if (!Array.isArray(chat)) {
        return { state: 'absent', reason: 'chat-context-unavailable', cov: coverageRows(null) };
      }
      const cov = L.coverage(chat, {
        upTo: chat.length - 1,
        assistantOnly: true,
        omitFunction: (m) => !!(m && m.extra && m.extra.lonsha_omit === true),
        skipFunction: (m) => !m || typeof m.mes !== 'string' || !m.mes.trim()
      });
      return { state: 'ok', reason: null, cov: coverageRows(cov) };
    } catch (e) {
      return { state: 'unavailable', reason: 'thrown:' + String((e && e.message) || e), cov: coverageRows(null) };
    }
  }

  /** 立即巩固（视图 🌙 按钮与体检建议共用同一入口，避免两处各写一遍） */
  sleepNow() {
    try {
      const r = this.data?.sleep?.();
      const n = (r && Number(r.consolidated)) || 0;
      window.toastr?.success(n ? '已巩固 ' + n + ' 条记忆' : '没有待巩固的记忆', '记忆');
      return n;
    } catch (_e) {
      window.toastr?.error('巩固失败（已降级，不影响已有记忆）', '记忆');
      return 0;
    }
  }

  _maybeShowOnboarding() {
    try {
      const KEY = 'memory_onboarded_v1';
      const done = this.storage?.get?.(KEY);
      if (done) return;
      this.storage?.set?.(KEY, '1');

      const core = this.data;
      if (!core) {
        window.toastr?.info('记忆系统正在后台初始化，稍后重新打开即可', '记忆');
        return;
      }
      if (!core.config.autoInject) {
        window.toastr?.info(
          '记忆已在后台自动采集。开启下方「自动注入 AI 上下文」，AI 才会真正记得你们的过往',
          '记忆',
          { timeOut: 8000 }
        );
      }
    } catch (e) { /* 忽略 */ }
  }
}

export default MemoryApp;