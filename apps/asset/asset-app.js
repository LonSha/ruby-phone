/* ========================================================
 * asset-app.js — [v2.61.0] 资产 App 控制器
 *
 * 消费已零转录移植的 LA 资产引擎：读写只走 createAssetStore，
 * 公开层只走 renderAssetText，结算只走 planSettlement + appendFlow。
 * 剧情日只走 TimeManager.getCurrentStoryTime 转 ISO；拿不到就不结、不推进。
 * ======================================================== */
'use strict';
import {
    defaultAssetSettings,
    categoryIds,
    normalizeEraOf,
    storyTimeToIso,
    eraFromStoryTime,
    readAssetFace,
    projectAssetPanel,
    assetPromptBlock,
    applyDueFlows
} from './asset-data.js';
import { AssetView } from './asset-view.js';
import assetStoreApi from './engine/asset-store.js';
import settlement from './engine/asset-settlement.js';
import market from './engine/asset-market.js';
import library from './engine/asset-library.js';
import core from './engine/asset-core.js';
import keysApi from './engine/asset-keys.js';

const SETTINGS_KEY = 'asset_settings_v1';
const STORE_KEYS = [
    '__la_asset_config_v1',
    '__la_asset_ledger_v1',
    '__la_asset_market_v1',
    '__la_asset_extract_v1',
    '__la_asset_snapshots_v1',
    '__la_asset_projection_v1',
    '__la_asset_market_override_v1'
];

function parseMaybe(v) {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (!s) return v;
    if (s[0] !== '{' && s[0] !== '[') return v;
    try { return JSON.parse(s); } catch (_e) { return v; }
}

function makeHost(storage) {
    return {
        getVariables() {
            const out = {};
            for (let i = 0; i < STORE_KEYS.length; i++) {
                const k = STORE_KEYS[i];
                let v;
                try { v = storage && storage.get ? storage.get(k) : undefined; } catch (_e) { v = undefined; }
                if (v === undefined || v === null) continue;
                out[k] = parseMaybe(v);
            }
            return out;
        },
        insertOrAssignVariables(patch) {
            const p = patch && typeof patch === 'object' ? patch : {};
            const ks = Object.keys(p);
            for (let i = 0; i < ks.length; i++) {
                try { storage && storage.set && storage.set(ks[i], p[ks[i]]); } catch (_e) { return false; }
            }
            return true;
        },
        updateVariablesWith(fn, _o) {
            try {
                const cur = this.getVariables();
                const next = typeof fn === 'function' ? fn(cur) : cur;
                const p = next && typeof next === 'object' ? next : {};
                const ks = Object.keys(p);
                for (let i = 0; i < ks.length; i++) {
                    storage && storage.set && storage.set(ks[i], p[ks[i]]);
                }
                return true;
            } catch (_e) { return false; }
        }
    };
}

function pricedKeyOf(cat) {
    try {
        const list = core && core.BUILTIN_CATEGORIES ? core.BUILTIN_CATEGORIES : [];
        const hit = list.filter((c) => c && c.id === cat)[0];
        const fields = hit && Array.isArray(hit.fields) ? hit.fields : [];
        const priced = fields.filter((f) => f && f.sum === true)[0];
        return priced && priced.key ? String(priced.key) : '';
    } catch (_e) { return ''; }
}

function templateOf(cat) {
    try {
        const list = core && core.BUILTIN_CATEGORIES ? core.BUILTIN_CATEGORIES : [];
        return list.filter((c) => c && c.id === cat)[0] || null;
    } catch (_e) { return null; }
}

function nextEntryId(ledger) {
    let n = 0;
    const actors = ledger && ledger.actors && typeof ledger.actors === 'object' ? ledger.actors : {};
    const ks = Object.keys(actors);
    for (let i = 0; i < ks.length; i++) {
        const b = actors[ks[i]] || {};
        n += Array.isArray(b.entries) ? b.entries.length : 0;
    }
    return 'ae_' + String(n + 1);
}

function copyActors(actors) {
    const src = actors && typeof actors === 'object' ? actors : {};
    const out = {};
    const ks = Object.keys(src);
    for (let i = 0; i < ks.length; i++) {
        const k = ks[i];
        const b = src[k] && typeof src[k] === 'object' ? src[k] : {};
        const bucket = {
            entries: Array.isArray(b.entries) ? b.entries.slice() : [],
            flows: Array.isArray(b.flows) ? b.flows.slice() : []
        };
        if (keysApi && typeof keysApi.setKey === 'function') keysApi.setKey(out, k, bucket);
        else out[k] = bucket;
    }
    return out;
}

