/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// 手机外壳
import { PHONE_CONFIG } from '../config/apps.js';
import { LockScreen } from './lock-screen.js';
import { ManagedRuntime, childRuntime } from '../config/runtime-lifecycle.js';   // [v2.26.0/v2.31.0] 运行时资源登记与统一回收
import { PHONE_EVENTS } from '../config/phone-events.js';          // [v2.26.0] 事件名单一真源
// [v2.99.0] 返回键守卫：缝合自上游「瑟瑟小手机 V1.059」的 __ubBackGuard。
//   本仓此前全库零 popstate —— 物理返回键与浏览器返回完全不响应；
//   右滑手势（SWIPE_BACK）只退视图、不关浮层。两者分工见 config/back-guard.js 头注。
import { installBackGuard, registerBackCloser } from '../config/back-guard.js';

export class PhoneShell {
    constructor() {
        this.container = null;
        this.screen = null;
        this.isVisible = false;
        this.currentApp = null;
        // 🎨 左滑关闭手势相关
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchCurrentX = 0;
        this.isSwiping = false;
        this.swipeThreshold = 80; // 滑动触发阈值
        // 🔋 电池状态
        this.batteryLevel = 85;
        this.isCharging = false;
        this.lockScreen = null;
        // 🔥 视觉历史栈（滑动返回用）
        this.viewHistory = [];
        // [v2.17.0] 横幅交互回调（由 index.js 注入）：
        //   onBannerAction(appId, notif)  点击横幅 → 跳转目标 App；未注入则点击仅收起横幅。
        //   onBannerDismiss(notif)        点击收起时通知宿主（用于把该条落账标记已读）。
        this.onBannerAction = null;
        this.onBannerDismiss = null;
        // 🔔 通知队列管理
        this.notificationQueue = [];
        this.isShowingNotification = false;
        this.currentNotificationData = null;
        this._lastStatusBarStoryTime = null;
    }

    createInPanel(panelContainer) {
        if (!panelContainer) {
            console.error('❌ 面板容器不存在');
            return;
        }

        this.container = document.createElement('div');
        this.container.className = 'phone-in-panel';
        // [v2.99.0] 外壳建起即接管返回键：压一层哨兵，于是「有浮层时按返回」
        //   会先被手机接住、逐层关闭，而不是直接退出宿主页面。
        //   幂等；无 history（沙箱）时内部静默降级，不影响外壳创建。
        try { installBackGuard(); } catch (_e) { /* 降级：返回键不接管，外壳照常 */ }

        this.container.innerHTML = `
    <div class="phone-body-panel">
        <!-- 🔥 华为风格：左上角药丸摄像头 -->
        <div class="phone-punch-hole"></div>

        <!-- 🔥 新状态栏：时间在左，信号电量在右 -->
        <div class="phone-statusbar">
            <div class="statusbar-left">
                <span class="time">${this.getCurrentTime()}</span>
            </div>
            <div class="statusbar-right">
                <!-- Wi-Fi 信号 -->
                <div class="phone-wifi-signal" role="img" aria-label="Wi-Fi 已连接">
                    <i class="fa-solid fa-wifi" aria-hidden="true"></i>
                </div>
                <!-- 🔋 横向电池：百分比显示在电池槽内 -->
                <div class="battery-icon" id="battery-icon" aria-label="电量 ${this.batteryLevel}%">
                    <div class="battery-body">
                        <div class="battery-level" id="battery-level" style="width: ${this.batteryLevel}%"></div>
                        <span class="battery-text" id="battery-text">${this.batteryLevel}</span>
                    </div>
                    <div class="battery-head"></div>
                </div>
            </div>
        </div>

        <div class="phone-screen" id="phone-screen">
            <!-- [v3.56.0] App 内返回键：此前**从未渲染过**任何返回按钮（全库零 back-btn），
                 唯一返回路径是「左边缘 1/2 区域右滑」—— 对用户不可见、不可发现。
                 故用户报障「进入应用后左上角没有返回按钮」。
                 它由 .phone-screen 直系持有（不在 view-stack 内），因此切视图不会重建它；
                 常驻但按 isAtHomeScreen() 切换可见性，主屏幕时隐藏。
                 触发链路与右滑返回同一条：goHome() → PHONE_EVENTS.GO_HOME。 -->
            <button type="button" class="phone-back-button" id="phone-back-button"
                    aria-label="返回上一页" title="返回">
                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                <span class="phone-back-button-text">返回</span>
            </button>
        </div>
    </div>
`;

        panelContainer.appendChild(this.container);
        this.screen = this.container.querySelector('.phone-screen');
        this.syncHomeLayoutChromeClass();
        this.bindBackButton();
        this.syncBackButtonVisibility();

        this.bindPanelEvents();
        this.bindSwipeGesture();
        this.bindTimeUpdateEvent();
        this.startClock();
        this.initBattery();  // 🔋 初始化电池
        this.lockScreen = new LockScreen(this);
        this._bindLockGesture();

        return this.container;
    }

    /** [v2.31.0] 惰性取得本实例的运行时登记层（升级为**可诊断的实例域**）。
     *  v2.26 建的是裸 ManagedRuntime：资源确实被回收了，但这个域不在全局域表里 ——
     *  runtimeStats() 看不见它、childRuntimeStats('phone-shell') 也数不到它，
     *  于是「手机壳重建时旧壳的监听器与时钟收净了没有」既不可见、也无法被判据锁定。
     *  改用 childRuntime 后它与其它实例域同构：进域表、可计数、回收留痕。 */
    _rt() {
        if (!this._runtime) this._runtime = childRuntime('phone-shell');
        return this._runtime;
    }

    /**
     * [v2.26.0] 长期存活对象监听器的统一登记入口。
     * 与 addEventListener 同参（target/type/handler/opts），差别仅在于引用被登记层
     * 持有，于是 destroy() 能精确解绑 —— 内联匿名 handler 同样能被持有，因为登记
     * 发生在调用侧而非 handler 侧，无需重构回调本体。
     * 元素自身（如 phoneBody，随 container.innerHTML='' 一起消失）不在此列：
     * 其监听器随节点摘除自然回收，登记反而会让 destroy 去解绑已无用的监听。
     */
    bindGlobal(target, type, handler, opts = false) {
        const short = String(type).split(':').pop();
        this._rt().addListener(target, type, handler, opts, `shell:${short}`);
    }

    /**
     * [v2.26.0] 实例销毁：回收本壳登记的全部全局监听器与定时器。
     * 由 index.js createPhoneInPanel() 在重建前调用（幂等，可重复调用）。
     * @returns {number} 实际回收项数
     */
    destroy() {
        let n = 0;
        // [v2.31.0] 级联：锁屏实例随旧壳被**整体丢弃**（lockScreen 字段失去引用），
        //   而它的 10s 时钟定时器与两个 window 鼠标监听器并不在壳的登记表里。
        //   v2.26 只收了壳自己登记的资源，锁屏那一份没人收 —— 若重建瞬间正处
        //   锁屏态，旧锁屏的定时器会永久累积，且其闭包钉住已废弃的 root 节点。
        try { this.lockScreen?.dispose?.(); } catch (_e) { /* 忽略 */ }
        this.lockScreen = null;
        try { n = this._runtime ? this._runtime.dispose() : 0; } catch (_) { /* 回收失败不阻断重建 */ }
        this._timeUpdateEventBound = false;
        return n;
    }

    bindTimeUpdateEvent() {
        if (this._timeUpdateEventBound) return;
        this._timeUpdateEventBound = true;
        this.bindGlobal(window, PHONE_EVENTS.TIME_UPDATED, () => {
            this.updateStatusBarTime();
        });
    }

    // 🔋 初始化电池API
    async initBattery() {
        try {
            // 尝试使用真实电池API
            if ('getBattery' in navigator) {
                const battery = await navigator.getBattery();
                console.log('🔋 电池API已连接:', battery.level * 100 + '%', battery.charging ? '充电中' : '未充电');
                this.updateBatteryDisplay(battery.level * 100, battery.charging);

                // 监听电池变化
                battery.addEventListener('levelchange', () => {
                    this.updateBatteryDisplay(battery.level * 100, battery.charging);
                });
                battery.addEventListener('chargingchange', () => {
                    this.updateBatteryDisplay(battery.level * 100, battery.charging);
                });
            } else {
                // 不支持Battery API，显示模拟电量
                console.log('🔋 浏览器不支持Battery API，使用模拟值');
                this.updateBatteryDisplay(78, false);  // 显示78%
            }
        } catch (e) {
            // 出错时显示模拟电量
            console.warn('🔋 电池API错误:', e);
            this.updateBatteryDisplay(78, false);  // 显示78%
        }
    }

