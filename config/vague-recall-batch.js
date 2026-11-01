/* ========================================================
 * config/vague-recall-batch.js — [v4.110.0 · R13-X2] 模糊回忆的批量召回与自检
 * --------------------------------------------------------
 * 【为什么与 `vague-recall.js` 拆成两件】计划书硬约束「新内核单件 ≤ 12K，超出必须拆」。
 *   切法是按**职责**切的，不是按体积硬切的：
 *     · `vague-recall.js`      —— 「一句话 → 条件」与「一条行 → 命中与否」（判定）；
 *     · 本件                   —— 「一批行 → 排序后的结果」与「这份结果诚不诚实」（归并/自检）。
 *   两件的分界线是：判定关心**单个**，归并关心**一批**。改词表不碰这两件，改排序只碰本件。
 *
 * 【本件只做三件事】
 *   ① `recallRows`  —— 对既有引擎已物化的行做召回（**不取数、不建索引**），排序确定性可复跑；
 *   ② `auditRecall` —— 自检：说不出为什么的行不算命中、没听懂的解不许带结果出门；
 *   ③ `vagueLine`   —— 一句话读数（视图直接排版，不自己拼条件）。
 *
 * 【为什么 `auditRecall` 是独立函数而不是内联断言】判据用真结果跑它、
 *   负控制用**破坏版结果**跑它 —— 同一份规则自证，而不是「另写一段判断来证明前一段对」。
 *
 * 【为什么排序要确定性兜底】同一份数据跑两次必须逐字相同，否则「顺序变了」
 *   会被误读为「数据变了」。末两级排序键（源 id / 标题）只为消除并列，不表达任何偏好。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
import { VAGUE_STATES, VAGUE_WHY_KINDS, VAGUE_LIMITS } from './vague-recall-terms.js';
import { parseVague, matchRow } from './vague-recall.js';

/** 行的时间（毫秒）。`ts` 优先，退 `createdAt`；**读不出即 null**（不给 0）。 */
function tsOf(row) {
    const r = (row && typeof row === 'object') ? row : {};
    const n = numOrNull(r.ts);
    if (n !== null && n > 0) return n;
    const c = Date.parse(String(r.createdAt || ''));
    return Number.isFinite(c) ? c : null;
}

/**
 * 对一批已物化的行做模糊召回。
 * @param {Array<object>} rows 既有引擎已经检出的行（**本模块不取数、不建索引**）
 * @param {object} cond `parseVague` 的返回
 * @param {{now?:number, limit?:number}} [opts]
 */
export function recallRows(rows, cond, opts) {
    const o = opts || {};
    const list = Array.isArray(rows) ? rows : [];
    const c = (cond && typeof cond === 'object') ? cond : parseVague('', {});
    const out = {
        ok: c.ok === true, state: c.state || VAGUE_STATES.unresolved,
        cond: c, rows: [], total: 0, scanned: list.length, gaps: Array.isArray(c.gaps) ? c.gaps.slice() : []
    };
    if (!out.ok) return out;
    const nowMs = numOrNull(o.now) ?? Date.now();
    const hits = [];
    for (const row of list) {
        const m = matchRow(row, c);
        if (!m.hit) continue;
        /* ★ 纪律①的第二道闸：说不出原因的行**不交给界面**。 */
        if (!m.why.length) continue;
        const ts = tsOf(row);
        /* 相对指代不切区间，但**在排序上偏向近期** —— 这是它唯一的作用。 */
        const near = (c.softTime && ts !== null && (nowMs - ts) <= VAGUE_LIMITS.recentMs) ? 1 : 0;
        hits.push({ row: row, why: m.why, near: near, ts: (ts === null ? -1 : ts) });
    }
    /* 排序：命中条件多者优先 → 符合相对指代（近期）者优先 → 时间新者优先 → 源/标题字典序。
     * ★ 末两项是**确定性兜底**：同一份数据跑两次必须逐字相同（判据钉这一条）。 */
    hits.sort((a, b) => (b.why.length - a.why.length) || (b.near - a.near) || (b.ts - a.ts)
        || String((a.row && a.row.sourceId) || '').localeCompare(String((b.row && b.row.sourceId) || ''))
        || String((a.row && a.row.title) || '').localeCompare(String((b.row && b.row.title) || '')));
    out.total = hits.length;
    const limit = numOrNull(o.limit) ?? VAGUE_LIMITS.maxRows;
    out.rows = hits.slice(0, Math.max(1, Math.round(limit))).map((h) => ({ row: h.row, why: h.why }));
    return out;
}

