import { matchReminder } from './condition-reminder.js';
export const CONDITION_REMINDER_KEY = 'wf_condition_reminders_v1';
export function readConditionReminders(storage) {
    try {
        const raw = storage.get(CONDITION_REMINDER_KEY, false);
        const rules = raw == null ? [] : typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(rules) || rules.length > 40 || rules.some(r => !r || typeof r.id !== 'string' || !r.id || !['reply', 'task-completed', 'location-record'].includes(r.kind) || typeof r.target !== 'string' || !r.target || !Number.isFinite(r.createdAt) || typeof r.enabled !== 'boolean' || (r.chatId != null && typeof r.chatId !== 'string') || (r.receipt != null && (typeof r.receipt.eventId !== 'string' || r.receipt.eventId.length === 0 || r.receipt.kind !== r.kind || r.receipt.target !== r.target || Number.isFinite(r.receipt.at) === false || r.receipt.at <= r.createdAt))) || new Set(rules.map(r => r.id)).size !== rules.length) return { ok: false, rules: [] };
        return { ok: true, rules };
    } catch (_) { return { ok: false, rules: [] }; }
}
/** Notification identity is persisted before delivery; retry resolves by senderKey after interruption. */
export function evaluateConditionReminders(storage, events, sources, log) {
    const read = readConditionReminders(storage);
    if (!read.ok || !log || typeof log.push !== 'function' || typeof log.list !== 'function') return { ok: false, why: 'source-unavailable' };
    let triggered = 0;
    for (const rule of read.rules) {
        if (rule.enabled !== true || rule.receipt?.notificationId) continue;
        if (!rule.receipt) {
            const hit = events.map(event => matchReminder(rule, event, sources)).find(result => result.matched);
            if (!hit) continue;
            rule.receipt = hit.receipt;
            try { storage.set(CONDITION_REMINDER_KEY, JSON.stringify(read.rules), false); }
            catch (_) { return { ok: false, why: 'write-failed' }; }
            const back = readConditionReminders(storage);
            if (!back.ok || !back.rules.find(r => r.id === rule.id)?.receipt) return { ok: false, why: 'write-failed' };
        }
        const senderKey = 'condition-reminder:' + rule.id;
        const previous = log.list().find(row => row.senderKey === senderKey);
        const result = previous || log.push({ title: '条件提醒', message: '已等到：' + (rule.label || rule.target) + '；来源：' + rule.receipt.eventId, appId: 'calendar', senderKey,
            meta: { conditionSource: rule.receipt } });
        if (!result?.id) return { ok: false, why: 'notification-failed' };
        if (typeof log.flushNow === 'function') log.flushNow();
        rule.receipt.notificationId = result.id;
        try { storage.set(CONDITION_REMINDER_KEY, JSON.stringify(read.rules), false); }
        catch (_) { return { ok: false, why: 'write-failed' }; }
        const saved = readConditionReminders(storage);
        if (!saved.ok || saved.rules.find(r => r.id === rule.id)?.receipt?.notificationId !== result.id) return { ok: false, why: 'write-failed' };
        triggered++;
    }
    return { ok: true, triggered };
}