/* ============================================================
 * config/phone-fact-contract.js — [v3.97.0 · R3-X1] 上游**手机事实桥**（phoneFactReceipt）的消费侧单一真源
 * ------------------------------------------------------------
 * 【治的欠债（修前实测，不是推测）】
 *   上游 lonsha-memory-plugin 在 **v3.314.0（M-X6）** 交付了手机事实桥 2.0：
 *   生命周期四态（accepted / rejected / pending / revoked）、双向回执
 *   （`receiptFor` 恒定九键 + 十条穷尽理由）、编辑/删除/撤回的换代与撤回计划
 *   （`planEdit`：edit ⇒ supersede、delete/retract ⇒ withdraw）、桥能力三态
 *   （`probeCounterpart`：absent / legacy / capable）。
 *   而本仓实测（`grep -RIn 'phoneFactReceipt|LonShaPhoneFact|phone-fact-bridge' apps config`）
 *   **零命中** —— 上游把「手机侧只知道送出去了、不知道记忆侧收没收」这条单向化欠债做成了
 *   可显示的四态回执，下游**一个消费者都没有**。这是本仓「建好不消费」的第十一例，
 *   与投影面 / 注入面 / 证据面 / 检查点面**同一族**。
 *
 * 【本模块的职责（只搬、不重算）】
 *   · 只读：只调上游**只读/纯算**出口（`handleFact` / `handleBatch` / `receiptFor` /
 *     `planEdit` / `bridgeState`），绝不替上游落账、不改任何一端的状态；
 *   · 不抛：插件不在场 / 旧版无此出口 / 调用抛错 / 返回值畸形，一律降级为归因；
 *   · 不猜：**不在这里重算生命周期四态** —— 那是上游 `lifecycleOf` 的唯一口径，
 *     下游再实现一份必然漂移（本仓「同一口径只许一份实现」）。
 *     本模块只把上游读数**归一成恒定键面**，供 UI 直接渲染。
 *
 * 【四态（本仓最贵的老账：缺席与空必须不同形）】
 *   · 插件不在场（未装 / 未加载）           ⇒ `engine-absent`（等装插件）
 *   · 插件在场但没有事实桥出口（旧版插件）   ⇒ `face-absent`（等上游升级）
 *   · 出口在但调用抛错                      ⇒ `unusable`（本机读不出）
 *   · 读到且无任何事实行                    ⇒ `empty`（**真读数**：送去的事实为零）
 *   · 读到事实行                            ⇒ `ok`
 *   压平任何两态都会造出处置相反的两种处境长得一模一样的读数。
 *
 * 【为什么回执四态**照原样搬运**而不折成本模块态词】
 *   上游 `RECEIPT_REASONS` 是十条穷尽词表，且 `pending`（等用户确认）与 `rejected`
 *   （明确未进账）**刻意不同形**（上游档头逐字点名的本仓老账）。下游若把它们折成
 *   「未成功 / 成功」两态，就把「还悬着」读成了「被拒了」——那正是上游这一面存在的理由。
 *   故本模块只搬 `state` / `reason` / `nextStep`，不替上游下结论。
 * ============================================================ */
'use strict';

/** 上游插件全局名（与 `config/checkpoint-content-contract.js` 读的是同一个；此处唯一收口） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';

/** 上游事实桥模块的全局名（浏览器侧；无头环境读不到即缺席） */
const LONSHA_PHONE_BRIDGE_GLOBAL = 'LonShaPhoneFactBridge';

/** 面状态（本模块自己的五态；回执的失败形态搬运上游 reason，不折进来） */
export const PHONE_FACT_FACE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 桥能力三态（与上游 `BRIDGE_STATES` 逐字一致；不许压成一态） */
export const PHONE_FACT_BRIDGE_STATES = Object.freeze(['absent', 'legacy', 'capable']);

/** 生命周期四态（与上游 `LIFECYCLE_STATES` 逐字一致；下游按名渲染） */
export const PHONE_FACT_LIFECYCLE = Object.freeze(['accepted', 'rejected', 'pending', 'revoked']);

/** 三类事件（与上游 `EVENT_CLASSES` 逐字一致） */
export const PHONE_FACT_EVENT_CLASSES = Object.freeze(['finance', 'calendar', 'story']);

