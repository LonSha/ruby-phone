# -*- coding: utf-8 -*-
"""v4.27.0 · R4-X6 收口补丁 C：视图接入（App 出口 + 因果板卡 + 绑定 + 样式）。
纪律：视图**不直呼内核**（只经 App 出口）；App 名映射只有内核那一份；
     起点是**用户显式选择**，不默认挑一条。
"""
import io
import os

ROOT = '/home/user/ruby-phone'


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, s):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


# ================================================================ ① App：接线件 + 出口
APP = 'apps/plotline/plotline-app.js'
a = rd(APP)

a = once(a,
         "import { PlotlineView } from './plotline-view.js';\n",
         "import { PlotlineView } from './plotline-view.js';\n"
         "/* [v4.27.0 \u00b7 R4-X6] \u56e0\u679c\u7ebf\u7d22\u4e0e\u672a\u5b8c\u4e8b\u9879\u677f\u7684**\u63a5\u7ebf\u4ef6**\uff08\u53d6\u6570 + \u8d77\u70b9 + \u843d\u70b9\u5f62\u72b6\uff09\u3002\n"
         " *   \u672c App \u53ea\u628a\u5b83\u8f6c\u624b\u7ed9\u89c6\u56fe\uff0c**\u4e0d\u91cd\u5224\u4efb\u4f55\u4e00\u683c**\uff1b\u56e0\u679c\u9762\u672c\u8eab\u7684\u53d6\u6570\u4e0e\u5f52\u56e0\u5168\u5728\n"
         " *   config/causal-board-contract.js\uff08\u7eaf\u5951\u7ea6\u4ef6\uff09\u91cc\uff0c\u4e0e\u5176\u5b83\u9762\u540c\u4e00\u4e2a\u53d6\u6cd5\u3002 */\n"
         "import { PlotlineBoard } from './plotline-board.js';\n",
         'app import')

a = once(a,
         "        this.view = new PlotlineView(this);\n",
         "        this.view = new PlotlineView(this);\n"
         "        /** [v4.27.0 \u00b7 R4-X6] \u56e0\u679c\u677f\u63a5\u7ebf\u4ef6\uff08\u53ea\u6301\u6709\u300c\u7528\u6237\u9009\u4e86\u54ea\u6761\u7ebf\u300d\uff0c\u4e0d\u6301\u6709\u8bfb\u6570\uff09 */\n"
         "        this.board = new PlotlineBoard(this);\n",
         'app ctor')

# 出口：插在 onChatChanged 之前
BOARD_EXITS = """    /* ========== [v4.27.0 · R4-X6] 因果线索与未完事项板（只转发，不重判） ========== */
    /**
     * 一次取齐「因果图 + 未解待办 + 追溯 + 候选边 + 三行读数 + 当前起点」。
     *   ★ 没选起点时追溯如实给 `no-subject` —— **不默认挑一条线**（那会把
     *     「用户没说要追哪条」伪装成「这条线没有源头」）。
     */
    boardPack(opts) {
        try { return this.board.pack(opts || {}); }
        catch (_e) { return this.board.pack({}); }
    }
    /** 当前追踪起点（空串 = 还没选） */
    boardFocus() {
        try { return this.board.focus; } catch (_e) { return ''; }
    }
    /** 设为要追的那条线（空值即清空，不回落成「默认第一条」） */
    setBoardFocus(id) {
        try { return this.board.setFocus(id); } catch (_e) { return ''; }
    }
    /**
     * 该去哪个 App（**声明式**：本出口不执行跳转，只把内核给的路由转出来）。
     *   为什么必须走这里：App 名映射只许有一份（内核的 CB_ACTIONS）——
     *   视图里再写一份，两处必然漂移，而漂移的那一天没人会响。
     */
    boardActionFor(kind) {
        try { return this.board.actionFor(kind); } catch (_e) { return null; }
    }
    /** 类别标签 / 收口标签（视图不写第二份标签表） */
    boardKindLabel(kind) {
        try { return this.board.kindLabel(kind); } catch (_e) { return String(kind == null ? '' : kind); }
    }
    boardClosureLabel(closure) {
        try { return this.board.closureLabel(closure); } catch (_e) { return String(closure == null ? '' : closure); }
    }
    /** 四收口 id 列表（视图的遍历顺序也**只有内核那一份**，不写第二份顺序表） */
    boardClosureIds() {
        try { return this.board.closureIds(); } catch (_e) { return []; }
    }
    /** 节点类别 id 列表（同上：界面选项的唯一出处是内核） */
    boardKindIds() {
        try { return this.board.kindIds(); } catch (_e) { return []; }
    }
"""
a = once(a,
         "    /**\n     * \u6362\u4f1a\u8bdd / \u6e05\u6570\u636e\uff1a\u672c App **\u4e0d\u6301\u6709\u4efb\u4f55\u8bfb\u6570\u526f\u672c**\uff0c\u6545\u65e0\u9700\u91cd\u7ed1\u6570\u636e\u5c42\uff1b\n",
         BOARD_EXITS + "    /**\n     * \u6362\u4f1a\u8bdd / \u6e05\u6570\u636e\uff1a\u672c App **\u4e0d\u6301\u6709\u4efb\u4f55\u8bfb\u6570\u526f\u672c**\uff0c\u6545\u65e0\u9700\u91cd\u7ed1\u6570\u636e\u5c42\uff1b\n",
         'app exits')

