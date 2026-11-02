import { wallNow } from './time-source.js';
// Device-only aggregates. Existing phone:openApp/goHome remain the sole event source.
// No migration from usage_stats_v1: that is a different, session-scoped statistic.
const DAY = 86400000;
const MAX_VISIT = 4 * 3600000;
const instances = new WeakMap();
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
const validId = id => typeof id === 'string' && !['constructor', 'prototype', '__proto__'].includes(id) && /^[a-z][a-z0-9_-]{0,63}$/.test(id);
function empty(enabled = false) { return { version: 1, enabled, apps: {} }; }
function normalize(raw) {
    const out = empty(raw?.enabled === true);
    if (raw?.version !== 1 || !raw.apps || typeof raw.apps !== 'object') return out;
    for (const [id, row] of Object.entries(raw.apps).slice(0, 256)) {
        if (!validId(id) || !row || typeof row !== 'object') continue;
        out.apps[id] = { count: Math.floor(number(row.count)), ms: number(row.ms),
            lastAt: number(row.lastAt), acknowledged: row.acknowledged === true };
    }
    return out;
}
export function createUsagePattern(storage, now = wallNow) {
    let active = null;
    const read = () => {
        try { return normalize(storage.usagePatternStore().read()); } catch (_) { return empty(); }
    };
    const write = data => {
        try { return storage.usagePatternStore().write(data) === true; } catch (_) { return false; }
    };
    const time = at => number(at === undefined ? now() : at);
    function settle(data, at) {
        if (active && data.apps[active.id]) {
            data.apps[active.id].ms += Math.min(MAX_VISIT, Math.max(0, at - active.at));
        }
        active = null;
    }
    function trace(id, data = read(), at = time()) {
        const row = validId(id) ? data.apps[id] : null;
        const count = row?.count || 0;
        const state = !count ? 'never' : at - row.lastAt >= 14 * DAY ? 'faded'
            : count >= 10 ? 'habitual' : 'rare';
        return { id, state, count, ms: row?.ms || 0, lastAt: count ? row.lastAt : null,
            acknowledged: row?.acknowledged === true };
    }
    return {
        trace,
        summary(ids = []) {
            const data = read();
            const at = time();
            return { enabled: data.enabled, rows: data.enabled ? ids.filter(validId).map(id => trace(id, data, at)) : [] };
        },
        configure(enabled) {
            active = null;
            const data = read(); data.enabled = enabled === true;
            return write(data);
        },
        open(id, at) {
            const data = read();
            if (!data.enabled || !validId(id)) { active = null; return false; }
            const t = time(at);
            settle(data, t);
            const row = data.apps[id] || { count: 0, ms: 0, lastAt: 0, acknowledged: false };
            row.count += 1; row.lastAt = t; row.acknowledged = false;
            data.apps[id] = row;
            if (!write(data)) return false;
            active = { id, at: t };
            return true;
        },
        close(at) {
            const data = read();
            if (!data.enabled || !active) { active = null; return false; }
            settle(data, time(at));
            return write(data);
        },
        acknowledge(id) {
            const data = read();
            if (!data.enabled || !validId(id) || !data.apps[id]?.count) return false;
            data.apps[id].acknowledged = true;
            return write(data);
        },
        clear() { active = null; return write(empty(read().enabled)); }
    };
}
export function getUsagePattern(storage) {
    if (!storage || typeof storage !== 'object') return createUsagePattern(null);
    if (!instances.has(storage)) instances.set(storage, createUsagePattern(storage));
    return instances.get(storage);
}
