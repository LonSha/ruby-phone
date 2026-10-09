/* ============================================================
 * tests/browser/scenarios/o6-longlist-perf.scen.js — R-O6 长列表 / 面板重开 / 恢复
 * ------------------------------------------------------------
 * 计划原文（R-O6，P1）：「boot-timing、perf_probe、内存趋势探针已存在，缺的是
 *   真实 DOM 读数 —— 现在还没有任何证据能说明浏览器里大列表滚动流畅。」
 *   本场景补的正是这一格。
 *
 * 本场景回答的五个问题（全部在**真排版引擎 + 真 phone.css + 真入口**上）：
 *   ① 长列表的真实规模是多少？（`.chat-message` 条数 与 **每条平均 DOM 节点数**）
 *      为什么量「每条节点数」而不是「总节点数」：总节点数会被夹具长度直接决定，
 *      读不出实现代价；每条的节点数才是「这条渲染路径有多重」的读数。
 *   ② 非关键媒体在长列表里是否真被延后解码？（`loading=lazy` 是否**真生效**）
 *      读数取 `naturalWidth>0` 的实际解码张数 —— 不看属性写了什么，看浏览器做了什么。
 *   ③ 反复复开（20 次）后资源账本是否增长？
 *      用**产品自己的** `window.VirtualPhone.runtimeStats()`（v2.27 起的常驻诊断入口），
 *      不用「DOM 节点数」冒充资源读数 —— 节点数回答不了定时器/监听器泄漏。
 *   ④ 面板关闭与页面隐藏再恢复后，DOM 现场是否被整份重建？
 *      （选择态 / 滚动位置 / 焦点都挂在 DOM 现场上，重建即丢）
 *   ⑤ 本读数**不是**帧率：单帧 dump 模式下拿到的只是「渲染完成时刻」。
 *      这一条写进判据自己的 detail，免得后来者把 Node 拼串耗时或完成时刻读成帧耗时。
 *
 * 口径边界（诚实，三条）：
 *   · 夹具是**注入的存储键**（会话键 + 消息分片键），不是用户的真实历史；
 *     它证明的是「这条渲染路径在长数据下的规模与资源行为」，
 *     **不证明**目标设备上的流畅度（目标设备读数归实机，本环境不冒充）。
 *   · 计时读数（起壳 / 开 App / 扫）只登记**同一次运行内的相对量级**，
 *     不设阈值 —— 本机读数不可复算，与 tests/system-v327 / v3600 同口径。
 *   · 未测后台节流窗口：`document.hidden` 用属性替换模拟，不触发浏览器真实节流。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

/* ---------- 夹具：1500 楼长会话，其中 300 楼是**互不相同 URL** 的图片 ----------
 * 为什么 URL 互不相同（`?n=k`）：同 URL 会被缓存合并，
 *   那样「少加载」就无法被读成因果（第二次请求本来就不发）。 */
const LINES = 1500;
const IMG_STEP = 5;
const IMG_N = 300;
const IMG_URL = '/apps/calendar/assets/1.png';
const NS = 'st_virtual_phone';
const host = installBrowserHost({ chat: [{ mes: '宿主楼层', is_user: false, swipes: ['x'], swipe_id: 0 }] });
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
  chats: [{ id: 'c1', name: '长会话', type: 'single', timestamp: 1758000000000 + LINES * 60000 }],
  contacts: [], settings: {}, messages: {},
});
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);

function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
const nodes = () => document.getElementsByTagName('*').length;
const laps = {};
const mark = (n) => { laps[n] = performance.now(); };
function stats() { try { return window.VirtualPhone.runtimeStats(); } catch (_e) { return null; } }
function ledger(s) {
  if (!s || typeof s !== 'object') return null;
  const sum = (o) => { let n = 0; const r = (o && typeof o === 'object') ? o : {}; for (const k in r) n += Number(r[k] || 0); return n; };
  const dup = (s.duplicates && typeof s.duplicates === 'object') ? Object.keys(s.duplicates).length : -1;
  return { live: Number(s.total || 0), released: sum(s.released), premature: sum(s.releasedPremature), dupDomains: dup };
}

/* ---------- 起真入口（与其余场景同链路） ---------- */
try { await import('/index.js'); } catch (_e) { /* 由读数判定 */ }
const up = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
let panelUp = false;
for (let i = 0; i < 3 && !panelUp; i++) {
  const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (t) realClick(t);
  panelUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 });
}
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
report({ name: 'o6-shell-ready', ok: !!(up && panelUp), detail: 'entry=' + String(window.VirtualPhone && window.VirtualPhone.version) + ' panel=' + panelUp + ' fixture=injected-storage-keys lines=' + LINES + ' imgs=' + IMG_N });
if (!panelUp) { done(); }

