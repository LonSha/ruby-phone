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
import { readPushProbe } from '../../config/world-bridge.js';
/* [v3.0.1] 投影契约的**归属面**（L-F5 的遗留观察项之一）。
 *   数据面照旧读只读快照的角色状态表（`readCharsFace` 的三态归因一个字不动）；
 *   投影只补「这份读数是哪一次的」（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
 *   不替换数据源的理由见 config/projection-contract.js 的 projectionScopeLine 文件头。 */
import { readProjection, projectionScopeLine } from '../../config/projection-contract.js';
/* [v4.26.0 · R4-X5] 角色信息差与证词对照的接线件。
 *   为什么单开一件而不是塞进 chars-data.js：data 那件的立身之本是「快照角色状态表的投影」
 *   （纯函数、零 perspective 概念），而本面消费的是**另一条上游通路**
 *   （`LonShaMemory.perspectiveContrast` / `testimonyBoard`），且要「两路出口 + 模式闸 + 版式」。
 *   归因与口径**全部**转手 config/perspective-contrast-contract.js（同一口径只许一份实现）。 */
import { CharsPerspective } from './chars-perspective.js';
/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^chars_/`，否则跨会话串味 */
const SETTINGS_KEY = 'chars_settings_v1';
export class CharsApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new CharsView(this);
        /* [v4.26.0 · R4-X5] 信息差 / 证词对照接线件（只读；零写上游）。 */
        this.perspective = new CharsPerspective(this);
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
        const p = readPushProbe(this._win());
        return { mounted: p.mounted, hasSnapshot: p.hasSnapshot, snapshot: p.snapshot };
    }
    /** 来源归因（五态）：{state, reason, chars, text} */
    charsFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readCharsFace(probe);
    }
    /**
     * 归属面（[v3.0.1]）：这份读数是**哪一次的**（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
     * 只回答「能不能用、是谁的」，不替换数据面（见文件头导入注释）；不抛、结构恒定。
     */
    sourceFace() {
        try {
            return projectionScopeLine(readProjection(this._win()));
        } catch (_e) {
            return projectionScopeLine(null);
        }
    }
    /** 一次取齐「归因 + 投影 + 归属面」（视图用它，保证同一份读数上的三面同源） */
    projection() {
        const face = this.charsFace();
        const proj = projectChars(face.chars, { maxRoles: 50 });
        return { face, proj, src: this.sourceFace() };
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
                    /* [v4.26.0 · R4-X5] 模式闸下的信息差块。
                     *   ★ 角色模式：只写当前角色**可知**的格，对方独有的事实**一条都不进块**
                     *     （验收第 ③ 条「切换不把全知正文塞入角色生成上下文」的落点）；
                     *   ★ 模式非法 / 读数不 OK ⇒ promptBlock 返回 ''（不给块，不拿猜的模式喂全知正文）。 */
                    const pBlock = this.perspectivePromptBlock();
                    if (pBlock) payload.prompt.push({ role: 'system', content: pBlock });
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
        /* [v4.26.0 · R4-X5] 换会话作废视角现场（当前角色 / 身份视图）。
         *   ★ 模式**不**作废：它是随会话隔离的设置，不是读数；
         *   ★ 作废的是场景态 —— 否则上一会话选中的角色名会进新会话的角色模式生成块。 */
        try { this.perspective?.resetScene?.(); } catch (_e) { /* 不抛 */ }
    }
    /* ══════════ [v4.26.0 · R4-X5] 角色信息差与证词对照 ══════════
     * 【本段只做接线：归因 / 模式闸 / 身份面 / 版式全在 config/perspective-contrast-contract.js】
     * 【跨仓分工】去剧透与可知范围一律走上游口径（对比读数、identity 分面、四态三档全是上游给的），
     *   手机只搬不重算。本段**不判**哪个名字是真名，**不合成**信息差分数，**不以一票多数裁真相**。
     * 【三条「不做」原文】不再造知识权限规则、不新增好感度算法、不以一票多数裁真相。
     * ------------------------------------------------------------------ */
    /** 一次取齐「模式 + 对照 + 证词 + 版式」（视图用它，保证同一份读数上的四面同源）。 */
    perspectivePack(a, b, opts) { return this.perspective.pack(a, b, opts || {}); }
    /** 对照一行读数（视图借用；判定在内核 contrastLine）。 */
    perspectiveContrastLine(read) { return this.perspective.contrastLineOf(read); }
    /** 证词一行读数（视图借用；四态与未裁决三档在内核分列）。 */
    perspectiveTestimonyLine(read) { return this.perspective.testimonyLineOf(read); }
    /** 模式（**显式选择**；默认作者）。 */
    perspectiveMode() { return this.perspective.mode(); }
    /** 切模式（**只改呈现**，零写账）。 */
    setPerspectiveMode(mode) { return this.perspective.setMode(mode); }
    /** 换会话作废视角现场（当前角色 / 身份视图）；模式作为设置不作废。 */
    resetPerspectiveScene() { return this.perspective.resetScene(); }
    /** 模式取值清单（界面选项的唯一出处）。 */
    perspectiveModeIds() { return this.perspective.modeIds(); }
    /** 身份视图取值清单（界面选项的唯一出处）。 */
    perspectiveFaceIds() { return this.perspective.faceIds(); }
    /** 当前角色（角色模式下的「我」）。 */
    perspectiveCurrent() { return this.perspective.current(); }
    setPerspectiveCurrent(name) { return this.perspective.setCurrent(name); }
    /** 身份视图（未揭穿 / 已揭穿 / 全呈；默认未揭穿）。 */
    perspectiveFace() { return this.perspective.face(); }
    setPerspectiveFace(face) { return this.perspective.setFace(face); }
    /** 版式（窄屏逐人切换 / 宽屏并排）。 */
    perspectiveLayout(width) { return this.perspective.layout(width); }
    /**
     * 撤回一条证据 ⇒ 把上游重算后的争议状态摆出来。
     *   ★ 手机端**不发撤回**（撤回是上游控制面的动作）；本口只搬上游给的读数，
     *     故本方法**零写上游**、不产生新账（changed 以两侧都认得的状态为准，认不出不谎报）。
     */
    perspectiveRevoke(dropped, opts) { return this.perspective.revoke(dropped, opts || {}); }
    /**
     * 生成侧信息差块（模式闸下）。
     *   ★ 角色模式：对方独有的事实一条都不进块（验收第 ③ 条的语义落点）；
     *   ★ 模式非法 / 读数不 OK ⇒ ''（不给块）。
     */
    perspectivePromptBlock(a, b, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const read = (o.read && typeof o.read === 'object') ? o.read : this.perspective.contrast(a, b, o);
        return this.perspective.promptBlock(read, o);
    }
    render() {
        this.view.render(this.phoneShell?.layerHost?.('chars-main') || this.phoneShell?.screen);
    }
}
export default CharsApp;
