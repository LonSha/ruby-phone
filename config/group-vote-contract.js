/* ============================================================
 * group-vote-contract.js — [v4.29.0 · 第四期 R4-X7]
 *   「群聊投票与协商式活动安排」纯内核（只读口径 + 幂等确认，零写盘）
 * ------------------------------------------------------------
 * 【计划原文（R4-X7）】
 *   「群里提出时间/地点选项，人物按已知偏好回应、弃权或反对；用户综合结果再确认活动，
 *    形成可玩的协商过程。」
 *   落点与依赖：wechat 内投票消息 + 既有日历/旅行入口，**复用稳定成员 ID 与约定 owner**；
 *     **表决不直接变成承诺**，只有明确接受者进入参与名单。
 *   验收：四人群两轮改方案，**缺席者不被代投、平票不自动拍板、重复回复不重复计票**；
 *     **确认一次只生成一份活动**；真实模型检查角色意见有依据，不要求每人机械发言。
 *   不做三条：**不接真实通讯平台、不引入常驻群聊代理、不用关系分数伪造角色同意**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游 lonsha-memory-plugin 的 `tests/audit/open_face_registry.tsv` 十四面里
 *   **没有任何投票 / 轮询面**（`grep -nE 'vote|poll|ballot' index.js extract-feedback.js`
 *   零命中）。故本面与 R4-X4 / R4-X6 不同：那两件治的是「上游名面已在、手机侧零消费」，
 *   本件是**下游自建**（不能像它们那样「搬上游读数」）。
 *   本仓已有的三件底座也都不是投票产品面：
 *     · `apps/wechat/group-scheduler.js` —— 只决定「这一轮谁说话」；
 *     · `config/group-pace.js` —— 只决定「这一轮台面给谁多少」；
 *     · `apps/traveldesk/traveldesk-plan.js` 与 `config/commitment-flow.js` —— 行程与约定，
 *       而计划原文逐字写着「现有行程确认不等于多人表达不同意见」。
 *   缺的不是数据（群成员、消息、约定账都在），缺的是把「多人对多个选项的表态」
 *   落成**可判读数**的那一层。缺了它，四件事会同时发生，且**一个字符都不报错**：
 *     ① 同一个人回两次，票数翻倍（重复回复重复计票）；
 *     ② 两个选项票数一样时，「取第一个」被当成「大家选了它」（平票自动拍板）；
 *     ③ 没表态的人被当成默许（缺席被代投）；
 *     ④ 「投过票」直接等于「约好了」（表决直接变成承诺）。
 *
 * 【本件只做四件事（不读存储、不派事件、不替用户拍板）】
 *   1 **分列**：支持 / 反对 / 弃权三张**具名**表；「本轮表过态 / 只在旧轮表过态 /
 *      完全没表态 / 不在成员表里」四类人**结构上分开**（压平任意两类都会造出
 *      「谁算在场」的错读数）；
 *   2 **不重复计票**：按 (成员, 选项) 只认**最后一条**表态，被取代者逐条具名；
 *      事件键完全相同的重复回复在归一时丢弃并计数（两件事分开报）；
 *   3 **不自动拍板**：`verdict` 三态 decided / tie / no-votes **互不同形**；
 *      平票时 `leader` 为空、`tied` 具名 —— 确认动作必须由用户点名，本件不替他挑；
 *   4 **幂等确认**：活动 id 由「选项 + 参与名单」**确定性派生** ⇒ 同一份结果重复确认
 *      恒得同一个 id，第二次起如实报 replayed，**只生成一份活动**。
 *
 * 【边界（如实登记，不装）】
 *   · 本件是**纯函数**：不读存储、不写状态、不派事件、不读时钟（`Date.now` 一次都不出现）；
 *   · 本件**不落上游**：`writesNothing` 恒真、`commitmentCreated` 恒假 ——
 *     表决结果只是一份读数，要变成约定得用户显式确认、且落点在**约定 owner**（日历）；
 *   · 本件**不替缺席者作证**：没表态的人不进参与名单、不算反对、也**不按关系推断**
 *     （「不用关系分数伪造角色同意」在本件里是结构成立的：本件压根不读关系刻度）；
 *   · 本件**不合成分数**：读数里只有「谁支持了什么」的具名表，没有分数 / 权重 / 概率一族键
 *     （`GV_FORBIDDEN_KEYS` 深度扫描守这一条，自检里真跑）。
 * ============================================================ */
'use strict';
/* ★ 数值取值门走**全仓唯一实现**（config/num-gate.js），不在本文件就地再写一份。 */
import { numOrNull } from './num-gate.js';

