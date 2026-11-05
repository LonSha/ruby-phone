import { readChores, saveChore } from '../../config/shared-chore-store.js';
import { choreSplit } from '../../config/shared-chore.js';
import { SC_LABEL } from '../../config/shared-chore-terms.js';
export class SharedChoreView {
    constructor(app) { this.app = app; this.notice = ''; }
    render(container) { this.container = container; this.draw(); }
    esc(value) { return String(value ?? '').replace(/[&<>"\x27]/g, c => '&#' + c.charCodeAt(0) + ';'); }
    draw() {
        const read = readChores(this.app.storage);
        const e = value => this.esc(value);
        this.container.innerHTML = '<section class="er-root"><h3>共同事项</h3><p role="status">' + e(this.notice || (read.ok ? '' : '共同清单读不出来，请勿覆盖原记录')) + '</p>'
            + read.rows.map(c => '<article class="er-row"><h4>' + e(c.title) + ' · ' + e(SC_LABEL[c.state]) + '</h4>'
                + c.tasks.map(t => '<div class="er-meta">' + e(t.title) + ' · 分派给 ' + e(t.assignee) + ' · ' + (t.done ? '已完成，执行人：' + e(t.executor) + ' · 操作记录时间：' + e(t.completedAt || '未知') : '尚未完成，代办人：' + e(t.executor || '未指定'))
                    + (!t.done && c.state !== 'cancelled' ? '<select aria-label="执行人" data-member="' + e(t.id) + '">' + c.members.map(m => '<option>' + e(m) + '</option>').join('') + '</select><button data-op="delegate" data-id="' + e(c.id) + '" data-task="' + e(t.id) + '">指定代办</button><button data-op="finish" data-id="' + e(c.id) + '" data-task="' + e(t.id) + '">记录完成</button>' : '') + '</div>').join('')
                + '<p>分摊草案（尚未付款）：' + choreSplit(c).rows.map(r => e(r.member) + ' ¥' + (r.cents / 100).toFixed(2)).join('；') + '</p>'
                + (c.state !== 'cancelled' && c.cents > 0 ? '<button data-op="finance" data-id="' + e(c.id) + '">确认本机分摊记录</button>' : '')
                + (c.state !== 'cancelled' ? '<button data-op="cancel" data-id="' + e(c.id) + '">作废共同事项</button>' : '') + '</article>').join('')
            + '<form><label>事项标题<input name="title" required maxlength="40"></label><label>参与人（每行一人）<textarea name="members" required></textarea></label><label>子项（每行：任务｜负责人）<textarea name="tasks" required></textarea></label><label>预计总费用（元）<input name="amount" type="number" min="0" step="0.01" value="0" required></label><button' + (read.ok ? '' : ' disabled') + '>新建共同事项</button></form></section>';
        this.container.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const amount = String(data.get('amount'));
            if (!/^\d+(\.\d{1,2})?$/.test(amount)) { this.notice = '金额需为非负数，最多两位小数'; this.draw(); return; }
            const [whole, fraction = ''] = amount.split('.');
            const raw = { id: 'sc_' + globalThis.crypto.randomUUID(), title: String(data.get('title')).trim(),
                members: String(data.get('members')).split('\n').map(s => s.trim()).filter(Boolean),
                tasks: String(data.get('tasks')).split('\n').filter(s => s.trim()).map((s, i) => { const [title, assignee] = s.split('｜'); return { id: 'task_' + i, title: title?.trim(), assignee: assignee?.trim() }; }),
                cents: Number(whole) * 100 + Number(fraction.padEnd(2, '0')) };
            const result = saveChore(this.app.storage, raw);
            this.notice = result.ok ? '共同事项已保存' : '保存失败：' + result.why; this.draw();
        });
        this.container.querySelectorAll('[data-op]').forEach(button => button.addEventListener('click', () => {
            if (button.dataset.op === 'finance') {
                const vp = globalThis.window?.VirtualPhone;
                if (!vp?.applyFinanceCommitAction) { this.notice = '财务确认入口暂不可用'; this.draw(); return; }
                if (!globalThis.confirm('确认将此分摊草案记入本机？此操作不代表付款或对方收款。')) return;
                const result = vp.applyFinanceCommitAction('commit', button.dataset.id);
                this.notice = result.note || '未收到财务回执'; this.draw(); return;
            }
            const card = button.closest('article');
            const select = Array.from(card.querySelectorAll('[data-member]')).find(el => el.dataset.member === button.dataset.task);
            const result = saveChore(this.app.storage, { id: button.dataset.id }, { op: button.dataset.op, taskId: button.dataset.task, member: select?.value, at: new Date().toISOString() });
            this.notice = result.ok ? '操作已保存' : '操作失败：' + result.why; this.draw();
        }));
    }
}
