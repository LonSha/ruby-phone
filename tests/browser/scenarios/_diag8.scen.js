import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
report({ name: 'healthy', ok: true, detail: 'stack=' + !!document.querySelector('.view-stack-container') });
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'theater' } }));
await new Promise((r) => setTimeout(r, 2500));
report({ name: 'after-theater', ok: true, detail: 'stack=' + !!document.querySelector('.view-stack-container') + ' screenChildren=' + [...(document.querySelector('.phone-screen') || { children: [] }).children].map((c) => String(c.className).slice(0, 20)).join(',') });
/* 试恢复：再点一次抽屉触发 */
const t2 = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (t2) { t2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); t2.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true })); }
const back2 = await waitFor(() => !!document.querySelector('.home-screen') && !!document.querySelector('.view-stack-container'), { timeoutMs: 8000 });
report({ name: 'recover-via-drawer', ok: back2, detail: 'home+stack=' + back2 + ' children=' + [...(document.querySelector('.phone-screen') || { children: [] }).children].map((c) => String(c.className).slice(0, 24)).join(',') });
const t3 = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
report({ name: 'drawer-trigger-exists', ok: true, detail: 't2=' + !!t2 + ' t3=' + !!t3 });
done();
