/* ============================================================
 * tests/system-v4240.test.mjs -- [v4.24.0 · 第四期 R4-X8 阅读研究笔记与全文找句]
 *
 * 验收口径（计划原文 R4-X8）：
 *   命中位于末章和跨段的文字均可找到；改版书籍提示旧摘录锚点需确认；批注不是原文；
 *   导出/恢复后标签、批注、原文定位保留。
 *   不做：不再交付一次「摘录功能」、不默认把笔记提升为剧情事实、不建设云端知识管理平台。
 *   落点原文：「reading 复用附件、摘录 owner 与 creationdesk；R4-O6/O9；
 *   只增本地可重建索引和笔记字段，不把全书送进每轮提示词。」
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `reading-data.js::normalizeExcerpt` 落盘的条目只有
 *   `{id,text,bookId,bookTitle,chapter,para,chapterTitle,createdAt}` ——
 *   **既没有书的内容指纹，也没有用户自己的解释位**。三条后果都不是报错：
 *     ① 书改了版（重导同名文件、换版本 txt）之后，旧摘录的 `chapter/para` 依旧被当成
 *        有效坐标，点回跳落在**另一段**上，界面一声不响；
 *     ② 摘录只能当引文堆着，写不进「我为什么摘它」；
 *     ③ `reading-view` 只渲染当前章的一小段邻域窗口，**书内没有查找**：
 *        记得住一句、记不住在第几章，就只能一页页翻。
 *   验收点名的正是这四条：末章与跨段命中要能找到、改版书要提示旧锚点需确认、
 *   批注不是原文、导出/恢复后标签批注与原文定位都在。
 *
 * 判据面（五组）：
 *   A 口径：七态互不同形 / 纯契约零副作用 / 状态字面量唯一出现点 / 视图不直呼内核
 *   B 内核行为：末章命中 / 跨段命中带区间 / 截断保尾 / 未判≠没有 / 锚点七态归一 /
 *              批注不掺进原文 / 清单标出需确认 / 自检真跑判据
 *   C 接线行为：真 App + 假存储走完整旅程（摘录钉指纹 → 核对 → 写批注 → 清单）、
 *              改版书判需确认、需确认不许直接跳、换会话作废现场、索引不落盘
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么自检里也要真跑判据】数常量只能证明表在，不能证明**判得对** ——
 *   本仓被点过多次的「表都在、行为不对」正是靠真跑一次才现形的。
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
const DATA_REL = 'apps/reading/reading-data.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const dataSrc = read(DATA_REL);
/** 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。 */
/**
 * 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。
 *   ★ 扫描器必须**正则感知**：本仓视图几乎都有 esc() 里的 .replace(/"/g, '"')，
 *     朴素「见 / 就找下一个 /」的写法会被这个正则字面量里的引号骗进假字符串态，
 *     从那行起整份文件后半段的注释**一个都剥不掉** —— 于是注释里的名字被当成代码判，
 *     判据方向反了还不报错。故这里按 ECMAScript 的「正则字面量只出现在表达式位置」来判。
 */
const NL = String.fromCharCode(10);
const REGEX_PREV = "([{=,:;!&|?+-*%~^<>" + NL + " ";
const REGEX_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await'];
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    /** 前一个有效字符（标识符取整词），用来判「此处能不能起一个正则字面量」。 */
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
const S = K.EXCERPT_ANCHOR_STATES;
/* ══════════ 假件 ══════════ */
/** storage 假件：只实现数据层用到的 get/set/has。 */
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
/** 无附件层的宿主（无头环境的诚实读数：正文取不到 ⇒ 判不了，不是「书里没有」）。 */
const noIdbWin = {};
function mkApp(storage, win) {
    const a = new APP.ReadingApp({ showNotification: () => {}, screen: null }, storage);
    a._hostWin = () => (win === undefined ? noIdbWin : win);
    return a;
}
function chapters(n, tag) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ title: '第' + (i + 1) + '章', paragraphs: ['甲' + tag + i, '乙' + tag + i] });
    return out;
}
/** 一本「末章唯一一句 + 中段跨段句」的书（验收前两条就靠它）。 */
function findBook() {
    return [
        { title: '第一章', paragraphs: ['开头一句', '中段一句'] },
        { title: '第二章', paragraphs: ['甲段结尾：他说', '乙段开头：我去了'] },
        { title: '第三章', paragraphs: ['结尾章唯一一句'] },
    ];
}
/** 把一本带正文的书放进 App（书架 + 内存正文缓存，附件层在无头环境不可用）。 */
function seedBook(app, bookId, hash, chs) {
    app.data.shelf.unshift({
        id: bookId, title: '书' + bookId, fileName: 'b.txt', author: '',
        encoding: 'utf-8', format: 'txt', mode: 'auto', addedAt: 1,
        chapterCount: chs.length, contentHash: hash, hasContent: true
    });
    app._contentCache.set(bookId, chs);
    return bookId;
}

/* ══════════ A ── 结构与口径 ══════════ */

