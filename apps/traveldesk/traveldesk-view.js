import { phoneConfirm, phonePrompt } from '../../config/phone-feedback.js';
/* ========================================================
 * traveldesk-view.js — [v4.169.0]「照现实重写」· 旅行记账案头 · 视图
 * --------------------------------------------------------
 * 上一版的形态：一页到底 —— 账本 / 汇率 / 结算 / 行程板 / 结算提交 / 读数 / 台账
 *   七块全挤在一列，事件按 `[data-act]` 逐元素绑。
 * 「照现实重写」只动**结构与接线**，下面这些已被判据逐字钉住的实现一字未改：
 *   · 结算提交区块 `_commitHtml()` —— 数据只从宿主缓存 `window.VirtualPhone.financeCommitFace()` 读，
 *     动作只交给 `window.VirtualPhone.applyFinanceCommitAction()`，视图不判四态、不写账本；
 *   · 行程板动作一律派给 `app.partyAct(...)`，回报写进 _flash 再重渲染；
 *   · 「参加 / 婉拒 / 未答复」与「预计花费(不落账) / 实际金额」必须分列 —— 合并成一个「总花费」
 *     就等于在界面上承认「估算的已经花掉了」，这是本仓最贵的一类财务错读数；
 *   · 读不出行程板 ⇒ 说「还没取到」，不说「这一板是空的」。
 *
 * 新版四页签：账（贴回 JSON 入账 / 定位条 / 台账）→ 汇（汇率试算）→ 行（协作行程板）
 *   → 结（结算 + 结算提交四态 + 读数）。
 * 接线纪律（与心境 / 周期数学 / 小红书 / 天气 / 打卡 / 存钱罐 / 商城同一套）：
 *   click / input 只在根容器上各挂一次，靠 data-act + dataset 分派；读不到 DOM 一律不抛。
 * ======================================================== */
'use strict';
import { confirmDestroy } from '../../config/destructive-confirm.js';
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

const TABS = [
    { key: 'book', label: '账' },
    { key: 'rate', label: '汇' },
    { key: 'party', label: '行' },
    { key: 'settle', label: '结' },
];

export class TraveldeskView {
    constructor(app) {
        this.app = app;
        this.root = null;
        this._flash = '';
        this.tab = 'book';
        /* 纯视图态：输入草稿。整页重绘不把用户刚打的字冲掉。 */
        this._draft = { book: '', board: '', amount: '', currency: 'JPY', rate: '0.048', rateUnit: '100' };
        this._boundRoot = null;
        this._hClick = null;
        this._hInput = null;
    }

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

    _flashHtml() {
        return this._flash ? '<div class="tv-flash">' + esc(this._flash) + '</div>' : '';
    }

    /** 取元素：读不到就返回 null（宿主 DOM 不全会抛）。 */
    q(sel) {
        try { return this.root && this.root.querySelector ? this.root.querySelector(sel) : null; }
        catch (_e) { return null; }
    }

    /* ---------- 1. 页头 / 定位条 / 页签 ---------- */

    _headHtml(vm) {
        const r = vm.readings || {};
        return '<div class="tv-head"><h2>旅行记账</h2>'
            + '<span class="tv-head-meta">' + num(vm.expenses && vm.expenses.length) + ' 条 · 人均 '
            + money(r.perPerson) + ' · 公共 ' + money(r.publicTotal) + '</span></div>';
    }

    _focusHtml(vm) {
        /* [v3.66.0 · X2] 跨 App 定位条：从全局搜索点进来时，把「你要看的那一条」摆到最上面。
         *   ★ 找不到时**不假装还在** —— 明确说「这条费用已不在账本里（可能被删或换了会话）」。 */
        const f = vm.focus;
        if (!f) return '';
        return '<div class="tv-focus' + (f.gone ? ' is-gone' : '') + '">'
            + '<span class="tv-focus-lab">定位</span>'
            + '<span class="tv-focus-id">' + esc(f.id) + '</span>'
            + (f.gone
                ? '<span class="tv-focus-why">这条费用已不在账本里（被删了，或换过会话）</span>'
                : '<span class="tv-focus-why">第 ' + esc(String(f.index + 1)) + ' 条 · ' + esc(f.payer || DASH)
                    + ' · ' + money(f.finalCNY) + (f.note ? ' · ' + esc(f.note) : '') + '</span>')
            + '<button class="tv-btn tv-mini" data-act="unfocus">收起定位</button></div>';
    }

