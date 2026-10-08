import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
report({ name: 'modal-at-start', ok: true, detail: 'exists=' + !!document.getElementById('st-phone-update-modal') });
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
await waitFor(() => !!document.querySelector('.view-stack-container .phone-view-current[data-view-id="wechat-main"]'), { timeoutMs: 8000 });
await new Promise((r) => setTimeout(r, 800));
report({ name: 'modal-after-open', ok: true, detail: 'exists=' + !!document.getElementById('st-phone-update-modal') });
const view = document.querySelector('.view-stack-container .phone-view-current');
const samples = [];
let probed = 0;
for (const el of view.querySelectorAll('*')) {
  if (probed >= 6) break;
  const er = el.getBoundingClientRect();
  if (er.width <= 0 || er.height <= 0) continue;
  const cx = er.left + er.width / 2, cy = er.top + er.height / 2;
  if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
  probed += 1;
  const hit = document.elementFromPoint(cx, cy);
  samples.push({ el: el.tagName + '.' + String(el.className).slice(0, 24), pt: [Math.round(cx), Math.round(cy)], hit: hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) + '#' + (hit.id || '') : 'null' });
}
report({ name: 'samples', ok: true, detail: JSON.stringify(samples) });
report({ name: 'viewport', ok: true, detail: 'innerW=' + innerWidth + ' innerH=' + innerHeight + ' viewBox=' + JSON.stringify([Math.round(view.getBoundingClientRect().left), Math.round(view.getBoundingClientRect().width)]) });
const stack = document.querySelector('.view-stack-container');
report({ name: 'stackbox', ok: true, detail: JSON.stringify([Math.round(stack.getBoundingClientRect().left), Math.round(stack.getBoundingClientRect().width)]) });
const scr = document.querySelector('.phone-screen');
report({ name: 'screenbox', ok: true, detail: JSON.stringify([Math.round(scr.getBoundingClientRect().left), Math.round(scr.getBoundingClientRect().width)]) });
done();
