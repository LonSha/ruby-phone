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
/* [v4.99.2 · R11-X1] 人物档案面桥接件（背包 / 档案 / 卷宗三面合并读）。
 *   纪律与 X6 的 notification-hub-bridge 同款：本 App 只经桥读中枢实例、
 *   视图不 import 桥、不引用 subsystems（F 类判据用正则钉住）。
 *   持久化走各数据主自己的 serialize/restore，写键已在 keys-audit 登记。 */
import { mergeArchiveFaces } from '../../config/archive-face-bridge.js';
/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^chars_/`，否则跨会话串味 */
const SETTINGS_KEY = 'chars_settings_v1';
/** [v4.99.2 · R11-X1] 档案三件的落盘键（与 keys-audit 登记逐字一致；写口仅 _archiveSaveAll） */
const ARCHIVE_KEYS = {
    backpack: 'ibp_inventory_backpack_v1',
    dossiers: 'cds_character_dossier_v1',
    volumes: 'vch_volume_chronicle_v1'
};
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

    /* ══════════ [v4.99.2 · R11-X1] 人物档案面（背包 / 档案 / 卷宗） ══════════
     * 【接线模板对齐 X6】中枢实例挂在 window.VirtualPhone.subsystems
     *   （index.js:2048 装配）；本 App 只经 mergeArchiveFaces 纯读合并呈现。
     * 【持久化】三件管理器的 serialize/restore 是它们自己的契约；本 App 的写口
     *   只有 _archiveSaveAll（一次写齐三键）与 _archiveRestoreAll（一次读回），
     *   均挂在本 App（数据主不含 storage —— 它们零依赖纯内存类）。
     * 【不造第二份真源】中枢的 Map 是唯一活实例；本 App 从不缓存行数组，
     *   每次渲染现取（与群像主面的「现取不缓存」纪律同款）。 */

    /** 中枢实例解析：{ ok, why, hub }（能力探测三面管理器在场） */
    _resolveArchiveHub() {
        try {
            const win = this._win();
            const host = (win && win.VirtualPhone) || null;
            const hub = (host && host.subsystems) || null;
            if (!hub) return { ok: false, why: 'no_host', hub: null };
            if (!hub.backpack || !hub.dossiers || !hub.volumes) return { ok: false, why: 'no_subsystems', hub };
            return { ok: true, why: 'ok', hub };
        } catch (_e) {
            return { ok: false, why: 'read_threw', hub: null };
        }
    }

    /** 档案三面合并读（视图唯一入口；中枢缺席时 faces 全 null + mustShowWhy） */
    archiveFace(opts) {
        const r = this._resolveArchiveHub();
        if (!r.ok) {
            return { faces: { backpack: null, dossiers: null, volumes: null },
                     counts: { backpack: 0, dossiers: 0, volumes: 0 },
                     notes: { why: r.why, mustShowWhy: true } };
        }
        return mergeArchiveFaces(r.hub, opts);
    }

    /** 三件一次落盘（写口收敛为一处；失败不抛、返回 false） */
    _archiveSaveAll() {
        const r = this._resolveArchiveHub();
        if (!r.ok) return false;
        try {
            this.storage?.set?.(ARCHIVE_KEYS.backpack, JSON.stringify(r.hub.backpack.serialize()));
            this.storage?.set?.(ARCHIVE_KEYS.dossiers, JSON.stringify(r.hub.dossiers.serialize()));
            this.storage?.set?.(ARCHIVE_KEYS.volumes, JSON.stringify(r.hub.volumes.serialize()));
            return true;
        } catch (_e) { return false; }
    }

    /** 三件一次读回（会话切换 / 冷启后由视图触发；无存档时保持空态） */
    _archiveRestoreAll() {
        const r = this._resolveArchiveHub();
        if (!r.ok) return false;
        try {
            const readJson = (key) => {
                const raw = this.storage?.get?.(key, null);
                if (raw === null || raw === undefined || raw === '') return null;
                try { return JSON.parse(raw); } catch (_e) { return null; }
            };
            r.hub.backpack.restore(readJson(ARCHIVE_KEYS.backpack));
            r.hub.dossiers.restore(readJson(ARCHIVE_KEYS.dossiers));
            r.hub.volumes.restore(readJson(ARCHIVE_KEYS.volumes));
            return true;
        } catch (_e) { return false; }
    }

    /* ---------- 用户可操作点（计划要求：背包可增减、档案可标注、卷宗可查询） ---------- */

    /** 录入物品（背包）→ 落盘 → 返回登记后的物品（失败抛原错，视图转归因文案） */
    archiveRegisterItem(item) {
        const r = this._resolveArchiveHub();
        if (!r.ok) throw new Error('档案中枢不可用（' + r.why + '）');
        const rec = r.hub.backpack.registerItem(item);
        this._archiveSaveAll();
        return rec;
    }

    /** 转赠物品（背包）→ 落盘 */
    archiveTransferItem(itemId, newOwner, reason) {
        const r = this._resolveArchiveHub();
        if (!r.ok) throw new Error('档案中枢不可用（' + r.why + '）');
        const rec = r.hub.backpack.transferItem(itemId, newOwner, reason || '');
        this._archiveSaveAll();
        return rec;
    }

    /** 标注物品状态：消耗 / 遗失（背包）→ 落盘 */
    archiveChangeItemStatus(itemId, status, note) {
        const r = this._resolveArchiveHub();
        if (!r.ok) throw new Error('档案中枢不可用（' + r.why + '）');
        const rec = r.hub.backpack.changeStatus(itemId, status, note || '');
        this._archiveSaveAll();
        return rec;
    }

    /** 录入 / 更新角色档案（档案）→ 落盘 */
    archiveUpsertDossier(data) {
        const r = this._resolveArchiveHub();
        if (!r.ok) throw new Error('档案中枢不可用（' + r.why + '）');
        const rec = r.hub.dossiers.upsertDossier(data);
        this._archiveSaveAll();
        return rec;
    }

    /** 标注性格偏移（档案）→ 落盘 */
    archiveRecordShift(name, shift) {
        const r = this._resolveArchiveHub();
        if (!r.ok) throw new Error('档案中枢不可用（' + r.why + '）');
        const rec = r.hub.dossiers.recordPersonalityShift(name, shift);
        this._archiveSaveAll();
        return rec;
    }

    /** 按名取完整档案卡（档案；读口，无写） */
    archiveGetDossier(name) {
        const r = this._resolveArchiveHub();
        if (!r.ok) return null;
        try { return r.hub.dossiers.getDossier(name); } catch (_e) { return null; }
    }

    /** 按卷号取卷宗详情（卷宗；读口，无写） */
    archiveGetVolume(index) {
        const r = this._resolveArchiveHub();
        if (!r.ok) return null;
        try { return r.hub.volumes.getVolume(index); } catch (_e) { return null; }
    }
}
export default CharsApp;
