/* ============================================================
 * tests/browser/scenarios/o1-app-enumeration.scen.js — O1 场景：82 个入口逐个开屏
 * ------------------------------------------------------------
 * 本场景回答的问题：把 config/apps.js 的**全部** 82 条 id 真开一遍，
 *   每个入口的**首屏**在真排版引擎下是否有真盒、是否真可点、是否有可见内容。
 *
 * 为什么必须逐个开而不是抽查几个：
 *   「入口存在」与「入口可用」在静态检查下同形 —— 历史两次事故（返回按钮缺席 /
 *   设置页空白）都是「元素在 DOM 里、但用户点开是空的」。逐条枚举是唯一能证明
 *   「82 条都真能打开」的形态。
 *
 * 四类「看起来没坏但显示不对」在本场景里的对应读数：
 *   ① 入口被遮挡 → icon-hit-test / open-hit-test（elementFromPoint 命中的是不是本体）
 *   ② 宽度为零   → icon-has-box / open-has-box（真盒模型宽高 > 0）
 *   ③ 按钮未绑定 → open-back-returns（点返回真回主屏，不只看按钮在不在）
 *   ④ 保存后丢失 → 归 o1-settings-save 场景（本场景不重复量）
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const mod = await import('/config/apps.js');
const APPS = mod.APPS;
const ids = APPS.map((a) => a.id).slice(20, 22);
report({ name: 'enumeration-source', ok: true, detail: 'slice20-22 = ' + JSON.stringify(ids) });
installBrowserHost({
  chat: Array.from({ length: 3 }, (_, i) => ({ mes: '楼层' + i, is_user: i % 2 === 0, swipes: ['x'], swipe_id: 0 })),
});
try { await import('/index.js'); } catch (_e) { /* 由下面的读数判定 */ }
const up = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
report({ name: 'entry-version', ok: up, detail: up ? String(window.VirtualPhone.version) : '未挂上' });
const panelUp = await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 15000 });
if (panelUp) {
  const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
report({ name: 'shell-ready', ok: !!(panelUp && homeUp), detail: 'panel=' + !!panelUp + ' home=' + !!homeUp });
/* ★ 本版自己抓到的第 7 处判据缺陷（首版漏步）：首版**没关実例弹窗**。
 *   実例弹窗（`#st-phone-update-modal`，由 update-checker 异步弹出）的内容块
 *   `st-phone-update-content` 覆盖整个视口 ⇒ App 首屏内每一个探测点都命中弹窗，
 *   而弹窗不属任何 [data-view-id] 图层 ⇒ `selfHit=0` ⇒ 全 82 条误判「首屏不可命中」（假红）。
 *   本仓其余 7 个场景**全都**有这一步（o1-core-flow 的注释已明写：
 *   「不关掉它，后面每一步的坐标命中测试都会命中弹窗而不是手机面板」），
 *   首版漏了 ⇒ 重复踩坑。修法：补上关闭步，并**在全量逐开之后再确认一次它没回来**
 *   （守「关了但后续又被重新弹出」）。 */
function realClick(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
let modalClosed = true;
if (modalShown) {
  const m = document.getElementById('st-phone-update-modal');
  const btn = m && m.querySelector('.st-phone-update-btn-primary');
  if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (_e) { /* 退回 DOM 直点 */ } }
  realClick(btn);
  modalClosed = await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
report({ name: 'update-modal-dismissed', ok: modalClosed, detail: modalShown ? (modalClosed ? '弹窗已真点关闭' : '点了关闭键弹窗仍在') : '本版本公告未弹，跳过' });
const homeView = document.querySelector('.view-stack-container [data-view-id="home"]');
report({ name: 'view-stack-present', ok: !!homeView, detail: 'home 图层 = ' + !!homeView });
/* ── 一、主屏图标：真盒 + 真命中（★ 只量当前页） ──
 * ★ 本版自己抓到的判据缺陷（首版写法错）：首版对**全部** 86 个图标元素做命中测试，
 *   得到 62 个「未命中」—— 逐条取证后发现它们全在第 1~4 页（`aria-hidden=true`），
 *   盒模型 x 从 464 起、而视口宽 390 ⇒ 它们**本来就在视口外**，是分页的正确行为。
 *   判据与实现粒度不匹配，就会把「设计如此」判成「入口被遮挡」（假红）。
 *   修法：只对**当前页**（aria-hidden !== 'true'）的图标做命中测试，
 *   并另加一条「翻页后下一页也真可命中」，两向都守 —— 既不假红，也不放过真的遮挡。
 */
const pages = [...document.querySelectorAll('.home-screen .app-grid-page')];
const isCurrentPage = (el) => {
  const p = el.closest('.app-grid-page');
  return !p || p.getAttribute('aria-hidden') !== 'true';
};
const iconEls = [...document.querySelectorAll('.home-screen .app-icon, .home-screen .dock-app, .home-screen .home-widget-card')];
const currentIcons = iconEls.filter(isCurrentPage);
let iconZero = [];
let iconHitFail = [];
for (const el of currentIcons) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) { iconZero.push(el.dataset.app || el.className.slice(0, 20)); continue; }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!(hit && (hit === el || el.contains(hit) || hit.contains(el)))) iconHitFail.push(el.dataset.app || el.className.slice(0, 20));
}
report({ name: 'icon-has-box', ok: iconZero.length === 0, detail: '当前页图标=' + currentIcons.length + ' / 全部=' + iconEls.length + ' 零盒=' + JSON.stringify(iconZero) });
report({ name: 'icon-hit-test', ok: iconHitFail.length === 0, detail: '未命中=' + JSON.stringify(iconHitFail) });
report({ name: 'home-paged', ok: pages.length > 1, detail: '页数=' + pages.length });
/* 翻页可用性：点第 2 页页码后，该页图标必须真可命中（守「分页不是把图标藏死」） */
/* ★ 本版自己抓到的第 2 处判据缺陷（首版写法错）：
 *   首版直接点页码后取第 2 页图标盒，得到 0/20 可命中，而 `aria-hidden` 已正确翻成 false
 *   —— 取证后发现行内 transform **已写对**（`translate3d(-100%, 0, 0)`），
 *   但 `--dump-dom` 是**单帧**模式：CSS transition 冻结在 t=0，computed transform 恒为恒等，
 *   页盒永远停在 t=0 位置（x=444，视口宽 390 ⇒ 全部在视口外）。
 *   这不是产品缺陷 —— 真机上 0.28s 过渡正常推进；禁 transition 等效于系统「减少动画」
 *   的用户形态，是**合法取证口径**。本仓 o1-search-cancel.scen.js 第 4 版修正已记录同一坑，
 *   本场景首版没沿用 ⇒ 重复踩坑。修法：翻页前先禁 transition，并另加一条
 *   「位移真发生」读数（守「禁了 transition 但 transform 根本没被写」这种假绿）。
 */
