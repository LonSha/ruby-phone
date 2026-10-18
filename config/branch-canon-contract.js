/* ============================================================
 * branch-canon-contract.js — [v4.28.0 · 第四期 R4-X4]
 *   「支线结局选择与接续工作区」纯契约件（**只读**：比较结局 → 选择 → 预览接续）
 *
 * 【计划原文（R4-X4）】
 *   「选择哪条结果成为后续正史，保留其他支线供回看；不让两条互斥结局同时进入新卷。」
 *   落点与依赖：archive/memory 既有入口，接 M4-O6、M4-X3；**手机只读选择预览并转原生确认，
 *     分卷写入和撤销归上游 owner**。
 *   验收五条：① 两支线三个冲突位；② 选择部分时不能假装完成；③ 确认后新卷只读选中结局；
 *     ④ 撤回只撤本次接续，原分支原文不变；⑤ 缺上游能力显示不可用。
 *   不做三条：不把游戏存档管理重写一遍、不自动判定哪条故事更好、不暗改原聊天。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游 branch-canon.js 的出口齐全 —— 选择面（v3.328.0 · M3-X6）给
 *   `branchCanonState / Decide / Plan / Preview / Revoke`，落卷面（v3.342.0 · M4-X3）给
 *   `storyCanonAdoptPlan / Adoption / RevokeGuard`；本仓 `config/branch-contrast.js`
 *   也已能「选两分支 → 看角色/约定/财务/剧情时间四组语义变化」。而手机侧
 *   `grep -RIn 'branchCanon' apps config` **零命中** ⇒「比较结局 → 选择 → 创建后续」
 *   这条旅程**断在中间**：用户能看两支线差在哪，却没有一处能把「选哪条进新卷」做完。
 *   后果三件，都不是报错：
 *     ① 「还有冲突位没选」与「选了但没东西可接」在界面上**同形**（都读成「还没好」），
 *        而两者处置相反：前者该回去选，后者该去补结局条文；
 *     ② 「撤回」没有范围：没有「哪些是本次接续落的 / 哪些是原分支的 / 哪些是后来手工新增的」
 *        的分列读数，于是「撤回」很容易做成「把这个键上的条目全删」——
 *        原分支原文与用户自己补的事实一起没了；
 *     ③ 缺上游能力时容易报成「两条结局没有冲突」——**替上游作证**（本仓最贵的老账形态）。
 *
 * 【本件只做四件事（不重算任何上游判定）】
 *   1 **取数**：六路读数（逐冲突列举 / 选择计划 / 交接预览 / 落卷计划 / 落卷凭据 /
 *      撤销保护）一律转上游出口；本件**不另写一份冲突判定**（两份实现必然漂移）；
 *   2 **分列**：四档决定（定为正史 / 并存 / 排除 / 未选）、出处三态、落卷三态、
 *      缺格三因、撤销四张表 —— 全部**结构上分开**；
 *   3 **不压平**：「未选尽」（blocked）与「选了但无可接」（empty）**不同形**；
 *      缺上游能力如实报不可用，**不报「没有冲突」**；
 *   4 **零写面**：本件一个字节都不落盘（`writesNothing` 恒 true）—— 置档 / 确认 / 撤销
 *      一律归上游 owner；手机侧只读预览，把用户的选择**转交**给上游。
 *
 * 【边界（如实登记，不装）】
 *   · 本件**不判**哪条故事更好（不排序、不评分、不给推荐 —— 禁用键深度扫描守这一条）；
 *   · 本件**不落笔**：分卷写入与撤销归上游 owner（`storyCanonAdoptConfirm` 与分卷接续面）；
 *   · 本件**不改原聊天**：原分支出处不在撤销范围内，读数里 `branchWrites` 恒 0；
 *   · 上游不在就如实报缺席，**不退回本地猜一份冲突表**。
 * ============================================================ */
'use strict';
/* ★ 数值取值门走**全仓唯一实现**（config/num-gate.js），不在本文件就地再写一份。 */
import { numOrNull as floorOrNull } from './num-gate.js';
/** 上游插件全局名（与其它契约模块读的是同一个） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游正史选择模块全局名（模块路：engine 路缺席时用于「面在不在场」的判定） */
const CANON_MODULE_GLOBAL = 'LonShaBranchCanon';
/** 上游面 id（与上游 open_face_registry.tsv / 本仓 crossrepo-registry.js 同一口径） */
export const BC_FACE_ID = 'branchCanon';
/** 五态（没装插件 / 这一面不在场 / 本机读不出 / 真跑过零冲突位 / 读到）。 */
export const BC_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});
/** 归因词（两两不同形；「未选尽」与「无可接条目」各有各的词，不许压成一句「还没好」）。 */
export const BC_REASONS = Object.freeze({
    ok: '正史选择面就绪',
    'engine-absent': '记忆插件未装或未加载（等装插件）',
    'face-absent': '插件在场但这版没有正史选择面（需插件 v3.342.0+）',
    unusable: '出口在但读不出或形态不对（本机读不出，**不是**「两条结局没有冲突」）',
    empty: '真跑过、一个冲突位都没有（**不是**「插件没装」）',
    'no-deps': '本机没拿到结局清单（装配归上游宿主）——读不出，不是没有冲突',
    'pending-unresolved': '还有冲突位没选定（**不得交接**：不拿半份选择去接续）',
    'no-adoptable-items': '冲突已选尽，但选中结局没带可接条目（缺格在 unmapped / bareOutcomes 具名）',
    'not-ready': '落卷面还没就绪（未选尽 / 无可接条目）',
    'no-scope': '凭据里没有范围（不可撤销，也**不许**「全删」兜底）'
});
/** 各态的**给用户看的一句处置建议**（与 BC_REASONS 的短归因分工不同：那条进一行读数，这条进卡片） */
export const BC_STATE_HINT = Object.freeze({
    'engine-absent': '未检测到 LonSha 记忆插件的正史选择面 —— 装上（或升级）后本卡自动可用',
    'face-absent': '插件在，但这一版没有正史选择面：需要较新版本',
    unusable: '正史选择面在，但本机读不出（出口报错 / 面畸形 / 装配未到）—— 这不是「两条结局没有冲突」',
    empty: '正史选择面真跑过了，结局清单里一个冲突位都没有 —— 分叉剧情后会自动长出来'
});
/** 四档决定（**穷尽**：任何冲突位必须落入其中一档，不得现编动作名） */
export const BC_DECISIONS = Object.freeze(['canon', 'coexist', 'exclude', 'unset']);
export const BC_DECISION_LABEL = Object.freeze({
    canon: '定为正史',
    coexist: '并存',
    exclude: '排除',
    unset: '未选'
});
/** 出处三态（未被选中的历史必须留痕） */
export const BC_PROVENANCE = Object.freeze(['chosen', 'excluded', 'coexisted']);
export const BC_PROVENANCE_LABEL = Object.freeze({
    chosen: '选中',
    excluded: '排除',
    coexisted: '并存'
});
/** 落卷三态（**穷尽且不同形**：未选尽 / 选了但无可接 / 可接续） */
export const BC_ADOPT = Object.freeze(['ready', 'blocked', 'empty']);
export const BC_ADOPT_LABEL = Object.freeze({
    ready: '可接续',
    blocked: '未选尽',
    empty: '无可接条目'
});
/** 冲突分档五态（`both-terminal` 与 `divergent` 是**真冲突**，`single` 只是「只有一条」） */
export const BC_CLASH = Object.freeze(['both-terminal', 'divergent', 'shared-terminal', 'single', 'none']);
export const BC_CLASH_LABEL = Object.freeze({
    'both-terminal': '两条终结声明打同一位（默认冲突）',
    divergent: '同一位上取值不同（同一件事有两种结果）',
    'shared-terminal': '两条终结声明同值（可并存）',
    single: '这一位只有一条（不构成冲突，仍可选定）',
    none: '不构成冲突位'
});
/** 预览三档（与 memory-package / lore-import 同词表，不另立） */
export const BC_PREVIEW = Object.freeze(['ok', 'warn', 'blocked']);
export const BC_PREVIEW_LABEL = Object.freeze({
    ok: '可交接',
    warn: '可交接（有未选中的支线，已留痕）',
    blocked: '不得交接（还有冲突位没选定）'
});
/** 映射缺格三因（**三条分开报**：压成一条「映射失败」下游就不知道该补哪一格） */
export const BC_UNMAPPED = Object.freeze(['no-face', 'no-owner', 'no-key']);
export const BC_UNMAPPED_LABEL = Object.freeze({
    'no-face': '没给面（条目不知该接到哪本账上）',
    'no-owner': '没给主（拿支线名冒充角色 id）',
    'no-key': '没给键（条目不可寻址，进包就无从撤销）'
});
/** 撤销保护面的四张表（**分列**：合成一格就分不出「该撤」与「必须留住」） */
export const BC_REVOKE_BUCKETS = Object.freeze(['revocable', 'keptForeign', 'keptManual', 'keptLater']);
export const BC_REVOKE_LABEL = Object.freeze({
    revocable: '本次接续落的（可撤）',
    keptForeign: '别的接续批次落的（一条不动）',
    keptManual: '用户自己的（绝不因撤销而消失）',
    keptLater: '本次之后手工新增的（留着）'
});
/**
 * 读数里**不得出现**的键名（推荐 / 评分 / 排序一族）。
 *   计划原文「不自动判定哪条故事更好」—— 本件把它变成对自己读数的一次深度扫描（自检里真跑）。
 */
