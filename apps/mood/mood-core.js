import { RECALL_PERMISSION } from '../../config/recall-filter.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function counter(value) {
    if (value == null) return 0; // Optional counters are absent until the first event.
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function projectMoodMemory(core) {
    if (!isRecord(core)) return null;
    const tier = { cite: 0, cautious: 0, associate: 0, unlabelled: 0 };
    let longTermCount = 0;
    for (const entry of Array.isArray(core.longTerm) ? core.longTerm : []) {
        if (!isRecord(entry)) continue;
        longTermCount++;
        switch (entry.metadata?._permission) {
            case RECALL_PERMISSION.CITE: tier.cite++; break;
            case RECALL_PERMISSION.CAUTIOUS: tier.cautious++; break;
            case RECALL_PERMISSION.ASSOCIATE: tier.associate++; break;
            default: tier.unlabelled++;
        }
    }
    return {
        longTermCount, shortTermCount: Array.isArray(core.shortTerm) ? core.shortTerm.filter(isRecord).length : 0,
        consolidated: counter(core.stats?.consolidated), superseded: counter(core.stats?.superseded),
        tombstoned: counter(core.stats?.tombstoned), tier
    };
}
