/* ========================================================
 * lofter-app.js — [v3.34.0] 老福特（LOFTER）App 控制器
 * 照抄 date / taobao / loverapp 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 Perigee（`js/lofter.js`，4445 行 / 267370 字节）。源是一个挂在全局
 *   `AppState.data.lofterData` 上、**共用微博粉丝池与 CP 设定**的中文同人圈平台仿真。
 * 逐条取舍写在 lofter-data.js 的文件头（五块取 / 四处不缝 / 三条偏离）。
 * 这里只记**接线上的六件事**：
 *
 *  【① 不直连模型：生成侧归宿主】
 *   源自己读 `weiboData.apiOverride.apiKey`、自己拼 systemPrompt、自己发 POST。
 *   本件一个网络调用都没有。生成走**两条合法通道**：
 *     · 视图把 `lofterPromptBlock()` 产出的要求块**摆出来给用户复制**，粘到对话框；
 *     · 用户（或模型）把结果贴回视图的文本框，`ingestBatch()` 解析登记。
 *   源那条「点一下按钮 Ta 就写好了」的直连路径**不缝** —— App 不越权替宿主调模型。
 *
 *  【② 不落 Dexie、不碰 `db.chats` / `chat.history`】
 *   源把整块 `lofterData` 经 `Utils.saveData()` 回写、把可见卡片往 history 里 push。
 *   本件零数据库，三条会话键（设置 / 内容 / 互动）分开落，改一处不必整块回写；
 *   且**不替宿主写楼层**：要分享就产一段可复制文本。
 *
 *  【③ 不共用别的 App 的池】
 *   源要 `weiboData.fanFriends` 当作者池、要 CP 设定当题材源。本件**自带原创作者池**
 *   （`LOFTER_BUILT_IN_AUTHORS` 8 位 + 用户可自建），零跨 App 读 —— 兄弟 App 的池
 *   改了不该让本件静默变样。
 *
 *  【④ 一张图都不存、一条外链都不收】
 *   源存生图 URL 与外链封面。本件只登记「有没有图、几张图」两个数（`hasImages` /
 *   `imageCount`），**不存任何地址**。
 *
 *  【⑤ 不做实时定时器、不发随机数】
 *   源用 `Math.random()` 现掷统计数（心 / 收藏 / 评论三处各掷一次，**三者序关系不保证**）。
 *   本件收成唯一实现 `deriveStats(heat, cold)`：同一 `(heat, cold)` 必得同一读数，
 *   且 `心 ≥ 收藏 ≥ 评论` 恒成立。`cold` 由文章 id 派生（确定性、可复算）。
 *
 *  【⑥ 写盘只走三条键，且都会如实回报裁剪】
 *   文章池 120 / 合集 24 / 单篇评论 40 / 订阅 tag 40 / 足迹 60 都是**本仓新增的显式上界**
 *   （源里这些数全是无界增长）。裁剪条数一律回报，不静默吞。
 * ======================================================== */
