import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) {}
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const dump = (tag) => {
  const stack = document.querySelector('.view-stack-container');
  const ids = stack ? [...stack.querySelectorAll('[data-view-id]')].map((v) => v.getAttribute('data-view-id') + '|' + getComputedStyle(v).display + '|' + Math.round(v.getBoundingClientRect().width) + 'x' + Math.round(v.getBoundingClientRect().height)) : ['no-stack'];
  report({ name: tag, ok: true, detail: JSON.stringify(ids) + ' stack=' + !!stack });
};
dump('before');
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
await new Promise((r) => setTimeout(r, 3000));
dump('after-wechat-3s');
const wc = window.VirtualPhone.wechatApp;
report({ name: 'wechatApp', ok: true, detail: wc ? 'exists, shell=' + !!wc.phoneShell : 'none' });
if (wc) {
  const t0 = performance.now();
  try { wc.render(); } catch (e) { report({ name: 'render-throw', ok: false, detail: String(e && e.message).slice(0, 200) }); }
  report({ name: 'render-ms', ok: true, detail: Math.round(performance.now() - t0) + 'ms' });
  await new Promise((r) => setTimeout(r, 500));
  dump('after-manual-render');
}
done();