    _navHtml() {
        return '<nav class="tv-navbar">' + TABS.map((t) =>
            '<button class="tv-nav' + (this.tab === t.key ? ' is-on' : '') + '" data-act="tab" data-tab="'
            + t.key + '">' + t.label + '</button>').join('') + '</nav>';
    }

    /* ---------- 2. 账（贴回 JSON + 台账） ---------- */

    _bookHtml(vm) {
        const d = this._draft;
        let h = '<section class="tv-page" data-page="book">';
        h += '<div class="tv-sec"><h3>账本（贴回 JSON）</h3>'
            + '<textarea class="tv-input" data-in="book" placeholder="人 / 家庭 / 支出三张表的 JSON">'
            + esc(d.book) + '</textarea>'
            + '<button class="tv-btn" data-act="intake">入账</button>'
            + '<button class="tv-btn" data-act="clear">清空</button>'
            + '<button class="tv-btn" data-act="clear-ledger">清台账</button></div>';
        h += '<div class="tv-sec"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="tv-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || []).slice(0, 20)) {
            h += '<div class="tv-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        }
        if (vm.dropped > 0) h += '<div class="tv-empty">已裁边 ' + String(vm.dropped) + ' 条</div>';
        h += '</div>';
        h += '</section>';
        return h;
    }

    /* ---------- 3. 汇（汇率试算） ---------- */

    _rateHtml(vm) {
        const d = this._draft;
        let h = '<section class="tv-page" data-page="rate">';
        h += '<div class="tv-sec"><h3>汇率试算</h3>'
            + '<input class="tv-inline" data-in="amount" placeholder="金额" value="' + esc(d.amount) + '">'
            + '<input class="tv-inline" data-in="currency" placeholder="币种" value="' + esc(d.currency) + '">'
            + '<input class="tv-inline" data-in="rate" placeholder="汇率" value="' + esc(d.rate) + '">'
            + '<input class="tv-inline" data-in="rateUnit" placeholder="单位" value="' + esc(d.rateUnit) + '">'
            + '<button class="tv-btn" data-act="quote">试算</button>';
        const q = vm.lastQuote;
        if (q) h += '<div class="tv-row"><span>折算 CNY</span><span>' + money(q.finalCNY) + '（记录汇率 ' + num(q.recordedRate) + '）</span></div>';
        h += '<div class="tv-hint">试算只算给你看，<strong>不落账</strong>：落账走「账」页贴回 JSON，或「结」页的结算提交。</div>';
        h += '</div>';
        h += '</section>';
        return h;
    }

    /* ---------- 4. 行（协作行程板，内部实现逐字保留） ---------- */

