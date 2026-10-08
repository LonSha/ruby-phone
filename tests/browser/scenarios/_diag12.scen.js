import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
const errs = [];
window.addEventListener('error', (e) => errs.push('ERR:' + (e.message || '')));
window.addEventListener('unhandledrejection', (e) => errs.push('REJ:' + String((e.reason && e.reason.message) || e.reason)));
const oe = console.error, ow = console.warn;
console.error = (...a) => { errs.push('CE:' + a.map((x) => String((x && x.stack) || x)).join(' ').slice(0, 300)); oe(...a); };
console.warn = (...a) => { errs.push('CW:' + a.map((x) => String((x && x.message) || x)).join(' ').slice(0, 200)); ow(...a); };
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const ms = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (ms) { const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 }); }
const cur = () => { const v = document.querySelector('.view-stack-container .phone-view-current'); return v ? v.getAttribute('data-view-id') : 'none'; };
const layers = () => [...document.querySelectorAll('.view-stack-container [data-view-id]')].map((v) => v.getAttribute('data-view-id'));
for (const id of ['diagnose', 'taskentry', 'recall']) {
  await new Promise((r) => setTimeout(r, 620));
  errs.length = 0;
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: id } }));
  await new Promise((r) => setTimeout(r, 2200));
  const v = document.querySelector('.view-stack-container .phone-view-current');
  report({ name: 'app:' + id, ok: true, detail: 'current=' + cur() + ' layers=' + JSON.stringify(layers()) + ' textLen=' + (v ? String(v.textContent || '').replace(/\s+/g, '').length : -1) + ' errs=' + JSON.stringify(errs.slice(0, 3)) });
  const b = document.getElementById('phone-back-button');
  if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 700));
}
done();
