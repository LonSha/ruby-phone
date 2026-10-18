/* ============================================================
 * config/perspective-contrast-contract.js — [第四期 R4-X5] 角色**信息差**
 *   与**证词对照**的消费侧单一真源（上游 testimonyBoard / perspectiveCard
 *   的 contrast 出口）
 * ------------------------------------------------------------
 *
 * 【计划原文 R4-X5】
 *   「chars/memory 中增加并排视角，已有视角出口先交付；证词冲突深读接 M4-X5。
 *     作者与角色模式显式选择，切换不把全知正文塞入角色生成上下文。」
 *   验收原文四条：
 *     ① 三人信息差案例，同一事件三种认知各自对应来源；
 *     ② 时间拉回揭穿之前不显示后来真名；
 *     ③ 作者比较不改变知识账；
 *     ④ 手机窄屏改为逐人切换而非挤成三列。
 *   不做原文三条：
 *     · **不再造知识权限规则**（权限一律沿上游的格位语义，本件一个字不重算）；
 *     · **不新增好感度算法**；
 *     · **不以一票多数裁真相**（四态与三档原样端出，谁也不投谁的票）。
 *
 * 【为什么需要这一件（修前实测的缺口，不是推演）】
 *   上游 v3.323.0(M3-X4) 的视角卡面与 v3.343.0(M4-X5) 的证词面**早已交付**，
 *   而手机侧 `config/perspective-card-contract.js` 只做**单角色可知范围**
 *   （读一个角色的四格）——`apps/chars/` 里 `grep -n 'perspective'` **零命中**，
 *   且全仓 `grep -n 'perspectiveContrast\|testimonyBoard'` 同样零命中（消费者侧）。
 *   后果三件，都不是报错：
 *     ① 写群像 / 悬疑时，作者看不到「甲亲历、乙听说、丙误信」的**并排**对照 ——
 *        只能一人一人地查，而「查过谁、漏了谁」在读数上同形；
 *     ② 「同一事件的多种说法」在手机上无从聚合，更看不出**未裁决的三档成因**
 *        （三人都说但没人亲历 / 证据太弱 / 真正对立）——「未决」被压成一个布尔；
 *     ③ 撤回一条证据之后，争议状态该跟着变（不静默留一个没人能举证的 contested），
 *        而手机侧根本没有这条通路。
 *
 * 【本件只做四件事（不重算任何上游口径）】
 *   1 **六态分形**：插件不在场 / 面不在场(version=0) / 本机读不出 / 没给看谁 /
 *      真跑过但无内容 / 读到 —— 六态**处置相反**，压平任意两态即把
 *      「还没装插件」显示成「他们对这件事都没说法」；
 *   2 **并排对照原样透传**：onlyLeft / onlyRight / shared / **misledSide** 逐格照搬
 *      上游 `contrast` 的判定（**不在这里合成一个「信息差分数」** —— 那正是本仓
 *      与上游都明令禁止的形态：假读数）；
 *   3 **证词面原样透传 + 身份面闸**：四态（supported/contested/undecided/withdrawn）
 *      与未裁决三档（ambiguous/below-threshold/transmittal-only）逐格端出；
 *      「揭穿之前不显示后来真名」落在 `visibleAtFace()`：按上游给的 `identity`
 *      分面**过滤并如实计数**，本件**不判**哪个名字是真名（那是上游 identity 口径）；
 *   4 **作者 / 角色模式显式闸**：模式必须**显式选择**（默认作者）——
 *      角色模式下 `perspectiveModePromptBlock()` 只允许当前角色**可知**的格进入
 *      生成上下文（亲历 / 听说 / 误信），对方独有的事实与全知正文**一个字节都不给**。
 *
 * 【五条硬约束（每条都有自检）】
 *   · **零写**：本件不读存储、不写状态、不派事件、不碰 DOM（`writesNothing` 恒 true）；
 *   · **不裁真相**：读数里**不得出现**百分比 / 置信度 / 分数键
 *     （`PCX_FORBIDDEN_KEYS` 深度扫描，含上游同名禁令）；
 *   · **误信不写成世界真相**：`misled` 格恒单列并带「勿当世界真相」字样；
 *   · **未记录 ≠ 不知道**：`unrecorded` 与 `unknown` 结构上不可混读（沿 R3-O2 口径）；
 *   · **作者比较不改变知识账**：本件纯只读，模式切换只影响**呈现**，不改任何账。
 *
 * 【边界（如实登记，不装）】
 *   · 本件**不替角色下「知道 / 不知道」的结论**；
 *   · 本件**不产全知统一陈述**（上游 testimony-board 的「按角色分面」是它的立身之本）；
 *   · 上游不在就如实报缺席，**不退回本地猜一份对照**。
 * ============================================================ */
/* ★ 数值取值门走**全仓唯一实现**（config/num-gate.js），不在本文件就地再写一份。 */
import { numOrNull as floorOrNull } from './num-gate.js';
/** 上游插件全局名（与其它契约模块读的是同一个） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游视角卡模块全局名（contrast 出口的模块路） */
const PERSPECTIVE_MODULE_GLOBAL = 'LonShaPerspectiveCard';
/** 上游证词面模块全局名 */
const TESTIMONY_MODULE_GLOBAL = 'LonShaTestimonyBoard';
/** 上游面 id（与上游 open_face_registry.tsv / 本仓 crossrepo-registry.js 同一口径） */
export const PCX_FACE_ID = 'testimonyBoard';
/** 上游视角卡面 id（并排对照所属的那一面：其 symbol 列已含 `contrast`） */
export const PCX_CONTRAST_FACE_ID = 'perspectiveCard';

/** 六态（缺席 / 不在场 / 读不出 / 没给看谁 / 真读数空 / 好） */
export const PCX_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    NO_SUBJECT: 'no-subject',
    EMPTY: 'empty',
    OK: 'ok'
});
/** 七个归因词（两个同形即失败） */
export const PCX_REASONS = Object.freeze({
    ok: '对照就绪（双侧分格可分）',
    'no-subject': '没给要看的人（对照至少要两个人）',
    'engine-absent': '记忆插件未装或未加载（等装插件）',
    'face-absent': '插件在场但这版没有这一面（需插件 v3.343.0+）',
    unusable: '出口在但读不出或形态不对（本机读不出，不是他们都没说法）',
    empty: '真跑过、没有可对照的内容（**不是**「他们确实都不知道」）',
    'mode-invalid': '作者 / 角色模式取值非法（如实报错，不猜一个默认）'
});
/** 作者 / 角色模式（**显式选择**；默认作者） */
export const PCX_MODES = Object.freeze({
    AUTHOR: 'author',
    CHARACTER: 'character'
});
/**
 * 四格 + 一格「不可用格」的人读字样（**逐字沿 R3-O2 口径**，不另立同义名）。
 *   `unrecorded` 必须与 `unknown` 分列：上游把「判不开的动作」单独落进 unrecorded，
 *   并逐字提醒「**不当『不知道』用**」。
 */
