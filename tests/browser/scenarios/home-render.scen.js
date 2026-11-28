/* ============================================================
 * home-render.scen.js — 首页视觉层：真实排版引擎下的「看得见没有」
 * ------------------------------------------------------------
 * 为什么需要这一层：本仓 122 个 App 的验收只有**源码字符串**判据
 *   （FACES 常量在不在 / 类名有没有 / 格数写的几）。它们全绿时，
 *   屏幕仍可能是「dock 只有色块没有图形 / 桌面只铺 3 行留一大片空白 /
 *   图标互相压」。真机截图已经证过一次。
 *
 * 本场景只问四件机器能判的事：
 *   ① 桌面是**一页**还是被切成了「12 + 3」两页（切了就会留半空的一页）；
 *   ② 每格 dock 图标的背景图**真的加载成功**了吗（不是「属性写了」）；
 *   ③ 图标之间、图标与 dock 之间**有没有几何重叠**；
 *   ④ home-screen 里有没有脱离布局的圆形绝对定位块（截图里那两团圆）。
 *
 * 口径边界：本层不判颜色好不好看、不判像素风是否统一 —— 那是设计判断，
 *   不是机器读数。这里只判「元素在不在、加载成不成、压不压得住」。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: '宿主楼层', is_user: false, swipes: ['x'], swipe_id: 0 }] });
function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
await import('/index.js');
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
let up = false;
for (let i = 0; i < 3 && !up; i++) {
  const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (t) realClick(t);
  up = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 });
}
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modal = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 6000 });
if (modal) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
await window.__sleep(600);
const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
const CS = (el) => getComputedStyle(el);
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/* ---------- ① 桌面分页：两页就必然留半空 ---------- */
const pages = Array.from(document.querySelectorAll('.app-grid-page'));
const perPage = pages.map((p) => p.querySelectorAll('.app-icon').length);
report({
  name: 'desktop-pages',
  ok: pages.length === 1,
  detail: 'pages=' + pages.length + ' perPage=' + JSON.stringify(perPage)
    + (pages.length > 1 ? ' —— 桌面被切成多页，首页会留一块空白' : ''),
});

/* ---------- ② dock 图标背景图是否真的加载成功 ---------- */
const tiles = Array.from(document.querySelectorAll('.dock-app'));
async function loadOk(url) {
  if (!url || url === 'none') return { ok: false, why: '无背景图' };
  const m = url.match(/url\(["']?(.*?)["']?\)$/);
  if (!m) return { ok: false, why: 'URL 解析失败' };
  return await new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ ok: img.naturalWidth > 0, why: 'naturalWidth=' + img.naturalWidth });
    img.onerror = () => res({ ok: false, why: '加载失败' });
    img.src = m[1];
    window.setTimeout(() => { try { img.src = ''; } catch (_e) { /* 忽略 */ } }, 6000);
  });
}
const dockRows = [];
for (const t of tiles) {
  const span = t.querySelector('.px-dock-icon');
  const bg = span ? CS(span).backgroundImage : 'none';
  const loaded = span ? await loadOk(bg) : { ok: false, why: '无 .px-dock-icon' };
  dockRows.push({ app: t.dataset.app || '', box: R(t), loaded: loaded.ok, why: loaded.why, bgLen: bg.length });
}
report({
  name: 'dock-icons-load',
  ok: tiles.length > 0 && dockRows.every((r) => r.loaded),
  detail: JSON.stringify(dockRows),
});

/* ---------- ③ 几何重叠：图标 vs 图标 / 图标 vs dock ---------- */
const dockBox = document.querySelector('.dock') ? R(document.querySelector('.dock')) : null;
const icons = Array.from(document.querySelectorAll('.app-icon')).map((el) => ({ el: el, box: R(el) }));
let iconPairs = 0;
const badPairs = [];
for (let i = 0; i < icons.length; i++) {
  for (let j = i + 1; j < icons.length; j++) {
    const a = icons[i].box; const b = icons[j].box;
    if (overlap(a, b) > 12) {
      iconPairs += 1;
      if (badPairs.length < 4) {
        const n = (e) => { const t = e.querySelector('.app-name'); return t ? t.textContent.trim() : '?'; };
        badPairs.push(n(icons[i].el) + '×' + n(icons[j].el));
      }
    }
  }
}
report({ name: 'icon-overlap', ok: iconPairs === 0, detail: 'pairs=' + iconPairs + ' ' + JSON.stringify(badPairs) });
/* 图标是否真的压到 dock 上：必须看「用户能看见的那部分」。
 * 矮屏（如 320x568）一页排不下时，pager 是滚动裁剪区（rp-home-fix.css），
 * 磁格在 DOM 里仍在 y=515，但 getBoundingClientRect 不知道裁切 ⇒ 单看矩形交集会误报。
 * 故先看裁剪容器：pager 的可视底边若不越过 dock 顶边，内容就不可能压到 dock。 */
const pagerEl = document.querySelector('.app-grid-pager');
const pagerBox = pagerEl ? R(pagerEl) : null;
const clipped = !!(pagerEl && String(CS(pagerEl).overflowY) === 'auto');
const pagerClearsDock = !!(pagerBox && dockBox && (pagerBox.y + pagerBox.h) <= dockBox.y + 2);
let dockHits = 0;
if (dockBox && !(clipped && pagerClearsDock)) {
  for (const it of icons) {
    const b = it.box;
    const visTop = clipped && pagerBox ? Math.max(b.y, pagerBox.y) : b.y;
    const visBottom = clipped && pagerBox ? Math.min(b.y + b.h, pagerBox.y + pagerBox.h) : b.y + b.h;
    if (visBottom - visTop <= 2) continue;              /* 完全被裁掉的不算 */
    const v = { x: b.x, y: visTop, w: b.w, h: visBottom - visTop };
    if (overlap(v, dockBox) > 12) dockHits += 1;
  }
}
report({ name: 'icons-vs-dock', ok: dockHits === 0, detail: 'overlapping=' + dockHits + ' clipped=' + clipped + ' pagerClearsDock=' + pagerClearsDock + ' pager=' + JSON.stringify(pagerBox || null) + ' dock=' + JSON.stringify(dockBox || null) });

/* ---------- ④ 脱离布局的圆块 ---------- */
const strays = [];
for (const el of document.querySelectorAll('.home-screen *')) {
  const cs = CS(el);
  if (cs.position !== 'absolute') continue;
  const r = el.getBoundingClientRect();
  if (r.width < 18 || Math.abs(r.width - r.height) > 6) continue;
  const rad = parseFloat(cs.borderTopLeftRadius || '0');
  if (rad < Math.min(r.width, r.height) * 0.45) continue;
  if (el.closest('.dock-app') || el.closest('.app-icon')) continue;
  if (!(r.width > 0 && r.height > 0)) continue;
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
  strays.push({ cls: String(el.className || '').slice(0, 50), box: R(el) });
}
report({ name: 'no-float-circles', ok: strays.length === 0, detail: 'count=' + strays.length + ' ' + JSON.stringify(strays.slice(0, 6)) });

report({ name: 'done', ok: true, detail: '' });