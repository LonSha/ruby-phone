/* ============================================================
 * tests/system-v4210.test.mjs -- [v4.21.0 · 第四期 R4-O9 本地附件随备份真正搬走]
 *
 * 验收口径（计划原文 R4-O9）：
 *   在空存储环境恢复一本 TXT、一本 EPUB 及摘录/进度，离线可读且正文 hash 相同；
 *   中断/配额不足不报完整恢复；重复导入不产生双书，删除附件前列清引用它的书架项。
 *   不做：不静默下载外链图片、不上传云端、不把「完整手机备份」用于仅含元数据的包。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `config/data-backup.js` 的备份模型只围绕 **storage 键**，而书库正文在
 *   `apps/reading/reading-attachment.js` 的 **indexedDB** 里 —— 两个面互不相识。
 *   实测后果：备份包里没有任何正文本体，换设备后书架条目还在、点开一本书是空的
 *   （「书目搬走了，书是空的」）。这不是备份失败，是备份**从没打算搬正文**。
 *
 * 判据面（五组）：
 *   A 结构口径：四段互不同形 / 包魔标与整机备份刻意不同 / 纯内核零网络零存储零时钟
 *              / 消费点在场（建好不消费即悬空）
 *   B 内核行为：文本往返互逆 / 超限如实未包含 / 完整性只在正文格 / 两形态书架键
 *              / 读包六态 / 幂等 / 冲突默认保留
 *   C 接线行为：真 App + 本机 indexedDB 假件跑完整旅程（导出 → 空存储导入 → 正文回读）
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（配原版必真的反向对照）
 *   E 版本锚：五源同源
 *
 * 【为什么自带最小 indexedDB / 为什么负控制破坏副本而不是原仓】
 *   见 tests/system-v4120.test.mjs 档头（同一套理由，本版沿用该套件的判据契约）。
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

const KERNEL_REL = 'config/library-backup.js';
const APP_REL = 'apps/reading/reading-app.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const DATA_REL = 'apps/reading/reading-data.js';
const ATT_REL = 'apps/reading/reading-attachment.js';

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const ATT = await import(pathToFileURL(path.join(ROOT, ATT_REL)).href);

const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const dataSrc = read(DATA_REL);

/** 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。 */
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
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);

/* ══════════ 最小 indexedDB 实现（判据的一部分，见档头） ══════════ */
function makeIdb() {
    const dbs = new Map();
    const flags = { failPut: false };
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
                        if (flags.failPut) throw new Error('quota-exceeded');
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
        _flags: flags,
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
const noIdbWin = { };

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
function mkApp(storage, win) {
    const a = new APP.ReadingApp({ showNotification: () => {}, screen: null }, storage);
    a._hostWin = () => win;
    return a;
}
function chapters(n, tag) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ title: '第' + (i + 1) + '章', paragraphs: ['甲' + tag + i, '乙' + tag + i] });
    return out;
}
/** 源手机：一本 TXT + 一本 EPUB（正文落附件层）+ 摘录 + 进度。 */
async function seedSourcePhone(win) {
    const s = mkStorage();
    const app = mkApp(s, win);
    const chTxt = chapters(3, 'T');
    const chEpub = chapters(2, 'E');
    const b1 = app.data.addBook({ title: '甲书', format: 'txt', chapters: chTxt }, 'a.txt', 'utf-8', 'auto', { contentHash: 'hTXT' });
    const b2 = app.data.addBook({ title: '乙书', format: 'epub', chapters: chEpub }, 'b.epub', 'utf-8', 'auto', { contentHash: 'hEPUB' });
    await ATT.putBookBody(win, { bookId: b1.bookId, contentHash: 'hTXT', title: '甲书', chapters: chTxt });
    await ATT.putBookBody(win, { bookId: b2.bookId, contentHash: 'hEPUB', title: '乙书', chapters: chEpub });
    app.addExcerpt({ text: '甲T0', bookId: b1.bookId, bookTitle: '甲书', chapter: 0, para: 0, chapterTitle: '第1章' });
    app.addExcerpt({ text: '乙E0', bookId: b2.bookId, bookTitle: '乙书', chapter: 0, para: 0, chapterTitle: '第1章' });
    s.set('ruby_reading_progress_' + b1.bookId, JSON.stringify({ chapter: 2, para: 1, fontPx: 16, theme: 'parchment' }));
    return { app, storage: s, win, b1, b2, chTxt, chEpub };
}

/* ══════════ A ── 结构与口径 ══════════ */

test('A1 四段与六套状态集齐全，且同集内两两不同形', () => {
    assert.equal(K.LIB_SECTIONS.length, 4, '书库必须恰好四段（少一段用户手里就是残缺的书）');
    assert.deepEqual(K.LIB_SECTION_KEYS.slice().sort(), ['body', 'excerpt', 'progress', 'shelf']);
    const sets = {
        LIB_PACK_STATES: 6, LIB_REF_STATES: 3, LIB_ENTRY_STATES: 5, LIB_BODY_STATES: 6, LIB_MIGRATE_STATES: 4
    };
    for (const [name, n] of Object.entries(sets)) {
        const vals = Object.values(K[name]);
        assert.equal(vals.length, n, name + ' 应有 ' + n + ' 态');
        assert.equal(new Set(vals).size, vals.length, name + ' 内各态必须互不相同');
    }
    assert.equal(K.LIB_UNINCLUDED.length, 4, '未包含清单必须常驻（导出前用户有权看到）');
    /* 正文载体：只有「文本」算真搬走 —— 引用型换设备即失效，不得当已搬走。 */
    assert.equal(K.LIB_BODY_TRANSPORTS.TEXT, 'text');
    assert.notEqual(K.LIB_BODY_TRANSPORTS.REFERENCE, K.LIB_BODY_TRANSPORTS.TEXT);
});

