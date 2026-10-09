/* ========================================================
 *  RubyPhone · 角色状态字段与「只记事实」拼表规则（B5 + B7）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   正文里的人物为什么会「不像人」？最常见的原因不是设定少，是**只写了外向行为**：
 *   她做了什么、她说了什么。而人之所以像人，在于**没做出来的那部分** ——
 *   想做的、想问的、怕的、以及**没说出口的那半句**。
 *
 *   但「展现内心」和「写心理活动」是两件相反的事：
 *     · 写心理活动 = 「她心里五味杂陈」⇒ 把结论直接塞给读者，读者没有参与；
 *     · 展现内心 = 她做了三件事，每件都对不上「她其实很喜欢他」——
 *       读者自己拼出来，而拼出来的才是他自己的。
 *   故本模块的裁定是：**字段记状态，台词记外露，正文不写心理**。
 *
 * 【B5：五个字段，一个都不许省】
 *   `doing`（此刻在做）· `want`（想要）· `afraid`（怕）· `will`（接下来会做）
 *   · `unsaid`（没说出口的那句）。前四个是驱动力，第五个是**成品**——
 *   它长得像台词但不是台词：台词是给对方的，`unsaid` 是给对方**听不到的**。
 *   把它写成台词，读者立刻就懂了；作为 `unsaid` 留着，读者才会替她难受。
 *
 * 【B7：拼表规则（这是判据，不是风格）】
 *   拼给人看的那张表，只许出现**可核事实**：谁在哪儿、什么时刻、做了什么、
 *   说了什么。凡是「她其实」「暗自」「不由得」一律不得进表 ——
 *   因为表是**同一份事实在多处的共同底座**（正文 / 档案 / 记忆块都读它），
 *   一旦掺进推断，「事实」与「猜测」从此不能分离。
 *
 * 【三态互不同形】
 *   每格三态：`set`（有值）/ `empty`（这一格为空，**是读数**）/ `absent`（这一格根本不在）。
 *   把 `absent` 报成 `empty`，调用方会以为「模型想过这一格、结论是空」——
 *   而它其实**没被要求过**，下一轮还会缺。
 * ============================================================ */

/** 五个状态字段（顺序即展示顺序）。 */
export const STATE_FIELDS = Object.freeze([
    { id: 'doing', label: '此刻在做', note: '手上有动作，读者才有画面' },
    { id: 'want', label: '想要', note: '驱动下一句' },
    { id: 'afraid', label: '怕', note: '决定她不说哪句' },
    { id: 'will', label: '接下来会做', note: '给下一场留线头' },
    { id: 'unsaid', label: '没说出口', note: '长得像台词，但对方听不到' }
]);

const FIELD_IDS = Object.freeze(STATE_FIELDS.map((f) => f.id));

/** 事实字段白名单（B7）。表里只许有这些键。 */
export const FACT_KEYS = Object.freeze([
    'who', 'when', 'where', 'what', 'said', 'did', 'amount', 'object', 'promise'
]);

/** 推断键黑名单：**出现在表里即判红**。它们每一个都对应一种「写心理」。 */
export const INFERENCE_KEYS = Object.freeze([
    'thought', 'feeling', 'inner', 'mood', 'intent', 'unspoken',
    '心理', '感受', '内心', '情绪', '其实', '暗自'
]);

function text(v) {
    return String(v ?? '').trim();
}

/** 一格的处置：`set` / `empty` / `absent` —— 三态互不同形。 */
export function fieldState(fields, id) {
    const key = text(id);
    if (!FIELD_IDS.includes(key)) return { state: 'absent', value: '', why: '不认识的字段：' + key };
    if (!fields || typeof fields !== 'object' || !(key in fields)) {
        return { state: 'absent', value: '', why: '这一格不在（模型没被要求过）' };
    }
    const v = text(fields[key]);
    if (!v) return { state: 'empty', value: '', why: '这一格为空（是读数：被问过，答案是没有）' };
    return { state: 'set', value: v, why: '' };
}

