/**
 * 通话转写分段回放 —— 唯一桥（v4.157.0 · R22-X4）
 *
 * 纪律：纯函数，把已有转写切成「按说话人分段的回放条目」，不重算转写、不改原文。
 * 时刻读不出时给 null，绝不回落墙钟。
 */
import { numOrNull } from './num-gate.js';

export const CALL_SEG_FACES = Object.freeze(['empty', 'segments', 'invalid']);

export function segmentTranscript(transcript) {
    const arr = Array.isArray(transcript) ? transcript : null;
    if (!arr) return { face: 'invalid', segments: [], talkers: [] };
    if (arr.length === 0) return { face: 'empty', segments: [], talkers: [] };
    const segs = [];
    const talkers = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (!t || typeof t !== 'object') continue;
        const speaker = String(t.speaker == null ? '' : t.speaker).trim() || '未知';
        const text = String(t.text == null ? '' : t.text);
        if (!text) continue;
        if (!seen.has(speaker)) { seen.add(speaker); talkers.push(speaker); }
        segs.push({ index: segs.length, speaker, text, atMs: numOrNull(t.at) });
    }
    if (segs.length === 0) return { face: 'empty', segments: [], talkers: [] };
    return { face: 'segments', segments: segs, talkers };
}

export function callSegNote(r) {
    const face = r && r.face;
    if (face === 'invalid') return '这段转写读不出来';
    if (face === 'empty') return '这通电话没有转写';
    return `${r.talkers.length} 人 / ${r.segments.length} 段`;
}

export function callSegSelfCheck() {
    const bad = [];
    if (segmentTranscript(null).face !== 'invalid') bad.push('非数组应 invalid');
    if (segmentTranscript([]).face !== 'empty') bad.push('空数组应 empty');
    const r = segmentTranscript([
        { speaker: 'A', text: '你好', at: 10 },
        { speaker: 'B', text: '嗯', at: 20 },
        { speaker: 'A', text: '在吗', at: 30 }
    ]);
    if (r.face !== 'segments' || r.segments.length !== 3) bad.push('分段数错');
    if (r.talkers.length !== 2) bad.push('说话人数错');
    if (r.segments[0].atMs !== 10) bad.push('时刻丢失');
    const noAt = segmentTranscript([{ speaker: 'A', text: 'x' }]);
    if (noAt.segments[0].atMs !== null) bad.push('无时刻应为 null 不回落');
    return { ok: bad.length === 0, bad };
}
