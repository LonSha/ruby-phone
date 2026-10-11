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
// 魔坊APP控制器（空壳占位）
// ========================================

import { MofoData } from './mofo-data.js';
import { MofoView } from './mofo-view.js';
// [v2.27.0] 登记制 + 事件契约（手写 window._xxxBound guard 与字面量事件名收敛到单一真源）
import { globalRuntime, onceFlag } from '../../config/runtime-lifecycle.js';
import { PHONE_EVENTS } from '../../config/phone-events.js';


export class MofoApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.mofoData = new MofoData(storage);
        this.mofoView = new MofoView(this);

        // 防止实例重建后重复绑定
        // [v2.27.0] 同上：onceFlag + 登记层（window 监听器可回收）
        if (onceFlag('mofoSwipeBack')) {
            globalRuntime.addListener(window, PHONE_EVENTS.SWIPE_BACK, () => {
                const mofoApp = window.VirtualPhone?.mofoApp;
                if (mofoApp && typeof mofoApp.handleSwipeBack === 'function') {
                    mofoApp.handleSwipeBack();
                }
            }, false, 'mofo:swipe-back');
        }
    }

    render() {
        this.mofoView.render();
    }

    handleSwipeBack() {
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.mofo-app')) return;

        const backBtn = currentView.querySelector('.mofo-back-btn, .app-back-btn');
        if (backBtn) {
            backBtn.click();
        } else {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    clearCache() {
        this.mofoData.clearCache();
        this.mofoView.currentPage = 'main';
        this.mofoView.selectionMode = false;
        this.mofoView.selectedIds?.clear?.();
    }
}
