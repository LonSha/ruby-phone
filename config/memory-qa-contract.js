/* ============================================================
 * config/memory-qa-contract.js — [v3.97.0 · R3-X2] 上游**往事问答**（memoryQaAnswer）与
 *   **记忆工具信封**（memoryToolsEnvelope）的消费侧单一真源
 * ------------------------------------------------------------
 * 【治的欠债（修前实测，不是推测）】
 *   上游 lonsha-memory-plugin 在 **v3.322.0（B 包 · M3-X1）** 交付了带证据的自然语言问答：
 *   `askMemoryQuestion(question, opts)` 返回**恒定 15 键**（version / question / intents /
 *   actor / answer[] / gaps[] / refs[] / plans[] / masked / truncated / resourced / total /
 *   knownActors / reason / writesNothing），每句 answer 带 kind / planId / text / ref / floor /
 *   ledger；`gaps[]` 具名「为什么答不出」（查不到 / 没跑 / 翻过头**三者分列**）。
 *   同期的 **memoryToolsEnvelope**（v3.305.0 交付、v3.322.0 抬版）把五件能力
 *   （queryEvidence / getContinuityPack / previewFactAdmission / explainRecall /
 *   getKnowledgeBoundary）收成恒定 14 键信封 + 五态（ok / empty / unknown / unavailable / partial）。
 *   而本仓实测（`grep -RIn 'askMemoryQuestion|memoryToolsEnvelope|queryEvidence' apps config`）
 *   **零命中** —— 上游把「能问往事、答不出时给缺口而不编」做出来了，下游**一个消费者都没有**。
 *   这是本仓「建好不消费」的第十二/十三例，与投影面 / 注入面 / 证据面 / 检查点面**同一族**。
 *
 * 【本模块的职责（只搬、不重算）】
 *   · 只读：只调上游**只读**出口（`askMemoryQuestion` 只读九账、`memoryToolsDescribe` 只自述）；
 *   · 不抛：插件不在场 / 旧版无此出口 / 调用抛错 / 返回值畸形，一律降级为归因；
 *   · 不猜：**不在这里重新规划问句或合成答案** —— 那是上游 `planQuestion` / `composeAnswer`
 *     的唯一口径；下游再实现一份就是第二套记忆库（R3-X2 验收原文逐字禁止的事）。
 *     本模块只把上游读数**归一成恒定键面**，供 UI 直接渲染。
 *
 * 【为什么两件面合一个模块（而不是各写一份取数）】
 *   两者共用**同一个装配点**与**同一支取库笔**（都经 `window.LonShaMemory` 插件实例），
 *   且下游的用途是同一件事：在记忆页里「问往事」并显示出处。合成一个模块可让
 *   「哪个出口在不在」只判一次，避免两处各写一份 `window.LonShaMemory` 探测（本仓治过的重复形态）。
 *   两面的返回值**不压平**：问答是 15 键、信封是 14 键，各自原样搬运。
 *
 * 【四态（本仓最贵的老账：缺席与空必须不同形）】
 *   · 插件不在场（未装 / 未加载）           ⇒ `engine-absent`（等装插件）
 *   · 插件在场但没有问答出口（旧版插件）     ⇒ `face-absent`（等上游升级）
 *   · 出口在但调用抛错                      ⇒ `unusable`（本机读不出）
 *   · 问了、跑了、确实没有命中              ⇒ `empty`（**真读数**：answer 空 + gaps 具名）
 *   · 问到答案                              ⇒ `ok`
 *   压平任何两态都会把「答不出」显示成「没这功能」，或反之。
 * ============================================================ */
'use strict';

/** 上游插件全局名（与 config/phone-fact-contract.js 读的是同一个；此处唯一收口） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';

/** 面状态（本模块自己的五态） */
export const MEMORY_QA_FACE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 问答回执的恒定键面（**逐字对齐上游登记表**：15 键；下游可按键断言） */
export const MEMORY_QA_KEYS = Object.freeze([
    'version', 'question', 'intents', 'actor', 'answer', 'gaps', 'refs', 'plans',
    'masked', 'truncated', 'resourced', 'total', 'knownActors', 'reason', 'writesNothing'
]);

