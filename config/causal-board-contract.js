/* ============================================================
 * causal-board-contract.js — [v4.27.0 · 第四期 R4-X6]
 *   「可操作的线索与未完事项板」纯契约件
 *
 * 【计划原文（R4-X6）】
 *   「按人物/地点查看未结约定、伏笔和因果线；选『追这条线』打开相关聊天或地点，
 *     避免只看计数。」
 *   落点与依赖：plotline 增列表/详情，**不新造无限画布**；读既有
 *     causal-chain / commitment / seed；行动用原 App owner，依赖 R4-O1，
 *     完成状态仍由剧情事实决定。
 *   验收四条：① 一条未结约定、一条已解决伏笔、一条仅推测因果**同屏可区分**；
 *     ② 点击回源和去行动均到正确对象；③ 选择追踪**不自动标已解决**；
 *     ④ 重新生成后视图跟随有效证据。
 *   不做三条：不扩大 MAX_OPEN、不增加第二套任务事实库、不把「提醒过」当「履约」。
 *
 * 【修前实测的缺口（读码可复算）】
 *   上游 `causalChain` 面（v3.323.0）**已在 13 面外供表里**，出口齐全
 *   （`causalChainGraph` / `causalChainTodos` / `causalChainTrace` / `causalChainProposals`），
 *   而本仓 `grep -rn 'causalChain' apps/ config/` 的命中**全部落在别的语义上**
 *   （`plotline-data.js` 的 knowledgeFace / worldProg 投影与 registry 的登记行），
 *   手机侧**零消费**这条通路。后果三件，都不是报错：
 *     ① 未结约定 / 已解决伏笔 / 仅推测因果在界面上**同形**（都是「一条记录」）——
 *        而三者处置相反：第一条要去做，第二条不必再提，第三条**不能当事实**；
 *     ② 「追这条线」无从谈起：没有从某结果向上游追溯的读数，只有计数；
 *     ③ 重新生成后视图画的是**上一次**的证据面（不跟随）。
 *
 * 【本件只做四件事（不重算任何上游判定）】
 *   1 **取数**：从只读桥取因果图 / 未解待办 / 追溯 / 候选边四路读数；
 *   2 **分列**：四收口（未收口 / 已完成 / 已作废 / 已违约）与推测边**结构上分开**；
 *   3 **回源凭证**：每条节点带回上游给的 `ref`（原样搬，不自己拼 id）；
 *   4 **行动路由**：按节点类别给出「该去哪个 App」的**声明**（不在本件执行跳转）。
 *
 * 【边界（如实登记，不装）】
 *   · 本件**不判**哪条线更重要（不排序、不评分、不给置信度）；
 *   · 本件**不把推测边当已确认**（上游分两个数组，本件照搬，不合并）；
 *   · 本件**不替用户标已解决**（零写面：`writesNothing` 恒 true）；
 *   · 上游不在就如实报缺席，**不退回本地猜一份因果**。
 * ============================================================ */
'use strict';
/* ★ 数值取值门走**全仓唯一实现**（config/num-gate.js），不在本文件就地再写一份。 */
import { numOrNull as floorOrNull } from './num-gate.js';
/** 上游插件全局名（与其它契约模块读的是同一个） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游因果链模块全局名（模块路） */
const CAUSAL_MODULE_GLOBAL = 'LonShaCausalChain';
/** 上游面 id（与上游 open_face_registry.tsv / 本仓 crossrepo-registry.js 同一口径） */
export const CB_FACE_ID = 'causalChain';
/** 六态（缺席 / 不在场 / 读不出 / 没给看谁 / 真读数空 / 好） */
export const CB_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    NO_SUBJECT: 'no-subject',
    EMPTY: 'empty',
    OK: 'ok'
});
/** 七个归因词（两个同形即失败） */
export const CB_REASONS = Object.freeze({
    ok: '线索与未完事项就绪',
    'no-subject': '没给要追的那条线（追溯至少要一个起点）',
    'engine-absent': '记忆插件未装或未加载（等装插件）',
    'face-absent': '插件在场但这版没有因果面（需插件 v3.323.0+）',
    unusable: '出口在但读不出或形态不对（本机读不出，不是这条线本来就没有）',
    empty: '真跑过、没有可对照的内容（**不是**「故事里没有任何线索」）',
    'not-in-graph': '这个起点不在图里（**不是**「它已经追到头了」）'
});
/**
 * 节点类别（上游三账 + 笔记，**逐字沿上游 `toNodes()` 的 kind**）。
 *   `seed` 伏笔 / `commitment` 约定 / `event` 事件 / `note` 笔记。
 *   ★ 四类**分列**：合成一格就分不出「这条是要去赴的约」与「这条是埋下的伏笔」。
 */
