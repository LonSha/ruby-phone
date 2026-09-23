/**
 * 成就簿 (Achievement App) - 核心控制器
 * 包含成就达成弹窗横幅与音效/动画反馈
 */

import { AchievementData } from './achievement-data.js';
import { AchievementView } from './achievement-view.js';
import { onceFlag, globalRuntime } from '../../config/runtime-lifecycle.js';

export class AchievementApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new AchievementData(storage);
    this.view = new AchievementView(this);

    this._initGlobalEventListener();
  }

  _initGlobalEventListener() {
    // [v2.85] 构造期监听器入登记层。onceFlag 保证重建不累积，
    // handler 动态取活实例，不再把旧 this 钉在 window 上。
    if (onceFlag('achievementUnlock')) {
      globalRuntime.addListener(window, 'ruby:unlockAchievement', (e) => {
        const app = window.VirtualPhone?.achievementApp;
        const achId = e.detail?.id;
        if (app && achId) app.tryUnlock(achId);
      }, false, 'achievement:unlock');
    }
  }

  tryUnlock(achId) {
    const ach = this.data.unlock(achId);
    if (ach) {
      this.showUnlockBanner(ach);
      return true;
    }
    return false;
  }

  showUnlockBanner(ach) {
    console.log('[Achievement] 🏆 解锁新成就:', ach.name);
    
    // 构造悬浮成就横幅
    const banner = document.createElement('div');
    banner.className = 'ach-unlock-banner';
    banner.innerHTML = `
      <div class="ach-banner-trophy"><i class="fa-solid fa-trophy"></i></div>
      <div class="ach-banner-text">
        <div class="ach-banner-sub">ACHIEVEMENT UNLOCKED</div>
        <div class="ach-banner-name">${ach.name}</div>
        <div class="ach-banner-intro">${ach.intro}</div>
      </div>
    `;

    const host = this.phoneShell?.element || document.body;
    host.appendChild(banner);

    // 触发入场动画
    requestAnimationFrame(() => {
      banner.classList.add('visible');
    });

    // 4 秒后自动淡出消失
    setTimeout(() => {
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 400);
    }, 4200);
  }

  onChatChanged() {
    // [v2.23.0] 换会话重绑：重建数据层从新会话键重新载入。
    //   保留实例与构造期注册的常驻监听器，避免重建实例导致监听器累积。
    this.data = new AchievementData(this.storage);
  }

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}
