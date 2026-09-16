/* ========================================================
 * search-view.js — 全局搜索面板 [v2.16.0]
 * --------------------------------------------------------
 * 一个输入框搜遍 29 个 App：微信会话/朋友圈/日记/短信/通话/织光机/
 *   音乐/世界脉搏/微博/记忆/阅读/成就/小红书/贴吧/通知/酒馆正文……
 * 结果按来源分区，命中片段高亮，点击跳转到来源 App。
 * ======================================================== */
'use strict';

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
        const html = `
        <div class="gs-wrap">
            <div class="gs-topbar">
                <div class="gs-title">全局搜索</div>
                <div class="gs-sub">${esc(this.app.scopeSummary())}</div>
            </div>
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
    }

    _scopeChips() {
        const sources = this.app.engine.listSources();
        const chip = (id, label, icon) => {
            const on = this._scope === id ? ' gs-chip-on' : '';
            return `<button class="gs-chip${on}" data-scope="${esc(id)}">${esc(icon)} ${esc(label)}</button>`;
        };
        return chip('', '全部', '🔎') + sources.map(s => chip(s.id, s.label, s.icon)).join('');
    }

    _resultsHtml() {
        const kw = this._keyword.trim();
        if (!kw) return this._hint();
        const r = this._result || this.app.engine.query(kw, { sourceIds: this._scope ? [this._scope] : [] });
        this._result = r;
        if (!r.results.length) {
            return `<div class="gs-empty"><div class="gs-empty-icon">🫥</div>
                <div class="gs-empty-title">没有找到「${esc(kw)}」</div>
                <div class="gs-empty-sub">已检索 ${r.scanned} 条记录（${this.app.engine.listSources().length} 个来源）</div></div>`;
        }
        const head = `<div class="gs-count">共 ${r.total} 条结果${r.total > r.results.length ? `（显示前 ${r.results.length} 条）` : ''} · 已检索 ${r.scanned} 条记录</div>`;
        const groups = r.groups.map(g => `
            <div class="gs-group">
                <div class="gs-group-head">${esc(g.icon)} ${esc(g.label)}<span class="gs-group-num">${g.items.length}</span></div>
                ${g.items.map(it => this._row(it, kw)).join('')}
            </div>`).join('');
        const errs = (r.errors && r.errors.length)
            ? `<div class="gs-err">${r.errors.length} 个来源读取失败：${esc(r.errors.map(e => e.sourceId).join('、'))}</div>`
            : '';
        return head + groups + errs;
    }

    _row(it, kw) {
        const jumpable = !!it.appId;
        const time = this._timeText(it.ts);
        return `<div class="gs-item${jumpable ? ' gs-jumpable' : ''}" data-app="${esc(it.appId || '')}">
            <div class="gs-item-icon">${esc(it.icon || '📄')}</div>
            <div class="gs-item-body">
                <div class="gs-item-title">${highlight(it.title, kw)}</div>
                ${it.snippet ? `<div class="gs-item-snippet">${highlight(it.snippet, kw)}</div>` : ''}
                <div class="gs-item-meta">${esc(it.sourceLabel)}${time ? ' · ' + esc(time) : ''}${jumpable ? ' · <span class="gs-jump">打开 ›</span>' : ''}</div>
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
                b.addEventListener('click', () => { this._keyword = ''; this._result = null; this.render(); });
                bar.appendChild(b);
            } else if (!has && clearBtn) {
                clearBtn.remove();
            }
        });
        root.querySelector('#gs-clear')?.addEventListener('click', () => {
            this._keyword = '';
            this._result = null;
            this.render();
        });
        root.querySelectorAll('.gs-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                this._scope = String(btn.dataset.scope || '');
                this._result = null;
                this.render();
            });
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
        const box = root?.querySelector('#gs-results');
        if (box) box.innerHTML = this._resultsHtml();
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
                try {
                    window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId } }));
                } catch (_e) { /* 忽略 */ }
            });
        });
    }
}

export default SearchView;