export const BC_FORBIDDEN_KEYS = Object.freeze([
    'better', 'best', 'worse', 'worst', 'score', 'rank', 'rating', 'preference',
    'recommend', 'percent', 'percentage', 'confidence', 'weight', 'priority', 'index'
]);
/** 上限（冻结）：**沿上游既有上限，不新造第二套** */
export const BC_LIMITS = Object.freeze({
    /** 冲突位逐条呈现的上限（上游 MAX_OUTCOMES 是 200，呈现面收得更紧） */
    clashes: 40,
    /** 出处清单上限（未被选中的历史必须留痕，但呈现有界） */
    provenance: 120,
    label: 160,
    reason: 200,
    note: 200
});
function str(v) { return String(v == null ? '' : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
function clip(s, max) {
    const t = str(s);
    const m = Math.max(8, Number(max) || BC_LIMITS.label);
    return t.length <= m ? t : (t.slice(0, m - 1) + String.fromCharCode(8230));
}
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
}
/** 上游模块对象（模块路：全局挂载） */
function moduleOf(w) {
    if (!w) return null;
    const mod = w[CANON_MODULE_GLOBAL];
    return (mod && typeof mod === 'object') ? mod : null;
}
/** 恒定键面的读数模板（读者不必再判 undefined） */
function faceOf(state, reason, extra) {
    return Object.assign({
        kind: 'ruby_phone_branch_canon',
        version: 1,
        state: state,
        reason: reason,
        text: BC_REASONS[reason] || BC_REASONS['engine-absent'],
        ok: state === BC_STATES.OK,
        degraded: state === BC_STATES.ENGINE_ABSENT
            || state === BC_STATES.FACE_ABSENT
            || state === BC_STATES.UNUSABLE,
        /** 本面能不能替沉默作证：只有**真跑过**（读到 / 零冲突位）才为真 */
        silentCapable: state === BC_STATES.OK || state === BC_STATES.EMPTY,
        /** ★ 本件一个字节都不落盘：置档 / 确认 / 撤销归上游 owner。 */
        writesNothing: true,
        /** 逐冲突列举（每位一条，四档决定挂在各自的 decision 上） */
        clash: [],
        /** 出处清单（覆盖每一条结局：未被选中的历史必须留痕） */
        provenance: [],
        counts: {
            clashes: 0, blocked: 0, unkeyed: 0, total: 0,
            chosen: 0, coexisted: 0, excluded: 0, unset: 0
        },
        /** 预览三档（**blocked 与 empty 不同形**） */
        preview: '',
        /** 落卷三态 */
        verdict: '',
        /** 撤销保护面：四张表 + 两条口径读数 */
        revoke: { revocable: [], keptForeign: [], keptManual: [], keptLater: [] },
        deletesManual: false,
        branchWrites: 0,
        /** 落卷凭据（幂等键 + 撤销范围） */
        adoptionId: '',
        packId: null,
        volumeId: null,
        /** 缺格具名（三因分列） */
        unmapped: [],
        bareOutcomes: []
    }, extra || {});
}
/** 把上游一个冲突位逐格归一（**不重判** verdict，只收敛形状）。 */
function normClash(raw) {
    const o = obj(raw);
    if (!o) return null;
    const key = str(o.key).slice(0, 120);
    if (!key) return null;
    const verdict = str(o.verdict).toLowerCase();
    const dec = str(o.decision).toLowerCase();
    return {
        key: key,
        verdict: BC_CLASH.indexOf(verdict) >= 0 ? verdict : 'none',
        branches: arr(o.branches).map((x) => str(x)).filter(Boolean).slice(0, 12),
        titles: arr(o.titles).map((x) => clip(x, BC_LIMITS.label)).filter(Boolean).slice(0, 12),
        terminalCount: Number(o.terminalCount) || 0,
        terminalUnknown: Number(o.terminalUnknown) || 0,
        count: Number(o.count) || 0,
        /** 这一位上当前挂着哪一档（'' = 未选） */
        decision: BC_DECISIONS.indexOf(dec) >= 0 ? dec : 'unset',
        branch: str(o.branch).slice(0, 120),
        note: clip(o.note, BC_LIMITS.note)
    };
}
/** 把上游一条出处行逐格归一（**三态不压平**）。 */
function normProv(raw) {
    const o = obj(raw);
    if (!o) return null;
    const verdict = str(o.verdict).toLowerCase();
    if (BC_PROVENANCE.indexOf(verdict) < 0) return null;
    return {
        key: str(o.key).slice(0, 120),
        branch: str(o.branch).slice(0, 120),
        verdict: verdict,
        why: clip(o.why, BC_LIMITS.reason)
    };
}
/** 把上游一条缺格行逐格归一（**三因分列**：压成一条就不知道该补哪一格）。 */
function normUnmapped(raw) {
    const o = obj(raw);
    if (!o) return null;
    const why = str(o.why || o.reason).toLowerCase();
    if (BC_UNMAPPED.indexOf(why) < 0) return null;
    return {
        key: str(o.key).slice(0, 120),
        face: str(o.face).slice(0, 80),
        ownerKey: str(o.ownerKey).slice(0, 120),
        why: why,
        branch: str(o.branch).slice(0, 120),
        source: str(o.source).slice(0, 40)
    };
}
/** 撤销保护面归一（四张表分列 + 两条口径读数**写进读数**，不靠注释承诺）。 */
function normRevoke(raw) {
    const o = obj(raw);
    const out = {
        scope: { adoptionId: '', packId: null, volumeId: null },
        revocable: [], keptForeign: [], keptManual: [], keptLater: [],
        revocableCount: 0, foreignCount: 0, manualCount: 0, laterCount: 0,
        deletesManual: false, branchWrites: 0, judged: false
    };
    if (!o) return out;
    const sc = obj(o.scope) || {};
    out.scope = {
        adoptionId: str(sc.adoptionId),
        packId: (str(sc.packId) === '' ? null : str(sc.packId)),
        volumeId: (str(sc.volumeId) === '' ? null : str(sc.volumeId))
    };
    const one = (x) => ({
        key: str(x.key).slice(0, 120),
        face: str(x.face).slice(0, 80),
        ownerKey: str(x.ownerKey).slice(0, 120),
        packId: (str(x.packId) === '' ? null : str(x.packId)),
        why: clip(x.why, BC_LIMITS.reason),
        importedAt: floorOrNull(x.importedAt)
    });
    out.revocable = arr(o.revocable).map(one).slice(0, BC_LIMITS.provenance);
    out.keptForeign = arr(o.keptForeign).map(one).slice(0, BC_LIMITS.provenance);
    out.keptManual = arr(o.keptManual).map(one).slice(0, BC_LIMITS.provenance);
    out.keptLater = arr(o.keptLater).map(one).slice(0, BC_LIMITS.provenance);
    out.revocableCount = Number(o.revocableCount) || out.revocable.length;
    out.foreignCount = Number(o.foreignCount) || out.keptForeign.length;
    out.manualCount = Number(o.manualCount) || out.keptManual.length;
    out.laterCount = Number(o.laterCount) || out.keptLater.length;
    /** ★ 两条不可让步的口径**原样搬**（不就地写死，也不让上游把 true 传进来）。 */
    out.deletesManual = o.deletesManual === true;
    out.branchWrites = Number(o.branchWrites) || 0;
    out.judged = o.judged === true;
    return out;
}
/* ---------------------------------------------------------------
 * 六路读数（全部转上游出口；本件**不重算**任何一格判定）
 *
 * 为什么是六路而不是一路：这六件回答的是**六个不同的问题**，
 *   合成一路就会把「还没选完」与「选了也没东西可接」读成同一句话 ——
 *   而这两者的处置正好相反（回去选 / 去补结局条文）。
 *     · state    —— 这一批结局有几个冲突位、哪些还没选（**只列举，不选**）；
 *     · plan     —— 用户选完之后：选中 / 并存 / 排除各是哪些，出处是否覆盖每条结局；
 *     · preview  —— 拿这份选择去接续，新卷会带哪些结局（**只出读数、不落笔**）；
 *     · adopt    —— 这些结局**能不能变成下一卷接得上的条目**、缺什么格、叫什么名字；
 *     · adoption —— 本次落卷的**凭据**（幂等键 + 撤销范围），确认之前就该有；
 *     · revoke   —— 撤销会动哪些、**必须留住**哪些（四张具名表）。
 *   ★ `state` 说的是「这一面读没读到」，`verdict` / `preview` 说的是「这批结局能不能接续」
 *     —— 两者**不同层**：压平即把「读不到」显示成「没有可接条目」。
 * ------------------------------------------------------------ */
/** 冲突位上的一个槽位（选中 / 并存 / 排除 / 未选各自的条目形状）。 */
function normSlot(raw) {
    const o = obj(raw);
    if (!o) return null;
    const key = str(o.key).slice(0, 120);
    if (!key && !str(o.branch)) return null;
    return {
        key: key,
        branch: str(o.branch).slice(0, 120),
        title: clip(o.title, BC_LIMITS.label),
        slot: str(o.slot).slice(0, 80),
        floor: floorOrNull(o.floor)
    };
}
/** 接续条目归一（**只取呈现需要的格**：不把整条 value 倒进界面）。 */
function normItem(raw) {
    const o = obj(raw);
    if (!o) return null;
    const face = str(o.face).slice(0, 80);
    const key = str(o.key).slice(0, 120);
    if (!face || !key) return null;
    const ref = obj(o.canonRef) || {};
    return {
        face: face,
        key: key,
        ownerKey: str(o.ownerKey).slice(0, 120),
        link: str(o.link).slice(0, 20),
        from: floorOrNull(o.from),
        scope: str(o.scope).slice(0, 40),
        /** 这一条从哪条结局来（撤销要按来源筛，只在包级记一次就无从实现） */
        collision: str(ref.collision).slice(0, 120),
        branch: str(ref.branch).slice(0, 120),
        source: str(ref.source || o.source).slice(0, 20),
        /** 受限正文：上游已按知情面掩去，本件只留一个布尔（**不倒原文**） */
        sensitive: o.sensitive === true,
        valueText: clip(o.value, BC_LIMITS.note)
    };
}
/**
 * 读上游**逐冲突列举**面（验收1 的读数面）。
 *   ★ 只列举、不选择：哪些位上有两条终结声明（`both-terminal`）、哪些位取值不同
 *     （`divergent`）—— 判定归上游内核，本件照搬 `verdict`，**不另判一次**。
 */
export function readBranchCanonState(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.branchCanonState === 'function');
    if (!engineHas) {
        /* 模块在场而宿主没装配出口：这不是「没装插件」，是「这一版没把装配点接出来」。 */
        const mod = moduleOf(w);
        if (mod && typeof mod.conflicts === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps');
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent');
    }
    let got = null;
    try { got = eng.branchCanonState(o); } catch (_e) { return faceOf(BC_STATES.UNUSABLE, 'unusable'); }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable');
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent');
    if (g.judged === false) return faceOf(BC_STATES.UNUSABLE, 'no-deps');
    const rows = arr(g.rows).map(normClash).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const blocked = Number(g.blocked) || rows.filter((r) => r.verdict === 'both-terminal' || r.verdict === 'divergent').length;
    const counts = {
        clashes: Number(g.groups) || rows.length,
        blocked: blocked,
        unkeyed: Number(g.unkeyed) || 0,
        total: Number(g.total) || 0,
        chosen: 0, coexisted: 0, excluded: 0, unset: 0
    };
    /* ★ 真读数「无内容」：跑过了、一个冲突位都没有（**不是**「插件没装」）。 */
    if (!rows.length) return faceOf(BC_STATES.EMPTY, 'empty', { counts: counts });
    return faceOf(BC_STATES.OK, 'ok', { silentCapable: true, clash: rows, counts: counts });
}
/**
 * 读上游**结算计划**面（验收2 的读数面）。
 *   ★ `preview` 三档由上游给（未选尽 ⇒ blocked）；本件**不自己算**那三档。
 *   ★ 本件把四个数组**再索引一次**成 `decisions`（键 → 档），只为界面能逐位显示
 *     「这一位选了什么」—— 索引不是判定：档位全部来自上游那四个数组，一格都没重判。
 */
export function readBranchCanonPlan(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.branchCanonPlan === 'function');
    if (!engineHas) {
        const mod = moduleOf(w);
        if (mod && typeof mod.planCanon === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps');
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent');
    }
    let got = null;
    try { got = eng.branchCanonPlan(o); } catch (_e) { return faceOf(BC_STATES.UNUSABLE, 'unusable'); }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable');
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent');
    if (g.judged === false) return faceOf(BC_STATES.UNUSABLE, 'no-deps');
    const chosen = arr(g.chosen).map(normSlot).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const coexisted = arr(g.coexisted).map(normSlot).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const excluded = arr(g.excluded).map(normSlot).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const pending = arr(g.pending).map((x) => {
        const p = obj(x);
        if (!p) return null;
        return {
            key: str(p.key).slice(0, 120),
            verdict: str(p.verdict).slice(0, 40),
            branches: arr(p.branches).map((b) => str(b).slice(0, 120)).filter(Boolean).slice(0, 12)
        };
    }).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const prov = arr(g.provenance).map(normProv).filter(Boolean).slice(0, BC_LIMITS.provenance);
    /* ★ 索引（不是判定）：键 → 档，逐位显示用；未选尽的位**不进这张表**（它就是未选）。 */
    const decisions = [];
    const put = (list, dec) => {
        for (const x of list) if (x.key && !decisions.some((d) => d.key === x.key)) {
            decisions.push({ key: x.key, decision: dec, branch: x.branch });
        }
    };
    put(chosen, 'canon');
    put(coexisted, 'coexist');
    put(excluded, 'exclude');
    decisions.sort((a, b) => (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)));
    const counts = {
        clashes: decisions.length + pending.length,
        blocked: pending.length,
        unkeyed: 0,
        total: prov.length,
        chosen: chosen.length, coexisted: coexisted.length,
        excluded: excluded.length, unset: pending.length
    };
    const preview = str(g.preview);
    const reason = pending.length ? 'pending-unresolved' : '';
    return faceOf(BC_STATES.OK, reason, {
        silentCapable: true,
        preview: preview,
        pendingList: pending,
        chosen: chosen, coexisted: coexisted, excluded: excluded,
        provenance: prov, decisions: decisions,
        counts: counts
    });
}
/**
 * 读上游**交接预览**面（验收2：未选尽不得交接）。
 *   ★ 未选定时上游给 `pack:null` + `preview:'blocked'` —— 本件照搬，**不替它出半份包**。
 */