export const CB_NODE_KINDS = Object.freeze(['seed', 'commitment', 'event', 'note']);
/** 节点类别人读字样（**只做人读**；判定不读它） */
export const CB_KIND_LABEL = Object.freeze({
    seed: '伏笔',
    commitment: '约定',
    event: '事件',
    note: '笔记'
});
/**
 * 四收口（上游 `build()` 把节点按 closure 分四个数组）。
 *   ★ 必须分列：合成一格就说不出「这条不用再提了」与「这条还没做」的区别。
 */
export const CB_CLOSURE = Object.freeze(['unresolved', 'resolved', 'cancelled', 'broken']);
/** 收口人读字样 */
export const CB_CLOSURE_LABEL = Object.freeze({
    unresolved: '未收口',
    resolved: '已完成',
    cancelled: '已作废',
    broken: '已违约'
});
/**
 * 边依据三态（上游 `normEdge()` 的 basis）。
 *   ★ `speculative` **结构上与已确认分开**（上游给的是两个数组）：
 *     本件照搬两个数组，**不合并、不排序到一起** ——
 *     「猜测」与「事实」混进同一个列表，就是本仓反复治理的「把误信写成世界真相」。
 */
export const CB_EDGE_BASES = Object.freeze(['evidence', 'user-confirmed', 'speculative']);
/** 行动路由（**声明式**：只说该去哪个 App 的哪个出口，本件不执行跳转、不写任何状态） */
export const CB_ACTIONS = Object.freeze({
    commitment: { app: 'calendar', label: '去日程看这条约定' },
    seed: { app: 'plotline', label: '去剧情线看这条伏笔' },
    event: { app: 'memory', label: '去记忆看这条事件' },
    note: { app: 'plotline', label: '去剧情线看这条笔记' }
});
/**
 * 读数里**不得出现**的键名（分数 / 置信度 / 优先级一族）。
 *   与上游「不评分、不排名」同一禁令；本件把它变成对自己读数的一次深度扫描（自检里真跑）。
 */
