/* ============================================================
 * tests/system-v4420.test.mjs -- [v4.42.0 · 第五期 R5-X9 跨书专题夹与带来源的研究成稿]
 *
 * 验收口径（计划原文 R5-X9）：
 *   「建立专题，选资料范围并跨书查找，把原句、解释、反证分栏组织成稿；
 *     段落可回到原书，导出时带书名/章节/版本/定位；可显式交给取材板。」
 *   验收旅程：「**三本书同名人物不混引**；**删除/改版后相关引文提示失效/需核**；
 *     冷启动可回源；**专题导出不包含未选择资料**，**批注不伪装原文**；交接草稿可打开。」
 *   不做：**不全库上传**；**不复制整书到上下文**；**不自动认定研究结论为剧情事实**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   手机侧全仓零 `dossier` / `专题` 命中：摘录只能挂在**一本书**下面
 *   （`excerpt.bookId`），没有任何一格能表达「这一篇论证跨了哪几本」。
 *   于是「三本书同名人物」在界面上**无法区分**（都叫同一个名字）——
 *   而那正是验收原文点名要治的第一条。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/topic-dossier-contract.js`：面四态（absent / empty / ready /
 *   unreadable）× 引用五态（ok / stale / gone / unpinned / unreadable）×
 *   三栏（原句 / 我的解释 / 反证）；**同名不同书不合并**；**失效照旧列出**；
 *   **未选择的资料不进成稿**；不产任何自动结论；十项自证。
 *   （二）控制器 `reading-app.js`：`dossierRefs` / `dossierSelected` / `dossierToggle` /
 *   `dossierClearSelection` / `bookMapForDossier` / `topicDossier` / `topicDossierRows` /
 *   `topicDossierExport` / `topicDossierSelfCheck`。
 *   （三）视图 `reading-view.js`：跨书专题夹区块（面读数 / 三栏行 / 导出 / 清空勾选）。
 *
 * 判据面（六组）：
 *   A 口径：面四态与引用五态互不同形 / 三栏互不相同 / 纯契约零副作用 / 视图接线
 *   B 内核行为：同名不同书不混引、原句与解释分栏、失效照旧列出、改版与书没了分形、
 *            未选择的资料不进成稿、导出带书名/章节/版本/定位
 *   C 接线行为：真 App 走完整旅程（引用集装配 / 勾选 / 清空 / 导出 / 自检真消费）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-X9
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「交给取材板」不在本套件判到底】那属 O1 交接面读数；本套件判它的
 *   可判定前件：导出只含勾过且仍可回源的引用（那是「交给谁都不带未选资料」的前提）。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KERNEL_REL = 'config/topic-dossier-contract.js';
const APP_REL = 'apps/reading/reading-app.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const NL = String.fromCharCode(10);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (c === String.fromCharCode(92)) { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const S = K.DOSSIER_STATES;
const R = K.REF_STATES;
const C = K.REF_COLUMNS;

/* ══════════ 假件 ══════════ */
/** 造一个真 App 实例（按真原型建；只补本版方法用到的字段 —— 真构造期要宿主壳）。 */
function mkApp(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    globalThis.window = { VirtualPhone: {} };
    const app = Object.create(APP.ReadingApp.prototype);
    app.excerpts = Array.isArray(o.excerpts) ? o.excerpts : [];
    app.data = { getBooks: () => (Array.isArray(o.books) ? o.books : []) };
    app._contentCache = new Map(o.cache || []);
    app._dossierSelected = Array.isArray(o.selected) ? o.selected.slice() : [];
    app._dossierCounters = o.counters || {};
    return app;
}
function clearWin() { delete globalThis.window; }

const BOOKS = [
    { id: 'b1', title: '书一', contentHash: 'h1' },
    { id: 'b2', title: '书二', contentHash: 'h2' },
];
const CACHE = [['b1', [{ paragraphs: ['甲走了'] }]], ['b2', [{ paragraphs: ['甲走了'] }]]];

