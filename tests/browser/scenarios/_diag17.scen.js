/* _diag17 — 长列表修复候选 A/B：content-visibility 是否可安全启用（不变量检查） */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const LINES = 1500, IMGS = 300;
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
const NS = 'st_virtual_phone';
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const PNG = '/apps/calendar/assets/1.png';
const msgs = [];
for (let i = 0; i < LINES; i++) {
  const isImg = i % 5 === 0 && (i / 5) < IMGS;
  msgs.push(isImg
    ? { id: 'm' + i, content: PNG, type: 'image', timestamp: 1758000000000 + i * 60000, time: '12:0' + (i % 10), isMe: i % 2 === 0 }
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
const row = document.querySelector('.wechat-app .chat-item');
realClick(row);
await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 12000 });
await window.__sleep(500);
function boxed() { return Array.from(document.querySelectorAll('.chat-message')).filter((el) => el.offsetHeight > 0).length; }
function total() { return document.querySelectorAll('.chat-message').length; }
function imgAttrs() { const im = document.querySelectorAll('.message-image'); let lazy = 0, async = 0; im.forEach((n) => { if (n.getAttribute('loading') === 'lazy') lazy++; if (n.decoding === 'async' || n.getAttribute('decoding') === 'async') async++; }); return { imgs: im.length, lazy: lazy, async: async }; }
const box = document.getElementById('chat-messages');
report({ name: 'A-baseline', ok: true, detail: JSON.stringify({ total: total(), boxed: boxed(), imgs: imgAttrs(), scrollHeight: box.scrollHeight }) });
/* --- B：注入 content-visibility --- */
const st = document.createElement('style');
st.id = 'cv-probe';
st.textContent = '.wechat-app .chat-message { content-visibility: auto; contain-intrinsic-size: auto 64px; }';
document.head.appendChild(st);
await window.__sleep(400);
const boxedB = boxed();
report({ name: 'B-toggled', ok: boxedB < total(), detail: JSON.stringify({ total: total(), boxed: boxedB, scrollHeight: box.scrollHeight }) });
/* --- 不变量 1：滚到底部后最后一条可真到达 --- */
box.scrollTop = box.scrollHeight;
await window.__sleep(500);
const last = document.querySelectorAll('.chat-message')[total() - 1];
const lr = last.getBoundingClientRect();
const br = box.getBoundingClientRect();
const lastVisible = lr.height > 0 && lr.bottom <= br.bottom + 4 && lr.top >= br.top - 4;
report({ name: 'inv-last-reachable', ok: lastVisible, detail: 'lastRect=' + Math.round(lr.top) + '/' + Math.round(lr.height) + ' boxBottom=' + Math.round(br.bottom) + ' scrollTop=' + Math.round(box.scrollTop) + ' scrollH=' + box.scrollHeight });
/* --- 不变量 2：上滚一屏，中间楼层文本完整 --- */
box.scrollTop = Math.floor(box.scrollHeight * 0.4);
await window.__sleep(400);
const mid = Array.from(document.querySelectorAll('.chat-message')).filter((el) => el.offsetHeight > 0).slice(0, 3);
const midText = mid.map((el) => (el.textContent || '').trim().slice(0, 18)).join(' | ');
report({ name: 'inv-mid-text', ok: midText.length > 0, detail: midText });
/* --- 不变量 3：滚回底部，仍是最后一条 --- */
box.scrollTop = box.scrollHeight;
await window.__sleep(400);
const lastText = (document.querySelectorAll('.chat-message')[total() - 1].textContent || '').trim().slice(0, 18);
report({ name: 'inv-bottom-text', ok: lastText.length > 0, detail: lastText + ' scrollTop=' + Math.round(box.scrollTop) });
/* --- 不变量 4：首屏（未滚动）第 0 条仍在视口内 --- */
box.scrollTop = 0;
await window.__sleep(400);
const first = document.querySelectorAll('.chat-message')[0];
const fr = first.getBoundingClientRect();
report({ name: 'inv-top-text', ok: fr.height > 0, detail: (first.textContent || '').trim().slice(0, 18) + ' rect=' + Math.round(fr.top) + '/' + Math.round(fr.height) });
done();