export const PCX_SLOTS = Object.freeze({
    lived: '亲历',
    heard: '听说',
    misled: '误信（勿当世界真相）',
    unknown: '未记录认知（账里明确记着不知道）',
    unrecorded: '本模块不知道（**不当「不知道」用**）'
});
/** 身份四面（上游 identity 口径：揭密前后各有一套视角） */
export const PCX_IDENTITY_FACES = Object.freeze(['surface', 'revealed', 'homonym', 'unspecified']);
/**
 * 身份视图白名单（**界面上可选的那几个**：未揭穿 / 已揭穿 / 全呈）。
 *   与 `PCX_IDENTITY_FACES`（**上游分面**）分开：`all` 是本仓的聚合视图，
 *   不是上游的分面名 —— 混用会让「按面过滤」与「界面选项」变成同一张表。
 *   接线层必须引用本常量，**不得**再写第二份字面量清单（改一处即全仓同改）。
 */
export const PCX_IDENTITY_VIEWS = Object.freeze(['surface', 'revealed', 'all']);
/** 面状态词表：**只认这几个**（认不出即按面不在场处置，不猜新名） */
export const PCX_TB_STATES = Object.freeze(['supported', 'contested', 'undecided', 'withdrawn']);
/** 单条说法的取证状态（与上游 knowledge-trace 的动作面同源） */
export const PCX_TB_CLAIM_STATES = Object.freeze(['witnessed', 'relayed', 'rebutted', 'undecided']);
/** 未裁决三档（**必须分列**：混成一格就分不出「为什么暂不能下结论」） */
export const PCX_TB_UNRESOLVED = Object.freeze(['ambiguous', 'below-threshold', 'transmittal-only']);
/** 说法立场三态（**只认显式声明**，不抽语义） */
export const PCX_TB_SIDES = Object.freeze(['affirm', 'deny', 'neutral']);
/**
 * 读数里**不得出现**的键名（百分比 / 置信度 / 分数一族）。
 *   上游 testimony-board.js 的 PERCENT_KEYS 是**同一个禁令**；本仓把它变成
 *   对本件自己读数的一次深度扫描（自检里真跑）——「不加虚构置信百分比」
 *   若只写在注释里，下一个人加一格 `confidence` 时不会有任何东西响。
 */
