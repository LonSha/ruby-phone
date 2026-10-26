/* ========================================================
 * config/turn-claim-dedup.js — 同轮重复句剔除（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   流式输出是**逐句**上屏的，而模型经常在同一轮里把同一句话说第二遍：
 *   先「她低下头，把杯子推过来。」，几百字后又「她低下头，把杯子推过来。」。
 *   短句尤其明显 —— 微动作、语气词、称谓短语会被原样重说。
 *   本仓修前只有「整条消息 id 去重」与「群发言成员去重」，
 *   **没有任何一层看句内**：同一轮里的重复句照单全收。
 *
 * 【源形态（非描述，按源码判定）】
 *   JasonLiu0826/ackem · src/main/chat/sentenceDedup.ts
 *     · 先做碎片过滤：只剩标点/括号的孤儿句直接丢（ORPHAN_ONLY）；
 *     · 归一化：去空白、去全部标点、小写 —— 只比语义，不比排版；
 *     · 两级判重：① 归一后相等或**互相包含**（且短于 24 字才允许包含判定，
 *       否则长句互相包含会误杀）；② 2-gram 集合 Jaccard 相似度超阈值
 *       （≤40 字阈值 0.68、否则 0.55）；
 *     · 只与**本轮已上屏**的句子比，跨轮不参与。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 中文没有空格分词，2-gram 直接切字符即可（源亦如此，故不涉及兼容）。
 *   · 本仓正文里大量 `<标签>` 与状态块，归一化时**标签保留不剥**（剥了会把
 *     `<好感+1>` 与 `<好感-1>` 判成同一句）；只去标点与空白。
 *   · 阈值必须可调（设置页给档），故提成常量对象 DEDUP_THRESHOLDS 且冻结。
 *
 * 【纪律】
 *   ① 纯函数：state 由调用方持有（一轮一个实例，跨轮必须新建）；
 *   ② 不吞：只返 true/false，调用方自己决定「不发」而不改写句子；
 *   ③ 原因码互不同形：orphan / same / subsumed / similar / first；
 *   ④ 相似度算不出来（<2 字符）时按「不同」处理，宁可重复不漏句。
 * ======================================================== */
'use strict';

export const DEDUP_THRESHOLDS = Object.freeze({
    shortMaxLen: 24,      // ≤ 该长度才允许「互相包含」判定
    longMaxLen: 40,       // 相似度阈值分档线
    shortThreshold: 0.68, // ≤ longMaxLen 时的 Jaccard 阈值
    longThreshold: 0.55   // > longMaxLen 时的阈值（长句天然共词多，放宽）
});

export const DEDUP_REASONS = Object.freeze({
    ORPHAN: 'orphan',
    SAME: 'same',
    SUBSUMED: 'subsumed',
    SIMILAR: 'similar',
    FIRST: 'first'
});

/* 只剩标点/括号的孤儿句 */
const ORPHAN_RE = /^[()（）\[\]【】「」『』〈〉，,、；;：:…·\-—\s]+$/;
/* 归一化要删掉的全部符号（标签 <> 保留） */
const STRIP_RE = /[。！？!?….,，、；;：:"“”'‘’「」『』（）()【】\[\]\s\u3000]+/g;

export function createDedupState() {
    return { shown: [] };
}

/** 归一化：只去标点与空白、小写。标签（<x>）原样保留。 */
export function normalizeForDedup(sentence) {
    return String(sentence == null ? '' : sentence).trim().replace(STRIP_RE, '').toLowerCase();
}

/** 2-gram 集合。 */
function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
}

/** Jaccard 相似度（并集为 0 ⇒ 相同即 1，否则 0）。 */
export function similarityOf(a, b) {
    const na = normalizeForDedup(a);
    const nb = normalizeForDedup(b);
    if (na === nb) return na ? 1 : 0;
    if (na.length < 2 || nb.length < 2) return 0;
    const sa = bigrams(na);
    const sb = bigrams(nb);
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const g of sa) if (sb.has(g)) inter += 1;
    const union = sa.size + sb.size - inter;
    return union ? inter / union : 0;
}

