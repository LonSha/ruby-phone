/* ========================================================
 * bili-format-view.js — [v4.190.0] B站 换算 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是四个换算格子：计数 / 时长 / 时间 / 标识 + 一段 LRC 试算。
 * ======================================================== */
'use strict';

export class BiliFormatView {
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
            if (document.getElementById('bili-format-css')) return;
            const link = document.createElement('link');
            link.id = 'bili-format-css';
            link.rel = 'stylesheet';
            link.href = new URL('./bili-format.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'bf-root';
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

    _row(label, value) {
        return '<div class="bf-row"><span class="bf-k">' + label + '</span><span class="bf-v">' + value + '</span></div>';
    }

    _html() {
        const o = this.app.lastOut;
        const out = o ? JSON.stringify(o) : '还没试算过';
        return '<div class="bf-head">'
            + '<div class="bf-title">B站 换算试算台</div>'
            + '<div class="bf-sub">同一输入 => 同一结果（内核不自己取时间、不造随机）</div>'
            + '</div>'
            + '<div class="bf-grid">'
            + '<button type="button" data-act="count">计数 12.8万</button>'
            + '<button type="button" data-act="dur">时长 12:34</button>'
            + '<button type="button" data-act="ago">三小时前</button>'
            + '<button type="button" data-act="id">BV 号</button>'
            + '</div>'
            + (this._flash ? '<div class="bf-flash">' + this._flash + '</div>' : '')
            + '<div class="bf-out">' + out + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'count') {
                const r = this.app.count('12.8万');
                this._flashText('解析 ' + r.out.parsed + ' → 显示 ' + r.out.shown);
            } else if (act === 'dur') {
                const r = this.app.dur('12:34');
                this._flashText('解析 ' + r.out.seconds + ' 秒 → 显示 ' + r.out.shown);
            } else if (act === 'ago') {
                const r = this.app.ago(1763808000000 - 3 * 3600 * 1000);
                this._flashText(r.out.text + '（' + r.out.stamp + '）');
            } else if (act === 'id') {
                const r = this.app.id('凌晨的面馆');
                this._flashText(r.out.bvid + ' / UID ' + r.out.mid);
            }
        });
    }
}

export default BiliFormatView;