export const PCX_FORBIDDEN_KEYS = Object.freeze([
    'percent', 'percentage', 'confidence', 'score', 'probability', 'weight', 'index'
]);
/** 上限（冻结）：防一次读数把长聊天整段拉回内存 */
export const PCX_LIMITS = Object.freeze({
    facts: 40,
    boards: 8,
    testimonies: 24,
    fact: 120,
    /** 窄屏阈值（px）：**小于**这个宽度改为逐人切换（验收第 ④ 条） */
    narrowWidth: 720
});
function str(v) { return String(v == null ? '' : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object') ? v : null; }
/** 宿主窗口（注入优先，回落全局） */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}
/** 取上游插件引擎（两种取法：全局插件对象的本体 / 它自述的引擎面）。 */
function engineOf(w) {
    if (!w) return null;
    const plugin = w[LONSHA_PLUGIN_GLOBAL];
    if (!plugin || typeof plugin !== 'object') return null;
    const engine = plugin.engine || plugin.memoryEngine || null;
    return (engine && typeof engine === 'object') ? engine : null;
}
/** 恒定键面的读数模板（读者不必再判 undefined） */
function faceOf(state, reason, extra) {
    return Object.assign({
        kind: 'ruby_phone_perspective_contrast',
        version: 1,
        state: state,
        reason: reason,
        text: PCX_REASONS[reason] || PCX_REASONS['engine-absent'],
        ok: state === PCX_STATES.OK,
        degraded: state === PCX_STATES.ENGINE_ABSENT
            || state === PCX_STATES.FACE_ABSENT
            || state === PCX_STATES.UNUSABLE,
        /** 本面能不能替沉默作证：只有真读到双侧格位时才为真（沿 R3-O2 的闸门口径） */
        silentCapable: false,
        chars: [],
        diff: { onlyLeft: [], onlyRight: [], shared: [], misledSide: [] },
        leftPresent: false,
        rightPresent: false,
        boards: [],
        counts: { boards: 0, claims: 0, states: {}, unresolved: 0 },
        /** ★ 本件**一个字节都不落盘**：写账仍归上游与宿主。 */
        writesNothing: true
    }, extra || {});
}
/* ---------------------------------------------------------------
 * 并排对照（上游 perspectiveContrast / perspective-card.js::contrast）
 *
 * 两种取数路（都只做**调用与归因**，不替上游准备输入）：
 *   · 引擎路 `engine.perspectiveContrast(a, b, opts)`（上游真出口，内部各算一张卡）；
 *   · 模块路 `LonShaPerspectiveCard.build(traces,{character})` 取卡后 `contrast(cardA, cardB)`。
 *   引擎路优先：它自己知道该从哪儿取轨迹（`worldProg.knowledgeTraces`）。
 * --------------------------------------------------------------- */
/** 模块路：把两个人的卡各建一张，再交给上游 contrast。 */
function contrastViaModule(mod, charA, charB, opts) {
    const traces = arr(opts.traces);
    const base = { at: (opts.at === undefined || opts.at === null || opts.at === '') ? undefined : Number(opts.at) };
    const a = mod.build(traces, Object.assign({}, base, { character: charA }));
    const b = mod.build(traces, Object.assign({}, base, { character: charB }));
    const cardA = (a && arr(a.cards).length) ? arr(a.cards)[0] : null;
    const cardB = (b && arr(b.cards).length) ? arr(b.cards)[0] : null;
    return { contrast: mod.contrast(cardA, cardB), leftCard: cardA, rightCard: cardB };
}
/** 把上游 contrast 读数逐格归一（**不重算判定**，只做形状收敛与截断）。 */
function normContrast(raw) {
    const r = obj(raw) || {};
    const d = obj(r.diff) || {};
    const rec = (it) => ({
        fact: str(it && it.fact).slice(0, PCX_LIMITS.fact),
        left: arr(it && it.left).map(str).filter(Boolean),
        right: arr(it && it.right).map(str).filter(Boolean)
    });
    const clip = (list) => arr(list).map(rec).filter((x) => x.fact).slice(0, PCX_LIMITS.facts);
    return {
        onlyLeft: clip(d.onlyLeft),
        onlyRight: clip(d.onlyRight),
        shared: clip(d.shared),
        /* ★ 误信侧**必须单列**：这是「误信不写成世界真相」最需要被看见的地方。 */
        misledSide: clip(d.misledSide)
    };
}
/**
 * 读上游**并排对照**面（只读、不重算、不抛）。
 *
 * @param {object} win 宿主 window（注入，便于无头测试）
 * @param {string} charA 左侧角色（不给 ⇒ no-subject）
 * @param {string} charB 右侧角色（不给 ⇒ no-subject）
 * @param {{at?:number, traces?:Array}} [opts]
 *   · at     —— 时点楼层（给了就只收 floor ≤ at 的轨迹；读不到楼号的轨迹不进任何时点）
 *   · traces —— 模块路要喂的轨迹（引擎路不需要：它自己取）
 * @returns 恒定键面读数（永不抛）
 */
export function readPerspectiveContrast(win, charA, charB, opts = {}) {
    const a = str(charA), b = str(charB);
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.perspectiveContrast === 'function');
    const mod = (w && obj(w[PERSPECTIVE_MODULE_GLOBAL])) || null;
    const moduleHas = !!(mod && typeof mod.build === 'function' && typeof mod.contrast === 'function');
    /* 缺席判定**先于**参数判定：插件不在场时「没给看谁」不是真实处置（用户该去装插件）。 */
    if (!engineHas && !moduleHas) return faceOf(PCX_STATES.ENGINE_ABSENT, 'engine-absent');
    if (!a || !b) return faceOf(PCX_STATES.NO_SUBJECT, 'no-subject', { chars: [a, b].filter(Boolean) });
    let got = null;
    let leftCard = null, rightCard = null;
    try {
        if (engineHas) {
            const at = (o.at === undefined || o.at === null || o.at === '') ? undefined : Number(o.at);
            got = eng.perspectiveContrast(a, b, Object.assign({}, o, { at: at }));
        } else {
            const via = contrastViaModule(mod, a, b, o);
            got = via.contrast;
            leftCard = via.leftCard;
            rightCard = via.rightCard;
        }
    } catch (_e) {
        return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    }
    const g = obj(got);
    /* 形态不对与「他们都没说法」**不同形**。上游降级面用 version=0 标记「这一面不在场」。 */
    if (!g) return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    if (Number(g.version) === 0) return faceOf(PCX_STATES.FACE_ABSENT, 'face-absent');
    if (g.ok === false && !g.diff) return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    const diff = normContrast(g);
    /* ★ 两侧都缺卡 ⇒ **真读数「无内容」**（跑过了、这两个人没有轨迹），
     *   与「这一面不在场」处置相反（一个该去聊一楼，一个该去装插件）。 */
    const leftPresent = g.leftPresent === true || !!leftCard;
    const rightPresent = g.rightPresent === true || !!rightCard;
    if (!leftPresent && !rightPresent) {
        return faceOf(PCX_STATES.EMPTY, 'empty', { chars: [a, b], diff: diff, leftPresent: false, rightPresent: false });
    }
    const leftName = str((obj(g.left) || {}).character) || a;
    const rightName = str((obj(g.right) || {}).character) || b;
    const counts = {
        boards: 0,
        claims: diff.onlyLeft.length + diff.onlyRight.length + diff.shared.length,
        states: {},
        unresolved: 0
    };
    return faceOf(PCX_STATES.OK, 'ok', {
        /* ★ 只有真拿到双侧时才可能为真：单侧在场不足以替沉默作证。 */
        silentCapable: !!(leftPresent && rightPresent),
        chars: [leftName, rightName],
        diff: diff,
        leftPresent: leftPresent,
        rightPresent: rightPresent,
        counts: counts
    });
}
/* ---------------------------------------------------------------
 * 证词面（上游 testimonyBoard / testimony-board.js::build）
 * --------------------------------------------------------------- */
