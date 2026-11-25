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
// 微博APP - 主控制器
// ========================================
import { WeiboData } from './weibo-data.js';
import { WeiboView } from './weibo-view.js';
// [v2.28.0] 实例级资源域（App 内一次性轮询等常驻资源随实例回收）
import { childRuntime } from '../../config/runtime-lifecycle.js';

export class WeiboApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this._rt = childRuntime('weibo-app');

        // 预加载CSS，避免首次打开闪烁
        this._preloadCSS();

        // 初始化数据和视图
        this.weiboData = new WeiboData(storage);
        this.weiboView = new WeiboView(this);

        // 滑动返回防抖
        this._lastSwipeTime = 0;

        // 监听滑动返回事件
        this._swipeHandler = () => this.handleSwipeBack();
        window.addEventListener('phone:swipeBack', this._swipeHandler);
    }

    _preloadCSS() {
        if (document.getElementById('weibo-css')) return;
        const link = document.createElement('link');
        link.id = 'weibo-css';
        link.rel = 'stylesheet';
        link.href = new URL('./weibo.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
    }

    // ========================================
    // 🎯 主渲染入口
    // ========================================
    render() {
        /* [v4.203.0 · 修真缺陷] 原判据是 `if (cssLink && !cssLink.sheet)` ——「样式没就绪就先别渲染」。
         *   问题：`link.sheet` 在**跨源**时恒为 null（Chromium 规范行为，无 CORS 头不给 CSSOM）。
         *   本仓的 <link> 由 import.meta.url 拼成 http://127.0.0.1:<每次随机端口>/apps/weibo/weibo.css，
         *   端口变了就是跨源 —— 于是这条守卫**每次都为真**：注册一个 {once:true} 的 load 监听后 return，
         *   而 load 早在这一次调用之前就触发过了，监听器永远等不到第二次 load。
         *   结果不是「晚一点渲染」，是**整个渲染被静默吞掉**：
         *     实测（Chromium 131 / 390x844）第二次 render() 后 renderMs=0、domTitle 仍是旧值、
         *     资料卡不出现、底栏 opacity 读到 1 —— 看上去像「样式没生效」，其实是 DOM 根本没重绘。
         *   取舍：不拿「样式是否就绪」去 gate「是否渲染」。
         *     样式晚到只是短暂 FOUC（几十毫秒）；整页不渲染是功能消失。后者严重得多，
         *     所以先渲染，样式确认到位后再补一次（补渲染幂等，此时用户通常还没滚动）。
         *   [定案] 就绪判据换掉：不用 sheet（跨源不可靠），改用 load/error 事件落 dataset 标记 +
         *     resource timing 兜底（缓存命中时 load 可能早于本函数执行）。 */
        const cssLink = document.getElementById('weibo-css');
        this.weiboView.render();
        if (cssLink && cssLink.dataset.rpCssReady !== '1') {
            this._hookCssReady(cssLink);
        }
    }

    /* 样式就绪只用来「知道什么时候补一次渲染」，不用来决定要不要渲染。
     *   幂等：_cssHookBound 保证一生只挂一次监听，避免重复 addEventListener 累积。 */
    _hookCssReady(cssLink) {
        if (this._cssHookBound) return;
        this._cssHookBound = true;
        const markReady = (reRender) => {
            if (cssLink.dataset.rpCssReady === '1') return;
            cssLink.dataset.rpCssReady = '1';
            if (!reRender) return;
            try { this.weiboView.render(); } catch (_e) { /* 补渲染失败不掩盖首发渲染 */ }
        };
        cssLink.addEventListener('load', () => markReady(true), { once: true });
        /* error 也标 ready：否则样式永久加载失败时，每次 render 都会重新进这条分支，
         *   等于把「样式挂了」放大成「页面反复重建」。 */
        cssLink.addEventListener('error', () => markReady(false), { once: true });
        /* 缓存命中 / 监听挂晚了：load 不会再触发。resource timing 里 responseEnd>0 就是
         *   「这次请求确实下载完了」的证据，且跨源也能看到（不像 link.sheet）。 */
        try {
            const href = cssLink.href;
            const alreadyLoaded = href && performance.getEntriesByName(href).some((e) => e.responseEnd > 0);
            if (alreadyLoaded) markReady(true);
        } catch (_e) { /* performance 不可用时退回等 load */ }
    }

    handleExternalRecommendUpdate() {
        this.weiboView?.markExternalRecommendUpdated?.();
    }

    // ========================================
    // ↩️ 滑动返回处理
    // ========================================

    returnToWechatFromCard() {
        const source = this.weiboView.entrySource || {};
        const targetChatId = source.chatId || null;
        const targetChatName = source.chatName || '';

        // 清理微博详情状态，避免后续残留
        this.weiboView.entrySource = null;
        this.weiboView.currentPostId = null;
        this.weiboView.currentPostMode = null;
        this.weiboView.currentHotSearchTitle = null;
        this.weiboView.currentView = 'home';

        const getWechatCandidates = () => {
            const list = [
                window.currentWechatApp,
                window.ggp_currentWechatApp,
                window.VirtualPhone?.wechatApp
            ].filter(Boolean);
            return [...new Set(list)];
        };

        const restoreWechat = () => {
            const candidates = getWechatCandidates();
            if (candidates.length === 0) return false;

            for (const wechatApp of candidates) {
                const wechatData = wechatApp?.wechatData;
                if (!wechatData) continue;

                let targetChat = null;

                if (targetChatId && typeof wechatData.getChat === 'function') {
                    targetChat = wechatData.getChat(targetChatId);
                }

                if (!targetChat && targetChatName) {
                    const chats = typeof wechatData.getChatList === 'function' ? (wechatData.getChatList() || []) : [];
                    targetChat = chats.find(c => c && c.name === targetChatName) || null;
                }

                window.currentWechatApp = wechatApp;
                window.ggp_currentWechatApp = wechatApp;
                if (window.VirtualPhone) {
                    window.VirtualPhone.wechatApp = wechatApp;
                }

                if (targetChat) {
                    wechatApp.currentView = 'chats';
                    wechatApp.currentChat = targetChat;
                    wechatApp.render?.();
                    return true;
                }
            }
            return false;
        };

        // 优先复用现有实例，不存在时再全局打开微信
        if (restoreWechat()) return;

        window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
        // [v2.28.0] 有界轮询（最多 40 次 × 80ms）入实例域：两个出口都走 cancelByTag，
        //   旧写法两条 clearInterval 分支各写一次；且 App 被销毁时也会随域一并回收。
        let attempts = 0;
        this._rt.cancelByTag('weibo:open-wechat');
        this._rt.addInterval(() => {
            attempts++;
            if (restoreWechat() || attempts >= 40) {
                this._rt.cancelByTag('weibo:open-wechat');
            }
        }, 80, 'weibo:open-wechat');
    }

    handleSwipeBack() {
        // 检查微博APP是否可见
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.weibo-app')) return;

        // 防抖 400ms
        const now = Date.now();
        if (now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        this.weiboView.isBackNav = true;

        // 根据当前视图决定返回行为
        switch (this.weiboView.currentView) {
            case 'postDetail':
                this.weiboView.returnFromPostDetail?.(this.weiboView.currentPostMode);
                break;

            case 'hotSearchDetail':
                this.weiboView.currentView = 'home';
                this.weiboView.currentHotSearchTitle = null;
                this.weiboView.render();
                break;

            case 'settings':
                this.weiboView.currentView = 'home';
                this.weiboView.render();
                break;

            case 'hotSearchSettings':
                if (this.weiboView.currentHotSearchTitle) {
                    this.weiboView.currentView = 'hotSearchDetail';
                } else {
                    this.weiboView.currentView = 'home';
                }
                this.weiboView.render();
                break;

            case 'home':
            default:
                if (this.weiboView.entrySource?.appId === 'wechat') {
                    this.returnToWechatFromCard();
                    break;
                }
                // 在首页，返回手机主屏幕
                window.dispatchEvent(new CustomEvent('phone:goHome'));
                break;
        }

        // 防止幽灵点击
        const phoneScreen = document.querySelector('.phone-screen');
        if (phoneScreen) {
            phoneScreen.style.pointerEvents = 'none';
            setTimeout(() => {
                phoneScreen.style.pointerEvents = '';
            }, 400);
        }
    }

    // ========================================
    // 🔄 缓存管理
    // ========================================

    clearCache() {
        this.weiboData.clearCache();
        this.weiboView.currentView = 'home';
        this.weiboView.currentTab = 'hotSearch';
        this.weiboView.currentHotSearchTitle = null;
    }

    // ========================================
    // 🗑️ 销毁
    // ========================================

    destroy() {
        window.removeEventListener('phone:swipeBack', this._swipeHandler);
        // [v2.29.0] 域随 App 销毁一并注销。旧写法只解了 swipeHandler，域内登记的
        //   open-wechat 有界轮询与域本身都要靠宿主侧手写 disposeChildRuntimes，
        //   而手工清单漏一个就漏一个（sudoku/worldpulse 就是零出口的实例）。
        this._rt.cancelByTag('weibo:open-wechat');
        this._rt.dispose();
    }
}