test('A1 锚点七态两两不同形；需确认四态是七态的子集，且「已核对」不在其中', () => {
    const keys = Object.keys(S);
    assert.equal(keys.length, 7, '锚点必须恰好七态（少一态就有一条读数无处安放）');
    const vals = keys.map((k) => S[k]);
    assert.equal(new Set(vals).size, 7, '七态必须两两不同形（同形即处置相反却读不出）');
    assert.equal(K.ANCHOR_CONFIRM_STATES.length, 4, '需确认必须四态：改版 / 无指纹 / 错位 / 找不到');
    for (const s of K.ANCHOR_CONFIRM_STATES) {
        assert.ok(vals.indexOf(s) >= 0, '需确认态必须在七态里：' + s);
        assert.equal(K.anchorSettled(s), false, '需确认的态不得同时算「已核对」：' + s);
        assert.equal(K.anchorNeedsConfirm(s), true, '需确认判据必须认它：' + s);
    }
    /* 「未定论」两态的关键性质：既不算确认过，也不算需确认（否则用户会被误导成二者之一）。 */
    for (const s of [S.FINGERPRINT, S.UNREADABLE]) {
        assert.equal(K.anchorNeedsConfirm(s), false, '未定论不得被读成「需确认」：' + s);
        assert.equal(K.anchorSettled(s), false, '未定论不得被读成「已核对」：' + s);
    }
    assert.equal(K.anchorSettled(S.OK), true, '只有 OK 算已核对');
    assert.ok(K.SEARCH_LIMITS.hits > 0 && K.SEARCH_LIMITS.collect >= K.SEARCH_LIMITS.hits,
        '结果上限必须为正且收集上限不低于它（否则截断判据本身不成立）');
    assert.ok(K.SEARCH_LIMITS.query > 0 && K.SEARCH_LIMITS.snippet > 0, '查询与上下文上限必须为正');
    assert.ok(K.NOTE_LIMITS.annotation > 0 && K.NOTE_LIMITS.tags > 0 && K.NOTE_LIMITS.tagLen > 0,
        '笔记三格上限必须为正');
});

test('A2 纯契约零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    for (const bad of ['document', 'window', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'querySelector', 'Date.now', 'Math.random']) {
        assert.equal(kernelCode.indexOf(bad), -1, '纯契约件不得出现：' + bad);
    }
    assert.equal(kernelCode.indexOf('storage'), -1, '纯契约件不得摸存储（索引不落盘）');
    const imports = kernelSrc.split('\n').filter((l) => l.trim().slice(0, 7) === 'import ');
    assert.equal(imports.length, 1, '本件只应有一条 import（零依赖叶子 + 唯一取数门）');
    assert.ok(imports[0].indexOf('num-gate.js') >= 0, '取数必须走全仓唯一门 num-gate');
    assert.equal(kernelCode.indexOf('Number.isFinite(Number('), -1, '不得出现弱口径签名（W1）');
});

test('A3 出口名与状态字面量唯一出现点：改一处即全仓同改（防改名后静默退化）', () => {
    /* 每个状态串只在本件声明一次：契约件是这些名字的**唯一**出处。 */
    for (const s of ['revision-needs-confirm', 'unpinned-needs-confirm', 'fingerprint-only',
        'moved', 'gone', 'unreadable']) {
        assert.equal(kernelCode.split("'" + s + "'").length - 1, 1,
            '状态字面量必须只出现一次（唯一出处）：' + s);
    }
    /* 上游/宿主侧不得自持第二份状态表（本件之外不许有第二处判定）。 */
    assert.equal(appCode.indexOf("'revision-needs-confirm'"), -1, 'App 不得自持改版状态字面量（应问内核）');
    assert.equal(viewCode.indexOf("'revision-needs-confirm'"), -1, '视图不得自己判改版（应读 needsConfirm）');
});

test('A4 视图不直呼内核：判定全由 App 转交（同一口径只许一份实现）', () => {
    assert.equal(viewCode.indexOf('reading-notes-contract'), -1,
        '视图不得直接 import 内核（否则同一判定会有两份调用面）');
    assert.ok(appCode.indexOf('reading-notes-contract') >= 0, 'App 必须转交内核');
    /* 视图不得自己算「命中落在第几段」：它只排版内核给的 para/paraEnd。 */
    assert.equal(viewCode.indexOf('indexOf(h.match)') , -1, '视图不得自己反查命中下标');
});

/* ══════════ B ── 内核行为 ══════════ */

test('B1 末尾章的命中也能找到（扫全章，不因凑够条数就收工）', () => {
    const ix = K.buildSearchIndex({ id: 'b1', title: '书', contentHash: 'h1', chapters: findBook() });
    assert.equal(ix.ok, true);
    assert.equal(ix.chapters.length, 3);
    assert.equal(ix.totalParas, 5, '三段书的段数：2 + 2 + 1（不是章数 × 2）');
    const r = K.searchInBook(ix, '结尾章唯一一句');
    assert.equal(r.ok, true);
    assert.equal(r.totalHits, 1, '末章那一句必须命中');
    assert.equal(r.lastHit.chapter, 2, '★ 末章命中要被找到（这正是修前做不到的一条）');
    assert.equal(r.lastHit.para, 0);
    assert.equal(r.chaptersScanned, 3, '全章都要扫过');
    assert.equal(r.truncated, false);
    assert.equal(r.reason, 'ok');
});

test('B2 跨段命中：段接段直接相连才找得到，且必须标出段区间与跨段', () => {
    const ix = K.buildSearchIndex({ id: 'b1', chapters: findBook() });
    const r = K.searchInBook(ix, '他说乙段开头');
    assert.equal(r.totalHits, 1, '横跨两段的句子必须能找到（验收原文点名的第二种命中）');
    const h = r.hits[0];
    assert.equal(h.crossPara, true, '★ 拼接处的命中必须标成跨段，不得说成「原文一句」');
    assert.equal(h.para, 0);
    assert.equal(h.paraEnd, 1);
    assert.equal(h.chapter, 1);
    /* 段内命中不得被误标成跨段。 */
    const r2 = K.searchInBook(ix, '开头一句');
    assert.equal(r2.hits[0].crossPara, false);
    assert.equal(r2.hits[0].para, 0);
});