export const CB_FORBIDDEN_KEYS = Object.freeze([
    'percent', 'percentage', 'confidence', 'score', 'probability', 'weight', 'index', 'rank', 'priority'
]);
/** 上限（冻结）：**沿上游既有上限，不新造第二套**（「不扩大 MAX_OPEN」的落点） */
export const CB_LIMITS = Object.freeze({
    /** 与上游 causal-chain.js 的 MAX_NODES 同量级（上游默认 200，本件呈现面收得更紧） */
    nodes: 80,
    edges: 120,
    label: 160,
    reason: 160
});
function str(v) { return String(v == null ? '' : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object') ? v : null; }
/** 宿主窗口（注入优先，回落全局） */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
}
/** 上游引擎对象（与其它契约模块同一套取法） */
function engineOf(w) {
    if (!w) return null;
    const plugin = w[LONSHA_PLUGIN_GLOBAL];
    if (!plugin || typeof plugin !== 'object') return null;
    const engine = plugin.engine || plugin.memoryEngine || null;
    return (engine && typeof engine === 'object') ? engine : null;
}/** 恒定键面的读数模板（读者不必再判 undefined） */
function faceOf(state, reason, extra) {
    return Object.assign({
        kind: 'ruby_phone_causal_board',
        version: 1,
        state: state,
        reason: reason,
        text: CB_REASONS[reason] || CB_REASONS['engine-absent'],
        ok: state === CB_STATES.OK,
        degraded: state === CB_STATES.ENGINE_ABSENT
            || state === CB_STATES.FACE_ABSENT
            || state === CB_STATES.UNUSABLE,
        /** 本面能不能替沉默作证：只有真读到图时才为真 */
        silentCapable: false,
        /** 四收口**分列**（不是一格计数） */
        closure: { unresolved: [], resolved: [], cancelled: [], broken: [] },
        /** 已确认边 / 推测边**两个数组**（不可混读） */
        edges: [],
        speculative: [],
        counts: { nodes: 0, edges: 0, speculative: 0, unresolved: 0, resolved: 0, cancelled: 0, broken: 0 },
        truncated: 0,
        /** ★ 本件**一个字节都不落盘**：写账仍归上游与宿主。 */
        writesNothing: true
    }, extra || {});
}
/** 把上游一个节点逐格归一（**不重判**，只收敛形状 + 原样搬回源凭证）。 */
function normNode(raw) {
    const o = obj(raw);
    if (!o) return null;
    const id = str(o.id).slice(0, 120);
    if (!id) return null;
    const kind = str(o.kind).toLowerCase();
    return {
        id: id,
        kind: CB_NODE_KINDS.indexOf(kind) >= 0 ? kind : '',
        label: str(o.label).slice(0, CB_LIMITS.label),
        status: str(o.status),
        actor: str(o.actor).slice(0, 40),
        floor: floorOrNull(o.floor),
        updatedFloor: floorOrNull(o.updatedFloor),
        closure: str(o.closure),
        /** ★ 回源凭证**原样搬**（本件不自己拼 id、不改写上游给的出处） */
        ref: str(o.ref || o.sourceRef || o.evidenceRef).slice(0, 160),
        traceId: str(o.traceId).slice(0, 60)
    };
}
/** 把上游一条边逐格归一（`basis` 决定归处，**不由调用方决定**）。 */
function normEdge(raw) {
    const o = obj(raw);
    if (!o) return null;
    const from = str(o.from).slice(0, 120);
    const to = str(o.to).slice(0, 120);
    if (!from || !to) return null;
    const basis = str(o.basis).toLowerCase();
    return {
        from: from,
        to: to,
        basis: CB_EDGE_BASES.indexOf(basis) >= 0 ? basis : 'speculative',
        label: str(o.label).slice(0, CB_LIMITS.label),
        ref: str(o.ref || o.sourceRef || o.evidenceRef).slice(0, 160)
    };
}
/**
 * 读上游**因果图**面（只读、不重算、不抛）。
 *
 * @param {object} win 宿主 window（注入，便于无头测试）
 * @param {{maxNodes?:number, maxEdges?:number}} [opts]
 * @returns 恒定键面读数（永不抛）
 */
export function readCausalBoard(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.causalChainGraph === 'function');
    const mod = (w && obj(w[CAUSAL_MODULE_GLOBAL])) || null;
    const moduleHas = !!(mod && typeof mod.build === 'function');
    if (!engineHas && !moduleHas) return faceOf(CB_STATES.ENGINE_ABSENT, 'engine-absent');
    let got = null;
    try {
        if (engineHas) got = eng.causalChainGraph(o);
        else got = mod.build(o.sources || null, o);
    } catch (_e) {
        return faceOf(CB_STATES.UNUSABLE, 'unusable');
    }
    const g = obj(got);
    if (!g) return faceOf(CB_STATES.UNUSABLE, 'unusable');
    /* 上游降级面用 version=0 标记「这一面不在场」。 */
    if (Number(g.version) === 0) return faceOf(CB_STATES.FACE_ABSENT, 'face-absent');
    if (g.malformedInput === true) return faceOf(CB_STATES.UNUSABLE, 'unusable');
    if (g.degraded === true) return faceOf(CB_STATES.UNUSABLE, 'unusable');
    const rawNodes = arr(g.nodes);
    const nodes = rawNodes.map(normNode).filter(Boolean).slice(0, CB_LIMITS.nodes);
    /* ★ 四收口**按上游给的 id 数组**分列，不自己重判 closure 字段：
     *   上游已经判过，本件再判一遍就是第二份口径（两个实现必然漂移）。 */
    const idSet = new Set(nodes.map((x) => x.id));
    const pick = (key) => arr(g[key]).map(str).filter((id) => idSet.has(id));
    const closure = {
        unresolved: pick('unresolved'),
        resolved: pick('resolved'),
        cancelled: pick('cancelled'),
        broken: pick('broken')
    };
    const confirmed = arr(g.edges).map(normEdge).filter(Boolean).slice(0, CB_LIMITS.edges);
    /* ★ 推测边**只收 basis=speculative 的那一数组**：不把 edges 里自称推测的混进来，
     *   也不把推测的搬进 edges —— 两边各自成列，混读即「把猜测当事实」。 */
    const spec = arr(g.speculative).map(normEdge).filter(Boolean).slice(0, CB_LIMITS.edges);
    const c = obj(g.counts) || {};
    const counts = {
        nodes: Number(c.nodes) || nodes.length,
        edges: confirmed.length,
        speculative: spec.length,
        unresolved: closure.unresolved.length,
        resolved: closure.resolved.length,
        cancelled: closure.cancelled.length,
        broken: closure.broken.length
    };
    /* ★ 真读数「无内容」：跑过了、图里一个节点都没有（**不是**「故事里没有任何线索」）。 */
    if (!nodes.length) {
        return faceOf(CB_STATES.EMPTY, 'empty', { counts: counts });
    }
    return faceOf(CB_STATES.OK, 'ok', {
        silentCapable: true,
        nodes: nodes,
        closure: closure,
        edges: confirmed,
        speculative: spec,
        counts: counts,
        truncated: Number(g.truncated) || 0
    });
}
/**
 * 读上游**未解待办**面（三账并列、按楼层升序）。
 *   ★ 本函数**不另立一份「待办」口径**：它只把 `causalChainTodos` 的产出逐格搬回来，
 *     并补上「这条属于哪一类 / 该去哪个 App」的**呈现用**声明。
 *   ★ 取消 / 违约 / 完成**不在此列**（上游就是这么分的）——本件不把它们塞进待办。
 */
