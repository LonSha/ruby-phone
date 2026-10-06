/* ============================================================
 * tests/browser/scenarios/o1-shell-smoke.scen.js — O1 基线场景①：真入口 + 真外壳
 * ------------------------------------------------------------
 * 这是**场景体**（不是测试文件）：它由 tests/browser/browser-runner.mjs 塞进真
 * Chromium 的页内 `<script type="module">` 里跑，跑完把读数写进 `#__result`。
 * 为什么单独放一个文件而不是在驱动里拼字符串：拼字符串要经过两三层引号转义，
 * 实测已经在 O1 首轮踩过一次（转义把 `"` 落进 JS 语法位置，整个模块直接不执行，
 * 得到「0 读数」，看上去像“什么都没报错”）。落地成独立文件后，本文件本身可被
 * 语法门与读者直接检查。
 *
 * 本场景回答的问题：把**真 index.js + 真 phone.css** 在一个只有宿主桩的页面上
 * 启动，用户到底能不能看到并点开手机？读数全走真盒模型（getBoundingClientRect）
 * 与真命中测试（elementFromPoint），不读任何“声明存在”。
 * ============================================================ */

import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

const host = installBrowserHost({
  chat: Array.from({ length: 3 }, (_, i) => ({ mes: '楼层' + i, is_user: i % 2 === 0, swipes: ['x'], swipe_id: 0 })),
});
report({ name: 'host-installed', ok: typeof window.$ === 'function' && !!window.SillyTavern, detail: 'jq=' + (typeof window.$) + ' ST=' + (typeof window.SillyTavern) });

let importError = null;
try { await import('/index.js'); } catch (e) { importError = String((e && e.message) || e); }
report({ name: 'entry-imported', ok: importError === null, detail: importError || 'index.js 已求值' });

/* 版本号为什么必须「有界真等」而不是 import 完就读：
 *   index.js 末尾是 `init().then(() => { if (window.VirtualPhone && modulesLoaded) … })`，
 *   而 `init()` 自己又是异步的（核心模块并行 import + 宿主事件登记）。`await import()` 只保证
 *   **模块顶层同步段**跑完，不保证那条 then 已执行 —— 于是「import 完立刻读 version」读到 undefined，
 *   与「版本号没接上」在读数上同形。这正是本仓最贵的那类假红。
 *   故改成有界真等：等到出现为止（上限 15s）。真的没等到才转红。
 *   实测（Chromium 131 / 独立浏览器）约 1 秒内到位。 */
const versionUp = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 15000 });
report({
  name: 'entry-version',
  ok: versionUp,
  detail: versionUp ? String(window.VirtualPhone.version) : '等待 15s 仍未挂上（不是读得早，是真没接上）',
});

// 入口自己的注入节奏：先等掩蔽层消失，再挂 DOM。独立浏览器上没有掩蔽层，
//   但仍要给它真时间，否则「没跑起来」会被误读成「入口没接线」。
const panelUp = await waitFor(() => document.getElementById('phone-panel'), { timeoutMs: 10000 });
report({ name: 'panel-dom-created', ok: panelUp, detail: panelUp ? '#phone-panel 在场' : '未创建' });

const trigger = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
report({ name: 'entry-trigger-present', ok: !!trigger, detail: trigger ? trigger.id : 'none' });

if (trigger) {
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

const shellUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 10000 });
report({ name: 'shell-created', ok: shellUp, detail: shellUp ? '.phone-in-panel 在场' : '未创建' });
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 8000 });
report({ name: 'home-rendered', ok: homeUp, detail: homeUp ? '.home-screen 在场' : '未渲染' });

function box(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), l: Math.round(r.left) };
}
const bPanel = box('.phone-body-panel');
report({ name: 'panel-real-box', ok: !!(bPanel && bPanel.w > 100 && bPanel.h > 300), detail: JSON.stringify(bPanel) });
const bHome = box('.home-screen');
report({ name: 'home-real-box', ok: !!(bHome && bHome.w > 100), detail: JSON.stringify(bHome) });

// 图标：数量与真盒（宽高为零 = 用户看不见 = 必须转红的那一类）
const icons = [...document.querySelectorAll('.home-screen .app-icon')];
let zero = 0;
for (const el of icons) { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) zero += 1; }
report({ name: 'icons-have-box', ok: icons.length > 0 && zero === 0, detail: 'icons=' + icons.length + ' zero=' + zero });

// 命中测试：图标中心点真能被点中吗（被遮挡 / 被覆盖层吃掉都会在这里露馅）
if (icons.length > 0) {
  const r = icons[0].getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const reachable = !!(hit && (hit === icons[0] || icons[0].contains(hit)));
  report({ name: 'icon-hit-test', ok: reachable, detail: reachable ? '命中本体' : ('命中的是 ' + (hit ? (hit.className || hit.id || hit.tagName) : 'null')) });
} else {
  report({ name: 'icon-hit-test', ok: false, detail: '无图标可点' });
}

// 分页：页数与页码圆点必须一致
const pages = document.querySelectorAll('.app-grid-page');
const dots = document.querySelectorAll('.home-page-dot');
report({ name: 'icons-paged', ok: pages.length > 1 && dots.length === pages.length, detail: 'pages=' + pages.length + ' dots=' + dots.length });

// 返回键：主屏幕必须不可见（v3.56.0 的病灶之一就是它从未渲染）
const back = document.getElementById('phone-back-button');
const backHidden = !!back && getComputedStyle(back).display === 'none';
report({ name: 'back-button-home-hidden', ok: backHidden, detail: back ? ('display=' + getComputedStyle(back).display) : 'missing' });

// 生产 CSS 真的注入了吗（注入失败时上面所有盒模型读数都会变成 0，故此条是归因锚）
const cssTag = document.getElementById('st-phone-global-css');
let ruleCount = 0;
for (const sheet of document.styleSheets) { try { ruleCount += sheet.cssRules.length; } catch (_e) { /* 跨源表跳过 */ } }
report({ name: 'prod-css-loaded', ok: !!cssTag && ruleCount > 100, detail: 'style=' + (cssTag ? 'yes' : 'no') + ' rules=' + ruleCount });

// 宿主桩的账：跨源请求被拒了几次（更新检查会去打 CDN，本桩刻意不放行）
report({ name: 'host-stub-fetch-ledger', ok: true, detail: 'allowed=' + host.log.fetchAllowed + ' blocked=' + host.log.fetchBlocked.length + ' ' + JSON.stringify(host.log.fetchBlocked.slice(0, 3)) });
report({ name: 'host-stub-jq-ledger', ok: true, detail: JSON.stringify(host.log.jqOns.slice(0, 6)) });

done();