export class AssetApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new AssetView(this);
        this._store = null;
        this._hooked = false;
        this._initHook();
    }

    getSettings() {
        try {
            const raw = this.storage && this.storage.get ? this.storage.get(SETTINGS_KEY, null) : null;
            const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return Object.assign({}, defaultAssetSettings(), obj && typeof obj === 'object' ? obj : {});
        } catch (_e) { return defaultAssetSettings(); }
    }

    saveSettings(patch) {
        try {
            const next = Object.assign({}, this.getSettings(), patch || {});
            if (this.storage && this.storage.set) this.storage.set(SETTINGS_KEY, JSON.stringify(next), false);
            return next;
        } catch (_e) { return this.getSettings(); }
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    store() {
        if (this._store) return this._store;
        const factory = assetStoreApi && assetStoreApi.createAssetStore;
        this._store = typeof factory === 'function' ? factory({ host: makeHost(this.storage) }) : null;
        return this._store;
    }

    categoryIds() { return categoryIds(); }

    _story() {
        try {
            const tm = this._win().VirtualPhone && this._win().VirtualPhone.timeManager;
            return tm && typeof tm.getCurrentStoryTime === 'function' ? tm.getCurrentStoryTime() : null;
        } catch (_e) { return null; }
    }

    todayIso() { return storyTimeToIso(this._story()); }

    era() {
        const s = this.getSettings();
        const forced = normalizeEraOf(s.era);
        if (s.era && (s.era === 'modern' || s.era === 'ancient' || s.era === 'xianxia')) return forced;
        return eraFromStoryTime(this._story(), forced);
    }

    _actorKey() {
        try {
            const ctx = this._win().SillyTavern && this._win().SillyTavern.getContext && this._win().SillyTavern.getContext();
            const name = (ctx && ctx.characters && ctx.characterId !== undefined && ctx.characters[ctx.characterId] && ctx.characters[ctx.characterId].name)
                || (ctx && ctx.name2)
                || '';
            const t = String(name || '').trim();
            return t || '主角';
        } catch (_e) { return '主角'; }
    }

    probe() {
        const st = this.store();
        if (!st) return { hasConfig: false, enabled: false, ledger: null };
        let hasConfig = false;
        let enabled = false;
        let ledger = null;
        try { hasConfig = !!st.hasConfig(); } catch (_e) { hasConfig = false; }
        try { enabled = !!st.isEnabled(); } catch (_e) { enabled = false; }
        try { ledger = st.readLedger(); } catch (_e) { ledger = null; }
        return { hasConfig: hasConfig, enabled: enabled, ledger: ledger };
    }

    assetFace() {
        return readAssetFace(this.probe());
    }

    projection() {
        const face = this.assetFace();
        const era = this.era();
        const names = {};
        const actors = face.ledger && face.ledger.actors ? face.ledger.actors : {};
        const ks = Object.keys(actors);
        for (let i = 0; i < ks.length; i++) names[ks[i]] = ks[i];
        const proj = projectAssetPanel(face.ledger, { era: era, names: names });
        return {
            face: face,
            proj: proj,
            today: this.todayIso(),
            era: era,
            settings: this.getSettings(),
            actorKey: this._actorKey(),
            cats: this.categoryIds()
        };
    }

    summaryLine() {
        try {
            const pkg = this.projection();
            if (pkg.face.reason !== 'ready' && pkg.face.reason !== 'empty') return pkg.face.reason;
            return String(pkg.proj.actorCount) + ' / ' + String(pkg.today || '');
        } catch (_e) { return ''; }
    }

    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const face = this.assetFace();
            if (face.reason !== 'ready') return '';
            const names = {};
            const actors = face.ledger && face.ledger.actors ? face.ledger.actors : {};
            const ks = Object.keys(actors);
            for (let i = 0; i < ks.length; i++) names[ks[i]] = ks[i];
            return assetPromptBlock(face.ledger, { era: this.era(), names: names, injectToPrompt: true });
        } catch (_e) { return ''; }
    }

    onboard(enabledList) {
        const st = this.store();
        if (!st) return false;
        const cats = Array.isArray(enabledList) && enabledList.length ? enabledList : this.categoryIds();
        const today = this.todayIso();
        const ok = st.writeConfig({ onboarded: true, onboardedAt: today, enabledCategories: cats });
        if (ok && today) {
            const s = this.getSettings();
            if (!s.lastSettleAt) this.saveSettings({ lastSettleAt: today });
        }
        return ok;
    }

    addEntry(input) {
        const st = this.store();
        if (!st || !st.isEnabled()) return { ok: false, error: 'off' };
        const i = input && typeof input === 'object' ? input : {};
        const actorKey = String(i.actorKey || this._actorKey()).trim();
        const cat = String(i.cat || 'liquid').trim();
        const label = String(i.label || '').trim();
        const rawAmt = i.amount;
        const amount = (rawAmt === '' || rawAmt == null) ? NaN : Number(rawAmt);
        if (!actorKey) return { ok: false, error: 'actor' };
        const ledger = st.readLedger();
        const id = core && typeof core.createEntryId === 'function'
            ? (core.createEntryId(i.id) || nextEntryId(ledger))
            : nextEntryId(ledger);
        const pk = pricedKeyOf(cat);
        const state = {};
        if (pk && Number.isFinite(amount)) state[pk] = amount;
        const item = core && typeof core.createEntry === 'function'
            ? core.createEntry({ id: id, cat: cat, label: label, ownerKey: actorKey, state: state, template: templateOf(cat) })
            : null;
        if (!item) return { ok: false, error: 'create' };
        const actors = copyActors(ledger.actors);
        if (!actors[actorKey]) {
            if (keysApi && typeof keysApi.setKey === 'function') keysApi.setKey(actors, actorKey, { entries: [], flows: [] });
            else actors[actorKey] = { entries: [], flows: [] };
        }
        actors[actorKey].entries.push(item);
        const ok = st.writeLedger({ actors: actors });
        return { ok: !!ok, item: item };
    }

    settleNow() {
        const st = this.store();
        if (!st || !st.isEnabled()) return { ok: false, skipped: true, reason: 'off' };
        const today = this.todayIso();
        const era = this.era();
        const s = this.getSettings();
        let lastAt = String(s.lastSettleAt || '').trim();
        if (today && !lastAt) {
            this.saveSettings({ lastSettleAt: today });
            lastAt = today;
        }
        const ledger = st.readLedger();
        const plan = settlement && typeof settlement.planSettlement === 'function'
            ? settlement.planSettlement(ledger, {
                today: today,
                lastAt: lastAt,
                era: era,
                sourceState: s.sourceState
            })
            : { due: [], skipped: true, reason: '', flowWatermarks: [] };
        if (!today) return { ok: false, skipped: true, reason: plan.reason || '', plan: plan };
        if (plan.skipped) return { ok: false, skipped: true, reason: plan.reason || '', plan: plan };
        const applied = applyDueFlows(ledger, plan.due, today);
        if (applied.ledger) st.writeLedger(applied.ledger);
        const nextState = Object.assign({}, s.sourceState && typeof s.sourceState === 'object' ? s.sourceState : {});
        const marks = Array.isArray(plan.flowWatermarks) ? plan.flowWatermarks : [];
        for (let i = 0; i < marks.length; i++) {
            const w = marks[i] || {};
            if (w.advance === false) continue;
            if (!w.flowIdentity) continue;
            nextState[w.flowIdentity] = { anchor: w.anchor, through: w.through };
        }
        this.saveSettings({ lastSettleAt: today, sourceState: nextState });
        this._advanceMarket(today);
        return { ok: true, skipped: false, applied: applied.applied.length, blocked: applied.blocked.length, plan: plan };
    }

    _advanceMarket(today) {
        try {
            if (!today) return;
            const st = this.store();
            if (!st) return;
            const lib = library && typeof library.resolveLibrary === 'function'
                ? library.resolveLibrary({ chatOverride: st.readMarketOverride && st.readMarketOverride() })
                : { entries: [] };
            const r = market && typeof market.advanceMarket === 'function'
                ? market.advanceMarket(st.readMarket() || {}, { today: today, base: lib.entries })
                : { skipped: true };
            if (r && r.skipped !== true && r.state) st.writeMarket(r.state);
        } catch (_e) { /* 行情推进失败不挫面板 */ }
    }

    _initHook() {
        if (this._hooked) return;
        try {
            const ctx = this._win().SillyTavern && this._win().SillyTavern.getContext && this._win().SillyTavern.getContext();
            const es = ctx && ctx.eventSource;
            const et = ctx && ctx.event_types;
            if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const block = this.promptBlock();
                    if (block) payload.prompt.push({ role: 'system', content: block });
                } catch (_e) { /* 静默 */ }
            });
            this._hooked = true;
        } catch (_e) { /* 无事件源 */ }
    }

    onChatChanged() {
        this._store = null;
    }

    render() {
        this._initHook();
        const today = this.todayIso();
        if (today) this._advanceMarket(today);
        this.view.render((this.phoneShell && this.phoneShell.layerHost && this.phoneShell.layerHost('asset-main')) || (this.phoneShell && this.phoneShell.screen));
    }
}
export default AssetApp;
