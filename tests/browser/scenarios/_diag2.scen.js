import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const dots = [...document.querySelectorAll('.home-page-dot')];
report({ name: 'dots', ok: true, detail: JSON.stringify(dots.map((d) => ({ cls: d.className, di: d.dataset.pageIndex, outer: d.outerHTML.slice(0, 90) }))) });
const pager = document.querySelector('.home-screen .app-grid-pager') || document.querySelector('[data-page-count]');
report({ name: 'pager', ok: true, detail: pager ? (pager.className + ' | dc=' + pager.dataset.pageCount + ' | style=' + pager.getAttribute('style')) : 'none' });
const pages = [...document.querySelectorAll('.home-screen .app-grid-page')];
const boxOf = (i) => { const r = pages[i].getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
report({ name: 'before', ok: true, detail: JSON.stringify(pages.map((p, i) => ({ i: i, ah: p.getAttribute('aria-hidden'), box: boxOf(i) }))) });
const dot1 = document.querySelector('.home-page-dot[data-page-index="1"]');
if (dot1) dot1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 1500));
report({ name: 'after', ok: true, detail: JSON.stringify(pages.map((p, i) => ({ i: i, ah: p.getAttribute('aria-hidden'), box: boxOf(i) }))) });
/* 试直接用分页函数 */
const hs = window.VirtualPhone && window.VirtualPhone.homeScreen;
report({ name: 'homeScreen-instance', ok: true, detail: hs ? 'yes goIconPage=' + (typeof hs.goIconPage) : 'no' });
if (hs && typeof hs.goIconPage === 'function') {
  hs.goIconPage(1);
  await new Promise((r) => setTimeout(r, 1200));
  report({ name: 'after-direct', ok: true, detail: JSON.stringify(pages.map((p, i) => ({ i: i, ah: p.getAttribute('aria-hidden'), box: boxOf(i) }))) });
}
done();
