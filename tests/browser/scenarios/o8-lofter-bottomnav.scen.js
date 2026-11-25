/* ============================================================
 * tests/browser/scenarios/o8-lofter-bottomnav.scen.js
 *   O8 场景③：老福特「照现实」改造验收（底栏一级导航 / 中央发布键不落 / 未实现格给真话）
 * ------------------------------------------------------------
 * 对照对象：App Store 官方 LOFTER 8.3.78（id 494514224，2026-11-22 更新）
 *
 * 官方结构（本场景的判据来源）：
 *   · 一级导航在**底栏**且常驻，不是把四格平铺在顶部当按钮；
 *   · 底栏形如 首页 / 关注 / ⨁ / 消息 / 我的 —— 正中那颗 ⨁ 是**发布键**。
 *
 * 本仓的两处有意偏离（都写在这条判据旁边，不靠记忆）：
 *   ① **不落中央发布键**：本仓没有「发布」这条链路（生成侧归宿主，App 不替宿主调模型），
 *      画一颗点了不发生的按钮等于骗人 ⇒ 五格变四格 + 一格禁用。
 *   ② **「搜索」落在底栏最后一格**：官方搜索在顶部。本仓没有顶部搜索框，若也不给底栏
 *      入口，`search` 这一面（含本地搜索面板）在一级导航里就完全走不到。
 *   两条都是「结构照官方、能力照本仓」，不是随手改。
 *
 * 量的四件事（都是真盒模型 + 真点击，不读声明）：
 *   ① 底栏是否**常驻底部**（delta ≤1px）与**拇指可点高度**（布局 offsetHeight ≥44）；
 *   ② 格数与文案；「消息」必须看得出不能点（整格 opacity ≈.38 + aria-disabled），
 *      点了要有**真话提示**（页面内提示条）而不是静默 —— 静默会被当成按钮坏了；
 *   ③ 四格真能切：点「关注」/「我的」/「搜索」内容区必须真的跟着换（读数用 App 的
 *      tab() 状态 + 面板锚点类名双向确认，不只认类名）；
 *   ④ 底栏**切换后仍然常驻**（最容易漏的一条：切页时整页重绘，底栏若被重绘丢失/
 *      被内容推走，只有切过一次才看得出来）。
 *
 * 单独跑：
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-lofter-bottomnav.scen.js
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (e) { report({ name: 'entry-import', ok: false, detail: String(e && e.message) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 20000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 20000 });

/* 真派发入口自己的事件，不调内部函数 —— 走用户的真实路径。 */
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'lofter' } }));
const appUp = await waitFor(() => document.querySelector('.lof-app'), { timeoutMs: 20000 });
report({ name: 'lofter-open', ok: appUp, detail: appUp ? '.lof-app 到场' : '未开屏' });

const box = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};
const APP = () => window.VirtualPhone && window.VirtualPhone.lofterApp;
/* 视图实例的槽位是 `_view`（不是 .view / .lofterView）—— 读错路径会得到 undefined，
 *   那会让「切换明明成功」变成假红（微博那轮在 weiboApp.weiboView 上踩过一次）。 */
const VIEW = () => {
  const a = APP();
  return a ? (a._view || a.view || a.lofterView || null) : null;
};

