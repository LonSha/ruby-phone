/* ========================================================
 * search-view.js — 全局搜索面板 [v2.16.0]
 * --------------------------------------------------------
 * 一个输入框搜遍 29 个 App：微信会话/朋友圈/日记/短信/通话/织光机/
 *   音乐/世界脉搏/微博/记忆/阅读/成就/小红书/贴吧/通知/酒馆正文……
 * 结果按来源分区，命中片段高亮，点击跳转到来源 App。
 * ======================================================== */
'use strict';
/* [v3.66.0 · X2] 派发载荷走唯一一支笔（config/app-open-detail.js）。
 *   本件是**第一处**把靶心（ref）带进 `phone:openApp` 的派发点 ——
 *   不手写对象字面量，免得字段名与核心那支笔漂开。 */
import { buildOpenDetail } from '../../config/app-open-detail.js';
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\u0022/g, '&quot;').replace(/'/g, '&#39;');
}

/** 把命中的片段切成前/中/后三段，中段加高亮（避免 innerHTML 注入，用转义 + 显式标记） */
function highlight(snippet, query) {
    const text = String(snippet || '');
    const q = String(query || '');
    if (!q) return esc(text);
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const idx = lowerText.indexOf(lowerQ);
    if (idx < 0) return esc(text);
    return esc(text.slice(0, idx))
        + '<mark class="gs-mark">' + esc(text.slice(idx, idx + q.length)) + '</mark>'
        + esc(text.slice(idx + q.length));
}

export class SearchView {
    /** @param {import('./search-app.js').SearchApp} app */
    constructor(app) {
        this.app = app;
        this._keyword = '';
        this._scope = '';       // '' = 全部来源
        this._result = null;
    }

    render() {
        const shell = this.app?.phoneShell;
        if (!shell?.setContent) return;
        // [v2.81.0] 面板重开 = 一次新检索：丢掉上一轮的结果快照。
        //   否则源头改了以后，重开面板仍按旧索引给旧结果（_paint 那条路保持不变，
        //   输入过程中照样复用同一份内存索引，不重扫全库）。
        this._result = null;
        /* [v3.17.0 R-O1] 面板重开 = 上一轮分片扫描的代际作废（`_scanning` 记账一并清）。 */
        this._scanning = null;
        const html = `
        <div class="gs-wrap">
            <div class="gs-topbar">
                <div class="gs-title">全局搜索</div>
                <div class="gs-sub">${esc(this.app.scopeSummary())}</div>
            </div>
            ${this._modeBtnHtml()}
            ${this._scanBarHtml()}
            <div class="gs-searchbar">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input id="gs-input" class="gs-input" type="search" placeholder="搜索聊天、日记、短信、书信……"
                       value="${esc(this._keyword)}" autocomplete="off" />
                ${this._keyword ? '<button class="gs-clear" id="gs-clear" title="清空"><i class="fa-solid fa-xmark"></i></button>' : ''}
            </div>
            <div class="gs-scopes" id="gs-scopes">${this._scopeChips()}</div>
            <div class="gs-results" id="gs-results">${this._resultsHtml()}</div>
        </div>`;
        shell.setContent(this.app.css() + html, 'search-main');
        this._bind();
        if (this.app._fullMode === true && this._keyword && !this._scanning) {
            /* [v3.17.0 R-O1] 全历史档：面板一打开就自动起一轮扫描（快速档仍是「输入才查」，一字不改）。
             *   为什么要 try 住：下面这行会踢出分片扫描并注册 promise，它要是抛了，
             *   用户拿到的是「点了没反应」的面板 —— 比明确报错更难查。 */
            try { this._paint(); } catch (e) { this._paintError(e); }
        }
    }

    _scopeChips() {
        const sources = this.app.engine.listSources();
        const chip = (id, label, icon) => {
            const on = this._scope === id ? ' gs-chip-on' : '';
            return `<button class="gs-chip${on}" data-scope="${esc(id)}">${esc(icon)} ${esc(label)}</button>`;
        };
        return chip('', '全部', '🔎') + sources.map(s => chip(s.id, s.label, s.icon)).join('');
    }

