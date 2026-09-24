/* ========================================================
 * projection-contract.js — [v3.0.0] 上游投影契约的消费侧单一真源
 *
 * 【这一版治的欠债】
 *   上游记忆插件 v3.208.0 建了投影管线（6 项投影、三态读数、缺席清单），
 *   但**只服务内部对读**：产物退化成 `this._lastProjection` 之后没有任何外供出口。
 *   上游 v3.212.0 补上了出口（`projection-pipeline.js` 的 envelope + `index.js` 的
 *   `_buildProjectionEnvelope()`，随快照 `projection` 字段外供）。
 *   本文件是**消费侧的另一半**：把那份 envelope 读成手机端能用的东西。
 *
 * 【修前的真实处境（本仓「建好不消费」的又一例）】
 *   出口做出来之前，本仓对「本插件侧的读数」只有零散二手来源：
 *     · 人物位置只能从 `snapshot.scene`（场所面）反推；
 *     · 「谁知道了哪条事实」在手机端**根本没有入口**；
 *     · 剧情日只在时计面里（与契约里的 `clockDay` 是同一份信息的两个来源）。
 *   于是「插件侧记的位置」与「世界侧推的位置」对不上时，手机端看不见，
 *   而这正是剧情会崩的地方。
 *
 * 【为什么字段清单在下游**有意重复一份**（不是抄漏了纪律）】
 *   跨仓不能 import（上游是酒馆插件，本仓是扩展；两侧各自自足，且 lonsha 侧的
 *   跨仓守卫 P2 明令禁止引用本仓路径）。更要紧的是：消费者必须能**独立判**
 *   「我认不认得这份结构」，而判据就是「必填字段是否都在」+「结构版是否高于我认得的」。
 *   把这份清单当成「跨仓契约快照」维护：上游改字段 ⇒ 必须同时抬 `projectionApiVersion`，
 *   本仓据此报 `ahead`（不硬猜），而不是把新字段读成 undefined 当成「没有这项」。
 *
 * 【三条纪律（与 config/world-bridge.js 同规格）】
 *   ① 只读：只读快照字段，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无投影字段 / 结构畸形 / 版本超前，一律降级为归因；
 *   ③ 不猜：
 *      · 「管线缺席（available=false）」与「投影跑了但都是空」**必须分开报**；
 *      · `withheld` 的投影**不下发值**（上游没给就是没给，不拿空对象顶替）；
 *      · 版本超前不按「就绪」处理，也不按「坏了」处理 —— 如实报 ahead。
 *
 * 【为什么 withheld 要单独成面（防剧透）】
 *   上游把「提供器抛错 / 未注册 / 被配置关掉」的投影标成 `withheld` 并把原因留在
 *   `sourceLedger.absent`。下游若把「缺席」渲染成「这里没人」，用户会看到
 *   「谁都不在任何地方」这种**看起来正常、实际是错的**读数。本模块把 withheld
 *   与 given 分成两个面，UI 必须分别渲染（given 显示值、withheld 显示原因）。
 * ======================================================== */
'use strict';

/* 【为什么必须经 config/world-bridge.js 的统一探针取快照，而不在这里自己摸桥全局】
 *   本仓第九道门（scripts/bridge-contract-audit.mjs）的 J1/J4 正是为这类写法立的：
 *     ① 桥名字面量只允许出现在真源里 —— 抄第二份必然与真源漂移（改一处即两边失联）；
 *     ② 自写形态判据（`x.snapshot && typeof x.snapshot === 'object'`）是 8 份重复实现的种子，
 *        而其中 clock/ledger 那两份照早期规格抄成了「把推送型对象当函数调」，
 *        TypeError 被 catch 吞掉 ⇒ 永久显示「桥在但没快照」。本模块不重蹈。
 *   故取快照一律经 readPushProbe()（推/拉两型的形态判定只写那一眼）。
 */
import { readPushProbe } from './world-bridge.js';

/** 本仓能读懂的 envelope **结构**版本（上游 `PROJECTION_API_VERSION` 的对照面） */
export const SUPPORTED_API_VERSION = 1;