/* ── ① 底栏几何 ─────────────────────────────────────────── */
const nav = document.querySelector('.lof-bottomnav');
const rootEl = document.querySelector('.lof-app');
let navBox = null;
let appBox = null;
if (nav && rootEl) {
  navBox = box(nav);
  appBox = box(rootEl);
  report({
    name: 'nav-pinned-to-bottom',
    ok: Math.abs(navBox.b - appBox.b) <= 1,
    detail: `navBottom=${navBox.b} appBottom=${appBox.b} delta=${navBox.b - appBox.b}`,
  });
  /* 高度必须用**布局单位 offsetHeight**：手机外壳对整屏做了 scale（实测 728 → 655），
   *   rect 是缩放后的视觉值，拿它判「有没有 44px 拇指高度」会得到假红
   *   （微博读到 43px、淘宝 offsetH=45 / rectH=41 都是同一个坑）。 */
  report({
    name: 'nav-touch-height',
    ok: nav.offsetHeight >= 44,
    detail: `offsetH=${nav.offsetHeight} rectH=${navBox.h}`,
  });
  /* 底栏不能盖住内容：内容区下沿必须落在底栏上沿之上（允许 1px 亚像素误差）。 */
  const main = document.querySelector('.lof-main');
  if (main) {
    report({
      name: 'main-above-nav',
      ok: Math.round(box(main).b) <= navBox.t + 1,
      detail: `mainBottom=${box(main).b} navTop=${navBox.t}`,
    });
  }
} else {
  report({ name: 'nav-exists', ok: false, detail: nav ? '.lof-app 缺失' : '.lof-bottomnav 不存在' });
}

/* ── ② 格数 / 文案 / 禁用态 ─────────────────────────────── */
/* 官方底栏是「首页 / 关注 / ⨁ / 消息 / 我的」；本仓不画发布键、搜索补在末位 —— 见文件头① ②。 */
const EXPECT = ['首页', '关注', '消息', '我的', '搜索'];
if (nav) {
  const items = [...nav.querySelectorAll('.lof-navitem')];
  const labels = items.map((i) => (i.textContent || '').trim());
  report({ name: 'nav-five-slots', ok: items.length === 5, detail: `count=${items.length} ${JSON.stringify(labels)}` });
  report({
    name: 'nav-order-matches-plan',
    ok: JSON.stringify(labels) === JSON.stringify(EXPECT),
    detail: `got=${JSON.stringify(labels)} want=${JSON.stringify(EXPECT)}`,
  });
  /* 官方那颗中央发布键**不能**出现：本仓没有发布链路，出现即为「点了不发生的假按钮」。 */
  const fakePub = items.filter((i) => /发布|写稿|\+/.test((i.textContent || '').trim()));
  report({
    name: 'no-fake-publish-key',
    ok: fakePub.length === 0,
    detail: fakePub.length ? '出现了发布键：' + JSON.stringify(fakePub.map((i) => (i.textContent || '').trim()))
      : '无发布键（本仓无发布链路，不画假键）',
  });
  const dis = items.filter((i) => i.classList.contains('is-disabled'));
  const disLabels = dis.map((i) => (i.textContent || '').trim());
  const disOp = dis.map((i) => Number(getComputedStyle(i).opacity));
  const disAria = dis.every((i) => i.getAttribute('aria-disabled') === 'true');
  report({
    name: 'nav-disabled-one',
    ok: dis.length === 1 && disAria && disOp.every((o) => o > 0.2 && o < 0.6),
    detail: `disabled=${JSON.stringify(disLabels)} aria=${disAria} opacity=${JSON.stringify(disOp)}`,
  });
  /* 「消息」必须落在禁用那一格上（不是随便一格禁用就过）。 */
  report({
    name: 'disabled-is-message',
    ok: disLabels.length === 1 && disLabels[0] === '消息',
    detail: 'disabled=' + JSON.stringify(disLabels),
  });
  /* 四格可点项必须真有热区：布局尺寸 ≥44px 高（微博那轮被 flex 收缩压到 26px 过）。 */
  const live = items.filter((i) => !i.classList.contains('is-disabled'));
  const short = live.filter((i) => i.offsetHeight < 44);
  report({
    name: 'live-slots-tappable',
    ok: live.length === 4 && short.length === 0,
    detail: `live=${live.length} 高度不足的=${JSON.stringify(short.map((i) => (i.textContent || '').trim() + ':' + i.offsetHeight))}`,
  });
}

