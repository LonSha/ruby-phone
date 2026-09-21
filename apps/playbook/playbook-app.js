/**
 * 灵感工坊 (Playbook App) - 应用核心控制器
 * 负责生命周期、手势集成、Prompt钩子拦截与消息自清空
 */

import { PlaybookData } from './playbook-data.js';
import { PlaybookView } from './playbook-view.js';

export class PlaybookApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new PlaybookData(storage);
    this.view = new PlaybookView(this);
    this._boundGenerationHook = false;

    this._initHooks();
  }

  _initHooks() {
    if (this._boundGenerationHook) return;
    // [v2.56.0] 幂等 guard 必须在**两条监听都挂载成功之后**才置位：原实现先置位再检查宿主，
    //   一旦构造期 SillyTavern context 尚未就绪，guard 已锁、后续 render() 重试被 return 掉，
    //   注入静默永久失效（与 v2.54 修的钩子接线失效同属一类）。

    // 监听酒馆原生生成前事件：注入灵感指引
    try {
      const context = window.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource;
      const event_types = context?.event_types;
      
      if (eventSource && event_types) {
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
          const injection = this.data.buildInjectionPrompt();
          if (injection && payload && Array.isArray(payload.prompt)) {
            // 以 system 深度注入
            payload.prompt.push({
              role: 'system',
              content: injection
            });
            console.log('[Playbook] 🚀 成功动态注入', this.data.selectedPlays.size, '项玩法至当前提示词！');
          }
        });

        // 监听消息生成完成事件：发后自清
        eventSource.on(event_types.MESSAGE_RECEIVED, () => {
          if (this.data.autoClear && this.data.selectedPlays.size > 0) {
            console.log('[Playbook] 🧹 发后自清触发，重置已选玩法');
            this.data.clearSelected();
            this.view._updateBottomBar();
            this.view._renderPlays();
          }
        });
        // 两条监听都挂上了，才算挂载成功
        this._boundGenerationHook = true;
      }
    } catch (e) {
      console.warn('[PlaybookApp] 挂载 SillyTavern 生成钩子失败:', e);
    }
  }

  onChatChanged() {
    // [v2.23.0] 换会话重绑：重建数据层从新会话键重新载入。
    //   保留实例与构造期注册的常驻监听器，避免重建实例导致监听器累积。
    this.data = new PlaybookData(this.storage);
  }

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }

  executeManualInjection() {
    const count = this.data.selectedPlays.size;
    if (count === 0) {
      window.toastr?.info('请先勾选心仪的玩法或体位', '灵感工坊');
      return;
    }
    const prompt = this.data.buildInjectionPrompt();
    window.toastr?.success(`已就绪 ${count} 项玩法！将在下一次回复时生效`, '灵感工坊');
  }
}