export function readCausalTodos(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.causalChainTodos === 'function');
    if (!engineHas) {
        /* 待办面依附于图：图不在场时待办也不在场，但**归因要说清是哪一层的缺席**。 */
        const g = readCausalBoard(w, o);
        return faceOf(g.state === CB_STATES.OK ? CB_STATES.FACE_ABSENT : g.state,
            g.state === CB_STATES.OK ? 'face-absent' : g.reason, { todos: [] });
    }
    let got = null;
    try { got = eng.causalChainTodos(o); } catch (_e) { return faceOf(CB_STATES.UNUSABLE, 'unusable', { todos: [] }); }
    const list = arr(got).map((x) => {
        const n = normNode(x);
        if (!n) return null;
        const act = CB_ACTIONS[n.kind] || null;
        /* 行动路由**是声明**：本件不执行跳转，只把「该去哪」摆出来给视图用。 */
        return Object.assign({}, n, { action: act ? { app: act.app, label: act.label } : null });
    }).filter(Boolean).slice(0, CB_LIMITS.nodes);
    if (!list.length) return faceOf(CB_STATES.EMPTY, 'empty', { todos: [] });
    return faceOf(CB_STATES.OK, 'ok', { silentCapable: true, todos: list });
}
/**
 * 从某个起点向上游追溯（「追这条线」的读数）。
 *   ★ **只走已确认边**（上游就是这么实现的：推测边追出来的「链」不是链）；
 *   ★ `not-in-graph` 与「追到头了」**不同形**：前者 reason 非空且 known=false，
 *     后者 known=true 且 roots 非空 —— 两个处置相反（一个该换起点，一个该到点了）。
 *   ★ 本函数**不替用户标已解决**：它只读，`writesNothing` 恒 true。
 */
