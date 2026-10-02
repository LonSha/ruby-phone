/* ========================================================
 * uterus-view.js — [v3.48.0] 子宫画板 · 视图层
 * 照拄 diagdesk / archive / doujin / pvdesk 规格：_buildHTML() 拼串 →
 * innerHTML → _bindEvents()。只在 render / refresh 里读 App 现算值，
 * **不缓存投影**（每一笔都从 app.layoutOf() 现取）。
 *
 * 源是 st_bs_biotracker 的 uterus_render.js（50738 字节 / 1237 行）：
 * 它把 computeUterusLayout 的版面画到 96×120 上，自己起 setInterval
 * 每 180 毫秒推一帧。本件只取它的**绘制序与像素笔法**，不接它的外部耦合。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；文本内容里的与号与尖括号一律走拼装形。
 *
 * 四块不缝（源里全是外部耦合）：
 *  ① **不读宿主界面元素取主题色**（源 pickThemeHue 读 theme.screen / text /
 *     border 三者里最饱和的一个）—— 本件主题是**入参**，拿不到就回内置暗色盘；
 *  ② **不起定时器**（源 setInterval + visibilitychange + matchMedia 三套）——
 *     本件帧推进由调用方显式推（app.frameTick），视图只画当下这一帧；
 *  ③ **不写回角色状态**（源把呼吸相位与表情进度写回 profile）；
 *  ④ **不做一场演出**（源 drawCue / drawRupture / drawObstruction 要时间轴）——
 *     本件只画**当下这一帧**，演出不进本件。
 *
 * 五条偏离（逐条对着源的静默失效）：
 *  ① **认不出的胚型另立一格**（源默默当胎生画，看不出声明写错了）；
 *  ② **没画的胎逐个报名**（源只在画布右下角写 +N，不说哪几胎没画）；
 *  ③ **羊膜囊用版面层给的囊框**（源在视图层按实际像素重算一次切合）——
 *     两者可能差几像素，本件把差写在明细里，不假装切合；
 *  ④ **图块不缓存**（源有 160 格 LRU）；本件每次重栅格化，主题一换立即生效，
 *     不会画出上一版主题的颜色；
 *  ⑤ **推挤轮数与到顶重叠进画布读数**（源画完不报）。
 * ======================================================== */
'use strict';
import {
    UTERUS_CANVAS, MAX_DRAWN_FETUSES, PUSH_PASS_MAX, UD_ROWS_MAX, UD_CELLS_MAX, UD_LEDGER_MAX,
    MEMBRANE_TEXT, PRESSURE_TEXT, buildFetusGrid, toneColor, resolvePalette, wombRadius, quantizeAngle,
    affinityWordOf, DESCENT_INLET
} from './uterus-data.js';

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DASH = '--';
/* 像素小字：数字 / + / ?，用 3×5 点阵（fillText 会被抗锯齿糊掉）。真源同源。 */
const GLYPHS = Object.freeze({
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
    '+': ['000', '010', '111', '010', '000'], '?': ['111', '001', '011', '000', '010']
});
const TABS = [
    { key: 'board', label: '画板' },
    { key: 'fetuses', label: '胎明细' },
    { key: 'readings', label: '读数' },
    { key: 'ledger', label: '台账' }
];

/* 十六进制混色。源用 mixColor 生二十个色调；本件的色调已在数据层查表，
   这里只用于卵巢 / 膜线 / 空隙三处插值。 */
function hexRgb(hex) {
    const v = String(hex == null ? '' : hex).split('#').join('').trim();
    const full = (v.length === 3)
        ? (v.charAt(0) + v.charAt(0) + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2))
        : v;
    const n = Number.parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function pad2(s) { return s.length < 2 ? ('0' + s) : s; }
function mixHex(from, to, ratio) {
    const a = hexRgb(from);
    const b = hexRgb(to);
    const t = Math.max(0, Math.min(1, ratio));
    const out = [];
    for (let i = 0; i < 3; i += 1) out.push(pad2(Math.round(a[i] * (1 - t) + b[i] * t).toString(16)));
    return '#' + out.join('');
}
function toStr(v) { return (typeof v === 'string') ? v : ''; }
function numOr(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }
function listOf(v) { return Array.isArray(v) ? v : []; }
/* 图块的像素高度：版面的 size 以 32 格图块为基准。真源同源。 */
function spriteHeight(size) { return Math.max(6, Math.round((32 * numOr(size, 1)) / 10 * 0.66)); }

