/* R25-O5 设置面信息架构：浏览器层真读数
 * 要证的四件事（都必须在真 DOM 里量，node 里跑过的假 DOM 不算）：
 *   ① 打开设置页，面板真的在页面上（组 chip 六颗、状态行说人话、空组如实标）；
 *   ② 搜索真的「看得见」：命中项画在可见区，而不是被藏在 hidden 的 tab 里；
 *   ③ 恢复默认：先出差异预览（从什么变成什么），点确认后 storage 真回到 100；
 *   ④ 三态不塌：读不到当前值时只说「未知」，一次都不写。
 *
 * 口径说明（都是踩过才知道的）：
 *   · 起壳必须走真实入口（#phoneDrawerToolEntry 点击 → .phone-in-panel），再点桌面图标开 App。
 *     直接派发 `phone:openApp` 时 phoneShell 还没注入，设置页 render() 里
 *     `this.phoneShell.setContent` 会抛 null —— 那不是本项的 bug，是「跳过起壳」这个场景自己的错
 *     （第一次跑就红在这，如实记在证据页）。
 *   · 中途会切 tab（设置页整页重渲），所以每一步都重新取元素，不缓存节点；
 *   · 最后一条负控制会临时把 storage.get 打成抛错，做完立刻还原。
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
/* 不冒泡点击：设置页在 document 上有全局 click 委托（会读 storage）。
 * 负控制要把 storage.get 打成抛错，若点击冒泡上去，委托里的读取会抛出去，
 * 场景就自己摄一条 window-error —— 那不是产品缺陷，是注入面太宽。 */
function clickNoBubble(el) {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }));
  return true;
}
function fireInput(el, value) {
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
const panelEl = () => document.getElementById('r25-ia-panel');
const statusText = () => {
  const el = document.getElementById('r25-ia-status');
  return el ? String(el.textContent || '') : '';
};

/* ---------- 0. 起壳 + 关公告弹窗（与 o1-settings-save 同一口径） ---------- */
await import('/index.js');
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 15000 });
let shellUp = false;
for (let i = 0; i < 3 && !shellUp; i += 1) {
  const trigger = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (trigger) realClick(trigger);
  shellUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 10000 });
}
const homeUp = await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 8000 });
report({ name: 'o5-shell-up', ok: !!shellUp && !!homeUp, detail: 'shell=' + !!shellUp + ' home=' + !!homeUp + '（不起壳就直接派发 openApp，设置页拿不到 phoneShell）' });

const modal = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modal) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}

/* ---------- 1. 走真实图标点开设置 App ---------- */
async function openAppByName(name, viewSel) {
  await window.__sleep(560); // goHome 重入屏蔽窗口
  const icon = [...document.querySelectorAll('.home-screen .app-icon')].find((el) => {
    const t = el.querySelector('.app-name');
    return t && t.textContent.trim() === name;
  });
  if (!icon) return { ok: false, why: '找不到图标 ' + name };
  realClick(icon);
  const up = await waitFor(() => document.querySelector(viewSel), { timeoutMs: 12000 });
  return { ok: up, why: up ? '已渲染 ' + viewSel : '未渲染 ' + viewSel };
}
const opened = await openAppByName('设置', '#yzp-settings-app, .settings-app');
const mounted = await waitFor(() => !!panelEl(), { timeoutMs: 12000 });
report({
  name: 'o5-panel-mounted',
  ok: !!opened.ok && !!mounted,
  detail: opened.why + '；#r25-ia-panel ' + (mounted ? '在页面上' : '没挂上（模块在盘 ≠ 面板在页面上）'),
});

/* ① 组目录：六颗 chip + 空组如实标 + 状态行说人话 */
const chips = mounted ? Array.from(panelEl().querySelectorAll('.r25-ia-group')) : [];
const emptyChips = chips.filter((c) => c.getAttribute('data-empty') === '1').length;
const emptyAllDisabled = chips.filter((c) => c.getAttribute('data-empty') === '1').every((c) => c.disabled === true);
report({
  name: 'o5-group-chips',
  ok: chips.length === 6 && statusText().indexOf('项设置') >= 0,
  detail: '组 chip=' + chips.length + '（应 6）；空组=' + emptyChips + ' 且空组 chip 全 disabled=' + emptyAllDisabled +
    '；状态行=' + JSON.stringify(statusText().slice(0, 70)) +
    '；dataset.iaItems=' + String(document.body.dataset.iaItems) + ' iaGroups=' + String(document.body.dataset.iaGroups) + ' iaEmptyGroups=' + String(document.body.dataset.iaEmptyGroups),
});

/* ② 搜索看得见：命中列表必须画在面板的可见区 */
const searchInput = document.getElementById('r22-settings-filter');
fireInput(searchInput, '字号');
await waitFor(() => {
  const r = document.getElementById('r25-ia-results');
  return !!(r && !r.hidden && r.querySelectorAll('.r25-ia-hit').length > 0);
}, { timeoutMs: 8000 });
const results = document.getElementById('r25-ia-results');
const hitCount = results ? results.querySelectorAll('.r25-ia-hit').length : 0;
const resultsVisible = !!(results && !results.hidden && results.getBoundingClientRect().height > 0);
report({
  name: 'o5-search-visible',
  ok: hitCount > 0 && resultsVisible,
  detail: '搜「字号」→ 命中行=' + hitCount + ' 结果区可见=' + resultsVisible + '（可见=真排版高度>0，不是只看 hidden 属性）' +
    '；状态行=' + JSON.stringify(statusText().slice(0, 60)),
});