/** 四态（**两两不同形**：没得投 ≠ 没人 ≠ 真读数空 ≠ 读到）。 */
export const GV_STATES = Object.freeze({
    NO_OPTIONS: 'no-options',
    NO_MEMBERS: 'no-members',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 归因词（两两不同形；「平票」与「无人支持」各有各的词，不许压成一句「还没定」）。 */
export const GV_REASONS = Object.freeze({
    ok: '投票读数可用',
    'no-options': '这一轮还没给选项（**没得投**，不是「没人投」）',
    'no-members': '群里一个人都没有（**不是**「没人表态」）',
    empty: '选项与人都齐了，但一条表态都没有 —— 这是**真读数**（还没人回），不是「平票」',
    tie: '并列最高：**不自动拍板**，等用户点名',
    'no-votes': '一条有效支持都没有（**不是**「平票」）',
    foreign: '有表态的人不在群成员表里（**不计票**，已具名）',
    'option-absent': '点名的选项不在本轮选项里（不许拿旧轮的选项当本轮结果）',
    replayed: '同一份活动已存在（**未重复生成**）',
    created: '已生成活动（**仍未成为约定**）'
});

/** 各态的**给用户看的一句处置建议**（与 GV_REASONS 的短归因分工不同：那条进一行读数，这条进卡片）。 */
export const GV_STATE_HINT = Object.freeze({
    'no-options': '这一轮还没有选项：等群里提出时间或地点（本卡不替群里编选项）',
    'no-members': '这个群里还没有成员：先加人再谈投票',
    empty: '投票已经建好，还没人表态 —— 真实模型按各自已知偏好回应后才会有票'
});
/** 确认被拒时给用户看的一句（与 GV_REASONS 分工：那条进一行读数，这条进通知）。
 *   ★ 第二张「理由到文案」表在视图里写过一版（本版判据 A 组当场转红），已收回内核。 */
export const GV_REASON_HINT = Object.freeze({
    'no-options': '这一轮还没有选项 —— 等群里提出时间或地点。',
    'no-members': '这个群里还没有成员 —— 先加人再谈投票。',
    'no-votes': '一条支持都没有 —— 先等人表态，不是「平票」。',
    'option-absent': '还没点选项（或点的不在本轮并列里）—— 先点一个再确认。',
    replayed: '这份活动已经生成过了（未重复生成）。'
});
/** 中文标签到表态 id 的唯一映射（AI 侧标签解析与界面共用；视图不写第二份表）。 */
export const GV_CHOICE_BY_LABEL = Object.freeze({
    '支持': 'support',
    '反对': 'oppose',
    '弃权': 'abstain'
});

/** 三种表态（**穷尽**：任何一条表态必须落入其中一种，不得现编动作名）。 */
export const GV_CHOICES = Object.freeze(['support', 'oppose', 'abstain']);
export const GV_CHOICE_LABEL = Object.freeze({
    support: '支持',
    oppose: '反对',
    abstain: '弃权'
});

/** 表决结果三态（**穷尽且不同形**：唯一领先 / 平票 / 无人支持）。 */
export const GV_VERDICTS = Object.freeze(['decided', 'tie', 'no-votes']);
export const GV_VERDICT_LABEL = Object.freeze({
    decided: '有唯一领先（**仍不等于承诺**）',
    tie: '平票（**不自动拍板**）',
    'no-votes': '无人支持'
});

/** 选项类别（时间 / 地点 / 其他）—— 只是标签，不参与任何加权。 */
export const GV_OPTION_KINDS = Object.freeze(['time', 'place', 'other']);
export const GV_KIND_LABEL = Object.freeze({
    time: '时间',
    place: '地点',
    other: '其他'
});

/** 归属四类（**分列**：合成一格就分不出「谁算在场」）。 */
export const GV_MEMBER_BUCKETS = Object.freeze(['votedNow', 'staleOnly', 'absent', 'foreign']);
export const GV_MEMBER_LABEL = Object.freeze({
    votedNow: '本轮表过态',
    staleOnly: '只在旧轮表过态',
    absent: '完全没表态（**不被代投**）',
    foreign: '不在成员表里（**不计票**）'
});

/**
 * 读数里**不得出现**的键名（分数 / 权重 / 概率 / 排序一族）。
 *   计划原文「不用关系分数伪造角色同意」—— 本件把它变成对自己读数的一次深度扫描（自检里真跑）。
 */
export const GV_FORBIDDEN_KEYS = Object.freeze([
    'score', 'weight', 'confidence', 'probability', 'percent', 'percentage',
    'rank', 'priority', 'preference', 'rating', 'affinity', 'like'
]);

/** 上限（冻结；调用方不得就地改语义）。 */
export const GV_LIMITS = Object.freeze({
    /** 一轮里的选项上限（时间/地点候选，多了不是协商是问卷） */
    options: 8,
    /** 参与者上限 */
    members: 40,
    /** 归一后的表态条数上限 */
    statements: 240,
    /** 可回看的活动数上限 */
    activities: 12,
    label: 80,
    note: 160,
    question: 160
});

function str(v) { return String(v == null ? '' : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
function clip(s, max) {
    const t = str(s);
    const m = Math.max(8, Number(max) || GV_LIMITS.label);
    return t.length <= m ? t : (t.slice(0, m - 1) + String.fromCharCode(8230));
}
function keyOf(s) { return str(s).slice(0, 120); }
/** 稳定短哈希（纯算术、无随机、无时钟）—— 幂等键就是它。 */
function shortHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) h = (((h * 33) ^ s.charCodeAt(i)) >>> 0);
    return h.toString(36);
}
function nameListOf(rows) { return arr(rows).map((x) => (obj(x) ? str(x.name) : str(x))).filter(Boolean); }

/**
 * 归一：把调用方喂进来的「问题 + 选项 + 人 + 表态 + 已生成活动」落成可判读数。
 *   ★ 归一**只收敛形状**，不判任何一格结果：票数、平票、缺席全在 `tallyVote` 里判。
 *   ★ 事件键完全相同的重复回复在这里丢弃并**计数**（`dropped.duplicate`）——
 *     这是「重复回复不重复计票」的第一层；第二层（同一人同一选项改主意）在 `tallyVote` 里。
 * @returns {{version:number, question:string, round:number, options:Array, members:Array,
 *            statements:Array, activities:Array, dropped:{duplicate:number}}}
 */
export function normalizeVote(raw) {
    const o = obj(raw) || {};
    const round = Math.max(1, Math.floor(numOrNull(o.round) || 1));
    const seenOpt = new Set();
    const options = [];
    for (const it of arr(o.options).slice(0, GV_LIMITS.options)) {
        const x = obj(it);
        if (!x) continue;
        const id = keyOf(x.id);
        if (!id || seenOpt.has(id)) continue;
        seenOpt.add(id);
        const r = Math.max(1, Math.floor(numOrNull(x.round) || round));
        const kind = str(x.kind).toLowerCase();
        options.push({
            id: id,
            label: clip(x.label || id, GV_LIMITS.label),
            kind: GV_OPTION_KINDS.indexOf(kind) >= 0 ? kind : 'other',
            round: r
        });
    }
    const seenMem = new Set();
    const members = [];
    for (const it of arr(o.members).slice(0, GV_LIMITS.members)) {
        const x = obj(it);
        if (!x) continue;
        const id = keyOf(x.id);
        if (!id || seenMem.has(id)) continue;
        seenMem.add(id);
        members.push({ id: id, name: clip(x.name || id, GV_LIMITS.label) });
    }
    const seenEv = new Set();
    const statements = [];
    let duplicate = 0;
    for (const it of arr(o.statements).slice(0, GV_LIMITS.statements)) {
        const x = obj(it);
        if (!x) continue;
        const memberId = keyOf(x.memberId);
        const optionId = keyOf(x.optionId);
        const choice = str(x.choice).toLowerCase();
        if (!memberId || !optionId || GV_CHOICES.indexOf(choice) < 0) continue;
        const eventKey = keyOf(x.eventKey) || (memberId + '|' + optionId + '|' + choice);
        if (seenEv.has(eventKey)) { duplicate += 1; continue; }
        seenEv.add(eventKey);
        statements.push({
            memberId: memberId, optionId: optionId, choice: choice, eventKey: eventKey,
            floor: numOrNull(x.floor), note: clip(x.note, GV_LIMITS.note)
        });
    }
    const seenAct = new Set();
    const activities = [];
    for (const it of arr(o.activities).slice(-GV_LIMITS.activities)) {
        const x = obj(it);
        if (!x) continue;
        const id = keyOf(x.id);
        if (!id || seenAct.has(id)) continue;
        seenAct.add(id);
        activities.push({
            id: id,
            optionId: keyOf(x.optionId),
            label: clip(x.label, GV_LIMITS.label),
            round: Math.max(1, Math.floor(numOrNull(x.round) || 1)),
            participants: nameListOf(x.participants).slice(0, GV_LIMITS.members),
            declined: nameListOf(x.declined).slice(0, GV_LIMITS.members),
            abstained: nameListOf(x.abstained).slice(0, GV_LIMITS.members),
            absent: nameListOf(x.absent).slice(0, GV_LIMITS.members),
            /** ★ 恒为 null：本件不生成承诺（表决不直接变成承诺）。 */
            commitment: null,
            at: numOrNull(x.at),
            by: clip(x.by, GV_LIMITS.label)
        });
    }
    return {
        version: 1,
        question: clip(o.question, GV_LIMITS.question),
        round: round,
        options: options,
        members: members,
        statements: statements,
        activities: activities,
        dropped: { duplicate: duplicate }
    };
}

/** 恒定键面的读数模板（读者不必再判 undefined）。 */
function faceOf(state, reason, extra) {
    return Object.assign({
        kind: 'ruby_phone_group_vote',
        version: 1,
        state: state,
        reason: reason,
        text: GV_REASONS[reason] || GV_REASONS.ok,
        ok: state === GV_STATES.OK,
        degraded: state !== GV_STATES.OK,
        /** 本面能不能替沉默作证：只有**真跑过**（读到 / 零表态）才为真 */
        silentCapable: state === GV_STATES.OK || state === GV_STATES.EMPTY,
        /** ★ 本件一个字节都不落盘：表决只是读数。 */
        writesNothing: true,
        /** ★ 恒假：表决不直接变成承诺（确认要用户点名，落点在约定 owner）。 */
        commitmentCreated: false,
        question: '',
        round: 1,
        options: [],
        active: [],
        archived: [],
        verdict: 'no-votes',
        leader: '',
        leaderLabel: '',
        tied: [],
        tiedLabels: [],
        decided: false,
        participants: [],
        declined: [],
        abstained: [],
        absent: [],
        staleOnly: [],
        foreign: [],
        replaced: [],
        activities: [],
        counts: {
            options: 0, active: 0, archived: 0, members: 0, statements: 0, effective: 0,
            duplicate: 0, replaced: 0, foreign: 0, absent: 0, staleOnly: 0, activities: 0,
            support: 0, oppose: 0, abstain: 0
        }
    }, extra || {});
}

/**
 * 主读数：一轮投票的**全部判定**都在这里，且每一格都不压平。
 *
 * 【四类人怎么分（分列的理由）】
 *   · `votedNow`  —— 在本轮选项上表过态（支持 / 反对 / 弃权都算表过态）；
 *   · `staleOnly` —— 只在**旧轮**选项上表过态（本轮一句话没说）：
 *       他不是缺席（他确实回过了），也**不是**本轮表态（拿旧轮当本轮 = 让上一轮的
 *       共识替这一轮作证）。故单独一格；
 *   · `absent`    —— 一条表态都没有：**不被代投**（不进参与名单、不算反对）；
 *   · `foreign`   —— 表了态但不在成员表里：**不计票**（可能是改名/退群/上层给错 id）。
 *
 * 【「重复回复不重复计票」是两层】
 *   ① 事件键相同 ⇒ 归一阶段就丢弃（`dropped.duplicate`）；
 *   ② 同一人同一选项改主意 ⇒ 只认**最后一条**，被取代的那条进 `replaced` 具名。
 *   两层分开报：压成一句「去重了 N 条」就分不清「真重复」与「改主意」。
 *
 * 【平票与无人支持不同形】
 *   平票：至少一个选项支持数 > 0 且并列最高 ⇒ `leader` 为空、`tied` 具名；
 *   无人支持：所有选项支持数都是 0 ⇒ `verdict='no-votes'`、`tied` 为空。
 *   两者的处置相反（前者要用户点名 / 后者要等人表态），压平即误导。
 */
export function tallyVote(raw) {
    const st = normalizeVote(raw);
    if (!st.options.length) {
        return faceOf(GV_STATES.NO_OPTIONS, 'no-options', {
            question: st.question, round: st.round, members: st.members,
            counts: Object.assign(faceOf(GV_STATES.NO_OPTIONS, 'no-options').counts, {
                members: st.members.length, statements: st.statements.length,
                duplicate: st.dropped.duplicate
            })
        });
    }
    if (!st.members.length) {
        return faceOf(GV_STATES.NO_MEMBERS, 'no-members', {
            question: st.question, round: st.round, options: st.options,
            counts: Object.assign(faceOf(GV_STATES.NO_MEMBERS, 'no-members').counts, {
                options: st.options.length, active: st.options.filter((x) => x.round === st.round).length,
                statements: st.statements.length, duplicate: st.dropped.duplicate
            })
        });
    }
    const memberById = new Map(st.members.map((m) => [m.id, m]));
    const optionById = new Map(st.options.map((x) => [x.id, x]));
    const active = st.options.filter((x) => x.round === st.round);
    const archived = st.options.filter((x) => x.round !== st.round);
    const activeIds = new Set(active.map((x) => x.id));
    /* ── 有效表态：按 (成员, 选项) 只认最后一条 ── */
    const latest = new Map();   /* 'member|option' -> statement */
    const replaced = [];
    const foreignSeen = new Set();
    for (const s of st.statements) {
        if (!memberById.has(s.memberId)) { foreignSeen.add(s.memberId); continue; }
        if (!optionById.has(s.optionId)) continue;   /* 选项不在表里：不进任何一格 */
        const k = s.memberId + '|' + s.optionId;
        const prev = latest.get(k);
        if (prev) replaced.push({ member: memberById.get(s.memberId).name, optionId: s.optionId, from: prev.choice, to: s.choice });
        latest.set(k, s);
    }
    /* ── 三张具名表 + 本轮/旧轮/缺席/外来 四类人 ── */
    const participants = []; const declined = []; const abstained = [];
    const votedNow = new Set(); const votedStale = new Set();
    const supportByOption = new Map(active.map((x) => [x.id, 0]));
    const opposeByOption = new Map(active.map((x) => [x.id, 0]));
    const abstainByOption = new Map(active.map((x) => [x.id, 0]));
    const supportRows = []; const opposeRows = []; const abstainRows = [];
    for (const s of latest.values()) {
        const m = memberById.get(s.memberId);
        const isActive = activeIds.has(s.optionId);
        if (isActive) votedNow.add(s.memberId); else votedStale.add(s.memberId);
        if (s.choice === 'support') {
            if (isActive) { supportByOption.set(s.optionId, supportByOption.get(s.optionId) + 1); supportRows.push({ member: m.name, memberId: m.id, optionId: s.optionId }); }
        } else if (s.choice === 'oppose') {
            if (isActive) { opposeByOption.set(s.optionId, opposeByOption.get(s.optionId) + 1); opposeRows.push({ member: m.name, memberId: m.id, optionId: s.optionId }); }
        } else {
            if (isActive) { abstainByOption.set(s.optionId, abstainByOption.get(s.optionId) + 1); abstainRows.push({ member: m.name, memberId: m.id, optionId: s.optionId }); }
        }
    }
    const foreign = [...foreignSeen].map((id) => ({ id: id, name: id }));
    /* ── 参与 / 反对 / 弃权 三张表（**按本轮选项**；旧轮表态不掺进来） ── */
    for (const x of active) {
        const sup = supportRows.filter((r) => r.optionId === x.id);
        const opp = opposeRows.filter((r) => r.optionId === x.id);
        const ab = abstainRows.filter((r) => r.optionId === x.id);
        participants.push({ optionId: x.id, label: x.label, members: sup.map((r) => r.member), memberIds: sup.map((r) => r.memberId) });
        declined.push({ optionId: x.id, label: x.label, members: opp.map((r) => r.member), memberIds: opp.map((r) => r.memberId) });
        abstained.push({ optionId: x.id, label: x.label, members: ab.map((r) => r.member), memberIds: ab.map((r) => r.memberId) });
    }
    const absent = st.members.filter((m) => !votedNow.has(m.id) && !votedStale.has(m.id)).map((m) => m.name);
    const staleOnly = st.members.filter((m) => votedStale.has(m.id) && !votedNow.has(m.id)).map((m) => m.name);
    /* ── 结果三态（**平票不自动拍板**） ── */
    const tally = active.map((x) => ({
        optionId: x.id, label: x.label, kind: x.kind,
        support: supportByOption.get(x.id) || 0,
        oppose: opposeByOption.get(x.id) || 0,
        abstain: abstainByOption.get(x.id) || 0
    }));
    const supportCounts = tally.map((x) => x.support);
    const top = supportCounts.length ? Math.max.apply(null, supportCounts) : 0;
    const leaders = tally.filter((x) => x.support === top && top > 0);
    let verdict = 'no-votes';
    let leader = ''; let leaderLabel = '';
    let tied = []; let tiedLabels = [];
    if (top > 0 && leaders.length === 1) {
        verdict = 'decided'; leader = leaders[0].optionId; leaderLabel = leaders[0].label;
    } else if (top > 0) {
        verdict = 'tie';
        tied = leaders.map((x) => x.optionId);
        tiedLabels = leaders.map((x) => x.label);
    }
    /* ★ 顺序恒按选项原序：排序即隐式推荐（本件不排序、不评分）。 */
    const reason = verdict === 'tie' ? 'tie' : (verdict === 'no-votes' ? 'no-votes' : 'ok');
    const anyStatement = st.statements.length > 0;
    const state = anyStatement ? GV_STATES.OK : GV_STATES.EMPTY;
    const finalReason = anyStatement ? (foreign.length && verdict === 'no-votes' ? 'foreign' : reason) : 'empty';
    return faceOf(state, finalReason, {
        question: st.question,
        round: st.round,
        options: st.options,
        active: active,
        archived: archived,
        tally: tally,
        verdict: verdict,
        leader: leader,
        leaderLabel: leaderLabel,
        tied: tied,
        tiedLabels: tiedLabels,
        decided: verdict === 'decided',
        participants: participants,
        declined: declined,
        abstained: abstained,
        absent: absent,
        staleOnly: staleOnly,
        foreign: foreign,
        replaced: replaced,
        activities: st.activities,
        counts: {
            options: st.options.length, active: active.length, archived: archived.length,
            members: st.members.length, statements: st.statements.length,
            effective: latest.size, duplicate: st.dropped.duplicate, replaced: replaced.length,
            foreign: foreign.length, absent: absent.length, staleOnly: staleOnly.length,
            activities: st.activities.length,
            support: supportRows.length, oppose: opposeRows.length, abstain: abstainRows.length
        }
    });
}

/** 活动 id 的**确定性派生**：同一份「选项 + 参与名单」恒得同一个 id（幂等键）。 */
export function activityIdOf(optionId, participants) {
    const names = arr(participants).map((x) => str(x)).filter(Boolean).slice().sort();
    return 'gva_' + shortHash(keyOf(optionId) + '#' + names.join(','));
}
/* ★ 这里原先还有一个 `keyOp`（与上面的 `keyOf` 逐字同构的重复工具函数）。
 *   同一件事两份实现正是本仓反复治过的形态：改一处、另一处漂移，而两边都不会响。
 *   已合并为 `keyOf` 一份（`confirmActivity` 里那处引用同步改掉）。 */

/**
 * 确认一份表决结果（**幂等**：同一份结果重复确认恒得同一个 id，第二次起 replayed）。
 *
 * 【为什么要用户点名】平票时本件**不替他挑**：`optionId` 没给（或给了不在并列里的项）
 *   一律拒收，并把可选项原样带回 —— 「本件不自动拍板」在这里是结构成立的，不靠注释承诺。
 * 【为什么确认不等于承诺】返回里 `commitmentCreated` 恒假、`commitment` 恒 null：
 *   本件只产出一份**活动读数**（谁参加 / 谁反对 / 谁没表态），把它变成约定是
 *   **约定 owner（日历）**的活，且要用户显式落笔。
 * @returns {{ok:boolean, reason:string, activity:object|null, replayed:boolean,
 *            state:object, options:Array, wrote:boolean}}
 */
export function confirmActivity(raw, input) {
    const st = normalizeVote(raw);
    const read = tallyVote(raw);
    const i = obj(input) || {};
    const optionId = keyOf(i.optionId);
    const reject = (reason, options) => ({
        ok: false, reason: reason, activity: null, replayed: false,
        state: st, options: options || [], wrote: false
    });
    if (!st.options.length) return reject('no-options', []);
    if (!st.members.length) return reject('no-members', []);
    /* ★ 平票不自动拍板：点名项必须真的存在，且必须落在**并列最高**里（若平票）。 */
    const activeIds = new Set(read.active.map((x) => x.id));
    if (!optionId) return reject('option-absent', read.tied.length ? read.tied : read.active.map((x) => x.id));
    if (!activeIds.has(optionId)) return reject('option-absent', read.active.map((x) => x.id));
    if (read.verdict === 'tie' && read.tied.indexOf(optionId) < 0) {
        return reject('option-absent', read.tied);
    }
    if (read.verdict === 'no-votes') return reject('no-votes', read.active.map((x) => x.id));
    /* ★ 参与名单 = **明确支持者**（缺席不进、弃权不进、反对进 declined）。 */
    const p = read.participants.filter((x) => x.optionId === optionId)[0] || { members: [], label: '' };
    const d = read.declined.filter((x) => x.optionId === optionId)[0] || { members: [] };
    const a = read.abstained.filter((x) => x.optionId === optionId)[0] || { members: [] };
    const id = activityIdOf(optionId, p.members);
    const existed = st.activities.filter((x) => x.id === id)[0] || null;
    if (existed) {
        return {
            ok: true, reason: 'replayed', replayed: true, wrote: false,
            state: st, options: [], activity: existed
        };
    }
    const activity = {
        id: id,
        optionId: optionId,
        label: p.label,
        round: read.round,
        participants: p.members.slice(),
        declined: d.members.slice(),
        abstained: a.members.slice(),
        absent: read.absent.slice(),
        /** ★ 恒 null：确认只产出活动读数，**不产出承诺**。 */
        commitment: null,
        at: numOrNull(i.at),
        by: clip(i.by, GV_LIMITS.label)
    };
    return { ok: true, reason: 'created', replayed: false, wrote: false, state: st, options: [], activity: activity };
}

/** 五态计数（给界面与读数共用；不重复遍历）。 */
export function summarizeVote(raw) {
    const st = normalizeVote(raw);
    const read = tallyVote(raw);
    return {
        options: st.options.length,
        active: read.counts.active,
        archived: read.counts.archived,
        members: st.members.length,
        statements: st.statements.length,
        effective: read.counts.effective,
        duplicate: st.dropped.duplicate,
        replaced: read.counts.replaced,
        foreign: read.counts.foreign,
        absent: read.counts.absent,
        staleOnly: read.counts.staleOnly,
        activities: st.activities.length,
        support: read.counts.support,
        oppose: read.counts.oppose,
        abstain: read.counts.abstain,
        verdict: read.verdict
    };
}

/* ---------------------------------------------------------------
 * 一行读数（各态**分开说**：合并任意两态都会误导「该去做什么」）
 * ------------------------------------------------------------ */
/** 表决一行读数（票数 + 结果三态；平票与无人支持**永远分开说**）。 */
export function voteLine(read) {
    const r = obj(read) || {};
    if (r.state === GV_STATES.NO_OPTIONS) return '投票:' + GV_REASONS['no-options'];
    if (r.state === GV_STATES.NO_MEMBERS) return '投票:' + GV_REASONS['no-members'];
    if (r.state === GV_STATES.EMPTY) return '投票:' + GV_REASONS.empty;
    const c = obj(r.counts) || {};
    const parts = ['选项 ' + (c.active || 0) + '/' + (c.options || 0)];
    parts.push('支持 ' + (c.support || 0));
    if (c.oppose) parts.push('反对 ' + c.oppose);
    if (c.abstain) parts.push('弃权 ' + c.abstain);
    /* ★ 缺席**永远单独报**：它决定「这份结果能不能当共识用」。 */
    if (c.absent) parts.push('**没表态 ' + c.absent + '**');
    if (c.staleOnly) parts.push('只在旧轮表过态 ' + c.staleOnly);
    if (c.foreign) parts.push('表外人 ' + c.foreign);
    if (c.replaced) parts.push('改主意 ' + c.replaced);
    if (c.duplicate) parts.push('重复丢弃 ' + c.duplicate);
    let tail;
    if (r.verdict === 'tie') tail = '**平票：不自动拍板**';
    else if (r.verdict === 'no-votes') tail = '无人支持';
    else tail = '领先:' + str(r.leaderLabel);
    return '投票:' + parts.join(' · ') + ' · ' + tail;
}

/** 活动一行读数（确认与否**不同形**）。 */
export function activityLine(read) {
    const r = obj(read) || {};
    if (r.state === GV_STATES.NO_OPTIONS) return '活动:' + GV_REASONS['no-options'];
    if (r.state === GV_STATES.NO_MEMBERS) return '活动:' + GV_REASONS['no-members'];
    if (r.state === GV_STATES.EMPTY) return '活动:' + GV_REASONS.empty;
    const c = obj(r.counts) || {};
    if (r.verdict === 'tie') return '活动:平票（' + (r.tiedLabels || []).join(' / ') + '）—— 等你点名，本卡不替你挑';
    if (r.verdict === 'no-votes') return '活动:还没人支持，先等人表态';
    return '活动:' + str(r.leaderLabel) + ' · 参加 ' + (c.support || 0) + ' 人 · **仍未成为约定**';
}

/* ---------------------------------------------------------------
 * 这一面能不能读（★ 判定词**只此一份**）
 *   为什么放在内核而不是视图：视图里写第二份状态字面量，内核改名那天
 *   那些比较会**静默落空**（不报错、不转红），于是「没给选项」被显示成
 *   「没人表态」—— 两个处置正好相反（去提选项 / 等群里回话）。
 * ------------------------------------------------------------ */
/**
 * 这一面能不能读 + 读不到时该说什么。
 *   ★ `readable:false` 时 `hint` **必非空** —— 视图直接摆出来即可，不必再判一格。
 *   ★ 未知状态（内核加了新态而本件没跟上）**也走 readable:false**：
 *     宁可说「不可读」，绝不默认成「读到了」。
 */
export function voteGateOf(read) {
    const r = obj(read) || {};
    if (r.state === GV_STATES.OK) return { readable: true, state: r.state, hint: '' };
    return {
        readable: false,
        state: str(r.state),
        hint: GV_STATE_HINT[r.state] || '投票面不可读（状态未登记，如实说读不出）'
    };
}
/**
 * 表决读数的**一句说明**（没有要说的就给空串）。
 *   ★ 「平票」与「无人支持」的差别只在这一处判：前者要用户点名、后者要等人表态 ——
 *     合成一句就是把「你来挑一个」写成「大家还没回」。
 */
export function voteNoteOf(read) {
    const r = obj(read) || {};
    if (r.verdict === 'tie') return '并列最高（' + (r.tiedLabels || []).join(' / ') + '）—— 该由用户点名，不是「还没定」';
    if (r.reason === 'foreign') return '有表态的人不在群成员表里（不计票）—— 该先确认他是谁，不是「没人支持」';
    if (r.reason === 'option-absent') return '点名的选项不在本轮选项里 —— 不许拿旧轮的选项当本轮结果';
    return '';
}

/* ---------------------------------------------------------------
 * 自检（纯函数式，不抛）：八条口径当场自证
 * ------------------------------------------------------------ */
/**
 * 一 没给选项 ⇒ no-options，**不是** empty（两态不同形）；
 * 二 群里没人 ⇒ no-members；
 * 三 选项与人都齐但零表态 ⇒ empty，**不是** tie；
 * 四 ★ 核心：同一人同一选项回两次 ⇒ **只计一票**（改主意按最后一条）；
 * 五 ★ 核心：事件键相同的重复回复 ⇒ 归一阶段丢弃且计数（与「改主意」不同形）；
 * 六 ★ 核心：平票 ⇒ leader 为空、tied 具名、**不自动拍板**；
 * 七 ★ 核心：缺席者**不进参与名单**、不算反对、也不按关系推断；
 * 八 ★ 核心：确认**幂等**（同一份结果两次确认恒同 id，第二次 replayed）；
 * 九 ★ 核心：确认**不产出承诺**（commitmentCreated 恒假、commitment 恒 null）；
 * 十 ★ 核心：读数里**不含**分数 / 权重 / 概率一族键。
 */
export function gvSelfCheck() {
    const problems = [];
    const base = {
        question: '周末去哪',
        round: 2,
        options: [
            { id: 'o1', label: '周六下午', kind: 'time', round: 2 },
            { id: 'o2', label: '周日晚上', kind: 'time', round: 2 },
            { id: 'o3', label: '老地方', kind: 'place', round: 1 }
        ],
        members: [
            { id: 'c1', name: '甲' }, { id: 'c2', name: '乙' },
            { id: 'c3', name: '丙' }, { id: 'c4', name: '丁' }
        ],
        statements: [
            { memberId: 'c1', optionId: 'o1', choice: 'support', eventKey: 'e1' },
            { memberId: 'c2', optionId: 'o1', choice: 'support', eventKey: 'e2' },
            { memberId: 'c3', optionId: 'o2', choice: 'support', eventKey: 'e3' },
            { memberId: 'c4', optionId: 'o3', choice: 'support', eventKey: 'e4' }
        ]
    };
    /* 一：没给选项。 */
    const noOpt = tallyVote({ round: 1, members: base.members, statements: [] });
    if (noOpt.state !== GV_STATES.NO_OPTIONS) problems.push('没给选项应报 no-options');
    if (noOpt.writesNothing !== true) problems.push('writesNothing 必须恒为 true');
    if (noOpt.commitmentCreated !== false) problems.push('commitmentCreated 必须恒为 false');
    /* 二：没人。 */
    if (tallyVote({ round: 1, options: base.options, members: [], statements: [] }).state !== GV_STATES.NO_MEMBERS) {
        problems.push('群里没人应报 no-members');
    }
    /* 三：零表态 ⇒ empty（**不是** tie）。 */
    const empty = tallyVote({ round: 2, options: base.options, members: base.members, statements: [] });
    if (empty.state !== GV_STATES.EMPTY) problems.push('零表态应报 empty');
    if (empty.verdict === 'tie') problems.push('零表态不得报平票（两态不同形）');
    if (voteLine(empty) === voteLine(tallyVote(base))) problems.push('「还没人回」与「有票」的文案不得同形');
    /* 四：同一人同一选项回两次 ⇒ 只计一票。 */
    const twice = tallyVote(Object.assign({}, base, {
        statements: base.statements.concat([
            { memberId: 'c1', optionId: 'o1', choice: 'support', eventKey: 'e1b' }
        ])
    }));
    const o1Row = twice.tally.filter((x) => x.optionId === 'o1')[0] || { support: 0 };
    if (o1Row.support !== 2) problems.push('同一人同一选项回两次必须只计一票，o1 实测 ' + o1Row.support);
    if (twice.counts.support !== 3) problems.push('重复表态不得抬高总支持数，实测 ' + twice.counts.support);
    if (twice.counts.replaced !== 1) problems.push('被取代的那条必须具名计入 replaced');
    /* 四之二：改主意（支持→反对）也只认最后一条，且两栏**同时**不许留旧票。 */
    const flip = tallyVote(Object.assign({}, base, {
        statements: base.statements.concat([
            { memberId: 'c1', optionId: 'o1', choice: 'oppose', eventKey: 'e1c' }
        ])
    }));
    const flipO1 = flip.tally.filter((x) => x.optionId === 'o1')[0] || { support: 0, oppose: 0 };
    if (flipO1.support !== 1) problems.push('改主意后支持栏必须少一票，实测 ' + flipO1.support);
    if (flipO1.oppose !== 1) problems.push('改主意后反对栏必须接上，实测 ' + flipO1.oppose);
    /* 五：事件键相同的重复回复 ⇒ 归一丢弃并计数。 */
    const dup = tallyVote(Object.assign({}, base, {
        statements: base.statements.concat([base.statements[0]])
    }));
    if (dup.counts.duplicate !== 1) problems.push('事件键相同的重复回复必须丢弃并计数');
    if (dup.counts.replaced !== 0) problems.push('「真重复」不得被记成「改主意」（两件事分开报）');
    /* 六：平票 ⇒ 不自动拍板。 */
    const tie = tallyVote(Object.assign({}, base, {
        statements: [
            { memberId: 'c1', optionId: 'o1', choice: 'support', eventKey: 't1' },
            { memberId: 'c2', optionId: 'o2', choice: 'support', eventKey: 't2' }
        ]
    }));
    if (tie.verdict !== 'tie') problems.push('一票对一票应报平票');
    if (tie.leader !== '') problems.push('平票时 leader 必须为空（不自动拍板）');
    if (tie.tied.length !== 2) problems.push('平票项必须具名');
    if (tie.decided !== false) problems.push('平票不得报 decided');
    if (voteNoteOf(tie) === '') problems.push('平票必须给一句说明');
    /* 六之二：平票时点名不在并列里的项 ⇒ 拒收。 */
    const badPick = confirmActivity(Object.assign({}, base, {
        statements: [
            { memberId: 'c1', optionId: 'o1', choice: 'support', eventKey: 't1' },
            { memberId: 'c2', optionId: 'o2', choice: 'support', eventKey: 't2' }
        ]
    }), { optionId: 'o3' });
    if (badPick.ok !== false) problems.push('平票时点名非并列项必须拒收');
    /* 七：缺席者不被代投。 */
    const r = tallyVote(base);
    if (r.absent.indexOf('丁') >= 0) problems.push('在旧轮表过态的丁不该算「完全没表态」');
    if (r.staleOnly.indexOf('丁') < 0) problems.push('只在旧轮表过态必须单独一格');
    const r2 = tallyVote({ round: 2, options: base.options, members: base.members, statements: [base.statements[0]] });
    if (r2.absent.indexOf('乙') < 0) problems.push('没表态的乙必须进 absent');
    if (r2.participants[0].members.indexOf('乙') >= 0) problems.push('缺席者不得进参与名单');
    if (r2.declined[0].members.indexOf('乙') >= 0) problems.push('缺席者不得被算成反对');
    /* 八：确认幂等。 */
    const one = confirmActivity(base, { optionId: 'o1' });
    if (one.ok !== true || one.reason !== 'created') problems.push('首次确认应成功');
    if (one.wrote !== false) problems.push('确认不得写盘');
    const again = confirmActivity(Object.assign({}, base, { activities: [one.activity] }), { optionId: 'o1' });
    if (again.reason !== 'replayed' || again.replayed !== true) problems.push('重复确认必须报 replayed');
    if (again.activity.id !== one.activity.id) problems.push('同一份结果两次确认必须恒得同一个 id');
    /* 九：确认不产出承诺。 */
    if (one.activity.commitment !== null) problems.push('活动不得携带承诺');
    if (one.activity.participants.indexOf('丁') >= 0) problems.push('没在本轮表态者不得进参与名单');
    /* 十：禁用键深度扫描（真跑）。 */
    const scan = (v, hits) => {
        if (v === null || v === undefined) return hits;
        if (Array.isArray(v)) { for (const it of v) scan(it, hits); return hits; }
        if (typeof v !== 'object') return hits;
        for (const k of Object.keys(v)) {
            if (GV_FORBIDDEN_KEYS.indexOf(String(k).toLowerCase()) >= 0) hits.push(k);
            scan(v[k], hits);
        }
        return hits;
    };
    const hits = scan([tallyVote(base), tallyVote(tie), empty, noOpt, summarizeVote(base), one], []);
    if (hits.length) problems.push('读数里出现了禁用键：' + hits.join('/'));
    return { problems: problems };
}

export default {
    GV_STATES,
    GV_REASONS,
    GV_STATE_HINT,
    GV_REASON_HINT,
    GV_CHOICE_BY_LABEL,
    GV_CHOICES,
    GV_CHOICE_LABEL,
    GV_VERDICTS,
    GV_VERDICT_LABEL,
    GV_OPTION_KINDS,
    GV_KIND_LABEL,
    GV_MEMBER_BUCKETS,
    GV_MEMBER_LABEL,
    GV_FORBIDDEN_KEYS,
    GV_LIMITS,
    normalizeVote,
    tallyVote,
    activityIdOf,
    confirmActivity,
    summarizeVote,
    voteLine,
    activityLine,
    voteGateOf,
    voteNoteOf,
    gvSelfCheck
};
