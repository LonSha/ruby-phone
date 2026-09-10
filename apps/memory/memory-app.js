/**
 * 记忆 App (Memory App) - 应用核心控制器
 * 数据层: MemoryCore (memory-data.js)  视图层: MemoryView (memory-view.js)
 * 挂载酒馆生成前钩子: autoInject 开启时自动携带【记忆】块进入 prompt
 */
import { MemoryView } from './memory-view.js';

export class MemoryApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    // 复用全局记忆核心 (index.js 启动时创建, 后台持续运行)
    this.data = (window.VirtualPhone && window.VirtualPhone.memoryCore) || null;
    this.view = new MemoryView(this);
  }


  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}

export default MemoryApp;