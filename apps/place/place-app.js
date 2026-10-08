/* ========================================================
 * place-app.js — [v2.46.0] 地点图景 App 控制器
 *
 * 消费上游记忆插件的场所图景面（`window.lonsha_memory_bridge_v1.snapshot.scene`），
 * 把「人在哪儿 / 谁在这个地方 / 到访与覆盖」做成手机里可查询的界面，并把
 * 「本世界已登记的场所与在场」交给生成侧（GENERATE_BEFORE_COMBINE_PROMPTS）。
 *
 * 三条纪律（与 config/world-bridge.js 同规格，照抄其消费面先例）：
 *   ① 只读：只取桥的 snapshot（对象）/ refresh()，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无 scene 面 / 面缺席 / 快照畸形，一律降级为归因文案；
 *   ③ 不猜：拿不到就如实说拿不到（六态分开报），绝不编造地点或人数顶替。
 *
 * 【为什么不在实例里缓存读数】本 App 的读数**每次现取**：
 *   会话隔离靠 storage 的 `/^place_/` 键（设置），而场所面本身随会话变——
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据（本仓治理过多轮的形态）。
 *   故 onChatChanged() 只丢弃上一次的探针归因，不持有任何数据副本。
 * ======================================================== */
'use strict';
import { defaultPlaceSettings, readSceneFace, projectScene, scenePromptBlock } from './place-data.js';
import { PlaceView } from './place-view.js';
import { readPushProbe } from '../../config/world-bridge.js';
/* [v3.0.1] 投影契约的**归属面**（L-F5 的遗留观察项之一）。
 *   本 App 的数据面照旧读只读快照的场所面（`readSceneFace` 的三态归因一个字不动）——
 *   理由写死在 config/projection-contract.js 的 projectionScopeLine 文件头：
 *   上游投影只外供 6 项窄面，而本面要的是**整面场所树**，用投影替换数据源等于把
 *   跨仓稳定契约变成上游内部结构的镜像。故这里接的是**「这份读数是哪一次的」**这一面。 */
import { readProjection, projectionScopeLine } from '../../config/projection-contract.js';

/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^place_/`，否则跨会话串味 */
const SETTINGS_KEY = 'place_settings_v1';

export class PlaceApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new PlaceView(this);
        /** 最近一次探针归因（供诊断显示；不参与渲染数据） */
        this._lastProbe = null;
        this._hooked = false;
        this._initHook();
    }

    /* ========== 设置（随会话隔离，容错读写） ========== */
    getSettings() {
        try {
            const raw = this.storage?.get?.(SETTINGS_KEY, false);
            const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return { ...defaultPlaceSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return defaultPlaceSettings(); }
    }
    saveSettings(patch) {
        try {
            const next = { ...this.getSettings(), ...(patch || {}) };
            this.storage?.set?.(SETTINGS_KEY, JSON.stringify(next), false);
            return next;
        } catch (_e) { return this.getSettings(); }
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /**
     * 探针：把「桥在不在 / 有没有快照」取出来交给纯内核归因（本方法不做任何判断）。
     * 桥快照是**推**型（生成管线里 refresh 覆盖），故对象缺失时退而调 refresh()。
     * @returns {{mounted:boolean, hasSnapshot:boolean, snapshot:object|null}}
     */
    probeBridge() {
        const p = readPushProbe(this._win());
        return { mounted: p.mounted, hasSnapshot: p.hasSnapshot, snapshot: p.snapshot };
    }

    /** 来源归因（六态）：{state, reason, snapshot, text} */
    sceneFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readSceneFace(probe);
    }

    /**
     * 归属面（[v3.0.1]）：这份读数是**哪一次的**（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
     * 与数据面**分开取**：投影只回答「能不能用、是谁的」，不替换场所数据（见文件头导入注释）。
     * 不抛、结构恒定（拿不到就是「不可用 + 一行如实文案」）。
     */
    sourceFace() {
        try {
            return projectionScopeLine(readProjection(this._win()));
        } catch (_e) {
            return projectionScopeLine(null);
        }
    }

    /** 一次取齐「归因 + 五块投影 + 归属面」（视图用它，保证同一份读数上的三面同源） */
    projection() {
        const face = this.sceneFace();
        const proj = projectScene(face.snapshot, { maxEntries: 12 });
        return { face, proj, src: this.sourceFace() };
    }

    /** 一行总述（供视图/host 诊断；传入已取好的 pkg 可避免重复读桥） */
    summaryLineOf(pkg) {
        try {
            const face = pkg?.face, proj = pkg?.proj;
            if (!face) return '地点图景不可读（探针异常）';
            // 非 ready/empty 一律先报归因：此时投影里的 0 不是「没有场所」，而是「读不到」
            if (face.reason !== 'ready' && face.reason !== 'empty') return face.text;
            const n = (v) => (v === null || v === undefined) ? '—' : String(v);
            const s = proj?.scale || {};
            return `场所 ${n(s.nodes)} 处（细写 ${n(s.detailed)} / 最深 ${n(s.depth)} 层）`
                + ` · 到访 ${n(s.visits)} 处 · 在场 ${n(s.presence)} 人`
                + ` · ${proj?.invariants?.text || ''}`;
        } catch (_e) { return '地点图景总述失败（已降级）'; }
    }
    /** 便捷入口：自己取一次读数再总述 */
    summaryLine() { return this.summaryLineOf(this.projection()); }

    /**
     * 生成侧一致性块：把「本世界已登记的场所与在场」交给生成侧，
     * 让正文里的地点与记忆插件记的地点**是同一个**（无内容返回 ''，不产生空块）。
     */
    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const maxLines = Math.max(1, Number(s.maxInject) || 8);
            return scenePromptBlock(this.sceneFace().snapshot, { maxLines });
        } catch (_e) { return ''; }
    }

    /** 挂生成前钩子（构造期一次；宿主无 eventSource 时静默不挂，不影响 App 本体） */
    _initHook() {
        if (this._hooked) return;
        try {
            const ctx = this._win().SillyTavern?.getContext?.();
            const es = ctx?.eventSource;
            const et = ctx?.event_types;
            if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                // 注入失败绝不阻断生成：本块是「一致性约束」，不是必需上下文
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const block = this.promptBlock();
                    if (block) payload.prompt.push({ role: 'system', content: block });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hooked = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /**
     * 换会话 / 清数据：本 App **不持有任何读数副本**，故无需重绑数据层；
     * 仅丢弃上一次的探针归因（那是旧会话的读数），下一次渲染现取。
     */
    onChatChanged() {
        this._lastProbe = null;
    }

    render() {
        this.view.render(this.phoneShell?.layerHost?.('place-main') || this.phoneShell?.screen);
    }
}

export default PlaceApp;