export function readBranchCanonPreview(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.branchCanonPreview === 'function');
    if (!engineHas) {
        const mod = moduleOf(w);
        if (mod && typeof mod.previewHandoff === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps');
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent');
    }
    let got = null;
    try { got = eng.branchCanonPreview(o); } catch (_e) { return faceOf(BC_STATES.UNUSABLE, 'unusable'); }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable');
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent');
    if (g.judged === false) return faceOf(BC_STATES.UNUSABLE, 'no-deps');
    const preview = str(g.preview);
    const pack = obj(g.pack);
    const pendingCount = Number(g.pendingCount) || 0;
    const reason = pendingCount ? 'pending-unresolved' : (preview === 'blocked' ? 'not-ready' : '');
    const counts = {
        clashes: 0, blocked: pendingCount, unkeyed: 0, total: 0,
        chosen: Number(g.chosenCount) || 0, coexisted: Number(g.coexistedCount) || 0,
        excluded: Number(g.excludedCount) || 0, unset: pendingCount
    };
    return faceOf(BC_STATES.OK, reason, {
        silentCapable: true,
        preview: preview,
        ok: g.ok === true,
        packId: pack ? str(pack.packId) : null,
        volumeId: pack ? (str(pack.volumeId) === '' ? null : str(pack.volumeId)) : null,
        branches: pack ? arr(pack.branches).map((x) => str(x).slice(0, 120)).filter(Boolean) : [],
        entryCount: pack ? (Number(pack.entryCount) || 0) : 0,
        withheldCount: pack ? (Number(pack.withheldCount) || 0) : 0,
        keeperUnknown: g.keeperUnknown === true,
        masked: Number(g.masked) || 0,
        counts: counts
    });
}
/**
 * 读上游**落卷计划**面（验收2/3 的落点：选了正史之后，下一卷接得上什么）。
 *
 * 【本件最要紧的一格：三态**不许压平**】
 *   · `ready`   —— 冲突选尽且至少有一条可接条目 ⇒ 可交接；
 *   · `blocked` —— 还有未选尽的冲突位 ⇒ **不出包**（`packId` 为 null）；
 *   · `empty`   —— 冲突都选尽了，但选中结局**一条可接条目都没带** ⇒ 与 blocked **不同形**：
 *                 这不是「还没选」，是「选了也没东西可接」（该去补结局条文）。
 *   把 empty 压进 blocked，用户会一直以为「还没选完」而不是「这批结局压根没带条文」——
 *   这正是计划原文验收②「选择部分时不能假装完成」的读数面。
 *
 * ★ 缺格三因（`no-face` / `no-owner` / `no-key`）**分列带回**：压成一条「映射失败」，
 *   下游就无从知道该补哪一格（是条目没接面、还是拿支线名冒充角色 id、还是条目无键不可寻址）。
 */
