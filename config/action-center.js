/* ========================================================
 * action-center.js — [v3.85.0 · 拓展计划 R-X1] 统一行动中心与跨 App 通知箱（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   日历里有两场到期约定、财务页有一份待确认结算草稿、通知中心躺着 3 条未读、
 *   织光机顶部有续玩建议、诊断中心报出两项失败任务 —— 五处各说各的，
 *   而**没有任何一处回答**「现在总共该处理什么」。
 *   实测这五类待处理项**每一样都已有真源**（见 `AC_SOURCES` 的 `from` 列），
 *   缺的不是数据，是把它们收成**同一个读数**的那一层。
 *
 * 【五源真源表（本层只消费，不重算）】
 *   · bill        待确认账单 ← config/finance-overview.js 的结算草稿（suggestion 面）
 *   · commitment  到期约定   ← config/commitment-flow.js 的非终态约定
 *   · unread      未读事件   ← config/system-notifications.js 的 NotificationLog
 *   · resume      续玩建议   ← config/resume-brief.js 的各节行
 *   · failed      失败任务   ← config/diagnose-action.js 的 FAILED 读数
 *   重算一份就是第二份真源 —— 各源的判定仍只有一份，本层不重判。
 *
 * 【三条口径纪律（每条都有判据钉住）】
 *   · **读不到 ≠ 空**：源本轮没读记 `not-read` gap，与「读了、确实没有」分开
 *     （两者的处置相反：前者等装齐 / 等生成，后者什么都不用做）。
 *   · **只读通知 ≠ 需要确认的通知**：按登记表的 `lane` 分成两列（功能第 4 条）。
 *     分列在**本层**就做完 —— 视图再分一遍就是第二份实现，必然漂移。
 *   · **跳不过去要说清原因**：`acJumpOf` 不可跳时给可读理由（与
 *     config/diagnose-action.js 的 `canJump` 同口径），绝不静默丢一个点了没反应的按钮。
 *
 * 【幂等与撤回（两条现成范式，直接照办）】
 *   · 幂等键 `<kind>:<sourceId>:<dayKey>` —— 三者任一缺失即不产键，**不产半截键**
 *     （半截键进了账本就永远撤不掉）；
 *   · 投递键 `action:<kind>:<sourceId>:<dayKey>` —— 与幂等键**刻意分开**：
 *     前者用于对账，后者用于通知中心的合并语义（同键热更新 vs 新增一条）；
 *   · 撤回归因三态：剧情回退 / 同源改期 / 来源消失；
 *   · 回档判据「投递当时的剧情日 > 现在的剧情日」**只对剧情基的行判**
 *     （现实基行的日期不随回档变化，拿它判就是把两条时间轴混用）。
 *
 * 【一条本层新增的口径（R-X1 验收④直接要求）】
 *   用户**已经处理过**的条目（done / snoozed / ignored）**不得被静默撤回** ——
 *   撤回只对仍处于 open 的条目成立。回档撤销的是「系统还没让你看过的那条未来提醒」，
 *   不是「你已经决定过的事」。
 *
 * 【不做什么】
 *   · 不取数：五源输入全部由调用方取好传进来；
 *   · 不投递：本层只产行与载荷（`acSenderKey`），投递由调用方决定；
 *   · 不读存储、不带计时器：纯函数，手机上关掉也不会继续跑。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';
import { refStr, normalizeOpenRef } from './open-ref.js';
import { dayKeyOf } from './schedule-bridge.js';
/* 终态与归一都引真源：本层**不自己判一次**「什么算完成」（两处各判一次必然分歧）。 */
import { normalizeCommitments, TERMINAL } from './commitment-flow.js';

/* ───────── ① 三张表：类别 / 两列 / 四动作 ───────── */

/** 五类待处理项（判据按此表逐词核，防随口新词）。 */
export const AC_KINDS = Object.freeze({
    BILL: 'bill',
    COMMITMENT: 'commitment',
    UNREAD: 'unread',
    RESUME: 'resume',
    FAILED: 'failed'
});

/** 两条泳道：**只读通知**（看一眼就行，不动数据）与**需要确认的通知**（要用户决定）。
 *  功能第 4 条要求两者分开呈现 —— 分开的判据就是这一列，不是视图里的某次 filter。 */
export const AC_LANES = Object.freeze({
    READONLY: 'readonly',
    NEED_CONFIRM: 'need-confirm'
});

/** 四个动作（功能第 3 条）。`open` 是**导航**，不改账本状态（跳转是旁路）。 */
export const AC_ACTIONS = Object.freeze({
    DONE: 'done',
    SNOOZE: 'snooze',
    IGNORE: 'ignore',
    OPEN: 'open'
});

/** 条目状态（账本里的一格）。 */
export const AC_STATES = Object.freeze({
    OPEN: 'open',
    DONE: 'done',
    SNOOZED: 'snoozed',
    IGNORED: 'ignored',
    EXPIRED: 'expired',
    WITHDRAWN: 'withdrawn'
});

/* 已经「被用户决定过」的状态（done / snoozed / ignored / expired）**不参与撤回**。
 *  ★ 这里**刻意不另立一张已决态表**：撤回面只认「这一格还是不是 open」这一个判据
 *    （见 diffActionLedger 的那一行）。另立一张表就是同一条规矩的第二份实现 ——
 *    两份一旦分叉，判据对破坏也就没有反应了（实测：另立表时把表打掉，行为一个字不变）。 */

/** 撤回归因（判据按此表逐词核）。 */
export const AC_WITHDRAW_REASONS = Object.freeze({
    'source-rewound': '剧情时间回退了：那条未来的待处理项还没发生，先撤掉',
    'source-rescheduled': '同一来源改到另一天：旧日期那条不再成立',
    'source-gone': '这一源本轮真读过，而这条不再出现（来源被取消或删除）'
});

/** 五源登记表：钉死每类的真源、时间基、泳道、默认靶心与可用动作。
 *  `actions` 是**白名单**：条目上只出现登记过的动作，视图照此渲染按钮。 */