test('A2 包魔标与整机备份刻意不同，且不误用 storage 规则读正文包', () => {
    const DB = read('config/data-backup.js');
    const m = DB.match(/BACKUP_MARK\s*=\s*'([^']+)'/);
    assert.ok(m, '整机备份的魔标必须存在（否则这条判据失去对照）');
    assert.notEqual(K.LIB_MARK, m[1], '★ 书库包与整机备份包必须是**两种包身份**');
    assert.equal(K.LIB_MARK, 'yuzuki-phone-library');
    /* 分层纪律：config 不得依赖 apps；内核唯一允许的依赖是本仓的零依赖叶子 num-gate
     *   （首版这里写成「内核零 import」，实际它 import 了 num-gate —— 断言方向写错，原版上就红）。 */
    const imports = kernelSrc.match(/^\s*import[^;]*;/gm) || [];
    for (const line of imports) {
        assert.equal(line.indexOf('apps/') >= 0, false, 'config 不得依赖 apps：' + line);
        assert.equal(line.indexOf('data-backup') >= 0, false, '书库包不得复用整机备份的实现（两种包身份要分开）：' + line);
    }
    const deps = imports.map((l) => (l.match(/'([^']+)'/) || [])[1]).filter(Boolean);
    assert.deepEqual(deps, ['./num-gate.js'], '内核依赖面应恰好是零依赖叶子 num-gate，实际：' + JSON.stringify(deps));
});

test('A3 纯内核：零网络 / 零 DOM / 零存储 / 零时钟（判据扫去注释后的代码）', () => {
    for (const bad of ['fetch(', 'XMLHttpRequest', 'new Image', 'document.', 'window.', 'localStorage',
        'sessionStorage', 'indexedDB', 'setTimeout', 'setInterval', 'new Date(', 'chatMetadata', 'setExtensionPrompt']) {
        assert.equal(kernelCode.indexOf(bad) >= 0, false, '纯内核不得出现 ' + bad);
    }
    /* 同时：守则要写在注释里（读者可见的自述），并通过 LIB_UNINCLUDED 常驻给用户看。 */
    const keys = K.LIB_UNINCLUDED.map((u) => u.key);
    for (const k of ['remote', 'other-device', 'quota', 'memory-only']) {
        assert.ok(keys.indexOf(k) >= 0, '未包含项缺 ' + k);
    }
});

test('A4 消费点在场：内核建好必须真被调用（否则就是悬空出口）', () => {
    for (const fn of ['refsOf(', 'buildLibraryPack(', 'textToChapters(', 'libraryPackLine(', 'libraryScanLine(',
        'readLibraryPack(', 'planLibraryImport(', 'commitLibraryImport(', 'undoLibraryImport(', 'libraryPlanLine(', 'librarySelfCheck(']) {
        assert.ok(appSrc.indexOf(fn) >= 0, 'App 侧必须真消费 ' + fn);
    }
    /* 视图五步按钮与删书前列引用（用户手上那一屏）。 */
    for (const id of ['rd-lib-scan', 'rd-lib-export', 'rd-lib-plan', 'rd-lib-commit', 'rd-lib-undo']) {
        assert.ok(viewSrc.indexOf('"' + id + '"') >= 0, '视图缺按钮 ' + id);
    }
    assert.ok(viewCode.indexOf('bodyRefsOf(') >= 0, '★ 删附件前列清引用必须有真调用点');
    /* 四段写口的身份是 bookId（不能走 addBook 的文件名判重，否则「重复导入不产生双书」不成立）。 */
    assert.ok(dataSrc.indexOf('adoptBook(entry) {') >= 0, '数据层必须有按 id 就地的写口');
    assert.ok(appCode.indexOf('this.data.adoptBook(') >= 0, '该写口必须真被导入流程调用');
});

/* ══════════ B ── 内核行为 ══════════ */

test('B1 正文文本往返互逆：不丢章、不丢段', () => {
    const chs = [{ title: '第一章 起', paragraphs: ['甲', '乙'] }, { title: '第二章 承', paragraphs: ['丙', '', '丁'] }];
    const text = K.chaptersToText(chs);
    const back = K.textToChapters(text);
    assert.equal(back.length, 2, '往返后章数必须不变');
    assert.equal(back[0].title, '第一章 起');
    assert.deepEqual(back[0].paragraphs, ['甲', '乙']);
    assert.deepEqual(back[1].paragraphs, ['丙', '', '丁'], '空段也要原样回来（段号是摘录与进度的锚）');
    assert.equal(K.chaptersToText(back), text, '二次往返必须逐字相同');
});

test('B2 超限如实记为未包含，绝不截断（半个正文在新机器上是一本坏书）', () => {
    const huge = 'x'.repeat(K.LIB_LIMITS.bodyBytes + 100);
    const pack = K.buildLibraryPack({
        books: [{ bookId: 'big', title: '大书', contentHash: 'hb', format: 'txt' }],
        bodies: [{ bookId: 'big', text: huge }],
    });
    assert.equal(pack.counts.bodies, 0, '超限正文不得进包');
    assert.equal(pack.counts.oversize, 1);
    assert.ok(pack.counts.omittedBytes > K.LIB_LIMITS.bodyBytes, '未包含体积必须如实记账');
    const row = pack.books[0];
    assert.equal(row.bodyIncluded, false);
    assert.ok(String(row.why).indexOf('不截断') >= 0, '必须写明「不截断」而不是悄悄少给一半');
    assert.equal(pack.bodies.filter((b) => b.bookId === 'big').length, 0, '★ 不得留下半截正文');
});

