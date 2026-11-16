/**
 * 愿望清单 —— 唯一桥（v4.157.0 · R22-X6）
 *
 * 纪律：纯函数状态机（todo/doing/done），只算列表分组与统计；写盘归宿主。
 * done 时要一句「做到了」，由调用方给剧情时刻。候选不替角色选。
 */
import { numOrNull } from './num-gate.js';

export const WISHLIST_STATES = Object.freeze(['todo', 'doing', 'done']);
const WISHLIST_FACES = Object.freeze(['empty', 'active', 'allDone']);

export function normalizeItems(items) {
    const arr = Array.isArray(items) ? items : [];
    const out = [];
    const seen = new Set();
    for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        const id = String(it.id == null ? '' : it.id).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const state = WISHLIST_STATES.includes(it.state) ? it.state : 'todo';
        out.push({
            id,
            text: String(it.text == null ? '' : it.text),
            state,
            atMs: numOrNull(it.at),
            doneMs: numOrNull(it.doneMs)
        });
    }
    return out;
}

export function wishlistView(items) {
    const list = normalizeItems(items);
    if (list.length === 0) return { face: 'empty', groups: { todo: [], doing: [], done: [] }, counts: { todo: 0, doing: 0, done: 0 } };
    const groups = { todo: [], doing: [], done: [] };
    for (const it of list) groups[it.state].push(it);
    const counts = { todo: groups.todo.length, doing: groups.doing.length, done: groups.done.length };
    const face = counts.todo === 0 && counts.doing === 0 && counts.done > 0 ? 'allDone' : 'active';
    return { face, groups, counts, total: list.length };
}

function wishlistNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '愿望清单还是空的';
    if (face === 'allDone') return `想做的 ${r.counts.done} 件事都做到了`;
    return `还有 ${r.counts.todo + r.counts.doing} 件事想做`;
}

export function wishlistSelfCheck() {
    const bad = [];
    if (wishlistView([]).face !== 'empty') bad.push('空清单应 empty');
    const r = wishlistView([{ id: '1', text: '看海', state: 'todo' }, { id: '2', text: '爬山', state: 'done', doneMs: 5 }]);
    if (r.face !== 'active') bad.push('有未做应 active');
    if (r.counts.todo !== 1 || r.counts.done !== 1) bad.push('计数错');
    const done = wishlistView([{ id: '1', state: 'done' }]);
    if (done.face !== 'allDone') bad.push('全完成应 allDone');
    const badState = normalizeItems([{ id: 'a', state: 'nonsense' }]);
    if (badState[0].state !== 'todo') bad.push('非法状态应回退 todo');
    if (normalizeItems([{ id: 'a' }, { id: 'a' }]).length !== 1) bad.push('重复 id 未去重');
    return { ok: bad.length === 0, bad };
}
