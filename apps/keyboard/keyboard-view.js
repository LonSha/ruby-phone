/* ========================================================
 * keyboard-view.js — [v4.188.0] 像素键盘 · 视图
 * 纪律：_boundRoot 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 词表管理在界面里做（加/删），草稿长度超限如实报错，不静默截。
 * ======================================================== */
'use strict';
import { KB_FACE, KB_LIMITS } from './keyboard-data.js';

const FACE_META = {
    [KB_FACE.CANDIDATES]: { label: '有候选', tone: 'ok' },
    [KB_FACE.EMPTY]: { label: '空档（还没联想）', tone: 'idle' },
};

import { viewText } from '../../config/view-text.js';
export class KeyboardView {
    constructor(app, shell) {
        this.app = app; this.shell = shell;
        this._root = null; this._boundRoot = null; this._flash = ''; this._q = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('kb-ime-css')) return;
            const link = document.createElement('link');
            link.id = 'kb-ime-css'; link.rel = 'stylesheet';
            link.href = new URL('./keyboard.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'kb-root';
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
        const app = this.app;
        const face = app.face;
        const meta = FACE_META[face] || FACE_META[KB_FACE.EMPTY];
        const flash = this._flash ? '<div class="kb-flash">' + viewText(this._flash) + '</div>' : '';
        const cands = app.lastCandidates.length
            ? app.lastCandidates.map((c) => '<span class="kb-cand">' + viewText(c) + '</span>').join('')
            : '<span class="kb-none">没联想上（不拿输入内容硬凑一条）</span>';
        const slangRow = app.profile.slangs.map((s) => (
            '<span class="kb-slang">' + viewText(s)
            + '<button class="kb-del" type="button" data-act="del" data-slang="' + viewText(s) + '">x</button></span>'
        )).join('');
        return (
            '<div class="kb-head">'
            + '<button class="kb-back" type="button" data-act="back">‹</button>'
            + '<div class="kb-title">口癖联想</div>'
            + '<div class="kb-face kb-face-' + meta.tone + '">' + meta.label + '</div>'
            + '</div>'
            + flash
            + '<div class="kb-sec-t">词表（' + app.profile.slangs.length + ' / ' + KB_LIMITS.maxProfile + '）</div>'
            + '<div class="kb-slangs">' + slangRow + '</div>'
            + '<div class="kb-addrow">'
            + '<button class="kb-add" type="button" data-act="add">加一条</button>'
            + '</div>'
            + '<div class="kb-sec-t">联想结果</div>'
            + '<div class="kb-cands">' + cands + '</div>'
            + '<div class="kb-queryrow">'
            + '<button class="kb-query" type="button" data-act="query">贴一个前缀试联想</button>'
            + '</div>'
            + '<div class="kb-foot">'
            + '<button class="kb-reset" type="button" data-act="reset">恢复默认词表</button>'
            + '</div>'
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
        if (act === 'del') {
            const r = this.app.removeSlang(el.getAttribute('data-slang'));
            this._flash = r.saved === false ? '删了，但没写进存储' : '';
            this.refresh(); return;
        }
        if (act === 'add') {
            const s = (typeof prompt === 'function') ? prompt('新口癖（不许空，不重复）') : '';
            if (!s) { this._flash = '口癖不能空'; this.refresh(); return; }
            const r = this.app.addSlang(s);
            this._flash = r.ok ? (r.saved === false ? '加了，但没写进存储' : '') : ('没加成：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'query') {
            const q = (typeof prompt === 'function') ? prompt('想联想什么前缀？可留空取前几条') : '';
            this._q = q || '';
            const r = this.app.predict(this._q);
            this._flash = r.ok ? '' : ('没联想上：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'reset') { this.app.reset(); this._flash = '已恢复默认'; this.refresh(); }
    }
}

export { KB_LIMITS };
export default KeyboardView;
