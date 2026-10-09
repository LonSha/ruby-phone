/* ========================================================
 * global-search-engine.js — 小手机全局搜索内核 [v2.16.0]
 * --------------------------------------------------------
 * 现状：29 个 App 各自为政，想找「上次那句台词 / 那个联系人 / 那篇日记 /
 *   设过的那个闹钟」只能逐 App 翻。本模块是**跨 App 统一检索内核**。
 *
 * 设计原则：
 *  1) 纯函数内核：所有数据源经 `sources` 注册表注入，不直接读 window/storage，
 *     内核可单测、可移植（对齐 timeweaver-engine / memory-engine 的约定）。
 *  2) 惰性索引：首次 query 时才拉取各源（每个源独立 try/catch，坏源不影响整体）。
 *  3) 评分排序：标题命中 > 正文命中；前缀命中 > 中部命中；越新越靠前。
 *  4) 截断安全：全部字符串化 + 长度上限，避免大对象把面板拖死。
 * ======================================================== */
'use strict';

// [v3.17.0 R-O2] 补名只读**轻量索引**，不再经业务内核拉完整正文库：
//   搜索只需要「名称 / 类型 / 品阶 / 档位 / 简介」，而 `getCheatById` 来自 `cheat-data.js`，
//   那条边会连带 `data/cheats.js`（1.60MB）进搜索的导入闭包；撩语侧同理连带
//   `data/dirtytalk.js`（0.73MB）+ `data/dirtytalk-corpus.js`（0.15MB）。
//   实测（v3.17.0）：search-app 导入闭包 2,689,609 B → 198,077 B；未压缩字节 2,473,764 → 81,144。
//   同源保证：两份索引与正文由同一生成脚本产出，测试锁定 id 集合与字段逐字相等
//   （本轮实测 166 条武库 + 231 条撩语的搜索字段差异 = 0）。
import { cheatIndex } from '../../data/cheat-index.js';
import { dirtyTalkIndex } from '../../data/dirtytalk-index.js';
import { readPushProbe, evidenceFaceOf } from '../../config/world-bridge.js';
/* [v3.66.0 · X2] 源侧写 ref 与消费侧读 ref 必须**同一支笔**：字段名一漂
 *   （id / itemId / ref 三种写法迟早同时在）就没有任何一处能对账。 */
import { buildOpenRef } from '../../config/open-ref.js';
/* [v3.66.0 · X2] 数值取值走全仓唯一实现（config/num-gate.js），不自带第二份形态判。 */
import { numOrNull } from '../../config/num-gate.js';

const MAX_SNIPPET = 120;
/** [v3.17.0 R-O1] 快速档每源预算：**旧名旧值** —— `tests/system-v327` 锁的就是这个 600。
 *  两档不是「新替旧」：默认路径仍走 600，用户显式点「全历史」才升级。 */
const MAX_SCAN_PER_SOURCE = 600;
/** 全历史档每源预算（单源 20000 条：10000 楼会话也铺得下） */
const MAX_SCAN_PER_SOURCE_FULL = 20000;
/** 全历史档全索引封顶（多源合起来也不失控） */
const MAX_INDEX_FULL = 60000;
/** 分片粒度：每片处理多少条索引条目（只影响节奏，不影响结果集） */
const SCAN_CHUNK = 2000;
/** 展示摘要段：与旧行为同值（`body` 仍是前 600 字） */
const BODY_DISPLAY_CAP = 600;
/** 可检索文本段：一条消息最多 4000 字进检索面（含 600 字之后的尾部余量） */
const BODY_SEARCH_CAP = 4000;

/** 归一化：去首尾空白 + 折叠连续空白 + 小写（用于不区分大小写的匹配） */
function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * [v3.75.0 + R-O5] 单调取时：优先 `performance.now()`（亚毫秒），退回 `Date.now()`。
 * 为什么不用 Date.now() 单独扛：它的 1ms 分辨率会把「单源 20000 条物化」这类真成本读成 0，
 *   于是「源侧代价」永远量不出来 —— 本版要立的正是这条读数（先量后定阈值）。
 * 与 `_yieldTurn` 同族：宿主能力走 globalThis 探测，缺了不抛、只降级。
 * @returns {number}
 */
function nowMs() {
    const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : {};
    if (g.performance && typeof g.performance.now === 'function') return g.performance.now();
    return Date.now();
}

function lower(s) {
    return norm(s).toLowerCase();
}

/**
 * [v3.17.0 R-O2] 轻索引按 id 取元数据。
 * 惰性建 Map（首次用到才建），未知 id 返回 null —— 与 `getCheatById` / `getModuleById`
 * 的对外行为逐条一致（空串、未知 id 一律 null，不猜、不造）。
 * 索引里**没有 content 键**，故返回对象也不合成一个：搜索只用元数据，
 * 「搜索能不能搜到正文」与「详情页能不能打开正文」是两件事，后者按需加载。
 */
let _cheatMetaMap = null;
function _cheatMetaById(id) {
    const k = String(id || '');
    if (!k) return null;
    if (!_cheatMetaMap) {
        _cheatMetaMap = new Map();
        for (const p of Array.isArray(cheatIndex) ? cheatIndex : []) {
            if (p && p.id != null) _cheatMetaMap.set(String(p.id), p);
        }
    }
    return _cheatMetaMap.get(k) || null;
}
let _dtMetaMap = null;
function _dtMetaById(id) {
    const k = String(id || '');
    if (!k) return null;
    if (!_dtMetaMap) {
        _dtMetaMap = new Map();
        for (const m of Array.isArray(dirtyTalkIndex) ? dirtyTalkIndex : []) {
            if (m && m.id != null) _dtMetaMap.set(String(m.id), m);
        }
    }
    return _dtMetaMap.get(k) || null;
}
// 【不导出】这两个取数口只服务本文件的两条源：导出即多一个「零消费导出」要维护，
//   行为面由 tests/system-v3170 经 buildDefaultSources 的 cheat / dirtytalk 两条源真跑。
/**
 * 命中评分。
 * @returns {number} <0 表示未命中
 */
export function scoreHit(title, body, query) {
    const q = lower(query);
    if (!q) return -1;
    const t = lower(title);
    const b = lower(body);
    let score = 0;
    if (t === q) score += 100;
    else if (t.startsWith(q)) score += 80;
    else if (t.includes(q)) score += 60;
    else if (b.includes(q)) score += 30;
    else return -1;
    // 命中越靠前加权
    const pos = b.indexOf(q);
    if (pos >= 0) score += Math.max(0, 12 - Math.floor(pos / 12));
    const tpos = t.indexOf(q);
    if (tpos >= 0) score += Math.max(0, 18 - tpos);
    // 越短越精确（避免长文一段话把短标题压下去）
    score += Math.max(0, 10 - Math.floor(b.length / 200));
    return score;
}

/** 生成带高亮标记的摘要（返回 {text, hit} 便于调用方安全渲染） */
export function makeSnippet(body, query, width = MAX_SNIPPET) {
    const text = norm(body);
    const q = lower(query);
    if (!text) return { text: '', hit: false };
    if (!q) return { text: text.slice(0, width), hit: false };
    const idx = lower(text).indexOf(q);
    if (idx < 0) return { text: text.slice(0, width), hit: false };
    const start = Math.max(0, idx - Math.floor((width - q.length) / 2));
    const end = Math.min(text.length, start + width);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return { text: prefix + text.slice(start, end) + suffix, hit: true, index: idx };
}

export class GlobalSearchEngine {
    /**
     * @param {{sources?:Array<object>}} [opts] sources: {id,label,icon,weight?,items:()=>Array}
     */
    constructor(opts = {}) {
        this._sources = [];
        this._index = null;
        this._errors = [];
        if (Array.isArray(opts.sources)) {
            for (const s of opts.sources) this.registerSource(s);
        }
    }

    /**
     * 注册数据源。
     * @param {{id:string,label:string,icon?:string,weight?:number,
     *          items:()=>Array<{title?:string,body?:string,ts?:number,appId?:string,meta?:object}>}} src
     */
    registerSource(src) {
        if (!src || typeof src.items !== 'function') return false;
        const id = String(src.id || '');
        // 幂等：同 id 重复登记会让同一份数据在结果里出现两遍。
        // （旧行为是纯 push，于是「换宿主上下文」只能靠再叠一份来实现。）
        if (id && this._sources.some(s => s.id === id)) return false;
        this._sources.push(this._normalizeSource(src));
        this._index = null;
        return true;
    }
    /**
     * 以同 id 整体换掉一个源（宿主侧数据换了新引用时用）。
     * 找不到同 id 时退化为登记。
     * @returns {boolean} true = 发生了「换」；false = 退化成了新增
     */
    replaceSource(src) {
        if (!src || typeof src.items !== 'function') return false;
        const id = String(src.id || '');
        const i = id ? this._sources.findIndex(s => s.id === id) : -1;
        if (i < 0) { this.registerSource(src); return false; }
        this._sources[i] = this._normalizeSource(src);
        this._index = null;
        return true;
    }
    /**
     * 摘掉一个源（宿主上下文从「有」变「无」，如退出会话）。
     * @returns {boolean} 是否真的摘掉了
     */
    removeSource(id) {
        const key = String(id || '');
        const i = key ? this._sources.findIndex(s => s.id === key) : -1;
        if (i < 0) return false;
        this._sources.splice(i, 1);
        this._index = null;
        return true;
    }
    /** 源描述归一化（登记 / 替换共用同一份口径，避免两份真相） */
    _normalizeSource(src) {
        return {
            id: String(src.id || ''),
            label: String(src.label || src.id || ''),
            icon: String(src.icon || '🔎'),
            weight: Number(src.weight) || 1,
            appId: String(src.appId || src.id || ''),
            items: src.items
        };
    }

