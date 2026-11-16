/**
 * 日记检索 —— 唯一桥（v4.157.0 · R22-X5）
 *
 * 纪律：纯函数。按关键词 + 可选日期范围过滤已有日记条目，命中摘要高亮区间回传。
 * 不新建索引；空查询返回全部（由视图决定是否展示）。
 */
import { numOrNull } from './num-gate.js';

const DIARY_SEARCH_FACES = Object.freeze(['empty', 'all', 'results', 'noMatch']);

export function diarySearch(entries, query, range) {
    const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
    if (list.length === 0) return { face: 'empty', hits: [], total: 0 };
    const q = String(query == null ? '' : query).trim().toLowerCase();
    const from = range ? numOrNull(range.from) : null;
    const to = range ? numOrNull(range.to) : null;
    const inRange = (e) => {
        const at = numOrNull(e.storyAt != null ? e.storyAt : e.at);
        if (from != null && (at == null || at < from)) return false;
        if (to != null && (at == null || at > to)) return false;
        return true;
    };
    if (!q && from == null && to == null) {
        return { face: 'all', hits: list.slice(), total: list.length };
    }
    const hits = [];
    for (const e of list) {
        if (!inRange(e)) continue;
        const text = String(e.text != null ? e.text : (e.content != null ? e.content : ''));
        let snippet = text.slice(0, 120);
        if (q) {
            const idx = text.toLowerCase().indexOf(q);
            if (idx < 0) continue;
            const start = Math.max(0, idx - 20);
            snippet = text.slice(start, start + 120);
            hits.push({ entry: e, snippet, hitAt: idx - start });
        } else {
            hits.push({ entry: e, snippet, hitAt: -1 });
        }
    }
    if (hits.length === 0) return { face: 'noMatch', hits: [], total: 0, query: q };
    return { face: 'results', hits, total: hits.length, query: q };
}

export function diarySearchNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '还没有日记';
    if (face === 'all') return `${r.total} 篇日记`;
    if (face === 'noMatch') return `没有找到含「${r.query}」的日记`;
    return `找到 ${r.total} 篇`;
}

export function diarySearchSelfCheck() {
    const bad = [];
    const entries = [
        { text: '今天下雨了', storyAt: 100 },
        { text: '晴天去公园', storyAt: 200 },
        { text: '又下雨了', storyAt: 300 }
    ];
    if (diarySearch([], '雨').face !== 'empty') bad.push('空库应 empty');
    if (diarySearch(entries, '').face !== 'all') bad.push('空查询应 all');
    const r = diarySearch(entries, '雨');
    if (r.face !== 'results' || r.total !== 2) bad.push('关键词命中数错，得 ' + r.total);
    if (diarySearch(entries, '雪').face !== 'noMatch') bad.push('无命中应 noMatch');
    const ranged = diarySearch(entries, '雨', { from: 250, to: 400 });
    if (ranged.total !== 1) bad.push('日期范围过滤错');
    return { ok: bad.length === 0, bad };
}