/** 视图层：四页签（画板 / 胎明细 / 读数 / 台账）；画布用像素笔逐格画。 */
export class UterusView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._out = '';
        this._pen = null;
        this._P = {};
        this._faceCount = 0;
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'ud-root ' + this._toneClassName(this.app.toneOf());
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
        this._paint();
    }
    refresh() {
        if (!this._root) return;
        this._root.className = 'ud-root ' + this._toneClassName(this.app.toneOf());
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
        this._paint();
    }
    _toneClassName(t) {
        const s = toStr(t);
        return 'ud-' + ((s === 'ok' || s === 'warn' || s === 'err' || s === 'off') ? s : 'off');
    }
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split(LT).join(AMP + 'lt;')
            .split(GT).join(AMP + 'gt;');
    }
    _empty(text) { return '<div class="ud-empty">' + this._esc(text) + '</div>'; }
    _note(text, tone) {
        return '<div class="ud-note ud-note-' + this._esc(tone || 'ok') + '">' + this._esc(text) + '</div>';
    }
    _tag(text, tone) {
        return '<span class="ud-tag ud-tag-' + this._esc(tone || 'ok') + '">' + this._esc(text) + '</span>';
    }
    _box(title, hint, inner) {
        const parts = ['<div class="ud-box">'];
        parts.push('<div class="ud-box-head"><span class="ud-box-title">' + this._esc(title) + '</span>');
        if (hint) parts.push('<span class="ud-box-hint">' + this._esc(hint) + '</span>');
        parts.push('</div>');
        parts.push('<div class="ud-box-body">' + inner + '</div>');
        parts.push('</div>');
        return parts.join('');
    }
    _metricBlock(list) {
        const rows = listOf(list);
        let inner = '<div class="ud-metrics">';
        for (let i = 0; i < rows.length; i += 1) {
            inner += '<div class="ud-metric"><span class="ud-metric-k">' + this._esc(rows[i].k) + '</span>'
                + '<span class="ud-metric-v">' + this._esc(rows[i].v) + '</span></div>';
        }
        inner += '</div>';
        return inner;
    }
    /* ---------- 整页 ---------- */
    _buildHTML() {
        const parts = [];
        parts.push('<div class="ud-head">');
        parts.push('<div class="ud-title">子宫画板</div>');
        parts.push('<div class="ud-sub">' + this._esc(this.app.faceText()) + '</div>');
        const why = this.app.whyOf();
        if (why) parts.push('<div class="ud-why">' + this._esc(why) + '</div>');
        parts.push('</div>');
        parts.push(this._tabsBlock());
        const tab = this.app.tab();
        if (tab === 'fetuses') parts.push(this._fetusPanel());
        else if (tab === 'readings') parts.push(this._readingPanel());
        else if (tab === 'ledger') parts.push(this._ledgerPanel());
        else parts.push(this._boardPanel());
        if (this._flash) parts.push('<div class="ud-flash">' + this._esc(this._flash) + NL() + '</div>');
        return parts.join('');
    }
    _tabsBlock() {
        const cur = this.app.tab();
        const parts = ['<div class="ud-tabs">'];
        for (let i = 0; i < TABS.length; i += 1) {
            const t = TABS[i];
            parts.push('<button class="ud-tab' + (t.key === cur ? ' on' : '') + '" data-act="tab" data-key="'
                + this._esc(t.key) + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 画板页签 ---------- */
    _boardPanel() {
        const parts = [];
        parts.push(this._inputBlock());
        parts.push(this._canvasBlock());
        parts.push(this._verdictBlock());
        parts.push(this._textBlock());
        parts.push(this._sourceBlock());
        return parts.join('');
    }
    _inputBlock() {
        let inner = '';
        inner += '<div class="ud-field">';
        inner += '<label class="ud-label">角色状态原文（贴一张对象，含 base 与 pregnant 两栏）</label>';
        inner += '<textarea class="ud-area" data-in="subject" placeholder="'
            + this._esc('例：{ "base": { "stage": "孕中期", "uterinePressure": 20, "libido": 40 }, "pregnant": { "effectivePregnantDays": 150, "fetuses": [ { "embryoId": "A", "embryoType": "胎生", "weight": 1, "affinity": 10, "tendencyAngle": 0, "descentStage": -3 } ] } }')
            + '">' + this._esc(this.app.inputOf()) + '</textarea>';
        inner += '</div>';
        inner += '<div class="ud-btns">';
        inner += '<button class="ud-btn ud-btn-main" data-act="ingest_subject">收下这份状态并画</button>';
        inner += '<button class="ud-btn ud-btn-quiet" data-act="clear_input">清空输入</button>';
        inner += '<button class="ud-btn ud-btn-quiet" data-act="clear_subject">放下一份状态</button>';
        inner += '</div>';
        return this._box('贴回一份状态', '只读成一张画板 —— **不写回角色状态、不读宿主界面元素、不起定时器**', inner);
    }
    _canvasBlock() {
        const L = this.app.layoutOf();
        let inner = '';
        inner += '<div class="ud-stage">';
        inner += '<canvas class="ud-canvas" data-canvas width="' + String(UTERUS_CANVAS.width) + '" height="' + String(UTERUS_CANVAS.height) + '"></canvas>';
        inner += '<div class="ud-stage-side">' + this._sideBlock(L) + '</div>';
        inner += '</div>';
        inner += '<div class="ud-stage-note">' + this._esc(L ? toStr(L.summary) : '还没有可画的状态') + '</div>';
        inner += '<div class="ud-btns">';
        inner += '<button class="ud-btn ud-btn-quiet" data-act="frame_tick">推一帧（帧由调用方显式推）</button>';
        inner += '</div>';
        return this._box('画布 ' + String(UTERUS_CANVAS.width) + ' × ' + String(UTERUS_CANVAS.height),
            '源每 180 毫秒自己推一帧；本件**只在点了才推**', inner);
    }
    _sideBlock(L) {
        if (!L) return this._empty('没有状态可画。');
        const rows = [
            { k: '阶段', v: toStr(L.stage).length ? toStr(L.stage) : '未设定' },
            { k: '孕日', v: String(Math.round(numOr(L.days, 0))) },
            { k: '宫压', v: String(numOr(L.pressureLevel, 0)) + ' 级 · ' + toStr(L.pressureText) },
            { k: '液面', v: String(Math.round(numOr(L.fluidHeight, 0))) },
            { k: '容量', v: String(Math.round(numOr(L.semenCapacity, 0))) },
            { k: '推挤轮', v: String(numOr(L.pushPasses, 0)) + ' / ' + String(PUSH_PASS_MAX) },
            { k: '堆叠', v: String(numOr(L.overlap, 0)) },
            { k: '乏力', v: String(numOr(L.atony, 0)) }
        ];
        let inner = '<div class="ud-reads">';
        for (let i = 0; i < rows.length; i += 1) {
            const warn = (rows[i].k === '堆叠' && numOr(L.overlap, 0) > 0) || (rows[i].k === '推挤轮' && numOr(L.pushPasses, 0) >= PUSH_PASS_MAX);
            inner += '<div class="ud-read"><span class="ud-read-k">' + this._esc(rows[i].k) + '</span>'
                + '<span class="ud-read-v' + (warn ? ' warn' : '') + '">' + this._esc(rows[i].v) + '</span></div>';
        }
        inner += '</div>';
        return inner;
    }
    _verdictBlock() {
        const L = this.app.layoutOf();
        const probs = this.app.problemCells();
        let inner = '';
        const rows = this.app.readingCells();
        if (!L) inner = this._empty('还没收下状态 —— 取不出来画横线，不画 0。');
        else {
            inner += '<div class="ud-table">';
            for (let i = 0; i < rows.length; i += 1) {
                const r = rows[i];
                const warn = (r.kind === 'warn');
                inner += '<div class="ud-tr"><span class="ud-td-name">' + this._esc(r.label) + '</span>'
                    + '<span class="ud-td-val' + (warn ? ' warn' : '') + '">' + this._esc(r.value) + '</span></div>';
            }
            inner += '</div>';
            inner += this._note('只报当下这一帧的读数；缺栏位与真值 0 **不同形**（缺栏位另列在下一格）。', 'ok');
        }
        const parts = [];
        parts.push(this._box('逐格读数（' + this._esc(this.app.verdictText()) + '）', '', inner));
        parts.push(this._problemBlock(probs));
        return parts.join('');
    }
    _problemBlock(probs) {
        const rows = listOf(probs);
        let inner = '';
        if (!rows.length) inner = this._empty('没有要处置的。');
        else {
            inner += '<div class="ud-list">';
            for (let i = 0; i < rows.length; i += 1) {
                inner += '<div class="ud-list-row ud-list-warn"><span class="ud-list-k">' + this._esc(rows[i].kind) + '</span>'
                    + '<span class="ud-list-v">' + this._esc(rows[i].text) + '</span></div>';
            }
            inner += '</div>';
        }
        return this._box('要处置的（逐条列，不合成一句「有点问题」）', '', inner);
    }
    _textBlock() {
        const app = this.app;
        let inner = '';
        inner += '<div class="ud-field">';
        inner += '<label class="ud-label">追加要求（可空）</label>';
        inner += '<textarea class="ud-area ud-area-sm" data-in="extra" placeholder="'
            + this._esc('例：把要处置的逐条列成清单，别合成一句') + '">' + this._esc(app.extraOf()) + '</textarea>';
        inner += '</div>';
        inner += '<div class="ud-btns">';
        inner += '<button class="ud-btn ud-btn-main" data-act="make_text">出一份读数文本</button>';
        inner += '</div>';
        return this._box('读数文本（本件唯一的产物）', '只产文本，**不写回角色状态、不改宿主任何键**', inner);
    }
    _sourceBlock() {
        const files = this.app.sourceFiles();
        let inner = '';
        inner += this._note(this.app.sourceNote(), 'ok');
        inner += '<div class="ud-list">';
        for (let i = 0; i < files.length; i += 1) {
            const f = files[i];
            inner += '<div class="ud-list-row"><span class="ud-list-k">' + this._esc(f.file) + '</span>'
                + '<span class="ud-list-v">' + this._esc(f.role) + '</span></div>';
        }
        inner += '</div>';
        return this._box('源清单（三片同族）', '', inner);
    }
    /* ---------- 胎明细页签 ---------- */
    _fetusPanel() {
        const app = this.app;
        const L = app.layoutOf();
        const parts = [];
        let inner = '';
        const rows = app.fetusCells();
        const lim = app.limits();
        if (!L) inner = this._empty('还没有可以清点的胎 —— 先贴回一份状态。');
        else {
            inner += this._metricBlock([
                { k: '看得见的胎', v: String(rows.length) },
                { k: '没画的胎', v: String(numOr(L.hiddenCount, 0)) },
                { k: '画上限', v: String(lim.fetuses) }
            ]);
            if (!rows.length) inner += this._empty('这一份没有看得见的胎。');
            else {
                inner += '<div class="ud-table">';
                inner += '<div class="ud-tr ud-th"><span class="ud-td-name">胚号</span><span class="ud-td-val">形状</span>'
                    + '<span class="ud-td-num">大小</span><span class="ud-td-num">降阶</span></div>';
                for (let i = 0; i < rows.length; i += 1) {
                    const r = rows[i];
                    const shape = r.type + ' · 第' + String(numOr(r.stage, 0) + 1) + '段';
                    inner += '<div class="ud-tr' + (r.unknownType ? ' ud-bad' : '') + '">';
                    inner += '<span class="ud-td-name">' + this._esc(r.embryoId) + '</span>';
                    inner += '<span class="ud-td-val">' + this._esc(shape)
                        + (r.unknownType ? ('　' + this._tag('认不出，按 ' + toStr(r.declaredType ? '胎生' : '胎生') + ' 画', 'warn')) : '') + '</span>';
                    inner += '<span class="ud-td-num">' + this._esc(String(numOr(r.size, 0))) + '</span>';
                    inner += '<span class="ud-td-num">' + this._esc(String(numOr(r.descent, 0))) + '</span>';
                    inner += '</div>';
                }
                inner += '</div>';
                inner += this._note('认不出的胚型另立一格（源默默当胎生画，看不出声明写错了）；降阶与胎位角逐胎列。', 'ok');
            }
            const hidden = listOf(L.hiddenList);
            if (hidden.length) {
                inner += '<div class="ud-sub-title">没画的胎逐个报名（源只写 +N）</div>';
                inner += '<div class="ud-list">';
                for (let i = 0; i < hidden.length; i += 1) {
                    inner += '<div class="ud-list-row' + (hidden[i].unknownType ? ' ud-list-warn' : '') + '"><span class="ud-list-k">' + this._esc(hidden[i].embryoId) + '</span>'
                        + '<span class="ud-list-v">' + this._esc('超过上限 ' + String(numOr(hidden[i].cap, MAX_DRAWN_FETUSES)) + ' 没画（只报，不静默丢）'
                            + (hidden[i].unknownType ? ('　声明「' + toStr(hidden[i].declaredType) + '」也不在五型册子里') : '')) + '</span></div>';
                }
                inner += '</div>';
            }
            inner += this._fetusDetail(rows);
            inner += this._missingBlock(L);
        }
        parts.push(this._box('胎逐格（降阶 / 胎位角 / 亲和 / 羊膜逐胎列）', '', inner));
        return parts.join('');
    }
    _fetusDetail(rows) {
        if (!rows.length) return '';
        let inner = '<div class="ud-sub-title">逐胎细目（认不出的声明另立一格）</div>';
        inner += '<div class="ud-list">';
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            let line = '降阶 ' + toStr(r.descentText) + ' / 胎位角 ' + String(numOr(r.angle, 0)) + ' 度';
            line += ' / 亲和 ' + affinityWordOf(r.affinityBand);
            line += ' / 羊膜 ' + String(numOr(r.amnion, 0)) + '（' + toStr(r.amnionText) + '）';
            if (toStr(r.gender).length) line += ' / 性别 ' + toStr(r.gender);
            if (r.mirror || r.posterior) line += ' / 朝向 ' + (r.posterior ? '背朝后' : '背朝前') + (r.mirror ? ' · 背朝右' : '');
            if (r.unknownType) line += ' / 声明「' + toStr(r.declaredType) + '」不在五型册子里（本件按胎生画，另记一处要处置）';
            inner += '<div class="ud-list-row' + (r.unknownType ? ' ud-list-warn' : '') + '"><span class="ud-list-k">'
                + this._esc(r.embryoId) + '</span><span class="ud-list-v">' + this._esc(line) + '</span></div>';
        }
        inner += '</div>';
        return inner;
    }
    _missingBlock(L) {
        const missing = listOf(L.missing);
        let inner = '<div class="ud-sub-title">缺栏位逐格（缺栏位不许读成 0）</div>';
        if (!missing.length) inner += this._empty('没有缺栏位。');
        else {
            inner += '<div class="ud-list">';
            for (let i = 0; i < missing.length; i += 1) {
                inner += '<div class="ud-list-row ud-list-warn"><span class="ud-list-k">缺</span>'
                    + '<span class="ud-list-v">' + this._esc(missing[i]) + '</span></div>';
            }
            inner += '</div>';
            inner += this._note('源拿不到这些栏位就按默认值往下算；本件逐格记下，不许无声。', 'warn');
        }
        return inner;
    }
    /* ---------- 读数页签 ---------- */
    _readingPanel() {
        const app = this.app;
        const L = app.layoutOf();
        const lim = app.limits();
        const parts = [];
        let inner = '';
        const rows = app.readingCells();
        if (!L) inner = this._empty('还没有可以读的版面 —— 先贴回一份状态。');
        else {
            inner += '<div class="ud-table">';
            inner += '<div class="ud-tr ud-th"><span class="ud-td-name">读数</span><span class="ud-td-val">值</span></div>';
            for (let i = 0; i < rows.length; i += 1) {
                const r = rows[i];
                inner += '<div class="ud-tr' + (r.kind === 'warn' ? ' ud-bad' : '') + '">';
                inner += '<span class="ud-td-name">' + this._esc(r.label) + '</span>';
                inner += '<span class="ud-td-val">' + this._esc(r.value) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
            inner += this._note('逐格取数据层算出的值，视图不自己算一份；推挤轮与堆叠两个读数直接对着源的静默面。', 'ok');
        }
        parts.push(this._box('逐格读数（视图不重算）', '', inner));
        let capInner = this._metricBlock([
            { k: '画上限', v: String(lim.fetuses) + ' 胎' },
            { k: '推挤上限', v: String(lim.passes) + ' 轮' },
            { k: '格子上限', v: String(lim.cells) + ' 格' },
            { k: '行上限', v: String(lim.rows) + ' 行' },
            { k: '台账上限', v: String(lim.ledger) + ' 条' }
        ]);
        capInner += this._note('上限一律成字（源无上限读数）；超上限的胎在胎明细页逐个报名。', 'ok');
        parts.push(this._box('上限读数（源无此栏）', '', capInner));
        let outInner = '';
        const out = toStr(this._out);
        if (!out.length) outInner = this._empty('还没出过文本 —— 切回画板页签发一份。');
        else outInner = '<pre class="ud-pre">' + this._esc(out) + '</pre>';
        parts.push(this._box('上一次出的读数文本（只读）', '', outInner));
        return parts.join('');
    }
    /* ---------- 台账页签 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.ledgerRows();
        const dropped = app.droppedOf();
        const acts = app.actionList();
        let inner = '';
        inner += this._metricBlock([
            { k: '当前条数', v: String(rows.length) },
            { k: '已挤掉', v: String(dropped) },
            { k: '上限', v: String(UD_LEDGER_MAX) }
        ]);
        if (!rows.length) inner += this._empty('还没有动作。');
        else {
            inner += '<div class="ud-table">';
            inner += '<div class="ud-tr ud-th"><span class="ud-td-name">动作</span><span class="ud-td-val">结果</span><span class="ud-td-num">量</span></div>';
            for (let i = 0; i < rows.length; i += 1) {
                const r = rows[i];
                const res = r.ok ? '成' : ('不成' + (r.why ? ('（' + app.intakeWhyText(r.why) + '）') : ''));
                inner += '<div class="ud-tr' + (r.ok ? '' : ' ud-bad') + '">';
                inner += '<span class="ud-td-name">' + this._esc(app.actionTextOf(r.action)) + '</span>';
                inner += '<span class="ud-td-val">' + this._esc(res) + '</span>';
                inner += '<span class="ud-td-num">' + this._esc(String(numOr(r.n, 0))) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
        }
        inner += '<div class="ud-btns">';
        inner += '<button class="ud-btn ud-btn-quiet" data-act="clear_ledger">清台账（不动已收下的状态）</button>';
        inner += '</div>';
        inner += this._note('台账挤掉旧记录会报数，不静默；清台账只清本件自己那条键。', 'ok');
        const parts = [];
        parts.push(this._box('动作台账（本件自己的键）', '', inner));
        const acs = this._metricBlock([
            { k: '动作册', v: String(acts.length) },
            { k: '状态原文', v: String(app.rawLen()) + ' 字符' },
            { k: '收下时刻', v: app.subjectStamp() },
            { k: '当下时刻', v: app.nowStamp() },
            { k: '帧号', v: String(app.tickCount()) }
        ]);
        parts.push(this._box('规模与时刻（只报，不截）', '', acs));
        const whys = this.app.intakeWhys();
        let whyInner = '<div class="ud-list">';
        for (let i = 0; i < whys.length; i += 1) {
            whyInner += '<div class="ud-list-row"><span class="ud-list-k">' + this._esc(whys[i]) + '</span><span class="ud-list-v">'
                + this._esc(this.app.intakeWhyText(whys[i])) + '</span></div>';
        }
        whyInner += '</div>';
        parts.push(this._box('收录失败因逐因成立', '', whyInner));
        return parts.join('');
    }
    /* ================================================================
     * 绘制段：源的 drawUterus → drawFluid → drawFetuses → drawFrontWall
     * 这一序（uterus_render.js 536～960 行）。本件只画当下这一帧。
     * ================================================================ */
    _paint() {
        const L = this.app.layoutOf();
        const canvas = this._canvasEl();
        if (!canvas) return;
        const ctx = (typeof canvas.getContext === 'function') ? canvas.getContext('2d') : null;
        if (!ctx) return;
        canvas.width = UTERUS_CANVAS.width;
        canvas.height = UTERUS_CANVAS.height;
        if (typeof ctx.imageSmoothingEnabled === 'boolean') ctx.imageSmoothingEnabled = false;
        const gate = this.app.paletteNow();
        const P = (gate && gate.palette) ? gate.palette : {};
        this._pen = this._makePen(ctx, P);
        this._P = P;
        this._pen.px(0, 0, UTERUS_CANVAS.width, UTERUS_CANVAS.height, P.bg);
        this._faceCount = (L && gate) ? numOr(gate.themed, 0) : 0;
        if (!L) {
            this._pen.glyphs('?' + '0', 60, 112, P.tick);
            return;
        }
        this._paintUterus(L);
        this._paintFluid(L);
        this._paintEmptyStage(L);
        this._paintFetuses(L);
        this._paintFrontWall(L);
        this._paintTicks(L);
    }
    _canvasEl() {
        if (!this._root) return null;
        if (typeof this._root.querySelector !== 'function') return null;
        return this._root.querySelector('[data-canvas]');
    }
    /* 像素画笔：只用填色矩形，座标一律取整（源 makePen）。 */
    _makePen(ctx, P) {
        const self = this;
        const px = function (x, y, w, h, color) {
            ctx.fillStyle = color;
            ctx.fillRect(Math.round(x), Math.round(y), Math.round(w === undefined ? 1 : w), Math.round(h === undefined ? 1 : h));
        };
        const ellipse = function (cx, cy, rx, ry, color) {
            ctx.fillStyle = color;
            for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y += 1) {
                const q = 1 - Math.pow((y - cy) / ry, 2);
                if (q < 0) continue;
                const hw = Math.floor(rx * Math.sqrt(q));
                ctx.fillRect(Math.round(cx - hw), y, hw * 2 + 1, 1);
            }
        };
        const line = function (x0, y0, x1, y1, color) {
            let ax = Math.round(x0); let ay = Math.round(y0);
            const bx = Math.round(x1); const by = Math.round(y1);
            const dx = Math.abs(bx - ax);
            const sx = (ax < bx) ? 1 : -1;
            const dy = -Math.abs(by - ay);
            const sy = (ay < by) ? 1 : -1;
            let e = dx + dy;
            for (let guard = 0; guard < 400; guard += 1) {
                px(ax, ay, 1, 1, color);
                if (ax === bx && ay === by) break;
                const e2 = 2 * e;
                if (e2 >= dy) { e += dy; ax += sx; }
                if (e2 <= dx) { e += dx; ay += sy; }
            }
        };
        const ring = function (cx, cy, rx, ry, color) {
            for (let a = 0; a < 360; a += 3) {
                const r = (a * Math.PI) / 180;
                px(cx + Math.cos(r) * rx, cy + Math.sin(r) * ry, 1, 1, color);
            }
        };
        const glyphs = function (text, x, y, color) {
            const chars = String(text).split('');
            for (let i = 0; i < chars.length; i += 1) {
                const rows = GLYPHS[chars[i]];
                if (!rows) continue;
                for (let dy = 0; dy < rows.length; dy += 1) {
                    const row = rows[dy];
                    for (let dx = 0; dx < row.length; dx += 1) {
                        if (row.charAt(dx) === '1') px(x + i * 4 + dx, y + dy, 1, 1, color);
                    }
                }
            }
        };
        return { px: px, ellipse: ellipse, line: line, ring: ring, glyphs: glyphs, ctx: ctx, P: P, self: self };
    }
    /* 色调代号 → 颜色（查数据层的表，不在视图里再编一份）。 */
    _toneColor(tone) {
        const P = this._P || {};
        const c = toneColor(tone);
        if (typeof c === 'string' && P[c]) return P[c];
        return (typeof c === 'string') ? c : (P.fetus || '#f8ae96');
    }
    _wallTone(L) {
        const P = this._P;
        return (numOr(L.pressureLevel, 0) >= 2) ? P.wallTense : (numOr(L.pressureLevel, 0) >= 1 ? P.wallLight : P.wall);
    }
    _liningTone(L) {
        const P = this._P;
        const s = toStr(L.emptyStage);
        if (!s.length) return (numOr(L.pressureLevel, 0) >= 2) ? P.wallTense : P.wallLight;
        if (s === '月经期') return P.blood;
        if (s === '卵泡期') return P.wallLight;
        if (s === '排卵期') return P.shine;
        if (s === '黄体期') return P.lining;
        if (s === '产后恢复') return P.blood;
        if (s === '假孕期') return P.lining;
        return P.wallLight;
    }
    _paintWomb(L, pad, shift, color) {
        const pen = this._pen;
        const womb = L.womb;
        const p = numOr(pad, 0);
        const s = numOr(shift, 0);
        for (let y = Math.ceil(womb.cy + s - womb.ry - p); y <= Math.floor(womb.cy + s + womb.ry + p); y += 1) {
            const r = wombRadius(womb, y, p, s);
            if (r) pen.px(womb.cx - r, y, r * 2 + 1, 1, color);
        }
    }
    _outlineWomb(L, pad, shift, color) {
        const pen = this._pen;
        const womb = L.womb;
        const p = numOr(pad, 0);
        const s = numOr(shift, 0);
        for (let y = Math.ceil(womb.cy + s - womb.ry - p); y <= Math.floor(womb.cy + s + womb.ry + p); y += 1) {
            const r = wombRadius(womb, y, p, s);
            if (r) { pen.px(womb.cx - r, y, 1, 1, color); pen.px(womb.cx + r, y, 1, 1, color); }
        }
    }
    /* 子宫乏力：宫壁外缘的斜向细纹，级数越高越密（源用图样不换色）。 */
    _paintAtony(L) {
        const pen = this._pen;
        const P = this._P;
        const level = Math.min(6, Math.max(0, Math.floor(numOr(L.atony, 0))));
        if (level <= 0) return;
        const womb = L.womb;
        const count = level * 2;
        const sides = [-1, 1];
        for (let i = 0; i < count; i += 1) {
            const y = Math.round(womb.cy - womb.ry * 0.6 + ((i + 0.5) * womb.ry * 1.2) / count);
            const edge = wombRadius(womb, y);
            if (!edge) continue;
            for (let si = 0; si < sides.length; si += 1) {
                for (let d = 0; d < 3; d += 1) pen.px(womb.cx + sides[si] * (edge - 1 - d), y + d - 1, 1, 1, P.wallDark);
            }
        }
    }
    /* 延产期：宫颈横一道膜色的封口，三颗结晶钉住（源同源）。 */
    _paintExtensionSeal(L) {
        if (!L.extensionSeal) return;
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const tract = L.tract;
        const cx = womb.cx;
        const y = tract.neckTop + Math.max(1, Math.floor(tract.neckLength / 2));
        pen.px(cx - 9, y - 1, 18, 3, P.water);
        pen.px(cx - 8, y, 16, 1, P.waterLight);
        const pins = [cx - 6, cx, cx + 6];
        for (let i = 0; i < pins.length; i += 1) {
            const x = pins[i];
            pen.px(x - 1, y - 2, 3, 1, P.waterLight);
            pen.px(x, y - 3, 1, 1, P.waterLight);
            pen.px(x - 1, y + 2, 3, 1, P.water);
            pen.px(x, y + 3, 1, 1, P.water);
        }
    }
    /* 子宫本体：输卵管与卵巢（卵巢随性欲变红）、宫颈与产道、四层宫壁、宫腔。源同源。 */
    _paintUterus(L) {
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const tract = L.tract;
        const wallInset = numOr(L.wallInset, 7);
        const cx = womb.cx;
        const cy = womb.cy;
        const rx = womb.rx;
        const ry = womb.ry;
        const top = womb.top;
        const heat = numOr(L.libidoHeat, 0);
        const tubeY = top + Math.round(ry * 0.48);
        const ovaryOuter = mixHex(P.wallDark, P.ovaryHot, heat);
        const ovaryInner = mixHex(P.wallLight, P.ovaryGlow, heat);
        for (let si = 0; si < 2; si += 1) {
            const side = (si === 0) ? -1 : 1;
            const start = cx + side * wombRadius(womb, tubeY);
            const end = cx + side * Math.min(42, rx + 10);
            pen.line(start, tubeY, end, tubeY - 5, P.wallDark);
            pen.line(start, tubeY - 1, end, tubeY - 6, P.wallLight);
            pen.ellipse(end, tubeY - 6, 4, 5, ovaryOuter);
            pen.ellipse(end - side, tubeY - 7, 2, 3, ovaryInner);
            pen.px(end - side, tubeY - 8, 1, 1, P.shine);
        }
        pen.px(cx - 8, tract.neckTop, 16, tract.neckLength + 1, P.wallDark);
        pen.px(cx - 7, tract.neckTop, 14, tract.neckLength, P.wall);
        pen.px(cx - 4, tract.canalTop, 8, 22, P.wallDark);
        pen.px(cx - 3, tract.canalTop, 6, 21, P.cavityDeep);
        pen.px(cx - 6, tract.canalTop + 4, 2, 13, P.wallLight);
        pen.px(cx + 4, tract.canalTop + 4, 2, 13, P.wallLight);
        this._paintWomb(L, 3, 0, P.frame);
        this._paintWomb(L, 1, 0, P.wallDark);
        this._paintWomb(L, 0, 0, this._wallTone(L));
        this._paintWomb(L, -3, 1, this._liningTone(L));
        this._paintWomb(L, -wallInset + 2, 2, P.cavity);
        this._paintWomb(L, -wallInset, 4, P.cavityDeep);
        for (let y = top + wallInset + 1; y < cy + ry - wallInset; y += 3) {
            for (let x = cx - rx + wallInset; x < cx + rx - wallInset; x += 3) {
                const inner = wombRadius(womb, y, -wallInset, 4);
                if (Math.abs(x - cx) < inner - 2 && (x * 13 + y * 7) % 5 === 0) pen.px(x, y, 1, 1, P.cavity);
            }
        }
        const pl = numOr(L.pressureLevel, 0);
        this._outlineWomb(L, -3, 1, toStr(L.emptyStage).length ? this._liningTone(L) : ((pl >= 2) ? P.wallLight : P.shine));
        this._paintAtony(L);
        this._paintExtensionSeal(L);
        if (L.lateBulge) this._paintBulge(L);
        if (pl >= 3 && this.app.tickCount() > 0) this._paintTremble(L);
    }
    /* 孕晚期胎儿把子宫壁顶出 1～2 像素（源同源）。 */
    _paintBulge(L) {
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const cx = womb.cx;
        const rx = womb.rx;
        const top = womb.top;
        const items = listOf(L.fetuses);
        for (let i = 0; i < items.length; i += 1) {
            const f = items[i];
            if (numOr(f.descent, -3) > DESCENT_INLET) continue;
            const reachBase = numOr(f.size, 0) * numOr(f.squeeze, 1) * 0.9;
            for (let dy = -5; dy <= 5; dy += 1) {
                const y = Math.round(numOr(f.y, 0) + dy);
                const edge = wombRadius(womb, y);
                if (!edge) continue;
                for (let si = 0; si < 2; si += 1) {
                    const side = (si === 0) ? -1 : 1;
                    const reach = side * (numOr(f.x, cx) - cx) + reachBase;
                    if (reach < edge - 3) continue;
                    const bump = Math.max(1, 2 - Math.floor(Math.abs(dy) / 4));
                    for (let d = 1; d <= bump; d += 1) pen.px(cx + side * (edge + d), y, 1, 1, (d === bump) ? P.wallDark : P.wall);
                    pen.px(cx + side * (edge - 1), y, 1, 1, P.wallLight);
                }
            }
            if (Math.abs(numOr(f.x, cx) - cx) < rx * 0.35 && (numOr(f.y, 0) - numOr(f.size, 0)) < top + 18) {
                const x = Math.max(cx - rx + 5, Math.min(cx + rx - 5, Math.round(numOr(f.x, cx))));
                const offset = (x - cx) / (rx + 2);
                const localTop = Math.round(womb.cy - (womb.ry + 2) * Math.sqrt(Math.max(0, 1 - offset * offset)));
                pen.px(x - 1, localTop, 3, 1, P.wallDark);
                pen.px(x - 2, localTop + 1, 5, 1, P.wall);
                pen.px(x - 3, localTop + 2, 7, 1, P.wallLight);
            }
        }
    }
    /* 宫压颤动：侧壁按帧号抖一下（源每 1.5 秒一次；本件只在推了帧之后）。 */
    _paintTremble(L) {
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const phase = this.app.tickCount() % 1500;
        if (phase >= 320) return;
        const shift = (phase < 160) ? 1 : -1;
        for (let y = womb.cy - 7; y <= womb.cy + 7; y += 2) {
            const edge = wombRadius(womb, y, 1);
            pen.px(womb.cx - edge - 1 + shift, y, 1, 2, P.wallTense);
            pen.px(womb.cx + edge + 1 + shift, y, 1, 2, P.wallTense);
        }
    }
    /* 宫腔内的液面：精液到多少就淹到多高（源按 (x + y*2) % 4 < 2 打点）。 */
    _paintFluid(L) {
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const wallInset = numOr(L.wallInset, 7);
        const fluidHeight = numOr(L.fluidHeight, 0);
        if (!fluidHeight) return;
        const innerRy = womb.ry - wallInset;
        const bottom = womb.cy + 4 + innerRy - 1;
        const level = bottom - fluidHeight + 1;
        const left = womb.cx - womb.rx + wallInset;
        const right = womb.cx + womb.rx - wallInset;
        for (let y = level; y <= bottom; y += 1) {
            for (let x = left; x < right; x += 1) {
                if ((x + y * 2) % 4 < 2) pen.px(x, y, 1, 1, P.fluid);
            }
        }
        for (let x = left; x < right; x += 3) pen.px(x, Math.min(bottom, level + (x % 2)), 2, 1, P.fluidLight);
    }
    /* 未孕阶段的宫腔内容：经期血点 / 黄体与假孕的膜线 / 产后恢复的残留。源同源。 */
    _paintEmptyStage(L) {
        const s = toStr(L.emptyStage);
        if (!s.length) return;
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const wallInset = numOr(L.wallInset, 7);
        const progress = Math.max(0, Math.min(1, numOr(L.emptyProgress, 0)));
        const cx = womb.cx;
        const cy = womb.cy + 4;
        if (s === '月经期') {
            const marks = Math.ceil(Math.max(0, Math.sin(Math.PI * (0.08 + 0.92 * progress))) * 5);
            for (let i = 0; i < marks; i += 1) pen.px(cx - 4 + i * 2, cy + 2 + (i % 3) * 3, 1, 2, P.blood);
        } else if (s === '黄体期' || s === '假孕期') {
            const edge = Math.max(1, womb.rx - wallInset - 2);
            for (let y = cy - 5; y <= cy + 6; y += 3) {
                pen.px(cx - edge, y, 1, 1, P.lining);
                pen.px(cx + edge, y + 1, 1, 1, P.lining);
            }
        } else if (s === '产后恢复') {
            const marks = Math.round(7 * (1 - progress));
            for (let i = 0; i < marks; i += 1) pen.px(cx - 5 + ((i * 3) % 10), cy - 5 + ((i * 7) % 12), 1, 2, (i % 2) ? P.blood : P.wallLight);
        }
    }
    /* 呼吸：一像素位移（源把相位写回状态；本件只按帧号算，不写任何地方）。 */
    _breath(f, tick) {
        if (numOr(tick, 0) <= 0) return 0;
        return Math.floor((tick + numOr(f.index, 0) * 450) / 1200) % 2;
    }
    /* 图块规格：依大小、胎位角、胎背方位与挤压直接栅格化，1:1 贴上，不做旋转缩放。 */
    _fetusSpec(size, sprite, angle, squeeze, gap, membrane, nestedHost) {
        const q = (numOr(squeeze, 1) * 20);
        return {
            type: toStr(sprite.type).length ? toStr(sprite.type) : '胎生',
            stage: numOr(sprite.stage, 0),
            height: spriteHeight(size),
            angle: quantizeAngle(angle),
            mirror: Boolean(sprite.mirror),
            posterior: Boolean(sprite.posterior),
            squeeze: Math.round(q) / 20,
            membrane: numOr(membrane, 100),
            nestedHost: Boolean(nestedHost),
            gap: toStr(gap)
        };
    }
    /* 一胎：把数据层栅格化出来的色格逐格填上（空格外圈用背景色切出缝，多胎才分得开）。 */
    _paintSprite(x, y, size, sprite, angle, squeeze, gap, membrane, nestedHost) {
        const pen = this._pen;
        const spec = this._fetusSpec(size, sprite, angle, squeeze, gap, membrane, nestedHost);
        const grid = this.app.gridOf(spec);
        if (!grid || !grid.cells) return;
        const ctx = pen.ctx;
        const filled = function (gx, gy) {
            const row = grid.cells[gy];
            if (!row) return false;
            return Boolean(row[gx]);
        };
        const ox = Math.round(x) - numOr(grid.anchorX, 0);
        const oy = Math.round(y) - numOr(grid.anchorY, 0);
        for (let gy = 0; gy < grid.cells.length; gy += 1) {
            const row = grid.cells[gy];
            for (let gx = 0; gx < row.length; gx += 1) {
                const tone = row[gx];
                if (tone) {
                    ctx.fillStyle = this._toneColor(tone);
                    ctx.fillRect(ox + gx, oy + gy, 1, 1);
                } else if (filled(gx - 1, gy) || filled(gx + 1, gy) || filled(gx, gy - 1) || filled(gx, gy + 1)) {
                    ctx.fillStyle = this._toneColor('sac');
                    ctx.fillRect(ox + gx, oy + gy, 1, 1);
                }
            }
        }
    }
    /* 羊膜囊：实心的羊水色加一圈膜线，底部朝宫口开口；变薄时按角度规律留缺口。 */
    _paintBubble(sac) {
        const pen = this._pen;
        const P = this._P;
        const cx = numOr(sac.cx, 0);
        const cy = numOr(sac.cy, 0);
        const rx = Math.max(1, numOr(sac.rx, 1));
        const ry = Math.max(1, numOr(sac.ry, 1));
        const durability = numOr(sac.durability, 100);
        if (durability <= 0) return;
        const soak = this.app.layoutOf() && this.app.layoutOf().semenSoaked ? 0.45 : 0;
        const thin = durability < 30;
        const fluid = thin ? mixHex(P.cavity, P.fluidLight, 0.1) : mixHex(P.cavity, P.fluidLight, 0.2);
        const memBase = mixHex(P.water, P.cavity, thin ? 0.55 : 0.2);
        const membrane = mixHex(memBase, P.fluidLight, soak);
        const opening = thin ? ((30 - durability) / 30) * 120 : 0;
        const gapRatio = (durability >= 60) ? 0 : (durability >= 30 ? 0.2 + ((60 - durability) / 30) * 0.3 : 0.5);
        const inside = function (x, y) {
            const nx = (x + 0.5 - cx) / rx;
            const ny = (y + 0.5 - cy) / ry;
            return nx * nx + ny * ny <= 1;
        };
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
                if (!inside(x, y)) continue;
                const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
                if (!edge) { pen.px(x, y, 1, 1, fluid); continue; }
                const deg = ((Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI + 360) % 360;
                const broken = (opening > 0 && Math.abs(deg - 90) <= opening / 2)
                    || (gapRatio > 0 && ((Math.floor(deg / 9) * 37 + 11) % 100) < gapRatio * 100);
                pen.px(x, y, 1, 1, broken ? fluid : membrane);
            }
        }
    }
    /* 从后往前交替画囊与胎；同卵共用一个囊（源同源）。 */
    _paintFetuses(L) {
        const items = listOf(L.fetuses);
        const sacs = listOf(L.sacs);
        const drawnSacs = [];
        for (let i = items.length - 1; i >= 0; i -= 1) {
            const f = items[i];
            let sac = null;
            for (let si = 0; si < sacs.length; si += 1) {
                if (listOf(sacs[si].embryoIds).indexOf(f.embryoId) >= 0) { sac = sacs[si]; break; }
            }
            if (sac && drawnSacs.indexOf(sac) < 0) {
                drawnSacs.push(sac);
                const members = [];
                for (let mi = 0; mi < items.length; mi += 1) {
                    if (listOf(sac.embryoIds).indexOf(items[mi].embryoId) >= 0) members.push(items[mi]);
                }
                const fluid = members.some(function (m) {
                    return !(toStr(m.sprite.type) === '胎转卵生' && numOr(m.stage, 0) === 2);
                });
                if (fluid) this._paintBubble(sac);
            }
            const y = numOr(f.y, 0) + this._breath(f, this.app.tickCount());
            this._paintSprite(f.x, y, f.size, f.sprite, f.angle, f.squeeze, '', numOr(f.amnion, 100), listOf(f.inner).length > 0);
        }
    }
    /* 前壁：盖在宫腔内容上的一圈轮廓与宫颈前壁（源同源）。 */
    _paintFrontWall(L) {
        const pen = this._pen;
        const P = this._P;
        const womb = L.womb;
        const tract = L.tract;
        const wallInset = numOr(L.wallInset, 7);
        this._outlineWomb(L, -wallInset + 1, 4, this._wallTone(L));
        this._outlineWomb(L, -wallInset, 4, P.wallDark);
        pen.px(womb.cx - 8, tract.neckTop + 1, 2, tract.neckLength - 1, P.wallDark);
        pen.px(womb.cx + 6, tract.neckTop + 1, 2, tract.neckLength - 1, P.wallDark);
        pen.px(womb.cx - 6, tract.neckTop + 1, 1, tract.neckLength - 1, P.wallLight);
        pen.px(womb.cx + 5, tract.neckTop + 1, 1, tract.neckLength - 1, P.wallLight);
        pen.px(womb.cx - 6, tract.canalTop, 2, 17, P.wallLight);
        pen.px(womb.cx + 4, tract.canalTop, 2, 17, P.wallLight);
    }
    /* 刻度、没画的胎数、推挤读数；主题取色格数（源无此栏）。 */
    _paintTicks(L) {
        const pen = this._pen;
        const P = this._P;
        for (let i = 0; i < 8; i += 1) {
            const w = (i % 2) ? 2 : 4;
            pen.px(4, 35 + i * 8, w, 1, P.tick);
            pen.px(88, 35 + i * 8, w, 1, P.tick);
        }
        const hidden = numOr(L.hiddenCount, 0);
        if (hidden > 0) {
            const label = String(hidden);
            const x0 = 80 - label.length * 4;
            pen.px(x0 - 4, 99, 3, 1, P.signal);
            pen.px(x0 - 3, 98, 1, 3, P.signal);
            pen.glyphs(label, x0, 100, P.signal);
        }
        const overlap = numOr(L.overlap, 0);
        if (overlap > 0) {
            pen.px(2, 3, 3, 1, P.signal);
            pen.px(3, 2, 1, 3, P.signal);
            pen.glyphs(String(Math.min(9, overlap)), 6, 2, P.signal);
        } else if (L.reachCap) {
            pen.px(2, 3, 3, 1, P.tick);
            pen.px(3, 2, 1, 3, P.tick);
            pen.glyphs(String(PUSH_PASS_MAX), 6, 2, P.tick);
        }
        if (this._faceCount > 0) pen.px(1, 1, 2, 2, P.signal);
    }
    /* ---------- 事件 ---------- */
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        const self = this;
        const acts = root.__all('[data-act]');
        for (let i = 0; i < acts.length; i += 1) {
            const el = acts[i];
            el.addEventListener('click', function (ev) {
                const a = el.getAttribute('data-act');
                if (a === 'tab') self._onTab(el, ev);
                else self._onAction(a, el, ev);
            });
        }
        const areas = root.__all('[data-in]');
        for (let i = 0; i < areas.length; i += 1) {
            const el = areas[i];
            el.addEventListener('input', function () {
                self._onInput(el.getAttribute('data-in'), el.value);
            });
        }
    }
    _onInput(kind, value) {
        const v = (typeof value === 'string') ? value : '';
        if (kind === 'extra') this.app.setExtra(v);
        else this.app.setInput(v);
    }
    _onTab(el, ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        this.app.setTab(el.getAttribute('data-key'));
        this.app.render();
    }
    _onAction(act, el, ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        const app = this.app;
        const a = (typeof act === 'string') ? act : '';
        if (a === 'ingest_subject') {
            const r = app.ingestSubject(app.inputOf());
            this._flash = r.ok ? '' : ('没收下（' + app.intakeWhyText(r.why) + '）');
            if (r.ok) { app.setTab('board'); app.setInput(''); }
        } else if (a === 'clear_input') {
            app.setInput('');
            this._flash = '';
        } else if (a === 'clear_subject') {
            const r = app.clearSubject();
            app.setInput('');
            this._flash = '已放下（清掉 ' + String(numOr(r.cleared, 0)) + ' 字符）—— 只动本件自己的两条键，宿主一个字段都没碰。';
        } else if (a === 'frame_tick') {
            app.frameTick();
            this._flash = '推了一帧（帧号 ' + String(app.tickCount()) + '）。本件内不起定时器，帧只在你推的时候走。';
        } else if (a === 'make_text') {
            const r = app.readNow(app.extraOf());
            if (r.ok) {
                this._out = r.text;
                this._flash = '出好了（' + String(numOr(r.chars, 0)) + ' 字符 / 待处置 ' + String(numOr(r.problems, 0)) + ' 处）。';
            } else {
                this._flash = '出不了（' + app.intakeWhyText(r.why) + '）';
            }
            app.setTab('readings');
        } else if (a === 'clear_ledger') {
            const r = app.clearLedger();
            this._flash = '清掉 ' + String(numOr(r.cleared, 0)) + ' 条（本件自己的台账，已收下的状态没动）。';
        }
        app.render();
    }
}
