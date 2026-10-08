import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
const cur = () => { const v = document.querySelector('.view-stack-container .phone-view-current'); return v ? v.getAttribute('data-view-id') : 'none'; };
for (const id of ['music', 'album', 'calendar', 'games', 'settings']) {
  await new Promise((r) => setTimeout(r, 600));
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: id } }));
  await new Promise((r) => setTimeout(r, 1200));
  const opened = cur();
  const back = document.getElementById('phone-back-button');
  const backVisible = back ? getComputedStyle(back).display : '-';
  if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const s1 = cur();
  await new Promise((r) => setTimeout(r, 400));
  const s2 = cur();
  await new Promise((r) => setTimeout(r, 1200));
  const s3 = cur();
  report({ name: 'app:' + id, ok: true, detail: 'opened=' + opened + ' backBtnDisplay=' + backVisible + ' afterClick=' + s1 + ' +400ms=' + s2 + ' +1600ms=' + s3 });
}
done();
