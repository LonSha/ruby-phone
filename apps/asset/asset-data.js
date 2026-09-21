/* ========================================================
 * asset-data.js — [v2.61.0] 资产 App 纯函数内核
 *
 * 消费已零转录移植的 LA 资产引擎：投影 / 结算 / 求和 / 词表都只走引擎导出面，
 * 本文件不再写一份量级词、周期增量或流水符号。
 *
 * 与钱袋的分工：钱袋读记忆插件 snapshot.moneyLedger（只读桥）；
 * 资产 App 管本地角色账本 / 行情 / 投影 / 结算。
 *
 * 纯 ESM，零宿主对象依赖。
 * ======================================================== */
'use strict';

import terms from './engine/asset-terms.js';
import core from './engine/asset-core.js';
import project from './engine/asset-project.js';

export const ASSET_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    off: 'off',
    disabled: 'disabled'
});

const REASON_TEXT = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    off: 'off',
    disabled: 'disabled'
});

export function defaultAssetSettings() {
    return {
        injectToPrompt: true,
        era: 'modern',
        lastSettleAt: '',
        sourceState: {}
    };
}

export function categoryIds() {
    return Array.isArray(core && core.CATEGORY_IDS) ? core.CATEGORY_IDS.slice() : ['liquid', 'estate', 'business', 'invest', 'debt'];
}

export function uiTermsOf(era) {
    return terms.uiTerms(era);
}

export function categoryWordsOf(era) {
    return terms.categoryWords(era);
}

export function normalizeEraOf(era) {
    return terms.normalizeEra(era);
}

function pad2(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^\d{1,2}$/.test(s)) return '';
    return s.padStart(2, '0');
}

function padYear(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^\d{1,4}$/.test(s)) return '';
    return s.padStart(4, '0');
}

function isoOfParts(y, m, d) {
    const yy = padYear(y);
    const mm = pad2(m);
    const dd = pad2(d);
    if (!yy || !mm || !dd) return '';
    const mi = Number(mm);
    const di = Number(dd);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return '';
    return yy + '-' + mm + '-' + dd;
}

/**
 * TimeManager.getCurrentStoryTime() → 引擎要的 ISO YYYY-MM-DD。
 * isReal / isDefault / 古历 → 空串（不结、不推进，绝不读系统时钟）。
 */
