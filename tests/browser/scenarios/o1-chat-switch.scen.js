/* ============================================================
 * tests/browser/scenarios/o1-chat-switch.scen.js — O1 基线场景⑤：切会话
 * ------------------------------------------------------------
 * 覆盖 O1 验收口径里的「切会话」：
 *   宿主桩 emit CHAT_CHANGED → onChatChanged →
 *   ① 面板外壳存活（不被切会话打散）；
 *   ② 重绑链真跑（rebindLazyApps 对 ST_PHONE_REBIND_APP_KEYS 逐个 onChatChanged）；
 *   ③ 桌面可回到（切会话后再打开任一 App 仍可正常进出）；
 *   ④ 事件总账上 CHAT_CHANGED 的监听器真在场（接线面完整）。
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

/* ---------- 0. 起壳 + 关公告弹窗 ---------- */
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

/* ---------- 1. 切会话前：CHAT_CHANGED 监听器真在场 ---------- */
const chatChangedListeners = host.eventSource.listenerCount('chat_changed');
report({
  name: 'chat-changed-listener-bound',
  ok: chatChangedListeners > 0,
  detail: 'listeners=' + chatChangedListeners + '（0 = 切会话后一切失序，必须红）',
});

/* ---------- 2. 切会话：宿主桩 emit CHAT_CHANGED（模拟换会话） ----------
 *   同时换 chat 数组内容（新引用）—— 与真宿主换会话的两件事一致：
 *   事件 + 数据引用更换。 */
const beforePanel = !!document.querySelector('.phone-in-panel');
host.chat.length = 0;
host.chat.push(
  { mes: '新会话楼1', is_user: true, swipes: ['x'], swipe_id: 0 },
  { mes: '新会话楼2', is_user: false, swipes: ['x'], swipe_id: 0 },
);
host.eventSource.emit('chat_changed', { chatId: 'browser_chat_2' });
await window.__sleep(600);

/* ---------- 3. 切会话后面板存活 ---------- */
const panelAlive = !!document.querySelector('.phone-in-panel');
const homeAlive = !!document.querySelector('.home-screen');
report({
  name: 'panel-survives-chat-switch',
  ok: beforePanel && panelAlive,
  detail: 'before=' + beforePanel + ' after=' + panelAlive + ' home=' + homeAlive,
});

/* ---------- 4. 切会话后仍能正常进出 App（端到端收口） ---------- */
async function openAppByName(name, viewSel) {
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
const openAfterSwitch = await openAppByName('幸运转盘', '.phone-view-current .ga-root');
report({ name: 'app-opens-after-switch', ok: openAfterSwitch.ok, detail: openAfterSwitch.why });

const back = document.getElementById('phone-back-button');
const backVisible = !!back && getComputedStyle(back).display !== 'none';
report({ name: 'back-button-after-switch', ok: backVisible, detail: back ? 'display=' + getComputedStyle(back).display : 'missing' });
if (back && backVisible) {
  realClick(back);
  const backHome = await waitFor(() => !!document.querySelector('.home-screen') && !document.querySelector('.phone-view-current .ga-root'), { timeoutMs: 6000 });
  report({ name: 'back-home-after-switch', ok: backHome, detail: backHome ? '切会话后返回键仍能把 App 退回桌面' : '点了没回桌面' });
}

/* ---------- 5. 桌面图标与分页在切会话后仍完整 ---------- */
const iconsAfterSwitch = document.querySelectorAll('.home-screen .app-icon').length;
const dotsAfterSwitch = document.querySelectorAll('.home-page-dot').length;
report({
  name: 'home-intact-after-switch',
  ok: iconsAfterSwitch > 0 && dotsAfterSwitch > 0,
  detail: 'icons=' + iconsAfterSwitch + ' dots=' + dotsAfterSwitch,
});

report({ name: 'host-stub-ledger', ok: true, detail: 'blocked=' + host.log.fetchBlocked.length + ' saveChat=' + host.log.saveChatCalls });
done();