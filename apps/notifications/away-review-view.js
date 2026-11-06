import { captureSessionToken, guardSessionWrite } from '../../config/session-gate.js';
import { buildOpenDetail } from '../../config/app-open-detail.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const labels = { later: '稍后', seen: '已看', handle: '去处理', dismiss: '无需处理' };
export function renderAwayReview(root, away, orderRows = rows => rows) {
    const token = captureSessionToken(away.storage);
    const rows = orderRows(away.getMissedSummary().raw);
    let group = away.reviewCursor?.group || 'all'; let page = away.reviewCursor?.page || 0;
    function draw(notice = '') {
        const filtered = rows.filter(item => group === 'all' || item.appId === group);
        page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 5) - 1));
        const batch = filtered.slice(page * 5, page * 5 + 5);
        root.innerHTML = '<section><h3>分批处理</h3><p role="status">' + esc(notice || '每批5条；逐条状态会保存，已看不等于已回复。') + '</p><label>按应用分组<select>' + ['all', ...new Set(rows.map(item => item.appId))].map(id => '<option value="' + esc(id) + '"' + (id === group ? ' selected' : '') + '>' + esc(id === 'all' ? '全部' : id) + '</option>').join('') + '</select></label>' + batch.map(item => '<article><b>' + esc(item.title) + '</b><p>' + esc(item.body) + '</p><p>' + esc(labels[item.reviewStatus] || '未审阅') + '</p>' + Object.entries(labels).map(([status,label]) => '<button data-id="' + esc(item.id) + '" data-status="' + status + '">' + label + '</button>').join('') + '</article>').join('') + '<button data-prev>上一批</button><span>第' + (page + 1) + '批</span><button data-next>下一批</button></section>';
        const persistCursor = async () => guardSessionWrite(away.storage, token, 'away-review-cursor') && await away.saveReviewCursor(group, page);
        root.querySelector('select').onchange = async event => { group = event.target.value; page = 0; draw(await persistCursor() ? '' : '进度保存未确认'); };
        root.querySelector('[data-prev]').onclick = async () => { page = Math.max(0, page - 1); draw(await persistCursor() ? '' : '进度保存未确认'); };
        root.querySelector('[data-next]').onclick = async () => { if ((page + 1) * 5 < filtered.length) page++; draw(await persistCursor() ? '' : '进度保存未确认'); };
        root.querySelectorAll('[data-status]').forEach(button => button.onclick = async () => {
            if (!guardSessionWrite(away.storage, token, 'away-review')) { draw('会话已变化，请重新打开'); return; }
            if (!confirm('确认标记为“' + labels[button.dataset.status] + '”？原通知动作仍需在原应用确认。')) return;
            if (!guardSessionWrite(away.storage, token, 'away-review')) return;
            const original = batch.find(item => item.id === button.dataset.id);
            const current = away.getMissedSummary().raw.filter(item => item.id === original?.id);
            if (current.length !== 1 || JSON.stringify(current[0]) !== JSON.stringify(original)) { draw('来源已变化，请重新打开'); return; }
            if (!await away.reviewMissed(original.id, button.dataset.status)) { draw('保存未确认'); return; }
            if (!guardSessionWrite(away.storage, token, 'away-review')) return;
            Object.assign(original, away.getMissedSummary().raw.find(item => item.id === original.id));
            draw('已保存审阅状态');
            if (button.dataset.status === 'handle') window.dispatchEvent(new CustomEvent('phone:openApp', { detail: buildOpenDetail(original.appId) }));
        });
    }
    draw();
}