fireInput(searchInput, '');
await waitFor(() => { const r = document.getElementById('r25-ia-results'); return !!(r && r.hidden); }, { timeoutMs: 5000 });
const clearedHidden = (() => { const r = document.getElementById('r25-ia-results'); return !!(r && r.hidden); })();
report({
  name: 'o5-search-cleared',
  ok: clearedHidden,
  detail: '清空搜索后结果区收起=' + clearedHidden + '；状态行=' + JSON.stringify(statusText().slice(0, 60)),
});

/* ③ 恢复默认：先改一项，再点统一入口，必须出预览、真写回 */
try { await window.VirtualPhone.storage.set('phone-font-scale', 140); } catch (_e) {}
const changedBefore = (() => { try { return String(window.VirtualPhone.storage.get('phone-font-scale')); } catch (_e) { return 'unknown'; } })();
realClick(document.getElementById('r25-ia-reset'));
const sheetShown = await waitFor(() => { const s = document.getElementById('r25-ia-sheet'); return !!(s && !s.hidden); }, { timeoutMs: 6000 });
/* waitFor 返回的是布尔，不是元素：预览层内容要重新从 DOM 取（把它当元素用过一次，读数就成空串） */
const sheetNode = document.getElementById('r25-ia-sheet');
const sheetText = sheetNode ? String(sheetNode.textContent || '') : '';
report({
  name: 'o5-reset-preview',
  ok: !!sheetShown && sheetText.indexOf('→') >= 0 && sheetText.indexOf('140') >= 0,
  detail: '改前 phone-font-scale=' + changedBefore + '；预览层出现=' + !!sheetShown + '；预览里含「140 →」=' + (sheetText.indexOf('140') >= 0) +
    '；预览文字=' + JSON.stringify(sheetText.slice(0, 90)),
});

if (sheetShown) {
  realClick(document.getElementById('r25-ia-reset-confirm'));
}
await waitFor(() => statusText().indexOf('已恢复') >= 0, { timeoutMs: 8000 });
const after = (() => { try { return Number(window.VirtualPhone.storage.get('phone-font-scale')); } catch (_e) { return NaN; } })();
report({
  name: 'o5-reset-applied',
  ok: after === 100,
  detail: '确认恢复后 storage.phone-font-scale=' + String(after) + '（应回到 100）；状态行=' + JSON.stringify(statusText().slice(0, 60)),
});

/* 再点一次：都已是默认值，不许装作又改了什么 */
await waitFor(() => !!panelEl(), { timeoutMs: 8000 });
realClick(document.getElementById('r25-ia-reset'));
await waitFor(() => statusText().indexOf('都是默认值') >= 0, { timeoutMs: 6000 });
const sheetAfterNoop = document.getElementById('r25-ia-sheet');
report({
  name: 'o5-reset-noop',
  ok: statusText().indexOf('都是默认值') >= 0 && !!(sheetAfterNoop && sheetAfterNoop.hidden),
  detail: '第二次点恢复默认：状态行=' + JSON.stringify(statusText().slice(0, 60)) + '；预览层未弹=' + !!(sheetAfterNoop && sheetAfterNoop.hidden),
});

/* ④ 负控制：把 storage.get 打成抛错，必须只说未知且一次不写 */
const st = window.VirtualPhone.storage;
const origGet = st.get;
const origSet = st.set;
let writesDuringFail = 0;
await waitFor(() => !!panelEl(), { timeoutMs: 5000 });
/* 注入窗口只覆盖「点按钮」这一小段同步执行：reset 处理器同步算出 plan，算完立刻还原。
 * 上一版把 get 打成长期抛错，设置页里别的组件也在读 storage ⇒ 场景自己摄出一条 window-error，
 * 那不是产品缺陷，是注入面太宽（如实记在证据页）。 */
st.get = function () { throw new Error('场景注入：storage 读失败'); };
st.set = function () { writesDuringFail += 1; return Promise.resolve(); };
clickNoBubble(document.getElementById('r25-ia-reset'));
st.get = origGet;
st.set = origSet;
await window.__sleep(120);
const failStatus = statusText();
const failSheetHidden = (() => { const s = document.getElementById('r25-ia-sheet'); return !!(s && s.hidden); })();
report({
  name: 'o5-read-fail-unknown',
  ok: (failStatus.indexOf('未知') >= 0 || failStatus.indexOf('读不到') >= 0) && writesDuringFail === 0 && failSheetHidden,
  detail: '读失败时状态行=' + JSON.stringify(failStatus.slice(0, 60)) + '；写入次数=' + writesDuringFail + '（应 0）；预览层未弹=' + failSheetHidden,
});

/* 组跳转：点「生图」chip 应真的切 tab（设置页整页重渲，面板随后重建） */
const imageChip = panelEl() ? panelEl().querySelector('.r25-ia-group[data-ia-group="image"]') : null;
const chipEnabled = !!(imageChip && imageChip.disabled !== true);
realClick(imageChip);
const tabSwitched = await waitFor(() => {
  const b = document.querySelector('.settings-tab-btn[data-tab="image"]');
  return !!(b && b.getAttribute('aria-selected') === 'true');
}, { timeoutMs: 8000 });
report({
  name: 'o5-group-jump',
  ok: chipEnabled && !!tabSwitched && !!panelEl(),
  detail: '「生图」chip 可点=' + chipEnabled + '；点后 tab-image aria-selected=' + !!tabSwitched + '；面板重建=' + !!panelEl() +
    '；状态行=' + JSON.stringify(statusText().slice(0, 50)),
});

done();