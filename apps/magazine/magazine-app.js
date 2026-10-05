/* ========================================================
 * magazine-app.js — [v3.36.0] 杂志 App 控制器
 * 照抄 pixiv / lofter / date / taobao 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 Perigee `js/magazine.js`（1971 行 / 118212 字节）。
 * 逐条取舍写在 magazine-data.js 的文件头（取哪几块 / 四块不缝 / 三条偏离）。
 * 这里只记**接线上的五件事**：
 *
 *  【① 不直连任何模型：生成侧归宿主】
 *   源有 8 处 `Utils.callChatAPI`（十种稿件类型各一条链路），自己拼
 *   systemPrompt、自己发请求、自己解析 `TITLE:` 行。
 *   本件一个网络调用都没有。生成走**两条合法通道**：
 *     · 视图把 `magazinePromptBlock()` 产出的要求摆出来给用户复制，粘到对话框；
 *     · 用户把结果贴回视图的文本框，`ingest()` 解析登记。
 *
 *  【② 不碰宿主对象】
 *   源把整块状态经 `Utils.saveData()` 回写（13 处）、往宿主事件总线抛
 *   `emitEvent('magazine_published')`（8 处）、读 `AppState.data.broadcast.officialNpcs`。
 *   本件零宿主写入、零宿主读，落 PhoneStorage 的**三条会话键**。
 *
 *  【③ 不共用别的 App 的池】
 *   源要 `broadcast.officialNpcs` 当受访者池、要 `Forum.getWorldContext()`
 *   当世界观、要 `ttsConfig` 当音频出口。本件**自带原创受访者池**（10 位），
 *   零跨 App 读 —— 兄弟 App 的池改了不该让本件静默变样。
 *
 *  【④ 不动态加载外部脚本、不产二进制】
 *   源 `exportImage()` 从 jsdelivr CDN 动态插 `<script>` 拉 html2canvas，
 *   再把离屏 DOM 画成 PNG data URL。本件一条外链都不收、一张图都不产 ——
 *   导出面只有 TXT 与可打印结构两种纯文本形态。
 *
 *  【⑤ 写盘只走三条键，且都会如实回报裁剪】
 *   稿件 60 / 单篇受访者 8 / 标题 120 字 / 正文 2 万字 / 译文 2 万字 /
 *   块数 400 / 关系图节点 12 都是**本仓新增的显式上界**（源里这些数
 *   全是无界增长）。裁剪与丢弃条数一律回报，不静默吞。
 * ======================================================== */
'use strict';
import {
    MAGAZINE_REASONS, MAGAZINE_LIMITS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS,
    MAGAZINE_FEATURE_TEMPLATES, MAGAZINE_BUILT_IN_PEOPLE, MAGAZINE_DEFAULT_NAME,
    MAGAZINE_INTERVIEW_TYPES,
    clampInt, takeText, defaultMagazineSettings, normalizeMagazineSettings,
    normalizeArticle, normalizeMagazine, nextVol, findArticle, resolvePeople,
    stripMarkdown, parseArticleBody, blocksToText, chartGraph, chartPositions,
    chartFallback, coverFace, searchArticles, snippetOf, groupByType, timeAgoFace,
    magazinePromptBlock, splitTitleAndBody, ingestArticle, translationParagraphs,
    articleToText, magazineToText, printableArticle, projectMagazine, emptyFace,
} from './magazine-data.js';
import { numOrNull } from '../../config/num-gate.js';
import { MagazineView } from './magazine-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^magazine_/`，
   否则跨会话串味。源把全部状态塞在内存的 `AppState.data.magazineData` 里
   （切角色就串味）。本件分三条：设置 / 内容（稿件）/ 台账（检索与分享读数）。 */
const SETTINGS_KEY = 'magazine_settings';
const CONTENT_KEY = 'magazine_content';
const LEDGER_KEY = 'magazine_ledger';

function toStrArr(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) {
        if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
    }
    return out;
}

/** ★ 双引号同样用拼装形（见数据层 `BT` 的注释）—— 裸双引号会让剥注释器在
 *  `'...'` 之外卡住（本仓纪律：代码里不许出现会骗过状态机的裸引号）。 */
const DQ = String.fromCharCode(34);
const BAD_FILE_CHARS = new RegExp('[\\/:*?' + DQ + '<>|]', 'g');

