/* ============================================================
 * config/affair-state.js — [v4.48.0 · 第六期 R6-O1 以事情为中心的手机]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   任务入口（task-entry.js）已有「任务卡→跳转」的入口聚合（v3.65.0 X1）；
 *   跨 App 定位引用（open-ref.js）已有「结果→靶心」的投递归一（v3.66.0 X2）。
 *   两者合起来能回答「这件事归哪个 App、那条结果在哪个页签」—— 但它们都是
 *   **单次**动作：点完跳转、点完打开，就结束了。用户回到桌面时什么也没留下。
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   「筹备展览」是一件持续的事：用户在群聊里约定 → 去日历排时间 → 回来查资料
 *   → 生成海报稿 → 回群聊里发链接。这条链在修前的手机里是**五段孤立的记录**：
 *   `te_ledger` 只记最近点击（且上限 80 条）、`view_state_*` 只存最后页签/查询、
 *   `life_events_v1` 只存已发生事件。全仓没有一格能表达「这件事现在进行到哪、
 *   参与者是谁、还有什么没定」。R6-O1 计划原文：用户从群聊进入日历、查资料、
 *   生成海报稿后回到同一事务，能继续下一步而非重新解释来意。
 *
 * 【三件必须分形（本仓最贵的老账）】
 *   ① **阶段转移**（用户/模型完成了一个阶段）与**动作结果**（某个 App 里的
 *      操作产物）不是同一件事：阶段是事务的骨架，动作结果是骨架上的证据。
 *      压成一格会出现「点了一次日历就说筹备已推进」—— 那是跳转，不是推进。
 *   ② **待决选择**（事务里悬而未决的事）与**普通备注**（描述性文字）处置相反：
 *      前者驱动下一幕材料与提醒，后者只是注释。压平即错读数。
 *   ③ **并行同名事务不串进度**：两件都叫「筹备展览」的事务，参与者/阶段/待决
 *      各自独立；用 label 匹配会把 A 的事写进 B 的进度。
 *
 * 【不做（计划原文）】
 *   · 不接管各 App 存储：事务只持**引用**（open-ref 的 kind/id）与交互状态，
 *     不复制源 App 正文 —— 「不复制事实所有者」铁律同源。
 *   · 不做新的万能工作台取代全部界面：事务不渲染 App 内容，只编排引用与阶段。
 *   · 不做后台轮询/不可见代理：一切转移由用户或宿主接线显式发起。
 *
 * 【存储与隔离】
 *   键 `affairs_v1` 落 chatMetadata 会话族（前缀 ^aff_ 在 config/storage.js 登记），
 *   读写口在本文件末尾唯一一组函数 —— 与 task-entry.js 同规：采集/持久化一处，
 *   判定与投影是纯函数（可对合成输入跑，不必起宿主）。
 * ============================================================ */
