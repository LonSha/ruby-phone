/* ========================================================
 * social-view.js — [v4.188.0] 自主朋友圈 · 视图
 * 纪律：_boundRoot 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面不写正文（正文由生成侧给），只做查看 + 点赞 + 评论（评论区走 prompt 弹层）。
 * ======================================================== */
'use strict';
import { SOCIAL_FACE, DAY_PARTS, MOOD_TAGS } from './social-data.js';

const PART_LABEL = { morning: '早', afternoon: '午', night: '晚' };
const MOOD_LABEL = { calm: '平', reflective: '沉', restless: '躁', joyful: '欣', down: '低' };
const FACE_META = {
    [SOCIAL_FACE.POSTS]: { label: '有动态', tone: 'ok' },
    [SOCIAL_FACE.EMPTY]: { label: '空档（还没有动态）', tone: 'idle' },
};

export class SocialView {
    constructor(app, shell) {
        this.app = app; this.shell = shell;
        this._root = null; this._boundRoot = null; this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('social-feed-css')) return;
            const link = document.createElement('link');
            link.id = 'social-feed-css'; link.rel = 'stylesheet';
            link.href = new URL('./social.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'social-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root; this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
        this._bind(this._root);
    }

    _html() {
        const st = this.app.state;
        const face = this.app.face;
        const meta = FACE_META[face] || FACE_META[SOCIAL_FACE.EMPTY];
        const flash = this._flash ? '<div class="social-flash">' + this._flash + '</div>' : '';
        const cards = st.posts.length
            ? st.posts.map((p) => (
                '<div class="social-card" data-id="' + p.postId + '">'
                + '<div class="social-meta"><span class="social-author">' + p.author + '</span>'
                + '<span class="social-tag">' + (PART_LABEL[p.part] || p.part) + ' · ' + (MOOD_LABEL[p.mood] || p.mood) + '</span></div>'
                + '<div class="social-body">' + p.body + '</div>'
                + '<div class="social-acts">'
                + '<button class="social-btn" type="button" data-act="like" data-id="' + p.postId + '">赞 ' + p.likes.length + '</button>'
                + '<button class="social-btn social-btn-ghost" type="button" data-act="comment" data-id="' + p.postId + '">评论 ' + p.comments.length + '</button>'
                + '</div>'
                + '<div class="social-cmts">' + p.comments.map((c) => ('<div>· ' + c.author + '：' + c.text + '</div>')).join('') + '</div>'
                + '</div>'
            )).join('')
            : '<div class="social-empty">还没有动态。内容由生成侧给，本界面不代写。</div>';
        return (
            '<div class="social-head">'
            + '<button class="social-back" type="button" data-act="back">‹</button>'
            + '<div class="social-title">朋友圈</div>'
            + '<div class="social-face social-face-' + meta.tone + '">' + meta.label + '</div>'
            + '</div>'
            + flash
            + '<div class="social-list">' + cards + '</div>'
            + '<div class="social-foot"><button class="social-reset" type="button" data-act="reset">清空</button></div>'
        );
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => this._onClick(ev));
    }

    _onClick(ev) {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el) return;
        const act = el.getAttribute('data-act');
        if (act === 'back') { if (this.shell && this.shell.goHome) this.shell.goHome(); return; }
        if (act === 'like') {
            const r = this.app.like(el.getAttribute('data-id'), '我');
            this._flash = r.ok ? (r.saved === false ? '赞了，但没写进存储' : '') : ('没赞成：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'comment') {
            const text = (typeof prompt === 'function') ? prompt('评论内容（不许空）') : '';
            if (!text) { this._flash = '评论不能空'; this.refresh(); return; }
            const r = this.app.comment(el.getAttribute('data-id'), '我', text);
            this._flash = r.ok ? (r.saved === false ? '评了，但没写进存储' : '') : ('没评成：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'reset') { this.app.reset(); this._flash = '已清空'; this.refresh(); }
    }
}

export { DAY_PARTS, MOOD_TAGS };
export default SocialView;
