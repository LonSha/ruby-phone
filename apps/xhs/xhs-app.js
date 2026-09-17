/**
 * 小红书 (XHS App) - 应用核心控制器
 */
import { XhsData } from './xhs-data.js';
import { XhsView } from './xhs-view.js';

export class XhsApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new XhsData(storage);
    this.view = new XhsView(this);

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
          const newNote = this.data.parseFromMessage(text);
          if (newNote) {
            console.log('[XhsApp] 📷 成功从 AI 回复捕获小红书笔记:', newNote.title);
            this.view._renderMasonry();
          }
        });
      }
    } catch (e) {}
  }

  onChatChanged() {
    // [v2.23.0] 换会话重绑：重建数据层从新会话键重新载入。
    //   保留实例与构造期注册的常驻监听器，避免重建实例导致监听器累积。
    this.data = new XhsData(this.storage);
  }

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}
