/* _diag16 — R-O6 取证探针：长会话（1500 楼）+ 复开 20 次 + 可见性切换
 * 目的：把「反复复开资源不增长」从 DOM 节点数升级为**资源账本**读数
 *   （index.js 已有 window.VirtualPhone.runtimeStats()，浏览器层从未消费它）。
 * 本文件是取证用的一次性探针（下划线前缀 ⇒ 不进 gate 扫描面）。 */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const LINES = 1500;
const chat = Array.from({ length: 40 }, (_, i) => ({ mes: '宿主楼层 ' + i, is_user: i % 2 === 0, swipes: ['x'], swipe_id: 0 }));
const host = installBrowserHost({ chat });
const NS = 'st_virtual_phone';
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const msgs = [];
for (let i = 0; i < LINES; i++) {
  msgs.push({ id: 'm' + i, content: '第 ' + i + ' 楼正文 内容片段 ' + (i % 7), timestamp: 1758000000000 + i * 60000, time: '12:0' + (i % 10), isMe: i % 2 === 0, type: 'text' });
}
const chats = [{ id: 'c1', name: '压测会话', type: 'single', timestamp: 1758000000000 + LINES * 60000 }];
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({ chats: chats, contacts: [], settings: {}, messages: {} });
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);
function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
function nodes() { return document.getElementsByTagName('*').length; }
function stats() { try { return window.VirtualPhone.runtimeStats(); } catch (e) { return { err: String(e && e.message) }; } }
function sumReleases(s) { let n = 0; const r = (s && s.released) || {}; for (const k in r) n += Number(r[k] || 0); return n; }
function domCounts() {
  return { nodes: nodes(), chatMsgs: document.querySelectorAll('.chat-message').length, dividers: document.querySelectorAll('.message-time-divider').length };
}
await import('/index.js');
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
report({ name: 'entry', ok: !!(window.VirtualPhone && window.VirtualPhone.version), detail: String(window.VirtualPhone.version || '') });
let up = false;
for (let i = 0; i < 3 && !up; i++) { const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon'); if (t) realClick(t); up = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 }); }
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modal = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modal) { const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if (b) realClick(b); await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 }); }
report({ name: 'shell', ok: up, detail: 'nodes=' + nodes() });
/* --- 打开微信会话（1500 楼） --- */
function findIcon(name) {
  const els = Array.from(document.querySelectorAll('.app-icon'));
  return els.find((el) => { const t = el.querySelector('.app-name'); return t && t.textContent.trim() === name; }) || null;
}
async function openWechat() {
  const dots = Array.from(document.querySelectorAll('.home-page-dot'));
  for (const d of dots) {
    realClick(d); await window.__sleep(250);
    const ic = findIcon('微信');
    if (ic) { realClick(ic); return await waitFor(() => document.querySelector('.wechat-app'), { timeoutMs: 15000 }); }
  }
  return false;
}
const tOpen0 = performance.now();
const wechatUp = await openWechat();
const tOpen1 = performance.now();
report({ name: 'wechat-open', ok: wechatUp, detail: 'lap=' + Math.round(tOpen1 - tOpen0) + 'ms nodes=' + nodes() });
await window.__sleep(400);
/* 点第一个会话行 */
let roomUp = false;
const rowCandidates = Array.from(document.querySelectorAll('.wechat-app [data-chat-id], .wechat-app .chat-item, .wechat-app .conversation-item'));
report({ name: 'chat-rows', ok: rowCandidates.length > 0, detail: 'rows=' + rowCandidates.length + ' classes=' + rowCandidates.slice(0, 3).map((e) => e.className).join('|') });
for (const el of rowCandidates) { realClick(el); roomUp = await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 12000 }); if (roomUp) break; }
const d0 = domCounts();
const s0 = stats();
report({ name: 'room-open', ok: roomUp, detail: JSON.stringify(d0) });
report({ name: 'ledger-before', ok: true, detail: 'total=' + (s0.total || 0) + ' rel=' + sumReleases(s0) + ' dup=' + JSON.stringify(s0.duplicates || {}) + ' byKind=' + JSON.stringify(s0.byKind || {}) });
/* --- 复开 20 次（回到桌面再进微信会话） --- */
const entry = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
for (let i = 0; i < 20; i++) {
  window.dispatchEvent(new CustomEvent('phone:goHome', { detail: {} }));
  await window.__sleep(120);
  await openWechat();
  await window.__sleep(120);
  const rows = Array.from(document.querySelectorAll('.wechat-app [data-chat-id], .wechat-app .chat-item, .wechat-app .conversation-item'));
  if (rows[0]) realClick(rows[0]);
  await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 8000 });
  await window.__sleep(80);
}
const d1 = domCounts();
const s1 = stats();
report({ name: 'reopen-20', ok: true, detail: JSON.stringify({ before: d0, after: d1, nodeDelta: d1.nodes - d0.nodes, msgDelta: d1.chatMsgs - d0.chatMsgs }) });
report({ name: 'ledger-after', ok: true, detail: 'total=' + (s1.total || 0) + ' rel=' + sumReleases(s1) + ' dup=' + JSON.stringify(s1.duplicates || {}) + ' byKind=' + JSON.stringify(s1.byKind || {}) + ' verdictOk=' + String(s1.releaseVerdict && s1.releaseVerdict.ok) });
/* --- 可见性切换 5 次（面板关闭 + doc hidden）后恢复，看是否全量重算 --- */
const box = document.getElementById('chat-messages');
if (box) box.scrollTop = Math.floor(box.scrollHeight / 2);
const midTop = box ? box.scrollTop : -1;
for (let i = 0; i < 5; i++) {
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await window.__sleep(120);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: true } }));
  await window.__sleep(120);
}
const d2 = domCounts();
const s2 = stats();
const afterTop = box ? box.scrollTop : -1;
report({ name: 'visibility-restore', ok: true, detail: JSON.stringify({ scrollBefore: midTop, scrollAfter: afterTop, nodes: d2.nodes, msgs: d2.chatMsgs, total: s2.total, rel: sumReleases(s2) }) });
/* --- 长列表渲染读数（口径：渲染完成时刻，不声称帧率） --- */
report({ name: 'dom-scale', ok: true, detail: 'chatMessages=' + d2.chatMsgs + ' allNodes=' + d2.nodes + ' msgPerNode=' + (d2.chatMsgs ? Math.round(d2.nodes / d2.chatMsgs * 100) / 100 : 0) });
done();
