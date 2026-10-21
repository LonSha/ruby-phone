/* ============================================================
 * config/hypo-trial-contract.js — [v4.47.0 · 第五期 R5-X7]
 *   可丢弃的假设场景双栏试写 —— **纯契约件**
 *   （零 DOM / 零存储 / 零时钟 / 零网络：可在合成输入上复算）
 * ------------------------------------------------------------
 * 【计划原文（R5-X7）】
 *   「选择基线时点与两种假设，分别预览材料 / 约束并可显式试写；对照文本保留为草稿；
 *     只有用户选择转为正式分支后才调用原接续确认。」
 *   落点与依赖：creationdesk / pvdesk 既有草稿和生成队列 + M5-X7；复用 O1 交接，
 *     取消沿原请求生命周期。**必须验证生成通道不会隐式登记假设事实。**
 *   验收四条：① A 接受邀请、B 拒绝邀请同基线输出可比；② 试写前后正史事实不变；
 *     ③ 关页重开保留草稿但不自动生成；④ 丢弃清临时选择，正式采纳不双建分支。
 *   不做三条：不自动多模型竞赛 / 不后台无限续写 / 不增加第二套生成 API。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   全仓 `grep -rIn '双栏试写' apps config` **零命中** —— 正史选择
 *   （`config/branch-canon-contract.js`，v4.28.0）只能对**已经存在的**两条分支做
 *   「选哪条进新卷」；而「还没创建正式分支前，先拿两种假设各试写一栏看看」这一步
 *   **没有任何落点**。后果三件，都不是报错：
 *     ① 用户只能先在脑子里比，或者干脆**先建一条正式分支再删** —— 而正式分支是既成
 *        结局，建了就有痕迹，「预演」被读成「已经这么定了」；
 *     ② 「两栏的基线不同」与「两栏同基线可比」在界面上**同形**（都只是两段文本），
 *        而两者处置相反：前者要先对齐基线才谈得上对照，后者才真可对照；
 *     ③ 「丢弃」没有范围：没有「哪些是本次预演落的 / 哪些是正史本来的」的分列读数，
 *        于是「丢弃」很容易做成「把这些键全删」—— 预演没伤到正史，反而被它删了。
 *
 * 【本件只做四件事（不重算任何上游判定，也不新增生成通道）】
 *   1 **取数**：上游试写面探测一律转上游出口（`readHypoTrial`）；本件不另写一份
 *      「试写口在不在」的判定；上游不在 ⇒ 如实报缺席，**不退回本地猜一份**；
 *   2 **分列**：面五态 / 逐栏三态 / 可比性三态 / 三种决定（采纳·保留·丢弃）——
 *      全部**结构上分开**，任意两态都不许压平；
 *   3 **零写正史**：本件一个正史字节都不落（`canonWrites` 恒 0；契约层
 *      `writesNothing` 恒 true）。落笔只有一处 —— 既有草稿本 `cw_drafts`
 *      （`source: HY_DRAFT_SOURCE`）；转正式分支**一律**转交上游接续确认
 *      （`adoptGate` 只判「能不能转」，不自己转）；
 *   4 **不判优劣**：两栏对照只做**字段级 diff**（哪些字段不同、各是什么），
 *      不排序、不评分、不给推荐 —— 禁用键深度扫描守这一条
 *      （计划原文「不自动多模型竞赛」）。
 *
 * 【为什么「可比性」必须自己占一格（本件最贵的一条）】
 *   两栏同基线 ⇒ 差异**来自假设本身**，这才叫「可比」；
 *   两栏基线不同 ⇒ 差异里混着基线差，读出来的是「两段不同的故事」，不是「同一场景的
 *   两种走向」。压成一格会让用户把「换了基线的两段」当成「同一场景的两条岔路」去选 ——
 *   不报错、只是错读数。
 *
 * 【边界（如实登记，不装）】
 *   · 本件**不生成**文本：试写文本由用户显式写入或由**上游既有生成通道**产出，
 *     本件只把它收成草稿（计划原文「不增加第二套生成 API」）；
 *   · 本件**不采纳**：`adoptGate` 判完即止，真正接续归上游 owner；
 *   · 本件**不读时钟**：`at` / `writtenAt` 一律由调用方给（纯函数可复算）。
 * ============================================================ */