/** 把上游一条说法逐格归一（**不重判**，只收敛形状）。 */
function normTestimony(t) {
    const o = obj(t);
    if (!o) return null;
    const character = str(o.character).slice(0, 40);
    const statement = str(o.statement).slice(0, 180);
    if (!character || !statement) return null;
    const state = str(o.state).toLowerCase();
    const side = str(o.side).toLowerCase();
    return {
        character: character,
        statement: statement,
        side: PCX_TB_SIDES.indexOf(side) >= 0 ? side : 'neutral',
        state: PCX_TB_CLAIM_STATES.indexOf(state) >= 0 ? state : 'undecided',
        strength: str(o.strength) || 'none',
        via: str(o.via).slice(0, 24),
        from: str(o.from).slice(0, 40),
        evidenceKey: str(o.evidenceKey).slice(0, 120),
        floor: floorOrNull(o.floor),
        identity: PCX_IDENTITY_FACES.indexOf(str(o.identity)) >= 0 ? str(o.identity) : 'unspecified',
        traceId: str(o.traceId).slice(0, 60),
        revoked: o.revoked === true
    };
}
/** 把上游一块板逐格归一（四态 / 三档**原样保留**）。 */
function normBoard(b) {
    const o = obj(b);
    if (!o) return null;
    const eventKey = str(o.eventKey).slice(0, 120);
    if (!eventKey) return null;
    const st = str(o.state).toLowerCase();
    const dis = obj(o.disputes) || {};
    const kinds = obj(dis.kinds) || {};
    const items = arr(dis.items).slice(0, PCX_LIMITS.testimonies).map((it) => ({
        character: str(it && it.character).slice(0, 40),
        statement: str(it && it.statement).slice(0, 180),
        side: str(it && it.side) || 'neutral',
        /* 三档：认不出的档**如实保留原值**（不静默改成 ambiguous）。 */
        kind: str(it && it.kind),
        state: str(it && it.state),
        strength: str(it && it.strength) || 'none',
        evidenceKey: str(it && it.evidenceKey).slice(0, 120),
        floor: floorOrNull(it && it.floor),
        traceId: str(it && it.traceId).slice(0, 60)
    })).filter((x) => x.statement || x.character);
    const identities = obj(o.identities) || {};
    const idFace = (k) => arr(identities[k]).slice(0, PCX_LIMITS.testimonies).map((it) => ({
        character: str(it && it.character).slice(0, 40),
        statement: str(it && it.statement).slice(0, 180),
        side: str(it && it.side) || 'neutral',
        floor: floorOrNull(it && it.floor),
        evidenceKey: str(it && it.evidenceKey).slice(0, 120)
    }));
    const sup = obj(o.supports) || {};
    const c = obj(o.counts) || {};
    return {
        eventKey: eventKey,
        state: PCX_TB_STATES.indexOf(st) >= 0 ? st : 'undecided',
        /* 上游的具名 reason **原样搬**（它是「为什么是这一态」的唯一出处）。 */
        reason: str(o.reason),
        testimonies: arr(o.testimonies).slice(0, PCX_LIMITS.testimonies).map(normTestimony).filter(Boolean),
        disputes: {
            contested: dis.contested === true,
            items: items,
            kinds: {
                'ambiguous': Number(kinds['ambiguous']) || 0,
                'below-threshold': Number(kinds['below-threshold']) || 0,
                'transmittal-only': Number(kinds['transmittal-only']) || 0
            }
        },
        identities: {
            surface: idFace('surface'),
            revealed: idFace('revealed'),
            homonym: idFace('homonym'),
            unspecified: idFace('unspecified'),
            split: identities.split === true
        },
        counts: {
            /* ★ 三方分开报：独立支持 / 转述 / 一手 —— 合成一格就再也说不出「为什么这条更硬」。 */
            independent: Number(c.independent) || 0,
            transmittals: Number(c.transmittals) || 0,
            firsthand: Number(c.firsthand) || 0,
            testimonies: Number(c.testimonies) || 0,
            unresolved: Number(c.unresolved) || 0
        },
        supports: {
            independentCount: Number(sup.independentCount) || 0,
            transmittalCount: Number(sup.transmittalCount) || 0,
            firsthandCount: Number(sup.firsthandCount) || 0
        },
        truncated: o.truncated === true
    };
}
/**
 * 读上游**证词面**（只读、不重算、不抛）。
 *
 * @param {object} win 宿主 window
 * @param {{event?:string, at?:number, traces?:Array, maxItems?:number}} [opts]
 *   · event —— 只看该事件；不给则对每个事件各出一块
 *   · at    —— 时点楼层（只收 floor ≤ at 的说法；读不到楼号的**不进任何时点**）
 * @returns 恒定键面读数（永不抛）
 */
export function readTestimonyBoard(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.testimonyBoard === 'function');
    const mod = (w && obj(w[TESTIMONY_MODULE_GLOBAL])) || null;
    const moduleHas = !!(mod && typeof mod.build === 'function');
    if (!engineHas && !moduleHas) return faceOf(PCX_STATES.ENGINE_ABSENT, 'engine-absent');
    const at = (o.at === undefined || o.at === null || o.at === '') ? undefined : Number(o.at);
    let got = null;
    try {
        if (engineHas) got = eng.testimonyBoard(Object.assign({}, o, { at: at }));
        else got = mod.build(arr(o.traces), Object.assign({}, o, { at: at }));
    } catch (_e) {
        return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    }
    const g = obj(got);
    if (!g) return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    if (Number(g.version) === 0) return faceOf(PCX_STATES.FACE_ABSENT, 'face-absent');
    if (g.malformedInput === true) return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    if (g.degraded === true) return faceOf(PCX_STATES.UNUSABLE, 'unusable');
    const boards = arr(g.boards).map(normBoard).filter(Boolean).slice(0, PCX_LIMITS.boards);
    const counts = { boards: boards.length, claims: 0, states: {}, unresolved: 0 };
    for (const s of PCX_TB_STATES) counts.states[s] = 0;
    for (const b of boards) {
        counts.claims += b.testimonies.length;
        counts.states[b.state] += 1;
        counts.unresolved += b.disputes.items.length;
    }
    if (!boards.length) {
        /* ★ 真读数：跑过了、没有同事件的多方说法（**不是**「他们都没说法」的强断言）。 */
        return faceOf(PCX_STATES.EMPTY, 'empty', { counts: counts });
    }
    return faceOf(PCX_STATES.OK, 'ok', { silentCapable: true, boards: boards, counts: counts });
}
/**
 * 撤回一条证据后**重算**争议状态（上游 testimonyRevoke）。
 *   · 不删条目不静默：命中条目标 `revoked:true` 并列进 `revokedItems`；
 *   · 撤到无独立支持 ⇒ undecided / withdrawn（**不退化成 contested**）。
 *
 * @param {object} win
 * @param {Array} dropped 被撤证据键（evidenceKey / traceId）
 * @param {{event?:string, at?:number, traces?:Array}} [opts]
 */