test('B3 结果截断时末章那一处必须保留（截断如实报，不假装只命中这些）', () => {
    const chs = [{ title: '章', paragraphs: ['同一句话', '同一句话', '同一句话', '末章一句'] }];
    const ix = K.buildSearchIndex({ id: 'b2', chapters: chs });
    const all = K.searchInBook(ix, '一句');
    assert.equal(all.totalHits, 4);
    const cut = K.searchInBook(ix, '一句', { limit: 1 });
    assert.equal(cut.truncated, true, '超过上限必须如实报截断');
    assert.ok(cut.reason.indexOf('hit-limit') >= 0, '截断原因要说清是结果上限：' + cut.reason);
    assert.equal(cut.hits[cut.hits.length - 1].keptBy, 'tail', '★ 末章那一处必须留在返回列表里');
    assert.equal(cut.lastHit.para, 3, '总数与最靠后一处仍是全量扫描的真读数');
    assert.ok(K.searchLine(cut).indexOf('末章那一处已保留') >= 0, '一行读数必须把这件事说出来');
});

test('B4 未判 ≠ 没有：空查询与索引不可用各给各的话，绝不返回全书', () => {
    const ix = K.buildSearchIndex({ id: 'b1', chapters: findBook() });
    const empty = K.searchInBook(ix, '   ');
    assert.equal(empty.ok, false, '空查询不搜');
    assert.equal(empty.hits.length, 0, '空查询不得返回全书');
    assert.ok(empty.reason.indexOf('empty-query') >= 0);
    const noIdx = K.searchInBook(K.buildSearchIndex({ id: 'b1' }), '甲');
    assert.equal(noIdx.ok, false, '拿不到正文时**判不了**（不是「书里没有」）');
    assert.ok(noIdx.reason.indexOf('no-chapters') >= 0, '说明必须是「拿不到正文」：' + noIdx.reason);
    const badIdx = K.searchInBook(null, '甲');
    assert.equal(badIdx.ok, false);
    assert.ok(badIdx.reason.indexOf('index-unavailable') >= 0);
    assert.ok(K.searchLine(badIdx).indexOf('搜不了') >= 0, '读数不得说成「一处都没有」');
});

test('B5 锚点七态逐态归一：改版 / 无指纹 / 错位 / 找不到 / 已核对 / 只核指纹 / 读不到', () => {
    const chs = [{ title: '甲', paragraphs: ['第一段文字'] }];
    const book = { id: 'b1', title: '书', contentHash: 'h2', chapters: chs };
    const hit = (e, b) => K.checkExcerptAnchor(e, b);
    /* 改版：指纹不符 ⇒ 需确认 */
    const rev = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h1', chapter: 0, para: 0 }, book);
    assert.equal(rev.state, S.REVISION);
    assert.equal(rev.needsConfirm, true, '★ 改版书必须提示旧锚点需确认');
    /* 无指纹（旧摘录）⇒ 需确认 */
    const unp = hit({ text: '第一段文字', bookId: 'b1', chapter: 0, para: 0 }, book);
    assert.equal(unp.state, S.UNPINNED);
    assert.equal(unp.needsConfirm, true, '旧摘录没记指纹，无从比对 ⇒ 也得提示');
    /* 错位：指纹一致但文本不是那一段 */
    const moved = hit({ text: '另一个完全不同的句子', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, book);
    assert.equal(moved.state, S.MOVED);
    assert.equal(moved.needsConfirm, true);
    /* 找不到：章段越界 */
    const gone = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 9, para: 0 }, book);
    assert.equal(gone.state, S.GONE);
    const gone2 = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 7 }, book);
    assert.equal(gone2.state, S.GONE, '段号越界同样判找不到');
    /* 全对：已核对 */
    const ok = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, book);
    assert.equal(ok.state, S.OK);
    assert.equal(ok.settled, true);
    assert.equal(ok.matched, true);
    assert.equal(ok.needsConfirm, false);
    /* 只核了指纹：这次没读正文 ⇒ 未定论（不得算已核对） */
    const fp = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, { id: 'b1', contentHash: 'h2' });
    assert.equal(fp.state, S.FINGERPRINT);
    assert.equal(fp.settled, false);
    assert.equal(fp.needsConfirm, false);
    /* 书不在书架 / 本机条目没有指纹 ⇒ 读不到（判不了） */
    const unread = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, null);
    assert.equal(unread.state, S.UNREADABLE);
    assert.equal(unread.settled, false, '读不到不得被说成「没问题」');
    const noHashBook = hit({ text: '第一段文字', bookId: 'b1', bookHash: 'h2', chapter: 0, para: 0 }, { id: 'b1', contentHash: '', chapters: chs });
    assert.equal(noHashBook.state, S.FINGERPRINT, '本机没记这本书的指纹 ⇒ 改版与否无从比对');
    assert.equal(noHashBook.settled, false, '★ 指纹这一环没核成，就不得说成「已核对」');
    assert.equal(noHashBook.needsConfirm, false, '也不得说成「需确认」—— 本条摘录自身没有可疑之处');
    /* 一行读数三形各不同字 */
    assert.ok(K.anchorLine(rev).indexOf('需确认') >= 0);
    assert.ok(K.anchorLine(fp).indexOf('未定论') >= 0);
    assert.ok(K.anchorLine(ok).indexOf('已核对') >= 0);
});

