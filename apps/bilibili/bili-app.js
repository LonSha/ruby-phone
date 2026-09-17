import { BiliData } from './bili-data.js';
import { BiliView } from './bili-view.js';

export class BiliApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new BiliData(storage);
    this.view = new BiliView(this);
  }

  /** [v2.24.0] 换会话/清数据时重绑数据层：BiliData 构造期把当前会话条目载入实例内存，
   *  实例为懒加载单例（index.js `if (!window.VirtualPhone.bilibiliApp)`），换会话后复用
   *  会把旧会话条目渲染/写回新会话。保留实例与常驻监听器，仅重建数据层（View 经
   *  this.app.data 动态引用，重建后自动指向新数据层）。 */
  onChatChanged() {
    this.data = new BiliData(this.storage);
  }

  render() {
    this.view.render(this.phoneShell.screen);
  }
}

export default BiliApp;