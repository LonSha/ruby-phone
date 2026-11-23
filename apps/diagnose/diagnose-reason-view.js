/* ========================================================
 * diagnose-reason-view.js — [v4.192.0] 诊断归因文案 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是六组试算格子：字段归因 / 桥归因 / 投影缺席 / 桥自述态 /
 *   存档代次 / 存档健康行 + 一段 JSON 输出。
 * ======================================================== */
'use strict';

export class DiagnoseReasonView {
    constructor(app, shell) {
        this.app = app;
        this.shell = shell;
        this._root = null;
        this._boundRoot = null;
        this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('diagnose-reason-css')) return;
            const link = document.createElement('link');
            link.id = 'diagnose-reason-css';
            link.rel = 'stylesheet';
            link.href = new URL('./diagnose-reason.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'dr-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root;
        this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
    }

    _flashText(msg) { this._flash = msg || ''; this.refresh(); }

    _html() {
        const o = this.app.lastOut;
        const out = o ? JSON.stringify(o) : '还没试算过';
        return '<div class="dr-head">'
            + '<div class="dr-title">诊断归因文案试算台</div>'
            + '<div class="dr-sub">同一取值 => 同一句话（内核纯函数，不取时钟不造随机）</div>'
            + '</div>'
            + '<div class="dr-grid">'
            + '<button type="button" data-act="field">字段级归因</button>'
            + '<button type="button" data-act="bridge">桥归因</button>'
            + '<button type="button" data-act="proj">投影缺席原因</button>'
            + '<button type="button" data-act="source">桥自述态</button>'
            + '<button type="button" data-act="schema">存档代次</button>'
            + '<button type="button" data-act="storage">存档健康行</button>'
            + '<button type="button" data-act="unknown">未知取值</button>'
            + '</div>'
            + (this._flash ? '<div class="dr-flash">' + this._flash + '</div>' : '')
            + '<div class="dr-out">' + out + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'field') {
                const r = this.app.field('legacy-null');
                this._flashText('legacy-null → 「' + r.text + '」（旧版桥读不出，不硬猜）');
            } else if (act === 'bridge') {
                const r = this.app.bridge('engine-empty');
                this._flashText('engine-empty → 「' + r.text + '」');
            } else if (act === 'proj') {
                const r = this.app.proj('no-provider');
                this._flashText('no-provider → 「' + r.text + '」');
            } else if (act === 'source') {
                const r = this.app.source('engine-absent');
                this._flashText('engine-absent → 「' + r.text + '」');
            } else if (act === 'schema') {
                const r = this.app.schema('future');
                this._flashText('future → 「' + r.text + '」');
            } else if (act === 'storage') {
                const r = this.app.storage({
                    ok: true,
                    chat: { ok: true, schema: { state: 'current' }, ledger: { count: 3 } },
                    global: { ok: false, reason: 'no-host' }
                });
                this._flashText('一行读数：' + r.line);
            } else if (act === 'unknown') {
                const r = this.app.field('zzz-unknown');
                this._flashText('查表没命中 → 如实输出原值「' + r.text + '」（不静默兜底成具体结论）');
            }
        });
    }
}

export default DiagnoseReasonView;