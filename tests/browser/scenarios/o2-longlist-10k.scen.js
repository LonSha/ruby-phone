import { desktopIcon } from '/tests/browser/desktop-navigation.mjs';
/* ============================================================
 * tests/browser/scenarios/o2-longlist-10k.scen.js — R25-O2 万条消息的真读数
 * ------------------------------------------------------------
 * 本场景只回答路线图 O2 验收口径里的两件事：
 *   ① 「1 万条消息的滚动/内存读数」—— DOM 物化条数与堆占用都在**真排版引擎**里量；
 *   ② 「滚动位置与草稿在切 App 后一致」—— 真输入真滚动（滚到**中段**，不是贴底），
 *      真去桌面再回来，读回值对拍。
 *
 * 口径边界（诚实四条，逐条都是本轮实测踩出来的）：
 *   · 夹具是**注入的存储键**（10000 条），不是用户真实历史；它证明「这条渲染路径在长数据下的
 *     规模与资源行为」，不证明目标设备流畅度（那归实机，本环境不冒充）。
 *   · **帧率在本层拿不到**：本环境 headless 单帧 dump 模式下 requestAnimationFrame
 *     整体停摆（实测 frames=0），所以这里**不报帧率**、不设阈值，改报
 *     「同步滚动 + 强制布局」的单步耗时（能反映滚动路径的计算代价，但不是帧间隔）。
 *   · 堆占用取 performance.memory（浏览器不给就如实报 null，不拿节点数冒充字节）。
 *   · 位置对拍前必须**确认已离开底部**：贴底时「恢复」与「默认贴底」读数相同，
 *     那种 0 差异证明不了任何事（本场景首版就在这里拿到过假绿）。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

const LINES = 10000;
const NS = 'st_virtual_phone';
const host = installBrowserHost({ chat: [{ mes: '宿主楼层', is_user: false, swipes: ['x'], swipe_id: 0 }] });
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const msgs = [];
for (let i = 0; i < LINES; i += 1) {
    msgs.push({
        id: 'm' + i,
        timestamp: 1758000000000 + i * 60000,
        time: '12:' + String(i % 60).padStart(2, '0'),
        isMe: i % 2 === 0,
        type: 'text',
        content: '第 ' + i + ' 楼正文 内容片段 ' + (i % 7),
    });
}
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({
    chats: [{ id: 'c1', name: '万条会话', type: 'single', timestamp: 1758000000000 + LINES * 60000 }],
    contacts: [], settings: {}, messages: {},
});
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);

function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
const nodes = () => document.getElementsByTagName('*').length;
const laps = {};
const mark = (n) => { laps[n] = performance.now(); };
function heap() {
    const m = performance.memory;
    return (m && Number(m.usedJSHeapSize) > 0) ? Math.round(Number(m.usedJSHeapSize) / 1048576) : null;
}

try { await import('/index.js'); } catch (_e) { /* 由读数判定 */ }
const up = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
let panelUp = false;
for (let i = 0; i < 3 && !panelUp; i += 1) {
    const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
    if (t) realClick(t);
    panelUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 });
}
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modal = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modal) {
    const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
    if (b) realClick(b);
    await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
report({ name: 'o2-shell-ready', ok: !!(up && panelUp), detail: 'entry=' + String(window.VirtualPhone && window.VirtualPhone.version) + ' panel=' + panelUp + ' fixtureLines=' + LINES });
if (!panelUp) { done(); }

/* 一条导航路径：点图标 → 微信可能直接回到**上次那个会话**（实测就是这样），也可能给列表。
 *   两种都收：先看有没有 #chat-messages，没有再点行。 */
async function enterWechatRoom() {
    const icon = await desktopIcon('wechat');
    if (!icon) return { wechat: false, chat: false };
    realClick(icon);
    await window.__sleep(1000);
    const wechat = !!document.querySelector('.wechat-app');
    if (document.getElementById('chat-messages')) return { wechat: wechat, chat: true };
    const hasRow = await waitFor(() => document.querySelector('.wechat-app .chat-item'), { timeoutMs: 12000 });
    if (hasRow) {
        realClick(document.querySelector('.wechat-app .chat-item'));
        await window.__sleep(1400);
    }
    return { wechat: wechat, chat: !!document.getElementById('chat-messages') };
}

mark('t0');
const first = await enterWechatRoom();
mark('t2');
await window.__sleep(900);
report({ name: 'o2-open-10k-chat', ok: !!(first.wechat && first.chat), detail: 'wechat=' + first.wechat + ' chat=' + first.chat + ' openLap=' + Math.round(laps.t2 - laps.t0) + 'ms（同一次运行内的相对量级，不设阈值） fixtureLines=' + LINES });
if (!first.chat) { done(); }

/* ---------- ① 物化上界 + 堆（结构事实可断言，收益只登记） ---------- */
const rendered = document.querySelectorAll('.chat-message').length;
const allNodes = nodes();
report({
    name: 'o2-materialized-bounded',
    ok: rendered > 0 && rendered <= 200,
    detail: 'renderedMessages=' + rendered + '/200 上界 fixtureTotal=' + LINES + ' allNodes=' + allNodes + ' nodesPerMessage=' + (rendered ? Math.round((allNodes / rendered) * 100) / 100 : 0) + ' heapMB=' + heap(),
});

/* ---------- ② 滚动路径代价：帧率拿不到，就报「同步滚动 + 强制布局」单步耗时 ---------- */
async function frameProbe(steps) {
    const box = document.getElementById('chat-messages');
    const deltas = [];
    let last = performance.now();
    let i = 0;
    return await new Promise((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(deltas); } };
        setTimeout(finish, 3000);
        function tick() {
            if (settled) return;
            const now = performance.now();
            deltas.push(now - last);
            last = now;
            box.scrollTop -= 120;
            i += 1;
            if (i < steps) requestAnimationFrame(tick); else finish();
        }
        requestAnimationFrame(tick);
    });
}
const frames = await frameProbe(60);
/* 同步代价：每一步「写 scrollTop + 读回布局」会强制一次同步布局，量的是滚动路径的计算代价。 */
const box0 = document.getElementById('chat-messages');
let costTotal = 0;
for (let i = 0; i < 30; i += 1) {
    const t = performance.now();
    box0.scrollTop = Math.max(0, box0.scrollTop - 100);
    void box0.scrollHeight;
    costTotal += performance.now() - t;
}
const costPerStep = Math.round((costTotal / 30) * 100) / 100;
report({
    name: 'o2-scroll-cost',
    ok: costPerStep >= 0 && costPerStep < 50,
    detail: 'rAF-frames=' + frames.length + '（本环境 rAF 停摆 ⇒ 不报帧率） syncScrollCostMsPerStep=' + costPerStep + ' over30Steps=' + Math.round(costTotal * 100) / 100 + ' heapMB=' + heap(),
});

