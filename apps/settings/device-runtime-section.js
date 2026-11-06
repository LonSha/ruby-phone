import { captureSessionToken, guardSessionWrite } from '../../config/session-gate.js';
import { deviceActionCatalog, dispatchDeviceAction, deviceRuntimeSummary, reviewDeviceNotifications } from '../../config/device-runtime.js';
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' }[c]));
/** User-operated simulation controls. Replaced on settings render; no global listeners. */
export function mountDeviceRuntimeSection(root, storage) {
    const host = root?.querySelector('#tab-general');
    if (!host) return;
    host.querySelector('[data-device-runtime]')?.remove();
    const doc = host.ownerDocument;
    const section = doc.createElement('section');
    section.className = 'setting-section';
    section.dataset.deviceRuntime = 'true';
    const token = captureSessionToken(storage);
    const current = () => guardSessionWrite(storage, token, 'device-settings');
    const state = deviceRuntimeSummary(storage);
    const catalog = deviceActionCatalog();
    section.innerHTML = `<h3>剧情设备模拟 · V20</h3>
        <p class="setting-desc">默认关闭，仅影响当前会话。无线、电源、终端、声纹与保险箱都是剧情模拟，不调用真实硬件、不提供实际加密或安全擦除。请勿保存真实密码或敏感资料。暗域正文不进入公开提示词。</p>
        <label class="setting-item">开启模拟 <input type="checkbox" data-device-enabled ${state.enabled ? 'checked' : ''}></label>
        <label class="setting-item">向角色提示已登记状态 <input type="checkbox" data-device-inject ${state.injectToPrompt ? 'checked' : ''}></label>
        <p data-device-summary></p>
        <label>设备操作 <select data-device-action aria-label="剧情设备操作">${catalog.map(a => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('')}</select></label>
        <p class="setting-desc">高级操作参数：以下为可修改的 JSON 示例，只有点击执行才生效。擦除仅清空本模拟器敏感条目，不删除微信/相册，不保证物理磁盘不可恢复。</p>
        <textarea data-device-params aria-label="设备操作 JSON 参数" rows="6" style="width:100%;box-sizing:border-box"></textarea>
        <button type="button" data-device-run>执行选定剧情操作</button>
        <button type="button" data-device-review>审阅离线模拟通知</button>
        <button type="button" data-device-reset>重置本会话模拟器</button>
        <p role="status" aria-live="polite" data-device-status></p><div data-device-notifications></div>`;
    host.append(section);
    const q = sel => section.querySelector(sel);
    const win = doc.defaultView;
    const status = result => {
        q('[data-device-status]').textContent = result.ok ? '操作已保存至当前会话。' : `未完成：${result.error}`;
        const s = deviceRuntimeSummary(storage);
        q('[data-device-summary]').textContent = s.ok ? `修订 ${s.revision} · 已登记子系统 ${s.active.join('、') || '无'} · 待审阅通知 ${s.pendingPushes}` : `状态不可读：${s.error}`;
        q('[data-device-enabled]').checked = s.enabled === true;
        q('[data-device-inject]').checked = s.injectToPrompt === true;
    };
    const setExample = () => { q('[data-device-params]').value = JSON.stringify(catalog.find(a => a.id === q('[data-device-action]').value).example,null,2); };
    setExample();
    status(state);
    q('[data-device-status]').textContent = state.ok ? '' : state.error;
    q('[data-device-action]').addEventListener('change',setExample);
    const configure = () => current() && status(dispatchDeviceAction(storage,'configure',{ enabled: q('[data-device-enabled]').checked, injectToPrompt: q('[data-device-inject]').checked },win));
    q('[data-device-enabled]').addEventListener('change',configure);
    q('[data-device-inject]').addEventListener('change',configure);
    q('[data-device-run]').addEventListener('click',() => {
        try {
            if (!current()) { status({ ok: false, error: '会话已变化，请重新打开设置' }); return; }
            const id = q('[data-device-action]').value;
            const p = JSON.parse(q('[data-device-params]').value);
            if (id === 'wipe' && !win?.confirm('仅清空本会话模拟器的敏感条目？此操作不可在模拟器内撤销，不会擦除真实磁盘。')) return;
            if (!current()) return;
            status(dispatchDeviceAction(storage,id,p,win));
        } catch (e) { status({ ok: false, error: String(e.message || e) }); }
    });
    q('[data-device-reset]').addEventListener('click',() => {
        if (current() && win?.confirm('重置本会话剧情设备状态并关闭模拟？') && current()) { status(dispatchDeviceAction(storage,'reset',{ confirm: true },win)); q('[data-device-notifications]').replaceChildren(); }
    });
    q('[data-device-review]').addEventListener('click',() => {
        if (!current()) return;
        const result = reviewDeviceNotifications(storage);
        status(result);
        const list = q('[data-device-notifications]'); list.replaceChildren();
        for (const n of result.items || []) { const row = doc.createElement('p'); row.textContent = `[剧情模拟通知] ${n.sender}：${n.preview}`; list.append(row); }
    });
}