'use strict';
/* ★ 数值取值门走**全仓唯一实现**（config/num-gate.js），不在本文件就地再写一份。 */
import { numOrNull } from './num-gate.js';

/** 上游插件全局名（与其它契约模块读的是同一个）。 */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游假设试写模块全局名（模块路：engine 路缺席时用于「面在不在场」的判定）。 */
const HYPO_MODULE_GLOBAL = 'LonShaHypoTrial';
/** 上游面 id（与上游 open_face_registry.tsv / 本仓 crossrepo-registry.js 同一口径）。 */
export const HY_FACE_ID = 'hypoTrial';
/** 五态（输入不合格 / 上游不在 / 本机读不出 / 就绪但没试写 / 有试写文本）。 */
export const HY_STATES = Object.freeze({
    REFUSED: 'refused',
    ABSENT: 'absent',
    UNREADABLE: 'unreadable',
    EMPTY: 'empty',
    READY: 'ready'
});
/** 归因词（两两不同形；不许压成一句「还没好」）。 */
export const HY_REASONS = Object.freeze({
    ok: '假设试写区就绪',
    'no-baseline': '没给基线时点（两栏都从哪一刻起，先说清）',
    'bad-baseline': '基线时点读不出（给了但不认识）',
    'no-assume': '有一栏没写假设（两栏才谈得上对照）',
    'same-assume': '两栏是同一个假设（并列没有意义 —— 换个走向再试）',
    'no-outlet': '上游没有假设试写面（**不许**把「手工写的草稿」读成「试写跑过了」）',
    'unreadable': '基线材料读不到（本机读不出，**不是**「这一刻没有材料」）',
    'empty': '两栏都还没试写（不是「试写失败」）',
    'not-comparable': '两栏基线不同 —— 差异里混着基线差，**不是**同一场景的两条岔路',
    'missing-baseline': '有一栏没记基线（比不了：不知道各自从哪一刻起）',
    'lane-pending': '这一栏还没试写（不是「试写失败」）',
    'not-written': '两栏都得先有试写文本，才谈得上采纳',
    'no-upstream': '上游接续面不在场 —— 转不了正式分支（**不是**「没有可采纳的内容」）',
    'adopt-refused': '这一栏没被选中（采纳的是你选中的那一栏）',
    discarded: '本次预演已丢弃：临时选择清了，正史一个字节没动'
});
/** 各态的**给用户看的一句处置建议**（与 HY_REASONS 的短归因分工不同）。 */
export const HY_STATE_HINT = Object.freeze({
    refused: '这一屏还起不来：把基线时点与两栏各自的假设补上',
    absent: '上游没有假设试写面 —— 可以先在本机手工写两栏草稿（**预演不是既成结局**），转正式分支要等上游',
    unreadable: '基线材料读不到（出口报错 / 面畸形 / 装配未到）—— 这不是「这一刻没有材料」',
    empty: '两栏都还空着：写两栏假设，再显式试写',
    ready: '两栏都在这了 —— 对照看差异，逐栏决定保留或丢弃'
});
/** 恰两栏（**穷尽**：本项只比两栏；要第三栏就再来一次试写）。 */
export const HY_LANES = Object.freeze(['a', 'b']);
export const HY_LANE_LABEL = Object.freeze({ a: '假设 A', b: '假设 B' });
/** 逐栏三态（还没写 / 有文本 / 这一栏的假设不合格）。 */
export const HY_LANE_STATES = Object.freeze({
    PENDING: 'pending',
    WRITTEN: 'written',
    REFUSED: 'refused'
});
export const HY_LANE_STATE_LABEL = Object.freeze({
    pending: '还没试写',
    written: '已有试写文本',
    refused: '这一栏的假设不合格'
});
/** 假设的种类（**穷尽**；`custom` 一律原样留名，不许静默丢掉）。 */
export const HY_ASSUME_KINDS = Object.freeze(['accept', 'reject', 'custom']);
export const HY_ASSUME_LABEL = Object.freeze({
    accept: '接受',
    reject: '拒绝',
    custom: '自定义'
});
/** 可比性三态（**本件最贵的一格**：同基线才叫「同一场景的两条岔路」）。 */
export const HY_COMPARABLE = Object.freeze({
    SAME: 'same-baseline',
    DIFF: 'different-baseline',
    MISSING: 'missing-baseline'
});
export const HY_COMPARABLE_LABEL = Object.freeze({
    'same-baseline': '同基线可比（差异来自假设本身）',
    'different-baseline': '基线不同：差异里混着基线差，不能当同一场景的两条岔路读',
    'missing-baseline': '有一栏没记基线：比不了（不知道各自从哪一刻起）'
});
/** 三种决定（**穷尽**：采纳 / 保留 / 丢弃；不得现编动作名）。 */
export const HY_DECISIONS = Object.freeze(['adopt', 'keep', 'discard']);
export const HY_DECISION_LABEL = Object.freeze({
    adopt: '转为正式分支',
    keep: '保留为草稿',
    discard: '丢弃这次预演'
});
/** 禁用键（计划原文「不自动多模型竞赛」⇒ 本件不排序、不评分、不给推荐）。 */
export const HY_FORBIDDEN_KEYS = Object.freeze([
    'score', 'rank', 'ranking', 'recommend', 'recommendation', 'better', 'best',
    'winner', 'quality', 'rating', 'preferred', 'confidence'
]);
/** 上限（读不出与 0 是两件事；超限一律**如实报**，不静默截断）。 */
export const HY_LIMITS = Object.freeze({
    lanes: 2,
    textMax: 4000,
    previewRefs: 40,
    drafts: 24
});
/** 草稿行的来源标识（**与 App 内容来源分开**：预演不是 App 内容，也不是记忆事实）。 */
export const HY_DRAFT_SOURCE = 'hypo-trial';
/** 本机键（随会话隔离：换角色不带着上一个角色的预演）。
 *
 * ★ 键名为什么必须带 `cw_` 前缀（本版自己抓到的缺陷，**门禁看不见**）：
 *   首版键名是 `hy_trial`，它**不命中 `config/storage.js` 的 CHAT_DATA_PATTERNS 任何一条**
 *   ⇒ `PhoneStorage._isChatData()` 判 false ⇒ 落进 **extensionSettings（全局）**，
 *   于是「换角色后上一个角色的两栏预演还在」。这正是本仓 v2.8.10 那类串味事故
 *   （成就 / 抽卡 / 生理 / 塔罗互相污染）的同族形态：**不报错、不崩溃、只错数据**。
 *   为什么 `keys` 门（K1/K2/K3）没抓住它：那门只抽三类键面 —— storage 调用的字面量实参、
 *   键常量声明、以及 `this.<prop>` 间接键；**对象字面量里的键值不在射程内**
 *   （`HY_KEYS = Object.freeze({ trial: … })` 正属此形）——
 *   与同族的 `MBH_KEYS.pending`（`cw_board_chat_pending`）处境相同。
 *   故本件的归属**只能靠前缀族保证**，不能靠登记表；判据见
 *   `tests/system-v4470.test.mjs` 的 A4（逐键真跑 `_isChatData` 等价正则）。
 *   选 `cw_` 而不是新开 `/^hy_/` 前缀：`cw_` 就是「创作工作台本机数据」族
 *   （`cw_published` / `cw_drafts` / `cw_topics` / `cw_board_chat_pending` 同族），
 *   本件是创作台的一面 —— 新开前缀会让「这一族有哪几个键」多一处要维护。 */