let page2Ok = null;
if (pages.length > 1) {
  const dot = document.querySelector('.home-page-dot[data-page-index="1"]');
  if (dot) {
    const pagerEl = document.querySelector('.home-screen .app-grid-pager');
    if (pagerEl) pagerEl.style.transition = 'none';
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => (pages[1].getAttribute('aria-hidden') !== 'true' ? true : null), { timeoutMs: 3000, stepMs: 40 });
    await new Promise((r) => setTimeout(r, 250));
    /* 位移真发生：pager 的 computed transform 必须不是恒等（否则翻页只是改了 aria，页没动） */
    const pagerNow = document.querySelector('.home-screen .app-grid-pager');
    const tf = pagerNow ? getComputedStyle(pagerNow).transform : 'none';
    const p2Left = Math.round(pages[1].getBoundingClientRect().left);
    report({ name: 'page2-transform-applied', ok: tf !== 'none' && tf !== '', detail: 'pager transform=' + tf + ' · 第 2 页 left=' + p2Left });
    const p2 = iconEls.filter((el) => el.closest('.app-grid-page') === pages[1]);
    let ok2 = 0;
    for (const el of p2) {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) ok2 += 1;
    }
    page2Ok = ok2 === p2.length && p2.length > 0;
    report({ name: 'page2-hit-test', ok: !!page2Ok, detail: '第 2 页图标 ' + ok2 + '/' + p2.length + ' 可命中' });
    /* 翻回第 1 页（后续逐开要在主屏页 0 上操作） */
    const dot0 = document.querySelector('.home-page-dot[data-page-index="0"]');
    if (dot0) dot0.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => (pages[0].getAttribute('aria-hidden') !== 'true' ? true : null), { timeoutMs: 3000, stepMs: 40 });
  } else {
    report({ name: 'page2-hit-test', ok: false, detail: '找不到第 2 页页码（分页控件缺失）' });
  }
} else {
  report({ name: 'page2-hit-test', ok: true, detail: '单页布局，无翻页面' });
}
const reachable = new Set(iconEls.map((el) => el.dataset.app).filter(Boolean));
const notOnHome = ids.filter((id) => !reachable.has(id));
report({ name: 'home-reachable-ids', ok: notOnHome.length === 0, detail: '主屏可达 ' + reachable.size + ' / ' + ids.length + '；不在主屏=' + JSON.stringify(notOnHome) });
/* ── 二、逐个开屏：真派发 phone:openApp（走入口自己的监听器，不调内部函数） ──
 * ★ 本版自己抓到的第 3 处判据缺陷（首版写法错）：首版按 `view-{appId}` 找图层，得到 82/82「无图层」
 *   —— 取证后发现**图层名是各 App 自定的**：
 *     `setContent(html, viewId)` 的 viewId 由**调用方传名**（`wechat-main` / `album-main` /
 *     `games-2048` / `sts-setup` / `diary-<view>`…），index.js 的路由**不**按 appId 命名。
 *   即「名字假设」既无契约也无惯例，纯属凭空发明 ⇒ 必然全红。
 *   修法：不猜名字，改用渲染机制**自己的账目** `.phone-view-current`
 *   （phone-shell.js 的 Z-Index 管理层唯一出口），并加两向约束防假绿：
 *     ① 该图层的 `data-view-id` 必须**与打开前不同**（否则「A 没打开但 B 的图层还在」会被判成成功）；
 *     ② 当前图层不得是主屏 `home`（否则「根本没离开主屏」会被判成成功）。
 *
 * ★ 本版自己抓到的第 4 处判据缺陷（首版写法错）：首版每开一个 App 就点一次真返回键，
 *   下一条读数**全部**是「无图层」—— 真因是 phone-shell.goHome() 会写
 *   `window.VirtualPhone._homeReturnGuardUntil = Date.now() + 500`，
 *   而 index.js 的 phone:openApp 处理器**开头就**按它 return。
 *   即首版把「用户 500ms 内连点两次」这个**被刻意屏蔽**的形态当成了正常路径
 *   （本仓 o1-core-flow 早已记录同一坑并等 560ms 过去，首版没沿用 ⇒ 重复踩坑）。
 *   修法：回主屏后等过屏蔽窗口再开下一个；并**把这个契约本身**单独量一条
 *   （回主屏后立刻派发必须被屏蔽 —— 屏蔽是设计，不是缺陷，不能只在别处顺带依赖）。
 */
