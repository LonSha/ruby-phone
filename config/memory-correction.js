/* ========================================================
 *  RubyPhone · 人工纠错四通道（B8）
 * ========================================================
 *
 * 【为什么需要它 —— 这是本仓唯一一处「必须由人来」的入口】
 *   记忆层此前**只进不出**：副模型抽出来的东西一旦落库，就只有「等它被新版本
 *   取代」这一条出路。而当它**抽错了**时：
 *     · 事实本身错了（把「她说她不去」记成「她不去」）；
 *     · 分录错了（把两件事合成一条，或者把一件事拆成两条）；
 *     · 上下文错了（她当时在生气，但记忆没带这个前提）；
 *     · 或者根本不该记（那是她随口一说）。
 *   这四种错**必须**由人来处置，且处置方式**不一样**：
 *
 *     · **重算**（`recompute`）：这一条的依据还在，让副模型重读原文再抽一次；
 *     · **单独重算**（`recompute-one`）：只重抽这一条，不动同一批里的其它条目；
 *     · **删掉**（`remove`）：这条不成，抹掉；
 *     · **加上**（`append`）：漏了，人工补一条。
 *
 *   四种的差别不是「程度」而是**方向**：重算与单独重算改的是**抽取**，
 *   删掉与加上改的是**内容**。把四个并成一个「编辑」，用户就再也无法表达
 *   「这条不该存在」与「这条存在但抽错了」的区别 —— 而处置方式恰恰相反
 *   （前者要防止它再被抽出来，后者要修好它）。
 *
 * 【三态互不同形（每条通道都有）】
 *   `applied`（真改了）/ `noop`（参数合法但结果与原来一样）/ `refused`（参数不合法）。
 *   把 `noop` 报成 `applied`，日志会显示「改了 12 条」而实际一条没动；
 *   把 `refused` 报成 `noop`，用户会以为「点了没反应」，而其实是输入不被接受。
 * ============================================================ */

/** 四条通道。`id` 是稳定键（UI 与卡侧都按它引，不许改名）。 */
export const CORRECTION_CHANNELS = Object.freeze([
    { id: 'recompute', label: '重算', note: '依据还在，让副模型重读原文再抽一次（同一批一起）' },
    { id: 'recompute-one', label: '单独重算', note: '只重抽这一条，不动同批其它条目' },
    { id: 'remove', label: '删掉', note: '这条不成，抹掉（并按内容记进不再抽的名单）' },
    { id: 'append', label: '加上', note: '漏了，人工补一条（标 source=human）' }
]);

const CHANNEL_IDS = Object.freeze(CORRECTION_CHANNELS.map((c) => c.id));

/** 人工补条目的来源标记：**永远**不许被自动抽取覆盖。
 *  它存在的理由：人工补的那条是用户明确要的，而自动抽取下次还会重抽一遍 ——
 *  没有这个标记，用户补的条目会在下一轮被「同内容但不同措辞」的自动条目顶掉。 */
export const HUMAN_SOURCE = 'human';

function text(v) {
    return String(v ?? '').trim();
}

function cloneRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((r) => (r && typeof r === 'object' ? Object.assign({}, r) : r));
}

function rowKey(row) {
    if (!row || typeof row !== 'object') return '';
    return text(row.id) || text(row.uid) || text(row.key);
}

/**
 * 处置一条纠错请求。
 *
 * @param {object} rows 当前条目表
 * @param {{channel?:string, target?:string, patch?:object, text?:string, batch?:string[]}} req
 * @returns {{state:string, rows:Array, changed:Array, channel:string, why:string}}
 *   `state`：`applied` / `noop` / `refused`（三态互不同形）。
 */
