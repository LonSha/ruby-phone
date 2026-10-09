/* _diag19 — 恢复面归因：滚动位置漂移是「真被重建」还是「异步回填」？ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const LINES = 800;
const NS = 'st_virtual_phone';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const msgs = [];
for (let i = 0; i < LINES; i++) msgs.push({ id: 'm' + i, content: '第 ' + i + ' 楼正文', type: 'text', timestamp: 1758000000000 + i * 60000, time: '12:0' + (i % 10), isMe: i % 2 === 0 });
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({ chats: [{ id: 'c1', name: 'c', type: 'single', timestamp: 1 }], contacts: [], settings: {}, messages: {} });
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);
function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
await import('/index.js');
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
let up = false;
for (let i = 0; i < 3 && !up; i++) { const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon'); if (t) realClick(t); up = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 }); }
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modal = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modal) { const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if (b) realClick(b); await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 }); }
async function openWechat() { const dots = Array.from(document.querySelectorAll('.home-page-dot')); for (const d of dots) { realClick(d); await window.__sleep(250); const ic = Array.from(document.querySelectorAll('.app-icon')).find((el) => { const t = el.querySelector('.app-name'); return t && t.textContent.trim() === '微信'; }); if (ic) { realClick(ic); return await waitFor(() => document.querySelector('.wechat-app'), { timeoutMs: 15000 }); } } return false; }
await openWechat(); await window.__sleep(300);
realClick(document.querySelector('.wechat-app .chat-item'));
await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 12000 });
/* 等异步沈默：连续 6 次采样 scrollHeight 稳定即视为静默 */
let prev = -1, stable = 0;
for (let i = 0; i < 30; i++) { const b = document.getElementById('chat-messages'); const h = b.scrollHeight; if (h === prev) { stable++; if (stable >= 6) break; } else { stable = 0; } prev = h; await window.__sleep(150); }
const box = document.getElementById('chat-messages');
box.setAttribute('data-probe-mark', 'x');
const first = document.querySelectorAll('.chat-message')[0];
first.setAttribute('data-o6-identity', 'kept');
box.scrollTop = Math.floor(box.scrollHeight * 0.45);
await window.__sleep(300);
const s0 = box.scrollTop;
report({ name: 'settled', ok: true, detail: 'scrollHeight=' + box.scrollHeight + ' scrollTop=' + s0 + ' firstNoLongerStale=' + !!document.querySelector('.chat-message[data-o6-identity="kept"]') });
const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
for (let i = 0; i < 5; i++) {
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: false } }));
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); } catch (e) { }
  document.dispatchEvent(new Event('visibilitychange'));
  await window.__sleep(150);
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); } catch (e) { }
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new CustomEvent('phone:panelVisibility', { detail: { open: true } }));
  await window.__sleep(150);
}
if (hiddenDesc) { try { Object.defineProperty(document, 'hidden', hiddenDesc); } catch (e) { } }
const box2 = document.getElementById('chat-messages');
report({ name: 'after-toggles', ok: true, detail: 'sameElement=' + (box2 === box) + ' hasMark=' + !!(box2 && box2.getAttribute('data-probe-mark')) + ' identityKept=' + !!document.querySelector('.chat-message[data-o6-identity="kept"]') + ' scroll=' + s0 + '→' + (box2 ? box2.scrollTop : -1) + ' msgs=' + document.querySelectorAll('.chat-message').length });
/* 再等 3 秒看是否有更晚的异步回填把位置顶走 */
await window.__sleep(3000);
const box3 = document.getElementById('chat-messages');
report({ name: 'after-wait3s', ok: true, detail: 'sameElement=' + (box3 === box) + ' scroll=' + (box3 ? box3.scrollTop : -1) + ' scrollHeight=' + (box3 ? box3.scrollHeight : -1) });
done();
