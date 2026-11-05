/* R14-X4: execution receipts and cost proposals are independent. Money uses integer cents. */
import { SC_STATES, SC_LIMITS, SC_WHY, SC_SPLIT_STATES } from './shared-chore-terms.js';
const text = v => typeof v === 'string' ? v.trim() : '';
const fail = why => ({ ok: false, why });
export function sharedChore(raw) {
    if (!raw || !text(raw.id) || !text(raw.title)) return null;
    if (!Array.isArray(raw.members) || !raw.members.length || raw.members.length > SC_LIMITS.members) return null;
    const members = raw.members.map(text);
    if (members.some(x => !x) || new Set(members).size !== members.length) return null;
    if (!Array.isArray(raw.tasks) || !raw.tasks.length || raw.tasks.length > SC_LIMITS.subs) return null;
    if (raw.tasks.some(t => !t || typeof t !== 'object')) return null;
    const tasks = raw.tasks.map(t => ({ id: text(t.id), title: text(t.title), completedAt: text(t.completedAt), assignee: text(t.assignee), executor: text(t.executor), done: t.done === true }));
    if (tasks.some(t => !t.id || !t.title || !members.includes(t.assignee) || (t.executor && !members.includes(t.executor))) || new Set(tasks.map(t => t.id)).size !== tasks.length) return null;
    const cents = raw.cents;
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > SC_LIMITS.amountMax * 100) return null;
    const done = tasks.filter(t => t.done).length;
    return { id: text(raw.id), title: text(raw.title).slice(0, SC_LIMITS.titleChars), members, tasks, cents,
        state: raw.state === SC_STATES.cancelled ? SC_STATES.cancelled : done === tasks.length ? SC_STATES.done : done ? SC_STATES.partial : SC_STATES.assigned };
}
export function choreAction(raw, action) {
    const chore = sharedChore(raw);
    if (!chore || !action || typeof action !== 'object') return fail(SC_WHY.badShape);
    if (chore.state === SC_STATES.cancelled) return fail('already-cancelled');
    if (action.op === 'cancel') return { ok: true, chore: { ...chore, state: SC_STATES.cancelled } };
    const task = chore.tasks.find(t => t.id === action.taskId);
    if (!task) return fail('sub-not-found');
    if (task.done) return fail('sub-already-done');
    if (!chore.members.includes(action.member)) return fail('not-involved');
    if (action.op === 'delegate') task.executor = action.member;
    else if (action.op === 'finish') {
        if (!text(action.at) || !Number.isFinite(Date.parse(action.at))) return fail(SC_WHY.badShape);
        task.executor = action.member; task.done = true; task.completedAt = action.at;
    }
    else return fail(SC_WHY.badShape);
    return { ok: true, chore: sharedChore(chore) };
}
export function choreSplit(raw) {
    const chore = sharedChore(raw);
    if (!chore) return fail(SC_WHY.badShape);
    const base = Math.floor(chore.cents / chore.members.length);
    const remainder = chore.cents % chore.members.length;
    return { ok: true, currency: 'CNY', totalCents: chore.cents, paid: false,
        rows: chore.members.map((member, i) => ({ member, cents: base + (i < remainder ? 1 : 0), state: SC_SPLIT_STATES.draft })) };
}