test('B3 完整性只在正文这一格判：摘录与进度为空是正常状态', () => {
    const books = [
        { bookId: 'n1', title: '新书', contentHash: 'h1', format: 'txt' },
        { bookId: 'n2', title: '缺正文', contentHash: 'h2', format: 'txt' },
    ];
    const pack = K.buildLibraryPack({
        books, bodies: [{ bookId: 'n1', chapters: chapters(2, 'N') }],
    });
    const refs = K.refsOf({
        shelf: books,
        bodies: [{ bookId: 'n1', bytes: 10, contentHash: 'h1', chapterCount: 2 }],
    });
    assert.equal(refs.counts.withoutBody, 1, '缺正文应如实计 1 本');
    assert.equal(refs.books[0].complete, true, '★ 没摘录、没进度**不算不完整**');
    assert.equal(refs.books[1].complete, false);
    assert.ok(K.libraryScanLine(refs).indexOf('缺正文') >= 0, '扫描读数必须点名缺正文');
    assert.equal(pack.counts.completeBooks, 1);
});

test('B4 书架键两形态都要认（id / bookId）：否则静默导出空包', () => {
    /* 探针实测抓到的真缺陷：只认 s.id 时，bookId 形态的数组被**静默丢空** ——
     * 导出的包「0 本」，而同一屏的扫描行还说「2 本」。 */
    const byBookId = [{ bookId: 'x1', title: '甲', contentHash: 'h1', format: 'txt' }];
    const byId = [{ id: 'x1', title: '甲', contentHash: 'h1', format: 'txt' }];
    const packA = K.buildLibraryPack({ books: byBookId, bodies: [{ bookId: 'x1', chapters: chapters(1, 'A') }] });
    const packB = K.buildLibraryPack({ books: byId, bodies: [{ bookId: 'x1', chapters: chapters(1, 'A') }] });
    assert.equal(packA.counts.books, 1, '★ bookId 形态不得被静默丢弃');
    assert.equal(packB.counts.books, 1);
    assert.equal(packA.counts.bodies, 1);
    assert.equal(packB.counts.bodies, 1);
    const refs = K.refsOf({ shelf: byBookId, bodies: [{ bookId: 'x1', bytes: 1, contentHash: 'h1' }] });
    assert.equal(refs.counts.withBody, 1);
});

test('B5 读包六态与迁移两条路（不猜字段、不跳步改写）', () => {
    const six = [
        K.readLibraryPack(null).state,
        K.readLibraryPack([]).state,
        K.readLibraryPack({ books: [] }).state,
        K.readLibraryPack({ mark: 'yuzuki-phone-backup' }).state,
        K.readLibraryPack({ mark: K.LIB_MARK, schemaVersion: 99 }).state,
        K.readLibraryPack({ mark: K.LIB_MARK, schemaVersion: 1, books: [] }).state,
    ];
    assert.deepEqual(six, ['empty', 'not-object', 'unmarked', 'foreign', 'future', 'ok']);
    assert.equal(K.readLibraryPack({ mark: K.LIB_MARK, schemaVersion: 99 }).accepted, false, '未来版本必须明确拒');
    assert.equal(K.readLibraryPack({ books: [] }).accepted, true, '无魔标的旧包按兼容面收下（但要走迁移）');
    assert.equal(K.migrateLibraryPack({ mark: K.LIB_MARK, schemaVersion: null }, 1).state, 'too-old');
    assert.equal(K.migrateLibraryPack({ mark: K.LIB_MARK, schemaVersion: 9 }, 1).state, 'future');
    assert.equal(K.migrateLibraryPack({ mark: K.LIB_MARK, schemaVersion: 1, books: [] }, 1).state, 'current');
    assert.equal(K.LIB_MIGRATIONS.length, 0, '本版只有 v1，迁移表为空（结构留到下一版）');
});

test('B6 幂等：逐字相同不写；本机缺正文时仍要补写正文', () => {
    const pack = K.buildLibraryPack({
        books: [{ bookId: 'i1', title: '甲', contentHash: 'h1', format: 'txt' }],
        bodies: [{ bookId: 'i1', chapters: chapters(1, 'I') }],
    });
    const plan = K.planLibraryImport(pack, { shelf: [{ id: 'i1', contentHash: 'h1' }], bodyIds: ['i1'] }, {});
    assert.equal(plan.totals.identical, 1);
    const c = K.commitLibraryImport(plan, {});
    assert.equal(c.counts.shelf, 0, '★ 重复导入不得产生书架写入');
    assert.equal(c.counts.bodies, 0, '正文已在，也不必重写');
    const half = K.planLibraryImport(pack, { shelf: [{ id: 'i1', contentHash: 'h1' }], bodyIds: [] }, {});
    const c2 = K.commitLibraryImport(half, {});
    assert.equal(c2.counts.bodies, 1, '★ 深化：本机书目相同但正文缺席 ⇒ 必须补写正文（半吊子状态的解药）');
});

test('B7 冲突（同名不同文件）默认保留本机，显式 overwrite 才动', () => {
    const pack = K.buildLibraryPack({
        books: [{ bookId: 'c1', title: '甲', contentHash: 'NEW', format: 'txt' }],
        bodies: [{ bookId: 'c1', chapters: chapters(1, 'C') }],
    });
    const plan = K.planLibraryImport(pack, { shelf: [{ id: 'c1', contentHash: 'OLD' }], bodyIds: ['c1'] }, {});
    assert.equal(plan.totals.conflict, 1);
    assert.equal(K.commitLibraryImport(plan, {}).counts.shelf, 0, '默认 keep：不得覆盖本机');
    assert.equal(K.commitLibraryImport(plan, { onConflict: 'overwrite' }).counts.shelf, 1);
    assert.equal(K.commitLibraryImport(plan, { onConflict: 'skip' }).counts.shelf, 0);
});

