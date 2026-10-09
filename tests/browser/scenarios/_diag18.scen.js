/* _diag18 — 消息图片加载面 before 基线（改代码前）：300 个**互不相同**的图片 URL
 *   读数口径：解锁源码资源条目数（performance resource entries）+ 已解码张数（naturalWidth>0）。
 *   为什么用互不相同的 URL：同 URL 会被缓存/合并，无法把「少加载」读成因果。 */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const LINES = 1500, IMGS = 300, STEP = 5;
const BASE = '/apps/calendar/assets/1.png';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
const NS = 'st_virtual_phone';
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const msgs = [];
for (let i = 0; i < LINES; i++) {
  const isImg = i % STEP === 0 && (i / STEP) < IMGS;
  msgs.push(isImg
    ? { id: 'm' + i, content: BASE + '?n=' + (i / STEP), type: 'image', timestamp: 1758000000000 + i * 60000, time: '12:0' + (i % 10), isMe: i % 2 === 0 }
    : { id: 'm' + i, content: '第 ' + i + ' 楼正文 内容片段', type: 'text', timestamp: 1758000000000 + i * 60000, time: '12:0' + (i % 10), isMe: i % 2 === 0 });
}
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({ chats: [{ id: 'c1', name: '长会话', type: 'single', timestamp: 1758000000000 + LINES * 60000 }], contacts: [], settings: {}, messages: {} });
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);
function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
await import('/index.js');
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
let up = false;
for (let i = 0; i < 3 && !up; i++) { const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon'); if (t) realClick(t); up = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 }); }
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modal = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modal) { const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if (b) realClick(b); await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 }); }
async function openWechat() {
  const dots = Array.from(document.querySelectorAll('.home-page-dot'));
  for (const d of dots) { realClick(d); await window.__sleep(250); const els = Array.from(document.querySelectorAll('.app-icon')); const ic = els.find((el) => { const t = el.querySelector('.app-name'); return t && t.textContent.trim() === '微信'; }); if (ic) { realClick(ic); return await waitFor(() => document.querySelector('.wechat-app'), { timeoutMs: 15000 }); } }
  return false;
}
await openWechat(); await window.__sleep(300);
realClick(document.querySelector('.wechat-app .chat-item'));
await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 12000 });
await window.__sleep(900);
function imgState() {
  const list = Array.from(document.querySelectorAll('.message-image'));
  let loaded = 0, lazy = 0;
  list.forEach((n) => { try { if (n.naturalWidth > 0) loaded++; } catch (e) { } if (n.getAttribute('loading') === 'lazy') lazy++; });
  return { total: list.length, loaded: loaded, lazy: lazy };
}
function imgRequests() {
  try { return performance.getEntriesByType('resource').filter((e) => String(e.name).indexOf('1.png') >= 0).length; } catch (e) { return -1; }
}
report({ name: 'BEFORE-img-load', ok: true, detail: JSON.stringify(Object.assign(imgState(), { requests: imgRequests() })) });
done();
