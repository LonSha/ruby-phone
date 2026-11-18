/* ============================================================
 * tests/browser/scenarios/o4-style-lazy.scen.js — R25-O4 浏览器真读数
 * ------------------------------------------------------------
 * 回答的问题：把 9 个 App 的样式搬出 phone.css 之后，
 *   ① 首屏（还没打开任何 App）里它们的样式**真的没生效**吗？
 *   ② 打开那个 App 时样式**真的到了**吗（link 真载、sheet 真解析、类真生效）？
 *   ③ 没打开的 App 依然不生效吗（「未触达不入首屏」不是只对一个 App 成立）？
 *   ④ 首屏 CSS 字节到底是多少（不许拿账本上的数当实测）？
 *   ⑤ 冷启动到可交互的墙钟是多少（与 ④ 一起构成前后对比的「前」）。
 *
 * 口径说明（不许含糊）：
 *   · 探针用 CSS 变量：`.nsm-root { --nsm-bg: #eef1f6 }` 这类声明**只有样式到位才读得出**，
 *     读不出就是空串 —— 比「节点在不在」硬（节点在而样式没来，正是要抓的形态）；
 *   · 首屏字节走真 fetch('/phone.css') 的 text 长度，不从账本读；
 *   · 时钟读数只作参考值（不同机器差几倍属正常），本文件不拿它判红。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
installBrowserHost({ chat: [
  { mes: '楼层0', is_user: true, swipes: ['x'], swipe_id: 0 },
  { mes: '楼层1', is_user: false, name: '角色', swipes: ['x'], swipe_id: 0 },
] });
function realClick(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
const t0 = (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : null;
await import('/index.js');
await waitFor(function () { return !!(window.VirtualPhone && window.VirtualPhone.version); }, { timeoutMs: 25000 });
await waitFor(function () { return !!document.querySelector('.home-screen'); }, { timeoutMs: 12000 });
/* 更新弹窗会盖住整个视口：不关掉，后面的点击都打在弹窗上。 */
const modal = await waitFor(function () { return !!document.getElementById('st-phone-update-modal'); }, { timeoutMs: 6000 });
if (modal) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(function () { return !document.getElementById('st-phone-update-modal'); }, { timeoutMs: 5000 });
}

/* ⑤ 冷启动墙钟：必须在**任何「等 link」断言之前**量 ——
 * 否则本场景自己的 waitFor 超时（旧版本永远等不到 link）会把 30s 等待算进启动时间，
 * 得出「快了 3 倍」这种假结论（本仓最贵的错读数形态之一）。 */
const bootMs = (t0 !== null && performance && performance.now) ? Math.round(performance.now()) : null;
report({
  name: 'o4-boot-to-interactive',
  ok: true,
  detail: '从脚本开始到可交互（VirtualPhone 就绪 + 桌面出图 + 弹窗处理完）=' + (bootMs === null ? 'unknown' : bootMs + 'ms') + '；本条只作参考值，不判红',
});
/* ① 首屏：一个 App 的样式表都不许在 head 里 */
const lazyLinksAtBoot = document.querySelectorAll('link[id^="app-style-"]').length;
report({
  name: 'o4-first-paint-no-app-css',
  ok: lazyLinksAtBoot === 0,
  detail: '首屏 link[id^=app-style-] 数量=' + lazyLinksAtBoot + '（应=0：未触达的 App 样式不许进首屏）',
});

/* 探针：真读 CSS 变量（样式没到位 ⇒ 空串） */
function probeVar(className, varName) {
  const box = document.createElement('div');
  box.className = className;
  document.body.appendChild(box);
  const cs = getComputedStyle(box);
  const v = cs.getPropertyValue(varName);
  box.remove();
  return String(v || '').trim();
}
const nsmBoot = probeVar('nsm-root', '--nsm-bg');
const sndBoot = probeVar('snd-root', '--snd-bg');
report({
  name: 'o4-probe-not-applied-at-boot',
  ok: nsmBoot === '' && sndBoot === '',
  detail: '首屏探针 --nsm-bg=' + JSON.stringify(nsmBoot) + ' --snd-bg=' + JSON.stringify(sndBoot) + '（都应空串：空=样式确实不在首屏）',
});