test('B8 缺口默认拒收；显式允许部分导入才放行', () => {
    const pack = K.buildLibraryPack({
        books: [
            { bookId: 'p1', title: '完整', contentHash: 'h1', format: 'txt' },
            { bookId: 'p2', title: '半本', contentHash: 'h2', format: 'txt' },
        ],
        bodies: [{ bookId: 'p1', chapters: chapters(1, 'P') }],
        excerpts: [{ bookId: 'p1', chapter: 0, para: 0, text: 'a' }, { bookId: 'p2', chapter: 0, para: 0, text: 'b' }],
    });
    const plan = K.planLibraryImport(pack, { shelf: [], bodyIds: [] }, {});
    assert.equal(plan.totals.rejected, 1, '★ 缺正文的书默认拒收（不完整不写）');
    assert.equal(plan.rows.filter((r) => r.bookId === 'p2')[0].state, 'rejected');
    assert.ok(plan.rows.filter((r) => r.bookId === 'p2')[0].why.indexOf('点开是空的') >= 0, '拒收理由要说人话');
    assert.equal(K.planLibraryImport(pack, { shelf: [], bodyIds: [] }, { allowPartial: true }).totals.rejected, 0);
    /* 摘录写口必须**跟着计划同一个源**：被拒收那本的摘录不得进写计划。 */
    const c = K.commitLibraryImport(plan, {});
    assert.deepEqual(c.excerptWrites.map((w) => w.bookId), ['p1'], '★ 拒收那本的摘录不得进写计划');
});

test('B9 ★★★ 撤销动作只许出 App 认识的那两种，且正文一律是「删掉本次写进去的那份」', () => {
    const pack = K.buildLibraryPack({
        books: [{ bookId: 'u1', title: '新书', contentHash: 'hu', format: 'txt' }],
        bodies: [{ bookId: 'u1', chapters: chapters(1, 'U') }],
    });
    const c = K.commitLibraryImport(K.planLibraryImport(pack, { shelf: [], bodyIds: [] }, {}), {});
    assert.deepEqual(c.bodyWrites.map((w) => w.kind), ['new'], '新增书的正文写口 kind 是 new');
    const undo = K.undoLibraryImport(c);
    const bodyActs = undo.undo.filter((u) => u.action.indexOf('body') >= 0).map((u) => u.action);
    const shelfActs = undo.undo.filter((u) => u.action.indexOf('book') >= 0).map((u) => u.action);
    assert.deepEqual(bodyActs, ['remove-body'],
        '★ 新增书的正文撤销动作必须是 remove-body：撤完本机不该留下那份正文。'
        + '修前这里是 restore-body，App 不认这个动作，兜底分支把它计成「已撤销」而附件仍在 —— 假成功。');
    assert.deepEqual(shelfActs, ['remove-book'], '★ 书架撤销动作同理：删掉本次加上去的条目（restore-book 也没人认）');
    for (const u of undo.undo) {
        assert.ok(['remove-body', 'remove-book'].indexOf(u.action) >= 0, '撤销动作超出了 App 认识的范围：' + u.action);
    }
    /* 还原情形（本机曾有过、已被删）同样只出这两种动作。 */
    const restPlan = K.planLibraryImport(pack, { shelf: [], bodyIds: [], tombstones: ['u1'] }, {});
    assert.equal(restPlan.rows[0].state, 'restore');
    const restUndo = K.undoLibraryImport(K.commitLibraryImport(restPlan, {}));
    for (const u of restUndo.undo) {
        assert.ok(['remove-body', 'remove-book'].indexOf(u.action) >= 0, '还原情形也越界了：' + u.action);
    }
});

/* ══════════ C ── 接线行为（真 App + 本机 indexedDB 假件） ══════════ */

test('C1 全旅程：导出 → 空存储导入 → 正文回读，hash 与文本都相同', async () => {
    const winA = idbWin();
    const src = await seedSourcePhone(winA);
    const scan = await src.app.scanLibrary();
    assert.equal(scan.counts.books, 2);
    assert.equal(scan.counts.withBody, 2, '源手机上两本都该有正文');

    const exp = await src.app.exportLibrary();
    assert.deepEqual(exp.missing, [], '两本正文都该取到');
    assert.equal(exp.pack.counts.bodies, 2, '★ 正文必须真的进包（修前这一格是 0）');
    assert.ok(exp.line.indexOf('不上传云端') >= 0);
    const packText = JSON.stringify(exp.pack);

    /* 空存储的新机器：包以**字符串**形式交进去（用户从旧设备拷来的 .json）。 */
    const winB = idbWin();
    const dst = mkApp(mkStorage(), winB);
    const plan = await dst.planLibraryImportOf(packText, {});
    assert.equal(plan.ok, true, '字符串包必须能读（读不出来该说读不出来，不该崩）');
    assert.equal(plan.plan.totals.new, 2);
    assert.equal(plan.plan.totals.rejected, 0);
    assert.equal(dst.data.getBooks().length, 0, '★ 预演阶段只读：不得动现有数据');

    const cm = await dst.commitLibrary({});
    assert.equal(cm.kind, 'committed', '两本都该落成，不能报 nothing-to-write');
    assert.equal(dst.data.getBooks().length, 2, '空存储环境必须恢复出两本');
    assert.deepEqual(dst.data.getBooks().map((b) => b.format).sort(), ['epub', 'txt'], '一本 TXT、一本 EPUB');
    assert.equal(dst.data.getBooks()[0].addedAt > 0, true, 'addedAt 不得是 1970');

    /* 正文 hash 相同 + 离线可读（往返文本逐字相同）。 */
    for (const [bookId, hash, chs] of [[src.b1.bookId, 'hTXT', src.chTxt], [src.b2.bookId, 'hEPUB', src.chEpub]]) {
        const got = await ATT.getBookBody(winB, bookId);
        assert.equal(got.state, ATT.ATTACHMENT_STATES.OK, '新机器上必须真能读到正文');
        assert.equal(got.contentHash, hash, '★ 正文 hash 必须相同');
        assert.equal(K.chaptersToText(got.chapters), K.chaptersToText(chs), '★ 正文必须逐字相同');
    }
    /* 摘录与进度一起回来。 */
    assert.equal(dst.getExcerpts().length, 2, '摘录必须跟着回来');
    const pg = dst.storage.get('ruby_reading_progress_' + src.b1.bookId);
    assert.ok(pg, '进度键必须落回');
    assert.equal(JSON.parse(pg).chapter, 2);
    assert.equal(JSON.parse(pg).para, 1);
});

