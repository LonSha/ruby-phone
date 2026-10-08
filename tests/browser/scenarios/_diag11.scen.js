import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const ms = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (ms) { const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 }); }
/* 1. \u6a21\u5757\u672c\u8eab\u80fd\u4e0d\u80fd\u52a8\u6001\u5bfc\u5165 */
try {
  const m = await import('/apps/clock/clock-app.js');
  report({ name: 'module-import', ok: true, detail: 'keys=' + JSON.stringify(Object.keys(m)) });
} catch (e) {
  report({ name: 'module-import', ok: false, detail: String(e && e.message) });
}
/* 2. \u6d3e\u53d1\u524d\u540e\u7684\u5355\u4f8b\u4e0e\u5b88\u536b */
await new Promise((r) => setTimeout(r, 700));
report({ name: 'guard-value', ok: true, detail: 'now=' + Date.now() + ' guardUntil=' + window.VirtualPhone._homeReturnGuardUntil + ' home=' + (document.querySelector('.view-stack-container .phone-view-current') || {}).dataset?.viewId });
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'clock' } }));
await new Promise((r) => setTimeout(r, 2500));
report({ name: 'after-clock', ok: true, detail: 'clockApp=' + (!!window.VirtualPhone.clockApp) + ' current=' + ((document.querySelector('.view-stack-container .phone-view-current') || { dataset: {} }).dataset.viewId || 'none') + ' layers=' + JSON.stringify([...document.querySelectorAll('.view-stack-container [data-view-id]')].map((v) => v.getAttribute('data-view-id'))) });
report({ name: 'shell-api', ok: true, detail: 'layerHost=' + typeof window.VirtualPhone.phoneShell?.layerHost + ' setContent=' + typeof window.VirtualPhone.phoneShell?.setContent });
done();
