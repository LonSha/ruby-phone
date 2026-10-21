/* ========================================================
 * creationdesk-view.js — [v3.90.0 · 拓展计划 R-X6]
 *   素材到发布的完整创作工作台 · 视图（纯渲染）
 * 挂载走 shell.getContentContainer；与号/尖括号走拼装形（不在模板串里出现裸尖括号）。
 *
 * 【本视图刻意不做的事】
 *   · **不发布**：动作白名单**只有三个**（plan / publish / refresh），data-cw-act
 *     之外一律不认 —— 「受限」的意思就是「认得出的动作是有限的」。
 *   · **不写存储**：所有动作都转 app.act()，由咽喉收口；本层零 storage 调用。
 *   · **不自己判**：blocker 名单与计划行文案全部来自内核（cwPlanPublish / cwPlanLine）。
 *   · **[v4.30.0 · R4-X9] 取材板段同样不落笔**：它只把「用户选了哪一幕 / 哪个时点 / 哪几条」转给 App，
 *     真正的交接（进主聊天 / 进创作草稿）归既有 owner；读不出时不摆条目行、也不画交接按钮。
 * ========================================================= */
'use strict';
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';
function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}
export class CreationdeskView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root && this.root.isConnected) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'cwb-root';
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
        let h = '<div class="cwb-head">';
        h += '<div class="cwb-title">创作工作台</div>';
        h += '<div class="cwb-sub">素材到发布 —— 选素材 → 生成草稿 → 发布前检查 → 委托 owner</div>';
        h += '<div class="cwb-reads">' + esc(vm.materialsText) + '</div>';
        h += '<div class="cwb-reads">' + esc(vm.publishedText) + '</div>';
        h += '<div class="cwb-reads">' + esc(vm.draftsText) + '</div>';
        h += '<div class="cwb-reads">' + esc(vm.annualText || '') + '</div>';
        h += '<div class="cwb-reads">' + esc(vm.topicsText) + '</div>';
        h += '<div class="cwb-reads">' + (vm.scopeOk ? '会话身份齐备' : '会话身份缺项（缺项即判「不是同一段」，一律不开工）') + '</div>';
        const sc = vm.selfCheck || {};
        const probs = sc.problems || [];
        h += '<div class="cwb-self' + (probs.length ? ' cwb-self-bad' : '') + '">' +
            (probs.length ? ('自检 ' + String(probs.length) + ' 项：' + esc(probs.slice(0, 3).join('；'))) : ('自检通过（素材类 ' + String(sc.kinds) + ' / 步骤 ' + String(sc.steps) + ' / owner ' + String(sc.owners) + '）')) +
            '</div>';
        if (vm.flash) h += '<div class="cwb-flash' + (vm.flashBad ? ' cwb-flash-bad' : '') + '">' + esc(vm.flash) + '</div>';
        return h + '</div>';
    }
    _states(vm) {
        let h = '<div class="cwb-box"><h3>五类素材（读不到 / 空 / 有 三态不同形）</h3>';
        for (const s of (vm.states || [])) {
            const cls = s.state === 'unreadable' ? ' cwb-st-bad' : (s.state === 'empty' ? ' cwb-st-empty' : ' cwb-st-ok');
            h += '<div class="cwb-row' + cls + '"><span class="cwb-row-k">' + esc(s.label) + '</span><span class="cwb-row-v">' + esc(s.note) + '</span></div>';
        }
        return h + '</div>';
    }
    _materials(vm) {
        let h = '<div class="cwb-box"><h3>素材清单（可回溯到来源 ID）</h3>';
        const items = (vm.materials && vm.materials.items) || [];
        if (!items.length) h += '<div class="cwb-row"><span class="cwb-row-v">' + (vm.materials && vm.materials.readable ? '读到了，但一条素材也没有' : '清单还没取到（咽喉那一轮尚未跑）') + '</span></div>';
        for (const it of items) {
            const on = vm.pickRef === it.ref;
            h += '<div class="cwb-mat' + (on ? ' cwb-mat-on' : '') + (it.problems.length ? ' cwb-mat-bad' : '') + '">';
            h += '<button class="cwb-pick" data-cw-pick="' + esc(it.ref) + '">' + (on ? '已选' : '选中') + '</button>';
            h += '<span class="cwb-mat-label">' + esc(it.label) + '</span>';
            h += '<span class="cwb-mat-meta">' + esc(it.kindLabel) + ' · ' + esc(it.source) + '_' + esc(it.sourceId) + ' · 版本 ' + String(it.version || 0) + '</span>';
            if (it.licNote) h += '<span class="cwb-mat-meta">授权备注：' + esc(it.licNote) + '</span>';
            if (it.problems.length) h += '<span class="cwb-mat-bad-text">' + esc(it.problems.join(' / ')) + '</span>';
            h += '</div>';
        }
        return h + '</div>';
    }
    _targets(vm) {
        let h = '<div class="cwb-box"><h3>目标 App（发布动作仍由目标 App 的 owner 执行）</h3>';
        for (const t of (vm.targets || [])) {
            const on = vm.target === t.target;
            h += '<button class="cwb-tgt' + (on ? ' cwb-tgt-on' : '') + (t.owner ? '' : ' cwb-tgt-none') + '" data-cw-target="' + esc(t.target) + '">' +
                esc(t.label) + (t.owner ? '' : '（无发布口）') + '</button>';
        }
        return h + '<div class="cwb-note">勾选「带敏感标记」会在检查里多一条待确认（进 blocker 的仍是缺图 / 坏链 / 权限三类）</div>'
            + '<button class="cwb-tgt' + (vm.sensitive ? ' cwb-tgt-on' : '') + '" data-cw-sensitive="1">带敏感标记：' + (vm.sensitive ? '是' : '否') + '</button>' + '</div>';
    }
    _plan(vm) {
        let h = '<div class="cwb-box"><h3>发布计划（默认 dry-run）</h3>';
        h += '<div class="cwb-plan' + (vm.plan && vm.plan.blocked ? ' cwb-plan-bad' : '') + '">' + esc(vm.planLine) + '</div>';
        for (const st of (vm.steps || [])) {
            h += '<div class="cwb-row' + (st.writes ? ' cwb-st-write' : '') + '"><span class="cwb-row-k">' + esc(st.label) + '</span><span class="cwb-row-v">' +
                esc(st.ownerWhat) + ' · 产出 ' + esc(st.out) + '</span></div>';
        }
        if (vm.plan && vm.plan.checks) {
            for (const c of vm.plan.checks) {
                h += '<div class="cwb-chk' + (c.ok === true ? ' cwb-chk-ok' : (c.level === 'warn' ? ' cwb-chk-warn' : ' cwb-chk-bad')) + '">' + esc(c.code) + ' · ' + esc(String(c.note || '')) + '</div>';
            }
        }
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-act="plan">预览检查（只读）</button>';
        h += '<button class="cwb-btn cwb-btn-pub" data-cw-act="publish">确认发布（委托 owner）</button>';
        h += '<button class="cwb-btn" data-cw-act="refresh">刷新读数</button>';
        h += '</div></div>';
        return h;
    }
    /** [v4.01.0 · R3-O8] 多目标勾选：一目标一份稿，编辑互不覆盖。 */
    _multiTargets(vm) {
        let h = '<div class="cwb-box"><h3>多目标编排（一段剧情 → 多种社媒稿，分别编辑互不覆盖）</h3>';
        for (const t of (vm.targets || [])) {
            const on = (vm.multiTargets || []).indexOf(t.target) >= 0;
            h += '<button class="cwb-tgt' + (on ? ' cwb-tgt-on' : '') + '" data-cw-multi="' + esc(t.target) + '">' +
                (on ? '已勾选 ' : '勾选 ') + esc(t.label) + (t.owner ? '' : '（无发布口）') + '</button>';
        }
        h += '<div class="cwb-note">已选 ' + String((vm.multiTargets || []).length) + ' 个目标；compose 后每目标各成一份草稿</div>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-draft="compose">编排草稿（一次多目标）</button>';
        h += '<button class="cwb-btn" data-cw-draft="redo">只重做所选段（其余原样保留）</button>';
        h += '</div></div>';
        return h;
    }
    /** [v4.01.0 · R3-O8] 草稿本列表：每份可选中编辑、可丢掉；编辑框只改选中的那份。 */
    _drafts(vm) {
        let h = '<div class="cwb-box"><h3>草稿本（关闭重开保留；每目标一份，互不覆盖）</h3>';
        const dr = vm.drafts || {};
        if (!dr.readable) {
            h += '<div class="cwb-row"><span class="cwb-row-v">草稿本读不到（不是「没草稿」—— 这两件事处置相反）</span></div>';
            return h + '</div>';
        }
        if (!(dr.items || []).length) {
            h += '<div class="cwb-row"><span class="cwb-row-v">草稿本读到了，但一份草稿也没有（先选素材与多目标，编排一次）</span></div>';
            return h + '</div>';
        }
        for (const d of dr.items) {
            const on = vm.draftKey === d.key;
            h += '<div class="cwb-mat' + (on ? ' cwb-mat-on' : '') + '">';
            h += '<button class="cwb-pick" data-cw-draft-key="' + esc(d.key) + '">' + (on ? '编辑中' : '选中编辑') + '</button>';
            h += '<span class="cwb-mat-label">' + esc(d.preview || d.key) + '</span>';
            h += '<span class="cwb-mat-meta">v' + String(d.version) + ' · ' + esc(d.state) + (d.readyToPublish ? ' · 可发布' : ' · 还没写正文') + (d.materialFound ? '' : ' · 素材已不在清单') + '</span>';
            h += '<button class="cwb-btn" data-cw-draft="drop" data-cw-key="' + esc(d.key) + '">丢掉这份</button>';
            h += '</div>';
        }
        h += '<div class="cwb-note">上限 ' + String(dr.limit || 0) + ' 份（最早先出）· 认不出 ' + String(dr.dropped || 0) + ' 份如实计数</div>';
        h += '<div class="cwb-note">编辑框就是「这一份」的文字—— 保存只改这一份，不动其它目标</div>';
        h += '<textarea class="cwb-note-area" data-cw-draft-note rows="4">' + esc(vm.draftNote) + '</textarea>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-draft="edit">保存这份文案（版本比较随行）</button>';
        h += '</div></div>';
        return h;
    }
    /** [v4.02.0 · R3-X4] 话题页段：同一事件在各平台的条目聚拢、分类计数、辟谣态。
     *   公开条目必须用户确认才落（私聊秘密不会自动变公共热帖）。 */
    _topics(vm) {
        let h = '<div class="cwb-box"><h3>话题页(同一事件 → 各平台发布/转载/评论/辟谣,核心事实一致)</h3>';
        const tp = vm.topics || {};
        h += '<div class="cwb-note">' + esc(vm.topicsText || '') + ' · 上限 ' + String(tp.limit || 0) + ' 条</div>';
        h += '<div class="cwb-acts">';
        h += '<input class="cwb-inp" data-cw-topic-event type="text" placeholder="事件键 rootEventId" value="' + esc(vm.topicEvent || '') + '">';
        h += '<input class="cwb-inp" data-cw-topic-platform type="text" placeholder="平台(weibo / xhs / tieba / wechat)" value="' + esc(vm.topicPlatform || '') + '">';
        h += '</div>';
        h += '<textarea class="cwb-note-area" data-cw-topic-text rows="3" placeholder="这条要说什么(核心事实 / 转载 / 评论 / 辟谣说明)">' + esc(vm.topicText || '') + '</textarea>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-topic="page">看话题页(只读)</button>';
        h += '<button class="cwb-btn" data-cw-topic="record" data-cw-topic-kind="publish">记一条发布(公开需确认)</button>';
        h += '<button class="cwb-btn" data-cw-topic="record" data-cw-topic-kind="repost">记一条转载</button>';
        h += '<button class="cwb-btn" data-cw-topic="record" data-cw-topic-kind="comment">记一条评论</button>';
        h += '<button class="cwb-btn" data-cw-topic="debunk">记辟谣(同话题草稿转「已被辟谣」)</button>';
        h += '</div>';
        h += '<div class="cwb-note">辟谣只标「已被辟谣」,**不删旧条目**(撤回≠消失);未标确认的公开条目一律拒收</div>';
        const pg = vm.topicPage;
        if (pg && pg.byKind) {
            h += '<div class="cwb-row"><span class="cwb-row-v">' + esc(pg.summary || '') + '</span></div>';
            h += '<div class="cwb-note">发布 ' + String(pg.byKind.publish || 0) + ' · 转载 ' + String(pg.byKind.repost || 0)
                + ' · 评论 ' + String(pg.byKind.comment || 0) + ' · 辟谣 ' + String(pg.byKind.debunk || 0)
                + (pg.debunked ? (' · 已辟谣(' + esc(pg.debunkedBy || '') + ')') : '') + '</div>';
        }
        h += '</div>';
        return h;
    }
    /** [v4.47.0 · R5-X7] 假设试写段：两栏并列 → 显式试写 → 逐栏决定（采纳 / 保留 / 丢弃）。
     *   ★ 界面**不写第二份文案表**：态与行文案全来自 App 出口（判据全在契约件）。
     *   ★ 两栏基线不同时，段头如实点出来 —— 「同基线才叫同一场景的两条岔路」。
     *   ★ 读不到时不画「采纳」按钮（**不拿空的两栏冒充可采纳**）。 */
    _hypo(vm) {
        const a = this.app;
        if (typeof a.hyAssumeIds !== "function") return "";
        let h = '<div class="cwb-box cwb-hy"><h3>假设场景双栏试写（预演可丢弃 —— **不是既成结局**）</h3>';
        h += '<div class="cwb-note cwb-hy-line">' + esc(vm.hyLine || '') + '</div>';
        /* 基线：两栏都从哪一刻起。空值即清空，**不默认挑一个**。 */
        h += '<div class="cwb-acts">';
        h += '<input class="cwb-inp" data-cw-hy-baseline type="number" placeholder="基线时点(楼层号，留空=没给)" value="' + esc(vm.hyBaseline || '') + '">';
        h += '</div>';
        h += '<div class="cwb-note">基线是**两栏共同的起点**：同基线 ⇒ 差异来自假设本身；基线不同 ⇒ 差异里混着基线差</div>';
        const lanes = vm.hyLanes || {};
        for (const id of ['a', 'b']) {
            const l = lanes[id] || {};
            const on = (vm.hyPicked === id);
            h += '<div class="cwb-hy-lane' + (on ? ' cwb-hy-lane-on' : '') + '">';
            h += '<div class="cwb-hy-head"><span class="cwb-hy-name">' + esc(l.label || id) + '</span>'
                + '<span class="cwb-hy-state cwb-hy-st-' + esc(l.state || '') + '">'
                + esc(a.hyLaneState(l.state)) + '</span></div>';
            /* 假设种类：三种（接受 / 拒绝 / 自定义），**空值即清空，不回落成「接受」**。 */
            h += '<div class="cwb-acts">';
            for (const k of a.hyAssumeIds()) {
                const kon = (l.assume && l.assume.kind) === k;
                h += '<button class="cwb-tgt' + (kon ? ' cwb-tgt-on' : '') + '" data-cw-hy-kind="' + esc(k)
                    + '" data-cw-hy-lane="' + esc(id) + '">' + esc(a.hyAssumeLabel(k)) + '</button>';
            }
            h += '</div>';
            h += '<input class="cwb-inp" data-cw-hy-assume="' + esc(id) + '" type="text" placeholder="这一栏的假设（一句话）" value="'
                + esc((l.assume && l.assume.text) || '') + '">';
            h += '<textarea class="cwb-note-area" data-cw-hy-written="' + esc(id) + '" rows="4" placeholder="这一栏的试写文本（你写，或把既有生成通道的产出贴进来）">'
                + esc(a.hyWrittenOf(id)) + '</textarea>';
            h += '<div class="cwb-note cwb-hy-row">' + esc(l.line || '') + '</div>';
            h += '<div class="cwb-acts">';
            h += '<button class="cwb-btn' + (on ? ' cwb-btn-on' : '') + '" data-cw-hy-pick="' + esc(id) + '">'
                + (on ? '已选中这一栏' : '选中这一栏') + '</button>';
            h += '</div></div>';
        }
        h += '<div class="cwb-note cwb-hy-cmp">可比性：' + esc(vm.hyCompareLabel || '') + '</div>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-hy-act="run">显式试写（只落本机试写区）</button>';
        h += '<button class="cwb-btn" data-cw-hy-act="keep">把选中栏保留为草稿</button>';
        h += '<button class="cwb-btn" data-cw-hy-act="discard">丢弃这次预演（清临时选择）</button>';
        h += '</div>';
        /* ★ 采纳按钮**只在两栏齐备且选中了某栏时才画**：亮一个走不通的按钮比不亮更贵。 */
        /* 采纳按钮画不画读 App 出口的态：拿文案子串去猜的后果
         *   是文案一改按钮就静默消失，而且不报错 —— 本仓最贵的形态。 */
        if (vm.hyAdoptReady === true) {
            h += '<div class="cwb-acts"><button class="cwb-btn cwb-btn-warn" data-cw-hy-act="adopt">'
                + esc(a.hyDecisionLabel('adopt')) + '（转交上游接续确认，本机不落卷）</button></div>';
        } else {
            h += '<div class="cwb-note">采纳按钮先不画：要**两栏同基线**且选中一栏（预演不是既成结局，采纳才建分支）</div>';
        }
        if (vm.hyFlash) {
            h += '<div class="cwb-flash' + (vm.hyFlashBad ? ' cwb-flash-bad' : '') + '">' + esc(vm.hyFlash) + '</div>';
        }
        h += '</div>';
        return h;
    }
    /** [v4.30.0 · R4-X9] 取材板段：选目标 → 预览取材集合 → 选定交给既有 owner。
     *   读不出时不摆条目行、也不画交接按钮（**不拿空板冒充**）。 */
    _board(vm) {
        const b = vm.board || null;
        let h = '<div class="cwb-box"><h3>面向下一幕的取材板（按任务组织事实；取舍归你，落笔归既有 owner）</h3>';
        if (!b || !b.read) {
            h += '<div class="cwb-row"><span class="cwb-row-v">取材板读数还没取到（咽喉那一轮尚未跑）</span></div>';
            return h + '</div>';
        }
        const g = b.gate || {};
        h += '<div class="cwb-note">' + esc(b.lines.pack || '') + '</div>';
        /* ★ 读不到时不摆选项行、也不画交接按钮（不拿空板冒充）。 */
        if (!g.readable) {
            h += '<div class="cwb-row cwb-st-bad"><span class="cwb-row-v">' + esc(g.hint || '') + '</span></div>';
            if (b.note) h += '<div class="cwb-note">' + esc(b.note) + '</div>';
            return h + '</div>';
        }
        /* 任务轴四类（标签来自内核表，视图不写第二份）。 */
        h += '<div class="cwb-acts">';
        for (const t of (this.app.boardTaskIds())) {
            const on = b.task === t;
            h += '<button class="cwb-tgt' + (on ? ' cwb-tgt-on' : '') + '" data-cw-btask="' + esc(t) + '">' +
                (on ? '本幕 ' : '') + esc(this.app.boardTaskLabel(t)) + '</button>';
        }
        h += '</div>';
        h += '<div class="cwb-acts">';
        h += '<input class="cwb-inp" data-cw-basof type="number" placeholder="时点(楼层号，留空=不设)" value="' + esc(b.asOf === null || b.asOf === undefined ? '' : String(b.asOf)) + '">';
        h += '</div>';
        h += '<div class="cwb-note">时点用来**分列**：选定之后才发生的事实进「时点之后」，不许提前进入（本板不替你推进时间）</div>';
        /* 包内条目（勾选即取舍；勾了但不在包里的如实进 notInPack）。 */
        const pack = (b.read.pack || []);
        h += '<div class="cwb-row"><span class="cwb-row-k">本幕材料</span><span class="cwb-row-v">' + esc(b.lines.sheet || '') + '</span></div>';
        if (!pack.length) {
            h += '<div class="cwb-row"><span class="cwb-row-v">池里一条都没进包 —— 去看「被挡住」里是谁（不是「没有材料」）</span></div>';
        }
        for (const m of pack) {
            const on = (b.picked || []).indexOf(m.id) >= 0;
            h += '<div class="cwb-mat' + (on ? ' cwb-mat-on' : '') + '">';
            h += '<button class="cwb-pick" data-cw-bpick="' + esc(m.id) + '">' + (on ? '已选' : '选中') + '</button>';
            h += '<span class="cwb-mat-label">' + esc(m.title || m.id) + '</span>';
            h += '<span class="cwb-mat-meta">' + esc(m.facetLabel) + ' · ' + esc(m.source) + (m.floor === null ? '' : ' · 楼层 ' + String(m.floor)) + '</span>';
            h += '</div>';
        }
        h += '<div class="cwb-row"><span class="cwb-row-k">被挡住</span><span class="cwb-row-v">' + esc(b.lines.held || '') + '</span></div>';
        const hd = b.held || {};
        for (const key of ['restricted', 'future', 'unclassified', 'superseded']) {
            const rows = ((hd.held || {})[key] || []);
            for (const r of rows.slice(0, 6)) {
                h += '<div class="cwb-row"><span class="cwb-row-k">' + esc(this.app.boardHeldBucketLabel(key)) + '</span><span class="cwb-row-v">' + esc(r.title || r.id) + (r.supersededBy ? '（被 ' + esc(r.supersededBy) + ' 取代）' : '') + '</span></div>';
            }
        }
        /* 选定读数（三类**分列**：能交 / 不在本幕包里 / 时点之后）。 */
        h += '<div class="cwb-note">' + esc(b.lines.pick || '') + '</div>';
        const pk = b.pick || {};
        for (const r of (pk.afterAsOf || []).slice(0, 6)) {
            h += '<div class="cwb-row cwb-st-bad"><span class="cwb-row-k">' + esc(this.app.boardPickHeldLabel('after-as-of')) + '</span><span class="cwb-row-v">' + esc(r.title || r.id) + ' · 楼层 ' + String(r.floor) + '</span></div>';
        }
        for (const r of (pk.notInPack || []).slice(0, 6)) {
            h += '<div class="cwb-row cwb-st-empty"><span class="cwb-row-k">' + esc(this.app.boardPickHeldLabel('not-in-pack')) + '</span><span class="cwb-row-v">' + esc(r.id) + '</span></div>';
        }
        h += '<div class="cwb-acts">';
        /* [v4.45.0 · R5-O1] 修前这里只有一个按钮，点了只返回三个 owner **字符串**（谁都没被调用）。
         *   现在这一排分两层，与计划原文「**预览内容后**交给原 owner」对齐：
         *     · `data-cw-bhandoff` —— **预览**交接单（纯读数：交哪几条、幂等键、两套来源词表的说明），
         *       一个字节都不落笔；
         *     · `data-cw-bcommit` —— 两个**真去向**（加入创作草稿 / 用于下一次主聊天），
         *       交给宿主真落笔；主聊天那条只**登记**（**登记 ≠ 已发送**）。 */
        h += '<button class="cwb-btn" data-cw-bhandoff>预览交接单（不落笔）</button>';
        /* ★ 去向按钮由 App 的去向表驱动；**App 没提供这张表时如实退化为「不可交」**
         *   （不炸界面、也不假装有路可走）—— 历史判据的轻量 mock 走的就是这一支。 */
        const targetIds = (typeof this.app.boardTargetIds === 'function') ? this.app.boardTargetIds() : [];
        if (!targetIds.length) {
            h += '<span class="cwb-note">去向表没取到（App 未就绪）—— 交接先搁着，别当交过去了</span>';
        }
        for (const t of targetIds) {
            const label = (typeof this.app.boardTargetLabel === 'function') ? this.app.boardTargetLabel(t) : t;
            const needConfirm = (t === 'chat');
            h += '<button class="cwb-btn' + (needConfirm ? ' cwb-btn-warn' : '') + '" data-cw-bcommit="' + esc(t) + '">'
                + esc(label) + (needConfirm ? '（登记，不发送）' : '') + '</button>';
        }
        h += '<button class="cwb-btn" data-cw-bcancel>取消（不触发生成）</button>';
        h += '</div>';
        /* 预览行（点「预览交接单」之后出现；纯读数，不落笔）。 */
        if (vm.boardPreview) {
            h += '<div class="cwb-note">交接单预览：' + esc(vm.boardPreview) + '</div>';
        }
        /* 两处落点读数（**如实分列**：登记了 ≠ 已发送；草稿本里有几行来自本板）。 */
        const hf = (typeof this.app.boardHandoffFace === 'function') ? this.app.boardHandoffFace() : null;
        if (hf && hf.pending) {
            h += '<div class="cwb-note cwb-st-ok">下一次主聊天要带的材料：' + String(hf.pending.count)
                + ' 条（' + esc(hf.pending.key) + '）· **还没发送**'
                + (hf.pending.sent ? '（已发出：留痕在场）' : '') + '</div>';
        }
        if (hf && typeof hf.draftedCount === 'number') {
            h += '<div class="cwb-note">草稿本里由本板落下的：' + String(hf.draftedCount) + ' 份</div>';
        }
        return h + '</div>';
    }
    _html(vm) {
        let h = '<div class="cwb-wrap">';
        h += this._head(vm);
        h += this._states(vm);
        h += this._materials(vm);
        h += this._targets(vm);
        h += this._multiTargets(vm);
        h += this._drafts(vm);
        h += this._topics(vm);
        h += this._board(vm);
        h += this._hypo(vm);
        h += this._plan(vm);
        h += '</div>';
        return h;
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-cw-pick]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setPick(b.getAttribute('data-cw-pick')); });
        });
        el.querySelectorAll('[data-cw-target]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setTarget(b.getAttribute('data-cw-target')); });
        });
        el.querySelectorAll('[data-cw-sensitive]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setSensitive(!self.app._sensitive); });
        });
        el.querySelectorAll('[data-cw-act]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.act(b.getAttribute('data-cw-act')); });
        });
        /* [v4.01.0 · R3-O8] 草稿本与多目标绑定。 */
        el.querySelectorAll('[data-cw-multi]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.toggleMultiTarget(b.getAttribute('data-cw-multi')); });
        });
        el.querySelectorAll('[data-cw-draft-key]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setDraft(b.getAttribute('data-cw-draft-key')); });
        });
        const noteArea = el.querySelector('[data-cw-draft-note]');
        if (noteArea) noteArea.addEventListener('input', function () { self.app.setDraftNote(noteArea.value); });
        const tEvent = el.querySelector('[data-cw-topic-event]');
        if (tEvent) tEvent.addEventListener('input', function () { self.app.setTopicEvent(tEvent.value); });
        const tPlat = el.querySelector('[data-cw-topic-platform]');
        if (tPlat) tPlat.addEventListener('input', function () { self.app.setTopicPlatform(tPlat.value); });
        const tText = el.querySelector('[data-cw-topic-text]');
        if (tText) tText.addEventListener('input', function () { self.app.setTopicText(tText.value); });
        el.querySelectorAll('[data-cw-topic]').forEach(function (b) {
            b.addEventListener('click', function () {
                const sub = b.getAttribute('data-cw-topic');
                const kind = b.getAttribute('data-cw-topic-kind') || 'publish';
                self.app.topicAct(sub, { kind: kind, confirmed: true, actor: 'user', knows: true });
            });
        });
        /* [v4.30.0 · R4-X9] 取材板绑定：动作全转 app（视图不自己记、不落笔）。 */
        el.querySelectorAll('[data-cw-btask]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setBoardTask(b.getAttribute('data-cw-btask')); });
        });
        const bAsOf = el.querySelector('[data-cw-basof]');
        if (bAsOf) bAsOf.addEventListener('change', function () { self.app.setBoardAsOf(bAsOf.value); });
        el.querySelectorAll('[data-cw-bpick]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.toggleBoardPicked(b.getAttribute('data-cw-bpick')); });
        });
        el.querySelectorAll('[data-cw-bhandoff]').forEach(function (b) {
            b.addEventListener('click', function () {
                /* 纯读数（**不落笔**）：把交接单端出来给用户看一眼，再决定交给哪一处。 */
                const r = self.app.boardHandoff();
                self.app.setBoardPreview(r);
            });
        });
        /* [v4.45.0 · R5-O1] 两个**真去向**按钮：交给宿主落笔（本视图不落盘、不发布）。
         *   ★ 主聊天那条**先要用户显式确认**（计划原文：「发送主聊天必须另行显式确认」）——
         *     而且确认的是「**登记**下一次要带」，不是「现在发送」（发送在主聊天里再确认一次）。 */
        el.querySelectorAll('[data-cw-bcommit]').forEach(function (b) {
            b.addEventListener('click', function () {
                const t = b.getAttribute('data-cw-bcommit') || '';
                if (t === 'chat') {
                    const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
                        ? window.confirm('把选定的材料登记为「下一次主聊天要带的材料」？\n（只登记，不发送 —— 发送要你在主聊天里再确认一次）')
                        : true;
                    if (!ok) return;
                }
                Promise.resolve(self.app.boardCommit(t)).catch(function () { /* 回执在 app 层已如实落到 flash */ });
            });
        });
        el.querySelectorAll('[data-cw-bcancel]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.cancelBoard(); });
        });
        /* [v4.47.0 · R5-X7] 假设试写区绑定：动作全转 app（视图不自己记、不落正史）。 */
        el.querySelectorAll('[data-cw-hy-kind]').forEach(function (b) {
            b.addEventListener('click', function () {
                const lane = b.getAttribute('data-cw-hy-lane');
                const kind = b.getAttribute('data-cw-hy-kind');
                /* 再点一次同一个 = 取消（**不回落成「接受」**）。 */
                const cur = self.app.hyKindOf(lane);
                self.app.hySetAssumeKind(lane, cur === kind ? '' : kind);
            });
        });
        el.querySelectorAll('[data-cw-hy-assume]').forEach(function (n) {
            n.addEventListener('input', function () { self.app.hySetAssumeText(n.getAttribute('data-cw-hy-assume'), n.value); });
        });
        el.querySelectorAll('[data-cw-hy-written]').forEach(function (n) {
            n.addEventListener('input', function () { self.app.hySetWritten(n.getAttribute('data-cw-hy-written'), n.value); });
        });
        const hyBase = el.querySelector('[data-cw-hy-baseline]');
        if (hyBase) hyBase.addEventListener('change', function () { self.app.hySetBaseline(hyBase.value); });
        el.querySelectorAll('[data-cw-hy-pick]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.hyPick(b.getAttribute('data-cw-hy-pick')); });
        });
        el.querySelectorAll('[data-cw-hy-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const sub = b.getAttribute('data-cw-hy-act') || '';
                /* 丢弃与采纳各要一次显式确认（丢弃清临时选择、采纳要转上游）。 */
                if (sub === 'discard' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    const ok = window.confirm('丢弃这次预演？\n（只清本机的临时选择，正史一个字节都不会动）');
                    if (!ok) return;
                }
                Promise.resolve(self.app.hyAct(sub)).catch(function () { /* 回执在 app 层已如实落到 flash */ });
            });
        });
        el.querySelectorAll('[data-cw-draft]').forEach(function (b) {
            b.addEventListener('click', function () {
                const k = b.getAttribute('data-cw-key');
                if (k) self.app.setDraft(k);
                self.app.draftAct(b.getAttribute('data-cw-draft'));
            });
        });
    }
}
