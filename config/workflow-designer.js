/* ========================================================
 * workflow-designer.js — [v4.04.0 · 第三期 E 包手机侧第五项 R3-X7] 可视化个人流程编排 · 纯内核
 *
 * 【这一层解决的真缺口】
 *   R-X5 的 config/workflow.js 把「能跑的流程」钉死成 **两条内置流程**(resume-brief /
 *   settle-to-calendar):步骤是数据、owner 在内置注册表里,用户**改不了**。
 *   R3-X7 要的恰好是反过来的那一半:**用户不改代码也能自己排一条流程**
 *   (人员可拖排 / 条件分支 / 参数绑定 / 存成个人模板)。两者不矛盾的条件是:
 *   用户排出来的东西**仍然只是白名单动作的排列** —— 排的是顺序与条件,**不是代码**。
 *
 * 【怎么做到「不执行任意 JS」】
 *   · 用户能挑的动作只有 WD_ACTIONS 这五条(摘要 / 保存草稿 / 提醒 / 日历 / 确认结算),
 *     每条**自带** owner / 输入面 / 输出面 / 是否写 —— 这三样由内核钉,用户改不了;
 *   · 用户能改的只有三件事:**顺序**(moveStep)/ **条件**(setBranch)/ **参数**(bindParams)
 *     加 **组数**(setRepeat,且只许非写步);
 *   · 合成时(config/workflow.js 的 wfFlowOf)再逐条复验:owner 必须在注册表里、
 *     写步的 owner 必须可写、展开后步骤数不得超过 WF_STEPS_MAX。
 *     任一不过 ⇒ 这条模板**开不了工**,不静默降级。
 *
 * 【六条口径纪律】
 *   · **认不出即拒,不猜**:动作 / 参数键 / 分支态 / 位置,任一个认不出即如实记 rejected;
 *   · **条件读不出来就不跑那一步**(fail-closed):分支认不出 ⇒ **丢整步**,不许只丢闸
 *     (只丢闸等于把用户设的写闸悄悄拆掉,那是本层最贵的一类错);
 *   · **写步不许重复**:重复组只许给非写步(repeat-on-write);重复是「发两次提醒」的直接成因;
 *   · **越界即拒,不夹取**:拖排位置越界、参数超上限一律拒,不悄悄夹到边界;
 *   · **读不到 ≠ 没有**:模板台账 null(读不到)与 [](一条都没有)不同形;
 *   · **本层零副作用**:不写存储、不调 owner、不取数 —— 与 workflow.js 同分工。
 *
 * 纯 ESM export,纯函数无 window 依赖,保证可测。
 * ======================================================== */
'use strict';

import { WF_OWNERS, WF_STEPS_MAX, WF_REASONS } from './workflow.js';
import { numOrNull } from './num-gate.js';

/** 本模块口径版本(改动协议时才抬)。 */
const WD_VERSION = 1;

/** 上限(全部显式,且每一条都有判据钉住)。 */
export const WD_LIMITS = Object.freeze({
    templates: 24,   /* 个人模板数 */
    steps: 8,        /* 一条模板的步骤数(≤ 运行器的 WF_STEPS_MAX=12,留出重复展开的余量) */
    params: 6,       /* 一步的绑定参数个数 */
    repeat: 3,       /* 一步的重复组数 */
    nameMax: 40,
    idMax: 60,
    textMax: 120,
});

/** 模板台账的空名兜底(**名字是给人看的,空名不设成缺陷**)。 */
export const WD_DEFAULT_NAME = '未命名流程';

/** 模板 id 前缀(咽喉在保存时按此生成,视图不各写一份)。 */
export const WD_ID_PREFIX = 'wd_t_';

/**
 * **用户能挑的动作只有这五条**(计划 R3-X7 原文点名的首批动作:摘要 / 保存草稿 / 提醒 / 日历 / 确认结算)。
 * 每条的 owner / in / out / writes **由本表钉死** —— 这是「不执行任意 JS」的结构落法:
 *   用户排的是这几条的**顺序与条件**,挑不出第六件事,也就写不出第六件事。
 * `params` 是这一步**允许绑定**的参数键(表外的键一律 param-unknown,不许顺手加)。
 */
