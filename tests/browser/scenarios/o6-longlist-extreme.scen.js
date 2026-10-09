/* ============================================================
 * tests/browser/scenarios/o6-longlist-extreme.scen.js — R-O6 极端数据档
 * ------------------------------------------------------------
 * 为什么与 o6-longlist-perf 分开一个文件（而不是把行数写成参数）：
 *   一个场景文件 = 一份**可复算的夹具**。把行数做成参数会让「读数」与「跑的是哪一档」
 *   脱钩 —— 而本仓的判据纪律是「输入面与结论面必须是同一件事」。
 *   故典型档（1500 楼）与极端档（4000 楼）各持一个文件，两边夹具逐字可读。
 *
 * 口径（与典型档同源，不另立一套）：
 *   · 规模读数 = 条数 + **每条平均 DOM 节点数**（总节点数只反映夹具有多长）；
 *   · 媒体读数 = loading=lazy / decoding=async 的**属性契约**；收益只登记不断言；
 *   · 复开读数 = 产品自己的 runtimeStats() 资源账本（不用节点数冒充）；
 *   · 恢复读数 = DOM 现场是否保留（选择态 / 滚动 / 焦点三者的前提）；
 *   · **本读数不是帧率**：单帧 dump 模式下拿到的是「渲染完成时刻」。
 * 夹具是**注入的存储键**，不是用户真实历史；它证明这条渲染路径在极端规模下的规模
 * 与资源行为，**不证明**目标设备上的流畅度（目标设备读数归实机，本层不冒充）。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

const LINES = 4000;
const IMG_STEP = 5;
const IMG_N = 800;
const IMG_URL = '/apps/calendar/assets/1.png';
const NS = 'st_virtual_phone';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const msgs = [];
for (let i = 0; i < LINES; i++) {
  const isImg = i % IMG_STEP === 0 && (i / IMG_STEP) < IMG_N;
  const common = { id: 'm' + i, timestamp: 1758000000000 + i * 60000, time: '12:0' + (i % 10), isMe: i % 2 === 0 };
  msgs.push(isImg
    ? Object.assign(common, { content: IMG_URL + '?n=' + (i / IMG_STEP), type: 'image' })
    : Object.assign(common, { content: '第 ' + i + ' 楼正文 内容片段 ' + (i % 7), type: 'text' }));
}
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({
  chats: [{ id: 'c1', name: '极端长会话', type: 'single', timestamp: 1758000000000 + LINES * 60000 }],
  contacts: [], settings: {}, messages: {},
});
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);

function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
const nodes = () => document.getElementsByTagName('*').length;
const marks = {};
const mark = (n) => { marks[n] = performance.now(); };
function stats() { try { return window.VirtualPhone.runtimeStats(); } catch (_e) { return null; } }
function ledger(s) {
  if (!s || typeof s !== 'object') return null;
  const sum = (o) => { let n = 0; const r = (o && typeof o === 'object') ? o : {}; for (const k in r) n += Number(r[k] || 0); return n; };
  const dup = (s.duplicates && typeof s.duplicates === 'object') ? Object.keys(s.duplicates).length : -1;
  return { live: Number(s.total || 0), released: sum(s.released), premature: sum(s.releasedPremature), dupDomains: dup };
}

mark('t0');
try { await import('/index.js'); } catch (_e) { /* 由读数判定 */ }
const up = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 30000 });
let panelUp = false;
for (let i = 0; i < 3 && !panelUp; i++) {
  const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (t) realClick(t);
  panelUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 15000 });
}
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 15000 });
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
mark('t1');
report({ name: 'o6x-shell-ready', ok: !!(up && panelUp), detail: 'entry=' + String(window.VirtualPhone && window.VirtualPhone.version) + ' panel=' + panelUp + ' fixture=injected-storage-keys lines=' + LINES + ' imgs=' + IMG_N });
if (!panelUp) { done(); }

async function openWechat() {
  const dots = Array.from(document.querySelectorAll('.home-page-dot'));
  for (const d of dots) {
    realClick(d);
    await window.__sleep(250);
    const ic = Array.from(document.querySelectorAll('.app-icon')).find((el) => {
      const t = el.querySelector('.app-name');
      return t && t.textContent.trim() === '微信';
    });
    if (ic) { realClick(ic); return await waitFor(() => document.querySelector('.wechat-app'), { timeoutMs: 20000 }); }
  }
  return false;
}
async function openLongChat() {
  const row = document.querySelector('.wechat-app .chat-item');
  if (!row) return false;
  realClick(row);
  return await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 20000 });
}
let wechatUp = false, roomUp = false;
try { wechatUp = await openWechat(); } catch (_e) { wechatUp = false; }
try { roomUp = wechatUp ? await openLongChat() : false; } catch (_e) { roomUp = false; }
await window.__sleep(1000);
mark('t2');
report({ name: 'o6x-extreme-open', ok: !!(wechatUp && roomUp), detail: 'wechat=' + wechatUp + ' room=' + roomUp + ' entryLap=' + Math.round(marks.t1 - marks.t0) + 'ms roomLap(fromEntry)=' + Math.round(marks.t2 - marks.t1) + 'ms（同一次运行的相对量级，不设阈值）' });
if (!roomUp) { done(); }

