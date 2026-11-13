/* ============================================================
 * apps/wechat/chat-view-windowed-stream.js — R21-O1 真·窗口化消息流
 * ------------------------------------------------------------
 * 与 `tailWindowOf` 分层共存，两个上界各管一层：
 *   · `config/list-window.js::tailWindowOf` 管「取多少条**数据**交给渲染」；
 *   · 本模块管「把多少条**节点**物化进 DOM」。
 * 两者不合并成一个常量 —— 合并后「数据窗口」与「节点上界」会互相掩盖：
 * 数据窗口调小会顺带把节点数压下去，于是「节点上界真的生效了吗」这个问题再也测不出来。
 *
 * 【为什么不按固定 68px 估算】
 * 微信气泡高度随文本 / 图片 / 语音 / 红包变化。固定行高会让占位高度与真实内容高度脱节，
 * 滚动位置会在换窗时跳变。故 `computeWindowedRange` 接受稀疏 `heights` 台账（按消息下标），
 * 未测量处用 `avgRowHeight` 兜底；上层每次换窗前把已物化行的
 * `getBoundingClientRect().height` 写回台账，下一轮切片的 offset 就越来越准。
 *
 * 【缓冲区是「一屏像素」而不是「若干行」】
 * 滚动事件在浏览器里先改 `scrollTop`、下一帧才轮到我们的 rAF 重画。若只物化严格可见区间，
 * 那一帧的视口是**空白**（旧窗口已滚出、新窗口还没建）。所以上下各多留一屏的像素缓冲，
 * 让「滚动已发生、重画未到」的那一帧仍有内容可画。缓冲改成 0 ⇒ 白屏帧 ⇒ 负控制必须红。
 * ============================================================ */
import { numOrNull } from '../../config/num-gate.js';
export const WINDOWED_STREAM_KEY = 'wechat-message-render-mode';
export const WINDOWED_STREAM_MODE = Object.freeze({ WINDOWED: 'windowed', FULL: 'full' });
/** 物化节点硬上界：可见区间 + 上下缓冲后再夹到这么多条。 */
export const WINDOWED_STREAM_LIMIT = 40;
/** 未测量行高的兜底值（仅作 fallback，不参与「上界」判定）。 */
export const WINDOWED_STREAM_ROW_HEIGHT = 68;
/** 上下各留几屏像素缓冲。0 = 只物化严格可见区间（负控制：会白屏）。 */
export const WINDOWED_STREAM_OVERSCAN = 1;

export function normalizeStreamMode(value) {
    return value === WINDOWED_STREAM_MODE.WINDOWED ? WINDOWED_STREAM_MODE.WINDOWED : WINDOWED_STREAM_MODE.FULL;
}

/** 单行高度：台账里有正数就用台账，否则用均值兜底。 */
function rowHeightAt(heights, index, avg) {
    const raw = Array.isArray(heights) ? heights[index] : null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return (Number.isFinite(n) && n > 0) ? n : avg;
}

/** 前缀偏移：`offsets[i]` = 第 0..i-1 条的高度和（i 可等于 count）。 */
function buildOffsets(count, heights, avg) {
    const offsets = new Array(count + 1);
    offsets[0] = 0;
    for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + rowHeightAt(heights, i, avg);
    return offsets;
}

/** 找到第一个满足 `offsets[i + 1] > target` 的下标。 */
function firstIndexAfter(offsets, target) {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] > target) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

/** 找到第一个满足 `offsets[i] >= target` 的下标。 */
function firstIndexAtOrAfter(offsets, target) {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] >= target) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

/**
 * 计算本次要物化的区间。`endIndex` 为**开区间**。
 * @param {number} total 消息总条数
 * @param {number} scrollTop 容器当前滚动位移（px）
 * @param {number} viewportHeight 容器可视高度（px）
 * @param {{rowHeight?:number, avgRowHeight?:number, heights?:number[],
 *          overscan?:number, overscanPx?:number, maxNodes?:number}} [opts]
 * @returns {{startIndex:number,endIndex:number,totalCount:number,totalHeight:number,
 *            topSpacer:number,bottomSpacer:number,visibleStart:number,visibleEnd:number,
 *            avgRowHeight:number}}
 */
export function computeWindowedRange(total, scrollTop, viewportHeight, opts = {}) {
    const count = Math.max(0, Math.floor(Number(total) || 0));
    const fallbackRow = Math.max(1, Number(opts.rowHeight) || WINDOWED_STREAM_ROW_HEIGHT);
    const avg = Math.max(1, Number(opts.avgRowHeight) || fallbackRow);
    const heights = Array.isArray(opts.heights) ? opts.heights : [];
    const maxNodes = opts.maxNodes === Infinity ? Infinity : Math.max(1, Math.floor(Number(opts.maxNodes) || WINDOWED_STREAM_LIMIT));
    const top = Math.max(0, Number(scrollTop) || 0);
    const height = Math.max(1, Number(viewportHeight) || 640);
    /* 缓冲区：优先像素（一屏），其次行数。两者都允许显式设 0（负控制用）。 */
    const screensRaw = numOrNull(opts.overscan);
    const overscanScreens = screensRaw === null ? WINDOWED_STREAM_OVERSCAN : Math.max(0, screensRaw);
    const pxRaw = numOrNull(opts.overscanPx);
    const overscanPx = pxRaw === null ? overscanScreens * height : Math.max(0, pxRaw);

    const offsets = buildOffsets(count, heights, avg);
    const totalHeight = offsets[count];

    const visibleStart = Math.min(count, firstIndexAfter(offsets, top));
    const visibleEnd = Math.min(count, Math.max(visibleStart, firstIndexAtOrAfter(offsets, top + height)));

    let startIndex = Math.max(0, firstIndexAfter(offsets, top - overscanPx));
    let endIndex = Math.min(count, Math.max(startIndex, firstIndexAtOrAfter(offsets, top + height + overscanPx)));
    if (endIndex <= startIndex && count > 0) {
        /* 空视口 / 极高单行：至少保留可见区间的第一条，避免零节点。 */
        endIndex = Math.min(count, startIndex + 1);
    }
    if (endIndex - startIndex > maxNodes) {
        const center = Math.floor((visibleStart + visibleEnd) / 2);
        startIndex = Math.max(0, Math.min(count - maxNodes, center - Math.floor(maxNodes / 2)));
        endIndex = Math.min(count, startIndex + maxNodes);
    }

    return {
        startIndex,
        endIndex,
        totalCount: count,
        totalHeight,
        topSpacer: offsets[startIndex],
        bottomSpacer: Math.max(0, totalHeight - offsets[endIndex]),
        visibleStart,
        visibleEnd,
        avgRowHeight: avg,
    };
}

/** 把区间映射成 `{item, index}`，`index` 保留**全局**下标（不是窗口内相对下标）。 */
export function windowItems(items, range) {
    const list = Array.isArray(items) ? items : [];
    const start = Math.max(0, Math.min(list.length, Number(range?.startIndex) || 0));
    const end = Math.max(start, Math.min(list.length, Number(range?.endIndex) || 0));
    return list.slice(start, end).map((item, offset) => ({ item, index: start + offset }));
}