export function readCausalTrace(win, id, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const start = str(id).slice(0, 120);
    const engineHas = !!(eng && typeof eng.causalChainTrace === 'function');
    const mod = (w && obj(w[CAUSAL_MODULE_GLOBAL])) || null;
    const moduleHas = !!(mod && typeof mod.traceBack === 'function');
    if (!engineHas && !moduleHas) return faceOf(CB_STATES.ENGINE_ABSENT, 'engine-absent', { id: start, path: [], roots: [], known: false });
    /* 缺席判定**先于**参数判定：插件不在场时「没给起点」不是真实处置（用户该去装插件）。 */
    if (!start) return faceOf(CB_STATES.NO_SUBJECT, 'no-subject', { id: '', path: [], roots: [], known: false });
    let got = null;
    try {
        if (engineHas) got = eng.causalChainTrace(start, o);
        else {
            const g = readCausalBoard(w, o);
            if (g.state !== CB_STATES.OK) return faceOf(g.state, g.reason, { id: start, path: [], roots: [], known: false });
            got = mod.traceBack({ nodes: g.nodes, edges: g.edges }, start, o);
        }
    } catch (_e) { return faceOf(CB_STATES.UNUSABLE, 'unusable', { id: start, path: [], roots: [], known: false }); }
    const t = obj(got);
    if (!t) return faceOf(CB_STATES.UNUSABLE, 'unusable', { id: start, path: [], roots: [], known: false });
    if (Number(t.version) === 0) return faceOf(CB_STATES.FACE_ABSENT, 'face-absent', { id: start, path: [], roots: [], known: false });
    const reason = str(t.reason);
    const known = t.known === true;
    const path = arr(t.path).map((x) => str(x).slice(0, 120)).filter(Boolean);
    const roots = arr(t.roots).map((x) => str(x).slice(0, 120)).filter(Boolean);
    /* ★ 「起点不在图里」单独一格：与「追到头了」处置相反。 */
    if (reason === 'not-in-graph') {
        return faceOf(CB_STATES.EMPTY, 'not-in-graph', { id: start, path: [], roots: [], known: false });
    }
    if (!known && !path.length) return faceOf(CB_STATES.UNUSABLE, 'unusable', { id: start, path: [], roots: [], known: false });
    return faceOf(CB_STATES.OK, 'ok', {
        silentCapable: true,
        id: str(t.id) || start,
        path: path,
        roots: roots,
        cycles: Number(t.cycles) || 0,
        truncated: t.truncated === true,
        known: known
    });
}
/**
 * 读上游**候选边**（恒为推测：宿主不替用户确认因果）。
 *   ★ 候选边**只进 speculative 一列**：它永远不是已确认事实。
 *   ★ 本件**不替用户确认**（零写面）：确认动作归上游 owner，手机端只摆出来。
 */
export function readCausalProposals(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.causalChainProposals === 'function');
    if (!engineHas) {
        const g = readCausalBoard(w, o);
        return faceOf(g.state === CB_STATES.OK ? CB_STATES.FACE_ABSENT : g.state,
            g.state === CB_STATES.OK ? 'face-absent' : g.reason, { proposals: [] });
    }
    let got = null;
    try { got = eng.causalChainProposals(o); } catch (_e) { return faceOf(CB_STATES.UNUSABLE, 'unusable', { proposals: [] }); }
    const list = arr(got).map(normEdge).filter(Boolean).slice(0, CB_LIMITS.edges)
        .map((e) => Object.assign({}, e, { basis: 'speculative' }));
    if (!list.length) return faceOf(CB_STATES.EMPTY, 'empty', { proposals: [] });
    return faceOf(CB_STATES.OK, 'ok', { silentCapable: true, proposals: list });
}/* ---------------------------------------------------------------
 * 一行读数（各态**分开说**：合并任意两态都会误导「该怎么写」）
 * ------------------------------------------------------------ */
