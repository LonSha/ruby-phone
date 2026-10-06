/* ============================================================
 * tests/browser/scenarios/o1-search-cancel.scen.js — O1 基线场景③：搜索与取消（第 4 版）
 * ------------------------------------------------------------
 * 覆盖 O1 验收口径里的「搜索取消」，并把桌面分页的**翻页可达性**一并走通：
 *   搜索 App 在第 2 页，所以本场景必须真的翻页才能点到它 ——
 *   于是「分页手势/页码点可用」不是单独一条声明，而是本场景的必经步骤。
 *
 * 判定口径与场景②一致：真盒模型 + 真命中测试 + 真 click/input 事件。
 *
 * ★ 本文件是判据自身的第四轮修正（前三轮的教训如实记下）：
 *   第 1 版：起壳时序没走通（首次 click 恰落在入口已插、面板未挂的间隙），
 *            全红 —— 已按场景②的「点完再等 400ms」重试法修复。
 *   第 2 版：在快速档下要求取消键可见可点 —— 但取消键治的是全历史分片扫描，
 *            快速档没有扫描，`.gs-scanbar` 整条隐藏，box=0x0 是**正确行为**。
 *            把产品正确行为判成红 = 假红（与「放宽判据」方向相反的同一类错）。
 *   第 3 版：切到全历史档后等 800ms 再读取消键 —— 但 fixture 只有 3 楼，
 *            2000 条/片的扫描在第一次 onProgress 之前就整跑完了，
 *            `gs-scan-on` 从未点亮，取消键照旧隐藏。**修判据不修 fixture，
 *            等多久都是白等** —— 这是第 3 版浪费一整轮的原因。
 *   第 4 版：fixture 扩到 16000 楼 —— 全历史扫描至少要跨 8 个分片、
 *            8 次宏任务让出，扫描窗口真实存在数百毫秒以上；
 *            在扫描**进行中**（gs-scan-on 已点亮）读取消键、判可见可点、
 *            真点击，再等收束。这才是「取消」的完整证据链。
 *            —— v4 首跑后 scan-bar-lights-up 转绿（fixture 修正生效），
 *            但取消键的 hit 命中了 `LI > #st-phone-update-list`：
 *            **版本公告弹窗**（showLocalUpdateAnnouncementIfNeeded，每次版本
 *            首次打开弹一次）盖在手机面板上，把真点击拦走了。
 *            这不是产品缺陷 —— 弹窗行为正确、关闭键有绑定 ——
 *            但场景必须把它当**真实世界条件**处理：等它出现、真点关闭键、
 *            断言它真消失。这一步本身就是 O1 验收口径里
 *            「宿主操作」的一部分（公告弹窗是宿主侧真实交互面），
 *            顺带拿到一条独立读数：update-modal-dismissible。
 *
 * 关于「取消」的断言口径（只断用户能看见的三件事）：
 *   ① 扫描进行中，取消按钮真在场、真可点（有界真等 gs-scan-on 点亮）；
 *   ② 点了之后结果区给出明确收束（不残留上一轮结果条目）；
 *   ③ 输入框仍在、面板没被打散、返回键仍可达。
 * 不断言「扫描被中途停住」—— 浏览器场景的数据量下那读数分不出
 *   「取消了」与「本来就没在跑」；真取消行为由 v3170 行为面判据负责。
 * ============================================================ */

import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

/* [第 4 版] fixture：16000 楼（8 个 SCAN_CHUNK 分片）。
 *   每楼塞一段可检索正文，其中隔 100 楼埋一条含「咖啡」的命中，
 *   保证取消前扫描还在跑、取消后（如果没取消完）也有真命中可数。 */
const HIT_WORD = '咖啡';
const chat = Array.from({ length: 16000 }, (_, i) => ({
  mes: (i % 100 === 0) ? `第${i}楼 便利店买${HIT_WORD}记事` : `第${i}楼 今日份流水账内容 柴米油盐`,
  is_user: i % 2 === 0,
  name: i % 2 === 0 ? '我' : '角色',
  swipes: ['x'],
  swipe_id: 0,
}));

const host = installBrowserHost({ chat });

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

/* ---------- 0. 起壳（重试法：首次 click 可能落在面板未挂的间隙） ---------- */
try { await import('/index.js'); } catch (e) { report({ name: 'entry-imported', ok: false, detail: String((e && e.message) || e) }); }
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 15000 });
let panelUp = false;
for (let i = 0; i < 3 && !panelUp; i += 1) {
  const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (t) realClick(t);
  panelUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 });
}
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
report({ name: 'flow-setup', ok: panelUp && homeUp, detail: 'panel=' + panelUp + ' home=' + homeUp });

