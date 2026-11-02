import { APPS } from '../../config/apps.js';
import { getUsagePattern } from '../../config/usage-pattern.js';
import { formatDuration } from '../../config/usage-tracker.js';
const LABELS = { never: '还没打开过', rare: '偶尔打开', habitual: '经常打开', faded: '已经有一阵没打开' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' }[c]));
/** Independent settings section; existing groups and handlers are untouched. */
export function mountUsagePattern(root, storage) {
    const host = root?.querySelector('#tab-general');
    if (!host) return;
    host.querySelector('[data-usage-pattern]')?.remove();
    const api = getUsagePattern(storage);
    const state = api.summary(APPS.map(app => app.id));
    const section = host.ownerDocument.createElement('section');
    section.className = 'setting-section';
    section.dataset.usagePattern = 'true';
    section.innerHTML = `<h3>使用痕迹</h3>
        <label class="setting-item"><span>在本机记录并显示使用痕迹</span>
        <input type="checkbox" data-usage-enabled ${state.enabled ? 'checked' : ''}></label>
        <p class="setting-desc">默认关闭；仅记录打开次数、最后打开时间与访问间隔，不记录消息内容，不向角色提供，不进入角色导出或备份。数据留在这台设备，关闭后停止采集。</p>
        <p role="status" data-usage-status></p>
        <button type="button" data-usage-clear>清掉全部痕迹</button>
        ${state.enabled ? `<div>${state.rows.map(row => {
            const app = APPS.find(item => item.id === row.id);
            return `<details class="setting-item"><summary>${escape(app?.name || row.id)} · ${LABELS[row.state]}</summary>
                <div><p>${row.count} 次 · 访问间隔合计 ${escape(formatDuration(row.ms))}（并非真实前台时长，单次最多四小时）</p>
                <p>最后打开：${row.lastAt === null ? '尚无记录' : escape(new Date(row.lastAt).toLocaleString())}</p>
                <button type="button" data-usage-ack="${escape(row.id)}" ${row.count ? '' : 'disabled'}>${row.acknowledged ? '已承认这份痕迹' : '承认这份痕迹'}</button></div></details>`;
        }).join('')}</div>` : ''}`;
    host.append(section);
    const showResult = ok => {
        if (ok) mountUsagePattern(root, storage);
        else section.querySelector('[data-usage-status]').textContent = '本机存储不可用，未保存。';
    };
    section.querySelector('[data-usage-enabled]').addEventListener('change', event => showResult(api.configure(event.target.checked)));
    section.querySelector('[data-usage-clear]').addEventListener('click', () => {
        if (host.ownerDocument.defaultView?.confirm('清掉本机所有使用痕迹？不会删除角色或旧的会话统计。')) showResult(api.clear());
    });
    section.querySelectorAll('[data-usage-ack]').forEach(button => button.addEventListener('click', () => showResult(api.acknowledge(button.dataset.usageAck))));
}