/** 记忆工具信封的恒定键面（逐字对齐上游登记表：14 键） */
export const MEMORY_TOOLS_KEYS = Object.freeze([
    'kind', 'api', 'apiVersion', 'toolVersion', 'state', 'stateLabel', 'reason',
    'source', 'revision', 'revisionSource', 'scope', 'data', 'notes', 'writesNothing'
]);

/** 信封五态词表（与上游逐字一致；不许压成一态） */
export const MEMORY_TOOLS_STATES = Object.freeze(['ok', 'empty', 'unknown', 'unavailable', 'partial']);

/** 宿主窗口（注入优先，回落全局） */
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

/** 缺席形态的恒定 15 键（读者不必再判 undefined —— **缺席也全键在场**，上游硬契约） */
/* [v3.97.0 · 自抓缺陷] 初版这里把缺席路径的 state 写死成 `EMPTY` —— 那是把「等装插件」
 *   与「跑了、扫了、确实没命中」压成同一形态，而两者处置**相反**（前者去装插件，后者去改问法）。
 *   现改为由调用方显式给态：插件缺席 ⇒ engine-absent；读不出/抛错 ⇒ unusable。 */
function emptyQa(question, reason, state) {
    return {
        state: state || MEMORY_QA_FACE_STATES.UNUSABLE, faceReason: reason,
        version: 0, question: String(question == null ? '' : question),
        intents: [], actor: null, answer: [], gaps: [], refs: [], plans: [],
        masked: 0, truncated: false, resourced: 0, total: 0, knownActors: 0,
        reason: String(reason || ''), writesNothing: true
    };
}

/**
 * 问一句往事（**只读、不写**；只调上游唯一出口）。
 *
 * 【为什么返回值键面恒定】上游 `askMemoryQuestion` 已把「内核缺席」做成了**同键降级回执**
 *   （version=0 + reason + gaps，且 `knownActors` 在缺席路径上也给真读数）——
 *   下游按同一键面读即可，不必猜。本模块把它再包一层 `state` 归因，键面**不新增业务字段**。
 *
 * 【未知不编】**本模块不合成答案、不补缺口**：`answer` / `gaps` 一律原样搬运。
 *   「答不出」（answer 空 + gaps 具名）与「没这功能」（face-absent）分列。
 *
 * @param {object} [win] 显式注入 window
 * @param {string} question 用户问句
 * @param {object} [opts] { knownActors?, maxActors?, maxSentences?, pageSize?, maxPerLedger? }
 * @returns 恒定 15 键 + { state, faceReason }
 */
export function readMemoryQaAnswer(win, question, opts) {
    try {
        const plugin = pluginOf(win);
        /* [v3.97.0 · 自抓缺陷] 初版把「插件不在场」与「插件在、但本版没有问答出口」
         *   压在同一支里（都报 plugin-absent）—— 两者处置**相反**：前者等装插件，后者等升级。
         *   现按本模块自己的五态分开（这也正是本仓反复点名的那族形态）。 */
        if (!plugin) return emptyQa(question, 'plugin-absent', MEMORY_QA_FACE_STATES.ENGINE_ABSENT);
        if (typeof plugin.askMemoryQuestion !== 'function') {
            return emptyQa(question, 'plugin-face-absent', MEMORY_QA_FACE_STATES.FACE_ABSENT);
        }
        const r = plugin.askMemoryQuestion(question, opts || {});
        if (!r || typeof r !== 'object') return emptyQa(question, 'malformed', MEMORY_QA_FACE_STATES.UNUSABLE);
        /* 上游缺席路径：version=0 且 gaps 里给 module 类缺口。
         *   那是「内核没加载」⇒ 本模块归 engine-absent（**不是**「问了没答出来」）。 */
        const answer = Array.isArray(r.answer) ? r.answer : [];
        const gaps = Array.isArray(r.gaps) ? r.gaps : [];
        const version = Number(r.version) || 0;
        let state, faceReason;
        if (version === 0 && String(r.reason || '')) {
            state = MEMORY_QA_FACE_STATES.ENGINE_ABSENT; faceReason = String(r.reason);
        } else if (answer.length) {
            state = MEMORY_QA_FACE_STATES.OK; faceReason = 'ok';
        } else {
            /* 跑了、扫了、确实没命中 ⇒ empty（真读数）。gaps 具名「为什么」原样带出。 */
            state = MEMORY_QA_FACE_STATES.EMPTY; faceReason = 'no-answer';
        }
        return {
            state, faceReason,
            version,
            question: String(r.question || question || ''),
            intents: Array.isArray(r.intents) ? r.intents : [],
            actor: r.actor === undefined ? null : r.actor,
            answer,
            gaps,
            refs: Array.isArray(r.refs) ? r.refs : [],
            plans: Array.isArray(r.plans) ? r.plans : [],
            masked: Number(r.masked) || 0,
            truncated: r.truncated === true,
            resourced: Number(r.resourced) || 0,
            total: Number(r.total) || 0,
            knownActors: Number(r.knownActors) || 0,
            reason: String(r.reason || ''),
            writesNothing: true
        };
    } catch (_e) {
        return emptyQa(question, 'thrown', MEMORY_QA_FACE_STATES.UNUSABLE);
    }
}