export function readTestimonyRevoke(win, dropped, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.testimonyRevoke === 'function');
    const mod = (w && obj(w[TESTIMONY_MODULE_GLOBAL])) || null;
    const moduleHas = !!(mod && typeof mod.revokeEvidence === 'function');
    const base = {
        kind: 'ruby_phone_testimony_revoke',
        version: 1,
        state: '',
        reason: '',
        ok: false,
        droppedCount: 0,
        revokedItems: [],
        unchanged: 0,
        stateBefore: '',
        stateAfter: '',
        changed: false,
        writesNothing: true,
        degraded: false
    };
    if (!engineHas && !moduleHas) return Object.assign({}, base, { reason: 'engine-absent' });
    let got = null;
    try {
        if (engineHas) {
            got = eng.testimonyRevoke(arr(dropped), o);
        } else {
            /* 模块路：先读一次板（**与本件其它读数同一份口径**），再交给上游 revokeEvidence。 */
            const read = readTestimonyBoard(w, Object.assign({}, o, { traces: arr(o.traces) }));
            const board = (read.ok && arr(read.boards).length)
                ? (o.event ? arr(read.boards).filter((b) => b.eventKey === str(o.event))[0] : arr(read.boards)[0])
                : null;
            if (!board) return Object.assign({}, base, { reason: read.reason || 'no-board' });
            got = mod.revokeEvidence({ testimonies: board.testimonies, state: board.state }, arr(dropped));
        }
    } catch (_e) {
        return Object.assign({}, base, { reason: 'unusable' });
    }
    const g = obj(got);
    if (!g) return Object.assign({}, base, { reason: 'unusable' });
    if (Number(g.version) === 0) return Object.assign({}, base, { reason: 'face-absent' });
    if (g.degraded === true) return Object.assign({}, base, { reason: 'unusable', degraded: true });
    const before = str(g.stateBefore);
    const after = str(g.stateAfter);
    return Object.assign({}, base, {
        ok: true,
        reason: '',
        droppedCount: Number(g.droppedCount) || 0,
        revokedItems: arr(g.revokedItems).slice(0, PCX_LIMITS.testimonies).map((it) => ({
            character: str(it && it.character).slice(0, 40),
            evidenceKey: str(it && it.evidenceKey).slice(0, 120),
            traceId: str(it && it.traceId).slice(0, 60),
            was: str(it && it.was)
        })),
        unchanged: Number(g.unchanged) || 0,
        stateBefore: PCX_TB_STATES.indexOf(before) >= 0 ? before : '',
        stateAfter: PCX_TB_STATES.indexOf(after) >= 0 ? after : '',
        /* ★ changed 以**两侧都认得的状态**为准重算：上游给的状态认不出时不谎报「变了」。 */
        changed: (PCX_TB_STATES.indexOf(before) >= 0 && PCX_TB_STATES.indexOf(after) >= 0)
            ? before !== after : g.changed === true
    });
}
/* ---------------------------------------------------------------
 * 作者 / 角色模式（**显式选择**，非法值不猜）
 * ------------------------------------------------------------ */
/**
 * 归一出当前模式。**默认作者**（全知面），但非法值报 `mode-invalid` 而**不猜**：
 *   猜一个默认，等于把「用户选错了」显示成「用户选了作者」，两者处置相反
 *   （前者该让用户重选，后者该换呈现）。
 *
 * @param {string} setting 设置里读到的原始值
 * @returns {{ok:boolean, mode:string, reason:string, text:string}}
 */
export function planPerspectiveMode(setting) {
    const raw = str(setting).toLowerCase();
    if (!raw) return { ok: true, mode: PCX_MODES.AUTHOR, reason: '', text: '作者模式（全知：可并排比较两侧）' };
    if (raw === PCX_MODES.AUTHOR) return { ok: true, mode: PCX_MODES.AUTHOR, reason: '', text: '作者模式（全知：可并排比较两侧）' };
    if (raw === PCX_MODES.CHARACTER) return { ok: true, mode: PCX_MODES.CHARACTER, reason: '', text: '角色模式（只看当前角色可知的内容）' };
    return { ok: false, mode: '', reason: 'mode-invalid', text: PCX_REASONS['mode-invalid'] + '：' + str(setting) };
}
/**
 * 某个模式下**允许进入呈现**的格位。
 *   角色模式：只给当前角色**可知**的三格（亲历 / 听说 / 误信）。
 *     ★ 另两格（`unknown` / `unrecorded`）**不给** —— 它们不是「他知道的内容」，
 *       而是「账里怎么记的」；把它们塞进角色上下文，就是把**元信息**当剧情喂给模型。
 *   作者模式：四格 + 不可用格齐给（作者要看的是账本本身）。
 */
export function modeAllowedSlots(mode) {
    const m = str(mode).toLowerCase();
    if (m === PCX_MODES.CHARACTER) return ['lived', 'heard', 'misled'];
    return ['lived', 'heard', 'misled', 'unknown', 'unrecorded'];
}
/**
 * 角色模式闸：把对照读数裁成**该模式可呈现**的形状。
 *   验收第 ③ 条「作者比较不改变知识账」在实现上的落点就是本函数 ——
 *   它只**读**输入、产出一个**新的呈现对象**，输入一个字节不动。
 *
 * @param {string} mode
 * @param {object} read readPerspectiveContrast 的产出
 * @returns {{mode:string, ok:boolean, chars:Array, onlyMine:Array, sharedFacts:Array,
 *            othersHidden:number, hiddenWhy:string}}
 */
export function gateContrastByMode(mode, read) {
    const plan = planPerspectiveMode(mode);
    const r = obj(read) || {};
    const diff = obj(r.diff) || { onlyLeft: [], onlyRight: [], shared: [], misledSide: [] };
    const chars = arr(r.chars).map(str);
    if (!plan.ok) {
        return { mode: '', ok: false, chars: chars, onlyMine: [], sharedFacts: [], othersHidden: 0, hiddenWhy: plan.reason };
    }
    if (plan.mode === PCX_MODES.AUTHOR) {
        return {
            mode: plan.mode, ok: true, chars: chars,
            onlyMine: arr(diff.onlyLeft), sharedFacts: arr(diff.shared),
            /* 作者模式下**不隐藏任何东西**：它是全知面。 */
            othersHidden: 0, hiddenWhy: ''
        };
    }
    /* 角色模式：当前角色 = **左侧**（调用方把「正在扮演的人」放左边，这是本件的接口约定）。 */
    return {
        mode: plan.mode, ok: true, chars: chars,
        /* 只给「我这边独有的」与「两人共有的」—— 别人独有的一律**不呈现**，
         *   并**如实计数**（不静默抹掉：切回作者模式时要知道少看了几条）。 */
        onlyMine: arr(diff.onlyLeft),
        sharedFacts: arr(diff.shared),
        othersHidden: arr(diff.onlyRight).length,
        hiddenWhy: '角色模式：另 ' + arr(diff.onlyRight).length
            + ' 条是对方独有的信息，当前角色无从知道（切换作者模式可看）'
    };
}
/* ---------------------------------------------------------------
 * 身份面闸（验收第 ② 条：时间拉回揭穿之前**不显示后来真名**）
 * ------------------------------------------------------------ */
