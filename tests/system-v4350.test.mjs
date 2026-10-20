/* ============================================================
 * tests/system-v4350.test.mjs -- [v4.35.0 · 第五期 R5-O8 研究摘录重开后自动回源核对]
 *
 * 验收口径（计划原文 R5-O8）：
 *   「做两本书摘录 → **清空运行时缓存或重启** → 直接进入研究页，**不先打开书也能完成核对**
 *    并跳回原句；删附件显示缺失，改版显示待重定位；批注不被当原文改写。」
 *   不做：**不重建研究笔记功能**；**不只改「未核对」文案**。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `reading-app.js::researchList()` 只把运行时缓存 `_contentCache` 里的正文交给
 *   `buildResearchList`。重启后直接进研究页（没先打开过书）时缓存是空的
 *   ⇒ `checkExcerptAnchor` 每条都落 `FINGERPRINT`「未定论」。
 *   那个态**不算撒谎**（它说的是「这次没读正文」），但它把两件不同的事压成同一格：
 *     ① 这本书**根本没存过正文附件**（换设备 / 没导入）⇒ 该显示「缺失」；
 *     ② 附件在、只是**这次没读**（重启后的第一眼）⇒ 该显示「正在核对」再变结论。
 *   更硬的一条：修前**没有任何入口**能让用户把这一屏变好 —— 不打开书就永远「未定论」。
 *
 * 【本版落的三件】
 *   （一）契约件 `config/reading-notes-contract.js`：新增 `readBooksForAnchors`
 *   （逐本读正文的生成器，**入口先让出一次**）与 `researchListChunks`（按书分片的研究清单）；
 *   新增**唯一装配点** `researchItemsOf`（同步入口与分片入口共用，防两条路漂移）；
 *   `buildResearchList` 改为**抽干**分片版；清单 counts 增两格**回源读数**
 *   （`books` / `read`：几本在书目里、几本这次真读到正文）；`researchLine` 如实说这一句；
 *   自检加第八项（分片与同步逐字段等价 + 冷启动**真的去读了**）。
 *   （二）控制器：`researchListAsync`（异步分片、可取消、任务身份 `newAnchorTask` /
 *   `cancelAnchor`），读口一律走既有的 `bookReadOf`（缓存优先、再附件）。
 *   （三）视图：**重开自动回源核对**（每屏只跑一次）+ 手动重跑 + 取消 + 进度读数；
 *   优先显示这次回源核出来的读数；换会话一并作废并取消正在跑的那一轮。
 *
 * 判据面（六组）：
 *   A 口径：读口只认 `chapters`（不额外要求 `ok`）、出口在具名转出块且不改历史那一块、
 *            自检第八项真跑、纯契约零副作用、回源读数两格
 *   B 内核行为：分片与同步**逐字段等价**、**逐本让出**、书目为空也让出一次、
 *            读不到的条目照样产出、自带正文不被读口覆盖、同一本只读一次
 *   C 接线行为：冷启动真读到了正文（修前是「未定论」）、附件缺失如实报「读到 0 本」、
 *            取消可响应且读数如实、换会话作废、视图有重跑与取消入口且**重开自动跑**
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目点名 R5-O8
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「不先打开书也能核对」不在本套件判跳回原句】跳转是**真 DOM 层**读数
 *   （点击 + 渲染 + 滚动），归浏览器门；本套件判它的**可判定前件**：
 *   冷启动清单真的读到了正文、锚点真的定论下来、读数如实。
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
const KERNEL_REL = 'config/reading-notes-contract.js';
const APP_REL = 'apps/reading/reading-app.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const NL = String.fromCharCode(10);
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const ATT = await import(pathToFileURL(path.join(ROOT, 'apps/reading/reading-attachment.js')).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
/* ══════════ 去注释（判据只认代码，不认注释里的自述） ══════════ */
const REGEX_PREV = ['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', NL];
const REGEX_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'do', 'else', 'void', 'delete', 'yield', 'await'];
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    const prevSig = () => {
        for (let k = out.length - 1; k >= 0; k--) {
            const c = out[k];
            if (c === ' ' || c === NL || c === '\t') continue;
            return c;
        }
        return '';
    };
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d !== undefined && d !== ' ' && d !== '=') {
                const p = prevSig();
                const atExpr = (p === '' && out.trim() === '') || REGEX_PREV.indexOf(p) >= 0 || REGEX_KEYWORDS.indexOf(p) >= 0;
                if (atExpr) {
                    let k = i + 1;
                    let inClass = false;
                    while (k < src.length) {
                        const rc = src[k];
                        if (rc === String.fromCharCode(92)) { k += 2; continue; }
                        if (rc === NL) break;
                        if (rc === '[') inClass = true;
                        else if (rc === ']') inClass = false;
                        else if (rc === '/' && !inClass) { k += 1; break; }
                        k += 1;
                    }
                    while (k < src.length && /[gimsuy]/.test(src[k])) k += 1;
                    out += src.slice(i, k);
                    i = k;
                    continue;
                }
            }
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
/* ══════════ 最小 indexedDB 实现（判据的一部分：C 组要真跑附件层） ══════════ */
function makeIdb() {
    const dbs = new Map();
    function makeReq(compute, txState) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
            try { req.result = compute(); if (req.onsuccess) req.onsuccess(); }
            catch (e) {
                req.error = e;
                if (txState) txState.failed = e;
                if (req.onerror) req.onerror();
            }
        });
        return req;
    }
    function makeDb(name) {
        const storeOf = (s) => { if (!dbs.get(name).has(s)) throw new Error('no-store:' + s); return dbs.get(name).get(s); };
        function makeStore(s, opts, txState) {
            const map = () => storeOf(s);
            return {
                put(rec) {
                    return makeReq(() => {
                        const key = opts && opts.keyPath ? rec[opts.keyPath] : rec.bookId;
                        map().set(key, rec);
                        return key;
                    }, txState);
                },
                get(key) { return makeReq(() => map().get(key), txState); },
                getAll() { return makeReq(() => Array.from(map().values()), txState); },
                delete(key) { return makeReq(() => map().delete(key), txState); },
                index(n) {
                    return {
                        getAll(v) {
                            return makeReq(() => Array.from(map().values()).filter((r) => r && r[n] === v), txState);
                        }
                    };
                }
            };
        }
        return {
            objectStoreNames: { contains: (s) => dbs.get(name).has(s) },
            createObjectStore(s, opts) { dbs.get(name).set(s, new Map()); return makeStore(s, opts, null); },
            transaction(s, mode) {
                void mode;
                const txState = { failed: null };
                const tx = {
                    error: null, oncomplete: null, onerror: null, onabort: null,
                    objectStore: (n) => makeStore(n, { keyPath: 'bookId' }, txState)
                };
                setTimeout(() => {
                    if (txState.failed) { tx.error = txState.failed; if (tx.onerror) tx.onerror(); return; }
                    if (tx.oncomplete) tx.oncomplete();
                }, 0);
                return tx;
            },
            close() { /* 最小实现：连接无需真关闭 */ }
        };
    }
    return {
        open(name) {
            const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
            queueMicrotask(() => {
                if (!dbs.has(name)) dbs.set(name, new Map());
                req.result = makeDb(name);
                if (req.onupgradeneeded) req.onupgradeneeded();
                if (req.onsuccess) req.onsuccess();
            });
            return req;
        }
    };
}
function idbWin() { return { indexedDB: makeIdb() }; }
const noIdbWin = {};
/** storage 假件：只实现 data 层用到的 get/set/has。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k),
        version: '1.19.0'
    };
}
function mkApp(st, win) {
    const a = new APP.ReadingApp({ showNotification: () => {}, screen: null }, st || mkStorage());
    a._hostWin = () => (win === undefined ? noIdbWin : win);
    return a;
}
/** 造一本 n 章的书，每章 2 段；指定位置埋独有句。 */
function mkBook(n, marks) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({ title: '第' + (i + 1) + '章', paragraphs: ['甲' + i + '段', '乙' + i + '段'] });
    }
    for (const m of (marks || [])) {
        if (out[m.ch]) out[m.ch].paragraphs[m.para] = m.text;
    }
    return out;
}
function seedBook(app, bookId, hash, chs) {
    app.data.shelf.unshift({
        id: bookId, title: '书' + bookId, fileName: 'b.txt', author: '',
        encoding: 'utf-8', format: 'txt', mode: 'auto', addedAt: 1,
        chapterCount: chs.length, contentHash: hash, hasContent: true
    });
    return bookId;
}
const MARK_A = '甲书独有句';
const MARK_B = '乙书独有句';
/** 两本书各一条摘录（验收「做两本书摘录」那一句）。 */
function twoBooks(app, win) {
    const b1 = seedBook(app, 'rd_b1', 'h1', mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]));
    const b2 = seedBook(app, 'rd_b2', 'h2', mkBook(4, [{ ch: 3, para: 1, text: MARK_B }]));
    app._contentCache.set(b1, mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]));
    app._contentCache.set(b2, mkBook(4, [{ ch: 3, para: 1, text: MARK_B }]));
    app.addExcerpt({ text: MARK_A, bookId: b1, bookTitle: '书' + b1, chapter: 2, para: 0 });
    app.addExcerpt({ text: MARK_B, bookId: b2, bookTitle: '书' + b2, chapter: 3, para: 1 });
    void win;
    return { b1: b1, b2: b2 };
}
/** 把两本书的正文真写进（假）附件层，再清空运行时缓存 —— 模拟「重启后直接进研究页」。 */
async function persistThenColdStart(app, win, ids) {
    for (const id of ids) {
        const chs = app._contentCache.get(id);
        await ATT.putBookBody(win, { bookId: id, title: '书' + id, contentHash: id === 'rd_b1' ? 'h1' : 'h2', chapters: chs });
    }
    app._contentCache.clear();
}
/* ══════════ A ── 口径 ══════════ */
test('A1 读口只认 `chapters` 是数组：**不额外要求 `ok` 格**（App 的读口本来就没有它）', () => {
    /* 这条是**本版最容易踩的坑**：`bookReadOf` 给的是 `{id,title,contentHash,chapters,why}`，
     *   若读口额外要求 `r.ok === true`，那么「读到了正文」会被判成「读不到」——
     *   而那正是本版要治的形态（把读到与读不到压成同一格）。 */
    assert.equal(kernelCode.indexOf('r.ok === true'), -1,
        '★ 读口不得要求 ok 格：App 的 bookReadOf 没有这一格，多加一条会把「读到了」判成「读不到」');
    assert.ok(kernelCode.indexOf('Array.isArray(r.chapters)') >= 0, '读口必须只认 chapters 是数组');
});
test('A2 出口面：研究清单分片出口在场，且**声明处不写 export**、也不改 v4.34.0 那一块', () => {
    assert.equal(typeof K.researchListChunks, 'function', '研究清单分片版必须导出');
    assert.equal(kernelCode.indexOf('export function*'), -1,
        '★ 生成器声明不得写成 export function*（门禁不认这种写法，会拒判）');
    assert.ok(kernelCode.indexOf('export { researchListChunks };') >= 0,
        '研究清单分片出口必须在具名转出块里');
    /* v4.34.0 的 A4 判据锁着**上一块**的精确形态 —— 本版另起一块，不动历史那一块。 */
    assert.ok(kernelCode.indexOf('export { buildIndexChunks, searchBookChunks };') >= 0,
        '★ 不得改动 v4.34.0 那一块的精确形态（改历史判据与放宽门禁只差一步）');
    /* 同步入口必须只是**抽干**：同一口径只许一份实现。 */
    assert.ok(kernelCode.indexOf('const gen = researchListChunks(') >= 0, '同步清单必须抽干分片版');
});
test('A3 唯一装配点：条目装配只有一处（防同步/分片两条路漂移）', () => {
    assert.ok(kernelCode.indexOf('function researchItemsOf(') >= 0, '必须有唯一的条目装配点');
    const uses = kernelCode.split('researchItemsOf(').length - 1;
    assert.equal(uses, 2, '装配点必须恰有 1 处定义 + 1 处调用（当前 ' + uses + ' 处）');
    assert.ok(kernelCode.indexOf('const built = researchItemsOf(') >= 0, '分片版必须调它，而不是自己再装配一遍');
});
test('A4 纯契约零副作用：读正文口由调用方注入，契约件自己**不碰存储不碰时钟**', () => {
    for (const bad of ['document', 'window', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'setImmediate', 'querySelector', 'Date.now', 'performance']) {
        assert.equal(kernelCode.indexOf(bad), -1, '纯契约件不得出现：' + bad);
    }
    const imports = kernelSrc.split(NL).filter((l) => l.trim().slice(0, 7) === 'import ');
    assert.equal(imports.length, 1, '本件只应有一条 import（零依赖叶子 + 唯一取数门）');
    /* 让出由**驱动器**做（App 的 `_yieldTurn`）：契约件只负责 yield。 */
    assert.ok(appCode.indexOf('_yieldTurn') >= 0, '让出必须落在驱动器（App），不在契约件');
});
test('A5 回源读数两格：几本在书目里 / 几本这次真读到正文，且读数行如实说这一句', () => {
    const list = K.buildResearchList([], []);
    assert.equal(list.counts.books, 0);
    assert.equal(list.counts.read, 0);
    const withBody = K.buildResearchList(
        [{ id: 'e1', text: '原文一句', bookId: 'b1', bookHash: 'h9', chapter: 0, para: 0 }],
        [{ id: 'b1', title: '书', contentHash: 'h9', chapters: [{ paragraphs: ['原文一句'] }] }]);
    assert.equal(withBody.counts.books, 1, '书目里有一本就要计上');
    assert.equal(withBody.counts.read, 1, '这次真读到了正文就要计上');
    assert.ok(withBody.line.indexOf('这次读到正文 1/1 本') >= 0, '读数行必须说清这次读到几本');
    /* 读到 0 本时读数必须**明说是没核成**，不许让用户以为「都对得上」。 */
    const noBody = K.buildResearchList(
        [{ id: 'e1', text: '原文一句', bookId: 'b1', bookHash: 'h9', chapter: 0, para: 0 }],
        [{ id: 'b1', title: '书', contentHash: 'h9' }]);
    assert.equal(noBody.counts.read, 0);
    assert.ok(noBody.line.indexOf('一本都没读到') >= 0,
        '★ 一本都没读到时必须明说（否则「没核成」会被读成「没问题」）：' + noBody.line);
    assert.equal(noBody.items[0].anchor.settled, false, '没读正文的锚点不得算「已核对」');
});
test('A6 自检第八项真跑：分片清单与同步等价、且冷启动**真的去读了正文**', () => {
    const r = K.notesSelfCheck();
    assert.deepEqual(r.problems, [], '自检不得报问题：' + JSON.stringify(r.problems));
    /* 自检必须**真跑**：把读口换成计数桩，跑一次分片版，看它到底调没调。 */
    assert.ok(kernelCode.indexOf('readsCalled') >= 0, '自检必须真数「读口被调了几次」，而不是只数常量');
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 分片清单与同步清单**逐字段等价**（分片只许改节奏，不许改结果）', () => {
    const ex = [
        { id: 'e1', text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 2, para: 0, annotation: '我的解释', tags: '伏笔,素材' },
        { id: 'e2', text: MARK_B, bookId: 'rd_b2', bookHash: 'h2', chapter: 3, para: 1 },
    ];
    const books = [
        { id: 'rd_b1', title: '甲书', contentHash: 'h1', chapters: mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]) },
        { id: 'rd_b2', title: '乙书', contentHash: 'h2', chapters: mkBook(4, [{ ch: 3, para: 1, text: MARK_B }]) },
    ];
    const sync = K.buildResearchList(ex, books);
    const gen = K.researchListChunks(ex, books, null, null);
    let step = gen.next();
    while (!step.done) step = gen.next(step.value);
    const chunk = step.value;
    assert.deepEqual(chunk.items, sync.items, '★ 分片与同步的条目必须逐字段一致（否则同一批摘录在两条路上结论不同）');
    assert.deepEqual(chunk.counts, sync.counts, '计数段也必须一致');
    assert.equal(chunk.line, sync.line, '读数行也必须一致');
});
test('B2 **逐本让出**：书目有几本就让出几次（外加阶段入口那一次）', () => {
    const books = [];
    for (let i = 0; i < 3; i++) books.push({ id: 'b' + i, title: '书' + i, contentHash: 'h' + i });
    const gen = K.researchListChunks([], books, null, null);
    let step = gen.next();
    let y = 0;
    while (!step.done) { y += 1; step = gen.next(step.value); }
    assert.ok(y >= 3, '★ 三本书至少要让出三次（当前 ' + y + ' 次）—— 让出粒度是「每本」，不是「全部」');
});
test('B3 阶段入口**先让出一次**：读到第一本之前就要有受理窗口（空书目也一样）', () => {
    /* 空书目：也必须让出一次，否则一次都不让出 ⇒ 取消永远受理不到
     *   （与 R5-O7 同一族形态：同一功能两种脾气，用户只会认为按钮时灵时不灵）。 */
    const gEmpty = K.researchListChunks([], [], null, null);
    assert.equal(gEmpty.next().done, false, '★ 空书目也必须先让出一次');
    /* 有书：**第一次让出时还没读任何一本** —— 这才是「读到第一本之前就有受理窗口」。
     *   只判「让出次数 ≥ 1」是不够的：归条前那次 yield 也会满足它，
     *   而那时读正文（最贵的一段）已经整段跑完了。 */
    let calls = 0;
    const gen = K.researchListChunks([], [{ id: 'b1', title: '书', contentHash: 'h1' }],
        function () { calls += 1; return { chapters: [{ paragraphs: ['甲'] }] }; }, null);
    const first = gen.next();
    assert.equal(first.done, false);
    assert.equal(calls, 0, '★ 第一次让出时**还没读任何一本**（否则读正文整段跑完才轮到取消）');
    let step = gen.next(first.value);
    while (!step.done) step = gen.next(step.value);
    assert.equal(calls, 1, '让出之后才真去读');
});
test('B4 读不到正文的条目**照样产出**（不跳过它：跳过等于把「没读到」伪装成「没有这条摘录」）', () => {
    const ex = [
        { id: 'e1', text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 0, para: 0 },
        { id: 'e2', text: MARK_B, bookId: 'rd_gone', bookHash: 'h9', chapter: 0, para: 0 },
    ];
    const r = K.buildResearchList(ex, [{ id: 'rd_b1', title: '甲书', contentHash: 'h1' }]);
    assert.equal(r.counts.total, 2, '★ 读不到正文的那条也必须进清单（否则用户以为摘录丢了）');
    const gone = r.items.filter((it) => it.bookId === 'rd_gone')[0];
    assert.ok(gone, '丢出处的条目必须在场');
    assert.equal(gone.anchor.state, K.EXCERPT_ANCHOR_STATES.UNREADABLE, '不在书架 ⇒ 判不了（不是「没问题」）');
    assert.equal(gone.anchor.settled, false);
    assert.equal(gone.anchor.needsConfirm, false, '「判不了」不等于「需确认」：两件事不许混');
});
test('B5 调用方**自带正文**时不被读口覆盖（同步入口的老用法必须一字不改）', () => {
    let called = 0;
    const books = [{ id: 'rd_b1', title: '甲书', contentHash: 'h1', chapters: mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]) }];
    const gen = K.researchListChunks([{ id: 'e1', text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 2, para: 0 }], books,
        function () { called += 1; return { chapters: null }; }, null);
    let step = gen.next();
    while (!step.done) step = gen.next(step.value);
    assert.equal(called, 0, '★ 调用方已经给了正文就不许再调读口（否则会把到手的正文丢掉）');
    assert.equal(step.value.items[0].anchor.settled, true, '自带正文时锚点必须照样能定论');
});
test('B6 同一本书的摘录**只读一次**（不按条数重复读附件）', () => {
    let called = 0;
    const ex = [];
    for (let i = 0; i < 5; i++) ex.push({ id: 'e' + i, text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 2, para: 0 });
    const gen = K.researchListChunks(ex, [{ id: 'rd_b1', title: '甲书', contentHash: 'h1' }],
        function () { called += 1; return { chapters: mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]) }; }, null);
    let step = gen.next();
    while (!step.done) step = gen.next(step.value);
    assert.equal(called, 1, '★ 五条摘录同属一本书：只许读一次（当前 ' + called + ' 次）');
    assert.equal(step.value.items.length, 5, '五条摘录都要进清单');
    assert.equal(step.value.items.filter((it) => it.anchor.settled).length, 5, '五条都能定论（读一次就够全书用）');
});
test('B7 读口抛错**不当成「核对通过」**：如实落成「读不到」', () => {
    const gen = K.researchListChunks([{ id: 'e1', text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 0, para: 0 }],
        [{ id: 'rd_b1', title: '甲书', contentHash: 'h1' }],
        function () { throw new Error('附件层炸了'); }, null);
    let step = gen.next();
    while (!step.done) step = gen.next(step.value);
    assert.equal(step.value.counts.read, 0, '读口抛错 ⇒ 这次没读到，不许算读到');
    assert.equal(step.value.items[0].anchor.settled, false, '★ 读口抛错绝不能被读成「已核对」');
});
/* ══════════ C ── 接线行为（真 App + 假附件层） ══════════ */
test('C1 冷启动：**不先打开书**也能核完，且锚点真定论下来（修前全是「未定论」）', async () => {
    const win = idbWin();
    const app = mkApp(mkStorage(), win);
    const { b1, b2 } = twoBooks(app, win);
    await persistThenColdStart(app, win, [b1, b2]);
    assert.equal(app._contentCache.size, 0, '前置：运行时缓存必须是空的（这才是「重启后」）');
    /* 修前这一屏会是「未定论」（没读正文）—— 本版必须真读到。 */
    const res = await app.researchListAsync();
    assert.equal(res.cancelled, false);
    assert.equal(res.counts.total, 2, '两条摘录都要在清单里');
    assert.equal(res.counts.read, 2, '★ 冷启动必须真读到两本正文（当前读到 ' + res.counts.read + ' 本）');
    const settledN = res.items.filter((it) => it.anchor.settled).length;
    assert.equal(settledN, 2,
        '★ 两本的锚点都必须定论为「已核对」（修前这里是 0，全是「未定论」；当前 ' + settledN + ' 条）');
    for (const it of res.items) {
        assert.equal(it.anchor.state, K.EXCERPT_ANCHOR_STATES.OK, '指纹与段文本都对得上：' + it.bookId);
    }
    assert.ok(res.line.indexOf('这次读到正文 2/2 本') >= 0, '读数行必须如实说读到几本：' + res.line);
});
test('C2 附件缺失：如实报「读到 0 本」，**不假装核对通过**也不说成「摘录过期」', async () => {
    const win = idbWin();
    const app = mkApp(mkStorage(), win);
    const { b1, b2 } = twoBooks(app, win);
    /* 只把 b1 存进附件层，b2 故意不存（模拟换设备后只搬来一本）。 */
    await ATT.putBookBody(win, { bookId: b1, title: '书' + b1, contentHash: 'h1', chapters: app._contentCache.get(b1) });
    app._contentCache.clear();
    const res = await app.researchListAsync();
    assert.equal(res.counts.read, 1, '只有一本存过附件');
    const miss = res.items.filter((it) => it.bookId === b2)[0];
    assert.ok(miss, '缺附件的那条**必须照样进清单**（不是「没有这条摘录」）');
    assert.equal(miss.anchor.settled, false, '★ 缺附件绝不能被读成「已核对」');
    assert.equal(miss.anchor.needsConfirm, false, '★ 缺附件是「判不了」，不是「摘录过期需重定位」——两件事不许混');
    assert.ok(res.line.indexOf('这次读到正文 1/2 本') >= 0, '读数行必须如实：' + res.line);
});
test('C3 改版书：正文改了指纹 ⇒ 旧摘录落「需确认」（这一格必须与本版新增的「缺失」分开）', async () => {
    const win = idbWin();
    const app = mkApp(mkStorage(), win);
    const b1 = seedBook(app, 'rd_c3', 'h1', mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]));
    app._contentCache.set(b1, mkBook(3, [{ ch: 2, para: 0, text: MARK_A }]));
    app.addExcerpt({ text: MARK_A, bookId: b1, bookTitle: '书', chapter: 2, para: 0 });
    await ATT.putBookBody(win, { bookId: b1, title: '书', contentHash: 'h1', chapters: app._contentCache.get(b1) });
    /* 改版：书架的指纹换成 h2（正文内容也换了）。 */
    app.data.shelf[0].contentHash = 'h2';
    app._contentCache.clear();
    const res = await app.researchListAsync();
    assert.equal(res.items[0].anchor.state, K.EXCERPT_ANCHOR_STATES.REVISION, '改版必须判「需确认」');
    assert.equal(res.items[0].anchor.needsConfirm, true, '改版必须算「需确认」（用户要自己看过的四种之一）');
    assert.equal(res.counts.needsConfirm, 1);
});
test('C4 取消可响应且读数如实：取消后不返回半份清单，读数说清「没核完」', async () => {
    const win = idbWin();
    const app = mkApp(mkStorage(), win);
    /* 造多本书，让「逐本让出」有机会被取消打断。 */
    const ids = [];
    for (let i = 0; i < 6; i++) {
        const id = 'rd_c4_' + i;
        seedBook(app, id, 'h' + i, mkBook(2, [{ ch: 1, para: 0, text: MARK_A }]));
        app._contentCache.set(id, mkBook(2, [{ ch: 1, para: 0, text: MARK_A }]));
        app.addExcerpt({ text: MARK_A, bookId: id, bookTitle: '书', chapter: 1, para: 0 });
    }
    await persistThenColdStart(app, win, ids);
    const o = app._yieldTurn.bind(app);
    let y = 0;
    app._yieldTurn = function () { y += 1; if (y >= 3) app.cancelAnchor(); return o(); };
    const res = await app.researchListAsync();
    assert.equal(res.cancelled, true, '★ 取消必须受理得到（否则按钮是装饰）');
    assert.equal(res.cancelledAt, 'anchor-read');
    assert.equal(res.items, undefined, '★ 取消后不许返回半份清单（半份比空更糟：用户会以为「只有这些」）');
    assert.ok(res.line.indexOf('没核完') >= 0, '读数必须说清「没核完」，不许说成「核完了」：' + res.line);
    assert.ok(res.reads < 6, '取消时确实没读完（已读 ' + res.reads + ' 本）');
});
test('C5 任务身份：换会话/重跑时旧任务可取消，且取消只对**当前**那一枚生效', async () => {
    const app = mkApp();
    const t1 = app.newAnchorTask();
    app._anchorTask = t1;
    assert.equal(app.currentAnchorTask().id, t1.id);
    const t2 = app.newAnchorTask();
    app._anchorTask = t2;
    assert.notEqual(t1.id, t2.id, '两次任务必须有不同的身份（否则分不清是谁取消了谁）');
    const r = app.cancelAnchor();
    assert.equal(r.ok, true);
    assert.equal(r.taskId, t2.id, '取消必须打在**当前**那一枚上');
    assert.equal(t2.cancelled, true);
    assert.equal(t1.cancelled, false, '旧任务不该被这一下取消');
    /* 没有正在跑的任务时如实报「没有」，不编一个假的成功。 */
    app._anchorTask = null;
    assert.equal(app.cancelAnchor().ok, false);
    assert.equal(app.currentAnchorTask(), null, '没有任务就是 null（不报一个假的空任务）');
});
test('C6 读口复用：清单走的读口就是既有的 `bookReadOf`（本件不另开一条读取路径）', () => {
    assert.ok(appCode.indexOf('researchListChunks(this.excerpts, books, (b) => this.bookReadOf(b && b.id), null)') >= 0,
        '★ 清单读正文必须复用 bookReadOf（同一口径只许一份实现）');
    /* 读到的正文要顺手进缓存：下一次查找/核对不必再读一遍附件。 */
    assert.ok(appCode.indexOf('this._contentCache.set(id, chapters)') >= 0, '读到的正文必须进运行时缓存');
});
test('C7 视图：有重跑与取消入口、有进度读数，且**重开自动跑一次**（每次进入只跑一次）', () => {
    assert.ok(viewCode.indexOf('rd-research-refresh') >= 0, '清单必须有「重新核对」入口');
    assert.ok(viewCode.indexOf('rd-research-cancel') >= 0, '清单必须有取消入口');
    assert.ok(viewCode.indexOf('_researchProgressLine') >= 0, '清单必须有进度读数行');
    assert.ok(viewCode.indexOf('refreshResearch') >= 0, '重跑必须真接到控制器');
    /* ★ 自动那一跑：验收要求「直接进入研究页，不先打开书也能完成核对」——
     *   没有自动那一跑，用户就必须先知道要点那个按钮。 */
    assert.ok(viewCode.indexOf('this._researchTried = true') >= 0,
        '★ 重开必须自动回源核对（否则「不先打开书也能核对」要靠用户自己找到按钮）');
    assert.ok(viewCode.indexOf('if (!this._researchRunning && !this._researchTried)') >= 0,
        '自动那一跑必须**只跑一次**（否则每次重绘都读一遍附件）');
    /* 换会话必须作废并取消正在跑的那一轮。 */
    assert.ok(viewCode.indexOf('this.app.cancelAnchor?.()') >= 0, '换会话必须取消正在跑的那一轮');
    assert.ok(viewCode.indexOf('this._researchLine = \'\'') >= 0, '换会话必须作废清单读数（那是上一会话的）');
});
/* ══════════ D ── 负控制（破坏副本，不动真仓） ══════════ */
function smashOnce(src, anchor, to) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中 1 次（当前 ' + n + ' 次）：' + anchor);
    return src.split(anchor).join(to);
}
function mkTmpTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp4350-'));
    copyTreeSafe(ROOT, dir, { filter: (s) => !s.split(path.sep).includes('.git') && !s.split(path.sep).includes('node_modules') });
    return dir;
}
test('D1 破坏「清单真去读正文」⇒ C1 同款判据必转红（冷启动又全是「未定论」）', async () => {
    /* 原版必真（反向对照）：冷启动真读到了两本。 */
    const win0 = idbWin();
    const app0 = mkApp(mkStorage(), win0);
    const r0 = twoBooks(app0, win0);
    await persistThenColdStart(app0, win0, [r0.b1, r0.b2]);
    const good = await app0.researchListAsync();
    assert.equal(good.counts.read, 2, '原版：冷启动必须读到两本正文');
    assert.equal(good.items.filter((it) => it.anchor.settled).length, 2, '原版：两条锚点都定论');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        /* 破坏形态：让分片清单**根本不调读口**（回到「只吃运行时缓存」的老样子）——
         *   这正是修前的病灶，也正是本版要治的那条。 */
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            'const reads = yield* readBooksForAnchors(books, readBook, opts);',
            'const reads = yield* readBooksForAnchors(books, null, opts);');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        const gen = KB.researchListChunks([{ id: 'e1', text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 0, para: 0 }],
            [{ id: 'rd_b1', title: '甲书', contentHash: 'h1' }],
            function () { return { chapters: mkBook(3, [{ ch: 0, para: 0, text: MARK_A }]) }; }, null);
        let step = gen.next();
        while (!step.done) step = gen.next(step.value);
        assert.equal(step.value.counts.read, 0,
            '★★★ 破坏副本上清单不再读正文 —— 冷启动会回到「一片未定论」，同款判据必须抓住它');
        assert.equal(step.value.items[0].anchor.settled, false, '破坏副本：锚点定论不了（这正是危害形态）');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D2 破坏「读口只认 chapters」⇒ 读到的正文会被判成「读不到」（A1 同款判据必转红）', async () => {
    assert.equal(kernelCode.indexOf('r.ok === true'), -1, '原版：读口不要求 ok 格');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            'const chapters = (r && Array.isArray(r.chapters)) ? r.chapters : null;',
            'const chapters = (r && r.ok === true && Array.isArray(r.chapters)) ? r.chapters : null;');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        /* App 的读口给的是 `{chapters, why}`（没有 ok 格）—— 破坏副本会把它判成「读不到」。 */
        const gen = KB.researchListChunks([{ id: 'e1', text: MARK_A, bookId: 'rd_b1', bookHash: 'h1', chapter: 0, para: 0 }],
            [{ id: 'rd_b1', title: '甲书', contentHash: 'h1' }],
            function () { return { chapters: mkBook(3, [{ ch: 0, para: 0, text: MARK_A }]) }; }, null);
        let step = gen.next();
        while (!step.done) step = gen.next(step.value);
        assert.equal(step.value.counts.read, 0,
            '★★★ 破坏副本上「读到了正文」被判成「读不到」—— 把读到与读不到压成同一格，同款判据必须抓住它');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D3 破坏「阶段入口先让出」⇒ B3 同款判据必转红（读正文整段跑完才轮到取消）', async () => {
    const g0 = K.researchListChunks([], [], null, null);
    assert.equal(g0.next().done, false, '原版：空书目也让出一次');
    let c0 = 0;
    const gen0 = K.researchListChunks([], [{ id: 'b1', title: '书', contentHash: 'h1' }],
        function () { c0 += 1; return { chapters: [{ paragraphs: ['甲'] }] }; }, null);
    gen0.next();
    assert.equal(c0, 0, '原版：第一次让出时还没读任何一本');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        /* 破坏形态：把**两处**「阶段让出」都去掉（读正文入口 + 归条之前）——
         *   于是空书目时一次都不让出，且读正文整段跑完才轮到驱动器。 */
        let broken = smashOnce(fs.readFileSync(p, 'utf8'),
            '    yield null;   // 阶段入口先让出一次（书目为空也至少有一个受理窗口）',
            '    void 0;');
        broken = smashOnce(broken,
            '    yield null;   // 读完之后、归条之前再让出一次（条目多时归条本身也是一段活）',
            '    void 0;');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        const genE = KB.researchListChunks([], [], null, null);
        assert.equal(genE.next().done, true,
            '★★★ 破坏副本上空书目一次都不让出 —— 取消永远受理不到，同款判据必须抓住它');
        let c = 0;
        const gen = KB.researchListChunks([], [{ id: 'b1', title: '书', contentHash: 'h1' }],
            function () { c += 1; return { chapters: [{ paragraphs: ['甲'] }] }; }, null);
        gen.next();
        assert.equal(c, 1,
            '★★★ 破坏副本上第一次让出时**已经读了一本** —— 读正文整段跑完才轮到取消，同款判据必须抓住它');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D4 破坏「取消后不返回半份清单」⇒ C4 同款判据必转红（半份比空更糟）', async () => {
    const win0 = idbWin();
    const app0 = mkApp(mkStorage(), win0);
    const ids0 = [];
    for (let i = 0; i < 6; i++) {
        const id = 'rd_d4_' + i;
        seedBook(app0, id, 'h' + i, mkBook(2, [{ ch: 1, para: 0, text: MARK_A }]));
        app0._contentCache.set(id, mkBook(2, [{ ch: 1, para: 0, text: MARK_A }]));
        app0.addExcerpt({ text: MARK_A, bookId: id, bookTitle: '书', chapter: 1, para: 0 });
    }
    await persistThenColdStart(app0, win0, ids0);
    const o0 = app0._yieldTurn.bind(app0);
    let y0 = 0;
    app0._yieldTurn = function () { y0 += 1; if (y0 >= 3) app0.cancelAnchor(); return o0(); };
    const r0 = await app0.researchListAsync();
    assert.equal(r0.cancelled, true, '原版：取消必须受理');
    assert.equal(r0.items, undefined, '原版：取消后不返回半份清单');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, APP_REL);
        /* 破坏形态：取消时**照旧把半份清单端出来**（用户会以为「只有这些」）。
         *   ★ 破坏点必须选**括号自洽**的那一处：把 `ok: false` 改成 `ok: true` 并附上
         *     半份条目 —— 首版改的是 `return {` 那一行，替换后括号不配对，
         *     副本直接 `SyntaxError`（那不是「抓住缺陷」，是判据自己坏了）。 */
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            "                return {\n                    ok: false, cancelled: true, cancelledAt: 'anchor-read',",
            "                return {\n                    items: [{ id: 'half', bookId: 'x', anchor: {} }], counts: { total: 1 },\n                    ok: false, cancelled: true, cancelledAt: 'anchor-read',");
        fs.writeFileSync(p, broken);
        const AB = await import(pathToFileURL(p).href);
        const win = idbWin();
        const app = new AB.ReadingApp({ showNotification: () => {}, screen: null }, mkStorage());
        app._hostWin = () => win;
        const ids = [];
        for (let i = 0; i < 6; i++) {
            const id = 'rd_d4b_' + i;
            seedBook(app, id, 'h' + i, mkBook(2, [{ ch: 1, para: 0, text: MARK_A }]));
            app._contentCache.set(id, mkBook(2, [{ ch: 1, para: 0, text: MARK_A }]));
            app.addExcerpt({ text: MARK_A, bookId: id, bookTitle: '书', chapter: 1, para: 0 });
        }
        for (const id of ids) {
            await ATT.putBookBody(win, { bookId: id, title: '书', contentHash: 'h' + ids.indexOf(id), chapters: app._contentCache.get(id) });
        }
        app._contentCache.clear();
        const o = app._yieldTurn.bind(app);
        let y = 0;
        app._yieldTurn = function () { y += 1; if (y >= 3) app.cancelAnchor(); return o(); };
        const r = await app.researchListAsync();
        assert.equal(r.cancelled, true, '破坏副本仍报告已取消（否则转红不是因为这条）');
        assert.equal(Array.isArray(r.items), true,
            '★★★ 破坏副本上取消照样端出半份清单 —— 用户会以为「只有这些」，同款判据必须抓住它');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源 + 当版条目点名 R5-O8', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const ul = JSON.parse(read('update-log.json'));
    const idx = read('index.js');
    const mm = /ST_PHONE_VERSION = '([^']+)'/.exec(idx);
    assert.ok(mm, 'index.js 必须有版本常量');
    assert.equal(pkg.version, mm[1], 'package.json 必须与 index.js 同源');
    assert.equal(man.version, mm[1], 'manifest.json 必须同源');
    assert.equal(ul.latest, mm[1], 'update-log.latest 必须同源');
    assert.equal(ul.head, mm[1], 'update-log.head 必须同源');
    const items = (ul.versions[mm[1]] || {}).items || [];
    assert.ok(items.length > 0, '当版必须有条目');
    const joined = items.join(NL);
    assert.ok(joined.indexOf('R5-O8') >= 0, '★ 当版条目必须点名 R5-O8（版本锚要能对上计划）：' + joined.slice(0, 200));
    assert.ok(joined.indexOf('回源核对') >= 0, '当版条目必须说清本版做的事');
    /* 迭代段必须在场（本仓规：每版一段）。 */
    const seg = read('tools/iter194_seg.md');
    assert.ok(seg.indexOf('4.35.0') >= 0, '迭代段必须写明版本');
    assert.ok(seg.indexOf('R5-O8') >= 0, '迭代段必须点名 R5-O8');
});
