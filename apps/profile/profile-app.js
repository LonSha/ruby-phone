/* ========================================================
 * profile-app.js — [v2.49.0] 档案 App 控制器
 *
 * 消费上游记忆插件的主角档案面（`window.lonsha_memory_bridge_v1.snapshot.protagonist`
 * 与 `snapshot.lifeDetails`），把「主角现在多大、什么身份」「生活里有哪些
 * 持续的小细节」做成手机里可查询的界面，并把「主角当前档案与生活细节」
 * 交给生成侧（GENERATE_BEFORE_COMBINE_PROMPTS）。
 *
 * 三条纪律（与 place-app.js 同规格，照抄其消费面先例）：
 *   ① 只读：只取桥的 snapshot（对象）/ refresh()，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无档案面 / 档案畸形，一律降级为归因文案；
 *   ③ 不猜：拿不到就如实说拿不到（五态分开报），绝不编造主角信息顶替。
 *
 * 【为什么不在实例里缓存读数】本 App 的读数**每次现取**：
 *   会话隔离靠 storage 的 `/^profile_/` 键（设置），而档案面本身随会话变——
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据（本仓治理过多轮的形态）。
 *   故 onChatChanged() 只丢弃上一次的探针归因，不持有任何数据副本。
 * ======================================================== */
'use strict';
import { defaultProfileSettings, readProfileFace, protagonistFields, lifeDetailsGroups, profilePromptBlock } from './profile-data.js';
import { ProfileView } from './profile-view.js';
import { readPushProbe } from '../../config/world-bridge.js';
/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^profile_/`，否则跨会话串味 */
const SETTINGS_KEY = 'profile_settings_v1';
export class ProfileApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new ProfileView(this);
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
            return { ...defaultProfileSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return defaultProfileSettings(); }
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
    /** 来源归因（五态）：{state, reason, protagonist, lifeDetails, text} */
    profileFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readProfileFace(probe);
    }
    /** 一次取齐「归因 + 两块投影」（视图用它，保证同一次读数的脸与数据是同一份） */
    projection() {
        const face = this.profileFace();
        const fields = protagonistFields(face.protagonist);
        const groups = lifeDetailsGroups(face.lifeDetails);
        return { face, fields, groups };
    }
    /** 一行总述（供视图/host 诊断） */
    summaryLine() {
        try {
            const pkg = this.projection();
            const face = pkg.face;
            if (face.reason !== 'ready' && face.reason !== 'empty') return face.text;
            return `主角字段 ${pkg.fields.length} 项 · 生活细节 ${pkg.groups.total} 条`;
        } catch (_e) { return '档案总述失败（已降级）'; }
    }
    /**
     * 生成侧一致性块：把「主角档案 + 生活细节」交给生成侧，
     * 让正文里的主角与记忆插件记的主角**是同一个**（无内容返回 ''，不产生空块）。
     */
    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const maxLines = Math.max(1, Number(s.maxInject) || 8);
            return profilePromptBlock(this.profileFace(), { maxLines });
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
export default ProfileApp;