/** 编辑三动作（与上游 `EDIT_ACTIONS` 逐字一致） */
export const PHONE_FACT_EDIT_ACTIONS = Object.freeze(['edit', 'delete', 'retract']);

/** 四态 → 一句话文案（**唯一实现**；每条都说清「该谁动手」——本面存在的理由） */
const LIFECYCLE_TEXT = Object.freeze({
    accepted: '已进入记忆（可被召回）',
    rejected: '没有进入记忆（明确未入账）',
    pending: '等待你确认（**还悬着**，不是被拒）',
    revoked: '已撤回（不再作为现状召回）'
});

/** 上游出口名（读出面唯一清单；改这里即两边同时对齐） */
const PLUGIN_FACE_METHODS = Object.freeze([
    'phoneFactBridgeHandle', 'phoneFactBridgeBatch', 'phoneFactBridgeReceipt',
    'phoneFactBridgePlanEdit', 'phoneFactBridgeState'
]);

/** 宿主窗口（注入优先，回落全局；与 config/story-clock.js 的探针同规格） */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}

/** 安全取上游插件实例（宿主怪 getter 一律降级成 null，绝不外抛） */
function pluginOf(win) {
    try {
        const w = resolveWin(win);
        if (!w) return null;
        const p = w[LONSHA_PLUGIN_GLOBAL];
        return (p && typeof p === 'object') ? p : null;
    } catch (_e) { return null; }
}

/**
 * 安全取事实桥模块本体（浏览器侧 `window.LonShaPhoneFactBridge`）。
 *   为什么两处都试：上游 v3.314.0 自伤留痕写明「首版尾部写 `? window : this`，
 *   在 Node 下挂到 exports 而非 globalThis」——修后**双挂**（module.exports + globalThis
 *   + window）。故下游按 globalThis 读到的就是同一个 api；插件实例上的出口是**转发**，
 *   两条路径指向同一实现（本模块优先走插件的转发口，模块本体只作 `describe` 兜底）。
 */
function bridgeModuleOf(win) {
    try {
        const w = resolveWin(win);
        if (!w) return null;
        const b = w[LONSHA_PHONE_BRIDGE_GLOBAL];
        return (b && typeof b === 'object') ? b : null;
    } catch (_e) { return null; }
}

/** 缺席形态的恒定键面（读者不必再判 undefined；`state`/`reason` 之外的键都有确定零值） */
function emptyFace(state, reason) {
    return {
        state, reason,
        rows: [], counts: { accepted: 0, rejected: 0, pending: 0, revoked: 0 },
        byState: {}, byReason: {},
        bridgeState: '', bridgeDetail: '',
        lifecycleStates: PHONE_FACT_LIFECYCLE.slice(),
        receiptReasons: [], eventClasses: PHONE_FACT_EVENT_CLASSES.slice(),
        pendingDistinctFromRejected: false,
        writesNothing: true
    };
}

/** 出口是否齐备（旧版判定只看**方法在不在**，不看版本号：版本号可能缺，能力才是本身） */
function hasFace(plugin) {
    if (!plugin || typeof plugin !== 'object') return false;
    for (const m of PLUGIN_FACE_METHODS) if (typeof plugin[m] === 'function') return true;
    return false;
}

/**
 * 读手机事实桥的**能力自述面**（只读，绝不写）。
 *
 * @param {object} [win] 显式注入 window（无头测试用），不传即取全局
 * @returns {{ state:string, reason:string, bridgeState:string, bridgeDetail:string,
 *             lifecycleStates:string[], receiptReasons:string[], eventClasses:string[],
 *             pendingDistinctFromRejected:boolean, writesNothing:boolean }}
 *   state ∈ PHONE_FACT_FACE_STATES
 */