const msgEls = Array.from(document.querySelectorAll('.chat-message'));
const allNodes = nodes();
const perMsg = msgEls.length ? Math.round((allNodes / msgEls.length) * 100) / 100 : 0;
report({
  name: 'o6x-extreme-scale',
  ok: msgEls.length === LINES && perMsg >= 6 && perMsg <= 14,
  detail: 'chatMessages=' + msgEls.length + '/' + LINES + ' allNodes=' + allNodes + ' nodesPerMessage=' + perMsg
    + ' dividers=' + document.querySelectorAll('.message-time-divider').length
    + '（每条 6~14 为真实现代价区间；该区间**不随夹具长度漂移**正是同步长档要证明的事）',
});
function mediaState() {
  const list = Array.from(document.querySelectorAll('.message-image'));
  let decoded = 0, lazy = 0, asyncAttr = 0;
  list.forEach((n) => {
    try { if (n.naturalWidth > 0) decoded += 1; } catch (_e) { /* 忽略 */ }
    if (n.getAttribute('loading') === 'lazy') lazy += 1;
    if (String(n.getAttribute('decoding') || '') === 'async') asyncAttr += 1;
  });
  return { total: list.length, decoded: decoded, lazy: lazy, asyncAttr: asyncAttr };
}
const m = mediaState();
report({
  name: 'o6x-extreme-media-contract',
  ok: m.total > 0 && m.lazy === m.total && m.asyncAttr === m.total,
  detail: 'media=' + JSON.stringify(m) + ' 口径=属性契约；收益面如实登记（decoded 由容器几何决定，不设阈值）',
});

const before = { nodes: allNodes, msgs: msgEls.length, ledger: ledger(stats()) };
for (let i = 0; i < 10; i++) {
  window.dispatchEvent(new CustomEvent('phone:goHome', { detail: {} }));
  await window.__sleep(120);
  await openWechat();
  await window.__sleep(120);
  await openLongChat();
  await window.__sleep(80);
}
const after = {
  nodes: nodes(),
  msgs: document.querySelectorAll('.chat-message').length,
  panels: document.querySelectorAll('.phone-in-panel').length,
  screens: document.querySelectorAll('.phone-screen').length,
  ledger: ledger(stats()),
};
const dLive = (after.ledger && before.ledger) ? after.ledger.live - before.ledger.live : NaN;
report({
  name: 'o6x-extreme-reopen-10-ledger-stable',
  ok: !!after.ledger && !!before.ledger && dLive <= 0 && after.ledger.dupDomains === 0
    && after.panels === 1 && after.screens === 1 && after.msgs === before.msgs,
  detail: 'ledgerBefore=' + JSON.stringify(before.ledger) + ' ledgerAfter=' + JSON.stringify(after.ledger)
    + ' dLive=' + dLive + ' panels=' + after.panels + ' screens=' + after.screens
    + ' msgs=' + after.msgs + '/' + before.msgs + ' nodeDelta=' + (after.nodes - before.nodes)
    + ' 契约=**不得增长**（不是必须相等）：正常清理会让 dLive 为负，把「减少」判红就是把清理当缺陷报',
});

let _prevH = -1, _stable = 0;
for (let i = 0; i < 30; i++) {
  const b = document.getElementById('chat-messages');
  const h = b ? b.scrollHeight : -1;
  if (h === _prevH) { _stable += 1; if (_stable >= 6) break; } else { _stable = 0; }
  _prevH = h;
  await window.__sleep(150);
}
function liveBox() { return document.getElementById('chat-messages'); }
document.getElementById('chat-messages').setAttribute('data-o6x-mark', 'kept');
const firstMsg = document.querySelectorAll('.chat-message')[0];
if (firstMsg) firstMsg.setAttribute('data-o6x-identity', 'kept');
const input = document.querySelector('.chat-input-bar input, #chat-input, .chat-input-bar textarea');
let focusOk = null;
try { if (input && input.focus) { input.focus(); focusOk = document.activeElement === input; } } catch (_e) { focusOk = null; }
const box = liveBox();
if (box) box.scrollTop = Math.floor(box.scrollHeight * 0.5);
await window.__sleep(400);
const scrollBefore = box ? box.scrollTop : -1;
const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
for (let i = 0; i < 3; i++) {
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); } catch (_e) { /* 忽略 */ }
  document.dispatchEvent(new Event('visibilitychange'));
  await window.__sleep(150);
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); } catch (_e) { /* 忽略 */ }
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: true } }));
  await window.__sleep(150);
}
if (hiddenDesc) { try { Object.defineProperty(document, 'hidden', hiddenDesc); } catch (_e) { /* 忽略 */ } }
const box2 = liveBox();
const scrollAfter = box2 ? box2.scrollTop : -2;
const markKept = !!(box2 && box2.getAttribute('data-o6x-mark') === 'kept');
const identityKept = !!document.querySelector('.chat-message[data-o6x-identity="kept"]');
const focusAfter = (() => { try { return input ? document.activeElement === input : null; } catch (_e) { return null; } })();
report({
  name: 'o6x-extreme-restore-keeps-live-dom',
  ok: markKept && identityKept && scrollAfter === scrollBefore && (focusOk === null || focusAfter === true),
  detail: 'markKept=' + markKept + ' identityKept=' + identityKept + ' scroll=' + scrollBefore + '→' + scrollAfter
    + ' focus=' + focusOk + '→' + focusAfter + ' msgs=' + document.querySelectorAll('.chat-message').length,
});
mark('t3');
report({
  name: 'o6x-not-a-frame-time',
  ok: true,
  detail: 'lap(entry→settled)=' + Math.round(marks.t3 - marks.t2) + 'ms api=performance.now 模式=单帧 dump（读数=渲染完成时刻，**不是**帧率、也**不是**Node 拼串耗时；目标设备读数未取得，本项不设阈值）',
});
done();
