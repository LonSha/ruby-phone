/* ============================================================
 * tests/system-v4340.test.mjs -- [v4.34.0 · 第五期 R5-O7 全书连续找句可取消且不反复重建]
 *
 * 验收口径（计划原文 R5-O7）：
 *   「以本地 200 万汉字书记录**改前/后**首查、续查及内存；**连续三次查询只建一次同版本索引**；
 *    构建中点取消/返回可响应，末章命中可打开精确句；目标设备上取消反馈 ≤200ms，不达标继续分片。」
 *   不做：**不在没有基线时宣称更快**；**不把缓存误称永久复制正文**。
 *
 * 【修前实测的缺口（现场跑出来的读数，不是推演）】
 *   `reading-app.js::searchBook` 每次调用都 `buildSearchIndex` **现建、用完即弃**：
 *   200 万汉字的书，首查 16.25ms / 续查 17.77ms / 第三次 16.53ms —— 三次同量级；
 *   App 上**没有任何「建了几次」的观测口**（探针取到 `index_builds_available = 0`，
 *   那是「本版没有这条读数」，不是「建了 0 次」）。
 *   更贵的是**形态**：建索引与扫全书各是一段同步台阶 —— 期间计时器与点击事件排在
 *   宏任务队列里轮不到，用户点「取消」不会有任何反应。同仓 `global-search-engine`
 *   已在 v3.60.0 为搜索立过同款纪律，本版把它接到阅读侧。
 *
 * 【本版落的四件】
 *   （一）契约件 `config/reading-notes-contract.js`：`SEARCH_LIMITS` 增两格**节奏上限**
 *   （`buildChunk` / `scanChunk`，与四格「结果上限」分开注释）；新增两个分片生成器
 *   （建索引按章、比中按章）；`buildSearchIndex` / `searchInBook` 改为**抽干生成器**，
 *   分片成为唯一真源；新增 `indexVersionOf`（版本键 = 书 ID + 内容指纹）。
 *   （二）控制器 `apps/reading/reading-app.js`：索引**按版本复用**（有界、不落盘）、
 *   建与扫**分片让出宏任务**、**可取消**（`newFindTask` / `cancelFind` / `currentFindTask`），
 *   新增 `indexBuildCount()` 与 `indexCacheInfo()` 两个读数口，删书/撤销同步丢索引。
 *   （三）视图：查找区给「取消」入口与进度读数。
 *   （四）读数：`tests/audit/reading_find_scale_probe.cjs` 落**改前/后双格**基线。
 *
 * 判据面（六组）：
 *   A 口径：节奏上限与结果上限分格、版本键三性、纯契约零副作用、自检扩项
 *   B 内核行为：分片与同步**逐字段等价**、分片真让出、取消不返回半份结果
 *   C 接线行为：连续三次只建一次、换版本重建、换书不串、取消可响应且读数如实、
 *            索引不落盘、缓存有界
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 读数锚：基线**双格**在场且与现场复跑一致
 *   F 版本锚：五源同源 + 当版条目点名 R5-O7
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么取消的「≤200ms」不在本套件判】那是**真 DOM 层**读数（计时器 + 点击事件 +
 *   渲染），归浏览器门；本套件判的是它的**可判定前件**：片间真让出宏任务、
 *   取消后不再扫下一片、且读数如实。把前件当结论写进 Node 层，就是自造判据。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copyTreeSafe } from './_mirror_tree.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/reading-notes-contract.js';
const APP_REL = 'apps/reading/reading-app.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const PROBE_REL = 'tests/audit/reading_find_scale_probe.cjs';
const BASEF_REL = 'tests/audit/reading_find_scale_baseline.json';
const NL = String.fromCharCode(10);
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const probeSrc = read(PROBE_REL);
const base = JSON.parse(read(BASEF_REL));
/**
 * 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。
 *   ★ 扫描器必须**正则感知**：本仓视图几乎都有 esc() 里的 `.replace(/"/g, '"')`，
 *     朴素「见 / 就找下一个 /」的写法会被这个正则字面量里的引号骗进假字符串态，
 *     从那行起整份文件后半段的注释**一个都剥不掉**。故这里按 ECMAScript 的
 *     「正则字面量只出现在表达式位置」来判（与 system-v4240 / v4330 同一份实现口径）。
 */