/** 因果板一行读数：四收口逐格报出 + 推测边**单列**。 */
export function boardLine(read) {
    const r = obj(read) || {};
    if (r.state === CB_STATES.ENGINE_ABSENT) return '线索:' + CB_REASONS['engine-absent'];
    if (r.state === CB_STATES.FACE_ABSENT) return '线索:' + CB_REASONS['face-absent'];
    if (r.state === CB_STATES.UNUSABLE) return '线索:' + CB_REASONS['unusable'];
    if (r.state === CB_STATES.EMPTY) return '线索:' + CB_REASONS['empty'];
    const c = obj(r.counts) || {};
    const parts = ['节点 ' + (c.nodes || 0)];
    /* ★ 四收口**逐格报出**（含 0 以外的一切情形都如实说）。 */
    if (c.unresolved) parts.push('未收口 ' + c.unresolved);
    if (c.resolved) parts.push('已完成 ' + c.resolved);
    if (c.cancelled) parts.push('已作废 ' + c.cancelled);
    if (c.broken) parts.push('已违约 ' + c.broken);
    parts.push('已确认边 ' + (c.edges || 0));
    /* ★ 推测边**必须永远单列**：它是「别把猜测当事实」的落点。 */
    if (c.speculative) parts.push('**仅推测 ' + c.speculative + '（不当事实）**');
    return '线索:' + parts.join(' · ');
}
/** 未解待办一行读数。 */
export function todosLine(read) {
    const r = obj(read) || {};
    if (r.state === CB_STATES.ENGINE_ABSENT) return '待办:' + CB_REASONS['engine-absent'];
    if (r.state === CB_STATES.FACE_ABSENT) return '待办:' + CB_REASONS['face-absent'];
    if (r.state === CB_STATES.UNUSABLE) return '待办:' + CB_REASONS['unusable'];
    if (r.state === CB_STATES.EMPTY) return '待办:' + CB_REASONS['empty'];
    const list = arr(r.todos);
    const byKind = { seed: 0, commitment: 0, event: 0, note: 0 };
    for (const t of list) if (byKind[t.kind] !== undefined) byKind[t.kind] += 1;
    const parts = ['未结 ' + list.length];
    for (const k of CB_NODE_KINDS) if (byKind[k]) parts.push(CB_KIND_LABEL[k] + ' ' + byKind[k]);
    return '待办:' + parts.join(' · ');
}
/** 追溯一行读数（「追这条线」）。 */
export function traceLine(read) {
    const r = obj(read) || {};
    if (r.state === CB_STATES.ENGINE_ABSENT) return '追溯:' + CB_REASONS['engine-absent'];
    if (r.state === CB_STATES.FACE_ABSENT) return '追溯:' + CB_REASONS['face-absent'];
    if (r.state === CB_STATES.UNUSABLE) return '追溯:' + CB_REASONS['unusable'];
    if (r.state === CB_STATES.NO_SUBJECT) return '追溯:' + CB_REASONS['no-subject'];
    /* ★ 「起点不在图里」与「追到头了」两句话**必须不同形**（处置相反）。 */
    if (r.reason === 'not-in-graph') return '追溯:' + CB_REASONS['not-in-graph'];
    const path = arr(r.path);
    const roots = arr(r.roots);
    const parts = ['链 ' + path.length + ' 环'];
    if (roots.length) parts.push('源头 ' + roots.length);
    else parts.push('**没追到源头（可能被截断）**');
    if (r.cycles) parts.push('回环 ' + r.cycles);
    if (r.truncated) parts.push('**已截断**');
    return '追溯:' + parts.join(' · ');
}
/* ---------------------------------------------------------------
 * 这一面能不能读（★ 判定词**只此一份**）
 *   为什么放在内核而不是视图：视图里写第二份状态字面量，内核改名那天
 *   那些比较会**静默落空**（不报错、不转红），于是「插件没装」被显示成
 *   「读到了一份空图」—— 两个处置正好相反（去装插件 / 去聊一楼）。
 *   同仓 bridge-contract-audit 已按「归因文案表手写键」扫过同类形态。
 * ------------------------------------------------------------ */