/** 五格逐格成形（缺格如实报 absent，不编）。 */
export function readStateFields(fields) {
    const rows = STATE_FIELDS.map((f) => Object.assign({ id: f.id, label: f.label }, fieldState(fields, f.id)));
    const counts = { set: 0, empty: 0, absent: 0 };
    for (const r of rows) counts[r.state] += 1;
    return { rows: rows, counts: counts, complete: counts.set === rows.length };
}

/** 一行读数。三态必须分列（压成「N/5」会答不出「缺的是哪两格」）。 */
export function stateFieldsLine(read) {
    if (!read || !Array.isArray(read.rows)) return '状态字段：无读数';
    const parts = read.rows.map((r) => (r.state === 'set' ? r.label + '=' + r.value
        : (r.state === 'empty' ? r.label + '（空）' : r.label + '（缺）')));
    return '状态字段：' + parts.join(' · ');
}

/**
 * B7 拼表规则：把「人给的表」筛成「事实表」。
 *
 * @param {Array} rows 待拼的表行（对象）
 * @param {{allowKeys?:string[], keepUnknown?:boolean}} options
 * @returns {{rows:Array, dropped:Array, keys:Array, pure:boolean}}
 *   `dropped` 每条带 `reason`：`inference`（推断键）/ `nonfact`（不在事实白名单）
 *   / `empty`（整行为空）。三条处置方向不同，不压成一格。
 */
export function factOnlyRows(rows, options = {}) {
    const allow = new Set((Array.isArray(options.allowKeys) && options.allowKeys.length)
        ? options.allowKeys.map(String) : FACT_KEYS.slice());
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    const dropped = [];
    const keys = new Set();
    for (const row of list) {
        if (!row || typeof row !== 'object') {
            dropped.push({ row: row, reason: 'empty' });
            continue;
        }
        const kept = {};
        let inference = '';
        let nonfact = '';
        let any = false;
        for (const [k, v] of Object.entries(row)) {
            if (INFERENCE_KEYS.includes(String(k))) { inference = String(k); continue; }
            if (!allow.has(String(k))) { nonfact = String(k); continue; }
            const s = text(v);
            if (!s) continue;
            kept[k] = v;
            keys.add(String(k));
            any = true;
        }
        if (inference) { dropped.push({ row: row, reason: 'inference', key: inference }); continue; }
        if (!any) { dropped.push({ row: row, reason: nonfact ? 'nonfact' : 'empty', key: nonfact }); continue; }
        if (nonfact) {
            /* 有事实键、也有非事实键：**保留事实部分**并把非事实键报出来 ——
             *  整行丢掉会把真事实一起丢掉（那是判据过宽），静默留下又不诚实。 */
            dropped.push({ row: row, reason: 'nonfact', key: nonfact, partial: true });
        }
        out.push(kept);
    }
    return {
        rows: out, dropped: dropped, keys: Array.from(keys).sort(),
        pure: dropped.every((d) => d.partial === true)
    };
}

/** 一行读数（拼表）。 */
export function factRowsLine(result) {
    if (!result || !Array.isArray(result.rows)) return '事实表：无读数';
    const inf = result.dropped.filter((d) => d.reason === 'inference').length;
    const non = result.dropped.filter((d) => d.reason === 'nonfact').length;
    const emp = result.dropped.filter((d) => d.reason === 'empty').length;
    const parts = ['事实行 ' + result.rows.length, '键 ' + result.keys.length];
    if (inf) parts.push('剔除推断行 ' + inf);
    if (non) parts.push('剔除非事实键 ' + non);
    if (emp) parts.push('剔除空行 ' + emp);
    return '事实表：' + parts.join(' · ');
}

export default {
    STATE_FIELDS, FACT_KEYS, INFERENCE_KEYS,
    fieldState, readStateFields, stateFieldsLine,
    factOnlyRows, factRowsLine
};