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
/* [v4.43.0 · R5-X3] 多人行踪时间带与会面证据（纯契约：只做读数与归一，不推算位置）。
 *   与既有 `presenceAt`（「此刻这个地点有谁」）**不是同一件事**：
 *   本件答的是「某个时间窗里这几个人各自在哪几段有据在场、谁和谁**可能**共处过」。 */
import {
  BAND_STATES, MEET_STATES, BAND_LIMITS,
  normalizeBand, coPresenceOf, buildPresenceBand, presenceBandLine, presenceBandSelfCheck
} from '../../config/presence-band-contract.js';
import { readPushProbe } from '../../config/world-bridge.js';
/* [v4.05.0 · R3-X9] 探索内核:清单 / 路径 / 地点卡 / 出行提案。
 *   本 App 只做三件事:①把已有几面数据**现取**出来交给内核;②把内核的话摆到界面上;
 *   ③把用户选中的那条提案**交给聊天**(派发 phone:sendToChat,与扭蛋 / 塔罗同一条通道)。
 *   **本层不移动角色、不写任何地点状态、不编距离** —— 走动只发生在正文里。 */
import { exploreList, buildRoute, normalizeRoamInputs, buildTravelProposal, roamSelfCheck } from '../../config/place-roam.js';
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

    /* ==================== [v4.05.0 · R3-X9] 地点探索与场景漫游 ====================
     * 【本段只做一件事】把**已经在别处存在**的几面数据现取出来,交给 config/place-roam.js 的纯内核。
     *   本 App 不回答「怎么走」,也不回答「去过没去过」—— 那些判定在核心里有判据、可单测。
     *
     * 【为什么往事与约定要去读约定账】R3-X9 的验收口径要求「从当前地点选目的地可带出已知线索」。
     *   线索有两类来源:本 App 自己的到访史(已有),以及**用户与角色约好的那些事**(在约定账里)。
     *   约定账的 owner 仍是 apps/calendar(config/commitment-flow.js),此处**只读镜像**,
     *   不写、不改、不重算它的状态 —— 不新开第二个 owner,这是本仓跨 App 复用的既定姿势。
     */

    /**
     * 往事与约定面:从约定账里取「注了地点」的条目。
     * **读不到(存储抛 / 结构不是账)返回 null** ⇒ 内核据此说「本面读不到」;
     * 读到但一条都没注地点 ⇒ 返回 [] ⇒ 内核说「这处还没有记下过的往事或约定」。
     * 两种处境处置相反(前者等接入,后者等剧情),故不得同形。
     * @returns {Array|null}
     */
    notesFace() {
        try {
            const raw = this.storage?.get?.('calendar_commitments', null);
            const parsed = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
            const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
            const out = [];
            for (const it of items) {
                if (!it || typeof it !== 'object') continue;
                const place = String(it.place || it.location || '').trim();
                if (!place) continue;
                out.push({
                    kind: String(it.status || '') === 'fulfilled' ? '往事' : '约定',
                    text: String(it.content || it.title || '').trim(),
                    place,
                    dateKey: String(it.dateKey || '').trim()
                });
            }
            return out;
        } catch (_e) { return null; }
    }
    /**
     * 探索输入面(内核的唯一入参形状)。
     * 面在不在**按读到没读到判**:读不到就不传这一项(内核据此报「这版读不到」),
     * 而不是传一个空数组 —— 空数组的意思是「有这面,只是空」,两者处置相反。
     */
    roamInputs() {
        const pkg = this.projection();
        const proj = (pkg && pkg.proj) || null;
        const ok = !!(proj && proj.ok);
        const raw = {
            tree: (ok && Array.isArray(proj.tree)) ? proj.tree : [],
            currentChain: (ok && Array.isArray(proj.current)) ? proj.current : []
        };
        if (ok && Array.isArray(proj.history)) raw.visits = proj.history;
        if (ok && Array.isArray(proj.presence)) raw.presence = proj.presence;
        const notes = this.notesFace();
        if (Array.isArray(notes)) raw.notes = notes;
        return normalizeRoamInputs(raw);
    }
    /* ========== [v4.43.0 · R5-X3] 多人行踪时间带与会面证据 ========== */
    /**
     * 把上游 scene 面的在场记录**翻成行踪片段**（本层只翻译形状，不推算位置）。
     *
     * 【★ 为什么没有 ref 的片段判「未知」而不是「在场」】上游给的在场记录若**没带出处**
     *   （`ref`），那这一段的正文**读不到** —— 把它当「有据在场」会让用户以为
     *   「他一直在那儿」，而其实只是没数据。故一律如实落 `unknown`（不画连续线）。
     * 【★ 为什么 conflictWith 单列】同一时段两处都报了是**数据冲突**，
     *   不是「同时在两处」—— 两者处置相反（前者要人去核，后者是超能力）。
     */
    bandCharsFromScene(names) {
        const want = Array.isArray(names) ? names.map((x) => String(x == null ? '' : x).trim()).filter(Boolean) : [];
        const out = [];
        let presence = null;
        let readOk = false;
        try {
            const pkg = this.projection();
            const proj = (pkg && pkg.proj) || null;
            /* ★ 只有「真读到在场面」才算读过：面缺席 / 抛错都算**没读到** ——
             *   那与「读了、确实没有片段」是两件事（后者才是「没行踪」）。 */
            if (proj && proj.ok && Array.isArray(proj.presence)) { presence = proj.presence; readOk = true; }
        } catch (_e) { presence = null; readOk = false; }
        for (const name of want) {
            const segs = readOk
                ? presence.filter((g) => String(g && g.name) === name).map(function (g) {
                    const e = (g && typeof g === 'object') ? g : {};
                    return {
                        from: String(e.from || ''), to: String(e.to || ''),
                        place: String(e.key || e.place || ''), ref: String(e.ref || ''),
                        conflictWith: String(e.conflictWith || ''),
                        absent: e.absent === true,
                        unread: e.unread === true || !String(e.ref || ''),
                    };
                })
                /* ★ 这一轮**没读到**在场面 ⇒ 如实给一条「未知」片段，
                 *   而不是给零片段（零片段会被读成「他没有任何行踪」——那是另一件事）。 */
                : [{ from: '', to: '', place: '', ref: '', conflictWith: '', absent: false, unread: true }];
            out.push({ id: name, name: name, segments: segs });
        }
        return out;
    }
    /** 一次取齐行踪带（**只读**：本层不判重叠，转交纯契约件）。 */
    presenceBand(names, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        try {
            return buildPresenceBand({
                chars: this.bandCharsFromScene(names),
                evidenced: o.evidenced === true,
            });
        } catch (_e) {
            return buildPresenceBand({ thrown: true });
        }
    }
    /** 行踪带一行读数（视图只排版）。 */
    presenceBandLineOf(face) {
        try { return presenceBandLine(face); }
        catch (_e) { return '行踪带：读不到'; }
    }
    /** 行踪契约件自检的**真消费点**（方法名与 import 不同名，防同类遮蔽）。 */
    presenceBandSelfCheck() {
        try { return presenceBandSelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], bandStates: 0, meetStates: 0 }; }
    }

    /** 探索清单(去过 / 待探索 / 可进入 / 未知)。不抛:异常一律降级为一行归因 */
    exploreFace() {
        try { return exploreList(this.roamInputs()); }
        catch (_e) { return { ok: false, state: 'error', reason: 'read-failed', items: [], readings: {} }; }
    }
    /** 从当前位置到某处的拓扑(不认识就是不认识:route=unknown,不编距离与耗时) */
    routeTo(target) {
        try { return buildRoute(this.roamInputs(), target); }
        catch (_e) { return null; }
    }
    /** 地点卡 + 出行提案文本(只生成话,不移动任何东西) */
    proposalOf(target) {
        try { return buildTravelProposal(this.roamInputs(), target); }
        catch (_e) { return { ok: false, reason: 'read-failed', text: '', lines: [], place: null }; }
    }
    /**
     * 把提案交给聊天 —— **这是「提案」二字的落地处**。
     * 本方法只把这段文本投进聊天输入框(与扭蛋 / 塔罗同一条 `phone:sendToChat` 通道),
     * 发不发送由宿主与用户决定;本方法**不改任何地点状态、不移动任何角色**。
     * @returns {{ok:boolean, reason:string, text:string}}
     */
    sendProposalToChat(target) {
        const p = this.proposalOf(target);
        const text = (p && p.text) || '';
        if (!p || !p.ok || !text) return { ok: false, reason: (p && p.reason) || 'no-proposal', text };
        try {
            const win = this._win();
            win.dispatchEvent(new win.CustomEvent('phone:sendToChat', { detail: { message: text } }));
            this.phoneShell?.showNotification?.('地点', '提案已放进聊天输入框(发送与否由你决定)', '🧭');
            return { ok: true, reason: 'ok', text };
        } catch (_e) { return { ok: false, reason: 'dispatch-failed', text }; }
    }
    /** 内核自检读数(诊断面用;拿不到时如实说拿不到,不假装通过) */
    roamProblems() {
        try { return roamSelfCheck(); }
        catch (_e) { return { ok: false, problems: ['self-check-failed'] }; }
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