/* ══════════ A ── 口径面 ══════════ */

test('A1 面四态与引用五态各自互不同形；三栏互不相同', () => {
    const states = Object.values(S);
    assert.equal(new Set(states).size, states.length, '★ 面各态必须唯一');
    const refs = Object.values(R);
    assert.equal(new Set(refs).size, refs.length, '★ 引用各态必须唯一');
    assert.notEqual(R.STALE, R.GONE, '★★「改版」与「书没了」处置相反');
    assert.notEqual(R.UNPINNED, R.GONE, '「没记版本」与「书没了」处置相反');
    assert.notEqual(R.UNREADABLE, R.OK, '「读不到」与「可回源」处置相反');
    const cols = Object.values(C);
    assert.equal(new Set(cols).size, cols.length, '★ 三栏必须互不相同');
    assert.notEqual(S.EMPTY, S.UNREADABLE, '「还没建」与「读不到」处置相反');
});

test('A2 判定只有一处出处：视图与控制器都不自己判「哪条回不到原处」', () => {
    assert.ok(kernelCode.indexOf('function refStateOf(') >= 0, '唯一判定点必须真存在');
    assert.ok(kernelCode.indexOf('function buildTopicDossier(') >= 0, '唯一装配点必须真存在');
    /* ★ 只判**本版新增的专题夹那一段**：`contentHash` 在既有的阅读视图里别处也有
     *   （那是既有形态，不在本版范围内）。 */
    const v0 = viewCode.indexOf('_dossierHtml(');
    const v1 = viewCode.indexOf('researchText()');
    assert.ok(v0 > 0 && v1 > v0, '必须能切出专题夹那一段');
    const seg = viewCode.slice(v0, v1);
    assert.equal(seg.indexOf('contentHash'), -1, '★ 专题夹不得自己比版本指纹');
    assert.equal(seg.indexOf("'stale'"), -1, '★ 专题夹不得自持引用状态字面量');
    assert.equal(seg.indexOf("'gone'"), -1, '★ 专题夹不得自持引用状态字面量');
    assert.ok(appCode.indexOf('buildTopicDossier(') >= 0, '控制器必须转交契约件');
    assert.ok(viewCode.indexOf('topicDossier?.(') >= 0, '视图必须走 app.topicDossier()');
    assert.ok(viewCode.indexOf('topicDossierRows?.(') >= 0, '视图必须走 app.topicDossierRows()');
});

test('A3 纯契约：零 DOM / 零存储 / 零联网 / 零时钟', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯契约件不得出现 ' + bad);
    }
    for (const bad of ['plugin.', 'LonShaMemory', 'memoryCore']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '★ 本件不得自己取数：' + bad);
    }
});

test('A4 视图接线：专题夹区块在场、两处按钮真投递', () => {
    assert.ok(viewSrc.indexOf('跨书专题夹') >= 0, '视图缺专题夹区块标题');
    assert.ok(viewSrc.indexOf('rd-dossier-rows') >= 0, '视图缺专题行容器');
    assert.ok(viewSrc.indexOf('rd-dossier-export') >= 0, '缺「导出成稿」按钮');
    assert.ok(viewSrc.indexOf('rd-dossier-clear') >= 0, '缺「清空勾选」按钮');
    assert.ok(viewCode.indexOf("q('#rd-dossier-export')?.addEventListener") >= 0, '导出必须真接线');
    assert.ok(viewCode.indexOf("q('#rd-dossier-clear')?.addEventListener") >= 0, '清空必须真接线');
    assert.ok(viewCode.indexOf('topicDossierExport?.(') >= 0, '导出必须走控制器出口');
    /* 区块必须真被渲染（不是建好没挂）。 */
    assert.ok(viewCode.indexOf('this._dossierHtml(tc)') >= 0, '专题夹区块必须真被渲染');
});