export const AC_SOURCES = Object.freeze({
    bill: Object.freeze({
        label: '待确认账单', from: 'finance-overview', timeBasis: 'real',
        lane: AC_LANES.NEED_CONFIRM, appId: 'traveldesk', icon: '🧾',
        actions: Object.freeze([AC_ACTIONS.OPEN, AC_ACTIONS.DONE, AC_ACTIONS.SNOOZE, AC_ACTIONS.IGNORE])
    }),
    commitment: Object.freeze({
        label: '到期约定', from: 'commitment-flow', timeBasis: 'story',
        lane: AC_LANES.NEED_CONFIRM, appId: 'calendar', icon: '🤝',
        actions: Object.freeze([AC_ACTIONS.OPEN, AC_ACTIONS.DONE, AC_ACTIONS.SNOOZE, AC_ACTIONS.IGNORE])
    }),
    unread: Object.freeze({
        label: '未读事件', from: 'system-notifications', timeBasis: 'real',
        lane: AC_LANES.READONLY, appId: '', icon: '🔔',
        actions: Object.freeze([AC_ACTIONS.OPEN, AC_ACTIONS.DONE, AC_ACTIONS.IGNORE])
    }),
    resume: Object.freeze({
        label: '续玩建议', from: 'resume-brief', timeBasis: 'real',
        lane: AC_LANES.READONLY, appId: 'timeweaver', icon: '📖',
        actions: Object.freeze([AC_ACTIONS.OPEN, AC_ACTIONS.IGNORE])
    }),
    failed: Object.freeze({
        label: '失败任务', from: 'diagnose-action', timeBasis: 'real',
        lane: AC_LANES.NEED_CONFIRM, appId: 'diagnose', icon: '⚠️',
        actions: Object.freeze([AC_ACTIONS.OPEN, AC_ACTIONS.DONE, AC_ACTIONS.SNOOZE, AC_ACTIONS.IGNORE])
    })
});

/** 账本：键名对外（调用方要读写它）；版本与上限是**本模块内部口径**，
 *  外面只认键名 —— 导出一堆没人读的常量只会被 dead-export 门点名。 */
export const AC_LEDGER_KEY = 'ac_ledger';
const AC_LEDGER_VERSION = 1;
const AC_LEDGER_LIMIT = 240;

/* ───────── ② 内部工具（判据面里不出现第二份实现） ───────── */

function listOf(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.items)) return v.items;
    return [];
}

