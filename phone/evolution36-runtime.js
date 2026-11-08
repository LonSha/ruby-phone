/**
 * evolution36-runtime.js — [v18·36项演化双计划] 生活终端的**生产方**
 * ------------------------------------------------------------
 * 【为什么需要这个文件】
 *   上一轮把 18 个生活终端引擎写成了独立类，并让 lonshaBridge.mountEvolutionPipeline()
 *   订阅了三条事件（daily_life_event / biometric_stress_alert / typing_anxiety_recall）。
 *   但全仓**没有任何一处 emit** —— 订阅了却永远收不到：
 *     ① 引擎产出的生活事件只存在自己的实例里，从不向外广播；
 *     ② 微信/手环/日历等真实业务点也没有把动作交给引擎。
 *   于是「手机生活 → 记忆底座」这条反哺链在架构上是断的（测试用 mock 掩盖了这一点）。
 *
 * 【本文件职责】把「业务动作」→「引擎」→「事件总线」→「记忆反哺」串成一条真链路。
 *   只做接线，不复制任何引擎的业务判断（判断留在各自引擎里，保持单一真源）。
 *
 * 【纪律】
 *   · 无 window 也能跑（node 测试可注入 bus/engines）；
 *   · 任何一环缺席都不抛，只在 read 里如实记下 —— 但**不静默**，可读。
 */

const DEFAULT_SCOPE = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * @param {object} opts
 * @param {object} opts.bus        PhoneEventBusPipeline 实例（必须）
 * @param {object} [opts.engines]  引擎实例集合（缺省从 globalThis 取）
 * @param {object} [opts.scope]    取值作用域（测试可注入）
 * @returns {{ok:boolean, wired:string[], missing:string[], emit:<T>(e:string,p?:object)=>number}}
 */
