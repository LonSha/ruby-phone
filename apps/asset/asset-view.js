/* ========================================================
 * asset-view.js — [v2.61.0] 资产 App 视图
 * 词从 terms 来：标题/按钮/类目/空态一律 tw(T, key)，不硬编码现代腔。
 * 公开层正文来自引擎 renderAssetText，本层不另写量级词。
 * ======================================================== */
'use strict';
import { ASSET_REASONS, uiTermsOf, categoryWordsOf } from './asset-data.js';

function tw(T, key) {
    if (!T || typeof T !== 'object') return '';
    const v = T[key];
    return v == null ? '' : String(v);
}

export class AssetView {
    constructor(app) {
        this.app = app;
        this.container = null;
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
        const face = (pkg && pkg.face) || { reason: ASSET_REASONS.off, state: 'off' };
        const era = (pkg && pkg.era) || 'modern';
        const T = uiTermsOf(era);
        const cats = categoryWordsOf(era);
        const html = [
            '<div class="as-root">',
            '  <header class="as-header">',
            '    <button class="as-nav" id="as-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>' + this._esc(tw(T, 'assetTab')) + '</h2>',
            '    <button class="as-nav" id="as-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="as-body">',
            this._reasonCard(face, T, pkg),
            this._onboardCard(face, T, cats, pkg),
            this._actorsCard(face, T, pkg),
            this._entryCard(face, T, cats, pkg),
            this._settleCard(face, T, pkg),
            this._settingsCard(T, pkg),
            '  </div>',
            '</div>'
        ].join('\n');
        try { this.container.innerHTML = html; } catch (_e) { /* 容器不可用 */ }
        this._bind();
    }

    _reasonCard(face, T, pkg) {
        const tone = face.reason === ASSET_REASONS.ready ? 'ok'
            : (face.reason === ASSET_REASONS.empty ? 'warn' : 'off');
        const today = pkg && pkg.today ? pkg.today : '';
        const head = face.reason === ASSET_REASONS.off ? tw(T, 'onboardTitle')
            : (face.reason === ASSET_REASONS.disabled ? tw(T, 'onboardTitle')
                : (face.reason === ASSET_REASONS.empty ? tw(T, 'emptyLedger') : tw(T, 'assetTab')));
        const hint = today ? (tw(T, 'today') + ' ' + today) : tw(T, 'settleNoToday');
        return [
            '<div class="as-card as-reason as-reason-' + tone + '">',
            '  <div class="as-reason-head">' + this._esc(head) + '</div>',
            '  <div class="as-reason-hint">' + this._esc(hint) + '</div>',
            '</div>'
        ].join('\n');
    }

    _onboardCard(face, T, cats, pkg) {
        if (face.reason !== ASSET_REASONS.off && face.reason !== ASSET_REASONS.disabled) return '';
        const ids = (pkg && Array.isArray(pkg.cats)) ? pkg.cats : Object.keys(cats || {});
        const chips = ids.map((id) => {
            const label = cats && cats[id] ? cats[id] : id;
            return '<label class="as-chip"><input type="checkbox" class="as-cat" data-cat="' +
                this._esc(id) + '" checked><span>' + this._esc(label) + '</span></label>';
        }).join('');
        return [
            '<div class="as-card">',
            '  <div class="as-card-title">' + this._esc(tw(T, 'onboardTitle')) + '</div>',
            '  <div class="as-chips">' + chips + '</div>',
            '  <button class="as-btn" id="as-start">' + this._esc(tw(T, 'onboardStart')) + '</button>',
            '</div>'
        ].join('\n');
    }

    _actorsCard(face, T, pkg) {
        const ready = face.reason === ASSET_REASONS.ready || face.reason === ASSET_REASONS.empty;
        if (!ready) return '';
        const rows = (pkg && pkg.proj && Array.isArray(pkg.proj.rows)) ? pkg.proj.rows : [];
        let body;
        if (!rows.length) {
            body = '<div class="as-empty">' + this._esc(tw(T, 'emptyLedger')) + '</div>';
        } else {
            body = rows.map((r) => {
                const text = r.publicText ? this._esc(r.publicText).replace(/\n/g, '<br>') : '';
                return [
                    '<div class="as-actor">',
                    '  <div class="as-actor-name">' + this._esc(r.name || r.key) + '</div>',
                    (text ? '  <div class="as-actor-text">' + text + '</div>' : ''),
                    '</div>'
                ].filter(Boolean).join('\n');
            }).join('\n');
        }
        return [
            '<div class="as-card">',
            '  <div class="as-card-title">' + this._esc(tw(T, 'sideHead')) +
            '<span class="as-count">' + rows.length + '</span></div>',
            body,
            '</div>'
        ].join('\n');
    }

