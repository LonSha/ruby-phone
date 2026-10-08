import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const mod = await import('/config/apps.js');
const ids = mod.APPS.map((a) => a.id).slice(0, 4);
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
report({ name: 'ids', ok: true, detail: JSON.stringify(ids) });
for (const id of ids) {
  const t0 = performance.now();
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: id } }));
  const view = await waitFor(() => {
    const v = document.querySelector('.view-stack-container [data-view-id="view-' + id + '"]');
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? v : null;
  }, { timeoutMs: 5000, stepMs: 40 });
  const t1 = performance.now();
  const back = document.getElementById('phone-back-button');
  if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const t2 = performance.now();
  const homeBack = await waitFor(() => {
    const hv = document.querySelector('.view-stack-container [data-view-id="home"]');
    return hv && getComputedStyle(hv).display !== 'none' && hv.getBoundingClientRect().width > 0 ? true : null;
  }, { timeoutMs: 3000, stepMs: 40 });
  const t3 = performance.now();
  report({ name: 'app:' + id, ok: true, detail: 'view=' + !!view + '(' + Math.round(t1 - t0) + 'ms) backBtn=' + !!back + ' homeBack=' + !!homeBack + '(' + Math.round(t3 - t2) + 'ms) total=' + Math.round(t3 - t0) + 'ms' });
}
done();
