/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
import { HoneyView } from './honey-view.js?v=1.5.5&r=20260902-avatar-gender';
import { HoneyData } from './honey-data.js?v=1.5.5&r=20260902-avatar-gender';
// [v2.27.0] 登记制原语（手写 window._honey*Bound guard 收敛；不改动本文件原有业务结构）
import { globalRuntime, onceFlag } from '../../config/runtime-lifecycle.js';
import { PHONE_EVENTS } from '../../config/phone-events.js';

export class HoneyApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.honeyData = new HoneyData(storage);
        this.honeyView = new HoneyView(this);
        this._lastSwipeTime = 0;

        // 监听滑动返回事件 (防止实例重建导致重复绑定)
        // [v2.27.0] onceFlag + 登记层（原 window._honeySwipeBackBound 手写 guard）
        if (onceFlag('honeySwipeBack')) {
            globalRuntime.addListener(window, PHONE_EVENTS.SWIPE_BACK, () => {
                const honeyApp = window.VirtualPhone?.honeyApp;
                if (honeyApp && typeof honeyApp.handleSwipeBack === 'function') {
                    honeyApp.handleSwipeBack();
                }
            }, false, 'honey:swipe-back');
        }

        if (onceFlag('honeyPanelVisibility')) {
            globalRuntime.addListener(window, PHONE_EVENTS.PANEL_VISIBILITY, (event) => {
                if (event?.detail?.open !== false) return;
                window.VirtualPhone?.honeyApp?.honeyView?._pauseHoneyVideos?.();
            }, false, 'honey:panel-visibility');
        }

        if (onceFlag('honeyDocumentVisibility')) {
            globalRuntime.addListener(document, 'visibilitychange', () => {
                if (!document.hidden) return;
                window.VirtualPhone?.honeyApp?.honeyView?._pauseHoneyVideos?.();
            }, false, 'honey:doc-visibility');
        }
    }

    attachRuntime(phoneShell, storage) {
        if (phoneShell) this.phoneShell = phoneShell;
        if (storage) {
            this.storage = storage;
            if (this.honeyData) this.honeyData.storage = storage;
        }
    }

    async render() {
        if (!this.phoneShell?.setContent) {
            throw new Error('蜜语运行时未绑定手机壳');
        }
        // 移动端首次打开时 CSS fetch 可能被宿主页面或网络状态拖住，不能阻塞进入页面。
        this.honeyView.cssPromise?.catch?.(() => {});
        this.honeyView.render();
    }

    openFollowedHostLive(hostName, options = {}) {
        return this.honeyView?.openFollowedHostLive?.(hostName, options);
    }

    handleSwipeBack() {
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.honey-app')) return;

        // 自动寻址：如果有统一格式的后退按钮，直接触发它即可
        const backBtn = currentView.querySelector('.honey-back-btn');
        if (backBtn) {
            backBtn.click();
        } else {
            this.honeyView?.exitHoneySurface?.();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        // Ghost Click Buster：短时间禁用点击，避免双触发
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    destroy() {
        this.honeyView?.exitHoneySurface?.();
    }

    deactivate() {
        this.honeyView?.releaseInactiveResources?.();
        this.honeyView?.exitHoneySurface?.();
    }
}
