/* ========================================================
 * place-view.js — [v2.46.0] 地点图景视图
 *
 * 【这一面存在的理由】上游记忆插件 v3.181 把「地点」做成了可查询面
 *   （树/到访/在场/覆盖度/不变量六面）并外供到只读桥快照上，
 *   而手机端此前零消费——于是「这一段剧情发生在哪儿」「谁在这个地方」
 *   在手机上完全答不出。本视图把那五块投影摆出来，并把**读不到的原因**
 *   一并摆出来（六态归因），而不是显示一个和「世界是空的」同形的 0。
 *
 * 只读：数据全部来自 this.app.projection()（内部只读桥，不写任何状态）。
 * 结构：_esc + _draw + _bind（与 bili-view / peek-view 同风格）。
 * ============================================================ */
'use strict';

export class PlaceView {
    constructor(app) {
        this.app = app;
        this.container = null;
        /** 最近一次渲染用的读数包（供绑定回调判断是否可用） */
        this._pkg = null;
        /* [v4.43.0 · R5-X3] 行踪时间带选中的角色（**只在本会话**：不落盘）。
         *   为什么留在内存：本项是**读侧**功能（计划原文「读侧功能不写故事」），
         *   选择本身不是数据。 */
        this._bandNames = [];
        this._bandEvidenced = false;
    }

    render(container) {
        if (!container) return;
        this.container = container;
        this._draw();
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }

    _draw() {
        let pkg = null;
        try { pkg = this.app.projection(); } catch (_e) { pkg = null; }
        this._pkg = pkg;
        const face = (pkg && pkg.face) || { reason: 'bridge-absent', text: '地点图景不可读', state: 'absent' };
        const proj = (pkg && pkg.proj) || null;
        const src = (pkg && pkg.src) || null;

        const html = [
            '<div class="pl-root">',
            '  <header class="pl-header">',
            '    <button class="pl-nav" id="pl-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>地点图景</h2>',
            '    <button class="pl-nav" id="pl-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="pl-body">',
            this._reasonCard(face),
            this._sourceCard(src),
            this._summaryCard(face, proj),
            this._currentCard(proj, face),
            this._headerCard(proj),
            this._treeCard(proj, face),
            this._visitHistoryCard(proj, face),
            this._presenceCard(proj, face),
            /* [v3.4.3 · F-3] 同楼同刻（事实面）：紧跟在「谁在这个地方」之后 ——
             *   它读的是同一份 presence 的另一种切法（按「同一处 ≥2 人」分组），
             *   两块放一起读者才能对照「谁在哪」与「哪处有两人以上」。 */
            this._coPresenceCard(proj, face),
            /* [v4.43.0 · R5-X3] 行踪时间带：与「同楼同刻」并列 —— 前者是**瞬时**读数，
             *   本卡是**时间窗**读数（两人同地不同时间不算见面）。 */
            this._presenceBandCard(),
            /* [v4.05.0 · R3-X9] 探索卡:真正把「只能看」变成「能选」的那一块。
             *   位置有讲究:它排在「谁在这个地方 / 同楼同刻」之后 ——
             *   读者先看清原地有什么,再决定要去哪;排到最前面等于让人还没看当前就被劝出门。 */
            this._roamCard(proj, face),
            /* [v4.97.0 · R11-O3 第三批] 街区机会卡：紧跟在探索卡之后 —— 前者答「能去哪」，
             *   本卡答「去了有什么可参与」（同一处地点的两种读数，读者顺路对照）。 */
            this._districtCard(),
            this._settingsCard(),
            (this._showDiag() ? this._diagCards(proj) : ''),
            '  </div>',
            '</div>'
        ].join('\n');

        try { this.container.innerHTML = html; } catch (_e) { /* 宿主容器不可用：不抛 */ }
        this._bind();
    }

    _showDiag() {
        try { return this.app.getSettings().showDiagnostics !== false; } catch (_e) { return true; }
    }

    /** 归因卡：读不到时**先说读不到**（六态分开），不与「世界是空的」同形 */
    _reasonCard(face) {
        const tone = face.reason === 'ready' ? 'ok' : (face.reason === 'empty' ? 'warn' : 'off');
        const hint = {
            'ready': '本世界的场所与在场由记忆插件的场所图景面提供（只读）。',
            'empty': '这个会话还没登记过任何场所——剧情里出现地点后会自动长出来。',
            'no-scene-face': '记忆插件在，但这一版快照没有场所面：需要插件 v3.181 或更新。',
            'module-absent': '记忆插件里场所模块缺席（内置退路在跑），读数一律为空，不是「没有场所」。',
            'no-snapshot': '桥已装好，但还没有产出过快照：等一次生成（或先聊一楼）即可。',
            'bridge-absent': '未检测到 LonSha 记忆插件；装上后本页自动可用。'
        }[face.reason] || '未知归因（如实显示原值，不吞）';
        return [
            '<div class="pl-card pl-reason pl-reason-' + tone + '">',
            '  <div class="pl-reason-head">' + this._esc(face.text || face.reason) + '</div>',
            '  <div class="pl-reason-hint">' + this._esc(hint) + '</div>',
            '</div>'
        ].join('\n');
    }

