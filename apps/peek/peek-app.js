/**
 * 查手机 App — 控制器
 */
import { PeekData } from './peek-data.js';
import { PeekView } from './peek-view.js';

export class PeekApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new PeekData(storage);
    this.view = new PeekView(this);
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
    // [v2.56.0] 渲染是 App 首次真正被用户打开的时刻，宿主必然已就绪；此处重试一次
    //   _initHooks（内部幂等），覆盖构造期 SillyTavern context 尚未就绪、
    //   导致注入钩子静默未挂载的窗口。
    this._initHooks();
    this.view.render(this.phoneShell.layerHost?.('peek-main') || this.phoneShell.screen);
  }
}

export default PeekApp;