    _partyHtml(vm) {
        /* [v4.03.0 · R3-X6] 协作行程板。
         *   ★ 三件事必须分开显示,合起来就会骗人:
         *     1 **预计花费与实际金额分列**(估的不落账 —— 合并成一个「总花费」会让人以为
         *        估算已经花掉了,这是本仓最贵的一类财务错读数);
         *     2 **参加人数按 accepted 算**,婉拒与未答复各报一条(「没拒绝 ≠ 参加」);
         *     3 读不出这一板 ⇒ 说「还没取到」,**不**说「这一板是空的」。
         *   ★ 视图不自己算读数、不自己判参加者、不自己写账本 —— 只把动作交给宿主。 */
        let h = '<section class="tv-page" data-page="party">';
        h += '<div class="tv-sec"><h3>协作行程(人员 / 顺序 / 分工 / 清单 / 共同费用)</h3>';
        if (!vm.party) {
            h += '<div class="tv-empty">还没取到行程板(等下一次剧情时间推进后刷新)</div>';
        } else {
            const rd = vm.partyReadings || null;
            h += '<div class="tv-row"><span>成员</span><span>' + num(rd && rd.members)
                + '(参加 ' + num(rd && rd.accepted) + ' · 婉拒 ' + num(rd && rd.declined) + ' · 未答复 ' + num(rd && rd.pending) + ')</span></div>';
            h += '<div class="tv-row"><span>预计花费(不落账)</span><span>' + money(rd && rd.estimatedTotal) + ' · ' + num(rd && rd.estimatedCount) + ' 笔</span></div>';
            h += '<div class="tv-row"><span>实际金额</span><span>' + money(rd && rd.actualTotal) + ' · ' + num(rd && rd.actualCount) + ' 笔</span></div>';
            h += '<div class="tv-row"><span>已生成支出 / 待生成</span><span>' + num(rd && rd.committedCount) + ' / ' + num(rd && rd.pendingCommit) + '</span></div>';
            h += '<div class="tv-row"><span>地点 / 分工 / 清单</span><span>' + num(rd && rd.stops) + ' · ' + num(rd && rd.tasksDone) + '/' + num(rd && rd.tasks) + ' · ' + num(rd && rd.checksDone) + '/' + num(rd && rd.checks) + '</span></div>';
            /* 成员 */
            if (vm.party.members.length) {
                for (const m of vm.party.members) {
                    h += '<div class="tv-row tv-party-mem"><span>' + esc(m.name) + ' · ' + esc(m.state) + '</span>'
                        + '<span><button class="tv-btn tv-mini" data-act="tvp-mem" data-name="' + esc(m.name) + '" data-state="accepted">参加</button>'
                        + '<button class="tv-btn tv-mini" data-act="tvp-mem" data-name="' + esc(m.name) + '" data-state="declined">婉拒</button></span></div>';
                }
            } else h += '<div class="tv-empty">还没有成员。</div>';
            /* 地点顺序 */
            if (vm.party.stops.length) h += '<div class="tv-note">路线:' + esc(vm.party.stops.map(function (x, i) { return String(i + 1) + '.' + x.place; }).join(' → ')) + '</div>';
            for (const stop of vm.party.stops) {
                h += '<div class="tv-row"><span>' + esc(stop.place) + ' · ' + esc(stop.progress) + ' · 晚到 ' + num(stop.lateMinutes) + ' 分钟' + (stop.meetWith ? ' · 会合 ' + esc(stop.meetWith) : '') + '</span><span>';
                for (const op of ['current', 'skip', 'late', 'meet', 'reschedule']) h += '<button class="tv-btn tv-mini" data-act="tvp-progress" data-id="' + esc(stop.id) + '" data-op="' + op + '">' + ({ current: '当前站', skip: '跳站', late: '晚到', meet: '会合', reschedule: '重排日期' }[op]) + '</button>';
                h += '<button class="tv-btn tv-mini" data-act="tvp-calendar" data-id="' + esc(stop.id) + '">关联日历接续</button>'
                    + '<button class="tv-btn tv-mini" data-act="tvp-unlink" data-id="' + esc(stop.id) + '">解除日历关联</button></span></div>';
            }
            /* 分工与清单 */
            for (const t of vm.party.tasks) h += '<div class="tv-row"><span>' + (t.done ? '☑ ' : '☐ ') + esc(t.title) + (t.owner ? ' · ' + esc(t.owner) : '') + '</span><span><button class="tv-btn tv-mini" data-act="tvp-task" data-id="' + esc(t.id) + '">' + (t.done ? '取消' : '打勾') + '</button></span></div>';
            for (const c of vm.party.checklist) h += '<div class="tv-row"><span>' + (c.done ? '☑ ' : '☐ ') + esc(c.text) + '</span><span><button class="tv-btn tv-mini" data-act="tvp-check" data-id="' + esc(c.id) + '">' + (c.done ? '取消' : '打勾') + '</button></span></div>';
            /* 共同费用:预计与实际两态显式不同色 */
            for (const c of vm.party.costs) {
                h += '<div class="tv-row tv-party-cost' + (c.state === 'estimated' ? ' is-est' : ' is-act') + '"><span>' + esc(c.title) + ' · ' + esc(c.payer) + '</span><span>'
                    + money(c.finalCNY) + ' <span class="tv-party-tag">' + esc(c.state === 'estimated' ? '估算' : (c.state === 'actual' ? '实际' : '已结算')) + '</span>'
                    + '<button class="tv-btn tv-mini" data-act="tvp-cost-state" data-id="' + esc(c.id) + '" data-state="' + (c.state === 'actual' ? 'estimated' : 'actual') + '">' + (c.state === 'actual' ? '改回估算' : '标实际') + '</button></span></div>';
            }
            const dec = [];
            for (const m of vm.party.members) if (m.state === 'declined') dec.push(m.name);
            if (dec.length) h += '<div class="tv-note">已婉拒 ' + esc(dec.join('/')) + ' —— 不参与本次分摊。</div>';
            h += '<div class="tv-row"><button class="tv-btn" data-act="tvp-people">把参加的人加进账本人头</button>'
                + '<button class="tv-btn" data-act="tvp-commit">生成实际费用的支出</button></div>';
            /* 建议:只读文本,点不掉也改不动任何东西 */
            if (vm.partyAdvice && vm.partyAdvice.length) {
                for (const a of vm.partyAdvice) h += '<div class="tv-note tv-party-advice">建议:' + esc(a) + '</div>';
            }
            if (vm.partyRejected && vm.partyRejected.length) h += '<div class="tv-empty">没收 ' + String(vm.partyRejected.length) + ' 条(填不全或认不出,不是静默丢弃)</div>';
            h += '<textarea class="tv-input" data-in="board" placeholder="行程板 JSON">' + esc(this._draft.board) + '</textarea>'
                + '<button class="tv-btn" data-act="tvp-intake">贴回建板</button>'
                + '<button class="tv-btn" data-act="tvp-clear">清空行程板(不动账本)</button>';
        }
        h += '</div>';
        h += '</section>';
        return h;
    }