export function applyCorrection(rows, req = {}) {
    const channel = text(req.channel);
    if (!CHANNEL_IDS.includes(channel)) {
        return { state: 'refused', rows: cloneRows(rows), changed: [], channel: channel, why: '不认识的通道：' + (channel || '（空）') };
    }
    const list = cloneRows(rows);

    if (channel === 'append') {
        const body = text(req.text);
        if (!body) {
            return { state: 'refused', rows: list, changed: [], channel: channel, why: '补的条目没有内容' };
        }
        const exists = list.some((r) => r && typeof r === 'object' && text(r.text ?? r.content) === body);
        if (exists) {
            return { state: 'noop', rows: list, changed: [], channel: channel, why: '同内容已在表里（不重复补）' };
        }
        const row = Object.assign({}, req.patch || {}, { text: body, source: HUMAN_SOURCE, human: true });
        if (!row.id) row.id = 'human:' + body.slice(0, 24);
        list.push(row);
        return { state: 'applied', rows: list, changed: [rowKey(row)], channel: channel, why: '' };
    }

    const target = text(req.target);
    if (!target) {
        return { state: 'refused', rows: list, changed: [], channel: channel, why: '没有指定目标条目' };
    }

    if (channel === 'remove') {
        const at = list.findIndex((r) => rowKey(r) === target);
        if (at < 0) {
            return { state: 'noop', rows: list, changed: [], channel: channel, why: '目标条目不在表里' };
        }
        const [gone] = list.splice(at, 1);
        /* 人工补的条目**不许**被 remove 通道悄悄带走：它是用户明确要的，
         *  删它必须走「加上/删掉」这套显式动作，而不是被一次批量清理顺手抹掉。 */
        if (gone && gone.source === HUMAN_SOURCE) {
            return {
                state: 'refused', rows: cloneRows(rows), changed: [], channel: channel,
                why: '目标是人工补的条目 —— 删它必须显式确认（本通道不代替用户下这个决定）'
            };
        }
        return { state: 'applied', rows: list, changed: [target], channel: channel, why: '' };
    }

    /* recompute / recompute-one：改的是**抽取**，不是内容 ——
     *  故本模块只产出「要重抽哪些条目」的清单，实际重抽由调用方（副模型）执行。
     *  两者的差别就是清单的**范围**：单独重算只要那一条，重算要整批。 */
    const batch = Array.isArray(req.batch) ? req.batch.map(String).filter(Boolean) : [];
    const inTable = (id) => list.some((r) => rowKey(r) === id);
    if (!inTable(target)) {
        return { state: 'noop', rows: list, changed: [], channel: channel, why: '目标条目不在表里（无从重算）' };
    }
    const marks = channel === 'recompute-one' ? [target] : (batch.length ? batch.slice() : [target]);
    const valid = marks.filter(inTable);
    if (!valid.length) {
        return { state: 'noop', rows: list, changed: [], channel: channel, why: '要重算的条目一条都不在表里' };
    }
    for (const r of list) {
        if (r && valid.includes(rowKey(r))) {
            r.recompute = true;
            r.recomputeReason = channel;
        }
    }
    return { state: 'applied', rows: list, changed: valid, channel: channel, why: '' };
}

/** 批量：按顺序逐条处置。任一条 `refused` 不会中止其余的（用户一次点了五行，
 *  不该因为其中一行不合法就让另外四行也不生效）—— 但每一行的结论都留档。 */
export function applyCorrections(rows, requests) {
    let list = cloneRows(rows);
    const log = [];
    for (const req of (Array.isArray(requests) ? requests : [])) {
        const r = applyCorrection(list, req);
        list = r.rows;
        log.push({ channel: r.channel, state: r.state, changed: r.changed, why: r.why });
    }
    const counts = { applied: 0, noop: 0, refused: 0 };
    for (const l of log) counts[l.state] += 1;
    return { rows: list, log: log, counts: counts };
}

/** 一行读数。三态分列（压成「处理 N 条」会答不出「有几条其实没动」）。 */
export function correctionLine(counts) {
    if (!counts || typeof counts !== 'object') return '人工纠错：无读数';
    return '人工纠错：生效 ' + (counts.applied || 0) + ' · 无变化 ' + (counts.noop || 0)
        + ' · 拒收 ' + (counts.refused || 0);
}

export default {
    CORRECTION_CHANNELS, HUMAN_SOURCE,
    applyCorrection, applyCorrections, correctionLine
};