import { numOrNull } from '../../config/num-gate.js';

function timeOf(row) {
    return numOrNull(row?.storyTimestamp) ?? numOrNull(row?.timestamp) ?? 0;
}

export function orderOfflineRows(rows) {
    return Array.isArray(rows) ? rows.slice().sort((a, b) => timeOf(a) - timeOf(b)) : [];
}