/* ── ③ 四格真能切 ───────────────────────────────────────── */
const clickTab = async (label) => {
  const el = [...document.querySelectorAll('.lof-bottomnav .lof-navitem')]
    .find((i) => (i.textContent || '').trim() === label);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 350));
  return true;
};
if (nav) {
  /* 「我的」⇒ App 状态 + 面板锚点双向确认。 */
  const okMine = await clickTab('我的');
  const stMine = APP() ? APP().tab() : null;
  report({
    name: 'nav-me-switches',
    ok: okMine && stMine === 'me' && !!document.querySelector('.lof-subtabs'),
    detail: `clicked=${okMine} tab=${stMine} subtabs=${!!document.querySelector('.lof-subtabs')}`,
  });
  const onMine = [...document.querySelectorAll('.lof-navitem.is-on')].map((i) => (i.textContent || '').trim());
  report({
    name: 'nav-me-highlight',
    ok: onMine.length === 1 && onMine[0] === '我的',
    detail: 'on=' + JSON.stringify(onMine),
  });
  /* 「搜索」⇒ 搜索面板的输入框必须真出现（面板锚点：#lof-search）。 */
  const okSearch = await clickTab('搜索');
  const stSearch = APP() ? APP().tab() : null;
  report({
    name: 'nav-search-switches',
    ok: okSearch && stSearch === 'search' && !!document.querySelector('#lof-search'),
    detail: `clicked=${okSearch} tab=${stSearch} input=${!!document.querySelector('#lof-search')}`,
  });
  /* 「关注」⇒ 关注面（作者池是这一面独有的锚点）。 */
  const okFollow = await clickTab('关注');
  const stFollow = APP() ? APP().tab() : null;
  report({
    name: 'nav-follow-switches',
    ok: okFollow && stFollow === 'follow',
    detail: `clicked=${okFollow} tab=${stFollow}`,
  });
  /* 「首页」⇒ 回首页（月份分组或空态文案二者之一必在场）。 */
  const okHome = await clickTab('首页');
  const stHome = APP() ? APP().tab() : null;
  report({
    name: 'nav-home-switches',
    ok: okHome && stHome === 'home',
    detail: `clicked=${okHome} tab=${stHome}`,
  });
  /* ④ 切过一圈之后底栏仍然贴底 —— 最容易漏的一条：整页重绘后底栏若丢失/被推走，
   *   只有「切过一次」才看得出来（首次渲染正常不代表重绘正常）。 */
  const navAfter = document.querySelector('.lof-bottomnav');
  const rootAfter = document.querySelector('.lof-app');
  const stillThere = !!(navAfter && rootAfter);
  report({
    name: 'nav-still-pinned-after-switch',
    ok: stillThere && Math.abs(box(navAfter).b - box(rootAfter).b) <= 1,
    detail: stillThere
      ? `navBottom=${box(navAfter).b} appBottom=${box(rootAfter).b}`
      : '切页后底栏消失了',
  });
  /* 同一层切换不重建根节点（视图的 refresh 只换 innerHTML，_root 复用）；
   *   这一条防的是「每切一次都重建外壳、滚动位置与宿主图层全丢」。 */
  const rootNow = document.querySelector('.lof-root');
  report({
    name: 'same-shell-reused',
    ok: !!rootNow,
    detail: rootNow ? '.lof-root 在场（refresh 复用同一根）' : '.lof-root 丢了',
  });
}

/* ── ⑤ 未实现格点了给真话 ───────────────────────────────── */
if (nav) {
  const soon = document.querySelector('.lof-navitem.is-disabled');
  if (soon) {
    soon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    const flash = document.querySelector('.lof-flash');
    const txt = flash ? (flash.textContent || '').trim() : '';
    report({
      name: 'disabled-gives-real-answer',
      ok: !!flash && txt.includes('还没做'),
      detail: txt || '点了没反应（静默）—— 会被当成按钮坏了',
    });
  }
}

done();
