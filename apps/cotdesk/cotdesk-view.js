/* ========================================================
 * cotdesk-view.js — [v3.46.0] 思维链案头 · 视图层
 * 照拄 archive / doujin / pvdesk 规格：_buildHTML() 拼串 →
 * innerHTML → _bindEvents()。只在 render / refresh 里读 App 现算值，
 * **不缓存投影**。
 *
 * 七条视图纪律（逐条对着源的静默失效）：
 *  ① **四态逐格分开画**：「还没收过册子」与「收下了但读不懂」与
 *     「没建过对账」不同形 —— 源把读不出来的那一份画成「就是空的」。
 *  ② **落点逐条画全**：系统提示 / 历史前 / 历史内 / 历史后 / 末尾触发器
 *     五格各列各的 —— 源里首部与中段的非系统条目落成同一处，界面上看不出来。
 *  ③ **塌平与认不出分别计数**：两件事不许合成一句「有点问题」。
 *  ④ **深度画横线不画 0**：「取不出来」与「真的 0 层」不同形；
 *     被钳位的另标一句。
 *  ⑤ **接口三态分开画**：册子上写明的 / 按特征词判出的 / 没命中任何特征词。
 *  ⑥ **原生字段逐接口列**：会给哪个字段、认不认 —— 源对认不出的接口
 *     整块丢掉参数，界面上只写一句话。
 *  ⑦ **锁定两个语义都画**：声明锁定 / 实际能不能动，并标首末位有没有占。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号、双引号与单引号一律走**拼装形**
 * （不写实体字面量：落盘传输链会把实体字面量解码成真字符，转义函数静默失效）。
 * ======================================================== */