export function readPhoneFactFace(win) {
    try {
        const plugin = pluginOf(win);
        if (!plugin || !hasFace(plugin)) {
            /* 插件本体不在场 ⇒ 与「模块在、出口缺」不同形（前者等装插件、后者等升级）。 */
            const mod = bridgeModuleOf(win);
            if (!mod) return emptyFace(PHONE_FACT_FACE_STATES.ENGINE_ABSENT, 'plugin-absent');
            return emptyFace(PHONE_FACT_FACE_STATES.FACE_ABSENT, 'plugin-face-absent');
        }
        let desc = null;
        try { desc = (typeof plugin.phoneFactBridgeDescribe === 'function') ? plugin.phoneFactBridgeDescribe() : null; }
        catch (_e) { desc = null; }
        let st = null;
        try { st = (typeof plugin.phoneFactBridgeState === 'function') ? plugin.phoneFactBridgeState(bridgeModuleOf(win)) : null; }
        catch (_e) { st = null; }
        const lifecycleStates = (desc && Array.isArray(desc.lifecycleStates) && desc.lifecycleStates.length)
            ? desc.lifecycleStates.slice() : PHONE_FACT_LIFECYCLE.slice();
        const receiptReasons = (desc && Array.isArray(desc.receiptReasons)) ? desc.receiptReasons.slice() : [];
        const eventClasses = (desc && Array.isArray(desc.eventClasses) && desc.eventClasses.length)
            ? desc.eventClasses.slice() : PHONE_FACT_EVENT_CLASSES.slice();
        return {
            state: PHONE_FACT_FACE_STATES.OK, reason: 'ok',
            rows: [], counts: { accepted: 0, rejected: 0, pending: 0, revoked: 0 },
            byState: {}, byReason: {},
            bridgeState: String((st && st.state) || ''),
            bridgeDetail: String((st && st.detail) || ''),
            lifecycleStates, receiptReasons, eventClasses,
            /* ★ pending 与 rejected 不同形（上游自述面直接转发；不在此重算）。 */
            pendingDistinctFromRejected: !!(desc && desc.pendingDistinctFromRejected === true),
            writesNothing: true
        };
    } catch (_e) {
        return emptyFace(PHONE_FACT_FACE_STATES.UNUSABLE, 'thrown');
    }
}

/**
 * 送一条手机事实给上游桥（**只算不写**：上游 `handleFact` 是纯函数，落账由 owner 侧走既有门）。
 *
 * 【为什么返回恒定键面】读者不该按键在不在猜处境（本仓「对象键面随路径变」的老账）。
 *   失败路径一律给 `lifecycle:null` / `receipt:null`，并以 `state` + `reason` 归因。
 *
 * 【为什么不在这里重算四态】上游 `lifecycleOf` 是唯一真源；下游再算一份就是
 *   同一口径的第二份实现（而两份必然在某一次改动后分叉，且分叉是无声的）。
 *
 * @param {object} [win] 显式注入 window
 * @param {object} fact 手机事实（上游同栏：eventId / rootEventId / source / status / …）
 * @param {object} [ctx] 桥上下文（userDecision / revoked / editAction / chatId / …）
 * @returns {{ state:string, reason:string, eventClass:string, classKnown:boolean,
 *             guarded:boolean, guard:string, lifecycle:object|null, receipt:object|null,
 *             plan:object|null, notes:string[] }}
 */
export function readPhoneFactReceipt(win, fact, ctx) {
    const base = {
        state: PHONE_FACT_FACE_STATES.UNUSABLE, reason: 'unknown',
        eventClass: 'unknown', classKnown: false, guarded: false, guard: '',
        lifecycle: null, receipt: null, plan: null, notes: []
    };
    try {
        const plugin = pluginOf(win);
        if (!plugin || typeof plugin.phoneFactBridgeHandle !== 'function') {
            return Object.assign({}, base, {
                state: PHONE_FACT_FACE_STATES.ENGINE_ABSENT, reason: 'plugin-absent',
                notes: ['上游事实桥出口不在场（等装记忆插件 v3.314+）—— **不是**「这条没入账」']
            });
        }
        const r = plugin.phoneFactBridgeHandle(fact || {}, ctx || {});
        if (!r || typeof r !== 'object') {
            return Object.assign({}, base, { reason: 'malformed' });
        }
        /* 上游模块缺席时给 `ok:false` + `state:'absent'`；如实搬运，不当作「被拒」。 */
        if (r.ok === false) {
            return Object.assign({}, base, {
                state: PHONE_FACT_FACE_STATES.ENGINE_ABSENT,
                reason: String(r.reason || 'module-absent'),
                notes: Array.isArray(r.notes) ? r.notes.slice() : []
            });
        }
        const lc = (r.lifecycle && typeof r.lifecycle === 'object') ? r.lifecycle : null;
        return {
            state: PHONE_FACT_FACE_STATES.OK, reason: 'ok',
            eventClass: String(r.eventClass || 'unknown'),
            classKnown: r.classKnown === true,
            guarded: r.guarded === true,
            guard: String(r.guard || ''),
            lifecycle: lc,
            receipt: (r.receipt && typeof r.receipt === 'object') ? r.receipt : null,
            plan: (r.plan && typeof r.plan === 'object') ? r.plan : null,
            notes: Array.isArray(r.notes) ? r.notes.slice() : []
        };
    } catch (_e) {
        return Object.assign({}, base, { reason: 'thrown' });
    }
}

