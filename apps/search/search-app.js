/* ========================================================
 * search-app.js — 全局搜索 App 控制器 [v2.16.0]
 * --------------------------------------------------------
 * 把 29 个 App 的落盘数据接成统一索引源（buildDefaultSources），
 *   由 GlobalSearchEngine 做跨源检索与评分排序。
 *
 * 数据新鲜度：面板每次打开时 invalidate 一次，保证刚发的消息/刚写的日记
 *   立刻可搜；输入过程中复用同一份索引（避免每次按键重扫全库）。
 * ======================================================== */
'use strict';

import { GlobalSearchEngine, buildDefaultSources, makeTavernSource } from '../memory/global-search-engine.js';
import { SearchView } from './search-view.js';
/* [v4.99.5 · R11-X5] 全局检索面（Spotlight）接入。
 *   分工写死：本 App 只做两件事 —— **取四域真源灌进内核** 与 **把内核读数交给桥接层**；
 *   映射（行形状 / 域覆盖三态 / 一句话读数）全在 config/spotlight-face-bridge.js（纯函数），
 *   本件不写第二套口径。取数**只读既有落盘键**，不为这件事新增任何存储键。 */
import {
    mapSpotlightRows, mapDomainCoverage, spotlightLine, domainNotes,
    SPOTLIGHT_FEED_REASONS, SPOTLIGHT_DOMAIN_META
} from '../../config/spotlight-face-bridge.js';
import { buildOpenDetail } from '../../config/app-open-detail.js';
import { APPS } from '../../config/apps.js';
import { SpotlightUniversalSearch, SEARCH_DOMAINS } from '../../config/spotlight-universal-search.js';
/* [v3.97.0 · R3-O4] 问句 → 受控条件（人名 / 时间 / 类型 + 词序容错）的唯一实现。
 *   本 App 只做两件事：把问句交它抽条件（`facetsOf`），再拿条件**过滤**既有命中
 *   （`applyFacets`）——**不重排相关性**（排序仍归引擎的 `scoreHit`），
 *   也**不新建索引、不新建性能守卫**（计划原文逐字点名）。 */
import { facetsOf, applyFacets, recallTermsOf } from '../../config/search-facets.js';
/* [v4.15.0 · R4-O3] 页面状态捕获与恢复(纯函数)。
 *   本层只做两件:把四格交给它归一,以及读写那一个会话键。
 *   **会话围栏由它说话**(appId + chatId 两格逐次比对)——本层不自己判一份。 */
import {
    viewStateKey, captureViewState, restoreViewState, needsRequery
} from '../../config/view-state.js';
/* ★ 键名必须以**字面量**出现在产品面上(实测):
 *   keys 门的 K3 判的是「真仓库里有没有这个键的使用点」,而抽取器认的是
 *   `storage.get('字面量')` 与 `const XXX_KEY = '字面量'` 两种形态。
 *   键名只写在 `viewStateKey('search')` 里(拼接形)时抽取器看不见它 ——
 *   K3 会当场报「幽灵放行条」(它本就该这么做:登记着不存在的使用点就是掩饰)。
 *   故把 appId 收成恒定字面量常量。 */