export const HY_KEYS = Object.freeze({
    trial: 'cw_hy_trial'
});
/** 字符串归一（null / undefined ⇒ 空串；不做 trim 之外的加工）。 */
function str(v) {
    return (v === null || v === undefined) ? '' : String(v);
}
/**
 * 假设归一。`custom` 原样留名（静默丢掉会让用户以为那次输入不存在）。
 * @returns {{ok:boolean, why:string, assume:{kind,kindLabel,text,rawKind}}}
 */
export function normalizeAssume(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const kind = str(r.kind).trim();
    const text = str(r.text).trim();
    const out = { kind: 'custom', kindLabel: HY_ASSUME_LABEL.custom, text: text, rawKind: kind };
    if (!kind) return { ok: false, why: 'no-assume', assume: out };
    if (HY_ASSUME_KINDS.indexOf(kind) >= 0) {
        out.kind = kind;
        out.kindLabel = HY_ASSUME_LABEL[kind];
    }
    if (!text) return { ok: false, why: 'no-assume', assume: out };
    if (text.length > HY_LIMITS.textMax) {
        out.text = text.slice(0, HY_LIMITS.textMax);
        out.truncated = true;
        out.keptChars = HY_LIMITS.textMax;
    }
    return { ok: true, why: '', assume: out };
}
/**
 * 基线归一。**「没给」与「给了但不认识」不同形**（前者等用户补，后者是输入坏了）。
 * @returns {{ok:boolean, why:string, baseline:{at:number|null, label:string, given:boolean}}}
 */