/**
 * 按身份面**过滤**一块证词板（只过滤与计数，**不判哪个名字是真名**）。
 *
 *   上游把身份分面给成 `identities:{surface,revealed,homonym,unspecified}`：
 *     · `surface`   揭穿前的明面身份；
 *     · `revealed`  揭穿后的真实身份；
 *     · `homonym`   同名异人（**必须可见**，否则两个人的账会被读成一个人）；
 *     · `unspecified` 未标身份（如实保留，不默认归到 surface）。
 *   本函数在「未揭穿」视图下只呈现 `surface` / `homonym` / `unspecified` 三面，
 *   把 `revealed` 面**整面挡掉并如实计数** —— 这就是「揭穿之前不显示后来真名」
 *   在实现上的落点；**本件不判**哪一条属于哪一面（那是上游 identity 口径）。
 *
 * @param {object} board readTestimonyBoard 的单块 board
 * @param {string} face 'surface'（未揭穿，默认）| 'revealed'（已揭穿）| 'all'
 * @returns {{face:string, visible:Array, hiddenRevealed:number, hiddenSurface:number,
 *            split:boolean, note:string}}
 */
export function visibleAtFace(board, face) {
    const b = obj(board) || {};
    const ids = obj(b.identities) || {};
    const want = str(face).toLowerCase() || 'surface';
    const surface = arr(ids.surface), revealed = arr(ids.revealed),
        homonym = arr(ids.homonym), unspecified = arr(ids.unspecified);
    const split = ids.split === true;
    if (want === 'all') {
        return {
            face: 'all', visible: surface.concat(unspecified, homonym, revealed),
            hiddenRevealed: 0, hiddenSurface: 0, split: split,
            note: split ? '揭穿前后各有一套说法（split）：此处两面**并呈**' : ''
        };
    }
    if (want === 'revealed') {
        return {
            face: 'revealed', visible: revealed.concat(unspecified, homonym),
            hiddenRevealed: 0, hiddenSurface: surface.length, split: split,
            note: '已揭穿视图：明面身份的说法（' + surface.length + ' 条）不再呈现'
        };
    }
    /* 默认：未揭穿视图。`revealed` 面整面挡掉；`homonym` 与 `unspecified` **不许挡**——
     *   前者挡了会把两个人的账读成一个人，后者挡了会把「没标」读成「没有这人」。 */
    return {
        face: 'surface',
        visible: surface.concat(unspecified, homonym),
        hiddenRevealed: revealed.length,
        hiddenSurface: 0,
        split: split,
        note: '未揭穿视图：真实身份的说法（' + revealed.length + ' 条）不呈现'
            + (split ? '；揭穿前后确实各有一套视角（split）' : '')
            + (homonym.length ? '；同名异人 ' + homonym.length + ' 条**照常可见**（挡掉会把两人读成一人）' : '')
    };
}
/* ---------------------------------------------------------------
 * 窄屏 / 宽屏版式（验收第 ④ 条：窄屏逐人切换，不挤成三列）
 * ------------------------------------------------------------ */
/**
 * 按可用宽度决定版式（**纯函数**，不懂 DOM / 不读 window）。
 *   验收原文：「手机窄屏改为逐人切换而非挤成三列」。
 *   `<=` 还是 `<`：恰好等于阈值时按**宽屏**处置（三列在 720px 上还排得开）——
 *   这条边界必须钉死，否则同一台设备在两个版本的手机上会得到两种版式。
 *
 * @param {number} width 可用宽度（px）；读不出（null/负数/非数）⇒ 按**窄屏**处置
 *   （窄屏是保守版式：逐人切换在任何宽度下都排得开，三列在窄屏上会挤成一坨）。
 * @returns {{layout:'paged'|'columns', perPage:number, width:number|null, text:string}}
 */
export function layoutOf(width) {
    const w = Number(width);
    const known = Number.isFinite(w) && w > 0;
    const narrow = !known || w < PCX_LIMITS.narrowWidth;
    return narrow
        ? {
            layout: 'paged', perPage: 1, width: known ? w : null,
            text: known ? '窄屏：逐人切换（一次只看一人）' : '宽度读不出：按窄屏处置（逐人切换）'
        }
        : { layout: 'columns', perPage: 3, width: w, text: '宽屏：可并排对照（最多 3 人同屏）' };
}
/* ---------------------------------------------------------------
 * 生成侧：模式闸下的上下文块
 * ------------------------------------------------------------ */
/**
 * 把对照读数组装成**生成侧**的一段块。**角色模式的核心边界就在这里**：
 *   验收原文「切换不把全知正文塞入角色生成上下文」—— 故角色模式下：
 *     · 只呈现**当前角色可知**的三格（`modeAllowedSlots`）；
 *     · 对方独有的事实（`onlyRight`）**一条都不写进块**；
 *     · 块头逐字写清「这是角色可知面，不是世界真相」。
 *   作者模式：给全知对照（但不落任何账）。
 *   无内容返回 `''`（**不产生空块**：空块会挤占生成预算）。
 *
 * @param {string} mode
 * @param {object} read readPerspectiveContrast 产出
 * @param {{current?:string, maxFacts?:number}} [opts]
 */
export function perspectiveModePromptBlock(mode, read, opts = {}) {
    try {
        const plan = planPerspectiveMode(mode);
        /* 模式非法 ⇒ **不给块**（宁可少一块上下文，也不拿猜出来的模式去喂全知正文）。 */
        if (!plan.ok) return '';
        const r = obj(read) || {};
        if (r.state !== PCX_STATES.OK) return '';
        const o = obj(opts) || {};
        const maxFacts = Math.max(1, Number(o.maxFacts) || 8);
        const gated = gateContrastByMode(plan.mode, r);
        const me = str(o.current) || (gated.chars[0] || '');
        const slotNames = (x) => arr(x.left).map((s) => PCX_SLOTS[s] || s).join('/');
        const lines = [];
        if (plan.mode === PCX_MODES.AUTHOR) {
            lines.push('【双方信息差对照（作者全知面：这是账本读数，不是任何一人的认知）】');
            for (const x of gated.onlyMine.slice(0, maxFacts)) {
                lines.push('-' + (me || '甲') + '独有：' + (x.fact || '') + (slotNames(x) ? '（' + slotNames(x) + '）' : ''));
            }
            for (const x of arr(obj(r.diff) && obj(r.diff).onlyRight).slice(0, maxFacts)) {
                lines.push('-另一侧独有：' + (x.fact || '') + (slotNames(x) ? '（' + slotNames(x) + '）' : ''));
            }
            for (const x of gated.sharedFacts.slice(0, maxFacts)) lines.push('- 双方都有：' + (x.fact || ''));
            if (lines.length === 1) return '';
            return lines.join('\n');
        }
        /* 角色模式：**只写我可知的**。 */
        lines.push('【' + (me || '当前角色') + ' 此刻可知的内容（角色可知面：**不是**世界真相；不得据此写他人的认知）】');
        let n = 0;
        for (const x of gated.onlyMine) {
            if (n >= maxFacts) break;
            lines.push('- ' + (x.fact || '') + (slotNames(x) ? '（' + slotNames(x) + '）' : ''));
            n += 1;
        }
        for (const x of gated.sharedFacts) {
            if (n >= maxFacts) break;
            lines.push('- ' + (x.fact || '') + (slotNames(x) ? '（' + slotNames(x) + '）' : ''));
            n += 1;
        }
        if (lines.length === 1) return '';
        return lines.join('\n');
    } catch (_e) { return ''; }
}
/* ---------------------------------------------------------------
 * 一行读数（各态**分开说**：合并任意两态都会误导「该怎么写」）
 * ------------------------------------------------------------ */
