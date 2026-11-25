/* ============================================================
 * tests/browser/scenarios/o8-taobao-tabbar.scen.js
 *   O8 场景②：桃宝「照现实」验收（底栏五格 / 订单归属 / 禁用格）
 * ------------------------------------------------------------
 * 对照对象：App Store 官方淘宝 10.69.16 —— 底栏五格
 *   首页 / 逛逛 / 消息 / 购物车 / 我的。**订单不在底栏**，它是「我的」下的二级页。
 *
 * 量的是三件在真实设备上会出事的事：
 *   ① 底栏是否**常驻底部**（delta ≤1px）与**可点高度**（布局 offsetHeight ≥44）；
 *   ② 五格文案与顺序是否与官方一致；逛逛/消息必须**看得出不能点**
 *      （opacity 落在整格上 ≈.38 + aria-disabled），点了要有真话提示而不是静默；
 *   ③ 订单从底栏摘掉之后**仍然点得到**：我的 → 全部订单 → 订单页，
 *      且订单页的状态页签照旧可切。只摘不迁是最容易犯的错。
 *
 * 单独跑：
 *   node tests/browser/run-scenario.mjs tests/browser/scenarios/o8-taobao-tabbar.scen.js
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

installBrowserHost({ chat: [{ mes: 'a', is_user: false, swipes: ['x'], swipe_id: 0 }] });
try { await import('/index.js'); } catch (e) { report({ name: 'entry-import', ok: false, detail: String(e && e.message) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 20000 });
const trig = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
if (trig) trig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 20000 });

window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'taobao' } }));
const appUp = await waitFor(() => document.querySelector('.tbo-app'), { timeoutMs: 20000 });
report({ name: 'taobao-open', ok: appUp, detail: appUp ? '.tbo-app 到场' : '未开屏' });

const box = (el) => {
  const r = el.getBoundingClientRect();
  return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) };
};

/* ── ① 底栏几何 ─────────────────────────────────────────── */
const bar = document.querySelector('.tbo-tabbar');
const app = document.querySelector('.tbo-app');
if (bar && app) {
  report({
    name: 'tabbar-pinned',
    ok: Math.abs(box(bar).b - box(app).b) <= 1,
    detail: `barBottom=${box(bar).b} appBottom=${box(app).b} delta=${box(bar).b - box(app).b}`,
  });
  /* 布局尺寸而非视觉尺寸：手机外壳对整屏做了 scale，rect 是缩放后的值，
   *   拿它判「有没有 44px 可点高度」会得到假红（微博那轮已踩过同一个坑）。 */
  report({
    name: 'tabbar-touch-height',
    ok: bar.offsetHeight >= 44,
    detail: `offsetH=${bar.offsetHeight} rectH=${box(bar).h}`,
  });
} else {
  report({ name: 'tabbar-exists', ok: false, detail: bar ? '.tbo-app 缺失' : '.tbo-tabbar 不存在' });
}

/* ── ② 五格顺序 / 文案 / 禁用态 ─────────────────────────── */
const EXPECT = ['首页', '逛逛', '消息', '购物车', '我的'];
if (bar) {
  const items = [...bar.querySelectorAll('.tbo-tab')];
  const labels = items.map((i) => (i.textContent || '').trim());
  report({ name: 'tabbar-five', ok: items.length === 5, detail: `count=${items.length} ${JSON.stringify(labels)}` });
  report({
    name: 'tabbar-order-official',
    ok: JSON.stringify(labels) === JSON.stringify(EXPECT),
    detail: `got=${JSON.stringify(labels)} want=${JSON.stringify(EXPECT)}`,
  });
  const dis = items.filter((i) => i.classList.contains('is-disabled'));
  const disLabels = dis.map((i) => (i.textContent || '').trim());
  const disOp = dis.map((i) => Number(getComputedStyle(i).opacity));
  const disAria = dis.every((i) => i.getAttribute('aria-disabled') === 'true');
  report({
    name: 'tabbar-disabled-two',
    ok: dis.length === 2 && disAria && disOp.every((o) => o > 0.2 && o < 0.6),
    detail: `disabled=${JSON.stringify(disLabels)} aria=${disAria} opacity=${JSON.stringify(disOp)}`,
  });
  /* 订单**不能**在底栏（官方没有这一格） */
  report({
    name: 'no-orders-in-tabbar',
    ok: !labels.includes('订单'),
    detail: labels.includes('订单') ? '底栏仍有「订单」—— 官方这一格不存在' : '底栏无「订单」格',
  });
  /* 禁用格点了要有真话（走自绘 toast，不弹宿主 alert） */
  const soon = dis[0];
  if (soon) {
    soon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    const toast = document.querySelector('.tbo-toast');
    report({
      name: 'disabled-gives-real-answer',
      ok: !!(toast && (toast.textContent || '').includes('未实现')),
      detail: toast ? (toast.textContent || '').trim() : '点了没反应（静默）—— 会被当成按钮坏了',
    });
  }
}

/* ── ③ 订单：从底栏摘掉后必须仍然走得到 ─────────────────── */
const clickBy = (sel, label) => {
  const el = [...document.querySelectorAll(sel)].find((i) => (i.textContent || '').trim().includes(label));
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
};
if (bar) {
  const toMine = clickBy('.tbo-tab', '我的');
  await new Promise((r) => setTimeout(r, 400));
  const view = window.VirtualPhone?.taobaoApp?.view || window.VirtualPhone?.taobaoApp?.taobaoView;
  report({ name: 'goto-mine', ok: toMine && !!document.querySelector('.tbo-page-mine'), detail: 'mine 页=' + !!document.querySelector('.tbo-page-mine') });

  const ordersBtn = [...document.querySelectorAll('[data-act="tab"][data-tab="orders"]')]
    .find((b) => (b.textContent || '').includes('全部订单'));
  report({
    name: 'orders-entry-in-mine',
    ok: !!ordersBtn,
    detail: ordersBtn ? '「我的」里有全部订单入口' : '找不到入口 —— 只摘不迁，订单页变成孤儿',
  });
  if (ordersBtn) {
    ordersBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    report({
      name: 'orders-page-reachable',
      ok: !!document.querySelector('.tbo-otabs'),
      detail: document.querySelector('.tbo-otabs') ? '订单页 + 状态页签在场' : '订单页没打开',
    });
    /* 状态页签照旧可切。注意实现用的是 **aria-selected**（页签语义），不是
     *   aria-pressed（开关语义）、也没有 is-on 类 —— 判据读错属性会得到「切换明明
     *   生效却 active=[]」的假红（本条第一版就踩了：写的是 aria-pressed/is-on）。 */
    const placed = [...document.querySelectorAll('.tbo-otab')].find((b) => (b.textContent || '').includes('待付款'));
    if (placed) {
      placed.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      const active = [...document.querySelectorAll('.tbo-otab')]
        .filter((b) => b.getAttribute('aria-selected') === 'true');
      report({
        name: 'order-tabs-still-work',
        ok: active.length === 1 && (active[0].textContent || '').includes('待付款'),
        detail: 'active=' + JSON.stringify(active.map((b) => (b.textContent || '').trim())),
      });
    }
    if (view) {
      report({ name: 'view-page-is-orders', ok: view.page === 'orders', detail: 'page=' + view.page });
    }
  }
}

done();