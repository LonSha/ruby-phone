/* ============================================================
 * keyboard-data.js — [v4.188.0] 像素键盘口癖联想的纯函数内核
 * ------------------------------------------------------------
 * 重构自 pixel-ime-character-slang-predictor.js（30 行）：
 *   commonSlangs 兜底写死（characterSlangProfile.slangs 不是数组就换成笨蛋/才没有/听好了）、
 *   matches.length > 0 ? matches : [p] 把没匹配也当成一条候选（等于输入法在自说自话）、
 *   自己拼 `ime_draft_${draftKey}` 这种散键。
 * 本件：口癖表是数据、不匹配就如实说没匹配、草稿键走单一常量（可登记）。
 * 刻意不做：不兜底、不把没匹配当候选、不持实例字段。
 * ============================================================ */

export const DEFAULT_SLANGS = Object.freeze(['笨蛋', '才没有', '听好了']);
export const KB_LIMITS = Object.freeze({ maxCandidates: 4, maxDraftLen: 2000, maxProfile: 64 });
export const KB_FACE = Object.freeze({ EMPTY: 'empty', CANDIDATES: 'candidates' });
export const KB_REJECT = Object.freeze({
    notArray: 'not_array',
    notString: 'not_string',
    emptyQuery: 'empty_query',
    tooLong: 'too_long'
});

/** 草稿键：单一常量，进 keys-audit 登记，不再散拼。 */
export const IME_DRAFT_KEY = 'ime_draft_v1';

function norm(v) { return String(v).toLowerCase(); }

/** 口癖表归一：不是数组就拒（不兜底成笨蛋三连）。 */
export function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return { slangs: [], ok: false, reason: KB_REJECT.notArray };
    if (!Array.isArray(profile.slangs)) return { slangs: [], ok: false, reason: KB_REJECT.notArray };
    const slangs = [];
    for (const s of profile.slangs) {
        if (typeof s !== 'string' || !s.trim()) continue;
        if (slangs.length >= KB_LIMITS.maxProfile) break;
        slangs.push(s);
    }
    return { slangs, ok: true, reason: null };
}

/** 面态：有没有候选。 */
export function readKbFace(candidates) {
    return (Array.isArray(candidates) && candidates.length) ? KB_FACE.CANDIDATES : KB_FACE.EMPTY;
}

/** 联想：前缀为空 -> 给表里前几条；有前缀 -> 只给真以它开头的；一个都不中就如实空。 */
export function predictCandidates(prefix, profile) {
    const p = typeof prefix === 'string' ? prefix.trim() : '';
    if (p.length > KB_LIMITS.maxDraftLen) return { ok: false, reason: KB_REJECT.tooLong, candidates: [] };
    const pr = normalizeProfile(profile);
    if (!pr.ok) return { ok: false, reason: pr.reason, candidates: [] };
    if (!pr.slangs.length) return { ok: false, reason: KB_REJECT.notArray, candidates: [] };
    const q = norm(p);
    let out;
    if (!q) out = pr.slangs.slice(0, KB_LIMITS.maxCandidates);
    else out = pr.slangs.filter((s) => norm(s).indexOf(q) >= 0).slice(0, KB_LIMITS.maxCandidates);
    if (!out.length) return { ok: false, reason: KB_REJECT.emptyQuery, candidates: [] };
    return { ok: true, reason: null, candidates: out };
}

/** 草稿长度校验：超长拒收，不静默截断。 */
export function checkDraft(text) {
    const t = typeof text === 'string' ? text : '';
    if (!t) return { ok: true, reason: null, text: '' };
    if (t.length > KB_LIMITS.maxDraftLen) return { ok: false, reason: KB_REJECT.tooLong, text: '' };
    return { ok: true, reason: null, text: t };
}

/** 注入面：只给候选计数读数（几个词表 / 本次几个候选）。零叙事。 */
export function kbPromptBlock(candidates, profile) {
    const pr = normalizeProfile(profile);
    const out = ['[输入法联想·事实读数]'];
    out.push('口癖表 ' + pr.slangs.length + ' 条');
    const c = Array.isArray(candidates) ? candidates : [];
    out.push('本次候选 ' + c.length + ' 条');
    for (const s of c) out.push('- ' + s);
    return out;
}
