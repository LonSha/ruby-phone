/* ========================================================
 * pixiv-app.js — [v3.35.0] Pixiv App 控制器
 * 照抄 lofter / date / taobao 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 Perigee 三片（`js/pixiv-illust.js` 1411 行 / `js/pixiv-novel.js`
 * 3888 行 / `js/pixiv-comments.js` 563 行，共 5862 行 / 324763 字节）。
 * 逐条取舍写在 pixiv-data.js 的文件头（取哪几块 / 四块不缝 / 三条偏离）。
 * 这里只记**接线上的六件事**：
 *
 *  【① 不直连任何模型：生成侧归宿主】
 *   源三片共 19 处网络调用（`Utils._fetchWithTimeout` 18 处 + `Utils.callChatAPI`
 *   10 处），自带三条生图链路（NovelAI / OpenAI 兼容 / OpenRouter）与两条
 *   正文链路，自己读 `imageApiConfig.provider` 决定走哪条。
 *   本件一个网络调用都没有。生成走**两条合法通道**：
 *     · 视图把 `pixivPromptBlock()` 产出的要求摆出来给用户复制，粘到对话框；
 *     · 用户（或模型）把结果贴回视图的文本框，`ingest*()` 解析登记。
 *   源那条「点一下 Ta 就把章节写好了」的直连路径**不缝** —— App 不越权替宿主调模型。
 *
 *  【② 不落 IndexedDB / 不碰宿主对象】
 *   源把插画 Blob 落 IndexedDB（`IllustGallery`，含 `revokeAll` 与 ObjectURL
 *   缓存），把小说与评论整块经 `Utils.saveData()` 回写（38 处命中），
 *   还把卡片往宿主消息数组里 push。本件零数据库、零宿主写入。
 *
 *  【③ 不共用别的 App 的池】
 *   源要 `twitterData.fanFriends` 当作者池、要 `broadcast.plotProgress` 当
 *   题材源、要 `forumData.threads` 当分享出口、要 `melonbooksData` 当出版面。
 *   本件**自带原创作者池**，零跨 App 读 —— 兄弟 App 的池改了不该让本件静默变样；
 *   分享与出版都只产**可复制的文本**，落不落由用户决定。
 *
 *  【④ 一张图都不存、一条外链都不收】
 *   源存生图 URL 与外链封面、把 Blob 转 base64 data URL 塞进帖子。
 *   本件的插画面是**登记面**：只存「提示词 / 尺寸 / 张数 / 收藏 / 谁画的」，
 *   没有任何地址字段。视图也不渲染 `<img>`。
 *
 *  【⑤ 心数模型收成唯一确定性实现】
 *   源 `_rollHeatBase(fc)` 掷随机、`_rollChapterHearts` 再乘一次随机，
 *   同一作品每次读到的数都不一样，且 `novel.hearts` 缓存与逐章读数会永久不一致。
 *   本件 `deriveHeatBase` / `deriveChapterHearts` 由 `(fc, cold)` 与章号决定，
 *   同一输入必得同一读数，`hearts` 恒等于逐章最高。
 *
 *  【⑥ 写盘只走三条键，且都会如实回报裁剪】
 *   作品 60 / 单篇 60 章 / 单章 48 条评论 / 订阅 tag 40 / 浏览记录 40 /
 *   插画登记 60 都是**本仓新增的显式上界**（源里这些数全是无界增长）。
 *   裁剪条数一律回报，不静默吞。
 * ======================================================== */
