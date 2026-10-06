/* ============================================================
 * tests/browser/scenarios/o1-core-flow.scen.js — O1 基线场景②：核心流程
 * ------------------------------------------------------------
 * 覆盖 O1 验收口径里的核心流程（除桌面分页与搜索取消，见场景①/③）：
 *   打开 App、返回、锁屏、重开面板、清当前数据。
 *
 * 与场景① 的关系：① 只证明「外壳起得来」，本场景证明「点得进去、退得出来」。
 * 所有判定都走真盒模型 + 真命中测试 + 真 click 事件，不读任何「声明存在」：
 *   入口被遮挡 / 宽度为零 / 按钮没绑定 —— 这三类都会在这里当场转红。
 *
 * 本场景刻意选 `gacha`（幸运转盘）作首个 App：
 *   它的视图此前**绕过 setContent 直接写 screen.innerHTML**（v3.61.0 修），
 *   是本轮真浏览器抓到的第二个同源缺陷 —— 放在流程里跑，等于给这条修复
 *   留一条端到端回归（点进去 → 返回键仍在 → 能点回来）。
 * ============================================================ */

import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

const host = installBrowserHost({
  chat: Array.from({ length: 4 }, (_, i) => ({ mes: '楼层' + i, is_user: i % 2 === 0, swipes: ['x', 'y'], swipe_id: 0 })),
});

/** 真点击：走 MouseEvent，与用户点一下同一条链路（会触发元素的 onclick / addEventListener）。 */
function realClick(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}

/** 真命中测试：元素中心点上，最顶层那个是不是它（或它的后代）。 */
function hitTest(el) {
  if (!el) return { ok: false, why: 'no-element' };
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { ok: false, why: 'zero-box ' + Math.round(r.width) + 'x' + Math.round(r.height) };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const reachable = !!(hit && (hit === el || el.contains(hit)));
  return { ok: reachable, why: reachable ? '命中本体' : ('命中的是 ' + (hit ? (hit.className || hit.id || hit.tagName) : 'null')) };
}

function boxOf(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), l: Math.round(r.left) };
}

/* ---------- 0. 起壳（同场景①，但不重复其读数） ---------- */
try { await import('/index.js'); } catch (e) { report({ name: 'entry-imported', ok: false, detail: String((e && e.message) || e) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 15000 });
/* 起壳走重试法（对齐场景③）：首次 click 可能恰落在「入口已插入、面板未挂上」
 *   的间隙 —— toggleDrawer 走首次加载分支并 await，这一次 click 就白点了。
 *   真机上用户点第二下即可；场景照做（320px 实测首点白点，第二点成功）。 */
let shellUp = false;
for (let i = 0; i < 3 && !shellUp; i += 1) {
  const trigger = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (trigger) realClick(trigger);
  shellUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 10000 });
}
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 8000 });
report({ name: 'flow-setup', ok: !!shellUp && !!homeUp, detail: 'shell=' + shellUp + ' home=' + homeUp });

/* ---------- 0.5 版本公告弹窗（同场景③ v6）：等它出现、真点关闭、等它消失 ----------
 * 弹窗是异步出现的（await fetchLocalUpdateNotes 后才弹），单次跑的场景里
 *   它几乎必然在起壳后弹出、盖住整个视口 —— 不关掉它，后面每一步的
 *   坐标命中测试都会命中弹窗而不是手机面板（390 基线实测：
 *   back-button hit=st-phone-update-dialog、punch-hole hit=st-phone-update-subtitle）。 */
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const btn = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (_e) { /* 退回 DOM 直点 */ } }
  if (btn) realClick(btn);
  const gone = await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
  report({ name: 'update-modal-dismissed', ok: gone, detail: gone ? '公告弹窗已关闭（含长公告滚动后关闭）' : '点了关闭键弹窗仍在' });
} else {
  report({ name: 'update-modal-dismissed', ok: true, detail: '本版本公告未弹，跳过' });
}

/** 打开任一 App：走真实图标点击（onclick → phone:openApp → index.js 路由 → 动态 import → render）。 */
async function openAppByName(name, viewSel) {
  // goHome 之后 500ms 内有重入屏蔽（_homeReturnGuardUntil），真路径下用户点不了那么快；
  //   这里等过去，否则会把「屏蔽生效」误读成「App 打不开」。
  await window.__sleep(560);
  const icon = [...document.querySelectorAll('.home-screen .app-icon')].find((el) => {
    const t = el.querySelector('.app-name');
    return t && t.textContent.trim() === name;
  });
  if (!icon) return { ok: false, why: '找不到图标 ' + name };
  realClick(icon);
  const up = await waitFor(() => document.querySelector(viewSel), { timeoutMs: 12000 });
  return { ok: up, why: up ? '已渲染 ' + viewSel : '未渲染 ' + viewSel };
}

/* ---------- 1. 打开 App：gacha ---------- */
const openG = await openAppByName('幸运转盘', '.phone-view-current .ga-root');
report({ name: 'open-app-gacha', ok: openG.ok, detail: openG.why });

const gBox = boxOf('.phone-view-current .ga-root');
report({ name: 'app-content-has-box', ok: !!(gBox && gBox.w > 100 && gBox.h > 100), detail: JSON.stringify(gBox) });

