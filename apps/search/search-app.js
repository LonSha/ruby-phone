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
        if (!this._fullMode) {
            return { result: this.engine.query(kw, scopeOpt), promise: null };
        }
        if (typeof this.engine.searchAll !== 'function') {
            /* [v3.17.0 R-O1] 内核没有分片入口时的**诚实降级**：
             *   同步跑一次全历史查（如实报覆盖度），而不是退回
             *   「只搜前 600 条还不说」—— 后者正是本版要消灭的那个形态。
             *   判据不问源码文本，只问行为（见 tests/system-v3170 C6）。 */
            return { result: this.engine.query(kw, Object.assign({}, scopeOpt, { full: true })), promise: null };
        }
        const gen = ++this._scanGen;
        this._scanning = true;
        const self = this;
        const p = Promise.resolve().then(() => this.engine.searchAll(kw, Object.assign({}, scopeOpt, {
            full: true,
            onProgress: typeof opt.onProgress === 'function' ? opt.onProgress : null,
            isCancelled: self.cancelToken(gen)
        }))).then((r) => {
            if (self._scanGen !== gen) return { cancelled: true, results: [], scope: r && r.scope };
            self._scanning = false;
            return r;
        });
        return { result: null, promise: p, gen: gen };
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
        </style>`;
    }
}

export default SearchApp;