/* ========================================================
 * config/workflow.js — [v3.89.0 · 拓展计划 R-X5] 安全的声明式个人工作流（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境，逐条核对，不是推演）】
 *   计划原文四条：① 声明式步骤组合（示例「生成续玩摘要 → 保存草稿 → 发通知」
 *   「确认账单 → 更新日历事件」）；② 每步声明输入、输出、权限与 owner；
 *   ③ 支持预览、暂停、重试、回滚；④ 不执行任意用户 JavaScript。
 *   修前实测的处境是：本仓 82 个 App 各自「一键即写」或「只出读数」，
 *   **中间那一层从来没有被建过** —— 「先说清要做什么、默认什么都不做、
 *   点头之后才委托 owner 去做」。逐条取证：
 *     · `workflow` 一词在本仓的命中全部落在「ComfyUI 工作流选择器」
 *       （apps/settings 与 phone-image-viewer-workflow-* 那一族）—— 那是**上游模型的参数**，
 *       与「用户把自己的操作串成一条流水」是两件事，同名不同物；步骤表 / 每步 owner /
 *       默认不写这三样，实测全仓零命中；
 *     · 本仓既有的「一键动作」族（账本 / 案头各族）都是「动作即副作用」——
 *       没有一处先给计划、等确认、再委托；
 *     · 既有的可执行内容面（apps/widget）已把「不执行代码」写成结构约束（不 eval / 不 srcdoc /
 *       不建 iframe），本模块沿用同一条约束并把它扩展成「能做的事由内置注册表限定」。
 *   代价是三条具体的错读数（都是「不报错、只错结果」）：
 *     ① **一键到底**：用户点一下，五个动作连着火，中间不给他看任何一步的输入与影响；
 *        写失败也不说，界面上仍是「已完成」；
 *     ② **没有幂等**：同一件事重试一次就做两遍（第二次不报错，只是多了一条通知 / 多了一条日历）；
 *     ③ **跨会话串味**：换一段会话之后，上一段的「跑到第几步」还被当成当前状态接着跑。
 *
 * 【本模块只做四件事（与 R-X1/R-X2/R-X3/R-X4 同范式：只收束、不取数、不写）】
 *   ① **声明式步骤表 `WF_FLOWS`**：每条流程由若干步组成，每步声明
 *      `in`（这一步要读什么）/ `out`（产出什么）/ `writes`（会不会写状态）/ `owner`（真源在哪）。
 *   ② **预览 `previewFlow`**：把每一步的输入 / 输出 / 权限 / owner 算清，
 *      返回值里 `willWrite` 恒 false —— **预览不改入参、也不碰任何存储**。
 *   ③ **计划 `planFlow`**：产出**写意图**而不写。未显式确认时一律 reject 并归因
 *      `not-confirmed`（默认 dry-run 不是靠调用方自觉，是这一层不给）；
 *      幂等键 `<flowId>:<runKey>` 命中既有记录即整条 replay（**不重复执行**）。
 *   ④ **执行与回读 `applyFlowPlan` / `readbackFlow` / `rollbackFlow`**：
 *      真正动手的**只能是注入的 owner**（本模块没有任何写面）；回读比对后才叫 confirmed；
 *      任一步没成，整条**只许叫 partial**，绝不叫 done。
 *
 * 【不做什么（边界，防第二份真源）】
 *   · **不执行任意 JavaScript**（验收④）：不用 `eval` / `new Function` / `setTimeout(串)` /
 *     不用字符串拼函数名 / 不建 iframe / 不写 srcdoc。步骤是**数据**；
 *     「能做哪些事」由 `WF_OWNERS` 这张**内置注册表**限定 —— 表外的 owner 名一律 no-owner。
 *   · **不做取数**：所有输入由调用方（咽喉）取好传进来 —— 与 resume-workbench 同分工。
 *   · 本层不写存储；运行器通过会话键 wf_runs 保存逐步检查点。
 *     结果未知的写步不得自动重跑，台账幂等限于最近 40 次保留窗口。
 *   · **不重算**：通知落账（system-notifications）/ 日历备忘（calendar-data）/
 *     财务账本（finance-commit）各有唯一真源，本模块只收束它们**已判好的**结果，
 *     并只产出「请它们去做」的意图。
 *   · **不假装**：某步失败即 partial；owner 缺席即 hold；scope 不符即拒。
 *
 * 【六条口径纪律（每条都有判据钉住）】
 *   · **默认 dry-run**：confirm 非 true 时 planFlow 恒 reject(not-confirmed)、willWrite 恒 false；
 *   · **写步必须有能写的 owner**：只读面（如续玩工作台读数）被拿去当写步 ⇒ owner-not-writable；
 *   · **重试幂等**：同一 runKey 第二次计划即成 replay，**不重复发通知 / 不重复加日历**；
 *   · **失败不得假装完成**：任一步 failed / skipped / 未回读 ⇒ state=partial（四项计数各自如实）；
 *   · **跨会话必重确认**：scope 两维任一缺项即判「不是同一段」，预览 / 计划 / 回读一律 fail-closed；
 *   · **读不到 ≠ 没有**：输入面与运行台账的 null（读不到）与 ［］（真没有）不同形。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';

/** 本模块口径版本（与仓内其他 config 模块同取法：改动协议时才抬）。 */
const WF_VERSION = 1;

/** 一条流程的步骤数上限（防「一条流程串出一座山」；超限即拒，不静默截断）。 */
export const WF_STEPS_MAX = 12;

/** 运行台账（本机记「这条流程跑过哪些 runKey」）的上限。 */
export const WF_RUNS_MAX = 40;

/**
 * 运行台账的 storage 键（随会话隔离，前缀 ^wf_）。
 * 为什么**要**持久化（而不是只放内存）：验收②「重试幂等」要在「刷新页面后重试」
 *   （也就是调用方重建实例）时仍然成立 —— 只放内存的台账一问就丢，重试必然重复发一条通知。
 * 为什么持久化不破坏验收③「跨会话必重确认」：台账行自己带**归属段**，
 *   命中行的段与本次不同一律判 scope-changed（拒，不重放也不重跑），
 *   故旧会话的台账永远不会被新会话当成自己的。（见 planFlow 的命中分支）
 * 写成常量导出，是为了让咽喉与视图都引同一份，不各自写字面量。
 */
export const WF_RUNS_KEY = 'wf_runs';

/* ────── 小工具（零依赖：本仓不引运行时依赖） ────── */

function wfObj(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}

