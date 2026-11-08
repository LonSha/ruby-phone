/**
 * 健康与生理 App - 应用核心控制器
 * 妊娠/产程算法来自 Liuuuu54/st_bs_biotracker，本地推演，不绑 LLM
 */
import { HealthData } from './health-data.js';
import { HealthView } from './health-view.js';
// [v2.70.0] 生理状态交接适配层：正文里的 <state_handoff> 事实回写本地状态机
import { processReply, HandoffLedger } from './health-state-bridge.js';

export class HealthApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new HealthData(storage);
    this.view = new HealthView(this);
    this._hooked = false;
    this._handoffHooked = false;
    this._initHooks();
  }

  _initHooks() {
    if (this._hooked) return;
    try {
      const context = window.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource;
      const event_types = context?.event_types;
      if (eventSource && event_types?.GENERATE_BEFORE_COMBINE_PROMPTS) {
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
          try {
            if (!this.data.autoInject || !payload || !Array.isArray(payload.prompt)) return;
            const directive = this.data.buildPromptDirective();
            if (directive) payload.prompt.push({ role: 'system', content: directive });
          } catch (e) {}
        });
        this._hooked = true;
      }
      // [v2.70.0] 生成后回写：回复落地后提取交接块，把已发生事实投递给本地状态机。
      //   无交接块时 processReply 返回 null（零成本跳过）；任何异常静默，
      //   绝不阻断消息渲染。只投递确定性事件，不覆盖周期/妊娠等本地状态。
      if (!this._handoffHooked && eventSource && event_types?.MESSAGE_RECEIVED) {
        this._handoffHooked = true;
        eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
          try {
            const ctx = window.SillyTavern?.getContext?.();
            const chat = ctx?.chat;
            const msg = Array.isArray(chat) ? chat[messageId] : null;
            const text = msg && typeof msg.mes === 'string' ? msg.mes : '';
            if (!text || !text.includes('state_handoff')) return;
            const ledger = new HandoffLedger(this.storage);
            // [v4.31.0 · R5-O4] 向下传**宿主可证身份**：同一楼层重放 ⇒ 同一件事（幂等跳过）；
            //   不同楼层即使正文相同 ⇒ 两件事，各计一次。
            //   ★ 身份里**不含** swipe：重生成会换 swipe，算进去会把同一条消息的两次生成
            //     当成两件事各自生效（正是本版要防的双计）。
            //   取不到 id 时如实传空，由 eventKeyOf 回落内容指纹并标 identified:false。
            const eventKey = (messageId == null || messageId === '') ? '' : ('msg:' + messageId);
            const result = processReply(text, this.data, ledger, { eventKey, source: 'chat' });
            if (result && (result.applied.length || result.recorded.length)) {
              this.view?.rerender?.();
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  onChatChanged() {
    // [v2.23.0] 换会话重绑：重建数据层从新会话键重新载入。
    //   保留实例与构造期注册的常驻监听器，避免重建实例导致监听器累积。
    this.data = new HealthData(this.storage);
  }
  /**
   * [v18 · 生产方接线] 手环采样节拍 → 演化管线。
   *   【为什么挂这里】SmartWearableBiometricInteropV2 与进化管线此前全仓零调用方，
   *     引擎写好了却没人喂数据，`biometric_stress_alert` 永远没有生产方。
   *   【取什么作为情绪输入】不编造：用本 App 真实的生理阶段（getPhaseInfo）做映射 ——
   *     产程/产兆/宫缩等高张力阶段 ⇒ panic，其余按 arousalLevel 走 flustered / normal；
   *     每次按小时推进生理时间后采样一次，是"真实推进"而非定时器轮询。
   *   任何异常都不影响健康 App 自身，失败只记在 window.VirtualPhone._evolution36Read。
   */
  sampleWearableIntoEvolution() {
    try {
      const rt = window.VirtualPhone?.evolutionRuntime;
      if (!rt || typeof rt.onBiometricSample !== 'function') return 0;
      const info = this.data?.getPhaseInfo?.() || {};
      const phase = String(info.phase || '');
      const highTension = ['产兆前驱', '第一产程', '第二产程', '第三产程', '产后恢复'].includes(phase);
      const midTension = /敏感|波动|升高|坠胀|宫缩/.test(String(info.arousalLevel || ''));
      const state = highTension ? 'panic' : (midTension ? 'romantic_tension' : 'normal');
      return rt.onBiometricSample(state, false);
    } catch (_e) { return 0; }
  }
  render() {
    // [v2.56.0] 渲染是 App 首次真正被用户打开的时刻，宿主必然已就绪；此处重试一次
    //   _initHooks（内部幂等），覆盖构造期 SillyTavern context 尚未就绪、
    //   导致注入钩子静默未挂载的窗口。
    this._initHooks();
    /* [v18 · 生产方接线] 打开健康 App 是「用户真的在看自己的生理状态」这一刻 ⇒
     *   顺手采一次手环样本交给演化管线。偷懒但真实：不造假定时器，
     *   只在真实发生的行为点采样（和微信发送时上报打字犹豫同一纪律）。 */
    this.sampleWearableIntoEvolution();
    this.view.render(this.phoneShell.layerHost?.('health-main') || this.phoneShell.screen);
  }
}

export default HealthApp;
