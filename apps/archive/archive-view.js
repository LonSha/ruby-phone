/* ========================================================
 * archive-view.js — [v3.45.0] 存档台 · 视图层
 * 照拄 pvdesk / musicdesk / doujin 规格：_buildHTML() 拼串 →
 * innerHTML → _bindEvents()。只在 render / refresh 里读 App 现算值，
 * **不缓存投影**。
 *
 * 七条视图纪律（逐条对着源的静默失效）：
 *  ① **四态逐格分开画**：「还没收过包」与「收下了但读不懂」与
 *     「没建过对账」不同形 —— 源把读不出来的那一份画成「就是空的」。
 *  ② **包型与因分开画**：认不出就写「认不出（因为什么）」——
 *     源在这里**按全量处理并直接覆盖**，界面上一个字不说。
 *  ③ **覆盖性两态分开画**：补充式（同 id 覆盖）/ 覆盖式（先清空）
 *     各有一块，并把**会被清空的表逐张列出来** —— 源同一屏两个按钮，
 *     一个补一个清，外观一样。
 *  ④ **版本两套语义分开画**：声明值 / 属于哪一套 / 是否可互认 ——
 *     源只做数值比较，拿流式包走 330 导入必抛「版本不匹配」。
 *  ⑤ **逐表条数画横线不画 0**：「取不出来」与「真的 0 条」不同形。
 *  ⑥ **未认表逐张列**：包里带了、两套清单里都没有的，源一个字不说。
 *  ⑦ **重置影响逐键列**：源式全量重置会清掉哪些，一张一张列出来，
 *     并标出来源清单归属（流式 / 330 / 单对象 / 不在清单里）。
 *
 * 本文件与数据层同守的纪律：不写正则字面量（本仓剥注释器是字符状态机，
 * 正则里的裸引号会让它卡住）；与号、双引号与单引号一律走**拼装形**
 * （不写实体字面量：落盘传输链会把实体字面量解码成真字符，转义函数静默失效）。
 * ======================================================== */
