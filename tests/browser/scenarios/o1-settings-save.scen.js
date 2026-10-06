/* ============================================================
 * tests/browser/scenarios/o1-settings-save.scen.js — O1 基线场景④：设置保存
 * ------------------------------------------------------------
 * 覆盖 O1 验收口径里的「设置保存」：
 *   打开设置 App → 真改一个设置项 → 返回 → 重开面板 → **值必须还在**。
 *
 * 判据口径（O1 计划原话）：「保存后重开丢失」必须转红。
 * 选 `#phone-context-limit`（上下文楼层限制）作探针 —— 它是纯数字输入：
 *   change 事件 → normalizePhoneContextLimit → storage.set(PHONE_CONTEXT_LIMIT_KEY)。
 *   路径最短、无副面（不动壁纸/不动布局），保存与回读两件事分开验证：
 *     ① 改值 → storage 键真变为新值（保存面）；
 *     ② 重开面板（关再开）→ 输入框 value 仍显示新值（回读面 —— 这是
 *        「保存后重开丢失」的完整证据链，缺一半都算没证）。
 * ============================================================ */

import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

const host = installBrowserHost({
  chat: Array.from({ length: 4 }, (_, i) => ({ mes: '楼层' + i, is_user: i % 2 === 0, swipes: ['x', 'y'], swipe_id: 0 })),
});

function realClick(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
function hitTest(el) {
  if (!el) return { ok: false, why: 'no-element' };
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { ok: false, why: 'zero-box ' + Math.round(r.width) + 'x' + Math.round(r.height) };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const reachable = !!(hit && (hit === el || el.contains(hit)));
  return { ok: reachable, why: reachable ? '命中本体' : ('命中的是 ' + (hit ? (hit.className || hit.id || hit.tagName) : 'null')) };
}

/* ---------- 0. 起壳 + 关公告弹窗（同场景②/③口径） ---------- */
try { await import('/index.js'); } catch (e) { report({ name: 'entry-imported', ok: false, detail: String((e && e.message) || e) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 15000 });
let shellUp = false;
for (let i = 0; i < 3 && !shellUp; i += 1) {
  const trigger = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (trigger) realClick(trigger);
  shellUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 10000 });
}
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 8000 });
report({ name: 'flow-setup', ok: !!shellUp && !!homeUp, detail: 'shell=' + shellUp + ' home=' + homeUp });

const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const btn = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (_e) { /* 退回 DOM 直点 */ } }
  if (btn) realClick(btn);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}

/* ---------- 1. 打开设置 App（走真实图标点击） ---------- */
async function openAppByName(name, viewSel) {
  await window.__sleep(560);   // goHome 重入屏蔽窗口
  const icon = [...document.querySelectorAll('.home-screen .app-icon')].find((el) => {
    const t = el.querySelector('.app-name');
    return t && t.textContent.trim() === name;
  });
  if (!icon) return { ok: false, why: '找不到图标 ' + name };
  realClick(icon);
  const up = await waitFor(() => document.querySelector(viewSel), { timeoutMs: 12000 });
  return { ok: up, why: up ? '已渲染 ' + viewSel : '未渲染 ' + viewSel };
}
const openSettings = await openAppByName('设置', '#yzp-settings-app, .settings-app');
report({ name: 'settings-app-opens', ok: openSettings.ok, detail: openSettings.why });

/* ---------- 2. 设置 App 的视图真有盒子（不是零宽空壳） ---------- */
const setRoot = document.querySelector('#yzp-settings-app') || document.querySelector('.settings-app');
const setBox = setRoot ? setRoot.getBoundingClientRect() : null;
report({ name: 'settings-has-box', ok: !!(setBox && setBox.width > 100 && setBox.height > 100), detail: setBox ? ('w=' + Math.round(setBox.width) + ' h=' + Math.round(setBox.height)) : 'missing' });

/* ---------- 3. 真改设置项：上下文楼层限制 ----------
 * 探针是 input[number]：真改 value + 派真 change 事件 →
 *   normalize → storage.set（PHONE_CONTEXT_LIMIT_KEY）。 */
const limitInput = document.getElementById('phone-context-limit');
report({ name: 'limit-input-present', ok: !!limitInput, detail: limitInput ? ('initial=' + limitInput.value) : 'missing' });
let savedOK = false;
let savedErr = null;
if (limitInput) {
  try {
    limitInput.value = '777';
    limitInput.dispatchEvent(new Event('change', { bubbles: true }));
    await window.__sleep(300);
    /* 保存面：storage 键真的变成新值（读 VirtualPhone.storage ——
     *   与设置 App 保存时写的是同一份真源，不是另建副本）。 */
    const stored = window.VirtualPhone?.storage?.get?.('phone-context-limit');
    savedOK = String(stored) === '777';
    report({ name: 'setting-saved-to-storage', ok: savedOK, detail: 'stored=' + String(stored) + '（期望 777）' });
  } catch (e) { savedErr = String((e && e.message) || e); }
  if (savedErr) report({ name: 'setting-saved-to-storage', ok: false, detail: 'err=' + savedErr });
}

/* ---------- 4. 关面板再开：回读面（保存后重开丢失 = 必红） ----------
 * 入口的真实链路是 mouseup→openOrNotifyPhone（click 被抑制窗口挡住）——
 *   场景照真实用户链路派 mouseup（endPress → suppress click → toggleDrawer）。
 * 「关闭」的判据口径：toggleDrawer 关面板**不销毁** .phone-in-panel DOM
 *   （外壳留在 DOM 里靠 display:none 隐藏），所以「关上了」要看
 *   phone-panel-open class 移除 + computed display:none，不是看 DOM 消失。 */
const drawerEntry = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
const drawerPanel = document.getElementById('phone-panel');
if (drawerEntry && drawerPanel) {
  drawerEntry.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  await window.__sleep(400);
  const closed = !drawerPanel.classList.contains('phone-panel-open') && getComputedStyle(drawerPanel).display === 'none';
  drawerEntry.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  await waitFor(() => drawerPanel.classList.contains('phone-panel-open') && getComputedStyle(drawerPanel).display !== 'none', { timeoutMs: 8000 });
  const reopenedOK = !!document.querySelector('.phone-in-panel') && !!document.querySelector('.home-screen');
  report({ name: 'panel-close-reopen', ok: closed && reopenedOK, detail: 'closed=' + closed + ' reopened=' + reopenedOK });
} else {
  report({ name: 'panel-close-reopen', ok: false, detail: 'drawerEntry/drawerPanel 缺席' });
}

/* ---------- 5. 重开设置：输入框必须仍显示 777（完整回读） ---------- */
const reopenSettings = await openAppByName('设置', '#yzp-settings-app, .settings-app');
report({ name: 'settings-reopens', ok: reopenSettings.ok, detail: reopenSettings.why });
const limitAfter = document.getElementById('phone-context-limit');
const afterVal = limitAfter ? String(limitAfter.value) : 'missing';
report({
  name: 'setting-survives-reopen',
  ok: afterVal === '777',
  detail: 'reopenValue=' + afterVal + '（期望 777 —— 丢失即「保存后重开丢失」真缺陷）',
});

/* ---------- 6. 返回键在场（跨 App 一致性） ---------- */
const back = document.getElementById('phone-back-button');
report({ name: 'back-button-visible-in-settings', ok: !!back && getComputedStyle(back).display !== 'none', detail: back ? 'display=' + getComputedStyle(back).display : 'missing' });

report({ name: 'host-stub-ledger', ok: true, detail: 'blocked=' + host.log.fetchBlocked.length + ' saveChat=' + host.log.saveChatCalls });
done();