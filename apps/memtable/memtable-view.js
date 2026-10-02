/* ========================================================
 * memtable-view.js — [v3.49.0] 结构化记忆案头 · 视图
 * 键面（失败因 / 处置码 / 四态话）只从 app 给的表里取，本文件不重列。
 * 读数取不出来画横线；空与坏不同形；拒收的逐条给「为什么」。
 * 本文件不许出现反引号模板串与正则字面量；一律字符串拼接；
 * 与号与尖括号走 String.fromCharCode 拼装形。挂载走 shell.getContentContainer
 * （v3430~v3480 案头先例），不碰 document.getElementById / document.body。
 * ======================================================== */
'use strict';

const DASH = String.fromCharCode(45,45);

function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';
function num(v) {
    return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : DASH;
}


export class MemtableView {
    constructor(app) {
        this.app = app;
        this.root = null;
    }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'mt-root';
        container.appendChild(root);
        this.root = root;
        return this.root;
    }
    render(vm) {
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(vm);
        this._bind(el, vm);
    }
    _html(vm) {
        const parts = [];
        parts.push('<div class="mt-wrap">');
        parts.push(this._head(vm));
        parts.push(this._tabs(vm));
        if (vm.tab === 'board') parts.push(this._board(vm));
        else if (vm.tab === 'templates') parts.push(this._templates(vm));
        else if (vm.tab === 'xml') parts.push(this._xml(vm));
        else if (vm.tab === 'history') parts.push(this._history(vm));
        else parts.push(this._ledger(vm));
        parts.push('</div>');
        return parts.join('');
    }
    _head(vm) {
        const r = vm.readings || {};
        return '<div class="mt-head">' +
            '<div class="mt-face mt-tone-' + esc(vm.faceTone) + '">' +
                '<span class="mt-face-text">' + esc(vm.faceText) + '</span>' +
                (vm.whyText ? '<span class="mt-face-why">' + esc(vm.whyText) + '</span>' : '') +
            '</div>' +
            '<div class="mt-readings">' +
                this._reading('模板', num(r.templates)) +
                this._reading('表', num(r.tables)) +
                this._reading('字段', num(r.fields)) +
                this._reading('行表', num(r.rowsTables)) +
                this._reading('行', num(r.rows)) +
                this._reading('锁定', num(r.locked)) +
                this._reading('历史', num(r.history) + '/' + num(r.historyCap)) +
            '</div>' +
        '</div>';
    }
    _reading(label, value) {
        return '<div class="mt-reading"><span class="mt-reading-label">' + esc(label) + '</span>' +
            '<span class="mt-reading-value">' + esc(value) + '</span></div>';
    }
    _tabs(vm) {
        const tabs = [
            ['board', '看板'],
            ['templates', '模板'],
            ['xml', '更新包'],
            ['history', '历史'],
            ['ledger', '台账']
        ];
        let h = '<div class="mt-tabs">';
        for (let i = 0; i < tabs.length; i++) {
            const on = vm.tab === tabs[i][0] ? ' mt-tab-on' : '';
            h += '<button class="mt-tab' + on + '" data-tab="' + esc(tabs[i][0]) + '">' + esc(tabs[i][1]) + '</button>';
        }
        return h + '</div>';
    }
    _board(vm) {
        let h = '<div class="mt-board">';
        h += '<div class="mt-sec"><h3>模板定义文本（可复制）</h3>';
        h += '<pre class="mt-pre">' + esc(vm.definitionText || '还没有模板') + '</pre></div>';
        h += '<div class="mt-sec"><h3>自动更新游标读数</h3>';
        const c = vm.cursor || {};
        h += '<div class="mt-kv">' +
            this._kv('间隔', num(c.interval)) +
            this._kv('游标位', num(c.cursorIndex)) +
            this._kv('下一起始', num(c.nextStartIndex)) +
            this._kv('未同步', num(c.unsyncedCount)) +
            this._kv('成批数', num(c.completedBatchCount)) +
        '</div></div>';
        h += '<div class="mt-sec"><h3>上限余量</h3><div class="mt-kv">' +
            this._kv('模板余量', num(vm.limits && vm.limits.templatesLeft)) +
            this._kv('历史余量', num(vm.limits && vm.limits.historyLeft)) +
            this._kv('每表行上限', num(vm.limits && vm.limits.rowsCap)) +
            this._kv('原文上限', num(vm.limits && vm.limits.textCap)) +
        '</div></div>';
        return h + '</div>';
    }
    _kv(k, v) {
        return '<div class="mt-kv-row"><span class="mt-kv-k">' + esc(k) + '</span><span class="mt-kv-v">' + esc(v) + '</span></div>';
    }
    _templates(vm) {
        let h = '<div class="mt-templates">';
        h += '<div class="mt-actions">' +
            '<button class="mt-btn" data-act="clear-templates">清模板库</button>' +
            '<button class="mt-btn" data-act="clear-data">清数据</button>' +
        '</div>';
        const templates = vm.templates || [];
        if (templates.length === 0) {
            h += '<div class="mt-empty">还没有模板。把模板 JSON 贴到「更新包」一页收下。</div>';
        }
        for (let i = 0; i < templates.length; i++) {
            const t = templates[i];
            h += '<div class="mt-tpl"><div class="mt-tpl-head">' + esc(t.name) +
                '<span class="mt-tpl-id">' + esc(t.id) + '</span></div>';
            if (t.description) h += '<div class="mt-tpl-desc">' + esc(t.description) + '</div>';
            const tables = t.tables || [];
            for (let k = 0; k < tables.length; k++) h += this._table(vm, t, tables[k]);
            h += '</div>';
        }
        return h + '</div>';
    }
    _table(vm, template, table) {
        const isRows = vm.isRowsTable(table);
        let h = '<div class="mt-table"><div class="mt-table-head">' + esc(table.name) +
            '<span class="mt-table-mode">' + (isRows ? 'rows' : 'keyValue') + '</span></div>';
        const tData = (vm.data && vm.data[template.id]) || {};
        const tbData = tData[table.id];
        const cols = table.columns || [];
        if (isRows) {
            const rows = (tbData && tbData.__rows) || [];
            if (rows.length === 0) h += '<div class="mt-empty-line">现有行=空</div>';
            for (let r = 0; r < rows.length; r++) {
                h += '<div class="mt-row"><span class="mt-row-id">' + esc(rows[r].id) + '</span>';
                for (let c = 0; c < cols.length; c++) {
                    h += '<span class="mt-cell">' + esc(cols[c].key) + '=' + esc(vm.displayValue(cols[c], rows[r].cells[cols[c].id]) || '空') + '</span>';
                }
                h += '</div>';
            }
        } else {
            const kv = tbData || {};
            for (let c = 0; c < cols.length; c++) {
                const f = cols[c];
                const v = (kv && kv[f.id] !== undefined) ? kv[f.id] : undefined;
                h += '<div class="mt-field"><span class="mt-field-key">' + esc(f.key) + '</span>' +
                    '<span class="mt-field-type">' + esc(f.type) + '</span>' +
                    '<span class="mt-field-val">' + esc(vm.displayValue(f, v) || '空') + '</span></div>';
            }
        }
        return h + '</div>';
    }
    _xml(vm) {
        let h = '<div class="mt-xml">';
        h += '<div class="mt-sec"><h3>收模板库（JSON）</h3>' +
            '<textarea class="mt-input" id="mt-tpl-input"></textarea>' +
            '<button class="mt-btn" data-act="intake-templates">收下模板库</button></div>';
        h += '<div class="mt-sec"><h3>收更新包（XML）</h3>' +
            '<div class="mt-strategy">策略：' +
            this._strategyBtn(vm, vm.strategies[0], '覆盖') +
            this._strategyBtn(vm, vm.strategies[1], '只填空') +
            '</div>' +
            '<textarea class="mt-input" id="mt-xml-input"></textarea>' +
            '<div class="mt-actions">' +
            '<button class="mt-btn" data-act="intake-xml">解析成计划</button>' +
            '<button class="mt-btn mt-btn-primary" data-act="apply">确认落库</button>' +
            '<button class="mt-btn" data-act="clear-xml">清更新包</button>' +
            '</div></div>';
        if (vm.xml) {
            h += '<div class="mt-sec"><h3>当前更新包（' + esc(vm.xmlAt) + '）</h3>' +
                '<pre class="mt-pre">' + esc(vm.xml) + '</pre></div>';
        }
        if (vm.plan) h += this._plan(vm);
        return h + '</div>';
    }
    _strategyBtn(vm, key, label) {
        const on = vm.strategy === key ? ' mt-tab-on' : '';
        return '<button class="mt-tab' + on + '" data-strategy="' + esc(key) + '">' + esc(label) + '</button>';
    }
    _plan(vm) {
        const plan = vm.plan;
        let h = '<div class="mt-sec"><h3>逐条计划（' +
            '更新 ' + num(plan.updateCount) + ' / 计划 ' + num((plan.plans || []).length) + ' / 坏 ' + num((plan.errors || []).length) + '）</h3>';
        if (plan.intakeWhy) h += '<div class="mt-why-err">' + esc(vm.whyText || plan.intakeWhy) + '</div>';
        const errors = plan.errors || [];
        for (let e = 0; e < errors.length; e++) {
            h += '<div class="mt-plan-row mt-tone-err"><span class="mt-plan-code">解析坏</span>' +
                '<span class="mt-plan-detail">' + esc(errors[e].why) + ' @' + num(errors[e].pos) + '</span></div>';
        }
        const plans = plan.plans || [];
        for (let i = 0; i < plans.length; i++) {
            const p = plans[i];
            const tone = (p.code === 'set') ? 'ok' : (p.code === 'same' ? 'warn' : 'err');
            const label = (vm.codeText && vm.codeText[p.code]) || p.code;
            let detail = esc(p.templateId || '') + ' / ' + esc(p.tableId || '');
            if (p.rowId) detail += ' / 行 ' + esc(p.rowId);
            if (p.fieldId) detail += ' / ' + esc(p.fieldId);
            if (p.op) detail += ' [' + esc(p.op) + ']';
            if (p.code === 'set') {
                detail += '：' + esc(this._fmtVal(p.oldValue)) + ' → ' + esc(this._fmtVal(p.newValue));
            }
            h += '<div class="mt-plan-row mt-tone-' + tone + '"><span class="mt-plan-code">' + esc(label) + '</span>' +
                '<span class="mt-plan-detail">' + detail + '</span></div>';
        }
        return h + '</div>';
    }
    _fmtVal(v) {
        if (v === undefined || v === null || v === '') return '空';
        if (Array.isArray(v)) return v.join(', ');
        if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
        return String(v);
    }
    _history(vm) {
        let h = '<div class="mt-history">';
        const history = vm.history || [];
        if (history.length === 0) h += '<div class="mt-empty">还没有历史。</div>';
        for (let i = 0; i < history.length; i++) {
            const e = history[i];
            h += '<div class="mt-hist-row"><span class="mt-hist-at">' + esc(vm.stampOf(e.timestamp)) + '</span>' +
                '<span class="mt-hist-src">' + esc(e.source) + '</span>' +
                '<span class="mt-hist-n">' + num(e.changedCount) + ' 条变更</span></div>';
        }
        return h + '</div>';
    }
    _ledger(vm) {
        let h = '<div class="mt-ledger">';
        h += '<div class="mt-actions"><button class="mt-btn" data-act="clear-ledger">清台账</button>' +
            (vm.dropped > 0 ? '<span class="mt-dropped">台账挤掉 ' + num(vm.dropped) + ' 条</span>' : '') + '</div>';
        const ledger = vm.ledger || [];
        if (ledger.length === 0) h += '<div class="mt-empty">还没有台账。</div>';
        for (let i = 0; i < ledger.length; i++) {
            const e = ledger[i];
            h += '<div class="mt-ledger-row"><span class="mt-hist-at">' + esc(vm.stampOf(e.at)) + '</span>' +
                '<span class="mt-ledger-act">' + esc(e.action) + '</span>' +
                '<span class="mt-ledger-detail">' + esc(e.detail) + '</span></div>';
        }
        return h + '</div>';
    }
    _bind(el, vm) {
        const self = this;
        el.querySelectorAll('[data-tab]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setTab(b.getAttribute('data-tab')); });
        });
        el.querySelectorAll('[data-strategy]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setStrategy(b.getAttribute('data-strategy')); });
        });
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'intake-templates') {
                    const ta = el.querySelector('#mt-tpl-input');
                    self.app.onIntakeTemplates(ta ? ta.value : '');
                } else if (act === 'intake-xml') {
                    const ta = el.querySelector('#mt-xml-input');
                    self.app.onIntakeXml(ta ? ta.value : '');
                } else if (act === 'apply') {
                    self.app.onApply();
                } else if (act === 'clear-templates') {
                    self.app.clearTemplates();
                } else if (act === 'clear-data') {
                    self.app.clearData();
                } else if (act === 'clear-xml') {
                    self.app.clearXml();
                } else if (act === 'clear-ledger') {
                    self.app.clearLedger();
                }
            });
        });
    }
}