test('C2 ★★ 重复导入不产生双书（身份是 bookId，不是文件名）', async () => {
    const win = idbWin();
    const src = await seedSourcePhone(win);
    const pack = (await src.app.exportLibrary()).pack;
    const winB = idbWin();
    const dst = mkApp(mkStorage(), winB);
    await dst.planLibraryImportOf(pack, {});
    await dst.commitLibrary({});
    const first = dst.data.getBooks().map((b) => b.id).sort();
    await dst.planLibraryImportOf(pack, {});
    const cm2 = await dst.commitLibrary({});
    const second = dst.data.getBooks().map((b) => b.id).sort();
    assert.deepEqual(second, first, '★ 第二次导入不得多出书（同 id 就地更新）');
    assert.equal(dst.data.getBooks().length, 2, '书架必须仍是 2 本');
    assert.equal(cm2.counts.shelf, 0, '逐字相同 => 不写书架');
});

test('C3 ★★★ 配额不足不报完整恢复，且不留「打不开的书」', async () => {
    const winA = idbWin();
    const src = await seedSourcePhone(winA);
    const pack = (await src.app.exportLibrary()).pack;
    const winB = idbWin();
    winB.indexedDB._flags.failPut = true;
    const dst = mkApp(mkStorage(), winB);
    await dst.planLibraryImportOf(pack, {});
    const cm = await dst.commitLibrary({});
    assert.equal(cm.kind, 'partial', '★ 正文一本没写进去 ⇒ 必须是 partial，不能报完整恢复');
    assert.equal(cm.ok, false);
    assert.ok(cm.note.indexOf('一个字都没落下') >= 0, '读数必须说清「那几本一个字都没落下」');
    assert.equal(cm.counts.bodyFailed, 2);
    assert.equal(cm.counts.bodyFailedIds.length, 2);
    assert.equal(dst.data.getBooks().length, 0, '★★★ 正文没落成的书不得留下书架条目（修前的病就是这里）');
    assert.equal(dst.getExcerpts().length, 0, '★ 摘录也不得指向不存在的正文');
    /* 反向对照：同一份包在能写的机器上必须落成 —— 否则上面那条判据是假绿。 */
    const okWin = idbWin();
    const okApp = mkApp(mkStorage(), okWin);
    await okApp.planLibraryImportOf(pack, {});
    assert.equal((await okApp.commitLibrary({})).kind, 'committed', '能写时必须报 committed');
});

test('C4 缺正文的包：默认一本不写；显式允许部分导入才新增', async () => {
    const partial = K.buildLibraryPack({
        books: [{ bookId: 'rb_part', title: '半本', fileName: 'p.txt', contentHash: 'hp', format: 'txt' }],
        bodies: [],
        excerpts: [{ text: '半', bookId: 'rb_part', chapter: 0, para: 0 }],
        progress: [{ bookId: 'rb_part', chapter: 0, para: 0 }],
    });
    const win = idbWin();
    const dst = mkApp(mkStorage(), win);
    const plan = await dst.planLibraryImportOf(partial, {});
    assert.equal(plan.plan.totals.rejected, 1);
    assert.equal(plan.plan.totals.partial, 1);
    const cm = await dst.commitLibrary({});
    assert.equal(cm.kind, 'nothing-to-write', '★ 一行都没写不能显示成「导入成功」');
    assert.ok(cm.note.indexOf('被跳过') >= 0 || cm.note.indexOf('没有写进任何东西') >= 0);
    assert.equal(dst.data.getBooks().length, 0);
    assert.equal(dst.getExcerpts().length, 0, '★ 被拒收那本的摘录不得并回');
    const plan2 = await dst.planLibraryImportOf(partial, { allowPartial: true });
    assert.equal(plan2.plan.totals.rejected, 0, '显式允许时才放行');
    /* 空包 / 读不出来的包：如实说「读不出来」，不许抛。 */
    const bad = await dst.planLibraryImportOf('{ not json', {});
    assert.equal(bad.ok, false);
    assert.ok(bad.note.indexOf('包不可用') >= 0);
});

