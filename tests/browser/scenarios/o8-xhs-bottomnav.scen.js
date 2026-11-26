/* ============================================================
 * tests/browser/scenarios/o8-xhs-bottomnav.scen.js
 *   O8 场景⑦：小红书「照官方那种」验收（底栏照官方五格 / 视频格画出来但禁用 / 点了给真话）
 * ------------------------------------------------------------
 * 判据来源（写在文件里，不靠记忆）：2024-10-12 钛媒体《购物改视频，小红书视频3.0提速》——
 *   「近期的版本更新之后，更多用户会发现自己的小红书APP的第二Tab由「购物」替换为「视频」」。
 *   ⇒ 官方底栏五格：首页 / 视频 / ＋ / 消息 / 我，中央「＋」是凸起的圆形发布键。
 *
 * 本仓的有意偏离（结构照官方、能力照本仓）：
 *   · 「视频」**照位置画出来但禁用**（is-disabled + aria-disabled + opacity .38），
 *     点了走页面内提示条给一句真话（贴吧「消息」那轮确立的口径：藏起来会被读成「没有这功能」，
 *     静默会被读成「按钮坏了」）；
 *   · 中央「＋」是**真动作**（打开本仓已有的发布抽屉），不是禁用格；
 *   · 底栏贴底由 flex 外壳保证，**不用 position:fixed**。
 *
 * 量的六件事（真盒模型 + 真点击 + 真计算样式）：
 *   ① 底栏贴底（delta ≤1px）与拇指可点高度（≥44）；
 *   ② 五格文案与顺序（官方四格相对顺序 + 中央＋落在正中）；
 *   ③ 视频格禁用：opacity≈.38、aria-disabled=true、**不带 data-tab**；
 *   ④ 点禁用格：出现页面内提示条、点出格名、页面不切；提示条只留一条；
 *   ⑤ ＋ 真开抽屉；真格能切（首页 ⇄ 我），切完底栏仍贴底且复用同一外壳；
 *   ⑥ 外壳三层盒模型自洽：内容层高 + 底栏高 ≈ 外壳高（±2px）。
 *
 * 单独跑：
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-xhs-bottomnav.scen.js
 *
 * 【为什么判据是 44，而 CSS 里写的是 48（v4.210.0 首跑当场红的坑，写在这里不靠记忆）】
 *   手机外壳对整屏做过约 0.9 的 scale（实测 .xhs-app offsetH=728 / rect=655）。
 *   getBoundingClientRect 拿到的是**缩放后的设备像素**，所以：
 *     · CSS 写 44（HIG 下限本身）⇒ 量出 ≈40 ⇒ 本判据红；
 *     · CSS 写 48 ⇒ 栏 48+1 边框 = 49 ⇒ 量出 44，正好过线。
 *   时计 v4.209.0 收口时用的就是 48，这里照同一口径。另外加两条**不缩放**的读数
 *   （nav-css-min-block / cell-css-min-block，读计算样式而不是 getBoundingClientRect），
 *   把「热区下限真的写在 CSS 里」与「缩放后仍过线」两件事分开量，免得改一边蒙住另一边。
 *   中央圆钮（.xhs-tabbar-pub）**不计入**本组判据：它按官方形态保持 44，缩小后 ≈40，
 *   这是有意保留的，不是漏测。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (e) { report({ name: 'entry-import', ok: false, detail: String(e && e.message) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 20000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 20000 });
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'xhs' } }));
const appUp = await waitFor(() => document.querySelector('.xhs-app'), { timeoutMs: 20000 });
report({ name: 'xhs-open', ok: !!appUp, detail: appUp ? '.xhs-app 到场' : '未开屏' });

const OFFICIAL = ['首页', '视频', '消息', '我'];
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const cellsNow = () => Array.from(document.querySelectorAll('.xhs-tabbar-cell'));
const pubNow = () => document.querySelector('.xhs-tabbar-pub');
const titleNow = () => String((document.querySelector('.xhs-header-title') || {}).textContent || '');
/* ---------- ① 底栏存在 + 贴底 + 可点高度 ---------- */
const nav = document.querySelector('.xhs-tabbar');
report({ name: 'nav-exists', ok: !!nav, detail: nav ? '.xhs-tabbar 存在' : '.xhs-tabbar 缺失' });
if (nav) {
  const appBox = document.querySelector('.xhs-app');
  const nb = rectOf(nav);
  const ab = rectOf(appBox);
  const delta = Math.abs(nb.b - ab.b);
  report({ name: 'nav-flush-to-shell-bottom', ok: delta <= 1, detail: 'navBottom=' + nb.b + ' shellBottom=' + ab.b + ' delta=' + delta });
  report({ name: 'nav-thumb-height', ok: nb.h >= 44, detail: 'offsetH=' + nb.h });
  /* 两条不缩放读数：证明「热区下限真的写在 CSS 里」，而不是被外壳 scale 恰好抬过线。 */
  const navMin = getComputedStyle(nav).minBlockSize;
  report({
    name: 'nav-css-min-block',
    ok: parseFloat(navMin) >= 48,
    detail: 'min-block-size=' + navMin + '（未缩放；本 App 口径 48，见 xhs.v4.css 的 --xhs-tabbar-h）'
  });
}
const firstCell = document.querySelector('.xhs-tabbar-cell');
report({
  name: 'cell-css-min-block',
  ok: !!firstCell && parseFloat(getComputedStyle(firstCell).minBlockSize) >= 48,
  detail: 'min-block-size=' + (firstCell ? getComputedStyle(firstCell).minBlockSize : 'n/a') +
    '（v3 皮肤开着时这条曾经掉到 32：skin 层误用了 --rp33-tab-h 这个胶囊页签口径）'
});
/* ---------- ② 五格文案与顺序 ---------- */
const cells = cellsNow();
const labels = cells.map((c) => c.textContent);
const children = nav ? Array.from(nav.children) : [];
report({ name: 'nav-item-count', ok: children.length === 5, detail: 'count=' + children.length + '（官方五格）' });
report({
  name: 'official-four-in-order',
  ok: labels.join('/') === OFFICIAL.join('/'),
  detail: 'labels=' + labels.join('/')
});
const pubIdx = children.findIndex((el) => el.classList.contains('xhs-tabbar-pub'));
report({ name: 'pub-in-middle', ok: pubIdx === 2, detail: '中央「＋」下标=' + pubIdx + '（官方是五格正中）' });
const curCell = cells.find((c) => c.getAttribute('aria-current') === 'page');
report({
  name: 'nav-current-highlight',
  ok: !!curCell && curCell.getAttribute('data-tab') === 'feed',
  detail: 'aria-current=page 的格=' + (curCell ? (curCell.getAttribute('data-tab') || curCell.textContent) : '无')
});
/* ---------- ③ 视频格禁用：置灰 / aria / 不带 data-tab ---------- */
const disabled = cells.filter((c) => c.getAttribute('aria-disabled') === 'true');
report({ name: 'disabled-count', ok: disabled.length === 1, detail: 'aria-disabled 的格数=' + disabled.length });
const opac = disabled.map((c) => Number(getComputedStyle(c).opacity));
report({
  name: 'disabled-look',
  ok: opac.length === 1 && opac.every((o) => o > 0.3 && o < 0.5),
  detail: 'opacity=' + opac.join(',') + '（v4.209.0 踩过的坑：无层写法的按钮会被 all: revert-layer 打回 1）'
});
report({
  name: 'disabled-has-no-datatab',
  ok: disabled.every((c) => !c.hasAttribute('data-tab')),
  detail: '带 data-tab 的禁用格=' + (disabled.filter((c) => c.hasAttribute('data-tab')).map((c) => c.textContent).join(',') || '无')
});
/* ---------- ④ 点禁用格：出提示条、点出名字、页面不切 ---------- */
const videoCell = disabled[0];
if (videoCell) {
  const beforeTitle = titleNow();
  click(videoCell);
  await sleep(120);
  const toastNow = document.querySelector('.xhs-toast');
  const txt = toastNow ? String(toastNow.textContent) : '';
  report({
    name: 'disabled-click-says-truth',
    ok: !!toastNow && txt.indexOf('视频') >= 0 && txt.indexOf('本机还没做') >= 0,
    detail: txt ? txt.slice(0, 48) : '无提示条（点了没反应）'
  });
  const afterTitle = titleNow();
  report({ name: 'disabled-click-does-not-switch', ok: beforeTitle === afterTitle, detail: beforeTitle + ' → ' + afterTitle });
  click(videoCell);
  await sleep(60);
  report({ name: 'toast-single-instance', ok: document.querySelectorAll('.xhs-toast').length <= 1, detail: 'toast 节点数=' + document.querySelectorAll('.xhs-toast').length });
}
/* ---------- ⑤ ＋ 是真动作；真格能切 ---------- */
const pub = pubNow();
report({
  name: 'pub-is-real-action',
  ok: !!pub && pub.getAttribute('data-act') === 'xhs-compose' && !pub.hasAttribute('data-tab'),
  detail: 'data-act=' + (pub ? pub.getAttribute('data-act') : 'n/a') + ' data-tab=' + (pub ? pub.getAttribute('data-tab') : 'n/a')
});
if (pub) {
  click(pub);
  await sleep(150);
  const drawer = document.getElementById('xhs-compose-drawer');
  report({
    name: 'pub-opens-compose',
    ok: !!drawer && String(drawer.dataset.open) === '1',
    detail: 'drawer data-open=' + (drawer ? drawer.dataset.open : 'n/a')
  });
  const closeBtn = document.getElementById('xhs-compose-close');
  if (closeBtn) click(closeBtn);
  await sleep(120);
  report({ name: 'compose-closed-stays-on-feed', ok: titleNow() === '首页', detail: 'title=' + titleNow() });
}
const meCell = cellsNow().find((c) => c.getAttribute('data-tab') === 'me');
if (meCell) {
  click(meCell);
  await sleep(220);
  const meCard = document.querySelector('.xhs-me-card');
  const on = cellsNow().find((c) => c.getAttribute('data-tab') === 'me');
  report({
    name: 'switch-to-me-face',
    ok: !!meCard && !!on && on.getAttribute('aria-current') === 'page',
    detail: '.xhs-me-card=' + !!meCard + ' 我格=' + (on ? on.getAttribute('aria-current') : 'n/a')
  });
  const navOnMe = document.querySelector('.xhs-tabbar');
  const shellOnMe = document.querySelector('.xhs-app');
  const stillFlush = navOnMe && shellOnMe ? Math.abs(rectOf(navOnMe).b - rectOf(shellOnMe).b) <= 1 : false;
  report({ name: 'tabbar-kept-on-other-face', ok: !!navOnMe && stillFlush, detail: 'nav=' + !!navOnMe + ' flush=' + stillFlush });
  /* 提示条在切面后必须被收掉（整段重绘会冲掉节点，留一颗「看不见但还在数」的定时器就是泄漏）。 */
  report({ name: 'toast-cleared-after-refresh', ok: document.querySelectorAll('.xhs-toast').length === 0, detail: 'toast 节点数=' + document.querySelectorAll('.xhs-toast').length });
}
/* ---------- ⑥ 外壳三层盒模型自洽 ---------- */
const shell = document.querySelector('.xhs-app');
const scrollLayer = document.querySelector('.xhs-body');
const nav2 = document.querySelector('.xhs-tabbar');
if (shell && scrollLayer && nav2) {
  const sh = rectOf(shell);
  const sc = rectOf(scrollLayer);
  const nv = rectOf(nav2);
  const sum = sc.h + nv.h + rectOf(document.querySelector('.xhs-header')).h;
  report({
    name: 'shell-three-layers-add-up',
    ok: Math.abs(sum - sh.h) <= 2,
    detail: 'header=' + rectOf(document.querySelector('.xhs-header')).h + ' scroll=' + sc.h + ' nav=' + nv.h + ' sum=' + sum + ' shell=' + sh.h
  });
}
/* ---------- 收尾：切回首页，底栏仍在，页脚说明如实 ---------- */
const feedCell = cellsNow().find((c) => c.getAttribute('data-tab') === 'feed');
if (feedCell) {
  click(feedCell);
  await sleep(220);
  const nav3 = document.querySelector('.xhs-tabbar');
  const shell3 = document.querySelector('.xhs-app');
  const stillFlush = nav3 && shell3 ? Math.abs(rectOf(nav3).b - rectOf(shell3).b) <= 1 : false;
  report({
    name: 'back-to-feed-keeps-nav',
    ok: titleNow() === '首页' && !!nav3 && stillFlush,
    detail: 'title=' + titleNow() + ' nav=' + !!nav3 + ' flush=' + stillFlush
  });
  const note = document.querySelector('.xhs-soon-note');
  const noteTxt = note ? String(note.textContent) : '';
  report({
    name: 'soon-note-is-honest',
    ok: !!note && noteTxt.indexOf('视频') >= 0 && noteTxt.indexOf('置灰') >= 0,
    detail: noteTxt ? noteTxt.slice(0, 52) : '缺少 .xhs-soon-note'
  });
  report({
    name: 'same-shell-reused',
    ok: document.querySelectorAll('.xhs-app').length === 1 && document.querySelectorAll('.xhs-tabbar').length === 1,
    detail: 'shell=' + document.querySelectorAll('.xhs-app').length + ' nav=' + document.querySelectorAll('.xhs-tabbar').length
  });
}
done();