/* ========================================================
 * stickerdesk-view.js — [v3.50.0] 表情包册案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形；零外链加载（不出图）。
 * ======================================================== */
'use strict';
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';
const DASH = String.fromCharCode(45, 45);
function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}
function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : DASH; }

export class StickerdeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'sd-root';
        container.appendChild(root);
        this.root = root;
        return this.root;
    }
    render(vm) {
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(vm);
        this._bind(el);
    }
    _html(vm) {
        const r = vm.readings || {};
        let h = '<div class="sd-wrap">';
        h += '<div class="sd-head">册 ' + num(r.stickers) + ' / 余 ' + num(r.stickersLeft) + ' · 分类 ' + num(r.categories) + ' · 未分类 ' + num(r.uncategorized) + '</div>';
        h += '<div class="sd-sec"><h3>收文本（每行一条：名称 URL）</h3>' +
            '<textarea class="sd-input" data-in="text"></textarea>' +
            '<button class="sd-btn" data-act="intake">解析收下</button>' +
            '<button class="sd-btn" data-act="clear">清空册</button>' +
            '<button class="sd-btn" data-act="clear-ledger">清台账</button>';
        const li = vm.lastIntake;
        if (li) h += '<div class="sd-intake">新增 ' + num(li.added) + ' · 拒收 ' + num(li.rejected ? li.rejected.length : 0) + '</div>';
        h += '</div>';
        h += '<div class="sd-sec"><h3>册（前 50 条）</h3>';
        const rows = (vm.stickers || []).slice(0, 50);
        if (!rows.length) h += '<div class="sd-empty">册还是空的。</div>';
        for (const s of rows) h += '<div class="sd-row"><span>' + esc(s.name) + '</span><span class="sd-url">' + esc((s.url || '').slice(0, 42)) + '</span><span>' + esc(s.categoryId || '未分类') + '</span></div>';
        h += '</div>';
        h += '<div class="sd-sec"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="sd-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || [])) h += '<div class="sd-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        if (vm.dropped > 0) h += '<div class="sd-dropped">台账挤掉 ' + String(vm.dropped) + ' 条</div>';
        h += '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                if (act === 'intake') {
                    const ta = el.querySelector('[data-in="text"]');
                    self.app.intakeText(ta ? ta.value : '');
                } else if (act === 'clear') { self.app.clearAll(); }
                else if (act === 'clear-ledger') { self.app.clearLedger(); }
            });
        });
    }
}