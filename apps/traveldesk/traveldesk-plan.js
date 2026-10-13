/* ========================================================
 * traveldesk-plan.js — [v4.03.0 · 第三期 E 包手机侧第四项 R3-X6] 协作行程板 · 纯函数内核
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   计划 R3-X6 要的是「把旅行扩为可参与的行程板:人员、地点顺序、分工、准备清单、
 *   共同费用;实际完成后才生成支出与回忆,行程建议始终只是建议」,四条验收:
 *     1 一次三人旅行可安排、改期、分工与结算;
 *     2 同一费用不会两次扣账;
 *     3 预计花费与实际金额分列;
 *     4 拒绝邀请者不被算作参加。
 *   修前实测:apps/traveldesk 只有**账本**(people/families/expenses)+ 汇率试算 +
 *   结算,以及 v3.87.0 接上的结算提交四态 —— 全部是「钱算得对不对」这一面;
 *     · 没有任何一层记录**谁参加**(更谈不上「婉拒的不算参加」);
 *     · 没有地点顺序 / 分工 / 准备清单;
 *     · 共同费用只有「已发生的支出」一种形态,**预计花费无处可放**,于是要么不记
 *       要么冒充已发生(本仓最贵的一类财务错读数,与 finance-commit 头注同一族);
 *     · 结算直接读账本,没有「实际完成后才生成支出」这道闸 —— 报价式估算一进账本
 *       就被 settle 均摊,人会看到一笔根本没发生的钱被分到头上。
 *
 * 【本模块只做五件事(纯函数,零 storage 零 window 零 fetch 零 DOM)】
 *   1 **归一 `normalizeParty`**:成员(邀请三态)/ 地点顺序 / 分工 / 准备清单 /
 *      共同费用(预计 vs 实际两态)各走窄口,认不出的一律如实拒(带 why),不静默丢。
 *   2 **参加者判定 `participantsOf`**:只有 `accepted` 算参加;`declined` 一律**排除**,
 *      `invited` 未答复不算参加(「没拒绝」不等于「参加」——这是本仓既有的
 *      「读不到 ≠ 没有」同一纪律在人员面上的表达)。
 *   3 **读数 `partyReadings`**:预计花费与实际金额**分列**(不合并成一个「总花费」,
 *      那正是让人以为估算已经花掉的根源),另报地点数 / 分工完成 / 清单勾选 / 待生成费用数。
 *   4 **生成支出 `commitCosts`**:只有 `state === 'actual'` 的费用才转成账本支出行,
 *      且**幂等 —— 同一费用不会两次扣账**:生成行 id 固定为 `tv_pc_<费用 id>`,
 *      账本里已有该 id 即 skipped(如实回报,不报错、不重复写)。已生成过的费用再点
 *      「生成支出」得到的是 skipped 而不是第二笔钱。
 *   5 **建议 `partyAdvice`**:只产文本行(**始终只是建议**),不改成员、不改账本、
 *      不自动移动任何人;要落地必须由调用方显式执行(与本仓 creationdesk「建议不落盘」同范式)。
 *
 * 【不做什么】
 *   · 不写存储、不取数、不带计时器 —— 调用方把行程与账本传进来;
 *   · 不动真实余额(那是各来源 owner 的事,本仓 finance-commit 已钉住);
 *   · 不自行把「参加者」写进账本人头 —— 那是**用户动作**(`proposedPeople` 只给建议名单,
 *     真正写在 App 层,且要用户点)。
 *
 * 【三条口径纪律(每条都有判据钉住)】
 *   · **预计 ≠ 实际**:`estimatedTotal` 与 `actualTotal` 两个读数分开报,永不求和成一个数。
 *   · **重复生成不重复扣账**:生成行 id 由费用 id 派生,已在账本即 skipped。
 *   · **没拒绝 ≠ 参加**:只有 accepted 进 participantsOf,invited 与 declined 都不进。
 *
 * 纯 ESM export,纯函数无 window 依赖,保证可测。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/* --------- 1 上限与枚举 --------- */
