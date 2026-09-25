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
        q('#pl-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#pl-diag')?.addEventListener('click', () => {
            try { this.app.saveSettings({ showDiagnostics: !this.app.getSettings().showDiagnostics }); } catch (_e) {}
            this._draw();
        });
        q('#pl-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 8));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
    }
}

export default PlaceView;