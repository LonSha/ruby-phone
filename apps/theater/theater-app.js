import { TheaterData } from './theater-data.js';
import { TheaterView } from './theater-view.js';

export class TheaterApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new TheaterData(storage);
    this.view = new TheaterView(this);
  }

  /** [v2.24.0] 换会话/清数据时重绑数据层：TheaterData 构造期把当前会话剧本/草稿载入
   *  实例内存，实例为懒加载单例（index.js `if (!window.VirtualPhone.theaterApp)`），
   *  换会话后复用会把旧会话剧本渲染/写回新会话。保留实例，仅重建数据层。 */
  onChatChanged() {
    this.data = new TheaterData(this.storage);
  }

  render() {
    this.view.render(this.phoneShell.screen);
  }
}

export default TheaterApp;