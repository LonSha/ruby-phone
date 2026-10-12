/**
 * system-v3980.test.mjs — v3.98.0 · R3-O5 社媒长列表的顺滑浏览
 *
 * 【本版治的是什么（修前实测处境）】
 *   `apps/xhs/xhs-view.js::_renderMasonry` 一直是 `grid.innerHTML = notes.map(...).join('')`，
 *   且每次点赞 `toggleLike()` 之后调它**整列重建**。三件事在 1000 条笔记下同时发作：
 *     ① DOM 一次性建满（1000 张卡 + 1000 个 img ⇒ 进页一次长任务）；
 *     ② 点赞重建全列 ⇒ 滚动位置自然丢（内容被整体换掉）；
 *     ③ 没有增量分页。
 *   已有搜索分片（`global-search-engine`）治的是**检索**，不治渲染 —— 两者不同面。
 *
 * 【本版做什么（不新建性能监控平台、不做虚拟列表库）】
 *   · 新模块 `config/list-window.js`（**纯函数**，零 DOM）：窗口切片 / 局部更新判据 / 态保留读数；
 *   · `xhs-view.js` 改成：首屏窗口 + 滚到底增量追加（`_maybeLoadMore`）
 *     + 点赞只改那一张卡（`_patchLike`）；卡片 HTML 收成**唯一真源**（`_cardHtml`）。
 *
 * 【四态不同形（本仓点名的形态纪律）】
 *   · `notes-not-array`（拿不到列表 ⇒ **判不了**，不是空列表）vs `empty-list`（真的是空的）
 *     vs `has-more` vs `exhausted` —— 四者必须分得开；
 *   · 局部更新：`in-place-only`（只改那几张卡）vs `order-changed` / `items-added` / `items-removed`
 *     （结构变了 ⇒ 如实报需要整列重建，**不硬撑局部更新**）；
 *   · 态保留：`kept` 与 `lost` **逐格具名**（「本来就没记」与「被静默重置」不同形）。
 *
 * 【六面】
 *   A 结构面：模块在位且零 DOM / 零 storage / 数值读数走唯一门（`config/num-gate.js`）
 *   B 行为面：窗口三态 / 局部更新判据 / 态保留读数
 *   C 接线面：xhs-view 三处接线在场（首屏窗口 / 增量追加 / 局部点赞）+ 卡片 HTML 单一真源
 *   D 负控制：真源码副本定点破坏，同款判据必转红
 *   E 版本锚：五源同源（3.98.0）
 *
 * 负控制纪律：真源码破坏用副本（`.__neg__.js` 后缀），锚点 anchorOnce 断言恰中 1 次，
 *   assert.notEqual 确认破坏真发生，process.on('exit') 清理副本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const LW_REL = 'config/list-window.js';
const XHS_REL = 'apps/xhs/xhs-view.js';
const LW = read(LW_REL);
const XHS = read(XHS_REL);
const IDX = read('index.js');
const L = await import(pathToFileURL(path.join(root, LW_REL)).href);
/**
 * 去注释（判据纪律：注释里提过一次会冒充真调用 —— 本档多处断言必须先去注释）。
 * ★ 本档自伤①：首版只剥 `//` 行内注释 ⇒ **块注释里的说明文字被当成真代码**，
 *   A1/A2 两条当场假红（模块头里本来就写了 `window` 与弱口径签名这两个词）。
 *   修法：块注释与行内注释一起剥。
 */
