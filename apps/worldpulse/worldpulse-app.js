/**
 * worldpulse-app.js — [v2.9.0 原创缝合] 世界脉搏 App 控制器
 *
 * 楼层变化监听（eventSource MESSAGE_RECEIVED / 轮询兜底）→ 阈值触发 →
 * 队列化处理 → apiManager.callAI 生成平行事件 → 落 PhoneStorage 历史册 +
 * 可选推送为微博动态。视图提供开关/风格/阈值/手动脉冲/历史列表。
 */
'use strict';
import * as WP from './worldpulse-engine.js';
import { WorldpulseView } from './worldpulse-view.js';
// [v2.28.0] 实例级资源域（App 停止监听/换会话时一次性回收其登记的全部常驻资源）
import { childRuntime } from '../../config/runtime-lifecycle.js';
// [v2.35.0] 对外世界桥消费面（只读）：把「现编平行事件」换成「消费 WorldAxis 真世界状态」
import { readWorldAxisSnapshot, readLonshaSnapshot, readLonshaEventPlatforms, eventPlatformsLine, worldBridgeAvailability, bridgeReport } from '../../config/world-bridge.js';

const SETTINGS_KEY = 'worldpulse_settings_v1';   // 会话级（需注册 CHAT pattern）
const HISTORY_KEY = 'worldpulse_history_v1';
const STATE_KEY = 'worldpulse_state_v1';          // { lastFloorCount, queue }

