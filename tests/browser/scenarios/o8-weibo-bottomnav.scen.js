/* ============================================================
 * tests/browser/scenarios/o8-weibo-bottomnav.scen.js
 *   O8 场景①：微博「照现实」改造验收（底栏五格 / 资料卡归属 / 层级切换）
 * ------------------------------------------------------------
 * 对照对象：App Store 官方微博 16.11.3 —— 底栏五格
 *   首页 / 视频 / 发现 / 消息 / 我；「我」是**顶层页面**，资料卡只在那一层。
 *
 * 本场景只量「真盒模型 + 真点击」，不读任何声明：
 *   ① 底栏必须**常驻在 App 底部**（navBottom 与 appBottom 的差 ≤ 1px），
 *      且高度是**拇指可用**的高度（≥44px，官方约 49px）。旧实现在这里出过
 *      两个真坑：被父级 flex 收缩压到 26px、以及 .weibo-app 自己 overflow-y:auto
 *      导致底栏被内容推走。两者都不是「样式好不好看」，是「能不能点到」。
 *   ② 五格顺序与文案必须与官方一致，禁用项必须**降透明度 + aria-disabled**，
 *      不能看起来能点却没有反应。
 *   ③ 点「我」⇒ 资料卡出现、标题变「我」、子 tab 消失、底栏高亮移到「我」；
 *      再点「首页」⇒ 全部回退。这一条是**渲染粒度**的验收：
 *      旧的 switchTab 只换内容区，跨层时标题/资料卡/高亮全都不会动。
 *
 * 为什么不放在 gate 的默认场景集里：本场景依赖微博 app 的具体 DOM 契约，
 * 属于单个 App 的验收，放进去会让 gate 的失败面变宽。用
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-weibo-bottomnav.scen.js
 * 单独跑。
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
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'weibo' } }));
const appUp = await waitFor(() => document.querySelector('.weibo-app'), { timeoutMs: 20000 });
report({ name: 'weibo-open', ok: appUp, detail: appUp ? '.weibo-app 到场' : '未开屏' });

const box = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};

/* ── ① 底栏几何 ─────────────────────────────────────────── */
const nav = document.querySelector('.weibo-bottomnav');
const app = document.querySelector('.weibo-app');
let navBox = null;
let appBox = null;
if (nav && app) {
  navBox = box(nav);
  appBox = box(app);
  report({
    name: 'nav-pinned-to-bottom',
    ok: Math.abs(navBox.b - appBox.b) <= 1,
    detail: `navBottom=${navBox.b} appBottom=${appBox.b} delta=${navBox.b - appBox.b}`,
  });
  /* 高度必须用**布局单位 offsetHeight**，不能用 getBoundingClientRect：
   *   手机外壳对整个屏幕做了 scale（实测 728 → 655 ⇒ 0.9），rect 高度是
   *   缩放后的视觉值，用它判「是否达到 44px 拇指高度」会得到 43px 的假红。
   *   布局尺寸（offset/client）
   *   与视觉尺寸（rect）在这里是两个量纲，混用就是判据缺陷。
   *   —— 这也是本仓反复踩的同一类坑：红点本身是错的，比漏测更坏事。 */
  report({
    name: 'nav-touch-height',
    ok: nav.offsetHeight >= 44,
    detail: `offsetH=${nav.offsetHeight}px（布局） rectH=${navBox.h}px（含外壳缩放）`,
  });
} else {
  report({ name: 'nav-exists', ok: false, detail: nav ? 'app 缺失' : '.weibo-bottomnav 不存在' });
}

/* ── ② 五格顺序 / 文案 / 禁用态 ─────────────────────────── */
const EXPECT = ['首页', '视频', '发现', '消息', '我'];
if (nav) {
  const items = [...nav.querySelectorAll('.weibo-navitem')];
  const labels = items.map((i) => (i.textContent || '').trim());
  report({
    name: 'nav-five-slots',
    ok: items.length === 5,
    detail: `count=${items.length} labels=${JSON.stringify(labels)}`,
  });
  report({
    name: 'nav-order-matches-official',
    ok: JSON.stringify(labels) === JSON.stringify(EXPECT),
    detail: `got=${JSON.stringify(labels)} want=${JSON.stringify(EXPECT)}`,
  });
  const disabled = items.filter((i) => i.classList.contains('is-disabled'));
  const disOp = disabled.map((i) => Number(getComputedStyle(i).opacity));
  const disAria = disabled.every((i) => i.getAttribute('aria-disabled') === 'true');
  report({
    name: 'nav-disabled-three',
    ok: disabled.length === 3 && disAria && disOp.every((o) => o > 0.2 && o < 0.6),
    detail: `disabled=${disabled.length} aria=${disAria} opacity=${JSON.stringify(disOp)}（应为 3 项、aria-disabled、≈0.38）`,
  });
  /* 每个格子都必须是可点面积足够的控件，不是一堆内联文本 */
  const tooSmall = items.filter((i) => box(i).h < 40).map((i) => (i.textContent || '').trim() + ':' + box(i).h);
  report({
    name: 'nav-hits-are-tappable',
    ok: tooSmall.length === 0,
    detail: tooSmall.length ? '过矮：' + tooSmall.join(',') : '五格高度均 ≥40px',
  });
}

