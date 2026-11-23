/* ========================================================
 * iot-view.js — [v4.186.0] 智能家居中枢 · 视图
 *
 * 纪律（同 memory / uterus 那一族）：
 *   · 根容器点击**只挂一次**（`_boundRoot` 记节点身份，换容器才重绑）；
 *   · 所有控件走 `data-act` 委派 —— 元素级监听随重绘换节点本就不累积，
 *     但一堆按钮各挂一个实在没必要；
 *   · **不用滑块/文字输入**：本件全部读数用步进按钮改（+/-），`input` 事件在这个 App 里
 *     没有出现的理由（也就不会踩「输入回调里重建输入控件」那条线）；
 *   · 空态/读不出分两态，不糊弄。
 * ======================================================== */
'use strict';
import { IOT_DEVICES, IOT_SCENES, IOT_LIMITS, AC_MODES, IOT_FACE } from './iot-data.js';

const FACE_META = {
    [IOT_FACE.ready]: { label: '读数在场', tone: 'ok' },
    [IOT_FACE.empty]: { label: '还没调过（当前是初值）', tone: 'warn' },
    [IOT_FACE.storage_absent]: { label: '存储读不出（不是“没设过”）', tone: 'err' },
};

const MODE_LABEL = { cool: '制冷', heat: '制热', dry: '除湿', fan: '送风', quiet: '静音' };

function step(key) {
    if (key === 'colorTempK') return 200;
    if (key === 'brightness') return 5;
    if (key === 'setPointC') return 1;
    if (key === 'closedPercent') return 10;
    return 1;
}

function fmt(key, v) {
    if (key === 'colorTempK') return v + 'K';
    if (key === 'brightness') return v + '%';
    if (key === 'setPointC') return v + '度';
    if (key === 'closedPercent') return '闭 ' + v + '%';
    if (key === 'mode') return MODE_LABEL[v] || v;
    return String(v);
}

export class IotView {
    constructor(app, shell) {
        this.app = app;
        this.shell = shell;
        this._root = null;
        this._boundRoot = null;
        this._flash = '';
    }

    /* 样式自注入（同 diary / weibo）：本件不走 phone.css 投递，registry R3 才不会判它裸奔。 */
    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('iot-css')) return;
            const link = document.createElement('link');
            link.id = 'iot-css';
            link.rel = 'stylesheet';
            link.href = new URL('./iot.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头环境如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'iot-root';
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
        const face = app.face;
        const meta = FACE_META[face] || FACE_META[IOT_FACE.storage_absent];
        const proj = app.projection();
        const sceneRow = Object.keys(IOT_SCENES).map((id) => (
            '<button class="iot-scene" type="button" data-act="scene" data-scene="' + id + '">' + IOT_SCENES[id].label + '</button>'
        )).join('');
        const cards = IOT_DEVICES.map((dev) => this._card(dev)).join('');
        const flash = this._flash ? ('<div class="iot-flash">' + this._flash + '</div>') : '';
        const notes = (app.notes && app.notes.length)
            ? ('<div class="iot-notes">' + app.notes.map((n) => ('<div>' + n + '</div>')).join('') + '</div>')
            : '';
        return (
            '<div class="iot-head">'
            + '<button class="iot-back" type="button" data-act="back">‹</button>'
            + '<div class="iot-title">智能家居</div>'
            + '<div class="iot-face iot-face-' + meta.tone + '">' + meta.label + '</div>'
            + '</div>'
            + '<div class="iot-scenes">' + sceneRow + '</div>'
            + '<div class="iot-scene-line">当前场景：<strong>' + proj.scene + '</strong></div>'
            + flash
            + '<div class="iot-cards">' + cards + '</div>'
            + notes
            + '<div class="iot-foot">'
            + '<button class="iot-reset" type="button" data-act="reset">恢复初值</button>'
            + '</div>'
        );
    }

    _card(dev) {
        const st = (this.app.state.devices && this.app.state.devices[dev.id]) || {};
        const on = st.power === true;
        const rows = [];
        if (dev.keys.indexOf('power') >= 0) {
            rows.push('<button class="iot-switch' + (on ? ' is-on' : '') + '" type="button" data-act="power" data-dev="' + dev.id + '">' + (on ? '开' : '关') + '</button>');
        }
        for (const key of dev.keys) {
            if (key === 'power') continue;
            if (key === 'mode') {
                rows.push(
                    '<div class="iot-row"><span class="iot-k">模式</span>'
                    + '<button class="iot-step" type="button" data-act="mode" data-dev="' + dev.id + '">' + fmt('mode', st.mode) + '</button>'
                    + '</div>'
                );
                continue;
            }
            const range = IOT_LIMITS[key];
            rows.push(
                '<div class="iot-row"><span class="iot-k">' + key + '</span>'
                + '<button class="iot-step" type="button" data-act="step" data-dev="' + dev.id + '" data-key="' + key + '" data-dir="-1">-</button>'
                + '<span class="iot-v">' + fmt(key, st[key]) + '</span>'
                + '<button class="iot-step" type="button" data-act="step" data-dev="' + dev.id + '" data-key="' + key + '" data-dir="1">+</button>'
                + '<span class="iot-range">' + range[0] + '~' + range[1] + '</span>'
                + '</div>'
            );
        }
        return (
            '<div class="iot-card' + (on ? ' is-on' : '') + '">'
            + '<div class="iot-card-head"><span class="iot-icon">' + dev.icon + '</span><span class="iot-name">' + dev.name + '</span></div>'
            + rows.join('')
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
        if (act === 'scene') {
            const r = this.app.activateScene(el.getAttribute('data-scene'));
            this._flash = r.ok ? ('换到「' + IOT_SCENES[el.getAttribute('data-scene')].label + '」，改了 ' + r.changes.length + ' 项') : '这个场景名认不出，没动';
            this.refresh();
            return;
        }
        if (act === 'power') {
            const r = this.app.togglePower(el.getAttribute('data-dev'));
            if (!r.ok) this._flash = '设备认不出：' + r.reason;
            else this._flash = r.saved === false ? '改动没写进存储（读数可能丢）' : '';
            this.refresh();
            return;
        }
        if (act === 'mode') {
            const dev = el.getAttribute('data-dev');
            const cur = this.app.state.devices[dev].mode;
            const idx = AC_MODES.indexOf(cur);
            const next = AC_MODES[(idx + 1) % AC_MODES.length];
            const r = this.app.setProp(dev, 'mode', next);
            this._flash = r.ok ? ('模式 → ' + fmt('mode', next)) : ('没改成：' + r.reason);
            this.refresh();
            return;
        }
        if (act === 'step') {
            const dev = el.getAttribute('data-dev');
            const key = el.getAttribute('data-key');
            const dir = Number(el.getAttribute('data-dir'));
            const cur = Number(this.app.state.devices[dev][key]);
            const next = cur + dir * step(key);
            const r = this.app.setProp(dev, key, next);
            this._flash = r.ok ? (r.notes && r.notes.length ? r.notes.join('；') : '') : ('没改成：' + r.reason);
            this.refresh();
            return;
        }
        if (act === 'reset') {
            this.app.reset();
            this._flash = '已回初值';
            this.refresh();
        }
    }
}

export default IotView;