export function readBranchCanonAdopt(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.storyCanonAdoptPlan === 'function');
    if (!engineHas) {
        const mod = moduleOf(w);
        if (mod && typeof mod.buildContinuePack === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps', { verdict: 'blocked' });
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent', { verdict: 'blocked' });
    }
    let got = null;
    try { got = eng.storyCanonAdoptPlan(o); } catch (_e) { return faceOf(BC_STATES.UNUSABLE, 'unusable', { verdict: 'blocked' }); }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable', { verdict: 'blocked' });
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent', { verdict: 'blocked' });
    /* 上游落卷面的 `judged:false` 表示装配未到（**不是**「没有可接条目」）。 */
    if (g.judged === false) return faceOf(BC_STATES.UNUSABLE, 'no-deps', { verdict: 'blocked' });
    const verdict = str(g.verdict);
    const pack = obj(g.pack);
    const items = arr(g.items).map(normItem).filter(Boolean).slice(0, BC_LIMITS.provenance);
    const unmapped = arr(g.unmapped).map(normUnmapped).filter(Boolean).slice(0, BC_LIMITS.provenance);
    const bare = arr(g.bareOutcomes).map((x) => {
        const b = obj(x);
        if (!b) return null;
        return {
            key: str(b.key).slice(0, 120),
            branch: str(b.branch).slice(0, 120),
            title: clip(b.title, BC_LIMITS.label),
            why: str(b.why).slice(0, 40)
        };
    }).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const pending = arr(g.pending).map((x) => {
        const p = obj(x);
        if (!p) return null;
        return { key: str(p.key).slice(0, 120), verdict: str(p.verdict).slice(0, 40) };
    }).filter(Boolean).slice(0, BC_LIMITS.clashes);
    const pendingCount = Number(g.pendingCount) || pending.length;
    /* ★ 三态归因**按上游给的 verdict 走**，本件不自己判「够不够」。 */
    const reason = pendingCount ? 'pending-unresolved'
        : (verdict === 'empty' || (!items.length && verdict !== 'ready') ? 'no-adoptable-items' : '');
    const counts = {
        clashes: 0, blocked: pendingCount, unkeyed: 0, total: items.length,
        chosen: items.filter((x) => x.source === 'chosen').length,
        coexisted: items.filter((x) => x.source === 'coexisted').length,
        excluded: 0, unset: pendingCount
    };
    return faceOf(BC_STATES.OK, reason, {
        silentCapable: true,
        verdict: verdict,
        preview: verdict === 'ready' ? 'ok' : 'blocked',
        adoptionId: str(g.adoptionId),
        packId: pack ? str(pack.packId) : null,
        volumeId: (str(g.volumeId) === '' ? null : str(g.volumeId)),
        items: items,
        unmapped: unmapped,
        bareOutcomes: bare,
        pendingList: pending,
        counts: counts
    });
}
/**
 * 读上游**落卷凭据**面（验收4 的地基：撤起来范围是什么）。
 *   ★ `adoptionId` 只由**选择本身**决定（同一份选择重算恒同 id）⇒ 这就是
 *     「重复确认不重复接续」的幂等键；`revokeScope` 也在**确认之前**就定下来。
 *   ★ 本件**不提交**（`commit` 恒不传）：确认动作归上游 owner，手机端只读凭据。
 */
