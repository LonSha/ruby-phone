/* ========================================================
 * config/resume-workbench.js — [v3.88.0 · 拓展计划 R-X4] 跨项目续玩工作台（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境，逐条核对，不是推演）】
 *   X8 三个切片已经把「续玩」的**零件**做齐了：
 *     · config/resume-brief.js（v3.20.0）—— 分节简报：停在哪 / 未了约定 / 上游承诺 / 支线；
 *     · config/branch-contrast.js（v3.62.0）—— 选两分支看四组语义变化（只读）；
 *     · config/resume-handoff.js（v3.63.0）—— 预检 → 执行 → 回读三段闸门（交接世代栅栏）。
 *   实测它们是**三个各自为政的入口**：简报在织光机里、对照在诊断里、交接也在诊断里，
 *   而用户真正要完成的那件事 ——「**挑一个项目，看清它现在什么样，决定要不要接着玩**」——
 *   没有任何一处回答。代价是四条具体的错读数：
 *     ① **没有「项目」这一维**：全仓按字面量搜 projectId / projectKey / volumeKey，
 *        命中数 **0** —— 「这块存档属于哪一部作品」从来没有被当成一个身份。
 *     ② **没选项目 = 看全部**：任何一处「聚合」实现的缺省都是「把能读到的全摆出来」。
 *        在跨项目场景里这是**串味**：A 作品的角色状态出现在 B 作品的续玩卡上，
 *        不报错、只是内容不对（本仓最贵形态：「不报错、默默不对」）。
 *     ③ **恢复前看不到影响**：交接面给的是**三档预检**（ok / blocked / unusable），
 *        但答不出「这一次接续会动到几行、几个角色、几条分支、会不会盖掉现有数据」。
 *        用户是在**不知道影响范围**的情况下按的确认。
 *     ④ **同名角色强行合并**：branch-contrast 已把「同名异人」做对（角色名走
 *        「不可长期定位」），但没有任何一处把这条纪律**延伸到跨项目**；于是
 *        「A 宇宙的林某」与「B 宇宙的林某」在聚合视图里会被读成同一个人。
 *
 * 【本模块只做四件事（与 R-X1/R-X2/R-X3 同范式：只收束、不取数、不写）】
 *   ① **项目身份 buildResumeWorkbench**：把「项目 → 卷 → 章节 → 当前分支 → 最近停点」
 *      收成一条**可回源**的读数。项目身份由调用方给（projectId / volume / chapter），
 *      本模块**不自造身份**，只做归一与去重（身份缺项即如实记 unidentifiable）。
 *   ② **三级操作 RW_LEVELS**：只读查看 / 生成接续草稿 / 请求恢复。
 *      **只读恒可用**；草稿是纯数据（不写存储）；恢复**委托真实 owner**
 *      —— 本模块**结构上没有任何写面**，它只产出「请求」。
 *   ③ **接续前的三件事**：conflicts（同名异宇宙 / 跨段 / 跨项目 / 旧在飞回信）、
 *      gaps（哪几面读不到，**不是**「没有」）、impact（这次接续会动到多少）。
 *   ④ **隔离（fail-closed）**：**没选项目 ⇒ 不产出任何项目读数**，且**不给恢复**
 *      —— 与 provenance-graph.js 那条「拿不到会话身份即判不是同一段」同源。
 *
 * 【不做什么（边界，防第二份真源）】
 *   · **不做取数**：项目清单、选中项、各面读数、在飞回信全部由调用方给（咽喉唯一取数口）；
 *   · **不做写**：本模块不持 storage 键、不带计时器、不碰 DOM（故**不新增会话键**）；
 *     restore 只产请求，执行由调用方注入的 owner 做 —— 与 resume-handoff.js 分工一致；
 *   · **不重算**：分节行 / 四组对照 / 预检三档各有唯一真源，本模块只收束它们**已判好的**结果；
 *   · **不猜身份**：projectId 缺项一律 unidentifiable，绝不拿「列表第一项」顶上
 *     （那正是 ② 号错读数的成因）。
 *
 * 【四条口径纪律（每条都有判据钉住）】
 *   · **没选 ≠ 全部**：state=no-selection 时 projects / sections / characters 一律为空；
 *   · **读不到 ≠ 没有**：项目清单 null（读不到）与 []（真没有）处置相反；
 *   · **同名不算同一人**：角色身份的键是 作品标识|宇宙|名字 三元组，跨项目/跨宇宙**不合并**；
 *   · **旧回信不算当前**：请求恢复前若还有在飞旧回信，恢复 **held** 并点名。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';

/** 本模块口径版本（与仓内其他 config 模块同取法：改动协议时才抬）。 */
export const RW_VERSION = 1;

/* ────── 小工具（零依赖：本仓不引运行时依赖） ────── */

function rwObj(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}

