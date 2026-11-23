/* ========================================================
 * RubyPhone — SillyTavern 虚拟智能手机 UI
 * 作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
/* ============================================================
 * apps/tieba/tieba-app.js — 贴吧控制器（v4.161.0）
 * ------------------------------------------------------------
 * 只做三件事：
 *   ① 装配：拿宿主的 storage 建数据层，把 `this` 交给视图（视图只认
 *      `this.app.data`，换会话重建数据层后自动指向新数据）；
 *   ② 会话隔离：`onChatChanged()` 只重建数据层，**不重建实例**。实例是
 *      index.js 里的懒加载单例，在换会话时把槽位置 null 会让构造期注册的
 *      MESSAGE_RECEIVED 监听无人解绑，而 ST_PHONE_REBIND_APP_KEYS 又会再建一个
 *      —— 每换一次会话就多挂一个监听（v2.24.0 判据点名的形态，这里不重犯）；
 *   ③ 模型标签入库：只在消息真带 `<Tieba>` / `<Tie>` 时才动数据。解析不出帖子
 *      就什么都不做 —— 聊天里出现「贴吧」两个字不算内容更新。
 * ============================================================ */
import { TiebaData } from './tieba-data.js';
import { TiebaView } from './tieba-view.js';

export class TiebaApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.data = new TiebaData(storage);
        this.view = new TiebaView(this);
        this._aiListenerOn = false;
        this._initAiMessageListener();
    }

    /** 宿主窗口：控制器也会在 node 单测里被 import，不能直接摸 window。 */
    _hostWin() {
        return (typeof window !== 'undefined' && window) ? window : null;
    }

    /**
     * 监听 AI 消息里的 `<Tieba>{...}</Tieba>` / `<Tie>{...}</Tie>`。
     * 只注册一次（单例 + 标志位双保险）；解析不到帖子就不重绘。
     */
    _initAiMessageListener() {
        if (this._aiListenerOn) return;
        try {
            const w = this._hostWin();
            const st = w && w.SillyTavern;
            const ctx = st && typeof st.getContext === 'function' ? st.getContext() : null;
            const es = ctx && ctx.eventSource;
            const types = ctx && ctx.event_types;
            if (!es || !types || !types.MESSAGE_RECEIVED || typeof es.on !== 'function') return;
            es.on(types.MESSAGE_RECEIVED, (payload) => {
                try {
                    const text = payload && payload.message ? String(payload.message.mes || '') : '';
                    if (!text || text.indexOf('<Tie') < 0) return;
                    const added = this.data.parseFromMessage(text);
                    if (!added || !added.length) return;
                    /* 只有画过一次（有容器）才重绘：没打开过就不往隐藏图层里写 DOM。 */
                    if (this.view && this.view.container) this.render();
                } catch (err) {
                    console.warn('[TiebaApp] AI 标签入库失败:', err && err.message);
                }
            });
            this._aiListenerOn = true;
        } catch (_e) { /* 宿主无事件总线：不监听，App 照常可用 */ }
    }

    /**
     * 换会话：只重建数据层（视图经 `this.app.data` 动态引用，自动指向新数据）。
     */
    onChatChanged() {
        this.data = new TiebaData(this.storage);
    }

    /** 渲染到本 App 的图层（壳里没有栈时退回 screen —— 门禁认可的显式写法）。 */
    render() {
        const host = this.phoneShell && typeof this.phoneShell.layerHost === 'function'
            ? this.phoneShell.layerHost('tieba-main')
            : null;
        const container = host || (this.phoneShell ? this.phoneShell.screen : null);
        if (!container) return;
        this.view.render(container);
    }
}

export default TiebaApp;