export function readBranchCanonAdoption(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.storyCanonAdoption === 'function');
    if (!engineHas) {
        const mod = moduleOf(w);
        if (mod && typeof mod.adoptionBrief === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps', { verdict: 'blocked' });
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent', { verdict: 'blocked' });
    }
    let got = null;
    try { got = eng.storyCanonAdoption(o); } catch (_e) { return faceOf(BC_STATES.UNUSABLE, 'unusable', { verdict: 'blocked' }); }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable', { verdict: 'blocked' });
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent', { verdict: 'blocked' });
    if (g.judged === false) return faceOf(BC_STATES.UNUSABLE, 'no-deps', { verdict: 'blocked' });
    const sc = obj(g.revokeScope) || {};
    const adoptionId = str(g.adoptionId);
    const packId = (str(g.packId) === '' ? null : str(g.packId));
    const pendingCount = Number(g.pendingCount) || 0;
    /* ★ 无范围（既无 id 也无 packId）**单独一格**：不可撤销，且**不许「全删」兜底**。 */
    const noScope = (adoptionId === '' && !packId);
    const reason = noScope ? 'no-scope'
        : (pendingCount ? 'pending-unresolved'
            : (str(g.verdict) === 'empty' ? 'no-adoptable-items' : ''));
    return faceOf(BC_STATES.OK, reason, {
        silentCapable: true,
        verdict: str(g.verdict),
        preview: str(g.preview),
        adoptionId: adoptionId,
        packId: packId,
        volumeId: (str(g.volumeId) === '' ? null : str(g.volumeId)),
        scope: {
            adoptionId: str(sc.adoptionId),
            packId: (str(sc.packId) === '' ? null : str(sc.packId)),
            volumeId: (str(sc.volumeId) === '' ? null : str(sc.volumeId))
        },
        persisted: g.persisted === true
    });
}
/**
 * 读上游**撤销保护面**（验收4：撤回只撤本次接续，原分支原文不变）。
 *
 * 【它补的是哪一格】修前只有一句承诺「范围是 handoff-only、分支零写」——
 *   那是**承诺**，不是可机检的形态：真落地时按什么筛、哪些条目**必须留着**，
 *   一个字都没有。于是「撤回」很容易做成「把这个键上的条目全删」，
 *   连带删掉用户后来手工补的事实与别的支线接进来的条目。
 *   本件把四张具名表原样端出，并把 `deletesManual:false` / `branchWrites:0`
 *   **写成读数**（不靠注释承诺）。
 */
export function readBranchCanonRevokeGuard(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.storyCanonRevokeGuard === 'function');
    if (!engineHas) {
        const mod = moduleOf(w);
        if (mod && typeof mod.revokeGuard === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps', { revoke: normRevoke(null) });
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent', { revoke: normRevoke(null) });
    }
    let got = null;
    try { got = eng.storyCanonRevokeGuard(o.entries || null, o); } catch (_e) {
        return faceOf(BC_STATES.UNUSABLE, 'unusable', { revoke: normRevoke(null) });
    }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable', { revoke: normRevoke(null) });
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent', { revoke: normRevoke(null) });
    const revoke = normRevoke(g);
    /* ★ 未判（凭据里没有范围）**单独一格**：不许拿「全删」当兜底。 */
    const reason = revoke.judged ? '' : 'no-scope';
    return faceOf(BC_STATES.OK, reason, {
        silentCapable: true,
        revoke: revoke,
        deletesManual: revoke.deletesManual,
        branchWrites: revoke.branchWrites,
        adoptionId: revoke.scope.adoptionId,
        packId: revoke.scope.packId,
        volumeId: revoke.scope.volumeId,
        counts: {
            clashes: 0, blocked: 0, unkeyed: 0,
            total: revoke.revocableCount + revoke.foreignCount + revoke.manualCount + revoke.laterCount,
            chosen: 0, coexisted: 0, excluded: 0, unset: 0
        }
    });
}
/**
 * 读上游**撤销范围描述**（旧面：只答「范围是什么」）。
 *   与 `readBranchCanonRevokeGuard` **不同层**：那件答「动哪些、留哪些」（条目级），
 *   这件答「本次接续的身份是什么」（批次级）。两件都摆出来，因为缺任一件都会
 *   让用户以为「撤回 = 把这一片全删」。
 */