export const WD_ACTIONS = Object.freeze({
    'read-brief': Object.freeze({
        key: 'read-brief', label: '生成续玩摘要', hint: '把当前项目的续玩读数整成一段摘要(只读,不改状态)',
        owner: 'resume-workbench', in: Object.freeze(['resume-face']), out: 'brief',
        writes: false, params: Object.freeze([]),
    }),
    'save-draft': Object.freeze({
        key: 'save-draft', label: '保存草稿', hint: '把摘要存进存档台的草稿格',
        owner: 'archive-draft', in: Object.freeze(['brief']), out: 'draft',
        writes: true, params: Object.freeze(['note']),
    }),
    'notify': Object.freeze({
        key: 'notify', label: '发提醒', hint: '落一条系统通知(标题可绑定)',
        owner: 'notify', in: Object.freeze(['brief']), out: 'notice',
        writes: true, params: Object.freeze(['title']),
    }),
    'commit-finance': Object.freeze({
        key: 'commit-finance', label: '确认结算', hint: '把一份结算提交落账(幂等:同一天同一份草稿不重复扣款)',
        owner: 'finance-ledger', in: Object.freeze(['settlement-draft']), out: 'ledger',
        writes: true, params: Object.freeze([]),
    }),
    'add-memo': Object.freeze({
        key: 'add-memo', label: '加日历备忘', hint: '在日历上加一条备忘(标题可绑定)',
        owner: 'calendar', in: Object.freeze(['ledger']), out: 'memo',
        writes: true, params: Object.freeze(['title']),
    }),
});

export const WD_ACTION_KEYS = Object.freeze(Object.keys(WD_ACTIONS));

/** 条件分支的两态(第三种是「无条件」= when 为 null,**不写成第三个词**,免得两处口径)。 */
export const WD_BRANCH_STATES = Object.freeze(['present', 'absent']);

/** 归因词表(why 只许取这里的值;视图与诊断据此说人话)。 */
export const WD_REASONS = Object.freeze({
    NAME_EMPTY: 'name-empty',
    NO_STEPS: 'no-steps',
    TOO_MANY_STEPS: 'too-many-steps',
    TOO_MANY_TEMPLATES: 'too-many-templates',
    ACTION_UNKNOWN: 'action-unknown',
    PARAM_UNKNOWN: 'param-unknown',
    PARAM_TOO_MANY: 'param-too-many',
    BRANCH_UNKNOWN: 'branch-unknown',
    BRANCH_FACE_MISSING: 'branch-face-missing',
    REPEAT_ON_WRITE: 'repeat-on-write',
    REPEAT_OUT_OF_RANGE: 'repeat-out-of-range',
    MOVE_OUT_OF_RANGE: 'move-out-of-range',
    STEP_UNKNOWN: 'step-unknown',
    TEMPLATE_UNKNOWN: 'template-unknown',
    TEMPLATES_UNREADABLE: 'templates-unreadable',
});

/* ────── 小工具(零依赖) ────── */

function wdObj(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}