    /**
     * 来源卡（[v3.0.1]）：把「这份读数是哪一次的」贴出来（投影契约的归属面）。
     *
     * 【为什么单独成卡而不是并进归因卡】归因卡回答的是**本面读不读得到**（六态，与数据的
     *   有无同域）；来源卡回答的是**读到的那份是谁的**（会话/场景/世界/修订/时效/权限）。
     *   两者可以同时成立：例如「场所面读到了（ready），但那份读数已过期 / 未绑定会话」。
     *   并进一张卡会把两种不同的坏消息压成一句，正是本仓反复治理的形态。
     */
    _sourceCard(src) {
        if (!src) return '';
        const tone = src.usable === true ? (src.stale === true ? 'warn' : 'ok') : 'off';
        return [
            '<div class="pl-card pl-src pl-src-' + tone + '">',
            '  <div class="pl-card-title">数据来源</div>',
            '  <div class="pl-src-line">' + this._esc(src.line) + '</div>',
            '</div>'
        ].join('\n');
    }

    _summaryCard(face, proj) {
        const s = (proj && proj.scale) || {};
        const n = (v) => (v === null || v === undefined) ? '—' : String(v);
        const rows = [
            ['已登记场所', n(s.nodes), '处'],
            ['已细写', n(s.detailed), '处'],
            ['最深', n(s.depth), '层'],
            ['到访史', n(s.visits), '处'],
            ['在场', n(s.presence), '人']
        ].map((r) => '<div class="pl-stat"><b>' + this._esc(r[1]) + '</b><span>' + this._esc(r[0]) + '</span></div>').join('');
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">规模</div>',
            '  <div class="pl-stats">' + rows + '</div>',
            '</div>'
        ].join('\n');
    }

    _currentCard(proj, face) {
        const chain = (proj && proj.current) || [];
        const body = chain.length
            ? '<div class="pl-chain">' + chain.map((seg, i) =>
                (i ? '<i class="pl-chain-sep">›</i>' : '') + '<span class="pl-chip">' + this._esc(seg) + '</span>'
              ).join('') + '</div>'
            : '<div class="pl-empty">' + this._esc(face.reason === 'ready' ? '还没有记录当前位置（剧情里出现位置移动后会有）' : '读不到当前位置') + '</div>';
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">当前所在</div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }

    /**
     * 本楼场景头（[v3.1.0] R3-A）：日期 / 时段 / 天气。
     * 上游没登记过这楼的头 ⇒ 显式说「没登记」，而不是渲染成空白行——
     * 「这天没写」与「这版没有这个面」处置不同（前者可补，后者等升级）。
     */
    _headerCard(proj) {
        const h = proj && proj.header;
        const hasFace = !!(proj && proj.hasHeaderFace);
        let body;
        if (h) {
            const chips = [
                h.date ? ['日期', h.date] : null,
                h.period ? ['时段', h.period] : null,
                h.weather ? ['天气', h.weather] : null
            ].filter(Boolean).map((c) => '<span class="pl-chip">' + this._esc(c[1]) + '</span>').join('');
            body = '<div class="pl-chain">' + chips + '</div>';
        } else {
            body = '<div class="pl-empty">' + this._esc(
                hasFace ? '这一楼还没登记场景头（日期/时段/天气）' : '上游这版没有场景头面（需插件 v3.220 或更新）'
            ) + '</div>';
        }
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">本楼场景头</div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }

    /**
     * 场所层级（[v3.1.0] R3-A）：城市 → 区域 → 场所 → 房间。
     * 缩进由上游 depth 决定（不本地重算层级：本地猜父节点会把别人的子节点算串）。
     */
    _treeCard(proj, face) {
        const rows = (proj && proj.tree) || [];
        const hasFace = !!(proj && proj.hasTreeFace);
        if (!rows.length) {
            return [
                '<div class="pl-card">',
                '  <div class="pl-card-title">场所层级</div>',
                '  <div class="pl-empty">' + this._esc(
                    hasFace ? (face.reason === 'ready' ? '这个会话还没登记场所' : '读不到场所层级') : '上游这版没有层级面（需插件 v3.220 或更新）'
                ) + '</div>',
                '</div>'
            ].join('\n');
        }
        const items = rows.map((n) => {
            const pad = Math.max(0, (n.depth || 1) - 1) * 14;
            const marks = [];
            if (n.visited) marks.push(n.visits > 1 ? '去过' + n.visits + '次' : '去过');
            if (n.floor !== null) marks.push('第' + n.floor + '楼');
            return [
                '<div class="pl-node" style="padding-left:' + pad + 'px">',
                '  <span class="pl-node-name">' + this._esc(n.name || n.key) + '</span>',
                (n.desc ? '<span class="pl-node-desc">' + this._esc(n.desc) + '</span>' : ''),
                (marks.length ? '<span class="pl-node-mark">' + this._esc(marks.join(' · ')) + '</span>' : ''),
                '</div>'
            ].join('\n');
        }).join('');
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">场所层级<span class="pl-count">' + rows.length + ' 处</span></div>',
            '  ' + items,
            '</div>'
        ].join('\n');
    }

    /**
     * 到访史（[v3.1.0] R3-A）：去过哪儿、去过几次、最后是哪一楼。
     * count 现在**真的有值**（上游 visitsList 给了），不再只能报条目数。
     * registered=false 是真缺陷（到访过但树里没这个节点）⇒ 显式标注，不问不响。
     */
    _visitHistoryCard(proj, face) {
        const rows = (proj && proj.history) || [];
        const hasFace = !!(proj && proj.hasVisitFace);
        if (!rows.length) {
            return [
                '<div class="pl-card">',
                '  <div class="pl-card-title">到访史</div>',
                '  <div class="pl-empty">' + this._esc(
                    hasFace ? (face.reason === 'ready' ? '还没有到访记录' : '读不到到访史') : '上游这版没有到访史面（需插件 v3.220 或更新）'
                ) + '</div>',
                '</div>'
            ].join('\n');
        }
        const items = rows.map((v) => {
            const path = (v.path && v.path.length ? v.path : String(v.key || '').split('/').filter(Boolean)).join(' › ');
            const marks = [];
            if (v.count !== null) marks.push(v.count + ' 次');
            if (v.firstFloor !== null && v.lastFloor !== null) {
                marks.push(v.firstFloor === v.lastFloor ? '第' + v.lastFloor + '楼' : '第' + v.firstFloor + '–' + v.lastFloor + '楼');
            }
            return [
                '<div class="pl-visit">',
                '  <span class="pl-visit-place">' + this._esc(path) + '</span>',
                '  <span class="pl-visit-mark">' + this._esc(marks.join(' · '))
                + (v.registered ? '' : '<b class="pl-visit-bad">未登记</b>') + '</span>',
                '</div>'
            ].join('\n');
        }).join('');
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">到访史<span class="pl-count">' + rows.length + ' 处</span></div>',
            '  ' + items,
            '</div>'
        ].join('\n');
    }

    _presenceCard(proj, face) {
        const groups = (proj && proj.presence) || [];
        if (!groups.length) {
            return [
                '<div class="pl-card">',
                '  <div class="pl-card-title">谁在这个地方</div>',
                '  <div class="pl-empty">' + this._esc(face.reason === 'ready' ? '此刻没有登记在场地的人' : '读不到在场名单') + '</div>',
                '</div>'
            ].join('\n');
        }
        const items = groups.map((g) => {
            const path = String(g.key || '').split('/').filter(Boolean);
            const at = (g.atFloor === null || g.atFloor === undefined) ? '' : '第' + g.atFloor + '楼';
            return [
                '<div class="pl-group">',
                '  <div class="pl-group-head"><span class="pl-group-place">'
                + this._esc(path.length ? path.join(' › ') : g.key) + '</span>'
                + (at ? '<span class="pl-group-floor">' + this._esc(at) + '</span>' : '') + '</div>',
                '  <div class="pl-group-members">' + g.members.map((m) => '<span class="pl-member">' + this._esc(m) + '</span>').join('') + '</div>',
                '</div>'
            ].join('\n');
        }).join('');
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">谁在这个地方<span class="pl-count">' + groups.length + ' 处</span></div>',
            '  ' + items,
            '</div>'
        ].join('\n');
    }

    /**
     * [v3.4.3 · F-3] 同楼同刻（≥2 在场）三态卡。
     *
     * ★ 只呈现**事实**：这一层楼、这一处地点，此刻有这几个人在。
     *   本卡**不写**「冲突」「对峙」「碰面风险」这类判断词 ——
     *   账本能回答「两人都在钟楼」，不能回答「他们会不会打起来」；
     *   在这里加一句判断就是把猜测渲染成事实（本仓最贵的那类错读数）。
     *
     * 三态（与层级 / 到访史 / 场景头同口径：缺格要等上游升级，空格要用户去补，处置相反）：
     *   · 上游这版没这面 ⇒ 明说「需插件 v3.232 或更新」；
     *   · 有面但零行 ⇒ 「此刻没有同楼同刻（≥2 人在同一处）」；
     *   · 有面且有 ⇒ 逐条列出。
     */
    _coPresenceCard(proj, face) {
        const rows = (proj && proj.coPresence) || [];
        const hasFace = !!(proj && proj.hasCoPresenceFace);
        if (!hasFace) {
            return [
                '<div class="pl-card">',
                '  <div class="pl-card-title">同楼同刻</div>',
                '  <div class="pl-empty">' + this._esc('上游这版没有同楼同刻面（需插件 v3.232 或更新）') + '</div>',
                '</div>'
            ].join('\n');
        }
        if (!rows.length) {
            const meta = (proj && proj.coPresenceFace) || {};
            const extra = [];
            if (meta.totalPresent !== null && meta.totalPresent !== undefined) extra.push('在场共 ' + meta.totalPresent + ' 人');
            if (meta.skippedUnknownFloor) extra.push('其中 ' + meta.skippedUnknownFloor + ' 人未记楼层');
            return [
                '<div class="pl-card">',
                '  <div class="pl-card-title">同楼同刻</div>',
                '  <div class="pl-empty">' + this._esc('此刻没有同楼同刻（同一处地点 ≥2 人）'
                    + (extra.length ? '（' + extra.join(' · ') + '）' : '')) + '</div>',
                '</div>'
            ].join('\n');
        }
        const items = rows.map((r) => {
            const path = (r.path && r.path.length ? r.path : String(r.key || '').split('/').filter(Boolean)).join(' › ');
            const at = (r.floor === null || r.floor === undefined) ? '' : '第' + r.floor + '楼';
            return [
                '<div class="pl-group">',
                '  <div class="pl-group-head"><span class="pl-group-place">' + this._esc(path || r.key) + '</span>'
                + (at ? '<span class="pl-group-floor">' + this._esc(at) + '</span>' : '') + '</div>',
                '  <div class="pl-group-members">' + r.names.map((m) => '<span class="pl-member">' + this._esc(m) + '</span>').join('') + '</div>',
                '</div>'
            ].join('\n');
        }).join('');
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">同楼同刻<span class="pl-count">' + rows.length + ' 处</span></div>',
            '  ' + items,
            '</div>'
        ].join('\n');
    }


    /**
     * [v4.43.0 · R5-X3] 多人行踪时间带与会面证据。
     *
     * 【与上一块的差别（两块必须并存，不能合并）】
     *   `_coPresenceCard`（同楼同刻）答的是「**此刻**哪处 ≥2 人」——它是**瞬时**读数；
     *   本卡答的是「**一段时间窗里**这几个人各自在哪几段有据在场、谁和谁**可能**共处过」。
     *   验收原文点名要治的是后者：**「两人相同场所在不同时间不显示已见面」**。
     *
     * 【三条纪律】
     *   ① 判定走 `app.presenceBand()`（控制器转交纯契约件）—— 本视图**不自己判**重叠；
     *   ② **未知区间不画连续线**：那一段如实标「未知」，不给任何连线；
     *   ③ **可能共处 ≠ 已见面**：没有互动证据时只说「可能共处」。
     */
    _presenceBandCard() {
        const names = Array.isArray(this._bandNames) ? this._bandNames : [];
        const face = (() => { try { return this.app.presenceBand?.(names, { evidenced: this._bandEvidenced === true }) || null; } catch (_e) { return null; } })();
        const line = face ? String(this.app.presenceBandLineOf?.(face) || '') : '行踪带：本版 App 未接线（不是「没有行踪」）';
        const rows = (face && Array.isArray(face.pairs)) ? face.pairs : [];
        const rowHtml = rows.length
            ? rows.map((p) => {
                /* ★ 显示文案取自读数口给的 `why`（契约件已把三态说清），
                 *   视图**不自己比状态字面量** —— 自己比就会在契约件改名时静默落空，
                 *   于是「判不了」被显示成「没有重叠」（两者处置相反）。 */
                const tag = String(p.why || '');
                const spans = (Array.isArray(p.pairs) ? p.pairs : []).map((x) => {
                    const fmt = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
                    return fmt(x.from) + '–' + fmt(x.to) + ' @ ' + String(x.place || '');
                }).join('；');
                return '<div class="pl-band-row">' + this._esc(String(p.aName || p.a) + ' × ' + String(p.bName || p.b))
                    + ' · ' + this._esc(tag) + (spans ? ' · ' + this._esc(spans) : '') + '</div>';
            }).join('')
            : '<div class="pl-empty">' + this._esc('还没有重叠片段（选两人以上再看）') + '</div>';
        const chips = names.map((n) => '<button class="pl-band-chip on" data-band-name="' + this._esc(n) + '">' + this._esc(n) + ' ×</button>').join('');
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">行踪时间带<span class="pl-count">' + names.length + ' 人</span></div>',
            '  <div class="pl-empty">' + this._esc(line) + '</div>',
            '  <div class="pl-band-chips">' + chips + '</div>',
            '  <div class="pl-band-actions"><button class="pl-band-ev" id="pl-band-evidenced">'
            + (this._bandEvidenced === true ? '已按「有互动证据」算（点一下改回）' : '只有互动证据才算见面（点一下改）') + '</button></div>',
            '  <div class="pl-hint">未知片段**不画连续线**；重叠但没有互动证据时只说「可能共处」，不认定见面。</div>',
            '  ' + rowHtml,
            '</div>'
        ].join('\n');
    }


    /**
     * 探索卡([v4.05.0 · R3-X9])。四块内容,按「先看再从」排:
     *   ① 清单分组读数(去过 / 可进入 / 待探索 / 未知);
     *   ② 清单行(点一行即选中,右侧「去这儿」);
     *   ③ 选中那一条的地点卡(内核给的线索行:这是哪儿 / 可能碰到谁 / 怎么走 / 往事与约定);
     *   ④ 一行收尾:提案只是提案(不移动角色、不编距离)。
     *
     * 【为什么把归因也摆出来】到访史读不到时,清单里每一行都是「未知」——
     *   若不写清「这版读不到 ≠ 你没去过」,用户会以为这个会话从来没去过任何地方。
     */
    _roamCard(proj, face) {
        const app = this.app;
        if (!app || typeof app.exploreFace !== 'function') return '';
        let show = true;
        try { show = app.getSettings().showRoam !== false; } catch (_e) { show = true; }
        if (!show) return '';
        const list = (() => { try { return app.exploreFace(); } catch (_e) { return null; } })();
        if (!list) return '';
        const rd = list.readings || {};
        const head = [
            '<div class="pl-card-title">去哪走走<span class="pl-count">'
            + this._esc(String(rd.visited ?? 0)) + ' 去过 · '
            + this._esc(String(rd.enterable ?? 0)) + ' 可进入 · '
            + this._esc(String(rd.toExplore ?? 0)) + ' 待探索'
            + (rd.unknown ? ' · ' + this._esc(String(rd.unknown)) + ' 未知' : '')
            + '</span></div>'
        ].join('');
        if (list.reason === 'no-nodes') {
            return '<div class="pl-card"><div class="pl-card-title">去哪走走</div>'
                + '<div class="pl-empty">' + this._esc(list.state === 'empty' ? '这个会话还没登记过场所 —— 剧情里出现地点后这里会长出可去的地方' : '读不到场所') + '</div></div>';
        }
        const items = (list.items || []);
        let max = 12;
        try { max = Math.max(1, Math.min(40, Number(app.getSettings().roamRows) || 12)); } catch (_e) { max = 12; }
        const rows = items.slice(0, max).map((it) => {
            const cls = 'pl-roam-row pl-roam-' + this._esc(it.state || 'unknown') + (it.isCurrent ? ' pl-roam-cur' : '');
            const marks = [];
            if (it.visits !== null && it.visits !== undefined && it.visits > 0) marks.push(it.visits + ' 次');
            if (it.lastFloor !== null && it.lastFloor !== undefined) marks.push('第' + it.lastFloor + '楼');
            if (it.orphan) marks.push('树里没这处');
            return [
                '<div class="' + cls + '">',
                '  <button class="pl-roam-pick" data-key="' + this._esc(it.key) + '">',
                '    <span class="pl-roam-name">' + this._esc(it.name || it.key) + '</span>',
                '    <span class="pl-roam-state">' + this._esc(it.stateText || it.state || '') + '</span>',
                (marks.length ? '    <span class="pl-roam-mark">' + this._esc(marks.join(' · ')) + '</span>' : ''),
                '  </button>',
                '  <button class="pl-roam-go" data-go="' + this._esc(it.key) + '" title="生成出行提案并放进聊天输入框">去这儿</button>',
                '</div>'
            ].join('\n');
        }).join('');
        const more = items.length > max
            ? '<div class="pl-empty">还有 ' + (items.length - max) + ' 处没显示(想多看几处可在设置里把行数调大)</div>' : '';
        const note = rd.hasVisitFace === false
            ? '<div class="pl-empty">' + this._esc('到访史这版读不到:上面每一处都只能标「未知」,不等于没去过') + '</div>' : '';
        return [
            '<div class="pl-card pl-roam">',
            '  ' + head,
            '  ' + note,
            '  ' + (rows || '<div class="pl-empty">这一刻没有可去的地方</div>'),
            '  ' + more,
            '  <div class="pl-roam-detail" id="pl-roam-detail"></div>',
            '  <div class="pl-empty">选一处再点「去这儿」:本机只把提案放进聊天输入框,不替你移动角色,也不编距离与耗时。</div>',
            '</div>'
        ].join('\n');
    }
    /**
     * 详情区:把某一处的地点卡铺出来(选中的那一刻)。
     * 三态如实:提案拿不到(认不出这处)⇒ 明说认不出;拿得到 ⇒ 逐行铺内核给的线索。
     * **本方法不发任何写动作**:「去这儿」的落点由 app.sendProposalToChat 负责。
     */
    /**
     * 街区机会卡（[v4.97.0 · R11-O3 第三批]）。与探索卡分工：前者答「能去哪」，
     *   本卡答「去了有什么可参与」—— 每处地点按当前日期/时段判营业，再列出
     *   可参与的事件机会（`active` 可参加 / `already-attended` 已参加过 /
     *   `missed` 错过不伪造已到场）。到访记录升级地点熟悉度（内核判，本件落盘）。
     * 【归因优先】台账读不到与「还没登记过」分两句，不混成「没有地点」。
     */
    _districtCard() {
        const app = this.app;
        if (!app || typeof app.districtFace !== 'function') return '';
        let show = true;
        try { show = app.getSettings().showDistrict !== false; } catch (_e) { show = true; }
        if (!show) return '';
        let face;
        try { face = app.districtFace(); } catch (_e) { return ''; }
        if (!face) return '';
        const head = '<div class="pl-card-title">街区机会<span class="pl-count">'
            + this._esc(String(face.line || '')) + '</span></div>';
        if (!face.ok || !face.rows.length) {
            return '<div class="pl-card"><div class="pl-card-title">街区机会</div>'
                + '<div class="pl-empty">' + this._esc(face.line || '街区台账读不到') + '</div>'
                + '<button class="pl-btn" id="pl-district-add">登记一处地点</button>'
                + '<div id="pl-district-form" style="display:none">'
                + '<input class="pl-in" id="pl-d-id" placeholder="地点 ID（如 coffee-shop）">'
                + '<input class="pl-in" id="pl-d-name" placeholder="地点名称（如 街角咖啡馆）">'
                + '<input class="pl-in" id="pl-d-days" placeholder="营业日（逗号分隔，如 周一,周三）">'
                + '<input class="pl-in" id="pl-d-slots" placeholder="时段标签（逗号分隔，如 上午,下午,晚上）">'
                + '<input class="pl-in" id="pl-d-ev" placeholder="可参与事件（格式：ID:标签，逗号分隔）">'
                + '<button class="pl-btn" id="pl-district-save">登记</button>'
                + '</div></div>';
        }
        const rows = face.rows.map((r) => {
            const st = String(r.status || 'missed');
            const stText = st === 'active' ? '可参加' : (st === 'already-attended' ? '已参加' : '已错过');
            const stCls = st === 'active' ? 'pl-district-active' : (st === 'already-attended' ? 'pl-district-done' : 'pl-district-missed');
            return [
                '<div class="pl-district-row ' + stCls + '">',
                '  <span class="pl-district-place">' + this._esc(r.placeName) + '</span>',
                '  <span class="pl-district-ev">' + this._esc(r.label) + '</span>',
                '  <span class="pl-district-st">' + stText + '</span>',
                (st === 'active'
                    ? '  <button class="pl-district-go" data-pid="' + this._esc(r.placeId) + '" data-eid="' + this._esc(r.id) + '">记录到访</button>'
                    : ''),
                '</div>'
            ].join('\n');
        }).join('');
        return [
            '<div class="pl-card pl-district">',
            '  ' + head,
            '  ' + rows,
            '  <button class="pl-btn" id="pl-district-add">登记一处地点</button>',
            '  <div id="pl-district-form" style="display:none">',
            '    <input class="pl-in" id="pl-d-id" placeholder="地点 ID（如 coffee-shop）">',
            '    <input class="pl-in" id="pl-d-name" placeholder="地点名称（如 街角咖啡馆）">',
            '    <input class="pl-in" id="pl-d-days" placeholder="营业日（逗号分隔，如 周一,周三）">',
            '    <input class="pl-in" id="pl-d-slots" placeholder="时段标签（逗号分隔，如 上午,下午,晚上）">',
            '    <input class="pl-in" id="pl-d-ev" placeholder="可参与事件（格式：ID:标签，多条逗号分隔，如 e1:常客闲聊,e2:老板拼桌）">',
            '    <button class="pl-btn" id="pl-district-save">登记</button>',
            '  </div>',
            '</div>'
        ].join('\n');
    }
    _showRoamDetail(key) {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const box = (() => { try { return el.querySelector('#pl-roam-detail'); } catch (_e) { return null; } })();
        if (!box || !key) return;
        const p = (() => { try { return this.app.proposalOf(key); } catch (_e) { return null; } })();
        if (!p || !p.ok) {
            const why = (p && p.reason) || 'read-failed';
            box.innerHTML = '<div class="pl-empty">' + this._esc(
                why === 'place-unknown' ? '路账里没有登记过这个地方(不猜一个近的顶替)'
                    : (why === 'target-missing' ? '没选地方' : '这一刻读不到这一处')
            ) + '</div>';
            return;
        }
        const lines = (p.lines || []).map((x) => '<div class="pl-roam-line">' + this._esc(x) + '</div>').join('');
        box.innerHTML = '<div class="pl-roam-card">' + lines
            + '<div class="pl-roam-line pl-roam-reg">' + this._esc(p.registerLine || '') + '</div></div>';
    }
    _settingsCard() {
        let s = {};
        try { s = this.app.getSettings(); } catch (_e) { s = {}; }
        return [
            '<div class="pl-card">',
            '  <div class="pl-card-title">设置</div>',
            '  <div class="pl-row"><span class="pl-label">注入到生成（让正文地点与记忆一致）</span>',
            '    <button class="pl-switch ' + (s.injectToPrompt ? 'on' : '') + '" id="pl-inject">' + (s.injectToPrompt ? '开' : '关') + '</button></div>',
            '  <div class="pl-row"><span class="pl-label">最多注入 ' + this._esc(s.maxInject) + ' 行</span>',
            '    <input type="range" class="pl-range" id="pl-maxInject" min="1" max="20" value="' + this._esc(s.maxInject) + '"></div>',
            '  <div class="pl-row"><span class="pl-label">显示覆盖度与不变量诊断</span>',
            '    <button class="pl-switch ' + (s.showDiagnostics ? 'on' : '') + '" id="pl-diag">' + (s.showDiagnostics ? '开' : '关') + '</button></div>',
            /* [v4.05.0 · R3-X9] 探索卡两个开关。关掉只是**少摆一块界面**:
             *   场所层级 / 到访史 / 在场全部照旧(它们是既有读数面,与本版的新块无关)。 */
            '  <div class="pl-row"><span class="pl-label">显示探索清单(去哪走走)</span>',
            '    <button class="pl-switch ' + (s.showRoam ? 'on' : '') + '" id="pl-roam">' + (s.showRoam ? '开' : '关') + '</button></div>',
            '  <div class="pl-row"><span class="pl-label">清单最多显示 ' + this._esc(s.roamRows) + ' 处</span>',
            '    <input type="range" class="pl-range" id="pl-roamRows" min="1" max="40" value="' + this._esc(s.roamRows) + '"></div>',
            '</div>'
        ].join('\n');
    }

    _diagCards(proj) {
        const cov = (proj && proj.coverage) || { head: '', steps: [], unregistered: [], headers: '' };
        const iv = (proj && proj.invariants) || { state: 'absent', text: '', broken: [], warnings: [] };
        const stateCls = iv.state === 'ok' ? 'ok' : (iv.state === 'broken' ? 'bad' : 'warn');
        // [v3.2.0] R3-D：场景头覆盖度一行。上游没这面 ⇒ 明说「需 v3.221+」；
        //   有面但不为 0 / 有数 ⇒ 列号行（含 0）。两种相反处境不同文案 ——
        //   「这版没有这个面」要等升级，「这个会话没有场景头」要去补。
        const hdrCov = (cov.headers
            ? '<div class="pl-diag-line">' + this._esc(cov.headers) + '</div>'
            : (proj && proj.hasHeaderFloorsFace === false
                ? '<div class="pl-diag-line pl-diag-warn">上游这版没有场景头覆盖度（需插件 v3.221 或更新）</div>'
                : '<div class="pl-diag-line">尚未登记任何楼层的场景头</div>'));
        const covLines = [
            '<div class="pl-diag-line">' + this._esc(cov.head) + '</div>',
            hdrCov,
            ...(cov.steps || []).map((x) => '<div class="pl-diag-line pl-diag-warn">' + this._esc(x) + '</div>'),
            ...(cov.unregistered || []).map((k) => '<div class="pl-diag-line pl-diag-warn">到访过但未登记：' + this._esc(k) + '</div>')
        ].join('\n');
        const ivLines = [
            '<div class="pl-diag-line">不变量：' + this._esc(iv.text) + '</div>',
            ...(iv.broken || []).map((x) => '<div class="pl-diag-line pl-diag-bad">' + this._esc(x) + '</div>'),
            ...(iv.warnings || []).map((x) => '<div class="pl-diag-line pl-diag-warn">' + this._esc(x) + '</div>')
        ].join('\n');
        return [
            '<div class="pl-card pl-diag">',
            '  <div class="pl-card-title">覆盖度</div>',
            '  ' + covLines,
            '</div>',
            '<div class="pl-card pl-diag pl-iv-' + stateCls + '">',
            '  <div class="pl-card-title">树的自检</div>',
            '  ' + ivLines,
            '</div>'
        ].join('\n');
    }

    _bind() {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const q = (sel) => { try { return el.querySelector(sel); } catch (_e) { return null; } };
        const win = (() => { try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; } })();

        q('#pl-home')?.addEventListener('click', () => {
            try { win.dispatchEvent(new win.CustomEvent('phone:goHome')); } catch (_e) { /* 宿主无事件：忽略 */ }
        });
        q('#pl-refresh')?.addEventListener('click', () => this._draw());
        /* [v4.43.0 · R5-X3] 行踪时间带的两个动作（容器级委托）：
         *   点在场的人名 ⇒ 加入/移出选择（**只在本会话**）；
         *   点「找可能共处」⇒ 带互动证据开关重算（开关默认关：无证据只说「可能共处」）。 */
        /* [v4.47.1] 容器级查询必须带能力探测：本层的历史契约是「容器只要有
         *   querySelector 就能渲染」，桩容器与只读宿主都不一定有 querySelectorAll
         *   （历史套件 v310/v311 的桩就只有 querySelector）。v4.43.0 这段曾裸调
         *   el.querySelectorAll ⇒ 在桩容器上抛 TypeError，把整张页连坐拖垮。
         *   收集面收成 bandBtns（保持 forEach 形态，回退路径为空数组）。 */
        const bandBtns = (() => {
            try { return (typeof el.querySelectorAll === 'function') ? Array.from(el.querySelectorAll('[data-band-name]') || []) : []; }
            catch (_e) { return []; }
        })();
        bandBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const name = String(btn.getAttribute('data-band-name') || '');
                if (!name) return;
                const cur = Array.isArray(this._bandNames) ? this._bandNames.slice() : [];
                const i = cur.indexOf(name);
                if (i >= 0) cur.splice(i, 1); else cur.push(name);
                this._bandNames = cur;
                this._draw();
            });
        });
        q('#pl-band-evidenced')?.addEventListener('click', () => {
            this._bandEvidenced = !this._bandEvidenced;
            this._draw();
        });
        q('#pl-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#pl-diag')?.addEventListener('click', () => {
            try { this.app.saveSettings({ showDiagnostics: !this.app.getSettings().showDiagnostics }); } catch (_e) {}
            this._draw();
        });
        q('#pl-roam')?.addEventListener('click', () => {
            try { this.app.saveSettings({ showRoam: !this.app.getSettings().showRoam }); } catch (_e) {}
            this._draw();
        });
        q('#pl-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 8));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
        q('#pl-roamRows')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(40, Number(e?.target?.value) || 12));
            try { this.app.saveSettings({ roamRows: v }); } catch (_e) {}
            this._draw();
        });
        /* [v4.05.0 · R3-X9] 清单点选:只把该处的地点卡铺进详情区,**不动任何状态**。
         * 必须走 qa(带能力探测):本层的历史契约是「容器只要有 querySelector 就能渲染」,
         * 桩容器与只读宿主都不一定有 querySelectorAll —— 直接调会抛,把整张页连坐拖垮。 */
        const qa = (sel) => {
            try {
                if (typeof el.querySelectorAll !== 'function') return [];
                return Array.from(el.querySelectorAll(sel) || []);
            } catch (_e) { return []; }
        };
        for (const btn of qa('.pl-roam-pick')) {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key') || '';
                this._showRoamDetail(key);
            });
        }
        /* 「去这儿」:把提案交给聊天(与扭蛋 / 塔罗同一条通道),**不移动角色**。 */
        for (const btn of qa('.pl-roam-go')) {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-go') || '';
try { this.app.sendProposalToChat(key); } catch (_e) {}
                this._showRoamDetail(key);
            });
        }
        /* [v4.97.0 · R11-O3 第三批] 街区机会卡的三组动作（全部容器级查询带能力探测）：
         *   ① 展开登记表单（不写任何状态，只翻 display）；
         *   ② 登记提交：表单拼参数走 app.registerDistrictPlace，失败把 reason 弹回表单；
         *   ③ 记录到访：按行上带的 placeId/eventId 走 app.recordDistrictVisit 后整页重画。 */
        q('#pl-district-add')?.addEventListener('click', () => {
            const f = q('#pl-district-form');
            if (f) f.style.display = (f.style.display === 'none') ? '' : 'none';
        });
        q('#pl-district-save')?.addEventListener('click', () => {
            const v = (id) => { try { return String((q(id) || {}).value || '').trim(); } catch (_e) { return ''; } };
            const days = v('#pl-d-days').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            const slotLabels = v('#pl-d-slots').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            const timeWindows = days.map((day) => ({
                day,
                slots: slotLabels.map((label) => ({ start: label, end: label, label }))
            }));
            const events = v('#pl-d-ev').split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((pair) => {
                const i = pair.indexOf(':');
                return { id: i >= 0 ? pair.slice(0, i) : pair, label: i >= 0 ? pair.slice(i + 1) : pair };
            });
            let r;
            try { r = this.app.registerDistrictPlace(v('#pl-d-id'), v('#pl-d-name'), timeWindows, []); }
            catch (_e) { r = { ok: false, reason: 'threw' }; }
            if (!r || !r.ok) {
                try { if (q('#pl-d-id')) q('#pl-d-id').placeholder = '登记失败：' + ((r && r.reason) || '未知'); } catch (_e) {}
                return;
            }
            try { this.app.saveSettings({ districtEvents: [].concat(this.app.getSettings().districtEvents || [], events) }); } catch (_e) {}
            this._draw();
        });
        for (const btn of qa('.pl-district-go')) {
            btn.addEventListener('click', () => {
                const pid = btn.getAttribute('data-pid') || '';
                const eid = btn.getAttribute('data-eid') || '';
                try { this.app.recordDistrictVisit(pid, eid, []); } catch (_e) {}
                this._draw();
            });
        }
    }
}

export default PlaceView;