export function readBranchCanonRevokeScope(win, opts = {}) {
    const w = resolveWin(win);
    const eng = engineOf(w);
    const o = obj(opts) || {};
    const engineHas = !!(eng && typeof eng.branchCanonRevoke === 'function');
    if (!engineHas) {
        const mod = moduleOf(w);
        if (mod && typeof mod.revokeScopeOf === 'function') return faceOf(BC_STATES.UNUSABLE, 'no-deps', { revokeScope: 'handoff-only' });
        return faceOf(BC_STATES.ENGINE_ABSENT, 'engine-absent', { revokeScope: '' });
    }
    let got = null;
    try { got = eng.branchCanonRevoke(o); } catch (_e) { return faceOf(BC_STATES.UNUSABLE, 'unusable', { revokeScope: '' }); }
    const g = obj(got);
    if (!g) return faceOf(BC_STATES.UNUSABLE, 'unusable', { revokeScope: '' });
    if (Number(g.version) === 0) return faceOf(BC_STATES.FACE_ABSENT, 'face-absent', { revokeScope: '' });
    const count = Number(g.count) || 0;
    const reason = count ? '' : 'no-scope';
    return faceOf(BC_STATES.OK, reason, {
        silentCapable: true,
        revokeScope: str(g.scope),
        revokeKeys: arr(g.keys).map((x) => str(x).slice(0, 120)).filter(Boolean).slice(0, BC_LIMITS.provenance),
        branchWrites: Number(g.branchWrites) || 0,
        counts: {
            clashes: 0, blocked: 0, unkeyed: 0, total: count,
            chosen: 0, coexisted: 0, excluded: 0, unset: 0
        }
    });
}/* ---------------------------------------------------------------
 * 一行读数（各态**分开说**：合并任意两态都会误导「该去做什么」）
 * ------------------------------------------------------------ */
/** 冲突列举一行读数（「有几个冲突位、几个还没选」）。 */
export function canonLine(read) {
    const r = obj(read) || {};
    if (r.state === BC_STATES.ENGINE_ABSENT) return '结局:' + BC_REASONS['engine-absent'];
    if (r.state === BC_STATES.FACE_ABSENT) return '结局:' + BC_REASONS['face-absent'];
    if (r.state === BC_STATES.UNUSABLE) return '结局:' + BC_REASONS[r.reason === 'no-deps' ? 'no-deps' : 'unusable'];
    if (r.state === BC_STATES.EMPTY) return '结局:' + BC_REASONS.empty;
    const c = obj(r.counts) || {};
    const parts = ['冲突位 ' + (c.clashes || 0)];
    /* ★ 未选尽**永远单独报**：它决定「能不能交接」，压进总数就看不出来。 */
    if (c.blocked) parts.push('**待选 ' + c.blocked + '**');
    else parts.push('已选尽');
    if (c.unkeyed) parts.push('无位 ' + c.unkeyed);
    return '结局:' + parts.join(' · ');
}
/** 选择计划一行读数（四档逐格报出）。 */
export function planLine(read) {
    const r = obj(read) || {};
    if (r.state === BC_STATES.ENGINE_ABSENT) return '选择:' + BC_REASONS['engine-absent'];
    if (r.state === BC_STATES.FACE_ABSENT) return '选择:' + BC_REASONS['face-absent'];
    if (r.state === BC_STATES.UNUSABLE) return '选择:' + BC_REASONS[r.reason === 'no-deps' ? 'no-deps' : 'unusable'];
    if (r.state === BC_STATES.EMPTY) return '选择:' + BC_REASONS.empty;
    const c = obj(r.counts) || {};
    const parts = [];
    for (const d of BC_DECISIONS) {
        const n = Number(c[d === 'canon' ? 'chosen' : (d === 'coexist' ? 'coexisted' : (d === 'exclude' ? 'excluded' : 'unset'))]) || 0;
        parts.push(BC_DECISION_LABEL[d] + ' ' + n);
    }
    /* ★ 预览三档**只在未选尽时说重话**：可交接就不必吓人。 */
    const tail = (str(r.preview) === 'blocked') ? '不得交接' : (str(r.preview) === 'warn' ? '可交接（有未选中支线，已留痕）' : '可交接');
    return '选择:' + parts.join(' / ') + ' · ' + tail;
}
/** 落卷一行读数（三态**不同形**）。 */
export function adoptLine(read) {
    const r = obj(read) || {};
    if (r.state === BC_STATES.ENGINE_ABSENT) return '落卷:' + BC_REASONS['engine-absent'];
    if (r.state === BC_STATES.FACE_ABSENT) return '落卷:' + BC_REASONS['face-absent'];
    if (r.state === BC_STATES.UNUSABLE) return '落卷:' + BC_REASONS[r.reason === 'no-deps' ? 'no-deps' : 'unusable'];
    if (r.state === BC_STATES.EMPTY) return '落卷:' + BC_REASONS.empty;
    const v = str(r.verdict) || 'blocked';
    const parts = [BC_ADOPT_LABEL[v] || v];
    const c = obj(r.counts) || {};
    if (c.total) parts.push('可接 ' + c.total);
    if (c.blocked) parts.push('待选 ' + c.blocked);
    if (arr(r.unmapped).length) parts.push('缺格 ' + arr(r.unmapped).length);
    if (arr(r.bareOutcomes).length) parts.push('空条 ' + arr(r.bareOutcomes).length);
    return '落卷:' + parts.join(' / ');
}
/** 撤销一行读数（四张表**逐格报出** + 两条口径）。 */
export function revokeLine(read) {
    const r = obj(read) || {};
    if (r.state === BC_STATES.ENGINE_ABSENT) return '撤回:' + BC_REASONS['engine-absent'];
    if (r.state === BC_STATES.FACE_ABSENT) return '撤回:' + BC_REASONS['face-absent'];
    if (r.state === BC_STATES.UNUSABLE) return '撤回:' + BC_REASONS[r.reason === 'no-deps' ? 'no-deps' : 'unusable'];
    if (r.reason === 'no-scope') return '撤回:' + BC_REASONS['no-scope'];
    const rv = obj(r.revoke) || {};
    const parts = ['可撤 ' + (rv.revocableCount || 0)];
    /* ★ 三张「必须留住」的表**逐格报出**：只报可撤数，用户就以为撤回会清空这一片。 */
    if (rv.foreignCount) parts.push('别批 ' + rv.foreignCount);
    if (rv.manualCount) parts.push('**手工 ' + rv.manualCount + '（绝不动）**');
    if (rv.laterCount) parts.push('后加 ' + rv.laterCount);
    parts.push('原分支零写 ' + (rv.branchWrites || 0));
    return '撤回:' + parts.join(' · ');
}
/* ---------------------------------------------------------------
 * 这一面能不能读（★ 判定词**只此一份**）
 *   为什么放在内核而不是视图：视图里写第二份状态字面量，内核改名那天
 *   那些比较会**静默落空**（不报错、不转红），于是「插件没装」被显示成
 *   「这批结局没有冲突」—— 两个处置正好相反（去装插件 / 去聊一楼）。
 * ------------------------------------------------------------ */