/* ---------- ③ 切 App 后再回来：草稿与滚动位置一致（必须离开底部，否则 0 差异不证明任何事） ---------- */
const box = document.getElementById('chat-messages');
const DRAFT = '草稿-万条-abc';
const input = document.getElementById('chat-input');
if (input) { input.value = DRAFT; input.dispatchEvent(new Event('input', { bubbles: true })); }
/* 滚到**中段**：贴底时「恢复」与「默认贴底」读数相同，那种一致是假的。 */
box.scrollTop = Math.max(0, Math.round((box.scrollHeight - box.clientHeight) / 2));
box.dispatchEvent(new Event('scroll'));
await window.__sleep(700);
const atBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 100;
const ledgerRaw = host.ctx.chatMetadata[NS]['chat_scroll_memory_v1'] || null;
let ledgerTop = null;
try {
    const parsed = JSON.parse(String(ledgerRaw || 'null'));
    const e = parsed && parsed.chats ? parsed.chats['c1'] : null;
    ledgerTop = e && typeof e.top === 'number' ? e.top : null;
} catch (_e) { ledgerTop = null; }
report({
    name: 'o2-scroll-recorded',
    ok: ledgerTop !== null && Math.abs(ledgerTop - Math.round(box.scrollTop)) <= 2,
    detail: 'ledgerKey=chat_scroll_memory_v1 ledgerTop=' + ledgerTop + ' liveTop=' + Math.round(box.scrollTop) + '（记没记是这一步唯一能验的事）',
});
const before = { draft: input ? String(input.value) : '', top: Math.round(box.scrollTop), atBottom: atBottom, heap: heap(), nodes: nodes(), ledgerTop: ledgerTop };
report({
    name: 'o2-before-leave',
    ok: before.draft === DRAFT && before.atBottom === false && before.top > 0,
    detail: 'draft=' + JSON.stringify(before.draft) + ' scrollTop=' + before.top + ' atBottom=' + before.atBottom + '（必须 false：贴底的一致不算证据） heapMB=' + before.heap + ' nodes=' + before.nodes,
});

