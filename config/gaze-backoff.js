/* ============================================================
 * config/gaze-backoff.js — [v4.88.0] 采集静止退避
 * ------------------------------------------------------------
 * 缝合自 jiangxi1129/gaze（gaze/gaze_local.py:717-770，MIT）。
 *
 * ── 源在治什么 ──────────────────────────────────────────
 *   视觉采集（截图 → 缩略 → 感知哈希）成本按帧线性增长，但**画面没变的时候
 *   调用方的 API 与感知哈希全是白算**。源用「画面静止就拉长间隔」压这件事：
 *   哈希差 < 阈值计入 `static_streak`，连静 3 次之后间隔按
 *   `×(1.5 + 0.3n)` 增长、封顶 120s；**画面一动立刻回到基线间隔**。
 *
 * ── 本仓的处境（与本件的适配点）──────────────────────────
 *   本仓没有 Python 侧采集器，采样由前端/宿主决定，故本件只做**裁决**：
 *   纯函数回答「下一次什么时候采、这一次要不要调 API」。判定与执行分开后，
 *   退避表可以在无头环境里穷举验证，不必依赖真设备。
 *
 * ── 源比对后必须点明的三处差异 ──────────────────────────
 *   ① **前台窗口一换立刻复位**：源的 `reset()` 不只重置间隔，还清
 *      `static_streak`。本件保留这条，并额外要求「换窗口」与「画面动」是
 *      两个不同成因（`window-changed` / `moved`）—— 若两者同形，
 *      「间隔为什么忽然变短」在现场就答不出来。
 *   ② **睡眠段**：源在休眠期改采 ≤1s 的密集帧以便被唤醒即发现。本件的
 *      `sleepIntervalMs` 单调小于基线，并受同一个封顶约束。
 *   ③ **阈值口径**：源用汉明距离（越小越像）。本件沿用「距离」语义，
 *      并显式声明 `null` 距离（哈希算失败）**按静止处理**——算不出就等于
 *      没有「动了」的证据，此时不该冒险调 API。
 *
 * ── 实现约束 ────────────────────────────────────────────
 *   · 纯函数 + 无状态：状态（streak / intervalMs）由调用方持有并回传；
 *   · 不做定时器（本仓 uterus/board 同规），不碰 DOM；
 *   · 一切数值归一在 `clamp` 一处，禁止调用方各写一遍。
 * ============================================================ */

/* [v4.88.0 · 第七批缝入] 数值取值门：弱口径清零，`?? 默认值` 才是「没给」的唯一判据。 */
import { numOrNull } from './num-gate.js';

/** 基线采集间隔（毫秒）。 */
export const GAZE_BASE_INTERVAL_MS = 1000;

/** 判「静止」的距离阈值：小于它算没动。 */
export const GAZE_STATIC_DISTANCE = 6;

/** 开始退避前必须连续静止的次数（源 3）。 */
export const GAZE_STATIC_STREAK_TO_BACKOFF = 3;

/** 退避增长率：`1.5 + 0.3n`。 */
export const GAZE_GROWTH_BASE = 1.5;
export const GAZE_GROWTH_STEP = 0.3;

/** 间隔上限（毫秒，源 120s）。 */
export const GAZE_MAX_INTERVAL_MS = 120000;

/** 睡眠段间隔上限（毫秒）——必须 ≤ 基线，否则「睡不着也叫睡眠段」。 */
export const GAZE_SLEEP_INTERVAL_MS = 900;

/** 一次判定的成因（互不相同、不得塌成两态）。 */
export const GAZE_CAUSES = Object.freeze({
    INIT: 'init',                       // 首帧：无前值
    MOVED: 'moved',                     // 画面动了
    STATIC: 'static',                   // 画面没动（还没到退避线）
    BACKOFF: 'backoff',                 // 连续静止达到退避线，间隔在增长
    CAPPED: 'capped',                   // 已到上限
    WINDOW_CHANGED: 'window-changed',   // 前台窗口换了
    UNKNOWN_DISTANCE: 'unknown-distance' // 哈希算失败：按静止处理
});

/** 归一毫秒数到 [1, GAZE_MAX_INTERVAL_MS]。 */
export function clampInterval(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return GAZE_BASE_INTERVAL_MS;
    return Math.min(GAZE_MAX_INTERVAL_MS, Math.max(1, Math.round(n)));
}

/** 距离是否算「静止」。`null`/非数 ⇒ true（没有「动了」的证据）。 */
export function isStaticDistance(distance, threshold) {
    const t = numOrNull(threshold) ?? GAZE_STATIC_DISTANCE;
    if (distance === null || distance === undefined || distance === '') return true;
    const d = Number(distance);
    if (!Number.isFinite(d)) return true;
    return d < t;
}

/** 按 n 次静���算退避间隔（不封顶，供调用方看真实增长量）。 */
export function backoffIntervalMs(staticStreak, opts = {}) {
    const base = numOrNull(opts.baseIntervalMs) ?? GAZE_BASE_INTERVAL_MS;
    const n = Math.max(0, Math.floor(Number(staticStreak) || 0));
    const factor = GAZE_GROWTH_BASE + GAZE_GROWTH_STEP * Math.max(0, n - GAZE_STATIC_STREAK_TO_BACKOFF + 1);
    return Math.round(base * factor);
}

