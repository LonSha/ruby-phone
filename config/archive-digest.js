/* ========================================================
 *  RubyPhone · 二级摘要（B6）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   现在本仓的「让副模型写点东西」是一条**单级**通道：把一大段原文（聊天记录 /
 *   日记素材 / 世界书块）整段丢给副模型，让它直接产出**成品**。
 *   这条通道有两个反复出现的病：
 *
 *   ① **副模型读到的是原料，产出的却是定稿** —— 于是它会把原文里的**叙述语言**
 *      一起搬进成品：原文明写「他心里一沉」，成品里就跟着出现「他心里一沉」；
 *      原文用第三人称全知，成品里就出现「她其实早就知道」。生成者与改写者
 *      没有分工，模型就会自己扮演叙述者。
 *   ② **原料一长，产出就漂**：三千字的聊天记录直接要成品，第两百字之后
 *      基本靠编。原因是**同一遍里**既要压缩又要重写，两件事互相抢注意力。
 *
 *   本模块把这条通道拆成两级，并把**两级之间有什么**写成可验收的东西：
 *     · 一级（`原始 → 档案`）：只许**记事实**，进的是**副模型**；
 *     · 二级（`档案 → 正文`）：只许**读档案**，**不得再看原文**。
 *
 * 【本模块只做纯函数那一半（分级、裁剪、校验、读数）】
 *   IO 与调用留在 `api-manager` 与各 App 里。分开的理由与其余模块一致：
 *   纯函数能被负控制直接破坏，混了 IO 就只能靠真宿主才验得动。
 *
 * 【三态互不同形】
 *   `two-stage`（档案足够，走两级）/ `flattened`（档案不足，**如实降级**成单级）/
 *   `refused`（原文或档案根本不在）。把 `flattened` 报成 `two-stage`，
 *   调用方会以为「第二级拿到的是档案」，而它拿到的其实是原文 —— 那正是要防的事。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 档案条目的种类。刻意只有这几种：档案是**事实表**，不是摘要。 */
export const ARCHIVE_KINDS = Object.freeze(['event', 'promise', 'fact', 'relation', 'preference']);

const KIND_ALIAS = Object.freeze({
    event: 'event', '事件': 'event',
    promise: 'promise', '承诺': 'promise',
    fact: 'fact', '事实': 'fact',
    relation: 'relation', '关系': 'relation',
    preference: 'preference', '偏好': 'preference'
});

/** 叙述语言的特征词（正文里不许出现、档案里也不许出现）。
 *  这张表是**判据**不是风格偏好：出现即说明「谁在心里想」被写进了事实表。 */
export const NARRATION_MARKERS = Object.freeze([
    '心里一沉', '心中一紧', '心中五味杂陈', '暗自', '默默想着', '不由得',
    '其实早就', '心下了然', '若有所思', '意味深长'
]);

/** 事实字段：档案条目**必须**至少带一个。只有情绪描述、没有事实的条目不进档案。 */
export const ARCHIVE_FACT_FIELDS = Object.freeze([
    'who', 'what', 'when', 'where', 'said', 'did', 'amount', 'object', 'promise'
]);

function num(v) {
    return numOrNull(v);
}

/** 一条档案条目是否成形。返回理由（不成形时）。 */
export function checkArchiveItem(item) {
    if (!item || typeof item !== 'object') return { ok: false, why: '不是对象' };
    const kind = KIND_ALIAS[String(item.kind ?? '').trim()];
    if (!kind) return { ok: false, why: '不认识的种类：' + String(item.kind) };
    const text = String(item.text ?? item.content ?? '').trim();
    if (!text) return { ok: false, why: '空条目' };
    const hasFact = ARCHIVE_FACT_FIELDS.some((f) => {
        const v = item[f];
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && String(v).trim() !== '';
    });
    if (!hasFact) return { ok: false, why: '没有可核的事实字段（只有情绪不算档案）' };
    for (const marker of NARRATION_MARKERS) {
        if (text.includes(marker)) return { ok: false, why: '条文本体带叙述语言：' + marker };
    }
    return { ok: true, why: '', kind: kind, text: text };
}

/** 一份档案是否成形（分级用）。`minItems` 是「够不够撑起第二级」的下限。 */
export function checkArchive(archive, opts = {}) {
    const minItems = num(opts.minItems) !== null ? num(opts.minItems) : 1;
    const items = Array.isArray(archive) ? archive : (Array.isArray(archive?.items) ? archive.items : null);
    if (!items) return { ok: false, items: [], why: '档案不在场' };
    const good = [];
    const bad = [];
    for (const it of items) {
        const r = checkArchiveItem(it);
        if (r.ok) good.push({ kind: r.kind, text: r.text });
        else bad.push({ item: it, why: r.why });
    }
    if (good.length < minItems) {
        return { ok: false, items: good, bad: bad, why: '合格条目 ' + good.length + ' 条，低于下限 ' + minItems };
    }
    return { ok: true, items: good, bad: bad, why: '' };
}

/** 叙述语言扫描：给成品正文用。返回命中位置（**删除**由调用方决定 ——
 *  本模块不替作者改字，只如实报「这几处是从原文搬过来的叙述」）。 */
export function scanNarration(text) {
    const body = String(text ?? '');
    const hits = [];
    for (const marker of NARRATION_MARKERS) {
        let at = body.indexOf(marker);
        while (at >= 0) {
            hits.push({ marker: marker, at: at });
            at = body.indexOf(marker, at + marker.length);
        }
    }
    hits.sort((a, b) => a.at - b.at);
    return { count: hits.length, hits: hits };
}

/**
 * 判「这一轮该走两级还是单级」，并给出第二级的**输入面**。
 *
 * @param {{raw?:string, archive?:*, minArchiveItems?:number}} input
 * @returns {{state:string, stage2Input:string, archive:Array, why:string}}
 *   `two-stage` 时 `stage2Input` 是**档案文本**（第二级只看它）；
 *   `flattened` 时 `stage2Input` 是**原文**，且 `why` 说明为何降级 ——
 *   降级必须说出来，否则「第二级拿到的是原文」这件事没人知道。
 */
export function planTwoStage(input = {}) {
    const raw = String(input.raw ?? '').trim();
    if (!raw) return { state: 'refused', stage2Input: '', archive: [], why: '原文不在' };
    const checked = checkArchive(input.archive, { minItems: input.minArchiveItems });
    if (!checked.ok) {
        return {
            state: 'flattened', stage2Input: raw, archive: checked.items || [],
            why: '档案不足（' + checked.why + '）—— 本轮回落到单级，第二级将直接读原文'
        };
    }
    const lines = checked.items.map((it) => '[' + it.kind + '] ' + it.text);
    return { state: 'two-stage', stage2Input: lines.join('\n'), archive: checked.items, why: '' };
}

/** 一行读数。三态各占一格。 */
export function twoStageLine(plan) {
    if (!plan || typeof plan !== 'object') return '二级摘要：无读数';
    if (plan.state === 'refused') return '二级摘要：拒转 —— ' + plan.why;
    if (plan.state === 'flattened') return '二级摘要：降级为单级 —— ' + plan.why;
    return '二级摘要：两级（档案 ' + plan.archive.length + ' 条 · 第二级只读档案）';
}

export default {
    ARCHIVE_KINDS, NARRATION_MARKERS, ARCHIVE_FACT_FIELDS,
    checkArchiveItem, checkArchive, scanNarration, planTwoStage, twoStageLine
};