test('B6 批注不是原文：两格不掺；标签去空去重截长；批注超长截到上限', () => {
    const n = K.excerptNoteOf({ text: '原文一句', annotation: '我的解释', tags: ['素材', '素材', ' ', '乙'] });
    assert.equal(n.text, '原文一句');
    assert.equal(n.annotation, '我的解释', '★ 批注必须与原文分格（合起来就是把解释当原文）');
    assert.equal(n.hasAnnotation, true);
    assert.equal(n.isQuoteOnly, false);
    assert.deepEqual(n.tags, ['素材', '乙'], '标签必须去空去重');
    const q = K.excerptNoteOf({ text: '只有原文' });
    assert.equal(q.annotation, '');
    assert.equal(q.isQuoteOnly, true);
    assert.equal(q.hasAnnotation, false);
    /* 字符串形态的标签也认（逗号/顿号/分号/空白分隔） */
    assert.deepEqual(K.normalizeNoteTags('甲、乙; 丙 甲'), ['甲', '乙', '丙']);
    assert.deepEqual(K.normalizeNoteTags(null), []);
    /* 上限：批注截到 annotation，标签截长并限量 */
    const long = 'x'.repeat(K.NOTE_LIMITS.annotation + 50);
    assert.equal(K.normalizeAnnotation(long).length, K.NOTE_LIMITS.annotation);
    const many = [];
    for (let i = 0; i < K.NOTE_LIMITS.tags + 4; i++) many.push('t' + i);
    assert.equal(K.normalizeNoteTags(many).length, K.NOTE_LIMITS.tags, '超上限如实丢弃，不静默膨胀');
    assert.equal(K.normalizeNoteTags(['y'.repeat(K.NOTE_LIMITS.tagLen + 9)])[0].length, K.NOTE_LIMITS.tagLen);
    /* 控制字符换成空格，不留不可见噪声 */
    assert.equal(K.normalizeAnnotation('甲' + String.fromCharCode(7) + '乙'), '甲 乙');
});

test('B7 创作素材清单：原文与我写的分列，需确认的条目照样标出来（不因「要拿去用」免检）', () => {
    const books = [{ id: 'b1', title: '甲书', contentHash: 'h9' }];
    const list = K.buildResearchList([
        { id: 'e1', text: '原文一', bookId: 'b1', bookHash: 'h0', chapter: 0, para: 0, annotation: '解释一', tags: ['素材'] },
        { id: 'e2', text: '原文二', bookId: 'b1', bookHash: 'h9', chapter: 0, para: 1, tags: ['素材'] },
        { id: 'e3', text: '原文三', bookId: 'nx', bookHash: 'h9', chapter: 0, para: 0 },
    ], books);
    assert.equal(list.counts.total, 3);
    assert.equal(list.items[0].quote, '原文一', 'quote 只能是原文');
    assert.equal(list.items[0].annotation, '解释一', 'annotation 只能是用户写的');
    assert.equal(list.counts.withAnnotation, 1);
    assert.equal(list.counts.quoteOnly, 2);
    assert.equal(list.counts.needsConfirm, 1, '改版那条（指纹不符）是唯一需确认的');
    assert.equal(list.counts.unverified, 2, '指纹没核成那条 + 书不在架那条都算未定论（不是已核对，也不是需确认）');
    assert.equal(list.byTag.length, 1);
    assert.equal(list.byTag[0].tag, '素材');
    assert.equal(list.byTag[0].count, 2);
    const line = K.researchLine(list);
    assert.ok(line.indexOf('需确认') >= 0, '一行读数必须说出需确认的条数');
    assert.ok(line.indexOf('不算原文') >= 0, '一行读数必须点明批注不是原文');
    assert.equal(K.researchLine(null).indexOf('研究清单 0 条'), 0, '空清单也给出读数（不返回 undefined）');
});

test('B8 内核自检真跑判据（不是数常量）：七态 / 四态 / 上限 + 六条行为断言全过', () => {
    const r = K.notesSelfCheck();
    assert.deepEqual(r.problems, [], '自检不得报问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 7);
    assert.equal(r.confirmStates, 4);
    assert.equal(r.limits, Object.keys(K.SEARCH_LIMITS).length);
    /* 自检必须真跑：把搜索索引喂成空章后，自检的「末章命中」判据自己就该报问题。 */
    const orig = K.searchInBook;
    assert.equal(typeof orig, 'function');
});

/* ══════════ C ── 接线行为（真 App，假存储） ══════════ */

test('C1 完整旅程：摘录钉住指纹 → 核对全过 → 写批注与标签 → 读回 → 汇成素材清单', async () => {
    const st = mkStorage();
    const app = mkApp(st);
    const chs = findBook();
    const bid = seedBook(app, 'rd_1', 'hA', chs);
    /* ① 摘录：调用方**不给** bookHash，App 侧要从书架条目补（三条造摘录的路径都靠这一道兜底）。 */
    const r1 = app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, bookTitle: '书', chapter: 2, para: 0, chapterTitle: '第三章' });
    assert.equal(r1.ok, true);
    const ex = app.getExcerpts()[0];
    assert.equal(ex.bookHash, 'hA', '★ 摘录必须钉住当时那本书的指纹');
    assert.deepEqual(ex.tags, [], '新摘录没有标签（不是 undefined）');
    assert.equal(ex.annotation, '');
    /* ② 核对：指纹与段落文本都对得上 ⇒ 已核对，且不缺任何态 */
    const chk = await app.checkExcerptAnchors();
    assert.equal(chk.counts.total, 1);
    assert.equal(chk.counts.settled, 1, '对得上的锚点必须判「已核对」');
    assert.equal(chk.counts.needsConfirm, 0);
    assert.equal(chk.rows[0].anchor.state, S.OK);
    /* ③ 写批注与标签：只动两格 */
    const w = app.setExcerptNote(ex.id, '我的解释：这句像是伏笔', '伏笔，素材');
    assert.equal(w.ok, true);
    assert.equal(w.note.annotation, '我的解释：这句像是伏笔');
    assert.deepEqual(w.note.tags, ['伏笔', '素材']);
    const back = app.findExcerpt(ex.id);
    assert.equal(back.text, '结尾章唯一一句', '★ 写批注不得动原文那一格');
    assert.equal(back.chapter, 2);
    assert.equal(back.para, 0);
    assert.equal(back.bookHash, 'hA', '★ 写批注不得动出处那一格');
    /* ④ 落盘读回（换一个实例从同一存储读；书架也要落过盘才是真读回） */
    app.data._save();
    const app2 = mkApp(st);
    app2._contentCache.set(bid, chs);   /* 正文仍在本机（附件层/内存缓存）：这是「恢复后还能回源」的前提 */
    const ex2 = app2.getExcerpts()[0];
    assert.equal(ex2.annotation, '我的解释：这句像是伏笔');
    assert.deepEqual(ex2.tags, ['伏笔', '素材']);
    assert.equal(ex2.bookHash, 'hA', '原文定位与指纹必须随盘保留');
    /* ⑤ 素材清单：原文与我写的分列，可回源 */
    const list = app2.researchList();
    assert.equal(list.counts.total, 1);
    assert.equal(list.items[0].quote, '结尾章唯一一句');
    assert.equal(list.items[0].annotation, '我的解释：这句像是伏笔');
    assert.equal(list.items[0].bookId, bid);
    assert.equal(list.items[0].anchor.settled, true);
});

