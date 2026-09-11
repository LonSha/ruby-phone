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
    const core = window.VirtualPhone && window.VirtualPhone.memoryCore;
    this.data = core && core.graph ? core.graph : null;
    this.view = new GraphView(this);
  }

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}

export default GraphApp;