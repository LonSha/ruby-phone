/* ============================================================
 * config/entity-candidates-contract.js — [v3.97.0 · R3-O1 续] 上游**实体映射**（entityMapping）的
 *   消费侧单一真源
 * ------------------------------------------------------------
 * 【治的欠债（修前实测，不是推测）】
 *   上游 lonsha-memory-plugin 的实体注册表（_entityRegistry）在 **v3.317.0（M3-O3）** 起
 *   对外提供了两件读面：`resolveEntityAt`（把「某值」解析成**唯一**实体）与 `entityCandidatesFor`
 *   （把「某值」的**全部**可能归属如实列出，含被范围排除者并带 blockedBy）。
 *   上游登记表 `tests/audit/open_face_registry.tsv` 已按 face=entityMapping 登记（consumer 声明
 *   `readEntityCandidates@1`），而**下游真码零消费**：手机侧的身份消歧（R3-O1）此前只走本仓
 *   自己的成员名归一（`matchMemberCandidates`），与主聊天**不是同一份映射** ——
 *   同一个名字在两处可能被解析成不同的人（M3-O3 档头逐字点名的处境）。
 *
 * 【本模块的职责（只搬、不重算）】
 *   · 只读：只调上游**只读**出口（`resolveEntityAt` / `entityCandidatesFor`）；
 *   · 不抛：插件不在场 / 旧版无此出口 / 调用抛错 / 返回值畸形，一律降级为归因；
 *   · 不猜：**不在这里重算候选或挑人** —— 那是上游注册表的唯一口径，下游再实现一份就是第二套
 *     实体映射（R3-O1 验收原文禁止的事：「与 M3-O3 交换身份映射而非共享昵称键」）。
 *     本模块只把上游读数归一成恒定键面，供群成员消歧 UI 直接渲染。
 *
 * 【五态（本仓最贵的老账：缺席与空必须不同形）】
 *   · 插件不在场（未装 / 未加载）           ⇒ `engine-absent`（等装插件）
 *   · 插件在场但没有实体读面（旧版插件）     ⇒ `face-absent`（等上游升级）
 *   · 出口在但调用抛错 / 注册表未建          ⇒ `unusable`（本机读不出）
 *   · 查了、跑了、确实无候选                ⇒ `empty`（**真读数**：别名表里真没有）
 *   · 有候选（一条或多条）                  ⇒ `ok`
 *   压平任何两态都会把「还没装插件」显示成「查无此人」，或把「多人同名」显示成「一个人」。
 *
 * 【为什么候选**多条不折成一条**】
 *   上游这一面的存在理由就是「歧义不硬合并的前提是看得见候选」。下游若取首个，
 *   就把「请你选一个」重新变成「静默算给第一个人」—— 那正是 R3-O1 修掉的缺陷形态。
 * ============================================================ */
'use strict';
/** 上游插件全局名（与 config/phone-fact-contract.js 读的是同一个；此处唯一收口） */
const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';
/** 面状态（本模块自己的五态） */
export const ENTITY_FACE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});
/** 单条候选的恒定键面（逐字对齐上游 index.js::entityCandidatesFor 的映射体） */
export const ENTITY_CANDIDATE_KEYS = Object.freeze(['id', 'name', 'via', 'matchedAlias', 'blockedBy']);
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
        return w[LONSHA_PLUGIN_GLOBAL] || null;
    } catch (_e) { return null; }
}
/** 归档一条读面结果（恒定键面：state / reason / candidates / engine / face / writesNothing） */
function faceRow(state, reason, extra) {
    return Object.assign({
        state: state,
        reason: String(reason || ''),
        candidates: [],
        engine: LONSHA_PLUGIN_GLOBAL,
        face: 'entityMapping',
        writesNothing: true
    }, extra || {});
}
/**
 * 取候选：把「某值」的全部可能归属如实交给调用方。
 * @param {object|null} win 宿主窗口（注入优先）
 * @param {string} kind 实体种类（本仓用 'person'）
 * @param {string} value 待解析的值（群成员名 / 别名）
 * @param {object} [ctx] 情境（在场者、时段等；上游自有默认）
 * @returns {{state,reason,candidates,engine,face,writesNothing}} 永不抛
 */
