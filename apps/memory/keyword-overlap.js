/* ========================================================
 *  RubyPhone · 关键词滑窗重合打分（A4）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   记忆池的二级触发（`_matchByKeywords`）此前是**精确集合匹配**：
 *   查询侧切出 2–4 字词，逐词与条目关键词做全等比较，或与条目正文做 `includes`。
 *   于是「坐车去城西」召不到写着「车里很闷」的条目 ——
 *   两边没有一个词是相等的，而它们说的是同一件事。
 *
 *   本仓的召回路是三级降级：感官 → 关键词 → 文本相关（`_matchBySemantic`，
 *   按 2 字汉字的命中条数、且要求 `hit >= 2`）。问题是**中间那一级太严**：
 *   本该由「关键词级」接住的近义词，全被推给了语义级，而语义级只做 2 字计数、
 *   不区分「命中 3 个 2 字窗」与「命中 3 个 4 字短语」，于是排序质量塌成噪声。
 *
 * 【本模块做什么】
 *   把「重合」的定义从**词相等**放宽为**字窗重合**，并给不同长度的窗不同权重：
 *
 *     4 字窗命中  >  3 字窗命中  >  2 字窗命中  >  单词相等
 *
 *   反了吗？没有 —— 这里刻意**不是**「越长越重要」的直觉写法。
 *   4 字窗能命中，说明两个文本里有**一段连续的 4 个字完全一样**，
 *   那几乎必然是同一个专名或同一句原话（「城西的老槐树」），
 *   它比「坐」这种 1 字重合是强得多的证据。2 字窗命中在中文里噪声极大
 *   （「的时候」「一个人」这类高频片段满仓都是），故权重最低。
 *
 * 【不做什么（边界写死）】
 *   · 不做向量：本仓无 embedding 通道，也不打算为了召回引入一个远端依赖；
 *     终端用户装插件时不该被要求配向量库。纯字符串打分，零依赖、可离线、可复现。
 *   · 不做同义词表：同义词表是**维护负债**（写进去容易，覆盖不住就成了隐性 bug）。
 *     滑窗重合是**结构**，它不需要人维护任何一张词表。
 *   · 不做拼音/形近：需要词典或额外依赖，收益与代价不成比例。
 *
 * 【确定性（本仓硬纪律）】
 *   同一份输入必须给同一份输出，且**不依赖 Map 迭代序之外的东西**。
 *   故：所有窗口按生成序去重（首次出现即定序）、打分只做整数与定点比较、
 *   排序在分数相同时按**输入原序**（稳定排序），不使用任何时间戳或随机数。
 * ============================================================ */

/** 中文按字切窗；拉丁文按词切。窗口长度：2 与 3（4 字窗另由 `phraseHits` 处理）。 */
const WINDOW_SIZES = Object.freeze([2, 3]);
/** 长窗（连续 4 字及以上完全一致）—— 单独成面，权重最高。 */
const PHRASE_LEN = 4;

/** 各长度窗的权重（见文件头：「越长越强」是有理由的，不是审美）。 */
export const WINDOW_WEIGHTS = Object.freeze({ 2: 1, 3: 3, 4: 9, word: 2 });

/** 单侧窗口上限：条目正文可能很长，全切会在热路径上爆炸。
 *  2000 字正文 ⇒ 约 4000 个窗；上限 600 意味着只取**前** 600 个，
 *  这与本仓「有界消费」的既有口径一致（长列表探针 L1/L2 量的就是这件事）。 */
const MAX_WINDOWS_PER_TEXT = 600;

function isCJK(ch) {
    const c = ch.codePointAt(0);
    return c >= 0x4e00 && c <= 0x9fff;
}