a = once(a,
         "    onChatChanged() {\n        this._lastProbe = null;\n    }\n",
         "    onChatChanged() {\n        this._lastProbe = null;\n"
         "        /* [v4.27.0 \u00b7 R4-X6] \u6362\u4f1a\u8bdd\u4e5f\u4e22\u6389\u300c\u4e0a\u4e00\u6b21\u9009\u4e86\u54ea\u6761\u7ebf\u300d\uff1a\u90a3\u662f\u65e7\u4f1a\u8bdd\u7684\u9009\u62e9\uff0c\n"
         "         *   \u800c\u56e0\u679c\u56fe\u968f\u4f1a\u8bdd\u53d8 \u2014\u2014 \u7559\u7740\u5b83\u4f1a\u628a\u65b0\u4f1a\u8bdd\u91cc\u4e00\u4e2a\u540c\u540d\u7684\u8282\u70b9\u5f53\u6210\u65e7\u9009\u62e9\u3002 */\n"
         "        try { this.board.resetScene(); } catch (_e) { /* \u9759\u9ed8\uff1a\u6362\u4f1a\u8bdd\u7edd\u4e0d\u80fd\u56e0\u63a5\u7ebf\u4ef6\u800c\u62a5\u9519 */ }\n"
         "    }\n",
         'app onChatChanged')

wr(APP, a)
print('app OK')

# ================================================================ ② 视图：卡片 + 绑定
VIEW = 'apps/plotline/plotline-view.js'
v = rd(VIEW)

v = once(v,
         "            this._echoCard(face, (pkg && pkg.recallEchoes) || [], (pkg && pkg.echoLives) || []),\n",
         "            this._echoCard(face, (pkg && pkg.recallEchoes) || [], (pkg && pkg.echoLives) || []),\n"
         "            this._boardCard(),\n",
         'view draw')