/**
 * 自检：一份召回结果是否诚实。**判据用它，负控制也用它**（同一份规则自证）。
 * 查四件事：① 每条命中都有非空 `why`；② `why` 的 `kind` 在闭集里且 `hit`/`text` 非空；
 * ③ `total` 不小于交代出来的条数；④ 没听懂的解不许带结果出门。
 */
export function auditRecall(res) {
    const problems = [];
    const r = (res && typeof res === 'object') ? res : null;
    if (!r) return { ok: false, problems: ['结果体缺失（null / 非对象）'] };
    const rows = Array.isArray(r.rows) ? r.rows : null;
    if (!rows) return { ok: false, problems: ['结果体没有 rows 数组'] };
    if (r.ok !== true && rows.length) {
        problems.push('没听懂的解不许带结果出门：ok=false 却有 ' + rows.length + ' 条');
    }
    let n = 0;
    for (const item of rows) {
        n += 1;
        const why = (item && Array.isArray(item.why)) ? item.why : null;
        if (!why || !why.length) { problems.push('第 ' + n + ' 条说不出为什么被命中（why 空）'); continue; }
        for (const w of why) {
            if (VAGUE_WHY_KINDS.indexOf(String((w && w.kind) || '')) < 0) {
                problems.push('第 ' + n + ' 条的命中因由不在闭集里：' + String((w && w.kind) || ''));
            }
            if (!String((w && w.text) || '').trim()) problems.push('第 ' + n + ' 条的命中因由没写成人话（text 空）');
            if (!String((w && w.hit) || '').trim()) problems.push('第 ' + n + ' 条的命中因由没说是哪个词（hit 空）');
        }
        if (!item || !item.row || typeof item.row !== 'object') problems.push('第 ' + n + ' 条没有原行（无法回源）');
    }
    const total = numOrNull(r.total);
    if (total === null) problems.push('total 读不出来');
    else if (total < rows.length) problems.push('total(' + total + ') 小于交代出来的条数(' + rows.length + ')');
    return { ok: problems.length === 0, problems: problems };
}

/**
 * 一句话读数（视图直接拿去排版，**不自己拼条件** —— 条件口径只有这里一份）。
 */
export function vagueLine(cond, res) {
    const c = (cond && typeof cond === 'object') ? cond : null;
    const r = (res && typeof res === 'object') ? res : null;
    if (!c || c.ok !== true) return '没听懂这句，已按普通搜索处理';
    const bits = [];
    if (c.weatherKinds && c.weatherKinds.length) bits.push('天气 ' + String(c.weatherWords.join('/') || ''));
    if (c.from) bits.push('时间 ' + String(c.from) + ' ~ ' + String(c.toExcl || ''));
    else if (c.softTime) bits.push('时间「' + String(c.softTime) + '」（只在排序上偏向近期）');
    if (c.actor) bits.push('人物「' + String(c.actor) + '」');
    if (c.rest && c.rest.length) bits.push('关键词 ' + c.rest.join('/'));
    const n = (r && numOrNull(r.total) !== null) ? numOrNull(r.total) : 0;
    const scanned = (r && numOrNull(r.scanned) !== null) ? numOrNull(r.scanned) : 0;
    return '按 ' + bits.join(' · ') + ' 找到 ' + n + ' 条（翻了 ' + scanned + ' 条记录）';
}

export default { recallRows, auditRecall, vagueLine, VAGUE_LIMITS };
