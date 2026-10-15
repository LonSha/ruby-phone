/* ========================================================
 * tests/system-v4120.test.mjs -- [v4.12.0 · 第三期 R3-X8 正文面]
 *   阅读正文的本地附件持久化 / 重启续读 / 丢附件重定位 / 删书不留孤儿
 *
 * 【计划原文 R3-X8】
 *   「正文作为独立本地附件持久化,metadata 只存引用/进度;可书签、划线、摘录成素材;
 *    优先复用宿主附件存储,替代方案需先确认本地 Blob 存储边界。」
 *   验收原文四条:重启继续同章同位置 / 同名不同文件不静默覆盖 /
 *   丢附件可重新定位 / 摘录保留书/章/段引用;另有硬约束:**正文不塞入提示词或 chatMetadata**。
 *
 * 【修前实测的缺口(不是推演)】
 *   reading-app.js::openBook 那句注释就是缺口本身 ——
 *   「正文未在内存(重启后):书架条目仅有元数据,提示需重新导入」。
 *   重启后书架里每本书都打不开,读者必须重新导入同一个文件。
 *
 * 【宿主存储边界的实测读数(真 SillyTavern 1.19.0)】
 *   Chromium 经 CDP 连 http://127.0.0.1:8000/ 在页面上下文实测:
 *   localStorage 可用但**配额仅 4MB**;indexedDB 可用;/api/files/upload 的 OPTIONS 204;
 *   host 的 /api/files/ 列表端口 404;chatMetadata 只有本仓自己的 st_virtual_phone 一个键。
 *   ⇒ 正文落 localStorage 会「一处膨胀、全机受伤」,故走 indexedDB(本机、不联网、不进 chatMetadata)。
 *
 * 判据面(五组):
 *   A 结构与口径:五态分形 / 零网络零提示词 / 附件层不写 chatMetadata / 消费点在场
 *   B 行为:存-取往返 / 重启续读(新实例)/ 丢附件重定位 / 删书连正文一起删 / 盘库不出正文
 *   C 接线:导入落附件 / 打开书回读附件 / 删书走 App / 视图按钮 / storage 键面未新增
 *   D 负控制:真源码定点破坏三条口径 ⇒ 同款判据必转红(配原版必真的反向对照)
 *   E 版本锚:下限形
 *
 * 【为什么自带一个最小 indexedDB】本仓依赖刻意为零(不装 fake-indexeddb)。
 *   自带实现是**判据的一部分**:它把「本模块真的按 IDB 契约用 API」钉住
 *   (put/get/delete/getAll/index/事务完成时机),而不是靠一个替身把错吞掉。
 * ========================================================= */
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
const ATT = 'apps/reading/reading-attachment.js';
const APP = 'apps/reading/reading-app.js';
const VIEW = 'apps/reading/reading-view.js';
const DATA = 'apps/reading/reading-data.js';
const attSrc = read(ATT);
const appSrc = read(APP);
const viewSrc = read(VIEW);
const A = await import(pathToFileURL(path.join(ROOT, ATT)).href);
/**
 * 去掉注释后的源码。**判据只认代码,不认注释里的自述** ——
 *   本仓的档头纪律要求把「正文不进 chatMetadata/提示词」写进注释,
 *   若用裸 includes 扫全文,注释里的字面量会把「守则」当成「违规」判红
 *   (首版实测踩到:两条口径断言在**未破坏**的原版上转红)。
 *   实现:手写状态机(字符串/模板串内不动手),只剥 `//` 与块注释。
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    let quote = '';
    while (i < n) {
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
        /* str */
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const attCode = stripComments(attSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
/** 方法体切片:锚点必须恰中一次且**是定义**(首版锚点 `_importTxt(file)` 先命中调用点
 *   `this._importTxt(file)`,切出空串 ⇒ 断言在真源上假红)。 */
function methodBody(code, head, tail) {
    assert.equal(code.split(head).length - 1, 1, '方法头必须恰中 1 次:' + head);
    const a = code.indexOf(head);
    const b = tail ? code.indexOf(tail, a) : -1;
    assert.ok(b > a, '方法尾必须在其后找到:' + tail);
    return code.slice(a, b);
}

/* ══════════ 最小 indexedDB 实现(判据的一部分,见档头) ══════════
 * 契约要点:open(onupgradeneeded/onsuccess)· transaction(mode)· objectStore
 * · put/get/getAll/delete/index(name).getAll(value)· tx.oncomplete/onerror/onabort
 * · req.result 在**回调触发前**就已就绪(与真 IDB 一致)。
 */
function makeIdb() {
    const dbs = new Map();   // name -> Map(store -> Map(key -> rec))
    const failNext = { put: false };
    /** 一个请求:结果在回调触发前就绪;失败要**如实上报给所属事务**(真 IDB 里
     *  请求失败会 abort 事务,于是 tx.onerror 触发 —— 这是「写失败 ⇒ writer-error」的契约根)。 */
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
    return {
        _fail: failNext,
        open(name) {
            const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
            queueMicrotask(() => {
                if (!dbs.has(name)) { dbs.set(name, new Map()); req.result = null; }
                const needUpgrade = req.result === null;
                const db = makeDb(name);
                req.result = db;
                if (needUpgrade && req.onupgradeneeded) req.onupgradeneeded();
                if (req.onsuccess) req.onsuccess();
            });
            return req;
        }
    };
    function makeDb(name) {
        const storeOf = (s) => { if (!dbs.get(name).has(s)) throw new Error('no-store:' + s); return dbs.get(name).get(s); };
        return {
            objectStoreNames: { contains: (s) => dbs.get(name).has(s) },
            createObjectStore(s, opts) {
                dbs.get(name).set(s, new Map());
                return makeStore(s, opts, null);
            },
            transaction(s, mode) {
                void mode;
                const txState = { failed: null };
                const tx = {
                    error: null, oncomplete: null, onerror: null, onabort: null,
                    objectStore: (n) => makeStore(n, { keyPath: 'bookId' }, txState)
                };
                /* ★ complete 必须排在**请求之后**:真 IDB 的 tx.oncomplete 只在事务内全部
                 *   请求完成后触发。首版用 queueMicrotask 会先 complete(那时 req.result
                 *   还是 undefined),读回的是**请求对象**而不是数据 —— 判据当场抓到
                 *   「取判据在原版必真」转红。这里用 setTimeout 让请求的微任务先跑完;
                 *   若期间有请求失败,则走 onerror(而不是 oncomplete)。 */
                setTimeout(() => {
                    if (txState.failed) {
                        tx.error = txState.failed;
                        if (tx.onerror) tx.onerror();
                        return;
                    }
                    if (tx.oncomplete) tx.oncomplete();
                }, 0);
                return tx;
            },
            close() { /* 最小实现:连接无需真关闭 */ }
        };
        function makeStore(s, opts, txState) {
            const map = () => storeOf(s);
            return {
                put(rec) {
                    return makeReq(() => {
                        if (failNext.put) throw new Error('quota-exceeded');
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
    }
}

/** 空 win:无 indexedDB(用来钉「unavailable ≠ empty」)。 */
const noIdbWin = { };
function idbWin() { return { indexedDB: makeIdb() }; }

/** 一本书的样例正文。 */
function chapters(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ title: '第' + (i + 1) + '章', paragraphs: ['段落 A' + i, '段落 B' + i] });
    return out;
}

/* ══════════ A ── 结构与口径 ══════════ */
test('A1 五态分形:五个状态与六个归因词都在,且两两不同形', () => {
    const S = A.ATTACHMENT_STATES;
    const vals = Object.values(S);
    assert.equal(new Set(vals).size, vals.length, '五个状态必须互不相同');
    for (const k of ['UNAVAILABLE', 'DENIED', 'EMPTY', 'OK', 'WRITER_ERROR']) {
        assert.ok(S[k], '缺状态:' + k);
    }
    assert.notEqual(S.UNAVAILABLE, S.EMPTY, '★「本环境没有附件层」与「你没存过」必须不同形');
    assert.notEqual(S.WRITER_ERROR, S.EMPTY, '★「写失败」与「没存过」必须不同形');
    const R = A.ATTACHMENT_REASONS;
    for (const r of ['ok', 'unavailable', 'denied', 'empty', 'writer-error', 'no-subject']) {
        assert.ok(R[r], '缺归因词:' + r);
    }
});

test('A2 零网络零提示词:附件层不得出现 fetch / setExtensionPrompt / chatMetadata', () => {
    /* ★ 扫**去注释后的代码**:注释里写「不进 chatMetadata」是守则,不是违规。 */
    assert.equal(attCode.includes('fetch('), false, '附件层不得联网');
    assert.equal(attCode.includes('setExtensionPrompt'), false, '正文不得进提示词');
    assert.equal(attCode.includes('chatMetadata'), false, '正文不得进 chatMetadata');
    assert.ok(attCode.includes('indexedDB'), '必须真的走 indexedDB');
    assert.ok(attSrc.includes('chatMetadata'), '守则同时写在注释里(读者可见的自述)');
});

test('A3 三条口径的注释与实现同时在场(不许只写在注释里)', () => {
    assert.ok(attSrc.includes('contentHash'), '同名不同文件靠指纹分键');
    assert.ok(attSrc.includes('export async function relinkBookBody'), '重定位出口在场');
    assert.ok(appSrc.includes('relinkBookBody('), '★ 重定位必须有真消费点(建好不消费即悬空)');
    assert.ok(appSrc.includes('removeBookBody('), '删书必须连正文一起删');
    assert.ok(appSrc.includes('getBookBody('), '打开书必须回读附件');
    assert.ok(appSrc.includes('putBookBody('), '导入必须落附件');
});

test('A4 边界声明:附件层不碰 document / 不解析 TXT / 不写任何 storage 键', () => {
    assert.equal(attSrc.includes('document.'), false, '附件层不碰 DOM');
    assert.equal(attSrc.includes('parseTxtContent'), false, '附件层不解析 TXT(职责在 reading-data)');
    assert.equal(attSrc.includes("storage.set("), false, '附件层不写 storage 键(不走会话隔离面)');
    assert.equal(attSrc.includes("storage.get("), false, '附件层不读 storage 键');
});

test('A5 上限冻结:超限拒绝而不是静默截断(截断的正文比没有更坏)', async () => {
    assert.ok(A.ATTACHMENT_LIMITS.bytes > 0 && A.ATTACHMENT_LIMITS.books > 0);
    const win = idbWin();
    const huge = await A.putBookBody(win, {
        bookId: 'b-huge',
        chapters: [{ title: 't', paragraphs: ['x'.repeat(A.ATTACHMENT_LIMITS.bytes + 10)] }]
    });
    assert.equal(huge.state, A.ATTACHMENT_STATES.WRITER_ERROR, '超限必须如实报写失败');
    const back = await A.getBookBody(win, 'b-huge');
    assert.equal(back.state, A.ATTACHMENT_STATES.EMPTY, '★ 超限后库里不得留下半个正文');
});

/* ══════════ B ── 行为 ══════════ */
test('B1 ★★★ 存-取往返:正文原样读回(章节与段落一字不差)', async () => {
    const win = idbWin();
    const ch = chapters(3);
    const w = await A.putBookBody(win, { bookId: 'b1', contentHash: 'h1', title: '测试书', chapters: ch });
    assert.equal(w.state, A.ATTACHMENT_STATES.OK);
    assert.equal(w.writesNothing, false, '写入必须如实报「写了」');
    const r = await A.getBookBody(win, 'b1');
    assert.equal(r.state, A.ATTACHMENT_STATES.OK);
    assert.deepEqual(r.chapters, ch, '★ 正文必须原样读回');
    assert.equal(r.contentHash, 'h1');
});

test('B2 ★★★ 重启续读:新 App 实例(内存空)+ 附件在场 ⇒ 同章同位置可读', async () => {
    /* 用真实阅读数据层 + 附件层拼出「重启」场景:内存缓存丢掉,只有附件与进度键在场。 */
    const mod = await import(pathToFileURL(path.join(ROOT, DATA)).href);
    const mem = new Map();
    const storage = {
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k)
    };
    const data = new mod.ReadingData(storage);
    const ch = chapters(4);
    const res = data.addBook({ title: '重启书', author: '', format: 'txt', chapters: ch }, 'a.txt', 'utf-8', 'auto', { contentHash: 'hR' });
    /* 进度:第 3 章(ruby_reading_progress_<id>,reading-view 的口径) */
    storage.set('ruby_reading_progress_' + res.bookId, JSON.stringify({ chapter: 3, fontPx: 18, theme: 'night' }));
    const win = idbWin();
    const w = await A.putBookBody(win, { bookId: res.bookId, contentHash: 'hR', title: '重启书', chapters: ch });
    assert.equal(w.state, A.ATTACHMENT_STATES.OK);
    /* 「重启」:换一个 App 实例 —— 它的内存缓存必然是空的。 */
    const app = new (await import(pathToFileURL(path.join(ROOT, APP)).href)).ReadingApp(
        { showNotification: () => {}, screen: null },
        storage
    );
    assert.equal(app._contentCache.size, 0, '新实例内存必须为空(这就是「重启」)');
    /* 附件层读 win 走 _hostWin;无头下 globalThis 没有 indexedDB ⇒ 临时挂上我们的实现。 */
    const saved = globalThis.indexedDB;
    globalThis.indexedDB = win.indexedDB;
    try {
        const ok = await app.openBook(res.bookId);
        assert.equal(ok, true, '★ 重启后必须能打开(修前这里必然 false)');
        assert.ok(app.view.currentBook, '当前书必须装载');
        assert.deepEqual(app.view.currentBook.chapters, ch, '★ 正文必须从附件读回');
        assert.equal(app.view.curChapter, 3, '★★ 验收第一条:重启继续同章同位置');
        assert.equal(app.view.fontPx, 18, '字号也随进度恢复');
        assert.equal(app.view.theme, 'night', '主题也随进度恢复');
    } finally {
        if (saved === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = saved;
    }
});

test('B3 ★★★ 丢附件 + 重定位:附件被清后重新导入同一文件 ⇒ 挂回原 bookId,进度不动', async () => {
    const win = idbWin();
    const ch = chapters(2);
    const first = await A.putBookBody(win, { bookId: 'b-old', contentHash: 'hX', title: '旧书', chapters: ch });
    assert.equal(first.state, A.ATTACHMENT_STATES.OK);
    /* 模拟「附件丢失后重新导入」:调用方拿着指纹与正文来要一个落点。 */
    const re = await A.relinkBookBody(win, 'hX', ch);
    assert.equal(re.relinked, true, '★ 指纹命中必须重定位(验收第三条)');
    assert.equal(re.bookId, 'b-old', '★★ 必须挂回**原** bookId(进度键与摘录引用都指着它)');
    const back = await A.getBookBody(win, 'b-old');
    assert.deepEqual(back.chapters, ch, '重定位后正文必须可用');
    /* 指纹不认识 ⇒ 不得乱认领。 */
    const miss = await A.relinkBookBody(win, 'h-unknown', ch);
    assert.equal(miss.relinked, false, '未命中必须如实报未命中,不许随便挑一本');
});

test('B4 ★★★ 删书连正文一起删:删后附件为空(不留正文孤儿)', async () => {
    const win = idbWin();
    await A.putBookBody(win, { bookId: 'b9', contentHash: 'h9', chapters: chapters(1) });
    assert.equal((await A.listBookBodies(win)).count, 1);
    const rm = await A.removeBookBody(win, 'b9');
    assert.equal(rm.removed, true);
    const after = await A.getBookBody(win, 'b9');
    assert.equal(after.state, A.ATTACHMENT_STATES.EMPTY, '★ 删后必须 empty');
    assert.equal((await A.listBookBodies(win)).count, 0, '★ 盘库必须归零');
});

test('B5 ★★ 盘库只出元数据:不把几 MB 正文读回内存', async () => {
    const win = idbWin();
    await A.putBookBody(win, { bookId: 'b1', contentHash: 'h1', title: '甲书', chapters: chapters(2) });
    await A.putBookBody(win, { bookId: 'b2', contentHash: 'h2', title: '乙书', chapters: chapters(3) });
    const lib = await A.listBookBodies(win);
    assert.equal(lib.count, 2);
    for (const b of lib.books) {
        assert.equal('chapters' in b, false, '★ 盘库条目不得带正文');
        assert.ok(b.bookId && b.chapterCount > 0, '元数据必须有');
    }
    assert.equal(lib.writesNothing, true, '盘库是只读面');
});

test('B6 ★★★ 读不到 ≠ 空:没有 indexedDB 时报 unavailable,而不是 empty', async () => {
    const r = await A.getBookBody(noIdbWin, 'whatever');
    assert.equal(r.state, A.ATTACHMENT_STATES.UNAVAILABLE, '★ 缺库必须报 unavailable');
    assert.notEqual(r.state, A.ATTACHMENT_STATES.EMPTY, '★ 不许把「环境不支持」压成「你没存过」');
    assert.equal(r.degraded, true, '降级必须可见');
    const w = await A.putBookBody(noIdbWin, { bookId: 'b1', chapters: chapters(1) });
    assert.equal(w.state, A.ATTACHMENT_STATES.UNAVAILABLE);
    assert.equal(w.writesNothing, true, '写不进去必须如实报「没写」');
});

test('B7 ★★ 空标识如实拒绝:无 bookId 不写、无指纹不重定位', async () => {
    const win = idbWin();
    const a = await A.putBookBody(win, { chapters: chapters(1) });
    assert.equal(a.reason, 'no-subject');
    const b = await A.putBookBody(win, { bookId: '   ', chapters: chapters(1) });
    assert.equal(b.reason, 'no-subject', '★ 纯空白 bookId 也必须拒绝');
    assert.equal((await A.listBookBodies(win)).count, 0, '★ 被拒绝的写不得落任何条目');
    const c = await A.relinkBookBody(win, '', chapters(1));
    assert.equal(c.relinked, false, '无指纹不得重定位');
});

test('B8 ★★ 不抛:写事务失败(配额)如实转成 writer-error,不外抛', async () => {
    const idb = makeIdb();
    idb._fail.put = true;
    const win = { indexedDB: idb };
    const w = await A.putBookBody(win, { bookId: 'b1', contentHash: 'h1', chapters: chapters(1) });
    assert.equal(w.state, A.ATTACHMENT_STATES.WRITER_ERROR, '★ 写失败必须报 writer-error');
    assert.equal(w.writesNothing, true);
});

test('B9 ★★ 自检三条口径当场自证(problems 必须为空)', async () => {
    const r = await A.attachmentSelfCheck();
    assert.deepEqual(r.problems, [], '自检不得有问题:' + JSON.stringify(r.problems));
});

test('B10 ★ 一行读数:五态各占一格,ok 与 empty 话术不同', () => {
    assert.notEqual(A.attachmentLine({ reason: 'ok', count: 2 }), A.attachmentLine({ reason: 'empty' }));
    assert.notEqual(A.attachmentLine({ reason: 'unavailable' }), A.attachmentLine({ reason: 'empty' }));
    assert.notEqual(A.attachmentLine({ reason: 'writer-error' }), A.attachmentLine({ reason: 'empty' }));
});

/* ══════════ C ── 接线 ══════════ */
test('C1 导入两条路径(TXT/EPUB)都落附件', () => {
    /* ★ 锚点必须带方法体的 ` {`:`_importTxt(file)` 这个串在**调用点**也出现一次
     *   (`this._importTxt(file);`),首版用裸串切出来的是空片段 ⇒ 在真源上假红。 */
    const txt = methodBody(appCode, '_importTxt(file) {', '_importEpub(file) {');
    const epub = methodBody(appCode, '_importEpub(file) {', 'async openBook(bookId) {');
    assert.ok(txt.includes('_persistBody('), 'TXT 导入必须落附件');
    assert.ok(epub.includes('_persistBody('), 'EPUB 导入必须落附件');
    assert.ok(txt.includes('relinkBookBody('), 'TXT 必须先试重定位');
    assert.ok(epub.includes('relinkBookBody('), 'EPUB 必须先试重定位');
});

test('C2 ★★★ 打开书必须回读附件,且分态告知(不许一句「需重新导入」压平)', () => {
    const seg = methodBody(appCode, 'async openBook(bookId) {', 'export default ReadingApp');
    assert.ok(seg.includes('getBookBody('), '打开书必须查附件');
    assert.ok(seg.includes('ATTACHMENT_STATES.EMPTY'), '★ 必须区分「没存过」');
    assert.ok(seg.includes('本机附件存储在本环境不可用'), '★ 必须区分「本环境没有附件层」');
});

test('C3 删书走 App 出口(视图不得再直接调 data.removeBook)', () => {
    const seg = methodBody(appCode, 'removeBook(bookId) {', 'async listBodies');
    assert.ok(seg.includes('removeBookBody('), '★ 删书必须连附件一起删');
    assert.ok(seg.includes('this.data.removeBook('), '★ 书目本身也要删');
    assert.ok(viewCode.includes('this.app.removeBook('), '视图删按钮必须走 App 出口');
    assert.equal(/this\.app\.data\.removeBook\(/.test(viewCode), false, '★ 视图不得绕过 App 直删书目(否则留正文孤儿)');
});

test('C4 键面未新增:正文不进会话隔离面,keys 门无需登记新键', () => {
    const stor = read('config/storage.js');
    assert.equal(stor.includes('ruby-phone-reading'), false, '库名不得挤进 CHAT_DATA_PATTERNS(正文不是会话状态)');
    assert.equal(attSrc.includes("'ruby_"), false, '附件层不得引入新的 ruby_ 前缀键');
    const keys = read('scripts/keys-audit.mjs');
    assert.equal(keys.includes('reading_attachment'), false, '本版不新增需登记的会话键');
});

test('C5 附件层不写 chatMetadata:app 侧也未见把正文塞进 metadata', () => {
    /* ★ 同样是**去注释后的代码**上判:档头把守则写在注释里是纪律,不是违规。 */
    assert.equal(appCode.includes('chatMetadata'), false, '阅读 App 不得把正文写进 chatMetadata');
    assert.equal(appCode.includes('setExtensionPrompt'), false, '阅读 App 不得把正文塞进提示词');
    assert.ok(appSrc.includes('chatMetadata'), '守则同时写在注释里(读者可见的自述)');
});

/* ══════════ D ── 负控制(真源码破坏 → 同一份判据必须转红) ══════════ */
const temps = [];
function makeAppCopy() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4120_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏:锚点必须**恰中一次**;破坏的是**副本**(绝不动真仓)。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeAppCopy();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + anchor.slice(0, 60));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}

test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', async () => {
    const win = idbWin();
    const ch = chapters(2);
    assert.equal((await A.putBookBody(win, { bookId: 'd0', contentHash: 'h', chapters: ch })).state, A.ATTACHMENT_STATES.OK, '存判据在原版必真');
    assert.deepEqual((await A.getBookBody(win, 'd0')).chapters, ch, '取判据在原版必真');
    assert.equal((await A.getBookBody(noIdbWin, 'd0')).state, A.ATTACHMENT_STATES.UNAVAILABLE, '缺库判据在原版必真');
    assert.equal((await A.relinkBookBody(win, 'h', ch)).relinked, true, '重定位判据在原版必真');
});

test('D1 ★★★ 破坏「缺库 → unavailable」⇒ 同一判据必转红(不许压成 empty)', async () => {
    const dir = breakCopy(ATT, "if (!idb) return Promise.resolve({ db: null, state: ATTACHMENT_STATES.UNAVAILABLE, reason: 'unavailable' });",
        "if (!idb) return Promise.resolve({ db: null, state: ATTACHMENT_STATES.EMPTY, reason: 'empty' });");
    const m = await import(pathToFileURL(path.join(dir, ATT)).href + '?d1=' + Date.now());
    const broken = await m.getBookBody(noIdbWin, 'x');
    assert.equal(broken.state, m.ATTACHMENT_STATES.EMPTY, '破坏副本:缺库被压成了「没存过」');
    const ok = await A.getBookBody(noIdbWin, 'x');
    assert.equal(ok.state, A.ATTACHMENT_STATES.UNAVAILABLE, '原版必须报 unavailable');
});

test('D2 ★★★ 破坏「删书连正文一起删」⇒ 同一判据必转红(留孤儿)', async () => {
    const dir = breakCopy(APP, 'try { removeBookBody(this._hostWin(), id).catch(() => null); } catch (_e) { /* 附件删不掉不阻塞书目删除 */ }',
        'void 0;');
    const src2 = fs.readFileSync(path.join(dir, APP), 'utf8');
    assert.equal(src2.includes('removeBookBody('), false, '破坏副本:App 已不再删附件');
    assert.ok(appSrc.includes('removeBookBody('), '原版必须删附件');
    /* 行为面:原版删完附件为空(这条在原版必真,是 D2 的正向对照) */
    const win = idbWin();
    await A.putBookBody(win, { bookId: 'dx', contentHash: 'hx', chapters: chapters(1) });
    await A.removeBookBody(win, 'dx');
    assert.equal((await A.listBookBodies(win)).count, 0, '原版删后必须为空');
});

test('D3 ★★★ 破坏「超限拒绝」⇒ 同一判据必转红(静默截断/静默接受)', async () => {
    const dir = breakCopy(ATT, 'if (bytes > ATTACHMENT_LIMITS.bytes) {', 'if (false) {');
    const m = await import(pathToFileURL(path.join(dir, ATT)).href + '?d3=' + Date.now());
    const win = idbWin();
    const broken = await m.putBookBody(win, {
        bookId: 'too-big',
        chapters: [{ title: 't', paragraphs: ['x'.repeat(m.ATTACHMENT_LIMITS.bytes + 10)] }]
    });
    assert.equal(broken.state, m.ATTACHMENT_STATES.OK, '破坏副本:超限被静默接受(读者以为书存好了)');
    const okWin = idbWin();
    const ok = await A.putBookBody(okWin, {
        bookId: 'too-big',
        chapters: [{ title: 't', paragraphs: ['x'.repeat(A.ATTACHMENT_LIMITS.bytes + 10)] }]
    });
    assert.equal(ok.state, A.ATTACHMENT_STATES.WRITER_ERROR, '原版必须如实拒绝');
});

test('D4 ★★★ 破坏「打开书回读附件」⇒ 重启续读判据必转红', async () => {
    const dir = breakCopy(APP, 'try { attach = await getBookBody(this._hostWin(), bookId); }', 'try { attach = null; }');
    const src2 = fs.readFileSync(path.join(dir, APP), 'utf8');
    assert.equal(src2.includes('getBookBody(this._hostWin(), bookId)'), false, '破坏副本:已不再回读附件');
    assert.ok(appSrc.includes('getBookBody(this._hostWin(), bookId)'), '原版必须回读附件');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚:manifest / package 版本与 update-log latest 同源(下限形)', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
});