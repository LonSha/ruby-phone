import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (_e) { /* 读数判定 */ }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const ms = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (ms) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
report({ name: 'viewport', ok: true, detail: 'w=' + window.innerWidth + ' h=' + window.innerHeight });
const pages = [...document.querySelectorAll('.home-screen .app-grid-page')];
report({ name: 'pages', ok: true, detail: '页数=' + pages.length + ' 宽=' + pages.map((p) => Math.round(p.getBoundingClientRect().width)).join(',') });
const iconEls = [...document.querySelectorAll('.home-screen .app-icon, .home-screen .dock-app, .home-screen .home-widget-card')];
const fmt = (el) => {
  const r = el.getBoundingClientRect();
  const pg = el.closest('.app-grid-page');
  const pi = pages.indexOf(pg);
  const hit = (r.width > 0 && r.height > 0)
    ? (() => { const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h ? (h.tagName + '.' + String(h.className || '').slice(0, 30)) : 'null'; })()
    : '(-)';
  return `${el.dataset.app || '?'} p${pi} hid=${pg ? pg.getAttribute('aria-hidden') : '-'} box=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] hit=${hit}`;
};
for (const el of iconEls) {
  if (['memory', 'graph'].includes(el.dataset.app)) report({ name: 'probe:' + el.dataset.app, ok: true, detail: fmt(el) });
}
report({ name: 'all-current-count', ok: true, detail: '当前页图标=' + iconEls.filter((el) => { const p = el.closest('.app-grid-page'); return !p || p.getAttribute('aria-hidden') !== 'true'; }).length });
/* 面板几何：面板自身盒 + 主屏网格盒，判断是否被面板裁剪 */
const panel = document.getElementById('phone-panel-content') || document.getElementById('phone-panel');
const pr = panel ? panel.getBoundingClientRect() : null;
report({ name: 'panel-box', ok: true, detail: pr ? `[${Math.round(pr.left)},${Math.round(pr.top)},${Math.round(pr.width)}x${Math.round(pr.height)}]` : 'n/a' });
const hs = document.querySelector('.home-screen');
const hr = hs ? hs.getBoundingClientRect() : null;
report({ name: 'home-box', ok: true, detail: hr ? `[${Math.round(hr.left)},${Math.round(hr.top)},${Math.round(hr.width)}x${Math.round(hr.height)}]` : 'n/a' });
const over = [...document.querySelectorAll('.home-screen *')].filter((el) => {
  const s = getComputedStyle(el);
  return (s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.overflow === 'hidden') && el.getBoundingClientRect().width < 340;
}).slice(0, 6).map((el) => el.tagName + '.' + String(el.className || '').slice(0, 28) + '@' + Math.round(el.getBoundingClientRect().width));
report({ name: 'clippers', ok: true, detail: JSON.stringify(over) });
for (const id of ['memory', 'graph']) {
  const el = iconEls.find((e) => e.dataset.app === id);
  if (!el) continue;
  const ancestors = [];
  let n = el;
  while (n && n !== document.body) {
    const s = getComputedStyle(n);
    ancestors.push(`${n.tagName}.${String(n.className || '').slice(0, 20)} ov=${s.overflow} vis=${s.visibility} op=${s.opacity} tf=${String(s.transform).slice(0, 22)} z=${s.zIndex}`);
    n = n.parentElement;
  }
  report({ name: 'chain:' + id, ok: true, detail: ancestors.join(' | ') });
}
done();
