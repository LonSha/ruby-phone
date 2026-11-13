import { desktopIcon } from '/tests/browser/desktop-navigation.mjs';
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
import { computeWindowedRange } from '/apps/wechat/chat-view-windowed-stream.js';
/* ============================================================
 * tests/browser/scenarios/r21-windowed-stream.scen.js — R21-O1 真·窗口化消息流
 * ------------------------------------------------------------
 * 计划原文（R21-O1）：
 *   「1000 / 3000 条消息，断言**真实 DOM 节点数 ≤ 40**（不是估算、是 querySelectorAll 真数）、
 *    滚动到顶/底/中间三处后仍 ≤ 40、消息内容与全量模式逐条等价。
 *    负控制：把窗口上界改成 Infinity ⇒ 必须红；把缓冲改成 0 ⇒ 必须红（会白屏）。」
 *
 * 本场景只回答四件事（全部在真入口 + 真 phone.css + 真数据层上）：
 *   ① 窗口化模式下 `.chat-message` 物化条数有硬上界（真 querySelectorAll 数）；
 *   ② 滚到顶 / 中 / 底后仍在上界内，且**不是零节点**（零节点等于白屏，不是通过）；
 *   ③ 每条已物化消息的 `data-message-id` / `data-message-index` 都能对上源数据，
 *      内容与源消息一致（防「省了节点丢了消息」）；
 *   ④ 负控制：切回全量 ⇒ 物化条数必须 > 上界（证明 ① 的读数不是夹具太小造成的假绿）；
 *      纯函数侧把上界改 Infinity / 缓冲改 0 ⇒ 区间读数必须变大 / 变小。
 *
 * 边界（诚实）：夹具是注入的存储键，不是用户真实历史；本层证明的是渲染通道的节点上界与
 * 内容对应，**不证明**目标设备帧率（实机读数归 runtime-verification-boundary.md）。
 * ============================================================ */