'use strict';
import {
    LOFTER_REASONS, LOFTER_LIMITS, LOFTER_ACTIVE_TYPES, LOFTER_ARTICLE_TYPES,
    LOFTER_WRITING_STYLES, LOFTER_CHAPTER_LENGTHS, LOFTER_FULL_TEXT_WINDOW,
    LOFTER_BUILT_IN_AUTHORS,
    isActiveLofterType, readLofterFace, defaultLofterSettings, normalizeLofterSettings,
    normalizeWritingStyles, normalizeArticle, normalizeCollection, pruneList,
    formatCount, deriveStats, buildCommentTree, flattenComments, commentCountFace,
    topAncestorId, pickDiverseAuthors, resolveWritingStyle, chapterLengthSpec,
    prevChapterContext, nextChapterNum, chapterPositionFace,
    parseLofterBatch, buildArticleFromBlock,
    visibleArticles, articlesOfTag, groupByMonth, searchArticles, snippetOf,
    toggleInList, addSubscribedTag, myArticleFlags, recordFootprint,
    lofterPromptBlock, projectLofter,
} from './lofter-data.js';
import { numOrNull } from '../../config/num-gate.js';
import { LofterView } from './lofter-view.js';
import { writeReceipt } from '../../config/write-receipt.js';
/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^lofter_/`，否则跨会话串味。
   源把全部状态塞在内存的 `AppState.data.lofterData` 里（切角色就串味）。
   本件分三条：设置 / 内容（作者+文章+合集） / 互动（关注与订阅与我的四个列表）。 */
const SETTINGS_KEY = 'lofter_settings';
const CONTENT_KEY = 'lofter_content';
const STORE_KEY = 'lofter_store';
/** 文章 id 派生「冷门系数」：同一 id 必得同一组统计（确定性、可复算、可判据断言）。 */
function coldOfId(id) {
    const s = String(id || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return 20 + (h % 60);
}
export class LofterApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = defaultLofterSettings();
        this.authors = [];
        this.articles = [];
        this.collections = [];
        this.store = this._emptyStore();
        this.face = LOFTER_REASONS.storage_absent;
        this._proj = null;
        this._readings = { dropped: 0, trimmed: 0, totalArticles: 0, totalCollections: 0, inactiveAuthors: 0 };
        this._current = '';
        this._tab = 'home';
        this._view = null;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    _emptyStore() {
        return {
            followedAuthorIds: [], subscribedTags: [], subscribedCollectionIds: [],
            myLikedArticleIds: [], myFavoritedArticleIds: [],
            myFootprintArticleIds: [], myReadLaterArticleIds: [],
        };
    }
    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
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
     * 作者池 = 内置 8 位 + 用户自建的（内置的**只补缺、不覆盖**用户改过的同 id 项）。
     */
    probe() {
        let storageOk = !!this.storage;
        try {
            const rawC = this._readJSON(CONTENT_KEY);
            const c = (rawC && typeof rawC === 'object') ? rawC : {};
            const userAuthors = Array.isArray(c.authors) ? c.authors : [];
            const byId = new Map();
            for (const a of LOFTER_BUILT_IN_AUTHORS) byId.set(String(a.id), a);
            for (const a of userAuthors) {
                const id = String((a && a.id) || '');
                if (id) byId.set(id, a);
            }
            this.authors = [...byId.values()];
            const ap = pruneList(c.articles, LOFTER_LIMITS.maxArticles);
            const cp = pruneList(c.collections, LOFTER_LIMITS.maxCollections);
            this.articles = ap.kept.map((a) => normalizeArticle(a));
            this.collections = cp.kept.map((x) => normalizeCollection(x));
            this._readings = {
                dropped: ap.expired + cp.expired,
                trimmed: ap.expired + cp.expired,
                totalArticles: ap.total,
                totalCollections: cp.total,
                inactiveAuthors: this.authors.filter((a) => !isActiveLofterType(a.type)).length,
            };
            const rawS = this._readJSON(STORE_KEY);
            const s = (rawS && typeof rawS === 'object') ? rawS : {};
            this.store = {
                followedAuthorIds: toStrArr(s.followedAuthorIds),
                subscribedTags: toStrArr(s.subscribedTags),
                subscribedCollectionIds: toStrArr(s.subscribedCollectionIds),
                myLikedArticleIds: toStrArr(s.myLikedArticleIds),
                myFavoritedArticleIds: toStrArr(s.myFavoritedArticleIds),
                myFootprintArticleIds: toStrArr(s.myFootprintArticleIds),
                myReadLaterArticleIds: toStrArr(s.myReadLaterArticleIds),
            };
            if (ap.expired || cp.expired) {
                this._writeJSON(CONTENT_KEY, { authors: userAuthors, articles: this.articles, collections: this.collections });
            }
        } catch (_e) {
            storageOk = false;
            this.authors = LOFTER_BUILT_IN_AUTHORS.slice();
            this.articles = [];
            this.collections = [];
            this.store = this._emptyStore();
            this._readings = { dropped: 0, trimmed: 0, totalArticles: 0, totalCollections: 0, inactiveAuthors: 0 };
        }
        if (this._current && !this.articleById(this._current)) this._current = '';
        const hasAny = !!(this.articles.length || this.collections.length
            || this.store.followedAuthorIds.length || this.store.myLikedArticleIds.length);
        this.face = storageOk
            ? (hasAny ? LOFTER_REASONS.ok : LOFTER_REASONS.empty)
            : LOFTER_REASONS.storage_absent;
        this._proj = storageOk
            ? projectLofter({ settings: this.settings, authors: this.authors, articles: this.articles, collections: this.collections, store: this.store })
            : null;
    }
    _project() {
        return projectLofter({ settings: this.settings, authors: this.authors, articles: this.articles, collections: this.collections, store: this.store });
    }
    _persistContent() {
        const userAuthors = this.authors.filter((a) => a && a.builtIn !== true && !LOFTER_BUILT_IN_AUTHORS.some((b) => b.id === a.id));
        this._writeJSON(CONTENT_KEY, { authors: userAuthors, articles: this.articles, collections: this.collections });
    }
    _persistStore() { this._writeJSON(STORE_KEY, this.store); }
    /* ---------- 只读面 ---------- */
    authorsAll() { return this.authors.slice(); }
    /** 活跃作者（源的 4 类口径；非活跃的**仍在池里**，只是不参与推送）。 */
    authorsActive() { return this.authors.filter((a) => isActiveLofterType(a.type)); }
    authorById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.authors.length; i++) if (String(this.authors[i].id) === want) return this.authors[i];
        return null;
    }
    articlesAll() { return visibleArticles(this.articles, this.settings); }
    articleById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.articles.length; i++) if (this.articles[i].id === want) return this.articles[i];
        return null;
    }
    collectionsAll() { return this.collections.slice(); }
    collectionById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.collections.length; i++) if (this.collections[i].id === want) return this.collections[i];
        return null;
    }
    articlesOfAuthor(authorId) {
        const want = String(authorId || '');
        return this.articlesAll().filter((a) => a.authorId === want);
    }
    articlesOfCollection(cid) {
        const want = String(cid || '');
        return this.articlesAll().filter((a) => a.collectionId === want)
            .sort((a, b) => (numOrNull(a.chapterNum) || 0) - (numOrNull(b.chapterNum) || 0));
    }
    /** 关注面：我关注的作者的文章（源 renderFollow 的口径）。 */
    followFeed() {
        const ids = this.store.followedAuthorIds;
        if (!ids.length) return [];
        return this.articlesAll().filter((a) => ids.indexOf(a.authorId) >= 0);
    }
    /** 我的四个子面（各自独立，**不许合并**）。 */
    myArticles(kind) {
        const k = String(kind || '');
        const map = {
            liked: this.store.myLikedArticleIds, favorited: this.store.myFavoritedArticleIds,
            footprint: this.store.myFootprintArticleIds, readLater: this.store.myReadLaterArticleIds,
        };
        const ids = map[k];
        if (!ids) return [];
        return ids.map((id) => this.articleById(id)).filter(Boolean);
    }
    tagFeed(tag) { return articlesOfTag(this.articlesAll(), tag); }
    byMonth() { return groupByMonth(this.articlesAll()); }
    hotTags() { return this._proj ? this._proj.hotTags : []; }
    search(q) { return searchArticles(this.articlesAll(), q, LOFTER_LIMITS.maxSearchHits); }
    snippet(a, q) { return snippetOf(a, q); }
    /** 「你可能想关注」：类型多样性轮转（源无此机制；本件补，用真实消费 `pickDiverseAuthors`）。 */
    recommendAuthors(count, typeId, rng) {
        const t = LOFTER_ARTICLE_TYPES.find((x) => x.id === String(typeId || '')) || null;
        const prefer = t ? t.preferType : null;
        return pickDiverseAuthors(this.authorsActive(), count, prefer, rng);
    }
    styleList() { return normalizeWritingStyles(this.settings.writingStyles); }
    styleById(id) {
        const want = String(id || '');
        const list = this.styleList();
        for (let i = 0; i < list.length; i++) if (list[i].id === want) return list[i];
        return null;
    }
    /** 给一篇文章挑一款文风（源 `_resolveWritingStyle`；坏 id ⇒ 现掷一款）。 */
    pickStyle(id, rng) { return resolveWritingStyle(this.styleList(), id, rng); }
    lengthOptions() { return LOFTER_CHAPTER_LENGTHS; }
    lengthOf(key) { return chapterLengthSpec(key); }
    articleTypes() { return LOFTER_ARTICLE_TYPES.slice(); }
    /** 数据层 `readLofterFace` 的直接消费点：内容面是三态（缺键 / 空 / 有），不许塌成一态。 */
    contentFace() { return readLofterFace(this._readJSON(CONTENT_KEY)); }
    /** 数据层 `LOFTER_WRITING_STYLES` 的直接消费点：内置款（视图标「内置」徽标用）。 */
    builtInStyleIds() { return LOFTER_WRITING_STYLES.map((s) => s.id); }
    /* ---------- 互动 ---------- */
    flagsOf(id) { return myArticleFlags(this.store, id); }
    /** 四个开关共用一个口径：切换 → 落盘 → 重取（**切换本身不掷随机、不碰别的 App**）。 */
    _toggle(field, id) {
        const v = String(id || '');
        if (!v) return { ok: false, error: '这条文章找不到了' };
        this.store[field] = toggleInList(this.store[field], v);
        this._persistStore();
        this.probe();
        return { ok: true, on: this.store[field].indexOf(v) >= 0 };
    }
    toggleLike(id) { return this._toggle('myLikedArticleIds', id); }
    toggleFavorite(id) { return this._toggle('myFavoritedArticleIds', id); }
    toggleReadLater(id) { return this._toggle('myReadLaterArticleIds', id); }
    /** 打开文章 = 记一次足迹（源 `openArticleDetail` 顺手 push 足迹）。 */
    openArticle(id) {
        const a = this.articleById(id);
        if (!a) return { ok: false, error: '这条文章找不到了' };
        const r = recordFootprint(this.store.myFootprintArticleIds, a.id);
        this.store.myFootprintArticleIds = r.list;
        this._persistStore();
        this._current = a.id;
        return { ok: true, dropped: r.dropped };
    }
    currentId() { return this._current; }
    setCurrent(id) { this._current = String(id || ''); return this._current; }
    toggleFollowAuthor(id) {
        const a = this.authorById(id);
        if (!a) return { ok: false, error: '这位作者找不到了' };
        const r = this._toggle('followedAuthorIds', a.id);
        return Object.assign({ author: a.name }, r);
    }
    toggleSubscribeCollection(id) {
        const c = this.collectionById(id);
        if (!c) return { ok: false, error: '这个合集找不到了' };
        const r = this._toggle('subscribedCollectionIds', c.id);
        return Object.assign({ collection: c.name }, r);
    }
    /** 订阅 tag：**有上界**，超限丢最早的并如实回报丢了几个。 */
    subscribeTag(tag) {
        const r = addSubscribedTag(this.store.subscribedTags, tag);
        if (r.added || r.dropped) { this.store.subscribedTags = r.list; this._persistStore(); }
        return { ok: r.added, tag: String(tag || ''), dropped: r.dropped, count: r.list.length };
    }
    unsubscribeTag(tag) {
        const t = String(tag || '').replace(/^#/, '').trim();
        const before = this.store.subscribedTags.length;
        this.store.subscribedTags = this.store.subscribedTags.filter((x) => x !== t);
        if (this.store.subscribedTags.length !== before) this._persistStore();
        return { ok: before !== this.store.subscribedTags.length, count: this.store.subscribedTags.length };
    }
    /* ---------- 评论（楼中楼） ---------- */
    commentsOf(id) {
        const a = this.articleById(id);
        return a && Array.isArray(a.comments) ? a.comments.slice() : [];
    }
    commentRows(id) { return flattenComments(buildCommentTree(this.commentsOf(id))); }
    commentCountOf(id) { return commentCountFace(this.commentsOf(id)); }
    /**
     * 发一条评论 / 回复。**本件允许用户评论**（源铁律是「用户不能发文」，评论不在禁止之列）。
     * 回复目标若已到**最深一层**，自动改挂到该线程顶层（源无此保护，会越挂越深）。
     */
    addComment(id, text, replyToId) {
        const a = this.articleById(id);
        if (!a) return { ok: false, error: '这条文章找不到了' };
        const body = String(text || '').trim();
        if (!body) return { ok: false, error: '评论不能空着' };
        const names = this._ctxNames();
        const rows = flattenComments(buildCommentTree(Array.isArray(a.comments) ? a.comments : []));
        let parent = String(replyToId || '');
        let rehomed = false;
        if (parent) {
            const node = rows.find((n) => n.id === parent);
            if (!node) { parent = ''; }
            else if (node.depth >= LOFTER_LIMITS.maxCommentDepth) {
                const top = topAncestorId(Array.isArray(a.comments) ? a.comments : [], parent);
                if (top && top !== parent) { parent = top; rehomed = true; }
            }
        }
        const list = Array.isArray(a.comments) ? a.comments.slice() : [];
        const seq = list.length + 1;
        list.push({
            id: a.id + '_uc' + seq,
            author: names.myName,
            content: body,
            replyToCommentId: parent || null,
            likes: 0,
            isOpReply: false,
            createdAt: Date.now(),
        });
        const capped = pruneList(list, LOFTER_LIMITS.maxCommentsPerArticle);
        a.comments = capped.kept;
        a.stats = Object.assign({}, a.stats, { comments: capped.kept.length });
        this._persistContent();
        this.probe();
        return { ok: true, rehomed, expired: capped.expired, count: capped.kept.length };
    }
    /** 作者回一条（宿主给了内容，本件只登记 —— **不调模型**）。 */
    authorReply(id, replyToId, text) {
        const a = this.articleById(id);
        if (!a) return { ok: false, error: '这条文章找不到了' };
        const body = String(text || '').trim();
        if (!body) return { ok: false, error: '回复不能空着' };
        const author = this.authorById(a.authorId);
        const list = Array.isArray(a.comments) ? a.comments.slice() : [];
        list.push({
            id: a.id + '_op' + (list.length + 1),
            author: author ? author.name : a.authorName,
            content: body,
            replyToCommentId: String(replyToId || '') || null,
            likes: 0, isOpReply: true, createdAt: Date.now(),
        });
        const capped = pruneList(list, LOFTER_LIMITS.maxCommentsPerArticle);
        a.comments = capped.kept;
        a.stats = Object.assign({}, a.stats, { comments: capped.kept.length });
        this._persistContent();
        this.probe();
        return { ok: true, expired: capped.expired, count: capped.kept.length };
    }
    /* ---------- 收下宿主机给的产出 ---------- */
    /**
     * 解析并登记一批短文（源 `_generateLofterShorts` → `_parseLofterBatch` → `_buildArticleFromBlock`）。
     * 作者的编号 = **活跃作者池的下标 + 1**（视图给出的提示词里就是这份编号，两边同源）。
     * 坏块**如实计数**（源静默 `continue`）。
     */
    ingestBatch(raw) {
        const pool = this.authorsActive();
        const parsed = parseLofterBatch(raw, pool);
        if (!parsed.length) return { ok: false, error: '没有解析出任何一块（每块要有 TAG: [N1] 与 CONTENT:）', parsed: 0, added: 0 };
        const now = Date.now();
        const added = [];
        for (let i = 0; i < parsed.length; i++) {
            const p = parsed[i];
            const id = 'lof_' + now.toString(36) + '_' + i;
            const art = buildArticleFromBlock(p, { id, now: now + i, cold: coldOfId(id), coverHue: (i * 47) % 360 });
            art.authorId = String((p.author && p.author.id) || '');
            art.authorName = String((p.author && p.author.name) || '');
            art.authorHandle = String((p.author && p.author.handle) || '');
            added.push(art);
        }
        this.articles = added.concat(this.articles);
        const pr = pruneList(this.articles, LOFTER_LIMITS.maxArticles);
        this.articles = pr.kept;
        this._persistContent();
        this.probe();
        return { ok: true, parsed: parsed.length, added: added.length, expired: pr.expired, firstId: added.length ? added[0].id : '' };
    }
    /** 追加一章到合集（章号由 `nextChapterNum` 给，坏值不被 0 带偏）。 */
    ingestChapter(cid, raw) {
        const col = this.collectionById(cid);
        if (!col) return { ok: false, error: '先建一个合集' };
        const text = String(raw || '').trim();
        if (text.length < 5) return { ok: false, error: '正文太短了（至少要 5 个字）' };
        const pool = this.authorsActive();
        const parsed = parseLofterBatch(text, pool);
        const num = nextChapterNum(this.articles, col.id);
        const pos = chapterPositionFace(col, num, false);
        const author = this.authorById(col.authorId) || pool[0];
        const block = parsed.length ? parsed[0] : null;
        const now = Date.now();
        const id = 'lof_' + now.toString(36) + '_c' + num;
        const art = block
            ? buildArticleFromBlock(block, { id, now, cold: coldOfId(id), collectionId: col.id, chapterNum: num, coverHue: col.coverHue })
            : normalizeArticle({
                id, type: 'long', title: col.name + ' · 第 ' + num + ' 章', content: text,
                authorId: String(col.authorId || ''), authorName: String(col.authorName || ''),
                collectionId: col.id, chapterNum: num, tags: [], hasImages: false, imageCount: 0,
                coverHue: col.coverHue, stats: deriveStats(author ? author.followerCount : 1000, coldOfId(id)),
                createdAt: now,
            });
        art.type = 'long';
        art.collectionId = col.id;
        art.chapterNum = num;
        if (author && !art.authorId) { art.authorId = String(author.id); art.authorName = String(author.name); }
        this.articles = [art].concat(this.articles);
        col.chapterCount = Math.max(numOrNull(col.chapterCount) || 0, num);
        this._persistContent();
        this.probe();
        return { ok: true, articleId: art.id, chapterNum: num, position: pos.kind };
    }
    /** 建一个合集（源 `_generateCollectionMeta` 的收口：元信息由宿主给，本件只登记）。 */
    createCollection(meta) {
        const m = (meta && typeof meta === 'object') ? meta : {};
        const name = String(m.name || '').trim();
        if (!name) return { ok: false, error: '合集要有名字' };
        const names = this._ctxNames();
        const author = this.authorById(m.authorId) || this.recommendAuthors(1, m.typeId)[0] || null;
        if (!author) return { ok: false, error: '作者池是空的' };
        const id = 'lofc_' + Date.now().toString(36);
        const col = normalizeCollection({
            id, name,
            description: String(m.description || '').trim(),
            authorId: String(author.id), authorName: String(author.name),
            styleId: m.styleId ? String(m.styleId) : null,
            status: m.status === 'finished' ? 'finished' : 'ongoing',
            chapterCount: 0, coverHue: (name.length * 37) % 360, createdAt: Date.now(),
        });
        col.readerName = names.myName;
        this.collections = [col].concat(this.collections);
        const pr = pruneList(this.collections, LOFTER_LIMITS.maxCollections);
        this.collections = pr.kept;
        this._persistContent();
        this.probe();
        return { ok: true, id: col.id, expired: pr.expired };
    }
    /** 用户自建一位作者（源 `_aiReplenishNpcs` / `openWriterManager` 的手动路径收口）。 */
    addAuthor(input) {
        const s = (input && typeof input === 'object') ? input : {};
        const name = String(s.name || '').trim();
        if (!name) return { ok: false, error: '作者要有名字' };
        const type = isActiveLofterType(s.type) ? String(s.type)
            : (LOFTER_ACTIVE_TYPES.indexOf(String(s.type)) >= 0 ? String(s.type) : 'fan_writer');
        const id = 'lof_a_u' + Date.now().toString(36);
        const a = {
            id, name,
            handle: String(s.handle || '').trim() || ('u_' + id.slice(-5)),
            type,
            bio: String(s.bio || '').trim(),
            contentTags: Array.isArray(s.contentTags)
                ? s.contentTags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 3) : [],
            writingStyle: String(s.writingStyle || '').trim(),
            followerCount: Math.max(0, numOrNull(s.followerCount) === null ? 1000 : Math.trunc(numOrNull(s.followerCount))),
            builtIn: false,
        };
        this.authors = this.authors.concat([a]);
        this._persistContent();
        this.probe();
        return { ok: true, id: a.id, name: a.name, type: a.type };
    }
    /* ---------- 文风库（增删改） ---------- */
    addStyle(name, rules) {
        const n = String(name || '').trim();
        const r = String(rules || '').trim();
        if (!n) return { ok: false, error: '文风要有名字' };
        if (!r) return { ok: false, error: '文风要写点规则（不然模型不知道怎么写）' };
        const list = this.styleList();
        const builtIn = LOFTER_WRITING_STYLES.map((s) => s.name);
        if (builtIn.indexOf(n) >= 0) return { ok: false, error: '内置已经有一款叫「' + n + '」的了，换个名字' };
        const id = 'lof_style_u' + Date.now().toString(36);
        this.settings.writingStyles = list.concat([{ id, name: n, description: '', rules: r, enabled: true, builtIn: false }]);
        this.saveSettings();
        return { ok: true, id, count: this.settings.writingStyles.length };
    }
    removeStyle(id) {
        const want = String(id || '');
        const cur = this.styleById(want);
        if (!cur) return { ok: false, error: '这款文风找不到了' };
        if (cur.builtIn) return { ok: false, error: '内置文风不能删 —— 只想停用就把它关掉（关掉后随机不会抽到它）' };
        this.settings.writingStyles = this.styleList().filter((s) => s.id !== want);
        this.saveSettings();
        return { ok: true, count: this.settings.writingStyles.length };
    }
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
    /* ---------- 注入块（摆给用户复制的，不是请求） ---------- */
    promptShortText(typeId, direction, count, rng) {
        const t = LOFTER_ARTICLE_TYPES.find((x) => x.id === String(typeId || '')) || LOFTER_ARTICLE_TYPES[0];
        const n = Math.max(1, Math.min(5, numOrNull(count) === null ? this.settings.autoGenCount : Math.trunc(numOrNull(count))));
        const picked = this.recommendAuthors(n, t.id, rng);
        const block = lofterPromptBlock('short', {
            authors: picked, articleTypes: [t], userDirection: String(direction || ''), count: n,
        });
        const lines = [];
        lines.push('请写 ' + n + ' 条老福特（LOFTER）短文，每条用一个 ---LOF---- 分隔线隔开（真实分隔写作 ---LOF---）。');
        lines.push('作者池（TAG 里的编号就是这里的序号）：');
        for (let i = 0; i < picked.length; i++) {
            lines.push('  N' + (i + 1) + ' · ' + picked[i].name + '（' + String(picked[i].type) + '）'
                + (picked[i].writingStyle ? ' 文风：' + picked[i].writingStyle : '')
                + ((picked[i].contentTags && picked[i].contentTags.length) ? ' 常写：' + picked[i].contentTags.join('/') : ''));
        }
        lines.push('这次要的形态：' + t.label + (t.baseType ? '（' + t.baseType + '）' : '') + '。');
        if (block.userDirection) lines.push('用户方向：' + block.userDirection);
        lines.push('每块请按这个格式给：TAG: [N1] / TITLE: / SUMMARY: / TAGS: / CONTENT: / HAS_IMAGES: / IMAGE_COUNT: / COMMENT_1: 昵称|内容');
        lines.push('写完之后我会把你给的整段贴回老福特的「收下别处产出的短文」格子里。');
        return lines.join('\n');
    }
    promptChapterText(cid, styleId) {
        const col = this.collectionById(cid);
        if (!col) return { ok: false, error: '这个合集找不到了' };
        const chapters = this.articlesOfCollection(col.id);
        const num = nextChapterNum(this.articles, col.id);
        const style = resolveWritingStyle(this.styleList(), styleId === undefined ? col.styleId : styleId);
        // 三处**直接**调用数据层（不走 lofterPromptBlock 的包装）：前文滑窗 / 篇幅档 / 章节定位。
        const spec = chapterLengthSpec(this.settings.chapterLength);
        const pos = chapterPositionFace(col, num, false);
        const ctx = prevChapterContext(chapters, num, LOFTER_FULL_TEXT_WINDOW);
        const lines = [];
        lines.push('续写《' + col.name + '》第 ' + pos.num + ' 章（' + spec.label + '）。');
        lines.push('定位：' + LABEL_OF_POS[pos.kind] + (pos.alreadyFinished ? '（合集已标完结，这一章按番外写）' : ''));
        if (style) lines.push('文风：' + style.name + ' —— ' + style.rules);
        lines.push('前文给法：最近 ' + LOFTER_FULL_TEXT_WINDOW + ' 章给全文（这里 ' + ctx.fullCount + ' 章），更早给摘要（' + ctx.digestCount + ' 章）。');
        if (ctx.blocks.length) {
            lines.push('前文：');
            for (const b of ctx.blocks) {
                lines.push('  【第 ' + b.num + ' 章 · ' + (b.mode === 'full' ? '全文' : '摘要') + '】' + b.title);
                lines.push('    ' + String(b.text || '').replace(/\s+/g, ' ').slice(0, b.mode === 'full' ? 1200 : 200));
            }
        }
        lines.push('写完把正文贴回「给这个合集续一章」的格子里。');
        return { ok: true, num: pos.num, position: pos.kind, text: lines.join('\n') };
    }
    promptCommentText(articleId, readerText, wantsOpReply) {
        const a = this.articleById(articleId);
        if (!a) return { ok: false, error: '这条文章找不到了' };
        const names = this._ctxNames();
        const block = lofterPromptBlock('comment', {
            articleTitle: a.title || '(无题)', articleAuthor: a.authorName,
            readerName: names.myName, readerText: String(readerText || ''), wantsOpReply: wantsOpReply === true,
        });
        const lines = [];
        lines.push('在老福特《' + block.articleTitle + '》下面，' + block.readerName
            + ' 留了一句：' + (block.readerText || '(什么都没写)'));
        lines.push(block.wantsOpReply
            ? '请以作者「' + block.articleAuthor + '」的口吻回一条（楼中楼，一两句就够）。'
            : '请以别的读者的口吻回一条（楼中楼，一两句就够）。');
        lines.push('回完把那条贴回这篇文章的评论框里（要选「回复某条」就先点那条的回复）。');
        return { ok: true, text: lines.join('\n') };
    }
    /* ---------- 读数 / 注入 ---------- */
    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return LOFTER_LIMITS; }
    readings() { return Object.assign({}, this._readings); }
    stored() { return Object.assign({}, this.store); }
    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到老福特数据';
        if (!p.articles.length && !p.collections.length) return '还没有稿子，也没有合集';
        const bits = [];
        if (p.articles.length) bits.push(p.articles.length + ' 篇稿子');
        if (p.collections.length) bits.push(p.collections.length + ' 个合集');
        if (p.hotTags.length) bits.push('热门 ' + p.hotTags[0].tag);
        if (this.store.followedAuthorIds.length) bits.push('关注 ' + this.store.followedAuthorIds.length + ' 位');
        return bits.join(' · ');
    }
    faceOf(tab) {
        const k = String(tab || '');
        if (k === 'follow') return this.followFeed().length + ' 篇在关注里';
        if (k === 'me') {
            const n = this.store.myLikedArticleIds.length + this.store.myFavoritedArticleIds.length
                + this.store.myReadLaterArticleIds.length;
            return n ? (n + ' 条留在这里') : '还没有存的';
        }
        if (k === 'search') return '按标题 / 正文 / tag 找';
        return this.articlesAll().length + ' 篇在首页';
    }
    /** 「多少篇 / 多少字」读数给视图标题用（都不是随机数）。 */
    statsOf(id) {
        const a = this.articleById(id);
        if (!a) return null;
        const st = (a && a.stats) ? a.stats : { hearts: 0, favorites: 0, comments: 0 };
        return {
            hearts: formatCount(st.hearts), favorites: formatCount(st.favorites),
            comments: formatCount(st.comments),
            raw: st, images: a.imageCount,
        };
    }
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'home');
        this._tab = ['home', 'follow', 'me', 'search'].indexOf(k) >= 0 ? k : 'home';
        return this._tab;
    }
    /* ---------- 设置 ---------- */
    _loadSettings() {
        try { this.settings = normalizeLofterSettings(this._readJSON(SETTINGS_KEY)); }
        catch (_e) { this.settings = defaultLofterSettings(); }
    }
    saveSettings() { this._writeJSON(SETTINGS_KEY, this.settings); }
    patchSettings(patch) {
        this.settings = normalizeLofterSettings(Object.assign({}, this.settings, patch || {}));
        this.saveSettings();
        this.probe();
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：作者池、稿子、合集、关注与订阅、我的四个列表全是「这段关系的账」，故全部重取。 */
    onChatChanged() {
        this._current = '';
        this._tab = 'home';
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new LofterView(this, this.shell, this.storage);
        this._view.render();
    }
}
const LABEL_OF_POS = { opening: '开篇', ongoing: '连载中', ending: '收尾', extra: '番外' };
function toStrArr(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '')) : [];
}