/**
 * 记忆工具面自述（缺哪一格、为什么缺、缺了会怎样）。**只读、不抛。**
 * 本模块只转发上游 `memoryToolsDescribe()`，不自算五格在场读数。
 *
 * @returns {{ state:string, reason:string, complete:boolean, counts:object,
 *             missingDeps:string[], capabilities:Array, states:string[] }}
 */
export function readMemoryToolsDescribe(win) {
    const empty = {
        state: MEMORY_QA_FACE_STATES.ENGINE_ABSENT, reason: 'plugin-absent',
        complete: false, counts: { total: 0, present: 0, absent: 0 },
        missingDeps: [], capabilities: [], states: MEMORY_TOOLS_STATES.slice()
    };
    try {
        const plugin = pluginOf(win);
        if (!plugin || typeof plugin.memoryToolsDescribe !== 'function') {
            return Object.assign({}, empty, {
                state: MEMORY_QA_FACE_STATES.FACE_ABSENT, reason: 'face-absent'
            });
        }
        const d = plugin.memoryToolsDescribe();
        if (!d || typeof d !== 'object') return Object.assign({}, empty, { reason: 'malformed' });
        return {
            state: MEMORY_QA_FACE_STATES.OK, reason: String(d.reason || ''),
            complete: d.complete === true,
            counts: (d.counts && typeof d.counts === 'object') ? d.counts : { total: 0, present: 0, absent: 0 },
            missingDeps: Array.isArray(d.absentReasons) ? d.absentReasons.slice() : [],
            capabilities: Array.isArray(d.capabilities) ? d.capabilities.slice() : [],
            states: Array.isArray(d.states) && d.states.length ? d.states.slice() : MEMORY_TOOLS_STATES.slice()
        };
    } catch (_e) {
        return Object.assign({}, empty, { reason: 'thrown' });
    }
}

/**
 * 问一次结构化证据（走记忆工具信封；五态原样搬运，**不压平**）。
 * 本模块只转发上游 `queryEvidence`，不重算 state 词表。
 *
 * @returns 恒定 14 键 + { state, faceReason }
 */
export function readMemoryToolsEnvelope(win, spec, opts) {
    const empty = {
        state: MEMORY_QA_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        kind: 'memory-tools-envelope', api: 'queryEvidence', apiVersion: 0, toolVersion: 0,
        stateLabel: '', reason: 'plugin-absent',
        source: { module: '', symbol: '', path: 'not-given' },
        revision: null, revisionSource: '', scope: {}, data: null, notes: [], writesNothing: true
    };
    try {
        const plugin = pluginOf(win);
        if (!plugin || typeof plugin.queryEvidence !== 'function') {
            return Object.assign({}, empty, {
                state: MEMORY_QA_FACE_STATES.FACE_ABSENT, reason: 'face-absent'
            });
        }
        const r = plugin.queryEvidence(spec || {}, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { reason: 'malformed' });
        /* ★ 信封五态原样搬运（不折算）：`unavailable`（能力缺席）与 `empty`（能力在场、
         *   真跑过、明确没有）**处置相反**，压成一态就是本仓最贵的老账。 */
        const envState = String(r.state || '');
        let state;
        if (envState === 'ok' || envState === 'partial') state = MEMORY_QA_FACE_STATES.OK;
        else if (envState === 'empty') state = MEMORY_QA_FACE_STATES.EMPTY;
        else if (envState === 'unavailable') state = MEMORY_QA_FACE_STATES.ENGINE_ABSENT;
        else state = MEMORY_QA_FACE_STATES.UNUSABLE;
        return {
            state, faceReason: envState || 'unknown',
            kind: String(r.kind || 'memory-tools-envelope'),
            api: String(r.api || 'queryEvidence'),
            apiVersion: Number(r.apiVersion) || 0,
            toolVersion: Number(r.toolVersion) || 0,
            stateLabel: String(r.stateLabel || ''),
            reason: String(r.reason || ''),
            source: (r.source && typeof r.source === 'object') ? r.source : { module: '', symbol: '', path: 'not-given' },
            revision: r.revision === undefined ? null : r.revision,
            revisionSource: String(r.revisionSource || ''),
            scope: (r.scope && typeof r.scope === 'object') ? r.scope : {},
            /* data 为被包装面真读数（**不得**为 null）；缺席时上游给 null 且 notes 写明成因。 */
            data: r.data === undefined ? null : r.data,
            notes: Array.isArray(r.notes) ? r.notes.slice() : [],
            writesNothing: true
        };
    } catch (_e) {
        return Object.assign({}, empty, { reason: 'thrown' });
    }
}