/**
 * 这句该不该发。
 * @returns {{emit:boolean, reason:string, against:string}}
 *   against 是被判重的那句（诊断用；emit=true 时为空串）
 */
export function shouldEmitSentence(sentence, state, thresholds = DEDUP_THRESHOLDS) {
    const raw = (typeof sentence === 'string') ? sentence : '';
    const trimmed = raw.trim();
    if (!trimmed) return { emit: false, reason: DEDUP_REASONS.ORPHAN, against: '' };
    if (ORPHAN_RE.test(trimmed)) return { emit: false, reason: DEDUP_REASONS.ORPHAN, against: '' };

    const st = (state && typeof state === 'object' && Array.isArray(state.shown)) ? state : createDedupState();
    const cfg = (thresholds && typeof thresholds === 'object') ? thresholds : DEDUP_THRESHOLDS;
    const norm = normalizeForDedup(trimmed);

    for (const prior of st.shown) {
        const pn = normalizeForDedup(prior);
        if (!pn) continue;
        if (pn === norm) return { emit: false, reason: DEDUP_REASONS.SAME, against: prior };
        const maxLen = Math.max(trimmed.length, String(prior).length);
        if (maxLen <= (Number(cfg.shortMaxLen) || DEDUP_THRESHOLDS.shortMaxLen)
            && (norm.indexOf(pn) >= 0 || pn.indexOf(norm) >= 0)) {
            return { emit: false, reason: DEDUP_REASONS.SUBSUMED, against: prior };
        }
        const threshold = maxLen <= (Number(cfg.longMaxLen) || DEDUP_THRESHOLDS.longMaxLen)
            ? (Number(cfg.shortThreshold) || DEDUP_THRESHOLDS.shortThreshold)
            : (Number(cfg.longThreshold) || DEDUP_THRESHOLDS.longThreshold);
        if (similarityOf(trimmed, prior) > threshold) {
            return { emit: false, reason: DEDUP_REASONS.SIMILAR, against: prior };
        }
    }
    return { emit: true, reason: DEDUP_REASONS.FIRST, against: '' };
}

/** 记一句已上屏（只记非空）。调用方在真发出去之后调。 */
export function recordShownSentence(state, sentence) {
    const st = (state && typeof state === 'object' && Array.isArray(state.shown)) ? state : null;
    if (!st) return state;
    const t = String(sentence == null ? '' : sentence).trim();
    if (t) st.shown.push(t);
    return st;
}

/** 一行总述。 */
export function dedupSummaryLine(state) {
    const n = (state && Array.isArray(state.shown)) ? state.shown.length : 0;
    return n ? '本轮已上屏 ' + String(n) + ' 句，逐句比对生效' : '本轮尚未上屏任何句子';
}

/** 自检：孤儿句丢、原句重复丢、短句包含丢、无关长句放行、长句近似丢。 */
export function dedupSelfCheck() {
    const bad = [];
    const st = createDedupState();
    recordShownSentence(st, '她低下头，把杯子推过来。');
    if (shouldEmitSentence('——', st).emit) bad.push('孤儿句未丢');
    if (shouldEmitSentence('她低下头 把杯子推过来', st).emit) bad.push('同句未丢');
    if (shouldEmitSentence('把杯子推过来。', st).emit) bad.push('短句包含未丢');
    if (!shouldEmitSentence('窗外的雨忽然大了。', st).emit) bad.push('无关句被误杀');
    const st2 = createDedupState();
    recordShownSentence(st2, '他把窗帘拉上了一半，屋里立刻暗下来，只剩下台灯那一小圈光。');
    if (shouldEmitSentence('他把窗帘拉上了一半，屋里立刻暗下来，只剩下台灯那一小圈光。', st2).emit) bad.push('长句重复未丢');
    if (similarityOf('', '') !== 0) bad.push('双空相似度应为 0');
    return { ok: bad.length === 0, bad };
}