'use strict';
import { CD_ITEM_MAX, CD_LOG_MAX, CD_TEXT_MAX, CD_CHARS_MAX, CD_EFFORT_TEXT } from './cotdesk-data.js';
import { writeLanded } from '../../config/write-receipt.js';
/** 转义要 replace 的几个字符 —— 用**拼装形**，不写实体字面量。 */
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const DASH = '--';
const TABS = [
    { key: 'items', label: '条目册' },
    { key: 'config', label: '配置与落点' },
    { key: 'sides', label: '五格分布' },
    { key: 'ledger', label: '台账' }
];
/** 四态色调（键面取真源，不写标识符形）。 */
const FACE_TONE = Object.freeze({
    ok: 'ok',
    empty: 'warn',
    malformed: 'err',
    absent: 'off'
});
/** 五格落点的短标（键面取真源）。 */
const SIDE_SHORT = Object.freeze({
    system: '系统提示',
    lead: '历史前',
    history_in: '历史内',
    history_after: '历史后',
    prefill: '末尾触发器',
    unknown: '认不出'
});
/** 视图层：四页签（条目册 / 配置与落点 / 五格分布 / 台账）。 */
export class CotdeskView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._itemsInput = '';
        this._cfgInput = '';
        this._targetInput = '';
        this._extraInput = '';
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'cd-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.className = 'cd-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    _q(sel) { return this._root ? this._root.querySelector(sel) : null; }
    /** 转义（与号与三个引号走拼装形 —— 见文件头纪律）。 */
    _esc(s) {
        return String(s == null ? '' : s)
            .split(AMP).join(AMP + 'amp;')
            .split(LT).join(AMP + 'lt;')
            .split(GT).join(AMP + 'gt;')
            .split(DQUOTE).join(AMP + 'quot;')
            .split(SQ).join(AMP + '#39;');
    }
    _tone(t) { return t ? ('cd-tone-' + this._esc(t)) : 'cd-tone-none'; }
    _nl() { return NL; }
    /* ---------- 通用小块（**完整闭合块**：开与闭在同一处产，不漏闭合） ---------- */
    _box(title, note, inner) {
        const parts = ['<div class="cd-sec">'];
        if (title) parts.push('<div class="cd-sec-title">' + this._esc(title) + '</div>');
        if (note) parts.push('<div class="cd-sec-note">' + this._esc(note) + '</div>');
        parts.push(inner || '');
        parts.push('</div>');
        return parts.join('');
    }
    _metricBlock(rows) {
        const parts = ['<div class="cd-metrics">'];
        for (let i = 0; i < rows.length; i++) {
            parts.push('<div class="cd-metric"><span class="cd-metric-k">' + this._esc(rows[i].k)
                + '</span><span class="cd-metric-v">' + this._esc(rows[i].v) + '</span></div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    _fieldInput(kind, label, value, placeholder) {
        const parts = [];
        parts.push('<div class="cd-field">');
        parts.push('<label class="cd-field-label">' + this._esc(label) + '</label>');
        parts.push('<textarea class="cd-area" data-in="' + this._esc(kind) + '" placeholder="'
            + this._esc(placeholder || '') + '">' + this._esc(value) + '</textarea>');
        parts.push('</div>');
        return parts.join('');
    }
    /** 读数取值：拿不到给横线（**不给 0**）。 */
    _meter(v) {
        return (v === null || v === undefined) ? DASH : String(v);
    }
    _note(text, tone) {
        return '<div class="cd-note cd-note-' + this._esc(tone || 'ok') + '">' + this._esc(text) + '</div>';
    }
    _sub(title) {
        return '<div class="cd-sub-title">' + this._esc(title) + '</div>';
    }
    _empty(text) {
        return '<div class="cd-empty">' + this._esc(text) + '</div>';
    }
    /* ---------- 整页 ---------- */
    _buildHTML() {
        const parts = [];
        parts.push('<div class="cd-head">');
        parts.push('<div class="cd-title">思维链案头</div>');
        parts.push('<div class="cd-sub">' + this._esc(this.app.faceText()) + '</div>');
        const why = this.app.whyText();
        if (why) parts.push('<div class="cd-why">' + this._esc(why) + '</div>');
        parts.push('</div>');
        parts.push(this._tabsBlock());
        const tab = this.app.tab();
        if (tab === 'items') parts.push(this._itemsPanel());
        else if (tab === 'config') parts.push(this._configPanel());
        else if (tab === 'sides') parts.push(this._sidesPanel());
        else parts.push(this._ledgerPanel());
        if (this._flash) parts.push('<div class="cd-flash">' + this._esc(this._flash) + '</div>');
        return parts.join('');
    }
    _tabsBlock() {
        const cur = this.app.tab();
        const parts = ['<div class="cd-tabs">'];
        for (let i = 0; i < TABS.length; i++) {
            const t = TABS[i];
            parts.push('<button class="cd-tab' + (t.key === cur ? ' on' : '') + '" data-act="tab" data-key="'
                + this._esc(t.key) + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 条目册页签 ---------- */
    _itemsPanel() {
        const app = this.app;
        const parts = [];
        let inner = '';
        inner += this._fieldInput('items', '条目册原文（贴回 JSON 数组或带 items 的对象）', this._itemsInput,
            '例：[{ "name": "引子", "position": "head", "role": "system", "content": "…" }, …]');
        inner += '<div class="cd-btns">';
        inner += '<button class="cd-btn cd-btn-main" data-act="ingest_items">收下这份册子并对账</button>';
        inner += '<button class="cd-btn cd-btn-quiet" data-act="clear_items_input">清空输入</button>';
        inner += '<button class="cd-btn cd-btn-quiet" data-act="clear_items">放下一份册子</button>';
        inner += '</div>';
        parts.push(this._box('贴回一份思维链条目册',
            '只认条目 / 落点 / 深度 / 开关与字面数 —— **不注入、不改提示词、不发请求**', inner));
        const sum = app.itemSum();
        parts.push(this._box('条目总账（取不出来的画横线，不画 0）', '', this._metricBlock([
            { k: '条目数', v: (sum && sum.items) ? String(sum.items) : '0' },
            { k: '启用', v: (sum) ? String(sum.on) : DASH },
            { k: '关闭', v: (sum) ? String(sum.off) : DASH },
            { k: '声明锁定', v: (sum) ? String(sum.locked) : DASH },
            { k: '有问题的', v: (sum) ? String(sum.bad) : DASH },
            { k: '落点被塌平', v: (sum) ? String(sum.flattened) : DASH },
            { k: '册子字数', v: (sum) ? String(sum.chars) + (sum.charsOver ? '（超上限）' : '') : DASH }
        ])));
        parts.push(this._itemsBlock());
        parts.push(this._sourceBlock());
        return parts.join('');
    }
    _itemsBlock() {
        const rows = this.app.itemRows();
        const parts = [];
        if (!rows.length) {
            parts.push(this._box('逐条对账', '',
                this._empty('还没有可以对账的册子 —— 先贴回一份（或去看「配置与落点」页签的四格读法）。')));
            return parts.join('');
        }
        let inner = '<div class="cd-table">';
        inner += '<div class="cd-tr cd-th"><span class="cd-td-name">条目</span>'
            + '<span class="cd-td-place">落点</span><span class="cd-td-depth">深度</span>'
            + '<span class="cd-td-sw">开关</span><span class="cd-td-chars">字数</span></div>';
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const short = SIDE_SHORT[r.side] || r.side;
            inner += '<div class="cd-tr' + (r.ok ? '' : ' cd-bad') + (r.locked ? ' cd-locked' : '') + '">';
            inner += '<span class="cd-td-name">' + this._esc(r.name)
                + (r.locked ? '<span class="cd-tag">锁</span>' : '') + '</span>';
            inner += '<span class="cd-td-place">' + this._esc(short)
                + '<span class="cd-mini">' + this._esc(r.position + ' / ' + r.role) + '</span>'
                + (r.flattened ? '<span class="cd-why-mini">落点被塌平到与首部同一处</span>' : '') + '</span>';
            inner += '<span class="cd-td-depth' + (r.depth && r.depth.blank ? ' blank' : '') + '">'
                + this._esc(r.depth ? r.depth.text : DASH)
                + (r.depth && r.depth.clamped ? '<span class="cd-why-mini">被钳位</span>' : '') + '</span>';
            inner += '<span class="cd-td-sw">' + this._esc(r.enabled ? '开' : '关') + '</span>';
            inner += '<span class="cd-td-chars' + (r.over ? ' err' : '') + '">' + this._esc(String(r.chars)) + '</span>';
            if (!r.ok) inner += '<span class="cd-problem">' + this._esc(r.problemText) + '</span>';
            inner += '</div>';
        }
        inner += '</div>';
        parts.push(this._box('逐条对账（上限 ' + String(CD_ITEM_MAX) + ' 条）',
            '「落点认不出来」与「落点被塌平」分别标 —— 两件事不许合成一句「有点问题」', inner));
        parts.push(this._lockBlock());
        parts.push(this._scanBlock());
        return parts.join('');
    }
    _lockBlock() {
        const L = this.app.lockRow();
        const parts = [];
        let inner = '';
        if (!L || !L.total) {
            inner = this._empty('没有可读的条目，锁不锁看不出来。');
            parts.push(this._box('锁定面', '', inner));
            return parts.join('');
        }
        inner += this._metricBlock([
            { k: '条目数', v: String(L.total) },
            { k: '声明锁定', v: String(L.lockedCount) },
            { k: '还能动', v: String(L.movableCount) },
            { k: '首位占住', v: L.firstLocked ? '是' : '不是' },
            { k: '末位占住', v: L.lastLocked ? '是' : '不是' }
        ]);
        inner += '<div class="cd-list">';
        for (let i = 0; i < L.rows.length; i++) {
            const r = L.rows[i];
            inner += '<div class="cd-list-row' + (r.locked ? ' cd-list-locked' : '') + '">';
            inner += '<span class="cd-list-k">' + this._esc(r.name) + '</span>';
            inner += '<span class="cd-list-v">' + this._esc(r.text) + '</span>';
            inner += '</div>';
        }
        inner += '</div>';
        parts.push(this._box('锁定面（数据字段与界面禁令两个语义都画）',
            '源装载时还有一段**静默解锁**：把首末条目的锁定改成未锁 —— 这一面只报当前声明值', inner));
        return parts.join('');
    }
    _scanBlock() {
        const s = this.app.scanRow();
        const parts = [];
        let inner = '';
        if (!s || s.blank) {
            inner = this._empty('册子里没有正文字，标记对不成对看不出来。');
            parts.push(this._box('正文标记体检（只数，不改写、不抠字）', '', inner));
            return parts.join('');
        }
        inner += this._metricBlock([
            { k: '正文字数', v: String(s.chars) },
            { k: '起标记', v: String(s.open) + ' 处' },
            { k: '止标记', v: String(s.close) + ' 处' },
            { k: '成对', v: String(s.paired) + ' 对' },
            { k: '落单', v: String(s.unpaired) + ' 处' }
        ]);
        inner += this._sub('读数');
        inner += this._note(s.text, s.unpaired ? 'warn' : 'ok');
        parts.push(this._box('正文标记体检（只数，不改写、不抠字）',
            '源按起止标记从回复里截出思考段**并从正文里删掉** —— 本件只数标记对，一个字都不动', inner));
        return parts.join('');
    }
    _sourceBlock() {
        const rows = this.app.sourceRows();
        let inner = '<div class="cd-list">';
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            inner += '<div class="cd-list-row"><span class="cd-list-k">' + this._esc(r.file) + '</span>'
                + '<span class="cd-list-v">' + this._esc(r.role) + '　' + this._esc(r.bytesText)
                + ' / ' + this._esc(r.linesText) + '</span></div>';
        }
        inner += '</div>';
        return this._box('这一件缝的是哪两片（同族两片一并取治理面）', this.app.sourceNote(), inner);
    }
    /* ---------- 配置与落点页签 ---------- */
    _configPanel() {
        const app = this.app;
        const parts = [];
        let inner = '';
        inner += this._fieldInput('cfg', '册子上的配置（贴回 JSON 对象）', this._cfgInput,
            '例：{ "enabled": true, "mode": "card", "provider": "auto", "prefillStrategy": "auto", "nativeEffort": "auto" }');
        inner += '<div class="cd-btns">';
        inner += '<button class="cd-btn cd-btn-main" data-act="ingest_cfg">收下这份配置并判读</button>';
        inner += '<button class="cd-btn cd-btn-quiet" data-act="clear_cfg_input">清空输入</button>';
        inner += '<button class="cd-btn cd-btn-quiet" data-act="clear_cfg">放下这份配置</button>';
        inner += '</div>';
        parts.push(this._box('贴回册子上的配置',
            '四格（模式 / 接口 / 原生强度 / 末尾预填）原样收下 —— **不替它补默认值**', inner));
        const cf = app.configRow();
        if (!cf || !cf.given) {
            parts.push(this._box('配置面', '', this._empty('还没收过配置片 —— 模式 / 接口 / 预填 / 原生强度都读不出来。')));
        } else {
            parts.push(this._box('配置面（原样，不补默认值）', (cf.scopes || '范围没写，按两个范围都生效算'), this._metricBlock([
                { k: '总开关', v: cf.enabledGiven ? (cf.enabled ? '开' : '关') : '没这个字段（本件按关算，源按开算）' },
                { k: '模式', v: app.modeText() },
                { k: '接口声明', v: cf.provider.length ? cf.provider : '自动/没写' },
                { k: '原生强度声明', v: cf.nativeEffort.length ? cf.nativeEffort : '自动/没写' },
                { k: '末尾预填声明', v: cf.prefill.length ? cf.prefill : '没写' }
            ])));
        }
        parts.push(this._providerBlock());
        parts.push(this._prefillBlock());
        parts.push(this._nativeBlock());
        parts.push(this._textBlock());
        return parts.join('');
    }
    _providerBlock() {
        const p = this.app.providerRow();
        const parts = [];
        if (!p) { parts.push(this._box('接口判读', '', this._empty('没有可判的配置。'))); return parts.join(''); }
        let inner = this._metricBlock([
            { k: '判到哪个接口', v: p.provider },
            { k: '凭据', v: (p.source === 'declared' ? '册子上写明的' : (p.source === 'hinted' ? ('按特征词 ' + p.hit) : (p.source === 'bad_declared' ? '册子上写的值不在六个已知值里' : '没命中任何特征词'))) },
            { k: '算得准吗', v: p.certain ? '有据可依' : '只是按兼容接口算' }
        ]);
        inner += this._sub('读法');
        inner += this._note(p.text, p.certain ? 'ok' : 'warn');
        parts.push(this._box('接口判读（写明的 / 猜出的 / 判不出的 三态分开）',
            '源按模型名与地址猜接口，猜不出就按兼容接口走 —— 本件把三态分开报', inner));
        return parts.join('');
    }
    _prefillBlock() {
        const p = this.app.prefillRow();
        const parts = [];
        if (!p) { parts.push(this._box('末尾预填', '', this._empty('没有可判的配置。'))); return parts.join(''); }
        let inner = this._metricBlock([
            { k: '声明值', v: p.declared },
            { k: '认不认', v: p.declaredOk ? '在五个已知值里' : '不在已知值里（本件按自动算）' },
            { k: '实际取值', v: p.value },
            { k: '并进系统提示吗', v: p.joinsSystem ? '是' : '不是' },
            { k: '这一项生效吗', v: p.applies ? '生效' : '不生效（当前模式不用条目册）' }
        ]);
        if (p.why) inner += this._note(p.why, 'warn');
        parts.push(this._box('末尾预填（声明是自动就报「谁来决定」，不替它猜）', '', inner));
        return parts.join('');
    }
    _nativeBlock() {
        const n = this.app.nativeRow();
        const parts = [];
        if (!n) { parts.push(this._box('原生思考', '', this._empty('没有可判的配置。'))); return parts.join(''); }
        let inner = this._metricBlock([
            { k: '接口', v: n.provider },
            { k: '会给的字段', v: n.supported ? n.field : '（一个都不给）' },
            { k: '字段用途', v: n.supported ? n.note : DASH },
            { k: '意图', v: n.wants },
            { k: '强度档位', v: (n.effort && CD_EFFORT_TEXT[n.effort]) ? CD_EFFORT_TEXT[n.effort] : DASH }
        ]);
        inner += this._sub('读法');
        inner += this._note(n.text, n.silent ? 'err' : 'ok');
        if (n.silent) {
            inner += this._sub('四个已知字段');
            inner += '<div class="cd-list">';
            inner += '<div class="cd-list-row"><span class="cd-list-k">openai</span><span class="cd-list-v">reasoning_effort（推理强度）</span></div>';
            inner += '<div class="cd-list-row"><span class="cd-list-k">deepseek</span><span class="cd-list-v">thinking.type（开关型）</span></div>';
            inner += '<div class="cd-list-row"><span class="cd-list-k">gemini</span><span class="cd-list-v">thinkingConfig（级别或预算）</span></div>';
            inner += '<div class="cd-list-row"><span class="cd-list-k">claude</span><span class="cd-list-v">thinking.type（关闭型）</span></div>';
            inner += '</div>';
        }
        parts.push(this._box('原生思考字段（逐接口列，认不出的**不许静默丢**）',
            '源对认不出的接口把思考参数整块丢掉，界面上只写一句话', inner));
        return parts.join('');
    }
    _textBlock() {
        const app = this.app;
        const drafts = app.drafts();
        let inner = '';
        inner += this._fieldInput('target', '目标（可空）', this._targetInput, '例：把这套条目配到当前会话');
        inner += this._fieldInput('extra', '追加要求（可空）', this._extraInput, '例：先把落点被塌平的条目列出来再配');
        inner += '<div class="cd-btns">';
        inner += '<button class="cd-btn cd-btn-quiet" data-act="save_draft">存草稿</button>';
        inner += '<button class="cd-btn cd-btn-main" data-act="make_text">出要求文本</button>';
        inner += '</div>';
        inner += this._sub('当前草稿');
        inner += this._note('目标 ' + String(drafts.target.length) + ' 字符，追加要求 ' + String(drafts.extra.length) + ' 字符。', 'ok');
        parts.push(this._box('要求文本（本件唯一的产出物）',
            '只产描述，一个字段都不写 —— **裁定不等于注入**', inner));
        return parts.join('');
    }
    /* ---------- 五格分布页签 ---------- */
    _sidesPanel() {
        const app = this.app;
        const rows = app.sideRows();
        const sum = app.itemSum();
        let inner = '';
        inner += this._metricBlock([
            { k: '条目数', v: (sum) ? String(sum.items) : '0' },
            { k: '落点被塌平', v: (sum) ? String(sum.flattened) : DASH },
            { k: '落点认不出', v: (sum && sum.sides) ? String(sum.sides.unknown) : DASH },
            { k: '册子字数', v: (sum) ? String(sum.chars) : DASH },
            { k: '字数上限', v: String(CD_CHARS_MAX) }
        ]);
        inner += '<div class="cd-table">';
        inner += '<div class="cd-tr cd-th"><span class="cd-td-name">落点</span>'
            + '<span class="cd-td-place">走到哪</span><span class="cd-td-chars">条数</span></div>';
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            inner += '<div class="cd-tr">';
            inner += '<span class="cd-td-name">' + this._esc(r.label) + '</span>';
            inner += '<span class="cd-td-place">' + this._esc(r.where === 'system' ? '系统提示' : (r.where === 'messages' ? '消息数组' : (r.where === 'tail' ? '末尾触发器' : '没有落点'))) + '</span>';
            inner += '<span class="cd-td-chars">' + this._esc(String(r.n)) + '</span>';
            inner += '</div>';
        }
        inner += '</div>';
        const parts = [];
        parts.push(this._box('五格分布（逐格列，不许合成一句「有点问题」）',
            '源里首部与中段的非系统条目落成同一处 —— 本件把被塌平的那几条单独计数', inner));
        parts.push(this._gaugeBlock());
        return parts.join('');
    }
    _gaugeBlock() {
        const rows = this.app.gaugeRows();
        let inner = '<div class="cd-gauge">';
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            inner += '<div class="cd-gauge-row">';
            inner += '<span class="cd-gauge-label">' + this._esc(r.label) + '</span>';
            inner += '<span class="cd-gauge-track">';
            /* ★ 取不出来**不着色**：画横线且条子留空（与「真的用到 0」不同形）。 */
            if (!r.blank) {
                inner += '<span class="cd-gauge-fill' + (r.tone === 'err' ? ' err' : (r.tone === 'warn' ? ' warn' : ''))
                    + '" style="width:' + String(r.pct) + '%"></span>';
            }
            inner += '</span>';
            inner += '<span class="cd-gauge-num' + (r.blank ? ' blank' : '') + '">' + this._esc(r.text) + '</span>';
            inner += '</div>';
        }
        inner += '</div>';
        inner += this._note('取不出来画横线、条子留空 —— 与「真的用到 0」不同形。', 'ok');
        return this._box('三项上限', '', inner);
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
            { k: '上限', v: String(CD_LOG_MAX) }
        ]);
        if (!rows.length) {
            inner += this._empty('还没有动作。');
        } else {
            inner += '<div class="cd-table">';
            inner += '<div class="cd-tr cd-th"><span class="cd-td-name">动作</span>'
                + '<span class="cd-td-place">结果</span><span class="cd-td-chars">量</span></div>';
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                inner += '<div class="cd-tr">';
                inner += '<span class="cd-td-name">' + this._esc(r.action) + '</span>';
                inner += '<span class="cd-td-place">' + this._esc(r.ok ? '成' : ('不成' + (r.why ? ('（' + app.ingestWhyText(r.why) + '）') : ''))) + '</span>';
                inner += '<span class="cd-td-chars">' + this._esc(String(r.n)) + '</span>';
                inner += '</div>';
            }
            inner += '</div>';
        }
        inner += '<div class="cd-btns">';
        inner += '<button class="cd-btn cd-btn-quiet" data-act="clear_ledger">清台账（不动宿主的任何一条）</button>';
        inner += '</div>';
        inner += this._note('台账挤掉旧记录会报数，不静默。', 'ok');
        const parts = [];
        parts.push(this._box('动作台账（上限 ' + String(CD_LOG_MAX) + ' 条）', '', inner));
        parts.push(this._box('原文规模（只报，不截）', '', this._metricBlock([
            { k: '册子原文', v: String(app.rawLen()) + ' 字符' },
            { k: '配置原文', v: String(app.cfgLen()) + ' 字符' },
            { k: '上限', v: String(CD_TEXT_MAX) + ' 字符' }
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
        if (kind === 'items') this._itemsInput = v;
        else if (kind === 'cfg') this._cfgInput = v;
        else if (kind === 'target') this._targetInput = v;
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
        if (a === 'ingest_items') {
            const r = app.ingestItems(this._itemsInput);
            this._flash = writeLanded(r) ? '' : ('没收下（' + (r.why ? app.ingestWhyText(r.why) : '没落下去') + '）');
            if (r.ok) { app.setTab('items'); this._itemsInput = ''; }
        } else if (a === 'clear_items_input') {
            this._itemsInput = '';
            this._flash = '';
        } else if (a === 'clear_items') {
            app.clearItems();
            this._itemsInput = '';
            this._flash = '已放下 —— 只动本件的四条键，宿主一个字段都没碰。';
        } else if (a === 'ingest_cfg') {
            const r = app.ingestConfig(this._cfgInput);
            this._flash = writeLanded(r) ? '配置已收下。' : ('没收下（' + (r.why ? r.why : '没落下去') + '）');
            if (r.ok) this._cfgInput = '';
        } else if (a === 'clear_cfg_input') {
            this._cfgInput = '';
            this._flash = '';
        } else if (a === 'clear_cfg') {
            app.clearConfig();
            this._cfgInput = '';
            this._flash = '已放下配置 —— 宿主一个字段都没碰。';
        } else if (a === 'save_draft') {
            app.setTarget(this._targetInput);
            app.setExtra(this._extraInput);
            this._flash = '草稿已存。';
        } else if (a === 'make_text') {
            const r = app.makeText();
            this._flash = writeLanded(r) ? r.text : ('出不了（' + (r.why ? app.ingestWhyText(r.why) : '没落下去') + '）');
        } else if (a === 'clear_ledger') {
            const r = app.clearLedger();
            this._flash = '清掉 ' + String(r.cleared) + ' 条（本件自己的台账）。';
        }
        app.render();
    }
}