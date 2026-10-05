/* ========================================================
 * diagdesk-view.js — [v3.47.0] 诊断案头 · 视图层
 * 照拄 archive / doujin / pvdesk / cotdesk 规格：_buildHTML() 拼串 →
 * innerHTML → _bindEvents()。只在 render / refresh 里读 App 现算值，
 * **不缓存投影**。
 *
 * 六条视图纪律（逐条对着源的静默失效）：
 *  ① **四态逐格分开画**：「还没收过存档」与「收下了但读不懂」与
 *     「没建过体检」不同形 —— 源把读不出来的那一份画成「就是空的」。
 *  ② **六态逐格计数**：认不出的另立一格，**不当还没发生**（源把认不出的
 *     状态当还没发生落下去）。
 *  ③ **缺栏位画格子不画 0**：「没这个栏位」与「这个栏位就是 0」不同形。
 *  ④ **迁移逐版画**：哪一步不用做 / 哪一步要做 / 哪一个动不了，逐格列 ——
 *     源一跳就是错。
 *  ⑤ **流水线逐格画**：十一步各列各的，认不出的步骤另立一格，
 *     **不硬塞进某一格**。
 *  ⑥ **矛盾要单独标**：状态为空却带着条数 —— 两个读数互相不成立，
 *     界面上一眼看得出（源在这里直接抛）。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号、双引号与单引号一律走**拼装形**。
 * ======================================================== */
