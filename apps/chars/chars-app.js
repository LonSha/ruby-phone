/* ========================================================
 * chars-app.js — [v2.51.0] 群像 App 控制器
 *
 * 消费上游记忆插件的角色状态表（`window.lonsha_memory_bridge_v1.snapshot.characters`），
 * 把「当前世界有哪些被追踪的角色、各自什么状态」做成手机里可查询的界面，并把
 * 「当前被追踪角色的关键状态」交给生成侧（GENERATE_BEFORE_COMBINE_PROMPTS）。
 *
 * 三条纪律（与 wallet-app.js / place-app.js 同规格，照抄其消费面先例）：
 *   ① 只读：只取桥的 snapshot（对象）/ refresh()，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无角色面 / 角色面畸形，一律降级为归因文案；
 *   ③ 不猜：拿不到就如实说拿不到（五态分开报），绝不编造角色状态顶替。
 *
 * 【为什么不在实例里缓存读数】本 App 的读数**每次现取**：
 *   会话隔离靠 storage 的 `/^chars_/` 键（设置），而角色状态本身随会话变——
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据（本仓治理过多轮的形态）。
 *   故 onChatChanged() 只丢弃上一次的探针归因，不持有任何数据副本。
 *
 * 【与档案 App 的边界】档案投影主角单人（snapshot.protagonist），群像投影除主角外
 *   被记忆插件追踪的多角色状态表（snapshot.characters）。两者互补、各取各的面，不重叠。
 * ======================================================== */
'use strict';
import { defaultCharsSettings, readCharsFace, projectChars, charsPromptBlock } from './chars-data.js';
import { CharsView } from './chars-view.js';
/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^chars_/`，否则跨会话串味 */
const SETTINGS_KEY = 'chars_settings_v1';
/** 上游桥的全局挂载名（与 lonsha_memory_bridge_v1 逐字一致，改一处即两边失联） */
const BRIDGE_ID = 'lonsha_memory_bridge_v1';
export class CharsApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new CharsView(this);
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
            return { ...defaultCharsSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return defaultCharsSettings(); }
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
        try {
            const w = this._win();
            const b = w && w[BRIDGE_ID];
            if (!b || typeof b !== 'object') return { mounted: false, hasSnapshot: false, snapshot: null };
            let snap = null;
            try { snap = (b.snapshot && typeof b.snapshot === 'object') ? b.snapshot : null; } catch (_e) { snap = null; }
            if (!snap && typeof b.refresh === 'function') {
                try { snap = b.refresh(); } catch (_e) { snap = null; }
            }
            const ok = !!(snap && typeof snap === 'object');
            return { mounted: true, hasSnapshot: ok, snapshot: ok ? snap : null };
        } catch (_e) {
            return { mounted: false, hasSnapshot: false, snapshot: null };
        }
    }
    /** 来源归因（五态）：{state, reason, chars, text} */
    charsFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readCharsFace(probe);
    }
    /** 一次取齐「归因 + 投影」（视图用它，保证同一次读数的脸与数据是同一份） */
    projection() {
        const face = this.charsFace();
        const proj = projectChars(face.chars, { maxRoles: 50 });
        return { face, proj };
    }
    /** 一行总述（供视图/host 诊断） */
    summaryLine() {
        try {
            const pkg = this.projection();
            const face = pkg.face, proj = pkg.proj;
            if (face.reason !== 'ready' && face.reason !== 'empty') return face.text;
            return `被追踪角色 ${proj.count} 个`;
        } catch (_e) { return '群像总述失败（已降级）'; }
    }
    /**
     * 生成侧一致性块：把「当前被追踪角色的关键状态」交给生成侧，
     * 让正文里这些角色的状态与记忆插件记的状态**是同一套**（无内容返回 ''，不产生空块）。
     */
    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const maxRoles = Math.max(1, Number(s.maxInject) || 5);
            return charsPromptBlock(this.charsFace().chars, { maxRoles });
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
        this.view.render(this.phoneShell?.screen);
    }
}
export default CharsApp;