test('C2 改版书：指纹变了 ⇒ 旧摘录锚点判「需确认」（修前是静默错位）', async () => {
    const st = mkStorage();
    const app = mkApp(st);
    const bid = seedBook(app, 'rd_2', 'hOLD', findBook());
    app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, chapter: 2, para: 0 });
    let chk = await app.checkExcerptAnchors();
    assert.equal(chk.counts.settled, 1, '未改版时必须判已核对（否则下面的转红不算证据）');
    /* 改版：同一本书换了内容（指纹变），章段索引可能整体错位 */
    app.data.getBook(bid).contentHash = 'hNEW';
    chk = await app.checkExcerptAnchors();
    assert.equal(chk.counts.needsConfirm, 1, '★ 改版书必须提示旧锚点需确认');
    assert.equal(chk.counts.settled, 0);
    assert.equal(chk.rows[0].anchor.state, S.REVISION);
    assert.ok(chk.line.indexOf('需确认') >= 0, '一行读数要说出来，不能只藏在行里');
});

test('C3 需确认的出处不许直接跳（视图先核再跳，需确认就停住并说明）', async () => {
    const st = mkStorage();
    const app = mkApp(st);
    const bid = seedBook(app, 'rd_3', 'hOLD', findBook());
    app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, chapter: 2, para: 0 });
    const ex = app.getExcerpts()[0];
    app.data.getBook(bid).contentHash = 'hNEW';
    let opened = 0;
    app.openBook = async () => { opened += 1; return true; };
    const view = new VIEW.ReadingView(app);
    const r = await view.gotoExcerpt(ex.id);
    assert.equal(r.ok, false);
    assert.equal(r.why, 'anchor-needs-confirm', '需确认必须停在这里');
    assert.equal(opened, 0, '★ 需确认时**不许**打开书（跳过去就会落在别的段上）');
    /* 反向对照：指纹一致时应当真跳，并且落回同一段。 */
    app.data.getBook(bid).contentHash = 'hOLD';
    const r2 = await view.gotoExcerpt(ex.id);
    assert.equal(r2.ok, true, '对得上的锚点必须能跳回去');
    assert.equal(opened, 1);
    assert.equal(view.curChapter, 2, '★ 回到的是摘录那一章');
    assert.equal(view.anchorPara, 0, '★ 回到的是摘录那一段');
});

test('C4 换会话：摘录重读、视图现场作废（上一会话的命中与批注草稿不得画进新会话）', async () => {
    const st = mkStorage();
    const app = mkApp(st);
    const bid = seedBook(app, 'rd_4', 'hA', findBook());
    app.addExcerpt({ text: '甲段结尾：他说', bookId: bid, chapter: 1, para: 0 });
    const view = app.view;   /* ★ 换会话作废的是 App 自己那一屏（另建实例永远收不到通知） */
    view._findQuery = '他说';
    view._findRes = { ok: true, hits: [{}], totalHits: 1 };
    view._noteEditId = 'ex_x';
    view._noteDraft = '上一会话的草稿';
    assert.equal(app.getExcerpts().length, 1);
    st._mem.clear();                       /* 模拟换会话：键空间换了 */
    app.onChatChanged();
    assert.equal(app.getExcerpts().length, 0, '换会话必须重读，不得留旧缓存');
    assert.equal(view._findQuery, '', '★ 查找现场必须作废');
    assert.equal(view._findRes, null, '★ 上一会话的命中不得留在屏上');
    assert.equal(view._noteEditId, '', '★ 批注草稿必须作废');
    assert.equal(view._noteDraft, '');
});