    // 🔋 更新电池显示
    updateBatteryDisplay(level, charging) {
        const parsedLevel = Number(level);
        const nextLevel = Number.isFinite(parsedLevel) ? Math.round(parsedLevel) : this.batteryLevel;
        this.batteryLevel = Math.min(100, Math.max(0, nextLevel));
        this.isCharging = Boolean(charging);

        const levelEl = this.container?.querySelector('.battery-level');
        const textEl = this.container?.querySelector('.battery-text');
        const iconEl = this.container?.querySelector('.battery-icon');

        if (levelEl) {
            levelEl.style.width = `${this.batteryLevel}%`;
        }
        if (textEl) {
            textEl.textContent = String(this.batteryLevel);
        }
        if (iconEl) {
            iconEl.classList.toggle('charging', this.isCharging);
            iconEl.classList.toggle('battery-low', this.batteryLevel <= 20);
            iconEl.classList.toggle('battery-medium', this.batteryLevel > 20 && this.batteryLevel <= 50);
            iconEl.setAttribute(
                'aria-label',
                `电量 ${this.batteryLevel}%${this.isCharging ? '，充电中' : ''}`
            );
        }
    }

    // 🎨 绑定左滑关闭手势
    bindSwipeGesture() {
        const phoneBody = this.container.querySelector('.phone-body-panel');
        if (!phoneBody) return;

        // 🔥 滑动目标变量（根据场景动态切换）
        let slideTarget = null;
        const resolveEditableHost = (node) => {
            if (!node || typeof node.closest !== 'function') return null;
            return node.closest('textarea, input, [contenteditable], [contenteditable="plaintext-only"]');
        };
        const isTextEditableElement = (el) => {
            if (!el) return false;
            const tag = String(el.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA') {
                return !el.disabled && !el.readOnly;
            }
            if (tag === 'INPUT') {
                const type = String(el.type || '').toLowerCase() || 'text';
                const textInputTypes = new Set(['text', 'search', 'password', 'email', 'number', 'url', 'tel']);
                return textInputTypes.has(type) && !el.disabled && !el.readOnly;
            }
            return !!el.isContentEditable;
        };
        const resolveGestureControlHost = (node) => {
            if (!node || typeof node.closest !== 'function') return null;
            return node.closest('input[type="range"], [role="slider"], .phone-gesture-control, .games-2048-board, .honey-live-visibility-modal, .mofo-app, #wechat-werewolf-preview-modal');
        };
        const resolveInteractiveHost = (node) => {
            if (!node || typeof node.closest !== 'function') return null;
            return node.closest('button, a, select, option, label, [role="button"], [role="tab"], [data-no-swipe-back]');
        };
        const hasActiveSelection = () => {
            const selection = window.getSelection?.();
            return !!selection && !selection.isCollapsed && String(selection).length > 0;
        };

        // 🔥 核心修复 1：移除屏幕宽度限制，全面接管虚拟手机的触摸滑动！
        phoneBody.addEventListener('touchmove', (e) => {
            const target = e.target;
            const touchEditableHost = resolveEditableHost(target);
            const activeEditableHost = resolveEditableHost(document.activeElement);
            const hasFocusedTextInput = !!(activeEditableHost && isTextEditableElement(activeEditableHost) && phoneBody.contains(activeEditableHost));
            if (isTextEditableElement(touchEditableHost) || hasFocusedTextInput) return;
            if (resolveGestureControlHost(target) || resolveInteractiveHost(target)) return;

            // 动态判断当前手势是否是明显的水平滑动
            let isHorizontalSwipe = false;
            if (e.touches && e.touches.length > 0 && this.touchStartX !== undefined) {
                const deltaX = Math.abs(e.touches[0].clientX - this.touchStartX);
                const deltaY = Math.abs(e.touches[0].clientY - this.touchStartY);
                if (deltaX > deltaY && deltaX > 5) {
                    isHorizontalSwipe = true;
                }
            }

            // 🔥 绝杀：如果是水平右滑，立刻阻止浏览器原生行为，彻底修复平板端返回崩溃问题！
            if (isHorizontalSwipe) {
                if (e.cancelable) e.preventDefault();
                return;
            }

            // 垂直滑动时的可滚动区域白名单
            const scrollableAreas =[
                '.home-dashboard', '.home-app-cluster-scroll',
                '.chat-messages', '#voice-chat-messages', '#video-chat-messages',
                '.quick-reply-panel', '.quick-time-column', '.emoji-panel', '.emoji-scroll',
                '.wechat-content', '.wechat-profile-edit-content', '.wechat-wallet-ledger-scroll', '.app-body', '.settings-app', '.app-name-custom-list', '.moments-list',
                '.yzp-frame-color-picker-overlay', '.yzp-frame-color-picker-dialog', '.yzp-frame-color-picker-body',
                '.wechat-moment-visibility-list',
                '#tab-memory', '.settings-app #tab-memory',
                '#tab-lobby', '.settings-app #tab-lobby', '.phone-lobby-groups-list', '.phone-lobby-characters-list',
                '.contact-list', '.chat-list', '.diary-toc-list', '.diary-page-body', '.diary-photo-back',
                '.wangxiang-progress-popup', '.wangxiang-info-dialog-body', '.wangxiang-form-dialog-body',
                '.diary-settings-body', '.diary-edit-body',
                '.music-settings-body',
                '.honey-gift-picker','.honey-live-gifts-list',
                '.honey-scene-desc', '#honey-ui-scene',
                '.honey-recommend-wrap', '.honey-content', '#honey-custom-video-list',
                '.honey-follow-video-modal-panel', '.honey-follow-video-modal-list',
                '.honey-recharge-modal', '.honey-recharge-panel','#honey-ui-scene-modal','.honey-scene-modal-card',
                '.honey-live-visibility-modal', '.honey-live-visibility-panel',
                '.honey-settings-content', '.honey-prompt-editor', '#honey-prompt-editor',
                '#wallet-eval-modal', '.wallet-eval-modal-panel', '.wallet-eval-modal-body', '.wallet-eval-reasoning',
                '.weibo-app', '.weibo-tab-content', '.weibo-detail-posts', '.weibo-settings-content', '.weibo-detail-page-body',
                '.weibo-profile-wrapper', '.weibo-recommend-container', '.weibo-pull-refresh-indicator',
                '.weibo-forward-overlay', '.weibo-forward-dialog', '.weibo-forward-dialog-compose', '.weibo-forward-list',
                '#wechat-weibo-preview-modal', '#wechat-weibo-preview-modal > div',
                '#wechat-poker-preview-modal', '#wechat-poker-preview-modal > div', '.wechat-poker-preview-body',
                '#wechat-wangxiang-task-modal', '#wechat-wangxiang-task-modal > div', '.wechat-wangxiang-task-modal-body',
                '#wechat-werewolf-preview-modal', '#wechat-werewolf-preview-modal > div', '.wechat-werewolf-preview-body',
                '#wechat-undercover-preview-modal', '#wechat-undercover-preview-modal > div', '.wechat-undercover-preview-body',
                '.wechat-call-transcript-overlay', '.wechat-call-transcript-panel', '.wechat-call-transcript-body',
                '.wechat-image-prompt-editor-overlay', '.wechat-image-prompt-editor-dialog', '.wechat-image-prompt-editor-body', '.wechat-image-prompt-editor-textarea',
                '.phone-image-viewer-overlay', '.phone-image-viewer-stage',
                '.phone-image-viewer-workflow-picker', '.phone-image-viewer-workflow-dialog', '.phone-image-viewer-workflow-list',
                '#st-phone-update-modal', '.st-phone-update-dialog', '.st-phone-update-content', '.st-phone-update-list',
                '#phone-image-preset-share-modal', '#phone-image-preset-share-modal > div', '#phone-image-preset-share-text',
                '#phone-image-preset-export-chooser', '.phone-image-preset-export-dialog', '.phone-image-preset-export-list',
                '#phone-image-comfyui-lora-modal', '.phone-image-comfyui-lora-dialog', '.phone-image-comfyui-lora-picker-list',
                '.phone-call-history-list', '.phone-call-main', '.phone-call-contacts', '.phone-call-contact-list',
                '.phone-sms-main', '.phone-sms-conversation-list', '.phone-sms-thread', '.phone-sms-thread-messages',
                '.phone-sms-new-overlay', '.phone-sms-new-sheet', '.phone-sms-new-message', '.phone-sms-new-recipient-options',
                '#phone-sms-popup-root', '.phone-sms-popup-dialog', '.phone-sms-popup-body',
                '.phone-call-transcript', '#phone-call-transcript-messages',
                '.phone-call-settings', '.phone-call-settings-body', '.phone-call-settings-section',
                '.phone-call-prompt-textarea', '#phone-call-call-prompt', '#phone-call-sms-prompt',
                '.phone-worldbook-entry-modal', '.phone-worldbook-entry-dialog', '.phone-worldbook-entry-list',
                '.weibo-clear-data-overlay', '.weibo-clear-data-dialog',
                '.phone-call-active', '.phone-call-messages', '#phone-call-messages', '.phone-call-bottom', '#phone-call-input',
                '.honey-live-gifts', '.honey-live-gifts-list', '.honey-live-bottom',
                '.mofo-app', '.mofo-list-col', '.mofo-detail-col',
                '.mofo-editor-overlay', '.mofo-editor-panel', '.mofo-editor-body',
                '.games-app', '.games-lobby-content', '.games-log', '.games-contact-list', '.games-settings-panel', '.games-worldbook-list', '.games-ai-error-message',
                '.games-werewolf-chat', '.games-werewolf-chat-scroll', '.games-werewolf-contact-list', '.games-werewolf-invite-panel',
                '.games-werewolf-settings-panel', '.games-werewolf-settings-textarea',
                '.games-werewolf-user-speech', '.games-werewolf-night-targets', '.games-werewolf-wolf-chat', '.games-werewolf-record-panel',
                '.games-werewolf-record-overlay', '.games-werewolf-record-list', '.games-werewolf-record-item',
                '.games-undercover-home', '.games-undercover-settings-overlay', '.games-undercover-settings-panel', '.games-undercover-settings-textarea',
                '.games-undercover-start-choice-overlay', '.games-undercover-start-choice-panel',
                '.games-undercover-error-overlay', '.games-undercover-error-dialog', '.games-undercover-error-message',
                '.games-undercover-game-stage', '.games-undercover-chat-panel', '.games-undercover-chat-scroll',
                '.games-undercover-invite-overlay', '.games-undercover-invite-panel', '.games-undercover-contact-list',
                '.games-undercover-share-overlay', '.games-undercover-share-dialog', '.games-undercover-share-list',
                '.games-catbox-inventory-overlay', '.games-catbox-inventory-panel', '.games-catbox-inventory-list',
                '.games-catbox-coadopt-overlay', '.games-catbox-coadopt-panel', '.games-catbox-coadopt-list',
                '.games-catbox-letters-overlay', '.games-catbox-letter-paper', '.games-catbox-letter-list',
                '.album-body', '.album-grid', '.album-source-menu', '.album-preview-panel',
                '.album-image-picker-content', '.album-image-picker-grid', '.album-image-picker-menu',
                '.wangxiang-content-scroll',
                '.yzp-calendar-main', '.yzp-calendar-settings-body', '.yzp-calendar-prompt-editor',
                '.yzp-calendar-memo-list', '.yzp-calendar-add-sheet', '.yzp-calendar-month-sheet', '.yzp-calendar-detail-sheet', '.yzp-calendar-detail-body', '.yzp-calendar-memo-input', '.yzp-calendar-type-menu',
                '#phone-inline-reply-menu-pop', '.inline-reply-tabbar', '.inline-reply-page',
                '#mofo-list-wrap', '#mofo-preview-wrap'
            ];

            const isInScrollableArea = scrollableAreas.some(selector => target.closest(selector));

            // 如果垂直滑动且不在滚动区内，阻止整个网页被拉扯
            if (!isInScrollableArea && e.cancelable) {
                e.preventDefault();
            }
        }, { passive: false });

        // 触摸开始
        phoneBody.addEventListener('touchstart', (e) => {
            if (!e.target?.closest?.('.phone-screen')) {
                this.touchStartX = undefined;
                this.touchStartY = undefined;
                this.touchCurrentX = undefined;
                this.isSwiping = false;
                slideTarget = null;
                return;
            }

            // 🔥 核心修复：输入中（含光标拖拽手柄）时放弃全局滑动判断，避免抢占文本光标拖动
            const touchEditableHost = resolveEditableHost(e.target);
            const activeEditableHost = resolveEditableHost(document.activeElement);
            const hasFocusedTextInput = !!(activeEditableHost && isTextEditableElement(activeEditableHost) && phoneBody.contains(activeEditableHost));
            if (isTextEditableElement(touchEditableHost) || hasFocusedTextInput || resolveGestureControlHost(e.target) || resolveInteractiveHost(e.target)) {
                this.touchStartX = undefined;
                return;
            }

            const touch = e.touches[0];
            this.touchStartX = touch.clientX;
            this.touchStartY = touch.clientY;
            this.touchCurrentX = touch.clientX;
            this.isSwiping = false;
            slideTarget = null;
        }, { passive: false });

        // 触摸移动
        phoneBody.addEventListener('touchmove', (e) => {
            if (!Number.isFinite(this.touchStartX) || !e.target?.closest?.('.phone-screen')) return;
            const touch = e.touches[0];
            this.touchCurrentX = touch.clientX;
            const deltaX = this.touchCurrentX - this.touchStartX;
            const deltaY = Math.abs(touch.clientY - this.touchStartY);

            // 🔥 计算相对于手机的位置
            const phoneRect = phoneBody.getBoundingClientRect();
            const relativeStartX = this.touchStartX - phoneRect.left;
            const relativeStartY = this.touchStartY - phoneRect.top;
            const phoneWidth = phoneRect.width;
            const phoneHeight = phoneRect.height;

            // 🔥 确保触摸起始点在手机屏幕内
            const isInsidePhone = relativeStartX >= 0 && relativeStartX <= phoneWidth &&
                                  relativeStartY >= 0 && relativeStartY <= phoneHeight;

            if (!isInsidePhone) return;

            // 🔥 修复卡死Bug：通过历史栈精准判断，防止底层垫片干扰
            const isHome = this.isAtHomeScreen();

            // 🔥 滑动条件：
            // - 主屏幕：从左边缘1/3区域开始右滑 → 关闭手机
            // - APP内：从左边缘1/2区域开始右滑 → 返回上一级
            const triggerZone = isHome ? phoneWidth / 3 : phoneWidth / 2;

            if (relativeStartX < triggerZone && deltaX > 20 && deltaX > deltaY) {
                // 标记滑动类型：主屏幕关闭手机，APP内返回
                this.isSwiping = true;
                this.swipeAction = isHome ? 'close' : 'back';
                e.stopPropagation();

                // 🔥 动态获取滑动目标：back时只滑动屏幕内容，close时滑动整个手机
                slideTarget = this.swipeAction === 'back'
                    ? (this.container.querySelector('.phone-view-current') || this.container.querySelector('.phone-screen > div'))
                    : phoneBody;

                // 🔥 阻止原生手势冲突
                if (e.cancelable) e.preventDefault();

                // 🔥 添加滑动视觉反馈
                if (slideTarget) {
                    const progress = Math.min(deltaX / this.swipeThreshold, 1);
                    slideTarget.style.transform = `translate3d(${deltaX * 0.85}px, 0, 0)`;
                    // 只有关闭手机时才改变透明度
                    if (this.swipeAction === 'close') {
                        slideTarget.style.opacity = 1 - (progress * 0.5);
                    }
                }
            }
        }, { passive: false });

        // 触摸结束
        phoneBody.addEventListener('touchend', (e) => {
            if (!Number.isFinite(this.touchStartX)) return;
            const deltaX = this.touchCurrentX - this.touchStartX;

            // 🔥 保存引用，防止 setTimeout 回调时变量已被重置
            const target = slideTarget;
            const action = this.swipeAction;

            if (this.isSwiping && target && deltaX > this.swipeThreshold) {
                if (action === 'close') {
                    // 🔥 主屏幕：滑动关闭手机
                    target.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
                    target.style.transform = 'translate3d(100px, 0, 0)';
                    target.style.opacity = '0';

                    setTimeout(() => {
                        // 关闭抽屉
                        const drawerIcon = document.getElementById('phoneDrawerIcon');
                        const drawerPanel = document.getElementById('phone-panel');
                        if (drawerIcon && drawerPanel) {
                            drawerPanel.classList.remove('openDrawer', 'phone-panel-open', 'drawer-content', 'fillRight');
                            drawerPanel.classList.add('phone-panel-hidden');
                            drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                            window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
                        }
                        // 重置样式
                        if (target) {
                            target.style.transition = '';
                            target.style.transform = '';
                            target.style.opacity = '';
                        }
                    }, 300);
                } else if (action === 'back') {
                    // 🔥 APP内：页面滑出屏幕右侧，像真实手机一样
                    target.style.transition = 'transform 0.25s ease-out';
                    target.style.transform = 'translate3d(100%, 0, 0)';

                    this._dispatchSwipeBackWithFallback(target);
                }
            } else if (this.isSwiping && target) {
                // 滑动距离不够，回弹恢复原位
                this._resetSwipeLayer(target, { animate: true, resetOpacity: action === 'close' });
            }

            this.isSwiping = false;
            this.swipeAction = null;
            slideTarget = null;
        }, { passive: true });

        phoneBody.addEventListener('touchcancel', () => {
            if (slideTarget) {
                this._resetSwipeLayer(slideTarget, { animate: true, resetOpacity: this.swipeAction === 'close' });
            }
            this.isSwiping = false;
            this.swipeAction = null;
            slideTarget = null;
        }, { passive: true });

        // Pointer 支持（PC端模拟）
        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerCurrentX = 0;
        let activeSwipePointerId = null;
        let isPointerDown = false;
        let pointerSlideTarget = null;

        const clearPointerSwipeState = () => {
            isPointerDown = false;
            this.isSwiping = false;
            this.swipeAction = null;
            pointerSlideTarget = null;
            activeSwipePointerId = null;
        };
        const cancelPointerSwipe = ({ animate = true } = {}) => {
            if (pointerSlideTarget) {
                this._resetSwipeLayer(pointerSlideTarget, {
                    animate,
                    resetOpacity: this.swipeAction === 'close'
                });
            }
            clearPointerSwipeState();
        };

        phoneBody.addEventListener('pointerdown', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            if (e.button !== undefined && e.button !== 0) return;
            if (isPointerDown || pointerSlideTarget) {
                cancelPointerSwipe({ animate: false });
            }
            if (!e.target?.closest?.('.phone-screen')) {
                return;
            }

            const pointerEditableHost = resolveEditableHost(e.target);
            if (isTextEditableElement(pointerEditableHost) || resolveGestureControlHost(e.target) || resolveInteractiveHost(e.target)) {
                return;
            }

            activeSwipePointerId = e.pointerId;
            pointerStartX = e.clientX;
            pointerStartY = e.clientY;
            pointerCurrentX = e.clientX;
            isPointerDown = true;
            pointerSlideTarget = null;
            this.isSwiping = false;
            this.swipeAction = null;
        });