export const TVP_STOPS_MAX = 40;
export const TVP_TASKS_MAX = 60;
export const TVP_CHECKS_MAX = 60;
export const TVP_COSTS_MAX = 80;
export const TVP_MEMBERS_MAX = 20;
/** 成员邀请三态。顺序有意义:越靠前越「还没定」。 */
export const TVP_MEMBER_STATES = Object.freeze(['invited', 'accepted', 'declined']);
/** 共同费用两态 + 已结算态(结算态由账本回填,不是用户填的)。 */
export const TVP_COST_STATES = Object.freeze(['estimated', 'actual', 'settled']);
/** 生成行 id 前缀 —— 幂等的载体(账本里按它认「这笔费用已经生成过了」)。 */
export const TVP_COST_ID_PREFIX = 'tv_pc_';

function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function listOf(v) { return Array.isArray(v) ? v : []; }
function toStr(v) { return (typeof v === 'string') ? v : ''; }
function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}

/* --------- 2 成员(邀请三态;不认识的一律当「还没答复」并如实标 why) --------- */
/**
 * 归一一名成员。
 *   · 名字空 ⇒ 拒(成员没有名字就无法与账本人头对上,留着只会误导);
 *   · state 认不出 ⇒ 落到 `invited`(最保守的一态:**没答复不是参加**),
 *     并把原因放进 `why`,由调用方决定要不要提示 —— 绝不静默当 accepted。
 * @returns {{member:object|null, why:string}}
 */
export function normalizeMember(raw) {
    const r = isPlain(raw) ? raw : ((typeof raw === 'string') ? { name: raw } : {});
    const name = toStr(r.name || r.who).trim();
    if (!name) return { member: null, why: 'no_name' };
    const rawState = toStr(r.state || r.invite);
    const known = TVP_MEMBER_STATES.indexOf(rawState) >= 0;
    return {
        member: {
            name: name,
            state: known ? rawState : 'invited',
            role: toStr(r.role),
            note: toStr(r.note),
        },
        why: (rawState && !known) ? 'unknown_state' : '',
    };
}
/** 参加者名单(**只有 accepted**)。declined 与 invited 都不进。 */
export function participantsOf(party) {
    const p = isPlain(party) ? party : {};
    const out = [];
    for (const m of listOf(p.members)) {
        if (!isPlain(m)) continue;
        if (toStr(m.state) !== 'accepted') continue;
        if (!toStr(m.name)) continue;
        if (out.indexOf(m.name) >= 0) continue;   /* 同名只算一次(重复邀请不重复占人头) */
        out.push(toStr(m.name));
    }
    return out;
}
/** 明确婉拒的名单(用于读数与建议里明说「不计入参加」)。 */
export function declinedOf(party) {
    const p = isPlain(party) ? party : {};
    const out = [];
    for (const m of listOf(p.members)) {
        if (isPlain(m) && toStr(m.state) === 'declined' && toStr(m.name) && out.indexOf(toStr(m.name)) < 0) out.push(toStr(m.name));
    }
    return out;
}
/** 还没答复的名单。 */
export function pendingOf(party) {
    const p = isPlain(party) ? party : {};
    const out = [];
    for (const m of listOf(p.members)) {
        if (isPlain(m) && toStr(m.state) === 'invited' && toStr(m.name) && out.indexOf(toStr(m.name)) < 0) out.push(toStr(m.name));
    }
    return out;
}

/* --------- 3 地点顺序 / 分工 / 准备清单 --------- */
export function normalizeStop(raw, index) {
    const r = isPlain(raw) ? raw : ((typeof raw === 'string') ? { place: raw } : {});
    const place = toStr(r.place || r.name).trim();
    if (!place) return { stop: null, why: 'no_place' };
    return { stop: { id: toStr(r.id) || ('tvp_s_' + String(index + 1)), place: place, day: toStr(r.day), note: toStr(r.note) }, why: '' };
}
export function normalizeTask(raw, index) {
    const r = isPlain(raw) ? raw : ((typeof raw === 'string') ? { title: raw } : {});
    const title = toStr(r.title || r.what).trim();
    if (!title) return { task: null, why: 'no_title' };
    return { task: { id: toStr(r.id) || ('tvp_t_' + String(index + 1)), title: title, owner: toStr(r.owner), done: r.done === true, note: toStr(r.note) }, why: '' };
}
export function normalizeCheck(raw, index) {
    const r = isPlain(raw) ? raw : ((typeof raw === 'string') ? { text: raw } : {});
    const text = toStr(r.text || r.item).trim();
    if (!text) return { check: null, why: 'no_text' };
    return { check: { id: toStr(r.id) || ('tvp_c_' + String(index + 1)), text: text, owner: toStr(r.owner), done: r.done === true }, why: '' };
}
/**
 * 归一一条共同费用。
 *   · payer 空 ⇒ 拒(「谁垫的」是这个 App 存在的理由,缺了它这笔钱无法参与分摊);
 *   · state 认不出 ⇒ 落到 `estimated`(**最保守的一态:估的绝不进账本**),
 *     这一点与「成员认不出落到 invited」同一条纪律 —— 拿不准就按「还没发生」处置;
 *   · finalCNY 由调用方算好(汇率归 config/num-gate + traveldesk-data 的 toCNY),
 *     本模块不重算汇率,只保证 estimated/actual 分列。
 */
