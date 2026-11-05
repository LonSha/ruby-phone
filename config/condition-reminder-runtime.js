import { conditionReminderSources } from './condition-reminder-sources.js';
import { evaluateConditionReminders } from './condition-reminder-store.js';
/** Runs only at owner mutations or explicit page reads; no timers, listeners or model calls. */
export function checkConditionReminders(storage, incoming = null) {
    const source = conditionReminderSources(storage);
    const log = globalThis.window?.VirtualPhone?.notificationLog;
    if (incoming) source.events.push(incoming);
    return evaluateConditionReminders(storage, source.events, { ...source.sources, reply: true }, log);
}
export function receivedReplyCondition(storage, chatId, message) {
    if (!message || !message.id || !message.sender || ['me', 'system'].includes(message.sender) || message.type !== 'text' || !String(message.content || '').trim() || message.isTimeMarker || message.hiddenFromPreview) return;
    return checkConditionReminders(storage, { id: String(chatId) + ':' + message.id, kind: 'reply', chatId: String(chatId), target: String(message.sender), at: message.realTimestamp, valid: true });
}