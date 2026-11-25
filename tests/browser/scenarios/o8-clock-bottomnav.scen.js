/* ============================================================
 * tests/browser/scenarios/o8-clock-bottomnav.scen.js
 *   O8 场景⑥：时计「照现实」改造验收（底栏一级导航 / 两格真一级面 / 未实现格给真话）
 * ------------------------------------------------------------
 * 判据来源（写在文件里，不靠记忆）：
 *   ① Apple 官方支持「在 iPhone 上使用计时器或秒表」：「轻点『秒表』」；
 *   ② Apple 官方支持「在 iPhone 上的『时钟』中查看世界时间」：
 *      「前往『时钟』App。轻点『世界时钟』」。
 *   两篇合起来说明：一级入口在**页面底部的页签**上，不是页头的胶囊。
 *
 * 本仓的有意偏离（结构照官方、能力照本仓）：
 *   · 只落**两格**：今天 / 时计 —— 本机没有闹钟调度、秒表与倒计时链路，
 *     凑出『闹钟 / 秒表 / 计时器』三格必然是点了不发生的假键；
 *   · 那三格**不画**，改为页脚一行如实说明（.cl-absent）；
 *   · 底栏贴底由 flex 外壳保证（flex-shrink:0），**不用 position:fixed**。
 *
 * 量的五件事（真盒模型 + 真点击）：
 *   ① 底栏**贴底**（delta ≤1px）与**拇指可点高度**（offsetHeight ≥44）；
 *   ② 两格文案与格数、当前面高亮（aria-current）；
 *   ③ 点「时计」真切换到该面（内容层出现读数卡），点「今天」真切回时间轴；
 *   ④ 切过之后底栏仍贴底、且复用同一外壳（整页重绘最容易把底栏丢掉的一步）；
 *   ⑤ 外壳三层的盒模型自洽：内容层高 + 底栏高 ≈ 外壳高（±2px），
 *      即「底栏没有被内容顶出可视区」这件事有机器读数，而不是靠肉眼。
 *
 * 单独跑：
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-clock-bottomnav.scen.js
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (e) { report({ name: 'entry-import', ok: false, detail: String(e && e.message) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 20000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 20000 });
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'clock' } }));
const appUp = await waitFor(() => document.querySelector('.cl-app'), { timeoutMs: 20000 });
report({ name: 'clock-open', ok: !!appUp, detail: appUp ? '.cl-app 到场' : '未开屏' });

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

/* ---------- ① 底栏存在 + 贴底 + 可点高度 ---------- */
const nav = document.querySelector('.cl-tabbar');
report({ name: 'nav-exists', ok: !!nav, detail: nav ? '.cl-tabbar 存在' : '.cl-tabbar 缺失' });
if (nav) {
  const appBox = document.querySelector('.cl-app');
  const nb = rectOf(nav);
  const ab = rectOf(appBox);
  const delta = Math.abs(nb.b - ab.b);
  report({ name: 'nav-flush-to-shell-bottom', ok: delta <= 1, detail: 'navBottom=' + nb.b + ' shellBottom=' + ab.b + ' delta=' + delta });
  report({ name: 'nav-thumb-height', ok: nb.h >= 44, detail: 'offsetH=' + nb.h });
}

/* ---------- ② 格数、文案、当前面高亮 ---------- */
const items = Array.from(document.querySelectorAll('.cl-tabbar-item'));
report({ name: 'nav-item-count', ok: items.length === 2, detail: 'count=' + items.length });
report({
  name: 'nav-item-labels',
  ok: items.length === 2 && items[0].textContent === '今天' && items[1].textContent === '时计',
  detail: items.map((x) => x.textContent).join('/')
});
report({
  name: 'nav-current-highlight',
  ok: items.length === 2 && items[0].getAttribute('aria-current') === 'page',
  detail: 'today=' + (items[0] && items[0].getAttribute('aria-current'))
});

/* ---------- ③ 两格真能切 ---------- */
if (items[1]) {
  click(items[1]);
  await sleep(200);
  const faceNow = document.querySelector('.cl-face');
  const navAfter = document.querySelector('.cl-tabbar');
  report({
    name: 'switch-to-clock-face',
    ok: !!faceNow && !!navAfter && navAfter.querySelectorAll('.cl-tabbar-item')[1].getAttribute('aria-current') === 'page',
    detail: '.cl-face=' + !!faceNow + ' 选中第二格=' + (navAfter ? navAfter.querySelectorAll('.cl-tabbar-item')[1].getAttribute('aria-current') : 'n/a')
  });
  /* 时计面必须带「官方还有三格、本机没有」的如实说明（不是藏起来，也不是假控件）。 */
  const absent = document.querySelector('.cl-absent');
  report({
    name: 'absent-note-is-honest',
    ok: !!absent && String(absent.textContent).indexOf('闹钟') >= 0 && String(absent.textContent).indexOf('假键') >= 0,
    detail: absent ? String(absent.textContent).slice(0, 40) : '缺少 .cl-absent'
  });
  /* 不许出现「画出来但点不动」的假格：底栏只许有 2 个 data-tab，且都对应 _tabs() 里的键。 */
  const tabKeys = Array.from(document.querySelectorAll('.cl-tabbar-item')).map((x) => x.getAttribute('data-tab'));
  report({
    name: 'no-fake-nav-cells',
    ok: tabKeys.length === 2 && tabKeys.every((k) => k === 'today' || k === 'clock'),
    detail: 'keys=' + tabKeys.join(',')
  });
}

/* ---------- ⑤ 外壳三层盒模型自洽 ---------- */
const shell = document.querySelector('.cl-app');
const scrollLayer = document.querySelector('.cl-scroll');
const nav2 = document.querySelector('.cl-tabbar');
if (shell && scrollLayer && nav2) {
  const sh = rectOf(shell);
  const sc = rectOf(scrollLayer);
  const nv = rectOf(nav2);
  const sum = sc.h + nv.h;
  report({
    name: 'shell-three-layers-add-up',
    ok: Math.abs(sum - sh.h) <= 2,
    detail: 'scroll=' + sc.h + ' nav=' + nv.h + ' sum=' + sum + ' shell=' + sh.h
  });
}

/* ---------- ④ 切回今天 + 底栏仍在 ---------- */
const first = document.querySelectorAll('.cl-tabbar-item')[0];
if (first) {
  click(first);
  await sleep(200);
  const todayBox = document.querySelector('.cl-today');
  const nav3 = document.querySelector('.cl-tabbar');
  const shell3 = document.querySelector('.cl-app');
  const stillFlush = nav3 && shell3 ? Math.abs(rectOf(nav3).b - rectOf(shell3).b) <= 1 : false;
  report({
    name: 'back-to-today-keeps-nav',
    ok: !!todayBox && !!nav3 && stillFlush,
    detail: '.cl-today=' + !!todayBox + ' nav=' + !!nav3 + ' flush=' + stillFlush
  });
  report({
    name: 'same-shell-reused',
    ok: document.querySelectorAll('.cl-app').length === 1 && document.querySelectorAll('.cl-tabbar').length === 1,
    detail: 'shell=' + document.querySelectorAll('.cl-app').length + ' nav=' + document.querySelectorAll('.cl-tabbar').length
  });
}