export function normalizeCost(raw, index) {
    const r = isPlain(raw) ? raw : {};
    const payer = toStr(r.payer).trim();
    if (!payer) return { cost: null, why: 'no_payer' };
    const rawState = toStr(r.state);
    const known = TVP_COST_STATES.indexOf(rawState) >= 0;
    const id = toStr(r.id) || ('tvp_m_' + String(index + 1));
    return {
        cost: {
            id: id,
            title: toStr(r.title || r.note || ('共同费用 ' + id)),
            payer: payer,
            amount: numOrNull(r.amount) || 0,
            currency: toStr(r.currency) || 'CNY',
            rate: numOrNull(r.rate) || 1,
            unit: numOrNull(r.unit) || 1,
            finalCNY: numOrNull(r.finalCNY) || 0,
            type: (toStr(r.type) === 'split' || toStr(r.type) === 'private') ? toStr(r.type) : 'shared',
            state: known ? rawState : 'estimated',
            expenseId: toStr(r.expenseId) || (TVP_COST_ID_PREFIX + id),
        },
        why: (rawState && !known) ? 'unknown_state' : '',
    };
}

/* --------- 4 归一整个行程板 --------- */
/**
 * 归一一块行程板。
 *   · 成员走 normalizeMember(去重:同名只留第一条);
 *   · 地点/分工/清单/费用逐条走各自窄口,拒绝的进 rejected(带 kind/index/why);
 *   · 上限一律「最早先出」并如实记 dropped(不静默裁掉)。
 * @param {object} raw —— { id, title, dayKey, members, stops, tasks, checklist, costs, note }
 * @param {object} [opts] —— { fallbackId }
 * @returns {{party:object, rejected:Array, dropped:object}}
 */
export function normalizeParty(raw, opts) {
    const r = isPlain(raw) ? raw : {};
    const o = (opts && typeof opts === 'object') ? opts : {};
    const rejected = [];
    const byKind = {};
    /* 成员 */
    let members = [];
    const seen = {};
    for (let i = 0; i < listOf(r.members).length; i++) {
        const got = normalizeMember(listOf(r.members)[i]);
        if (!got.member) { rejected.push({ kind: 'member', index: i, why: got.why }); continue; }
        if (seen[got.member.name]) continue;
        seen[got.member.name] = true;
        members.push(got.member);
        if (got.why) rejected.push({ kind: 'member_state', index: i, why: got.why });
    }
    const mTrim = trimRows(members, TVP_MEMBERS_MAX);
    members = mTrim.rows;
    if (mTrim.dropped) { byKind.member = mTrim.dropped; rejected.push({ kind: 'member', index: -1, why: 'capped:' + String(mTrim.dropped) }); }
    /* 四张表逐条归一 */
    const tableDefs = [
        { key: 'stops', cap: TVP_STOPS_MAX, fn: normalizeStop, field: 'stop' },
        { key: 'tasks', cap: TVP_TASKS_MAX, fn: normalizeTask, field: 'task' },
        { key: 'checklist', cap: TVP_CHECKS_MAX, fn: normalizeCheck, field: 'check' },
        { key: 'costs', cap: TVP_COSTS_MAX, fn: normalizeCost, field: 'cost' },
    ];
    const out = { members: members };
    for (const def of tableDefs) {
        const rows = [];
        for (let i = 0; i < listOf(r[def.key]).length; i++) {
            const got = def.fn(listOf(r[def.key])[i], i);
            if (!got[def.field]) { rejected.push({ kind: def.key, index: i, why: got.why }); continue; }
            rows.push(got[def.field]);
            if (got.why) rejected.push({ kind: def.key + '_state', index: i, why: got.why });
        }
        const t = trimRows(rows, def.cap);
        out[def.key] = t.rows;
        if (t.dropped) { byKind[def.key] = t.dropped; rejected.push({ kind: def.key, index: -1, why: 'capped:' + String(t.dropped) }); }
    }
    out.id = toStr(r.id) || toStr(o.fallbackId) || 'party';
    out.title = toStr(r.title) || '未命名行程';
    out.dayKey = toStr(r.dayKey);
    out.note = toStr(r.note);
    return { party: out, rejected: rejected, dropped: byKind };
}