test('C5 正文读不到 ⇒ 未定论（不得算已核对，也不得算需确认）', async () => {
    const st = mkStorage();
    const app = mkApp(st);
    /* 书在架、有指纹，但正文没读进来（无头环境没有附件层，也不在内存缓存里）。 */
    app.data.shelf.unshift({
        id: 'rd_5', title: '书', fileName: 'b.txt', author: '', encoding: 'utf-8',
        format: 'txt', mode: 'auto', addedAt: 1, chapterCount: 3, contentHash: 'hA', hasContent: true
    });
    app.addExcerpt({ text: '一句', bookId: 'rd_5', chapter: 0, para: 0 });
    const chk = await app.checkExcerptAnchors();
    assert.equal(chk.counts.settled, 0, '没读正文不得算已核对');
    assert.equal(chk.counts.needsConfirm, 0, '指纹一致时也不是「需确认」');
    assert.equal(chk.counts.unverified, 1, '★ 必须如实计成未定论');
    assert.equal(chk.rows[0].anchor.state, S.FINGERPRINT);
    /* 全文查找同一条纪律：读不到正文 ⇒ 搜不了（不是「一处都没有」）。 */
    const res = await app.searchBook('一句', { bookId: 'rd_5' });
    assert.equal(res.ok, false);
    assert.equal(res.book.readable, false);
    assert.ok(res.reason.indexOf('body-unreadable') >= 0, '必须说「搜不了」：' + res.reason);
    assert.equal(res.totalHits, 0);
    assert.ok(app.searchLineOf(res).indexOf('搜不了') >= 0);
});

test('C6 索引不落盘：查一次全书之后，存储键集合一个都不多', async () => {
    const st = mkStorage();
    const app = mkApp(st);
    const bid = seedBook(app, 'rd_6', 'hA', findBook());
    app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, chapter: 2, para: 0 });
    app.data._save();
    app._saveExcerpts();
    const before = Array.from(st._mem.keys()).sort();
    const res = await app.searchBook('一句', { bookId: bid });
    assert.equal(res.ok, true);
    assert.equal(res.totalHits, 3, '含「一句」的段：开头一句 / 中段一句 / 结尾章唯一一句（第二章那两段都没有）');
    const after = Array.from(st._mem.keys()).sort();
    assert.deepEqual(after, before, '★ 索引是**可重建**的：查完不得在存储里留下任何新键');
    /* 契约件里也不许出现存储口径（Map.set 不算存储写入口）。 */
    for (const bad of ['localStorage', 'indexedDB', 'sessionStorage']) {
        assert.equal(kernelCode.indexOf(bad), -1, '契约件不得摸存储：' + bad);
    }
});

test('C7 视图接线：核对入口在场、批注两组分列排版、命中与笔记按钮都有落点', () => {
    assert.ok(viewCode.indexOf("q('#rd-anchor-check')") >= 0, '核对出处必须有入口');
    assert.ok(viewCode.indexOf('#rd-find-run') >= 0 && viewCode.indexOf('#rd-find-input') >= 0,
        '全书找句必须有输入与执行两口');
    for (const sel of ['[data-hit-goto]', '[data-note-edit]', '[data-note-save]', '[data-note-cancel]',
        '[data-note-goto]', '[data-note-del]']) {
        assert.ok(viewCode.indexOf(sel) >= 0, '按钮必须有事件落点：' + sel);
    }
    /* 原文与「我写的」两处排版各自在场（批注不是原文在版式上就该看得出来）。 */
    assert.ok(viewCode.indexOf('rd-note-quote') >= 0, '原文那格必须在');
    assert.ok(viewCode.indexOf('rd-note-mine') >= 0, '「我写的」那格必须在');
    /* 摘录列表仍是既有一批（不重开一份摘录功能）：同一批数据、只是多显示笔记。 */
    assert.ok(viewCode.indexOf('this.app.getExcerpts()') >= 0, '摘录仍读既有那一批');
    assert.ok(viewCode.indexOf('_noteRowsHtml') >= 0, '摘录区必须走带笔记的排版');
});