function readingPosition(container) {
    if (!container) return null;
    const viewport = container.getBoundingClientRect();
    for (const row of container.querySelectorAll('.chat-message[data-message-id]')) {
        const rect = row.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom) {
            // Client rects include the panel transform; compare local reading offsets.
            const offset = (rect.top - viewport.top) * row.offsetHeight / rect.height;
            return { id: row.dataset.messageId, offset };
        }
    }
    return null;
}
const readingBefore = readingPosition(box);
window.dispatchEvent(new CustomEvent('phone:goHome', { detail: {} }));
await window.__sleep(900);
report({
    name: 'o2-left-desk',
    ok: document.querySelectorAll('.wechat-app').length === 0 && document.querySelectorAll('.home-screen').length >= 1,
    detail: 'wechatApps=' + document.querySelectorAll('.wechat-app').length + ' homeScreens=' + document.querySelectorAll('.home-screen').length + '（微信必须真卸掉，否则位置一致是「DOM 没动过」的假一致）',
});
const back = await enterWechatRoom();
await window.__sleep(900);
const box2 = document.getElementById('chat-messages');
const input2 = document.getElementById('chat-input');
const readingAfter = readingPosition(box2);
report({
    name: 'o2-visible-message-after-app-switch',
    ok: !!readingBefore && readingBefore.id === readingAfter?.id && Math.abs(readingAfter.offset - readingBefore.offset) <= 2,
    detail: 'before=' + JSON.stringify(readingBefore) + ' after=' + JSON.stringify(readingAfter),
});
report({
    name: 'o2-reopen-after-app-switch',
    ok: !!(back.wechat && back.chat),
    detail: 'wechat=' + back.wechat + ' chat=' + back.chat + ' csmFace=' + String((box2 || {}).dataset ? box2.dataset.csmFace : '') + '（回不去就下面两条都对不了，先看这条）',
});
const after = {
    draft: input2 ? String(input2.value) : '',
    top: box2 ? Math.round(box2.scrollTop) : -1,
    heap: heap(),
    nodes: nodes(),
};
report({
    name: 'o2-draft-after-app-switch',
    ok: after.draft === DRAFT,
    detail: 'before=' + JSON.stringify(before.draft) + ' after=' + JSON.stringify(after.draft) + '（草稿由 config/edit-buffer-binding.js 负责，本项不重复实现）',
});
report({
    name: 'o2-scroll-after-app-switch',
    ok: !!(back.wechat && back.chat) && after.top >= 0 && Math.abs(after.top - before.top) <= 2,
    detail: 'before=' + before.top + ' ledger=' + ledgerTop + ' target=' + box2?.dataset.csmTop
        + ' landed=' + box2?.dataset.csmLanded + ' restoreMax=' + box2?.dataset.csmMax
        + ' finalMax=' + (box2 ? box2.scrollHeight - box2.clientHeight : null)
        + ' after=' + after.top + ' delta=' + (after.top - before.top) + '（>2px 即位置没记住） heapBefore=' + before.heap + ' heapAfter=' + after.heap + ' nodesBefore=' + before.nodes + ' nodesAfter=' + after.nodes,
});
done();
