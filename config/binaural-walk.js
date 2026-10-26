/* ============================================================
 * config/binaural-walk.js — [v4.88.0] 出声才走位（双耳声像）
 * ------------------------------------------------------------
 * 缝合自 Saekisui/binaural-voice（binaural_voice.py:34-46，MIT）。
 *
 * ── 源在治什么 ──────────────────────────────────────────
 *   双耳声像（左右声道差）如果**按墙钟推进**，说话人停顿的那两秒声像还在
 *   慢慢挪 —— 听感像「人声停了，但有个东西还在动」。源改成**只在出声时推进**：
 *   10ms 帧算 RMS，> 峰值 5% 判为出声；出声段短于 0.4s 的小缝并入相邻段；
 *   声像位置用 0.2s 平滑，累计的**出声时长**做插值轴（`tau`）。
 *
 * ── 本件在本仓的落点与差异 ───────────────────────────────
 *   本仓没有音频线程，声像最终落在 CSS/WebAudio 的一个 `pan` 值上。故本件
 *   只做**判定与推进**：给一帧的 RMS 与当前状态，回答「这一帧算不算出声、
 *   tau 推进多少、pan 该是多少」。
 *   三处与源的差异，逐条写后果：
 *     ① 峰值要由调用方维护（源的峰值来自整段音频）。本件用**运行峰值**入参，
 *        缺失时按「这一帧就是峰值」处理（峰值未知不该把整段判成静音）。
 *     ② 平滑系数保留 0.2s 的**时间语义**（按帧长换算），不写死每帧常数 ——
 *        帧长一变（10ms→20ms）常数写法会让平滑速度翻倍。
 *     ③ 「小缝并入」在本件落成 `pendingGapMs`：缝隙先记着不立刻判定静音，
 *        达到 0.4s 才真停。这样停顿不会被切成碎振。
 *
 * ── 输出纪律 ────────────────────────────────────────────
 *   `pan` 恒在 [-1, 1]，`tau` 单调不减（暂停不倒退轴），`speaking=false` 时
 *   `pan` **保持上一帧**（不回正）—— 回正会造出「一停就居中」的假动作。
 * ============================================================ */

/** 判出声的阈值：相对峰值的比例（源 5%）。 */
export const BW_SPEAK_RATIO = 0.05;
/* [v4.88.0 · 第七批缝入] 数值取值门（弱口径清零）。 */
import { numOrNull } from './num-gate.js';
/** 缝隙并入上限（毫秒，源 0.4s）。超过它才真算停顿。 */
export const BW_GAP_MERGE_MS = 400;
/** 位置平滑时间常数（毫秒，源 0.2s）。 */
export const BW_SMOOTH_MS = 200;
/** 默认帧长（毫秒，源 10ms）。 */
export const BW_FRAME_MS = 10;

/** 夹到 [-1, 1]，非数返回 null。 */
export function clampPan(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(-1, n));
}

/** 初始状态。 */
export function initialWalkState(pan = 0) {
    return {
        pan: clampPan(pan) ?? 0,
        tauMs: 0,
        speaking: false,
        pendingGapMs: 0,
        frames: 0,
        spokeFrames: 0
    };
}

/**
 * 推一帧。
 *
 * @param {object} state 当前状态（initialWalkState 的返回值或其演进）
 * @param {object} frame {rms, peakRms, targetPan, frameMs}
 * @param {object} opts  {speakRatio, gapMergeMs, smoothMs}
 * @returns {{speaking:boolean, pan:number, tauMs:number, advancedMs:number,
 *            pendingGapMs:number, gapMerged:boolean, reason:string}}
 *   `advancedMs` = 这一帧 tau 推进了多少（不出声恒 0）。
 */
export function pushWalkFrame(state, frame, opts = {}) {
    const s = state || initialWalkState();
    const f = frame || {};
    const o = opts || {};
    const ratio = numOrNull(o.speakRatio) ?? BW_SPEAK_RATIO;
    const gapMerge = numOrNull(o.gapMergeMs) ?? BW_GAP_MERGE_MS;
    const smoothMs = numOrNull(o.smoothMs) ?? BW_SMOOTH_MS;
    const frameMs = Math.max(1, numOrNull(f.frameMs) ?? BW_FRAME_MS);

    const rms = Number(f.rms);
    const peak = Math.max(0, numOrNull(f.peakRms) ?? rms);
    const loudEnough = Number.isFinite(rms) && Number.isFinite(peak) && peak > 0 && (rms / peak) > ratio;

    const prevPan = clampPan(s.pan) ?? 0;
    const target = clampPan(f.targetPan);
    const prevTau = Math.max(0, Number(s.tauMs) || 0);
    const prevGap = Math.max(0, Number(s.pendingGapMs) || 0);

    if (loudEnough) {
        // 出声：清缝、平滑靠近目标、tau 按帧长推进。
        const k = Math.min(1, frameMs / smoothMs);
        const nextPan = target === null ? prevPan : prevPan + (target - prevPan) * k;
        return {
            speaking: true,
            pan: clampPan(nextPan) ?? prevPan,
            tauMs: prevTau + frameMs,
            advancedMs: frameMs,
            pendingGapMs: 0,
            gapMerged: prevGap > 0,
            reason: 'voiced'
        };
    }

    // 静音帧：先记缝。缝还没到合并上限 ⇒ 仍算在说话里（**轴继续不动，pan 不动**）。
    const gap = prevGap + frameMs;
    if (gap < gapMerge) {
        return {
            speaking: true,
            pan: prevPan,
            tauMs: prevTau,
            advancedMs: 0,
            pendingGapMs: gap,
            gapMerged: true,
            reason: 'gap-merged'
        };
    }

    // 真停顿：不出声、轴不倒退、pan 不回正。
    return {
        speaking: false,
        pan: prevPan,
        tauMs: prevTau,
        advancedMs: 0,
        pendingGapMs: gap,
        gapMerged: false,
        reason: 'silent'
    };
}

/**
 * 位置插值轴：把 tau 映射到 lane 上的位置（0..1），供上层换 pan。
 * tau 为 0 时给起始位而不是 NaN。
 */
export function laneProgress(tauMs, totalSpeakMs) {
    const t = Number(tauMs);
    const total = Number(totalSpeakMs);
    if (!Number.isFinite(t) || t <= 0) return 0;
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.min(1, t / total);
}