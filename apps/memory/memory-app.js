/**
 * 记忆 App (Memory App) - 应用核心控制器
 * 数据层: MemoryCore (memory-data.js)  视图层: MemoryView (memory-view.js)
 * 自动注入: 由 memoryCore.attachPromptHook() 统一挂载, autoInject 开启后生效
 */
import { MemoryView } from './memory-view.js';

export class MemoryApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    // 复用全局记忆核心 (index.js 空闲初始化, 后台持续运行)
    this.data = (window.VirtualPhone && window.VirtualPhone.memoryCore) || null;
    this.view = new MemoryView(this);
  }

  render() {
    // 首次打开: 引导用户开启自动注入 (功能可见性)
    this._maybeShowOnboarding();
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }

  _maybeShowOnboarding() {
    try {
      const KEY = 'memory_onboarded_v1';
      const done = this.storage?.get?.(KEY);
      if (done) return;
      this.storage?.set?.(KEY, '1');

      const core = this.data;
      const stats = core ? core.getStats() : null;
      const hasData = stats && (stats.longTerm > 0 || stats.shortTerm > 0);

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