    /* ---------- 5. 结（结算 + 提交四态 + 读数） ---------- */

    _settleHtml(vm) {
        let h = '<section class="tv-page" data-page="settle">';
        h += '<div class="tv-sec"><h3>结算</h3>'
            + '<button class="tv-btn" data-act="settle">结算</button>';
        const ls = vm.lastSummary;
        if (ls) {
            h += '<div class="tv-row"><span>平衡</span><span class="' + (ls.balanced ? 'tv-ok' : 'tv-bad') + '">' + (ls.balanced ? '已平' : '未平') + '</span></div>';
            for (const t of (ls.transfers || [])) h += '<div class="tv-row"><span>' + esc(t.from) + ' → ' + esc(t.to) + '</span><span>' + money(t.amount) + '</span></div>';
            if (!(ls.transfers || []).length) h += '<div class="tv-row"><span>无内部转账</span><span>' + DASH + '</span></div>';
            for (const e of (ls.external || [])) h += '<div class="tv-row"><span>外部 ' + esc(e.from) + ' → ' + esc(e.to) + '</span><span>' + money(e.amount) + '</span></div>';
        }
        h += '</div>';
        /* [v3.87.0 · 拓展计划 R-X3] 结算提交（四态 + 预览 + 确认/撤销）。 */
        h += '<div class="tv-sec"><h3>结算提交（四态）</h3>' + this._commitHtml();
        h += '</div>';
        h += '<div class="tv-sec"><h3>读数</h3>' +
            '<div class="tv-row"><span>费用</span><span>' + num(vm.readings && vm.readings.expenses) + '</span></div>' +
            '<div class="tv-row"><span>人数</span><span>' + num(vm.readings && vm.readings.people) + '</span></div>' +
            '<div class="tv-row"><span>公共总支出</span><span>' + money(vm.readings && vm.readings.publicTotal) + '</span></div>' +
            '<div class="tv-row"><span>人均（shared）</span><span>' + money(vm.readings && vm.readings.perPerson) + '</span></div>' +
            '<div class="tv-row"><span>条目</span><span>' + num(vm.expenses && vm.expenses.length) + '</span></div></div>';
        h += '</section>';
        return h;
    }

    /* ---------- 6. 总装 ---------- */

