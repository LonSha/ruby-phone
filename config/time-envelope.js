import { readChores } from './shared-chore-store.js';
import { publicExperiencePhotos } from './experience-media.js';
export const ENVELOPE_KEY = 'tw_envelopes_v1';
export function validDay(day) { return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day; }
export function envelopeReady(entry, clock, storage) {
    if (entry.withdrawn) return false;
    if (entry.eventTarget) {
        const read = readChores(storage);
        return read.ok && read.rows.some(chore => chore.state !== 'cancelled' && chore.tasks.some(task => chore.id + ':' + task.id === entry.eventTarget && task.done && Number.isFinite(Date.parse(task.completedAt)) && Date.parse(task.completedAt) > entry.createdAt));
    }
    return !clock?.conflict && validDay(clock?.primaryDate) && clock.primaryDate >= entry.day;
}
export function envelopeEvents(storage) { const read=readChores(storage); return read.ok ? read.rows.flatMap(chore=>chore.state==='cancelled'?[]:chore.tasks.filter(task=>!task.done).map(task=>({id:chore.id+':'+task.id,label:chore.title+' / '+task.title}))) : []; }
export function readEnvelopes(storage) {
    try { const raw = storage.get(ENVELOPE_KEY); const rows = raw == null ? [] : typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(rows) || rows.length > 40 || new Set(rows.map(r=>r?.id)).size !== rows.length || rows.some(r=>!r || typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim() || (!r.eventTarget ? !validDay(r.day) : typeof r.eventTarget !== 'string' || !r.eventTarget.trim() || !Number.isFinite(r.createdAt)) || !Array.isArray(r.snapshots) || !r.snapshots.length || r.snapshots.length > 24 || r.snapshots.some(s=>typeof s.ref !== 'string' || typeof s.text !== 'string'))) return {ok:false,rows:[]};
        return {ok:true,rows};
    } catch (_) { return {ok:false,rows:[]}; }
}
export async function writeEnvelopes(storage, rows, expected) {
    const before = readEnvelopes(storage);
    if (!before.ok || JSON.stringify(before.rows) !== expected || !readEnvelopes({get:()=>rows}).ok) return false;
    try { await storage.set(ENVELOPE_KEY, rows); return JSON.stringify(readEnvelopes(storage).rows) === JSON.stringify(rows); } catch (_) { return false; }
}
export function envelopeMaterials(storage) {
    const rows=[];
    for (const [key,kind] of [['tw_letters','letter'],['calendar_memos','calendar']]) {
        try { const raw=storage.get(key); const list=typeof raw==='string'?JSON.parse(raw):raw;
            if (!Array.isArray(list)) continue;
            for (const item of list) { if (!item || !item.id || item.secret || item.private || item.hidden) continue;
                const text=kind==='letter' ? (item.paragraphs||[]).join('\n') : String(item.title || item.caption || item.description || '');
                if (text) rows.push({ref:kind+':'+item.id,title:String(item.title || item.caption || item.id),text:text.slice(0,8000)});
            }
        } catch (_) {}
    }
    rows.push(...publicExperiencePhotos(storage));
    return rows;
}
