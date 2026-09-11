/**
 * 健康与生理 App - 应用核心控制器
 * 妊娠/产程算法来自 Liuuuu54/st_bs_biotracker，本地推演，不绑 LLM
 */
import { HealthData } from './health-data.js';
import { HealthView } from './health-view.js';

export class HealthApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new HealthData(storage);
    this.view = new HealthView(this);
    this._hooked = false;
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
    } catch (e) {}
  }

  render() {
    this.view.render(this.phoneShell.screen);
  }
}

export default HealthApp;
