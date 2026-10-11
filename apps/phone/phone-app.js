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
// 通话APP控制器（单例模式）
// ========================================
import { PhoneCallData } from './phone-data.js';
import { PhoneCallView } from './phone-view.js';
import { onceFlag, globalRuntime } from '../../config/runtime-lifecycle.js';

export class PhoneApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        const cachedPhoneCallData = window.VirtualPhone?.cachedPhoneCallData;
        this.phoneCallData = cachedPhoneCallData?.storage === storage
            ? cachedPhoneCallData
            : new PhoneCallData(storage);
        if (window.VirtualPhone) {
            window.VirtualPhone.cachedPhoneCallData = this.phoneCallData;
        }
        this.phoneCallView = new PhoneCallView(this);

        // [v2.85] 来电与滑动返回入登记层。只绑一次，取活实例。
        if (onceFlag('phoneIncomingCall')) {
            globalRuntime.addListener(window, 'phone:incomingCall', (e) => {
                const { callerName } = e.detail || {};
                const app = window.VirtualPhone?.phoneApp;
                if (callerName && app) app.phoneCallView.renderIncomingCall(callerName);
            }, false, 'phoneIncomingCall');
        }
        if (onceFlag('phoneSwipeBack')) {
            globalRuntime.addListener(window, 'phone:swipeBack', (e) => {
                window.VirtualPhone?.phoneApp?.handleSwipeBack(e);
            }, false, 'phoneSwipeBack');
        }
    }

    render() {
        this.phoneCallView.render();
    }

    handleSwipeBack(e) {
        // 1. 400ms 防抖
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        // 2. 领地保护：确认当前视图属于通话APP
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView || (!domCurrentView.querySelector('.phone-call-main') &&
            !domCurrentView.querySelector('.phone-sms-main') &&
            !domCurrentView.querySelector('.phone-sms-thread') &&
            !domCurrentView.querySelector('.phone-call-contacts') &&
            !domCurrentView.querySelector('.phone-call-transcript') &&
            !domCurrentView.querySelector('.phone-call-settings') &&
            !domCurrentView.querySelector('.phone-call-dialing') &&
            !domCurrentView.querySelector('.phone-call-incoming') &&
            !domCurrentView.querySelector('.phone-call-active'))) return;

        // 3. 根据当前视图处理返回
        const view = this.phoneCallView.currentView;
        if (view === 'transcript') {
            const btn = domCurrentView.querySelector('#phone-call-transcript-back');
            if (btn) btn.click();
        } else if (view === 'contacts') {
            const btn = domCurrentView.querySelector('#phone-call-contacts-back');
            if (btn) btn.click();
        } else if (view === 'settings') {
            const btn = domCurrentView.querySelector('#phone-call-settings-back');
            if (btn) btn.click();
        } else if (view === 'sms-thread') {
            const btn = domCurrentView.querySelector('#phone-sms-thread-back');
            if (btn) btn.click();
        } else if (view === 'sms') {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        } else if (view === 'main') {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        } else if (view === 'dialing') {
            const btn = domCurrentView.querySelector('#phone-call-dial-cancel');
            if (btn) btn.click();
        } else if (view === 'incoming') {
            // 来电时右滑等同于拒绝
            const btn = domCurrentView.querySelector('#phone-call-reject');
            if (btn) btn.click();
        } else if (view === 'active') {
            // 通话中右滑等同于挂断
            const btn = domCurrentView.querySelector('#phone-call-hangup');
            if (btn) btn.click();
        }

        // 4. Ghost Click Buster：400ms 内禁止点击
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    clearCache() {
        this.phoneCallView.clearSmsRuntime?.();
        this.phoneCallData.clearCache();
        this.phoneCallView.currentView = 'main';
        this.phoneCallView.currentCaller = '';
        // 清理通话状态
        if (this.phoneCallView.callTimer) {
            clearInterval(this.phoneCallView.callTimer);
            this.phoneCallView.callTimer = null;
        }
        if (this.phoneCallView.dialingTimer) {
            clearTimeout(this.phoneCallView.dialingTimer);
            this.phoneCallView.dialingTimer = null;
        }
        this.phoneCallView.clearTtsCache?.();
        this.phoneCallView.clearPersistedTtsCache?.();
        this.phoneCallView.chatMessages = [];
    }

    deactivate() {
        if (this.phoneCallView.currentView === 'active' || this.phoneCallView.currentView === 'incoming') return;
        this.phoneCallView.releaseInactiveResources?.();
    }
}
