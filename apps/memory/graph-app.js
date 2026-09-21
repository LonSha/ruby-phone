/**
 * 图谱 App (Graph App) - 应用核心控制器
 * 桥接 LonSha 记忆引擎知识图谱, 复用全局 memoryCore.graph (GraphBridge)
 */
import { GraphView } from './graph-view.js';

export class GraphApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    // 复用全局记忆核心里的 GraphBridge
    this.data = this._bindBridge();
    this.view = new GraphView(this);
  }

  /** 现取当前会话的 GraphBridge（不持跨会话副本）；桥不在返回 null */
  _bindBridge() {
    try {
      const core = (typeof window !== 'undefined' && window.VirtualPhone) ? window.VirtualPhone.memoryCore : null;
      return (core && core.graph) ? core.graph : null;
    } catch (_e) { return null; }
  }

  /**
   * [v2.62.0] 换会话 / 清数据重绑：GraphBridge 有 3s 数据缓存（_cache/_cacheAt），
   * 且构造时绑的是旧会话的 memoryCore.graph。此处做两件事——
   *   ① 丢弃旧缓存（invalidate），下一次 getData 会重新探测/读取新会话；
   *   ② 重新指向当前会话的 memoryCore.graph（防单例跨会话持旧引用）。
   * 不缓存任何读数副本，数据始终随会话现取。
   */
  onChatChanged() {
    try { if (this.data && typeof this.data.invalidate === 'function') this.data.invalidate(); } catch (_e) { /* 忽略 */ }
    this.data = this._bindBridge();
  }

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}

export default GraphApp;