        this.bindGlobal(document, 'pointermove', (e) => {
            if (!isPointerDown || activeSwipePointerId !== e.pointerId) return;
            if (e.pointerType === 'mouse' && e.buttons === 0) {
                cancelPointerSwipe();
                return;
            }
            if (document.getElementById('phone-panel')?.classList?.contains('phone-panel-desktop-dragging')) {
                cancelPointerSwipe();
                return;
            }
            const deltaX = e.clientX - pointerStartX;
            const deltaY = Math.abs(e.clientY - pointerStartY);
            pointerCurrentX = e.clientX;

            const phoneRect = phoneBody.getBoundingClientRect();
            const relativeStartX = pointerStartX - phoneRect.left;
            const relativeStartY = pointerStartY - phoneRect.top;
            const phoneWidth = phoneRect.width;
            const phoneHeight = phoneRect.height;
            const isInsidePhone = relativeStartX >= 0 && relativeStartX <= phoneWidth &&
                                  relativeStartY >= 0 && relativeStartY <= phoneHeight;

            if (!isInsidePhone) return;

            const isHome = this.isAtHomeScreen();
            if (e.pointerType === 'mouse' && isHome) return;

            const triggerZone = e.pointerType === 'mouse'
                ? (isHome ? phoneWidth / 3 : phoneWidth / 2)
                : (isHome ? phoneWidth / 3 : phoneWidth / 2);

            if (hasActiveSelection()) {
                cancelPointerSwipe();
                return;
            }

            if (relativeStartX < triggerZone && deltaX > 18 && deltaX > deltaY) {
                this.isSwiping = true;
                this.swipeAction = isHome ? 'close' : 'back';
                e.preventDefault();
                e.stopPropagation();

                pointerSlideTarget = this.swipeAction === 'back'
                    ? (this.container.querySelector('.phone-view-current') || this.container.querySelector('.phone-screen > div'))
                    : phoneBody;

                if (pointerSlideTarget) {
                    const progress = Math.min(deltaX / this.swipeThreshold, 1);
                    pointerSlideTarget.style.transform = `translate3d(${deltaX * 0.85}px, 0, 0)`;
                    if (this.swipeAction === 'close') {
                        pointerSlideTarget.style.opacity = 1 - (progress * 0.5);
                    }
                }
            }
        });

