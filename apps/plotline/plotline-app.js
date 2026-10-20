/* ========================================================
 * plotline-app.js — [v2.49.0] 剧情线 App 控制器
 *
 * 消费上游记忆插件的大纲面（`window.lonsha_memory_bridge_v1.snapshot.outline`）
 * 与世界推进面（`snapshot.worldProg`：承诺/认知/支线），把「剧情走到哪一步了」
 * 「有哪些承诺还没兑现」「哪些支线还在推进」做成手机里可查询的界面，并把
 * 「当前阶段与未兑现承诺」交给生成侧（GENERATE_BEFORE_COMBINE_PROMPTS）。
 *
 * 三条纪律（与 place-app.js 同规格，照抄其消费面先例）：
 *   ① 只读：只取桥的 snapshot（对象）/ refresh()，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无剧情面 / 面畸形，一律降级为归因文案；
 *   ③ 不猜：拿不到就如实说拿不到（五态分开报），绝不编造阶段或承诺顶替。
 *
 * 【为什么不在实例里缓存读数】本 App 的读数**每次现取**：
 *   会话隔离靠 storage 的 `/^plotline_/` 键（设置），而剧情面本身随会话变——
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据（本仓治理过多轮的形态）。
 *   故 onChatChanged() 只丢弃上一次的探针归因，不持有任何数据副本。
 * ======================================================== */
'use strict';
import { defaultPlotlineSettings, readPlotlineFace, outlineStage, promiseList, arcList, knowledgeList, parallelList, secretList, recallEchoList, echoLifeList, plotlinePromptBlock, characterBoundary } from './plotline-data.js';
import { PlotlineView } from './plotline-view.js';
/* [v4.27.0 · R4-X6] 因果线索与未完事项板的**接线件**（取数 + 起点 + 落点形状）。
 *   本 App 只把它转手给视图，**不重判任何一格**；因果面本身的取数与归因全在
 *   config/causal-board-contract.js（纯契约件）里，与其它面同一个取法。 */
import { PlotlineBoard } from './plotline-board.js';
import { readPushProbe } from '../../config/world-bridge.js';
/* [v4.38.0 · R5-X2] 目标树契约（纯契约：只做读数与归一，不写任何事实）。
 *   本版按计划原文「先做计划编辑后接事实状态」落**纯计划模式**：
 *   勾选只表达用户计划，事实达成必须由证据/确认产生（两格分列）。 */
import {
  GT_STATES, GT_PLAN, GT_FACT, GT_BLOCK, GT_LIMITS,
  planGoalState, normalizeGoalNode, stepGateLine, planVsFactLine,
  goalTreeRows, goalTreeSelfCheck
} from '../../config/goal-tree-contract.js';
/* [v3.0.1] 投影契约的**归属面**（L-F5 的遗留观察项之一）。
 *   数据面照旧读只读快照的大纲面与世界推进面（`readPlotlineFace` 的三态归因一个字不动）；
 *   投影只补「这份读数是哪一次的」（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
 *   不替换数据源的理由见 config/projection-contract.js 的 projectionScopeLine 文件头。 */