/* ④ 首屏 CSS 真字节 */
let cssBytes = null;
try {
  const resp = await fetch('/phone.css');
  const txt = await resp.text();
  cssBytes = txt.length;
} catch (_e) { cssBytes = null; }
report({
  name: 'o4-first-paint-css-bytes',
  ok: cssBytes !== null && cssBytes > 0,
  detail: cssBytes === null ? 'phone.css 取不到 ⇒ unknown（不拿 0 冒充）' : 'phone.css 首屏载入文本长度=' + cssBytes + '字符（真 fetch 量的；源文件 623617 字节 —— 中文占多字节，字符数天然小于字节数）',
});

/* ② 打开 needsim：样式必须真到 */
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'needsim' } }));
const linkOk = await waitFor(function () {
  const l = document.getElementById('app-style-needsim');
  if (!l) return false;
  try { return !!(l.sheet && l.sheet.cssRules && l.sheet.cssRules.length > 0); } catch (_e) { return false; }
}, { timeoutMs: 15000 });
const nsmAfter = probeVar('nsm-root', '--nsm-bg');
report({
  name: 'o4-open-feeds-style',
  ok: !!linkOk && nsmAfter.length > 0,
  detail: 'link#app-style-needsim 载入并解析=' + !!linkOk + '；打开后探针 --nsm-bg=' + JSON.stringify(nsmAfter) + '（非空=样式真生效）',
});

/* ③ 换成另一个没打开的 App：它依然不许生效 */
const sndStill = probeVar('snd-root', '--snd-bg');
report({
  name: 'o4-untouched-still-out',
  ok: sndStill === '',
  detail: '打开 needsim 之后 --snd-bg=' + JSON.stringify(sndStill) + '（应仍空串：没打开 soundkit 就不该有它的样式）',
});

/* 再打开第二个 App：第二次也要真到（不许只对第一个有效） */
window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'soundkit' } }));
const sndLoaded = await waitFor(function () {
  const l = document.getElementById('app-style-soundkit');
  if (!l) return false;
  try { return !!(l.sheet && l.sheet.cssRules && l.sheet.cssRules.length > 0); } catch (_e) { return false; }
}, { timeoutMs: 15000 });
const sndAfter = probeVar('snd-root', '--snd-bg');
report({
  name: 'o4-second-app-also-fed',
  ok: !!sndLoaded && sndAfter.length > 0,
  detail: 'link#app-style-soundkit 载入=' + !!sndLoaded + '；--snd-bg=' + JSON.stringify(sndAfter),
});

/* 回执与计数：宿主把回执挂到 VirtualPhone._r25O4，dataset 上屏 */
/* shell 是个 JS 对象，读数落在它那个根节点的 dataset 上 ⇒ 直接按属性反查。 */
const shell = document.querySelector('[data-app-style-bytes-out]');
const col = (function () {
  try { return window.VirtualPhone && window.VirtualPhone._r25O4 && window.VirtualPhone._r25O4.collect ? window.VirtualPhone._r25O4.collect() : null; } catch (_e) { return null; }
})();
report({
  name: 'o4-receipts',
  ok: !!col && col.loaded >= 2 && col.degraded === 0 && col.bytesOut > 0,
  detail: col
    ? 'loaded=' + col.loaded + ' degraded=' + col.degraded + ' unknown=' + col.unknown + ' bytesOut=' + col.bytesOut + 'B 条数=' + col.entryCount
    : '取不到 _r25O4.collect ⇒ unknown（不编 0）',
});
report({
  name: 'o4-dataset-readout',
  ok: !!(shell && shell.dataset && shell.dataset.appStyleLoaded !== undefined && shell.dataset.appStyleDegraded !== undefined && shell.dataset.appStyleBytesOut !== undefined),
  detail: shell && shell.dataset
    ? 'dataset.appStyleLoaded=' + shell.dataset.appStyleLoaded + ' appStyleDegraded=' + shell.dataset.appStyleDegraded + ' appStyleBytesOut=' + shell.dataset.appStyleBytesOut
    : '取不到 phone shell ⇒ 读数未上屏',
});

done();