function rwStr(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

function rwArr(v) {
    return Array.isArray(v) ? v : null;
}

/** 楼层归一：能当非负整数用就给整数，其余一律 null（**绝不补 0** —— 0 是合法楼层）。 */
function rwFloor(v) {
    const n = numOrNull(v);
    return (n !== null && Number.isInteger(n) && n >= 0) ? n : null;
}

/**
 * 一条记录的**归属段**（跨会话 / 跨分支隔离的两维）。
 * 与 session-gate 的两维、provenance-graph 的 pgScopeOf 同口径 —— 隔离口径只有一份。
 */
function rwScopeOf(x) {
    const o = rwObj(x) || {};
    return { chatId: rwStr(o.chatId, 120), branchKey: rwStr(o.branchKey, 120) };
}

/**
 * 两条记录是否属**同一段**（同会话 + 同分支）。
 * **拿不到会话身份即判「不是同一段」**（fail-closed）：宁可多拦一条，
 *   不可让一个项目的内容漏进另一段会话的续玩读数。
 */
function rwSameScope(a, b) {
    const x = rwScopeOf(a), y = rwScopeOf(b);
    if (!x.chatId || !y.chatId) return false;
    return x.chatId === y.chatId && x.branchKey === y.branchKey;
}

/**
 * 项目身份键：`项目|卷|章节` 三元组。
 * **缺 projectId 即返回 null**（认不出就不硬塞）—— 绝不拿「列表第一项」或空串顶上。
 *   卷 / 章节可以是空串（很多作品不分卷），projectId 是身份的**必需段**。
 */
function rwProjectKey(row) {
    const o = rwObj(row);
    if (!o) return null;
    const pid = rwStr(o.projectId, 120);
    if (!pid) return null;
    return pid + '|' + rwStr(o.volume, 60) + '|' + rwStr(o.chapter, 60);
}

/**
 * 角色身份的键：`作品标识|宇宙|名字` 三元组。
 *   · **刻意不是「名字」**：同名异人在本仓是既知形态，拿名字当键 ⇒ 跨项目聚合会把
 *     两个人拼成一个人，且**不报错**（本模块要治的四号错读数）；
 *   · **也刻意不带卷 / 章节**：卷章是同一部作品内部的定位，不是人的身份 ——
 *     同一部作品换一卷出现，还是**同一个人**；把卷章拼进去会把同一个人拆成两个。
 */
function rwCharacterKey(row) {
    const o = rwObj(row);
    if (!o) return null;
    const name = rwStr(o.name, 60);
    if (!name) return null;
    const pk = rwStr(o.projectId, 120);
    const universe = rwStr(o.universe, 60);
    return String(pk || '') + '|' + universe + '|' + name;
}

/** 冲突记录（去重靠键，不靠对象引用）。 */
function rwConflict(kind, what, detail, key) {
    return { kind: kind, what: rwStr(what, 80), detail: rwStr(detail, 160), key: key || '' };
}

/** 按 key 去重追加。 */
function rwPushUnique(list, seen, item) {
    const k = item.key || (item.kind + '|' + item.what);
    if (seen.has(k)) return;
    seen.add(k);
    list.push(item);
}

/* ────── ① 三态（互不同形，处置相反） ────── */

/**
 * 工作台三态（顺序有意义：越靠前越硬）。
 *   · no-selection            —— 没选项目 ⇒ 不产出任何项目读数、不给恢复（fail-closed 隔离）；
 *   · project-list-unreadable —— 项目清单读不到（**不是**「没有作品」）；
 *   · ready                   —— 有选中项且清单在场 ⇒ 给出本段读数。
 */
export const RW_PROJECT_STATES = Object.freeze({
    NO_SELECTION: 'no-selection',
    UNREADABLE: 'project-list-unreadable',
    READY: 'ready'
});

/** 三态的**文案**（三态必须互不同形 —— 判据按表逐格核，不许两两相同）。 */
export const RW_STATE_LABELS = Object.freeze({
    'no-selection': '尚未选择项目',
    'project-list-unreadable': '项目清单读不到',
    'ready': '已选中项目'
});

/* ────── ② 三级操作（权限逐级升高，只读恒可用） ────── */

/**
 * 三级操作。writes 是**这一级会不会动数据**的结构声明（判据按表逐格核）：
 *   · read    —— 只看，writes:false；
 *   · draft   —— 产出接续草稿（纯数据，仍不写存储），writes:false；
 *   · restore —— 请求恢复，writes:true，且**必须**由注入的 owner 执行。
 * ★ restore.writes 为 true 而本模块**没有任何写面** —— 这不是矛盾，是分工：
 *   本模块只把「要恢复什么」说清楚，动手的是真实 owner（X8 原文「恢复只委托真实 owner」）。
 */
export const RW_LEVELS = Object.freeze({
    read: Object.freeze({
        key: 'read', label: '只读查看', writes: false,
        text: '看项目 / 卷 / 分支 / 停点与未了事项 —— 不动任何数据'
    }),
    draft: Object.freeze({
        key: 'draft', label: '生成接续草稿', writes: false,
        text: '把「接着玩要带上的东西」收成一份草稿 —— 草稿只是文本，仍未动数据'
    }),
    restore: Object.freeze({
        key: 'restore', label: '请求恢复', writes: true,
        text: '把恢复委托给真实 owner；本模块只产出请求，**不自己写主档**'
    })
});

/* ────── ③ 冲突类别（接续前必须显示的三件事之一） ────── */

/**
 * 冲突类别。每一条都对应一种**真实会串味 / 串档**的情形：
 *   · same-name-different-universe —— 同名角色分属两个宇宙：**不合并**；
 *   · cross-scope                  —— 属另一段会话 / 分支：不进本段读数；
 *   · project-mismatch             —— 属另一个项目：不混算；
 *   · stale-in-flight              —— 有在飞的旧回信：恢复前必须先挡住；
 *   · unidentifiable               —— 身份缺项：**认不出就不硬塞**。
 */
export const RW_CONFLICT_KINDS = Object.freeze({
    SAME_NAME: 'same-name-different-universe',
    CROSS_SCOPE: 'cross-scope',
    PROJECT_MISMATCH: 'project-mismatch',
    STALE_IN_FLIGHT: 'stale-in-flight',
    UNIDENTIFIABLE: 'unidentifiable'
});

/** 冲突类别 → 中文（视图直出；不在这里做二次解释）。 */
export const RW_CONFLICT_LABELS = Object.freeze({
    'same-name-different-universe': '同名异宇宙',
    'cross-scope': '跨段（另会话 / 另分支）',
    'project-mismatch': '跨项目',
    'stale-in-flight': '旧回信在飞',
    'unidentifiable': '身份缺项'
});

/* ────── 归因词表（判据按此表逐词核，防随口新词） ────── */

export const RW_REASONS = Object.freeze({
    OK: '',
    NO_SELECTION: 'no-selection',
    LIST_UNREADABLE: 'project-list-unreadable',
    NOT_IN_LIST: 'project-not-in-list',
    UNIDENTIFIABLE: 'unidentifiable',
    NO_OWNER: 'no-owner-injected',
    BLOCKED: 'precheck-blocked',
    UNUSABLE: 'precheck-unusable',
    FACE_MISSING: 'face-not-provided',
    FACE_UNREADABLE: 'face-unreadable'
});

/** 归因 → 中文。 */
export const RW_REASON_TEXT = Object.freeze({
    'no-selection': '没选项目：不产出任何项目读数（维持会话隔离）',
    'project-list-unreadable': '项目清单读不到（**不是**「没有作品」）',
    'project-not-in-list': '选中的项目不在清单里（清单可能已变）',
    'unidentifiable': '身份缺项：认不出就不硬塞',
    'no-owner-injected': '没有注入真实 owner（恢复委托 owner —— 本模块自己没有写面）',
    'precheck-blocked': '预检有阻塞项（见 precheck.checks）',
    'precheck-unusable': '预检不可测（不可测 ≠ 通过）',
    'face-not-provided': '本次没给这一面（不是「这一面是空的」）',
    'face-unreadable': '取数失败（不是「这一面是空的」）'
});

/* ────── 小工具（本模块自用） ────── */

/** 一面读不到 ⇒ 一条 gap（**不是**「这一面是空的」）。 */
function rwGap(face, reason) {
    return {
        face: rwStr(face, 40),
        reason: rwStr(reason, 60),
        readable: false,
        why: RW_REASON_TEXT[rwStr(reason, 60)] || ('这一面读不到：' + rwStr(face, 40))
    };
}

/** 项目行归一：**缺 projectId 即返回 null**（认不出不硬塞）。 */
function rwProjectRow(row) {
    const o = rwObj(row);
    if (!o) return null;
    const key = rwProjectKey(o);
    if (!key) return null;
    return {
        projectId: rwStr(o.projectId, 120),
        volume: rwStr(o.volume, 60),
        chapter: rwStr(o.chapter, 60),
        projectKey: key,
        title: rwStr(o.title, 120),
        lastFloor: rwFloor(o.lastFloor != null ? o.lastFloor : o.floor),
        chatId: rwStr(o.chatId, 120),
        branchKey: rwStr(o.branchKey, 120)
    };
}

/**
 * 把「一份收下的存档包原文」归一成**项目行清单**（上游分卷接续包形态的适配口）。
 *   · 认得出（顶层带 projectId / id）⇒ 返回**一个**项目行；两套礼规都收：
 *     上游接续包给的是 projectTitle / volumeId / volumeTitle / floorEnd，
 *     本仓清单给的是 title / volume / chapter / lastFloor；
 *   · 认不出（没有项目身份）⇒ 返回 **[]**（**认得出这份包，只是它不含项目身份**），
 *     与「读不到」不是一回事 —— 空清单与读不到处置相反，调用方不得把两者读成同形。
 *
 * ★ 为什么归一只能有一份：存档台（项目清单的取数源）与咽喉（取数口）若各写一套字段礼规，
 *   哪天一侧改了字段名，另一侧会静默归一成一行「没有标题、没有卷」的空项目 —— 不报错。
 *
 * @param {object} parsed 包原文解析出来的对象（**已 JSON.parse** 的那一层）
 * @returns {Array<object>} 项目行（0 或 1 条；字段与 `rwProjectRow` 同礼规）
 */
export function rwProjectsFromPack(parsed) {
    const o = rwObj(parsed);
    if (!o) return [];
    const pid = rwStr(o.projectId != null ? o.projectId : o.id, 120);
    if (!pid) return [];
    return [{
        projectId: pid,
        title: rwStr(o.projectTitle || o.title || pid, 120),
        volume: rwStr(o.volumeTitle || o.volumeId || o.volume, 60),
        chapter: rwStr(o.chapter || o.chapterTitle || '', 60),
        lastFloor: rwFloor(o.floorEnd != null ? o.floorEnd : (o.lastFloor != null ? o.lastFloor : o.floor)),
        volumeId: rwStr(o.volumeId, 60),
        navKey: rwStr(o.navKey, 160),
        floorStart: rwFloor(o.floorStart)
    }];
}

/** 取一行上的楼层（`floor` 优先于 `lastFloor`；两处都没有即 null，**不补 0**）。 */
function rwRowFloor(row) {
    const o = rwObj(row) || {};
    return rwFloor(o.floor != null ? o.floor : o.lastFloor);
}

/**
 * 逐行分类：返回是否进本段读数，以及不进时的归因（串味面用）。
 *   拿不到会话身份（identityKnown=false）一律不进读数 —— fail-closed。
 */
function rwClassify(row, sel, identityKnown, pid) {
    if (!identityKnown) return { in: false, why: 'identity-unknown' };
    if (!rwSameScope(row, sel)) return { in: false, why: 'cross-scope' };
    const rp = rwStr((rwObj(row) || {}).projectId, 120);
    if (rp && rp !== pid) return { in: false, why: 'cross-project' };
    return { in: true, why: '' };
}

/* ────────────────────────── ④ 主入口 ────────────────────────── */

/**
 * 工作台要展示的面（顺序固定；**缺一面也要显式点名** —— 「没显示」与「没数据」不是一回事）。
 * 前四条是行面（调用方给数组），storyClock / finance 是**已判好的**读数面。
 */
export const RW_SECTION_FACES = Object.freeze(['commitments', 'characters', 'branches', 'evidence', 'storyClock', 'finance']);

/** 权限表：某一级是否可用（**只读恒可用** —— 看一眼不可能出错）。 */
function rwLevelsFor(listReadable, blocked, hasOwner) {
    return [
        { key: RW_LEVELS.read.key, label: RW_LEVELS.read.label, writes: RW_LEVELS.read.writes, available: true, why: '' },
        { key: RW_LEVELS.draft.key, label: RW_LEVELS.draft.label, writes: RW_LEVELS.draft.writes,
          available: !!listReadable, why: listReadable ? '' : RW_REASON_TEXT['project-list-unreadable'] },
        { key: RW_LEVELS.restore.key, label: RW_LEVELS.restore.label, writes: RW_LEVELS.restore.writes,
          available: !!(listReadable && !blocked && hasOwner),
          why: (!listReadable ? RW_REASON_TEXT['project-list-unreadable']
              : (!hasOwner ? RW_REASON_TEXT['no-owner-injected']
                  : (blocked ? RW_REASON_TEXT['precheck-blocked'] : ''))) }
    ];
}

/** 恢复请求（**只产请求**）：本模块没有任何写面，动主档的是注入的 owner。 */
function rwRestoreRequest(can, reason, actionable) {
    const r = rwStr(reason, 60);
    return {
        requested: false,
        held: !can,
        canRestore: !!can,
        reason: r,
        actionable: numOrNull(actionable) || 0,
        why: can ? '' : (RW_REASON_TEXT[r] || ('暂不可恢复（' + r + '）'))
    };
}

/** 空影响范围（**lastFloor 用 null 而不是 0** —— 0 是合法楼层）。 */
function rwEmptyImpact() {
    return { openItems: 0, characters: 0, branches: 0, materials: 0, lastFloor: null };
}

/** 结果基形（三个态共形：判据可以直接横比，不会因为缺字段而误判）。 */
function rwResult(over) {
    return Object.assign({
        version: RW_VERSION,
        state: RW_PROJECT_STATES.READY,
        stateText: RW_STATE_LABELS[RW_PROJECT_STATES.READY],
        reason: RW_REASONS.OK,
        listReadable: false,
        projects: [],
        project: null,
        projectCount: 0,
        sections: [],
        characters: [],
        conflicts: [],
        gaps: [],
        impact: rwEmptyImpact(),
        epoch: null,
        levels: [],
        canDraft: false,
        canRestore: false,
        restore: rwRestoreRequest(false, RW_REASONS.LIST_UNREADABLE, 0),
        precheck: null,
        brief: null,
        contrast: null
    }, over || {});
}

/**
 * 跨项目续玩工作台：把一份「接着玩」读数**一次收束完**。
 *
 * @param {object} input
 *   · chatId / branchKey  —— 当前段身份（**不给 ⇒ 什么都进不了读数**，fail-closed）；
 *   · selected            —— 选中的项目（至少给 projectId；volume / chapter 可选）；
 *   · projects            —— 项目清单（读不到给 null；**不是**给 []）；
 *   · notifications / characters / branches / materials
 *                        —— 四行面（null = 读不到、[] = 真没有、缺 = 本模块点名缺面）；
 *   · storyClock / finance —— 已判好的读数面（finance **可选**：不给不记 gap）；
 *   · inFlight            —— 在飞旧回信（[] = 没有、null = 读不到）；
 *   · precheck            —— resume-handoff.js 的预检结果（ok / blocked / unusable）；
 *   · owner               —— **真实执行体** `{ apply(req) }`（缺少 ⇒ 恢复恒 held）；
 *   · epoch               —— 本读数的世代号（回读时用于拒旧写）；
 *   · brief / contrast    —— 上游已算好的分节行 / 四组对照（本模块**不重算**）。
 * @returns {object} 一次完整读数（三态共形）
 */
export function buildResumeWorkbench(input = {}) {
    const o = rwObj(input) || {};
    const selRaw = rwObj(o.selected);
    const pid = rwStr((selRaw || {}).projectId, 120);
    const activeChatId = rwStr(o.chatId, 120) || rwStr((selRaw || {}).chatId, 120);
    const identityKnown = activeChatId !== '';
    const sel = {
        chatId: activeChatId,
        branchKey: rwStr(o.branchKey, 120) || rwStr((selRaw || {}).branchKey, 120)
    };

    const rawList = rwArr(o.projects);
    const listReadable = rawList !== null;
    const own = rwObj(o.owner);
    const hasOwner = !!(own && typeof own.apply === 'function');
    const epoch = numOrNull(o.epoch);

    /* ── 第 0 关：没选项目。**最先判、且直接返回** —— 不产出任何项目读数、不给恢复。 ── */
    if (!pid) {
        return rwResult({
            state: RW_PROJECT_STATES.NO_SELECTION,
            stateText: RW_STATE_LABELS[RW_PROJECT_STATES.NO_SELECTION],
            reason: RW_REASONS.NO_SELECTION,
            listReadable: listReadable,
            epoch: epoch,
            levels: rwLevelsFor(listReadable, true, hasOwner),
            canDraft: false,
            canRestore: false,
            restore: rwRestoreRequest(false, RW_REASONS.NO_SELECTION, 0)
        });
    }

    /* ── 第 1 关：清单**读不到**。与「清单是空的」处置相反，两者不同形。 ── */
    if (!listReadable) {
        return rwResult({
            state: RW_PROJECT_STATES.UNREADABLE,
            stateText: RW_STATE_LABELS[RW_PROJECT_STATES.UNREADABLE],
            reason: RW_REASONS.LIST_UNREADABLE,
            listReadable: false,
            epoch: epoch,
            gaps: [rwGap('项目清单', RW_REASONS.LIST_UNREADABLE)],
            levels: rwLevelsFor(false, true, hasOwner),
            canDraft: false,
            canRestore: false,
            restore: rwRestoreRequest(false, RW_REASONS.LIST_UNREADABLE, 0)
        });
    }

    /* ── 清单读得到：按内容去重（**绝不覆盖**） ── */
    const all = [];
    const seenPk = new Set();
    for (let i = 0; i < rawList.length; i++) {
        const r = rwProjectRow(rawList[i]);
        if (!r) continue;
        if (seenPk.has(r.projectKey)) continue;
        seenPk.add(r.projectKey);
        all.push(r);
    }

    const selVolume = rwStr((selRaw || {}).volume, 60);
    const selChapter = rwStr((selRaw || {}).chapter, 60);
    const selKey = pid + '|' + selVolume + '|' + selChapter;
    let matched = all.find((r) => r.projectKey === selKey) || null;
    if (!matched && !selVolume && !selChapter) matched = all.find((r) => r.projectId === pid) || null;

    const conflicts = [], cseen = new Set();
    const gaps = [];
    if (!matched) gaps.push(rwGap('选中的项目', RW_REASONS.NOT_IN_LIST));
    if (!identityKnown) gaps.push(rwGap('会话身份', RW_REASONS.UNIDENTIFIABLE));

    function noteOuts(faceLabel, outs) {
        const kinds = [
            ['cross-scope', RW_CONFLICT_KINDS.CROSS_SCOPE, '跟段（不进本段读数）'],
            ['cross-project', RW_CONFLICT_KINDS.PROJECT_MISMATCH, '跟项目（不进本段读数）'],
            ['identity-unknown', RW_CONFLICT_KINDS.UNIDENTIFIABLE, '身份缺项（不进本段读数）']
        ];
        for (let i = 0; i < kinds.length; i++) {
            const n = outs[kinds[i][0]] || 0;
            if (!n) continue;
            rwPushUnique(conflicts, cseen, rwConflict(kinds[i][1], faceLabel,
                '有 ' + n + ' 条' + kinds[i][2], faceLabel + ':' + kinds[i][1]));
        }
    }

    /* ── 四行面：null = 读不到；[] = 真没有；缺 = 点名缺面。三态处置各不相同。 ── */
    const FACE_CFG = [
        { key: 'notifications', face: 'commitments', label: '未了事项' },
        { key: 'characters', face: 'characters', label: '角色状态' },
        { key: 'branches', face: 'branches', label: '分支' },
        { key: 'materials', face: 'evidence', label: '可接续证据' }
    ];
    const sections = [];
    const inScope = {};
    for (let i = 0; i < FACE_CFG.length; i++) {
        const cfg = FACE_CFG[i];
        const given = Object.prototype.hasOwnProperty.call(o, cfg.key) && o[cfg.key] !== undefined;
        if (!given) {
            gaps.push(rwGap(cfg.label, RW_REASONS.FACE_MISSING));
            inScope[cfg.key] = null;
            sections.push({ face: cfg.face, label: cfg.label, readable: false, count: null, state: 'missing' });
            continue;
        }
        const arr = rwArr(o[cfg.key]);
        if (arr === null) {
            gaps.push(rwGap(cfg.label, RW_REASONS.FACE_UNREADABLE));
            inScope[cfg.key] = null;
            sections.push({ face: cfg.face, label: cfg.label, readable: false, count: null, state: 'unreadable' });
            continue;
        }
        const keep = [];
        const outs = { 'cross-scope': 0, 'cross-project': 0, 'identity-unknown': 0 };
        for (let j = 0; j < arr.length; j++) {
            const c = rwClassify(arr[j], sel, identityKnown, pid);
            if (c.in) keep.push(arr[j]);
            else outs[c.why] = (outs[c.why] || 0) + 1;
        }
        inScope[cfg.key] = keep;
        noteOuts(cfg.label, outs);
        sections.push({ face: cfg.face, label: cfg.label, readable: true, count: keep.length, state: 'ok' });
    }

    /* ── 剧情时间（调用方给的**已判好的**读数；本模块不重算时钟） ── */
    if (Object.prototype.hasOwnProperty.call(o, 'storyClock') && o.storyClock !== undefined) {
        const clock = rwObj(o.storyClock);
        if (clock) sections.push({ face: 'storyClock', label: '剧情时间', readable: true, count: null, state: 'ok', text: rwStr(clock.label, 60) });
        else {
            gaps.push(rwGap('剧情时间', RW_REASONS.FACE_UNREADABLE));
            sections.push({ face: 'storyClock', label: '剧情时间', readable: false, count: null, state: 'unreadable' });
        }
    } else {
        gaps.push(rwGap('剧情时间', RW_REASONS.FACE_MISSING));
        sections.push({ face: 'storyClock', label: '剧情时间', readable: false, count: null, state: 'missing' });
    }

    /* ── 财务（**可选面**：不给就不记 gap —— 不是每部作品都有账） ── */
    const finGiven = Object.prototype.hasOwnProperty.call(o, 'finance') && o.finance !== undefined;
    if (finGiven) {
        const fo = rwObj(o.finance);
        if (fo) sections.push({ face: 'finance', label: '财务', readable: true, count: numOrNull(fo.rows), state: 'ok', text: rwStr(fo.label, 60) });
        else {
            gaps.push(rwGap('财务', RW_REASONS.FACE_UNREADABLE));
            sections.push({ face: 'finance', label: '财务', readable: false, count: null, state: 'unreadable' });
        }
    }

    /* ── 角色：键是 作品标识|宇宙|名字 三元组（**同名异宇宙不合并**） ── */
    const charRows = inScope.characters || [];
    const charKeys = [];
    const ckSeen = new Set();
    const byName = new Map();
    for (let i = 0; i < charRows.length; i++) {
        const c = rwObj(charRows[i]);
        if (!c) continue;
        const nm = rwStr(c.name, 60);
        if (!nm) {
            rwPushUnique(conflicts, cseen, rwConflict(RW_CONFLICT_KINDS.UNIDENTIFIABLE, '角色', '没有名字，认不出', 'char:unnamed'));
            continue;
        }
        const k = rwCharacterKey(c);
        if (k && !ckSeen.has(k)) {
            ckSeen.add(k);
            charKeys.push({ key: k, name: nm, universe: rwStr(c.universe, 60), floor: rwRowFloor(c) });
        }
        if (!byName.has(nm)) byName.set(nm, new Set());
        byName.get(nm).add(rwStr(c.universe, 60));
    }
    byName.forEach((unis, nm) => {
        if (unis.size > 1) {
            rwPushUnique(conflicts, cseen, rwConflict(RW_CONFLICT_KINDS.SAME_NAME, nm,
                '同名角色分属 ' + unis.size + ' 个宇宙：**不合并**', 'same-name:' + nm));
        }
    });

    /* ── 影响范围（用户按确认之前必须看到的那几行） ── */
    let lastFloor = null;
    const noteFloor = (v) => { if (v !== null && (lastFloor === null || v > lastFloor)) lastFloor = v; };
    (inScope.notifications || []).forEach((r) => noteFloor(rwRowFloor(r)));
    charKeys.forEach((c) => noteFloor(c.floor));
    (inScope.branches || []).forEach((r) => noteFloor(rwRowFloor(r)));
    (inScope.materials || []).forEach((r) => noteFloor(rwRowFloor(r)));
    const impact = {
        openItems: (inScope.notifications || []).length,
        characters: charKeys.length,
        branches: (inScope.branches || []).length,
        materials: (inScope.materials || []).length,
        lastFloor: lastFloor
    };

    /* ── 在飞旧回信（有 ⇒ **恢复 held**，并点名） ── */
    let hasStale = false;
    if (!Object.prototype.hasOwnProperty.call(o, 'inFlight') || o.inFlight === undefined) {
        gaps.push(rwGap('在飞回信', RW_REASONS.FACE_MISSING));
    } else {
        const inf = rwArr(o.inFlight);
        if (inf === null) gaps.push(rwGap('在飞回信', RW_REASONS.FACE_UNREADABLE));
        else if (inf.length > 0) {
            hasStale = true;
            rwPushUnique(conflicts, cseen, rwConflict(RW_CONFLICT_KINDS.STALE_IN_FLIGHT, '在飞旧回信',
                '有 ' + inf.length + ' 条旧回信未落地：恢复前必须先挡住', 'in-flight'));
        }
    }

    /* ── 预检（ok / blocked / unusable —— 不可测 ≠ 通过） ── */
    const pre = rwObj(o.precheck);
    if (!pre) {
        gaps.push(rwGap('预检', RW_REASONS.FACE_MISSING));
    } else if (pre.state === 'unusable') {
        gaps.push(rwGap('预检', RW_REASONS.UNUSABLE));
    } else if (pre.state === 'blocked') {
        gaps.push(rwGap('预检', RW_REASONS.BLOCKED));
    }
    const blocked = !!pre && (pre.state === 'blocked' || pre.state === 'unusable');

    const canDraft = !!matched;
    const canRestore = !!(matched && hasOwner && !blocked && !hasStale);
    let rreason = RW_REASONS.OK;
    if (!matched) rreason = RW_REASONS.NOT_IN_LIST;
    else if (hasStale) rreason = RW_REASONS.BLOCKED;
    else if (blocked) rreason = (pre && pre.state === 'unusable') ? RW_REASONS.UNUSABLE : RW_REASONS.BLOCKED;
    else if (!hasOwner) rreason = RW_REASONS.NO_OWNER;

    return rwResult({
        state: RW_PROJECT_STATES.READY,
        stateText: RW_STATE_LABELS[RW_PROJECT_STATES.READY],
        reason: rreason,
        listReadable: true,
        projects: all,
        project: matched,
        projectCount: all.length,
        sections: sections,
        characters: charKeys,
        conflicts: conflicts,
        gaps: gaps,
        impact: impact,
        epoch: epoch,
        levels: rwLevelsFor(true, blocked || !canRestore, hasOwner),
        canDraft: canDraft,
        canRestore: canRestore,
        restore: rwRestoreRequest(canRestore, canRestore ? RW_REASONS.OK : rreason,
            impact.openItems + impact.characters + impact.branches + impact.materials),
        precheck: pre,
        brief: rwObj(o.brief),
        contrast: rwObj(o.contrast)
    });
}

/* ────────────────────────── ⑤ 接续草稿 ────────────────────────── */

/**
 * 接续草稿：把「接着玩要带上的东西」收成**纯数据**（不写存储、不发请求）。
 * **草稿必含缺口行** —— 缺面不许静默省略：草稿是给人看的，
 *   「你没带这一面」与「这一面是空的」必须能分辨。
 *
 * @param {object} work buildResumeWorkbench 的读数
 * @returns {object} 草稿（`empty` 为 true 时表示连标题都没有 —— 读数为空）
 */
export function rwDraftOf(work) {
    const w = rwObj(work);
    if (!w) return { empty: true, title: '', lines: [], gaps: [], conflictCount: 0, state: 'unusable' };
    const state = rwStr(w.state, 40);
    const lines = [];
    const proj = rwObj(w.project);
    if (proj) {
        lines.push('作品：' + (proj.title || proj.projectId)
            + (proj.volume ? ' · 卷 ' + proj.volume : '')
            + (proj.chapter ? ' · 章 ' + proj.chapter : ''));
        if (proj.branchKey) lines.push('当前分支：' + proj.branchKey);
        lines.push('最近停点：' + (proj.lastFloor === null ? '（未记录）' : '第 ' + proj.lastFloor + ' 楼'));
    }
    const secs = rwArr(w.sections) || [];
    for (let i = 0; i < secs.length; i++) {
        const s = rwObj(secs[i]) || {};
        if (s.state === 'ok') lines.push('· ' + s.label + '：' + (s.count === null ? (s.text || '在场') : s.count + ' 条'));
        else lines.push('· ' + s.label + '：**读不到**（' + (s.state === 'missing' ? '本次没给' : '取数失败') + '）');
    }
    const chars = rwArr(w.characters) || [];
    if (chars.length) {
        lines.push('角色（' + chars.length + '）：' + chars.slice(0, 8).map((c) => c.name + (c.universe ? '@' + c.universe : '')).join(' / ')
            + (chars.length > 8 ? ' …' : ''));
    }
    const gaps = (rwArr(w.gaps) || []).map((g) => '· ' + g.face + '：' + g.why);
    const conflicts = rwArr(w.conflicts) || [];
    const impact = rwObj(w.impact) || rwEmptyImpact();
    return {
        empty: false,
        state: state,
        title: '《' + ((proj && (proj.title || proj.projectId)) || '（未选中）') + '》接续草稿',
        lines: lines,
        gaps: gaps,
        conflictCount: conflicts.length,
        impact: impact,
        restoreEligible: !!w.canRestore,
        /* 草稿里必须明写「这份草稿不代表已恢复」 —— 否则「生成了草稿」会被读成「已经接上了」。 */
        notice: (!!w.canRestore ? '' : '本草稿仅为文本，**未发起恢复**')
    };
}

/* ────────────────────────── ⑥ 旧读数归因 ────────────────────────── */

/**
 * 一条恢复回读结果与新读数的**世代比**：旧世代的结果一律判 stale。
 * **世代读不出（null / undefined）即判 stale** —— 不可判定不得当「还有效」。
 *
 * @param {number|null} epoch 当前世代号
 * @param {number|null} at    回读结果所属世代号
 * @returns {string} '' 表示有效；否则给归因词
 */
export function rwStaleReason(epoch, at) {
    const cur = numOrNull(epoch);
    const old = numOrNull(at);
    if (cur === null || old === null) return 'epoch-unknown';
    if (old !== cur) return 'epoch-mismatch';
    return '';
}

/* ────────────────────────── ⑦ 恢复结果判定 ────────────────────────── */

/**
 * 恢复结果判定：**恢复只委托真实 owner**，本函数只判「这次恢复成不成、回读对上没有、旧写该不该拒」。
 *
 * 三条纪律（逐条对应 X8 原文的验收）：
 *   · `canRestore` 为假 ⇒ 根本没动手（`held`）—— 与 resume-handoff 的 held 同义；
 *   · 回读**不看写面自述**：`readback.state` 不是 ok ⇒ `partial`（写了但没对上 / 读不回）；
 *   · **旧异步写入必被拒**：回读结果的世代与当前世代不符（或任一侧读不出）
 *     ⇒ `stale-rejected`，且 `applied` **置回 false**（不能因为「写下去了」就说「成了」）。
 *
 * @param {object} work      buildResumeWorkbench 的读数
 * @param {object} applied   owner.apply 的返回（本模块**不自己动手**）
 * @param {object} readback  回读结果 `{state, at}`（真源 resume-handoff.readbackOf）
 * @returns {{applied:boolean, state:string, stale:boolean, why:string}}
 */
export function rwRestoreOutcome(work, applied, readback) {
    const w = rwObj(work);
    if (!w || w.canRestore !== true) {
        return { applied: false, state: 'held', stale: false,
            why: (w && w.restore && w.restore.why) || RW_REASON_TEXT[RW_REASONS.NO_OWNER] };
    }
    const a = rwObj(applied);
    if (!a || a.ok !== true) {
        return { applied: false, state: 'held', stale: false,
            why: '真实 owner 未执行（' + rwStr((a && a.reason) || 'no-apply-result', 60) + '）' };
    }
    const rb = rwObj(readback);
    const stale = rwStaleReason(w.epoch, rb ? rb.at : null) !== '';
    if (stale) {
        return { applied: false, state: 'stale-rejected', stale: true,
            why: '回读结果的世代与当前不符（旧异步写入）—— 拒收，不当作已恢复' };
    }
    const st = rwStr(rb && rb.state, 30);
    if (st !== 'ok') {
        return { applied: true, state: 'partial', stale: false,
            why: 'owner 已执行，但回读' + (st === 'unreadable' ? '取不到（**不是**「一致」）' : '与预期不符') };
    }
    return { applied: true, state: 'done', stale: false, why: '' };
}

/* ────────────────────────── ⑧ 三行文案（三态互不同形） ────────────────────────── */

/** 一级操作一行。 */
export function rwLevelLine(level) {
    const l = rwObj(level);
    if (!l) return '[操作] 读数不可用';
    const head = (l.writes ? '✎ ' : '◦ ') + (l.label || l.key || '?');
    if (l.available) return head + '（可用）' + (l.writes ? ' —— 会动数据，需真实 owner' : '');
    return head + '（暂不可用）' + (l.why ? '：' + l.why : '');
}

/**
 * 工作台一行总括。**三态必须互不同形**（这是本模块最容易被写坏的一处：
 *   「没选」写成「空」、「读不到」写成「0 个项目」，两者都是本仓最贵的错读数）。
 */
export function rwSummaryLine(work) {
    const w = rwObj(work);
    if (!w) return '[续玩] 读数不可用';
    const st = rwStr(w.state, 40);
    if (st === RW_PROJECT_STATES.NO_SELECTION) {
        return '[续玩] 尚未选择项目 —— 维持会话隔离（本项目读数一栏不产出）';
    }
    if (st === RW_PROJECT_STATES.UNREADABLE) {
        return '[续玩] 项目清单**读不到** —— 不是「没有作品」，是取数失败';
    }
    const proj = rwObj(w.project);
    const impact = rwObj(w.impact) || rwEmptyImpact();
    const name = proj ? (proj.title || proj.projectId) : '（选中的项目不在清单里）';
    const parts = [
        '[续玩] 《' + name + '》',
        '未了 ' + impact.openItems + ' · 角色 ' + impact.characters + ' · 分支 ' + impact.branches + ' · 证据 ' + impact.materials,
        impact.lastFloor === null ? '停点未记录' : '最近停在第 ' + impact.lastFloor + ' 楼'
    ];
    const tail = [];
    const conflicts = rwArr(w.conflicts) || [];
    if (conflicts.length) tail.push('冲突 ' + conflicts.length);
    const gaps = rwArr(w.gaps) || [];
    if (gaps.length) tail.push('缺面 ' + gaps.length);
    tail.push(w.canRestore ? '可请求恢复' : '不可恢复（' + (w.restore && w.restore.why ? w.restore.why : '条件不足') + '）');
    return parts.join(' · ') + ' · ' + tail.join(' · ');
}

/* ────────────────────────── ⑨ 自检（真 + 假两例都跑） ────────────────────────── */

/** 最小入参工厂（自检用）。 */
function rwFix(over) {
    return Object.assign({
        chatId: 'chat-1', branchKey: 'main',
        selected: { projectId: 'proj-A', volume: 'v1', chapter: 'c2', title: '红楼梦' },
        projects: [{ projectId: 'proj-A', volume: 'v1', chapter: 'c2', title: '红楼梦', lastFloor: 300 }],
        notifications: [{ floor: 301, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', title: '未回的信' }],
        characters: [{ name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', floor: 299 }],
        branches: [], materials: [],
        storyClock: { label: '春分' }, finance: { rows: 3, label: '$' },
        inFlight: [], precheck: { state: 'ok' }, owner: { apply: () => {} }, epoch: 7
    }, over || {});
}

/**
 * 模块自检：**每一条都跑真、假两例**（只跑真例只能证明「能跑」，证明不了「拦得住」）。
 * @returns {{problems:string[]}} problems 为空即自检通过
 */
export function resumeWorkbenchSelfCheck() {
    const problems = [];

    /* ① 三态不同形：三种入参必须给出三个**两两不同**的状态词与文案 */
    const a = buildResumeWorkbench(rwFix({ selected: null }));
    const b = buildResumeWorkbench(rwFix({ projects: null }));
    const c = buildResumeWorkbench(rwFix());
    if (a.state === b.state || b.state === c.state || a.state === c.state) problems.push('三态状态词不许同形');
    const la = rwSummaryLine(a), lb = rwSummaryLine(b), lc = rwSummaryLine(c);
    if (la === lb || lb === lc || la === lc) problems.push('三态文案不许同形');

    /* ② 没选项目 ⇒ 不产出任何项目读数（不是「读出来是空的」） */
    const leak = (a.projects || []).length + (a.characters || []).length + (a.sections || []).length;
    if (leak !== 0) problems.push('没选项目时不得产出任何项目读数');
    if (a.canRestore !== false) problems.push('没选项目时不得给恢复');
    if (a.canDraft !== false) problems.push('没选项目时不得给草稿');

    /* ③ 清单读不到 ≠ 清单为空：两者必须不同形 */
    const empty = buildResumeWorkbench(rwFix({ projects: [] }));
    if (b.state !== RW_PROJECT_STATES.UNREADABLE) problems.push('清单读不到必须归 unreadable');
    if (empty.state !== RW_PROJECT_STATES.READY) problems.push('清单为空仍是 ready（只是选不中）');
    if (rwSummaryLine(b) === rwSummaryLine(empty)) problems.push('读不到不许与空同形');

    /* ④ 跨项目 / 跨段行不混算 */
    const mixed = buildResumeWorkbench(rwFix({
        notifications: [
            { floor: 302, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', title: 'A 的' },
            { floor: 302, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-B', title: 'B 的' },
            { floor: 302, chatId: 'chat-2', branchKey: 'main', projectId: 'proj-A', title: '别段的' }
        ]
    }));
    if (mixed.impact.openItems !== 1) problems.push('跨项目/跳段行不得进本段读数');
    const kinds = (mixed.conflicts || []).map((x) => x.kind);
    if (kinds.indexOf(RW_CONFLICT_KINDS.PROJECT_MISMATCH) < 0) problems.push('跨项目必须报冲突');
    if (kinds.indexOf(RW_CONFLICT_KINDS.CROSS_SCOPE) < 0) problems.push('跳段必须报冲突');

    /* ⑤ 同名异宇宙不合并（拿名字当键会合成一个） */
    const same = buildResumeWorkbench(rwFix({
        characters: [
            { name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A' },
            { name: '林黛玉', universe: 'u2', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A' }
        ]
    }));
    if (same.characters.length !== 2) problems.push('同名异宇宙不得合并');
    if ((same.conflicts || []).filter((x) => x.kind === RW_CONFLICT_KINDS.SAME_NAME).length !== 1) problems.push('同名异宇宙必须报冲突');

    /* ⑥ 没有会话身份 ⇒ 什么都进不了读数（fail-closed），不得当成「全都在本段」 */
    const noId = buildResumeWorkbench(rwFix({ chatId: '', selected: { projectId: 'proj-A', volume: 'v1', chapter: 'c2' } }));
    if (noId.impact.openItems !== 0) problems.push('拿不到会话身份时不得把行算进本段');
    if ((noId.conflicts || []).filter((x) => x.kind === RW_CONFLICT_KINDS.UNIDENTIFIABLE).length < 1) problems.push('身份缺项必须报冲突');

    /* ⑦ 在飞旧回信 ⇒ 恢复 held（不能只看预检 ok 就放行） */
    const stale = buildResumeWorkbench(rwFix({ inFlight: [{ domain: 'x' }], precheck: { state: 'ok' } }));
    if (stale.canRestore !== false) problems.push('有在飞旧回信时不得给恢复');
    if (stale.restore.reason === RW_REASONS.OK) problems.push('有在飞旧回信时必须点名归因');
    const okFix = buildResumeWorkbench(rwFix());
    if (okFix.canRestore !== true) problems.push('干净入参必须可恢复（否则门关成谁都不可恢复）');

    /* ⑧ 没有真实 owner ⇒ 恢复 held（restore.writes 是声明，动手的必须是 owner） */
    const noOwner = buildResumeWorkbench(rwFix({ owner: null }));
    if (noOwner.canRestore !== false) problems.push('没有 owner 时不得给恢复');
    if (noOwner.restore.held !== true) problems.push('没有 owner 时恢复必须 held');

    /* ⑨ 缺面进 gap，可选面不给不记 gap */
    const noClock = buildResumeWorkbench(rwFix({ storyClock: null }));
    if (!(noClock.gaps || []).some((g) => g.face === '剧情时间')) problems.push('剧情时间缺面必须记 gap');
    const noFin = buildResumeWorkbench(rwFix({ finance: undefined }));
    if ((noFin.gaps || []).some((g) => g.face === '财务')) problems.push('财务是可选面，不给不得记 gap');

    /* ⑩ 草稿必含缺口行 + 草稿不平替已恢复 */
    const draft = rwDraftOf(noClock);
    if (!draft.gaps.length) problems.push('草稿必含缺口行');
    if (!draft.title) problems.push('草稿必须有标题');

    /* ⑪ 旧世代归因：读不出即 stale */
    if (rwStaleReason(7, 7) !== '') problems.push('同世代不得判 stale');
    if (rwStaleReason(7, 6) === '') problems.push('旧世代必须判 stale');
    if (rwStaleReason(null, 6) === '') problems.push('世代读不出必须判 stale（不可判定 > 保守）');
    if (rwStaleReason(7, null) === '') problems.push('回读世代读不出必须判 stale');

    /* ⑫ 影响范围：0 是合法楼层（不许把「没记录」编成 0） */
    const bare = { characters: [], branches: [], materials: [], finance: undefined, storyClock: null };
    const f0 = buildResumeWorkbench(rwFix(Object.assign({}, bare,
        { notifications: [{ floor: 0, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A' }] })));
    const fNone = buildResumeWorkbench(rwFix(Object.assign({}, bare, { notifications: [] })));
    if (f0.impact.lastFloor !== 0) problems.push('0 楼是合法停点');
    if (fNone.impact.lastFloor !== null) problems.push('没有停点必须记 null，不得补 0');

    /* ⑬ 恢复结果：held / done / partial / stale-rejected 四态互不同形，且旧世代不当作已恢复 */
    const okWork = buildResumeWorkbench(rwFix());
    const held = rwRestoreOutcome(buildResumeWorkbench(rwFix({ owner: null })), { ok: true }, { state: 'ok', at: 7 });
    const done = rwRestoreOutcome(okWork, { ok: true }, { state: 'ok', at: 7 });
    const part = rwRestoreOutcome(okWork, { ok: true }, { state: 'mismatch', at: 7 });
    const staleR = rwRestoreOutcome(okWork, { ok: true }, { state: 'ok', at: 6 });
    const seen = {};
    [held.state, done.state, part.state, staleR.state].forEach((x) => { seen[x] = 1; });
    if (Object.keys(seen).length !== 4) problems.push('恢复四态不许同形');
    if (staleR.applied !== false) problems.push('旧世代回读不得当作已恢复');
    if (staleR.stale !== true) problems.push('旧世代必须标 stale');
    if (done.applied !== true || done.state !== 'done') problems.push('干净回读必须判 done');
    const noOwnerApply = rwRestoreOutcome(okWork, null, { state: 'ok', at: 7 });
    if (noOwnerApply.applied !== false) problems.push('owner 没执行不得当作已恢复');

    /* ⑭ 存档包归一（项目清单取数面的**唯一口径**）：认得出 / 认不出 两态不同形 */
    const packOk = rwProjectsFromPack({ projectId: 'proj-A', projectTitle: '红楼梦', volumeId: 'v2', floorEnd: 420 });
    if (packOk.length !== 1) problems.push('上游接续包形态必须归一为 1 个项目行');
    const pk0 = packOk[0] || {};
    if (pk0.title !== '红楼梦') problems.push('项目标题必须取 projectTitle');
    if (pk0.volume !== 'v2') problems.push('卷必须取 volumeId');
    if (pk0.lastFloor !== 420) problems.push('停点必须取 floorEnd');
    if (rwProjectsFromPack({ raw: '{}', at: 1 }).length !== 0) problems.push('不含项目身份的包必须给空清单（不是硬塞一行）');
    if (rwProjectsFromPack(null).length !== 0) problems.push('非对象必须给空清单');
    if (rwProjectsFromPack({ projectId: 'p', floorEnd: 0 })[0].lastFloor !== 0) problems.push('0 楼是合法停点（不得补 0 也不得丢 0）');

    return { problems: problems };
}

/* ────────────────────────── ⑩ 导出清单 ────────────────────────── */

export default {
    RW_VERSION,
    RW_PROJECT_STATES,
    RW_STATE_LABELS,
    RW_LEVELS,
    RW_CONFLICT_KINDS,
    RW_CONFLICT_LABELS,
    RW_REASONS,
    RW_REASON_TEXT,
    RW_SECTION_FACES,
    buildResumeWorkbench,
    rwProjectsFromPack,
    rwDraftOf,
    rwStaleReason,
    rwRestoreOutcome,
    rwLevelLine,
    rwSummaryLine,
    resumeWorkbenchSelfCheck
};