/* --------- 5 读数(预计与实际分列 —— 这是本模块的主要理由) --------- */
/**
 * 行程板读数。
 *   · `estimatedTotal` / `actualTotal` **分列**,永不求和成一个「总花费」;
 *     生了成了的(actual)另报 `committedCount`(已进账本的行数,按 expenses 反查);
 *   · 分工与清单各报「做了几件 / 共几件」;
 *   · 参加人数按 participantsOf(declined 不算)。
 * @param {object} party —— normalizeParty 的产出
 * @param {Array} [expenses] —— 账本现有支出行(用于反查「哪些费用已生成」)
 */
export function partyReadings(party, expenses) {
    const p = isPlain(party) ? party : {};
    const exps = listOf(expenses);
    const ids = {};
    for (const e of exps) { if (isPlain(e) && toStr(e.id)) ids[toStr(e.id)] = true; }
    let estimated = 0; let actual = 0;
    let estimatedCount = 0; let actualCount = 0; let committedCount = 0; let pendingCommit = 0;
    for (const c of listOf(p.costs)) {
        if (!isPlain(c)) continue;
        const amount = numOrNull(c.finalCNY) || 0;
        const st = toStr(c.state);
        if (st === 'estimated') { estimated += amount; estimatedCount++; continue; }
        actual += amount; actualCount++;
        const eid = toStr(c.expenseId) || (TVP_COST_ID_PREFIX + toStr(c.id));
        if (ids[eid]) committedCount++; else pendingCommit++;
    }
    const checks = listOf(p.checklist);
    const tasks = listOf(p.tasks);
    return {
        members: listOf(p.members).length,
        accepted: participantsOf(p).length,
        declined: declinedOf(p).length,
        pending: pendingOf(p).length,
        stops: listOf(p.stops).length,
        tasks: tasks.length,
        tasksDone: tasks.filter(function (t) { return isPlain(t) && t.done === true; }).length,
        checks: checks.length,
        checksDone: checks.filter(function (c) { return isPlain(c) && c.done === true; }).length,
        costs: listOf(p.costs).length,
        estimatedTotal: Math.round(estimated * 100) / 100,
        estimatedCount: estimatedCount,
        actualTotal: Math.round(actual * 100) / 100,
        actualCount: actualCount,
        committedCount: committedCount,
        pendingCommit: pendingCommit,
    };
}

/* --------- 6 生成支出(幂等:同一费用不会两次扣账) --------- */
/**
 * 把「实际已发生」且**尚未生成过**的共同费用转成账本支出行。
 *   · 只有 `state === 'actual'` 才生成 —— 预计的一律跳过(why='not-actual');
 *   · **幂等**:生成行 id 固定为 `tv_pc_<费用 id>`,账本里已有即 skipped
 *     (重复点「生成支出」得到 skipped,不是第二笔钱);
 *   · payer 必须在账本人头里,不在即 rejected(why='payer-not-in-people'),
 *     绝不静默换个人扣 —— 「钱从谁那出」不能猜;
 *   · 金额为 0 的行仍生成(0 是合法读数),但读数上分开表达。
 * @returns {{rows:Array, generated:number, skipped:number, rejected:Array}}
 */