/* ---------- 2. 返回键：进 App 后必须**在场、可见、可点** ---------- */
const back = document.getElementById('phone-back-button');
const backVisible = !!back && getComputedStyle(back).display !== 'none';
const backBox = back ? boxOf('#phone-back-button') : null;
const backHit = hitTest(back);
report({
  name: 'back-button-in-app',
  ok: backVisible && !!backBox && backBox.w > 0 && backHit.ok,
  detail: back ? ('display=' + getComputedStyle(back).display + ' box=' + JSON.stringify(backBox) + ' hit=' + backHit.why) : 'missing',
});

/* ---------- 3. 点返回键 → 回桌面（真点击，不是派发 goHome） ---------- */
if (back && backHit.ok) {
  const r = back.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  realClick(top || back);
}
const backHome = await waitFor(() => !!document.querySelector('.home-screen') && !document.querySelector('.phone-view-current .ga-root'), { timeoutMs: 6000 });
report({ name: 'back-button-returns-home', ok: backHome, detail: backHome ? '已回桌面' : '点了没回桌面（按钮没绑定 / 路由断了）' });

const backHiddenNow = (() => {
  const b = document.getElementById('phone-back-button');
  return !!b && getComputedStyle(b).display === 'none';
})();
report({ name: 'back-button-hidden-at-home', ok: backHiddenNow, detail: backHiddenNow ? '桌面态已隐藏' : '桌面态仍在显示' });

/* ---------- 4. 锁屏：点药丸 → 锁屏层出现并覆盖屏幕；再点 → 解锁 ---------- */
const punch = document.querySelector('.phone-punch-hole');
const punchHit = hitTest(punch);
report({ name: 'punch-hole-reachable', ok: punchHit.ok, detail: punchHit.why });
if (punch) realClick(punch);
const lockedHits = await waitFor(() => !!document.querySelector('.phone-lockscreen'), { timeoutMs: 5000 });
report({ name: 'lock-screen-appears', ok: lockedHits, detail: lockedHits ? '.phone-lockscreen 在场' : '未出现' });

const lockBox = boxOf('.phone-lockscreen');
const screenBox = boxOf('.phone-screen');
const lockCovers = !!(lockBox && screenBox && lockBox.w >= screenBox.w - 2 && lockBox.h >= screenBox.h - 2);
report({
  name: 'lock-screen-covers',
  ok: lockCovers,
  detail: 'lock=' + JSON.stringify(lockBox) + ' screen=' + JSON.stringify(screenBox),
});

if (punch) realClick(punch);
const unlocked = await waitFor(() => !document.querySelector('.phone-lockscreen'), { timeoutMs: 5000 });
report({ name: 'lock-screen-toggles-off', ok: unlocked, detail: unlocked ? '已解锁' : '仍在锁屏（toggle 没接上）' });
const stillPanel = !!document.querySelector('.phone-in-panel');
report({ name: 'panel-survives-lock-cycle', ok: stillPanel, detail: stillPanel ? '外壳未被打散' : '解锁后外壳消失' });

/* ---------- 5. 重开面板：关再开，不得出现第二套外壳 ---------- */
const drawerIcon = document.getElementById('phoneDrawerIcon');
const drawerPanel = document.getElementById('phone-panel');
if (drawerIcon && drawerPanel) {
  realClick(drawerIcon);                              // 关
  await window.__sleep(300);
  const closedCount = document.querySelectorAll('.phone-in-panel').length;
  realClick(drawerIcon);                              // 开
  await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 8000 });
  const openCount = document.querySelectorAll('.phone-in-panel').length;
  report({
    name: 'panel-reopen-single-instance',
    ok: openCount === 1,
    detail: '关闭后=' + closedCount + ' 重开后=' + openCount + '（必须恒为 1，>1 即外壳泄漏）',
  });
} else {
  report({ name: 'panel-reopen-single-instance', ok: false, detail: 'drawerIcon/drawerPanel 缺席' });
}

const homeAfterReopen = await waitFor(() => !!document.querySelector('.home-screen'), { timeoutMs: 6000 });
report({ name: 'home-after-reopen', ok: homeAfterReopen, detail: homeAfterReopen ? '重开后回到桌面且渲染完成' : '重开后桌面没渲染（保存态丢失的那一类）' });

/* ---------- 6. 清当前数据：面板存活、回到桌面、不抛无主异常 ---------- */
let clearErr = null;
try {
  window.dispatchEvent(new CustomEvent('phone:clearAllData'));
  await window.__sleep(600);
} catch (e) {
  clearErr = String((e && e.message) || e);
}
const afterClear = await waitFor(() => !!document.querySelector('.home-screen'), { timeoutMs: 8000 });
report({
  name: 'clear-data-survives',
  ok: afterClear && clearErr === null,
  detail: 'err=' + String(clearErr) + ' home=' + afterClear,
});

/* ---------- 7. 宿主桩记账（旁路读数，不判定） ---------- */
report({ name: 'host-stub-ledger', ok: true, detail: 'blocked=' + host.log.fetchBlocked.length + ' saveChat=' + host.log.saveChatCalls });

done();