function stripComments(src) {
    let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    out = out.split('\n').map((l) => {
        const i = l.indexOf('//');
        return i >= 0 ? l.slice(0, i) : l;
    }).join('\n');
    return out;
}
/** 锚点恰中 1 次（0 次/多次都抛 —— 破坏写偏与「破坏写死成常量」都不许过）。 */
function anchorOnce(src, anchor, tag) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, '[' + tag + '] 锚点须恰中 1 次，实测 ' + n);
    return n;
}
const NEG_FILES = [];
process.on('exit', () => { for (const f of NEG_FILES) { try { fs.unlinkSync(f); } catch (_e) { /* 已清理 */ } } });
/** 真源码破坏 → 落副本（`.__neg__.js`）→ 返回副本的模块命名空间。 */
async function breakModule(rel, anchor, repl, tag) {
    const src = read(rel);
    anchorOnce(src, anchor, tag);
    const broken = src.replace(anchor, repl);
    assert.notEqual(broken, src, '[' + tag + '] 破坏必须真的改变源码');
    const negRel = rel.replace(/\.js$/, '.__neg__.js');
    const negAbs = path.join(root, negRel);
    fs.writeFileSync(negAbs, broken);
    if (!NEG_FILES.includes(negAbs)) NEG_FILES.push(negAbs);
    return import(pathToFileURL(negAbs).href + '?v=' + Date.now() + '_' + tag);
}
/** 合成笔记（只含卡片视图用得到的字段）。 */
const notesOf = (n) => Array.from({ length: n }, (_, i) => ({
    id: 'n' + i, title: 'T' + i, author: 'A' + i, likes: i, isLiked: false, cover: '', avatar: ''
}));
/* ══════════════════ A. 结构面 ══════════════════ */
test('A1 模块在位、纯函数、零 DOM / 零 storage / 零计时 API', () => {
    assert.ok(exists(LW_REL), 'config/list-window.js 必须在位');
    const code = stripComments(LW);
    /* ★ 本档自伤②：首版把名单里的 'window' 当子串判 ⇒ **自己的 `windowOf` 就把本条打红**。
     *   修法：判「真访问形态」（带点 / 括号），不判裸名字。 */
    for (const bad of ['document.', 'window.', 'globalThis.', 'localStorage', 'setTimeout', 'requestAnimationFrame', 'performance.now']) {
        assert.equal(code.includes(bad), false, '纯函数模块不得出现 ' + bad + '（它不该碰 DOM / 存储 / 时序）');
    }
    for (const fn of ['windowOf', 'patchOf', 'diffFields', 'keepState', 'normalizePageSize', 'line']) {
        assert.equal(typeof L[fn], 'function', '导出面缺函数：' + fn);
    }
    assert.equal(typeof L.default, 'object', '须有默认导出（宿主侧取件用）');
});
test('A2 数值读数走全仓唯一门：本模块不得自写弱口径签名', () => {
    const code = stripComments(LW);
    assert.equal(code.includes('Number.isFinite(Number('), false, '不得出现弱口径签名（weak-coercion 门的 W1）');
    assert.ok(code.includes("import { numOrNull } from './num-gate.js'"), '必须引用唯一读数门');
    /* 页长三态：给了正数照收 / 0 与负数与怪值一律回退值（**不是「不限」**）。 */
    assert.equal(L.normalizePageSize(50, 30), 50);
    assert.equal(L.normalizePageSize('50', 30), 50);
    assert.equal(L.normalizePageSize(0, 30), 30, '0 不是「不限」，落回退值');
    assert.equal(L.normalizePageSize(-5, 30), 30);
    assert.equal(L.normalizePageSize(null, 30), 30);
    assert.equal(L.normalizePageSize('', 30), 30);
    assert.equal(L.normalizePageSize([], 30), 30, '[] 不是 50 —— 弱口径会读成 0 再落回退值（此处靠唯一门直接判 null）');
    assert.equal(L.normalizePageSize(true, 30), 30, 'true 不是 1');
    assert.equal(L.normalizePageSize(9999, 30), 200, '上限 200');
});
/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 窗口四态不同形：判不了 / 空列表 / 还有 / 已到末尾', () => {
    const bad = L.windowOf(null, {});
    assert.equal(bad.ok, false);
    assert.equal(bad.reason.indexOf('notes-not-array'), 0, '拿不到列表 ⇒ 判不了（不是空列表）');
    assert.equal(bad.items.length, 0);
    const empty = L.windowOf([], {});
    assert.equal(empty.ok, true);
    assert.equal(empty.reason.indexOf('empty-list'), 0, '真的空列表是**另一个** reason');
    assert.equal(empty.hasMore, false);
    const one = L.windowOf(notesOf(10), { pageSize: 5 });
    assert.equal(one.items.length, 5, '首屏只渲染窗口大小');
    assert.equal(one.hasMore, true);
    assert.equal(one.reason, 'has-more');
    assert.equal(one.added.length, 5, '首屏「追加段」等于首屏本身（相对 loaded=0）');
    assert.equal(one.appended, false, '首屏不是「追加」');
    const done = L.windowOf(notesOf(3), { pageSize: 5 });
    assert.equal(done.hasMore, false);
    assert.equal(done.reason.indexOf('exhausted'), 0);
    assert.notEqual(one.reason, done.reason, '「还有」与「到底了」不得同形');
});
test('B2 增量追加：loaded 游标只加不重来，且窗口总量 = 已加载条数', () => {
    const notes = notesOf(100);
    const w1 = L.windowOf(notes, { loaded: 0, pageSize: 30 });
    assert.equal(w1.loaded, 30);
    assert.equal(w1.items.length, 30);
    const w2 = L.windowOf(notes, { loaded: w1.loaded, pageSize: 30 });
    assert.equal(w2.loaded, 60);
    assert.equal(w2.items.length, 60, '窗口是「累积渲染量」——追加不丢前面的');
    assert.equal(w2.added.length, 30, '本次只追加 30 条');
    assert.equal(w2.appended, true);
    assert.equal(w2.added[0].id, 'n30', '追加段从旧游标处继续');
    assert.equal(w2.items[0].id, 'n0', '前面的条目仍在窗口里');
    /* 到尾部：不越界、如实说没有更多。 */
    const w3 = L.windowOf(notes, { loaded: 95, pageSize: 30 });
    assert.equal(w3.loaded, 100);
    assert.equal(w3.added.length, 5);
    assert.equal(w3.hasMore, false);
    /* loaded 超过总数：夹到总数（不编负区间）。 */
    const w4 = L.windowOf(notes, { loaded: 500, pageSize: 30 });
    assert.equal(w4.loaded, 100);
    assert.equal(w4.added.length, 0);
    assert.equal(w4.appended, false, '没有新段就不是追加');
    assert.equal(w4.hasMore, false);
    /* loaded 未给 ⇒ 按首屏算（不是「全量」）。 */
    const w5 = L.windowOf(notes, { pageSize: 10 });
    assert.equal(w5.loaded, 10);
    assert.equal(w5.items.length, 10);
});
test('B3 局部更新判据：只有「顺序不变 + 无增删 + 若干条变了」才可只改那几张卡', () => {
    const a = notesOf(3);
    const b = a.map((x) => Object.assign({}, x));
    b[1] = Object.assign({}, b[1], { likes: 99, isLiked: true });
    const p = L.patchOf(a, b);
    assert.equal(p.ok, true);
    assert.equal(p.structural, false, '顺序不变、无增删 ⇒ 不必整列重建（这正是「点赞不重建整列」的判据）');
    assert.equal(p.changed.length, 1, '只有一条变了');
    assert.equal(p.changed[0].id, 'n1');
    assert.equal(p.reason.indexOf('in-place-only'), 0, '局部更新档（期望值必须与真源逐字：本档自伤③把后缀漏写了）');
    const fields = p.changed[0].fields.map((f) => f.field).sort();
    assert.deepEqual(fields, ['isLiked', 'likes'], '只报真变了的字段');
    /* 无变化 ⇒ 一条都不改。 */
    assert.equal(L.patchOf(a, a.map((x) => Object.assign({}, x))).changed.length, 0);
    assert.equal(L.patchOf(a, a.map((x) => Object.assign({}, x))).reason, 'no-change');
    /* 有新增 ⇒ 直言结构性变化（不硬撑局部更新）。 */
    const added = a.concat([{ id: 'n9', title: 'x', author: 'y', likes: 0, isLiked: false, cover: '', avatar: '' }]);
    const pa = L.patchOf(a, added);
    assert.equal(pa.structural, true);
    assert.equal(pa.reason.indexOf('items-added'), 0);
    assert.deepEqual(pa.addedIds, ['n9']);
    /* 有删除 ⇒ 同样结构性。 */
    const pd = L.patchOf(a, a.slice(0, 2));
    assert.equal(pd.structural, true);
    assert.deepEqual(pd.removedIds, ['n2']);
    /* 顺序变了 ⇒ 结构性（满水布局本来就变）。 */
    const rev = a.slice().reverse();
    assert.equal(L.patchOf(a, rev).reason.indexOf('order-changed'), 0);
    assert.equal(L.patchOf(a, rev).structural, true);
    assert.equal(L.patchOf(a, rev).changed.length, 0, '顺序变化本身不算「字段变了」');
    /* 拿不到两侧 ⇒ 判不了，按整列重建处理（不假装「没变化」）。 */
    const bad = L.patchOf(null, a);
    assert.equal(bad.ok, false);
    assert.equal(bad.structural, true);
    assert.equal(bad.reason.indexOf('inputs-not-array'), 0);
});
test('B4 态保留读数：kept 与 lost 逐格具名（「本来就没记」≠「被重置」）', () => {
    /* ★ 本档自伤⑥：首版断言 `allKept === true` —— 但 `expandedIds` **两份都没记**，
     *   它按 `before-missing` 如实进 lost ⇒ allKept 必须为 false。
     *   这正是本条要守的形态：「本来就没记」不得被算成「保住了」（那会让「未记」与
     *   「已保全」同形）。 `allKept` 的真语义 = **四格全都有值且逐格相同**。 */
    const k = L.keepState({ scrollTop: 320, loaded: 60, activeTab: '发现', expandedIds: ['n1'] },
        { scrollTop: 320, loaded: 60, activeTab: '发现', expandedIds: ['n1'] });
    assert.deepEqual(k.kept.sort(), ['activeTab', 'expandedIds', 'loaded', 'scrollTop']);
    assert.equal(k.allKept, true, '四格都记了且都没变 ⇒ 这才叫「全保住」');
    assert.equal(k.lost.length, 0);
    /* 少记一格（expandedIds 两份都没有）⇒ 不算「全保住」，且理由具名 before-missing。 */
    const k2 = L.keepState({ scrollTop: 320, loaded: 60, activeTab: '发现' }, { scrollTop: 320, loaded: 60, activeTab: '发现' });
    assert.equal(k2.allKept, false, '未记的格不得算成「保住了」');
    assert.equal(k2.lost.length, 1);
    assert.equal(k2.lost[0].field, 'expandedIds');
    const l2 = L.keepState({ scrollTop: 320, loaded: 60 }, { scrollTop: 0, loaded: 60 });
    assert.deepEqual(l2.kept, ['loaded']);
    assert.equal(l2.allKept, false);
    /* ★ 本档自伤④：「本来就没记」的字段（expandedIds / activeTab）也会进 lost ——
     *   那不是缺陷，是**如实分档**（「没记」与「丢了」必须分开）。此处把条数钉成真读数。 */
    /* l2 只记了 scrollTop / loaded 两格 ⇒ 另两格（expandedIds / activeTab）都缺，
     * 加 scrollTop 值变了 ⇒ lost 共 3 格。这是真读数（首次写成 2 是同族抄错）。 */
    assert.equal(l2.lost.length, 3, '两份都缺的字段按 before-missing 如实计入（未记 ≠ 已丢）');
    const why = l2.lost.filter((x) => x.field === 'scrollTop')[0];
    /* ★ 本档自伤⑤：这条首版把 `indexOf(...) === 0`（布尔）当 actual 与字符串比 ——
     *   写成了 `assert.equal(bool, '说明文字')` 的错形，恒假。修法：比较 indexOf 结果本身。 */
    assert.equal(why.why.indexOf('value-changed'), 0, '值是 0 也要如实报「变了」（0 不是「没值」）');
    /* 本来就没记 ⇒ 「没记」不是「丢了」。 */
    const l3 = L.keepState({ loaded: 10 }, { loaded: 10 });
    const st = l3.lost.filter((x) => x.field === 'scrollTop')[0];
    assert.equal(st.why.indexOf('before-missing'), 0);
    /* 没回写 ⇒ 重开即丢。 */
    const l4 = L.keepState({ loaded: 10, scrollTop: 5 }, { loaded: 10 });
    assert.equal(l4.lost.filter((x) => x.field === 'scrollTop')[0].why.indexOf('after-missing'), 0);
    /* 三种 lost 理由互不同形。 */
    const pre = (x) => x.why.slice(0, x.why.indexOf('（'));
    const set = new Set([pre(why), pre(st), pre(l4.lost.filter((x) => x.field === 'scrollTop')[0])]);
    assert.equal(set.size, 3, '三种「丢了」的理由必须互不同形');
    /* diffFields：只报真变的格。 */
    assert.deepEqual(L.diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }).map((x) => x.field), ['b']);
    assert.equal(L.diffFields({ a: 1 }, { a: 1 }).length, 0);
    assert.equal(typeof L.line(L.windowOf(notesOf(50), { pageSize: 10 })), 'string');
    assert.ok(L.line(null).indexOf('判不了') >= 0, '诊断行也要说得出「判不了」');
});
/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 xhs-view 三处接线在场：首屏窗口 / 增量追加 / 点赞局部更新', () => {
    const code = stripComments(XHS);
    assert.ok(code.includes("from '../../config/list-window.js'"), '视图必须引用窗口模块（唯一窗口口径）');
    assert.ok(code.includes('windowOf(notes, { loaded:'), '首屏渲染必须走窗口切片');
    assert.ok(code.includes('_bindScroll(this.container)'), '滚动监听必须接到容器上（滚到底增量追加）');
    assert.ok(code.includes('_maybeLoadMore()'), '必须有增量追加入口');
    assert.ok(code.includes('_patchLike(id)'), '必须有点赞局部更新入口');
    /* 点赞路径**不得**再走整列渲染（修前就是它把滚动位置整丢的）。 */
    const likeIdx = code.indexOf("this.app.data.toggleLike(id);");
    assert.ok(likeIdx > 0, '点赞调用点必须在场');
    const after = code.slice(likeIdx, likeIdx + 120);
    assert.ok(after.includes('this._patchLike(id)'), '点赞之后必须走局部更新');
    assert.equal(after.includes('this._renderMasonry()'), false, '点赞之后不得调整列渲染（那是修前的形态）');
});
test('C2 卡片 HTML 单一真源：三处渲染共用同一份（不得各自拼一份）', () => {
    const code = stripComments(XHS);
    assert.ok(code.includes('_cardHtml(n) {'), '卡片 HTML 必须收成一个真源函数');
    const uses = code.split('this._cardHtml(').length - 1;
    assert.equal(uses >= 4, true, '首屏 / 增量追加 / 点赞局部 / 泛用局部路径都要用它（实测 ' + uses + ' 处）');
    /* 不得再有第二处内联拼卡片的写法（`data-id="${` 只许出现在真源里）。 */
    const inline = code.split('class="xhs-card" data-id=').length - 1;
    assert.equal(inline, 1, '卡片模板只许有一份（实测 ' + inline + ' 份）');
    /* 旧的全列重建路径（notes.map 直接拼）不得残留。 */
    assert.equal(/grid\.innerHTML\s*=\s*notes\.map/.test(code), false, '不得残留「全量一次性建满」的写法');
});
test('C3 页尾提示两态不同形 + 评论不重建列表（本版边界）', () => {
    const code = stripComments(XHS);
    assert.ok(code.includes("_updateMoreHint(grid, w)"), '必须有页尾提示更新');
    assert.ok(code.includes("w.hasMore ? 'has-more' : 'exhausted'"), '页尾状态必须两态可分辨（不是一句「没有了」）');
    /* 评论路径：数据与详情刷新在，但不重建瀑布流（卡片视图不含评论数）。 */
    const ci = code.indexOf('this.app.data.addComment(note.id, val);');
    assert.ok(ci > 0);
    const seg = code.slice(ci, ci + 260);
    assert.ok(seg.includes('this._openDetail(note.id)'), '评论后详情要刷（评论列表在详情里）');
    assert.equal(seg.includes('this._renderMasonry()'), false, '评论后不得重建瀑布流（卡片视图不含评论数）');
    /* 发布路径：新条目在最前 ⇒ 窗口至少回到一页，保证「刚发的那条」在位。 */
    const ai = code.indexOf('this.app.data.addNote(');
    assert.ok(ai > 0);
    const aseg = code.slice(ai, ai + 420);
    assert.ok(aseg.includes('this._loaded = Math.max(this._loaded, this._pageSize)'), '发布后必须保证新条目在窗口里');
});
/* ══════════════════ D. 负控制（真源码副本定点破坏） ══════════════════ */
test('D1 破坏窗口切片（切到 loaded 之后）⇒ 增量追加判据必须转红', async () => {
    const neg = await breakModule(LW_REL,
        "    out.items = notes.slice(0, next);",
        "    out.items = notes.slice(prev, next);", 'd1');
    const notes = notesOf(100);
    const w1 = neg.windowOf(notes, { loaded: 0, pageSize: 30 });
    const w2 = neg.windowOf(notes, { loaded: w1.loaded, pageSize: 30 });
    assert.equal(w2.items.length, 30, '破坏后窗口只剩新追加的一段（前 30 条被丢掉）');
    assert.equal(w2.items[0].id, 'n30', '破坏生效：前面条目不在窗口里了');
    assert.equal(L.windowOf(notes, { loaded: 30, pageSize: 30 }).items.length, 60, '原版上必须是累积窗口');
});
test('D2 破坏「盘不了」分档（拿不到列表当空列表）⇒ 四态不同形判据必须转红', async () => {
    const neg = await breakModule(LW_REL,
        "        out.reason = 'notes-not-array（拿不到列表 ⇒ 判不了，不是空列表）';",
        "        out.reason = 'empty-list（列表真的是空的）';", 'd2');
    const n = neg.windowOf(null, {});
    assert.equal(n.reason.indexOf('empty-list'), 0, '破坏生效：「拿不到」被谎报成「空的」');
    assert.equal(L.windowOf(null, {}).reason.indexOf('notes-not-array'), 0, '原版上必须分开');
});
test('D3 破坏局部更新判据（把结构性变化说成可局部改）⇒ 同款判据必须转红', async () => {
    const neg = await breakModule(LW_REL,
        "    out.structural = orderChanged || out.addedIds.length > 0 || out.removedIds.length > 0;",
        "    out.structural = false;", 'd3');
    const a = notesOf(3);
    const added = a.concat([{ id: 'n9', title: 'x', author: 'y', likes: 0, isLiked: false, cover: '', avatar: '' }]);
    assert.equal(neg.patchOf(a, added).structural, false, '破坏生效：有新增也报「可局部改」');
    assert.equal(L.patchOf(a, added).structural, true, '原版上结构性变化必须直言需要重建');
});
test('D4 破坏态保留读数（未记当已保）⇒ 同款判据必须转红', async () => {
    const neg = await breakModule(LW_REL,
        "        if (!hasA) { lost.push({ field: f, why: 'before-missing（本来就没记 ⇒ 不是「被重置」）' }); continue; }",
        "        if (!hasA) { kept.push(f); continue; }", 'd4');
    const k = neg.keepState({ loaded: 60 }, { loaded: 60 });
    assert.equal(k.kept.includes('scrollTop'), true, '破坏生效：未记的格被算成「保住了」');
    assert.equal(L.keepState({ loaded: 60 }, { loaded: 60 }).kept.includes('scrollTop'), false, '原版上未记 ≠ 已保');
});
test('D5 破坏数值口径（页长 0 当「不限」）⇒ 读数判据必须转红', async () => {
    const neg = await breakModule(LW_REL,
        "    const n = numOrNull(raw);\n    if (n === null || n <= 0) return fb;",
        "    const n = numOrNull(raw);\n    if (n === null) return fb;\n    if (n <= 0) return 0;", 'd5');
    assert.equal(neg.normalizePageSize(0, 30), 0, '破坏生效：0 被当成「不限」（页长 0 = 不渲染）');
    assert.equal(L.normalizePageSize(0, 30), 30, '原版上 0 必须落回退值');
});
test('D6 破坏视图接线（点赞改回整列重建）⇒ 接线判据必须转红', async () => {
    const src = read(XHS_REL);
    const anchor = '        this.app.data.toggleLike(id);\n        this._patchLike(id);';
    anchorOnce(src, anchor, 'd6');
    const broken = src.replace(anchor, '        this.app.data.toggleLike(id);\n        this._renderMasonry();');
    assert.notEqual(broken, src, '破坏必须真的改变源码');
    const code = stripComments(broken);
    const likeIdx = code.indexOf('this.app.data.toggleLike(id);');
    const after = code.slice(likeIdx, likeIdx + 120);
    assert.equal(after.includes('this._patchLike(id)'), false, '破坏生效：点赞不再走局部更新');
    assert.ok(after.includes('this._renderMasonry()'), '破坏生效：点赞改回整列重建');
    /* 原版对照（同款判据在原件上必须过）。 */
    const okCode = stripComments(XHS);
    const okIdx = okCode.indexOf('this.app.data.toggleLike(id);');
    assert.ok(okCode.slice(okIdx, okIdx + 120).includes('this._patchLike(id)'), '原版上点赞必须走局部更新');
});
test('D7 破坏卡片单一真源（多拼一份模板）⇒ 单一真源判据必须转红', () => {
    const src = read(XHS_REL);
    const anchor = '    grid.innerHTML = shown.map(n => this._cardHtml(n)).join(\'\');';
    anchorOnce(src, anchor, 'd7');
    const broken = src.replace(anchor,
        '    grid.innerHTML = shown.map(n => `<div class="xhs-card" data-id="${n.id}"></div>`).join(\'\');');
    const code = stripComments(broken);
    assert.equal(code.split('class=\"xhs-card\" data-id=').length - 1, 2, '破坏生效：出现第二份卡片模板');
    assert.equal(stripComments(XHS).split('class=\"xhs-card\" data-id=').length - 1, 1, '原版上只许有一份');
});
test('D8 工具两向自证：锚点不存在 / 不唯一必须抛', () => {
    assert.throws(() => anchorOnce(LW, '__不存在__', 'z1'), /恰中 1 次/);
    assert.throws(() => anchorOnce(LW, 'const', 'z2'), /恰中 1 次/, '多处命中的锚点必抛');
    assert.throws(() => anchorOnce(XHS, 'this._cardHtml(', 'z3'), /恰中 1 次/, '多处命中的写点必抛（拿它当破坏锚会把多份都改掉）');
});
/* ══════════════════ E. 版本锚 ══════════════════ */
test('E1 五源同源：3.98.0 落齐（常量 / 公告块 / 台账 / 包描述 / 迭代日志）', () => {
    const VER = '3.98.0';
    assert.ok(IDX.includes("const ST_PHONE_VERSION = '" + VER + "';"), '入口常量');
    assert.ok(read('manifest.json').includes('"version": "' + VER + '"'), 'manifest');
    assert.ok(read('package.json').includes('"version": "' + VER + '"'), 'package.json');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, VER, 'update-log.latest');
    assert.equal(ul.head, VER, 'update-log.head');
    assert.ok(ul.versions[VER], '台账必须有当版条目');
    assert.ok(Array.isArray(ul.versions[VER].items) && ul.versions[VER].items.length >= 6, '当版条目数须齐');
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')), '当版必须带收尾条');
    assert.ok(read('ITERATION_LOG.md').includes('v' + VER), '迭代日志必须有当版');
});
