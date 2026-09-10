/**
 * 成就簿 (Achievement App) - 核心控制器
 * 包含成就达成弹窗横幅与音效/动画反馈
 */

import { AchievementData } from './achievement-data.js';
import { AchievementView } from './achievement-view.js';

export class AchievementApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new AchievementData(storage);
    this.view = new AchievementView(this);

    this._initGlobalEventListener();
  }

  _initGlobalEventListener() {
    // 暴露全局解锁事件，允许任何模块/手机应用触发成就
    window.addEventListener('ruby:unlockAchievement', (e) => {
      const achId = e.detail?.id;
      if (achId) {
        this.tryUnlock(achId);
      }
    });
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

  render() {
    const screen = this.phoneShell.screen;
    this.view.render(screen);
  }
}
