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
 * apps/bilibili/bili-app.js — B站 App 控制器（v4.160.0）
 * ------------------------------------------------------------
 * 这一层只做三件事，别的一律不下放：
 *   ① **装配**：拿宿主的 storage 建数据层，把 `this` 交给视图（视图只认
 *      `this.app.data`，换会话重建数据层后自动指向新数据）；
 *   ② **会话隔离**：`onChatChanged()` 里只重建数据层，**不重建实例**。
 *      实例是懒加载单例（index.js 的 `if (!window.VirtualPhone.bilibiliApp)`）——
 *      在 onChatChanged 里把槽位置 null，旧实例的构造期监听器就无人解绑，
 *      而 index.js 的 `ST_PHONE_REBIND_APP_KEYS` 又会再建一个，等于每次换会话
 *      多挂一个 MESSAGE_RECEIVED 监听（v2.24.0 判据点名的形态，这里不重犯）；
 *   ③ **AI 标签入库**：只在消息真带 `<Bilibili>…</Bilibili>` 时才动数据。
 *      解析不出内容就什么都不做 —— 不因为「聊天里出现 B站 两个字」就刷新，
 *      否则每聊一句首页内容就换一批，用户会把标签页当故障。
 *
 * 为什么昵称要在这里同步：数据层是纯存储层，读不到宿主上下文（它连 window
 * 都不直接摸）。`SillyTavern.getContext().name1` 是宿主给的角色称呼，属于
 * 「装配期信息」，由控制器写一次即可；用户之后在 App 里改名也不会被覆盖
 * （只在当前名字为空时才写）。
 * ============================================================ */
import { BiliData } from './bili-data.js';
import { BiliView } from './bili-view.js';

export class BiliApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.data = new BiliData(storage);
        this.view = new BiliView(this);
        this._aiListenerOn = false;
        this._syncUserName();
        this._initAiMessageListener();
    }

    /** 宿主窗口：控制器也可能在 node 单测里被 import，不能直接摸 window。 */
    _hostWin() {
        return (typeof window !== 'undefined' && window) ? window : null;
    }

    /** 把宿主的角色称呼写进 B站昵称（名字已存在就不动，不覆盖用户改过的）。 */
    _syncUserName() {
        try {
            if (!this.data || this.data.getUser().name) return;
            const w = this._hostWin();
            const st = w && w.SillyTavern;
            const ctx = st && typeof st.getContext === 'function' ? st.getContext() : null;
            const name = ctx && ctx.name1 ? String(ctx.name1).trim() : '';
            if (name) this.data.setUserName(name);
        } catch (_e) { /* 宿主没给上下文：昵称留空，界面显示「未设置昵称」 */ }
    }

    /**
     * 监听 AI 消息里的 `<Bilibili>{...}</Bilibili>` / `<Bili>{...}</Bili>`。
     * 只注册一次（单例 + 本标志位双保险），解析不到条目就不重绘。
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
                    if (!text || text.indexOf('<Bil') < 0) return;
                    const added = this.data.parseFromMessage(text);
                    if (!added || !added.length) return;
                    /* 只有在 App 已经画过一次（有容器）时才重绘：没打开过就不必
                     * 往隐藏图层里写 DOM。 */
                    if (this.view && this.view.container) this.render();
                } catch (err) {
                    console.warn('[BiliApp]AI 标签入库失败:', err && err.message);
                }
            });
            this._aiListenerOn = true;
        } catch (_e) { /* 宿主无事件总线：不监听，App 照常可用 */ }
    }

    /**
     * 换会话/清数据时重绑数据层（v2.24.0 纪律：保留实例与常驻监听器，
     * 仅重建数据层；视图经 `this.app.data` 动态引用，重建后自动指向新数据层）。
     */
    onChatChanged() {
        this.data = new BiliData(this.storage);
        this._syncUserName();
    }

    /** 渲染到本 App 的图层（壳里没有栈时退回 screen —— 这是门禁认可的显式写法）。 */
    render() {
        const host = this.phoneShell && typeof this.phoneShell.layerHost === 'function'
            ? this.phoneShell.layerHost('bilibili-main')
            : null;
        const container = host || (this.phoneShell ? this.phoneShell.screen : null);
        if (!container) return;
        this.view.render(container);
    }
}

export default BiliApp;