BOARD_CARD = """    /**
     * [v4.27.0 · R4-X6] 因果线索与未完事项板。
     *
     * 【这一面治的欠债】上游因果面（v3.323.0）早已交付，而手机侧零消费 ⇒
     *   「未结约定 / 已解决伏笔 / 仅推测因果」在界面上**同形**（都是「一条记录」），
     *   而三者处置相反：第一条要去做、第二条不必再提、第三条**不能当事实**。
     *   本卡把三者的**区分**做成可见的（四收口逐格 + 推测边单列 + 单列文案）。
     *
     * 【三条不做】不排序不评分（不写「重要度」）；不把推测边并入已确认边；
     *   不替用户标已解决（这里**一个写口都没有**，只有读与「去哪个 App」的声明）。
     */
    _boardCard() {
        let pkg = null;
        try { pkg = this.app.boardPack(); } catch (_e) { pkg = null; }
        const b = (pkg && pkg.board) || null;
        const lines = (pkg && pkg.lines) || {};
        /* 归因优先：读不到就先说读不到（五态分开），不与「没有线索」同形。 */
        const absent = !b || b.state === 'engine-absent' || b.state === 'face-absent'
            || b.state === 'unusable' || b.state === 'empty';
        let body;
        if (absent) {
            const why = {
                'engine-absent': '未检测到 LonSha 记忆插件的因果面 —— 装上（或升级）后本卡自动可用',
                'face-absent': '插件在，但这一版没有因果面：需要较新版本',
                'unusable': '因果面在，但本机读不出（出口报错或面畸形）—— 这不是「故事里没有线索」',
                'empty': '因果面真跑过了，图里一个节点都没有 —— 剧情推进后会自动长出来'
            }[b && b.state] || '因果板不可读';
            body = '<div class="pn-empty">' + this._esc(why) + '</div>';
        } else {
            const closure = b.closure || {};
            /* 四收口 id 与顺序**从 App 出口读**（视图不写第二份顺序表）。 */
            const ids = (() => {
                try { return this.app.boardClosureIds(); } catch (_e) { return []; }
            })();
            const closureHtml = ids.map((key) => {
                const list = (closure[key] || []).map((id) => this._nodeLine(b, id));
                return [
                    '<div class="pn-cb-group">',
                    '  <div class="pn-cb-group-title">' + this._esc(this.app.boardClosureLabel(key))
                    + '<span class="pn-count">' + list.length + '</span></div>',
                    '  ' + (list.length ? list.join('\\n') : '<div class="pn-empty">没有</div>'),
                    '</div>'
                ].join('\\n');
            }).join('\\n');
            const confirmed = (b.edges || []).map((e) => this._edgeLine(e, false));
            const spec = (b.speculative || []).map((e) => this._edgeLine(e, true));
            const todos = ((pkg && pkg.todos && pkg.todos.todos) || []).map((t) => this._nodeLine(b, t.id, t));
            const trace = (pkg && pkg.trace) || null;
            body = [
                '<div class="pn-cb-line">' + this._esc(lines.board || '') + '</div>',
                '<div class="pn-cb-line">' + this._esc(lines.todos || '') + '</div>',
                closureHtml,
                '<div class="pn-cb-group">',
                '  <div class="pn-cb-group-title">已确认边<span class="pn-count">' + confirmed.length + '</span></div>',
                '  ' + (confirmed.length ? confirmed.join('\\n') : '<div class="pn-empty">没有</div>'),
                '</div>',
                /* ★ 推测边**永远单列**，并逐条带上「不当事实」的标记：它是本卡最重要的一格。 */
                '<div class="pn-cb-group pn-cb-spec">',
                '  <div class="pn-cb-group-title">仅推测（不当事实）<span class="pn-count">' + spec.length + '</span></div>',
                '  ' + (spec.length ? spec.join('\\n') : '<div class="pn-empty">没有</div>'),
                '</div>',
                '<div class="pn-cb-group">',
                '  <div class="pn-cb-group-title">未结待办<span class="pn-count">' + todos.length + '</span></div>',
                '  ' + (todos.length ? todos.join('\\n') : '<div class="pn-empty">没有</div>'),
                '</div>',
                '<div class="pn-cb-trace">' + this._esc(lines.trace || '') + '</div>',
                this._tracePathHtml(trace)
            ].join('\\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">线索与未完事项<span class="pn-count">'
            + (absent ? '—' : (b.counts && b.counts.nodes ? b.counts.nodes + ' 个节点' : '—')) + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\\n');
    }
    /** 一条节点：类别 / 标签 / 收口 / 三个动作（追这条线 · 回源 · 去行动） */
    _nodeLine(b, id, alt) {
        const node = this._nodeOf(b, id) || alt || null;
        if (!node) return '';
        const kind = node.kind || '';
        const act = kind ? this.app.boardActionFor(kind) : null;
        const closure = node.closure || this._closureOf(b, id);
        return [
            '<div class="pn-cb-node">',
            '  <div class="pn-cb-node-main">'
            + (kind ? '<span class="pn-cb-kind">' + this._esc(this.app.boardKindLabel(kind)) + '</span>' : '')
            + '<span class="pn-cb-text">' + this._esc(node.label || node.id || '') + '</span>'
            + (closure ? '<span class="pn-cb-closure">' + this._esc(this.app.boardClosureLabel(closure)) + '</span>' : '')
            + '</div>',
            (node.floor != null ? '  <div class="pn-item-meta">第' + this._esc(node.floor) + '楼</div>' : ''),
            '  <div class="pn-cb-acts">',
            '    <button class="pn-cb-btn" data-pb-focus="' + this._esc(node.id) + '">追这条线</button>',
            (node.ref
                ? '    <button class="pn-cb-btn" data-pb-src="' + this._esc(node.ref) + '" data-pb-node="' + this._esc(node.id) + '">回源</button>'
                : '    <button class="pn-cb-btn" disabled title="这条没有回源凭证">无回源凭证</button>'),
            (act ? '    <button class="pn-cb-btn" data-pb-act="' + this._esc(kind) + '" data-pb-ref="' + this._esc(node.ref || '') + '">' + this._esc(act.label) + '</button>' : ''),
            '  </div>',
            '</div>'
        ].join('\\n');
    }
    /** 一条边（`speculative=true` 时逐条标「不当事实」） */
    _edgeLine(e, speculative) {
        return [
            '<div class="pn-cb-edge' + (speculative ? ' pn-cb-edge-spec' : '') + '">',
            '  <span class="pn-cb-edge-from">' + this._esc(e.from) + '</span>',
            '  <span class="pn-cb-edge-arrow">→</span>',
            '  <span class="pn-cb-edge-to">' + this._esc(e.to) + '</span>',
            (speculative ? '<span class="pn-cb-warn">仅推测 · 不当事实</span>' : ''),
            (e.label ? '<span class="pn-cb-edge-label">' + this._esc(e.label) + '</span>' : ''),
            '</div>'
        ].join('\\n');
    }
    /** 追溯链（「追这条线」的读数；没选起点时如实显示归因，不画一条假链） */
    _tracePathHtml(trace) {
        if (!trace) return '';
        if (trace.reason === 'not-in-graph') {
            return '<div class="pn-cb-trace-note">起点不在图里 —— 该换一个起点，不是「已经追到头了」</div>';
        }
        if (trace.state !== 'ok') return '';
        const path = (trace.path || []).map((x) => this._esc(x)).join(' ← ');
        return [
            '<div class="pn-cb-trace-path">' + (path || '（空链）') + '</div>',
            ((trace.roots || []).length ? '<div class="pn-cb-trace-note">源头：' + this._esc((trace.roots || []).join('、')) + '</div>' : ''),
            (trace.cycles ? '<div class="pn-cb-trace-note">回环 ' + trace.cycles + ' 处（已截断，不无限展开）</div>' : '')
        ].join('\\n');
    }
    _nodeOf(b, id) {
        const list = (b && b.nodes) || [];
        for (const n of list) if (n && n.id === id) return n;
        return null;
    }
    _closureOf(b, id) {
        const c = (b && b.closure) || {};
        /* 遍历顺序同样从 App 出口读（不写第二份收口序）。 */
        const keys = (() => {
            try { return this.app.boardClosureIds(); } catch (_e) { return []; }
        })();
        for (const k of keys) {
            if ((c[k] || []).indexOf(id) >= 0) return k;
        }
        return '';
    }
"""
v = once(v, "    _settingsCard() {\n", BOARD_CARD + "    _settingsCard() {\n", 'view card')