/* ══════════ B ── 内核行为面 ══════════ */

test('B1 ★★★★★ 三本书同名人物不混引（各带各的书与版本）', () => {
    const map = new Map([
        ['b1', { contentHash: 'h1', chapters: [{}] }],
        ['b2', { contentHash: 'h2', chapters: [{}] }],
        ['b3', { contentHash: 'h3', chapters: [{}] }],
    ]);
    const face = K.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'r1', column: 'quote', text: '甲走了', source: { bookId: 'b1', bookTitle: '书一', contentHash: 'h1', chapter: '第一章', para: 0 } },
            { id: 'r2', column: 'quote', text: '甲走了', source: { bookId: 'b2', bookTitle: '书二', contentHash: 'h2', chapter: '序', para: 0 } },
            { id: 'r3', column: 'quote', text: '甲走了', source: { bookId: 'b3', bookTitle: '书三', contentHash: 'h3', chapter: '附录', para: 0 } },
        ],
    });
    assert.equal(face.books.length, 3, '★ 三本书必须各算一本（不按名字合并）');
    const rows = K.dossierRows(face);
    assert.equal(new Set(rows.map((x) => x.line)).size, 3, '★★ 三条引用的读数必须互不相同');
    for (const need of ['书一', '书二', '书三']) {
        assert.ok(rows.some((x) => x.line.indexOf(need) >= 0), '必须点名出处 ' + need);
    }
});

test('B2 ★★★★★ 原句与我的解释分栏（批注不伪装原文）', () => {
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = K.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'q', column: 'quote', text: '书里写的', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'e', column: 'explain', text: '我写的解释', annotation: '我的批注', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'c', column: 'counter', text: '我写的反证', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
    });
    assert.equal(face.columns.quote.length, 1);
    assert.equal(face.columns.explain.length, 1);
    assert.equal(face.columns.counter.length, 1);
    assert.equal(face.columns.quote[0].text, '书里写的', '★ 原句栏只放书里写的');
    assert.equal(face.columns.explain[0].text, '我写的解释', '★ 解释栏只放我写的');
    assert.equal(face.columns.counter[0].text, '我写的反证', '★ 反证栏只放我写的');
    /* 批注**只出现在解释栏那一行**，绝不落进原句栏。 */
    const rows = K.dossierRows(face);
    assert.ok(rows[0].line.indexOf('批注') < 0, '★ 原句那一行不得出现批注：' + rows[0].line);
    assert.ok(rows[1].line.indexOf('批注') >= 0, '解释那一行必须带批注：' + rows[1].line);
});

test('B3 ★★★★★ 删除/改版后相关引文提示失效/需核（照旧列出，不静默丢）', () => {
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const gone = K.buildTopicDossier({
        booksById: map,
        refs: [{ id: 'g', column: 'quote', text: '一句', source: { bookId: 'bX', bookTitle: '删掉的书', contentHash: 'h' } }],
    });
    assert.equal(gone.refs.length, 1, '★ 书没了也必须照旧列出那一条（不静默丢）');
    assert.equal(gone.refs[0].state, R.GONE);
    assert.equal(gone.refs[0].canExport, false, '失效的引用不得导出');
    assert.ok(K.dossierRows(gone)[0].line.indexOf('失效') >= 0, '读数行必须标出失效');

    const stale = K.buildTopicDossier({
        booksById: map,
        refs: [{ id: 's', column: 'quote', text: '一句', source: { bookId: 'b1', bookTitle: '书一', contentHash: 'OLD' } }],
    });
    assert.equal(stale.refs[0].state, R.STALE);
    assert.ok(K.dossierRows(stale)[0].line.indexOf('需重新核对') >= 0, '改版必须说清需重新核对');
    assert.notEqual(stale.refs[0].state, gone.refs[0].state, '★★「改版」与「书没了」必须不同形');
    /* 读不到 ≠ 可回源。 */
    const noBody = new Map([['b3', { contentHash: 'h3' }]]);
    const unread = K.buildTopicDossier({
        booksById: noBody,
        refs: [{ id: 'n', column: 'quote', text: 'x', source: { bookId: 'b3', contentHash: 'h3' } }],
    });
    assert.equal(unread.refs[0].state, R.UNREADABLE, '★ 书在但正文读不到 ⇒ 判不了（不是「可回源」）');
    assert.equal(unread.refs[0].canExport, false, '★ 读不到的不得导出');
});