export function normalizeBaseline(raw) {
    if (raw === null || raw === undefined || raw === '') {
        return { ok: false, why: 'no-baseline', baseline: { at: null, label: '', given: false } };
    }
    const r = (typeof raw === 'object') ? raw : { at: raw };
    const at = numOrNull(r.at);
    const label = str(r.label).trim();
    if (at === null) {
        return { ok: false, why: 'bad-baseline', baseline: { at: null, label: label, given: true } };
    }
    return { ok: true, why: '', baseline: { at: at, label: label, given: true } };
}
/** 逐栏一行读数（界面文案的唯一出处之一；判据直接读它）。 */
export function laneLine(lane) {
    const l = (lane && typeof lane === 'object') ? lane : {};
    const id = str(l.id) || '?';
    const name = HY_LANE_LABEL[id] || id;
    if (l.state === HY_LANE_STATES.REFUSED) {
        return name + '：' + (HY_REASONS[str(l.assumeWhy)] || '这一栏的假设不合格');
    }
    const head = name + '·' + (str(l.assume && l.assume.kindLabel) || HY_ASSUME_LABEL.custom);
    if (l.state === HY_LANE_STATES.PENDING) return head + '：还没试写（不是「试写失败」）';
    return head + '：已有 ' + String(l.chars || 0) + ' 字试写文本（**预演，不是既成结局**）';
}
/** 逐栏归一（栏 id 只认 HY_LANES；其余一律拒，不静默改名）。 */
export function normalizeLane(id, raw) {
    const laneId = str(id).trim();
    if (HY_LANES.indexOf(laneId) < 0) {
        return { ok: false, why: 'no-assume', lane: null };
    }
    const r = (raw && typeof raw === 'object') ? raw : {};
    const as = normalizeAssume(r.assume);
    const bl = normalizeBaseline(r.baseline);
    const text = str(r.text);
    const lane = {
        id: laneId,
        label: HY_LANE_LABEL[laneId],
        assume: as.assume,
        assumeOk: as.ok,
        assumeWhy: as.why,
        baseline: bl.baseline,
        baselineOk: bl.ok,
        baselineWhy: bl.why,
        text: text,
        chars: text.length,
        writtenAt: numOrNull(r.writtenAt),
        state: (as.ok ? (text ? HY_LANE_STATES.WRITTEN : HY_LANE_STATES.PENDING) : HY_LANE_STATES.REFUSED)
    };
    lane.line = laneLine(lane);
    return { ok: as.ok, why: as.why, lane: lane };
}
/**
 * 两栏对照（**字段级 diff**，不做优劣判定）。
 *   ★ 同基线才叫「可比」；基线不同 ⇒ `comparable` 报 different-baseline，
 *     差异行照列但**每一行都带 `mixedWithBaseline: true`** ——
 *     让界面能说清「这一条差异里混着基线差」。
 * @returns {{comparable:string, label:string, why:string, diff:Array, diffCount:number}}
 */