# 顶层助手：收口 id 列表**从 App 出口读**（视图不写第二份顺序表）
HELPER = """export class PlotlineView {"""
v = once(v, "export class PlotlineView {", HELPER, 'view helper')

# 绑定
BIND = """        /* [v4.27.0 · R4-X6] 因果板的三个动作：追这条线 / 回源 / 去行动。
         *   起点是**用户显式点选**（不默认挑一条）；回源把上游给的凭证**原样**派发；
         *   行动走 App 的 boardActionFor（App 名只有内核那一份，这里不写第二份）。
         *   ★ 循环变量刻意叫 btn 而不是 el —— 外层 const el 是容器，
         *     同名遮蔽会让整段循环头落进 TDZ（本仓 v4.26.0 真踩过：绑定永不生效且不报错）。 */
        const all = (sel) => {
            try { return (el && el.querySelectorAll) ? Array.from(el.querySelectorAll(sel)) : []; }
            catch (_e) { return []; }
        };
        for (const btn of all('[data-pb-focus]')) {
            btn.addEventListener('click', () => {
                try { this.app.setBoardFocus(btn.getAttribute('data-pb-focus') || ''); } catch (_e) { /* 忽略 */ }
                this._draw();
            });
        }
        for (const btn of all('[data-pb-src]')) {
            btn.addEventListener('click', () => {
                const ref = btn.getAttribute('data-pb-src') || '';
                const id = btn.getAttribute('data-pb-node') || '';
                if (!ref) { win.toastr?.warn('这条没有回源凭证', '剧情线'); return; }
                try { win.dispatchEvent(new win.CustomEvent('phone:causalSource', { detail: { ref, id } })); }
                catch (_e) { win.toastr?.info('回源凭证：' + ref, '剧情线'); }
            });
        }
        for (const btn of all('[data-pb-act]')) {
            btn.addEventListener('click', () => {
                const act = (() => {
                    try { return this.app.boardActionFor(btn.getAttribute('data-pb-act') || ''); }
                    catch (_e) { return null; }
                })();
                /* 未知类别**不猜去处**：如实说这条线没有可去的 App（不硬投到某个页面）。 */
                if (!act) { win.toastr?.warn('这条线没有可去的页面', '剧情线'); return; }
                try {
                    win.dispatchEvent(new win.CustomEvent('phone:openApp', {
                        detail: { appId: act.app, ref: { kind: 'causal', ref: btn.getAttribute('data-pb-ref') || '' } }
                    }));
                } catch (_e) { win.toastr?.error('打开 ' + act.app + ' 失败', '剧情线'); }
            });
        }
"""
v = once(v,
         "        q('#pn-maxInject')?.addEventListener('change', (e) => {\n"
         "            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 10));\n"
         "            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}\n"
         "            this._draw();\n"
         "        });\n",
         "        q('#pn-maxInject')?.addEventListener('change', (e) => {\n"
         "            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 10));\n"
         "            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}\n"
         "            this._draw();\n"
         "        });\n" + BIND,
         'view bind')