    listSources() {
        return this._sources.map(s => ({ id: s.id, label: s.label, icon: s.icon, weight: s.weight }));
    }

    /** 上次索引期间各源的错误（用于自检面板） */
    lastErrors() {
        return this._errors.slice();
    }

    /** 丢掉缓存，下次 query 重新拉取 */
    invalidate() {
        this._index = null;
    }

    /**
     * 惰性构建索引（每源独立容错）。
     *
     * [v3.17.0 R-O1] 两档预算：
     *   快速（默认 `build()`）每源 `MAX_SCAN_PER_SOURCE = 600` —— 旧行为，一字不改；
     *   全历史（`build({ full: true })`）每源 20000 条、全索引封顶 60000 条。
     * 全历史结果**不进**默认缓存（`this._index`）：否则快速档会被上一次全扫污染。
     * 每源的「原始多少 / 索引多少 / 有没有被截」记在 `this._lastScan`，由 `_scope()` 报给 UI。
     * @param {{full?:boolean}} [opts]
     * @returns {Array<object>} 归一化后的条目
     */
    build(opts = {}) {
        const full = opts.full === true;
        if (!full && this._index) return this._index;
        /* [v3.60.0 · 计划 O2] 建索引与全历史分片扫描共用同一份 _indexChunks：
         *   这里**同步抽干**它（不让出）—— 快速档与所有同步调用方
         *   （query / scanScope / 页头读数 / 既有判据）行为一字不改。 */
        const out = [];
        const gen = this._indexChunks({ full: full, sink: out });
        for (let step = gen.next(); !step.done; step = gen.next()) { /* 抽干，不让出 */ }
        if (!full) this._index = out;
        return out;
    }

    /**
     * [v3.60.0 · 计划 O2] 片间让出**宏任务**（不是微任务）。
     * 为什么必须是宏任务：微任务队列在同一轮事件循环里会被抽干 —— 只 await 一枚已决
     *   Promise 等于没让。计时器（含「点了取消」后那枚零延迟计时器）与点击事件排在
     *   **宏任务**队列里；同步扫描不返回，它们永远轮不到 —— 这正是本版要治的形态：
     *   「函数没有异步让出，控制器 Promise.resolve().then() 仅推迟开始」。
     * 没有 setTimeout 的宿主退回 setImmediate / 微任务：内核可单测，也不因宿主差异抛错。
     * @returns {Promise<void>}
     */
    _yieldTurn() {
        return new Promise((resolve) => {
            const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : {};
            if (typeof g.setTimeout === 'function') { g.setTimeout(resolve, 0); return; }
            if (typeof g.setImmediate === 'function') { g.setImmediate(resolve); return; }
            resolve();
        });
    }