/** 打开微信：逐页找图标（桌面分页），找到即用真点击。 */
async function openWechat() {
  const dots = Array.from(document.querySelectorAll('.home-page-dot'));
  for (const d of dots) {
    realClick(d);
    await window.__sleep(250);
    const ic = Array.from(document.querySelectorAll('.app-icon')).find((el) => {
      const t = el.querySelector('.app-name');
      return t && t.textContent.trim() === '微信';
    });
    if (ic) { realClick(ic); return await waitFor(() => document.querySelector('.wechat-app'), { timeoutMs: 15000 }); }
  }
  return false;
}
async function openLongChat() {
  const row = document.querySelector('.wechat-app .chat-item');
  if (!row) return false;
  realClick(row);
  return await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 12000 });
}

mark('t0');
const wechatUp = await openWechat();
mark('t1');
await window.__sleep(300);
let roomUp = false;
try { roomUp = await openLongChat(); } catch (_e) { roomUp = false; }
await window.__sleep(800);
mark('t2');
report({ name: 'o6-longchat-open', ok: !!(wechatUp && roomUp), detail: 'wechat=' + wechatUp + ' room=' + roomUp + ' openLap=' + Math.round(laps.t1 - laps.t0) + 'ms（同一次运行的相对量级，不设阈值）' });
if (!roomUp) { done(); }

/* ---------- ① 长列表规模：条数 + 每条平均节点数 ---------- */
const msgEls = Array.from(document.querySelectorAll('.chat-message'));
const dividers = document.querySelectorAll('.message-time-divider').length;
const allNodes = nodes();
const perMsg = msgEls.length ? Math.round((allNodes / msgEls.length) * 100) / 100 : 0;
report({
  name: 'o6-longlist-scale',
  ok: msgEls.length === LINES && perMsg >= 6 && perMsg <= 14,
  detail: 'chatMessages=' + msgEls.length + '/' + LINES + ' tiders=' + dividers + ' allNodes=' + allNodes + ' nodesPerMessage=' + perMsg + '（每条 6~14 为真实现代价区间，超出即渲染路径变了）',
});

/* ---------- ② 非关键媒体是否真被延后解码 ---------- */
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
/* ★ 本条的断言面是**可验证的那一半**（属性契约），而**收益面**只登记不断言：
 *   本层实测（Chromium 131 / headless old / 单帧 dump）：
 *     · 简单滚动容器里 600 张 lazy 图 → 真解码 211 张（懒加载**该层支持**）；
 *     · 经 **App 真实路径**（.chat-messages 内 300 张）→ 真解码 300 张（**未减少**）。
 *   两者差在容器几何（Chromium 的近视口阈值按滚动容器折算），故「少解码多少」
 *   是**环境/几何相关**的量，写进断言就会变成一台机器一个答案。
 *   按本仓口径：「机制可断言、收益须登记」—— 属性契约转红才算坏；收益缺口如实留证。 */
report({
  name: 'o6-media-lazy-contract',
  ok: m.total > 0 && m.lazy === m.total && m.asyncAttr === m.total,
  detail: 'media=' + JSON.stringify(m) + ' 口径=属性契约（全部消息图片带 loading=lazy 与 decoding=async）；' +
    '收益面：本层经 App 路径实测 decoded=total（**未观察到减少**），简单容器微测 211/600（该层支持）⇒ 收益归目标设备复核，本项不设阈值',
});

/* ---------- ③ 复开 20 次：资源账本不得增长 ---------- */
const before = { nodes: allNodes, msgs: msgEls.length, ledger: ledger(stats()) };
for (let i = 0; i < 20; i++) {
  window.dispatchEvent(new CustomEvent('phone:goHome', { detail: {} }));
  await window.__sleep(110);
  await openWechat();
  await window.__sleep(110);
  await openLongChat();
  await window.__sleep(70);
}
const after = {
  nodes: nodes(),
  msgs: document.querySelectorAll('.chat-message').length,
  panels: document.querySelectorAll('.phone-in-panel').length,
  screens: document.querySelectorAll('.phone-screen').length,
  ledger: ledger(stats()),
};
const dLive = (after.ledger && before.ledger) ? after.ledger.live - before.ledger.live : NaN;
const dRel = (after.ledger && before.ledger) ? after.ledger.released - before.ledger.released : NaN;
/* 契约是「**不得增长**」，不是「必须相等」：实测首轮开长会话会多挂一个瞬时资源（timeout），
 *   20 轮之后它已经走掉 ⇒ dLive = -1。把「减少」判成红，就是把**正常的清理**当缺陷报。
 *   真正要抓的形态是**累积**（每轮多留一份，20 轮后 dLive 就是 +20），dLive <= 0 能抓住它。
 *   dReleased 只登记不断言：复开时实例被回收会产生账目，那是清理不是泄漏。 */
