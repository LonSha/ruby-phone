/* ========================================================
 * weibo-text-view.js — [v4.191.0] 微博 文本解析 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是四组试算格子：相对时间 / @人名 / 粉丝数 / 评论行 + 一段 JSON 输出。
 * ======================================================== */
'use strict';

import { viewText } from '../../config/view-text.js';
export class WeiboTextView {
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
            if (document.getElementById('weibo-text-css')) return;
            const link = document.createElement('link');
            link.id = 'weibo-text-css';
            link.rel = 'stylesheet';
            link.href = new URL('./weibo-text.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'wt-root';
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
        return '<div class="wt-head">'
            + '<div class="wt-title">微博 文本解析试算台</div>'
            + '<div class="wt-sub">同一输入 => 同一结果（内核纯函数，不取时钟不造随机）</div>'
            + '</div>'
            + '<div class="wt-grid">'
            + '<button type="button" data-act="ago">相对时间读</button>'
            + '<button type="button" data-act="stamp">相对时间写</button>'
            + '<button type="button" data-act="at">@人名归一</button>'
            + '<button type="button" data-act="dedupe">剥重复称呼</button>'
            + '<button type="button" data-act="followers">粉丝数读</button>'
            + '<button type="button" data-act="location">属地切分</button>'
            + '<button type="button" data-act="comment">评论行解析</button>'
            + '</div>'
            + (this._flash ? '<div class="wt-flash">' + viewText(this._flash) + '</div>' : '')
            + '<div class="wt-out">' + out + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'ago') {
                const r = this.app.ago('3小时前');
                this._flashText('「3小时前」读作 ' + r.out.minutes + ' 分钟 → 回显 ' + r.out.shown);
            } else if (act === 'stamp') {
                const r = this.app.stamp(185);
                this._flashText('185 分钟写作「' + r.out.shown + '」');
            } else if (act === 'at') {
                const r = this.app.at('凌晨的面馆');
                this._flashText('补 @ 得 ' + r.out.at + '；剥 @ 得「' + r.out.bare + '」');
            } else if (act === 'dedupe') {
                const r = this.app.dedupe('@张三：我也这么觉得', '张三');
                this._flashText('剥完后：' + r.out.text);
            } else if (act === 'followers') {
                const r = this.app.followers('1.2万');
                this._flashText('读作 ' + r.out.parsed + '；认不出时给 null（不编 0）');
            } else if (act === 'location') {
                const r = this.app.location('@凌晨的面馆（IP属地：北京）');
                this._flashText('属地「' + r.out.location + '」；剩余 ' + r.out.head);
            } else if (act === 'comment') {
                const r = this.app.comment('@阿茶（IP属地：上海） 回复 @老周：这家真不错');
                if (r.ok) {
                    this._flashText(r.out.name + ' / ' + (r.out.location || '无属地') + ' / 回复 ' + (r.out.replyTo || '无人') + ' / ' + r.out.text);
                } else {
                    this._flashText('不是一条评论（' + r.reason + '）');
                }
            }
        });
    }
}

export default WeiboTextView;