export function commitCosts(party, expenses, people) {
    const p = isPlain(party) ? party : {};
    const exps = listOf(expenses);
    const ps = listOf(people);
    const have = {};
    for (const e of exps) { if (isPlain(e) && toStr(e.id)) have[toStr(e.id)] = true; }
    const rows = []; const rejected = [];
    let generated = 0; let skipped = 0;
    for (const c of listOf(p.costs)) {
        if (!isPlain(c)) continue;
        if (toStr(c.state) !== 'actual') { skipped++; rejected.push({ id: toStr(c.id), why: 'not-actual' }); continue; }
        const eid = toStr(c.expenseId) || (TVP_COST_ID_PREFIX + toStr(c.id));
        if (have[eid]) { skipped++; rejected.push({ id: toStr(c.id), why: 'already-generated' }); continue; }
        if (ps.indexOf(toStr(c.payer)) < 0) { rejected.push({ id: toStr(c.id), why: 'payer-not-in-people' }); continue; }
        rows.push({
            id: eid,
            payer: toStr(c.payer),
            currency: toStr(c.currency) || 'CNY',
            amount: numOrNull(c.amount) || 0,
            rate: numOrNull(c.rate) || 1,
            unit: numOrNull(c.unit) || 1,
            finalCNY: numOrNull(c.finalCNY) || 0,
            type: (toStr(c.type) === 'split' || toStr(c.type) === 'private') ? toStr(c.type) : 'shared',
            splitDetails: {},
            isPrivate: false,
            note: toStr(c.title),
        });
        have[eid] = true;
        generated++;
    }
    return { rows: rows, generated: generated, skipped: skipped, rejected: rejected };
}

/* --------- 7 参加者 → 账本人头(**只是建议**,用户点了才写) --------- */
/**
 * 建议的账本人头名单。
 *   · 现有账本里已有人头一律保留(**不擅自删人** —— 删人头会让历史支出换分摊),
 *     另把「参加但不在册」的人补进去;
 *   · 明确婉拒的人**不进**这个名单(验收 4);已在账本里的婉拒者**不动**
 *     (他可能因为别的行程在册),但读数与建议里明说他不算本次参加。
 * @returns {{people:Array, added:Array, declined:Array, changed:boolean}}
 */
export function proposedPeople(party, people) {
    const p = isPlain(party) ? party : {};
    const ps = listOf(people).filter(function (x) { return typeof x === 'string' && x; });
    const acc = participantsOf(p);
    const added = [];
    for (const name of acc) { if (ps.indexOf(name) < 0) { ps.push(name); added.push(name); } }
    return { people: ps, added: added, declined: declinedOf(p), changed: added.length > 0 };
}

/* --------- 8 建议(始终只是建议:不改成员、不改账本) --------- */
/**
 * 行程建议 —— 只产文本行,零副作用。
 *   覆盖四类该提醒的事:还没答复的邀请 / 婉拒者不计入参加 / 有实际费用待生成支出 /
 *   只有估算还不能进账本。每行都是**建议**(调用方可以一句话不说地丢掉)。
 * @returns {Array<string>}
 */
export function partyAdvice(party, expenses) {
    const p = isPlain(party) ? party : {};
    const rd = partyReadings(p, expenses);
    const out = [];
    const pend = pendingOf(p);
    if (pend.length) out.push('还有 ' + String(pend.length) + ' 位没答复:' + pend.join('/') + ' —— 没答复不算参加,别先按他分摊。');
    const dec = declinedOf(p);
    if (dec.length) out.push('已婉拒 ' + String(dec.length) + ' 位:' + dec.join('/') + ' —— 不参与本次分摊。');
    if (rd.pendingCommit > 0) out.push('有 ' + String(rd.pendingCommit) + ' 笔实际费用还没生成支出(生成后才会进结算)。');
    if (rd.estimatedCount > 0) out.push('还有 ' + String(rd.estimatedCount) + ' 笔只是估算(合计 ' + String(rd.estimatedTotal) + '),估算不落账 —— 发生了再改成实际。');
    if (rd.tasks > rd.tasksDone) out.push('分工还有 ' + String(rd.tasks - rd.tasksDone) + ' 项没打勾。');
    if (rd.checks > rd.checksDone) out.push('准备清单还有 ' + String(rd.checks - rd.checksDone) + ' 项没勾。');
    if (!out.length) out.push('这一板没有待办的建议。');
    return out;
}

/* --------- 9 内核自检(合并前先跑这一支) --------- */
/**
 * 内核自检。四类「静默错」各钉一条:
 *   · 婉拒的人进了参加者名单(验收 4 的正面对);
 *   · 预计金额被算进实际合计(预计与实际分列);
 *   · 同一费用生成两次支出(同一费用不会两次扣账);
 *   · 成员/费用认不出时被当成参加/已发生(拿不准就按「还没发生」)。
 * @returns {{ok:boolean, problems:Array<string>}}
 */