/** 各态的**给用户看的一句处置建议**（与 CB_REASONS 的短归因分工不同：那条进一行读数，这条进卡片） */
export const CB_STATE_HINT = Object.freeze({
    'engine-absent': '未检测到 LonSha 记忆插件的因果面 —— 装上（或升级）后本卡自动可用',
    'face-absent': '插件在，但这一版没有因果面：需要较新版本',
    'unusable': '因果面在，但本机读不出（出口报错或面畸形）—— 这不是「故事里没有线索」',
    'empty': '因果面真跑过了，图里一个节点都没有 —— 剧情推进后会自动长出来',
    'no-subject': '还没选要追的那条线：先在下面点一条（本卡不替你挑）'
});
/**
 * 这一面能不能读 + 读不到时该说什么。
 *   ★ `readable:false` 时 `hint` **必非空** —— 视图直接摆出来即可，不必再判一格。
 *   ★ 未知状态（上游加了新态而本件没跟上）**也走 readable:false**：
 *     宁可说「不可读」，绝不默认成「读到了」。
 */
export function boardGateOf(read) {
    const r = obj(read) || {};
    if (r.state === CB_STATES.OK) return { readable: true, state: r.state, hint: '' };
    return {
        readable: false,
        state: str(r.state),
        hint: CB_STATE_HINT[r.state] || '因果板不可读（状态未登记，如实说读不出）'
    };
}
/**
 * 追溯读数的**一句说明**（没有要说的就给空串）。
 *   ★ 「起点不在图里」与「追到头了」的差别只在这一处判：前者要换起点、
 *     后者到点了 —— 合成一句就是把「该换一条」写成「这条已经到头」。
 */
export function traceNoteOf(read) {
    const r = obj(read) || {};
    if (r.reason === 'not-in-graph') return '起点不在图里 —— 该换一个起点，不是「已经追到头了」';
    return '';
}
/* ---------------------------------------------------------------
 * 自检（纯函数式，不抛）：八条口径当场自证
 * ------------------------------------------------------------ */
/**
 * 一 插件不在场 ⇒ engine-absent，**不是** empty（两态不同形）；
 * 二 面 version=0 ⇒ face-absent；
 * 三 出口抛错 ⇒ unusable；
 * 四 ★ 核心：没给起点 ⇒ no-subject（**不是**「追到头了」）；
 * 五 ★ 核心：`not-in-graph` 与「追到头了」不同形（一个该换起点，一个该到点了）；
 * 六 ★ 核心：推测边**只进 speculative 一列**，一条都不混进已确认边；
 * 七 ★ 核心：四收口分列（合成一格就分不出「不用再提」与「还没做」）；
 * 八 ★ 核心：读数里**不含**分数 / 置信度 / 优先级一族键。
 */
