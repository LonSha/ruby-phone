import { SC_KEY, SC_LIMITS } from './shared-chore-terms.js';
import { sharedChore, choreAction } from './shared-chore.js';
export function readChores(storage) {
    try {
        const raw = storage.get(SC_KEY, false);
        const rows = raw == null ? [] : typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(rows) || rows.length > SC_LIMITS.chores) return { ok: false, why: 'bad-storage', rows: [] };
        const normalized = rows.map(sharedChore);
        if (normalized.some(x => !x) || new Set(normalized.map(x => x.id)).size !== normalized.length) return { ok: false, why: 'bad-storage', rows: [] };
        return { ok: true, rows: normalized };
    } catch (_) { return { ok: false, why: 'bad-storage', rows: [] }; }
}
export function saveChore(storage, raw, action) {
    if (!raw || typeof raw !== 'object') return { ok: false, why: 'bad-shape' };
    const read = readChores(storage);
    if (!read.ok) return read;
    const result = action ? choreAction(read.rows.find(x => x.id === raw.id), action) : { ok: true, chore: sharedChore(raw) };
    if (!result.ok || !result.chore) return { ok: false, why: result.why || 'bad-shape' };
    const index = read.rows.findIndex(x => x.id === result.chore.id);
    if (index < 0) {
        if (read.rows.length >= SC_LIMITS.chores) return { ok: false, why: 'limit' };
        read.rows.push(result.chore);
    } else {
        if (!action) return { ok: false, why: 'already-exists' };
        read.rows[index] = result.chore;
    }
    try {
        storage.set(SC_KEY, JSON.stringify(read.rows), false);
        const got = readChores(storage);
        if (!got.ok || JSON.stringify(got.rows) !== JSON.stringify(read.rows)) return { ok: false, why: 'write-failed' };
        return { ok: true, chore: result.chore };
    } catch (_) { return { ok: false, why: 'write-failed' }; }
}
