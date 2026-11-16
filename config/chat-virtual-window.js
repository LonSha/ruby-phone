/**
 * 聊天窗口化上界 —— 唯一桥（v4.157.0 · R22-O1）
 *
 * 纪律：纯函数，回答「给定总数/滚动位置/窗口大小，该物化哪些下标，DOM 上界多少」。
 * 不改渲染，只给切窗结果；配合既有 60fps scroller 一起用。上界恒 ≤ windowSize+overscan*2。
 */
import { numOrNull } from './num-gate.js';

export const VWINDOW_LIMITS = Object.freeze({ defaultWindow: 40, maxOverscan: 10 });

export function virtualWindow(total, scrollTop, itemHeight, opts) {
    const n = numOrNull(total);
    if (n == null || n <= 0) return { start: 0, end: 0, count: 0, upperBound: 0, face: 'empty' };
    const ih = numOrNull(itemHeight) || 1;
    const h = numOrNull(scrollTop) || 0;
    const windowSize = Math.max(1, Math.floor(numOrNull(opts && opts.windowSize) || VWINDOW_LIMITS.defaultWindow));
    const overscan = Math.min(VWINDOW_LIMITS.maxOverscan, Math.max(0, Math.floor(numOrNull(opts && opts.overscan) || 0)));
    const firstVisible = Math.max(0, Math.floor(h / ih));
    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(n, start + windowSize + overscan * 2);
    const count = end - start;
    return {
        start, end, count,
        upperBound: windowSize + overscan * 2,
        face: count > 0 ? 'window' : 'empty'
    };
}

function virtualWindowNote(r) {
    if (!r || r.face === 'empty') return '没有消息';
    return `物化 ${r.count} 条（DOM 上界 ${r.upperBound}）`;
}

export function chatVirtualWindowSelfCheck() {
    const bad = [];
    if (virtualWindow(0, 0, 10).face !== 'empty') bad.push('空应 empty');
    const w = virtualWindow(1000, 0, 50, { windowSize: 40 });
    if (w.start !== 0 || w.count !== 40) bad.push('顶部窗口错');
    if (w.count > w.upperBound) bad.push('物化数超上界');
    const mid = virtualWindow(1000, 500 * 50, 50, { windowSize: 40, overscan: 5 });
    if (mid.start !== 495) bad.push('中部起点错，得 ' + mid.start);
    if (mid.count > mid.upperBound) bad.push('带 overscan 超上界');
    const tail = virtualWindow(100, 99999, 50, { windowSize: 40 });
    if (tail.end > 100) bad.push('尾部不得越界');
    return { ok: bad.length === 0, bad };
}
