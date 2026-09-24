/* ========================================================
 * source-key-rules.js — 派生库源键规则单一真源 + 校验器 [v2.99.0]
 * --------------------------------------------------------
 * 【为什么有它】v2.93.0 用一条真实缺陷换来的教训（原文在 TODO.md）：
 *     “派生库的源键里不放可变状态 —— 只要身份会随状态漂移，
 *      新增/改写/回收三条出口写得再齐也全是死的。”
 *   当时约定支的源键写作 `commitment:<id>:<status>:<revision>`，把状态与修订号
 *   写进了身份：同一条约定每推进一次状态就换一个源身份，时间线上最多
 *   并存 5 条同源条目；且因为键漂移，预先写好的回收调用根本找不到它们
 *   （终态也不回收）。已修为 `commitment:<id>` + `removeBySourceBase(base)`。
 *
 *   但那一次的修法只落在了**代码与测试里**：教训写进了注释，
 *   **没有任何东西能拦住下一例** —— 任何人写下 `foo:<id>:<status>`
 *   这样的源键，不报错、不崩界面、只是“回收永远找不到”，即本仓最贵的形态。
 *   本模块把这条教训落成机制：① 规则声明；② 校验器；③ 门禁把它变成发布前判据。
 *
 * 【规则（可执行，非散文）】
 *   R1 源键是由 `:` 分隔的段序列，第一段是**类型**（如 `calendar` / `commitment` /
 *      `task`）。类型必预声明（KNOWN_SOURCE_TYPES）。
 *   R2 除类型段外，**所有段必须是稳定身份**（id / slug / 数字下标）。
 *      出现可变状态段（status / revision / phase / state 等）⇒ 违规。
 *   R3 段数不设硬上限（拿不准就不限制），但**可变状态词表**与**合法尾缀白名单**
 *      可在这里扩充；扩充即意味着其他所有派生库同样受益。
 *
 * 【与既有真实源键的对账（实测口径，v2.99.0）】
 *   · `calendar:<memoId>:<type>` —— calendar/calendar-data.js:596
 *     type 取值 work/study/travel（领域类型），它是“这条派生条目属于哪一类”，
 *     不是“源推进到了哪一步” —— 允许（落在 ALLOWED_TAIL 白名单）。
 *   · `commitment:<id>` —— calendar/calendar-app.js
 *   · `task:<taskId>:<index>` —— 万象背包奖励物品（v2.95.0）
 *     index 是“第几份奖励”的下标，属稳定身份（总份数不随进度变） —— 允许。
 *   · `source:<id>` / `inventory:<id>` —— 其他库。
 *   **反例（若将来出现）**：`task:<id>:done`、`commitment:<id>:proposed`
 *     —— `done` / `proposed` 是状态，推进一次即换身份。本校验器即拦它。
 *
 * 【纪律】只读（不写任何存储）、不抛（畸形键一律归为 invalid 并如实报告，
 *   不把它当成“合法”也不因此中断其它键的校验）。
 * ======================================================== */

/** 已知源键类型（新增类型必须先登记；门禁会对照真仓库） */
const KNOWN_SOURCE_TYPES = Object.freeze([
    'calendar',      // 日历备忘派生的生活事件（领域事件）
    'commitment',    // 约定（日历 App 的约定项）
    'task',          // 万象任务/订单的派生奖励物品
    'order',         // 万象订单
    'inventory',     // 背包
    'source',        // 通用来源
    'media',         // 媒体
    'memo'           // 备忘
]);

/**
 * 可变状态词表：出现在**类型段之后**的段即为漂移键。
 * 判定依据：这些词描述“源推进到了哪一步”，改变即重开一个源身份，
 * 使 `removeBySourceBase` 写在前缀上也收不住（前缀仍匹配）——
 * 等等，前缀**能**收住；真正致命的是下一类：把状态拼在键的**中间**、
 * 或在回收时用完整键去匹配（v2.93 的实际形态）。故本表仅作**警告级**判据。
 */
const VOLATILE_SEGMENTS = Object.freeze([
    'proposed', 'confirmed', 'active', 'done', 'completed', 'cancelled', 'canceled',
    'pending', 'expired', 'rev', 'revision', 'phase', 'stage', 'status', 'state'
]);

