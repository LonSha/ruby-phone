/**
 * 电子书阅读进度 —— 唯一桥（v4.157.0 · R22-X9）
 *
 * 纪律：只算「读到哪了、百分比、下次接着读的定位」，不写存储（进度落盘归宿主）。
 * 进度用 chapter+offset 的章节内定位，不依赖具体渲染实现。
 */
import { numOrNull } from './num-gate.js';

export const READING_PROGRESS_FACES = Object.freeze(['unstarted', 'reading', 'finished', 'unavailable']);

export function readingProgress({ book, progress } = {}) {
    const b = book && typeof book === 'object' ? book : null;
    if (!b) return { face: 'unavailable', pct: 0 };
    const totalCh = numOrNull(b.chapterCount);
    if (totalCh == null || totalCh <= 0) return { face: 'unavailable', pct: 0 };
    const p = progress && typeof progress === 'object' ? progress : null;
    const ch = p ? numOrNull(p.chapter) : null;
    const off = p ? numOrNull(p.offset) : null;
    if (ch == null || ch <= 0 || off == null || off < 0) {
        return { face: 'unstarted', pct: 0, totalChapters: totalCh };
    }
    const chapter = Math.min(Math.max(1, Math.floor(ch)), totalCh);
    const withinChapter = Math.max(0, Math.min(1, off));
    const pct = Math.min(100, Math.round(((chapter - 1 + withinChapter) / totalCh) * 1000) / 10);
    const done = chapter >= totalCh && withinChapter >= 1;
    return {
        face: done ? 'finished' : 'reading',
        pct: done ? 100 : pct,
        chapter,
        withinChapter,
        totalChapters: totalCh
    };
}

export function readingProgressNote(r) {
    const face = r && r.face;
    if (face === 'unavailable') return '这本书还读不到页数';
    if (face === 'unstarted') return '还没开始读';
    if (face === 'finished') return '已经读完了';
    return `读到第 ${r.chapter} 章，共 ${r.totalChapters} 章（${r.pct}%）`;
}

export function readingProgressSelfCheck() {
    const bad = [];
    if (readingProgress({}).face !== 'unavailable') bad.push('无书应 unavailable');
    if (readingProgress({ book: { chapterCount: 0 } }).face !== 'unavailable') bad.push('零章节应 unavailable');
    if (readingProgress({ book: { chapterCount: 10 } }).face !== 'unstarted') bad.push('无进度应 unstarted');
    const mid = readingProgress({ book: { chapterCount: 10 }, progress: { chapter: 5, offset: 0.5 } });
    if (mid.face !== 'reading' || mid.chapter !== 5) bad.push('读到一半错');
    if (mid.pct !== 45) bad.push('百分比算错，得 ' + mid.pct);
    const fin = readingProgress({ book: { chapterCount: 10 }, progress: { chapter: 10, offset: 1 } });
    if (fin.face !== 'finished' || fin.pct !== 100) bad.push('读完态错');
    return { ok: bad.length === 0, bad };
}