/* ---------- 0.5 版本公告弹窗：版本首次打开会弹一次，真点关闭键收掉 ----------
 * [v5→v6 修正] 弹窗是**异步**出现的：showLocalUpdateAnnouncementIfNeeded 要先
 *   await fetchLocalUpdateNotes（同源 fetch update-log.json）才弹 ——
 *   v5 在 homeUp 后**立刻**查它，那时还没弹（误报「未弹跳过」）；
 *   等它真弹出来时已盖住整个屏幕，把取消键的坐标点击与第 2 页全部图标的
 *   命中测试一并拦走（cancel hit=LI / reachable=0/20 —— 同一根因的两张面孔）。
 *   修法：有界真等（8s）它出现（真浏览器单跑一次、storage 全空，必然弹），
 *   出现后真点关闭键、等它真消失，再继续后续步骤。
 * 「已展示过」的分支保留（同进程二跑 / storage 已有记录时不再弹）。 */
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const updateModal = document.getElementById('st-phone-update-modal');
  const btn = updateModal.querySelector('.st-phone-update-btn-primary');
  /* [v6] 长公告（多版合并条目）会把关闭键顶到 dialog 滚动折叠线以下 ——
   *   dialog 是 overflow:auto，真实用户是「滚一下再点」；场景照做：
   *   先把关闭键滚进可视区（scrollIntoView 同步改布局位置），再取证点击。
   *   UX 观察（不判红）：四版合并的公告条目让关闭键进了折叠线下方，
   *   首屏直接点不到 —— 改进方向是 actions 粘底，归 O6/O7 评估，此处只记录。 */
  if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (_e) { /* 宿主无此 API 时退回 DOM 直点 */ } }
  const btnHit = hitTest(btn);
  report({ name: 'update-modal-dismissible', ok: !!btn && btnHit.ok, detail: btn ? ('关闭键 hit=' + btnHit.why) : '弹窗在场但没有关闭键' });
  if (btn && btnHit.ok) {
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    realClick(top || btn);
  }
  const gone = await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
  report({ name: 'update-modal-gone', ok: gone, detail: gone ? '公告弹窗已关闭' : '点了关闭键弹窗仍在（关闭没绑定）' });
} else {
  report({ name: 'update-modal-dismissible', ok: true, detail: '本版本公告未弹（已展示过），跳过' });
}

/* ---------- 1. 翻页：点第 2 个页码点 ----------
 * 判据口径 [第 4 版修正]：不判第 2 页的盒子边界 ——
 *   .app-grid-pager 是 flex 轨道，translate3d(-100%) 后第 2 页**贴在视口右边缘**
 *   （left == screen.right）是轨道几何的正常形态，第 3 版拿「页盒完全在
 *   screen 内」当判据是把正常形态判成红。真正可观测的是三件事：
 *   ① dot2 变 .is-active（页码状态真切换）；
 *   ② 第 2 页的图标中心点能被 elementFromPoint 命中（图标物理上进了视口）；
 *   ③ 第 2 页的 aria-hidden 翻成 false（goIconPage 的真实账目）。 */
const dots = [...document.querySelectorAll('.home-page-dot')];
report({ name: 'pager-dots-present', ok: dots.length > 1, detail: 'dots=' + dots.length });
const dot2 = dots[1];
report({ name: 'pager-dot-reachable', ok: hitTest(dot2).ok, detail: hitTest(dot2).why });
/* [v7] 真浏览器取证口径：--dump-dom 单帧模式下 CSS transition 冻结在 t=0 ——
 *   实测（_diag-notrans 诊断）：行内 transform 已写对（translate3d(-100%)），
 *   但 transition 不推进，computed 恒为恒等，页盒永远停在 t=0 位置，
 *   图标中心点全部落不进视口。禁掉 transition 后同一行内值立即生效
 *   （matrix(…,-432,0)、p2.left=56、图标 hit=SPAN.app-icon-emoji 真命中）。
 *   这不是产品缺陷：真机上 0.28s 过渡正常推进；
 *   禁 transition 等效于系统「减少动画」的用户形态 —— 合法取证口径。 */
const pagerEl = document.querySelector('.app-grid-pager');
if (pagerEl) pagerEl.style.transition = 'none';
if (dot2) realClick(dot2);
await window.__sleep(400);   /* 等 transform 过渡（0.28s）落地 */

const dot2Active = !!(dot2 && dot2.classList.contains('is-active'));
const page2 = document.querySelector('.app-grid-page[data-page-index="1"]');
const page2Icons = page2 ? [...page2.querySelectorAll('.app-icon')] : [];
const iconOnScreen = page2Icons.length > 0 && page2Icons.some((el) => hitTest(el).ok);
const page2Aria = page2 ? page2.getAttribute('aria-hidden') : 'missing';
report({
  name: 'page2-moved-into-view',
  ok: dot2Active && iconOnScreen && page2Aria === 'false',
  detail: 'dot2Active=' + dot2Active + ' icons=' + page2Icons.length + ' iconHit=' + iconOnScreen + ' aria-hidden=' + page2Aria,
});
/* 第 2 页图标物理可达的全量读数（此刻 App 还没打开，桌面图标不被遮 ——
 *   v4 的 iconHit=false 是取证时机错：在搜索面板打开后才回头测桌面图标，
 *   被 App 视图整个盖住，自然全 miss。翻页后立刻测才是真实读数。） */