    _html(vm) {
        const page = this.tab === 'rate' ? this._rateHtml(vm)
            : (this.tab === 'party' ? this._partyHtml(vm)
                : (this.tab === 'settle' ? this._settleHtml(vm) : this._bookHtml(vm)));
        return '<div class="tv-wrap">' + this._flashHtml()
            + this._focusHtml(vm)
            + this._headHtml(vm)
            + page
            + this._navHtml()
            + '</div>';
    }

    /**
     * [v3.87.0 · R-X3] 结算提交区块 —— **纯渲染**。
     *   数据只从宿主缓存读（`VirtualPhone.financeCommitFace()`）：
     *     · 缓存不在位 → 说「还没取数」（**不**说没有待提交的东西）；
     *     · 草稿不在位（旅行记账没打开）→ 说「还没取到结算草稿」；
     *     · 有草稿 → 报四态之一 + 来源/币种/参与者/重复风险/落账 owner。
     *   视图**不**算草稿、**不**判四态、**不**写账本 —— 只把动作交给宿主。
     */
    _commitHtml() {
        let cache = null;
        try { cache = window.VirtualPhone?.financeCommitFace?.() || null; } catch (_e) { cache = null; }
        if (!cache) return '<div class="tv-empty">还没取到提交读数（等下一次剧情时间推进后刷新）</div>';
        const draft = cache.draft || null;
        if (!draft) return '<div class="tv-empty">还没取到结算草稿（先打开旅行记账并结算一次）</div>';
        const pv = cache.preview || null;
        let h = '';
        if (pv) {
            h += '<div class="tv-row"><span>态</span><span class="tv-fc-state">' + esc(pv.stateLabel || pv.state || '') + '</span></div>';
            h += '<div class="tv-row"><span>来源</span><span>' + esc(pv.sourceLabel || pv.source || '') + '</span></div>';
            h += '<div class="tv-row"><span>行数 / 参与者</span><span>' + num(pv.lineCount) + ' 行 · ' + esc((pv.participants || []).join('/') || DASH) + '</span></div>';
            if (pv.mixedCurrency === true) {
                h += '<div class="tv-row"><span>金额</span><span class="tv-fc-warn">' + esc(pv.amountNote || '混合币种不给总额') + '</span></div>';
            } else if (pv.amountTotal !== null && pv.amountTotal !== undefined) {
                h += '<div class="tv-row"><span>金额</span><span>' + money(pv.amountTotal) + ' ' + esc((pv.currencies || []).join('/')) + '</span></div>';
            }
            if (pv.duplicate && pv.duplicate.isDuplicate === true) {
                h += '<div class="tv-row"><span>重复风险</span><span class="tv-fc-warn">已提交过（再确认不会重复记账）</span></div>';
            }
            if (pv.ownerWritable === false) {
                h += '<div class="tv-row"><span>落账 owner</span><span class="tv-fc-warn">' + esc(pv.ownerWhy === 'owner-is-upstream' ? '上游写（本机不能代记）' : String(pv.ownerWhy || '不可写')) + '</span></div>';
            }
            h += '<div class="tv-note">' + esc(pv.stateText || '') + '</div>';
            const canWrite = (draft.ownerWritable === true);
            h += '<button class="tv-btn" data-act="fc-commit"' + (canWrite ? '' : ' disabled') + '>确认提交</button>';
            if (pv.duplicate && pv.duplicate.isDuplicate === true) {
                h += '<button class="tv-btn" data-act="fc-revoke">撤销这一笔</button>';
            }
        }
        h += '<div class="tv-note tv-fc-line">' + esc(cache.line || '') + '</div>';
        return h;
    }

