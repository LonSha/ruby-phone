import { captureSessionToken, guardSessionWrite } from '../../config/session-gate.js';
import { liveSources, readLive, liveChanges, writeLive } from '../../config/affair-live.js';
export class AffairLiveView {
    constructor(app) { this.app = app; this.notice = ''; }
    render(root) {
        const storage = this.app.storage;
        const sessionToken = captureSessionToken(storage);
        const read = readLive(storage); const sources = liveSources(storage);
        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
        root.innerHTML = '<section><h3>事件实况</h3><p role="status">' + esc(this.notice || (!read.ok ? '实况记录读不出来' : sources.unavailable.length ? '暂不可用：' + sources.unavailable.join('、') : '刷新读取真实来源；标记已看只更新查看记录')) + '</p><button data-live-refresh>刷新来源</button>'
            + read.rows.map(entry => '<article><h4>' + esc(entry.title) + '</h4>' + liveChanges(entry, sources).map(row => '<p>' + esc(row.label) + ' · ' + row.state + '</p>').join('') + '<button data-live-seen="' + esc(entry.id) + '">标记本次已看</button><button data-live-edit="' + esc(entry.id) + '">调整来源</button><button data-live-delete="' + esc(entry.id) + '">删除实况</button></article>').join('')
            + '<form><label>事件名称<input name="title" maxlength="80" required></label><fieldset><legend>选择真实来源（最多24条）</legend>' + sources.rows.map(row => '<label><input type="checkbox" name="ref" value="' + esc(row.key) + '">' + esc(row.label) + ' · ' + esc(row.key.split(':')[0]) + '</label>').join('') + '</fieldset><button' + (!read.ok ? ' disabled' : '') + '>创建实况</button></form></section>';
        const save = rows => { if (!guardSessionWrite(storage, sessionToken, 'affair-live')) { this.notice = '会话已变化，请重新打开实况'; this.render(root); return; } this.notice = writeLive(storage, rows) ? '已保存' : '保存未确认'; this.render(root); };
        root.querySelector('[data-live-refresh]').onclick = () => this.render(root);
        root.querySelector('form').onsubmit = event => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            const refs = [...new Set(form.getAll('ref'))];
            if (!refs.length || refs.length > 24 || read.rows.length >= 40) { this.notice = '请选择1–24条来源，最多40个实况'; this.render(root); return; }
            const fresh = readLive(storage);
            if (!fresh.ok || JSON.stringify(fresh.rows) !== JSON.stringify(read.rows)) { this.notice = '实况记录已变化，请刷新后创建'; this.render(root); return; }
            save([...fresh.rows, { id: crypto.randomUUID(), title: String(form.get('title')).trim(), refs, seen: {} }]);
        };
        root.querySelectorAll('[data-live-seen]').forEach(button => button.onclick = () => {
            const fresh = readLive(storage); if (!fresh.ok) return;
            const current = sources;
            const displayed = read.rows.find(entry => entry.id === button.dataset.liveSeen);
            if (!displayed || JSON.stringify(displayed) !== JSON.stringify(fresh.rows.find(entry => entry.id === displayed.id))) { this.notice = '实况记录已变化，请刷新后查看'; this.render(root); return; }
            save(fresh.rows.map(entry => entry.id !== button.dataset.liveSeen ? entry : { ...entry, seen: Object.fromEntries(entry.refs.map(key => [key, current.rows.find(r => r.key === key)?.value ?? entry.seen[key]]).filter(([,value]) => value !== undefined)) }));
        });
        root.querySelectorAll('[data-live-edit]').forEach(button => button.onclick = () => {
            const fresh = readLive(storage); const entry = fresh.rows.find(e => e.id === button.dataset.liveEdit);
            if (!fresh.ok || !entry) return;
            const current = liveSources(storage);
            const answer = prompt('填写要保留的来源编号，逗号分隔：' + current.rows.map((r,i) => '\n' + (i+1) + '. ' + r.label).join(''));
            if (answer === null) return;
            const indices = [...new Set(answer.split(/[,，]/).map(v => Number(v.trim()) - 1))];
            if (!indices.length || indices.length > 24 || indices.some(i => !Number.isInteger(i) || !current.rows[i])) { this.notice = '来源编号无效'; this.render(root); return; }
            const latest = readLive(storage);
            if (!latest.ok || JSON.stringify(latest.rows) !== JSON.stringify(fresh.rows)) { this.notice = '实况记录已变化，请刷新后调整'; this.render(root); return; }
            const refs = indices.map(i => current.rows[i].key);
            const seen = Object.fromEntries(Object.entries(entry.seen).filter(([key]) => refs.includes(key)));
            save(fresh.rows.map(e => e.id === entry.id ? {...e, refs, seen} : e));
        });
        root.querySelectorAll('[data-live-delete]').forEach(button => button.onclick = () => {
            if (!confirm('删除实况查看记录？原内容保留。')) return;
            const fresh = readLive(storage); if (fresh.ok) save(fresh.rows.filter(e => e.id !== button.dataset.liveDelete));
        });
    }
}