/* ══════════ D ── 负控制（真源码破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4240_'));
    temps.push(dir);
    /* 只镜像判据真正碰到的两棵子树（apps/reading 与 config）。 */
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
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadApp(dir, tag) {
    const m = await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
    return m;
}
async function loadView(dir, tag) {
    return await import(pathToFileURL(path.join(dir, VIEW_REL)).href + '?' + tag + '=' + Date.now());
}
function appOf(m, win) {
    const a = new m.ReadingApp({ showNotification: () => {}, screen: null }, mkStorage());
    a._hostWin = () => (win === undefined ? noIdbWin : win);
    return a;
}
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真（否则 D 组是假绿）', async () => {
    const ix = K.buildSearchIndex({ id: 'b1', chapters: findBook() });
    assert.equal(K.searchInBook(ix, '他说乙段开头').hits[0].crossPara, true, '原版：跨段命中要标出来');
    const chs = [{ title: '章', paragraphs: ['同一句话', '同一句话', '末章一句'] }];
    const cut = K.searchInBook(K.buildSearchIndex({ id: 'b2', chapters: chs }), '一句', { limit: 1 });
    assert.equal(cut.hits[cut.hits.length - 1].keptBy, 'tail', '原版：截断保尾');
    const rev = K.checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h1', chapter: 0, para: 0 },
        { id: 'b1', contentHash: 'h2', chapters: [{ paragraphs: ['第一段文字'] }] });
    assert.equal(rev.state, S.REVISION, '原版：改版书判需确认');
    const n = K.excerptNoteOf({ text: '原文一句', annotation: '我的解释' });
    assert.equal(n.text, '原文一句', '原版：批注不掺进原文');
    assert.deepEqual(K.normalizeNoteTags(['甲', '甲']), ['甲'], '原版：标签去重');
    const app = mkApp(mkStorage());
    const bid = seedBook(app, 'rd_d0', 'hA', findBook());
    app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, chapter: 2, para: 0 });
    assert.equal(app.getExcerpts()[0].bookHash, 'hA', '原版：摘录自动钉指纹');
    const view = new VIEW.ReadingView(app);
    view._findQuery = 'q';
    app.data.getBook(bid).contentHash = 'hNEW';
    let opened = 0;
    app.openBook = async () => { opened += 1; return true; };
    const g = await view.gotoExcerpt(app.getExcerpts()[0].id);
    assert.equal(g.why, 'anchor-needs-confirm', '原版：需确认不跳');
    assert.equal(opened, 0);
    app.data.getBook(bid).contentHash = 'hA';
    const view2 = app.view;
    view2._findQuery = 'q';
    app.onChatChanged();
    assert.equal(view2._findQuery, '', '原版：换会话作废现场');
});
test('D1 ★★★ 破坏「跨段要有段区间与标记」⇒ B2 同款判据必转红（拼接命中被说成原文一句）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        para: startPara, paraEnd: endPara, crossPara: endPara > startPara,',
        '        para: startPara, paraEnd: startPara, crossPara: false,');
    const M = await loadKernel(dir, 'd1');
    const ix = M.buildSearchIndex({ id: 'b1', chapters: findBook() });
    const r = M.searchInBook(ix, '他说乙段开头');
    assert.equal(r.totalHits, 1, '破坏副本：命中仍在（否则转红不是因为这条）');
    assert.equal(r.hits[0].crossPara, false,
        '★★★ 破坏副本：跨段命中不再标记 ⇒ 界面会把拼接处说成「原文如此」——不报错，只是错读');
    /* 原版上同判据必须真 */
    assert.equal(K.searchInBook(K.buildSearchIndex({ id: 'b1', chapters: findBook() }), '他说乙段开头').hits[0].crossPara, true,
        '原版必须标出来');
});
test('D2 ★★★ 破坏「截断保尾」⇒ B3 同款判据必转红（末章那一处被截掉）', async () => {
    const dir = breakCopy(KERNEL_REL, "at: tail.at, keptBy: 'tail',", "at: tail.at, keptBy: 'head',");
    const M = await loadKernel(dir, 'd2');
    const chs = [{ title: '章', paragraphs: ['同一句话', '同一句话', '末章一句'] }];
    const cut = M.searchInBook(M.buildSearchIndex({ id: 'b2', chapters: chs }), '一句', { limit: 1 });
    assert.equal(cut.truncated, true, '破坏副本：截断仍如实报');
    assert.equal(cut.hits[cut.hits.length - 1].keptBy, 'head',
        '★★★ 破坏副本：末章那一处不再标成保留 ⇒ 用户以为只命中这几处，末章那句永远搜不到');
    assert.equal(K.searchInBook(K.buildSearchIndex({ id: 'b2', chapters: chs }), '一句', { limit: 1 })
        .hits.slice(-1)[0].keptBy, 'tail', '原版必须保尾');
});
test('D3 ★★★ 破坏「改版判需确认」⇒ C2/B5 同款判据必转红（旧锚点静默错位）', async () => {
    const dir = breakCopy(KERNEL_REL, '    if (bkHash !== exHash) {', '    if (false) {');
    const M = await loadKernel(dir, 'd3');
    const chs = [{ title: '甲', paragraphs: ['第一段文字'] }];
    const rev = M.checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h1', chapter: 0, para: 0 },
        { id: 'b1', contentHash: 'h2', chapters: chs });
    assert.equal(rev.needsConfirm, false,
        '★★★ 破坏副本：改版不再判需确认 ⇒ 用户点回跳会落在别的段上，界面一声不响');
    assert.equal(K.checkExcerptAnchor({ text: '第一段文字', bookId: 'b1', bookHash: 'h1', chapter: 0, para: 0 },
        { id: 'b1', contentHash: 'h2', chapters: chs }).needsConfirm, true, '原版必须提示');
});
test('D4 ★★★ 破坏「批注与原文分格」⇒ B6 同款判据必转红（解释被当成原文）', async () => {
    const dir = breakCopy(KERNEL_REL, '        text: trimStr(e.text),',
        '        text: trimStr(e.text) + normalizeAnnotation(e.annotation),');
    const M = await loadKernel(dir, 'd4');
    const n = M.excerptNoteOf({ text: '原文一句', annotation: '我的解释' });
    assert.equal(n.text, '原文一句我的解释',
        '★★★ 破坏副本：批注被拼进原文那一格 ⇒ 日后引用时「我的解释」会当成书里的话');
    assert.equal(K.excerptNoteOf({ text: '原文一句', annotation: '我的解释' }).text, '原文一句', '原版必须分格');
});
test('D5 ★★★ 破坏「摘录自动钉指纹」⇒ C1 同款判据必转红（旧摘录永远无从比对）', async () => {
    const dir = breakCopy(APP_REL, '            if (bk && bk.contentHash) e.bookHash = bk.contentHash;', '            void bk;');
    const m = await loadApp(dir, 'd5');
    const app = appOf(m);
    const bid = seedBook(app, 'rd_d5', 'hA', findBook());
    app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, chapter: 2, para: 0 });
    assert.equal(app.getExcerpts()[0].bookHash, '',
        '★★★ 破坏副本：摘录不再钉指纹 ⇒ 每一条新摘录日后都判「需确认」（一批本该已核对的条目全需人工确认）');
    const app2 = mkApp(mkStorage());
    const bid2 = seedBook(app2, 'rd_d5b', 'hA', findBook());
    app2.addExcerpt({ text: '结尾章唯一一句', bookId: bid2, chapter: 2, para: 0 });
    assert.equal(app2.getExcerpts()[0].bookHash, 'hA', '原版必须自动钉上');
});
test('D6 ★★★ 破坏「需确认不跳」⇒ C3 同款判据必转红（点回跳落在别的段上）', async () => {
    const dir = breakCopy(VIEW_REL, '        if (a && a.needsConfirm) {', '        if (false) {');
    const m = await loadApp(dir, 'd6');
    const V = await loadView(dir, 'd6v');
    const app = appOf(m);
    const bid = seedBook(app, 'rd_d6', 'hOLD', findBook());
    app.addExcerpt({ text: '结尾章唯一一句', bookId: bid, chapter: 2, para: 0 });
    app.data.getBook(bid).contentHash = 'hNEW';
    let opened = 0;
    app.openBook = async () => { opened += 1; return true; };
    const view = new V.ReadingView(app);
    const r = await view.gotoExcerpt(app.getExcerpts()[0].id);
    assert.equal(r.ok, true, '★★★ 破坏副本：需确认照跳 ⇒ 用户以为自己回到了原文，其实落在另一段');
    assert.equal(opened, 1, '★★★ 破坏副本：书被打开了');
    /* 原版必须停住 */
    const app0 = mkApp(mkStorage());
    const bid0 = seedBook(app0, 'rd_d6b', 'hOLD', findBook());
    app0.addExcerpt({ text: '结尾章唯一一句', bookId: bid0, chapter: 2, para: 0 });
    app0.data.getBook(bid0).contentHash = 'hNEW';
    let opened0 = 0;
    app0.openBook = async () => { opened0 += 1; return true; };
    const r0 = await new VIEW.ReadingView(app0).gotoExcerpt(app0.getExcerpts()[0].id);
    assert.equal(r0.why, 'anchor-needs-confirm');
    assert.equal(opened0, 0);
});
test('D7 ★★★ 破坏「标签去重」⇒ B6 同款判据必转红（同一批标签反复堆叠）', async () => {
    const dir = breakCopy(KERNEL_REL, '        if (out.indexOf(t) >= 0) continue;', '        void 0;');
    const M = await loadKernel(dir, 'd7');
    assert.deepEqual(M.normalizeNoteTags(['甲', '甲', '甲']), ['甲', '甲', '甲'],
        '★★★ 破坏副本：重复标签照收 ⇒ 列表里同名标签会一份份堆起来（上限还更容易被占满）');
    assert.deepEqual(K.normalizeNoteTags(['甲', '甲', '甲']), ['甲'], '原版必须去重');
});
test('D8 ★★★ 破坏「换会话作废视图现场」⇒ C4 同款判据必转红（旧读数画进新会话）', async () => {
    const anchor = '        try { this.view?.onChatChanged?.(); } catch (_e) { /* 单屏作废失败不影响数据层重绑 */ }';
    const dir = breakCopy(APP_REL, anchor, '        void this.view;');
    const m = await loadApp(dir, 'd8');
    const V = await loadView(dir, 'd8v');
    const app = appOf(m);
    seedBook(app, 'rd_d8', 'hA', findBook());
    const view = app.view;
    view._findQuery = '他说';
    view._findRes = { ok: true, hits: [{}], totalHits: 1 };
    app.onChatChanged();
    assert.equal(view._findQuery, '他说',
        '★★★ 破坏副本：换会话不作废现场 ⇒ 新会话首屏画着上一会话的命中（不报错，只是错数据）');
    /* 原版必须作废 */
    const app0 = mkApp(mkStorage());
    seedBook(app0, 'rd_d8b', 'hA', findBook());
    const v0 = app0.view;
    v0._findQuery = '他说';
    v0._findRes = { ok: true, hits: [{}], totalHits: 1 };
    app0.onChatChanged();
    assert.equal(v0._findQuery, '', '原版必须作废');
    assert.equal(v0._findRes, null);
});