export const VIEW_STATE_KEY = 'view_state_search';
export class SearchApp {
    constructor(phoneShell, storage, deps = {}) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.VIEW_ID = 'search-main';
        // [v2.81.0] 宿主上下文的取用方式可注入（内联 = 每次现问宿主；快照 = 固定一份）。
        //   默认内联：否则宿主就绪晚于本 App 构造时，「酒馆正文」源会永久缺席。
        this._chatContextProvider = (typeof deps.chatContextProvider === 'function')
            ? deps.chatContextProvider
            : () => this._chatContext();
        /* [v4.32.0 · R5-O5] 相对时间的基准时钟可注入（默认现取本机时间）。
         *   为什么要有这一格：判据要在**固定时钟**下复跑「昨天」的区间；
         *   而生产路径仍取本机现在 —— 取值点只有这一处，视图不另算一遍
         *   （同一读数两处实现必然漂移，本仓反复治理过的那类）。 */
        this._now = (typeof deps.now === 'function') ? deps.now : () => Date.now();
        this.engine = this._buildEngine();
        /* [v3.17.0 R-O1] 全历史模式与取消代际：
         *   `_fullMode` = 用户显式开了全历史（默认仍是快速档，600/源）；
         *   `_scanGen`   = 扫描代际，每轮新检索 +1。取消 / 换会话 / 换关键词 /
         *                  数据变更时旧代立即失效 —— 正在跑的扫描靠它自停（`isCancelled`）。
         *   为什么用代际而不是「清结果」：清结果只能拦住**未开始**的下一轮，
         *   拦不住**已在跑**的那一轮把旧命中写回面板。 */
        this._fullMode = false;
        this._scanGen = 0;
        this._scanning = false;
        /* [v4.99.5 · R11-X5] Spotlight 内核实例（惰性建；这里先置 null，不做任何 IO）。 */
        this._spotlightEngine = null;
        this.view = new SearchView(this);
    }

    /** 取酒馆上下文（用于把正文楼层也纳入索引）；无宿主时返回 null */
    _chatContext() {
        try {
            const ctx = globalThis?.window?.SillyTavern?.getContext?.()
                || globalThis?.window?.parent?.SillyTavern?.getContext?.();
            return ctx || null;
        } catch (_e) { return null; }
    }

    /**
     * [v2.81.0] 把宿主侧源与当前宿主上下文对齐。
     * 面板每次打开时调用：宿主还没就绪 → 保持现状；就绪 → 换上新引用；
     * 上下文消失（退出会话）→ 摘掉。只碰自己负责的源，不碰 App 本地键源。
     */
    _syncHostSources() {
        try {
            const src = makeTavernSource(this._chatContextProvider());
            const has = this.engine.listSources().some(s => s.id === 'tavern');
            if (!src) {
                if (has) this.engine.removeSource('tavern');
                return;
            }
            if (has) this.engine.replaceSource(src);
            else this.engine.registerSource(src);
        } catch (e) {
            console.warn('[v2.81.0] 宿主源同步失败:', e);
        }
    }
    _buildEngine() {
        try {
            const sources = buildDefaultSources(this.storage, { chatContext: this._chatContextProvider() });
            return new GlobalSearchEngine({ sources });
        } catch (e) {
            console.warn('[v2.16.0] 全局搜索索引源构建失败:', e);
            return new GlobalSearchEngine({ sources: [] });
        }
    }

    /**
     * [v3.97.0 · R3-O4] 问句 → 受控条件（人名 / 时间 / 类型 + 词序容错）。
     *
     * 【人名从哪来】本 App 只从**两个既有真源**装配原名清单：
     *   群像 App 的角色表（`charsApp.charsAll()`）与微信通讯录（`cachedWechatData.getContacts()`）。
     *   两处都取不到 ⇒ 传**空清单**：`facetsOf` 会如实记一条 `no-actors` 缺口并
     *   **整条不参与人名筛选**（绝不按不存在的人名筛）。
     *
     * 【`now` 显式取值】相对时间（今天/上周）以「本机现在」为基准 —— 取值唯一，
     *   免得视图另算一遍（同一读数两处实现必然漂移）。
     */
    facets(query) {
        return facetsOf(query, { knownActors: this._knownActors(), now: this._now() });
    }

    /** 引擎已知人名清单（**装配点唯一**：群像角色表 ∪ 微信通讯录）。取不到即空数组。 */
    _knownActors() {
        const out = [];
        const seen = new Set();
        const push = (n) => { const s = String(n || '').trim(); if (s && !seen.has(s)) { seen.add(s); out.push(s); } };
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            const chars = vp && (vp.charsApp || vp.chars);
            const rows = (chars && typeof chars.charsAll === 'function') ? chars.charsAll() : null;
            if (Array.isArray(rows)) for (const r of rows) push(r && (r.name || r.id));
        } catch (_e) { /* 单来源失败不阻断另一来源 */ }
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            const wd = vp && vp.cachedWechatData;
            const rows = (wd && typeof wd.getContacts === 'function') ? wd.getContacts() : null;
            if (Array.isArray(rows)) for (const c of rows) push(c && (c.name || c.remark || c.nickname || c.id));
        } catch (_e) { /* 同上 */ }
        return out;
    }

    /* ════════ [v4.99.5 · R11-X5] 全局检索面（Spotlight 内核）接入 ════════
     * 为什么接在搜索 App：整机已有 36 源引擎（GlobalSearchEngine），但那个内核
     *   **没有域概念、也没有快捷意图语法**；Spotlight 恰好互补（四域清单 + 意图路由）。
     *   两者共用一个面板、各说各的话：36 源引擎画主列表，Spotlight 画**域覆盖读数**
     *   与**意图行**——不合并、不互相冒充（合并会造出第二份「命中总数」的口径）。
     * ★ 本件只做取数与投递，映射全在 config/spotlight-face-bridge.js。
     */

    /** 惰性单例：内核不带 storage 也能跑（它的倒排索引全在内存里）。 */
    _spotlight() {
        if (this._spotlightEngine) return this._spotlightEngine;
        try { this._spotlightEngine = new SpotlightUniversalSearch({ maxHistory: 20 }); } catch (_e) { this._spotlightEngine = null; }
        return this._spotlightEngine;
    }

    /**
     * 取四域真源并灌进内核。**只读既有落盘键**（不为本项新增任何存储键）。
     * 每域返回 `{domain,count,ok,why}`：`ok:false` 才是「数据源没取到」（与「取到了但 0 条」不同形）。
     */
    _spotlightSources() {
        const read = (key, dflt) => {
            try { const v = this.storage?.get?.(key, dflt); return v === undefined || v === null ? dflt : v; } catch (_e) { return dflt; }
        };
        const arr = (v) => {
            if (Array.isArray(v)) return v;
            if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_e) { return []; } }
            return [];
        };
        const obj = (v) => {
            if (v && typeof v === 'object' && !Array.isArray(v)) return v;
            if (typeof v === 'string') { try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch (_e) { return {}; } }
            return {};
        };
        /* ① CONTACTS：通话联系人账 ∪ 微信通讯录（两处都是既有键，取不到算「这一域没取到」）。 */
        const contacts = [];
        const seenC = new Set();
        let contactsOk = false;
        try {
            const rows = arr(read('phone_call_contacts', []));
            if (rows.length || read('phone_call_contacts', null) !== null) contactsOk = true;
            for (const c of rows) {
                const n = String((c && (c.name || c.nickname)) || '').trim();
                if (n && !seenC.has(n)) { seenC.add(n); contacts.push({ id: n, title: n, subtitle: '通话联系人', content: n }); }
            }
        } catch (_e) { contactsOk = false; }
        try {
            const wd = globalThis?.window?.VirtualPhone?.cachedWechatData;
            const rows = (wd && typeof wd.getContacts === 'function') ? wd.getContacts() : null;
            if (Array.isArray(rows)) {
                contactsOk = true;
                for (const c of rows) {
                    const n = String((c && (c.name || c.remark || c.nickname)) || '').trim();
                    if (n && !seenC.has(n)) { seenC.add(n); contacts.push({ id: n, title: n, subtitle: '微信联系人', content: n }); }
                }
            }
        } catch (_e) { /* 单来源失败不牵连另一来源 */ }
        /* ② WECHAT：会话表（既有键 wechat_data）。 */
        const wd = obj(read('wechat_data', {}));
        const chats = arr(wd.chats || wd.conversations);
        const wechat = [];
        for (const ch of chats) {
            if (!ch) continue;
            const id = String(ch.id || ch.name || '').trim();
            if (!id) continue;
            wechat.push({
                id, title: String(ch.name || ch.title || id), subtitle: '微信会话',
                content: String(ch.lastMessage || ch.preview || ''),
                deepLink: { targetApp: 'wechat', view: 'chat', params: { id } }
            });
        }
        /* ③ DIARY：日记条目（既有键 diary_entries）。 */
        const entries = arr(read('diary_entries', []));
        const diary = [];
        for (const e of entries) {
            if (!e) continue;
            const id = String(e.id || e.date || '').trim();
            if (!id) continue;
            diary.push({
                id, title: String(e.title || e.date || '日记'), subtitle: '日记',
                content: String(e.content || e.text || ''),
                deepLink: { targetApp: 'diary', view: 'list', params: { id } }
            });
        }
        /* ④ SETTINGS：应用注册表（89 个 App 的 id/name）——搜 App 名直接开 App。
         *   这一域的数据源是**代码里的注册表**（不是落盘键），故只要 APPS 是数组就算取到。 */
        const apps = Array.isArray(APPS) ? APPS : [];
        const settings = [];
        for (const a of apps) {
            if (!a || !a.id) continue;
            settings.push({
                id: String(a.id), title: String(a.name || a.id), subtitle: '应用', content: String(a.id),
                /* 搜到某个 App 名就**直达那个 App**（不是「去设置页」）——
                 *   meta 的 appId 只是「这一域的默认落点」，命中行自带的 deepLink 优先。 */
                deepLink: { targetApp: String(a.id) }
            });
        }
        const settingsOk = Array.isArray(APPS);
        return {
            entities: [
                { domain: SEARCH_DOMAINS.CONTACTS, rows: contacts },
                { domain: SEARCH_DOMAINS.WECHAT, rows: wechat },
                { domain: SEARCH_DOMAINS.DIARY, rows: diary },
                { domain: SEARCH_DOMAINS.SETTINGS, rows: settings }
            ],
            coverage: [
                { domain: SEARCH_DOMAINS.CONTACTS, count: contacts.length, ok: contactsOk, why: contactsOk ? '' : 'phone_call_contacts 读不到且宿主通讯录不可用' },
                { domain: SEARCH_DOMAINS.WECHAT, count: wechat.length, ok: true, why: '' },
                { domain: SEARCH_DOMAINS.DIARY, count: diary.length, ok: true, why: '' },
                { domain: SEARCH_DOMAINS.SETTINGS, count: settings.length, ok: settingsOk, why: settingsOk ? '' : '应用注册表不可读' }
            ]
        };
    }

    /**
     * 全局检索面读数口（视图唯一入口）。
     * 三态**互不同形**：内核没接上 → `ok:false` + why；接上了但零命中 → 空 rows + 域覆盖说话。
     * @returns {{ok:boolean, why:string, rows:Array, counts:object, domains:Array, intentAction:object|null, line:string, notes:Array}}
     */
    spotlightFace(kw) {
        const empty = (why) => ({
            ok: false, why, rows: [], counts: { total: 0, byDomain: {} },
            domains: [], intentAction: null, line: spotlightLine({ ok: false, why }), notes: []
        });
        const searcher = this._spotlight();
        if (!searcher || typeof searcher.indexEntities !== 'function' || typeof searcher.search !== 'function') {
            return empty(SPOTLIGHT_FEED_REASONS.NO_SPOTLIGHT);
        }
        const src = this._spotlightSources();
        for (const ent of src.entities) {
            try { searcher.indexEntities(ent.domain, ent.rows); } catch (_e) { /* 单域索引失败不阻断余下三域 */ }
        }
        const q = String(kw || '').trim();
        if (!q) {
            /* 空查询：不检索，但仍如实报**域覆盖**（用户一打开就知道哪几域有内容）。 */
            const domains = mapDomainCoverage(src.coverage);
            return {
                ok: true, why: SPOTLIGHT_FEED_REASONS.OK, rows: [], counts: { total: 0, byDomain: {} },
                domains, intentAction: null,
                line: spotlightLine({ ok: true, counts: { total: 0 }, domains }), notes: domainNotes(domains)
            };
        }
        let raw = null;
        try { raw = searcher.search(q, { limit: 60 }); } catch (_e) { raw = null; }
        if (!raw) return empty(SPOTLIGHT_FEED_REASONS.READ_THREW);
        const mapped = mapSpotlightRows(raw, {
            coverage: src.coverage, limit: 60, buildOpenDetail: buildOpenDetail
        });
        const domains = mapped.domains;
        return {
            ok: true, why: '', rows: mapped.rows, counts: mapped.counts, domains,
            intentAction: mapped.intentAction,
            line: spotlightLine(mapped), notes: domainNotes(domains)
        };
    }

    /**
     * 供页头展示：已接入几个来源、覆盖多少条记录、**覆盖到什么程度**。
     * [v3.17.0 R-O1] 后一段是新的：快速档只要有一个源被截，页头就应说明
     *   「N 条已索引 / 某源还有更多」—— 不能把「没扫到」显示成「不存在」。
     */
    scopeSummary() {
        try {
            const n = this.engine.listSources().length;
            const full = this._fullMode === true;
            /* [v3.60.0 · 计划 O2] 读数收成**一次** build：原先 `build()` 与 `scanScope()`
             *   各建一遍全量索引 —— 全历史档每次重开面板就重复全量建两次
             *   （O2 计划点名的「scopeSummary 不得每次重复全历史 build」）。
             *   `scanSummary` 是内核侧的唯一读数出口；内核没有它时退回旧两件（诚实降级）。 */
            const sum = (typeof this.engine.scanSummary === 'function')
                ? this.engine.scanSummary(full)
                : { scanned: this.engine.build({ full: full }).length, scope: this.engine.scanScope(full) };
            const scanned = sum.scanned;
            const scope = sum.scope;
            const base = `${n} 个来源 · ${scanned} 条记录`;
            const truncated = (scope && Array.isArray(scope.truncatedSources)) ? scope.truncatedSources : [];
            if (!truncated.length) return base + (full ? ' · 全历史' : ' · 快速');
            return base + ' · ' + (full ? '全历史' : '快速') + `（${truncated.length} 个来源有更多未索引）`;
        } catch (_e) { return ''; }
    }
    /** 切换快速 / 全历史（切换即作废旧索引与旧扫描） */
    toggleFullMode() {
        this._fullMode = this._fullMode !== true;
        this.invalidateAll();
        return this._fullMode;
    }
    /**
     * [v3.17.0 R-O1] 一次检索的唯一入口：快速档走同步 `query`，全历史档走分片 `searchAll`。
     * @returns {{result:object, promise:(Promise|null)}}
     */
    search(kw, opt = {}) {
        const sourceIds = this.view && this.view._scope ? [this.view._scope] : [];
        const scopeOpt = Array.isArray(sourceIds) && sourceIds[0] ? { sourceIds: sourceIds } : {};
        /* [v4.32.0 · R5-O5] 候选阶段改用**主题词**而非机械整句：
         *   问句「昨天 林安安 还款」整串在正文里连续出现是不可能的，修前因此整句零命中 ——
         *   过滤器再准也是在空集上筛（计划原文「候选阶段用主题 / 结构化条件而非机械整句」）。
         *   词表由 `recallTermsOf` 拆（唯一出处），本层不自己切句。
         *   ★ 拆不出词 ⇒ 空数组 ⇒ 引擎沿用整句比中（旧行为一字不改）。 */
        const recallOpt = (() => {
            try {
                const terms = recallTermsOf(this.facets(kw));
                return terms.length ? { terms: terms } : {};
            } catch (_e) { return {}; }
        })();
        if (!this._fullMode) {
            return { result: this._filterByFacets(this.engine.query(kw, Object.assign({}, scopeOpt, recallOpt)), kw), promise: null };
        }
        if (typeof this.engine.searchAll !== 'function') {
            /* [v3.17.0 R-O1] 内核没有分片入口时的**诚实降级**：
             *   同步跑一次全历史查（如实报覆盖度），而不是退回
             *   「只搜前 600 条还不说」—— 后者正是本版要消灭的那个形态。
             *   判据不问源码文本，只问行为（见 tests/system-v3170 C6）。 */
            return { result: this.engine.query(kw, Object.assign({}, scopeOpt, recallOpt, { full: true })), promise: null };
        }
        const gen = ++this._scanGen;
        this._scanning = true;
        const self = this;
        const p = Promise.resolve().then(() => this.engine.searchAll(kw, Object.assign({}, scopeOpt, recallOpt, {
            full: true,
            onProgress: typeof opt.onProgress === 'function' ? opt.onProgress : null,
            /* [v3.75.0 + R-O5] 索引阶段也受理作废：全历史档最贵的一段就是建索引
             *   （10000 楼要建 10000 条对象）。不传这一格，用户在等待期点
             *   「取消」要等整段建完才被受理 —— 那正是 R-O5 要治的形态。
             *   引擎侧 `isCancelled` 调用计数契约（v3170 B5）走默认关的直调路径。 */
            cancelIndex: true,
            isCancelled: self.cancelToken(gen)
        }))).then((r) => {
            if (self._scanGen !== gen) return { cancelled: true, results: [], scope: r && r.scope };
            self._scanning = false;
            /* [v3.97.0 · R3-O4] 分片档与同步档**同一份筛选口径**（唯一实现 `_filterByFacets`）：
             *   否则「快速档能按人名筛、全历史档不能」—— 同一功能两档行为不同，用户无从预期。 */
            return self._filterByFacets(r, kw);
        });
        return { result: null, promise: p, gen: gen };
    }

    /* [v3.97.0 · R3-O4] 受控筛选的**唯一出口**（同步档与分片档共用同一份口径）。
     *   · 条件由 `facets(query)` 抽（唯一实现）；
     *   · 只**过滤**已检出的行，**不重排相关性**（排序仍归引擎的 `scoreHit`）；
     *   · 结果体原样保留（scope / scanned / errors 一字不动），只换 `results` 与 `groups`；
     *   · 筛选后的读数落进 `facets` 格（条件 + 筛掉多少 + 为什么），供视图如实显示。 */
    _filterByFacets(result, kw) {
        try {
            const r = (result && typeof result === 'object') ? result : null;
            if (!r) return result;
            const f = this.facets(kw);
            /* ★ 「没抽出任何条件」= 没听懂 ⇒ **不筛**（原样返回）。
             *   若把空条件当「全通过」去筛，会把「没听懂」静默显示成「都匹配」。 */
            if (!f.ok) {
                return Object.assign({}, r, { facets: { conditions: null, kept: (r.results || []).length, dropped: 0, byReason: {}, gaps: f.gaps } });
            }
            const applied = applyFacets(r.results || [], f);
            const groupMap = new Map();
            for (const row of applied.rows) {
                if (!groupMap.has(row.sourceId)) groupMap.set(row.sourceId, { sourceId: row.sourceId, label: row.sourceLabel, icon: row.icon, items: [] });
                groupMap.get(row.sourceId).items.push(row);
            }
            const groups = Array.from(groupMap.values()).sort((a, b) => b.items[0].score - a.items[0].score);
            return Object.assign({}, r, {
                results: applied.rows,
                groups,
                total: applied.rows.length,
                facets: {
                    conditions: applied.conditions,
                    kept: applied.kept, dropped: applied.dropped, byReason: applied.byReason,
                    gaps: f.gaps
                }
            });
        } catch (_e) {
            /* 筛选是**增强**，绝不因它抛错让整次检索失败（原样返回未筛结果，并如实留痕）。 */
            try { console.warn('⚠️ 检索条件筛选失败，退回未筛结果：', _e); } catch (_e2) { /* 忽略 */ }
            return result;
        }
    }

    /**
     * [v3.17.0 R-O1] 「数据变了」的唯一出口：索引失效 + **正在跑的扫描作废**。
     * 编辑 / 删楼 / 重生成 / 换会话都走这里（前三个是宿主事件，第四个是换源）。
     * 为什么必须连扫描一起作废：全历史扫一次可能跨几个帧，中途改楼后再把
     *   旧索引的命中写回面板，就是「旧命中」本仓最忌讳的那类错（不报错、只错结果）。
     * @returns {number} 新的代际号
     */
    invalidateAll() {
        this.engine.invalidate();
        this._scanGen++;
        this._scanning = false;
        return this._scanGen;
    }
    /** 换关键词 = 上一轮全历史扫描作废（但索引本身没脏，不 invalidate） */
    newQueryToken() {
        this._scanGen++;
        this._scanning = false;
        return this._scanGen;
    }
    /**
     * [v3.58.0 · 计划 O4] 换会话重绑：本 App 的**扫描代际与源表**都带会话气息。
     *   本 App 此前不在 REBIND 表里（index.js 只在「点开搜索」时懒加载它），
     *   于是换会话后发生了一件不报错、只错结果的事：
     *     ① `_scanGen` 只被「再搜一次 / 再打开面板」推进 —— 换会话不推进它，
     *        上一段会话那轮**还在跑**的全历史扫描因此仍算「当前代际」，
     *        跑完照着自己的 `isCancelled` 判言（`_scanGen !== gen` 为假）把
     *        上一段会话的命中写进面板；
     *     ② `engine` 里的 29 个本地键源与酒馆源，是构造那一刻按**当时**的
     *        会话身份装的 —— 换会话后源表还指着上一段对话的 history 数组。
     *   两件都在这里一次做掉：作废旧扫描（`invalidateAll` 同时 `engine.invalidate()`），
     *   再把宿主侧源重对齐到当前会话（`_syncHostSources`）。
     *   注意与 `render()` 的分工：`render()` 是「打开面板」这条路径，
     *   本方法只管「会话换了」这条路径 —— 两者都必须做，不可互相顶替
     *   （打开面板不会推进代际吗？会。但换会话时用户未必打开面板，
     *   而正在跑的扫描不等面板）。
     */
    onChatChanged() {
        this.invalidateAll();
        this._syncHostSources();
        /* [v4.15.0 · R4-O3] 换会话必须把视图里那份内存快照也丢掉。
         *   为什么：键前缀只保证**存储位置**按会话隔开，
         *   不保证「手上这份是给谁的」——不丢就会把上一段的搜索词贴回新会话。 */
        try { if (this.view) this.view._restored = null; } catch (_e) { /* 视图不在也没什么可丢 */ }
    }
    /** 本轮代际的「取消」谓言（交给引擎的 `isCancelled`） */
    cancelToken(gen) {
        const self = this;
        return function () { return self._scanGen !== gen; };
    }
    render() {
        // 每次打开都重扫（数据可能刚变化）；检索本身仍在内存索引上完成
        this.invalidateAll();
        // [v2.81.0] 顺带对齐宿主侧源：宿主上下文刚就绪 / 刚换会话时，源表不能停在构造那一刻
        this._syncHostSources();
        this.view.render();
    }

    /* ================= [v4.15.0 · R4-O3] 状态捕获 / 恢复 ================= */
    /** 本会话身份(只读)。取不到返回空串(纯函数对空串与空串判「同一段」)。 */
    _chatId() {
        try { return String(this.storage?.currentConversationId || ''); } catch (_e) { return ''; }
    }
    /**
     * 把当前四格写成快照(落 chatMetadata,跟会话走)。
     *   快照里带 appId 与 chatId **两格身份** —— 恢复时逐次比对,不匹配即拒(不贴错)。
     * @returns {{ok:boolean, key:string, reason:string}}
     */
    captureState(raw) {
        const key = VIEW_STATE_KEY;
        if (!key) return { ok: false, key: '', reason: 'no-key' };
        /* 键名由常量给(**字面量已出现在产品面上**),`viewStateKey` 仍用于校验拼法一致。 */
        const expect = viewStateKey('search');
        if (expect !== key) return { ok: false, key: key, reason: 'key-drift' };
        const pack = captureViewState('search', raw, this._chatId());
        if (!pack) return { ok: false, key: key, reason: 'capture-failed' };
        try {
            this.storage?.set?.(key, JSON.stringify(pack));
            return { ok: true, key: key, reason: '' };
        } catch (_e) { return { ok: false, key: key, reason: 'write-threw' }; }
    }
    /**
     * 读回快照并判定**能不能恢复**(五态互不同形)。
     *   ★ 本方法**不改任何东西** —— 把快照交回给视图,由视图决定怎么用。
     *   为什么这么分:控制器不碰 DOM(本 App 既有纪律)。
     */
    restoreState() {
        const key = VIEW_STATE_KEY;
        if (!key) return { ok: false, state: 'unreadable', snapshot: null, why: 'no-key' };
        let raw = undefined;
        try { raw = this.storage?.get?.(key, undefined); } catch (_e) { raw = undefined; }
        return restoreViewState('search', raw, this._chatId());
    }
    /** 恢复后是否需要重跑一次检索(查询词还在但结果已随重绘丢)。 */
    restoredNeedsRequery(snapshot) { return needsRequery(snapshot); }

    css() {
        return `<style>
        .gs-wrap { display:flex; flex-direction:column; height:100%; background:var(--phone-bg, #0f1115); color:#e8eaed; }
        .gs-topbar { padding:14px 16px 6px; }
        .gs-title { font-size:19px; font-weight:700; letter-spacing:.5px; }
        .gs-sub { font-size:11.5px; color:#8b8f96; margin-top:3px; }
        .gs-searchbar { display:flex; align-items:center; gap:8px; margin:6px 16px 8px; padding:9px 12px; border-radius:12px; background:rgba(255,255,255,.07); }
        .gs-searchbar i { color:#8b8f96; font-size:13px; }
        .gs-input { flex:1; min-width:0; border:none; outline:none; background:transparent; color:#e8eaed; font-size:14px; }
        .gs-clear { flex:0 0 auto; width:22px; height:22px; border:none; border-radius:50%; background:rgba(255,255,255,.12); color:#c9ccd1; cursor:pointer; font-size:11px; }
        .gs-scopes { display:flex; gap:6px; padding:2px 16px 10px; overflow-x:auto; scrollbar-width:none; }
        .gs-scopes::-webkit-scrollbar { display:none; }
        .gs-chip { flex:0 0 auto; border:none; border-radius:999px; padding:5px 11px; font-size:12px; background:rgba(255,255,255,.08); color:#c9ccd1; cursor:pointer; white-space:nowrap; }
        .gs-chip-on { background:#4c8bf5; color:#fff; }
        .gs-results { flex:1; overflow-y:auto; padding:0 12px 20px; }
        .gs-count { font-size:11.5px; color:#8b8f96; padding:2px 4px 10px; }
        .gs-group { margin-bottom:12px; }
        .gs-group-head { display:flex; align-items:center; gap:6px; font-size:12px; color:#9aa0a6; padding:6px 4px; }
        .gs-group-num { font-size:10.5px; background:rgba(255,255,255,.1); border-radius:999px; padding:0 6px; }
        .gs-item { display:flex; gap:10px; padding:10px; border-radius:12px; background:rgba(255,255,255,.045); margin-bottom:5px; align-items:flex-start; }
        .gs-item.gs-jumpable { cursor:pointer; }
        .gs-item.gs-jumpable:hover { background:rgba(255,255,255,.09); }
        .gs-item-icon { flex:0 0 26px; width:26px; height:26px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.08); font-size:13px; }
        .gs-item-body { flex:1; min-width:0; }
        .gs-item-title { font-size:13px; font-weight:600; color:#f1f3f4; word-break:break-word; }
        .gs-item-snippet { font-size:12px; color:#b6bac0; margin-top:3px; line-height:1.5; word-break:break-word; }
        .gs-item-meta { font-size:10.5px; color:#7f858b; margin-top:5px; }
        .gs-jump { color:#6ea8fe; }
        /* [v3.86.0 · R-X2] 行面来源链读数：正行说「这条从哪来、上游还在不在」；
           隔离/未纳入那一档用 warn 色单列，与「查不到」区分开。 */
        .gs-prov { font-size:10.5px; color:#8b93a1; margin-top:3px; line-height:1.5; }
        .gs-prov-warn { color:#e0b050; }
        .gs-mark { background:rgba(242,181,68,.28); color:#ffe0a3; border-radius:3px; padding:0 1px; }
        .gs-err { font-size:11px; color:#f87171; padding:6px 4px; }
        .gs-empty, .gs-hint { text-align:center; padding:48px 24px; color:#8b8f96; }
        .gs-empty-icon { font-size:34px; margin-bottom:10px; }
        .gs-empty-title, .gs-hint-title { font-size:14px; color:#c9ccd1; margin-bottom:6px; }
        .gs-empty-sub, .gs-hint-sub { font-size:12px; line-height:1.6; }
        .gs-hint-chips { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin:12px 0; }
        .gs-hint-chip { font-size:11px; padding:3px 9px; border-radius:999px; background:rgba(255,255,255,.07); color:#b6bac0; }
        .gs-hint-tip { font-size:11.5px; line-height:1.7; margin-top:10px; }
        /* [v3.17.0 R-O1] 覆盖度：模式切换 / 扫描进度 / 截断告警 */
        .gs-modebar { display:flex; gap:8px; align-items:center; margin:8px 16px 0; }
        .gs-mode { border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); color:#c9ccd1; border-radius:999px; padding:5px 12px; font-size:12px; cursor:pointer; }
        .gs-mode.gs-mode-on { background:#4c8bf5; border-color:#4c8bf5; color:#fff; }
        .gs-engine-unsupported { font-size:11px; color:#f2b544; }
        .gs-scanbar { display:none; align-items:center; gap:8px; margin:8px 16px 0; padding:8px 12px; border-radius:12px; background:rgba(76,139,245,.12); font-size:11.5px; color:#b6bac0; }
        .gs-scanbar.gs-scan-on { display:flex; }
        .gs-scan-text { flex:1; min-width:0; }
        .gs-scan-cancel { flex:0 0 auto; border:none; border-radius:999px; padding:4px 10px; font-size:11px; background:rgba(255,255,255,.12); color:#e8eaed; cursor:pointer; }
        .gs-group-rest { font-size:10.5px; color:#f2b544; padding:2px 8px 8px; line-height:1.6; }
        /* [v4.99.5 · R11-X5] 全局检索面读数条：域覆盖四态 + 快捷指令行。 */
        .gs-spot { margin:0 16px 8px; padding:9px 11px; border-radius:12px; background:rgba(76,139,245,.08); border:1px solid rgba(76,139,245,.16); }
        .gs-spot-off { background:rgba(242,181,68,.10); border-color:rgba(242,181,68,.22); }
        .gs-spot-line { font-size:12px; color:#9dc0ff; }
        .gs-spot-off .gs-spot-line { color:#f2b544; }
        .gs-spot-sub { font-size:11px; color:#8b8f96; margin-top:3px; }
        .gs-spot-doms { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
        .gs-dom { font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,.08); color:#b6bac0; display:inline-flex; align-items:center; gap:4px; }
        .gs-dom-on { background:rgba(76,139,245,.22); color:#cfe0ff; }
        .gs-dom-empty { background:rgba(255,255,255,.06); color:#8b8f96; }
        .gs-dom-miss { background:rgba(242,181,68,.16); color:#f2b544; }
        .gs-dom-n { font-size:10px; opacity:.8; font-weight:600; }
        .gs-spot-note { font-size:11px; color:#8b8f96; margin-top:5px; line-height:1.5; }
        .gs-spot-miss { color:#e0b050; }
        .gs-intent { display:flex; align-items:center; gap:8px; margin-top:8px; padding:7px 9px; border-radius:10px; background:rgba(76,139,245,.14); cursor:pointer; }
        .gs-intent:hover { background:rgba(76,139,245,.24); }
        .gs-intent-k { font-size:10.5px; padding:1px 7px; border-radius:999px; background:rgba(255,255,255,.12); color:#b6bac0; }
        .gs-intent-v { flex:1; min-width:0; font-size:11.5px; color:#dfe1e5; }
        </style>`;
    }
}

export default SearchApp;