test('C5 ★★ 删除附件之前先列清「哪些书架项引用了它」', async () => {
    const win = idbWin();
    const src = await seedSourcePhone(win);
    const refs = await src.app.bodyRefsOf(src.b1.bookId);
    assert.ok(refs.book, '引用者里有书架条目');
    assert.ok(refs.line.indexOf('甲书') >= 0, '读数必须点名是哪本书');
    assert.equal(refs.excerpts, 1, '摘录引用数');
    assert.equal(refs.hasProgress, true, '进度记录');
    assert.ok(refs.line.indexOf('第 3 章') >= 0, '进度要写成第几章（用户看得懂）');
    /* 孤儿正文：没有任何书架项引用它 —— 修前「删书漏删」留下的那一类。 */
    const orphanWin = idbWin();
    const orphanApp = mkApp(mkStorage(), orphanWin);
    await ATT.putBookBody(orphanWin, { bookId: 'rb_orphan', contentHash: 'ho', title: '孤儿', chapters: chapters(1, 'O') });
    const or = await orphanApp.bodyRefsOf('rb_orphan');
    assert.equal(or.book, null);
    assert.ok(or.line.indexOf('孤儿正文') >= 0, '★ 必须明说这是孤儿正文');
    const scan = await orphanApp.scanLibrary();
    assert.equal(scan.counts.orphans, 1, '扫描面也要认得出孤儿正文');
});

test('C6 键面未新增：正文仍走本机附件层，不进会话隔离面', () => {
    const stor = read('config/storage.js');
    assert.equal(stor.indexOf('ruby-phone-reading') >= 0, false, 'IDB 库名不得挤进 CHAT_DATA_PATTERNS');
    assert.equal(kernelCode.indexOf("'ruby_") >= 0, false, '内核不得引入新的 ruby_ 前缀键');
    assert.equal(appCode.indexOf('chatMetadata') >= 0, false, '阅读 App 不得把正文塞进 chatMetadata');
    assert.equal(appCode.indexOf('setExtensionPrompt') >= 0, false, '阅读 App 不得把正文塞进提示词');
    assert.ok(appSrc.indexOf('chatMetadata') >= 0, '守则同时写在注释里（读者可见的自述）');
    /* 库上限同源口径：两处数字必须一起改。 */
    assert.equal(K.LIB_LIMITS.bodyBytes, ATT.ATTACHMENT_LIMITS.bytes, '★ 单本上限必须与附件层同源口径');
    assert.equal(K.LIB_LIMITS.bodies, ATT.ATTACHMENT_LIMITS.books, '★ 本数上限必须与附件层同源口径');
});

test('C7 自检：内核十一项自证通过，且 App 有真消费点', async () => {
    const self = K.librarySelfCheck();
    assert.deepEqual(self.problems, [], '内核自检必须零问题');
    assert.equal(self.sections, 4);
    assert.equal(self.schema, 1);
    const app = mkApp(mkStorage(), idbWin());
    assert.deepEqual(app.librarySelfCheck().problems, [], 'App 侧消费点必须能真读到自检结果');
    assert.ok(app.libraryLine().indexOf('还没盘过') >= 0, '没盘过就说没盘过，不报 0');
});

test('C8 撤销：只撤本次写入，正文与书架条目都要撤', async () => {
    const winA = idbWin();
    const src = await seedSourcePhone(winA);
    const pack = (await src.app.exportLibrary()).pack;
    const winB = idbWin();
    const dst = mkApp(mkStorage(), winB);
    await dst.planLibraryImportOf(pack, {});
    await dst.commitLibrary({});
    assert.equal(dst.data.getBooks().length, 2);
    const un = await dst.undoLibrary();
    assert.equal(un.kind, 'undone');
    assert.equal(un.ok, true, '★ 撤销读数必须报成（未成/未知动作不得计成功）');
    assert.ok(un.note.indexOf('未成') < 0, '干净撤销的读数里不该出现「未成」字样');
    assert.equal(dst.data.getBooks().length, 0, '★ 撤销后书架条目必须清掉');
    assert.equal((await ATT.listBookBodies(winB)).count, 0, '★ 撤销后正文附件也必须清掉');
    assert.equal((await dst.undoLibrary()).kind, 'nothing-to-undo', '没有写入时撤销要说没得撤');
});

/* ══════════ D ── 负控制（真源码破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4210_'));
    temps.push(dir);
    /* 只镜像判据真正碰到的两棵子树（apps/reading 与 config）：
     *   整仓 137M 里有 51M 是无关 App，逐条 cp 会让每条负控制在 IO 上空转。 */
    copyTreeSafe(path.join(ROOT, 'apps', 'reading'), path.join(dir, 'apps', 'reading'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏：锚点必须**恰中一次**；破坏的是**副本**（绝不动真仓）。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）:' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadApp(dir, tag) {
    const m = await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
    return m;
}
function wrap(m, win) {
    const a = new m.ReadingApp({ showNotification: () => {}, screen: null }, mkStorage());
    a._hostWin = () => win;
    return a;
}
/** 一份「完整一本 + 缺正文一本」的包（缺正文那本带摘录）。 */
function mixedPack() {
    return K.buildLibraryPack({
        books: [
            { bookId: 'mf_good', title: '好书', contentHash: 'hg', format: 'txt' },
            { bookId: 'mf_bad', title: '半本', contentHash: 'hb', format: 'txt' },
        ],
        bodies: [{ bookId: 'mf_good', chapters: chapters(1, 'G') }],
        excerpts: [{ bookId: 'mf_good', chapter: 0, para: 0, text: 'g' }, { bookId: 'mf_bad', chapter: 0, para: 0, text: 'b' }],
    });
}

test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', async () => {
    /* ① 配额失败不留书架条目 */
    const w1 = idbWin(); w1.indexedDB._flags.failPut = true;
    const a1 = wrap(APP, w1);
    const pack = (await (async () => { const s = await seedSourcePhone(idbWin()); return (await s.app.exportLibrary()).pack; })());
    await a1.planLibraryImportOf(pack, {});
    assert.equal((await a1.commitLibrary({})).kind, 'partial', '原版：配额失败必须报 partial');
    assert.equal(a1.data.getBooks().length, 0, '原版：书架不得留空壳');
    /* ② 拒收那本的摘录不并回 */
    const a2 = wrap(APP, idbWin());
    await a2.planLibraryImportOf(mixedPack(), {});
    const cm2 = await a2.commitLibrary({});
    assert.deepEqual(a2.getExcerpts().map((e) => e.bookId), ['mf_good'], '原版：只并回落成那本的摘录');
    assert.equal(cm2.counts.excerpts, 1);
    /* ③ 同 id 就地更新（不产生双书） */
    const win3 = idbWin();
    const a3 = wrap(APP, win3);
    await a3.planLibraryImportOf(pack, {});
    await a3.commitLibrary({});
    await a3.planLibraryImportOf(pack, {});
    await a3.commitLibrary({});
    assert.equal(a3.data.getBooks().length, 2, '原版：重复导入仍是 2 本');
    /* ④ bookId 形态的书架键认得出来（不静默空包） */
    assert.equal(K.buildLibraryPack({ books: [{ bookId: 'k1', contentHash: 'h' }], bodies: [{ bookId: 'k1', text: 'x' }] }).counts.books, 1, '原版：bookId 形态必须认');
});

