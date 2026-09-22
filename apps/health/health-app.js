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
            const result = processReply(text, this.data, ledger);
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

  render() {
    // [v2.56.0] 渲染是 App 首次真正被用户打开的时刻，宿主必然已就绪；此处重试一次
    //   _initHooks（内部幂等），覆盖构造期 SillyTavern context 尚未就绪、
    //   导致注入钩子静默未挂载的窗口。
    this._initHooks();
    this.view.render(this.phoneShell.screen);
  }
}

export default HealthApp;