        this.bindGlobal(document, 'pointerup', (e) => {
            if (!isPointerDown || activeSwipePointerId !== e.pointerId) return;
            isPointerDown = false;
            const deltaX = pointerCurrentX - pointerStartX;

            const target = pointerSlideTarget;
            const action = this.swipeAction;

            if (this.isSwiping && target && deltaX > this.swipeThreshold) {
                e.preventDefault();
                e.stopPropagation();
                if (action === 'close') {
                    // 🔥 主屏幕：滑动关闭手机
                    target.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
                    target.style.transform = 'translate3d(100px, 0, 0)';
                    target.style.opacity = '0';

                    setTimeout(() => {
                        const drawerIcon = document.getElementById('phoneDrawerIcon');
                        const drawerPanel = document.getElementById('phone-panel');
                        if (drawerIcon && drawerPanel) {
                            drawerPanel.classList.remove('openDrawer', 'phone-panel-open', 'drawer-content', 'fillRight');
                            drawerPanel.classList.add('phone-panel-hidden');
                            drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                            window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
                        }
                        if (target) {
                            target.style.transition = '';
                            target.style.transform = '';
                            target.style.opacity = '';
                        }
                    }, 300);
                } else if (action === 'back') {
                    // 🔥 APP内：页面滑出屏幕右侧
                    target.style.transition = 'transform 0.25s ease-out';
                    target.style.transform = 'translate3d(100%, 0, 0)';

                    this._dispatchSwipeBackWithFallback(target);
                }
            } else if (this.isSwiping && target) {
                // 滑动距离不够，回弹恢复原位
                this._resetSwipeLayer(target, { animate: true, resetOpacity: action === 'close' });
            }

            clearPointerSwipeState();
        }, true);

        this.bindGlobal(document, 'pointercancel', (e) => {
            if (!isPointerDown || activeSwipePointerId !== e.pointerId) return;
            cancelPointerSwipe();
        }, true);