/**
 * envelope 必填字段（**跨仓契约快照**；上游 `ENVELOPE_FIELDS` 的同清单）。
 * 上游改这份清单必须抬 `projectionApiVersion`；本仓只认这一版结构。
 */
export const ENVELOPE_FIELDS = Object.freeze([
    'projectionApiVersion', 'projectionVersion', 'generatedAt',
    'conversationId', 'sceneId', 'worldId',
    'items', 'visibility', 'sourceLedger', 'revision', 'expiresAt'
]);

/** 契约裁定五态（与上游 contractOf 同语义；本仓独立实现，见文件头「为什么重复一份」） */
export const CONTRACT_STATES = Object.freeze(['ok', 'missing', 'malformed', 'ahead', 'behind']);

/** 粗归因文案（细态见 contract.reason；未知原因**如实输出原值**，不静默兜底） */
export const PROJECTION_REASONS = Object.freeze({
    'ready': '投影就绪（上游已外供本插件侧的读数）',
    'bridge-absent': '记忆插件未安装',
    'no-snapshot': '桥在，但还没产出过快照',
    'no-projection-face': '这版快照没有投影面（需记忆插件 v3.212+）',
    'pipeline-absent': '上游明说：投影管线缺席（没跑，不是空的）',
    'contract-ahead': '上游结构版高于本机认得的版本（不硬猜，请升级手机端）',
    'contract-malformed': '投影结构不完整（缺必填字段）',
    'contract-behind': '上游结构版低于本机认得的版本（旧版插件）'
});

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 数值归一：**null / undefined / 空串 / 非数值一律 null**。
 *
 * 【为什么单列（v3.0.0 由 tests/system-v300.test.mjs 的 C2 捐到的真缺陷）】
 *   初稿四处写 `Number.isFinite(Number(x)) ? Number(x) : null`，看着安全，其实有陷阱：
 *   `Number(null) === 0`、`Number('') === 0`、`Number([]) === 0` —— 于是上游**没给**这几个
 *   字段（给了 null）时，本仓会如实报成 **0**。而 0 在这份契约里全是合法值：
 *   `revision` 是变更栅栏号（0 是合法初值）、`generatedAt` / `expiresAt` 是时间戳
 *   （0 = 1970，于是 `stale` 被算成 true：「从没给过有效期」被报成「已过期」）。
 *   「没给」与「给了 0」塌成同形，正是本仓最贵的那一类错读数。
 */
function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * 契约裁定：这份 envelope 消费者读不读得懂（纯函数、不抛）。
 *
 * @param {*} env
 * @returns {{ state:string, reason:string, missing:string[], extraApi:boolean }}
 *   state ∈ CONTRACT_STATES
 *   reason ∈ { ok, missing, malformed, ahead, behind }
 */
export function contractOf(env) {
    const out = { state: 'malformed', reason: 'malformed', missing: [], extraApi: false };
    try {
        if (env === undefined || env === null) {
            out.state = 'missing';
            out.reason = 'missing';
            return out;
        }
        if (!isPlainObject(env)) return out;
        const missing = ENVELOPE_FIELDS.filter((k) => !Object.prototype.hasOwnProperty.call(env, k));
        out.missing = missing;
        if (missing.length) { out.state = 'malformed'; out.reason = 'missing'; return out; }
        const api = numOrNull(env.projectionApiVersion);
        if (api === null) { out.state = 'malformed'; out.reason = 'malformed'; return out; }
        if (api > SUPPORTED_API_VERSION) { out.state = 'ahead'; out.reason = 'ahead'; out.extraApi = true; return out; }
        if (api < SUPPORTED_API_VERSION) { out.state = 'behind'; out.reason = 'behind'; return out; }
        out.state = 'ok';
        out.reason = 'ok';
        return out;
    } catch (_e) {
        return { state: 'malformed', reason: 'malformed', missing: [], extraApi: false };
    }
}