/** 并排对照一行读数。 */
export function contrastLine(read) {
    const r = obj(read) || {};
    if (r.state === PCX_STATES.ENGINE_ABSENT) return '信息差:' + PCX_REASONS['engine-absent'];
    if (r.state === PCX_STATES.FACE_ABSENT) return '信息差:' + PCX_REASONS['face-absent'];
    if (r.state === PCX_STATES.UNUSABLE) return '信息差:' + PCX_REASONS['unusable'];
    if (r.state === PCX_STATES.NO_SUBJECT) return '信息差:' + PCX_REASONS['no-subject'];
    if (r.state === PCX_STATES.EMPTY) return '信息差:' + PCX_REASONS['empty'];
    const d = obj(r.diff) || {};
    const chars = arr(r.chars).map(str);
    const parts = [(chars[0] || '甲') + ' 独有 ' + arr(d.onlyLeft).length,
        (chars[1] || '乙') + ' 独有 ' + arr(d.onlyRight).length,
        '共有 ' + arr(d.shared).length];
    /* ★ 误信侧**必须永远报出来**：它是「别把误信写成世界真相」的落点。 */
    if (arr(d.misledSide).length) parts.push('**误信侧 ' + arr(d.misledSide).length + '（勿当世界真相）**');
    if (r.leftPresent === false || r.rightPresent === false) {
        parts.push('**有一侧没有卡（' + (r.leftPresent === false ? '左' : '') + (r.rightPresent === false ? '右' : '') + '）**');
    }
    return '信息差:' + parts.join(' · ');
}
/** 证词面一行读数（四态 + 未裁决三档分开说）。 */
export function testimonyLine(read) {
    const r = obj(read) || {};
    if (r.state === PCX_STATES.ENGINE_ABSENT) return '证词:' + PCX_REASONS['engine-absent'];
    if (r.state === PCX_STATES.FACE_ABSENT) return '证词:' + PCX_REASONS['face-absent'];
    if (r.state === PCX_STATES.UNUSABLE) return '证词:' + PCX_REASONS['unusable'];
    if (r.state === PCX_STATES.EMPTY) return '证词:' + PCX_REASONS['empty'];
    const c = obj(r.counts) || {};
    const st = obj(c.states) || {};
    const parts = ['事件 ' + (c.boards || 0), '说法 ' + (c.claims || 0)];
    /* ★ 四态**逐态报出**（含 0 以外的一切情形都如实说）。 */
    if (st.supported) parts.push('有据 ' + st.supported);
    if (st.contested) parts.push('**争议未决 ' + st.contested + '（不下结论）**');
    if (st.undecided) parts.push('判不开 ' + st.undecided);
    if (st.withdrawn) parts.push('已撤回 ' + st.withdrawn);
    /* ★ 未裁决三档**分列报出**：合成一格就分不出「为什么暂不能下结论」。 */
    const kinds = { 'ambiguous': 0, 'below-threshold': 0, 'transmittal-only': 0 };
    for (const b of arr(r.boards)) {
        const k = obj(obj(b).disputes).kinds;
        if (k) for (const key of PCX_TB_UNRESOLVED) kinds[key] += Number(k[key]) || 0;
    }
    for (const key of PCX_TB_UNRESOLVED) {
        if (kinds[key]) parts.push('未决·' + key + ' ' + kinds[key]);
    }
    return '证词:' + parts.join(' · ');
}
/* ---------------------------------------------------------------
 * 自检（纯函数式，不抛）：八条口径当场自证
 * ------------------------------------------------------------ */
/**
 * 一 插件不在场 ⇒ engine-absent，**不是** empty（两态不同形）；
 * 二 面 version=0 ⇒ face-absent；
 * 三 出口抛错 ⇒ unusable；
 * 四 ★ 核心：没给两个人 ⇒ no-subject（**不是**「他们都没说法」）；
 * 五 ★ 核心：模式非法 ⇒ mode-invalid 且**不给生成块**（不拿猜的模式喂全知正文）；
 * 六 ★ 核心：角色模式下对方独有的**一条都不进块**，且读数里**不含**百分比 / 置信度键；
 * 七 ★ 核心：未揭穿视图挡掉 `revealed` 面，但 `homonym` / `unspecified` **照常可见**；
 * 八 ★ 核心：宽度读不出 ⇒ 按窄屏（逐人切换）处置 —— 保守版式，任何宽度都排得开。
 */
