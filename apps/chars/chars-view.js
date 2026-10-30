/* ========================================================
 * chars-view.js — [v2.51.0] 群像视图
 *
 * 【这一面存在的理由】上游记忆插件把「角色状态表」外供到只读桥快照上，
 *   而手机端此前零消费——于是「当前世界有哪些被追踪的角色、各自什么状态」
 *   在手机上完全答不出。本视图把角色卡片列表摆出来（字段 / 待办 / 楼层），
 *   并把**读不到的原因**一并摆出来（五态归因），而不是显示一个
 *   和「世界是空的」同形的空列表。
 *
 * 只读：数据全部来自 this.app.projection()（内部只读桥，不写任何状态）。
 * 结构：_esc + _draw + _bind（与 wallet-view 同风格）。
 * ============================================================ */
'use strict';
export class CharsView {
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
    /* [v4.99.2 · R11-X1] 首次渲染档案面前先读回存档一次（幂等：restore 用
     * 落盘数据覆盖内存实例，无存档时保持空态、不报错）。 */
    _archiveHydrated = false;
    _ensureArchiveHydrated() {
        if (this._archiveHydrated) return;
        try { this.app._archiveRestoreAll?.(); } catch (_e) { /* 读回失败保持空态 */ }
        this._archiveHydrated = true;
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
        const face = (pkg && pkg.face) || { reason: 'bridge-absent', text: '群像不可读', state: 'absent' };
        const proj = (pkg && pkg.proj) || { roles: [], count: 0 };
        const src = (pkg && pkg.src) || null;
        this._ensureArchiveHydrated();
        let archive = null;
        try { archive = this.app.archiveFace(); } catch (_e) { archive = null; }
        const html = [
            '<div class="cs-root">',
            '  <header class="cs-header">',
            '    <button class="cs-nav" id="cs-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>群像</h2>',
            '    <button class="cs-nav" id="cs-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="cs-body">',
            this._reasonCard(face),
            this._sourceCard(src),
            this._rolesCard(face, proj),
            this._archiveCard(archive),
            this._perspectiveCard(),
            this._settingsCard(),
            '  </div>',
            '</div>'
        ].join('\n');
        try { this.container.innerHTML = html; } catch (_e) { /* 宿主容器不可用：不抛 */ }
        this._bind();
    }
    /** 归因卡：读不到时**先说读不到**（五态分开），不与「世界是空的」同形 */
    _reasonCard(face) {
        const tone = face.reason === 'ready' ? 'ok' : (face.reason === 'empty' ? 'warn' : 'off');
        const hint = {
            'ready': '角色状态由记忆插件的角色状态表提供（只读）；与「档案」互补——档案看主角，群像看被追踪的其他角色。',
            'empty': '这个会话还没有被追踪的角色——剧情里出现带状态的角色后会自动长出来。',
            'no-chars-face': '记忆插件在，但这一版快照没有角色状态表：需要插件较新版本。',
            'no-snapshot': '桥已装好，但还没有产出过快照：等一次生成（或先聊一楼）即可。',
            'bridge-absent': '未检测到 LonSha 记忆插件；装上后本页自动可用。'
        }[face.reason] || '未知归因（如实显示原值，不吞）';
        return [
            '<div class="cs-card cs-reason cs-reason-' + tone + '">',
            '  <div class="cs-reason-head">' + this._esc(face.text || face.reason) + '</div>',
            '  <div class="cs-reason-hint">' + this._esc(hint) + '</div>',
            '</div>'
        ].join('\n');
    }
    /** 来源卡（[v3.0.1]）：把「这份读数是哪一次的」贴出来（投影契约的归属面）。
     *  与归因卡分工：归因卡说「读不读得到」，本卡说「读到的那份是谁的」（可同时成立：
     *  例如「角色状态表读到了，但那份读数已过期 / 未绑定会话」）。 */
    _sourceCard(src) {
        if (!src) return '';
        const tone = src.usable === true ? (src.stale === true ? 'warn' : 'ok') : 'off';
        return [
            '<div class="cs-card cs-src cs-src-' + tone + '">',
            '  <div class="cs-card-title">数据来源</div>',
            '  <div class="cs-src-line">' + this._esc(src.line) + '</div>',
            '</div>'
        ].join('\n');
    }
    _rolesCard(face, proj) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="cs-empty">' + this._esc(face.reason === 'empty' ? '还没有被追踪的角色（角色状态会随剧情自动积累）' : '读不到角色状态') + '</div>';
        } else if (!proj.roles.length) {
            body = '<div class="cs-empty">还没有任何被追踪的角色</div>';
        } else {
            const rows = proj.roles.map((r) => {
                const fieldChips = r.fields.slice(0, 6).map((f) => [
                    '<span class="cs-chip">' + this._esc(f.key) + ': ' + this._esc(this._fmtVal(f.value)) + '</span>'
                ].join('')).join('');
                const todoItems = r.todos.slice(0, 3).map((t) => [
                    '<div class="cs-todo">' + this._esc(t.text) + (t.date ? ' <span class="cs-todo-date">' + this._esc(t.date) + '</span>' : '') + '</div>'
                ].join('')).join('');
                return [
                    '<div class="cs-role">',
                    '  <div class="cs-role-head">',
                    '    <span class="cs-role-name">' + this._esc(r.name) + '</span>',
                    '    <span class="cs-role-floor">' + (r.floor !== null ? '第' + r.floor + '楼' : '无楼层') + '</span>',
                    '  </div>',
                    (fieldChips ? '  <div class="cs-chips">' + fieldChips + '</div>' : ''),
                    (todoItems ? '  <div class="cs-todos">' + todoItems + '</div>' : ''),
                    (r.fields.length > 6 ? '  <div class="cs-more">仅显示前 6 个字段（共 ' + r.fields.length + '）</div>' : ''),
                    '</div>'
                ].filter(Boolean).join('\n');
            });
            body = rows.join('\n');
        }
        return [
            '<div class="cs-card">',
            '  <div class="cs-card-title">被追踪的角色<span class="cs-count">' + (ready ? proj.count + ' 个' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    /* ══════════ [v4.26.0 · R4-X5] 角色信息差与证词对照 ══════════
     * 【这一面存在的理由（修前实测）】上游视角卡面(v3.323.0)与证词面(v3.343.0)早已交付，
     *   而手机侧此前**零消费**（chars/ 下 grep 'perspective' 零命中）：写群像 / 悬疑时
     *   作者看不到「甲亲历、乙听说、丙误信」的**并排**对照，也看不出「同一事件的多种说法」
     *   为何暂不能下结论（未裁决三档被压成一个布尔）。
     * 【本面只摆读数，不做判定】文案全走 App 内核转发（视图不自拼归因、不自己数计数）。
     * 【作者 / 角色模式与身份视图都是**显式选择**】默认作者 + 未揭穿；切换只改呈现、不改账。 */
    _perspectiveCard() {
        /* 选项清单**从内核取**（不在这里再写一份 'author'/'character'/'surface' 字面量）：
         *   视图只负责把内核给的 id 配上人读标签 —— 判定与取值清单全在内核。 */
        const MODE_LABEL = { author: '作者（全知）', character: '角色（可知面）' };
        const FACE_LABEL = { surface: '未揭穿', revealed: '已揭穿', all: '全呈' };
        let modeIds = Object.keys(MODE_LABEL);
        let faceIds = Object.keys(FACE_LABEL);
        let curMode = { ok: true, mode: '', text: '' };
        let face = '';
        let cur = '';
        /* 版式兜底：**不写任何版式字面量** —— 版式判定只许内核一份实现（layoutOf）；
         *   视图读不到时只给空文案，由内核按「宽度读不出 ⇒ 窄屏」保守处置。 */
        let layout = { layout: '', text: '' };
        try {
            modeIds = this.app.perspectiveModeIds();
            faceIds = this.app.perspectiveFaceIds();
            curMode = this.app.perspectiveMode();
            face = this.app.perspectiveFace();
            cur = this.app.perspectiveCurrent();
            layout = this.app.perspectiveLayout(this._width());
        } catch (_e) { /* 读数失败：按上面兜底的空清单呈现（不抛、不猜） */ }
        const modeBtn = (id, label, active) =>
            '<button class="cs-seg ' + (active ? 'on' : '') + '" data-px-mode="' + id + '">' + this._esc(label) + '</button>';
        const faceBtn = (id, label, active) =>
            '<button class="cs-seg ' + (active ? 'on' : '') + '" data-px-face="' + id + '">' + this._esc(label) + '</button>';
        /* 模式非法：如实报错、**不猜一个默认**（那是把「用户选错了」显示成「用户选了作者」）。 */
        const invalid = curMode.ok ? '' :
            '<div class="cs-px-note cs-px-warn">' + this._esc(curMode.text || '模式取值非法') + '</div>';
        return [
            '<div class="cs-card cs-px">',
            '  <div class="cs-card-title">信息差与证词对照<span class="cs-count">' + this._esc(layout.text || '') + '</span></div>',
            invalid,
            '  <div class="cs-px-row"><span class="cs-label">视角模式</span>',
            '    <span class="cs-seg-group">' + modeIds.map((id) => modeBtn(id, MODE_LABEL[id] || id, curMode.mode === id)).join('') + '</span></div>',
            '  <div class="cs-px-row"><span class="cs-label">身份视图</span>',
            '    <span class="cs-seg-group">' + faceIds.map((id) => faceBtn(id, FACE_LABEL[id] || id, face === id)).join('') + '</span></div>',
            '  <div class="cs-px-row"><span class="cs-label">当前角色（角色模式的主体）</span>',
            '    <input class="cs-input" id="cs-px-cur" maxlength="40" value="' + this._esc(cur) + '" placeholder="未选（角色模式下必填）"></div>',
            '  <div class="cs-px-hint">' + this._esc('角色模式只写当前角色**可知**的内容：对方独有的事实一条都不进生成上下文（切换模式不改变任何账）。') + '</div>',
            '</div>'
        ].join('\n');
    }
    /** 可用宽度（读不出返回 null ⇒ 内核按**窄屏**保守处置，不按 0 猜）。 */
    _width() {
        try {
            const el = this.container;
            const w = el && typeof el.clientWidth === 'number' ? el.clientWidth : NaN;
            if (Number.isFinite(w) && w > 0) return w;
            const win = (typeof window !== 'undefined') ? window : null;
            const iw = win && win.innerWidth;
            return (Number.isFinite(iw) && iw > 0) ? iw : null;
        } catch (_e) { return null; }
    }
    /** 字段值可读化（与内核 fmtFieldVal 同口径，视图独立不引内核私有函数） */
    /* ══════════ [v4.99.2 · R11-X1] 人物档案面（背包 / 档案 / 卷宗） ══════════
     * 【三态不同形】readable（数组）= 正常 / 空数组 = 「还没有」（与读不到不同形）/
     *   null = 「读不到」（明写警示，不许静默显示为空）。
     * 【操作点】背包三键（录入 / 转赠 / 消耗或遗失）、档案两键（登记 / 标注偏移）——
     *   判定与数据全走 app 写口（本视图只搬不判）。 */
    _archiveCard(archive) {
        if (!archive) {
            return [
                '<div class="cs-card cs-archive cs-archive-off">',
                '  <div class="cs-card-title">档案（背包 · 人物 · 卷宗）</div>',
                '  <div class="cs-empty cs-arch-warn">档案面读不到 —— 这是「读不到」，不是「还没有」。</div>',
                '</div>'
            ].join('\n');
        }
        const notes = archive.notes || {};
        const counts = archive.counts || {};
        const f = archive.faces || { backpack: null, dossiers: null, volumes: null };
        const parts = [];
        parts.push(this._archiveBackpackBlock(f.backpack));
        parts.push(this._archiveDossierBlock(f.dossiers));
        parts.push(this._archiveVolumeBlock(f.volumes, counts.volumeStats));
        return [
            '<div class="cs-card cs-archive">',
            '  <div class="cs-card-title">档案（背包 · 人物 · 卷宗）' +
                (notes.mustShowWhy
                    ? '<span class="cs-count cs-arch-warn">部分读不到（' + this._esc(notes.why || '') + '）</span>'
                    : '') + '</div>',
            parts.filter(Boolean).join('\n'),
            '  <div class="cs-arch-actions">',
            '    <input class="cs-input cs-arch-item-name" id="cs-arch-item-name" maxlength="40" placeholder="物品名（录入背包）">',
            '    <button class="cs-seg" id="cs-arch-add">录入</button>',
            '    <input class="cs-input cs-arch-char-name" id="cs-arch-char-name" maxlength="40" placeholder="角色名（登记档案）">',
            '    <button class="cs-seg" id="cs-arch-dossier">登记档案</button>',
            '  </div>',
            '  <div class="cs-arch-note" id="cs-arch-note"></div>',
            '</div>'
        ].join('\n');
    }
    _archiveBackpackBlock(rows) {
        if (rows === null) {
            return '<div class="cs-arch-block"><div class="cs-arch-head">背包</div><div class="cs-empty cs-arch-warn">读不到（这是「读不到」，不是「没有物品」）</div></div>';
        }
        if (!rows.length) {
            return '<div class="cs-arch-block"><div class="cs-arch-head">背包</div><div class="cs-empty">还没有录入物品（剧情道具 / 纪念品可手动录入）</div></div>';
        }
        const items = rows.slice(0, 12).map((r) => [
            '      <div class="cs-arch-item">',
            '        <span class="cs-role-name">' + this._esc(r.name) + '</span>',
            '        <span class="cs-chip">' + this._esc(r.status) + '</span>',
            '        <span class="cs-role-floor">' + this._esc(r.source) + '</span>',
            '        <button class="cs-seg cs-arch-xfer" data-xfer="' + this._esc(r.id) + '">转赠</button>',
            '        <button class="cs-seg cs-arch-consume" data-consume="' + this._esc(r.id) + '">消耗</button>',
            '      </div>'
        ].join('')).join('\n');
        return [
            '  <div class="cs-arch-block">',
            '    <div class="cs-arch-head">背包<span class="cs-count">' + rows.length + ' 件（持有 ' + rows.filter((r) => r.status === 'held').length + '）</span></div>',
            items,
            (rows.length > 12 ? '    <div class="cs-more">仅显示前 12 件（共 ' + rows.length + '）</div>' : ''),
            '  </div>'
        ].filter(Boolean).join('\n');
    }
    _archiveDossierBlock(rows) {
        if (rows === null) {
            return '<div class="cs-arch-block"><div class="cs-arch-head">人物档案</div><div class="cs-empty cs-arch-warn">读不到（这是「读不到」，不是「没有档案」）</div></div>';
        }
        if (!rows.length) {
            return '<div class="cs-arch-block"><div class="cs-arch-head">人物档案</div><div class="cs-empty">还没有登记的档案（录入角色名即可开档）</div></div>';
        }
        const items = rows.slice(0, 12).map((r) => [
            '      <div class="cs-arch-item">',
            '        <span class="cs-role-name">' + this._esc(r.name) + '</span>',
            '        <span class="cs-chip">' + this._esc(r.formattedAttitudeText) + '</span>',
            (r.hasShift ? '<span class="cs-chip">' + this._esc(r.shiftSummary) + '</span>' : ''),
            '        <button class="cs-seg cs-arch-shift" data-shift="' + this._esc(r.name) + '">标注偏移</button>',
            '        <button class="cs-seg cs-arch-detail" data-detail="' + this._esc(r.name) + '">详情</button>',
            '      </div>'
        ].filter(Boolean).join('')).join('\n');
        return [
            '  <div class="cs-arch-block">',
            '    <div class="cs-arch-head">人物档案<span class="cs-count">' + rows.length + ' 份</span></div>',
            items,
            (rows.length > 12 ? '    <div class="cs-more">仅显示前 12 份（共 ' + rows.length + '）</div>' : ''),
            '  </div>'
        ].filter(Boolean).join('\n');
    }
    _archiveVolumeBlock(rows, stats) {
        if (rows === null) {
            return '<div class="cs-arch-block"><div class="cs-arch-head">卷宗</div><div class="cs-empty cs-arch-warn">读不到（这是「读不到」，不是「没有卷」）</div></div>';
        }
        if (!rows.length) {
            return '<div class="cs-arch-block"><div class="cs-arch-head">卷宗</div><div class="cs-empty">还没有封存的卷宗（长线剧情分卷后在此回顾）</div></div>';
        }
        const items = rows.slice(0, 8).map((r) => [
            '      <div class="cs-arch-item">',
            '        <span class="cs-chip">VOL.' + String(r.index).padStart(2, '0') + '</span>',
            '        <span class="cs-role-name">' + this._esc(r.title) + '</span>',
            '        <span class="cs-role-floor">' + this._esc(r.timeRange) + '</span>',
            '        <span class="cs-chip">' + r.entryCount + '条 · ' + r.majorEventCount + '转折</span>',
            '        <button class="cs-seg cs-arch-vol" data-vol="' + Number(r.index) + '">回顾</button>',
            '      </div>'
        ].join('')).join('\n');
        const statsLine = stats
            ? ' · 累计 ' + stats.totalEntriesArchived + ' 条 / ' + stats.totalMajorEvents + ' 次重大转折'
            : '';
        return [
            '  <div class="cs-arch-block">',
            '    <div class="cs-arch-head">卷宗<span class="cs-count">' + rows.length + ' 卷' + statsLine + '</span></div>',
            items,
            (rows.length > 8 ? '    <div class="cs-more">仅显示前 8 卷（共 ' + rows.length + '）</div>' : ''),
            '  </div>'
        ].filter(Boolean).join('\n');
    }
    /** 档案操作归因一行（操作成功 / 失败都如实写出来，不吞） */
    _archNote(el, text, warn) {
        if (!el) return;
        try {
            el.textContent = text;
            el.className = 'cs-arch-note' + (warn ? ' cs-arch-warn' : '');
        } catch (_e) { /* 宿主节点不可用：不抛 */ }
    }
    _fmtVal(v) {
        if (v === null || v === undefined) return '未记';
        if (typeof v === 'boolean') return v ? '开' : '关';
        if (typeof v === 'number') return String(v);
        const s = String(v).replace(/\s+/g, ' ').trim();
        return s.length > 32 ? s.slice(0, 32) + '…' : s;
    }
    _settingsCard() {
        let s = {};
        try { s = this.app.getSettings(); } catch (_e) { s = {}; }
        return [
            '<div class="cs-card">',
            '  <div class="cs-card-title">设置</div>',
            '  <div class="cs-row"><span class="cs-label">注入到生成（让正文角色状态与状态表一致）</span>',
            '    <button class="cs-switch ' + (s.injectToPrompt ? 'on' : '') + '" id="cs-inject">' + (s.injectToPrompt ? '开' : '关') + '</button></div>',
            '  <div class="cs-row"><span class="cs-label">最多注入 ' + this._esc(s.maxInject) + ' 个角色</span>',
            '    <input type="range" class="cs-range" id="cs-maxInject" min="1" max="15" value="' + this._esc(s.maxInject) + '"></div>',
            '</div>'
        ].join('\n');
    }
    _bind() {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const q = (sel) => { try { return el.querySelector(sel); } catch (_e) { return null; } };
        const win = (() => { try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; } })();
        q('#cs-home')?.addEventListener('click', () => {
            try { win.dispatchEvent(new win.CustomEvent('phone:goHome')); } catch (_e) { /* 宿主无此事件：忽略 */ }
        });
        q('#cs-refresh')?.addEventListener('click', () => this._draw());
        q('#cs-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#cs-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(15, Number(e?.target?.value) || 5));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
        /* [v4.26.0 · R4-X5] 视角模式 / 身份视图 / 当前角色（**显式选择**；切换只改呈现）。 */
        /* ★ 循环变量**不得**叫 el：与外层 `const el` 同名会让整个循环头落在 TDZ 里
         *   （首版就是这么写的，`Cannot access 'el' before initialization` ⇒
         *    三处绑定永远不生效：点了没反应、也不报错到界面上）。 */
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-px-mode]') : [])) {
            btn.addEventListener('click', () => {
                try { this.app.setPerspectiveMode(btn.getAttribute('data-px-mode')); } catch (_e) {}
                this._draw();
            });
        }
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-px-face]') : [])) {
            btn.addEventListener('click', () => {
                try { this.app.setPerspectiveFace(btn.getAttribute('data-px-face')); } catch (_e) {}
                this._draw();
            });
        }
        q('#cs-px-cur')?.addEventListener('change', (e) => {
            try { this.app.setPerspectiveCurrent(e?.target?.value); } catch (_e) {}
            this._draw();
        });
        /* ══════════ [v4.99.2 · R11-X1] 档案面操作点绑定 ══════════
         * 【骨架】录入 / 登记档案 / 转赠 / 消耗 / 标注偏移 / 卷宗回顾。
         * 【纪律】视图只搬参数不做判定：成功失败都从 app 写口转回来、
         *   归因写进 #cs-arch-note 一行（_archNote），不吞、不猜、不静默。 */
        const archNote = q('#cs-arch-note');
        const after = (fn) => {
            try { fn(); } catch (e) {
                this._archNote(archNote, '操作失败：' + (e && e.message ? e.message : '未知错误'), true);
                return;
            }
            this._draw();
        };
        q('#cs-arch-add')?.addEventListener('click', () => after(() => {
            const name = (q('#cs-arch-item-name')?.value || '').trim();
            if (!name) throw new Error('物品名不能为空');
            this.app.archiveRegisterItem({ name });
            this._archNote(archNote, '已录入「' + name + '」', false);
        }));
        q('#cs-arch-dossier')?.addEventListener('click', () => after(() => {
            const name = (q('#cs-arch-char-name')?.value || '').trim();
            if (!name) throw new Error('角色名不能为空');
            this.app.archiveUpsertDossier({ name, identity: '重要角色' });
            this._archNote(archNote, '已为「' + name + '」开档', false);
        }));
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-xfer]') : [])) {
            btn.addEventListener('click', () => after(() => {
                const id = btn.getAttribute('data-xfer');
                const to = win.prompt?.('转赠给谁？（持有者名）') || '';
                if (!to) throw new Error('未填转赠对象');
                this.app.archiveTransferItem(id, to, '转赠');
                this._archNote(archNote, '已转赠给「' + to + '」', false);
            }));
        }
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-consume]') : [])) {
            btn.addEventListener('click', () => after(() => {
                const id = btn.getAttribute('data-consume');
                const which = win.confirm?.('消耗（用掉）还是遗失？确定=消耗，取消=遗失');
                this.app.archiveChangeItemStatus(id, which ? 'consumed' : 'lost', '');
                this._archNote(archNote, which ? '已标记消耗' : '已标记遗失', false);
            }));
        }
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-shift]') : [])) {
            btn.addEventListener('click', () => after(() => {
                const name = btn.getAttribute('data-shift');
                const behavior = win.prompt?.('偏移行为（如：开始回避目光）') || '';
                if (!behavior) throw new Error('偏移行为不能为空');
                const meaning = win.prompt?.('这个行为意味着什么？') || '';
                const avoid = win.prompt?.('不要误解为（如：讨厌对方）') || '';
                this.app.archiveRecordShift(name, { behavior, meaning, avoidReadingAs: avoid });
                this._archNote(archNote, '已为「' + name + '」标注偏移', false);
            }));
        }
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-detail]') : [])) {
            btn.addEventListener('click', () => {
                /* 档案行只带摘要面字段；完整档案（经历摘要 / 关系与态度 / 偏移理由）
                 * 按名直取 —— 这是 app.archiveGetDossier 的唯一消费点。 */
                const name = btn.getAttribute('data-detail');
                let d = null;
                try { d = this.app.archiveGetDossier(name); } catch (_e) { d = null; }
                if (!d) { this._archNote(archNote, '读不到「' + name + '」的完整档案', true); return; }
                this._archNote(archNote,
                    '「' + name + '」· ' + (d.identity || '') + ' · ' + (d.formattedAttitudeText || '')
                    + ' · 经历：' + (d.experienceBrief || '待补充')
                    + ' · 互动：' + (d.recentInteractions || '暂无')
                    + (d.personalityShift ? ' · 偏移：' + d.personalityShift.statement : ''),
                    false);
            });
        }
        for (const btn of (el.querySelectorAll ? el.querySelectorAll('[data-vol]') : [])) {
            btn.addEventListener('click', () => {
                /* 卷宗行摘要里没有 recap（概览正文）：按卷号直取完整卷宗再摆出来，
                 * 然后用同一条 phone:openApp 通路去日记 App 按时间线翻。
                 * 卷宗数据**没有**条目 id / 楼层锚 —— 不造 ref、不谎称「已定位到楼层」。 */
                const idx = Number(btn.getAttribute('data-vol'));
                let v = null;
                try { v = this.app.archiveGetVolume(idx); } catch (_e) { v = null; }
                const recap = v && v.recap ? v.recap : '（本卷无概览）';
                this._archNote(archNote,
                    '第' + idx + '卷 · ' + ((v && v.timeRange) || '') + ' · ' + recap,
                    false);
                try { win.dispatchEvent(new win.CustomEvent('phone:openApp', { detail: { appId: 'diary' } })); } catch (_e) {}
            });
        }
    }
}