/**
 * 读投影契约（单一真源：本仓一切投影消费都经此处）。
 *
 * @param {object} [win] 显式注入 window（无头测试用）
 * @param {object} [opts] { now?:number, snapshot?:object }
 *   now —— 过期判定基准（不传取 Date.now()，注入以便可测）
 *   snapshot —— 调用方已有的快照（避免重复取桥；不传则自己经 readPushProbe 取）
 * @returns {object} 结构恒定（缺字段一律给空形，消费方不必判 undefined）
 */
export function readProjection(win, opts = {}) {
    const empty = {
        state: 'absent',
        reason: 'bridge-absent',
        mounted: false,
        hasSnapshot: false,
        present: false,
        contract: { state: 'missing', reason: 'missing', missing: [], extraApi: false },
        envelope: null,
        items: {},
        visibility: {},
        withheld: [],
        summary: null,
        identity: { conversationId: null, sceneId: null, worldId: null },
        revision: null,
        generatedAt: null,
        expiresAt: null,
        stale: null,
        text: PROJECTION_REASONS['bridge-absent']
    };
    try {
        const w = win || ((typeof window !== 'undefined') ? window : null);
        let snap = isPlainObject(opts.snapshot) ? opts.snapshot : null;
        let mounted = false;
        let hasSnapshot = false;
        if (!snap) {
            // 经统一探针取（形态判定只写一份；本文件不得自摸桥全局，见文件头）
            const probe = readPushProbe(w);
            mounted = probe.mounted === true;
            hasSnapshot = probe.hasSnapshot === true;
            if (!mounted) return empty;
            snap = isPlainObject(probe.snapshot) ? probe.snapshot : null;
        } else {
            mounted = true;
            hasSnapshot = true;
        }
        if (!snap) {
            return { ...empty, mounted, hasSnapshot: false, reason: 'no-snapshot', text: PROJECTION_REASONS['no-snapshot'] };
        }
        // 「快照里没这项」与「这项是 null」必须可分：先看三态自述（上游 v3.174 起有 meta.fieldTypes）
        let declaredPresent = null;
        try {
            const ft = snap.meta && isPlainObject(snap.meta.fieldTypes) ? snap.meta.fieldTypes.projection : null;
            if (isPlainObject(ft) && typeof ft.present === 'boolean') declaredPresent = ft.present;
        } catch (_e) { declaredPresent = null; }
        const raw = snap.projection;
        if (raw === undefined || raw === null) {
            const noFace = (declaredPresent === false) || (declaredPresent === null);
            return {
                ...empty, mounted, hasSnapshot: true, present: false,
                reason: 'no-projection-face',
                text: PROJECTION_REASONS['no-projection-face'],
                declaredAbsent: noFace
            };
        }
        const contract = contractOf(raw);
        const base = {
            mounted: true, hasSnapshot: true, present: true,
            contract,
            envelope: raw,
            items: {},
            visibility: {},
            withheld: [],
            summary: null,
            identity: { conversationId: null, sceneId: null, worldId: null },
            revision: null,
            generatedAt: null,
            expiresAt: null,
            stale: null
        };
        if (contract.state !== 'ok') {
            const reason = (contract.state === 'ahead') ? 'contract-ahead'
                : (contract.state === 'behind') ? 'contract-behind' : 'contract-malformed';
            return { ...base, state: 'unusable', reason, text: PROJECTION_REASONS[reason] || reason };
        }
        // ── 结构认得：开始分面（given / withheld 必须分开）──
        const vis = isPlainObject(raw.visibility) ? raw.visibility : {};
        const items = isPlainObject(raw.items) ? raw.items : {};
        const given = {};
        const shown = {};
        const withheld = [];
        for (const id of Object.keys(vis)) {
            const v = vis[id];
            if (v === 'withheld') {
                withheld.push({ id, reason: String(withheldReasonOf(raw, id) || 'absent') });
                delete shown[id];
            } else {
                shown[id] = (v === undefined || v === null) ? 'given' : String(v);
                if (Object.prototype.hasOwnProperty.call(items, id)) given[id] = items[id];
            }
        }
        const sl = isPlainObject(raw.sourceLedger) ? raw.sourceLedger : null;
        const injected = numOrNull(opts.now);
        const now = (injected === null) ? Date.now() : injected;
        const exp = numOrNull(raw.expiresAt);
        const pipelineAbsent = !!(sl && sl.available === false);
        const reason = pipelineAbsent ? 'pipeline-absent' : 'ready';
        return {
            ...base,
            state: pipelineAbsent ? 'absent' : 'ready',
            reason,
            text: PROJECTION_REASONS[reason] || reason,
            items: given,
            visibility: shown,
            withheld,
            summary: sl && isPlainObject(sl.summary) ? {
                total: Number(sl.summary.total) || 0,
                ok: Number(sl.summary.ok) || 0,
                empty: Number(sl.summary.empty) || 0,
                absent: Number(sl.summary.absent) || 0,
                skipped: Number(sl.summary.skipped) || 0
            } : null,
            identity: {
                conversationId: (raw.conversationId === undefined) ? null : raw.conversationId,
                sceneId: (raw.sceneId === undefined) ? null : raw.sceneId,
                worldId: (raw.worldId === undefined) ? null : raw.worldId
            },
            revision: numOrNull(raw.revision),
            generatedAt: numOrNull(raw.generatedAt),
            expiresAt: exp,
            // 过期**不等于**失效：本仓只如实报 stale，由调用方决定是否重取（不在这里偷偷重算）
            stale: (exp === null) ? null : (now > exp),
            scopeBound: !!(sl && sl.bound === true)
        };
    } catch (_e) {
        return { ...empty, reason: 'probe-threw', text: '投影读取异常（已降级，不外抛）' };
    }
}