/**
 * 转成可打开的出处引用（走仓内唯一靶心件 `config/open-ref.js`）。
 *   **为什么在这里转换**：上游 ref 的形状是 `{ref, floor, ledger}`（九账行身份），
 *   与本仓 `OPEN_REF_KINDS` 的七 kind 不是同一套键（本仓 kind 是 App 归属词）。
 *   故此处只做**一件事**：把上游 ref 归一成 downstream `{kind:'memory', id, appId}` ——
 *   `memory` kind 在 `config/open-ref.js` 里已登记归属 `summdesk`（总结记忆）。
 *   查不到归属时不硬投（如实报 why），由视图决定是否只显示楼层号。
 *
 * @param {object} row 上游 answer 项（含 ref / floor / ledger）
 * @returns {{ kind:string, id:string, appId:string, floor:number|null, ledger:string, ok:boolean, why:string }}
 */
export function qaRefOf(row) {
    const r = (row && typeof row === 'object') ? row : {};
    const id = String(r.ref || r.id || '');
    const floor = (typeof r.floor === 'number' && Number.isFinite(r.floor)) ? r.floor : null;
    const ledger = String(r.ledger || '');
    if (!id && floor === null) {
        return { kind: '', id: '', appId: '', floor: null, ledger, ok: false, why: 'no-ref-no-floor' };
    }
    return { kind: 'memory', id: id || ('floor:' + floor), appId: 'summdesk', floor, ledger, ok: true, why: '' };
}

/** 面状态的一句话归因（唯一实现；供诊断面与视图念出） */
export function memoryQaFaceLine(face) {
    const f = (face && typeof face === 'object') ? face : emptyQa('', 'plugin-absent', MEMORY_QA_FACE_STATES.ENGINE_ABSENT);
    switch (f.state) {
        case MEMORY_QA_FACE_STATES.OK:
            return '问到了（' + f.answer.length + ' 句 · 出处 ' + f.refs.length + ' 条'
                + (f.masked ? ' · 遮蔽 ' + f.masked : '') + (f.truncated ? ' · 已截断' : '') + '）';
        case MEMORY_QA_FACE_STATES.EMPTY:
            return '问了、扫了、没命中（**真读数**）—— 缺口 ' + (f.gaps.length ? f.gaps.length + ' 条具名' : '未具名');
        case MEMORY_QA_FACE_STATES.FACE_ABSENT:
            return '本版插件没有问答出口（等上游升级 v3.322+）—— 这不是「没查到」';
        case MEMORY_QA_FACE_STATES.UNUSABLE:
            return '问答读不出（' + String(f.faceReason || 'unavailable') + '）—— 这不是「没查到」';
        case MEMORY_QA_FACE_STATES.ENGINE_ABSENT:
        default:
            return '记忆插件不在场（' + String(f.faceReason || 'plugin-absent') + '）—— **不是**「没有答案」';
    }
}

export default {
    LONSHA_PLUGIN_GLOBAL,
    MEMORY_QA_FACE_STATES,
    MEMORY_QA_KEYS,
    MEMORY_TOOLS_KEYS,
    MEMORY_TOOLS_STATES,
    readMemoryQaAnswer,
    readMemoryToolsDescribe,
    readMemoryToolsEnvelope,
    qaRefOf,
    memoryQaFaceLine
};