'use strict';
import { DD_TEXT_MAX, DD_LEDGER_MAX, DD_ROWS_MAX, DD_ROLES_MAX, DD_DEPTH_MAX, DD_STATUS_TEXT, DD_DELTA_TEXT } from './diagdesk-data.js';
import { writeLanded } from '../../config/write-receipt.js';
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const DASH = '--';
const TABS = [
    { key: 'overview', label: '总判定' },
    { key: 'fields', label: '栏位体检' },
    { key: 'pipeline', label: '流水线' },
    { key: 'ledger', label: '台账' }
];
const FACE_TONE = Object.freeze({
    ok: 'ok',
    empty: 'warn',
    malformed: 'err',
    absent: 'off'
});
/** 视图层：四页签（总判定 / 栏位体检 / 流水线 / 台账）。 */
export class DiagdeskView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._archiveInput = '';
        this._extraInput = '';
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'dd-root ' + this._tone(this.app.faceTone());
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.className = 'dd-root ' + this._tone(this.app.faceTone());
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split(LT).join(AMP + 'lt;')
            .split(GT).join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(SQ).join(AMP + '#39;');
    }
    _tone(t) { return t ? ('dd-tone-' + this._esc(t)) : 'dd-tone-none'; }
    _meter(v) { return (v === null || v === undefined) ? DASH : String(v); }
    _box(title, note, inner) {
        const parts = ['<div class="dd-sec">'];
        if (title) parts.push('<div class="dd-sec-title">' + this._esc(title) + '</div>');
        if (note) parts.push('<div class="dd-sec-note">' + this._esc(note) + '</div>');
        parts.push(inner || '');
        parts.push('</div>');
        return parts.join('');
    }
    _metricBlock(rows) {
        const parts = ['<div class="dd-metrics">'];
        for (let i = 0; i < rows.length; i++) {
            parts.push('<div class="dd-metric"><span class="dd-metric-k">' + this._esc(rows[i].k)
                + '</span><span class="dd-metric-v">' + this._esc(rows[i].v) + '</span></div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    _note(text, tone) {
        return '<div class="dd-note dd-note-' + this._esc(tone || 'ok') + '">' + this._esc(text) + '</div>';
    }
    _empty(text) {
        return '<div class="dd-empty">' + this._esc(text) + '</div>';
    }
    _tag(text, tone) {
        return '<span class="dd-tag dd-tag-' + this._esc(tone || 'ok') + '">' + this._esc(text) + '</span>';
    }
    /* ---------- 整页 ---------- */
    _buildHTML() {
        const parts = [];
        parts.push('<div class="dd-head">');
        parts.push('<div class="dd-title">诊断案头</div>');
        parts.push('<div class="dd-sub">' + this._esc(this.app.faceText()) + '</div>');
        const why = this.app.whyText();
        if (why) parts.push('<div class="dd-why">' + this._esc(why) + '</div>');
        parts.push('</div>');
        parts.push(this._tabsBlock());
        const tab = this.app.tab();
        if (tab === 'overview') parts.push(this._overviewPanel());
        else if (tab === 'fields') parts.push(this._fieldsPanel());
        else if (tab === 'pipeline') parts.push(this._pipelinePanel());
        else parts.push(this._ledgerPanel());
        if (this._flash) parts.push('<div class="dd-flash">' + this._esc(this._flash) + '</div>');
        return parts.join('');
    }
    _tabsBlock() {
        const cur = this.app.tab();
        const parts = ['<div class="dd-tabs">'];
        for (let i = 0; i < TABS.length; i++) {
            const t = TABS[i];
            parts.push('<button class="dd-tab' + (t.key === cur ? ' on' : '') + '" data-act="tab" data-key="'
                + this._esc(t.key) + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 总判定页签 ---------- */
    _overviewPanel() {
        const app = this.app;
        const parts = [];
        let inner = '';
        inner += '<div class="dd-field">';
        inner += '<label class="dd-field-label">存档原文（贴一张对象，含结构版本 / 角色表 / 增量 / 回执）</label>';
        inner += '<textarea class="dd-area" data-in="archive" placeholder="'
            + this._esc('例：{ "version": 1, "角色表": { "阿岚": { … } }, "delta": { "status": "ready", "events": [] }, "pipeline": [] }')
            + '">' + this._esc(this._archiveInput) + '</textarea>';
        inner += '</div>';
        inner += '<div class="dd-btns">';
        inner += '<button class="dd-btn dd-btn-main" data-act="ingest_archive">收下这份存档并体检</button>';
        inner += '<button class="dd-btn dd-btn-quiet" data-act="clear_archive_input">清空输入</button>';
        inner += '<button class="dd-btn dd-btn-quiet" data-act="clear_archive">放下一份存档</button>';
        inner += '</div>';
        parts.push(this._box('贴回一份存档',
            '只读成一张体检单 —— **不挂错误对象、不改存档、不写宿主任何字段**（附随的钥名一律按原文报）', inner));
        const sum = app.summaryOf();
        parts.push(this._box('总体判定（取不出来画横线，不画 0）', '', this._metricBlock([
            { k: '判定', v: app.verdictText() },
            { k: '结构版本', v: sum ? this._meter(sum.version.value) : DASH },
            { k: '增量状态', v: sum ? this._meter(sum.delta.statusLabel) : DASH },
            { k: '增量条数', v: (sum && sum.delta.countKnown) ? String(sum.delta.count) : DASH },
            { k: '缺栏位', v: sum ? String(sum.fields.missing) : DASH },
            { k: '收下时刻', v: app.archiveStamp() }
        ])));
        parts.push(this._problemsBlock());
        parts.push(this._statusBlock());
        parts.push(this._deltaBlock());
        parts.push(this._textBlock());
        parts.push(this._sourceBlock());
        return parts.join('');
    }
    _problemsBlock() {
        const rows = this.app.problemsOf();
        let inner = '';
        if (!rows.length) inner = this._empty('没有要处置的。');
        else {
            inner += '<div class="dd-list">';
            for (let i = 0; i < rows.length; i++) {
                inner += '<div class="dd-list-row"><span class="dd-list-v">' + this._esc(rows[i]) + '</span></div>';
            }
            inner += '</div>';
        }
        return this._box('要处置的（逐条列，不合成一句「有点问题」）', '', inner);
    }
    _statusBlock() {
        const s = this.app.statusFaceOf();
        const cells = this.app.statusCells();
        let inner = '';
        if (!s) inner = this._empty('还没有可以清点的存档。');
        else {
            inner += this._metricBlock([
                { k: '总条数', v: String(s.total) },
                { k: '认不出的', v: String(s.unrecognized) },
                { k: '没写状态的', v: String(s.blank) }
            ]);
            inner += '<div class="dd-table">';
            for (let i = 0; i < cells.length; i += 1) {
                const c = cells[i];
                let n = 0;
                for (let j = 0; j < s.cells.length; j += 1) if (s.cells[j].key === c.key) n = s.cells[j].count;
                inner += '<div class="dd-tr">';
                inner += '<span class="dd-td-name">' + this._esc(c.label) + '</span>';
                inner += '<span class="dd-td-num' + (c.key === 'unknown' && n > 0 ? ' warn' : '') + '">' + this._esc(String(n)) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
            inner += this._note('认不出来的状态并入「说不清」，**不当还没发生**。', 'ok');
        }
        return this._box('状态六态逐格', '源把认不出的状态当还没发生落下去 —— 本件另立一格', inner);
    }
    _deltaBlock() {
        const d = this.app.deltaFaceOf();
        let inner = '';
        if (!d) inner = this._empty('没有增量这一栏。');
        else {
            inner += this._metricBlock([
                { k: '状态', v: d.statusLabel },
                { k: '条数', v: d.countKnown ? String(d.count) : DASH },
                { k: '互相成立', v: d.conflict ? '不成立' : '成立' }
            ]);
            inner += d.conflict
                ? this._note(d.why, 'err')
                : this._note(d.why, 'ok');
        }
        return this._box('增量面（状态与条数要互相成立）', '', inner);
    }
    _textBlock() {
        const app = this.app;
        let inner = '';
        inner += '<div class="dd-field">';
        inner += '<label class="dd-field-label">追加要求（可空）</label>';
        inner += '<textarea class="dd-area dd-area-sm" data-in="extra" placeholder="'
            + this._esc('例：把「要处置的」逐条列成清单，别合成一句') + '">' + this._esc(this._extraInput) + '</textarea>';
        inner += '</div>';
        inner += '<div class="dd-btns">';
        inner += '<button class="dd-btn dd-btn-main" data-act="make_text">出一份体检单文本</button>';
        inner += '<button class="dd-btn dd-btn-quiet" data-act="save_draft">存草稿</button>';
        inner += '</div>';
        return this._box('摘要文本（本件唯一的产物）', '只产文本，**不动存档、不改宿主**', inner);
    }
    _sourceBlock() {
        const files = this.app.sourceFiles();
        let inner = '';
        inner += this._note(this.app.sourceNote(), 'ok');
        inner += '<div class="dd-list">';
        for (let i = 0; i < files.length; i += 1) {
            const f = files[i];
            inner += '<div class="dd-list-row"><span class="dd-list-k">' + this._esc(f.file) + '</span>'
                + '<span class="dd-list-v">' + this._esc(f.role) + '</span></div>';
        }
        inner += '</div>';
        return this._box('源清单（三片同族）', '', inner);
    }
    /* ---------- 栏位体检页签 ---------- */
    _fieldsPanel() {
        const app = this.app;
        const f = app.fieldFaceOf();
        const plan = app.planFaceOf();
        const parts = [];
        let inner = '';
        if (!f) inner = this._empty('还没有可以体检的存档 —— 先贴回一份。');
        else {
            inner += this._metricBlock([
                { k: '按第几版体检', v: this._meter(f.version) },
                { k: '缺栏位', v: String(f.missing) },
                { k: '类型认不出', v: String(f.unknownTypes) }
            ]);
            inner += '<div class="dd-table">';
            inner += '<div class="dd-tr dd-th"><span class="dd-td-name">栏位</span><span class="dd-td-place">状态</span><span class="dd-td-num">从哪版起</span></div>';
            for (let i = 0; i < f.rows.length; i += 1) {
                const r = f.rows[i];
                let stateText;
                let tone;
                if (r.state === 'present') { stateText = '在场（' + r.shapeText + '）'; tone = 'ok'; }
                else if (r.state === 'missing') { stateText = '缺栏位（不许读成 ' + r.fill + '）'; tone = 'err'; }
                else { stateText = '这一版还没有这一栏（对）'; tone = 'off'; }
                if (r.typeKnown === false) { tone = 'warn'; stateText += '（声明的类型不在类型册）'; }
                inner += '<div class="dd-tr' + (tone === 'err' ? ' dd-bad' : '') + '">';
                inner += '<span class="dd-td-name">' + this._esc(r.label) + '</span>';
                inner += '<span class="dd-td-place">' + this._esc(stateText) + '</span>';
                inner += '<span class="dd-td-num">' + this._esc(String(r.since)) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
            inner += this._note('缺栏位与真值 0 不同形 —— 本件逐格列出，不替它补。', 'ok');
        }
        parts.push(this._box('栏位体检（缺栏位逐格列，不塌成 0）', '', inner));
        parts.push(this._planBlock(plan));
        return parts.join('');
    }
    _planBlock(plan) {
        let inner = '';
        if (!plan) inner = this._empty('没有可排的迁移计划。');
        else if (plan.halted) inner = this._note(plan.why, 'err');
        else {
            inner += this._metricBlock([
                { k: '当前版本', v: this._meter(plan.version) },
                { k: '步骤数', v: String(plan.steps.length) }
            ]);
            for (let i = 0; i < plan.steps.length; i += 1) {
                const st = plan.steps[i];
                inner += '<div class="dd-step">';
                inner += '<div class="dd-step-head">' + this._esc('第 ' + String(st.from) + ' 版到第 ' + String(st.to) + ' 版')
                    + this._tag(st.needed ? '要做' : '不用做', st.needed ? 'warn' : 'off') + '</div>';
                inner += '<div class="dd-step-note">' + this._esc(st.note) + '</div>';
                for (let j = 0; j < st.actions.length; j += 1) {
                    const a = st.actions[j];
                    let tone = 'ok';
                    if (a.action === 'cant') tone = 'err';
                    else if (a.action === 'fill' || a.action === 'now') tone = 'warn';
                    inner += '<div class="dd-list-row">';
                    inner += '<span class="dd-list-k">' + this._esc(a.label) + '</span>';
                    inner += '<span class="dd-list-v">' + this._esc(this.app.actionTextOf(a.action) + '：' + a.why) + '</span>';
                    inner += '</div>';
                }
                inner += '</div>';
            }
            inner += this._note('逐版排开，一跳就是错；自订过的值一律列成「不动」。', 'ok');
        }
        return this._box('迁移计划（逐版列，断链即停）', '', inner);
    }
    /* ---------- 流水线页签 ---------- */
    _pipelinePanel() {
        const app = this.app;
        const p = app.pipelineFaceOf();
        const parts = [];
        let inner = '';
        if (!p) inner = this._empty('还没有回执可以清点 —— 先贴回一份存档。');
        else {
            inner += this._metricBlock([
                { k: '回执条数', v: String(p.total) },
                { k: '认不出的步骤', v: String(p.unnamed) }
            ]);
            inner += '<div class="dd-table">';
            inner += '<div class="dd-tr dd-th"><span class="dd-td-name">步骤</span><span class="dd-td-place">回执</span><span class="dd-td-num">序</span></div>';
            for (let i = 0; i < p.cells.length; i += 1) {
                const c = p.cells[i];
                inner += '<div class="dd-tr' + (c.failed > 0 ? ' dd-bad' : '') + '">';
                inner += '<span class="dd-td-name">' + this._esc(c.label) + '</span>';
                inner += '<span class="dd-td-place">' + this._esc(c.text) + '</span>';
                inner += '<span class="dd-td-num">' + this._esc(String(c.order)) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
            inner += this._note('十一步各列各的；认不出的步骤另立一格，**不硬塞进某一格**。', 'ok');
            inner += this._pipelineDetail(p);
        }
        parts.push(this._box('流水线逐格（十一步，一步不省）', '', inner));
        return parts.join('');
    }
    _pipelineDetail(p) {
        const rows = p.shown.rows;
        let inner = '<div class="dd-sub-title">逐条回执（最多列 ' + String(DD_ROWS_MAX) + ' 条，超出的报数不截内容）</div>';
        if (p.shown.over) inner += this._note('回执超出上限，已挤掉 ' + String(p.shown.dropped) + ' 条（只报）', 'warn');
        if (!rows.length) inner += this._empty('没有回执。');
        else {
            inner += '<div class="dd-list">';
            for (let i = 0; i < rows.length; i += 1) {
                const r = rows[i];
                let line = r.known ? r.stepLabel : r.stepLabel;
                if (r.name) line += ' / 名：' + r.name;
                if (r.code !== null && typeof r.code !== 'undefined') line += ' / 码：' + String(r.code);
                if (r.detail) line += ' / 细：' + r.detail;
                if (r.location) line += ' / 位：' + r.location;
                inner += '<div class="dd-list-row' + (r.failed ? ' dd-list-bad' : '') + '"><span class="dd-list-k">'
                    + this._esc(r.known ? String(r.order) : '?') + '</span><span class="dd-list-v">' + this._esc(line) + '</span></div>';
            }
            inner += '</div>';
        }
        return inner;
    }
    /* ---------- 台账页签 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.ledgerRows();
        const dropped = app.droppedCount();
        let inner = '';
        inner += this._metricBlock([
            { k: '当前条数', v: String(rows.length) },
            { k: '已挤掉', v: String(dropped) },
            { k: '上限', v: String(DD_LEDGER_MAX) }
        ]);
        if (!rows.length) inner += this._empty('还没有动作。');
        else {
            inner += '<div class="dd-table">';
            inner += '<div class="dd-tr dd-th"><span class="dd-td-name">动作</span><span class="dd-td-place">结果</span><span class="dd-td-num">量</span></div>';
            for (let i = 0; i < rows.length; i += 1) {
                const r = rows[i];
                const res = r.ok ? '成' : ('不成' + (r.why ? ('（' + app.intakeWhyText(r.why) + '）') : ''));
                inner += '<div class="dd-tr">';
                inner += '<span class="dd-td-name">' + this._esc(r.action) + '</span>';
                inner += '<span class="dd-td-place">' + this._esc(res) + '</span>';
                inner += '<span class="dd-td-num">' + this._esc(String(r.n)) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
        }
        inner += '<div class="dd-btns">';
        inner += '<button class="dd-btn dd-btn-quiet" data-act="clear_ledger">清台账（不动存档与草稿）</button>';
        inner += '</div>';
        inner += this._note('台账挤掉旧记录会报数，不静默；清台账只清本件自己那条键。', 'ok');
        const parts = [];
        parts.push(this._box('动作台账（上限 ' + String(DD_LEDGER_MAX) + ' 条）', '', inner));
        parts.push(this._box('原文规模（只报，不截）', '', this._metricBlock([
            { k: '存档原文', v: String(app.rawLen()) + ' 字符' },
            { k: '上限', v: String(DD_TEXT_MAX) + ' 字符' }
            , { k: '栏位上限', v: String(DD_ROLES_MAX) + ' 个' }
            , { k: '嵌套上限', v: String(DD_DEPTH_MAX) + ' 层' }
        ])));
        return parts.join('');
    }
    /* ---------- 事件 ---------- */
    _bindEvents() {
        const root = this._root;
        if (!root) return;
        const self = this;
        const acts = root.querySelectorAll('[data-act]');
        for (let i = 0; i < acts.length; i++) {
            const el = acts[i];
            el.addEventListener('click', function (ev) {
                const act = el.getAttribute('data-act');
                if (act === 'tab') self._onTab(el, ev);
                else self._onAction(act, el, ev);
            });
        }
        const areas = root.querySelectorAll('[data-in]');
        for (let i = 0; i < areas.length; i++) {
            const el = areas[i];
            el.addEventListener('input', function () {
                self._onInput(el.getAttribute('data-in'), el.value);
            });
        }
    }
    _onInput(kind, value) {
        const v = (typeof value === 'string') ? value : '';
        if (kind === 'archive') this._archiveInput = v;
        else if (kind === 'extra') this._extraInput = v;
        this.app.setInput(v);
    }
    _onTab(el, ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        const app = this.app;
        app.setTab(el.getAttribute('data-key'));
        app.render();
    }
    _onAction(act, el, ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        const app = this.app;
        const a = (typeof act === 'string') ? act : '';
        if (a === 'ingest_archive') {
            const r = app.ingestArchive(this._archiveInput);
            this._flash = writeLanded(r) ? '' : ('没收下（' + (r.why ? app.intakeWhyText(r.why) : '没落下去') + '）');
            if (r.ok) { app.setTab('overview'); this._archiveInput = ''; }
        } else if (a === 'clear_archive_input') {
            this._archiveInput = '';
            this._flash = '';
        } else if (a === 'clear_archive') {
            app.clearArchive();
            this._archiveInput = '';
            this._flash = '已放下 —— 只动本件的三条键，宿主一个字段都没碰。';
        } else if (a === 'make_text') {
            const r = app.requestNow(this._extraInput);
            this._flash = writeLanded(r) ? r.text : ('出不了（' + (r.why ? app.intakeWhyText(r.why) : '没落下去') + '）');
        } else if (a === 'save_draft') {
            app.setDraft('', this._extraInput);
            this._flash = '草稿已存。';
        } else if (a === 'clear_ledger') {
            const r = app.clearLedger();
            this._flash = '清掉 ' + String(r.cleared) + ' 条（本件自己的台账，存档没动）。';
        }
        app.render();
    }
}