export function mountEvolutionRuntime(opts = {}) {
  const scope = opts.scope || DEFAULT_SCOPE;
  const bus = opts.bus;
  const read = { at: Date.now(), ok: false, wired: [], missing: [], emitted: 0, lastEvent: null, error: '' };

  if (!bus || typeof bus.emit !== 'function') {
    read.error = 'event-bus-absent';
    return Object.assign(read, { emit: () => 0 });
  }

  /* 引擎取用纪律：显式注入优先，其次从 scope 上的全局名取（这些引擎文件自己会挂 globalThis）。
     注意它们都是 class（不是工厂），只有 UIVirtualListScroller 等少数例外。 */
  const take = (injected, globalName) => {
    if (injected) return injected;
    const v = scope[globalName];
    return v && typeof v === 'function' ? v : null;
  };

  const eng = {
    dailyFabric: null,
    typingAnxiety: null,
    biometric: null,
    socialFeed: null,
    weakSignal: null,
    battery: null,
    ...(opts.engines || {})
  };

  /* 惰性实例化：只在第一次真正用到时才 new，避免启动期为一个未使用的引擎付构造代价。 */
  const ensure = (key, globalName, args) => {
    if (eng[key] && typeof eng[key] !== 'function') return eng[key];
    const Cls = take(null, globalName);
    if (!Cls) { if (!read.missing.includes(key)) read.missing.push(key); return null; }
    try { eng[key] = new Cls(...(args || [])); } catch (e) { read.error = `${key}:${String((e && e.message) || e)}`; return null; }
    return eng[key];
  };

  const emit = (event, payload) => {
    try {
      bus.emit(event, payload, { originApp: 'evolution36-runtime' });
      read.emitted++;
      read.lastEvent = { at: Date.now(), event, summary: String((payload && (payload.summary || payload.partner || payload.heartRate)) || '').slice(0, 60) };
      return 1;
    } catch (e) { read.error = String((e && e.message) || e); return 0; }
  };

  /**
   * 业务入口①：一段聊天文本进来 ⇒ 生活织网引擎识别餐饮/日程/出行 ⇒ 逐条广播。
   * 这是「聊天内容」到「手机侧真的动起来」的第一跳。
   */
  const onChatSnippet = (snippet, meta = {}) => {
    const fabric = eng.dailyFabric && typeof eng.dailyFabric === 'function'
      ? eng.dailyFabric
      : ensure('dailyFabric', 'CrossAppDailyLifeFabric');
    if (!fabric || typeof fabric.synthesizeChatToLifestyle !== 'function') return 0;
    let events = [];
    try { events = fabric.synthesizeChatToLifestyle(String(snippet || ''), meta) || []; }
    catch (e) { read.error = 'dailyFabric:' + String((e && e.message) || e); return 0; }
    let n = 0;
    for (const ev of Array.isArray(events) ? events : []) {
      n += emit('daily_life_event', {
        summary: (ev && (ev.narrativeDetail || ev.eventType)) || '生活事件',
        fromApp: (ev && ev.fromApp) || 'wechat',
        toApp: (ev && ev.toApp) || null,
        eventType: (ev && ev.eventType) || null,
        raw: ev
      });
    }
    return n;
  };

  /**
   * 业务入口②：手环采样 ⇒ 高应激才广播（低应激不打扰记忆层，省噪声）。
   *
   * [v18 · 契约修正] 修前按 `s.stressLevel / s.stress / s.heartRate` 取值，
   *   但 SmartWearableBiometricInteropV2.sampleBiometrics() 真实返回的是
   *   `{ heartRateBpm, stressIndex(0~100), statusTitle, promptDirective }` ——
   *   字段名全对不上 ⇒ 取到 undefined ⇒ `stress > 0.7` 恒假 ⇒ **这条通道永远不 emit**。
   *   而且量纲也不同：桥端阈值是 0~1 归一化，引擎给的是 0~100 百分制。
   *   现在两件事一起做：字段按真实返回取值 + 统一归一化成 0~1 再判阈，
   *   原始百分制以 stressIndex 一并带出（诊断时看得见引擎原话）。
   */
  const onBiometricSample = (emotionalState = 'normal', isExercising = false) => {
    const bio = eng.biometric && typeof eng.biometric !== 'function'
      ? eng.biometric
      : ensure('biometric', 'SmartWearableBiometricInteropV2');
    if (!bio || typeof bio.sampleBiometrics !== 'function') return 0;
    let s = null;
    try { s = bio.sampleBiometrics(emotionalState, isExercising); }
    catch (e) { read.error = 'biometric:' + String((e && e.message) || e); return 0; }
    if (!s) return 0;
    const rawStress = Number(s.stressIndex ?? s.stressLevel ?? s.stress ?? 0);
    const stress01 = rawStress > 1 ? rawStress / 100 : rawStress;   // 兼容两种量纲
    const hr = Number(s.heartRateBpm ?? s.heartRate ?? s.hr ?? 0);
    if (!(stress01 > 0.7)) return 0;                      // 与 lonshaBridge 的阈值同口径（0~1）
    return emit('biometric_stress_alert', {
      heartRate: hr,
      stressLevel: stress01,
      stressIndex: rawStress,
      source: 'wearable'
    });
  };

  /**
   * 业务入口③：微信里发生「打了又删」或「发出后撤回」⇒ 广播悬念。
   */
  const onTypingHesitation = (contactId, draft, sentText, durationSec) => {
    const ta = eng.typingAnxiety && typeof eng.typingAnxiety !== 'function'
      ? eng.typingAnxiety
      : ensure('typingAnxiety', 'TypingHesitationRecallAnxiety');
    if (!ta) return 0;
    let res = null;
    try {
      res = typeof ta.recordTypingHesitation === 'function'
        ? ta.recordTypingHesitation(contactId, draft, sentText, durationSec)
        : null;
    } catch (e) { read.error = 'typingAnxiety:' + String((e && e.message) || e); return 0; }
    if (!res) return 0;
    return emit('typing_anxiety_recall', {
      partner: contactId || '对方',
      hesitationMs: Math.round((Number(durationSec) || 0) * 1000),
      draftPreview: String(snippetOf(draft)).slice(0, 40),
      sentPreview: String(snippetOf(sentText)).slice(0, 40)
    });
  };

  const snippetOf = (v) => (v == null ? '' : String(v));

  read.ok = true;
  read.wired = ['daily_life_event', 'biometric_stress_alert', 'typing_anxiety_recall'];
  read.engines = Object.keys(eng).filter((k) => eng[k] && typeof eng[k] !== 'function');

  return Object.assign(read, {
    emit,
    onChatSnippet,
    onBiometricSample,
    onTypingHesitation,
    /** 供诊断面板/测试读取的只读快照 */
    getRead: () => Object.assign({}, read),
    /** 测试注入：替换引擎实例（不重建总线订阅） */
    __inject: (k, v) => { eng[k] = v; }
  });
}

/* [v18 · 债务清理] 这里原有一个 `createEvolutionRuntimeProvider()` 单例工厂，
 *   但 index.js 是直接 `mountEvolutionRuntime(...)` 并把结果挂到
 *   `window.VirtualPhone.evolutionRuntime` —— provider 全仓零消费方，
 *   被本仓 dead-export / bind-consumption 两道门禁判为「绑定级死导出」。
 *   与其为了绿灯去补一份双实例语义（那才是真 bug：两个单例各订阅一套），
 *   不如删掉：单一真源就是 window.VirtualPhone.evolutionRuntime。 */
export default mountEvolutionRuntime;
