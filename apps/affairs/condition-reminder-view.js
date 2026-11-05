import { CONDITION_REMINDER_KEY, readConditionReminders, evaluateConditionReminders } from '../../config/condition-reminder-store.js';
import { conditionReminderSources } from '../../config/condition-reminder-sources.js';
import { reminderPreview } from '../../config/condition-reminder.js';
export class ConditionReminderView {
    constructor(app) { this.app = app; this.notice = ''; }
    render(container) {
        const storage = this.app.storage;
        const source = conditionReminderSources(storage);
        source.sources.reply = true;
        const log = globalThis.window?.VirtualPhone?.notificationLog;
        const evaluation = evaluateConditionReminders(storage, source.events, source.sources, log);
        const read = readConditionReminders(storage);
        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
        container.innerHTML = '<section class="er-root"><h3>条件提醒</h3><p>任务完成及指定人文字回复可用；地点新记录暂不可用。数据更新时检查，无需后台模型。</p><p role="status">' + esc(this.notice || (!read.ok ? '提醒记录读不出来' : !evaluation.ok ? '通知入口未就绪或保存失败：' + evaluation.why : '')) + '</p>'
            + read.rules.map(r => '<div class="er-row">' + esc(r.label || r.target) + ' · ' + (r.receipt?.notificationId ? '已提醒，来源：' + esc(r.receipt.eventId) : r.enabled ? '等待条件满足' : '已禁用') + '<button data-rule="' + esc(r.id) + '">' + (r.enabled ? '禁用' : '启用') + '</button></div>').join('')
            + '<form><label>条件<select name="kind"><option value="task-completed">任务完成</option><option value="reply">指定人有效文字回复</option></select></label><label>限定聊天 ID（可选，留空匹配所有聊天）<input name="chatId"></label><label>回复发送人（准确名称）<input name="sender"></label><label>任务<select name="target">' + source.targets.map(t => '<option value="' + esc(t.id) + '">' + esc(t.label) + '</option>').join('') + '</select></label><button' + (!read.ok ? ' disabled' : '') + '>预览并创建提醒</button></form></section>';
        const write = rules => {
            try {
                storage.set(CONDITION_REMINDER_KEY, JSON.stringify(rules), false);
                const back = readConditionReminders(storage);
                this.notice = back.ok && JSON.stringify(back.rules) === JSON.stringify(rules) ? '已保存' : '保存未确认';
            } catch (_) { this.notice = '保存失败'; }
            this.render(container);
        };
        container.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            if (read.rules.length >= 40) { this.notice = '最多 40 条提醒'; this.render(container); return; }
            const form = new FormData(event.currentTarget);
            const kind = form.get('kind');
            const target = form.get('target');
            const sender = String(form.get('sender') || '').trim();
            const item = kind === 'reply' ? (sender ? { id: sender, label: sender + ' 的有效文字回复' } : null) : source.targets.find(t => t.id === target);
            if (!item) return;
            const rule = { id: globalThis.crypto.randomUUID(), kind, chatId: String(form.get('chatId') || '').trim(), target: item.id, label: item.label, enabled: true, createdAt: Date.now() };
            const preview = reminderPreview(rule, source.sources);
            if (preview.available && globalThis.confirm('等待条件满足：' + item.label + '。满足后提醒一次，确认创建？')) write([...read.rules, rule]);
        });
        container.querySelectorAll('[data-rule]').forEach(button => button.addEventListener('click', () => write(read.rules.map(r => r.id === button.dataset.rule ? { ...r, enabled: !r.enabled } : r))));
    }
}