'use strict';
/* ---------- 词表（受控，判据按此表逐词核） ---------- */
/** 事务阶段（受控词表：不认识的一律归 unknown 并具名，不猜）。 */
export const AFF_STAGES = Object.freeze({
    PLANNING: 'planning',
    SCHEDULED: 'scheduled',
    DOING: 'doing',
    WRAPPING: 'wrapping',
    CLOSED: 'closed',
    UNKNOWN: 'unknown',
});
/** 待决选择的状态（open 与 resolved 分形；「解决」必须留证据与去向）。 */
export const AFF_DECISION = Object.freeze({
    OPEN: 'open',
    RESOLVED: 'resolved',
});
/** 事务读数四态（互不同形；absent 与 unreadable 分列，不压平）。 */
export const AFF_STATES = Object.freeze({
    ABSENT: 'absent',
    ACTIVE: 'active',
    CLOSED: 'closed',
    UNREADABLE: 'unreadable',
});
/** 归因词表（why 只许取这里的值）。 */
export const AFF_REASONS = Object.freeze({
    OK: '',
    BAD_SHAPE: 'bad-shape',
    NO_TITLE: 'no-title',
    NO_ID: 'no-id',
    STAGE_UNKNOWN: 'stage-unknown',
    STAGE_SAME: 'stage-same',
    ALREADY_CLOSED: 'already-closed',
    NOT_FOUND: 'not-found',
    NO_SOURCE: 'no-source',
    DECISION_NOT_OPEN: 'decision-not-open',
    DUP_REF: 'dup-ref',
    DUP_DECISION: 'dup-decision',
});
/** 上限（防无限增长；同 te_ledger 的上限语义）。 */
export const AFF_LIMITS = Object.freeze({
    affairs: 40,
    participants: 16,
    decisions: 12,
    actions: 60,
    refs: 24,
    refsPerAction: 4,
    title: 40,
    note: 200,
});
/* ---------- 基础归一（与 open-ref 同口径：纯空白不算 id/不算数） ---------- */
function str(v) { return String(v == null ? '' : v).trim(); }
function capStr(v, n) {
    const s = str(v);
    return s.length > n ? s.slice(0, n) : s;
}
function numOrNull(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }
function strList(v, cap) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const item of v) {
        const s = str(item);
        if (s && out.indexOf(s) < 0) out.push(s);
        if (out.length >= cap) break;
    }
    return out;
}
/** 引用归一（kind/id 一律字符串；纯空白 id 不算 —— open-ref 同口径）。 */
export function normalizeAffairRef(raw) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const idRaw = (typeof r.id === 'string') ? r.id : (typeof r.id === 'number' && Number.isFinite(r.id) ? String(r.id) : '');
    return { kind: str(r.kind), id: idRaw.trim() ? idRaw : '', label: capStr(r.label, AFF_LIMITS.title) };
}
/** 判引用同一条（kind+id 双键；label 是描述不是身份）。 */
export function sameAffairRef(a, b) {
    return str(a && a.kind) === str(b && b.kind) && str(a && a.id) === str(b && b.id);
}
/* ---------- 事务条目归一 ---------- */
function normalizeDecisions(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw.slice(0, AFF_LIMITS.decisions)) {
        const d = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
        const text = capStr(d.text, AFF_LIMITS.note);
        if (!text) continue;
        const stateRaw = str(d.state);
        out.push({
            id: str(d.id) || ('d' + out.length),
            text: text,
            state: stateRaw === AFF_DECISION.RESOLVED ? AFF_DECISION.RESOLVED : AFF_DECISION.OPEN,
            resolvedBy: capStr(d.resolvedBy, AFF_LIMITS.title) || null,
            resolvedAt: numOrNull(d.resolvedAt),
            outcome: capStr(d.outcome, AFF_LIMITS.note),
        });
    }
    return out;
}
function normalizeActions(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw.slice(0, AFF_LIMITS.actions)) {
        const a = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
        const ref = normalizeAffairRef(a.sourceRef);
        const kind = str(a.kind);
        const result = capStr(a.result, AFF_LIMITS.note);
        if (!kind || !ref.kind || !ref.id) continue; /* 没源引用的动作不记账（NO_SOURCE 预防） */
        out.push({
            id: str(a.id) || ('a' + out.length),
            kind: kind,
            sourceRef: ref,
            result: result,
            refs: normalizeRefList(a.refs, AFF_LIMITS.refsPerAction),
            at: numOrNull(a.at),
        });
    }
    return out;
}
function normalizeRefList(raw, cap) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        const ref = normalizeAffairRef(item);
        if (!ref.kind || !ref.id) continue;
        if (out.some(function (x) { return sameAffairRef(x, ref); })) continue;
        out.push(ref);
        if (out.length >= cap) break;
    }
    return out;
}
/** 把任意来源的事务收成恒定形态（缺格写 null，读者不必判 undefined）。 */
export function normalizeAffair(raw) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const stageRaw = str(r.stage);
    return {
        id: str(r.id),
        title: capStr(r.title, AFF_LIMITS.title),
        stage: Object.values(AFF_STAGES).indexOf(stageRaw) >= 0 ? stageRaw : AFF_STAGES.UNKNOWN,
        participants: strList(r.participants, AFF_LIMITS.participants),
        decisions: normalizeDecisions(r.decisions),
        actions: normalizeActions(r.actions),
        refs: normalizeRefList(r.refs, AFF_LIMITS.refs),
        note: capStr(r.note, AFF_LIMITS.note),
        createdAt: numOrNull(r.createdAt),
        updatedAt: numOrNull(r.updatedAt),
        closedAt: numOrNull(r.closedAt),
    };
}
/** 列表归一（剔除无 id/无 title 的坏条目 —— 那两条是聚合键，缺了读写都对不上）。 */
export function normalizeAffairs(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        const aff = normalizeAffair(item);
        if (!aff.id || !aff.title) continue;
        out.push(aff);
    }
    return out;
}
/** 阶段 → 事务态投影（closed 是唯一终结态；unknown 如实报，不猜）。 */
export function affairStateOf(aff) {
    const stage = str(aff && aff.stage);
    if (stage === AFF_STAGES.CLOSED) return AFF_STATES.CLOSED;
    if (stage === AFF_STAGES.PLANNING || stage === AFF_STAGES.SCHEDULED
        || stage === AFF_STAGES.DOING || stage === AFF_STAGES.WRAPPING) return AFF_STATES.ACTIVE;
    return AFF_STATES.ABSENT;
}
/* ---------- 判定层（纯函数；每一步都返回 {ok, why, affair} 三格，不抛不猜） ---------- */
/** 在内存列表上找事务（按 id 精确匹配 —— 同名事务不串，靠 id 不靠 label）。 */
export function findAffair(list, id) {
    const target = str(id);
    if (!target) return null;
    const arr = Array.isArray(list) ? list : [];
    for (const item of arr) {
        if (str(item && item.id) === target) return item;
    }
    return null;
}
/** 建新事务（title 必填、stage 必须 ∈ 表；返回新列表与事务）。 */
export function createAffair(list, raw, now) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const title = capStr(r.title, AFF_LIMITS.title);
    if (!title) return { ok: false, why: AFF_REASONS.NO_TITLE, affair: null, list: list || [] };
    const stageRaw = str(r.stage);
    const stage = Object.values(AFF_STAGES).indexOf(stageRaw) >= 0 ? stageRaw : AFF_STAGES.PLANNING;
    const at = numOrNull(now);
    const aff = {
        id: str(r.id) || ('aff_' + (at != null ? at : 0).toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36)),
        title: title,
        stage: stage,
        participants: strList(r.participants, AFF_LIMITS.participants),
        decisions: [],
        actions: [],
        refs: normalizeRefList(r.refs, AFF_LIMITS.refs),
        note: capStr(r.note, AFF_LIMITS.note),
        createdAt: at,
        updatedAt: at,
        closedAt: null,
    };
    const arr = Array.isArray(list) ? list.slice() : [];
    if (findAffair(arr, aff.id)) return { ok: false, why: AFF_REASONS.NO_ID, affair: null, list: arr };
    arr.push(aff);
    return { ok: true, why: AFF_REASONS.OK, affair: aff, list: trimAffairs(arr) };
}
/** 列表上限裁剪（超出 40 条时最老的 closed 先回收；活跃的永不回收）。 */
export function trimAffairs(list) {
    const arr = Array.isArray(list) ? list.slice() : [];
    if (arr.length <= AFF_LIMITS.affairs) return arr;
    let excess = arr.length - AFF_LIMITS.affairs;
    for (let i = 0; i < arr.length && excess > 0; i++) {
        if (affairStateOf(arr[i]) === AFF_STATES.CLOSED) { arr.splice(i, 1); excess -= 1; i -= 1; }
    }
    return arr;
}
/** 阶段转移（closed 是终结态；转移必须留 updatedAt）。 */
export function transitionAffairStage(list, id, newStage, now) {
    const aff = findAffair(list, id);
    if (!aff) return { ok: false, why: AFF_REASONS.NOT_FOUND, affair: null, list: list || [] };
    const stageRaw = str(newStage);
    if (Object.values(AFF_STAGES).indexOf(stageRaw) < 0) {
        return { ok: false, why: AFF_REASONS.STAGE_UNKNOWN, affair: aff, list: list };
    }
    if (aff.stage === AFF_STAGES.CLOSED && stageRaw !== AFF_STAGES.CLOSED) {
        return { ok: false, why: AFF_REASONS.ALREADY_CLOSED, affair: aff, list: list };
    }
    if (aff.stage === stageRaw) {
        return { ok: false, why: AFF_REASONS.STAGE_SAME, affair: aff, list: list };
    }
    const at = numOrNull(now);
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.indexOf(aff);
    const updated = Object.assign({}, aff, {
        stage: stageRaw,
        updatedAt: at != null ? at : aff.updatedAt,
        closedAt: stageRaw === AFF_STAGES.CLOSED ? (at != null ? at : aff.updatedAt) : aff.closedAt,
    });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: AFF_REASONS.OK, affair: updated, list: next };
}
/** 挂动作结果（源引用必填 —— 没证据说「谁做的」就不记账；去重按 sourceRef）。 */
export function appendAffairAction(list, id, action, now) {
    const aff = findAffair(list, id);
    if (!aff) return { ok: false, why: AFF_REASONS.NOT_FOUND, affair: null, list: list || [] };
    const a = (action && typeof action === 'object' && !Array.isArray(action)) ? action : null;
    if (!a) return { ok: false, why: AFF_REASONS.BAD_SHAPE, affair: aff, list: list };
    const ref = normalizeAffairRef(a.sourceRef);
    if (!ref.kind || !ref.id) return { ok: false, why: AFF_REASONS.NO_SOURCE, affair: aff, list: list };
    if (aff.actions.some(function (x) { return sameAffairRef(x.sourceRef, ref); })) {
        return { ok: false, why: AFF_REASONS.DUP_REF, affair: aff, list: list };
    }
    const at = numOrNull(now);
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.indexOf(aff);
    const actions = aff.actions.concat([{
        id: str(a.id) || ('a' + aff.actions.length),
        kind: str(a.kind),
        sourceRef: ref,
        result: capStr(a.result, AFF_LIMITS.note),
        refs: normalizeRefList(a.refs, AFF_LIMITS.refsPerAction),
        at: at,
    }]).slice(-AFF_LIMITS.actions);
    const updated = Object.assign({}, aff, { actions: actions, updatedAt: at != null ? at : aff.updatedAt });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: AFF_REASONS.OK, affair: updated, list: next };
}
/** 挂待决选择（同文本去重；open 态才驱动下一幕）。 */
export function appendAffairDecision(list, id, text, now) {
    const aff = findAffair(list, id);
    if (!aff) return { ok: false, why: AFF_REASONS.NOT_FOUND, affair: null, list: list || [] };
    const t = capStr(text, AFF_LIMITS.note);
    if (!t) return { ok: false, why: AFF_REASONS.BAD_SHAPE, affair: aff, list: list };
    if (aff.decisions.some(function (d) { return d.text === t && d.state === AFF_DECISION.OPEN; })) {
        return { ok: false, why: AFF_REASONS.DUP_DECISION, affair: aff, list: list };
    }
    const at = numOrNull(now);
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.indexOf(aff);
    const decisions = aff.decisions.concat([{
        id: 'd' + aff.decisions.length,
        text: t,
        state: AFF_DECISION.OPEN,
        resolvedBy: null,
        resolvedAt: null,
        outcome: '',
    }]).slice(0, AFF_LIMITS.decisions);
    const updated = Object.assign({}, aff, { decisions: decisions, updatedAt: at != null ? at : aff.updatedAt });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: AFF_REASONS.OK, affair: updated, list: next };
}
/** 解决待决选择（必须留解决人与结果；open 态才可解决）。 */
export function resolveAffairDecision(list, id, decisionText, resolvedBy, outcome, now) {
    const aff = findAffair(list, id);
    if (!aff) return { ok: false, why: AFF_REASONS.NOT_FOUND, affair: null, list: list || [] };
    const t = capStr(decisionText, AFF_LIMITS.note);
    const target = aff.decisions.find(function (d) { return d.text === t; });
    if (!target || target.state !== AFF_DECISION.OPEN) {
        return { ok: false, why: AFF_REASONS.DECISION_NOT_OPEN, affair: aff, list: list };
    }
    const at = numOrNull(now);
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.indexOf(aff);
    const decisions = aff.decisions.map(function (d) {
        return d === target ? Object.assign({}, d, {
            state: AFF_DECISION.RESOLVED,
            resolvedBy: capStr(resolvedBy, AFF_LIMITS.title) || null,
            resolvedAt: at,
            outcome: capStr(outcome, AFF_LIMITS.note),
        }) : d;
    });
    const updated = Object.assign({}, aff, { decisions: decisions, updatedAt: at != null ? at : aff.updatedAt });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: AFF_REASONS.OK, affair: updated, list: next };
}
/** 给事务追加参与者（去重）。 */
export function addAffairParticipants(list, id, names) {
    const aff = findAffair(list, id);
    if (!aff) return { ok: false, why: AFF_REASONS.NOT_FOUND, affair: null, list: list || [] };
    const add = strList(names, AFF_LIMITS.participants);
    if (!add.length) return { ok: false, why: AFF_REASONS.BAD_SHAPE, affair: aff, list: list };
    const merged = aff.participants.concat(add).filter(function (v, i, s) { return s.indexOf(v) === i; }).slice(0, AFF_LIMITS.participants);
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.indexOf(aff);
    const updated = Object.assign({}, aff, { participants: merged });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: AFF_REASONS.OK, affair: updated, list: next };
}
/** 给事务挂文档引用（kind+id 去重）。 */
export function attachAffairRef(list, id, ref) {
    const aff = findAffair(list, id);
    if (!aff) return { ok: false, why: AFF_REASONS.NOT_FOUND, affair: null, list: list || [] };
    const r = normalizeAffairRef(ref);
    if (!r.kind || !r.id) return { ok: false, why: AFF_REASONS.BAD_SHAPE, affair: aff, list: list };
    if (aff.refs.some(function (x) { return sameAffairRef(x, r); })) {
        return { ok: false, why: AFF_REASONS.DUP_REF, affair: aff, list: list };
    }
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.indexOf(aff);
    const refs = aff.refs.concat([r]).slice(0, AFF_LIMITS.refs);
    const updated = Object.assign({}, aff, { refs: refs });
    const next = arr.slice();
    next[idx] = updated;
    return { ok: true, why: AFF_REASONS.OK, affair: updated, list: next };
}
/* ---------- 投影层 ---------- */
/** 进行中事务列表（active 优先，按 updatedAt 倒序 —— 「最近在做的事」在前）。 */
export function activeAffairs(list) {
    const arr = normalizeAffairs(list);
    return arr.filter(function (a) { return affairStateOf(a) === AFF_STATES.ACTIVE; })
        .sort(function (x, y) { return (y.updatedAt || 0) - (x.updatedAt || 0); });
}
/** 查询投影：一件事的读数句（阶段/参与者/待决/最近动作，各说各的、不拼结论）。 */
export function affairSummaryLine(aff) {
    const a = normalizeAffair(aff);
    if (!a.id || !a.title) return '这条事务读不出来（形态不完整）';
    const state = affairStateOf(a);
    if (state === AFF_STATES.CLOSED) return a.title + '：已了结。';
    if (state === AFF_STATES.ABSENT) return a.title + '：阶段不明（' + a.stage + '），如实报，不猜。';
    const openDecisions = a.decisions.filter(function (d) { return d.state === AFF_DECISION.OPEN; });
    const parts = [a.title + '（' + stageLabelOf(a.stage) + '）'];
    if (a.participants.length) parts.push('参与者：' + a.participants.join('、'));
    if (openDecisions.length) parts.push('待决：' + openDecisions.map(function (d) { return d.text; }).join('；'));
    /* ★ 优先级坑（本版自查抓到）：`'最近动作：' + a.result || a.label` 里 `+` 比 `||` 紧，
     *   于是 result 为空时得到的是真值串「最近动作：」，回退分支**永远走不到** ——
     *   界面上会出现一条只有标题没有内容的动作行（不报错、只错读数）。必须显式括号。 */
    if (a.actions.length) {
        const last = a.actions[a.actions.length - 1];
        const desc = last.result || last.sourceRef.label || last.sourceRef.id;
        parts.push('最近动作：' + desc);
    }
    return parts.join('。') + '。';
}
function stageLabelOf(stage) {
    const map = {
        planning: '在商议', scheduled: '已排期', doing: '进行中', wrapping: '收尾中',
    };
    return map[stage] || stage;
}
/** 投影到「本幕材料」：给 R6-O2/O3 与记忆桥消费（引用不复制正文）。 */
export function affairMaterial(aff) {
    const a = normalizeAffair(aff);
    const openDecisions = a.decisions.filter(function (d) { return d.state === AFF_DECISION.OPEN; });
    return {
        id: a.id,
        title: a.title,
        stage: a.stage,
        stageLabel: stageLabelOf(a.stage),
        participants: a.participants.slice(),
        openDecisions: openDecisions.map(function (d) { return { id: d.id, text: d.text }; }),
        lastAction: a.actions.length ? a.actions[a.actions.length - 1] : null,
        refs: a.refs.slice(),
        state: affairStateOf(a),
    };
}
/** 自检十项（判据按词表与形态核；本件零 DOM 零存储，故自检只验形态与词表一致性）。 */
export function affairSelfCheck() {
    const problems = [];
    const stageWords = Object.values(AFF_STAGES);
    if (stageWords.length !== new Set(stageWords).size) problems.push('阶段词表有重复');
    if (Object.values(AFF_STATES).length !== 4) problems.push('事务态词表不是四格');
    if (Object.keys(AFF_REASONS).length !== 12) problems.push('归因词表条数不对');
    if (AFF_LIMITS.affairs < 10 || AFF_LIMITS.affairs > 100) problems.push('事务上限不在合理区间');
    /* 归一往返：随机 fixture 过一遍 normalize 再读数，应无信息丢且不抛 */
    const probe = normalizeAffair({ id: 'p1', title: '  筹备展览  ', stage: 'doing', participants: [' 阿明 ', ' 阿明', '小红'] });
    if (probe.title !== '筹备展览') problems.push('归一不去空白');
    if (probe.participants.join(',') !== '阿明,小红') problems.push('参与者不去重');
    if (affairStateOf(probe) !== AFF_STATES.ACTIVE) problems.push('doing 应投影 active');
    const bad = normalizeAffair({ id: 'p2', title: 'x', stage: 'nope' });
    if (bad.stage !== AFF_STAGES.UNKNOWN) problems.push('不认识的阶段必须归 unknown');
    if (affairStateOf(bad) !== AFF_STATES.ABSENT) problems.push('unknown 不应投影 active');
    const closed = normalizeAffair({ id: 'p3', title: 'x', stage: 'closed' });
    if (affairStateOf(closed) !== AFF_STATES.CLOSED) problems.push('closed 投影错');
    const closedTr = transitionAffairStage([{ id: 'p3', title: 'x', stage: 'closed', participants: [], decisions: [], actions: [], refs: [] }], 'p3', 'doing', 1);
    if (closedTr.ok) problems.push('closed 是终结态，不得再转移');
    if (normalizeAffairs([{ id: '', title: 'y' }, { id: 'q', title: '' }]).length !== 0) problems.push('无 id/无 title 的坏条目应被剔除');
    return { ok: problems.length === 0, problems: problems };
}
/* ---------- 存储口（唯一一组；与 task-entry.js 同规） ---------- */
export const AFF_KEY = 'affairs_v1';
/** 读（不存在的键返回 []，不抛）。 */
export function readAffairs(storage) {
    try {
        const raw = storage && typeof storage.get === 'function' ? storage.get(AFF_KEY, false) : null;
        if (!raw) return [];
        const arr = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        return normalizeAffairs(arr);
    } catch (_e) { return []; }
}
/** 写（fail-safe：写不进不抛，返回 false）。 */
export function writeAffairs(storage, list) {
    try {
        const arr = normalizeAffairs(list);
        if (storage && typeof storage.set === 'function') {
            storage.set(AFF_KEY, JSON.stringify(arr), false);
            return true;
        }
        return false;
    } catch (_e) { return false; }
}