export function pcxSelfCheck() {
    const problems = [];
    const absent = readPerspectiveContrast(null, '甲', '乙');
    if (absent.state !== PCX_STATES.ENGINE_ABSENT) problems.push('插件不在场应报 engine-absent');
    if (absent.silentCapable !== false) problems.push('降级面不得 silentCapable');
    if (readTestimonyBoard(null, {}).state !== PCX_STATES.ENGINE_ABSENT) problems.push('证词面缺席应报 engine-absent');
    if (readTestimonyRevoke(null, ['k']).reason !== 'engine-absent') problems.push('撤回面缺席应报 engine-absent');
    /* 二：面不在场（上游用 version=0 给同键降级面）。 */
    const faceAbsent = readTestimonyBoard({
        [LONSHA_PLUGIN_GLOBAL]: { engine: { testimonyBoard: () => ({ kind: 'testimony_board', version: 0, boards: [] }) } }
    }, {});
    if (faceAbsent.state !== PCX_STATES.FACE_ABSENT) problems.push('version=0 应报 face-absent');
    /* 三：出口抛错。 */
    const thrown = readPerspectiveContrast({
        [LONSHA_PLUGIN_GLOBAL]: { engine: { perspectiveContrast: () => { throw new Error('boom'); } } }
    }, '甲', '乙');
    if (thrown.state !== PCX_STATES.UNUSABLE) problems.push('出口抛错应报 unusable');
    /* 四：没给两个人。 */
    const noSubject = readPerspectiveContrast({
        [LONSHA_PLUGIN_GLOBAL]: { engine: { perspectiveContrast: () => ({ kind: 'perspective_card@contrast', version: 1, diff: {} }) } }
    }, '', '');
    if (noSubject.state !== PCX_STATES.NO_SUBJECT) problems.push('没给两个人应报 no-subject');
    /* 五：模式非法。 */
    const bad = planPerspectiveMode('omnipotent');
    if (bad.ok !== false || bad.reason !== 'mode-invalid') problems.push('非法模式应报 mode-invalid');
    if (perspectiveModePromptBlock('omnipotent', { state: PCX_STATES.OK, diff: {} }) !== '') {
        problems.push('模式非法时不得给生成块（不拿猜的模式喂上下文）');
    }
    /* 六：角色模式不给对方独有的东西。 */
    const read = {
        state: PCX_STATES.OK, chars: ['甲', '乙'],
        diff: {
            onlyLeft: [{ fact: '甲自己在场', left: ['lived'], right: [] }],
            onlyRight: [{ fact: '乙独有的事', left: [], right: ['lived'] }],
            shared: [{ fact: '两人都知道', left: ['heard'], right: ['heard'] }],
            misledSide: []
        }
    };
    const blk = perspectiveModePromptBlock(PCX_MODES.CHARACTER, read, { current: '甲' });
    if (blk.indexOf('乙独有的事') >= 0) problems.push('角色模式把对方独有的事实塞进了生成上下文');
    if (blk.indexOf('甲自己在场') < 0) problems.push('角色模式漏掉了当前角色自己的可知内容');
    const authorBlk = perspectiveModePromptBlock(PCX_MODES.AUTHOR, read, { current: '甲' });
    if (authorBlk.indexOf('乙独有的事') < 0) problems.push('作者模式应能看到对方独有的事实（全知面）');
    /* 六之二：读数里不得出现百分比 / 置信度键（深度扫描，真跑）。 */
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (PCX_FORBIDDEN_KEYS.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const sample = readTestimonyBoard({
        [LONSHA_PLUGIN_GLOBAL]: {
            engine: {
                testimonyBoard: () => ({
                    kind: 'testimony_board', version: 1,
                    boards: [{
                        eventKey: 'e1', state: 'contested', reason: 'unresolved-dispute',
                        testimonies: [{ character: '甲', statement: '他说他看见了', side: 'affirm', state: 'witnessed', strength: 'strong' }],
                        supports: { independentCount: 1, transmittalCount: 2, firsthandCount: 1 },
                        disputes: {
                            contested: true,
                            items: [{ character: '甲', statement: 'x', kind: 'ambiguous' }],
                            kinds: { 'ambiguous': 1, 'below-threshold': 0, 'transmittal-only': 0 }
                        },
                        identities: { surface: [], revealed: [], homonym: [], unspecified: [], split: false },
                        counts: { testimonies: 1, independent: 1, transmittals: 2, firsthand: 1, unresolved: 1 }
                    }],
                    counts: { events: 1, claims: 1 }
                })
            }
        }
    }, {});
    const hits = scan(sample, []);
    if (hits.length) problems.push('读数里出现了禁用键（百分比 / 置信度一族）：' + hits.join('/'));
    if (sample.state !== PCX_STATES.OK) problems.push('真跑一块板应报 ok');
    if (sample.counts.states.contested !== 1) problems.push('争议未决必须如实计数');
    /* 七：身份面闸不得把同名异人挡掉。 */
    const vis = visibleAtFace({
        identities: {
            surface: [{ character: '明面', statement: 'a' }],
            revealed: [{ character: '真名', statement: 'b' }],
            homonym: [{ character: '同名者', statement: 'c' }],
            unspecified: [{ character: '没标', statement: 'd' }],
            split: true
        }
    }, 'surface');
    if (vis.hiddenRevealed !== 1) problems.push('未揭穿视图应挡掉真实身份的那一条');
    if (vis.visible.some((x) => x.character === '真名')) problems.push('未揭穿视图泄漏了后来真名');
    if (!vis.visible.some((x) => x.character === '同名者')) problems.push('同名异人被挡掉了（会把两人读成一人）');
    if (!vis.visible.some((x) => x.character === '没标')) problems.push('未标身份的条目被挡掉了（会被读成「没这人」）');
    /* 八：窄屏版式（读不出宽度按窄屏处置，保守）。 */
    if (layoutOf(null).layout !== 'paged') problems.push('宽度读不出应按窄屏（逐人切换）处置');
    if (layoutOf(320).layout !== 'paged') problems.push('320px 应按窄屏处置');
    if (layoutOf(1280).layout !== 'columns') problems.push('1280px 应按宽屏处置');
    /* 九：零写面自证（读数里 writesNothing 恒 true）。 */
    if (absent.writesNothing !== true || sample.writesNothing !== true) problems.push('writesNothing 必须恒为 true');
    return { problems: problems };
}
export default {
    PCX_FACE_ID,
    PCX_CONTRAST_FACE_ID,
    PCX_STATES,
    PCX_REASONS,
    PCX_MODES,
    PCX_SLOTS,
    PCX_IDENTITY_FACES,
    PCX_IDENTITY_VIEWS,
    PCX_TB_STATES,
    PCX_TB_CLAIM_STATES,
    PCX_TB_UNRESOLVED,
    PCX_TB_SIDES,
    PCX_FORBIDDEN_KEYS,
    PCX_LIMITS,
    readPerspectiveContrast,
    readTestimonyBoard,
    readTestimonyRevoke,
    planPerspectiveMode,
    modeAllowedSlots,
    gateContrastByMode,
    visibleAtFace,
    layoutOf,
    perspectiveModePromptBlock,
    contrastLine,
    testimonyLine,
    pcxSelfCheck
};