function wdStr(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

function wdArr(v) {
    return Array.isArray(v) ? v : null;
}

/* --------- 1 单步归一(认不出即拒,不猜) --------- */

/**
 * 归一一步。**四样各走各的窄口**:动作 / 参数 / 条件 / 组数。
 * 三处「保守处置」是刻意的(都会记 rejected,不静默):
 *   · 动作认不出 ⇒ **整步丢掉**(没有安全默认值);
 *   · 条件认不出或条件面缺名 ⇒ **整步丢掉**(只丢闸 = 把用户设的写闸拆掉,那更贵);
 *   · 写步带重复 ⇒ **丢掉重复**只留一组(发两次提醒 / 落两笔账正是重复的害处);
 *   · 参数键未声明 ⇒ **只丢那一个键**,步留着。
 */
function wdStep(raw, index) {
    const o = wdObj(raw) || {};
    const rejected = [];
    const actionKey = wdStr(o.action, 40);
    const act = WD_ACTIONS[actionKey] || null;
    if (!act) {
        rejected.push({ kind: 'step', index: index, why: WD_REASONS.ACTION_UNKNOWN, action: actionKey });
        return { step: null, rejected: rejected };
    }

    /* 组数:只许非写步,且必须落在 [1, repeat] 区间内(越界即拒,不夹取)。 */
    let rep = 1;
    const rawRepeat = numOrNull(o.repeat);
    if (rawRepeat !== null && rawRepeat !== 1) {
        if (act.writes) rejected.push({ kind: 'step', index: index, why: WD_REASONS.REPEAT_ON_WRITE, action: act.key });
        else if (rawRepeat < 1 || rawRepeat > WD_LIMITS.repeat) rejected.push({ kind: 'step', index: index, why: WD_REASONS.REPEAT_OUT_OF_RANGE, action: act.key });
        else rep = Math.floor(rawRepeat);
    }

    /* 参数绑定:只认该动作声明过的键。 */
    const pin = wdObj(o.params) || {};
    const params = {};
    const pkeys = Object.keys(pin);
    if (pkeys.length > WD_LIMITS.params) rejected.push({ kind: 'step', index: index, why: WD_REASONS.PARAM_TOO_MANY, action: act.key });
    for (const k of pkeys.slice(0, WD_LIMITS.params)) {
        if (act.params.indexOf(k) < 0) {
            rejected.push({ kind: 'step', index: index, why: WD_REASONS.PARAM_UNKNOWN, action: act.key, param: k });
            continue;
        }
        const v = wdStr(pin[k], WD_LIMITS.textMax);
        if (v) params[k] = v;
    }

    /* 条件分支:两种态;面名必填(没面名的条件等于无条件,那是假闸)。 */
    let when = null;
    const w = wdObj(o.when);
    if (w) {
        const state = wdStr(w.state, 20);
        const face = wdStr(w.face, 60);
        if (WD_BRANCH_STATES.indexOf(state) < 0) {
            rejected.push({ kind: 'step', index: index, why: WD_REASONS.BRANCH_UNKNOWN, action: act.key, state: state });
            return { step: null, rejected: rejected };
        }
        if (!face) {
            rejected.push({ kind: 'step', index: index, why: WD_REASONS.BRANCH_FACE_MISSING, action: act.key });
            return { step: null, rejected: rejected };
        }
        when = { face: face, state: state };
    }

    return {
        step: { action: act.key, repeat: rep, params: params, when: when, label: act.label },
        rejected: rejected,
    };
}

/* --------- 2 模板归一 --------- */

/**
 * 归一一条模板。上限**最早先出**并把被挤掉的条数如实报在 dropped 里(不隐藏输入)。
 * @returns {{template:Object, rejected:Array, dropped:number, ok:boolean}}
 */
export function normalizeTemplate(raw) {
    const o = wdObj(raw) || {};
    const rejected = [];
    const name = wdStr(o.name, WD_LIMITS.nameMax) || WD_DEFAULT_NAME;
    const stepsIn = wdArr(o.steps) || [];
    if (!stepsIn.length) rejected.push({ kind: 'template', index: -1, why: WD_REASONS.NO_STEPS });
    if (stepsIn.length > WD_LIMITS.steps) rejected.push({ kind: 'template', index: -1, why: WD_REASONS.TOO_MANY_STEPS });
    const steps = [];
    let dropped = 0;
    for (let i = 0; i < stepsIn.length; i += 1) {
        if (steps.length >= WD_LIMITS.steps) { dropped += 1; continue; }
        const r = wdStep(stepsIn[i], i);
        for (const x of r.rejected) rejected.push(x);
        if (r.step) steps.push(r.step);
        else dropped += 1;
    }
    const template = {
        id: wdStr(o.id, WD_LIMITS.idMax),
        name: name,
        steps: steps,
        at: numOrNull(o.at),
    };
    return { template: template, rejected: rejected, dropped: dropped, ok: rejected.length === 0 && dropped === 0 };
}

/**
 * 归一模板台账。三态分开(与 wfRunsOf / tv 族同口径):
 *   null ⇒ 读不到(**不是**「一条都没有」);[] ⇒ 真没有;其余 ⇒ 逐条归一。
 */
export function normalizeTemplates(raw) {
    if (raw === null || raw === undefined) {
        return { readable: false, templates: [], dropped: 0, why: WD_REASONS.TEMPLATES_UNREADABLE };
    }
    if (!Array.isArray(raw)) {
        return { readable: false, templates: [], dropped: 0, why: WD_REASONS.TEMPLATES_UNREADABLE };
    }
    const kept = [];
    let dropped = 0;
    for (const r of raw) {
        const n = normalizeTemplate(r);
        if (!n.template.steps.length) { dropped += 1; continue; }
        kept.push(n.template);
    }
    const lim = kept.slice(0, WD_LIMITS.templates);
    return {
        readable: true, templates: lim,
        dropped: dropped + Math.max(0, kept.length - lim.length), why: '',
    };
}

/* --------- 3 三件用户能改的事(顺序 / 参数 / 条件) --------- */

/** 拖排:把第 from 步挪到第 to 位。**越界即拒,不夹取**。 */
export function moveStep(template, from, to) {
    const t = wdObj(template) || {};
    const steps = (wdArr(t.steps) || []).slice();
    const a = numOrNull(from);
    const b = numOrNull(to);
    if (a === null || b === null) return { ok: false, why: WD_REASONS.MOVE_OUT_OF_RANGE, template: t, from: null, to: null };
    const i = Math.floor(a);
    const j = Math.floor(b);
    if (i < 0 || j < 0 || i >= steps.length || j >= steps.length || i === j) {
        return { ok: false, why: WD_REASONS.MOVE_OUT_OF_RANGE, template: t, from: i, to: j };
    }
    const moved = steps.splice(i, 1)[0];
    steps.splice(j, 0, moved);
    return { ok: true, why: '', template: Object.assign({}, t, { steps: steps }), from: i, to: j };
}

/** 参数绑定:**整体替换**那一步的参数集(确定式,不是合并 —— 合并会让旧值缠住新值)。 */
export function bindParams(template, index, params) {
    const t = wdObj(template) || {};
    const steps = (wdArr(t.steps) || []).map((s) => Object.assign({}, s));
    const i = numOrNull(index);
    if (i === null || i < 0 || i >= steps.length) return { ok: false, why: WD_REASONS.STEP_UNKNOWN, rejected: [], template: t };
    const act = WD_ACTIONS[wdStr(steps[i].action, 40)] || null;
    if (!act) return { ok: false, why: WD_REASONS.ACTION_UNKNOWN, rejected: [], template: t };
    const pin = wdObj(params) || {};
    const rejected = [];
    const next = {};
    const keys = Object.keys(pin);
    if (keys.length > WD_LIMITS.params) rejected.push({ kind: 'params', index: i, why: WD_REASONS.PARAM_TOO_MANY });
    for (const k of keys.slice(0, WD_LIMITS.params)) {
        if (act.params.indexOf(k) < 0) {
            rejected.push({ kind: 'params', index: i, why: WD_REASONS.PARAM_UNKNOWN, param: k });
            continue;
        }
        const v = wdStr(pin[k], WD_LIMITS.textMax);
        if (v) next[k] = v;
    }
    steps[i] = Object.assign({}, steps[i], { params: next });
    return {
        ok: rejected.length === 0, why: rejected.length ? rejected[0].why : '',
        rejected: rejected, template: Object.assign({}, t, { steps: steps }),
    };
}

/** 条件分支:when 传 null / 空 / always 即「取消条件」。面名缺失或态认不出**一律拒**。 */
export function setBranch(template, index, when) {
    const t = wdObj(template) || {};
    const steps = (wdArr(t.steps) || []).map((s) => Object.assign({}, s));
    const i = numOrNull(index);
    if (i === null || i < 0 || i >= steps.length) return { ok: false, why: WD_REASONS.STEP_UNKNOWN, template: t };
    const raw = wdStr(when, 20);
    if (!when || raw === 'always' || raw === '') {
        steps[i] = Object.assign({}, steps[i], { when: null });
        return { ok: true, why: '', template: Object.assign({}, t, { steps: steps }) };
    }
    const w = wdObj(when) || {};
    const state = wdStr(w.state, 20);
    const face = wdStr(w.face, 60);
    if (WD_BRANCH_STATES.indexOf(state) < 0) return { ok: false, why: WD_REASONS.BRANCH_UNKNOWN, template: t };
    if (!face) return { ok: false, why: WD_REASONS.BRANCH_FACE_MISSING, template: t };
    steps[i] = Object.assign({}, steps[i], { when: { face: face, state: state } });
    return { ok: true, why: '', template: Object.assign({}, t, { steps: steps }) };
}

/** 组数:写步一律拒(repeat-on-write);越界一律拒(不夹取)。 */
export function setRepeat(template, index, count) {
    const t = wdObj(template) || {};
    const steps = (wdArr(t.steps) || []).map((s) => Object.assign({}, s));
    const i = numOrNull(index);
    if (i === null || i < 0 || i >= steps.length) return { ok: false, why: WD_REASONS.STEP_UNKNOWN, template: t };
    const act = WD_ACTIONS[wdStr(steps[i].action, 40)] || null;
    if (!act) return { ok: false, why: WD_REASONS.ACTION_UNKNOWN, template: t };
    if (act.writes) return { ok: false, why: WD_REASONS.REPEAT_ON_WRITE, template: t };
    const c = numOrNull(count);
    if (c === null || c < 1 || c > WD_LIMITS.repeat) return { ok: false, why: WD_REASONS.REPEAT_OUT_OF_RANGE, template: t };
    steps[i] = Object.assign({}, steps[i], { repeat: Math.floor(c) });
    return { ok: true, why: '', template: Object.assign({}, t, { steps: steps }) };
}

/* --------- 4 合成(模板 → 可跑的流程声明) --------- */

/**
 * 把一条个人模板合成**运行器认得的**流程声明。
 *
 * 这是本模块与 R-X5 唯一的接口面:合成出来的东西形状与 WF_FLOWS 的条目一样
 *   (id / label / hint / steps[in,out,writes,owner]),所以它照样过运行器那套判定
 *   (owner 注册表 / 写步可写 / 步骤上限 / 默认 dry-run / 幂等 / 跨段),**一条都不例外**。
 *
 * 展开后步骤数**超上限即拒**(不静默截断);写步重复在归一阶段就已被拦掉。
 * @returns {{flow:Object|null, problems:Array}}
 */
export function composeFlow(template) {
    const t = wdObj(template) || {};
    const problems = [];
    const src = (wdArr(t.steps) || []).slice(0, WD_LIMITS.steps);
    let total = 0;
    for (const s of src) {
        const act = WD_ACTIONS[wdStr(s.action, 40)] || null;
        if (!act) { problems.push(WD_REASONS.ACTION_UNKNOWN); continue; }
        total += Math.max(1, Math.min(WD_LIMITS.repeat, Math.floor(numOrNull(s.repeat) || 1)));
    }
    if (!src.length) {
        if (!problems.length) problems.push(WD_REASONS.NO_STEPS);
        return { flow: null, problems: problems };
    }
    if (total > WF_STEPS_MAX) {
        problems.push(WD_REASONS.TOO_MANY_STEPS);
        return { flow: null, problems: problems };
    }
    const rows = [];
    let seq = 0;
    for (const s of src) {
        const act = WD_ACTIONS[wdStr(s.action, 40)] || null;
        if (!act) continue;
        const owner = WF_OWNERS[act.owner] || null;
        if (!owner) { problems.push(WF_REASONS.NO_OWNER); continue; }
        if (act.writes && owner.writable !== true) { problems.push(WF_REASONS.OWNER_NOT_WRITABLE); continue; }
        const rep = Math.max(1, Math.min(WD_LIMITS.repeat, Math.floor(numOrNull(s.repeat) || 1)));
        for (let k = 0; k < rep; k += 1) {
            seq += 1;
            rows.push({
                id: 's' + String(seq),
                label: act.label + (rep > 1 ? ('(' + String(k + 1) + '/' + String(rep) + ')') : ''),
                in: act.in.slice(),
                out: act.out,
                writes: act.writes,
                owner: act.owner,
                note: act.hint,
                params: Object.assign({}, wdObj(s.params) || {}),
                when: wdObj(s.when),
            });
        }
    }
    if (!rows.length) {
        if (!problems.length) problems.push(WD_REASONS.NO_STEPS);
        return { flow: null, problems: problems };
    }
    return {
        flow: {
            id: 'tpl-' + (wdStr(t.id, WD_LIMITS.idMax) || 'draft'),
            label: wdStr(t.name, WD_LIMITS.nameMax) || WD_DEFAULT_NAME,
            hint: '个人流程模板(白名单动作合成;不执行任意脚本)',
            steps: rows, composed: true,
        },
        problems: problems,
    };
}

/* --------- 5 读数(给视图与诊断的一条取法) --------- */

/** 一条模板的读数。写步与只读步**分列**,needsConfirm 由写步条数定(不靠调用方猜)。 */
export function templateReadings(template) {
    const t = wdObj(template) || {};
    const steps = wdArr(t.steps) || [];
    const acts = steps.map((s) => WD_ACTIONS[wdStr(s.action, 40)] || null);
    const writes = acts.filter((a) => a && a.writes).length;
    const comp = composeFlow(t);
    let expanded = 0;
    for (const s of steps) expanded += Math.max(1, Math.min(WD_LIMITS.repeat, Math.floor(numOrNull(s.repeat) || 1)));
    return {
        name: wdStr(t.name, WD_LIMITS.nameMax) || WD_DEFAULT_NAME,
        steps: steps.length, expanded: expanded,
        reads: acts.filter((a) => a && !a.writes).length, writes: writes,
        branches: steps.filter((s) => wdObj(s.when)).length,
        repeats: steps.filter((s) => (numOrNull(s.repeat) || 1) > 1).length,
        actions: acts.filter((a) => !!a).map((a) => a.key),
        needsConfirm: writes > 0,
        problems: comp.problems.slice(),
        flowId: comp.flow ? comp.flow.id : '',
    };
}

/** 模板一行字(视图与诊断共用一份,不在两处各拼一次)。 */
export function templateLine(template) {
    const r = templateReadings(template);
    return r.name + '(步 ' + String(r.steps) + ' · 展开 ' + String(r.expanded) +
        ' · 写 ' + String(r.writes) + ' · 条件 ' + String(r.branches) + ')';
}

/* --------- 6 自检(每一条都跑真、假两例) --------- */

export function designerSelfCheck() {
    const problems = [];
    const push = (c, m) => { if (!c) problems.push(m); };

    /* 1 五个动作的 owner 全在运行器注册表里,且写步 owner 可写。 */
    for (const k of WD_ACTION_KEYS) {
        const a = WD_ACTIONS[k];
        const o = WF_OWNERS[a.owner];
        push(!!o, '动作 ' + k + ' 的 owner 未登记:' + a.owner);
        if (o && a.writes) push(o.writable === true, '动作 ' + k + ' 声明写但 owner 不可写');
        push(Array.isArray(a.in) && !!a.out, '动作 ' + k + ' 输入输出面不完整');
        push(a.label.length > 0 && a.hint.length > 0, '动作 ' + k + ' 缺标签或说明');
    }
    push(WD_ACTION_KEYS.length === 5, '动作表条数不是五条');
    push(WD_LIMITS.steps <= WF_STEPS_MAX, '模板步数上限超过了运行器的步骤上限');

    /* 2 认不出的动作 ⇒ 整步被丢且如实记 rejected(不静默)。 */
    const bad = normalizeTemplate({ name: 'x', steps: [{ action: 'run-shell' }] });
    push(bad.template.steps.length === 0, '认不出的动作竟进了模板');
    push(bad.rejected.some((r) => r.why === WD_REASONS.ACTION_UNKNOWN), '认不出的动作未记 action-unknown');
    push(bad.dropped === 1, '被丢的步数未如实计');

    /* 3 条件认不出 / 条件面缺名 ⇒ **整步**被丢(只丢闸 = 拆掉用户的写闸)。 */
    const gate = { action: 'notify', params: {}, repeat: 1 };
    const b1 = normalizeTemplate({ name: 'x', steps: [Object.assign({}, gate, { when: { state: 'maybe', face: 'brief' } })] });
    push(b1.template.steps.length === 0, '认不出的条件竟只丢闸不丢步');
    push(b1.rejected.some((r) => r.why === WD_REASONS.BRANCH_UNKNOWN), '认不出的条件未记 branch-unknown');
    const b2 = normalizeTemplate({ name: 'x', steps: [Object.assign({}, gate, { when: { state: 'present' } })] });
    push(b2.template.steps.length === 0, '条件缺面名竟放行');
    push(b2.rejected.some((r) => r.why === WD_REASONS.BRANCH_FACE_MISSING), '条件缺面名未记 branch-face-missing');
    const okWhen = normalizeTemplate({ name: 'x', steps: [Object.assign({}, gate, { when: { state: 'present', face: 'brief' } })] });
    push(okWhen.template.steps.length === 1 && okWhen.template.steps[0].when.face === 'brief', '合法条件被拒');

    /* 4 写步不许重复;非写步重复在区间内才收。 */
    const rw = normalizeTemplate({ name: 'x', steps: [{ action: 'notify', repeat: 2 }] });
    push(rw.rejected.some((r) => r.why === WD_REASONS.REPEAT_ON_WRITE), '写步重复未被拦');
    push(rw.template.steps[0].repeat === 1, '写步重复被拦后残留了重复组数');
    const rr = normalizeTemplate({ name: 'x', steps: [{ action: 'read-brief', repeat: 2 }] });
    push(rr.template.steps[0].repeat === 2, '非写步的合法重复未被收');
    const ro = normalizeTemplate({ name: 'x', steps: [{ action: 'read-brief', repeat: 9 }] });
    push(ro.rejected.some((r) => r.why === WD_REASONS.REPEAT_OUT_OF_RANGE), '重复越界未被拦');

    /* 5 参数:未声明的键必拒,声明过的键生效。 */
    const pu = normalizeTemplate({ name: 'x', steps: [{ action: 'notify', params: { shell: 'rm -rf /' } }] });
    push(pu.rejected.some((r) => r.why === WD_REASONS.PARAM_UNKNOWN), '未声明参数未被拦');
    push(!('shell' in pu.template.steps[0].params), '未声明参数竟进了模板');
    const pv = normalizeTemplate({ name: 'x', steps: [{ action: 'notify', params: { title: '收尾提醒' } }] });
    push(pv.template.steps[0].params.title === '收尾提醒', '声明过的参数未生效');

    /* 6 上界:步数超限最早先出并记 dropped。 */
    const many = [];
    for (let i = 0; i < WD_LIMITS.steps + 3; i += 1) many.push({ action: 'read-brief' });
    const over = normalizeTemplate({ name: 'x', steps: many });
    push(over.template.steps.length === WD_LIMITS.steps, '步数上限未生效');
    push(over.dropped === 3, '越限被挤掉的条数不对:' + String(over.dropped));
    push(over.rejected.some((r) => r.why === WD_REASONS.TOO_MANY_STEPS), '越限未记 too-many-steps');

    /* 7 拖排:越界拒、同位置不动、合法移动真的换位。 */
    const t3 = normalizeTemplate({ name: 'x', steps: [{ action: 'read-brief' }, { action: 'save-draft' }, { action: 'notify' }] }).template;
    const mv = moveStep(t3, 0, 2);
    push(mv.ok === true && mv.template.steps[2].action === 'read-brief', '合法拖排没换位');
    push(mv.template.steps.map((s) => s.action).join(',') === 'save-draft,notify,read-brief', '拖排结果不是把该步挪到该位');
    push(moveStep(t3, 0, 9).ok === false, '拖排越界未被拒');
    push(moveStep(t3, 2, 2).ok === false, '拖到原位竟算成功(会造出假的改动)');
    push(moveStep(t3, -1, 0).ok === false, '负位置未被拒');
    push(t3.steps.map((s) => s.action).join(',') === 'read-brief,save-draft,notify', '拖排改动了入参(本层必须零副作用)');

    /* 8 参数绑定与条件:越界步号必拒;不合法一律拒且不改入参。 */
    push(bindParams(t3, 9, {}).ok === false, '参数绑定步号越界未被拒');
    push(bindParams(t3, 1, { shell: 'x' }).ok === false, '绑定未声明参数未被拒');
    push(bindParams(t3, 2, { title: 'T' }).template.steps[2].params.title === 'T', '合法绑定未生效');
    push(t3.steps[2].params.title === undefined, '绑定改动了入参');
    push(setBranch(t3, 0, { state: 'present', face: 'brief' }).template.steps[0].when.face === 'brief', '设置条件未生效');
    push(setBranch(t3, 0, 'always').template.steps[0].when === null, '取消条件未生效');
    push(setBranch(t3, 0, { state: 'weird', face: 'brief' }).ok === false, '条件态认不出未被拒');
    push(setRepeat(t3, 0, 2).template.steps[0].repeat === 2, '非写步设组数未生效');
    push(setRepeat(t3, 2, 2).ok === false, '写步设组数未被拒');

    /* 9 合成:五条动作能合成可跑的流程;展开越界即拒;每步 owner 可写性过复验。 */
    const good = normalizeTemplate({ name: '活动结束流程', steps: [{ action: 'read-brief' }, { action: 'save-draft' }, { action: 'notify' }] }).template;
    const comp = composeFlow(good);
    push(comp.problems.length === 0, '合法模板合成报问题:' + comp.problems.join(','));
    push(!!comp.flow && comp.flow.steps.length === 3, '合成后的步骤数不对');
    push(comp.flow.steps.map((s) => s.owner).join(',') === 'resume-workbench,archive-draft,notify', '合成后的 owner 链不对');
    push(comp.flow.steps[1].writes === true && comp.flow.steps[0].writes === false, '合成后的写声明不对');
    push(comp.flow.id === 'tpl-' + good.id ? true : comp.flow.id.startsWith('tpl-'), '合成后的流程 id 不是模板前缀');
    const empty = composeFlow(normalizeTemplate({ name: 'x', steps: [] }).template);
    push(empty.flow === null && empty.problems.length > 0, '空模板竟合成出可跑流程');
    const eight = [];
    for (let i = 0; i < WD_LIMITS.steps; i += 1) eight.push({ action: 'read-brief', repeat: WD_LIMITS.repeat });
    const wide = composeFlow(normalizeTemplate({ name: 'x', steps: eight }).template);
    push(wide.flow === null, '展开后超过运行器上限的模板竟合成成功');
    push(wide.problems.some((p) => p === WD_REASONS.TOO_MANY_STEPS), '展开越界未记 too-many-steps');

    /* 10 台账:null 与 [] 分开;垃圾行被丢但计数如实。 */
    push(normalizeTemplates(null).readable === false, '模板台账 null 未判读不到');
    push(normalizeTemplates([]).readable === true && normalizeTemplates([]).templates.length === 0, '模板台账 [] 被误判读不到');
    const mix = normalizeTemplates([{ name: 'a', steps: [{ action: 'notify' }] }, { nope: 1 }, 7]);
    push(mix.templates.length === 1 && mix.dropped === 2, '台账垃圾行未如实计数:' + String(mix.dropped));

    /* 11 读数是分列的:写步数决定 needsConfirm,条件与重复各报各的。 */
    const rd = templateReadings(normalizeTemplate({ name: 'x', steps: [{ action: 'read-brief', repeat: 2 }, { action: 'notify', when: { state: 'present', face: 'brief' } }] }).template);
    push(rd.steps === 2 && rd.expanded === 3, '读数:步数或展开数不对');
    push(rd.writes === 1 && rd.reads === 1, '读数:写与读没有分列');
    push(rd.branches === 1 && rd.repeats === 1, '读数:条件与重复没有分列');
    push(rd.needsConfirm === true, '含写步的模板竟不要求确认');
    push(templateReadings(normalizeTemplate({ name: 'x', steps: [{ action: 'read-brief' }] }).template).needsConfirm === false, '纯只读模板竟要求确认');

    return {
        version: WD_VERSION,
        actionKeys: WD_ACTION_KEYS.slice(),
        limits: WD_LIMITS,
        branchStates: WD_BRANCH_STATES.slice(),
        reasons: Object.keys(WD_REASONS).length,
        problems: problems,
    };
}