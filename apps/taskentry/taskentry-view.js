/* ========================================================
 * taskentry-view.js — [v3.65.0 · 拓展计划 X1 第一切片] 任务入口 · 视图
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 * 【本视图刻意不做的事】
 *   · 不执行用户 JS、不 eval、不 srcdoc、不建 iframe —— 卡片是**受限声明式**的：
 *     每条靶心只是一行「标签 + 按钮（data-open-app / data-open-tab）」，动作白名单
 *     就两个（open / pin），其余一律不认。
 *   · 不改真实桌面布局：本 App 只做**导航**，桌面图标由 phone/home-screen.js 渲染
 *     （它的分页在 v3.56.0 已定）。「布局修改在真实桌面可见」这条在本切片的落法是
 *     **入口出现在真实桌面**（本 App 进 APPS 表 → renderIconLayout 会渲染它），
 *     而不是让本 App 去改桌面 —— 案头布局（apps/freehome）只管 fh_layout 键，
 *     与真实桌面是两套，混为一谈会做出一个「只在预览里生效」的假功能。
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
export class TaskentryView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'te-root';
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
    _head(vm) {
        const r = vm.readings || {};
        let h = '<div class="te-head">';
        h += '<div class="te-readings">卡 ' + String(r.cards) + ' / 可用 ' + String(r.usableCards) +
            ' · 靶心 ' + String(r.targets) + '（带页签 ' + String(r.withTab) + ' · 只到 App ' + String(r.appOnly) + '）</div>';
        h += '<div class="te-state">收藏 ' + esc(vm.pinState) + (r.pins ? '（' + String(r.pins) + '）' : '') +
            ' · 最近使用 ' + esc(vm.recentState) + (r.recent ? '（' + String(r.recent) + '）' : '') + '</div>';
        h += '</div>';
        /* 页签真源覆盖 + 自检：把「这张表管到多少 App」和「表自身有没有问题」摆出来。
         *   自检有问题时不隐藏（本仓口径：不报错、只错结果是最贵的形态）。 */
        const ts = vm.tabSource || {};
        h += '<div class="te-source"><span class="te-source-note">' + esc(ts.note || '') + '</span>' +
            '<span class="te-source-read">页签真源 ' + String(ts.apps || 0) + ' 个 App / ' + String(ts.tabs || 0) + ' 个页签</span></div>';
        const sc = vm.selfCheck || {};
        const probs = sc.problems || [];
        h += '<div class="te-selfcheck' + (probs.length ? ' te-selfcheck-bad' : '') + '">' +
            (probs.length ? ('自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；'))) : '自检通过') + '</div>';
        return h;
    }
    _filters(vm) {
        const caps = [['all', '全部'], ['usable', '能用'], ['withTab', '能定位页签'], ['appOnly', '只到 App']];
        let h = '<div class="te-caps">';
        for (const c of caps) {
            const on = vm.cap === c[0] ? ' te-cap-on' : '';
            h += '<button class="te-cap' + on + '" data-cap="' + esc(c[0]) + '">' + esc(c[1]) + '</button>';
        }
        return h + '</div>';
    }
    /** 一张卡：标题 + 每条靶心一行（页签状态如实标，不可用说清原因）。 */
    _card(row, vm) {
        const cap = esc(row.capability || 'app-only');
        let h = '<div class="te-card te-cap-' + cap + '">';
        h += '<div class="te-card-head"><span class="te-card-label">' + esc(row.label) + '</span>' +
            '<span class="te-card-why">' + (row.usable ? esc(row.hint) : esc(row.why || 'unusable')) + '</span>' +
            '<button class="te-pin" data-pin="' + esc(row.id) + '">' + (vm.pinIds && vm.pinIds.indexOf(row.id) >= 0 ? '已收藏' : '收藏') + '</button></div>';
        for (const t of (row.targets || [])) {
            const dis = t.usable ? '' : ' disabled';
            h += '<div class="te-target' + (t.usable ? '' : ' te-target-bad') + '">' +
                '<span class="te-target-name">' + esc(t.appId) + (t.tab ? ' · ' + esc(t.tab) : '') + '</span>' +
                '<span class="te-target-note">' + esc(t.note || DASH) + '</span>' +
                '<span class="te-target-tab">' + esc(t.tab ? ('页签 ' + t.tabState) : '只到 App') + '</span>' +
                '<button class="te-open" data-open-app="' + esc(t.appId) + '"' +
                (t.tab ? ' data-open-tab="' + esc(t.tab) + '"' : '') + dis + '>打开</button>' +
                '</div>';
        }
        return h + '</div>';
    }
    _html(vm) {
        let h = '<div class="te-wrap">';
        h += this._head(vm);
        h += this._filters(vm);
        h += '<div class="te-pinned"><h3>收藏（按你摆的顺序）</h3>';
        if (!(vm.pinned || []).length) h += '<div class="te-empty">还没有收藏。在下面任何一张卡上点「收藏」。</div>';
        for (const p of (vm.pinned || [])) {
            h += '<div class="te-target"><span class="te-target-name">' + esc(p.label) + '</span>' +
                '<span class="te-target-note">' + esc(p.tab || '整张卡') + '</span>' +
                '<button class="te-open" data-open-app="' + esc(p.appId) + '"' + (p.tab ? ' data-open-tab="' + esc(p.tab) + '"' : '') + '>打开</button>' +
                '<button class="te-unpin" data-pin="' + esc(p.appId) + '">取消</button></div>';
        }
        if ((vm.pinOrphans || []).length) h += '<div class="te-orphan">收藏里另 ' + String(vm.pinOrphans.length) + ' 条不在任何卡上（如实保留，不编卡）</div>';
        h += '</div>';
        h += '<div class="te-cards">';
        if (!(vm.rows || []).length) h += '<div class="te-empty">当前筛选下没有卡。</div>';
        /* [v3.99.0 · R3-O9] 首屏与工具区分列：分组读数来自 config/desk-focus.js 的 focusOf
         *   （本视图不自己归类）。隐藏开关是**显示意图**：不删任何数据（台账与收藏一字不动）。 */
        const fo = vm.focus || {};
        const rows = (vm.rows || []);
        const byId = {};
        for (const r of rows) byId[r.id] = r;
        /* [v3.99.1] 顺序跟随内核：按 fo.focus / fo.tools 的输出顺序投影行，
         *   而非按 vm.rows 原序做成员过滤（内核排序若不落到视图，排序等于没排）。 */
        const brief = (fo.focus || []).map(function (x) { return byId[x.id]; }).filter(Boolean);
        const desks = (fo.tools || []).map(function (x) { return byId[x.id]; }).filter(Boolean);
        /* [v3.99.1] 成功的分组读数即使两档都为空也尊重（全部隐藏时如实显示空分组 + 恢复入口），
         *   不再回落原始卡列表——那会重显已被用户隐藏的卡且丢失恢复按钮。 */
        if (fo.ok) {
            h += this._group('[首屏] 默认聚焦（' + String(brief.length) + '）', brief, vm, 'focus');
            h += this._group('[工具区] 案头（' + String(desks.length) + '）', desks, vm, 'tools');
            if ((fo.hidden || []).length) {
                h += '<div class="te-orphan">按需隐藏 ' + String(fo.hidden.length) + ' 张（只不显示，数据仍在）</div>';
                for (const hd of (fo.hidden || [])) {
                    h += '<div class="te-target"><span class="te-target-name">' + esc(hd.label) + '</span>' +
                        '<button class="te-open" data-unhide="' + esc(hd.id) + '">恢复显示</button></div>';
                }
            }
        } else {
            for (const row of rows) h += this._card(row, vm);
        }
        h += '</div>';
        h += '<div class="te-recent"><h3>最近使用</h3>';
        if (vm.recentState !== 'ok') h += '<div class="te-empty">最近使用读不出或还没有记录（' + esc(vm.recentState) + '）。</div>';
        for (const r of (vm.recent || [])) {
            h += '<div class="te-target"><span class="te-target-name">' + esc(r.appId) + '</span>' +
                '<span class="te-target-note">' + String(r.count) + ' 次</span>' +
                (r.routed ? '<button class="te-open" data-open-app="' + esc(r.appId) + '">打开</button>' : '<span class="te-stale">已下线</span>') +
                '</div>';
        }
        if ((vm.recentStale || []).length) h += '<div class="te-orphan">另有 ' + String(vm.recentStale.length) + ' 条已去不了（历史读数，不当最近使用摆出）</div>';
        h += '</div>';
        h += '<div class="te-ledger"><h3>台账</h3>';
        if (!(vm.ledger || []).length) h += '<div class="te-empty">台账还没有记录。</div>';
        for (const e of (vm.ledger || []).slice(0, 20)) h += '<div class="te-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        if (vm.dropped > 0) h += '<div class="te-orphan">台账挤掉 ' + String(vm.dropped) + ' 条</div>';
        h += '</div></div>';
        return h;
    }
    /**
     * [v3.99.0 · R3-O9] 一档卡列表（标题 + 逐卡渲染）。
     *   两档共用同一张卡渲染（卡片模板只有一份），只有标题与隐藏按钮不同。
     */
    _group(title, rows, vm, kind) {
        let h = '<div class="te-group te-group-' + esc(kind) + '"><h3>' + esc(title) + '</h3>';
        if (!rows.length) h += '<div class="te-empty">这一档下没有卡。</div>';
        for (const row of rows) {
            h += this._card(row, vm);
            h += '<button class="te-hide" data-hide="' + esc(row.id) + '">隐藏这张卡</button>';
        }
        h += '</div>';
        return h;
    }
    _bind(el) {
        const self = this;
        /* 动作白名单**只有两个**：cap（筛选，纯视图态）/ open（派发）/ pin（收藏）。
         *   其余 data-* 一律不认 —— 受限声明式卡片的意思就是「认得出的动作是有限的」。 */
        el.querySelectorAll('[data-cap]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setCap(b.getAttribute('data-cap')); });
        });
        el.querySelectorAll('[data-open-app]').forEach(function (b) {
            b.addEventListener('click', function () {
                self.app.openTarget(b.getAttribute('data-open-app'), b.getAttribute('data-open-tab'));
            });
        });
        el.querySelectorAll('[data-pin]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.toggleCard(b.getAttribute('data-pin')); });
        });
        /* [v3.99.0 · R3-O9] 按卡隐藏 / 恢复显示：动作白名单从三个变五个（仍然有限）。 */
        el.querySelectorAll('[data-hide]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.hideCard(b.getAttribute('data-hide'), true); });
        });
        el.querySelectorAll('[data-unhide]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.hideCard(b.getAttribute('data-unhide'), false); });
        });
    }
}