export function compareLanes(a, b) {
    const la = (a && typeof a === 'object') ? a : {};
    const lb = (b && typeof b === 'object') ? b : {};
    const ba = la.baseline || {};
    const bb = lb.baseline || {};
    let comparable = HY_COMPARABLE.SAME;
    if (ba.given !== true || bb.given !== true || ba.at === null || bb.at === null) {
        comparable = HY_COMPARABLE.MISSING;
    } else if (Number(ba.at) !== Number(bb.at)) {
        comparable = HY_COMPARABLE.DIFF;
    }
    const mixed = (comparable !== HY_COMPARABLE.SAME);
    const rows = [];
    const push = (field, fa, fb) => {
        const sa = str(fa);
        const sb = str(fb);
        rows.push({
            field: field,
            a: sa,
            b: sb,
            same: sa === sb,
            mixedWithBaseline: mixed
        });
    };
    push('假设', (la.assume && la.assume.kindLabel) || '', (lb.assume && lb.assume.kindLabel) || '');
    push('假设说明', (la.assume && la.assume.text) || '', (lb.assume && lb.assume.text) || '');
    push('基线时点', ba.given === true ? String(ba.at) : '', bb.given === true ? String(bb.at) : '');
    push('试写文本', la.text || '', lb.text || '');
    const changed = rows.filter((r) => !r.same);
    return {
        comparable: comparable,
        label: HY_COMPARABLE_LABEL[comparable],
        why: (comparable === HY_COMPARABLE.SAME)
            ? '同基线 ⇒ 差异来自假设本身'
            : (comparable === HY_COMPARABLE.DIFF
                ? '两栏基线不同：差异里混着基线差，**不是**同一场景的两条岔路'
                : '有一栏没记基线：比不了（不知道各自从哪一刻起）'),
        diff: rows,
        changed: changed,
        diffCount: changed.length
    };
}
/**
 * 试写区归一（两栏 + 基线 + 用户选中的那一栏）。
 *   ★ 两栏同一假设 ⇒ 拒（并列没有意义）；**但不清掉用户写过的文本**。
 * @returns {{ok, why, trial, refusedLanes:Array<string>}}
 */
export function normalizeTrial(input) {
    const src = (input && typeof input === 'object') ? input : {};
    const bl = normalizeBaseline(src.baseline);
    const lanesSrc = (src.lanes && typeof src.lanes === 'object') ? src.lanes : {};
    const lanes = {};
    const refusedLanes = [];
    for (const id of HY_LANES) {
        const raw = lanesSrc[id];
        const one = normalizeLane(id, raw);
        /* 栏自己的基线没记时，**继承整块的基线**（用户只填一次，不必两栏各填一遍）。 */
        if (one.lane && one.lane.baseline.given !== true && bl.ok) {
            one.lane.baseline = bl.baseline;
            one.lane.baselineOk = true;
            one.lane.baselineWhy = '';
            one.lane.line = laneLine(one.lane);
        }
        lanes[id] = one.lane;
        if (!one.ok) refusedLanes.push(id);
    }
    const trial = {
        baseline: bl.baseline,
        baselineOk: bl.ok,
        baselineWhy: bl.why,
        lanes: lanes,
        picked: HY_LANES.indexOf(str(src.picked).trim()) >= 0 ? str(src.picked).trim() : ''
    };
    /* 两栏同一假设 ⇒ 拒（但两栏的文本与选择**都留着**：换一个走向就能接着写）。
     * 判定**有顺序**（顺序倒了就报错因）：基线是先决条件 —— 没有基线，
     * 「两栏对照」根本无从谈起，故缺基线优先于「这一栏没写假设」。 */
    const ka = lanes.a && lanes.a.assume ? (lanes.a.assume.kind + '|' + lanes.a.assume.text) : '';
    const kb = lanes.b && lanes.b.assume ? (lanes.b.assume.kind + '|' + lanes.b.assume.text) : '';
    let why = '';
    if (!bl.ok) why = bl.why || 'no-baseline';
    else if (refusedLanes.length > 0) why = 'no-assume';
    else if (ka && kb && ka === kb) why = 'same-assume';
    return { ok: why === '', why: why, trial: trial, refusedLanes: refusedLanes };
}
/**
 * 上游试写面探测（**只读**：出口在不在、面在不在）。
 *   上游不在 ⇒ 如实报缺席，**不退回本地猜一份**。
 */