import { readProjection, projectionScopeLine } from '../../config/projection-contract.js';
/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^plotline_/`，否则跨会话串味 */
const SETTINGS_KEY = 'plotline_settings_v1';
export class PlotlineApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new PlotlineView(this);
        /** [v4.27.0 · R4-X6] 因果板接线件（只持有「用户选了哪条线」，不持有读数） */
        this.board = new PlotlineBoard(this);
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
            return { ...defaultPlotlineSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return defaultPlotlineSettings(); }
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
    /** 来源归因（五态）：{state, reason, outline, worldProg, text} */
    plotlineFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readPlotlineFace(probe);
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
    /** 一次取齐「归因 + 四块投影 + 归属面」（视图用它，保证同一份读数上的三面同源） */
    projection() {
        const face = this.plotlineFace();
        const stage = outlineStage(face.outline);
        const promises = promiseList(face.worldProg);
        const arcs = arcList(face.worldProg);
        const knowledge = knowledgeList(face.worldProg);
        const parallels = parallelList(face.worldProg);
        const secrets = secretList(face.worldProg);
        const recallEchoes = recallEchoList(face.worldProg);
        const echoLives = echoLifeList(face.worldProg);
        /* [v3.10.0 · G-3] 每位角色的**认知边界性格面**：账里到底有没有他的认知记录。
         *   为什么必须在渲染包里带上它：`knowledgeList()` 只列「账里有什么」，
         *   读者看到某角色没有 `unaware` 条目时会自然读成「他知道」，
         *   而真实含义可能是「账里没记」——两者处置相反（前者可直接写，
         *   后者必须回避断言）。这一格就是把那个区别变得**可见**。 */
        const boundaries = (() => {
            try {
                return knowledge.map((k) => characterBoundary(knowledge, k.character));
            } catch (_e) { return []; }
        })();
        return { face, stage, promises, arcs, knowledge, boundaries, parallels, secrets, recallEchoes, echoLives, src: this.sourceFace() };
    }
    /** 一行总述（供视图/host 诊断） */
    summaryLine() {
        try {
            const pkg = this.projection();
            const face = pkg.face;
            if (face.reason !== 'ready' && face.reason !== 'empty') return face.text;
            return `阶段 ${pkg.stage.hasStage ? '1' : '0'} 个 · 承诺 ${pkg.promises.length} 条 · 支线 ${pkg.arcs.length} 条 · 认知角色 ${pkg.knowledge.length} 位`;
        } catch (_e) { return '剧情线总述失败（已降级）'; }
    }
    /**
     * 生成侧一致性块：把「当前阶段 + 未兑现承诺 + 推进中支线」交给生成侧，
     * 让正文里的剧情节奏与记忆插件推进的世界**是同一个**（无内容返回 ''，不产生空块）。
     */
    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const maxLines = Math.max(1, Number(s.maxInject) || 10);
            return plotlinePromptBlock(this.plotlineFace(), { maxLines });
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
    /* ========== [v4.27.0 · R4-X6] 因果线索与未完事项板（只转发，不重判） ========== */
    /**
     * 一次取齐「因果图 + 未解待办 + 追溯 + 候选边 + 三行读数 + 当前起点」。
     *   ★ 没选起点时追溯如实给 `no-subject` —— **不默认挑一条线**（那会把
     *     「用户没说要追哪条」伪装成「这条线没有源头」）。
     */
    boardPack(opts) {
        try { return this.board.pack(opts || {}); }
        catch (_e) { return this.board.pack({}); }
    }
    /** 当前追踪起点（空串 = 还没选） */
    boardFocus() {
        try { return this.board.focus; } catch (_e) { return ''; }
    }
    /** 设为要追的那条线（空值即清空，不回落成「默认第一条」） */
    setBoardFocus(id) {
        try { return this.board.setFocus(id); } catch (_e) { return ''; }
    }
    /**
     * 该去哪个 App（**声明式**：本出口不执行跳转，只把内核给的路由转出来）。
     *   为什么必须走这里：App 名映射只许有一份（内核的 CB_ACTIONS）——
     *   视图里再写一份，两处必然漂移，而漂移的那一天没人会响。
     */
    boardActionFor(kind) {
        try { return this.board.actionFor(kind); } catch (_e) { return null; }
    }
    /** 类别标签 / 收口标签（视图不写第二份标签表） */
    boardKindLabel(kind) {
        try { return this.board.kindLabel(kind); } catch (_e) { return String(kind == null ? '' : kind); }
    }
    boardClosureLabel(closure) {
        try { return this.board.closureLabel(closure); } catch (_e) { return String(closure == null ? '' : closure); }
    }
    /** 四收口 id 列表（视图的遍历顺序也**只有内核那一份**，不写第二份顺序表） */
    boardClosureIds() {
        try { return this.board.closureIds(); } catch (_e) { return []; }
    }
    /** 节点类别 id 列表（同上：界面选项的唯一出处是内核） */
    boardKindIds() {
        try { return this.board.kindIds(); } catch (_e) { return []; }
    }
    /**
     * 这一面能不能读 + 读不到时的处置建议（**判定词只许内核一份**）。
     *   视图拿这个出口决定「先报读不到」还是「画板子」，不自己比状态字面量 ——
     *   自己比就会在内核改名时静默走到「读到」那一支。
     */
    boardGate(read) {
        try { return this.board.gate(read); }
        catch (_e) { return { readable: false, hint: '因果板不可读' }; }
    }
    /** 追溯读数的一句说明（'' = 没有要说的） */
    boardTraceNote(read) {
        try { return this.board.traceNote(read); }
        catch (_e) { return ''; }
    }
    /* ========== [v4.38.0 · R5-X2] 目标树（纯计划模式） ========== */
    /**
     * 上游目标事实面在不在（**只判「有没有那口」**，不判数据）。
     *   严格判 `typeof === 'function'`（与因果板/物品卡同规）。
     */
    _goalPlugin() {
        const win = this._win();
        try { return win ? win.LonShaMemory : null; } catch (_e) { return null; }
    }
    /** 本会话的**目标树草稿**（只在本机；本 App 不写任何上游账）。 */
    goalDrafts() {
        if (!this._goalDraft || typeof this._goalDraft !== 'object') this._goalDraft = {};
        return this._goalDraft;
    }
    /**
     * 一条目标的读数（**只读**：本层不推算、不写事实）。
     *
     * 【计划与事实必须两格】`planDone` 来自用户勾选（本机草稿），`factState` 来自上游；
     *   合成一格就会出现「用户勾了一下，界面说这件事发生了」。
     *
     * @param {string} goal 目标名
     * @returns {{state:string, goal:string, gate:string, planVsFact:string, rows:Array, tree:object}}
     */
    goalNode(goal) {
        const name = String(goal == null ? '' : goal).trim();
        const plugin = this._goalPlugin();
        const hasFacts = !!(plugin && typeof plugin.goalFacts === 'function');
        const drafts = this.goalDrafts();
        const planDone = !!drafts[name];
        /* ★ 派发相的第二个入参必须是「**本机是否真有这条计划**」，不是「用户有没有打名字」。
         *   首版传 `!!name` ⇒ 只要打了名字就报 `planned`，于是
         *   「没打过草稿」与「有一条计划」被压成同一格 —— 用户看到「你在计划里还没勾」，
         *   而其实他**根本没建过这条计划**（两者处置相反）。真缺陷，本版当场修。 */
        const hasPlan = Object.prototype.hasOwnProperty.call(drafts, name);
        const phase = planGoalState(hasFacts, hasPlan);
        let recv = null;
        if (phase === GT_STATES.TRACKED) {
            try { recv = plugin.goalFacts(name) || null; }
            catch (_e) { recv = { thrown: true, goal: name }; }
        }
        const node = normalizeGoalNode(recv, { planDone: planDone, hasPlan: hasPlan });
        return {
            state: node.state, goal: node.goal || name, node: node,
            gate: stepGateLine(node), planVsFact: planVsFactLine(node),
            rows: goalTreeRows(node, {}).rows,
        };
    }
    /** 勾/取消勾（**只在本机**：勾选只表达计划，不写成事实）。 */
    goalPlanToggle(goal, done) {
        const name = String(goal == null ? '' : goal).trim();
        if (!name) return { ok: false, note: '先给这个目标起个名（空名勾不了）' };
        const d = this.goalDrafts();
        if (done === true) d[name] = true; else delete d[name];
        return {
            ok: true, planDone: done === true,
            note: done === true
                ? '已在**计划**里勾上「' + name + '」（只是你的计划：事实达成要由证据/确认产生）'
                : '已取消「' + name + '」的计划勾选（事实侧不受影响）',
        };
    }
    /** 计划里勾了几条（读数；不参与任何事实判定）。 */
    goalPlanCount() { return Object.keys(this.goalDrafts()).length; }
    /** 目标树自检的**真消费点**。 */
    goalTreeSelfCheck() {
        try { return goalTreeSelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], states: 0, blocks: 0 }; }
    }
    /** 一次取齐「当前目标读数 + 计划条数」（视图用它，保证同一份读数上两面同源）。 */
    goalPack(goal) {
        const one = this.goalNode(goal);
        return { one: one, planCount: this.goalPlanCount(), self: this.goalTreeSelfCheck() };
    }

    /**
     * 换会话 / 清数据：本 App **不持有任何读数副本**，故无需重绑数据层；
     * 仅丢弃上一次的探针归因（那是旧会话的读数），下一次渲染现取。
     */
    onChatChanged() {
        this._lastProbe = null;
        /* [v4.27.0 · R4-X6] 换会话也丢掉「上一次选了哪条线」：那是旧会话的选择，
         *   而因果图随会话变 —— 留着它会把新会话里一个同名的节点当成旧选择。 */
        try { this.board.resetScene(); } catch (_e) { /* 静默：换会话绝不能因接线件而报错 */ }
        /* [v4.38.0 · R5-X2] 目标树草稿同样是**本会话**现场：换会话整块丢掉。
         *   不丢的后果不是报错，而是把上一段勾过的计划画进新会话那一屏 ——
         *   用户以为这一段的剧情目标已经推进了（与追问轨迹/物品草稿同族）。 */
        this._goalDraft = {};
    }
    render() {
        this.view.render(this.phoneShell?.layerHost?.('plotline-main') || this.phoneShell?.screen);
    }
}
export default PlotlineApp;
