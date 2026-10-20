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
/* [v4.23.0 · R4-X2] 数值取值门（全仓唯一实现）。
 *   本版自己写进去的四处弱口径写法被 weak-coercion 门实测抓到：
 *   那个写法把「没给」与「给了 0」读成同一个数，而两者处置相反
 *   （续读游标 vs 真的要读第 0 段起）。改走唯一实现，不就地再写一份。 */
import { numOrNull } from '../../config/num-gate.js';
/* [v4.23.0 · R4-X2] 多编码解码**复用阅读 App 那一份**（本仓多编码探测表只有一处实现）。
 *   本层不另立第二张候选表：两张表的评分口径迟早分叉，而分叉的后果是
 *   「同一份资料在阅读器里是好的、在导入向导里是乱码」—— 不报错、只错读数。 */
import { decodeTxtArrayBuffer } from '../reading/reading-data.js';
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
  readMemoryQaAnswer, readMemoryQaAnswerAsync, readMemoryToolsDescribe,
  readMemoryToolsEnvelope, MEMORY_QA_FACE_STATES
} from '../../config/memory-qa-contract.js';
/* [v4.14.0 · R4-O2] 问答请求身份与取消(纯函数)。
 *   本层只持一个跟踪器并把它交给上游;判定口径全在那件里。 */
import {
  newAskTracker, advanceAsk, isStale, cancelAsk, isCanceled,
  shouldCancelFn, makeAskTaskId, planAskPhase, ASK_PHASES, ASK_RUN_STATES
} from '../../config/ask-request.js';
/* [v4.22.0 · R4-X1] 可追问的往事会话（纯契约：只做读数与归一，不算继承）。
 *   为什么继承不在本层算：上游 qa-thread 内核已带「换会话作废重建」与
 *   「消歧未决不产结论」两条硬约束；本层再算一份就是把它们放在两处各判一次。 */
import {
  ASK_THREAD_PHASES, ASK_FOLLOWUP_OUTLETS, ASK_THREAD_LIMITS,
  planFollowUpOutlet, traceStepOf, appendTrace, normalizeThreadFace,
  receiptOfStep, carryLineOf, threadFaceLine, candidateRowsOf, askThreadSelfCheck, droppedTotalOf
} from '../../config/memory-ask-thread.js';
import {
  LORE_FACE_STATES, LORE_OUTLETS, LORE_ADMIT, LORE_LIMITS,
  planLoreOutlet, loreOutletProbe, readLoreDescribe, pickableClassesOf,
  readLoreParse, readLoreParseWindow, readLoreEntities, readLorePreview,
  readLorePlan, readLoreOverride, readLoreConfirmMapping, readLoreChanged,
  readLoreApply, readLoreLedger,
  loreVersionRef, loreChangedLine,
  admitOf, admitLineOf, loreFaceLine, loreJourneyLines, loreSelfCheck
} from '../../config/lore-import-contract.js';
import {
  readPhoneFactFace, readPhoneFactReceipt, readPhoneFactBatch, readPhoneFactPlanEdit,
  assemblePhoneFact
} from '../../config/phone-fact-contract.js';
/* [v4.13.0 · R4-O1] 出处靶心归一与定位手(纯函数)。本层只转交:chat 靶心调宿主
 *   `locateChatFloor`,memory 靶心交回视图派跨 App 事件(见该方法内注释)。 */