/**
 * 这一面能不能读 + 读不到时该说什么。
 *   ★ `readable:false` 时 `hint` **必非空** —— 视图直接摆出来即可，不必再判一格。
 *   ★ 未知状态（上游加了新态而本件没跟上）**也走 readable:false**：
 *     宁可说「不可读」，绝不默认成「读到了」。
 */
export function canonGateOf(read) {
    const r = obj(read) || {};
    if (r.state === BC_STATES.OK) return { readable: true, state: r.state, hint: '' };
    /* ★ `no-deps` 不是「没装插件」：插件在、装配点没给 ⇒ 建议去查宿主，不是去装插件。 */
    if (r.reason === 'no-deps') {
        return { readable: false, state: str(r.state), hint: BC_REASONS['no-deps'] };
    }
    return {
        readable: false,
        state: str(r.state),
        hint: BC_STATE_HINT[r.state] || '正史选择面不可读（状态未登记，如实说读不出）'
    };
}
/**
 * 落卷读数的一句说明（没有要说的就给空串）。
 *   ★ 「未选尽」与「选了但无可接条目」的差别只在这一处判：前者回去选，
 *     后者去补结局条文 —— 合成一句就是把「还没选完」写成「这批结局没条文」。
 */
export function canonNoteOf(read) {
    const r = obj(read) || {};
    if (r.reason === 'pending-unresolved') return '还有冲突位没选定 —— 不得交接（不拿半份选择去接续）';
    if (r.reason === 'no-adoptable-items') return '冲突已选尽，但选中结局没带可接条目 —— 该去补结局条文，**不是**「还没选完」';
    if (r.reason === 'no-scope') return '凭据里没有范围 —— 不可撤销，也不许拿「全删」兜底';
    if (r.reason === 'no-deps') return '本机没拿到结局清单（装配归上游宿主）—— 读不出，**不是**「两条结局没有冲突」';
    return '';
}
/* ---------------------------------------------------------------
 * 自检（纯函数式，不抛）：九条口径当场自证
 * ------------------------------------------------------------ */
/**
 * 一 插件不在场 ⇒ engine-absent，**不是** empty（两态不同形）；
 * 二 面 version=0 ⇒ face-absent；
 * 三 出口抛错 ⇒ unusable；
 * 四 ★ 核心：装配未到（judged:false）⇒ 归因 `no-deps`，**不是**「零冲突位」；
 * 五 ★ 核心：`blocked` 与 `empty` 不同形（一个回去选，一个去补条文）；
 * 六 ★ 核心：缺格三因分列（no-face / no-owner / no-key 各出现）；
 * 七 ★ 核心：撤销四张表分列，且 `deletesManual:false` / `branchWrites:0` 写成读数；
 * 八 ★ 核心：读数里**不含**推荐 / 评分 / 排序一族键（计划原文「不自动判定哪条故事更好」）；
 * 九 ★ 核心：判定词只在 `canonGateOf` 一处（未登记状态一律 readable:false）。
 */