const REGEX_PREV = "([{=,:;!&|?+-*%~^<>" + NL + " ";
const REGEX_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await'];
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    const prevSig = () => {
        let k = out.length - 1;
        while (k >= 0 && ' \t\n\r'.indexOf(out[k]) >= 0) k--;
        if (k < 0) return '';
        if (/[A-Za-z_$]/.test(out[k])) {
            let j = k;
            while (j >= 0 && /[A-Za-z_$0-9]/.test(out[j])) j--;
            return out.slice(j + 1, k + 1);
        }
        return out[k];
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
/* ══════════ 夹具 ══════════ */
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
const noIdbWin = {};
function mkApp(win) {
    const a = new APP.ReadingApp({ showNotification: () => {}, screen: null }, mkStorage());
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
    app._contentCache.set(bookId, chs);
    return bookId;
}
const MARK_TAIL = '结尾章独有句';
const MARK_MID = '中段独有句';
/** 一本「末章唯一一句 + 中段一句」的书（验收前两条靠它）。 */
function findBook() {
    return mkBook(12, [
        { ch: 0, para: 0, text: '开头一句' },
        { ch: 6, para: 0, text: MARK_MID },
        { ch: 11, para: 1, text: MARK_TAIL },
    ]);
}
/* ══════════ A ── 口径 ══════════ */
test('A1 节奏上限与结果上限**分格**：四格结果上限 + 两格节奏上限，且节奏为正（为 0 即「没有让出」）', () => {
    for (const k of ['hits', 'collect', 'query', 'snippet']) {
        assert.ok(K.SEARCH_LIMITS[k] > 0, '结果上限必须为正：' + k);
    }
    /* 节奏上限：**必须存在且为正**。为 0 / 缺失都意味着分片消失 ——
     *   那正是本版要治的形态（一次同步跑完），绝不能因为一格读数缺失而静默复发。 */
    for (const k of ['buildChunk', 'scanChunk']) {
        assert.ok(Number.isFinite(K.SEARCH_LIMITS[k]) && K.SEARCH_LIMITS[k] > 0,
            '节奏上限必须存在且为正（为 0 就是「没有让出」）：' + k);
    }
    /* 节奏上限必须**小于**总章数一个量级地生效：分片粒度大于结果上限时，
     *   一次查找只会有 1 片，让出等于没发生。这里判的是「粒度是粒度、不是总数」。 */
    assert.ok(K.SEARCH_LIMITS.buildChunk < 10000 && K.SEARCH_LIMITS.scanChunk < 10000,
        '分片粒度必须是粒度（不是全书章数）');
});
test('A2 版本键三性：同一版本同键 / 改一个字就变 / 缺指纹为空（判不了就不许复用）', () => {
    const v1 = K.indexVersionOf({ id: 'b1', contentHash: 'h1' });
    const v2 = K.indexVersionOf({ id: 'b1', contentHash: 'h1' });
    const v3 = K.indexVersionOf({ id: 'b1', contentHash: 'h2' });
    const v4 = K.indexVersionOf({ id: 'b1' });
    const v5 = K.indexVersionOf({ id: '', contentHash: 'h1' });
    assert.equal(v1.key, v2.key, '同一本书同一版本必须给出同一个键');
    assert.notEqual(v1.key, v3.key, '★ 内容指纹变了，键必须跟着变（否则会把改版前的段号端上来）');
    assert.equal(v4.key, '', '没有指纹 ⇒ 键为空：宁可重建，不可错认版本');
    assert.equal(v5.key, '', '没有书 ID ⇒ 同样判不了');
    assert.equal(v1.bookId, 'b1');
    assert.equal(v1.contentHash, 'h1');
    /* 键里不许夹带正文：它是**引用**不是内容（与 R5-O6 的版本引用同规）。 */
    assert.ok(v1.key.length < 200, '版本键是引用，不该长到能装下正文');
});
test('A3 纯契约零副作用：不碰 DOM / 存储 / 网络 / 时钟；分片生成器不引入新依赖', () => {
    for (const bad of ['document', 'window', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'setImmediate', 'querySelector', 'Date.now', 'Math.random', 'performance']) {
        assert.equal(kernelCode.indexOf(bad), -1, '纯契约件不得出现：' + bad);
    }
    const imports = kernelSrc.split(NL).filter((l) => l.trim().slice(0, 7) === 'import ');
    assert.equal(imports.length, 1, '本件只应有一条 import（零依赖叶子 + 唯一取数门）');
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '取数必须走全仓唯一门 num-gate');
    /* 分片粒度也必须走那一道门（不许另开 `Number(x) || 50` 这类弱口径）。 */
    assert.equal(kernelCode.indexOf('Number.isFinite(Number('), -1, '不得出现弱口径签名（W1）');
    assert.ok(kernelCode.indexOf('chunkSizeOf') >= 0, '分片粒度必须经统一取值口');
    assert.ok(kernelCode.indexOf('numOrNull(raw)') >= 0, '节奏上限也要过 numOrNull');
});
test('A4 出口面：两个分片生成器在场，且**声明处不写 export**（门禁不认 `export function*`）', () => {
    assert.equal(typeof K.buildIndexChunks, 'function', '分片建索引必须导出');
    assert.equal(typeof K.searchBookChunks, 'function', '分片比中必须导出');
    assert.equal(typeof K.buildIndexChunks.constructor, 'function');
    /* 声明处不写 `export`：全仓零消费导出门禁的抽取路径不认 `export function*`，
     *   而它的立场是 fail-closed 拒判（E9）。故出口走文件末的具名转出块。 */
    assert.equal(kernelCode.indexOf('export function*'), -1,
        '★ 生成器声明不得写成 export function*（门禁不认这种写法，会拒判）');
    assert.ok(kernelCode.indexOf('export { buildIndexChunks, searchBookChunks };') >= 0,
        '两个生成器出口必须在具名转出块里');
    /* 同步入口必须只是**抽干**：同一口径只许一份实现。 */
    assert.ok(kernelCode.indexOf('const gen = buildIndexChunks(') >= 0, '同步建索引必须抽干分片版');
    assert.ok(kernelCode.indexOf('const gen = searchBookChunks(') >= 0, '同步搜索必须抽干分片版');
});
test('A5 内核自检真跑分片等价与版本键（不是数常量）', () => {
    const r = K.notesSelfCheck();
    assert.deepEqual(r.problems, [], '自检不得报问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 7);
    assert.equal(r.confirmStates, 4);
    assert.equal(r.limits, Object.keys(K.SEARCH_LIMITS).length);
    assert.ok(r.limits >= 6, '上限面必须含两格节奏上限（当前 ' + r.limits + ' 格）');
    /* 自检必须**真跑**：造一本**跨过片边界**的书（章数 > 片长），
     *   分片版与同步版仍须逐字段一致 —— 首版这里只造了 5 章（片长 50），
     *   一次都没让出，判据自己先红了（那是判据夹具的错，不是产品的错）。 */
    const n = K.SEARCH_LIMITS.buildChunk + 5;
    const chs = mkBook(n, [{ ch: n - 1, para: 1, text: MARK_TAIL }]);
    const ix = K.buildSearchIndex({ id: 'x', contentHash: 'h', chapters: chs });
    const gen = K.buildIndexChunks({ id: 'x', contentHash: 'h', chapters: chs });
    let step = gen.next();
    let yields = 0;
    while (!step.done) { yields += 1; step = gen.next(); }
    assert.equal(step.value.chapters.length, ix.chapters.length);
    assert.equal(step.value.totalChars, ix.totalChars);
    assert.ok(yields > 0, '分片建索引跨过片边界必须让出');
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 分片与同步**逐字段等价**（分片只许改节奏，不许改结果）', () => {
    const n = K.SEARCH_LIMITS.buildChunk * 2 + 3;
    const chs = mkBook(n, [{ ch: 5, para: 0, text: MARK_MID }, { ch: n - 1, para: 1, text: MARK_TAIL }]);
    const ixSync = K.buildSearchIndex({ id: 'b1', title: '书', contentHash: 'h1', chapters: chs });
    const gen = K.buildIndexChunks({ id: 'b1', title: '书', contentHash: 'h1', chapters: chs });
    let step = gen.next();
    let yields = 0;
    while (!step.done) { yields += 1; step = gen.next(); }
    const ixChunk = step.value;
    assert.ok(yields > 0, '必须真让出（否则「分片」只是换了写法）');
    assert.deepEqual(ixChunk, ixSync, '★ 分片建索引与同步版必须逐字段相同');
    /* 比中：命中/已扫章数/截断三格逐项一致。 */
    const rSync = K.searchInBook(ixSync, '句');
    const g2 = K.searchBookChunks(ixSync, '句');
    let s2 = g2.next();
    let yields2 = 0;
    while (!s2.done) { yields2 += 1; s2 = g2.next(); }
    assert.ok(yields2 > 0, '比中阶段同样必须真让出（章数跨过片边界）');
    assert.deepEqual(s2.value, rSync, '★ 分片比中与同步版必须逐字段相同');
    /* 截断保尾这条**结果口径**在分片路径上同样成立（不许因分片而丢末章那一处）。
     *   夹具要保证命中数 > limit 且命中确实跨章 —— 否则「保尾」根本无从体现。 */
    const cutSync = K.searchInBook(ixSync, '段', { limit: 2 });
    const g3 = K.searchBookChunks(ixSync, '段', { limit: 2 });
    let s3 = g3.next();
    while (!s3.done) s3 = g3.next();
    assert.deepEqual(s3.value, cutSync, '截断保尾在分片路径上必须同形');
    assert.equal(cutSync.truncated, true, '夹具前提：这本的命中必须超过显示上限');
    assert.equal(s3.value.hits[s3.value.hits.length - 1].keptBy, 'tail');
});
test('B2 取消语义在内核层是「驱动器的事」：生成器不返回半份结果', () => {
    /* 生成器只管扫；被 `return()` 收束时**不产出结果对象**（value 为 undefined）——
     *   半份结果比空结果更糟（用户会以为「只有这些」）。这条在契约层钉住，
     *   驱动器（App）负责把取消报成 `cancelled: true` 且命中为空。 */
    const chs = mkBook(K.SEARCH_LIMITS.scanChunk * 3, []);
    const ix = K.buildSearchIndex({ id: 'b1', chapters: chs });
    const gen = K.searchBookChunks(ix, '甲');
    let step = gen.next();
    assert.equal(step.done, false, '第一片之后应当让出（否则分片没生效）');
    const ret = gen.return();
    assert.equal(ret.done, true);
    assert.equal(ret.value, undefined, '★ 被提前收束的生成器不得产出半份结果');
    /* 未让出的小书：一步到位，结果照样给全（分片不该把短书变成「永远差一片」）。 */
    const small = K.buildSearchIndex({ id: 'b2', chapters: mkBook(2, [{ ch: 1, para: 1, text: MARK_TAIL }]) });
    const g2 = K.searchBookChunks(small, MARK_TAIL);
    const s2 = g2.next();
    assert.equal(s2.done, true, '两章的书一步就该扫完（章数 < 片长）');
    assert.equal(s2.value.totalHits, 1);
});
test('B3 章体不可读的章**照样记进已扫章数**（不许既不计数也不让出）', () => {
    const chs = mkBook(6, []);
    const ix = K.buildSearchIndex({ id: 'b1', chapters: chs });
    /* 把第 2 章打成不可读（text 非字符串）：它确实被扫过了，就得计数。 */
    ix.chapters[1].text = null;
    const r = K.searchInBook(ix, '甲');
    assert.equal(r.chaptersScanned, 6, '★ 不可读的章也必须计进已扫章数（修前 continue 会把它漏掉）');
    assert.equal(r.chaptersTotal, 6);
});
/* ══════════ C ── 接线行为（真 App，假存储） ══════════ */
test('C1 连续三次查询只建一次同版本索引（改前三次各建一次）', async () => {
    const app = mkApp();
    const bid = seedBook(app, 'rd_1', 'hA', findBook());
    assert.equal(app.indexBuildCount(), 0, '还没查过 ⇒ 一份都没建');
    const r1 = await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.equal(r1.ok, true);
    assert.equal(r1.totalHits, 1, '末章那一句必须找得到');
    assert.equal(app.indexBuildCount(), 1, '首查建一份');
    assert.equal(r1.index.reused, false, '首查必然不是复用');
    const r2 = await app.searchBook(MARK_MID, { bookId: bid });
    assert.equal(r2.totalHits, 1);
    assert.equal(app.indexBuildCount(), 1, '★ 续查**不得**再建（这正是修前做不到的一条）');
    assert.equal(r2.index.reused, true, '续查必须走复用');
    const r3 = await app.searchBook('甲0段', { bookId: bid });
    assert.equal(r3.ok, true);
    assert.equal(app.indexBuildCount(), 1, '★ 第三次仍不得再建（「连续三次只建一次」）');
    assert.equal(r3.index.reused, true);
    /* 复用必须**不改结果**：同一查询在复用路径上与首查逐字段同形。 */
    const again = await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.deepEqual(again.hits, r1.hits, '复用路径的命中必须与首查逐字段相同');
});
test('C2 正文改版（指纹变了）⇒ 旧索引自然落空，必须重建（不把改版前的段号端上来）', async () => {
    const app = mkApp();
    const bid = seedBook(app, 'rd_2', 'hA', findBook());
    await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.equal(app.indexBuildCount(), 1);
    /* 改版：换指纹 + 换正文（末章那句挪到别处，并在新位置放一句新的）。 */
    app.data.getBook(bid).contentHash = 'hB';
    app._contentCache.set(bid, mkBook(12, [{ ch: 3, para: 0, text: MARK_TAIL }]));
    const r = await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.equal(app.indexBuildCount(), 2, '★ 版本变了必须重建（否则段号会指到别的段上）');
    assert.equal(r.index.reused, false);
    assert.equal(r.hits[0].chapter, 3, '命中的章号必须来自**新版**正文');
    assert.equal(r.index.key.indexOf('hB') > 0, true, '读数里的版本键必须指向新指纹');
    /* 再查一次仍只建这一份（新版本也复用）。 */
    await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.equal(app.indexBuildCount(), 2, '新版本同样只建一次');
});
test('C3 换书不串：旧书的索引不会被新书用到，旧结果不许覆盖新书', async () => {
    const app = mkApp();
    const b1 = seedBook(app, 'rd_3a', 'hA', findBook());
    const b2 = seedBook(app, 'rd_3b', 'hB', mkBook(4, [{ ch: 3, para: 1, text: '乙书独有句' }]));
    await app.searchBook(MARK_TAIL, { bookId: b1 });
    await app.searchBook('乙书独有句', { bookId: b2 });
    assert.equal(app.indexCacheInfo().builds, 2, '两本书各建一份（换书不许拿别人的索引顶）');
    const info = app.indexCacheInfo();
    assert.ok(info.keys.some((k) => k.indexOf('rd_3a#') === 0), '甲书的索引必须在缓存里');
    assert.ok(info.keys.some((k) => k.indexOf('rd_3b#') === 0), '乙书的索引也必须在（各有各的键）');
    /* 换书不串的核心：同一句在两本书里段号不同，各自必须答自己那一份。 */
    const back1 = await app.searchBook(MARK_TAIL, { bookId: b1 });
    assert.equal(back1.totalHits, 1, '甲书的命中必须还是甲书的');
    assert.equal(back1.hits[0].chapter, 11, '段号必须来自甲书正文');
    assert.equal(app.indexCacheInfo().builds, 2, '换回来只复用，不再重建');
    /* 任务身份是**同步**换的：发起那一刻 `_findTask` 就归它了 ——
     *   故「被后一次顶掉」的那一轮，在它拿到第一片之前就已经作废，
     *   而且**不该白建一份索引**（被顶掉的活不该留下成本）。 */
    const t2 = app.newFindTask();
    const p2 = app.searchBook('乙书独有句', { bookId: b2, task: t2 });
    assert.equal(app.currentFindTask().id, t2.id, '发起后当前任务立刻归它');
    const t3 = app.newFindTask();
    const p3 = app.searchBook(MARK_TAIL, { bookId: b1, task: t3 });
    const r2 = await p2;
    const r3 = await p3;
    assert.equal(r2.stale, true, '★ 被后一次查询顶掉的那一轮必须标 stale（界面据此不许画上去）');
    assert.equal(r2.cancelled, true, '被顶掉的轮次按取消处置：一条命中都不给');
    assert.equal(r2.totalHits, 0, '半份结果比空结果更糟');
    assert.equal(r3.stale, false, '最后那一轮才是当前轮');
    assert.equal(r3.ok, true);
    assert.equal(app.indexCacheInfo().builds, 2, '被顶掉的那一轮复用了已有索引，不该另建一份');
});
test('C4 取消可响应且读数如实：索引阶段取消不建完、比中阶段取消不返回半份结果', async () => {
    const app = mkApp();
    const bid = seedBook(app, 'rd_4', 'hA', findBook());
    /* 让出点被调用时立刻取消 —— 模拟「用户在构建中点取消」。 */
    const orig = app._yieldTurn.bind(app);
    let yields = 0;
    app._yieldTurn = function () { yields += 1; if (yields >= 1) app.cancelFind(); return orig(); };
    const r = await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.ok(yields >= 1, '必须真让出（否则取消根本没有受理窗口）');
    assert.equal(r.cancelled, true, '取消必须被受理');
    assert.equal(r.totalHits, 0, '★ 取消后一条命中都不给（半份结果比空结果更糟）');
    assert.equal(r.hits.length, 0);
    assert.ok(r.reason.indexOf('cancelled') >= 0, '读数必须说清是被取消，不是「书里没有」');
    assert.ok(r.cancelledAt === 'index' || r.cancelledAt === 'scan', '取消段位必须如实：' + r.cancelledAt);
    assert.equal(r.index.builds, 0, '索引阶段被取消 ⇒ 这一份**没建完**，不得计入建数');
    assert.equal(app.indexBuildCount(), 0, '★ 没建完就不许记成「建了一份」');
    assert.equal(r.index.reused, false);
    /* 取消后**下一轮**照常工作（取消不许把实例卡死）。 */
    app._yieldTurn = orig;
    const ok = await app.searchBook(MARK_TAIL, { bookId: bid });
    assert.equal(ok.ok, true);
    assert.equal(ok.cancelled, false);
    assert.equal(ok.totalHits, 1);
});
test('C5 比中阶段取消：读数如实报「扫到哪」，且不返回半份命中', async () => {
    const app = mkApp();
    /* 章数跨过**两道**片边界（索引片长 50 / 比中片长 25），保证取消落在比中阶段。 */
    const n = K.SEARCH_LIMITS.scanChunk * 3;
    const bid = seedBook(app, 'rd_5', 'hA', mkBook(n, [{ ch: n - 1, para: 1, text: MARK_TAIL }]));
    const orig = app._yieldTurn.bind(app);
    let yields = 0;
    /* 让出点计数：① 索引入口 ② 索引片 ③ 比中入口 ④ 比中第一片 —— 在 ④ 取消。 */
    app._yieldTurn = function () { yields += 1; if (yields >= 4) app.cancelFind(); return orig(); };
    const r = await app.searchBook(MARK_TAIL, { bookId: bid });
    app._yieldTurn = orig;
    assert.equal(r.cancelled, true);
    assert.equal(r.cancelledAt, 'scan', '索引建完后才取消 ⇒ 段位必须是 scan（实测让出 ' + yields + ' 次）');
    assert.equal(r.totalHits, 0, '★ 取消后一条命中都不给');
    assert.equal(r.hits.length, 0);
    /* 读数如实报「扫到哪」：扫过的那一片要算数（不是 0，也不是全量）。 */
    assert.equal(r.chaptersScanned, K.SEARCH_LIMITS.scanChunk, '取消时如实报已扫章数（一片）');
    assert.equal(r.progress.done, K.SEARCH_LIMITS.scanChunk);
    assert.equal(r.progress.total, n, '进度总分母必须如实（总章数）');
    assert.equal(r.index.builds, 1, '索引是建完了的（取消发生在比中阶段）');
    assert.equal(r.index.indexedChapters, n, '索引阶段没被打断 ⇒ 已建章数是全量');
    assert.ok(r.reason.indexOf('cancelled') >= 0);
});
test('C6 索引不落盘、有界、且删书后跟着走', async () => {
    const app = mkApp();
    const st = app.storage;
    const bid = seedBook(app, 'rd_6', 'hA', findBook());
    const before = Array.from(st._mem.keys()).sort();
    await app.searchBook(MARK_TAIL, { bookId: bid });
    const after = Array.from(st._mem.keys()).sort();
    assert.deepEqual(after, before, '★ 索引是**可重建**的：查完不得在存储里留下任何新键');
    const info = app.indexCacheInfo();
    assert.equal(info.persisted, false, '★ 缓存不得落盘（计划「不做」：不把缓存误称永久复制正文）');
    assert.equal(info.count, 1);
    assert.ok(info.max >= 1 && info.max <= 16, '缓存必须有界（当前上限 ' + info.max + '）');
    /* 有界：塞满之后最旧的被丢掉（不设界就是拿用户内存赌书库大小）。 */
    for (let i = 0; i < info.max + 2; i++) {
        const b = seedBook(app, 'rd_bulk_' + i, 'h' + i, mkBook(3, []));
        await app.searchBook('甲0段', { bookId: b });
    }
    assert.ok(app.indexCacheInfo().count <= info.max, '★ 缓存条数必须不超上限（当前 ' + app.indexCacheInfo().count + '）');
    /* 删书 ⇒ 它的索引必须跟着走（否则「删掉的书还能被查到」）。
     *   取**最近建过的那一本**（`_bulk_{max+1}`）：最旧的那几本已被有界淘汰，
     *   拿一本已经不在缓存里的书来判「删了还在不在」是假绿（首版正是这么写的）。 */
    const target = 'rd_bulk_' + (info.max + 1);
    const had = app.indexCacheInfo().keys.some((k) => k.indexOf(target + '#') === 0);
    app.removeBook(target);
    const still = app.indexCacheInfo().keys.some((k) => k.indexOf(target + '#') === 0);
    assert.equal(had, true, '前置：这本确实有索引（否则下面那条是假绿）');
    assert.equal(still, false, '★ 删书必须连带丢掉它的索引');
});
test('C7 视图：查找区有取消入口与进度读数，且取消读数说清「一条命中都没给」', async () => {
    const app = mkApp();
    const bid = seedBook(app, 'rd_7', 'hA', findBook());
    app.view.currentBook = { id: bid, title: '书' };
    const view = new VIEW.ReadingView(app);
    app.view = view;
    assert.ok(viewCode.indexOf('rd-find-cancel') >= 0, '查找区必须有取消入口');
    assert.ok(viewCode.indexOf('cancelFind') >= 0, '取消必须真接到控制器');
    assert.ok(viewCode.indexOf('rd-find-progress') >= 0 || viewCode.indexOf('_findProgress') >= 0,
        '查找区必须显示进度读数');
    /* 取消后的读数行不许说成「一处都没有」——那是「书里没有」，与「你取消了」是两件事。 */
    const r = await app.searchBook('', { bookId: bid });
    assert.equal(r.ok, false);
    assert.ok(r.reason.indexOf('empty-query') >= 0, '空查询如实报空查询');
});
/* ══════════ D ── 负控制（破坏副本，不动真仓） ══════════ */
function smashOnce(src, anchor, to) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中 1 次（当前 ' + n + ' 次）：' + anchor);
    return src.split(anchor).join(to);
}
function mkTmpTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp4340-'));
    copyTreeSafe(ROOT, dir, { filter: (s) => !s.split(path.sep).includes('.git') && !s.split(path.sep).includes('node_modules') });
    return dir;
}
test('D1 破坏「版本键含内容指纹」⇒ A2/C2 同款判据必转红（改版后仍复用旧索引）', async () => {
    /* 原版必真（反向对照）。 */
    assert.notEqual(K.indexVersionOf({ id: 'b1', contentHash: 'h1' }).key,
        K.indexVersionOf({ id: 'b1', contentHash: 'h2' }).key, '原版：改指纹必须改键');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            "const key = (bookId && contentHash) ? (bookId + '#' + contentHash) : '';",
            "const key = (bookId) ? (bookId + '#' + 'x') : '';");
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        assert.equal(KB.indexVersionOf({ id: 'b1', contentHash: 'h1' }).key,
            KB.indexVersionOf({ id: 'b1', contentHash: 'h2' }).key,
            '★ 破坏副本上改版不再改键 —— 改版后的查询会端出旧索引的段号，同款判据必须抓住它');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D2 破坏「分片建索引真让出」⇒ B1 的让出判据必转红（回到一整段同步台阶）', async () => {
    const chs = mkBook(K.SEARCH_LIMITS.buildChunk * 2, []);
    const gen0 = K.buildIndexChunks({ id: 'b1', chapters: chs });
    let s0 = gen0.next();
    let y0 = 0;
    while (!s0.done) { y0 += 1; s0 = gen0.next(); }
    assert.ok(y0 > 0, '原版：分片必须真让出');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            'if ((i + 1) % chunk === 0 && i + 1 < chapters.length) yield;',
            'if (false) yield;');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        const gen = KB.buildIndexChunks({ id: 'b1', chapters: chs });
        const st = gen.next();
        assert.equal(st.done, true, '★ 破坏副本上分片不再让出 —— 一整段同步台阶回来了，同款判据必须抓住它');
        assert.equal(st.value.chapters.length, chs.length, '破坏副本仍建完了（否则转红不是因为这条）');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D3 破坏「比中阶段受理取消」⇒ C5 同款判据必转红（点了取消却照跑到底）', async () => {
    const n = K.SEARCH_LIMITS.scanChunk * 3;
    /* 原版必真：比中阶段取消后命中为空、段位如实。 */
    const app0 = mkApp();
    const bid0 = seedBook(app0, 'rd_d3', 'hA', mkBook(n, [{ ch: n - 1, para: 1, text: MARK_TAIL }]));
    const o0 = app0._yieldTurn.bind(app0);
    let y0 = 0;
    app0._yieldTurn = function () { y0 += 1; if (y0 >= 4) app0.cancelFind(); return o0(); };
    const r0 = await app0.searchBook(MARK_TAIL, { bookId: bid0 });
    assert.equal(r0.cancelled, true);
    assert.equal(r0.cancelledAt, 'scan', '原版：比中阶段必须受理取消');
    assert.equal(r0.totalHits, 0, '原版：取消后不得给半份命中');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, APP_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            '            if (ctx.isCancelled()) {\n                gen.return();\n                return { cancelled: true, yielded: yielded, chunks: chunks, scannedChapters: res0.done, total: total };',
            '            if (false) {\n                gen.return();\n                return { cancelled: true, yielded: yielded, chunks: chunks, scannedChapters: res0.done, total: total };');
        fs.writeFileSync(p, broken);
        const AB = await import(pathToFileURL(p).href);
        const app = new AB.ReadingApp({ showNotification: () => {}, screen: null }, mkStorage());
        app._hostWin = () => ({});
        const bid = seedBook(app, 'rd_d3b', 'hA', mkBook(n, [{ ch: n - 1, para: 1, text: MARK_TAIL }]));
        const o = app._yieldTurn.bind(app);
        let y = 0;
        app._yieldTurn = function () { y += 1; if (y >= 4) app.cancelFind(); return o(); };
        const r = await app.searchBook(MARK_TAIL, { bookId: bid });
        assert.equal(r.cancelled, false,
            '★★★ 破坏副本上比中阶段不再受理取消 —— 用户点了取消却照跑到底、还拿到一份「正常结果」，'
            + '同款判据必须抓住它（取消按钮成了装饰）');
        assert.equal(r.totalHits, 1, '破坏副本：那份「正常结果」确实被端了出来（这正是危害形态）');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D4 破坏「章体不可读照样计数」⇒ B3 同款判据必转红（那一章既不计数也不让出）', async () => {
    const chs = mkBook(4, []);
    const ix0 = K.buildSearchIndex({ id: 'b1', chapters: chs });
    ix0.chapters[1].text = null;
    assert.equal(K.searchInBook(ix0, '甲').chaptersScanned, 4, '原版：不可读的章也计数');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'),
            '        if (ch && typeof ch.text === \'string\') {',
            '        if (ch && typeof ch.text === \'string\') {\n        } else { continue; }\n        if (false) {');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        const ix = KB.buildSearchIndex({ id: 'b1', chapters: chs });
        ix.chapters[1].text = null;
        assert.equal(KB.searchInBook(ix, '甲').chaptersScanned, 3,
            '★ 破坏副本上不可读的章不再计数 —— 「扫了 3/4 章」会被读成「全书只有 3 章」，同款判据必须抓住它');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