test('B4 ★★★★★ 专题导出不包含未选择的资料', () => {
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = K.buildTopicDossier({
        title: 'T', booksById: map,
        refs: [
            { id: 'a', column: 'quote', text: '选中这一条', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'b', column: 'quote', text: '没选这一条', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
        selected: ['a'],
    });
    assert.equal(face.exportable.length, 1, '★ 只勾了一条 ⇒ 只有一条可导出');
    const ex = K.dossierExport(face);
    assert.equal(ex.ok, true);
    assert.ok(ex.text.indexOf('选中这一条') >= 0, '成稿必须含选中的那条');
    assert.equal(ex.text.indexOf('没选这一条'), -1, '★★ 未选择的资料**不得**进成稿');
    assert.ok(ex.line.indexOf('未选择的资料不进成稿') >= 0, '导出读数必须说清这条纪律');
    /* 一条都没得导 ⇒ 拦住，且理由与「读不到」不同形。 */
    const none = K.buildTopicDossier({
        booksById: map,
        refs: [{ id: 'g2', column: 'quote', text: 'x', source: { bookId: 'bX', contentHash: 'h' } }],
        selected: ['g2'],
    });
    const g = K.dossierExport(none);
    assert.equal(g.ok, false, '全失效 ⇒ 不许导出');
    assert.notEqual(g.line, K.dossierExport(K.buildTopicDossier({ thrown: true })).line, '★ 两句必须不同');
});

test('B5 导出带书名/章节/版本/定位；不产任何自动结论；自检零问题', () => {
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = K.buildTopicDossier({
        title: '带来源', booksById: map,
        refs: [{ id: 'r', column: 'quote', text: '一句', source: { bookId: 'b1', bookTitle: '书一', contentHash: 'h1', chapter: '第三章', para: 4 } }],
        selected: ['r'],
    });
    const text = K.dossierExport(face).text;
    for (const need of ['书一', '第三章', '第 5 段']) {
        assert.ok(text.indexOf(need) >= 0, '成稿必须带出处「' + need + '」：' + text);
    }
    /* 不产任何自动结论 / 置信度（计划原文「不自动认定研究结论为剧情事实」）。 */
    const sample = JSON.stringify(face) + text;
    for (const k of K.DOSSIER_FORBIDDEN_KEYS) {
        assert.equal(sample.indexOf('"' + k + '"'), -1, '★ 读数里不得出现结论/置信度键：' + k);
    }
    assert.deepEqual(K.dossierSelfCheck().problems, [], '★ 内核自检必须零问题');
});

/* ══════════ C ── 接线面（真 App） ══════════ */

test('C1 真 App：引用集由摘录装配（原句 / 解释 / 反证三栏齐）', () => {
    const app = mkApp({
        books: BOOKS, cache: CACHE,
        excerpts: [
            { id: 'e1', bookId: 'b1', text: '甲走了', annotation: '我觉得是赌气', chapter: '第一章', contentHash: 'h1', para: 0 },
            { id: 'e2', bookId: 'b2', text: '甲走了', chapter: '序', contentHash: 'h2', para: 0 },
        ],
        counters: { e1: '但他后来又回来了' },
    });
    try {
        const refs = app.dossierRefs();
        assert.ok(refs.length >= 4, '两条摘录应至少出四条引用（两条原句 + 解释 + 反证），实测 ' + refs.length);
        assert.ok(refs.some((r) => r.column === 'quote'), '必须有原句栏');
        assert.ok(refs.some((r) => r.column === 'explain'), '必须有解释栏');
        assert.ok(refs.some((r) => r.column === 'counter'), '必须有反证栏');
        const face = app.topicDossier({ title: '同名人物', refs: refs });
        assert.equal(face.state, S.READY);
        assert.equal(face.books.length, 2, '★ 两本书必须各算一本');
        assert.deepEqual(app.topicDossierSelfCheck().problems, []);
    } finally { clearWin(); }
});

test('C2 勾选与清空：只动选择，不动摘录', () => {
    const app = mkApp({ books: BOOKS, cache: CACHE, excerpts: [{ id: 'e1', bookId: 'b1', text: '甲走了', contentHash: 'h1' }] });
    try {
        const before = app.dossierRefs().length;
        app.dossierToggle('e1', true);
        assert.deepEqual(app.dossierSelected(), ['e1']);
        app.dossierToggle('e1', false);
        assert.deepEqual(app.dossierSelected(), [], '再点一次即取消勾选');
        app.dossierToggle('e1', true);
        app.dossierClearSelection();
        assert.deepEqual(app.dossierSelected(), [], '★ 清空勾选只清选择');
        assert.equal(app.dossierRefs().length, before, '★★ 清空勾选**不得**动摘录');
        /* 空 id 不许勾。 */
        assert.equal(app.dossierToggle('  ', true).ok, false);
    } finally { clearWin(); }
});

test('C3 导出：只含勾过且仍可回源的（真 App 转交）', () => {
    const app = mkApp({
        books: BOOKS, cache: CACHE,
        excerpts: [{ id: 'e1', bookId: 'b1', text: '选中', contentHash: 'h1' }, { id: 'e2', bookId: 'b1', text: '没选', contentHash: 'h1' }],
        selected: ['e1'],
    });
    try {
        const face = app.topicDossier({ title: 'T', refs: app.dossierRefs(), selected: app.dossierSelected() });
        const ex = app.topicDossierExport(face);
        assert.equal(ex.ok, true);
        assert.ok(ex.text.indexOf('选中') >= 0, '成稿必须含选中的');
        assert.equal(ex.text.indexOf('没选'), -1, '★ 未选择的不得进成稿');
    } finally { clearWin(); }
});

test('C4 取数抛了：如实报「读不到」，不假装「还没有引用」', () => {
    const app = mkApp({ books: BOOKS, cache: CACHE, excerpts: [{ id: 'e1', bookId: 'b1', text: 'x', contentHash: 'h1' }] });
    try {
        const bad = K.buildTopicDossier({ thrown: true });
        assert.equal(bad.state, S.UNREADABLE, '取数失败 ⇒ unreadable');
        assert.ok(bad.line.indexOf('读不到') >= 0, '必须说「读不到 ≠ 还没建这个专题」：' + bad.line);
        const empty = K.buildTopicDossier({ title: 'T' });
        assert.notEqual(bad.line, empty.line, '★★ 两者的话必须不同句');
        /* 真 App 的出口也不许把「取不到书」当成「没有内容」。 */
        const noData = Object.create(APP.ReadingApp.prototype);
        noData.excerpts = [{ id: 'e1', bookId: 'b1', text: 'x' }];
        noData.data = { getBooks: () => { throw new Error('boom'); } };
        noData._contentCache = new Map();
        const face = noData.topicDossier({ refs: noData.dossierRefs() });
        assert.equal(face.refs[0].state, R.GONE, '取不到书 ⇒ 那条判「失效」（不是「没问题」）');
    } finally { clearWin(); }
});

test('C5 视图不直摸契约件；取数全走控制器', () => {
    assert.equal(viewSrc.indexOf('topic-dossier-contract'), -1, '★ 视图不得直接 import 契约件');
    assert.equal(viewCode.indexOf('buildTopicDossier('), -1, '★ 视图不得自己装配');
    assert.equal(viewCode.indexOf('refStateOf('), -1, '★ 视图不得自己判引用状态');
    assert.ok(viewCode.indexOf('this.app.topicDossier?.(') >= 0, '视图必须走控制器');
});

/* ══════════ D ── 负控制（真源码定点破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4420_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', () => {
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = K.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'a', column: 'quote', text: 'A', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'b', column: 'quote', text: 'B', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
        selected: ['a'],
    });
    assert.equal(K.dossierExport(face).text.indexOf('B'), -1, '原版：未选的进不了成稿');
    assert.equal(K.buildTopicDossier({
        booksById: map, refs: [{ id: 'g', source: { bookId: 'bX', contentHash: 'h' } }],
    }).refs.length, 1, '原版：失效照旧列出');
    assert.equal(K.buildTopicDossier({
        booksById: map, refs: [{ id: 's', source: { bookId: 'b1', contentHash: 'OLD' } }],
    }).refs[0].state, R.STALE, '原版：改版单列');
});

test('D1 ★★★★★ 破坏「未选择的资料不进成稿」⇒ 同款判据必转红（全库上传）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    const picked = (sel && sel.length) ? refs.filter((x, i) => sel.indexOf(str((rawRefs[i] && rawRefs[i].id) || '')) >= 0) : [];",
        '    const picked = refs.slice();');
    const mk = await loadKernel(dir, 'd1');
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = mk.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'a', column: 'quote', text: '选中', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'b', column: 'quote', text: '没选', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
        selected: ['a'],
    });
    const ex = mk.dossierExport(face);
    assert.notEqual(ex.text.indexOf('没选'), -1,
        '★★ 破坏副本：未选择的资料进了成稿 ⇒ 等于「全库上传」（计划原文明令不做）');
    const good = K.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'a', column: 'quote', text: '选中', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'b', column: 'quote', text: '没选', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
        selected: ['a'],
    });
    assert.equal(K.dossierExport(good).text.indexOf('没选'), -1, '原版必须只含选中的');
});

test('D2 ★★★★★ 破坏「改版单列」⇒ 同款判据必转红（改版被读成没问题）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (liveHash && liveHash !== source.contentHash) {",
        '    if (false) {');
    const mk = await loadKernel(dir, 'd2');
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = mk.buildTopicDossier({
        booksById: map,
        refs: [{ id: 's', column: 'quote', text: 'x', source: { bookId: 'b1', contentHash: 'OLD' } }],
    });
    assert.notEqual(face.refs[0].state, mk.REF_STATES.STALE,
        '★★ 破坏副本：改版不再单列 ⇒ 旧引文被读成「可回源」（正文早变了）');
    assert.equal(face.refs[0].state, mk.REF_STATES.OK, '破坏副本：它落进了可回源');
    assert.equal(K.buildTopicDossier({
        booksById: map, refs: [{ id: 's', source: { bookId: 'b1', contentHash: 'OLD' } }],
    }).refs[0].state, R.STALE, '原版必须单列改版');
});

test('D3 ★★★★ 破坏「书没了照旧列出」⇒ 同款判据必转红（引文静默消失）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!book) {\n        return Object.assign({}, base, { state: REF_STATES.GONE, why: '「' + (source.bookTitle || source.bookId) + '」已不在书架 ⇒ 这条引用**失效**（照旧列出，不静默丢）' });\n    }",
        '    if (!book) { return null; }');
    const mk = await loadKernel(dir, 'd3');
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    let n = -1;
    try {
        const face = mk.buildTopicDossier({
            booksById: map,
            refs: [{ id: 'g', column: 'quote', text: 'x', source: { bookId: 'bX', bookTitle: '删掉的书', contentHash: 'h' } }],
        });
        n = face.refs.length;
    } catch (_e) { n = -1; }
    assert.notEqual(n, 1,
        '★★ 破坏副本：书没了不再照旧列出 ⇒ 引文静默消失（论证看起来没引过那一段）');
    const good = K.buildTopicDossier({
        booksById: map,
        refs: [{ id: 'g', column: 'quote', text: 'x', source: { bookId: 'bX', bookTitle: '删掉的书', contentHash: 'h' } }],
    });
    assert.equal(good.refs.length, 1, '原版必须照旧列出');
    assert.equal(good.refs[0].state, R.GONE);
});

test('D4 ★★★★ 破坏「原句与解释分栏」⇒ 同款判据必转红（批注伪装原文）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    const column = Object.values(REF_COLUMNS).indexOf(str(r.column)) >= 0 ? str(r.column) : REF_COLUMNS.QUOTE;",
        '    const column = REF_COLUMNS.QUOTE;');
    const mk = await loadKernel(dir, 'd4');
    const map = new Map([['b1', { contentHash: 'h1', chapters: [{}] }]]);
    const face = mk.buildTopicDossier({
        booksById: map,
        refs: [{ id: 'e', column: 'explain', text: '我写的解释', source: { bookId: 'b1', contentHash: 'h1' } }],
    });
    assert.equal(face.columns.explain.length, 0,
        '★★ 破坏副本：解释被塞进原句栏 ⇒ 我写的话被当成书里原文（验收原文点名禁止）');
    assert.equal(face.columns.quote.length, 1, '破坏副本：它落进了原句栏');
    const good = K.buildTopicDossier({
        booksById: map,
        refs: [{ id: 'e', column: 'explain', text: '我写的解释', source: { bookId: 'b1', contentHash: 'h1' } }],
    });
    assert.equal(good.columns.explain.length, 1, '原版必须分栏');
});

test('D5 ★★★★ 破坏「按书 ID 建索引」⇒ C1 同款判据必转红（同名两本书被合并）', async () => {
    /* 真落点：让书目**按书名**去重（同名两本书被算成一本）。 */
    const dir = breakCopy(KERNEL_REL,
        '        if (!x.source.bookId || seen.has(x.source.bookId)) continue;\n        seen.add(x.source.bookId);',
        '        const k2 = x.source.bookTitle || x.source.bookId;\n        if (!k2 || seen.has(k2)) continue;\n        seen.add(k2);');
    const mk = await loadKernel(dir, 'd5');
    const map = new Map([
        ['b1', { contentHash: 'h1', chapters: [{}] }],
        ['b2', { contentHash: 'h2', chapters: [{}] }],
    ]);
    const face = mk.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'r1', column: 'quote', text: '甲走了', source: { bookId: 'b1', bookTitle: '同名书', contentHash: 'h1' } },
            { id: 'r2', column: 'quote', text: '甲走了', source: { bookId: 'b2', bookTitle: '同名书', contentHash: 'h2' } },
        ],
    });
    assert.equal(face.books.length, 1,
        '★★ 破坏副本：同名两本书被合并成一本 ⇒ 同名人物混引（验收原文点名要治的第一条）');
    const good = K.buildTopicDossier({
        booksById: map,
        refs: [
            { id: 'r1', column: 'quote', text: '甲走了', source: { bookId: 'b1', bookTitle: '同名书', contentHash: 'h1' } },
            { id: 'r2', column: 'quote', text: '甲走了', source: { bookId: 'b2', bookTitle: '同名书', contentHash: 'h2' } },
        ],
    });
    assert.equal(good.books.length, 2, '原版必须按书 ID 各算一本');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-X9', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);
    assert.ok(items.indexOf('R5-X9') >= 0, '当版条目必须点名 R5-X9');
    assert.ok(items.indexOf('第五期') >= 0, '当版条目必须点名第五期');
    assert.ok(items.indexOf('版本升至 ' + ver) >= 0, '当版条目必须带收口条目');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});