/**
 * 合法尾缀白名单（“分类”而非“状态”）。
 * 判据：尾部描述的是**这个派生条目属于哪个固定类别**，类别总数有限且不随
 * 剧情推进而变；而状态会一直变。
 */
const ALLOWED_TAIL = Object.freeze([
    'work', 'study', 'travel',     // 生活事件的领域类型
    'text', 'image',               // 媒体载体类型
    'sfw', 'nsfw'                  // 尺度（固定枚举，非进度）
]);

/** 纯数字段（数组下标）也属稳定身份 */
const NUMERIC_SEG = /^\d+$/;
/** 稳定身份段的字符集：字母数字、下划线、连字符、点（UUID / 32位十六进制 / 时间戳式 id） */
const STABLE_SEG = /^[A-Za-z0-9_.-]+$/;

function splitSegments(key) {
    return String(key == null ? '' : key).split(':');
}

/**
 * 校验一个源键。
 * @param {string} key
 * @returns {{ ok:boolean, key:string, type:string|null, segments:string[],
 *             violations:string[], warnings:string[], reason:string }}
 *   reason ∈ { ok, empty, unknown-type, volatile-segment, malformed-segment }
 */
export function validateSourceKey(key) {
    const raw = (key == null) ? '' : String(key).trim();
    const base = { key: raw, type: null, segments: [], violations: [], warnings: [] };
    if (!raw) return Object.assign(base, { ok: false, reason: 'empty' });
    const segs = splitSegments(raw);
    const type = segs[0] || '';
    const out = Object.assign(base, { segments: segs, type });
    if (!KNOWN_SOURCE_TYPES.includes(type)) {
        out.violations.push('unknown-type:' + type);
        return Object.assign(out, { ok: false, reason: 'unknown-type' });
    }
    let malformed = null;
    for (let i = 1; i < segs.length; i += 1) {
        const s = segs[i];
        if (!s || (!NUMERIC_SEG.test(s) && !STABLE_SEG.test(s))) {
            malformed = malformed || ('segment#' + i + ':' + s);
        }
    }
    if (malformed) {
        out.violations.push('malformed-segment:' + malformed);
        return Object.assign(out, { ok: false, reason: 'malformed-segment' });
    }
    // 可变状态段：警告级（前缀回收仍能收住；但拼在中间即真死）
    const volatileHits = [];
    for (let i = 2; i < segs.length; i += 1) {   // 下标 1 是 id 本体，不参与状态判定
        const s = String(segs[i] || '').toLowerCase();
        if (VOLATILE_SEGMENTS.includes(s) && !ALLOWED_TAIL.includes(s)) volatileHits.push(segs[i]);
    }
    if (volatileHits.length) {
        out.warnings.push('volatile-segment:' + volatileHits.join(','));
        return Object.assign(out, { ok: false, reason: 'volatile-segment' });
    }
    return Object.assign(out, { ok: true, reason: 'ok' });
}

/**
 * 批量校验（只读、不抛；畸形键不会中断其它键）。
 * @param {string[]} keys
 * @returns {{ total:number, ok:number, bad:Array<object>, reasons:Object, warnings:Object }}
 */
export function auditSourceKeys(keys) {
    const list = Array.isArray(keys) ? keys : [];
    const bad = [];
    const reasons = {};
    const warnings = {};
    let ok = 0;
    for (const k of list) {
        let r;
        try { r = validateSourceKey(k); }
        catch (e) { r = { ok: false, key: String(k), reason: 'validator-threw', violations: [String(e && e.message || e)], warnings: [] }; }
        reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        for (const w of (r.warnings || [])) warnings[w.split(':')[0]] = (warnings[w.split(':')[0]] || 0) + 1;
        if (r.ok) ok += 1;
        else bad.push(r);
    }
    return { total: list.length, ok, bad, reasons, warnings };
}

/** 词表快照（供诊断中心展示「当前规则是什么」；纯读） */
export function sourceKeyRulebook() {
    return {
        knownTypes: KNOWN_SOURCE_TYPES.slice(),
        volatileSegments: VOLATILE_SEGMENTS.slice(),
        allowedTail: ALLOWED_TAIL.slice()
    };
}

export default {
    validateSourceKey,
    auditSourceKeys,
    sourceKeyRulebook
};