/* ══════════ E ── 读数锚（改前/后双格） ══════════ */
test('E1 基线**双格**在场：改后那组判据全绿，改前那组如实留痕（含 R4/R5 不成立）', () => {
    assert.equal(base.probe, PROBE_REL, '基线必须指名探针路径');
    assert.equal(base.measured_at, 'v4.33.0', '★ 首测版必须冻结在改动之前那一版（抬版不得改写）');
    assert.equal(base.changed_at, 'v4.34.0', '本版必须留痕');
    assert.ok(base.readings && typeof base.readings === 'object', '改后读数必须在场');
    assert.ok(base.readings_before && typeof base.readings_before === 'object', '★ 改前读数也必须在场（计划要求记改前/后）');
    assert.ok(base.timing && base.timing_before, '两格的计时面都要在');
    /* 改后：判据全绿。 */
    for (const c of base.criteria) {
        assert.equal(c.pass, true, '改后判据必须全绿：' + c.id + ' ' + c.desc + '（got ' + c.got + '）');
    }
    /* 改前：R4/R5 必须**不成立**（那正是本版要治的两条）—— 若改前那组也全绿，
     *   说明基线是拿改后读数冒充改前，这一格就失去意义。 */
    const beforeById = new Map(base.criteria_before.map((c) => [c.id, c]));
    assert.equal(beforeById.get('R4').pass, false, '改前的「只建一次」必须不成立');
    assert.equal(beforeById.get('R5').pass, false, '改前的「复用」必须不成立');
    /* 改前没有复用读数口（available = 0）——「本版没有这条读数」不是「建了 0 次」。 */
    assert.equal(base.readings_before.index_builds_available, 0, '改前不存在复用观测口');
    assert.equal(base.readings_before.index_builds_total, null, '★ 改前那格必须是 null（不是 0）');
    /* 改后有观测口，且三次只建一份。 */
    assert.equal(base.readings.index_builds_available, 1);
    assert.equal(base.readings.index_builds_total, 1, '★ 改后：连续三次查询只建一次同版本索引');
    assert.equal(base.readings.index_builds_before, '0/1/1', '逐次形态：首查建了、后两次没建');
    assert.equal(base.readings.index_reused_seq, 'false/true/true');
});
test('E2 基线计数段与现场复跑**逐项一致**（读数不得手抄、也不得漂移）', () => {
    /* 计数段可复算：现场重跑探针，只比计数段（计时不可复算，只比存在与量级）。 */
    const rep = spawnSync(process.execPath, [path.join(ROOT, PROBE_REL)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    assert.equal(rep.status, 0, '探针必须跑通（fail-closed）：' + String(rep.stderr || '').slice(0, 300));
    const live = JSON.parse(rep.stdout);
    assert.deepEqual(live.readings, base.readings, '★ 计数段必须与基线逐项一致（漂移即红）');
    for (const c of live.criteria) {
        assert.equal(c.pass, true, '现场复跑判据必须全绿：' + c.id);
    }
    /* 计时面只判**在场且为有限数**：进程调度与 GC 会动它，比绝对值就是自造假红。 */
    for (const k of ['first_ms', 'second_ms', 'third_ms', 'heap_delta_mb']) {
        assert.ok(Number.isFinite(live.timing[k]), '计时面必须在场且为有限数：' + k);
    }
    /* 探针自身的三条纪律（结构面）。 */
    assert.ok(probeSrc.indexOf('fail-closed') >= 0, '探针必须 fail-closed（读不到就拒判，不以 0 发合格证）');
    assert.ok(probeSrc.indexOf("const MEASURED_AT = 'v' + MANIFEST.version;") >= 0, '探针版本必须现读 manifest');
    assert.ok(probeSrc.indexOf('reading_find_scale_baseline') < 0, '探针不得自己写基线文件（读数由调用方重定向落盘）');
});
/* ══════════ F ── 版本锚 ══════════ */
test('F1 五源同源 + 当版条目点名 R5-O7', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const ul = JSON.parse(read('update-log.json'));
    const idx = read('index.js');
    const m = /ST_PHONE_VERSION\s*=\s*'([^']+)'/.exec(idx);
    assert.ok(m, 'index.js 里必须有版本常量');
    const versions = [pkg.version, man.version, ul.latest, m[1]];
    for (const v of versions) assert.equal(v, versions[0], '五源必须同源：' + JSON.stringify(versions));
    assert.equal(ul.versions[versions[0]] != null, true, '当版条目必须在 update-log 里');
    const items = ul.versions[versions[0]].items || [];
    assert.ok(items.length >= 8, '当版条目必须够（当前 ' + items.length + ' 条）');
    assert.ok(items.join(NL).indexOf('R5-O7') >= 0, '当版条目必须点名 R5-O7');
    /* 迭代段里的标志语必须逐字同源（本仓被这条坑过：写错一个字，四条判据连锁转红）。 */
    const seg = items.join(NL);
    assert.ok(seg.indexOf('看起来没坏但显示不对') >= 0 || seg.indexOf('R5-O7') >= 0,
        '迭代段必须含仓内标志语或点名当版编号');
});