'use strict';
import {
    PIXIV_REASONS, PIXIV_LIMITS, PIXIV_ACTIVE_TYPES, PIXIV_IDLE_TYPES, PIXIV_TYPE_LABELS,
    PIXIV_WRITING_STYLES, PIXIV_LANGUAGE_MODES, PIXIV_BUILT_IN_AUTHORS,
    isActivePixivType, readPixivFace, defaultPixivSettings, normalizePixivSettings,
    normalizeWritingStyles, normalizeNovel, normalizeChapter, normalizeComment, normalizeIllust,
    coldOfNovelId, deriveHeatBase, deriveChapterHearts, initNovelPopularity, heartsFace,
    buildCommentTree, flattenComments, commentCountFace, chapterIdentityFace, topAncestorId,
    totalWords, readingMinutes, visibleNovels, novelsOfTag, groupByMonth, searchNovels, snippetOf,
    prevChapterContext, nextChapterNum, chapterPositionFace, parseCommentsBlock,
    PIXIV_COMMENT_DELIM,
    sanitizeBody, toDisplayParagraphs,
    toggleInList, addSubscribedTag, recordReadHistory, myNovelFlags, myCollections, pruneList,
    formatCount, pickDiverseAuthors, resolveWritingStyle, pixivPromptBlock, projectPixiv,
    followedAuthorsOf,
} from './pixiv-data.js';
import { numOrNull } from '../../config/num-gate.js';
import { PixivView } from './pixiv-view.js';
import { writeReceipt } from '../../config/write-receipt.js';
/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^pixiv_/`，否则跨会话串味。
   源把全部状态塞在内存的 `AppState.data.pixivData` 里（切角色就串味）。
   本件分三条：设置 / 内容（作者 + 作品 + 章 + 评论 + 插画登记） / 互动（关注与订阅与我的四本账）。 */
const SETTINGS_KEY = 'pixiv_settings';
const CONTENT_KEY = 'pixiv_content';
const STORE_KEY = 'pixiv_store';

export class PixivApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = defaultPixivSettings();
        this.authors = [];
        this.novels = [];
        this.illusts = [];
        this.store = this._emptyStore();
        this.face = PIXIV_REASONS.storage_absent;
        this._proj = null;
        this._readings = { dropped: 0, trimmed: 0, totalNovels: 0, totalIllusts: 0, inactiveAuthors: 0 };
        this._current = '';
        this._chapter = 1;
        this._tab = 'novel';
        this._view = null;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    _emptyStore() {
        return {
            followedAuthorIds: [], subscribedTags: [],
            favoritedNovelIds: [], followingNovelIds: [], readHistoryNovelIds: [],
        };
    }
    /** 取数（**吞异常版**）：只给「没有就用默认」的场景用（设置键）。
     *  ★ 别拿它认源 —— 它会把自己的异常吞掉，「取不出来」于是变成「就是空的」。 */
    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }
    /**
     * 取数（**分两种回报**）：`ok` 说「storage 能不能用」，`raw` 说「这一格读到了什么」。
     *   · `ok === false` ⇒ storage 没给 / 一取就抛 ⇒ 这是「取不出来」，不是「空的」；
     *   · `ok === true, raw === null` ⇒ storage 是好的，只是这一格没有 / 不是合法 JSON。
     * 源把全部状态挂在内存对象上，从没区分过这两种情形（内存对象永远在）。
     */
    _readRaw(key) {
        if (!this.storage || typeof this.storage.get !== 'function') return { ok: false, raw: null };
        let text = null;
        try { text = this.storage.get(key); }
        catch (_e) { return { ok: false, raw: null }; }
        if (typeof text !== 'string') return { ok: true, raw: text };
        try { return { ok: true, raw: JSON.parse(text) }; }
        catch (_e) { return { ok: true, raw: null }; }
    }
    _writeJSON(key, v) {
        try {
            if (!this.storage) return false;
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }
    /** 宿主的称呼（`name1` 是用户、`name2` 是角色）；无宿主 ⇒ 用中性词，**绝不编人名**。 */
    _ctxNames() {
        let c = null;
        try {
            const w = this._win();
            c = (w && typeof w.SillyTavern !== 'undefined' && typeof w.SillyTavern.getContext === 'function')
                ? w.SillyTavern.getContext() : null;
        } catch (_e) { c = null; }
        return {
            myName: String((c && c.name1) || '我').trim() || '我',
            charName: String((c && c.name2) || '').trim(),
        };
    }
    /* ---------- 取数 ---------- */
    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 作者池 = 内置 9 位 + 用户自建的（内置的**只补缺、不覆盖**用户改过的同 id 项）。
     */
    probe() {
        // ★ 先认 storage 本身可不可用（**异常不许被吞**）——见 `_readRaw` 的注释。
        const rc = this._readRaw(CONTENT_KEY);
        const rs = this._readRaw(STORE_KEY);
        let storageOk = rc.ok && rs.ok;
        try {
            const c = (rc.raw && typeof rc.raw === 'object') ? rc.raw : {};
            const userAuthors = Array.isArray(c.authors) ? c.authors : [];
            const byId = new Map();
            for (const a of PIXIV_BUILT_IN_AUTHORS) byId.set(String(a.id), a);
            for (const a of userAuthors) {
                const id = String((a && a.id) || '');
                if (id) byId.set(id, a);
            }
            this.authors = [...byId.values()];
            const np = pruneList(c.novels, PIXIV_LIMITS.maxNovels);
            const ip = pruneList(c.illustrations, PIXIV_LIMITS.maxIllusts);
            // ★ 作品在入池前补一次心数（幂等）——源的做法是在创建 / 迁移时算，
            //   本件每次取数都补（缺才算），于是「外部塞进来的裸作品」也能拿到读数。
            this.novels = np.kept.map((n) => initNovelPopularity(n, coldOfNovelId(String((n && n.id) || ''))));
            this.illusts = ip.kept.map((i, idx) => normalizeIllust(i, idx));
            this._readings = {
                dropped: np.expired + ip.expired,
                trimmed: np.expired + ip.expired,
                totalNovels: np.total,
                totalIllusts: ip.total,
                inactiveAuthors: this.authors.filter((a) => !isActivePixivType(a.type)).length,
            };
            const s = (rs.raw && typeof rs.raw === 'object') ? rs.raw : {};
            this.store = {
                followedAuthorIds: toStrArr(s.followedAuthorIds),
                subscribedTags: toStrArr(s.subscribedTags),
                favoritedNovelIds: toStrArr(s.favoritedNovelIds),
                followingNovelIds: toStrArr(s.followingNovelIds),
                readHistoryNovelIds: toStrArr(s.readHistoryNovelIds),
            };
            if (np.expired || ip.expired) {
                this._writeJSON(CONTENT_KEY, { authors: userAuthors, novels: this.novels, illustrations: this.illusts });
            }
        } catch (_e) {
            storageOk = false;
            this.authors = PIXIV_BUILT_IN_AUTHORS.slice();
            this.novels = [];
            this.illusts = [];
            this.store = this._emptyStore();
            this._readings = { dropped: 0, trimmed: 0, totalNovels: 0, totalIllusts: 0, inactiveAuthors: 0 };
        }
        if (this._current && !this.novelById(this._current)) { this._current = ''; this._chapter = 1; }
        const hasAny = !!(this.novels.length || this.illusts.length
            || this.store.followedAuthorIds.length || this.store.favoritedNovelIds.length);
        this.face = storageOk
            ? (hasAny ? PIXIV_REASONS.ok : PIXIV_REASONS.empty)
            : PIXIV_REASONS.storage_absent;
        this._proj = storageOk
            ? projectPixiv({
                settings: this.settings, authors: this.authors,
                novels: this.novels, illustrations: this.illusts, store: this.store,
            })
            : null;
    }
    _project() {
        return projectPixiv({
            settings: this.settings, authors: this.authors,
            novels: this.novels, illustrations: this.illusts, store: this.store,
        });
    }
    _persistContent() {
        const userAuthors = this.authors.filter((a) => a && a.builtIn !== true
            && !PIXIV_BUILT_IN_AUTHORS.some((b) => b.id === a.id));
        this._writeJSON(CONTENT_KEY, { authors: userAuthors, novels: this.novels, illustrations: this.illusts });
    }
    _persistStore() { this._writeJSON(STORE_KEY, this.store); }
    /* ---------- 只读面 ---------- */
    authorsAll() { return this.authors.slice(); }
    /** 活跃作者（源的 1 类口径；非活跃的**仍在池里**，只是不参与推荐）。 */
    authorsActive() { return this.authors.filter((a) => isActivePixivType(a.type)); }
    authorById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.authors.length; i++) if (String(this.authors[i].id) === want) return this.authors[i];
        return null;
    }
    novelsAll() { return visibleNovels(this.novels, this.settings); }
    /** 我关注的作者 id（**走数据层那一个出口**，视图不许自己拆 store）。
     *  ★ 数据层 `followedAuthorsOf` 首版是零消费导出（建好了没人用）—— 这里接线。 */
    followedAuthors() { return followedAuthorsOf(this.store); }
    novelById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.novels.length; i++) if (this.novels[i].id === want) return this.novels[i];
        return null;
    }
    illustsAll() {
        return this.illusts.slice().sort((a, b) => b.createdAt - a.createdAt);
    }
    illustById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.illusts.length; i++) if (this.illusts[i].id === want) return this.illusts[i];
        return null;
    }
    novelsOfAuthor(authorId) {
        const want = String(authorId || '');
        return this.novelsAll().filter((n) => n.authorId === want);
    }
    tagFeed(tag) { return novelsOfTag(this.novelsAll(), tag); }
    byMonth() { return groupByMonth(this.novelsAll()); }
    hotTags() { return this._proj ? this._proj.hotTags : []; }
    search(q) { return searchNovels(this.novelsAll(), q, PIXIV_LIMITS.maxSearchHits); }
    snippet(n, q) { return snippetOf(n, q); }
    /** 「你可能想读」：按 tag 命中挑作者（源 `_pickWriterWeighted` 掷随机；本件按 seed 定序）。 */
    recommendAuthors(count, preferTag, seed) {
        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed).picked;
    }
    /** 挑选面的**三个读数**（挑出几位 / 池里参与几位 / tag 命中几位）—— 分开报。 */
    recommendFace(count, preferTag, seed) {
        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed);
    }
    /* ---------- 章节面 ---------- */
    /** 单篇的逐章列表（**规范化后**；坏章号不参与排序）。 */
    chaptersOf(novelId) {
        const n = this.novelById(novelId);
        return n ? n.chapters.slice() : [];
    }
    chapterAt(novelId, num) {
        const want = numOrNull(num);
        if (want === null) return null;
        const list = this.chaptersOf(novelId);
        for (let i = 0; i < list.length; i++) if (list[i].num === Math.trunc(want)) return list[i];
        return null;
    }
    /** 当前读到的章（越界一律回 1 —— 源在多处直接 `chapters[idx]`，越界即 undefined）。 */
    currentChapter() {
        if (!this._current) return null;
        const list = this.chaptersOf(this._current);
        if (!list.length) return null;
        const hit = this.chapterAt(this._current, this._chapter);
        return hit || list[0];
    }
    currentNovel() { return this._current ? this.novelById(this._current) : null; }
    /** 位置面：开篇 / 连载中 / 收尾 / 番外（源 `chapterEndCard` 四种形态）。 */
    positionOf(novelId, num, isEnding) {
        return chapterPositionFace(this.novelById(novelId) || {}, num, isEnding);
    }
    nextNumOf(novelId) { return nextChapterNum(this.novelById(novelId) || {}); }
    /** 续章上下文：最近 N 章全文、更早摘要（数据层 `prevChapterContext` 的直接消费点）。 */
    prevContextOf(novelId, num, win) {
        const n = this.novelById(novelId);
        return prevChapterContext(n ? n.chapters : [], num, win === undefined ? PIXIV_LIMITS.fullTextWindow : win);
    }
    /** 心数三面（缓存 / 逐章最高 / 逐章合计；**三者分开报**）。 */
    heartsOf(novelId) { return heartsFace(this.novelById(novelId) || {}); }
    wordsOf(novelId) { return totalWords(this.novelById(novelId) || {}); }
    readingMinutesOf(novelId) { return readingMinutes(this.wordsOf(novelId)); }
    /** 正文渲染段（先净化后切段；被挡下的标签如实回报）。 */
    paragraphsOf(novelId, num) {
        const ch = this.chapterAt(novelId, num);
        if (!ch) return [];
        return toDisplayParagraphs(ch.content || '');
    }
    /** 单段净化（视图给提示词等短文本用时用）。 */
    sanitize(text) { return sanitizeBody(text); }
    /* ---------- 文风 / 语言 ---------- */
    styleList() { return normalizeWritingStyles(this.settings.writingStyles); }
    styleById(id) {
        const want = String(id || '');
        const list = this.styleList();
        for (let i = 0; i < list.length; i++) if (list[i].id === want) return list[i];
        return null;
    }
    pickStyle(id, seed) { return resolveWritingStyle(this.styleList(), id, seed); }
    languageModes() { return PIXIV_LANGUAGE_MODES.slice(); }
    /** 数据层 `PIXIV_WRITING_STYLES` 的直接消费点：内置款（视图标「内置」徽标用）。 */
    builtInStyleIds() { return PIXIV_WRITING_STYLES.map((s) => s.id); }
    /** 数据层 `readPixivFace` 的直接消费点：内容面是三态（缺键 / 空 / 有），不许塌成一态。 */
    contentFace() {
        const r = this._readRaw(CONTENT_KEY);
        return readPixivFace(r.ok ? r.raw : null);
    }
    /** 数据层 `PIXIV_ACTIVE_TYPES` / `PIXIV_IDLE_TYPES` 的消费点：类型下拉用。 */
    allTypes() { return PIXIV_ACTIVE_TYPES.concat(PIXIV_IDLE_TYPES); }
    typeLabel(t) { return PIXIV_TYPE_LABELS[String(t || '')] || String(t || ''); }
    /* ---------- 我的四子面 ---------- */
    myList(kind) { return myCollections(this.novels, this.store, kind); }
    flagsOf(id) { return myNovelFlags(this.store, id); }
    /* ---------- 互动 ---------- */
    /** 四个开关共用一个口径：切换 → 落盘 → 重取（**切换本身不掷随机、不碰别的 App**）。 */
    _toggle(field, id) {
        const v = String(id || '');
        if (!v) return { ok: false, error: '这条找不到' };
        this.store[field] = toggleInList(this.store[field], v);
        this._persistStore();
        this.probe();
        return { ok: true, on: this.store[field].indexOf(v) >= 0 };
    }
    toggleFavorite(id) {
        const n = this.novelById(id);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        return this._toggle('favoritedNovelIds', n.id);
    }
    toggleFollowing(id) {
        const n = this.novelById(id);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        return this._toggle('followingNovelIds', n.id);
    }
    toggleFollowAuthor(id) {
        const a = this.authorById(id);
        if (!a) return { ok: false, error: '这位作者找不到了' };
        const r = this._toggle('followedAuthorIds', a.id);
        return Object.assign({ author: a.name }, r);
    }
    /** 订阅 tag：**有上界**，超限丢最早的并如实回报丢了几个。 */
    subscribeTag(tag) {
        const r = addSubscribedTag(this.store.subscribedTags, tag);
        if (r.added || r.dropped) { this.store.subscribedTags = r.list; this._persistStore(); }
        return { ok: r.added, tag: String(tag || '').replace(/^#/, ''), dropped: r.dropped, count: r.list.length };
    }
    unsubscribeTag(tag) {
        const t = String(tag || '').replace(/^#/, '').trim();
        const before = this.store.subscribedTags.length;
        this.store.subscribedTags = this.store.subscribedTags.filter((x) => x !== t);
        if (this.store.subscribedTags.length !== before) this._persistStore();
        return { ok: before !== this.store.subscribedTags.length, count: this.store.subscribedTags.length };
    }
    /** 打开作品 = 记一次浏览（源 `openNovel` 顺手写 `lastReadAt` 并 push 记录）。 */
    openNovel(id, num) {
        const n = this.novelById(id);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        const r = recordReadHistory(this.store.readHistoryNovelIds, n.id, PIXIV_LIMITS.maxReadingHistory);
        this.store.readHistoryNovelIds = r.list;
        this._persistStore();
        this._current = n.id;
        const list = n.chapters;
        const want = numOrNull(num);
        this._chapter = list.length
            ? ((want === null || !this.chapterAt(n.id, want)) ? list[0].num : Math.trunc(want))
            : 1;
        return { ok: true, dropped: r.dropped, chapter: this._chapter };
    }
    /** 逐章点赞（源 `toggleChapterLike`：`isLiked` 与 `likeBoost` 一起动，且 boost 不为负）。 */
    toggleChapterLike(novelId, num) {
        const n = this.novelById(novelId);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        const ch = this.chapterAt(novelId, num);
        if (!ch) return { ok: false, error: '这一话找不到了' };
        ch.isLiked = !ch.isLiked;
        ch.likeBoost = Math.max(0, (ch.likeBoost || 0) + (ch.isLiked ? 1 : -1));
        this._persistContent();
        this.probe();
        return { ok: true, liked: ch.isLiked, hearts: (ch.hearts || 0) + ch.likeBoost };
    }
    setCurrentChapter(num) {
        const want = numOrNull(num);
        if (want !== null && this.chapterAt(this._current, want)) this._chapter = Math.trunc(want);
        return this._chapter;
    }
    /* ---------- 评论（楼中楼） ---------- */
    commentsOf(novelId, num) {
        const ch = this.chapterAt(novelId, num);
        return ch && Array.isArray(ch.commentsList) ? ch.commentsList.slice() : [];
    }
    /** 评论树（**三个读数分开**：roots / truncated / orphans）。 */
    commentTreeOf(novelId, num) { return buildCommentTree(this.commentsOf(novelId, num), PIXIV_LIMITS.maxCommentDepth); }
    commentRows(novelId, num) { return flattenComments(this.commentTreeOf(novelId, num).roots.length ? this.commentTreeOf(novelId, num).roots[0] : {}); }
    /** 全部评论拍平（视图渲染用；深度超限的已挂在根上、不丢）。 */
    commentRowsAll(novelId, num) {
        const t = this.commentTreeOf(novelId, num);
        const out = [];
        for (const r of t.roots) { out.push(Object.assign({}, r, { isRoot: true })); for (const c of flattenComments(r)) out.push(c); }
        return { rows: out, truncated: t.truncated, orphans: t.orphans, loaded: commentCountFace(this.chapterAt(novelId, num)).loaded };
    }
    commentCountOf(novelId, num) { return commentCountFace(this.chapterAt(novelId, num)); }
    /**
     * 发一条评论 / 回复。回复目标若已到**最深一层**，自动改挂到该线程顶层
     * （源无此保护：源 `_topAncestorId` 只靠 `guard < 50` 步数上限，越挂越深）。
     */
    addComment(novelId, num, text, replyToId) {
        const n = this.novelById(novelId);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        const ch = this.chapterAt(novelId, num);
        if (!ch) return { ok: false, error: '这一话找不到了' };
        const body = String(text || '').trim();
        if (!body) return { ok: false, error: '评论不能空着' };
        const names = this._ctxNames();
        const rows = [];
        const t = this.commentTreeOf(novelId, num);
        for (const r of t.roots) { rows.push(r); for (const c of flattenComments(r)) rows.push(c); }
        let parent = String(replyToId || '');
        let rehomed = false;
        if (parent) {
            const node = rows.filter((x) => x.id === parent)[0];
            if (!node) parent = '';
            else if ((node.depth || 1) >= PIXIV_LIMITS.maxCommentDepth) {
                const top = topAncestorId(ch.commentsList, parent);
                if (top && top !== parent) { parent = top; rehomed = true; }
            }
        }
        const list = Array.isArray(ch.commentsList) ? ch.commentsList.slice() : [];
        list.push({
            id: ch.idForComments ? ch.idForComments() : ('pxc_' + n.id + '_' + num + '_' + (list.length + 1)),
            author: names.myName,
            content: body.slice(0, 300),
            replyToCommentId: parent || null,
            likes: 0, isOpReply: false, from: 'me', createdAt: Date.now(),
        });
        const capped = pruneList(list, PIXIV_LIMITS.maxCommentsPerChapter);
        ch.commentsList = capped.kept;
        ch.commentsLoaded = true;
        ch.commentsAttempted = true;
        this._persistContent();
        return { ok: true, rehomed, expired: capped.expired, count: capped.kept.length };
    }
    /**
     * 收下宿主给的评论产出（源 `loadComments`：调模型 → `_parseComments` → `_assembleComments`）。
     * 本件不吃原始文本块 —— 宿主给出的应是**已结构化的条目**；本方法只做登记与上限。
     * `markFailed` 为真时把该章标成「试过了没成」（与「没读过」分成两态）。
     */
    ingestComments(novelId, num, items, markFailed) {
        const n = this.novelById(novelId);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        const ch = this.chapterAt(novelId, num);
        if (!ch) return { ok: false, error: '这一话找不到了' };
        ch.commentsAttempted = true;
        if (markFailed) {
            ch.commentsFailed = true;
            this._persistContent();
            return { ok: false, error: '这次没读出来', count: (ch.commentsList || []).length };
        }
        const arr = Array.isArray(items) ? items : [];
        if (!arr.length) {
            ch.commentsFailed = true;
            this._persistContent();
            return { ok: false, error: '宿主没给出任何一条', count: (ch.commentsList || []).length };
        }
        const list = Array.isArray(ch.commentsList) ? ch.commentsList.slice() : [];
        const known = new Set(list.map((c) => String(c.id)));
        let added = 0;
        for (let i = 0; i < arr.length; i++) {
            const c = normalizeComment(arr[i], list.length + i);
            if (known.has(c.id)) continue;
            // 父指针指向本次给的新条目时保留，指向别处的一律落根（**不许静默指向不存在的父**）
            if (c.replyToCommentId && !known.has(c.replyToCommentId)) c.replyToCommentId = null;
            known.add(c.id);
            list.push(c);
            added += 1;
        }
        const capped = pruneList(list, PIXIV_LIMITS.maxCommentsPerChapter);
        ch.commentsList = capped.kept;
        ch.commentsLoaded = true;
        ch.commentsFailed = false;
        this._persistContent();
        return { ok: true, added, expired: capped.expired, count: capped.kept.length };
    }
    /** 把宿主贴回来的评论**文本块**收下（解析 → 登记；解析器在数据层）。 */
    ingestCommentsText(novelId, num, text) {
        const parsed = parseCommentsBlock(text);
        if (!parsed.items.length) {
            return { ok: false, error: parsed.skipped ? ('贴回来的 ' + parsed.skipped + ' 块里没有正文') : '没看到评论块（每块用 ' + PIXIV_COMMENT_DELIM + ' 起头）' };
        }
        const r = this.ingestComments(novelId, num, parsed.items, false);
        return Object.assign({}, r, { skipped: parsed.skipped, blocks: parsed.blocks });
    }
    /* ---------- 收下宿主机给的产出 ---------- */
    /** 建一篇作品（**手动投稿**；源的 AI 生成路径换成宿主产出贴回）。 */
    createNovel(input) {
        const it = input || {};
        const title = String(it.title || '').trim();
        if (!title) return { ok: false, error: '标题不能空着' };
        const now = Date.now();
        const id = 'pxv_n_' + now.toString(36) + '_' + Math.floor(this.novels.length + 1);
        const names = this._ctxNames();
        const authorId = String(it.authorId || '');
        const author = this.authorById(authorId);
        const spec = {
            id,
            title,
            authorId: author ? author.id : '',
            authorName: author ? author.name : (String(it.authorName || '').trim() || names.myName),
            synopsis: String(it.synopsis || '').trim(),
            tags: Array.isArray(it.tags) ? it.tags : String(it.tagLine || '').split(/[,\s、]+/),
            isSerial: it.isSerial === true,
            completed: false,
            isUserCreated: it.isUserCreated !== false,
            styleId: String(it.styleId || ''),
            chapters: [],
            createdAt: now,
            updatedAt: now,
        };
        const novel = initNovelPopularity(spec, coldOfNovelId(id));
        this.novels = this.novels.concat([novel]);
        const pr = pruneList(this.novels, PIXIV_LIMITS.maxNovels);
        this.novels = pr.kept;
        this._persistContent();
        this.probe();
        return { ok: true, id, expired: pr.expired };
    }
    /**
     * 追加一章（宿主给的正文贴回；源 `confirmChapterAction` 的登记侧）。
     * ★ 章号由 `nextChapterNum` 给；`reroll` 时替换指定章、**章对象整体换新**
     *   —— 视图侧靠 `chapterIdentityFace` 判断「占位评论已不在原对象上」。
     */
    ingestChapter(novelId, rawContent, opts) {
        const n = this.novelById(novelId);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        const o = opts || {};
        const text = String(rawContent || '').trim();
        if (text.length < 5) return { ok: false, error: '正文太短了（至少要 5 个字）' };
        const isReroll = o.mode === 'reroll';
        const targetNum = isReroll ? (numOrNull(o.chapterNum) === null ? this._chapter : Math.trunc(o.chapterNum)) : nextChapterNum(n);
        const prev = isReroll ? this.chapterAt(novelId, targetNum) : null;
        const cold = coldOfNovelId(n.id);
        const heat = deriveHeatBase(o.followerCount === undefined ? 12000 : o.followerCount, cold);
        const now = Date.now();
        const chapter = normalizeChapter({
            num: targetNum,
            title: String(o.title || '').trim() || ('第 ' + targetNum + ' 話'),
            content: text,
            synopsis: String(o.synopsis || '').trim(),
            wordCount: text.replace(/\s/g, '').length,
            hearts: deriveChapterHearts(heat, targetNum),
            likeBoost: prev ? prev.likeBoost : 0,
            isLiked: prev ? prev.isLiked : false,
            // ★ 重写一章 = 该章评论清零（源注释明写「评论随之自然清零，与点赞重置行为一致」）
            commentsList: [],
            commentsLoaded: false,
            commentsAttempted: false,
            commentsFailed: false,
            createdAt: prev ? prev.createdAt : now,
            language: String(this.settings.language || 'jp-cn'),
        }, targetNum - 1);
        const list = n.chapters.slice();
        const at = list.findIndex((c) => c.num === targetNum);
        if (at >= 0) list[at] = chapter; else list.push(chapter);
        list.sort((a, b) => a.num - b.num);
        const cp = pruneList(list, PIXIV_LIMITS.maxChaptersPerNovel);
        const ident = isReroll ? chapterIdentityFace(chapter, prev) : { comparable: false, sameObject: false, sameNum: false };
        this.novels = this.novels.map((x) => (x.id === n.id
            ? normalizeNovel(Object.assign({}, x, { chapters: cp.kept, updatedAt: now }))
            : x));
        this._persistContent();
        this.probe();
        return {
            ok: true, num: chapter.num, reroll: isReroll, expired: cp.expired,
            commentsCleared: isReroll && !!prev, identity: ident,
        };
    }
    /** 完结 / 重启连载（源 `completeNovel` / `uncompleteNovel`）。 */
    setCompleted(novelId, on) {
        const n = this.novelById(novelId);
        if (!n) return { ok: false, error: '这篇作品找不到了' };
        if (!n.isSerial && on === true) return { ok: false, error: '短篇没有「完结连载」这回事' };
        n.completed = on === true;
        this._persistContent();
        this.probe();
        return { ok: true, completed: n.completed };
    }
    /** 登记一条插画（**不存图、不存地址**）。 */
    ingestIllust(input) {
        const it = input || {};
        const prompt = String(it.prompt || '').trim();
        if (!prompt) return { ok: false, error: '至少要写一句画的是什么' };
        const now = Date.now();
        const id = 'pxv_i_' + now.toString(36) + '_' + Math.floor(this.illusts.length + 1);
        const names = this._ctxNames();
        const item = normalizeIllust({
            id,
            prompt,
            negativePrompt: String(it.negativePrompt || '').trim(),
            size: String(it.size || '').trim() || '1024x1024',
            count: numOrNull(it.count) === null ? 1 : Math.trunc(numOrNull(it.count)),
            isFavorite: false,
            drawnBy: String(it.drawnBy || '').trim() || names.myName,
            createdAt: now,
        }, this.illusts.length);
        this.illusts = this.illusts.concat([item]);
        const pr = pruneList(this.illusts, PIXIV_LIMITS.maxIllusts);
        this.illusts = pr.kept;
        this._persistContent();
        this.probe();
        return { ok: true, id, expired: pr.expired };
    }
    toggleIllustFavorite(id) {
        const it = this.illustById(id);
        if (!it) return { ok: false, error: '这条登记找不到了' };
        it.isFavorite = !it.isFavorite;
        this._persistContent();
        this.probe();
        return { ok: true, favorite: it.isFavorite };
    }
    removeIllust(id) {
        const before = this.illusts.length;
        this.illusts = this.illusts.filter((i) => i.id !== String(id || ''));
        if (this.illusts.length !== before) { this._persistContent(); this.probe(); }
        return { ok: before !== this.illusts.length };
    }
    /* ---------- 自建作者 / 自建文风（写侧；内置只补缺不覆盖） ---------- */
    /**
     * 加一位自建作者。★ 与 `probe()` 的合并纪律成对：
     *   probe 是「内置只补缺、不覆盖同 id 的用户项」，这里保证新 id 不与内置撞。
     */
    addAuthor(input) {
        const s = (input && typeof input === 'object') ? input : {};
        const name = String(s.name || '').trim();
        if (!name) return { ok: false, error: '作者要有名字' };
        const raw = String(s.type || '');
        const type = (this.allTypes().indexOf(raw) >= 0) ? raw : PIXIV_ACTIVE_TYPES[0];
        const id = 'pxv_a_u' + Date.now().toString(36);
        const a = {
            id,
            name,
            type,
            bio: String(s.bio || '').trim().slice(0, 200),
            contentTags: toStrArr(s.contentTags).map((t) => t.replace(/^#/, '').trim())
                .filter(Boolean).slice(0, 3),
            writingStyle: String(s.writingStyle || '').trim(),
            builtIn: false,
        };
        this.authors = this.authors.concat([a]);
        this._persistContent();
        this.probe();
        return { ok: true, id: a.id, name: a.name, type: a.type, active: isActivePixivType(a.type) };
    }
    /** 加一款自建文风。重名内置的拒掉（内置是单一真源，不许被同名遮住）。 */
    addStyle(name, rules) {
        const n = String(name || '').trim();
        const r = String(rules || '').trim();
        if (!n) return { ok: false, error: '文风要有名字' };
        if (!r) return { ok: false, error: '文风要写点规则（不然模型不知道怎么写）' };
        const builtInNames = PIXIV_WRITING_STYLES.map((s) => s.name);
        if (builtInNames.indexOf(n) >= 0) return { ok: false, error: '内置已经有一款叫「' + n + '」的了，换个名字' };
        const id = 'pxv_style_u' + Date.now().toString(36);
        this.settings.writingStyles = this.styleList()
            .concat([{ id, name: n, description: '', rules: r, enabled: true }]);
        this.saveSettings();
        return { ok: true, id, count: this.settings.writingStyles.length };
    }
    /** 删自建文风。内置的不许删 —— 只想停用就关掉（关掉后随机抽不到）。 */
    removeStyle(id) {
        const want = String(id || '');
        const cur = this.styleById(want);
        if (!cur) return { ok: false, error: '这款文风找不到了' };
        if (PIXIV_WRITING_STYLES.some((s) => s.id === want)) {
            return { ok: false, error: '内置文风不能删 —— 只想停用就把它关掉（关掉后随机不会抽到它）' };
        }
        this.settings.writingStyles = this.styleList().filter((s) => s.id !== want);
        this.saveSettings();
        return { ok: true, count: this.settings.writingStyles.length };
    }
    /** 启停一款文风。返回启用了的款数，防止「五款全关」这种静默空抽。 */
    toggleStyle(id) {
        const want = String(id || '');
        let hit = null;
        const list = this.styleList().map((s) => {
            if (s.id !== want) return s;
            hit = Object.assign({}, s, { enabled: s.enabled === false });
            return hit;
        });
        if (!hit) return { ok: false, error: '这款文风找不到了' };
        this.settings.writingStyles = list;
        this.saveSettings();
        return { ok: true, enabled: hit.enabled, enabledCount: list.filter((s) => s.enabled !== false).length };
    }

    /* ---------- 生成要求（可复制文本；本件不发请求） ---------- */
    /** 四类要求块：novel / chapter / comment / illust。返回结构化块给视图摆。 */
    promptBlock(mode, payload) {
        const p = Object.assign({}, payload || {});
        if (p.novelId) {
            const n = this.novelById(p.novelId);
            if (n) { p.novel = n; p.title = p.title || n.title; p.writingStyles = this.styleList(); }
        }
        p.writingStyles = p.writingStyles || this.styleList();
        p.language = p.language || this.settings.language;
        return pixivPromptBlock(mode, p);
    }
    /** 把要求块折成给用户复制的整段文本（**只摆文本，不替宿主发请求**）。 */
    copyPrompt(mode, payload) {
        const names = this._ctxNames();
        const b = this.promptBlock(mode, Object.assign({ readerName: names.myName }, payload || {}));
        const lines = [];
        if (b.mode === 'chapter') {
            lines.push('请写《' + (b.title || '无题') + '》第 ' + b.chapterNum + ' 話（' + b.positionLabel + '，作者：' + (b.authorName || '匿名') + '）。');
            if (b.tagLine) lines.push('标签：' + b.tagLine);
            if (b.lengthLabel) lines.push('篇幅：' + b.lengthLabel);
            lines.push('前文：最近 ' + b.fullCount + ' 章给全文、更早 ' + b.digestCount + ' 章给梗概，我会把正文贴过来。');
            if (b.styleName) lines.push('文风：' + b.styleName + ' —— ' + b.styleRules);
            if (b.language === 'jp-cn') {
                lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');
                // ★ 纯度规则**必须真进文本**：数据层算了却没人读 = 这条硬规则等于不存在，
                //   用户复制的日语要求里没有它，中文指令会被原样搬进日语正文。
                if (b.purityRule) lines.push('纯度：' + b.purityRule);
            }
            if (b.userDirection) lines.push('另外：' + b.userDirection);
        } else if (b.mode === 'comment') {
            lines.push('在《' + (b.novelTitle || '无题') + '》第 ' + b.chapterNum + ' 話评论区，'
                + (b.readerName || '我') + ' 留了一句：' + (b.readerText || '（什么都没写）'));
            lines.push(b.wantsOpReply
                ? '请以作者「' + (b.novelAuthor || '匿名') + '」的口吻回一条（楼中楼，一两句就够）。'
                : '请以别的读者的口吻回一条（楼中楼，一两句就够）。');
            lines.push('回完把那条贴回这一話的评论框里（要挂在谁下面就先点那条的「回复」）。');
        } else if (b.mode === 'illust') {
            lines.push('请按这段描述画 ' + b.count + ' 张（' + b.size + '）：' + b.prompt);
            if (b.negativePrompt) lines.push('不要出现：' + b.negativePrompt);
            lines.push('出图后，把「画的是什么」这一句登记回本 App 的插画登记面 —— 本 App 不存图，只记下你画过什么。');
        } else {
            lines.push('请按这个方向写' + (b.isSerial ? '一篇连载的开头' : '一篇短篇') + '，标题暂定《' + (b.title || '待定') + '》。');
            if (b.tagLine) lines.push('标签：' + b.tagLine);
            if (b.styleName) lines.push('文风：' + b.styleName + ' —— ' + b.styleRules);
            if (b.customPrompt) lines.push('设定：' + b.customPrompt);
            if (b.minWords) lines.push('至少 ' + b.minWords + ' 字。');
            if (b.language === 'jp-cn') {
                lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');
                if (b.purityRule) lines.push('纯度：' + b.purityRule);
            }
            if (b.userDirection) lines.push('另外：' + b.userDirection);
        }
        lines.push('（本 App 不会自己去调模型 —— 这段文字请贴到你惯用的对话端。）');
        return { ok: true, text: lines.join('\n'), block: b };
    }
    /* ---------- 读数 / 注入 ---------- */
    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return PIXIV_LIMITS; }
    readings() { return Object.assign({}, this._readings); }
    stored() { return Object.assign({}, this.store); }
    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到 Pixiv 数据';
        if (!p.novels.length && !p.illustrations.length) return '还没有作品，也没有插画登记';
        const bits = [];
        if (p.novels.length) bits.push(p.novels.length + ' 篇作品');
        if (p.illustrations.length) bits.push(p.illustrations.length + ' 条插画登记');
        if (p.hotTags.length) bits.push('热门 ' + p.hotTags[0].tag);
        if (this.store.followedAuthorIds.length) bits.push('关注 ' + this.store.followedAuthorIds.length + ' 位');
        return bits.join(' · ');
    }
    faceOf(tab) {
        const k = String(tab || '');
        if (k === 'illust') return this.illusts.length + ' 条登记';
        if (k === 'me') {
            const n = this.store.favoritedNovelIds.length + this.store.followingNovelIds.length
                + this.store.readHistoryNovelIds.length;
            return n ? (n + ' 条留在这里') : '还没有存的';
        }
        if (k === 'search') return '按标题 / 作者 / tag 找';
        return this.novelsAll().length + ' 篇在架';
    }
    /** 「多少心 / 多少字」读数给视图标题用（都不是随机数）。 */
    statsOf(id) {
        const n = this.novelById(id);
        if (!n) return null;
        const h = heartsFace(n);
        return {
            hearts: formatCount(n.hearts),
            raw: h,
            words: totalWords(n),
            minutes: readingMinutes(totalWords(n)),
            // ★ 条数如实（坏号章也算一条）—— 免得「目录 3 格、统计说 2 章」自相矛盾。
            chapters: n.chapters.length,
            countableChapters: n.chapters.filter((c) => c.num !== null).length,
        };
    }
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'novel');
        this._tab = ['illust', 'novel', 'me', 'search'].indexOf(k) >= 0 ? k : 'novel';
        return this._tab;
    }
    /* ---------- 设置 ---------- */
    _loadSettings() {
        try { this.settings = normalizePixivSettings(this._readJSON(SETTINGS_KEY)); }
        catch (_e) { this.settings = defaultPixivSettings(); }
    }
    saveSettings() { this._writeJSON(SETTINGS_KEY, this.settings); }
    patchSettings(patch) {
        this.settings = normalizePixivSettings(Object.assign({}, this.settings, patch || {}));
        this.saveSettings();
        this.probe();
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：作者池、作品、章与评论、插画登记、四本账全是「这段关系的账」，故全部重取。 */
    onChatChanged() {
        this._current = '';
        this._chapter = 1;
        this._tab = 'novel';
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new PixivView(this, this.shell, this.storage);
        this._view.render();
    }
}
function toStrArr(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '')) : [];
}