/* ══════════ F ── 数据层回归（既有字段不许被这次新增挤掉） ══════════ */
test('F1 新增三格不得挤掉既有摘录字段，也不得把 id 前缀叠成两层', async () => {
    const D = await import(pathToFileURL(path.join(ROOT, DATA_REL)).href);
    const a = D.normalizeExcerpt({ text: ' x ', bookId: 'b1', bookTitle: '书', chapter: 2, para: 7, chapterTitle: '第三章', createdAt: 5 });
    assert.equal(a.text, 'x');
    assert.equal(a.bookId, 'b1');
    assert.equal(a.bookTitle, '书');
    assert.equal(a.chapter, 2);
    assert.equal(a.para, 7);
    assert.equal(a.chapterTitle, '第三章');
    assert.equal(a.createdAt, 5);
    assert.equal(a.bookHash, '', '缺省指纹必须是空串（不是 undefined）');
    assert.equal(a.annotation, '');
    assert.deepEqual(a.tags, []);
    assert.match(a.id, /^ex_/);
    /* 幂等：二次净化不得把前缀再叠一层（备份导出后读回就会走第二遍）。 */
    const b = D.normalizeExcerpt(a);
    assert.equal(b.id, a.id, '★ 二次净化 id 必须不变（前缀只加一次）');
    assert.equal(D.normalizeExcerpt({ text: '有字', bookId: 'b1' }), null, '窄口不得放宽：章段索引不完整仍不收');
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
        '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0,
        'index.js 版本常量必须同源');
});