/** 从 sourceLedger.absent 里取某个投影的缺席原因（取不到如实给 'absent'，不伪造原因） */
function withheldReasonOf(env, id) {
    try {
        const sl = env && env.sourceLedger;
        const arr = sl && Array.isArray(sl.absent) ? sl.absent : [];
        for (const it of arr) {
            if (it && it.id === id) return String(it.reason || 'absent');
        }
        return 'absent';
    } catch (_e) { return 'absent'; }
}

/**
 * 取单个投影的值（**只对 given 面**；withheld 一律返回缺席，绝不拿空值顶替）。
 *
 * @returns {{ present:boolean, value:*, reason:string }}
 */
export function projectionValue(proj, id) {
    const miss = { present: false, value: undefined, reason: 'withheld' };
    try {
        if (!proj || typeof proj !== 'object') return { present: false, value: undefined, reason: 'no-projection' };
        const items = isPlainObject(proj.items) ? proj.items : {};
        if (Object.prototype.hasOwnProperty.call(items, id)) {
            return { present: true, value: items[id], reason: 'value' };
        }
        const w = Array.isArray(proj.withheld) ? proj.withheld : [];
        if (w.some((x) => x && x.id === id)) return miss;
        return { present: false, value: undefined, reason: 'not-declared' };
    } catch (_e) { return { present: false, value: undefined, reason: 'read-threw' }; }
}

/** 一句话总述（供 UI 头部/诊断；未知原因如实输出原值） */
export function projectionLine(proj) {
    const p = proj || {};
    if (p.reason !== 'ready') return String(p.text || p.reason || '未知');
    const s = p.summary || {};
    const parts = ['投影就绪（' + (s.ok || 0) + ' 项有值 / ' + (s.empty || 0) + ' 项为空 / ' + (s.absent || 0) + ' 项缺席）'];
    if (p.withheld.length) parts.push('扣下 ' + p.withheld.length + ' 项：' + p.withheld.map((x) => x.id).join('、'));
    if (p.stale === true) parts.push('已过期（可重取）');
    return parts.join(' · ');
}

export default {
    SUPPORTED_API_VERSION,
    ENVELOPE_FIELDS,
    CONTRACT_STATES,
    PROJECTION_REASONS,
    contractOf,
    readProjection,
    projectionValue,
    projectionLine
};