    /**
     * [v3.60.0 · 计划 O2] 取数 / 归一化 / 两档预算的**唯一实现**，做成可中断生成器：
     *   · build() 同步抽干（快速档与全部同步调用方一字不改）；
     *   · searchAll() 异步驱动 —— 片前查取消、片后让出一轮宏任务。
     * 为什么合并成生成器而不是并排写两份：本仓「同一口径不许两份实现」——
     *   两档预算、展示段/可检索段分离、每源容错、截断登记只该有一处真源。
     * 让出点：每 SCAN_CHUNK 条之后（生成器 yield，驱动器决定是否等待）。
     * 边界（如实登记，不冒称「全程零阻塞」）：src.items() 本身仍是一次**同步物化** ——
     *   取数口形态被 tests/system-v3170 A2 与 tests/system-v327 B1 锁死（不得前移截断），
     *   它的单次台阶有上界（一源最多 20000 条），耗时进读数但不可中断。
     * @param {{full?:boolean, sink?:Array<object>}} [opts]
     * @returns {Generator<void, Array<object>, void>}
     */
    * _indexChunks(opts = {}) {
        const full = opts.full === true;
        const out = Array.isArray(opts.sink) ? opts.sink : [];
        const perSource = full ? MAX_SCAN_PER_SOURCE_FULL : MAX_SCAN_PER_SOURCE;
        const totalCap = full ? MAX_INDEX_FULL : Infinity;
        const errors = [];
        const perSourceStat = {};
        const cappedSources = [];
        const bodyCappedSources = [];
        try {
            for (const src of this._sources) {
                try {
                    /* [v3.75.0 + R-O5] 取数耗时**计入读数**：源侧 `items()` 仍是一次同步物化
                     *   （形态被 tests/system-v3170 A2 与 tests/system-v327 B1 锁死，不得前移截断），
                     *   但它的代价不再是「看不见的成本」—— 逐源记进 perSource[id].ms。
                     *   为什么必须记：R-O5 第 3 条原文要求「必须计入耗时」。没有这条读数，
                     *   「要不要把截断前移到取数口」就只能靠感觉定。 */
                    const takeT0 = nowMs();
                    const raw = src.items() || [];
                    const takeMs = Math.round((nowMs() - takeT0) * 100) / 100;
                    if (!Array.isArray(raw)) continue;
                    let n = 0;
                    let bodyCapped = false;
                    perSourceStat[src.id] = { raw: raw.length, indexed: 0, capped: false, ms: takeMs };
                    for (const it of raw) {
                        if (n >= perSource || out.length >= totalCap) break;
                        if (!it || typeof it !== 'object') continue;
                        const title = norm(it.title);
                        const body = norm(it.body);
                        if (!title && !body) continue;
                        /* [v3.17.0 R-O1] 展示段与可检索段分离：
                         *   body     = 前 600 字（**展示摘要**，与旧行为逐字同值）；
                         *   bodyFull = 600–4000 字的**尾部余量**，只进命中判定，不进摘要。
                         * 为什么必须分离：长消息的末尾（玩家口中的「最后那句台词」）此前
                         *   根本不在检索面里 —— 搜得到开头、搜不到结尾。 */
                        const bodyFull = body.length > BODY_DISPLAY_CAP ? body.slice(BODY_DISPLAY_CAP, BODY_SEARCH_CAP) : '';
                        if (body.length > BODY_SEARCH_CAP) bodyCapped = true;
                        out.push({
                            sourceId: src.id,
                            sourceLabel: src.label,
                            icon: String(it.icon || src.icon),
                            appId: String(it.appId || src.appId),
                            title: title.slice(0, 120),
                            body: body.slice(0, BODY_DISPLAY_CAP),
                            bodyFull: bodyFull,
                            bodyTruncated: body.length > BODY_SEARCH_CAP,
                            ts: Number(it.ts) || 0,
                            meta: (it.meta && typeof it.meta === 'object') ? it.meta : {}
                        });
                        n++;
                        /* [v3.60.0 · 计划 O2] 每片登记一次已建部分并交还控制权：
                         *   中途被取消时，_lastScan 反映的是**已建部分**，不是上一轮的陈旧读数。 */
                        if (n % SCAN_CHUNK === 0) {
                            perSourceStat[src.id] = { raw: raw.length, indexed: n, capped: false, ms: takeMs };
                            yield;
                        }
                    }
                    const capped = raw.length > n;
                    perSourceStat[src.id] = { raw: raw.length, indexed: n, capped: capped, ms: takeMs };
                    if (capped) cappedSources.push(src.id);
                    if (bodyCapped) bodyCappedSources.push(src.id);
                    if (out.length >= totalCap) break;
                } catch (e) {
                    errors.push({ sourceId: src.id, error: String(e?.message || e) });
                }
            }
        } finally {
            /* 无论抽干、还是被 gen.return() 提前收束，都落一次真实记账
             *   （防「取消之后读数还停在上一轮」这类不报错、只错数的形态）。 */
            this._errors = errors;
            this._lastScan = {
                full: full, perSource: perSourceStat, cappedSources: cappedSources,
                bodyCappedSources: bodyCappedSources, totalCapped: out.length >= totalCap,
                /* [v3.75.0 + R-O5] 已建条数：中途被 gen.return() 收束时，
                 *   这是**已建部分**的真读数（不是上一轮的陈旧值，也不是全量上限）。 */
                indexed: out.length
            };
        }
        return out;
    }
    /**
     * 在**可检索文本**上判分：摘要段 + 尾部余量（两段拼起来就是同一条消息的真身）。
     * @returns {number} <0 表示未命中
     */
    _score(it, q) {
        return scoreHit(it.title, String(it.body || '') + String(it.bodyFull || ''), q);
    }
    /**
     * [v3.17.0 R-O1] 覆盖度声明的**公共**出口。
     * 为什么不让 UI 直接调 `_scope()`：跨类调私有方法会把「报什么」
     *   变成 UI 自己的信规（实测断言也无从下手）；本出口只说「按当前档位扫完是什么样」。
     * @param {boolean} [full] 是否全历史档
     * @param {{coverage?:object}} [opts] 分片扫描方可覆盖读数
     */
    scanScope(full = false, opts = {}) {
        const list = this.build({ full: full === true });
        return this._scope(full === true, opts, list.length);
    }
    /**
     * [v3.17.0 R-O1] 覆盖度声明：让 UI 能说「扫了多少 / 还剩多少 / 谁被截了」，
     *   而不是把「没扫到」默默显示成「没有命中」（本仓对沉默失败的一贯口径）。
     * `opts.coverage` 可由**分片扫描方**覆盖（拉入每源已扫条数与未完成态）；
     *   不传即按本次同步扫描的真实读数报（同步路径没有「还没扫到」这回事）。
     */
    _scope(full, opts, indexLen) {
        const st = this._lastScan || { perSource: {}, cappedSources: [], bodyCappedSources: [], totalCapped: false };
        const cov = (opts.coverage && typeof opts.coverage === 'object') ? opts.coverage : null;
        /* [v3.75.0 + R-O5] pending 是**三态**：数字（已知）/ 0（真的没有剩余）
         *   / null（未知 —— 索引阶段被作废时「还剩多少没建」根本不可得）。
         *   为什么不能塌成 0：UI 读 `Number(pending) > 0`，0 会被显示成
         *   「没有剩余」，而事实是「不知道」—— 把未知读成已知正是本仓最贵的假绿。 */
        const pendingKnown = (cov && cov.pending != null) ? Number(cov.pending) : null;
        const pendingVal = Number.isFinite(pendingKnown) ? pendingKnown
            : ((cov && cov.complete === false) ? null : 0);
        const bySource = (cov && cov.scannedBySource && typeof cov.scannedBySource === 'object') ? cov.scannedBySource : null;
        const scannedBySource = {};
        for (const [id, st1] of Object.entries(st.perSource || {})) {
            scannedBySource[id] = (bySource && bySource[id] != null) ? (Number(bySource[id]) || 0) : (Number(st1.indexed) || 0);
        }
        return {
            mode: full ? 'full' : 'quick',
            full: !!full,
            indexLen: Number(indexLen) || 0,
            scannedBySource: scannedBySource,
            truncatedSources: Array.isArray(cov && cov.truncatedSources) ? cov.truncatedSources.slice() : (st.cappedSources || []).slice(),
            bodyTruncatedSources: (st.bodyCappedSources || []).slice(),
            totalCapped: !!st.totalCapped || !!(cov && cov.totalCapped),
            pending: pendingVal,
            /* [v3.75.0 + R-O5] 作废发生在哪一段：`index` / `match` / null（三态互不同形）。
             *   为什么要有这一格：此前只报 `complete:false`，索引阶段与比中阶段
             *   被作废在读数上同形 —— 用户看不出「取消到底受理在哪一段」。 */
            cancelledAt: (cov && cov.cancelledAt) || null,
            complete: !(cov && cov.complete === false)
        };
    }
    /**
     * 检索。
     * @param {string} query
     * @param {{limit?:number, sourceIds?:string[], full?:boolean,
     *          coverage?:object}} [opts]
     * @returns {{query:string,results:Array,groups:Array,total:number,scanned:number,
     *            errors:Array,scope:object}}
     */
    query(query, opts = {}) {
        const q = norm(query);
        const limit = Math.max(1, Number(opts.limit) || 60);
        const allow = Array.isArray(opts.sourceIds) && opts.sourceIds.length
            ? new Set(opts.sourceIds.map(String))
            : null;
        const full = opts.full === true;
        const all = this.build({ full: full });
        const scope = this._scope(full, opts, all.length);
        if (!q) {
            return { query: '', results: [], groups: [], total: 0, scanned: all.length, errors: this._errors.slice(), scope: scope };
        }
        const weightOf = {};
        for (const s of this._sources) weightOf[s.id] = s.weight;
        const hits = [];
        for (const it of all) {
            if (allow && !allow.has(it.sourceId)) continue;
            const score = this._score(it, q);
            if (score < 0) continue;
            const snip = makeSnippet(String(it.body || '') + String(it.bodyFull || ''), q);
            hits.push({
                ...it,
                score: score * (weightOf[it.sourceId] || 1),
                snippet: snip.text,
                snippetHit: !!snip.hit
            });
        }
        hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
        const results = hits.slice(0, limit);
        /* 按源分组（保留组内排序），便于面板分区展示 */
        const groupMap = new Map();
        for (const r of results) {
            if (!groupMap.has(r.sourceId)) {
                groupMap.set(r.sourceId, { sourceId: r.sourceId, label: r.sourceLabel, icon: r.icon, items: [] });
            }
            groupMap.get(r.sourceId).items.push(r);
        }
        const groups = Array.from(groupMap.values()).sort((a, b) => b.items[0].score - a.items[0].score);
        return {
            query: q,
            results,
            groups,
            total: hits.length,
            scanned: all.length,
            errors: this._errors.slice(),
            scope: scope
        };
    }
    /**
     * 全历史分片扫描（[v3.17.0 R-O1]）。
     * 为什么需要**独立入口**而不是 `query(q, { full: true })` 了事：
     *   长会话（1000/5000/10000 楼）下全量索引的比中是几十到几百毫秒 —— 同步做完会让输入卡住，
     *   也没法显示进度与取消。本入口把「全量索引 → 分片比中 → 报每源覆盖」拆成可中断的片。
     * 两条纪律：
     *   · 分片只影响**节奏**，不影响**结果集** —— 遍历的就是 `full:true` 的全量索引，
     *     不因分片少扫任何一条；
     *   · `isCancelled()` 为真即立刻返回 `cancelled:true` 且 `results:[]` ——
     *     半份结果比空结果更糟（用户会以为「只有这些」）。
     * @param {string} query
     * @param {{limit?:number, sourceIds?:string[], full?:boolean,
     *          onProgress?:Function, isCancelled?:Function}} [opts]
     */
    /**
     * 全历史分片扫描（[v3.17.0 R-O1]，[v3.60.0 · 计划 O2] 让出事件循环）。
     * 为什么需要**独立入口**而不是 `query(q, { full: true })` 了事：
     *   长会话（1000/5000/10000 楼）下全量索引的比中是几十到几百毫秒 —— 同步做完会让输入卡住，
     *   也没法显示进度与取消。本入口把「全量索引 → 分片比中 → 报每源覆盖」拆成可中断的片。
     * 三条纪律：
     *   · 分片只影响**节奏**，不影响**结果集** —— 遍历的就是 `full:true` 的全量索引，
     *     不因分片少扫任何一条；
     *   · `isCancelled()` 为真即立刻返回 `cancelled:true` 且 `results:[]` ——
     *     半份结果比空结果更糟（用户会以为「只有这些」）；
     *   · [v3.60.0 · 计划 O2] 每片之后**让出一轮宏任务**（`_yieldTurn()`）——
     *     建索引阶段也一样。为什么这曾经是个真缺陷：「按 2000 条分片」只换了循环写法，
     *     整个函数从头到尾同步跑完，片间从不让出 —— 计时器（含用户点取消后那枚零延迟
     *     计时器）与点击事件排在宏任务队列里，要等函数返回才轮得到；控制器那层
     *     `Promise.resolve().then()` 只是把开始推到微任务，不是让出。
     * @param {string} query
     * @param {{limit?:number, sourceIds?:string[], full?:boolean,
     *          onProgress?:Function, isCancelled?:Function,
     *          cancelIndex?:boolean}} [opts]
     *   `cancelIndex`（[v3.75.0 + R-O5]，默认 false）为真时，索引片间也受理作废；
     *   默认关是**契约**（见阶段一注释：调用计数被 tests/system-v3170 B5 锁死）。
     * @returns {Promise<object>} 与同步路径同形的结果体
     */
    async searchAll(query, opts = {}) {
        const q = norm(query);
        const limit = Math.max(1, Number(opts.limit) || 60);
        const full = opts.full === true;
        const allow = Array.isArray(opts.sourceIds) && opts.sourceIds.length
            ? new Set(opts.sourceIds.map(String))
            : null;
        const weightOf = {};
        for (const s of this._sources) weightOf[s.id] = s.weight;
        const hits = [];
        const scannedBySource = {};
        /* [v3.75.0 + R-O5] 取消谓言提到开头：索引阶段（阶段一）也要能看到它。
         *   原来它定义在阶段一下方 —— 索引阶段在它之前执行，那时函数还没定义
         *   （不改位置就只能另写一份，而本仓最忌「同一口径两份实现」）。
         *   位置改了，**行为一字未改**（谓言体逐字照搬）。 */
        const cancelledNow = () => {
            try { return typeof opts.isCancelled === 'function' && !!opts.isCancelled(); } catch (_e) { return false; }
        };
        /* ══ 阶段一：建索引（可让出；可选地在片间受理作废） ══
         * [v3.75.0 + R-O5] `opts.cancelIndex === true` 时才在索引片间查取消谓言。
         *   为什么**默认关**：`isCancelled` 的调用计数是既有判据的契约
         *   （tests/system-v3170 B5 锁「第 4 次检查 = 已扫 6000 条」），默认插检查点
         *   会挪动它 —— 「既有调用方与判据一字不改」由「默认关」保证，
         *   而不是靠改判据来迁就实现。
         *   为什么必须**有**这条路径：索引阶段是长会话最贵的一段（10000 楼要建
         *   10000 条对象），此前用户在等待期点「取消」要等整段建完才被受理。
         *   作废时如实报 `indexed`（已建部分）与 `scanned: 0`（一条都没比中过）。 */
        const cancelIndex = opts.cancelIndex === true;
        const all = [];
        const gen = this._indexChunks({ full: full, sink: all });
        while (true) {
            const step = gen.next();
            if (step.done) break;
            /* [v3.60.0 · 计划 O2] 建索引的每一片后让出一轮宏任务。
             *   取消检查**不设在这里**：`isCancelled` 的调用计数是既有判据的契约
             *   （tests/system-v3170 B5 锁的是「第 4 次检查 = 已扫 6000 条」），
             *   在索引阶段插检查点会挪动它 —— 取消语义不该因实现节奏变化而变。
             *   索引阶段仍受档位预算与每源上限约束，单片台阶有界。 */
            await this._yieldTurn();
            if (cancelIndex && cancelledNow()) {
                /* 索引阶段被作废：**不建完**。`gen.return()` 触发生成器的 finally，
                 *   于是 `_lastScan.indexed` 与 `_errors` 落的是**已建部分**的真记账
                 *   （防「取消之后读数还停在上一轮」那类不报错、只错数的形态）。 */
                gen.return();
                return {
                    query: '', results: [], groups: [], total: 0, scanned: 0,
                    indexed: all.length, errors: this._errors.slice(), cancelled: true,
                    scope: this._scope(full, { coverage: { scannedBySource: {}, pending: null, complete: false, cancelledAt: 'index' } }, all.length)
                };
            }
        }
        /* ══ 阶段二：分片比中（检查点原位，片后让出） ══ */
        let processed = 0;
        while (processed < all.length) {
            if (cancelledNow()) {
                return {
                    query: '', results: [], groups: [], total: 0, scanned: processed,
                    indexed: all.length, errors: this._errors.slice(), cancelled: true,
                    scope: this._scope(full, { coverage: { scannedBySource: scannedBySource, pending: Math.max(0, all.length - processed), complete: false, cancelledAt: 'match' } }, all.length)
                };
            }
            const end = Math.min(all.length, processed + SCAN_CHUNK);
            for (; processed < end; processed++) {
                const it = all[processed];
                if (allow && !allow.has(it.sourceId)) continue;
                scannedBySource[it.sourceId] = (scannedBySource[it.sourceId] || 0) + 1;
                if (!q) continue;
                const score = this._score(it, q);
                if (score < 0) continue;
                const snip = makeSnippet(String(it.body || '') + String(it.bodyFull || ''), q);
                hits.push({ ...it, score: score * (weightOf[it.sourceId] || 1), snippet: snip.text, snippetHit: !!snip.hit });
            }
            if (typeof opts.onProgress === 'function') {
                try {
                    opts.onProgress({
                        processed: processed, total: all.length,
                        pending: Math.max(0, all.length - processed),
                        scannedBySource: Object.assign({}, scannedBySource)
                    });
                } catch (_e) { /* 进度回调抛错不得影响检索 */ }
            }
            await this._yieldTurn();
        }
        /* [v3.60.0 · 计划 O2] 收束（排序 / 截取 / 分组）也纳入可中断任务：
         *   命中集可能到 60000 条，排序与分组不是零成本 —— 放在最后一次让出之后，
         *   等于把一段同步台阶留在结尾（本版要治的正是这种「尾巴上的卡顿」）。 */
        await this._yieldTurn();
        hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
        const results = hits.slice(0, limit);
        const groupMap = new Map();
        for (const r of results) {
            if (!groupMap.has(r.sourceId)) groupMap.set(r.sourceId, { sourceId: r.sourceId, label: r.sourceLabel, icon: r.icon, items: [] });
            groupMap.get(r.sourceId).items.push(r);
        }
        const groups = Array.from(groupMap.values()).sort((a, b) => b.items[0].score - a.items[0].score);
        return {
            query: q, results: results, groups: groups, total: hits.length, scanned: processed,
            indexed: all.length, errors: this._errors.slice(), cancelled: false,
            scope: this._scope(full, { coverage: { scannedBySource: scannedBySource, pending: 0, complete: true, cancelledAt: null } }, all.length)
        };
    }