export function readHypoTrial(win, opts) {
    const w = win || {};
    const o = (opts && typeof opts === 'object') ? opts : {};
    let engine = null;
    let moduleRef = null;
    try { engine = w[LONSHA_PLUGIN_GLOBAL] || null; } catch (_e) { engine = null; }
    try { moduleRef = w[HYPO_MODULE_GLOBAL] || null; } catch (_e) { moduleRef = null; }
    const hasEngine = !!engine;
    const hasFace = !!(engine && typeof engine.hypoTrialState === 'function');
    const hasWrite = !!(engine && typeof engine.hypoTrialWrite === 'function');
    const hasModule = !!moduleRef;
    const given = o.materials !== undefined && o.materials !== null;
    const materialsReadable = (o.materialsReadable !== undefined) ? (o.materialsReadable === true) : given;
    let state = HY_STATES.ABSENT;
    let reason = 'no-outlet';
    if (hasFace || hasWrite) {
        state = materialsReadable ? HY_STATES.EMPTY : HY_STATES.UNREADABLE;
        reason = materialsReadable ? 'empty' : 'unreadable';
    }
    return {
        state: state,
        reason: reason,
        hasEngine: hasEngine,
        hasFace: hasFace,
        hasWrite: hasWrite,
        hasModule: hasModule,
        materialsGiven: given,
        materialsReadable: materialsReadable,
        /* ★ 上游缺席时**照样**能做本机手工试写（计划原文的降级口径）： */
        localOnly: !(hasFace || hasWrite),
        hint: HY_STATE_HINT[state] || ''
    };
}
/**
 * 转正式分支的闸（**只判，不转**）。
 *   ★ 上游接续面不在场 ⇒ 报 `no-upstream`，**不许**报「没有可采纳的内容」
 *     （两者处置相反：一个是等上游，一个是回去写）。
 */
export function adoptGate(trial, upstream) {
    const t = (trial && typeof trial === 'object') ? trial : {};
    const up = (upstream && typeof upstream === 'object') ? upstream : {};
    const lanes = t.lanes || {};
    const a = lanes.a || {};
    const b = lanes.b || {};
    const writtenA = a.state === HY_LANE_STATES.WRITTEN;
    const writtenB = b.state === HY_LANE_STATES.WRITTEN;
    if (!writtenA && !writtenB) {
        return { ok: false, why: 'not-written', hint: HY_REASONS['not-written'] };
    }
    const picked = HY_LANES.indexOf(str(t.picked).trim()) >= 0 ? str(t.picked).trim() : '';
    if (!picked) {
        return { ok: false, why: 'adopt-refused', hint: HY_REASONS['adopt-refused'] };
    }
    if (up.hasAdoptFace !== true) {
        return { ok: false, why: 'no-upstream', hint: HY_REASONS['no-upstream'], picked: picked };
    }
    return { ok: true, why: 'ok', picked: picked, hint: '转交上游接续确认（本件不自己落卷）' };
}
/**
 * 丢弃计划（**范围必须说清**：只清本次预演的临时选择，正史一个字节不动）。
 */