    /**
     * [v3.17.0 R-O1] 结果区。
     *   快速档仍走同步 `query`（与旧行为一字不差）；全历史档交给 `app.search()` 起分片扫描，
     *   本方法先返回一份占位。
     * 为什么不让结果区自己 await：`innerHTML` 是同步赋值，`async` 要等下一个微任务 ——
     *   扫描回来前面板得先有字，不能空着。
     */
    _resultsHtml() {
        const kw = this._keyword.trim();
        if (!kw) return this._hint();
        const full = this.app._fullMode === true;
        if (!this._result) {
            if (full) return this._openScan(kw);
            const out = this.app.search(kw);
            this._result = (out && out.result) ? out.result : null;
        }
        const r = this._result;
        if (!r) return this._scanPlaceholderHtml(kw);
        const scope = r.scope || {};
        const note = this._scopeNote(scope);
        if (!r.results || !r.results.length) {
            return `<div class="gs-empty"><div class="gs-empty-icon">🫥</div>
                <div class="gs-empty-title">没有找到「${esc(kw)}」</div>
                <div class="gs-empty-sub">已检索 ${esc(String(r.scanned))} 条记录（${this.app.engine.listSources().length} 个来源）${esc(note)}</div>
                ${this._scopeWarn(scope)}</div>`;
        }
        const head = `<div class="gs-count">共 ${r.total} 条结果${r.total > r.results.length ? `（显示前 ${r.results.length} 条）` : ''} · 已检索 ${r.scanned} 条记录${esc(note)}</div>`;
        const groups = r.groups.map(g => `
            <div class="gs-group">
                <div class="gs-group-head">${esc(g.icon)} ${esc(g.label)}<span class="gs-group-num">${g.items.length}</span></div>
                ${g.items.map(it => this._row(it, kw)).join('')}
            </div>`).join('');
        const errs = (r.errors && r.errors.length)
            ? `<div class="gs-err">${r.errors.length} 个来源读取失败：${esc(r.errors.map(e => e.sourceId).join('、'))}</div>`
            : '';
        return head + this._scopeWarn(scope) + groups + errs;
    }
    /** 模式按钮：快速档报出真实上限（从内核读，不把 600 抄成第二份真相） */
    _modeBtnHtml() {
        const on = this.app._fullMode === true;
        const unsupported = typeof this.app?.engine?.searchAll !== 'function';
        const label = on ? '🌐 全历史' : `⚡ 快速（前 ${this._quickLimit()} 条/源）`;
        return `<div class="gs-modebar">
                <button class="gs-mode${on ? ' gs-mode-on' : ''}" id="gs-mode" title="切换检索范围">${esc(label)}</button>
                ${unsupported ? '<span class="gs-engine-unsupported">内核不支持全历史</span>' : ''}
            </div>`;
    }
    _scanBarHtml() {
        return `<div class="gs-scanbar" id="gs-scanbar">
                <div class="gs-scan-text" id="gs-scan-text">全历史扫描待命</div>
                <button class="gs-scan-cancel" id="gs-cancel" title="停止本轮扫描">取消</button>
            </div>`;
    }
    /** 快速档每源上限（读内核常量；读不到才退回 600） */
    _quickLimit() {
        const n = Number(this.app?.engine?.MAX_SCAN_PER_SOURCE);
        return Number.isFinite(n) && n > 0 ? n : 600;
    }
    /**
     * 覆盖度短注：让「已检索 N 条」后面跟上「什么范围、还有没有没扫到的」。
     * 这是「不能把没扫到显示成没命中」的**出口**。
     */
    _scopeNote(scope) {
        if (!scope || typeof scope !== 'object') return '';
        if (scope.mode === 'full') {
            if (scope.complete === false && Number(scope.pending) > 0) return ` · 全历史扫描中（还剩 ${scope.pending} 条未扫）`;
            return scope.complete === false ? ' · 全历史（未完成）' : ' · 全历史（已扫完）';
        }
        const t = Array.isArray(scope.truncatedSources) ? scope.truncatedSources.length : 0;
        return t ? ` · 快速档（${t} 个来源有更多未索引）` : ' · 快速档';
    }
    /** 覆盖度告警：截断 / 未完成 / 超长正文各说一句，不合并成一句含糊话 */
    _scopeWarn(scope) {
        if (!scope || typeof scope !== 'object') return '';
        const parts = [];
        if (Array.isArray(scope.truncatedSources) && scope.truncatedSources.length) {
            parts.push(scope.mode === 'full'
                ? `${scope.truncatedSources.length} 个来源仍超出全历史上限`
                : `${scope.truncatedSources.length} 个来源只索引了前 ${this._quickLimit()} 条，切「全历史」可继续`);
        }
        if (Array.isArray(scope.bodyTruncatedSources) && scope.bodyTruncatedSources.length) {
            parts.push(`${scope.bodyTruncatedSources.length} 个来源有超长正文（单条仅检索前 4000 字）`);
        }
        if (scope.mode === 'full' && scope.complete === false && Number(scope.pending) > 0) {
            parts.push(`扫描未完成（还剩 ${scope.pending} 条）`);
        }
        return parts.length ? `<div class="gs-group-rest">⚠️ ${parts.map(p => esc(p)).join('；')}</div>` : '';
    }
    _scanPlaceholderHtml(kw) {
        return `<div class="gs-empty"><div class="gs-empty-icon">⏳</div>
            <div class="gs-empty-title">正在检索「${esc(kw)}」</div>
            <div class="gs-empty-sub">全历史扫描中……</div></div>`;
    }
    /**
     * 全历史档起一轮分片扫描，并把落地口挂到 promise 上。
     * @returns {string} 本次的占位 HTML（真结果由 `renderResults` 换上）
     */
    _openScan(kw) {
        this._scanning = null;
        let out = null;
        try {
            out = this.app.search(kw, { onProgress: (p) => this._progress(p) });
        } catch (_e) {
            return this._fallbackHtml(kw);
        }
        if (!out || !out.promise) {
            if (out && out.result) { this._result = out.result; return this._resultsHtml(); }
            return this._fallbackHtml(kw);
        }
        const gen = out.gen;
        this._scanning = { gen: gen, kw: kw };
        out.promise.then(
            (r) => this.renderResults(gen, r, kw),
            (err) => this.renderResults(gen, {
                cancelled: false, results: [], groups: [], total: 0, scanned: 0,
                errors: [{ sourceId: 'engine', error: String((err && err.message) || err) }]
            }, kw)
        );
        return this._scanPlaceholderHtml(kw);
    }
    /**
     * 内核没有分片入口（`searchAll`）时的**诚实降级**：改用同步全历史 `query`。
     *   绝不退回「只搜前 600 条还不说」—— 那正是本版要消灭的形态。
     *   判据不问源码文本，只问行为（本仓测试用真源码破坏删掉 `searchAll` 来证这条分支活着）。
     */
    _fallbackHtml(kw) {
        try {
            const r = this.app.engine.query(kw, { full: true, sourceIds: this._scope ? [this._scope] : [] });
            this._result = r;
            return this._resultsHtml();
        } catch (e) {
            return `<div class="gs-err">检索失败：${esc(String((e && e.message) || e))}</div>`;
        }
    }
    /** 分片进度：只改进度条文字，不重绘结果区（重绘会打断用户正在看的列表） */
    _progress(p) {
        const root = this.app.phoneShell?.screen;
        const bar = root?.querySelector('#gs-scanbar');
        const txt = root?.querySelector('#gs-scan-text');
        if (!bar || !txt) return;
        bar.classList.add('gs-scan-on');
        const total = Number(p && p.total) || 0;
        const done = Number(p && p.processed) || 0;
        const pct = total ? Math.round(done * 100 / total) : 0;
        txt.textContent = `全历史扫描 ${done}/${total}（${pct}%）`;
    }
    /**
     * 分片扫描的落地口。**代际不符即整份丢弃**：
     *   用户已改关键词 / 点了取消 / 切了来源 / 重开面板时，旧扫描一旦写回面板
     *   就是「不报错、只错结果」—— 本仓最贵的那类缺陷。
     */
    renderResults(gen, r, kw) {
        const s = this._scanning;
        if (!s || s.gen !== gen) return;
        if (this._keyword.trim() !== String(kw || '')) return;
        this._scanning = null;
        const root = this.app.phoneShell?.screen;
        const bar = root?.querySelector('#gs-scanbar');
        if (bar) bar.classList.remove('gs-scan-on');
        if (r && r.cancelled === true) {
            /* 半份结果比空结果更糟：取消后**不给任何结果**，并说清为什么。 */
            this._result = null;
            const box0 = root?.querySelector('#gs-results');
            if (box0) {
                box0.innerHTML = `<div class="gs-empty"><div class="gs-empty-icon">⏹️</div>
                    <div class="gs-empty-title">已取消「${esc(kw)}」的全历史扫描</div>
                    <div class="gs-empty-sub">这里不给任何结果 —— 半份结果比空结果更容易被当成「只有这些」。</div></div>`;
            }
            return;
        }
        this._result = r;
        const box = root?.querySelector('#gs-results');
        if (box) box.innerHTML = this._resultsHtml();
        this._bindItems();
    }
    /** 
     * 代际作废的安全包装：App 尚未装好 `newQueryToken` 时不得把输入打断。
     */
    _qtoken() {
        try { this.app.newQueryToken(); } catch (_e) { /* 忽略 */ }
    }
    /** 渲染/检索抛出时的兜底：把错摆到面板上，不吞 */
    _paintError(e) {
        const root = this.app.phoneShell?.screen;
        const box = root?.querySelector('#gs-results');
        if (box) box.innerHTML = `<div class="gs-err">搜索面板渲染失败：${esc(String((e && e.message) || e))}</div>`;
    }
    _row(it, kw) {
        const jumpable = !!it.appId;
        const time = this._timeText(it.ts);
        /* [v3.66.0 · X2] 靶心：引擎早在条目上写了 `meta`（含 `ref`），但此前视图
         *   **一个字都不读**，打开只发 `{ appId }` —— 用户点进去落在 App 首屏，
         *   还得自己再翻一遍。这里把 ref 挂到行上（`data-ref`，JSON 串），
         *   点子时随载荷一起派发；同时把「能定位到哪一条」在行上明写出来，
         *   免得用户以为「打开 ›」只是开 App。 */
        const ref = (it && it.meta && it.meta.ref && it.meta.ref.id) ? it.meta.ref : null;
        const refAttr = ref ? ` data-ref="${esc(JSON.stringify({ appId: ref.appId, kind: ref.kind, id: ref.id }))}"` : '';
        return `<div class="gs-item${jumpable ? ' gs-jumpable' : ''}" data-app="${esc(it.appId || '')}"${refAttr}>
            <div class="gs-item-icon">${esc(it.icon || '📄')}</div>
            <div class="gs-item-body">
                <div class="gs-item-title">${highlight(it.title, kw)}</div>
                ${it.snippet ? `<div class="gs-item-snippet">${highlight(it.snippet, kw)}</div>` : ''}
                <div class="gs-item-meta">${esc(it.sourceLabel)}${time ? ' · ' + esc(time) : ''}${jumpable ? ' · <span class="gs-jump">' + (ref ? '打开到这一条 ›' : '打开 ›') + '</span>' : ''}</div>
            </div>
        </div>`;
    }

