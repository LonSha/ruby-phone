/* ========================================================
 * share-view.js — [v4.187.0] 近场快传 · 视图
 *
 * 纪律（同 iot / memory / uterus 那一族）：
 *   · 根容器点击只挂一次（_boundRoot 记节点身份，换容器才重绑）；
 *   · 所有控件走 data-act 委派；
 *   · 不用文本框（名片标题不在界面里编 —— 要发什么由调用方给）；
 *   · 空态 / 有流水 / 有设备 三态分开报，不糊弄。
 * ======================================================== */
'use strict';
import { SHARE_FACE, SHARE_KINDS, previewDispatch } from './share-data.js';

const FACE_META = {
    [SHARE_FACE.NEARBY]: { label: '有设备在范围', tone: 'ok' },
    [SHARE_FACE.HISTORY]: { label: '无设备（看过往流水）', tone: 'warn' },
    [SHARE_FACE.IDLE]: { label: '空档（还没碰过）', tone: 'idle' },
};

const KIND_LABEL = { text: '文字', contactCard: '名片', file: '文件', snippet: '片段' };

import { viewText } from '../../config/view-text.js';
export class ShareView {
    constructor(app, shell) {
        this.app = app;
        this.shell = shell;
        this._root = null;
        this._boundRoot = null;
        this._flash = '';
    }

    /* 样式自注入（同 diary / weibo / iot）：不走 phone.css 投递，registry R3 才不会判它裸奔。 */
    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('share-css')) return;
            const link = document.createElement('link');
            link.id = 'share-css';
            link.rel = 'stylesheet';
            link.href = new URL('./share.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头环境如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'share-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root;
        this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
        this._bind(this._root);
    }

    _html() {
        const app = this.app;
        const st = app.state;
        const face = app.face;
        const meta = FACE_META[face] || FACE_META[SHARE_FACE.IDLE];
        const flash = this._flash ? ('<div class="share-flash">' + viewText(this._flash) + '</div>') : '';

        const cards = st.nearby.length
            ? st.nearby.map((d) => (
                '<div class="share-card">'
                + '<div class="share-card-head"><span class="share-name">' + viewText(d.name) + '</span>'
                + '<span class="share-signal">信号 ' + viewText(d.signal) + '</span></div>'
                + '<div class="share-acts">'
                + '<button class="share-btn" type="button" data-act="send" data-dev="' + viewText(d.id) + '" data-kind="contactCard">发名片</button>'
                + '<button class="share-btn" type="button" data-act="send" data-dev="' + viewText(d.id) + '" data-kind="text">发文字</button>'
                + '<button class="share-btn share-btn-ghost" type="button" data-act="leave" data-dev="' + viewText(d.id) + '">离开</button>'
                + '</div>'
                + '</div>'
            )).join('')
            : '<div class="share-empty">范围内没有设备。碰一下才会出现。</div>';

        /* 派发预览：拿纯函数的真结果报「谁能接」，不在界面里手写受体名。 */
        const previewLine = (() => {
            const parts = [];
            for (const kind of ['text', 'contactCard']) {
                const r = previewDispatch(kind);
                const names = r.ok ? r.targets.map((x) => x.appName).join('、') : '无人接';
                parts.push((KIND_LABEL[kind] || kind) + ' -> ' + names);
            }
            return parts.join(' | ');
        })();

        const hist = st.history.length
            ? st.history.slice().reverse().slice(0, 12).map((h) => (
                '<div class="share-hrow"><span class="share-hk">' + viewText((KIND_LABEL[h.kind] || h.kind)) + '</span>'
                + '<span class="share-hd">' + viewText((h.title || '（无标题）')) + ' ->  ' + viewText(h.deviceName) + '</span></div>'
            )).join('')
            : '<div class="share-empty">还没有流水。</div>';

        return (
            '<div class="share-head">'
            + '<button class="share-back" type="button" data-act="back">‹</button>'
            + '<div class="share-title">近场快传</div>'
            + '<div class="share-face share-face-' + meta.tone + '">' + meta.label + '</div>'
            + '</div>'
            + flash
            + '<div class="share-sec-t">范围内 ' + st.nearby.length + ' 台</div>'
            + '<div class="share-cards">' + cards + '</div>'
            + '<div class="share-sec-t">派发预览：' + viewText(previewLine) + '</div>'
            + '<div class="share-sec-t">流水（' + st.history.length + ' 条）</div>'
            + '<div class="share-hist">' + hist + '</div>'
            + '<div class="share-foot">'
            + '<button class="share-reset" type="button" data-act="reset">清空</button>'
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
        if (act === 'back') {
            if (this.shell && this.shell.goHome) this.shell.goHome();
            return;
        }
        if (act === 'leave') {
            const r = this.app.leave(el.getAttribute('data-dev'));
            this._flash = r.ok ? '已离开范围' : '这台本来就不在范围';
            this.refresh();
            return;
        }
        if (act === 'send') {
            const dev = el.getAttribute('data-dev');
            const kind = el.getAttribute('data-kind');
            const title = kind === 'contactCard' ? '我的名片' : '一段文字';
            const r = this.app.send(dev, { kind, title });
            if (!r.ok) this._flash = '没发出去：' + r.reason;
            else if (r.saved === false) this._flash = '送达了，但流水没写进存储（下次看不见）';
            else this._flash = '已送达：' + (KIND_LABEL[kind] || kind);
            this.refresh();
            return;
        }
        if (act === 'reset') {
            this.app.reset();
            this._flash = '已清空';
            this.refresh();
        }
    }
}

export { SHARE_KINDS };
export default ShareView;
