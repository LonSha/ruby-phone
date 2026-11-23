/* ========================================================
 * call-view.js — [v4.188.0] 情境通话声场 · 视图
 * 纪律：根容器只绑一次（_boundRoot）、data-act 委派、CSS 自注入、无 input 监听。
 * 场景选择用按钮，不写文本框：打给谁由控制器给，界面不编剧情。
 * ======================================================== */
'use strict';
import { CALL_SCENES, CALL_FACE } from './call-data.js';

const FACE_META = {
    [CALL_FACE.ACTIVE]: { label: '通话中', tone: 'ok' },
    [CALL_FACE.HISTORY]: { label: '已挂断（看过往）', tone: 'warn' },
    [CALL_FACE.IDLE]: { label: '空闲', tone: 'idle' },
};
const SCENE_LABEL = { quiet_room: '静室', rain_fleeing: '雨中疾走', night_drive: '夜车', confined_stealth: '密室潜伏' };

export class CallView {
    constructor(app, shell) {
        this.app = app; this.shell = shell;
        this._root = null; this._boundRoot = null; this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('call-scene-css')) return;
            const link = document.createElement('link');
            link.id = 'call-scene-css'; link.rel = 'stylesheet';
            link.href = new URL('./call.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'call-root';
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
        const st = this.app.state;
        const face = this.app.face;
        const meta = FACE_META[face] || FACE_META[CALL_FACE.IDLE];
        const flash = this._flash ? '<div class="call-flash">' + this._flash + '</div>' : '';
        const notes = st.notes.length ? '<div class="call-notes">' + st.notes.map((n) => '<div>' + n + '</div>').join('') + '</div>' : '';

        const sceneRow = Object.keys(CALL_SCENES).map((id) => (
            '<button class="call-scene' + (st.scene === id ? ' is-on' : '') + '" type="button" data-act="scene" data-scene="' + id + '">' + (SCENE_LABEL[id] || id) + '</button>'
        )).join('');

        const acts = st.active
            ? '<div class="call-live">对象：' + st.active.callerName + ' | 场景：' + (SCENE_LABEL[st.active.scene] || st.active.scene) + '</div>'
              + '<button class="call-btn call-btn-hang" type="button" data-act="hang">挂断</button>'
            : '<div class="call-live call-live-idle">当前没有通话</div>'
              + '<button class="call-btn" type="button" data-act="begin" data-scene="' + st.scene + '">以当前场景发起通话</button>';

        const sigRow = '<div class="call-sig">信号 '
            + '<button class="call-step" type="button" data-act="sig" data-dir="-1" aria-label="信号减一">-</button>'
            + '<strong>' + st.signalBars + '/5</strong>'
            + '<button class="call-step" type="button" data-act="sig" data-dir="1" aria-label="信号加一">+</button>'
            + '</div>';

        const hist = st.history.length
            ? st.history.slice().reverse().slice(0, 10).map((h) => (
                '<div class="call-hrow">' + h.callerName + ' | ' + (SCENE_LABEL[h.scene] || h.scene) + '</div>'
            )).join('')
            : '<div class="call-empty">还没有通话流水</div>';

        return (
            '<div class="call-head">'
            + '<button class="call-back" type="button" data-act="back">‹</button>'
            + '<div class="call-title">情境通话</div>'
            + '<div class="call-face call-face-' + meta.tone + '">' + meta.label + '</div>'
            + '</div>'
            + flash + notes
            + '<div class="call-sec-t">场景（无声学叙事，只调滤波数值）</div>'
            + '<div class="call-scenes">' + sceneRow + '</div>'
            + sigRow
            + acts
            + '<div class="call-sec-t">流水（' + st.history.length + ' 通）</div>'
            + '<div class="call-hist">' + hist + '</div>'
            + '<div class="call-foot"><button class="call-reset" type="button" data-act="reset">清空</button></div>'
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
        if (act === 'scene') {
            const id = el.getAttribute('data-scene');
            if (!CALL_SCENES[id]) { this._flash = '场景认不出，没换'; }
            else { this.app.state.scene = id; this._flash = '场景 → ' + (SCENE_LABEL[id] || id) + '（下次发起生效）'; this.app._save(); }
            this.refresh(); return;
        }
        if (act === 'begin') {
            const r = this.app.begin({ scene: this.app.state.scene, callerName: '对方', signalBars: this.app.state.signalBars });
            this._flash = r.ok ? (r.saved === false ? '通话已起，但状态没写进存储' : '') : ('没拨出去：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'hang') {
            const r = this.app.hangup();
            this._flash = r.ok ? '已挂断' : '本来就没有通话';
            this.refresh(); return;
        }
        if (act === 'sig') {
            const dir = Number(el.getAttribute('data-dir'));
            const r = this.app.signal(this.app.state.signalBars + dir);
            this._flash = r.ok ? (r.note || '') : ('没改成：' + r.reason);
            this.refresh(); return;
        }
        if (act === 'reset') { this.app.reset(); this._flash = '已清空'; this.refresh(); }
    }
}

export { CALL_SCENES };
export default CallView;
