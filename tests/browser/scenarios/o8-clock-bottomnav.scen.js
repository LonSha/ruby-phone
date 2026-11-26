/* ============================================================
 * tests/browser/scenarios/o8-clock-bottomnav.scen.js
 *   O8 场景⑥：时计「照官方那种」验收（底栏照官方四格 / 未实现三格画出来但禁用 / 点了给真话）
 * ------------------------------------------------------------
 * 判据来源（写在文件里，不靠记忆）：
 *   ① Apple 官方支持「在 iPhone 上使用计时器或秒表」：「轻点『秒表』」；
 *   ② Apple 官方支持「在 iPhone 上的『时钟』中查看世界时间」：
 *      「前往『时钟』App。轻点『世界时钟』」。
 *   ⇒ 一级入口在**页面底部**的页签上；官方四格 = 世界时钟 / 闹钟 / 秒表 / 计时器。
 *
 * 本仓的有意偏离（结构照官方、能力照本仓）：
 *   · 官方四格**照位置画全**（世界时钟 / 闹钟 / 秒表 / 计时器），
 *     未实现的三格 is-disabled + aria-disabled + opacity .38，点了走页面内提示条给一句真话
 *     （贴吧「消息」那轮确立的口径：藏起来会被读成「没有这功能」，静默会被读成「按钮坏了」）；
 *   · 只额外加一格「今天」（本仓自有面，且是真能切的面），排在最末，不打乱官方四格的相对顺序；
 *   · 底栏贴底由 flex 外壳保证（flex-shrink:0），**不用 position:fixed**。
 *
 * 量的六件事（真盒模型 + 真点击 + 真计算样式）：
 *   ① 底栏贴底（delta ≤1px）与拇指可点高度（≥44）；
 *   ② 五格文案与顺序，官方四格的相对顺序不得被「今天」打乱；
 *   ③ 三格禁用：opacity≈.38、aria-disabled=true、**不带 data-tab**；
 *   ④ 点禁用格：出现页面内提示条、点出这一格名字、页面不切；
 *   ⑤ 真格能切（世界时钟 ⇄ 今天），切完底栏仍贴底且复用同一外壳；
 *   ⑥ 外壳三层盒模型自洽：内容层高 + 底栏高 ≈ 外壳高（±2px）。
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

const OFFICIAL = ['世界时钟', '闹钟', '秒表', '计时器'];
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const cellsNow = () => Array.from(document.querySelectorAll('.cl-tabbar-item'));

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

/* ---------- ② 五格文案与顺序 ---------- */
const cells = cellsNow();
const labels = cells.map((c) => c.textContent);
report({ name: 'nav-item-count', ok: cells.length === OFFICIAL.length + 1, detail: 'count=' + cells.length + '（官方四格 + 本仓自有「今天」）' });
report({
  name: 'official-four-in-order',
  ok: officialOrderOk(labels),
  detail: 'labels=' + labels.join('/')
});
function officialOrderOk(arr) {
  return arr.filter((w) => OFFICIAL.indexOf(w) >= 0).join('/') === OFFICIAL.join('/');
}
report({ name: 'own-cell-last', ok: labels[labels.length - 1] === '今天', detail: 'last=' + labels[labels.length - 1] });
/* 默认面是「今天」（构造函数决定），故当前高亮应在最后一格。 */
const curCell = cells.find((c) => c.getAttribute('aria-current') === 'page');
report({
  name: 'nav-current-highlight',
  ok: !!curCell && curCell.getAttribute('data-tab') === 'today',
  detail: 'aria-current=page 的格=' + (curCell ? (curCell.getAttribute('data-tab') || curCell.textContent) : '无')
});

/* ---------- ③ 三格禁用：置灰 / aria / 不带 data-tab ---------- */
const disabled = cells.filter((c) => OFFICIAL.indexOf(c.textContent) >= 0 && c.getAttribute('aria-disabled') === 'true');
report({ name: 'disabled-count', ok: disabled.length === 3, detail: 'aria-disabled 的官方格数=' + disabled.length });
const opac = disabled.map((c) => Number(getComputedStyle(c).opacity));
report({
  name: 'disabled-look',
  ok: opac.length === 3 && opac.every((o) => o > 0.3 && o < 0.5),
  detail: 'opacity=' + opac.join(',')
});
report({
  name: 'disabled-has-no-datatab',
  ok: disabled.every((c) => !c.hasAttribute('data-tab')),
  detail: '带 data-tab 的禁用格=' + disabled.filter((c) => c.hasAttribute('data-tab')).map((c) => c.textContent).join(',') || '无'
});

/* ---------- ④ 点禁用格：出提示条、点出名字、页面不切 ---------- */
const alarmCell = cells.find((c) => c.textContent === '闹钟');
if (alarmCell) {
  const beforeTab = (document.querySelector('.cl-today') ? 'today' : 'clock');
  click(alarmCell);
  await sleep(120);
  const toastNow = document.querySelector('.cl-toast');
  const txt = toastNow ? String(toastNow.textContent) : '';
  report({
    name: 'disabled-click-says-truth',
    ok: !!toastNow && txt.indexOf('闹钟') >= 0 && txt.indexOf('本机还没做') >= 0,
    detail: txt ? txt.slice(0, 46) : '无提示条（点了没反应）'
  });
  const afterTab = (document.querySelector('.cl-today') ? 'today' : 'clock');
  report({ name: 'disabled-click-does-not-switch', ok: beforeTab === afterTab, detail: beforeTab + ' → ' + afterTab });
  /* 再点一次：提示条只许有一条（叠成一串就是没回收）。 */
  click(cellsNow().find((c) => c.textContent === '秒表') || alarmCell);
  await sleep(60);
  report({ name: 'toast-single-instance', ok: document.querySelectorAll('.cl-toast').length <= 1, detail: 'toast 节点数=' + document.querySelectorAll('.cl-toast').length });
}

/* ---------- ⑤ 真格真能切 ---------- */
const clockCell = cellsNow().find((c) => c.getAttribute('data-tab') === 'clock');
if (clockCell) {
  click(clockCell);
  await sleep(200);
  const faceNow = document.querySelector('.cl-face');
  const on = cellsNow().find((c) => c.getAttribute('data-tab') === 'clock');
  report({
    name: 'switch-to-clock-face',
    ok: !!faceNow && !!on && on.getAttribute('aria-current') === 'page',
    detail: '.cl-face=' + !!faceNow + ' 世界时钟格=' + (on ? on.getAttribute('aria-current') : 'n/a')
  });
  const absent = document.querySelector('.cl-absent');
  report({
    name: 'absent-note-is-honest',
    ok: !!absent && String(absent.textContent).indexOf('闹钟') >= 0 && String(absent.textContent).indexOf('置灰') >= 0,
    detail: absent ? String(absent.textContent).slice(0, 44) : '缺少 .cl-absent'
  });
  /* 提示条在切面后必须被收掉（整段重绘会冲掉节点，留一颗「看不见但还在数」的定时器就是泄漏）。 */
  report({ name: 'toast-cleared-after-refresh', ok: document.querySelectorAll('.cl-toast').length === 0, detail: 'toast 节点数=' + document.querySelectorAll('.cl-toast').length });
}

/* ---------- ⑥ 外壳三层盒模型自洽 ---------- */
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

/* ---------- 收尾：切回今天，底栏仍在 ---------- */
const todayCell = cellsNow().find((c) => c.getAttribute('data-tab') === 'today');
if (todayCell) {
  click(todayCell);
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