        this.bindGlobal(window, 'blur', () => cancelPointerSwipe());
    }

    _resetSwipeLayer(target, { animate = false, resetOpacity = true } = {}) {
        if (!target || !target.isConnected) return;
        if (animate) {
            target.style.transition = 'transform 0.2s ease-out';
            target.style.transform = 'translate3d(0, 0, 0)';
            if (resetOpacity) target.style.opacity = '1';
            setTimeout(() => {
                if (!target.isConnected) return;
                target.style.transition = '';
                target.style.transform = '';
                if (resetOpacity) target.style.opacity = '';
            }, 220);
            return;
        }
        target.style.transition = '';
        target.style.transform = '';
        if (resetOpacity) target.style.opacity = '';
    }

    _dispatchSwipeBackWithFallback(target) {
        const startViewId = target?.getAttribute?.('data-view-id') || '';
        let poppedView = null;
        setTimeout(() => {
            if (this.viewHistory.length > 1) {
                poppedView = this.viewHistory.pop();
            }
            window.dispatchEvent(new CustomEvent('phone:swipeBack'));

            setTimeout(() => {
                if (!target || !target.isConnected) return;
                const currentView = this.container?.querySelector('.phone-view-current');
                const currentViewId = currentView?.getAttribute?.('data-view-id') || '';
                const transform = String(target.style.transform || '').trim();
                const isStillShifted = !!transform && !/^translate3d\(\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*\)$/i.test(transform);
                if (currentView === target && currentViewId === startViewId && isStillShifted) {
                    this._resetSwipeLayer(target, { animate: true, resetOpacity: false });
                    if (poppedView?.id && !this.viewHistory.some(item => item.id === poppedView.id)) {
                        this.viewHistory.push(poppedView);
                    }
                }
            }, 550);
        }, 250);
    }

     bindPanelEvents() {
        // 🔥 初始绑定 Home 指示器
        this.bindHomeIndicator();
        this.bindPhoneInputIsolation();
    }

    bindPhoneInputIsolation() {
        if (!this.container || this.container._phoneInputIsolationBound) return;
        this.container._phoneInputIsolationBound = true;

        const isPhoneEditableTarget = (target) => {
            if (!target || typeof target.closest !== 'function') return false;
            const editable = target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]');
            return !!editable && !!editable.closest('.phone-screen');
        };
        const isolate = (event) => {
            if (!isPhoneEditableTarget(event.target)) return;
            event.stopPropagation();
        };
        const updateInputState = (event, active) => {
            if (!isPhoneEditableTarget(event.target)) return;
            // 蜜语使用该 body 状态调整直播输入栏；面板尺寸由 index.js 统一管理。
            document.body?.classList?.toggle?.('phone-input-active', !!active);
        };
        [
            'beforeinput',
            'input',
            'change',
            'keydown',
            'keyup',
            'keypress',
            'compositionstart',
            'compositionupdate',
            'compositionend',
            'paste',
            'cut',
            'copy'
        ].forEach((eventName) => {
            this.container.addEventListener(eventName, isolate);
        });
        this.container.addEventListener('focusin', (event) => updateInputState(event, true));
        this.container.addEventListener('focusout', (event) => {
            setTimeout(() => {
                const active = document.activeElement;
                if (active && isPhoneEditableTarget(active)) return;
                updateInputState(event, false);
            }, 80);
        });
    }
    
    _isLobbyMode(context = null) {
        const ctx = context || window.VirtualPhone?.storage?.getContext?.() || window.SillyTavern?.getContext?.() || {};
        const charName = String(ctx?.name2 || '').trim();
        if (/^SillyTavern System$/i.test(charName)) return true;
        const chatId = String(ctx?.chatMetadata?.file_name || ctx?.chatId || '').trim();
        if (chatId) return false;
        return !charName;
    }

    _isStorageTruthy(key) {
        const raw = window.VirtualPhone?.storage?.get?.(key);
        return raw === true || raw === 'true' || raw === 1;
    }

    _isStorageEnabledByDefault(key) {
        const raw = window.VirtualPhone?.storage?.get?.(key);
        if (raw === undefined || raw === null || raw === '') return true;
        return raw === true || raw === 'true' || raw === 1;
    }

    _shouldUseRealTimeForPhoneDisplay() {
        const context = window.VirtualPhone?.storage?.getContext?.() || window.SillyTavern?.getContext?.() || {};
        const isLobby = this._isLobbyMode(context);
        const onlineOnlyKey = isLobby ? 'phone_lobby_wechat_online_only_mode' : 'wechat_online_only_mode';
        const interopKey = isLobby ? 'phone_lobby_wechat_online_mode' : 'wechat_online_mode';
        const realTimeKey = isLobby ? 'phone_lobby_wechat_online_only_real_time_enabled' : 'wechat_online_only_real_time_enabled';
        return this._isStorageTruthy(onlineOnlyKey)
            && !this._isStorageTruthy(interopKey)
            && this._isStorageEnabledByDefault(realTimeKey);
    }

    getCurrentTime() {
        const timeManager = window.VirtualPhone?.timeManager;

        if (timeManager) {
            if (this._shouldUseRealTimeForPhoneDisplay() && typeof timeManager.getRealTime === 'function') {
                return timeManager.getRealTime()?.time;
            }
            const storyTime = timeManager.getCurrentStoryTime();
            if (storyTime?.time && !storyTime.isReal) {
                this._lastStatusBarStoryTime = storyTime;
                return storyTime.time;
            }
            if (this._lastStatusBarStoryTime?.time) {
                return this._lastStatusBarStoryTime.time;
            }
            return storyTime?.time;
        }

        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    
    startClock() {
    // 初始化显示
    this.updateStatusBarTime();

    // 改为30秒更新一次（剧情时间不会秒秒变化）
    let lastTime = this.getCurrentTime();
    // [v2.26.0] 原写法既不存句柄也无清理路径：手机壳重建后旧轮询永久残留，
    //   且其闭包钉住已废弃实例的 container 引用。改由登记层持有。
    this._rt().addInterval(() => {
        const newTime = this.getCurrentTime();
        if (newTime !== lastTime) {  // 只在时间变化时更新DOM
            lastTime = newTime;
            this.updateStatusBarTime();
        }
    }, 30000, 'shell-clock');  // 30秒检查一次
}

    // 🔥 强制刷新状态栏时间（供外部调用）
    updateStatusBarTime() {
        const timeEl = this.container?.querySelector('.statusbar-left .time');
        if (timeEl) {
            timeEl.textContent = this.getCurrentTime();
        }
    }

    // 🔥 辅助方法：通过历史栈精准判断是否在主屏幕
    isAtHomeScreen() {
        return this.viewHistory.length <= 1 && (this.viewHistory.length === 0 || this.viewHistory[0].id === 'home');
    }

    /* ============================================================
     * [v3.56.0] App 内返回键
     * ------------------------------------------------------------
     * 为什么加（真实报障，不是整洁性偏好）：
     *   用户反馈「进入应用后，左上角没有返回按钮」。实查：`createInPanel` 的 innerHTML
     *   只渲染 punch-hole / statusbar / phone-screen 三块，`grep back-btn|返回` 全库只命中
     *   注释与手势逻辑 —— **从未渲染过任何返回按钮**。唯一返回路径是
     *   `bindSwipeGesture` 的「左边缘 1/2 区域右滑」，对用户不可见、不可发现。
     *
     * 为什么挂在 .phone-screen 而不是 view-stack 内的图层：
     *   图层（[data-view-id]）会被 setContent 反复重建与回收，按钮挂在里面会随视图
     *   一起被销毁（切一次 App 就没了）。.phone-screen 是常驻容器，按钮跟着它活。
     *
     * 为什么走 goHome() 而不是自己维护一份返回逻辑：
     *   右滑返回（bindSwipeGesture 的 SWIPE_BACK 分支）已经是本仓的返回语义真源，
     *   它负责压栈/弹栈与「返回桌面后 500ms 屏蔽误 reopen」。第二个真源必然漂移，
     *   故这里只调它、不重写。
     * ============================================================ */
    bindBackButton() {
        const btn = this.container?.querySelector?.('#phone-back-button');
        if (!btn || btn.dataset.backBound === '1') return;
        btn.dataset.backBound = '1';
        // pointerdown 的 stopPropagation 是必须的：否则同一次触摸会被 bindSwipeGesture
        //   的 touchmove 判定读成「从边缘起手的右滑」，触发一次额外返回（双退）。
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.isAtHomeScreen()) return;
            this.goHome();
        });
    }

    /* 可见性：主屏幕隐藏，其余视图显示。
     *   只切 class 不做 DOM 增删 —— 按钮常驻，避免每次切视图都重建（并因此丢监听）。 */
    syncBackButtonVisibility() {
        const btn = this.container?.querySelector?.('#phone-back-button');
        if (!btn) return false;
        const atHome = this.isAtHomeScreen();
        btn.classList.toggle('is-hidden', atHome);
        btn.setAttribute('aria-hidden', String(atHome));
        // 内联 display 兜底：宿主可能在别处用 !important 压过样式表（本仓已知形态），
        //   故走 inline style 直写，不依赖 CSS 优先级。
        btn.style.display = atHome ? 'none' : '';
        return !atHome;
    }

    goHome() {
        this.currentApp = null;
        this.viewHistory = [];  // 🔥 清空视觉历史栈
        if (window.VirtualPhone) {
            // 返回桌面后短时间屏蔽一次图标点击导致的误 reopen
            window.VirtualPhone._homeReturnGuardUntil = Date.now() + 500;
        }
        // [v3.56.0] 栈已清空 ⇒ 已在主屏幕，返回键必须立刻隐藏。
        //   不依赖随后的 setContent（home 视图重建可能走缓存 diff 而**不**触发重渲染），
        //   故在此显式同步一次。
        this.syncBackButtonVisibility();
        window.dispatchEvent(new CustomEvent(PHONE_EVENTS.GO_HOME));
    }
    
    toggleScreen() {
        if (!this.lockScreen) this.lockScreen = new LockScreen(this);
        this.lockScreen.toggle();
    }

    _bindLockGesture() {
        const punch = this.container?.querySelector('.phone-punch-hole');
        if (!punch || punch.dataset.lockBound === '1') return;
        punch.dataset.lockBound = '1';
        punch.style.pointerEvents = 'auto';
        punch.style.cursor = 'pointer';
        punch.title = '点击锁屏';
        punch.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleScreen();
        });
    }

    showImageViewer(imageUrl, options = {}) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl || !this.container) return;
        const allowDownload = options.download !== false;
        const downloadName = this._buildImageViewerDownloadName(options.filename || options.downloadName || 'phone-image');
        const videoGeneration = options?.videoGeneration && typeof options.videoGeneration === 'object'
            ? options.videoGeneration
            : null;
        const allowVideoGeneration = typeof videoGeneration?.onGenerate === 'function';
        const videoWorkflows = (Array.isArray(videoGeneration?.workflows) ? videoGeneration.workflows : [])
            .filter(item => item && String(item.id || '').trim() && String(item.name || '').trim());

        const phoneBody = this.container.querySelector('.phone-body-panel') || this.container;
        phoneBody.querySelector('#phone-image-viewer-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'phone-image-viewer-overlay';
        overlay.className = 'phone-image-viewer-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <button class="phone-image-viewer-close" type="button" aria-label="关闭图片预览">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            ${allowDownload ? `
                <button class="phone-image-viewer-download" type="button" aria-label="下载图片">
                    <i class="fa-solid fa-download"></i>
                </button>
            ` : ''}
            ${allowVideoGeneration ? `
                <button class="phone-image-viewer-video" type="button" aria-label="生成视频" title="生成视频" style="right: ${allowDownload ? '54px' : '12px'};">
                    <i class="fa-solid fa-video"></i>
                </button>
                <div class="phone-image-viewer-video-progress" role="status" aria-live="polite" hidden>
                    <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                    <span class="phone-image-viewer-video-progress-label">视频生成中</span>
                </div>
            ` : ''}
            <div class="phone-image-viewer-stage">
                <img class="phone-image-viewer-img" alt="">
            </div>
        `;

        const img = overlay.querySelector('.phone-image-viewer-img');
        img.src = safeUrl;
        img.alt = String(options.alt || '图片预览');

        // [v2.99.0] 返回键可关：把「关闭本浮层」注册进返回栈（后开的先关）。
        //   为什么用闭包变量而不是直接 registerBackCloser(close)：close 定义在后面，
        //   而注册必须在 overlay 进 DOM 前完成（否则中间一段时间返回键关不到它）。
        let releaseBackCloser = () => {};
        const close = () => {
            try { releaseBackCloser(); } catch (_e) { /* 注销失败不得阻断关闭 */ }
            overlay.remove();
        };
        try {
            releaseBackCloser = registerBackCloser(() => {
                if (!overlay.isConnected) return false;   // 已经不在了：不是我的（交下一层）
                close();
                return true;
            }, { tag: 'image-viewer' });
        } catch (_e) { /* 注册失败：返回键关不到本浮层，但浮层本身照常可用（降级） */ }
        const closeFromControl = (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            close();
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target?.classList?.contains('phone-image-viewer-stage')) {
                close();
            }
        });
        const closeBtn = overlay.querySelector('.phone-image-viewer-close');
        closeBtn?.addEventListener('pointerdown', closeFromControl);
        closeBtn?.addEventListener('touchstart', closeFromControl, { passive: false });
        closeBtn?.addEventListener('click', closeFromControl);
        const downloadBtn = overlay.querySelector('.phone-image-viewer-download');
        let lastDownloadTriggerTs = 0;
        let downloadInFlight = false;
        const downloadFromControl = async (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            const now = Date.now();
            if (downloadInFlight || now - lastDownloadTriggerTs < 800) return;
            lastDownloadTriggerTs = now;
            downloadInFlight = true;
            if (downloadBtn) downloadBtn.disabled = true;
            try {
                await this._downloadImageFromViewer(safeUrl, downloadName);
            } finally {
                downloadInFlight = false;
                if (downloadBtn?.isConnected) {
                    downloadBtn.disabled = false;
                }
            }
        };
        downloadBtn?.addEventListener('click', downloadFromControl);

        const videoBtn = overlay.querySelector('.phone-image-viewer-video');
        const videoProgress = overlay.querySelector('.phone-image-viewer-video-progress');
        let videoGenerationInFlight = false;
        let videoProgressTimer = null;
        const setVideoProgress = (state = 'idle', label = '') => {
            if (!videoProgress?.isConnected) return;
            clearTimeout(videoProgressTimer);
            videoProgress.classList.remove('is-success', 'is-error');
            const icon = videoProgress.querySelector('i');
            const text = videoProgress.querySelector('.phone-image-viewer-video-progress-label');
            if (state === 'idle') {
                videoProgress.hidden = true;
                return;
            }
            videoProgress.hidden = false;
            if (state === 'success') {
                videoProgress.classList.add('is-success');
                if (icon) icon.className = 'fa-solid fa-check';
                if (text) text.textContent = label || '视频已生成';
                videoProgressTimer = setTimeout(() => setVideoProgress('idle'), 1800);
                return;
            }
            if (state === 'error') {
                videoProgress.classList.add('is-error');
                if (icon) icon.className = 'fa-solid fa-triangle-exclamation';
                if (text) text.textContent = label || '生成失败';
                videoProgressTimer = setTimeout(() => setVideoProgress('idle'), 2800);
                return;
            }
            if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
            if (text) text.textContent = label || '视频生成中';
        };
        const runVideoGeneration = async (workflow) => {
            if (videoGenerationInFlight || !workflow) return;
            videoGenerationInFlight = true;
            if (videoBtn) {
                videoBtn.disabled = true;
                videoBtn.setAttribute('aria-busy', 'true');
                videoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            }
            setVideoProgress('loading', `正在生成 · ${String(workflow.name || '视频工作流')}`);
            try {
                await videoGeneration.onGenerate(workflow, {
                    imageUrl: safeUrl,
                    overlay,
                    setProgress: (label) => setVideoProgress('loading', label)
                });
                setVideoProgress('success', '视频已生成');
                videoProgressTimer = setTimeout(() => {
                    if (overlay.isConnected) close();
                }, 900);
            } catch (err) {
                const message = String(err?.message || err || '视频生成失败').trim();
                setVideoProgress('error', '视频生成失败');
                this.showNotification?.('视频生成失败', message, '⚠️');
            } finally {
                videoGenerationInFlight = false;
                if (videoBtn?.isConnected) {
                    videoBtn.disabled = false;
                    videoBtn.removeAttribute('aria-busy');
                    videoBtn.innerHTML = '<i class="fa-solid fa-video"></i>';
                }
            }
        };
        const openVideoWorkflowPicker = (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            if (videoGenerationInFlight) return;
            if (videoWorkflows.length === 0) {
                this.showNotification?.('生成视频', '请先在生图设置中保存可接收首帧的视频工作流', '⚠️');
                return;
            }

            overlay.querySelector('.phone-image-viewer-workflow-picker')?.remove();
            const picker = document.createElement('div');
            picker.className = 'phone-image-viewer-workflow-picker';
            picker.setAttribute('role', 'presentation');
            picker.innerHTML = `
                <div class="phone-image-viewer-workflow-dialog" role="dialog" aria-modal="true" aria-label="选择视频工作流">
                    <div class="phone-image-viewer-workflow-header">
                        <span>选择视频工作流</span>
                        <button class="phone-image-viewer-workflow-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="phone-image-viewer-workflow-list"></div>
                </div>
            `;
            const list = picker.querySelector('.phone-image-viewer-workflow-list');
            videoWorkflows.forEach((workflow) => {
                const item = document.createElement('button');
                item.className = 'phone-image-viewer-workflow-item';
                item.type = 'button';
                item.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i><span></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
                const name = item.querySelector('span');
                if (name) name.textContent = String(workflow.name || '视频工作流');
                item.addEventListener('click', () => {
                    picker.remove();
                    runVideoGeneration(workflow);
                });
                list?.appendChild(item);
            });
            const closePicker = (event) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                picker.remove();
            };
            picker.querySelector('.phone-image-viewer-workflow-close')?.addEventListener('click', closePicker);
            picker.addEventListener('click', (event) => {
                if (event.target === picker) closePicker(event);
            });
            overlay.appendChild(picker);
        };
        videoBtn?.addEventListener('click', openVideoWorkflowPicker);
        overlay.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        overlay.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

        phoneBody.appendChild(overlay);
    }

    _buildImageViewerDownloadName(rawName = 'phone-image') {
        const base = String(rawName || 'phone-image')
            .trim()
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 80) || 'phone-image';
        return /\.(?:png|jpe?g|webp|gif)$/i.test(base) ? base : `${base}.png`;
    }

    async _downloadImageFromViewer(imageUrl, filename) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return;
        let objectUrl = '';
        try {
            let href = safeUrl;
            if (!safeUrl.startsWith('data:image/')) {
                const response = await fetch(safeUrl, { credentials: 'include', cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                objectUrl = URL.createObjectURL(blob);
                href = objectUrl;
            }

            const link = document.createElement('a');
            link.href = href;
            link.download = filename;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
            this.showNotification?.('图片', '已触发下载', '⬇️');
        } catch (err) {
            console.warn('[PhoneShell] 图片下载失败，已尝试打开原图:', err);
            window.open(safeUrl, '_blank', 'noopener');
            this.showNotification?.('图片', '浏览器不支持直接下载，已打开原图', 'ℹ️');
        } finally {
            if (objectUrl) {
                setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            }
        }
    }
    
    _syncChromeThemeForView(viewId = '', html = '') {
        const panel = this.container?.querySelector?.('.phone-body-panel') || document.querySelector('.phone-body-panel');
        if (!panel) return;

        panel.classList.remove('phone-body-panel-honey', 'phone-body-panel-games', 'phone-body-panel-wangxiang');

        const safeViewId = String(viewId || '');
        const safeHtml = String(html || '');
        if (safeViewId.startsWith('honey-') || /\bhoney-app\b/.test(safeHtml)) {
            panel.classList.add('phone-body-panel-honey');
            return;
        }
        if (safeViewId.startsWith('games-') || /\bgames-app\b/.test(safeHtml)) {
            panel.classList.add('phone-body-panel-games');
            return;
        }
        if (safeViewId.startsWith('wangxiang-') || /\bwangxiang-app\b/.test(safeHtml)) {
            panel.classList.add('phone-body-panel-wangxiang');
        }
    }

    _scopePhoneFormControls(root) {
        if (!root) return;
        root.querySelectorAll?.('.toggle-switch, .honey-toggle-switch, .phone-call-toggle, .st-phone-toggle-switch').forEach((el) => {
            el.classList.add('st-phone-toggle-switch');
            el.querySelectorAll?.('input[type="checkbox"]').forEach((input) => {
                input.classList.add('st-phone-toggle-input');
            });
        });
        root.querySelectorAll?.('.toggle-slider, .honey-toggle-slider, .phone-call-toggle-slider, .st-phone-toggle-slider').forEach((el) => {
            el.classList.add('st-phone-toggle-slider');
        });
    }

    /* ============================================================
     * 建栈 / 取图层宿主（唯一实现）
     * ------------------------------------------------------------
     * 为什么抽出来（真浏览器实测抓到的真缺陷，不是整洁性偏好）：
     *   v3.61.0 把 setContent 自己的「覆盖 screen.innerHTML」改成了「逐件补齐」，
     *   但它只修了**自己**这一条路径—— 全仓另有 18 个 App 的 render() 直接
     *   把内容写进 `phoneShell.screen`（实例： `this.view.render(this.phoneShell.screen)`），
     *   而那些 view 的 `_draw()` 写的是 `this.container.innerHTML = html` ⇒
     *   **一次点击就把 `.phone-screen` 的子节点整体换掉**：
     *     栈、返回键、小白条全没，且栈没了之后**再也回不来**
     *     （setContent 会以为自己是首帧而重建一份空栈，但旧图层已随 screen 一起被消灭）。
     *   真浏览器逐开 82 入口实测：18 个入口毁掉外壳（playbook / achievement / xhs / tieba /
     *   health / memory / graph / peek / bilibili / theater / place / cheat / dirtytalk / wallet /
     *   profile / plotline / chars / asset），且后续回键全部失灵。
     *
     * 为什么不把它们全改成 setContent：
     *   那 18 个 view 的内部重绘写的是 `this.container.innerHTML`（容器就是图层），
     *   而 setContent 会把传入的 html 字符串**整体重写进图层**（并以
     *   `data-raw-html` 做指纹去重）—— 与那些 view 的自重绘形成**两个真源**，
     *   且需要把它们的内部重绘全部改成调 setContent（面大、易漏）。
     *   而「把宿主从 screen 换成图层」是同一件事的最小动作：
     *   图层本就是那些 view 应该写的地方（它们只是拿错了祖先节点），
     *   且 view 内部的 `container.querySelector` / `_draw` 一字不用改。
     *
     * 为什么要幂等降级：
     *   单元测试用模拟 shell（`{ screen }`，无栈、无 setContent）直接 new 这些 App
     *   并断言它们渲染出主体。若取不到栈就丢弃渲染，那些套件会从「验证行为」
     *   退化成「验证我不会渲染」。故实现层允许回退到 screen，
     *   但**回退路径必须可观测**：只要真壳在场（有 screen）就一律走图层，
     *   不会出现「真壳在场但走了回退」这种模棱两可。
     *   真壳路径的守卫在浏览器层：「逐开 82 入口后外壳仍完整」。
     * ============================================================ */
    /** 建栈（缺哪件补哪件，绝不触碰 screen 里已有的兄弟节点）。
     *   子节点顺序不影响视觉（两者都是 absolute 定位，back-button 走 z-index:40）。
     *   建栈后需要它的路径有两条：setContent（正常渲染）与 layerHost（给直接写宿主的 view 取图层）。 */
    _ensureViewStack() {
        if (!this.screen) return null;
        if (!this.screen.querySelector('.view-stack-container')) {
            const stackEl = document.createElement('div');
            stackEl.className = 'view-stack-container';
            stackEl.style.cssText = 'position:relative;width:100%;height:100%;';
            this.screen.appendChild(stackEl);
            if (!this.screen.querySelector('.phone-home-indicator')) {
                const indicatorEl = document.createElement('div');
                indicatorEl.className = 'phone-home-indicator';
                this.screen.appendChild(indicatorEl);
            }
            this.bindHomeIndicator();
        }
        return this.screen.querySelector('.view-stack-container');
    }
    /** 取某个图层的宿主节点（供 App 把内容写进图层而非 .phone-screen）。
     *   @param viewId  图层名（同 setContent 的 viewId）
     *   @param create  缺失时是否创建（默认 true）
     *   返回：图层元素；无栈且无 screen 时返回 null（调用方回退）。 */
    layerHost(viewId, { create = true } = {}) {
        const stack = this._ensureViewStack();
        if (!stack) return null;
        const id = String(viewId || '').trim();
        if (!id) return null;
        let layer = stack.querySelector(`[data-view-id="${id}"]`);
        if (!layer) {
            if (!create) return null;
            layer = document.createElement('div');
            layer.setAttribute('data-view-id', id);
            layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;overflow:hidden;border-radius:inherit;';
            stack.appendChild(layer);
        }
        /* 登记为当前层：否则这个图层不会被置顶（返回键不出现），且下一次 setContent
         *   的 GC 会因它不在 viewHistory 里而把它删掉。这里走的是与 setContent
         *   完全同一条实现（_applyViewLayerState）。 */
        this._applyViewLayerState(id);
        return layer;
    }
    /** 将某个图层登记为「当前层」：维护历史栈、Z-index/堆叠、孤儿图层回收、返回键可见性。
     *   这四件事原本只在 setContent 里做（第 2/6/7 步）；抽出来是因为
     *   「直接写图层宿主」的 App 也必须走同一套—— 否则它们写进去的图层不会被置顶（返回键不出现），
     *   且会在下一次 setContent 的 GC 里被当成孤儿删掉。 */
    _applyViewLayerState(viewId) {
        if (viewId === 'home') this.viewHistory = [];
        const existingIndex = this.viewHistory.findIndex(v => v.id === viewId);
        if (existingIndex !== -1) {
            this.viewHistory.splice(existingIndex + 1); // 后退：弹出顶部多余页面
        } else {
            this.viewHistory.push({ id: viewId }); // 前进：压入新页面
        }
        const stack = this.screen?.querySelector?.('.view-stack-container');
        if (stack) {
            const allViews = stack.querySelectorAll('[data-view-id]');
            allViews.forEach(v => {
                const id = v.getAttribute('data-view-id');
                const historyIndex = this.viewHistory.findIndex(item => item.id === id);
                if (id === viewId) {
                    v.className = 'phone-view-layer phone-view-current';
                    v.style.display = 'block';
                    v.style.zIndex = '10';
                    v.style.boxShadow = '-5px 0 20px rgba(0,0,0,0.15)';
                    v.style.transform = 'translate3d(0,0,0)';
                    v.style.transition = 'none';
                    v.style.opacity = '1';
                } else if (historyIndex === this.viewHistory.length - 2) {
                    v.className = 'phone-view-layer phone-view-prev';
                    v.style.display = 'block';
                    v.style.zIndex = '5';
                    v.style.boxShadow = 'none';
                    v.style.transform = 'translate3d(0,0,0)';
                    v.style.transition = 'none';
                    v.style.opacity = '1';
                } else {
                    v.className = 'phone-view-layer';
                    v.style.display = 'none';
                }
            });
            allViews.forEach(v => {
                const id = v.getAttribute('data-view-id');
                if (!this.viewHistory.find(item => item.id === id)) {
                    v.remove(); // 连同背景图缓存一起彻底销毁
                }
            });
        }
        window.VirtualPhone?.refreshGlobalTextColorStyle?.();
        window.VirtualPhone?.refreshGlobalFontScale?.();
        // [v3.56.0] 视图切换后同步返回键可见性（栈刚被改过，这里是唯一收口点）。
        this.syncBackButtonVisibility();
    }
    /* ============================================================
     * 当前 App / 内容宿主（唯一实现）
     * ------------------------------------------------------------
     * 为什么存在（真浏览器逐开 82 入口实测抓到的真缺陷）：
     *   全仓 **43 个 App 的 view** 写的是
     *     `const container = this.shell?.getContentContainer?.();`
     *     `if (!container) return;`
     *   而 `getContentContainer` 在本仓**根本没有定义**（全仓 grep 只命中 43 处调用点、零处定义）。
     *   于是那 43 个 App 点开后**什么都不渲染**：不报错、不崩溃、图层不出现，
     *   用户看到的是一个**点了没反应的图标**—— 正是本仓最贵的缺陷形态（静默失效）。
     *   为什么不把 43 处调用改成别的写法：那会产生 43 份各自取宿主的逻辑（必然漂移）；
     *   而「缺一个已被 43 处引用的方法」正好是一个单点：它本就是大家已经约定好的接口。
     *
     * 返回什么：**当前 App 的真图层**（而不是 `.phone-screen`）。
     *   回退顺序：① 当前 App 图层（创建）→ ② 已有的 `.phone-view-current`
     *   → ③ `screen`（无壳的单元测试场景）。
     *   ② 是为了让「已有当前层」的路径（例如已经走 setContent 渲染过的 App）
     *   不被新建一个空层抢走渲染位。
     * ============================================================ */
    /** 告诉壳「现在在哪个 App 里」（index.js 的 phone:openApp 咽喉点调）。
     *   不做其他任何事：历史栈 / Z-index / 回键都归 setContent（唯一收口点）。 */
    setCurrentApp(appId) {
        this.currentApp = (appId === undefined || appId === null) ? null : String(appId);
    }
    /** 当前 App 的内容宿主（供 view 写入）。无壳 / 无栈时返回 null（调用方自行退化）。 */
    getContentContainer() {
        if (!this.screen) return null;
        if (this.currentApp) {
            const host = this.layerHost('view-' + this.currentApp);
            if (host) return host;
        }
        const cur = this.screen.querySelector?.('.view-stack-container .phone-view-current');
        if (cur) return cur;
        return this.screen;
    }
    setContent(html, viewId = null) {
        if (!this.screen) return;
        this.syncHomeLayoutChromeClass();

        // 1. 自动推断 viewId
        if (!viewId) {
            if (/class=["'][^"']*\bhome-screen\b/i.test(html)) viewId = 'home';
            else if (/class=["'][^"']*\bsettings-app\b/i.test(html)) viewId = 'settings';
            else {
                const titleMatch = html.match(/class="wechat-header-title"[^>]*>([\s\S]*?)<\/div>/i);
                viewId = titleMatch ? 'view-' + titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'view-' + Math.random().toString(36).substr(2, 5);
            }
        }
        this._syncChromeThemeForView(viewId, html);

        // 2. 维护历史栈（唯一实现，见 _applyViewLayerState）
        this._applyViewLayerState(viewId);
        const stack = this.screen.querySelector('.view-stack-container');
        // 3. 获取或创建目标图层（与 layerHost 同一条建层实现）
        const targetView = this.layerHost(viewId, { create: true });
        if (!targetView) return;

        // 5. 终极 DOM Diffing：比对原始字符串，避免浏览器序列化导致的误判！
        const normalize = (str) => str.replace(/diary-view-enter/g, '').replace(/diary-view-exit/g, '').trim();
        const prevRawHtml = targetView.getAttribute('data-raw-html') || '';

        // 只有内容真正改变时才替换 HTML，彻底消灭 Base64 图片的重绘闪烁！
        if (normalize(prevRawHtml) !== normalize(html)) {
            targetView.innerHTML = html;
            // 存下原始生成的 HTML 字符串，作为指纹
            targetView.setAttribute('data-raw-html', html);
        }
        this._scopePhoneFormControls(targetView);

        // 6. 图层 Z-index / GC / 回键同步（唯一实现，见 _applyViewLayerState）
        window.VirtualPhone?.refreshGlobalTextColorStyle?.();
        window.VirtualPhone?.refreshGlobalFontScale?.();
        // [v3.56.0] 视图切换后同步返回键可见性（栈刚被改过，这里是唯一收口点）。
        this.syncBackButtonVisibility();
    }

    syncHomeLayoutChromeClass() {
        if (!this.container) return;
        const layout = String(window.VirtualPhone?.storage?.get?.('phone-home-layout') || 'icons');
        this.container.classList.toggle('phone-card-home-layout', layout === 'cards');
    }

    // 🔥 绑定 Home 指示器点击事件
    bindHomeIndicator() {
        const homeIndicator = this.screen?.querySelector('.phone-home-indicator');
        if (homeIndicator) {
            homeIndicator.style.cursor = 'pointer';
            homeIndicator.addEventListener('click', () => {
                if (this.isAtHomeScreen()) {
                    // 关闭抽屉
                    const drawerIcon = document.getElementById('phoneDrawerIcon');
                    const drawerPanel = document.getElementById('phone-panel');
                    if (drawerIcon && drawerPanel) {
                        drawerPanel.classList.remove('openDrawer', 'phone-panel-open', 'drawer-content', 'fillRight');
                        drawerPanel.classList.add('phone-panel-hidden');
                        drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                        window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
                    }
                } else {
                    this.goHome();
                }
            });
        }
    }
    
    showNotification(title, message, icon = '📱', meta = {}) {
        if (!this.container) return;

        // 提取发件人标识用于防刷屏
        const safeMeta = (meta && typeof meta === 'object') ? meta : {};
        const senderMatch = String(message || '').match(/^(.+?)\s*给你发了/);
        const senderKey = String(safeMeta.senderKey || (senderMatch ? senderMatch[1] : title));

        // 防刷屏1：如果队列中已经在等候这个人的通知，只更新文字内容
        const existingInQueue = this.notificationQueue.find(n => n.senderKey === senderKey);
        if (existingInQueue) {
            existingInQueue.message = message;
            existingInQueue.title = title;
            existingInQueue.meta = safeMeta;
            return;
        }

        // 防刷屏2：如果当前屏幕上正好在显示这个人的通知，直接热更新文字
        if (this.isShowingNotification && this.currentNotificationData?.senderKey === senderKey) {
            const targetContainer = this.container.querySelector('.phone-body-panel') || this.container;
            const currentTitleEl = targetContainer.querySelector('.phone-notification .notification-title');
            const currentMsgEl = targetContainer.querySelector('.phone-notification .notification-message');
            const currentTimeEl = targetContainer.querySelector('.phone-notification .notification-time');
            if (currentTitleEl) {
                currentTitleEl.textContent = String(safeMeta.name || title || '');
            }
            if (currentMsgEl) {
                currentMsgEl.textContent = String(safeMeta.content || message || '');
            }
            if (currentTimeEl) {
                currentTimeEl.textContent = String(safeMeta.timeText || '刚刚');
            }
            return;
        }

        // 推入队列并尝试处理
        this.notificationQueue.push({ title, message, icon, senderKey, meta: safeMeta });
        this.processNotificationQueue();
    }

    processNotificationQueue() {
        if (this.isShowingNotification || this.notificationQueue.length === 0) return;

        this.isShowingNotification = true;
        const data = this.notificationQueue.shift();
        this.currentNotificationData = data;

        // 将 emoji 图标映射为 FontAwesome 图标
        const iconMap = {
            '📱': 'fa-solid fa-mobile-screen',
            '💬': 'fa-solid fa-comment',
            '✅': 'fa-solid fa-check',
            '❌': 'fa-solid fa-xmark',
            '⚠️': 'fa-solid fa-triangle-exclamation',
            '🎵': 'fa-solid fa-music',
            '🌐': 'fa-solid fa-globe',
            '🚧': 'fa-solid fa-wrench',
            '📞': 'fa-solid fa-phone',
            '📵': 'fa-solid fa-phone-slash',
            '📹': 'fa-solid fa-video',
            '⏳': 'fa-solid fa-hourglass-half',
            '🔄': 'fa-solid fa-rotate',
            '📋': 'fa-solid fa-clipboard',
            '🏷️': 'fa-solid fa-tag',
            '📰': 'fa-solid fa-newspaper',
            '📍': 'fa-solid fa-location-dot',
            '🧧': 'fa-solid fa-envelope',
            '🗑️': 'fa-solid fa-trash',
        };
        const faClass = iconMap[data.icon] || 'fa-solid fa-bell';
        const iconHTML = `<i class="${faClass}"></i>`;
        const meta = data.meta || {};
        const useRichLayout = !!(meta.avatar || meta.avatarText || meta.name || meta.content || meta.timeText);

        const notification = document.createElement('div');
        notification.className = `phone-notification${useRichLayout ? ' phone-notification-rich' : ''}`;

        if (useRichLayout) {
            const isLikelyImagePath = (value) => /^(https?:\/\/|data:image\/|\/)/i.test(String(value || '').trim());

            const avatarEl = document.createElement('div');
            avatarEl.className = 'notification-avatar';
            if (meta.avatarBg) avatarEl.style.background = String(meta.avatarBg);
            if (meta.avatarColor) avatarEl.style.color = String(meta.avatarColor);

            const avatarRaw = String(meta.avatar || '').trim();
            if (avatarRaw && isLikelyImagePath(avatarRaw)) {
                const img = document.createElement('img');
                img.onerror = () => {
                    img.remove();
                    if (avatarEl.querySelector('.notification-avatar-text')) return;
                    const avatarText = document.createElement('span');
                    avatarText.className = 'notification-avatar-text';
                    avatarText.textContent = String(meta.avatarText || (meta.isGroup ? Array.from(String(meta.name || '').trim())[0] || '群' : (data.icon === '📱' ? '微' : '👤')));
                    avatarEl.appendChild(avatarText);
                    window.VirtualPhone?.wechatApp?.handleWechatAvatarImageError?.(img, avatarRaw);
                };
                img.src = avatarRaw;
                img.alt = String(meta.name || 'avatar');
                avatarEl.appendChild(img);
            } else {
                const avatarText = document.createElement('span');
                avatarText.className = 'notification-avatar-text';
                avatarText.textContent = avatarRaw || String(meta.avatarText || (meta.isGroup ? Array.from(String(meta.name || '').trim())[0] || '群' : (data.icon === '📱' ? '微' : '👤')));
                avatarEl.appendChild(avatarText);
            }

            const contentEl = document.createElement('div');
            contentEl.className = 'notification-content';

            const headerEl = document.createElement('div');
            headerEl.className = 'notification-header';

            const titleEl = document.createElement('div');
            titleEl.className = 'notification-title';
            titleEl.textContent = String(meta.name || data.title || '');

            const timeEl = document.createElement('div');
            timeEl.className = 'notification-time';
            timeEl.textContent = String(meta.timeText || '刚刚');

            const messageEl = document.createElement('div');
            messageEl.className = 'notification-message';
            messageEl.textContent = String(meta.content || data.message || '');

            headerEl.appendChild(titleEl);
            headerEl.appendChild(timeEl);
            contentEl.appendChild(headerEl);
            contentEl.appendChild(messageEl);
            notification.appendChild(avatarEl);
            notification.appendChild(contentEl);
        } else {
            notification.innerHTML = `
                <div class="notification-icon">${iconHTML}</div>
                <div class="notification-content">
                    <div class="notification-title">${data.title}</div>
                    <div class="notification-message">${data.message}</div>
                </div>
            `;
        }

        const phoneBody = this.container.querySelector('.phone-body-panel');
        const targetContainer = phoneBody || this.container;
        targetContainer.appendChild(notification);

        // [v2.17.0] 横幅交互：点击直达目标 App（真机语义）。
        //   appId 解析顺序：显式 meta.appId → senderKey/图标推断（复用落账层推断器）→ '__sys__'（仅收起）。
        //   点击即收起并复位队列状态，让下一条立即可弹（不必干等满 4 秒）。
        let _bannerDone = false;
        const dismissBanner = (viaUser = true) => {
            if (_bannerDone) return;
            _bannerDone = true;
            if (viaUser) {
                try {
                    const appId = String(data.meta?.appId || '') ||
                        String(window.VirtualPhone?.notificationLog?._guessAppId?.(data.senderKey || '', data.icon) || '__sys__');
                    if (typeof this.onBannerDismiss === 'function') {
                        try { this.onBannerDismiss(data); } catch (_e) { /* 忽略 */ }
                    }
                    if (appId && appId !== '__sys__' && typeof this.onBannerAction === 'function') {
                        try { this.onBannerAction(appId, data); } catch (_e) { /* 忽略 */ }
                    }
                } catch (_e) { /* 忽略 */ }
            }
            notification.classList.add('fade-out');
            setTimeout(() => {
                notification.remove();
                this.isShowingNotification = false;
                this.currentNotificationData = null;
                // 继续处理队列中的下一个通知
                this.processNotificationQueue();
            }, 300);
        };
        notification.classList.add('phone-notification-tappable');
        notification.addEventListener('click', () => dismissBanner(true));
        // [v2.17.0] 超时收起复用 dismissBanner(false)：不算用户点击（不跳转/不标已读），
        //   但同样复位队列状态，杜绝「点过之后状态残留」与「超时/点击双路径」两份实现漂移。
        setTimeout(() => dismissBanner(false), 4000);
    }
}