wr(VIEW, v)
print('view OK')

# ================================================================ ③ 样式
CSS = 'apps/plotline/plotline.css'
c = rd(CSS)
CSS_ADD = """
/* ---- [v4.27.0 · R4-X6] 因果线索与未完事项板 ---- */
.pn-cb-line { font-size: 12px; color: #94a3b8; line-height: 1.9; }
.pn-cb-group { margin-top: 8px; border-top: 1px dashed rgba(255, 255, 255, .08); padding-top: 6px; }
.pn-cb-group-title { font-size: 12px; color: #cbd5e1; display: flex; justify-content: space-between; }
.pn-cb-node { padding: 4px 0; }
.pn-cb-node-main { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.pn-cb-kind, .pn-cb-closure {
  font-size: 11px; border-radius: 10px; padding: 1px 8px;
  border: 1px solid rgba(255, 255, 255, .14); color: #94a3b8;
}
.pn-cb-text { font-size: 13px; color: #e2e8f0; }
.pn-cb-acts { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.pn-cb-btn {
  font-size: 11px; border-radius: 12px; padding: 2px 10px; cursor: pointer;
  background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .14); color: #cbd5e1;
}
.pn-cb-btn[disabled] { opacity: .45; cursor: default; }
.pn-cb-edge { font-size: 12px; color: #94a3b8; padding: 2px 0; }
.pn-cb-edge-from, .pn-cb-edge-to { color: #cbd5e1; }
.pn-cb-edge-arrow { color: #64748b; padding: 0 4px; }
.pn-cb-edge-label { color: #64748b; padding-left: 6px; }
/* 推测边**视觉上也要与已确认边分开**：它是「别把猜测当事实」的落点 */
.pn-cb-spec .pn-cb-group-title { color: #d9a441; }
.pn-cb-warn {
  font-size: 10px; border-radius: 8px; padding: 0 6px; margin-left: 6px;
  border: 1px solid rgba(217, 164, 65, .5); color: #d9a441;
}
.pn-cb-trace { margin-top: 8px; font-size: 12px; color: #94a3b8; }
.pn-cb-trace-path { font-size: 12px; color: #e2e8f0; word-break: break-all; }
.pn-cb-trace-note { font-size: 11px; color: #64748b; }
"""
c = c.rstrip('\n') + '\n' + CSS_ADD
wr(CSS, c)
print('css OK')
print('DONE C')