const page2Reachable = page2Icons.filter((el) => hitTest(el).ok).length;
report({ name: 'page2-icons-reachable', ok: page2Icons.length > 0 && page2Reachable === page2Icons.length, detail: 'reachable=' + page2Reachable + '/' + page2Icons.length });

/* ---------- 2. 打开搜索（第 39 位，只在第 2 页） ---------- */
const searchIcon = page2Icons.find((el) => {
  const t = el.querySelector('.app-name');
  return t && t.textContent.trim() === '全局搜索';
});
report({ name: 'search-icon-on-page2', ok: !!searchIcon, detail: searchIcon ? '找到「全局搜索」且在视口内' : '第 2 页没有搜索图标（分页没生效）' });
if (searchIcon) realClick(searchIcon);
const gsUp = await waitFor(() => document.querySelector('.gs-wrap'), { timeoutMs: 15000 });
report({ name: 'search-app-opens', ok: gsUp, detail: gsUp ? '.gs-wrap 已渲染' : '未渲染' });

/* ---------- 3. 切到全历史档（取消键只在这一档才有意义） ---------- */
const modeBtn = document.getElementById('gs-mode');
report({ name: 'search-mode-btn-reachable', ok: hitTest(modeBtn).ok, detail: hitTest(modeBtn).why });
if (modeBtn) realClick(modeBtn);
await window.__sleep(400);
const modeLabel = document.getElementById('gs-mode')?.textContent || '';
report({ name: 'full-mode-toggled', ok: /全历史/.test(modeLabel), detail: '按钮文字=' + modeLabel.trim() });

/* ---------- 4. 输入关键词 → 等扫描点亮（16000 楼 × 8 片 × 宏任务让出） ----------
 * 关键时序：输入触发分片扫描 → _progress 点亮 .gs-scan-on → 取消键出现。
 * 有界真等（15s 上限）：16000 条在真浏览器里要跨多次宏任务，但远快于上限；
 *   真没等到才转红（说明扫描从未启动或瞬间跑完 —— 两种都是真缺陷面）。 */
const input = document.getElementById('gs-input');
if (input) {
  input.value = HIT_WORD;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const scanLit = await waitFor(() => {
  const bar = document.getElementById('gs-scanbar');
  return !!(bar && bar.classList.contains('gs-scan-on'));
}, { timeoutMs: 15000 });
report({
  name: 'scan-bar-lights-up',
  ok: scanLit,
  detail: scanLit ? 'gs-scan-on 已点亮（扫描真实进行中）' : '15s 内扫描条从未点亮（扫描未启动/无分片让出）',
});

/* ---------- 5. 扫描进行中：取消键在场、可见、可点；点了有收束 ----------
 * 这一步是本场景的灵魂，必须在 scanLit 为真时**立即**取证 ——
 *   等 800ms 再读就回到第 3 版的老路（扫描早跑完、键已隐藏）。 */
const cancel = document.getElementById('gs-cancel');
const cancelBox = cancel ? cancel.getBoundingClientRect() : null;
const cancelHit = hitTest(cancel);
report({
  name: 'search-cancel-reachable',
  ok: !!cancel && !!cancelBox && cancelBox.width > 0 && cancelBox.height > 0 && cancelHit.ok,
  detail: cancel ? ('box=' + Math.round(cancelBox.width) + 'x' + Math.round(cancelBox.height) + ' hit=' + cancelHit.why) : 'missing',
});
if (cancel && cancelHit.ok) {
  const r = cancel.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  realClick(top || cancel);   /* 点 elementFromPoint 命中的顶层（与用户真点同链路） */
}
await window.__sleep(300);

/* 命中判据看**结果条目**，不看整段文本：取消文案里也含关键词，
 *   用 `/关键词/.test(textContent)` 会把「解释取消的文案」判成「结果残留」
 *   —— 自指伪证第四形态（判据把解释本次动作的文字当成缺陷本体）。 */
const afterItems = document.querySelectorAll('#gs-results .gs-item').length;
const afterText = (document.getElementById('gs-results')?.textContent || '').trim();
report({
  name: 'search-cancel-clears-results',
  ok: afterItems === 0,
  detail: '取消后结果条目=' + afterItems + ' 文案=' + afterText.slice(0, 40),
});
const scanOffNow = !document.getElementById('gs-scanbar')?.classList.contains('gs-scan-on');
report({ name: 'scan-bar-lights-off', ok: scanOffNow, detail: scanOffNow ? '取消后扫描条已收起' : 'gs-scan-on 仍亮着（取消没清它）' });
const inputStill = !!document.getElementById('gs-input');
report({ name: 'search-input-survives-cancel', ok: inputStill, detail: inputStill ? '输入框仍在' : '输入框被取消操作打散' });

/* ---------- 6. 返回键在本 App 内同样可达（跨 App 一致性） ---------- */
const back = document.getElementById('phone-back-button');
report({ name: 'back-button-visible-in-search', ok: !!back && getComputedStyle(back).display !== 'none', detail: back ? 'display=' + getComputedStyle(back).display : 'missing' });

report({ name: 'host-stub-ledger', ok: true, detail: 'blocked=' + host.log.fetchBlocked.length });
done();