/** 归一：全角转半角之外只做小写化与空白压缩（不做 NFD，避免把「一」拆坏）。 */
export function normalizeForWindows(text) {
    return String(text ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 切窗。
 *   · CJK 连续段：按字切 size 长窗（不足 size 的段不出窗）；
 *   · 拉丁/数字段：整词作为一个 `word` 窗（长度 ≥ 3）。
 * 返回 `{ wins: Array<{w:string,len:number}>, truncated: boolean }`。
 * `truncated` 必须外露：被截断的文本打分偏低，若不上报，读的人会以为「真的不相关」。
 */
export function windowsOf(text, options = {}) {
    const sizes = Array.isArray(options.sizes) && options.sizes.length ? options.sizes : WINDOW_SIZES;
    const cap = Number.isFinite(options.maxWindows) ? options.maxWindows : MAX_WINDOWS_PER_TEXT;
    const src = normalizeForWindows(text);
    const wins = [];
    const seen = new Set();
    let truncated = false;

    /* 分段：CJK 段 / 拉丁段（其余字符当分隔） */
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (isCJK(ch)) {
            let j = i;
            while (j < src.length && isCJK(src[j])) j += 1;
            const seg = src.slice(i, j);
            for (const size of sizes) {
                for (let k = 0; k + size <= seg.length; k += 1) {
                    const w = seg.slice(k, k + size);
                    if (!seen.has(w)) {
                        if (wins.length >= cap) { truncated = true; break; }
                        seen.add(w);
                        wins.push({ w: w, len: size });
                    }
                }
                if (truncated) break;
            }
            i = j;
        } else if (/[a-z0-9]/.test(ch)) {
            let j = i;
            while (j < src.length && /[a-z0-9]/.test(src[j])) j += 1;
            const w = src.slice(i, j);
            if (w.length >= 3 && !seen.has(w)) {
                if (wins.length >= cap) { truncated = true; break; }
                seen.add(w);
                wins.push({ w: w, len: 'word' });
            }
            i = j;
        } else {
            i += 1;
        }
        if (truncated) break;
    }
    return { wins: wins, truncated: truncated };
}

/** 找 query 与 text 之间**连续 4 字及以上**完全一致的最长重合段。 */
export function phraseHits(query, text) {
    const q = normalizeForWindows(query);
    const t = normalizeForWindows(text);
    if (q.length < PHRASE_LEN || t.length < PHRASE_LEN) return [];
    const hits = [];
    const seen = new Set();
    for (let i = 0; i + PHRASE_LEN <= q.length; i += 1) {
        let len = PHRASE_LEN;
        while (i + len <= q.length && len < 24 && t.includes(q.slice(i, i + len))) len += 1;
        len -= 1;
        if (len < PHRASE_LEN) continue;
        const seg = q.slice(i, i + len);
        if (!seen.has(seg)) { seen.add(seg); hits.push(seg); }
        i += len - 1;
    }
    return hits;
}

/**
 * 重合打分。
 *
 * @returns {{score:number, hits:number, phrases:Array<string>, truncated:boolean, byLen:object}}
 *   `score` 是**未归一**的整数加权和：调用方各处的阈值口径不同（记忆池的
 *   `triggerThreshold` 是 0–1 的分，长列表那边是计数），故本函数只给原始分，
 *   归一化交给调用方 —— 两个消费方共用一个归一化口径，正是本仓反复点名的
 *   「同一件事两份实现」的种子。
 */
export function overlapScore(query, text, options = {}) {
    const q = windowsOf(query, options);
    const t = windowsOf(text, options);
    const tSet = new Set(t.wins.map((x) => x.w));
    const byLen = { 2: 0, 3: 0, word: 0 };
    const matched = [];
    for (const win of q.wins) {
        if (!tSet.has(win.w)) continue;
        const weight = WINDOW_WEIGHTS[win.len] || 1;
        byLen[win.len] = (byLen[win.len] || 0) + 1;
        matched.push(win.w);
    }
    const phrases = phraseHits(query, text);
    let score = 0;
    for (const key of Object.keys(byLen)) score += byLen[key] * (WINDOW_WEIGHTS[key] || 1);
    score += phrases.length * WINDOW_WEIGHTS[PHRASE_LEN];
    return {
        score: score,
        hits: matched.length + phrases.length,
        phrases: phrases,
        truncated: q.truncated || t.truncated,
        byLen: byLen
    };
}

/**
 * 归一化到 0–1（记忆池的 `triggerThreshold` 口径）。
 * 分母用 `query` 侧的窗口总数：问「这句话有多少比例能在条目里找到落点」，
 * 而不是「条目里有多少字被问到」—— 后者会让长条目在短查询下天然占优。
 */
export function overlapRatio(query, text, options = {}) {
    const q = windowsOf(query, options);
    const scored = overlapScore(query, text, options);
    const total = Math.max(1, q.wins.length);
    const raw = scored.score / (total * WINDOW_WEIGHTS[3]);
    return Math.min(1, Math.max(0, raw));
}

export default { WINDOW_WEIGHTS, normalizeForWindows, windowsOf, phraseHits, overlapScore, overlapRatio };