export function discardPlan(trial) {
    const t = (trial && typeof trial === 'object') ? trial : {};
    const lanes = t.lanes || {};
    const rows = [];
    for (const id of HY_LANES) {
        const l = lanes[id] || {};
        rows.push({
            lane: id,
            label: HY_LANE_LABEL[id],
            hadText: !!(l.text && l.text.length),
            chars: Number(l.chars) || 0
        });
    }
    return {
        lanes: rows,
        clearedTexts: rows.filter((r) => r.hadText).length,
        clearedChars: rows.reduce((n, r) => n + (r.hadText ? r.chars : 0), 0),
        canonWrites: 0,
        writesNothing: true,
        note: HY_REASONS.discarded
    };
}
/** 一面读数（界面文案的唯一出处：面态 / 可比性 / 采纳闸 / 丢弃计划全从这里出）。 */
export function trialLine(read) {
    const r = (read && typeof read === 'object') ? read : {};
    const st = str(r.state);
    if (st === HY_STATES.REFUSED) return '假设试写：' + (HY_REASONS[str(r.reason)] || '输入不合格');
    if (st === HY_STATES.ABSENT) return '假设试写：' + HY_REASONS['no-outlet'];
    if (st === HY_STATES.UNREADABLE) return '假设试写：' + HY_REASONS.unreadable;
    if (st === HY_STATES.EMPTY) {
        return '假设试写：两栏都还空着（不是「试写失败」）· 预演**不是既成结局**';
    }
    const c = r.comparable || {};
    const written = (typeof r.written === 'number')
        ? r.written
        : HY_LANES.filter((id) => {
            const l = (r.lanes || {})[id] || {};
            return l.state === HY_LANE_STATES.WRITTEN;
        }).length;
    return '假设试写：两栏就绪（' + String(written) + '/2 栏有文本）· ' + str(c.label || '')
        + ' · 预演**不是既成结局**';
}
/** 禁用键深度扫描（计划原文「不自动多模型竞赛」的落点；自检里**真跑**一次）。 */
export function hasForbiddenKey(o, depth) {
    const max = (typeof depth === 'number') ? depth : 6;
    if (max < 0) return null;
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) {
        for (const v of o) {
            const hit = hasForbiddenKey(v, max - 1);
            if (hit) return hit;
        }
        return null;
    }
    const keys = Object.keys(o);
    for (const k of keys) {
        if (HY_FORBIDDEN_KEYS.indexOf(String(k).toLowerCase()) >= 0) return String(k);
    }
    for (const k of keys) {
        const hit = hasForbiddenKey(o[k], max - 1);
        if (hit) return hit;
    }
    return null;
}
/**
 * 自证（**真跑**：返回 problems 数组，空数组即全绿）。
 */
