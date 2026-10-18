/* ========================================================
 * 阅读 (Reading) App — 应用控制器
 * 纯本地 TXT 阅读器；导入/解析/章节/进度全在本机
 * ======================================================== */
'use strict';
import { ReadingData, decodeTxtArrayBuffer, parseTxtContent, contentHashOf, normalizeExcerpt, normalizeExcerptList } from './reading-data.js';
import { ReadingView } from './reading-view.js';
/* [第三期 R3-X8] 正文的本地附件层:重启续读的落地处(indexedDB,不进 chatMetadata/提示词)。
 *   宿主存储边界的实测读数见该文件档头(真 SillyTavern 1.19.0:localStorage 仅 4MB、
 *   indexedDB 可用、/api/files/upload 在场但无可枚举列表面)。 */
import {
    putBookBody, getBookBody, relinkBookBody, removeBookBody, listBookBodies,
    ATTACHMENT_STATES, attachmentLine
} from './reading-attachment.js';
/* [v4.21.0 · R4-O9] 书库随备份搬走:四段(书架/正文/摘录/进度)一起走。
 *   为什么不能靠 config/data-backup.js:那个面只认 storage 键,而**正文在 indexedDB**
 *   —— 修前实测后果就是「书目搬走了、书是空的」。本模块只做纯判定,落地仍在本件。 */
import {
    refsOf, buildLibraryPack, textToChapters, libraryPackLine, libraryScanLine,
    readLibraryPack, planLibraryImport, commitLibraryImport, undoLibraryImport,
    libraryPlanLine, LIB_ENTRY_STATES, librarySelfCheck,
} from '../../config/library-backup.js';
/* [v4.24.0 · R4-X8] 阅读研究笔记与全文找句(纯契约)。
 *   本件只做接线:**索引、锚点核对、批注归一、清单汇总全在那件里**(同一口径只许一份实现)。
 *   索引**不落盘**:每次由当前章节数组现建(计划原文「只增本地可重建索引」)。 */
import {
    normalizeAnnotation, normalizeNoteTags,
    buildSearchIndex, searchInBook, searchLine, checkExcerptAnchor, anchorLine,
    buildResearchList, notesSelfCheck,
} from '../../config/reading-notes-contract.js';
/* [v4.25.0 · R4-X3] 可阅读、可编辑的故事年鉴(纯契约)。
 *   本件只做接线:**建章册 / 两版 / 编辑草稿 / 过期判定 / 成稿 / 按进度裁阅读版 / 导出**
 *   全在那件里(同一口径只许一份实现)。去剧透**不走本件**——它一律走上游
 *   `storyAnnualForPlayer`(它的 gate 由宿主装配),本件不自己判秘密。 */
import {
    saOutletProbe, planSaOutlet,
    readAnnualBuild, readAnnualTwoVersions, readAnnualEdit, readAnnualStale, readAnnualCompose,
    readingVersionOf, coverOf, tocOf, exportTextOf,
    bookLine, versionsLine, saSelfCheck, SA_OUTLETS,
} from '../../config/story-annual-contract.js';
/* [v4.25.0 · R4-X3] 年鉴阅读进度键(**逐字常量**:keys 门的抽取器认这一形态)。 */
const READING_ANNUAL_PROGRESS_KEY = 'ruby_reading_annual_readthrough';

