/* ========================================================
 * wallet-view.js — [v2.49.0] 钱袋视图
 *
 * 【这一面存在的理由】上游记忆插件把「金钱账」外供到只读桥快照上，
 *   而手机端此前零消费——于是「主角钱包还剩多少」「最近一笔钱怎么花的」
 *   在手机上完全答不出。本视图把两块投影摆出来（账户余额 / 流水），
 *   并把**读不到的原因**一并摆出来（五态归因），而不是显示一个
 *   和「世界是空的」同形的 0。
 *
 * 只读：数据全部来自 this.app.projection()（内部只读桥，不写任何状态）。
 * 结构：_esc + _draw + _bind（与 place-view 同风格）。
 * ============================================================ */
'use strict';
export class WalletView {
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
        const face = (pkg && pkg.face) || { reason: 'bridge-absent', text: '钱账不可读', state: 'absent' };
        const proj = (pkg && pkg.proj) || { accounts: [], tx: [], count: 0, txCount: 0 };
        const html = [
            '<div class="wl-root">',
            '  <header class="wl-header">',
            '    <button class="wl-nav" id="wl-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>钱袋</h2>',
            '    <button class="wl-nav" id="wl-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="wl-body">',
            this._reasonCard(face),
            this._accountsCard(face, proj),
            this._txCard(face, proj),
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
            'ready': '钱账由记忆插件的金钱账面提供（只读）。',
            'empty': '这个会话还没记过任何账——剧情里出现金钱往来后会自动长出来。',
            'no-ledger-face': '记忆插件在，但这一版快照没有金钱账面：需要插件较新版本。',
            'no-snapshot': '桥已装好，但还没有产出过快照：等一次生成（或先聊一楼）即可。',
            'bridge-absent': '未检测到 LonSha 记忆插件；装上后本页自动可用。'
        }[face.reason] || '未知归因（如实显示原值，不吞）';
        return [
            '<div class="wl-card wl-reason wl-reason-' + tone + '">',
            '  <div class="wl-reason-head">' + this._esc(face.text || face.reason) + '</div>',
            '  <div class="wl-reason-hint">' + this._esc(hint) + '</div>',
            '</div>'
        ].join('\n');
    }
    _accountsCard(face, proj) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="wl-empty">' + this._esc(face.reason === 'empty' ? '还没有记过账（钱数会随剧情自动入账）' : '读不到账户') + '</div>';
        } else if (!proj.accounts.length) {
            body = '<div class="wl-empty">还没有任何账户（只有流水记录）</div>';
        } else {
            const rows = proj.accounts.map((a) => [
                '<div class="wl-acct">',
                '  <div class="wl-acct-name">' + this._esc(a.name || a.key) + '</div>',
                '  <div class="wl-acct-amount ' + (a.amount !== null && a.amount < 0 ? 'neg' : '') + '">'
                + (a.amount === null ? '未记' : this._fmt(a.amount)) + (a.amount !== null ? ' 元' : '') + '</div>',
                '  <div class="wl-acct-meta">' + (a.floor !== null ? '第' + a.floor + '楼记账' : '无楼层记录') + '</div>',
                '</div>'
            ].join('\n'));
            body = rows.join('\n');
        }
        return [
            '<div class="wl-card">',
            '  <div class="wl-card-title">账户余额<span class="wl-count">' + (ready ? proj.count + ' 个' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _fmt(v) {
        try { return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); } catch (_e) { return String(v); }
    }
    _txCard(face, proj) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="wl-empty">' + this._esc(face.reason === 'empty' ? '还没有流水' : '读不到流水') + '</div>';
        } else if (!proj.tx.length) {
            body = '<div class="wl-empty">还没有流水记录</div>';
        } else {
            const rows = proj.tx.map((t) => [
                '<div class="wl-tx">',
                '  <div class="wl-tx-main">',
                '    <span class="wl-tx-name">' + this._esc(t.name) + '</span>',
                '    <span class="wl-tx-delta ' + (t.delta !== null && t.delta < 0 ? 'neg' : (t.delta !== null ? 'pos' : '')) + '">'
                + (t.delta === null ? '' : (t.delta >= 0 ? '+' : '') + this._fmt(t.delta)) + (t.delta !== null ? ' 元' : '') + '</span>',
                '  </div>',
                (t.desc ? '  <div class="wl-tx-desc">' + this._esc(t.desc) + '</div>' : ''),
                (t.time ? '  <div class="wl-tx-time">' + this._esc(t.time) + '</div>' : ''),
                '</div>'
            ].filter(Boolean).join('\n'));
            body = rows.join('\n') + (proj.txCount > proj.tx.length ? '<div class="wl-empty wl-more">仅显示最近 ' + proj.tx.length + ' 笔（共 ' + proj.txCount + ' 笔）</div>' : '');
        }
        return [
            '<div class="wl-card">',
            '  <div class="wl-card-title">最近流水<span class="wl-count">' + (ready ? proj.txCount + ' 笔' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _settingsCard() {
        let s = {};
        try { s = this.app.getSettings(); } catch (_e) { s = {}; }
        return [
            '<div class="wl-card">',
            '  <div class="wl-card-title">设置</div>',
            '  <div class="wl-row"><span class="wl-label">注入到生成（让正文钱数与账本一致）</span>',
            '    <button class="wl-switch ' + (s.injectToPrompt ? 'on' : '') + '" id="wl-inject">' + (s.injectToPrompt ? '开' : '关') + '</button></div>',
            '  <div class="wl-row"><span class="wl-label">最多注入 ' + this._esc(s.maxInject) + ' 行</span>',
            '    <input type="range" class="wl-range" id="wl-maxInject" min="1" max="20" value="' + this._esc(s.maxInject) + '"></div>',
            '</div>'
        ].join('\n');
    }
    _bind() {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const q = (sel) => { try { return el.querySelector(sel); } catch (_e) { return null; } };
        const win = (() => { try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; } })();
        q('#wl-home')?.addEventListener('click', () => {
            try { win.dispatchEvent(new win.CustomEvent('phone:goHome')); } catch (_e) { /* 宿主无事件：忽略 */ }
        });
        q('#wl-refresh')?.addEventListener('click', () => this._draw());
        q('#wl-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#wl-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 6));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
    }
}