// [v2.35.0] LLM 兜底路径的条目 id：与 WP.pushHistory 的原默认（`wp_${Date.now()}`）同形，
//   但显式在生成完成后取，避免「同一批多条」拿到同一个 id。真世界条目自带 `wa:` id，不走这里。
function entryId(ev) {
    return `wp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

export class WorldpulseApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new WorldpulseView(this);
        // [v2.28.0] 本 App 的常驻资源（兜底轮询）入实例域：stopListening 一次收净
        this._rt = childRuntime('worldpulse-app');
        this._listening = false;
        this._processing = false;
        this._unsub = null;
        this._pollTimer = null;
    }

    // ========== 设置/状态读写（容错） ==========
    getSettings() {
        try {
            const raw = this.storage?.get?.(SETTINGS_KEY, false);
            const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return { ...WP.defaultSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return WP.defaultSettings(); }
    }
    saveSettings(patch) {
        try {
            const next = { ...this.getSettings(), ...(patch || {}) };
            this.storage?.set?.(SETTINGS_KEY, JSON.stringify(next), false);
            return next;
        } catch (_e) { return this.getSettings(); }
    }
    getHistory() {
        try {
            const raw = this.storage?.get?.(HISTORY_KEY, false);
            const arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_e) { return []; }
    }
    _saveHistory(h) { try { this.storage?.set?.(HISTORY_KEY, JSON.stringify(h), false); } catch (_e) {} }
    getState() {
        try {
            const raw = this.storage?.get?.(STATE_KEY, false);
            const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return {
                lastFloorCount: Number(obj.lastFloorCount) || 0,
                queue: Array.isArray(obj.queue) ? obj.queue : []
            };
        } catch (_e) { return { lastFloorCount: 0, queue: [] }; }
    }
    _saveState(s) { try { this.storage?.set?.(STATE_KEY, JSON.stringify(s), false); } catch (_e) {} }

    // [v2.20.0] 当前会话身份戳：优先 chatMetadata.file_name，再退 chatId，最后空串。
    //   换会话（或清数据）后该值变化，用于丢弃迟到的异步生成结果。
    _currentSessionStamp() {
        try {
            const ctx = this._ctx();
            return String(ctx?.chatMetadata?.file_name || ctx?.chatId || '');
        } catch (_e) { return ''; }
    }
    _ctx() {
        try {
            return window.SillyTavern?.getContext?.() || window.parent?.SillyTavern?.getContext?.() || null;
        } catch (_e) { return null; }
    }
    _floorCount() {
        const ctx = this._ctx();
        return Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
    }

    // ========== 楼层监听（eventSource 优先，轮询兜底） ==========
    startListening() {
        // [v2.21.0] 先停后启：换会话重绑 / 重复调用时清理旧监听与轮询，
        //   避免 MESSAGE_RECEIVED 监听器与 setInterval 双重挂载。
        this.stopListening();
        this._listening = true;
        const ctx = this._ctx();
        // 初始化基线，避免启动即补一大段历史
        const st = this.getState();
        if (!st.lastFloorCount) { st.lastFloorCount = this._floorCount(); this._saveState(st); }

        // 优先：eventSource 消息事件
        try {
            if (ctx?.eventSource && ctx?.event_types?.MESSAGE_RECEIVED) {
                const handler = () => this._onFloorMaybeChanged();
                ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, handler);
                this._unsub = () => { try { ctx.eventSource.removeListener?.(ctx.event_types.MESSAGE_RECEIVED, handler); } catch (_e) {} };
            }
        } catch (_e) { this._unsub = null; }

        // 兜底：轮询（mobile 仓 checkInterval 同款思路，3s）
        // [v2.28.0] 入实例域（tag poll:），与 eventSource 订阅一起由 stopListening 收净
        if (!this._unsub) {
            this._rt.cancelByTag('poll:');
            this._rt.addInterval(() => this._onFloorMaybeChanged(), 3000, 'poll:floor');
        }
    }
    stopListening() {
        this._listening = false;
        try { this._unsub?.(); } catch (_e) {}
        this._unsub = null;
        // [v2.28.0] 兜底轮询由实例域统一回收（旧写法手写 clearInterval + 单字段清空）
        this._rt.cancelByTag('poll:');
        this._pollTimer = null;
    }

    // [v2.21.0] 换会话：实例跨会话复用（index.js 仅在首次打开时 new），
    //   旧监听闭包挂在旧上下文上、状态键按当前会话解析。
    //   此前 onChatChanged 清理清单漏掉 worldpulse：换会话后监听不求值，
    //   且新会话 lastFloorCount 基线为 0 会把「当前楼层-0」当作积压量误触发一次脉冲。
    //   此处在换会话时停旧监听、按新会话重建并重校基线。
    onChatChanged() {
        this.stopListening();
        if (this.getSettings().enabled) {
            const st = this.getState();
            // 基线重校：已是数值（含 0）都强制对齐到当前会话真实楼层，
            //   避免旧会话遗留的 lastFloorCount 造成负偏差或新会话空状态造成正偏差。
            st.lastFloorCount = this._floorCount();
            this._saveState(st);
            this.startListening();
        }
    }

    _onFloorMaybeChanged() {
        if (!this._listening || this._processing) return;
        const s = this.getSettings();
        if (!s.enabled || !s.autoGenerate) return;
        const st = this.getState();
        const cur = this._floorCount();
        if (WP.shouldTrigger(st.lastFloorCount, cur, s.threshold)) {
            st.queue = WP.enqueue(st.queue, {
                style: s.style, customPrefix: s.customPrefix, floorCount: cur
            }, s.maxQueueSize);
            st.lastFloorCount = cur;
            this._saveState(st);
            this._processQueue();
        }
    }

    // ========== 队列处理 → 生成 → 落地 ==========
    async _processQueue() {
        if (this._processing) return;
        const st = this.getState();
        if (!st.queue.length) return;
        this._processing = true;
        // [v2.20.0] 会话守卫：入口捕获本次处理链的会话身份（实例跨会话复用，
        //   必须在每次调用时取当前值，完成时比对，不一致即丢弃落地）。
        const stamp = this._currentSessionStamp();
        // [v2.21.0] 入口乐观出队：getState 与 _saveState 之间为同步区间（无 await），
        //   此刻必为发起会话——同步移除待处理事件有三重收益：
        //   ① 换会话后绝不误动新会话队列（修复前无条件出队会把新会话
        //      自己的待处理事件悄悄砍掉一条）；
        //   ② 旧会话队列同步清理，切回旧会话不会把已生成过的脉冲重复生成一遍；
        //   ③ 行为与处理成败解耦：尝试过即出队，杜绝失败堆积（v2.20 语义不变）。
        // [v2.85] 近场优先。远场只在近场空时才出一条，且只作背景，不抢主线。
        const split = WP.splitLayers(st.queue);
        const ev = split.near[0] || split.far[0];
        if (!ev) { this._processing = false; return; }
        st.queue = st.queue.filter((item) => item && item.id !== ev.id);
        this._saveState(st);
        try {
            const content = await this._generate(ev);
            // [v2.20.0] 生成完成时若已换会话：整条丢弃（不写历史/不推微博）。
            //   队列已在入口乐观出队（v2.21.0），此处不再触碰存储。
            if (content && stamp === this._currentSessionStamp()) {
                // [v2.35.0] 真世界路径返回的是**条目数组**（一次脉冲可落多条真动态），
                //   旧 LLM 路径返回单条字符串。两条都归一为数组处理，落地语义一致。
                const list = Array.isArray(content)
                    ? content
                    : [{ id: entryId(ev), style: ev.style, content, floorCount: ev.floorCount }];
                let h = this.getHistory();
                for (const it of list) {
                    if (!it || !it.content) continue;
                    if (it.source === 'worldaxis') {
                        // 真世界条目按 id 去重并入（不重复陈述同一条已落过的动态）
                        h = WP.mergeWorldAxisHistory(h, [it]);
                    } else {
                        h = WP.pushHistory(h, { id: it.id, style: it.style || ev.style, content: it.content, floorCount: it.floorCount ?? ev.floorCount });
                    }
                }
                this._saveHistory(h);
                // 可选：推送为微博动态（世界在手机里呼吸）。真世界只推第一条，避免刷屏。
                for (const it of list.slice(0, 1)) {
                    if (it && it.content) this._pushToWeibo(it.content, it.style || ev.style);
                }
            }
        } finally {
            this._processing = false;
            // 继续处理剩余（异步链）；换会话后不再续链（避免旧队列在新会话继续生成）
            const st3 = this.getState();
            if (st3.queue.length && stamp === this._currentSessionStamp()) {
                setTimeout(() => { if (stamp === this._currentSessionStamp()) this._processQueue(); }, 50);
            }
        }
    }

    async _generate(ev) {
        // [v2.35.0] **真世界优先**：先读 WorldAxis 的只读快照。有真事件就陈述真事件，
        //   不调 LLM（既不花钱，也不会编出与真世界矛盾的东西）。
        //   这正是本版要修的缺陷：修前本 App 的平行事件**全部由 LLM 现编**，
        //   与 WorldAxis 已经推演出的真世界状态毫无关联。
        const real = this._renderRealWorld(ev);
        if (real) return real;
        const am = window.VirtualPhone?.apiManager;
        if (!am || typeof am.callAI !== 'function') return null;
        const digest = WP.recentStoryDigest(this._ctx(), 6);
        // 真世界不可用时，若桥**在位但没开/没快照**，把归因块一并交给 LLM：
        //   让生成带着「本世界已有哪些真实动态」的约束，而不是完全凭空编。
        const consistency = this._worldAxisBlock();
        const layerNote = ev.layer === 'far'
            ? '\n\n【远场】这条只是背景呼吸，不得写成正在主线现场发生的事，不得让主角当场遭遇。'
            : '';
        const prompt = WP.buildEventPrompt(ev.style, ev.customPrefix, digest)
            + (consistency ? `\n\n${consistency}` : '')
            + layerNote;
        try {
            const result = await am.callAI([
                { role: 'system', content: '你是世界脉搏平行事件生成器。只输出事件正文。' },
                { role: 'user', content: prompt }
            ], { should_silence: true, max_chat_history: 0, appId: 'worldpulse' });
            const raw = (result && typeof result === 'object') ? (result.summary ?? result.content ?? '') : (result ?? '');
            if (result?.success === false) return null;
            return WP.sanitizeEvent(raw) || null;
        } catch (_e) { return null; }
    }

    /**
     * [v2.35.0] 真世界渲染：读桥 → 投影 → 落地条目。成功返回条目数组，否则 null。
     *   只读、不写世界状态；无真数据时返回 null 让调用方退回生成路径（不编数据顶替）。
     */
    _renderRealWorld(ev) {
        const s = this.getSettings();
        if (s.useRealWorld === false) return null;
        let r = null;
        try { r = readWorldAxisSnapshot({ reason: 'worldpulse-pulse' }); } catch (_e) { r = null; }
        if (!r || !r.ok) { this._lastRealReason = (r && r.reason) || 'read-failed'; return null; }
        let proj = null;
        try {
            proj = WP.projectWorldAxis(r.snapshot, {
                maxEntries: Math.max(1, Number(s.realWorldMax) || 6),
                existingIds: this.getHistory().map(h => String(h && h.id))
            });
        } catch (_e) { proj = null; }
        if (!proj || !proj.ok || !proj.entries.length) { this._lastRealReason = 'no-real-entries'; return null; }
        this._lastRealReason = 'ok';
        return proj.entries.map(e => ({ ...e, style: e.style, content: e.content }));
    }

    /** [v2.35.0] 真世界一致性约束块（供 LLM 兜底路径参考；无内容返回 ''） */
    _worldAxisBlock() {
        try {
            const r = readWorldAxisSnapshot({ reason: 'worldpulse-consistency' });
            if (!r || !r.ok) return '';
            return WP.worldAxisPromptBlock(r.snapshot, { maxEntries: 6, maxLen: 120 });
        } catch (_e) { return ''; }
    }

    /**
     * [v2.35.0] 桥的在场/来源一览（供视图与诊断；纯读）
     * [v2.36.0] 桥可观测面：除「在场」外再给出**读取归因**与**两个钟的对账**——
     *   此前这里只有在场一览，且本方法全库无人调用（零消费），于是「桥是不是通着」
     *   在界面上完全不可见。现在视图的桥卡片真的读它，诊断也能拿到一句话总述。
     */
    bridgeStatus() {
        /* [v3.5.0] F-2：除「桥通不通」外，再给一面「记忆侧的事件是谁记的」
         *   （上游 lonsha v3.233.0 的 eventPlatforms）。它与 WorldAxis 真世界状态**并列**，
         *   但答的是另一个问题：不是「世界现在什么样」，而是「这条线是插件从正文提的、
         *   还是手机 App 里发生的」——跨平台对照的事实前提，此前在这台设备上无据可查。
         *   三态由真源给出、**不在这里重判**（本仓 v2.97 的教训：7 份 probeBridge 各自为政）；
         *   缺席时如实带出 state，不写「0 个平台」。 */
        const epBlock = () => {
            try {
                const ep = readLonshaEventPlatforms();
                return {
                    state: ep.state, line: eventPlatformsLine(), platforms: ep.platforms,
                    platformCount: ep.platformCount, segments: ep.segments, truncated: ep.truncated
                };
            } catch (_e) { return null; }
        };
        try {
            const report = bridgeReport();
            return {
                bridges: worldBridgeAvailability(),
                report,
                summary: (report && report.summary) || '',
                lastRealReason: this._lastRealReason || null,
                eventPlatforms: epBlock()
            };
        } catch (_e) {
            try { return { bridges: worldBridgeAvailability(), report: null, summary: '', lastRealReason: this._lastRealReason || null, eventPlatforms: epBlock() }; }
            catch (_e2) { return { bridges: null, report: null, summary: '', lastRealReason: null, eventPlatforms: null }; }
        }
    }

    _pushToWeibo(content, style) {
        try {
            // [v2.20.0] 修复三重调用错误（此功能自 v2.9.0 起为死代码）：
            //   - weiboApp 的数据层属性名是 weiboData（不是 wechatData）
            //   - VirtualPhone.weiboData 从未被赋值（永远 undefined）
            //   - addRecommendPost 不存在，真实 API 是 saveRecommendPosts(数组)
            const weiboData = window.VirtualPhone?.weiboApp?.weiboData || null;
            if (!weiboData || typeof weiboData.getRecommendPosts !== 'function'
                || typeof weiboData.saveRecommendPosts !== 'function') return;
            const posts = weiboData.getRecommendPosts();
            const list = Array.isArray(posts) ? posts.slice() : [];
            // 格式对齐 _parseWeiboPost 产物（渲染字段：blogger/bloggerType/time/content/
            //   images/forward/comments/likes/commentList/likeList；详情的评论/点赞逻辑依赖这两个数组）
            list.push({
                id: `wp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                blogger: `世界脉搏·${style}`,
                bloggerType: '世界脉搏',
                time: new Date().toLocaleString('zh-CN', { hour12: false }),
                device: '平行世界',
                content: String(content),
                images: [],
                forward: 0,
                comments: 0,
                likes: 0,
                commentList: [],
                likeList: [],
                source: 'worldpulse'
            });
            weiboData.saveRecommendPosts(list);
            // 微博 App 在场时通知其刷新（推荐流标记更新）
            try { window.VirtualPhone?.weiboApp?.handleExternalRecommendUpdate?.(); } catch (_e) {}
        } catch (_e) {}
    }

    /** 手动触发一次脉冲（UI 按钮） */
    async manualPulse() {
        const s = this.getSettings();
        const st = this.getState();
        st.queue = WP.enqueue(st.queue, {
            style: s.style, customPrefix: s.customPrefix, manual: true, floorCount: this._floorCount()
        }, s.maxQueueSize);
        this._saveState(st);
        await this._processQueue();
        return this.getHistory();
    }

    clearHistory() { this._saveHistory([]); }

    render() {
        // 进入 App 时确保监听已启动
        if (this.getSettings().enabled) this.startListening();
        this.view.render();
    }

    destroy() {
        this.stopListening();
        // [v2.29.0] 域随 App 销毁一并注销（stopListening 只清条目、不注销登记表）。
        //   宿主侧实测从不写 disposeChildRuntimes('worldpulse-app')，故此前每次
        //   App 被重建都会多留一个空壳域，永久累加。
        this._rt.dispose();
    }
}

export default WorldpulseApp;