/* ============================================================
 * tests/browser/scenarios/o8-pixiv-bottomnav.scen.js
 *   O8 场景④：Pixiv「照现实」改造验收（底栏一级导航 / 两格未实现给真话）
 * ------------------------------------------------------------
 * 对照对象：App Store 官方 pixiv 8.11.5（id 337248563，2026-11-24 更新）。
 *
 * 官方依据（机器可查，不靠记忆）：pixiv 官方公告
 *   「Android版pixivアプリにナビゲーションメニューを追加しました」（pixiv.net/info.php，2024-06-11）
 *   原文：これまで右上のアイコンから切り替えていた「ホーム」「検索」「新着」の各画面が、
 *   本アップデート以降は**画面下のナビゲーションメニュー**から利用できるようになります。
 *   并明确菜单项另含「通知」与「マイページ」。
 *   ⇒ 官方一级导航在**底栏**（不是顶部平铺），且共五格。
 *
 * 本仓的两处有意偏离（都写在这里，不靠记忆；理由与 lofter 场景同源「能力在就不许没有入口」）：
 *   ① **「新着」不落**：官方那格是「跨用户按投稿时间排的新投稿」，本仓没有跨用户投稿流
 *      （稿子都是用户自己贴进来的）。落一格只能指回「作品」面 —— 两格指向同一个面就是
 *      假按钮（点哪个都一样，用户会以为在切视野）。宁可少一格。
 *   ② **「插画」补在检索之后**：官方把插画/漫画/小说当作首页顶部的作品类型筛，不是底栏格；
 *      本仓没有「一套首页 + 类型筛」结构，插画是一整面（自有作者池与收藏），
 *      不给入口则这一面在一级导航里完全走不到。
 *   「通知」照官方列出但标 disabled（本仓无站内信落地），点了给一句真话。
 *
 * 量的四件事（真盒模型 + 真点击，不读声明）：
 *   ① 底栏常驻底部（delta ≤1px）+ 拇指可点高度（布局 offsetHeight ≥44）；
 *   ② 五格文案与顺序；「通知」opacity≈.38 + aria-disabled；可点格热区 ≥44；
 *   ③ 四格真能切（App tab() 状态 + 面板锚点双向确认）；
 *   ④ 切过一圈后底栏仍贴底（整页重绘最容易丢的一条）。
 *
 * 单独跑：
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-pixiv-bottomnav.scen.js
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (e) { report({ name: 'entry-import', ok: false, detail: String(e && e.message) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 20000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 20000 });

window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'pixiv' } }));
const appUp = await waitFor(() => document.querySelector('.pxv-app'), { timeoutMs: 20000 });
report({ name: 'pixiv-open', ok: appUp, detail: appUp ? '.pxv-app 到场' : '未开屏' });

const box = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
};
const APP = () => window.VirtualPhone && window.VirtualPhone.pixivApp;

/* ── ① 底栏几何 ─────────────────────────────────────────── */
const nav = document.querySelector('.pxv-bottomnav');
const rootEl = document.querySelector('.pxv-app');
let navBox = null;
if (nav && rootEl) {
  navBox = box(nav);
  const appBox = box(rootEl);
  report({
    name: 'nav-pinned-to-bottom',
    ok: Math.abs(navBox.b - appBox.b) <= 1,
    detail: `navBottom=${navBox.b} appBottom=${appBox.b} delta=${navBox.b - appBox.b}`,
  });
  /* 高度用**布局单位 offsetHeight**：外壳对整屏做了 scale（实测 728 → 655），
   *   rect 是缩放后的视觉值，拿它判 44px 拇指高度会得到假红（微博 43px、淘宝 41px 同坑）。 */
  report({
    name: 'nav-touch-height',
    ok: nav.offsetHeight >= 44,
    detail: `offsetH=${nav.offsetHeight} rectH=${navBox.h}`,
  });
  const main = document.querySelector('.pxv-main');
  if (main) {
    report({
      name: 'main-above-nav',
      ok: Math.round(box(main).b) <= navBox.t + 1,
      detail: `mainBottom=${box(main).b} navTop=${navBox.t}`,
    });
  }
} else {
  report({ name: 'nav-exists', ok: false, detail: nav ? '.pxv-app 缺失' : '.pxv-bottomnav 不存在' });
}

