/* ============================================================
 * config/voice-familiarity.js — [v4.88.0] 说话人歧义边距
 * ------------------------------------------------------------
 * 缝合自 akinia0315/voice-familiarity（service.py:39,172、profile_math.py:111，Apache-2.0）。
 *
 * ── 源在治什么 ──────────────────────────────────────────
 *   说话人识别的恶性形态不是「认错」，而是**「认错却不自知」**：冠军分数
 *   0.71、亚军 0.70，差 0.01 也照样判成冠军 —— 换到邻近角色身上，用户听到
 *   的是「明明是 A 在说，界面上是 B」。
 *   源用一条 `ambiguity_margin = 0.035` 把「冠军减亚军 < 阈值」判成
 *   **两人无法区分**，输出 `ambiguous` 而不是硬选；且**阈值不是硬编码常量**，
 *   由 `genuine_floor - 0.12` 动态校准（人声下限越低、阈值越严）。
 *
 * ── 本件怎么落 ──────────────────────────────────────────
 *   · 五态互不相同、不得塌成两态：
 *       match（冠军明确）/ ambiguous（分不开）/ below-floor（都在人声下限下，谁都不像）
 *       / no-candidates（没有候选）/ malformed（分数畸形）
 *     把 below-floor 与 ambiguous 分开的理由：前者「都不像」，后者「都像」，
 *     处置相反（前者该问「这是谁」，后者该问「A 还是 B」）。
 *   · **动态边距**照搬源的校准式，并把 `genuineFloor` 的来源保留为入参
 *     （本仓没有离线声纹库，下限由调用方按 TTS/角色卡给）。
 *   · 纯函数、零宿主、零 DOM。
 *
 * ── 源里不搬的一半（写明后果）──────────────────────────
 *   源的 profile_math.py 含声纹嵌入与持久化档案（numpy 向量 + 档案库）。
 *   本仓无特征提取器，故本件只吃**已算好的分数对**（`[{id, score}]`）；
 *   向量与档案由调用方持有。搬 numpy 进前端是第二套数值栈，不是这里该做的。
 * ============================================================ */

/** 默认歧义边距（源 0.035）。 */
export const VF_DEFAULT_MARGIN = 0.035;

/** 边距动态校准：`genuineFloor - 0.12`（源 profile_math.py）。 */
export const VF_MARGIN_OFFSET = 0.12;

/** 边距下限：校准结果不得低于它，否则边距趋零等于「不再判歧义」。 */
export const VF_MARGIN_FLOOR = 0.01;

/** 人声下限默认值（低于它的一律「不像人声」，源口径）。 */
export const VF_DEFAULT_GENUINE_FLOOR = 0.45;

/** 判定状态。 */
export const VF_STATES = Object.freeze({
    MATCH: 'match',
    AMBIGUOUS: 'ambiguous',
    BELOW_FLOOR: 'below-floor',
    NO_CANDIDATES: 'no-candidates',
    MALFORMED: 'malformed'
});

/** 取数口径：本件不摸 num-gate（配置件互不 import 的既有习惯），
 *  但只认真正的 number 与纯数字串，`null`/`[]`/`false` 一律算「没给」。 */
function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * 按人声下限校准边距。
 * 下限越低 ⇒ 候选池更松（更多低分混进来）⇒ 边距必须更严。
 * @returns {{margin:number, source:string, floor:number|null}}
 */
export function calibrateMargin(genuineFloor) {
    const f = num(genuineFloor);
    if (f === null) return { margin: VF_DEFAULT_MARGIN, source: 'default', floor: null };
    const raw = f - VF_MARGIN_OFFSET;
    return { margin: Math.max(VF_MARGIN_FLOOR, raw), source: 'calibrated', floor: f };
}

/**
 * 判定一个说话人识别结果。
 *
 * @param {Array<{id:string, score:number}>} candidates 已算好的分数对
 * @param {object} opts {genuineFloor, margin}
 * @returns {{state:string, pickedId:string|null, bestId:string|null, bestScore:number|null,
 *            runnerUpId:string|null, runnerUpScore:number|null, gap:number|null,
 *            margin:number, marginSource:string, genuineFloor:number|null,
 *            reason:string, needConfirm:boolean}}
 *   `needConfirm` = 是否该向用户提问（ambiguous 与 below-floor 都为真，
 *   但 `reason` 不同 —— 问法不同就不该同形）。
 */
export function judgeSpeakerMatch(candidates, opts = {}) {
    const o = opts || {};
    const cal = calibrateMargin(o.genuineFloor);
    const margin = Number.isFinite(num(o.margin)) ? Math.max(0, num(o.margin)) : cal.margin;
    const floor = cal.floor !== null ? cal.floor : VF_DEFAULT_GENUINE_FLOOR;

    const base = {
        pickedId: null,
        bestId: null,
        bestScore: null,
        runnerUpId: null,
        runnerUpScore: null,
        gap: null,
        margin,
        marginSource: Number.isFinite(num(o.margin)) ? 'explicit' : cal.source,
        genuineFloor: cal.floor,
        needConfirm: true
    };

    if (!Array.isArray(candidates)) {
        return { ...base, state: VF_STATES.MALFORMED, reason: '候选不是数组' };
    }
    const rows = candidates
        .filter(c => c && typeof c === 'object')
        .map(c => ({ id: String(c.id ?? '').trim(), score: num(c.score) }))
        .filter(c => c.id && c.score !== null)
        .sort((a, b) => b.score - a.score);
    if (!rows.length) {
        return { ...base, state: VF_STATES.NO_CANDIDATES, reason: '没有可比较的候选分数' };
    }

    const best = rows[0];
    const second = rows.length > 1 ? rows[1] : null;
    const gap = second ? (best.score - second.score) : null;
    const filled = {
        ...base,
        bestId: best.id,
        bestScore: best.score,
        runnerUpId: second ? second.id : null,
        runnerUpScore: second ? second.score : null,
        gap
    };

    // 都不像人声：谁都不该被选中（此时比「谁更像噪声」没有意义）。
    if (best.score < floor) {
        return {
            ...filled,
            state: VF_STATES.BELOW_FLOOR,
            reason: '最高分 ' + best.score + ' 低于人声下限 ' + floor
        };
    }
    // 只有一个人声候选：谈不上歧义。
    if (!second) {
        return { ...filled, state: VF_STATES.MATCH, pickedId: best.id, reason: '唯一候选', needConfirm: false };
    }
    // 亚军也在下限之上且贴得太近：分不开，**不硬选**。
    if (second.score >= floor && gap < margin) {
        return {
            ...filled,
            state: VF_STATES.AMBIGUOUS,
            reason: '冠亚差 ' + gap.toFixed(4) + ' < 边距 ' + margin.toFixed(4)
        };
    }
    return {
        ...filled,
        state: VF_STATES.MATCH,
        pickedId: best.id,
        reason: '冠亚差 ' + gap.toFixed(4) + ' ≥ 边距 ' + margin.toFixed(4),
        needConfirm: false
    };
}

/** 状态是否算「认出来了」（不含需确认的两种情况）。 */
export function isRecognized(state) {
    return state === VF_STATES.MATCH;
}

/** 状态是否该向用户提问（与 isRecognized 互斥且**不互补**：malformed 谁都不算）。 */
export function needsConfirm(state) {
    return state === VF_STATES.AMBIGUOUS || state === VF_STATES.BELOW_FLOOR;
}