export function readEntityCandidates(win, kind, value, ctx) {
    const plugin = pluginOf(win);
    /* ① 插件不在场：**具名**归因，且**不是**空候选（等装插件 ≠ 查无此人） */
    if (!plugin) return faceRow(ENTITY_FACE_STATES.ENGINE_ABSENT, 'plugin-absent');
    /* ② 插件在、本版没这一口：等上游升级（与「等装插件」处置相反，故不同形） */
    if (typeof plugin.entityCandidatesFor !== 'function') {
        return faceRow(ENTITY_FACE_STATES.FACE_ABSENT, 'face-absent');
    }
    /* ③ 出口在，但真调用抛错 / 返回畸形：本机读不出（不假装「没有候选」） */
    let raw;
    try {
        raw = plugin.entityCandidatesFor(kind, value, ctx || {});
    } catch (_e) {
        return faceRow(ENTITY_FACE_STATES.UNUSABLE, 'thrown');
    }
    if (!Array.isArray(raw)) return faceRow(ENTITY_FACE_STATES.UNUSABLE, 'malformed');
    const candidates = raw.map((c) => {
        const o = (c && typeof c === 'object') ? c : {};
        return {
            id: String(o.id == null ? '' : o.id),
            name: String(o.name == null ? '' : o.name),
            via: String(o.via == null ? '' : o.via),
            matchedAlias: String(o.matchedAlias == null ? '' : o.matchedAlias),
            blockedBy: (o.blockedBy == null ? null : String(o.blockedBy))
        };
    }).filter((c) => c.id || c.name);
    /* ④ 真读数：跑了、扫了、确实没有候选（别名表里真没有这个人） */
    if (!candidates.length) return faceRow(ENTITY_FACE_STATES.EMPTY, 'no-candidates');
    return faceRow(ENTITY_FACE_STATES.OK, 'ok', { candidates: candidates });
}
/**
 * 解析唯一实体（走同一份注册表；与 `readEntityCandidates` 同一装配点）。
 * @returns {{state,reason,entity,engine,face,writesNothing}} 永不抛
 */
export function readEntityAt(win, kind, value, ctx) {
    const plugin = pluginOf(win);
    if (!plugin) return faceRow(ENTITY_FACE_STATES.ENGINE_ABSENT, 'plugin-absent');
    if (typeof plugin.resolveEntityAt !== 'function') {
        return faceRow(ENTITY_FACE_STATES.FACE_ABSENT, 'face-absent');
    }
    let r;
    try {
        r = plugin.resolveEntityAt(kind, value, ctx || {}, null);
    } catch (_e) {
        return faceRow(ENTITY_FACE_STATES.UNUSABLE, 'thrown');
    }
    if (!r || typeof r !== 'object') return faceRow(ENTITY_FACE_STATES.UNUSABLE, 'malformed');
    if (r.ok !== true) {
        /* 上游未命中会给**具名** reason（no-match / registry-unavailable …）：
         *   未命中 ⇒ empty（真读数）；注册表未建 ⇒ unusable（本机读不出）。两者处置相反。 */
        const why = String(r.reason || '');
        const state = (why === 'registry-unavailable') ? ENTITY_FACE_STATES.UNUSABLE : ENTITY_FACE_STATES.EMPTY;
        return faceRow(state, why || 'no-match');
    }
    const e = (r.entity && typeof r.entity === 'object') ? r.entity : null;
    if (!e) return faceRow(ENTITY_FACE_STATES.UNUSABLE, 'malformed');
    return faceRow(ENTITY_FACE_STATES.OK, '', {
        entity: { id: String(e.id == null ? '' : e.id), kind: String(e.kind == null ? '' : e.kind), name: String(e.name == null ? '' : e.name) }
    });
}
/** 面读数一行文案（视图不自己拼；唯一实现在此）。 */
export function entityFaceLine(face) {
    const f = (face && typeof face === 'object') ? face : {};
    const n = Array.isArray(f.candidates) ? f.candidates.length : 0;
    switch (f.state) {
        case ENTITY_FACE_STATES.ENGINE_ABSENT: return '记忆插件未加载（等装插件）';
        case ENTITY_FACE_STATES.FACE_ABSENT: return '记忆插件版本偏低，尚无实体映射（等上游升级）';
        case ENTITY_FACE_STATES.UNUSABLE: return '实体映射本机读不出（' + String(f.reason || 'unusable') + '）';
        case ENTITY_FACE_STATES.EMPTY: return '查过了：别名表里没有这个人';
        case ENTITY_FACE_STATES.OK: return n > 1 ? ('同名多解，候选 ' + n + ' 人：请选择') : '唯一归属';
        default: return '未取数';
    }
}
export default {
    ENTITY_FACE_STATES, ENTITY_CANDIDATE_KEYS, readEntityCandidates, readEntityAt, entityFaceLine
};