/**
 * 批量送事实（上游 `handleBatch` 的转发；批内去重与单条同函，本模块不自写一份）。
 *
 * @returns {{ state:string, reason:string, rows:Array, counts:object, byState:object,
 *             byReason:object, measurable:boolean, writesNothing:boolean }}
 */
export function readPhoneFactBatch(win, facts, ctx) {
    const empty = {
        state: PHONE_FACT_FACE_STATES.UNUSABLE, reason: 'unknown',
        rows: [], counts: { accepted: 0, rejected: 0, pending: 0, revoked: 0 },
        byState: {}, byReason: {}, measurable: false, writesNothing: true
    };
    try {
        const plugin = pluginOf(win);
        if (!plugin || typeof plugin.phoneFactBridgeBatch !== 'function') {
            return Object.assign({}, empty, {
                state: PHONE_FACT_FACE_STATES.ENGINE_ABSENT, reason: 'plugin-absent'
            });
        }
        const r = plugin.phoneFactBridgeBatch(Array.isArray(facts) ? facts : [], ctx || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { reason: 'malformed' });
        if (r.ok === false) {
            return Object.assign({}, empty, {
                state: PHONE_FACT_FACE_STATES.ENGINE_ABSENT, reason: String(r.reason || 'module-absent')
            });
        }
        const rows = Array.isArray(r.rows) ? r.rows : [];
        const counts = {
            accepted: Number(r.accepted) || 0, rejected: Number(r.rejected) || 0,
            pending: Number(r.pending) || 0, revoked: Number(r.revoked) || 0
        };
        const state = rows.length ? PHONE_FACT_FACE_STATES.OK : PHONE_FACT_FACE_STATES.EMPTY;
        return {
            state, reason: rows.length ? 'ok' : 'no-facts',
            rows,
            counts,
            byState: (r.byState && typeof r.byState === 'object') ? r.byState : {},
            byReason: (r.byReason && typeof r.byReason === 'object') ? r.byReason : {},
            /* 空批与「有但全被挡」不同形：空批 rows 为空数组（真读数），不是「模块读不到」。 */
            measurable: r.measurable !== false,
            writesNothing: true
        };
    } catch (_e) {
        return Object.assign({}, empty, { reason: 'thrown' });
    }
}

/**
 * 编辑 / 删除 / 撤回 ⇒ 上游换代或撤回**计划**（只算不写，交 owner 落笔）。
 *
 * @param {'edit'|'delete'|'retract'} action
 * @param {object} fact 待改的事实（需 eventId / rootEventId）
 * @returns {{ state:string, reason:string, effect:string, ok:boolean, steps:string[] }}
 */
export function readPhoneFactPlanEdit(win, action, fact) {
    const base = { state: PHONE_FACT_FACE_STATES.UNUSABLE, reason: 'unknown', effect: '', ok: false, steps: [] };
    try {
        const plugin = pluginOf(win);
        if (!plugin || typeof plugin.phoneFactBridgePlanEdit !== 'function') {
            return Object.assign({}, base, {
                state: PHONE_FACT_FACE_STATES.ENGINE_ABSENT, reason: 'plugin-absent'
            });
        }
        const r = plugin.phoneFactBridgePlanEdit(action, fact || {});
        if (!r || typeof r !== 'object') return Object.assign({}, base, { reason: 'malformed' });
        return {
            state: PHONE_FACT_FACE_STATES.OK, reason: 'ok',
            effect: String(r.effect || ''),
            ok: r.ok === true,
            steps: Array.isArray(r.steps) ? r.steps.slice() : []
        };
    } catch (_e) {
        return Object.assign({}, base, { reason: 'thrown' });
    }
}

/** 三类事件的来源名（与上游 `DEFAULT_CLASS_HINT` 逐字对上；对不上上游如实报 unknown）。 */
const SOURCE_OF_CLASS = Object.freeze({
    finance: 'finance-confirmed', calendar: 'calendar', story: 'story-event'
});

