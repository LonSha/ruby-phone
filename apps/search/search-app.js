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

import { GlobalSearchEngine, buildDefaultSources } from '../memory/global-search-engine.js';
import { SearchView } from './search-view.js';

export class SearchApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.VIEW_ID = 'search-main';
        this.engine = this._buildEngine();
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

    _buildEngine() {
        try {
            const sources = buildDefaultSources(this.storage, { chatContext: this._chatContext() });
            return new GlobalSearchEngine({ sources });
        } catch (e) {
            console.warn('[v2.16.0] 全局搜索索引源构建失败:', e);
            return new GlobalSearchEngine({ sources: [] });
        }
    }

    /** 供页头展示：已接入几个来源、覆盖多少条记录 */
    scopeSummary() {
        try {
            const n = this.engine.listSources().length;
            const scanned = this.engine.build().length;
            return `${n} 个来源 · ${scanned} 条记录`;
        } catch (_e) { return ''; }
    }

    render() {
        // 每次打开都重扫（数据可能刚变化）；检索本身仍在内存索引上完成
        this.engine.invalidate();
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
        </style>`;
    }
}

export default SearchApp;