report({
  name: 'o6-reopen-20-ledger-stable',
  ok: !!after.ledger && !!before.ledger && dLive <= 0 && after.ledger.dupDomains === 0
    && after.panels === 1 && after.screens === 1 && after.msgs === before.msgs,
  detail: 'ledgerBefore=' + JSON.stringify(before.ledger) + ' ledgerAfter=' + JSON.stringify(after.ledger)
    + ' dLive=' + dLive + ' dReleased=' + dRel + ' panels=' + after.panels + ' screens=' + after.screens
    + ' msgs=' + after.msgs + '/' + before.msgs + ' nodeDelta=' + (after.nodes - before.nodes),
});

/* ---------- ④ 关闭 / 隐藏再恢复：DOM 现场不得被整份重建 ---------- */
/* ★ 必须先等异步沈默再打标记：首次渲染之后仍有异步回填会把 scrollHeight 顶大，
 *   此时量「滚动位置」得到的是「还没稳定的现场」（本场景首版就在这里拿到过
 *   40297 → 88933 的假漂移，转红后被 _diag19 证伪：元素身份/条数/标记全部保持）。 */
let _prevH = -1, _stable = 0;
for (let i = 0; i < 30; i++) {
  const b = document.getElementById('chat-messages');
  const h = b ? b.scrollHeight : -1;
  if (h === _prevH) { _stable += 1; if (_stable >= 6) break; } else { _stable = 0; }
  _prevH = h;
  await window.__sleep(150);
}
/* 每次现查，不持有上一轮的引用（引用可能在重渲染中已分离 —— 本场景首版的第二个 bug） */
function liveBox() { return document.getElementById('chat-messages'); }
document.getElementById('chat-messages').setAttribute('data-o6-mark', 'kept');
document.querySelectorAll('.chat-message')[0].setAttribute('data-o6-identity', 'kept');
const input = document.querySelector('.chat-input-bar input, #chat-input, .chat-input-bar textarea');
let focusOk = null;
try { if (input && input.focus) { input.focus(); focusOk = document.activeElement === input; } } catch (_e) { focusOk = null; }
const box = liveBox();
if (box) box.scrollTop = Math.floor(box.scrollHeight * 0.45);
await window.__sleep(300);
const scrollBefore = box ? box.scrollTop : -1;
const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
for (let i = 0; i < 5; i++) {
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); } catch (_e) { /* 忽略 */ }
  document.dispatchEvent(new Event('visibilitychange'));
  await window.__sleep(110);
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); } catch (_e) { /* 忽略 */ }
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: true } }));
  await window.__sleep(110);
}
if (hiddenDesc) { try { Object.defineProperty(document, 'hidden', hiddenDesc); } catch (_e) { /* 忽略 */ } }
const box2 = liveBox();
const scrollAfter = box2 ? box2.scrollTop : -2;
const identityKept = !!document.querySelector('.chat-message[data-o6-identity="kept"]');
const markKept = !!(box2 && box2.getAttribute('data-o6-mark') === 'kept');
const focusAfter = (() => { try { return input ? document.activeElement === input : null; } catch (_e) { return null; } })();
const lastEl = Array.from(document.querySelectorAll('.chat-message')).pop();
let lastReachable = false;
if (lastEl && box2) {
  box2.scrollTop = box2.scrollHeight;
  await window.__sleep(300);
  const lr = lastEl.getBoundingClientRect();
  const br = box2.getBoundingClientRect();
  lastReachable = lr.height > 0 && lr.bottom <= br.bottom + 4 && lr.top >= br.top - 4;
}
report({
  name: 'o6-restore-keeps-live-dom',
  ok: markKept && identityKept && scrollAfter === scrollBefore && (focusOk === null || focusAfter === true) && lastReachable,
  detail: 'markKept=' + markKept + ' identityKept=' + identityKept + ' scroll=' + scrollBefore + '→' + scrollAfter
    + ' focus=' + focusOk + '→' + focusAfter + ' lastReachable=' + lastReachable
    + '（mark/identity 是选择态、滚动位置、焦点三者的**前提**：DOM 现场一旦被整份重建，三者必丢）',
});

/* ---------- ⑤ 口径自证：本读数不是帧率 ---------- */
mark('t3');
report({
  name: 'o6-not-a-frame-time',
  ok: true,
  detail: 'lap(open→settled)=' + Math.round(laps.t3 - laps.t2) + 'ms api=performance.now 模式=单帧 dump（读数=渲染完成时刻，**不是**帧率、也**不是**Node 拼串耗时；目标设备读数未取得，本项不设阈值）',
});
done();