export function hySelfCheck() {
    const problems = [];
    const add = (cond, msg) => { if (!cond) problems.push(msg); };
    /* 1 五态互不同形 */
    const st = Object.values(HY_STATES);
    add(new Set(st).size === st.length, '五态值必须唯一');
    add(HY_STATES.UNREADABLE !== HY_STATES.ABSENT, '「读不到」与「上游不在」处置相反');
    add(HY_STATES.EMPTY !== HY_STATES.ABSENT, '「就绪但没试写」与「上游不在」处置相反');
    add(HY_STATES.REFUSED !== HY_STATES.EMPTY, '「输入不合格」与「还没试写」处置相反');
    /* 2 逐栏三态互不同形 */
    const ls = Object.values(HY_LANE_STATES);
    add(new Set(ls).size === ls.length, '逐栏三态值必须唯一');
    add(HY_LANE_STATES.PENDING !== HY_LANE_STATES.REFUSED, '「还没写」与「这一栏不合格」处置相反');
    /* 3 可比性三态互不同形 */
    const cp = Object.values(HY_COMPARABLE);
    add(new Set(cp).size === cp.length, '可比性三态值必须唯一');
    add(HY_COMPARABLE.SAME !== HY_COMPARABLE.DIFF, '同基线可比与基线不同处置相反');
    /* 4 恰两栏 */
    add(HY_LANES.length === HY_LIMITS.lanes, '栏数必须等于上限');
    /* 5 三种决定互不同形 */
    add(HY_DECISIONS.length === 3, '决定必须恰三种');
    add(new Set(Object.values(HY_DECISION_LABEL)).size === 3, '三种决定的标签必须不同形');
    /* 6 缺基线 ⇒ 拒 */
    const n1 = normalizeTrial({ lanes: { a: { assume: { kind: 'accept', text: '她来' } } } });
    add(n1.ok === false && n1.why === 'no-baseline', '缺基线必须拒');
    /* 7 两栏同一假设 ⇒ 拒，且文本留着 */
    const n2 = normalizeTrial({
        baseline: 20,
        lanes: {
            a: { assume: { kind: 'accept', text: '她来' }, text: 'A 文本' },
            b: { assume: { kind: 'accept', text: '她来' }, text: 'B 文本' }
        }
    });
    add(n2.ok === false && n2.why === 'same-assume', '两栏同一假设必须拒');
    add(str(n2.trial.lanes.a.text) === 'A 文本', '拒了也要留着用户写过的文本');
    /* 8 两栏不同假设 + 同基线 ⇒ 就绪 */
    const n3 = normalizeTrial({
        baseline: 20,
        lanes: {
            a: { assume: { kind: 'accept', text: '她来' }, text: 'A 文本' },
            b: { assume: { kind: 'reject', text: '她不来' }, text: 'B 文本' }
        }
    });
    add(n3.ok === true, '两栏不同假设 + 同基线必须就绪');
    /* 9 同基线 ⇒ 可比；基线不同 ⇒ different-baseline */
    const c1 = compareLanes(n3.trial.lanes.a, n3.trial.lanes.b);
    add(c1.comparable === HY_COMPARABLE.SAME, '同基线必须报 same-baseline');
    add(c1.changed.every((r) => r.mixedWithBaseline === false), '同基线的差异行不得标「混着基线差」');
    const laneB2 = normalizeLane('b', { assume: { kind: 'reject', text: '她不来' }, baseline: 30, text: 'B' }).lane;
    const c2 = compareLanes(n3.trial.lanes.a, laneB2);
    add(c2.comparable === HY_COMPARABLE.DIFF, '基线不同必须报 different-baseline');
    add(c2.changed.every((r) => r.mixedWithBaseline === true), '基线不同时差异行必须标「混着基线差」');
    /* 10 基线缺一栏 ⇒ missing */
    const laneB3 = normalizeLane('b', { assume: { kind: 'reject', text: '她不来' } }).lane;
    add(compareLanes(n3.trial.lanes.a, laneB3).comparable === HY_COMPARABLE.MISSING,
        '有一栏没记基线必须报 missing-baseline');
    /* 11 上游不在 ⇒ 缺席，且 localOnly */
    const up = readHypoTrial({});
    add(up.state === HY_STATES.ABSENT, '上游不在必须报缺席');
    add(up.localOnly === true, '上游不在仍要允许本机手工试写');
    /* 12 上游在 + 材料可读 ⇒ empty（不是 ready） */
    const up2 = readHypoTrial({ LonShaMemory: { hypoTrialState: () => ({}) } },
        { materials: [], materialsReadable: true });
    add(up2.state === HY_STATES.EMPTY, '上游在且材料可读、还没试写 ⇒ empty');
    /* 13 上游在 + 材料读不到 ⇒ unreadable（不是 empty） */
    const up3 = readHypoTrial({ LonShaMemory: { hypoTrialState: () => ({}) } },
        { materials: null, materialsReadable: false });
    add(up3.state === HY_STATES.UNREADABLE, '材料读不到必须报 unreadable');
    /* 14 采纳闸三因分形 */
    add(adoptGate({ lanes: {} }, { hasAdoptFace: true }).why === 'not-written', '没文本必须 not-written');
    add(adoptGate(n3.trial, { hasAdoptFace: true }).why === 'adopt-refused', '没选栏必须 adopt-refused');
    add(adoptGate({ lanes: n3.trial.lanes, picked: 'a' }, { hasAdoptFace: false }).why === 'no-upstream',
        '上游不在必须 no-upstream（不是「没有可采纳的内容」）');
    add(adoptGate({ lanes: n3.trial.lanes, picked: 'a' }, { hasAdoptFace: true }).ok === true, '齐备必须放行');
    /* 15 丢弃计划：只清预演，正史零写 */
    const dp = discardPlan(n3.trial);
    add(dp.canonWrites === 0 && dp.writesNothing === true, '丢弃必须零写正史');
    add(dp.clearedTexts === 2, '丢弃要如实报清掉几栏文本');
    /* 16 禁用键真跑一次 */
    add(hasForbiddenKey({ a: { b: { score: 1 } } }) === 'score', '禁用键扫描必须真能命中');
    add(hasForbiddenKey({ a: { b: { note: 'x' } } }) === null, '干净对象不得误报');
    return { ok: problems.length === 0, problems: problems, lanes: HY_LANES.length, states: st.length };
}
export default {
    HY_FACE_ID, HY_STATES, HY_REASONS, HY_LANES, HY_LANE_LABEL, HY_LANE_STATES,
    HY_ASSUME_KINDS, HY_COMPARABLE, HY_DECISIONS, HY_LIMITS, HY_KEYS, HY_DRAFT_SOURCE,
    normalizeAssume, normalizeBaseline, normalizeLane, normalizeTrial, laneLine,
    compareLanes, readHypoTrial, adoptGate, discardPlan, trialLine, hasForbiddenKey, hySelfCheck
};