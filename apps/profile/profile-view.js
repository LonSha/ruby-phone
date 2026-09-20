/* ========================================================
 * profile-view.js — [v2.49.0] 档案视图
 *
 * 【这一面存在的理由】上游记忆插件把「主角档案 + 生活小档案」外供到只读桥快照上，
 *   而手机端此前零消费——于是「主角现在多大、什么身份」「生活里有哪些持续的小细节」
 *   在手机上完全答不出。本视图把两块投影摆出来（主角字段 / 生活小档案分层），
 *   并把**读不到的原因**一并摆出来（五态归因），而不是显示一个
 *   和「世界是空的」同形的空页。
 *
 * 只读：数据全部来自 this.app.projection()（内部只读桥，不写任何状态）。
 * 结构：_esc + _draw + _bind（与 place-view 同风格）。
 * ============================================================ */
'use strict';
import { TIER_TEXT } from './profile-data.js';
export class ProfileView {
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
        const face = (pkg && pkg.face) || { reason: 'bridge-absent', text: '档案不可读', state: 'absent' };
        const fields = (pkg && pkg.fields) || [];
        const groups = (pkg && pkg.groups) || { pinned: [], active: [], archive: [], total: 0 };
        const html = [
            '<div class="pf-root">',
            '  <header class="pf-header">',
            '    <button class="pf-nav" id="pf-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>档案</h2>',
            '    <button class="pf-nav" id="pf-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="pf-body">',
            this._reasonCard(face),
            this._heroCard(face, fields),
            this._lifeCard(face, groups),
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
            'ready': '档案由记忆插件的主角档案与生活小档案提供（只读）。',
            'empty': '这个会话还没有主角档案——剧情推进后会自动长出来。',
            'no-profile-face': '记忆插件在，但这一版快照没有档案面：需要插件较新版本。',
            'no-snapshot': '桥已装好，但还没有产出过快照：等一次生成（或先聊一楼）即可。',
            'bridge-absent': '未检测到 LonSha 记忆插件；装上后本页自动可用。'
        }[face.reason] || '未知归因（如实显示原值，不吞）';
        return [
            '<div class="pf-card pf-reason pf-reason-' + tone + '">',
            '  <div class="pf-reason-head">' + this._esc(face.text || face.reason) + '</div>',
            '  <div class="pf-reason-hint">' + this._esc(hint) + '</div>',
            '</div>'
        ].join('\n');
    }
    _heroCard(face, fields) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pf-empty">' + this._esc(face.reason === 'empty' ? '还没有主角档案（随剧情自动建立）' : '读不到主角档案') + '</div>';
        } else if (!fields.length) {
            body = '<div class="pf-empty">档案在，但还没有可读字段</div>';
        } else {
            const rows = fields.map((f) => [
                '<div class="pf-field">',
                '  <span class="pf-field-key">' + this._esc(f.key) + '</span>',
                '  <span class="pf-field-val">' + this._esc(f.value) + '</span>',
                '</div>'
            ].join('\n'));
            body = rows.join('\n');
        }
        return [
            '<div class="pf-card">',
            '  <div class="pf-card-title">主角档案<span class="pf-count">' + (ready ? fields.length + ' 项' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _lifeItem(d, tier) {
        return [
            '<div class="pf-life pf-life-' + tier + '">',
            '  <div class="pf-life-text">' + this._esc(d.text) + '</div>',
            (d.topics.length ? '  <div class="pf-life-topics">' + d.topics.map((t) => '<span class="pf-topic">' + this._esc(t) + '</span>').join('') + '</div>' : ''),
            (d.until ? '  <div class="pf-life-until">至 ' + this._esc(d.until) + '</div>' : ''),
            '</div>'
        ].filter(Boolean).join('\n');
    }
    _lifeCard(face, groups) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pf-empty">' + this._esc(face.reason === 'empty' ? '还没有生活小档案' : '读不到生活小档案') + '</div>';
        } else if (!groups.total) {
            body = '<div class="pf-empty">还没有生活小档案（生活细节会随剧情沉淀）</div>';
        } else {
            const tiers = [['pinned', '常驻'], ['active', '进行中'], ['archive', '已归档']];
            body = tiers.map(([k, label]) => {
                const list = groups[k];
                if (!list.length) return '';
                return [
                    '<div class="pf-tier">',
                    '  <div class="pf-tier-head">' + this._esc(label) + ' <span class="pf-tier-n">' + list.length + ' 条</span></div>',
                    '  ' + list.map((d) => this._lifeItem(d, k)).join('\n'),
                    '</div>'
                ].join('\n');
            }).filter(Boolean).join('\n');
        }
        return [
            '<div class="pf-card">',
            '  <div class="pf-card-title">生活小档案<span class="pf-count">' + (ready ? groups.total + ' 条' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _settingsCard() {
        let s = {};
        try { s = this.app.getSettings(); } catch (_e) { s = {}; }
        return [
            '<div class="pf-card">',
            '  <div class="pf-card-title">设置</div>',
            '  <div class="pf-row"><span class="pf-label">注入到生成（让正文主角与档案一致）</span>',
            '    <button class="pf-switch ' + (s.injectToPrompt ? 'on' : '') + '" id="pf-inject">' + (s.injectToPrompt ? '开' : '关') + '</button></div>',
            '  <div class="pf-row"><span class="pf-label">最多注入 ' + this._esc(s.maxInject) + ' 行</span>',
            '    <input type="range" class="pf-range" id="pf-maxInject" min="1" max="20" value="' + this._esc(s.maxInject) + '"></div>',
            '</div>'
        ].join('\n');
    }
    _bind() {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const q = (sel) => { try { return el.querySelector(sel); } catch (_e) { return null; } };
        const win = (() => { try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; } })();
        q('#pf-home')?.addEventListener('click', () => {
            try { win.dispatchEvent(new win.CustomEvent('phone:goHome')); } catch (_e) { /* 宿主无事件：忽略 */ }
        });
        q('#pf-refresh')?.addEventListener('click', () => this._draw());
        q('#pf-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#pf-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 8));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
    }
}