    /** 把动作交给宿主（**唯一写入口**在咽喉）——视图自己不落账、不回读、不重跑。 */
    _commit(action) {
        let res = null;
        try { res = window.VirtualPhone?.applyFinanceCommitAction?.(String(action || 'commit')) || null; } catch (_e) { res = null; }
        this._flash = (res && res.note) ? res.note : '这一步没接上（宿主未接线）';
        /* [v3.97.0 · R3-X1] 落账之后**再问一次记忆侧收没收**（上游事实桥回执）：
         *   本机记了一笔 ≠ 记忆侧认了这一笔。两者是两件事，中间没有任何机制会响，
         *   故这一步必须在用户看得见的地方明说。取数走宿主唯一出口
         *   （`VirtualPhone.phoneFactReceiptFor` → 记忆 App 的 `sendPhoneEvent`），
         *   视图自己不算生命周期四态（那归上游 `lifecycleOf`）。 */
        try {
            const r = this._lastReceipt = window.VirtualPhone?.phoneFactReceiptFor?.('finance', {
                eventId: String((res && res.idemKey) || (res && res.plan) || 'commit'),
                summary: String((res && res.note) || '')
            }) || null;
            if (r && r.receipt) this._flash += '｜记忆侧：' + String(r.receipt.state || '') + '（' + String(r.receipt.reason || '') + '）';
        } catch (_e) { /* 回执是**增强**，绝不因它抛错把已完成的落账显示成失败 */ }
        this.app.render();
    }

    /* ---------- 7. 事件（根容器各挂一次） ---------- */

    _bind(el) {
        if (!el) return;
        if (this._boundRoot !== el) {
            this._hClick = (ev) => this._onClick(ev);
            this._hInput = (ev) => this._onInput(ev);
            el.addEventListener('click', this._hClick);
            el.addEventListener('input', this._hInput);
            this._boundRoot = el;
        }
    }

    _attr(el, name) {
        try { return (el && typeof el.getAttribute === 'function') ? el.getAttribute(name) : null; }
        catch (_e) { return null; }
    }