test('D1 ★★★ 破坏「正文先落、书架后认领」⇒ 书架上必留下打不开的书', async () => {
    const dir = breakCopy(APP_REL, '                    continue;', '                    ;');
    const m = await loadApp(dir, 'd1');
    const win = idbWin();
    win.indexedDB._flags.failPut = true;
    const app = wrap(m, win);
    const src = await seedSourcePhone(idbWin());
    const pack = (await src.app.exportLibrary()).pack;
    await app.planLibraryImportOf(pack, {});
    await app.commitLibrary({});
    assert.equal(app.data.getBooks().length, 2, '破坏副本：正文没落成却把书架条目认领了（打不开的书）');
    const a = wrap(APP, idbWin());
    await a.planLibraryImportOf(pack, {});
    assert.equal(a.data.getBooks().length, 0, '原版必须一本都不落');
});

test('D2 ★★★ 破坏「摘录只并回落成的那几本」⇒ 摘录必指向不存在的正文', async () => {
    const dir = breakCopy(APP_REL,
        'const writeIds = new Set([...excerptIds].filter(function (id) { return landed.has(id); }));',
        'const writeIds = new Set((Array.isArray(pack.excerpts) ? pack.excerpts : []).map(function (e) { return String(e && e.bookId); }));');
    const m = await loadApp(dir, 'd2');
    const app = wrap(m, idbWin());
    await app.planLibraryImportOf(mixedPack(), {});
    await app.commitLibrary({});
    const ids = app.getExcerpts().map((e) => e.bookId).sort();
    assert.deepEqual(ids, ['mf_bad', 'mf_good'], '破坏副本：拒收那本的摘录也并回了（悬空引用）');
    assert.equal(app.data.getBooks().some((b) => b.id === 'mf_bad'), false, '而它的书根本没进来 —— 摘录指向空气');
    const a = wrap(APP, idbWin());
    await a.planLibraryImportOf(mixedPack(), {});
    await a.commitLibrary({});
    assert.deepEqual(a.getExcerpts().map((e) => e.bookId), ['mf_good'], '原版只并回落成那本');
});

test('D3 ★★★ 破坏「导入写口走按 id 就地更新」⇒ 重复导入必产生双书', async () => {
    /* 破坏面选在**写口本身**而不是它的内部实现：删掉内核里 `at >= 0` 那一支在行为上
     *   不可观测 —— 内核先判 identical，重复导入那次根本走不到该支（首版判据因此
     *   在破坏副本上也通过，属于「破坏没发生也绿」的假绿）。 */
    const dir = breakCopy(APP_REL,
        '                this.data.adoptBook({\n'
        + '                    id: id, title: bk.title, fileName: bk.fileName,\n'
        + '                    contentHash: bk.contentHash, format: bk.format,\n'
        + '                    chapterCount: (b ? textToChapters(b.text).length : 0),\n'
        + '                });',
        "                this.data.addBook({ title: bk.title, format: bk.format, chapters: [] }, 'd3-' + String(Date.now()) + '-' + String(Math.random()), 'utf-8', 'auto', { contentHash: bk.contentHash });");
    const win = idbWin();
    const src = await seedSourcePhone(win);
    const pack = (await src.app.exportLibrary()).pack;
    const m = await loadApp(dir, 'd3');
    const app = wrap(m, idbWin());
    await app.planLibraryImportOf(pack, {});
    await app.commitLibrary({});
    const after1 = app.data.getBooks().length;
    await app.planLibraryImportOf(pack, {});
    await app.commitLibrary({});
    assert.equal(after1, 2);
    assert.equal(app.data.getBooks().length, 4, '破坏副本：重复导入翻倍（同一本书出现两次）');
    const a = wrap(APP, idbWin());
    await a.planLibraryImportOf(pack, {});
    await a.commitLibrary({});
    await a.planLibraryImportOf(pack, {});
    await a.commitLibrary({});
    assert.equal(a.data.getBooks().length, 2, '原版必须仍是 2 本');
});