/* ── ② 五格文案 / 顺序 / 禁用态 ─────────────────────────── */
/* 官方五格是 ホーム / 検索 / 新着 / 通知 / マイページ；本仓去「新着」、插画补在检索之后 —— 见文件头。 */
const EXPECT = ['首页', '检索', '插画', '通知', '我的'];
if (nav) {
  const items = [...nav.querySelectorAll('.pxv-navitem')];
  const labels = items.map((i) => (i.textContent || '').trim());
  report({ name: 'nav-five-slots', ok: items.length === 5, detail: `count=${items.length} ${JSON.stringify(labels)}` });
  report({
    name: 'nav-order-matches-plan',
    ok: JSON.stringify(labels) === JSON.stringify(EXPECT),
    detail: `got=${JSON.stringify(labels)} want=${JSON.stringify(EXPECT)}`,
  });
  /* 「新着」不许出现：本仓没有跨用户投稿流，那一格只能指回同一个面（假按钮）。 */
  report({
    name: 'no-fake-shinchaku',
    ok: !labels.includes('新着'),
    detail: labels.includes('新着') ? '出现了「新着」—— 本仓无跨用户投稿流，它会指回同一个面' : '无「新着」格',
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
  report({
    name: 'disabled-is-notice',
    ok: disLabels.length === 1 && disLabels[0] === '通知',
    detail: 'disabled=' + JSON.stringify(disLabels),
  });
  /* 可点格必须有真热区（微博那轮被 flex 收缩压到 26px 过）。 */
  const live = items.filter((i) => !i.classList.contains('is-disabled'));
  const short = live.filter((i) => i.offsetHeight < 44);
  report({
    name: 'live-slots-tappable',
    ok: live.length === 4 && short.length === 0,
    detail: `live=${live.length} 高度不足=${JSON.stringify(short.map((i) => (i.textContent || '').trim() + ':' + i.offsetHeight))}`,
  });
  /* 高亮必须**唯一**：两格同时 is-on 说明当前面判定有歧义。 */
  const on = items.filter((i) => i.classList.contains('is-on')).map((i) => (i.textContent || '').trim());
  report({
    name: 'nav-highlight-single',
    ok: on.length === 1,
    detail: 'on=' + JSON.stringify(on),
  });
}

/* ── ③ 四格真能切 ───────────────────────────────────────── */
const clickTab = async (label) => {
  const el = [...document.querySelectorAll('.pxv-bottomnav .pxv-navitem')]
    .find((i) => (i.textContent || '').trim() === label);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 350));
  return true;
};
if (nav) {
  /* 「检索」⇒ 搜索面板的输入框（#pxv-search）必须真出现。 */
  const okSearch = await clickTab('检索');
  const stSearch = APP() ? APP().tab() : null;
  report({
    name: 'nav-search-switches',
    ok: okSearch && stSearch === 'search' && !!document.querySelector('#pxv-search'),
    detail: `clicked=${okSearch} tab=${stSearch} input=${!!document.querySelector('#pxv-search')}`,
  });
  /* 「插画」⇒ illust 面。 */
  const okIllust = await clickTab('插画');
  const stIllust = APP() ? APP().tab() : null;
  report({
    name: 'nav-illust-switches',
    ok: okIllust && stIllust === 'illust',
    detail: `clicked=${okIllust} tab=${stIllust}`,
  });
  /* 「我的」⇒ me 面（我的五格页签 .pxv-subtabs 是这一面的锚点）。 */
  const okMine = await clickTab('我的');
  const stMine = APP() ? APP().tab() : null;
  report({
    name: 'nav-me-switches',
    ok: okMine && stMine === 'me' && !!document.querySelector('.pxv-subtabs'),
    detail: `clicked=${okMine} tab=${stMine} subtabs=${!!document.querySelector('.pxv-subtabs')}`,
  });
  /* 「首页」⇒ 回作品面。 */
  const okHome = await clickTab('首页');
  const stHome = APP() ? APP().tab() : null;
  report({
    name: 'nav-home-switches',
    ok: okHome && stHome === 'novel',
    detail: `clicked=${okHome} tab=${stHome}`,
  });
  /* ④ 切过一圈后底栏仍然贴底（整页重绘后底栏若丢失/被推走，只有切过一次才看得出来）。 */
  const navAfter = document.querySelector('.pxv-bottomnav');
  const rootAfter = document.querySelector('.pxv-app');
  const stillThere = !!(navAfter && rootAfter);
  report({
    name: 'nav-still-pinned-after-switch',
    ok: stillThere && Math.abs(box(navAfter).b - box(rootAfter).b) <= 1,
    detail: stillThere ? `navBottom=${box(navAfter).b} appBottom=${box(rootAfter).b}` : '切页后底栏消失了',
  });
  report({
    name: 'same-shell-reused',
    ok: !!document.querySelector('.pxv-root'),
    detail: document.querySelector('.pxv-root') ? '.pxv-root 在场（refresh 复用同一根）' : '.pxv-root 丢了',
  });
}

/* ── ⑤ 未实现格点了给真话 ───────────────────────────────── */
if (nav) {
  const soon = document.querySelector('.pxv-navitem.is-disabled');
  if (soon) {
    soon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 350));
    const flash = document.querySelector('.pxv-flash');
    const txt = flash ? (flash.textContent || '').trim() : '';
    report({
      name: 'disabled-gives-real-answer',
      ok: !!flash && txt.includes('还没做'),
      detail: txt || '点了没反应（静默）—— 会被当成按钮坏了',
    });
  }
}

done();