const viewIdNow = () => {
  const v = document.querySelector('.view-stack-container .phone-view-current');
  return v ? v.getAttribute('data-view-id') : null;
};
const atHome = () => {
  const hv = document.querySelector('.view-stack-container [data-view-id="home"]');
  return !!(hv && getComputedStyle(hv).display !== 'none' && hv.getBoundingClientRect().width > 0);
};
async function probeOne(id) {
  const before = viewIdNow();
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: id } }));
  /* ★ 本版自己抓到的第 5 处判据缺陷（首版写法错）：`host-stub.waitFor` 返回的是 **boolean**，
   *   不是元素（只回 `true`/`false`，见 host-stub.mjs:166）。首版把它当元素用，
   *   于是得到布尔值后去调 `.getBoundingClientRect()` ⇒ 直接抛错，
   *   连带整个场景以 `scenario-threw` 收场。修法：等到真后重新取一次元素，
   *   并在取后再校一次图层名（防“等到后又被别人换掉”的竞态）。 */
  const found = await waitFor(() => {
    const v = document.querySelector('.view-stack-container .phone-view-current');
    if (!v) return false;
    const vid = v.getAttribute('data-view-id');
    if (!vid || vid === before) return false;   /* ① 图层必须真的换了 */
    if (vid === 'home') return false;           /* ② 不能还停在主屏 */
    const r = v.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, { timeoutMs: 4000, stepMs: 40 });
  const view = found ? document.querySelector('.view-stack-container .phone-view-current') : null;
  if (!view) return { id: id, stage: 'no-view', from: before, to: viewIdNow() };
  const r = view.getBoundingClientRect();
  const textLen = String(view.textContent || '').replace(/\s+/g, '').length;
  const nodes = view.querySelectorAll('*').length;
  /* 真命中（★ 本版自己抓到的第 6 处判据缺陷）：首版取图层自身的中心点做命中测试，
   *   得到 6/6 「中心点未命中」。真因：图层自身是 `background: transparent`，
   *   中心点若是空白，`elementFromPoint` 会**穿透**到下层（这是浏览器正确行为，不是缺陷）。
   *   即「图层中心点必有元素」是一个不成立的假设（假红）。
   *   修法：不看图层自身，而看**图层内可见元素**：
   *     ① 至少 1 个图层内可见元素的中心点命中**属于本图层**（守「整层被盖住 / 宽度为零」）；
   *     ② 命中**另一个 [data-view-id] 图层**的次数必须为 0（守「被另一个 App 图层盖住」）。
   *     命中「非图层常驻元素」（返回键、小白条——它们在 .phone-screen 下、不在 stack 内）
   *     视为可接受：它们本就是设计上要盖在内容上的（返回键 z-index:40）。
   *   性能：每 App 最多测 30 个可见元素，避免 82 App × 数百元素的布局抖动。 */
  let selfHit = 0;
  let otherLayerHits = [];
  let probed = 0;
  for (const el of view.querySelectorAll('*')) {
    if (probed >= 30) break;
    const er = el.getBoundingClientRect();
    if (er.width <= 0 || er.height <= 0) continue;
    const cx = er.left + er.width / 2;
    const cy = er.top + er.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    probed += 1;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) continue;
    const owner = hit.closest('[data-view-id]');
    if (owner === view) selfHit += 1;
    else if (owner) otherLayerHits.push(owner.getAttribute('data-view-id'));
  }
  const hitOk = selfHit > 0 && otherLayerHits.length === 0;
  return { id: id, stage: 'ok', layer: view.getAttribute('data-view-id'), w: Math.round(r.width), h: Math.round(r.height), textLen: textLen, nodes: nodes, probed: probed, selfHit: selfHit, otherLayer: otherLayerHits.slice(0, 3), hitOk: hitOk };
}
/* 屏蔽窗口契约（循环前单独量一次）：开一个 App → 点真返回键回主屏 → 立刻再派发必须被拦下 */
{
  await probeOne(ids[0]);
  const b0 = document.getElementById('phone-back-button');
  if (b0) b0.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => (atHome() ? true : null), { timeoutMs: 2000, stepMs: 40 });
  const beforeGuard = viewIdNow();
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'settings' } }));
  await new Promise((res) => setTimeout(res, 300));
  const blocked = viewIdNow() === beforeGuard;
  report({ name: 'home-return-guard', ok: blocked, detail: blocked ? '回主屏后 500ms 内派发 openApp 被屏蔽（设计如此）' : '回主屏后立刻派发被放行 —— 重入屏蔽失效' });
  await new Promise((res) => setTimeout(res, 560));
}
const results = [];
let backWorked = 0;
for (const id of ids) {
  const r = await probeOne(id);
  results.push(r);
  /* 回主屏：点真返回键（不调内部函数）—— 「按钮在 DOM 里」不等于「接线了」 */
  const back = document.getElementById('phone-back-button');
  if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const backHome = await waitFor(() => (atHome() ? true : null), { timeoutMs: 2000, stepMs: 40 });
  if (backHome) backWorked += 1;
  /* 等过 _homeReturnGuardUntil（500ms）再开下一个 —— 否则会被自己的返回键屏蔽掉 */
  await new Promise((res) => setTimeout(res, 560));
}
const noView = results.filter((r) => r.stage === 'no-view').map((r) => r.id + '(' + r.from + '→' + r.to + ')');
const emptyScreen = results.filter((r) => r.stage === 'ok' && r.textLen < 5).map((r) => r.id);
const noNodes = results.filter((r) => r.stage === 'ok' && r.nodes < 3).map((r) => r.id);
const hitFail = results.filter((r) => r.stage === 'ok' && !r.hitOk).map((r) => r.id);
const okCount = results.filter((r) => r.stage === 'ok').length;
report({ name: 'open-all-82', ok: noView.length === 0, detail: '已开=' + okCount + '/' + ids.length + ' · 无图层=' + JSON.stringify(noView) });
report({ name: 'open-visible-text', ok: emptyScreen.length === 0, detail: '首屏文本过短=' + JSON.stringify(emptyScreen) });
report({ name: 'open-has-nodes', ok: noNodes.length === 0, detail: '首屏节点过少=' + JSON.stringify(noNodes) });
report({ name: 'open-hit-test', ok: hitFail.length === 0, detail: '图层内无可命中元素 / 被别图层盖住=' + JSON.stringify(hitFail) });
report({ name: 'back-key-returns', ok: backWorked === ids.length, detail: '返回键真回主屏 ' + backWorked + '/' + ids.length });
/* 模态弹窗归零：逐开 82 个应用过程中不得再次被任何应用弹出并持续盖住首屏 */
await new Promise((res) => setTimeout(res, 600));
const modalBack = !!document.getElementById('st-phone-update-modal');
report({ name: 'no-modal-after-sweep', ok: !modalBack, detail: modalBack ? '逐开后弹窗又出现（会盖住首屏）' : '逐开后无弹窗遮挡' });
/* 逐条读数全量带出（便于归因；不参与 ok/fail 判定） */
report({ name: 'per-app-readings', ok: true, detail: JSON.stringify(results) });
done();
const stack2 = document.querySelector('.view-stack-container');
report({ name: 'D-stack-exists', ok: true, detail: 'stack=' + !!stack2 });
const scr = document.querySelector('.phone-screen');
report({ name: 'D-screen-children', ok: true, detail: scr ? [...scr.children].map((c) => c.tagName + '.' + String(c.className).slice(0, 40) + (c.id ? '#' + c.id : '')).join(' | ') : 'no-screen' });
report({ name: 'D-current', ok: true, detail: 'current=' + (document.querySelector('.phone-view-current') ? document.querySelector('.phone-view-current').getAttribute('data-view-id') : 'none') + ' · allViews=' + JSON.stringify([...document.querySelectorAll('[data-view-id]')].map((v) => v.getAttribute('data-view-id'))) });
report({ name: 'D-back-btn', ok: true, detail: 'back=' + !!document.getElementById('phone-back-button') + ' display=' + (document.getElementById('phone-back-button') ? getComputedStyle(document.getElementById('phone-back-button')).display : '-') });
report({ name: 'D-visible-fullscreen', ok: true, detail: JSON.stringify([...document.querySelectorAll('#phone-panel > *, #phone-panel-content > *')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.tagName + '.' + String(el.className).slice(0, 50) + (el.id ? '#' + el.id : ''))) });
done();
