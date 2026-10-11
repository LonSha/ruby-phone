/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
// ========================================
// 📔 日记APP - 核心控制器
// ========================================

import { DiaryData } from './diary-data.js';
import { DiaryView } from './diary-view.js';
import { onceFlag, globalRuntime } from '../../config/runtime-lifecycle.js';

export class DiaryApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.diaryData = new DiaryData(storage);
        this.diaryView = new DiaryView(this);

        // [v2.85] 滑动返回入登记层：只绑一次，handler 取活实例。
        if (onceFlag('diarySwipeBack')) {
            globalRuntime.addListener(window, 'phone:swipeBack', (e) => {
                window.VirtualPhone?.diaryApp?.handleSwipeBack(e);
            }, false, 'diary:swipe-back');
        }
    }

    render() {
        this.diaryView.render();
    }

    handleSwipeBack(e) {
        // 1. 400ms 防抖
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        // 2. 领地保护 (变量重命名为 domCurrentView 防止冲突)
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView || !domCurrentView.querySelector('.diary-app')) return;

        // 3. 标记为返回导航，避免进场动画
        this.diaryView.isBackNav = true;

        // 4. 模拟点击对应的返回按钮
        let handled = false;
        const diaryState = this.diaryView.currentView;

        if (diaryState === 'page') {
            const btn = domCurrentView.querySelector('#diary-page-back');
            if (btn) { btn.click(); handled = true; }
        } else if (diaryState === 'settings') {
            const btn = domCurrentView.querySelector('#diary-settings-back');
            if (btn) { btn.click(); handled = true; }
        } else if (diaryState === 'edit') {
            const btn = domCurrentView.querySelector('#diary-edit-cancel');
            if (btn) { btn.click(); handled = true; }
        } else if (diaryState === 'toc') {
            this.diaryView.currentView = 'cover';
            this.diaryView.render();
            handled = true;
        }

        if (!handled && diaryState === 'cover') {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        // 5. Ghost Click Buster：400ms 内禁止点击
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }
    
    // 清空缓存（切换聊天时调用）
    clearCache() {
        this.diaryData.clearCache();
        this.diaryView.currentView = 'cover';
        this.diaryView.currentEntryId = null;
    }
}