    _entryCard(face, T, cats, pkg) {
        if (face.reason === ASSET_REASONS.off) return '';
        const ids = (pkg && Array.isArray(pkg.cats)) ? pkg.cats : Object.keys(cats || {});
        const opts = ids.map((id) => {
            const label = cats && cats[id] ? cats[id] : id;
            return '<option value="' + this._esc(id) + '">' + this._esc(label) + '</option>';
        }).join('');
        const actor = pkg && pkg.actorKey ? pkg.actorKey : '';
        return [
            '<div class="as-card">',
            '  <div class="as-card-title">' + this._esc(tw(T, 'instListTitle')) + '</div>',
            '  <input class="as-input" id="as-actor" value="' + this._esc(actor) + '" placeholder="' + this._esc(tw(T, 'sideHead')) + '">',
            '  <input class="as-input" id="as-label" placeholder="' + this._esc(tw(T, 'name')) + '">',
            '  <select class="as-input" id="as-cat">' + opts + '</select>',
            '  <input class="as-input" id="as-amount" placeholder="' + this._esc(tw(T, 'entryAmount')) + '">',
            '  <button class="as-btn" id="as-add">' + this._esc(tw(T, 'confirm')) + '</button>',
            '</div>'
        ].join('\n');
    }

    _settleCard(face, T, pkg) {
        if (face.reason === ASSET_REASONS.off) return '';
        const today = pkg && pkg.today ? pkg.today : '';
        const note = today ? (tw(T, 'today') + ' ' + today) : tw(T, 'settleNoToday');
        return [
            '<div class="as-card">',
            '  <div class="as-card-title">' + this._esc(tw(T, 'ovThisPeriod')) + '</div>',
            '  <div class="as-empty">' + this._esc(note) + '</div>',
            '  <button class="as-btn" id="as-settle">' + this._esc(tw(T, 'confirm')) + '</button>',
            '</div>'
        ].join('\n');
    }

    _settingsCard(T, pkg) {
        const s = (pkg && pkg.settings) || {};
        const era = (pkg && pkg.era) || 'modern';
        return [
            '<div class="as-card">',
            '  <div class="as-card-title">' + this._esc(tw(T, 'assetTab')) + '</div>',
            '  <div class="as-row"><span class="as-label">' + this._esc(tw(T, 'assetTab')) + '</span>',
            '    <button class="as-switch ' + (s.injectToPrompt ? 'on' : '') + '" id="as-inject">' +
            this._esc(s.injectToPrompt ? tw(T, 'open') : tw(T, 'close')) + '</button></div>',
            '  <div class="as-row"><span class="as-label">' + this._esc(tw(T, 'sideNote')) + '</span>',
            '    <select class="as-input as-era" id="as-era">',
            '      <option value="modern"' + (era === 'modern' ? ' selected' : '') + '>modern</option>',
            '      <option value="ancient"' + (era === 'ancient' ? ' selected' : '') + '>ancient</option>',
            '      <option value="xianxia"' + (era === 'xianxia' ? ' selected' : '') + '>xianxia</option>',
            '    </select></div>',
            '</div>'
        ].join('\n');
    }

    _bind() {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const q = (sel) => { try { return el.querySelector(sel); } catch (_e) { return null; } };
        const win = (() => { try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; } })();
        const home = q('#as-home');
        if (home) home.addEventListener('click', () => {
            try { win.dispatchEvent(new win.CustomEvent('phone:goHome')); } catch (_e) {}
        });
        const refresh = q('#as-refresh');
        if (refresh) refresh.addEventListener('click', () => this._draw());
        const start = q('#as-start');
        if (start) start.addEventListener('click', () => {
            const picked = [];
            try {
                el.querySelectorAll('.as-cat:checked').forEach((n) => {
                    const id = n && n.getAttribute ? n.getAttribute('data-cat') : '';
                    if (id) picked.push(id);
                });
            } catch (_e) {}
            try { this.app.onboard(picked); } catch (_e) {}
            this._draw();
        });
        const add = q('#as-add');
        if (add) add.addEventListener('click', () => {
            const actor = q('#as-actor') && q('#as-actor').value;
            const label = q('#as-label') && q('#as-label').value;
            const cat = q('#as-cat') && q('#as-cat').value;
            const amount = q('#as-amount') && q('#as-amount').value;
            try { this.app.addEntry({ actorKey: actor, label: label, cat: cat, amount: amount }); } catch (_e) {}
            this._draw();
        });
        const settle = q('#as-settle');
        if (settle) settle.addEventListener('click', () => {
            try { this.app.settleNow(); } catch (_e) {}
            this._draw();
        });
        const inject = q('#as-inject');
        if (inject) inject.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        const eraSel = q('#as-era');
        if (eraSel) eraSel.addEventListener('change', (e) => {
            try { this.app.saveSettings({ era: e && e.target ? e.target.value : 'modern' }); } catch (_e) {}
            this._draw();
        });
    }
}