function text(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

/** 幂等键：`<kind>:<sourceId>:<dayKey>`。三者任一缺失即 ''（不产半截键）。 */
function acIdemKeyOf(kind, sourceId, dayKey) {
    const k = refStr(kind), i = refStr(sourceId), d = refStr(dayKey);
    if (!k || !i || !d) return '';
    return k + ':' + i + ':' + d;
}

/** 账本锚：两段式 `<target>:<id>`，**不含日期**（改期后仍是同一条）。
 *  两段任一缺失即 ''（与幂等键同纪律：不产半截锚）。 */
function anchorOf(target, id) {
    const t = refStr(target), i = refStr(id);
    if (!t || !i) return '';
    return t + ':' + i;
}

/** 投递键：`action:<kind>:<sourceId>:<dayKey>`（与幂等键**刻意分开**）。 */
export function acSenderKey(item) {
    const it = (item && typeof item === 'object') ? item : {};
    return 'action:' + refStr(it.kind) + ':' + refStr(it.sourceId) + ':' + refStr(it.dayKey);
}

/** 可否一步到处置入口：有靶心或有 App 首屏。
 *  跳不过去时必须**说清原因** —— 这是 R-X1 验收②在代码上的落地形式。 */
export function acJumpOf(item) {
    const it = (item && typeof item === 'object') ? item : null;
    if (!it) return { ok: false, appId: '', ref: null, why: '无读数' };
    if (it.ref && it.ref.appId) return { ok: true, appId: refStr(it.ref.appId), ref: it.ref, why: '' };
    const appId = refStr(it.appId);
    if (appId) return { ok: true, appId: appId, ref: null, why: '' };
    return { ok: false, appId: '', ref: null, why: '这一项没有可跳的处置入口（无来源 App 与靶心）' };
}

/** 造一条行动项（**唯一的产行出口**：所有源都必须经此，形状不可能各家自定）。 */
function itemOf(kind, sourceId, dayKey, title, detail, extra) {
    const reg = AC_SOURCES[kind] || {};
    const ex = (extra && typeof extra === 'object') ? extra : {};
    const lane = (ex.lane === AC_LANES.READONLY || ex.lane === AC_LANES.NEED_CONFIRM)
        ? ex.lane : refStr(reg.lane);
    /* ★ 键的三段走 `normalizeOpenRef` 的**细粒度拆分**，而不是从它拼好的 id 里
     *   再切回来 —— 三种形态（`'"a:b"'` 两端带引号 / `k:id` 前缀式 / 裸 id）各切一次必然分歧。
     *   同时 `ref` 仍存归一后的**标准形态**：外面拿它去派发时不必再判一次形状。 */
    const norm = normalizeOpenRef(ex.ref);
    const refOk = norm.ok === true;
    let jumpWhy = '';
    if (ex.ref && !refOk) jumpWhy = '靶心不成立（' + refStr(norm.why) + '）';
    const refAppId = refOk ? refStr(norm.appId) : '';
    const refKind = refOk ? refStr(norm.kind) : '';
    const refId = refOk ? refStr(norm.id) : '';
    const ref = refOk ? { appId: refAppId, kind: refKind, id: refId } : null;
    const appId = refAppId || refStr(ex.appId) || refStr(reg.appId);
    const key = acIdemKeyOf(kind, sourceId, dayKey);
    const item = {
        kind: refStr(kind),
        sourceId: refStr(sourceId),
        dayKey: refStr(dayKey),
        title: text(title, 80),
        detail: text(detail, 200),
        lane: lane,
        appId: appId,
        source: refStr(reg.from),
        label: refStr(reg.label),
        icon: refStr(reg.icon),
        /* 来源事件 / 会话 / 楼层或剧情时间（功能第 2 条要求的四项，一项不少）。 */
        floor: (typeof ex.floor === 'number' && Number.isInteger(ex.floor) && ex.floor >= 0) ? ex.floor : null,
        storyDay: refStr(ex.storyDay),
        certainty: refStr(ex.certainty) || 'fact',
        timeBasis: refStr(reg.timeBasis) || 'real',
        actions: listOf(ex.actions).length ? listOf(ex.actions).slice(0) : listOf(reg.actions).slice(0),
        canOpen: !!ref,
        openWhy: jumpWhy,
        ref: ref,
        /* 账本锚：**两段式、不带日期** —— `<target>:<id>`。
         *   与三段的 `idemKey` 刻意分开：同一条约定改期后日期变了，
         *   拿三段键去对账会把它判成「旧的那条撤了 + 新的一条来了」，
         *   而用户看到的只是**同一件事改了个日子**。两段锚认得出这是同一条。
         *   · `acSenderKey` = 通知合并的键（同键热更新 vs 新增一条）
         *   · `idemKey`    = 投递上屏的顺序键（含日期，日历里挪一行即换键）
         *   · `realIdemKey`= 跨轮对账的锚（不含日期，改期仍是同一条） */
        realIdemKey: anchorOf((refKind ? 'ref-' + refKind : 'source'), refId || sourceId),
        idemKey: key
    };
    const jump = acJumpOf(item);
    item.jump = { ok: jump.ok, appId: jump.appId, why: jump.why };
    return item;
}

/* ───────── ③ 五源归一（本模块主出口） ───────── */

function has(src, k) { return Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined; }

/**
 * 五源归一：把各源**已经判好的结果**收成统一的行动项。
 *
 * @param {object} [o]
 *   · `nowMs`       现实时间（唯一现实取数口；取不到即今天为 ''）
 *   · `storyDay`    剧情日键（`YYYY-MM-DD`；约定源缺它即不产行 —— 不拿今天顶替）
 *   · `bills`       待确认账单（finance-overview 的结算草稿行；`undefined` = 没读）
 *   · `commitments` 约定 state / items（`undefined` = 没读）
 *   · `unread`      未读通知行（NotificationLog.list() 过滤 read=false；`undefined` = 没读）
 *   · `resume`      resume-brief 的结果（`undefined` = 没读）
 *   · `failures`    diagnose-action 的处置读数数组（`undefined` = 没读）
 * @returns {{at:number|null, today:string, storyDay:string, items:Array,
 *            lanes:object, counts:object, gaps:Array, read:object}}
 */
export function buildActionCenter(o = {}) {
    const src = (o && typeof o === 'object') ? o : {};
    const nowMs = numOrNull(src.nowMs);
    const today = dayKeyOf(nowMs);
    const storyDay = refStr(src.storyDay);
    const read = {};
    const gaps = [];
    const rows = [];

    /* ── 面 1：待确认账单（suggestion 面 —— 界面必须能标出「这是建议不是事实」） ──
     *   ★ 源侧形状不唯一：旅行结算的「一条待确认账单」可能是
     *     · 一条转账建议（带 from/to/amountCents），也可能是
     *     · 一份尚未落账的结算草稿（带 draftId）。
     *   本层**按行收**（调用方把草稿摊平成一行为宜），两种键名都认；
     *   完全按某一种形状写死会让另一种静默产 0 行（修前实测：约定面就是这么错的）。 */
    if (!has(src, 'bills')) {
        gaps.push({ source: 'bill', reason: 'not-read' });
    } else {
        read.bill = true;
        for (const b of listOf(src.bills)) {
            const rec = (b && typeof b === 'object') ? b : {};
            const sid = refStr(rec.sourceId) || refStr(rec.draftId) || refStr(rec.id);
            const dk = refStr(rec.dayKey) || refStr(rec.dateKey) || today;
            const amount = numOrNull(rec.amountCents);
            const money = (amount === null) ? '' : ' ¥' + (amount / 100).toFixed(2);
            rows.push(itemOf('bill', sid, dk,
                refStr(rec.title) || '待确认结算',
                (refStr(rec.detail) || refStr(rec.note) || '旅行分摊结算建议') + money,
                { appId: refStr(rec.appId) || 'traveldesk', ref: rec.ref, certainty: refStr(rec.certainty) || 'suggestion', floor: rec.floor }));
        }
    }

    /* ── 面 2：到期约定（剧情基 —— **缺剧情日不产行**，与 schedule-bridge 同纪律） ── */
    if (!has(src, 'commitments')) {
        gaps.push({ source: 'commitment', reason: 'not-read' });
    } else if (!storyDay) {
        read.commitment = true;
        /* 读了，但剧情日粒度不足 ⇒ 无法判「到期」；如实记 gap，不拿今天顶替。 */
        gaps.push({ source: 'commitment', reason: 'story-missing' });
    } else {
        read.commitment = true;
        /* ★ 两种形状都认（**这条是修前实测的真缺陷**）：
         *   · commitment-flow 的**完整条目**（`normalizeCommitments`）带 id/actor/content；
         *   · `commitmentCalendarProjection` 的**投影行**只有 sourceId/title，没有 id/actor。
         *   咽喉处的实际取数走的是后者。只按前者写，约定面会**静默产 0 行**
         *   （不报错、不记 gap —— 用户那里表现为「日历明明有约定，行动中心一条都不显示」）。 */
        const rawCommit = src.commitments;
        const arr = Array.isArray(rawCommit)
            ? rawCommit
            : ((rawCommit && Array.isArray(rawCommit.items)) ? rawCommit.items : []);
        /* 投影行没有 actor（`commitmentCalendarProjection` 的产出）；完整条目一定有。 */
        const isProjection = arr.length > 0 && arr[0] && typeof arr[0] === 'object' && arr[0].actor === undefined;
        const list = isProjection ? arr : normalizeCommitments(rawCommit).items;
        for (const it of list) {
            if (TERMINAL.has(it.status)) continue;
            const dateKey = refStr(it.dateKey);
            if (dateKey && dateKey > storyDay) continue;   /* 还没到期的不是待处理项 */
            const sid = refStr(it.id) || refStr(it.sourceId);
            if (!sid) continue;                            /* 没有来源 id 就产不出可撤的键，宁可不出行 */
            /* 投影行没有 actor/content —— 拿 title 当标题，**不编一个 actor 出来**。 */
            const head = refStr(it.content)
                ? (refStr(it.actor) || '约定') + '：' + refStr(it.content)
                : (refStr(it.title) || '到期约定');
            const when = dateKey + (refStr(it.time) ? ' ' + refStr(it.time) : '');
            rows.push(itemOf('commitment', sid, dateKey || storyDay, head,
                when + (refStr(it.place) ? ' · ' + refStr(it.place) : '') + ' · ' + refStr(it.status),
                { appId: 'calendar', storyDay: storyDay, certainty: 'fact' }));
        }
    }

    /* ── 面 3：未读事件（只读泳道 —— 看一眼就行） ── */
    if (!has(src, 'unread')) {
        gaps.push({ source: 'unread', reason: 'not-read' });
    } else {
        read.unread = true;
        for (const n of listOf(src.unread)) {
            const rec = (n && typeof n === 'object') ? n : {};
            if (rec.read === true) continue;   /* 已读的不是待处理项 */
            const dk = dayKeyOf(numOrNull(rec.ts)) || today;
            rows.push(itemOf('unread', refStr(rec.id), dk, rec.title || '未读通知', rec.message || '',
                { appId: refStr(rec.appId), ref: rec.ref, lane: AC_LANES.READONLY, floor: rec.floor }));
        }
    }

    /* ── 面 4：续玩建议（**按节产行**，不按行产 —— 行序在上游会变，逐行产出的键不稳定） ── */
    if (!has(src, 'resume')) {
        gaps.push({ source: 'resume', reason: 'not-read' });
    } else {
        read.resume = true;
        const rb = (src.resume && typeof src.resume === 'object') ? src.resume : {};
        const secs = listOf(rb.sections);
        for (const sec of secs) {
            const s = (sec && typeof sec === 'object') ? sec : {};
            const key = refStr(s.key) || refStr(s.label);
            const line = listOf(s.rows).map((r) => text((r && r.text) || '', 60)).filter(Boolean).join('；');
            if (!key || !line) continue;
            rows.push(itemOf('resume', key, today, refStr(s.label) || '续玩建议', line,
                { appId: 'timeweaver', lane: AC_LANES.READONLY }));
        }
        if (listOf(rb.gaps).length) gaps.push({ source: 'resume', reason: 'partial:' + String(listOf(rb.gaps).length) });
    }

    /* ── 面 5：失败任务（只收 FAILED；unknown/absent 不是「待处理项」） ── */
    if (!has(src, 'failures')) {
        gaps.push({ source: 'failed', reason: 'not-read' });
    } else {
        read.failed = true;
        for (const f of listOf(src.failures)) {
            const rec = (f && typeof f === 'object') ? f : {};
            if (refStr(rec.state) !== 'failed') continue;
            const code = refStr(rec.code) || 'unknown';
            const stage = refStr((rec.fields && rec.fields.stage) || '');
            const dk = refStr(rec.dayKey) || today;
            const needConfirm = !!(rec.fields && rec.fields.needConfirm === true);
            rows.push(itemOf('failed', code, dk, '失败任务：' + code,
                (stage ? '断在「' + stage + '」' : '') + (refStr(rec.why) ? ' · ' + refStr(rec.why) : ''),
                {
                    appId: refStr(rec.action && rec.action.appId) || 'diagnose',
                    ref: rec.action && rec.action.kind ? rec.action : null,
                    /* 需要用户确认的失败项落到「需要确认」列；否则仍按登记表的泳道。 */
                    lane: needConfirm ? AC_LANES.NEED_CONFIRM : undefined,
                    floor: rec.floor
                }));
        }
    }

    /* ── 分列（功能第 4 条在真源层就分好）与计数 ── */
    const lanes = { readonly: [], needConfirm: [] };
    for (const it of rows) {
        (it.lane === AC_LANES.READONLY ? lanes.readonly : lanes.needConfirm).push(it);
    }
    const byKind = {};
    for (const k of Object.values(AC_KINDS)) byKind[k] = 0;
    for (const it of rows) if (byKind[it.kind] !== undefined) byKind[it.kind] += 1;
    const noKey = rows.filter((it) => !it.idemKey).length;

    return {
        at: nowMs,
        today: today,
        storyDay: storyDay,
        items: rows,
        lanes: lanes,
        counts: {
            total: rows.length,
            readonly: lanes.readonly.length,
            needConfirm: lanes.needConfirm.length,
            byKind: byKind,
            skippedNoKey: noKey
        },
        gaps: gaps,
        read: read
    };
}

/* ───────── ④ 账本：归一 / 对账 / 落账 / 处理 ───────── */

/** 账本归一：**无幂等键的条目一律不收**（半截键进了账就永远撤不掉）。 */
export function normalizeActionLedger(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const items = Array.isArray(src.entries) ? src.entries : (Array.isArray(raw) ? raw : []);
    const seen = new Set();
    const entries = [];
    for (const it of items) {
        const rec = (it && typeof it === 'object') ? it : {};
        /* ★ 认账的判据是**锚**（`realIdemKey`），不是三段键：同一条约定改期后三段键
         *   会变，拿它当身份就等于「每次改期都换一条新的」。老账本（只写过 idemKey）
         *   用 idemKey 兜底，保证已落盘的账不被整本丢掉。 */
        const anchor = refStr(rec.realIdemKey) || refStr(rec.idemKey);
        if (!anchor || seen.has(anchor)) continue;
        seen.add(anchor);
        const state = refStr(rec.state) || AC_STATES.OPEN;
        entries.push({
            realIdemKey: anchor,
            idemKey: refStr(rec.idemKey) || anchor,
            kind: refStr(rec.kind),
            sourceId: refStr(rec.sourceId),
            dayKey: refStr(rec.dayKey),
            lane: refStr(rec.lane),
            title: text(rec.title, 80),
            timeBasis: refStr(rec.timeBasis),
            /* 投递当时**剧情时刻的日键**：判「剧情回退」的唯一依据。 */
            atStoryDay: refStr(rec.atStoryDay),
            state: state,
            action: refStr(rec.action),
            until: refStr(rec.until),
            firstAt: numOrNull(rec.firstAt) || 0,
            lastAt: numOrNull(rec.lastAt) || 0,
            why: refStr(rec.why)
        });
    }
    return { version: AC_LEDGER_VERSION, entries: entries.slice(-AC_LEDGER_LIMIT) };
}

/**
 * 对账：把「本轮该处理什么」与「账本里出现过什么」比一遍，只算不写。
 * @returns {{fresh:Array, replay:Array, withdraw:Array, skippedNoKey:Array, liveKeys:Array}}
 */
export function diffActionLedger(center, ledger) {
    const c = (center && typeof center === 'object') ? center : {};
    const items = listOf(c.items);
    const read = (c.read && typeof c.read === 'object') ? c.read : {};
    const storyDay = refStr(c.storyDay);
    const led = normalizeActionLedger(ledger);
    const byAnchor = new Map();
    for (const e of led.entries) byAnchor.set(e.realIdemKey, e);

    const liveAnchors = new Set();
    const fresh = [];
    const replay = [];
    const skippedNoKey = [];
    /* 「这一条来源事件现在落在哪一天」按**本轮条目**建索引 —— 账本只能回答「过去投过什么」。
     *   没有它，「改期」与「取消」会判成同一个归因（两条归因同形 ⇒ 用户分不清）。 */
    const dayByAnchor = new Map();
    for (const it of items) {
        const rec = (it && typeof it === 'object') ? it : {};
        const anchor = refStr(rec.realIdemKey);
        if (!anchor) {
            /* 锚缺失 ⇒ 算不出该不该再提，不投不记账，但**留痕**（不静默吞）。 */
            skippedNoKey.push({ kind: refStr(rec.kind), sourceId: refStr(rec.sourceId), why: 'anchor-missing' });
            continue;
        }
        const dayKey = refStr(rec.dayKey);
        liveAnchors.add(anchor);
        dayByAnchor.set(anchor, dayKey);
        const prev = byAnchor.get(anchor);
        /* 同锚 **且日期也相同** ⇒ 复现（不重投）。
         *   同锚而日期变了 ⇒ **改期**：下面按 source-rescheduled 撤掉旧日期那条，
         *   而这一条算新增。这两支必须分开 —— 合起来的话，改期会被当成「复现」
         *   永远落不下新日期，用户看到的是「日子改了，行动中心还显示老日子」。 */
        if (prev && prev.dayKey === dayKey && prev.state !== AC_STATES.WITHDRAWN && prev.state !== AC_STATES.EXPIRED) {
            replay.push(anchor);
            continue;
        }
        fresh.push(rec);
    }

    const withdraw = [];
    for (const e of led.entries) {
        /* ★ 本层新增口径（见文件头）：用户已经决定过的条目不得被静默撤回。 */
        /* ★ 撤回面**唯一**的一条已决判据：只有仍处于 open 的条目才可能被撤。
         *   用户已经决定过的（done / snoozed / ignored / expired）一律跳过 ——
         *   回档撤的是「系统还没让你看过的未来提醒」，不是「你已经决定过的事」。
         *   （修前这里另立了一张已决态表，与这一行是同一条规矩的第二份实现，
         *    实测把那张表打掉行为一个字不变 ⇒ 判据对破坏无反应。已收成一处。） */
        if (e.state !== AC_STATES.OPEN) continue;
        /* 同锚而日期没变 ⇒ 它还在，不算撤。 */
        if (liveAnchors.has(e.realIdemKey) && dayByAnchor.get(e.realIdemKey) === e.dayKey) continue;
        /* ★ 撤回门：源本轮没读 ⇒ 缺席不算取消（把「不知道」当「没有」是本仓最贵的反向错读数）。 */
        if (read[e.kind] !== true) continue;
        const rewound = (e.timeBasis === 'story') && !!storyDay && !!e.atStoryDay && e.atStoryDay > storyDay;
        const rescheduled = liveAnchors.has(e.realIdemKey);
        const reason = rewound
            ? AC_WITHDRAW_REASONS['source-rewound']
            : (rescheduled
                ? AC_WITHDRAW_REASONS['source-rescheduled']
                : AC_WITHDRAW_REASONS['source-gone']);
        withdraw.push({ realIdemKey: e.realIdemKey, idemKey: e.idemKey, kind: e.kind, sourceId: e.sourceId, dayKey: e.dayKey, why: reason });
    }
    return {
        fresh: fresh, replay: replay, withdraw: withdraw, skippedNoKey: skippedNoKey,
        liveAnchors: Array.from(liveAnchors),
        /* 兼容别名：外面若还在读 liveKeys（旧口径），拿到的仍是「本轮活着的键集合」。 */
        liveKeys: Array.from(liveAnchors)
    };
}

/** 落账：把一次对账的决定写进账本（纯函数，返回新账本；投递由调用方做）。
 *  第三个入参是**投递当时的剧情日键**（读不出即 ''）—— 它是将来看档判回退的唯一依据。 */
export function applyActionLedger(ledger, decision, nowMs, atStoryDay) {
    const led = normalizeActionLedger(ledger);
    const d = (decision && typeof decision === 'object') ? decision : {};
    const at = numOrNull(nowMs) || 0;
    const storyDay = refStr(atStoryDay) || refStr(d.storyDay);
    const map = new Map();
    for (const e of led.entries) map.set(e.realIdemKey, e);
    for (const r of listOf(d.fresh)) {
        const rec = (r && typeof r === 'object') ? r : {};
        const anchor = refStr(rec.realIdemKey) || refStr(rec.idemKey);
        if (!anchor) continue;
        map.set(anchor, {
            realIdemKey: anchor,
            idemKey: refStr(rec.idemKey) || anchor,
            kind: refStr(rec.kind),
            sourceId: refStr(rec.sourceId),
            dayKey: refStr(rec.dayKey),
            lane: refStr(rec.lane),
            title: text(rec.title, 80),
            timeBasis: refStr(rec.timeBasis),
            atStoryDay: storyDay,
            state: AC_STATES.OPEN,
            action: '',
            until: '',
            firstAt: at, lastAt: at, why: ''
        });
    }
    /* ★ 撤回在**新增之后**做，且要**跳过本轮刚写进去的那条**：
     *   改期同一轮里「旧日期撤 + 新日期新」共用同一个锚，账本里只能留一条。
     *   先撤后加会让刚写的新日期被自己那条撤回令抹掉（实测：账本只剩一条 withdrawn，
     *   新日期永远落不下来）；加了再撤而不跳过，等于自己撤自己。 */
    const freshAnchors = new Set();
    for (const r of listOf(d.fresh)) {
        const rec = (r && typeof r === 'object') ? r : {};
        const a = refStr(rec.realIdemKey) || refStr(rec.idemKey);
        if (a) freshAnchors.add(a);
    }
    for (const w of listOf(d.withdraw)) {
        const rec = (w && typeof w === 'object') ? w : {};
        const anchor = refStr(rec.realIdemKey) || refStr(rec.idemKey);
        if (freshAnchors.has(anchor)) continue;
        const prev = map.get(anchor);
        /* 没提过的不撤回：不凭「缺席」凭空造一笔账出来。 */
        if (!prev) continue;
        prev.state = AC_STATES.WITHDRAWN;
        prev.lastAt = at;
        prev.why = refStr(rec.why);
    }
    return normalizeActionLedger({ entries: Array.from(map.values()) });
}

/**
 * 处理一条（done / snooze / ignore）。
 *  `open` 是导航**不是状态**：传进来即如实拒绝（返回 changed:false），不悄悄记一笔。
 * @returns {{entries:Array, changed:boolean, state:string, why:string}}
 */
export function applyAction(ledger, idemKey, action, input) {
    const led = normalizeActionLedger(ledger);
    const key = refStr(idemKey);
    const act = refStr(action);
    const inp = (input && typeof input === 'object') ? input : {};
    const allowed = [AC_ACTIONS.DONE, AC_ACTIONS.SNOOZE, AC_ACTIONS.IGNORE];
    if (allowed.indexOf(act) < 0) {
        return { entries: led.entries, changed: false, state: '', why: act === AC_ACTIONS.OPEN ? 'open-is-navigation' : 'unknown-action' };
    }
    const at = numOrNull(inp.at) || 0;
    let hit = null;
    /* 两种键都认：调用方手上可能只有上屏键（idemKey，含日期），也可能只有锚。
     *   只认一种 ⇒ 另一种传进来必然 no-such-entry（用户点了按钮，界面没动静）。 */
    for (const e of led.entries) { if (e.realIdemKey === key || e.idemKey === key) { hit = e; break; } }
    if (!hit) return { entries: led.entries, changed: false, state: '', why: 'no-such-entry' };
    const target = act === AC_ACTIONS.DONE ? AC_STATES.DONE
        : (act === AC_ACTIONS.SNOOZE ? AC_STATES.SNOOZED : AC_STATES.IGNORED);
    hit.state = target;
    hit.action = act;
    hit.lastAt = at;
    /* 延期只认「延到哪一天」（缺即不填 —— 不编一个日期）。 */
    hit.until = act === AC_ACTIONS.SNOOZE ? refStr(inp.until) : '';
    return { entries: led.entries, changed: true, state: target, why: '' };
}

/* ───────── ⑤ 读数文案（**唯一实现**：视图与诊断都走这里） ───────── */

/** 一行行动项。 */
export function acItemLine(item) {
    const it = (item && typeof item === 'object') ? item : {};
    const bits = [refStr(it.label) || refStr(it.kind)];
    bits.push(it.title || '');
    if (it.detail) bits.push(it.detail);
    bits.push(it.lane === AC_LANES.READONLY ? '只读' : '需确认');
    if (it.floor !== null) bits.push('第 ' + String(it.floor) + ' 楼');
    else if (it.storyDay) bits.push(it.storyDay);
    if (!it.jump || it.jump.ok !== true) bits.push('跳不过去：' + refStr(it.jump && it.jump.why));
    return bits.filter(Boolean).join(' · ');
}
/** 一条行动项的通知载荷（**唯一实现**：投递侧不必再拼一次串）。
 *  ★ 无靶心时 `appId` 必须为空 —— 否则横幅一点就把用户丢到别人的首屏
 *    （与 config/schedule-bridge.js 的 `scheduleNoticeOf` 同纪律）。 */
export function actionNoticeOf(item) {
    const it = (item && typeof item === 'object') ? item : {};
    const jump = acJumpOf(it);
    const lane = it.lane === AC_LANES.READONLY ? '只读' : '需确认';
    return {
        title: refStr(it.label) || '待处理',
        message: text(it.title, 80) + (it.detail ? ' · ' + text(it.detail, 120) : ''),
        icon: refStr(it.icon) || '•',
        /* 投递键：同一条的后续变化在通知中心按「更新同一条」处理，不新增。 */
        senderKey: acSenderKey(it),
        /* 点得动就带靶心；点不动就留空 appId 并把理由带在 meta 里（不静默）。 */
        appId: jump.ok ? jump.appId : '',
        meta: {
            actionIdemKey: refStr(it.idemKey),
            anchor: refStr(it.realIdemKey),
            kind: refStr(it.kind),
            lane: lane,
            canOpen: jump.ok === true,
            openWhy: jump.ok ? '' : refStr(jump.why)
        }
    };
}

/** 一行总述。三态**不许压平**：没读到 / 读了确实没有 / 有 N 条，三句话不同形。 */
export function acSummaryLine(center) {
    const c = (center && typeof center === 'object') ? center : null;
    if (!c) return '行动中心：读不到（未取数）';
    const n = Number(c.counts && c.counts.total) || 0;
    const g = listOf(c.gaps).length;
    if (!n) {
        return g
            ? '行动中心：本机还没有可处理的项（' + String(g) + ' 个源读不到，见缺口）'
            : '行动中心：本机还没有可处理的项';
    }
    return '行动中心：' + String(n) + ' 项待处理（只读 ' + String(c.counts.readonly)
        + ' · 需确认 ' + String(c.counts.needConfirm) + '）'
        + (g ? '；' + String(g) + ' 个源读不到' : '；各源全部读到');
}

/** 自检（跑真场景、报可读问题；不读磁盘、不起宿主）。 */
export function actionCenterSelfCheck() {
    const problems = [];
    const kinds = Object.keys(AC_KINDS).map((k) => AC_KINDS[k]);
    /* 1) 登记表：五类齐、字段完备、泳道与动作在白名单内。 */
    const regKinds = Object.keys(AC_SOURCES);
    if (regKinds.length !== kinds.length) problems.push('登记表条数与类别数不一致：' + regKinds.length + ' vs ' + kinds.length);
    for (const k of kinds) {
        const reg = AC_SOURCES[k];
        if (!reg) { problems.push('类别 ' + k + ' 没有登记'); continue; }
        if (!reg.label || !reg.from) problems.push(k + ' 缺 label / from');
        if (reg.lane !== AC_LANES.READONLY && reg.lane !== AC_LANES.NEED_CONFIRM) problems.push(k + ' 泳道非法：' + reg.lane);
        if (reg.timeBasis !== 'story' && reg.timeBasis !== 'real') problems.push(k + ' 时间基非法：' + reg.timeBasis);
        const acts = listOf(reg.actions);
        if (!acts.length) problems.push(k + ' 没有可用动作');
        for (const a of acts) {
            if (Object.keys(AC_ACTIONS).map((x) => AC_ACTIONS[x]).indexOf(a) < 0) problems.push(k + ' 动作不在白名单：' + a);
        }
        if (acts.indexOf(AC_ACTIONS.OPEN) < 0) problems.push(k + ' 缺 open（没有跳转位的条目点了没反应）');
        if (reg.appId && !/^[a-z][a-z0-9]*$/.test(reg.appId)) problems.push(k + ' 的 appId 不是裸 id 形：' + reg.appId);
    }
    /* 2) 幂等键：三者任一缺失即不产键（半截键不许进账）。 */
    const items = [
        itemOf('bill', 'b1', '2026-10-11', 't', 'd', {}),
        itemOf('commitment', 'c1', '2026-10-11', 't', 'd', { lane: AC_LANES.NEED_CONFIRM })
    ];
    for (const it of items) {
        if (!it.idemKey) problems.push('幂等键未产出：' + it.kind);
        if (it.idemKey.split(':').length !== 3) problems.push('幂等键不是三段式：' + it.idemKey);
        if (!acSenderKey(it).startsWith('action:')) problems.push('投递键缺前缀：' + acSenderKey(it));
    }
    if (itemOf('bill', '', '2026-10-11', 't', 'd', {}).idemKey !== '') problems.push('sourceId 缺失却产出了键');
    if (itemOf('bill', 'b1', '', 't', 'd', {}).idemKey !== '') problems.push('dayKey 缺失却产出了键');
    /* 3) 跳转：不可跳必须给原因（不许静默）；类别默认首屏必须能兜底。
     *    造「无靶心」场景要用**类别默认 appId 为空**的那一类（unread）——
     *    拿 bill 是造不出来的：它的登记表 appId 会把空兜底成 traveldesk。
     *    （这一条修前实测就踩了：判据拿 bill 造空靶心，实测永远真有靶心 ⇒ 假红。） */
    const noJump = itemOf('unread', 'u0', '2026-10-11', 't', 'd', {});
    const j = acJumpOf(noJump);
    if (noJump.appId !== '') problems.push('未读类默认 appId 应为空，实测 ' + noJump.appId);
    if (j.ok !== false || !j.why) problems.push('无靶心的条目未给出不可跳原因');
    const yesJump = itemOf('unread', 'u1', '2026-10-11', 't', 'd', { appId: 'wechat' });
    if (acJumpOf(yesJump).ok !== true) problems.push('有来源 App 的条目被判成不可跳');
    /* 类别默认首屏兜底：条目没自带靶心，也要能跳到该类的挂靠 App（否则按钮点了没反应）。 */
    const fallback = itemOf('bill', 'b3', '2026-10-11', 't', 'd', {});
    if (acJumpOf(fallback).ok !== true || acJumpOf(fallback).appId !== 'traveldesk') {
        problems.push('类别默认首屏兜底失效：' + JSON.stringify(acJumpOf(fallback)));
    }
    if (acJumpOf(null).ok !== false || !acJumpOf(null).why) problems.push('空读数未给出不可跳原因');
    /* 4) 账本：幂等 / 撤回门 / 已决定不撤回 / 回档只对剧情基 五条真场景。 */
    const adv = (its, read, storyDay) => ({
        items: its, read: read, storyDay: storyDay || '', counts: { total: its.length }, gaps: []
    });
    const empty = { version: AC_LEDGER_VERSION, entries: [] };
    const a1 = diffActionLedger(adv(items, { bill: true }, ''), empty);
    if (a1.fresh.length !== items.length) problems.push('首轮应全部为新增');
    const led1 = applyActionLedger(empty, a1, 1000, '');
    const a2 = diffActionLedger(adv(items, { bill: true }, ''), led1);
    if (a2.fresh.length !== 0 || a2.replay.length !== items.length) problems.push('同键复算应判为 replay');
    /* 撤回门：源没读 ⇒ 不撤。 */
    const a3 = diffActionLedger(adv([], { bill: false }, ''), led1);
    if (a3.withdraw.length !== 0) problems.push('源没读时把缺席当成了取消');
    /* 源读过且条消失 ⇒ source-gone。
     *   ★ 这里必须**只让被声明读过的那一类**进账：修前拿 bill 的条目配 `{commitment:true}`，
     *   撤回门按 e.kind 查 read，两条 bill 全被「没读」挡住，这条判据从来没测到 source-gone
     *   （实测 a4.withdraw.length === 0 ⇒ 假红）。 */
    const gone = itemOf('commitment', 'c-gone', '2026-10-11', 't', 'd', { storyDay: '2026-10-11' });
    const ledGone = applyActionLedger(empty, diffActionLedger(adv([gone], { commitment: true }, '2026-10-11'), empty), 1000, '2026-10-11');
    const a4 = diffActionLedger(adv([], { commitment: true }, '2026-10-11'), ledGone);
    if (a4.withdraw.length !== 1) problems.push('源读过且条消失时未撤回，实测 ' + a4.withdraw.length);
    else if (a4.withdraw[0].why !== AC_WITHDRAW_REASONS['source-gone']) problems.push('来源消失未判为 source-gone');
    /* 同源改期：旧日期那条撤（source-rescheduled），新日期那条另投 —— 两条归因不许同形。 */
    const movedA = itemOf('commitment', 'c-mv', '2026-10-11', 't', 'd', { storyDay: '2026-10-11' });
    const ledMv = applyActionLedger(empty, diffActionLedger(adv([movedA], { commitment: true }, '2026-10-11'), empty), 1000, '2026-10-11');
    const movedB = itemOf('commitment', 'c-mv', '2026-10-12', 't', 'd', { storyDay: '2026-10-11' });
    const a4b = diffActionLedger(adv([movedB], { commitment: true }, '2026-10-11'), ledMv);
    if (a4b.withdraw.length !== 1 || a4b.withdraw[0].why !== AC_WITHDRAW_REASONS['source-rescheduled']) {
        problems.push('同源改期未判为 source-rescheduled：' + JSON.stringify(a4b.withdraw));
    }
    if (a4b.fresh.length !== 1) problems.push('改期后的新日期条目未判为 fresh');
    /* 已处理的条目不得被撤回。 */
    const acted = applyAction(led1, items[0].idemKey, AC_ACTIONS.DONE, { at: 2000 });
    const a5 = diffActionLedger(adv([], { bill: true }, ''), acted.entries);
    if (a5.withdraw.some((w) => w.idemKey === items[0].idemKey)) problems.push('已完成的条目被撤回了');
    /* 回档：只对剧情基的行判。 */
    const storyItem = itemOf('commitment', 'c9', '2026-10-20', 't', 'd', { storyDay: '2026-10-20' });
    const realItem = itemOf('bill', 'b9', '2026-10-20', 't', 'd', {});
    const ledS = applyActionLedger(empty, diffActionLedger(adv([storyItem], { commitment: true }, '2026-10-20'), empty), 1000, '2026-10-20');
    const rewound = diffActionLedger(adv([], { commitment: true }, '2026-10-05'), ledS);
    if (!rewound.withdraw.length || rewound.withdraw[0].why !== AC_WITHDRAW_REASONS['source-rewound']) problems.push('剧情回退未判为 source-rewound');
    const ledR = applyActionLedger(empty, diffActionLedger(adv([realItem], { bill: true }, ''), empty), 1000, '2026-10-20');
    const notRewound = diffActionLedger(adv([], { bill: true }, '2026-10-05'), ledR);
    if (!notRewound.withdraw.length || notRewound.withdraw[0].why === AC_WITHDRAW_REASONS['source-rewound']) problems.push('现实基的行被拿回档判了（两条时间轴混用）');
    /* 5) 泳道分列：两列之和等于总数（没有一条掉在地上）。 */
    const c5 = buildActionCenter({
        nowMs: Date.parse('2026-10-11T10:00:00'),
        storyDay: '2026-10-11',
        bills: [{ sourceId: 'b1', title: '分账' }],
        commitments: [{ id: 'c1', actor: 'A', content: '见面', dateKey: '2026-10-11', status: 'confirmed' }],
        unread: [{ id: 'u1', title: '消息', appId: 'wechat', ts: Date.parse('2026-10-11T09:00:00') }],
        resume: { sections: [{ key: 'recent', label: '上次停在哪里', rows: [{ text: '在钟楼' }] }], gaps: [] },
        failures: [{ state: 'failed', code: 'storage.key-unregistered', fields: { stage: '写回', needConfirm: true, retry: true }, ok: true, why: '' }]
    });
    if (c5.counts.total !== 5) problems.push('五源各一条应得 5 项，实测 ' + c5.counts.total);
    if (c5.lanes.readonly.length + c5.lanes.needConfirm.length !== c5.counts.total) problems.push('两列之和与总数不符');
    if (!c5.lanes.readonly.length || !c5.lanes.needConfirm.length) problems.push('两列中有一列为空（泳道判定失效）');
    /* 对账锚必须与上屏键**分开且都不为空**：锚不带日期（改期仍是同一条），
     *   上屏键带日期（日历里挪一行即换键）。两者相等反而是错的。 */
    for (const it of c5.items) {
        if (!it.realIdemKey || !it.idemKey) problems.push('条目缺键：' + it.kind);
        if (it.realIdemKey === it.idemKey) problems.push('对账锚与上屏键相等（应当分开）：' + it.kind);
        if (it.certainty !== 'fact' && it.certainty !== 'suggestion') problems.push('certainty 非法：' + it.certainty);
    }
    /* 账单源自称 suggestion —— 界面据此标「这是建议不是事实」，不许被抹成 fact。 */
    const billRow = c5.items.filter((x) => x.kind === 'bill')[0];
    if (!billRow || billRow.certainty !== 'suggestion') problems.push('账单源未保留 suggestion 口径');
    /* 约定投影形状（`commitmentCalendarProjection` 的行：只有 sourceId/title，没有 id/actor）必须产行。 */
    const c5b = buildActionCenter({
        nowMs: Date.parse('2026-10-11T10:00:00'),
        storyDay: '2026-10-11',
        commitments: [{ sourceId: 'apt_1', dateKey: '2026-10-11', time: '19:00', title: '甲：看电影', place: '影院', status: 'confirmed' }]
    });
    const commitRow = c5b.items.filter((x) => x.kind === 'commitment')[0];
    if (!commitRow) problems.push('约定投影行未产行（咽喉处走的就是这个形状 ⇒ 用户那里会一条都不显示）');
    else {
        if (commitRow.sourceId !== 'apt_1') problems.push('投影行的 sourceId 未接上：' + commitRow.sourceId);
        if (!commitRow.title) problems.push('投影行未兜出标题');
    }
    /* 缺剧情日时约定不产行（不拿今天顶替）。 */
    const c6 = buildActionCenter({ nowMs: Date.parse('2026-10-11T10:00:00'), commitments: [{ id: 'c1', actor: 'A', content: '见面', dateKey: '2026-10-11', status: 'confirmed' }] });
    if (c6.items.filter((x) => x.kind === 'commitment').length !== 0) problems.push('缺剧情日时约定仍产行了（拿今天顶替）');
    if (!c6.gaps.some((g) => g.source === 'commitment' && g.reason === 'story-missing')) problems.push('缺剧情日时未记 story-missing gap');
/* 五源全缺时应有五条 gap，且总述**不说**「全部就绪」。 */
    const c7 = buildActionCenter({ nowMs: Date.parse('2026-10-11T10:00:00') });
    if (c7.gaps.length !== 5) problems.push('五源全缺时应有 5 个 gap，实测 ' + c7.gaps.length);
    if (/就绪/.test(acSummaryLine(c7))) problems.push('零项时总述给出了绿灯');
    /* 6) 泳道判据不许被类别登记表整表压平（否则两列永远相等=等于没分）。 */
    const lanesOfTable = new Set(Object.keys(AC_SOURCES).map((k) => AC_SOURCES[k].lane));
    if (lanesOfTable.size < 2) problems.push('登记表把五类压成了同一条泳道（两列分不出来了）');
    if (c5.counts.readonly === c5.counts.needConfirm) problems.push('两列条数相等：可能是泳道未被真正使用');
    /* 7) 条目上的动作必须与类别登记表一致（视图照条目渲染按钮，不一致=按钮错）。 */
    const failedRow = c5.items.filter((x) => x.kind === 'failed')[0];
    const want = AC_SOURCES.failed.actions;
    if (!failedRow || failedRow.actions.join(',') !== want.join(',')) problems.push('失败项动作与登记表不一致');
    /* 8) 通知载荷：点得动的带 appId，点不动的**必须空 appId 且有理由**。 */
    const noticeOk = actionNoticeOf(itemOf('bill', 'b9', '2026-10-11', 't', 'd', {}));
    if (!noticeOk.senderKey.startsWith('action:') || noticeOk.appId !== 'traveldesk') problems.push('通知载荷未带上屏键/兜底首屏');
    const noticeNo = actionNoticeOf(itemOf('unread', 'u9', '2026-10-11', 't', 'd', {}));
    if (noticeNo.appId !== '') problems.push('点不动的条目仍带了 appId（会把用户丢到别人首屏）');
    if (noticeNo.meta.canOpen !== false || !noticeNo.meta.openWhy) problems.push('点不动的条目未在载荷里带出理由');
    return { kinds: kinds.length, sources: regKinds.length, problems: problems };
}

export default {
    AC_KINDS, AC_LANES, AC_ACTIONS, AC_STATES, AC_SOURCES, AC_WITHDRAW_REASONS, AC_LEDGER_KEY,
    buildActionCenter, normalizeActionLedger, diffActionLedger, applyActionLedger,
    applyAction, acJumpOf, acSenderKey, acItemLine, acSummaryLine, actionNoticeOf, actionCenterSelfCheck
};