test('D4 ★★★ 破坏「书架键两形态」⇒ bookId 形态被静默丢空（导出空包）', async () => {
    const dir = breakCopy(KERNEL_REL, 'const bookId = str(s && (s.id || s.bookId));', 'const bookId = str(s && s.id);');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d4=' + Date.now());
    const silent = mk.buildLibraryPack({ books: [{ bookId: 'k1', title: '甲', contentHash: 'h' }], bodies: [{ bookId: 'k1', text: '正文在此' }] });
    assert.equal(silent.counts.books, 0, '破坏副本：书目被静默丢空（同一屏扫描行还会说「1 本」）');
    assert.equal(silent.counts.bodies, 0);
    assert.equal(K.buildLibraryPack({ books: [{ bookId: 'k1', title: '甲', contentHash: 'h' }], bodies: [{ bookId: 'k1', text: '正文在此' }] }).counts.books, 1, '原版必须认出来');
    /* 反向对照：id 形态在两边都该认（否则这条判据只是「换了个形态的巧合」）。 */
    assert.equal(mk.buildLibraryPack({ books: [{ id: 'k1', contentHash: 'h' }], bodies: [{ bookId: 'k1', text: 'x' }] }).counts.books, 1);
});

test('D5 ★★★ 破坏「不完整默认不写」⇒ 空骨架必被当成恢复', async () => {
    const dir = breakCopy(KERNEL_REL,
        'if (!complete && state !== LIB_ENTRY_STATES.REJECTED && !allowPartial) {',
        'if (!complete && state !== LIB_ENTRY_STATES.REJECTED && !allowPartial && false) {');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d5=' + Date.now());
    const pack = mk.buildLibraryPack({
        books: [{ bookId: 'q1', title: '半本', contentHash: 'hq', format: 'txt' }], bodies: [],
    });
    const broken = mk.planLibraryImport(pack, { shelf: [], bodyIds: [] }, {});
    assert.equal(broken.totals.rejected, 0, '破坏副本：缺正文的书被放行了');
    assert.equal(broken.rows[0].state, 'new', '而它的正文根本不在包里 —— 换新机后点开是空的');
    assert.equal(K.planLibraryImport(pack, { shelf: [], bodyIds: [] }, {}).totals.rejected, 1, '原版必须拒收');
});

test('D6 ★★ 破坏「读包认魔标」⇒ 别人的包会被当书库包收下', async () => {
    const dir = breakCopy(KERNEL_REL, "    if (mark !== LIB_MARK) {", '    if (false) {');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d6=' + Date.now());
    assert.equal(mk.readLibraryPack({ mark: 'yuzuki-phone-backup' }).state, 'ok', '破坏副本：整机备份包被当书库包收下了');
    assert.equal(K.readLibraryPack({ mark: 'yuzuki-phone-backup' }).state, 'foreign', '原版必须明确拒');
});

test('D7 ★★★ 破坏「正文撤销动作」⇒ B9 同款判据必转红（附件撤不掉还被报成成功）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "undone.push({ bookId: w.bookId, action: 'remove-body', kind: w.kind });",
        "undone.push({ bookId: w.bookId, action: w.kind === 'body-fill' ? 'remove-body' : 'restore-body', kind: w.kind });");
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d7=' + Date.now());
    const pack = mk.buildLibraryPack({ books: [{ bookId: 'u1', contentHash: 'hu' }], bodies: [{ bookId: 'u1', chapters: chapters(1, 'U') }] });
    const c = mk.commitLibraryImport(mk.planLibraryImport(pack, { shelf: [], bodyIds: [] }, {}), {});
    const acts = mk.undoLibraryImport(c).undo.filter((u) => u.action.indexOf('body') >= 0).map((u) => u.action);
    assert.deepEqual(acts, ['restore-body'], '破坏副本：新增书的正文被判成 restore-body —— App 不认识它');
    /* 原版对照：同一判据必须给出 remove-body（否则上面的转红不算证据）。 */
    const pack0 = K.buildLibraryPack({ books: [{ bookId: 'u1', contentHash: 'hu' }], bodies: [{ bookId: 'u1', chapters: chapters(1, 'U') }] });
    const c0 = K.commitLibraryImport(K.planLibraryImport(pack0, { shelf: [], bodyIds: [] }, {}), {});
    assert.deepEqual(K.undoLibraryImport(c0).undo.filter((u) => u.action.indexOf('body') >= 0).map((u) => u.action), ['remove-body'], '原版必须 remove-body');
});

test('D8 ★★★ 破坏「撤销时真删附件」⇒ 读数报成功而附件仍在（假成功）', async () => {
    const dir = breakCopy(APP_REL, 'const r = await removeBookBody(this._hostWin(), u.bookId);',
        'const r = { state: ATTACHMENT_STATES.OK, removed: true };');
    const m = await loadApp(dir, 'd8');
    const src = await seedSourcePhone(idbWin());
    const pack = (await src.app.exportLibrary()).pack;
    const winB = idbWin();
    const app = wrap(m, winB);
    await app.planLibraryImportOf(pack, {});
    await app.commitLibrary({});
    const un = await app.undoLibrary();
    assert.equal(un.ok, true, '破坏副本：读数报「已撤销」');
    assert.equal((await ATT.listBookBodies(winB)).count, 2, '而附件层两份正文一份没删 —— 用户不会去检查附件层');
    /* 原版对照：撤销后附件必须为空（C8 同款判据）。 */
    const winC = idbWin();
    const a = wrap(APP, winC);
    await a.planLibraryImportOf(pack, {});
    await a.commitLibrary({});
    await a.undoLibrary();
    assert.equal((await ATT.listBookBodies(winC)).count, 0, '原版必须真删干净');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（版本号不锁死具体值，但必须一致且当版条目存在）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8,
        '当版公告至少 8 条（本版是四期里最大的一块，条目不该缩水）');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
});