'use strict';
import { AR_TEXT_MAX, AR_LOG_MAX, AR_TABLE_MAX, AR_BUNDLE_MAX, AR_TABLE_SHAPES } from './archive-data.js';
/** 转义要 replace 的几个字符 —— 用**拼装形**，不写实体字面量。 */
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQUOTE = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const DASH = '--';
const TABS = [
    { key: 'pack', label: '包' },
    { key: 'face', label: '对账' },
    { key: 'reset', label: '重置影响' },
    { key: 'ledger', label: '台账' }
];
/** 四态色调（**键面取真源**，不写标识符形 —— 本仓 J7 形态）。 */
const FACE_TONE = Object.freeze({
    ok: 'ok',
    empty: 'warn',
    malformed: 'err',
    absent: 'off'
});
/** 六种格子形态的文案（**逐项各自写出自己的**）。 */
const SHAPE_TEXT = Object.freeze({
    missing: '包里没这一张',
    array: '数组',
    object: '对象',
    null: '空（null）',
    scalar: '不是表',
    absent: '没有装内容的格子'
});
/** 视图层：四页签（包 / 对账 / 重置影响 / 台账）。 */
export class ArchiveView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._flash = '';
        this._packInput = '';
        this._targetInput = '';
        this._modeInput = '';
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'arc-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.className = 'arc-root ' + this._tone(this.app.faceOf());
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
    _tone(t) { return t ? ('arc-tone-' + this._esc(t)) : 'arc-tone-none'; }
    _nl() { return NL; }
    /* ---------- 通用小块 ---------- */
    _sec(title, note) {
        const parts = [];
        parts.push('<div class="arc-sec">');
        parts.push('<div class="arc-sec-title">' + this._esc(title) + '</div>');
        if (note) parts.push('<div class="arc-sec-note">' + this._esc(note) + '</div>');
        return parts.join('');
    }
    _metricBlock(rows) {
        const parts = ['<div class="arc-metrics">'];
        for (let i = 0; i < rows.length; i++) {
            parts.push('<div class="arc-metric"><span class="arc-metric-k">' + this._esc(rows[i].k)
                + '</span><span class="arc-metric-v">' + this._esc(rows[i].v) + '</span></div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    _fieldInput(kind, label, value, placeholder) {
        const parts = [];
        parts.push('<div class="arc-field">');
        parts.push('<label class="arc-field-label">' + this._esc(label) + '</label>');
        parts.push('<textarea class="arc-area" data-in="' + this._esc(kind) + '" placeholder="'
            + this._esc(placeholder || '') + '">' + this._esc(value) + '</textarea>');
        parts.push('</div>');
        return parts.join('');
    }
    /** 读数取值：拿不到给横线（**不给 0**）。 */
    _meter(v) {
        return (v === null || v === undefined) ? DASH : String(v);
    }
    /** 构建整页（拼串，不用模板字符串）。 */
    _buildHTML() {
        const parts = [];
        parts.push('<div class="arc-head">');
        parts.push('<div class="arc-title">存档台</div>');
        parts.push('<div class="arc-sub">' + this._esc(this.app.faceText()) + '</div>');
        const why = this.app.whyText();
        if (why) parts.push('<div class="arc-why">' + this._esc(why) + '</div>');
        parts.push('</div>');
        parts.push(this._tabsBlock());
        const tab = this.app.tab();
        if (tab === 'pack') parts.push(this._packPanel());
        else if (tab === 'face') parts.push(this._facePanel());
        else if (tab === 'reset') parts.push(this._resetPanel());
        else parts.push(this._ledgerPanel());
        if (this._flash) parts.push('<div class="arc-flash">' + this._esc(this._flash) + '</div>');
        return parts.join('');
    }
    _tabsBlock() {
        const cur = this.app.tab();
        const parts = ['<div class="arc-tabs">'];
        for (let i = 0; i < TABS.length; i++) {
            const t = TABS[i];
            parts.push('<button class="arc-tab' + (t.key === cur ? ' on' : '') + '" data-act="tab" data-key="'
                + this._esc(t.key) + '">' + this._esc(t.label) + '</button>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 包页签 ---------- */
    _packPanel() {
        const app = this.app;
        const parts = [];
        parts.push(this._sec('贴回一份存档包',
            '只认包型 / 版本 / 覆盖面与每张表的条数 —— **不导入、不写入、不下载**'));
        parts.push(this._fieldInput('pack', '包原文（贴回 JSON）', this._packInput,
            '例：{ "version": 3, "type": "EPhoneChunkedBackup", "contains": ["chats"], "data": { … } }'));
        parts.push('<div class="arc-btns">');
        parts.push('<button class="arc-btn arc-btn-main" data-act="ingest">收下这份包并对账</button>');
        parts.push('<button class="arc-btn arc-btn-quiet" data-act="clear_input">清空输入</button>');
        parts.push('<button class="arc-btn arc-btn-quiet" data-act="clear_pack">放下一份包</button>');
        parts.push('</div>');
        parts.push('</div>');
        /* 包型读数 */
        const b = app.bundle();
        const v = app.versionRow();
        const rows = [];
        rows.push({ k: '包型', v: b ? b.label : DASH });
        rows.push({ k: '判型因', v: app.packWhyText() });
        rows.push({ k: '声明版本', v: this._meter(b ? b.version : null) });
        rows.push({ k: '版本哪一套', v: v ? v.text : DASH });
        rows.push({ k: '能否互认', v: v ? (v.crossOk ? '可以' : '不行') : DASH });
        rows.push({ k: '互认说明', v: v ? v.crossWhy : DASH });
        parts.push(this._sec('包型与版本（两套语义分开写）'));
        parts.push(this._metricBlock(rows));
        parts.push('</div>');
        /* 覆盖性 */
        parts.push(this._overwriteBlock());
        /* 体积 */
        parts.push(this._sizeBlock());
        /* 余量 */
        parts.push(this._gaugeBlock());
        /* 来源 */
        parts.push(this._sourceBlock());
        return parts.join('');
    }
    _overwriteBlock() {
        const app = this.app;
        const o = app.overwriteRow();
        const parts = [];
        parts.push(this._sec('拿它做恢复会发生什么（覆盖性）',
            '源在两个按钮上一个补一个清，外观一样 —— 本件逐表说清'));
        parts.push('<div class="arc-note ' + (o && o.clears ? 'arc-note-err' : 'arc-note-ok') + '">'
            + this._esc(app.modeText()) + '</div>');
        const clears = app.clearsTables();
        if (clears.length) {
            parts.push('<div class="arc-sub-title">会被清空的表 ' + String(clears.length) + ' 张</div>');
            parts.push(this._tableChips(clears, 'clear'));
        } else {
            parts.push('<div class="arc-note">这张清单下没有会被清空的表。</div>');
        }
        const unknown = app.unknownTables();
        if (unknown.length) {
            parts.push('<div class="arc-sub-title">两套清单都不认的表 ' + String(unknown.length) + ' 张</div>');
            parts.push(this._tableChips(unknown, 'unknown'));
            parts.push('<div class="arc-sec-note">源在补充式导入里只对「包里的表 交 库里的表」开事务，交集外的表一个字不说。</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    _tableChips(list, kind) {
        const parts = ['<div class="arc-chips">'];
        for (let i = 0; i < list.length; i++) {
            parts.push('<span class="arc-chip arc-chip-' + this._esc(kind) + '">'
                + this._esc(list[i]) + '</span>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    _sizeBlock() {
        const app = this.app;
        const s = app.sizeRow();
        const im = app.imageRow();
        const parts = [];
        parts.push(this._sec('体积估重', '读不出来给横线 —— **不画 0 字节**'));
        parts.push(this._metricBlock([
            { k: '字符数', v: s ? this._meter(s.chars) : DASH },
            { k: 'UTF-8 估重', v: s ? s.bytesText : DASH },
            { k: '内嵌图片数', v: im ? String(im.count) : DASH },
            { k: '图片估重', v: im && !im.blank ? im.bytesText : DASH }
        ]));
        parts.push('<div class="arc-sec-note">源在导出时对全库图片走 canvas 重编码再压 —— 本件不压图，只算一份估重。</div>');
        parts.push('</div>');
        return parts.join('');
    }
    _gaugeBlock() {
        const rows = this.app.gaugeRows();
        const parts = ['<div class="arc-sec">'];
        parts.push('<div class="arc-sec-title">四项上限</div>');
        parts.push('<div class="arc-gauge">');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            parts.push('<div class="arc-gauge-row">');
            parts.push('<span class="arc-gauge-label">' + this._esc(r.label) + '</span>');
            parts.push('<span class="arc-gauge-track">');
            /* ★ 取不出来**不着色**：画横线且条子留空（与「真的用到 0」不同形）。 */
            if (!r.blank) {
                parts.push('<span class="arc-gauge-fill' + (r.tone === 'err' ? ' err' : (r.tone === 'warn' ? ' warn' : ''))
                    + '" style="width:' + String(r.pct) + '%"></span>');
            }
            parts.push('</span>');
            parts.push('<span class="arc-gauge-num' + (r.blank ? ' blank' : '') + '">' + this._esc(r.text) + '</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="arc-sec-note">取不出来画横线、条子留空 —— 与「真的用到 0」不同形。</div>');
        parts.push('</div>');
        return parts.join('');
    }
    _sourceBlock() {
        const rows = this.app.sourceRows();
        const parts = [];
        parts.push(this._sec('这一件缝的是哪五片', '源里的存档一族（不连源、不直读 DOM）'));
        parts.push('<div class="arc-list">');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            parts.push('<div class="arc-list-row"><span class="arc-list-k">' + this._esc(r.file)
                + '</span><span class="arc-list-v">' + this._esc(r.role) + '　' + this._esc(r.bytesText) + '</span></div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 对账页签 ---------- */
    _facePanel() {
        const app = this.app;
        const parts = [];
        const sum = app.tableSum();
        if (!sum || !sum.tables) {
            parts.push('<div class="arc-empty">还没有可以对账的包 —— 先去「包」页签贴回一份。</div>');
            parts.push('</div>');
            return parts.join('');
        }
        parts.push(this._sec('逐表读数',
            '取不出来的条数画横线 —— **不画 0 条**'));
        parts.push(this._metricBlock([
            { k: '涉及表', v: String(sum.tables) },
            { k: '包里带了', v: String(sum.present) },
            { k: '包里没带', v: String(sum.missing) },
            { k: '合计条数', v: this._meter(sum.rowsUnknown ? sum.rows : sum.rows) + (sum.rowsUnknown ? '（有 ' + String(sum.rowsUnknown) + ' 张读不出）' : '') },
            { k: '形态可疑', v: String(sum.suspect) }
        ]));
        parts.push('</div>');
        parts.push(this._tableRowsBlock());
        parts.push(this._auditBlock());
        parts.push(this._diffBlock());
        parts.push(this._textBlock());
        return parts.join('');
    }
    _tableRowsBlock() {
        const rows = this.app.tableRows();
        const parts = [];
        parts.push(this._sec('表 ' + String(rows.length) + ' 张（上限 ' + String(AR_TABLE_MAX) + ' 张）',
            '「包里没这一张」与「包里带了但读不出来」不同形'));
        parts.push('<div class="arc-table">');
        parts.push('<div class="arc-tr arc-th"><span class="arc-td-name">表名</span>'
            + '<span class="arc-td-shape">形态</span><span class="arc-td-rows">条数</span></div>');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const shapeText = SHAPE_TEXT[r.shape] || r.shape;
            parts.push('<div class="arc-tr' + (r.suspect ? ' arc-suspect' : '') + '">');
            parts.push('<span class="arc-td-name">' + this._esc(r.table)
                + (r.single ? '<span class="arc-tag">单对象</span>' : '') + '</span>');
            parts.push('<span class="arc-td-shape">' + this._esc(shapeText)
                + (r.suspectWhy ? '<span class="arc-why-mini">' + this._esc(r.suspectWhy) + '</span>' : '') + '</span>');
            parts.push('<span class="arc-td-rows' + (r.rows === null ? ' blank' : '') + '">'
                + this._esc(this._meter(r.rows)) + '</span>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('</div>');
        return parts.join('');
    }
    _auditBlock() {
        const rows = this.app.auditRows();
        const req = this.app.requiredRows();
        const parts = [];
        parts.push(this._sec('结构体检', '源有一步 repairAllData 逐条补字段 —— 本件只报哪里缺，不补'));
        parts.push('<div class="arc-sub-title">会被体检的字段 ' + String(req.length) + ' 项</div>');
        parts.push('<div class="arc-list">');
        for (let i = 0; i < req.length; i++) {
            const r = req[i];
            parts.push('<div class="arc-list-row"><span class="arc-list-k">' + this._esc(r.path)
                + '</span><span class="arc-list-v">' + this._esc(r.label) + '　缺时：' + this._esc(r.fix)
                + '　范围：' + this._esc(r.scope === 'group' ? '群聊' : (r.scope === 'single' ? '单聊' : '都要')) + '</span></div>');
        }
        parts.push('</div>');
        if (!rows.length) {
            parts.push('<div class="arc-empty">没有读到能体检的记录（包里没带聊天表，或读不出来）。</div>');
        } else {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                parts.push('<div class="arc-audit">');
                parts.push('<div class="arc-audit-name">' + this._esc(r.label) + '</div>');
                for (let k = 0; k < r.misses.length; k++) {
                    const m = r.misses[k];
                    parts.push('<div class="arc-audit-miss">' + this._esc(m.label)
                        + '<span class="arc-dim">（' + this._esc(m.path) + '，缺时：' + this._esc(m.fix) + '）</span></div>');
                }
                parts.push('</div>');
            }
        }
        parts.push('</div>');
        return parts.join('');
    }
    _diffBlock() {
        const d = this.app.listDiffs();
        const parts = [];
        parts.push(this._sec('两套清单的差',
            '源把三张清单写死在好几处 —— 差出来的表在某一路上会被静默丢'));
        parts.push(this._metricBlock([
            { k: '流式清单', v: String(d.streamTotal) + ' 张' },
            { k: '330 清单', v: String(d.t330Total) + ' 张' },
            { k: '只在流式清单', v: String(d.onlyStream.length) + ' 张' },
            { k: '只在 330 清单', v: String(d.only330.length) + ' 张' }
        ]));
        if (d.onlyStream.length) {
            parts.push('<div class="arc-sub-title">只在流式清单里的表</div>');
            parts.push(this._tableChips(d.onlyStream, 'only'));
        }
        if (d.only330.length) {
            parts.push('<div class="arc-sub-title">只在 330 清单里的表</div>');
            parts.push(this._tableChips(d.only330, 'only'));
        }
        parts.push('</div>');
        return parts.join('');
    }
    _textBlock() {
        const app = this.app;
        const drafts = app.drafts();
        const parts = [];
        parts.push(this._sec('要求文本（本件唯一的产出物）',
            '只产描述，一个字段都不写 —— 裁定不等于迁移'));
        parts.push(this._fieldInput('target', '目标（可空）', this._targetInput, '例：把这份包恢复到当前会话'));
        parts.push(this._fieldInput('mode', '追加要求（可空）', this._modeInput, '例：先列会被清空的表再问一次'));
        parts.push('<div class="arc-btns">');
        parts.push('<button class="arc-btn arc-btn-quiet" data-act="save_draft">存草稿</button>');
        parts.push('<button class="arc-btn arc-btn-main" data-act="make_text">出要求文本</button>');
        parts.push('</div>');
        if (this._flash) parts.push('<div class="arc-pre">' + this._esc(this._flash) + '</div>');
        parts.push('<div class="arc-sec-note">当前草稿：目标 ' + String(drafts.target.length) + ' 字符，追加要求 '
            + String(drafts.mode.length) + ' 字符。</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 重置影响页签 ---------- */
    _resetPanel() {
        const app = this.app;
        const rows = app.resetRows();
        const sum = app.resetSum();
        const parts = [];
        parts.push(this._sec('全量重置会动到哪些', '源式全量重置是两重确认后清全库 + 清 localStorage + 重载页面 —— 本件只列清单'));
        if (!rows.length) {
            parts.push('<div class="arc-empty">还没有可以对账的包 —— 先去看得出表的包。</div>');
            parts.push('</div>');
            return parts.join('');
        }
        parts.push(this._metricBlock([
            { k: '涉及键', v: String(sum.keys) },
            { k: '合计条数', v: sum.unknown ? (String(sum.rows) + '（有 ' + String(sum.unknown) + ' 项读不出）') : String(sum.rows) },
            { k: '读数可信', v: sum.trusty ? '全部读得出' : '有读不出的项' }
        ]));
        parts.push('<div class="arc-list">');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            parts.push('<div class="arc-list-row"><span class="arc-list-k">' + this._esc(r.key)
                + '</span><span class="arc-list-v">' + this._esc(r.label) + '　' + this._esc(r.text) + '</span></div>');
        }
        parts.push('</div>');
        parts.push('<div class="arc-sec-note">逐键列，不给一个总数 —— 源的全量重置会把这批一起清掉。</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 台账页签 ---------- */
    _ledgerPanel() {
        const app = this.app;
        const rows = app.ledgerRows();
        const dropped = app.droppedCount();
        const parts = [];
        parts.push(this._sec('动作台账', '每一次收包 / 放下 / 改草稿 / 出文本的回执（上限 ' + String(AR_LOG_MAX) + ' 条）'));
        parts.push(this._metricBlock([
            { k: '当前条数', v: String(rows.length) },
            { k: '已挤掉', v: String(dropped) }
        ]));
        if (!rows.length) {
            parts.push('<div class="arc-empty">还没有动作。</div>');
        } else {
            parts.push('<div class="arc-table">');
            parts.push('<div class="arc-tr arc-th"><span class="arc-td-name">动作</span>'
                + '<span class="arc-td-shape">结果</span><span class="arc-td-rows">量</span></div>');
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                parts.push('<div class="arc-tr">');
                parts.push('<span class="arc-td-name">' + this._esc(r.action) + '</span>');
                parts.push('<span class="arc-td-shape">' + this._esc(r.ok ? '成' : ('不成' + (r.why ? '（' + r.why + '）' : ''))) + '</span>');
                parts.push('<span class="arc-td-rows">' + this._esc(String(r.n)) + '</span>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('<div class="arc-btns">');
        parts.push('<button class="arc-btn arc-btn-quiet" data-act="clear_ledger">清台账（不动宿主的任何一条）</button>');
        parts.push('</div>');
        parts.push('<div class="arc-sec-note">台账挤掉旧记录会报数，不静默。</div>');
        parts.push('</div>');
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
        if (kind === 'pack') this._packInput = v;
        else if (kind === 'target') this._targetInput = v;
        else if (kind === 'mode') this._modeInput = v;
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
        if (a === 'ingest') {
            const r = app.ingestPack(this._packInput);
            this._flash = r.ok ? '' : ('没收下（' + r.why + '）');
            if (r.ok) { app.setTab('face'); this._packInput = ''; }
        } else if (a === 'clear_input') {
            this._packInput = '';
            this._flash = '';
        } else if (a === 'clear_pack') {
            app.clearPack();
            this._packInput = '';
            this._flash = '已放下 —— 只动本件的四条键，宿主一个字段都没碰。';
        } else if (a === 'save_draft') {
            app.setTarget(this._targetInput);
            app.setMode(this._modeInput);
            this._flash = '草稿已存。';
        } else if (a === 'make_text') {
            const r = app.makeText();
            this._flash = r.ok ? r.text : ('出不了（' + r.why + '）');
        } else if (a === 'clear_ledger') {
            const r = app.clearLedger();
            this._flash = '清掉 ' + String(r.cleared) + ' 条（本件自己的台账）。';
        }
        app.render();
    }
}