export function storyTimeToIso(story) {
    if (!story || typeof story !== 'object') return '';
    if (story.isReal === true || story.isDefault === true) return '';
    if (story.isAncient === true) return '';
    const direct = isoOfParts(story.year, story.month, story.day);
    if (direct) return direct;
    const text = String(story.calendarDate || story.date || '');
    const hit = /(\d{1,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
    if (!hit) return '';
    return isoOfParts(hit[1], hit[2], hit[3]);
}

export function eraFromStoryTime(story, fallback) {
    const fb = terms.normalizeEra(fallback);
    if (!story || typeof story !== 'object') return fb;
    if (story.isAncient === true) return 'ancient';
    return 'modern';
}

/**
 * 四态归因：未引导 / 已关分类 / 空账 / 就绪。
 * @param {{hasConfig?:boolean, enabled?:boolean, ledger?:object|null}}
 */
export function readAssetFace(probe) {
    const p = probe && typeof probe === 'object' ? probe : {};
    const out = { state: 'off', reason: ASSET_REASONS.off, ledger: null, text: REASON_TEXT.off };
    if (!p.hasConfig) return out;
    if (!p.enabled) {
        out.state = 'disabled';
        out.reason = ASSET_REASONS.disabled;
        out.text = REASON_TEXT.disabled;
        return out;
    }
    const ledger = p.ledger && typeof p.ledger === 'object' ? p.ledger : null;
    out.ledger = ledger;
    const actors = ledger && ledger.actors && typeof ledger.actors === 'object' ? ledger.actors : {};
    const keys = Object.keys(actors);
    let has = false;
    for (let i = 0; i < keys.length; i++) {
        const b = actors[keys[i]] && typeof actors[keys[i]] === 'object' ? actors[keys[i]] : {};
        if ((Array.isArray(b.entries) && b.entries.length) || (Array.isArray(b.flows) && b.flows.length)) {
            has = true;
            break;
        }
    }
    if (!has) {
        out.state = 'empty';
        out.reason = ASSET_REASONS.empty;
        out.text = REASON_TEXT.empty;
        return out;
    }
    out.state = 'ready';
    out.reason = ASSET_REASONS.ready;
    out.text = REASON_TEXT.ready;
    return out;
}

/**
 * 面板投影：求和走 core.sumNetWorth，公开层正文走 project.renderAssetText。
 */
export function projectAssetPanel(ledger, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const era = terms.normalizeEra(o.era);
    const names = o.names && typeof o.names === 'object' ? o.names : {};
    const T = terms.uiTerms(era);
    const cats = terms.categoryWords(era);
    const actors = ledger && ledger.actors && typeof ledger.actors === 'object' ? ledger.actors : {};
    const rows = [];
    const keys = Object.keys(actors);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const bucket = actors[key] && typeof actors[key] === 'object' ? actors[key] : {};
        const entries = Array.isArray(bucket.entries) ? bucket.entries : [];
        const worth = typeof core.sumNetWorth === 'function'
            ? core.sumNetWorth(entries)
            : { assets: 0, liabilities: 0, net: 0, unpricedCount: 0 };
        const publicText = typeof project.renderAssetText === 'function'
            ? String(project.renderAssetText(entries, { era: era, layer: 'public' }) || '')
            : '';
        rows.push({
            key: key,
            name: String(names[key] || key),
            count: entries.length,
            worth: worth,
            publicText: publicText
        });
    }
    return {
        era: era,
        terms: T,
        cats: cats,
        rows: rows,
        actorCount: rows.length
    };
}

/**
 * 生成侧公开层块。无内容回 ''；公开层禁止阿拉伯数字。
 */
export function assetPromptBlock(ledger, opts) {
    try {
        const o = opts && typeof opts === 'object' ? opts : {};
        if (o.injectToPrompt === false) return '';
        if (!ledger || typeof ledger !== 'object') return '';
        const era = terms.normalizeEra(o.era);
        const names = o.names && typeof o.names === 'object' ? o.names : {};
        const actors = ledger.actors && typeof ledger.actors === 'object' ? ledger.actors : {};
        const enabled = Array.isArray(o.enabled) ? o.enabled.map(String) : Object.keys(actors);
        const T = terms.uiTerms(era);
        const lines = [];
        for (let i = 0; i < enabled.length; i++) {
            const key = enabled[i];
            const bucket = actors[key] && typeof actors[key] === 'object' ? actors[key] : null;
            if (!bucket) continue;
            const entries = Array.isArray(bucket.entries) ? bucket.entries : [];
            const text = typeof project.renderAssetText === 'function'
                ? String(project.renderAssetText(entries, { era: era, layer: 'public' }) || '')
                : '';
            if (!text) continue;
            const name = String(names[key] || key);
            lines.push('· ' + name);
            lines.push(text);
        }
        if (!lines.length) return '';
        const head = T && T.assetTab ? String(T.assetTab) : '';
        return '【' + head + '】\n' + lines.join('\n');
    } catch (_e) {
        return '';
    }
}

/**
 * 把 planSettlement 的 due 原样喂给 appendFlow；本函数不落盘。
 */
export function applyDueFlows(ledger, due, today) {
    let cur = ledger && typeof ledger === 'object' ? ledger : { actors: {} };
    const applied = [];
    const blocked = [];
    const list = Array.isArray(due) ? due : [];
    for (let i = 0; i < list.length; i++) {
        const item = list[i] && typeof list[i] === 'object' ? list[i] : {};
        const payload = Object.assign({}, item, { today: today });
        const r = typeof core.appendFlow === 'function' ? core.appendFlow(cur, payload) : { error: 'no-append' };
        if (r && r.ledger) {
            cur = r.ledger;
            applied.push(item);
        } else {
            blocked.push(r && r.error ? r.error : 'blocked');
        }
    }
    return { ledger: cur, applied: applied, blocked: blocked };
}
