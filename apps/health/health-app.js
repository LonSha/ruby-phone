/**
 * 健康与生理 App (Health App) - 应用核心控制器
 */
import { HealthData } from './health-data.js';
import { HealthView } from './health-view.js';

export class HealthApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new HealthData(storage);
    this.view = new HealthView(this);

    this._initHooks();
  }

  _initHooks() {
    // 自动挂载酒馆生成前钩子
    try {
      const context = window.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource;
      const event_types = context?.event_types;
      
      if (eventSource && event_types) {
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
          // 如果有需要，自动在 prompt 中携带生理状态
          if (this.data.autoInject && payload && Array.isArray(payload.prompt)) {
            payload.prompt.push({
              role: 'system',
              content: this.data.buildPromptDirective()
            });
          }
        });
      }
    } catch (e) {}
  }

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}