export function partySelfCheck() {
    const problems = [];
    /* 1 参加者判定 */
    const base = normalizeParty({
        title: '三人行',
        members: [{ name: 'A', state: 'accepted' }, { name: 'B', state: 'invited' }, { name: 'C', state: 'declined' }],
    }).party;
    const acc = participantsOf(base);
    if (acc.join(',') !== 'A') problems.push('参加者判定错:应为 A,实际 ' + acc.join(','));
    if (declinedOf(base).join(',') !== 'C') problems.push('婉拒名单错');
    if (pendingOf(base).join(',') !== 'B') problems.push('未答复名单错');
    /* 2 预计与实际分列 */
    const p2 = normalizeParty({
        costs: [
            { id: 'c1', payer: 'A', amount: 100, finalCNY: 100, state: 'estimated' },
            { id: 'c2', payer: 'A', amount: 250, finalCNY: 250, state: 'actual' },
        ],
    }).party;
    const rd = partyReadings(p2, []);
    if (rd.estimatedTotal !== 100) problems.push('估计合计错:' + String(rd.estimatedTotal));
    if (rd.actualTotal !== 250) problems.push('实际合计错:' + String(rd.actualTotal));
    if (rd.pendingCommit !== 1) problems.push('待生成数错:' + String(rd.pendingCommit));
    /* 3 幂等:同一费用不会两次扣账 */
    const first = commitCosts(p2, [], ['A', 'B']);
    if (first.generated !== 1) problems.push('首次生成应 1 笔,实际 ' + String(first.generated));
    if (first.rows[0].id !== TVP_COST_ID_PREFIX + 'c2') problems.push('生成行 id 未按费用 id 派生:' + String(first.rows[0] && first.rows[0].id));
    const second = commitCosts(p2, first.rows, ['A', 'B']);
    if (second.generated !== 0) problems.push('二次生成必须 0 笔(幂等),实际 ' + String(second.generated));
    if (second.skipped !== 2) problems.push('二次应跳过 2 笔(估算 1 + 已生成 1),实际 ' + String(second.skipped));
    /* 4 认不出 ⇒ 保守 */
    const p3 = normalizeParty({ members: [{ name: 'D', state: 'maybe' }], costs: [{ id: 'x', payer: 'D', state: 'somehow' }] }).party;
    if (!p3 || p3.members[0].state !== 'invited') problems.push('认不出的邀请态必须落到 invited');
    if (!p3 || p3.costs[0].state !== 'estimated') problems.push('认不出的费用态必须落到 estimated');
    if (participantsOf(p3).length !== 0) problems.push('认不出的邀请态不得算参加');
    /* 5 payer 不在人头 ⇒ 拒,不静默换人 */
    const r5 = commitCosts(p2, [], []);
    if (r5.generated !== 0) problems.push('payer 不在人头时不得生成');
    if (!r5.rejected.some(function (x) { return x.why === 'payer-not-in-people'; })) problems.push('payer 不在人头必须如实拒');
    /* 6 建议只产文本 */
    const adv = partyAdvice(base, []);
    if (!adv.length || adv.some(function (s) { return typeof s !== 'string'; })) problems.push('建议必须是文本行');
    /* 7 人头建议不擅自删人 */
    const pp = proposedPeople(base, ['A', 'Z']);
    if (pp.people.join(',') !== 'A,Z') problems.push('人头建议不得删掉在册的 Z:' + pp.people.join(','));
    if (pp.declined.join(',') !== 'C') problems.push('人头建议里应明说婉拒名单');
    return { ok: problems.length === 0, problems: problems };
}

export default {
    TVP_STOPS_MAX, TVP_TASKS_MAX, TVP_CHECKS_MAX, TVP_COSTS_MAX, TVP_MEMBERS_MAX,
    TVP_MEMBER_STATES, TVP_COST_STATES, TVP_COST_ID_PREFIX,
    normalizeMember, participantsOf, declinedOf, pendingOf,
    normalizeStop, normalizeTask, normalizeCheck, normalizeCost, normalizeParty,
    partyReadings, commitCosts, proposedPeople, partyAdvice, partySelfCheck,
};