import { normalizeSource, locateTarget } from '../../config/source-locator.js';

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
    /* [v4.14.0 · R4-O2] 换会话当场作废对话代际:上一段的在飞回信不许写进新会话的问答面。
     *   与核心一致:tracker 哪怕只是一个计数器,换会话也必须换掉(否则新会话的第 1 次会与上一段的第 1 次撞代际)。 */
    this._askTracker = null;
    /* [v4.22.0 · R4-X1] 换了会话,上一段的追问轨迹当场作废。
     *   上游 thread 自带 chatKey 会作废重建(**它那一层不用本层操心**),但轨迹是手机
     *   自己留的那一份:不作废就会把上一段的条件画进新会话的那一屏 —— 用户看到
     *   「第 5 轮 · 人物 甲」而这一段一次都没追问过。不报错、只是错数据。 */
    this._askTrace = [];
    /* [v4.23.0 · R4-X2] 导入旅程是**本会话**的现场:换会话整块丢掉。
     *   不丢的后果不是报错,而是把上一段会话读进来的资料画进这一屏,用户以为
     *   手上那份已经读好了 —— 与追问轨迹同族的错数据形态。 */
    this._lore = null;
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
  /* ========== [v4.22.0 · R4-X1] 可追问的往事会话 ========== */
  /**
   * 追问面读数(**只搬上游**,不自己算继承)。
   *
   * 【三态必须分形】插件不在场 / 插件在但没有追问出口 / 有出口但本会话还没开始
   *   —— 压平任意两态都会造出处置相反的处境长得一样(装插件 vs 升级 vs 直接问)。
   *
   * 【插件自带 thread 读数口】优先读 `qaThread()`(它随聊天持久化、重开可查);
   *   旧插件没有这一口时回落「出口在不在」的派发相,如实报成 idle。
   *
   * @returns {{phase:string, turn:number, subjects:Array, candidates:Array,
   *            inheritAxes:Array, conditionAxes:Array, source:string, why:string}}
   */
  askThreadFace() {
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = (() => { try { return win ? win.LonShaMemory : null; } catch (_e) { return null; } })();
    if (!plugin) return Object.assign(normalizeThreadFace(null), { source: 'no-plugin' });
    const hasFU = typeof plugin.askMemoryQuestionFollowUp === 'function';
    const hasPlain = typeof plugin.askMemoryQuestion === 'function' || typeof plugin.askMemoryQuestionAsync === 'function';
    const outlet = planFollowUpOutlet(hasFU, hasPlain);
    if (outlet === ASK_FOLLOWUP_OUTLETS.NONE) {
      return Object.assign(normalizeThreadFace(null), { source: 'no-outlet', outlet: outlet });
    }
    /* 只有普通问答口:能做,但**没有继承** —— 如实报 unsupported,不假装能追。 */
    if (outlet === ASK_FOLLOWUP_OUTLETS.PLAIN) {
      return Object.assign(normalizeThreadFace({ turn: 0 }), { source: 'plain-only', outlet: outlet });
    }
    /* 本会话最近一轮追问回执(轨迹尾):它带 thread 读数**没有**的那两样
     *   (沿用轴与消歧候选)。故它只作补,不作主 —— 主仍是上游 thread。 */
    const last = (Array.isArray(this._askTrace) && this._askTrace.length)
      ? this._askTrace[this._askTrace.length - 1] : null;
    let raw = null;
    try { raw = (typeof plugin.qaThread === 'function') ? plugin.qaThread() : null; } catch (_e) { raw = null; }
    if (!raw || typeof raw !== 'object') {
      /* 旧插件没有 thread 读数口:本会话最近那一轮回执就是**唯一真源**
       *   (不给它,消歧候选一个都拿不到 —— 「歧义让用户选择」直接失效)。
       *   一轮都没追问过才报 idle(「还没开始」),不报「问不了」。 */
      if (last) {
        const recv = receiptOfStep(last);
        if (recv) return Object.assign(normalizeThreadFace(recv), { source: 'trace-read', outlet: outlet });
      }
      return Object.assign(normalizeThreadFace({ followUp: true, threadState: 'idle' }), { source: 'outlet-no-reader', outlet: outlet });
    }
    /* 插件自述的 thread 读数:state/subjects/candidates/turn 与回执同名同义;
     *   补 followUp:true 是因为**这一格来自追问线程本身**(不是普通问答回执)。 */
    const merged = Object.assign({}, raw, { followUp: true, threadState: raw.state, actors: raw.subjects });
    /* 同轮次的回执照抄沿用轴(thread 读数本身不带轴,不作主也不丢)。 */
    if (last && Number(last.turn) === Number(raw.turn)) {
      merged.inherit = (Array.isArray(last.inheritAxes) ? last.inheritAxes : []).map(function (a) { return { axis: a }; });
      merged.condition = (Array.isArray(last.conditionAxes) ? last.conditionAxes : []).map(function (a) { return { axis: a }; });
      if (last.awaiting === true) { merged.awaiting = true; merged.threadState = 'awaiting-disambig'; }
      if (!merged.candidates || !merged.candidates.length) merged.candidates = Array.isArray(last.candidates) ? last.candidates.slice() : [];
    }
    return Object.assign(normalizeThreadFace(merged), { source: 'thread-read', outlet: outlet });
  }

  /** 追问面一行读数(视图那一屏;没装/没出口/没开始/有 thread 各占一格)。 */
  askThreadLine() {
    const f = this.askThreadFace();
    if (f.phase === ASK_THREAD_PHASES.ABSENT) {
      return f.source === 'no-outlet' ? '追问:本版插件没有任何问答出口' : '追问:插件不在场';
    }
    if (f.source === 'plain-only') return '追问:本版插件没有追问出口(回落普通问答,不继承条件)';
    return threadFaceLine(f);
  }

  /** 派发相(供视图判「追问」按钮该不该亮;口径在契约件里一处判)。 */
  planAskFollowUpOutlet() {
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = (() => { try { return win ? win.LonShaMemory : null; } catch (_e) { return null; } })();
    if (!plugin) return ASK_FOLLOWUP_OUTLETS.NONE;
    return planFollowUpOutlet(
      typeof plugin.askMemoryQuestionFollowUp === 'function',
      typeof plugin.askMemoryQuestion === 'function' || typeof plugin.askMemoryQuestionAsync === 'function'
    );
  }

  /**
   * 追一句(**带条件继承**;走上游唯一出口 `askMemoryQuestionFollowUp`)。
   *
   * 【回落必须说出来】没有追问出口时回落普通问答,并在读数里明说
   *   「本次没有继承」—— 用户以为还在问甲、实际查了全库,是本项要治的那件事。
   *
   * 【消歧未决不产结论】上游 awaiting 时不跑查询;本层把候选原样交回视图让用户选,
   *   绝不替用户猜一个名字。
   *
   * @param {string} question
   * @returns {{ok:boolean, outlet:string, face:object|null, receipt:object|null, line:string, note:string}}
   */
  askFollowUp(question) {
    const outlet = this.planAskFollowUpOutlet();
    const q = String(question == null ? '' : question);
    if (!q.trim()) return { ok: false, outlet: outlet, face: null, receipt: null, line: '', note: '追问要先有一句话' };
    if (outlet === ASK_FOLLOWUP_OUTLETS.NONE) {
      return { ok: false, outlet: outlet, face: normalizeThreadFace(null), receipt: null, line: '', note: '插件不在场:问不了往事' };
    }
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = (() => { try { return win ? win.LonShaMemory : null; } catch (_e) { return null; } })();
    let receipt = null;
    if (outlet === ASK_FOLLOWUP_OUTLETS.FOLLOWUP) {
      try { receipt = plugin.askMemoryQuestionFollowUp(q, {}) || null; } catch (_e) { receipt = null; }
    } else {
      try { receipt = (typeof plugin.askMemoryQuestion === 'function') ? (plugin.askMemoryQuestion(q, {}) || null) : null; } catch (_e) { receipt = null; }
    }
    const face = normalizeThreadFace(receipt);
    /* 轨迹只记**约束**,不记答案全文(上游正文归上游,本层不长期镜像)。 */
    const kept = appendTrace(this._askTrace || [], traceStepOf(receipt, q));
    this._askTrace = kept.trace;
    let note = '';
    if (face.awaiting) {
      note = '指代不定:请先在候选里选一个(' + (face.candidates.length ? face.candidates.join(' / ') : '插件没给候选') + ')—— 本次**没有查**';
    } else if (outlet === ASK_FOLLOWUP_OUTLETS.PLAIN) {
      note = '本版插件没有追问出口:本次走普通问答,**上一轮的人与时点没有被继承**';
    } else if (kept.droppedTotal > 0) {
      /* 说「早前 N 轮不再回看」,N 是**累计总数**不是本次挤掉的（本仓已登记过的形态:
       *   把累计读数写成增量读数,用户看到的是「只丢了一轮」而实际丢了五轮）。 */
      note = '已按 ' + String(ASK_THREAD_LIMITS.turns) + ' 轮上限滚动,早前 ' + String(kept.droppedTotal) + ' 轮不再回看';
    }
    return { ok: true, outlet: outlet, face: face, receipt: receipt, line: threadFaceLine(face), note: note };
  }

  /**
   * 消歧点选(**只读**;把用户的裁决接回上游 thread)。
   *   未选中 ⇒ 保持 awaiting,如实报 unresolved —— 不产确定结论。
   * @param {string} name 用户点的那个人名
   */
  resolveAskPick(name) {
    const pick = String(name == null ? '' : name).trim();
    if (!pick) return { ok: false, reason: 'no-pick', resolved: false, face: this.askThreadFace(), note: '没选人:保持待消歧(不替用户猜)' };
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = (() => { try { return win ? win.LonShaMemory : null; } catch (_e) { return null; } })();
    if (!plugin || typeof plugin.qaThreadResolve !== 'function') {
      return { ok: false, reason: 'no-outlet', resolved: false, face: this.askThreadFace(), note: '本版插件没有消歧点选口(等升级记忆插件)' };
    }
    let res = null;
    try { res = plugin.qaThreadResolve([pick], {}) || null; } catch (_e) { res = null; }
    const resolved = !!(res && res.resolved === true);
    return {
      ok: resolved, reason: (res && res.reason) || (res ? '' : 'thrown'), resolved: resolved, face: this.askThreadFace(),
      note: resolved
        ? ('已记为「' + pick + '」,下一句追问会沿用这个主体')
        : ('没认下「' + pick + '」:保持待消歧(候选里没有这个名字,或插件未加载)'),
    };
  }

  /** 追问轨迹(视图那一屏;只回看约束,不回看答案全文)。 */
  askTrace() { return Array.isArray(this._askTrace) ? this._askTrace.slice() : []; }

  /** 累计有几轮已不再回看(视图那一屏的滚动提示;读不到如实给 0)。 */
  askDroppedTotal() { return droppedTotalOf(this._askTrace); }

  /** 消歧候选 → 可点行(不排序出「最可能」的那个)。 */
  askCandidateRows() { return candidateRowsOf(this.askThreadFace()); }

  /** 追问契约件自检的**真消费点**(诊断/视图可随时读一次)。 */
  askThreadSelfCheck() {
    try { return askThreadSelfCheck(); }
    catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], phases: 0, outlets: 0 }; }
  }

  /** 「本次沿用哪些条件」——计划验收原文点名要显示的那一屏。 */
  askCarryLine() { return carryLineOf(this.askThreadFace()); }

  /* ========== [v4.23.0 · R4-X2] 设定资料导入向导(消费上游 loreImport* 十二口) ========== */
  /** 上游插件句柄(**安全取**,不抛)。与追问面同款:视图不摸 window,取数全在本层。 */
  _lorePlugin() {
    const win = (typeof window !== 'undefined') ? window : null;
    try { return win ? win.LonShaMemory : null; } catch (_e) { return null; }
  }

  /** 旅程现场(懒初始化;换会话在 onChatChanged 里整块丢掉)。 */
  _blankLore() {
    return {
      file: '', source: '', cursor: 0,
      /* [v4.33.0 · R5-O6] 三份版本必须分家:
       *   `base` / `parsed` —— **候选**（这一次读进来的那一份，下游预览/计划/落笔都吃它）；
       *   `appliedBase` / `appliedRef` —— **已应用**的那一版（基线；只有落笔成功才更新）；
       *   `windowRead` —— 这一次读到的**窗口**（候选只覆盖全文件的某一段时如实标出）。
       *   修前每次 `loreReadSource` 都把 base 与 parsed 一起换成新解析 —— 于是
       *   「已应用版本」与「正在读的候选」永远是同一份，变更读数恒为「全部同值」，
       *   用户看到「什么都没变」而真实处境是「没得比」（两者处置相反）。 */
      base: null, parsed: null, windowRead: null,
      appliedBase: null, appliedRef: null, appliedFile: '', appliedSource: '',
      candidateRef: null, candidatePartial: false,
      entities: null, preview: null, override: null, mapping: null, changed: null,
      plan: null, applied: null, ledger: null,
      edits: [], picks: {}, sel: {}, selTouched: false, note: ''
    };
  }
  _loreState() { if (!this._lore || typeof this._lore !== 'object') this._lore = this._blankLore(); return this._lore; }
  /**
   * [v4.33.0 · R5-O6] 已应用版本的**引用**落在本地存储里（正文不落 —— 只存引用）。
   *
   * 【为什么只存引用】计划原文的「不做」:不默认永久复制两个全文到 PhoneStorage。
   *   引用由 `loreVersionRef` 纯算术产出(文件名 + 字符数 + 段键与指纹)，
   *   故重开 App 后仍能回答「当前采用的是哪一版」；正文仍归上游与附件 owner。
   * 【为什么按会话分键】资料导入账在上游是**会话内**的（`loreImportLedger` 不进携带面）,
   *   手机这一份引用跟着同一条口径，换会话不带走别人的「已应用」。
   */
  _loreRefKey() {
    let cid = '';
    try { cid = String(this.storage?.currentConversationId || ''); } catch (_e) { cid = ''; }
    return 'ruby_lore_applied_ref_v1' + (cid ? (':' + cid) : '');
  }
  _loreLoadAppliedRef() {
    try {
      const raw = this.storage?.get?.(this._loreRefKey());
      if (!raw) return null;
      const o = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      if (!o || typeof o !== 'object' || !o.key) return null;
      return { file: String(o.file || ''), chars: Number(o.chars) || 0, sections: Number(o.sections) || 0, key: String(o.key) };
    } catch (_e) { return null; }
  }
  _loreSaveAppliedRef(ref) {
    try {
      if (ref && ref.key) this.storage?.set?.(this._loreRefKey(), JSON.stringify(ref));
      else this.storage?.remove?.(this._loreRefKey());
    } catch (_e) { /* 存储不可用一律降级：读数仍在内存里，不阻断导入 */ }
  }
  /** 已应用版本引用（内存里没有就回落到存储；再没有就 null —— **不猜一份**）。 */
  loreAppliedRef() {
    const L = this._loreState();
    if (L.appliedRef && L.appliedRef.key) return L.appliedRef;
    const stored = this._loreLoadAppliedRef();
    if (stored) L.appliedRef = stored;
    return stored;
  }

  /**
   * 导入面读数(**只读,不跑真解析**)。
   *
   * 【三态必须分形】插件不在场 / 插件在但没有导入面 / 面在但读不出 —— 压平任意两态
   *   都会造出处置相反的处境长得一样(装插件 vs 升级插件 vs 本机读不出)。
   *
   * 【派发相严格判实】`planLoreOutlet` 只认真布尔;本层传的是 `typeof === 'function'`
   *   的结果,不是「有没有这个键」。
   */
  loreFace() {
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = this._lorePlugin();
    const describe = readLoreDescribe(win);
    /* 派发相的两口探测**走契约件**(出口名只在那件出现):此处自己写出口名,
     *   上游改名时这一份会静默落空、派发相退化成「只能看不能落」。 */
    const probe = loreOutletProbe(win);
    const outlet = planLoreOutlet(probe.hasParse, probe.hasApply);
    let source = 'read';
    if (!plugin) source = 'no-plugin';
    else if (describe.state === LORE_FACE_STATES.FACE_ABSENT) source = 'no-face';
    else if (describe.state === LORE_FACE_STATES.UNUSABLE) source = 'unreadable';
    return { state: describe.state, source: source, outlet: outlet, describe: describe, classes: pickableClassesOf(describe) };
  }

  /** 面读数一行(视图那一屏;没装 / 没面 / 读不出 各占一格,不压成一句)。 */
  loreLine() {
    const f = this.loreFace();
    if (f.source === 'no-plugin') return '资料导入:插件不在场 —— **不是**「这份资料导不进去」';
    if (f.source === 'no-face') return '资料导入:本版插件没有导入面(等升级 v3.327+)—— 这不是「资料有问题」';
    if (f.source === 'unreadable') return '资料导入:面读不出(' + String((f.describe && f.describe.faceReason) || 'unavailable') + ')—— 这不是「资料有问题」';
    return loreFaceLine(f.describe);
  }

  /** 派发相(供视图判「确认导入」按钮该不该亮;口径在契约件里一处判)。 */
  planLoreImportOutlet() { return this.loreFace().outlet; }

  /** 可改类选项(**选项表来自上游自述**,本层不另立一份类目表)。 */
  loreClasses() { return this.loreFace().classes; }

  /**
   * 从 File 读一份资料(**异步**;视图只递文件,不自己解码)。
   *
   * 【为什么解码不写在视图】本 App 纪律:视图只吃投影后的数据、不摸 window。
   *   而读文件与多编码探测属取数事;解码口径复用阅读 App 那一份(唯一实现)。
   * 【读不出来必须出声】空文件 / 解码失败**不猜一份正文** —— 猜出来的后果是
   *   「用户以为读进来了」而后面几跳全在描述一份不存在的资料。
   *
   * @returns {Promise<{ok:boolean, reason:string, note:string, encoding:string, chars:number}>}
   */
  loreReadFile(file) {
    return new Promise((resolve) => {
      const done = (r) => { this.loreNote(r.note); resolve(r); };
      if (!file || typeof file.name !== 'string') {
        done({ ok: false, reason: 'no-file', note: '没有选中文件', encoding: '', chars: 0 });
        return;
      }
      if (typeof FileReader !== 'function') {
        /* 无头环境 / 宿主没有 FileReader:如实说读不了,不假装读到了空的。 */
        done({ ok: false, reason: 'no-reader', note: '本机没有文件读取口(FileReader 不在场)', encoding: '', chars: 0 });
        return;
      }
      let reader = null;
      try { reader = new FileReader(); } catch (_e) { reader = null; }
      if (!reader) { done({ ok: false, reason: 'no-reader', note: '文件读取口建不起来', encoding: '', chars: 0 }); return; }
      reader.onerror = () => done({ ok: false, reason: 'read-error', note: '文件读失败(没有拿到内容)', encoding: '', chars: 0 });
      reader.onload = (e) => {
        let dec = null;
        try { dec = decodeTxtArrayBuffer((e && e.target && e.target.result) || new ArrayBuffer(0), 'auto'); }
        catch (_e) { dec = null; }
        const text = (dec && typeof dec.text === 'string') ? dec.text : '';
        if (!text.trim()) {
          done({ ok: false, reason: 'empty', note: '这份文件读出来是空的(或编码认不出来)', encoding: (dec && dec.encoding) || '', chars: 0 });
          return;
        }
        this.loreReadSource(text, file.name, {});
        done({ ok: true, reason: '', note: '已读进 ' + String(file.name) + '(' + ((dec && dec.encoding) || '未知编码') + ' · ' + String(text.length) + ' 字符)', encoding: (dec && dec.encoding) || '', chars: text.length });
      };
      try { reader.readAsArrayBuffer(file); }
      catch (_e) { done({ ok: false, reason: 'read-thrown', note: '文件读失败(调用抛错)', encoding: '', chars: 0 }); }
    });
  }
  /**
   * 读一份资料(整篇)。**只读**,解析结果留在本层给后面几跳用。
   *
   * 【换源即作废旧下游】解析换了源,旧预览 / 旧计划 / 旧落笔读数当场作废 ——
   *   拿旧预览去落笔就是「落一份对不上的资料」,而且它不报错(只是落的不是你手上这份)。
   *
   * 【[v4.33.0 · R5-O6] 但**已应用的那一版不许跟着换**】修前这里把 `base` 与 `parsed`
   *   一起换成新解析,而「已应用版本」当时就是这两个字段本身 —— 于是选一份新文件的那一刻,
   *   基线被候选顶掉,变更读数恒为「全部同值」,用户看到「什么都没变」而真实处境是
   *   「没得比」(处置相反:放心 vs 去确认应用)。修后基线单独住在 `appliedBase` /
   *   `appliedRef`,**只有落笔成功才更新**。
   */
  loreReadSource(text, fileName, opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    L.file = String(fileName == null ? '' : fileName);
    L.source = String(text == null ? '' : text);
    L.cursor = 0;
    L.base = readLoreParse(win, { text: L.source, file: L.file }, opts || {});
    L.parsed = L.base;
    L.windowRead = null;
    this._loreMarkCandidate(L.base, false);
    L.entities = null; L.preview = null; L.override = null; L.mapping = null;
    L.changed = null; L.plan = null; L.applied = null;
    L.edits = []; L.picks = {}; L.sel = {}; L.selTouched = false;
    return L.parsed;
  }
  /**
   * [v4.33.0 · R5-O6] 候选版本的形态标记（**唯一装配点**）。
   *
   * 【为什么「窗口读」必须传下去】变更读数里的 `removed` 清单在窗口读下**不可采信**
   *   ——窗口外的段不是被删了,只是这一次没读到。契约件据此给 `removedTrusted:false`,
   *   本层不自己判一遍(同一口径只许一份实现)。
   * 【为什么截断也算部分】被上游切短的源只覆盖了前一段,同样不足以判「移除」。
   */
  _loreMarkCandidate(parsed, isWindow) {
    const L = this._loreState();
    const p = (parsed && typeof parsed === 'object') ? parsed : null;
    const truncated = !!(p && p.state === LORE_FACE_STATES.BLOCKED && p.faceReason === 'source-truncated');
    L.candidatePartial = (isWindow === true) || truncated;
    L.candidateRef = loreVersionRef(L.file, p);
    return L.candidateRef;
  }
  /**
   * 读下一个窗口(**长资料的正规入口**;范围没给就按游标续读)。
   *   截断源在整篇读里已被拒(上游给 `source-truncated`),本口给「显式选范围」一条真路径。
   */
  loreReadWindow(range, opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    if (!L.source) {
      const empty = readLoreParseWindow(win, { text: '', file: '' }, Object.assign({}, opts || {}, { range: { from: 0, to: 0 } }));
      return Object.assign({}, empty, { note: '还没有读进任何资料' });
    }
    /* [v4.23.0 · 自抓缺陷] 首版用的是弱口径的那个写法 —— weak-coercion 门实测报 W1。
     *   它把「没给」的几种形态一律读成 0，于是「范围没给」（应续读游标）与
     *   「范围给了 0」（真的要读第 0 段起）在读数上同形，两者处置相反。
     *   改走全仓唯一实现 config/num-gate.js::numOrNull。 */
    const rangeFrom = numOrNull(range ? range.from : null);
    const cursorNum = numOrNull(L.cursor);
    const from = (rangeFrom !== null) ? rangeFrom : ((cursorNum !== null) ? cursorNum : 0);
    const rangeTo = numOrNull(range ? range.to : null);
    const to = (rangeTo !== null) ? rangeTo : (from + 40000);
    const r = readLoreParseWindow(win, { text: L.source, file: L.file }, Object.assign({}, opts || {}, { range: { from: from, to: to } }));
    L.base = r;
    L.parsed = r;
    L.windowRead = (r && typeof r.window === 'object') ? r.window : null;
    /* ★ 窗口读 = 候选只覆盖全文件的某一段 ⇒ 如实标成部分候选。 */
    this._loreMarkCandidate(r, true);
    /* [v4.23.0 · 自抓缺陷] 同上：上游窗口坐标「没给」不许被读成 0（0 是合法坐标）。 */
    const winToNum = numOrNull(r && r.window ? r.window.to : null);
    L.cursor = (winToNum !== null) ? winToNum : from;
    L.entities = null; L.preview = null; L.override = null; L.mapping = null;
    L.changed = null; L.plan = null; L.applied = null;
    L.edits = []; L.picks = {}; L.sel = {}; L.selTouched = false;
    return r;
  }
  /**
   * 源更新对账(**只重审变更段**)。拿**候选**重读一次,与**已应用的那一版**逐段对差。
   *
   * 【[v4.33.0 · R5-O6] 比的是谁与谁】修前 `oldParsed` 传的是 `L.base` —— 而 `L.base`
   *   刚刚被新读进来的候选覆盖过,于是「拿候选与自己比」,结果恒为「全部同值」:
   *   界面写着「什么都没变」,而用户手上明明是一份改过的资料(不报错,只是错读数)。
   *   修后基线固定取 `appliedBase`(落笔成功时留下的那一份)。
   *
   * 【为什么「只有引用、没有正文」要单独一态】重启后存储里只剩一把引用(本版刻意
   *   不复制全文),此时**比不了** —— 那既不是「没有已应用版本」也不是「全部新增」。
   *   三者处置相反,压平任意两对都会让用户对着一份没比过的资料做决定。
   */
  loreCompareSource(opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    if (!L.parsed) { L.changed = null; return null; }
    const baseline = L.appliedBase;
    if (!baseline) {
      const ref = this.loreAppliedRef();
      L.changed = ref
        ? {
          state: LORE_FACE_STATES.BLOCKED, faceReason: 'baseline-body-absent',
          added: [], removed: [], changed: [], same: [],
          counts: { added: 0, removed: 0, changed: 0, same: 0 },
          oldChecked: false, partialCandidate: L.candidatePartial === true, removedTrusted: false,
          why: ['baseline-ref-only']
        }
        : readLoreChanged(win, null, L.parsed, { partialCandidate: L.candidatePartial === true });
      return L.changed;
    }
    L.changed = readLoreChanged(win, baseline, L.parsed, { partialCandidate: L.candidatePartial === true });
    return L.changed;
  }
  /**
   * [v4.33.0 · R5-O6] **取消候选**：把手上这份新读进来的放掉,回到已应用的那一版。
   *
   * 【为什么必须有这一口】计划验收原文「选B→显示真实差异→**取消仍是A**」——
   *   没有这一口,用户看完差异只能靠「再读一遍 A」回到原状,而重读 A 需要 A 的正文,
   *   本版又刻意不复制全文 ⇒ 事实上回不去。
   * 【为什么读不出就如实说】已应用版本的正文只在本次会话里(落笔时留下的那一份);
   *   重启后只剩引用,此时**回不去正文**,只能如实报「只有引用」。
   */
  loreDiscardCandidate() {
    const L = this._loreState();
    const ref = this.loreAppliedRef();
    if (!L.appliedBase) {
      return {
        ok: false, reason: ref ? 'baseline-body-absent' : 'no-applied-source',
        note: ref
          ? '已应用的那一版只剩引用(' + String(ref.file || '未命名') + ' · ' + String(ref.key) + '),正文不在手上 ⇒ 回不去(不是「没有已应用版本」)'
          : '还没有应用过任何版本 ⇒ 没有可回的基线'
      };
    }
    L.file = String(L.appliedFile || L.file || '');
    L.source = String(L.appliedSource || '');
    L.base = L.appliedBase;
    L.parsed = L.appliedBase;
    L.windowRead = null;
    this._loreMarkCandidate(L.appliedBase, false);
    L.entities = null; L.preview = null; L.override = null; L.mapping = null;
    L.changed = null; L.plan = null; L.applied = null;
    L.edits = []; L.picks = {}; L.sel = {}; L.selTouched = false;
    return { ok: true, reason: '', note: '已回到已应用的那一版(' + String(L.file || '未命名') + ')' };
  }

  /** 实体映射(**未给清单 ⇒ 未判**,本层不替上游装配「已登记实体名单」)。 */
  loreEntities(opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    if (!L.parsed) { L.entities = null; return null; }
    L.entities = readLoreEntities(win, L.parsed, opts || {});
    return L.entities;
  }

  /**
   * 逐条 diff(**零写**;冲突默认不替用户决定)。
   *
   * 【target 由调用方给,本层不自己装配已确认事实】上游 `diffPreview` 吃 `target.facts`
   *   (账上已有的事实)与 `opts.knownRefs`(来源账)。这两样都是**上游持有的证据**,
   *   本层再装配一份就是第二份证据库。没给 ⇒ 上游如实给 `confirmedChecked:false` /
   *   `knownRefsChecked:false`,本层如实读出「已确认面未判」—— 那**不是**「无冲突」。
   */
  lorePreview(target, opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    if (!L.parsed) { L.preview = null; return null; }
    const o = Object.assign({}, opts || {});
    /* 同名待认的段必须原样带进 diff —— 不带就等于把「未裁决」当「没这回事」。 */
    if (!o.mappingNeedsConfirm && L.mapping && Array.isArray(L.mapping.mappingNeedsConfirm)) {
      o.mappingNeedsConfirm = L.mapping.mappingNeedsConfirm.slice();
    }
    L.preview = readLorePreview(win, L.parsed, target || null, o);
    L.plan = null; L.applied = null;
    return L.preview;
  }

  /**
   * 逐段改类(**零写**)。非法类名由上游拒收并具名,本层**不静默落回**原判也不假装改过:
   *   那一行仍按规则原判显示,拒收理由原样带出。
   */
  loreSetClass(itemKey, cls) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    const key = String(itemKey == null ? '' : itemKey).trim();
    const want = String(cls == null ? '' : cls).trim();
    if (!key || !want) return { ok: false, reason: 'no-input', note: '改类要先说清「哪一段」与「改成哪一类」' };
    if (!L.base) return { ok: false, reason: 'no-parsed-source', note: '还没有读进任何资料' };
    L.edits = Array.isArray(L.edits) ? L.edits.filter(function (x) { return x.key !== key; }) : [];
    L.edits.push({ key: key, decision: 'override', cls: want });
    L.override = readLoreOverride(win, L.base, L.edits, {});
    const items = (L.override && Array.isArray(L.override.items) && L.override.items.length) ? L.override.items : L.base.items;
    L.parsed = Object.assign({}, L.base, { items: items });
    L.preview = null; L.plan = null; L.applied = null;
    return L.override;
  }

  /** 同名映射确认(**只读**;未裁决的段一律留在待认里,不静默合并)。 */
  loreConfirmPick(itemKey, owner) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    if (!L.parsed) return null;
    const key = String(itemKey == null ? '' : itemKey).trim();
    const who = String(owner == null ? '' : owner).trim();
    if (!key) return { ok: false, reason: 'no-item', note: '要先说清是哪一段' };
    L.picks = (L.picks && typeof L.picks === 'object') ? L.picks : {};
    if (!who) delete L.picks[key]; else L.picks[key] = who;
    L.mapping = readLoreConfirmMapping(win, L.parsed, L.picks, {});
    L.preview = null; L.plan = null; L.applied = null;
    return L.mapping;
  }

  /** 逐段选入开关(**只记选择**;未选段由上游具名 `not-selected`,一个字节不落)。 */
  /** 默认选入的段键(没点过时:账里没有的段默认选入;其余一律不选)。 */
  _loreDefaultKeys() {
    const L = this._loreState();
    const pv = L.preview;
    if (!pv || !Array.isArray(pv.entries)) return [];
    return pv.entries.filter(function (e) { return admitOf(e.action, e.why) === LORE_ADMIT.ADD; })
      .map(function (e) { return String(e.key || ''); }).filter(Boolean);
  }

  /**
   * 逐段选入开关(**只记选择**;未选段由上游具名 `not-selected`,一个字节不落)。
   *
   * 【首点必须播种默认选择】首版直接置 `selTouched=true` 并把这一格写进**空的** sel ——
   *   于是用户取消任意一行时,其余「没点过」的段被静默当成未选:界面上所有复选框
   *   一起空掉,而用户只动了其中一行。动作结果与界面对不上,且不报错。
   *   (同族错读数:读数看着像「用户取消了全部」而其实是本层把默认选择丢了。)
   */
  loreTogglePick(itemKey, on) {
    const L = this._loreState();
    const key = String(itemKey == null ? '' : itemKey).trim();
    if (!key) return false;
    if (!L.selTouched) {
      L.sel = {};
      for (const k of this._loreDefaultKeys()) L.sel[k] = true;
      L.selTouched = true;
    }
    L.sel = (L.sel && typeof L.sel === 'object') ? L.sel : {};
    const want = (on === undefined) ? !(L.sel[key] === true) : (on === true);
    L.sel[key] = want;
    L.plan = null; L.applied = null;
    return want;
  }

  /** 本层当前选中的段键(没点过就按「可入的段默认选入」—— 其余一律不选)。 */
  loreSelectedKeys() {
    const L = this._loreState();
    if (L.selTouched) return Object.keys(L.sel).filter(function (k) { return L.sel[k] === true; });
    return this._loreDefaultKeys();
  }

  /**
   * 落笔/出计划前的**面门**:缺件优先于流程状态。
   *
   * 【为什么必须优先】插件不在场时用户点「确认导入」,读数若落成「没预览」,
   *   他收到的处置是去过一遍预览 —— 而真实处置是去装插件。两者相反,
   *   且「没预览」听起来像自己少做了一步。与 readLoreParse/readLorePlan 同序:
   *   缺件判定**先于**调用前置条件。
   */
  _loreGate() {
    const face = this.loreFace();
    if (face.source === 'no-plugin') return { ok: false, state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent', reason: 'plugin-absent' };
    if (face.source === 'no-face') return { ok: false, state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent', reason: 'face-absent' };
    if (face.source === 'unreadable') return { ok: false, state: LORE_FACE_STATES.UNUSABLE, faceReason: String((face.describe && face.describe.faceReason) || 'unavailable'), reason: 'face-unreadable' };
    return null;
  }

  /** 出导入计划(**只算不写**;`writesNothing` 恒真是真读数)。 */
  loreMakePlan(target, opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    const g = this._loreGate();
    if (g) return g;
    if (!L.parsed) return { ok: false, state: LORE_FACE_STATES.BLOCKED, faceReason: 'no-parsed-source', reason: 'no-parsed-source' };
    if (!L.preview) this.lorePreview(target, opts);
    const sel = this.loreSelectedKeys();
    const o = Object.assign({}, opts || {});
    if (sel.length) o.selected = sel;
    L.plan = readLorePlan(win, L.parsed, L.preview, o);
    L.applied = null;
    return L.plan;
  }

  /**
   * 确认导入(**真写入**;上游 `loreImportApply` 走 PrequelSystem owner 四步)。
   *
   * 【本层不替上游确认】没预览就不去调上游 —— 契约件已经如实报 `no-preview`。
   *   同理,人工校订与选入原样交给上游(它自己会先叠校订再出计划),本层不再算一遍。
   *
   * 【[v4.33.0 · R5-O6] 只有落笔成功才更新基线】修前「已应用版本」就是 `base`/`parsed`
   *   本身 —— 于是选新文件的那一刻基线就没了。修后基线住 `appliedBase`/`appliedRef`,
   *   而**唯一更新点在这里**,且以「这一份真的落上去了」为条件:
   *     · `ok:true` ⇒ 基线换成**刚刚落的那一份**(候选就转正了,变更读数随之复位);
   *     · 没落成(被拒 / 抛错 / 插件不在场)⇒ 基线**一字不动**(否则读数会假装落过了)。
   *   `duplicate` 也算落过(上游口径),故同样转正 —— 两处只在读数那一格分开。
   */
  async loreApplyNow(opts) {
    const win = (typeof window !== 'undefined') ? window : null;
    const L = this._loreState();
    const g = this._loreGate();
    if (g) return g;
    if (!L.parsed) return { ok: false, state: LORE_FACE_STATES.BLOCKED, faceReason: 'no-parsed-source', reason: 'no-parsed-source' };
    if (!L.preview) return { ok: false, state: LORE_FACE_STATES.BLOCKED, faceReason: 'no-preview', reason: 'no-preview' };
    const sel = this.loreSelectedKeys();
    const o = Object.assign({}, opts || {});
    if (L.edits && L.edits.length) o.overrides = L.edits.slice();
    if (sel.length) o.selected = sel;
    L.applied = await readLoreApply(win, L.parsed, L.preview, o);
    L.ledger = readLoreLedger(win);
    if (L.applied && L.applied.ok === true) {
      /* 候选转正：基线 = 刚刚落的那一份；引用同步落到存储（重开仍答得出「采用哪一版」）。 */
      L.appliedBase = L.parsed;
      L.appliedFile = String(L.file || '');
      L.appliedSource = String(L.source || '');
      const ref = loreVersionRef(L.appliedFile, L.appliedBase);
      L.appliedRef = ref;
      this._loreSaveAppliedRef(ref);
      /* 基线换了 ⇒ 旧对账读数当场作废(它比的是上一版基线,留着就是错读数)。 */
      L.changed = null;
    }
    return L.applied;
  }

  /** 导入账读数(**重开可查**的落点;只读)。 */
  loreLedger() {
    const win = (typeof window !== 'undefined') ? window : null;
    return readLoreLedger(win);
  }

  /** 契约件自检的**真消费点**(视图/诊断可随时读一次)。 */
  loreImportSelfCheck() {
    try { return loreSelfCheck(); }
    catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], states: 0, outlets: 0, stages: 0 }; }
  }

  /**
   * 视图那一屏的**投影**(视图只吃这份,不摸 window、不重判任何一态)。
   *
   * 【行是**翻译**不是重算】每行的判定来自预览 entries 经 `admitOf` 译出的五态词,
   *   计数与类目仍以上游读数为准;本层不另算一份。
   * 【截断只影响显示】行数按 `LORE_LIMITS.rows` 截;截多少如实写在读数里。
   */
  loreWizard() {
    const L = this._loreState();
    const f = this.loreFace();
    const stages = [];
    const stageReads = {};
    if (L.parsed) stageReads.parse = L.parsed;
    if (L.entities) stageReads.entities = L.entities;
    if (L.preview) stageReads.preview = L.preview;
    if (L.plan) stageReads.plan = L.plan;
    if (L.applied) stageReads.apply = L.applied;
    if (L.ledger) stageReads.ledger = L.ledger;
    for (const line of loreJourneyLines(stageReads)) stages.push(line);
    const pv = L.preview;
    const byKey = {};
    if (pv && Array.isArray(pv.entries)) for (const e of pv.entries) byKey[String(e.key || '')] = e;
    const all = (L.parsed && Array.isArray(L.parsed.items)) ? L.parsed.items : [];
    const picked = this.loreSelectedKeys();
    const pickedSet = {};
    for (const k of picked) pickedSet[k] = true;
    const rows = all.slice(0, LORE_LIMITS.rows).map(function (it) {
      const key = String(it.key || '');
      const e = byKey[key] || null;
      const verdict = e ? admitOf(e.action, e.why) : '';
      return {
        key: key, title: String(it.title || ''), snippet: String(it.text || ''),
        cls: String(it.cls || ''), clsLabel: String(it.clsLabel || ''), clsRule: String(it.clsRule || ''),
        manual: it.manual === true, sensitive: it.sensitive === true,
        verdict: verdict, verdictLine: admitLineOf(verdict),
        why: e ? String(e.why || '') : '',
        picked: pickedSet[key] === true
      };
    });
    const needs = [];
    const ent = L.entities;
    /* ★ 已经认下的条目必须**当场地**从待认里出去。
     *   清单读的是实体面(候选),而「认了谁」落在映射面 —— 两份分开算,
     *   用户点完「认作 甲·A宇宙」后清单原样还在,于是他再认一遍、再认一遍;
     *   更糟的是读数写着「待认 1 段」而底下那一条其实早裁完了(不报错,只是错读数)。
     *   已认下的键由映射面给出,这里只做**剔除**,不重算谁要认。 */
    const doneKeys = (function () {
      const m0 = L.mapping;
      const out = {};
      for (const x of (m0 && Array.isArray(m0.resolved) ? m0.resolved : [])) {
        out[String((x && x.itemKey) || '')] = true;
      }
      return out;
    })();
    if (ent && Array.isArray(ent.entries)) {
      for (const e of ent.entries) {
        if (String(e.verdict) !== 'needs-confirm') continue;
        if (doneKeys[String(e.itemKey || '')] === true) continue;
        needs.push({
          itemKey: String(e.itemKey || ''), why: String(e.why || ''),
          /* ★ 候选要摆**主人**（甲·A宇宙 / 甲·B宇宙），不是被命中的**名字**（甲）。
           *   上游 mapping 收的是 owner：拿名字去认，认完仍是「甲」——等于没裁决，
           *   而界面看着像认过了。这正是「同名未认不合并」要防的那一步。
           *   同一个主人可能出现在多条命中里，去重后保序。 */
          names: (function () {
            const out = [];
            for (const h of (Array.isArray(e.hits) ? e.hits : [])) {
              for (const o of (Array.isArray(h && h.owners) ? h.owners : [])) {
                const v = String(o == null ? '' : o).trim();
                if (v && out.indexOf(v) < 0) out.push(v);
              }
            }
            return out;
          })(),
          hitName: (Array.isArray(e.hits) && e.hits[0]) ? String(e.hits[0].name || '') : ''
        });
      }
    }
    const m = L.mapping;
    return {
      face: f, line: this.loreLine(), outlet: f.outlet, classes: f.classes,
      stages: stages,
      rows: rows, rowCap: LORE_LIMITS.rows, rowTotal: all.length,
      truncatedRows: Math.max(0, all.length - rows.length),
      needs: needs,
      resolved: (m && Array.isArray(m.resolved)) ? m.resolved.map(function (x) { return { itemKey: String(x.itemKey || ''), owner: String(x.owner || '') }; }) : [],
      /* ★ 待认数**与上面那份待认清单同源**:清单里有几条,这一格就是几。
       *   首版取的是 `unresolved`(一段都没命中的段数)—— 那不是待认数。后果:
       *   资料里段段都提到角色时,这一格恒为 0,界面写着「待认 0 段」而下面明明摆着
       *   待认条目;用户以为没有要认的东西,直接往里落 —— 「未认下不许合并」这条
       *   口径就断在这一格读数上。数与清单分开算,迟早会分叉(本仓治过多轮)。 */
      pendingCount: needs.length,
      preview: pv,
      plan: L.plan, applied: L.applied, ledger: L.ledger,
      changed: L.changed, window: L.windowRead,
      /* ★ [v4.33.0 · R5-O6] 三份版本各自可辨认（视图只吃这份投影，不自己拼）：
       *   `applied` 已应用（落笔成功那一版）· `candidate` 正在读的候选 · `window` 这次读到的窗口。
       *   引用只有一把键、没有正文，故**不复制全文**；读数行由契约件唯一实现产出。
       *   修前这三者恒指同一份 ⇒ 界面永远说「什么都没变」。 */
      versions: this.loreVersions(),
      changedLine: loreChangedLine(L.changed, { applied: L.appliedRef, candidate: L.candidateRef }),
      cursor: Number(L.cursor || 0), sourceChars: String(L.source || '').length,
      pickedCount: picked.length,
      note: String(L.note || '')
    };
  }
  /**
   * [v4.33.0 · R5-O6] 三份版本的**一句读数**（视图与判据都读这一处，不各拼一份）。
   *
   * 【为什么「没有」与「读不出」要分开】「还没有应用过」⇒ 去读一份并应用；
   *   「应用过但正文不在手上（只剩引用）」⇒ 正文归上游/附件 owner，本层**不猜一份**。
   *   两句话压平，用户会去重读一份其实还在的资料。
   */
  loreVersions() {
    const L = this._loreState();
    const ref = this.loreAppliedRef();
    const hasBody = !!L.appliedBase;
    return {
      applied: {
        has: hasBody || !!ref,
        bodyInHand: hasBody,
        file: String((hasBody ? L.appliedFile : (ref && ref.file)) || ''),
        key: String((L.appliedRef && L.appliedRef.key) || (ref && ref.key) || ''),
        chars: Number(((L.appliedRef && L.appliedRef.chars) || (ref && ref.chars)) || 0),
        sections: Number(((L.appliedRef && L.appliedRef.sections) || (ref && ref.sections)) || 0),
        note: (hasBody || ref)
          ? (hasBody ? '已应用版本在手上' : '已应用版本只剩引用(正文不在手上 ⇒ 比不了,也回不去)')
          : '还没有应用过任何版本'
      },
      candidate: {
        has: !!L.parsed,
        partial: L.candidatePartial === true,
        file: String(L.file || ''),
        key: String((L.candidateRef && L.candidateRef.key) || ''),
        chars: Number((L.candidateRef && L.candidateRef.chars) || 0),
        sections: Number((L.candidateRef && L.candidateRef.sections) || 0),
        note: L.parsed
          ? (L.candidatePartial === true
            ? '候选只覆盖一段/被上游截短 ⇒ 窗口外的段不得据此判「已删除」'
            : '候选覆盖整篇')
          : '还没有读进任何一份'
      },
      window: L.windowRead
        ? { has: true, from: Number(L.windowRead.from || 0), to: Number(L.windowRead.to || 0) }
        : { has: false, from: 0, to: 0 }
    };
  }

  /** 旅程现场复位(视图「重来一份」按钮;不动上游任何账)。 */
  loreReset() { this._lore = this._blankLore(); return this._lore; }

  /** 导入旅程的一句回话(瞬时,不参与持久化)。 */
  loreNote(text) { const L = this._loreState(); L.note = String(text == null ? '' : text); return L.note; }

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

  /* ========== [v4.14.0 · R4-O2] 异步问往事(可取消 / 只展示最新一次 / 有进度) ========== */
  /**
   * 问一句往事(**异步版**)。与同步版 `askPast` 同一份上游口径,只换执行时机。
   *
   * 【派发相一处判】有异步口走异步;没有就**回落同步**并如实告知(旧插件路径)。
   *   判据在 `config/ask-request.js::planAskPhase`一处 —— 不在本层再写一份「插件有没有这个出口」的判断。
   *
   * 【旧回信不许覆盖新问题】每问一次 `advanceAsk` 推进代际;回信落地前先过 `isStale`。
   *   —— 注意:这是**两层保护**:上游在片间调 `shouldCancel()` 就会停掉旧那一轮(省掉白扫),
   *   而即使它已经跑完了,回信也会在这里被丢弃 —— 两道都在,因为取消检查有可能迟一片生效。
   *
   * 【本方法不碰 DOM】进度与结果都通过 `hooks` 回给视图:

   *   `onProgress(p)` / `onDone(receipt, runState)`。视图只排版。
   *
   * @param {string} question 问句
   * @param {{chatId?:string, onProgress?:Function, onDone?:Function}} [hooks]
   * @returns {Promise<{phase:string, gen:number, taskId:string, runState:string, receipt:object|null}>}
   */
  async askPastAsync(question, hooks) {
    const h = (hooks && typeof hooks === 'object') ? hooks : {};
    const chatId = (typeof h.chatId === 'string') ? h.chatId : '';
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = (() => { try { return win ? win.LonShaMemory : null; } catch (_e) { return null; } })();
    const hasAsync = !!(plugin && typeof plugin.askMemoryQuestionAsync === 'function');
    const hasSync = !!(plugin && typeof plugin.askMemoryQuestion === 'function');
    const phase = planAskPhase(hasAsync, hasSync);
    /* 插件不在场 / 没有任何问答出口 ⇒ 不进跟踪器(没有“本次问”这回事)。 */
    if (phase === ASK_PHASES.ABSENT) {
      const recv = readMemoryQaAnswer(win, question, {});
      return { phase, gen: 0, taskId: '', runState: ASK_RUN_STATES.SYNC_FALLBACK, receipt: recv };
    }
    if (!this._askTracker) this._askTracker = newAskTracker();
    const gen = advanceAsk(this._askTracker);
    const taskId = makeAskTaskId(gen, chatId);
    if (phase === ASK_PHASES.SYNC) {
      /* 旧插件路径:能用,但**会占住主线程** —— 回报的运行态与「后台跑」不同形。 */
      const recv = readMemoryQaAnswer(win, question, {});
      const stale = isStale(this._askTracker, gen);
      const runState = stale ? ASK_RUN_STATES.STALE_DROPPED : ASK_RUN_STATES.SYNC_FALLBACK;
      if (typeof h.onDone === 'function') {
        try { h.onDone(stale ? null : recv, runState); } catch (_e) { /* 回调抛错不阻断取数 */ }
      }
      return { phase, gen, taskId, runState, receipt: stale ? null : recv };
    }
    const onProgress = (typeof h.onProgress === 'function') ? h.onProgress : null;
    const recv = await readMemoryQaAnswerAsync(win, question, {
      taskId,
      shouldCancel: shouldCancelFn(this._askTracker, gen),
      onProgress: onProgress ? function (p) {
        /* 进度回调必须先过代际:旧那一轮的进度**不许**刷新新问题的进度条。 */
        if (isStale(this._askTracker, gen)) return;
        try { onProgress(p); } catch (_e) { /* 进度面抛错不阻断查询 */ }
      }.bind(this) : null
    });
    const stale = isStale(this._askTracker, gen);
    const canceled = isCanceled(this._askTracker) && (recv && recv.faceReason === 'canceled');
    const runState = stale ? ASK_RUN_STATES.STALE_DROPPED
      : (canceled ? ASK_RUN_STATES.CANCELED : ASK_RUN_STATES.DONE);
    if (typeof h.onDone === 'function') {
      try { h.onDone(stale ? null : recv, runState); } catch (_e) { /* 回调抛错不阻断取数 */ }
    }
    return { phase, gen, taskId, runState, receipt: stale ? null : recv };
  }

  /** 用户按了取消(下一个片间让出点生效)。没在问时如实返回 false。 */
  cancelAskNow() {
    if (!this._askTracker) return { ok: false, gen: 0 };
    return cancelAsk(this._askTracker);
  }

  /** 当前这一次是否已被取消(供视图判按钮态)。 */
  isAskingCanceled() {
    return this._askTracker ? isCanceled(this._askTracker) : false;
  }

  /** 记忆工具面自述（缺哪一格、为什么缺）——只转发上游 `memoryToolsDescribe()`。 */
  memoryToolsFace() {
    try { return readMemoryToolsDescribe(typeof window !== 'undefined' ? window : null); }
    catch (_e) { return readMemoryToolsDescribe(null); }
  }

  /* ========== [v4.13.0 · R4-O1] 出处定位取数(消费 config/source-locator.js) ========== */
  /**
   * 把一条答案的出处送去定位。**只转交** —— 不自己判靶心形态、不自己碰宿主 DOM:
   *   归一是 `config/source-locator.js` 的纯函数,宿主定位口由咽喉挂 `locateChatFloor`。
   *
   * 【为什么经过这一层而不是视图直接调宿主】本 App 的既有纪律是「视图只吃投影后的
   *   数据、不摸 window」(`memory-view.js` 档头第 1 条);出处定位属取数事,与渲染无关。
   *
   * 【两类靶心处置相反】chat 靶心走宿主 `locateChatFloor`(本方法真调);memory 靶心
   *   走跨 App 事件(`phone:openApp` + 已登记的 `memory→summdesk` 归属)——**由视图派**,
   *   本方法只回报「该走哪条通道」,不假装已经投过(投递结果由宿主侧 applyOpenRef 回报)。
   *
   * @param {{ref?:*, floor?:*, ledger?:*}} raw 上游答案项(或视图 data-src 解出的对象)
   * @returns {{ok:boolean, method:string, reason:string, target:object}}
   */
  locateSource(raw) {
    const target = normalizeSource(raw || {});
    const host = (typeof window !== 'undefined') ? window : null;
    const res = locateTarget(target, host);
    return Object.assign({}, res, { target });
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