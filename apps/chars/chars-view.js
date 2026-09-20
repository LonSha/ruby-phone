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
        const html = [
            '<div class="cs-root">',
            '  <header class="cs-header">',
            '    <button class="cs-nav" id="cs-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>群像</h2>',
            '    <button class="cs-nav" id="cs-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="cs-body">',
            this._reasonCard(face),
            this._rolesCard(face, proj),
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
    /** 字段值可读化（与内核 fmtFieldVal 同口径，视图独立不引内核私有函数） */
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
    }
}