    _hint() {
        const sources = this.app.engine.listSources();
        return `<div class="gs-hint">
            <div class="gs-hint-title">搜遍整台小手机</div>
            <div class="gs-hint-sub">${sources.length} 个来源已接入：</div>
            <div class="gs-hint-chips">${sources.map(s => `<span class="gs-hint-chip">${esc(s.icon)} ${esc(s.label)}</span>`).join('')}</div>
            <div class="gs-hint-tip">输入关键词即可跨 App 检索，命中片段会高亮，点结果直接跳回原 App。</div>
        </div>`;
    }

    _timeText(ts) {
        const t = Number(ts) || 0;
        if (!t) return '';
        const d = new Date(t), now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        if (same(d, now)) return hm;
        const y = new Date(now.getTime() - 86400000);
        if (same(d, y)) return '昨天';
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }

    // ---------------- 交互 ----------------

    _bind() {
        const root = this.app.phoneShell?.screen;
        if (!root) return;
        const input = root.querySelector('#gs-input');
        input?.addEventListener('input', (e) => {
            this._keyword = String(e.target?.value || '');
            this._result = null;
            /* [v3.17.0 R-O1] 键入即作废上一轮全历史扫描的代际：上一轮可能还在分片跑，
             *   不作废它就会把**旧词**的命中写回面板（不报错、只错结果）。 */
            this._qtoken();
            this._paint();
            // 清空按钮随输入显现/消失
            const bar = root.querySelector('.gs-searchbar');
            const has = !!this._keyword;
            const clearBtn = root.querySelector('#gs-clear');
            if (has && !clearBtn && bar) {
                const b = document.createElement('button');
                b.className = 'gs-clear';
                b.id = 'gs-clear';
                b.title = '清空';
                b.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                b.addEventListener('click', () => { this._qtoken(); this._keyword = ''; this._result = null; this.render(); });
                bar.appendChild(b);
            } else if (!has && clearBtn) {
                clearBtn.remove();
            }
        });
        root.querySelector('#gs-clear')?.addEventListener('click', () => {
            this._qtoken();
            this._keyword = '';
            this._result = null;
            this.render();
        });
        root.querySelectorAll('.gs-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                this._qtoken();
                this._scope = String(btn.dataset.scope || '');
                this._result = null;
                this.render();
            });
        });
        /* [v3.17.0 R-O1] 快速 / 全历史切换：切换即作废旧索引与旧扫描（走 App 的 invalidateAll）。 */
        root.querySelector('#gs-mode')?.addEventListener('click', () => {
            try { this.app.toggleFullMode(); } catch (_e) { /* 忽略 */ }
            this._result = null;
            this._scanning = null;
            this.render();
        });
        /* 取消 = 换代际（正在跑的那一片会自己停）+ **不给任何结果**。
         *   为什么还要在视图这侧清一遍：promise 已挂上，视图若不先清，
         *   `renderResults` 会按旧代际把 `_result` 写回来。 */
        root.querySelector('#gs-cancel')?.addEventListener('click', () => {
            const kw = this._keyword.trim();
            this._qtoken();
            this._scanning = null;
            this._result = null;
            const bar = root.querySelector('#gs-scanbar');
            if (bar) bar.classList.remove('gs-scan-on');
            const box = root.querySelector('#gs-results');
            if (box) {
                box.innerHTML = kw
                    ? `<div class="gs-empty"><div class="gs-empty-icon">⏹️</div><div class="gs-empty-title">已取消「${esc(kw)}」的全历史扫描</div><div class="gs-empty-sub">改关键词或切回快速档可重新开始。</div></div>`
                    : this._hint();
            }
        });
        this._bindItems();
        // 自动聚焦（移动端避免键盘弹出打断，仅在已输入时恢复焦点）
        if (this._keyword) {
            try { input?.focus?.(); } catch (_e) { /* 忽略 */ }
        }
    }

    /** 仅重绘结果区（保持输入框焦点与光标） */
    _paint() {
        const root = this.app.phoneShell?.screen;
        let html = '';
        try {
            html = this._resultsHtml();
        } catch (e) {
            this._paintError(e);
            return;
        }
        const box = root?.querySelector('#gs-results');
        if (box) box.innerHTML = html;
        const scopes = root?.querySelector('#gs-scopes');
        if (scopes) scopes.innerHTML = this._scopeChips();
        this._bindItems();
    }
    _bindItems() {
        const root = this.app.phoneShell?.screen;
        if (!root) return;
        root.querySelectorAll('.gs-item.gs-jumpable').forEach(item => {
            item.addEventListener('click', () => {
                const appId = String(item.dataset.app || '');
                if (!appId) return;
                /* [v3.66.0 · X2] 派发带靶心：`data-ref` 有就把归一后的 ref 一并投出去。
                 *   解析失败**不静默吞** —— 退化成只开 App，并把原因写到 console
                 *   （坏了要有人知道；此处不弹 UI，免得搜一下就一串红）。 */
                let ref = null;
                const rawRef = item.dataset.ref;
                if (rawRef) {
                    try { ref = JSON.parse(rawRef); }
                    catch (_e) { console.warn('⚠️ 搜索结果的靶心解析失败，退化为只打开 App：', rawRef); }
                }
                try {
                    window.dispatchEvent(new CustomEvent('phone:openApp', { detail: buildOpenDetail(appId, null, ref) }));
                } catch (_e) { /* 忽略 */ }
            });
        });
    }
}

export default SearchView;