    /**
     * [v3.60.0 · 计划 O2] 一次 build + 覆盖度读数（页头读数专用）。
     * 为什么必须新增出口：`scanScope()` 每次自己 build 一遍；页头要的是「扫了多少条
     *   + 覆盖到什么程度」两件事，原先得调 `build()` 与 `scanScope()` 各一次 ——
     *   全历史档每次重开面板就重复全量建两次索引（O2 计划点名的「scopeSummary 不得每次重复
     *   全历史 build」）。本出口把两件事收成**一次** build。
     * @param {boolean} [full]
     * @param {{coverage?:object}} [opts]
     * @returns {{scanned:number, scope:object}}
     */
    scanSummary(full = false, opts = {}) {
        const list = this.build({ full: full === true });
        return { scanned: list.length, scope: this._scope(full === true, opts, list.length) };
    }
}
/** 时间解析：优先毫秒时间戳，其次 'HH:MM'（按今日折算），最后字符串日期 */
function tsOf(...vals) {
    for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1000000000) return n;
    }
    for (const v of vals) {
        const str = String(v || '').trim();
        if (!str) continue;
        const m = str.match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
            const d = new Date();
            d.setHours(Number(m[1]) || 0, Number(m[2]) || 0, 0, 0);
            return d.getTime();
        }
        const p = Date.parse(str);
        if (Number.isFinite(p)) return p;
    }
    return 0;
}
/**
 * 酒馆正文源：每次调用都现取宿主上下文里的 chat 数组。
 * 之所以做成导出工厂而不是在 buildDefaultSources 里内联一次：
 *   内联版只认「调用那一刻」的数组引用，而搜索 App 是单例、索引源表只在
 *   构造时建一次 —— 宿主上下文晚于构造就绪会永久少这个源，
 *   换会话（数组换成新实例）后又会一直读旧会话。
 * @param {{chat?:Array}} [ctx] 宿主上下文（无宿主 / 结构不符 → null）
 * @returns {{id:string,label:string,icon:string,appId:string,weight:number,items:Function}|null}
 */
export function makeTavernSource(ctx) {
    if (!Array.isArray(ctx?.chat)) return null;
    return {
        id: 'tavern', label: '酒馆正文', icon: '📜', appId: '', weight: 1.0,
        items: () => ctx.chat.map((m, i) => ({
            title: (m?.is_user ? '我' : (m?.name || 'AI')) + ` · 第 ${i + 1} 楼`,
            body: norm(m?.mes || m?.content || ''),
            ts: tsOf(m?.send_date ? Date.parse(m.send_date) : 0),
            icon: '📜', appId: '', meta: { floor: i }
        }))
    };
}
/**
 * 从 RubyPhone 各 App 已落盘数据构建默认源注册表。
 *   每个源的 items() 都是惰性 + 独立 try/catch，任一 App 数据损坏不影响其他。
 * @param {object} storage PhoneStorage（可为 null → 返回空源，便于单测）
 * @param {{chatContext?:object}} [deps]
 */