const LINES = 1000;
const NS = 'st_virtual_phone';
const LIMIT = 40;
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
host.ctx.extensionSettings[NS] = host.ctx.extensionSettings[NS] || {};
host.ctx.extensionSettings[NS]['wechat-message-render-mode'] = 'windowed';
const msgs = [];
for (let i = 0; i < LINES; i++) {
    msgs.push({
        id: 'm' + i,
        timestamp: 1758000000000 + i * 60000,
        time: '12:0' + (i % 10),
        isMe: i % 2 === 0,
        type: 'text',
        content: '第 ' + i + ' 楼正文 内容片段 ' + (i % 7),
    });
}
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({
    chats: [{ id: 'c1', name: '窗口化长会话', type: 'single', timestamp: 1758000000000 + LINES * 60000 }],
    contacts: [], settings: {}, messages: {},
});
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);
function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
const rows = () => Array.from(document.querySelectorAll('#chat-messages .chat-message'));
const rowCount = () => rows().length;
const byId = new Map(msgs.map((m, i) => [String(m.id), { msg: m, index: i }]));
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
report({ name: 'r21-shell-ready', ok: !!(up && panelUp), detail: 'entry=' + String(window.VirtualPhone && window.VirtualPhone.version) + ' panel=' + panelUp + ' fixture=injected-storage-keys lines=' + LINES + ' mode=windowed' });
if (!panelUp) { done(); }
let wechatUp = false;
let roomUp = false;
try {
    const icon = await desktopIcon('wechat');
    if (icon) { realClick(icon); wechatUp = await waitFor(() => document.querySelector('.wechat-app'), { timeoutMs: 15000 }); }
    const row = document.querySelector('.wechat-app .chat-item');
    if (row) { realClick(row); roomUp = await waitFor(() => document.getElementById('chat-messages'), { timeoutMs: 20000 }); }
} catch (_e) { /* 由读数判定 */ }
await window.__sleep(300);
const container = document.getElementById('chat-messages');
report({ name: 'r21-room-open', ok: !!(wechatUp && roomUp && container), detail: 'wechat=' + wechatUp + ' room=' + roomUp + ' container=' + !!container });
if (!container) { done(); }
function scrollAndSettle(ratio) {
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.round(max * ratio);
    try { container.dispatchEvent(new Event('scroll')); } catch (_e) { /* 忽略 */ }
}
await window.__sleep(120);
const firstCount = rowCount();
report({ name: 'r21-windowed-bound', ok: firstCount > 0 && firstCount <= LIMIT, detail: 'materialized=' + firstCount + ' limit=' + LIMIT + ' fixtureTotal=' + LINES + ' containerNodes=' + container.getElementsByTagName('*').length });
/* 内容与源数据逐条对应：id / 全局下标 / 正文。 */
function equivalence() {
    const bad = [];
    for (const el of rows()) {
        const id = String(el.dataset.messageId || '').trim();
        const idx = Number.parseInt(el.dataset.messageIndex || '', 10);
        const src = byId.get(id);
        if (!src) { bad.push('unknown-id:' + id); continue; }
        if (idx !== src.index) { bad.push('index:' + id + '=' + idx + '!=' + src.index); continue; }
        if (!String(el.textContent || '').includes(src.msg.content)) bad.push('content:' + id);
    }
    return bad;
}
const badInitial = equivalence();
report({ name: 'r21-content-equivalence', ok: badInitial.length === 0, detail: 'checked=' + firstCount + ' mismatches=' + badInitial.slice(0, 5).join(',') });
const positions = [['top', 0], ['middle', 0.5], ['bottom', 1]];
for (const [label, ratio] of positions) {
    scrollAndSettle(ratio);
    await window.__sleep(160);
    const n = rowCount();
    report({ name: 'r21-scroll-' + label, ok: n > 0 && n <= LIMIT, detail: 'scrollTop=' + Math.round(container.scrollTop) + ' materialized=' + n + ' limit=' + LIMIT });
}
/* 负控制 A：切回全量后物化条数必须超过上界（证明上界读数不是夹具太小）。 */
try {
    await window.VirtualPhone.wechatApp.chatView.setMessageStreamMode('full');
} catch (_e) { /* 由读数判定 */ }
await window.__sleep(200);
const fullCount = rowCount();
report({ name: 'r21-negative-full-mode', ok: fullCount > LIMIT, detail: 'fullModeMaterialized=' + fullCount + ' mustBeGreaterThan=' + LIMIT + '（证明窗口化读数不是夹具太小）' });
/* 恢复窗口化，供纯函数负控制后的现场仍可解释。 */
try { await window.VirtualPhone.wechatApp.chatView.setMessageStreamMode('windowed'); } catch (_e) { /* 忽略 */ }
await window.__sleep(120);
/* 负控制 B：纯函数把上界改 Infinity ⇒ 区间必须变大（> 上界）；缓冲改 0 ⇒ 区间必须变小。
 *   为什么 Infinity 档用 3 屏缓冲：产品默认 1 屏缓冲下未封顶区间也只有 ~29 条（< 40），
 *   那样「上界改 Infinity」不会翻面，负控制就成了恒绿。计划要求的是「去掉上界 ⇒ 必红」，
 *   故这里把缓冲放大到 3 屏，让未封顶区间真的越过 40 —— 上界封顶与否才可分辨。 */
const maxRange = computeWindowedRange(LINES, 5000, 640, { maxNodes: Infinity, overscan: 3 });
const normalRange = computeWindowedRange(LINES, 5000, 640, { maxNodes: LIMIT, overscan: 3 });
const zeroOverscan = computeWindowedRange(LINES, 5000, 640, { maxNodes: LIMIT, overscan: 0 });
const maxSpan = maxRange.endIndex - maxRange.startIndex;
const normalSpan = normalRange.endIndex - normalRange.startIndex;
const zeroSpan = zeroOverscan.endIndex - zeroOverscan.startIndex;
report({ name: 'r21-negative-infinity', ok: maxSpan > LIMIT && maxSpan > normalSpan, detail: 'infinitySpan=' + maxSpan + ' normalSpan=' + normalSpan + ' limit=' + LIMIT });
report({ name: 'r21-negative-zero-buffer', ok: zeroSpan < normalSpan, detail: 'zeroBufferSpan=' + zeroSpan + ' normalSpan=' + normalSpan + '（缓冲 0 ⇒ 换窗前那一帧无内容可画）' });
done();