export class MagazineApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = defaultMagazineSettings();
        this.people = MAGAZINE_BUILT_IN_PEOPLE.slice();
        this.articles = [];
        this.ledger = { sharedIds: [], exportedIds: [] };
        this.face = MAGAZINE_REASONS.storage_absent;
        this._proj = null;
        this._readings = { dropped: 0, trimmed: 0, totalArticles: 0, volConflicts: 0, unparsed: 0 };
        this._current = '';
        this._tab = 'list';
        this._view = null;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
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

    _loadSettings() {
        const raw = this._readJSON(SETTINGS_KEY);
        this.settings = normalizeMagazineSettings(raw);
    }
    _persistSettings() { this._writeJSON(SETTINGS_KEY, this.settings); }

    /* ---------- 取数 ---------- */
    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 受访者池 = 内置 10 位 + 用户自建的（内置的**只补缺、不覆盖**用户改过的同 id 项）。
     */
    probe() {
        // ★ 先认 storage 本身可不可用（**异常不许被吞**）——见 `_readRaw` 的注释。
        const rc = this._readRaw(CONTENT_KEY);
        const rl = this._readRaw(LEDGER_KEY);
        let storageOk = rc.ok && rl.ok;
        try {
            const c = (rc.raw && typeof rc.raw === 'object') ? rc.raw : {};
            const userPeople = Array.isArray(c.people) ? c.people : [];
            const byId = new Map();
            for (const p of MAGAZINE_BUILT_IN_PEOPLE) byId.set(String(p.id), p);
            for (const p of userPeople) {
                const id = String((p && p.id) || '');
                if (id) byId.set(id, p);
            }
            this.people = [...byId.values()];
            const m = normalizeMagazine({ magazineName: c.name, articles: c.articles });
            this.articles = m.articles;
            const l = (rl.raw && typeof rl.raw === 'object') ? rl.raw : {};
            this.ledger = {
                sharedIds: toStrArr(l.sharedIds),
                exportedIds: toStrArr(l.exportedIds),
            };
            let unparsed = 0;
            for (const a of this.articles) {
                unparsed += parseArticleBody(a.type, a.content).unknown;
            }
            this._readings = {
                dropped: m.dropped,
                trimmed: this.articles.reduce((s, a) => s + (numOrNull(a.trimmed) || 0), 0),
                totalArticles: this.articles.length,
                volConflicts: m.volConflicts.length,
                unparsed,
            };
            if (m.dropped || m.volConflicts.length) {
                this._writeJSON(CONTENT_KEY, { name: m.name, articles: this.articles, people: userPeople });
            }
        } catch (_e) {
            storageOk = false;
            this.people = MAGAZINE_BUILT_IN_PEOPLE.slice();
            this.articles = [];
            this.ledger = { sharedIds: [], exportedIds: [] };
            this._readings = { dropped: 0, trimmed: 0, totalArticles: 0, volConflicts: 0, unparsed: 0 };
        }
        if (this._current && !this.articleById(this._current)) this._current = '';
        const hasAny = !!(this.articles.length || this.ledger.sharedIds.length || this.ledger.exportedIds.length);
        this.face = storageOk
            ? (hasAny ? MAGAZINE_REASONS.ok : MAGAZINE_REASONS.empty)
            : MAGAZINE_REASONS.storage_absent;
        this._proj = storageOk
            ? projectMagazine({
                settings: this.settings,
                content: { magazineName: this.settings.magazineName, articles: this.articles },
            })
            : null;
    }
    _project() {
        return projectMagazine({
            settings: this.settings,
            content: { magazineName: this.settings.magazineName, articles: this.articles },
        });
    }
    _persistContent() {
        const userPeople = this.people.filter((p) => p && p.builtIn !== true
            && !MAGAZINE_BUILT_IN_PEOPLE.some((b) => b.id === p.id));
        this._writeJSON(CONTENT_KEY, { name: this.settings.magazineName, articles: this.articles, people: userPeople });
    }
    _persistLedger() { this._writeJSON(LEDGER_KEY, this.ledger); }

    /* ---------- 只读面 ---------- */
    articlesAll() { return this.articles.slice(); }
    /** 最新在前（源列表页口径：`.slice().reverse()`）。 */
    articlesNewest() { return this.articles.slice().reverse(); }
    articleById(id) {
        const want = String(id || '');
        for (let i = 0; i < this.articles.length; i++) if (this.articles[i].id === want) return this.articles[i];
        return null;
    }
    /** 取稿 + 存在性（「没有这一篇」与「这一篇是空的」不许塌成一个读数）。 */
    find(id) { return findArticle(this.articles, id); }
    peopleAll() { return this.people.slice(); }
    peopleByIds(ids) { return resolvePeople(ids, this.people); }
    /** 需要受访者的类型（源只在访谈系列上读 npcIds）。 */
    needsPeople(type) { return MAGAZINE_INTERVIEW_TYPES.includes(type); }
    typeLabel(type) { return MAGAZINE_TYPE_LABELS[type] || String(type || ''); }
    typeOptions() {
        return MAGAZINE_TYPES.map((t) => ({ key: t, label: MAGAZINE_TYPE_LABELS[t] }));
    }
    featureOptions() {
        return Object.keys(MAGAZINE_FEATURE_TEMPLATES).map((k) => ({ key: k, label: MAGAZINE_FEATURE_TEMPLATES[k] }));
    }
    groupCounts() { return groupByType(this.articles); }
    cover(id) {
        const a = this.articleById(id);
        return a ? coverFace(a, this.settings.magazineName) : null;
    }
    search(q) { return searchArticles(this.articles, q, 30); }
    snippet(id, q) {
        const a = this.articleById(id);
        return a ? snippetOf(a, q) : '';
    }
    timeFace(id, now) {
        const a = this.articleById(id);
        return a ? timeAgoFace(a.createdAt, now) : { unit: 'none', value: 0 };
    }
    /** 正文结构（视图只画结构，不自己切块 —— 切块只有数据层一份实现）。 */
    blocks(id) {
        const a = this.articleById(id);
        if (!a) return { blocks: [], unknown: 0, total: 0 };
        return parseArticleBody(a.type, a.content);
    }
    /** 关系图读数（节点 / 边 / 配色 / 丢了多少）。 */
    graph(id) {
        const p = this.blocks(id);
        return chartGraph(p.blocks, MAGAZINE_LIMITS.maxChartNodes);
    }
    graphLayout(id) {
        const g = this.graph(id);
        const h = Math.max(300, g.nodes.length * 50 + 60);
        return Object.assign({ nodes: g.nodes, colors: g.colors, edges: g.edges, notes: g.notes },
            chartPositions(g.nodes, 360, h));
    }
    /** 关系图兜底（无节点时原文按纯文本行给回去）。 */
    graphFallback(id) {
        return chartFallback(this.blocks(id).blocks);
    }
    translation(id) {
        const a = this.articleById(id);
        return a ? translationParagraphs(a.translation) : [];
    }
    /** 空白态读数（「还没有稿件」与「读不出来」分开报）。 */
    empty() { return emptyFace(this.face); }
    readings() { return Object.assign({}, this._readings); }
    faceOf() { return this.face; }
    projFace() { return this._proj; }

    /* ---------- 写面 ---------- */
    /** 产「可复制的要求文本」（源在这一步直连模型；本件只产文本）。 */
    promptBlock(type, opts) {
        const o = opts && typeof opts === 'object' ? opts : {};
        const ids = Array.isArray(o.peopleIds) ? o.peopleIds : [];
        const people = resolvePeople(ids, this.people);
        return magazinePromptBlock(type, {
            magazineName: this.settings.magazineName,
            theme: o.theme,
            peopleNames: people.names,
            featureKey: o.featureKey,
            bodyLanguage: this.settings.bodyLanguage,
        });
    }
    /** 登记一篇稿件（用户把生成结果贴回来）。★ 不发任何请求。 */
    ingest(input) {
        const r = ingestArticle(input, this.articles);
        this.articles = r.articles;
        if (r.article) this._current = r.article.id;
        this._persistContent();
        return r;
    }
    /** 直接登记（视图的表单路径；与 ingest 共用同一份规范化）。 */
    addArticle(raw) {
        const vol = nextVol(this.articles);
        const a = normalizeArticle(Object.assign({}, raw, { vol }), this.articles.length);
        if (!a) return { article: null, dropped: 1 };
        this.articles = this.articles.concat([a]);
        let dropped = 0;
        while (this.articles.length > MAGAZINE_LIMITS.maxArticles) { this.articles.shift(); dropped++; }
        this._persistContent();
        return { article: a, dropped };
    }
    removeArticle(id) {
        const want = String(id || '');
        const before = this.articles.length;
        this.articles = this.articles.filter((a) => a.id !== want);
        const removed = before - this.articles.length;
        if (removed) {
            this.ledger.sharedIds = this.ledger.sharedIds.filter((x) => x !== want);
            this.ledger.exportedIds = this.ledger.exportedIds.filter((x) => x !== want);
            this._persistLedger();
            this._persistContent();
        }
        if (this._current === want) this._current = '';
        return { removed };
    }
    /** 改稿件类型（源 `changeArticleType` 直接改字段、连规范化都不走）。 */
    retype(id, type) {
        const a = this.articleById(id);
        if (!a) return { ok: false, reason: 'not_found' };
        if (!MAGAZINE_TYPES.includes(type)) return { ok: false, reason: 'bad_type' };
        const idx = this.articles.indexOf(a);
        const next = normalizeArticle(Object.assign({}, a, { type }), idx);
        this.articles = this.articles.slice();
        this.articles[idx] = next;
        this._persistContent();
        return { ok: true, article: next };
    }
    /** 写译文（源把译文当普通字符串塞进 `article.translation`，不做任何长度约束）。 */
    setTranslation(id, text) {
        const a = this.articleById(id);
        if (!a) return { ok: false, reason: 'not_found', trimmed: 0 };
        const t = takeText(text, MAGAZINE_LIMITS.maxTranslationChars);
        a.translation = t.text;
        this._persistContent();
        return { ok: true, trimmed: t.trimmed };
    }
    rename(name) {
        const t = takeText(name, 40);
        this.settings.magazineName = t.text.trim() || MAGAZINE_DEFAULT_NAME;
        this._persistSettings();
        this._persistContent();
        return { name: this.settings.magazineName, trimmed: t.trimmed };
    }
    setBodyLanguage(lang) {
        this.settings.bodyLanguage = lang === 'cn' ? 'cn' : 'jp';
        this._persistSettings();
        return this.settings.bodyLanguage;
    }
    setDefaultType(type) {
        if (MAGAZINE_TYPES.includes(type)) {
            this.settings.defaultType = type;
            this._persistSettings();
        }
        return this.settings.defaultType;
    }
    /* ---------- 分享与导出（**只产文本**，源这里会写宿主、发请求、画图） ---------- */
    /** 分享文本（源 `showShareSheet` → 存到放送局 / 音频剧两条链；本件只产文本）。 */
    shareText(id) {
        const a = this.articleById(id);
        if (!a) return { text: '', reason: 'not_found' };
        const text = articleToText(a, this.settings.magazineName, this.people);
        if (!this.ledger.sharedIds.includes(a.id)) {
            this.ledger.sharedIds = this.ledger.sharedIds.concat([a.id]);
            this._persistLedger();
        }
        return { text, reason: 'ok' };
    }
    exportOne(id) {
        const a = this.articleById(id);
        if (!a) return { text: '', name: '', reason: 'not_found' };
        const text = articleToText(a, this.settings.magazineName, this.people);
        if (!this.ledger.exportedIds.includes(a.id)) {
            this.ledger.exportedIds = this.ledger.exportedIds.concat([a.id]);
            this._persistLedger();
        }
        return { text, name: this._fileName(a.title || a.theme, 'txt'), reason: 'ok' };
    }
    exportAll() {
        const text = magazineToText({ name: this.settings.magazineName, articles: this.articles }, this.people);
        for (const a of this.articles) {
            if (!this.ledger.exportedIds.includes(a.id)) this.ledger.exportedIds.push(a.id);
        }
        this._persistLedger();
        return { text, name: this._fileName(this.settings.magazineName, 'txt'), reason: 'ok' };
    }
    /** 可打印结构（视图自己建元素；本件不产 HTML 字符串）。 */
    printable(id) {
        const a = this.articleById(id);
        return a ? printableArticle(a, this.settings.magazineName, this.people) : null;
    }
    _fileName(base, ext) {
        const s = String(base || 'article').slice(0, 30).replace(BAD_FILE_CHARS, '_');
        return (s || 'article') + '.' + ext;
    }
    /** 台账读数（分享过几篇 / 导出过几篇）—— 与稿件数**分开报**。 */
    ledgerFace() {
        return {
            shared: this.ledger.sharedIds.length,
            exported: this.ledger.exportedIds.length,
            articles: this.articles.length,
        };
    }

    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'list');
        this._tab = ['list', 'new', 'search', 'settings'].indexOf(k) >= 0 ? k : 'list';
        return this._tab;
    }
    openArticle(id) {
        const f = this.find(id);
        if (!f.found) return { ok: false, reason: 'not_found' };
        this._current = id;
        this._tab = 'reader';
        if (this._view) this._view.refresh();
        return { ok: true, article: f.article };
    }
    backToList() {
        this._current = '';
        this._tab = 'list';
        if (this._view) this._view.refresh();
        return this._tab;
    }
    currentId() { return this._current; }
    /** 摘要行（头部那一行读数；视图不自己拼统计）。 */
    summaryLine() {
        const r = this._readings;
        const l = this.ledgerFace();
        const bits = ['稿件 ' + r.totalArticles + ' 篇'];
        bits.push('分享过 ' + l.shared + ' / 导出过 ' + l.exported);
        if (r.unparsed) bits.push('有 ' + r.unparsed + ' 行没认出来');
        if (r.dropped) bits.push('丢过 ' + r.dropped + ' 条');
        if (r.volConflicts) bits.push('期号撞号 ' + r.volConflicts + ' 次');
        return bits.join(' · ');
    }

    /* ---------- 生命周期 ---------- */
    /** 换会话：稿件、译文、台账全是「这段关系的账」，故全部重取。
     *  （源没有这一步：它的数据在内存里，切角色时**原样留着** —— 串味。） */
    onChatChanged() {
        this._current = '';
        this._tab = 'list';
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new MagazineView(this, this.shell, this.storage);
        this._view.render();
    }
}
