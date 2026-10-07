/* ========================================================
 * traveldesk-view.js — [v3.54.0] 旅行记账案头 · 视图
 * 挂载走 shell.getContentContainer；与号与尖括号走拼装形。
 * 四格：账本（贴回 JSON 入账） / 汇率试算 / 结算读数 / 台账。
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
function money(v) {
    const n = (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    return n === null ? DASH : String(Math.round(n * 100) / 100);
}

export class TraveldeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'tv-root';
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
        let h = '<div class="tv-wrap">';
        /* [v3.66.0 · X2] 跨 App 定位条：从全局搜索点进来时，把「你要看的那一条」摆到最上面。
         *   ★ 找不到时**不假装还在** —— 明确说「这条费用已不在账本里（可能被删或换了会话）」，
         *     因为「点进来停在首屏」与「这一条没了」在界面上长得一样。 */
        const f = vm.focus;
        if (f) {
            h += '<div class="tv-focus' + (f.gone ? ' is-gone' : '') + '">' +
                '<span class="tv-focus-lab">定位</span>' +
                '<span class="tv-focus-id">' + esc(f.id) + '</span>' +
                (f.gone
                    ? '<span class="tv-focus-why">这条费用已不在账本里（被删了，或换过会话）</span>'
                    : '<span class="tv-focus-why">第 ' + esc(String(f.index + 1)) + ' 条 · ' + esc(f.payer || DASH)
                        + ' · ' + money(f.finalCNY) + (f.note ? ' · ' + esc(f.note) : '') + '</span>') +
                '<button class="tv-btn" data-act="unfocus">收起定位</button></div>';
        }
        h += '<div class="tv-sec"><h3>账本（贴回 JSON）</h3>' +
            '<textarea class="tv-input" data-in="book"></textarea>' +
            '<button class="tv-btn" data-act="intake">入账</button>' +
            '<button class="tv-btn" data-act="clear">清空</button>' +
            '<button class="tv-btn" data-act="clear-ledger">清台账</button></div>';
        h += '<div class="tv-sec"><h3>汇率试算</h3>' +
            '<input class="tv-inline" data-in="amount" placeholder="金额">' +
            '<input class="tv-inline" data-in="currency" placeholder="币种" value="JPY">' +
            '<input class="tv-inline" data-in="rate" placeholder="汇率" value="0.048">' +
            '<input class="tv-inline" data-in="rateUnit" placeholder="单位" value="100">' +
            '<button class="tv-btn" data-act="quote">试算</button>';
        const q = vm.lastQuote;
        if (q) h += '<div class="tv-row">折算 CNY：' + money(q.finalCNY) + '（记录汇率 ' + num(q.recordedRate) + '）</div>';
        h += '</div>';
        h += '<div class="tv-sec"><h3>结算</h3>' +
            '<button class="tv-btn" data-act="settle">结算</button>';
        const ls = vm.lastSummary;
        if (ls) {
            h += '<div class="tv-row"><span>平衡</span><span>' + (ls.balanced ? '已平' : '未平') + '</span></div>';
            for (const t of (ls.transfers || [])) h += '<div class="tv-row"><span>' + esc(t.from) + ' → ' + esc(t.to) + '</span><span>' + money(t.amount) + '</span></div>';
            if (!(ls.transfers || []).length) h += '<div class="tv-row"><span>无内部转账</span><span>' + DASH + '</span></div>';
            for (const e of (ls.external || [])) h += '<div class="tv-row"><span>外部 ' + esc(e.from) + ' → ' + esc(e.to) + '</span><span>' + money(e.amount) + '</span></div>';
        }
        h += '</div>';
        h += '<div class="tv-sec"><h3>读数</h3>' +
            '<div class="tv-row"><span>费用</span><span>' + num(vm.readings && vm.readings.expenses) + '</span></div>' +
            '<div class="tv-row"><span>人数</span><span>' + num(vm.readings && vm.readings.people) + '</span></div>' +
            '<div class="tv-row"><span>公共总支出</span><span>' + money(vm.readings && vm.readings.publicTotal) + '</span></div>' +
            '<div class="tv-row"><span>人均（shared）</span><span>' + money(vm.readings && vm.readings.perPerson) + '</span></div>' +
            '<div class="tv-row"><span>条目</span><span>' + num(vm.expenses && vm.expenses.length) + '</span></div></div>';
        h += '<div class="tv-sec"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="tv-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || []).slice(0, 20)) h += '<div class="tv-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        if (vm.dropped > 0) h += '<div class="tv-empty">已裁边 ' + String(vm.dropped) + ' 条</div>';
        h += '</div></div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                const val = function (name) {
                    const n = el.querySelector('[data-in="' + name + '"]');
                    return n ? n.value : '';
                };
                if (act === 'intake') { self.app.intakeBook(val('book')); self.app.render(); }
                else if (act === 'unfocus') { self.app.clearRef(); self.app.render(); }
                else if (act === 'clear') { self.app.clearAll(); self.app.render(); }
                else if (act === 'clear-ledger') { self.app.clearLedger(); self.app.render(); }
                else if (act === 'settle') { self.app.settle(); self.app.render(); }
                else if (act === 'quote') {
                    const amount = parseFloat(val('amount'));
                    self.app.quote(Number.isFinite(amount) ? amount : 0, val('currency') || 'CNY', parseFloat(val('rate')) || 1, parseFloat(val('rateUnit')) || 1);
                    self.app.render();
                }
            });
        });
    }
}