    _hit(target) {
        return (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
    }

    _onInput(ev) {
        const el = (ev && ev.target) || null;
        const field = this._attr(el, 'data-in');
        if (!field) return;
        if (field in this._draft) this._draft[field] = el.value;
    }

    _onClick(ev) {
        const b = this._hit((ev && ev.target) || null);
        const act = this._attr(b, 'data-act');
        if (!act) return;
        const d = this._draft;
        const json = (text) => { try { return JSON.parse(text); } catch (_e) { return null; } };

        if (act === 'tab') {
            const key = this._attr(b, 'data-tab') || 'book';
            if (!TABS.some((t) => t.key === key)) return;
            if (this.tab === key) return;
            this.tab = key;
            this.app.render();
            this._scrollTop();
            return;
        }
        /* [v4.03.0 · R3-X6] 行程板动作:一律派给宿主的 partyAct(**视图不自己改板**),
         *   回报写进 _flash 再重渲染 —— 与本件既有动作同一范式。 */
        if (act === 'tvp-unlink') {
            const expected = JSON.stringify(this.app._party);
            if (!phoneConfirm('解除这个站点的日历关联？原日程保留。')) return;
            this._flash = this.app.partyAct('calendar-unlink', { id: this._attr(b, 'data-id'), expected }).note; this.app.render();
            return;
        }
        if (act === 'tvp-calendar') {
            const calendar = window.VirtualPhone?.calendarApp?.calendarData;
            if (!calendar || calendar.storage !== this.app.storage) { this._flash = '请先打开日历，再返回旅行页接续'; this.app.render(); return; }
            const rows = calendar.getMemos();
            if (!rows.length) { this._flash = '日历没有可关联的日程'; this.app.render(); return; }
            const linkedId = this.app._party?.stops.find(s => s.id === this._attr(b, 'data-id'))?.calendarMemoId;
            const answer = linkedId ? String(rows.findIndex(m => m.id === linkedId) + 1) : phonePrompt('选择要关联的日程编号：' + rows.map((m, i) => '\n' + (i + 1) + '. ' + m.title + ' · ' + m.dateKey).join(''));
            if (answer === null) return;
            const index = Number(answer) - 1;
            if (!Number.isInteger(index) || !rows[index]) { this._flash = linkedId ? '关联日程已失效，请在原日历核对' : '日程编号无效'; this.app.render(); return; }
            const preview = this.app.partyAct('calendar-preview', { id: this._attr(b, 'data-id'), memoId: rows[index].id });
            if (!preview.ok) { this._flash = preview.note; this.app.render(); return; }
            if (!phoneConfirm(preview.note)) return;
            const result = this.app.partyAct('calendar-confirm', { preview });
            this._flash = result.note; this.app.render();
            return;
        }
        if (act === 'tvp-progress') {
            const op = this._attr(b, 'data-op');
            const a = { id: this._attr(b, 'data-id'), op, expected: JSON.stringify(this.app._party) };
            if (op === 'reschedule') { a.day = phonePrompt('该站新日期 YYYY-MM-DD（仅更新行程板，关联日历须另行确认）'); if (a.day === null) return; }
            if (op === 'late') { const answer = phonePrompt('晚到分钟数（1–1440）'); if (answer === null) return; a.minutes = Number(answer); }
            if (op === 'meet') { a.person = phonePrompt('会合对象'); if (a.person === null) return; }
            const preview = this.app.partyAct('progress-preview', a);
            if (!preview.ok) { this._flash = preview.note; this.app.render(); return; }
            if (!phoneConfirm(preview.note + '\n受影响站点：' + preview.affected.map(s => s.place + (s.day ? '（' + s.day + '）' : '')).join('、'))) return;
            const result = this.app.partyAct('progress-confirm', a);
            this._flash = result.note; this.app.render();
            return;
        }
        if (act === 'tvp-intake') { const r = this.app.partyAct('intake', { board: json(d.board) }); this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return; }
        if (act === 'tvp-clear') { const r = this.app.partyAct('clear-board', {}); this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return; }
        if (act === 'tvp-people') { const r = this.app.partyAct('people', {}); this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return; }
        if (act === 'tvp-commit') { const r = this.app.partyAct('commit-costs', {}); this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return; }
        if (act === 'tvp-mem') {
            const r = this.app.partyAct('member', { member: { name: this._attr(b, 'data-name'), state: this._attr(b, 'data-state') } });
            this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return;
        }
        if (act === 'tvp-task') { const r = this.app.partyAct('toggle-task', { id: this._attr(b, 'data-id') }); this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return; }
        if (act === 'tvp-check') { const r = this.app.partyAct('toggle-check', { id: this._attr(b, 'data-id') }); this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return; }
        if (act === 'tvp-cost-state') {
            const r = this.app.partyAct('set-cost-state', { id: this._attr(b, 'data-id'), state: this._attr(b, 'data-state') });
            this._flash = (r && r.note) ? r.note : '这一步没接上'; this.app.render(); return;
        }
        if (act === 'intake') { this.app.intakeBook(d.book); this.app.render(); return; }
        if (act === 'unfocus') { this.app.clearRef(); this.app.render(); return; }
        if (act === 'clear') {
            if (!confirmDestroy({
                appId: 'traveldesk',
                action: '清空全部旅行账',
                what: '人 / 家庭 / 支出三张表',
            })) return;
            this.app.clearAll(); this.app.render(); return;
        }
        if (act === 'clear-ledger') {
            if (!confirmDestroy({
                appId: 'traveldesk',
                action: '清空台账',
                what: '旅行记账动作台账',
            })) return;
            this.app.clearLedger(); this.app.render(); return;
        }
        if (act === 'settle') { this.app.settle(); this.app.render(); return; }
        if (act === 'fc-commit') { this._commit('commit'); return; }
        if (act === 'fc-revoke') { this._commit('revoke'); return; }
        if (act === 'quote') {
            const amount = parseFloat(d.amount);
            this.app.quote(Number.isFinite(amount) ? amount : 0, d.currency || 'CNY', parseFloat(d.rate) || 1, parseFloat(d.rateUnit) || 1);
            this.app.render();
            return;
        }
    }

    /** 换页后把新的一页滚回顶部：内容是整段重写的，外层滚动容器不会自己复位。 */
    _scrollTop() {
        const page = this.q('.tv-page');
        if (!page) return;
        try { if (typeof page.scrollIntoView === 'function') page.scrollIntoView({ block: 'start' }); }
        catch (_e) { /* 宿主不认参数就作罢，不抛 */ }
    }
}

export default TraveldeskView;