/** 睡眠段间隔：恒小于基线，且不超过上限。 */
export function sleepIntervalMs(opts = {}) {
    const sleep = numOrNull(opts.sleepIntervalMs) ?? GAZE_SLEEP_INTERVAL_MS;
    const base = numOrNull(opts.baseIntervalMs) ?? GAZE_BASE_INTERVAL_MS;
    return clampInterval(Math.min(Math.max(1, sleep), base));
}

/**
 * 一次采集之后的裁决。
 *
 * @param {object} state { staticStreak, intervalMs, windowKey }
 * @param {object} obs   { distance, windowKey, sleeping }
 * @param {object} opts  { threshold, baseIntervalMs, maxIntervalMs, sleepIntervalMs, backoffAfter }
 * @returns {{cause:string, staticStreak:number, intervalMs:number,
 *            callApi:boolean, windowKey:string|null, reset:boolean, capped:boolean}}
 *   `callApi` = 这一次要不要真调 API（**只有动了才调**）。
 *   `reset` = 状态是否被复位（成因可读，防「为什么突然变快」无从解释）。
 */
export function judgeGazeTick(state, obs, opts = {}) {
    const o = opts || {};
    const prev = state || {};
    const seen = obs || {};
    const threshold = numOrNull(o.threshold) ?? GAZE_STATIC_DISTANCE;
    const maxInterval = numOrNull(o.maxIntervalMs) ?? GAZE_MAX_INTERVAL_MS;
    const backoffAfter = numOrNull(o.backoffAfter) ?? GAZE_STATIC_STREAK_TO_BACKOFF;
    const sleeping = seen.sleeping === true;

    const prevWindow = prev.windowKey === undefined ? null : prev.windowKey;
    const nextWindow = (seen.windowKey === undefined || seen.windowKey === null) ? null : String(seen.windowKey);
    const windowChanged = Boolean(prevWindow && nextWindow && prevWindow !== nextWindow);

    // 睡眠：走密集段，且**不动 streak**（睡眠期画面动与否不代表清醒后的判断）。
    if (sleeping) {
        return {
            cause: GAZE_CAUSES.STATIC,
            staticStreak: Math.max(0, Math.floor(Number(prev.staticStreak) || 0)),
            intervalMs: sleepIntervalMs({ ...o, maxIntervalMs: maxInterval }),
            callApi: false,
            windowKey: nextWindow,
            reset: false,
            capped: false
        };
    }

    // 换窗口：无条件复位（源的 reset 语义），间隔回基线。
    if (windowChanged) {
        return {
            cause: GAZE_CAUSES.WINDOW_CHANGED,
            staticStreak: 0,
            intervalMs: clampInterval(numOrNull(o.baseIntervalMs) ?? GAZE_BASE_INTERVAL_MS),
            callApi: true,
            windowKey: nextWindow,
            reset: true,
            capped: false
        };
    }

    const unknown = seen.distance === null || seen.distance === undefined || seen.distance === ''
        || numOrNull(seen.distance) === null;
    const still = isStaticDistance(seen.distance, threshold);

    if (!still) {
        // 动了：回基线、清 streak、调 API。
        return {
            cause: GAZE_CAUSES.MOVED,
            staticStreak: 0,
            intervalMs: clampInterval(numOrNull(o.baseIntervalMs) ?? GAZE_BASE_INTERVAL_MS),
            callApi: true,
            windowKey: nextWindow,
            reset: true,
            capped: false
        };
    }

    const streak = Math.max(0, Math.floor(Number(prev.staticStreak) || 0)) + 1;
    if (streak < backoffAfter) {
        return {
            cause: unknown ? GAZE_CAUSES.UNKNOWN_DISTANCE : GAZE_CAUSES.STATIC,
            staticStreak: streak,
            intervalMs: clampInterval(prev.intervalMs ?? o.baseIntervalMs),
            callApi: false,
            windowKey: nextWindow,
            reset: false,
            capped: false
        };
    }

    const grew = backoffIntervalMs(streak, o);
    const capped = grew >= maxInterval;
    return {
        cause: capped ? GAZE_CAUSES.CAPPED : GAZE_CAUSES.BACKOFF,
        staticStreak: streak,
        intervalMs: clampInterval(Math.min(grew, maxInterval)),
        callApi: false,
        windowKey: nextWindow,
        reset: false,
        capped
    };
}

/** 初始状态（首帧用；`cause` 恒 init，不调 API）。 */
export function initialGazeState(windowKey, opts = {}) {
    return {
        cause: GAZE_CAUSES.INIT,
        staticStreak: 0,
        intervalMs: clampInterval(numOrNull(opts.baseIntervalMs) ?? GAZE_BASE_INTERVAL_MS),
        callApi: true,
        windowKey: (windowKey === undefined || windowKey === null) ? null : String(windowKey),
        reset: true,
        capped: false
    };
}