/**
 * 装配一条手机事实（**装配点唯一**：三类来源共用同一支笔）。
 *   `source` 名必须与上游 `DEFAULT_CLASS_HINT` 逐字对上 —— 对不上时上游会如实报
 *   `classKnown:false`（**不按默认类收下**），故这里不写任何兜底类名。
 */
export function assemblePhoneFact(cls, payload) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const source = SOURCE_OF_CLASS[String(cls)] || String(cls || '');
    const fact = {
        eventId: String(p.eventId || ''),
        rootEventId: String(p.rootEventId || p.eventId || ''),
        source,
        status: String(p.status || ''),
        visibility: String(p.visibility || ''),
        summary: String(p.summary || '')
    };
    if (typeof p.amount === 'number' && Number.isFinite(p.amount)) fact.amount = p.amount;
    if (p.currency) fact.currency = String(p.currency);
    return fact;
}

/**
 * 送一条手机事件并取回可显示回执（**装配 + 转发**两步，一步到位）。
 *
 * 【为什么本模块直接有这一口，而不是只留 `readPhoneFactReceipt`】宿主（`index.js`）
 *   需要在**任意 App 未打开**时也能取回执（用户可能先开旅行记账提交、再没开过记忆 App）。
 *   若这一口挂在记忆 App 实例上，就要求「记忆 App 先被打开过」—— 那正是 v3.96.0 刚治过
 *   的「有效装配依赖是否打开过」（R3-O6）同族形态。
 *
 * @param {object} [win] 显式注入 window
 * @param {'finance'|'calendar'|'story'} cls
 * @param {object} payload 见 `assemblePhoneFact` / 上游同栏
 * @param {object} [ctx] { userDecision?, revoked?, editAction?, chatId? }
 */
export function sendPhoneEvent(win, cls, payload, ctx) {
    return readPhoneFactReceipt(win, assemblePhoneFact(cls, payload), ctx);
}

/** 生命周期四态的一句话文案（唯一实现；供视图念出） */
export function phoneFactLifecycleText(state) {
    const s = String(state || '');
    return LIFECYCLE_TEXT[s] || ('未知状态（' + s + '）—— 不猜它是入账还是被拒');
}

/** 面状态的一句话归因（唯一实现；供诊断面念出） */
export function phoneFactFaceLine(face) {
    const f = (face && typeof face === 'object') ? face : emptyFace(PHONE_FACT_FACE_STATES.ENGINE_ABSENT, 'plugin-absent');
    switch (f.state) {
        case PHONE_FACT_FACE_STATES.OK:
            return '手机事实桥就绪（生命周期 ' + f.lifecycleStates.length + ' 态'
                + (!f.pendingDistinctFromRejected ? ' · ⚠️ pending 与 rejected 同形' : '')
                + '）' + (f.receiptReasons.length ? ' · 回执理由 ' + f.receiptReasons.length + ' 条' : '')
                + (f.bridgeState ? ' · 桥 ' + f.bridgeState : '');
        case PHONE_FACT_FACE_STATES.EMPTY:
            return '送去的事实为零（**真读数**：桥读到了，批内没有行）—— 不是「读不到」';
        case PHONE_FACT_FACE_STATES.FACE_ABSENT:
            return '本版插件没有事实桥出口（等上游升级）—— 这不是「没有事实」';
        case PHONE_FACT_FACE_STATES.UNUSABLE:
            return '事实桥读不出（' + String(f.reason || 'unavailable') + '）—— 这不是「没有事实」';
        case PHONE_FACT_FACE_STATES.ENGINE_ABSENT:
        default:
            return '记忆插件不在场 —— **不是**「这条没入账」（两者处置相反）';
    }
}

export default {
    LONSHA_PLUGIN_GLOBAL,
    LONSHA_PHONE_BRIDGE_GLOBAL,
    PHONE_FACT_FACE_STATES,
    PHONE_FACT_BRIDGE_STATES,
    PHONE_FACT_LIFECYCLE,
    PHONE_FACT_EVENT_CLASSES,
    PHONE_FACT_EDIT_ACTIONS,
    readPhoneFactFace,
    readPhoneFactReceipt,
    readPhoneFactBatch,
    readPhoneFactPlanEdit,
    assemblePhoneFact,
    sendPhoneEvent,
    phoneFactLifecycleText,
    phoneFactFaceLine
};