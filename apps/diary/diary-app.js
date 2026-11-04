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
        this._focusRefId = '';
    }

    /* ========== [v4.119.0 · R14-O3] 聚合页点回原条目：日记的跨 App 靶心 ==========
     * 【这个口要回答什么】「今天」里那一条日记、搜索里那一条命中 —— 点下去必须**落在那一篇上**，
     *   而不是只把日记 App 打开到封面。本仓此前日记源在引擎里连 `meta.ref` 都没有，
     *   `apps/clock/clock-view.js` 也只能诚实地写「打开日记」四个字。
     *
     * 【口径四条】（与 v3660 的 C1/C2 同一条验收线）
     *   ① 按 **id 现找**，不按下标：删中间一篇之后，剩下的两篇靶心一字不变
     *      （按 `date` / 下标实现的会在这里串项，而且不报错）；
     *   ② 找不到 ⇒ 如实 `{ok:false, reason:'not_found'}`，**不跳邻条、不假装成功**；
     *   ③ 命中 ⇒ 只**点亮详情态**（`currentEntryId` + `currentView='page'`），本函数不渲染
     *      —— 渲染由咽喉在投靶心之后统一做（顺序反了详情态画不出来，v3.65 已立此纪律）；
     *   ④ `clearRef` 把定位态真空掉（防「合上了但定位还在」）。
     */
    openRef(ref) {
        const id = String((ref && ref.id) || '').trim();
        if (!id) return { ok: false, reason: 'empty_id' };
        const data = this.diaryData;
        const entries = (data && typeof data.getEntries === 'function')
            ? (data.getEntries() || [])
            : ((data && Array.isArray(data.diaries)) ? data.diaries : []);
        const hit = entries.find(d => d && String(d.id || '') === id) || null;
        if (!hit) {
            /* 报出「看过多少条」，好把「空库」与「投错 id」分开 —— 两者处置相反。 */
            return { ok: false, reason: 'not_found', id: id, saw: entries.length };
        }
        this._focusRefId = id;
        const view = this.diaryView;
        if (view) {
            view.currentEntryId = id;
            view.currentView = 'page';
            view.settingsPanelOpen = false;
        }
        return { ok: true, id: id, saw: entries.length };
    }

    clearRef() {
        this._focusRefId = '';
        const view = this.diaryView;
        if (view && view.currentView === 'page') {
            view.currentEntryId = null;
            view.currentView = 'toc';
        }
        return { ok: true };
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
