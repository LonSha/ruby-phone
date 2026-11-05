import { readChores } from './shared-chore-store.js';
/** Only the completed-task owner is verified here. Other source types remain unavailable. */
export function conditionReminderSources(storage) {
    const read = readChores(storage);
    const events = [];
    if (read.ok) for (const chore of read.rows) {
        for (const task of chore.tasks) {
            const at = Date.parse(task.completedAt);
            if (task.done && Number.isFinite(at)) events.push({ id: chore.id + ':' + task.id + ':' + task.completedAt,
                kind: 'task-completed', target: chore.id + ':' + task.id, at, valid: true });
        }
    }
    return { sources: { reply: false, 'task-completed': read.ok, 'location-record': false }, events,
        targets: read.rows.flatMap(chore => chore.tasks.filter(task => !task.done && chore.state !== 'cancelled').map(task => ({ id: chore.id + ':' + task.id, label: chore.title + ' / ' + task.title }))) };
}