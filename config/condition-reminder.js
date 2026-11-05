/* R14-X3: pure matching only. Source adapters must supply stable IDs and real availability. */
export function reminderPreview(rule, sources) {
    const kind = String(rule?.kind || '');
    if (!['reply', 'task-completed', 'location-record'].includes(kind) || !String(rule?.target || '').trim()) {
        return { available: false, why: '条件缺少类型或对象' };
    }
    return sources?.[kind] === true
        ? { available: true, why: '', text: '等待 ' + rule.target + ' 的' + ({ reply: '有效回复', 'task-completed': '任务完成回执', 'location-record': '地点新记录' }[kind]) }
        : { available: false, why: '暂不可用：没有接入真实事件源' };
}
export function matchReminder(rule, event, sources) {
    const preview = reminderPreview(rule, sources);
    if (!preview.available || rule.enabled !== true || rule.receipt) return { matched: false };
    if (!event || typeof event.id !== 'string' || !event.id.trim() || event.kind !== rule.kind || event.target !== rule.target) return { matched: false };
    if (!Number.isFinite(event.at) || !Number.isFinite(rule.createdAt) || event.at <= rule.createdAt) return { matched: false };
    if (rule.kind === 'reply' && rule.chatId && event.chatId !== rule.chatId) return { matched: false };
    if (event.valid !== true) return { matched: false };
    return { matched: true, receipt: { eventId: event.id, kind: event.kind, target: event.target, at: event.at } };
}