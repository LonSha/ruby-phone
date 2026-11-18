/* ============================================================
 * tests/browser/scenarios/o3-media-20.scen.js — R25-O3 浏览器真读数
 * ------------------------------------------------------------
 * 回答的问题：连开 20 张**真解码**的原图、逐张关掉之后，
 *   ① 覆盖层里的 <img> 是否真被摘掉 src（不是「把节点 remove 掉」冒充释放）；
 *   ② 内核台账的 live 是否归零；
 *   ③ 回执是否逐条 ok=true；
 *   ④ dataset.mlReleased 是否等于 20（人/回归都能读到）；
 *   ⑤ 换图路径（不关直接开下一张）是否留下孤儿覆盖层。
 *
 * 口径说明（不许含糊）：
 *   · 图片是画布当场生成的 320x320、每张像素各不相同（1x1 占位图解码后共享同一份位图，
 *     量不出代价，等于把这条判据掏空）；
 *   · performance.memory 的 heap 前后只作**参考**：不可读时如实报 unknown（不拿 0 冒充），
 *     主判据永远是「句柄归零 + src 真摘 + 回执 ok」；
 *   · 为了让人能看见「已释放 N」，末段临时把 albumData.getMedia 指到本场景注入的 20 张
 *     （否则相册是空库、工具条不渲染），读数后立刻还原 —— 这是夹具替换，detail 里写明。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
import { desktopIcon } from '/tests/browser/desktop-navigation.mjs';
const M = await import('/config/media-lifetime.js');
installBrowserHost({ chat: [
  { mes: '楼层0', is_user: true, swipes: ['x'], swipe_id: 0 },
  { mes: '楼层1', is_user: false, name: '角色', swipes: ['x'], swipe_id: 0 },
] });
function realClick(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
await import('/index.js');
await waitFor(function () { return !!(window.VirtualPhone && window.VirtualPhone.version); }, { timeoutMs: 25000 });
let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (t) realClick(t);
  opened = await waitFor(function () { return !!document.querySelector('.phone-in-panel'); }, { timeoutMs: 12000 });
}
await waitFor(function () { return !!document.querySelector('.home-screen'); }, { timeoutMs: 12000 });
/* 更新弹窗会盖住整个视口：不关掉，后面 desktopIcon 的点击都打在弹窗上。 */
const modal = await waitFor(function () { return !!document.getElementById('st-phone-update-modal'); }, { timeoutMs: 6000 });
if (modal) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(function () { return !document.getElementById('st-phone-update-modal'); }, { timeoutMs: 5000 });
}
const icon = await desktopIcon('album');
if (icon) realClick(icon);
const albumUp = await waitFor(function () { return !!document.querySelector('.album-app'); }, { timeoutMs: 12000 });
const app = window.VirtualPhone && window.VirtualPhone.albumApp;
const view = app && app.albumView;
const reachable = !!(albumUp && view && typeof view.openPreview === 'function' && typeof view.closePreview === 'function');
report({
  name: 'o3-view-reachable',
  ok: reachable,
  detail: reachable
    ? '相册已开屏；albumView.openPreview/closePreview 可取到，入口=' + (icon ? '桌面图标' : '未找到')
    : '取不到相册视图（albumUp=' + albumUp + ' view=' + !!view + '）—— 不猜别的入口，直接判未达',
});
if (!reachable) {
  done();
} else {
  /* ---- 1. 真图：画布当场生成，每张都不同 ---- */
  function makePng(i) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 320;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = 'hsl(' + ((i * 17) % 360) + ',72%,50%)';
    g.fillRect(0, 0, 320, 320);
    for (let k = 0; k < 48; k++) {
      g.fillStyle = 'hsl(' + ((i * 37 + k * 11) % 360) + ',85%,' + (25 + (k % 55)) + '%)';
      g.fillRect((k * 61 + i * 13) % 304, (k * 97 + i * 7) % 304, 18 + (k % 12), 18 + (k % 12));
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 72px sans-serif';
    g.fillText('#' + i, 24, 200);
    return c.toDataURL('image/png');
  }
  const N = 20;
  const srcs = [];
  let byteSum = 0;
  let byteMin = 0;
  for (let i = 0; i < N; i++) {
    const s = makePng(i);
    srcs.push(s);
    const b = M.mlBytesOfSrc(s);
    if (typeof b === "number") {
      byteSum += b;
      if (!byteMin || b < byteMin) byteMin = b;
    }
  }
  report({
    name: 'o3-payload-real',
    ok: srcs.length === N && new Set(srcs).size === N && byteMin > 1000,
    detail: '画布生成 ' + srcs.length + ' 张 320x320 PNG，去重后 ' + new Set(srcs).size + ' 张，最小单张 ' + byteMin + ' B，合计约 ' + Math.round(byteSum / 1024) + ' KiB（占位图会被这条拦下）',
  });
  /* 注入 20 条影像记录（字段与 getMedia 出口同形；src 是真 data URL）。 */
  view.images = srcs.map(function (src, i) {
    return {
      id: '/fake/o3-' + i + '.png',
      path: '/fake/o3-' + i + '.png',
      src: src,
      filename: 'o3-' + i + '.png',
      mediaType: 'image',
      sources: ['o3'],
      refCount: 1,
      createdAt: Date.now() - i * 1000,
      storyAt: null,
      sourceKey: 'other',
    };
  });
  const heap0 = (typeof performance !== "undefined" && performance.memory) ? performance.memory.usedJSHeapSize : null;
  /* ---- 2. 20 轮开→关：关前 live=1、关后 live=0、src 真摘、节点真出 DOM ---- */
  let bad = 0;
  let firstBad = "";
  for (let i = 0; i < N; i++) {
    view.openPreview(i);
    const img = document.querySelector('.album-app .album-preview-image') || document.querySelector('.album-preview-image');
    const hadSrc = !!(img && img.getAttribute("src"));
    const liveAtOpen = (view._mediaLive || new Map()).size;
    view.closePreview();
    const srcGone = !!(img && !img.hasAttribute("src"));
    const goneFromDom = !!(img && !img.isConnected);
    const liveAtClose = (view._mediaLive || new Map()).size;
    if (!hadSrc || !srcGone || !goneFromDom || liveAtOpen !== 1 || liveAtClose !== 0) {
      bad += 1;
      if (!firstBad) firstBad = 'i=' + i + ' hadSrc=' + hadSrc + ' srcGone=' + srcGone + ' removed=' + goneFromDom + ' liveOpen=' + liveAtOpen + ' liveClose=' + liveAtClose;
      if (img && img.getAttribute("src")) img.removeAttribute("src");
    }
  }
  report({
    name: 'o3-open-close-20',
    ok: bad === 0,
    detail: bad === 0
      ? (N + ' 轮开/关全部合格：关前 live=1、关后 live=0、句柄 src 真摘、覆盖层节点真出 DOM')
      : (bad + ' 轮不合格，首例 ' + firstBad),
  });
  /* ---- 3. 回执 / live 归零 / dataset 读数 ---- */
  const liveLeft = (view._mediaLive || new Map()).size;
  const receipts = view._mediaReceipts || [];
  const okCount = receipts.filter(function (r) { return !!r && r.ok === true; }).length;
  report({
    name: 'o3-receipts',
    ok: receipts.length >= N && okCount === receipts.length,
    detail: '回执 ' + receipts.length + ' 条，ok=true ' + okCount + ' 条，台账上限 ' + M.ML_RECEIPT_LIMIT + '（丢最旧、不丢最坏）',
  });
  const hostEl = document.querySelector('.album-app');
  const dsReleased = Number(hostEl && hostEl.dataset ? hostEl.dataset.mlReleased : -1);
  const dsLive = String(hostEl && hostEl.dataset ? hostEl.dataset.mlLive : '');
  let lastReceipt = null;
  try { lastReceipt = JSON.parse((hostEl.dataset.mlLastReceipt) || 'null'); } catch (e) { lastReceipt = null; }
  report({
    name: 'o3-live-and-dataset',
    ok: liveLeft === 0 && document.querySelectorAll('.album-preview').length === 0 && dsReleased === N && dsLive === '0' && !!lastReceipt && lastReceipt.ok === true,
    detail: 'live=' + liveLeft + ' 残留覆盖层=' + document.querySelectorAll('.album-preview').length + ' dataset.mlReleased=' + dsReleased + '（应=' + N + '） mlLive=' + dsLive + ' mlLastReceipt.ok=' + (lastReceipt ? lastReceipt.ok : 'null'),
  });
  /* ---- 4. 人能看到的那一行：工具条上的「已释放 20」 ---- */
  const dataObj = view.app && view.app.albumData;
  const origGet = dataObj && dataObj.getMedia;
  if (dataObj && typeof origGet === "function") {
    dataObj.getMedia = function () { return view.images.slice(); };
  }
  view.render();
  const toolbar = document.querySelector('.album-body-toolbar');
  const toolbarText = toolbar ? String(toolbar.textContent) : '';
  report({
    name: 'o3-toolbar-visible',
    ok: !!toolbar && toolbarText.indexOf('已释放 20') >= 0,
    detail: toolbar ? ('工具条可见文本=' + toolbarText.slice(0, 60) + '（夹具：getMedia 临时指向本场景 20 张，读数后还原）') : 'render 后没有 .album-body-toolbar（相册仍是空库口径）',
  });
  if (dataObj && origGet) dataObj.getMedia = origGet;
  /* ---- 5. 换图路径：连开 3 张不关，最后关一次 ---- */
  const before = Number(document.querySelector('.album-app').dataset.mlReleased || '0');
  for (let i = 0; i < 3; i++) view.openPreview(i);
  const liveMid = (view._mediaLive || new Map()).size;
  const overlays = document.querySelectorAll('.album-preview').length;
  view.closePreview();
  const liveEnd = (view._mediaLive || new Map()).size;
  const after = Number(document.querySelector('.album-app').dataset.mlReleased || '0');
  report({
    name: 'o3-switch-path',
    ok: liveMid === 1 && overlays === 1 && liveEnd === 0 && (after - before) === 3,
    detail: '连开 3 张不关：覆盖层 ' + overlays + ' 个（应=1，换图不留孤儿）、live=' + liveMid + '；最后一次关掉 live=' + liveEnd + '，本轮释放 ' + (after - before) + ' 张（应=3）',
  });
  /* ---- 6. heap：只作参考，读不到就报 unknown ---- */
  const heap1 = (typeof performance !== "undefined" && performance.memory) ? performance.memory.usedJSHeapSize : null;
  const verdict = M.mlVerdict(heap0, heap1);
  report({
    name: 'o3-heap-reference',
    ok: true,
    detail: (heap0 === null || heap1 === null)
      ? 'performance.memory 不可读 ⇒ unknown（不拿 0 冒充）；主判据是句柄归零与 src 真摘，本条不给绿'
      : ('heap before=' + Math.round(heap0 / 1048576) + 'MiB after=' + Math.round(heap1 / 1048576) + 'MiB face=' + verdict.face + ' deltaPct=' + (verdict.deltaPct === null ? 'null' : verdict.deltaPct) + '；本条只作参考'),
  });
  done();
}