/* ── ③ 跨层切换：「我」与「首页」 ───────────────────────── */
const clickNav = (label) => {
  const el = [...document.querySelectorAll('.weibo-navitem')].find((i) => (i.textContent || '').trim() === label);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
};
const titleOf = () => {
  const t = document.querySelector('.weibo-nav-title');
  return t ? (t.textContent || '').trim() : 'none';
};

if (nav) {
  const clickedMe = clickNav('我');
  await new Promise((r) => setTimeout(r, 600));
  /* 实例挂在 weiboApp.weiboView（不是 .view）—— 读错路径会得到 undefined，
 *   而 undefined ！== 'myPosts' 就让「切换明明成功」变成一条假红。 */
  const view = window.VirtualPhone?.weiboApp?.weiboView;
  report({ name: 'click-me-dispatched', ok: clickedMe, detail: clickedMe ? '已派发' : '找不到「我」' });
  report({
    name: 'me-layer-tab',
    ok: view && view.currentTab === 'myPosts',
    detail: `currentTab=${view ? view.currentTab : 'n/a'}（应为 myPosts）`,
  });
  report({
    name: 'me-layer-title',
    ok: titleOf() === '我',
    detail: `nav-title=${titleOf()}（应为「我」）`,
  });
  report({
    name: 'me-layer-profile-shown',
    ok: !!document.querySelector('.weibo-profile-wrapper'),
    detail: document.querySelector('.weibo-profile-wrapper') ? '资料卡在场' : '资料卡缺失 —— 渲染粒度没生效',
  });
  report({
    name: 'me-layer-subtabs-hidden',
    ok: !document.querySelector('.weibo-tabs'),
    detail: document.querySelector('.weibo-tabs') ? '子 tab 仍在 —— 官方「我」下面没有子 tab' : '子 tab 已隐去',
  });
  const onMe = [...document.querySelectorAll('.weibo-navitem')].filter((i) => i.classList.contains('is-on'));
  report({
    name: 'me-layer-highlight',
    ok: onMe.length === 1 && (onMe[0].textContent || '').trim() === '我',
    detail: 'on=' + JSON.stringify(onMe.map((i) => (i.textContent || '').trim())),
  });

  /* 回到首页 */
  const clickedHome = clickNav('首页');
  await new Promise((r) => setTimeout(r, 600));
  const v2 = window.VirtualPhone?.weiboApp?.weiboView;
  report({ name: 'click-home-dispatched', ok: clickedHome, detail: clickedHome ? '已派发' : '找不到「首页」' });
  report({
    name: 'home-layer-tab',
    ok: v2 && v2.currentTab === 'hotSearch',
    detail: `currentTab=${v2 ? v2.currentTab : 'n/a'}（应为 hotSearch）`,
  });
  report({
    name: 'home-layer-profile-hidden',
    ok: !document.querySelector('.weibo-profile-wrapper'),
    detail: document.querySelector('.weibo-profile-wrapper') ? '资料卡还在 —— 官方首页顶部不挂资料卡' : '资料卡已隐去',
  });
  report({
    name: 'home-layer-subtabs-shown',
    ok: !!document.querySelector('.weibo-tabs'),
    detail: document.querySelector('.weibo-tabs') ? '子 tab 在场' : '子 tab 消失',
  });
  /* 底栏在来回跳之后仍然常驻（防「切一次就被推到屏幕外」） */
  const nav2 = document.querySelector('.weibo-bottomnav');
  const app2 = document.querySelector('.weibo-app');
  report({
    name: 'nav-still-pinned-after-switch',
    ok: nav2 && app2 && Math.abs(box(nav2).b - box(app2).b) <= 1,
    detail: nav2 && app2 ? `delta=${box(nav2).b - box(app2).b}` : 'nav/app 丢失',
  });
}

/* ── ④ 同层切换不重建（碎片化回归） ─────────────────────── */
if (nav) {
  clickNav('首页');
  await new Promise((r) => setTimeout(r, 400));
  const content = document.querySelector('.weibo-tab-content');
  const marker = content ? content : null;
  if (marker) marker.dataset.probeMark = 'kept';
  const rec = [...document.querySelectorAll('.weibo-tab')].find((t) => (t.textContent || '').trim() === '推荐');
  if (rec) rec.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
  const after = document.querySelector('.weibo-tab-content');
  report({
    name: 'same-layer-keeps-node',
    ok: !!(after && after.dataset.probeMark === 'kept'),
    detail: after ? (after.dataset.probeMark === 'kept' ? '内容节点复用（无整页重建）' : '节点被替换 —— 同层切换退化成整页重绘') : '内容区丢失',
  });
}

done();