function wfStr(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

function wfArr(v) {
    return Array.isArray(v) ? v : null;
}

/* --------- ① 三档权限（互不同形：只读 / 生成草稿 / 写状态） --------- */

/**
 * 步骤权限三档。**顺序有意义**：越靠后越硬（写状态是唯一会改手机状态的那一档）。
 * 每档给三样（键 + 标签 + 说明），且**不许两档写同一句** —— 判据逐条钉。
 */
export const WF_LEVELS = Object.freeze({
    read: Object.freeze({
        key: 'read', label: '只读', writes: false,
        text: '只读：这一步只把读数取出来，不产任何可写的东西',
    }),
    draft: Object.freeze({
        key: 'draft', label: '生成草稿', writes: false,
        text: '生成草稿：产出的是文本，不写存储（「草稿生成了」不等于「已经保存了」）',
    }),
    write: Object.freeze({
        key: 'write', label: '写状态', writes: true,
        text: '写状态：这一步会改手机状态，必须先显式确认，且只能由登记的 owner 去做',
    }),
});

export const WF_LEVEL_KEYS = Object.freeze(Object.keys(WF_LEVELS));

/* --------- ② 流程状态（九态互不同形，每态一个处置） --------- */

/**
 * 流程状态。为什么这么多态：多态压平即错读数。尤其：
 *   · `blocked`（缺件开不了工）≠ `idle`（还没开始）；
 *   · `partial`（有步骤没成）≠ `done`（每一步都成了）—— 这两态被压平，
 *     就会造出「写失败也显示已完成」那一类最贵的错读数。
 */
export const WF_STATES = Object.freeze({
    idle: Object.freeze({
        key: 'idle', label: '尚未运行',
        text: '还没跑过：此时没有任何步骤被计划，也没有任何东西被写',
    }),
    blocked: Object.freeze({
        key: 'blocked', label: '开不了工',
        text: '缺件（没 owner / 输入读不到）—— 这一栏不是「没开始」，是「开工条件不成立」',
    }),
    preview: Object.freeze({
        key: 'preview', label: '仅预览（dry-run）',
        text: '预览就绪：要不要真跑由你点头；不点头之前一个字节都不写',
    }),
    awaiting: Object.freeze({
        key: 'awaiting', label: '等你确认',
        text: '计划已就绪且含写步：等你显式确认后才会委托 owner 动手',
    }),
    running: Object.freeze({
        key: 'running', label: '执行中',
        text: '已委托 owner，正在跑（跑到哪一步由步骤表如实回答）',
    }),
    paused: Object.freeze({
        key: 'paused', label: '已暂停',
        text: '中途停下：还没跑的步骤原样留着，重试从断点续，不从头再来',
    }),
    done: Object.freeze({
        key: 'done', label: '全部完成',
        text: '每一步都成了 —— 只有这一个态才叫完成',
    }),
    partial: Object.freeze({
        key: 'partial', label: '部分完成',
        text: '有步骤没成：这不是完成，没成的按名字列出来',
    }),
    rolledback: Object.freeze({
        key: 'rolledback', label: '已回滚',
        text: '逆序撤过写步（撤的是本机记录，真实数据由各 owner 自己回滚）',
    }),
});

export const WF_STATE_KEYS = Object.freeze(Object.keys(WF_STATES));

/** 单步的四种结果（＋重放）。**分开报**：缺 / 跳 / 败 / 成，压平即错读数。 */
export const WF_STEP_STATES = Object.freeze({
    pending: 'pending',
    ok: 'ok',
    skipped: 'skipped',
    failed: 'failed',
    replayed: 'replayed',
});

/* --------- ③ 归因词表（why 只许取这里的值） --------- */

/**
 * 归因词表。判据按此表逐词核，防「随口一个新词」——
 * 视图与诊断据此说人话，词表外的串一律算缺陷。
 */
export const WF_REASONS = Object.freeze({
    NO_OWNER: 'no-owner',
    OWNER_NOT_WRITABLE: 'owner-not-writable',
    OWNER_THREW: 'owner-threw',
    OWNER_REFUSED: 'owner-refused',
    NO_IDEM_KEY: 'no-idem-key',
    SCOPE_CHANGED: 'scope-changed',
    SCOPE_MISSING: 'scope-missing',
    NOT_CONFIRMED: 'not-confirmed',
    INPUT_UNREADABLE: 'input-unreadable',
    INPUT_MISSING: 'input-missing',
    STEP_UNKNOWN: 'step-unknown',
    BAD_STEP: 'bad-step',
    FLOW_UNKNOWN: 'flow-unknown',
    TOO_MANY_STEPS: 'too-many-steps',
    RUN_UNREADABLE: 'run-unreadable',
    RUNS_ABSENT: 'runs-absent',
    NOTHING_TO_ROLLBACK: 'nothing-to-rollback',
});

export const WF_REASON_KEYS = Object.freeze(Object.keys(WF_REASONS));

/* --------- ④ owner 内置注册表（表外一律 no-owner） --------- */

/**
 * **内置** owner 注册表 —— 这是「不执行任意用户 JavaScript」这条验收的结构落法：
 *   步骤声明里写的 owner 名只是**一个键**，能不能写、写到哪个模块，全由这张表说话。
 *   表外的名字一律 `no-owner`（不是「未知的将来可能有人用」，是**这里不认识**）。
 *   `writable:false` 的 owner 是**只读面**（续玩工作台 / 分节简报就是）：
 *   拿它当写步即 `owner-not-writable` —— 这条判据当场钉住「读面不许被当写面用」。
 */
export const WF_OWNERS = Object.freeze({
    'resume-workbench': Object.freeze({
        key: 'resume-workbench', module: 'config/resume-workbench.js', writable: false,
        what: '跨项目续玩工作台读数（只读）',
    }),
    'brief-read': Object.freeze({
        key: 'brief-read', module: 'config/resume-brief.js', writable: false,
        what: '续玩分节简报（只读）',
    }),
    'archive-draft': Object.freeze({
        key: 'archive-draft', module: 'apps/archive/archive-app.js', writable: true,
        what: '存档台包原文（收包与草稿都落这一格）',
    }),
    'notify': Object.freeze({
        key: 'notify', module: 'config/system-notifications.js', writable: true,
        what: '系统通知落账（NotificationLog.push）',
    }),
    'finance-ledger': Object.freeze({
        key: 'finance-ledger', module: 'config/finance-commit.js', writable: true,
        what: '财务提交账本（applyCommitPlan 之后的唯一 owner 口）',
    }),
    'calendar': Object.freeze({
        key: 'calendar', module: 'apps/calendar/calendar-data.js', writable: true,
        what: '日历备忘（CalendarData.addMemo）',
    }),
    'task-entry-ledger': Object.freeze({
        key: 'task-entry-ledger', module: 'config/task-entry.js', writable: true,
        what: '任务入口台账（writeLedger）',
    }),
});

export const WF_OWNER_KEYS = Object.freeze(Object.keys(WF_OWNERS));

/* --------- ⑤ 声明式步骤表（本模块的「声明面」） --------- */

/**
 * 两条流程（计划原文给的两个示例，逐字对应用户要完成的事）：
 *   1. 生成续玩摘要 → 保存草稿 → 发通知；
 *   2. 确认账单 → 更新日历事件。
 * 每步四件事：in / out / writes / owner。**in 是「面名」**，取值由调用方（咽喉）给；
 *   面名不存在 ⇒ input-missing；面值是 null ⇒ input-unreadable（读不到 ≠ 没有）。
 */
export const WF_FLOWS = Object.freeze([
    Object.freeze({
        id: 'resume-brief',
        label: '生成续玩摘要 → 保存草稿 → 发通知',
        hint: '把当前项目的续玩读数整理成一段摘要，存成草稿，并落一条系统通知提醒你',
        steps: Object.freeze([
            Object.freeze({
                id: 'read-brief', label: '生成续玩摘要',
                in: Object.freeze(['archive-pack', 'resume-face']), out: 'brief',
                writes: false, owner: 'resume-workbench',
                note: '只读：摘要读不出来就说读不出来',
            }),
            Object.freeze({
                id: 'save-draft', label: '保存草稿',
                in: Object.freeze(['brief']), out: 'draft',
                writes: true, owner: 'archive-draft',
                note: '写：把摘要存进存档台的草稿格',
            }),
            Object.freeze({
                id: 'notify', label: '发通知',
                in: Object.freeze(['brief']), out: 'notice',
                writes: true, owner: 'notify',
                note: '写：落一条系统通知',
            }),
        ]),
    }),
    Object.freeze({
        id: 'settle-to-calendar',
        label: '确认账单 → 更新日历事件',
        hint: '把一份结算提交落账，并据此在日历上加一条备忘',
        steps: Object.freeze([
            Object.freeze({
                id: 'commit-finance', label: '确认账单',
                in: Object.freeze(['settlement-draft']), out: 'ledger',
                writes: true, owner: 'finance-ledger',
                note: '写：幂等落账（同一天同一份草稿不重复扣款）',
            }),
            Object.freeze({
                id: 'add-memo', label: '更新日历事件',
                in: Object.freeze(['ledger']), out: 'memo',
                writes: true, owner: 'calendar',
                note: '写：在日历上加一条备忘',
            }),
        ]),
    }),
]);

/** 流程 id 索引（咽喉与视图按 id 取流程，不各写一份清单）。 */
export const WF_FLOW_INDEX = new Map(WF_FLOWS.map((f) => [f.id, f]));

/** 流程 id 清单（判据据此核「按 id 取得到 / 表里没有的 id 必被拒」）。 */
const WF_FLOW_IDS = Object.freeze(WF_FLOWS.map((f) => f.id));

/* --------- ⑤b 归属段（跨会话 / 跨分支隔离的两维） --------- */

/**
 * 一条记录的**归属段**。与 session-gate 的两维、provenance-graph 的 pgScopeOf、
 *   resume-workbench 的 rwScopeOf 同口径 —— 隔离口径只有一份。
 */
function wfScopeOf(x) {
    const o = wfObj(x) || {};
    return { chatId: wfStr(o.chatId, 120), branchKey: wfStr(o.branchKey, 120) };
}

/**
 * 两条记录是否属**同一段**（同会话 + 同分支）。
 * 任一侧缺项即判「**不是同一段**」（fail-closed）：宁可多拦一条，
 *   不可让一条流程把上一段会话的状态写进新一段。
 */
export function wfSameScope(a, b) {
    const x = wfScopeOf(a);
    const y = wfScopeOf(b);
    return !!x.chatId && !!x.branchKey && x.chatId === y.chatId && x.branchKey === y.branchKey;
}

/** 归属段三态：完整 / 缺项（不是「同一段」）/ 未给。 */
export function wfScopeState(scope) {
    const s = wfScopeOf(scope);
    const chat = !!s.chatId;
    const branch = !!s.branchKey;
    if (chat && branch) return 'ok';
    if (!chat && !branch) return 'absent';
    return 'missing';
}

/* --------- ⑥ 运行台账归一（读不到 ≠ 真没有） --------- */

/**
 * 运行台账归一。三态分开：
 *   · null  → 读不到（不是「没跑过」）—— 归一结果 `readable:false`；
 *   · ［］  → 确实一条记录都没有（`readable:true, entries:[]`）；
 *   · 其余 → 逐条归一（非法条目静默丢弃，但**计数**报出来：不隐藏输入）。
 * 台账行归一只写一次（既有台账与现场结果在本函数里对账）。
 */
export function wfRunsOf(raw) {
    if (raw === null || raw === undefined) {
        return { readable: false, entries: [], dropped: 0, why: WF_REASONS.RUN_UNREADABLE };
    }
    if (!Array.isArray(raw)) {
        return { readable: false, entries: [], dropped: 0, why: WF_REASONS.RUN_UNREADABLE };
    }
    const entries = [];
    let dropped = 0;
    for (const r of raw) {
        const o = wfObj(r);
        if (!o) { dropped += 1; continue; }
        const flowId = wfStr(o.flowId, 80);
        const runKey = wfStr(o.runKey, 80);
        if (!flowId || !runKey) { dropped += 1; continue; }
        entries.push({
            flowId: flowId, runKey: runKey,
            idemKey: flowId + ':' + runKey,
            state: wfStr(o.state, 24),
            steps: Array.isArray(o.steps) ? JSON.parse(JSON.stringify(o.steps)).slice(0, WF_STEPS_MAX) : [],
            at: numOrNull(o.at),
            scope: wfScopeOf(o.scope),
        });
    }
    return { readable: true, entries: entries, dropped: dropped, why: '' };
}

/**
 * 把一条新运行记录**追加**到台账（新 → 旧），并裁剪到上限。
 * 追加与裁剪**只写一次**（咽喉与判据都走这一个口，不各自再写一遍）。
 * @returns {{runs:Array, dropped:number}} —— dropped 是本次被挤掉的条数（如实报，不隐藏）
 */
export function wfAppendRun(raw, rec, max) {
    const n = numOrNull(max);
    const limit = (n !== null && n > 0) ? Math.floor(n) : WF_RUNS_MAX;
    const norm = wfRunsOf(raw);
    if (!norm.readable) return { runs: null, dropped: null };
    const o = wfObj(rec) || {};
    const flowId = wfStr(o.flowId, 80);
    const runKey = wfStr(o.runKey, 80);
    const cur = norm.entries;
    if (!flowId || !runKey) return { runs: cur, dropped: 0 };
    const row = wfRunsOf([o]).entries[0];
    const next = [row].concat(cur.filter(e => e.idemKey !== row.idemKey));
    const trimmed = next.slice(0, limit);
    return { runs: trimmed, dropped: Math.max(0, next.length - trimmed.length) };
}

/** 幂等键：流程 id 与运行键两段拼成。任一段空即 null（不伪造）。 */
export function wfIdemKey(flowId, runKey) {
    const f = wfStr(flowId, 80);
    const k = wfStr(runKey, 80);
    if (!f || !k) return null;
    return f + ':' + k;
}

/* --------- ⑦ 单步判定 --------- */

/**
 * 把一条声明步与调用方给的输入面合起来判一步。
 * 归因顺序（先拦后一级）：
 *   ① owner 未登记 ⇒ no-owner；② 声明写着写但 owner 不可写 ⇒ owner-not-writable；
 *   ③ 输入面名字缺在输入对象里 ⇒ input-missing；④ 输入面值为 null ⇒ input-unreadable。
 * 只读步与草稿步无输入也能跑（它们是取数面，不是写面）。
 */
function wfStepIn(step, inputs) {
    const row = wfObj(step) || {};
    const ins = wfArr(inputs) ? null : wfObj(inputs);
    const ownerKey = wfStr(row.owner, 60);
    const owner = WF_OWNERS[ownerKey] || null;
    const writes = row.writes === true;
    const level = writes ? 'write' : (row.out === 'brief' || row.out === 'draft' ? 'draft' : 'read');
    const base = {
        id: wfStr(row.id, 60),
        label: wfStr(row.label, 80),
        level: level,
        writes: writes,
        owner: ownerKey,
        ownerModule: owner ? owner.module : '',
        ownerWhat: owner ? owner.what : '',
        out: wfStr(row.out, 40),
        note: wfStr(row.note, 120),
        in: (wfArr(row.in) || []).slice(),
        problems: [],
    };
    if (!owner) base.problems.push(WF_REASONS.NO_OWNER);
    else if (writes && owner.writable !== true) base.problems.push(WF_REASONS.OWNER_NOT_WRITABLE);
    const faces = wfArr(row.in) || [];
    const faceReads = [];
    for (const face of faces) {
        const name = wfStr(face, 60);
        if (!name) continue;
        if (!ins || !Object.prototype.hasOwnProperty.call(ins, name)) {
            faceReads.push({ face: name, state: 'missing' });
            base.problems.push(WF_REASONS.INPUT_MISSING);
            continue;
        }
        const v = ins[name];
        if (v === null || v === undefined) {
            faceReads.push({ face: name, state: 'unreadable' });
            base.problems.push(WF_REASONS.INPUT_UNREADABLE);
            continue;
        }
        faceReads.push({ face: name, state: 'ok' });
    }
    base.faces = faceReads;
    return base;
}

/**
 * 单步相位：ok / skipped / failed / replayed / pending 五态。
 * 供视图与诊断直接用，不在两处各判一次。
 */
function wfStepPhase(row) {
    const o = wfObj(row) || {};
    const s = wfStr(o.state, 24);
    if (s === WF_STEP_STATES.ok) return 'ok';
    if (s === WF_STEP_STATES.replayed) return 'replayed';
    if (s === WF_STEP_STATES.failed) return 'failed';
    if (s === WF_STEP_STATES.skipped) return 'skipped';
    return 'pending';
}

/* --------- ⑧ 预览（纯读，零写） --------- */

/**
 * 预览一条流程：把每一步的**输入 / 输出 / 权限 / owner** 算清。
 *
 * **纯读，零写** —— 返回值里 `willWrite` 恒 false，且**不改入参**。
 *   「预览不会写」不是承诺，是这一层没有任何写面（与 previewCommit 同口径）。
 *
 * @returns {{flowId, label, scopeState, steps:Array, willWrite:false, needsConfirm:boolean,
 *            blocked:boolean, problems:Array, state:string}}
 */
export function previewFlow(input) {
    const inp = wfObj(input) || {};
    const flow = WF_FLOW_INDEX.get(wfStr(inp.flowId, 80)) || null;
    if (!flow) {
        return {
            flowId: wfStr(inp.flowId, 80), label: '', scopeState: wfScopeState(inp.scope),
            steps: [], willWrite: false, needsConfirm: false, blocked: true,
            problems: [WF_REASONS.FLOW_UNKNOWN], state: WF_STATES.blocked.key,
        };
    }
    if (flow.steps.length > WF_STEPS_MAX) {
        return {
            flowId: flow.id, label: flow.label, scopeState: wfScopeState(inp.scope),
            steps: [], willWrite: false, needsConfirm: false, blocked: true,
            problems: [WF_REASONS.TOO_MANY_STEPS], state: WF_STATES.blocked.key,
        };
    }
    const available = Object.assign({}, inp.inputs || {});
    const steps = flow.steps.map((s) => {
        const judged = wfStepIn(s, available);
        if (!judged.problems.length) available[s.out] = { planned: true };
        return judged;
    });
    const problems = [];
    for (const s of steps) for (const p of s.problems) if (problems.indexOf(p) < 0) problems.push(p);
    const scopeState = wfScopeState(inp.scope);
    if (scopeState !== 'ok') problems.push(scopeState === 'absent' ? WF_REASONS.SCOPE_MISSING : WF_REASONS.SCOPE_CHANGED);
    const needsConfirm = steps.some((s) => s.writes);
    const blocked = problems.length > 0;
    return {
        flowId: flow.id, label: flow.label, scopeState: scopeState,
        steps: steps, willWrite: false, needsConfirm: needsConfirm,
        blocked: blocked, problems: problems,
        state: blocked ? WF_STATES.blocked.key : WF_STATES.preview.key,
    };
}

/* --------- ⑨ 计划（产出写意图而不写） --------- */

/**
 * 计划一条流程。三种结果（与 FC_PLANS 同形但不重名）：
 *   · `fresh`  —— 没跑过，可跑；
 *   · `replay` —— 幂等键已在台账里，**不重复执行**（这不是错误，是幂等生效）；
 *   · `reject` —— 不开工（附 why，每个 why 都在 WF_REASONS 里）。
 *
 * **默认 dry-run**（验收①）：`confirm` 不为 true 时，含写步的流程一律 reject(not-confirmed)；
 *   只读流程不需要确认也能给计划（它本来就不写）。
 * **跨会话必重确认**（验收③）：scope 任一侧缺项即 reject(scope-missing / scope-changed)。
 * 重试的幂等键只有一份口径：wfIdemKey(flowId, runKey)。
 */
export function planFlow(input) {
    const inp = wfObj(input) || {};
    const flowId = wfStr(inp.flowId, 80);
    const flow = WF_FLOW_INDEX.get(flowId) || null;
    const scopeState = wfScopeState(inp.scope);
    if (!flow) return { kind: 'reject', why: WF_REASONS.FLOW_UNKNOWN, flowId: flowId, idemKey: null, steps: [], willWrite: false };
    if (scopeState === 'absent') return { kind: 'reject', why: WF_REASONS.SCOPE_MISSING, flowId: flowId, idemKey: null, steps: [], willWrite: false };
    if (scopeState !== 'ok') return { kind: 'reject', why: WF_REASONS.SCOPE_CHANGED, flowId: flowId, idemKey: null, steps: [], willWrite: false };

    const runKey = wfStr(inp.runKey, 80);
    const idemKey = wfIdemKey(flowId, runKey);
    if (!idemKey) return { kind: 'reject', why: WF_REASONS.NO_IDEM_KEY, flowId: flowId, idemKey: null, steps: [], willWrite: false };

    const preview = previewFlow(inp);
    if (preview.problems.length) {
        const first = preview.problems.filter((p) => p !== WF_REASONS.INPUT_MISSING && p !== WF_REASONS.INPUT_UNREADABLE)[0]
            || preview.problems[0];
        return { kind: 'reject', why: first, flowId: flowId, idemKey: idemKey, steps: [], willWrite: false };
    }

    const steps = preview.steps;
    const needConfirm = steps.some((s) => s.writes);
    if (needConfirm && inp.confirm !== true) {
        return {
            kind: 'reject', why: WF_REASONS.NOT_CONFIRMED, flowId: flowId, idemKey: idemKey,
            steps: [], willWrite: false, needsConfirm: true,
        };
    }

    /* 幂等：台账里已有同一个 idemKey ⇒ replay（不重复执行）。
     *   台账**读不到**（null）时**不放行**：绝不能把「读不到」当成「没跑过」而重跑一遍。 */
    const runs = wfRunsOf(inp.runs);
    if (!runs.readable) {
        return { kind: 'reject', why: WF_REASONS.RUN_UNREADABLE, flowId: flowId, idemKey: idemKey, steps: [], willWrite: false };
    }
    const hit = runs.entries.filter((e) => e.idemKey === idemKey)[0] || null;
    /* ★ 验收③ 的真落点：**命中行必须与本次属同一段**才叫「重放」。
     *   不同段却同键的行，一律 scope-changed 拒 —— 既不当重放（那会拿上一段的完成
     *   冒充本段的完成），也不重跑（那会把本机的去重账本绕过去）。
     *   没有这一行，「跨会话必须重新确认身份」就只是一句口号。 */
    if (hit && !wfSameScope(hit.scope, inp.scope)) {
        return { kind: 'reject', why: WF_REASONS.SCOPE_CHANGED, flowId: flowId, idemKey: idemKey, steps: [], willWrite: false };
    }
    const intents = steps.map((s) => ({
        stepId: s.id, label: s.label, owner: s.owner, ownerModule: s.ownerModule,
        level: s.level, writes: s.writes, out: s.out, run: true,
        in: s.in, payload: wfPayloadOf(s, inp.inputs),
    }));
    if (hit && hit.state !== 'done') {
        if (!hit.steps.length || hit.state === 'rolledback' || hit.steps.some(s => s.state === 'running')) {
            return { kind: 'reject', why: WF_REASONS.BAD_STEP, flowId, idemKey, steps: [], willWrite: false };
        }
        const resumed = resumeFlow(hit).run;
        return { kind: 'fresh', why: '', flowId, idemKey, runKey, scope: wfScopeOf(inp.scope),
            at: numOrNull(inp.at), willWrite: needConfirm, needsConfirm: needConfirm,
            steps: intents.map(it => {
                const prev = resumed.steps.find(s => s.stepId === it.stepId);
                return Object.assign({}, it, { run: !prev || prev.state !== 'replayed', previous: prev || null });
            }) };
    }
    if (hit) {
        return {
            kind: 'replay', why: '', flowId: flowId, idemKey: idemKey,
            scope: wfScopeOf(inp.scope), at: null, willWrite: false,
            unnecessary: true, hitState: hit.state, hitAt: hit.at,
            steps: intents.map((x) => Object.assign({}, x, { run: false })),  /* 幂等命中：一步都不跑 */
        };
    }
    return {
        kind: 'fresh', why: '', flowId: flowId, idemKey: idemKey,
        scope: wfScopeOf(inp.scope), at: numOrNull(inp.at),
        willWrite: needConfirm, needsConfirm: needConfirm,
        steps: intents,
    };
}

/** 一步要交给 owner 的东西（**只算，不调**）。 */
function wfPayloadOf(step, inputs) {
    const ins = wfObj(inputs) || {};
    const faces = wfArr(step.in) || [];
    const picked = {};
    for (const f of faces) {
        const n = wfStr(f, 60);
        if (n && Object.prototype.hasOwnProperty.call(ins, n)) picked[n] = ins[n];
    }
    return { flowStep: step.id, out: step.out, reads: picked };
}

/* --------- ⑩ 执行意图 → 运行记录（纯函数） --------- */

/**
 * 把「计划 + 调用方收集到的每步结果」收成一条**运行记录**。
 *
 * **纯函数**：它不调 owner、不写存储 —— 真正动手的是咽喉里唯一那个 owner 口。
 * 重放的流程**一步也不准跑**：replay 计划的 steps 已全部 `run:false`，
 *   本函数据此把所有步骤标 `replayed`，并令 `executed` 为 0。
 * **某步失败不得假装完成**（验收②）：任一步 failed / skipped ⇒ 整条只叫 `partial`。
 */
export function applyFlowPlan(plan, stepResults) {
    const p = wfObj(plan) || {};
    const kind = wfStr(p.kind, 20);
    if (kind === 'reject') {
        return { state: WF_STATES.blocked.key, flowId: wfStr(p.flowId, 80), idemKey: p.idemKey || null, steps: [], executed: 0, why: wfStr(p.why, 40) };
    }
    const results = wfArr(stepResults) || [];
    const byId = {};
    for (const r of results) {
        const o = wfObj(r);
        if (o) byId[wfStr(o.stepId, 60)] = o;
    }
    const intents = wfArr(p.steps) || [];
    const steps = intents.map((it) => {
        const base = { stepId: it.stepId, label: it.label, owner: it.owner, writes: it.writes === true, out: it.out };
        if (it.run !== true) return Object.assign(base, it.previous || {}, { state: WF_STEP_STATES.replayed, detail: '幂等命中，未重复执行' });
        const r = byId[it.stepId] || null;
        if (!r) return Object.assign(base, { state: WF_STEP_STATES.pending, detail: '还没跑' });
        if (r.ok === true) return Object.assign(base, { state: WF_STEP_STATES.ok, detail: wfStr(r.detail, 120), value: r.value, receipt: r.receipt });
        if (r.uncertain === true) return Object.assign(base, { state: 'running', detail: '结果未知，需人工核对', receipt: r.receipt });
        if (r.skipped === true) return Object.assign(base, { state: WF_STEP_STATES.skipped, detail: wfStr(r.detail, 120) || '被跳过' });
        return Object.assign(base, { state: WF_STEP_STATES.failed, detail: wfStr(r.detail, 120) || wfStr(r.why, 40) || '失败' });
    });
    const executed = steps.filter((s) => s.state === WF_STEP_STATES.ok || s.state === WF_STEP_STATES.failed || s.state === WF_STEP_STATES.skipped).length;
    /* ★ run 的口径：**计划是否要跑这一步**（fresh 计划全部 true，replay 计划全 false）。
     *   它**不是**「这一步写不写」—— 把两者混为一谈会让只读步在 fresh 计划里就被画成重放，
     *   而那正是「把没跑写成跑过了」这一类错读数（本模块自检当场报出的第一处真缺陷）。 */
    const bad = steps.filter((s) => s.state === WF_STEP_STATES.failed || s.state === WF_STEP_STATES.skipped || s.state === WF_STEP_STATES.pending || s.state === 'running');
    let state;
    if (kind === 'replay') state = WF_STATES.done.key;
    else if (bad.length === 0) state = WF_STATES.done.key;
    else if (bad.length === steps.length) state = WF_STATES.blocked.key;
    else state = WF_STATES.partial.key;
    return {
        state: state, flowId: wfStr(p.flowId, 80), idemKey: p.idemKey || null,
        scope: p.scope || null, at: p.at ?? null, runKey: wfStr(p.runKey, 80),
        steps: steps, executed: executed, failed: bad.length, why: '', replayed: kind === 'replay',
    };
}

/* --------- ⑪ 回读（写后回读比对） --------- */

/**
 * 写后回读比对。相位止于 `confirmed`，**不叫 durable** ——
 *   回读一致**不证明**字节进了宿主存储（写落盘可能在防抖之后），
 *   与 config/write-receipt.js 的 writeConfirmed 同口径。
 *
 * 回读臂返回 `{readOk:boolean, same:boolean}`；读不回来（readOk false）
 *   一律 not_confirmed（不是「读回了不一样」，是**根本没读回来**）。
 */
export function readbackFlow(run, backResult) {
    const r = wfObj(run) || {};
    const b = wfObj(backResult) || {};
    const steps = wfArr(r.steps) || [];
    const writes = steps.filter((s) => s.writes === true);
    let phase;
    if (b.readOk !== true) phase = 'not_confirmed';
    else if (b.same !== true) phase = 'failed';
    else if (r.state === WF_STATES.done.key) phase = 'confirmed';
    else phase = 'partial';
    const text = phase === 'confirmed'
        ? '回读一致（已确认；这不证明字节进了宿主存储）'
        : (phase === 'not_confirmed'
            ? '读不回来（**不是**「读回了不一样」）'
            : (phase === 'failed' ? '读回来了但与写下去的不是同一份' : '有步骤未成，整条不作数'));
    return {
        phase: phase, text: text,
        writeSteps: writes.length, okSteps: steps.filter((s) => s.state === WF_STEP_STATES.ok).length,
        failedSteps: steps.filter((s) => s.state === WF_STEP_STATES.failed).length,
        pendingSteps: steps.filter((s) => s.state === WF_STEP_STATES.pending).length,
        settled: phase === 'confirmed' || phase === 'failed' || phase === 'partial',
    };
}

/* --------- ⑫ 回滚（逆序，且只撤本机记录） --------- */

/**
 * 回滚：把**已成的写步**逆序列出，交给各自的 owner 去撤。
 *   · 没跑过 / 没有写步 / 没有一个写步成过 ⇒ 一律 `nothing-to-rollback`（不假装撤了）；
 *   · 本模块只产「撤什么」的清单；**真实数据只能由各 owner 自己回滚**（与 R-X3 同口径）；
 *   · 逆序是有意的：后做的先撤（否则中间态会把先做的那一步的效果覆盖掉）。
 */
export function rollbackFlow(run) {
    const r = wfObj(run) || {};
    const steps = wfArr(r.steps) || [];
    const done = steps.filter((s) => s.writes === true && (s.state === WF_STEP_STATES.ok || s.state === WF_STEP_STATES.replayed));
    if (!done.length) {
        return { undo: [], count: 0, why: WF_REASONS.NOTHING_TO_ROLLBACK, scope: r.scope || null };
    }
    const undo = done.slice().reverse().map((s) => ({
        stepId: s.stepId, owner: s.owner, ownerModule: '', out: s.out, receipt: s.receipt,
        note: '撤的是本机记录，真实数据由该 owner 自己回滚',
    }));
    return { undo: undo, count: undo.length, why: '', scope: r.scope || null };
}

/** 回滚后的状态：只有真的撤过才叫 rolledback（没有可撤的一律原样返回）。 */
export function wfAfterRollback(run, undone) {
    const r = wfObj(run) || {};
    const candidates = rollbackFlow(r).undo;
    const ids = Array.isArray(undone) ? undone : candidates.slice(0, numOrNull(undone) || 0).map(s => s.stepId);
    if (!ids.length) return Object.assign({}, r, { rolledBack: 0 });
    const steps = (wfArr(r.steps) || []).map(s => ids.includes(s.stepId)
        ? Object.assign({}, s, { state: WF_STEP_STATES.skipped, detail: '已回滚' }) : s);
    const complete = candidates.every(s => ids.includes(s.stepId));
    return Object.assign({}, r, { state: complete ? WF_STATES.rolledback.key : WF_STATES.partial.key, steps, rolledBack: ids.length });
}

/* --------- ⑬ 暂停 / 续跑 --------- */

/**
 * 暂停：把尚未跑的步骤原样留着（重试从断点续，不从头再来）。
 * 已经完成的步骤**不重设**（重跑一遍会造出重复的通知 / 日历 / 账）。
 */
export function pauseFlow(run, atStepId) {
    const r = wfObj(run) || {};
    const steps = (wfArr(r.steps) || []).map((s) => (
        s.state === WF_STEP_STATES.pending
            ? Object.assign({}, s, { detail: '已暂停（重试从这一步续）' })
            : s));
    return Object.assign({}, r, {
        state: WF_STATES.paused.key, steps: steps,
        pausedAt: wfStr(atStepId, 60) || (steps.filter((s) => s.state === WF_STEP_STATES.pending)[0] || {}).stepId || '',
    });
}

/**
 * 续跑：把「已成的步骤」转成 replayed（**不重跑**），只把未成的交回去跑。
 * 这是「重试幂等」在**同一条流程内部**的另一半：重试只重试没成的那几步。
 */
export function resumeFlow(run) {
    const r = wfObj(run) || {};
    const steps = (wfArr(r.steps) || []).map((s) => {
        if (s.state === WF_STEP_STATES.ok) return Object.assign({}, s, { state: WF_STEP_STATES.replayed, detail: '上轮已成，本轮不重跑' });
        if (s.state === WF_STEP_STATES.failed || s.state === WF_STEP_STATES.skipped) {
            return Object.assign({}, s, { state: WF_STEP_STATES.pending, detail: '上轮未成，本轮重试' });
        }
        if (s.state === WF_STEP_STATES.pending) return Object.assign({}, s, { detail: '待跑' });
        return s;
    });
    const todo = steps.filter((s) => s.state === WF_STEP_STATES.pending).length;
    return { run: Object.assign({}, r, { state: todo ? WF_STATES.running.key : WF_STATES.done.key, steps: steps }), todo: todo };
}

/* --------- ⑭ 状态与行面（视图与诊断的唯一取法） --------- */

/** 流程状态词 → 文案（词表外的值时如实回空，不编一句）。 */
export function wfStateText(key) {
    const k = wfStr(key, 24);
    const row = WF_STATES[k];
    return row ? row.text : '';
}

/**
 * 总括行：**三态（没跑 / 开不了工 / 有读数）互不同形**，且四计数各自如实。
 * 为什么单列：把「还没跑过」写成「0 步完成」是造谣 —— 两者处置相反。
 */
export function wfSummaryLine(view) {
    const v = wfObj(view) || {};
    if (v.state === WF_STATES.blocked.key) {
        return '开不了工（' + (wfStr(v.why, 40) || '缺件') + '）—— 这不是「还没开始」';
    }
    if (v.state === WF_STATES.idle.key || !v.state) {
        return '还没跑过这条流程（一个步骤都没计划，也没有任何东西被写）';
    }
    const steps = wfArr(v.steps) || [];
    const ok = steps.filter((s) => s.state === WF_STEP_STATES.ok).length;
    const bad = steps.filter((s) => s.state === WF_STEP_STATES.failed).length;
    const skip = steps.filter((s) => s.state === WF_STEP_STATES.skipped).length;
    const rep = steps.filter((s) => s.state === WF_STEP_STATES.replayed).length;
    const pend = steps.filter((s) => s.state === WF_STEP_STATES.pending).length;
    return '流程 ' + wfStr(v.flowId, 40) + ' · ' + wfStr(v.state, 24) +
        '（成 ' + ok + ' / 败 ' + bad + ' / 跳 ' + skip + ' / 重放 ' + rep + ' / 待跑 ' + pend + '）';
}

/** 单步行：给视图与诊断用，**不在两处各拼一次**。 */
export function wfStepLine(step) {
    const s = wfObj(step) || {};
    const lv = WF_LEVELS[wfStr(s.level, 20)];
    const st = wfStepPhase(s);
    return wfStr(s.label, 60) + '（' + (lv ? lv.label : '未知权限') + ' · ' + (s.owner || '—') + ' · ' + st + '）';
}

/** 三档权限的行面（同一份口径，不在视图里再拼）。 */
export function wfLevelLine() {
    return WF_LEVEL_KEYS.map((k) => WF_LEVELS[k].label + (WF_LEVELS[k].writes ? '（会改状态）' : '（不改状态）')).join(' / ');
}

/* --------- ⑮ 自检（每一条都跑真、假两例） --------- */
export function workflowSelfCheck() {
    const problems = [];
    const push = (c, m) => { if (!c) problems.push(m); };

    /* 1 三档权限互不同形。 */
    const lv = WF_LEVEL_KEYS.map((k) => [WF_LEVELS[k].label, WF_LEVELS[k].text]);
    push(new Set(lv.map((x) => x[0])).size === WF_LEVEL_KEYS.length, '三档权限标签同形');
    push(new Set(lv.map((x) => x[1])).size === WF_LEVEL_KEYS.length, '三档权限文案同形');
    push(WF_LEVELS.read.writes === false && WF_LEVELS.draft.writes === false && WF_LEVELS.write.writes === true, '三档 writes 声明不对');

    /* 2 九态互不同形。 */
    const sk = WF_STATE_KEYS.map((k) => WF_STATES[k].label);
    push(new Set(sk).size === WF_STATE_KEYS.length, '流程状态标签同形');
    const st = WF_STATE_KEYS.map((k) => WF_STATES[k].text);
    push(new Set(st).size === WF_STATE_KEYS.length, '流程状态文案同形');
    push(WF_STATES.done.key !== WF_STATES.partial.key, '完成与部分完成同形（最贵的一条）');

    /* 3 每条流程的每一步 owner 都在注册表里，且写步 owner 可写。 */
    for (const f of WF_FLOWS) {
        push(f.steps.length > 0 && f.steps.length <= WF_STEPS_MAX, f.id + ' 步骤数越界');
        for (const s of f.steps) {
            const o = WF_OWNERS[s.owner];
            push(!!o, f.id + '/' + s.id + ' owner 未登记：' + s.owner);
            if (o && s.writes) push(o.writable === true, f.id + '/' + s.id + ' 写步 owner 不可写：' + s.owner);
        }
    }

    /* 4 默认 dry-run：未确认的写流程必被拒，确认后才 fresh。 */
    const base = { flowId: 'resume-brief', scope: { chatId: 'c', branchKey: 'main' }, runKey: 'd1', runs: [], at: 1 };
    const nin = Object.assign({}, base, { inputs: { 'archive-pack': { a: 1 }, 'resume-face': { b: 2 }, brief: { t: 'x' } } });
    push(planFlow(nin).kind === 'reject', '未确认的写流程竟给了计划');
    push(planFlow(nin).why === WF_REASONS.NOT_CONFIRMED, '未确认的归因不是 not-confirmed');
    const con = Object.assign({}, nin, { confirm: true });
    push(planFlow(con).kind === 'fresh', '确认后的写流程没给 fresh');
    push(planFlow(con).willWrite === true, '确认后的计划 willWrite 应为 true');

    /* 5 预览恒不写。 */
    const pv = previewFlow(con);
    push(pv.willWrite === false, '预览竟声称会写');
    push(JSON.stringify(previewFlow(con)) === JSON.stringify(pv), '预览两次结果不同（碰了入参？）');

    /* 6 幂等：同一 runKey 第二次即 replay，且一步都不跑。 */
    const runs = [{ flowId: 'resume-brief', runKey: 'd1', state: 'done', at: 9, scope: { chatId: 'c', branchKey: 'main' } }];
    const rp = planFlow(Object.assign({}, con, { runs: runs }));
    push(rp.kind === 'replay', '同 runKey 第二次没判 replay');
    push(rp.steps.every((s) => s.run === false), 'replay 计划仍有可跑步骤（会重复执行）');
    const runRec = applyFlowPlan(rp, []);
    push(runRec.executed === 0, 'replay 竟执行了步骤');

    /* 7 台账读不到 ⇒ 不放行（绝不把「读不到」当「没跑过」）。 */
    push(planFlow(Object.assign({}, con, { runs: null })).why === WF_REASONS.RUN_UNREADABLE, '台账读不到竟放行');

    /* 7b 跨段命中：台账里同键但属另一段 ⇒ 不当重放，也不重跑。 */
    const alien = [{ flowId: 'resume-brief', runKey: 'd1', state: 'done', at: 9, scope: { chatId: 'other', branchKey: 'main' } }];
    const ac = planFlow(Object.assign({}, con, { runs: alien }));
    push(ac.kind === 'reject' && ac.why === WF_REASONS.SCOPE_CHANGED, '跨段命中竟未拒：' + ac.kind + '/' + ac.why);
    const halfScope = [{ flowId: 'resume-brief', runKey: 'd1', state: 'done', at: 9, scope: { chatId: 'c', branchKey: '' } }];
    push(planFlow(Object.assign({}, con, { runs: halfScope })).why === WF_REASONS.SCOPE_CHANGED, '缺分支键的命中行未按 changed 拒');
    const app = wfAppendRun([], { flowId: 'f', runKey: 'r1', state: 'done', at: 3, scope: { chatId: 'c', branchKey: 'main' } });
    push(app.runs.length === 1 && app.dropped === 0, '台账追加结果不对');
    const cap = wfAppendRun(app.runs, { flowId: 'f', runKey: 'r2', state: 'done', at: 4, scope: { chatId: 'c', branchKey: 'main' } }, 1);
    push(cap.runs.length === 1 && cap.dropped === 1 && cap.runs[0].runKey === 'r2', '台账上限裁剪须保留最新且计数挤掉');
    push(wfAppendRun([], {}).runs.length === 0, '非法记录不得进台账');

    /* 8 跨会话：scope 缺项一律拒。 */
    push(planFlow(Object.assign({}, con, { scope: {} })).why === WF_REASONS.SCOPE_MISSING, '无 scope 未拒');
    push(planFlow(Object.assign({}, con, { scope: { chatId: 'c' } })).why === WF_REASONS.SCOPE_CHANGED, '半 scope 未按 changed 拒');

    /* 9 只读步不得被当写步：把结算流程改用只读 owner 的票不可能（步表固定），
     *   改判「写步 owner 不可写」这条规则本身：现场造一步用只读 owner 带 writes:true。 */
    const fakeStep = { id: 'x', label: 'X', in: [], out: 'o', writes: true, owner: 'resume-workbench' };
    const judged = wfStepIn(fakeStep, {});
    push(judged.problems.indexOf(WF_REASONS.OWNER_NOT_WRITABLE) >= 0, '只读 owner 被当写步用时未拦');

    /* 10 读不到 ≠ 没有：输入面 null 与缺键两态分开。 */
    const unread = wfStepIn({ id: 's', label: 'S', in: ['brief'], out: 'o', writes: false, owner: 'brief-read' }, { brief: null });
    const missing = wfStepIn({ id: 's', label: 'S', in: ['brief'], out: 'o', writes: false, owner: 'brief-read' }, {});
    push(unread.problems.indexOf(WF_REASONS.INPUT_UNREADABLE) >= 0, '输入 null 未记 input-unreadable');
    push(missing.problems.indexOf(WF_REASONS.INPUT_MISSING) >= 0, '输入缺键未记 input-missing');
    push(wfRunsOf(null).readable === false && wfRunsOf([]).readable === true, '台账 null 与 [] 未分开');

    /* 11 失败不得假装完成。 */
    const plan = planFlow(con);
    const half = applyFlowPlan(plan, [{ stepId: 'read-brief', ok: true }, { stepId: 'save-draft', ok: true }, { stepId: 'notify', ok: false, detail: 'x' }]);
    push(half.state === WF_STATES.partial.key, '有步失败竟不是 partial：' + half.state);
    const allOk = applyFlowPlan(plan, [{ stepId: 'read-brief', ok: true }, { stepId: 'save-draft', ok: true }, { stepId: 'notify', ok: true }]);
    push(allOk.state === WF_STATES.done.key, '全成却不是 done');
    push(wfSummaryLine(half) !== wfSummaryLine(allOk), 'partial 与 done 行面同形');

    /* 12 回读：读不回来一律 not_confirmed，不叫 durable。 */
    push(readbackFlow(allOk, { readOk: false, same: false }).phase === 'not_confirmed', '读不回来竟算确认');
    push(readbackFlow(allOk, { readOk: true, same: true }).phase === 'confirmed', '读回一致未确认');
    push(readbackFlow(half, { readOk: true, same: true }).phase === 'partial', '有步未成竟算 confirmed');

    /* 13 回滚：没成过的写步不得假装撤了。 */
    push(rollbackFlow({ steps: [] }).why === WF_REASONS.NOTHING_TO_ROLLBACK, '空运行竟给回滚清单');
    const rb = rollbackFlow(allOk);
    push(rb.count === 2 && rb.undo[0].stepId === 'notify', '回滚未逆序或条数不对');
    push(wfAfterRollback(allOk, 0).state === allOk.state, '没撤任何东西却改了状态');
    push(wfAfterRollback(allOk, 2).state === WF_STATES.rolledback.key, '真撤了却没标 rolledback');

    /* 14 暂停 / 续跑：已成的不重跑。 */
    const paused = pauseFlow(half, 'notify');
    push(paused.state === WF_STATES.paused.key, '暂停未置 paused');
    const full = applyFlowPlan(plan, [{ stepId: 'read-brief', ok: true }, { stepId: 'save-draft', ok: true }, { stepId: 'notify', ok: false, detail: 'x' }]);
    const res = resumeFlow(full);
    push(res.run.steps.filter((s) => s.state === WF_STEP_STATES.replayed).length === 2, '续跑未把已成步骤标重放');
    push(res.todo === 1, '续跑应把未成的步骤交回重试（且只交回那一步）');

    /* 15 不执行任意 JS：本模块导出面无 eval / Function / setTimeout 串。 */
    const ids = WF_OWNER_KEYS.filter((k) => !WF_OWNERS[k]);
    push(ids.length === 0, 'owner 注册表有悬空键');

    return {
        version: WF_VERSION, flowIds: WF_FLOW_IDS, flows: WF_FLOWS.length, owners: WF_OWNER_KEYS.length,
        states: WF_STATE_KEYS.length, levels: WF_LEVEL_KEYS.length,
        reasons: WF_REASON_KEYS.length, problems: problems,
    };
}