export function buildDefaultSources(storage, deps = {}) {
    const get = (key, dflt = null) => {
        try { return storage?.get?.(key, dflt) ?? dflt; } catch (_e) { return dflt; }
    };
    const asArray = (v) => {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_e) { return []; } }
        return [];
    };
    const asObj = (v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') { try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch (_e) { return {}; } }
        return {};
    };

    /**
     * [v2.97.0] 现取记忆插件只读快照。
     * 读法收敛到 config/world-bridge.js 的 readPushProbe：本文件不再自己摸桥全局、也不再自判快照形态。
     * **不复制副本到手机键**（防双份真相），不写上游，只读；无桥 / 无快照一律安全返回 null（不抛）。
     */
    const bridgeSnapshot = () => {
        try { return readPushProbe().snapshot; } catch (_e) { return null; }
    };

    const sources = [];

    // ---- 微信：联系人 / 会话（含消息尾巴）----
    sources.push({
        id: 'wechat-chat', label: '微信会话', icon: '💬', appId: 'wechat', weight: 1.5,
        items: () => {
            const d = asObj(get('wechat_data', {}));
            const out = [];
            // 联系人：正文只有备注/关系/来源这类短字段（签名等长字段实际不存在，不留死代码）
            for (const c of asArray(d.contacts)) {
                if (!c) continue;
                out.push({
                    title: String(c.name || c.nickname || c.remark || '未命名联系人'),
                    body: norm([c.remark, c.relation, c.sourceLabel].filter(Boolean).join(' · ')),
                    ts: tsOf(c.updatedAt, c.lastTime),
                    icon: '👤', appId: 'wechat'
                });
            }
            // 会话：消息正文不在 chats[] 里，而在独立分片键 wechat_msg_<chatId>（大厅模式为
            //   phone_wechat_msg_lobby_<chatId>），此处读分片取最近数条做尾巴（读不到则仅索引会话名）。
            for (const ch of asArray(d.chats || d.conversations)) {
                if (!ch) continue;
                const chatId = String(ch.id || '').trim();
                let msgs = asArray(ch.messages);
                if (!msgs.length && chatId) {
                    msgs = asArray(get(`wechat_msg_${chatId}`));
                    if (!msgs.length) msgs = asArray(get(`phone_wechat_msg_lobby_${chatId}`));
                }
                const tail = msgs.slice(-8)
                    .map(m => norm(m?.content || m?.text || m?.specialMessage?.content || ''))
                    .filter(Boolean).join(' ');
                out.push({
                    title: String(ch.name || ch.title || '未命名会话'),
                    body: tail,
                    ts: tsOf(ch.timestamp, ch.updatedAt, ch.lastTime),
                    icon: ch.type === 'group' ? '👥' : '💬', appId: 'wechat'
                });
            }
            return out;
        }
    });

    // ---- 朋友圈（字段实证：name / text / commentList[{name,text}] / timestamp）----
    sources.push({
        id: 'wechat-moments', label: '朋友圈', icon: '🖼️', appId: 'wechat', weight: 1.2,
        items: () => {
            const d = asObj(get('wechat_data', {}));
            return asArray(d.moments).map(m => ({
                title: String(m?.name || '') + (m?.isUserPost ? '（我）' : ''),
                body: norm([
                    m?.text,
                    ...asArray(m?.commentList).map(c => [c?.name, c?.text].filter(Boolean).join('：'))
                ].filter(Boolean).join(' ')),
                ts: tsOf(m?.timestamp),
                icon: '🖼️', appId: 'wechat'
            }));
        }
    });

    // ---- 日记（字段实证：title / date / content / author / createdAt）----
    sources.push({
        id: 'diary', label: '日记', icon: '📔', appId: 'diary', weight: 1.4,
        items: () => asArray(get('diary_entries')).map(e => ({
            title: String(e?.title || e?.date || '一篇日记'),
            body: norm([e?.author, e?.content || e?.body].filter(Boolean).join(' · ')),
            ts: tsOf(e?.createdAt, e?.ts),
            icon: '📔', appId: 'diary'
        }))
    });

    // ---- 短信（会话里 messages[].text；会话无 lastTime，用 messages 尾部时间兜底）----
    sources.push({
        id: 'phone-sms', label: '短信', icon: '📩', appId: 'phone', weight: 1.3,
        items: () => asArray(get('phone_call_sms_conversations')).map(c => {
            if (!c) return null;
            const msgs = asArray(c.messages);
            return {
                title: String(c.name || c.contact || c.number || '短信会话'),
                body: msgs.map(m => norm(m?.text || m?.content || '')).filter(Boolean).join(' '),
                ts: tsOf(c.updatedAt, c.createdAt, msgs[msgs.length - 1]?.createdAt),
                icon: '📩', appId: 'phone'
            };
        }).filter(Boolean)
    });

    // ---- 通话记录（字段实证：caller / time / date / status / transcript）----
    sources.push({
        id: 'phone-call', label: '通话记录', icon: '📞', appId: 'phone', weight: 1.1,
        items: () => asArray(get('phone_call_history')).map(h => ({
            title: String(h?.caller || h?.name || h?.number || '通话'),
            body: norm([
                h?.status,
                Array.isArray(h?.transcript) ? h.transcript.map(t => t?.content || t?.text || '').join(' ') : ''
            ].filter(Boolean).join(' · ')),
            ts: tsOf(h?.ts, h?.timestamp, h?.date),
            icon: '📞', appId: 'phone'
        }))
    });

    // ---- 织光机收藏册（字段实证：title / paragraphs[] / ts / savedAt）----
    sources.push({
        id: 'timeweaver', label: '织光机', icon: '🕰️', appId: 'timeweaver', weight: 1.3,
        items: () => asArray(get('tw_letters')).map(l => ({
            title: String(l?.title || '一段被织起的时光'),
            body: norm(asArray(l?.paragraphs).join(' ')),
            ts: tsOf(l?.ts, l?.savedAt),
            icon: '🕰️', appId: 'timeweaver'
        }))
    });

    // ---- 日历备忘（字段实证：title / dateKey / time / createdAt；无 content 字段）----
    sources.push({
        id: 'calendar', label: '日历备忘', icon: '📅', appId: 'calendar', weight: 1.2,
        items: () => asArray(get('calendar_memos')).map(m => ({
            title: String(m?.title || '备忘'),
            body: norm([m?.dateKey, m?.time, m?.source].filter(Boolean).join(' · ')),
            ts: tsOf(m?.createdAt),
            icon: '📅', appId: 'calendar'
        }))
    });

    // ---- 音乐歌单（字段实证：name / artist；无 addedAt）----
    sources.push({
        id: 'music', label: '音乐', icon: '🎵', appId: 'music', weight: 1.0,
        items: () => asArray(get('music_playlist')).map(s => ({
            title: String(s?.name || s?.title || '歌曲'),
            body: norm([s?.artist, s?.album].filter(Boolean).join(' · ')),
            ts: tsOf(s?.addedAt),
            icon: '🎵', appId: 'music'
        }))
    });

    // ---- 世界脉搏历史：key 为 worldpulse_history_v1，元素 {style,content,floorCount,createdAt} ----
    sources.push({
        id: 'worldpulse', label: '世界脉搏', icon: '🌍', appId: 'worldpulse', weight: 1.2,
        items: () => asArray(get('worldpulse_history_v1')).map(e => ({
            title: String(e?.style || '世界事件') + (e?.floorCount ? ` · 第 ${e.floorCount} 楼` : ''),
            body: norm(e?.content || e?.text || e?.summary || ''),
            ts: tsOf(e?.createdAt, e?.ts),
            icon: '🌍', appId: 'worldpulse'
        }))
    });

    // ---- 微博（热搜 title / 推荐帖 blogger + content）----
    sources.push({
        id: 'weibo', label: '微博', icon: '👁️‍🗨️', appId: 'weibo', weight: 1.1,
        items: () => {
            const hs = asArray(get('weibo_hot_searches')).map(h => ({
                title: String(h?.title || h?.word || h || '热搜'),
                body: String(h?.tag || ''),
                ts: 0, icon: '🔥', appId: 'weibo'
            }));
            const posts = asArray(get('weibo_recommend_posts')).map(p => ({
                title: String(p?.blogger || p?.author || p?.user || '微博'),
                body: norm(p?.content || p?.text || ''),
                ts: tsOf(p?.ts),
                icon: '👁️‍🗨️', appId: 'weibo'
            }));
            return [...posts, ...hs];
        }
    });

    // ---- 记忆系统（longTerm 元素：content / role / floor / metadata）----
    sources.push({
        id: 'memory', label: '记忆', icon: '🧠', appId: 'memory', weight: 1.2,
        items: () => {
            const core = asObj(get('memory_core_v1')) || asObj(get('memory_core'));
            return asArray(core.longTerm || core.memories).map(m => ({
                title: String(m?.title || m?.place || (m?.role === 'user' ? '关于我' : '关于她') || '记忆条目'),
                body: norm(m?.content || m?.text || ''),
                ts: tsOf(m?.ts, m?.createdAt, Date.parse(String(m?.metadata?.lastActive || '')) || 0),
                icon: '🧠', appId: 'memory'
            }));
        }
    });

    // ---- 阅读书架（key 为 ruby_reading_shelf；字段 title / author / addedAt / chapterCount）----
    sources.push({
        id: 'reading', label: '阅读', icon: '📖', appId: 'reading', weight: 1.0,
        items: () => asArray(get('ruby_reading_shelf') ?? get('ruby_reading_books')).map(b => ({
            title: String(b?.title || b?.name || '书籍'),
            body: norm([b?.author, b?.fileName, b?.chapterCount ? `${b.chapterCount} 章` : ''].filter(Boolean).join(' · ')),
            ts: tsOf(b?.addedAt, b?.updatedAt),
            icon: '📖', appId: 'reading'
        }))
    });

    // ---- 成就（ruby_unlocked_achievements 是 {成就id: 解锁时间戳} 映射，
    //      成就名/说明在 data/achievements.json 目录里，运行时经 achievementApp 取目录）----
    sources.push({
        id: 'achievement', label: '成就', icon: '🏆', appId: 'achievement', weight: 1.0,
        items: () => {
            const map = asObj(get('ruby_unlocked_achievements'));
            const catalog = _achievementCatalog();
            return Object.keys(map).map(id => {
                const meta = catalog.get(id) || null;
                return {
                    title: String(meta?.name || id),
                    body: norm([meta?.cat, meta?.intro].filter(Boolean).join(' · ')),
                    ts: tsOf(map[id]),
                    icon: '🏆', appId: 'achievement',
                    meta: { achievementId: id }
                };
            });
        }
    });

    // ---- 小红书（title / content / author）----
    sources.push({
        id: 'xhs', label: '小红书', icon: '📕', appId: 'xhs', weight: 1.1,
        items: () => asArray(get('ruby_xhs_notes')).map(n => ({
            title: String(n?.title || '笔记'),
            body: norm([n?.author, n?.content || n?.text].filter(Boolean).join(' · ')),
            ts: tsOf(n?.ts),
            icon: '📕', appId: 'xhs'
        }))
    });

    // ---- 贴吧（title / content / author）----
    sources.push({
        id: 'tieba', label: '贴吧', icon: '💬', appId: 'tieba', weight: 1.1,
        items: () => asArray(get('ruby_tieba_posts')).map(p => ({
            title: String(p?.title || '帖子'),
            body: norm([p?.author, p?.content || p?.text].filter(Boolean).join(' · ')),
            ts: tsOf(p?.ts),
            icon: '💬', appId: 'tieba'
        }))
    });

    // ---- 通知中心（sys_notifs，含全部历史通知）----
    sources.push({
        id: 'notifications', label: '通知', icon: '🔔', appId: 'notifications', weight: 1.0,
        items: () => asArray(get('sys_notifs')).map(n => ({
            title: String(n?.title || '通知'),
            body: norm([n?.meta?.name, n?.message].filter(Boolean).join(' · ')),
            ts: tsOf(n?.ts),
            icon: '🔔', appId: 'notifications'
        }))
    });

    // ---- 酒馆正文楼层（若注入 chatContext）----
    const tavernSrc = makeTavernSource(deps.chatContext);
    if (tavernSrc) sources.push(tavernSrc);

    // ============ [v2.62.0] 补源：此前 29 个 App 中以下 12 个各自为政、全库零搜索接入 ============
    // 纪律：本地键源走 storage.get（容错），桥面源走 bridgeSnapshot() 现取（不复制副本到手机键，
    //   不写上游，无桥/无快照/无宿主 window 一律安全返回 []，坏数据不拖垮整体）。

    // ---- 万界武库：装配清单（cheat_state_v1.installed[]，id 经纯函数补名）----
    sources.push({
        id: 'cheat', label: '武库', icon: '🗡️', appId: 'cheat', weight: 1.0,
        items: () => {
            const state = asObj(get('cheat_state_v1'));
            const ids = asArray(state.installed).map(x => String(x)).filter(Boolean);
            const out = [];
            for (const id of ids) {
                const p = _cheatMetaById(id);
                if (!p) continue; // 未知 id 如实丢弃（与 cheat-app 的 sanitize 口径一致）
                out.push({ title: String(p.name || id), body: norm([p.type, p.quality, p.desc].filter(Boolean).join(' · ')), icon: '🗡️', appId: 'cheat', meta: { id } });
            }
            return out;
        }
    });

    // ---- 撩语：装配清单（dt_state_v1.installed[]，id 经纯函数补名）----
    sources.push({
        id: 'dirtytalk', label: '撩语', icon: '💋', appId: 'dirtytalk', weight: 1.0,
        items: () => {
            const state = asObj(get('dt_state_v1'));
            const ids = asArray(state.installed).map(x => String(x)).filter(Boolean);
            const out = [];
            for (const id of ids) {
                const m = _dtMetaById(id);
                if (!m) continue;
                out.push({ title: String(m.name || id), body: norm([m.cat, m.label, m.tier, m.desc].filter(Boolean).join(' · ')), icon: '💋', appId: 'dirtytalk', meta: { id } });
            }
            return out;
        }
    });

    // ---- 幸运转盘：抽卡记录（ruby_gacha_state.history[]，带道具名/品质/花费/时间）----
    sources.push({
        id: 'gacha', label: '幸运转盘', icon: '🎰', appId: 'gacha', weight: 0.9,
        items: () => {
            const d = asObj(get('ruby_gacha_state'));
            const hist = Array.isArray(d.history) ? d.history : [];
            const out = [];
            for (const h of hist.slice(-20)) {
                if (!h || typeof h !== 'object') continue;
                const got = asArray(h.got).map(g => g && [g.name, g.quality].filter(Boolean).join(':')).filter(Boolean).join('、');
                out.push({
                    title: got ? ('抽卡：' + got.slice(0, 30)) : '抽卡记录',
                    body: norm([h.poolId, h.cost ? '花费 ' + h.cost : ''].filter(Boolean).join(' · ')),
                    ts: tsOf(h.at), icon: '🎰', appId: 'gacha'
                });
            }
            return out;
        }
    });

    // ---- 生理：周期/妊娠/病症/胎儿（ruby_health_cycle，独立会话键，对象形态）----
    sources.push({
        id: 'health', label: '生理', icon: '🩺', appId: 'health', weight: 1.0,
        items: () => {
            const d = asObj(get('ruby_health_cycle'));
            if (!Object.keys(d).length) return [];
            const out = [];
            const parts = [];
            if (d.stage) parts.push('阶段 ' + d.stage);
            if (Number.isFinite(d.cycleDay)) parts.push('周期第 ' + d.cycleDay + ' 天');
            if (d.isPregnant) parts.push('妊娠' + (d.pregnantDays != null ? ' 第 ' + d.pregnantDays + ' 天' : ''));
            if (d.race) parts.push(d.race);
            if (parts.length) out.push({ title: '生理状态', body: norm(parts.join(' · ')), icon: '🩺', appId: 'health' });
            for (const c of asArray(d.conditions)) {
                if (c && typeof c === 'object' && c.name) out.push({ title: '病症：' + norm(c.name), body: norm([c.severity, c.desc].filter(Boolean).join(' · ')), icon: '🤒', appId: 'health' });
            }
            for (const f of asArray(d.fetuses)) {
                if (f && typeof f === 'object') out.push({ title: '胎儿', body: norm([f.race, f.name].filter(Boolean).join(' · ')), icon: '👶', appId: 'health' });
            }
            return out;
        }
    });

    // ---- 相册：本地上传索引（phone_album_upload_index，数组 {path,prefix,createdAt}）----
    sources.push({
        id: 'album', label: '相册', icon: '🖼️', appId: 'album', weight: 0.9,
        items: () => {
            const list = asArray(get('phone_album_upload_index'));
            const out = [];
            for (const item of list) {
                const path = typeof item === 'string' ? item : (item && item.path) || '';
                if (!path) continue;
                const fname = String(path).split('/').pop() || '媒体';
                const prefix = (typeof item === 'object' && item.prefix) ? item.prefix : '';
                out.push({ title: fname, body: norm(prefix), ts: tsOf(typeof item === 'object' ? item.createdAt : 0), icon: '🖼️', appId: 'album' });
            }
            return out;
        }
    });

    // ---- 档案：主角档案 + 生活小档案（桥 snapshot.protagonist / lifeDetails）----
    sources.push({
        id: 'profile', label: '档案', icon: '🪪', appId: 'profile', weight: 1.2,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap) return [];
            const out = [];
            const prot = (snap.protagonist && typeof snap.protagonist === 'object') ? snap.protagonist : null;
            if (prot && Object.keys(prot).length) {
                const kv = Object.entries(prot).filter(([k, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(' · ');
                if (kv) out.push({ title: '主角档案', body: norm(kv), icon: '🪪', appId: 'profile' });
            }
            for (const d of asArray(snap.lifeDetails)) {
                if (!d || typeof d !== 'object') continue;
                out.push({ title: norm(d.text).slice(0, 30) || '生活细节', body: norm([d.tier, (d.topics || []).join('、')].filter(Boolean).join(' · ')), ts: tsOf(d.until), icon: '🪪', appId: 'profile' });
            }
            return out;
        }
    });

    // ---- 剧情线：大纲阶段 + 承诺 + 支线（桥 snapshot.outline / worldProg）----
    sources.push({
        id: 'plotline', label: '剧情线', icon: '🎬', appId: 'plotline', weight: 1.2,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap) return [];
            const out = [];
            const outline = (snap.outline && typeof snap.outline === 'object') ? snap.outline : null;
            const stage = (outline && outline.stage && typeof outline.stage === 'object') ? outline.stage : null;
            if (stage && (stage.title || stage.goal)) {
                out.push({ title: norm(stage.title) || '当前阶段', body: norm([stage.goal, stage.tempo].filter(Boolean).join(' · ')), icon: '🎬', appId: 'plotline' });
                for (const n of asArray(stage.nodes)) {
                    if (n && typeof n === 'object' && (n.title || n.goal)) out.push({ title: norm(n.title) || '节点', body: norm(n.goal), icon: '🎬', appId: 'plotline' });
                }
            }
            const wp = (snap.worldProg && typeof snap.worldProg === 'object') ? snap.worldProg : null;
            if (wp) {
                for (const p of asArray(wp.promises)) {
                    if (p && typeof p === 'object') out.push({ title: '承诺：' + (norm(p.content).slice(0, 26) || '—'), body: norm([p.character, p.status, p.deadlineFloor ? '第 ' + p.deadlineFloor + ' 楼' : ''].filter(Boolean).join(' · ')), icon: '🤝', appId: 'plotline' });
                }
                for (const a of asArray(wp.plotArcs)) {
                    if (a && typeof a === 'object' && (a.title || a.clue)) out.push({ title: norm(a.title) || '支线', body: norm([a.clue, a.status].filter(Boolean).join(' · ')), icon: '🧵', appId: 'plotline' });
                }
            }
            return out;
        }
    });

    // ---- 群像：被追踪角色状态表（桥 snapshot.characters）----
    sources.push({
        id: 'chars', label: '群像', icon: '🎭', appId: 'chars', weight: 1.1,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.characters || typeof snap.characters !== 'object') return [];
            const out = [];
            for (const [name, raw] of Object.entries(snap.characters)) {
                const e = raw && typeof raw === 'object' ? raw : {};
                const fields = (e.fields && typeof e.fields === 'object') ? Object.entries(e.fields).map(([k, v]) => v == null ? '' : k + ':' + v).filter(Boolean).join(' · ') : '';
                const todos = asArray(e.todos).map(t => t && t.text).filter(Boolean).join('、');
                out.push({ title: String(name), body: norm([fields, todos ? '待办:' + todos : ''].filter(Boolean).join(' · ')), ts: tsOf(e.updatedAt), icon: '🎭', appId: 'chars', meta: { floor: e.floor } });
            }
            return out;
        }
    });

    // ---- 时计：剧情时间 + 闪回（桥 snapshot.clock）----
    sources.push({
        id: 'clock', label: '时计', icon: '⏰', appId: 'clock', weight: 1.0,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.clock || typeof snap.clock !== 'object') return [];
            const c = snap.clock;
            const out = [];
            if (c.date || c.label) out.push({ title: norm(c.date) || '剧情时间', body: norm([c.label, c.precision, c.turn ? '第 ' + c.turn + ' 层' : ''].filter(Boolean).join(' · ')), icon: '⏰', appId: 'clock' });
            if (c.lastFlashback && c.lastFlashback.date) out.push({ title: '闪回：' + norm(c.lastFlashback.date), body: norm([c.lastFlashback.label, c.lastFlashback.floor ? '第 ' + c.lastFlashback.floor + ' 楼' : ''].filter(Boolean).join(' · ')), icon: '↩️', appId: 'clock' });
            return out;
        }
    });

    // ---- 世界账本：账本读数（桥 snapshot.worldLedgerRead）----
    sources.push({
        id: 'ledger', label: '世界账本', icon: '📚', appId: 'ledger', weight: 1.0,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.worldLedgerRead || typeof snap.worldLedgerRead !== 'object') return [];
            const w = snap.worldLedgerRead;
            if (!w.ok) return [];
            const counts = (w.counts && typeof w.counts === 'object') ? ('暗流 ' + (w.counts.currents || 0) + ' / 事实 ' + (w.counts.facts || 0) + ' / 人物 ' + (w.counts.people || 0)) : '';
            return [{ title: '世界账本', body: norm([w.describe, counts].filter(Boolean).join(' · ')), ts: tsOf(w.at), icon: '📚', appId: 'ledger' }];
        }
    });

    // ---- 钱袋：账户余额 + 流水（桥 snapshot.moneyLedger）----
    sources.push({
        id: 'wallet', label: '钱袋', icon: '💰', appId: 'wallet', weight: 1.1,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.moneyLedger || typeof snap.moneyLedger !== 'object') return [];
            const ml = snap.moneyLedger;
            const out = [];
            const money = (ml.money && typeof ml.money === 'object') ? ml.money : {};
            for (const [k, a] of Object.entries(money)) {
                const acc = a && typeof a === 'object' ? a : {};
                out.push({ title: String(acc.name || k), body: norm([acc.amount != null ? acc.amount + ' 元' : '', acc.floor ? '第 ' + acc.floor + ' 楼记账' : ''].filter(Boolean).join(' · ')), icon: '💰', appId: 'wallet' });
            }
            const log = Array.isArray(ml.moneyLog) ? ml.moneyLog : [];
            for (const x of log.slice(-20)) {
                if (!x || typeof x !== 'object') continue;
                out.push({ title: String(x.name || x.key || '流水'), body: norm([x.desc, x.delta != null ? (x.delta >= 0 ? '+' : '') + x.delta + ' 元' : '', x.floor ? '第 ' + x.floor + ' 楼' : ''].filter(Boolean).join(' · ')), ts: tsOf(x.timestamp), icon: '💰', appId: 'wallet' });
            }
            return out;
        }
    });

    // ---- [v3.6.0] 证据：九账对账面（桥 snapshot.evidence，经真源纯函数归一）----
    //   上游 v3.214.0 把九本账收成一份可查表（`evidence-workbench.js`）并写进快照，
    //   此前下游**零消费**。这里把它接成可检索源：用户能搜「那个承诺 / 那条伏笔」。
    //
    //   ★ 只经 `evidenceFaceOf(snap)` 归一，**不在这里自己解 `snap.evidence`**：
    //     五态判定（缺席 / 没这面 / 读不出 / 空 / 有条目）的唯一真源在 world-bridge，
    //     抄第二份必然漂移（本仓 J1/J4 与 v2.97「7 份 probeBridge」的同形教训）。
    //     另：本源用的是**同一次** `bridgeSnapshot()` 取到的快照（不额外取数）。
    //
    //   ★ 三态的门槛：只有 `ok` 才建条目 —— `unusable`（九账一本也读不到）与
    //     `empty`（账在位、没条目）都**不建卡**，但理由完全不同（前者等上游修、
    //     后者等剧情推进），故两者在诊断页各有各的话；此处是**检索面**，不重复叙述。
    sources.push({
        id: 'evidence', label: '证据', icon: '🔖', appId: 'diagnose', weight: 1.0,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap) return [];
            const face = evidenceFaceOf(snap);
            if (!face || face.state !== 'ok') return [];
            return (Array.isArray(face.items) ? face.items : []).map((it) => ({
                title: it.title || it.ref || '（无标题）',
                body: norm([
                    it.ledgerLabel ? ('来自 ' + it.ledgerLabel) : '',
                    it.detail,
                    it.status ? ('状态 ' + it.status) : '',
                    /* ★ 楼层未知写「未知」而**不写 0**：0 是「第 0 楼」这个真实读数。 */
                    (it.floor === null || it.floor === undefined) ? '' : ('出处 ' + it.floor + ' 楼')
                ].filter(Boolean).join(' · ')),
                icon: '🔖', appId: 'diagnose',
                meta: { ref: it.ref, ledger: it.ledger, floor: it.floor }
            }));
        }
    });

    // ---- 地点：位置链 + 在场（桥 snapshot.scene）----
    sources.push({
        id: 'place', label: '地点', icon: '📍', appId: 'place', weight: 1.1,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.scene || typeof snap.scene !== 'object') return [];
            const sc = snap.scene;
            if (sc.empty === true || sc.absent === true) return [];
            const out = [];
            const chain = (typeof sc.currentLine === 'string' ? sc.currentLine : (typeof sc.current === 'string' ? sc.current : ''));
            if (chain) out.push({ title: '当前位置', body: norm(chain), icon: '📍', appId: 'place' });
            for (const rec of asArray(sc.presence)) {
                if (!rec || typeof rec !== 'object') continue;
                out.push({ title: String(rec.name || '在场'), body: norm([rec.key, rec.atFloor ? '第 ' + rec.atFloor + ' 楼' : ''].filter(Boolean).join(' · ')), icon: '📍', appId: 'place' });
            }
            return out;
        }
    });

    /* ============================================================
     * [v3.66.0 · 拓展计划 X2 第一切片] 内容桶接入 + 精确打开
     * ------------------------------------------------------------
     * 【修前处境】以上 29 个源只登记了「能搜到」，条目上**一个可定位的身份都没有**：
     *   `meta` 管线早就在（本文件 6 处写 meta），但 `apps/search/*` 对 `.meta`
     *   零消费，视图 `_row()` 也不渲染它，打开只发 `{ appId }`。
     *   ⇒ 「搜到一条旅行费用」与「打开那条费用」之间没有任何桥 —— 用户点进去落在首屏，
     *     还得自己再翻一遍。这不是索引不够，是**结果没有靶心**。
     * 【本切片接 6 个桶】按 agent note 给的内容价值序：旅行费用 → 总结册 → 纪念日 →
     *   曲库 → 创作收藏（pixiv 两型 + 老福特）。规则工作台 / 布局参数等**不接**
     *   —— 它们是定向检索面，接进来只会把矩阵涂满而没有真实用例（X2 验收原话）。
     * 【每条的身份】**一律取真源里既有的稳定 id**：
     *   · traveldesk 费用 `id`（归一函数派生 `tv_e_<下标>` 或上游给的 id）；
     *   · summdesk 记忆 `id`（`sm_m_<时间戳>`）；
     *   · annidate 条目 `id`（`ad_i_<下标>` 或上游给的 id）；
     *   · musicdesk 曲目 `id`（**不是下标** —— 视图的 `data-open` 是下标语义，
     *     删中间项后会串项，正是本仓登记过多次的形态，故这里刻意用 id）；
     *   · pixiv 作品 / 插画 `id`（本就有 `novelById` / `illustById`）；
     *   · lofter 文章 `id`（本就有 `articleById`）。
     * 【为什么 meta.ref 的字段名走 buildOpenRef】源侧写字必须与消费侧读字**同一支笔**，
     *   否则字段名一漂（id / itemId / ref）就没有任何一处能对账。
     * ============================================================ */
    // ---- 旅行记账：费用条目（tv_book.expenses[]）----
    sources.push({
        id: 'traveldesk-expense', label: '旅行费用', icon: '🧾', appId: 'traveldesk', weight: 1.2,
        items: () => {
            const b = asObj(get('tv_book', {}));
            return asArray(b.expenses).map((e) => {
                const id = String((e && e.id) || '');
                if (!id) return null;
                return {
                    title: String((e && e.note) || '') || ('费用 ' + id),
                    body: norm([
                        e && e.payer, e && e.type,
                        (e && e.currency && e.currency !== 'CNY') ? (String(e.currency) + ' ' + String(e.amount === undefined ? '' : e.amount)) : '',
                        (e && e.finalCNY !== undefined) ? ('折合 ' + String(e.finalCNY) + ' CNY') : '',
                        (e && e.isPrivate) ? '私人' : ''
                    ].filter(Boolean).join(' · ')),
                    ts: 0, icon: '🧾', appId: 'traveldesk',
                    meta: { ref: buildOpenRef('expense', id, 'traveldesk') }
                };
            }).filter(Boolean);
        }
    });
    // ---- 总结案头：记忆册（sm_memories[]）----
    sources.push({
        id: 'summdesk-memory', label: '总结记忆', icon: '📝', appId: 'summdesk', weight: 1.3,
        items: () => asArray(get('sm_memories', [])).map((m) => {
            const id = String((m && m.id) || '');
            if (!id) return null;
            return {
                title: String((m && m.title) || '一段总结'),
                body: norm(m && m.content),
                ts: tsOf(m && m.timestamp),
                icon: '📝', appId: 'summdesk',
                meta: { ref: buildOpenRef('memory', id, 'summdesk') }
            };
        }).filter(Boolean)
    });
    // ---- 纪念日数学案头：条目（ad_items[]）----
    sources.push({
        id: 'annidate-item', label: '纪念日', icon: '🎂', appId: 'annidate', weight: 1.1,
        items: () => asArray(get('ad_items', [])).map((it) => {
            const id = String((it && it.id) || '');
            if (!id) return null;
            const d = numOrNull(it && it.date);
            return {
                title: String((it && it.title) || '未命名纪念日'),
                body: norm([
                    it && it.note,
                    (it && it.isStarred) ? '星标' : '',
                    (d === null) ? '' : new Date(d).toISOString().slice(0, 10)
                ].filter(Boolean).join(' · ')),
                ts: d === null ? 0 : d,
                icon: '🎂', appId: 'annidate',
                meta: { ref: buildOpenRef('item', id, 'annidate') }
            };
        }).filter(Boolean)
    });
    // ---- 曲库案头：曲目（musicdesk_lib.songs[]）----
    sources.push({
        id: 'musicdesk-song', label: '曲库曲目', icon: '🎼', appId: 'musicdesk', weight: 1.2,
        items: () => {
            const lib = asObj(get('musicdesk_lib', {}));
            return asArray(lib.songs).map((s) => {
                const id = String((s && s.id) || '');
                if (!id) return null;
                return {
                    title: String((s && s.name) || '曲目'),
                    body: norm([s && s.artist, s && s.album].filter(Boolean).join(' · ')),
                    ts: 0, icon: '🎼', appId: 'musicdesk',
                    meta: { ref: buildOpenRef('song', id, 'musicdesk') }
                };
            }).filter(Boolean);
        }
    });
    // ---- Pixiv：小说与插画（pixiv_content.novels[] / .illustrations[]）----
    sources.push({
        id: 'pixiv-novel', label: 'Pixiv 小说', icon: '📕', appId: 'pixiv', weight: 1.2,
        items: () => {
            const c = asObj(get('pixiv_content', {}));
            return asArray(c.novels).map((n) => {
                const id = String((n && n.id) || '');
                if (!id) return null;
                return {
                    title: String((n && n.title) || '（无题）'),
                    body: norm([n && n.authorName, n && n.synopsis].filter(Boolean).join(' · ')),
                    ts: 0, icon: '📕', appId: 'pixiv',
                    meta: { ref: buildOpenRef('novel', id, 'pixiv') }
                };
            }).filter(Boolean);
        }
    });
    sources.push({
        id: 'pixiv-illust', label: 'Pixiv 插画', icon: '🖼️', appId: 'pixiv', weight: 1.0,
        items: () => {
            const c = asObj(get('pixiv_content', {}));
            return asArray(c.illustrations).map((x) => {
                const id = String((x && x.id) || '');
                if (!id) return null;
                return {
                    title: String((x && x.title) || '（无题）'),
                    body: norm([x && x.authorName, x && x.note].filter(Boolean).join(' · ')),
                    ts: 0, icon: '🖼️', appId: 'pixiv',
                    meta: { ref: buildOpenRef('illust', id, 'pixiv') }
                };
            }).filter(Boolean);
        }
    });
    // ---- 老福特：文章（lofter_content.articles[]）----
    sources.push({
        id: 'lofter-article', label: '老福特文章', icon: '🖋️', appId: 'lofter', weight: 1.2,
        items: () => {
            const c = asObj(get('lofter_content', {}));
            return asArray(c.articles).map((a) => {
                const id = String((a && a.id) || '');
                if (!id) return null;
                return {
                    title: String((a && a.title) || '（无题）'),
                    body: norm([a && a.summary, asArray(a && a.tags).join(' ')].filter(Boolean).join(' · ')),
                    ts: 0, icon: '🖋️', appId: 'lofter',
                    meta: { ref: buildOpenRef('article', id, 'lofter') }
                };
            }).filter(Boolean);
        }
    });

    return sources;
}
function _achievementCatalog() {
    try {
        const app = (typeof window !== 'undefined') ? window.VirtualPhone?.achievementApp : null;
        const data = app?.data || app?.achievementData || app || null;
        const list = Array.isArray(data?.achievementsCatalog) ? data.achievementsCatalog : [];
        const map = new Map();
        for (const a of list) {
            if (a && a.id) map.set(String(a.id), a);
        }
        return map;
    } catch (_e) { return new Map(); }
}

export default GlobalSearchEngine;