export class ReadingApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.data = new ReadingData(storage);
        this.view = new ReadingView(this);
        // 内存中的书籍正文缓存: id -> { chapters }
        this._contentCache = new Map();
        /* [第三期 R3-X8] 最近一次导入的 Promise：视图/测试/诊断可 await 到「真的导完了」。 */
        this._lastImport = null;
        this.EXCERPT_KEY = 'ruby_reading_excerpts';
        this._loadExcerpts();
    }

    /* [第三期 R3-X8] 正文落本地附件(indexedDB)。失败**不影响本次阅读**(内存里还有),
     *   但必须让读者知道「重启后这本书要重新导入」—— 这正是修前每本书的默认结局。 */
    _persistBody(bookId, title, hash, chapters) {
        try {
            return putBookBody(this._hostWin(), {
                bookId: bookId, title: title, contentHash: hash, chapters: chapters
            }).then((r) => {
                if (r && r.state !== ATTACHMENT_STATES.OK) {
                    this.phoneShell?.showNotification?.('阅读', '正文未能存入本机附件(重启后需重新导入):' + (r.text || ''), '⚠️');
                }
                return r;
            }).catch(() => null);
        } catch (_e) { return Promise.resolve(null); }
    }
    /** 宿主 window(读 indexedDB 用;无头测试可直接传 undefined)。 */
    _hostWin() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /* ══════════ [v4.25.0 · R4-X3] 可阅读、可编辑的故事年鉴 ══════════
     * 【本段只做接线:建章册 / 两版 / 编辑 / 过期 / 成稿 / 裁阅读版 / 导出全在
     *   config/story-annual-contract.js】—— 同一口径只许一份实现。
     * 【不做什么(计划「不做」原文)】
     *   · **不新增摘要引擎**:四要素与成稿全部是上游给的,本段只搬不生成;
     *   · **不以关键词去八股计数声称文风优秀**:`compose` 的样稿读数原样搬,
     *     未过真实模型一律报结构成稿(内核 `styleNote` 已写明);
     *   · **不自动外网发布**:本段零 fetch / XHR,导出的是一份本地 .txt;
     *   · **不把年鉴写进剧情事实**:草稿落本机(编辑缓冲)与导出文件,不写记忆/正文。
     * 【跨仓分工】去剧透一律走上游 `storyAnnualForPlayer`(gate 由宿主装配);
     *   手机只按**本机阅读进度**裁阅读版(`readingVersionOf`)。
     * ------------------------------------------------------------------ */
    /** 年鉴面探测与派发相(出口名只在契约件里出现,本件不写第二份)。 */
    annualFace() {
        const probe = saOutletProbe(this._hostWin());
        return { probe: probe, outlet: planSaOutlet(probe.hasBuild, probe.hasEdit) };
    }
    /** 建章册(**只读**)。未接插件时如实报「插件不在场」,不编空章册冒充。 */
    annualBook() {
        return readAnnualBuild(this._hostWin(), null, {});
    }
    /** 章册一行读数(视图借用;判据全在内核 `bookLine`)。 */
    annualBookLine() { return bookLine(this.annualBook()); }
    /** 两版归一(作者全知版 + 走 `storyAnnualForPlayer` 的阅读版)。 */
    annualTwoVersions(rev, opts) { return readAnnualTwoVersions(this._hostWin(), rev, opts || {}); }
    /** 两版一行读数(去剧透未成立时说清「不回退作者版」)。 */
    annualVersionsLine(tv) { return versionsLine(tv); }
    /** 编辑草稿(**只走上游出口**;事实位拒收由上游判,本件如实搬 changed/rejected)。 */
    annualEdit(state, patch) { return readAnnualEdit(this._hostWin(), state, patch || {}); }
    /** 过期判定(原文改动 ⇒ 逐条具名 staleRefs;过期 ≠ 删除)。 */
    annualStale(oldChapters, newPayload) { return readAnnualStale(this._hostWin(), oldChapters, newPayload); }
    /** 章节成稿(未给真模型 ⇒ structure-only,本件不把它读成「文风通过」)。 */
    annualCompose(rev, opts) { return readAnnualCompose(this._hostWin(), rev, opts || {}); }
    /** 按当前进度裁阅读版(**本机进度**:读到第几章,其后的章只留占位)。 */
    annualReadingVersion(chapters, readThrough) {
        return readingVersionOf(chapters, { readThrough: readThrough });
    }
    /** 封面(只从已读章取;未读章的标题/摘要/要素一个都不出现)。 */
    annualCover(version, opts) { return coverOf(version, opts || {}); }
    /** 目录(未读章只留章号占位)。 */
    annualToc(version) { return tocOf(version); }
    /** 导出为**离线可读**的本地文本(不联网、不上传)。 */
    annualExportText(version, opts) { return exportTextOf(version, opts || {}); }
    /** 本机年鉴阅读进度(读到第几章;**读不出返回 null,不编 0**)。 */
    annualReadThrough() {
        try {
            const v = this.storage?.get?.(READING_ANNUAL_PROGRESS_KEY, null);
            if (v === null || v === undefined || v === '') return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        } catch (_e) { return null; }
    }
    /** 记本机年鉴阅读进度(0 是合法值 —— 章号从 1 起,0 表示「还没读到任何一章」)。 */
    setAnnualReadThrough(n) {
        const num = Number(n);
        if (!Number.isFinite(num) || num < 0) return { ok: false, why: 'invalid' };
        try {
            this.storage?.set?.(READING_ANNUAL_PROGRESS_KEY, String(Math.floor(num)));
            return { ok: true, readThrough: Math.floor(num) };
        } catch (_e) { return { ok: false, why: 'write-threw' }; }
    }
    /** 内核自检的**真消费点**(视图/诊断可随时读一次)。 */
    annualSelfCheck() {
        try { return saSelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], states: 0, outlets: 0, limits: 0 }; }
    }
    /** [第三期 R3-X8] 删书 = 书架条目 + 正文附件一起删(附件层不许留孤儿)。 */
    removeBook(bookId) {
        const id = String(bookId || '').trim();
        if (!id) return false;
        this.data.removeBook(id);
        this._contentCache.delete(id);
        try { removeBookBody(this._hostWin(), id).catch(() => null); } catch (_e) { /* 附件删不掉不阻塞书目删除 */ }
        return true;
    }
    /** [第三期 R3-X8] 本机附件盘库读数(视图用;五态各占一格)。 */
    async listBodies() {
        try { return await listBookBodies(this._hostWin()); }
        catch (_e) { return { state: ATTACHMENT_STATES.UNAVAILABLE, books: [], count: 0, text: attachmentLine({}) }; }
    }

    /* ══════════ [v4.21.0 · R4-O9] 书库随备份搬走(四段:书架/正文/摘录/进度) ══════════
     * 【本段只做「盘库 → 打包 → 计划 → 落盘」四步,判定全在 config/library-backup.js】
     * 【不做什么(计划「不做」原文)】
     *   · **不静默下载外链图片**:本段没有任何网络调用,也不去取书中引用的远端资源;
     *   · **不上传云端**:本段没有 fetch / XMLHttpRequest;
     *   · 不在导入前动现有数据:计划阶段只读,写入只在 commitLibrary() 里发生。
     * ------------------------------------------------------------------ */

    /** 四段现读:书架条目(本机) + 正文元数据(附件层,不含正文本体) + 摘录 + 进度。 */
    async scanLibrary() {
        let bodies = [];
        try {
            const r = await this.listBodies();
            bodies = Array.isArray(r && r.books) ? r.books : [];
        } catch (_e) { bodies = []; }
        const progress = [];
        for (const b of this.data.getBooks()) {
            const p = this._readProgressRow(b.id);
            if (p) progress.push(p);
        }
        const refs = refsOf({
            shelf: this.data.getBooks(),
            bodies: bodies,
            excerpts: this.getExcerpts(),
            progress: progress,
        });
        this._libraryRefs = refs;
        return refs;
    }

    /** 读一本书的进度行(读不出 ⇒ null,**不补 0**:0 是合法首段,与「没记过」语义不同)。 */
    _readProgressRow(bookId) {
        try {
            const raw = this.storage?.get?.('ruby_reading_progress_' + bookId);
            if (!raw) return null;
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!p || typeof p !== 'object') return null;
            const ch = Number(p.chapter);
            if (!Number.isFinite(ch)) return null;
            const para = Number(p.para);
            return { bookId: String(bookId), chapter: ch, para: Number.isFinite(para) ? para : 0 };
        } catch (_e) { return null; }
    }

    /**
     * 导出一份书库包(四段一起走)。
     *   正文从**附件层**取全文(逐本 readBookBodyText),取不到就如实记为「包里没有这本的正文」——
     *   绝不拿书名或元数据冒充正文(修前的病正是「元数据 ≠ 附件」)。
     * @returns {Promise<{ok:boolean, pack:object|null, line:string, scanLine:string, note:string, missing:string[]}>}
     */
    async exportLibrary() {
        const refs = await this.scanLibrary();
        const bodies = [];
        const missing = [];
        for (const b of refs.books) {
            if (b.refs.body.state !== 'linked') { missing.push(b.bookId); continue; }
            let got = null;
            try { got = await getBookBody(this._hostWin(), b.bookId); } catch (_e) { got = null; }
            if (got && got.state === ATTACHMENT_STATES.OK && Array.isArray(got.chapters) && got.chapters.length) {
                bodies.push({ bookId: b.bookId, contentHash: b.contentHash, chapters: got.chapters });
            } else {
                missing.push(b.bookId);
            }
        }
        const pack = buildLibraryPack({
            hostVersion: String(this.storage?.version || ''),
            at: Date.now(), source: 'local',
            books: this.data.getBooks(),
            bodies: bodies,
            excerpts: this.getExcerpts(),
            progress: refs.books.filter(function (b) { return b.progress; }).map(function (b) {
                return { bookId: b.bookId, chapter: b.progress.chapter, para: b.progress.para };
            }),
        });
        this._libraryPack = pack;
        return {
            ok: true, pack: pack,
            line: libraryPackLine(pack),
            scanLine: libraryScanLine(refs),
            note: missing.length
                ? ('有 ' + String(missing.length) + ' 本取不到正文,已如实记为未包含(不拿书目冒充正文)')
                : '四段齐:书架 / 正文 / 摘录 / 进度',
            missing: missing,
        };
    }

    /**
     * 产导入计划(**只读,不改任何现有数据**)。
     * @returns {Promise<{ok:boolean, kind:string, plan:object|null, line:string, note:string}>}
     */
    async planLibraryImportOf(rawPack, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        /* [v4.21.0 · R4-O9] 包可能是**从文件里读出来的字符串**(用户把 .json 从旧设备拷过来):
         *   先解析;解析不了就**原样交给读包口**去记「空包 / 不是对象」——
         *   在这里抛出去只会变成一句「导入崩了」,而用户该看到的是「这份包读不出来」。 */
        let raw = (rawPack === undefined || rawPack === null || rawPack === '') ? this._libraryPack : rawPack;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = null; }
        }
        const read = readLibraryPack(raw);
        if (!read.accepted || !read.pack) return { ok: false, kind: read.state, plan: null, line: '', note: '包不可用:' + read.why };
        let bodies = [];
        try {
            const r = await this.listBodies();
            bodies = Array.isArray(r && r.books) ? r.books : [];
        } catch (_e) { bodies = []; }
        const plan = planLibraryImport(read.pack, {
            shelf: this.data.getBooks().map(function (b) { return { id: b.id, contentHash: b.contentHash }; }),
            bodyIds: bodies.map(function (b) { return b.bookId; }),
            tombstones: Array.isArray(this._libraryTombstones) ? this._libraryTombstones : [],
        }, { onConflict: o.onConflict, allowPartial: o.allowPartial === true, selection: o.selection });
        this._libraryPlan = plan;
        this._libraryRead = read;
        return { ok: true, kind: 'planned', plan: plan, line: libraryPlanLine(plan, null), note: '导入前不改现有数据' };
    }

    /**
     * 落盘(四段各自写口)。**只有这一步动数据**。
     *   · 书架条目:替换成包里那本(指纹与书名);附件层另有正文写口;
     *   · 摘录:按 bookId 过滤旧条目后并回(不重复);
     *   · 进度:只在包里带着这一本的进度时才写。
     * @returns {Promise<{ok:boolean, kind:string, note:string, counts:object, undo:object|null}>}
     */
    async commitLibrary(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const plan = this._libraryPlan;
        if (!plan) return { ok: false, kind: 'no-plan', note: '还没有导入计划(先预演一次)', counts: {}, undo: null };
        const commit = commitLibraryImport(plan, { onConflict: o.onConflict });
        const read = this._libraryRead;
        const pack = read && read.pack ? read.pack : null;
        if (!pack) return { ok: false, kind: 'no-pack', note: '包不可用', counts: {}, undo: null };
        const bodyById = new Map();
        for (const b of (Array.isArray(pack.bodies) ? pack.bodies : [])) {
            const id = String((b && b.bookId) || '').trim();
            if (id) bodyById.set(id, b);
        }
        let shelfWrote = 0;
        let bodyWrote = 0;
        let bodyFailed = 0;
        const bodyFailedIds = [];
        const progressWrote = [];
        const shelfIds = new Set(commit.shelfWrites.map(function (w) { return String(w.bookId); }));
        const bodyNeedIds = new Set(commit.bodyWrites.map(function (w) { return String(w.bookId); }));
        const excerptIds = new Set(commit.excerptWrites.map(function (w) { return String(w.bookId); }));
        const progressIds = new Set(commit.progressWrites.map(function (w) { return String(w.bookId); }));
        const packBooks = Array.isArray(pack.books) ? pack.books : [];
        /* ★★ 落盘秩序是**逐书**的,且**正文先落、书架后认领**(探针 v2 实测抓到的第二处真缺陷):
         *   修前先大循环把书架条目全落下,再大循环写正文 —— 配额一满(正文一本都没写进去)时,
         *   新机器上留下的正是**两本打不开的书**:书目在、正文不在,点开一句「正文取不到」。
         *   那与本项要治的病是同一件事,只是换了边(修前是「书目搬走了书是空的」)。
         *   改后:正文写进去了才认领这一本的书架条目/进度/摘录;写不进去的那本**一个字都不落下**。
         *   为什么按「书」为单位而不是按四段各自大循环:四段属于同一本书,
         *   任何一段漏掉都会留下半吊子条目,分段大循环表达不了「这一本整体成败」。 */
        const order = [];
        const pushId = function (w) {
            const id = String((w && w.bookId) || '');
            if (id && order.indexOf(id) < 0) order.push(id);
        };
        commit.bodyWrites.forEach(pushId);
        commit.shelfWrites.forEach(pushId);
        commit.excerptWrites.forEach(pushId);
        commit.progressWrites.forEach(pushId);
        const landed = new Set();
        for (const id of order) {
            const bk = packBooks.filter(function (x) { return String(x.bookId) === id; })[0] || null;
            const b = bodyById.get(id) || null;
            const needBody = bodyNeedIds.has(id) && !!b && typeof b.text === 'string';
            if (needBody) {
                const chapters = textToChapters(b.text);
                let r = null;
                try {
                    r = await putBookBody(this._hostWin(), { bookId: id, title: b.title, contentHash: b.contentHash, chapters: chapters });
                } catch (_e) { r = null; }
                if (r && r.state === ATTACHMENT_STATES.OK) {
                    bodyWrote += 1;
                    this._contentCache.set(id, chapters);
                } else {
                    bodyFailed += 1;
                    bodyFailedIds.push(id);
                    /* ★ 这一本到此为止:正文没落成 ⇒ 书架条目/进度/摘录一律不写。 */
                    continue;
                }
            }
            if (shelfIds.has(id) && bk) {
                this.data.adoptBook({
                    id: id, title: bk.title, fileName: bk.fileName,
                    contentHash: bk.contentHash, format: bk.format,
                    chapterCount: (b ? textToChapters(b.text).length : 0),
                });
                shelfWrote += 1;
            }
            if (progressIds.has(id) && bk && bk.progress) {
                try {
                    this.storage?.set?.('ruby_reading_progress_' + id, JSON.stringify({
                        chapter: Number(bk.progress.chapter) || 0,
                        para: Number(bk.progress.para) || 0,
                        fontPx: 16, theme: 'parchment',
                    }));
                    progressWrote.push(id);
                } catch (_e) { /* 单本进度写失败如实计入未成 */ }
            }
            landed.add(id);
        }
        /* 摘录并回:**只并回「落成了」的那几本**(bookId 取计划 ∩ landed)。
         *   为什么不能拿包里的摘录全量并回(修前就是那样写的,探针 v1 当场抓到):包里的书可能
         *   **整本被拒收**(缺正文不写),若摘录照并,新机器上就会出现「指着一段不存在的正文」
         *   的摘录条目 —— 而摘录的全部价值就是回跳定位。写口必须与计划同一个源。
         *   同 bookId 的旧条目先过滤掉(重复导入不重复),再并入。 */
        const writeIds = new Set([...excerptIds].filter(function (id) { return landed.has(id); }));
        const packEx = (Array.isArray(pack.excerpts) ? pack.excerpts : []).filter(function (e) {
            return writeIds.has(String(e && e.bookId));
        });
        if (writeIds.size) {
            const kept = this.getExcerpts().filter(function (e) { return !writeIds.has(String(e.bookId)); });
            this.excerpts = kept.concat(packEx).slice(0, 200);
            this._saveExcerpts();
        }
        const undo = undoLibraryImport(commit);
        this._libraryUndo = undo;
        const counts = {
            shelf: shelfWrote, bodies: bodyWrote, bodyFailed: bodyFailed,
            excerpts: writeIds.size ? packEx.length : 0,
            progress: progressWrote.length,
            skipped: commit.skipped.length,
            bodyFailedIds: bodyFailedIds.slice(),
        };
        const wrote = shelfWrote + bodyWrote + progressWrote.length + (writeIds.size ? packEx.length : 0);
        /* 一行都没写时必须**换个 kind**:全拒收(缺正文)与真的导入完是两件事,
         *   压成同一句话会让界面把「一本书都没进来」显示成「导入成功」。 */
        const kind = bodyFailed ? 'partial' : (wrote ? 'committed' : 'nothing-to-write');
        let note = kind === 'nothing-to-write'
            ? ('这次没有写进任何东西' + (commit.skipped.length ? ('（' + String(commit.skipped.length) + ' 本被跳过:' + String((commit.skipped[0] && commit.skipped[0].why) || '') + '）') : ''))
            : ('已写 书架 ' + String(shelfWrote) + ' / 正文 ' + String(bodyWrote)
                + (bodyFailed ? ('（**' + String(bodyFailed) + ' 本正文没写进去,那 ' + String(bodyFailed) + ' 本一个字都没落下**）') : '')
                + ' / 摘录 ' + String(counts.excerpts) + ' / 进度 ' + String(counts.progress));
        if (commit.skipped.length) note += ' ｜ 跳过 ' + String(commit.skipped.length) + ' 本';
        return { ok: bodyFailed === 0 && kind !== 'nothing-to-write', kind: kind, note: note, counts: counts, undo: undo };
    }

    /** 撤销本次导入(只撤本次写入:正文与书架条目都撤)。 */
    async undoLibrary() {
        const undo = this._libraryUndo;
        if (!undo || !undo.count) return { ok: false, kind: 'nothing-to-undo', note: '本次没有可撤的写入' };
        let done = 0;
        let missed = 0;
        for (const u of undo.undo) {
            try {
                if (u.action === 'remove-body') {
                    /* 删除结果**要读**：附件层会如实给 face（denied / writer-error / 无库…），
                     *   删不掉时不能计成撤成 —— 否则用户再也不会去看附件层。 */
                    const r = await removeBookBody(this._hostWin(), u.bookId);
                    if (r && r.state === ATTACHMENT_STATES.OK && r.removed) done += 1; else missed += 1;
                }
                else if (u.action === 'remove-book') { this.data.removeBook(u.bookId); this._contentCache.delete(u.bookId); done += 1; }
                else { missed += 1; }
            } catch (_e) { missed += 1; /* 单本失败如实计入未成（注释说不算成功，就得真不算） */ }
        }
        this._libraryUndo = null;
        /* ★ 未成/未知动作**如实报**，不计入成功：修前这里把任何非 remove 动作 done+1，
         *   于是「内核给了一个 App 不认识的正文动作」会显示成「已撤销 4 / 4 项」而附件仍在。 */
        return {
            ok: done === undo.count && missed === 0,
            kind: missed ? 'partial' : 'undone',
            note: '已撤销 ' + String(done) + ' / ' + String(undo.count) + ' 项'
                + (missed ? ('（另有 ' + String(missed) + ' 项未成或未知动作 —— 如实报告，不计入成功）') : ''),
        };
    }

    /**
     * [v4.21.0 · R4-O9] 删附件**之前**先列清「哪些书架项引用了它」。
     *   为什么要有这一口:附件层是**本机**存储,删掉就没了;而引用它的不止书架条目 ——
     *   进度键与摘录条目都按 bookId 指过来。用户在删之前有权看到这份账,
     *   而不是删完之后发现「进度没了、摘录还指着一段不存在的正文」。
     * @returns {Promise<{book:object|null, excerpts:number, hasProgress:boolean, line:string}>}
     */
    async bodyRefsOf(bookId) {
        const id = String(bookId == null ? '' : bookId).trim();
        if (!id) return { book: null, excerpts: 0, hasProgress: false, line: '没给书标识,列不出引用' };
        const book = this.data.getBook(id);
        const excerpts = this.getExcerpts().filter(function (e) { return String(e && e.bookId) === id; });
        const progress = this._readProgressRow(id);
        const bits = ['书架条目:' + (book ? ('《' + (book.title || '未命名') + '》') : '**没有**(正文孤儿)')];
        bits.push('摘录引用:' + String(excerpts.length) + ' 条');
        bits.push('进度记录:' + (progress ? ('第 ' + String(progress.chapter + 1) + ' 章') : '没有'));
        if (!book) bits.push('★ 没有任何书架项引用它:这是删书漏删留下的孤儿正文');
        return { book: book, excerpts: excerpts.length, hasProgress: !!progress, line: bits.join(' · ') };
    }

    /** 内核自检的**真消费点**:视图/诊断可随时读一次,而不是只把自检挂在导出面上。 */
    librarySelfCheck() {
        try { return librarySelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], sections: 0, schema: 0, unincluded: 0 }; }
    }

    /** 一行读数(导出前那一屏;没盘过就是「还没盘过」,**不报 0**)。 */
    libraryLine() {
        const refs = this._libraryRefs;
        if (!refs) return '书库还没盘过(点「扫描书库」即可)';
        let s = libraryScanLine(refs);
        if (this._libraryPack) s += ' ｜ 已导出:' + libraryPackLine(this._libraryPack);
        return s;
    }

    onChatChanged() {
        // [v2.23.0] 换会话重绑:重建数据层从新会话键重新载入。
        //   保留实例与构造期注册的常驻监听器,避免重建实例导致监听器累积。
        this.data = new ReadingData(this.storage);
        this._loadExcerpts();
        /* [v4.24.0 · R4-X8] 视图那一屏的**现场**也要作废：查找命中 / 锚点读数 / 批注草稿
         *   全指着上一会话的书与摘录。只重读书架不清现场，新会话首屏就会画出上一场的读数。 */
        try { this.view?.onChatChanged?.(); } catch (_e) { /* 单屏作废失败不影响数据层重绑 */ }
        /* [第三期 R3-X8] 附件层是**本机**存储,不随会话走:换会话只重读书架,
         *   不清正文附件(那是读者的本机书库,不是这个会话的状态)。 */
    }
    /* [v3.99.2 · R3-X8] 摘录存取（会话隔离键，列表净化走纯函数窄口）。 */
    _loadExcerpts() {
        try {
            const raw = this.storage?.get?.(this.EXCERPT_KEY);
            this.excerpts = normalizeExcerptList(typeof raw === 'string' ? JSON.parse(raw) : raw);
        } catch (e) { this.excerpts = []; }
    }
    _saveExcerpts() {
        try { this.storage?.set?.(this.EXCERPT_KEY, JSON.stringify(this.excerpts)); } catch (e) { /* 忽略 */ }
    }
    addExcerpt(entry) {
        const e = (entry && typeof entry === 'object') ? Object.assign({}, entry) : {};
        /* [v4.24.0 · R4-X8] **摘录必须钉住当时那本书的指纹**：调用方没给就从书架条目补。
         *   为什么不交给调用方自己填:视图、导入并回、备份恢复三条路径都会造摘录,
         *   只要有一条忘了带 bookHash,那条摘录日后就永远判成 UNPINNED —— 锚点核对当场失效。
         *   补不出(书不在书架)就**如实留空**,由锚点核对判「需确认」,不编一个指纹。 */
        if (!e.bookHash && e.bookId) {
            const bk = this.data.getBook(String(e.bookId));
            if (bk && bk.contentHash) e.bookHash = bk.contentHash;
        }
        const n = normalizeExcerpt(e);
        if (!n) return { error: 'excerpt-invalid（缺正文或书/章/段引用不完整，不收）' };
        this.excerpts = normalizeExcerptList([n].concat(this.excerpts));
        this._saveExcerpts();
        return { ok: true, id: n.id, count: this.excerpts.length };
    }
    getExcerpts() { return this.excerpts.slice(); }
    /* ══════════ [v4.24.0 · R4-X8] 阅读研究笔记与全文找句 ══════════
     * 【本段只做接线与落地:索引 / 锚点核对 / 批注归一 / 清单汇总全在 config/reading-notes-contract.js】
     * 【不做什么(计划「不做」原文)】
     *   · **不再交付一次「摘录功能」**:摘录的采集与存储仍是上一条既有路径,本段只**读它**;
     *   · **不默认把笔记提升为剧情事实**:批注只落 `ruby_reading_excerpts` 这一格,
     *     不写任何记忆/世界书/对话键,也不往提示词里送;
     *   · **不建设云端知识管理平台**:本段没有网络调用,索引也**不落盘**(每次现场重建)。
     * ------------------------------------------------------------------ */
    /** 找一条摘录(取不到返回 null,**不按文本模糊匹配**)。 */
    findExcerpt(id) {
        const want = String(id == null ? '' : id);
        if (!want) return null;
        for (const e of this.excerpts) if (e && String(e.id) === want) return e;
        return null;
    }
    /**
     * 给一条摘录写**自己的解释与标签**。
     *   ★ 只动 `annotation` / `tags` 两格:**原文(`text`)与出处(`bookHash`/章/段)一律不改**
     *     ——「批注不是原文」不能只靠界面不显示,落盘时也得是两格。
     * @returns {{ok:boolean, id:string, note:object|null, error?:string}}
     */
    setExcerptNote(id, note, tags) {
        const e = this.findExcerpt(id);
        if (!e) return { ok: false, id: String(id || ''), note: null, error: 'excerpt-not-found（没有这条摘录）' };
        e.annotation = normalizeAnnotation(note);
        e.tags = normalizeNoteTags(tags === undefined ? e.tags : tags);
        this._saveExcerpts();
        return { ok: true, id: String(e.id), note: { annotation: e.annotation, tags: e.tags.slice() } };
    }
    /** 删一条摘录（只删这一条；**不动它引用的正文**）。 */
    removeExcerpt(id) {
        const want = String(id == null ? '' : id);
        const before = this.excerpts.length;
        this.excerpts = this.excerpts.filter(function (e) { return String(e && e.id) !== want; });
        if (this.excerpts.length === before) return { ok: false, count: before, error: 'excerpt-not-found（没有这条摘录）' };
        this._saveExcerpts();
        return { ok: true, count: this.excerpts.length };
    }
    /**
     * 一本书的**正文读数**（锚点核对与全书查找共用这一口）。
     *   正文优先取内存缓存,再取本机附件;两处都没有时**如实 `chapters:null`**
     *   —— 空章数组与「读不到正文」是两件事,前者是书真的空,后者是判不了。
     * @returns {Promise<{id:string, title:string, contentHash:string, chapters:Array|null, why:string}>}
     */
    async bookReadOf(bookId) {
        const id = String(bookId == null ? '' : bookId);
        const info = this.data.getBook(id);
        if (!info) return { id: id, title: '', contentHash: '', chapters: null, why: '不在书架上' };
        let chapters = this._contentCache.get(id) || null;
        if (!chapters) {
            try {
                const a = await getBookBody(this._hostWin(), id);
                if (a && a.state === ATTACHMENT_STATES.OK && Array.isArray(a.chapters) && a.chapters.length) {
                    chapters = a.chapters;
                    this._contentCache.set(id, chapters);
                }
            } catch (_e) { chapters = null; }
        }
        return {
            id: id, title: String(info.title || ''), contentHash: String(info.contentHash || ''),
            chapters: chapters, why: chapters ? 'ok' : '正文读不到（没存过附件 / 本环境没有附件层）',
        };
    }
    /**
     * 逐条核对摘录锚点（**改版书必须提示**）。
     * @param {string} [bookId] 只核这一本的摘录;不传即核全部
     * @returns {Promise<{rows:Array, counts:object, line:string}>}
     */
    async checkExcerptAnchors(bookId) {
        const only = String(bookId == null ? '' : bookId);
        const list = this.excerpts.filter(function (e) { return !only || String(e && e.bookId) === only; });
        const ids = [];
        for (const e of list) {
            const b = String(e && e.bookId);
            if (b && ids.indexOf(b) < 0) ids.push(b);
        }
        const reads = new Map();
        for (const b of ids) reads.set(b, await this.bookReadOf(b));
        const rows = [];
        let needsConfirm = 0;
        let settled = 0;
        let unverified = 0;
        for (const e of list) {
            const anchor = checkExcerptAnchor(e, reads.get(String(e.bookId)) || null);
            if (anchor.needsConfirm) needsConfirm += 1;
            else if (anchor.settled) settled += 1;
            else unverified += 1;
            rows.push({ id: String(e.id), bookId: String(e.bookId), anchor: anchor, line: anchorLine(anchor) });
        }
        const counts = {
            total: rows.length, needsConfirm: needsConfirm, settled: settled, unverified: unverified,
            books: ids.length,
        };
        let line = '锚点核对 ' + String(rows.length) + ' 条 · 已核对 ' + String(settled)
            + ' · 需确认 ' + String(needsConfirm) + ' · 未定论 ' + String(unverified);
        if (needsConfirm) line += ' ｜ **有 ' + String(needsConfirm) + ' 条的出处待你确认**（改版书 / 无指纹 / 错位 / 找不到）';
        if (unverified) line += ' ｜ 未定论的那 ' + String(unverified) + ' 条是正文没读到或只核了指纹,不算确认过';
        return { rows: rows, counts: counts, line: line };
    }
    /**
     * 全书找句（**扫全章**,末章命中与跨段命中都要能找到）。
     *   索引每次现建、用完即弃（计划落点原文:「只增本地**可重建**索引」）——
     *   落一份索引进存储就等于把全书正文复制了一份,那是「不把全书送进每轮提示词」的同一族违规。
     * @returns {Promise<object>} 与 `searchInBook` 同形（多一格 `book` 读数）
     */
    async searchBook(query, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const bookId = String(o.bookId == null ? '' : o.bookId);
        const cur = this.view && this.view.currentBook;
        const target = bookId || (cur && cur.id) || '';
        const read = await this.bookReadOf(target);
        const index = buildSearchIndex({
            id: read.id, title: read.title, contentHash: read.contentHash,
            chapters: read.chapters === null ? undefined : read.chapters,
        });
        const res = searchInBook(index, query, { limit: o.limit, caseSensitive: o.caseSensitive === true });
        res.book = { id: read.id, title: read.title, contentHash: read.contentHash, readable: read.chapters !== null, why: read.why };
        if (!index.ok && read.chapters === null) {
            res.reason = 'body-unreadable（' + read.why + '：**搜不了**,不是「书里没有」）';
        }
        return res;
    }
    /** 创作素材清单（原文与自己的解释**分列**;需确认的条目照样标出来）。 */
    researchList() {
        const books = this.data.getBooks().map((b) => ({
            id: b.id, title: b.title, contentHash: b.contentHash,
            chapters: this._contentCache.get(b.id) || undefined,
        }));
        return buildResearchList(this.excerpts, books);
    }
    /** 查找一行读数(视图借用;判据全在内核 `searchLine`,本件不另写一份)。 */
    searchLineOf(res) { return searchLine(res); }
    /** 内核自检的**真消费点**:视图/诊断可随时读一次,而不是只把自检挂在导出面上。 */
    notesSelfCheck() {
        try { return notesSelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], states: 0, confirmStates: 0, limits: 0 }; }
    }

    render() {
        if (!this.phoneShell?.screen) return;
        this.view.render();
    }

    // 从 File 对象导入（支持 TXT / EPUB）
    /* [第三期 R3-X8] **如实返回 Promise**：附件层是异步的（relink / persist），
     *   旧版这里返回 undefined，调用方只能靠「等一会儿」猜导入完没完 ——
     *   视图点完立刻 render 会读到旧书架，冒烟测试也会在回调前断言。
     *   现在 `await app.importFile(file)` 一定等到 currentBook 就位（或导入失败）。 */
    importFile(file) {
        const isEpub = /\.epub$/i.test(file.name || '');
        this._lastImport = isEpub ? this._importEpub(file) : this._importTxt(file);
        return this._lastImport;
    }

    _importTxt(file) {
        return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const { text, encoding } = decodeTxtArrayBuffer(buffer, 'auto');
                if (!text || !text.trim()) {
                    this.phoneShell?.showNotification?.('阅读', '文件为空或编码无法识别', '⚠️');
                    resolve(null);
                    return;
                }
                const parsed = parseTxtContent(text, file.name, 'auto');
                const book = {
                    title: parsed.title,
                    author: '',
                    format: 'txt',
                    chapters: parsed.chapters
                };
                // [v3.99.2 · R3-X8] 指纹重接：同一文件重新导入 ⇒ 回到原书（进度与摘录标记不丢）；
                //   同名不同文件 ⇒ 两本并存（不静默覆盖旧书）。
                const hash = contentHashOf(text);
                const reusable = this.data.findReusable(file.name, hash);
                const bookIdToUse = reusable ? reusable.id : null;
                const result = this.data.addBook(book, file.name, encoding, 'auto', { contentHash: hash });
                let finalId = bookIdToUse || result.bookId;
                /* [第三期 R3-X8] 丢附件后**重新定位**:同名同指纹的书在附件层若还留着旧条目,
                 *   按指纹把正文挂回原 bookId(进度键与摘录引用都指着旧 id,不动它们)。 */
                if (!reusable) {
                    try {
                        const re = await relinkBookBody(this._hostWin(), hash, result.chapters);
                        if (re && re.state === ATTACHMENT_STATES.OK && re.bookId) finalId = re.bookId;
                    } catch (_e) { /* 重定位失败不影响本次导入 */ }
                }
                // 缓存章节正文(供本次会话阅读;书架列表不存正文避免 chatMetadata 膨胀)
                this._contentCache.set(finalId, result.chapters);
                /* [第三期 R3-X8] 正文落本机附件:下一次开 App 不必重新导入。 */
                this._persistBody(finalId, result.title, hash, result.chapters);
                if (result.coexist) {
                    this.phoneShell?.showNotification?.('阅读', '书架上已有同名书（内容不同），两本并存', '📚');
                }
                if (bookIdToUse && result.coexist === false && result.replaced) {
                    this.phoneShell?.showNotification?.('阅读', '《' + result.title + '》重新导入，已回到原书进度与标记', '📖');
                }
                this.view.currentBook = {
                    id: finalId,
                    title: result.title,
                    author: '',
                    format: 'txt',
                    encoding,
                    mode: 'auto',
                    chapters: result.chapters
                };
                this.view.curChapter = 0;
                this.view._loadProgress(result.bookId);
                this.phoneShell?.showNotification?.('阅读', result.replaced ? `《${result.title}》已更新` : `《${result.title}》已上架`, '📖');
                this.render();
                resolve(this.view.currentBook || null);
            } catch (err) {
                console.error('❌ 阅读App导入失败:', err);
                this.phoneShell?.showNotification?.('阅读', '导入失败: ' + err.message, '❌');
                resolve(null);
            }
        };
        reader.onerror = () => { this.phoneShell?.showNotification?.('阅读', '文件读取失败', '❌'); resolve(null); };
        reader.readAsArrayBuffer(file);
        });
    }

    _importEpub(file) {
        return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                this.phoneShell?.showNotification?.('阅读', '正在解析 EPUB…', '⏳');
                const buffer = e.target.result;
                const { parseEpubFile } = await import('./reading-epub.js');
                const parsed = await parseEpubFile(buffer);
                const book = {
                    title: parsed.title,
                    author: parsed.author,
                    format: 'epub',
                    chapters: parsed.chapters
                };
                const hash = contentHashOf(parsed.chapters.map(c => (c.paragraphs || []).join('|')).join('#'));
                const reusable = this.data.findReusable(file.name, hash);
                const bookIdToUse = reusable ? reusable.id : null;
                const result = this.data.addBook(book, file.name, 'utf-8', 'auto', { contentHash: hash });
                let finalId = bookIdToUse || result.bookId;
                /* [第三期 R3-X8] 与 TXT 同一条重定位路径(同一份指纹口径)。 */
                if (!reusable) {
                    try {
                        const re = await relinkBookBody(this._hostWin(), hash, result.chapters);
                        if (re && re.state === ATTACHMENT_STATES.OK && re.bookId) finalId = re.bookId;
                    } catch (_e) { /* 重定位失败不影响本次导入 */ }
                }
                const finalIdFixed = finalId;
                this._contentCache.set(finalIdFixed, result.chapters);
                this._persistBody(finalIdFixed, result.title, hash, result.chapters);
                if (result.coexist) {
                    this.phoneShell?.showNotification?.('阅读', '书架上已有同名书（内容不同），两本并存', '📚');
                }
                this.view.currentBook = {
                    id: finalIdFixed,
                    title: result.title,
                    author: result.author,
                    format: 'epub',
                    encoding: 'utf-8',
                    mode: 'auto',
                    chapters: result.chapters
                };
                this.view.curChapter = 0;
                this.view._loadProgress(result.bookId);
                this.phoneShell?.showNotification?.('阅读', result.replaced ? `《${result.title}》已更新（${result.chapters.length}章）` : `《${result.title}》已上架（${result.chapters.length}章）`, '📚');
                this.render();
                resolve(this.view.currentBook || null);
            } catch (err) {
                console.error('❌ 阅读App EPUB导入失败:', err);
                this.phoneShell?.showNotification?.('阅读', 'EPUB导入失败: ' + err.message, '❌');
                resolve(null);
            }
        };
        reader.onerror = () => { this.phoneShell?.showNotification?.('阅读', '文件读取失败', '❌'); resolve(null); };
        reader.readAsArrayBuffer(file);
        });
    }

    // 打开书架中的一本书
    /* [第三期 R3-X8] 修前这里是「重启后一切打不开」的原点:正文只活在内存(_contentCache),
     *   重启后一律走「需重新导入」那句提示 —— 验收第一条(重启继续同章同位置)于是不成立。
     *   本版改为**先查内存、再查本机附件**:附件命中就恢复正文,由 _loadProgress 恢复同章同位置。
     *   附件也取不到时才如实告知需重新导入,并**说清是哪一种取不到**(没存过 / 本环境没有附件层)——
     *   压平成同一句话就会把「你的浏览器不支持」显示成「你从没导入过这本书」。 */
    async openBook(bookId) {
        const info = this.data.getBook(bookId);
        if (!info) return false;
        let chapters = this._contentCache.get(bookId);
        if (!chapters) {
            let attach = null;
            try { attach = await getBookBody(this._hostWin(), bookId); }
            catch (_e) { attach = null; }
            if (attach && attach.state === ATTACHMENT_STATES.OK
                && Array.isArray(attach.chapters) && attach.chapters.length) {
                chapters = attach.chapters;
                this._contentCache.set(bookId, chapters);
            } else {
                const why = (attach && attach.state === ATTACHMENT_STATES.EMPTY)
                    ? '本机附件里没有这本书的正文(可能被清理过)'
                    : '本机附件存储在本环境不可用';
                this.phoneShell?.showNotification?.('阅读', '正文取不到:' + why + ';重新导入同一个文件即可回到原进度', 'i️');
                return false;
            }
        }
        this.view.currentBook = {
            id: bookId,
            title: info.title,
            author: info.author || '',
            format: info.format || 'txt',
            encoding: info.encoding,
            mode: info.mode,
            chapters
        };
        this.view._loadProgress(bookId);
        this.render();
        return true;
    }
}

export default ReadingApp;