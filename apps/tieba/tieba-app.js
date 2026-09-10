/**
 * 百度贴吧 (Tieba App) - 核心控制器
 */
import { TiebaData } from './tieba-data.js';
import { TiebaView } from './tieba-view.js';

export class TiebaApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new TiebaData(storage);
    this.view = new TiebaView(this);

    this._initAiMessageListener();
  }

  _initAiMessageListener() {
    try {
      const context = window.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource;
      const event_types = context?.event_types;
      if (eventSource && event_types) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
          const text = data?.message?.mes || '';
          const newPost = this.data.parseFromMessage(text);
          if (newPost) {
            console.log('[TiebaApp] 💬 成功从 AI 回复捕获贴吧新帖:', newPost.title);
            this.view._renderPosts();
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