export function bcSelfCheck() {
    const problems = [];
    const eng = (over) => ({ LonShaMemory: { engine: Object.assign({
        branchCanonState: () => ({ kind: 'branch_canon', version: 2, ok: true, judged: true, groups: 2, blocked: 1, unkeyed: 0, total: 3,
            rows: [{ key: 'k1', verdict: 'both-terminal', branches: ['b1', 'b2'], titles: ['甲', '乙'], terminalCount: 2, terminalUnknown: 0, count: 2 },
                { key: 'k2', verdict: 'single', branches: ['b1'], titles: ['丙'], terminalCount: 1, terminalUnknown: 0, count: 1 }] }),
        branchCanonPlan: () => ({ kind: 'branch_canon_plan', version: 2, ok: true, judged: true, preview: 'blocked',
            chosen: [{ key: 'k1', branch: 'b1', title: '甲', slot: 's1', floor: 3 }],
            coexisted: [], excluded: [], pending: [{ key: 'k2', verdict: 'pending-confirm', branches: ['b1'] }],
            provenance: [{ key: 'k1', branch: 'b1', verdict: 'chosen', why: '选甲' }, { key: 'k1', branch: 'b2', verdict: 'excluded', why: 'unselected-sibling' }] }),
        branchCanonPreview: () => ({ kind: 'branch_canon_handoff', version: 2, ok: false, judged: true, preview: 'blocked', pack: null,
            chosenCount: 1, coexistedCount: 0, excludedCount: 1, pendingCount: 1, keeperUnknown: false, masked: 0 }),
        branchCanonRevoke: () => ({ kind: 'branch_canon_revoke', version: 2, scope: 'handoff-only', branchWrites: 0, volumeId: 'v1', packId: '', keys: ['k1'], count: 1 }),
        storyCanonAdoptPlan: () => ({ kind: 'branch_canon_adoption', version: 2, ok: true, judged: true, verdict: 'ready', reason: '', adoptionId: 'ca_1',
            volumeId: 'v1', pendingCount: 0, pending: [], pack: { packId: 'cp_1', volumeId: 'v1', entryCount: 1 },
            items: [{ face: 'unfinished', key: 'q1', ownerKey: 'id:c1', link: 'by-id', from: 3, scope: null, value: '等她回来', sensitive: false,
                canonRef: { collision: 'k1', branch: 'b1', source: 'chosen' } }],
            unmapped: [{ key: 'k2', face: '', ownerKey: '', why: 'no-face', branch: 'b1', source: 'x' }],
            bareOutcomes: [{ key: 'k3', branch: 'b1', title: '丁', why: 'no-items' }] }),
        storyCanonAdoption: () => ({ kind: 'branch_canon_adoption', version: 2, judged: true, adoptionId: 'ca_1', verdict: 'ready', preview: 'warn',
            volumeId: 'v1', packId: 'cp_1', itemCount: 1, unmappedCount: 1, bareCount: 1, pendingCount: 0, persisted: false,
            revokeScope: { adoptionId: 'ca_1', packId: 'cp_1', volumeId: 'v1' }, writeNothing: true }),
        storyCanonRevokeGuard: () => ({ kind: 'branch_canon_adoption_revoke_guard', version: 2, judged: true,
            scope: { adoptionId: 'ca_1', packId: 'cp_1', volumeId: 'v1' },
            revocable: [{ key: 'q1', face: 'unfinished', ownerKey: 'id:c1', packId: 'cp_1', why: 'in-scope', importedAt: 5 }],
            keptForeign: [{ key: 'q9', face: 'unfinished', ownerKey: 'id:c9', packId: 'cp_9', why: 'other-adoption-scope' }],
            keptManual: [{ key: 'm1', face: 'unfinished', ownerKey: 'id:c3', packId: null, why: 'no-source-scope' }],
            keptLater: [], revocableCount: 1, foreignCount: 1, manualCount: 1, laterCount: 0,
            deletesManual: false, branchWrites: 0 })
    }, over || {}) } });
    /* 一：插件不在场（**不是** empty）。 */
    const absent = readBranchCanonState(null);
    if (absent.state !== BC_STATES.ENGINE_ABSENT) problems.push('插件不在场应报 engine-absent');
    if (absent.writesNothing !== true) problems.push('writesNothing 必须恒为 true');
    /* 二：面 version=0 ⇒ face-absent。 */
    if (readBranchCanonState(eng({ branchCanonState: () => ({ version: 0 }) })).state !== BC_STATES.FACE_ABSENT) problems.push('version=0 应报 face-absent');
    /* 三：出口抛错 ⇒ unusable。 */
    if (readBranchCanonState(eng({ branchCanonState: () => { throw new Error('x'); } })).state !== BC_STATES.UNUSABLE) problems.push('出口抛错应报 unusable');
    /* 四：装配未到 ⇒ no-deps（**不是**「零冲突位」）。 */
    const nodeps = readBranchCanonState(eng({ branchCanonState: () => ({ version: 2, judged: false, rows: [] }) }));
    if (nodeps.state !== BC_STATES.UNUSABLE || nodeps.reason !== 'no-deps') problems.push('装配未到应报 no-deps');
    if (canonLine(nodeps).indexOf('冲突位 0') >= 0) problems.push('装配未到不得读成「冲突位 0」');
    /* 五：blocked 与 empty **不同形**（一个回去选，一个去补条文）。 */
    const okWin = eng({});
    const plan = readBranchCanonPlan(okWin);
    if (plan.state !== BC_STATES.OK) problems.push('正常计划应报 ok');
    if (plan.reason !== 'pending-unresolved') problems.push('未选尽应报 pending-unresolved');
    const emptyPlanWin = eng({ storyCanonAdoptPlan: () => ({ version: 2, judged: true, verdict: 'empty', adoptionId: 'ca_2', pendingCount: 0, pending: [], pack: null, items: [], unmapped: [], bareOutcomes: [{ key: 'k9', branch: 'b1', title: '戊', why: 'no-items' }] }) });
    const emptyRead = readBranchCanonAdopt(emptyPlanWin);
    const readyRead = readBranchCanonAdopt(okWin);
    if (emptyRead.reason !== 'no-adoptable-items') problems.push('无可接条目应报 no-adoptable-items');
    if (emptyRead.reason === readyRead.reason) problems.push('empty 与 ready 的归因不得同形');
    if (emptyRead.verdict === 'blocked' && emptyRead.reason === 'pending-unresolved') problems.push('empty 被压进了 blocked');
    if (canonNoteOf(emptyRead) === canonNoteOf(plan)) problems.push('「无可接条目」与「未选尽」的说明不得同形');
    /* 六：缺格三因分列。 */
    const unmWin = eng({ storyCanonAdoptPlan: () => ({ version: 2, judged: true, verdict: 'empty', adoptionId: 'ca_3', pendingCount: 0, pending: [], pack: null, items: [],
        unmapped: [{ key: 'kA', face: '', ownerKey: '', why: 'no-face' }, { key: 'kB', face: 'unfinished', ownerKey: '', why: 'no-owner' }, { key: 'kC', face: 'unfinished', ownerKey: 'id:c', why: 'no-key' }],
        bareOutcomes: [] }) });
    const unmRead = readBranchCanonAdopt(unmWin);
    const whys = new Set(arr(unmRead.unmapped).map((u) => u.why));
    if (!(whys.has('no-face') && whys.has('no-owner') && whys.has('no-key'))) problems.push('缺格三因必须分列');
    /* 七：撤销四张表分列 + 两条口径写成读数。 */
    const rg = readBranchCanonRevokeGuard(okWin);
    const rv = obj(rg.revoke) || {};
    if (rv.revocableCount !== 1 || rv.foreignCount !== 1 || rv.manualCount !== 1) problems.push('撤销四张表分列计数不对');
    if (rv.deletesManual !== false) problems.push('deletesManual 必须为 false');
    if (rv.branchWrites !== 0) problems.push('branchWrites 必须为 0');
    if (Object.keys(BC_REVOKE_BUCKETS).length !== 4) problems.push('撤销四张表口径必须四项');
    /* 八：禁用键深度扫描（真跑）。 */
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (BC_FORBIDDEN_KEYS.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const hits = scan([readBranchCanonState(okWin), plan, readBranchCanonPreview(okWin), readyRead, readBranchCanonAdoption(okWin), rg, readBranchCanonRevokeScope(okWin)], []);
    if (hits.length) problems.push('读数里出现了禁用键：' + hits.join('/'));
    /* 九：判定词只在 canonGateOf 一处（未登记状态一律 readable:false）。 */
    const g1 = canonGateOf(readBranchCanonState(okWin));
    if (g1.readable !== true || g1.hint !== '') problems.push('读到时应 readable=true 且 hint 为空');
    const g2 = canonGateOf(absent);
    if (g2.readable !== false || !g2.hint) problems.push('读不到时 hint 必非空');
    const g3 = canonGateOf({ state: 'brand-new-state' });
    if (g3.readable !== false) problems.push('未登记状态必须 readable:false');
    /* ★ 四档决定**穷尽**：任何冲突位必须落入其中一档。 */
    if (BC_DECISIONS.length !== 4) problems.push('四档决定必须穷尽四项');
    /* ★ 落卷三态**穷尽且不同形**。 */
    if (new Set(BC_ADOPT).size !== 3) problems.push('落卷三态必须三态不同形');
    return { problems: problems };
}
export default {
    BC_FACE_ID,
    BC_STATES,
    BC_REASONS,
    BC_STATE_HINT,
    BC_DECISIONS,
    BC_DECISION_LABEL,
    BC_PROVENANCE,
    BC_PROVENANCE_LABEL,
    BC_ADOPT,
    BC_ADOPT_LABEL,
    BC_CLASH,
    BC_CLASH_LABEL,
    BC_PREVIEW,
    BC_PREVIEW_LABEL,
    BC_UNMAPPED,
    BC_UNMAPPED_LABEL,
    BC_REVOKE_BUCKETS,
    BC_REVOKE_LABEL,
    BC_FORBIDDEN_KEYS,
    BC_LIMITS,
    readBranchCanonState,
    readBranchCanonPlan,
    readBranchCanonPreview,
    readBranchCanonAdopt,
    readBranchCanonAdoption,
    readBranchCanonRevokeGuard,
    readBranchCanonRevokeScope,
    canonLine,
    planLine,
    adoptLine,
    revokeLine,
    canonGateOf,
    canonNoteOf,
    bcSelfCheck
};