export function cbSelfCheck() {
    const problems = [];
    const node = (id, kind, closure) => ({ id: id, kind: kind, label: id, closure: closure, ref: 'r:' + id });
    const win = (graph) => ({ LonShaMemory: { engine: {
        causalChainGraph: () => graph,
        causalChainTodos: () => arr(graph.nodes).filter((x) => x.closure === 'unresolved'),
        causalChainTrace: (id) => ({ kind: 'causal_chain@trace', version: 1, id: id, path: [id], roots: [id], cycles: 0, truncated: false, known: true, reason: '', writesNothing: true }),
        causalChainProposals: () => [{ from: 'a', to: 'b', basis: 'speculative', label: '猜的' }]
    } } });
    const sample = {
        kind: 'causal_chain', version: 1,
        nodes: [node('a', 'commitment', 'unresolved'), node('b', 'seed', 'resolved'), node('c', 'event', 'broken')],
        edges: [{ from: 'a', to: 'b', basis: 'evidence' }],
        speculative: [{ from: 'b', to: 'c', basis: 'speculative' }],
        unresolved: ['a'], resolved: ['b'], cancelled: [], broken: ['c'],
        counts: { nodes: 3 }, truncated: 0, malformedInput: false, writesNothing: true, degraded: false
    };
    /* 一：插件不在场（**不是** empty）。 */
    const absent = readCausalBoard(null);
    if (absent.state !== CB_STATES.ENGINE_ABSENT) problems.push('插件不在场应报 engine-absent');
    if (absent.writesNothing !== true) problems.push('writesNothing 必须恒为 true');
    /* 二：面 version=0 ⇒ face-absent。 */
    if (readCausalBoard(win({ version: 0 })).state !== CB_STATES.FACE_ABSENT) problems.push('version=0 应报 face-absent');
    /* 三：出口抛错 ⇒ unusable。 */
    if (readCausalBoard({ LonShaMemory: { engine: { causalChainGraph: () => { throw new Error('x'); } } } }).state !== CB_STATES.UNUSABLE) {
        problems.push('出口抛错应报 unusable');
    }
    /* 四 + 五：没给起点与「不在图里」各自一格，且与「追到头了」不同形。 */
    const okWin = win(sample);
    const noSub = readCausalTrace(okWin, '');
    if (noSub.state !== CB_STATES.NO_SUBJECT) problems.push('没给起点应报 no-subject');
    const notIn = readCausalTrace({ LonShaMemory: { engine: Object.assign({}, okWin.LonShaMemory.engine, {
        causalChainTrace: () => ({ version: 1, id: 'zz', path: [], roots: [], cycles: 0, truncated: false, known: false, reason: 'not-in-graph', writesNothing: true })
    }) } }, 'zz');
    if (notIn.reason !== 'not-in-graph') problems.push('起点不在图里应报 not-in-graph');
    const okTrace = readCausalTrace(okWin, 'a');
    if (okTrace.state !== CB_STATES.OK) problems.push('正常追溯应报 ok');
    if (traceLine(notIn) === traceLine(okTrace)) problems.push('「不在图里」与「追到头了」的文案不得同形');
    /* 六：推测边**只进 speculative**（一条都不混进已确认边）。 */
    const b = readCausalBoard(okWin);
    if (b.edges.length !== 1 || b.edges[0].basis !== 'evidence') problems.push('已确认边数组混进了非确认边');
    if (b.speculative.length !== 1 || b.speculative[0].basis !== 'speculative') problems.push('推测边数组形态不对');
    if (b.edges.some((e) => e.basis === 'speculative')) problems.push('推测边混进了已确认边（把猜测当事实）');
    /* 七：四收口分列。 */
    const keys = Object.keys(b.closure);
    if (keys.sort().join(',') !== 'broken,cancelled,resolved,unresolved') problems.push('四收口必须分列');
    if (b.closure.unresolved.length !== 1 || b.closure.broken.length !== 1) problems.push('收口分列计数不对');
    /* 八：禁用键深度扫描（真跑）。 */
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (CB_FORBIDDEN_KEYS.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const hits = scan([b, readCausalTodos(okWin), readCausalTrace(okWin, 'a'), readCausalProposals(okWin)], []);
    if (hits.length) problems.push('读数里出现了禁用键：' + hits.join('/'));
    return { problems: problems };
}
export default {
    CB_FACE_ID,
    CB_STATES,
    CB_REASONS,
    CB_NODE_KINDS,
    CB_KIND_LABEL,
    CB_CLOSURE,
    CB_CLOSURE_LABEL,
    CB_EDGE_BASES,
    CB_ACTIONS,
    CB_FORBIDDEN_KEYS,
    CB_LIMITS,
    readCausalBoard,
    readCausalTodos,
    readCausalTrace,
    readCausalProposals,
    boardLine,
    todosLine,
    traceLine,
    cbSelfCheck,
    CB_STATE_HINT,
    boardGateOf,
    traceNoteOf
};