/* ========================================================
 * honey-text-view.js — [v4.191.0] 蜜语 文本清洗 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * ======================================================== */
'use strict';

import { viewText } from '../../config/view-text.js';
export class HoneyTextView {
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
            if (document.getElementById('honey-text-css')) return;
            const link = document.createElement('link');
            link.id = 'honey-text-css';
            link.rel = 'stylesheet';
            link.href = new URL('./honey-text.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'ht-root';
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
        const out = o ? viewText(JSON.stringify(o)) : '还没试算过';
        return '<div class="ht-head">'
            + '<div class="ht-title">蜜语 文本清洗试算台</div>'
            + '<div class="ht-sub">同一输入 => 同一结果（内核纯函数，不取时钟不造随机）</div>'
            + '</div>'
            + '<div class="ht-grid">'
            + '<button type="button" data-act="inline">内联清洗</button>'
            + '<button type="button" data-act="prompt">提示词行</button>'
            + '<button type="button" data-act="favor">好感度钳制</button>'
            + '<button type="button" data-act="ref">参考值钳制</button>'
            + '<button type="button" data-act="image">参考图归一</button>'
            + '<button type="button" data-act="comment">评论行归一</button>'
            + '</div>'
            + (this._flash ? '<div class="ht-flash">' + viewText(this._flash) + '</div>' : '')
            + '<div class="ht-out">' + out + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'inline') {
                const r = this.app.inline('  <b>凌晨</b>的   面馆  ', 12);
                this._flashText('洗完得「' + r.out.text + '」（截断到 12 字）');
            } else if (act === 'prompt') {
                const r = this.app.promptLine('<i>灯</i>还亮着');
                this._flashText('单行「' + r.out.line + '」/ 块行「' + r.out.block + '」');
            } else if (act === 'favor') {
                const r = this.app.favorability('123.456');
                this._flashText('123.456 钳成 ' + r.out.clamped + '；读不出时给 null（' + r.out.bad + '）');
            } else if (act === 'ref') {
                const r = this.app.reference('1.987');
                this._flashText('1.987 钳成 ' + r.out.clamped);
            } else if (act === 'image') {
                const r = this.app.image('data:image/png;base64,AAAA');
                this._flashText('内联图被退回「' + r.out.url + '」（只放行 http(s) 与 /backgrounds/）');
            } else if (act === 'comment') {
                const r = this.app.comment('【热评】阿茶: 这家真不错');
                this._flashText('归一成「' + r.out.text + '」；是否状态行：' + r.out.status);
            }
        });
    }
}

export default HoneyTextView;