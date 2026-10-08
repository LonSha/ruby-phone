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
const cur = () => { const v = document.querySelector('.view-stack-container .phone-view-current'); return v ? v.getAttribute('data-view-id') : 'none'; };
const hist = () => { try { return JSON.stringify(window.VirtualPhone.phoneShell.viewHistory); } catch (e) { return 'n/a'; } };
const atHome = () => { const hv = document.querySelector('.view-stack-container [data-view-id="home"]'); return !!(hv && getComputedStyle(hv).display !== 'none' && hv.getBoundingClientRect().width > 0); };
for (const id of ['accounting', 'piggy']) {
  await new Promise((r) => setTimeout(r, 620));
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: id } }));
  await new Promise((r) => setTimeout(r, 1800));
  report({ name: 'open:' + id, ok: true, detail: 'current=' + cur() + ' hist=' + hist() + ' atHome=' + atHome() });
  const b = document.getElementById('phone-back-button');
  const vis = b ? getComputedStyle(b).display : '-';
  if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 500));
  report({ name: 'back:' + id, ok: true, detail: 'btnDisplay=' + vis + ' afterClick current=' + cur() + ' hist=' + hist() + ' atHome=' + atHome() + ' stack=' + !!document.querySelector('.view-stack-container') });
  await new Promise((r) => setTimeout(r, 900));
}
done();
